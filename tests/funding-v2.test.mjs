import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FUNDING_SCHEMAS, LEDGERS, canonical, isPublicUrl, projectRecord, validateFundingDataset } from '../src/lib/funding-model.mjs';
import { blobHash, digest, emptyFundingDataset, readBaseline, readFundingLedgers } from '../src/lib/funding-store.mjs';
import { planFundingImport, writeFundingStage } from '../src/lib/funding-migration.mjs';
import { buildFundingCollections, handleFundingRequest, queryFundingCollection } from '../src/lib/funding-api.mjs';
const TODAY = '2026-10-04', AT = new Date('2026-10-04T15:00:00Z');
const SOURCE = 'https://funder.example.org/grants';
function baseline() { return {systems:[],orgs:[{id:'funder',name:'Funder',status:'active',profile:'Public profile',roles:['funder'],sources:[SOURCE]}],programs:[{id:'program',org:'funder',name:'Program',status:'active',mechanism:'grants',summary:'Public program',sources:[SOURCE],rounds:[{name:'Current',status:'open',opens:'2026-09-01',closes:'2026-11-01',source:SOURCE}]}],awards:[]}; }
const evidence = () => ({source:SOURCE,checked_on:TODAY,evidence_state:'primary_supported',evidence_note:'Published terms support these facts.'});
function terms() { return {key:'terms-1',program:'program',...evidence(),instruments:['grant'],allocation_methods:['committee'],capital_forms:['cash'],selection_models:['application'],intake_mode:'rounds',resources:[],operator_org:'funder',access:{round_name:'Current',stage:'Initial application',state:'open',new_applicants:true,prerequisites_clear:true,route:SOURCE,checked_on:TODAY,review_after:'2026-10-10',source:SOURCE}}; }
function event() { return {key:'event-1',award_id:'award-1',event_type:'awarded',...evidence(),funder:'funder',recipient:'recipient',recipient_name:'Recipient',program:'program',amount:{amount:'10000.01',currency:'USD',unit:'currency',qualifier:'exact'},capital_form:'cash',occurred_on:null,announced_on:'2026-10-01',payment_date:null}; }
function metric() { return {key:'metrics-1',program:'program',period:'2025/26',...evidence(),counting_unit:'applications',eligible_applications:90,offers:10,exclusions:['Reserves excluded']}; }
const dataset = () => ({'program-terms':[terms()],'funding-events':[event()],'process-metrics':[metric()]});
const run = (path, base=baseline(), data=dataset(), opts={}) => handleFundingRequest(new Request(`https://grants.watch/api/v2${path}`),path.split('?')[0].split('/').filter(Boolean),{enabled:true,load:()=>({baseline:base,dataset:data}),now:()=>AT,...opts});

