import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { Empty } from '@/components/ui';
import { MONTHS_LONG } from '@/lib/format';
import type { Org, Program, Round } from '@/lib/types';

interface OpenRound {
  key: string;
  program: Program;
  orgName: string;
  round: Round;
}

function collectOpenRounds(programs: Program[], orgs: Org[]): OpenRound[] {
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const rounds: OpenRound[] = [];
  for (const p of programs) {
    for (const r of p.rounds || []) {
      const todayISO = new Date().toISOString().slice(0, 10);
      if ((r.status === 'open' || r.status === 'announced') && (!r.closes || r.closes >= todayISO)) {
        rounds.push({ key: `${p.id}::${r.name}`, program: p, orgName: orgName.get(p.org) || p.org, round: r });
      }
    }
  }
  return rounds;
}

function daysUntil(date: string | undefined): number | null {
  if (!date) return null;
  const d = new Date(date + 'T23:59:59Z').getTime() - Date.now();
  return Math.ceil(d / 86_400_000);
}

function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return `${MONTHS_LONG[+m - 1]} ${y}`;
}

function wireDot(wire: string | null | undefined) {
  return <span aria-hidden className="mt-[6px] size-1.5 shrink-0" style={{ background: wire ? `var(--color-${wire})` : 'var(--color-line)' }} />;
}

export default function Home() {
  const { orgs, programs, counts } = loadRegistry();

  const openRounds = collectOpenRounds(programs, orgs);
  const dated = openRounds
    .filter((r) => r.round.closes)
    .sort((a, b) => a.round.closes!.localeCompare(b.round.closes!));
  // Standing (rolling) programs: dedupe by program name + org so the same
  // program listed under several rounds shows once, and cap the front-page
  // preview. The full board lives on /programs.
  const seenStanding = new Set<string>();
  const standing = openRounds
    .filter((r) => !r.round.closes)
    .filter((r) => {
      const k = `${r.program.name}::${r.orgName}`;
      if (seenStanding.has(k)) return false;
      seenStanding.add(k);
      return true;
    });
  const standingPreview = standing.slice(0, 10);
  const departures = dated.slice(0, 5);

  // group departures by close month — a month's label carries the year once,
  // so individual rows show only the day (no repeated "Jul 2026" per row).
  const groups: { label: string; rows: OpenRound[] }[] = [];
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
        <p className="serif-statement max-w-4xl text-[26px] leading-[1.26] text-paper md:text-[34px]">
          Funders, programs, and the open rounds they run,{' '}
          <em className="border-b border-paper not-italic">tracked in one register, sourced in the open.</em>
        </p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-dim">
          grants.watch indexes funding systems: ecosystems with their own treasury, like Ethereum or Cardano. It
          tracks the funders and programs inside each one, across three wires of capital: crypto, AI, and open
          source. Every figure links back to a primary source.
        </p>
      </section>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-11 gap-y-10 px-4 py-9 lg:grid-cols-[1fr_300px]">
        {/* DEPARTURES — lead story */}
        <section className="min-w-0">
          <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
            <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Departures: What Closes Next</h2>
            <span className="coord shrink-0">
              {departures.length} of {counts.programs.toLocaleString()} programs
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

        {/* RAIL — THE REGISTER */}
        <aside className="min-w-0 lg:border-l lg:border-line lg:pl-11">
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
        </aside>
      </div>

      {/* STANDING — quiet section for rolling programs */}
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
