import { afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, inject, output, viewChild } from '@angular/core';

import { Icon } from '../../shared/icon';
import { ChatStore } from './chat.store';

const coarsePointer = () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

/**
 * Auto-growing message field. One button keeps its position and focus while it switches between
 * sending and stopping the active reply. With a fine pointer, Enter sends and Shift+Enter adds a line.
 */
@Component({
  selector: 'app-composer',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="composer" (submit)="submit($event)">
      <label class="sr-only" for="composer-message">Mensaje</label>
      <textarea
        #field
        id="composer-message"
        rows="1"
        placeholder="Escribile a Arturia"
        aria-describedby="composer-hint"
        [value]="chat.draft()"
        [readOnly]="chat.pending()"
        (input)="update($event)"
        (keydown.enter)="enter($event)"
      ></textarea>
      <div class="composer-row">
        <span id="composer-hint" class="composer-hint">Shift + Enter agrega una línea</span>
        <button
          class="send"
          [type]="chat.hasActiveTurn() ? 'button' : 'submit'"
          [attr.aria-label]="chat.hasActiveTurn() ? 'Detener respuesta' : 'Enviar'"
          [title]="chat.hasActiveTurn() ? 'Detener respuesta' : 'Enviar'"
          [disabled]="chat.hasActiveTurn() ? chat.cancelling() !== null : !chat.canSend()"
          (click)="stop()"
        >
          @if (chat.hasActiveTurn()) {
            <span class="stop-glyph" aria-hidden="true"></span>
          } @else {
            <app-icon name="up" />
          }
        </button>
      </div>
    </form>
  `,
})
export class Composer {
  protected readonly chat = inject(ChatStore);
  /** Emits the conversation created by the first message of an empty scope. */
  readonly created = output<string>();
  private readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');

  constructor() {
    // Grows with the draft, also when it is cleared after sending or restored on a new conversation.
    afterRenderEffect(() => {
      this.chat.draft();
      const field = this.field().nativeElement;
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    });
  }

  focus(): void {
    this.field().nativeElement.focus();
  }

  protected update(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) this.chat.draft.set(event.target.value);
  }

  protected enter(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.shiftKey || event.isComposing || coarsePointer()) return;
    event.preventDefault();
    void this.send();
  }

  protected submit(event: SubmitEvent): void {
    event.preventDefault();
    void this.send();
  }

  protected stop(): void {
    const turnId = this.chat.activeTurnId();
    if (turnId) void this.chat.cancel(turnId);
  }

  private async send(): Promise<void> {
    const created = await this.chat.send();
    if (created) this.created.emit(created);
  }
}
