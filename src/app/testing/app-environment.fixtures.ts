import { type Provider, signal } from '@angular/core';

import { CHAT_API_BASE_URL, ChatApi } from '../core/api/chat-api';
import { APP_OPTIONS, type AppOptions } from '../core/app-options';
import { AuthSession } from '../core/auth/auth-session';
import { FixtureChatApi, fixtureScopes } from './fixture-chat-api';

class FixtureAuthSession implements AuthSession {
  private readonly token = signal<string | null>('arturia-test-session');
  readonly accessToken = this.token.asReadonly();
  readonly signInAvailable = false;

  async begin(): Promise<URL> {
    throw new Error('Fixture session does not redirect');
  }

  async complete(): Promise<void> {
    throw new Error('Fixture session does not exchange tokens');
  }

  clear(): void {
    this.token.set(null);
  }

  signOut(): URL | null {
    this.clear();
    return null;
  }
}

const isLocalFixture =
  ['localhost', '127.0.0.1'].includes(location.hostname) &&
  ['http:', 'https:'].includes(location.protocol);
const options: AppOptions = { scopeIds: fixtureScopes, testing: isLocalFixture };

const providers: Provider[] = [
  { provide: APP_OPTIONS, useValue: options },
  ...(isLocalFixture ? [
    { provide: AuthSession, useClass: FixtureAuthSession },
    { provide: ChatApi, useClass: FixtureChatApi },
    {
      provide: CHAT_API_BASE_URL,
      useFactory: () => sessionStorage.getItem('arturia.fixture.stream') === 'true'
        ? `${location.origin}/`
        : undefined,
    },
  ] : []),
];

// Fixtures inject their configuration and never request /config.json.
export async function appEnvironment(): Promise<Provider[]> {
  return providers;
}
