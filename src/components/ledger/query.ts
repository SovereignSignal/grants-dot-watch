// Query-string helpers shared by the programs pages.
// Server components receive searchParams as a Promise<Record<string, string | string[] | undefined>>;
// these turn that into plain strings and back into Link-able hrefs, filters-first, no client JS needed.

export type SearchParams = Record<string, string | string[] | undefined>;
export type Query = Record<string, string | undefined>;

/** First value of a (possibly repeated) search param, as a plain string. */
export function param(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Build an href for `base` from `current` query state with `patch` applied.
 * Keys set to undefined/null/'' in the merged result are dropped from the URL.
 * `page` is dropped automatically unless the patch itself sets it — changing
 * a filter should always land back on page one.
 */
export function hrefWith(base: string, current: Query, patch: Query): string {
  const merged: Query = { ...current, ...patch };
  if (!('page' in patch)) delete merged.page;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  }
  const qs = usp.toString();
  return qs ? `${base}?${qs}` : base;
}
