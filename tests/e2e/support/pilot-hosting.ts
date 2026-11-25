import { existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import type { Route } from '@playwright/test';

export const dist = resolve('dist/arturia/browser');

// Copy of the pilot hosting in arturia-api@d9cbf33 (infra/web-hosting.ts): contentSecurityPolicy(), the security
// headers of the ResponseHeadersPolicy as CloudFront emits them, IMMUTABLE_PATTERNS, CACHE_CONTROL and
// SPA_REWRITE_CODE. Update this file together with that module.

export interface PilotOrigins {
  readonly api: string;
  readonly cognito: string;
}

export function pilotContentSecurityPolicy(origins: PilotOrigins): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${origins.api} ${origins.cognito}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function pilotSecurityHeaders(origins: PilotOrigins): Record<string, string> {
  return {
    'content-security-policy': pilotContentSecurityPolicy(origins),
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  };
}

const cacheControl = {
  immutable: 'public, max-age=31536000, immutable',
  revalidate: 'no-cache',
  config: 'no-store',
};

/** Viewer-request decision of the CloudFront Function: extensionless paths serve index.html. */
export function spaRewrite(uri: string): string {
  if (uri === '/config.json') return uri;
  const last = uri.substring(uri.lastIndexOf('/') + 1);
  return last.indexOf('.') === -1 ? '/index.html' : uri;
}

function immutable(key: string): boolean {
  return key.startsWith('media/') || /\.(js|css)$/.test(key);
}

/** Serves dist/ like S3 behind CloudFront: rewrite, cache class per file and 403 for a missing object. */
export function fulfillFromDist(route: Route, pathname: string, headers: Record<string, string>): Promise<void> {
  const uri = spaRewrite(pathname);
  const file = join(dist, uri);
  if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) {
    return route.fulfill({
      status: 403,
      contentType: 'application/xml',
      body: '<Error><Code>AccessDenied</Code></Error>',
      headers,
    });
  }
  const key = uri.slice(1);
  return route.fulfill({
    path: file,
    headers: { ...headers, 'cache-control': immutable(key) ? cacheControl.immutable : cacheControl.revalidate },
  });
}

/** config.json behavior: no rewrite, application/json and never cached. */
export function fulfillConfig(route: Route, config: unknown, headers: Record<string, string>): Promise<void> {
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(config),
    headers: { ...headers, 'cache-control': cacheControl.config },
  });
}
