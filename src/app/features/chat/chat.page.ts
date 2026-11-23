import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { APP_OPTIONS } from '../../core/app-options';
import type { TurnStatus } from '../../core/api/contract/openapi.generated';
import { AuthSession } from '../../core/auth/auth-session';
import { findScope, ScopeSwitcher } from '../scopes/scope-switcher';
import { ChatStore } from './chat.store';

const historyDate = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'medium' });

const statusLabels: Record<TurnStatus, string> = {
  queued: 'En espera',
  running: 'Generando respuesta…',
  completed: 'Respuesta completa',
  incomplete: 'Respuesta incompleta',
  failed: 'No se generó una respuesta',
  cancelled: 'Respuesta cancelada',
  blocked: 'Respuesta bloqueada',
};

@Component({
  selector: 'app-chat',
  imports: [RouterLink, ScopeSwitcher],
  providers: [ChatStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat.page.html',
  styleUrl: './chat.page.css',
})
export class ChatPage {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthSession);
  private readonly options = inject(APP_OPTIONS);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly chat = inject(ChatStore);
  protected readonly statusLabels = statusLabels;
  protected readonly scope = computed(() => findScope(this.params().get('scope')));
  protected readonly conversationId = computed(() => this.params().get('conversation') || null);

  constructor() {
    effect(() => {
      const scope = this.scope();
      const conversationId = this.conversationId();
      if (!this.auth.accessToken() || !scope) {
        void this.router.navigate(['/'], { replaceUrl: true });
        return;
      }
      untracked(() => this.chat.open(this.options.scopeIds[scope.key], conversationId));
    });
  }

  protected async createConversation(): Promise<void> {
    const scope = this.scope();
    const created = await this.chat.createConversation();
    if (scope && created && this.scope() === scope) {
      await this.router.navigate(['/chat'], {
        queryParams: { scope: scope.key, conversation: created.conversationId },
      });
    }
  }

  protected createdAtLabel(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : historyDate.format(date);
  }

  protected updateDraft(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) this.chat.draft.set(event.target.value);
  }

  protected submit(event: SubmitEvent): void {
    event.preventDefault();
    void this.chat.send();
  }

  protected canCancel(status: TurnStatus): boolean {
    return status === 'queued' || status === 'running';
  }
}
