import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRegistry, getSystem } from '@/lib/registry';
import { Card, RoundStatus, Empty } from '@/components/ui';
import { dateShort, WIRE_LABEL } from '@/lib/format';
import { systemKindLabel, orgStatusLabel, mechanismLabel, mostLiveRound } from '@/components/browse/registry-helpers';
import { Breadcrumb } from '@/components/browse/breadcrumb';
import { Dossier, FactSep } from '@/components/browse/dossier';
import { pageMetadata } from '@/lib/site-metadata';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const s = getSystem(id);
  return pageMetadata(`/systems/${id}`, s ? s.name : 'System', s?.summary || 'Funding system profile on grants.watch.');
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
    .sort((a, b) => (b.stats?.programs || 0) - (a.stats?.programs || 0) || a.org.name.localeCompare(b.org.name));

  const orgById = new Map(registry.orgs.map((o) => [o.id, o]));
  const byIdSystem = new Map(registry.systems.map((s) => [s.id, s]));
  const parents = (system.part_of || []).map((pid) => byIdSystem.get(pid)).filter((s): s is NonNullable<typeof s> => !!s);
  const satellites = registry.systems.filter((s) => (s.part_of || []).includes(system.id));

  return (
    <>
      <Breadcrumb
        trail={[{ label: 'Registry', href: '/' }, { label: 'Systems', href: '/systems' }, { label: system.name }]}
        note="System profile: sourced & linked"
      />

      <Dossier
        kicker={`System · ${systemKindLabel(system.kind)}`}
        kickerColor={system.wires?.[0] ? `var(--color-${system.wires[0]})` : undefined}
        name={system.name}
        factsLine={
          system.wires?.length > 0 ? (
            <>
              {system.wires.map((w, i) => (
                <span key={w} className="flex items-center gap-1.5">
                  {i > 0 && <FactSep />}
                  <span aria-hidden className="inline-block size-1.5 shrink-0" style={{ background: `var(--color-${w})` }} />
                  {WIRE_LABEL[w]}
                </span>
              ))}
            </>
          ) : undefined
        }
        standfirst={
          system.summary?.trim() ? (
            system.summary.trim()
          ) : (
            <span className="text-dim">No public summary on file yet. We&apos;ll add one as we find more sources.</span>
          )
        }
      />

      {system.sources?.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 pt-6 pb-2 flex flex-wrap gap-x-4 gap-y-1">
          {system.sources.map((src) => (
            <a key={src} href={src} target="_blank" rel="noreferrer" className="coord max-w-xs truncate hover:text-dim">
              {src.replace(/^https?:\/\//, '')}
            </a>
          ))}
        </div>
      )}

      {(parents.length > 0 || satellites.length > 0) && (
        <div className="mx-auto max-w-6xl px-4 pb-6 flex flex-wrap gap-x-6 gap-y-1.5">
          {parents.length > 0 && (
            <div className="coord">
              Part of{' '}
              {parents.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <Link href={`/systems/${p.id}`} className="text-dim normal-case tracking-normal hover:text-paper">
                    {p.name}
                  </Link>
                </span>
              ))}
            </div>
          )}
          {satellites.length > 0 && (
            <div className="coord">
              Includes:{' '}
              {satellites.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ', '}
                  <Link href={`/systems/${s.id}`} className="text-dim normal-case tracking-normal hover:text-paper">
                    {s.name}
                  </Link>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <section className="mx-auto max-w-6xl px-4 pb-12">
        <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
          <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Funders in this System</h2>
          <span className="coord shrink-0">{funders.length} on file</span>
        </div>
        {funders.length === 0 ? (
          <Empty>No funders on file in this system yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="coord py-2.5 pr-4 font-normal">Name</th>
                  <th className="coord py-2.5 pr-4 text-right font-normal">Programs</th>
                  <th className="coord py-2.5 pr-4 text-right font-normal">Open now</th>
                  <th className="coord py-2.5 pr-4 text-right font-normal">Last activity</th>
                  <th className="coord py-2.5 pr-4 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {funders.map(({ org, stats }) => (
                  <tr key={org.id} className="border-b border-line transition-colors hover:bg-raised/40">
                    <td className="py-3 pr-4">
                      <Link href={`/orgs/${org.id}`} className="display text-[14.5px] text-paper hover:text-signal">
                        {org.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-right font-bold tabular-nums text-paper">{stats?.programs ?? 0}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-dim">
                      <span className="inline-flex items-center gap-2">
                        {stats?.live_rounds || 0}
                        {(stats?.live_rounds || 0) > 0 && <RoundStatus status="open" />}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right text-[12px] tabular-nums text-faint">{dateShort(stats?.last_activity)}</td>
                    <td className="coord py-3 pr-4 normal-case tracking-normal text-dim">{orgStatusLabel(org.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
          <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Programs</h2>
          <span className="coord shrink-0">{members.programs.length} on file</span>
        </div>
        {members.programs.length === 0 ? (
          <Empty>No programs on file in this system yet.</Empty>
        ) : (
          <div>
            {members.programs.map((p) => {
              const org = orgById.get(p.org);
              const live = mostLiveRound(p);
              return (
                <Card key={p.id} href={`/programs/${p.id}`} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="display truncate text-[14.5px] text-paper">{p.name}</div>
                    <div className="coord mt-0.5 flex flex-wrap items-center gap-x-2 normal-case tracking-normal">
                      {org && <span>{org.name}</span>}
                      {p.mechanism && (
                        <>
                          <span aria-hidden className="text-line">
                            ·
                          </span>
                          <span>{mechanismLabel(p.mechanism)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {live ? (
                      <>
                        <RoundStatus status={live.status} />
                        {live.closes && <div className="coord mt-1">closes {dateShort(live.closes)}</div>}
                      </>
                    ) : (
                      <span className="coord opacity-50">no current rounds</span>
                    )}
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
