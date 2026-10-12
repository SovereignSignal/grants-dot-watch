import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function activity(rounds, dates, at='2026-10-12T20:00:00Z') {
  const root=mkdtempSync(join(tmpdir(),'gw-activity-'));
  try {
    for(const sub of ['orgs','programs','awards'])mkdirSync(join(root,'registry',sub),{recursive:true});
    writeFileSync(join(root,'registry/orgs/org.yaml'),JSON.stringify({id:'org',name:'Org',roles:['funder'],systems:[]}));
    writeFileSync(join(root,'registry/programs/fund.yaml'),JSON.stringify({id:'fund',name:'Fund',org:'org',status:'active',wires:['oss'],rounds}));
    writeFileSync(join(root,'registry/awards/2026.jsonl'),dates.map(date=>JSON.stringify({funder:'org',grantee:'recipient',date})).join('\n'));
    const script=`const NativeDate=Date; globalThis.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[${JSON.stringify(at)}]));} static now(){return new NativeDate(${JSON.stringify(at)}).getTime();} }; const {loadRegistry}=await import(${JSON.stringify(new URL('../src/lib/registry.ts',import.meta.url).href)}); console.log(JSON.stringify(loadRegistry().orgStats.get('org').last_activity));`;
    const result=spawnSync(process.execPath,['--no-warnings','--experimental-strip-types','--experimental-loader',new URL('./ts-loader.mjs',import.meta.url).href,'--input-type=module','-e',script],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
  } finally {rmSync(root,{recursive:true,force:true});}
}
test('last activity excludes future awards and deadlines but retains a past opening',()=>{
  assert.equal(activity([{status:'open',opens:'2026-10-01',closes:'2029-01-29'}],['2026-09-01','2027-01-01']),'2026-10-01');
});
test('last activity uses a past close or award and accepts today',()=>{
  assert.equal(activity([{status:'closed',closes:'2026-09-10'}],['2026-10-12']),'2026-10-12');
});
test('future-only dates, invalid dates and an incomplete month cannot establish past activity',()=>{
  assert.equal(activity([{status:'announced',opens:'2027-01-01',closes:'2029-01-29'}],[]),null);
  assert.equal(activity([],['2026-02-30','2026-10','nonsense','2027-01-01']),null);
  assert.equal(activity([],['2026-09']),'2026-09');
});
