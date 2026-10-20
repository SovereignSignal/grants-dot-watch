#!/usr/bin/env node
// Replays the durable applied-changes ledger (desk_applied_changes — written
// by committer.ts whenever an approve could not produce a git commit, i.e.
// GRANTS_WATCH_NO_GIT=1 on Railway or a git failure) into the local repo as
// real commits: one commit per ledger row, oldest first, exactly the files
// in the row, message from the row. Records a local commit SHA. Deployment confirmation alone sets synced_at.
//
// Usage:
//   node scripts/sync-desk-commits.mjs [--db-url postgres://...] [--repo <path>] [--dry-run]
//   DATABASE_URL=postgres://... node scripts/sync-desk-commits.mjs
//   node scripts/sync-desk-commits.mjs --from-jsonl .data/pending-commits.jsonl --repo <path>
//
// Idempotent: re-runs skip already-synced rows; a row whose files already
// match the repo byte-for-byte records HEAD without a new commit. Never
// pushes — the owner pushes.
//
// --from-jsonl reads the local-dev fallback ledger (same entry shape, one
// JSON object per line) instead of Postgres. JSONL entries can't be marked
// synced in place; idempotency there comes from the content-match skip.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLY_URL_BY_PATH, withApplyUrl } from '../src/lib/ledger-apply-urls.mjs';

const APPLY_URL_MESSAGE = `Record NSF apply links for open calls

Desk ledger rows replay first, byte for byte, so their base hashes still match.
This follow-up only inserts the official NSF application URL above summary.`;

const DEFAULT_REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const TRAILERS = [
  'Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>',
];

function parseArgs(argv) {
  const out = { repo: DEFAULT_REPO, dryRun: false, fromJsonl: null, dbUrl: null, deploymentUrl: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db-url') out.dbUrl = argv[++i];
    else if (argv[i] === '--repo') out.repo = resolve(argv[++i]);
    else if (argv[i] === '--from-jsonl') out.fromJsonl = resolve(argv[++i]);
    else if (argv[i] === '--confirm-deployment') out.deploymentUrl = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return out;
}

function git(repo, ...cmd) {
  return execFileSync('git', cmd, { cwd: repo, stdio: 'pipe' }).toString().trim();
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function headContent(repo, path) {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], { cwd: repo, stdio: 'pipe' }).toString();
  } catch {
    return null;
  }
}

function indexContent(repo, path) {
  try {
    return execFileSync('git', ['show', `:${path}`], { cwd: repo, stdio: 'pipe' }).toString();
  } catch {
    return null;
  }
}

function worktreeContent(repo, path) {
  const abs = join(repo, path);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** Reads one snapshot layer (HEAD, index or worktree). In a dry run, a path an
 *  earlier simulated row already "committed" reads as that row's content in
 *  every layer, so chained rows see the state the real run would leave. */
function readLayer(read, repo, path, simulated) {
  return simulated && simulated.has(path) ? simulated.get(path) : read(repo, path);
}

function assertSnapshotUnchanged(repo, plan, phase, simulated = null) {
  if (readLayer(headContent, repo, plan.path, simulated) !== plan.inHead) {
    throw new Error(`${plan.path}: HEAD changed ${phase}; refusing to continue`);
  }
  if (readLayer(indexContent, repo, plan.path, simulated) !== plan.inIndex) {
    throw new Error(`${plan.path}: exact target index changed ${phase}; refusing to continue`);
  }
  if (readLayer(worktreeContent, repo, plan.path, simulated) !== plan.current) {
    throw new Error(`${plan.path}: worktree changed ${phase}; refusing to continue`);
  }
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // The canonical destination was not affected by temp-file cleanup.
    }
    throw error;
  }
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
 *  sha only when a commit was made; applied=false means the row was unusable.
 *  `simulated` (dry run only) is a Map of path -> content carried across rows:
 *  each simulated row records its content_after there, and later rows read it
 *  in place of HEAD, index and worktree, since nothing is really committed. */
