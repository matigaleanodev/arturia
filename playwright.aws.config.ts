import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { parseTarget } from './tests/e2e-aws/target.ts';

// Suite for a deployed pilot (13.10). It never runs in npm run verify and has no default target: a missing or
// invalid variable stops the run here, before any browser starts or any request leaves the machine.
const target = parseTarget(process.env);

// Chromium does not inherit the suite's variables; only the test process reads the token.
const browserEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('ARTURIA_E2E_')),
) as Record<string, string>;

export default defineConfig({
  testDir: './tests/e2e-aws',
  testMatch: 'aws-stream.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  // Room for a Lambda cold start on the first API calls.
  expect: { timeout: 20_000 },
  // Nothing that could hold a session is written: console reporter only, no traces, videos, screenshots or kept output.
  reporter: [['list']],
  outputDir: join(tmpdir(), 'arturia-e2e-aws'),
  preserveOutput: 'never',
  use: {
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    serviceWorkers: 'block',
    // Bounded waits report the step that failed instead of a bare test timeout.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // A self-signed certificate is accepted only for a local rehearsal on 127.0.0.1.
    ignoreHTTPSErrors: target.loopback,
    launchOptions: {
      env: browserEnv,
      // Only the two declared hosts resolve; any other hostname fails before a connection is opened.
      args: [`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${new URL(target.webOrigin).hostname}, ` +
        `EXCLUDE ${new URL(target.apiOrigin).hostname}`],
    },
  },
  projects: [{ name: 'aws-chromium', use: { ...devices['Desktop Chrome'] } }],
});
