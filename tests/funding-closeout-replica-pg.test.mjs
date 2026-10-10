// Two independently running processes share only the isolated CI PostgreSQL outbox.
import test,{before,beforeEach,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import YAML from 'yaml';
import {lockDatabase,loadDeskStore,truncateDeskTables,closePg,sandboxCwd,row,TEST_DATABASE_URL,skipWithoutPg} from './pg-helper.mjs';
import {copyLegacyRegistry} from './legacy-registry.mjs';
import {previewFundingProposal,readControlledFunding} from '../src/lib/funding-desk-core.mjs';
import {readBaseline} from '../src/lib/funding-store.mjs';
import {calendarDate} from '../src/lib/funding-api.mjs';
const opts={skip:skipWithoutPg},repo=resolve('.'),oldEnv={...process.env},children=[];
const spotify=JSON.parse(readFileSync(join(repo,'research/v2/spotify-pilot.json'),'utf8'));
const yc=JSON.parse(readFileSync(join(repo,'research/v2/yc-investment-pilot.json'),'utf8'));
let sandbox,store,decide;
function copy(root){mkdirSync(root,{recursive:true});copyLegacyRegistry(join(root,'registry'),join(repo,'registry'));}
function setup(){
 for(const name of ['registry','.data','scripts','readers'])rmSync(join(sandbox,name),{recursive:true,force:true});
 copy(sandbox);mkdirSync(join(sandbox,'scripts'));cpSync(join(repo,'scripts/validate-registry.mjs'),join(sandbox,'scripts/validate-registry.mjs'));
 if(!existsSync(join(sandbox,'node_modules')))symlinkSync(join(repo,'node_modules'),join(sandbox,'node_modules'),'dir');
}
async function queue(pack){const root=join(sandbox,'registry'),p=previewFundingProposal(root,readBaseline(root,YAML.parse),pack,calendarDate());return (await store.insertIngestProposals([p.proposal])).inserted[0];}
async function approve(pack){const p=await queue(pack),result=await decide.decideProposal({id:p.id,decision:'approved',by:'owner'});assert.equal(result.status,200,JSON.stringify(result.body));return readControlledFunding(join(sandbox,'registry')).control.hash;}
async function worker(name,cwd){
 const root=cwd||join(sandbox,'readers',name);if(!cwd)copy(root);
 const child=fork(join(repo,'tests/fixtures/funding-replica-reader.mjs'),[],{cwd:root,execArgv:['--experimental-strip-types','--experimental-loader',join(repo,'tests/ts-loader.mjs')],env:{...process.env,DATABASE_URL:TEST_DATABASE_URL,GRANTS_WATCH_API_V2:'1',GRANTS_WATCH_FUNDING_DESK:'1'},stdio:['ignore','pipe','pipe','ipc']});
 children.push(child);let seq=0;const waiting=new Map();let log='';child.stderr.on('data',c=>{log=(log+c).slice(-2000);});child.stdout.on('data',()=>{});
 await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Replica startup timeout')),20000);const onMessage=m=>{if(m.ready){clearTimeout(timer);child.off('message',onMessage);assert.equal(m.status,'ok');done();}};child.on('message',onMessage);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Replica exited ${code}: ${log}`));});});
 child.on('message',m=>{const entry=waiting.get(m.id);if(entry){waiting.delete(m.id);clearTimeout(entry.timer);entry.done(m);}});
 return {child,read(op='read'){return new Promise((done,reject)=>{const id=++seq,timer=setTimeout(()=>{waiting.delete(id);reject(new Error('Replica read timeout'));},20000);waiting.set(id,{done,reject,timer});child.send({id,op});});}};
}
async function stop(){await Promise.all(children.splice(0).map(child=>new Promise(done=>{if(child.exitCode!==null)return done();const timer=setTimeout(()=>{child.kill('SIGKILL');done();},3000);child.once('exit',()=>{clearTimeout(timer);done();});if(child.connected)child.send({id:-1,op:'close'});else child.kill('SIGTERM');})));}
before(async()=>{if(skipWithoutPg)return;await lockDatabase();sandbox=sandboxCwd();setup();process.env.GRANTS_WATCH_NO_GIT='1';process.env.GRANTS_WATCH_FUNDING_DESK='1';store=await loadDeskStore();await store.getIngestState('__warmup');decide=await import('../src/lib/desk-decide.ts');});
beforeEach(async()=>{if(skipWithoutPg)return;await truncateDeskTables();setup();});
afterEach(async()=>{if(!skipWithoutPg)await stop();});
after(async()=>{if(skipWithoutPg)return;await stop();await truncateDeskTables();await closePg();process.chdir(repo);rmSync(sandbox,{recursive:true,force:true});process.env=oldEnv;});
test('two long-running production readers follow later approved commits without restarts',opts,async()=>{
 const a=await worker('a'),b=await worker('b');assert.equal((await a.read()).events,0);assert.equal((await b.read()).events,0);
 const first=await approve(spotify),reads=await Promise.all([a.read('api'),b.read('api')]);for(const r of reads){assert.equal(r.status,200);assert.equal(r.head,first);assert.equal(r.count,3);}
 const second=await approve(yc);for(const r of await Promise.all([a.read(),b.read()])){assert.equal(r.control,second);assert.equal(r.terms,2);assert.equal(r.events,3);}
 assert.equal((await row("SELECT count(*)::int AS n FROM desk_applied_changes WHERE state='ready' AND synced_at IS NULL")).n,2);
 console.log('MULTI_PROCESS_FUNDING_RECEIPT '+JSON.stringify({replicas:2,committed_revisions:2,events:3,terms:2,without_restart:true,independent_filesystems:true,approved_head:second}));
});
test('a locally prepared failed verdict is never published and another replica keeps its last approved view',opts,async()=>{
 const approved=await approve(spotify),a=await worker('writer',sandbox),b=await worker('other');
 assert.equal((await a.read()).control,approved);assert.equal((await b.read()).control,approved);
 const p=await queue(yc),failure=await decide.decideProposal({id:p.id,decision:'approved',by:'owner'},{...decide.defaultDecideDeps,recordVerdict:async()=>{throw new Error('intentional approval-handoff failure');}});
 assert.equal(failure.status,500);assert.equal(failure.body.reconciliation_hold,true);
 const refused=await a.read('api');assert.equal(refused.status,503);assert.equal(refused.count,null);
 const safe=await b.read('api');assert.equal(safe.status,200);assert.equal(safe.head,approved);assert.equal(safe.count,3);
 assert.equal((await row("SELECT count(*)::int AS n FROM desk_applied_changes WHERE state='prepared'")).n,1);
});
