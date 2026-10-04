// Bounded archive expansion through the already-tested single-fund validator.
// Cache fully consumed response bytes, never an unconsumed cloned stream.
import { captureMicrosoftFund } from './funding-source-native.mjs';
const MAX_RESPONSE_BYTES=2*1024*1024;
async function captureResponse(response,input){
 if(response.url&&response.url!==input)throw new Error('source_redirect_refused');
 if(response.status!==200)throw new Error('source_http_failure');
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_RESPONSE_BYTES))throw new Error('source_byte_limit');
 if(!response.body)throw new Error('empty_source');
 const chunks=[],reader=response.body.getReader();let size=0;
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES)throw new Error('source_byte_limit');chunks.push(value);}
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return {bytes:Buffer.concat(chunks),status:response.status,headers:[...response.headers.entries()]};
}
export async function captureMicrosoftArchive({revision=null}={}, {request=fetch,now=()=>new Date()}={}){
 const cache=new Map();let requests=0;const at=now();
 const cached=async(input,init)=>{
  if(!cache.has(input)){
   if(++requests>2)throw new Error('source_request_budget');
   // Every URL is constructed by captureMicrosoftFund, not supplied by a caller.
   cache.set(input,await captureResponse(await request(input,init),input));
  }
  const saved=cache.get(input);
  return new Response(saved.bytes,{status:saved.status,headers:saved.headers});
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
