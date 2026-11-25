import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, type Page, type Route, test } from '@playwright/test';

import { dist, fulfillConfig, fulfillFromDist, pilotSecurityHeaders } from './support/pilot-hosting';

// Synthetic origins with the shapes the pilot builds: distribution, Regional REST API with stage and Cognito domain.
const web = 'https://d1a2b3c4d5e6f7.cloudfront.net';
const api = 'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com';
const cognito = 'https://arturia-pilot.auth.us-east-1.amazoncognito.com';
const token = 'synthetic-access-token';
const headers = pilotSecurityHeaders({ api, cognito });
const fixtures = JSON.parse(readFileSync(resolve('src/app/core/api/contract/fixtures/chat.json'), 'utf8'));
const config = {
  version: 1,
  apiBaseUrl: `${api}/prod/`,
  cognito: { domain: cognito, clientId: 'syntheticClient', scopes: ['openid', 'arturia/access'] },
  redirectUri: `${web}/`,
  logoutUri: `${web}/`,
};

const canaryOrigin = 'https://csp-canary.invalid';

interface Violation {
  readonly directive: string;
  readonly blocked: string;
  readonly source: string;
}

/** Collects CSP violations from the DOM event and, independently, from the browser console. */
async function watchCsp(page: Page) {
  const violations: Violation[] = [];
  const reports: string[] = [];
  const errors: string[] = [];
  let canaries = 0;
  await page.exposeFunction('reportCspViolation', (violation: Violation) => { violations.push(violation); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = Reflect.get(window, 'reportCspViolation') as (violation: unknown) => Promise<void>;
      void report({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        source: `${event.sourceFile}:${event.lineNumber}`,
      });
    }, true);
  });
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) reports.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  const isCanary = (violation: Violation) => violation.directive === 'img-src' && violation.blocked.startsWith(canaryOrigin);
  // Firefox requests /favicon.ico by itself; that browser-internal request is not application traffic.
  const isBrowserFavicon = (violation: Violation) => violation.directive === 'img-src' && violation.blocked.endsWith('/favicon.ico');
  const unexpectedViolations = () => violations.filter((violation) => !isCanary(violation) && !isBrowserFavicon(violation));
  // Only Chromium logs CSP violations to the console; elsewhere the DOM event is the single channel.
  const consoleChannel = page.context().browser()?.browserType().name() === 'chromium';

  /** Fails with what both channels recorded so far, without touching the page. */
  function expectNoRecordedViolations(): void {
    expect(unexpectedViolations(), 'CSP violations').toEqual([]);
    if (consoleChannel) expect(reports.length, `CSP console reports: ${JSON.stringify(reports)}`).toBeLessThanOrEqual(canaries);
  }

  /**
   * Requests an image from an origin outside img-src: its violation proves the policy is enforced and both channels
   * work. The DOM channel can lose a violation raised right before a navigation, so the exact console count is the
   * guarantee; the canary's console report, ordered after earlier ones in the same document, bounds the wait.
   */
  async function expectNoViolations(): Promise<void> {
    expectNoRecordedViolations();
    canaries += 1;
    await page.evaluate((src) => {
      const image = document.createElement('img');
      image.src = src;
      document.body.append(image);
    }, `${canaryOrigin}/${canaries}.png`);
    await expect.poll(() => violations.filter(isCanary).length, { message: 'the CSP must block and report the canary' }).toBe(canaries);
    if (consoleChannel) await expect.poll(() => reports.length, { message: 'canary console report' }).toBeGreaterThanOrEqual(canaries);
    expect(unexpectedViolations(), 'CSP violations').toEqual([]);
    if (consoleChannel) expect(reports, 'CSP console reports').toHaveLength(canaries);
    expect(errors, 'page errors').toEqual([]);
  }

  return { expectNoRecordedViolations, expectNoViolations };
}

interface StoredTurn {
  input: { text: string };
  snapshot: Record<string, unknown>;
}

