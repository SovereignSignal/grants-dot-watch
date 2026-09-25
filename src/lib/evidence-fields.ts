export function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Month precision is preserved in the UI and expires only after that month. */
export function dateBounds(value: string | undefined): { first: string; last: string } | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(value)) return null;
  const day = value.length === 7 ? `${value}-01` : value;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  const last = value.length === 7
    ? new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    : day;
  return { first: day, last };
}
