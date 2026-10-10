import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { buildFundingCollections } from '../src/lib/funding-api.mjs';
import { readBaseline, readFundingLedgers } from '../src/lib/funding-store.mjs';

import { legacyRegistryCopy } from './legacy-registry.mjs';
const legacy=legacyRegistryCopy(); test.after(()=>legacy.cleanup());
const root=legacy.root, pack=resolve('research/v2/spotify-pilot.json');
const run=(args)=>execFileSync(process.execPath,['scripts/stage-funding-import.mjs',...args],{encoding:'utf8',timeout:60000,maxBuffer:1048576});

test('v2 real-registry pilot dry run is source-guarded and does not infer payments',()=>{
  const result=JSON.parse(run(['--root',root,'--pack',pack]));
  assert.equal(result.mode,'dry_run');
  assert.equal(result.legacy_files_changed,0);
  assert.equal(result.payment_events_added,0);
  assert.deepEqual(result.added,{'program-terms':1,'funding-events':3,'process-metrics':0});
});
test('v2 real-registry staging keeps legacy bytes intact, validates, reads and replays cleanly',()=>{
  const temp=mkdtempSync(join(tmpdir(),'funding-cli-test-'));
  try {
    const output=join(temp,'preview');
    const result=JSON.parse(run(['--root',root,'--pack',pack,'--write-stage',output]));
    assert.equal(result.mode,'external_staging_copy');
    const staged=join(output,'registry');
    for(const sub of ['orgs','programs','awards','systems']) for(const name of readdirSync(join(root,sub))) {
      assert.deepEqual(readFileSync(join(staged,sub,name)),readFileSync(join(root,sub,name)),`${sub}/${name}`);
    }
    const validation=JSON.parse(execFileSync(process.execPath,['scripts/validate-registry-v2.mjs','--root',staged],{encoding:'utf8'}));
    assert.equal(validation.status,'valid');
    const replay=JSON.parse(run(['--root',staged,'--pack',pack]));
    assert.equal(Object.values(replay.added).reduce((a,b)=>a+b,0),0);
    const collections=buildFundingCollections(readBaseline(staged,YAML.parse),readFundingLedgers(staged));
    const awards=collections['funding-events'].filter(e=>e.program==='spotify-foss-fund');
    assert.equal(awards.length,3);
    assert.deepEqual(awards.map(e=>e.amount.amount).sort(),['15000','25000','30000']);
    assert.ok(awards.every(e=>e.payment_date===null && e.occurred_on===null && e.amount.currency==='EUR'));
    assert.ok(!collections.opportunities.some(e=>e.program==='spotify-foss-fund'));
  } finally {rmSync(temp,{recursive:true,force:true});}
});
test('v2 refuses direct apply flags and never opens a database',()=>{
 const result=spawnSync(process.execPath,['scripts/stage-funding-import.mjs','--pack',pack,'--apply'],{encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Unknown option/);
});
test('v2 foundation preserves the exact v1 loader, types, validator and serializer',()=>{
 const expected={
   'src/lib/types.ts':'d0b205765cf554fbc7bed2c9b88bddc3b28ad9df',
   'src/lib/registry.ts':'8140aa8b84f046bb0f2423eabe16951daeefdb71',
   'src/lib/public-api.ts':'5294eff89b70e438ebfa83f364083728296f5df9',
   'scripts/validate-registry.mjs':'cd6cb98e656c3f96596688ddc6475d0132fc69d3',
 };
 for(const [path,hash] of Object.entries(expected)) {
   const bytes=readFileSync(path);
   assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),hash,path);
 }
});
