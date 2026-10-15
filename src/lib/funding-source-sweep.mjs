// Daily award-source sweep: the owner workspace's refresh -> compile ->
// preview -> queue steps, run once per product day from the ingest timer.
// It reuses those exact functions and queues pending Desk items. It has no
// approval path of its own: with AWARD_SOURCES_AUTO_APPLY=1 the caller passes
// an `autoApply` hook (src/lib/award-auto-apply.ts) that may approve a clean
// packet through the owner Desk path. Each source fails on its own; nothing
// here throws.
import { LEDGERS } from './funding-model.mjs';
import { calendarDate } from './funding-api.mjs';
import { previewFundingPack } from './funding-desk-service.mjs';
import { SOURCE_CATALOG } from './funding-source-adapters.mjs';
import { NATIVE_REFRESH_SOURCES, compileSourceSnapshots, validateSourceSnapshots } from './funding-workspace-service.mjs';

/** Bounds one run's synchronous preview work (each preview re-reads and
 *  validates the funding snapshot). Packets past the cap wait for tomorrow. */
export const MAX_SWEEP_PREVIEWS=20;
/** Marks the packets this sweep queued, so a later run can retry its own. */
export const SWEEP_ORIGIN='award_source_sweep';
const message=error=>(error instanceof Error?error.message:String(error)).slice(0,200);
const turn=()=>new Promise(resolve=>setImmediate(resolve));

/** Record keys already in flight (pending or applying) and already rejected.
 *  Approved keys need no entry: the compiler reports them as unchanged. */
function seenKeys(proposals){
 const inflight=new Set(),rejected=new Set();
 for(const p of proposals){
  const records=p?.proposed_change?._funding_v2?.pack?.records;
  if(!records||typeof records!=='object'||p.state==='approved')continue;
  const into=p.state==='rejected'?rejected:inflight;
  for(const ledger of LEDGERS)for(const row of Array.isArray(records[ledger])?records[ledger]:[])if(typeof row?.key==='string')into.add(row.key);
 }
 return {inflight,rejected};
}
const packetKeys=pack=>LEDGERS.flatMap(ledger=>pack.records[ledger].map(row=>row.key));
const addedCount=added=>Object.values(added||{}).reduce((n,v)=>n+(Number(v)||0),0);
/** This sweep's own still-pending funding packets, oldest first. */
const pendingSweepPackets=proposals=>proposals.filter(p=>p?.state==='pending'&&p.origin===SWEEP_ORIGIN&&typeof p.id==='string'
 &&typeof p.signal_id==='string'&&/^funding-v2:[a-f0-9]{64}$/.test(p.signal_id)&&p.proposed_change?._funding_v2?.pack);

/**
 * Runs one sweep. Microsoft is captured in archive mode (fund 0), the same
 * request the workspace's "Supported archive" checkbox sends.
 *
 * With `autoApply`: every source is captured and compiled first; then the
 * sweep's own still-pending packets are retried, before any new packet can
 * spend the auto-apply cap; then new packets are previewed and handed to the
 * hook, which queues each one unless it is clean and is deferred to the next
 * run (cap reached or writer busy), so a deferred packet is never left stale.
 * @param {{
 *  enabled:boolean, fundingDeskEnabled:boolean,
 *  capture:(source:string,fund:number,revision:string|null)=>Promise<{bundle:{snapshots:unknown[]},receipt:unknown}>,
 *  load:()=>Promise<{root:string,baseline:unknown,dataset:unknown}>|{root:string,baseline:unknown,dataset:unknown},
 *  proposals:()=>Promise<Array<any>>,
 *  enqueue:(rows:unknown[])=>Promise<{inserted:any[],skipped:number}>,
 *  sources?:readonly string[], now?:()=>Date, yieldTurn?:()=>Promise<void>, maxPreviews?:number,
 *  autoApply?:(input:any)=>Promise<{status:'applied'|'left'|'deferred'|'repeated',reasons:string[],proposal_id:string|null}>
 * }} deps
 */
