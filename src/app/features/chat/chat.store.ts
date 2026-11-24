import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';

import { ChatApi, ChatApiError } from '../../core/api/chat-api';
import type {
  ConversationDetail,
  ConversationSummary,
  ConversationTurn,
  TurnSnapshot,
  TurnStatus,
} from '../../core/api/contract/openapi.generated';
import { ChatStream } from '../../core/api/sse-client';
import { AuthSession } from '../../core/auth/auth-session';
import {
  POLL_THROTTLE_BACKOFF,
  SSE_RECOVERY_BUDGET_MS,
  SSE_THROTTLE_BACKOFF,
  throttleDelay,
} from './throttle-backoff';

interface ChatContext {
  readonly scopeId: string;
  readonly conversationId: string | null;
  readonly controller: AbortController;
  readonly followers: Map<string, AbortController>;
}

type StreamOutcome = 'poll' | 'wait' | 'terminal';

/** Consecutive throttled snapshot reads and the latest Retry-After of a follower in polling. */
interface PollThrottle {
  count: number;
  retryAfterMs?: number;
}

const POLL_INTERVAL_MS = 750;

type NoticeKind = 'history' | 'conversation' | 'create' | 'send' | 'poll' | 'cancel';

function active(status: TurnStatus): boolean {
  return status === 'queued' || status === 'running';
}

function wait(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, delay);
    signal.addEventListener('abort', done, { once: true });
  });
}

@Injectable()
export class ChatStore {
  private readonly api = inject(ChatApi);
  private readonly stream = inject(ChatStream);
  private readonly auth = inject(AuthSession);
  private context?: ChatContext;

  private readonly history = signal<ConversationSummary[]>([]);
  private readonly detail = signal<ConversationDetail | null>(null);
  private readonly previews = signal<ReadonlyMap<string, string>>(new Map());
  private readonly intent = signal<{ text: string; key: string } | null>(null);
  private readonly notice = signal<{ kind: NoticeKind; text: string } | null>(null);
  private readonly loadingHistory = signal(false);
  private readonly loadingConversation = signal(false);
  private readonly creatingConversation = signal(false);
  private readonly sendingMessage = signal(false);
  private readonly cancellingTurn = signal<string | null>(null);

