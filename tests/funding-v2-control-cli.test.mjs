import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
function fixture(){const root=mkdtempSync(join(tmpdir(),'funding-control-cli-'));for(const sub of ['orgs','programs'])mkdirSync(join(root,sub));return root;}
const run=root=>spawnSync(process.execPath,['scripts/validate-registry-v2.mjs','--root',root],{encoding:'utf8',timeout:10000});
test('v2 CLI validation accepts an empty baseline without claiming enrichment',()=>{
 const root=fixture();try{const result=run(root);assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).counts,{'program-terms':0,'funding-events':0,'process-metrics':0});}finally{rmSync(root,{recursive:true,force:true});}
});
test('v2 CLI rejects a control digest mismatch even when every data row is schema-valid',()=>{
 const root=fixture();try{writeFileSync(join(root,'funding-control.json'),JSON.stringify({version:1,revision:'a'.repeat(64),previous_sha256:null,dataset_sha256:'b'.repeat(64)}));const result=run(root);assert.notEqual(result.status,0);assert.match(result.stderr,/control record/);}finally{rmSync(root,{recursive:true,force:true});}
});
test('v2 CLI rejects an interrupted first Desk write without a control record',()=>{
 const root=fixture();try{mkdirSync(join(root,'program-terms'));writeFileSync(join(root,'program-terms/desk-incomplete.jsonl'),'');const result=run(root);assert.notEqual(result.status,0);assert.match(result.stderr,/require their control/);}finally{rmSync(root,{recursive:true,force:true});}
});
