import { inject, Injectable } from '@angular/core';

import { AuthSession } from '../auth/auth-session';
import { CHAT_API_ORIGIN, ChatApiError, turnPath } from './chat-api';
import type { ArturiaV1SSEPayload } from './contract/sse.generated';

function decodeEvent(name: string, data: string[], turnId: string): ArturiaV1SSEPayload {
  const event = JSON.parse(data.join('\n')) as Record<string, unknown> | null;
  if (event?.type !== name || event.turnId !== turnId) throw new Error('Invalid chat event');

  if (event.type === 'text') {
    const { seq, text } = event;
    if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq > 0 &&
        typeof text === 'string' && text.length > 0) {
      return { type: 'text', turnId, seq, text };
    }
  } else {
    const { status, lastSeq } = event;
    if (status === 'queued' || status === 'running') {
      return { type: 'status', turnId, status };
    }
    if (typeof lastSeq === 'number' && Number.isSafeInteger(lastSeq) && lastSeq >= 0 &&
        ((status === 'failed' || status === 'blocked') && lastSeq === 0 ||
         status === 'incomplete' && lastSeq > 0 ||
         status === 'cancelled' || status === 'completed')) {
      return { type: 'status', turnId, status, lastSeq };
    }
  }
  throw new Error('Invalid chat event');
}

async function* readEvents(
  body: ReadableStream<Uint8Array>,
  turnId: string,
  signal: AbortSignal,
): AsyncGenerator<ArturiaV1SSEPayload> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let pending = '';
  let skipNewline = false;
  let name = '';
  let data: string[] = [];

  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) return;

      const chunk = decoder.decode(value, { stream: true });
      if (chunk.length === 0) continue;
      pending += skipNewline && chunk.startsWith('\n') ? chunk.slice(1) : chunk;
      skipNewline = chunk.endsWith('\r');
      let start = 0;
      for (const delimiter of pending.matchAll(/\r\n|[\r\n]/g)) {
        signal.throwIfAborted();
        const line = pending.slice(start, delimiter.index);
        start = delimiter.index + delimiter[0].length;
        if (line === '') {
          if (data.length && (name === 'text' || name === 'status')) {
            yield decodeEvent(name, data, turnId);
          }
          name = '';
          data = [];
        } else if (!line.startsWith(':')) {
          const separator = line.indexOf(':');
          const field = separator === -1 ? line : line.slice(0, separator);
          const content = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
          if (field === 'event') name = content;
          if (field === 'data') data.push(content);
        }
      }
      pending = pending.slice(start);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

@Injectable({ providedIn: 'root' })
export class ChatStream {
  private readonly origin = inject(CHAT_API_ORIGIN);
  private readonly auth = inject(AuthSession);

  async *connect(
    scopeId: string,
    turnId: string,
    after: number,
    signal: AbortSignal,
  ): AsyncGenerator<ArturiaV1SSEPayload> {
    signal.throwIfAborted();
    const token = this.auth.accessToken();
    if (!token) throw new ChatApiError(401);
    if (!this.origin) throw new ChatApiError(501);

    const attempt = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    const url = new URL(turnPath({ scopeId, turnId }) + '/events', this.origin);
    url.searchParams.set('after', String(after));
    const response = await fetch(url, {
      method: 'GET',
      headers: new Headers({ Authorization: 'Bearer ' + token, Accept: 'text/event-stream' }),
      signal: attempt,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (attempt.aborted || !response.ok || mediaType !== 'text/event-stream' || !response.body) {
      void response.body?.cancel().catch(() => {});
      attempt.throwIfAborted();
      if (response.status === 401 && this.auth.accessToken() === token) this.auth.clear();
      throw new ChatApiError(response.ok ? 501 : response.status);
    }
    yield* readEvents(response.body, turnId, attempt);
  }
}
