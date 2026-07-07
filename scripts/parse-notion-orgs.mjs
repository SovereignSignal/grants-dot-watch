#!/usr/bin/env node
// Parse the Notion export of "Sov's Orgs" (one .md per row) into seed/notion_orgs.json.
// CRM fields (Relationship, Tier) are kept in the seed for resolution/depth decisions
// but are PRIVATE — they must never be copied into registry/ files.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const out = process.argv[3];
if (!dir || !out) {
  console.error('usage: parse-notion-orgs.mjs <export-dir> <out.json>');
  process.exit(1);
}

const KEYS = ['Tier', 'Type', 'Relationship', 'Wire', 'Website', 'Quality Score', 'Last Checked', 'Action(s)'];
const rows = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(join(dir, f), 'utf8');
  const lines = text.split('\n');
  const name = (lines.find((l) => l.startsWith('# ')) || '').slice(2).trim();
  if (!name) continue;
  const row = { name, notion_file: f };
  for (const line of lines.slice(1, 40)) {
    const m = line.match(/^([A-Za-z()' ]+):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (KEYS.includes(key)) row[key.toLowerCase().replace(/[^a-z]+/g, '_')] = m[2].trim();
  }
  rows.push(row);
}
writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(`${rows.length} orgs -> ${out}`);
