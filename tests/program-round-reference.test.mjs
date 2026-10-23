import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,rmSync}from'node:fs';
import {tmpdir}from'node:os';
import {join}from'node:path';
import YAML from'yaml';
import {createProgramRoundPreview,restorePreviewReferences}from'./program-round-preview.mjs';
import {readBaseline}from'../src/lib/funding-store.mjs';
import {readControlledFunding,validateFundingChanges}from'../src/lib/funding-desk-core.mjs';
import {buildFundingProduct,handleFundingProductRequest}from'../src/lib/funding-product.mjs';
import {validateFundingDataset}from'../src/lib/funding-model.mjs';
import {roundId}from'../src/lib/funding-api.mjs';
import {programRoundReferenceErrors}from'../src/lib/program-round-reference.mjs';
import {programProfileFields}from'../src/lib/program-profile.ts';
import {collectPrograms}from'../src/lib/program-directory.ts';
import {activeProgramsByOrg}from'../src/lib/program-facts.ts';
import {currentRounds}from'../src/lib/round-state.ts';
import {publicProgram}from'../src/lib/public-api.ts';

const originalControl=readFileSync('registry/funding-control.json','utf8');
const preview=createProgramRoundPreview();test.after(()=>preview.cleanup());
const root=join(preview.dir,'registry'),baseline=readBaseline(root,YAML.parse),{dataset}=readControlledFunding(root);
// Compare against the same pinned bytes the preview starts from, not today's registry.
const pinned=mkdtempSync(join(tmpdir(),'gw-round-before-'));test.after(()=>rmSync(pinned,{recursive:true,force:true}));
cpSync('registry',join(pinned,'registry'),{recursive:true});
const old=readBaseline(restorePreviewReferences(join(pinned,'registry')),YAML.parse),at=new Date('2026-10-13T20:00:00Z');
const pairs=[['php-foundation-2027-core-development-contractors','php-foundation-core-development-contractors','2027 contractor intake'],['numfocus-sdg-2026-round-2-cfp-open-due-oct-17','numfocus-small-development-grants','2025 Round 2']];
const product=buildFundingProduct(baseline,dataset,at);

test('guarded preview retains old IDs, round facts, sources, awards and evidence',()=>{
  assert.deepEqual(programRoundReferenceErrors(baseline.programs),[]);
  assert.equal(preview.report.production_access,false);
  assert.equal(baseline.programs.length,old.programs.length+1);
  assert.deepEqual(baseline.awards,old.awards);
  for(const [id,parent,name]of pairs){
    const before=old.programs.find(p=>p.id===id),after=baseline.programs.find(p=>p.id===id);
    assert.deepEqual({...after,parent:before.parent,parent_round:undefined},{...before,parent_round:undefined});
    const canonical=baseline.programs.find(p=>p.id===parent).rounds.find(r=>r.name===name);
    assert.deepEqual({...canonical,name:before.rounds[0].name},before.rounds[0]);
    assert.equal(publicProgram(after).parent_round,name);
    assert.equal(publicProgram(after).href,`/programs/${id}`);
    assert.deepEqual(currentRounds(after,'2026-10-13'),[]);
  }
  for(const [path,hash]of Object.entries(old.source_blobs)) {
    if(pairs.some(([id,parent])=>path===`programs/${id}.yaml`||path===`programs/${parent}.yaml`))continue;
    assert.equal(baseline.source_blobs[path],hash,path);
  }
  assert.equal(readFileSync('registry/funding-control.json','utf8'),originalControl);
});

