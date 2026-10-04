// Explicit one-shot acquisition of one allowlisted public GitHub funding source.
// No arbitrary URL, credentials, scheduling, Desk call or canonical write path.
import { createHash } from 'node:crypto';
const API='https://api.github.com/repos/microsoft/foss-fund';
const SOURCE='https://github.com/microsoft/foss-fund/blob/main/README.md';
const SHA=/^[a-f0-9]{40}$/;
export const NATIVE_SOURCE_LIMITS=Object.freeze({bytes:2*1024*1024,markdownBytes:512*1024,requestTimeoutMs:10000,maxRequests:2});
const fail=code=>{throw new Error(code);};
const sha256=body=>createHash('sha256').update(body).digest('hex');
const blobHash=body=>createHash('sha1').update(`blob ${Buffer.byteLength(body)}\0`).update(body).digest('hex');
function day(at){
  if(!(at instanceof Date)||!Number.isFinite(at.getTime())) fail('invalid_observation_time');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at).map(x=>[x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
async function boundedJson(url,request,signal){
  const response=await request(url,{method:'GET',redirect:'error',signal,
    headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'grants.watch-source-capture'}});
  if(response.status===403||response.status===429) fail('source_rate_limited_or_forbidden');
  if(response.status!==200) fail('source_http_failure');
  if(response.url&&response.url!==url) fail('unexpected_source_redirect');
  if(!/^(application\/json|application\/vnd\.github\+json)(?:;|$)/i.test(response.headers.get('content-type')||'')) fail('source_content_type');
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>NATIVE_SOURCE_LIMITS.bytes)) fail('source_byte_limit');
  if(!response.body) fail('empty_source_response');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>NATIVE_SOURCE_LIMITS.bytes)fail('source_byte_limit');chunks.push(value);}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail('invalid_source_json');}
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function selectMicrosoftFund(markdown,fund){
  if(typeof markdown!=='string'||Buffer.byteLength(markdown)>NATIVE_SOURCE_LIMITS.markdownBytes||markdown.includes('\0'))fail('invalid_source_markdown');
  if(!Number.isSafeInteger(fund)||fund<1||fund>100000)fail('invalid_fund_number');
  const lines=markdown.split(/\r?\n/),section=lines.findIndex(l=>/^## Funding recipients\b/.test(l));
  if(section<0)fail('recipient_section_missing');
  const matches=[];
  for(let i=section+1;i<lines.length;i++)if(new RegExp(`^- FOSS Fund #?${fund} \\([A-Za-z]+ 20\\d{2}\\)`).test(lines[i]))matches.push(i);
  if(matches.length!==1)fail('fund_missing_or_ambiguous');
  const start=matches[0];let end=start+1;
  while(end<lines.length&&!/^(- FOSS Fund\b|#{1,3}\s)/.test(lines[end]))end++;
  const selected=lines.slice(start,end);
  if(!selected.some(l=>/^\s+-\s/.test(l)))fail('empty_fund_section');
  // Every nonblank recipient line must have an explicit repository. Narrative
  // continuation rounds and maintainer-only records require another adapter.
  const candidates=selected.slice(1).filter(l=>l.trim());
  if(candidates.some(l=>!/^\s+- .*_\[\[.+\]\(https:\/\/github\.com\/[^)]+\)\]/.test(l)))fail('unsupported_fund_recipient');
  return {body:`## Funding recipients\n${selected.join('\n').trimEnd()}\n`,source_start_line:start+1,source_end_line:end,recipient_rows:candidates.length};
}
/**
 * The optional request dependency is solely for deterministic tests. The CLI
 * does not expose it and never reads a token from the environment.
 */
export async function captureMicrosoftFund({fund=36,revision=null}={}, {request=fetch,now=()=>new Date()}={}){
  if(!Number.isSafeInteger(fund)||fund<1||fund>100000||(revision!==null&&!SHA.test(revision)))fail('invalid_capture_request');
  const observed=now(),observed_on=day(observed);let requests=0;
  const get=async url=>{
    if(++requests>NATIVE_SOURCE_LIMITS.maxRequests)fail('source_request_budget');
    try{return await boundedJson(url,request,AbortSignal.timeout(NATIVE_SOURCE_LIMITS.requestTimeoutMs));}
    catch(error){if(['source_rate_limited_or_forbidden','source_http_failure','unexpected_source_redirect','source_content_type','source_byte_limit','empty_source_response','invalid_source_json'].includes(error.message))throw error;fail('source_transport_failure');}
  };
  let ref=revision;
  if(ref===null){const commits=await get(`${API}/commits?path=README.md&per_page=1`);if(!Array.isArray(commits)||commits.length!==1||!SHA.test(commits[0]?.sha))fail('invalid_source_revision');ref=commits[0].sha;}
  const endpoint=`${API}/contents/README.md?ref=${ref}`;
  const file=await get(endpoint);
  if(file?.type!=='file'||file.path!=='README.md'||file.encoding!=='base64'||!SHA.test(file.sha)||typeof file.content!=='string'||!Number.isSafeInteger(file.size)||file.size<1||file.size>NATIVE_SOURCE_LIMITS.markdownBytes)fail('invalid_contents_response');
  const encoded=file.content.replace(/\n/g,'');
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail('invalid_source_encoding');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length!==file.size||blobHash(bytes)!==file.sha)fail('source_blob_hash_mismatch');
  let markdown;try{markdown=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('invalid_source_encoding');}
  const selected=selectMicrosoftFund(markdown,fund);
  const snapshot={version:1,source_id:'microsoft-foss',source_url:SOURCE,observed_on,provider:'github',representation:'native_markdown',
    scope:`Funding recipients: FOSS Fund ${fund} only`,body:selected.body,body_sha256:sha256(selected.body),source_revision:ref};
  return {bundle:{version:1,snapshots:[snapshot]},receipt:{version:1,source_id:'microsoft-foss',source_url:SOURCE,endpoint,source_revision:ref,
    upstream_blob_sha:file.sha,full_representation_sha256:sha256(bytes),selected_representation_sha256:snapshot.body_sha256,
    captured_at:observed.toISOString(),source_start_line:selected.source_start_line,source_end_line:selected.source_end_line,
    recipient_rows:selected.recipient_rows,requests,bytes:file.size,scope:snapshot.scope,
    coverage:'selected_fund_only',original_page_bytes_archived:false,redistribution:'unassessed',canonical_write:false,approval:false}};
}
