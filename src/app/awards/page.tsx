import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { PageHeader, Empty, Stat } from '@/components/ui';
import { dateShort, money, WIRE_LABEL } from '@/lib/format';
import type { Award, Wire } from '@/lib/types';
import { param, hrefWith, type SearchParams, type Query } from '@/components/ledger/query';
import { ChipRow, FilterChip, ActiveFilterChip } from '@/components/ledger/chip';
import { Pager } from '@/components/ledger/pager';

const WIRE_ORDER: Wire[] = ['crypto', 'ai', 'oss'];
const PAGE_SIZE = 100;

function isUsdKnown(a: Award): boolean {
  return Boolean(a.amount) && (!a.currency || a.currency.toUpperCase() === 'USD');
}

export default async function AwardsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const wireF = param(sp, 'wire');
  const funderF = param(sp, 'funder');
  const grantF = param(sp, 'grantee');
  const yearF = param(sp, 'year');
  const pageParam = Number(param(sp, 'page') || '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  const { awards, orgs, grantees } = loadRegistry();
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const granteeBySlug = new Map(grantees.map((g) => [g.slug, g]));

  let filtered = awards;
  if (wireF) filtered = filtered.filter((a) => a.wire === wireF);
  if (funderF) filtered = filtered.filter((a) => a.funder === funderF);
  if (grantF) filtered = filtered.filter((a) => a.grantee === grantF);
  if (yearF) filtered = filtered.filter((a) => (yearF === 'undated' ? !a.date : (a.date || '').slice(0, 4) === yearF));

  const sorted = [...filtered].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  const totalCount = sorted.length;
  const totalKnown = sorted.reduce((n, a) => n + (isUsdKnown(a) ? a.amount! : 0), 0);
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageItems = sorted.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  const query: Query = { wire: wireF, funder: funderF, grantee: grantF, year: yearF };
  const wireValues = WIRE_ORDER.filter((w) => awards.some((a) => a.wire === w));
  const years = [...new Set(awards.map((a) => (a.date ? a.date.slice(0, 4) : 'undated')))].sort((a, b) => {
    if (a === 'undated') return 1;
    if (b === 'undated') return -1;
    return b.localeCompare(a);
  });

  const funderName = funderF ? orgById.get(funderF)?.name || funderF : null;
  const granteeName = grantF ? granteeBySlug.get(grantF)?.name || grantF : null;

  return (
    <>
      <PageHeader
        eyebrow="CAPITAL IN MOTION"
        title="Awards"
        right={
          <div className="flex gap-6">
            <Stat label="awards" value={totalCount.toLocaleString()} />
            <Stat label="known total" value={money(totalKnown)} />
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-4 space-y-3 pb-6">
        {wireValues.length > 1 && (
          <ChipRow>
            {wireValues.map((w) => (
              <FilterChip key={w} href={hrefWith('/awards', query, { wire: wireF === w ? undefined : w })} active={wireF === w}>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: `var(--color-${w})` }} />
                  {WIRE_LABEL[w]}
                </span>
              </FilterChip>
            ))}
          </ChipRow>
        )}
        {years.length > 1 && (
          <ChipRow>
            {years.map((y) => (
              <FilterChip key={y} href={hrefWith('/awards', query, { year: yearF === y ? undefined : y })} active={yearF === y}>
                {y === 'undated' ? 'Undated' : y}
              </FilterChip>
            ))}
          </ChipRow>
        )}
        {(funderName || granteeName) && (
          <ChipRow>
            {funderName && <ActiveFilterChip href={hrefWith('/awards', query, { funder: undefined })}>Funder: {funderName}</ActiveFilterChip>}
            {granteeName && <ActiveFilterChip href={hrefWith('/awards', query, { grantee: undefined })}>Grantee: {granteeName}</ActiveFilterChip>}
          </ChipRow>
        )}
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-16">
        {pageItems.length === 0 ? (
          <Empty>No awards on file for this filter.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="coord px-3 py-2 font-normal">Date</th>
                    <th className="coord px-3 py-2 font-normal">Funder</th>
                    <th className="coord px-3 py-2 font-normal" aria-hidden></th>
                    <th className="coord px-3 py-2 font-normal">Grantee</th>
                    <th className="coord px-3 py-2 font-normal text-right">Amount</th>
                    <th className="coord px-3 py-2 font-normal">Program</th>
                    <th className="coord px-3 py-2 font-normal">Wire</th>
                    <th className="coord px-3 py-2 font-normal" aria-hidden></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((a) => (
                    <tr key={a.key} className="border-b border-line last:border-0 align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-dim">{dateShort(a.date)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/orgs/${a.funder}`} className="hover:text-signal">
                          {a.funder_name || a.funder}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-faint" aria-hidden>
                        →
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/grantees/${a.grantee}`} className="hover:text-signal">
                          {a.grantee_name || a.grantee}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{money(a.amount, a.amount_text)}</td>
                      <td className="max-w-[16rem] truncate px-3 py-2 text-dim" title={a.program_name || undefined}>
                        {a.program_name || '—'}
                      </td>
                      <td className="px-3 py-2">
                        {a.wire ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-dim">
                            <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: `var(--color-${a.wire})` }} />
                            {WIRE_LABEL[a.wire]}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {a.source && (
                          <a href={a.source} target="_blank" rel="noreferrer" className="text-dim hover:text-paper">
                            ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager base="/awards" query={query} page={clampedPage} pageCount={pageCount} />
          </>
        )}
      </div>
    </>
  );
}
