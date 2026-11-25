import { type Provider, signal } from '@angular/core';

import { CHAT_API_BASE_URL } from '../core/api/chat-api';
import { APP_OPTIONS, type AppOptions } from '../core/app-options';
import { AuthSession } from '../core/auth/auth-session';

declare const INTEGRATED_API_ORIGIN: string;

const options: AppOptions = {
  scopeIds: { personal: 'fixture-personal', work: 'integrated-work' },
  testing: true,
};

if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1' ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(INTEGRATED_API_ORIGIN)) {
  throw new Error('The integrated test configuration requires IPv4 loopback');
}

const token = signal<string | null>('integrated.a.local');
const session: AuthSession = {
  accessToken: token.asReadonly(),
  signInAvailable: false,
  async begin() { throw new Error('Local test session'); },
  async complete() { throw new Error('Local test session'); },
  clear() { token.set(null); },
  signOut() { token.set(null); return null; },
};

const providers: Provider[] = [
  { provide: APP_OPTIONS, useValue: options },
  { provide: AuthSession, useValue: session },
  { provide: CHAT_API_BASE_URL, useValue: `${INTEGRATED_API_ORIGIN}/` },
];

export async function appEnvironment(): Promise<Provider[]> {
  return providers;
}
