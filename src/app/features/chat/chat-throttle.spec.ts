import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS, type AppOptions } from '../../core/app-options';
import type { TurnSnapshot } from '../../core/api/contract/openapi.generated';
import { AuthSession } from '../../core/auth/auth-session';
import { ChatStore } from './chat.store';

// Recovery from HTTP 429 with controlled timers. Math.random is pinned to 0, so the SSE backoff steps
// are exactly 1, 2, 4, 4… s and the polling steps 1.5, 2… s.

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
const turnId = 'throttled-turn';
const running: TurnSnapshot = { ...personal, turnId, status: 'running', lastSeq: 0 };
const completed: TurnSnapshot = { ...running, status: 'completed', lastSeq: 2, result: { text: 'Uno dos' } };
const start = Date.parse('2026-01-01T00:00:00Z');

type Handler = (url: URL, request: RequestInit) => Response | Promise<Response>;

interface Harness {
  readonly store: ChatStore;
  readonly token: ReturnType<typeof signal<string | null>>;
  /** Milliseconds since the start at which each SSE request left, with its cursor. */
  readonly streams: { at: number; after: number; scopeId: string }[];
  readonly polls: number[];
  readonly maxOpenStreams: () => number;
}

function sse(...frames: string[]): Response {
  return new Response(frames.join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}

function text(seq: number, value: string): string {
  return 'event: text\ndata: ' + JSON.stringify({ type: 'text', turnId, seq, text: value }) + '\n\n';
}

function terminal(lastSeq: number): string {
  return 'event: status\ndata: ' +
    JSON.stringify({ type: 'status', turnId, status: 'completed', lastSeq }) + '\n\n';
}

function throttled(retryAfter?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (retryAfter !== undefined) headers.set('Retry-After', retryAfter);
  return Response.json(
    { code: 'RATE_LIMITED', message: 'Hay demasiadas solicitudes.', requestId: 'synthetic' },
    { status: 429, headers },
  );
}

/** A stream that stays open until the client aborts it. */
function openStream(signal: AbortSignal, onClose: () => void, ...frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      signal.addEventListener('abort', () => {
        onClose();
        controller.error(signal.reason);
      }, { once: true });
    },
    cancel: onClose,
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

function setup(events: Handler, snapshot: Handler = () => Response.json(running)): Harness {
  const token = signal<string | null>('synthetic-access-token');
  const options: AppOptions = {
    scopeIds: { personal: personal.scopeId, work: work.scopeId },
    apiBaseUrl: 'https://api.arturia.example/prod/',
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      ChatStore,
      { provide: APP_OPTIONS, useValue: options },
      { provide: AuthSession, useValue: { accessToken: token, clear: () => token.set(null) } },
    ],
  });
  const streams: Harness['streams'] = [];
  const polls: number[] = [];
  let open = 0;
  let maxOpen = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    request.signal?.throwIfAborted();
    const summary = url.pathname.includes('/scope-work/') ? work : personal;
    if (url.pathname.endsWith('/conversations')) return Response.json({ conversations: [summary] });
    if (url.pathname.endsWith('/' + summary.conversationId)) {
      const snapshot = summary === work
        ? { ...work, turnId: 'work-turn', status: 'completed', lastSeq: 1, result: { text: 'Hecho' } }
        : running;
      return Response.json({ ...summary, turns: [{ input: { text: 'Hola' }, snapshot }] });
    }
    if (url.pathname.endsWith('/events')) {
      streams.push({
        at: Date.now() - start,
        after: Number(url.searchParams.get('after')),
        scopeId: summary.scopeId,
      });
      maxOpen = Math.max(maxOpen, ++open);
      let closed = false;
      const close = () => {
        if (!closed) open--;
        closed = true;
      };
      const response = await events(url, { ...request, signal: request.signal ?? undefined });
      if (!response.body || response.status !== 200) {
        close();
        return response;
      }
      // Count a stream as open until its body is fully read or cancelled.
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { value, done } = await reader.read();
            if (done) {
              close();
              controller.close();
            } else {
              controller.enqueue(value);
            }
          } catch (error) {
            close();
            controller.error(error);
          }
        },
        cancel(reason) {
          close();
          return reader.cancel(reason);
        },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    }
    if (url.pathname.endsWith('/turns/' + turnId)) {
      polls.push(Date.now() - start);
      return snapshot(url, request);
    }
    throw new Error('Unexpected request ' + url.pathname);
  }));
  return { store: TestBed.inject(ChatStore), token, streams, polls, maxOpenStreams: () => maxOpen };
}

