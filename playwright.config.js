import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  reporter: 'list',
  use: { channel: 'msedge', baseURL: 'http://127.0.0.1:4173', headless: true, viewport: { width: 1160, height: 850 } },
  webServer: { command: 'node scripts/test-server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false }
});
