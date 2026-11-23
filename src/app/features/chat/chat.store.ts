import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

import { ChatApi, ChatApiError } from '../../core/api/chat-api';
import type {
  ConversationDetail,
  ConversationSummary,
  ConversationTurn,
  TurnSnapshot,
  TurnStatus,
} from '../../core/api/contract/openapi.generated';

interface ChatContext {
  readonly scopeId: string;
  readonly conversationId: string | null;
  readonly controller: AbortController;
}

type NoticeKind = 'history' | 'conversation' | 'create' | 'send' | 'poll' | 'cancel';

function active(status: TurnStatus): boolean {
  return status === 'queued' || status === 'running';
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, 750);
    signal.addEventListener('abort', done, { once: true });
  });
}

@Injectable()
export class ChatStore {
  private readonly api = inject(ChatApi);
  private context?: ChatContext;

  private readonly history = signal<ConversationSummary[]>([]);
  private readonly detail = signal<ConversationDetail | null>(null);
  private readonly intent = signal<{ text: string; key: string } | null>(null);
  private readonly notice = signal<{ kind: NoticeKind; text: string } | null>(null);
  private readonly loadingHistory = signal(false);
  private readonly loadingConversation = signal(false);
  private readonly creatingConversation = signal(false);
  private readonly sendingMessage = signal(false);
  private readonly cancellingTurn = signal<string | null>(null);

