import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, realpathSync } from 'node:fs';
import YAML from 'yaml';
import './review-clock.mjs';
import { readBaseline } from '../../src/lib/funding-store.mjs';
import { readControlledFunding, previewFundingProposal } from '../../src/lib/funding-desk-core.mjs';

const dir=realpathSync(process.cwd()), repo=resolve(import.meta.dirname,'../..');
if (dirname(dir)!==realpathSync(tmpdir()) || !basename(dir).startsWith('gw-round-preview-')) throw new Error('Only a newly created temporary review fixture is supported');
const {prepareProposalChanges,writePreparedChanges}=await import('../../src/lib/committer.ts');
const {validateStagedChanges}=await import('../../src/lib/proposal-validator.ts');
const root=join(dir,'registry'), reports=[];
const apply=proposal=>{
  const result=prepareProposalChanges(proposal);
  const error=validateStagedChanges(result.changes);
  if(error)throw new Error(error);
  writePreparedChanges(result);
  readControlledFunding(root);
  reports.push({proposal:proposal.id,paths:result.changes.map(c=>c.path),notes:result.notes});
};
for(const name of ['php','google','nvidia']) {
  const pack=JSON.parse(readFileSync(join(repo,`research/v2/representative-cleanup/${name}.json`)));
  const preview=previewFundingProposal(root,readBaseline(root,YAML.parse),pack,'2026-10-13');
  apply({...preview.proposal,id:`preview-terms-${name}`,lane:'judgment',state:'pending',created_at:'2026-10-13T00:00:00Z'});
}
for(const name of ['php','numfocus']) {
  const pack=JSON.parse(readFileSync(join(repo,`research/v2/program-rounds/${name}.json`)));
  for(const proposal of pack.proposals)apply(proposal);
}
console.log(JSON.stringify({canonical_write:false,production_access:false,reports}));
