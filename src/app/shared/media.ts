import { DestroyRef, inject, type Signal, signal } from '@angular/core';

/** Tracks a media query as a signal. Call it in an injection context. */
export function mediaQuery(query: string): Signal<boolean> {
  const list = globalThis.matchMedia?.(query);
  const matches = signal(list?.matches ?? false);
  const update = (event: MediaQueryListEvent) => matches.set(event.matches);
  list?.addEventListener('change', update);
  inject(DestroyRef).onDestroy(() => list?.removeEventListener('change', update));
  return matches.asReadonly();
}

/** Desktop drawer breakpoint of the approved layout. */
export const MOBILE_QUERY = '(max-width: 767.98px)';
/** Widths where the sidebar starts collapsed unless the user chose otherwise. */
export const COMPACT_QUERY = '(min-width: 768px) and (max-width: 1023.98px)';
