import { productDateISO } from './round-state';
import type { Program } from './types';

/** Operator lead time on a lapsing verification. The recheck producer defaults
 *  to the same window, so "due" on /admin/health and "due" in a recheck run name
 *  the same programs. */
export const REVIEW_HORIZON_DAYS = 7;

/** Registry dates are date-only, so the shift is plain UTC arithmetic on the
 *  calendar. The only zone-sensitive step is `today`, which productDateISO
 *  already resolves in product time. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export type ReviewDueState = 'none' | 'expired' | 'due' | 'current';

/** Review dates remain an internal research queue, independent of public facts. */
export function reviewDueState(program: Program, today = productDateISO(), horizonDays = REVIEW_HORIZON_DAYS): ReviewDueState {
  const review = program.review;
  if (!review) return 'none';
  if (review.review_after <= today) return 'expired';
  return review.review_after <= shiftDay(today, horizonDays) ? 'due' : 'current';
}

export interface ReviewRow { id: string; name: string; review_after: string; renewable: boolean }
export interface ReviewFreshness { reviewed: number; expired: ReviewRow[]; due: ReviewRow[]; drifted: ReviewRow[] }

const byDue = (a: ReviewRow, b: ReviewRow) => a.review_after.localeCompare(b.review_after) || a.id.localeCompare(b.id);

/** Research follow-ups for /admin/health. Identity and status drift still
 * require separate review; a new check date does not resolve them. */
export function reviewFreshness(programs: Program[], today = productDateISO(), horizonDays = REVIEW_HORIZON_DAYS): ReviewFreshness {
  const reviewed = programs.filter(p => p.review);
  const row = (p: Program): ReviewRow => ({ id: p.id, name: p.name, review_after: p.review!.review_after,
    renewable: p.review!.kind === 'program' && p.review!.relationship === 'current' && p.status === 'active' });
  const inState = (state: ReviewDueState) => reviewed.filter(p => reviewDueState(p, today, horizonDays) === state).map(row).sort(byDue);
  return { reviewed: reviewed.length, expired: inState('expired'), due: inState('due'),
    drifted: reviewed.filter(p => p.review!.operating !== p.status).map(row).sort(byDue) };
}

export function programRelationshipLabel(program: Program) {
  return program.review?.relationship === 'former' ? 'Former operator' : program.review?.relationship === 'unconfirmed' ? 'Associated organization' : 'Funding organization';
}
