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
 * The daily review recheck, behind DESK_UPKEEP_ENABLED=1 plus
 * REVIEW_RECHECK_ENABLED=1, approves one more narrow kind of profile_note: a
 * renewal that moves only a program's review.checked_on and
 * review.review_after, after re-fetching the official page. Its rule is
 * REVIEW_RECHECK_POLICY below.
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
 *   slug, at most one round named `Current call` with only name, status,
 *   closes, source and size, status `open` or absent. `opens` is never
 *   auto-published;
 * - a Wire amount (`size`), when present, reads as one amount at the start:
 *   a currency (US$, $, €, £ or USD, EUR, GBP, CHF, CAD, AUD, USDC, USDT,
 *   DAI) and a value, a range ("$50,000–$100,000", "50k–100k EUR") or an
 *   "up to" amount, then nothing or a qualifier of 1 to 4 plain words with
 *   no digits ("budget", "per team", "pool"; `parseAmount`). Anything else
 *   ("$75,000 for 10 teams", a 5-word qualifier, "$50-100k", "1.500M",
 *   "CA$", "$75k+") is `amount_unparsed`. It is published exactly as queued;
 * - published text is plain: the name has no markup or links (120 chars
 *   max); the proposal summary, which becomes the program summary, is 40 to
 *   SUMMARY_MAX characters with no markup or links. The payload cannot set
 *   systems, wires or summary, and the proposal's wire (which the committer
 *   publishes) must be one of the org's own wires;
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
 *   written with its year, every deadline the record carries written with its
 *   year, no closed phrase, and, for a Wire amount, the same amount in the
 *   same currency (`findAmountOnPage`, else `amount_not_on_page`), and for
 *   a qualifier, that same page mention followed directly by the qualifier's
 *   words, in order, in the same sentence (`matchAmountOnPage`, else
 *   `amount_qualifier_not_on_page`; "$75k budget" states "$75,000 budget",
 *   "$75,000 pool" does not state "$75,000 per team"). The proposal amount
 *   and the page go through one normalization (`normalizeMoneyText`; a
 *   proposal amount with markup or an entity is unparsed). Only , . ' ’ and
 *   the thin spaces U+2009/U+202F separate thousands, never a plain or
 *   no-break space, and a number that runs on into more digits through a
 *   space, separator or tag ("$75 000", "$75,<b>000</b>") is not read at
 *   all. Pages are read up to MAX_SCAN_CHARS of text and MAX_ATOMS numbers;
 *   an amount past that is not found, and the audit records page_truncated. Page
 *   amounts are read with the same grammar, so "$75,000", "$75k",
 *   "75,000 USD", "USD 75,000" and "up to $75,000" are one value, "€50.000"
 *   is 50,000 euros, and "$1M", "$1 million" and "$1,000,000" are equal. A
 *   number is read whole (175,000 never matches 75,000), a range matches only
 *   the same range, and an "up to" amount needs "up to" on the page;
 * - decideProposal, which re-runs the staged registry validation, succeeds,
 *   and the claimed payload still hashes to the one checked
 *   (`expect_change_hash`; a payload changed since the check is refused).
 *   Every automatic approval (curator auto-apply, award, Wire program) must
 *   pass that hash; decideProposal refuses one without it.
 * The rule is `assessWireProgram` and `confirmWireProgramPage` in
 * src/lib/wire-program-auto-apply.ts, with amounts in src/lib/money-match.ts.
 * Approval is a machine decision with the `wire_program_auto_apply` audit,
 * which records the queued amount and the page text that matched it. At most MAX_WIRE_PROGRAM_CHECKS items are
 * fetched per run, least recently checked first. Anything else stays pending
 * for the owner, with its reasons on the ingest last_run record.
 */
export const WIRE_PROGRAM_AUTO_APPLY_POLICY = 'verified_wire_program_known_org_v2';
export const WIRE_PROGRAM_MIN_SCORE = 70;

export function wireProgramAutoApplyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WIRE_PROGRAM_AUTO_APPLY === '1';
}

