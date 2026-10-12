import test from 'node:test';
import assert from 'node:assert/strict';
import { programProfileFields } from '../src/lib/program-profile.ts';

const today = '2026-10-12', source = 'https://example.org/call';
const program = { id:'fund', name:'Fund', org:'org', status:'active', wires:['oss'], sources:[source], rounds:[] };
const terms = { id:'terms-one', program:'fund', source, checked_on:'2026-10-08', evidence_state:'primary_supported', round_name:'2026 cohort', requirements:['US nonprofit or school; youth participation required'], geography:[], resources:[{kind:'cash',value:{amount:null,currency:null,unit:'currency',qualifier:'not_disclosed',amount_text:'$50,000 to $100,000 per organization; currency unknown.'},restrictions:['Academy participation required']}] };
const fields = (p = program, rows = [terms]) => Object.fromEntries(programProfileFields(p, rows, today).map(field => [field.key,field]));

test('profile surfaces accepted requirements and resource evidence instead of missing fields', () => {
  const f = fields();
  assert.deepEqual(f.eligibility.entries[0].values,terms.requirements);
  assert.equal(f.funding.entries[0].values[0],terms.resources[0].value.amount_text+' (cash)');
  assert.ok(f.funding.entries[0].values.includes('Academy participation required'));
  assert.equal(f.eligibility.entries[0].source,source);
  assert.equal(f.eligibility.entries[0].notedOn,'2026-10-08');
  assert.match(f.geography.missing,/not recorded separately.*eligibility requirements/);
  assert.equal(f.geography.entries.length,0,'requirements do not fabricate a geography field');
});
test('profile uses the same named round sizes when typed funding is absent', () => {
  const f = fields({...program,rounds:[{name:'Rolling 2026 intake',size:'Up to $50,000 per team; $436,000 total pool',source}]},[]);
  assert.equal(f.funding.entries[0].scope,'Rolling 2026 intake');
  assert.equal(f.funding.entries[0].values[0],'Up to $50,000 per team; $436,000 total pool');
  assert.equal(f.funding.entries[0].source,source);
});
test('history and multiple resources stay scoped without inferring totals or present access', () => {
  const historic = {...terms,round_name:'2025 cohort',effective_to:'2025-12-31',resources:[{kind:'cash',value:{amount:'100',currency:'USD',unit:'currency',qualifier:'up_to'},restrictions:['Subject to milestones']},{kind:'cloud_credit',value:{amount:'200',currency:'USD',unit:'currency',qualifier:'exact'},restrictions:[]}]};
  const f = fields(program,[historic]);
  assert.match(f.funding.entries[0].scope,/2025 cohort.*December 31, 2025/);
  assert.ok(f.funding.entries[0].values.includes('Up to USD 100 (cash)'));
  assert.ok(f.funding.entries[0].values.includes('USD 200 (cloud credit)'));
  assert.ok(!JSON.stringify(f).includes('USD 300'));
  assert.ok(!JSON.stringify(f).includes('Applications open'));
});
test('recorded legacy facts retain their source and unknown or disputed terms are labelled', () => {
  const f=fields({...program,review:{facts:{eligibility:{value:'Recorded eligibility',source,checked_on:'2026-10-01'}}}},[{...terms,evidence_state:'disputed'}]);
  assert.equal(f.eligibility.entries[0].values[0],'Recorded eligibility');
  assert.match(f.eligibility.entries[1].note,/Disputed/);
  assert.match(fields(program,[{...terms,evidence_state:'unknown'}]).eligibility.entries[0].note,/not established/);
});
test('superseded and future terms stay explicitly scoped instead of silently replacing facts', () => {
  const replacement={...terms,id:'terms-two',supersedes_key:'terms-one',effective_from:'2026-10-01',round_name:'Second cohort'};
  const f=fields(program,[terms,replacement]);
  assert.match(f.funding.entries[0].note,/Earlier terms/);
  assert.match(f.funding.entries[1].scope,/Second cohort.*October 1, 2026/);
  const future={...replacement,effective_from:'2026-11-01'};
  assert.equal(fields(program,[terms,future]).funding.entries[0].note,undefined);
});
test('other programs and absent evidence never populate this profile', () => {
  const f=fields(program,[{...terms,program:'other'}]);
  for(const field of Object.values(f))assert.equal(field.entries.length,0);
  assert.match(f.funding.missing,/No separate funding field/);
});
