import { describe, expect, it } from 'vitest';

import {
  POLL_THROTTLE_BACKOFF,
  SSE_RECOVERY_BUDGET_MS,
  SSE_THROTTLE_BACKOFF,
  throttleDelay,
} from './throttle-backoff';

describe('throttleDelay', () => {
  it('derives the SSE schedule from the throttle: one token, doubling, capped at a full burst', () => {
    expect(SSE_THROTTLE_BACKOFF).toEqual({ baseMs: 1_000, capMs: 4_000 });
    expect(SSE_RECOVERY_BUDGET_MS).toBe(24_000);
    expect([1, 2, 3, 4, 9].map((attempt) => throttleDelay(attempt, SSE_THROTTLE_BACKOFF, () => 0)))
      .toEqual([1_000, 2_000, 4_000, 4_000, 4_000]);
  });

  it('adds up to half the step as jitter and never goes below the step', () => {
    expect(throttleDelay(1, SSE_THROTTLE_BACKOFF, () => 0.999)).toBe(1_500);
    expect(throttleDelay(5, SSE_THROTTLE_BACKOFF, () => 0.5)).toBe(5_000);
  });

  it('backs off snapshot polling up to the snapshot burst refill time', () => {
    expect([1, 2, 3].map((attempt) => throttleDelay(attempt, POLL_THROTTLE_BACKOFF, () => 0)))
      .toEqual([1_500, 2_000, 2_000]);
  });
});
