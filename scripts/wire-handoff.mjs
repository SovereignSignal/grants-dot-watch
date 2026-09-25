// Preview or save a bounded, previously captured Wire Room snapshot. This
// command never queries sources, approves proposals, or installs a cursor.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { contentHash } from '../src/lib/research-intake.ts';
import { handoffWireRows } from '../src/lib/wire-handoff.ts';
import { withIngestLock } from '../src/lib/desk-store.ts';
const {values}=parseArgs({options:{input:{type:'string'},save:{type:'boolean',default:false},'expected-plan':{type:'string'}}});
if (!values.input) throw Error('--input is required');
const bytes=readFileSync(values.input);
if (bytes.length>5_000_000) throw Error('Snapshot exceeds 5 MB');
const rows=JSON.parse(bytes.toString('utf8'));
if(!Array.isArray(rows)) throw Error('Snapshot must be an array');
const result=await withIngestLock(async()=>{
  const preview=await handoffWireRows(rows,{});
  const plan_hash=contentHash(preview);
  if(values.save && values['expected-plan']!==plan_hash) throw Error('Plan changed or --expected-plan missing; preview again before saving');
  return {plan_hash,...(values.save ? await handoffWireRows(rows,{save:true}) : preview)};
});
if(!result.ran) throw Error('Another intake is running');
console.log(JSON.stringify(result.result,null,2));
