import Link from 'next/link';
import { Empty } from '@/components/ui';
import { MECHANISM_LABEL } from '@/components/ledger/labels';
import { WIRE_COLOR } from '@/lib/format';
import type { Departure } from '@/lib/departures';
import { uniqueDeparturesByProgram } from '@/lib/departures';
import { isVerifiedRollingRound } from '@/lib/round-state';
import { isClosingSoon, monthLabel, monthYearShort } from './date-helpers';
import { RoundRow } from './round-row';

function UndatedRow({ d, status }: { d: Departure; status?: string }) {
  const wire = (d.program.wires || [])[0] || null;
  return (
    <Link
      href={`/programs/${d.program.id}`}
      className="flex items-center gap-2.5 border-b border-line py-2.5 transition-colors hover:bg-raised/40"
    >
      <span aria-hidden className="size-1.5 shrink-0" style={{ background: wire ? WIRE_COLOR[wire] : 'var(--color-line)' }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-paper">{d.program.name}</div>
        <div className="coord mt-0.5 truncate">{d.orgName}</div>
      </div>
      <div className="max-w-[45%] shrink-0 text-right">
        <div className="truncate text-[12px] font-semibold text-dim tabular-nums">{d.round.size || '–'}</div>
        <div className="coord mt-0.5">{status || MECHANISM_LABEL[d.program.mechanism || 'other'] || d.program.mechanism}</div>
      </div>
    </Link>
  );
}

/** One page of open and announced calls. The caller applies filters, global
 *  date ordering, and pagination before rendering this board. */
export function DeparturesBoard({ departures }: { departures: Departure[] }) {
  const dated = departures.filter((departure) => departure.round.closes);
  const standing = uniqueDeparturesByProgram(
    departures.filter((departure) => isVerifiedRollingRound(departure.program, departure.round))
  );
  const datesPending = uniqueDeparturesByProgram(
    departures.filter(
      (departure) => !departure.round.closes && !isVerifiedRollingRound(departure.program, departure.round)
    )
  );

  const groups: { label: string; rows: Departure[] }[] = [];
  for (const r of dated) {
    const label = monthLabel(r.round.closes!);
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) {
      g = { label, rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
  }

  return (
    <div>
      {dated.length === 0 && standing.length === 0 && datesPending.length === 0 ? (
        <Empty>No open rounds on file for this filter.</Empty>
      ) : (
        <>
          {dated.length > 0 && (
            <div className="hidden border-b-[1.5px] border-paper pb-2 pt-5 sm:grid sm:grid-cols-[72px_1fr_160px_110px_120px] sm:gap-x-5">
              <span className="coord">Closes</span>
              <span className="coord">Program</span>
              <span className="coord">Size</span>
              <span className="coord">Mechanism</span>
              <span className="coord text-right">Status</span>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.label}>
              <div className="mt-6 mb-1 flex items-center gap-3.5 first:mt-4">
                <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[.13em] text-paper">{g.label}</span>
                <span aria-hidden className="h-px flex-1 bg-line" />
              </div>
              {g.rows.map((d) => {
                const wire = (d.program.wires || [])[0] || null;
                const closingSoon = isClosingSoon(d.round.closes);
                return (
                  <RoundRow
                    key={d.key}
                    href={`/programs/${d.program.id}`}
                    day={new Date(d.round.closes! + 'T00:00:00Z').getUTCDate()}
                    monthYear={monthYearShort(d.round.closes!)}
                    closingSoon={closingSoon}
                    title={d.program.name}
                    subtitle={d.orgName}
                    size={d.round.size}
                    mechanism={MECHANISM_LABEL[d.program.mechanism || 'other'] || d.program.mechanism}
                    statusWord={closingSoon ? 'Closing' : d.round.status === 'announced' ? 'Announced' : 'Open'}
                    wireColor={wire ? WIRE_COLOR[wire] : null}
                  />
                );
              })}
            </div>
          ))}

          {datesPending.length > 0 && (
            <section className="mt-9 border-t-[2.5px] border-paper pt-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <h2 className="coord text-dim">Announced: Dates Pending</h2>
                <span className="coord">Published calls without a closing date on file</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
                {datesPending.map((d) => (
                  <UndatedRow key={d.key} d={d} status={d.round.status === 'announced' ? 'Announced' : 'No closing date'} />
                ))}
              </div>
            </section>
          )}

          <section className="mt-9 border-t-[2.5px] border-paper pt-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <h2 className="coord text-dim">Standing: No Fixed Deadline</h2>
              <span className="coord">Applications run on a rolling or continuous basis</span>
            </div>
            {standing.length === 0 ? (
              <p className="serif-statement mt-4 text-dim">No standing open calls on file for this filter.</p>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
                {standing.map((d) => (
                  <UndatedRow key={d.key} d={d} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
