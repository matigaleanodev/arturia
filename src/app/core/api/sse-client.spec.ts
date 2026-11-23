import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS } from '../app-options';
import { AuthSession } from '../auth/auth-session';
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
        useValue: { scopeIds: { personal: 'scope/a', work: 'work' }, apiOrigin: 'https://api.arturia.example' },
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
  expect(fetchEvents).toHaveBeenCalledWith(new URL('https://api.arturia.example/v1/scopes/scope%2Fa/turns/turn%3F/events?after=3'), {
    method: 'GET',
    headers: new Headers({ Authorization: 'Bearer synthetic-token', Accept: 'text/event-stream' }),
    signal: expect.any(AbortSignal),
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
});
