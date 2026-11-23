import { expect, test } from '@playwright/test';

const partial = 'Hola,';
const final = 'Hola, este es un resultado sintético.';

function frame(event: { type: string }): string {
  return 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n';
}

test('shows progress and resumes without duplicating text', async ({ page, context, baseURL }) => {
  const cursors: string[] = [];
  const unexpected: string[] = [];
  let releaseFinal!: () => void;
  const finalReady = new Promise<void>((resolve) => { releaseFinal = resolve; });
  let turnId: string | undefined;
  await context.routeWebSocket('**/*', (socket) => {
    unexpected.push(socket.url());
    socket.close();
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const streamPath = url.pathname.match(/^\/v1\/scopes\/fixture-personal\/turns\/([^/]+)\/events$/);
    if (url.origin === baseURL && request.method() === 'GET' && streamPath) {
      turnId ??= streamPath[1];
      expect(streamPath[1]).toBe(turnId);
      expect(request.headers()['authorization']).toBe('Bearer arturia-test-session');
      expect(request.headers()['accept']).toBe('text/event-stream');
      cursors.push(url.searchParams.get('after')!);
      const first = { type: 'text', turnId, seq: 1, text: partial + ' ' };
      if (cursors.length === 1) {
        await route.fulfill({ contentType: 'text/event-stream', body: ': keep-alive\n\n' + frame(first) });
      } else {
        await finalReady;
        const second = { type: 'text', turnId, seq: 2, text: 'este es un resultado sintético.' };
        const terminal = { type: 'status', turnId, status: 'completed', lastSeq: 2 };
        await route.fulfill({
          contentType: 'text/event-stream',
          body: frame(first) + frame(second) + frame(terminal),
        });
      }
      return;
    }
    if (
      url.origin === baseURL &&
      request.method() === 'GET' &&
      !url.pathname.startsWith('/v1/') &&
      ['document', 'script', 'stylesheet', 'image', 'font'].includes(request.resourceType())
    ) {
      await route.continue();
      return;
    }
    unexpected.push(url.origin);
    await route.abort();
  });

  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.addInitScript(() => sessionStorage.setItem('arturia.fixture.stream', 'true'));
  await page.goto('/');
  await page.getByRole('link', { name: 'Personal', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva conversación' }).click();
  await page.getByRole('textbox', { name: 'Mensaje' }).fill('Mensaje de streaming');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();

  try {
    await expect(page.getByText(partial, { exact: true })).toBeVisible();
    await expect(page.getByText('Respuesta completa', { exact: true })).toHaveCount(0);
    expect(cursors[0]).toBe('0');
    await page.clock.fastForward(3_000);
    await expect.poll(() => cursors).toEqual(['0', '1']);
    releaseFinal();
    await expect(page.getByText(final, { exact: true })).toHaveCount(1);
    await expect(page.getByText('Respuesta completa', { exact: true })).toBeVisible();
    expect(unexpected).toEqual([]);
  } finally {
    releaseFinal();
  }
});
