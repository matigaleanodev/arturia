import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS } from '../app-options';
import { AuthSession } from './auth-session';

const oauth = {
  authorizationEndpoint: 'https://identity.example/oauth2/authorize',
  tokenEndpoint: 'https://identity.example/oauth2/token',
  logoutEndpoint: 'https://identity.example/logout',
  clientId: 'public-client',
  scopes: ['openid', 'arturia/access'],
  redirectUri: 'https://arturia.example/',
  logoutUri: 'https://arturia.example/',
};

function makeAuth(expiresInMs = 300_000) {
  vi.stubGlobal('location', new URL('https://arturia.example'));
  sessionStorage.setItem(
    'arturia.oauth.session',
    JSON.stringify({ token: 'stored-access-token', expiresAt: Date.now() + expiresInMs }),
  );
  TestBed.configureTestingModule({ providers: [{ provide: APP_OPTIONS, useValue: { oauth } }] });
  return TestBed.inject(AuthSession);
}

afterEach(() => {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('starts without an ended-session reason', () => {
  expect(makeAuth().endedReason()).toBeNull();
});

it('records why the session ended and drops the stored token', () => {
  for (const reason of ['expired', 'denied'] as const) {
    const auth = makeAuth();
    auth.clear(reason);
    expect(auth.accessToken()).toBeNull();
    expect(auth.endedReason()).toBe(reason);
    expect(sessionStorage.getItem('arturia.oauth.session')).toBeNull();
    TestBed.resetTestingModule();
  }
});

it('defaults a bare clear to an expired session', () => {
  const auth = makeAuth();
  auth.clear();
  expect(auth.endedReason()).toBe('expired');
});

it('reports an expired session when the stored token runs out', () => {
  vi.useFakeTimers();
  const auth = makeAuth(1_000);
  vi.advanceTimersByTime(1_001);
  expect(auth.accessToken()).toBeNull();
  expect(auth.endedReason()).toBe('expired');
});

it('reports expiry when a denial arrives within the clock-skew margin of the local expiry', () => {
  const auth = makeAuth(20_000);
  auth.clear('denied');
  expect(auth.endedReason()).toBe('expired');
});

it('keeps a denial for a token with plenty of local validity left', () => {
  const auth = makeAuth(120_000);
  auth.clear('denied');
  expect(auth.endedReason()).toBe('denied');
});

it('keeps a denied reason when a later clear arrives for the same ended session', () => {
  const auth = makeAuth();
  auth.clear('denied');
  auth.clear('expired');
  expect(auth.endedReason()).toBe('denied');
});

it('forgets the reason when the user signs in again or signs out on purpose', async () => {
  const auth = makeAuth();
  auth.clear('denied');
  await auth.begin();
  expect(auth.endedReason()).toBeNull();

  auth.clear('denied');
  const logout = auth.signOut();
  expect(auth.endedReason()).toBeNull();
  expect(logout?.origin).toBe('https://identity.example');
  expect(logout?.searchParams.get('client_id')).toBe('public-client');
  expect(logout?.searchParams.get('logout_uri')).toBe('https://arturia.example/');
});
