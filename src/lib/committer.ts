// Registry mutation gateway. Legacy proposals and additive round-reference links
// use the same serializers and guarded staging path.
// Funding imports use the same durable outbox, verdict and boot replay path.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import * as legacy from './committer-legacy';
import { invalidateRegistryCache } from './registry';
import { productDateISO } from './round-state';
import { readBaseline } from './funding-store.mjs';
import { addLegacyFundingControl, buildFundingDeskChanges, fundingGuard, isFundingProposal, validateFundingChanges } from './funding-desk-core.mjs';
import type { Proposal } from './types';
import type { AppliedChange, ApplyResult } from './committer-legacy';

export * from './committer-legacy';
const ROOT=process.cwd();
const REGISTRY=join(ROOT,'registry');
const guards=new WeakMap<ApplyResult,()=>void>();
function enabled() { return process.env.GRANTS_WATCH_FUNDING_DESK==='1'; }
function hasFunding() {
  if (existsSync(join(REGISTRY,'funding-control.json'))) return true;
  return ['program-terms','funding-events','process-metrics'].some(sub => {
    const dir=join(REGISTRY,sub);
    return existsSync(dir) && readdirSync(dir).some(name=>name.endsWith('.jsonl'));
  });
}
function participates(p:Proposal) { return enabled() || hasFunding() || isFundingProposal(p); }
function checkFundingGate(p:Proposal) {
  if (isFundingProposal(p) && !enabled()) throw new Error('Funding Desk imports are disabled');
}

export function buildProposalChanges(p:Proposal):ApplyResult {
  checkFundingGate(p);
  if (!participates(p)) return legacy.buildProposalChanges(p);
  const baseline=readBaseline(REGISTRY,YAML.parse);
  let result:ApplyResult=isFundingProposal(p)
    ? buildFundingDeskChanges(REGISTRY,baseline,p,productDateISO()) as ApplyResult
    : legacy.buildProposalChanges(p);
  // All edits share the control once funding exists, even with new imports disabled.
  if ((enabled() || hasFunding()) && !isFundingProposal(p)) result=addLegacyFundingControl(REGISTRY,result) as ApplyResult;
  validateFundingChanges(REGISTRY,baseline,result.changes,productDateISO(),YAML.parse);
  return result;
}
export function prepareProposalChanges(p:Proposal):ApplyResult {
  if (!participates(p)) return legacy.prepareProposalChanges(p);
  const result=buildProposalChanges(p), virtual=new Map<string,string|null>();
  for (const change of result.changes) {
    const path=join(ROOT,change.path);
    const before=virtual.has(change.path) ? virtual.get(change.path)! : existsSync(path) ? readFileSync(path,'utf8') : null;
    if (change.op==='create' && before!==null) throw new Error('Funding target already exists');
    change.content_before=before;
    change.content_after=change.op==='append' ? `${before ?? ''}${change.content}` : change.content;
    virtual.set(change.path,change.content_after);
  }
  guards.set(result,fundingGuard(REGISTRY,readBaseline(REGISTRY,YAML.parse),result));
  return result;
}
export function writePreparedChanges(result:ApplyResult):ApplyResult {
  const guarded=result.changes.some(change=>/^registry\/(funding-control\.json|program-terms\/|funding-events\/|process-metrics\/)/.test(change.path));
  const guard=guards.get(result);
  if (guarded && !guard) throw new Error('Funding changes require a prepared read-dependency guard');
  guard?.();
  return legacy.writePreparedChanges(result);
}
export function writeProposalChanges(p:Proposal):ApplyResult {
  return writePreparedChanges(prepareProposalChanges(p));
}
export function applyProposal(p:Proposal):ApplyResult {
  if (isFundingProposal(p)) throw new Error('Funding imports require the durable Desk approval path');
  if (!participates(p)) return legacy.applyProposal(p);
  const result=writeProposalChanges(p);
  if (result.changes.length) invalidateRegistryCache();
  return result;
}

/** A crashed writer requires owner inspection. Never expire locks by age. */
function acquireLocalWriter() {
  const dir=join(ROOT,'.data'); mkdirSync(dir,{recursive:true});
  const path=join(dir,'funding-writer.lock');
  try { mkdirSync(path); } catch { throw new Error('Another funding-aware Desk writer is active or needs recovery'); }
  return ()=>rmdirSync(path);
}
export async function applyProposalDurably(p:Proposal,message:string=legacy.commitMessageFor(p)):Promise<ApplyResult & {commit:string|null}> {
  if (!participates(p)) return legacy.applyProposalDurably(p,message);
  checkFundingGate(p);
  if (process.env.GRANTS_WATCH_NO_GIT==='1' && !process.env.DATABASE_URL) throw new Error('GRANTS_WATCH_NO_GIT=1 requires DATABASE_URL for durable approvals');
  const release=acquireLocalWriter();
  let writeCompleted=false;
  try {
    const result=prepareProposalChanges(p);
    legacy.assertCleanGitPaths(result.changes);
    const {validateStagedChanges}=await import('./proposal-validator');
    const error=validateStagedChanges(result.changes);
    if (error) throw new Error(`staged registry validation failed: ${error}`);
    if (process.env.GRANTS_WATCH_NO_GIT==='1') await legacy.recordPreparedChangeIntent(result,message,p.id);
    writePreparedChanges(result); writeCompleted=true;
    if (result.changes.length) invalidateRegistryCache();
    const commit=process.env.GRANTS_WATCH_NO_GIT==='1' ? null : await legacy.commitChange(
      result.changes.map((c:AppliedChange)=>c.path),message,p.id,result.changes,{fallbackState:'prepared'});
    return {...result,commit};
  } catch (error) {
    if (error instanceof legacy.RegistryMutationError) throw error;
    if (writeCompleted) throw new legacy.RegistryMutationError('Funding-aware registry write completed but its approval handoff failed',true,error);
    throw error;
  } finally { release(); }
}
