#!/usr/bin/env node
// Replays the durable applied-changes ledger (desk_applied_changes — written
// by committer.ts whenever an approve could not produce a git commit, i.e.
// GRANTS_WATCH_NO_GIT=1 on Railway or a git failure) into the local repo as
// real commits: one commit per ledger row, oldest first, exactly the files
// in the row, message from the row. Marks each row synced (synced_at + sha).
//
// Usage:
//   node scripts/sync-desk-commits.mjs [--db-url postgres://...] [--repo <path>] [--dry-run]
//   DATABASE_URL=postgres://... node scripts/sync-desk-commits.mjs
//   node scripts/sync-desk-commits.mjs --from-jsonl .data/pending-commits.jsonl --repo <path>
//
// Idempotent: re-runs skip already-synced rows; a row whose files already
// match the repo byte-for-byte is marked synced without a commit. Never
// pushes — the owner pushes.
//
// --from-jsonl reads the local-dev fallback ledger (same entry shape, one
// JSON object per line) instead of Postgres. JSONL entries can't be marked
// synced in place; idempotency there comes from the content-match skip.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const TRAILERS = [
  'Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>',
];

function parseArgs(argv) {
  const out = { repo: DEFAULT_REPO, dryRun: false, fromJsonl: null, dbUrl: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db-url') out.dbUrl = argv[++i];
    else if (argv[i] === '--repo') out.repo = resolve(argv[++i]);
    else if (argv[i] === '--from-jsonl') out.fromJsonl = resolve(argv[++i]);
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

function git(repo, ...cmd) {
  return execFileSync('git', cmd, { cwd: repo, stdio: 'pipe' }).toString().trim();
}

/** Only registry/ paths, no traversal — a ledger row must never be able to
 *  write outside the dataset it exists for. */
function safePath(p) {
  return typeof p === 'string' && /^registry\//.test(p) && !p.split('/').includes('..');
}

function withTrailers(message) {
  const msg = (message || 'Desk sync: applied changes').trimEnd();
  const missing = TRAILERS.filter((t) => !msg.includes(t));
  return missing.length ? `${msg}\n\n${missing.join('\n')}` : msg;
}

/** Applies one ledger row to the repo. Returns {sha|null, applied, skipped, wrote[]}:
 *  sha only when a commit was made; applied=false means the row was unusable. */
function applyRow(repo, row, dryRun) {
  const files = Array.isArray(row.files) ? row.files : [];
  const wrote = [];
  let badPaths = 0;
  for (const f of files) {
    if (!f || !safePath(f.path) || typeof f.content_after !== 'string') {
      badPaths++;
      continue;
    }
    const abs = join(repo, f.path);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (current === f.content_after) continue; // already applied — skip file
    if (!dryRun) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content_after, 'utf8');
    }
    wrote.push(f.path);
  }
  if (badPaths > 0) console.warn(`  row ${row.id ?? '(jsonl)'}: ${badPaths} entr${badPaths === 1 ? 'y' : 'ies'} with unsafe/invalid path skipped`);
  if (wrote.length === 0) return { sha: null, applied: true, skipped: true, wrote };
  if (dryRun) return { sha: null, applied: true, skipped: false, wrote };

  git(repo, 'add', '--', ...wrote);
  git(repo, 'commit', '-m', withTrailers(row.message), '--author', 'The Desk <desk@grants.watch>');
  const sha = git(repo, 'rev-parse', '--short', 'HEAD');
  return { sha, applied: true, skipped: false, wrote };
}

async function main() {
  const repo = args.repo;
  try {
    git(repo, 'rev-parse', '--git-dir');
  } catch {
    console.error(`Not a git repo: ${repo}`);
    process.exit(1);
  }

  let rows;
  let pool = null;
  if (args.fromJsonl) {
    if (!existsSync(args.fromJsonl)) {
      console.error(`No such file: ${args.fromJsonl}`);
      process.exit(1);
    }
    rows = readFileSync(args.fromJsonl, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line, i) => {
        try {
          return { id: `L${i + 1}`, ...JSON.parse(line) };
        } catch {
          console.warn(`  skipping malformed jsonl line ${i + 1}`);
          return null;
        }
      })
      .filter(Boolean)
      // old-format entries (files as string[] — pre-ledger) carry no content; skip loudly
      .filter((r) => {
        const ok = Array.isArray(r.files) && r.files.every((f) => f && typeof f === 'object');
        if (!ok) console.warn(`  row ${r.id}: old-format entry without content_after — cannot replay, skipping`);
        return ok;
      });
  } else {
    const connectionString = args.dbUrl || process.env.DATABASE_URL;
    if (!connectionString) {
      console.error('No Postgres URL: pass --db-url <url>, set DATABASE_URL, or use --from-jsonl <file>.');
      process.exit(1);
    }
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString });
    const exists = await pool.query(`SELECT to_regclass('desk_applied_changes') IS NOT NULL AS ok`);
    if (!exists.rows[0]?.ok) {
      console.log('desk_applied_changes does not exist on this database — nothing to sync.');
      await pool.end();
      return;
    }
    const res = await pool.query(
      'SELECT id, proposal_id, files, message FROM desk_applied_changes WHERE synced_at IS NULL ORDER BY id ASC'
    );
    rows = res.rows;
  }

  console.log(`${rows.length} unsynced ledger row${rows.length === 1 ? '' : 's'}${args.dryRun ? ' (dry run)' : ''}`);
  let committed = 0;
  let alreadyApplied = 0;

  for (const row of rows) {
    const label = `row ${row.id}${row.proposal_id ? ` (${row.proposal_id})` : ''}`;
    let result;
    try {
      result = applyRow(repo, row, args.dryRun);
    } catch (e) {
      console.error(`  ${label}: FAILED — ${e instanceof Error ? e.message : e}`);
      console.error('  stopping here so later rows never commit on top of a broken state.');
      break;
    }
    if (result.skipped) {
      alreadyApplied++;
      console.log(`  ${label}: content already matches the repo — marking synced, no commit`);
    } else if (args.dryRun) {
      console.log(`  ${label}: would commit ${result.wrote.length} file(s): ${result.wrote.join(', ')}`);
    } else {
      committed++;
      console.log(`  ${label}: committed ${result.sha} (${result.wrote.length} file(s))`);
    }
    if (pool && !args.dryRun) {
      await pool.query('UPDATE desk_applied_changes SET synced_at = now(), sha = $2 WHERE id = $1', [
        row.id,
        result.sha,
      ]);
    }
  }

  if (pool) await pool.end();
  console.log(
    `Done: ${committed} commit${committed === 1 ? '' : 's'}, ${alreadyApplied} already applied` +
      `${args.fromJsonl && !args.dryRun ? ' (jsonl mode: entries are not marked synced — idempotency via content match)' : ''}` +
      '. Nothing pushed — the owner pushes.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
