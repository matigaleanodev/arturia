import { describe, expect, it } from 'vitest';

import { parseRetryAfter } from './retry-after';

const now = Date.parse('2026-01-01T00:00:00Z');

describe('parseRetryAfter', () => {
  it.each([
    ['0', 0],
    ['3', 3_000],
    [' 7 ', 7_000],
    ['Thu, 01 Jan 2026 00:00:05 GMT', 5_000],
    ['Wed, 31 Dec 2025 23:59:00 GMT', 0],
    ['9'.repeat(20), Number.MAX_SAFE_INTEGER],
  ])('accepts %j as %i ms', (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });

  it.each([null, '', '-1', '1.5', '2s', 'soon', 'Thu, 01 Jan 2026', '2026-01-01T00:00:05Z'])(
    'rejects %j',
    (value) => {
      expect(parseRetryAfter(value, now)).toBeUndefined();
    },
  );
});
