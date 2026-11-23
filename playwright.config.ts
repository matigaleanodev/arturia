import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4201';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL, serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start:fixtures -- --host 127.0.0.1 --port 4201 --hmr=false --live-reload=false',
    url: baseURL,
    reuseExistingServer: false,
  },
});
