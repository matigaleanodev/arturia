import { defineConfig, devices } from '@playwright/test';

const integrated = process.env['ARTURIA_INTEGRATED'] === '1';
const baseURL = integrated ? process.env['ARTURIA_WEB_ORIGIN'] : 'http://127.0.0.1:4201';
if (integrated && !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL ?? '')) {
  throw new Error('Integrated Playwright requires a loopback web origin');
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: integrated ? '**/chat-real-api.spec.ts' : '**/*.spec.ts',
  testIgnore: integrated ? [] : '**/chat-real-api.spec.ts',
  use: { baseURL, serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: integrated ? undefined : {
    command: 'npm run start:fixtures -- --host 127.0.0.1 --port 4201 --hmr=false --live-reload=false',
    url: baseURL,
    reuseExistingServer: false,
  },
});