/**
 * Review renewal (the daily review recheck, src/lib/review-recheck.ts). Off
 * unless DESK_UPKEEP_ENABLED=1 and REVIEW_RECHECK_ENABLED=1. It runs in the
 * daily ingest run, right after Desk upkeep, inside the same lock and
 * once-per-day claim.
 *
 * A program is due when its review_after falls on or before today plus
 * REVIEW_HORIZON_DAYS (7; program-review.ts reviewDueState, the same
 * computation /admin/health shows). It is skipped, with its reason, when the
 * health page calls it beyond a recheck (reviewRenewalBlocker: unresolved
 * identity, former or unconfirmed operator, program not active), when its
 * reviewed operating status no longer matches the program, when a recheck
 * item for the same review is already pending, or when the owner rejected one.
 *
 * The renewal is approved by the machine only when ALL hold:
 * - the review source is https on the org's registered domain (org website)
 *   or the program's (apply_url), or a subdomain; a shared host
 *   (github.com, docs.google.com, ...; curator-auto-apply.ts SHARED_SITE)
 *   is no domain;
 * - a server fetch of the review source (the curator auto-apply fetcher:
 *   public addresses only, redirects only within that domain, 1 MB, 8 s)
 *   returns 200. The 1 MB cap refuses a larger page rather than truncating
 *   it, so a verdict is never read off part of a page;
 * - the page's visible text contains the program name as a whole phrase;
 * - the page supports the recorded intake (reviewIntakeSupport):
 *   open: a STATUS_EVIDENCE_PHRASES open phrase (applications open, apply
 *   now, accepting applications, ...), or for a rolling review also "rolling
 *   basis" or "rolling applications", and no closed phrase from the wider
 *   wire-program list; closed: a closed phrase and no open phrase from the
 *   wider list. Postponed or unknown intake is never renewed by the machine;
 * - for an open review scoped to named rounds, every named round is still
 *   open or announced, not past its closing date, and its closing date is on
 *   the page with its year;
 * - the proposal changes only review.checked_on (today's product date) and
 *   review.review_after (today plus REVIEW_RENEW_DAYS, 30). Every other
 *   review field, and the rest of the file, is carried over unchanged; a dry
 *   run of the committer on the exact bytes read must agree (a blank
 *   top-level field it omits, such as apply_url "", counts as absent). A
 *   redirected source is recorded in the audit, never written;
 * - decideProposal succeeds: the file still hashes to the bytes the check
 *   read (_expected_content_hashes), the claimed payload still hashes to the
 *   one checked (expect_change_hash), and the staged registry validates.
 * Approval is a machine decision with the `review_recheck_auto_apply` audit
 * (policy, program, fetched and final URL, page SHA-256, matched name and
 * intake phrase, old and new dates). At most MAX_REVIEW_RECHECKS pages are
 * fetched per run, one at a time.
 *
 * Nothing else is applied. A page that now says closed for an open review is
 * queued as a closure; any other intake change is queued; an off-domain or
 * shared-host source, a missing name, an intake the page does not confirm,
 * a named round that is no longer current, or a write the committer would
 * widen is queued as a renewal for the owner to check. A failed fetch stamps nothing and queues nothing; it is
 * recorded on the run summary only.
 */
export const REVIEW_RECHECK_POLICY = 'official_page_review_renewal_v1';

export function reviewRecheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DESK_UPKEEP_ENABLED === '1' && env.REVIEW_RECHECK_ENABLED === '1';
}

/** The only proposed_change a machine review renewal may carry: one program
 *  file, guarded by its captured content hash, setting only `review`. The
 *  recheck verified that only the two dates differ from those exact bytes. */
export function isReviewRenewalChange(change: unknown): boolean {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return false;
  const entries = Object.entries(change as Record<string, unknown>);
  const files = entries.filter(([key]) => key !== '_expected_content_hashes');
  if (files.length !== 1 || entries.length !== 2) return false;
  const [path, value] = files[0];
  if (!/^programs\/[a-z0-9][a-z0-9-]*\.yaml$/.test(path)) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== 'review') return false;
  const review = (value as Record<string, unknown>).review;
  if (!review || typeof review !== 'object' || Array.isArray(review)) return false;
  const hashes = (change as Record<string, unknown>)._expected_content_hashes;
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) return false;
  const hashKeys = Object.keys(hashes as Record<string, unknown>);
  const hash = (hashes as Record<string, unknown>)[path];
  return hashKeys.length === 1 && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
}
