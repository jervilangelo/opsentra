import type { ResourceSummary, Runbook, Severity } from '@/types/domain';

/**
 * Static synthetic catalogue for the fictional HarborPoint sandbox: resources,
 * allowlisted runbooks and scenario definitions. IDs contain "demo" so they can
 * never be mistaken for real AWS IDs. No ARNs, account IDs or URLs.
 */

export const DEMO_REGION = 'ap-southeast-1';

/** The simulated clock starts here after every reset. */
export const DEMO_EPOCH = '2026-11-10T03:20:00Z';

export const RES = {
  web: 'i-0demo7c1a2e9b4f01',
  fn: 'demo-ticketing-api-fn',
  api: 'demo-ticketing-http-api',
  table: 'demo-ticketing-table',
  docs: 'demo-harborpoint-documents',
  sg: 'sg-0demo4b8e1f2a7c93',
} as const;

export const BASELINE_RESOURCES: readonly ResourceSummary[] = [
  {
    id: RES.web,
    type: 'EC2',
    environment: 'lab',
    region: DEMO_REGION,
    health: 'HEALTHY',
    lastCheckedAt: '2026-11-10T03:19:30Z',
    evidenceAvailable: true,
  },
  {
    id: RES.fn,
    type: 'LAMBDA',
    environment: 'lab',
    region: DEMO_REGION,
    health: 'HEALTHY',
    lastCheckedAt: '2026-11-10T03:19:00Z',
    evidenceAvailable: true,
  },
  {
    id: RES.api,
    type: 'APIGW',
    environment: 'lab',
    region: DEMO_REGION,
    health: 'HEALTHY',
    lastCheckedAt: '2026-11-10T03:19:00Z',
    evidenceAvailable: true,
  },
  {
    id: RES.table,
    type: 'DYNAMODB',
    environment: 'lab',
    region: DEMO_REGION,
    health: 'HEALTHY',
    lastCheckedAt: '2026-11-10T03:18:00Z',
    evidenceAvailable: true,
  },
  {
    id: RES.docs,
    type: 'S3',
    environment: 'lab',
    region: DEMO_REGION,
    health: 'UNKNOWN',
    evidenceAvailable: false,
  },
  {
    id: RES.sg,
    type: 'SECURITY_GROUP',
    environment: 'lab',
    region: DEMO_REGION,
    health: 'HEALTHY',
    lastCheckedAt: '2026-11-10T03:15:00Z',
    evidenceAvailable: true,
  },
];

export const RUNBOOKS: readonly Runbook[] = [
  {
    id: 'rb-restart-nginx',
    version: 3,
    title: 'Restart Nginx',
    description: 'Restarts the Nginx service on the lab web server through a fixed SSM document.',
    actionKey: 'Opsentra-Lab-RestartNginx',
    applicableResourceIds: [RES.web],
    requiresApproval: true,
  },
  {
    id: 'rb-lambda-alias-rollback',
    version: 2,
    title: 'Roll back Lambda alias',
    description: 'Points the "live" alias back to the last known-good published version.',
    actionKey: 'Opsentra-Lab-RollbackLambdaAlias',
    applicableResourceIds: [RES.fn],
    requiresApproval: true,
  },
  {
    id: 'rb-revoke-injected-rule',
    version: 1,
    title: 'Remove injected ingress rule',
    description: 'Revokes only the exact rule ID injected by the lab. Never a broad revoke.',
    actionKey: 'Opsentra-Lab-RevokeInjectedRule',
    applicableResourceIds: [RES.sg],
    requiresApproval: true,
  },
];

export interface SignalSpec {
  eventType: string;
  detail: (n: number) => Record<string, unknown>;
}

export interface ScenarioDef {
  id: string;
  group: 'A' | 'B' | 'C';
  title: string;
  summary: string;
  expectedOutcome: string;
  resourceId: string;
  runbookId: string;
  severity: Severity;
  incidentTitle: string;
  alarmName: string;
  correlationSuffix: string;
  faultAction: string;
  detection: {
    firstDelaySec: number;
    intervalSec: number;
    failuresToAlarm: number;
    ingestDelaySec: number;
    signal: SignalSpec;
  };
  execution: { durationSec: number; succeeds: boolean };
  verification: {
    intervalSec: number;
    required: number;
    recovers: boolean;
    pass: SignalSpec;
    fail: SignalSpec;
  };
}

const nginxProbeFail: SignalSpec = {
  eventType: 'HEALTH_PROBE_FAILED',
  detail: (n) => ({
    check: 'nginx /health',
    result: 'connection refused',
    timeoutMs: 2000,
    attempt: n,
  }),
};
const nginxProbePass: SignalSpec = {
  eventType: 'HEALTH_PROBE_PASSED',
  detail: (n) => ({ check: 'nginx /health', statusCode: 200, latencyMs: 36 + n * 3, attempt: n }),
};

