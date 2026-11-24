import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ThemeService } from './theme.service';

@Component({
  selector: 'app-theme-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="theme-control">
      <span>Tema</span>
      <select #preference [value]="theme.preference()" (change)="theme.setPreference(preference.value)">
        <option value="system">Sistema</option>
        <option value="light">Claro</option>
        <option value="dark">Oscuro</option>
      </select>
    </label>
  `,
})
export class ThemeSelect {
  protected readonly theme = inject(ThemeService);
}
