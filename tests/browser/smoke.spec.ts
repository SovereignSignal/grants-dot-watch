import { expect, test } from '@playwright/test';
import { loadRegistry } from '../../src/lib/registry';

const registry = loadRegistry();
const registerCounts = [registry.programs.filter(p => p.status === 'active').length, registry.orgs.length, registry.systems.length, registry.awards.length].map(n => n.toLocaleString('en-US'));

const browserAdminToken = process.env.ADMIN_TOKEN || 'grants-watch-browser-test-token';

test('admin token gate completes an authenticated browser session', async ({ page }) => {
  await page.goto('/admin/desk');

  await page.getByPlaceholder('Admin token').fill(browserAdminToken);
  await page.getByRole('button', { name: 'Enter →' }).click();

  await expect(page.getByText("The owner's daily curation gate", { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'The Desk', exact: true })).toBeVisible();

  // The health page must stay up on a production build with no database —
  // that is the misconfiguration it exists to report — and it names the live
  // store backend so the state is visible before a redeploy, not after.
  await page.goto('/admin/health');
  await expect(page.getByText('Desk store: local', { exact: false })).toBeVisible();
  // Review freshness is the one alarm that lands on a date rather than on a
  // deploy: it has to be server-rendered on this page before it is needed.
  await expect(page.getByText('Review freshness', { exact: true })).toBeVisible();
});

