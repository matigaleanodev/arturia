import type { AuthSession } from '../auth/auth-session';

/**
 * Ends the local session after a 401, saying why.
 *
 * API Gateway rejects an expired or invalid token before any Lambda runs and answers without the public
 * error body. The Lambda answers `UNAUTHENTICATED` with that body when the token is valid but resolves to
 * no active account: not provisioned, revoked, or issued before the account was activated. Only the code is
 * read; the message and the request ID never leave this function.
 */
export async function endSessionAfterUnauthorized(
  response: Response,
  auth: AuthSession,
  token: string,
): Promise<void> {
  const reason = await isAccountRejection(response) ? 'denied' : 'expired';
  // A newer session must survive a late 401 for an older token.
  if (auth.accessToken() === token) auth.clear(reason);
}

async function isAccountRejection(response: Response): Promise<boolean> {
  try {
    const body: unknown = JSON.parse(await response.text());
    return typeof body === 'object' && body !== null && 'code' in body && body.code === 'UNAUTHENTICATED';
  } catch {
    return false;
  }
}
