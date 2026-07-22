import type { Program, Round } from './types';

/** Calendar dates on grants.watch are interpreted in the product's operating
 * timezone. Registry deadlines are date-only values, so comparing them via
 * UTC would roll the public site into tomorrow at 5pm Pacific in summer. */
export const PRODUCT_TIME_ZONE = 'America/Los_Angeles';

export function productDateISO(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PRODUCT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const value = new Map(parts.map((part) => [part.type, part.value]));
  return `${value.get('year')}-${value.get('month')}-${value.get('day')}`;
}

export function productYear(at: Date = new Date()): number {
  return Number(productDateISO(at).slice(0, 4));
}

export function isCurrentRound(program: Program, round: Round, today: string = productDateISO()): boolean {
  if (program.status !== 'active' && program.status !== 'announced') return false;
  if (round.status !== 'open' && round.status !== 'announced') return false;
  return !round.closes || round.closes >= today;
}

export function currentRounds(program: Program, today: string = productDateISO()): Round[] {
  return (program.rounds || []).filter((round) => isCurrentRound(program, round, today));
}

/** Rolling means a presently open intake with no published boundary dates.
 * An undated announcement is an upcoming call with dates pending. */
export function isVerifiedRollingRound(program: Program, round: Round, today: string = productDateISO()): boolean {
  return isCurrentRound(program, round, today) && round.status === 'open' && !round.opens && !round.closes;
}

export function mostCurrentRound(program: Program, today: string = productDateISO()): Round | null {
  const rounds = currentRounds(program, today);
  if (rounds.length === 0) return null;
  return [...rounds].sort((a, b) => {
    const status = Number(a.status === 'announced') - Number(b.status === 'announced');
    if (status !== 0) return status;
    const aDate = a.closes || a.opens || '9999-12-31';
    const bDate = b.closes || b.opens || '9999-12-31';
    return aDate.localeCompare(bDate) || a.name.localeCompare(b.name);
  })[0];
}

export function effectiveRoundLabel(program: Program, round: Round, today: string = productDateISO()): string {
  if (round.status === 'open' || round.status === 'announced') {
    if (program.status === 'paused') return 'Paused';
    if (program.status === 'concluded' || (round.closes && round.closes < today)) return 'Closed';
  }
  const labels: Record<Round['status'], string> = {
    announced: 'Announced',
    open: 'Open',
    reviewing: 'Reviewing',
    closed: 'Closed',
    deployed: 'Deployed',
  };
  return labels[round.status];
}
