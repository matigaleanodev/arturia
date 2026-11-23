import { InjectionToken } from '@angular/core';

export type ScopeKey = 'personal' | 'work';

export interface OAuthOptions {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
}

export interface AppOptions {
  readonly scopeIds: Readonly<Record<ScopeKey, string>>;
  readonly apiOrigin?: string;
  readonly oauth?: OAuthOptions;
  readonly testing?: boolean;
}

export const APP_OPTIONS = new InjectionToken<AppOptions>('Arturia configuration');

export function httpsUrl(value?: string): URL | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
