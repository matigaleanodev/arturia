import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { expect, it, vi } from 'vitest';

import { appProviders } from './app-environment';
import { routes } from './app.routes';
import { AuthSession } from './core/auth/auth-session';

it('shows the home page without fixture data in the default configuration', async () => {
  TestBed.configureTestingModule({
    providers: [provideRouter(routes), ...appProviders],
  });

  const harness = await RouterTestingHarness.create('/');
  const content = harness.routeNativeElement;

  expect(content?.querySelector('main h1')?.textContent?.trim()).toBe('Arturia');
  expect(content?.textContent).not.toContain('Modo de prueba');
});


it('removes the authorization code from the URL before showing the signed-in scopes', async () => {
  const accessToken = signal<string | null>(null);
  const complete = vi.fn(async () => { accessToken.set('synthetic-access-token'); });
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      ...appProviders,
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
