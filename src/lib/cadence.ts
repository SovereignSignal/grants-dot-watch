import type { Program } from './types';
import { isOpenWithoutDeadline, productDateISO } from './round-state';

export function hasOpenRoundWithoutDeadline(program: Program, today: string = productDateISO()): boolean {
  return (program.rounds || []).some((round) => isOpenWithoutDeadline(program, round, today));
}

export function hasYearCadence(program: Program, year: number): boolean {
  const prefix = `${year}-`;
  return hasOpenRoundWithoutDeadline(program) || (program.rounds || []).some(
    (round) => round.opens?.startsWith(prefix) || round.closes?.startsWith(prefix)
  );
}

export function cadenceFallback(program: Program, year: number): { label: string; openWithoutDeadline: boolean } {
  const rounds = program.rounds || [];
  if (hasOpenRoundWithoutDeadline(program)) return { label: 'No close date on file', openWithoutDeadline: true };
  if (rounds.length === 0) return { label: 'No cadence on file', openWithoutDeadline: false };
  if (rounds.some((round) => round.opens || round.closes)) return { label: `No ${year} dates`, openWithoutDeadline: false };
  return { label: 'No dates on file', openWithoutDeadline: false };
}
