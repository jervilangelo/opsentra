/**
 * Shared frontend DTOs. Mirrors OPSENTRA_MASTER_BLUEPRINT.md §2.4 exactly,
 * plus the v1.2.0 additions recorded in docs/adr/ADR-011:
 *   - Incident.verifiedHealthyAt (needed for MTTR, §4.5)
 *   - RemediationRequest (mirrors the §4.3 `opsentra-remediations` table)
 *   - OverviewSummary (the §4.2 GET /v1/overview payload)
 * and the v1.3.0 additions recorded in docs/adr/ADR-012:
 *   - ResourceType 'SECURITY_GROUP' (Scenario C)
 *   - Runbook, AuditEvent, LabScenario, AnalyticsSummary (payloads of the
 *     §4.2 GET /v1/runbooks, /v1/audit, /v1/labs and /v1/analytics routes)
 *   - Mutation inputs for the §4.2 POST routes
 * Do not add parallel shapes. Change the blueprint first.
 */

export type Mode = 'demo' | 'live';

export type Health = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type IncidentState =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'INVESTIGATING'
  | 'AWAITING_APPROVAL'
  | 'REMEDIATING'
  | 'VERIFYING'
  | 'RESOLVED'
  | 'ESCALATED'
  | 'CLOSED';

export type RunbookState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type ResourceType = 'EC2' | 'LAMBDA' | 'APIGW' | 'DYNAMODB' | 'S3' | 'SECURITY_GROUP';

export type Environment = 'lab' | 'dev';

export interface ResourceSummary {
  id: string;
  arn?: string;
  type: ResourceType;
  environment: Environment;
  region: string;
  health: Health;
  lastCheckedAt?: string;
  evidenceAvailable: boolean;
}

export interface Incident {
  id: string;
  correlationKey: string;
  resourceId: string;
  title: string;
  severity: Severity;
  state: IncidentState;
  openedAt: string;
  detectedAt?: string;
  acknowledgedAt?: string;
  /** Set only after independent post-remediation health checks pass (v1.2.0). */
  verifiedHealthyAt?: string;
  resolvedAt?: string;
  version: number;
  runbookId?: string;
}

export interface TimelineEvent {
  id: string;
  incidentId: string;
  occurredAt: string;
  eventType: string;
  actorType: 'SYSTEM' | 'USER';
  actorId?: string;
  detail: Record<string, unknown>;
}

/** v1.2.0: mirrors the `opsentra-remediations` table (§4.3). */
export interface RemediationRequest {
  requestId: string;
  actionKey: string;
  incidentId: string;
  resourceId: string;
  requestedBy: string;
  approvedBy?: string;
  status: RunbookState;
  executionId?: string;
  expectedVersion: number;
  errorSummary?: string;
  requestedAt: string;
  decidedAt?: string;
  completedAt?: string;
  expiresAt: string;
}

/** v1.2.0: payload of GET /v1/overview (§4.2). */
export interface OverviewSummary {
  monitoredResources: number;
  healthCounts: Record<Health, number>;
  activeIncidents: number;
  activeBySeverity: Record<Severity, number>;
  lastSyncAt?: string;
}

/** Incident states that count as "active" (not yet terminal). */
export const ACTIVE_INCIDENT_STATES: readonly IncidentState[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'INVESTIGATING',
  'AWAITING_APPROVAL',
  'REMEDIATING',
  'VERIFYING',
  'ESCALATED',
];

/** Roles from trusted Cognito group claims (§5.2). */
export type Role = 'VIEWER' | 'OPERATOR' | 'ADMIN';

/** v1.3.0: an allowlisted, versioned runbook (GET /v1/runbooks). */
export interface Runbook {
  id: string;
  version: number;
  title: string;
  description: string;
  /** Fixed SSM document / action name. Never user-supplied. */
  actionKey: string;
  applicableResourceIds: string[];
  requiresApproval: true;
}

/** v1.3.0: one append-only audit record (GET /v1/audit, §4.3 opsentra-audit). */
export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorType: 'SYSTEM' | 'USER';
  actorId?: string;
  action: string;
  targetType: 'INCIDENT' | 'REMEDIATION' | 'LAB';
  targetId: string;
  correlationId: string;
  previousState?: string;
  newState?: string;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILED' | 'INFO';
  detail: Record<string, unknown>;
}

/** v1.3.0: an allowlisted lab scenario (GET /v1/labs). */
export interface LabScenario {
  id: string;
  /** Scenarios that share a group are variants of one demonstration. */
  group: 'A' | 'B' | 'C';
  title: string;
  summary: string;
  expectedOutcome: string;
  resourceId: string;
  runbookId: string;
  /** False while another scenario is active (one-active-scenario lock). */
  available: boolean;
  unavailableReason?: string;
}

export interface MeanDuration {
  /** Undefined when there are no qualifying incidents. Never shown as zero. */
  meanSeconds?: number;
  /** Incidents included in the mean (the denominator). */
  count: number;
  /** Incidents in range that were excluded, e.g. never acknowledged. */
  excluded: number;
}

/** v1.3.0: payload of GET /v1/analytics (§4.5 definitions). */
export interface AnalyticsSummary {
  from: string;
  to: string;
  incidentCount: number;
  bySeverity: Record<Severity, number>;
  active: number;
  escalated: number;
  mtta: MeanDuration;
  mttr: MeanDuration;
  runbooks: { succeeded: number; failed: number; rejected: number; total: number };
  /** Undefined when no probe data exists in range ("unknown", not 100 %). */
  availability?: { healthyProbes: number; totalProbes: number };
}

/** Every privileged mutation carries these (CLAUDE.md, §4.2). */
export interface MutationGuard {
  expectedVersion: number;
  idempotencyKey: string;
}

export interface AcknowledgeInput extends MutationGuard {
  reason: string;
}

export interface RemediationRequestInput extends MutationGuard {
  runbookId: string;
  reason: string;
}

export interface RemediationDecisionInput extends MutationGuard {
  decision: 'APPROVE' | 'REJECT';
  reason: string;
}

export interface StartLabInput {
  idempotencyKey: string;
}
