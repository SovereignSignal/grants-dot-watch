import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { Empty } from '@/components/ui';
import { LatestAwards } from '@/components/browse/latest-awards';
import { MONTHS_LONG } from '@/lib/format';
import { sortAwardsNewest } from '@/lib/awards';
import type { Departure } from '@/lib/departures';
import { collectCurrentDepartures, uniqueDeparturesByProgram } from '@/lib/departures';
import { isVerifiedRollingRound } from '@/lib/round-state';
import { daysUntil } from '@/components/programs/date-helpers';

const DATED_PREVIEW = 8;
const STANDING_PREVIEW = 10;
const AWARD_PREVIEW = 5;

function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return `${MONTHS_LONG[+m - 1]} ${y}`;
}

function wireDot(wire: string | null | undefined) {
  return <span aria-hidden className="mt-[6px] size-1.5 shrink-0" style={{ background: wire ? `var(--color-${wire})` : 'var(--color-line)' }} />;
}

export default function Home() {
  const { orgs, programs, awards, counts } = loadRegistry();

  const openRounds = collectCurrentDepartures(programs, orgs);
  const dated = openRounds.filter((r) => r.round.closes);
  const standing = uniqueDeparturesByProgram(
    openRounds.filter((r) => isVerifiedRollingRound(r.program, r.round))
  );
  const standingPreview = standing.slice(0, STANDING_PREVIEW);
  const departures = dated.slice(0, DATED_PREVIEW);
  const latestAwards = sortAwardsNewest(awards).slice(0, AWARD_PREVIEW);
  const orgIds = new Set(orgs.map((org) => org.id));

  const groups: { label: string; rows: Departure[] }[] = [];
  for (const r of departures) {
    const label = monthLabel(r.round.closes!);
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) {
      g = { label, rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
  }

  const REGISTER: { href: string; label: string; n: number }[] = [
    { href: '/systems', label: 'Systems', n: counts.systems },
    { href: '/orgs', label: 'Organizations', n: counts.orgs },
    { href: '/programs', label: 'Programs', n: counts.programs },
    { href: '/awards', label: 'Awards', n: counts.awards },
  ];

  return (
    <>
      <section className="mx-auto max-w-6xl border-b border-line px-4 pt-8 pb-7">
        <div className="coord mb-2.5">Grant funding across crypto, AI, and open source</div>
        <h1 className="serif-statement max-w-4xl text-[26px] leading-[1.26] text-paper md:text-[34px]">
          Funders, programs, and the open rounds they run,{' '}
          <em className="border-b border-paper not-italic">tracked in one register, sourced in the open.</em>
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-dim">
          grants.watch indexes funding systems: ecosystems with their own treasury, like Ethereum or Cardano. It
          tracks the funders and programs inside each one, across three wires of capital: crypto, AI, and open
          source. Every figure links back to a primary source.
        </p>
      </section>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-11 gap-y-10 px-4 py-9 lg:grid-cols-[1fr_300px]">
        <section className="min-w-0">
          <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
            <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Departures: What Closes Next</h2>
            <span className="coord shrink-0">
              {dated.length === 0
                ? 'no dated calls'
                : `${departures.length} of ${dated.length.toLocaleString()} dated calls`}
            </span>
          </div>

          {departures.length === 0 && standing.length === 0 ? (
            <Empty>No open funding rounds on file right now. New rounds are added continuously.</Empty>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.label}>
                  <div className="mt-4 mb-1 flex items-center gap-3.5 first:mt-3.5">
                    <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[.13em] text-paper">
                      {g.label}
                    </span>
                    <span aria-hidden className="h-px flex-1 bg-line" />
                  </div>
                  {g.rows.map((r) => {
                    const wire = (r.program.wires || [])[0] || null;
                    const days = daysUntil(r.round.closes);
                    const closingSoon = days !== null && days >= 0 && days <= 14;
                    return (
                      <Link
                        key={r.key}
                        href={`/programs/${r.program.id}`}
                        className="grid grid-cols-[52px_1fr] items-start gap-x-4 gap-y-1 border-b border-line py-3 transition-colors hover:bg-raised/40 sm:grid-cols-[68px_1fr_150px_92px] sm:items-center sm:gap-x-5"
                      >
                        <div className={`serif-statement text-[26px] leading-none not-italic tabular-nums ${closingSoon ? 'text-closing' : 'text-paper'}`}>
                          {new Date(r.round.closes! + 'T00:00:00Z').getUTCDate()}
                        </div>
                        <div className="flex min-w-0 items-start gap-2.5">
                          {wireDot(wire)}
                          <div className="min-w-0">
                            <div className="display text-[15.5px] leading-tight text-paper">{r.program.name}</div>
                            <div className="coord mt-0.5 truncate">{r.orgName}</div>
                          </div>
                        </div>
                        <div className="col-span-2 text-[12.5px] leading-snug text-dim tabular-nums sm:col-span-1">
                          {r.round.size || '–'}
                        </div>
                        <div className="col-span-2 sm:col-span-1 sm:text-right">
                          <span className={`text-[12px] font-bold ${closingSoon ? 'text-closing' : 'text-paper'}`}>
                            {closingSoon ? 'Closing' : r.round.status === 'announced' ? 'Announced' : 'Open'}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ))}
              <div className="mt-3 border-t border-line pt-3 text-xs text-faint">
                Programs board, in full, ordered by close:{' '}
                <Link href="/programs" className="border-b border-line font-semibold text-dim hover:border-paper hover:text-paper">
                  see all {counts.programs.toLocaleString()} →
                </Link>
              </div>
            </>
          )}
        </section>

        <aside className="min-w-0 lg:border-l lg:border-line lg:pl-11">
          <LatestAwards awards={latestAwards} total={counts.awards} orgIds={orgIds} />

          <div className="mt-10">
            <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
              <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">The Register</h2>
              <span className="coord shrink-0">4 measures</span>
            </div>
            <div className="flex flex-col">
              {REGISTER.map((r) => (
                <Link
                  key={r.href}
                  href={r.href}
                  className="group flex items-baseline justify-between gap-4 border-b border-line py-6 first:pt-5"
                >
                  <div>
                    <div className="serif-statement text-[40px] leading-none tabular-nums text-paper">{r.n.toLocaleString()}</div>
                    <div className="coord mt-2">{r.label}</div>
                  </div>
                  <div className="coord shrink-0 border-b border-line pb-0.5 text-dim group-hover:border-paper group-hover:text-paper">
                    Browse →
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <section className="mx-auto max-w-6xl border-t-[2.5px] border-paper px-4 pt-5 pb-12">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <h2 className="coord text-dim">Standing: No Fixed Deadline</h2>
          <span className="coord">Applications run on a rolling or continuous basis</span>
        </div>
        {standing.length === 0 ? (
          <p className="serif-statement mt-4 text-dim">No standing open calls on file.</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
              {standingPreview.map((r) => {
                const wire = (r.program.wires || [])[0] || null;
                return (
                  <Link
                    key={r.key}
                    href={`/programs/${r.program.id}`}
                    className="flex items-start gap-2.5 border-b border-line py-2.5 transition-colors hover:bg-raised/40"
                  >
                    <span aria-hidden className="mt-[6px] size-1.5 shrink-0" style={{ background: wire ? `var(--color-${wire})` : 'var(--color-line)' }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-paper">{r.program.name}</div>
                      <div className="coord mt-0.5 truncate">{r.orgName}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
            {standing.length > standingPreview.length && (
              <div className="mt-3 text-xs text-faint">
                {standingPreview.length} of {standing.length} standing calls shown.{' '}
                <Link href="/programs" className="border-b border-line font-semibold text-dim hover:border-paper hover:text-paper">
                  see all programs →
                </Link>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
