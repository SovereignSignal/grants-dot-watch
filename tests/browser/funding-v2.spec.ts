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
  const fields=page.locator('.dossier-facts:not(.dossier-classification)');
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


test('profiles and API preserve separate funding classifications and existing entity fields', async ({ page, request }, testInfo) => {
  await page.goto(`${preview}/programs/google-for-startups-cloud-program-ai-tier`);
  const classification = page.locator('.dossier-classification');
  await expect(classification).toContainText('Subsidy');
  await expect(classification).toContainText('Cloud credit');
  await expect(classification).toContainText('No separate allocation method field is recorded');
  await expect(page.locator('.dossier-kicker')).toContainText('Legacy classification: Other');
  await classification.scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('google-classification.png')});
  await page.goto(`${preview}/programs/nvidia-inception`);
  await expect(classification).toContainText('Service');
  await expect(classification).toContainText('Cloud credit');
  await expect(classification).toContainText('Other');
  const org = await (await request.get(`${preview}/api/v2/orgs/php-foundation`)).json();
  expect(org.data.socials.github).toBe('https://github.com/ThePHPF/thephp.foundation');
  const program = await (await request.get(`${preview}/api/v2/programs/google-for-startups-cloud-program-ai-tier`)).json();
  expect(program.data.instruments).toEqual(['subsidy']);
  expect(program.data.allocation_methods).toEqual([]);
  expect(program.data.intake_mode).toBe('unknown');
  const system = await (await request.get(`${preview}/api/v2/systems/oss-sustainability`)).json();
  expect(Array.isArray(system.data.funding_channels)).toBe(true);
});

