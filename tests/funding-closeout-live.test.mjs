import test from 'node:test';
import assert from 'node:assert/strict';
import {publicTarget,verifyLiveFunding,LIVE_LIMITS} from '../scripts/funding-closeout/live-read.mjs';
import {handleFundingProductRequest} from '../src/lib/funding-product.mjs';
const commit='a'.repeat(40),at=new Date('2026-10-04T18:00:00Z');
const baseline={systems:[],orgs:[{id:'funder',name:'Funder',profile:'Public',status:'active',sources:[]}],programs:[{id:'program',name:'Program',org:'funder',status:'active',summary:'Public',rounds:[],sources:[]}],awards:[]};
const dataset={'program-terms':[],'funding-events':[{
 key:'event',award_id:'award',event_type:'awarded',funder:'funder',recipient:'project',recipient_name:'Project',program:'program',source:'https://funder.example.org/report',checked_on:'2026-10-04',evidence_state:'primary_supported',evidence_note:'A public historical award.',amount:{amount:'1000',currency:'USD',unit:'currency',qualifier:'exact'},capital_form:'cash',occurred_on:null,announced_on:null,payment_date:null,
}],'process-metrics':[]};
function server(tweak) {
 let requests=0;
 const request=async(input,init)=>{
  requests++;assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,undefined);assert.ok(['GET','HEAD','OPTIONS'].includes(init.method));
  const url=new URL(input);if(tweak){const out=await tweak(url,init,requests);if(out)return out;}
  if(url.pathname==='/api/v1/deployment')return Response.json({commit});
  if(url.pathname.startsWith('/api/v1/')){const rows=baseline[url.pathname.split('/').at(-1)];return Response.json({data:rows,meta:{page:1,next_page:null,total:rows.length}});}
  if(url.pathname==='/api/desk/funding/workspace')return Response.json({error:'unauthorized'},{status:401});
  if(!url.pathname.startsWith('/api/v2'))return new Response('<!doctype html><html>Funding evidence</html>',{headers:{'content-type':'text/html'}});
  const path=url.pathname.replace(/^\/api\/v2\/?/,'').split('/').filter(Boolean).map(decodeURIComponent);
  return handleFundingProductRequest(new Request(input,init),path,{enabled:true,load:()=>({baseline,dataset}),now:()=>at});
 };
 return {request,requests:()=>requests};
}
const dependencies=s=>({request:s.request,pause:async()=>{},now:()=>at});
test('live verifier is pinned to one public host and refuses private or credentialed targets',()=>{
 assert.equal(publicTarget('https://grants.watch','/api/v2?limit=100'),'https://grants.watch/api/v2?limit=100');
 for(const [base,path]of [['http://grants.watch','/api/v2'],['https://evil.example','/'],['https://user:secret@grants.watch','/'],['https://grants.watch','//evil.example/'],['https://grants.watch','/admin/secret'],['https://grants.watch','/\\evil.example']])assert.throws(()=>publicTarget(base,path));
});
test('live verifier scans all collections, compares exports, samples details and checks public views',async()=>{
 const s=server(),out=await verifyLiveFunding({expectedCommit:commit},dependencies(s));
 assert.equal(out.receipt.passed,true);assert.equal(Object.keys(out.receipt.exports).length,16);assert.equal(out.receipt.counts['funding-events'],1);
 assert.equal(out.receipt.mutations,false);assert.equal(out.receipt.owner_credentials_used,false);assert.equal(out.receipt.negative_checks.length,6);assert.ok(s.requests()<LIVE_LIMITS.requests);
});
test('live verifier refuses an unanticipated deployment before scanning data',async()=>{
 const s=server();await assert.rejects(verifyLiveFunding({expectedCommit:'b'.repeat(40)},dependencies(s)),/unexpected_served_revision/);assert.equal(s.requests(),1);
});
test('live verifier refuses unsafe redirects, oversized responses and successful-but-wrong exports',async()=>{
 for(const [tweak,error]of [
  [(u)=>u.pathname==='/api/v1/deployment'?new Response(null,{status:302,headers:{location:'https://evil.example/steal'}}):null,/cross_origin_redirect/],
  [(u)=>u.pathname==='/api/v2'?new Response('{}',{headers:{'content-length':String(LIVE_LIMITS.responseBytes+1)}}):null,/response_byte_limit/],
  [(u)=>u.pathname==='/api/v2/export/funding-events'?new Response('',{headers:{'x-record-count':'1','x-snapshot-sha256':'f'.repeat(64)}}):null,/export_record_mismatch/],
 ]){const s=server(tweak);await assert.rejects(verifyLiveFunding({},dependencies(s)),error);}
});
test('live verifier cannot certify recovery headers before they are present',async()=>{
 const s=server();await assert.rejects(verifyLiveFunding({requireControl:true},dependencies(s)),/approved_control_header_missing/);
});
test('live verifier treats a graceful funding-unavailable page as a failed check',async()=>{
 const s=server(u=>u.pathname==='/funding'?new Response('<html>Funding evidence is temporarily unavailable.</html>'):null);
 await assert.rejects(verifyLiveFunding({},dependencies(s)),/website_snapshot_unavailable/);
});
