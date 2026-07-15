import type { Metadata } from 'next';
import Link from 'next/link';
import { AwardFilters } from '@/components/awards/award-filters';
import { AwardTable } from '@/components/awards/award-table';
import { PageHeader, Empty, Stat } from '@/components/ui';
import { filterAwards, type AwardFilterState } from '@/lib/award-browse';
import { sortAwardsNewest } from '@/lib/awards';
import { paginate, paginationItems, parsePage } from '@/lib/pagination';
import { loadRegistry } from '@/lib/registry';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata: Metadata = pageMetadata(
  '/awards',
  'Awards',
  'Search sourced grant awards across crypto, AI, and open source funding programs.'
);

const PAGE_SIZE = 50;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pageHref(current: AwardFilterState, page: number): string {
  const params = new URLSearchParams();
  if (current.q) params.set('q', current.q);
  if (current.wire) params.set('wire', current.wire);
  if (current.year) params.set('year', current.year);
  if (current.currency) params.set('currency', current.currency);
  if (current.funder) params.set('funder', current.funder);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/awards?${query}` : '/awards';
}

export default async function AwardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const current: AwardFilterState = {
    q: first(sp.q),
    wire: first(sp.wire),
    year: first(sp.year),
    currency: first(sp.currency),
    funder: first(sp.funder),
  };

  const registry = loadRegistry();
  const filtered = sortAwardsNewest(filterAwards(registry.awards, current));
  const page = paginate(filtered, parsePage(first(sp.page)), PAGE_SIZE);
  const orgIds = new Set(registry.orgs.map((org) => org.id));
  const funderIds = new Set(registry.awards.map((award) => award.funder));
  const funders = registry.orgs.filter((org) => funderIds.has(org.id)).sort((a, b) => a.name.localeCompare(b.name));
  const years = [...new Set(registry.awards.map((award) => award.date?.slice(0, 4) || 'undated'))].sort((a, b) => {
    if (a === 'undated') return 1;
    if (b === 'undated') return -1;
    return b.localeCompare(a);
  });
  const currencies = [...new Set(registry.awards.map((award) => award.currency?.toLowerCase() || 'unspecified'))].sort((a, b) => {
    if (a === 'unspecified') return 1;
    if (b === 'unspecified') return -1;
    return a.localeCompare(b);
  });

  return (
    <>
      <PageHeader
        eyebrow="THE REGISTER"
        title="Awards"
        sub="Sourced grant and funding decisions, linked to recipients, funders, programs, and primary evidence."
        right={<Stat label="matching records" value={page.total.toLocaleString()} />}
      />
      <AwardFilters current={current} years={years} currencies={currencies} funders={funders} />

      <div className="mx-auto max-w-6xl px-4 pb-16">
        <div className="coord border-b border-line py-3">
          {page.total === 0
            ? 'no awards match'
            : `showing ${page.start}-${page.end} of ${page.total.toLocaleString()} · page ${page.page} of ${page.totalPages} · newest dated evidence first`}
        </div>

        {page.total === 0 ? (
          <Empty>No award records match these filters.</Empty>
        ) : (
          <>
            <AwardTable
              awards={page.items}
              programs={registry.programs}
              orgIds={orgIds}
              showFunder
              showProgram
            />
            {page.totalPages > 1 && (
              <nav aria-label="Award index pages" className="coord flex flex-wrap items-center justify-between gap-4 border-t border-line py-4">
                <Link
                  href={pageHref(current, page.page - 1)}
                  aria-disabled={page.page === 1}
                  className={page.page === 1 ? 'pointer-events-none text-faint' : 'text-dim hover:text-paper'}
                >
                  ← Previous
                </Link>
                <div className="flex flex-wrap items-center justify-center gap-1">
                  {paginationItems(page.page, page.totalPages).map((item, index) =>
                    item === 'ellipsis' ? (
                      <span key={`ellipsis-${index}`} aria-hidden className="inline-flex size-8 items-center justify-center text-faint">
                        ...
                      </span>
                    ) : (
                      <Link
                        key={item}
                        href={pageHref(current, item)}
                        aria-current={item === page.page ? 'page' : undefined}
                        className={`inline-flex size-8 items-center justify-center border transition-colors ${
                          item === page.page
                            ? 'border-paper bg-paper text-void'
                            : 'border-line text-dim hover:border-paper hover:text-paper'
                        }`}
                      >
                        {item}
                      </Link>
                    )
                  )}
                </div>
                <Link
                  href={pageHref(current, page.page + 1)}
                  aria-disabled={page.page === page.totalPages}
                  className={page.page === page.totalPages ? 'pointer-events-none text-faint' : 'text-dim hover:text-paper'}
                >
                  Next →
                </Link>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}
