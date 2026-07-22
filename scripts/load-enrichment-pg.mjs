#!/usr/bin/env node
// Companion to load-registry-pg.mjs: loads operational enrichment-sweep
// outputs that have no registry/ file equivalent (docs/DESIGN.md's
// "Postgres layer" section) —
//   - seed/source-checks.json  -> org_sources liveness (last_checked/http_status/dead)
//   - seed/notion_map.json     -> notion_map (org <-> Notion "Sov's Orgs" row)
// and records one enrichment_runs row summarizing this sweep. Idempotent:
// org_sources upserts on (org_id, url) update liveness fields in place;
// notion_map upserts on org_id.
//
// Usage:
//   node scripts/load-enrichment-pg.mjs [--db-url postgres://...] --checked-at <ISO timestamp>
//     [--facts-applied N] [--proposals-created N]

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = join(ROOT, 'seed');

function parseArgs(argv) {
  const out = { factsApplied: 0, proposalsCreated: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db-url') out.dbUrl = argv[++i];
    if (argv[i] === '--checked-at') out.checkedAt = argv[++i];
    if (argv[i] === '--facts-applied') out.factsApplied = parseInt(argv[++i], 10) || 0;
    if (argv[i] === '--proposals-created') out.proposalsCreated = parseInt(argv[++i], 10) || 0;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const connectionString = args.dbUrl || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('No Postgres URL: pass --db-url <url> or set DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString });

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

async function loadSourceChecks(client) {
  const path = join(SEED_DIR, 'source-checks.json');
  if (!existsSync(path)) {
    console.log('no seed/source-checks.json, skipping org_sources liveness load');
    return { rows: 0, dead: 0 };
  }
  const checks = JSON.parse(readFileSync(path, 'utf8'));
  let dead = 0;
  const rows = checks
    .filter((c) => c && c.org && c.url)
    .map((c) => {
      if (c.dead) dead++;
      return {
        orgId: c.org,
        url: c.url,
        kind: c.kind || 'source',
        lastChecked: c.checked_at || c.checkedAt || args.checkedAt || null,
        httpStatus: typeof c.status === 'number' ? c.status : null,
        deadFlag: !!c.dead,
      };
    });
  const missingTimestamp = rows.find((row) => !row.lastChecked || Number.isNaN(Date.parse(row.lastChecked)));
  if (missingTimestamp) {
    throw new Error(
      'source checks need their real checked_at timestamp; add checked_at per row or pass --checked-at <ISO timestamp>'
    );
  }

  await client.query('BEGIN');
  try {
    // Upsert: insert new URLs (kind supplied), then update liveness on all
    // known (org_id, url) pairs from this sweep — never touches rows for
    // URLs not present in this batch.
    await insertBatch(
      client,
      'org_sources',
      ['org_id', 'url', 'kind', 'last_checked', 'http_status', 'dead'],
      rows,
      (r) => [r.orgId, r.url, r.kind, r.lastChecked, r.httpStatus, r.deadFlag],
      {
        suffix: `ON CONFLICT (org_id, url) DO UPDATE SET
          last_checked = EXCLUDED.last_checked,
          http_status  = EXCLUDED.http_status,
          dead         = EXCLUDED.dead`,
      }
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  return { rows: rows.length, dead };
}

async function loadNotionMap(client) {
  const path = join(SEED_DIR, 'notion_map.json');
  if (!existsSync(path)) {
    console.log('no seed/notion_map.json, skipping notion_map load');
    return 0;
  }
  const map = JSON.parse(readFileSync(path, 'utf8'));
  const now = new Date().toISOString();
  const rows = Object.entries(map).map(([orgId, pageId]) => ({ orgId, pageId }));

  await client.query('BEGIN');
  try {
    const affected = await insertBatch(
      client,
      'notion_map',
      ['org_id', 'notion_page_id', 'last_synced'],
      rows,
      (r) => [r.orgId, r.pageId, now],
      {
        suffix: `ON CONFLICT (org_id) DO UPDATE SET
          notion_page_id = EXCLUDED.notion_page_id,
          last_synced    = EXCLUDED.last_synced`,
      }
    );
    await client.query('COMMIT');
    return affected;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const started = new Date();
  const client = await pool.connect();
  try {
    const sourceChecks = await loadSourceChecks(client);
    const notionRows = await loadNotionMap(client);

    const finished = new Date();
    await client.query(
      `INSERT INTO enrichment_runs (started, finished, orgs_checked, facts_applied, proposals_created, notes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        started.toISOString(),
        finished.toISOString(),
        sourceChecks.rows,
        args.factsApplied,
        args.proposalsCreated,
        JSON.stringify({
          kind: 'enrichment-sweep',
          source_checks_loaded: sourceChecks.rows,
          dead_urls_found: sourceChecks.dead,
          notion_map_rows: notionRows,
        }),
      ]
    );

    console.log('\n--- load-enrichment-pg summary ---');
    console.log(`org_sources liveness rows upserted: ${sourceChecks.rows} (dead: ${sourceChecks.dead})`);
    console.log(`notion_map rows upserted: ${notionRows}`);
    console.log(`facts_applied (recorded): ${args.factsApplied}`);
    console.log(`proposals_created (recorded): ${args.proposalsCreated}`);
    console.log(`duration: ${((finished - started) / 1000).toFixed(2)}s`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('load-enrichment-pg failed:', e);
  process.exitCode = 1;
});
