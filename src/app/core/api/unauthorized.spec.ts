import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS } from '../app-options';
import { AuthSession } from '../auth/auth-session';
import { ChatApiError, HttpChatApi } from './chat-api';
import { ChatStream } from './sse-client';

// A 401 can come from two places. API Gateway rejects an expired or invalid token before any Lambda runs
// and answers without the public error body. The Lambda answers UNAUTHENTICATED with the public body when
// the token is valid but resolves to no active account (not provisioned, revoked or issued before activation).

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

const lambdaRejection = () =>
  Response.json(
    { code: 'UNAUTHENTICATED', message: 'Se requiere una sesión válida.', requestId: 'synthetic-request' },
    { status: 401 },
  );
const gatewayRejection = () => Response.json({ message: 'Unauthorized' }, { status: 401 });

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

it('marks the account as denied when the API rejects a valid token with UNAUTHENTICATED', async () => {
  const { clear } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => lambdaRejection()));

  const failure = await TestBed.inject(HttpChatApi)
    .listConversations('scope-personal', new AbortController().signal)
    .catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(ChatApiError);
  expect((failure as ChatApiError).status).toBe(401);
  expect(clear).toHaveBeenCalledExactlyOnceWith('denied');
});

it('marks the session as expired when the gateway rejects the token without the public error body', async () => {
  const { clear } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => gatewayRejection()));

  await TestBed.inject(HttpChatApi)
    .listConversations('scope-personal', new AbortController().signal)
    .catch(() => undefined);

  expect(clear).toHaveBeenCalledExactlyOnceWith('expired');
});

it.each([
  ['an empty body', () => new Response(null, { status: 401 })],
  ['a body that is not JSON', () => new Response('<html>denied</html>', { status: 401 })],
  ['a different public code', () => Response.json({ code: 'RATE_LIMITED', message: 'x', requestId: 'y' }, { status: 401 })],
])('treats a 401 with %s as an expired session', async (_name, respond) => {
  const { clear } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => respond()));

  await TestBed.inject(HttpChatApi)
    .listConversations('scope-personal', new AbortController().signal)
    .catch(() => undefined);

  expect(clear).toHaveBeenCalledExactlyOnceWith('expired');
});

it('does not end a newer session when a 401 answers a request made with an older token', async () => {
  const { token, clear } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => {
    token.set('refreshed-access-token');
    return lambdaRejection();
  }));

  await TestBed.inject(HttpChatApi)
    .listConversations('scope-personal', new AbortController().signal)
    .catch(() => undefined);

  expect(clear).not.toHaveBeenCalled();
  expect(token()).toBe('refreshed-access-token');
});

it('applies the same distinction to the event stream', async () => {
  for (const [respond, reason] of [
    [lambdaRejection, 'denied'],
    [gatewayRejection, 'expired'],
  ] as const) {
    const { clear } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => respond()));

    const events = TestBed.inject(ChatStream).connect('scope-personal', 'turn-1', 0, new AbortController().signal);
    await expect(events.next()).rejects.toMatchObject({ status: 401 });

    expect(clear).toHaveBeenCalledExactlyOnceWith(reason);
    TestBed.resetTestingModule();
  }
});

it('never reads the rejection body into the thrown error', async () => {
  setup();
  vi.stubGlobal('fetch', vi.fn(async () => lambdaRejection()));

  const failure = await TestBed.inject(HttpChatApi)
    .listConversations('scope-personal', new AbortController().signal)
    .then(() => new Error('The request should have failed'), (error: unknown) => error as Error);

  expect(failure.message).toBe('Chat request failed (401)');
  expect(JSON.stringify(failure)).not.toContain('synthetic-request');
});
