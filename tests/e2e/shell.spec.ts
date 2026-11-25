import { expect, type Page, test } from '@playwright/test';

async function sendFirstMessage(page: Page, text: string, scenario?: string) {
  if (scenario) await page.evaluate((value) => sessionStorage.setItem('arturia.fixture.scenario', value), scenario);
  await page.getByRole('textbox', { name: 'Mensaje' }).fill(text);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page).toHaveURL(/[?&]conversation=/);
}

test('the first message creates the conversation, and Detener reuses the send button', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat\?scope=personal$/);
  await expect(page.getByRole('heading', { name: '¿En qué te ayudo?' })).toBeVisible();
  const field = page.getByRole('textbox', { name: 'Mensaje' });
  const send = page.getByRole('button', { name: 'Enviar', exact: true });
  await expect(send).toBeDisabled();

  await field.fill('Mensaje inicial');
  await send.evaluate((button) => button.setAttribute('data-probe', 'send'));
  await field.press('Enter');
  await expect(page).toHaveURL(/[?&]conversation=/);
  // The same element switches roles, so it keeps its position and any focus it had.
  const stop = page.getByRole('button', { name: 'Detener respuesta' });
  await expect(stop).toHaveAttribute('data-probe', 'send');
  await expect(page.getByRole('navigation', { name: 'Conversaciones' }).getByRole('link', { name: /^Nueva conversación/ }))
    .toHaveAttribute('aria-current', 'page');

  // The draft can be written while the reply is generated; it is not sent until the reply ends.
  await field.fill('Borrador en curso');
  await field.press('Enter');
  await expect(field).toHaveValue('Borrador en curso');
  await stop.click();
  await expect(page.getByText('Respuesta cancelada')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Respuesta cancelada' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
});

test('Shift+Enter adds a line and the field grows up to eight lines', async ({ page }) => {
  await page.goto('/');
  const field = page.getByRole('textbox', { name: 'Mensaje' });
  await field.click();
  const single = (await field.boundingBox())!.height;
  await field.press('Shift+Enter');
  await field.pressSequentially('segunda');
  await expect(field).toHaveValue('\nsegunda');
  expect((await field.boundingBox())!.height).toBeGreaterThan(single);
  await expect(page).not.toHaveURL(/conversation=/);

  await field.fill(Array.from({ length: 20 }, (_, index) => `Línea ${index}`).join('\n'));
  const tall = (await field.boundingBox())!.height;
  const metrics = await field.evaluate((element) => {
    const style = getComputedStyle(element);
    return { line: parseFloat(style.lineHeight), padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) };
  });
  expect(Math.round(tall)).toBe(Math.round(metrics.line * 8 + metrics.padding));
});

test('replies render safe Markdown and can be copied', async ({ page, context, browserName }) => {
  // Only Chromium grants clipboard permissions to the test; the other engines still confirm the copy in the interface.
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await page.goto('/');
  await sendFirstMessage(page, '¿Cómo organizo la mudanza?', 'markdown');
  await page.clock.fastForward(5_000);

  const messages = page.getByRole('region', { name: 'Mensajes' });
  await expect(messages.getByRole('heading', { name: 'Plan para la mudanza', level: 3 })).toBeVisible();
  await expect(messages.locator('strong', { hasText: 'tres etapas' })).toBeVisible();
  await expect(messages.locator('ol > li')).toHaveCount(3);
  await expect(messages.getByRole('table')).toBeVisible();
  await expect(messages.getByRole('columnheader', { name: 'Semana' })).toHaveClass(/align-center/);
  await expect(messages.locator('pre code')).toHaveText('const semanas = 3;');
  await expect(messages.getByRole('link', { name: 'la guía' })).toHaveAttribute('href', 'https://example.com/guia');
  await expect(messages.getByRole('link', { name: 'la guía' })).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(messages.getByRole('link', { name: 'esto' })).toHaveCount(0);
  await expect(messages).toContainText('<img src=x onerror=alert(1)>');
  await expect(messages.locator('img, script')).toHaveCount(0);

  await page.getByRole('button', { name: 'Copiar respuesta' }).click();
  await expect(page.getByRole('button', { name: 'Respuesta copiada' })).toBeVisible();
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('## Plan para la mudanza');
  }
  expect(dialogs).toEqual([]);
});

test('the sidebar collapses by preference and starts collapsed between 768 and 1023 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const close = page.getByRole('button', { name: 'Cerrar barra lateral', exact: true });
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  await close.click();
  const open = page.getByRole('button', { name: 'Abrir barra lateral', exact: true });
  await expect(open).toBeFocused();
  await expect(page.getByRole('button', { name: /^Ámbito: Personal\. Abrir/ })).toBeVisible();
  await page.reload();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(page.getByRole('button', { name: 'Cerrar barra lateral', exact: true })).toBeFocused();

  await page.evaluate(() => localStorage.removeItem('arturia.sidebar'));
  await page.setViewportSize({ width: 900, height: 900 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Abrir barra lateral', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.getByRole('button', { name: 'Cerrar barra lateral', exact: true })).toBeVisible();
});

for (const width of [320, 390]) {
  test(`the mobile drawer traps focus and returns it at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Personal', level: 1 })).toBeVisible();
    const menu = page.getByRole('button', { name: 'Abrir menú' });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Navegación' });
    const close = drawer.getByRole('button', { name: 'Cerrar menú' });
    await expect(close).toBeFocused();
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.getByRole('link', { name: 'Configuración' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    await drawer.getByRole('button', { name: 'Ámbito: Personal' }).click();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Ámbito: Personal' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(menu).toBeFocused();
    await expect(page.locator('main')).not.toHaveAttribute('inert');

    await menu.click();
    await page.getByRole('link', { name: 'Conversación de ejemplo' }).click();
    await expect(page).toHaveURL(/conversation=/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Mensaje' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('Configuración returns to the same scope and conversation, and signs out', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ámbito: Personal' }).click();
  await page.getByRole('link', { name: 'Laboral' }).click();
  await expect(page).toHaveURL(/\/chat\?scope=work$/);
  await page.getByRole('button', { name: 'Ámbito: Laboral' }).click();
  await page.getByRole('link', { name: 'Personal' }).click();
  await page.getByRole('link', { name: 'Conversación de ejemplo' }).click();
  const conversation = page.url();

  await page.getByRole('link', { name: 'Configuración' }).click();
  await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Volver al chat' }).click();
  await expect(page).toHaveURL(conversation);
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat\?scope=personal$/);

  await page.getByRole('link', { name: 'Configuración' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Arturia', level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mensaje' })).toHaveCount(0);
});
