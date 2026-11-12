import { render, screen } from '@testing-library/react';

import {
  HEALTH_DISPLAY,
  INCIDENT_STATE_DISPLAY,
  RUNBOOK_STATE_DISPLAY,
  SEVERITY_DISPLAY,
} from '@/types/display';
import type { Health, IncidentState, RunbookState, Severity } from '@/types/domain';

import { HealthBadge, IncidentStateBadge, RunbookStateBadge, SeverityBadge } from './badges';

const healths = Object.keys(HEALTH_DISPLAY) as Health[];
const severities = Object.keys(SEVERITY_DISPLAY) as Severity[];
const states = Object.keys(INCIDENT_STATE_DISPLAY) as IncidentState[];
const runbookStates = Object.keys(RUNBOOK_STATE_DISPLAY) as RunbookState[];

describe('status badges never rely on colour alone', () => {
  it.each(healths)('HealthBadge %s shows a text label and an icon', (health) => {
    const { container } = render(<HealthBadge health={health} />);
    expect(screen.getByText(HEALTH_DISPLAY[health].label)).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it.each(states)('IncidentStateBadge %s shows a text label', (state) => {
    render(<IncidentStateBadge state={state} />);
    expect(screen.getByText(INCIDENT_STATE_DISPLAY[state].label)).toBeInTheDocument();
  });

  it.each(runbookStates)('RunbookStateBadge %s shows a text label', (state) => {
    render(<RunbookStateBadge state={state} />);
    expect(screen.getByText(RUNBOOK_STATE_DISPLAY[state].label)).toBeInTheDocument();
  });
});

describe('SeverityBadge', () => {
  it.each([
    ['CRITICAL', 'SEV-1 · Critical'],
    ['HIGH', 'SEV-2 · High'],
    ['MEDIUM', 'SEV-3 · Medium'],
    ['LOW', 'SEV-4 · Low'],
  ] as const)('%s reads "%s"', (severity, text) => {
    const { container } = render(<SeverityBadge severity={severity} />);
    expect(container.textContent).toBe(text);
  });

  it('covers every severity', () => {
    expect(severities).toHaveLength(4);
  });
});

describe('health tone mapping (ADR-011)', () => {
  it('maps DEGRADED to warning and UNKNOWN to the neutral tone', () => {
    expect(HEALTH_DISPLAY.DEGRADED.tone).toBe('warning');
    expect(HEALTH_DISPLAY.UNKNOWN.tone).toBe('unknown');
  });
});
