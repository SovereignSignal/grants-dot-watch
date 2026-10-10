import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
import {FUNDING_SCHEMAS,LEDGERS,projectRecord,validateFundingDataset} from '../src/lib/funding-model.mjs';
import {readBaseline} from '../src/lib/funding-store.mjs';
import {readControlledFunding,previewFundingProposal,MAX_PACK_BYTES} from '../src/lib/funding-desk-core.mjs';
import {compileFundingSourcePackets,SOURCE_PACKET_BYTE_LIMIT} from '../src/lib/funding-source-packets.mjs';
import {buildFundingCollections,calendarDate} from '../src/lib/funding-api.mjs';
import {legacyRegistryCopy} from './legacy-registry.mjs';
const legacy=legacyRegistryCopy();test.after(()=>legacy.cleanup());
const ROOT=legacy.root;
const snapshots=()=>['research/v2/sources/batch-001.json','research/v2/sources/batch-002.json'].flatMap(path=>JSON.parse(readFileSync(path,'utf8')).snapshots);
const baseline=()=>readBaseline(ROOT,YAML.parse);
const allRecords=r=>r.packets.flatMap(p=>LEDGERS.flatMap(k=>p.records[k]));
const compile=()=>compileFundingSourcePackets(snapshots(),baseline(),readControlledFunding(ROOT).dataset,calendarDate());
function merged(result){const data=structuredClone(readControlledFunding(ROOT).dataset);for(const pack of result.packets)for(const k of LEDGERS)data[k].push(...pack.records[k]);return data;}

test('expanded source batch resolves 72 observations across four program mappings',()=>{
 const r=compile();assert.equal(r.report.observations,72);assert.equal(r.report.candidate_records,72);assert.equal(r.held.length,0);assert.equal(r.source_failures.length,0);assert.equal(r.coverage_gaps.length,2);
 assert.equal(new Set(allRecords(r).map(row=>row.program)).size,4);
 console.log('PROVENANCE_BACKFILL_RECEIPT '+JSON.stringify({...r.report,field_assertions:allRecords(r).reduce((n,row)=>n+row.provenance.assertions.length,0)}));
});
test('all expanded packets fit the actual Desk and validate in owner preview',()=>{
 const b=baseline(),r=compile();for(const pack of r.packets){assert.ok(Buffer.byteLength(JSON.stringify(pack))<=SOURCE_PACKET_BYTE_LIMIT);assert.ok(Buffer.byteLength(JSON.stringify(pack))<=MAX_PACK_BYTES);assert.doesNotThrow(()=>previewFundingProposal(ROOT,b,pack,calendarDate()));}
});
test('evidence survives schema projection and public v2 read projection',()=>{
 const r=compile(),dataset=merged(r);assert.deepEqual(validateFundingDataset(dataset,baseline(),calendarDate()),[]);
 const c=buildFundingCollections(baseline(),dataset),row=c['funding-events'].find(x=>x.purpose);
 assert.ok(row.provenance.assertions.some(a=>a.field==='/purpose'));assert.equal(row.provenance.raw_text_publication,false);
 assert.ok(c['process-metrics'].every(m=>m.published_percent&&m.provenance));
 assert.ok(c['funding-events'].filter(e=>e.funder==='microsoft').every(e=>e.amount.amount===null&&e.recipient_url));
});
test('source evidence value tampering fails the canonical validator',()=>{
 const dataset=merged(compile());dataset['funding-events'][0].recipient_name='Tampered';
 assert.ok(validateFundingDataset(dataset,baseline(),calendarDate()).some(e=>e.includes('evidence_value_mismatch')));
});
test('unsupported private metadata is rejected and absent from projection',()=>{
 const row=allRecords(compile()).find(r=>r.event_type);row.provenance.private_notes='PRIVATE_PAYLOAD';
 const data=readControlledFunding(ROOT).dataset;data['funding-events'].push(row);
 const errors=validateFundingDataset(data,baseline(),calendarDate());
 assert.ok(errors.length>0);
 assert.ok(!errors.join(' ').includes('PRIVATE_PAYLOAD'));
 assert.throws(()=>buildFundingCollections(baseline(),data),/invalid/);
 assert.ok(!JSON.stringify(projectRecord(FUNDING_SCHEMAS['funding-events'],row)).includes('PRIVATE_PAYLOAD'));
});
test('process exclusions point to the scope statement rather than numerical rows',()=>{
 const r=compile();for(const row of allRecords(r).filter(x=>x.eligible_applications)){
  const a=row.provenance.assertions.find(x=>x.field==='/exclusions'),count=row.provenance.assertions.find(x=>x.field==='/offers');
  assert.ok(a.evidence.every(e=>e.line>count.evidence.find(c=>c.source_id===e.source_id).line));
 }
});
test('source republication is idempotent without overwriting observation dates',()=>{
 const r=compile(),data=merged(r),before=JSON.stringify(data);
 const again=compileFundingSourcePackets(snapshots(),baseline(),data,calendarDate());assert.equal(again.report.candidate_records,0);assert.equal(again.unchanged.length,72);assert.equal(JSON.stringify(data),before);
});
test('native capture CLI dry run is inert and refuses production/apply controls',()=>{
 const run=args=>execFileSync(process.execPath,['scripts/capture-funding-source.mjs',...args],{encoding:'utf8'});
 assert.equal(JSON.parse(run(['--source','microsoft-foss','--fund','35'])).network_requests,0);
 assert.throws(()=>run(['--source','microsoft-foss','--apply']));
 assert.throws(()=>run(['--source','microsoft-foss','--fetch','--out','registry/native-output']));
});
