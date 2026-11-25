import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { ScopeKey } from '../../core/app-options';
import { Icon } from '../../shared/icon';

export const scopes = [
  { key: 'personal', label: 'Personal' },
  { key: 'work', label: 'Laboral' },
] as const;

export type Scope = (typeof scopes)[number];

export function findScope(key: string | null | undefined): Scope | undefined {
  return scopes.find((scope) => scope.key === key);
}

const lastScopeKey = 'arturia.scope';

/** The scope opened last in this browser; Personal when none was stored or storage is blocked. */
export function lastScope(): Scope {
  try {
    return findScope(localStorage.getItem(lastScopeKey)) ?? scopes[0];
  } catch {
    return scopes[0];
  }
}

export function rememberScope(key: ScopeKey): void {
  try {
    localStorage.setItem(lastScopeKey, key);
  } catch {
    // The scope still opens; it is just not remembered.
  }
}

/** Disclosure that reveals the scopes as links. It is not an ARIA menu, so no menu keyboard model applies. */
@Component({
  selector: 'app-scope-picker',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'scope',
    '(document:click)': 'closeOutside($event)',
    '(keydown.escape)': 'close(true, $event)',
  },
  template: `
    <button
      #toggle
      class="scope-button"
      type="button"
      aria-controls="scope-list"
      [attr.aria-expanded]="open()"
      (click)="open.set(!open())"
    >
      <span class="scope-initial" aria-hidden="true">{{ active()?.label?.[0] }}</span>
      <span><span class="sr-only">Ámbito: </span>{{ active()?.label }}</span>
      <app-icon class="chev" name="chevron" />
    </button>
    <ul id="scope-list" class="scope-menu" [hidden]="!open()">
      @for (scope of scopes; track scope.key) {
        <li>
          <a
            routerLink="/chat"
            [queryParams]="{ scope: scope.key }"
            [attr.aria-current]="scope.key === activeScope() ? 'page' : null"
            (click)="close(false)"
          >
            <span class="scope-initial" aria-hidden="true">{{ scope.label[0] }}</span>
            {{ scope.label }}
            @if (scope.key === activeScope()) {
              <app-icon class="check" name="check" />
            }
          </a>
        </li>
      }
    </ul>
  `,
})
export class ScopePicker {
  readonly activeScope = input<ScopeKey>();
  protected readonly scopes = scopes;
  protected readonly open = signal(false);
  protected readonly active = computed(() => findScope(this.activeScope()));
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toggle = viewChild.required<ElementRef<HTMLButtonElement>>('toggle');

  protected close(restoreFocus: boolean, event?: Event): void {
    if (!this.open()) return;
    // Escape closes the list first; the drawer around it stays open.
    event?.stopPropagation();
    this.open.set(false);
    if (restoreFocus) this.toggle().nativeElement.focus();
  }

  protected closeOutside(event: Event): void {
    if (event.target instanceof Node && !this.host.nativeElement.contains(event.target)) this.open.set(false);
  }
}
