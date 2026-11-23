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

function sseResponse(...frames: string[]): Response {
  return new Response(frames.join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}

function textEvent(turnId: string, seq: number, text: string): string {
  return 'event: text\ndata: ' + JSON.stringify({ type: 'text', turnId, seq, text }) + '\n\n';
}

it('reconnect_deduplicates_and_recovers_gap', async () => {
  const store = configureStore();
  const turnId = 'streamed-turn';
  const pending: TurnSnapshot = { ...personal, turnId, status: 'queued', lastSeq: 0 };
  const cursors: string[] = [];
  let releaseTerminal!: () => void;
  const terminalReady = new Promise<void>((resolve) => { releaseTerminal = resolve; });
  let snapshotReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [personal] });
    if (url.pathname.endsWith('/conversation-01')) {
      return Response.json({ ...personal, turns: [{ input: { text: 'Hola' }, snapshot: pending }] });
    }
    if (url.pathname.endsWith('/events')) {
      cursors.push(url.searchParams.get('after')!);
      if (cursors.length === 1) return sseResponse(textEvent(turnId, 1, 'Una '));
      if (cursors.length === 2) {
        return sseResponse(textEvent(turnId, 1, 'Una '), textEvent(turnId, 3, 'FUERA DE ORDEN'));
      }
      return sseResponse(
        textEvent(turnId, 1, 'Una '),
        textEvent(turnId, 2, 'sola respuesta'),
        'event: status\ndata: ' +
          JSON.stringify({ type: 'status', turnId, status: 'completed', lastSeq: 2 }) + '\n\n',
      );
    }
    if (url.pathname.endsWith('/turns/' + turnId)) {
      if (++snapshotReads === 1) return Response.json(pending);
      await terminalReady;
      return Response.json({
        ...pending,
        status: 'completed',
        lastSeq: 2,
        result: { text: 'Respuesta confirmada' },
      });
    }
    throw new Error('Unexpected request');
  }));

  store.open(personal.scopeId, personal.conversationId);
  await vi.waitFor(() => expect(store.streamText().get(turnId)).toBe('Una '));
  await vi.waitFor(() => expect(store.streamText().get(turnId)).toBe('Una sola respuesta'), {
    timeout: 2_000,
  });
  expect(cursors).toEqual(['0', '1', '1']);
  expect(store.hasActiveTurn()).toBe(true);
  releaseTerminal();
  await vi.waitFor(() => {
    expect(store.conversation()?.turns[0]?.snapshot.result?.text).toBe('Respuesta confirmada');
    expect(store.streamText().has(turnId)).toBe(false);
  });
  expect(snapshotReads).toBe(2);
});

it('stale_scope_event_ignored', async () => {
  const store = configureStore();
  const turnId = 'shared-turn-id';
  let personalSignal: AbortSignal | null | undefined;
  let resolveEvents!: (response: Response) => void;
  const personalEvents = new Promise<Response>((resolve) => { resolveEvents = resolve; });

  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    const isPersonal = url.pathname.includes('/scope-personal/');
    const summary = isPersonal ? personal : work;
    const snapshot = {
      ...summary, turnId, status: isPersonal ? 'queued' : 'completed',
      lastSeq: isPersonal ? 0 : 1,
      ...(isPersonal ? {} : { result: { text: 'Respuesta laboral' } }),
    };
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [summary] });
    if (url.pathname.endsWith('/' + summary.conversationId)) {
      return Response.json({ ...summary, turns: [{ input: { text: 'Hola' }, snapshot }] });
    }
    if (url.pathname.endsWith('/events')) {
      personalSignal = request.signal;
      return personalEvents;
    }
    return Response.json(snapshot);
  }));

  store.open(personal.scopeId, personal.conversationId);
  await vi.waitFor(() => expect(personalSignal).toBeDefined());
  store.open(work.scopeId, work.conversationId);
  expect(personalSignal?.aborted).toBe(true);
  resolveEvents(sseResponse(textEvent(turnId, 1, 'Texto del ámbito anterior')));
  await vi.waitFor(() => expect(store.conversation()?.scopeId).toBe(work.scopeId));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.streamText().has(turnId)).toBe(false);
  expect(store.conversation()?.turns[0]?.snapshot.result?.text).toBe('Respuesta laboral');
});