test('v2 sidecar contract accepts scoped facts and exact decimal strings',()=>{ assert.deepEqual(validateFundingDataset(dataset(),baseline(),TODAY),[]); });
test('v2 rejects unknown nested keys without echoing their private contents',()=>{ const d=dataset(); d['program-terms'][0].resources=[{kind:'cash',value:{amount:'1',currency:'USD',unit:'currency',qualifier:'exact',private_note:'do not expose'},restrictions:[]}]; const errors=validateFundingDataset(d,baseline(),TODAY); assert.ok(errors.some(e=>e.includes('unsupported field'))); assert.ok(!errors.join().includes('do not expose')); });
test('v2 publication projection drops unknown keys even without schema validation',()=>{ const d=event(); d.internal_note='SECRET'; d.amount.secret='SECRET'; const out=projectRecord(FUNDING_SCHEMAS['funding-events'],d); assert.ok(!JSON.stringify(out).includes('SECRET')); });
test('v2 rejects numeric amounts, impossible dates, future evidence and invalid references',()=>{
  for (const mutate of [e=>e.amount.amount=0.1,e=>e.checked_on='2026-02-30',e=>e.checked_on='2027-01-01',e=>e.program='absent',e=>e.funder='absent']) { const d=dataset(); mutate(d['funding-events'][0]); assert.ok(validateFundingDataset(d,baseline(),TODAY).length); }
});
test('v2 cannot infer payments and cannot mix award identities',()=>{
  const d=dataset(); d['funding-events'][0].event_type='paid'; assert.ok(validateFundingDataset(d,baseline(),TODAY).some(e=>e.includes('payment_date')));
  d['funding-events'][0].payment_date='2026-10-01'; assert.deepEqual(validateFundingDataset(d,baseline(),TODAY),[]);
  d['funding-events'].push({...event(),key:'other',recipient:'wrong'}); assert.ok(validateFundingDataset(d,baseline(),TODAY).some(e=>e.includes('identity conflict')));
});
test('v2 retains currency and unknown event dates without manufacturing totals',()=>{ const c=buildFundingCollections(baseline(),dataset(),AT); assert.equal(c['funding-events'][0].amount.amount,'10000.01'); assert.equal(c['funding-events'][0].occurred_on,null); assert.equal(c['funding-events'][0].payment_date,null); assert.equal(c.recipients[0].total_known,undefined); });
test('v2 validates process denominators without computing individual success probabilities',()=>{ const d=dataset(); d['process-metrics'][0].offers=100; assert.ok(validateFundingDataset(d,baseline(),TODAY).some(e=>e.includes('incompatible'))); });
test('v2 rejects cyclic and wrong-scope supersession',()=>{ const d=dataset(); d['program-terms'].push({...terms(),key:'terms-2',supersedes_key:'terms-1'}); d['program-terms'][0].supersedes_key='terms-2'; assert.ok(validateFundingDataset(d,baseline(),TODAY).some(e=>e.includes('cycle'))); });
test('v2 source URLs reject credentials, private hosts and access token query strings',()=>{ for(const u of ['https://user:pass@example.org/a','http://127.0.0.1/','http://2130706433/','http://[::1]/','http://a.local/','javascript:alert(1)','https://a.org/?api_key=secret']) assert.equal(isPublicUrl(u),false,u); assert.equal(isPublicUrl(SOURCE),true); });
test('v2 preserves separate evidence for an approved event and a paid tranche',()=>{ const d=dataset(); d['funding-events'].push({...event(),key:'payment-1',event_type:'paid',payment_date:'2026-10-02',occurred_on:'2026-10-02',tranche:'first'}); const c=buildFundingCollections(baseline(),d,AT); assert.equal(c['funding-events'].length,2); assert.equal(c.recipients[0].funding_event_count,2); assert.equal(c.recipients[0].total,undefined); });

