import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGrantee, getOrg } from '@/lib/registry';
import { PageHeader, Empty, Card, Coord } from '@/components/ui';
import { dateShort, money } from '@/lib/format';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const grantee = getGrantee(decodeURIComponent(slug));
  return { title: grantee?.name || 'Grantee' };
}

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
      <PageHeader
        eyebrow="GRANTEE · DERIVED FROM THE LEDGER"
        title={grantee.name}
        sub={`Backed by ${grantee.funders.length} funder${grantee.funders.length === 1 ? '' : 's'} · ${money(grantee.total_known)} known across ${grantee.awards.length} award${grantee.awards.length === 1 ? '' : 's'}.`}
      />

      <div className="mx-auto max-w-6xl px-4 pb-16 space-y-10">
        {grantee.org_id && (
          <Card href={`/orgs/${grantee.org_id}`}>
            <Coord>registry cross-reference</Coord>
            <div className="mt-1 text-sm text-paper">
              This grantee has a full registry file → /orgs/{grantee.org_id}
            </div>
          </Card>
        )}

        <section>
          <h2 className="coord mb-4">Awards</h2>
          {awards.length === 0 ? (
            <Empty>No awards on file for this grantee.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="coord px-3 py-2 font-normal">Date</th>
                    <th className="coord px-3 py-2 font-normal">Funder</th>
                    <th className="coord px-3 py-2 font-normal text-right">Amount</th>
                    <th className="coord px-3 py-2 font-normal">Program</th>
                  </tr>
                </thead>
                <tbody>
                  {awards.map((a) => (
                    <tr key={a.key} className="border-b border-line last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-dim">{dateShort(a.date)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/orgs/${a.funder}`} className="hover:text-signal">
                          {a.funder_name || a.funder}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{money(a.amount, a.amount_text)}</td>
                      <td className="px-3 py-2 text-dim">
                        {a.program ? (
                          <Link href={`/programs/${a.program}`} className="hover:text-signal">
                            {a.program_name || a.program}
                          </Link>
                        ) : (
                          a.program_name || '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="coord mb-4">Funders</h2>
          <div className="flex flex-wrap gap-2">
            {grantee.funders.map((f) => {
              const org = getOrg(f);
              return (
                <Link
                  key={f}
                  href={`/orgs/${f}`}
                  className="inline-flex items-center rounded-full border border-line px-3 py-1 text-xs text-dim transition-colors hover:border-faint hover:text-paper"
                >
                  {org?.name || f}
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
