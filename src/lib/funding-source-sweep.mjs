// Daily award-source sweep: the owner workspace's refresh -> compile ->
// preview -> queue steps, run once per product day from the ingest timer.
// It reuses those exact functions, queues pending Desk items only, and has
// no approval path. Each source fails on its own; nothing here throws.
import { LEDGERS } from './funding-model.mjs';
import { calendarDate } from './funding-api.mjs';
import { previewFundingPack } from './funding-desk-service.mjs';
import { NATIVE_REFRESH_SOURCES, compileSourceSnapshots, validateSourceSnapshots } from './funding-workspace-service.mjs';

/** Bounds one run's synchronous preview work (each preview re-reads and
 *  validates the funding snapshot). Packets past the cap wait for tomorrow. */
export const MAX_SWEEP_PREVIEWS=20;
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

/**
 * Runs one sweep. Microsoft is captured in archive mode (fund 0), the same
 * request the workspace's "Supported archive" checkbox sends.
 * @param {{
 *  enabled:boolean, fundingDeskEnabled:boolean,
 *  capture:(source:string,fund:number,revision:string|null)=>Promise<{bundle:{snapshots:unknown[]},receipt:unknown}>,
 *  load:()=>Promise<{root:string,baseline:unknown,dataset:unknown}>|{root:string,baseline:unknown,dataset:unknown},
 *  proposals:()=>Promise<Array<{state?:string,proposed_change?:any}>>,
 *  enqueue:(rows:unknown[])=>Promise<{inserted:unknown[],skipped:number}>,
 *  sources?:readonly string[], now?:()=>Date, yieldTurn?:()=>Promise<void>, maxPreviews?:number
 * }} deps
 */
export async function sweepAwardSources(deps){
 const now=(deps.now||(()=>new Date()))(),started=Date.now();
 const summary={at:now.toISOString(),enabled:deps.enabled===true,skipped:null,sources_tried:0,sources_failed:0,
  packets_queued:0,packets_repeated:0,packets_held:0,packets_deferred:0,records_held:0,duration_ms:0,sources:[],approval:false};
 if(!summary.enabled){summary.skipped='award_sources_disabled';return summary;}
 if(deps.fundingDeskEnabled!==true){summary.skipped='funding_desk_disabled';return summary;}
 const pause=deps.yieldTurn||turn,cap=deps.maxPreviews??MAX_SWEEP_PREVIEWS,today=calendarDate(now);
 let seen,previews=0;
 try{seen=seenKeys(await deps.proposals());}
 catch(error){summary.skipped='desk_queue_unavailable';summary.error=message(error);return summary;}
 for(const source of deps.sources||NATIVE_REFRESH_SOURCES){
  const row={source,status:'ok',packets:0,queued:0,repeated:0,held:0,deferred:0,records_held:0,error:null};
  summary.sources.push(row);summary.sources_tried++;
  try{
   await pause();
   const capture=await deps.capture(source,source==='microsoft-foss'?0:36,null);
   const compiled=await compileSourceSnapshots(validateSourceSnapshots(capture.bundle.snapshots,today),deps.load,today);
   row.packets=compiled.packets.length;row.records_held=compiled.held.length;
   if(compiled.source_failures?.length)row.error=`partial_source_failure: ${compiled.source_failures.length}`;
   for(const pack of compiled.packets){
    const keys=packetKeys(pack);
    // Identical repeats are no-ops: every record is already queued or was rejected.
    if(keys.every(k=>seen.inflight.has(k)||seen.rejected.has(k))){row.repeated++;continue;}
    // A packet that overlaps a pending item waits until the owner decides that item.
    if(keys.some(k=>seen.inflight.has(k))){row.held++;continue;}
    if(previews>=cap){row.deferred++;continue;}
    await pause();previews++;
    let preview;
    try{preview=await previewFundingPack(pack,deps.load,now);}
    catch(error){row.held++;row.error=`preview_failed: ${message(error)}`;continue;}
    if(addedCount(preview.added)===0){row.repeated++;continue;}
    // insertIngestProposals dedupes on signal_id (funding-v2:<plan digest>).
    const result=await deps.enqueue([preview.proposal]);
    if(result.inserted.length){row.queued++;for(const k of keys)seen.inflight.add(k);}
    else row.repeated++;
   }
  }catch(error){row.status='failed';row.error=message(error);summary.sources_failed++;}
  summary.packets_queued+=row.queued;summary.packets_repeated+=row.repeated;summary.packets_held+=row.held;
  summary.packets_deferred+=row.deferred;summary.records_held+=row.records_held;
 }
 summary.duration_ms=Date.now()-started;
 return summary;
}
