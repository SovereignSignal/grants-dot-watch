import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readdirSync,readFileSync,rmSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {readBaseline} from '../src/lib/funding-store.mjs';
import {readControlledFunding} from '../src/lib/funding-desk-core.mjs';
import {planFundingImport} from '../src/lib/funding-migration.mjs';
import {calendarDate} from '../src/lib/funding-api.mjs';
import {legacyRegistryCopy} from './legacy-registry.mjs';
const legacy=legacyRegistryCopy();test.after(()=>legacy.cleanup());
const root=legacy.root,input=resolve('research/v2/sources/batch-001.json');
const run=args=>execFileSync(process.execPath,['scripts/build-funding-source-packets.mjs','--root',root,'--input',input,...args],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
function fingerprint(dir){const hash=createHash('sha256');const walk=sub=>{for(const name of readdirSync(sub).sort()){const path=join(sub,name),stat=lstatSync(path);if(stat.isDirectory())walk(path);else if(stat.isFile()){hash.update(path.slice(dir.length));hash.update(readFileSync(path));}}};walk(dir);return hash.digest('hex');}

test('source backfill real bundle extracts 63 facts and reports two provider omissions',()=>{
 const before=fingerprint(root),r=JSON.parse(run([]));
 assert.equal(r.snapshots,6);assert.equal(r.observations,63);assert.equal(r.canonical_write,false);assert.equal(r.production_write,false);assert.equal(r.status,'candidate_review_required');assert.equal(fingerprint(root),before);
 console.log('SOURCE_BACKFILL_RECEIPT '+JSON.stringify(r));
});
test('source backfill writes external candidates compatible with the staged importer and preserves registry',()=>{
 const temp=mkdtempSync(join(tmpdir(),'source-backfill-'));
 try {
  const dest=join(temp,'candidates'),before=fingerprint(root);const report=JSON.parse(run(['--out',dest]));
  assert.equal(fingerprint(root),before);
  const gaps=JSON.parse(readFileSync(join(dest,'coverage_gaps.json'),'utf8'));assert.equal(gaps.length,2);assert.ok(gaps.every(g=>g.deletion_inferred===false));
  let existing=readControlledFunding(root).dataset;const baseline=readBaseline(root,YAML.parse);let count=0;
  for(const name of readdirSync(join(dest,'packets'))){const pack=JSON.parse(readFileSync(join(dest,'packets',name),'utf8'));const plan=planFundingImport(baseline,existing,pack,calendarDate());existing=plan.dataset;count+=Object.values(plan.report.added).reduce((a,b)=>a+b,0);}
  assert.equal(count,report.candidate_records);assert.ok(count>0);
  assert.throws(()=>run(['--out',dest]),/Output must be a new external/);
  assert.throws(()=>run(['--out',join(root,'cannot-write-here')]),/Output must be a new external/);
  const held=JSON.parse(readFileSync(join(dest,'held.json'),'utf8'));console.log('SOURCE_BACKFILL_HOLDS '+JSON.stringify(held.reduce((out,row)=>{out[row.reason]=(out[row.reason]||0)+1;return out;},{})));
 } finally{rmSync(temp,{recursive:true,force:true});}
});
test('source backfill has no apply, network or implicit approval option',()=>{
 for(const flag of ['--apply','--fetch','--approve']){const r=spawnSync(process.execPath,['scripts/build-funding-source-packets.mjs','--input',input,flag],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/Unknown option/);}
});
