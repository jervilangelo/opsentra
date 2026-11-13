import { Download, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { incidentLinks, dashboardUrl } from '@/features/observability/links';
import { useMode } from '@/modes/mode-store';
import { useLiveMe } from '@/modes/session';
import type { Incident, RemediationRequest, TimelineEvent } from '@/types/domain';

import { download, incidentCsv, incidentReport, reportFileName } from './report';

export function ExportButtons({
  onJson,
  onCsv,
  disabled,
}: {
  onJson: () => void;
  onCsv: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={onJson} disabled={disabled}>
        <Download aria-hidden="true" />
        Export JSON
      </Button>
      <Button variant="outline" size="sm" onClick={onCsv} disabled={disabled}>
        <Download aria-hidden="true" />
        Export CSV
      </Button>
    </div>
  );
}

/** Live only: CloudWatch links. Opens the AWS console, which needs its own sign-in. */
export function InvestigationLinks({
  incident,
}: {
  incident?: Pick<Incident, 'id' | 'alarmName'>;
}) {
  const mode = useMode();
  const me = useLiveMe();
  if (mode !== 'live' || !me.data) return null;
  const env = me.data.data.environment;
  const links = incident
    ? incidentLinks(env, incident.id, incident.alarmName)
    : [{ label: 'Operations dashboard', href: dashboardUrl(env) }];
  return (
    <section aria-label="Investigate in CloudWatch" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Investigate in CloudWatch</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
            >
              {l.label}
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">(opens the AWS console in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Opens the AWS console in ap-southeast-1; you need your own AWS sign-in. Log searches match
        the incident ID in structured log lines.
      </p>
    </section>
  );
}

export function IncidentReportCard({
  incident,
  events,
  requests,
  generatedAt,
}: {
  incident: Incident;
  events: TimelineEvent[];
  requests: RemediationRequest[];
  generatedAt: string;
}) {
  const mode = useMode();
  const build = () => incidentReport(mode, incident, events, requests, generatedAt);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Report</CardTitle>
        <CardDescription>
          Sanitized export of this incident: facts, measured durations, recovery requests and the
          full timeline. No account IDs, ARNs or tokens.
          {mode === 'demo' ? ' Demo exports are labelled DEMO — SYNTHETIC DATA.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ExportButtons
          onJson={() =>
            download(
              reportFileName(mode, incident.id, 'json'),
              'application/json',
              JSON.stringify(build(), null, 2),
            )
          }
          onCsv={() =>
            download(reportFileName(mode, incident.id, 'csv'), 'text/csv', incidentCsv(build()))
          }
        />
        <InvestigationLinks incident={incident} />
      </CardContent>
    </Card>
  );
}
