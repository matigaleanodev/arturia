import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS } from '../app-options';
import { AuthSession } from './auth-session';

const testOrigin = 'https://arturia.example';
const oauth = {
  authorizationEndpoint: 'https://identity.example/oauth2/authorize',
  tokenEndpoint: 'https://identity.example/oauth2/token',
  logoutEndpoint: 'https://identity.example/logout',
  clientId: 'public-client',
  scopes: ['openid', 'arturia/access'],
  redirectUri: 'https://arturia.example/',
  logoutUri: 'https://arturia.example/',
};

function makeAuth(options: Partial<typeof oauth> = {}) {
  vi.stubGlobal('location', new URL(testOrigin));
  TestBed.configureTestingModule({
    providers: [{ provide: APP_OPTIONS, useValue: { oauth: { ...oauth, ...options } } }],
  });
  return TestBed.inject(AuthSession);
}

afterEach(() => {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it('binds the callback to the S256 challenge and exchanges the code only once', async () => {
  const auth = makeAuth();
  let exchange: URLSearchParams | undefined;
  const fetchToken = vi.fn((_url: URL, options: RequestInit) => {
    exchange = options.body as URLSearchParams;
    return Promise.resolve(
      Response.json({
        access_token: 'access-for-chat',
        id_token: 'identity-only',
        token_type: 'Bearer',
        expires_in: 300,
      }),
    );
  });
  vi.stubGlobal('fetch', fetchToken);

  const authorization = await auth.begin();
  const params = authorization.searchParams;
  expect(authorization.origin).toBe('https://identity.example');
  expect(params.get('code_challenge_method')).toBe('S256');
  expect(params.get('redirect_uri')).toBe('https://arturia.example/');
  expect(params.get('response_type')).toBe('code');
  expect(params.get('scope')).toBe('openid arturia/access');
  expect(params.get('state')).toMatch(/^[\w-]{43}$/);

  const callback = new URLSearchParams({ code: 'code-123', state: params.get('state')! });
  await auth.complete(callback);
  expect(auth.accessToken()).toBe('access-for-chat');

  expect(fetchToken).toHaveBeenCalledWith(
    new URL(oauth.tokenEndpoint),
    expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
  );
  expect(exchange?.get('code')).toBe('code-123');
  const verifier = exchange?.get('code_verifier') ?? '';
  expect(verifier).toMatch(/^[\w-]{43}$/);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  expect(params.get('code_challenge')).toBe(
    btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll('+', '-').replaceAll('/', '_').slice(0, 43),
  );
  await expect(auth.complete(callback)).rejects.toThrow();
  expect(fetchToken).toHaveBeenCalledTimes(1);
});

it('consumes a mismatched state without exchanging a token', async () => {
  const auth = makeAuth();
  const fetchToken = vi.fn();
  vi.stubGlobal('fetch', fetchToken);

  const state = (await auth.begin()).searchParams.get('state')!;
  await expect(auth.complete(new URLSearchParams({ code: 'code', state: 'wrong' }))).rejects.toThrow();
  await expect(auth.complete(new URLSearchParams({ code: 'code', state }))).rejects.toThrow();
  expect(fetchToken).not.toHaveBeenCalled();
  expect(auth.accessToken()).toBeNull();
});

it('disables sign-in when the configured redirect is not the current origin root', async () => {
  for (const redirectUri of ['https://other.example/', 'https://arturia.example/callback']) {
    const auth = makeAuth({ redirectUri });
    expect(auth.signInAvailable).toBe(false);
    await expect(auth.begin()).rejects.toThrow();
    TestBed.resetTestingModule();
  }
});

it('ignores a stored session when sign-in is not configured', () => {
  sessionStorage.setItem('arturia.oauth.session', JSON.stringify({ token: 'stale', expiresAt: Date.now() + 60_000 }));
  vi.stubGlobal('location', new URL(testOrigin));
  TestBed.configureTestingModule({
    providers: [{ provide: APP_OPTIONS, useValue: { scopeIds: {}, configError: 'missing' } }],
  });
  const auth = TestBed.inject(AuthSession);
  expect(auth.signInAvailable).toBe(false);
  expect(auth.accessToken()).toBeNull();
});

it('signs out locally and returns the hosted logout URL of the published configuration', () => {
  sessionStorage.setItem('arturia.oauth.session', JSON.stringify({ token: 'active', expiresAt: Date.now() + 60_000 }));
  sessionStorage.setItem('arturia.oauth.transaction', '{}');
  const auth = makeAuth();
  expect(auth.accessToken()).toBe('active');

  const logout = auth.signOut();

  expect(auth.accessToken()).toBeNull();
  expect(sessionStorage.getItem('arturia.oauth.session')).toBeNull();
  expect(sessionStorage.getItem('arturia.oauth.transaction')).toBeNull();
  expect(logout?.origin + logout!.pathname).toBe('https://identity.example/logout');
  expect(Object.fromEntries(logout!.searchParams)).toEqual({
    client_id: 'public-client',
    logout_uri: 'https://arturia.example/',
  });
});

it('signs out without a hosted logout when it does not match the sign-in configuration', () => {
  for (const options of [
    { logoutEndpoint: 'https://other-identity.example/logout' },
    { logoutEndpoint: 'http://identity.example/logout' },
    { logoutUri: 'https://other.example/' },
    { redirectUri: 'https://other.example/' },
  ]) {
    sessionStorage.setItem('arturia.oauth.session', JSON.stringify({ token: 'active', expiresAt: Date.now() + 60_000 }));
    const auth = makeAuth(options);
    expect(auth.signOut(), JSON.stringify(options)).toBeNull();
    expect(auth.accessToken()).toBeNull();
    expect(sessionStorage.getItem('arturia.oauth.session')).toBeNull();
    TestBed.resetTestingModule();
  }
});
