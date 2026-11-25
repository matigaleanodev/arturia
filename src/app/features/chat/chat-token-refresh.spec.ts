import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_OPTIONS, type AppOptions } from '../../core/app-options';
import { AuthSession } from '../../core/auth/auth-session';
import { routes } from '../../app.routes';

const scopeId = 'scope-personal';
const base = 'https://api.arturia.example/prod/v1/scopes/scope-personal';
const created = { scopeId, conversationId: 'created-01', createdAt: '2026-01-02T00:00:00.000Z' };
const options: AppOptions = {
  scopeIds: { personal: scopeId, work: 'scope-work' },
  apiBaseUrl: 'https://api.arturia.example/prod/',
};

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/**
 * Regression: a token refresh between the creation of the conversation and the route update reopened the empty
 * screen and aborted the first send in flight. Only signing out may leave the chat.
 */
it('keeps the first send alive when the access token changes while the message is in flight', async () => {
  const token = signal<string | null>('first-access-token');
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: APP_OPTIONS, useValue: options },
      { provide: AuthSession, useValue: { accessToken: token.asReadonly(), endedReason: signal(null), signOut: () => null } },
    ],
  });

  let acceptTurn!: () => void;
  const turnAccepted = new Promise<void>((resolve) => { acceptTurn = resolve; });
  const requests: { method: string; url: string; signal: AbortSignal | null | undefined }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, request: RequestInit) => {
    const method = request.method ?? 'GET';
    requests.push({ method, url: url.href, signal: request.signal });
    if (url.href === `${base}/conversations` && method === 'GET') return Response.json({ conversations: [] });
    if (url.href === `${base}/conversations` && method === 'POST') return Response.json(created, { status: 201 });
    if (url.href === `${base}/conversations/created-01/turns` && method === 'POST') {
      await turnAccepted;
      return Response.json({ turnId: 'turn-01', status: 'queued' }, { status: 202 });
    }
    if (url.pathname.endsWith('/events')) return new Response('', { headers: { 'Content-Type': 'text/event-stream' } });
    if (url.href.startsWith(`${base}/turns/`)) {
      return Response.json({ ...created, turnId: 'turn-01', status: 'queued', lastSeq: 0 });
    }
    throw new Error(`Unexpected request ${method} ${url.href}`);
  }));

  const harness = await RouterTestingHarness.create('/chat?scope=personal');
  const host = harness.routeNativeElement as HTMLElement;
  const field = host.querySelector('textarea')!;
  field.value = 'Primer mensaje';
  field.dispatchEvent(new Event('input'));
  harness.detectChanges();
  host.querySelector<HTMLButtonElement>('button.send')!.click();

  // The conversation exists and the message waits for the server's acknowledgement.
  await vi.waitFor(() => expect(requests.some(({ method, url }) =>
    method === 'POST' && url.endsWith('/conversations/created-01/turns'))).toBe(true));
  const inFlight = requests.find(({ url }) => url.endsWith('/conversations/created-01/turns'))!;

  token.set('refreshed-access-token');
  harness.detectChanges();
  await Promise.resolve();
  expect(TestBed.inject(Router).url).toContain('/chat');
  expect(inFlight.signal?.aborted).toBe(false);

  acceptTurn();
  await vi.waitFor(() => expect(TestBed.inject(Router).url).toContain('conversation=created-01'));

  // The route caught up with the created conversation without reloading it or aborting anything.
  const sends = requests.filter(({ method, url }) => method === 'POST' && url.endsWith('/turns'));
  expect(sends).toHaveLength(1);
  expect(sends[0]!.signal?.aborted).toBe(false);
  expect(requests.filter(({ method, url }) => method === 'GET' && url === `${base}/conversations/created-01`)).toEqual([]);
  expect(requests.filter(({ method, url }) => method === 'POST' && url === `${base}/conversations`)).toHaveLength(1);
});

it('leaves the chat when the access token is cleared', async () => {
  const token = signal<string | null>('first-access-token');
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: APP_OPTIONS, useValue: options },
      { provide: AuthSession, useValue: { accessToken: token.asReadonly(), endedReason: signal(null), signOut: () => null } },
    ],
  });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ conversations: [] })));

  const harness = await RouterTestingHarness.create('/chat?scope=personal');
  token.set(null);
  harness.detectChanges();
  await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/'));
});
