#!/usr/bin/env node
// Idempotent loader: registry/ files (canonical) -> Postgres index + ops tables.
// Files are the truth (docs/DESIGN.md); this script rebuilds the disposable
// index tables (registry_*) from scratch every run and seeds org_sources
// (operational, accumulates its own state — never truncated).
//
// Usage:
//   node scripts/load-registry-pg.mjs [--db-url postgres://...]
//   DATABASE_URL=postgres://... node scripts/load-registry-pg.mjs
//
// Safe to run repeatedly: index tables are TRUNCATE+reload in one transaction,
// org_sources upserts with ON CONFLICT DO NOTHING (never clobbers
// last_checked/http_status/dead), migrations apply once via a ledger table.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import YAML from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_DIR = join(ROOT, 'registry');
const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations');

// ---- args / connection string ----

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db-url') out.dbUrl = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const connectionString = args.dbUrl || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('No Postgres URL: pass --db-url <url> or set DATABASE_URL.');
  process.exit(1);
}

// Mirrors src/lib/desk-store.ts: no explicit ssl override, so pg's default
// TLS behavior (and any sslmode= in the connection string) applies as-is —
// never disable certificate verification here.
const pool = new Pool({ connectionString });

// ---- content hashing (dedup / change detection per row) ----

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
    return out;
  }
  return value;
}

function contentHash(record) {
  return createHash('sha1').update(JSON.stringify(canonical(record))).digest('hex');
}

// ---- registry parsing: reuse src/lib/registry.ts if importable, else parse directly ----

async function loadRegistryData() {
  const tsPath = join(ROOT, 'src', 'lib', 'registry.ts');
  if (existsSync(tsPath)) {
    try {
      const mod = await import(pathToFileURL(tsPath).href);
      const idx = mod.loadRegistry(true);
      return { systems: idx.systems, orgs: idx.orgs, programs: idx.programs, awards: idx.awards };
    } catch (e) {
      console.warn(`could not import src/lib/registry.ts (${e.message}); falling back to direct YAML/JSONL parse`);
    }
  }
  return loadRegistryDataDirect();
}

function loadYamlDir(sub) {
  const dir = join(REGISTRY_DIR, sub);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    try {
      const doc = YAML.parse(readFileSync(join(dir, f), 'utf8'));
      if (doc && typeof doc === 'object') out.push(doc);
    } catch {
      // a broken file never takes the loader down; validate-registry.mjs catches it in CI
    }
  }
  return out;
}

function loadAwardsDirect() {
  const dir = join(REGISTRY_DIR, 'awards');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        rec.__year_file = f;
        out.push(rec);
      } catch {
        /* skip bad line */
      }
    }
  }
  return out;
}

function loadRegistryDataDirect() {
  return {
    systems: loadYamlDir('systems'),
    orgs: loadYamlDir('orgs'),
    programs: loadYamlDir('programs'),
    awards: loadAwardsDirect(),
  };
}

// awards year_file: registry.ts's parsed Award objects don't carry which file
// they came from, so recover it by re-scanning awards/ files directly and
// matching on the dedupe key (`key`). Falls back to null if not found.
function awardYearFileMap() {
  const dir = join(REGISTRY_DIR, 'awards');
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.key) map.set(rec.key, f);
      } catch {
        /* skip */
      }
    }
  }
  return map;
}

// ---- migrations ledger ----

async function ensureMigrationsLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function applyMigrations(client) {
  await ensureMigrationsLedger(client);
  if (!existsSync(MIGRATIONS_DIR)) return;
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    console.log(`applying migration: ${f}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
  }
}

// ---- batched multi-row insert helper (network round trips are the cost against
//      a remote Postgres, not row count — chunk into multi-VALUES statements) ----

async function insertBatch(client, table, columns, rows, toParams, opts = {}) {
  const chunkSize = opts.chunkSize || 200;
  const suffix = opts.suffix || '';
  let affected = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const placeholders = [];
    let p = 1;
    for (const row of chunk) {
      const params = toParams(row);
      placeholders.push('(' + params.map(() => '$' + p++).join(',') + ')');
      values.push(...params);
    }
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders.join(',')} ${suffix}`;
    const res = await client.query(sql, values);
    affected += res.rowCount || 0;
  }
  return affected;
}

// ---- index reload (registry_*: TRUNCATE + reload, always safe to drop) ----

