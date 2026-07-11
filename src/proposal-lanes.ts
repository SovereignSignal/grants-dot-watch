// Two-lane law (docs/DESIGN.md): machine-verifiable facts with evidence apply
// automatically with provenance; everything else is an editorial judgment
// call that queues for Sov. Pure logic, safe to import from server or client.
import type { ProposalType } from './lib/types';

export const FACT_TYPES: ReadonlySet<ProposalType> = new Set([
  'round_update',
  'deadline_change',
  'status_change',
  'new_award',
]);

export function laneFor(type: ProposalType, evidenceUrl: string | null | undefined): 'fact' | 'judgment' {
  return FACT_TYPES.has(type) && !!evidenceUrl ? 'fact' : 'judgment';
}

export const TYPE_LABEL: Record<ProposalType, string> = {
  new_org: 'New org',
  new_program: 'New program',
  round_update: 'Round update',
  deadline_change: 'Deadline change',
  status_change: 'Status change',
  new_award: 'New award',
  profile_note: 'Profile note',
  merge_orgs: 'Merge',
};

/** Deterministic type order — keeps grouped queue sections (The Desk) and
 *  bulk-approve summaries (commit messages, confirm dialogs) in a stable,
 *  predictable order instead of whatever order the store happens to return. */
export const PROPOSAL_TYPE_ORDER: ProposalType[] = [
  'new_org',
  'new_program',
  'round_update',
  'deadline_change',
  'status_change',
  'new_award',
  'profile_note',
  'merge_orgs',
];

function pluralTypeLabel(type: ProposalType, count: number): string {
  const label = TYPE_LABEL[type].toLowerCase();
  return count === 1 ? label : `${label}s`;
}

/** "34 new orgs, 12 round updates" — the human-readable breakdown shared by
 *  the bulk-approve commit message (decide-bulk/route.ts) and the UI's
 *  confirm-before-approve dialog and Facts "apply all" button, so the two
 *  never drift apart. */
export function typeCountsSummary(types: ProposalType[]): string {
  const counts = new Map<ProposalType, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return PROPOSAL_TYPE_ORDER.filter((t) => counts.has(t))
    .map((t) => `${counts.get(t)} ${pluralTypeLabel(t, counts.get(t)!)}`)
    .join(', ');
}
