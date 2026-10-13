import { collectCurrentDepartures, type Departure } from './departures';
import { productDateISO } from './round-state';
import type { Org, Program } from './types';

export interface ProgramTimingSummary {
  todayISO: string;
  currentProgramCount: number;
  openWithDeadline: Departure[];
  openWithoutDeadline: Departure[];
  announced: Departure[];
  activeOrAnnouncedWithoutCurrentRound: number;
}

export interface ProgramRoundGroup {
  program: Program;
  orgName: string;
  rounds: Departure[];
}

/**
 * Split current round records by what the registry can actually support.
 * A missing close date is kept separate from a dated deadline. It is never
 * promoted to a claim that the program is rolling or permanently open.
 */
export function summarizeProgramTiming(
  programs: Program[],
  orgs: Org[],
  todayISO: string = productDateISO()
): ProgramTimingSummary {
  const current = collectCurrentDepartures(programs, orgs, todayISO);
  const openWithDeadline = current.filter((item) => item.round.status === 'open' && Boolean(item.round.closes));
  const openWithoutDeadline = current.filter((item) => item.round.status === 'open' && !item.round.closes);
  const announced = current.filter((item) => item.round.status === 'announced');
  const currentProgramIds = new Set(current.map((item) => item.program.id));
  const activeOrAnnounced = programs.filter((program) => !program.parent_round && (program.status === 'active' || program.status === 'announced'));

  return {
    todayISO,
    currentProgramCount: currentProgramIds.size,
    openWithDeadline,
    openWithoutDeadline,
    announced,
    activeOrAnnouncedWithoutCurrentRound: activeOrAnnounced.filter((program) => !currentProgramIds.has(program.id)).length,
  };
}

/** Group round-level records for compact program previews without hiding how
 * many distinct open rounds sit under the same program. */
export function groupDeparturesByProgram(departures: Departure[]): ProgramRoundGroup[] {
  const groups = new Map<string, ProgramRoundGroup>();
  for (const departure of departures) {
    const existing = groups.get(departure.program.id);
    if (existing) existing.rounds.push(departure);
    else {
      groups.set(departure.program.id, {
        program: departure.program,
        orgName: departure.orgName,
        rounds: [departure],
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.program.name.localeCompare(b.program.name));
}
