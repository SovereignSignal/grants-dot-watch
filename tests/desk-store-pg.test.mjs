// Characterization of desk-store's Postgres backend — the column no test
// covered until now. These pin what the code does TODAY, including the parts
// that are about to change (the same-path ledger guard, the try-and-skip
// ingest lock), so a later pass can tell a deliberate change from a break.
// Needs a throwaway database in TEST_DATABASE_URL; skips without one, so
// `npm test` stays database-free.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test, { after, before, beforeEach } from 'node:test';

import {
  closePg,
  loadDeskStore,
  lockDatabase,
  row,
  rows,
  sandboxCwd,
  sha256,
  skipWithoutPg,
  sql,
  truncateDeskTables,
} from './pg-helper.mjs';

const opts = { skip: skipWithoutPg };
const originalCwd = process.cwd();
const sandbox = skipWithoutPg ? null : sandboxCwd();
const store = skipWithoutPg ? null : await loadDeskStore();

before(async () => {
  if (skipWithoutPg) return;
  await lockDatabase(); // before the warmup: that one goes through desk-store's own pool, not sql()
  await store.getIngestState('__warmup'); // ensureSchema self-provisions the tables truncate needs
  await truncateDeskTables();
});

beforeEach(async () => {
  if (skipWithoutPg) return;
  await truncateDeskTables();
});

after(async () => {
  if (skipWithoutPg) return;
  await truncateDeskTables();
  await closePg();
  process.chdir(originalCwd);
  rmSync(sandbox, { recursive: true, force: true });
});

const PATH = 'registry/orgs/acme.yaml';
const BEFORE = 'id: acme\n';
const AFTER = 'id: acme\nname: Acme Foundation\n';

const candidate = (over = {}) => ({
  type: 'new_org',
  org: 'acme',
  org_name: 'Acme Foundation',
  title: 'Acme Foundation funds open source',
  summary: 'A new funder appeared on the oss wire.',
  evidence_url: 'https://example.org/acme',
  signal_id: 1,
  wire: 'oss',
  ...over,
});

const fact = (over = {}) =>
  candidate({
    type: 'round_update',
    program: 'acme-fund',
    title: 'Acme round two opens',
    summary: 'A dated round update carrying official evidence.',
    signal_id: 2,
    ...over,
  });

const ledgerEntry = (over = {}) => ({
  proposal_id: 'p00001',
  files: [{ path: PATH, content_before_hash: null, content_after: BEFORE }],
  message: 'apply p00001',
  ...over,
});

const chainedEntry = () =>
  ledgerEntry({
    proposal_id: 'p00002',
    files: [{ path: PATH, content_before_hash: sha256(BEFORE), content_after: AFTER }],
    message: 'apply p00002',
  });

const ledgerStates = async () =>
  (await rows('SELECT id, state, synced_at FROM desk_applied_changes ORDER BY id ASC')).map((r) => ({
    id: r.id,
    state: r.state,
    synced_at: r.synced_at,
  }));

const insertOne = async (over) => (await store.insertIngestProposals([candidate(over)])).inserted[0];

const backdateClaim = (id) =>
  sql(
    `UPDATE desk_proposals SET data = jsonb_set(data, '{applying_at}', to_jsonb((now() - interval '1 hour')::text)) WHERE id = $1`,
    [id]
  );

test('ensureSchema is idempotent across repeated calls and a second module instance', opts, async () => {
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.getIngestState(`warm-${i}`)));
  // A fresh module instance has its own unmemoized ensureSchema, so this
  // re-runs the whole DDL against a database that already has every table —
  // the second-replica case.
  const fresh = await loadDeskStore({ fresh: true });
  assert.equal(await fresh.getIngestState('warm-0'), null);
  const present = (
    await rows(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY 1`,
      [['desk_applied_changes', 'desk_proposals', 'desk_verdicts', 'ingest_state']]
    )
  ).map((r) => r.table_name);
  assert.deepEqual(present, ['desk_applied_changes', 'desk_proposals', 'desk_verdicts', 'ingest_state']);
  assert.equal((await row(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'idx_desk_applied_changes_ready'`)).n, 1);
});

