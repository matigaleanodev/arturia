import { expect, test } from '@playwright/test';

test('uses system colors until the user picks a theme, and remembers their choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/settings?scope=personal');
  const root = page.locator('html');
  const system = page.getByRole('radio', { name: /Sistema/ });
  const dark = page.getByRole('radio', { name: /Oscuro/ });

  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(system).toBeChecked();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');

  await system.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dark).toBeChecked();
  await expect(dark).toBeFocused();
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(dark).toBeChecked();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Volver al chat' }).click();
  await expect(page).toHaveURL(/\/chat\?scope=personal$/);
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('link', { name: 'Configuración' }).click();
  await system.check();
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
  await page.goto('/settings?scope=personal');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: /Sistema/ })).toBeChecked();
  await page.getByRole('radio', { name: /Claro/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
