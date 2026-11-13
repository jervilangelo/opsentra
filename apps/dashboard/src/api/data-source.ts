import type { ApiSuccess } from '@/types/api';
import type {
  AcknowledgeInput,
  AnalyticsSummary,
  AuditEvent,
  Incident,
  LabScenario,
  Mode,
  MutationGuard,
  OverviewSummary,
  RemediationDecisionInput,
  RemediationRequest,
  RemediationRequestInput,
  ResetLabInput,
  ResourceSummary,
  Runbook,
  StartLabInput,
  TimelineEvent,
} from '@/types/domain';

/**
 * The one interface every page reads and writes data through. Demo Mode and
 * Live AWS Mode each provide an implementation; pages never know which one they
 * got, and the two implementations never import each other (enforced by ESLint).
 *
 * Methods map to the blueprint §4.2 routes (v1.3.0, ADR-012). The caller's
 * identity and role are never parameters: they come from the trusted session
 * (Cognito claims in Live, the simulated role in Demo).
 */
export interface DataSource {
  readonly mode: Mode;

  /** GET /v1/overview */
  getOverview(): Promise<ApiSuccess<OverviewSummary>>;
  /** GET /v1/resources */
  listResources(): Promise<ApiSuccess<ResourceSummary[]>>;
  /** GET /v1/incidents */
  listIncidents(): Promise<ApiSuccess<Incident[]>>;
  /** GET /v1/incidents/{incidentId} */
  getIncident(incidentId: string): Promise<ApiSuccess<Incident>>;
  /** GET /v1/incidents/{incidentId}/timeline */
  getTimeline(incidentId: string): Promise<ApiSuccess<TimelineEvent[]>>;
  /** GET /v1/runbooks */
  listRunbooks(): Promise<ApiSuccess<Runbook[]>>;
  /** GET /v1/remediations[?incidentId=] (v1.3.0) */
  listRemediations(incidentId?: string): Promise<ApiSuccess<RemediationRequest[]>>;
  /** GET /v1/analytics?from&to */
  getAnalytics(range: { from: string; to: string }): Promise<ApiSuccess<AnalyticsSummary>>;
  /** GET /v1/audit (Admin) */
  listAudit(): Promise<ApiSuccess<AuditEvent[]>>;
  /** GET /v1/labs (Admin) */
  listLabs(): Promise<ApiSuccess<LabScenario[]>>;

  /** POST /v1/incidents/{incidentId}/acknowledge */
  acknowledgeIncident(incidentId: string, input: AcknowledgeInput): Promise<ApiSuccess<Incident>>;
  /** POST /v1/incidents/{incidentId}/investigate (v1.3.0) */
  investigateIncident(incidentId: string, input: MutationGuard): Promise<ApiSuccess<Incident>>;
  /** POST /v1/incidents/{incidentId}/request-remediation */
  requestRemediation(
    incidentId: string,
    input: RemediationRequestInput,
  ): Promise<ApiSuccess<RemediationRequest>>;
  /** POST /v1/remediations/{requestId}/decision (Admin) */
  decideRemediation(
    requestId: string,
    input: RemediationDecisionInput,
  ): Promise<ApiSuccess<RemediationRequest>>;
  /** POST /v1/incidents/{incidentId}/close (v1.3.0) */
  closeIncident(incidentId: string, input: MutationGuard): Promise<ApiSuccess<Incident>>;
  /** POST /v1/labs/{scenarioId}/start (Admin) */
  startLab(scenarioId: string, input: StartLabInput): Promise<ApiSuccess<LabScenario>>;
  /** POST /v1/labs/{scenarioId}/reset (Admin; v1.9.0, ADR-018) */
  resetLab(scenarioId: string, input: ResetLabInput): Promise<ApiSuccess<LabScenario>>;
}
