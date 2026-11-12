import { useId, useState } from 'react';

import { PageHeader } from '@/components/layout/PageHeader';
import { ModeGuard } from '@/components/mode/ModeGuard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDuration } from '@/domain/analytics';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { useAnalytics, useOverview } from '@/modes/data-hooks';
import { SEVERITY_DISPLAY } from '@/types/display';
import type { AnalyticsSummary, MeanDuration, Severity } from '@/types/domain';

const RANGES = [7, 30, 90] as const;
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
  const n = `n = ${m.count}`;
  return m.excluded > 0 ? `${n} · ${m.excluded} excluded (${excludedWhat})` : n;
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
              Last {d} days
            </option>
          ))}
        </select>
        {analytics.data ? (
          <Badge variant="outline" className="text-muted-foreground">
            Dataset: {analytics.data.meta.dataset}
          </Badge>
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
                  note={`${data.runbooks.failed} failed · ${data.runbooks.rejected} rejected or expired`}
                />
              </div>
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
                    {data.availability ? (
                      <p className="font-data text-3xl">
                        {(
                          (data.availability.healthyProbes / data.availability.totalProbes) *
                          100
                        ).toFixed(2)}{' '}
                        %
                      </p>
                    ) : (
                      <p>
                        <span className="font-medium">Unknown.</span>{' '}
                        <span className="text-muted-foreground">
                          Demo Mode does not simulate continuous probing, so there is no honest
                          availability figure to show.
                        </span>
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </QueryBoundary>
      )}
    </div>
  );
}

/** Metric definitions from blueprint §4.5. */
const DEFINITIONS = [
  {
    term: 'MTTA',
    text: 'Mean of acknowledgedAt − detectedAt for acknowledged incidents. Unacknowledged incidents are excluded and counted.',
  },
  {
    term: 'MTTR',
    text: 'Mean of verifiedHealthyAt − detectedAt for incidents whose recovery was verified by health checks. Runbook completion time is not used.',
  },
  {
    term: 'Availability',
    text: 'Healthy probes ÷ valid probes in the range. EC2 running is not the same as Nginx available.',
  },
];

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
