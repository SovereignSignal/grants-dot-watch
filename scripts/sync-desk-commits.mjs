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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
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

function assertSnapshotUnchanged(repo, plan, phase) {
  if (headContent(repo, plan.path) !== plan.inHead) {
    throw new Error(`${plan.path}: HEAD changed ${phase}; refusing to continue`);
  }
  if (indexContent(repo, plan.path) !== plan.inIndex) {
    throw new Error(`${plan.path}: exact target index changed ${phase}; refusing to continue`);
  }
  if (worktreeContent(repo, plan.path) !== plan.current) {
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
 *  sha only when a commit was made; applied=false means the row was unusable. */
export function applyRow(repo, row, dryRun) {
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
    const current = worktreeContent(repo, f.path);
    const inHead = headContent(repo, f.path);
    const inIndex = indexContent(repo, f.path);
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
  for (const plan of plans) assertSnapshotUnchanged(repo, plan, 'during row preflight');

  if (wrote.length === 0) {
    return { sha: git(repo, 'rev-parse', '--short', 'HEAD'), applied: true, skipped: true, wrote };
  }
  if (dryRun) return { sha: null, applied: true, skipped: false, wrote };

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
  const sha = git(repo, 'rev-parse', '--short', 'HEAD');
  for (const f of files) {
    if (headContent(repo, f.path) !== f.content_after) {
      throw new Error(`${f.path}: committed blob does not match ledger content`);
    }
  }
  return { sha, applied: true, skipped: false, wrote };
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
      `SELECT id, proposal_id, files, message FROM desk_applied_changes
        WHERE synced_at IS NULL${replayable} ORDER BY id ASC`
    );
    rows = res.rows;
  }

  console.log(`${rows.length} unsynced ledger row${rows.length === 1 ? '' : 's'}${args.dryRun ? ' (dry run)' : ''}`);
  let committed = 0;
  let alreadyApplied = 0;
  let hadFailure = false;

  for (const row of rows) {
    const label = `row ${row.id}${row.proposal_id ? ` (${row.proposal_id})` : ''}`;
    let result;
    try {
      result = applyRow(repo, row, args.dryRun);
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
      console.log(`  ${label}: content already matches HEAD at ${result.sha}`);
    } else if (args.dryRun) {
      console.log(`  ${label}: would commit ${result.wrote.length} file(s): ${result.wrote.join(', ')}`);
    } else {
      committed++;
      console.log(`  ${label}: committed ${result.sha} (${result.wrote.length} file(s))`);
    }
    if (pool && !args.dryRun) {
      if (pool.supportsDeskLedgerErrors) {
        await pool.query(
          `UPDATE desk_applied_changes
              SET synced_at = now(), sha = $2, last_error = NULL, last_attempt_at = now()
            WHERE id = $1`,
          [row.id, result.sha]
        );
      } else {
        await pool.query('UPDATE desk_applied_changes SET synced_at = now(), sha = $2 WHERE id = $1', [
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
