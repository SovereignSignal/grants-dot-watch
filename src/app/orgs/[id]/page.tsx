import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadRegistry, getOrg, programsOf, awardsGivenBy } from '@/lib/registry';
import { Empty } from '@/components/ui';
import { orgStatusLabel, orgTypeLabel } from '@/components/browse/registry-helpers';
import { Breadcrumb } from '@/components/browse/breadcrumb';
import { Dossier, FactSep } from '@/components/browse/dossier';
import { SourceCitations, SourcesList } from '@/components/browse/sources';
import { CadenceLane, type CadenceRow } from '@/components/browse/cadence-lane';
import { pageMetadata } from '@/lib/site-metadata';
import { AwardLedger } from '@/components/awards/award-ledger';
import { parsePage } from '@/lib/pagination';
import { param, type SearchParams } from '@/components/ledger/query';
import { httpUrl } from '@/lib/opportunities';
import { productDateISO, productYear } from '@/lib/round-state';
import { factDate } from '@/lib/program-facts';
import type { Program, Round } from '@/lib/types';


export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = getOrg(id);
  return pageMetadata(`/orgs/${id}`, o ? o.name : 'Organization', o?.profile || 'Funding organization profile on grants.watch.');
}

const MECHANISM_LABEL: Record<NonNullable<Program['mechanism']>, string> = {
  grants: 'Grants',
  retro: 'Retro funding',
  quadratic: 'Quadratic funding',
  prize: 'Prize',
  fellowship: 'Fellowship',
  incubator: 'Incubator',
  rfp: 'RFP',
  other: 'Other',
};

// Rounds the registry has marked as not real (withdrawn, duplicate) never render.
function liveRounds(program: Program): Round[] {
  return (program.rounds || []).filter((r) => r.status !== 'withdrawn' && r.status !== 'duplicate');
}

function latestSize(program: Program): string | null {
  const sized = liveRounds(program).filter((r) => r.size?.trim());
  return sized.length > 0 ? sized[sized.length - 1].size!.trim() : null;
}

