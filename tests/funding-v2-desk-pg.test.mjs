// Real Desk approvals and fresh-process replay against a THROWAWAY test database.
import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
import {closePg,loadDeskStore,lockDatabase,row,rows,sandboxCwd,skipWithoutPg,truncateDeskTables,TEST_DATABASE_URL} from './pg-helper.mjs';
import {previewFundingProposal,readControlledFunding,CONTROL_PATH} from '../src/lib/funding-desk-core.mjs';
import {readBaseline} from '../src/lib/funding-store.mjs';
import {calendarDate} from '../src/lib/funding-api.mjs';
const opts={skip:skipWithoutPg};
const repo=resolve('.'),oldEnv={...process.env};
let sandbox,store,decide,committer;
const pack=JSON.parse(readFileSync(join(repo,'research/v2/spotify-pilot.json'),'utf8'));
function setupFiles(){
 for(const sub of ['registry','.data','scripts'])rmSync(join(sandbox,sub),{recursive:true,force:true});
 cpSync(join(repo,'registry'),join(sandbox,'registry'),{recursive:true});
 mkdirSync(join(sandbox,'scripts'));
 cpSync(join(repo,'scripts/validate-registry.mjs'),join(sandbox,'scripts/validate-registry.mjs'));
 if(!existsSync(join(sandbox,'node_modules')))symlinkSync(join(repo,'node_modules'),join(sandbox,'node_modules'),'dir');
}
async function queue(candidate=pack){
 const root=join(sandbox,'registry'),baseline=readBaseline(root,YAML.parse);
 const preview=previewFundingProposal(root,baseline,candidate,calendarDate());
 preview.proposal.signal_id=`funding-v2:${preview.plan_digest}`;
 return (await store.insertIngestProposals([preview.proposal])).inserted[0];
}
function restart(root){
 const sourceHref=pathToFileURL(join(repo,'src/lib/boot-replay.ts')).href;
 const code=`const {replayAppliedChanges}=await import(${JSON.stringify(sourceHref)});const r=await replayAppliedChanges({root:process.cwd()});console.log('RESULT:'+JSON.stringify(r));`;
 const output=execFileSync(process.execPath,['--experimental-strip-types','--experimental-loader',join(repo,'tests/ts-loader.mjs'),'--input-type=module','-e',code],{cwd:root,env:{...process.env,DATABASE_URL:TEST_DATABASE_URL},encoding:'utf8',timeout:30000});
 return JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT:')).slice(7));
}
before(async()=>{
 if(skipWithoutPg)return;
 await lockDatabase();sandbox=sandboxCwd();setupFiles();
 process.env.GRANTS_WATCH_NO_GIT='1';process.env.GRANTS_WATCH_FUNDING_DESK='1';
 store=await loadDeskStore();await store.getIngestState('__warmup');
 decide=await import('../src/lib/desk-decide.ts');committer=await import('../src/lib/committer.ts');
});
beforeEach(async()=>{if(skipWithoutPg)return;await truncateDeskTables();setupFiles();});
after(async()=>{if(skipWithoutPg)return;await truncateDeskTables();await closePg();process.chdir(repo);rmSync(sandbox,{recursive:true,force:true});process.env=oldEnv;});

test('v2 queued records require the owner and approved rows survive a real fresh process',opts,async()=>{
 const p=await queue();assert.equal(p.state,'pending');assert.equal(p.lane,'judgment');
 assert.equal(existsSync(join(sandbox,CONTROL_PATH)),false);
 const denied=await decide.decideProposal({id:p.id,decision:'approved',by:'curator'});assert.equal(denied.status,403);
 assert.equal((await store.getProposal(p.id)).state,'pending');
 const approved=await decide.decideProposal({id:p.id,decision:'approved',by:'owner'});assert.equal(approved.status,200,JSON.stringify(approved.body));
 assert.equal(approved.body.commit,null);
 const ledger=await row('SELECT files,state,synced_at FROM desk_applied_changes');assert.equal(ledger.state,'ready');assert.equal(ledger.synced_at,null);
 assert.ok(ledger.files.some(f=>f.path===CONTROL_PATH));assert.equal(ledger.files.length,3);
 const root=join(sandbox,'restart');mkdirSync(root);cpSync(join(repo,'registry'),join(root,'registry'),{recursive:true});
 const replay=restart(root);assert.equal(replay.failed,0);assert.equal(replay.applied,1);
 assert.equal(readControlledFunding(join(root,'registry')).dataset['funding-events'].length,3);
 const repeated=restart(root);assert.equal(repeated.applied,0);assert.equal(repeated.alreadyApplied,1);
 assert.equal((await row('SELECT synced_at FROM desk_applied_changes')).synced_at,null);
});
test('v2 stale queued snapshots fail before another write and return to pending',opts,async()=>{
 const first=await queue(),other=structuredClone(pack);other.id='second-pack';other.records['program-terms'][0].key='spotify:another-observation';other.records['funding-events']=[];
 const second=await queue(other);
 assert.equal((await decide.decideProposal({id:first.id,decision:'approved'})).status,200);
 const snapshot=readFileSync(join(sandbox,CONTROL_PATH),'utf8');
 const failure=await decide.decideProposal({id:second.id,decision:'approved'});assert.equal(failure.status,500);assert.match(failure.body.error,/stale/);
 assert.equal((await store.getProposal(second.id)).state,'pending');assert.equal(readFileSync(join(sandbox,CONTROL_PATH),'utf8'),snapshot);
 assert.equal((await rows('SELECT id FROM desk_applied_changes')).length,1);
});
test('v2 verdict failure holds the claim and its prepared row never replays',opts,async()=>{
 const p=await queue();
 const result=await decide.decideProposal({id:p.id,decision:'approved'},{...decide.defaultDecideDeps,recordVerdict:async()=>{throw new Error('injected verdict outage');}});
 assert.equal(result.status,500);assert.equal(result.body.reconciliation_hold,true);
 assert.equal((await store.getProposal(p.id)).state,'applying');
 assert.equal((await row('SELECT state FROM desk_applied_changes')).state,'prepared');
 const root=join(sandbox,'prepared-restart');mkdirSync(root);cpSync(join(repo,'registry'),join(root,'registry'),{recursive:true});
 const replay=restart(root);assert.equal(replay.applied,0);assert.equal(existsSync(join(root,CONTROL_PATH)),false);
});
test('v2 concurrent prepared intents cannot fork the shared control path',opts,async()=>{
 const first=await queue(),other=structuredClone(pack);other.id='competing-pack';other.records['program-terms'][0].key='spotify:competing-observation';other.records['funding-events']=[];
 const second=await queue(other);const a=await store.claimProposal(first.id),b=await store.claimProposal(second.id);
 const ar=committer.prepareProposalChanges(a),br=committer.prepareProposalChanges(b);
 await committer.recordPreparedChangeIntent(ar,'first reviewed intent',a.id);
 await assert.rejects(()=>committer.recordPreparedChangeIntent(br,'competing reviewed intent',b.id));
 assert.equal((await rows("SELECT id FROM desk_applied_changes WHERE state='prepared'")).length,1);
 assert.equal(existsSync(join(sandbox,CONTROL_PATH)),false);
});
