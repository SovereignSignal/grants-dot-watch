import test from 'node:test';
import assert from 'node:assert/strict';
import {fundingReferenceBlobs,handleFundingWorkspace} from '../src/lib/funding-workspace-service.mjs';

test('review reference guards expose only ordinary org/program paths and Git blob hashes',()=>{
 const hash='a'.repeat(40);
 assert.deepEqual(fundingReferenceBlobs({source_blobs:{'orgs/example.yaml':hash,'programs/example-grants.yaml':hash,'../secrets':hash,'orgs/../../secret.yaml':hash,'orgs/example.json':hash,'orgs/bad.yaml':'not-a-hash','private/token':hash}}),{'orgs/example.yaml':hash,'programs/example-grants.yaml':hash});
 assert.deepEqual(fundingReferenceBlobs({}),{});
});
test('review reference guards refuse unbounded inventories',()=>{
 const source_blobs=Object.fromEntries(Array.from({length:10001},(_,i)=>[`orgs/id-${i}.yaml`,'b'.repeat(40)]));
 assert.throws(()=>fundingReferenceBlobs({source_blobs}),/reference_inventory_limit/);
});
test('an unauthenticated workspace request cannot read reference guards',async()=>{
 let touched=false;
 const response=await handleFundingWorkspace(new Request('https://grants.watch/api/desk/funding/workspace'),{authorize:async()=>false,enabled:true,publicEnabled:true,load:()=>{touched=true;throw Error('must not load');},pending:async()=>[],retained:()=>[],capture:async()=>{throw Error('must not capture');}});
 assert.equal(response.status,401);assert.equal(touched,false);
});
