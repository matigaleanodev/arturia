import { expect, type Locator, type Page, test } from '@playwright/test';

import { allStates, emptyChat, markdownConversation, openScopeMenu, themes, useTheme } from './support/views';

const props = [
  'backgroundColor', 'color', 'borderTopColor', 'borderTopWidth', 'outlineStyle', 'outlineWidth', 'outlineColor',
  'boxShadow', 'textDecorationLine', 'textDecorationThickness', 'opacity', 'transform',
] as const;
type Look = Record<(typeof props)[number], string>;

async function look(target: Locator): Promise<Look> {
  return target.evaluate((element, names) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(names.map((name) => [name, style[name as 'color']]));
  }, [...props]) as Promise<Look>;
}

function differs(a: Look, b: Look): string[] {
  return props.filter((name) => a[name] !== b[name]);
}

async function still(page: Page) {
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
}

/** Presses Tab from the start of the document until the control has focus. */
async function tabTo(page: Page, control: Locator, name: string) {
  // Reset the sequential focus starting point to the top of the document, whatever was focused before.
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
    window.scrollTo(0, 0);
  });
  await page.mouse.move(0, 0);
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press('Tab');
    if (await control.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`${name} is not reachable with Tab`);
}

/**
 * Exercises the states that apply to a pointer-and-keyboard control and requires each to look different from
 * the resting state. `focusTarget` is the element that shows the indicator when it is not the control itself.
 */
async function expectStates(
  page: Page,
  control: Locator,
  name: string,
  { active = true, hover = true, indicator = control }: { active?: boolean; hover?: boolean; indicator?: Locator } = {},
) {
  await control.scrollIntoViewIfNeeded();
  const resting = await look(indicator);

  // Keyboard focus first, with real Tab presses so :focus-visible applies in every engine.
  await tabTo(page, control, name);
  const focused = await look(indicator);
  expect(differs(resting, focused), `${name}: focus-visible must change the look`).not.toEqual([]);
  await control.evaluate((element) => (element as HTMLElement).blur());

  await control.hover();
  const hovered = await look(indicator);
  if (hover) expect(differs(resting, hovered), `${name}: hover must change the look`).not.toEqual([]);

  if (active) {
    await page.mouse.down();
    const pressed = await look(indicator);
    expect(differs(hovered, pressed), `${name}: active must change the look`).not.toEqual([]);
    await page.mouse.move(2, 2);
    await page.mouse.up();
  }
}

