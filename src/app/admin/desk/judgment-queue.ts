import type { Proposal } from '../../../lib/types';

export type CuratorVerdictFilter = 'all' | 'approve' | 'reject' | 'needs_owner' | 'unreviewed';

type Dated = {
  id: string;
  title: string;
  curator_review?: Proposal['curator_review'];
  proposed_change?: Record<string, unknown>;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function collectCloses(value: unknown, found: string[], depth: number) {
  if (depth > 6 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectCloses(item, found, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.closes === 'string' && DAY.test(record.closes)) found.push(record.closes);
  for (const child of Object.values(record)) {
    if (child && typeof child === 'object') collectCloses(child, found, depth + 1);
  }
}

/** Soonest close on the proposal. A curator correction wins over the proposed date. */
export function judgmentDeadline(proposal: Dated): string | null {
  const corrected = proposal.curator_review?.facts?.deadline;
  if (corrected && DAY.test(corrected)) return corrected;
  const found: string[] = [];
  collectCloses(proposal.proposed_change, found, 0);
  found.sort();
  return found[0] ?? null;
}

export function curatorVerdictOf(proposal: Dated): Exclude<CuratorVerdictFilter, 'all'> {
  return proposal.curator_review?.verdict ?? 'unreviewed';
}

/** Dated items first, soonest close first. Undated items keep a stable title order at the end. */
export function sortJudgmentQueue<T extends Dated>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const left = judgmentDeadline(a);
    const right = judgmentDeadline(b);
    if (left && right && left !== right) return left < right ? -1 : 1;
    if (left && !right) return -1;
    if (!left && right) return 1;
    return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}
