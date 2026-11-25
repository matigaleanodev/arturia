import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChildren } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthSession } from '../../core/auth/auth-session';
import { ThemeService } from '../../core/theme/theme.service';
import { Icon } from '../../shared/icon';
import { MOBILE_QUERY, mediaQuery } from '../../shared/media';
import { findScope, lastScope } from '../scopes/scope-switcher';

const themes = [
  { value: 'light', title: 'Claro', detail: 'Saber', preview: ['light'] },
  { value: 'dark', title: 'Oscuro', detail: 'Saber Alter', preview: ['dark'] },
  { value: 'system', title: 'Sistema', detail: 'Sigue al dispositivo', preview: ['light', 'dark'] },
] as const;

/** Global settings outside the shell. "Volver al chat" returns to the scope and conversation it came from. */
@Component({
  selector: 'app-settings',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="settings">
      <header class="settings-top">
        <a class="back" routerLink="/chat" [queryParams]="returnParams()" aria-label="Volver al chat">
          <app-icon name="back" /><span class="back-label">Volver al chat</span>
        </a>
        @if (mobile()) {
          <h1>Configuración</h1>
        }
      </header>
      <main class="settings-body">
        @if (!mobile()) {
          <h1>Configuración</h1>
          <nav class="settings-nav" aria-label="Secciones">
            @for (section of sections; track section.id) {
              <a
                routerLink="."
                [fragment]="section.id"
                queryParamsHandling="preserve"
                [attr.aria-current]="activeSection() === section.id ? 'true' : null"
                (click)="activeSection.set(section.id)"
              ><app-icon [name]="section.icon" />{{ section.label }}</a>
            }
          </nav>
        }
        <div class="settings-sections">
          <section #section class="settings-section" id="apariencia" aria-labelledby="appearance-heading">
            <header>
              <h2 id="appearance-heading">Apariencia</h2>
              <p>Elegí cómo se ve Arturia en este navegador.</p>
            </header>
            <fieldset class="theme-options">
              <legend class="sr-only">Tema</legend>
              @for (option of themes; track option.value) {
                <label class="theme-option">
                  <span class="thumb" aria-hidden="true">
                    @for (palette of option.preview; track palette) {
                      <span class="half" [class]="palette + '-pal'">
                        <span class="t-rail"><i></i><i class="w70"></i><i class="w85"></i></span>
                        <span class="t-main"><span class="t-bubble"></span><i class="w80"></i><span class="t-comp"></span></span>
                      </span>
                    }
                  </span>
                  <input
                    type="radio"
                    name="theme"
                    [value]="option.value"
                    [checked]="theme.preference() === option.value"
                    (change)="theme.setPreference(option.value)"
                  />
                  <span class="meta">
                    <span><strong>{{ option.title }}</strong><small>{{ option.detail }}</small></span>
                    <span class="radio" aria-hidden="true"></span>
                  </span>
                </label>
              }
            </fieldset>
          </section>
          <section #section class="settings-section" id="sesion" aria-labelledby="session-heading">
            <header><h2 id="session-heading">Sesión</h2></header>
            <div class="session-row">
              <p>
                <strong>Sesión iniciada en este navegador</strong>
                Al cerrarla, vas a necesitar tu código de verificación para volver a entrar.
              </p>
              <button class="button" type="button" (click)="signOut()"><app-icon name="logout" />Cerrar sesión</button>
            </div>
          </section>
        </div>
      </main>
    </div>
  `,
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly themes = themes;
  protected readonly sections = [
    { id: 'apariencia', label: 'Apariencia', icon: 'palette' },
    { id: 'sesion', label: 'Sesión', icon: 'user' },
  ] as const;
  protected readonly activeSection = signal<string>('apariencia');
  protected readonly mobile = mediaQuery(MOBILE_QUERY);
  private readonly auth = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  private readonly sectionElements = viewChildren<ElementRef<HTMLElement>>('section');

  protected readonly returnParams = computed(() => {
    const params = this.params();
    const scope = findScope(params?.get('scope')) ?? lastScope();
    const conversation = params?.get('conversation');
    return conversation ? { scope: scope.key, conversation } : { scope: scope.key };
  });

  constructor() {
    effect(() => {
      if (!this.auth.accessToken()) void this.router.navigate(['/'], { replaceUrl: true });
    });

    // The section nearest the top of the viewport is the current one in the navigation.
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) =>
        a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) this.activeSection.set(visible[0].target.id);
    }, { rootMargin: '0px 0px -55% 0px' });
    effect(() => {
      observer?.disconnect();
      for (const section of this.sectionElements()) observer?.observe(section.nativeElement);
    });
    inject(DestroyRef).onDestroy(() => observer?.disconnect());
  }

  protected signOut(): void {
    const logout = this.auth.signOut();
    if (logout) location.assign(logout.href);
    else void this.router.navigate(['/'], { replaceUrl: true });
  }
}
