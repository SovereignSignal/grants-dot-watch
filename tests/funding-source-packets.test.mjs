import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_CATALOG,sourceDigest} from '../src/lib/funding-source-adapters.mjs';
import {compileFundingSourcePackets} from '../src/lib/funding-source-packets.mjs';
import {LEDGERS,validateFundingDataset} from '../src/lib/funding-model.mjs';
import {planFundingImport} from '../src/lib/funding-migration.mjs';
const TODAY='2026-10-04';
const empty=()=>Object.fromEntries(LEDGERS.map(k=>[k,[]]));
function baseline(){
 const programs=Object.values(SOURCE_CATALOG).map(c=>({id:c.program,org:c.issuer,name:c.program,rounds:[]}));
 const orgs=[...new Set(programs.map(p=>p.org))].map(id=>({id}));
 const paths=[...programs.map(p=>`programs/${p.id}.yaml`),...orgs.map(o=>`orgs/${o.id}.yaml`)];
 return {orgs,programs,awards:[],source_blobs:Object.fromEntries(paths.map(p=>[p,'a'.repeat(40)]))};
}
function snap(body,source_id='numfocus-sdg') {return {version:1,source_id,source_url:SOURCE_CATALOG[source_id].url,observed_on:TODAY,provider:'web',representation:'tool_text_excerpt',scope:'test excerpt',body,body_sha256:sourceDigest(body),source_revision:null};}
const nf=(rows=1)=>'## Previously Funded Programs\n| Project | Proposal Title | Amount | Year | Round |\n| --- | --- | --- | --- | --- |\n'+Array.from({length:rows},(_,i)=>`| Project ${i} | Development | $10,000.00 | 2024 | 1 |\n`).join('');
const rs='## Application and offer data\n| Financial year | Eligible applications | Offers | Success rate |\n| --- | --- | --- | --- |\n| 2025/26 | 472 | 99 | 21.0% |\n\nData does not include upgraded reserves.\n';
const ms='## Funding recipients\n- FOSS Fund 36 (March 2026)\n  - **[owner](https://github.com/owner)**: _[[project](https://github.com/owner/project)]_\n';
const records=r=>r.packets.flatMap(p=>LEDGERS.flatMap(k=>p.records[k]));
function apply(existing,pack){const out=structuredClone(existing);for(const k of LEDGERS)out[k].push(...pack.records[k]);return out;}

test('source compiler emits valid events and process metrics with exact provenance pointers',()=>{
 const b=baseline(),r=compileFundingSourcePackets([snap(nf()),snap(rs,'royal-society-research'),snap(ms,'microsoft-foss')],b,empty(),TODAY);
 assert.equal(r.report.candidate_records,3);assert.equal(r.report.canonical_write,false);assert.equal(r.claims.length,12);
 let data=empty();for(const p of r.packets){planFundingImport(b,data,p,TODAY);data=apply(data,p);}
 assert.deepEqual(validateFundingDataset(data,b,TODAY),[]);
 assert.ok(data['funding-events'].every(e=>e.occurred_on===null&&e.payment_date===null&&e.announced_on===null));
 assert.equal(data['funding-events'].find(e=>e.funder==='microsoft').amount.amount,null);
 assert.ok(r.claims.every(c=>c.field.startsWith('/')&&c.evidence[0].line>0&&/^[a-f0-9]{64}$/.test(c.evidence[0].body_sha256)));
});
test('source compiler holds unresolved program ownership rather than inventing registry IDs',()=>{
 const b=baseline();b.programs=b.programs.filter(p=>p.org!=='microsoft');
 const r=compileFundingSourcePackets([snap(ms,'microsoft-foss')],b,empty(),TODAY);
 assert.equal(r.packets.length,0);assert.equal(r.held[0].reason,'canonical_program_mapping_required');
});
test('source compiler rejects mismatched ownership and missing byte guards',()=>{
 for(const mutate of [b=>b.programs[0].org='microsoft',b=>delete b.source_blobs['orgs/numfocus.yaml']]){
 const b=baseline();mutate(b);const r=compileFundingSourcePackets([snap(nf())],b,empty(),TODAY);assert.equal(r.packets.length,0);assert.equal(r.held.length,1);
 }
});
test('source compiler repeated observations do not mutate already recorded evidence',()=>{
 const b=baseline(),s=snap(nf()),first=compileFundingSourcePackets([s],b,empty(),TODAY);
 const existing=apply(empty(),first.packets[0]);const bytes=JSON.stringify(existing);
 const repeated=compileFundingSourcePackets([{...s,observed_on:'2026-10-05'}],b,existing,'2026-10-05');
 assert.equal(repeated.packets.length,0);assert.equal(repeated.unchanged.length,1);assert.equal(JSON.stringify(existing),bytes);
});
test('source compiler amended amounts need a new reviewed supersession',()=>{
 const b=baseline(),first=compileFundingSourcePackets([snap(nf())],b,empty(),TODAY);
 const existing=apply(empty(),first.packets[0]);const r=compileFundingSourcePackets([snap(nf().replace('$10,000.00','$11,000.00'))],b,existing,TODAY);
 assert.equal(r.packets.length,0);assert.equal(r.held[0].reason,'existing_key_changed_requires_supersession');
});
test('source compiler raises potential legacy duplicates instead of double counting',()=>{
 const b=baseline();b.awards=[{key:'legacy',funder:'numfocus',grantee_name:'Project 0',program:'numfocus-small-development-grants'}];
 const r=compileFundingSourcePackets([snap(nf())],b,empty(),TODAY);assert.equal(r.packets.length,0);assert.equal(r.held[0].reason,'possible_legacy_award_duplicate');
});
test('source compiler raises possible duplicate events with different keys',()=>{
 const b=baseline(),first=compileFundingSourcePackets([snap(nf())],b,empty(),TODAY);const existing=apply(empty(),first.packets[0]);existing['funding-events'][0].key='other-key';
 const r=compileFundingSourcePackets([snap(nf())],b,existing,TODAY);assert.equal(r.packets.length,0);assert.equal(r.held[0].reason,'possible_existing_event_duplicate');
});
test('source compiler chunks packets within the owner Desk record budget',()=>{
 const b=baseline(),r=compileFundingSourcePackets([snap(nf(101))],b,empty(),TODAY);assert.equal(r.packets.length,2);
 assert.deepEqual(r.packets.map(p=>p.records['funding-events'].length),[100,1]);let data=empty();for(const p of r.packets){planFundingImport(b,data,p,TODAY);data=apply(data,p);}
});
test('source compiler separates failed sources, provider conflicts and incomplete coverage',()=>{
 const changed=snap(nf().replace('$10,000.00','$20,000.00'));
 const r=compileFundingSourcePackets([snap(nf()),changed,snap('bad','microsoft-foss'),snap(rs,'royal-society-research')],baseline(),empty(),TODAY);
 assert.equal(r.report.candidate_records,1);assert.equal(r.source_failures.length,1);assert.equal(r.held[0].reason,'provider_value_conflict');assert.equal(r.report.status,'partial_source_failure');
});
test('source compiler output is stable across provider and row ordering',()=>{
 const b=baseline(),a=snap(nf(2)),lines=nf(2).trimEnd().split('\n'),other=snap([...lines.slice(0,3),...lines.slice(3).reverse()].join('\n')+'\n');
 const x=compileFundingSourcePackets([a,other],b,empty(),TODAY),y=compileFundingSourcePackets([other,a],b,empty(),TODAY);
 assert.deepEqual(x.packets,y.packets);assert.equal(x.report.output_snapshot,y.report.output_snapshot);assert.equal(records(x).length,2);
});
