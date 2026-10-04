import { createHash } from 'node:crypto';
import { CAPITAL_FORMS, EVENT_TYPES, FUNDING_SCHEMAS, INSTRUMENTS, LEDGERS, SELECTION_MODELS, canonical, isIsoDate, isPublicUrl, projectRecord, validateFundingDataset } from './funding-model.mjs';

export const COLLECTIONS = ['systems', 'orgs', 'programs', 'rounds', 'awards', 'recipients', ...LEDGERS, 'sources', 'opportunities'];
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value);
const strings = value => Array.isArray(value) ? value.filter(x => typeof x === 'string') : [];
const safeUrl = value => isPublicUrl(value) ? value : null;
const urls = value => strings(value).filter(isPublicUrl);
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = value => typeof value === 'string' ? value : null;
const date = value => isIsoDate(value) ? value : null;
const precisionDate = value => date(value) || (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null);
const collectionUrl = (kind, id) => `/api/v2/${kind}/${encodeURIComponent(id)}`;
export const roundId = (program, name) => `round-${hash([program, name])}`;
export const sourceId = url => `source-${hash(url)}`;

export function calendarDate(at = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(at).map(x => [x.type,x.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export class FundingApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function publicRound(p, r) {
  const id = roundId(p.id,r.name);
  return { id, identity_basis:'legacy_program_and_round_name', program:p.id, org:p.org, name:text(r.name), status:text(r.status), opens:precisionDate(r.opens), closes:precisionDate(r.closes), closes_at:text(r.closes_at), size:text(r.size), source:safeUrl(r.source), api:collectionUrl('rounds',id) };
}
function publicOrg(o) {
  return { id:o.id, name:o.name, aka:strings(o.aka), systems:strings(o.systems), wires:strings(o.wires), roles:strings(o.roles), org_type:text(o.org_type), website:safeUrl(o.website), status:o.status, profile:o.profile, sources:urls(o.sources), href:`/orgs/${o.id}`, api:collectionUrl('orgs',o.id) };
}
function publicProgram(p) {
  return { id:p.id, name:p.name, org:p.org, parent:text(p.parent), systems:strings(p.systems), wires:strings(p.wires), status:p.status, legacy_mechanism:text(p.mechanism), apply_url:safeUrl(p.apply_url), summary:p.summary, sources:urls(p.sources), href:`/programs/${p.id}`, api:collectionUrl('programs',p.id) };
}
function publicAward(a) {
  return { id:a.key, funder:a.funder, funder_name:a.funder_name, recipient:a.grantee, recipient_name:a.grantee_name, program:text(a.program), program_name:text(a.program_name), amount:finite(a.amount), currency:text(a.currency), amount_text:text(a.amount_text), date:date(a.date), wire:text(a.wire), source:safeUrl(a.source), payment_state:'not_established', origin:'legacy_award_ledger', api:collectionUrl('awards',a.key) };
}
function latestTerms(rows, today) {
  // An effective replacement permanently retires its predecessor, even when
  // that replacement later expires. Future replacements do not take effect yet.
  const effective = rows.filter(row => !row.effective_from || row.effective_from <= today);
  const superseded = new Set(effective.map(row => row.supersedes_key).filter(Boolean));
  const current = effective.filter(row => !superseded.has(row.key) && (!row.effective_to || row.effective_to >= today));
  // A new observation does not silently resolve conflicting unlinked revisions.
  return current.length === 1 ? current[0] : null;
}
function exactInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) || !isIsoDate(value.slice(0,10))) return null;
  const time = Date.parse(value); return Number.isFinite(time) ? time : null;
}
function openNow(p, r, terms, today, now) {
  if (p.status !== 'active' || r.status !== 'open') return false;
  if (p.review && (p.review.kind !== 'program' || p.review.relationship !== 'current' || p.review.intake !== 'open')) return false;
  if (!terms || terms.evidence_state !== 'primary_supported' || !['rolling','rounds'].includes(terms.intake_mode)) return false;
  if (terms.selection_models.some(x => ['invitation','internal_selection','donor_directed'].includes(x))) return false;
  const a = terms.access;
  if (!a || a.round_name !== r.name || a.state !== 'open' || a.new_applicants !== true || a.prerequisites_clear !== true || a.checked_on > today || a.review_after < today || !safeUrl(a.route)) return false;
  // New data requires a specific entry-stage assessment. Legacy metadata alone never qualifies.
  if (r.opens && (!isIsoDate(r.opens) || r.opens > today)) return false;
  if (r.closes && (!isIsoDate(r.closes) || r.closes < today)) return false;
  if (r.closes_at) { const close = exactInstant(r.closes_at); if (close === null || close <= now) return false; }
  return true;
}

