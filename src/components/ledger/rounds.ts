import type { Round } from '@/lib/types';

// Lower = more "alive". Used both to pick a program's headline round and to
// order the programs list (open first, then announced, then everything else).
const ROUND_RANK: Record<string, number> = { open: 0, announced: 1, reviewing: 2, closed: 3, deployed: 4 };

function rank(status: string): number {
  return ROUND_RANK[status] ?? 5;
}

/** The single most-live round on a program, if it has any rounds at all. */
export function mostLiveRound(rounds: Round[] | undefined): Round | null {
  if (!rounds || rounds.length === 0) return null;
  return [...rounds].sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    // among equally-alive rounds prefer the soonest closing (or opening) date
    const da = a.closes || a.opens || '';
    const db = b.closes || b.opens || '';
    return da.localeCompare(db);
  })[0];
}

/** 0 = has an open round, 1 = has an announced round (no open), 2 = everything else. */
export function programRank(rounds: Round[] | undefined): 0 | 1 | 2 {
  const r = mostLiveRound(rounds);
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
