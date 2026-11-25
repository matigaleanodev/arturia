import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadRuntimeConfig, parseRuntimeConfig, RUNTIME_CONFIG_PATH } from './runtime-config';

const page = new URL('https://web.arturia.example/chat?scope=personal');
const valid = {
  version: 1,
  apiBaseUrl: 'https://api.arturia.example/prod/',
  cognito: {
    domain: 'https://login.arturia.example',
    clientId: 'public0client0id',
    scopes: ['openid', 'arturia/access'],
  },
  redirectUri: 'https://web.arturia.example/',
  logoutUri: 'https://web.arturia.example/',
};

function withChange(path: string[], value: unknown): unknown {
  const copy = structuredClone(valid) as Record<string, unknown>;
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const last = path.at(-1)!;
  if (value === undefined) delete target[last];
  else target[last] = value;
  return copy;
}

afterEach(() => vi.unstubAllGlobals());

describe('parseRuntimeConfig', () => {
  it('derives the API base URL and the Cognito endpoints from a valid configuration', () => {
    expect(parseRuntimeConfig(valid, page)).toEqual({
      apiBaseUrl: 'https://api.arturia.example/prod/',
      oauth: {
        authorizationEndpoint: 'https://login.arturia.example/oauth2/authorize',
        tokenEndpoint: 'https://login.arturia.example/oauth2/token',
        logoutEndpoint: 'https://login.arturia.example/logout',
        clientId: 'public0client0id',
        scopes: ['openid', 'arturia/access'],
        redirectUri: 'https://web.arturia.example/',
        logoutUri: 'https://web.arturia.example/',
      },
    });
  });

  it('keeps the stage path of the API and adds the trailing slash', () => {
    expect(parseRuntimeConfig(withChange(['apiBaseUrl'], 'https://api.arturia.example/prod'), page))
      .toMatchObject({ apiBaseUrl: 'https://api.arturia.example/prod/' });
    expect(parseRuntimeConfig(withChange(['apiBaseUrl'], 'https://api.arturia.example'), page))
      .toMatchObject({ apiBaseUrl: 'https://api.arturia.example/' });
  });

  it('runtime_config_requires_https_origins', () => {
    for (const change of [
      withChange(['apiBaseUrl'], 'http://api.arturia.example/prod/'),
      withChange(['cognito', 'domain'], 'http://login.arturia.example'),
      withChange(['redirectUri'], 'http://web.arturia.example/'),
      withChange(['logoutUri'], 'http://web.arturia.example/'),
    ]) {
      expect(parseRuntimeConfig(change, page)).toBeUndefined();
    }
    expect(parseRuntimeConfig(valid, new URL('http://web.arturia.example/'))).toBeUndefined();
  });

  it('pkce_redirect_matches_current_origin', () => {
    for (const change of [
      withChange(['redirectUri'], 'https://other.arturia.example/'),
      withChange(['redirectUri'], 'https://web.arturia.example/callback'),
      withChange(['logoutUri'], 'https://other.arturia.example/'),
      withChange(['logoutUri'], 'https://web.arturia.example/?next=1'),
    ]) {
      expect(parseRuntimeConfig(change, page)).toBeUndefined();
    }
  });

  it('rejects URLs with credentials, queries, fragments or ambiguous paths', () => {
    for (const change of [
      withChange(['apiBaseUrl'], 'https://user:pass@api.arturia.example/prod/'),
      withChange(['apiBaseUrl'], 'https://api.arturia.example/prod/?x=1'),
      withChange(['apiBaseUrl'], 'https://api.arturia.example/prod/#x'),
      withChange(['apiBaseUrl'], 'https://api.arturia.example/a/../prod/'),
      withChange(['apiBaseUrl'], 'https://api.arturia.example/pr%2Fod/'),
      withChange(['cognito', 'domain'], 'https://login.arturia.example/oauth2'),
      withChange(['cognito', 'domain'], 'https://login.arturia.example/?x=1'),
      withChange(['apiBaseUrl'], 'not a url'),
    ]) {
      expect(parseRuntimeConfig(change, page)).toBeUndefined();
    }
  });

  it('accepts only the public fields of version 1', () => {
    for (const change of [
      withChange(['version'], 2),
      withChange(['version'], undefined),
      withChange(['clientSecret'], 'must-not-be-published'),
      withChange(['cognito', 'clientSecret'], 'must-not-be-published'),
      withChange(['cognito', 'clientId'], undefined),
      withChange(['cognito', 'clientId'], 'bad client id'),
      withChange(['cognito', 'scopes'], ['openid']),
      withChange(['cognito', 'scopes'], ['openid', 'arturia/access', 'arturia/access']),
      withChange(['cognito', 'scopes'], ['openid', 'arturia/access', 'bad scope']),
      withChange(['cognito', 'scopes'], 'openid arturia/access'),
      withChange(['cognito'], null),
      [],
      null,
      'config',
    ]) {
      expect(parseRuntimeConfig(change, page)).toBeUndefined();
    }
  });
});

describe('loadRuntimeConfig', () => {
  function stubFetch(response: () => Promise<Response>) {
    const fetchConfig = vi.fn((_url: URL, _init: RequestInit) => response());
    vi.stubGlobal('fetch', fetchConfig);
    return fetchConfig;
  }

  it('fetches the same-origin file without cache, credentials or redirects', async () => {
    const fetchConfig = stubFetch(async () => Response.json(valid));

    const result = await loadRuntimeConfig(page);

    expect(result).toEqual({ connection: parseRuntimeConfig(valid, page) });
    expect(fetchConfig).toHaveBeenCalledOnce();
    const [url, init] = fetchConfig.mock.calls[0]!;
    expect(url.href).toBe(`https://web.arturia.example${RUNTIME_CONFIG_PATH}`);
    expect(init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a missing file for 404 and for an HTML fallback', async () => {
    stubFetch(async () => new Response('not found', { status: 404 }));
    expect(await loadRuntimeConfig(page)).toEqual({ error: 'missing' });

    stubFetch(async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }));
    expect(await loadRuntimeConfig(page)).toEqual({ error: 'missing' });
  });

  it('reports an invalid file for malformed JSON or rejected values', async () => {
    stubFetch(async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }));
    expect(await loadRuntimeConfig(page)).toEqual({ error: 'invalid' });

    stubFetch(async () => Response.json(withChange(['apiBaseUrl'], 'http://api.arturia.example/')));
    expect(await loadRuntimeConfig(page)).toEqual({ error: 'invalid' });

    stubFetch(async () => new Response(JSON.stringify(valid), { headers: { 'Content-Type': 'binary/octet-stream' } }));
    expect(await loadRuntimeConfig(page)).toEqual({ error: 'invalid' });
  });

  it('reports an unreachable file for network errors, server errors and timeouts', async () => {
    stubFetch(async () => { throw new TypeError('network'); });
    expect(await loadRuntimeConfig(page)).toEqual({ error: 'unreachable' });

    stubFetch(async () => new Response('', { status: 503 }));
    expect(await loadRuntimeConfig(page)).toEqual({ error: 'unreachable' });

    vi.stubGlobal('fetch', (_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    expect(await loadRuntimeConfig(page, 10)).toEqual({ error: 'unreachable' });
  });
});
