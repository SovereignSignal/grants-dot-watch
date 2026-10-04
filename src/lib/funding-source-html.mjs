// Direct capture for three reviewed first-party table sources. No arbitrary URL.
// Parsed text is a normalized representation, not an archive of original HTML.
import { createHash } from 'node:crypto';
import { SOURCE_CATALOG, validateSourceSnapshot } from './funding-source-adapters.mjs';
import { calendarDate } from './funding-api.mjs';
export const HTML_SOURCES=['numfocus-sdg','royal-society-research','royal-society-urf'];
const MAX_BYTES=2*1024*1024;
const digest=s=>createHash('sha256').update(s).digest('hex');
const check=(condition,code)=>{if(!condition)throw new Error(code);};
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',pound:'£',euro:'€',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',hellip:'…',times:'×',le:'≤',ge:'≥'};
function cellText(value){
 check(!/<(?:script|style|table)\b/i.test(value),'unsafe_or_nested_table');
 const plain=value.replace(/<br\b[^>]*>/gi,' ').replace(/<[^>]+>/g,'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(match,name)=>{
  if(name.startsWith('#')){const code=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);check(Number.isInteger(code)&&code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff),'invalid_html_entity');return String.fromCodePoint(code);}
  check(Object.hasOwn(entities,name.toLowerCase()),'unsupported_html_entity');return entities[name.toLowerCase()];
 }).replace(/\s+/g,' ').trim();
 check(plain.length>0&&plain.length<2000&&!/[|<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(plain),'unsupported_table_cell');return plain;
}
export function selectFundingTable(html,source){
 check(HTML_SOURCES.includes(source),'unsupported_html_source');
 check(typeof html==='string'&&Buffer.byteLength(html)<=MAX_BYTES&&!html.includes('\0'),'invalid_html');
 const uncommented=html.replace(/<!--[\s\S]*?-->/g,'');
 for(const match of uncommented.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi))check(!/<(?:script|style)\b/i.test(match[0]),'unsafe_table_content');
 const cleaned=uncommented.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const expected=source==='numfocus-sdg'?['Project','Proposal Title','Amount','Year','Round']:['Financial year','Eligible applications','Offers','Success rate'];
 const tables=[...cleaned.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(m=>m[0]);
 const matches=[];
 for(const table of tables){
  const rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>cellText(c[1])));
  if(rows.length&&JSON.stringify(rows[0])===JSON.stringify(expected))matches.push(rows);
 }
 check(matches.length===1,'table_header_missing_or_ambiguous');
 const rows=matches[0];check(rows.length>1&&rows.length<=2001&&rows.every(r=>r.length===expected.length),'table_rows_invalid');
 let scope;
 if(source==='numfocus-sdg'){
  check(cleaned.includes('Previously Funded Programs'),'funded_section_missing');scope='Previously Funded Programs';
 }else{
  check(/does not include upgraded reserves/i.test(cleaned),'metric_exclusions_missing');scope='Application and offer data\nScope: data does not include upgraded reserves.';
 }
 const markdown=[scope,`| ${expected.join(' | ')} |`,`| ${expected.map(()=>'---').join(' | ')} |`,...rows.slice(1).map(r=>`| ${r.join(' | ')} |`),''].join('\n');
 return {body:markdown,rows:rows.length-1};
}
export async function captureFundingTable(source,{request=fetch,now=()=>new Date()}={}){
 check(HTML_SOURCES.includes(source),'unsupported_html_source');
 const source_url=SOURCE_CATALOG[source].url;let response;
 try{response=await request(source_url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html','User-Agent':'grants.watch-source-capture/1.0'}});}catch{throw new Error('source_transport_failure');}
 check(response.status===200,'source_http_failure');check(!response.url||response.url===source_url,'source_redirect_refused');
 check(/^text\/html(?:;|$)/i.test(response.headers.get('content-type')||''),'source_content_type');
 const declared=response.headers.get('content-length');check(declared===null||(/^\d+$/.test(declared)&&Number(declared)<=MAX_BYTES),'source_byte_limit');check(response.body,'empty_source');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;check(size<=MAX_BYTES,'source_byte_limit');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 let html;try{html=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new Error('source_encoding');}
 const at=now(),selected=selectFundingTable(html,source),observed_on=calendarDate(at);
 const snapshot={version:1,source_id:source,source_url,observed_on,provider:'web',representation:'tool_text_excerpt',scope:'First-party HTML table normalized to Markdown; all rows in the matching table',body:selected.body,body_sha256:digest(selected.body),source_revision:null};
 validateSourceSnapshot(snapshot,observed_on);
 return {bundle:{version:1,snapshots:[snapshot]},receipt:{source_id:source,source_url,captured_at:at.toISOString(),requests:1,bytes:size,full_representation_sha256:digest(html),selected_representation_sha256:snapshot.body_sha256,rows:selected.rows,scope:snapshot.scope,coverage:'matching_table_only',original_page_bytes_archived:false,redistribution:'unassessed',canonical_write:false,approval:false}};
}
