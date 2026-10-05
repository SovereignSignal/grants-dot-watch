#!/usr/bin/env node
// Reconcile retained research with a fixed inventory and a verified public snapshot.
// Research text is input data. No network, approval, mutation or code evaluation occurs.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {canonical,isPublicUrl} from '../../src/lib/funding-model.mjs';

export const RESEARCH_LIMITS=Object.freeze({bytes:8*1024*1024,publicBytes:64*1024*1024,records:1000,leaves:100000,depth:30});
const sha=v=>createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const slug=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]*$/.test(v);
const fail=message=>{throw new Error(message);};
const esc=v=>String(v).replaceAll('~','~0').replaceAll('/','~1');
const members=v=>Array.isArray(v)?v:[];
const idOf=r=>r.registry_id??r.id;

// A target is a review hint, never a claim that the source establishes its value.
// Money, roles and dates require scope/identity checks before canonical conversion.
const HINTS={
 instrument:['program-terms','/instruments','normalize_instrument'],
 mechanism:['program-terms','/allocation_methods','separate_instrument_from_method'],
 allocation_method:['program-terms','/allocation_methods','normalize_allocation'],
 capital_form:['program-terms','/capital_forms','preserve_resource_units'],
 selection_model:['program-terms','/selection_models','verify_selection_route'],
 intake_mode:['program-terms','/intake_mode','verify_current_entry_stage'],
 intake_type:['program-terms','/intake_mode','verify_current_entry_stage'],
 eligibility:['program-terms','/eligibility','retain_all_qualifiers'],
 geography:['program-terms','/geography','retain_scope'],
 amount:['funding-events','/amount','establish_amount_meaning_first'],
 award_amount:['funding-events','/amount','establish_award_and_currency'],
 pool_amount:['program-terms','/budget','pool_is_not_an_individual_award'],
 currency:['funding-events','/amount/currency','preserve_native_currency'],
 payment_date:['funding-events','/payment_date','requires_payment_evidence'],
 award_date:['funding-events','/occurred_on','preserve_date_precision'],
 award_period:['funding-events','/award_period','separate_vintage_from_publication'],
 announced_on:['funding-events','/announced_on','not_payment_date'],
 recipient:['funding-events','/recipient','resolve_beneficiary_identity'],
 recipient_url:['funding-events','/recipient_url','verify_project_relationship'],
 applications:['process-metrics','/applications','preserve_cohort_and_exclusions'],
 eligible_applications:['process-metrics','/eligible_applications','preserve_denominator'],
 offers:['process-metrics','/offers','preserve_cohort_and_exclusions'],
 accepted:['process-metrics','/accepted','preserve_cohort_and_exclusions'],
 funded:['process-metrics','/funded','preserve_cohort_and_exclusions'],
 exclusions:['process-metrics','/exclusions','preserve_scope'],
};
const UNMODELED=new Set(['legal_payee','matching_percentage','match_basis','contract_ceiling','token_fixing','capital_stack','fiscal_sponsor','decision_authority','transaction_hash','log_index','finality','outcome','causal_impact']);
export function flattenResearch(value,path='',depth=0,out=[]){
 if(depth>RESEARCH_LIMITS.depth||out.length>RESEARCH_LIMITS.leaves)fail('research_structure_limit');
 if(Array.isArray(value)){
  if(!value.length)out.push({path,value:[]});
  else value.forEach((v,i)=>flattenResearch(v,`${path}/${i}`,depth+1,out));
 }else if(plain(value)){
  const keys=Object.keys(value);if(keys.some(k=>['__proto__','constructor','prototype'].includes(k)))fail('unsafe_research_key');
  if(!keys.length)out.push({path,value:{}});
  else for(const key of keys)flattenResearch(value[key],`${path}/${esc(key)}`,depth+1,out);
 }else if(value===null||['string','boolean','number'].includes(typeof value)){
  if(typeof value==='number'&&!Number.isFinite(value))fail('invalid_research_number');
  out.push({path,value});
 }else fail('invalid_research_value');
 return out;
}
export function fieldDisposition(path){
 const keys=path.split('/').slice(1).filter(k=>!/^\d+$/.test(k));
 if(keys.some(k=>['extracted_terms','structured_terms'].includes(k))){
  const key=keys.at(-1),hint=HINTS[key];
  if(hint)return {state:'requires_source_and_program_review',ledger:hint[0],target:hint[1],rule:hint[2]};
  if(UNMODELED.has(key))return {state:'requires_explicit_schema_extension',ledger:null,target:null,rule:'do_not_flatten_or_drop'};
  return {state:'requires_field_mapping',ledger:null,target:null,rule:'no_safe_automatic_destination'};
 }
 if(keys.some(k=>['statement','claim','finding','text'].includes(k)))return {state:'retained_research_assertion',ledger:null,target:null,rule:'reverify_consequential_claim_before_publication'};
 if(keys.some(k=>['source_ids','source_urls','sources','url','source_url','baseline_url','baseline_ref','ref','path','baseline_tool_reference'].includes(k)))return {state:'retained_locator',ledger:null,target:null,rule:'reference_is_not_independent_source_verification'};
 if(keys.some(k=>['candidate_changes','proposed_changes','unresolved','open_questions','indexing_opportunities','acquisition_opportunities'].includes(k)))return {state:'retained_work_item',ledger:null,target:null,rule:'proposal_is_not_an_approved_change'};
 return {state:'retained_context',ledger:null,target:null,rule:'preserve_original_value_without_promoting_evidence'};
}
function verifiedLive(live,receipt){
 if(!plain(live)||!plain(live.collections)||!plain(live.v1)||!plain(receipt)||receipt.passed!==true)fail('verified_public_snapshot_required');
 if(sha(live.collections)!==receipt.public_snapshot||sha(live.v1)!==receipt.v1_snapshot)fail('public_snapshot_receipt_mismatch');
 for(const k of ['orgs','programs','coverage'])if(!Array.isArray(live.collections[k]))fail('missing_public_collection');
 const ids=new Set();for(const org of live.collections.orgs){if(!slug(org.id)||ids.has(org.id))fail('invalid_public_identity');ids.add(org.id);}
 return ids;
}
function extractSources(record){
 const urls=new Set();
 for(const leaf of flattenResearch(record)){
  if(typeof leaf.value==='string'&&isPublicUrl(leaf.value)&&/(?:source|url)/i.test(leaf.path))urls.add(leaf.value);
 }
 return [...urls].sort();
}
export function reconcileResearch({inventory,dossiers,live,receipt,inventoryRef,artifactLabel='retained research',sourceIndex=[]}){
 if(!Array.isArray(inventory)||!inventory.length||inventory.length>RESEARCH_LIMITS.records||inventory.some(id=>!slug(id))||new Set(inventory).size!==inventory.length)fail('invalid_frozen_inventory');
 if(!/^[a-f0-9]{40}$/.test(inventoryRef||''))fail('explicit_inventory_revision_required');
 const liveIds=verifiedLive(live,receipt),byId=new Map(),fields=[],notes=[];
 const records=Array.isArray(dossiers)?dossiers:dossiers?.records;
 if(!Array.isArray(records)||records.length>RESEARCH_LIMITS.records)fail('invalid_dossier_collection');
 const frozenIds=new Set(inventory),ordinals=new Set(),sourceById=new Map();
 if(!Array.isArray(sourceIndex)||sourceIndex.length>5000)fail('invalid_source_index');
 for(const source of sourceIndex){if(!plain(source)||typeof source.id!=='string'||!source.id||source.id.length>200||!isPublicUrl(source.url)||sourceById.has(source.id))fail('invalid_source_index');sourceById.set(source.id,source);}
 for(const record of records){
  if(!plain(record)||!slug(idOf(record))||!Number.isSafeInteger(record.ordinal)||record.ordinal<1||record.ordinal>inventory.length)fail('invalid_dossier_identity');
  const id=idOf(record);if(byId.has(id)||ordinals.has(record.ordinal))fail('duplicate_dossier_identity');ordinals.add(record.ordinal);
  if(!frozenIds.has(id))fail('dossier_id_outside_frozen_inventory');
  const sourceHash=sha(record),leaves=flattenResearch(record);
  if(fields.length+leaves.length>RESEARCH_LIMITS.leaves)fail('research_leaf_budget');
  for(const leaf of leaves)fields.push({org:id,source_record_sha256:sourceHash,source_field:leaf.path,original_value:leaf.value,...fieldDisposition(leaf.path)});
  const findings=members(record.findings);
  const references=[...new Set(findings.flatMap(f=>members(f?.source_ids)))];
  if(references.some(id=>typeof id!=='string'||!id||id.length>200))fail('invalid_source_reference');
  const missingSources=references.filter(id=>!sourceById.has(id));
  const sources=[...new Set([...extractSources(record),...references.filter(id=>sourceById.has(id)).map(id=>sourceById.get(id).url)])].sort();
  const row={id,name:typeof record.name==='string'?record.name:id,recorded_ordinal:record.ordinal,inventory_position:inventory.indexOf(id)+1,source_record_sha256:sourceHash,source_record:record,findings:findings.length,source_urls:sources,referenced_source_ids:references,unresolved_source_ids:missingSources,leaf_count:leaves.length,publication_state:'research_only',independently_reverified_here:false};
  byId.set(id,row);
  if(inventory[record.ordinal-1]!==id)notes.push({kind:'ordinal_order_differs',id,recorded_ordinal:record.ordinal,inventory_id_at_that_position:inventory[record.ordinal-1],resolution:'stable_id_used_no_reattribution'});
 }
 const coverageById=new Map(live.collections.coverage.map(r=>[r.org,r]));
 const coverage=inventory.map((id,i)=>{
  const research=byId.get(id),accepted=coverageById.get(id);
  return {id,inventory_position:i+1,live_identity:liveIds.has(id)?'same_id_present':'missing_requires_reconciliation',retained_dossier:!!research,retained_findings:research?.findings||0,retained_field_values:research?.leaf_count||0,retained_source_pointers:research?.source_urls.length||0,accepted_typed_programs:accepted?.programs_with_typed_terms??null,accepted_funding_events:accepted?.funding_events??null,accepted_process_observations:accepted?.process_observations??null,review_disposition:research?'retained_research_requires_source_review':'claim_level_dossier_not_supplied',complete_history:false};
 });
 const states={};for(const field of fields)states[field.state]=(states[field.state]||0)+1;
 const additions=[...liveIds].filter(id=>!frozenIds.has(id)).sort();
 const output={version:1,artifact:artifactLabel,inventory_ref:inventoryRef,inventory_sha256:sha(inventory),dossiers_sha256:sha(dossiers),artifact_metadata:plain(dossiers)?Object.fromEntries(Object.entries(dossiers).filter(([k])=>k!=='records')):null,verified_live_revision:receipt.served_revision,verified_live_snapshot:receipt.public_snapshot,source_index:sourceIndex,coverage,records:[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id)),field_dispositions:fields,identity_notes:notes,live_additions:additions,summary:{frozen_entities:inventory.length,matched_live_ids:coverage.filter(r=>r.live_identity==='same_id_present').length,missing_live_ids:coverage.filter(r=>r.live_identity!=='same_id_present').length,retained_dossiers:records.length,missing_dossiers:inventory.length-records.length,retained_findings:[...byId.values()].reduce((n,r)=>n+r.findings,0),retained_field_values:fields.length,dropped_field_values:0,disposition_counts:states,unresolved_source_references:[...byId.values()].reduce((n,r)=>n+r.unresolved_source_ids.length,0),ordinal_mismatches:notes.length,live_additions:additions.length,canonical_changes:0,network_requests:0,owner_approvals:0,claim_reverification_performed:false,complete_history:false}};
 return {...output,report_sha256:sha(output)};
}
function readJson(path,maxBytes=RESEARCH_LIMITS.bytes){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)fail('invalid_input_file');return JSON.parse(readFileSync(path,'utf8'));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const {values}=parseArgs({options:{dossiers:{type:'string'},'source-index':{type:'string'},inventory:{type:'string'},'inventory-ref':{type:'string'},live:{type:'string'},receipt:{type:'string'},out:{type:'string'}},strict:true,allowPositionals:false});
  if(!values.dossiers||!values.inventory||!values['inventory-ref']||!values.live||!values.receipt)fail('dossiers_inventory_revision_and_verified_live_receipt_required');
  const inventoryStat=lstatSync(values.inventory);if(!inventoryStat.isDirectory()||inventoryStat.isSymbolicLink())fail('ordinary_inventory_directory_required');
  const inventory=readdirSync(values.inventory).filter(n=>n.endsWith('.yaml')).map(n=>n.slice(0,-5)).sort();
  const result=reconcileResearch({inventory,dossiers:readJson(values.dossiers),sourceIndex:values['source-index']?readJson(values['source-index']):[],live:readJson(values.live,RESEARCH_LIMITS.publicBytes),receipt:readJson(values.receipt),inventoryRef:values['inventory-ref'],artifactLabel:'Retained research dossier bundle'});
  if(values.out){const dest=resolve(values.out);if(existsSync(dest))fail('refusing_existing_output');mkdirSync(dest);writeFileSync(join(dest,'research-reconciliation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});writeFileSync(join(dest,'summary.json'),JSON.stringify({...result.summary,report_sha256:result.report_sha256},null,2)+'\n',{flag:'wx'});}
  console.log(JSON.stringify(result.summary,null,2));
 }catch(error){console.error(JSON.stringify({error:error.message,canonical_changes:0}));process.exitCode=1;}
}
