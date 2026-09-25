import test from 'node:test';
import assert from 'node:assert/strict';
import { wireFinding, acceptedWireMappings, handoffWireRows, parseWireCursor, fetchWireChanges } from '../src/lib/wire-handoff.ts';
import { findingRevision, parseResearchPacket, prepareResearch } from '../src/lib/research-intake.ts';
const time='2026-09-25T01:00:00.000123Z';
const row={id:1,program_id:44,duplicate_of_id:null,name:'A rolling research grant',description:'An ongoing grant supporting independent open source research.',enriched_summary:null,source_url:'https://example.org/grants',amount:'$10,000',deadline:null,deadline_iso:null,status:'approved',wire:'oss',classification:'OPPORTUNITY',tags:[],org_id:12,org_name:'Example Foundation',org_website:'https://example.org',org_aliases:[],changed_at:time};
const finding=(patch={})=>wireFinding({...row,...patch},new Map());
const packet=f=>({version:1,run_id:'fixture',wire:'oss',producer:'fixture',completed_at:time,coverage:[],findings:[f]});
const proposal=(patch={})=>({id:'p1',state:'approved',signal_id:'wire:1',proposed_change:{'programs/example-grant.yaml':{}},...patch});
test('older substantive edits and joined organization changes produce new revisions',()=>{
 const original=findingRevision(finding());
 for(const patch of [{description:'The grant now supports additional research areas.'},{source_url:'https://example.org/new-call'},{org_name:'Example Research Foundation'},{org_website:'https://research.example.org'},{org_aliases:['Research Fund']},{status:'declined'},{program_id:45},{amount:'$20,000'},{duplicate_of_id:2}]) assert.notEqual(findingRevision(finding(patch)),original);
});
test('timestamps, counters, scan boilerplate and set ordering do not manufacture revisions',()=>{
 const base=finding({tags:['b','a'],org_aliases:['Two','One']});
 const noise=finding({tags:['a','b'],org_aliases:['One','Two'],changed_at:'2026-09-26T02:00:00.000789Z',updated_at:'later',quality_score:99,total_opportunities:999,description:'Date found: 2026-09-26\n'+row.description});
 assert.equal(findingRevision(base),findingRevision(noise));
});
test('new programs, rolling calls, awards and unresolved leads retain evidence without inventing public facts',()=>{
 for(const patch of [{},{classification:'AWARD'},{org_id:null,org_name:null,org_website:null},{deadline:'Rolling',deadline_iso:null}]) {
  const f=finding(patch), report=prepareResearch(parseResearchPacket(packet(f)),[],{});
  assert.equal(report.outcomes[0].state,'pending_review');assert.equal(report.proposals.length,0);assert.equal(report.findings[0].id,'wire:1');
 }
});
test('withdrawals retain the accepted program reference and require review, never deletion',()=>{
 const f=wireFinding({...row,status:'duplicate'},new Map([[1,'example-grant']]));
 const report=prepareResearch(parseResearchPacket(packet(f)),[{id:'example-grant'}],{});
 assert.equal(report.outcomes[0].program_id,'example-grant');assert.match(report.outcomes[0].reason,/Source is now duplicate/);assert.equal(report.proposals.length,0);
});
test('only unambiguous accepted mappings are reused',()=>{
 assert.equal(acceptedWireMappings([proposal()]).get(1),'example-grant');
 assert.equal(acceptedWireMappings([proposal({state:'pending'})]).size,0);
 assert.equal(acceptedWireMappings([proposal(),proposal({proposed_change:{'programs/another.yaml':{}}})]).size,0);
 assert.equal(acceptedWireMappings([proposal({proposed_change:{'programs/example-grant.yaml':{},'programs/another.yaml':{}}})]).size,0);
});
test('cursor retains microseconds and the query includes joined edits and withdrawn statuses',async()=>{
 const cursor={changed_at:time,id:1};assert.deepEqual(parseWireCursor(cursor),cursor);
 await fetchWireChanges({query:async(sql,args)=>{assert.match(sql,/op.updated_at/);assert.match(sql,/se.id\) > \(\$1::timestamptz/);assert.doesNotMatch(sql,/status IN/);assert.deepEqual(args,[time,1,200]);return {rows:[]};}},cursor);
 assert.throws(()=>parseWireCursor({changed_at:'2026-09-25T01:00:00.000Z',id:1}),/checkpoint/);
 await assert.rejects(fetchWireChanges({},cursor,201),/200/);
});
test('failed later packet leaves the checkpoint retryable; retry reuses identical packet IDs',async()=>{
 const seen=[],written=[],cursor={changed_at:'2026-09-24T00:00:00.000000Z',id:0};let fail=true;
 const deps={proposals:async()=>[],setState:async(k,v)=>written.push([k,v]),ingest:async(p,save)=>{seen.push([p.run_id,save]);if(fail&&p.wire==='ai')throw Error('storage unavailable');return {saved:save};}};
 const rows=[row,{...row,id:2,wire:'ai'}];
 await assert.rejects(handoffWireRows(rows,{save:true,advance:true,cursor},deps),/storage unavailable/);assert.equal(written.length,0);
 fail=false;await handoffWireRows(rows,{save:true,advance:true,cursor},deps);assert.equal(seen[0][0],seen[2][0]);assert.deepEqual(written[0][1],{changed_at:time,id:2});
});
test('preview never advances a checkpoint and invalid batch cannot partially persist',async()=>{
 let calls=0;const deps={proposals:async()=>[],ingest:async(p,save)=>{assert.equal(save,false);calls++;return{};},setState:async()=>assert.fail('write in preview')};
 const report=await handoffWireRows([row],{},deps);assert.equal(report.saved,false);assert.equal(calls,1);
 await assert.rejects(handoffWireRows([row,{...row,id:2,wire:'unknown'}],{save:true},deps),/Unsupported/);assert.equal(calls,1);
 await assert.rejects(handoffWireRows([row],{save:true,advance:true},deps),/checkpoint/);
});
