import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4178', browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178/test/host-ip.fixture.html',
    reuseExistingServer: false,
  },
});