test('insertIngestProposals round-trips through listProposals and skips repeats', opts, async () => {
  const first = await store.insertIngestProposals([candidate(), fact()]);
  assert.deepEqual(first.inserted.map((p) => p.id), ['p00001', 'p00002']);
  assert.deepEqual(first.inserted.map((p) => p.lane), ['judgment', 'fact']);
  assert.deepEqual(first.inserted.map((p) => p.state), ['pending', 'pending']);
  assert.equal(first.skipped, 0);

  assert.deepEqual((await store.listProposals()).map((p) => p.id).sort(), ['p00001', 'p00002']);
  assert.deepEqual((await store.listProposals({ lane: 'fact' })).map((p) => p.id), ['p00002']);
  assert.deepEqual((await store.listProposals({ state: 'approved' })), []);
  // The returned object is the in-memory one, which carries explicit
  // `proposed_change: undefined` / `confidence: undefined`; jsonb drops those
  // keys, so a read-back is the JSON normalization of it, not the same shape.
  assert.deepEqual(await store.getProposal('p00002'), JSON.parse(JSON.stringify(first.inserted[1])));
  assert.equal('proposed_change' in first.inserted[1], true);
  assert.equal('proposed_change' in (await store.getProposal('p00002')), false);
  assert.equal(await store.getProposal('p99999'), null);

  // Same signal ref on both -> nothing new.
  assert.deepEqual(await store.insertIngestProposals([candidate(), fact()]), { inserted: [], skipped: 2 });

  // A new signal ref still dedupes one-shot types by (type, org); fact types
  // are deliberately excluded, so a second dated update lands.
  const mixed = await store.insertIngestProposals([candidate({ signal_id: 99 }), fact({ signal_id: 98, title: 'Acme round three opens' })]);
  assert.equal(mixed.skipped, 1);
  assert.deepEqual(mixed.inserted.map((p) => [p.id, p.type]), [['p00003', 'round_update']]);

  assert.deepEqual(await store.queueCounts(), { pendingJudgment: 1, pendingFact: 2, decidedToday: 0, total: 3 });
});

test('recordVerdict logs a verdict and moves the proposal out of pending', opts, async () => {
  const p = await insertOne();
  const { proposal, verdict } = await store.recordVerdict(p.id, 'approved', { note: 'checked the source', by: 'owner' });
  assert.equal(proposal.state, 'approved');
  assert.ok(proposal.decided_at);
  assert.equal(proposal.decision_note, 'checked the source');
  assert.deepEqual([verdict.proposal_id, verdict.decision, verdict.commit, verdict.by], [p.id, 'approved', null, 'owner']);

  assert.deepEqual(await store.listProposals({ state: 'pending' }), []);
  assert.equal((await store.getProposal(p.id)).state, 'approved');
  assert.deepEqual((await store.listVerdicts()).map((v) => v.decision), ['approved']);
  assert.equal((await store.queueCounts()).decidedToday, 1);

  await assert.rejects(store.recordVerdict(p.id, 'rejected'), /proposal p00001 is no longer pending/);
  assert.equal((await store.listVerdicts()).length, 1);
  await assert.rejects(store.recordVerdict('p99999', 'approved'), /proposal not found/);
});

test('claimProposal is a one-shot lease that release restores', opts, async () => {
  const p = await insertOne();
  const claimed = await store.claimProposal(p.id);
  assert.equal(claimed.state, 'applying');
  assert.ok(claimed.applying_at);
  assert.equal(await store.claimProposal(p.id), null);

  assert.equal(await store.releaseProposalClaim(p.id), true);
  const released = await store.getProposal(p.id);
  assert.equal(released.state, 'pending');
  assert.equal(released.applying_at, undefined);
  assert.equal(await store.releaseProposalClaim(p.id), false);
  assert.ok(await store.claimProposal(p.id));
});