export function applyRow(repo, row, dryRun, simulated = null) {
  const sim = dryRun && simulated instanceof Map ? simulated : null;
  const files = Array.isArray(row.files) ? row.files : [];
  if (files.length === 0) throw new Error('ledger row contains no files');
  const wrote = [];
  const writes = [];
  const plans = [];
  const seenPaths = new Set();

  // Preflight every file before touching any of them. A row is one atomic
  // logical change, so an unsafe path or stale base blocks the complete row.
  for (const f of files) {
    if (!f || !safePath(f.path) || typeof f.content_after !== 'string') {
      throw new Error(`unsafe or invalid ledger path: ${f?.path ?? '(missing)'}`);
    }
    if (seenPaths.has(f.path)) throw new Error(`duplicate ledger path: ${f.path}`);
    seenPaths.add(f.path);

    const abs = join(repo, f.path);
    const current = readLayer(worktreeContent, repo, f.path, sim);
    const inHead = readLayer(headContent, repo, f.path, sim);
    const inIndex = readLayer(indexContent, repo, f.path, sim);
    const plan = { path: f.path, abs, current, inHead, inIndex, contentAfter: f.content_after };

    if (inHead === f.content_after) {
      if (current !== f.content_after) {
        throw new Error(`${f.path}: worktree differs from the already-applied HEAD snapshot`);
      }
      if (inIndex !== inHead) {
        throw new Error(`${f.path}: exact target has staged changes; refusing to mark the row synced`);
      }
      plans.push(plan);
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(f, 'content_before_hash')) {
      throw new Error(`${f.path}: legacy row has no base hash and HEAD differs; manual reconciliation required`);
    }
    const headMatchesBase =
      f.content_before_hash === null
        ? inHead === null
        : typeof f.content_before_hash === 'string' && inHead !== null && sha256(inHead) === f.content_before_hash;
    if (!headMatchesBase) {
      throw new Error(`${f.path}: HEAD changed since proposal apply; refusing to replay`);
    }

    const cleanIndex = inIndex === inHead;
    const resumableIndex = inIndex === f.content_after && current === f.content_after;
    if (!cleanIndex && !resumableIndex) {
      throw new Error(`${f.path}: exact target has staged changes; refusing to overwrite or absorb them`);
    }

    if (current === f.content_after) {
      // A previous replay can have written, or written and staged, the exact
      // ledger bytes before failing. That byte-exact state is safe to resume.
      wrote.push(f.path);
      plans.push(plan);
      continue;
    }

    const worktreeMatchesBase =
      f.content_before_hash === null
        ? current === null
        : typeof f.content_before_hash === 'string' && current !== null && sha256(current) === f.content_before_hash;
    if (!worktreeMatchesBase) {
      throw new Error(`${f.path}: canonical content changed since proposal apply; refusing to overwrite`);
    }
    writes.push({ abs, content: f.content_after });
    wrote.push(f.path);
    plans.push(plan);
  }

  // Catch HEAD, index, or worktree movement after the complete row preflight
  // and before the first filesystem mutation.
  for (const plan of plans) assertSnapshotUnchanged(repo, plan, 'during row preflight', sim);

  if (wrote.length === 0) {
    return { sha: git(repo, 'rev-parse', 'HEAD'), applied: true, skipped: true, wrote };
  }
  if (dryRun) {
    if (sim) for (const plan of plans) sim.set(plan.path, plan.contentAfter);
    return { sha: null, applied: true, skipped: false, wrote };
  }

  for (const write of writes) atomicWrite(write.abs, write.content);

  // Recheck the immutable git snapshots and the final worktree bytes directly
  // before staging. This prevents a concurrent exact-path edit from being
  // folded into the replay commit.
  for (const plan of plans) {
    if (headContent(repo, plan.path) !== plan.inHead) {
      throw new Error(`${plan.path}: HEAD changed before staging; refusing to continue`);
    }
    if (indexContent(repo, plan.path) !== plan.inIndex) {
      throw new Error(`${plan.path}: exact target index changed before staging; refusing to continue`);
    }
    if (worktreeContent(repo, plan.path) !== plan.contentAfter) {
      throw new Error(`${plan.path}: worktree does not match ledger content before staging`);
    }
  }

  git(repo, 'add', '--', ...wrote);
  for (const plan of plans) {
    if (headContent(repo, plan.path) !== plan.inHead) {
      throw new Error(`${plan.path}: HEAD changed while staging; refusing to commit`);
    }
    if (indexContent(repo, plan.path) !== plan.contentAfter) {
      throw new Error(`${plan.path}: staged blob does not match ledger content`);
    }
    if (worktreeContent(repo, plan.path) !== plan.contentAfter) {
      throw new Error(`${plan.path}: worktree changed while staging; refusing to commit`);
    }
  }
  // --only prevents unrelated pre-staged changes from entering this commit.
  git(repo, 'commit', '--only', '-m', withTrailers(row.message), '--author', 'The Desk <desk@grants.watch>', '--', ...wrote);
  const sha = git(repo, 'rev-parse', 'HEAD');
  for (const f of files) {
    if (headContent(repo, f.path) !== f.content_after) {
      throw new Error(`${f.path}: committed blob does not match ledger content`);
    }
  }
  return { sha, applied: true, skipped: false, wrote };
}

