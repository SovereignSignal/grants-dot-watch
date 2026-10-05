import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { handleFundingProductRequest, buildFundingProduct } from './funding-product.mjs';
import { readControlledFunding } from './funding-desk-core.mjs';
import { readBaseline } from './funding-store.mjs';
import { assertFundingRecoveryReady } from './funding-recovery-policy.mjs';
import { lastBootReplayReport } from './boot-replay';
import { loadRegistry, invalidateRegistryCache } from './registry';
import { createFundingReadCoordinator } from './funding-read-coordinator.mjs';
import { fundingRecoveryReady, readCommittedFundingHead, refreshFundingReplica } from './funding-replica-sync';

let publicControl:string|null|undefined;
function localSnapshot<T>(readBase:(root:string,controlHash:string|null)=>T) {
  const root=join(process.cwd(),'registry'),lock=join(process.cwd(),'.data','funding-writer.lock');
  if(existsSync(lock))throw new Error('Funding writer is active');
  const {dataset,control}=readControlledFunding(root);
  const baseline=readBase(root,control.hash);
  const path=join(root,'funding-control.json');
  const after=existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):null;
  if(after!==control.hash || existsSync(lock))throw new Error('Funding changed during local read');
  return {root,baseline,dataset,control};
}
function readLocalPublic() {
  return localSnapshot((_root,hash)=>{
    if(publicControl!==hash){invalidateRegistryCache();publicControl=hash;}
    return loadRegistry();
  });
}
function readLocalEditable() {
  return localSnapshot(root=>readBaseline(root,YAML.parse));
}
const publicReader=createFundingReadCoordinator({readHead:readCommittedFundingHead,readLocal:readLocalPublic,refresh:refreshFundingReplica,recoveryReady:fundingRecoveryReady});
const editableReader=createFundingReadCoordinator({readHead:readCommittedFundingHead,readLocal:readLocalEditable,refresh:refreshFundingReplica,recoveryReady:fundingRecoveryReady});

function assertFundingBackend() {
  if(process.env.NODE_ENV==='production' && !process.env.DATABASE_URL && process.env.GRANTS_WATCH_ALLOW_LOCAL_STORE!=='1')throw new Error('Durable funding backend is required');
}

export async function loadFundingReadSnapshot() {
  assertFundingBackend();
  if(process.env.DATABASE_URL)return publicReader.read();
  assertFundingRecoveryReady(lastBootReplayReport(),false);return readLocalPublic();
}
export async function loadFundingEditableSnapshot() {
  assertFundingBackend();
  if(process.env.DATABASE_URL)return editableReader.read();
  assertFundingRecoveryReady(lastBootReplayReport(),false);return readLocalEditable();
}
export async function loadPublicFundingProduct() {
  if(process.env.GRANTS_WATCH_API_V2!=='1')return null;
  const {baseline,dataset}=await loadFundingReadSnapshot();return buildFundingProduct(baseline,dataset);
}
export async function serveFundingV2(request:Request,path:string[]) {
  const enabled=process.env.GRANTS_WATCH_API_V2==='1';
  // Reuse the exact routing/query validators without touching the database for
  // rejected requests, disabled reads, preflight or static OpenAPI responses.
  let needsSnapshot=false;
  const preflight=handleFundingProductRequest(request,path,{enabled,load:()=>{needsSnapshot=true;throw new Error('deferred_snapshot');}});
  if(!needsSnapshot)return preflight;
  try{
    const snapshot=await loadFundingReadSnapshot();
    const result=handleFundingProductRequest(request,path,{enabled,load:()=>snapshot});
    if(snapshot.control.hash)result.headers.set('X-Funding-Control',snapshot.control.hash);
    const exposed=result.headers.get('Access-Control-Expose-Headers');
    result.headers.set('Access-Control-Expose-Headers',[exposed,'X-Funding-Control'].filter(Boolean).join(', '));
    return result;
  }catch{
    return new Response(request.method==='HEAD'?null:JSON.stringify({error:'dataset_unavailable',message:'Approved funding data is temporarily unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'}});
  }
}
