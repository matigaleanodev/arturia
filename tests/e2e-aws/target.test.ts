import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTarget, TargetError } from './target.ts';

const token = 'arturia-unit-canary-0123456789abcdef';
const valid = {
  ARTURIA_E2E_WEB_URL: 'https://d1a2b3c4d5e6f7.cloudfront.net/',
  ARTURIA_E2E_API_URL: 'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/prod/',
  ARTURIA_E2E_ACCESS_TOKEN: token,
};

function rejects(env: Record<string, string | undefined>, variable: string) {
  assert.throws(() => parseTarget(env), (error: unknown) => {
    if (!(error instanceof TargetError)) return false;
    assert.match(error.message, new RegExp(variable));
    assert.ok(!error.message.includes(token), 'the error must not contain the token');
    return true;
  });
}

test('accepts an explicit https pilot target', () => {
  const target = parseTarget(valid);
  assert.equal(target.webOrigin, 'https://d1a2b3c4d5e6f7.cloudfront.net');
  assert.equal(target.apiBaseUrl, 'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/prod/');
  assert.equal(target.apiOrigin, 'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com');
  assert.equal(target.scope, 'personal');
  assert.equal(target.loopback, false);
  assert.equal(target.accessToken, token);
});

test('normalizes a missing trailing slash in the API base URL', () => {
  assert.equal(parseTarget({ ...valid, ARTURIA_E2E_API_URL: valid.ARTURIA_E2E_API_URL.slice(0, -1) }).apiBaseUrl,
    valid.ARTURIA_E2E_API_URL);
});

test('refuses to run without an explicit target or token', () => {
  rejects({}, 'ARTURIA_E2E_WEB_URL');
  rejects({ ...valid, ARTURIA_E2E_WEB_URL: undefined }, 'ARTURIA_E2E_WEB_URL');
  rejects({ ...valid, ARTURIA_E2E_API_URL: '' }, 'ARTURIA_E2E_API_URL');
  rejects({ ...valid, ARTURIA_E2E_ACCESS_TOKEN: undefined }, 'ARTURIA_E2E_ACCESS_TOKEN');
});

test('rejects insecure or ambiguous URLs', () => {
  for (const url of [
    'http://d1a2b3c4d5e6f7.cloudfront.net/',
    'https://user:pass@d1a2b3c4d5e6f7.cloudfront.net/',
    'https://d1a2b3c4d5e6f7.cloudfront.net/?x=1',
    'https://d1a2b3c4d5e6f7.cloudfront.net/#x',
    'https://d1a2b3c4d5e6f7.cloudfront.net/chat',
    'not a url',
  ]) rejects({ ...valid, ARTURIA_E2E_WEB_URL: url }, 'ARTURIA_E2E_WEB_URL');
  for (const url of [
    'http://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/prod/',
    'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/prod/?stage=x',
    'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/prod/../other/',
    'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/prod/..\\x/',
  ]) rejects({ ...valid, ARTURIA_E2E_API_URL: url }, 'ARTURIA_E2E_API_URL');
});

test('rejects malformed tokens without echoing them', () => {
  for (const value of ['short', `${token} with spaces`, `${token}\n`, 'x'.repeat(9000)]) {
    assert.throws(() => parseTarget({ ...valid, ARTURIA_E2E_ACCESS_TOKEN: value }), (error: unknown) => {
      if (!(error instanceof TargetError)) return false;
      assert.match(error.message, /ARTURIA_E2E_ACCESS_TOKEN/);
      assert.ok(!error.message.includes(value.trim()));
      return true;
    });
  }
});

test('rejects an API that shares the distribution origin', () => {
  rejects({ ...valid, ARTURIA_E2E_API_URL: 'https://d1a2b3c4d5e6f7.cloudfront.net/api/' }, 'origin');
});

test('accepts only the known scopes', () => {
  assert.equal(parseTarget({ ...valid, ARTURIA_E2E_SCOPE: 'work' }).scope, 'work');
  rejects({ ...valid, ARTURIA_E2E_SCOPE: 'other' }, 'ARTURIA_E2E_SCOPE');
});

test('loopback is a rehearsal target only when both origins are loopback', () => {
  const local = {
    ...valid,
    ARTURIA_E2E_WEB_URL: 'https://127.0.0.1:4443/',
    ARTURIA_E2E_API_URL: 'https://127.0.0.1:4444/prod/',
  };
  assert.equal(parseTarget(local).loopback, true);
  rejects({ ...local, ARTURIA_E2E_API_URL: valid.ARTURIA_E2E_API_URL }, 'loopback');
  rejects({ ...local, ARTURIA_E2E_WEB_URL: valid.ARTURIA_E2E_WEB_URL }, 'loopback');
  rejects({ ...local, ARTURIA_E2E_WEB_URL: 'https://localhost:4443/' }, 'ARTURIA_E2E_WEB_URL');
});
