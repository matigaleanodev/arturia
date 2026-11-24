import { expect, type Page, type Request, test } from '@playwright/test';

import { blocksBeforeTerminal, type Sample } from './streaming.ts';
import { parseTarget } from './target.ts';

const target = parseTarget(process.env);
// Storage contract of BrowserAuthSession (src/app/core/auth/auth-session.ts): one JSON entry in sessionStorage.
const sessionKey = 'arturia.oauth.session';
const sessionLifetimeMs = 15 * 60_000;
const replyTimeoutMs = 90_000;
// Same lead the API smoke requires between the first block and the terminal state (smoke:sse:aws).
const minLeadMs = 500;
const terminalStatuses = new Set(['completed', 'incomplete', 'failed', 'cancelled', 'blocked']);

/** Records every change of the newest reply's live region: active state (aria-busy) and visible text length. */
async function watchReply(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples: { at: number; busy: boolean; length: number }[] = [];
    Reflect.set(window, 'arturiaReplySamples', samples);
    const messages = document.querySelector('[role="region"][aria-label="Mensajes"]');
    if (!messages) throw new Error('Messages region not found');
    const record = () => {
      const live = [...messages.querySelectorAll('[aria-live]')].at(-1);
      if (live) {
        samples.push({
          at: Date.now(),
          busy: live.getAttribute('aria-busy') === 'true',
          length: (live.textContent ?? '').trim().length,
        });
      }
    };
    new MutationObserver(record).observe(messages, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-busy'],
    });
  });
}

test('deployed_browser_displays_blocks_before_terminal', async ({ browser }) => {
  // Requests are observed, never intercepted: interception would answer CORS preflights inside Playwright and hide the
  // pilot's real CORS. Hosts other than the two declared ones do not resolve (host-resolver-rules in the config).
  const context = await browser.newContext();
  try {
    const outside: string[] = [];
    const misdirected: string[] = [];
    const requestedAt = new Map<Request, number>();
    const pending: Promise<unknown>[] = [];
    context.on('request', (request) => {
      requestedAt.set(request, Date.now());
      const origin = new URL(request.url()).origin;
      if (origin !== target.webOrigin && origin !== target.apiOrigin) outside.push(`${request.method()} ${origin}`);
      pending.push(request.headerValue('authorization').then((value) => {
        if (value !== null && origin !== target.apiOrigin) misdirected.push(`${request.method()} ${origin}`);
      }));
    });
    const page = await context.newPage();
    const streams: string[] = [];
    const terminalRequests: number[] = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin !== target.apiOrigin || response.status() !== 200) return;
      if (url.pathname.endsWith('/events')) {
        streams.push(response.headers()['content-type'] ?? '');
      } else if (response.request().method() === 'GET' && /\/v1\/scopes\/[^/]+\/turns\/[^/]+$/.test(url.pathname)) {
        pending.push(response.json().then((body: { status?: string }) => {
          const at = requestedAt.get(response.request());
          if (body.status && terminalStatuses.has(body.status) && at !== undefined) terminalRequests.push(at);
        }, () => undefined));
      }
    });

    await test.step('the published configuration matches the declared target', async () => {
      const published = await page.goto(`${target.webOrigin}/config.json`);
      expect(published?.ok(), 'config.json is published').toBe(true);
      const config = await published!.json() as { apiBaseUrl?: string; redirectUri?: string };
      const apiBaseUrl = config.apiBaseUrl?.endsWith('/') ? config.apiBaseUrl : `${config.apiBaseUrl}/`;
      expect(apiBaseUrl, 'published apiBaseUrl').toBe(target.apiBaseUrl);
      expect(config.redirectUri, 'published redirectUri').toBe(`${target.webOrigin}/`);
    });

    await test.step('the access token is stored for the declared distribution only', async () => {
      await page.goto(`${target.webOrigin}/`);
      // The origin is checked inside the page, in the same task that stores the token.
      await page.evaluate(({ origin, key, value }) => {
        if (location.origin !== origin) throw new Error('The page left the declared distribution');
        sessionStorage.setItem(key, value);
      }, {
        origin: target.webOrigin,
        key: sessionKey,
        value: JSON.stringify({ token: target.accessToken, expiresAt: Date.now() + sessionLifetimeMs }),
      });

      const history = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.origin === target.apiOrigin && response.request().method() === 'GET' &&
          url.pathname.endsWith(`/v1/scopes/${target.scope}/conversations`);
      });
      await page.goto(`${target.webOrigin}/chat?scope=${target.scope}`);
      expect((await history).status(), 'the API accepts the access token for the scope').toBe(200);
      await expect(page, 'the access token opens the chat').toHaveURL(new RegExp(`/chat\\?scope=${target.scope}`));
    });

    await test.step('a new turn shows its blocks before the terminal status', async () => {
      await page.getByRole('button', { name: 'Nueva conversación' }).click();
      await expect(page).toHaveURL(/[?&]conversation=/);
      await page.getByRole('textbox', { name: 'Mensaje' }).fill('Prueba automatizada de streaming del piloto.');
      await watchReply(page);
      const sentAt = Date.now();
      await page.getByRole('button', { name: 'Enviar' }).click();

      const reply = page.getByRole('region', { name: 'Mensajes' }).locator('[aria-live]').last();
      await expect(reply, 'the turn reaches a terminal status').toHaveAttribute('aria-busy', 'false', { timeout: replyTimeoutMs });
      await Promise.all(pending);
      const samples = await page.evaluate(() => Reflect.get(window, 'arturiaReplySamples') as Sample[]);
      const terminalRequestedAt = terminalRequests.length ? Math.min(...terminalRequests) : undefined;
      const evidence = blocksBeforeTerminal(samples, { terminalRequestedAt, minLeadMs });
      expect(streams.length, 'the reply was delivered through SSE').toBeGreaterThan(0);
      expect(streams.every((type) => type.startsWith('text/event-stream')), 'SSE media type').toBe(true);
      console.log(`first block after ${evidence.firstBlockAt - sentAt} ms, ${evidence.leadMs} ms ahead of the ` +
        `terminal snapshot, terminal after ${evidence.terminalAt - sentAt} ms, ` +
        `${evidence.partialLength}/${evidence.finalLength} characters`);
    });

    await Promise.all(pending);
    expect(outside, 'requests outside the declared origins').toEqual([]);
    expect(misdirected, 'Authorization sent outside the API').toEqual([]);
  } finally {
    // Closing the context discards the session storage even when an assertion failed. After a timeout Playwright
    // may already have closed it; that must not hide the original failure.
    await context.close().catch(() => undefined);
  }
});
