import Link from 'next/link';
import { loadRegistry } from '@/lib/registry';
import { buildStarmap } from '@/lib/starmap';
import { Card, Coord, Empty, RoundStatus, Stat, WireBadge } from '@/components/ui';
import { dateShort, money } from '@/lib/format';
import type { Award, Org, Program, Round } from '@/lib/types';
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

export default function Home() {
  const { systems, orgs, programs, awards, orgStats, bySystem, counts } = loadRegistry();
  const map = buildStarmap(systems, orgs, orgStats);

  const openRounds = collectOpenRounds(programs, orgs).slice(0, 9);
  const recentAwards = latestAwards(awards, 8);
  const systemsRanked = [...systems].sort(
    (a, b) => (bySystem.get(b.id)?.orgs.length || 0) - (bySystem.get(a.id)?.orgs.length || 0)
  );

  return (
    <>
      <section className="relative">
        <Field map={map} />
        <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-void via-void/40 to-transparent">
          <div className="mx-auto w-full max-w-6xl px-4 pb-10">
            <div className="coord mb-3">
              THE REGISTER · {counts.systems} SYSTEMS · {counts.funders} FUNDERS
            </div>
            <h1 className="display max-w-2xl text-4xl font-semibold tracking-tight text-paper md:text-6xl">
              The funding world, on file.
            </h1>
            <p className="mt-3 max-w-xl text-dim">
              Every system, funder, program, and award we track across crypto, AI, and open source — kept current, in
              one registry.
            </p>
          </div>
        </div>
      </section>

      <div className="starline" />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="display text-xl font-semibold text-paper">Now open</h2>
          <Link href="/programs" className="coord hover:text-dim">
            All programs →
          </Link>
        </div>
        {openRounds.length === 0 ? (
          <Empty>No open rounds on file.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {openRounds.map((r) => (
              <Card key={r.key} href="/programs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-paper">{r.program.name}</div>
                    <div className="truncate text-sm text-dim">{r.orgName}</div>
                  </div>
                  <RoundStatus status={r.round.status} />
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="font-mono text-dim">
                    {r.round.closes ? `Closes ${dateShort(r.round.closes)}` : 'No deadline on file'}
                  </span>
                  {r.round.size && <span className="font-mono text-paper">{r.round.size}</span>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="starline" />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="display text-xl font-semibold text-paper">Latest awards</h2>
          <Link href="/awards" className="coord hover:text-dim">
            All awards →
          </Link>
        </div>
        {recentAwards.length === 0 ? (
          <Empty>No awards on file yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="coord text-left">
                  <th className="pb-2 pr-4 font-normal">Date</th>
                  <th className="pb-2 pr-4 font-normal">Funder → Grantee</th>
                  <th className="pb-2 pr-4 font-normal">Amount</th>
                  <th className="pb-2 font-normal">Wire</th>
                </tr>
              </thead>
              <tbody>
                {recentAwards.map((a) => (
                  <tr key={a.key} className="border-t border-line">
                    <td className="whitespace-nowrap py-2 pr-4 font-mono text-dim">{dateShort(a.date)}</td>
                    <td className="py-2 pr-4">
                      <span className="text-paper">{a.funder_name}</span>
                      <span className="text-faint"> → </span>
                      <span className="text-dim">{a.grantee_name}</span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 font-mono text-paper">{money(a.amount, a.amount_text)}</td>
                    <td className="py-2">{a.wire && <WireBadge wire={a.wire} small />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="starline" />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="display text-xl font-semibold text-paper">Systems</h2>
          <Link href="/systems" className="coord hover:text-dim">
            All systems →
          </Link>
        </div>
        {systemsRanked.length === 0 ? (
          <Empty>No systems on file.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {systemsRanked.map((s) => {
              const bucket = bySystem.get(s.id);
              return (
                <Card key={s.id} href={`/systems/${s.id}`}>
                  <Coord>{s.kind === 'protocol-ecosystem' ? 'Protocol ecosystem' : 'Funding domain'}</Coord>
                  <div className="display mt-1 text-lg font-semibold text-paper">{s.name}</div>
                  <div className="mt-4 flex gap-6">
                    <Stat label="Members" value={bucket?.orgs.length ?? 0} />
                    <Stat label="Programs" value={bucket?.programs.length ?? 0} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
