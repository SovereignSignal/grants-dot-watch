import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { lockDatabase, closePg, sandboxCwd, loadDeskStore, truncateDeskTables, skipWithoutPg, sql, sha256, TEST_DATABASE_URL } from './pg-helper.mjs';
const repo = process.cwd(); let root, store, mappings;
const original = JSON.stringify({ id: 'canonical', org: 'example' });
const path = 'registry/programs/canonical.yaml';
const proposal = { id: 'p1', signal_id: 'wire:1', lane: 'judgment', state: 'approved', proposed_change: { 'programs/retired.yaml': { summary: 'Obsolete contents' } } };
before(async () => {
  if (skipWithoutPg) return;
  await lockDatabase(); root = sandboxCwd(); mkdirSync('registry/programs', { recursive: true }); writeFileSync(path, original);
  store = await loadDeskStore(); await store.listProposals(); await truncateDeskTables();
  mappings = await import('../src/lib/wire-mappings.ts');
  await sql('INSERT INTO desk_proposals(id,data,lane,state,created_at) VALUES($1,$2::jsonb,$3,$4,now())', [proposal.id, JSON.stringify(proposal), proposal.lane, proposal.state]);
  await store.setIngestState('unrelated', { preserved: true });
});
after(async () => {
  if (skipWithoutPg) return;
  await truncateDeskTables(); await closePg(); process.chdir(repo); rmSync(root, { recursive: true, force: true });
});
test('Postgres mapping persists across a fresh process without touching registry, approvals, outbox or checkpoint', { skip: skipWithoutPg }, async () => {
  const packet = { version: 1, reviewed_by: 'Fixture reviewer', reviewed_at: '2026-09-25T00:00:00Z', mappings: [{ wire_id: 1, from_program_id: 'retired', to_program_id: 'canonical', expected_target_hash: sha256(original), expected_history_hash: mappings.wireHistoryHash(await store.listProposals(), 1), reason: 'Reviewed consolidation', evidence: ['https://example.org/grants'] }] };
  const before = (await sql('SELECT * FROM desk_proposals ORDER BY id')).rows;
  const preview = await mappings.reviewWireMappings(packet);
  assert.equal(await store.getIngestState(mappings.WIRE_MAPPING_STATE), null);
  await assert.rejects(mappings.reviewWireMappings(packet, { save: true, expectedPlan: 'wrong' }), /Plan changed/);
  // The shared advisory lock prevents another process from entering the write.
  await sql('SELECT pg_advisory_lock(8892011)');
  try { await assert.rejects(mappings.reviewWireMappings(packet), /Another intake/); }
  finally { await sql('SELECT pg_advisory_unlock(8892011)'); }
  await mappings.reviewWireMappings(packet, { save: true, expectedPlan: preview.plan_hash });
  assert.equal((await store.getIngestState(mappings.WIRE_MAPPING_STATE)).decisions.length, 1);
  const child = `import assert from 'node:assert/strict'; import {loadWireMappings} from ${JSON.stringify(resolve(repo, 'src/lib/wire-mappings.ts'))}; assert.equal((await loadWireMappings()).get(1),'canonical');`;
  execFileSync(process.execPath, ['--experimental-strip-types', '--experimental-loader', resolve(repo, 'tests/ts-loader.mjs'), '--input-type=module', '-e', child], { cwd: root, env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: (() => { const url = new URL(TEST_DATABASE_URL); url.searchParams.set('options', '-c default_transaction_read_only=on'); return url.href; })() }, stdio: 'pipe' });
  assert.deepEqual((await sql('SELECT * FROM desk_proposals ORDER BY id')).rows, before);
  assert.equal((await sql('SELECT count(*)::int n FROM desk_applied_changes')).rows[0].n, 0);
  assert.equal(await store.getIngestState('wire_handoff_v1'), null);
  assert.deepEqual(await store.getIngestState('unrelated'), { preserved: true });
  assert.equal(readFileSync(path, 'utf8'), original);
});
