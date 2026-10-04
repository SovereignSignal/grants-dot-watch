import { defineConfig } from '@playwright/test';
import { createHash } from 'node:crypto';

const port = Number(process.env.PLAYWRIGHT_PORT || 3100);
const browserAdminToken = process.env.ADMIN_TOKEN || 'grants-watch-browser-test-token';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm start -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    // This suite runs the real production build (`npm start` sets
    // NODE_ENV=production) against no database on purpose. desk-store fails
    // closed there; this is the explicit opt-out, and /admin/health reports
    // the local backend for as long as it is on.
    env: { ADMIN_TOKEN: browserAdminToken, GRANTS_WATCH_ALLOW_LOCAL_STORE: '1', WIRE_DATABASE_URL: '',
      GRANTS_WATCH_API_V2: '0',
      GRANTS_WATCH_READER_KEYS: JSON.stringify([{ id: 'browser-test',
        sha256: createHash('sha256').update('browser-reader-test-token-0000000000').digest('hex'),
        expires_at: '2099-01-01T00:00:00Z' }]) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