async function reloadIndexTables(client, data) {
  const yearFileMap = awardYearFileMap();

  await client.query('BEGIN');
  try {
    await client.query(
      'TRUNCATE registry_systems, registry_orgs, registry_programs, registry_rounds, registry_awards'
    );

    await insertBatch(
      client,
      'registry_systems',
      ['id', 'name', 'kind', 'part_of', 'wires', 'summary', 'funding_channels', 'sources', 'data', 'content_hash'],
      data.systems,
      (s) => [
        s.id,
        s.name,
        s.kind,
        s.part_of || [],
        s.wires || [],
        s.summary || null,
        s.funding_channels || [],
        s.sources || [],
        s,
        contentHash(s),
      ]
    );

    await insertBatch(
      client,
      'registry_orgs',
      ['id', 'name', 'aka', 'systems', 'wires', 'roles', 'org_type', 'website', 'socials', 'status', 'profile', 'funding', 'sources', 'data', 'content_hash'],
      data.orgs,
      (o) => [
        o.id,
        o.name,
        o.aka || [],
        o.systems || [],
        o.wires || [],
        o.roles || [],
        o.org_type || null,
        o.website || null,
        o.socials || {},
        o.status || null,
        o.profile || null,
        o.funding || null,
        o.sources || [],
        o,
        contentHash(o),
      ]
    );

    await insertBatch(
      client,
      'registry_programs',
      ['id', 'name', 'org', 'parent', 'systems', 'wires', 'status', 'mechanism', 'apply_url', 'summary', 'rounds', 'sources', 'data', 'content_hash'],
      data.programs,
      (p) => [
        p.id,
        p.name,
        p.org,
        p.parent || null,
        p.systems || [],
        p.wires || [],
        p.status || null,
        p.mechanism || null,
        p.apply_url || null,
        p.summary || null,
        JSON.stringify(p.rounds || []),
        p.sources || [],
        p,
        contentHash(p),
      ]
    );

    const roundRows = [];
    for (const p of data.programs) {
      const rounds = p.rounds || [];
      for (let idx = 0; idx < rounds.length; idx++) {
        roundRows.push({ programId: p.id, idx, r: rounds[idx] });
      }
    }
    await insertBatch(
      client,
      'registry_rounds',
      ['program_id', 'idx', 'name', 'status', 'opens', 'closes', 'size', 'source'],
      roundRows,
      ({ programId, idx, r }) => [
        programId,
        idx,
        r.name || null,
        r.status || null,
        r.opens || null,
        r.closes || null,
        r.size || null,
        r.source || null,
      ]
    );

    const awardRows = data.awards.filter((a) => a.key); // key is the primary key; skip anything unkeyed
    await insertBatch(
      client,
      'registry_awards',
      ['key', 'funder', 'funder_name', 'grantee', 'grantee_name', 'amount', 'currency', 'amount_text', 'award_date', 'program', 'program_name', 'wire', 'source', 'year_file', 'data', 'content_hash'],
      awardRows,
      (a) => {
        const yearFile = a.__year_file || yearFileMap.get(a.key) || null;
        const clean = { ...a };
        delete clean.__year_file;
        return [
          a.key,
          a.funder || null,
          a.funder_name || null,
          a.grantee || null,
          a.grantee_name || null,
          a.amount ?? null,
          a.currency || null,
          a.amount_text || null,
          a.date || null,
          a.program || null,
          a.program_name || null,
          a.wire || null,
          a.source || null,
          yearFile,
          clean,
          contentHash(clean),
        ];
      },
      {
        suffix: `ON CONFLICT (key) DO UPDATE SET
          funder=EXCLUDED.funder, funder_name=EXCLUDED.funder_name, grantee=EXCLUDED.grantee,
          grantee_name=EXCLUDED.grantee_name, amount=EXCLUDED.amount, currency=EXCLUDED.currency,
          amount_text=EXCLUDED.amount_text, award_date=EXCLUDED.award_date, program=EXCLUDED.program,
          program_name=EXCLUDED.program_name, wire=EXCLUDED.wire, source=EXCLUDED.source,
          year_file=EXCLUDED.year_file, data=EXCLUDED.data, content_hash=EXCLUDED.content_hash, loaded_at=now()`,
      }
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

// ---- org_sources seeding (operational: dedup-insert only, never truncated) ----

function collectOrgUrls(org) {
  const urls = []; // { url, kind }
  const seen = new Set();
  const add = (url, kind) => {
    if (!url || typeof url !== 'string') return;
    const key = url.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    urls.push({ url: key, kind });
  };
  add(org.website, 'website');
  for (const v of Object.values(org.socials || {})) add(v, 'social');
  if (org.funding?.apply_url) add(org.funding.apply_url, 'apply');
  for (const s of org.sources || []) add(s, 'source');
  return urls;
}

async function seedOrgSources(client, orgs) {
  let inserted = 0;
  await client.query('BEGIN');
  try {
    const rows = [];
    for (const o of orgs) {
      for (const { url, kind } of collectOrgUrls(o)) rows.push({ orgId: o.id, url, kind });
    }
    inserted = await insertBatch(
      client,
      'org_sources',
      ['org_id', 'url', 'kind'],
      rows,
      ({ orgId, url, kind }) => [orgId, url, kind],
      { suffix: 'ON CONFLICT (org_id, url) DO NOTHING' }
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  return inserted;
}

// ---- file counts (for the "counts match" check the caller runs) ----

function fileCounts() {
  const countExt = (sub, ext) => {
    const dir = join(REGISTRY_DIR, sub);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => f.endsWith(ext)).length;
  };
  const awardLines = () => {
    const dir = join(REGISTRY_DIR, 'awards');
    if (!existsSync(dir)) return 0;
    let n = 0;
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      n += readFileSync(join(dir, f), 'utf8').split('\n').filter((l) => l.trim()).length;
    }
    return n;
  };
  return {
    systems: countExt('systems', '.yaml'),
    orgs: countExt('orgs', '.yaml'),
    programs: countExt('programs', '.yaml'),
    awards: awardLines(),
  };
}

// ---- main ----

async function main() {
  const started = new Date();
  const client = await pool.connect();
  try {
    await applyMigrations(client);

    const data = await loadRegistryData();
    await reloadIndexTables(client, data);
    const orgSourcesInserted = await seedOrgSources(client, data.orgs);

    const finished = new Date();
    await client.query(
      `INSERT INTO enrichment_runs (started, finished, orgs_checked, facts_applied, proposals_created, notes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        started.toISOString(),
        finished.toISOString(),
        data.orgs.length,
        0,
        0,
        JSON.stringify({ kind: 'load-registry-pg', org_sources_inserted: orgSourcesInserted }),
      ]
    );

    const files = fileCounts();
    const dbCounts = {};
    for (const [table, key] of [
      ['registry_systems', 'systems'],
      ['registry_orgs', 'orgs'],
      ['registry_programs', 'programs'],
      ['registry_rounds', 'rounds'],
      ['registry_awards', 'awards'],
      ['org_sources', 'org_sources'],
    ]) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      dbCounts[key] = rows[0].n;
    }

    console.log('\n--- load-registry-pg summary ---');
    console.log(`systems:  files=${files.systems.toString().padStart(5)}  db=${dbCounts.systems}`);
    console.log(`orgs:     files=${files.orgs.toString().padStart(5)}  db=${dbCounts.orgs}`);
    console.log(`programs: files=${files.programs.toString().padStart(5)}  db=${dbCounts.programs}`);
    console.log(`awards:   files=${files.awards.toString().padStart(5)}  db=${dbCounts.awards}`);
    console.log(`rounds:   db=${dbCounts.rounds} (unnested from programs)`);
    console.log(`org_sources: db total=${dbCounts.org_sources}, inserted this run=${orgSourcesInserted}`);
    console.log(`duration: ${((finished - started) / 1000).toFixed(2)}s`);

    const mismatches = [];
    if (files.systems !== dbCounts.systems) mismatches.push('systems');
    if (files.orgs !== dbCounts.orgs) mismatches.push('orgs');
    if (files.programs !== dbCounts.programs) mismatches.push('programs');
    if (files.awards !== dbCounts.awards) mismatches.push('awards');
    if (mismatches.length) {
      console.error(`\nCOUNT MISMATCH: ${mismatches.join(', ')} — file/db counts disagree`);
      process.exitCode = 1;
    } else {
      console.log('\nfile/db counts match.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('load-registry-pg failed:', e);
  process.exitCode = 1;
});
