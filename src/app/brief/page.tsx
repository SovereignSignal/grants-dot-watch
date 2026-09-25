import type { Metadata } from 'next';
import Link from 'next/link';
import { monthLabel } from '@/components/programs/date-helpers';
import { Empty, PageHeader } from '@/components/ui';
import { dateShort, WIRE_LABEL } from '@/lib/format';
import { briefingBoard, type LiveBoardRow } from '@/lib/public-api';
import { pageMetadata } from '@/lib/site-metadata';
import type { Wire } from '@/lib/types';

export const metadata: Metadata = pageMetadata(
  '/brief',
  'Briefing',
  'Recorded calls and application routes from the registry.'
);

const WIRES: Wire[] = ['crypto', 'ai', 'oss'];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function briefHref(wire?: string): string {
  return wire ? `/brief?wire=${wire}` : '/brief';
}

function wireDot(wire: string | null | undefined) {
  return (
    <span
      aria-hidden
      className="mt-[6px] size-1.5 shrink-0"
      style={{ background: wire ? `var(--color-${wire})` : 'var(--color-line)' }}
    />
  );
}

function ApplyCell({ row }: { row: LiveBoardRow }) {
  if (row.apply_url) {
    return (
      <a
        href={row.apply_url}
        target="_blank"
        rel="noreferrer"
        className="border-b border-line text-[12px] font-bold text-paper hover:border-paper"
      >
        Apply
      </a>
    );
  }
  return <span className="text-[12px] text-faint">No form</span>;
}

function StandingRow({ row }: { row: LiveBoardRow }) {
  const wire = row.wires[0] || null;
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-x-4 border-b border-line py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        {wireDot(wire)}
        <div className="min-w-0">
          <Link href={row.href} className="block truncate text-sm text-paper hover:text-signal">
            {row.program_name}
          </Link>
          <div className="coord mt-0.5 truncate">{row.org_name}</div>
        </div>
      </div>
      <div className="pt-0.5 text-right">
        <ApplyCell row={row} />
      </div>
    </div>
  );
}

export default async function BriefPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const wireParam = first(sp.wire);
  const wire = WIRES.includes(wireParam as Wire) ? (wireParam as Wire) : undefined;
  const board = briefingBoard({ wire });
  const openApiHref = wire ? `/api/v1/open?wire=${wire}` : '/api/v1/open';

  const groups: { label: string; rows: LiveBoardRow[] }[] = [];
  for (const row of board.dated) {
    const label = monthLabel(row.round.closes!);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { label, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }

  const empty = board.total === 0;

  return (
    <>
      <PageHeader
        eyebrow="PROGRAM ROUNDS"
        title="Briefing"
        sub="Recorded calls with published deadlines, undated application routes and announcements. Each program page has its status, application method and source."
        right={
          <div className="text-right">
            <div className="serif-statement text-[34px] leading-none tabular-nums text-paper">{board.total}</div>
            <div className="coord mt-1">current round records</div>
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-4 pb-16">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-4">
          <Link
            href={briefHref()}
            className={`coord ${wire ? 'text-dim hover:text-paper' : 'border-b border-paper text-paper'}`}
            aria-current={!wire ? 'page' : undefined}
          >
            All wires
          </Link>
          {WIRES.map((item) => (
            <Link
              key={item}
              href={briefHref(item)}
              className={`coord inline-flex items-center gap-1.5 ${wire === item ? 'border-b border-paper text-paper' : 'text-dim hover:text-paper'}`}
              aria-current={wire === item ? 'page' : undefined}
            >
              <span aria-hidden className="inline-block size-1.5" style={{ background: `var(--color-${item})` }} />
              {WIRE_LABEL[item]}
            </Link>
          ))}
          <a href={openApiHref} className="coord text-dim hover:text-paper">
            JSON →
          </a>
          <Link href="/query" className="coord text-dim hover:text-paper">
            How to query →
          </Link>
        </div>

        {empty ? (
          <Empty>No current round records on file for this filter.</Empty>
        ) : (
          <>
            <section id="dated" className="pt-8">
              <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
                <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Dated calls</h2>
                <span className="coord shrink-0">
                  {board.dated.length === 0
                    ? 'none on this filter'
                    : `${board.dated.length.toLocaleString()} with a published close`}
                </span>
              </div>
              <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-dim">
                These have a published close. Past closes are not on this list.
              </p>

              {board.dated.length === 0 ? (
                <p className="serif-statement mt-6 text-dim">No dated calls on this filter.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.label}>
                    <div className="mt-6 mb-1 flex items-center gap-3.5 first:mt-5">
                      <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[.13em] text-paper">
                        {group.label}
                      </span>
                      <span aria-hidden className="h-px flex-1 bg-line" />
                    </div>
                    {group.rows.map((row) => {
                      const rowWire = row.wires[0] || null;
                      return (
                        <div
                          key={`${row.program_id}::${row.round.name}`}
                          className="grid grid-cols-[52px_1fr] items-start gap-x-4 gap-y-1 border-b border-line py-3 sm:grid-cols-[68px_1fr_140px_72px_92px] sm:items-center sm:gap-x-5"
                        >
                          <div
                            className="serif-statement text-[26px] leading-none not-italic tabular-nums text-paper"
                          >
                            {new Date(row.round.closes! + 'T00:00:00Z').getUTCDate()}
                          </div>
                          <div className="flex min-w-0 items-start gap-2.5">
                            {wireDot(rowWire)}
                            <div className="min-w-0">
                              <Link href={row.href} className="display block text-[15.5px] leading-tight text-paper hover:text-signal">
                                {row.program_name}
                              </Link>
                              <div className="coord mt-0.5 truncate">{row.org_name}</div>
                            </div>
                          </div>
                          <div className="col-span-2 text-[12.5px] leading-snug text-dim tabular-nums sm:col-span-1">
                            {row.round.size || 'Not stated'}
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <ApplyCell row={row} />
                          </div>
                          <div className="col-span-2 sm:col-span-1 sm:text-right">
                            <span className="text-[12px] font-bold text-paper">
                              Deadline ahead
                            </span>
                            <div className="coord mt-0.5 hidden sm:block">{dateShort(row.round.closes)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </section>

            <section id="standing" className="mt-12 border-t-[2.5px] border-paper pt-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">No published closing date</h2>
                <span className="coord">
                  {board.standingOpen.length === 0
                    ? 'none on this filter'
                    : `${board.standingOpen.length.toLocaleString()} with no published deadline`}
                </span>
              </div>
              <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-dim">
                These records have an application link and no published closing date. See each program page for its application method and source.
              </p>
              {board.standingOpen.length === 0 ? (
                <p className="serif-statement mt-6 text-dim">No undated application routes on this filter.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
                  {board.standingOpen.map((row) => (
                    <StandingRow key={`${row.program_id}::${row.round.name}`} row={row} />
                  ))}
                </div>
              )}
            </section>

            <section id="announced" className="mt-12 border-t-[2.5px] border-paper pt-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Announcements without a closing date</h2>
                <span className="coord">
                  {board.standingAnnounced.length === 0
                    ? 'none on this filter'
                    : `${board.standingAnnounced.length.toLocaleString()} announced round records`}
                </span>
              </div>
              <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-dim">
                These announcements have no closing date on file. See each program page for the recorded facts.
              </p>
              {board.standingAnnounced.length === 0 ? (
                <p className="serif-statement mt-6 text-dim">No undated announcements on this filter.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
                  {board.standingAnnounced.map((row) => (
                    <StandingRow key={`${row.program_id}::${row.round.name}`} row={row} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
