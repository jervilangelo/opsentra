import type { RecoveryStage } from '@/domain/incident-machine';
import type { Incident, RemediationRequest } from '@/types/domain';

export type StageStatus = 'done' | 'current' | 'failed' | 'todo';

export interface RecoveryStatus {
  stages: Record<RecoveryStage, StageStatus>;
  summary: string;
}

/** Maps a remediation request plus incident state to the §2.3 progress stages. */
export function recoveryStatus(req: RemediationRequest, incident: Incident): RecoveryStatus {
  const s: Record<RecoveryStage, StageStatus> = {
    requested: 'done',
    authorized: 'todo',
    executing: 'todo',
    verifying: 'todo',
    outcome: 'todo',
  };
  let summary: string;
  switch (req.status) {
    case 'PENDING':
      s.authorized = 'current';
      summary = 'Waiting for Administrator approval.';
      break;
    case 'REJECTED':
      s.authorized = 'failed';
      summary =
        req.errorSummary === 'Approval expired'
          ? 'Approval expired. Nothing ran.'
          : 'Rejected. Nothing ran.';
      break;
    case 'APPROVED':
    case 'RUNNING':
      s.authorized = 'done';
      s.executing = 'current';
      summary = 'Runbook executing on the allowlisted resource.';
      break;
    case 'FAILED':
      s.authorized = 'done';
      s.executing = 'failed';
      summary = `Runbook failed${req.errorSummary ? `: ${req.errorSummary}` : ''}. Incident escalated.`;
      break;
    case 'SUCCEEDED':
      s.authorized = 'done';
      s.executing = 'done';
      if (incident.state === 'VERIFYING') {
        s.verifying = 'current';
        summary = 'Runbook reported success. Verifying service health.';
      } else if (incident.verifiedHealthyAt) {
        s.verifying = 'done';
        s.outcome = 'done';
        summary = 'Recovery verified by independent health checks.';
      } else {
        s.verifying = 'failed';
        summary = 'Runbook reported success, but health checks failed. Incident escalated.';
      }
      break;
  }
  return { stages: s, summary };
}
