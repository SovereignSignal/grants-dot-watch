// Public evidence metadata. No raw source text, credentials, fetches or writes.
import { createHash } from 'node:crypto';
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}` : JSON.stringify(value);
export const valueDigest = value => createHash('sha256').update(stable(value)).digest('hex');
const str = maxLength => ({type:'string',minLength:1,maxLength});
const hash = {...str(64),pattern:'^[a-f0-9]{64}$'};
const nullable = schema => ({anyOf:[schema,{type:'null'}]});
const obj = (properties,required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
const list = (items,maxItems) => ({type:'array',items,minItems:1,maxItems});
const choice = values => ({type:'string',enum:values});
export const PROVENANCE_SCHEMA = obj({
  version:{type:'integer',minimum:1,maximum:1},
  sources:list(obj({
    id:hash, url:{...str(2048),format:'public-url'},
    representation_sha256:hash,
    observed_on:{type:'string',format:'date'},
    provider:choice(['github','exa','parallel','web','manual']),
    representation:choice(['tool_text_excerpt','native_markdown']),
    scope:str(500), source_revision:nullable({...str(40),pattern:'^[a-f0-9]{40}$'}),
    redistribution:choice(['unassessed','permission_recorded','open_license_recorded']),
    rights_source:nullable({...str(2048),format:'public-url'}),
  }),8),
  assertions:list(obj({
    field:{...str(300),pattern:'^/'}, value_sha256:hash,
    method:choice(['source_stated','normalized','withheld']),
    rule:str(300),
    evidence:list(obj({source_id:hash,line:{type:'integer',minimum:1,maximum:10000000}}),8),
  }),64),
  raw_text_publication:{type:'boolean',enum:[false]},
});
const sourceIdentity = source => valueDigest([source.url,source.representation_sha256,source.observed_on,source.provider,source.representation,source.scope,source.source_revision]);
export function pointerValue(record,pointer) {
  if(typeof pointer!=='string' || !pointer.startsWith('/') || /~(?![01])/.test(pointer)) throw new Error('invalid_evidence_pointer');
  const parts=pointer.slice(1).split('/').map(p=>p.replaceAll('~1','/').replaceAll('~0','~'));
  if(parts[0]==='provenance' || parts.some(p=>['__proto__','constructor','prototype'].includes(p))) throw new Error('unsafe_evidence_pointer');
  let current=record;
  for(const part of parts){
    if(current===null || typeof current!=='object' || !Object.hasOwn(current,part) || (Array.isArray(current)&&! /^(0|[1-9]\d*)$/.test(part))) throw new Error('missing_evidence_field');
    current=current[part];
  }
  if(current===undefined) throw new Error('missing_evidence_field');
  return current;
}
// Call only after validating PROVENANCE_SCHEMA. Messages never echo source text.
export function provenanceErrors(record,today) {
  if(record.provenance==null) return [];
  const {sources,assertions}=record.provenance, errors=[],ids=new Map(),fields=new Set();
  for(const source of sources){
    if(ids.has(source.id)) errors.push('duplicate_evidence_source');
    ids.set(source.id,source);
    if(source.id!==sourceIdentity(source)) errors.push('evidence_source_identity_mismatch');
    if(source.observed_on>today) errors.push('future_evidence_observation');
    if(source.source_revision && source.provider!=='github') errors.push('unsupported_revision_provider');
    if(source.redistribution!=='unassessed'&&!source.rights_source) errors.push('rights_evidence_required');
  }
  if(!sources.some(s=>s.url===record.source)) errors.push('record_source_not_in_provenance');
  for(const assertion of assertions){
    if(fields.has(assertion.field)) errors.push('duplicate_evidence_field');
    fields.add(assertion.field);
    try {
      const value=pointerValue(record,assertion.field);
      if(valueDigest(value)!==assertion.value_sha256) errors.push('evidence_value_mismatch');
      if(assertion.method==='withheld'&&value!==null) errors.push('withheld_value_must_be_null');
    } catch {errors.push('invalid_evidence_pointer');}
    const refs=new Set();
    for(const ref of assertion.evidence){
      if(!ids.has(ref.source_id)) errors.push('unknown_evidence_source');
      const key=`${ref.source_id}:${ref.line}`;
      if(refs.has(key)) errors.push('duplicate_evidence_locator');
      refs.add(key);
    }
  }
  return errors;
}
/**
 * Attach receipt hashes and line locators to explicit fields. A hash binds the
 * supplied representation, not its truth, completeness or issuer authenticity.
 */
export function bindProvenance(record,fieldRules,evidence,receipts) {
  const sources=new Map(), locators=new Map();
  for(const ref of evidence){
    const matches=receipts.filter(r=>r.source_url===ref.source_url && r.body_sha256===ref.body_sha256 && r.observed_on===ref.observed_on && r.provider===ref.provider);
    const unique=[...new Map(matches.map(r=>[stable(r),r])).values()];
    if(unique.length!==1) throw new Error('ambiguous_or_missing_source_receipt');
    const r=unique[0];
    const source={url:r.source_url,representation_sha256:r.body_sha256,observed_on:r.observed_on,provider:r.provider,
      representation:r.representation,scope:r.scope,source_revision:r.source_revision??null,
      redistribution:'unassessed',rights_source:null};
    source.id=sourceIdentity(source); sources.set(source.id,source);
    locators.set(`${source.id}:${ref.line}`,{source_id:source.id,line:ref.line});
  }
  const sortedRefs=[...locators.values()].sort((a,b)=>a.source_id.localeCompare(b.source_id)||a.line-b.line);
  return {version:1,sources:[...sources.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    assertions:Object.entries(fieldRules).sort(([a],[b])=>a.localeCompare(b)).map(([field,{method='source_stated',rule}])=>({
      field,value_sha256:valueDigest(pointerValue(record,field)),method,rule,evidence:sortedRefs.map(ref=>({...ref})),
    })),raw_text_publication:false};
}
