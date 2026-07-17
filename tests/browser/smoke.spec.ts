import { expect, test } from '@playwright/test';

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
  await page.goto('/orgs/optimism-foundation?awardPage=2#awards');
  await expect(page.locator('#awards ol > li')).toHaveCount(25);
  await expect(page.locator('#awards').getByRole('link', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');

  await page.goto('/programs/otf-internet-freedom-fund?awardPage=2#awards');
  await expect(page.locator('#awards ol > li')).toHaveCount(21);
  await expect(page.locator('#awards').getByText('46 on file', { exact: true })).toBeVisible();
});

test('header search supports keyboard navigation', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search the register' });
  await search.fill('OpenAI Foundation');
  await expect(page.getByRole('option', { name: 'OpenAI Foundation', exact: true })).toBeVisible();
  await search.press('Enter');
  await expect(page).toHaveURL(/\/orgs\/openai-foundation$/);
});

test('cadence defaults to current evidence and bounds the all-program view', async ({ page }) => {
  await page.goto('/programs?view=cadence');
  await expect(page.getByRole('link', { name: '2026 + rolling' })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('main')).not.toContainText('Rolling, by engagement');
  expect(await page.getByTestId('cadence-chart').locator('a[href^="/programs/"]').count()).toBeLessThanOrEqual(60);

  await page.goto('/programs?view=cadence&scope=all&page=2');
  await expect(page.getByRole('link', { name: 'Include all programs' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText(/showing 61-120 of 588/i)).toBeVisible();
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('main ol > li')).toHaveCount(50);

    await page.goto('/programs');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('main a[href^="/programs/"]')).toHaveCount(50);

    await page.goto('/programs?view=cadence');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByTestId('cadence-mobile').locator('a[href^="/programs/"]').first()).toBeVisible();
  });
});
