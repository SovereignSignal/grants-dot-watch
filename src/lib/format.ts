import type { Wire } from './types';
import { PRODUCT_TIME_ZONE } from './round-state';

/** Shown where the registry has no value for a field. */
export const NOT_RECORDED = 'Not recorded';

export function money(n: number | null | undefined, text?: string | null): string {
  if (n == null || n === 0) return text || NOT_RECORDED;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export function dateShort(d: string | null | undefined): string {
  if (!d) return NOT_RECORDED;
  const [y, m, day] = d.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!m) return y;
  return day ? `${months[+m - 1]} ${+day}, ${y}` : `${months[+m - 1]} ${y}`;
}

export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type CalendarDateParts = { year: number; month: number; day: number };

const PRODUCT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PRODUCT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function calendarDateParts(value: string): CalendarDateParts | null {
  const plainDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plainDate) {
    const year = Number(plainDate[1]);
    const month = Number(plainDate[2]);
    const day = Number(plainDate[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() !== month - 1
      || parsed.getUTCDate() !== day
    ) return null;
    return { year, month, day };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Map(
    PRODUCT_DATE_FORMATTER.formatToParts(parsed).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.get('year')),
    month: Number(parts.get('month')),
    day: Number(parts.get('day')),
  };
}

/** Masthead byline date — takes any parseable date string (a plain
 *  YYYY-MM-DD or a full ISO timestamp like registry.loadedAt) and renders
 *  "July 10, 2026". */
export function dateLong(d: string | null | undefined): string {
  if (!d) return NOT_RECORDED;
  const parts = calendarDateParts(d);
  if (!parts) return NOT_RECORDED;
  return `${MONTHS_LONG[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

/** Masthead edition code — "2026.07.10" from the same kind of input as
 *  dateLong(). */
export function editionCode(d: string | null | undefined): string {
  if (!d) return NOT_RECORDED;
  const parts = calendarDateParts(d);
  if (!parts) return NOT_RECORDED;
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}.${month}.${day}`;
}

export const WIRE_LABEL: Record<Wire, string> = { crypto: 'Crypto', ai: 'AI', oss: 'Open Source' };
export const WIRE_COLOR: Record<Wire, string> = {
  crypto: 'var(--color-crypto)',
  ai: 'var(--color-ai)',
  oss: 'var(--color-oss)',
};

export const ROUND_STATUS_LABEL: Record<string, string> = {
  announced: 'Announced',
  open: 'Open',
  reviewing: 'In review',
  closed: 'Closed',
  deployed: 'Deployed',
  withdrawn: 'Withdrawn',
  duplicate: 'Duplicate',
};
