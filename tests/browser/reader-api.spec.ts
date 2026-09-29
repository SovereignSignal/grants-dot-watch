import { expect, test } from '@playwright/test';

test('production reader routes require their own key, fail closed and reject writes', async ({ request }) => {
  for (const path of ['/api/v1/updates', '/api/v1/updates/1']) {
    const denied = await request.get(path);
    expect(denied.status()).toBe(401);
    expect(denied.headers()['cache-control']).toBe('private, no-store');
    expect(denied.headers()['vary']).toContain('Authorization');
    expect(denied.headers()['access-control-allow-origin']).toBeUndefined();
    const admin = await request.get(path, { headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN || 'grants-watch-browser-test-token'}` } });
    expect(admin.status()).toBe(401);
    const authenticated = await request.get(path, { headers: { Authorization: 'Bearer browser-reader-test-token-0000000000' } });
    expect(authenticated.status()).toBe(503);
    expect(await authenticated.json()).toMatchObject({ error: 'source_unavailable' });
    expect((await request.post(path)).status()).toBe(405);
  }
  const invalid = await request.get('/api/v1/updates?limit=0', { headers: { Authorization: 'Bearer browser-reader-test-token-0000000000' } });
  expect(invalid.status()).toBe(400);
  expect((await request.get('/api/v1/programs?limit=1')).status()).toBe(200);
});
