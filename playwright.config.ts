import { defineConfig } from '@playwright/test';

const port = 3100;
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
    env: { ADMIN_TOKEN: browserAdminToken },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
