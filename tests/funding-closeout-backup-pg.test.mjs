// Only the isolated CI database is accepted by pg-helper. Nothing here can use production.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import YAML from 'yaml';
import {lockDatabase,loadDeskStore,truncateDeskTables,closePg,sandboxCwd,sql,TEST_DATABASE_URL,skipWithoutPg} from './pg-helper.mjs';
import {copyLegacyRegistry} from './legacy-registry.mjs';
import {previewFundingProposal,readControlledFunding} from '../src/lib/funding-desk-core.mjs';
import {readBaseline} from '../src/lib/funding-store.mjs';
import {calendarDate} from '../src/lib/funding-api.mjs';
import {verifyDatabaseRestore,restoreDatabaseName} from '../scripts/funding-closeout/backup-restore.mjs';
const opts={skip:skipWithoutPg},repo=resolve('.'),oldEnv={...process.env};let sandbox,store,decide;
const targets=[];const pack=JSON.parse(readFileSync(join(repo,'research/v2/spotify-pilot.json'),'utf8'));
const dump=process.env.PG_DUMP_BIN||'pg_dump',restore=process.env.PG_RESTORE_BIN||'pg_restore';
function setupFiles(){
 for(const sub of ['registry','.data','scripts'])rmSync(join(sandbox,sub),{recursive:true,force:true});
 copyLegacyRegistry(join(sandbox,'registry'),join(repo,'registry'));mkdirSync(join(sandbox,'scripts'));
 cpSync(join(repo,'scripts/validate-registry.mjs'),join(sandbox,'scripts/validate-registry.mjs'));
 if(!existsSync(join(sandbox,'node_modules')))symlinkSync(join(repo,'node_modules'),join(sandbox,'node_modules'),'dir');
}
async function approve(){
 const root=join(sandbox,'registry'),preview=previewFundingProposal(root,readBaseline(root,YAML.parse),pack,calendarDate());
 const item=(await store.insertIngestProposals([preview.proposal])).inserted[0];
 const verdict=await decide.decideProposal({id:item.id,decision:'approved',by:'owner'});assert.equal(verdict.status,200,JSON.stringify(verdict.body));
 return readControlledFunding(root).control.hash;
}
function target(){const database=restoreDatabaseName(),url=new URL(TEST_DATABASE_URL);url.pathname='/'+database;targets.push(database);return {database,url:url.toString()};}
before(async()=>{
 if(skipWithoutPg)return;execFileSync(dump,['--version']);execFileSync(restore,['--version']);
 await lockDatabase();sandbox=sandboxCwd();setupFiles();process.env.GRANTS_WATCH_NO_GIT='1';process.env.GRANTS_WATCH_FUNDING_DESK='1';
 store=await loadDeskStore();await store.getIngestState('__warmup');decide=await import('../src/lib/desk-decide.ts');
});
beforeEach(async()=>{if(skipWithoutPg)return;await truncateDeskTables();setupFiles();});
after(async()=>{
 if(skipWithoutPg)return;
 for(const name of targets){if(!/^gw_restore_[a-f0-9]{32}$/.test(name))throw new Error('Unsafe test cleanup');await sql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);}
 await truncateDeskTables();await closePg();process.chdir(repo);rmSync(sandbox,{recursive:true,force:true});process.env=oldEnv;
});
test('owner approval survives a real pg_dump/restore and fresh filesystem recovery',opts,async()=>{
 const expected=await approve(),t=target();
 const receipt=await verifyDatabaseRestore({sourceUrl:TEST_DATABASE_URL,targetUrl:t.url,expectedTarget:t.database,pgDump:dump,pgRestore:restore});
 assert.equal(receipt.passed,true);assert.equal(receipt.source_writes,false);assert.equal(receipt.data.sha256,receipt.restored.data_sha256);assert.ok(receipt.data.total_rows>0);
 const root=join(sandbox,'restored-reader');mkdirSync(root);copyLegacyRegistry(join(root,'registry'),join(repo,'registry'));
 const moduleUrl=pathToFileURL(join(repo,'src/lib/boot-replay.ts')).href;
 const code=`const {replayAppliedChanges}=await import(${JSON.stringify(moduleUrl)});console.log('REPLAY:'+JSON.stringify(await replayAppliedChanges({root:process.cwd()})));`;
 const out=execFileSync(process.execPath,['--experimental-strip-types','--experimental-loader',join(repo,'tests/ts-loader.mjs'),'--input-type=module','-e',code],{cwd:root,env:{...process.env,DATABASE_URL:t.url},encoding:'utf8',timeout:30000});
 const replay=JSON.parse(out.split('\n').find(s=>s.startsWith('REPLAY:')).slice(7));assert.equal(replay.status,'ok');assert.equal(replay.failed,0);
 const actual=readControlledFunding(join(root,'registry'));assert.equal(actual.control.hash,expected);assert.equal(actual.dataset['funding-events'].length,3);
 console.log('BACKUP_RESTORE_E2E '+JSON.stringify({scope:receipt.scope,passed:true,schema_sha256:receipt.schema_sha256,data_sha256:receipt.data.sha256,sequence_sha256:receipt.sequence_sha256,tables:receipt.data.tables.length,rows:receipt.data.total_rows,archive_sha256:receipt.archive.sha256,recovered_funding_events:3,source_writes:false}));
});
test('restore refuses an existing database instead of overwriting it',opts,async()=>{
 await approve();const t=target();await sql(`CREATE DATABASE "${t.database}"`);
 await assert.rejects(verifyDatabaseRestore({sourceUrl:TEST_DATABASE_URL,targetUrl:t.url,expectedTarget:t.database,pgDump:dump,pgRestore:restore}),e=>e.receipt.error==='target_already_exists'&&!e.receipt.target_created);
});
test('corrupt restored rows fail comparison even when restore exited successfully',opts,async()=>{
 await approve();const t=target();
 await assert.rejects(verifyDatabaseRestore({sourceUrl:TEST_DATABASE_URL,targetUrl:t.url,expectedTarget:t.database,pgDump:dump,pgRestore:restore,afterRestore:client=>client.query("UPDATE desk_proposals SET data=data || '{\"test_corruption\":true}'::jsonb")}),e=>e.receipt.error==='row_fingerprint_mismatch'&&e.receipt.passed===false);
});
