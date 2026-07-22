import type { Program, Round } from '@/lib/types';
import { mostCurrentRound, productDateISO } from '@/lib/round-state';

/** The program's single current headline round in the product timezone. */
export function mostLiveRound(program: Program, today: string = productDateISO()): Round | null {
  return mostCurrentRound(program, today);
}

/** 0 = has an open round, 1 = has an announced round (no open), 2 = everything else. */
export function programRank(program: Program, today: string = productDateISO()): 0 | 1 | 2 {
  const r = mostLiveRound(program, today);
  if (r?.status === 'open') return 0;
  if (r?.status === 'announced') return 1;
  return 2;
}

/** Rounds ordered most-recent-first for the program detail timeline. */
export function timelineOrder(rounds: Round[]): Round[] {
  return [...rounds].sort((a, b) => {
    const da = a.closes || a.opens || '';
    const db = b.closes || b.opens || '';
    if (da !== db) return db.localeCompare(da); // most recent first
    return a.name.localeCompare(b.name);
  });
}
