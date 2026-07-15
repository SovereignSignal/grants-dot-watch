import Link from 'next/link';
import { dateShort } from '@/lib/format';
import { paginate, paginationItems } from '@/lib/pagination';
import { awardAmountLabel, sortAwardsNewest } from '@/lib/awards';
import type { Award, Program } from '@/lib/types';

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
  const programById = new Map(programs.map((program) => [program.id, program]));

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

          <div
            className={`hidden border-b border-line py-2 sm:grid sm:gap-x-5 ${
              showProgram ? 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_120px_72px]' : 'sm:grid-cols-[minmax(0,1fr)_120px_120px_72px]'
            }`}
          >
            <span className="coord">Recipient</span>
            {showProgram && <span className="coord">Program</span>}
            <span className="coord text-right">Amount</span>
            <span className="coord text-right">Date</span>
            <span className="coord text-right">Evidence</span>
          </div>

          <ol className="m-0 list-none p-0">
            {page.items.map((award) => {
              const program = award.program ? programById.get(award.program) : null;
              const programLabel = program?.name || award.program_name;
              const recipient = orgIds.has(award.grantee) ? (
                <Link href={`/orgs/${award.grantee}`} className="display text-[15px] text-paper hover:text-signal">
                  {award.grantee_name}
                </Link>
              ) : (
                <span className="display text-[15px] text-paper">{award.grantee_name}</span>
              );

              return (
                <li
                  key={award.key}
                  className={`grid gap-x-5 gap-y-1 border-b border-line py-3 sm:items-baseline ${
                    showProgram
                      ? 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_120px_72px]'
                      : 'sm:grid-cols-[minmax(0,1fr)_120px_120px_72px]'
                  }`}
                >
                  <div className="min-w-0 break-words">{recipient}</div>
                  {showProgram && (
                    <div className="min-w-0 text-[12px] leading-snug text-dim break-words">
                      {program ? (
                        <Link href={`/programs/${program.id}`} className="hover:text-paper">
                          {program.name}
                        </Link>
                      ) : (
                        programLabel || <span className="text-faint">Unspecified</span>
                      )}
                    </div>
                  )}
                  <div className="text-[12px] tabular-nums text-dim sm:text-right">
                    <span className="coord mr-2 sm:hidden">Amount</span>
                    {awardAmountLabel(award)}
                  </div>
                  <div className="text-[12px] tabular-nums text-faint sm:text-right">
                    <span className="coord mr-2 sm:hidden">Date</span>
                    {dateShort(award.date)}
                  </div>
                  <div className="text-[12px] sm:text-right">
                    {award.source ? (
                      <a
                        href={award.source}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Source for ${award.grantee_name} award`}
                        className="text-dim hover:text-paper"
                      >
                        Source ↗
                      </a>
                    ) : (
                      <span className="text-faint">–</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {page.totalPages > 1 && (
            <nav aria-label="Award pages" className="coord flex flex-wrap items-center justify-between gap-4 border-t border-line py-4">
              <Link
                href={awardPageHref(basePath, page.page - 1)}
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
              <Link
                href={awardPageHref(basePath, page.page + 1)}
                aria-disabled={page.page === page.totalPages}
                className={page.page === page.totalPages ? 'pointer-events-none text-faint' : 'text-dim hover:text-paper'}
              >
                Next →
              </Link>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
