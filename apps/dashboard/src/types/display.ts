import type {
  Health,
  IncidentState,
  LabRunStatus,
  ResourceType,
  Role,
  RunbookState,
  Severity,
} from './domain';

/** Display-only mapping (ADR-011). The DTO keeps CRITICAL/HIGH/MEDIUM/LOW. */
export const SEVERITY_DISPLAY: Record<Severity, { code: string; label: string }> = {
  CRITICAL: { code: 'SEV-1', label: 'Critical' },
  HIGH: { code: 'SEV-2', label: 'High' },
  MEDIUM: { code: 'SEV-3', label: 'Medium' },
  LOW: { code: 'SEV-4', label: 'Low' },
};

export type StatusTone = 'healthy' | 'warning' | 'critical' | 'info' | 'unknown';

export const HEALTH_DISPLAY: Record<Health, { label: string; tone: StatusTone }> = {
  HEALTHY: { label: 'Healthy', tone: 'healthy' },
  DEGRADED: { label: 'Degraded', tone: 'warning' },
  UNHEALTHY: { label: 'Unhealthy', tone: 'critical' },
  UNKNOWN: { label: 'Unknown', tone: 'unknown' },
};

export const SEVERITY_TONE: Record<Severity, StatusTone> = {
  CRITICAL: 'critical',
  HIGH: 'critical',
  MEDIUM: 'warning',
  LOW: 'unknown',
};

export const INCIDENT_STATE_DISPLAY: Record<IncidentState, { label: string; tone: StatusTone }> = {
  OPEN: { label: 'Open', tone: 'critical' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'warning' },
  INVESTIGATING: { label: 'Investigating', tone: 'warning' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'warning' },
  REMEDIATING: { label: 'Remediating', tone: 'info' },
  VERIFYING: { label: 'Verifying', tone: 'info' },
  RESOLVED: { label: 'Resolved', tone: 'healthy' },
  ESCALATED: { label: 'Escalated', tone: 'critical' },
  CLOSED: { label: 'Closed', tone: 'unknown' },
};

export const RUNBOOK_STATE_DISPLAY: Record<RunbookState, { label: string; tone: StatusTone }> = {
  PENDING: { label: 'Pending approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'info' },
  REJECTED: { label: 'Rejected', tone: 'unknown' },
  RUNNING: { label: 'Running', tone: 'info' },
  SUCCEEDED: { label: 'Succeeded', tone: 'healthy' },
  FAILED: { label: 'Failed', tone: 'critical' },
};

export const LAB_RUN_DISPLAY: Record<LabRunStatus, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: 'Running', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'healthy' },
  RESET: { label: 'Reset', tone: 'unknown' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'critical' },
};

export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  EC2: 'EC2 instance',
  LAMBDA: 'Lambda function',
  APIGW: 'API Gateway',
  DYNAMODB: 'DynamoDB table',
  S3: 'S3 bucket',
  SECURITY_GROUP: 'Security group',
};

export const ROLE_LABEL: Record<Role, string> = {
  VIEWER: 'Viewer',
  OPERATOR: 'Operator',
  ADMIN: 'Administrator',
};
