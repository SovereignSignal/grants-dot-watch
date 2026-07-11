// Wire-service microcopy for The Desk (design/mocks/c-desk.html is canon;
// docs/DESIGN.md "Voice & era" is the law behind it) — proposal-type names,
// destination footnotes, and the confidence threshold that reads as "trusted
// on sight." Kept separate from desk-format.ts (pure formatting functions):
// this is copy, not logic.
import type { ProposalType, Wire } from '@/lib/types';
import { WIRE_LABEL } from '@/lib/format';

/** Confidence at or above this reads in the amber "trusted on sight" tone;
 *  below it reads as plain ink. Matches the canon mock: 85 plain, 91 and 97
 *  gold. */
export const CONFIDENCE_GOLD_THRESHOLD = 90;

/** The proposal type, in the register's own words — for the slug line and
 *  the group's month-rule bar. Deliberately not proposal-lanes.ts's
 *  TYPE_LABEL (which still drives the filter chips): that one is a UI label,
 *  this one is a dateline word. */
export const TYPE_SLUG_LABEL: Record<ProposalType, string> = {
  new_org: 'New organization',
  new_program: 'New program',
  round_update: 'Round update',
  deadline_change: 'Deadline change',
  status_change: 'Status change',
  new_award: 'New award',
  profile_note: 'Profile note',
  merge_orgs: 'Org merge',
};

/** The footnote under a proposed change's mono block — why this particular
 *  class of edit needed a human at all. "Always asks first" for the one
 *  judgment the register never automates (a brand-new entity, docs/DESIGN.md
 *  §"Two-lane curation"); "awaiting gear" for every other class, echoing the
 *  canon mock's own phrase for a judgment class that hasn't graduated to
 *  auto-apply yet. */
export const DESTINATION_NOTE: Record<ProposalType, string> = {
  new_org: 'new entity card, always asks first.',
  new_program: 'new program record, awaiting gear.',
  round_update: 'field update, awaiting gear.',
  deadline_change: 'field update, awaiting gear.',
  status_change: 'field update, awaiting gear.',
  new_award: 'new award record, awaiting gear.',
  profile_note: 'profile prose, awaiting gear.',
  merge_orgs: 'org merge, awaiting gear.',
};

export function wireVoiceLabel(wire: Wire): string {
  return `${WIRE_LABEL[wire]} Wire`;
}
