import type { Program, Round } from './types';
import { dateBounds, httpUrl } from './opportunities';
import { productDateISO } from './round-state';

export const PROGRAM_STATUS = {
  active: { label: 'Active', note: 'The program is running.' },
  announced: { label: 'Announced', note: 'Announced but not yet running.' },
  paused: { label: 'Paused', note: 'The funder has paused the program.' },
  concluded: { label: 'Ended', note: 'The program has ended.' },
  unknown: { label: 'Not recorded', note: "Check the funder's site." },
} satisfies Record<Program['status'], { label: string; note: string }>;

export const APPLICATION_METHOD = { anytime: 'Any time', rounds: 'In rounds', unknown: 'Not recorded' };
export type ApplicationMethod = keyof typeof APPLICATION_METHOD;

export function factDate(value: string, monthOnly = false): string {
  if (!dateBounds(value)) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', ...(!monthOnly && value.length === 10 ? { day: 'numeric' as const } : {}),
    year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00Z`));
}

export function notedDate(value: string | undefined, today = productDateISO()): string | null {
  return value?.length === 10 && dateBounds(value) && value <= today ? value : null;
}

function deadlineFactFor(program: Program, round: Round) {
  const review = program.review;
  const fact = review?.facts?.deadline;
  if (!fact) return undefined;
  // A named scope takes precedence even when two rounds share a source URL.
  const matches = review.round_names?.length
    ? review.round_names.includes(round.name)
    : Boolean(httpUrl(round.source) && httpUrl(round.source) === httpUrl(fact.source));
  return matches ? fact : undefined;
}

export function deadlineNotedOn(program: Program, round: Round, today = productDateISO()): string | null {
  return notedDate(deadlineFactFor(program, round)?.checked_on, today)
    || (program.review?.round_names?.includes(round.name) ? notedDate(program.review.checked_on, today) : null);
}

/** Keep the clock and offset written in the source. An offset alone cannot
 * identify a named time zone, so use UTC+/-hh:mm unless the recorded text does. */
export function deadlineTime(program: Program, round: Round): string | null {
  const match = round.closes_at?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})(?::\d{2})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match || !Number.isFinite(Date.parse(round.closes_at!))) return null;
  const [, clock, offset] = match;
  if (offset === 'Z' || offset === '+00:00') return `${clock} UTC`;
  const text = deadlineFactFor(program, round)?.value || '';
  const zones: [RegExp, string, string[]][] = [
    [/\bCET\b/i, 'CET', ['+01:00']], [/\bCEST\b/i, 'CEST', ['+02:00']],
    [/\bPST\b/i, 'PST', ['-08:00']], [/\bPDT\b/i, 'PDT', ['-07:00']],
    [/\b(?:PT|Pacific)\b/i, 'PT', ['-08:00', '-07:00']],
    [/\bEST\b/i, 'EST', ['-05:00']], [/\bEDT\b/i, 'EDT', ['-04:00']],
    [/\b(?:ET|Eastern)\b/i, 'ET', ['-05:00', '-04:00']],
  ];
  const zone = zones.find(([pattern, , offsets]) => offsets.includes(offset) && pattern.test(text));
  return `${clock} ${zone?.[1] || `UTC${offset}`}`;
}

export function applicationMethod(program: Program): ApplicationMethod {
  if (program.review?.intake_mode === 'rolling' || (program.rounds || []).some(r => r.status === 'open' && !r.closes)) return 'anytime';
  if (program.review?.intake_mode === 'rounds' || (program.rounds || []).some(r => r.closes)) return 'rounds';
  return 'unknown';
}

export function programFacts(program: Program, today = productDateISO()) {
  const rounds = program.rounds || [];
  const method = applicationMethod(program);
  const firstDate = rounds.flatMap(r => [r.opens, r.closes]).filter((date): date is string => Boolean(date && dateBounds(date))).sort()[0];
  const hasDateForEveryRound = rounds.every(r => dateBounds(r.opens) || dateBounds(r.closes));
  const count = rounds.length;
  const countWord = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][count] || String(count);
  const methodNote = method === 'anytime' ? 'The funder has not published a closing date.'
    : method === 'rounds' ? `${countWord} round${count === 1 ? '' : 's'} on file${firstDate && hasDateForEveryRound ? ` since ${factDate(firstDate, true)}` : ''}.`
      : "See the funder's site.";
  const round = [...rounds].filter(r => ['open', 'announced'].includes(r.status) && r.closes
    && (dateBounds(r.closes)?.last || '') >= today)
    .sort((a, b) => a.closes!.localeCompare(b.closes!) || a.name.localeCompare(b.name))[0];
  const source = httpUrl(program.review?.source) || (program.sources || []).map(httpUrl).find(Boolean) || null;
  const methodRound = method === 'anytime'
    ? rounds.find(r => r.status === 'open' && !r.closes)
    : rounds.find(r => r.closes);
  return {
    status: { value: program.status, ...PROGRAM_STATUS[program.status], source },
    howToApply: { value: method, label: APPLICATION_METHOD[method], note: methodNote, source: httpUrl(methodRound?.source) || source },
    nextDeadline: round ? {
      round, date: round.closes!, label: factDate(round.closes!), time: deadlineTime(program, round),
      source: httpUrl(round.source), notedOn: deadlineNotedOn(program, round, today),
    } : null,
  };
}

export function roundHistoryLabel(round: Round, today = productDateISO()): string {
  if (['closed', 'reviewing', 'deployed'].includes(round.status) || (round.closes && (dateBounds(round.closes)?.last || '9999') < today)) return 'Closed';
  if (round.closes && dateBounds(round.closes)) return 'Deadline ahead';
  return 'No deadline on file';
}

export function activeProgramsByOrg(programs: Program[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const program of programs) if (program.status === 'active') counts.set(program.org, (counts.get(program.org) || 0) + 1);
  return counts;
}
