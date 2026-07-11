import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRegistry, getOrg, programsOf, awardsGivenBy, awardsReceivedBy } from '@/lib/registry';
import { PageHeader, Card, WireBadge, RoundStatus, Stat, Empty } from '@/components/ui';
import { money, dateShort } from '@/lib/format';
import { orgStatusLabel, mechanismLabel, orgTypeLabel, coFundersOf, byDateDesc } from '@/components/browse/registry-helpers';

export function generateStaticParams() {
  return loadRegistry().orgs.map((o) => ({ id: o.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = getOrg(id);
  return { title: o ? o.name : 'Organization' };
}

const SOCIAL_LABEL: Record<string, string> = { x: 'X', github: 'GitHub', forum: 'Forum', discord: 'Discord', telegram: 'Telegram' };

export default async function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const registry = loadRegistry();
  const org = registry.orgs.find((o) => o.id === id);
  if (!org) notFound();

  const stats = registry.orgStats.get(org.id);
  const systemById = new Map(registry.systems.map((s) => [s.id, s]));
  const orgById = new Map(registry.orgs.map((o) => [o.id, o]));

  const programs = programsOf(org.id);
  const given = byDateDesc(awardsGivenBy(org.id));
  const received = byDateDesc(awardsReceivedBy(org.id));
  const coFunders = coFundersOf(org.id, registry, 6);

  return (
    <>
      <PageHeader
        eyebrow={`ORG · ${orgTypeLabel(org)} · ${org.id}`}
        title={
          <span className="flex flex-col gap-1">
            <span>{org.name}</span>
            {org.aka?.length > 0 && <span className="coord">{org.aka.join(', ')}</span>}
          </span>
        }
        right={
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-dim">{orgStatusLabel(org.status)}</span>
              {(org.wires || []).map((w) => (
                <WireBadge key={w} wire={w} />
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
              {org.website && (
                <a href={org.website} target="_blank" rel="noreferrer" className="text-xs text-dim hover:text-paper">
                  Website ↗
                </a>
              )}
              {org.socials &&
                Object.entries(org.socials).map(([k, v]) => (
                  <a key={k} href={v} target="_blank" rel="noreferrer" className="text-xs text-dim hover:text-paper">
                    {SOCIAL_LABEL[k] || k} ↗
                  </a>
                ))}
            </div>
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-4 pb-12 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 flex flex-col gap-6">
          {org.profile && <p className="text-paper leading-relaxed">{org.profile}</p>}

          {org.funding && (org.funding.focus?.length || org.funding.typical_size || org.funding.cadence || org.funding.apply_url) && (
            <div className="rounded-md border border-line bg-surface p-4 flex flex-col gap-3">
              <div className="coord">Funding</div>
              {org.funding.focus && org.funding.focus.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {org.funding.focus.map((f) => (
                    <span key={f} className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-xs text-dim">
                      {f}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-dim">
                {org.funding.typical_size && (
                  <span>
                    Typical size: <span className="text-paper">{org.funding.typical_size}</span>
                  </span>
                )}
                {org.funding.cadence && (
                  <span>
                    Cadence: <span className="text-paper">{org.funding.cadence}</span>
                  </span>
                )}
              </div>
              {org.funding.apply_url && (
                <a
                  href={org.funding.apply_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 rounded-md border border-signal/50 bg-signal/10 px-3 py-1.5 text-sm text-paper hover:bg-signal/20 transition-colors"
                >
                  Apply ↗
                </a>
              )}
            </div>
          )}

          {org.sources?.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="coord">Sources</div>
              {org.sources.map((src) => (
                <a key={src} href={src} target="_blank" rel="noreferrer" className="coord hover:text-dim block truncate">
                  {src.replace(/^https?:\/\//, '')}
                </a>
              ))}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 rounded-md border border-line bg-surface p-4">
            <Stat label="Awards given" value={stats?.awards_given ?? 0} />
            <Stat label="Total known" value={money(stats?.awards_total_usd)} />
            <Stat label="Grantees" value={stats?.grantees ?? 0} />
            <Stat label="Live rounds" value={stats?.live_rounds ?? 0} />
          </div>

          {org.systems?.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="coord">Systems</div>
              <div className="flex flex-wrap gap-2">
                {org.systems.map((sid) => {
                  const s = systemById.get(sid);
                  if (!s) return null;
                  return (
                    <Link key={sid} href={`/systems/${sid}`} className="text-sm text-dim hover:text-paper underline decoration-line underline-offset-2">
                      {s.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>

      <section className="mx-auto max-w-6xl px-4 pb-12">
        <div className="starline pt-6 pb-4">
          <h2 className="display text-xl font-semibold tracking-tight">Programs</h2>
        </div>
        {programs.length === 0 ? (
          <Empty>No programs on file for this org.</Empty>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {programs.map((p) => (
              <Card key={p.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="display text-base font-semibold tracking-tight">{p.name}</h3>
                  {p.mechanism && <span className="coord shrink-0">{mechanismLabel(p.mechanism)}</span>}
                </div>
                {p.rounds?.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {p.rounds.map((r, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2">
                          <RoundStatus status={r.status} />
                          {r.name}
                        </span>
                        {r.closes && <span className="font-mono text-xs text-dim shrink-0">closes {dateShort(r.closes)}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-faint">No dated rounds on file.</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12">
        <div className="starline pt-6 pb-4 flex items-baseline justify-between gap-4">
          <h2 className="display text-xl font-semibold tracking-tight">Awards given</h2>
          {given.length > 0 && (
            <Link href={`/awards?funder=${org.id}`} className="coord hover:text-dim shrink-0">
              all {given.length} in the ledger →
            </Link>
          )}
        </div>
        {given.length === 0 ? (
          <Empty>No awards on file for this funder yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="coord border-b border-line text-left">
                  <th className="py-2 pr-4 font-normal">Date</th>
                  <th className="py-2 pr-4 font-normal">Grantee</th>
                  <th className="py-2 pr-4 font-normal">Amount</th>
                  <th className="py-2 pr-4 font-normal">Program</th>
                </tr>
              </thead>
              <tbody>
                {given.slice(0, 15).map((a) => (
                  <tr key={a.key} className="border-b border-line/60">
                    <td className="py-2 pr-4 font-mono text-dim">{dateShort(a.date)}</td>
                    <td className="py-2 pr-4">
                      <Link href={`/grantees/${a.grantee}`} className="hover:text-signal">
                        {a.grantee_name || a.grantee}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono">{money(a.amount, a.amount_text)}</td>
                    <td className="py-2 pr-4 text-dim">{a.program_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {received.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-12">
          <div className="starline pt-6 pb-4">
            <h2 className="display text-xl font-semibold tracking-tight">Awards received</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="coord border-b border-line text-left">
                  <th className="py-2 pr-4 font-normal">Date</th>
                  <th className="py-2 pr-4 font-normal">Funder</th>
                  <th className="py-2 pr-4 font-normal">Amount</th>
                  <th className="py-2 pr-4 font-normal">Program</th>
                </tr>
              </thead>
              <tbody>
                {received.map((a) => (
                  <tr key={a.key} className="border-b border-line/60">
                    <td className="py-2 pr-4 font-mono text-dim">{dateShort(a.date)}</td>
                    <td className="py-2 pr-4">
                      {orgById.has(a.funder) ? (
                        <Link href={`/orgs/${a.funder}`} className="hover:text-signal">
                          {a.funder_name || a.funder}
                        </Link>
                      ) : (
                        a.funder_name || a.funder
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono">{money(a.amount, a.amount_text)}</td>
                    <td className="py-2 pr-4 text-dim">{a.program_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {coFunders.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-16">
          <div className="starline pt-6 pb-4">
            <h2 className="display text-xl font-semibold tracking-tight">Co-funders</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            {coFunders.map(({ org: co, sharedGrantees }) => (
              <Link
                key={co.id}
                href={`/orgs/${co.id}`}
                className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:border-faint hover:bg-raised transition-colors"
              >
                {co.name}
                <span className="coord">
                  {sharedGrantees} shared
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
