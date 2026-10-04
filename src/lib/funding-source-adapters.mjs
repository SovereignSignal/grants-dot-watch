// Pure source adapters. No network, credentials, timers, or canonical writes.
import { createHash } from 'node:crypto';

export const ADAPTER_VERSION = '1.0.0';
export const SOURCE_CATALOG = Object.freeze({
  'numfocus-sdg': { url: 'https://numfocus.org/programs/small-development-grants', issuer: 'numfocus', program: 'numfocus-small-development-grants', parser: 'numfocus' },
  'microsoft-foss': { url: 'https://github.com/microsoft/foss-fund/blob/main/README.md', issuer: 'microsoft', program: 'microsoft-foss-fund', parser: 'microsoft' },
  'royal-society-research': { url: 'https://royalsociety.org/grants/research-grants/', issuer: 'royal-society', program: 'royal-society-research-grants', parser: 'royal' },
  'royal-society-urf': { url: 'https://royalsociety.org/grants/university-research/', issuer: 'royal-society', program: 'royal-society-university-research-fellowship', parser: 'royal' },
});
export const stableJSON = value => {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJSON(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const sourceDigest = value => createHash('sha256').update(typeof value === 'string' ? value : stableJSON(value)).digest('hex');
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v;
const check = (ok, code) => { if (!ok) throw new Error(code); };
const slug = v => v.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const text = (v, max=1000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const unique = rows => {
  const keys = new Set();
  for (const row of rows) { check(!keys.has(row.identity), 'duplicate_source_identity'); keys.add(row.identity); }
  return rows;
};

export function validateSourceSnapshot(snapshot, today) {
  const fields = ['version','source_id','source_url','observed_on','provider','representation','scope','body','body_sha256','source_revision'];
  check(plain(snapshot) && Object.keys(snapshot).every(k=>fields.includes(k)), 'invalid_snapshot_envelope');
  check(snapshot.version === 1 && Object.hasOwn(SOURCE_CATALOG,snapshot.source_id), 'unknown_source');
  check(snapshot.source_url === SOURCE_CATALOG[snapshot.source_id].url, 'source_identity_mismatch');
  check(date(today) && date(snapshot.observed_on) && snapshot.observed_on <= today, 'invalid_observation_date');
  check(['github','exa','parallel','web','manual'].includes(snapshot.provider), 'unknown_provider');
  check(['tool_text_excerpt','native_markdown'].includes(snapshot.representation), 'unsupported_representation');
  check(text(snapshot.scope,500) && text(snapshot.body,512*1024) && Buffer.byteLength(snapshot.body)<=512*1024, 'snapshot_size_or_scope');
  check(/^[a-f0-9]{64}$/.test(snapshot.body_sha256) && sourceDigest(snapshot.body)===snapshot.body_sha256, 'snapshot_digest_mismatch');
  check(snapshot.source_revision === null || (snapshot.provider === 'github' && /^[a-f0-9]{40}$/.test(snapshot.source_revision)), 'invalid_source_revision');
  check(!snapshot.body.includes('\u0000'), 'invalid_source_text');
  return snapshot;
}

// Supports the documented pipe-table representation only. Unexpected shape fails
// the complete source; a truncated row cannot silently become a partial success.
function table(body, expected) {
  const lines=body.split(/\r?\n/);
  const split=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(v=>v.trim());
  const matches=lines.map((line,i)=>({line,i})).filter(({line})=>line.includes('|') && stableJSON(split(line))===stableJSON(expected));
  check(matches.length===1,'table_header_missing_or_ambiguous');
  const start=matches[0].i;
  check(lines[start+1] && split(lines[start+1]).length===expected.length && split(lines[start+1]).every(c=>/^:?-{3,}:?$/.test(c)), 'table_separator_invalid');
  const rows=[];
  let ended=false;
  for(let i=start+2;i<lines.length;i++) {
    const line=lines[i];
    if(!line.trim() || !line.includes('|')) {ended=true; break;}
    const cells=split(line);
    check(cells.length===expected.length && cells.every(c=>c && !/[<>]/.test(c)), 'table_row_invalid_or_truncated');
    rows.push({cells,line:i+1});
  }
  check(rows.length>0 && rows.length<=2000,'table_row_budget');
  // The scope names the selected excerpt; EOF is allowed after a complete row.
  return {rows, ended};
}
export function usdDecimal(value) {
  check(/^\$(?:0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)(?:\.\d{2})?$/.test(value),'ambiguous_money');
  return value.slice(1).replaceAll(',','').replace(/\.00$/,'');
}
function numfocus(snapshot) {
  check(snapshot.body.includes('Previously Funded Programs'),'numfocus_section_missing');
  return unique(table(snapshot.body,['Project','Proposal Title','Amount','Year','Round']).rows.map(({cells:[name,title,amount,year,round],line})=>{
    check(/^20\d{2}$/.test(year) && Number(year)<=Number(snapshot.observed_on.slice(0,4)), 'invalid_award_year');
    check(/^(1|2|3|Off-cycle)$/.test(round), 'unknown_round_label');
    check(text(name,300) && slug(name) && text(title,1500),'invalid_award_text');
    const identity=`numfocus:${year}:${round}:${name.toLowerCase()}`;
    return {identity,kind:'award',recipient_name:name,recipient:`numfocus-${slug(name)}`,amount:usdDecimal(amount),currency:'USD',period:`${year} round ${round}`,purpose:title,line,
      held_reason: /,|\s&\s|\s\/\s/.test(name) ? 'joint_beneficiary_needs_review' : null};
  }));
}
function royal(snapshot) {
  check(snapshot.body.includes('Application and offer data') && /does not include upgraded reserves/.test(snapshot.body), 'metric_scope_or_exclusions_missing');
  return unique(table(snapshot.body,['Financial year','Eligible applications','Offers','Success rate']).rows.map(({cells:[period,eligible,offers,percent],line})=>{
    check(/^20\d{2}\/\d{2}$/.test(period) && Number(period.slice(5))===(Number(period.slice(0,4))+1)%100,'invalid_financial_year');
    check(/^\d+$/.test(eligible) && /^\d+$/.test(offers) && /^\d+(?:\.\d)?%$/.test(percent),'invalid_metric_value');
    const denominator=Number(eligible), numerator=Number(offers);
    check(Number.isSafeInteger(denominator) && denominator>0 && Number.isSafeInteger(numerator) && numerator<=denominator,'invalid_metric_counts');
    const places=percent.includes('.')?1:0;
    check((100*numerator/denominator).toFixed(places)===Number(percent.slice(0,-1)).toFixed(places),'published_rate_mismatch');
    return {identity:`${snapshot.source_id}:${period}`,kind:'metric',period,eligible_applications:denominator,offers:numerator,published_percent:percent,exclusions:['upgraded reserves'],line,held_reason:null};
  }));
}
function microsoft(snapshot) {
  check(/Funding recipients/.test(snapshot.body),'microsoft_section_missing');
  const result=[];let fund=null;
  for(const [i,line] of snapshot.body.split(/\r?\n/).entries()) {
    const heading=/^- FOSS Fund #?(\d+) \(([A-Za-z]+) (20\d{2})\)/.exec(line);
    if(heading){fund={number:heading[1],period:`${heading[2]} ${heading[3]}`};continue;}
    if(!line.trim() || /^#/.test(line)) continue;
    if(!fund || !/^\s+-/.test(line)) continue;
    const match=/_\[\[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\)\]/.exec(line);
    // This adapter supports project-repository recipients. Person-only and
    // narrative continuation rounds are not promoted into fictional awards.
    check(match,'unsupported_microsoft_recipient_shape');
    const u=new URL(match[2]), parts=u.pathname.replace(/\/$/,'').split('/').filter(Boolean);
    check(parts.length===2 && !u.search && !u.hash && !['sponsors','orgs','settings'].includes(parts[0]) && parts.every(p=>/^[A-Za-z0-9_.-]+$/.test(p)), 'nonrepository_recipient');
    const project=parts.join('/');
    result.push({identity:`microsoft:foss:${fund.number}:${project.toLowerCase()}`,kind:'award',recipient_name:project,recipient:`github-${slug(project)}`,amount:null,currency:null,period:`Fund ${fund.number} (${fund.period})`,purpose:null,line:i+1,held_reason:null,project_url:`https://github.com/${project}`});
  }
  check(result.length>0 && result.length<=2000,'microsoft_recipient_budget');return unique(result);
}
export function extractSourceSnapshot(snapshot,today) {
  validateSourceSnapshot(snapshot,today);
  const config=SOURCE_CATALOG[snapshot.source_id];
  const observations=({numfocus,royal,microsoft}[config.parser])(snapshot);
  const receipt={source_id:snapshot.source_id,source_url:snapshot.source_url,observed_on:snapshot.observed_on,provider:snapshot.provider,representation:snapshot.representation,scope:snapshot.scope,body_sha256:snapshot.body_sha256,source_revision:snapshot.source_revision,adapter_version:ADAPTER_VERSION,
    original_page_bytes_archived:false,coverage:'supplied_excerpt_only',redistribution:'unassessed',raw_text_publication:false};
  return {receipt,observations};
}

// Same natural identity across provider snapshots is one observation. Different
// values are a review conflict, not a majority vote or a newest-page overwrite.
export function reconcileSourceSnapshots(snapshots,today) {
  check(Array.isArray(snapshots) && snapshots.length>0 && snapshots.length<=50,'snapshot_batch_budget');
  const receipts=[],groups=new Map(),failures=[],scopes=new Map();
  for(const snapshot of snapshots) {
    try {
      const {receipt,observations}=extractSourceSnapshot(snapshot,today); receipts.push(receipt);
      const scopeKey=stableJSON([snapshot.source_id,snapshot.scope]);
      const scope=scopes.get(scopeKey)||[];scope.push({source_id:snapshot.source_id,scope:snapshot.scope,provider:snapshot.provider,body_sha256:snapshot.body_sha256,identities:observations.map(o=>o.identity)});scopes.set(scopeKey,scope);
      for(const observation of observations) {
        const {line,...fact}=observation;
        const key=sourceDigest([snapshot.source_id,observation.identity]);
        const item=groups.get(key)||{id:key,source_id:snapshot.source_id,variants:new Map()};
        const valueHash=sourceDigest(fact), variant=item.variants.get(valueHash)||{fact,evidence:[]};
        variant.evidence.push({source_url:receipt.source_url,body_sha256:receipt.body_sha256,line,provider:receipt.provider,observed_on:receipt.observed_on});
        item.variants.set(valueHash,variant);groups.set(key,item);
      }
    } catch(error) {failures.push({source_id:typeof snapshot?.source_id==='string'?snapshot.source_id:null,error:error.message});}
  }
  const coverage_gaps=[];
  for(const scope of scopes.values()) {const union=new Set(scope.flatMap(s=>s.identities));for(const snapshot of scope){const seen=new Set(snapshot.identities);const missing=[...union].filter(id=>!seen.has(id));if(missing.length)coverage_gaps.push({source_id:snapshot.source_id,scope:snapshot.scope,provider:snapshot.provider,body_sha256:snapshot.body_sha256,missing_observation_ids:missing.map(id=>sourceDigest([snapshot.source_id,id])),reason:'provider_scope_omission',deletion_inferred:false});}}
  const facts=[],held=[];
  for(const item of groups.values()) {
    if(item.variants.size!==1){held.push({id:item.id,source_id:item.source_id,reason:'provider_value_conflict',variants:[...item.variants.values()]});continue;}
    const variant=[...item.variants.values()][0];
    const row={id:item.id,source_id:item.source_id,...variant};
    if(variant.fact.held_reason) held.push({...row,reason:variant.fact.held_reason});else facts.push(row);
  }
  return {version:1,receipts,coverage_gaps,facts:facts.sort((a,b)=>a.id.localeCompare(b.id)),held,failures,counts:{snapshots:snapshots.length,accepted_snapshots:receipts.length,facts:facts.length,held:held.length,failed_sources:failures.length}};
}
