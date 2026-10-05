import Link from 'next/link';
import { loadPublicFundingProduct } from '@/lib/public-api-v2';
import { FundingRecord, type FundingRow } from './funding-record';

export async function ProgramFunding({ programId }: { programId: string }) {
  let product;
  try { product = await loadPublicFundingProduct(); }
  catch { return <section><h2>Funding evidence</h2><p>Funding evidence is temporarily unavailable. The existing program record remains available above.</p></section>; }
  if (!product) return null;
  const kinds = ['funding-events', 'process-metrics', 'program-terms'];
  const rows = kinds.flatMap(kind => (product.collections[kind] as unknown as FundingRow[]).filter(r => r.program === programId).map(row => ({ kind, row })));
  if (!rows.length) return <section><h2>Funding evidence</h2><p>Detailed funding records are not yet recorded for this program.</p><Link className="evidence-link" href={`/funding?kind=claims&program=${encodeURIComponent(programId)}`}>Read the program’s recorded facts and sources</Link></section>;
  return <section id="funding-evidence"><h2>Funding evidence</h2><p className="text-dim">{rows.length} recorded funding and process observations. Awards, payments and reported outcomes remain separate.</p>{rows.slice(0, 6).map(({ kind, row }) => <FundingRecord key={String(row.id)} kind={kind} row={row}/>)}<Link className="evidence-link" href={`/funding?program=${encodeURIComponent(programId)}`}>Browse all funding records for this program</Link></section>;
}
