import type { Org, Program, Round } from './types';

export interface Departure {
  key: string;
  program: Program;
  orgName: string;
  round: Round;
}

export function collectCurrentDepartures(programs: Program[], orgs: Org[], todayISO: string): Departure[] {
  const orgById = new Map(orgs.map((org) => [org.id, org]));
  const dated: Departure[] = [];
  const standing: Departure[] = [];

  for (const program of programs) {
    for (const round of program.rounds || []) {
      if (round.status !== 'open' && round.status !== 'announced') continue;
      if (round.closes && round.closes < todayISO) continue;

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
