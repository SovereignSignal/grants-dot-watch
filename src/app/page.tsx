import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { buildStarmap, WIRE_HEX } from '@/lib/starmap';
import { Coord, Empty, RoundStatus, WireBadge } from '@/components/ui';
import { dateShort, money, WIRE_LABEL } from '@/lib/format';
import type { Award, Org, Program, Round, Wire } from '@/lib/types';
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

function latestAwards(awards: Award[], cap: number): Award[] {
  return awards
    .filter((a) => a.date)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, cap);
}

function daysUntil(date: string | undefined): number | null {
  if (!date) return null;
  const d = new Date(date + 'T23:59:59Z').getTime() - Date.now();
  return Math.ceil(d / 86_400_000);
}

const WIRES: Wire[] = ['crypto', 'ai', 'oss'];

export default function Home() {
  const { systems, orgs, programs, awards, orgStats, bySystem, counts } = loadRegistry();
  const map = buildStarmap(systems, orgs, orgStats);

  const openRounds = collectOpenRounds(programs, orgs).slice(0, 6);
  const recentAwards = latestAwards(awards, 8);
  const systemsRanked = [...systems].sort(
    (a, b) => (bySystem.get(b.id)?.orgs.length || 0) - (bySystem.get(a.id)?.orgs.length || 0)
  );

  return (
    <>
      <section className="relative">
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
                  {counts.systems} <span className="coord">SYSTEMS</span>
                </span>
                <span className="font-mono text-sm text-paper">
                  {counts.funders} <span className="coord">FUNDERS</span>
                </span>
                <span className="font-mono text-sm text-paper">
                  {counts.awards.toLocaleString()} <span className="coord">AWARDS</span>
                </span>
                <Link href="/galaxy" className="coord transition-colors hover:text-paper">
                  ENTER THE GALAXY →
                </Link>
              </div>
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-3 right-4 hidden md:block">
          <div className="flex items-center gap-4">
            {WIRES.map((w) => (
              <span key={w} className="coord flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: WIRE_HEX[w] }} />
                {WIRE_LABEL[w].toUpperCase()}
              </span>
            ))}
            <span className="coord flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-1.5 rounded-full ring-2 ring-live/60" />
              LIVE ROUND
            </span>
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
                    <RoundStatus status={r.round.status} />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="coord">{r.round.closes ? 'CLOSES' : 'WINDOW'}</div>
                      <div className={`whitespace-nowrap font-mono text-lg ${closingSoon ? 'text-closing' : 'text-paper'}`}>
                        {r.round.closes ? dateShort(r.round.closes) : 'Rolling'}
                        {closingSoon && <span className="ml-2 text-xs">{days}d left</span>}
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

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <div>
            <Coord>CAPITAL IN MOTION</Coord>
            <h2 className="display mt-1 text-2xl font-semibold text-paper">Latest awards</h2>
          </div>
          <Link href="/awards" className="coord hover:text-paper">
            THE LEDGER →
          </Link>
        </div>
        {recentAwards.length === 0 ? (
          <Empty>No awards on file yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="coord text-left">
                  <th className="px-4 pb-2 pt-3 font-normal">Date</th>
                  <th className="px-4 pb-2 pt-3 font-normal">Funder → Grantee</th>
                  <th className="px-4 pb-2 pt-3 text-right font-normal">Amount</th>
                  <th className="px-4 pb-2 pt-3 font-normal">Wire</th>
                </tr>
              </thead>
              <tbody>
                {recentAwards.map((a) => (
                  <tr key={a.key} className="border-t border-line/70">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-dim">{dateShort(a.date)}</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/orgs/${a.funder}`} className="text-paper hover:underline">
                        {a.funder_name}
                      </Link>
                      <span className="text-faint"> → </span>
                      <span className="text-dim">{a.grantee_name}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-signal">
                      {money(a.amount, a.amount_text)}
                    </td>
                    <td className="px-4 py-2.5">{a.wire && <WireBadge wire={a.wire} small />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="starline" />

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <div>
            <Coord>TAXONOMY</Coord>
            <h2 className="display mt-1 text-2xl font-semibold text-paper">Systems</h2>
          </div>
          <Link href="/systems" className="coord hover:text-paper">
            ALL SYSTEMS →
          </Link>
        </div>
        {systemsRanked.length === 0 ? (
          <Empty>No systems on file.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {systemsRanked.slice(0, 9).map((s) => {
              const bucket = bySystem.get(s.id);
              const members = bucket?.orgs || [];
              return (
                <Link
                  key={s.id}
                  href={`/systems/${s.id}`}
                  className="group rounded-md border border-line bg-surface p-4 transition-colors hover:border-faint hover:bg-raised"
                >
                  <Coord>{s.kind === 'protocol-ecosystem' ? 'PROTOCOL ECOSYSTEM' : 'FUNDING DOMAIN'}</Coord>
                  <div className="display mt-1 text-lg font-semibold text-paper">{s.name}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-1" aria-hidden>
                    {members.slice(0, 24).map((o) => (
                      <span
                        key={o.id}
                        className="inline-block size-1.5 rounded-full opacity-80"
                        style={{ background: o.wires?.[0] ? WIRE_HEX[o.wires[0]] : 'var(--color-faint)' }}
                      />
                    ))}
                    {members.length > 24 && <span className="coord ml-1">+{members.length - 24}</span>}
                  </div>
                  <div className="coord mt-3">
                    {members.length} {members.length === 1 ? 'FUNDER' : 'FUNDERS'} · {bucket?.programs.length ?? 0}{' '}
                    PROGRAMS
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
