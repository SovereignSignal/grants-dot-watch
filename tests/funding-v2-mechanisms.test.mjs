import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
import {readBaseline,readFundingLedgers} from '../src/lib/funding-store.mjs';
import {buildFundingCollections} from '../src/lib/funding-api.mjs';
const root=resolve('registry');
for(const [name,instrument,form] of [['yc-investment-pilot.json','investment','cash'],['zealynx-subsidy-pilot.json','subsidy','service']]) {
 test(`real ${instrument} pilot stages, preserves native components and creates no fabricated payments`,()=>{
   const temp=mkdtempSync(join(tmpdir(),'funding-mechanism-'));
   try {
     const pack=resolve('research/v2',name),out=join(temp,'stage');
     const result=JSON.parse(execFileSync(process.execPath,['scripts/stage-funding-import.mjs','--root',root,'--pack',pack,'--write-stage',out],{encoding:'utf8',timeout:60000}));
     assert.equal(result.added['program-terms'],1);assert.equal(result.added['funding-events'],0);assert.equal(result.legacy_files_changed,0);
     const staged=join(out,'registry'),collections=buildFundingCollections(readBaseline(staged,YAML.parse),readFundingLedgers(staged));
     const candidate=JSON.parse(readFileSync(pack)),id=candidate.records['program-terms'][0].program;
     const terms=collections['program-terms'].find(row=>row.program===id);
     assert.ok(terms.instruments.includes(instrument));assert.ok(terms.capital_forms.includes(form));
     assert.equal(collections.opportunities.filter(row=>row.program===id).length,0);
     if(instrument==='investment')assert.deepEqual(terms.resources.map(r=>r.value.amount),['125000','375000']);
     else {assert.equal(terms.resources[0].value.amount,null);assert.equal(terms.resources[0].value.currency,null);}
     const repeated=JSON.parse(execFileSync(process.execPath,['scripts/stage-funding-import.mjs','--root',staged,'--pack',pack],{encoding:'utf8',timeout:60000}));
     assert.equal(repeated.added['program-terms'],0);
   } finally{rmSync(temp,{recursive:true,force:true});}
 });
}
