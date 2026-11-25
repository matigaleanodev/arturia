import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';

import type { ConversationTurn } from '../../core/api/contract/openapi.generated';
import { BrandMark, Icon } from '../../shared/icon';
import { MarkdownView } from './markdown/markdown-view';

@Component({
  selector: 'app-turn',
  imports: [BrandMark, Icon, MarkdownView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="turn">
      <div class="msg-user"><span class="sr-only">Vos: </span>{{ turn().input.text }}</div>
      <div class="assistant">
        <span class="sr-only">Arturia: </span>
        <div class="reply-body" [class.is-streaming]="status() === 'running'" [attr.aria-busy]="active()">
          @if (text()) {
            <app-markdown [source]="text()" />
          }
        </div>
        @switch (status()) {
          @case ('running') {
            <div class="generating"><app-brand-mark /><span>Generando respuesta…</span></div>
          }
          @case ('queued') {
            <div class="turn-status"><app-icon name="clock" /><p>En espera</p></div>
          }
          @case ('cancelled') {
            <div class="turn-status"><app-icon name="stop" /><p>Respuesta cancelada</p></div>
          }
          @case ('incomplete') {
            <div class="turn-status is-warning">
              <app-icon name="cut" />
              <div>
                <p><strong>Respuesta incompleta</strong></p>
                @if (errorMessage()) {
                  <p class="detail">{{ errorMessage() }}</p>
                }
              </div>
            </div>
          }
          @case ('failed') {
            <div class="status-error">
              <app-icon name="alert" />
              <div><strong>No se generó una respuesta</strong><span class="detail">{{ errorMessage() }}</span></div>
            </div>
          }
          @case ('blocked') {
            <div class="status-error">
              <app-icon name="lock" />
              <div><strong>Respuesta bloqueada</strong><span class="detail">{{ errorMessage() }}</span></div>
            </div>
          }
        }
        @if (copyable()) {
          <div class="reply-actions">
            <button
              class="icon-button reply-copy"
              type="button"
              [attr.aria-label]="copied() ? 'Respuesta copiada' : 'Copiar respuesta'"
              [title]="copied() ? 'Copiada' : 'Copiar'"
              (click)="copy()"
            >
              <app-icon [name]="copied() ? 'check' : 'copy'" />
            </button>
          </div>
        }
      </div>
    </article>
  `,
})
export class TurnView {
  readonly turn = input.required<ConversationTurn>();
  /** Streamed text that has not been confirmed by a snapshot yet. An empty string hides revoked text. */
  readonly preview = input<string>();
  readonly copiedText = output<boolean>();

  protected readonly status = computed(() => this.turn().snapshot.status);
  protected readonly active = computed(() => this.status() === 'queued' || this.status() === 'running');
  protected readonly text = computed(() => this.preview() ?? this.turn().snapshot.result?.text ?? '');
  protected readonly errorMessage = computed(() => this.turn().snapshot.error?.message ?? '');
  protected readonly copyable = computed(() =>
    !this.active() && this.preview() === undefined && !!this.turn().snapshot.result?.text,
  );
  protected readonly copied = signal(false);
  private resetTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.resetTimer));
  }

  protected async copy(): Promise<void> {
    const text = this.turn().snapshot.result?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => this.copied.set(false), 2_000);
      this.copiedText.emit(true);
    } catch {
      this.copiedText.emit(false);
    }
  }
}