for (const theme of themes) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await useTheme(page, theme, 'expanded');
    });

    test('shell controls define hover, focus-visible, active and selected', async ({ page }) => {
      await emptyChat(page);
      await still(page);
      const sidebar = page.getByRole('complementary', { name: 'Navegación' });
      await expectStates(page, sidebar.locator('[data-sidebar-toggle]'), 'toggle del sidebar');
      await expectStates(page, sidebar.locator('.nav-item', { hasText: 'Nueva conversación' }), 'Nueva conversación');
      await expectStates(page, sidebar.locator('.nav-item', { hasText: 'Configuración' }), 'Configuración');
      await expectStates(page, sidebar.locator('.history a').first(), 'enlace del historial');

      // Selected: the open conversation differs from the others.
      await sidebar.locator('.history a').first().click();
      const current = sidebar.locator('.history a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await page.mouse.move(900, 400);
      const others = sidebar.locator('.history a:not([aria-current])');
      if (await others.count()) {
        expect(differs(await look(current), await look(others.first())), 'historial: selected').not.toEqual([]);
      }

      await expectStates(page, sidebar.getByRole('button', { name: /Ámbito/ }), 'selector de ámbito');
      await sidebar.getByRole('button', { name: /Ámbito/ }).click();
      await expect(sidebar.getByRole('button', { name: /Ámbito/ })).toHaveAttribute('aria-expanded', 'true');
      const items = sidebar.locator('.scope-menu a');
      await expectStates(page, items.nth(1), 'opción de ámbito');
    });

    test('collapsed rail controls define their states', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('arturia.sidebar', 'collapsed'));
      await emptyChat(page);
      await still(page);
      const rail = page.getByRole('complementary', { name: 'Navegación' });
      await expectStates(page, rail.locator('[data-sidebar-toggle]'), 'toggle del riel');
      await expectStates(page, rail.getByRole('link', { name: 'Nueva conversación' }), 'Nueva conversación del riel');
      await expectStates(page, rail.locator('.rail-scope'), 'ámbito del riel');
      await expectStates(page, rail.getByRole('link', { name: 'Configuración' }), 'Configuración del riel');
    });

    test('composer: disabled, enabled, hover, active, focus-visible and loading', async ({ page }) => {
      await emptyChat(page);
      await still(page);
      const send = page.getByRole('button', { name: 'Enviar', exact: true });
      const field = page.getByRole('textbox', { name: 'Mensaje' });
      await expect(send).toBeDisabled();
      const disabled = await look(send);
      expect(await send.evaluate((element) => getComputedStyle(element).cursor)).not.toBe('pointer');

      const composer = page.locator('.composer');
      const idle = await look(composer);
      await tabTo(page, field, 'campo de mensaje');
      expect(differs(idle, await look(composer)), 'composer enfocado').not.toEqual([]);

      await field.fill('Mensaje para probar estados');
      await expect(send).toBeEnabled();
      expect(differs(disabled, await look(send)), 'enabled vs disabled').not.toEqual([]);
      await expectStates(page, send, 'botón Enviar');

      // Loading: the same button becomes Detener while the reply is generated.
      await page.clock.install({ time: new Date('2026-11-24T12:00:00Z') });
      await field.fill('Mensaje para probar estados');
      await send.click();
      const stop = page.getByRole('button', { name: 'Detener respuesta' });
      await expect(stop).toBeVisible();
      await expect(page.locator('.stop-glyph')).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(1);
      await expectStates(page, stop, 'botón Detener');
    });

    test('reply and error controls define their states', async ({ page }) => {
      await markdownConversation(page);
      await still(page);
      await expectStates(page, page.getByRole('button', { name: 'Copiar respuesta' }), 'Copiar respuesta');
      await expect(page.getByRole('region', { name: 'Mensajes' })).toBeVisible();
      await tabTo(page, page.getByRole('region', { name: 'Mensajes' }), 'región de mensajes');
      expect(await page.getByRole('region', { name: 'Mensajes' }).evaluate((element) => getComputedStyle(element).outlineStyle))
        .not.toBe('none');
    });

    test('send error retry button defines its states', async ({ page }) => {
      await allStates(page);
      await still(page);
      await expectStates(page, page.getByRole('button', { name: 'Reintentar envío' }), 'Reintentar envío');
    });

    test('settings controls define hover, focus-visible, active and selected', async ({ page }) => {
      await page.goto('/settings?scope=personal');
      await expect(page.getByRole('heading', { name: 'Apariencia' })).toBeVisible();
      await still(page);
      await expectStates(page, page.getByRole('link', { name: 'Volver al chat' }), 'Volver al chat');
      await expectStates(page, page.getByRole('button', { name: 'Cerrar sesión' }), 'Cerrar sesión');

      const nav = page.getByRole('navigation', { name: 'Secciones' });
      const links = nav.getByRole('link');
      await expectStates(page, links.nth(1), 'navegación de secciones');
      const selected = nav.locator('a[aria-current="true"]');
      await expect(selected).toHaveCount(1);
      await page.mouse.move(900, 600);
      expect(differs(await look(selected), await look(nav.locator('a:not([aria-current="true"])').first())), 'sección: selected')
        .not.toEqual([]);

      const options = page.locator('.theme-option');
      await expect(options).toHaveCount(3);
      const checked = options.filter({ has: page.locator('input:checked') });
      // Tab reaches the checked radio of a group; the arrow keys move between the others.
      await expectStates(page, checked.locator('input'), 'tarjeta de tema', { indicator: checked, active: false, hover: false });
      // The selected card keeps its selected look under the pointer; an unselected one reacts to it.
      const other = options.filter({ has: page.locator('input:not(:checked)') }).first();
      await page.mouse.move(900, 600);
      const otherResting = await look(other);
      await other.hover();
      const otherHovered = await look(other);
      expect(differs(otherResting, otherHovered), 'tarjeta de tema: hover').not.toEqual([]);
      await page.mouse.down();
      expect(differs(otherHovered, await look(other)), 'tarjeta de tema: active').not.toEqual([]);
      await page.mouse.move(2, 2);
      await page.mouse.up();
      await expect(checked).toHaveCount(1);
      await page.mouse.move(900, 600);
      expect(differs(await look(checked), await look(options.filter({ has: page.locator('input:not(:checked)') }).first())),
        'tarjeta de tema: selected').not.toEqual([]);
    });

    test('login theme switch defines its states', async ({ page }) => {
      await page.goto('/settings?scope=personal');
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(page.getByRole('heading', { name: 'Arturia' })).toBeVisible();
      await still(page);
      const buttons = page.getByRole('group', { name: 'Tema' }).getByRole('button');
      await expectStates(page, page.locator('.theme-switch button[aria-pressed="false"]').first(), 'selector de tema del acceso');
      const selected = page.locator('.theme-switch button[aria-pressed="true"]');
      await page.mouse.move(700, 500);
      expect(differs(await look(selected), await look(page.locator('.theme-switch button[aria-pressed="false"]').first())),
        'selector de tema: selected').not.toEqual([]);
      const states = await buttons.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-pressed')));
      expect(states.filter((value) => value === 'true')).toHaveLength(1);
    });
  });
}

