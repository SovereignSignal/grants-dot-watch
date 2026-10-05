import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionSpec,verifyRestoreTarget,commandEnv,restoreDatabaseName} from '../scripts/funding-closeout/backup-restore.mjs';
const source=connectionSpec('postgresql://test:secret@127.0.0.1:5432/funding_test');
const name='gw_restore_12345678',target=connectionSpec(`postgresql://test:secret@127.0.0.1:5432/${name}`);
test('backup refuses a source database reused as a target despite different hosts',()=>{assert.throws(()=>verifyRestoreTarget(source,{...target,database:source.database},source.database));assert.throws(()=>verifyRestoreTarget(source,target,'production'));assert.equal(verifyRestoreTarget(source,target,name),true);});
test('backup connection parser refuses public destinations, options and ambiguous names',()=>{for(const url of ['https://x/a','postgresql://u:p@public.example.com/funding_test','postgresql://u:p@127.0.0.1/funding_test?options=-c','postgresql://u:p@127.0.0.1/a-b','postgresql://u:p@127.0.0.1/funding_test#x'])assert.throws(()=>connectionSpec(url));});
test('backup uses an explicit libpq environment and read-only source defaults',()=>{const env=commandEnv(source,true);assert.equal(env.PGPASSWORD,'secret');assert.equal(env.PGDATABASE,'funding_test');assert.match(env.PGOPTIONS,/default_transaction_read_only=on/);assert.equal(env.DATABASE_URL,undefined);assert.equal(env.PGSERVICE,undefined);assert.equal(env.HOME,'/nonexistent');});
test('backup generated targets are bounded, unique and visibly disposable',()=>{const names=Array.from({length:20},restoreDatabaseName);assert.equal(new Set(names).size,20);assert.ok(names.every(n=>/^gw_restore_[a-f0-9]{32}$/.test(n)));});
