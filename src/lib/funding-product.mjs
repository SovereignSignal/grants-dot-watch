// Public funding product projections. Every row comes from validated canonical data.
// Research candidates, queue metadata and raw source text are never read here.
import { createHash } from 'node:crypto';
import { buildFundingCollections, COLLECTIONS, calendarDate, handleFundingRequest, fundingIndex } from './funding-api.mjs';
import { canonical, isIsoDate, isPublicUrl, LEDGERS, FUNDING_SCHEMAS } from './funding-model.mjs';
import { pointerValue } from './funding-provenance.mjs';

export const EXTRA_COLLECTIONS=['claims','relationships','changes','outputs','coverage'];
export const PRODUCT_COLLECTIONS=[...COLLECTIONS,...EXTRA_COLLECTIONS];
const sha=value=>createHash('sha256').update(canonical(value)).digest('hex');
const arr=v=>Array.isArray(v)?v:[];
const url=v=>isPublicUrl(v)?v:null;
const day=v=>isIsoDate(v)?v:null;
const api=(kind,id)=>`/api/v2/${kind}/${encodeURIComponent(id)}`;
const newest=values=>values.filter(isIsoDate).sort().at(-1)||null;
const text=(v,max=2000)=>typeof v==='string'?v.slice(0,max):null;
const unique=rows=>[...new Map(rows.map(row=>[row.id,row])).values()];