const withApply = (b=baseline()) => { b.programs[0].apply_url=`${SOURCE}/apply`; return b; };
const undated = (b=baseline()) => { delete b.programs[0].rounds[0].opens; delete b.programs[0].rounds[0].closes; return b; };
test('v2 opportunities need an application route; a current access check is the strongest basis',()=>{
 const c=buildFundingCollections(baseline(),dataset(),AT); assert.equal(c.opportunities.length,1); assert.equal(c.opportunities[0].basis,'access_check');
 assert.equal(c.opportunities[0].apply_url,SOURCE); assert.equal(c.opportunities[0].entry_stage,'Initial application');
 assert.equal(buildFundingCollections(baseline(),emptyFundingDataset(),AT).opportunities.length,0);
});
test('v2 a dated open round with a program apply link is an opportunity without terms',()=>{
 const [o]=buildFundingCollections(withApply(),emptyFundingDataset(),AT).opportunities;
 assert.equal(o.basis,'published_deadline'); assert.equal(o.apply_url,`${SOURCE}/apply`); assert.equal(o.closes,'2026-11-01');
 assert.equal(o.terms_key,null); assert.equal(o.entry_stage,null); assert.equal(o.checked_on,null); assert.equal(o.source,SOURCE);
 for (const field of ['instruments','capital_forms','selection_models','eligibility','geography']) assert.equal(o[field],null,field);
 assert.equal(o.eligibility_is_personalized,false);
});
test('v2 a stale access check no longer hides a dated round; it stops being the basis',()=>{
 const d=dataset(); Object.assign(d['program-terms'][0].access,{checked_on:'2026-09-20',review_after:'2026-10-03'});
 const [o]=buildFundingCollections(baseline(),d,AT).opportunities;
 assert.equal(o.basis,'published_deadline'); assert.equal(o.checked_on,'2026-09-20'); assert.equal(o.apply_url,SOURCE); assert.equal(o.terms_key,'terms-1');
});
test('v2 an undated open round needs a current access check or rolling-intake terms',()=>{
 assert.equal(buildFundingCollections(withApply(undated()),emptyFundingDataset(),AT).opportunities.length,0);
 const rounds=dataset(); rounds['program-terms'][0].access=null;
 assert.equal(buildFundingCollections(withApply(undated()),rounds,AT).opportunities.length,0);
 const rolling=dataset(); rolling['program-terms'][0].access=null; rolling['program-terms'][0].intake_mode='rolling';
 assert.equal(buildFundingCollections(withApply(undated()),rolling,AT).opportunities[0].basis,'rolling_intake');
 assert.equal(buildFundingCollections(undated(),dataset(),AT).opportunities[0].basis,'access_check');
 const stale=dataset(); Object.assign(stale['program-terms'][0].access,{checked_on:'2026-09-20',review_after:'2026-10-03'});
 assert.equal(buildFundingCollections(undated(),stale,AT).opportunities.length,0);
});
test('v2 terms-less opportunities do not match instrument filters they cannot support',async()=>{
 const all=await (await run('/opportunities',withApply(),emptyFundingDataset())).json(); assert.equal(all.data.length,1);
 const filtered=await (await run('/opportunities?instrument=grant',withApply(),emptyFundingDataset())).json(); assert.equal(filtered.data.length,0);
});
test('v2 excludes announced, future-opening, paused, expired and uncertain-date rounds',()=>{
 for (const mutate of [p=>p.status='paused',p=>p.rounds[0].status='announced',p=>p.rounds[0].opens='2026-10-05',p=>p.rounds[0].closes='2026-10-03',p=>p.rounds[0].closes='2026-10',p=>p.rounds[0].closes_at='2026-10-04T14:59:00Z',p=>p.review={kind:'unresolved',relationship:'unconfirmed',intake:'unknown'}]) {for (const d of [dataset(),emptyFundingDataset()]) {const b=withApply(); mutate(b.programs[0]); assert.equal(buildFundingCollections(b,d,AT).opportunities.length,0);}}
});
test('v2 terms can veto a dated round: invite-only, closed intake, closed or refused access, disputed evidence',()=>{
 for (const mutate of [t=>t.selection_models=['invitation'],t=>t.selection_models=['application','internal_selection'],t=>t.intake_mode='closed',t=>t.intake_mode='no_unsolicited',t=>t.intake_mode='nomination',t=>{t.access.state='closed';t.access.prerequisites_clear=false;},t=>Object.assign(t.access,{state:'unknown',new_applicants:false}),t=>Object.assign(t.access,{state:'unknown',prerequisites_clear:false}),t=>{t.evidence_state='disputed';t.access=null;}]) {const d=dataset(); mutate(d['program-terms'][0]); assert.equal(buildFundingCollections(withApply(),d,AT).opportunities.length,0);}
});
test('v2 conflicting unlinked terms veto rather than choose a convenient newest version',()=>{const d=dataset(); d['program-terms'].push({...terms(),key:'terms-2'}); assert.equal(buildFundingCollections(withApply(),d,AT).opportunities.length,0); d['program-terms'][1].supersedes_key='terms-1'; assert.equal(buildFundingCollections(withApply(),d,AT).opportunities.length,1);});
test('v2 round-scoped historical terms do not become current program terms',()=>{const d=dataset(); d['program-terms'][0].round_name='Current'; const c=buildFundingCollections(baseline(),d,AT); assert.equal(c.programs[0].current_terms_key,null); assert.equal(c.opportunities.length,1);});
test('v2 API never returns raw review metadata or extra baseline fields',async()=>{const b=baseline(); b.programs[0].review={kind:'program',relationship:'current',intake:'open',questions:['PRIVATE'],history:[{secret:'PRIVATE'}]}; b.orgs[0].internal='PRIVATE'; for(const kind of ['orgs','programs','rounds','opportunities']) assert.ok(!(await run(`/${kind}`,b).text()).includes('PRIVATE'));});
test('v2 gated service is inert and returns readable preflight',()=>{let loads=0; assert.equal(run('/programs',baseline(),dataset(),{enabled:false,load:()=>{loads++;}}).status,503); assert.equal(loads,0); assert.equal(handleFundingRequest(new Request('https://grants.watch/api/v2',{method:'OPTIONS'}),[],{}).status,204);});
test('v2 strict query rejects duplicate, unknown, out-of-range and invalid enums before reading',()=>{for(const q of ['limit=0','limit=101','limit=1&limit=2','unexpected=1','capital_form=nonsense','q=','cursor=a&cursor=b']) {let loads=0; const r=run(`/programs?${q}`,baseline(),dataset(),{load:()=>{loads++;}}); assert.equal(r.status,400,q); assert.equal(loads,0);}});
test('v2 paginates, binds cursors to queries and rejects changed snapshots',()=>{
 const b=baseline(); for(let i=0;i<105;i++) b.programs.push({...b.programs[0],id:`p-${i}`,rounds:[]}); const c=buildFundingCollections(b,emptyFundingDataset(),AT);
 const first=queryFundingCollection('programs',new URLSearchParams('limit=100'),c); assert.equal(first.data.length,100); assert.equal(first.meta.total,106);
 const next=queryFundingCollection('programs',new URLSearchParams({cursor:first.meta.next_cursor,limit:'100'}),c); assert.equal(next.data.length,6); assert.equal(next.meta.next_cursor,null);
 assert.throws(()=>queryFundingCollection('orgs',new URLSearchParams({cursor:first.meta.next_cursor}),c),e=>e.status===400);
 c.programs[0].name='Changed'; assert.throws(()=>queryFundingCollection('programs',new URLSearchParams({cursor:first.meta.next_cursor}),c),e=>e.status===409);
});
test('v2 rejects fabricated cursor shapes and unsupported detail filters',async()=>{assert.equal(run('/programs?cursor=not-json').status,400); assert.equal(run('/programs/program?limit=1').status,400); assert.equal(run('/absent').status,404); assert.equal(run('/programs/missing').status,404); const r=run('/programs/program'); assert.equal(r.status,200); assert.equal(r.headers.get('Cache-Control'),'no-store'); assert.equal((await r.json()).data.id,'program');});
test('v2 empty ledgers are distinct from corrupt data',async()=>{assert.equal((await run('/funding-events',baseline(),emptyFundingDataset()).json()).data.length,0); const d=dataset();d['funding-events'][0].secret='PRIVATE';const r=run('/funding-events',baseline(),d);assert.equal(r.status,503);assert.ok(!(await r.text()).includes('PRIVATE'));});
test('v2 every advertised endpoint exists and every detail link resolves',async()=>{const index=await run('').json(); for(const path of Object.values(index.endpoints)){const r=run(path.replace('/api/v2',''));assert.equal(r.status,200,path); const list=await r.json(); for(const item of list.data.slice(0,2)) assert.equal(run(item.api.replace('/api/v2','')).status,200,item.api);}});

