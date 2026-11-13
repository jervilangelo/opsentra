import {
  HEALTH_DISPLAY,
  INCIDENT_STATE_DISPLAY,
  LAB_RUN_DISPLAY,
  RUNBOOK_STATE_DISPLAY,
  SEVERITY_DISPLAY,
  SEVERITY_TONE,
} from '@/types/display';
import type { Health, IncidentState, LabRunStatus, RunbookState, Severity } from '@/types/domain';

import { StatusBadge } from './StatusBadge';

export function HealthBadge({ health }: { health: Health }) {
  const { label, tone } = HEALTH_DISPLAY[health];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

/** Reads e.g. "SEV-1 · Critical" (ADR-011). */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const { code, label } = SEVERITY_DISPLAY[severity];
  return (
    <StatusBadge tone={SEVERITY_TONE[severity]}>
      <span className="font-data">{code}</span> · {label}
    </StatusBadge>
  );
}

export function IncidentStateBadge({ state }: { state: IncidentState }) {
  const { label, tone } = INCIDENT_STATE_DISPLAY[state];
  return (
    <StatusBadge tone={tone} dot={tone === 'info'}>
      {label}
    </StatusBadge>
  );
}

export function RunbookStateBadge({ state }: { state: RunbookState }) {
  const { label, tone } = RUNBOOK_STATE_DISPLAY[state];
  return (
    <StatusBadge tone={tone} dot={tone === 'info'}>
      {label}
    </StatusBadge>
  );
}

export function LabRunBadge({ status }: { status: LabRunStatus }) {
  const { label, tone } = LAB_RUN_DISPLAY[status];
  return (
    <StatusBadge tone={tone} dot={tone === 'info'}>
      {label}
    </StatusBadge>
  );
}