export function buildFundingProduct(baseline,dataset,at=new Date()) {
  const collections=buildFundingCollections(baseline,dataset,at);
  const today=calendarDate(at), programs=new Map(baseline.programs.map(p=>[p.id,p]));
  const claims=[], relationships=[], changes=[], outputs=[];
  const addEdge=(from_kind,from,role,to_kind,to,record)=>{
    if(!from||!to)return;
    const id=`edge-${sha([from_kind,from,role,to_kind,to,record.record_key||null,record.scope||null])}`;
    relationships.push({id,from_kind,from,role,to_kind,to,...record,api:api('relationships',id)});
  };
  for(const p of baseline.programs) {
    // p.org is the curated association, not proof of legal capital ownership.
    addEdge('program',p.id,'registry_association','org',p.org,{program:p.id,org:p.org,source:url(p.review?.source)||arr(p.sources).map(url).find(Boolean)||null,evidence_state:'registry_record',effective_from:null,effective_to:null,record_key:null});
    if(p.parent)addEdge('program',p.id,'child_program','program',p.parent,{program:p.id,org:p.org,source:arr(p.sources).map(url).find(Boolean)||null,evidence_state:'registry_record',effective_from:null,effective_to:null,record_key:null});
    for(const h of arr(p.review?.history)){
      if(!day(h.date)||!url(h.source))continue;
      const id=`history-${sha([p.id,h.date,h.label,h.summary,h.source])}`;
      changes.push({id,program:p.id,org:p.org,kind:'published_history',record_key:null,ledger:'programs',observed_on:null,effective_on:day(h.date),label:text(h.label,300),summary:text(h.summary),source:url(h.source),supersedes_key:null,api:api('changes',id)});
    }
    // Carry forward only already-public fact fields. Do not promote a dated
    // registry review into newly fetched evidence or typed legal terms.
    for(const field of ['eligibility','geography','funding','deadline']){
      const fact=p.review?.facts?.[field];
      if(!fact||!text(fact.value)||!url(fact.source)||!day(fact.checked_on))continue;
      const id=`legacy-claim-${sha([p.id,field,fact.value,fact.source,fact.checked_on])}`;
      claims.push({id,program:p.id,org:p.org,ledger:'programs',record_key:p.id,field:`/review/facts/${field}/value`,value:text(fact.value),value_sha256:sha(fact.value),method:'registry_record',rule:'carried_forward_public_fact',evidence_state:'registry_record',observed_on:day(fact.checked_on),sources:[{url:fact.source,observed_on:fact.checked_on,representation_sha256:null,source_revision:null,line:null,redistribution:'unassessed'}],api:api('claims',id)});
    }
  }
  for(const ledger of LEDGERS)for(const record of dataset[ledger]){
    const program=record.program||null,org=programs.get(program)?.org||record.funder||null;
    const id=`change-${sha([ledger,record.key])}`;
    changes.push({id,program,org,kind:record.supersedes_key?'correction_recorded':'evidence_recorded',record_key:record.key,ledger,observed_on:day(record.checked_on),effective_on:day(record.occurred_on)||day(record.effective_from),label:record.event_type||ledger,summary:null,source:url(record.source),supersedes_key:record.supersedes_key||null,api:api('changes',id)});
    for(const assertion of arr(record.provenance?.assertions)){
      const sources=arr(assertion.evidence).map(ref=>{
        const s=record.provenance.sources.find(s=>s.id===ref.source_id);
        return {url:s.url,observed_on:s.observed_on,representation_sha256:s.representation_sha256,source_revision:s.source_revision,line:ref.line,representation:s.representation,scope:s.scope,redistribution:s.redistribution,rights_source:s.rights_source};
      });
      const claimId=`claim-${sha([ledger,record.key,assertion.field])}`;
      claims.push({id:claimId,program,org,ledger,record_key:record.key,field:assertion.field,value:pointerValue(record,assertion.field),value_sha256:assertion.value_sha256,method:assertion.method,rule:assertion.rule,evidence_state:record.evidence_state,observed_on:newest(sources.map(s=>s.observed_on)),sources,api:api('claims',claimId)});
    }
    if(ledger==='program-terms'){
      for(const [role,ids]of [['operator',[record.operator_org]],['capital_source',record.capital_source_orgs],['disburser',[record.disburser_org]]])for(const target of arr(ids).filter(Boolean))
        addEdge('program',program,role,'org',target,{program,org,source:url(record.source),evidence_state:record.evidence_state,effective_from:record.effective_from||null,effective_to:record.effective_to||null,record_key:record.key,scope:record.round_name||null});
    }
    if(ledger==='funding-events'){
      addEdge('org',record.funder,'award_issuer','recipient',record.recipient,{program,org,source:url(record.source),evidence_state:record.evidence_state,effective_from:day(record.occurred_on),effective_to:null,record_key:record.key,award_id:record.award_id,event_type:record.event_type});
      if(url(record.recipient_url)){
        const outputId=`project-${sha([record.recipient,record.recipient_url])}`;
        outputs.push({id:outputId,program,org,recipient:record.recipient,name:record.recipient_name,kind:new URL(record.recipient_url).hostname==='github.com'?'software_repository':'project_url',url:record.recipient_url,source:record.source,record_key:record.key,relationship:'funded_project_link',delivery_state:'not_established',causal_impact:'not_established',api:api('outputs',outputId)});
      }
    }
  }
  const coverage=baseline.orgs.map(org=>{
    const owned=baseline.programs.filter(p=>p.org===org.id),ids=new Set(owned.map(p=>p.id));
    const terms=dataset['program-terms'].filter(r=>ids.has(r.program)),events=dataset['funding-events'].filter(r=>ids.has(r.program)||r.funder===org.id),metrics=dataset['process-metrics'].filter(r=>ids.has(r.program));
    return {id:org.id,name:org.name,org:org.id,programs:owned.length,programs_with_typed_terms:new Set(terms.map(t=>t.program)).size,legacy_awards:arr(baseline.awards).filter(a=>a.funder===org.id).length,funding_events:events.length,process_observations:metrics.length,field_assertions:claims.filter(c=>c.org===org.id&&c.method!=='registry_record').length,legacy_public_facts:claims.filter(c=>c.org===org.id&&c.method==='registry_record').length,last_evidence_on:newest([...terms,...events,...metrics].map(r=>r.checked_on)),scope:'recorded_data_only',complete_history:false,api:api('coverage',org.id)};
  });
  collections.claims=unique(claims);collections.relationships=unique(relationships);collections.changes=unique(changes);collections.outputs=unique(outputs);collections.coverage=coverage;
  for(const kind of EXTRA_COLLECTIONS)collections[kind].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {collections,today,snapshot:sha(Object.fromEntries(PRODUCT_COLLECTIONS.map(k=>[k,collections[k]])))};
}

