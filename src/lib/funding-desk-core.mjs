// Owner-reviewed funding imports share the Desk outbox and its CAS/replay semantics.
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LEDGERS, canonical, validateFundingDataset } from './funding-model.mjs';
import { digest, readFundingLedgers } from './funding-store.mjs';
import { planFundingImport } from './funding-migration.mjs';
export const CONTROL_PATH='registry/funding-control.json';
export const MAX_PACK_BYTES=256*1024;
export const MAX_PACK_RECORDS=100;
const CONTROL_NAME='funding-control.json';
const order=dataset=>Object.fromEntries(LEDGERS.map(k=>[k,[...dataset[k]].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)]));
const datasetHash=dataset=>digest(order(dataset));
const plain=v=>v && typeof v==='object' && !Array.isArray(v);
const hex=v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const isLedgerPath=path=>typeof path==='string' && /^registry\/(program-terms|funding-events|process-metrics)\/[a-z0-9][a-z0-9-]*\.jsonl$/.test(path);
const read=path=>existsSync(path)?readFileSync(path,'utf8'):null;
export function isFundingProposal(proposal){return plain(proposal?.proposed_change) && Object.hasOwn(proposal.proposed_change,'_funding_v2');}
function assertOrdinaryPath(root,relativePath){
 if(typeof relativePath!=='string' || relativePath.includes('\\') || relativePath.split('/').some(p=>p==='..'||p==='.'||!p))throw new Error('Unsafe funding path');
 let current=root;if(lstatSync(current).isSymbolicLink())throw new Error('Funding root must not be a symlink');
 for(const segment of relativePath.split('/')){current=join(current,segment);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('Funding paths must not contain symlinks');}
}
function readControl(root){
 assertOrdinaryPath(root,CONTROL_NAME);const content=read(join(root,CONTROL_NAME));
 if(content===null)return {content:null,hash:null,value:null};
 if(Buffer.byteLength(content)>1024*1024)throw new Error('Oversized funding control');
 const value=JSON.parse(content);
 if(!plain(value)||Object.keys(value).sort().join(',')!=='dataset_sha256,previous_sha256,revision,version'||value.version!==1||!hex(value.dataset_sha256)||!hex(value.revision)||(value.previous_sha256!==null&&!hex(value.previous_sha256)))throw new Error('Invalid funding control');
 return {content,hash:digest(content),value};
}
export function readControlledFunding(root){
 const control=readControl(root),dataset=readFundingLedgers(root);
 const deskShards=LEDGERS.some(k=>existsSync(join(root,k)) && readdirSync(join(root,k)).some(f=>/^desk-.*\.jsonl$/.test(f)));
 if(deskShards && !control.value)throw new Error('Desk funding shards require their control record');
 if(control.value && control.value.dataset_sha256!==datasetHash(dataset))throw new Error('Funding snapshot does not match its control record');
 return {dataset,control};
}
function inspectPack(pack,baseline){
 if(!plain(pack)||Buffer.byteLength(JSON.stringify(pack))>MAX_PACK_BYTES||!plain(pack.records))throw new Error('Invalid or oversized funding pack');
 if(typeof pack.id!=='string'||pack.id.length>100)throw new Error('Invalid funding pack identity');
 let count=0;const ids=new Set();
 for(const ledger of LEDGERS){if(!Array.isArray(pack.records[ledger]))throw new Error('Missing funding ledger in pack');for(const row of pack.records[ledger]){count++;if(!plain(row)||!row.program)throw new Error('Desk funding records require a program');ids.add(row.program);}}
 if(!count||count>MAX_PACK_RECORDS||ids.size!==1)throw new Error('Submit 1 to 100 records for exactly one program');
 const program=baseline.programs.find(p=>p.id===[...ids][0]);if(!program)throw new Error('Funding program is not in the registry');return {program,count};
}
export function previewFundingProposal(root,baseline,pack,today){
 const {dataset,control}=readControlledFunding(root),{program,count}=inspectPack(pack,baseline);
 const plan=planFundingImport(baseline,dataset,pack,today);
 const envelope={pack:structuredClone(pack),expected_dataset:datasetHash(dataset),expected_control_hash:control.hash};
 const plan_digest=digest(envelope),source=LEDGERS.flatMap(k=>pack.records[k])[0].source;
 const proposal={type:'profile_note',org:program.org,program:program.id,title:`Funding data: ${program.name} (${count} records)`,summary:`Owner-reviewed v2 funding import. ${count} source-backed records; legacy program and award files remain unchanged.`,evidence_url:source,signal_id:`funding-v2:${plan_digest}`,wire:program.wires?.[0]||null,proposed_change:{_funding_v2:envelope}};
 return {proposal,plan_digest,added:plan.report.added,unchanged:plan.report.unchanged,canonical_write:false};
}
function overlay(root,baseline,changes,parseYaml){
 const data=readFundingLedgers(root),next=structuredClone(baseline);let control=readControl(root);const seen=new Set();
 for(const change of changes){
  if(seen.has(change.path))throw new Error('Duplicate path in funding-aware change set');seen.add(change.path);
  if(isLedgerPath(change.path)){
   assertOrdinaryPath(root,change.path.replace(/^registry\//,''));
   if(!['create','update','append'].includes(change.op))throw new Error('Unsupported funding operation');
   const ledger=change.path.split('/')[1],old=read(join(root,change.path.replace(/^registry\//,'')));
   const existingKeys=new Set((old||'').split('\n').filter(x=>x.trim()).map(x=>JSON.parse(x).key));
   const after=change.content_after??(change.op==='append'?`${old||''}${change.content}`:change.content);
   const entries=after.split('\n').filter(x=>x.trim()).map(x=>JSON.parse(x));
   for(const line of (old||'').split('\n').filter(x=>x.trim())){const before=JSON.parse(line),row=entries.find(r=>r.key===before.key);if(!row||canonical(row)!==canonical(before))throw new Error('Funding evidence is append-only');}
   data[ledger]=[...data[ledger].filter(row=>!existingKeys.has(row.key)),...entries];
  }else if(change.path===CONTROL_PATH){
   const value=JSON.parse(change.content_after??change.content);
   if(!plain(value)||value.version!==1||!hex(value.dataset_sha256)||!hex(value.revision))throw new Error('Invalid prepared funding control');control={...control,value};
  }else{
   const match=/^registry\/(orgs|programs)\/([a-z0-9][a-z0-9-]*)\.yaml$/.exec(change.path);
   if(match){const value=parseYaml(change.content_after??change.content),list=next[match[1]],idx=list.findIndex(r=>r.id===match[2]);if(idx>=0)list[idx]=value;else list.push(value);}
  }
 }
 return {data,next,control};
}
export function validateFundingChanges(root,baseline,changes,today,parseYaml){
 const relevant=changes.some(c=>isLedgerPath(c.path)||c.path===CONTROL_PATH);
 const present=LEDGERS.some(k=>existsSync(join(root,k))&&readdirSync(join(root,k)).some(f=>f.endsWith('.jsonl')));
 if(!relevant&&!present)return;
 const {data,next,control}=overlay(root,baseline,changes,parseYaml),errors=validateFundingDataset(data,next,today);
 if(errors.length)throw new Error(`Funding reference/schema validation failed: ${errors.slice(0,5).join('; ')}`);
 if(control.value&&control.value.dataset_sha256!==datasetHash(data))throw new Error('Prepared funding control does not match the complete dataset');
 const programs=new Set(LEDGERS.flatMap(k=>data[k].map(r=>r.program)).filter(Boolean));
 for(const id of programs){const old=baseline.programs.find(p=>p.id===id),updated=next.programs.find(p=>p.id===id);if(old&&updated&&old.org!==updated.org)throw new Error('Funding-linked program ownership requires explicit reconciliation');}
}
export function buildFundingDeskChanges(root,baseline,proposal,today){
 if(proposal.type!=='profile_note'||proposal.lane!=='judgment'||Object.keys(proposal.proposed_change).join(',')!=='_funding_v2')throw new Error('Invalid funding proposal envelope');
 const value=proposal.proposed_change._funding_v2;
 if(!plain(value)||Object.keys(value).sort().join(',')!=='expected_control_hash,expected_dataset,pack'||!hex(value.expected_dataset)||(value.expected_control_hash!==null&&!hex(value.expected_control_hash)))throw new Error('Invalid funding proposal guards');
 const {program}=inspectPack(value.pack,baseline);
 if(proposal.org!==program.org||proposal.program!==program.id)throw new Error('Funding proposal identity mismatch');
 const {dataset,control}=readControlledFunding(root);
 if(control.hash!==value.expected_control_hash||datasetHash(dataset)!==value.expected_dataset)throw new Error('Funding proposal is stale; preview and queue the revised pack');
 const plan=planFundingImport(baseline,dataset,value.pack,today),changes=[];
 for(const ledger of LEDGERS){
  const keys=new Set(dataset[ledger].map(r=>r.key)),added=plan.dataset[ledger].filter(r=>!keys.has(r.key));if(!added.length)continue;
  const name=`desk-${digest([value.pack.id,ledger,added])}.jsonl`;assertOrdinaryPath(root,`${ledger}/${name}`);
  if(existsSync(join(root,ledger,name)))throw new Error('Funding shard already exists; recheck canonical snapshot');
  changes.push({path:`registry/${ledger}/${name}`,op:'create',content:`${added.map(canonical).join('\n')}\n`});
 }
 if(changes.length)changes.unshift(controlChange(control,plan.dataset,digest(value)));
 return {changes,notes:[`v2 funding import: ${Object.values(plan.report.added).reduce((a,b)=>a+b,0)} new records; no payment inferred`]};
}
function controlChange(control,dataset,revision){return {path:CONTROL_PATH,op:control.content===null?'create':'update',content:`${canonical({version:1,previous_sha256:control.hash,dataset_sha256:datasetHash(dataset),revision})}\n`};}
export function addLegacyFundingControl(root,result){
 if(!result.changes.length||result.changes.some(c=>c.path===CONTROL_PATH))return result;
 const {dataset,control}=readControlledFunding(root);
 return {...result,changes:[controlChange(control,dataset,digest([control.hash,result.changes])),...result.changes]};
}
export function fundingGuard(root,baseline,result){
 const beforeControl=readControl(root).hash,beforeDataset=datasetHash(readFundingLedgers(root));
 const sourceHashes=Object.fromEntries(Object.keys(baseline.source_blobs).map(path=>[path,digest(readFileSync(join(root,path)))])),planHash=digest(result);
 return ()=>{
  if(digest(result)!==planHash)throw new Error('Prepared funding changes were modified');
  if(readControl(root).hash!==beforeControl||datasetHash(readFundingLedgers(root))!==beforeDataset)throw new Error('Funding snapshot changed after preparation');
  for(const [path,hash] of Object.entries(sourceHashes))if(digest(readFileSync(join(root,path)))!==hash)throw new Error('Funding reference changed after preparation');
 };
}