  readonly streamText = this.previews.asReadonly();
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
    // Signing out cancels every pending retry and stream at once.
    effect(() => {
      if (!this.auth.accessToken()) this.context?.controller.abort();
    });
  }

  open(scopeId: string, conversationId: string | null): void {
    this.context?.controller.abort();

    const context: ChatContext = {
      scopeId,
      conversationId,
      controller: new AbortController(),
      followers: new Map(),
    };
    this.context = context;
    this.history.set([]);
    this.detail.set(null);
    this.previews.set(new Map());
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
        void this.followTurn(context, turnId, !active(status));
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
      if (this.isCurrent(context) && this.applySnapshot(context, turnId, result) && !active(result.status)) {
        context.followers.get(turnId)?.abort();
      }
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
        if (active(snapshot.status)) void this.followTurn(context, snapshot.turnId);
      }
    } catch {
      if (this.isCurrent(context)) {
        this.showNotice('conversation', 'No se pudo abrir la conversación en este ámbito.');
      }
    } finally {
      if (this.isCurrent(context)) this.loadingConversation.set(false);
    }
  }

  private async followTurn(
    context: ChatContext,
    turnId: string,
    awaitingTerminal = false,
  ): Promise<void> {
    if (context.followers.has(turnId)) return;
    const controller = new AbortController();
    context.followers.set(turnId, controller);
    const signal = AbortSignal.any([context.controller.signal, controller.signal]);
    const throttle: PollThrottle = { count: 0 };

    try {
      if (!awaitingTerminal) {
        await this.refreshTurn(context, turnId, signal, false, throttle);
        const snapshot = this.turnSnapshot(turnId);
        if (signal.aborted || !snapshot || !active(snapshot.status)) return;

        const outcome = await this.streamTurn(context, snapshot, signal);
        awaitingTerminal = outcome === 'terminal';
        if (outcome === 'wait') await wait(POLL_INTERVAL_MS, signal);
      }

      while (!signal.aborted && (awaitingTerminal || this.turnIsActive(turnId))) {
        if (await this.refreshTurn(context, turnId, signal, awaitingTerminal, throttle)) {
          awaitingTerminal = false;
        }
        if (awaitingTerminal || this.turnIsActive(turnId)) await wait(pollDelay(throttle), signal);
      }
    } finally {
      context.followers.delete(turnId);
    }
  }

  private async streamTurn(
    context: ChatContext,
    snapshot: TurnSnapshot,
    signal: AbortSignal,
  ): Promise<StreamOutcome> {
    const { turnId } = snapshot;
    let text = snapshot.result?.text ?? '';
    let after = text ? snapshot.lastSeq : 0;

    let consecutiveStalls = 0;
    // Throttling episode: from its first 429 until a connection brings a new block. Other errors and
    // admitted connections without progress do not restart it; they spend the stall budget instead.
    let throttledSince: number | undefined;
    let throttledAttempts = 0;
    while (!signal.aborted) {
      const connectionStart = after;
      try {
        for await (const event of this.stream.connect(context.scopeId, turnId, after, signal)) {
          if (signal.aborted || !this.isCurrent(context) || !this.turnIsActive(turnId)) return 'poll';

          if (event.type === 'text') {
            if (event.seq <= after) continue;
            if (event.seq !== after + 1) break;
            after = event.seq;
            text += event.text;
            this.markRunning(context, turnId);
            this.setPreview(turnId, text);
          } else if ('lastSeq' in event) {
            if (event.lastSeq > after) break;
            if (event.lastSeq < after || event.status === 'blocked' || event.status === 'failed') {
              this.setPreview(turnId, '');
            }
            return 'terminal';
          } else if (event.status === 'running') {
            this.markRunning(context, turnId);
          }
        }
      } catch (error) {
        if (signal.aborted) break;
        if (error instanceof ChatApiError) {
          if (error.status === 401) {
            this.retireConversation(context);
            return 'poll';
          }
          if (error.status === 403 || error.status === 404) {
            // Streaming and snapshot reads have separate permissions and routes.
            this.setPreview(turnId, '');
            return 'poll';
          }
          if (error.status === 429) {
            throttledSince ??= performance.now();
            const delay = Math.max(
              error.retryAfterMs ?? 0,
              throttleDelay(++throttledAttempts, SSE_THROTTLE_BACKOFF),
            );
            // A retry that cannot start within the budget leaves recovery to the snapshot.
            if (performance.now() - throttledSince + delay > SSE_RECOVERY_BUDGET_MS) return 'poll';
            await wait(delay, signal);
            continue;
          }
          if (error.status === 501 || error.status < 500) return 'wait';
        }
      }
      if (after === connectionStart) {
        consecutiveStalls++;
      } else {
        consecutiveStalls = 0;
        throttledSince = undefined;
        throttledAttempts = 0;
      }
      if (consecutiveStalls >= 3) break;
      await wait(consecutiveStalls === 2 ? 500 : 250, signal);
    }
    return 'poll';
  }

  private async refreshTurn(
    context: ChatContext,
    turnId: string,
    signal: AbortSignal,
    awaitingTerminal: boolean,
    throttle: PollThrottle,
  ): Promise<boolean> {
    try {
      const snapshot = await this.api.getTurn({ scopeId: context.scopeId, turnId }, signal);
      if (signal.aborted || !this.isCurrent(context)) return false;
      if (awaitingTerminal && active(snapshot.status)) {
        throw new Error('Snapshot predates the terminal status');
      }
      if (!this.applySnapshot(context, turnId, snapshot) && awaitingTerminal) {
        throw new Error('Snapshot predates the terminal status');
      }
      throttle.count = 0;
      this.clearNotice('poll');
      return true;
    } catch (error) {
      if (signal.aborted || !this.isCurrent(context)) return false;
      if (error instanceof ChatApiError && error.status === 429) {
        throttle.count++;
        throttle.retryAfterMs = error.retryAfterMs;
      } else {
        throttle.count = 0;
      }
      if (error instanceof ChatApiError && [401, 403, 404].includes(error.status)) {
        this.retireConversation(context);
      } else {
        this.showNotice('poll', 'Se interrumpió la consulta de estado. Volveremos a intentar.');
      }
      return false;
    }
  }

  private markRunning(context: ChatContext, turnId: string): void {
    const snapshot = this.turnSnapshot(turnId);
    if (snapshot?.status === 'queued') {
      this.applySnapshot(context, turnId, { ...snapshot, status: 'running' });
    }
  }

  private setPreview(turnId: string, text?: string): void {
    this.previews.update((value) => {
      if (text === undefined && !value.has(turnId)) return value;
      const previews = new Map(value);
      if (text === undefined) previews.delete(turnId);
      else previews.set(turnId, text);
      return previews;
    });
  }

  private retireConversation(context: ChatContext): void {
    this.open(context.scopeId, null);
    this.showNotice('poll', 'La conversación ya no está disponible en este ámbito.');
  }

  private applySnapshot(context: ChatContext, turnId: string, next: TurnSnapshot): boolean {
    if (
      next.turnId !== turnId ||
      next.scopeId !== context.scopeId ||
      next.conversationId !== context.conversationId ||
      !Number.isSafeInteger(next.lastSeq) || next.lastSeq < 0
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
      (next.lastSeq < previous.lastSeq && (active(next.status) || !active(previous.status))) ||
      (previous.status === 'running' && next.status === 'queued') ||
      (!active(previous.status) && previous.status !== next.status)
    ) {
      return false;
    }

    const turns = detail.turns.slice();
    turns[index] = { ...current, snapshot: next };
    this.detail.set({ ...detail, turns });
    this.setPreview(turnId);
    return true;
  }

  private turnSnapshot(turnId: string): TurnSnapshot | undefined {
    return this.detail()?.turns.find(({ snapshot }) => snapshot.turnId === turnId)?.snapshot;
  }

  private turnIsActive(turnId: string): boolean {
    const snapshot = this.turnSnapshot(turnId);
    return !!snapshot && active(snapshot.status);
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

function pollDelay(throttle: PollThrottle): number {
  if (!throttle.count) return POLL_INTERVAL_MS;
  // No single wait exceeds one SSE window, whatever Retry-After asks for.
  const retryAfter = Math.min(throttle.retryAfterMs ?? 0, SSE_RECOVERY_BUDGET_MS);
  return Math.max(retryAfter, throttleDelay(throttle.count, POLL_THROTTLE_BACKOFF));
}