test('the stale-claim sweep quarantines an aged claim instead of releasing it', opts, async () => {
  const p = await insertOne();
  await store.claimProposal(p.id);
  await backdateClaim(p.id);

  assert.equal(await store.recoverStaleProposalClaims(), 1);
  const swept = await row('SELECT state, data FROM desk_proposals WHERE id = $1', [p.id]);
  assert.equal(swept.state, 'applying'); // still owned — a human reconciles, the sweep does not release
  assert.equal(swept.data.validation.checks[0].name, 'apply-reconciliation-required');
  assert.equal(await store.recoverStaleProposalClaims(), 0); // idempotent, guarded on that check name
});

test('listProposals and getProposal run the stale-claim sweep as a read side effect', opts, async () => {
  const p = await insertOne();
  await store.claimProposal(p.id);
  await backdateClaim(p.id);

  const read = await store.getProposal(p.id); // the read itself quarantines
  assert.equal(read.validation.checks[0].name, 'apply-reconciliation-required');
  assert.equal(await store.recoverStaleProposalClaims(), 0);
});

test('two concurrent approvals of one proposal: exactly one wins', opts, async () => {
  const p = await insertOne();
  const settled = await Promise.allSettled([
    store.recordVerdict(p.id, 'approved', { note: 'first' }),
    store.recordVerdict(p.id, 'approved', { note: 'second' }),
  ]);
  assert.deepEqual(settled.map((s) => s.status).sort(), ['fulfilled', 'rejected']);
  assert.match(settled.find((s) => s.status === 'rejected').reason.message, /no longer pending/);
  assert.equal((await store.listVerdicts()).length, 1);
  assert.equal((await row('SELECT state FROM desk_proposals WHERE id = $1', [p.id])).state, 'approved');
});

test('two concurrent claims of one proposal: exactly one owns it', opts, async () => {
  const p = await insertOne();
  const claims = await Promise.all([store.claimProposal(p.id), store.claimProposal(p.id)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await row('SELECT state FROM desk_proposals WHERE id = $1', [p.id])).state, 'applying');
});

test('the applied-change ledger walks prepared -> ready and never sets synced_at', opts, async () => {
  const p = await insertOne();
  await store.claimProposal(p.id);

  const receipt = await store.recordAppliedChanges(ledgerEntry({ proposal_id: p.id }), 'prepared');
  assert.deepEqual(receipt, { backend: 'postgres', id: 1, state: 'prepared' });
  assert.deepEqual(await ledgerStates(), [{ id: 1, state: 'prepared', synced_at: null }]);
  assert.deepEqual(await store.getAppliedChangeLedgerHealth(), { ready: 0, prepared: 1, conflicts: 0, oldestReadyAt: null });

  await store.recordVerdict(p.id, 'approved', { from: 'applying', ledgerRequired: true });
  assert.deepEqual(await ledgerStates(), [{ id: 1, state: 'ready', synced_at: null }]);
  const health = await store.getAppliedChangeLedgerHealth();
  assert.deepEqual([health.ready, health.prepared, health.conflicts], [1, 0, 0]);
  assert.ok(health.oldestReadyAt);

  // synced_at belongs to scripts/sync-desk-commits.mjs alone; nothing under
  // src/ ever writes it, so the git archival still has work to do.
  assert.equal((await row('SELECT count(*)::int AS n FROM desk_applied_changes WHERE synced_at IS NOT NULL')).n, 0);
});

test('reject abandons a prepared ledger row', opts, async () => {
  const p = await insertOne();
  await store.claimProposal(p.id);
  await store.recordAppliedChanges(ledgerEntry({ proposal_id: p.id }), 'prepared');
  await store.recordVerdict(p.id, 'rejected', { from: 'applying' });
  assert.deepEqual(await ledgerStates(), [{ id: 1, state: 'abandoned', synced_at: null }]);
  assert.equal((await store.getAppliedChangeLedgerHealth()).prepared, 0);
});

