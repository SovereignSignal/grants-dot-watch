#!/usr/bin/env node
// Explicit, one-shot, public read verification. Never carries an owner credential.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { canonical } from '../../src/lib/funding-model.mjs';
import { PRODUCT_COLLECTIONS } from '../../src/lib/funding-product.mjs';

export const LIVE_LIMITS = Object.freeze({ requests: 400, responseBytes: 16*1024*1024, totalBytes: 64*1024*1024, rows: 20000, timeoutMs: 20000, redirectCount: 2 });
const sha = value => createHash('sha256').update(canonical(value)).digest('hex');
const failure = code => { throw new Error(code); };
const check = (condition, code) => { if (!condition) failure(code); };
const allowedPath = p => p === '/' || ['/health','/funding','/data','/api/desk/funding/workspace'].includes(p) || /^\/programs\/[a-z0-9][a-z0-9-]*$/.test(p) || /^\/api\/v[12](?:\/[^\\]*)?$/.test(p);
export function publicTarget(base, path) {
  const origin = new URL(base);
  check(origin.origin === 'https://grants.watch' && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash, 'unsupported_live_origin');
  check(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'), 'unsafe_request_path');
  const url = new URL(path, origin);
  check(url.origin === origin.origin && !url.hash && allowedPath(url.pathname), 'unsafe_request_path');
  return url.href;
}
async function boundedBody(response, state) {
  const declared = response.headers.get('content-length');
  check(declared === null || (/^\d+$/.test(declared) && Number(declared) <= LIVE_LIMITS.responseBytes), 'response_byte_limit');
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      bytes += value.byteLength; state.bytes += value.byteLength;
      check(bytes <= LIVE_LIMITS.responseBytes && state.bytes <= LIVE_LIMITS.totalBytes, 'response_byte_limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  return new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks));
}
function sample(rows) { return [...new Set([0,Math.floor(rows.length/2),rows.length-1])].filter(i=>i>=0&&i<rows.length).map(i=>rows[i]); }

export async function verifyLiveFunding({base='https://grants.watch', expectedCommit=null, requireControl=false}={}, {request=fetch,pause=()=>wait(100),now=()=>new Date()}={}) {
  publicTarget(base,'/');
  check(expectedCommit === null || /^[a-f0-9]{40}$/.test(expectedCommit),'invalid_expected_revision');
  const state = {requests:0,bytes:0,latencies:[],checks:[],controls:new Set()}, started = now().toISOString();
  async function get(path, method='GET', expected=200) {
    check(['GET','HEAD','OPTIONS'].includes(method),'read_only_verifier');
    let target=publicTarget(base,path),response;
    const at=performance.now();
    for(let redirect=0;;redirect++) {
      check(++state.requests<=LIVE_LIMITS.requests,'request_budget');
      await pause();
      response=await request(target,{method,redirect:'manual',signal:AbortSignal.timeout(LIVE_LIMITS.timeoutMs),headers:{Accept:'application/json, text/html;q=0.9, application/x-ndjson;q=0.8','User-Agent':'grants-watch-owner-verification/1.0'}});
      if(![301,302,303,307,308].includes(response.status))break;
      check(redirect<LIVE_LIMITS.redirectCount,'redirect_budget');
      const location=response.headers.get('location');check(location,'missing_redirect');
      const next=new URL(location,target);check(next.origin===new URL(base).origin,'cross_origin_redirect');
      await response.body?.cancel().catch(()=>{});
      target=publicTarget(base,next.pathname+next.search);
    }
    const body=await boundedBody(response,state);
    check(response.status===expected,`unexpected_http:${method}:${path.split('?')[0]}:${response.status}`);
    const control=response.headers.get('x-funding-control');if(control)state.controls.add(control);
    state.latencies.push(performance.now()-at);
    return {body,headers:response.headers,status:response.status};
  }
  const json = async path => {const r=await get(path);check(r.headers.get('content-type')?.includes('json'),'expected_json');return JSON.parse(r.body);};
  const revision=await json('/api/v1/deployment');
  check(typeof revision.commit==='string'&&/^[a-f0-9]{40}$/.test(revision.commit),'missing_served_revision');
  check(!expectedCommit||revision.commit===expectedCommit,'unexpected_served_revision');
  const index=await json('/api/v2'),document=await json('/api/v2/openapi');
  check(index.version==='v2'&&index.status==='live','v2_not_live');
  check(document.openapi==='3.1.0','openapi_contract');
  check(canonical(Object.keys(index.endpoints).sort())===canonical([...PRODUCT_COLLECTIONS].sort()),'advertised_collection_mismatch');
  const collections={},exports={},details={};
  for(const kind of PRODUCT_COLLECTIONS) {
    check(index.endpoints[kind]===`/api/v2/${kind}`,'unsafe_advertised_endpoint');
    check(document.paths[`/api/v2/${kind}`]?.get&&document.paths[`/api/v2/${kind}/{id}`]?.get,'undocumented_collection');
    const rows=[],cursors=new Set();let cursor=null,total=null,snapshot=null;
    do {
      const path=`/api/v2/${kind}?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`;
      const page=await json(path);
      check(Array.isArray(page.data)&&page.data.length<=100&&Number.isSafeInteger(page.meta?.total)&&page.meta.total>=0,'invalid_page');
      if(total===null){total=page.meta.total;snapshot=page.meta.snapshot;}
      check(page.meta.total===total&&page.meta.snapshot===snapshot,'collection_changed');
      rows.push(...page.data);check(rows.length<=LIVE_LIMITS.rows,'row_budget');
      cursor=page.meta.next_cursor;
      check(cursor===null||(typeof cursor==='string'&&!cursors.has(cursor)&&page.data.length>0),'invalid_cursor_progress');
      if(cursor)cursors.add(cursor);
    }while(cursor);
    check(rows.length===total&&rows.length===index.counts[kind],'collection_count_mismatch');
    check(rows.every(row=>typeof row.id==='string')&&new Set(rows.map(row=>row.id)).size===rows.length,'duplicate_or_invalid_id');
    check(sha(rows)===snapshot,'page_snapshot_mismatch');
    collections[kind]=rows;
    details[kind]=0;
    for(const row of sample(rows)) {
      const path=`/api/v2/${kind}/${encodeURIComponent(row.id)}`;
      check(row.api===path,'detail_url_mismatch');
      check(canonical((await json(path)).data)===canonical(row),'detail_record_mismatch');
      details[kind]++;
    }
    const downloaded=await get(`/api/v2/export/${kind}?format=jsonl`);
    const lines=downloaded.body.split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line));
    check(canonical(lines)===canonical(rows),'export_record_mismatch');
    check(downloaded.headers.get('x-record-count')===String(rows.length)&&downloaded.headers.get('x-snapshot-sha256')===sha(lines),'export_receipt_mismatch');
    exports[kind]={rows:lines.length,sha256:sha(lines)};
  }
  check(sha(collections)===index.snapshot,'product_snapshot_mismatch');
  const v1={};
  for(const kind of ['systems','orgs','programs','awards']) {
    let page=1,total=null;const rows=[];
    do {
      const part=await json(`/api/v1/${kind}?limit=100&page=${page}`);
      check(Array.isArray(part.data)&&part.meta?.page===page&&Number.isSafeInteger(part.meta?.total),'invalid_v1_page');
      if(total===null)total=part.meta.total;
      check(part.meta.total===total,'v1_changed_during_scan');rows.push(...part.data);
      check(rows.length<=LIVE_LIMITS.rows,'row_budget');
      const next=part.meta.next_page;check(next===null||next===page+1,'invalid_v1_pagination');page=next;
    }while(page);
    check(rows.length===total,'v1_count_mismatch');v1[kind]=rows;
    check(rows.length===collections[kind].length,'v1_v2_inventory_mismatch');
  }
  for(const [path,status] of [['/api/v2/programs?limit=0',400],['/api/v2/programs?limit=1&limit=2',400],['/api/v2/programs?unexpected=1',400],['/api/v2/programs?cursor=malformed',400],['/api/v2/programs/closeout-no-such-program',404],['/api/desk/funding/workspace',401]]) {
    await get(path,'GET',status);state.checks.push({path,status});
  }
  const head=await get('/api/v2/funding-events','HEAD');check(head.body==='','head_has_body');
  const options=await get('/api/v2/funding-events','OPTIONS',204);check(options.headers.get('access-control-allow-methods')?.includes('GET'),'preflight_contract');
  const views=['/','/health','/funding','/data','/funding?kind=program-terms','/funding?kind=process-metrics','/funding?kind=claims','/funding?kind=relationships','/funding?kind=changes','/funding?kind=outputs'];
  for(const id of [...new Set(collections['program-terms'].map(row=>row.program))].slice(0,10))views.push(`/programs/${id}`);
  for(const path of views){const r=await get(path);check(!r.body.includes('Funding evidence is temporarily unavailable'),'website_snapshot_unavailable');if(path!=='/health')check(r.body.includes('<html'),'expected_website_html');}
  check((await json('/api/v2')).snapshot===index.snapshot,'product_changed_during_verification');
  check((await json('/api/v1/deployment')).commit===revision.commit,'deployment_changed_during_verification');
  check(state.controls.size<=1,'replicas_returned_different_controls');
  check(!requireControl||state.controls.size===1,'approved_control_header_missing');
  const sorted=state.latencies.sort((a,b)=>a-b),pct=p=>Math.round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]);
  return {receipt:{version:1,passed:true,started_at:started,completed_at:now().toISOString(),served_revision:revision.commit,public_snapshot:index.snapshot,v1_snapshot:sha(v1),counts:index.counts,exports,details,website_views:views,negative_checks:state.checks,requests:state.requests,response_bytes:state.bytes,control:[...state.controls][0]||null,timing_ms:{median:pct(0.5),p95:pct(0.95),max:Math.round(sorted.at(-1))},scope:'Bounded sequential public verification, not sustained load or exhaustive historical evidence review',owner_credentials_used:false,mutations:false},collections,v1};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const {values}=parseArgs({options:{out:{type:'string'},'expected-commit':{type:'string'},'require-control':{type:'boolean'},'fetch':{type:'boolean'}},allowPositionals:false,strict:true});
    if(!values.fetch){console.log(JSON.stringify({mode:'plan',target:'https://grants.watch',limits:LIVE_LIMITS,mutations:false}));}
    else {
      check(values.out,'new_output_directory_required');const destination=resolve(values.out);check(!existsSync(destination),'refusing_existing_output');
      const result=await verifyLiveFunding({expectedCommit:values['expected-commit']||null,requireControl:values['require-control']||false});
      mkdirSync(destination);writeFileSync(resolve(destination,'receipt.json'),JSON.stringify(result.receipt,null,2)+'\n',{flag:'wx'});
      writeFileSync(resolve(destination,'public-data.json'),JSON.stringify({collections:result.collections,v1:result.v1})+'\n',{flag:'wx'});
      console.log('LIVE_FUNDING_RECEIPT '+JSON.stringify(result.receipt));
    }
  }catch(error){console.error(JSON.stringify({passed:false,error:error.message,mutations:false}));process.exitCode=1;}
}
