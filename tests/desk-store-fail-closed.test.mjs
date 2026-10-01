// Change 2: desk-store must refuse the ephemeral local JSON file in
// production rather than accept approvals that die with the container. The
// guard fires on first store access, never at module load — admin/health's
// page module imports desk-store at module scope and `next build` evaluates
// page modules, so a load-time throw would break the build.
//
// No database: this runs in the default `npm test`, and it is the only place
// any test exercises NODE_ENV=production, so every dispatch site is listed by
// hand. A site that misses the guard fails nothing otherwise.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const originalCwd = process.cwd();
const originalEnv = { ...process.env };
// desk-store captures REPO_ROOT = process.cwd() at module scope and will
// import a .data/desk.json it finds there. Run from a throwaway directory.
const sandbox = mkdtempSync(join(tmpdir(), 'grants-watch-failclosed-'));
process.chdir(sandbox);

after(() => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
  rmSync(sandbox, { recursive: true, force: true });
});

/** DATABASE_URL is read once per module instance at module scope, so each
 *  case needs its own instance — the tests/write-safety.test.mjs:192 pattern. */
async function loadStore(env) {
  delete process.env.DATABASE_URL;
  delete process.env.NODE_ENV;
  delete process.env.GRANTS_WATCH_ALLOW_LOCAL_STORE;
  Object.assign(process.env, env);
  return import(`../src/lib/desk-store.ts?fail-closed=${Math.random()}`);
}

const entry = {
  proposal_id: 'p00001',
  files: [{ path: 'registry/orgs/acme.yaml', content_before_hash: null, content_after: 'id: acme\n' }],
  message: 'apply p00001',
};

test('the production guard fires on first access, not at import', async () => {
  // Importing must succeed: this is what protects `next build`.
  const store = await loadStore({ NODE_ENV: 'production' });

  // Every dispatch site that branches on the backend, named one by one.
  const calls = [
    ['seedFromFiles', () => store.seedFromFiles()],
    ['listProposals', () => store.listProposals()],
    ['getProposal', () => store.getProposal('p00001')],
    ['listVerdicts', () => store.listVerdicts()],
    ['queueCounts', () => store.queueCounts()],
    ['recordVerdict', () => store.recordVerdict('p00001', 'approved')],
    ['setProposalValidation', () => store.setProposalValidation('p00001', undefined)],
    ['saveCuratorReview', () => store.saveCuratorReview('p00001', {
      verdict: 'reject',
      reason: 'Not a grant.',
      sources: [{ url: 'https://example.org/grants', quote: 'Example quote.' }],
      key_id: 'hedwig',
      key_name: 'Hedwig',
      at: '2026-06-01T00:00:00.000Z',
    })],
    ['claimProposal', () => store.claimProposal('p00001')],
    ['releaseProposalClaim', () => store.releaseProposalClaim('p00001')],
    ['recoverStaleProposalClaims', () => store.recoverStaleProposalClaims()],
    ['insertIngestProposals', () => store.insertIngestProposals([])],
    ['getIngestState', () => store.getIngestState('last_run')],
    ['setIngestState', () => store.setIngestState('last_run', {})],
    ['recordAppliedChanges', () => store.recordAppliedChanges(entry)],
    ['getAppliedChangeLedgerHealth', () => store.getAppliedChangeLedgerHealth()],
  ];
  for (const [name, call] of calls) {
    await assert.rejects(call, /DATABASE_URL/, `${name} must fail closed in production`);
  }

  // withIngestLock must refuse rather than run `fn`
  // against a store that cannot durably record what `fn` does.
  let ran = false;
  await assert.rejects(store.withIngestLock(async () => (ran = true)), /DATABASE_URL/);
  assert.equal(ran, false);
});

test('the backend probe never throws, so the health page can report the fault', async () => {
  const store = await loadStore({ NODE_ENV: 'production' });
  assert.equal(store.storeBackend(), 'unconfigured');
});

test('the named opt-out re-enables the local backend', async () => {
  // playwright.config.ts depends on this: `npm start` sets NODE_ENV=production
  // and the browser suite deliberately runs with no database.
  const store = await loadStore({ NODE_ENV: 'production', GRANTS_WATCH_ALLOW_LOCAL_STORE: '1' });
  assert.equal(store.storeBackend(), 'local');
  assert.deepEqual(await store.getAppliedChangeLedgerHealth(), { ready: 0, prepared: 0, conflicts: 0, oldestReadyAt: null });
  assert.deepEqual(await store.listProposals(), []);
});

test('the guard does not fire outside production', async () => {
  // What keeps the existing suite's meaning: local dev is still JSON-backed.
  const store = await loadStore({});
  assert.equal(store.storeBackend(), 'local');
  assert.deepEqual(await store.listProposals(), []);
  assert.equal(await store.getIngestState('last_run'), null);
  assert.deepEqual(await store.withIngestLock(async () => 'ran'), { ran: true, result: 'ran' });
});

test('boot replay with no connection string is a no-op', async () => {
  // Every `npm start` without a database takes this path, including the
  // Playwright web server.
  delete process.env.DATABASE_URL;
  const { replayAppliedChanges, lastBootReplayReport } = await import('../src/lib/boot-replay.ts');
  delete globalThis[Symbol.for('grants-watch.boot-replay')];
  const report = await replayAppliedChanges({ root: sandbox });
  assert.equal(report.status, 'skipped');
  assert.deepEqual([report.scanned, report.applied, report.failed, report.deferred], [0, 0, 0, 0]);
  assert.equal(lastBootReplayReport(), report);
  delete globalThis[Symbol.for('grants-watch.boot-replay')];
});
