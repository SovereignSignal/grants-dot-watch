// Authenticated, bounded preparation surface. This module cannot approve imports.
import { compileFundingSourcePackets } from './funding-source-packets.mjs';
import { SOURCE_CATALOG, validateSourceSnapshot } from './funding-source-adapters.mjs';
import { calendarDate } from './funding-api.mjs';
import { buildFundingProduct } from './funding-product.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const MAX_BODY=2*1024*1024;
async function bodyOf(request){
 const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BODY))throw new Error('invalid_body');
 if(!request.body)throw new Error('invalid_body');const reader=request.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY)throw new Error('invalid_body');chunks.push(value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
/**
 * @param {Request} request
 * @param {{authorize:(request:Request)=>Promise<boolean>,enabled:boolean,publicEnabled:boolean,load:()=>({baseline:unknown,dataset:unknown}|Promise<{baseline:unknown,dataset:unknown}>),retained:()=>unknown[],capture:(source:string,fund:number,revision:string|null)=>Promise<{bundle:{snapshots:unknown[]},receipt:unknown}>,pending:()=>Promise<unknown[]>,now?:()=>Date}} deps
 */
export async function handleFundingWorkspace(request,deps){
 if(!await deps.authorize(request))return json({error:'unauthorized'},401);
 if(!['GET','POST'].includes(request.method))return json({error:'method_not_allowed'},405);
 if([...new URL(request.url).searchParams.keys()].length)return json({error:'invalid_parameter'},400);
 const now=(deps.now||(()=>new Date()))(),today=calendarDate(now);
 if(request.method==='GET'){
  try{
   const {baseline,dataset}=await deps.load(),product=buildFundingProduct(baseline,dataset,now),pending=await deps.pending();
   return json({features:{public_read:deps.publicEnabled,owner_write:deps.enabled},counts:Object.fromEntries(Object.entries(product.collections).map(([k,v])=>[k,v.length])),snapshot:product.snapshot,coverage:product.collections.coverage,sources:Object.entries(SOURCE_CATALOG).map(([id,s])=>({id,url:s.url,program:s.program,issuer:s.issuer,native_refresh:['microsoft-foss','numfocus-sdg','royal-society-research','royal-society-urf'].includes(id)})),pending,scope:'Current registry and accepted funding data. Coverage gaps are not assertions that funding does not exist.'});
  }catch{return json({error:'workspace_unavailable'},503);}
 }
 if(!deps.enabled)return json({error:'funding_desk_disabled'},503);
 let body;try{body=await bodyOf(request);}catch{return json({error:'invalid_or_oversized_body'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||!['compile-retained','compile-upload','refresh'].includes(body.action))return json({error:'invalid_action'},400);
 const allowed=body.action==='compile-retained'?['action']:body.action==='compile-upload'?['action','bundle']:['action','source','fund','revision','archive'];
 if(Object.keys(body).some(k=>!allowed.includes(k)))return json({error:'invalid_parameter'},400);
 let snapshots,receipt=null;
 try{
  if(body.action==='compile-retained')snapshots=deps.retained();
  else if(body.action==='compile-upload'){
   if(!body.bundle||body.bundle.version!==1||Object.keys(body.bundle).some(k=>!['version','snapshots'].includes(k))||!Array.isArray(body.bundle.snapshots)||body.bundle.snapshots.length<1||body.bundle.snapshots.length>8)return json({error:'invalid_bundle'},400);
   snapshots=body.bundle.snapshots;
  }else{
   if(!Object.hasOwn(SOURCE_CATALOG,body.source)||!Number.isSafeInteger(body.fund??36)||(body.fund??36)<1||(body.fund??36)>100000||(body.revision!=null&&!/^[a-f0-9]{40}$/.test(body.revision))||(body.archive!==undefined&&typeof body.archive!=='boolean')||(body.archive&&body.source!=='microsoft-foss'))return json({error:'invalid_capture_request'},400);
   const capture=await deps.capture(body.source,body.archive?0:body.fund??36,body.revision??null);snapshots=capture.bundle.snapshots;receipt=capture.receipt;
  }
  if(!Array.isArray(snapshots)||snapshots.length<1||snapshots.length>50)throw new Error('invalid_snapshot_count');
  for(const s of snapshots)validateSourceSnapshot(s,today);
 }catch(error){return json({error:body.action==='refresh'?'source_capture_failed':'invalid_source_bundle',message:'No data was approved or published. Inspect the source or uploaded representation.',retryable:error.message==='source_capture_busy'},body.action==='refresh'?502:400);}
 try{
  const {baseline,dataset}=await deps.load(),compiled=compileFundingSourcePackets(snapshots,baseline,dataset,today);
  return json({...compiled,capture_receipt:receipt,canonical_write:false,approval:false,source_requests:receipt?.requests??0});
 }catch{return json({error:'compilation_failed',canonical_write:false},409);}
}
