import { InjectionToken } from '@angular/core';

import type { RuntimeConfigError } from './runtime-config';

export type ScopeKey = 'personal' | 'work';

export interface OAuthOptions {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly logoutEndpoint: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly redirectUri: string;
  readonly logoutUri: string;
}

export interface AppOptions {
  readonly scopeIds: Readonly<Record<ScopeKey, string>>;
  readonly apiBaseUrl?: string;
  readonly oauth?: OAuthOptions;
  readonly testing?: boolean;
  readonly configError?: RuntimeConfigError;
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
