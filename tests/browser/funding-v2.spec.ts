import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

let child: ChildProcess | undefined;
let preview = '';
let output = '';

test.beforeAll(async ({ playwright }) => {
  const reservation = createServer();
  await new Promise<void>((done, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', done); });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  const port = address.port;
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  preview = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, DATABASE_URL: '', WIRE_DATABASE_URL: '', INGEST_ENABLED: '0', GRANTS_WATCH_API_V2: '1', GRANTS_WATCH_ALLOW_LOCAL_STORE: '1', ADMIN_TOKEN: 'funding-preview-test-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-16000); };
  child.stdout?.on('data', capture); child.stderr?.on('data', capture); child.on('error', error => { output += error.message; });
  const request = await playwright.request.newContext();
  try { await expect.poll(async () => { if (child?.exitCode != null) throw new Error(`Preview exited: ${output}`); try { return (await request.get(`${preview}/api/v2`, { timeout: 2000 })).status(); } catch { return 0; } }, { timeout: 25000 }).toBe(200); }
  finally { await request.dispose(); }
});
test.afterAll(async () => {
  if (!child || child.exitCode != null) return;
  await new Promise<void>(done => { const timeout = setTimeout(() => { child?.kill('SIGKILL'); done(); }, 5000); child?.once('exit', () => { clearTimeout(timeout); done(); }); child?.kill('SIGTERM'); });
});
test('v2 defaults closed on the primary server, with valid HEAD and preflight', async ({ request }) => {
  const disabled = await request.get('/api/v2'); expect(disabled.status()).toBe(503); expect(await disabled.json()).toEqual({ error: 'preview_disabled' });
  const head = await request.head('/api/v2/programs'); expect(head.status()).toBe(503); expect(await head.body()).toHaveLength(0);
  const preflight = await request.fetch('/api/v2/programs', { method: 'OPTIONS' }); expect(preflight.status()).toBe(204); expect(preflight.headers()['access-control-allow-methods']).toBe('GET, HEAD, OPTIONS');
  expect((await request.get('/api/v1')).status()).toBe(200);
});
test('enabled v2 serves all sixteen advertised collections and detail URLs through Next', async ({ request }) => {
  const response = await request.get(`${preview}/api/v2`); expect(response.status()).toBe(200); const index = await response.json(); expect(index.version).toBe('v2'); expect(Object.keys(index.endpoints)).toHaveLength(16);
  for (const endpoint of Object.values(index.endpoints) as string[]) {
    const page = await request.get(`${preview}${endpoint}?limit=1`); expect(page.status(), endpoint).toBe(200); expect(page.headers()['cache-control']).toBe('no-store'); const body = await page.json(); expect(body.data.length).toBeLessThanOrEqual(1);
    if (body.data[0]) expect((await request.get(`${preview}${body.data[0].api}`)).status()).toBe(200);
  }
});
test('enabled v2 enforces cursor, error and read-only contracts over HTTP', async ({ request }) => {
  const first = await request.get(`${preview}/api/v2/programs?limit=2`); const page = await first.json(); expect(page.data).toHaveLength(2); expect(page.meta.next_cursor).toBeTruthy();
  const next = await request.get(`${preview}/api/v2/programs?limit=2&cursor=${encodeURIComponent(page.meta.next_cursor)}`); expect(next.status()).toBe(200); const nextPage = await next.json(); expect(new Set([...page.data, ...nextPage.data].map((row: { id: string }) => row.id)).size).toBe(4);
  expect((await request.get(`${preview}/api/v2/programs?limit=1&limit=2`)).status()).toBe(400); expect((await request.get(`${preview}/api/v2/programs?secret=1`)).status()).toBe(400); expect((await request.get(`${preview}/api/v2/programs/absent-record`)).status()).toBe(404); expect((await request.post(`${preview}/api/v2/programs`, { data: {} })).status()).toBe(405);
  const head = await request.head(`${preview}/api/v2/programs`); expect(head.status()).toBe(200); expect(await head.body()).toHaveLength(0);
});
test('funding pages, evidence queries, OpenAPI and exports are connected', async ({ page, request }) => {
  await page.goto(`${preview}/funding?kind=claims`); await expect(page.getByRole('heading', { name:'Funding evidence', exact:true })).toBeVisible();
  await expect(page.getByRole('link', { name:'This view as JSON' })).toHaveAttribute('href', /\/api\/v2\/claims/);
  await page.goto(`${preview}/data`); await expect(page.getByRole('heading', { name:'Funding API', exact:true })).toBeVisible();
  expect((await request.get(`${preview}/api/v2/openapi`)).status()).toBe(200);
  const exported = await request.get(`${preview}/api/v2/export/programs?format=jsonl`); expect(exported.status()).toBe(200); expect(Number(exported.headers()['x-record-count'])).toBeGreaterThan(400);
  expect((await request.get(`${preview}/api/desk/funding/workspace`)).status()).toBe(401);
  await page.setViewportSize({ width:375, height:812 }); await page.goto(`${preview}/funding?kind=claims`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('program profiles surface accepted eligibility and funding in the main fields', async ({ page }, testInfo) => {
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${preview}/programs/unwritten-challenge`);
  const fields=page.locator('.dossier-facts');
  await expect(fields).toContainText('US 501(c)(3), school or fiscal sponsor route');
  await expect(fields).toContainText('Advertised $50,000');
  await expect(fields).toContainText('currency unknown');
  await expect(fields).toContainText('Location is not recorded separately');
  await expect(fields).not.toContainText("Not recorded. Check the funder's terms.");
  await expect(fields.getByRole('link').first()).toHaveAttribute('href','https://youngfutures.org/challenges/unwritten');
  await page.getByRole('heading',{name:'Who can apply',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('unwritten-profile.png')});
  await page.goto(`${preview}/programs/1inch-dao-aqua-revenue-stream-incubator`);
  await expect(fields).toContainText('Rolling 2026 intake');
  await expect(fields).toContainText('Up to $50,000 per team; $436,000 total pool');
});