it('keeps revoked text hidden while revalidating a terminal event', async () => {
  const store = configureStore();
  const turnId = 'blocked-turn';
  const running: TurnSnapshot = {
    ...personal, turnId, status: 'running', lastSeq: 2, result: { text: 'Texto antes del bloqueo' },
  };
  const blocked: TurnSnapshot = {
    ...personal, turnId, status: 'blocked', lastSeq: 0,
    error: { code: 'PERMISSION_REVOKED', message: 'Permiso revocado', requestId: 'fixture-revoked' },
  };
  let snapshotReads = 0;
  const cursors: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [personal] });
    if (url.pathname.endsWith('/conversation-01')) {
      return Response.json({ ...personal, turns: [{ input: { text: 'Hola' }, snapshot: running }] });
    }
    if (url.pathname.endsWith('/events')) {
      cursors.push(url.searchParams.get('after')!);
      return sseResponse('event: status\ndata: ' +
        JSON.stringify({ type: 'status', turnId, status: 'blocked', lastSeq: 0 }) + '\n\n');
    }
    return Response.json(++snapshotReads < 3 ? running : blocked);
  }));

  store.open(personal.scopeId, personal.conversationId);
  await vi.waitFor(() => expect(snapshotReads).toBe(2));
  expect(cursors).toEqual(['2']);
  expect(store.streamText().get(turnId)).toBe('');
  await vi.waitFor(() => {
    expect(store.conversation()?.turns[0]?.snapshot).toEqual(blocked);
    expect(store.streamText().has(turnId)).toBe(false);
  }, { timeout: 2_000 });
});

it.each([403, 404])('recovers via polling when only the events route returns %i', async (status) => {
  const store = configureStore();
  const turnId = 'snapshot-only';
  const pending: TurnSnapshot = { ...personal, turnId, status: 'queued', lastSeq: 0 };
  const completed: TurnSnapshot = {
    ...pending, status: 'completed', lastSeq: 1, result: { text: 'Recuperada por consulta' },
  };
  let snapshotReads = 0;
  let eventReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [personal] });
    if (url.pathname.endsWith('/conversation-01')) {
      return Response.json({ ...personal, turns: [{ input: { text: 'Hola' }, snapshot: pending }] });
    }
    if (url.pathname.endsWith('/events')) {
      eventReads++;
      return new Response(null, { status });
    }
    return Response.json(++snapshotReads < 3 ? pending : completed);
  }));

  store.open(personal.scopeId, personal.conversationId);
  await vi.waitFor(() => expect(store.conversation()?.turns[0]?.snapshot).toEqual(completed), {
    timeout: 2_000,
  });
  expect(eventReads).toBe(1);
  expect(store.error()).toBeUndefined();
});

it('hides streamed text while revalidating an SSE 403 and retires a denied snapshot', async () => {
  const store = configureStore();
  const turnId = 'revoked-turn';
  const running: TurnSnapshot = { ...personal, turnId, status: 'running', lastSeq: 0 };
  let snapshotReads = 0;
  let streams = 0;
  let releaseDenial!: () => void;
  const denialReady = new Promise<void>((resolve) => { releaseDenial = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [personal] });
    if (url.pathname.endsWith('/conversation-01')) {
      return Response.json({ ...personal, turns: [{ input: { text: 'Hola' }, snapshot: running }] });
    }
    if (url.pathname.endsWith('/events')) {
      if (++streams === 1) return sseResponse(textEvent(turnId, 1, 'Texto previo'));
      return new Response(null, { status: 403 });
    }
    if (++snapshotReads === 1) return Response.json(running);
    await denialReady;
    return new Response(null, { status: 403 });
  }));

  store.open(personal.scopeId, personal.conversationId);
  try {
    await vi.waitFor(() => expect(store.streamText().get(turnId)).toBe('Texto previo'));
    await vi.waitFor(() => expect(snapshotReads).toBe(2));
    expect(store.streamText().get(turnId)).toBe('');
  } finally {
    releaseDenial();
  }
  await vi.waitFor(() => {
    expect(store.conversation()).toBeNull();
    expect(store.error()).toBe('La conversación ya no está disponible en este ámbito.');
  });
});

