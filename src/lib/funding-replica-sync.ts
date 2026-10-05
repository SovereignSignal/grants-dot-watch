// Runtime-only read barrier. No DDL, owner verdict or Git archival is performed here.
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { committedHead } from './funding-read-coordinator.mjs';
import { refreshAppliedChanges, lastBootReplayReport, type BootReplayReport } from './boot-replay';
import { invalidateRegistryCache } from './registry';
import { assertFundingRecoveryReady } from './funding-recovery-policy.mjs';

type Slot={pool:Pool|null;url:string|null;refresh:Promise<BootReplayReport>|null};
const KEY=Symbol.for('grants-watch.funding-replica-sync');
function slot():Slot {
  const host=globalThis as unknown as Record<symbol,Slot|undefined>;
  return host[KEY]??=( {pool:null,url:null,refresh:null} );
}
export function fundingRecoveryReady() {
  try{assertFundingRecoveryReady(lastBootReplayReport(),Boolean(process.env.DATABASE_URL));return true;}catch{return false;}
}
export async function readCommittedFundingHead() {
  const url=process.env.DATABASE_URL;
  if(!url)return null;
  const s=slot();
  if(s.url && s.url!==url)throw new Error('Runtime database identity changed');
  if(!s.pool){
    s.url=url;s.pool=new Pool({connectionString:url,max:2,connectionTimeoutMillis:3000,query_timeout:5000,statement_timeout:4000,options:'-c default_transaction_read_only=on'});
    s.pool.on('error',()=>{});
  }
  const pool=s.pool;
  return committedHead((text,params)=>pool.query(text,params));
}
export function refreshFundingReplica() {
  const s=slot();
  if(!s.refresh){
    s.refresh=(async()=>{
      const dir=join(process.cwd(),'.data');mkdirSync(dir,{recursive:true});
      const lock=join(dir,'funding-writer.lock');
      // Same lock used by the existing mutation gateway. Never age-expire it.
      try{mkdirSync(lock);}catch{throw new Error('Funding writer is active or requires recovery');}
      try{
        const report=await refreshAppliedChanges();
        assertFundingRecoveryReady(report,Boolean(process.env.DATABASE_URL));
        invalidateRegistryCache();return report;
      }finally{if(existsSync(lock))rmdirSync(lock);}
    })().finally(()=>{s.refresh=null;});
  }
  return s.refresh;
}
export async function closeFundingReadPool() {
  const s=slot();if(s.refresh)await s.refresh.catch(()=>{});if(s.pool)await s.pool.end();s.pool=null;s.url=null;
}
