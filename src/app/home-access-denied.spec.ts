import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { routes } from './app.routes';
import { APP_OPTIONS } from './core/app-options';
import { AuthSession } from './core/auth/auth-session';

// Regression: an account Cognito accepts but Arturia has not provisioned (or has revoked) used to land on
// the plain sign-in screen with no explanation. Signing in again reused the Cognito cookie and bounced back.

const oauth = {
  authorizationEndpoint: 'https://identity.example/oauth2/authorize',
  tokenEndpoint: 'https://identity.example/oauth2/token',
  logoutEndpoint: 'https://identity.example/logout',
  clientId: 'public-client',
  scopes: ['openid', 'arturia/access'],
  redirectUri: 'https://arturia.example/',
  logoutUri: 'https://arturia.example/',
};

const button = (root: Element | null, label: string) =>
  [...root?.querySelectorAll('button') ?? []].find((candidate) => candidate.textContent?.includes(label));

afterEach(() => {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function configure(options: { reason: 'expired' | 'denied' | null; logout?: URL | null }) {
  const reason = signal(options.reason);
  const begin = vi.fn(async () => new URL('https://identity.example/oauth2/authorize'));
  // Like the real session, signing out forgets why the previous session ended.
  const signOut = vi.fn(() => {
    reason.set(null);
    return options.logout === undefined ? new URL('https://identity.example/logout?client_id=public-client') : options.logout;
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: APP_OPTIONS, useValue: { scopeIds: { personal: 'p', work: 'w' }, oauth } },
      {
        provide: AuthSession,
        useValue: { accessToken: signal(null), endedReason: reason.asReadonly(), signInAvailable: true, begin, signOut },
      },
    ],
  });
  return { begin, signOut };
}

it('explains the denied access and offers to sign out instead of looping through sign-in', async () => {
  const { begin } = configure({ reason: 'denied' });
  const assign = vi.fn();
  vi.stubGlobal('location', { assign, href: 'https://arturia.example/' });

  const harness = await RouterTestingHarness.create('/');
  const content = harness.routeNativeElement;

  expect(content?.querySelector('[role="alert"]')?.textContent).toContain('no tiene acceso a Arturia');
  expect(button(content, 'Iniciar sesión')).toBeUndefined();
  expect(begin).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
  expect(TestBed.inject(Router).url).toBe('/');
});

it('signs out of the hosted identity page so another account can sign in', async () => {
  const { signOut } = configure({ reason: 'denied' });
  const assign = vi.fn();
  vi.stubGlobal('location', { assign, href: 'https://arturia.example/' });

  const harness = await RouterTestingHarness.create('/');
  button(harness.routeNativeElement, 'otra cuenta')?.click();

  expect(signOut).toHaveBeenCalledOnce();
  expect(assign).toHaveBeenCalledExactlyOnceWith('https://identity.example/logout?client_id=public-client');
});

it('keeps a way to sign in when the hosted sign-out is not configured', async () => {
  configure({ reason: 'denied', logout: null });
  vi.stubGlobal('location', { assign: vi.fn(), href: 'https://arturia.example/' });

  const harness = await RouterTestingHarness.create('/');
  button(harness.routeNativeElement, 'otra cuenta')?.click();
  harness.detectChanges();

  expect(button(harness.routeNativeElement, 'Iniciar sesión')).toBeDefined();
  expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain('no tiene acceso a Arturia');
});

it('says the session expired and keeps the regular sign-in', async () => {
  configure({ reason: 'expired' });

  const harness = await RouterTestingHarness.create('/');
  const content = harness.routeNativeElement;

  expect(content?.querySelector('[role="status"], [role="alert"]')?.textContent).toContain('sesión venció');
  expect(button(content, 'Iniciar sesión')).toBeDefined();
  expect(content?.textContent).not.toContain('no tiene acceso');
});

it('shows the plain sign-in when nothing ended the session', async () => {
  configure({ reason: null });

  const harness = await RouterTestingHarness.create('/');
  const content = harness.routeNativeElement;

  expect(button(content, 'Iniciar sesión')).toBeDefined();
  expect(content?.querySelector('[role="alert"]')).toBeNull();
  expect(content?.textContent).not.toContain('venció');
});
