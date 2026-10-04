// Shared, dependency-free contract for v2 sidecars, staging and public projections.
// Legacy YAML, award ledgers, enums and the v1 loader remain unchanged.
export const INSTRUMENTS = ['grant', 'prize', 'fellowship', 'sponsorship', 'investment', 'convertible', 'loan', 'contract', 'cooperative_agreement', 'subsidy', 'purchase', 'other'];
export const CAPITAL_FORMS = ['cash', 'token', 'equity', 'convertible', 'api_credit', 'cloud_credit', 'compute', 'service', 'liquidity_incentive', 'in_kind'];
export const ALLOCATION_METHODS = ['staff_review', 'committee', 'peer_review', 'governance', 'quadratic', 'retroactive', 'performance', 'donor_directed', 'internal_selection', 'competition', 'other'];
export const SELECTION_MODELS = ['application', 'nomination', 'invitation', 'governance', 'performance', 'competition', 'donor_directed', 'internal_selection', 'other'];
export const EVENT_TYPES = ['recommended', 'approved', 'awarded', 'contracted', 'paid', 'withdrawn', 'challenged', 'rejected', 'refunded', 'clawed_back'];
export const EVIDENCE_STATES = ['primary_supported', 'recipient_reported', 'disputed', 'unknown'];
export const LEDGERS = ['program-terms', 'funding-events', 'process-metrics'];
const str = (maxLength = 2000) => ({ type: 'string', minLength: 1, maxLength });
const enumeration = (values) => ({ type: 'string', enum: values });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const array = (items, minItems = 0) => ({ type: 'array', items, minItems, maxItems: 100 });
const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const id = { ...str(180), pattern: '^[a-z0-9][a-z0-9:._-]*$' };
const slug = { ...str(180), pattern: '^[a-z0-9][a-z0-9-]*$' };
const date = { type: 'string', format: 'date' };
const url = { ...str(2048), format: 'public-url' };
const decimal = { ...str(64), pattern: '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' };
const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const textList = array(str());
const evidence = {
  source: url,
  checked_on: date,
  evidence_state: enumeration(EVIDENCE_STATES),
  // Paraphrased support for these facts; never an instruction for an importer.
  evidence_note: str(4000),
};
const requiredEvidence = ['source', 'checked_on', 'evidence_state', 'evidence_note'];
export const MONEY_SCHEMA = object({
  amount: nullable(decimal),
  currency: nullable({ ...str(24), pattern: '^[A-Z][A-Z0-9._-]*$' }),
  unit: str(80),
  qualifier: enumeration(['exact', 'up_to', 'approximate', 'not_disclosed']),
  amount_text: nullable(str()),
}, ['amount', 'currency', 'unit', 'qualifier']);
const resource = object({
  kind: enumeration(CAPITAL_FORMS),
  value: MONEY_SCHEMA,
  restrictions: textList,
}, ['kind', 'value', 'restrictions']);
const access = object({
  round_name: str(300),
  stage: str(300),
  state: enumeration(['open', 'closed', 'unknown']),
  new_applicants: nullable({ type: 'boolean' }),
  prerequisites_clear: nullable({ type: 'boolean' }),
  route: url,
  checked_on: date,
  review_after: date,
  source: url,
}, ['round_name', 'stage', 'state', 'new_applicants', 'prerequisites_clear', 'route', 'checked_on', 'review_after', 'source']);
export const TERMS_SCHEMA = object({
  key: id, program: slug, round_name: nullable(str(300)), ...evidence,
  effective_from: nullable(date), effective_to: nullable(date), supersedes_key: nullable(id),
  instruments: array(enumeration(INSTRUMENTS), 1),
  allocation_methods: array(enumeration(ALLOCATION_METHODS)),
  capital_forms: array(enumeration(CAPITAL_FORMS)),
  selection_models: array(enumeration(SELECTION_MODELS)),
  intake_mode: enumeration(['rolling', 'rounds', 'nomination', 'no_unsolicited', 'closed', 'unknown']),
  operator_org: nullable(slug), capital_source_orgs: array(slug), disburser_org: nullable(slug),
  resources: array(resource), budget: nullable(MONEY_SCHEMA),
  eligibility: textList, geography: textList, requirements: textList,
  reporting_requirements: textList, access: nullable(access),
}, ['key', 'program', ...requiredEvidence, 'instruments', 'allocation_methods', 'capital_forms', 'selection_models', 'intake_mode', 'resources']);
export const EVENT_SCHEMA = object({
  key: id, award_id: id, event_type: enumeration(EVENT_TYPES), ...evidence,
  funder: slug, recipient: slug, recipient_name: str(300),
  program: nullable(slug), round_name: nullable(str(300)),
  amount: MONEY_SCHEMA, capital_form: enumeration(CAPITAL_FORMS),
  occurred_on: nullable(date), announced_on: nullable(date),
  award_period: nullable({ ...str(80) }), payment_date: nullable(date),
  milestone: nullable(str(300)), tranche: nullable(str(300)), conditions: textList,
  legacy_award_key: nullable(str(300)), supersedes_key: nullable(id),
}, ['key', 'award_id', 'event_type', ...requiredEvidence, 'funder', 'recipient', 'recipient_name', 'program', 'amount', 'capital_form', 'occurred_on', 'announced_on', 'payment_date']);
export const METRIC_SCHEMA = object({
  key: id, program: slug, round_name: nullable(str(300)), period: str(100), ...evidence,
  counting_unit: enumeration(['applications', 'applicants', 'projects']),
  applications: nullable(count), eligible_applications: nullable(count), shortlisted: nullable(count),
  offers: nullable(count), accepted: nullable(count), funded: nullable(count),
  exclusions: textList,
}, ['key', 'program', 'period', ...requiredEvidence, 'counting_unit', 'exclusions']);
export const FUNDING_SCHEMAS = { 'program-terms': TERMS_SCHEMA, 'funding-events': EVENT_SCHEMA, 'process-metrics': METRIC_SCHEMA };

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function isPublicUrl(value) {
  if (typeof value !== 'string' || /\s/.test(value)) return false;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || !host.includes('.')) return false;
    if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || /:(?:[0-9a-f]*:)?/i.test(host) || /\.(local|internal|localhost)$/.test(host)) return false;
    return ![...u.searchParams.keys()].some(k => /^(token|access_token|api[_-]?key|authorization|secret|signature|x-amz-.*)$/i.test(k));
  } catch { return false; }
}