/** After a clean replay, insert blessed apply URLs and commit them separately.
 *  The ledger commit stays equal to content_after. A dry run only updates the
 *  simulated snapshot so later logging sees the post-replay text. */
export function recordBlessedApplyUrls(repo, dryRun, simulated, paths) {
  const planned = [];
  for (const path of Object.keys(APPLY_URL_BY_PATH)) {
    if (!paths.has(path)) continue;
    const current = simulated && simulated.has(path) ? simulated.get(path) : worktreeContent(repo, path);
    if (typeof current !== 'string') continue;
    const next = withApplyUrl(current, APPLY_URL_BY_PATH[path]);
    if (!next.changed) continue;
    planned.push({ path, content: next.content });
  }
  if (planned.length === 0) return { commits: 0, wrote: [] };
  const wrote = planned.map((item) => item.path);
  if (dryRun) {
    if (simulated) for (const item of planned) simulated.set(item.path, item.content);
    console.log(`  would record apply_url on ${wrote.join(', ')}`);
    return { commits: 0, wrote };
  }
  for (const item of planned) atomicWrite(join(repo, item.path), item.content);
  git(repo, 'add', '--', ...wrote);
  git(repo, 'commit', '--only', '-m', APPLY_URL_MESSAGE, '--', ...wrote);
  console.log(`  recorded apply_url ${git(repo, 'rev-parse', 'HEAD')} (${wrote.length} file(s))`);
  return { commits: 1, wrote };
}

/** A local commit is durable only once an image containing it is serving.
 * Validate ledger bytes at that commit and ancestry of the deployed image.
 * Later accepted commits may legitimately supersede the same file. */
export function verifyLedgerCommit(repo, row, descendant = 'HEAD') {
  if (typeof row.sha !== 'string' || !/^[a-f0-9]{7,40}$/.test(row.sha)) return false;
  if (!Array.isArray(row.files) || !row.files.length) return false;
  try {
    git(repo, 'merge-base', '--is-ancestor', row.sha, descendant);
    return row.files.every(f => safePath(f.path) && typeof f.content_after === 'string'
      && execFileSync('git', ['show', `${row.sha}:${f.path}`], { cwd: repo, stdio: 'pipe' }).toString() === f.content_after);
  } catch { return false; }
}

