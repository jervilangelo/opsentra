import { useId, useState } from 'react';

import { PageHeader } from '@/components/layout/PageHeader';
import { ModeGuard } from '@/components/mode/ModeGuard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDuration } from '@/domain/analytics';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { ExportButtons, InvestigationLinks } from '@/features/reports/ReportPanel';
import {
  analyticsCsv,
  analyticsReport,
  DEFINITIONS as REPORT_DEFINITIONS,
  download,
  reportFileName,
} from '@/features/reports/report';
import { useMode } from '@/modes/mode-store';
import { useAnalytics, useOverview } from '@/modes/data-hooks';
import { SEVERITY_DISPLAY } from '@/types/display';
import type { AnalyticsSummary, MeanDuration, Severity } from '@/types/domain';

const RANGES = [1, 7, 30, 90] as const;
const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-data text-3xl font-medium">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function meanNote(m: MeanDuration, excludedWhat: string): string {
  const parts = [`n = ${m.count}`];
  if (m.medianSeconds !== undefined) parts.push(`median ${formatDuration(m.medianSeconds)}`);
  if (m.p90Seconds !== undefined) parts.push(`p90 ${formatDuration(m.p90Seconds)}`);
  if (m.excluded > 0) parts.push(`${m.excluded} excluded (${excludedWhat})`);
  return parts.join(' · ');
}

