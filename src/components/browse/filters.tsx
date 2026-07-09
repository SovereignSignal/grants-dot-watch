// Server-rendered filter chips + search form for /orgs. Pure links — filtering
// is server-side via searchParams, no client JS required.
import Link from 'next/link';

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

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active ? 'border-signal/60 bg-signal/10 text-paper' : 'border-line text-dim hover:border-faint hover:text-paper'
      }`}
    >
      {children}
    </Link>
  );
}

function ChipRow({
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="coord w-16 shrink-0">{label}</span>
      <Chip href={hrefFor(current, filterKey)} active={!active}>
        All
      </Chip>
      {options.map((o) => (
        <Chip key={o.value} href={hrefFor(current, filterKey, o.value)} active={active === o.value}>
          {o.label}
        </Chip>
      ))}
    </div>
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
  return (
    <div className="mx-auto max-w-6xl px-4 pb-4 flex flex-col gap-2">
      <ChipRow label="ROLE" current={current} filterKey="role" options={roleOptions} />
      <ChipRow label="WIRE" current={current} filterKey="wire" options={wireOptions} />
      <ChipRow label="SYSTEM" current={current} filterKey="system" options={systemOptions} />
      <ChipRow label="STATUS" current={current} filterKey="status" options={statusOptions} />
      <form action="/orgs" method="GET" className="flex items-center gap-2 pt-1">
        {current.role && <input type="hidden" name="role" value={current.role} />}
        {current.wire && <input type="hidden" name="wire" value={current.wire} />}
        {current.system && <input type="hidden" name="system" value={current.system} />}
        {current.status && <input type="hidden" name="status" value={current.status} />}
        <span className="coord w-16 shrink-0">SEARCH</span>
        <input
          type="text"
          name="q"
          defaultValue={current.q || ''}
          placeholder="Name or alias…"
          className="w-full max-w-xs rounded-md border border-line bg-surface px-2.5 py-1 text-sm text-paper placeholder:text-faint focus:outline-none focus-visible:outline-2 focus-visible:outline-signal"
        />
        <button
          type="submit"
          className="rounded-md border border-line px-2.5 py-1 text-xs text-dim hover:border-faint hover:text-paper transition-colors"
        >
          Search
        </button>
        {(current.q || current.role || current.wire || current.system || current.status) && (
          <Link href="/orgs" className="coord hover:text-dim">
            Clear all
          </Link>
        )}
      </form>
    </div>
  );
}
