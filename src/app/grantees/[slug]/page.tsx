import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGrantee, getOrg } from '@/lib/registry';
import { Empty, Card, Coord } from '@/components/ui';
import { dateShort, money } from '@/lib/format';
import { Breadcrumb } from '@/components/browse/breadcrumb';
import { Dossier, FactSep } from '@/components/browse/dossier';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const grantee = getGrantee(decodeURIComponent(slug));
  return { title: grantee?.name || 'Grantee' };
}

// Date | counterparty | program | amount — matches the master /awards table
// and every other award listing on the site (date leads, amount trails).
const AWARD_COLS = 'grid-cols-[86px_1fr_1.3fr_92px]';

export default async function GranteePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const grantee = getGrantee(decodeURIComponent(slug));
  if (!grantee) notFound();

  const awards = [...grantee.awards].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  return (
    <>
      <Breadcrumb
        trail={[{ label: 'Registry', href: '/' }, { label: 'Awards', href: '/awards' }, { label: grantee.name }]}
        note="Compiled from awards on file"
      />

      <Dossier
        compact
        kicker="Grantee — compiled automatically from awards, not independently profiled"
        name={grantee.name}
        factsLine={
          <>
            <span>
              {grantee.funders.length} funder{grantee.funders.length === 1 ? '' : 's'}
            </span>
            <FactSep />
            <span>{money(grantee.total_known)} known</span>
            <FactSep />
            <span>
              {grantee.awards.length} award{grantee.awards.length === 1 ? '' : 's'}
            </span>
          </>
        }
      />

      <div className="mx-auto max-w-6xl px-4 pt-6 pb-16">
        {grantee.org_id && (
          <Card href={`/orgs/${grantee.org_id}`} className="mb-8">
            <Coord>Full profile on file</Coord>
            <div className="mt-1 text-sm text-paper">This organization has its own detailed profile in the registry → /orgs/{grantee.org_id}</div>
          </Card>
        )}

        <section>
          <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
            <h2 className="text-[14px] font-bold tracking-[.03em] text-paper uppercase">Awards</h2>
            <span className="coord shrink-0">{awards.length} on file</span>
          </div>
          {awards.length === 0 ? (
            <Empty>No awards on file for this grantee.</Empty>
          ) : (
            <>
              <div className={`grid ${AWARD_COLS} gap-4 border-b border-line py-2`}>
                <span className="coord">Date</span>
                <span className="coord">Funder</span>
                <span className="coord">Program</span>
                <span className="coord text-right">Amount</span>
              </div>
              {awards.map((a) => (
                <div key={a.key} className={`grid ${AWARD_COLS} items-baseline gap-4 border-b border-line py-3`}>
                  <span className="text-[11px] tabular-nums text-faint">{dateShort(a.date)}</span>
                  <Link href={`/orgs/${a.funder}`} className="display truncate text-[14.5px] text-paper hover:text-signal">
                    {a.funder_name || a.funder}
                  </Link>
                  <span className="truncate text-[12px] leading-snug text-dim">
                    {a.program ? (
                      <Link href={`/programs/${a.program}`} className="hover:text-paper">
                        {a.program_name || a.program}
                      </Link>
                    ) : (
                      a.program_name || '—'
                    )}
                  </span>
                  <span className="text-right font-bold tabular-nums text-paper">{money(a.amount, a.amount_text)}</span>
                </div>
              ))}
            </>
          )}
        </section>

        <section className="mt-9">
          <div className="coord mb-2.5 border-b border-line pb-2">Funders</div>
          <p className="serif-statement text-[16px] leading-[1.6] text-paper">
            {grantee.funders.map((f, i) => {
              const org = getOrg(f);
              return (
                <span key={f}>
                  {i > 0 && ', '}
                  <Link href={`/orgs/${f}`} className="not-italic hover:text-signal">
                    {org?.name || f}
                  </Link>
                </span>
              );
            })}
          </p>
        </section>
      </div>
    </>
  );
}
