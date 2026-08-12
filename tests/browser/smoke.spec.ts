import { expect, test } from '@playwright/test';

const browserAdminToken = process.env.ADMIN_TOKEN || 'grants-watch-browser-test-token';

test('admin token gate completes an authenticated browser session', async ({ page }) => {
  await page.goto('/admin/desk');

  await page.getByPlaceholder('Admin token').fill(browserAdminToken);
  await page.getByRole('button', { name: 'Enter →' }).click();

  await expect(page.getByText("The owner's daily curation gate", { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'The Desk', exact: true })).toBeVisible();
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

test('header search can jump to the awards register', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search the register' });
  await search.fill('Gamma');
  await expect(page.getByRole('option', { name: 'Search awards for Gamma' })).toBeVisible();
  await page.getByRole('option', { name: 'Search awards for Gamma' }).click();
  await expect(page).toHaveURL(/\/awards\?q=Gamma$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Awards' })).toBeVisible();
});

test('front page, systems, and method stay connected', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'Latest Awards' })).toBeVisible();
  await expect(page.getByText(/of \d+ dated calls/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'About' }).getByRole('link', { name: 'Method' })).toBeVisible();
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Crypto' })).toHaveAttribute(
    'href',
    '/programs?wire=crypto'
  );

  await page.goto('/systems');
  await expect(page.getByRole('heading', { level: 2, name: 'Protocol ecosystems' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Funding domains' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Ethereum/ }).first()).toBeVisible();

  await page.goto('/method');
  await expect(page.getByRole('heading', { level: 1, name: 'Method' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'What this is' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open calls' })).toHaveAttribute('href', '/programs');
});

test('header search supports keyboard navigation', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search the register' });
  await search.fill('OpenAI Foundation');
  await expect(page.getByRole('option', { name: 'OpenAI Foundation', exact: true })).toBeVisible();
  await search.press('Enter');
  await expect(page).toHaveURL(/\/orgs\/openai-foundation$/);
});

test('header search reports a failed index and retries', async ({ page }) => {
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
  await expect(page.getByRole('link', { name: '2026 + rolling' })).toHaveAttribute('aria-current', 'true');
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
  await expect(page.getByText(/showing 1-50 of \d+ open calls/i)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next →' })).toHaveAttribute(
    'href',
    '/programs?status=active&page=2'
  );

  await page.getByRole('link', { name: 'Next →' }).click();
  await expect(page).toHaveURL(/\/programs\?status=active&page=2$/);
  await expect(page.getByText(/showing 51-\d+ of \d+ open calls/i)).toBeVisible();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('public navigation, awards, and cadence fit the viewport', async ({ page }) => {
    await page.goto('/awards?wire=crypto&year=2026');
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Awards' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Desk' })).toBeHidden();
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
  test.use({ viewport: { width: 320, height: 760 } });

  test('header and expanded search use the available width', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Use dark theme' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole('button', { name: 'Open search' }).click();
    const search = page.getByRole('combobox', { name: 'Search the register' });
    await expect(search).toBeVisible();
    const box = await search.boundingBox();
    expect(box?.width || 0).toBeGreaterThan(230);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('tablet edge', () => {
  test.use({ viewport: { width: 768, height: 900 } });

  test('header and organization cadence stay inside the viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Use dark theme' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.goto('/orgs/optimism-foundation');
    await expect(page.getByTestId('org-cadence-chart')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
