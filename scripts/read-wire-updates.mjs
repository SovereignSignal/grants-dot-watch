#!/usr/bin/env node
// One bounded poll per invocation. No publishing, daemon, Railway login or
// database access. The first complete poll establishes a historical baseline.
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^wire:[1-9]\d*$/;
function check(ok, message) { if (!ok) throw new Error(message); }

function origin(value) {
  const url = new URL(value);
  check((url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
    && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Use an HTTPS origin without credentials, path or query');
  return url.origin;
}

export function reconcile(previous, entries, base, fetchedAt) {
  if (previous) {
    check(previous.version === 1 && previous.origin === base && previous.entries && previous.pending
      && typeof previous.entries === 'object' && !Array.isArray(previous.entries)
      && typeof previous.pending === 'object' && !Array.isArray(previous.pending), 'Invalid state or different origin; preserve the file and investigate');
    for (const [id, row] of Object.entries(previous.entries)) check(ID.test(id) && row.id === id && HASH.test(row.revision), 'Invalid stored record');
  }
  const pending = { ...(previous?.pending || {}) };
  if (previous) {
    for (const [id, row] of Object.entries(entries)) {
      if (previous.entries[id]?.revision !== row.revision) pending[id] = {
        kind: previous.entries[id] ? 'updated' : 'new', revision: row.revision,
      };
    }
    for (const [id, row] of Object.entries(previous.entries)) {
      if (!entries[id]) pending[id] = { kind: 'unavailable', revision: row.revision };
    }
  }
  return { version: 1, origin: base, fetched_at: fetchedAt, entries, pending };
}

async function readState(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('State unreadable; existing checkpoint was preserved'); }
}
async function saveState(path, state) {
  const tmp = `${path}.${process.pid}.tmp`;
  const file = await open(tmp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(state, null, 2)); await file.sync(); }
  finally { await file.close(); }
  await rename(tmp, path);
}

export async function poll({ base = 'https://grants.watch', statePath, token, fetcher = fetch, maxPages = 100,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  base = origin(base);
  check(statePath, 'A state file is required');
  check(typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token), 'Set WIRE_ROOM_FEED_TOKEN through secure input');
  const previous = await readState(statePath);
  if (previous) check(previous.origin === base, 'State belongs to another origin');
  const entries = {};
  let after = 0, through, ratePauses = 0;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL('/api/v1/updates', base);
    url.searchParams.set('limit', '100');
    if (through !== undefined) {
      url.searchParams.set('after_id', String(after));
      url.searchParams.set('through_id', String(through));
    }
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (response.status === 429 && ratePauses < 2) {
      const retry = response.headers.get('retry-after');
      check(retry && /^\d+$/.test(retry) && Number(retry) >= 1 && Number(retry) <= 60, 'Invalid retry delay; checkpoint preserved');
      ratePauses++;
      await response.body?.cancel();
      await wait(Number(retry) * 1000);
      page--;
      continue;
    }
    check(response.ok, `Feed HTTP ${response.status}; checkpoint preserved`);
    const body = await response.json();
    check(Array.isArray(body.data) && body.data.length <= 100 && body.meta?.version === 1
      && body.meta.mode === 'full_scan' && Number.isSafeInteger(body.meta.through_id)
      && body.meta.through_id >= after && body.meta.through_id <= 2147483647, 'Invalid feed page');
    if (through === undefined) through = body.meta.through_id;
    check(through === body.meta.through_id, 'Feed upper bound changed');
    let last = after;
    for (const row of body.data) {
      check(row && ID.test(row.id) && HASH.test(row.revision) && typeof row.title === 'string'
        && typeof row.summary === 'string' && typeof row.source_url === 'string'
        && ['crypto', 'ai', 'oss'].includes(row.wire) && row.review_status === 'approved', 'Invalid feed record');
      const id = Number(row.id.slice(5));
      check(id > last && id <= through && !entries[row.id], 'Repeated or unordered feed ID');
      entries[row.id] = row; last = id;
    }
    const next = body.meta.next_after_id;
    if (next === null) {
      const state = reconcile(previous, entries, base, new Date().toISOString());
      await saveState(statePath, state);
      return { baseline: !previous, records: Object.keys(entries).length,
        pending: Object.keys(state.pending).length, pages: page + 1 };
    }
    check(Number.isSafeInteger(next) && next > after && next >= last && next <= through, 'Invalid pagination; checkpoint preserved');
    after = next;
  }
  throw new Error('Page budget exhausted; checkpoint preserved');
}

export async function acknowledge(statePath, id, revision) {
  check(ID.test(id || '') && HASH.test(revision || ''), 'Acknowledge requires the exact ID and revision');
  const state = await readState(statePath);
  check(state?.version === 1 && state.pending?.[id]?.revision === revision, 'Pending revision changed or does not exist');
  delete state.pending[id];
  await saveState(statePath, state);
}

async function main() {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i += 2) {
    check(['--state', '--base', '--ack', '--revision'].includes(args[i]) && args[i + 1]
      && !values[args[i]], 'Use --state FILE [--base ORIGIN] or --state FILE --ack ID --revision HASH');
    values[args[i]] = args[i + 1];
  }
  check(values['--state'], 'Use --state FILE');
  const path = resolve(values['--state']);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = await open(`${path}.lock`, 'wx', 0o600).catch(() => { throw new Error('Reader lock exists; check for an active or interrupted run'); });
  try {
    if (values['--ack']) {
      await acknowledge(path, values['--ack'], values['--revision']);
      console.log('Pending revision acknowledged. This is not a publication receipt.');
    } else {
      check(!values['--revision'], '--revision requires --ack');
      const result = await poll({ statePath: path, base: values['--base'], token: process.env.WIRE_ROOM_FEED_TOKEN });
      console.log(JSON.stringify(result));
    }
  } finally { await lock.close(); await unlink(`${path}.lock`); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Network/driver errors can include sensitive connection details. Keep the
    // CLI failure generic; test/library callers can inspect typed failures.
    console.error('Reader failed. Check access, feed availability, state and lock; do not discard the checkpoint.');
    process.exitCode = 1;
  });
}
