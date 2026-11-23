import { inject, Injectable, InjectionToken } from '@angular/core';

import { APP_OPTIONS, httpsUrl } from '../app-options';
import { AuthSession } from '../auth/auth-session';
import type {
  ConversationDetail,
  ConversationInput,
  ConversationList,
  ConversationSummary,
  TurnAccepted,
  TurnInput,
  TurnSnapshot,
} from './contract/openapi.generated';

export interface ConversationRef {
  readonly scopeId: string;
  readonly conversationId: string;
}

export interface TurnRef {
  readonly scopeId: string;
  readonly turnId: string;
}

@Injectable({ providedIn: 'root', useFactory: () => inject(HttpChatApi) })
export abstract class ChatApi {
  abstract listConversations(scopeId: string, signal: AbortSignal): Promise<ConversationList>;
  abstract createConversation(
    scopeId: string,
    input: ConversationInput,
    signal: AbortSignal,
  ): Promise<ConversationSummary>;
  abstract getConversation(
    ref: ConversationRef,
    signal: AbortSignal,
  ): Promise<ConversationDetail>;
  abstract acceptTurn(
    ref: ConversationRef,
    input: TurnInput,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<TurnAccepted>;
  abstract getTurn(ref: TurnRef, signal: AbortSignal): Promise<TurnSnapshot>;
  abstract cancelTurn(ref: TurnRef, signal: AbortSignal): Promise<TurnSnapshot>;
}

export class ChatApiError extends Error {
  constructor(readonly status: number) {
    super(`Chat request failed (${status})`);
  }
}

export const CHAT_API_ORIGIN = new InjectionToken<string | undefined>('Chat API origin', {
  providedIn: 'root',
  factory: () => {
    const url = httpsUrl(inject(APP_OPTIONS).apiOrigin);
    return url?.pathname === '/' && !url.search ? url.origin : undefined;
  },
});

function segment(id: string): string {
  if (!id || id === '.' || id === '..') throw new Error('Invalid resource identifier');
  return encodeURIComponent(id);
}

function conversations(scopeId: string): string {
  return `/v1/scopes/${segment(scopeId)}/conversations`;
}

function conversation(ref: ConversationRef): string {
  return `${conversations(ref.scopeId)}/${segment(ref.conversationId)}`;
}

function turn(ref: TurnRef): string {
  return `/v1/scopes/${segment(ref.scopeId)}/turns/${segment(ref.turnId)}`;
}

@Injectable({ providedIn: 'root' })
export class HttpChatApi implements ChatApi {
  private readonly origin = inject(CHAT_API_ORIGIN);
  private readonly auth = inject(AuthSession);

  listConversations(scopeId: string, signal: AbortSignal): Promise<ConversationList> {
    return this.request(conversations(scopeId), signal);
  }

  createConversation(
    scopeId: string,
    input: ConversationInput,
    signal: AbortSignal,
  ): Promise<ConversationSummary> {
    return this.request(conversations(scopeId), signal, input);
  }

  getConversation(ref: ConversationRef, signal: AbortSignal): Promise<ConversationDetail> {
    return this.request(conversation(ref), signal);
  }

  acceptTurn(
    ref: ConversationRef,
    input: TurnInput,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<TurnAccepted> {
    return this.request(`${conversation(ref)}/turns`, signal, input, idempotencyKey);
  }

  getTurn(ref: TurnRef, signal: AbortSignal): Promise<TurnSnapshot> {
    return this.request(turn(ref), signal);
  }

  cancelTurn(ref: TurnRef, signal: AbortSignal): Promise<TurnSnapshot> {
    // Task 06 adds this route to the versioned API contract.
    return this.request(`${turn(ref)}/cancel`, signal, null);
  }

  private async request<T>(
    path: string,
    signal: AbortSignal,
    body?: object | null,
    idempotencyKey?: string,
  ): Promise<T> {
    const token = this.auth.accessToken();
    if (!token || !this.origin) throw new Error('Chat API is unavailable');

    const headers = new Headers({ Authorization: `Bearer ${token}` });
    if (body) headers.set('Content-Type', 'application/json');
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    const response = await fetch(new URL(path, this.origin), {
      method: body === undefined ? 'GET' : 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers,
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (response.status === 401 && this.auth.accessToken() === token) this.auth.clear();
    if (!response.ok) throw new ChatApiError(response.status);
    return await response.json() as T;
  }
}