function fixture() {
 const root=mkdtempSync(join(tmpdir(),'funding-test-')); const registry=join(root,'registry'); mkdirSync(registry); const b=baseline();
 for(const [sub,rows] of [['orgs',b.orgs],['programs',b.programs]]) {mkdirSync(join(registry,sub));for(const row of rows) writeFileSync(join(registry,sub,`${row.id}.yaml`),JSON.stringify(row));}
 const parsed=readBaseline(registry,JSON.parse); const pack={schema_version:2,id:'test-pilot',reference_blobs:parsed.source_blobs,records:dataset()};
 return {root,registry,parsed,pack,clean:()=>rmSync(root,{recursive:true,force:true})};
}
test('v2 migration dry-run is pure and preserves source bytes',()=>{const f=fixture();try{const before=canonical(f.pack), empty=emptyFundingDataset();const p=planFundingImport(f.parsed,empty,f.pack,TODAY);assert.equal(canonical(f.pack),before);assert.equal(empty['funding-events'].length,0);assert.equal(p.report.legacy_files_changed,0);assert.equal(p.report.payment_events_added,0);assert.ok(!existsSync(join(f.registry,'funding-events')));}finally{f.clean();}});
test('v2 migration is idempotent and conflicting keys fail closed',()=>{const f=fixture();try{const p=planFundingImport(f.parsed,emptyFundingDataset(),f.pack,TODAY);const repeated=planFundingImport(f.parsed,p.dataset,f.pack,TODAY);assert.deepEqual(repeated.report.added,Object.fromEntries(LEDGERS.map(k=>[k,0])));f.pack.records['funding-events'][0].amount.amount='20';assert.throws(()=>planFundingImport(f.parsed,p.dataset,f.pack,TODAY),/different contents/);}finally{f.clean();}});
test('v2 migration refuses unguarded refs, baseline drift and duplicate candidate keys',()=>{const f=fixture();try{const changed=structuredClone(f.pack);changed.reference_blobs['orgs/funder.yaml']='a'.repeat(40);assert.throws(()=>planFundingImport(f.parsed,emptyFundingDataset(),changed,TODAY),/changed/);delete changed.reference_blobs['orgs/funder.yaml'];assert.throws(()=>planFundingImport(f.parsed,emptyFundingDataset(),changed,TODAY),/guard/);f.pack.records['funding-events'].push(event());assert.throws(()=>planFundingImport(f.parsed,emptyFundingDataset(),f.pack,TODAY),/Duplicate/);}finally{f.clean();}});
test('v2 staged import validates new copy and preserves original files byte-for-byte',()=>{const f=fixture();try{const p=planFundingImport(f.parsed,emptyFundingDataset(),f.pack,TODAY);const out=join(f.root,'stage');writeFundingStage(f.registry,out,p,root=>assert.deepEqual(validateFundingDataset(readFundingLedgers(root),f.parsed,TODAY),[]));assert.equal(readFileSync(join(out,'registry/programs/program.yaml'),'utf8'),readFileSync(join(f.registry,'programs/program.yaml'),'utf8'));const loaded=readFundingLedgers(join(out,'registry'));assert.equal(loaded['funding-events'].length,1);assert.ok(!existsSync(join(f.registry,'funding-events')));assert.throws(()=>writeFundingStage(f.registry,out,p),/overwrite/);}finally{f.clean();}});
test('v2 invalid staging cannot publish partial output or overwrite source',()=>{const f=fixture();try{const p=planFundingImport(f.parsed,emptyFundingDataset(),f.pack,TODAY);const out=join(f.root,'stage');assert.throws(()=>writeFundingStage(f.registry,out,p,()=>{throw new Error('Rejected');}),/Rejected/);assert.equal(existsSync(out),false);assert.deepEqual(readdirSync(f.root),['registry']);assert.throws(()=>writeFundingStage(f.registry,join(f.registry,'stage'),p),/outside/);}finally{f.clean();}});
test('v2 staging detects drift after planning and during validation',()=>{const f=fixture();try{const p=planFundingImport(f.parsed,emptyFundingDataset(),f.pack,TODAY);const path=join(f.registry,'programs/program.yaml'),bytes=readFileSync(path);writeFileSync(path,`${bytes}\n`);assert.throws(()=>writeFundingStage(f.registry,join(f.root,'a'),p),/changed after planning/);writeFileSync(path,bytes);assert.throws(()=>writeFundingStage(f.registry,join(f.root,'b'),p,()=>writeFileSync(path,`${bytes}\n`)),/during staging/);assert.equal(existsSync(join(f.root,'b')),false);}finally{f.clean();}});
test('v2 corrupt JSONL and symlinks fail instead of producing empty successful data',()=>{const f=fixture();try{mkdirSync(join(f.registry,'funding-events'));writeFileSync(join(f.registry,'funding-events/x.jsonl'),'{');assert.throws(()=>readFundingLedgers(f.registry));rmSync(join(f.registry,'funding-events/x.jsonl'));symlinkSync(join(f.registry,'programs/program.yaml'),join(f.registry,'funding-events/x.jsonl'));assert.throws(()=>readFundingLedgers(f.registry),/Unsafe/);}finally{f.clean();}});
test('v2 digest and Git blob guards hash actual bytes',()=>{assert.equal(blobHash('hello\n'),'ce013625030ba8dba906f756967f9e9ca394464a');assert.equal(digest(Buffer.from('hello')),digest('hello'));});
