// Isolated test worker: imports the real production reader with its own filesystem.
import {replayAppliedChanges} from '../../src/lib/boot-replay.ts';
import {loadFundingReadSnapshot,serveFundingV2} from '../../src/lib/public-api-v2.ts';
import {closeFundingReadPool} from '../../src/lib/funding-replica-sync.ts';
const report=await replayAppliedChanges();
process.send?.({ready:true,status:report.status});
process.on('message',async message=>{
 const id=message.id;
 try{
  if(message.op==='close'){await closeFundingReadPool();process.send?.({id,closed:true});process.disconnect();return;}
  if(message.op==='api'){
   const response=await serveFundingV2(new Request('https://grants.watch/api/v2/funding-events?limit=100'),['funding-events']);
   const body=await response.json();process.send?.({id,status:response.status,head:response.headers.get('X-Funding-Control'),count:body.meta?.total??null,error:body.error??null});return;
  }
  const s=await loadFundingReadSnapshot();process.send?.({id,control:s.control.hash,events:s.dataset['funding-events'].length,terms:s.dataset['program-terms'].length});
 }catch{process.send?.({id,error:'read_refused'});}
});
