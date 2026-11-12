import { useId, useState } from 'react';
import { Link } from 'react-router';

import { MonoId } from '@/components/data/MonoId';
import { Timestamp } from '@/components/data/Timestamp';
import { EmptyState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModeGuard } from '@/components/mode/ModeGuard';
import { IncidentStateBadge, SeverityBadge } from '@/components/status/badges';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { incidentPath } from '@/features/navigation/nav';
import { useIncidents } from '@/modes/data-hooks';
import { useView } from '@/stores/preferences';
import { EasyIncidents } from '@/features/easy/EasyIncidents';
import { SEVERITY_DISPLAY } from '@/types/display';
import { ACTIVE_INCIDENT_STATES, type Incident, type Severity } from '@/types/domain';

type StatusFilter = 'all' | 'active' | 'escalated' | 'resolved';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All states' },
  { value: 'active', label: 'Active' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved or closed' },
];

function matchesStatus(i: Incident, f: StatusFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'active':
      return ACTIVE_INCIDENT_STATES.includes(i.state);
    case 'escalated':
      return i.state === 'ESCALATED';
    case 'resolved':
      return i.state === 'RESOLVED' || i.state === 'CLOSED';
  }
}

const controlClass = 'border-input bg-background h-9 rounded-md border px-2 text-sm';

function IncidentsContent() {
  const incidents = useIncidents();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const ids = { q: useId(), st: useId(), sev: useId() };

  return (
    <QueryBoundary query={incidents} loadingLabel="Loading incidents…">
      {({ data }) => {
        const q = query.trim().toLowerCase();
        const rows = data.filter(
          (i) =>
            matchesStatus(i, status) &&
            (severity === 'all' || i.severity === severity) &&
            (!q || [i.id, i.title, i.resourceId].some((v) => v.toLowerCase().includes(q))),
        );
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.q} className="text-xs font-medium">
                  Search
                </label>
                <input
                  id={ids.q}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ID, title or resource"
                  className={`${controlClass} w-64 max-w-full px-3`}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.st} className="text-xs font-medium">
                  State
                </label>
                <select
                  id={ids.st}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusFilter)}
                  className={controlClass}
                >
                  {STATUS_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.sev} className="text-xs font-medium">
                  Severity
                </label>
                <select
                  id={ids.sev}
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as Severity | 'all')}
                  className={controlClass}
                >
                  <option value="all">All severities</option>
                  {(Object.keys(SEVERITY_DISPLAY) as Severity[]).map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_DISPLAY[s].code} · {SEVERITY_DISPLAY[s].label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="pb-2 text-xs text-muted-foreground" aria-live="polite">
                {rows.length} of {data.length} incidents
              </p>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title={data.length === 0 ? 'No incidents' : 'No incidents match these filters'}
                description={data.length === 0 ? 'Nothing has been detected.' : undefined}
              />
            ) : (
              <Card>
                <CardContent className="pt-4">
                  <Table label="Incidents">
                    <TableCaption>Newest first.</TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Incident</TableHead>
                        <TableHead scope="col">Severity</TableHead>
                        <TableHead scope="col">State</TableHead>
                        <TableHead scope="col">Resource</TableHead>
                        <TableHead scope="col">Opened</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="whitespace-normal">
                            <div className="flex min-w-56 flex-col gap-0.5">
                              <Link to={incidentPath(i.id)} className="font-medium">
                                {i.title}
                              </Link>
                              <MonoId className="text-muted-foreground">{i.id}</MonoId>
                            </div>
                          </TableCell>
                          <TableCell>
                            <SeverityBadge severity={i.severity} />
                          </TableCell>
                          <TableCell>
                            <IncidentStateBadge state={i.state} />
                          </TableCell>
                          <TableCell>
                            <MonoId>{i.resourceId}</MonoId>
                          </TableCell>
                          <TableCell>
                            <Timestamp value={i.openedAt} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}

export function IncidentsPage() {
  const view = useView();
  return (
    <>
      <PageHeader
        title="Incidents"
        description={
          view === 'easy'
            ? 'Problems Opsentra found, and where each one stands.'
            : 'Detected incidents with severity, state and history.'
        }
      />
      <ModeGuard>{view === 'easy' ? <EasyIncidents /> : <IncidentsContent />}</ModeGuard>
    </>
  );
}