test('a fresh claim and a release both void an earlier prepared intent', opts, async () => {
  const p = await insertOne();
  await store.recordAppliedChanges(ledgerEntry({ proposal_id: p.id }), 'prepared');
  await store.claimProposal(p.id);
  assert.deepEqual(await ledgerStates(), [{ id: 1, state: 'abandoned', synced_at: null }]);

  await store.recordAppliedChanges(ledgerEntry({ proposal_id: p.id, files: [{ path: 'registry/orgs/other.yaml', content_before_hash: null, content_after: BEFORE }] }), 'prepared');
  await store.releaseProposalClaim(p.id);
  assert.deepEqual((await ledgerStates()).map((r) => r.state), ['abandoned', 'abandoned']);
});

test('ledgerRequired rolls the whole verdict back when no prepared row exists', opts, async () => {
  const p = await insertOne();
  await store.claimProposal(p.id);
  await assert.rejects(
    store.recordVerdict(p.id, 'approved', { from: 'applying', ledgerRequired: true }),
    /has no prepared durable ledger entry/
  );
  assert.equal((await row('SELECT state FROM desk_proposals WHERE id = $1', [p.id])).state, 'applying');
  assert.equal((await store.listVerdicts()).length, 0);
});

test('the same-path guard refuses a fork and admits a legitimate chain', opts, async () => {
  assert.equal((await store.recordAppliedChanges(ledgerEntry(), 'prepared')).id, 1);

  // A 'prepared' row is uncommitted intent that a reject, a re-claim or a
  // release can still abandon, so nothing may chain onto it: the chained row
  // would name a base no replay ever produces.
  await assert.rejects(
    store.recordAppliedChanges(chainedEntry(), 'prepared'),
    /registry path has unsynced Desk ledger row 1 \(p00001\): that row is still prepared/
  );

  // Once row 1 is 'ready' the chain is legitimate: its base hash IS row 1's
  // content_after, so applying rows in id order reproduces it. This is the
  // assertion Change 3 inverted. Before it, the first approval to a file
  // blocked every later approval to that file until a human ran the sync
  // script — and boot replay never sets synced_at, so in production that wait
  // was unbounded.
  await sql(`UPDATE desk_applied_changes SET state = 'ready' WHERE id = 1`);
  assert.equal((await store.recordAppliedChanges(chainedEntry(), 'prepared')).id, 2);
  assert.equal((await ledgerStates()).length, 2);

  // A genuine fork — prepared against row 2's base rather than its result —
  // still throws, naming the row it conflicts with.
  await sql(`UPDATE desk_applied_changes SET state = 'ready' WHERE id = 2`);
  await assert.rejects(
    store.recordAppliedChanges(chainedEntry(), 'prepared'),
    /unsynced Desk ledger row 2 \(p00002\): this change was prepared against different bytes/
  );
  assert.equal((await ledgerStates()).length, 2);

  // Only an unsynced prepared/ready row blocks: abandoned and synced do not.
  // Ids continue off the serial, which TRUNCATE ... RESTART IDENTITY reset.
  await sql(`UPDATE desk_applied_changes SET state = 'abandoned' WHERE id IN (1, 2)`);
  assert.equal((await store.recordAppliedChanges(chainedEntry(), 'prepared')).id, 3);
  await sql(`UPDATE desk_applied_changes SET synced_at = now(), state = 'ready' WHERE id = 3`);
  assert.equal((await store.recordAppliedChanges(chainedEntry(), 'prepared')).id, 4);

  // An unrelated path was never in scope.
  const elsewhere = ledgerEntry({ files: [{ path: 'registry/orgs/other.yaml', content_before_hash: null, content_after: BEFORE }] });
  assert.equal((await store.recordAppliedChanges(elsewhere, 'prepared')).id, 5);
});

test('chaining onto a ready row requires the exact base hash', opts, async () => {
  await store.recordAppliedChanges(ledgerEntry(), 'prepared');
  await sql(`UPDATE desk_applied_changes SET state = 'ready' WHERE id = 1`);
  const onto = (over) => store.recordAppliedChanges(ledgerEntry({ proposal_id: 'p00002', files: [{ path: PATH, ...over }] }), 'prepared');

  // The three content_before_hash shapes are distinct and only a hex string
  // can follow an existing row.
  await assert.rejects(onto({ content_before_hash: null, content_after: AFTER }), /row 1 \(p00001\): this change claims the path does not exist yet/);
  await assert.rejects(onto({ content_after: AFTER }), /row 1 \(p00001\): this change carries no base hash/);
  await assert.rejects(onto({ content_before_hash: sha256(AFTER), content_after: AFTER }), /row 1 \(p00001\): this change was prepared against different bytes/);
  assert.equal((await ledgerStates()).length, 1);

  assert.equal((await onto({ content_before_hash: sha256(BEFORE), content_after: AFTER })).id, 2);
});

