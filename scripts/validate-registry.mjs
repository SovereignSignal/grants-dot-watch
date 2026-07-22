#!/usr/bin/env node
// Validate every file in registry/ against SCHEMA.md rules.
// Exits 1 with a findings list on any violation. Also enforces the private-data membrane.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'registry');
const errs = [];
const err = (f, m) => errs.push(`${f}: ${m}`);
const PRODUCT_TIME_ZONE = 'America/Los_Angeles';
const calendarDateIn = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const todayISO = process.env.VALIDATION_TODAY || calendarDateIn(new Date(), PRODUCT_TIME_ZONE);

const WIRES = new Set(['crypto', 'ai', 'oss']);
const ORG_ROLES = new Set(['funder', 'grantee', 'ecosystem']);
const ORG_TYPES = new Set(['foundation', 'dao', 'company', 'nonprofit', 'government', 'education']);
const ORG_STATUS = new Set(['active', 'winding-down', 'dormant', 'dead', 'unknown']);
const PROG_STATUS = new Set(['active', 'paused', 'concluded', 'announced', 'unknown']);
const MECHANISMS = new Set(['grants', 'retro', 'quadratic', 'prize', 'fellowship', 'incubator', 'rfp', 'other']);
const ROUND_STATUS = new Set(['announced', 'open', 'reviewing', 'closed', 'deployed']);
const SYSTEM_KINDS = new Set(['protocol-ecosystem', 'funding-domain']);
// Membrane: private/BD vocabulary that must never appear as a key or in prose
const FORBIDDEN = /relationship_context|propensity|current_wedge|recommended_action|operator_read|watch_priority|bd[_ ]target|quality[_ ]score/i;

const loadDir = (sub) => {
  const dir = join(ROOT, sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => {
      const raw = readFileSync(join(dir, f), 'utf8');
      if (FORBIDDEN.test(raw)) err(`${sub}/${f}`, 'membrane violation: private/BD vocabulary present');
      let doc = null;
      try {
        doc = YAML.parse(raw);
      } catch (e) {
        err(`${sub}/${f}`, `yaml parse: ${e.message.split('\n')[0]}`);
      }
      return { file: `${sub}/${f}`, base: basename(f, '.yaml'), doc };
    })
    .filter((x) => x.doc);
};