// Implements only the schema keywords used above. This is also the publication allowlist.
export function schemaErrors(schema, value, path = '$') {
  if (schema.anyOf) return schema.anyOf.some(s => schemaErrors(s, value, path).length === 0) ? [] : [`${path}: invalid nullable value`];
  const errors = [];
  const fail = (reason) => errors.push(`${path}: ${reason}`);
  if (schema.type === 'null') { if (value !== null) fail('must be null'); return errors; }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: must be an object`];
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) errors.push(`${path}: unsupported field`);
      else errors.push(...schemaErrors(schema.properties[key], value[key], `${path}.${key}`));
    }
    return errors;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: must be an array`];
    if (value.length < schema.minItems || value.length > schema.maxItems) fail('invalid item count');
    value.forEach((item, i) => errors.push(...schemaErrors(schema.items, item, `${path}[${i}]`)));
    return errors;
  }
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) fail('must be a nonnegative safe integer');
    return errors;
  }
  if (typeof value !== schema.type) return [`${path}: wrong type`];
  if (schema.type === 'string') {
    if (!value.trim() || value.length < (schema.minLength || 0) || value.length > (schema.maxLength || Infinity)) fail('invalid string length');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('invalid format');
    if (schema.format === 'date' && !isIsoDate(value)) fail('invalid calendar date');
    if (schema.format === 'public-url' && !isPublicUrl(value)) fail('requires a public HTTP URL without credentials');
  }
  if (schema.enum && !schema.enum.includes(value)) fail('unsupported enum value');
  return errors;
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function projectRecord(schema, value) {
  if (value == null) return null;
  if (schema.anyOf) return projectRecord(schema.anyOf.find(s => s.type !== 'null'), value);
  if (schema.type === 'array') return Array.isArray(value) ? value.map(x => projectRecord(schema.items, x)) : [];
  if (schema.type !== 'object') return value;
  return Object.fromEntries(Object.keys(schema.properties).map(k => [k, Object.hasOwn(value, k) ? projectRecord(schema.properties[k], value[k]) : null]));
}

