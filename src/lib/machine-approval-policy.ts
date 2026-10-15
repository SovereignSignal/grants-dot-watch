import type { ProposalType } from './types';

/**
 * Proposal types the machine validator never approves. These reasons hold for
 * every proposal the validator sees, including v2 funding imports (type
 * `profile_note`): the validator never approves award creation.
 *
 * Two narrower machine paths sit beside the validator, each behind its own
 * flag. The award-source auto-apply below covers only v2 funding packets that
 * the daily award sweep compiled and queued from an allowlisted first-party
 * source. The Wire program auto-apply below covers only Wire `new_program`
 * items for an organization already in the registry, confirmed on that
 * organization's own site. Every other new program, and award creation
 * through any other route, requires owner review.
 *
 * The validator also never approves an X handle. Those go through the curator
 * auto-apply (src/lib/curator-auto-apply.ts): at submit time for a key with
 * `apply_low_risk`, and, with DESK_UPKEEP_ENABLED=1, in the daily Desk upkeep
 * (src/lib/desk-upkeep.ts), which re-runs the same check over pending curator
 * X-handle notes filed before submit-time auto-apply existed, acting only for
 * a filing key that is still active, unrevoked and holds `apply_low_risk`
 * (curator-auth.ts curatorKeyStanding). Both honor
 * CURATOR_AUTO_APPLY and CURATOR_AUTO_APPLY_TYPES, approve an add or replace
 * only when the quote and a fetched page on the org's own site name that exact
 * handle, and never approve a clear (`x: null`).
 *
 * The one machine rejection is Desk expiry, in the same daily upkeep: a
 * pending item whose live proposed rounds all closed after it was filed, or
 * that has waited 30 days, is rejected with by 'machine' and an `auto:` note
 * (desk-upkeep.ts expiryFor). Funding v2 imports, org merges and claimed
 * items are never expired; decideProposal also refuses any non-owner
 * rejection of a funding import.
 */
export function neverAutoReasonFor(type: ProposalType | string): string | null {
  switch (type) {
    case 'new_org':
      return 'new organizations require owner review';
    case 'new_program':
      return 'new programs require owner review';
    case 'new_award':
      return 'award creation requires owner review';
    case 'profile_note':
      return 'profile and identity changes require owner review';
    case 'status_change':
      return 'status changes require owner review';
    case 'merge_orgs':
      return 'org merges are never automated';
    default:
      return null;
  }
}

/**
 * Award-source auto-apply. Off unless AWARD_SOURCES_AUTO_APPLY=1, which is
 * independent of AWARD_SOURCES_ENABLED (the sweep must also be on).
 *
 * A v2 funding packet publishes without an owner click only when ALL hold:
 * - the daily sweep compiled it from a native, allowlisted first-party source
 *   (SOURCE_CATALOG and NATIVE_REFRESH_SOURCES), either in this run or in an
 *   earlier run that left it pending (proposal origin `award_source_sweep`);
 * - today's capture of that source had no failed snapshot and no coverage gap;
 * - no held record touches it (held covers possible duplicates, provider
 *   identity conflicts, joint beneficiaries, unresolved program mappings and
 *   changed existing keys). A held record blocks packets of its program that
 *   share its recipient or metric period; an unattributable one blocks the
 *   whole source;
 * - every record is new: preview added equals the record count, unchanged is
 *   zero, and no record supersedes or links an existing key;
 * - none of its records was in an owner-rejected packet, and none overlaps a
 *   pending Desk item;
 * - it holds only `awarded` funding events and process metrics, with the
 *   source's catalog program and issuer, and every program and organization
 *   resolves to a current registry entity with current reference hashes;
 * - it is within the Desk pack limits and the compiler's packet byte limit;
 * - a re-preview against current canonical bytes, right before applying,
 *   reproduces the queued plan digest, and the funding writer lock is free.
 * The rule is `packetReasons` and `mappingReasons` in
 * src/lib/funding-source-clean.mjs; src/lib/award-auto-apply.ts applies it.
 * Approval goes through decideProposal with by 'machine' and the
 * `award_auto_apply` audit, at most MAX_AWARD_AUTO_APPLIES per run. A clean
 * new packet past the cap or behind a busy writer is deferred unqueued to the
 * next run; a pending one is retried while its queued plan is still current.
 * Anything else stays a pending Desk item for the owner.
 */
export const AWARD_AUTO_APPLY_POLICY = 'clean_first_party_award_packet_v1';

export function awardSourcesAutoApplyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AWARD_SOURCES_AUTO_APPLY === '1';
}

/**
 * Wire program auto-apply. Off unless WIRE_PROGRAM_AUTO_APPLY=1. The daily
 * ingest runs it inside its lock and once-per-day claim, after the Wire
 * ingest, over every pending Wire `new_program` item (new today and backlog).
 * The validator above still never approves a new program; this is a separate
 * path with its own audit.
 *
 * A pending proposal is approved by the machine only when ALL hold:
 * - provenance: type `new_program`, signal id `wire:<entry>`, not queued by a
 *   curator, and no curator review that says reject or needs_owner;
 * - shape: exactly one `programs/<slug>.yaml` entry with only the fields the
 *   Wire ingest writes (id, name, org, apply_url, rounds), id equal to the
 *   slug, rounds limited to name/status/opens/closes/size/source, status
 *   `open` or absent;
 * - the org is already in the registry (no new org, no merge) and its website
 *   gives a registered domain;
 * - every URL the record would carry (apply_url, evidence_url, round sources)
 *   is https on that domain or a subdomain, and the checked URL (apply_url,
 *   else evidence_url) is not the bare homepage;
 * - the Wire source score is at least WIRE_PROGRAM_MIN_SCORE;
 * - every deadline is a valid date not before today's product date;
 * - no registry program has the same id, the same normalized name for that
 *   org, or the same apply_url, and nothing approved earlier in the run does;
 * - a server fetch of the checked URL (the curator auto-apply fetcher: https,
 *   public addresses only, on-domain redirects, 1 MB, 8 s) returns 200; its
 *   visible text contains the program name as a whole phrase (see
 *   `programNameCandidates`), an open/apply phrase or the proposal's deadline
 *   written with its year, and no closed phrase;
 * - decideProposal, which re-runs the staged registry validation, succeeds.
 * The rule is `assessWireProgram` and `confirmWireProgramPage` in
 * src/lib/wire-program-auto-apply.ts. Approval is a machine decision with the
 * `wire_program_auto_apply` audit. At most MAX_WIRE_PROGRAM_CHECKS items are
 * fetched per run, least recently checked first. Anything else stays pending
 * for the owner, with its reasons on the ingest last_run record.
 */
export const WIRE_PROGRAM_AUTO_APPLY_POLICY = 'verified_wire_program_known_org_v1';
export const WIRE_PROGRAM_MIN_SCORE = 70;

export function wireProgramAutoApplyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WIRE_PROGRAM_AUTO_APPLY === '1';
}
