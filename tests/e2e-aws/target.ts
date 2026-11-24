// Target of test:e2e:aws. Every value comes from the environment and is validated before Playwright starts a
// browser. Errors name the variable and the reason, never its value.

export type Scope = 'personal' | 'work';

export interface Target {
  readonly webOrigin: string;
  readonly apiBaseUrl: string;
  readonly apiOrigin: string;
  readonly scope: Scope;
  /** Both origins on 127.0.0.1: a local rehearsal with a self-signed certificate. */
  readonly loopback: boolean;
  readonly accessToken: string;
}

export class TargetError extends Error {
  override readonly name = 'TargetError';
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new TargetError(`${name} is required; test:e2e:aws has no default target`);
  return value;
}

function httpsUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TargetError(`${name} must be an absolute URL`);
  }
  if (url.protocol !== 'https:') throw new TargetError(`${name} must use https`);
  if (url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#')) {
    throw new TargetError(`${name} must not carry credentials, a query or a fragment`);
  }
  if (/(^|\/)\.\.?(\/|$)/.test(value.slice(url.origin.length)) || /%2e/i.test(value) || value.includes('\\')) {
    throw new TargetError(`${name} must not contain dot segments`);
  }
  if (url.hostname === 'localhost') throw new TargetError(`${name} must use 127.0.0.1 for a local rehearsal`);
  return url;
}

const loopbackHost = (url: URL) => url.hostname === '127.0.0.1';
const tokenPattern = /^[A-Za-z0-9._~+/=-]{16,8192}$/;

export function parseTarget(env: Env): Target {
  const web = httpsUrl('ARTURIA_E2E_WEB_URL', required(env, 'ARTURIA_E2E_WEB_URL'));
  if (web.pathname !== '/') throw new TargetError('ARTURIA_E2E_WEB_URL must be the root of the distribution');

  const api = httpsUrl('ARTURIA_E2E_API_URL', required(env, 'ARTURIA_E2E_API_URL'));
  if (!api.pathname.endsWith('/')) api.pathname += '/';

  const loopback = loopbackHost(web);
  if (loopback !== loopbackHost(api)) {
    throw new TargetError('ARTURIA_E2E_WEB_URL and ARTURIA_E2E_API_URL must both be loopback or both be remote');
  }

  // A distinct API origin keeps the Authorization header checkable: it may only ever reach the API.
  if (api.origin === web.origin) throw new TargetError('ARTURIA_E2E_API_URL must not share the distribution origin');

  const scope = env['ARTURIA_E2E_SCOPE'] ?? 'personal';
  if (scope !== 'personal' && scope !== 'work') throw new TargetError('ARTURIA_E2E_SCOPE must be personal or work');

  const accessToken = required(env, 'ARTURIA_E2E_ACCESS_TOKEN');
  if (!tokenPattern.test(accessToken)) {
    throw new TargetError('ARTURIA_E2E_ACCESS_TOKEN must be 16 to 8192 token characters without spaces');
  }

  return { webOrigin: web.origin, apiBaseUrl: api.href, apiOrigin: api.origin, scope, loopback, accessToken };
}