/** Lets fetch doubles and body streams settle; they rely on real macrotasks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
}

async function advance(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    await vi.advanceTimersByTimeAsync(Math.min(50, ms - elapsed));
    await settle();
  }
}

/** Each request may leave up to one 50 ms slice after its timer. */
function expectTimes(actual: number[], expected: number[]): void {
  expect(actual.length, `times ${JSON.stringify(actual)}`).toBe(expected.length);
  actual.forEach((at, index) => {
    expect(at, `time ${index} of ${JSON.stringify(actual)}`).toBeGreaterThanOrEqual(expected[index]!);
    expect(at, `time ${index} of ${JSON.stringify(actual)}`).toBeLessThan(expected[index]! + 50);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'], now: start });
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('throttle_isolated_429_recovers_with_cursor_without_duplicates', async () => {
  const { store, streams } = setup((_url) => {
    if (streams.length === 1) return sse(text(1, 'Uno '));
    if (streams.length === 2) return throttled();
    return sse(text(1, 'Uno '), text(2, 'dos'), terminal(2));
  }, () => Response.json(running));

  store.open(personal.scopeId, personal.conversationId);
  await advance(3_000);

  // Productive close → 250 ms; 429 → one SSE token (1 s).
  expectTimes(streams.map(({ at }) => at), [0, 250, 1_250]);
  expect(streams.map(({ after }) => after)).toEqual([0, 1, 1]);
  expect(store.streamText().get(turnId)).toBe('Uno dos');
});

it('throttle_sustained_burst_backs_off_and_falls_back_within_budget', async () => {
  let done = false;
  const { store, streams, polls } = setup(() => throttled(), () => Response.json(done ? completed : running));

  store.open(personal.scopeId, personal.conversationId);
  await advance(30_000);

  // 1, 2, 4, 4… s: the next 4 s step after 23 s would exceed the 24 s budget.
  expectTimes(streams.map(({ at }) => at), [0, 1_000, 3_000, 7_000, 11_000, 15_000, 19_000, 23_000]);
  expect(polls.length).toBeGreaterThan(1);
  expect(polls[1]).toBeGreaterThanOrEqual(23_000);
  expect(polls[1]).toBeLessThan(23_050);

  done = true;
  await advance(120_000);
  expect(streams).toHaveLength(8);
  expect(store.conversation()?.turns[0]?.snapshot).toEqual(completed);
  expect(vi.getTimerCount()).toBe(0);
});

it('throttle_respects_a_valid_retry_after', async () => {
  const { store, streams } = setup(() => {
    if (streams.length === 1) return throttled('3');
    return sse(text(1, 'Uno '), text(2, 'dos'), terminal(2));
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(4_000);

  expectTimes(streams.map(({ at }) => at), [0, 3_000]);
});

it('throttle_never_retries_before_the_backoff_step_even_with_retry_after_zero', async () => {
  const { store, streams } = setup(() => {
    if (streams.length <= 2) return throttled('0');
    return sse(text(1, 'Uno '), text(2, 'dos'), terminal(2));
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(4_000);

  expectTimes(streams.map(({ at }) => at), [0, 1_000, 3_000]);
});

it.each(['abc', '-1', '1.5'])('throttle_ignores_an_invalid_retry_after (%j)', async (retryAfter) => {
  const { store, streams } = setup(() => {
    if (streams.length === 1) return throttled(retryAfter);
    return sse(text(1, 'Uno '), text(2, 'dos'), terminal(2));
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(2_000);

  expectTimes(streams.map(({ at }) => at), [0, 1_000]);
});

it('throttle_falls_back_at_once_when_retry_after_exceeds_the_budget', async () => {
  const { store, streams, polls } = setup(() => {
    if (streams.length === 1) return throttled();
    return throttled('24');
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(30_000);

  // At 1 s, 24 s more would end past the 24 s budget, so no third SSE request is made.
  expectTimes(streams.map(({ at }) => at), [0, 1_000]);
  expect(polls[1]).toBeGreaterThanOrEqual(1_000);
  expect(polls[1]).toBeLessThan(1_050);
});

it('throttle_during_fallback_backs_off_polling_and_honours_retry_after', async () => {
  let snapshots = 0;
  const { store, streams, polls } = setup(() => throttled('60'), () => {
    snapshots++;
    if (snapshots === 1) return Response.json(running);
    if (snapshots <= 4) return throttled();
    if (snapshots === 5) return throttled('5');
    if (snapshots === 6) return Response.json(running);
    return Response.json(completed);
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(20_000);

  expect(streams).toHaveLength(1);
  // Throttled polls step 1.5, 2, 2 s, then Retry-After 5 s, then the normal 750 ms interval.
  expectTimes(polls, [0, 0, 1_500, 3_500, 5_500, 10_500, 11_250]);
  expect(store.conversation()?.turns[0]?.snapshot).toEqual(completed);
  expect(store.error()).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it('throttle_does_not_turn_a_huge_retry_after_into_an_immediate_poll', async () => {
  let snapshots = 0;
  const { store, polls } = setup(() => throttled('60'), () => {
    snapshots++;
    return snapshots === 1 ? Response.json(running) : throttled('9999999999');
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(30_000);

  // Retry-After is honoured up to one SSE window per wait.
  expectTimes(polls, [0, 0, 24_000]);
});

it('throttle_scope_switch_during_backoff_cancels_the_pending_retry', async () => {
  const { store, streams } = setup(() => throttled());

  store.open(personal.scopeId, personal.conversationId);
  await advance(500);
  expect(streams).toHaveLength(1);

  store.open(work.scopeId, work.conversationId);
  await advance(30_000);

  expect(streams).toHaveLength(1);
  expect(store.conversation()?.scopeId).toBe(work.scopeId);
  expect(vi.getTimerCount()).toBe(0);
});

it('throttle_reopening_the_conversation_during_backoff_keeps_a_single_follower', async () => {
  const { store, streams, maxOpenStreams } = setup((_url, request) => {
    if (streams.length === 1) return throttled();
    return openStream(request.signal!, () => {}, text(1, 'Uno '));
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(500);
  store.open(personal.scopeId, personal.conversationId);
  await advance(5_000);

  // The reopened conversation connects right away; the old 1 s retry never fires.
  expectTimes(streams.map(({ at }) => at), [0, 500]);
  expect(maxOpenStreams()).toBe(1);
});

it('throttle_cancellation_during_backoff_stops_retries', async () => {
  const cancelled: TurnSnapshot = { ...running, status: 'cancelled', lastSeq: 0 };
  const { store, streams } = setup(() => throttled());

  store.open(personal.scopeId, personal.conversationId);
  await advance(500);
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = input as URL;
    if (url.pathname.endsWith('/cancel')) return Response.json(cancelled);
    return original(input, init);
  });
  await store.cancel(turnId);
  await advance(30_000);

  expect(streams).toHaveLength(1);
  expect(store.conversation()?.turns[0]?.snapshot).toEqual(cancelled);
  expect(vi.getTimerCount()).toBe(0);
});

it('throttle_terminal_snapshot_during_fallback_stops_polling', async () => {
  let snapshots = 0;
  const { store, polls } = setup(() => throttled('60'), () => {
    snapshots++;
    if (snapshots === 1) return Response.json(running);
    if (snapshots === 2) return throttled();
    return Response.json(completed);
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(60_000);

  expectTimes(polls, [0, 0, 1_500]);
  expect(store.hasActiveTurn()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('throttle_logout_during_backoff_cancels_the_pending_retry', async () => {
  const { store, streams, polls, token } = setup(() => throttled());

  store.open(personal.scopeId, personal.conversationId);
  await advance(500);
  expect(vi.getTimerCount()).toBe(1);
  token.set(null);
  TestBed.tick();
  // The backoff timer goes away at sign-out, not when it would have fired.
  expect(vi.getTimerCount()).toBe(0);
  await advance(30_000);

  expect(streams).toHaveLength(1);
  expect(polls).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('throttle_429_does_not_spend_the_stall_budget_of_other_errors', async () => {
  const { store, streams } = setup(() => {
    if (streams.length <= 3) return throttled();
    if (streams.length === 4) return new Response(null, { status: 503 });
    return sse(text(1, 'Uno '), text(2, 'dos'), terminal(2));
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(10_000);

  // Three 429 (1, 2, 4 s) and one 503 (250 ms) still leave the stream in charge.
  expectTimes(streams.map(({ at }) => at), [0, 1_000, 3_000, 7_000, 7_250]);
  expect(store.streamText().get(turnId)).toBe('Uno dos');
});

it('throttle_admitted_connection_starts_a_fresh_episode', async () => {
  const { store, streams } = setup(() => {
    if (streams.length <= 3) return throttled();
    if (streams.length === 4) return sse(text(1, 'Uno '));
    if (streams.length === 5) return throttled();
    return sse(text(2, 'dos'), terminal(2));
  });

  store.open(personal.scopeId, personal.conversationId);
  await advance(10_000);

  // After the admitted stream at 7 s, the next 429 waits one token again instead of 4 s.
  expectTimes(streams.map(({ at }) => at), [0, 1_000, 3_000, 7_000, 7_250, 8_250]);
  expect(streams.map(({ after }) => after)).toEqual([0, 0, 0, 0, 1, 1]);
  expect(store.streamText().get(turnId)).toBe('Uno dos');
});

it('throttle_errors_between_429_do_not_restart_the_budget', async () => {
  const { store, streams, polls } = setup(() =>
    streams.length % 4 === 0 ? new Response(null, { status: 503 }) : throttled());

  store.open(personal.scopeId, personal.conversationId);
  await advance(60_000);

  // 503 counts as a stall (250, 500 ms) but the 429 schedule and its 24 s budget carry on.
  expectTimes(streams.map(({ at }) => at),
    [0, 1_000, 3_000, 7_000, 7_250, 11_250, 15_250, 19_250, 19_750, 23_750]);
  expect(polls[1]).toBeGreaterThanOrEqual(23_750);
  expect(polls[1]).toBeLessThan(23_800);
});

it('throttle_reopening_during_an_open_stream_keeps_a_single_connection', async () => {
  const { store, streams, maxOpenStreams } = setup((_url, request) =>
    openStream(request.signal!, () => {}, text(1, 'Uno ')));

  store.open(personal.scopeId, personal.conversationId);
  await advance(500);
  store.open(personal.scopeId, personal.conversationId);
  await advance(500);
  store.open(work.scopeId, work.conversationId);
  await advance(5_000);

  expectTimes(streams.map(({ at }) => at), [0, 500]);
  expect(streams.map(({ after }) => after)).toEqual([0, 0]);
  expect(maxOpenStreams()).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});
