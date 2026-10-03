// The boot replay of the durable applied-changes outbox (src/lib/boot-replay.ts).
// Railway's filesystem is ephemeral, so an approved Desk change is gone on the
// next deploy; these pin that a fresh container restores it, that a diverged
// file is refused rather than overwritten, and that the row stays unsynced so
// the git archival still happens. Needs a throwaway database in
// TEST_DATABASE_URL; skips without one, so `npm test` stays database-free.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test, { after, before, beforeEach } from 'node:test';

import { closePg, lockDatabase, row, rows, sha256, skipWithoutPg, sql, TEST_DATABASE_URL } from './pg-helper.mjs';

const opts = { skip: skipWithoutPg };
const execFile = promisify(execFileCb);

const PATH = 'registry/orgs/acme.yaml';
const V0 = 'id: acme\n';
const V1 = 'id: acme\nname: Acme Foundation\n';
const V2 = 'id: acme\nname: Acme Foundation\nwire: oss\n';

const roots = [];

/** A sandbox standing in for one container's registry/. */
function sandbox(seed = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'grants-watch-replay-'));
  roots.push(dir);
  for (const [path, content] of Object.entries(seed)) {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

const read = (root, path = PATH) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);
const mtime = (root, path = PATH) => statSync(join(root, path)).mtimeMs;

/** replayAppliedChanges memoizes on a globalThis slot shared by every module
 *  instance — that is the once-per-container guard under test. A test that
 *  wants a second container clears the slot rather than cache-busting the
 *  import, since cache-busting would no longer give it a fresh guard. */
async function loadReplay({ reboot = false } = {}) {
  if (reboot) delete globalThis[Symbol.for('grants-watch.boot-replay')];
  return import('../src/lib/boot-replay.ts');
}

/** One ready outbox row, exactly as recordVerdictPg leaves it. */
async function readyRow(files, proposalId = 'p00001') {
  const { rows: inserted } = await sql(
    `INSERT INTO desk_applied_changes (proposal_id, files, message, state) VALUES ($1, $2, $3, 'ready') RETURNING id`,
    [proposalId, JSON.stringify(files), `apply ${proposalId}`]
  );
  return Number(inserted[0].id);
}

const file = (over = {}) => ({ path: PATH, content_before_hash: sha256(V0), content_after: V1, ...over });

const ledger = async () =>
  (await rows('SELECT id, state, synced_at, last_error FROM desk_applied_changes ORDER BY id ASC')).map((r) => ({
    id: r.id,
    state: r.state,
    synced: r.synced_at !== null,
    error: r.last_error,
  }));

