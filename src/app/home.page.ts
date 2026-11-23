import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthSession } from './core/auth/auth-session';
import { ScopeSwitcher } from './features/scopes/scope-switcher';

@Component({
  selector: 'app-home',
  imports: [ScopeSwitcher],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="home">
      <h1>Arturia</h1>
      @if (busy()) {
        <p role="status">Iniciando sesión…</p>
      } @else if (auth.accessToken()) {
        <p>Elegí un ámbito para abrir su historial.</p>
        <app-scope-switcher />
      } @else if (auth.signInAvailable) {
        <button class="primary" type="button" (click)="signIn()">Iniciar sesión</button>
      } @else {
        <p>El inicio de sesión todavía no está configurado.</p>
      }
      @if (error()) {
        <p class="notice" role="alert">{{ error() }}</p>
      }
    </main>
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthSession);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    const route = inject(ActivatedRoute);
    const router = inject(Router);
    const params = route.snapshot.queryParamMap;
    if (params.has('code') || params.has('error') || params.has('state')) {
      const callback = new URLSearchParams();
      for (const key of params.keys) {
        for (const value of params.getAll(key)) callback.append(key, value);
      }
      void router.navigate([], { relativeTo: route, queryParams: {}, replaceUrl: true });
      this.busy.set(true);
      void this.completeSignIn(callback);
    }
  }

  protected async signIn(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      location.assign((await this.auth.begin()).href);
    } catch {
      this.error.set('No se pudo iniciar sesión. Volvé a intentar.');
      this.busy.set(false);
    }
  }

  private async completeSignIn(callback: URLSearchParams): Promise<void> {
    try {
      await this.auth.complete(callback);
    } catch {
      this.error.set('No se pudo completar el inicio de sesión. Volvé a intentar.');
    } finally {
      this.busy.set(false);
    }
  }
}
