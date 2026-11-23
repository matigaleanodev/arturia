import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { ScopeKey } from '../../core/app-options';

export const scopes = [
  { key: 'personal', label: 'Personal' },
  { key: 'work', label: 'Laboral' },
] as const;

export function findScope(key: string | null) {
  return scopes.find((scope) => scope.key === key);
}

@Component({
  selector: 'app-scope-switcher',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="scope-switcher" aria-label="Ámbitos">
      @for (scope of scopes; track scope.key) {
        <a
          routerLink="/chat"
          [queryParams]="{ scope: scope.key }"
          [attr.aria-current]="scope.key === activeScope() ? 'page' : null"
        >{{ scope.label }}</a>
      }
    </nav>
  `,
})
export class ScopeSwitcher {
  readonly activeScope = input<ScopeKey>();
  protected readonly scopes = scopes;
}
