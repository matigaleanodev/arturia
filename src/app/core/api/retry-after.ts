/**
 * Milliseconds to wait from delta-seconds or an IMF-fixdate. Cross-origin, browsers expose the header
 * only when the API lists it in Access-Control-Expose-Headers.
 */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) {
    // Delta-seconds has no upper bound; saturate so callers treat it as longer than any budget.
    return Math.min(Number(text) * 1_000, Number.MAX_SAFE_INTEGER);
  }
  if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return undefined;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
