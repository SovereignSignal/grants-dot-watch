import type { ProposalType } from './types';

/**
 * Proposal types the machine validator never approves. These reasons hold for
 * every proposal the validator sees, including v2 funding imports (type
 * `profile_note`): the validator never approves award creation.
 *
 * The one narrower machine path is the award-source auto-apply below. It is
 * not the validator. It covers only v2 funding packets that the daily award
 * sweep compiled and queued in the same run from an allowlisted first-party
 * source. Award creation through any other route requires owner review.
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
 *   (SOURCE_CATALOG and NATIVE_REFRESH_SOURCES) and queued it in this run;
 * - that capture had no failed snapshot, no coverage gap and no held record
 *   (held covers possible duplicates, provider identity conflicts, joint
 *   beneficiaries, unresolved program mappings and changed existing keys);
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
 * `award_auto_apply` audit, at most MAX_AWARD_AUTO_APPLIES per run.
 * Anything else stays a pending Desk item for the owner.
 */
export const AWARD_AUTO_APPLY_POLICY = 'clean_first_party_award_packet_v1';

export function awardSourcesAutoApplyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AWARD_SOURCES_AUTO_APPLY === '1';
}
