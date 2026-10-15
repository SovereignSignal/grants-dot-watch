// The Desk approval path, shared by the owner UI and curator API.
import { createHash } from 'node:crypto';
import { applyProposalDurably, commitMessageFor, registryMayHaveChanged } from './committer';
import { canonical } from './funding-model-core.mjs';
import { claimProposal, getProposal, recordVerdict, releaseProposalClaim } from './desk-store';
import { isFundingProposal } from './funding-desk-core.mjs';
import { awardSourcesAutoApplyEnabled, isReviewRenewalChange, reviewRecheckEnabled, wireProgramAutoApplyEnabled } from './machine-approval-policy';
import type { AwardAutoApply, CuratorAutoApply, Proposal, ReviewRecheckAutoApply, Verdict, WireProgramAutoApply } from './types';

export interface DecideInput {
  id:string; decision:'approved'|'rejected'; note?:string;
  by?:'owner'|'machine'|'curator'; curator_id?:string; curator_name?:string; sources?:string[];
  auto_apply?:CuratorAutoApply;
  /** Only the award-source auto-apply sets this; no HTTP route passes it. */
  award_auto_apply?:AwardAutoApply;
  /** Only the Wire program auto-apply sets this; no HTTP route passes it. */
  wire_program_auto_apply?:WireProgramAutoApply;
  /** Only the daily review recheck sets this; no HTTP route passes it. */
  review_recheck_auto_apply?:ReviewRecheckAutoApply;
  /** proposalChangeHash of the proposed_change the caller verified. When set,
   *  an approval applies only if the claimed proposal still hashes the same. */
  expect_change_hash?:string;
}
/** SHA-256 of key-sorted JSON of a proposal's proposed_change. */
export function proposalChangeHash(change:unknown):string {
  return createHash('sha256').update(canonical(change ?? null)).digest('hex');
}
/** Automatic approvals verify a payload before calling here, sometimes
 *  seconds earlier (a page fetch). They must name the payload they checked. */
function changeHashRequired(input:DecideInput):boolean {
  return Boolean(input.wire_program_auto_apply || input.award_auto_apply || input.review_recheck_auto_apply
    || (input.auto_apply && (input.by==='machine' || input.by==='curator')));
}
/** The Wire program audit belongs to one machine approval of a pending Wire
 *  new_program, and only while WIRE_PROGRAM_AUTO_APPLY=1. */
function wireProgramAuditAllowed(proposal:Proposal,input:DecideInput):boolean {
  if(!input.wire_program_auto_apply)return true;
  return input.by==='machine' && input.decision==='approved' && wireProgramAutoApplyEnabled()
    && proposal.type==='new_program' && typeof proposal.signal_id==='string' && proposal.signal_id.startsWith('wire:');
}
/** The review recheck audit belongs to one machine approval of a pending
 *  recheck renewal that sets only a program's review block, and only while
 *  DESK_UPKEEP_ENABLED=1 and REVIEW_RECHECK_ENABLED=1. */
function reviewRecheckAuditAllowed(proposal:Proposal,input:DecideInput):boolean {
  if(!input.review_recheck_auto_apply)return true;
  return input.by==='machine' && input.decision==='approved' && reviewRecheckEnabled()
    && proposal.type==='profile_note' && typeof proposal.signal_id==='string' && proposal.signal_id.startsWith('recheck:')
    && isReviewRenewalChange(proposal.proposed_change)
    && Object.keys(proposal.proposed_change || {}).includes(`programs/${input.review_recheck_auto_apply.program_id}.yaml`);
}
/** Funding imports are owner decisions, except one machine approval: the
 *  award-source auto-apply, while its flag is on, for the exact plan digest it
 *  re-previewed. Rejections and every other non-owner actor are refused. */
