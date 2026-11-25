import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'panel' | 'compose' | 'sliders' | 'chevron' | 'check' | 'menu' | 'close' | 'up' | 'back'
  | 'sun' | 'moon' | 'monitor' | 'alert' | 'stop' | 'clock' | 'cut' | 'lock' | 'logout'
  | 'palette' | 'user' | 'copy';

/** Decorative stroke icon. The control that contains it carries the accessible name. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" focusable="false">
      @switch (name()) {
        @case ('panel') { <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /> }
        @case ('compose') {
          <path d="M11 4.5H7a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4" />
          <path d="M17.6 3.9a1.9 1.9 0 0 1 2.7 2.7L12.5 14.4 9 15l.6-3.5z" />
        }
        @case ('sliders') {
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
        }
        @case ('chevron') { <path d="M7 9.5l5 5 5-5" /> }
        @case ('check') { <path d="M5 12.5l4.5 4.5L19 7.5" /> }
        @case ('menu') { <path d="M4 7h16M4 12h16M4 17h16" /> }
        @case ('close') { <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /> }
        @case ('up') { <path d="M12 19V5.5M6 11.5l6-6 6 6" /> }
        @case ('back') { <path d="M19 12H5.5M11.5 6l-6 6 6 6" /> }
        @case ('sun') {
          <circle cx="12" cy="12" r="3.75" />
          <path d="M12 3v1.75M12 19.25V21M3 12h1.75M19.25 12H21M5.6 5.6l1.25 1.25M17.15 17.15l1.25 1.25M5.6 18.4l1.25-1.25M17.15 6.85l1.25-1.25" />
        }
        @case ('moon') { <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" /> }
        @case ('monitor') { <rect x="3.5" y="4.5" width="17" height="11.5" rx="2" /><path d="M8.5 20h7M12 16v4" /> }
        @case ('alert') { <circle cx="12" cy="12" r="8.5" /><path d="M12 7.75v5M12 16.25v.01" /> }
        @case ('stop') { <circle cx="12" cy="12" r="8.5" /><rect x="9" y="9" width="6" height="6" rx="1" /> }
        @case ('clock') { <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /> }
        @case ('cut') { <circle cx="12" cy="12" r="8.5" /><path d="M8 12h8" /> }
        @case ('lock') { <rect x="5.5" y="10.5" width="13" height="9" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /> }
        @case ('logout') {
          <path d="M9.5 4.5h-3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h3" /><path d="M15 16l4-4-4-4M19 12H9.5" />
        }
        @case ('palette') {
          <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.7 0-1 .8-1.6 1.8-1.6h2.1a3.8 3.8 0 0 0 3.8-3.8C20.5 6.8 16.7 3.5 12 3.5z" />
          <circle cx="8" cy="11" r=".9" /><circle cx="10.5" cy="7.5" r=".9" /><circle cx="15" cy="7.8" r=".9" />
        }
        @case ('user') { <circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1.2-3.2 3.8-4.8 7-4.8s5.8 1.6 7 4.8" /> }
        @case ('copy') {
          <rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
}

/** The provisional brand mark: a rhombus with a gold outline. Decorative everywhere it appears. */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mark', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" focusable="false">
      <path class="mark-outer" d="M12 2.75 19.75 12 12 21.25 4.25 12Z" />
      <path class="mark-inner" d="M12 7v10" />
    </svg>
  `,
})
export class BrandMark {}
