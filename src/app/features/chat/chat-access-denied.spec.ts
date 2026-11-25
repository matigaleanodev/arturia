import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { routes } from '../../app.routes';
import { APP_OPTIONS } from '../../core/app-options';
import { AuthSession } from '../../core/auth/auth-session';

// Full path with the real session and API client: a valid Cognito token for an account Arturia does not
// recognise ends on the home screen with an explanation, makes no further requests and changes nothing.

const oauth = {
  authorizationEndpoint: 'https://identity.example/oauth2/authorize',
  tokenEndpoint: 'https://identity.example/oauth2/token',
  logoutEndpoint: 'https://identity.example/logout',
  clientId: 'public-client',
  scopes: ['openid', 'arturia/access'],
  redirectUri: 'https://arturia.example/',
  logoutUri: 'https://arturia.example/',
};

afterEach(() => {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open(respond: () => Response) {
  vi.stubGlobal('location', Object.assign(new URL('https://arturia.example/'), { assign: vi.fn() }));
  sessionStorage.setItem(
    'arturia.oauth.session',
    JSON.stringify({ token: 'synthetic-access-token', expiresAt: Date.now() + 300_000 }),
  );
  const requests: { method: string; path: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    requests.push({ method: request.method ?? 'GET', path: url.pathname });
    return respond();
  }));
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      {
        provide: APP_OPTIONS,
        useValue: {
          scopeIds: { personal: 'scope-personal', work: 'scope-work' },
          apiBaseUrl: 'https://api.arturia.example/prod/',
          oauth,
        },
      },
    ],
  });
  return requests;
}

const unprovisioned = () =>
  Response.json(
    { code: 'UNAUTHENTICATED', message: 'Se requiere una sesión válida.', requestId: 'req-internal-1' },
    { status: 401 },
  );

it('leaves the chat for an explained denial and does not retry or redirect on its own', async () => {
  const requests = open(unprovisioned);

  const harness = await RouterTestingHarness.create('/chat?scope=personal');
  await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/'));
  await vi.waitFor(() => expect(harness.routeNativeElement?.textContent).toContain('no tiene acceso a Arturia'));
  const settled = requests.length;
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(TestBed.inject(AuthSession).accessToken()).toBeNull();
  expect(sessionStorage.getItem('arturia.oauth.session')).toBeNull();
  expect(requests).toHaveLength(settled);
  expect(requests.every(({ method }) => method === 'GET')).toBe(true);
  expect(location.assign).not.toHaveBeenCalled();
  // Nothing about the account or the rejected request reaches the screen.
  const shown = harness.routeNativeElement?.textContent ?? '';
  expect(shown).not.toContain('req-internal-1');
  expect(shown).not.toContain('UNAUTHENTICATED');
});

it('reports an expired session when the gateway rejects the token', async () => {
  open(() => Response.json({ message: 'Unauthorized' }, { status: 401 }));

  const harness = await RouterTestingHarness.create('/chat?scope=personal');
  await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/'));
  await vi.waitFor(() => expect(harness.routeNativeElement?.textContent).toContain('sesión venció'));

  expect(harness.routeNativeElement?.textContent).not.toContain('no tiene acceso');
});
