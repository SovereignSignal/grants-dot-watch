import Link from 'next/link';
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
  try { product = await loadPublicFundingProduct(); }
  catch { return <div className="directory-shell"><section className="directory-hero"><div className="hero-kicker">The funding register</div><div className="hero-line"><h1>Funding evidence</h1></div></section><p role="alert" className="border-t border-line py-6">Funding evidence is temporarily unavailable. <Link href="/programs" className="evidence-link">Browse the existing registry</Link>.</p></div>; }
  if (!product) return <div className="directory-shell"><section className="directory-hero"><div className="hero-kicker">The funding register</div><div className="hero-line"><h1>Funding evidence</h1></div><p>The funding-data release is not enabled on this instance.</p></section><p className="border-t border-line py-6"><Link href="/programs" className="evidence-link">Browse programs</Link> · <Link href="/data" className="evidence-link">API documentation</Link></p></div>;
  const kind = kinds.some(([key]) => key === value(sp,'kind')) ? value(sp,'kind') : 'funding-events';
  const params = new URLSearchParams({ limit:'20' });
  for (const key of ['q','program','org','cursor']) if (value(sp,key)) params.set(key,value(sp,key));
  if (params.has('org') && !EXTRA_COLLECTIONS.includes(kind)) params.delete('org');
  let page: { data: FundingRow[]; meta: { total: number; next_cursor: string | null } };
  let error = '';
  try { page = EXTRA_COLLECTIONS.includes(kind) ? queryProductCollection(kind, params, product) : queryFundingCollection(kind, params, product.collections); }
  catch { page = { data:[], meta:{ total:0, next_cursor:null } }; error = 'The saved page or filter is no longer valid. Restart this view to read the current snapshot.'; }
  const next = new URLSearchParams(params); next.delete('limit'); next.set('kind',kind); if(page.meta.next_cursor) next.set('cursor',page.meta.next_cursor);
  const programNames = new Map((product.collections.programs as { id: string; name: string }[]).map(p => [p.id, p.name]));
  const apiParams = new URLSearchParams(params);
  return <div className="directory-shell">
    <section className="directory-hero"><div className="hero-kicker">The funding register</div>
      <div className="hero-line"><h1>Funding evidence</h1></div>
      <p>Who received funding, what was offered, and how decisions were made. Every new observation retains its source. Unknown payments and outcomes stay unknown.</p>
      <div className="directory-statline"><span><b>{product.collections['funding-events'].length.toLocaleString()}</b> funding events</span><span><b>{product.collections['process-metrics'].length.toLocaleString()}</b> process observations</span><span><b>{product.collections.programs.length.toLocaleString()}</b> program records</span><span><b>{product.collections.claims.length.toLocaleString()}</b> evidence claims</span><span><Link className="underline" href="/data">Use the API →</Link></span></div>
    </section>
    <div className="pb-16">
      <p className="mt-4 text-sm text-dim">Funding events track recommendations, awards and payments as separate observations. The <Link className="evidence-link" href="/awards">awards ledger</Link> includes additional historical awards; these counts cover different records.</p>
      <form className="my-6 flex flex-wrap items-end gap-4" action="/funding"><label className="min-w-0 grow text-sm text-dim">Search<input name="q" defaultValue={value(sp,'q')} placeholder="Project, program or recipient" className="mt-1 block w-full border border-line bg-transparent p-3 text-paper"/></label><label className="text-sm text-dim">Dataset<select name="kind" defaultValue={kind} className="mt-1 block max-w-full border border-line bg-raised p-3 text-paper">{kinds.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>{value(sp,'program') && <input type="hidden" name="program" value={value(sp,'program')}/>}<button className="border border-paper px-5 py-3 text-sm text-paper" type="submit">Search records</button><Link className="evidence-link py-3 text-sm" href="/funding">Reset</Link></form>
      <div className="flex flex-wrap justify-between gap-3 pb-3 text-sm text-dim"><span>{page.meta.total.toLocaleString()} matching record{page.meta.total === 1 ? '' : 's'}{value(sp,'program') ? ` for ${programNames.get(value(sp,'program')) || value(sp,'program')}` : ''}</span><a className="evidence-link" href={`/api/v2/${kind}?${apiParams}`}>This view as JSON</a></div>
      {error && <p role="alert" className="border border-line p-4">{error} <Link href={`/funding?kind=${kind}`} className="evidence-link">Restart view</Link></p>}
      {!error && !page.data.length && <p className="border-t border-line py-10 text-dim">No records in this view. Missing data does not establish that funding, payments or outputs do not exist.</p>}
      {page.data.map(row => <FundingRecord key={String(row.id)} row={row} kind={kind} programName={programNames.get(String(row.program))}/>)}
      {page.meta.next_cursor && <Link className="mt-5 inline-block border border-paper px-5 py-3 text-paper" href={`/funding?${next}`}>Next records →</Link>}
      <footer className="mt-10 border-t border-line pt-5 text-sm text-dim">The full current program registry is available. Detailed funding histories cover the sources ingested so far, not every program. <Link href="/data#coverage" className="evidence-link">Coverage and interpretation</Link>.</footer>
    </div></div>;
}
