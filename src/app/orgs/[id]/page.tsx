import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadRegistry, getOrg, programsOf, awardsGivenBy } from '@/lib/registry';
import { Empty } from '@/components/ui';
import { orgStatusLabel, orgTypeLabel } from '@/components/browse/registry-helpers';
import { Breadcrumb } from '@/components/browse/breadcrumb';
import { Dossier, FactSep, FactsPanel } from '@/components/browse/dossier';
import { SourceCitations, SourcesList } from '@/components/browse/sources';
import { CadenceLane, type CadenceRow } from '@/components/browse/cadence-lane';
import { pageMetadata } from '@/lib/site-metadata';
import { AwardLedger } from '@/components/awards/award-ledger';
import { parsePage } from '@/lib/pagination';
import { param, type SearchParams } from '@/components/ledger/query';
import { money } from '@/lib/format';
import { awardMatchesProgram } from '@/lib/awards';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = getOrg(id);
  return pageMetadata(`/orgs/${id}`, o ? o.name : 'Organization', o?.profile || 'Funding organization profile on grants.watch.');
}

const SOCIAL_LABEL: Record<string, string> = { x: 'X', github: 'GitHub', forum: 'Forum', discord: 'Discord', telegram: 'Telegram' };

export default async function OrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const registry = loadRegistry();
  const org = registry.orgs.find((o) => o.id === id);
  if (!org) notFound();

  const stats = registry.orgStats.get(org.id);
  const systemById = new Map(registry.systems.map((s) => [s.id, s]));

  const programs = programsOf(org.id);
  const given = awardsGivenBy(org.id);

  const primarySystem = org.systems?.[0] ? systemById.get(org.systems[0]) : null;
  const systemNames = (org.systems || []).map((sid) => systemById.get(sid)?.name).filter((n): n is string => Boolean(n));

  // Keep cadence counts on the same matching rule as the visible ledger.
  const cadenceRows: CadenceRow[] = programs.map((p) => {
    const grantCount = given.filter((award) => awardMatchesProgram(award, p)).length;
    return { program: p, grantCount };
  });

  const domain = org.website ? org.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;

  return (
    <>
      <Breadcrumb
        trail={[
          { label: 'Registry', href: '/' },
          { label: 'Organizations', href: '/orgs' },
          ...(primarySystem ? [{ label: primarySystem.name, href: `/systems/${primarySystem.id}` }] : []),
          { label: org.name },
        ]}
        note="Org profile: sourced & linked"
      />

      <Dossier
        kicker="Organization Profile"
        kickerColor={org.wires?.[0] ? `var(--color-${org.wires[0]})` : undefined}
        name={org.name}
        aka={org.aka?.length > 0 ? org.aka.join(', ') : undefined}
        factsLine={
          <>
            <span>{orgTypeLabel(org)}</span>
            {systemNames.length > 0 && (
              <>
                <FactSep />
                <span>{systemNames.join(', ')}</span>
              </>
            )}
            <FactSep />
            <span className={org.status === 'active' ? 'text-signal' : 'text-faint'}>{orgStatusLabel(org.status)}</span>
            {domain && (
              <>
                <FactSep />
                <a
                  href={org.website}
                  target="_blank"
                  rel="noreferrer"
                  className="border-b border-line text-dim normal-case tracking-normal hover:text-paper"
                >
                  {domain}
                </a>
              </>
            )}
            {org.socials &&
              Object.entries(org.socials).map(([k, v]) => (
                <span key={k} className="flex items-center gap-2.5">
                  <FactSep />
                  <a
                    href={v}
                    target="_blank"
                    rel="noreferrer"
                    className="border-b border-line text-dim normal-case tracking-normal hover:text-paper"
                  >
                    {SOCIAL_LABEL[k] || k} ↗
                  </a>
                </span>
              ))}
          </>
        }
        standfirst={
          org.profile?.trim() ? (
            <>
              {org.profile.trim()}
              <SourceCitations sources={org.sources} />
            </>
          ) : (
            <span className="text-dim">No public profile on file yet. We&apos;ll add one as we find more sources.</span>
          )
        }
      />

      {/* Everything below runs full-width so long program and award ledgers
          keep enough room for names, amounts, and source evidence. */}
      <div className="mx-auto max-w-6xl px-4 pb-16">
        <section className="pt-7">
          <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
            <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Programs</h2>
            <span className="coord shrink-0">
              {programs.length} program{programs.length === 1 ? '' : 's'} on file
            </span>
          </div>

          {org.funding?.apply_url && (
            <a href={org.funding.apply_url} target="_blank" rel="noreferrer" className="coord mt-2.5 inline-block hover:text-dim">
              Apply ↗
            </a>
          )}

          {programs.length === 0 ? <Empty>No programs on file for this org yet.</Empty> : <CadenceLane rows={cadenceRows} />}
        </section>

        <AwardLedger
          awards={given}
          requestedPage={parsePage(param(sp, 'awardPage'))}
          basePath={`/orgs/${org.id}`}
          programs={registry.programs}
          orgIds={new Set(registry.orgs.map((item) => item.id))}
          showProgram
        />

        <section className="mt-10 border-t border-line pt-7">
          <FactsPanel
            layout="horizontal"
            facts={[
              { label: 'Programs', value: stats?.programs ?? 0 },
              { label: 'Awards', value: stats?.awards_given ?? 0 },
              { label: 'Grantees', value: stats?.grantees ?? 0 },
              { label: 'Known USD', value: money(stats?.awards_total_usd) },
              {
                label: 'Live rounds',
                value: stats?.live_rounds ?? 0,
                note: (stats?.live_rounds ?? 0) === 0 ? 'no open or announced rounds on file' : undefined,
              },
              { label: 'Status', value: orgStatusLabel(org.status) },
            ]}
          />
        </section>

        <div className="mt-10 grid grid-cols-1 gap-x-11 gap-y-8 border-t border-line pt-7 sm:grid-cols-2">
          <div className="min-w-0">
            {org.funding?.focus && org.funding.focus.length > 0 && (
              <div className="pb-5">
                <div className="coord mb-2.5">Focus Areas</div>
                <p className="serif-statement text-[16px] leading-[1.55] text-paper">{org.funding.focus.join(', ')}.</p>
              </div>
            )}

            {(org.funding?.typical_size || org.funding?.cadence) && (
              <div className="flex flex-col gap-1.5 text-[12px] text-dim">
                {org.funding?.typical_size && (
                  <div>
                    <span className="coord mr-1.5">Typical size</span>
                    {org.funding.typical_size}
                  </div>
                )}
                {org.funding?.cadence && (
                  <div>
                    <span className="coord mr-1.5">Cadence</span>
                    {org.funding.cadence}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <SourcesList sources={org.sources} />
          </div>
        </div>
      </div>
    </>
  );
}
