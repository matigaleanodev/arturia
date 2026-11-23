import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { expect, it } from 'vitest';

import { routes } from './app.routes';

it('shows the home page without fixture data in the default configuration', async () => {
  TestBed.configureTestingModule({
    providers: [provideRouter(routes, withComponentInputBinding())],
  });

  const harness = await RouterTestingHarness.create('/');
  const content = harness.routeNativeElement;

  expect(content?.querySelector('main h1')?.textContent?.trim()).toBe('Arturia');
  expect(content?.textContent).not.toContain('Modo de prueba');
});
