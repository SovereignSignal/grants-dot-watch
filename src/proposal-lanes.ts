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