function Availability({ data }: { data: AnalyticsSummary }) {
  const a = data.availability;
  if (!a) {
    return (
      <p>
        <span className="font-medium">Unknown.</span>{' '}
        <span className="text-muted-foreground">
          No probe data in this range, so there is no honest availability figure. It is not shown as
          0 % or 100 %.
        </span>
      </p>
    );
  }
  const pct = ((a.healthyProbes / a.totalProbes) * 100).toFixed(2);
  const coverage = a.expectedProbes ? (a.totalProbes / a.expectedProbes) * 100 : undefined;
  // With partial coverage the figure describes probed minutes only, not the range.
  const partial = coverage !== undefined && coverage < 90;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-data text-3xl">
        {pct} %
        {partial ? (
          <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
            of probed minutes only
          </span>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground">
        {a.healthyProbes} healthy of {a.totalProbes} probes received
        {coverage !== undefined
          ? ` · probes cover ${coverage < 1 ? coverage.toFixed(1) : Math.round(coverage)} % of the ${a.expectedProbes} minutes in range; the rest is unknown`
          : ''}
        . Nginx over HTTP, not EC2 running.
      </p>
    </div>
  );
}

function SeverityBars({ data }: { data: AnalyticsSummary }) {
  const max = Math.max(1, ...SEVERITIES.map((s) => data.bySeverity[s]));
  return (
    <ul className="flex flex-col gap-2" aria-label="Incidents by severity">
      {SEVERITIES.map((s) => {
        const n = data.bySeverity[s];
        const { code, label } = SEVERITY_DISPLAY[s];
        return (
          <li key={s} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3 text-sm">
            <span>
              <span className="font-data">{code}</span> · {label}
            </span>
            <span className="h-3 rounded-sm bg-muted" aria-hidden="true">
              {n > 0 ? (
                <span
                  className="block h-3 rounded-r-[4px] bg-primary"
                  style={{ width: `${(n / max) * 100}%` }}
                />
              ) : null}
            </span>
            <span className="text-right font-data">{n}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AnalyticsContent() {
  const mode = useMode();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const rangeId = useId();
  const overview = useOverview();
  // "Now" is the data source's own clock: the simulated clock in Demo.
  const to = overview.data?.meta.generatedAt;
  const from = to ? new Date(Date.parse(to) - days * 86_400_000).toISOString() : '';
  const analytics = useAnalytics(from, to ?? '');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={rangeId} className="text-sm font-medium">
          Time range
        </label>
        <select
          id={rangeId}
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as (typeof RANGES)[number])}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {RANGES.map((d) => (
            <option key={d} value={d}>
              {d === 1 ? 'Last 24 hours' : `Last ${d} days`}
            </option>
          ))}
        </select>
        {analytics.data ? (
          <>
            <Badge variant="outline" className="text-muted-foreground">
              Dataset: {analytics.data.meta.dataset}
            </Badge>
            <ExportButtons
              onJson={() => {
                const r = analyticsReport(
                  mode,
                  analytics.data.data,
                  analytics.data.meta.generatedAt,
                );
                download(
                  reportFileName(mode, `analytics-${days}d`, 'json'),
                  'application/json',
                  JSON.stringify(r, null, 2),
                );
              }}
              onCsv={() => {
                const r = analyticsReport(
                  mode,
                  analytics.data.data,
                  analytics.data.meta.generatedAt,
                );
                download(
                  reportFileName(mode, `analytics-${days}d`, 'csv'),
                  'text/csv',
                  analyticsCsv(r),
                );
              }}
            />
          </>
        ) : null}
      </div>

      {!to ? null : (
        <QueryBoundary query={analytics} loadingLabel="Calculating…">
          {({ data }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Tile
                  label="Incidents"
                  value={data.incidentCount}
                  note={`${data.active} active · ${data.escalated} escalated`}
                />
                <Tile
                  label="MTTA (mean time to acknowledge)"
                  value={
                    data.mtta.meanSeconds === undefined
                      ? '—'
                      : formatDuration(data.mtta.meanSeconds)
                  }
                  note={meanNote(data.mtta, 'not acknowledged')}
                />
                <Tile
                  label="MTTR (mean time to verified recovery)"
                  value={
                    data.mttr.meanSeconds === undefined
                      ? '—'
                      : formatDuration(data.mttr.meanSeconds)
                  }
                  note={meanNote(data.mttr, 'not yet verified healthy')}
                />
                <Tile
                  label="Runbook success"
                  value={
                    data.runbooks.total === 0
                      ? '—'
                      : `${data.runbooks.succeeded} / ${data.runbooks.total}`
                  }
                  note={`${data.runbooks.failed} failed · ${data.runbooks.rejected} rejected or expired · SSM success is not recovery`}
                />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Recovery outcomes</CardTitle>
                  <CardDescription>
                    How each verified recovery was proven, from its health-check evidence.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm">
                  {data.recoveries ? (
                    <ul className="flex flex-wrap gap-x-8 gap-y-2">
                      <li>
                        <span className="font-data text-2xl">{data.recoveries.afterRunbook}</span>{' '}
                        after an approved runbook
                      </li>
                      <li>
                        <span className="font-data text-2xl">{data.recoveries.selfHealed}</span>{' '}
                        self-healed (alarm cleared, then verified)
                      </li>
                      {data.recoveries.unknown > 0 ? (
                        <li>
                          <span className="font-data text-2xl">{data.recoveries.unknown}</span>{' '}
                          without recorded evidence type
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">
                      Not tracked in Demo Mode. Live Mode reads it from the HEALTH_VERIFIED evidence
                      of each incident.
                    </p>
                  )}
                </CardContent>
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Incidents by severity</CardTitle>
                    <CardDescription>Detected within the selected range.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SeverityBars data={data} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Availability</CardTitle>
                    <CardDescription>Healthy probes ÷ valid probes.</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <Availability data={data} />
                  </CardContent>
                </Card>
              </div>
              {data.dataQuality?.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Data quality</CardTitle>
                    <CardDescription>What these numbers do not include, and why.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                      {data.dataQuality.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
              <InvestigationLinks />
            </>
          )}
        </QueryBoundary>
      )}
    </div>
  );
}

/** Metric definitions from blueprint §4.5, shared with the exports. */
const DEFINITIONS = Object.entries(REPORT_DEFINITIONS).map(([term, text]) => ({ term, text }));

export function AnalyticsPage() {
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Incident frequency, severity, MTTA/MTTR and runbook outcomes, with their denominators."
      />
      <div className="flex flex-col gap-6">
        <ModeGuard>
          <AnalyticsContent />
        </ModeGuard>
        <Card>
          <CardHeader>
            <CardTitle>Definitions</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              {DEFINITIONS.map((d) => (
                <div key={d.term}>
                  <dt className="font-data text-sm font-medium">{d.term}</dt>
                  <dd className="text-sm text-muted-foreground">{d.text}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
