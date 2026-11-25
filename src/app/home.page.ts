import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { APP_OPTIONS } from './core/app-options';
import { AuthSession } from './core/auth/auth-session';
import type { RuntimeConfigError } from './core/runtime-config';
import { ThemeSwitch } from './core/theme/theme-switch';
import { lastScope } from './features/scopes/scope-switcher';
import { BrandMark } from './shared/icon';

const configErrors: Record<RuntimeConfigError, string> = {
  missing: 'Falta la configuración publicada.',
  invalid: 'La configuración publicada no es válida.',
  unreachable: 'No se pudo obtener la configuración.',
};

/** Sign-in screen. With a session it opens the scope used last in this browser. */
@Component({
  selector: 'app-home',
  imports: [ThemeSwitch, BrandMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login">
      <header class="login-top"><app-theme-switch /></header>
      <main class="login-center">
        <div class="login-card">
          <app-brand-mark />
          <div>
            <h1>Arturia</h1>
            <p>Asistente personal</p>
          </div>
          @if (busy()) {
            <p role="status">Iniciando sesión…</p>
          } @else if (auth.accessToken()) {
            <p role="status">Abriendo tus conversaciones…</p>
          } @else if (auth.signInAvailable) {
            <button class="button button-primary" type="button" (click)="signIn()">Iniciar sesión</button>
            <p class="note">Vas a ingresar con tu cuenta y un código de verificación.</p>
          } @else if (configError) {
            <p class="notice" role="alert">{{ configError }} El inicio de sesión está deshabilitado.</p>
          } @else {
            <p class="note">El inicio de sesión todavía no está configurado.</p>
          }
          @if (error()) {
            <p class="notice" role="alert">{{ error() }}</p>
          }
        </div>
      </main>
    </div>
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthSession);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly configErrorKey = inject(APP_OPTIONS).configError;
  protected readonly configError = this.configErrorKey ? configErrors[this.configErrorKey] : '';

  constructor() {
    const route = inject(ActivatedRoute);
    const router = inject(Router);
    const params = route.snapshot.queryParamMap;
    const callback = params.has('code') || params.has('error') || params.has('state');
    if (callback) {
      const values = new URLSearchParams();
      for (const key of params.keys) {
        for (const value of params.getAll(key)) values.append(key, value);
      }
      void router.navigate([], { relativeTo: route, queryParams: {}, replaceUrl: true });
      this.busy.set(true);
      void this.completeSignIn(values);
    }

    effect(() => {
      if (this.auth.accessToken() && !this.busy()) {
        void router.navigate(['/chat'], { queryParams: { scope: lastScope().key }, replaceUrl: true });
      }
    });
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
