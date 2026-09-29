import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { poll, acknowledge } from '../scripts/read-wire-updates.mjs';
const token = 'test-only-reader-token-00000000000000000';
const row = (id, revision = 'a'.repeat(64)) => ({ id: `wire:${id}`, revision, title: 'Example', summary: 'A public grant', source_url: 'https://example.org', wire: 'oss', review_status: 'approved' });
const page = (data, next = null) => ({ data, meta: { version: 1, mode: 'full_scan', through_id: 100, next_after_id: next } });

test('HTTP reader baselines, retains pending work, acknowledges exact revisions and detects withdrawals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wire-reader-')); const path = join(dir, 'state.json');
  let payload = page([row(1)]), status = 200;
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = () => poll({ base, statePath: path, token });
  try {
    assert.deepEqual(await run(), { baseline: true, records: 1, pending: 0, pages: 1 });
    payload = page([row(1, 'b'.repeat(64)), row(2)]);
    assert.equal((await run()).pending, 2);
    assert.equal((await run()).pending, 2, 'fetching twice must not lose or duplicate unhandled drafts');
    await assert.rejects(acknowledge(path, 'wire:1', 'a'.repeat(64)));
    await acknowledge(path, 'wire:1', 'b'.repeat(64));
    assert.equal((await run()).pending, 1);
    const before = await readFile(path, 'utf8'); status = 503;
    await assert.rejects(run(), /HTTP 503/); assert.equal(await readFile(path, 'utf8'), before);
    status = 200; payload = page([row(2)]);
    await run(); const state = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(state.pending['wire:1'].kind, 'unavailable'); assert.equal(state.entries['wire:1'], undefined);
    assert.ok(!(await readFile(path, 'utf8')).includes(token));
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('partial, malformed, looping and over-budget pages cannot replace a complete snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wire-reader-')); const path = join(dir, 'state.json');
  const respond = body => Response.json(body);
  const options = { statePath: path, token, base: 'https://example.org' };
  try {
    await poll({ ...options, fetcher: async () => respond(page([row(1)])) });
    const before = await readFile(path, 'utf8');
    let calls = 0;
    await assert.rejects(poll({ ...options, fetcher: async () => ++calls === 1 ? respond(page([row(1)], 1)) : new Response('', { status: 401 }) }));
    for (const body of [page([row(1), row(1)]), page([row(1)], 0), { data: [], meta: {} }]) {
      await assert.rejects(poll({ ...options, fetcher: async () => respond(body) }));
    }
    await assert.rejects(poll({ ...options, maxPages: 1, fetcher: async (_url, init) => {
      assert.equal(init.redirect, 'error'); return respond(page([row(1)], 1));
    } }), /budget/);
    assert.equal(await readFile(path, 'utf8'), before);
    await assert.rejects(poll({ ...options, base: 'https://another.example', fetcher: async () => { throw new Error('Must not fetch'); } }), /another origin/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rate limit waits are bounded and retry the same page without losing state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wire-reader-')); const path = join(dir, 'state.json');
  let calls = 0; const waits = [], urls = [];
  const limited = () => new Response('', { status: 429, headers: { 'Retry-After': '60' } });
  const options = { statePath: path, token, wait: async ms => { waits.push(ms); } };
  try {
    await poll({ ...options, fetcher: async url => {
      urls.push(url.toString());
      return ++calls === 1 ? limited() : Response.json(page([row(1)]));
    } });
    assert.deepEqual(waits, [60000]); assert.equal(urls[0], urls[1]);
    const before = await readFile(path, 'utf8');
    calls = 0;
    await assert.rejects(poll({ ...options, fetcher: async () => { calls++; return limited(); } }), /HTTP 429/);
    assert.equal(calls, 3); assert.equal(await readFile(path, 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
