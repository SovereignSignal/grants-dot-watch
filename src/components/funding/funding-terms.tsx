import { fundingAmountLabel } from '../../lib/funding-display';
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const words = (value: unknown) => array(value).filter((item): item is string => typeof item === 'string');

export function FundingTerms({ row }: { row: Row }) {
  const resources = array(row.resources).map(object), access = object(row.access);
  const sections = [['Eligibility', row.eligibility], ['Geography', row.geography], ['Requirements', row.requirements], ['Reporting', row.reporting_requirements]] as const;
  return <div className="mt-3 space-y-4 text-sm text-dim">
    {resources.map((resource, index) => {
      const value = object(resource.value), restrictions = words(resource.restrictions);
      return <div key={index} className="border-l-2 border-line pl-3" data-funding-resource={text(resource.kind)}>
        <p className="font-medium text-paper">{fundingAmountLabel(value)} <span className="font-normal text-dim">({text(resource.kind).replaceAll('_', ' ')})</span></p>
        {value.amount != null && text(value.amount_text) && <p className="mt-1">{text(value.amount_text)}</p>}
        {restrictions.map((restriction, i) => <p key={i} className="mt-1">{restriction}</p>)}
      </div>;
    })}
    {resources.length > 1 && <p>These are separately conditioned resource components. Do not add alternative tiers or treat non-cash support as cash.</p>}
    {text(row.round_name) && <p>Scope: {text(row.round_name)}.</p>}
    {text(access.stage) && <div><p className="text-paper">Entry stage: {text(access.stage)}</p><p>Recorded intake state: {text(access.state)}, noted {text(access.checked_on)}. This does not determine an individual applicant’s eligibility.</p></div>}
    {sections.some(([, values]) => words(values).length > 0) && <details><summary className="cursor-pointer text-paper">Eligibility and conditions</summary><dl className="mt-3 space-y-3">{sections.map(([label, values]) => words(values).length > 0 && <div key={label}><dt className="font-medium text-paper">{label}</dt><dd className="mt-1 space-y-1">{words(values).map((value, index) => <p key={index}>{value}</p>)}</dd></div>)}</dl></details>}
    {text(row.evidence_note) && <details><summary className="cursor-pointer text-paper">Evidence scope</summary><p className="mt-2">{text(row.evidence_note)}</p></details>}
  </div>;
}
