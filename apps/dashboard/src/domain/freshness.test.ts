import { isStale, STALE_AFTER_MS } from './freshness';

describe('isStale', () => {
  const now = Date.parse('2026-11-12T06:00:00Z');

  it('flags checks older than three minutes', () => {
    expect(isStale(new Date(now - STALE_AFTER_MS - 1).toISOString(), now)).toBe(true);
    expect(isStale(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });

  it('treats a missing check as not stale (shown as no evidence instead)', () => {
    expect(isStale(undefined, now)).toBe(false);
  });

  it('treats an unreadable time as stale', () => {
    expect(isStale('not-a-date', now)).toBe(true);
  });
});
