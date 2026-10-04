import { MAX_PACK_BYTES, previewFundingProposal } from './funding-desk-core.mjs';
import { calendarDate } from './funding-api.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function readBody(request) {
  const length=Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length>MAX_PACK_BYTES+8192) throw new Error('size');
  if (!request.body) throw new Error('body');
  const reader=request.body.getReader(); let size=0; const chunks=[];
  try {
    for (;;) {const {done,value}=await reader.read();if(done) break;size+=value.byteLength;if(size>MAX_PACK_BYTES+8192)throw new Error('size');chunks.push(value);}
    const content=Buffer.concat(chunks); return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content));
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
/**
 * Authentication is performed before parsing, filesystem access or queue reads.
 * @param {Request} request
 * @param {{authorize: (request:Request)=>Promise<boolean>, enabled: boolean, load:()=>{root:string, baseline:unknown}, enqueue:(rows:unknown[])=>Promise<unknown>, now?:()=>Date}} deps
 */
export async function handleFundingIntake(request,deps) {
  if (request.method!=='POST') return json({error:'method_not_allowed'},405);
  if (!await deps.authorize(request)) return json({error:'unauthorized'},401);
  if (!deps.enabled) return json({error:'funding_desk_disabled'},503);
  let body;
  try {body=await readBody(request);}catch{return json({error:'invalid_or_oversized_body'},400);}
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['mode','pack','plan_digest'].includes(k)) || !['preview','queue'].includes(body.mode)) return json({error:'invalid_request'},400);
  let preview;
  try {
    const {root,baseline}=deps.load();
    preview=previewFundingProposal(root,baseline,body.pack,calendarDate((deps.now || (()=>new Date()))()));
  } catch {return json({error:'invalid_pack_or_stale_snapshot',message:'Recheck source references and preview the pack again'},409);}
  // Include the reviewed snapshot in queue deduplication. A stale pending
  // revision cannot prevent a corrected version from reaching the owner.
  preview.proposal.signal_id=`funding-v2:${preview.plan_digest}`;
  if (body.mode==='preview') return json(preview);
  if (body.plan_digest!==preview.plan_digest) return json({error:'preview_changed',message:'Preview and review the current pack before queueing'},409);
  try {return json({ok:true,result:await deps.enqueue([preview.proposal]),canonical_write:false},202);}
  catch {return json({error:'queue_unavailable'},503);}
}
