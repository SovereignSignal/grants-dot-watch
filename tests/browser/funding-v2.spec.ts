import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

let child: ChildProcess | undefined;
let preview = '';
let output = '';

// This server is a second local copy of the production build, with no database,
// ingest timer, external source access or canonical data writes.
test.beforeAll(async ({ playwright }) => {
  const reservation = createServer();
  await new Promise<void>((done, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', done);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  const port = address.port;
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  preview = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, DATABASE_URL: '', WIRE_DATABASE_URL: '', INGEST_ENABLED: '0',
      GRANTS_WATCH_API_V2: '1', GRANTS_WATCH_ALLOW_LOCAL_STORE: '1', ADMIN_TOKEN: 'funding-preview-test-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-16000); };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.on('error', error => { output += error.message; });
  const request = await playwright.request.newContext();
  try {
    await expect.poll(async () => {
      if (child?.exitCode != null) throw new Error(`Preview exited: ${output}`);
      try { return (await request.get(`${preview}/api/v2`, { timeout: 2000 })).status(); }
      catch { return 0; }
    }, { timeout: 25000 }).toBe(200);
  } finally { await request.dispose(); }
});

test.afterAll(async () => {
  if (!child || child.exitCode != null) return;
  await new Promise<void>(done => {
    const timeout = setTimeout(() => { child?.kill('SIGKILL'); done(); }, 5000);
    child?.once('exit', () => { clearTimeout(timeout); done(); });
    child?.kill('SIGTERM');
  });
});

test('v2 defaults closed on the primary server, with valid HEAD and preflight', async ({ request }) => {
  const disabled = await request.get('/api/v2');
  expect(disabled.status()).toBe(503);
  expect(await disabled.json()).toEqual({ error: 'preview_disabled' });
  const head = await request.head('/api/v2/programs');
  expect(head.status()).toBe(503);
  expect(await head.body()).toHaveLength(0);
  const preflight = await request.fetch('/api/v2/programs', { method: 'OPTIONS' });
  expect(preflight.status()).toBe(204);
  expect(preflight.headers()['access-control-allow-methods']).toBe('GET, HEAD, OPTIONS');
  expect((await request.get('/api/v1')).status()).toBe(200);
});

test('enabled v2 serves advertised collections and detail URLs through the Next router', async ({ request }) => {
  const response = await request.get(`${preview}/api/v2`);
  expect(response.status()).toBe(200);
  const index = await response.json();
  expect(index.version).toBe('v2');
  expect(Object.keys(index.endpoints)).toHaveLength(11);
  for (const endpoint of Object.values(index.endpoints) as string[]) {
    const page = await request.get(`${preview}${endpoint}?limit=1`);
    expect(page.status(), endpoint).toBe(200);
    expect(page.headers()['cache-control']).toBe('no-store');
    const body = await page.json();
    expect(body.data.length).toBeLessThanOrEqual(1);
    if (body.data[0]) expect((await request.get(`${preview}${body.data[0].api}`)).status()).toBe(200);
  }
});

test('enabled v2 enforces cursor, error and read-only contracts over HTTP', async ({ request }) => {
  const first = await request.get(`${preview}/api/v2/programs?limit=2`);
  const page = await first.json();
  expect(page.data).toHaveLength(2);
  expect(page.meta.next_cursor).toBeTruthy();
  const next = await request.get(`${preview}/api/v2/programs?limit=2&cursor=${encodeURIComponent(page.meta.next_cursor)}`);
  expect(next.status()).toBe(200);
  const nextPage = await next.json();
  expect(new Set([...page.data, ...nextPage.data].map((row: { id: string }) => row.id)).size).toBe(4);
  expect((await request.get(`${preview}/api/v2/programs?limit=1&limit=2`)).status()).toBe(400);
  expect((await request.get(`${preview}/api/v2/programs?secret=1`)).status()).toBe(400);
  expect((await request.get(`${preview}/api/v2/programs/absent-record`)).status()).toBe(404);
  expect((await request.post(`${preview}/api/v2/programs`, { data: {} })).status()).toBe(405);
  const head = await request.head(`${preview}/api/v2/programs`);
  expect(head.status()).toBe(200);
  expect(await head.body()).toHaveLength(0);
});
