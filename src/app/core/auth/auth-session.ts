import { DestroyRef, inject, Injectable, type Signal, signal } from '@angular/core';

import { APP_OPTIONS, httpsUrl } from '../app-options';

@Injectable({ providedIn: 'root', useFactory: () => inject(BrowserAuthSession) })
export abstract class AuthSession {
  abstract readonly accessToken: Signal<string | null>;
  abstract readonly signInAvailable: boolean;
  abstract begin(): Promise<URL>;
  abstract complete(callback: URLSearchParams): Promise<void>;
  abstract clear(): void;
}

const transactionKey = 'arturia.oauth.transaction';
const sessionKey = 'arturia.oauth.session';
const transactionLifetimeMs = 10 * 60 * 1000;

interface LoginTransaction {
  readonly state: string;
  readonly verifier: string;
  readonly expiresAt: number;
}

interface AccessSession {
  readonly token: string;
  readonly expiresAt: number;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function readStored(key: string): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function validTransaction(value: unknown): value is LoginTransaction {
  return (
    typeof value === 'object' &&
    value !== null &&
    'verifier' in value &&
    typeof value.verifier === 'string' &&
    /^[\w-]{43}$/.test(value.verifier) &&
    'state' in value &&
    typeof value.state === 'string' &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'number' &&
    value.expiresAt > Date.now()
  );
}

function validSession(value: unknown): value is AccessSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    typeof value.token === 'string' &&
    value.token.length > 0 &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt > Date.now()
  );
}

@Injectable({ providedIn: 'root' })
export class BrowserAuthSession implements AuthSession {
  private readonly oauth = inject(APP_OPTIONS).oauth;
  private readonly authorizationEndpoint = httpsUrl(this.oauth?.authorizationEndpoint);
  private readonly tokenEndpoint = httpsUrl(this.oauth?.tokenEndpoint);
  private readonly redirectUri = new URL('/', location.href);
  private readonly token = signal<string | null>(null);
  private expiryTimer?: ReturnType<typeof setTimeout>;

  readonly accessToken = this.token.asReadonly();
  readonly signInAvailable = Boolean(
    this.redirectUri.protocol === 'https:' &&
      this.oauth?.clientId &&
      this.oauth.scopes.length &&
      this.authorizationEndpoint &&
      this.tokenEndpoint &&
      this.authorizationEndpoint.origin === this.tokenEndpoint.origin &&
      crypto.subtle,
  );

  constructor() {
    if (this.signInAvailable) {
      const stored = readStored(sessionKey);
      if (validSession(stored)) this.applySession(stored);
    }
    inject(DestroyRef).onDestroy(() => clearTimeout(this.expiryTimer));
  }

  async begin(): Promise<URL> {
    if (!this.signInAvailable || !this.oauth || !this.authorizationEndpoint) {
      throw new Error('Sign-in is unavailable');
    }

    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const transaction: LoginTransaction = {
      state,
      verifier,
      expiresAt: Date.now() + transactionLifetimeMs,
    };
    sessionStorage.setItem(transactionKey, JSON.stringify(transaction));

    const url = new URL(this.authorizationEndpoint);
    const parameters = new URLSearchParams({
      response_type: 'code',
      client_id: this.oauth.clientId,
      redirect_uri: this.redirectUri.href,
      scope: this.oauth.scopes.join(' '),
      state,
      code_challenge_method: 'S256',
      code_challenge: base64Url(new Uint8Array(digest)),
    });
    url.search = parameters.toString();
    return url;
  }

  async complete(callback: URLSearchParams): Promise<void> {
    const transaction = readStored(transactionKey);
    sessionStorage.removeItem(transactionKey);

    const code = callback.get('code');
    if (
      !this.signInAvailable ||
      !this.oauth ||
      !this.tokenEndpoint ||
      callback.has('error') ||
      !code ||
      callback.getAll('code').length !== 1 ||
      callback.getAll('state').length !== 1 ||
      !validTransaction(transaction) ||
      callback.get('state') !== transaction.state
    ) {
      throw new Error('Invalid authorization callback');
    }

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.oauth.clientId,
        redirect_uri: this.redirectUri.href,
        code,
        code_verifier: transaction.verifier,
      }),
    });
    if (!response.ok) throw new Error('Token exchange failed');

    const body = await response.json() as {
      access_token?: unknown;
      token_type?: unknown;
      expires_in?: unknown;
    } | null;
    if (
      typeof body?.access_token !== 'string' ||
      !body.access_token ||
      typeof body.token_type !== 'string' ||
      body.token_type.toLowerCase() !== 'bearer' ||
      typeof body.expires_in !== 'number' ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0
    ) {
      throw new Error('Access token unavailable');
    }

    const session = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    if (!validSession(session)) throw new Error('Invalid access session');
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    this.applySession(session);
  }

  clear(): void {
    clearTimeout(this.expiryTimer);
    this.token.set(null);
    sessionStorage.removeItem(sessionKey);
  }

  private applySession(session: AccessSession): void {
    this.token.set(session.token);
    clearTimeout(this.expiryTimer);
    const expire = () => {
      const remaining = session.expiresAt - Date.now();
      if (remaining <= 0) this.clear();
      else this.expiryTimer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
    };
    expire();
  }
}