const FILTERS={claims:['program','org','ledger','record_key','field','method','evidence_state','observed_since'],relationships:['program','org','from','to','role'],changes:['program','org','ledger','kind','observed_since','effective_since'],outputs:['program','org','recipient','kind'],coverage:['org']};
export class ProductQueryError extends Error{constructor(status,code){super(code);this.status=status;}}
function queryParams(kind,params){
  const values={};
  for(const [key,value]of params){
    if(!['q','limit','cursor',...FILTERS[kind]].includes(key)||params.getAll(key).length!==1||!value||value!==value.trim()||value.length>(key==='cursor'?2048:300))throw new ProductQueryError(400,'invalid_parameter');
    values[key]=value;
  }
  for(const field of ['observed_since','effective_since'])if(values[field]&&!isIsoDate(values[field]))throw new ProductQueryError(400,'invalid_date');
  if(values.limit&&!/^(?:[1-9]\d?|100)$/.test(values.limit))throw new ProductQueryError(400,'invalid_limit');
  return values;
}
export function queryProductCollection(kind,params,product){
  if(!EXTRA_COLLECTIONS.includes(kind))throw new ProductQueryError(404,'not_found');
  const values=queryParams(kind,params),limit=Number(values.limit||50),filters=Object.fromEntries(Object.entries(values).filter(([k])=>!['limit','cursor'].includes(k)));
  const rows=product.collections[kind].filter(row=>Object.entries(filters).every(([key,value])=>{
    if(key==='q')return [row.name,row.id,row.program,row.field,row.label,row.summary,row.recipient,row.from,row.to].some(v=>typeof v==='string'&&v.toLowerCase().includes(value.toLowerCase()));
    if(key==='observed_since')return row.observed_on!==null&&row.observed_on>=value;
    if(key==='effective_since')return row.effective_on!==null&&row.effective_on>=value;
    return row[key]===value;
  }));
  const snapshot=sha(rows),query=sha([kind,filters]);let start=0;
  if(values.cursor){
    let cursor;try{if(!/^[A-Za-z0-9_-]+$/.test(values.cursor))throw new Error();const raw=Buffer.from(values.cursor,'base64url').toString('utf8');if(Buffer.from(raw).toString('base64url')!==values.cursor)throw new Error();cursor=JSON.parse(raw);}catch{throw new ProductQueryError(400,'invalid_cursor');}
    if(!cursor||Object.keys(cursor).sort().join(',')!=='after,query,snapshot,v'||cursor.v!==2||cursor.query!==query||typeof cursor.after!=='string'||cursor.after.length>300||!/^[a-f0-9]{64}$/.test(cursor.snapshot))throw new ProductQueryError(400,'invalid_cursor');
    if(cursor.snapshot!==snapshot)throw new ProductQueryError(409,'snapshot_changed');
    const index=rows.findIndex(row=>row.id===cursor.after);if(index<0)throw new ProductQueryError(400,'invalid_cursor');start=index+1;
  }
  const data=rows.slice(start,start+limit),next=start+data.length<rows.length?Buffer.from(canonical({v:2,query,snapshot,after:data.at(-1).id})).toString('base64url'):null;
  return {data,meta:{version:'v2',total:rows.length,limit,snapshot,next_cursor:next}};
}
export function productIndex(product){
  const legacy=fundingIndex(product.collections,product.today);
  return {...legacy,status:'live',snapshot:product.snapshot,counts:Object.fromEntries(PRODUCT_COLLECTIONS.map(k=>[k,product.collections[k].length])),endpoints:Object.fromEntries(PRODUCT_COLLECTIONS.map(k=>[k,`/api/v2/${k}`])),filters:{...legacy.filters,...FILTERS},links:{explorer:'/funding',documentation:'/data',openapi:'/api/v2/openapi',exports:'/api/v2/export/{collection}?format=jsonl'},coverage:{...legacy.coverage,organizations:product.collections.orgs.length,field_assertions:product.collections.claims.filter(c=>c.method!=='registry_record').length,legacy_public_facts:product.collections.claims.filter(c=>c.method==='registry_record').length,scope:'The complete current registry plus accepted enrichment. Missing terms, payments, histories and outputs remain unknown. Coverage is not a quality or completeness score.'}};
}
export function fundingOpenAPI(){
  const routes=Object.fromEntries(PRODUCT_COLLECTIONS.flatMap(kind=>[
    [`/api/v2/${kind}`,{get:{operationId:`list_${kind.replaceAll('-','_')}`,summary:`List ${kind}`,parameters:[{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:50}},{name:'cursor',in:'query',schema:{type:'string'}},{name:'q',in:'query',schema:{type:'string',maxLength:300}}],responses:{200:{description:'Public rows and snapshot-bound cursor'},400:{description:'Invalid query'},409:{description:'Snapshot changed; restart scan'},503:{description:'Disabled or untrusted data'}}}}],
    [`/api/v2/${kind}/{id}`,{get:{operationId:`get_${kind.replaceAll('-','_')}`,parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}],responses:{200:{description:'One public record'},404:{description:'Not found'},503:{description:'Data unavailable'}}}}],
  ]));
  routes['/api/v2/export/{collection}']={get:{operationId:'export_collection',parameters:[{name:'collection',in:'path',required:true,schema:{type:'string',enum:PRODUCT_COLLECTIONS}},{name:'format',in:'query',schema:{type:'string',enum:['json','jsonl'],default:'jsonl'}}],responses:{200:{description:'Bounded snapshot export with X-Snapshot-SHA256'},413:{description:'Use cursor pagination for datasets above export limit'},503:{description:'Data unavailable'}}}};
  return {openapi:'3.1.0',info:{title:'grants.watch Funding API',version:'2.0.0',description:'Public read API. Amounts are native quantities, awards are not payments, source checks are not guarantees of complete history. See the root index for resource-specific filters.'},servers:[{url:'https://grants.watch'}],paths:routes,components:{schemas:{ProgramTerms:FUNDING_SCHEMAS['program-terms'],FundingEvent:FUNDING_SCHEMAS['funding-events'],ProcessMetric:FUNDING_SCHEMAS['process-metrics']}}};
}
const response=(body,status=200,extra={})=>new Response(status===204?null:typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Accept, Content-Type','Access-Control-Expose-Headers':'X-Snapshot-SHA256, X-Record-Count','X-Content-Type-Options':'nosniff',...extra}});
/** @param {Request} request @param {string[]} segments @param {{enabled?:boolean,load:()=>{baseline:unknown,dataset:unknown},now?:()=>Date}} deps */
export function handleFundingProductRequest(request,segments,deps){
  // Preserve every original collection contract and fail-closed read behavior.
  const extra=segments.length===0||['openapi','export',...EXTRA_COLLECTIONS].includes(segments[0]);
  if(!extra)return handleFundingRequest(request,segments,deps);
  if(request.method==='OPTIONS')return response(null,204);
  if(!['GET','HEAD'].includes(request.method))return response({error:'method_not_allowed'},405);
  if(!deps.enabled)return response({error:'preview_disabled'},503);
  try{
    if(segments.length>2||segments.some(s=>typeof s!=='string'||s.length>300))throw new ProductQueryError(404,'not_found');
    const params=new URL(request.url).searchParams,at=(deps.now||(()=>new Date()))();
    if(segments[0]==='openapi'){
      if(segments.length!==1||[...params].length)throw new ProductQueryError(400,'invalid_parameter');
      const out=response(fundingOpenAPI());return request.method==='HEAD'?new Response(null,{status:200,headers:out.headers}):out;
    }
    if(segments.length===0&&[...params].length)throw new ProductQueryError(400,'invalid_parameter');
    if(EXTRA_COLLECTIONS.includes(segments[0])){
      if(segments.length===1)queryParams(segments[0],params);
      else if([...params].length)throw new ProductQueryError(400,'invalid_parameter');
    }
    if(segments[0]==='export'&&(segments.length!==2||!PRODUCT_COLLECTIONS.includes(segments[1])||[...params.keys()].some(k=>k!=='format')||params.getAll('format').length>1||!['json','jsonl'].includes(params.get('format')||'jsonl')))throw new ProductQueryError(400,'invalid_export');
    const {baseline,dataset}=deps.load(),product=buildFundingProduct(baseline,dataset,at);let out;
    if(!segments.length)out=response(productIndex(product));
    else if(segments[0]==='export'){
      const rows=product.collections[segments[1]],format=params.get('format')||'jsonl';
      if(rows.length>20000)throw new ProductQueryError(413,'export_limit_use_pagination');
      const body=format==='json'?JSON.stringify({data:rows,meta:{version:'v2',snapshot:sha(rows),total:rows.length}}):rows.map(row=>JSON.stringify(row)).join('\n')+(rows.length?'\n':'');
      if(Buffer.byteLength(body)>16*1024*1024)throw new ProductQueryError(413,'export_limit_use_pagination');
      out=response(body,200,{'Content-Type':format==='jsonl'?'application/x-ndjson; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="grants-watch-${segments[1]}.${format}"`,'X-Snapshot-SHA256':sha(rows),'X-Record-Count':String(rows.length)});
    }else if(segments.length===1)out=response(queryProductCollection(segments[0],params,product));
    else{
      const data=product.collections[segments[0]]?.find(row=>row.id===segments[1]);
      if(!data)throw new ProductQueryError(404,'not_found');out=response({data,meta:{version:'v2'}});
    }
    return request.method==='HEAD'?new Response(null,{status:out.status,headers:out.headers}):out;
  }catch(error){return error instanceof ProductQueryError?response({error:error.message},error.status):response({error:'dataset_unavailable',message:'Funding data could not be validated'},503);}
}
