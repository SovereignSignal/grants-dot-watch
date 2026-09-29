import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReaderGate } from '../src/lib/reader-auth.ts';
import { parseUpdatePage, publicUpdate, readUpdatePage, serveUpdates } from '../src/lib/wire-updates.ts';

const TOKEN = 'unit-test-only-token-000000000000000000';
const hash = createHash('sha256').update(TOKEN).digest('hex');
const keys = JSON.stringify([{ id: 'test-reader', sha256: hash, expires_at: '2099-01-01T00:00:00Z' }]);
const request = (query = '', token = TOKEN) => new Request(`https://example.com/api/v1/updates${query}`, { headers: { Authorization: `Bearer ${token}` } });
const row = { id: 4, name: 'Research grants', description: 'Public call for applications', source_url: 'https://example.org/call', wire: 'ai', amount: null, deadline: null, deadline_iso: null, classification: 'GRANT', discovered_at: '2026-01-01T00:00:00.000000Z', changed_at: '2026-01-02T00:00:00.000000Z' };

test('reader keys fail closed, expire, revoke and never accept admin/session credentials', () => {
  let config = keys, now = Date.parse('2026-01-01');
  const gate = createReaderGate(() => config, () => now);
  assert.equal(gate(request()).client, 'test-reader');
  assert.equal(gate(request('', 'wrong')).response.status, 401);
  assert.equal(gate(new Request('https://example.com', { headers: { Cookie: `desk_token=${TOKEN}`, 'x-admin-token': TOKEN } })).response.status, 401);
  config = '[]'; assert.equal(gate(request()).response.status, 503);
  config = '{broken'; assert.equal(gate(request()).response.status, 503);
  config = keys; now = Date.parse('2099-01-01'); assert.equal(gate(request()).response.status, 401);
  config = JSON.stringify([{ id: 'test-reader', sha256: 'bad', expires_at: '2099-01-01' }]);
  assert.equal(gate(request()).response.status, 503);
});

test('per-client budget returns Retry-After and recovers after the window', () => {
  let now = 0; const gate = createReaderGate(() => keys, () => now);
  for (let n = 0; n < 60; n++) assert.equal(gate(request()).client, 'test-reader');
  const blocked = gate(request()).response;
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('Retry-After'), '60');
  now = 60000; assert.equal(gate(request()).client, 'test-reader');
});

test('strict keyset pagination rejects malformed, duplicate and unsupported parameters', () => {
  assert.deepEqual(parseUpdatePage(new URLSearchParams()), { after: 0, through: undefined, limit: 100 });
  for (const query of ['limit=101', 'limit=0', 'after_id=-1', 'after_id=1', 'through_id=4&after_id=5', 'wire=ai', 'limit=1&limit=2', 'after_id=1e3', 'through_id=999999999999']) {
    assert.throws(() => parseUpdatePage(new URLSearchParams(query)), query);
  }
});

test('projection excludes private fields and unsupported identity; revision tracks public content only', () => {
  const poisoned = { ...row, metadata: { secret: 'CANARY' }, operator_notes: 'CANARY', enriched_summary: 'CANARY', api_key: 'CANARY', org_name: 'Unreviewed guess' };
  const record = publicUpdate(poisoned, new Map([[4, 'missing-program']]), new Set());
  assert.ok(!JSON.stringify(record).includes('CANARY'));
  assert.ok(!JSON.stringify(record).includes('Unreviewed'));
  assert.equal(record.program_id, null); assert.equal(record.source_verified_at, null);
  assert.equal(publicUpdate({ ...row, changed_at: 'later' }, new Map(), new Set()).revision, record.revision);
  assert.notEqual(publicUpdate({ ...row, amount: '$10,000' }, new Map(), new Set()).revision, record.revision);
  assert.notEqual(publicUpdate(row, new Map([[4, 'reviewed']]), new Set(['reviewed'])).revision, record.revision);
  assert.equal(publicUpdate({ ...row, source_url: 'https://user:password@example.org' }, new Map(), new Set()), null);
});

test('page reads use a read-only transaction and preserve pagination when projection skips invalid URLs', async () => {
  const calls = []; let released = false;
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('MAX(id)')) return { rows: [{ id: 12 }] };
    if (sql.includes('SELECT id,')) return { rows: [row, { ...row, id: 7 }] };
    return { rows: [] };
  }, release: () => { released = true; } };
  const result = await readUpdatePage({ after: 0, limit: 1 }, { connect: async () => client });
  assert.equal(result.next, 4); assert.equal(result.through, 12);
  assert.equal(calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(calls[2].params, [0, 12, 2]);
  assert.equal(calls.at(-1).sql, 'ROLLBACK'); assert.ok(released);
});

test('HTTP service authenticates before reads, reports failure honestly and logs no secrets or prose', async () => {
  const logs = []; let reads = 0;
  const deps = { authorize: createReaderGate(() => keys), read: async () => { reads++; return { rows: [row], through: 4, next: null }; }, mappings: async () => new Map(), programs: () => new Set(), log: r => logs.push(r) };
  assert.equal((await serveUpdates(request('', 'wrong'), undefined, deps)).status, 401); assert.equal(reads, 0);
  const result = await serveUpdates(request(), undefined, deps);
  assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await result.json()).data[0].id, 'wire:4');
  assert.ok(!JSON.stringify(logs).includes(TOKEN)); assert.ok(!JSON.stringify(logs).includes(row.description));
  deps.read = async () => { throw new Error('database password CANARY'); };
  const failed = await serveUpdates(request(), undefined, deps);
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('CANARY'));
  deps.read = async () => ({ rows: [], through: 4, next: null });
  assert.equal((await serveUpdates(request(), '4', deps)).status, 404);
  assert.equal((await serveUpdates(request(), '4 UNION SELECT', deps)).status, 400);
});
