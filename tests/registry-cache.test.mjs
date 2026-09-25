// The registry index is cached in memory. It was keyed on the product date
// alone, so a write made outside this process — boot replay, a sync-desk-commits
// run, a git pull, a hand edit — stayed invisible for up to a Pacific day. These
// tests pin the new bound and, just as importantly, pin what must NOT change:
// the day rollover the date key was quietly also providing, and the explicit
// invalidation an in-process Desk write relies on. Every test runs against a
// fixture registry in a temp dir, spawned with that dir as cwd (registry.ts
// resolves ROOT from process.cwd()), so the real registry/ is never read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY_MODULE = new URL('../src/lib/registry.ts', import.meta.url).href;
const LOADER = new URL('./ts-loader.mjs', import.meta.url).href;
const NODE_ARGS = ['--no-warnings', '--experimental-strip-types', '--experimental-loader', LOADER];

// One org, one program with a round that is live on 2026-09-21 and not on the
// 22nd — that single day-step is what proves live_rounds still rolls over.
function fixture(name = 'First Name', extraPrograms = 0) {
  const root = mkdtempSync(join(tmpdir(), 'grants-watch-cache-'));
  for (const sub of ['systems', 'orgs', 'programs', 'awards']) mkdirSync(join(root, 'registry', sub), { recursive: true });
  // Some tests need a rebuild to be plainly distinguishable from a probe, so
  // they pad the fixture toward the real registry's 485 programs.
  for (let i = 0; i < extraPrograms; i++) writeFileSync(join(root, `registry/programs/bulk-${i}.yaml`), `id: bulk-${i}\nname: Bulk ${i}\norg: example\nstatus: active\nwires: [oss]\n`);
  writeFileSync(join(root, 'registry/systems/sys.yaml'), 'id: sys\nname: Example System\n');
  writeFileSync(join(root, 'registry/orgs/example.yaml'), 'id: example\nname: Example Foundation\nroles: [funder]\nsystems: [sys]\n');
  writeFileSync(join(root, 'registry/programs/fund.yaml'), programYaml(name));
  writeFileSync(join(root, 'registry/awards/2026.jsonl'), JSON.stringify({ funder: 'example', grantee: 'someone', amount: 1000, date: '2026-01-01' }) + '\n');
  writeFileSync(join(root, 'probe.mjs'), PROBE);
  return root;
}
const programYaml = (name) => `id: fund\nname: ${name}\norg: example\nstatus: active\nwires: [oss]\nrounds:\n  - name: Window\n    status: open\n    closes: '2026-09-21'\n`;
const run = (root, mode, env = {}) => {
  const r = spawnSync(process.execPath, [...NODE_ARGS, join(root, 'probe.mjs'), mode], { cwd: root, encoding: 'utf8', env: { ...process.env, REGISTRY_MODULE, ...env } });
  assert.equal(r.status, 0, `probe ${mode} failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};

// The child. Kept in one string so the suite stays a single file and the fixture
// dir holds everything the spawned process touches.
const PROBE = `
const { loadRegistry, invalidateRegistryCache } = await import(process.env.REGISTRY_MODULE);
const { writeFileSync, readFileSync, statSync, utimesSync } = await import('node:fs');
const { performance } = await import('node:perf_hooks');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const out = (o) => console.log(JSON.stringify(o));
const name = () => loadRegistry().programs[0].name;
const mode = process.argv[2];

if (mode === 'wait-for-outside-write') {
  // A second process rewrites the program file. Nothing tells this cache.
  const before = name();
  writeFileSync('ready', '1');
  const deadline = Date.now() + 20000;
  let polls = 0;
  while (Date.now() < deadline) {
    polls++;
    if (name() !== before) break;
    sleep(5);
  }
  const seenAt = Date.now();
  const wroteAt = JSON.parse(readFileSync('wrote.json', 'utf8')).at;
  writeFileSync('result.json', JSON.stringify({ before, after: name(), staleMs: seenAt - wroteAt, polls }));
} else if (mode === 'same-mtime-rewrite') {
  // The case a directory-mtime probe and a bare newest-mtime compare both miss:
  // contents replaced in place with the old timestamps put back.
  const path = 'registry/programs/fund.yaml';
  const before = name();
  const s = statSync(path);
  writeFileSync(path, readFileSync(path, 'utf8').replace(before, 'Restored In Place'));
  utimesSync(path, s.atimeMs / 1000, s.mtimeMs / 1000); // seconds, so the fractional mtime round-trips exactly
  sleep(400);
  out({ before, after: name(), mtimeMoved: statSync(path).mtimeMs !== s.mtimeMs });
} else if (mode === 'rollover') {
  // Freeze the clock so the TTL can never expire, then step over Pacific
  // midnight. Any rebuild here is the date key firing on its own.
  const RealDate = Date;
  let fakeNow = RealDate.parse('2026-09-22T06:59:30Z'); // 2026-09-21 23:59:30 PT
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(fakeNow); else super(...a); }
    static now() { return fakeNow; }
  };
  const first = loadRegistry();
  const warm = loadRegistry();
  fakeNow = RealDate.parse('2026-09-22T07:00:10Z'); // 2026-09-22 00:00:10 PT, 40s later
  const after = loadRegistry();
  out({ elapsedMs: 40000, warmWasCached: warm.loadedAt === first.loadedAt,
    rebuilt: after.loadedAt !== first.loadedAt,
    liveBefore: first.orgStats.get('example').live_rounds, liveAfter: after.orgStats.get('example').live_rounds });
} else if (mode === 'no-flap') {
  const coldT = performance.now(); loadRegistry(true); const coldMs = performance.now() - coldT;
  const first = loadRegistry();
  const timed = [];
  const seen = [];
  for (let i = 0; i < 4; i++) { sleep(300); const t = performance.now(); const r = loadRegistry(); timed.push(performance.now() - t); seen.push(r.loadedAt); }
  out({ coldMs: +coldMs.toFixed(2), sameAfterCrossings: seen.every((l) => l === first.loadedAt),
    crossingMs: timed.map((n) => +n.toFixed(3)) });
} else if (mode === 'invalidate') {
  const first = loadRegistry();
  invalidateRegistryCache();
  const t = performance.now();
  const after = loadRegistry();
  out({ rebuiltImmediately: after.loadedAt !== first.loadedAt, ms: +(performance.now() - t).toFixed(2) });
} else if (mode === 'stampede') {
  invalidateRegistryCache();
  const t = performance.now();
  const results = await Promise.all(Array.from({ length: 64 }, async () => { await null; return loadRegistry().loadedAt; }));
  const ms = performance.now() - t;
  const cold = (() => { invalidateRegistryCache(); const c = performance.now(); loadRegistry(); return performance.now() - c; })();
  // 64 serial builds is what a stampede would actually cost.
  out({ concurrent: results.length, distinctBuilds: new Set(results).size, totalMs: +ms.toFixed(2), oneColdMs: +cold.toFixed(2) });
} else if (mode === 'warm-cost') {
  loadRegistry();
  const t = performance.now();
  for (let i = 0; i < 10000; i++) loadRegistry();
  out({ calls: 10000, totalMs: +(performance.now() - t).toFixed(2), updatedAt: loadRegistry().updatedAt });
}
`;

test('an out-of-process registry write becomes visible inside the cache window', async (t) => {
  const root = fixture('First Name');
  const child = spawn(process.execPath, [...NODE_ARGS, join(root, 'probe.mjs'), 'wait-for-outside-write'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, REGISTRY_MODULE, REGISTRY_CACHE_TTL_MS: '250' } });
  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(String(d)));
  const exited = new Promise((done) => child.on('exit', done));
  for (let i = 0; i < 400 && !existsSync(join(root, 'ready')); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(existsSync(join(root, 'ready')), `child never loaded: ${stderr.join('')}`);
  // writeFileSync over the same path: an in-place rewrite, the shape a
  // directory-mtime probe cannot see. No invalidateRegistryCache anywhere.
  writeFileSync(join(root, 'registry/programs/fund.yaml'), programYaml('Second Name'));
  writeFileSync(join(root, 'wrote.json'), JSON.stringify({ at: Date.now() }));
  assert.equal(await exited, 0, stderr.join(''));
  const result = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'));
  assert.equal(result.before, 'First Name');
  assert.equal(result.after, 'Second Name');
  assert.ok(result.staleMs < 2000, `picked up after ${result.staleMs}ms, want well under a day`);
  t.diagnostic(`window 250ms: another process rewrote the file in place; loader served it ${result.staleMs}ms later, after ${result.polls} polls`);
  rmSync(root, { recursive: true, force: true });
});

test('a rewrite that restores the old mtime is still caught', (t) => {
  // {count, newest mtime, bytes} rather than newest mtime alone. statSync
  // already returned size, so the stronger signature costs nothing.
  const root = fixture('First Name');
  const r = run(root, 'same-mtime-rewrite', { REGISTRY_CACHE_TTL_MS: '250' });
  assert.equal(r.mtimeMoved, false, 'fixture failed to restore the mtime');
  assert.equal(r.before, 'First Name');
  assert.equal(r.after, 'Restored In Place');
  t.diagnostic('mtime identical before and after; the {count, newest, bytes} signature caught it on size alone');
  rmSync(root, { recursive: true, force: true });
});

test('the product-day rollover still invalidates, independently of the window', (t) => {
  // The date key was doing double duty: orgStats.live_rounds is built from
  // todayISO, so dropping it for a pure freshness check would freeze a public
  // number at the date of the last registry WRITE. Clock frozen, so the window
  // cannot expire; only the date changes.
  const root = fixture();
  const r = run(root, 'rollover', { REGISTRY_CACHE_TTL_MS: '60000' });
  assert.equal(r.warmWasCached, true, 'a repeat load inside the same day must be served warm');
  assert.equal(r.rebuilt, true, 'crossing Pacific midnight must rebuild even inside the window');
  assert.equal(r.liveBefore, 1);
  assert.equal(r.liveAfter, 0, 'live_rounds must be recomputed against the new product day');
  t.diagnostic(`clock frozen, window 60000ms, stepped 40s across Pacific midnight: rebuilt=${r.rebuilt}, live_rounds ${r.liveBefore} -> ${r.liveAfter}`);
  rmSync(root, { recursive: true, force: true });
});

test('crossing a window boundary with no change refreshes the stamp without rebuilding', (t) => {
  // The flapping hazard: if a boundary triggered the full rebuild every window,
  // a quiet registry would stall the event loop for ~145ms on a timer.
  const root = fixture('First Name', 400);
  const r = run(root, 'no-flap', { REGISTRY_CACHE_TTL_MS: '250' });
  assert.equal(r.sameAfterCrossings, true, 'an unchanged registry must keep the same index across boundaries');
  t.diagnostic(`401 programs: rebuild ${r.coldMs}ms, four boundary crossings ${r.crossingMs.join('/')}ms, same index throughout`);
  for (const ms of r.crossingMs) assert.ok(ms < r.coldMs / 4, `boundary cost ${ms}ms against a ${r.coldMs}ms rebuild — that is a rebuild, not a probe`);
  rmSync(root, { recursive: true, force: true });
});

test('invalidateRegistryCache stays the immediate path for an in-process write', (t) => {
  // committer.ts, validation-runner.ts and decide-bulk call this after a Desk
  // write and must not wait out a window.
  const root = fixture();
  const r = run(root, 'invalidate', { REGISTRY_CACHE_TTL_MS: '60000' });
  assert.equal(r.rebuiltImmediately, true);
  t.diagnostic(`rebuilt ${r.ms}ms after invalidate, inside a 60000ms window`);
  rmSync(root, { recursive: true, force: true });
});

test('concurrent misses build the index once', (t) => {
  // loadRegistry is fully synchronous: the event loop cannot interleave two
  // misses, so the first caller fills the cache and the rest hit it. This pins
  // that property rather than adding a single-flight guard for a race that
  // cannot happen.
  const root = fixture('First Name', 400);
  const r = run(root, 'stampede');
  assert.equal(r.concurrent, 64);
  assert.equal(r.distinctBuilds, 1, '64 concurrent misses must produce one build');
  t.diagnostic(`64 concurrent misses: ${r.distinctBuilds} build, ${r.totalMs}ms total; one build is ${r.oneColdMs}ms, so 64 would be ~${(r.oneColdMs * 64).toFixed(0)}ms`);
  assert.ok(r.totalMs < r.oneColdMs * 8, `64 concurrent misses cost ${r.totalMs}ms; 64 builds would cost about ${(r.oneColdMs * 64).toFixed(0)}ms`);
  rmSync(root, { recursive: true, force: true });
});

test('a warm window costs no stat walk', (t) => {
  // The rejected design — a full walk on every call — would spend ~2ms per call
  // here and miss this ceiling by an order of magnitude.
  const root = fixture();
  const r = run(root, 'warm-cost', { REGISTRY_CACHE_TTL_MS: '60000' });
  assert.ok(r.totalMs < 2000, `10,000 warm calls took ${r.totalMs}ms`);
  assert.ok(r.updatedAt.startsWith('20'), 'the public load date still comes from the walk');
  t.diagnostic(`10,000 warm calls in ${r.totalMs}ms (${(r.totalMs / 10).toFixed(1)}us each); a walk per call would be ~20,000ms`);
  rmSync(root, { recursive: true, force: true });
});
