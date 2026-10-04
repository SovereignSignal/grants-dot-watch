import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFundingCollections } from '../src/lib/funding-api.mjs';
const SOURCE='https://funder.example.org/grants';
const AT=new Date('2026-10-04T15:00:00Z');
function baseline() {
  return {systems:[],orgs:[{id:'funder',name:'Funder',status:'active',profile:'Public profile',sources:[SOURCE]}],programs:[{id:'program',org:'funder',name:'Program',status:'active',summary:'Public program',sources:[SOURCE],rounds:[{name:'Current',status:'open',opens:'2026-09-01',closes:'2026-11-01',source:SOURCE}]}],awards:[]};
}
function terms() {
  return {key:'terms-1',program:'program',source:SOURCE,checked_on:'2026-10-04',evidence_state:'primary_supported',evidence_note:'Published terms support these facts.',instruments:['grant'],allocation_methods:['committee'],capital_forms:['cash'],selection_models:['application'],intake_mode:'rounds',resources:[],access:{round_name:'Current',stage:'Initial application',state:'open',new_applicants:true,prerequisites_clear:true,route:SOURCE,checked_on:'2026-10-04',review_after:'2026-10-10',source:SOURCE}};
}
const dataset=()=>({'program-terms':[terms()],'funding-events':[],'process-metrics':[]});

test('v2 expired superseding terms cannot resurrect an old opportunity',()=>{
  const d=dataset();
  d['program-terms'].push({...terms(),key:'expired-replacement',supersedes_key:'terms-1',effective_from:'2026-10-01',effective_to:'2026-10-03'});
  const c=buildFundingCollections(baseline(),d,AT);
  assert.equal(c.programs[0].current_terms_key,null);
  assert.equal(c.opportunities.length,0);
});
test('v2 future replacements do not prematurely retire current terms',()=>{
  const d=dataset();
  d['program-terms'].push({...terms(),key:'future-replacement',supersedes_key:'terms-1',effective_from:'2026-10-05'});
  const c=buildFundingCollections(baseline(),d,AT);
  assert.equal(c.programs[0].current_terms_key,'terms-1');
  assert.equal(c.opportunities.length,1);
});
test('v2 unknown eligibility and geography remain null rather than unrestricted',()=>{
  const c=buildFundingCollections(baseline(),dataset(),AT);
  assert.equal(c.opportunities[0].eligibility,null);
  assert.equal(c.opportunities[0].geography,null);
  assert.equal(c.opportunities[0].eligibility_is_personalized,false);
});