function fundingActorAllowed(proposal:Proposal,input:DecideInput):boolean {
  if(!input.by || input.by==='owner')return true;
  const audit=input.award_auto_apply;
  return input.by==='machine' && input.decision==='approved' && Boolean(audit) && awardSourcesAutoApplyEnabled()
    && proposal.signal_id===`funding-v2:${audit?.plan_digest}`;
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
  const base=commitMessageFor(proposal);
  if(input.award_auto_apply){
    const a=input.award_auto_apply;
    return [base,'',`Machine: award-source auto-apply (${a.policy})`,`Source: ${a.source} ${a.source_url}`,`Plan: ${a.plan_digest}`].join('\n');
  }
  if(input.review_recheck_auto_apply){
    const r=input.review_recheck_auto_apply;
    return [base,'',`Machine: review renewal (${r.policy})`,`Page: ${r.final_url} sha256 ${r.page_hash}`,
      `Matched: "${r.matched_name}" + ${r.matched_intake}`,`Review: ${r.previous_review_after} -> ${r.review_after}, checked ${r.checked_on}`].join('\n');
  }
  if(input.wire_program_auto_apply){
    const w=input.wire_program_auto_apply;
    return [base,'',`Machine: Wire program auto-apply (${w.policy})`,`Page: ${w.final_url} sha256 ${w.page_hash}`,
      `Matched: "${w.matched_name}" + ${w.matched_signal}, score ${w.score}`].join('\n');
  }
  if(input.by!=='curator')return base;
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
  if(isFundingProposal(proposal) && !fundingActorAllowed(proposal,input))return {status:403,body:{error:'Funding imports require owner review'}};
  if(input.award_auto_apply && (!isFundingProposal(proposal) || input.by!=='machine'))return {status:403,body:{error:'Award auto-apply covers funding imports only'}};
  if(!wireProgramAuditAllowed(proposal,input))return {status:403,body:{error:'Wire program auto-apply covers pending Wire new programs only'}};
  if(!reviewRecheckAuditAllowed(proposal,input))return {status:403,body:{error:'Review renewal covers pending recheck renewals only'}};
  if(changeHashRequired(input) && !input.expect_change_hash)return {status:400,body:{error:'change_hash_required'}};
  let commit:string|null=null, mergedNote=note, ledgerRequired=false;
  if(decision==='approved') {
    const claimed=await deps.claimProposal(id);
    if(!claimed)return {status:409,body:{error:'already claimed or decided'}};
    proposal=claimed;
    // The caller verified one payload; never apply a different one.
    if(input.expect_change_hash && proposalChangeHash(proposal.proposed_change)!==input.expect_change_hash) {
      await deps.releaseProposalClaim(id);
      return {status:409,body:{error:'changed_since_check'}};
    }
    // Recheck the claimed payload; the approval boundary must not rely only on a prior read.
    if((isFundingProposal(proposal) && !fundingActorAllowed(proposal,input)) || (input.award_auto_apply && !isFundingProposal(proposal))) {
      await deps.releaseProposalClaim(id);
      return {status:403,body:{error:'Funding imports require owner review'}};
    }
    if(!wireProgramAuditAllowed(proposal,input)) {
      await deps.releaseProposalClaim(id);
      return {status:403,body:{error:'Wire program auto-apply covers pending Wire new programs only'}};
    }
    if(!reviewRecheckAuditAllowed(proposal,input)) {
      await deps.releaseProposalClaim(id);
      return {status:403,body:{error:'Review renewal covers pending recheck renewals only'}};
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
      ...(input.award_auto_apply?{award_auto_apply:input.award_auto_apply}:{}),
      ...(input.wire_program_auto_apply?{wire_program_auto_apply:input.wire_program_auto_apply}:{}),
      ...(input.review_recheck_auto_apply?{review_recheck_auto_apply:input.review_recheck_auto_apply}:{}),
    });
    return {status:200,body:{ok:true,commit,proposal:updated,verdict}};
  } catch(error) {
    if(!isFundingProposal(proposal))throw error;
    // The prepared intent remains non-replayable until an approved verdict.
    // Never release/retry a claim after its filesystem mutation already ran.
    return {status:500,body:{error:'Funding verdict failed; owner reconciliation required',...(decision==='approved'?{reconciliation_hold:true as const}:{})}};
  }
}
