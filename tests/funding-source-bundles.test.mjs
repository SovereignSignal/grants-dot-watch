import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const SCRIPT='scripts/build-funding-source-packets.mjs';
const A='research/v2/sources/batch-001.json',B='research/v2/sources/batch-002.json';
const run=args=>execFileSync(process.execPath,[SCRIPT,...args],{encoding:'utf8',timeout:60000});
const attempt=args=>spawnSync(process.execPath,[SCRIPT,...args],{encoding:'utf8',timeout:60000});

test('source CLI combines retained bundles into four reviewable packets without approval',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funding-multibundle-'));
 try{
  const out=join(dir,'review');
  const report=JSON.parse(run(['--input',A,'--input',B,'--out',out]));
  assert.equal(report.input_bundles,2);assert.equal(report.candidate_records,72);assert.equal(report.held,0);
  assert.equal(report.packets,4);assert.equal(report.canonical_write,false);assert.equal(report.production_write,false);
  assert.equal(readdirSync(join(out,'packets')).length,4);
  assert.equal(JSON.parse(readFileSync(join(out,'coverage_gaps.json'),'utf8')).length,2);
  const reversed=JSON.parse(run(['--input',B,'--input',A]));assert.equal(reversed.output_snapshot,report.output_snapshot);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('source CLI rejects duplicated or malformed later bundles before creating output',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funding-invalid-bundle-'));
 try{
  const bad=join(dir,'bad.json'),out=join(dir,'out');writeFileSync(bad,JSON.stringify({version:1,snapshots:'invalid'}));
  assert.notEqual(attempt(['--input',A,'--input',bad,'--out',out]).status,0);assert.equal(existsSync(out),false);
  const duplicate=attempt(['--input',A,'--input',A,'--out',out]);assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/Duplicate input/);
  assert.equal(existsSync(out),false);assert.deepEqual(readdirSync(dir),['bad.json']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('source CLI enforces aggregate file and snapshot limits before writing',()=>{
 const dir=mkdtempSync(join(tmpdir(),'funding-bundle-limits-'));
 try{
  const out=join(dir,'out'),large=join(dir,'large.json');
  writeFileSync(large,JSON.stringify({version:1,snapshots:Array.from({length:51},()=>({}))}));
  assert.match(attempt(['--input',large,'--out',out]).stderr,/snapshot budget/);
  assert.equal(existsSync(out),false);
  const args=Array.from({length:9},()=>['--input',A]).flat();assert.notEqual(attempt(args).status,0);
  const files=[];
  for(let i=0;i<3;i++){const path=join(dir,`bytes-${i}.json`);writeFileSync(path,JSON.stringify({version:1,snapshots:[{}]})+' '.repeat(3*1024*1024));files.push('--input',path);}
  assert.match(attempt([...files,'--out',out]).stderr,/byte budget/);assert.equal(existsSync(out),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
