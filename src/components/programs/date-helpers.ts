// Date arithmetic shared by the Departures board, the Cadence chart, and the
// program detail page's rounds list. Kept local to this lane (src/app/programs/**
// and src/components/programs/**) rather than in src/lib/format.ts, which is
// shared by pages outside this phase's scope.
import { MONTHS_LONG } from '@/lib/format';

/** Days from now until `date` (end-of-day UTC), or null if undated. Negative
 *  once the date has passed. */
export function daysUntil(date: string | undefined | null): number | null {
  if (!date) return null;
  const d = new Date(date + 'T23:59:59Z').getTime() - Date.now();
  return Math.ceil(d / 86_400_000);
}

/** The "gold treatment" rule: a dated close inside the next 14 days. */
export function isClosingSoon(date: string | undefined | null): boolean {
  const days = daysUntil(date);
  return days !== null && days >= 0 && days <= 14;
}

/** "July 2026" from a YYYY-MM-DD — used for the departures board's month-rule
 *  section breaks. */
export function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return `${MONTHS_LONG[+m - 1]} ${y}`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jul 15" from a YYYY-MM-DD — a shorter form than lib/format's dateShort,
 *  for cadence captions where the year is already established by the chart.
 *  A source date can carry only month precision (YYYY-MM, no day) — that
 *  never fabricates a day-of-month, it just drops to "Jul". */
export function monthDayShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return d ? `${MONTHS_SHORT[+m - 1]} ${+d}` : MONTHS_SHORT[+m - 1];
}

/** "Jul 2026" from a YYYY-MM-DD — the departures row's small month/year line
 *  beneath the big day number. */
export function monthYearShort(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return `${MONTHS_SHORT[+m - 1]} ${y}`;
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** Today as a YYYY-MM-DD string, computed at render (server) time — the
 *  "today-rule" the cadence chart plots against. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** True if `dateStr` (YYYY-MM-DD) is strictly before `todayStr` — used to
 *  fade past rounds on the cadence chart. Lexical comparison is safe: both
 *  are ISO-formatted. */
export function isPast(dateStr: string, todayStr: string): boolean {
  return dateStr < todayStr;
}

/** Percent position (0-100) of `dateStr` along a Jan 1 – Dec 31 axis for
 *  `year`. Returns null when the date falls outside that year — the caller
 *  treats those rounds as unplottable this year (they fall back to the
 *  "rolling — by engagement" band). */
export function yearPercent(dateStr: string | undefined | null, year: number): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || y !== year || !m) return null;
  const start = Date.UTC(year, 0, 1);
  const t = Date.UTC(y, m - 1, d || 1);
  const dayOffset = Math.round((t - start) / 86_400_000);
  return (dayOffset / daysInYear(year)) * 100;
}

/** Percent tick position for the first of `monthIndex` (0 = Jan) in `year` —
 *  the cadence chart's month grid uses this for both ticks and gridlines. */
export function monthTickPercent(monthIndex: number, year: number): number {
  const start = Date.UTC(year, 0, 1);
  const t = Date.UTC(year, monthIndex, 1);
  return (Math.round((t - start) / 86_400_000) / daysInYear(year)) * 100;
}
