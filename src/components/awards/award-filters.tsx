import Link from 'next/link';
import { FilterLink, FilterRow } from '@/components/ui-filters';
import { WIRE_LABEL } from '@/lib/format';
import type { AwardFilterState } from '@/lib/award-browse';
import type { Org, Wire } from '@/lib/types';

type FilterKey = 'wire' | 'year' | 'currency';

const FILTER_KEYS: FilterKey[] = ['wire', 'year', 'currency'];

function filterHref(current: AwardFilterState, key: FilterKey, value?: string): string {
  const params = new URLSearchParams();
  for (const filterKey of FILTER_KEYS) {
    if (filterKey === key) continue;
    const currentValue = current[filterKey];
    if (currentValue) params.set(filterKey, currentValue);
  }
  if (value) params.set(key, value);
  if (current.funder) params.set('funder', current.funder);
  if (current.q) params.set('q', current.q);
  const query = params.toString();
  return query ? `/awards?${query}` : '/awards';
}

function FilterOptions({
  label,
  current,
  filterKey,
  options,
}: {
  label: string;
  current: AwardFilterState;
  filterKey: FilterKey;
  options: { value: string; label: string }[];
}) {
  const active = current[filterKey];
  return (
    <FilterRow label={label}>
      <FilterLink href={filterHref(current, filterKey)} active={!active}>
        All
      </FilterLink>
      {options.map((option) => (
        <FilterLink
          key={option.value}
          href={filterHref(current, filterKey, option.value)}
          active={active === option.value}
        >
          {option.label}
        </FilterLink>
      ))}
    </FilterRow>
  );
}

export function AwardFilters({
  current,
  years,
  currencies,
  funders,
}: {
  current: AwardFilterState;
  years: string[];
  currencies: string[];
  funders: Org[];
}) {
  const hasAny = Boolean(current.q || current.wire || current.year || current.currency || current.funder);
  const wires: Wire[] = ['crypto', 'ai', 'oss'];

  return (
    <div className="mx-auto flex max-w-6xl flex-col border-b border-line px-4 pt-4 pb-4">
      <FilterOptions
        label="Wire"
        current={current}
        filterKey="wire"
        options={wires.map((wire) => ({ value: wire, label: WIRE_LABEL[wire] }))}
      />
      <FilterOptions
        label="Year"
        current={current}
        filterKey="year"
        options={years.map((year) => ({ value: year, label: year === 'undated' ? 'Undated' : year }))}
      />
      <FilterOptions
        label="Currency"
        current={current}
        filterKey="currency"
        options={currencies.map((currency) => ({
          value: currency,
          label: currency === 'unspecified' ? 'Unspecified' : currency.toUpperCase(),
        }))}
      />

      <form action="/awards" method="GET" className="grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,320px)_auto] sm:items-end">
        {current.wire && <input type="hidden" name="wire" value={current.wire} />}
        {current.year && <input type="hidden" name="year" value={current.year} />}
        {current.currency && <input type="hidden" name="currency" value={current.currency} />}
        <label className="min-w-0">
          <span className="coord mb-1 block">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={current.q || ''}
            placeholder="Recipient, funder, or program"
            className="w-full border-b border-line bg-transparent py-1 text-sm text-paper placeholder:text-faint focus:outline-none focus-visible:border-signal"
          />
        </label>
        <label className="min-w-0">
          <span className="coord mb-1 block">Funder</span>
          <select
            name="funder"
            defaultValue={current.funder || ''}
            className="w-full border border-line bg-void px-2 py-1.5 text-sm text-dim focus:outline-none focus-visible:border-signal"
          >
            <option value="">All funders</option>
            {funders.map((funder) => (
              <option key={funder.id} value={funder.id}>{funder.name}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-4 sm:pb-1">
          <button type="submit" className="coord border-b border-line pb-0.5 text-dim hover:border-paper hover:text-paper">
            Apply →
          </button>
          {hasAny && (
            <Link href="/awards" className="coord hover:text-dim">
              Clear all ✕
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
