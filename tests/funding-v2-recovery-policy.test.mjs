import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFundingRecoveryReady } from '../src/lib/funding-recovery-policy.mjs';
import { handleFundingRequest } from '../src/lib/funding-api.mjs';
const good={status:'ok',failed:0,deferred:0,torn:false,truncated:false,timedOut:false};

test('v2 requires a successful replay when a durable backend is configured',()=>{
  for(const state of [null,{status:'skipped'},{status:'degraded'},{status:'unavailable'},{...good,torn:true},{...good,truncated:true},{...good,timedOut:true},{...good,failed:1},{...good,deferred:1}]) {
    assert.throws(()=>assertFundingRecoveryReady(state,true),/incomplete/);
  }
  assert.doesNotThrow(()=>assertFundingRecoveryReady(good,true));
  assert.doesNotThrow(()=>assertFundingRecoveryReady(null,false));
});
test('an empty directory after failed replay produces 503 rather than empty-success data',async()=>{
  let diskReads=0;
  const response=handleFundingRequest(new Request('https://example.org/api/v2'),[],{enabled:true,load:()=>{
    assertFundingRecoveryReady({status:'degraded',failed:1},true);
    diskReads++;
    return {baseline:{},dataset:{}};
  }});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'dataset_unavailable');
  assert.equal(diskReads,0);
});
