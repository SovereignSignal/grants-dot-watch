import Link from 'next/link';
import { loadPublicFundingProduct } from '@/lib/public-api-v2';
import { FundingRecord, type FundingRow } from './funding-record';

type FundingProduct = Awaited<ReturnType<typeof loadPublicFundingProduct>>;

export function ProgramFunding({ programId, product, unavailable = false }: { programId: string; product: FundingProduct; unavailable?: boolean }) {
  if (unavailable) return <section><h2>Funding evidence</h2><p>Funding evidence is temporarily unavailable. The existing program record remains available above.</p></section>;
  if (!product) return null;
  const programName = (product.collections.programs as { id: string; name: string }[]).find(p => p.id === programId)?.name;
  const kinds = ['funding-events', 'process-metrics', 'program-terms'];
  const rows = kinds.flatMap(kind => (product.collections[kind] as unknown as FundingRow[]).filter(r => r.program === programId).map(row => ({ kind, row })));
  if (!rows.length) return <section><h2>Funding evidence</h2><p>Detailed funding records are not yet recorded for this program.</p><Link className="evidence-link" href={`/funding?kind=claims&program=${encodeURIComponent(programId)}`}>Read the program’s recorded facts and sources</Link></section>;
  return <section id="funding-evidence"><h2>Funding evidence</h2><p className="text-dim">{rows.length} recorded funding and process observations. Awards, payments and reported outcomes remain separate.</p>{rows.slice(0, 6).map(({ kind, row }) => <FundingRecord key={String(row.id)} kind={kind} row={row} programName={programName}/>)}<Link className="evidence-link" href={`/funding?program=${encodeURIComponent(programId)}`}>Browse all funding records for this program</Link></section>;
}
