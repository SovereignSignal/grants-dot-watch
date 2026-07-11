import type { Metadata } from 'next';
import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { PageHeader, Empty, Stat } from '@/components/ui';
import { dateShort, money, WIRE_LABEL } from '@/lib/format';
import type { Award, Wire } from '@/lib/types';
import { param, hrefWith, type SearchParams, type Query } from '@/components/ledger/query';
import { FilterGroup, FilterLink, ActiveFilterLink } from '@/components/ui-filters';
import { Pager } from '@/components/ledger/pager';
import { isUsdKnown } from '@/components/browse/registry-helpers';

export const metadata: Metadata = { title: 'Awards' };

const WIRE_ORDER: Wire[] = ['crypto', 'ai', 'oss'];
const PAGE_SIZE = 100;

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
        eyebrow="THE LEDGER"
        title="Awards"
        sub="Every disclosed grant on file, funder to grantee, sourced and dated where the record allows it."
        right={
          <div className="flex gap-6">
            <Stat label="awards" value={totalCount.toLocaleString()} />
            <Stat label="known total" value={money(totalKnown)} />
          </div>
        }
      />

      <div className="mx-auto max-w-6xl space-y-2.5 px-4 pt-4 pb-5">
        {wireValues.length > 1 && (
          <FilterGroup>
            {wireValues.map((w) => (
              <FilterLink key={w} href={hrefWith('/awards', query, { wire: wireF === w ? undefined : w })} active={wireF === w}>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block size-1.5" style={{ background: `var(--color-${w})` }} />
                  {WIRE_LABEL[w]}
                </span>
              </FilterLink>
            ))}
          </FilterGroup>
        )}
        {years.length > 1 && (
          <FilterGroup>
            {years.map((y) => (
              <FilterLink key={y} href={hrefWith('/awards', query, { year: yearF === y ? undefined : y })} active={yearF === y}>
                {y === 'undated' ? 'Undated' : y}
              </FilterLink>
            ))}
          </FilterGroup>
        )}
        {(funderName || granteeName) && (
          <FilterGroup>
            {funderName && <ActiveFilterLink href={hrefWith('/awards', query, { funder: undefined })}>Funder: {funderName}</ActiveFilterLink>}
            {granteeName && <ActiveFilterLink href={hrefWith('/awards', query, { grantee: undefined })}>Grantee: {granteeName}</ActiveFilterLink>}
          </FilterGroup>
        )}
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-16">
        {pageItems.length === 0 ? (
          <Empty>No awards on file for this filter.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b-[1.5px] border-paper text-left">
                    <th className="coord py-2.5 pr-4 font-normal">Date</th>
                    <th className="coord py-2.5 pr-4 font-normal">Funder</th>
                    <th className="coord py-2.5 pr-4 font-normal" aria-hidden></th>
                    <th className="coord py-2.5 pr-4 font-normal">Grantee</th>
                    <th className="coord py-2.5 pr-4 font-normal">Program</th>
                    <th className="coord py-2.5 pr-4 text-right font-normal">Amount</th>
                    <th className="coord py-2.5 pr-4 font-normal">Wire</th>
                    <th className="coord py-2.5 pr-4 font-normal" aria-hidden></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((a) => (
                    <tr key={a.key} className="border-b border-line align-top transition-colors hover:bg-raised/40">
                      <td className="py-3 pr-4 text-[12px] whitespace-nowrap tabular-nums text-faint">{dateShort(a.date)}</td>
                      <td className="py-3 pr-4">
                        <Link href={`/orgs/${a.funder}`} className="display text-[14px] text-paper hover:text-signal">
                          {a.funder_name || a.funder}
                        </Link>
                      </td>
                      <td className="py-3 pr-2 text-faint" aria-hidden>
                        →
                      </td>
                      <td className="py-3 pr-4">
                        <Link href={`/grantees/${a.grantee}`} className="display text-[14px] font-semibold text-paper hover:text-signal">
                          {a.grantee_name || a.grantee}
                        </Link>
                      </td>
                      <td className="max-w-[15rem] truncate py-3 pr-4 text-[12.5px] text-dim" title={a.program_name || undefined}>
                        {a.program_name || '—'}
                      </td>
                      <td className="py-3 pr-4 text-right font-bold whitespace-nowrap tabular-nums text-paper">{money(a.amount, a.amount_text)}</td>
                      <td className="py-3 pr-4">
                        {a.wire ? (
                          <span
                            aria-label={WIRE_LABEL[a.wire]}
                            title={WIRE_LABEL[a.wire]}
                            className="inline-block size-2 shrink-0"
                            style={{ background: `var(--color-${a.wire})` }}
                          />
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {a.source && (
                          <a
                            href={a.source}
                            target="_blank"
                            rel="noreferrer"
                            className="border-b border-line text-[11px] text-faint hover:border-paper hover:text-paper"
                          >
                            source ↗
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
