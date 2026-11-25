import { expect, test as base, type Page } from '@playwright/test';

const syntheticResponse = 'Hola, este es un resultado sintético.';

async function openConversation(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '¿En qué te ayudo?' })).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Mensaje' }).fill(text);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page).toHaveURL(/[?&]conversation=/);
}

const test = base.extend<{ denyUnexpectedNetwork: void }>({
  denyUnexpectedNetwork: [async ({ context, baseURL }, use) => {
    const unexpected: string[] = [];
    await context.routeWebSocket('**/*', (socket) => {
      unexpected.push(socket.url());
      socket.close();
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
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
    await use();
    expect(unexpected).toEqual([]);
  }, { auto: true }],
});

test('conversation_scope_is_fixed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Conversación de ejemplo' }).click();
  await expect(page.getByText(syntheticResponse)).toBeVisible();
  const personal = new URL(page.url());

  await page.getByRole('button', { name: 'Ámbito: Personal' }).click();
  await page.getByRole('link', { name: 'Laboral', exact: true }).click();
  await expect(page.getByText(syntheticResponse)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Conversación de ejemplo' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Laboral' })).toBeAttached();
  await expect(page.getByRole('heading', { name: '¿En qué te ayudo?' })).toBeVisible();

  personal.searchParams.set('scope', 'work');
  await page.goto(personal.href);
  await expect(page.getByRole('alert')).toContainText('No se pudo abrir la conversación');
  await expect(page.getByText(syntheticResponse)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Mensaje' })).toHaveCount(0);
});

test('reload_recovers_turn_by_id', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await openConversation(page);
  await sendMessage(page, 'Mensaje recuperado después de recargar');
  await expect(page.getByRole('button', { name: 'Detener respuesta' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Detener respuesta' })).toBeVisible();
  await page.clock.fastForward(5_000);
  await expect(page.getByText(syntheticResponse)).toBeVisible();
  await expect(page.getByText('Mensaje recuperado después de recargar')).toHaveCount(1);
});

test('stable_submission_key', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('arturia.fixture.scenario', 'lost-response'));
  await openConversation(page);
  await sendMessage(page, 'Mensaje sin acuse');
  await expect(page.getByRole('alert')).toContainText('No se pudo confirmar el envío');
  await expect(page.getByRole('textbox', { name: 'Mensaje' })).toHaveValue('Mensaje sin acuse');
  await page.getByRole('button', { name: 'Reintentar envío' }).click();

  await expect(page.getByText(syntheticResponse)).toBeVisible();
  await page.reload();
  await expect(page.getByText('Mensaje sin acuse')).toHaveCount(1);
  await expect(page.getByText(syntheticResponse)).toHaveCount(1);
});

test('error_status_is_visible', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await openConversation(page);
  await page.evaluate(() => sessionStorage.setItem('arturia.fixture.scenario', 'incomplete'));
  await sendMessage(page, 'Mensaje con respuesta interrumpida');
  await expect(page.getByRole('button', { name: 'Detener respuesta' })).toBeVisible();
  await page.clock.fastForward(5_000);
  await expect(page.getByText('Respuesta incompleta', { exact: true })).toBeVisible();
  await expect(page.getByText('Hola,', { exact: true })).toBeVisible();

  await page.evaluate(() => sessionStorage.setItem('arturia.fixture.scenario', 'failed'));
  await sendMessage(page, 'Mensaje con generación fallida');
  const failed = page.getByRole('article').filter({ hasText: 'Mensaje con generación fallida' });
  await expect(page.getByRole('button', { name: 'Detener respuesta' })).toBeVisible();
  await page.clock.runFor(800);
  await expect(failed.getByText('Generando respuesta…', { exact: true })).toBeVisible();
  await expect(failed.getByText('Hola,', { exact: true })).toHaveCount(0);
  await page.clock.fastForward(5_000);
  await expect(failed.getByText('No se generó una respuesta', { exact: true })).toBeVisible();
  await expect(failed.getByText('Hola,', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Respuesta incompleta', { exact: true })).toBeVisible();
});

test('explicit_cancel_remains_cancelled_after_reload', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await openConversation(page);
  await sendMessage(page, 'Mensaje cancelado');
  await page.getByRole('button', { name: 'Detener respuesta' }).click();
  await expect(page.getByText('Respuesta cancelada', { exact: true })).toBeVisible();
  await page.reload();
  await page.clock.fastForward(5_000);
  await expect(page.getByText('Respuesta cancelada', { exact: true })).toBeVisible();
  await expect(page.getByText(syntheticResponse)).toHaveCount(0);
});

test('untitled conversations have distinguishable history links', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await openConversation(page);
  await sendMessage(page, 'Primera conversación');
  const history = page.getByRole('navigation', { name: 'Conversaciones' });
  const links = history.getByRole('link', { name: /^Nueva conversación/ });
  await expect(links).toHaveCount(1);
  const previousHref = await links.first().getAttribute('href');

  await page.clock.fastForward(61_000);
  await page.getByRole('link', { name: 'Nueva conversación', exact: true }).click();
  await expect(page).not.toHaveURL(/conversation=/);
  await expect(page.getByRole('textbox', { name: 'Mensaje' })).toBeFocused();
  await sendMessage(page, 'Segunda conversación');
  await expect(links).toHaveCount(2);
  const titles = (await links.allTextContents()).map((text) => text.trim());

  expect(new Set(titles).size).toBe(2);
  await links.last().click();
  await expect(page).toHaveURL(new URL(previousHref!, page.url()).href);
});