/** Validate a whole candidate snapshot before publishing or staging any row. */
export function validateFundingDataset(dataset, baseline, today) {
  const errors = [];
  const orgs = new Set(baseline.orgs.map(o => o.id));
  const programs = new Map(baseline.programs.map(p => [p.id, p]));
  const legacyAwards = new Map((baseline.awards || []).map(a => [a.key, a]));
  const keys = new Map();
  const byAward = new Map();
  for (const ledger of LEDGERS) {
    const rows = dataset[ledger];
    if (!Array.isArray(rows)) { errors.push(`${ledger}: must be an array`); continue; }
    for (const row of rows) {
      const loc = `${ledger}:${typeof row?.key === 'string' ? row.key : 'invalid-row'}`;
      const shape = schemaErrors(FUNDING_SCHEMAS[ledger], row, loc);
      errors.push(...shape);
      if (shape.length) continue;
      const scopedKey = `${ledger}:${row.key}`;
      if (keys.has(scopedKey)) errors.push(`${loc}: duplicate key`);
      keys.set(scopedKey, row);
      if (row.checked_on > today) errors.push(`${loc}: future check date`);
      if (row.program && !programs.has(row.program)) errors.push(`${loc}: missing program reference`);
      for (const org of [row.funder, row.operator_org, row.disburser_org, ...(row.capital_source_orgs || [])].filter(Boolean)) if (!orgs.has(org)) errors.push(`${loc}: missing organization reference`);
      const roundName = row.round_name || row.access?.round_name;
      if (roundName && (!row.program || !programs.get(row.program)?.rounds?.some(r => r.name === roundName))) errors.push(`${loc}: unknown scoped round`);
      if (row.effective_from && row.effective_to && row.effective_from > row.effective_to) errors.push(`${loc}: invalid validity interval`);
      if (row.round_name && row.access && row.round_name !== row.access.round_name) errors.push(`${loc}: access must match the scoped round`);
      if (row.access && (row.access.checked_on > row.checked_on || row.access.review_after < row.access.checked_on)) errors.push(`${loc}: invalid access review dates`);
      if (row.access?.state === 'open' && (row.access.new_applicants !== true || row.access.prerequisites_clear !== true || row.evidence_state !== 'primary_supported')) errors.push(`${loc}: open access needs supported entry and prerequisite checks`);
      const moneyValues = [row.amount, row.budget, ...(row.resources || []).map(r => r.value)].filter(Boolean);
      for (const money of moneyValues) {
        if (money.amount !== null && money.qualifier === 'not_disclosed') errors.push(`${loc}: undisclosed amount must remain null`);
        if (money.amount === null && money.qualifier !== 'not_disclosed') errors.push(`${loc}: stated amount required`);
        if (money.unit === 'currency' && money.amount !== null && !money.currency) errors.push(`${loc}: monetary amount needs a currency`);
      }
      if (ledger === 'funding-events') {
        const payment = ['paid', 'refunded', 'clawed_back'].includes(row.event_type);
        if (payment && !row.payment_date) errors.push(`${loc}: payment event requires payment_date`);
        if (!payment && row.payment_date) errors.push(`${loc}: non-payment cannot claim payment_date`);
        for (const field of ['occurred_on', 'announced_on', 'payment_date']) if (row[field] && row[field] > row.checked_on) errors.push(`${loc}: future event date`);
        if (row.payment_date && row.occurred_on && row.payment_date !== row.occurred_on) errors.push(`${loc}: payment date must match occurrence`);
        const identity = canonical([row.funder, row.recipient, row.program]);
        if (byAward.has(row.award_id) && byAward.get(row.award_id) !== identity) errors.push(`${loc}: award identity conflict`);
        byAward.set(row.award_id, identity);
        if (row.legacy_award_key) {
          const a = legacyAwards.get(row.legacy_award_key);
          if (!a || a.funder !== row.funder || a.grantee !== row.recipient || a.program !== row.program) errors.push(`${loc}: legacy award mapping mismatch`);
        }
      }
      if (ledger === 'process-metrics') {
        if (!['applications', 'eligible_applications', 'shortlisted', 'offers', 'accepted', 'funded'].some(k => row[k] != null)) errors.push(`${loc}: no measured counts`);
        for (const [small, large] of [['eligible_applications','applications'], ['shortlisted','eligible_applications'], ['offers','eligible_applications'], ['accepted','offers']]) if (row[small] != null && row[large] != null && row[small] > row[large]) errors.push(`${loc}: incompatible cohort counts`);
      }
    }
  }
  for (const [scopedKey, row] of keys) {
    if (!row.supersedes_key) continue;
    const ledger = scopedKey.slice(0, scopedKey.indexOf(':'));
    const old = keys.get(`${ledger}:${row.supersedes_key}`);
    if (!old || old === row || old.program !== row.program || (old.round_name || null) !== (row.round_name || null) || old.checked_on > row.checked_on || (row.award_id && old.award_id !== row.award_id)) errors.push(`${scopedKey}: invalid supersession reference`);
    const seen = new Set([row.key]);
    let prior = row;
    while (prior?.supersedes_key) {
      if (seen.has(prior.supersedes_key)) { errors.push(`${scopedKey}: supersession cycle`); break; }
      seen.add(prior.supersedes_key);
      prior = keys.get(`${ledger}:${prior.supersedes_key}`);
    }
  }
  return errors;
}
