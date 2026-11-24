import type { OAuthOptions } from './app-options';

export const RUNTIME_CONFIG_PATH = '/config.json';

export type RuntimeConfigError = 'missing' | 'invalid' | 'unreachable';

export interface RuntimeConnection {
  readonly apiBaseUrl: string;
  readonly oauth: OAuthOptions;
}

export type RuntimeConfigResult =
  | { readonly connection: RuntimeConnection }
  | { readonly error: RuntimeConfigError };

const configKeys = ['version', 'apiBaseUrl', 'cognito', 'redirectUri', 'logoutUri'];
const cognitoKeys = ['domain', 'clientId', 'scopes'];
const requiredScope = 'arturia/access';
const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const clientIdPattern = /^[\w+]{1,128}$/;
const safePath = /^(?:\/[\w~-][\w.~-]*)*\/?$/;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
    ? value as Record<string, unknown>
    : undefined;
}

// Accepts an exact https URL without credentials, query or fragment that the URL parser keeps unchanged.
function exactHttpsUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    const unchanged = url.href === value || url.href === `${value}/`;
    return unchanged && url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && safePath.test(url.pathname)
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function scopes(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 10) return undefined;
  const valid = value.every((scope) => typeof scope === 'string' && scopeToken.test(scope));
  return valid && new Set(value).size === value.length && value.includes(requiredScope)
    ? value as string[]
    : undefined;
}

export function parseRuntimeConfig(value: unknown, page: URL): RuntimeConnection | undefined {
  const config = record(value, configKeys);
  const cognito = record(config?.['cognito'], cognitoKeys);
  if (!config || !cognito || config['version'] !== 1 || page.protocol !== 'https:') return undefined;

  const api = exactHttpsUrl(config['apiBaseUrl']);
  const domain = exactHttpsUrl(cognito['domain']);
  const clientId = cognito['clientId'];
  const requested = scopes(cognito['scopes']);
  const root = new URL('/', page).href;
  if (
    !api || !domain || domain.pathname !== '/' || !requested ||
    typeof clientId !== 'string' || !clientIdPattern.test(clientId) ||
    config['redirectUri'] !== root || config['logoutUri'] !== root
  ) {
    return undefined;
  }

  return {
    apiBaseUrl: api.href.endsWith('/') ? api.href : `${api.href}/`,
    oauth: {
      authorizationEndpoint: new URL('/oauth2/authorize', domain).href,
      tokenEndpoint: new URL('/oauth2/token', domain).href,
      logoutEndpoint: new URL('/logout', domain).href,
      clientId,
      scopes: requested,
      redirectUri: root,
      logoutUri: root,
    },
  };
}

export async function loadRuntimeConfig(page: URL, timeoutMs = 5_000): Promise<RuntimeConfigResult> {
  let response: Response;
  try {
    response = await fetch(new URL(RUNTIME_CONFIG_PATH, page.origin), {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { error: 'unreachable' };
  }

  if (response.status === 403 || response.status === 404) return { error: 'missing' };
  if (!response.ok) return { error: 'unreachable' };
  // An HTML body means the SPA fallback answered instead of the published file.
  const type = response.headers.get('Content-Type') ?? '';
  if (/^text\/html\b/i.test(type)) return { error: 'missing' };
  if (!/^application\/json\b/i.test(type)) return { error: 'invalid' };

  try {
    const connection = parseRuntimeConfig(await response.json(), page);
    return connection ? { connection } : { error: 'invalid' };
  } catch {
    return { error: 'invalid' };
  }
}
