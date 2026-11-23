import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS, type AppOptions } from '../../core/app-options';
import type { ConversationDetail, TurnSnapshot } from '../../core/api/contract/openapi.generated';
import { AuthSession } from '../../core/auth/auth-session';
import { ChatStore } from './chat.store';

const personal = {
  scopeId: 'scope-personal',
  conversationId: 'conversation-01',
  title: 'Historial personal',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const work = {
  scopeId: 'scope-work',
  conversationId: 'conversation-02',
  title: 'Historial laboral',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function configureStore(apiOrigin = 'https://api.arturia.example') {
  const options: AppOptions = {
    scopeIds: { personal: personal.scopeId, work: work.scopeId },
    apiOrigin,
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

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

it('queries a recovered active turn by ID and uses its authoritative snapshot', async () => {
  const store = configureStore();
  const pending: TurnSnapshot = { ...personal, turnId: 'persisted-turn', status: 'queued', lastSeq: 0 };
  const result: TurnSnapshot = {
    ...pending,
    status: 'completed',
    lastSeq: 1,
    result: { text: 'Snapshot persistido' },
  };
  const detail: ConversationDetail = {
    ...personal,
    turns: [{ input: { text: 'Mensaje previo' }, snapshot: pending }],
  };
  const requests: string[] = [];
  const fetchChat = vi.fn(async (url: URL, request: RequestInit) => {
    requests.push(url.pathname);
    expect(url.origin).toBe('https://api.arturia.example');
    expect((request.headers as Headers).get('Authorization')).toBe('Bearer synthetic-access-token');
    expect(request.method).toBe('GET');
    switch (url.pathname) {
      case '/v1/scopes/scope-personal/conversations':
        return Response.json({ conversations: [personal] });
      case '/v1/scopes/scope-personal/conversations/conversation-01':
        return Response.json(detail);
      case '/v1/scopes/scope-personal/turns/persisted-turn':
        return Response.json(result);
      default:
        throw new Error('Unexpected request');
    }
  });
  vi.stubGlobal('fetch', fetchChat);

  store.open(personal.scopeId, personal.conversationId);

  await vi.waitFor(() => {
    expect(store.conversation()?.turns).toEqual([
      { input: { text: 'Mensaje previo' }, snapshot: result },
    ]);
  });
  expect(requests).toEqual([
    '/v1/scopes/scope-personal/conversations',
    '/v1/scopes/scope-personal/conversations/conversation-01',
    '/v1/scopes/scope-personal/turns/persisted-turn',
  ]);
});

it('discards a late personal conversation after switching to work', async () => {
  const store = configureStore();
  let oldSignal: AbortSignal | null | undefined;
  let resolvePersonal!: (response: Response) => void;
  const pendingPersonal = new Promise<Response>((resolve) => { resolvePersonal = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    if (url.pathname.endsWith('/conversation-01')) {
      oldSignal = request.signal;
      return pendingPersonal;
    }
    if (url.pathname.endsWith('/conversation-02')) return Response.json({ ...work, turns: [] });
    const item = url.pathname.includes('/scope-personal/') ? personal : work;
    return Response.json({ conversations: [item] });
  }));

  store.open(personal.scopeId, personal.conversationId);
  store.open(work.scopeId, work.conversationId);
  expect(oldSignal?.aborted).toBe(true);
  expect(store.conversation()).toBeNull();
  await vi.waitFor(() => expect(store.conversation()?.scopeId).toBe(work.scopeId));

  resolvePersonal(Response.json({ ...personal, turns: [] }));
  // The fetch double may finish even after abort, like an already buffered response.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.conversation()?.scopeId).toBe(work.scopeId);
  expect(store.conversations()).toEqual([work]);
});

it('keeps an HTTP origin disabled in the normal build', async () => {
  const store = configureStore('http://127.0.0.1:5000');
  const fetchChat = vi.fn();
  vi.stubGlobal('fetch', fetchChat);

  store.open(personal.scopeId, personal.conversationId);

  await vi.waitFor(() => expect(store.conversationLoading()).toBe(false));
  expect(store.conversation()).toBeNull();
  expect(fetchChat).not.toHaveBeenCalled();
});

it('retires the inaccessible conversation while leaving its scope available', async () => {
  const store = configureStore();
  const created = { ...personal, conversationId: 'new-conversation' };
  const pending: TurnSnapshot = { ...personal, turnId: 'vanished', status: 'queued', lastSeq: 0 };
  let revoked = false;
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    request.signal?.throwIfAborted();
    if (request.method === 'POST') return Response.json(created, { status: 201 });
    if (url.pathname.endsWith('/turns/vanished')) {
      revoked = true;
      return new Response(null, { status: 404 });
    }
    if (url.pathname.endsWith('/conversations')) {
      return Response.json({ conversations: revoked ? [] : [personal] });
    }
    return Response.json({ ...personal, turns: [{ input: { text: 'Mensaje anterior' }, snapshot: pending }] });
  }));

  store.open(personal.scopeId, personal.conversationId);
  await vi.waitFor(() => expect(store.error()).toContain('ya no está disponible'));
  expect(store.conversation()).toBeNull();
  await expect(store.createConversation()).resolves.toEqual(created);
  expect(store.creating()).toBe(false);
  expect(store.sending()).toBe(false);
  expect(store.cancelling()).toBeNull();
  expect(store.conversations()).toEqual([]);
});

it('retries snapshot hydration after a terminal acknowledgement and a transient GET failure', async () => {
  const store = configureStore();
  let snapshots = 0;
  let submissions = 0;
  const result: TurnSnapshot = {
    ...personal,
    turnId: 'terminal',
    status: 'completed',
    lastSeq: 1,
    result: { text: 'Recuperado' },
  };
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    if (request.method === 'POST') {
      submissions++;
      return Response.json({ turnId: 'terminal', status: 'completed' }, { status: 202 });
    }
    if (url.pathname.endsWith('/turns/terminal')) {
      snapshots++;
      if (snapshots === 1) return new Response(null, { status: 503 });
      return Response.json(result);
    }
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [personal] });
    return Response.json({ ...personal, turns: [] });
  }));

  store.open(personal.scopeId, personal.conversationId);
  await vi.waitFor(() => expect(store.conversation()).not.toBeNull());
  store.draft.set('Mensaje');
  await store.send();

  await vi.waitFor(() => expect(store.conversation()?.turns[0]?.snapshot).toEqual(result), {
    timeout: 1900,
  });
  expect(store.error()).toBeUndefined();
  expect(submissions).toBe(1);
  expect(snapshots).toBe(2);
});
