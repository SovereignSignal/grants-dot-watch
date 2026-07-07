#!/usr/bin/env node
// Deterministic transform: seed/awards.json -> registry/awards/<year>.jsonl
// Funder ids come from resolved_orgs (funder_norm match); grantees get stable slugs.
// program stays null until a matching program file exists (post-pass links them).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const awards = JSON.parse(readFileSync(join(ROOT, 'seed', 'awards.json'), 'utf8'));
const resolved = JSON.parse(readFileSync(join(ROOT, 'seed', 'resolved_orgs.json'), 'utf8'));

const byNorm = new Map(resolved.filter((o) => o.funder_norm).map((o) => [o.funder_norm, o]));
const slugify = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const byYear = new Map();
let unresolvedFunders = 0;
for (const a of awards) {
  const funderOrg = byNorm.get(a.funder_norm);
  if (!funderOrg) unresolvedFunders++;
  const year = a.awarded_on ? a.awarded_on.slice(0, 4) : 'undated';
  const row = {
    funder: funderOrg ? funderOrg.slug : slugify(a.funder_name),
    funder_name: a.funder_name,
    grantee: slugify(a.grantee_norm || a.grantee_name),
    grantee_name: a.grantee_name,
    amount: a.amount_value != null ? +a.amount_value : null,
    currency: a.currency || null,
    amount_text: a.amount_text || null,
    date: a.awarded_on || null,
    program: null,
    program_name: a.program_name || null,
    wire: a.wire || null,
    source: a.source_url || a.source || null,
    key: a.dedupe_key,
  };
  if (!byYear.has(year)) byYear.set(year, []);
  byYear.get(year).push(row);
}

mkdirSync(join(ROOT, 'registry', 'awards'), { recursive: true });
let total = 0;
for (const [year, rows] of [...byYear.entries()].sort()) {
  rows.sort((x, y) => (x.date || '').localeCompare(y.date || '') || x.key.localeCompare(y.key));
  writeFileSync(
    join(ROOT, 'registry', 'awards', `${year}.jsonl`),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
  );
  total += rows.length;
  console.log(`${year}: ${rows.length}`);
}
console.log(`total ${total}, funders unresolved to registry orgs: ${unresolvedFunders}`);
