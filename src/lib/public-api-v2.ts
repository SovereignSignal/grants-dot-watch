import { loadRegistry } from './registry';
import { currentRounds, productDateISO } from './round-state';
import type { FundingEvent, ProcessMetric, Program, RegistryIndex } from './types';

export const API_V2_VERSION = 'v2';

function sourceState(source: string | null | undefined, checked?: string | null) {
  return { source: source || null, checked_on: checked || null };
}

export function v2Program(p: Program, today = productDateISO()) {
  return {
    id:p.id,name:p.name,org:p.org,parent:p.parent||null,systems:p.systems||[],wires:p.wires||[],
    status:p.status,mechanism:p.mechanism||null,terms:p.terms||null,apply_url:p.apply_url||null,
    summary:p.summary,rounds:p.rounds||[],live_rounds:currentRounds(p,today),sources:p.sources||[],
    evidence:{review:p.review||null},href:`/programs/${p.id}`,api:`/api/v2/programs/${p.id}`
  };
}

export function actionableOpportunities(registry: RegistryIndex = loadRegistry(), today = productDateISO()) {
  return registry.programs.flatMap(program => currentRounds(program,today).map(round => ({
    id:`${program.id}:${round.name}`,program_id:program.id,program_name:program.name,org:program.org,
    mechanism:program.mechanism||null,capital_form:program.terms?.capital_form||null,
    selection_model:program.terms?.selection_model||null,intake_mode:program.terms?.intake_mode||null,
    apply_url:program.apply_url||null,round,eligibility:program.terms?.eligibility||[],
    geography:program.terms?.geography||[],requirements:program.terms?.requirements||[],
    source_state:sourceState(round.source||program.review?.source, round.source_checked_on||program.review?.checked_on),
    href:`/programs/${program.id}`
  })));
}

export function v2Index(registry: RegistryIndex = loadRegistry()) {
  return {name:'grants.watch',version:API_V2_VERSION,as_of:productDateISO(),updated_at:registry.updatedAt,counts:registry.counts,
    endpoints:{orgs:'/api/v2/orgs',programs:'/api/v2/programs',opportunities:'/api/v2/opportunities',funding_events:'/api/v2/funding-events',process_metrics:'/api/v2/process-metrics'},
    semantics:{opportunity:'Current registry rounds only; primary sources still govern availability.',funding_event:'Lifecycle event. Approved/awarded does not imply paid.',nulls:'Unknown values remain null; non-cash support is never coerced to USD.'}};
}

export function filterV2Programs(params:URLSearchParams, registry:RegistryIndex=loadRegistry()) {
  let rows=registry.programs;
  const mechanism=params.get('mechanism'), capital=params.get('capital_form'), selection=params.get('selection_model'), org=params.get('org'), status=params.get('status');
  if(mechanism) rows=rows.filter(p=>p.mechanism===mechanism);
  if(capital) rows=rows.filter(p=>[p.terms?.capital_form].flat().filter(Boolean).includes(capital as never));
  if(selection) rows=rows.filter(p=>[p.terms?.selection_model].flat().filter(Boolean).includes(selection as never));
  if(org) rows=rows.filter(p=>p.org===org); if(status) rows=rows.filter(p=>p.status===status);
  return rows.map(p=>v2Program(p));
}
export function filterFundingEvents(params:URLSearchParams, registry:RegistryIndex=loadRegistry()):FundingEvent[] {
  let rows=registry.fundingEvents; const type=params.get('event_type'),program=params.get('program'),recipient=params.get('recipient'),funder=params.get('funder');
  if(type) rows=rows.filter(x=>x.event_type===type); if(program) rows=rows.filter(x=>x.program===program); if(recipient) rows=rows.filter(x=>x.recipient===recipient); if(funder) rows=rows.filter(x=>x.funder===funder); return rows;
}
export function filterProcessMetrics(params:URLSearchParams, registry:RegistryIndex=loadRegistry()):ProcessMetric[] {
  let rows=registry.processMetrics; const program=params.get('program'),period=params.get('period'); if(program) rows=rows.filter(x=>x.program===program); if(period) rows=rows.filter(x=>x.period===period); return rows;
}