test('keyboard only: shell, composer, drawer, settings and sign out', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useTheme(page, 'light', 'expanded');
  await emptyChat(page);

  const indicator = () => page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    const repeated = element.hasAttribute('data-tab-seen');
    element.setAttribute('data-tab-seen', '');
    const own = getComputedStyle(element);
    // The indicator of a radio sits on its card and the composer's on its surface.
    const holder = element.closest('label, .composer') ?? element;
    const host = getComputedStyle(holder);
    const ring = (style: CSSStyleDeclaration) => style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 ||
      style.boxShadow !== 'none';
    return { name: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName, repeated, visible: ring(own) || ring(host) };
  });

  // Tab through the whole first screen: every stop is named and shows an indicator, and focus never gets trapped.
  const stops: string[] = [];
  for (let step = 0; step < 20; step += 1) {
    await page.keyboard.press('Tab');
    const stop = await indicator();
    if (!stop || stop.repeated) break; // The cycle left the document or came back to its first stop.
    expect(stop.visible, `stop ${stop.name} shows a focus indicator`).toBe(true);
    expect(stop.name.length, 'stop has an accessible name').toBeGreaterThan(0);
    stops.push(stop.name);
  }
  expect(stops.length).toBeGreaterThanOrEqual(6);
  expect(stops.length).toBeLessThan(20);
  expect(stops).toContain('TEXTAREA');
  expect(stops.some((name) => /Configuración/.test(name))).toBe(true);
  expect(stops.some((name) => /Ámbito/.test(name))).toBe(true);

  // Composer by keyboard: type, send with Enter, stop with the same control, and keep the draft.
  const field = page.getByRole('textbox', { name: 'Mensaje' });
  await field.focus();
  await page.keyboard.type('Mensaje por teclado');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]conversation=/);
  await expect(page.getByRole('button', { name: 'Detener respuesta' })).toBeVisible();
  await field.focus();
  await page.keyboard.type('Borrador');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Detener respuesta' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Respuesta cancelada')).toBeVisible();
  await expect(field).toHaveValue('Borrador');

  // Settings and sign out without a pointer.
  await page.getByRole('link', { name: 'Configuración' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings/);
  const radios = page.getByRole('radio');
  await radios.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(radios.nth(1)).toBeChecked();
  await expect(radios.nth(1)).toBeFocused();
  await page.getByRole('button', { name: 'Cerrar sesión' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Arturia' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mensaje' })).toHaveCount(0);
});

test('keyboard only: the drawer opens, traps focus and restores it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useTheme(page, 'dark');
  await emptyChat(page);
  const open = page.getByRole('button', { name: 'Abrir menú' });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Cerrar menú' })).toBeFocused();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#sidebar'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