test('old v2 round IDs still resolve and explicitly link to the canonical parent round',async()=>{
  for(const [id,parent,name]of pairs){
    const before=old.programs.find(p=>p.id===id),legacyId=roundId(id,before.rounds[0].name),canonicalId=roundId(parent,name);
    const oldRound=product.collections.rounds.find(r=>r.id===legacyId);
    assert.equal(oldRound.program,id);assert.equal(oldRound.canonical_round_id,canonicalId);
    assert.ok(product.collections.rounds.some(r=>r.id===canonicalId&&r.program===parent));
    assert.ok(product.collections.relationships.some(r=>r.role==='preserved_call'&&r.from===id&&r.to===canonicalId));
    const response=handleFundingProductRequest(new Request(`https://grants.watch/api/v2/rounds/${legacyId}`),['rounds',legacyId],{enabled:true,load:()=>({baseline,dataset}),now:()=>at});
    assert.equal(response.status,200);assert.equal((await response.json()).data.id,legacyId);
  }
});

test('directory and opportunities list the enduring program once while PHP evidence remains scoped to its call',()=>{
  const listed=collectPrograms(baseline.programs,baseline.orgs,'2026-10-13');
  for(const [id,parent]of pairs){assert.ok(!listed.some(p=>p.program.id===id));assert.ok(listed.some(p=>p.program.id===parent));}
  const php=pairs[0],opps=product.collections.opportunities.filter(p=>p.org==='php-foundation');
  assert.equal(activeProgramsByOrg(baseline.programs).get('php-foundation'),1);
  assert.equal(opps.length,1);assert.equal(opps[0].program,php[1]);assert.equal(opps[0].terms_program,php[0]);
  assert.deepEqual(opps[0].instruments,['contract']);
  const evergreen=product.collections.programs.find(p=>p.id===php[1]);
  assert.equal(evergreen.current_terms_key,null,'annual eligibility does not become evergreen terms');
  const program=baseline.programs.find(p=>p.id===php[1]);
  const fields=programProfileFields(program,product.collections['program-terms'],'2026-10-13',true,baseline.programs);
  const instrument=fields.find(f=>f.key==='instruments').entries[0];
  assert.equal(instrument.scope,php[2]);assert.deepEqual(instrument.values,['Contract']);
  assert.equal(instrument.recordedAt,`/programs/${php[0]}`);
});

test('invalid and ambiguous compatibility references fail closed; ordinary subprograms remain ordinary',()=>{
  for(const mutate of [p=>p.parent=null,p=>p.parent_round='Missing',p=>p.org='other',p=>p.rounds.push({...p.rounds[0],name:'Second'})]){
    const programs=structuredClone(baseline.programs);mutate(programs.find(p=>p.id===pairs[0][0]));
    assert.ok(programRoundReferenceErrors(programs).length);
    assert.throws(()=>buildFundingProduct({...baseline,programs},dataset,at));
  }
  const programs=structuredClone(baseline.programs);const child=programs.find(p=>p.id===pairs[1][0]);delete child.parent_round;
  assert.deepEqual(programRoundReferenceErrors(programs),[]);
  assert.ok(collectPrograms(programs,baseline.orgs).some(p=>p.program.id===child.id));
});


test('Desk rejects a parent-only edit that would break a preserved call reference',()=>{
  const parent=structuredClone(baseline.programs.find(p=>p.id===pairs[0][1]));
  parent.rounds=[];
  assert.throws(()=>validateFundingChanges(root,baseline,[{path:`registry/programs/${parent.id}.yaml`,op:'update',content:YAML.stringify(parent)}],'2026-10-13',YAML.parse),/parent_round/);
});

test('a closed access check on the original call still vetoes the mapped parent opportunity',()=>{
  const changed=structuredClone(dataset),terms=changed['program-terms'].find(t=>t.program===pairs[0][0]);
  // Synthetic access fixture: do not reuse the real packet's null-access receipt.
  delete terms.provenance;
  terms.access={round_name:'Current call',state:'closed',stage:'application',new_applicants:false,prerequisites_clear:true,route:terms.source,checked_on:'2026-10-13',review_after:'2026-10-20',source:terms.source};
  assert.deepEqual(validateFundingDataset(changed,baseline,'2026-10-13'),[]);
  const result=buildFundingProduct(baseline,changed,at);
  assert.equal(result.collections.opportunities.filter(p=>p.org==='php-foundation').length,0);
});
