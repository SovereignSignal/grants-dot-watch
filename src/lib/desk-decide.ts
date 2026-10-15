// The Desk approval path, shared by the owner UI and curator API.
import { applyProposalDurably, commitMessageFor, registryMayHaveChanged } from './committer';
import { claimProposal, getProposal, recordVerdict, releaseProposalClaim } from './desk-store';
import { isFundingProposal } from './funding-desk-core.mjs';
import type { CuratorAutoApply, Proposal, Verdict } from './types';

export interface DecideInput {
  id:string; decision:'approved'|'rejected'; note?:string;
  by?:'owner'|'machine'|'curator'; curator_id?:string; curator_name?:string; sources?:string[];
  auto_apply?:CuratorAutoApply;
}
export interface DecideResult {
  status:number;
  body:{ok?:true;commit?:string|null;proposal?:Proposal;verdict?:Verdict;error?:string;reconciliation_hold?:true};
}
export interface DecideDeps {
  getProposal:typeof getProposal; claimProposal:typeof claimProposal;
  releaseProposalClaim:typeof releaseProposalClaim; recordVerdict:typeof recordVerdict;
  applyProposalDurably:typeof applyProposalDurably; registryMayHaveChanged:typeof registryMayHaveChanged;
}
export const defaultDecideDeps:DecideDeps={getProposal,claimProposal,releaseProposalClaim,recordVerdict,applyProposalDurably,registryMayHaveChanged};
function applyMessage(proposal:Proposal,input:DecideInput):string {
  const base=commitMessageFor(proposal); if(input.by!=='curator')return base;
  const who=`${input.curator_name || 'curator'} (${input.curator_id || 'unknown'})`;
  const lines=[base,'',`Curator: ${who}`];
  if(input.note)lines.push(`Reason: ${input.note.replace(/\s+/g,' ').trim()}`);
  if(input.sources?.length)lines.push(`Sources: ${input.sources.join(' ')}`);
  return lines.join('\n');
}
export async function decideProposal(input:DecideInput,deps:DecideDeps=defaultDecideDeps):Promise<DecideResult> {
  const {id,decision,note}=input;
  if(!id || (decision!=='approved' && decision!=='rejected'))return {status:400,body:{error:'id and decision (approved|rejected) are required'}};
  let proposal=await deps.getProposal(id);
  if(!proposal)return {status:404,body:{error:'not found'}};
  if(proposal.state!=='pending')return {status:409,body:{error:'already decided'}};
  if(isFundingProposal(proposal) && input.by && input.by!=='owner')return {status:403,body:{error:'Funding imports require owner review'}};
  let commit:string|null=null, mergedNote=note, ledgerRequired=false;
  if(decision==='approved') {
    const claimed=await deps.claimProposal(id);
    if(!claimed)return {status:409,body:{error:'already claimed or decided'}};
    proposal=claimed;
    // Recheck the claimed payload; the approval boundary must not rely only on a prior read.
    if(isFundingProposal(proposal) && input.by && input.by!=='owner') {
      await deps.releaseProposalClaim(id);
      return {status:403,body:{error:'Funding imports require owner review'}};
    }
    try {
      const {notes,changes,commit:appliedCommit}=await deps.applyProposalDurably(proposal,applyMessage(proposal,input));
      commit=appliedCommit;ledgerRequired=Boolean(process.env.DATABASE_URL) && changes.length>0 && appliedCommit===null;
      if(notes.length)mergedNote=[note,...notes].filter(Boolean).join(' | ');
    } catch(e) {
      const held=deps.registryMayHaveChanged(e);
      if(!held)await deps.releaseProposalClaim(id);
      return {status:500,body:{error:e instanceof Error?e.message:'apply failed',...(held?{reconciliation_hold:true as const}:{})}};
    }
  }
  try {
    const {proposal:updated,verdict}=await deps.recordVerdict(id,decision,{
      note:mergedNote,commit,from:decision==='approved'?'applying':'pending',ledgerRequired,
      ...(input.by?{by:input.by}:{}),
      ...(input.by==='curator'?{curator_id:input.curator_id,curator_name:input.curator_name,sources:input.sources}:{}),
      ...(input.auto_apply?{auto_apply:input.auto_apply}:{}),
    });
    return {status:200,body:{ok:true,commit,proposal:updated,verdict}};
  } catch(error) {
    if(!isFundingProposal(proposal))throw error;
    // The prepared intent remains non-replayable until an approved verdict.
    // Never release/retry a claim after its filesystem mutation already ran.
    return {status:500,body:{error:'Funding verdict failed; owner reconciliation required',...(decision==='approved'?{reconciliation_hold:true as const}:{})}};
  }
}
