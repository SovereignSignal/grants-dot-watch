import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { programRelationshipLabel, reviewDueState, reviewFreshness, shiftDay } from '../src/lib/program-review.ts';
import { isCurrentRound } from '../src/lib/round-state.ts';
import { programFacts } from '../src/lib/program-facts.ts';

const p = {id:'example',name:'Example',org:'org',systems:[],wires:['oss'],status:'active',apply_url:'https://example.org/apply',summary:'Example program with sufficiently descriptive public text.',rounds:[{name:'First',status:'open',opens:'2026-09-03',closes:'2026-11-03',source:'https://example.org/call'}],sources:['https://example.org/call'],review:{operating:'active',checked_on:'2026-09-11',review_after:'2026-09-18',intake:'open',intake_note:'Applications open.',source:'https://example.org/call',kind:'program',relationship:'current',questions:[],history:[]}};

test('review queues stay independent of public program facts',()=>{
  assert.equal(reviewDueState(p,'2026-09-18'),'expired');
  assert.equal(programFacts(p,'2026-09-18').status.label,'Active');
  assert.equal(programFacts(p,'2026-09-18').nextDeadline.date,'2026-11-03');
  assert.equal(programFacts(p,'2026-11-04').nextDeadline,null);
});
test('former associations remain identified and excluded from the current-round board',()=>{
  const former={...p,review:{...p.review,relationship:'former'}};
  assert.equal(programRelationshipLabel(former),'Former operator');
  assert.equal(isCurrentRound(former,p.rounds[0],'2026-09-11'),false);
});
test('Desk correction guards prevent stale overwrites and preserve research metadata',async t=>{
  const cwd=process.cwd(), root=mkdtempSync(join(tmpdir(),'gw-research-'));
  process.chdir(root);
  t.after(()=>{process.chdir(cwd);rmSync(root,{recursive:true,force:true});});
  mkdirSync('registry/programs',{recursive:true});
  const raw=YAML.stringify(p);writeFileSync('registry/programs/example.yaml',raw);
  const {buildProposalChanges}=await import('../src/lib/committer.ts');
  const hash=createHash('sha256').update(raw).digest('hex');
  const proposal={id:'research',type:'profile_note',org:'org',title:'Correction',summary:'Primary research correction',evidence_url:p.sources[0],state:'pending',lane:'judgment',created_at:'2026-09-11T00:00:00Z',proposed_change:{_expected_content_hashes:{'programs/example.yaml':hash},'programs/example.yaml':{rounds_replace:[],review:{...p.review,intake:'closed'}}}};
  const result=buildProposalChanges(proposal);
  const after=YAML.parse(result.changes[0].content);
  assert.equal(after.rounds.length,0);
  assert.equal(after.review.intake,'closed');
  assert.equal(readFileSync('registry/programs/example.yaml','utf8'),raw);
  writeFileSync('registry/programs/example.yaml',raw+'# changed\n');
  assert.throws(()=>buildProposalChanges(proposal),/stale/);
  const missing=structuredClone(proposal);delete missing.proposed_change._expected_content_hashes['programs/example.yaml'];
  assert.throws(()=>buildProposalChanges(missing),/Missing expected hash/);
  const traversal=structuredClone(proposal);traversal.proposed_change._expected_content_hashes['../secret']=hash;
  writeFileSync('registry/programs/example.yaml',raw);
  assert.throws(()=>buildProposalChanges(traversal),/Invalid expected hash path/);
  const unguarded=structuredClone(proposal);delete unguarded.proposed_change._expected_content_hashes;
  assert.throws(()=>buildProposalChanges(unguarded),/requires captured content hashes/);
});
test('review freshness names what is aged, what is about to be, and what a recheck cannot fix',()=>{
  // A review becomes due on the recorded day, independently of public display.
  assert.equal(reviewDueState(p,'2026-09-18'),'expired');
  assert.equal(reviewDueState(p,'2026-09-17'),'due');
  assert.equal(reviewDueState(p,'2026-09-11',7),'due');
  assert.equal(reviewDueState(p,'2026-09-10',7),'current');
  assert.equal(reviewDueState({...p,review:undefined}),'none');
  assert.equal(shiftDay('2026-09-26',30),'2026-10-26');
  const aged=reviewFreshness([p],'2026-09-18');
  assert.equal(aged.reviewed,1);assert.equal(aged.expired.length,1);assert.equal(aged.due.length,0);
  assert.equal(aged.expired[0].review_after,'2026-09-18');assert.equal(aged.expired[0].renewable,true);
  assert.equal(reviewFreshness([p],'2026-09-11').due.length,1);
  assert.equal(reviewFreshness([p],'2026-09-10').due.length,0);
  // An expired count alone overstates what a re-fetch repairs: an unresolved
  // identity, a former operator and a non-active program each stay unverified
  // however fresh the date.
  assert.equal(reviewFreshness([{...p,review:{...p.review,kind:'unresolved'}}],'2026-09-18').expired[0].renewable,false);
  assert.equal(reviewFreshness([{...p,review:{...p.review,relationship:'former'}}],'2026-09-18').expired[0].renewable,false);
  assert.equal(reviewFreshness([{...p,status:'paused'}],'2026-09-18').expired[0].renewable,false);
  // Status drift is the other half of needsReview and no renewal cures it, so
  // it is counted apart from the aged dates.
  const drift=reviewFreshness([{...p,status:'paused'}],'2026-09-11');
  assert.equal(drift.drifted.length,1);assert.equal(drift.expired.length,0);
  assert.equal(reviewFreshness([p],'2026-09-11').drifted.length,0);
  // A program with no review block is unverified by a different route and is
  // never counted as aged.
  assert.equal(reviewFreshness([{...p,review:undefined}],'2026-09-18').reviewed,0);
});