/** Sidecar records are validated once and projected by an explicit field allowlist. */
export function buildFundingCollections(baseline, dataset, at = new Date()) {
  const today = calendarDate(at);
  if (validateFundingDataset(dataset,baseline,today).length) throw new Error('Funding sidecars are invalid');
  const terms = dataset['program-terms'];
  const result = Object.fromEntries(COLLECTIONS.map(kind => [kind,[]]));
  result.systems = (baseline.systems || []).map(s => ({ id:s.id,name:s.name,kind:s.kind,part_of:strings(s.part_of),wires:strings(s.wires),summary:s.summary,sources:urls(s.sources),api:collectionUrl('systems',s.id) }));
  result.orgs = baseline.orgs.map(publicOrg);
  result.programs = baseline.programs.map(p => {
    const record = publicProgram(p);
    const applicable = latestTerms(terms.filter(t => t.program === p.id && !t.round_name),today);
    const selected = applicable?.evidence_state === 'primary_supported' ? applicable : null;
    return { ...record, current_terms_key:selected?.key || null, instruments:selected?.instruments || null, capital_forms:selected?.capital_forms || null, selection_models:selected?.selection_models || null };
  });
  for (const p of baseline.programs) for (const r of p.rounds || []) {
    result.rounds.push(publicRound(p,r));
    const scoped = terms.filter(t => t.program === p.id && t.round_name === r.name);
    const candidate = latestTerms(scoped.length ? scoped : terms.filter(t => t.program === p.id && !t.round_name),today);
    if (openNow(p,r,candidate,today,at.getTime())) result.opportunities.push({
      id:roundId(p.id,r.name),program:p.id,program_name:p.name,org:p.org,round_name:r.name,
      instruments:candidate.instruments,capital_forms:candidate.capital_forms,selection_models:candidate.selection_models,
      entry_stage:candidate.access.stage,apply_url:candidate.access.route,opens:date(r.opens),closes:date(r.closes),closes_at:text(r.closes_at),
      checked_on:candidate.access.checked_on,source:candidate.access.source,terms_key:candidate.key,
      eligibility:candidate.eligibility == null ? null : strings(candidate.eligibility),
      geography:candidate.geography == null ? null : strings(candidate.geography),
      eligibility_is_personalized:false,api:collectionUrl('opportunities',roundId(p.id,r.name)),href:`/programs/${p.id}`,
    });
  }
  result.awards = (baseline.awards || []).map(publicAward);
  for (const ledger of LEDGERS) result[ledger] = dataset[ledger].map(row => ({ id:row.key, ...projectRecord(FUNDING_SCHEMAS[ledger],row), api:collectionUrl(ledger,row.key) }));
  const recipients = new Map();
  const receive = (id,name,funder,kind,key) => {
    if (!slug(id)) return;
    const entry = recipients.get(id) || { id,name, funders:new Set(), legacy_award_ids:[], funding_event_ids:[] };
    entry.funders.add(funder); entry[kind].push(key); recipients.set(id,entry);
  };
  for (const a of result.awards) receive(a.recipient,a.recipient_name,a.funder,'legacy_award_ids',a.id);
  for (const e of result['funding-events']) receive(e.recipient,e.recipient_name,e.funder,'funding_event_ids',e.id);
  result.recipients = [...recipients.values()].map(r => ({id:r.id,name:r.name,funders:[...r.funders].sort(),legacy_award_count:r.legacy_award_ids.length,funding_event_count:r.funding_event_ids.length,api:collectionUrl('recipients',r.id)}));
  const sources = new Set();
  for (const rows of Object.values(result)) for (const row of rows) {
    for (const url of [...(row.sources || []), row.source, row.access?.source].filter(isPublicUrl)) sources.add(url);
  }
  result.sources = [...sources].map(url => ({id:sourceId(url),url,authority:'not_inferred_from_url',api:collectionUrl('sources',sourceId(url))}));
  for (const kind of COLLECTIONS) {
    result[kind].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (new Set(result[kind].map(x=>x.id)).size !== result[kind].length) throw new Error('Ambiguous public record identity');
  }
  return result;
}

