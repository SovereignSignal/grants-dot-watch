import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,copyFileSync,symlinkSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {lockDatabase,closePg,sandboxCwd,loadDeskStore,truncateDeskTables,skipWithoutPg,sql,sha256,TEST_DATABASE_URL} from './pg-helper.mjs';
const repo=process.cwd();let root,store,intake,committer,registry,api;
const program={id:'fixture',name:'Example Research Grants',org:'example',systems:[],wires:['oss'],status:'active',summary:'An ongoing fixture program supporting open source research.',rounds:[],sources:['https://example.org/grants']};
const path='registry/programs/fixture.yaml';let original;
before(async()=>{
 if(skipWithoutPg)return;await lockDatabase();root=sandboxCwd();
 for(const dir of ['registry/programs','registry/orgs','registry/systems','registry/awards','scripts'])mkdirSync(join(root,dir),{recursive:true});
 symlinkSync(join(repo,'node_modules'),join(root,'node_modules'),'dir');copyFileSync(join(repo,'scripts/validate-registry.mjs'),join(root,'scripts/validate-registry.mjs'));
 original=JSON.stringify(program);writeFileSync(path,original);writeFileSync('registry/orgs/example.yaml',JSON.stringify({id:'example',name:'Example Foundation',systems:[],wires:['oss'],roles:['funder'],status:'active',profile:'A fixture foundation that supports independent open source research and development.',sources:program.sources}));
 store=await loadDeskStore();await store.listProposals();await truncateDeskTables();process.env.GRANTS_WATCH_NO_GIT='1';
 intake=await import('../src/lib/research-intake.ts');committer=await import('../src/lib/committer.ts');registry=await import('../src/lib/registry.ts');api=await import('../src/lib/public-api.ts');
});
after(async()=>{if(skipWithoutPg)return;await truncateDeskTables();await closePg();process.chdir(repo);rmSync(root,{recursive:true,force:true});});
const packet=(id,patch={})=>({version:1,run_id:id,wire:'oss',producer:'fixture',completed_at:'2026-09-25T01:00:00Z',coverage:[],findings:[{id:'wire:1',title:'Application route and eligibility correction',summary:'Independent researchers can now apply through the updated application route.',source_url:'https://example.org/grants',observed_at:'2026-09-25T00:00:00Z',source_kind:'official',program_id:'fixture',expected_hash:sha256(readFileSync(path,'utf8')),changes:{summary:'Independent researchers can apply for ongoing support of open source research.',apply_url:'https://example.org/apply'},...patch}]});
test('a reviewed correction persists, owner acceptance is durable, and a restarted public reader sees it', {skip:skipWithoutPg},async()=>{
 const p=packet('correction');const preview=await intake.ingestResearch(p);assert.equal(preview.saved,false);assert.equal((await store.listProposals()).length,0);
 const saved=await intake.ingestResearch(p,true);assert.equal(saved.outcomes[0].state,'queued');assert.ok(saved.outcomes[0].proposal_id);
 const fetched=await store.getIngestState('research:run:correction');assert.deepEqual(fetched,JSON.parse(JSON.stringify(saved)));
 const proposal=await store.claimProposal(saved.outcomes[0].proposal_id);const result=await committer.applyProposalDurably(proposal);
 await store.recordVerdict(proposal.id,'approved',{from:'applying',by:'owner',ledgerRequired:true,commit:result.commit});
 assert.equal((await sql("SELECT count(*)::int n FROM desk_applied_changes WHERE state='ready' AND synced_at IS NULL")).rows[0].n,1);
 const {acceptedWireMappings}=await import('../src/lib/wire-handoff.ts');
 assert.equal(acceptedWireMappings(await store.listProposals()).get(1),'fixture');
 assert.equal(api.getRecord('programs','fixture').apply_url,'https://example.org/apply');
 // Simulate an ephemeral container starting from the unchanged build image.
 writeFileSync(path,original);registry.invalidateRegistryCache();assert.equal(api.getRecord('programs','fixture').apply_url,null);
 const child=`import assert from 'node:assert/strict';import {replayAppliedChanges} from ${JSON.stringify(resolve(repo,'src/lib/boot-replay.ts'))};import {getRecord} from ${JSON.stringify(resolve(repo,'src/lib/public-api.ts'))};const report=await replayAppliedChanges();assert.equal(report.applied,1);assert.equal(getRecord('programs','fixture').apply_url,'https://example.org/apply');`;
 execFileSync(process.execPath,['--experimental-strip-types','--experimental-loader',resolve(repo,'tests/ts-loader.mjs'),'--input-type=module','-e',child],{cwd:root,env:{...process.env,DATABASE_URL:TEST_DATABASE_URL},stdio:'pipe'});
 registry.invalidateRegistryCache();assert.equal(api.getRecord('programs','fixture').apply_url,'https://example.org/apply');
 // The exact old source revision is already recorded, and a changed old
 // finding remains actionable against the current file hash.
 const repeat=await intake.ingestResearch({...p,run_id:'repeat'},true);assert.equal(repeat.outcomes[0].state,'unchanged');
 const edited=packet('old-entry-edited',{summary:'The application route has changed again.',changes:{apply_url:'https://example.org/apply-again'}});
 const queued=await intake.ingestResearch(edited,true);assert.equal(queued.outcomes[0].state,'queued');
 writeFileSync(path,readFileSync(path,'utf8')+'\n# Concurrent owner edit\n');
 const stale=await store.getProposal(queued.outcomes[0].proposal_id);assert.throws(()=>committer.prepareProposalChanges(stale),/stale/);
});
