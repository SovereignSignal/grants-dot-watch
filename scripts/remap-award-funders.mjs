#!/usr/bin/env node
// One-time, deterministic repair: remap award rows whose `funder` slug has no
// matching file in registry/orgs onto the canonical org that actually issued
// the award. The old slug is almost always a program/round/fund name that got
// slugified as if it were the funder during seeding (see build-awards.mjs).
//
// registry/ stays the canonical dataset — this script only rewrites the
// `funder` (and, when blank, `program_name`) fields on existing award rows.
// It never touches registry/orgs, never invents facts, and preserves
// `key`, `source`, and every other field untouched.
//
// Run: node scripts/remap-award-funders.mjs

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORGS_DIR = join(ROOT, 'registry', 'orgs');
const AWARDS_DIR = join(ROOT, 'registry', 'awards');

const titleCase = (s) =>
  s
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

// Ordered remap rules. `match` identifies old funder slugs produced by seeding
// program/round names through slugify(); `target` is the canonical org id
// (must exist as registry/orgs/<target>.yaml); `humanize` derives a
// program_name fallback from the old slug, only used when the row's own
// program_name is blank.
const RULES = [
  {
    label: 'mozilla-moss-awards-*',
    match: (slug) => slug.startsWith('mozilla-moss-awards-'),
    target: 'mozilla-foundation',
    humanize: (slug) => `MOSS ${titleCase(slug.replace(/^mozilla-moss-awards-/, ''))}`,
  },
  {
    label: 'arbitrum-foundation-grants-stip-*',
    match: (slug) => slug.startsWith('arbitrum-foundation-grants-stip-'),
    target: 'arbitrum-foundation',
    humanize: (slug) => `STIP ${titleCase(slug.replace(/^arbitrum-foundation-grants-stip-/, ''))}`,
  },
  {
    label: 'protocol-labs-research',
    match: (slug) => slug === 'protocol-labs-research',
    target: 'protocol-labs',
    humanize: () => 'Protocol Labs Research',
  },
  {
    label: 'coinbase-developer-platform-cdp-builder-grants',
    match: (slug) => slug === 'coinbase-developer-platform-cdp-builder-grants',
    target: 'coinbase-developer-platform',
    humanize: () => 'CDP Builder Grants',
  },
  {
    label: 'chrome-*',
    match: (slug) => slug.startsWith('chrome-'),
    target: 'google-chrome',
    humanize: (slug) => titleCase(slug.replace(/^chrome-/, '')),
  },
  {
    label: 'ford-foundation-*',
    match: (slug) => slug.startsWith('ford-foundation-'),
    target: 'ford-foundation',
    humanize: (slug) => titleCase(slug.replace(/^ford-foundation-/, '')),
  },
];

// Verify every rule target exists in registry/orgs before touching any data.
const orgIds = new Set(
  readdirSync(ORGS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''))
);
for (const rule of RULES) {
  if (!orgIds.has(rule.target)) {
    console.error(`FAIL: rule "${rule.label}" targets org "${rule.target}", which has no registry/orgs/${rule.target}.yaml`);
    process.exit(1);
  }
}

const ruleForSlug = (slug) => RULES.find((r) => r.match(slug));

if (!existsSync(AWARDS_DIR)) {
  console.error(`FAIL: ${AWARDS_DIR} does not exist`);
  process.exit(1);
}

const files = readdirSync(AWARDS_DIR).filter((f) => f.endsWith('.jsonl')).sort();

// report[oldSlug] = { target, count, files: Set, programNamesSet: count }
const report = new Map();
let totalRemapped = 0;
let totalUnmatchedMissing = 0;

for (const file of files) {
  const filePath = join(AWARDS_DIR, file);
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  let changed = false;

  const newLines = lines.map((line) => {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      return line; // leave unparseable lines untouched; validator will flag them
    }

    if (orgIds.has(row.funder)) return line; // already resolves, nothing to do

    const rule = ruleForSlug(row.funder);
    if (!rule) {
      totalUnmatchedMissing++;
      return line; // no rule covers this slug; leave for the open-cases doc
    }

    const oldSlug = row.funder;
    if (!report.has(oldSlug)) {
      report.set(oldSlug, { target: rule.target, count: 0, files: new Set(), programNamesSet: 0 });
    }
    const entry = report.get(oldSlug);
    entry.count++;
    entry.files.add(file);

    row.funder = rule.target;
    if (!row.program_name || !String(row.program_name).trim()) {
      row.program_name = rule.humanize(oldSlug);
      entry.programNamesSet++;
    }

    changed = true;
    totalRemapped++;
    return JSON.stringify(row);
  });

  if (changed) {
    writeFileSync(filePath, newLines.join('\n') + '\n');
  }
}

console.log('Award funder remap report');
console.log('==========================');
if (report.size === 0) {
  console.log('No rows matched any remap rule.');
} else {
  for (const [oldSlug, entry] of [...report.entries()].sort()) {
    const fileList = [...entry.files].sort().join(', ');
    console.log(
      `${oldSlug} -> ${entry.target}  (${entry.count} rows, ${entry.programNamesSet} program_name backfilled, files: ${fileList})`
    );
  }
}
console.log('--------------------------');
console.log(`Total rows remapped: ${totalRemapped}`);
console.log(`Rows still missing a matching org after remap: ${totalUnmatchedMissing}`);
