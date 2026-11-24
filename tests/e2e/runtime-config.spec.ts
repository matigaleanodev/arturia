import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, type Page, type Route, test } from '@playwright/test';

// The production build is served from dist/ under synthetic https origins, so one build meets several configurations.
const dist = resolve('dist/arturia/browser');

function configFor(origin: string, login: string, clientId: string) {
  return {
    version: 1,
    apiBaseUrl: 'https://api.arturia.test/prod/',
    cognito: { domain: login, clientId, scopes: ['openid', 'arturia/access'] },
    redirectUri: `${origin}/`,
    logoutUri: `${origin}/`,
  };
}

async function serveBuild(page: Page, origin: string, config: (route: Route) => Promise<void>) {
  const requests: string[] = [];
  const authorizations: URL[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/oauth2/authorize') {
      authorizations.push(url);
      return route.fulfill({ contentType: 'text/html', body: '<p>login</p>' });
    }
    if (url.origin !== origin) {
      requests.push(url.href);
      return route.abort();
    }
    const navigation = route.request().resourceType() === 'document' || url.pathname === '/favicon.ico';
    if (!navigation) requests.push(url.pathname);
    if (url.pathname === '/config.json') return config(route);
    const file = join(dist, url.pathname);
    return url.pathname !== '/' && existsSync(file) && statSync(file).isFile()
      ? route.fulfill({ path: file })
      : route.fulfill({ path: join(dist, 'index.html'), contentType: 'text/html' });
  });
  return { requests, authorizations };
}

// Leaves the requests that are neither the configuration nor build assets: none may happen without a valid configuration.
const assetsOnly = (requests: string[]) =>
  requests.filter((path) => path !== '/config.json' && !/^\/[\w-]+\.(js|css)$/.test(path));

test('fixtures_keep_working_without_config_file', async ({ page }) => {
  const configRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/config.json') configRequests.push(request.url());
  });

  await page.goto('/');

  await expect(page.getByText('Modo de prueba')).toBeVisible();
  await page.getByRole('link', { name: 'Personal', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Conversación de ejemplo' })).toBeVisible();
  expect(configRequests).toEqual([]);
});

test.describe('production build', () => {
  test.beforeAll(() => {
    if (!existsSync(join(dist, 'index.html'))) throw new Error('Run npm run build before this suite');
    expect(existsSync(join(dist, 'config.json')), 'The build must not ship a configuration').toBe(false);
  });

  test('missing_runtime_config_disables_login_with_visible_error', async ({ page }) => {
    const origin = 'https://web-a.arturia.test';
    const { requests } = await serveBuild(page, origin, (route) => route.fulfill({ status: 404, body: '' }));

    await page.goto(`${origin}/`);

    await expect(page.getByRole('alert')).toContainText('Falta la configuración publicada.');
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toHaveCount(0);
    await page.goto(`${origin}/chat?scope=personal`);
    await expect(page).toHaveURL(`${origin}/`);
    expect(assetsOnly(requests)).toEqual([]);
  });

  test('invalid_or_unreachable_config_keeps_login_disabled', async ({ page }) => {
    const origin = 'https://web-a.arturia.test';
    let respond: (route: Route) => Promise<void> = (route) => route.fulfill({
      json: { ...configFor(origin, 'https://login.arturia.test', 'clientA'), apiBaseUrl: 'http://api.arturia.test/' },
    });
    const { requests } = await serveBuild(page, origin, (route) => respond(route));

    await page.goto(`${origin}/`);
    await expect(page.getByRole('alert')).toContainText('La configuración publicada no es válida.');

    respond = (route) => route.abort('connectionrefused');
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('No se pudo obtener la configuración.');
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toHaveCount(0);
    expect(assetsOnly(requests)).toEqual([]);
  });

  test('same_build_uses_each_published_configuration', async ({ browser }) => {
    for (const [origin, login, clientId] of [
      ['https://web-a.arturia.test', 'https://login-a.arturia.test', 'clientA'],
      ['https://web-b.arturia.test', 'https://login-b.arturia.test', 'clientB'],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const { requests, authorizations } = await serveBuild(page, origin, (route) =>
        route.fulfill({ json: configFor(origin, login, clientId) }));

      await page.goto(`${origin}/`);
      await page.getByRole('button', { name: 'Iniciar sesión' }).click();
      await expect.poll(() => authorizations.length).toBe(1);

      const authorization = authorizations[0]!;
      expect(authorization.origin).toBe(login);
      expect(authorization.searchParams.get('client_id')).toBe(clientId);
      expect(authorization.searchParams.get('redirect_uri')).toBe(`${origin}/`);
      expect(authorization.searchParams.get('scope')).toBe('openid arturia/access');
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      expect(requests.filter((path) => path === '/config.json')).toHaveLength(1);
      expect(assetsOnly(requests)).toEqual([]);
      await context.close();
    }
  });
});
