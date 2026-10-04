// Bounded archive expansion through the already-tested single-fund validator.
// One immutable response cache pins every section to the same source revision.
import { captureMicrosoftFund } from './funding-source-native.mjs';
export async function captureMicrosoftArchive({revision=null}={}, {request=fetch,now=()=>new Date()}={}){
 const cache=new Map();let requests=0;const at=now();
 const cached=async(input,init)=>{
  if(cache.has(input))return cache.get(input).clone();
  if(++requests>2)throw new Error('source_request_budget');
  // Every URL is constructed by captureMicrosoftFund, not supplied by a caller.
  const response=await request(input,init);
  const kept=response.clone();cache.set(input,kept);return response;
 };
 const snapshots=[],held=[];let sourceRevision=revision,upstreamBlob=null;
 for(let fund=1;fund<=36;fund++){
  try{
   const result=await captureMicrosoftFund({fund,revision},{request:cached,now:()=>at});
   snapshots.push(...result.bundle.snapshots);sourceRevision=result.receipt.source_revision;upstreamBlob=result.receipt.upstream_blob_sha;
  }catch(error){
   if(!['fund_missing_or_ambiguous','unsupported_fund_recipient','empty_fund_section'].includes(error.message))throw error;
   held.push({fund,reason:error.message});
  }
 }
 if(!snapshots.length)throw new Error('no_supported_fund_sections');
 return {bundle:{version:1,snapshots},receipt:{source_id:'microsoft-foss',source_revision:sourceRevision,upstream_blob_sha:upstreamBlob,requests,selected_sections:snapshots.length,held_sections:held,scope:'FOSS Fund 1 through 36, supported repository-recipient sections only',captured_at:at.toISOString(),coverage:'unsupported_sections_explicitly_held',canonical_write:false,approval:false,redistribution:'unassessed'}};
}