  readonly conversations = this.history.asReadonly();
  readonly conversation = this.detail.asReadonly();
  readonly pending = computed(() => this.intent() !== null);
  readonly error = computed(() => this.notice()?.text);
  readonly historyLoading = this.loadingHistory.asReadonly();
  readonly conversationLoading = this.loadingConversation.asReadonly();
  readonly creating = this.creatingConversation.asReadonly();
  readonly sending = this.sendingMessage.asReadonly();
  readonly cancelling = this.cancellingTurn.asReadonly();
  readonly hasActiveTurn = computed(() => this.detail()?.turns.some(({ snapshot }) =>
    active(snapshot.status),
  ) ?? false);
  readonly draft = signal('');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.context?.controller.abort());
  }

  open(scopeId: string, conversationId: string | null): void {
    this.context?.controller.abort();

    const context = { scopeId, conversationId, controller: new AbortController() };
    this.context = context;
    this.history.set([]);
    this.detail.set(null);
    this.draft.set('');
    this.intent.set(null);
    this.notice.set(null);
    this.loadingHistory.set(true);
    this.loadingConversation.set(conversationId !== null);
    this.creatingConversation.set(false);
    this.sendingMessage.set(false);
    this.cancellingTurn.set(null);

    void this.loadHistory(context);
    if (conversationId !== null) void this.loadConversation(context, conversationId);
  }

  async createConversation(): Promise<ConversationSummary | undefined> {
    const context = this.context;
    if (!context || this.creating()) return undefined;

    this.creatingConversation.set(true);
    this.clearNotice('create');
    try {
      const created = await this.api.createConversation(
        context.scopeId,
        {},
        context.controller.signal,
      );
      if (this.isCurrent(context) && created.scopeId === context.scopeId) return created;
    } catch {
      if (this.isCurrent(context)) this.showNotice('create', 'No se pudo crear la conversación.');
    } finally {
      if (this.isCurrent(context)) this.creatingConversation.set(false);
    }
    return undefined;
  }

  async send(): Promise<void> {
    const context = this.context;
    const conversationId = this.detail()?.conversationId;
    const text = this.draft().trim();
    if (!context || !conversationId || !text || this.sending() || this.hasActiveTurn()) return;

    const intent = this.intent() ?? { text, key: crypto.randomUUID() };
    this.intent.set(intent);
    this.sendingMessage.set(true);
    this.clearNotice('send');

    try {
      const { turnId, status } = await this.api.acceptTurn(
        { scopeId: context.scopeId, conversationId },
        { text: intent.text },
        intent.key,
        context.controller.signal,
      );
      if (!this.isCurrent(context)) return;

      const existing = this.detail()?.turns.some(({ snapshot }) => snapshot.turnId === turnId);
      const turn: ConversationTurn = {
        input: { text: intent.text },
        snapshot: { scopeId: context.scopeId, conversationId, turnId, status, lastSeq: 0 },
      };
      if (!existing) {
        this.detail.update((value) => value && { ...value, turns: [...value.turns, turn] });
        void this.pollTurn(context, turnId, !active(status));
      }
      this.draft.set('');
      this.intent.set(null);
    } catch (error) {
      if (!this.isCurrent(context)) return;

      if (error instanceof ChatApiError && [400, 401, 403, 404, 409].includes(error.status)) {
        this.intent.set(null);
        this.showNotice('send', 'No se pudo enviar el mensaje.');
      } else {
        this.showNotice('send', 'No se pudo confirmar el envío. Podés reintentar.');
      }
    } finally {
      if (this.isCurrent(context)) this.sendingMessage.set(false);
    }
  }

  async cancel(turnId: string): Promise<void> {
    const context = this.context;
    if (!context || this.cancelling() || !this.turnIsActive(turnId)) return;

    this.cancellingTurn.set(turnId);
    this.clearNotice('cancel');
    try {
      const result = await this.api.cancelTurn(
        { scopeId: context.scopeId, turnId },
        context.controller.signal,
      );
      if (this.isCurrent(context)) this.applySnapshot(context, turnId, result);
    } catch {
      if (this.isCurrent(context)) this.showNotice('cancel', 'No se pudo cancelar la respuesta.');
    } finally {
      if (this.isCurrent(context)) this.cancellingTurn.set(null);
    }
  }

  private async loadHistory(context: ChatContext): Promise<void> {
    try {
      const history = await this.api.listConversations(context.scopeId, context.controller.signal);
      if (!this.isCurrent(context)) return;
      this.history.set(history.conversations.filter(({ scopeId }) => scopeId === context.scopeId));
    } catch {
      if (this.isCurrent(context)) this.showNotice('history', 'No se pudo consultar el historial.');
    } finally {
      if (this.isCurrent(context)) this.loadingHistory.set(false);
    }
  }

  private async loadConversation(context: ChatContext, conversationId: string): Promise<void> {
    try {
      const detail = await this.api.getConversation(
        { scopeId: context.scopeId, conversationId },
        context.controller.signal,
      );
      if (!this.isCurrent(context)) return;
      if (detail.scopeId !== context.scopeId || detail.conversationId !== conversationId) {
        throw new Error('Conversation does not match its scope');
      }

      const turns = detail.turns.filter(({ snapshot }) =>
        snapshot.scopeId === context.scopeId && snapshot.conversationId === conversationId,
      );
      this.detail.set({ ...detail, turns });
      for (const { snapshot } of turns) {
        if (active(snapshot.status)) void this.pollTurn(context, snapshot.turnId);
      }
    } catch {
      if (this.isCurrent(context)) {
        this.showNotice('conversation', 'No se pudo abrir la conversación en este ámbito.');
      }
    } finally {
      if (this.isCurrent(context)) this.loadingConversation.set(false);
    }
  }

  private async pollTurn(
    context: ChatContext,
    turnId: string,
    awaitingSnapshot = false,
  ): Promise<void> {
    const signal = context.controller.signal;
    do {
      try {
        const snapshot = await this.api.getTurn({ scopeId: context.scopeId, turnId }, signal);
        if (!this.isCurrent(context)) return;
        const applied = this.applySnapshot(context, turnId, snapshot);
        if (awaitingSnapshot && !applied) throw new Error('Snapshot predates the acknowledgement');
        awaitingSnapshot = false;
        this.clearNotice('poll');
      } catch (error) {
        if (!this.isCurrent(context)) return;
        if (error instanceof ChatApiError && [401, 403, 404].includes(error.status)) {
          this.open(context.scopeId, null);
          this.showNotice('poll', 'La conversación ya no está disponible en este ámbito.');
          return;
        }
        this.showNotice('poll', 'Se interrumpió la consulta de estado. Volveremos a intentar.');
      }
      if (!awaitingSnapshot && !this.turnIsActive(turnId)) return;
      await waitForPoll(signal);
    } while (this.isCurrent(context) && (awaitingSnapshot || this.turnIsActive(turnId)));
  }

  private applySnapshot(context: ChatContext, turnId: string, next: TurnSnapshot): boolean {
    if (
      next.turnId !== turnId ||
      next.scopeId !== context.scopeId ||
      next.conversationId !== context.conversationId ||
      !Number.isSafeInteger(next.lastSeq)
    ) {
      throw new Error('Snapshot does not match its conversation');
    }
    const detail = this.detail();
    if (!detail) return false;

    const index = detail.turns.findIndex(({ snapshot }) => snapshot.turnId === turnId);
    const current = detail.turns[index];
    if (!current) return false;

    const previous = current.snapshot;
    if (
      next.lastSeq < previous.lastSeq ||
      (previous.status === 'running' && next.status === 'queued') ||
      (!active(previous.status) && previous.status !== next.status)
    ) {
      return false;
    }

    const turns = detail.turns.slice();
    turns[index] = { ...current, snapshot: next };
    this.detail.set({ ...detail, turns });
    return true;
  }

  private turnIsActive(turnId: string): boolean {
    return this.detail()?.turns.some(({ snapshot }) =>
      snapshot.turnId === turnId && active(snapshot.status),
    ) ?? false;
  }

  private isCurrent(context: ChatContext): boolean {
    return this.context === context && !context.controller.signal.aborted;
  }

  private showNotice(kind: NoticeKind, text: string): void {
    this.notice.set({ kind, text });
  }

  private clearNotice(kind: NoticeKind): void {
    if (this.notice()?.kind === kind) this.notice.set(null);
  }
}
