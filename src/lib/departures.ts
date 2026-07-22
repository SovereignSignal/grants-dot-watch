import type { Org, Program, Round } from './types';
import { isCurrentRound, productDateISO } from './round-state';

export interface Departure {
  key: string;
  program: Program;
  orgName: string;
  round: Round;
}

export function collectCurrentDepartures(programs: Program[], orgs: Org[], todayISO: string = productDateISO()): Departure[] {
  const orgById = new Map(orgs.map((org) => [org.id, org]));
  const dated: Departure[] = [];
  const standing: Departure[] = [];

  for (const program of programs) {
    for (const round of program.rounds || []) {
      if (!isCurrentRound(program, round, todayISO)) continue;

      const departure = {
        key: `${program.id}::${round.name}`,
        program,
        orgName: orgById.get(program.org)?.name || program.org,
        round,
      };
      if (round.closes) dated.push(departure);
      else standing.push(departure);
    }
  }

  dated.sort((a, b) => a.round.closes!.localeCompare(b.round.closes!));
  return [...dated, ...standing];
}
