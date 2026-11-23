import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface FixturePreview {
  readonly heading: string;
  readonly conversationTitle: string;
}

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>Arturia</h1>
      <p>Tu asistente personal.</p>

      @if (fixturePreview(); as preview) {
        <section aria-labelledby="fixture-title">
          <h2 id="fixture-title">{{ preview.heading }}</h2>
          <p>{{ preview.conversationTitle }}</p>
        </section>
      }
    </main>
  `,
})
export class HomePage {
  readonly fixturePreview = input<FixturePreview>();
}