function datedIn(round: Round, year: number): boolean {
  const d = round.closes || round.opens;
  return Boolean(d && d.slice(0, 4) === String(year));
}

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
      <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">{title}</h2>
      {note && <span className="coord shrink-0">{note}</span>}
    </div>
  );
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

  const systemById = new Map(registry.systems.map((s) => [s.id, s]));

  const programs = programsOf(org.id);
  const given = awardsGivenBy(org.id);

  const primarySystem = org.systems?.[0] ? systemById.get(org.systems[0]) : null;
  const systemNames = (org.systems || []).map((sid) => systemById.get(sid)?.name).filter((n): n is string => Boolean(n));

  const today = productDateISO();
  const year = productYear();
  const upcoming = programs
    .flatMap((program) => liveRounds(program).filter((r) => r.closes && r.closes >= today).map((round) => ({ program, round })))
    .sort((a, b) => (a.round.closes as string).localeCompare(b.round.closes as string));
  const activePrograms = programs.filter((p) => p.status === 'active' || p.status === 'announced');
  const pastPrograms = programs.filter((p) => !activePrograms.includes(p));
  // Timeline only for programs with a round dated this year; nothing else is plotted.
  const cadenceRows: CadenceRow[] = programs
    .filter((p) => liveRounds(p).some((r) => datedIn(r, year)))
    .map((p) => ({ program: { ...p, rounds: liveRounds(p) }, grantCount: 0 }));

  const domain = org.website ? org.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
  const applyUrl = httpUrl(org.funding?.apply_url);
  const applyHost = applyUrl ? new URL(applyUrl).hostname.replace(/^www\./, '') : null;

  return (
    <article className="program-dossier">
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
        action={
          applyUrl && (
            <a className="primary-link main-action" href={applyUrl} target="_blank" rel="noreferrer">
              Apply on {applyHost}
            </a>
          )
        }
      />

      {/* Everything below runs full-width so long program and award ledgers
          keep enough room for names, amounts, and source evidence. */}
      <div className="pb-16">
        {upcoming.length > 0 && (
          <section className="pt-7" data-testid="org-upcoming">
            <SectionHead title="Open & upcoming" note={`${upcoming.length} deadline${upcoming.length === 1 ? '' : 's'} ahead`} />
            <ul>
              {upcoming.map(({ program, round }) => {
                const apply = httpUrl(program.apply_url) || applyUrl;
                return (
                  <li key={`${program.id}-${round.name}`} className="flex flex-col gap-1 border-b border-line py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                      <a href={`/programs/${program.id}`} className="display text-[15px] leading-tight text-paper hover:text-signal">
                        {program.name}
                      </a>
                      <div className="mt-0.5 text-[12px] text-dim">{round.name}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
                      {round.size?.trim() && <span className="text-paper">{round.size.trim()}</span>}
                      <span className="coord">Deadline {factDate(round.closes as string)}</span>
                      {apply && (
                        <a href={apply} target="_blank" rel="noreferrer" className="border-b border-line text-dim hover:text-paper">
                          Apply ↗
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="pt-7">
          <SectionHead title="Programs" note={activePrograms.length > 0 ? `${activePrograms.length} active` : undefined} />
          {programs.length === 0 ? (
            <Empty>No programs on file for this org yet.</Empty>
          ) : activePrograms.length === 0 ? (
            <p className="py-3 text-[13px] text-dim">No active programs right now. Past programs are listed below.</p>
          ) : (
            <ul>
              {activePrograms.map((program) => {
                const size = latestSize(program);
                const mechanism = program.mechanism ? MECHANISM_LABEL[program.mechanism] : null;
                return (
                  <li key={program.id} className="border-b border-line py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <a href={`/programs/${program.id}`} className="display text-[15px] leading-tight text-paper hover:text-signal">
                        {program.name}
                      </a>
                      {(mechanism || size) && (
                        <span className="coord shrink-0">{[mechanism, size].filter(Boolean).join(' · ')}</span>
                      )}
                    </div>
                    {program.summary?.trim() && <p className="mt-1 text-[13px] leading-snug text-dim">{program.summary.trim()}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {cadenceRows.length > 0 && (
          <section className="pt-7">
            <SectionHead title={`${year} timeline`} />
            <CadenceLane rows={cadenceRows} year={year} showMeta={false} />
          </section>
        )}

        {pastPrograms.length > 0 && (
          <section className="pt-7">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
                <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Past rounds</h2>
                <span className="coord shrink-0">
                  {pastPrograms.length} program{pastPrograms.length === 1 ? '' : 's'} <span className="group-open:hidden">· show</span><span className="hidden group-open:inline">· hide</span>
                </span>
              </summary>
              <ul>
                {pastPrograms.map((program) => {
                  const rounds = liveRounds(program);
                  const size = latestSize(program);
                  return (
                    <li key={program.id} className="border-b border-line py-2.5">
                      <a href={`/programs/${program.id}`} className="display text-[14px] leading-tight text-paper hover:text-signal">
                        {program.name}
                      </a>
                      {(rounds.length > 0 || size) && (
                        <div className="mt-0.5 text-[12px] text-dim">
                          {rounds
                            .map((r) => (r.closes ? `${r.name} (closed ${factDate(r.closes)})` : r.name))
                            .join(' · ')}
                          {size && rounds.length === 0 ? size : ''}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          </section>
        )}

        {given.length > 0 && (
          <AwardLedger
            awards={given}
            requestedPage={parsePage(param(sp, 'awardPage'))}
            basePath={`/orgs/${org.id}`}
            programs={registry.programs}
            orgIds={new Set(registry.orgs.map((item) => item.id))}
            showProgram
          />
        )}

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
    </article>
  );
}