function nginx(
  id: string,
  title: string,
  summary: string,
  expectedOutcome: string,
  execSucceeds: boolean,
  recovers: boolean,
): ScenarioDef {
  return {
    id,
    group: 'A',
    title,
    summary,
    expectedOutcome,
    resourceId: RES.web,
    runbookId: 'rb-restart-nginx',
    severity: 'HIGH',
    incidentTitle: 'Nginx health check failing on corporate web server',
    alarmName: 'demo-nginx-availability',
    correlationSuffix: 'nginx-availability',
    faultAction: 'Opsentra-Lab-StopNginx',
    detection: {
      firstDelaySec: 45,
      intervalSec: 60,
      failuresToAlarm: 3,
      ingestDelaySec: 7,
      signal: nginxProbeFail,
    },
    execution: { durationSec: 20, succeeds: execSucceeds },
    verification: {
      intervalSec: 30,
      required: 3,
      recovers,
      pass: nginxProbePass,
      fail: nginxProbeFail,
    },
  };
}

export const SCENARIOS: readonly ScenarioDef[] = [
  nginx(
    'nginx-outage',
    'Nginx outage, verified recovery',
    'Stop Nginx on the lab web server. Probes fail, the alarm fires and an incident opens.',
    'Restart succeeds and three consecutive health checks pass. The incident resolves.',
    true,
    true,
  ),
  nginx(
    'nginx-restart-fails',
    'Nginx outage, restart fails',
    'Same outage, but the SSM restart command fails.',
    'The runbook fails and the incident escalates. Nothing is marked recovered.',
    false,
    false,
  ),
  nginx(
    'nginx-stays-down',
    'Nginx outage, SSM success but still down',
    'Same outage. SSM reports Success, but Nginx does not come back.',
    'Verification fails, so the incident escalates. SSM Success alone is not recovery.',
    true,
    false,
  ),
  {
    id: 'lambda-regression',
    group: 'B',
    title: 'Lambda deployment regression',
    summary: 'A faulty version is deployed to the test alias and invocation errors rise.',
    expectedOutcome: 'Rolling the alias back to the known-good version clears the errors.',
    resourceId: RES.fn,
    runbookId: 'rb-lambda-alias-rollback',
    severity: 'MEDIUM',
    incidentTitle: 'Ticketing API Lambda errors after release',
    alarmName: 'demo-ticketing-lambda-errors',
    correlationSuffix: 'lambda-errors',
    faultAction: 'Opsentra-Lab-DeployFaultyVersion',
    detection: {
      firstDelaySec: 30,
      intervalSec: 60,
      failuresToAlarm: 2,
      ingestDelaySec: 6,
      signal: {
        eventType: 'METRIC_BREACHING',
        detail: (n) => ({ metric: 'Errors', periodSec: 60, value: 11 + n * 3, threshold: 5 }),
      },
    },
    execution: { durationSec: 15, succeeds: true },
    verification: {
      intervalSec: 60,
      required: 3,
      recovers: true,
      pass: {
        eventType: 'METRIC_OK',
        detail: (n) => ({ metric: 'Errors', periodSec: 60, value: 0, invocations: 40 + n }),
      },
      fail: {
        eventType: 'METRIC_BREACHING',
        detail: (n) => ({ metric: 'Errors', periodSec: 60, value: 9 + n, threshold: 5 }),
      },
    },
  },
  {
    id: 'sg-exposure',
    group: 'C',
    title: 'Security group rule exposure',
    summary: 'A temporary SSH rule open to 0.0.0.0/0 is injected on the isolated test group.',
    expectedOutcome: 'Removing only the injected rule ID clears the finding on reconciliation.',
    resourceId: RES.sg,
    runbookId: 'rb-revoke-injected-rule',
    severity: 'CRITICAL',
    incidentTitle: 'SSH open to the internet on lab security group',
    alarmName: 'demo-sg-exposure',
    correlationSuffix: 'sg-ssh-exposure',
    faultAction: 'Opsentra-Lab-InjectTestIngressRule',
    detection: {
      firstDelaySec: 40,
      intervalSec: 120,
      failuresToAlarm: 1,
      ingestDelaySec: 5,
      signal: {
        eventType: 'CONFIG_CHANGE_DETECTED',
        detail: (n) => ({
          source: n === 1 ? 'CloudTrail AuthorizeSecurityGroupIngress' : 'Reconciliation',
          rule: 'tcp/22 from 0.0.0.0/0',
          ruleId: 'sgr-0demo91c2',
        }),
      },
    },
    execution: { durationSec: 10, succeeds: true },
    verification: {
      intervalSec: 30,
      required: 2,
      recovers: true,
      pass: {
        eventType: 'RECONCILIATION_PASSED',
        detail: (n) => ({ ruleId: 'sgr-0demo91c2', ruleFound: false, check: n }),
      },
      fail: {
        eventType: 'RECONCILIATION_FAILED',
        detail: (n) => ({ ruleId: 'sgr-0demo91c2', ruleFound: true, check: n }),
      },
    },
  },
];

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function runbookById(id: string): Runbook | undefined {
  return RUNBOOKS.find((r) => r.id === id);
}
