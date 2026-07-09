import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { buildStarmap, WIRE_HEX } from '@/lib/starmap';
import { Coord, Empty } from '@/components/ui';
import { dateShort } from '@/lib/format';
import type { Org, Program, Round } from '@/lib/types';
import Field from '@/components/field';

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
      if (r.status === 'open' || r.status === 'announced') {
        rounds.push({ key: `${p.id}::${r.name}`, program: p, orgName: orgName.get(p.org) || p.org, round: r });
      }
    }
  }
  rounds.sort((a, b) => {
    if (!a.round.closes && !b.round.closes) return 0;
    if (!a.round.closes) return 1;
    if (!b.round.closes) return -1;
    return a.round.closes.localeCompare(b.round.closes);
  });
  return rounds;
}

function daysUntil(date: string | undefined): number | null {
  if (!date) return null;
  const d = new Date(date + 'T23:59:59Z').getTime() - Date.now();
  return Math.ceil(d / 86_400_000);
}

export default function Home() {
  const { systems, orgs, programs, orgStats, counts } = loadRegistry();
  const map = buildStarmap(systems, orgs, orgStats);

  const openRounds = collectOpenRounds(programs, orgs).slice(0, 3);

  return (
    <>
      {/* The field hero stays a dark observatory viewport in both themes — the
          canvas itself never repaints light. That means every token this
          section (and Field's own hover tooltip, rendered inside it) reads
          must stay pinned to its dark-theme value too, or light-theme text
          tokens (paper → ink, etc.) would flip to near-invisible over the
          still-dark canvas. Pinning the CSS custom properties here, scoped
          to just this <section>, hardcodes the dark equivalents for every
          descendant while leaving the rest of the app themable normally. */}
      <section
        className="relative"
        style={
          {
            '--color-void': '#0b0e1a',
            '--color-surface': '#131829',
            '--color-raised': '#1a2033',
            '--color-line': '#232a40',
            '--color-paper': '#e8e6df',
            '--color-dim': '#9094a8',
            '--color-faint': '#5b5f73',
            '--color-live': '#4fbf7e',
            '--color-closing': '#d9a13f',
            '--color-signal': '#e8b44f',
          } as React.CSSProperties
        }
      >
        <Field map={map} />
        <div className="pointer-events-none absolute inset-0 flex items-center">
          <div className="mx-auto w-full max-w-6xl px-4">
            <div className="max-w-2xl">
              <div className="coord mb-4 flex items-center gap-3">
                <span className="inline-block h-px w-8 bg-faint" aria-hidden />
                THE REGISTER
              </div>
              <h1 className="display text-5xl font-semibold leading-[1.04] tracking-tight text-paper md:text-7xl">
                The funding world,
                <br />
                on file.
              </h1>
              <p className="mt-4 max-w-lg text-base text-paper/70 md:text-lg">
                Every system, funder, program, and award tracked across crypto, AI, and open source — kept current, in
                one registry.
              </p>
              <div className="pointer-events-auto mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="font-mono text-sm text-paper">
                  {counts.funders} <span className="coord">FUNDERS TRACKED</span>
                </span>
                <Link href="/galaxy" className="coord transition-colors hover:text-paper">
                  ENTER THE GALAXY →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="starline" />

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <div>
            <Coord>DEADLINES AHEAD</Coord>
            <h2 className="display mt-1 text-2xl font-semibold text-paper">Now open</h2>
          </div>
          <Link href="/programs" className="coord hover:text-paper">
            ALL PROGRAMS →
          </Link>
        </div>
        {openRounds.length === 0 ? (
          <Empty>No open rounds on file.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {openRounds.map((r) => {
              const wire = (r.program.wires || [])[0] || null;
              const days = daysUntil(r.round.closes);
              const closingSoon = days !== null && days >= 0 && days <= 14;
              return (
                <Link
                  key={r.key}
                  href={`/programs/${r.program.id}`}
                  className="group relative overflow-hidden rounded-md border border-line bg-surface p-4 transition-colors hover:border-faint hover:bg-raised"
                >
                  <span
                    aria-hidden
                    className="absolute inset-x-0 top-0 h-[2px] opacity-80"
                    style={{ background: wire ? WIRE_HEX[wire] : 'var(--color-line)' }}
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="line-clamp-2 font-medium leading-snug text-paper" title={r.program.name}>
                        {r.program.name}
                      </div>
                      <div className="coord mt-1 truncate">{r.orgName}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="coord">{r.round.closes ? 'CLOSES' : 'WINDOW'}</div>
                      <div
                        className={`flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-lg ${closingSoon ? 'text-closing' : 'text-paper'}`}
                      >
                        <span className="whitespace-nowrap">{r.round.closes ? dateShort(r.round.closes) : 'Rolling'}</span>
                        {closingSoon && (
                          <span className="whitespace-nowrap text-xs">
                            <span aria-hidden className="mr-1.5">
                              ·
                            </span>
                            {days}d left
                          </span>
                        )}
                      </div>
                    </div>
                    {r.round.size && (
                      <div className="line-clamp-2 max-w-[45%] text-right font-mono text-xs leading-snug text-signal">
                        {r.round.size}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="starline" />

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {[
            { href: '/systems', label: 'Systems', n: counts.systems },
            { href: '/orgs', label: 'Organizations', n: counts.orgs },
            { href: '/programs', label: 'Programs', n: counts.programs },
            { href: '/awards', label: 'The ledger', n: counts.awards },
          ].map((x) => (
            <Link key={x.href} href={x.href} className="group">
              <span className="font-mono text-2xl text-paper group-hover:text-signal">{x.n.toLocaleString()}</span>
              <span className="coord ml-2 group-hover:text-dim">{x.label} →</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