export async function confirmDeployment(repo, pool, rows, url, dryRun) {
  const endpoint = new URL('/api/v1/deployment', url);
  if (endpoint.protocol !== 'https:') throw new Error('Deployment confirmation requires HTTPS');
  const response = await fetch(endpoint, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Deployment endpoint returned ${response.status}`);
  const { commit } = await response.json();
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Deployed commit is unavailable');
  // Resolve locally before considering any write. Fetching untrusted refs is not automatic.
  git(repo, 'cat-file', '-e', `${commit}^{commit}`);
  const eligible = rows.filter(row => verifyLedgerCommit(repo, row, commit));
  for (const row of eligible) {
    if (!dryRun) {
      const result = await pool.query(`UPDATE desk_applied_changes SET synced_at = now(), last_error = NULL,
        last_attempt_at = now() WHERE id = $1 AND sha = $2 AND files = $3::jsonb
        AND synced_at IS NULL AND state = 'ready' RETURNING id`, [row.id, row.sha, JSON.stringify(row.files)]);
      if (result.rowCount !== 1) throw new Error(`Ledger row ${row.id} changed during confirmation`);
    }
  }
  console.log(JSON.stringify({ deployed_commit: commit, confirmed: eligible.length, pending: rows.length - eligible.length, dry_run: dryRun }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
      .filter((r) => {
        const replayable = !r.state || r.state === 'ready';
        if (!replayable) console.warn(`  row ${r.id}: ledger state ${r.state} is not replayable, skipping`);
        return replayable;
      })
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
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'desk_applied_changes'`
    );
    const columnNames = new Set(columns.rows.map((row) => row.column_name));
    pool.supportsDeskLedgerState = columnNames.has('state');
    pool.supportsDeskLedgerErrors = columnNames.has('last_error') && columnNames.has('last_attempt_at');
    const replayable = pool.supportsDeskLedgerState ? " AND state = 'ready'" : '';
    const res = await pool.query(
      `SELECT id, proposal_id, files, message, sha FROM desk_applied_changes
        WHERE synced_at IS NULL${replayable} ORDER BY id ASC`
    );
    rows = res.rows;
  }

  if (args.deploymentUrl) {
    if (!pool || !pool.supportsDeskLedgerState || !pool.supportsDeskLedgerErrors) throw new Error('Deployment confirmation needs the current PostgreSQL ledger');
    try { await confirmDeployment(repo, pool, rows, args.deploymentUrl, args.dryRun); }
    finally { await pool.end(); }
    return;
  }

  console.log(`${rows.length} unsynced ledger row${rows.length === 1 ? '' : 's'}${args.dryRun ? ' (dry run)' : ''}`);
  let committed = 0;
  let alreadyApplied = 0;
  let hadFailure = false;
  // Dry run only: what each simulated row would have committed, so a later row
  // touching the same file checks against it instead of the unmoved HEAD.
  const simulated = args.dryRun ? new Map() : null;
  const applyUrlPaths = new Set();

  for (const row of rows) {
    const label = `row ${row.id}${row.proposal_id ? ` (${row.proposal_id})` : ''}`;
    let result;
    try {
      result = verifyLedgerCommit(repo, row)
        ? { sha: row.sha, applied: true, skipped: true, wrote: [] }
        : applyRow(repo, row, args.dryRun, simulated);
    } catch (e) {
      hadFailure = true;
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`  ${label}: FAILED — ${detail}`);
      if (pool && !args.dryRun && pool.supportsDeskLedgerErrors) {
        await pool.query(
          'UPDATE desk_applied_changes SET last_error = $2, last_attempt_at = now() WHERE id = $1',
          [row.id, detail]
        );
      }
      console.error('  stopping here so later rows never commit on top of a broken state.');
      break;
    }
    if (result.skipped) {
      alreadyApplied++;
      console.log(`  ${label}: ledger content is committed at ${result.sha}; deployment confirmation pending`);
    } else if (args.dryRun) {
      console.log(`  ${label}: would commit ${result.wrote.length} file(s): ${result.wrote.join(', ')}`);
    } else {
      committed++;
      console.log(`  ${label}: committed ${result.sha} (${result.wrote.length} file(s))`);
    }
    for (const file of Array.isArray(row.files) ? row.files : []) {
      if (file && typeof file.path === 'string' && Object.hasOwn(APPLY_URL_BY_PATH, file.path)) applyUrlPaths.add(file.path);
    }
    if (pool && !args.dryRun) {
      if (pool.supportsDeskLedgerErrors) {
        await pool.query(
          `UPDATE desk_applied_changes
              SET sha = $2, last_error = NULL, last_attempt_at = now()
            WHERE id = $1`,
          [row.id, result.sha]
        );
      } else {
        await pool.query('UPDATE desk_applied_changes SET sha = $2 WHERE id = $1', [
          row.id,
          result.sha,
        ]);
      }
    }
  }

  if (pool) await pool.end();
  if (hadFailure) {
    console.error(
      `Incomplete: ${committed} commit${committed === 1 ? '' : 's'}, ${alreadyApplied} already applied. ` +
        'Nothing pushed. Resolve the failed row before retrying.'
    );
    process.exitCode = 1;
    return;
  }
  const followUp = recordBlessedApplyUrls(repo, args.dryRun, simulated, applyUrlPaths);
  if (!args.dryRun) committed += followUp.commits;
  console.log(
    `Done: ${committed} commit${committed === 1 ? '' : 's'}, ${alreadyApplied} already applied` +
      `${args.fromJsonl && !args.dryRun ? ' (jsonl mode: entries are not marked synced — idempotency via content match)' : ''}` +
      '. Nothing pushed — the owner pushes.'
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
