import type { TimelineEvent } from '@/types/domain';

/** "INCIDENT_ACKNOWLEDGED" → "Incident acknowledged". */
export function eventLabel(eventType: string): string {
  const words = eventType.toLowerCase().split('_');
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Short, human-readable summary of an event's detail. */
export function eventSummary(e: TimelineEvent): string | undefined {
  const d = e.detail;
  const parts: string[] = [];
  const str = (k: string) =>
    typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : undefined;
  if (str('reason')) parts.push(`Reason: ${str('reason')}`);
  const alarm = str('alarm');
  if (alarm) {
    const from = str('from');
    const to = str('to');
    if (from && to) parts.push(`${alarm}: ${from} → ${to}`);
    else if (to) parts.push(`${alarm} → ${to}`);
    else parts.push(alarm);
  }
  if (str('check')) parts.push(String(str('check')));
  if (str('result')) parts.push(String(str('result')));
  if (str('statusCode')) parts.push(`HTTP ${str('statusCode')}`);
  if (str('latencyMs')) parts.push(`${str('latencyMs')} ms`);
  if (str('metric')) parts.push(`${str('metric')} = ${str('value')} per ${str('periodSec')}s`);
  if (str('source')) parts.push(String(str('source')));
  if (str('rule')) parts.push(String(str('rule')));
  if (typeof d.ruleFound === 'boolean')
    parts.push(d.ruleFound ? 'Rule still present' : 'Rule absent');
  if (str('runbookId')) parts.push(`Runbook ${str('runbookId')}`);
  if (str('executionId')) parts.push(`Execution ${str('executionId')}`);
  if (str('channel')) parts.push(String(str('channel')));
  if (str('note')) parts.push(String(str('note')));
  if (str('error')) parts.push(String(str('error')));
  if (str('consecutiveHealthyChecks'))
    parts.push(`${str('consecutiveHealthyChecks')} consecutive healthy checks`);
  if (d.deduplicated === true) parts.push('Repeat signal, deduplicated');
  if (d.delayed === true) parts.push('Delivered late, older than the latest signal');
  return parts.length ? parts.join(' · ') : undefined;
}

const SIGNAL_PREFIXES = [
  'HEALTH_PROBE',
  'METRIC_',
  'CONFIG_CHANGE',
  'RECONCILIATION',
  'ALARM_STATE',
];

export function isSignal(e: TimelineEvent): boolean {
  return SIGNAL_PREFIXES.some((p) => e.eventType.startsWith(p));
}

export function signalPassed(e: TimelineEvent): boolean | undefined {
  if (/(PASSED|_OK)$/.test(e.eventType)) return true;
  if (/(FAILED|BREACHING|DETECTED)$/.test(e.eventType)) return false;
  if (e.eventType === 'ALARM_STATE_CHANGED') return e.detail.to !== 'ALARM';
  return undefined;
}