test('funding records use readable classifications, amounts and distinct payment dates', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${preview}/funding?kind=program-terms&program=a16z-crypto-csx`);
  const terms = page.locator('[data-funding-record]').first();
  await expect(terms.getByRole('heading')).toHaveText('CSX (Crypto Startup Accelerator)');
  await expect(terms.getByRole('heading').getByRole('link')).toHaveAttribute('href', '/programs/a16z-crypto-csx');
  expect(await terms.locator('dt').allTextContents()).toEqual(expect.arrayContaining([
    'Instrument', 'Capital form', 'Allocation method', 'Selection', 'Application intake',
  ]));
  await expect(terms).toContainText('In kind');
  await expect(terms).not.toContainText('in_kind');
  await expect(terms).toContainText('Supported by a primary source');
  const provenance = terms.locator('details').filter({ has: page.locator('summary', { hasText: 'Source details and field provenance' }) });
  await expect(provenance).not.toHaveAttribute('open');
  await provenance.locator('summary').click();
  await expect(provenance.getByRole('columnheader', { name: 'Field', exact: true })).toBeVisible();
  await provenance.locator('summary').click();
  await page.screenshot({ path: testInfo.outputPath('funding-terms-desktop.png') });

  const response = await request.get(`${preview}/api/v2/funding-events?limit=20`);
  expect(response.status()).toBe(200);
  type FundingEvent = { id: string; program: string | null; recipient_name: string; recipient_url: string | null; amount: { amount: string | null; currency: string | null }; payment_date: string | null; occurred_on: string | null; announced_on: string | null };
  const { data } = await response.json() as { data: FundingEvent[] };
  const candidate = data.find(row => row.program && row.amount.amount && !row.payment_date)!;
  expect(candidate, 'A recorded award without an established payment should exercise the lifecycle distinction').toBeTruthy();
  await page.goto(`${preview}/funding`);
  const record = page.locator(`[data-funding-record=${JSON.stringify(candidate.id)}]`);
  await expect(record.getByRole('heading')).toHaveText(candidate.recipient_name);
  await expect(record.getByRole('heading').getByRole('link')).toHaveCount(0);
  await expect(record).toContainText('Program:');
  await expect(record.locator(`a[href="/programs/${candidate.program}"]`)).toBeVisible();
  await expect(record).toContainText('Payment not established');
  if (candidate.recipient_url) await expect(record.getByRole('link', { name: 'Project', exact: true })).toHaveAttribute('href', candidate.recipient_url);
  else await expect(record.getByRole('link', { name: 'Project', exact: true })).toHaveCount(0);
  const [whole, fraction] = candidate.amount.amount!.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
  await expect(record).toContainText(grouped);
  if (candidate.amount.currency) await expect(record).toContainText(candidate.amount.currency);
  for (const [label, date] of [['Event date', candidate.occurred_on], ['Announcement date', candidate.announced_on]]) {
    const field = record.locator('dl > div').filter({ has: page.getByText(label!, { exact: true }) });
    await expect(field.locator('dd')).toHaveText(date || 'Not recorded');
  }
  await record.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('funding-events-desktop.png') });
});

test('linked project records retain their own title and destination beside the program', async ({ page, request }) => {
  const response = await request.get(`${preview}/api/v2/outputs?limit=20`);
  expect(response.status()).toBe(200);
  const { data } = await response.json();
  expect(data.length).toBeGreaterThan(0);
  await page.goto(`${preview}/funding?kind=outputs`);
  const record = page.locator(`[data-funding-record=${JSON.stringify(data[0].id)}]`);
  await expect(record.getByRole('heading')).toHaveText(data[0].name);
  await expect(record.getByRole('heading').getByRole('link')).toHaveCount(0);
  await expect(record.getByRole('link', { name: 'Project', exact: true })).toHaveAttribute('href', data[0].url);
});

for (const width of [320, 375]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`readability surfaces fit ${width}px in ${colorScheme} while preserving house style`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 812 });
      await page.emulateMedia({ colorScheme });
      const routes = [
        ['home', '/'],
        ['funding-events', '/funding'],
        ['funding-terms', '/funding?kind=program-terms&program=a16z-crypto-csx'],
        ['program', '/programs/unwritten-challenge'],
        ['org', '/orgs/mozilla-foundation'],
      ];
      const observations: unknown[] = [];
      const inspect = async (route: string, state: string) => {
        const dimensions = await page.evaluate(() => ({
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        observations.push({ route, state, colorScheme, ...dimensions });
        expect(dimensions.document, `${route} (${state}) document width`).toBeLessThanOrEqual(width);
        expect(dimensions.body, `${route} (${state}) body width`).toBeLessThanOrEqual(width);
      };
      for (const [name, route] of routes) {
        await page.goto(`${preview}${route}`);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('body')).toHaveCSS('background-color', colorScheme === 'dark' ? 'rgb(20, 20, 24)' : 'rgb(243, 239, 230)');
        const style = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          const rule = (selector: string, pseudo: string) => {
            const css = getComputedStyle(document.querySelector(selector)!, pseudo);
            return { top: css.borderTopWidth, bottom: css.borderBottomWidth, gap: parseFloat(css.height) - parseFloat(css.borderTopWidth) - parseFloat(css.borderBottomWidth) };
          };
          return {
            masthead: rule('.masthead', '::after'),
            footer: rule('.ledger-footer', '::before'),
            wires: ['crypto', 'ai', 'oss'].map(wire => root.getPropertyValue(`--color-${wire}`).trim().toUpperCase()),
          };
        });
        expect(style.masthead).toEqual({ top: '2px', bottom: '1px', gap: 4 });
        expect(style.footer).toEqual({ top: '2px', bottom: '1px', gap: 4 });
        if (colorScheme === 'dark') expect(style.wires).toEqual(['#B5812C', '#8C74E0', '#1F97B3']);
        await inspect(route, 'initial');
        // The approved mobile layout hides the awards sidebar. Keep its desktop coverage in smoke.
        if (name === 'home') await expect(page.locator('.ledger-sidebar')).toBeHidden();
        if (name.startsWith('funding')) await page.locator('[data-funding-record]').first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${name}-${width}-${colorScheme}.png`) });
        if (name === 'funding-terms') {
          const provenance = page.locator('[data-funding-record]').first().locator('details').filter({ has: page.locator('summary', { hasText: 'Source details and field provenance' }) });
          await provenance.locator('summary').click();
          await expect(provenance.getByRole('columnheader', { name: 'Field', exact: true })).toBeVisible();
          await inspect(route, 'provenance expanded');
          await page.screenshot({ path: testInfo.outputPath(`provenance-${width}-${colorScheme}.png`) });
        }
      }
      await testInfo.attach('responsive-dimensions.json', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
      console.log(`Responsive evidence: ${JSON.stringify(observations)}`);
    });
  }
}
