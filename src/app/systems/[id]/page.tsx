import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRegistry, getSystem } from '@/lib/registry';
import { PageHeader, Card, WireBadge, RoundStatus, Empty } from '@/components/ui';
import { money, dateShort } from '@/lib/format';
import {
  systemKindLabel,
  orgStatusLabel,
  mechanismLabel,
  mostLiveRound,
} from '@/components/browse/registry-helpers';

export function generateStaticParams() {
  return loadRegistry().systems.map((s) => ({ id: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const s = getSystem(id);
  return { title: s ? s.name : 'System' };
}

export default async function SystemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const registry = loadRegistry();
  const system = registry.systems.find((s) => s.id === id);
  if (!system) notFound();

  const members = registry.bySystem.get(system.id) || { orgs: [], programs: [] };
  const funders = members.orgs
    .filter((o) => o.roles?.includes('funder'))
    .map((o) => ({ org: o, stats: registry.orgStats.get(o.id) }))
    .sort((a, b) => (b.stats?.awards_given || 0) - (a.stats?.awards_given || 0) || a.org.name.localeCompare(b.org.name));

  const orgById = new Map(registry.orgs.map((o) => [o.id, o]));
  const byIdSystem = new Map(registry.systems.map((s) => [s.id, s]));
  const parents = (system.part_of || []).map((pid) => byIdSystem.get(pid)).filter((s): s is NonNullable<typeof s> => !!s);
  const satellites = registry.systems.filter((s) => (s.part_of || []).includes(system.id));

  return (
    <>
      <PageHeader
        eyebrow={`SYSTEM · ${systemKindLabel(system.kind)}`}
        title={system.name}
        sub={system.summary}
        right={
          system.wires?.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {system.wires.map((w) => (
                <WireBadge key={w} wire={w} />
              ))}
            </div>
          ) : undefined
        }
      />

      {system.sources?.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 pb-6 flex flex-wrap gap-x-4 gap-y-1">
          {system.sources.map((src) => (
            <a key={src} href={src} target="_blank" rel="noreferrer" className="coord hover:text-dim truncate max-w-xs">
              {src.replace(/^https?:\/\//, '')}
            </a>
          ))}
        </div>
      )}

      {(parents.length > 0 || satellites.length > 0) && (
        <div className="mx-auto max-w-6xl px-4 pb-6 flex flex-wrap gap-x-6 gap-y-1">
          {parents.length > 0 && (
            <div className="coord">
              Part of{' '}
              {parents.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <Link href={`/systems/${p.id}`} className="text-dim hover:text-paper normal-case tracking-normal">
                    {p.name}
                  </Link>
                </span>
              ))}
            </div>
          )}
          {satellites.length > 0 && (
            <div className="coord">
              Satellites:{' '}
              {satellites.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ', '}
                  <Link href={`/systems/${s.id}`} className="text-dim hover:text-paper normal-case tracking-normal">
                    {s.name}
                  </Link>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <section className="mx-auto max-w-6xl px-4 pb-12">
        <div className="starline pt-6 pb-4">
          <h2 className="display text-xl font-semibold tracking-tight">Funders in this system</h2>
        </div>
        {funders.length === 0 ? (
          <Empty>No funders on file in this system yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="coord border-b border-line text-left">
                  <th className="py-2 pr-4 font-normal">Name</th>
                  <th className="py-2 pr-4 font-normal">Live rounds</th>
                  <th className="py-2 pr-4 font-normal">Awards given</th>
                  <th className="py-2 pr-4 font-normal">Total known</th>
                  <th className="py-2 pr-4 font-normal">Last activity</th>
                  <th className="py-2 pr-4 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {funders.map(({ org, stats }) => (
                  <tr key={org.id} className="border-b border-line/60">
                    <td className="py-2 pr-4">
                      <Link href={`/orgs/${org.id}`} className="hover:text-signal">
                        {org.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono">
                      <span className="inline-flex items-center gap-2">
                        {stats?.live_rounds || 0}
                        {(stats?.live_rounds || 0) > 0 && <RoundStatus status="open" />}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono">{stats?.awards_given ?? 0}</td>
                    <td className="py-2 pr-4 font-mono">{money(stats?.awards_total_usd)}</td>
                    <td className="py-2 pr-4 font-mono text-dim">{dateShort(stats?.last_activity)}</td>
                    <td className="py-2 pr-4 text-dim">{orgStatusLabel(org.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="starline pt-6 pb-4">
          <h2 className="display text-xl font-semibold tracking-tight">Programs</h2>
        </div>
        {members.programs.length === 0 ? (
          <Empty>No programs on file in this system yet.</Empty>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {members.programs.map((p) => {
              const org = orgById.get(p.org);
              const live = mostLiveRound(p.rounds);
              return (
                <Card key={p.id} href={`/programs/${p.id}`} className="flex flex-col gap-2">
                  <h3 className="display text-base font-semibold tracking-tight">{p.name}</h3>
                  {org && <div className="coord">{org.name}</div>}
                  <div className="flex items-center justify-between gap-2">
                    {p.mechanism && <span className="text-xs text-dim">{mechanismLabel(p.mechanism)}</span>}
                    {live && <RoundStatus status={live.status} />}
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
