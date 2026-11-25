// Retry timing after HTTP 429, derived from the pilot's API Gateway throttles (copied from the API's
// infra/chat-api.ts and the stream reader; update together). Limits apply per method to every client.
//   SSE GET:      1 rps, burst 4. A connection lasts up to the reader's 24 s window.
//   Snapshot GET: stage default, 10 rps, burst 20.

export interface BackoffPolicy {
  readonly baseMs: number;
  readonly capMs: number;
}

/** First step refills one SSE token (1 / rate); the cap refills a whole burst (burst / rate). */
export const SSE_THROTTLE_BACKOFF: BackoffPolicy = { baseMs: 1_000, capMs: 4_000 };

/**
 * One SSE window. If no connection brings a block while a whole stream would have lasted, the
 * snapshot gives the same result. It fits at most eight requests (seven retries at 1, 3, 7, 11, 15,
 * 19 and 23 s), and from the third retry on a client uses at most a quarter of the refill rate.
 */
export const SSE_RECOVERY_BUDGET_MS = 24_000;

/** Doubles the 750 ms polling interval, capped at the snapshot burst refill time (20 / 10 rps). */
export const POLL_THROTTLE_BACKOFF: BackoffPolicy = { baseMs: 1_500, capMs: 2_000 };

/** Attempt is 1-based. Jitter adds up to half the step so tabs drift apart without retrying early. */
export function throttleDelay(
  attempt: number,
  policy: BackoffPolicy,
  random: () => number = Math.random,
): number {
  const step = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(step * (1 + 0.5 * Math.min(Math.max(random(), 0), 1)));
}