test('a multi-path row must chain on every path it touches', opts, async () => {
  const OTHER = 'registry/orgs/other.yaml';
  await store.recordAppliedChanges(ledgerEntry(), 'prepared');
  await store.recordAppliedChanges(
    ledgerEntry({ proposal_id: 'p00002', files: [{ path: OTHER, content_before_hash: null, content_after: BEFORE }] }),
    'prepared'
  );
  await sql(`UPDATE desk_applied_changes SET state = 'ready' WHERE id IN (1, 2)`);

  // One path chains, the other forks: the whole insert rolls back.
  await assert.rejects(
    store.recordAppliedChanges(
      ledgerEntry({
        proposal_id: 'p00003',
        files: [
          { path: PATH, content_before_hash: sha256(BEFORE), content_after: AFTER },
          { path: OTHER, content_before_hash: sha256(AFTER), content_after: AFTER },
        ],
      }),
      'prepared'
    ),
    /unsynced Desk ledger row 2 \(p00002\): this change was prepared against different bytes/
  );
  assert.equal((await ledgerStates()).length, 2);
});

test('storeBackend reports the live backend', opts, async () => {
  assert.equal(store.storeBackend(), 'postgres'); // the value /admin/health renders
});

test('the plain ready insert path takes no lock and runs no same-path check', opts, async () => {
  await store.recordAppliedChanges(ledgerEntry(), 'prepared');
  const unguarded = await store.recordAppliedChanges(ledgerEntry({ proposal_id: 'p00002' }));
  assert.deepEqual(unguarded, { backend: 'postgres', id: 2, state: 'ready' });
  assert.deepEqual((await ledgerStates()).map((r) => r.state), ['prepared', 'ready']);
});

test('withIngestLock is try-and-skip: the second concurrent caller never runs', opts, async () => {
  const ran = [];
  const body = (name) => async () => {
    ran.push(name);
    await new Promise((r) => setTimeout(r, 60));
    return name;
  };
  const results = await Promise.all([store.withIngestLock(body('a')), store.withIngestLock(body('b'))]);
  assert.equal(results.filter((r) => r.ran).length, 1);
  assert.equal(ran.length, 1); // the loser's fn is never called, it is not queued behind the winner
  assert.equal(results.find((r) => !r.ran).result, undefined);
  assert.deepEqual(await store.withIngestLock(async () => 'c'), { ran: true, result: 'c' }); // released, so a later call runs
});

test('the ingest advisory lock is a real cross-session Postgres lock', opts, async () => {
  await sql('SELECT pg_advisory_lock($1)', [8892011]); // an outside session, standing in for another replica
  try {
    assert.deepEqual(await store.withIngestLock(async () => 'never'), { ran: false });
    assert.equal(
      (await row('SELECT count(*)::int AS n FROM pg_locks WHERE locktype = $1 AND objid = $2 AND granted', ['advisory', 8892011])).n,
      1
    );
  } finally {
    await sql('SELECT pg_advisory_unlock($1)', [8892011]);
  }
  assert.deepEqual(await store.withIngestLock(async () => 'now'), { ran: true, result: 'now' });
});

test('ingest_state upserts by key', opts, async () => {
  assert.equal(await store.getIngestState('watermark'), null);
  await store.setIngestState('watermark', { signal_id: 41 });
  assert.deepEqual(await store.getIngestState('watermark'), { signal_id: 41 });
  await store.setIngestState('watermark', { signal_id: 42 });
  assert.deepEqual(await store.getIngestState('watermark'), { signal_id: 42 });
  assert.equal((await row('SELECT count(*)::int AS n FROM ingest_state')).n, 1);
});
