import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { themes, useTheme, viewports, views } from './support/views';

const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('axe canary: an unlabeled control and a low-contrast text are reported', async ({ page }) => {
  await useTheme(page, 'light');
  await page.goto('/');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',
      '<button id="canary-a"></button><p id="canary-b" style="color:#ccc;background:#fff">Texto de bajo contraste</p>');
  });
  const report = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(report.violations.map(({ id }) => id)).toEqual(expect.arrayContaining(['button-name', 'color-contrast']));
});

// The matrix of T9: every view at 320, 390, 768, 1024 and 1440 px, in both themes, with axe and layout checks.
for (const view of views) {
  for (const viewport of viewports) {
    if (view.applies && !view.applies(viewport.width)) continue;
    for (const theme of themes) {
      test(`${view.name} · ${viewport.width}px · ${theme}: axe and layout`, async ({ page }) => {
        const problems: string[] = [];
        page.on('pageerror', (error) => problems.push(error.message));
        page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
        await page.setViewportSize(viewport);
        await useTheme(page, theme, view.sidebar);

        await view.run(page, viewport.width);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const report = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
        expect(
          report.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(({ target }) => target.join(' ')) })),
        ).toEqual([]);

        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          width: innerWidth,
        }));
        expect(layout.overflow).toBeLessThanOrEqual(0);
        // The composer, when present, stays fully inside the viewport and is never covered by the sidebar rail.
        const composer = page.getByRole('textbox', { name: 'Mensaje' });
        if (await composer.isVisible()) {
          const box = (await composer.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        }
        expect(problems).toEqual([]);
      });
    }
  }
}
