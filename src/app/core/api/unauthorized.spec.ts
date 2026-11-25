import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS } from '../app-options';
import { AuthSession } from '../auth/auth-session';
import { ChatApiError, HttpChatApi } from './chat-api';
import { ChatStream } from './sse-client';

// The deployed API answers every rejection with the same public error: API Gateway (no token, invalid or
// expired token) and the Lambda (valid token, no active account) both return 401 UNAUTHENTICATED. The
// header that tells them apart is not exposed to the browser. A 401 for a token the client still holds
// therefore means "this session is not accepted"; only the client's own expiry can say "expired".

const apiBaseUrl = 'https://api.arturia.example/prod/';

function setup() {
  const token = signal<string | null>('synthetic-access-token');
  const clear = vi.fn((_reason?: 'expired' | 'denied') => token.set(null));
  TestBed.configureTestingModule({
    providers: [
      { provide: APP_OPTIONS, useValue: { scopeIds: { personal: 'scope-personal', work: 'scope-work' }, apiBaseUrl } },
      { provide: AuthSession, useValue: { accessToken: token, clear } },
    ],
  });
  return { token, clear };
}

const publicRejection = () =>
  Response.json(
    { code: 'UNAUTHENTICATED', message: 'Se requiere una sesión válida.', requestId: 'synthetic-request' },
    { status: 401 },
  );

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

it('reports a denied session when the API rejects a token the client still holds', async () => {
  const { clear } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => publicRejection()));

  const failure = await TestBed.inject(HttpChatApi)
    .listConversations('scope-personal', new AbortController().signal)
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(ChatApiError);
  expect((failure as ChatApiError).status).toBe(401);
  expect(clear).toHaveBeenCalledExactlyOnceWith('denied');
});

it.each([
  ['an empty body', () => new Response(null, { status: 401 })],
  ['a body that is not JSON', () => new Response('<html>denied</html>', { status: 401 })],
  ['the default gateway body', () => Response.json({ message: 'Unauthorized' }, { status: 401 })],
])('treats a 401 with %s the same way', async (_name, respond) => {
  const { clear } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => respond()));

  await TestBed.inject(HttpChatApi)
    .listConversations('scope-personal', new AbortController().signal)
    .catch(() => undefined);

  expect(clear).toHaveBeenCalledExactlyOnceWith('denied');
});

it('does not end a newer session when a 401 answers a request made with an older token', async () => {
  const { token, clear } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => {
    token.set('refreshed-access-token');
    return publicRejection();
  }));

  await TestBed.inject(HttpChatApi)
    .listConversations('scope-personal', new AbortController().signal)
    .catch(() => undefined);

  expect(clear).not.toHaveBeenCalled();
  expect(token()).toBe('refreshed-access-token');
});

it('applies the same rule to the event stream', async () => {
  const { clear } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => publicRejection()));

  const events = TestBed.inject(ChatStream).connect('scope-personal', 'turn-1', 0, new AbortController().signal);
  await expect(events.next()).rejects.toMatchObject({ status: 401 });

  expect(clear).toHaveBeenCalledExactlyOnceWith('denied');
});

it('does not end the session when the event stream request was already aborted', async () => {
  const { clear } = setup();
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => {
    controller.abort();
    return publicRejection();
  }));

  const events = TestBed.inject(ChatStream).connect('scope-personal', 'turn-1', 0, controller.signal);
  await expect(events.next()).rejects.toBeDefined();

  expect(clear).not.toHaveBeenCalled();
});

it('never carries the rejection body into the thrown error', async () => {
  setup();
  vi.stubGlobal('fetch', vi.fn(async () => publicRejection()));

  const failure = await TestBed.inject(HttpChatApi)
    .listConversations('scope-personal', new AbortController().signal)
    .then(() => new Error('The request should have failed'), (error: unknown) => error as Error);

  expect(failure.message).toBe('Chat request failed (401)');
  expect(JSON.stringify(failure)).not.toContain('synthetic-request');
});
