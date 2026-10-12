import { expect, test } from '@playwright/test';

test('main navigation and old directory bookmarks reach one searchable program directory', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('navigation', { name:'Primary' }).getByRole('link',{name:'Programs',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Programs',level:1})).toBeVisible();
  await expect(page.getByRole('searchbox',{name:'Search programs'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Programs view'}).getByRole('link',{name:'All programs',exact:true})).toHaveAttribute('aria-current','page');
  await page.screenshot({path:testInfo.outputPath('programs-desktop.png')});
  await page.goto('/opportunities?wire=crypto&status=active&q=1inch&page=1');
  await expect(page).toHaveURL(/\/programs\?wire=crypto&status=active&q=1inch&page=1$/);
  await expect(page.getByTestId('opportunity-card')).toHaveCount(2);
});
test('search and filters persist across current calls and calendar, and ended programs remain discoverable', async ({ page }) => {
  await page.goto('/programs?wire=crypto&status=active&q=1inch');
  const views=page.getByRole('navigation',{name:'Programs view'});
  await views.getByRole('link',{name:'Current calls'}).click();
  await expect(page).toHaveURL(/wire=crypto.*status=active.*view=departures/);
  await expect(page.getByRole('searchbox',{name:'Search programs'})).toHaveValue('1inch');
  await expect(page.getByRole('link',{name:/1inch DAO Aqua Revenue Stream Incubator/})).toBeVisible();
  await views.getByRole('link',{name:'Calendar'}).click();
  await expect(page).toHaveURL(/wire=crypto.*status=active.*view=cadence/);
  await views.getByRole('link',{name:'All programs',exact:true}).click();
  await expect(page.getByTestId('opportunity-card')).toHaveCount(2);
  await page.goto('/programs?wire=crypto&view=departures');
  await page.getByRole('navigation',{name:'Program status'}).getByRole('link',{name:/Ended/}).click();
  await expect(views.getByRole('link',{name:'All programs',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.getByTestId('opportunity-card').first()).toBeVisible();
  expect(await page.getByTestId('opportunity-card').count()).toBeGreaterThan(0);
  for(const card of await page.getByTestId('opportunity-card').all())await expect(card.locator('dl')).toContainText('Ended');
});
test('current-call empty state keeps a route to matching programs and funder filtering works in every view', async ({page})=>{
  await page.goto('/programs?status=concluded&view=departures&org=mozilla-foundation');
  await page.getByRole('link',{name:'View all matching programs'}).click();
  await expect(page.getByTestId('opportunity-card').first()).toBeVisible();
  for(const card of await page.getByTestId('opportunity-card').all())await expect(card).toContainText('Mozilla Foundation');
  await expect(page.getByTestId('opportunity-card').first()).toBeVisible();
  expect(await page.getByTestId('opportunity-card').count()).toBeGreaterThan(0);
  await page.getByRole('searchbox',{name:'Search programs'}).fill('COVID');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await expect(page).toHaveURL(/org=mozilla-foundation/);
  await expect(page.getByTestId('opportunity-card')).toHaveCount(1);
});
test('no organization last-activity value is later than the product date', async ({ request })=>{
  const response=await request.get('/api/v1/orgs?limit=100');
  expect(response.status()).toBe(200);
  const body=await response.json();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date());
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.data.some((row: {activity: {last_activity: string | null}})=>row.activity?.last_activity)).toBe(true);
  for(const row of body.data)if(row.activity?.last_activity)expect(row.activity.last_activity <= today).toBe(true);
});
test('unified program views fit a narrow phone', async ({page},testInfo)=>{
  await page.setViewportSize({width:320,height:760});
  for(const path of ['/programs','/programs?view=departures','/programs?view=cadence']){
    await page.goto(path);
    await expect(page.getByRole('heading',{level:1,name:'Programs'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    if(path==='/programs')await page.screenshot({path:testInfo.outputPath('programs-phone.png')});
  }
});
