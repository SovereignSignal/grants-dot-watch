import { test, expect } from '@playwright/test';

// Exercise the real authenticated route, not just its unauthenticated guard.
// The primary browser server keeps funding writes disabled.
test('funding workspace authenticates, reads coverage and honors the write gate', async ({ request }) => {
  const url = '/api/desk/funding/workspace';
  expect((await request.get(url)).status()).toBe(401);
  const token = process.env.ADMIN_TOKEN || 'grants-watch-browser-test-token';
  const headers = { 'x-admin-token': token };
  const response = await request.get(url, { headers });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.features.public_read).toBe(false);
  expect(body.features.owner_write).toBe(false);
  expect(body.coverage.length).toBeGreaterThan(400);
  expect(body.counts.programs).toBeGreaterThan(400);
  expect(body.sources).toHaveLength(4);
  expect(Array.isArray(body.pending)).toBe(true);
  const closed = await request.post(url, { headers, data: { action: 'compile-retained' } });
  expect(closed.status()).toBe(503);
  expect(await closed.json()).toEqual({ error: 'funding_desk_disabled' });
});