const COMMON = ['limit','cursor','q'];
const FILTERS = {
  systems:['wire'], orgs:['wire','system','status','role'],
  programs:['wire','system','org','status','instrument','capital_form','selection_model'],
  rounds:['program','org','status'], awards:['program','funder','recipient','wire','year'],
  recipients:['funder'], 'program-terms':['program','instrument','capital_form','selection_model'],
  'funding-events':['program','funder','recipient','event_type','capital_form','award_id'],
  'process-metrics':['program','period'], sources:[],
  opportunities:['program','org','instrument','capital_form','selection_model'],
};
const arrayField = {wire:'wires',system:'systems',role:'roles',instrument:'instruments',capital_form:'capital_forms',selection_model:'selection_models'};
function parseQuery(kind,params) {
  const filters = {};
  for (const key of params.keys()) {
    if (!COMMON.includes(key) && !FILTERS[kind].includes(key)) throw new FundingApiError(400,'invalid_parameter','Unsupported query parameter');
    if (params.getAll(key).length !== 1) throw new FundingApiError(400,'invalid_parameter','Duplicate query parameter');
    const value = params.get(key);
    if (!value || value !== value.trim() || value.length > (key === 'cursor' ? 2048 : 300)) throw new FundingApiError(400,'invalid_parameter','Invalid query value');
    if (!['limit','cursor'].includes(key)) filters[key] = value;
  }
  for (const [field, values] of [['instrument',INSTRUMENTS],['capital_form',CAPITAL_FORMS],['selection_model',SELECTION_MODELS],['event_type',EVENT_TYPES],['wire',['ai','crypto','oss']]]) {
    if (filters[field] && !values.includes(filters[field])) throw new FundingApiError(400,'invalid_parameter',`Unsupported ${field}`);
  }
  if (filters.year && !/^\d{4}$/.test(filters.year)) throw new FundingApiError(400,'invalid_parameter','Invalid year');
  const limitText = params.get('limit') || '50';
  if (!/^[1-9]\d?$|^100$/.test(limitText)) throw new FundingApiError(400,'invalid_parameter','Limit must be between 1 and 100');
  return {filters,limit:Number(limitText),cursor:params.get('cursor')};
}
function matches(row, filters) {
  return Object.entries(filters).every(([key,value]) => {
    if (key === 'q') return [row.id,row.name,row.program_name,row.summary,row.recipient_name,row.url].some(x => typeof x === 'string' && x.toLowerCase().includes(value.toLowerCase()));
    if (key === 'year') return typeof row.date === 'string' && row.date.startsWith(`${value}-`);
    if (key === 'funder' && Array.isArray(row.funders)) return row.funders.includes(value);
    const array = row[arrayField[key]];
    if (Array.isArray(array)) return array.includes(value);
    return row[key] === value;
  });
}
function decodeCursor(encoded) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new FundingApiError(400,'invalid_cursor','Malformed cursor');
  let value;
  try { const decoded = Buffer.from(encoded,'base64url').toString('utf8'); if (Buffer.from(decoded).toString('base64url') !== encoded) throw new Error(); value = JSON.parse(decoded); } catch { throw new FundingApiError(400,'invalid_cursor','Malformed cursor'); }
  if (!value || Object.keys(value).sort().join(',') !== 'after,kind,query,snapshot,v' || value.v !== 2 || typeof value.after !== 'string' || value.after.length > 300 || !/^[a-f0-9]{64}$/.test(value.snapshot) || !/^[a-f0-9]{64}$/.test(value.query)) throw new FundingApiError(400,'invalid_cursor','Malformed cursor');
  return value;
}
export function queryFundingCollection(kind,params,collections) {
  if (!COLLECTIONS.includes(kind)) throw new FundingApiError(404,'not_found','Unknown collection');
  const {filters,limit,cursor} = parseQuery(kind,params);
  const rows = collections[kind].filter(row => matches(row,filters));
  const snapshot = hash(rows), query = hash(filters);
  let start = 0;
  if (cursor) {
    const c = decodeCursor(cursor);
    if (c.kind !== kind || c.query !== query) throw new FundingApiError(400,'invalid_cursor','Cursor belongs to another query');
    if (c.snapshot !== snapshot) throw new FundingApiError(409,'snapshot_changed','Data changed; restart the collection scan');
    const position = rows.findIndex(row => row.id === c.after);
    if (position < 0) throw new FundingApiError(400,'invalid_cursor','Cursor record is unavailable');
    start = position + 1;
  }
  const data = rows.slice(start,start+limit);
  const next = start+data.length < rows.length ? Buffer.from(canonical({v:2,kind,query,snapshot,after:data.at(-1).id})).toString('base64url') : null;
  return {data,meta:{version:'v2',total:rows.length,limit,snapshot,next_cursor:next}};
}
export function fundingIndex(collections,today) {
  return {name:'grants.watch',version:'v2',status:'preview',as_of:today,counts:Object.fromEntries(COLLECTIONS.map(k=>[k,collections[k].length])),endpoints:Object.fromEntries(COLLECTIONS.map(k=>[k,`/api/v2/${k}`])),filters:FILTERS,
    coverage:{programs:collections.programs.length,terms_records:collections['program-terms'].length,actionable_rounds:collections.opportunities.length,interpretation:'Missing enrichment means unknown, not no funding. Legacy awards do not establish payment. Funding events must not be summed across lifecycle states.'}};
}
function response(body,status=200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Accept, Content-Type','X-Content-Type-Options':'nosniff'} });
}
/**
 * Dependency-injected handler keeps API tests away from production databases.
 * Loader snapshots are untrusted until the runtime validators have checked them.
 * @param {Request} request
 * @param {string[]} segments
 * @param {{enabled?: boolean, load?: () => {baseline: unknown, dataset: unknown}, now?: () => Date}} [options]
 */
