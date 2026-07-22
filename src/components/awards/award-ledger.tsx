import Link from 'next/link';
import { paginate, paginationItems } from '@/lib/pagination';
import { sortAwardsNewest } from '@/lib/awards';
import type { Award, Program } from '@/lib/types';
import { AwardTable } from './award-table';

const PAGE_SIZE = 25;

function awardPageHref(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?awardPage=${page}#awards` : `${basePath}#awards`;
}

export function AwardLedger({
  awards,
  requestedPage,
  basePath,
  programs,
  orgIds,
  showProgram,
}: {
  awards: Award[];
  requestedPage: number;
  basePath: string;
  programs: Program[];
  orgIds: Set<string>;
  showProgram: boolean;
}) {
  const page = paginate(sortAwardsNewest(awards), requestedPage, PAGE_SIZE);

  return (
    <section id="awards" className="mt-10 scroll-mt-44">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-[1.5px] border-paper pb-2">
        <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Awards</h2>
        <span className="coord shrink-0">
          {page.total === 0 ? 'none linked' : `${page.total.toLocaleString()} on file`}
        </span>
      </div>

      {page.total === 0 ? (
        <p className="serif-statement py-8 text-center text-[16px] text-dim">No award records linked to this profile yet.</p>
      ) : (
        <>
          <div className="coord border-b border-line py-2.5">
            Showing {page.start}-{page.end} of {page.total.toLocaleString()}, newest dated evidence first
          </div>

          <AwardTable awards={page.items} programs={programs} orgIds={orgIds} showProgram={showProgram} />

          {page.totalPages > 1 && (
            <nav aria-label="Award pages" className="coord flex flex-wrap items-center justify-between gap-4 border-t border-line py-4">
              {page.page > 1 ? (
                <Link href={awardPageHref(basePath, page.page - 1)} className="text-dim hover:text-paper">
                  ← Previous
                </Link>
              ) : (
                <span aria-disabled="true" className="text-faint">← Previous</span>
              )}
              <div className="flex flex-wrap items-center justify-center gap-1">
                {paginationItems(page.page, page.totalPages).map((item, index) =>
                  item === 'ellipsis' ? (
                    <span key={`ellipsis-${index}`} aria-hidden className="inline-flex size-8 items-center justify-center text-faint">
                      ...
                    </span>
                  ) : (
                    <Link
                      key={item}
                      href={awardPageHref(basePath, item)}
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
              {page.page < page.totalPages ? (
                <Link href={awardPageHref(basePath, page.page + 1)} className="text-dim hover:text-paper">
                  Next →
                </Link>
              ) : (
                <span aria-disabled="true" className="text-faint">Next →</span>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
