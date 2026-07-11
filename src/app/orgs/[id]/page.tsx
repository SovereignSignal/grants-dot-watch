import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRegistry, getOrg, programsOf, awardsGivenBy, awardsReceivedBy } from '@/lib/registry';
import { Empty } from '@/components/ui';
import { money, dateShort } from '@/lib/format';
import { orgStatusLabel, orgTypeLabel, coFundersOf, byDateDesc, isUsdKnown } from '@/components/browse/registry-helpers';
import { Breadcrumb } from '@/components/browse/breadcrumb';
import { Dossier, FactSep, FactsPanel } from '@/components/browse/dossier';
import { SourceCitations, SourcesList } from '@/components/browse/sources';
import { CadenceLane, type CadenceRow } from '@/components/browse/cadence-lane';

export function generateStaticParams() {
  return loadRegistry().orgs.map((o) => ({ id: o.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = getOrg(id);
  return { title: o ? o.name : 'Organization' };
}

const SOCIAL_LABEL: Record<string, string> = { x: 'X', github: 'GitHub', forum: 'Forum', discord: 'Discord', telegram: 'Telegram' };

/** Grid template shared by the two award tables in the left column — date |
 *  counterparty | program (dim) | amount, right-aligned tabular amount.
 *  Column order matches the master /awards table and every other award
 *  listing on the site: date leads, amount trails. */
const AWARD_COLS = 'grid-cols-[86px_1fr_1.3fr_92px]';

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
  const coFunders = coFundersOf(org.id, registry, 8);

  const primarySystem = org.systems?.[0] ? systemById.get(org.systems[0]) : null;
  const systemNames = (org.systems || []).map((sid) => systemById.get(sid)?.name).filter((n): n is string => Boolean(n));

  const withAmount = given.filter(isUsdKnown).length;
  const noAmountCount = given.length - withAmount;

  // Award count per program — same funder/program-name matching the program
  // detail page uses, so the two pages never disagree on a count.
  const cadenceRows: CadenceRow[] = programs.map((p) => {
    const nameLower = p.name.toLowerCase();
    const grantCount = given.filter((a) => a.program === p.id || (a.program_name && a.program_name.toLowerCase() === nameLower)).length;
    return { program: p, grantCount };
  });

  const recentAwards = given.slice(0, 8);
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
        note="Org profile — sourced & linked"
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
            <span className="text-dim">No public profile on file yet — we&apos;ll add one as we find more sources.</span>
          )
        }
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-0 px-4 lg:grid-cols-[1.65fr_1fr]">
        {/* LEFT — programs cadence + recent awards */}
        <div className="min-w-0 py-7">
          <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
            <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Programs</h2>
            <span className="coord shrink-0">
              {programs.length} program{programs.length === 1 ? '' : 's'} · {given.length} award{given.length === 1 ? '' : 's'} tracked
            </span>
          </div>

          {org.funding?.apply_url && (
            <a href={org.funding.apply_url} target="_blank" rel="noreferrer" className="coord mt-2.5 inline-block hover:text-dim">
              Apply ↗
            </a>
          )}

          {programs.length === 0 ? <Empty>No programs on file for this org yet.</Empty> : <CadenceLane rows={cadenceRows} />}

          <div className="mt-9">
            <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
              <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Recent Awards</h2>
              <span className="coord shrink-0">
                {given.length === 0 ? 'none on file' : `most recent ${recentAwards.length} of ${given.length.toLocaleString()}`}
              </span>
            </div>
            {given.length === 0 ? (
              <Empty>No awards on file for this funder yet.</Empty>
            ) : (
              <>
                <div className={`grid ${AWARD_COLS} gap-4 border-b border-line py-2`}>
                  <span className="coord">Date</span>
                  <span className="coord">Grantee</span>
                  <span className="coord">Grant</span>
                  <span className="coord text-right">Amount</span>
                </div>
                {recentAwards.map((a) => (
                  <div key={a.key} className={`grid ${AWARD_COLS} items-baseline gap-4 border-b border-line py-3`}>
                    <span className="text-[11px] tabular-nums text-faint">{dateShort(a.date)}</span>
                    <Link href={`/grantees/${a.grantee}`} className="display truncate text-[14.5px] text-paper hover:text-signal">
                      {a.grantee_name || a.grantee}
                    </Link>
                    <span className="truncate text-[12px] leading-snug text-dim" title={a.program_name || undefined}>
                      {a.program_name || '—'}
                    </span>
                    <span className="text-right font-bold tabular-nums text-paper">{money(a.amount, a.amount_text)}</span>
                  </div>
                ))}
                {noAmountCount > 0 && (
                  <div className="serif-statement mt-3 text-[11px] text-faint">
                    {noAmountCount} of {given.length} tracked award{given.length === 1 ? '' : 's'} carry no disclosed amount.
                  </div>
                )}
              </>
            )}
          </div>

          {received.length > 0 && (
            <div className="mt-9">
              <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
                <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Awards Received</h2>
                <span className="coord shrink-0">{received.length} on file</span>
              </div>
              <div className={`grid ${AWARD_COLS} gap-4 border-b border-line py-2`}>
                <span className="coord">Date</span>
                <span className="coord">Funder</span>
                <span className="coord">Program</span>
                <span className="coord text-right">Amount</span>
              </div>
              {received.map((a) => (
                <div key={a.key} className={`grid ${AWARD_COLS} items-baseline gap-4 border-b border-line py-3`}>
                  <span className="text-[11px] tabular-nums text-faint">{dateShort(a.date)}</span>
                  {orgById.has(a.funder) ? (
                    <Link href={`/orgs/${a.funder}`} className="display truncate text-[14.5px] text-paper hover:text-signal">
                      {a.funder_name || a.funder}
                    </Link>
                  ) : (
                    <span className="display truncate text-[14.5px] text-paper">{a.funder_name || a.funder}</span>
                  )}
                  <span className="truncate text-[12px] leading-snug text-dim">{a.program_name || '—'}</span>
                  <span className="text-right font-bold tabular-nums text-paper">{money(a.amount, a.amount_text)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — ruled facts panel, focus, sources */}
        <aside className="min-w-0 py-7 lg:border-l lg:border-line lg:pl-11">
          <FactsPanel
            facts={[
              { label: 'Awards tracked', value: stats?.awards_given ?? 0 },
              {
                label: 'Disclosed total',
                value: money(stats?.awards_total_usd),
                note: given.length > 0 ? `${withAmount} of ${given.length} awards carry a public figure` : undefined,
              },
              { label: 'Grantees funded', value: stats?.grantees ?? 0 },
              {
                label: 'Live rounds',
                value: stats?.live_rounds ?? 0,
                note: (stats?.live_rounds ?? 0) === 0 ? 'no open or announced rounds on file' : undefined,
              },
            ]}
          />

          {org.funding?.focus && org.funding.focus.length > 0 && (
            <div className="border-b border-line py-5">
              <div className="coord mb-2.5">Focus Areas</div>
              <p className="serif-statement text-[16px] leading-[1.55] text-paper">{org.funding.focus.join(', ')}.</p>
            </div>
          )}

          {(org.funding?.typical_size || org.funding?.cadence) && (
            <div className="flex flex-col gap-1.5 border-b border-line py-5 text-[12px] text-dim">
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

          <SourcesList sources={org.sources} />
        </aside>
      </div>

      {coFunders.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-2 pb-16">
          <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
            <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Co-funders</h2>
            <span className="coord shrink-0">shared grantees, ranked</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {coFunders.map(({ org: co, sharedGrantees }, i) => (
              <Link
                key={co.id}
                href={`/orgs/${co.id}`}
                className={`flex items-baseline justify-between gap-3 border-b border-line py-2.5 transition-colors hover:bg-raised/40 ${
                  i % 2 === 0 ? 'sm:pr-6' : 'sm:pl-6'
                }`}
              >
                <span className="display truncate text-[14.5px] text-paper">{co.name}</span>
                <span className="coord shrink-0">{sharedGrantees} shared</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
