import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS, type AppOptions } from '../../core/app-options';
import type { ConversationSummary } from '../../core/api/contract/openapi.generated';
import { AuthSession } from '../../core/auth/auth-session';
import { ChatStore } from './chat.store';

const scopeId = 'scope-personal';
const existing: ConversationSummary = {
  scopeId,
  conversationId: 'conversation-01',
  title: 'Historial personal',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const created: ConversationSummary = {
  scopeId,
  conversationId: 'created-01',
  createdAt: '2026-01-02T00:00:00.000Z',
};
const base = 'https://api.arturia.example/prod/v1/scopes/scope-personal';

function configureStore() {
  const options: AppOptions = {
    scopeIds: { personal: scopeId, work: 'scope-work' },
    apiBaseUrl: 'https://api.arturia.example/prod/',
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      ChatStore,
      { provide: APP_OPTIONS, useValue: options },
      { provide: AuthSession, useValue: { accessToken: signal('synthetic-access-token') } },
    ],
  });
  return TestBed.inject(ChatStore);
}

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly key: string | null;
  readonly body: unknown;
}

/** Fetch double: lists one conversation, creates `created` and answers turns with `acceptTurn`. */
function stubApi(acceptTurn: () => Response | Promise<Response>, createConversation = () => Response.json(created, { status: 201 })) {
  const requests: Recorded[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    request.signal?.throwIfAborted();
    const method = request.method ?? 'GET';
    requests.push({
      method,
      path: url.href,
      key: (request.headers as Headers).get('Idempotency-Key'),
      body: request.body ? JSON.parse(String(request.body)) : undefined,
    });
    if (url.href === `${base}/conversations` && method === 'GET') {
      return Response.json({ conversations: [existing] });
    }
    if (url.href === `${base}/conversations` && method === 'POST') return createConversation();
    if (url.href === `${base}/conversations/created-01/turns` && method === 'POST') return acceptTurn();
    if (url.href.startsWith(`${base}/turns/`)) {
      return Response.json({ ...created, turnId: 'turn-01', status: 'queued', lastSeq: 0 });
    }
    throw new Error(`Unexpected request ${method} ${url.href}`);
  }));
  return requests;
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

it('creates the conversation with the first message and sends the message to it', async () => {
  const store = configureStore();
  const requests = stubApi(() => Response.json({ turnId: 'turn-01', status: 'queued' }, { status: 202 }));

  store.open(scopeId, null);
  await vi.waitFor(() => expect(store.historyLoading()).toBe(false));
  store.draft.set('  Primer mensaje  ');

  await expect(store.send()).resolves.toBe('created-01');

  const writes = requests.filter(({ method }) => method === 'POST');
  expect(writes.map(({ path }) => path)).toEqual([
    `${base}/conversations`,
    `${base}/conversations/created-01/turns`,
  ]);
  expect(writes[1]!.body).toEqual({ text: 'Primer mensaje' });
  expect(writes[1]!.key).toMatch(/^[\w-]{36}$/);
  expect(store.conversation()?.conversationId).toBe('created-01');
  expect(store.conversation()?.turns.map(({ input, snapshot }) => [input.text, snapshot.status])).toEqual([
    ['Primer mensaje', 'queued'],
  ]);
  expect(store.conversations().map(({ conversationId }) => conversationId)).toEqual(['created-01', 'conversation-01']);
  expect(store.draft()).toBe('');
  expect(store.activeTurnId()).toBe('turn-01');
});

it('reports the created conversation as open so the route can catch up without reloading it', async () => {
  const store = configureStore();
  stubApi(() => Response.json({ turnId: 'turn-01', status: 'queued' }, { status: 202 }));
  store.open(scopeId, null);
  expect(store.isOpen(scopeId, null)).toBe(true);
  store.draft.set('Primer mensaje');
  await store.send();

  expect(store.isOpen(scopeId, 'created-01')).toBe(true);
  expect(store.isOpen(scopeId, null)).toBe(false);
  expect(store.isOpen('scope-work', 'created-01')).toBe(false);
});

it('keeps the history entry created before the history request finishes', async () => {
  const store = configureStore();
  let releaseHistory!: () => void;
  const historyReady = new Promise<void>((resolve) => { releaseHistory = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    if (request.method === 'POST' && url.pathname.endsWith('/conversations')) {
      return Response.json(created, { status: 201 });
    }
    if (request.method === 'POST') return Response.json({ turnId: 'turn-01', status: 'queued' }, { status: 202 });
    if (url.pathname.endsWith('/conversations')) {
      await historyReady;
      return Response.json({ conversations: [existing] });
    }
    return Response.json({ ...created, turnId: 'turn-01', status: 'queued', lastSeq: 0 });
  }));

  store.open(scopeId, null);
  store.draft.set('Mensaje');
  await store.send();
  releaseHistory();

  await vi.waitFor(() => expect(store.historyLoading()).toBe(false));
  expect(store.conversations().map(({ conversationId }) => conversationId)).toEqual(['created-01', 'conversation-01']);
});

it('retries a lost acknowledgement in the created conversation with the same key', async () => {
  const store = configureStore();
  let attempts = 0;
  const requests = stubApi(() => {
    if (++attempts === 1) throw new TypeError('Synthetic acknowledgement lost');
    return Response.json({ turnId: 'turn-01', status: 'queued' }, { status: 202 });
  });
  store.open(scopeId, null);
  store.draft.set('Mensaje sin acuse');

  await expect(store.send()).resolves.toBe('created-01');
  expect(store.error()).toBe('No se pudo confirmar el envío. Podés reintentar.');
  expect(store.pending()).toBe(true);
  expect(store.draft()).toBe('Mensaje sin acuse');

  await expect(store.send()).resolves.toBeUndefined();
  const turns = requests.filter(({ path, method }) => method === 'POST' && path.endsWith('/turns'));
  expect(turns).toHaveLength(2);
  expect(turns[1]!.key).toBe(turns[0]!.key);
  expect(requests.filter(({ path, method }) => method === 'POST' && path.endsWith('/conversations'))).toHaveLength(1);
  expect(store.pending()).toBe(false);
  expect(store.error()).toBeUndefined();
});

it('keeps the draft when the conversation cannot be created', async () => {
  const store = configureStore();
  stubApi(
    () => { throw new Error('Unexpected turn'); },
    () => new Response(null, { status: 503 }),
  );
  store.open(scopeId, null);
  store.draft.set('Mensaje');

  await expect(store.send()).resolves.toBeUndefined();

  expect(store.error()).toBe('No se pudo crear la conversación.');
  expect(store.draft()).toBe('Mensaje');
  expect(store.conversation()).toBeNull();
  expect(store.sending()).toBe(false);
});

it('does not send while a requested conversation is still loading or failed to load', async () => {
  const store = configureStore();
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    requests.push(`${request.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [] });
    return new Response(null, { status: 404 });
  }));

  store.open(scopeId, 'missing');
  store.draft.set('Mensaje');
  await expect(store.send()).resolves.toBeUndefined();
  await vi.waitFor(() => expect(store.conversationLoading()).toBe(false));
  await expect(store.send()).resolves.toBeUndefined();

  expect(requests.filter((entry) => entry.startsWith('POST'))).toEqual([]);
});