test('awards search, filters, evidence, and pagination stay connected', async ({ page }) => {
  await page.goto('/awards?wire=crypto&year=2026&currency=op&funder=optimism-foundation&q=Gamma');

  await expect(page.getByRole('heading', { level: 1, name: 'Awards' })).toBeVisible();
  await expect(page.getByText('Gamma Strategies', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source for Gamma Strategies award' })).toHaveAttribute(
    'href',
    'https://gov.optimism.io/t/cycle-50-grants-council-report/10653'
  );

  await page.goto('/awards?wire=crypto&currency=op&page=2');
  await expect(page.getByRole('link', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Next →' })).toHaveAttribute(
    'href',
    '/awards?wire=crypto&currency=op&page=3'
  );
  await expect(page.locator('main ol > li')).toHaveCount(50);
});

test('profile award pagination remains available', async ({ page }) => {
  await page.goto('/orgs/optimism-foundation#awards');
  await expect(page.locator('#awards').getByRole('link', { name: '← Previous' })).toHaveCount(0);
  await expect(page.locator('#awards').locator('[aria-disabled="true"]', { hasText: '← Previous' })).toBeVisible();

  await page.goto('/orgs/optimism-foundation?awardPage=2#awards');
  await expect(page.locator('#awards ol > li')).toHaveCount(25);
  await expect(page.locator('#awards').getByRole('link', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');

  await page.goto('/programs/otf-internet-freedom-fund?awardPage=2#awards');
  await expect(page.locator('#awards ol > li')).toHaveCount(21);
  await expect(page.locator('#awards').getByText('46 on file', { exact: true })).toBeVisible();
});

test('registry search supports keyboard navigation', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search the register' });
  await search.fill('OpenAI Foundation');
  await expect(page.getByRole('option', { name: 'OpenAI Foundation', exact: true })).toBeVisible();
  await search.press('Enter');
  await expect(page).toHaveURL(/\/orgs\/openai-foundation$/);
});

test('directory filters program facts and links source-backed details', async ({ page }) => {
  await page.goto('/opportunities?status=active&method=rounds&wire=oss');
  const cards = page.getByTestId('opportunity-card');
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) {
    await expect(card).toContainText('Active');
    await expect(card).toContainText('In rounds');
    await expect(card).toContainText('Open Source');
    await expect(card.locator('dl')).not.toContainText(/verified|Applications open|Deadline:/i);
    await expect(card.locator('.opportunity-card-bottom')).not.toContainText(/verified|Applications open/i);
  }
  await page.goto('/opportunities?wire=oss&q=Restack');
  await page.getByRole('link', { name: 'Restack', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Restack' })).toBeVisible();
  const restack = registry.programs.find(program => program.id === 'nlnet-restack')!;
  if (restack.apply_url) {
    await expect(page.getByRole('link', { name: 'Apply on nlnet.nl', exact: true })).toHaveAttribute('href', restack.apply_url);
  } else {
    await expect(page.getByRole('link', { name: /^Apply on / })).toHaveCount(0);
  }
  const facts = page.getByRole('complementary', { name: 'The facts' });
  await expect(facts.locator('dt')).toHaveText(['Status', 'How to apply', 'Next deadline']);
  await expect(facts).toContainText(restack.status === 'active' ? 'Active' : 'Paused');
  await expect(facts).toContainText('In rounds');
  await expect(page.getByRole('heading', { name: 'Round history' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source for First call' })).toHaveAttribute('href', restack.rounds[0].source!);
  await page.goto('/opportunities?status=announced');
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) await expect(card).toContainText('Announced');
  await page.goto('/opportunities?q=no-such-funding-fixture');
  await expect(page.getByRole('heading', { name: 'No matching programs' })).toBeVisible();
});

test('front page has program facts without deadline or verification labels', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('main');
  await expect(main).toContainText('active programs');
  await expect(main).not.toContainText(/confirmed open|verified open|unverified|verification|closing soon|open now/i);
  await expect(main.locator('dt', { hasText: /deadline|opens|checked/i })).toHaveCount(0);
  await expect(main.getByRole('combobox', { name: 'Search the register' })).toBeVisible();
  const deskLinks = page.locator('header a[href="/admin/desk"]');
  await expect(deskLinks).toHaveCount(2);
  await expect(deskLinks.first()).toHaveText('Desk');
  await expect(main.getByText(/Search .* programs and .* organizations/)).toBeVisible();
  await expect(main).not.toContainText(/applications close|closing date/i);
  await expect(main.getByRole('heading', { name: /deadline/i })).toHaveCount(0);
  await expect(main.getByRole('complementary', { name: 'The register' }).locator('dd')).toHaveText(registerCounts);
  for (const name of ['Funding ecosystems', 'Latest awards', 'Ways to be funded']) {
    await expect(main.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(main.locator('.latest-awards li')).toHaveCount(4);
  await expect(main.locator('.mechanism-grid > a')).toHaveCount(8);
  await expect(main.locator('.latest-awards li').first()).toContainText('300,000 OP');
  await main.locator('.latest-awards li').first().getByRole('link').click();
  await expect(page).toHaveURL(/awards\?q=Gamma\+Strategies&funder=optimism-foundation/);
  await expect(page.getByRole('heading', { name: 'Awards', exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: /Open now|Closing soon|Needs verification/i })).toHaveCount(0);
});

test('browse pages replace verification counts and labels consistently', async ({ page }) => {
  for (const path of ['/programs', '/programs?view=cadence', '/orgs', '/orgs/nlnet-foundation', '/systems/ethereum', '/systems', '/about', '/brief', '/query', '/method']) {
    await page.goto(path);
    await expect(page.getByRole('main')).not.toContainText(/verified open|intake unverified|intake needs recheck|confirmed open|review due/i);
  }
  await page.goto('/orgs');
  await expect(page.getByRole('columnheader', { name: 'Active programs', exact: true })).toBeVisible();
});

test('research intake requires admin authentication and accepts preview without writes', async ({ request }) => {
  const packet = { version: 1, run_id: 'browser-preview-fixture', wire: 'oss', producer: 'test-fixture', completed_at: '2026-09-18T12:00:00Z', coverage: [], findings: [] };
  expect((await request.post('/api/ingest/research', { data: packet })).status()).toBe(401);
  const headers = { 'x-admin-token': browserAdminToken };
  const response = await request.post('/api/ingest/research', { data: packet, headers });
  expect(response.status()).toBe(200);
  expect((await response.json()).saved).toBe(false);
  const invalid = await request.post('/api/ingest/research', { data: { ...packet, unexpected: true }, headers });
  expect(invalid.status()).toBe(400);
});

test('registry search reports a failed index and retries', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/search-index', async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 503, body: 'unavailable' });
    else await route.continue();
  });
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search the register' });
  await search.focus();
  await expect(page.getByText('Search index unavailable.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await search.fill('OpenAI Foundation');
  await expect(page.getByRole('option', { name: 'OpenAI Foundation', exact: true })).toBeVisible();
});

test('cadence defaults to current evidence and bounds the all-program view', async ({ page }) => {
  await page.goto('/programs?view=cadence');
  await expect(page.getByRole('link', { name: '2026 + undated calls' })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('main')).not.toContainText('Rolling, by engagement');
  expect(await page.getByTestId('cadence-chart').locator('a[href^="/programs/"]').count()).toBeLessThanOrEqual(60);

  await page.goto('/programs?view=cadence&scope=all&page=2');
  await expect(page.getByRole('link', { name: 'Include all programs' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText(/showing 61-120 of \d+/i)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next →' })).toHaveAttribute(
    'href',
    '/programs?view=cadence&scope=all&page=3'
  );
});

test('departures pagination preserves active filters', async ({ page }) => {
  await page.goto('/programs?status=active');
  await expect(page.getByText(/showing 1-50 of \d+ current rounds/i)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next →' })).toHaveAttribute(
    'href',
    '/programs?status=active&page=2'
  );

  await page.getByRole('link', { name: 'Next →' }).click();
  await expect(page).toHaveURL(/\/programs\?status=active&page=2$/);
  await expect(page.getByText(/showing 51-\d+ of \d+ current rounds/i)).toBeVisible();
  await expect(page.getByText(/^Page 2 of \d+$/)).toBeVisible();
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('public navigation, awards, and cadence fit the viewport', async ({ page }) => {
    await page.goto('/opportunities');
    await expect(page.getByRole('button', { name: 'Refine your search' })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Refine your search' }).click();
    await expect(page.getByRole('link', { name: 'All application methods' })).toBeVisible();
    await page.getByRole('button', { name: 'Refine your search' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.goto('/awards?wire=crypto&year=2026');
    await page.getByLabel('Menu', { exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Programs', exact: true })).toBeVisible();
    await page.getByLabel('Menu', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.locator('main ol > li')).toHaveCount(50);

    await page.goto('/programs');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.locator('main a[href^="/programs/"]')).toHaveCount(50);

    await page.goto('/programs?view=cadence');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByTestId('cadence-mobile').locator('a[href^="/programs/"]').first()).toBeVisible();

    await page.goto('/orgs/optimism-foundation');
    await expect(page.getByTestId('org-cadence-mobile').locator('a[href^="/programs/"]').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('narrow mobile', () => {
  test.use({ viewport: { width: 320, height: 760 }, colorScheme: 'dark' });

  test('Ledger header, search and program facts fit a narrow phone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 239, 230)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const search = page.getByRole('combobox', { name: 'Search the register' });
    await expect(search).toBeVisible();
    const box = await search.boundingBox();
    expect(box?.width || 0).toBeGreaterThan(230);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByLabel('Menu', { exact: true }).click();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Programs', exact: true }).click();
    await expect(page).toHaveURL(/\/programs$/);
    await expect(page.locator('.mobile-menu')).not.toHaveAttribute('open');
    await page.goto('/programs/rocket-pool-gmc-grants');
    await expect(page.getByRole('complementary', { name: 'The facts' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('tablet edge', () => {
  test.use({ viewport: { width: 768, height: 900 } });

  test('header and organization cadence stay inside the viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 239, 230)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.goto('/orgs/optimism-foundation');
    await expect(page.getByTestId('org-cadence-chart')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test('registry search can jump to the awards register', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search the register' });
  await search.fill('Gamma');
  await expect(page.getByRole('option', { name: 'Search awards for Gamma' })).toBeVisible();
  await page.getByRole('option', { name: 'Search awards for Gamma' }).click();
  await expect(page).toHaveURL(/\/awards\?q=Gamma$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Awards' })).toBeVisible();
});


test('briefing page lists the live board and stays linked to query', async ({ page }) => {
  const open = await page.request.get('/api/v1/open?limit=100');
  expect(open.ok()).toBeTruthy();
  const openBody = await open.json();
  const dated = openBody.data.filter((row: { standing: boolean }) => row.standing === false);
  expect(dated.length).toBeGreaterThan(0);
  const firstDated = dated[0] as { program_id: string; program_name: string };

  await page.goto('/brief');
  await expect(page.getByRole('heading', { level: 1, name: 'Briefing' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Dated calls' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'No published closing date' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Announcements without a closing date' })).toBeVisible();
  await expect(page.getByRole('link', { name: firstDated.program_name, exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: firstDated.program_name, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/programs/${firstDated.program_id}`));

  await page.goto('/brief?wire=oss');
  await expect(page.getByRole('main').getByRole('link', { name: 'Open Source' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('a[href="/api/v1/open?wire=oss"]')).toBeVisible();
});

test('query page and public API expose the live board', async ({ page }) => {
  await page.goto('/query');
  await expect(page.getByRole('heading', { level: 1, name: 'Query' })).toBeVisible();
  await expect(page.locator('a[href="/api/v1/open"]')).toBeVisible();

  const index = await page.request.get('/api/v1');
  expect(index.ok()).toBeTruthy();
  const indexBody = await index.json();
  expect(indexBody.version).toBe('v1');
  expect(indexBody.endpoints.open).toBe('/api/v1/open');

  const open = await page.request.get('/api/v1/open?standing=0&limit=5');
  expect(open.ok()).toBeTruthy();
  const openBody = await open.json();
  expect(Array.isArray(openBody.data)).toBeTruthy();
  expect(openBody.data.length).toBeGreaterThan(0);
  expect(openBody.data.every((row: { standing: boolean }) => row.standing === false)).toBeTruthy();
});

