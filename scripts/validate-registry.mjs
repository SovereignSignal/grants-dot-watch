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

const WIRES = new Set(['crypto', 'ai', 'oss']);
const ORG_ROLES = new Set(['funder', 'grantee', 'ecosystem']);
const ORG_TYPES = new Set(['foundation', 'dao', 'company', 'nonprofit', 'government', 'education']);
const ORG_STATUS = new Set(['active', 'winding-down', 'dormant', 'unknown']);
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

const isUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u);
const badSlug = (s) => typeof s !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s);

const systems = loadDir('systems');
const orgs = loadDir('orgs');
const programs = loadDir('programs');
const systemIds = new Set(systems.map((s) => s.doc.id));
const orgIds = new Set(orgs.map((o) => o.doc.id));

for (const { file, base, doc } of systems) {
  if (doc.id !== base) err(file, `id "${doc.id}" != filename`);
  if (badSlug(doc.id)) err(file, 'bad id slug');
  if (!doc.name) err(file, 'missing name');
  if (!SYSTEM_KINDS.has(doc.kind)) err(file, `bad kind "${doc.kind}"`);
  if (!doc.summary || doc.summary.length < 40) err(file, 'summary missing/too thin');
  for (const p of doc.part_of || []) if (!systemIds.has(p)) err(file, `part_of "${p}" not a system`);
  for (const w of doc.wires || []) if (!WIRES.has(w)) err(file, `bad wire "${w}"`);
}

for (const { file, base, doc } of orgs) {
  if (doc.id !== base) err(file, `id "${doc.id}" != filename`);
  if (badSlug(doc.id)) err(file, 'bad id slug');
  if (!doc.name) err(file, 'missing name');
  for (const s of doc.systems || []) if (!systemIds.has(s)) err(file, `system "${s}" not in systems/`);
  for (const w of doc.wires || []) if (!WIRES.has(w)) err(file, `bad wire "${w}"`);
  if (!Array.isArray(doc.roles) || !doc.roles.length || doc.roles.some((r) => !ORG_ROLES.has(r)))
    err(file, `bad roles ${JSON.stringify(doc.roles)}`);
  if (doc.org_type && !ORG_TYPES.has(doc.org_type)) err(file, `bad org_type "${doc.org_type}"`);
  if (doc.website && !isUrl(doc.website)) err(file, `bad website "${doc.website}"`);
  if (!ORG_STATUS.has(doc.status)) err(file, `bad status "${doc.status}"`);
  if (!doc.profile || doc.profile.trim().length < 60) err(file, 'profile missing/too thin');
  if (doc.roles.includes('funder') && !(doc.sources || []).length) err(file, 'funder org needs sources');
  for (const u of doc.sources || []) if (!isUrl(u)) err(file, `bad source url "${u}"`);
}

for (const { file, base, doc } of programs) {
  if (doc.id !== base) err(file, `id "${doc.id}" != filename`);
  if (badSlug(doc.id)) err(file, 'bad id slug');
  if (!doc.name) err(file, 'missing name');
  if (!orgIds.has(doc.org)) err(file, `org "${doc.org}" not in orgs/`);
  if (doc.parent && !programs.some((p) => p.doc.id === doc.parent)) err(file, `parent "${doc.parent}" missing`);
  for (const s of doc.systems || []) if (!systemIds.has(s)) err(file, `system "${s}" not in systems/`);
  if (!PROG_STATUS.has(doc.status)) err(file, `bad status "${doc.status}"`);
  if (doc.mechanism && !MECHANISMS.has(doc.mechanism)) err(file, `bad mechanism "${doc.mechanism}"`);
  if (!doc.summary || doc.summary.trim().length < 40) err(file, 'summary missing/too thin');
  for (const r of doc.rounds || []) {
    if (!r.name) err(file, 'round missing name');
    if (!ROUND_STATUS.has(r.status)) err(file, `round "${r.name}" bad status "${r.status}"`);
    if (r.source && !isUrl(r.source)) err(file, `round "${r.name}" bad source`);
  }
}

// awards jsonl
const awardsDir = join(ROOT, 'awards');
if (existsSync(awardsDir)) {
  for (const f of readdirSync(awardsDir).filter((f) => f.endsWith('.jsonl'))) {
    const lines = readFileSync(join(awardsDir, f), 'utf8').split('\n').filter(Boolean);
    const keys = new Set();
    lines.forEach((line, i) => {
      let a;
      try {
        a = JSON.parse(line);
      } catch {
        return err(`awards/${f}:${i + 1}`, 'bad json line');
      }
      if (!a.funder || !a.grantee_name || !a.key) err(`awards/${f}:${i + 1}`, 'missing funder/grantee_name/key');
      if (keys.has(a.key)) err(`awards/${f}:${i + 1}`, `duplicate key ${a.key}`);
      keys.add(a.key);
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
