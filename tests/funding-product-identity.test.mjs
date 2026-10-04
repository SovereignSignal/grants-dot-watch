import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonical } from '../src/lib/funding-model.mjs';
import { buildFundingProduct } from '../src/lib/funding-product.mjs';
const at=new Date('2026-10-04T20:00:00Z'),source='https://funder.example.org/report';
function baseline(){return {systems:[],orgs:[{id:'funder',name:'Funder',status:'active',profile:'Public',roles:['funder'],sources:[source]}],programs:[{id:'program',org:'funder',name:'Program',status:'active',summary:'Public',rounds:[],sources:[source]}],awards:[]};}
const empty=()=>({'program-terms':[],'funding-events':[],'process-metrics':[]});
test('full legacy public values have hashes of exactly the exposed text',()=>{
 const b=baseline(),value='A public source-backed fact. '.repeat(120);
 b.programs[0].review={facts:{funding:{value,source,checked_on:'2026-10-01'}}};
 const product=buildFundingProduct(b,empty(),at),claim=product.collections.claims[0];
 assert.equal(claim.value,value);
 assert.equal(claim.value_sha256,createHash('sha256').update(canonical(claim.value)).digest('hex'));
});
test('a recipient project funded by two programs keeps both scoped links',()=>{
 const b=baseline();b.programs.push({...b.programs[0],id:'other-program'});
 const d=empty();
 for(const program of ['program','other-program'])d['funding-events'].push({key:`event-${program}`,award_id:`award-${program}`,event_type:'awarded',funder:'funder',recipient:'project',recipient_name:'Project',program,source,checked_on:'2026-10-04',evidence_state:'primary_supported',evidence_note:'Published recipient link; payment not established.',amount:{amount:null,currency:null,unit:'currency',qualifier:'not_disclosed'},capital_form:'cash',occurred_on:null,announced_on:null,payment_date:null,recipient_url:'https://github.com/example/project'});
 const output=buildFundingProduct(b,d,at).collections.outputs;
 assert.equal(output.length,2);
 assert.equal(new Set(output.map(row=>row.id)).size,2);
 assert.deepEqual(new Set(output.map(row=>row.program)),new Set(['program','other-program']));
});
