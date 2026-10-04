import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readControlledFunding} from '../src/lib/funding-desk-core.mjs';
test('an interrupted first Desk import cannot pass as an ordinary uncontrolled dataset',()=>{
 const root=mkdtempSync(join(tmpdir(),'funding-first-import-'));
 try{mkdirSync(join(root,'program-terms'));writeFileSync(join(root,'program-terms/desk-partial.jsonl'),'{}\n');assert.throws(()=>readControlledFunding(root),/require their control/);}
 finally{rmSync(root,{recursive:true,force:true});}
});