const isUrl = (u) => {
  if (typeof u !== 'string' || /\s/.test(u)) return false;
  try {
    const parsed = new URL(u);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch {
    return false;
  }
};
const badSlug = (s) => typeof s !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s);
const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const isIsoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const isRoundDate = (value) =>
  isIsoDate(value) ||
  (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const validateName = (file, value, label) => {
  if (typeof value !== 'string' || !value.trim()) return err(file, `missing ${label} name`);
  if (value !== value.trim() || /[\r\n\t]/.test(value)) err(file, `${label} name has surrounding/control whitespace`);
  if (/https?:\/\//i.test(value)) err(file, `${label} name contains a URL`);
};

function reportDuplicateIds(entries, label) {
  const seen = new Map();
  for (const entry of entries) {
    const id = entry.doc.id;
    if (!id) continue;
    if (seen.has(id)) err(entry.file, `duplicate ${label} id "${id}" (first seen at ${seen.get(id)})`);
    else seen.set(id, entry.file);
  }
}

function reportCycles(entries, relation, label) {
  const byId = new Map(entries.map((entry) => [entry.doc.id, entry]));
  const visiting = new Set();
  const visited = new Set();
  const walk = (id, path) => {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(Math.max(0, cycleStart)), id];
      err(byId.get(id)?.file || label, `${label} cycle: ${cycle.join(' -> ')}`);
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    const related = relation(byId.get(id).doc);
    const nextIds = Array.isArray(related) ? related.filter(Boolean) : [];
    for (const next of nextIds) walk(next, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) walk(id, []);
}

const systems = loadDir('systems');
const orgs = loadDir('orgs');
const programs = loadDir('programs');
const systemIds = new Set(systems.map((s) => s.doc.id));
const orgIds = new Set(orgs.map((o) => o.doc.id));
const programIds = new Set(programs.map((p) => p.doc.id));
const programById = new Map(programs.map((p) => [p.doc.id, p.doc]));

reportDuplicateIds(systems, 'system');
reportDuplicateIds(orgs, 'org');
reportDuplicateIds(programs, 'program');
reportCycles(systems, (doc) => doc.part_of || [], 'system parent');
reportCycles(programs, (doc) => (doc.parent ? [doc.parent] : []), 'program parent');

for (const { file, base, doc } of systems) {
  if (doc.id !== base) err(file, `id "${doc.id}" != filename`);
  if (badSlug(doc.id)) err(file, 'bad id slug');
  validateName(file, doc.name, 'system');
  if (!SYSTEM_KINDS.has(doc.kind)) err(file, `bad kind "${doc.kind}"`);
  if (!doc.summary || doc.summary.length < 40) err(file, 'summary missing/too thin');
  for (const p of doc.part_of || []) if (!systemIds.has(p)) err(file, `part_of "${p}" not a system`);
  for (const w of doc.wires || []) if (!WIRES.has(w)) err(file, `bad wire "${w}"`);
  for (const p of doc.funding_channels || []) if (!programIds.has(p)) err(file, `funding channel "${p}" not in programs/`);
  for (const u of doc.sources || []) if (!isUrl(u)) err(file, `bad source url "${u}"`);
}

for (const { file, base, doc } of orgs) {
  if (doc.id !== base) err(file, `id "${doc.id}" != filename`);
  if (badSlug(doc.id)) err(file, 'bad id slug');
  validateName(file, doc.name, 'org');
  for (const s of doc.systems || []) if (!systemIds.has(s)) err(file, `system "${s}" not in systems/`);
  for (const w of doc.wires || []) if (!WIRES.has(w)) err(file, `bad wire "${w}"`);
  if (!Array.isArray(doc.roles) || !doc.roles.length || doc.roles.some((r) => !ORG_ROLES.has(r)))
    err(file, `bad roles ${JSON.stringify(doc.roles)}`);
  if (doc.org_type && !ORG_TYPES.has(doc.org_type)) err(file, `bad org_type "${doc.org_type}"`);
  if (doc.website && !isUrl(doc.website)) err(file, `bad website "${doc.website}"`);
  for (const [network, url] of Object.entries(doc.socials || {})) if (!isUrl(url)) err(file, `bad social url for "${network}"`);
  if (doc.funding?.apply_url && !isUrl(doc.funding.apply_url)) err(file, `bad funding apply_url "${doc.funding.apply_url}"`);
  if (!ORG_STATUS.has(doc.status)) err(file, `bad status "${doc.status}"`);
  if (!doc.profile || doc.profile.trim().length < 60) err(file, 'profile missing/too thin');
  if (doc.roles?.includes('funder') && !(doc.sources || []).length) err(file, 'funder org needs sources');
  for (const u of doc.sources || []) if (!isUrl(u)) err(file, `bad source url "${u}"`);
}

const programNamesByOrg = new Map();
for (const { file, base, doc } of programs) {
  if (doc.id !== base) err(file, `id "${doc.id}" != filename`);
  if (badSlug(doc.id)) err(file, 'bad id slug');
  validateName(file, doc.name, 'program');
  if (!orgIds.has(doc.org)) err(file, `org "${doc.org}" not in orgs/`);
  if (doc.parent && !programs.some((p) => p.doc.id === doc.parent)) err(file, `parent "${doc.parent}" missing`);
  for (const s of doc.systems || []) if (!systemIds.has(s)) err(file, `system "${s}" not in systems/`);
  for (const w of doc.wires || []) if (!WIRES.has(w)) err(file, `bad wire "${w}"`);
  if (!PROG_STATUS.has(doc.status)) err(file, `bad status "${doc.status}"`);
  if (doc.mechanism && !MECHANISMS.has(doc.mechanism)) err(file, `bad mechanism "${doc.mechanism}"`);
  if (doc.apply_url && !isUrl(doc.apply_url)) err(file, `bad apply_url "${doc.apply_url}"`);
  for (const u of doc.sources || []) if (!isUrl(u)) err(file, `bad source url "${u}"`);
  if (!doc.summary || doc.summary.trim().length < 40) err(file, 'summary missing/too thin');
  const nameKey = `${doc.org}:${norm(doc.name)}`;
  if (programNamesByOrg.has(nameKey)) err(file, `duplicate normalized program name for org (first seen at ${programNamesByOrg.get(nameKey)})`);
  else programNamesByOrg.set(nameKey, file);
  let hasLiveRound = false;
  const rounds = doc.rounds == null ? [] : Array.isArray(doc.rounds) ? doc.rounds : (err(file, 'rounds must be an array'), []);
  for (const r of rounds) {
    if (!r.name) err(file, 'round missing name');
    if (!ROUND_STATUS.has(r.status)) err(file, `round "${r.name}" bad status "${r.status}"`);
    if (r.source && !isUrl(r.source)) err(file, `round "${r.name}" bad source`);
    if (r.opens && !isRoundDate(r.opens)) err(file, `round "${r.name}" bad opens date "${r.opens}"`);
    if (r.closes && !isRoundDate(r.closes)) err(file, `round "${r.name}" bad closes date "${r.closes}"`);
    if (/^rolling$/i.test(r.name || '') && r.closes)
      err(file, `round "${r.name}" has a fixed close date; use a sourced call or cohort name`);
    if (isRoundDate(r.opens) && isRoundDate(r.closes) && r.opens > r.closes)
      err(file, `round "${r.name}" opens after it closes`);
    const live = r.status === 'open' || r.status === 'announced';
    if (live) hasLiveRound = true;
    const closeUpperBound = isIsoDate(r.closes) ? r.closes : isRoundDate(r.closes) ? `${r.closes}-31` : null;
    if (live && closeUpperBound && closeUpperBound < todayISO)
      err(file, `round "${r.name}" is ${r.status} with past close ${r.closes}`);
  }
  if (doc.status === 'concluded' && hasLiveRound) err(file, 'concluded program has an open or announced round');
}

// awards jsonl
const awardsDir = join(ROOT, 'awards');
if (existsSync(awardsDir)) {
  const keyLocations = new Map(); // key -> "file:line" of first sighting, for cross-file dup detection
  for (const f of readdirSync(awardsDir).filter((f) => f.endsWith('.jsonl'))) {
    const fileYear = basename(f, '.jsonl');
    const lines = readFileSync(join(awardsDir, f), 'utf8').split('\n').filter(Boolean);
    lines.forEach((line, i) => {
      let a;
      try {
        a = JSON.parse(line);
      } catch {
        return err(`awards/${f}:${i + 1}`, 'bad json line');
      }
      const loc = `awards/${f}:${i + 1}`;
      if (!a.funder || !a.funder_name || !a.grantee || !a.grantee_name || !a.key)
        err(loc, 'missing funder/funder_name/grantee/grantee_name/key');
      if (a.funder && !orgIds.has(a.funder)) err(loc, `funder "${a.funder}" not in orgs/`);
      if (a.grantee && badSlug(a.grantee)) err(loc, `bad grantee slug "${a.grantee}"`);
      if (a.program && !programIds.has(a.program)) err(loc, `program "${a.program}" not in programs/`);
      if (a.program && programById.get(a.program)?.org !== a.funder)
        err(loc, `program "${a.program}" does not belong to funder "${a.funder}"`);
      if (a.wire != null && !WIRES.has(a.wire)) err(loc, `bad wire "${a.wire}"`);
      if (a.source != null && !isUrl(a.source)) err(loc, `bad source url "${a.source}"`);
      if (a.date != null && !isIsoDate(a.date)) err(loc, `bad date "${a.date}"`);
      if (isIsoDate(a.date) && /^\d{4}$/.test(fileYear) && !a.date.startsWith(`${fileYear}-`))
        err(loc, `date ${a.date} does not match awards/${f}`);
      if (a.amount != null && (typeof a.amount !== 'number' || !Number.isFinite(a.amount) || a.amount < 0))
        err(loc, `bad amount ${JSON.stringify(a.amount)}`);
      if (a.key) {
        if (keyLocations.has(a.key)) err(loc, `duplicate key ${a.key} (first seen at ${keyLocations.get(a.key)})`);
        else keyLocations.set(a.key, loc);
      }
    });
  }
}

if (errs.length) {
  console.error(errs.slice(0, 60).join('\n'));
  if (errs.length > 60) console.error(`...and ${errs.length - 60} more`);
  console.error(`\nFAIL: ${errs.length} problems across ${systems.length} systems, ${orgs.length} orgs, ${programs.length} programs`);
  process.exit(1);
}
console.log(`OK: ${systems.length} systems, ${orgs.length} orgs, ${programs.length} programs validated`);
