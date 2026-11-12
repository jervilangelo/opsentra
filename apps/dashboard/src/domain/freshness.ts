/** A Live health check older than this is shown as stale (blueprint §2.2: no fake real-time). */
export const STALE_AFTER_MS = 3 * 60_000;

export function isStale(lastCheckedAt: string | undefined, nowMs: number): boolean {
  if (!lastCheckedAt) return false; // "no evidence yet" is shown separately
  const t = Date.parse(lastCheckedAt);
  return Number.isNaN(t) || nowMs - t > STALE_AFTER_MS;
}
