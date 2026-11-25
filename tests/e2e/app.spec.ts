import { expect, test } from '@playwright/test';

test('app_loads_without_cloud', async ({ page, baseURL }) => {
  const unexpectedRequests: string[] = [];
  await page.routeWebSocket('**/*', (socket) => {
    unexpectedRequests.push(socket.url());
    socket.close();
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const localAsset =
      url.origin === baseURL &&
      request.method() === 'GET' &&
      !url.pathname.startsWith('/v1/') &&
      ['document', 'script', 'stylesheet', 'image', 'font'].includes(request.resourceType());

    if (localAsset) {
      await route.continue();
    } else {
      unexpectedRequests.push(request.url());
      await route.abort();
    }
  });

  await page.goto('/');

  await expect(page.getByText('Modo de prueba')).toBeVisible();
  await expect(page).toHaveURL(/\/chat\?scope=personal$/);
  await expect(page.getByRole('link', { name: 'Conversación de ejemplo' })).toBeVisible();
  expect(unexpectedRequests).toEqual([]);
});