export function handleFundingRequest(request,segments,{enabled=false,load,now=()=>new Date()}={}) {
  if (request.method === 'OPTIONS') return response(null,204);
  if (!['GET','HEAD'].includes(request.method)) return response({error:'method_not_allowed'},405);
  if (!enabled) return response({error:'preview_disabled'},503);
  try {
    if (!Array.isArray(segments) || segments.length > 2 || segments.some(s=>typeof s!=='string' || s.length>300)) throw new FundingApiError(404,'not_found','Unknown endpoint');
    if (segments.length && !COLLECTIONS.includes(segments[0])) throw new FundingApiError(404,'not_found','Unknown collection');
    const params = new URL(request.url).searchParams;
    if (segments.length !== 1 && [...params.keys()].length) throw new FundingApiError(400,'invalid_parameter','This endpoint does not accept query parameters');
    // Parameter errors do not touch the data source.
    if (segments.length === 1) parseQuery(segments[0],params);
    const at = now(), {baseline,dataset} = load();
    const collections = buildFundingCollections(baseline,dataset,at);
    let body;
    if (!segments.length) body = fundingIndex(collections,calendarDate(at));
    else if (segments.length === 1) body = queryFundingCollection(segments[0],params,collections);
    else {
      const data = collections[segments[0]].find(row=>row.id===segments[1]);
      if (!data) throw new FundingApiError(404,'not_found','Record not found');
      body = {data,meta:{version:'v2'}};
    }
    const result = response(body);
    return request.method === 'HEAD' ? new Response(null,{status:result.status,headers:result.headers}) : result;
  } catch (error) {
    if (error instanceof FundingApiError) return response({error:error.code,message:error.message},error.status);
    return response({error:'dataset_unavailable',message:'Funding data failed validation or could not be read'},503);
  }
}
