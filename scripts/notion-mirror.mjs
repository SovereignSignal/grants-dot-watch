#!/usr/bin/env node
// One-way mirror: grants.watch registry -> Notion "Sov's Orgs" CRM.
//
// THE MEMBRANE (docs/DESIGN.md decision #4): this script writes ONLY the
// registry-owned mirror fields listed in MIRROR_FIELDS. It never reads or
// writes the CRM's own columns (Relationship, Tier, Quality Score, Action(s),
// Contacts, Last Checked). One direction, per field, no write-back.
//
// Flags:
//   --dry-run        log what would change, write nothing (default is dry-run)
//   --execute        actually write to Notion
//   --create-new     also create rows for funders not yet in the CRM
//                    (omit to update existing rows only)
//
// Env: NOTION_TOKEN, NOTION_ORGS_DB, GRANTS_WATCH_PUBLIC_URL.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const DB = requiredEnv('NOTION_ORGS_DB');
const SITE = requiredEnv('GRANTS_WATCH_PUBLIC_URL').replace(/\/$/, '');
const TOKEN = requiredEnv('NOTION_TOKEN');

const args = new Set(process.argv.slice(2));
const EXECUTE = args.has('--execute');
const CREATE_NEW = args.has('--create-new');

// The registry-owned fields. This allowlist IS the membrane — the writer only
// ever emits these property names, so a CRM column can never be touched.
const MIRROR_FIELDS = ['Registry', 'Ecosystems', 'Programs', 'Open Now', 'Registry Summary', 'Registry Synced'];

const CRM_OWNED = ['Relationship', 'Tier', 'Quality Score', 'Action(s)', 'Contacts', 'Last Checked'];

// registry org_type -> Notion Type option (only used when creating a row or
// filling an empty Type; never overwrites an existing CRM value)
const TYPE_MAP = {
  foundation: 'Foundation/Lab',
  dao: 'Ecosystem DAO',
  company: 'Corporate',
  nonprofit: 'Non-Profit/NGO',
  government: 'Government',
  education: 'Education',
};
const WIRE_MAP = { crypto: 'Crypto', ai: 'AI', oss: 'OSS' };

