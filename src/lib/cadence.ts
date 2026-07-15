import type { Program } from './types';

export function hasVerifiedRollingIntake(program: Program): boolean {
  return (program.rounds || []).some(
    (round) => !round.opens && !round.closes && (round.status === 'open' || round.status === 'announced')
  );
}

export function hasYearCadence(program: Program, year: number): boolean {
  const prefix = `${year}-`;
  return hasVerifiedRollingIntake(program) || (program.rounds || []).some(
    (round) => round.opens?.startsWith(prefix) || round.closes?.startsWith(prefix)
  );
}

export function cadenceFallback(program: Program, year: number): { label: string; rolling: boolean } {
  const rounds = program.rounds || [];
  if (hasVerifiedRollingIntake(program)) return { label: 'Rolling intake', rolling: true };
  if (rounds.length === 0) return { label: 'No cadence on file', rolling: false };
  if (rounds.some((round) => round.opens || round.closes)) return { label: `No ${year} dates`, rolling: false };
  return { label: 'No dates on file', rolling: false };
}
