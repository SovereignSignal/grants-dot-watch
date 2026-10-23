import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { readBaseline } from '../src/lib/funding-store.mjs';
import { readControlledFunding, previewFundingProposal, buildFundingDeskChanges } from '../src/lib/funding-desk-core.mjs';
import { buildFundingProduct, handleFundingProductRequest } from '../src/lib/funding-product.mjs';
import { validateFundingDataset } from '../src/lib/funding-model.mjs';
import { programProfileFields } from '../src/lib/program-profile.ts';
import { legacyClassificationLabel } from '../src/lib/program-classification.ts';
import { restoreReferenceBlobs } from './legacy-registry.mjs';

const today='2026-10-13', at=new Date(`${today}T20:00:00Z`);
const root=join(mkdtempSync(join(tmpdir(),'registry-cleanup-')),'registry');
cpSync('registry',root,{recursive:true});
test.after(()=>rmSync(join(root,'..'),{recursive:true,force:true}));
const packs=['php','google','nvidia'].map(name=>JSON.parse(readFileSync(`research/v2/representative-cleanup/${name}.json`)));
// The packets were reviewed against these program and org bytes; later registry edits
// (2bec2d3 closed the PHP call) would trip their blob guards, so pin them in the copy.
for(const pack of packs)restoreReferenceBlobs(root,pack);
const baseline=readBaseline(root,YAML.parse);
baseline.systems=readdirSync(join(root,'systems')).filter(f=>f.endsWith('.yaml')).map(f=>YAML.parse(readFileSync(join(root,'systems',f),'utf8')));
const before=readControlledFunding(root);

test('representative packets apply through the existing controlled Desk plan only in a disposable copy',()=>{
  for(const pack of packs){
    const preview=previewFundingProposal(root,baseline,pack,today);
    assert.equal(preview.canonical_write,false);
    assert.equal(preview.added['program-terms'],1);
    assert.equal(preview.added['funding-events'],0);
    const {changes}=buildFundingDeskChanges(root,baseline,{...preview.proposal,lane:'judgment'},today);
    for(const change of changes){
      assert.match(change.path,/^registry\/(program-terms\/desk-.*\.jsonl|funding-control\.json)$/);
      writeFileSync(join(root,change.path.replace(/^registry\//,'')),change.content_after??change.content);
    }
    const {dataset}=readControlledFunding(root);
    assert.deepEqual(validateFundingDataset(dataset,baseline,today),[]);
  }
  assert.deepEqual(readBaseline(root,YAML.parse).source_blobs,baseline.source_blobs,'all YAML and legacy awards retain exact bytes');
  const after=readControlledFunding(root);
  assert.equal(after.dataset['program-terms'].length,before.dataset['program-terms'].length+3);
  assert.deepEqual(after.dataset['funding-events'],before.dataset['funding-events']);
  for(const row of before.dataset['program-terms'])assert.deepEqual(after.dataset['program-terms'].find(r=>r.key===row.key),row,'old evidence retained');
});

test('representative public profiles and exports retain distinct types, sources and unknowns',async()=>{
  const dataset=readControlledFunding(root).dataset;
  const product=buildFundingProduct(baseline,dataset,at);
  for(const pack of packs){
    const row=pack.records['program-terms'][0];
    const program=product.collections.programs.find(p=>p.id===row.program);
    assert.deepEqual(program.instruments,row.instruments);
    assert.deepEqual(program.capital_forms,row.capital_forms);
    assert.deepEqual(program.allocation_methods,row.allocation_methods);
    assert.equal(program.intake_mode,row.intake_mode);
    assert.equal(program.current_terms_key,row.key);
    const original=baseline.programs.find(p=>p.id===row.program);
    assert.equal(program.legacy_mechanism,original.mechanism||null);
    const fields=programProfileFields(original,product.collections['program-terms'],today,true);
    assert.ok(fields.find(f=>f.key==='instruments').entries.some(e=>e.source===row.source));
    assert.ok(product.collections.claims.some(c=>c.field==='/instruments'&&c.sources.some(s=>s.url===row.source)));
  }
  const php=product.collections['program-terms'].find(r=>r.key===packs[0].records['program-terms'][0].key);
  assert.equal(php.resources[0].value.amount,null);assert.equal(php.resources[0].value.currency,null);
  assert.equal(php.access,null);
  const request=new Request('https://grants.watch/api/v2/export/programs?format=json');
  const response=handleFundingProductRequest(request,['export','programs'],{enabled:true,load:()=>({baseline,dataset}),now:()=>at});
  assert.equal(response.status,200);
  assert.match(await response.text(),/"allocation_methods"/);
});

test('profile projections allow public fields only, reject unsafe URLs and preserve unknowns',()=>{
  const b=structuredClone(baseline),org=b.orgs[0];
  org.socials={x:'https://example.org/public',github:'https://example.org/?token=secret',forum:'javascript:alert(1)',internal:'https://example.org/private'};
  org.funding={focus:['Open source'],typical_size:'Undisclosed',cadence:'Annual',apply_url:'https://example.org/apply',private_notes:'PRIVATE'};
  b.systems[0].funding_channels=[b.programs[0].id];
  const p=buildFundingProduct(b,before.dataset,at);
  const out=p.collections.orgs.find(o=>o.id===org.id);
  assert.deepEqual(out.socials,{x:'https://example.org/public'});
  assert.deepEqual(out.funding,{focus:['Open source'],typical_size:'Undisclosed',cadence:'Annual',apply_url:'https://example.org/apply'});
  assert.ok(!JSON.stringify(out).includes('PRIVATE'));
  assert.deepEqual(p.collections.systems.find(s=>s.id===b.systems[0].id).funding_channels,[b.programs[0].id]);
  const absent=p.collections.programs.find(p=>p.id===packs[0].records['program-terms'][0].program);
  assert.equal(absent.instruments,null);assert.equal(absent.allocation_methods,null);assert.equal(absent.intake_mode,null);
});

test('legacy categories identify their dimension without fabricating typed terms',()=>{
  assert.equal(legacyClassificationLabel('quadratic'),'Allocation method: Quadratic');
  assert.equal(legacyClassificationLabel('incubator'),'Program format: Incubator');
  assert.equal(legacyClassificationLabel('rfp'),'Solicitation: RFP');
  assert.equal(legacyClassificationLabel('other'),'Legacy classification: Other');
  assert.equal(legacyClassificationLabel(undefined),'Legacy classification not recorded');
  assert.ok(programProfileFields({...baseline.programs[0],mechanism:'grants'},[],today,true).every(f=>!f.entries.length));
});