const norm = (s) =>
  (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const domain = (u) => {
  if (!u) return null;
  try {
    return new URL(u.startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
};

async function notion(path, method = 'GET', body) {
  const res = await fetch('https://api.notion.com/v1/' + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return notion(path, method, body);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${json.message || JSON.stringify(json)}`);
  return json;
}

// ---- load registry ----
function loadRegistry() {
  const load = (sub) =>
    readdirSync(join(ROOT, 'registry', sub))
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => YAML.parse(readFileSync(join(ROOT, 'registry', sub, f), 'utf8')));
  const orgs = load('orgs');
  const systems = load('systems');
  const programs = load('programs');
  const sysName = new Map(systems.map((s) => [s.id, s.name]));
  const progByOrg = new Map();
  for (const p of programs) {
    if (!progByOrg.has(p.org)) progByOrg.set(p.org, []);
    progByOrg.get(p.org).push(p);
  }
  const todayISO = new Date().toISOString().slice(0, 10);
  return orgs
    .filter((o) => (o.roles || []).includes('funder'))
    .map((o) => {
      const progs = progByOrg.get(o.id) || [];
      const openRounds = progs
        .flatMap((p) => p.rounds || [])
        .filter((r) => (r.status === 'open' || r.status === 'announced') && (!r.closes || r.closes >= todayISO));
      return {
        id: o.id,
        name: o.name,
        aka: o.aka || [],
        website: o.website || null,
        org_type: o.org_type || null,
        wires: o.wires || [],
        ecosystems: (o.systems || []).map((s) => sysName.get(s) || s),
        programs: progs.length,
        openNow: openRounds.length,
        summary: (o.profile || '').trim().slice(0, 1900),
        url: `${SITE}/orgs/${o.id}`,
      };
    });
}

// ---- pull Notion rows ----
async function pullNotion() {
  const rows = [];
  let cursor;
  do {
    const page = await notion(`databases/${DB}/query`, 'POST', cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 });
    rows.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return rows;
}

// ---- build the mirror property payload (mirror fields only) ----
function mirrorProps(f, now, existing) {
  const props = {
    Registry: { url: f.url },
    Ecosystems: { rich_text: [{ text: { content: f.ecosystems.join(', ') || '—' } }] },
    Programs: { number: f.programs },
    'Open Now': { number: f.openNow },
    'Registry Summary': { rich_text: [{ text: { content: f.summary || '—' } }] },
    'Registry Synced': { date: { start: now } },
  };
  // Fill Website/Type/Wire only when the CRM row has them empty (never overwrite).
  if (existing) {
    if (!existing.properties.Website?.url && f.website) props.Website = { url: f.website };
    if (!existing.properties.Type?.select && f.org_type && TYPE_MAP[f.org_type])
      props.Type = { select: { name: TYPE_MAP[f.org_type] } };
    const wireSet = (existing.properties.Wire?.multi_select || []).length > 0;
    if (!wireSet && f.wires.length) props.Wire = { multi_select: f.wires.map((w) => ({ name: WIRE_MAP[w] })).filter((x) => x.name) };
  }
  return props;
}

async function main() {
  // membrane self-check
  for (const field of MIRROR_FIELDS) if (CRM_OWNED.includes(field)) throw new Error('MEMBRANE VIOLATION: ' + field);

  const funders = loadRegistry();
  const rows = await pullNotion();
  const byName = new Map(), byDom = new Map();
  for (const r of rows) {
    const name = (r.properties.Name?.title || []).map((t) => t.plain_text).join('');
    if (name) byName.set(norm(name), r);
    const d = domain(r.properties.Website?.url);
    if (d) byDom.set(d, r);
  }

  const now = new Date().toISOString();
  const toUpdate = [], toCreate = [];
  for (const f of funders) {
    const d = domain(f.website);
    const hit = (d && byDom.get(d)) || [f.name, ...f.aka].map((n) => byName.get(norm(n))).find(Boolean);
    if (hit) toUpdate.push({ f, row: hit });
    else toCreate.push(f);
  }

  console.log(`\n=== grants.watch -> Notion CRM mirror ${EXECUTE ? '(EXECUTE)' : '(DRY RUN)'} ===`);
  console.log(`registry funders: ${funders.length}`);
  console.log(`matched existing CRM rows -> UPDATE mirror fields: ${toUpdate.length}`);
  console.log(`unmatched funders -> ${CREATE_NEW ? 'CREATE new rows' : 'HELD (run with --create-new)'}: ${toCreate.length}`);
  console.log(`mirror fields written: ${MIRROR_FIELDS.join(', ')}`);
  console.log(`CRM fields never touched: ${CRM_OWNED.join(', ')}\n`);

  // sample
  const sample = toUpdate[0];
  if (sample) {
    console.log('SAMPLE update (', sample.f.name, '):');
    console.log('  Registry:', sample.f.url);
    console.log('  Ecosystems:', sample.f.ecosystems.join(', ') || '—');
    console.log('  Programs:', sample.f.programs, ' Open Now:', sample.f.openNow);
    console.log('  Summary:', (sample.f.summary || '—').slice(0, 120) + '...');
  }

  if (!EXECUTE) {
    console.log('\nDRY RUN complete. Re-run with --execute to write, add --create-new to create the unmatched rows.');
    return;
  }

  let updated = 0, created = 0, errors = 0;
  for (const { f, row } of toUpdate) {
    try {
      await notion(`pages/${row.id}`, 'PATCH', { properties: mirrorProps(f, now, row) });
      updated++;
      if (updated % 50 === 0) console.log(`  updated ${updated}/${toUpdate.length}`);
    } catch (e) {
      errors++;
      console.error(`  update failed ${f.name}: ${e.message}`);
    }
  }
  if (CREATE_NEW) {
    for (const f of toCreate) {
      try {
        const props = mirrorProps(f, now, null);
        props.Name = { title: [{ text: { content: f.name } }] };
        if (f.website) props.Website = { url: f.website };
        if (f.org_type && TYPE_MAP[f.org_type]) props.Type = { select: { name: TYPE_MAP[f.org_type] } };
        if (f.wires.length) props.Wire = { multi_select: f.wires.map((w) => ({ name: WIRE_MAP[w] })).filter((x) => x.name) };
        await notion('pages', 'POST', { parent: { database_id: DB }, properties: props });
        created++;
        if (created % 25 === 0) console.log(`  created ${created}/${toCreate.length}`);
      } catch (e) {
        errors++;
        console.error(`  create failed ${f.name}: ${e.message}`);
      }
    }
  }
  console.log(`\nDONE. updated ${updated}, created ${created}, errors ${errors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
