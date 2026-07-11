// Server-rendered filter row + search form for /orgs. Pure links: filtering
// is server-side via searchParams, no client JS required. The filter words
// themselves are the shared src/components/ui-filters.tsx primitive.
import Link from 'next/link';
import { FilterRow, FilterLink } from '@/components/ui-filters';

export type OrgFilterKey = 'role' | 'wire' | 'system' | 'status';

export interface OrgFilterState {
  role?: string;
  wire?: string;
  system?: string;
  status?: string;
  q?: string;
}

const KEYS: OrgFilterKey[] = ['role', 'wire', 'system', 'status'];

function hrefFor(current: OrgFilterState, key: OrgFilterKey, value?: string): string {
  const params = new URLSearchParams();
  for (const k of KEYS) {
    if (k === key) continue;
    const v = current[k];
    if (v) params.set(k, v);
  }
  if (value) params.set(key, value);
  if (current.q) params.set('q', current.q);
  const qs = params.toString();
  return qs ? `/orgs?${qs}` : '/orgs';
}

function OrgChipRow({
  label,
  current,
  filterKey,
  options,
}: {
  label: string;
  current: OrgFilterState;
  filterKey: OrgFilterKey;
  options: { value: string; label: string }[];
}) {
  if (options.length === 0) return null;
  const active = current[filterKey];
  return (
    <FilterRow label={label}>
      <FilterLink href={hrefFor(current, filterKey)} active={!active}>
        All
      </FilterLink>
      {options.map((o) => (
        <FilterLink key={o.value} href={hrefFor(current, filterKey, o.value)} active={active === o.value}>
          {o.label}
        </FilterLink>
      ))}
    </FilterRow>
  );
}

export function OrgFilterBar({
  current,
  roleOptions,
  wireOptions,
  systemOptions,
  statusOptions,
}: {
  current: OrgFilterState;
  roleOptions: { value: string; label: string }[];
  wireOptions: { value: string; label: string }[];
  systemOptions: { value: string; label: string }[];
  statusOptions: { value: string; label: string }[];
}) {
  const hasAny = Boolean(current.q || current.role || current.wire || current.system || current.status);
  return (
    <div className="mx-auto flex max-w-6xl flex-col border-b border-line px-4 pt-4 pb-4">
      <OrgChipRow label="Role" current={current} filterKey="role" options={roleOptions} />
      <OrgChipRow label="Wire" current={current} filterKey="wire" options={wireOptions} />
      <OrgChipRow label="System" current={current} filterKey="system" options={systemOptions} />
      <OrgChipRow label="Status" current={current} filterKey="status" options={statusOptions} />
      <form action="/orgs" method="GET" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3">
        {current.role && <input type="hidden" name="role" value={current.role} />}
        {current.wire && <input type="hidden" name="wire" value={current.wire} />}
        {current.system && <input type="hidden" name="system" value={current.system} />}
        {current.status && <input type="hidden" name="status" value={current.status} />}
        <span className="coord w-[92px] shrink-0 text-faint">Search</span>
        <input
          type="text"
          name="q"
          defaultValue={current.q || ''}
          placeholder="Name or alias…"
          className="w-full max-w-xs border-b border-line bg-transparent py-0.5 text-sm text-paper placeholder:text-faint focus:outline-none focus-visible:border-signal"
        />
        <button type="submit" className="coord border-b border-line pb-0.5 text-dim transition-colors hover:border-paper hover:text-paper">
          Search →
        </button>
        {hasAny && (
          <Link href="/orgs" className="coord hover:text-dim">
            Clear all ✕
          </Link>
        )}
      </form>
    </div>
  );
}
