// Boot replay of the durable applied-changes outbox.
//
// Railway's container filesystem is ephemeral and railway.json declares no
// volume, so every approved Desk change committer.ts wrote into registry/ is
// gone on the next deploy or restart — while registry.ts derives the public
// "updated" stamp from file mtime, so the reverted image still dates itself
// fresh. desk_applied_changes is the durable record of those writes; this
// replays the unsynced ones onto the fresh container's disk with the same
// content_before_hash compare-and-set scripts/sync-desk-commits.mjs uses,
// minus every git step (a deployed container has no .git).
//
// It never sets synced_at. That column confirms a deployed Git revision, written
// only by scripts/sync-desk-commits.mjs --confirm-deployment; a replica that
// consumed rows here would destroy the git record for everyone else.
//
// It never throws. A rejected register() is memoized by Next's prepare(), so
// one bad row would 500 every route — including /admin/health — for the life
// of the instance. See replayAppliedChanges.
//
// A local Git commit leaves the row unsynced and replayable. Explicit
// confirmation checks the serving revision and the row's committed contents
// before marking it durable in the deployed image.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Pool } from 'pg';

/** Bounds the boot. register() gates the first request and railway.json's
 *  healthcheckPath is '/', so an outbox nobody has synced in months must not
 *  be able to hold a deploy open. A tail left by the time budget is reported
 *  as deferred and replays on the next boot. A tail past ROW_LIMIT does not:
 *  this never sets synced_at, so every boot selects the same oldest rows and
 *  only scripts/sync-desk-commits.mjs can move the window. Both degrade the
 *  report rather than passing for a clean replay. */
const ROW_LIMIT = 500;
const BUDGET_MS = 20_000;
const MAX_REPORTED_ERRORS = 5;

/** Leftovers from registry PR #31. The image now holds the canonical OpenAI,
 *  IVADO, and Rocket Pool files, so these ready rows cannot replay: p01426,
 *  p01438, and p01505 are refused, and p01550, p01551, and p01553 are deferred
 *  behind them. The hand-written registry files are not the committer's
 *  bytes, so a later-row byte match does not see them. They are abandoned
 *  instead of keeping every boot degraded. A row whose bytes are already the
 *  file on disk is left ready so the git sync can still record it. */
const SUPERSEDED_BY_REGISTRY_PR = new Set(['p01426', 'p01438', 'p01505', 'p01550', 'p01551', 'p01553']);

export interface BootReplayReport {
  /** skipped: nothing to replay from. unavailable: the outbox could not be
   *  read at all. degraded: at least one row was refused or deferred.
   *  superseded rows do not degrade this replica's boot. Ordinary rows stay
   *  ready: this replica's disk is not evidence of a deployed Git revision. */
  status: 'skipped' | 'ok' | 'degraded' | 'unavailable';
  scanned: number;
  applied: number;
  alreadyApplied: number;
  failed: number;
  deferred: number;
  /** older approvals skipped on this replica because later bytes are present */
  superseded: number;
  /** a row was written in part and could not be restored to its base bytes */
  torn: boolean;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
  instance: string;
  at: string;
  errors: string[];
}

interface LedgerFile {
  path: string;
  content_before_hash?: string | null;
  content_after: string;
}

interface ReplaySlot {
  inFlight: Promise<BootReplayReport> | null;
  report: BootReplayReport | null;
}

// instrumentation.ts and the app pages are separate webpack module instances
// of this file (different module ids, one shared runtime), so a module-scope
// guard would let a second instance replay a chain a first instance already
// walked forward. globalThis is the one thing both instances share, and it is
// also what makes the report readable from the health page.
const SLOT = Symbol.for('grants-watch.boot-replay');

function slot(): ReplaySlot {
  const host = globalThis as unknown as Record<symbol, ReplaySlot | undefined>;
  return (host[SLOT] ??= { inFlight: null, report: null });
}

