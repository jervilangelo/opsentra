import { useId, useState } from 'react';

import { MonoId } from '@/components/data/MonoId';
import { Timestamp } from '@/components/data/Timestamp';
import { EmptyState } from '@/components/feedback/states';
import { ModeGuard } from '@/components/mode/ModeGuard';
import { StatusBadge } from '@/components/status/StatusBadge';
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
import { eventLabel } from '@/features/incidents/event-format';
import { useAudit } from '@/modes/data-hooks';
import { useMode } from '@/modes/mode-store';
import type { AuditEvent } from '@/types/domain';

const OUTCOME_TONE = {
  SUCCESS: 'healthy',
  DENIED: 'critical',
  FAILED: 'critical',
  INFO: 'unknown',
} as const;

const OUTCOME_LABEL: Record<AuditEvent['outcome'], string> = {
  SUCCESS: 'Success',
  DENIED: 'Denied',
  FAILED: 'Failed',
  INFO: 'Info',
};

function AuditTable() {
  const audit = useAudit();
  const mode = useMode();
  const [filter, setFilter] = useState('');
  const filterId = useId();

  return (
    <QueryBoundary query={audit} loadingLabel="Loading audit events…">
      {({ data }) => {
        const q = filter.trim().toLowerCase();
        const rows = q
          ? data.filter((a) =>
              [a.targetId, a.correlationId, a.action, a.actorId ?? ''].some((v) =>
                v.toLowerCase().includes(q),
              ),
            )
          : data;
        return (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={filterId} className="text-sm font-medium">
                Filter
              </label>
              <input
                id={filterId}
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Incident, request, correlation ID, actor…"
                className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
              />
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {rows.length} of {data.length} events
              </span>
            </div>
            {rows.length === 0 ? (
              <EmptyState title="No matching audit events" />
            ) : (
              <Table label="Audit events">
                <TableCaption>
                  Append-only and newest first.
                  {/* Live records completed actions; auditing denied attempts is not built yet. */}
                  {mode === 'demo' ? ' Denied attempts are recorded too.' : ''}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Time</TableHead>
                    <TableHead scope="col">Action</TableHead>
                    <TableHead scope="col">Outcome</TableHead>
                    <TableHead scope="col">Target</TableHead>
                    <TableHead scope="col">State change</TableHead>
                    <TableHead scope="col">Actor</TableHead>
                    <TableHead scope="col">Correlation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 200).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Timestamp value={a.occurredAt} />
                      </TableCell>
                      <TableCell>{eventLabel(a.action)}</TableCell>
                      <TableCell>
                        <StatusBadge tone={OUTCOME_TONE[a.outcome]}>
                          {OUTCOME_LABEL[a.outcome]}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <MonoId>{a.targetId}</MonoId>
                      </TableCell>
                      <TableCell className="font-data text-xs">
                        {a.previousState || a.newState
                          ? `${a.previousState ?? '—'} → ${a.newState ?? '—'}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {a.actorType === 'USER' ? a.actorId : 'System'}
                      </TableCell>
                      <TableCell>
                        <MonoId className="text-muted-foreground">{a.correlationId}</MonoId>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}

export function AuditLog() {
  return (
    <ModeGuard>
      <AuditTable />
    </ModeGuard>
  );
}
