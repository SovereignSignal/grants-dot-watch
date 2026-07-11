import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrg, getProgram, loadRegistry } from '@/lib/registry';
import { PageHeader, Empty, Coord } from '@/components/ui';
import { dateShort, money, ROUND_STATUS_LABEL, WIRE_COLOR } from '@/lib/format';
import { MECHANISM_LABEL } from '@/components/ledger/labels';
import { ProgramStatusBadge } from '@/components/ledger/program-status';
import { timelineOrder } from '@/components/ledger/rounds';
import { RoundRow } from '@/components/programs/round-row';
import { isClosingSoon, monthYearShort } from '@/components/programs/date-helpers';
import { Breadcrumb } from '@/components/browse/breadcrumb';

export async function generateStaticParams() {
  const { programs } = loadRegistry();
  return programs.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const program = getProgram(id);
  return { title: program?.name || 'Program' };
}

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const program = getProgram(id);
  if (!program) notFound();

  const org = getOrg(program.org);
  const { awards, programs } = loadRegistry();
  const nameLower = program.name.toLowerCase();
  const programAwards = awards
    .filter((a) => a.program === program.id || (a.program_name && a.program_name.toLowerCase() === nameLower))
    .sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    })
    .slice(0, 20);

  const rounds = timelineOrder(program.rounds || []);
  const parent = program.parent ? getProgram(program.parent) : null;
  const children = programs.filter((p) => p.parent === program.id);
  const wire = (program.wires || [])[0] || null;
  const wireColor = wire ? WIRE_COLOR[wire] : null;
  const mechanismLabel = MECHANISM_LABEL[program.mechanism || 'other'] || program.mechanism || 'Unspecified';

  return (
    <>
      <Breadcrumb
        trail={[
          { label: 'Registry', href: '/' },
          { label: 'Programs', href: '/programs' },
          ...(org ? [{ label: org.name, href: `/orgs/${org.id}` }] : []),
          { label: program.name },
        ]}
        note="Program profile — sourced & linked"
      />

      <PageHeader
        eyebrow={`Program · ${mechanismLabel} · ${org?.name || program.org}`}
        title={program.name}
        sub={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <ProgramStatusBadge status={program.status} />
            {program.apply_url ? (
              <a href={program.apply_url} target="_blank" rel="noreferrer" className="coord border-b border-line text-dim hover:border-paper hover:text-paper">
                Apply ↗
              </a>
            ) : (
              <span className="coord text-faint">No public apply link on file</span>
            )}
          </span>
        }
      />

      <div className="mx-auto max-w-6xl px-4 pb-16">
        {program.summary?.trim() && <p className="max-w-3xl pt-8 text-dim leading-relaxed">{program.summary.trim()}</p>}

        {(parent || children.length > 0) && (
          <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-line pt-4">
            {parent && (
              <span className="coord text-faint">
                Sub-program of{' '}
                <Link href={`/programs/${parent.id}`} className="text-dim hover:text-paper">
                  {parent.name}
                </Link>
              </span>
            )}
            {children.length > 0 && (
              <span className="coord flex flex-wrap items-center gap-2 text-faint">
                Sub-programs:
                {children.map((c) => (
                  <Link key={c.id} href={`/programs/${c.id}`} className="text-dim hover:text-paper">
                    {c.name}
                  </Link>
                ))}
              </span>
            )}
          </div>
        )}

        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
            <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Rounds</h2>
            <span className="coord shrink-0">{rounds.length.toLocaleString()} on file</span>
          </div>
          {rounds.length === 0 ? (
            <Empty>
              No rounds with a published date on file. Some programs accept applications on a rolling basis; others
              just haven&apos;t had a dated round surface yet.
            </Empty>
          ) : (
            <>
              <div className="hidden pt-2 pb-1 sm:grid sm:grid-cols-[72px_1fr_160px_110px_120px] sm:gap-x-5">
                <span className="coord">Closes</span>
                <span className="coord">Round</span>
                <span className="coord">Size</span>
                <span className="coord">Mechanism</span>
                <span className="coord text-right">Status</span>
              </div>
              {rounds.map((r, i) => {
                const dateStr = r.closes || r.opens || null;
                const closingSoon = isClosingSoon(r.closes);
                return (
                  <RoundRow
                    key={`${r.name}-${i}`}
                    day={dateStr ? new Date(dateStr + 'T00:00:00Z').getUTCDate() : null}
                    monthYear={dateStr ? monthYearShort(dateStr) : null}
                    closingSoon={closingSoon}
                    title={r.name}
                    size={r.size}
                    mechanism={mechanismLabel}
                    statusWord={ROUND_STATUS_LABEL[r.status] || r.status}
                    wireColor={wireColor}
                    sourceHref={r.source || undefined}
                  />
                );
              })}
            </>
          )}
        </section>

        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
            <h2 className="text-[14px] font-bold uppercase tracking-[.03em] text-paper">Awards From This Program</h2>
            <span className="coord shrink-0">{programAwards.length.toLocaleString()} shown</span>
          </div>
          {programAwards.length === 0 ? (
            <Empty>No awards on file for this program yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="coord py-2 pr-4 font-normal">Date</th>
                    <th className="coord py-2 pr-4 font-normal">Grantee</th>
                    <th className="coord py-2 pr-4 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {programAwards.map((a) => (
                    <tr key={a.key} className="border-b border-line last:border-0">
                      <td className="whitespace-nowrap py-2.5 pr-4 font-mono text-xs text-faint">{dateShort(a.date)}</td>
                      <td className="py-2.5 pr-4">
                        <Link href={`/grantees/${a.grantee}`} className="display text-paper hover:text-signal">
                          {a.grantee_name || a.grantee}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-4 text-right font-mono font-semibold text-paper">
                        {money(a.amount, a.amount_text)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {org && (
          <section className="mt-10 border-t border-line pt-6">
            <Coord>Funder</Coord>
            <Link href={`/orgs/${org.id}`} className="display mt-1 block text-lg font-semibold text-paper hover:text-signal">
              {org.name}
            </Link>
          </section>
        )}

        {program.sources?.length > 0 && (
          <section className="mt-10 border-t border-line pt-6">
            <h2 className="coord mb-3">Sources</h2>
            <ol className="m-0 list-none p-0">
              {program.sources.map((src, i) => (
                <li key={src} className="flex gap-2.5 border-t border-line py-2.5 text-[12px] leading-relaxed text-dim first:border-t-0">
                  <span aria-hidden className="shrink-0 font-bold text-faint">
                    {i + 1}.
                  </span>
                  <a
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 border-b border-line text-dim break-words hover:border-paper hover:text-paper"
                  >
                    {src.replace(/^https?:\/\//, '')}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </>
  );
}