/** Contract-shaped responses from the shared fixtures, for the synthetic actor only. */
function chatApi(unexpected: string[], streams: string[]) {
  const conversations = new Map<string, { scopeId: string; title?: string; createdAt: string; turns: StoredTurn[] }>([
    [fixtures.getConversation.conversationId, {
      scopeId: 'personal',
      title: fixtures.getConversation.title,
      createdAt: fixtures.getConversation.createdAt,
      turns: (fixtures.getConversation.turns as StoredTurn[])
        .map((turn) => ({ ...turn, snapshot: { ...turn.snapshot, scopeId: 'personal' } })),
    }],
  ]);
  const turns = new Map<string, { conversationId: string; scopeId: string; turn: StoredTurn }>();
  const cors = { 'access-control-allow-origin': web, vary: 'Origin' };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });

  return async (route: Route): Promise<void> => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-headers': 'Authorization,Content-Type,Idempotency-Key',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
        },
      });
    }
    if (request.headers()['authorization'] !== `Bearer ${token}`) return json(route, 401, fixtures.revokedPermission);

    const path = url.pathname.match(/^\/prod\/v1\/scopes\/(personal|work)\/(.+)$/);
    const [scopeId, rest] = path ? [path[1]!, path[2]!] : ['', ''];
    const summary = (id: string) => {
      const item = conversations.get(id)!;
      return { scopeId: item.scopeId, conversationId: id, ...(item.title ? { title: item.title } : {}), createdAt: item.createdAt };
    };
    const own = (id: string | undefined) => (id && conversations.get(id)?.scopeId === scopeId ? id : undefined);

    if (rest === 'conversations' && request.method() === 'GET') {
      return json(route, 200, { conversations: [...conversations.keys()].filter((id) => own(id)).map(summary) });
    }
    if (rest === 'conversations' && request.method() === 'POST') {
      const id = `created-${conversations.size}`;
      conversations.set(id, { scopeId, createdAt: '2026-11-24T19:00:00Z', turns: [] });
      return json(route, 201, summary(id));
    }
    let match = rest.match(/^conversations\/([^/]+)$/);
    if (match && own(match[1]) && request.method() === 'GET') {
      const id = match[1]!;
      return json(route, 200, { ...summary(id), turns: conversations.get(id)!.turns });
    }
    match = rest.match(/^conversations\/([^/]+)\/turns$/);
    if (match && own(match[1]) && request.method() === 'POST') {
      const conversationId = match[1]!;
      const turnId = `turn-${turns.size + 1}`;
      const turn: StoredTurn = {
        input: request.postDataJSON() as { text: string },
        snapshot: { turnId, scopeId, conversationId, status: 'queued', lastSeq: 0 },
      };
      conversations.get(conversationId)!.turns.push(turn);
      turns.set(turnId, { conversationId, scopeId, turn });
      return json(route, 202, { turnId, status: 'queued' });
    }
    match = rest.match(/^turns\/([^/]+)(\/events)?$/);
    const stored = match ? turns.get(match[1]!) : undefined;
    if (match && stored?.scopeId === scopeId && request.method() === 'GET') {
      if (!match[2]) return json(route, 200, stored.turn.snapshot);
      streams.push(url.searchParams.get('after') ?? '');
      const after = Number(url.searchParams.get('after') ?? '0');
      const events = (fixtures.stream.events as Record<string, unknown>[])
        .map((event): Record<string, unknown> => ({ ...event, turnId: match[1] }))
        .filter((event) => event['type'] !== 'text' || Number(event['seq']) > after);
      stored.turn.snapshot = {
        ...stored.turn.snapshot,
        status: 'completed',
        lastSeq: 2,
        result: fixtures.turnSnapshots.completed.result,
      };
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'cache-control': 'no-cache' },
        contentType: 'text/event-stream',
        body: fixtures.stream.heartbeat + events.map((event) => `event: ${event['type']}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
      });
    }
    unexpected.push(`${request.method()} ${url.href}`);
    return json(route, 404, { code: 'NOT_FOUND', message: 'Recurso inexistente.', requestId: 'synthetic' });
  };
}

/** Routes every request: the distribution, Cognito and the API are synthetic; anything else is aborted and recorded. */
async function servePilot(page: Page, configuration: Promise<void>) {
  const unexpected: string[] = [];
  const exchanges: URLSearchParams[] = [];
  const streams: string[] = [];
  const api$ = chatApi(unexpected, streams);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === web) {
      if (url.pathname === '/config.json') {
        await configuration;
        return fulfillConfig(route, config, headers);
      }
      return fulfillFromDist(route, url.pathname, headers);
    }
    if (url.origin === cognito && url.pathname === '/oauth2/authorize') {
      const callback = new URL(config.redirectUri);
      callback.search = new URLSearchParams({ code: 'synthetic-code', state: url.searchParams.get('state') ?? '' }).toString();
      // The hosted UI ends by sending the browser back to the registered callback with the code and the state.
      return route.fulfill({
        contentType: 'text/html',
        body: `<meta http-equiv="refresh" content="0;url=${callback.href.replaceAll('&', '&amp;')}">`,
      });
    }
    if (url.origin === cognito && url.pathname === '/oauth2/token' && request.method() === 'POST') {
      exchanges.push(new URLSearchParams(request.postData() ?? ''));
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': web },
        body: JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 3600 }),
      });
    }
    if (url.origin === api) return api$(route);
    unexpected.push(`${request.method()} ${url.href}`);
    return route.abort('blockedbyclient');
  });
  return { unexpected, exchanges, streams };
}

test.beforeAll(() => {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Run npm run build before this suite');
});

test('local_dist_has_no_csp_violations', async ({ page }) => {
  const csp = await watchCsp(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    if (location.hostname.endsWith('.cloudfront.net') && !sessionStorage.getItem('theme-seeded')) {
      localStorage.setItem('arturia.theme', 'dark');
      sessionStorage.setItem('theme-seeded', '1');
    }
  });
  let releaseConfig!: () => void;
  const { unexpected, exchanges, streams } = await servePilot(page, new Promise<void>((resolve) => { releaseConfig = resolve; }));
  const theme = page.locator('html');
  const configResponses: Record<string, string>[] = [];
  page.on('response', (response) => {
    if (response.url() === `${web}/config.json`) configResponses.push(response.headers());
  });

  try {
    await test.step('the stored theme applies before the runtime configuration arrives', async () => {
      let response;
      try {
        response = await page.goto(`${web}/`, { waitUntil: 'domcontentloaded' });
        await expect(theme).toHaveAttribute('data-theme', 'dark');
        await expect(theme).toHaveCSS('color-scheme', 'dark');
        await expect(page.getByRole('main')).toHaveCount(0);
      } finally {
        releaseConfig();
      }
      expect(response?.headers()).toMatchObject({ ...headers, 'cache-control': 'no-cache' });
    await expect.poll(() => configResponses.length).toBeGreaterThan(0);
    expect(configResponses[0]).toMatchObject({ ...headers, 'cache-control': 'no-store', 'content-type': 'application/json' });
    });

    await test.step('access screen and theme change', async () => {
      await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
      await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: 'Claro' }).click();
      await expect(theme).toHaveAttribute('data-theme', 'light');
      expect(await page.evaluate(() => localStorage.getItem('arturia.theme'))).toBe('light');
      await csp.expectNoViolations();
    });

    await test.step('sign-in with PKCE against the synthetic Cognito', async () => {
      await page.getByRole('button', { name: 'Iniciar sesión' }).click();
      await expect(page).toHaveURL(`${web}/chat?scope=personal`);
      await expect(page.getByRole('textbox', { name: 'Mensaje' })).toBeVisible();
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0]!.get('grant_type')).toBe('authorization_code');
      expect(exchanges[0]!.get('code')).toBe('synthetic-code');
      expect(exchanges[0]!.get('code_verifier')).toBeTruthy();
      await expect(theme).toHaveAttribute('data-theme', 'light');
    });

    await test.step('chat: history, new conversation, streamed reply and scope change', async () => {
      const messages = page.getByRole('region', { name: 'Mensajes' });
      const status = page.getByRole('status').filter({ hasText: /Respuesta/ });
      await page.getByRole('navigation', { name: 'Conversaciones' })
        .getByRole('link', { name: fixtures.getConversation.title }).click();
      await expect(messages).toContainText(fixtures.turnSnapshots.completed.result.text);

      await page.getByRole('link', { name: 'Nueva conversación', exact: true }).click();
      await expect(page).toHaveURL(`${web}/chat?scope=personal`);
      await expect(page.getByRole('heading', { name: '¿En qué te ayudo?' })).toBeVisible();
      await expect(status).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Mensaje' }).fill(fixtures.acceptTurn.request.text);
      await page.getByRole('button', { name: 'Enviar' }).click();
      await expect(page).toHaveURL(/[?&]conversation=created-/);
      await expect(messages).toContainText(fixtures.acceptTurn.request.text);
      await expect(messages).toContainText(fixtures.turnSnapshots.completed.result.text);
      await expect(status).toHaveText('Respuesta completa');
      await expect(messages.getByRole('heading', { level: 3 }).or(messages.locator('p'))).not.toHaveCount(0);
      expect(streams.length, 'the reply arrives through SSE').toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Ámbito: Personal' }).click();
      await page.getByRole('link', { name: 'Laboral' }).click();
      await expect(page.getByRole('heading', { name: 'Laboral', level: 1 })).toBeAttached();
      await expect(page.getByText('Todavía no hay conversaciones.')).toBeVisible();
    });

    await test.step('theme change in Configuración persists across a deep-link reload', async () => {
      await page.getByRole('link', { name: 'Configuración' }).click();
      await page.getByRole('radio', { name: /Oscuro/ }).check();
      await expect(theme).toHaveAttribute('data-theme', 'dark');
      await page.getByRole('link', { name: 'Volver al chat' }).click();
      await expect(page).toHaveURL(`${web}/chat?scope=work`);
      await page.reload();
      await expect(theme).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByRole('heading', { name: 'Laboral', level: 1 })).toBeAttached();
    });
  } catch (error) {
    // A blocked request often surfaces as a functional failure: report the recorded violation, else the original error.
    csp.expectNoRecordedViolations();
    throw error;
  }
  await csp.expectNoViolations();
  expect(unexpected, 'requests outside the synthetic pilot').toEqual([]);
});
