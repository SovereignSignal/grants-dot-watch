// Converts adapter observations into reviewed-import candidates; never writes them.
import { SOURCE_CATALOG, sourceDigest, stableJSON, reconcileSourceSnapshots } from './funding-source-adapters.mjs';
import { LEDGERS, validateFundingDataset } from './funding-model.mjs';
import { bindProvenance } from './funding-provenance.mjs';
export const SOURCE_PACKET_BYTE_LIMIT=240*1024;
const empty=()=>Object.fromEntries(LEDGERS.map(k=>[k,[]]));
const normalize=name=>String(name).toLowerCase().replace(/[^a-z0-9]/g,'');
const semantic=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!['checked_on','evidence_note','evidence_state','source','provenance'].includes(k)));
function makeRecord(item,program){
  const {fact,evidence,source_id,id}=item,config=SOURCE_CATALOG[source_id];
  const checked_on=evidence.map(e=>e.observed_on).sort()[0];
  const base={key:`source:${id}`,program,source:config.url,checked_on,evidence_state:'primary_supported'};
  if(fact.kind==='metric')return {ledger:'process-metrics',record:{...base,period:fact.period,counting_unit:'applications',eligible_applications:fact.eligible_applications,offers:fact.offers,exclusions:fact.exclusions,published_percent:fact.published_percent,
    evidence_note:`Published eligible-application and offer counts for ${fact.period}; upgraded reserves excluded. Historical cohort observation, not applicant odds or evidence of payment. Adapter ${source_id}; observation ${id}.`}};
  return {ledger:'funding-events',record:{...base,award_id:`source-award:${id}`,event_type:'awarded',funder:config.issuer,recipient:fact.recipient,recipient_name:fact.recipient_name,
    amount:{amount:fact.amount,currency:fact.currency,unit:'currency',qualifier:fact.amount===null?'not_disclosed':'exact'},capital_form:'cash',occurred_on:null,announced_on:null,payment_date:null,award_period:fact.period,
    purpose:fact.purpose??null,recipient_url:fact.project_url??null,
    evidence_note:`Published project funding recipient for ${fact.period}. Exact award date, legal payee and payment are not established. ${fact.amount===null?'Individual amount is undisclosed; no share of a pool was assigned. ':''}Adapter ${source_id}; observation ${id}.`}};
}
function fieldRules(item,record){
  const stated=rule=>({method:'source_stated',rule}),normalized=rule=>({method:'normalized',rule}),withheld=rule=>({method:'withheld',rule});
  if(item.fact.kind==='metric')return {
    '/period':stated('published_financial_year'),'/eligible_applications':stated('published_eligible_count'),
    '/offers':stated('published_offer_count'),'/published_percent':stated('published_rounded_percentage'),
    '/counting_unit':normalized('published_denominator_is_eligible_applications'),
    '/exclusions':normalized('table_scope_excludes_upgraded_reserves'),
  };
  return {
    '/recipient_name':stated('published_beneficiary_project'),
    '/amount/amount':record.amount.amount===null?withheld('individual_award_amount_not_disclosed'):normalized('source_amount_normalized_to_decimal'),
    '/amount/currency':record.amount.currency===null?withheld('no_currency_assigned_without_individual_amount'):normalized('adapter_source_denomination'),
    '/award_period':normalized('source_cohort_label_is_separate_from_event_date'),
    '/event_type':normalized('recipient_listing_is_award_evidence_not_payment'),
    '/capital_form':normalized('source_funding_program_cash_sponsorship_not_payment_confirmation'),
    '/purpose':record.purpose===null?withheld('specific_award_purpose_not_extracted'):stated('published_proposal_title'),
    '/recipient_url':record.recipient_url===null?withheld('canonical_project_url_not_established'):normalized('explicit_repository_link_from_recipient_row'),
    '/occurred_on':withheld('exact_award_date_not_disclosed'),'/announced_on':withheld('announcement_date_not_disclosed'),
    '/payment_date':withheld('payment_not_established'),
  };
}
export function compileFundingSourcePackets(snapshots,baseline,existing,today){
  if(validateFundingDataset(existing,baseline,today).length)throw new Error('invalid_existing_funding_snapshot');
  const result=reconcileSourceSnapshots(snapshots,today);
  const packets=new Map(),held=[...result.held],unchanged=[],claims=[];
  const registryPrograms=new Map(baseline.programs.map(p=>[p.id,p]));
  const registryOrgs=new Set(baseline.orgs.map(o=>o.id)),next=structuredClone(existing);
  for(const item of result.facts){
    const config=SOURCE_CATALOG[item.source_id],p=registryPrograms.get(config.program);
    if(!p||p.org!==config.issuer||!registryOrgs.has(config.issuer)){held.push({...item,reason:'canonical_program_mapping_required',suggested_program:config.program,issuer:config.issuer});continue;}
    const {ledger,record}=makeRecord(item,p.id),references=[`programs/${p.id}.yaml`,`orgs/${p.org}.yaml`];
    if(references.some(path=>!/^[a-f0-9]{40}$/.test(baseline.source_blobs?.[path]||''))){held.push({...item,reason:'baseline_blob_guards_required'});continue;}
    const before=existing[ledger].find(r=>r.key===record.key);
    if(before){
      if(before.evidence_state===record.evidence_state&&before.source===record.source&&stableJSON(semantic(before))===stableJSON(semantic(record)))unchanged.push({key:record.key,source_id:item.source_id,reason:'existing_semantic_record',evidence:item.evidence});
      else held.push({...item,reason:'existing_key_changed_requires_supersession',existing_key:record.key});
      continue;
    }
    if(ledger==='funding-events'&&(baseline.awards||[]).some(a=>a.funder===record.funder&&normalize(a.grantee_name)===normalize(record.recipient_name)&&(!a.program||a.program===record.program))){held.push({...item,reason:'possible_legacy_award_duplicate'});continue;}
    if(ledger==='funding-events'&&existing[ledger].some(e=>e.funder===record.funder&&e.program===record.program&&e.award_period===record.award_period&&normalize(e.recipient_name)===normalize(record.recipient_name))){held.push({...item,reason:'possible_existing_event_duplicate'});continue;}
    try{
      record.provenance=bindProvenance(record,fieldRules(item,record),item.evidence,result.receipts);
      if(item.fact.kind==='metric'){
        const assertion=record.provenance.assertions.find(a=>a.field==='/exclusions');
        for(const locator of assertion.evidence){
          const source=record.provenance.sources.find(s=>s.id===locator.source_id);
          const snapshot=snapshots.find(s=>s.source_url===source.url&&s.body_sha256===source.representation_sha256&&s.provider===source.provider&&s.observed_on===source.observed_on);
          const line=snapshot.body.split(/\r?\n/).findIndex(l=>l.includes('does not include upgraded reserves'))+1;
          if(line<1)throw new Error('exclusion_locator_missing');locator.line=line;
        }
      }
    }catch{held.push({...item,reason:'field_evidence_binding_failed'});continue;}
    const candidate=structuredClone(next);candidate[ledger].push(record);
    const errors=validateFundingDataset(candidate,baseline,today);
    if(errors.length){held.push({...item,reason:'canonical_schema_rejected',errors});continue;}
    if(Buffer.byteLength(JSON.stringify(record))>SOURCE_PACKET_BYTE_LIMIT-4096){held.push({...item,reason:'record_exceeds_desk_byte_budget'});continue;}
    next[ledger].push(record);
    let pack=packets.get(p.id);
    if(!pack){pack={schema_version:2,id:`source-${p.id}`,reference_blobs:Object.fromEntries(references.map(path=>[path,baseline.source_blobs[path]])),records:empty()};packets.set(p.id,pack);}
    pack.records[ledger].push(record);
    const fields=item.fact.kind==='metric'
      ? {'/period':item.fact.period,'/eligible_applications':item.fact.eligible_applications,'/offers':item.fact.offers,'/exclusions':item.fact.exclusions}
      : {'/recipient_name':item.fact.recipient_name,'/amount/amount':item.fact.amount,'/amount/currency':item.fact.currency,'/award_period':item.fact.period};
    for(const [field,value]of Object.entries(fields)){
      const assertion=record.provenance.assertions.find(a=>a.field===field);
      const evidence=assertion.evidence.map(ref=>{
        const source=record.provenance.sources.find(s=>s.id===ref.source_id);
        return {source_url:source.url,body_sha256:source.representation_sha256,line:ref.line,provider:source.provider,observed_on:source.observed_on};
      });
      claims.push({record_key:record.key,field,value,evidence,adapter_version:'1.0.0',identity_basis:item.fact.identity,source_url:config.url,redistribution:'unassessed'});
    }
  }
  const chunks=[];
  for(const pack of packets.values()){
    const rows=LEDGERS.flatMap(ledger=>pack.records[ledger].map(record=>({ledger,record}))).sort((a,b)=>a.record.key.localeCompare(b.record.key));
    let number=1,count=0,chunk={...pack,id:`${pack.id}-001`,records:empty()};
    for(const row of rows){
      const trial=structuredClone(chunk);trial.records[row.ledger].push(row.record);
      if(count&&(count>=100||Buffer.byteLength(JSON.stringify(trial))>SOURCE_PACKET_BYTE_LIMIT)){
        chunks.push(chunk);number++;count=0;chunk={...pack,id:`${pack.id}-${String(number).padStart(3,'0')}`,records:empty()};
      }
      chunk.records[row.ledger].push(row.record);count++;
    }
    if(count)chunks.push(chunk);
  }
  return {version:1,packets:chunks,claims,held,unchanged,source_receipts:result.receipts,source_failures:result.failures,coverage_gaps:result.coverage_gaps,
    report:{status:result.failures.length?'partial_source_failure':'candidate_review_required',snapshots:snapshots.length,observations:result.counts.facts+result.counts.held,packets:chunks.length,
      candidate_records:chunks.reduce((n,p)=>n+LEDGERS.reduce((a,k)=>a+p.records[k].length,0),0),held:held.length,unchanged:unchanged.length,canonical_write:false,production_write:false,
      field_provenance_in_packets:true,packet_byte_limit:SOURCE_PACKET_BYTE_LIMIT,source_snapshot:sourceDigest(result.receipts),output_snapshot:sourceDigest(chunks),coverage:'supplied excerpts only; missing source rows never imply deletion'}};
}
