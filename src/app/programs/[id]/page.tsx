import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrg, getProgram, loadRegistry } from '@/lib/registry';
import { PageHeader, Card, RoundStatus, Empty, Coord } from '@/components/ui';
import { dateShort, money } from '@/lib/format';
import { MECHANISM_LABEL } from '@/components/ledger/labels';
import { ProgramStatusBadge } from '@/components/ledger/program-status';
import { timelineOrder } from '@/components/ledger/rounds';

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

  return (
    <>
      <PageHeader
        eyebrow={`PROGRAM · ${MECHANISM_LABEL[program.mechanism || 'other'] || program.mechanism || 'unspecified'} · org:${program.org}`}
        title={program.name}
        sub={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <ProgramStatusBadge status={program.status} />
            {program.apply_url ? (
              <a href={program.apply_url} target="_blank" rel="noreferrer" className="text-sm text-signal hover:underline">
                Apply →
              </a>
            ) : (
              <span className="text-sm text-faint">No public apply link on file.</span>
            )}
          </span>
        }
      />

      <div className="mx-auto max-w-6xl px-4 pb-16 space-y-10">
        {program.summary?.trim() && <p className="max-w-3xl text-dim">{program.summary.trim()}</p>}

        {(parent || children.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {parent && (
              <span className="text-sm text-dim">
                Sub-program of{' '}
                <Link href={`/programs/${parent.id}`} className="text-paper hover:text-signal">
                  {parent.name}
                </Link>
              </span>
            )}
            {children.length > 0 && (
              <span className="flex flex-wrap items-center gap-2 text-sm text-dim">
                Sub-programs:
                {children.map((c) => (
                  <Link key={c.id} href={`/programs/${c.id}`} className="text-paper hover:text-signal">
                    {c.name}
                  </Link>
                ))}
              </span>
            )}
          </div>
        )}

        <section className="starline pt-8">
          <h2 className="coord mb-4">Rounds</h2>
          {rounds.length === 0 ? (
            <Empty>No dated rounds on file yet — the wire feeds this over time.</Empty>
          ) : (
            <ol className="space-y-3">
              {rounds.map((r, i) => (
                <li key={`${r.name}-${i}`} className="rounded-md border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <RoundStatus status={r.status} />
                      <span className="font-medium">{r.name}</span>
                    </div>
                    <span className="font-mono text-xs text-dim">
                      {r.opens || r.closes ? `${dateShort(r.opens)} → ${dateShort(r.closes)}` : '—'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-dim">
                    {r.size && <span className="font-mono">{r.size}</span>}
                    {r.source && (
                      <a href={r.source} target="_blank" rel="noreferrer" className="hover:text-paper">
                        source ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="starline pt-8">
          <h2 className="coord mb-4">Awards from this program</h2>
          {programAwards.length === 0 ? (
            <Empty>No awards on file for this program yet.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="coord px-3 py-2 font-normal">Date</th>
                    <th className="coord px-3 py-2 font-normal">Grantee</th>
                    <th className="coord px-3 py-2 font-normal text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {programAwards.map((a) => (
                    <tr key={a.key} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-mono text-dim">{dateShort(a.date)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/grantees/${a.grantee}`} className="hover:text-signal">
                          {a.grantee_name || a.grantee}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{money(a.amount, a.amount_text)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {org && (
          <Card href={`/orgs/${org.id}`}>
            <Coord>funder</Coord>
            <div className="display text-lg font-semibold">{org.name}</div>
          </Card>
        )}
      </div>
    </>
  );
}
