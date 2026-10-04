import Link from 'next/link';
import { FundingTerms } from './funding-terms';

export type FundingRow = Record<string, unknown>;
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const object = (value: unknown): FundingRow => value && typeof value === 'object' && !Array.isArray(value) ? value as FundingRow : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const safeUrl = (value: unknown) => {
  try { const u = new URL(string(value)); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; }
  catch { return null; }
};
const display = (value: unknown): string => value == null ? 'Not recorded' : typeof value === 'string' ? value : JSON.stringify(value);

export function FundingRecord({ row, kind }: { row: FundingRow; kind: string }) {
  const amount = object(row.amount), provenance = object(row.provenance);
  const name = string(row.recipient_name) || string(row.program_name) || string(row.name) || string(row.label) || string(row.program) || 'Funding record';
  const program = string(row.program), source = safeUrl(row.source);
  const recordApi = string(row.api);
  const monetary = amount.amount == null ? 'Amount not disclosed' : `${string(amount.currency)} ${string(amount.amount)}${amount.unit !== 'currency' ? ` ${string(amount.unit)}` : ''}`.trim();
  const evidenceSources = array(provenance.sources).map(object);
  const assertions = array(provenance.assertions).map(object);
  return <article className="min-w-0 border-t border-line py-5" data-funding-record={string(row.id)}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><p className="coord mb-1">{string(row.event_type) || string(row.kind) || kind.replaceAll('-', ' ')}{row.award_period ? ` · ${display(row.award_period)}` : ''}</p>
        <h3 className="break-words text-lg font-semibold text-paper">{program ? <Link href={`/programs/${encodeURIComponent(program)}`}>{name}</Link> : name}</h3>
      </div>
      {kind === 'funding-events' && <div className="text-right text-lg tabular-nums text-paper">{monetary}<p className="coord mt-1">{row.payment_date ? `Payment recorded ${display(row.payment_date)}` : 'Payment not established'}</p></div>}
    </div>
    {row.purpose ? <p className="mt-2 text-dim">{display(row.purpose)}</p> : null}
    {kind === 'process-metrics' && <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">{[['Period', row.period], ['Eligible applications', row.eligible_applications], ['Offers', row.offers], ['Published rate', row.published_percent]].map(([label, value]) => <div key={String(label)}><dt className="coord">{String(label)}</dt><dd className="mt-1 text-lg tabular-nums text-paper">{display(value)}</dd></div>)}</dl>}
    {kind === 'program-terms' && <><p className="mt-2 text-dim">{array(row.instruments).join(', ')} · {array(row.capital_forms).join(', ')} · {display(row.intake_mode)}</p><FundingTerms row={row}/></>}
    {kind === 'claims' && <div className="mt-3"><code className="break-all text-xs text-dim">{display(row.field)}</code><p className="mt-1 break-words text-paper">{display(row.value)}</p><p className="coord mt-2">{display(row.method)} · {display(row.evidence_state)}</p></div>}
    {kind === 'relationships' && <p className="mt-2 break-words text-dim">{display(row.from)} → {display(row.role).replaceAll('_', ' ')} → {display(row.to)}</p>}
    {kind === 'changes' && <p className="mt-2 text-dim">{row.summary ? display(row.summary) : `Evidence recorded: ${display(row.observed_on)}. Effective date: ${display(row.effective_on)}.`}</p>}
    {kind === 'outputs' && <p className="mt-2 text-dim">A linked funded project. Delivery and causal impact are not established by this link.</p>}
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {source && <a className="evidence-link break-all" href={source} target="_blank" rel="noreferrer">Source: {new URL(source).hostname}</a>}
      {safeUrl(row.recipient_url || row.url) && <a className="evidence-link" href={safeUrl(row.recipient_url || row.url)!} target="_blank" rel="noreferrer">Project</a>}
      {recordApi.startsWith('/api/v2/') && <a className="evidence-link" href={recordApi}>JSON record</a>}
      {program && <Link className="evidence-link" href={`/funding?program=${encodeURIComponent(program)}&kind=${encodeURIComponent(kind)}`}>Program funding</Link>}
    </div>
    {kind === 'process-metrics' && <p className="mt-3 text-sm text-dim">Exclusions: {array(row.exclusions).join('; ') || 'Not recorded'}. Historical cohort data does not estimate an individual applicant’s chances.</p>}
    {(assertions.length > 0 || array(row.sources).length > 0) && <details className="mt-4 text-sm"><summary className="cursor-pointer text-paper">Evidence and field provenance {assertions.length ? `(${assertions.length} fields)` : ''}</summary>
      <div className="mt-3 space-y-3 break-words text-dim">{evidenceSources.map(s => <p key={string(s.id)}>{safeUrl(s.url) && <a className="evidence-link break-all" href={string(s.url)} target="_blank" rel="noreferrer">{string(s.url)}</a>}<br/>{display(s.scope)} · observed {display(s.observed_on)} · reuse {display(s.redistribution)}</p>)}
      {kind === 'claims' && array(row.sources).map(object).map((s, i) => <p key={i}>{safeUrl(s.url) && <a className="evidence-link break-all" href={string(s.url)} target="_blank" rel="noreferrer">{string(s.url)}</a>} · observed {display(s.observed_on)}{s.line ? ` · representation line ${display(s.line)}` : ''}</p>)}
      {assertions.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Field</th><th className="p-2">Treatment</th><th className="p-2">Evidence lines</th></tr></thead><tbody>{assertions.map(a => <tr key={string(a.field)} className="border-t border-line"><td className="break-all p-2"><code>{string(a.field)}</code></td><td className="p-2">{string(a.rule).replaceAll('_', ' ')}</td><td className="p-2">{array(a.evidence).map(object).map(e => display(e.line)).join(', ')}</td></tr>)}</tbody></table></div>}
      <p>Source hashes preserve consistency. They do not prove complete coverage, payment, impact or permission to republish source text.</p></div>
    </details>}
  </article>;
}
