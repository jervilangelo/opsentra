import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { ApiRequestError } from '@/api/errors';
import { MonoId } from '@/components/data/MonoId';
import { Timestamp } from '@/components/data/Timestamp';
import { EmptyState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModeGuard } from '@/components/mode/ModeGuard';
import { IncidentStateBadge, RunbookStateBadge, SeverityBadge } from '@/components/status/badges';
import { StatusBadge } from '@/components/status/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { RecoveryProgress } from '@/features/recovery/RecoveryProgress';
import {
  useIncident,
  useRemediations,
  useResources,
  useRunbooks,
  useTimeline,
} from '@/modes/data-hooks';
import { useDemoSession } from '@/modes/demo/demo-store';
import { useMode } from '@/modes/mode-store';
import { useView } from '@/stores/preferences';
import { EasyIncident } from '@/features/easy/EasyIncident';
import { INCIDENT_STATE_DISPLAY } from '@/types/display';
import type { Incident, TimelineEvent } from '@/types/domain';

import { eventLabel, eventSummary, isSignal, signalPassed } from './event-format';
import { IncidentActions } from './IncidentActions';

function Facts({ incident }: { incident: Incident }) {
  const rows: [string, React.ReactNode][] = [
    ['Incident ID', <MonoId key="id">{incident.id}</MonoId>],
    ['Resource', <MonoId key="res">{incident.resourceId}</MonoId>],
    ['Correlation key', <MonoId key="corr">{incident.correlationKey}</MonoId>],
    ['Detected', <Timestamp key="det" value={incident.detectedAt} />],
    ['Opened', <Timestamp key="op" value={incident.openedAt} />],
    ['Acknowledged', <Timestamp key="ack" value={incident.acknowledgedAt} />],
    ['Health verified', <Timestamp key="ver" value={incident.verifiedHealthyAt} />],
    ['Resolved', <Timestamp key="res2" value={incident.resolvedAt} />],
    [
      'Version',
      <span key="v" className="font-data text-xs">
        {incident.version}
      </span>,
    ],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mb-1 min-w-0 sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Evidence({ events }: { events: TimelineEvent[] }) {
  const signals = events.filter(isSignal);
  if (signals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No signal evidence recorded for this incident.
      </p>
    );
  }
  return (
    <Table label="Signal evidence">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Time</TableHead>
          <TableHead scope="col">Signal</TableHead>
          <TableHead scope="col">Result</TableHead>
          <TableHead scope="col">Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {signals.map((e) => {
          const passed = signalPassed(e);
          return (
            <TableRow key={e.id}>
              <TableCell>
                <Timestamp value={e.occurredAt} />
              </TableCell>
              <TableCell className="font-data text-xs">{e.eventType}</TableCell>
              <TableCell>
                {passed === undefined ? (
                  <StatusBadge tone="unknown">Info</StatusBadge>
                ) : passed ? (
                  <StatusBadge tone="healthy">Pass</StatusBadge>
                ) : (
                  <StatusBadge tone="critical">Fail</StatusBadge>
                )}
              </TableCell>
              <TableCell className="text-xs whitespace-normal text-muted-foreground">
                {eventSummary(e) ?? '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <EmptyState title="No timeline events" />;
  return (
    <ol className="relative ml-2 border-l border-border">
      {events.map((e) => {
        const summary = eventSummary(e);
        return (
          <li key={e.id} className="ml-4 pb-4 last:pb-0">
            <span
              className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-[var(--card)] bg-border"
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{eventLabel(e.eventType)}</span>
              <Timestamp value={e.occurredAt} className="text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              {e.actorType === 'USER' ? `By ${e.actorId ?? 'unknown user'}` : 'System'}
              {summary ? ` · ${summary}` : ''}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function IncidentDetailContent({ incidentId }: { incidentId: string }) {
  const mode = useMode();
  const view = useView();
  const skip = useDemoSession((s) => s.nextStep);
  const incident = useIncident(incidentId);
  const timeline = useTimeline(incidentId);
  const remediations = useRemediations(incidentId);
  const runbooks = useRunbooks();
  const resources = useResources();

  if (incident.error instanceof ApiRequestError && incident.error.status === 404) {
    return (
      <EmptyState
        title="Incident not found"
        description={
          <>
            No incident with ID <MonoId>{incidentId}</MonoId> is available.
          </>
        }
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/incidents">Back to incidents</Link>
          </Button>
        }
      />
    );
  }

  return (
    <QueryBoundary query={incident} loadingLabel="Loading incident…">
      {({ data }) => {
        const resource = resources.data?.data.find((r) => r.id === data.resourceId);
        const environment = `${resource?.environment ?? 'lab'} · ${resource?.region ?? 'ap-southeast-1'}${mode === 'demo' ? ' (simulated)' : ''}`;
        const allowed = (runbooks.data?.data ?? []).filter((r) =>
          r.applicableResourceIds.includes(data.resourceId),
        );
        const requests = remediations.data?.data ?? [];
        const latest = requests[0];
        const pending = requests.find((r) => r.status === 'PENDING');
        const events = timeline.data?.data ?? [];

        if (view === 'easy') {
          return (
            <EasyIncident
              incident={data}
              resourceType={resource?.type}
              environment={environment}
              runbooks={allowed}
              latest={latest}
              pending={pending}
              events={events}
              now={incident.data?.meta.generatedAt}
              onSkip={mode === 'demo' ? skip : undefined}
            />
          );
        }

        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h2 className="text-xl">{data.title}</h2>
              <div className="flex flex-wrap gap-2">
                <SeverityBadge severity={data.severity} />
                <IncidentStateBadge state={data.state} />
              </div>
              {/* Announces state changes made by the system while the page is open. */}
              <p className="sr-only" role="status" aria-live="polite">
                Incident state: {INCIDENT_STATE_DISPLAY[data.state].label}
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Response</CardTitle>
                <CardDescription>
                  Actions available in the current state. Every action is audited.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <IncidentActions
                  incident={data}
                  environment={environment}
                  runbooks={allowed}
                  pendingRequest={pending}
                />
                {latest ? (
                  <div className="flex flex-col gap-2 border-t pt-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">Latest recovery request</span>
                      <MonoId className="text-muted-foreground">{latest.requestId}</MonoId>
                      <RunbookStateBadge state={latest.status} />
                    </div>
                    <RecoveryProgress request={latest} incident={data} />
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <Facts incident={data} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Evidence</CardTitle>
                  <CardDescription>
                    Signals that drove detection and verification. A root-cause hypothesis is not a
                    confirmed cause.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Evidence events={events} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <QueryBoundary query={timeline} loadingLabel="Loading timeline…">
                  {() => <Timeline events={events} />}
                </QueryBoundary>
              </CardContent>
            </Card>
          </div>
        );
      }}
    </QueryBoundary>
  );
}

export function IncidentDetailPage() {
  const { incidentId = '' } = useParams();
  const view = useView();
  return (
    <>
      <PageHeader
        title="Incident Detail"
        description={
          view === 'easy'
            ? 'Where this problem stands, and what to do next.'
            : 'Evidence, timeline and recovery for one incident.'
        }
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/incidents" className="no-underline">
              <ArrowLeft aria-hidden="true" />
              All incidents
            </Link>
          </Button>
        }
      />
      <ModeGuard>
        <IncidentDetailContent incidentId={incidentId} />
      </ModeGuard>
    </>
  );
}
