# Testing

[Español](testing.es.md)

## Full verification

```sh
npm exec -- playwright install chromium
npm run verify
```

On Linux without the browser’s system libraries, use `npm exec -- playwright install --with-deps chromium`.

CI runs `verify`, which covers the contract and generated types, unit tests, the production build and Chromium end-to-end tests with fixtures.

## Suites

| Command | Scope |
| --- | --- |
| `npm test` | Unit and component tests with Vitest (`src/**/*.spec.ts`). |
| `npm run test:e2e` | Playwright end-to-end tests in `tests/e2e/`, in Chromium, against `npm run start:fixtures` on `127.0.0.1:4201`. Includes accessibility checks with axe-core. |
| `npm run test:e2e:cross` | The same suite in Chromium, Firefox and WebKit. Install those browsers first with `npm exec -- playwright install firefox webkit`. |
| `npm run test:contract` | Tests that the contract digest check detects drift. |
| `npm run contract:check` | Snapshot digest and generated types are up to date. |
| `npm run test:e2e:aws:unit` | Unit tests of the deployed-environment suite (`tests/e2e-aws/*.test.ts`). |
| `npm run build` | Production build plus the checks in `scripts/check-production.mjs`. |

Fixture-based tests use synthetic data from `src/app/testing/` and the contract fixture; they make no requests outside loopback.

## Deployed environment

`npm run test:e2e:aws` checks a deployed environment in Chromium. It never runs in `verify` and has no default target. Configuration ([`playwright.aws.config.ts`](../playwright.aws.config.ts), [`tests/e2e-aws/target.ts`](../tests/e2e-aws/target.ts)):

| Variable | Value |
| --- | --- |
| `ARTURIA_E2E_WEB_URL` | Root URL of the web distribution. |
| `ARTURIA_E2E_API_URL` | API base URL, stage included. |
| `ARTURIA_E2E_ACCESS_TOKEN` | Access token of a test user. |
| `ARTURIA_E2E_SCOPE` | Optional: `personal` (default) or `work`. |

Every value is validated before a browser starts, and errors name the variable, never its value. The token is passed to the browser only through the page's `sessionStorage`; only the two declared hosts resolve; no traces, videos, screenshots or test output are kept. Each run creates one conversation in the chosen scope.

## Integrated run with the API

`tests/e2e/chat-real-api.spec.ts` and the `integrated` Angular configuration run the web client against a local Arturia API on loopback. They are started from the API checkout (`npm run verify:integrated` with `ARTURIA_WEB_DIR` pointing to this repository), which provides the API origin and sets `ARTURIA_INTEGRATED=1`. `npm run test:e2e` skips this spec.
