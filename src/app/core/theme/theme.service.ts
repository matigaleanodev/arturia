import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';

const storageKey = 'arturia.theme';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly media = this.window?.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);
  private readonly selected = signal(this.readPreference());

  readonly preference = this.selected.asReadonly();
  readonly resolved = computed(() => {
    const preference = this.preference();
    return preference === 'system' ? (this.systemDark() ? 'dark' : 'light') : preference;
  });

  constructor() {
    const onChange = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.media?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener('change', onChange));
    effect(() => this.document.documentElement.dataset['theme'] = this.resolved());
  }

  setPreference(value: string): void {
    if (!isThemePreference(value)) return;
    this.selected.set(value);
    try {
      this.window?.localStorage.setItem(storageKey, value);
    } catch {
      // The preference still applies for this page when storage is blocked.
    }
  }

  private readPreference(): ThemePreference {
    try {
      const value = this.window?.localStorage.getItem(storageKey);
      if (isThemePreference(value)) return value;
    } catch {
      // Follow the operating system when storage is blocked.
    }
    return 'system';
  }
}