/** Which replica this is, for a fleet log search. */
function instanceLabel(): string {
  return process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || String(process.pid);
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function readIfExists(abs: string): string | null {
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** Only registry/ paths, no traversal — a ledger row must never be able to
 *  write outside the dataset it exists for. These rows reach the filesystem
 *  out of a jsonb column, which is a trust boundary even though this app
 *  wrote them. */
function safePath(p: unknown): p is string {
  return typeof p === 'string' && /^registry\//.test(p) && !p.split('/').includes('..');
}

// Kept local rather than imported from committer.ts:659 (byte-identical
// there): importing committer would pull proposal-validator, registry and the
// YAML parser into the instrumentation chunk. scripts/sync-desk-commits.mjs
// already made the same trade.
function atomicWrite(path: string, content: string): void {
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

/** Applies one ledger row under `root`, returning the paths it actually wrote.
 *  Throws before touching anything when a path is unsafe, the row is legacy,
 *  or a live file diverged from the base the change was prepared against: a
 *  row is one atomic logical change, so any bad file blocks the whole row. A
 *  write that fails partway is rolled back to the exact base bytes the
 *  preflight already proved; a TORN: message means even that did not land. */
export function applyLedgerRow(root: string, files: LedgerFile[]): string[] {
  if (!Array.isArray(files) || files.length === 0) throw new Error('ledger row contains no files');
  const writes: { path: string; abs: string; base: string | null; content: string }[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    if (!f || !safePath(f.path) || typeof f.content_after !== 'string') {
      throw new Error(`unsafe or invalid ledger path: ${f?.path ?? '(missing)'}`);
    }
    if (seen.has(f.path)) throw new Error(`duplicate ledger path: ${f.path}`);
    seen.add(f.path);

    const abs = join(root, f.path);
    const current = readIfExists(abs);
    // Already applied. This branch is what makes a repeated replay a no-op
    // instead of a conflict storm.
    if (current === f.content_after) continue;

    // Three distinct shapes, and they are not interchangeable: a hex string
    // is "the file held these bytes", null is "the file did not exist", an
    // absent key is a legacy row with no snapshot at all, reconciled by hand
    // rather than guessed at.
    if (!Object.prototype.hasOwnProperty.call(f, 'content_before_hash')) {
      throw new Error(`${f.path}: legacy row has no base hash; manual reconciliation required`);
    }
    const matchesBase =
      f.content_before_hash === null
        ? current === null
        : typeof f.content_before_hash === 'string' && current !== null && sha256(current) === f.content_before_hash;
    if (!matchesBase) {
      throw new Error(`${f.path}: canonical content changed since proposal apply; refusing to overwrite`);
    }
    writes.push({ path: f.path, abs, base: current, content: f.content_after });
  }

  // One stat per file, catching movement between the row preflight and the
  // first mutation (sync-desk-commits.mjs:192 does the same).
  for (const write of writes) {
    if (readIfExists(write.abs) !== write.base) {
      throw new Error(`${write.path}: changed during row preflight; refusing to continue`);
    }
  }

  const written: typeof writes = [];
  try {
    for (const write of writes) {
      atomicWrite(write.abs, write.content);
      written.push(write);
    }
  } catch (error) {
    // Exact-bytes rollback: the compare-and-set above already proved each
    // base, so restoring it is not a guess. Mirrors committer.ts:756-785,
    // including its rollback-incomplete distinction — a half-applied row is
    // incoherent data, and it must not be served as truth in silence.
    const rollbackErrors: string[] = [];
    for (const write of written.reverse()) {
      try {
        if (readIfExists(write.abs) !== write.content) throw new Error('live bytes changed before rollback');
        if (write.base === null) unlinkSync(write.abs);
        else atomicWrite(write.abs, write.base);
      } catch (rollbackError) {
        rollbackErrors.push(`${write.path}: ${detail(rollbackError)}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`TORN: registry write failed (${detail(error)}); rollback incomplete: ${rollbackErrors.join('; ')}`);
    }
    throw new Error(`registry write failed and was rolled back: ${detail(error)}`);
  }
  return writes.map((write) => write.path);
}

/** True when every file of this row is already `content_after`. Invalid rows
 *  return false so the caller falls through to applyLedgerRow's refusal. */
function filesAlreadyOnDisk(files: LedgerFile[], read: (path: string) => string | null): boolean {
  if (!Array.isArray(files) || files.length === 0) return false;
  const seen = new Set<string>();
  for (const file of files) {
    if (!file || !safePath(file.path) || typeof file.content_after !== 'string' || seen.has(file.path)) return false;
    seen.add(file.path);
    if (read(file.path) !== file.content_after) return false;
  }
  return true;
}

/** An earlier approval is superseded on this replica when its current bytes
 *  match later ready rows. This says nothing about another replica or the
 *  build image: callers must retain ordinary outbox rows for future recovery.
 *  A divergence that matches no later approval returns false. */
export function ledgerRowSuperseded(
  files: LedgerFile[],
  read: (path: string) => string | null,
  laterRows: LedgerFile[][]
): boolean {
  if (!Array.isArray(files) || files.length === 0) return false;
  const seen = new Set<string>();
  let replaced = false;
  for (const file of files) {
    if (!file || !safePath(file.path) || typeof file.content_after !== 'string' || seen.has(file.path)) return false;
    seen.add(file.path);
    const current = read(file.path);
    if (current === file.content_after) continue;
    replaced = true;
    const canonical = laterRows.some(
      (later) =>
        Array.isArray(later) &&
        later.some((candidate) => candidate && candidate.path === file.path && candidate.content_after === current)
    );
    if (!canonical) return false;
  }
  return replaced;
}

/** True for a PR #31 leftover that is not already the canonical file. */
export function registryPrSuperseded(
  proposalId: unknown,
  files: LedgerFile[],
  read: (path: string) => string | null
): boolean {
  return typeof proposalId === 'string' && SUPERSEDED_BY_REGISTRY_PR.has(proposalId) && !filesAlreadyOnDisk(files, read);
}

/** This instance's last replay, or null if it never ran. A container that
 *  reports a postgres backend and no replay is running an image without this
 *  code. Pure read: the health page module is evaluated by `next build`. */
export function lastBootReplayReport(): BootReplayReport | null {
  return slot().report;
}

/** Replays the unsynced outbox onto this container's registry/, oldest row
 *  first. Never rejects.
 *
 *  Once per process. A chain of unsynced rows on one path walks the file
 *  forward (v0->v1->v2), so a second pass in the same container skips older
 *  intermediate versions without retiring the durable rows. A fresh
 *  container starts from the build image and still needs the entire chain.
 *
 *  No cross-replica lock, deliberately. Every replica has its own ephemeral
 *  filesystem and every replica must replay onto it, so withIngestLock's
 *  pg_try_advisory_lock is wrong by construction: the loser would skip and
 *  serve the un-replayed image, which is the silent revert this exists to fix.
 *  A blocking pg_advisory_lock would be safe but would queue one replica's
 *  boot behind another's with nothing shared to protect — the only shared
 *  writes here are last_error/last_attempt_at, advisory and last-writer-wins —
 *  and one stuck holder would hang every boot behind it. */
export function replayAppliedChanges(opts: { root?: string; connectionString?: string } = {}): Promise<BootReplayReport> {
  const state = slot();
  if (!state.inFlight) {
    state.inFlight = runReplay(opts).then((report) => {
      state.report = report;
      return report;
    });
  }
  return state.inFlight;
}

async function runReplay(opts: { root?: string; connectionString?: string }): Promise<BootReplayReport> {
  const startedAt = Date.now();
  const deadline = startedAt + BUDGET_MS;
  const report: BootReplayReport = {
    status: 'skipped',
    scanned: 0,
    applied: 0,
    alreadyApplied: 0,
    failed: 0,
    deferred: 0,
    superseded: 0,
    torn: false,
    truncated: false,
    timedOut: false,
    durationMs: 0,
    instance: instanceLabel(),
    at: new Date(startedAt).toISOString(),
    errors: [],
  };
  const note = (line: string) => {
    if (report.errors.length < MAX_REPORTED_ERRORS) report.errors.push(line);
  };

  const root = opts.root ?? process.cwd();
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) return finish(report, startedAt); // no durable outbox to replay from

  let pool: Pool | null = null;
  try {
    // max:1 and ended below: this runs once, in a module instance separate
    // from the page bundles', so a pool kept here would idle for the process
    // lifetime next to desk-store's own. The timeouts bound the boot — pg's
    // defaults are all 0 (wait forever), and no request is served until
    // register() resolves, so an unbounded await here serves nothing at all.
    // query_timeout is the client-side one and it is the load-bearing one:
    // statement_timeout is a server-side GUC, so it cannot fire on a
    // connection that completes the handshake and then goes deaf.
    pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
      statement_timeout: 15_000,
    });
    // No DDL at boot. Every replica boots within the same second of a deploy
    // and concurrent CREATE TABLE IF NOT EXISTS races on pg_class; an absent
    // outbox also means there is nothing to replay. desk-store's ensureSchema
    // still provisions the table on first store access.
    const present = await pool.query(`SELECT to_regclass('desk_applied_changes') IS NOT NULL AS ok`);
    if (!present.rows[0]?.ok) return finish(report, startedAt);

    // LIMIT+1 so a truncated pass is reported rather than inferred.
    const { rows } = await pool.query(
      `SELECT id, proposal_id, files, last_error FROM desk_applied_changes
        WHERE synced_at IS NULL AND state = 'ready' ORDER BY id ASC LIMIT $1`,
      [ROW_LIMIT + 1]
    );
    if (rows.length > ROW_LIMIT) {
      report.truncated = true;
      rows.length = ROW_LIMIT;
      // A starved tail, not a delayed one: the rows past the limit are never
      // selected on any boot, because nothing here advances synced_at. Said
      // as loudly as a refusal, since the failure it produces is identical —
      // approvals that never reach a container's disk.
      const why =
        `backlog exceeds the per-boot limit of ${ROW_LIMIT} rows; the rest will not replay on any boot until` +
        ` scripts/sync-desk-commits.mjs syncs the window`;
      console.error(`[boot-replay] ${why}`);
      note(why);
    }
    report.scanned = rows.length;

    // A refused row leaves its paths at a base no later row on the same path
    // can match, so defer those; rows on unrelated paths stay independently
    // replayable. sync-desk-commits.mjs stops its whole loop instead — right
    // for a human at a terminal, wrong for an unattended boot with no reader.
    const blocked = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const files = (Array.isArray(row.files) ? row.files : []) as LedgerFile[];
      const paths = files.filter((f) => f && typeof f.path === 'string').map((f) => f.path);
      const label = `row ${row.id}${row.proposal_id ? ` (${row.proposal_id})` : ''}`;

      // Checked between rows, never mid-row: a budget must not abandon a
      // half-written change set.
      if (Date.now() > deadline) {
        report.timedOut = true;
        report.deferred += rows.length - i;
        console.error(`[boot-replay] budget of ${BUDGET_MS}ms spent; ${rows.length - i} row(s) left for the next boot`);
        break;
      }

      const readPath = (path: string) => readIfExists(join(root, path));
      // Checked before the block list. A later approval can already be the
      // canonical file while an earlier row on the path was refused;
      // deferring it would report a healthy file as missing.
      if (filesAlreadyOnDisk(files, readPath)) {
        report.alreadyApplied++;
        if (row.last_error) await markRow(pool, row.id, null);
        continue;
      }
      const laterRows: LedgerFile[][] = [];
      for (let j = i + 1; j < rows.length; j++) {
        laterRows.push((Array.isArray(rows[j].files) ? rows[j].files : []) as LedgerFile[]);
      }
      if (ledgerRowSuperseded(files, readPath, laterRows)) {
        report.superseded++;
        if (registryPrSuperseded(row.proposal_id, files, readPath)) {
          // These explicit migration IDs are known to have been replaced in
          // Git by PR #31. Do not extend this exception to ordinary approvals.
          const why = 'SUPERSEDED: registry commit replaced this approval; leaving the canonical file in place';
          console.log(`[boot-replay] ${label}: ${why}`);
          await abandonRow(pool, row.id, why);
        } else {
          // A restart can retain this replica's writable layer. Its newer
          // control file does not make older immutable shards durable in Git.
          // Retiring this row would remove data the next fresh replica needs.
          console.log(`[boot-replay] ${label}: SUPERSEDED_ON_REPLICA: later bytes present locally; retaining ready outbox for recovery`);
          if (row.last_error) await markRow(pool, row.id, null);
        }
        continue;
      }

      // A registry PR #31 leftover is not deferred just because an earlier
      // row on the path was refused. Try it: if it still matches the
      // canonical file it applies, and if the file has moved on the catch
      // below retires it without degrading the boot.
      if (paths.some((p) => blocked.has(p)) && !registryPrSuperseded(row.proposal_id, files, readPath)) {
        // A deferred row did not reach this disk either. Recording it keeps
        // /admin/health's conflict count honest instead of leaving the fact
        // in a container log nobody reads.
        for (const p of paths) blocked.add(p);
        report.deferred++;
        const why = 'DEFERRED: an earlier row on the same registry path was refused; this row did not reach the disk';
        console.error(`[boot-replay] ${label}: ${why}`);
        note(`${label}: ${why}`);
        await markRow(pool, row.id, why);
        continue;
      }

      try {
        const wrote = applyLedgerRow(root, files);
        if (wrote.length > 0) report.applied++;
        else report.alreadyApplied++;
        // Clear a stale error from an earlier boot. Never synced_at.
        if (row.last_error) await markRow(pool, row.id, null);
      } catch (error) {
        const why = detail(error);
        if (registryPrSuperseded(row.proposal_id, files, readPath) && why.includes('canonical content changed since proposal apply')) {
          report.superseded++;
          const retired = 'SUPERSEDED: registry commit replaced this approval; leaving the canonical file in place';
          console.log(`[boot-replay] ${label}: ${retired}`);
          await abandonRow(pool, row.id, retired);
          continue;
        }
        report.failed++;
        if (why.startsWith('TORN:')) report.torn = true;
        for (const p of paths) blocked.add(p);
        console.error(`[boot-replay] ${label}: ${why}`);
        note(`${label}: ${why}`);
        // Durable and visible: the row stays unsynced so the git sync still
        // has to reconcile it, and /admin/health counts it as a conflict.
        await markRow(pool, row.id, why);
      }
    }
    // A refusal or a deferral left an approval off this disk. A locally
    // superseded row did not, but remains ready for other replicas. Truncation
    // and a spent budget still degrade because those rows were never reached.
    report.status =
      report.failed > 0 || report.deferred > 0 || report.truncated || report.timedOut ? 'degraded' : 'ok';
  } catch (error) {
    // A table dropped between the to_regclass probe and the select is the one
    // "missing outbox" this could still trip over; everything else is a real
    // outage of the durable record.
    if ((error as { code?: string })?.code === '42P01') {
      report.status = 'skipped';
    } else {
      // Serving the un-replayed registry is the honest degraded state; taking
      // the boot down is not. See the file header.
      report.status = 'unavailable';
      note(`outbox unavailable: ${detail(error)}`);
      console.error(`[boot-replay] outbox unavailable: ${detail(error)}`);
    }
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
  return finish(report, startedAt);
}

/** last_error + last_attempt_at only. synced_at stays null so the git sync
 *  still archives the row on a machine that has git. */
async function markRow(pool: Pool, id: number, error: string | null): Promise<void> {
  await pool
    .query('UPDATE desk_applied_changes SET last_error = $2, last_attempt_at = now() WHERE id = $1', [id, error])
    .catch((e: unknown) => console.error(`[boot-replay] row ${id}: could not record outcome: ${detail(e)}`));
}

/** Used only for explicit registry-migration exceptions, never because a
 *  replica happens to hold later bytes. Ordinary ready rows remain available
 *  until the Git synchronization workflow verifies their durable replacement. */
async function abandonRow(pool: Pool, id: number, error: string): Promise<void> {
  await pool
    .query(
      `UPDATE desk_applied_changes
          SET state = 'abandoned', last_error = $2, last_attempt_at = now()
        WHERE id = $1 AND synced_at IS NULL AND state = 'ready'`,
      [id, error]
    )
    .catch((e: unknown) => console.error(`[boot-replay] row ${id}: could not record supersession: ${detail(e)}`));
}

function finish(report: BootReplayReport, startedAt: number): BootReplayReport {
  report.durationMs = Date.now() - startedAt;
  // One grep-able summary line: a fleet log search needs exactly one term.
  console.log(
    `[boot-replay] ${report.status} scanned=${report.scanned} applied=${report.applied} already=${report.alreadyApplied}` +
      ` failed=${report.failed} deferred=${report.deferred} superseded=${report.superseded} torn=${report.torn} truncated=${report.truncated}` +
      ` timedOut=${report.timedOut} ms=${report.durationMs} instance=${report.instance}`
  );
  return report;
}
