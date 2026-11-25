import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { Icon } from '../../shared/icon';
import { type ThemePreference, ThemeService } from './theme.service';

/** Compact theme choice for the sign-in screen; Configuración offers the same choice as radio cards. */
@Component({
  selector: 'app-theme-switch',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="theme-switch" role="group" aria-label="Tema">
      @for (option of options; track option.value) {
        <button
          type="button"
          [attr.aria-label]="option.label"
          [title]="option.label"
          [attr.aria-pressed]="theme.preference() === option.value"
          (click)="theme.setPreference(option.value)"
        ><app-icon [name]="option.icon" /></button>
      }
    </div>
  `,
})
export class ThemeSwitch {
  protected readonly theme = inject(ThemeService);
  protected readonly options: readonly { value: ThemePreference; label: string; icon: 'monitor' | 'sun' | 'moon' }[] = [
    { value: 'system', label: 'Sistema', icon: 'monitor' },
    { value: 'light', label: 'Claro', icon: 'sun' },
    { value: 'dark', label: 'Oscuro', icon: 'moon' },
  ];
}
