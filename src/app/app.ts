import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { APP_OPTIONS } from './core/app-options';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options.testing) {
      <p class="test-mode">Modo de prueba</p>
    }
    <router-outlet />
  `,
})
export class App {
  protected readonly options = inject(APP_OPTIONS);
}
