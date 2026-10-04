import Link from 'next/link';
import { PageHeader, Stat } from '@/components/ui';
import { FundingRecord, type FundingRow } from '@/components/funding/funding-record';
import { loadPublicFundingProduct } from '@/lib/public-api-v2';
import { queryProductCollection, EXTRA_COLLECTIONS } from '@/lib/funding-product.mjs';
import { queryFundingCollection } from '@/lib/funding-api.mjs';
import { pageMetadata } from '@/lib/site-metadata';

export const dynamic = 'force-dynamic';
export const metadata = pageMetadata('/funding', 'Funding evidence', 'Awards, program terms, selection data and source-backed funding history.');
const kinds = [['funding-events','Funding awards and events'],['process-metrics','Selection and process data'],['program-terms','Program terms'],['claims','Facts and evidence'],['relationships','Funding relationships'],['changes','History and changes'],['outputs','Linked projects']];
type Params = Record<string, string | string[] | undefined>;
const value = (p: Params, k: string) => typeof p[k] === 'string' ? p[k] as string : '';

export default async function FundingPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  let product;
  try { product = loadPublicFundingProduct(); }
  catch { return <><PageHeader eyebrow="THE FUNDING REGISTER" title="Funding evidence"/><p role="alert" className="mx-auto max-w-6xl p-6">Funding evidence is temporarily unavailable. <Link href="/programs" className="evidence-link">Browse the existing registry</Link>.</p></>; }
  if (!product) return <><PageHeader eyebrow="THE FUNDING REGISTER" title="Funding evidence" sub="The funding-data release is not enabled on this instance."/><p className="mx-auto max-w-6xl p-6"><Link href="/programs" className="evidence-link">Browse programs</Link> · <Link href="/data" className="evidence-link">API documentation</Link></p></>;
  const kind = kinds.some(([key]) => key === value(sp,'kind')) ? value(sp,'kind') : 'funding-events';
  const params = new URLSearchParams({ limit:'20' });
  for (const key of ['q','program','org','cursor']) if (value(sp,key)) params.set(key,value(sp,key));
  if (params.has('org') && !EXTRA_COLLECTIONS.includes(kind)) params.delete('org');
  let page: { data: FundingRow[]; meta: { total: number; next_cursor: string | null } };
  let error = '';
  try { page = EXTRA_COLLECTIONS.includes(kind) ? queryProductCollection(kind, params, product) : queryFundingCollection(kind, params, product.collections); }
  catch { page = { data:[], meta:{ total:0, next_cursor:null } }; error = 'The saved page or filter is no longer valid. Restart this view to read the current snapshot.'; }
  const next = new URLSearchParams(params); next.delete('limit'); next.set('kind',kind); if(page.meta.next_cursor) next.set('cursor',page.meta.next_cursor);
  const apiParams = new URLSearchParams(params);
  return <><PageHeader eyebrow="THE FUNDING REGISTER" title="Funding evidence" sub="Who received funding, what was offered, and how decisions were made. Every new observation retains its source. Unknown payments and outcomes stay unknown." right={<Link className="evidence-link" href="/data">Use the API →</Link>}/>
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <div className="grid grid-cols-2 gap-6 border-b border-line py-6 sm:grid-cols-4"><Stat label="Funding events" value={product.collections['funding-events'].length}/><Stat label="Process observations" value={product.collections['process-metrics'].length}/><Stat label="Program records" value={product.collections.programs.length}/><Stat label="Evidence claims" value={product.collections.claims.length}/></div>
      <form className="my-6 flex flex-wrap items-end gap-4" action="/funding"><label className="min-w-0 grow text-sm text-dim">Search<input name="q" defaultValue={value(sp,'q')} placeholder="Project, program or recipient" className="mt-1 block w-full border border-line bg-transparent p-3 text-paper"/></label><label className="text-sm text-dim">Dataset<select name="kind" defaultValue={kind} className="mt-1 block max-w-full border border-line bg-raised p-3 text-paper">{kinds.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>{value(sp,'program') && <input type="hidden" name="program" value={value(sp,'program')}/>}<button className="border border-paper px-5 py-3 text-sm text-paper" type="submit">Search records</button><Link className="evidence-link py-3 text-sm" href="/funding">Reset</Link></form>
      <div className="flex flex-wrap justify-between gap-3 pb-3 text-sm text-dim"><span>{page.meta.total} matching records{value(sp,'program') ? ` for ${value(sp,'program')}` : ''}</span><a className="evidence-link" href={`/api/v2/${kind}?${apiParams}`}>This view as JSON</a></div>
      {error && <p role="alert" className="border border-line p-4">{error} <Link href={`/funding?kind=${kind}`} className="evidence-link">Restart view</Link></p>}
      {!error && !page.data.length && <p className="border-t border-line py-10 text-dim">No records in this view. Missing data does not establish that funding, payments or outputs do not exist.</p>}
      {page.data.map(row => <FundingRecord key={String(row.id)} row={row} kind={kind}/>)}
      {page.meta.next_cursor && <Link className="mt-5 inline-block border border-paper px-5 py-3 text-paper" href={`/funding?${next}`}>Next records →</Link>}
      <footer className="mt-10 border-t border-line pt-5 text-sm text-dim">The full current program registry is available. Detailed funding histories cover the sources ingested so far, not every program. <Link href="/data#coverage" className="evidence-link">Coverage and interpretation</Link>.</footer>
    </div></>;
}