it('aborts the active stream after explicit cancellation', async () => {
  const store = configureStore();
  const turnId = 'cancel-stream';
  const running: TurnSnapshot = {
    ...personal, turnId, status: 'running', lastSeq: 1, result: { text: 'Primer bloque' },
  };
  const cancelled: TurnSnapshot = { ...personal, turnId, status: 'cancelled', lastSeq: 0 };
  let streamSignal: AbortSignal | null | undefined;
  const cancelReader = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [personal] });
    if (url.pathname.endsWith('/conversation-01')) {
      return Response.json({ ...personal, turns: [{ input: { text: 'Hola' }, snapshot: running }] });
    }
    if (url.pathname.endsWith('/events')) {
      streamSignal = request.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(textEvent(turnId, 2, ' y segundo bloque')));
        },
        cancel: cancelReader,
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return Response.json(url.pathname.endsWith('/cancel') ? cancelled : running);
  }));

  store.open(personal.scopeId, personal.conversationId);
  await vi.waitFor(() => expect(store.streamText().get(turnId)).toBe('Primer bloque y segundo bloque'));
  await store.cancel(turnId);

  expect(streamSignal?.aborted).toBe(true);
  expect(cancelReader).toHaveBeenCalledOnce();
  expect(store.conversation()?.turns[0]?.snapshot).toEqual(cancelled);
  expect(store.streamText().has(turnId)).toBe(false);
});

it('keeps SSE progressive across four productive connections', async () => {
  const store = configureStore();
  const turnId = 'long-turn';
  const running: TurnSnapshot = { ...personal, turnId, status: 'running', lastSeq: 0 };
  const completed: TurnSnapshot = {
    ...running, status: 'completed', lastSeq: 4, result: { text: '1234' },
  };
  const cursors: number[] = [];
  let snapshotReads = 0;
  let releaseTerminal!: () => void;
  const terminalReady = new Promise<void>((resolve) => { releaseTerminal = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [personal] });
    if (url.pathname.endsWith('/conversation-01')) {
      return Response.json({ ...personal, turns: [{ input: { text: 'Hola' }, snapshot: running }] });
    }
    if (url.pathname.endsWith('/events')) {
      const after = Number(url.searchParams.get('after'));
      cursors.push(after);
      const block = textEvent(turnId, after + 1, String(after + 1));
      if (after !== 3) return sseResponse(block);
      return sseResponse(block, 'event: status\ndata: ' +
        JSON.stringify({ type: 'status', turnId, status: 'completed', lastSeq: 4 }) + '\n\n');
    }
    if (++snapshotReads === 1) return Response.json(running);
    await terminalReady;
    return Response.json(completed);
  }));

  store.open(personal.scopeId, personal.conversationId);
  try {
    await vi.waitFor(() => expect(cursors).toEqual([0, 1, 2, 3]), { timeout: 2_500 });
    expect(store.streamText().get(turnId)).toBe('1234');
  } finally {
    releaseTerminal();
  }
  await vi.waitFor(() => expect(store.conversation()?.turns[0]?.snapshot).toEqual(completed));
});

it('polls after three consecutive connections without a new block', async () => {
  const store = configureStore();
  const turnId = 'stalled-stream';
  const running: TurnSnapshot = { ...personal, turnId, status: 'running', lastSeq: 0 };
  const completed: TurnSnapshot = {
    ...running, status: 'completed', lastSeq: 2, result: { text: '12' },
  };
  const cursors: number[] = [];
  let snapshotReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [personal] });
    if (url.pathname.endsWith('/conversation-01')) {
      return Response.json({ ...personal, turns: [{ input: { text: 'Hola' }, snapshot: running }] });
    }
    if (url.pathname.endsWith('/events')) {
      cursors.push(Number(url.searchParams.get('after')));
      if (cursors.length === 4) return sseResponse(textEvent(turnId, 2, '2'));
      return sseResponse(textEvent(turnId, 1, '1'));
    }
    return Response.json(++snapshotReads === 1 ? running : completed);
  }));

  store.open(personal.scopeId, personal.conversationId);
  await vi.waitFor(() => expect(store.conversation()?.turns[0]?.snapshot).toEqual(completed), {
    timeout: 3_500,
  });
  // Repeating a block spends the retry budget. The second block restores it.
  expect(cursors).toEqual([0, 1, 1, 1, 2, 2, 2]);
});
