import { expect, test } from '@playwright/test';

test('uses system colors until the user picks a theme, and remembers their choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const root = page.locator('html');
  const theme = page.getByRole('combobox', { name: 'Tema' });

  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(theme).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');

  await theme.focus();
  await expect(theme).toBeFocused();
  await theme.press('End');
  await expect(theme).toHaveValue('dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(theme).toHaveValue('dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Personal' }).click();
  await expect(theme).toHaveValue('dark');

  await theme.selectOption('system');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
});

test('falls back to system when local storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage unavailable', 'SecurityError'); },
    });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const theme = page.getByRole('combobox', { name: 'Tema' });

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(theme).toHaveValue('system');
  await theme.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

for (const [width, height] of [[320, 690], [768, 1024]] as const) {
  test(`history and composer work by keyboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('link', { name: 'Personal' }).click();
    const history = page.getByRole('button', { name: 'Historial' });
    const sample = page.getByRole('link', { name: 'Conversación de ejemplo' });
    await expect(history).toHaveAttribute('aria-expanded', 'false');
    await expect(sample).toBeHidden();

    if (width === 320) {
      const brand = await page.getByRole('heading', { name: 'Arturia' }).boundingBox();
      const theme = await page.getByRole('combobox', { name: 'Tema' }).boundingBox();
      const scopes = await page.getByRole('navigation', { name: 'Ámbitos' }).boundingBox();
      expect(brand!.x + brand!.width).toBeLessThan(theme!.x);
      expect(scopes!.y).toBeGreaterThanOrEqual(theme!.y + theme!.height);
    }

    await history.focus();
    await history.press('Enter');
    await expect(history).toHaveAttribute('aria-expanded', 'true');
    await sample.focus();
    await expect(sample).toBeFocused();
    await sample.press('Escape');
    await expect(history).toBeFocused();

    await history.press('Enter');
    await sample.focus();
    await sample.press('Enter');
    await expect(history).toHaveAttribute('aria-expanded', 'false');
    await expect(history).toBeFocused();
    const textbox = page.getByRole('textbox', { name: 'Mensaje' });
    await expect(textbox).toBeInViewport();
    await textbox.fill('a'.repeat(350));
    await expect(page.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

    await history.press('Enter');
    const work = page.getByRole('link', { name: 'Laboral' });
    await work.focus();
    await work.press('Enter');
    await expect(work).toHaveAttribute('aria-current', 'page');
    await expect(history).toHaveAttribute('aria-expanded', 'false');
    await expect(work).toBeFocused();
  });
}
