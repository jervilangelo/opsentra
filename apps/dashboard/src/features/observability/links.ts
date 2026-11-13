/**
 * CloudWatch console deep links for engineering investigation (Phase 8,
 * ADR-019). Console URLs need only the region: no account ID appears in them.
 * Resource names follow the Terraform naming `opsentra-<environment>-…`, with
 * the environment taken from GET /v1/me.
 */

export const REGION = 'ap-southeast-1';
const BASE = `https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}`;

/** The console's fragment encoding: encodeURIComponent twice, then % → $. */
function consoleEncode(text: string): string {
  return encodeURIComponent(encodeURIComponent(text)).replace(/%/g, '$');
}

export function dashboardUrl(environment: string): string {
  return `${BASE}#dashboards/dashboard/opsentra-${environment}-operations`;
}

export function alarmUrl(alarmName: string): string {
  return `${BASE}#alarmsV2:alarm/${encodeURIComponent(alarmName)}`;
}

/** A log group's events filtered to one quoted term, e.g. an incident ID. */
export function logSearchUrl(logGroup: string, term: string): string {
  return `${BASE}#logsV2:log-groups/log-group/${consoleEncode(logGroup)}/log-events${consoleEncode('?filterPattern=')}${consoleEncode(`"${term}"`)}`;
}

export interface InvestigationLink {
  label: string;
  href: string;
}

/** Log groups that carry an incident's ID in structured log lines. */
export function incidentLinks(
  environment: string,
  incidentId: string,
  alarmName?: string,
): InvestigationLink[] {
  const p = `opsentra-${environment}`;
  const groups: [string, string][] = [
    ['Ingest logs', `/aws/lambda/${p}-incident-ingest`],
    ['Reconciler logs', `/aws/lambda/${p}-incident-reconciler`],
    ['Coordinator logs', `/aws/lambda/${p}-remediation-coordinator`],
    ['API logs', `/aws/lambda/${p}-api`],
  ];
  return [
    ...(alarmName ? [{ label: `Alarm ${alarmName}`, href: alarmUrl(alarmName) }] : []),
    ...groups.map(([label, group]) => ({ label, href: logSearchUrl(group, incidentId) })),
    { label: 'Operations dashboard', href: dashboardUrl(environment) },
  ];
}
