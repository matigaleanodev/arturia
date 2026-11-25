import { defineConfig, devices } from '@playwright/test';

const integrated = process.env['ARTURIA_INTEGRATED'] === '1';
const baseURL = integrated ? process.env['ARTURIA_WEB_ORIGIN'] : 'http://127.0.0.1:4201';
if (integrated && !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL ?? '')) {
  throw new Error('Integrated Playwright requires a loopback web origin');
}

// Firefox and WebKit run on demand (`npm run test:e2e:cross`); `verify` stays on Chromium.
const crossBrowser = process.env['ARTURIA_CROSS_BROWSER'] === '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: integrated ? '**/chat-real-api.spec.ts' : '**/*.spec.ts',
  testIgnore: integrated ? [] : '**/chat-real-api.spec.ts',
  use: { baseURL, serviceWorkers: 'block' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(crossBrowser ? [
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ] : []),
  ],
  webServer: integrated ? undefined : {
    command: 'npm run start:fixtures -- --host 127.0.0.1 --port 4201 --hmr=false --live-reload=false',
    url: baseURL,
    reuseExistingServer: false,
  },
});
