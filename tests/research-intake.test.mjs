import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResearchPacket, prepareResearch, findingRevision } from '../src/lib/research-intake.ts';
const hash='a'.repeat(64);
const finding={id:'wire:1',title:'Eligibility update',summary:'The program now accepts independent researchers.',source_url:'https://example.org/call',observed_at:'2026-09-18T12:00:00Z',source_kind:'official',program_id:'fund',expected_hash:hash,changes:{summary:'The program now accepts independent researchers for its grants.'}};
const packet=(findings=[finding])=>({version:1,run_id:'wire-2026-09-18',wire:'oss',producer:'fixture',completed_at:'2026-09-18T13:00:00Z',coverage:[{provider:'fixture',status:'complete',results:findings.length,cost_usd:0}],findings});
const program={id:'fund',org:'example',name:'Example fund'};
test('no-deadline official updates become guarded Desk proposals with durable evidence',()=>{
 const report=prepareResearch(parseResearchPacket(packet()),[program],{fund:hash});
 assert.equal(report.outcomes[0].state,'queued');
 assert.equal(report.findings[0].summary,finding.summary);
 assert.equal(report.proposals[0].proposed_change._expected_content_hashes['programs/fund.yaml'],hash);
});
test('social evidence, missing sources, unresolved identities and stale hashes retain explicit outcomes',()=>{
 for(const [patch,expected] of [[{source_kind:'social'},'pending_review'],[{source_url:null},'pending_review'],[{program_id:'unknown'},'pending_review'],[{expected_hash:'b'.repeat(64)},'conflict']]) {
 const report=prepareResearch(parseResearchPacket(packet([{...finding,...patch}])),[program],{fund:hash});assert.equal(report.outcomes[0].state,expected);assert.equal(report.proposals.length,0);
 }
});
test('revisions ignore re-observation time but preserve edited older evidence',()=>{
 assert.equal(findingRevision(finding),findingRevision({...finding,observed_at:'2026-09-19T12:00:00Z'}));
 assert.notEqual(findingRevision(finding),findingRevision({...finding,summary:'The same page now closes applications.'}));
});
test('intake rejects ambiguous identity, malformed evidence and unsupported mutations',()=>{
 assert.throws(()=>parseResearchPacket(packet([finding,finding])),/unique/);
 assert.throws(()=>parseResearchPacket(packet([{...finding,source_url:'javascript:alert(1)'}])),/evidence/);
 assert.throws(()=>parseResearchPacket(packet([{...finding,changes:{org:'other'}}])),/unsupported/);
 assert.throws(()=>parseResearchPacket(packet([{...finding,disposition:{state:'duplicate',reason:'same'}}])),/reference/);
 assert.throws(()=>parseResearchPacket(packet([{...finding,classification:{label:'OPPORTUNITY',model:'jev',confidence:NaN}}])),/classification/);
});
test('durable intake replay does not duplicate proposals and edited findings remain actionable', async () => {
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');
 const {execFileSync}=await import('node:child_process');
 const root=mkdtempSync(join(tmpdir(),'grant-research-'));
 try {
  mkdirSync(join(root,'registry/programs'),{recursive:true});
  writeFileSync(join(root,'registry/programs/fund.yaml'),JSON.stringify({...program,wires:['oss'],systems:[],status:'active',summary:'A fixture funding program for independent researchers.',rounds:[],sources:['https://example.org/call']}));
  const child=`import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import {ingestResearch} from ${JSON.stringify(resolve('src/lib/research-intake.ts'))};import {listProposals} from ${JSON.stringify(resolve('src/lib/desk-store.ts'))};
  const p=${JSON.stringify(packet())};p.findings[0].expected_hash=createHash('sha256').update(readFileSync('registry/programs/fund.yaml')).digest('hex');
  const preview=await ingestResearch(p,false);assert.equal(preview.saved,false);assert.equal((await listProposals()).length,0);
  const first=await ingestResearch(p,true);assert.deepEqual(await ingestResearch(p,true),first);assert.equal((await listProposals()).length,1);
  await assert.rejects(ingestResearch({...p,producer:'different'},true),/different packet/);
  const repeat=await ingestResearch({...p,run_id:'second-run'},true);assert.equal(repeat.outcomes[0].state,'unchanged');assert.equal((await listProposals()).length,1);
  p.run_id='edited-old-finding';p.findings[0].summary+=' New official clarification.';assert.equal((await ingestResearch(p,true)).outcomes[0].state,'queued');assert.equal((await listProposals()).length,2);`;
  const env={...process.env};delete env.DATABASE_URL;
  execFileSync(process.execPath,['--experimental-strip-types','--experimental-loader',resolve('tests/ts-loader.mjs'),'--input-type=module','-e',child],{cwd:root,env,stdio:'pipe'});
 } finally {rmSync(root,{recursive:true,force:true});}
});
