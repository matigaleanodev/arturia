import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { appEnvironment } from './app-environment';
import { routes } from './app.routes';
import { APP_OPTIONS } from './core/app-options';
import { AuthSession } from './core/auth/auth-session';
import { RUNTIME_CONFIG_PATH } from './core/runtime-config';

afterEach(() => {
  TestBed.resetTestingModule();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it('missing_runtime_config_disables_login_with_visible_error', async () => {
  sessionStorage.setItem('arturia.oauth.session', JSON.stringify({ token: 'stale', expiresAt: Date.now() + 60_000 }));
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    requests.push(new URL(url).pathname);
    return new Response('not found', { status: 404 });
  }));
  TestBed.configureTestingModule({
    providers: [provideRouter(routes), ...(await appEnvironment())],
  });

  const harness = await RouterTestingHarness.create('/');
  const content = harness.routeNativeElement;

  expect(content?.querySelector('main h1')?.textContent?.trim()).toBe('Arturia');
  expect(content?.querySelector('[role="alert"]')?.textContent).toContain('Falta la configuración publicada');
  expect(content?.querySelector('button')).toBeNull();
  expect(content?.textContent).not.toContain('Modo de prueba');
  expect(TestBed.inject(AuthSession).accessToken()).toBeNull();

  await harness.navigateByUrl('/chat?scope=personal');
  expect(TestBed.inject(Router).url).toBe('/');
  expect(requests).toEqual([RUNTIME_CONFIG_PATH]);
});

it('names an invalid or unreachable configuration without exposing its values', async () => {
  for (const [configError, message] of [
    ['invalid', 'La configuración publicada no es válida'],
    ['unreachable', 'No se pudo obtener la configuración'],
  ] as const) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: APP_OPTIONS, useValue: { scopeIds: { personal: 'personal', work: 'work' }, configError } },
      ],
    });
    const harness = await RouterTestingHarness.create('/');
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(harness.routeNativeElement?.querySelector('button')).toBeNull();
    TestBed.resetTestingModule();
  }
});

it('removes the authorization code from the URL before showing the signed-in scopes', async () => {
  const accessToken = signal<string | null>(null);
  const complete = vi.fn(async () => { accessToken.set('synthetic-access-token'); });
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: APP_OPTIONS, useValue: { scopeIds: { personal: 'personal', work: 'work' } } },
      { provide: AuthSession, useValue: { accessToken, complete, signInAvailable: true } },
    ],
  });

  const harness = await RouterTestingHarness.create('/?code=synthetic-code&state=synthetic-state');
  await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/'));
  harness.detectChanges();

  expect(complete).toHaveBeenCalledExactlyOnceWith(
    new URLSearchParams({ code: 'synthetic-code', state: 'synthetic-state' }),
  );
  expect(harness.routeNativeElement?.textContent).toContain('Elegí un ámbito');
});