export async function sweepAwardSources(deps){
 const now=(deps.now||(()=>new Date()))(),started=Date.now(),autoApply=deps.autoApply;
 const summary={at:now.toISOString(),enabled:deps.enabled===true,skipped:null,sources_tried:0,sources_failed:0,
  packets_queued:0,packets_repeated:0,packets_held:0,packets_deferred:0,records_held:0,duration_ms:0,sources:[],
  approval:typeof autoApply==='function',auto_applied:0,auto_applied_retries:0,left_for_owner:[],auto_apply_deferred:[]};
 if(!summary.enabled){summary.skipped='award_sources_disabled';return summary;}
 if(deps.fundingDeskEnabled!==true){summary.skipped='funding_desk_disabled';return summary;}
 const pause=deps.yieldTurn||turn,cap=deps.maxPreviews??MAX_SWEEP_PREVIEWS,today=calendarDate(now);
 let seen,pending,previews=0;
 try{const proposals=await deps.proposals();seen=seenKeys(proposals);pending=autoApply?pendingSweepPackets(proposals):[];}
 catch(error){summary.skipped='desk_queue_unavailable';summary.error=message(error);return summary;}

 const record=(row,outcome,base)=>{
  if(outcome.status==='applied'){row.auto_applied++;summary.auto_applied++;if(base.retry)summary.auto_applied_retries++;}
  else if(outcome.status==='deferred'){row.deferred++;summary.auto_apply_deferred.push({source:base.source,pack_id:base.pack_id,reasons:outcome.reasons});}
  else if(outcome.status==='left')summary.left_for_owner.push({...base,proposal_id:outcome.proposal_id,queued:true,reasons:outcome.reasons.length?outcome.reasons:['not_clean']});
 };

 // 1. Capture and compile every source.
 const compiledSources=[];
 for(const source of deps.sources||NATIVE_REFRESH_SOURCES){
  const row={source,status:'ok',packets:0,queued:0,repeated:0,held:0,deferred:0,records_held:0,auto_applied:0,error:null};
  summary.sources.push(row);summary.sources_tried++;
  try{
   await pause();
   const capture=await deps.capture(source,source==='microsoft-foss'?0:36,null);
   const compiled=await compileSourceSnapshots(validateSourceSnapshots(capture.bundle.snapshots,today),deps.load,today);
   row.packets=compiled.packets.length;row.records_held=compiled.held.length;
   if(compiled.source_failures?.length)row.error=`partial_source_failure: ${compiled.source_failures.length}`;
   compiledSources.push({source,row,compiled});
  }catch(error){row.status='failed';row.error=message(error);summary.sources_failed++;}
 }

 // 2. Retry this sweep's still-pending packets against today's compile.
 if(autoApply)for(const {source,row,compiled} of compiledSources){
  const program=Object.hasOwn(SOURCE_CATALOG,source)?SOURCE_CATALOG[source].program:null;
  for(const p of pending.filter(p=>p.program===program)){
   const base={source,pack_id:String(p.proposed_change._funding_v2.pack.id??''),retry:true};
   if(previews>=cap){summary.left_for_owner.push({...base,proposal_id:p.id,queued:true,reasons:['preview_budget']});continue;}
   await pause();previews++;
   let outcome;
   try{outcome=await autoApply({source,compiled,pack:p.proposed_change._funding_v2.pack,proposal:p});}
   catch(error){outcome={status:'left',reasons:[`auto_apply_error: ${message(error)}`],proposal_id:p.id};}
   record(row,outcome,base);
  }
 }

 // 3. New packets.
 for(const {source,row,compiled} of compiledSources){
  try{
   for(const pack of compiled.packets){
    const keys=packetKeys(pack);
    // Identical repeats are no-ops: every record is already queued or was rejected.
    if(keys.every(k=>seen.inflight.has(k)||seen.rejected.has(k))){row.repeated++;continue;}
    // New records beside owner-rejected ones: the owner's rejection covered the
    // packet, so it is held here rather than re-queued daily, and never auto-applies.
    if(keys.some(k=>seen.rejected.has(k))){row.held++;summary.left_for_owner.push({source,pack_id:pack.id,retry:false,proposal_id:null,queued:false,reasons:['contains_rejected_records']});continue;}
    // A packet that overlaps a pending item waits until the owner decides that item.
    if(keys.some(k=>seen.inflight.has(k))){row.held++;continue;}
    if(previews>=cap){row.deferred++;continue;}
    await pause();previews++;
    let preview;
    try{preview=await previewFundingPack(pack,deps.load,now);}
    catch(error){row.held++;row.error=`preview_failed: ${message(error)}`;continue;}
    if(addedCount(preview.added)===0){row.repeated++;continue;}
    // insertIngestProposals dedupes on signal_id (funding-v2:<plan digest>).
    let queued=false,queuedProposal=null;
    const queue=async()=>{
     if(queued)throw new Error('packet_already_queued');queued=true;
     const result=await deps.enqueue([{...preview.proposal,origin:SWEEP_ORIGIN}]);
     if(!result.inserted.length){row.repeated++;return null;}
     row.queued++;for(const k of keys)seen.inflight.add(k);
     return (queuedProposal=result.inserted[0]);
    };
    if(!autoApply){await queue();continue;}
    let outcome;
    try{await pause();outcome=await autoApply({source,compiled,pack,preview,queue});}
    catch(error){
     // Never let a hook failure drop a packet: queue it for the owner.
     const proposal=queued?queuedProposal:await queue();
     outcome={status:proposal?'left':'repeated',reasons:[`auto_apply_error: ${message(error)}`],proposal_id:proposal?.id??null};
    }
    record(row,outcome,{source,pack_id:pack.id,retry:false});
   }
  }catch(error){row.status='failed';row.error=message(error);summary.sources_failed++;}
 }
 for(const row of summary.sources){
  summary.packets_queued+=row.queued;summary.packets_repeated+=row.repeated;summary.packets_held+=row.held;
  summary.packets_deferred+=row.deferred;summary.records_held+=row.records_held;
 }
 summary.duration_ms=Date.now()-started;
 return summary;
}
