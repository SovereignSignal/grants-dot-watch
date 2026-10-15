'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { FundingRecord, type FundingRow } from '@/components/funding/funding-record';
import { useAdminAuth } from '../admin-auth';

type Packet = { id: string; records: Record<string, FundingRow[]> };
type Pending = { id: string; title: string; program: string; proposed_change?: { _funding_v2?: { pack: Packet } } };
type Workspace = { features: { public_read: boolean; owner_write: boolean }; counts: Record<string, number>; sources: { id: string; url: string; program: string }[]; coverage: FundingRow[]; pending: Pending[] };
type Compilation = { packets: Packet[]; report: Record<string, unknown>; held: FundingRow[]; source_failures: FundingRow[]; coverage_gaps: FundingRow[]; capture_receipt?: Record<string, unknown> | null };
type Preview = { plan_digest: string; added: Record<string, number>; unchanged: Record<string, number>; proposal: { signal_id: string } };
const errorText = (value: unknown) => value instanceof Error ? value.message : 'The request failed.';

export default function FundingWorkspacePage() {
  const { getAuthHeaders } = useAdminAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [compiled, setCompiled] = useState<Compilation | null>(null);
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [source, setSource] = useState('numfocus-sdg');
  const [fund, setFund] = useState('36');
  const [archive, setArchive] = useState(false);
  const [coverageQuery, setCoverageQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useCallback(async (path: string, body?: unknown) => {
    const headers = await getAuthHeaders();
    const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || `Request failed (${response.status})`);
    return result;
  }, [getAuthHeaders]);
  const refresh = useCallback(async () => { setWorkspace(await request('/api/desk/funding/workspace')); }, [request]);
  useEffect(() => { let active = true; request('/api/desk/funding/workspace').then(value => { if (active) setWorkspace(value); }).catch(e => { if (active) setError(errorText(e)); }); return () => { active = false; }; }, [request]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const compile = async (body: unknown) => perform(async () => {
    const result: Compilation = await request('/api/desk/funding/workspace', body);
    setCompiled(result); setSelected(0); setPreview(null); setQueued(null);
    setNotice(`${result.report.candidate_records} candidate records prepared. Nothing has been approved or published.`);
  });
  const packet = compiled?.packets[selected];
  const packetRows = useMemo(() => packet ? Object.entries(packet.records).flatMap(([kind, rows]) => rows.map(row => ({ kind, row: { ...row, id: row.key } }))) : [], [packet]);
  const filteredCoverage = workspace?.coverage.filter(row => `${row.name} ${row.org}`.toLowerCase().includes(coverageQuery.toLowerCase())) || [];
  const writes = workspace?.features.owner_write === true;
  return <><PageHeader eyebrow="OWNER WORKSPACE" title="Funding data" sub="Review evidence, prepare source-backed records, and approve exact packets. Refresh and compilation never publish data." right={<Link href="/admin/desk" className="evidence-link">Main Desk →</Link>}/>
    <div className="mx-auto max-w-6xl space-y-8 px-4 pb-16 pt-6">
      {error && <p role="alert" className="border border-line p-4 text-paper">{error} <button className="evidence-link ml-2" onClick={() => perform(refresh)} disabled={busy}>Retry status</button></p>}
      {notice && <p role="status" className="border border-line p-4 text-paper">{notice}</p>}
      <div className="flex flex-wrap items-center gap-5 text-sm text-dim"><span>Public API: {workspace ? workspace.features.public_read ? 'enabled' : 'disabled' : 'loading'}</span><span>Owner imports: {workspace ? writes ? 'enabled' : 'disabled' : 'loading'}</span><Link className="evidence-link" href="/funding">Public funding explorer</Link><Link className="evidence-link" href="/data">API documentation</Link></div>
      <section className="border-t border-line pt-6"><h2 className="text-xl text-paper">Prepare a reviewed source</h2><p className="mt-2 text-sm text-dim">The retained research and source responses are candidates. Conflicting values, uncertain recipients and incomplete source coverage remain visible for review.</p><div className="mt-4 flex flex-wrap gap-3"><button disabled={busy || !writes} onClick={() => compile({ action:'compile-retained' })} className="border border-paper px-4 py-2 disabled:opacity-40">Compile retained research</button><label className="cursor-pointer border border-line px-4 py-2">Upload source bundle<input type="file" accept=".json,application/json" className="sr-only" disabled={busy || !writes} onChange={e => { const file = e.target.files?.[0]; if (!file) return; perform(async () => { if (file.size > 2 * 1024 * 1024) throw new Error('Source bundle exceeds 2 MiB'); const bundle = JSON.parse(await file.text()); const result = await request('/api/desk/funding/workspace', { action:'compile-upload', bundle }); setCompiled(result); setSelected(0); setPreview(null); setQueued(null); setNotice('Uploaded representations compiled. Review each packet before queueing.'); }); }}/></label></div>
        <div className="mt-5 flex flex-wrap items-end gap-3"><label className="text-sm text-dim">First-party source<select className="mt-1 block max-w-full border border-line bg-raised px-3 py-2 text-paper" value={source} onChange={e => setSource(e.target.value)}>{workspace?.sources.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>{source === 'microsoft-foss' && <><label className="text-sm text-dim">Fund number<input type="number" min="1" max="100000" className="mt-1 block w-24 border border-line bg-transparent p-2 text-paper" value={fund} disabled={archive} onChange={e => setFund(e.target.value)}/></label><label className="py-2 text-sm"><input type="checkbox" checked={archive} onChange={e => setArchive(e.target.checked)}/> Supported archive (1 to 36)</label></>}<button disabled={busy || !writes} onClick={() => compile({ action:'refresh', source, ...(source === 'microsoft-foss' ? { fund:Number(fund), archive } : {}) })} className="border border-paper px-4 py-2 disabled:opacity-40">Fetch and prepare</button></div><p className="mt-3 text-xs text-dim">Microsoft uses at most two source requests; each supported HTML table uses one. Calls are bounded and rate-limited per running process. With AWARD_SOURCES_ENABLED=1 the daily ingest also refreshes every source and queues new packets here as pending items. Nothing is ever approved automatically.</p>
      </section>
      {compiled && <section className="border-t border-line pt-6"><h2 className="text-xl text-paper">Candidate review</h2><div className="mt-3 flex flex-wrap gap-5 text-sm text-dim"><span>{String(compiled.report.candidate_records)} records</span><span>{compiled.packets.length} packets</span><span>{compiled.held.length} held</span><span>{compiled.coverage_gaps.length} coverage gaps</span><span>{compiled.source_failures.length} source failures</span></div>
        {(compiled.held.length > 0 || compiled.coverage_gaps.length > 0 || compiled.source_failures.length > 0 || compiled.capture_receipt) && <details className="mt-4"><summary className="cursor-pointer">Capture receipt, holds and coverage gaps</summary><pre className="mt-3 max-h-80 overflow-auto border border-line p-3 text-xs">{JSON.stringify({ capture:compiled.capture_receipt, held:compiled.held, coverage_gaps:compiled.coverage_gaps, source_failures:compiled.source_failures },null,2)}</pre></details>}
        {packet && <><label className="mt-5 block text-sm text-dim">Packet<select value={selected} onChange={e => { setSelected(Number(e.target.value)); setPreview(null); setQueued(null); }} className="mt-1 block w-full border border-line bg-raised p-3 text-paper">{compiled.packets.map((p,i) => <option key={p.id} value={i}>{p.id} ({Object.values(p.records).reduce((n,rows)=>n+rows.length,0)} records)</option>)}</select></label>
          <p className="mt-3 text-sm text-dim">Review the normalized records and source evidence below. Amounts are not payment confirmations. Queueing requires a fresh comparison with the current canonical snapshot.</p>
          <div className="mt-4 flex flex-wrap gap-3"><button disabled={busy || !writes} className="border border-paper px-4 py-2 disabled:opacity-40" onClick={() => perform(async () => { const result = await request('/api/desk/funding', { mode:'preview', pack:packet }); setPreview(result); setQueued(null); setNotice('Current snapshot previewed. Check additions and unchanged counts before queueing.'); })}>Preview against live data</button>
          <button disabled={busy || !writes || !preview} className="border border-paper px-4 py-2 disabled:opacity-40" onClick={() => perform(async () => { if(!preview) return; await request('/api/desk/funding', { mode:'queue', pack:packet, plan_digest:preview.plan_digest }); const queue = await request('/api/desk/queue?state=pending'); const match = queue.proposals.find((p: {signal_id?:string}) => p.signal_id === preview.proposal.signal_id); if(!match) throw new Error('Packet queued, but its proposal could not be resolved. Inspect the main Desk.'); setQueued(match.id); setNotice('Packet queued for an owner decision. It is not published.'); await refresh(); })}>Queue reviewed packet</button>
          {queued && <button disabled={busy || !writes} className="border-2 border-paper px-4 py-2 disabled:opacity-40" onClick={() => perform(async () => { await request('/api/desk/decide', { id:queued, decision:'approved', note:'Owner approved the displayed source-backed funding packet after reviewing its normalized records and evidence.' }); setPreview(null); setQueued(null); setNotice('Packet approved. The durable Desk outbox now protects these records. Re-preview the next packet against this updated snapshot.'); await refresh(); })}>Approve this packet</button>}</div>
          {preview && <pre className="mt-4 overflow-auto border border-line p-3 text-xs">{JSON.stringify({ additions:preview.added, unchanged:preview.unchanged, plan_digest:preview.plan_digest },null,2)}</pre>}
          <div className="mt-5">{packetRows.map(({kind,row}) => <FundingRecord key={String(row.id)} row={row} kind={kind}/>)}</div>
        </>}
      </section>}
      {!!workspace?.pending.length && <section className="border-t border-line pt-6"><h2 className="text-xl text-paper">Queued funding packets</h2><p className="mt-2 text-sm text-dim">Use the main Desk to inspect or decide existing queued packets. Changed snapshots require another preview.</p>{workspace.pending.map(p => <div className="border-b border-line py-3" key={p.id}><Link className="evidence-link" href="/admin/desk">{p.id}: {p.title}</Link></div>)}</section>}
      <section className="border-t border-line pt-6"><h2 className="text-xl text-paper">Organization coverage</h2><p className="mt-2 text-sm text-dim">Every live registry organization is included. Zero means no records in this dataset, not proof that no funding exists. The original research review is not a complete award-history audit.</p><label className="mt-4 block text-sm text-dim">Filter organizations<input value={coverageQuery} onChange={e => setCoverageQuery(e.target.value)} className="mt-1 w-full border border-line bg-transparent p-3 text-paper" placeholder="Organization name"/></label><div className="mt-4 max-h-[38rem] overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{['Organization','Programs','Typed terms','Funding events','Process data','Evidence fields'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{filteredCoverage.map(row => <tr key={String(row.id)} className="border-t border-line">{['name','programs','programs_with_typed_terms','funding_events','process_observations','field_assertions'].map(key => <td key={key} className="p-2">{String(row[key] ?? 'Unknown')}</td>)}</tr>)}</tbody></table></div></section>
    </div></>;
}