before(async () => {
  if (skipWithoutPg) return;
  await lockDatabase(); // the other Postgres suite truncates the same tables
  await sql(`CREATE TABLE IF NOT EXISTS desk_applied_changes (
    id serial PRIMARY KEY, proposal_id text, files jsonb NOT NULL, message text,
    state text NOT NULL DEFAULT 'ready', sha text, synced_at timestamptz,
    last_error text, last_attempt_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
  await sql('TRUNCATE desk_applied_changes RESTART IDENTITY');
});

beforeEach(async () => {
  if (skipWithoutPg) return;
  await sql('TRUNCATE desk_applied_changes RESTART IDENTITY');
  delete globalThis[Symbol.for('grants-watch.boot-replay')];
});

after(async () => {
  if (skipWithoutPg) return;
  await sql('TRUNCATE desk_applied_changes RESTART IDENTITY');
  await closePg();
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  delete globalThis[Symbol.for('grants-watch.boot-replay')];
});

test('a fresh container replays a chain from the build image', opts, async () => {
  await readyRow([file()]);
  await readyRow([file({ content_before_hash: sha256(V1), content_after: V2 })], 'p00002');
  const root = sandbox({ [PATH]: V0 }); // the built checkout a new container boots with

  const { replayAppliedChanges } = await loadReplay();
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.equal(report.status, 'ok');
  assert.deepEqual(
    { scanned: report.scanned, applied: report.applied, already: report.alreadyApplied, failed: report.failed },
    { scanned: 2, applied: 2, already: 0, failed: 0 }
  );
  assert.equal(read(root), V2); // id order walked the chain forward
});

test('replay never sets synced_at, so the git archival still has to happen', opts, async () => {
  await readyRow([file()]);
  const root = sandbox({ [PATH]: V0 });
  const { replayAppliedChanges } = await loadReplay();
  await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.deepEqual(await ledger(), [{ id: 1, state: 'ready', synced: false, error: null }]);
  assert.equal((await row('SELECT count(*)::int AS n FROM desk_applied_changes WHERE synced_at IS NOT NULL')).n, 0);
});

test('a second call in the same container does not replay again', opts, async () => {
  await readyRow([file()]);
  const root = sandbox({ [PATH]: V0 });
  const { replayAppliedChanges } = await loadReplay();

  const first = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });
  const before = mtime(root);
  const second = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.equal(second, first); // the memoized promise, not a second pass
  assert.equal(mtime(root), before);
  assert.equal(read(root), V1);
});

test('a chain already at its final bytes is superseded, not a conflict', opts, async () => {
  // v0->v1->v2 walks the file to v2. A second pass used to fail row 1's
  // compare-and-set and defer row 2, which is also what a fresh container
  // does when the image already contains v2 (registry PR #31). That file is
  // the later approval. Replaying row 1 would roll it back, so the boot is
  // healthy and the older row is abandoned. The once-guard still keeps this
  // second pass out of reach in a normal container.
  await readyRow([file()]);
  await readyRow([file({ content_before_hash: sha256(V1), content_after: V2 })], 'p00002');
  const root = sandbox({ [PATH]: V0 });
  await (await loadReplay()).replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });
  assert.equal(read(root), V2);

  const { replayAppliedChanges } = await loadReplay({ reboot: true });
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.equal(report.status, 'ok');
  assert.deepEqual(
    { applied: report.applied, already: report.alreadyApplied, failed: report.failed, deferred: report.deferred, superseded: report.superseded },
    { applied: 0, already: 1, failed: 0, deferred: 0, superseded: 1 }
  );
  assert.equal(read(root), V2); // untouched
  const after = await ledger();
  assert.equal(after[0].state, 'abandoned');
  assert.match(after[0].error, /SUPERSEDED/);
  assert.deepEqual([after[1].state, after[1].synced, after[1].error], ['ready', false, null]);
});

test('divergence fails loud and leaves the file alone', opts, async () => {
  const HAND_EDIT = 'id: acme\nname: edited by the owner\n';
  await readyRow([file()]);
  const root = sandbox({ [PATH]: HAND_EDIT });

  const { replayAppliedChanges } = await loadReplay();
  // Resolves, never rejects: a rejected register() is memoized by Next's
  // prepare() and would 500 every route for the life of the instance.
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.equal(report.status, 'degraded');
  assert.equal(report.failed, 1);
  assert.equal(read(root), HAND_EDIT); // byte-identical, not overwritten
  assert.deepEqual(
    (await ledger()).map((r) => [r.state, r.synced]),
    [['ready', false]] // still replayable, still the git sync's to reconcile
  );
  assert.match((await ledger())[0].error, /refusing to overwrite/);
  assert.match(report.errors[0], /row 1 \(p00001\)/);
});

test('a replica never skips because another replica holds a lock', opts, async () => {
  // The assertion that fails if anyone reaches for pg_try_advisory_lock. Every
  // replica has its own ephemeral filesystem and must replay onto it, so a
  // try-and-skip lock would leave the loser serving the un-replayed image —
  // the exact silent revert this pass exists to fix, relocated. Holding both
  // keys the code already uses plus the next free one from an outside session
  // stands in for another replica mid-replay: a try-lock would skip, and a
  // blocking lock would hang the boot, which the deadline below catches.
  await readyRow([file()]);
  const root = sandbox({ [PATH]: V0 });
  for (const key of [8892011, 8892012, 8892013]) await sql('SELECT pg_advisory_lock($1)', [key]);
  try {
    const { replayAppliedChanges } = await loadReplay();
    const report = await Promise.race([
      replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('replay blocked on an advisory lock')), 5_000).unref()),
    ]);
    assert.equal(report.applied, 1);
    assert.equal(read(root), V1);
  } finally {
    for (const key of [8892011, 8892012, 8892013]) await sql('SELECT pg_advisory_unlock($1)', [key]);
  }
});

test('two replicas replaying at once each end with their own disk correct', opts, async () => {
  // Two real processes, one outbox, disjoint filesystems — the deployment
  // shape a Railway rolling deploy produces. Spawned because the once-guard
  // lives on globalThis, so one process is one container by construction.
  await readyRow([file()]);
  const a = sandbox({ [PATH]: V0 });
  const b = sandbox({ [PATH]: V0 });
  const child = `import {replayAppliedChanges} from ${JSON.stringify(resolve('src/lib/boot-replay.ts'))};
    console.log(JSON.stringify(await replayAppliedChanges({root: process.cwd(), connectionString: process.env.TEST_DATABASE_URL})));`;
  const run = (cwd) =>
    execFile(process.execPath, ['--experimental-strip-types', '--experimental-loader', resolve('tests/ts-loader.mjs'), '--input-type=module', '-e', child], { cwd });

  const [ra, rb] = await Promise.all([run(a), run(b)]); // launched together, not in turn
  const report = (r) => JSON.parse(r.stdout.trim().split('\n').pop());

  assert.deepEqual([report(ra).applied, report(rb).applied], [1, 1]);
  assert.deepEqual([read(a), read(b)], [V1, V1]);
  assert.deepEqual((await ledger()).map((r) => [r.state, r.synced]), [['ready', false]]); // still the git sync's to archive
});

test('a failed row defers only later rows on the same path', opts, async () => {
  const OTHER = 'registry/orgs/other.yaml';
  await readyRow([file()]); // row 1: diverged base, refused
  await readyRow([file({ content_before_hash: sha256(V1), content_after: V2 })], 'p00002'); // row 2: same path
  await readyRow([{ path: OTHER, content_before_hash: null, content_after: V0 }], 'p00003'); // row 3: unrelated
  const root = sandbox({ [PATH]: 'something else entirely\n' });

  const { replayAppliedChanges } = await loadReplay();
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.deepEqual(
    { applied: report.applied, failed: report.failed, deferred: report.deferred },
    { applied: 1, failed: 1, deferred: 1 }
  );
  assert.equal(read(root), 'something else entirely\n');
  assert.equal(read(root, OTHER), V0); // an unrelated path is independently safe
  const after = await ledger();
  assert.match(after[0].error, /refusing to overwrite/);
  assert.match(after[1].error, /^DEFERRED: /); // a distinct reason from a refusal
  assert.equal(after[2].error, null);
});

test('registry PR #31 leftovers are abandoned instead of degrading the boot', opts, async () => {
  // The committed file is not the committer's bytes, so neither the refused
  // row nor the later approval matches disk. Both still have to leave the
  // boot healthy, and neither may overwrite the canonical file.
  await readyRow([file()], 'p01426');
  await readyRow([file({ content_before_hash: sha256(V1), content_after: V2 })], 'p01550');
  const canonical = 'canonical text from the registry commit\n';
  const root = sandbox({ [PATH]: canonical });
  const before = mtime(root);

  const { replayAppliedChanges } = await loadReplay();
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.equal(report.status, 'ok');
  assert.deepEqual(
    { failed: report.failed, deferred: report.deferred, superseded: report.superseded, applied: report.applied },
    { failed: 0, deferred: 0, superseded: 2, applied: 0 }
  );
  assert.equal(read(root), canonical);
  assert.equal(mtime(root), before);
  const after = await ledger();
  assert.deepEqual(after.map((r) => [r.state, r.synced]), [['abandoned', false], ['abandoned', false]]);
  assert.match(after[0].error, /SUPERSEDED/);
  assert.match(after[1].error, /SUPERSEDED/);
});

test('a registry PR #31 leftover still applies when the file is the base it was prepared against', opts, async () => {
  await readyRow([file()], 'p01550');
  const root = sandbox({ [PATH]: V0 });

  const { replayAppliedChanges } = await loadReplay();
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.equal(report.status, 'ok');
  assert.equal(report.applied, 1);
  assert.equal(report.superseded, 0);
  assert.equal(read(root), V1);
  assert.deepEqual((await ledger()).map((r) => [r.state, r.error]), [['ready', null]]);
});

test('a later approval already on disk supersedes the earlier row and the boot stays healthy', opts, async () => {
  // The shape left after registry PR #31: an earlier desk write (p01426 on
  // OpenAI, and the same for IVADO and Rocket Pool) and a later approval
  // (p01550, p01551, p01553) whose bytes are already in the image. Replaying
  // the earlier row would roll the canonical file back, and deferring the
  // later one reported that healthy file as missing.
  const OTHER = 'registry/orgs/other.yaml';
  await readyRow([file()], 'p01426');
  await readyRow([file({ content_before_hash: sha256(V1), content_after: V2 })], 'p01550');
  await readyRow([{ path: OTHER, content_before_hash: null, content_after: V0 }], 'p00099');
  const root = sandbox({ [PATH]: V2 });
  const before = mtime(root);

  const { replayAppliedChanges } = await loadReplay();
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.equal(report.status, 'ok');
  assert.deepEqual(
    {
      applied: report.applied,
      already: report.alreadyApplied,
      failed: report.failed,
      deferred: report.deferred,
      superseded: report.superseded,
    },
    { applied: 1, already: 1, failed: 0, deferred: 0, superseded: 1 }
  );
  assert.equal(report.errors.length, 0);
  assert.equal(read(root), V2);
  assert.equal(mtime(root), before);
  assert.equal(read(root, OTHER), V0); // a path outside the superseded chain still replays
  const after = await ledger();
  assert.equal(after[0].state, 'abandoned');
  assert.equal(after[0].synced, false);
  assert.match(after[0].error, /SUPERSEDED/);
  assert.deepEqual(
    after.slice(1).map((r) => [r.state, r.synced, r.error]),
    [
      ['ready', false, null],
      ['ready', false, null],
    ]
  );
});

test('an already-applied row is a skip, not a write or a failure', opts, async () => {
  await readyRow([file()]);
  await sql(`UPDATE desk_applied_changes SET last_error = 'from an earlier boot' WHERE id = 1`);
  const root = sandbox({ [PATH]: V1 }); // already holds content_after

  const { replayAppliedChanges } = await loadReplay();
  const before = mtime(root);
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.deepEqual(
    { status: report.status, applied: report.applied, already: report.alreadyApplied, failed: report.failed },
    { status: 'ok', applied: 0, already: 1, failed: 0 }
  );
  assert.equal(mtime(root), before);
  assert.deepEqual(await ledger(), [{ id: 1, state: 'ready', synced: false, error: null }]); // repaired, still unsynced
});

test('a row this replay cannot trust is refused, and writes nothing outside root', opts, async () => {
  const OTHER = 'registry/orgs/other.yaml';
  // The three content_before_hash shapes are distinct: a hex string is "the
  // file held these bytes", null is "the file did not exist", an absent key
  // is a legacy row with no snapshot. Only the first can be verified.
  await readyRow([{ path: PATH, content_after: V1 }]); // legacy: no key at all
  await readyRow([{ path: OTHER, content_before_hash: null, content_after: V1 }], 'p00002'); // claims absent, but it exists
  await readyRow([{ path: 'registry/../../etc/passwd', content_before_hash: null, content_after: 'pwned\n' }], 'p00003');
  await readyRow([{ path: 'etc/passwd', content_before_hash: null, content_after: 'pwned\n' }], 'p00004');
  const root = sandbox({ [PATH]: V0, [OTHER]: V0 });

  const { replayAppliedChanges } = await loadReplay();
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.deepEqual({ failed: report.failed, applied: report.applied, deferred: report.deferred }, { failed: 4, applied: 0, deferred: 0 });
  assert.deepEqual([read(root), read(root, OTHER)], [V0, V0]);
  assert.equal(existsSync(join(root, 'etc', 'passwd')), false);
  assert.equal(existsSync(join(root, '..', 'etc', 'passwd')), false);
  const after = await ledger();
  assert.match(after[0].error, /legacy row has no base hash/);
  assert.match(after[1].error, /refusing to overwrite/);
  assert.match(after[2].error, /unsafe or invalid ledger path/);
  assert.match(after[3].error, /unsafe or invalid ledger path/);
});

test('a backlog past the per-boot limit degrades the report, it does not pass', opts, async () => {
  // Nothing here sets synced_at, so every boot re-selects the same oldest
  // rows: a tail past the limit is starved, not delayed. Reporting it as 'ok'
  // would be this replay's own failure mode — approvals that never reach the
  // disk, with the panel saying the boot was fine.
  const total = 502;
  await sql(
    `INSERT INTO desk_applied_changes (proposal_id, files, message, state)
     SELECT 'p' || n, jsonb_build_array(jsonb_build_object(
              'path', 'registry/orgs/bulk-' || n || '.yaml',
              'content_before_hash', null,
              'content_after', 'id: bulk-' || n || E'\n')),
            'apply p' || n, 'ready'
       FROM generate_series(1, $1) AS n`,
    [total]
  );
  const root = sandbox();

  const { replayAppliedChanges } = await loadReplay();
  const report = await replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });

  assert.deepEqual(
    { status: report.status, truncated: report.truncated, scanned: report.scanned, applied: report.applied },
    { status: 'degraded', truncated: true, scanned: 500, applied: 500 }
  );
  assert.match(report.errors[0], /exceeds the per-boot limit/); // and on /admin/health, not only in a container log
  assert.match(report.errors[0], /sync-desk-commits/); // names the one thing that can clear the window
  assert.equal(read(root, `registry/orgs/bulk-${total}.yaml`), null); // the starved tail
});

test('an absent outbox table is not an error', opts, async () => {
  const schema = 'gw_replay_empty';
  await sql(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  try {
    const url = new URL(TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const root = sandbox({ [PATH]: V0 });
    const { replayAppliedChanges } = await loadReplay();
    const report = await replayAppliedChanges({ root, connectionString: url.href });
    assert.equal(report.status, 'skipped');
    assert.deepEqual([report.scanned, report.applied, report.failed], [0, 0, 0]);
    assert.equal(read(root), V0);
  } finally {
    await sql(`DROP SCHEMA ${schema} CASCADE`);
  }
});

test('no connection string is a no-op, not a crash', opts, async () => {
  const root = sandbox({ [PATH]: V0 });
  const { replayAppliedChanges } = await loadReplay();
  const report = await replayAppliedChanges({ root, connectionString: '' });
  assert.equal(report.status, 'skipped');
  assert.equal(read(root), V0);
});

test('lastBootReplayReport is what /admin/health renders', opts, async () => {
  await readyRow([file()]);
  const root = sandbox({ [PATH]: V0 });
  const mod = await loadReplay();
  assert.equal(mod.lastBootReplayReport(), null); // never run on this instance
  const report = await mod.replayAppliedChanges({ root, connectionString: TEST_DATABASE_URL });
  assert.equal(mod.lastBootReplayReport(), report);
  assert.ok(mod.lastBootReplayReport().instance);
});

test('register() resolves even when a row cannot replay', opts, async () => {
  // A rejection out of register() is memoized into Next's preparedPromise and
  // 500s every route, including the health page that would explain it.
  await readyRow([file()]);
  const cwd = process.cwd();
  const root = sandbox({ [PATH]: 'diverged\n' });
  const env = { ...process.env };
  process.chdir(root);
  process.env.NEXT_RUNTIME = 'nodejs';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  delete process.env.INGEST_ENABLED; // the replay must not sit behind the ingest gate
  try {
    const { register } = await import('../src/instrumentation.ts');
    await assert.doesNotReject(register());
  } finally {
    process.chdir(cwd);
    process.env = env;
  }
  assert.equal(read(root), 'diverged\n');
  assert.match((await ledger())[0].error, /refusing to overwrite/);
});
