import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS } from '../app-options';
import { AuthSession } from '../auth/auth-session';
import { ChatApiError } from './chat-api';
import { ChatStream } from './sse-client';

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

it('sse_handles_split_utf8_and_frames', async () => {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: APP_OPTIONS,
        useValue: { scopeIds: { personal: 'scope/a', work: 'work' }, apiBaseUrl: 'https://api.arturia.example/prod/' },
      },
      { provide: AuthSession, useValue: { accessToken: signal('synthetic-token') } },
    ],
  });
  const abortSignal = new AbortController().signal;
  const fetchEvents = vi.fn(async () => {
    const wire = [
      ': keep-alive\r\n\r\n',
      'id: ignored\n\nevent: text\r\ndata: {"type":"text","turnId":"turn?",\r\n',
      'data: "seq":4,"text":"¿Tomás café ☕?"}\r\n\r\n',
      'event: status\rdata: {"type":"status","turnId":"turn?","status":"completed","lastSeq":4}\r\r',
      'event: text\ndata: {"type":"text","turnId":"turn?","seq":5,"text":"Truncado"}',
    ].join('');
    const bytes = new TextEncoder().encode(wire);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  });
  vi.stubGlobal('fetch', fetchEvents);

  const events = [];
  for await (const event of TestBed.inject(ChatStream).connect('scope/a', 'turn?', 3, abortSignal)) {
    events.push(event);
  }
  expect(events).toEqual([
    { type: 'text', turnId: 'turn?', seq: 4, text: '¿Tomás café ☕?' },
    { type: 'status', turnId: 'turn?', status: 'completed', lastSeq: 4 },
  ]);
  expect(fetchEvents).toHaveBeenCalledWith(new URL('https://api.arturia.example/prod/v1/scopes/scope%2Fa/turns/turn%3F/events?after=3'), {
    method: 'GET',
    headers: new Headers({ Authorization: 'Bearer synthetic-token', Accept: 'text/event-stream' }),
    signal: expect.any(AbortSignal),
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
});

it.each([
  ['5', 5_000],
  [null, undefined],
  ['mañana', undefined],
])('sse_429_reports_a_readable_retry_after (%j)', async (retryAfter, expected) => {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: APP_OPTIONS,
        useValue: { scopeIds: { personal: 'scope/a', work: 'work' }, apiBaseUrl: 'https://api.arturia.example/prod/' },
      },
      { provide: AuthSession, useValue: { accessToken: signal('synthetic-token'), clear: vi.fn() } },
    ],
  });
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (retryAfter !== null) headers.set('Retry-After', retryAfter);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(
    { code: 'RATE_LIMITED', message: 'Hay demasiadas solicitudes.', requestId: 'synthetic' },
    { status: 429, headers },
  )));

  const events = TestBed.inject(ChatStream).connect('scope/a', 'turn', 0, new AbortController().signal);
  const error = await events.next().then(() => undefined, (reason: unknown) => reason);

  expect(error).toBeInstanceOf(ChatApiError);
  expect(error).toMatchObject({ status: 429, retryAfterMs: expected });
});
