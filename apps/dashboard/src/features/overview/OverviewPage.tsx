import { Link } from 'react-router';

import { MonoId } from '@/components/data/MonoId';
import { Timestamp } from '@/components/data/Timestamp';
import { EmptyState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModeGuard } from '@/components/mode/ModeGuard';
import { HealthBadge, IncidentStateBadge, SeverityBadge } from '@/components/status/badges';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { incidentPath } from '@/features/navigation/nav';
import { DemoGuide } from '@/features/demo/DemoGuide';
import { eventLabel } from '@/features/incidents/event-format';
import { useAudit, useIncidents, useOverview } from '@/modes/data-hooks';
import { useMode } from '@/modes/mode-store';
import { useView } from '@/stores/preferences';
import { EasyOverview } from '@/features/easy/EasyOverview';
import { HEALTH_DISPLAY } from '@/types/display';
import type { Health } from '@/types/domain';

const HEALTH_ORDER: Health[] = ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN'];

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-data text-3xl font-medium">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function OverviewContent() {
  const mode = useMode();
  const overview = useOverview();
  const incidents = useIncidents();
  const audit = useAudit();

  return (
    <div className="flex flex-col gap-6">
      <QueryBoundary query={overview} loadingLabel="Loading overview…">
        {({ data }) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Monitored resources" value={data.monitoredResources} />
              <Stat
                label="Active incidents"
                value={data.activeIncidents}
                hint={`${data.activeBySeverity.CRITICAL} SEV-1 · ${data.activeBySeverity.HIGH} SEV-2`}
              />
              <Stat
                label="Healthy resources"
                value={`${data.healthCounts.HEALTHY} / ${data.monitoredResources}`}
              />
              <Stat
                label={mode === 'demo' ? 'Simulated time' : 'Last sync'}
                value={<Timestamp value={data.lastSyncAt} className="text-base" />}
              />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Resource health</CardTitle>
                <CardDescription>
                  Counts by health state. Unknown means no recent evidence.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-wrap gap-3">
                  {HEALTH_ORDER.map((h) => (
                    <li key={h} className="flex items-center gap-2">
                      <HealthBadge health={h} />
                      <span
                        className="font-data"
                        aria-label={`${HEALTH_DISPLAY[h].label}: ${data.healthCounts[h]}`}
                      >
                        {data.healthCounts[h]}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </>
        )}
      </QueryBoundary>

      <Card>
        <CardHeader>
          <CardTitle>Latest incidents</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryBoundary query={incidents} loadingLabel="Loading incidents…">
            {({ data }) =>
              data.length === 0 ? (
                <EmptyState title="No incidents" description="Nothing has been detected." />
              ) : (
                <ul className="divide-y">
                  {data.slice(0, 5).map((i) => (
                    <li
                      key={i.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <Link to={incidentPath(i.id)} className="font-medium">
                        {i.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                        <SeverityBadge severity={i.severity} />
                        <IncidentStateBadge state={i.state} />
                        <MonoId className="text-muted-foreground">{i.id}</MonoId>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryBoundary>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest events</CardTitle>
          <CardDescription>
            From the audit trail. Full history in Audit &amp; Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryBoundary query={audit} loadingLabel="Loading events…">
            {({ data }) => (
              <ul className="divide-y">
                {data.slice(0, 6).map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
                  >
                    <span className="font-medium">{eventLabel(a.action)}</span>
                    <MonoId className="text-muted-foreground">{a.targetId}</MonoId>
                    <Timestamp value={a.occurredAt} className="text-muted-foreground sm:ml-auto" />
                  </li>
                ))}
              </ul>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}

export function OverviewPage() {
  const mode = useMode();
  const view = useView();
  return (
    <>
      <PageHeader
        title="Overview"
        description={
          view === 'easy'
            ? 'Your systems in plain words, and what to do next.'
            : 'Current health, active incidents and the latest events across registered resources.'
        }
      />
      <ModeGuard>
        {view === 'easy' ? (
          <EasyOverview />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
            {mode === 'demo' ? <DemoGuide className="h-fit xl:order-last" /> : null}
            <OverviewContent />
          </div>
        )}
      </ModeGuard>
    </>
  );
}
