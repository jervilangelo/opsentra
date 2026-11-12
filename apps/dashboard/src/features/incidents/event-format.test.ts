import { describe, expect, it } from 'vitest';

import type { TimelineEvent } from '@/types/domain';

import { eventSummary } from './event-format';

const ev = (detail: Record<string, unknown>): TimelineEvent => ({
  id: 'e1',
  incidentId: 'INC-1',
  occurredAt: '2026-11-12T07:39:15Z',
  eventType: 'ALARM_REPEATED',
  actorType: 'SYSTEM',
  detail,
});

describe('eventSummary', () => {
  it('shows a full transition when both states are known', () => {
    expect(eventSummary(ev({ alarm: 'a', from: 'OK', to: 'ALARM' }))).toBe('a: OK → ALARM');
  });

  it('shows only the new state when the old one is unknown', () => {
    expect(eventSummary(ev({ alarm: 'a', to: 'OK' }))).toBe('a → OK');
  });

  it('never renders an empty arrow for a repeated or delayed signal', () => {
    const s = eventSummary(
      ev({ alarm: 'a', deduplicated: true, delayed: true, source: 'eventbridge' }),
    );
    expect(s).toBe(
      'a · eventbridge · Repeat signal, deduplicated · Delivered late, older than the latest signal',
    );
    expect(s).not.toContain('→');
  });
});
