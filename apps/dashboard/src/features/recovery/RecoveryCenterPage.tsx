import { Link } from 'react-router';

import { MonoId } from '@/components/data/MonoId';
import { Timestamp } from '@/components/data/Timestamp';
import { EmptyState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModeGuard } from '@/components/mode/ModeGuard';
import { RunbookStateBadge } from '@/components/status/badges';
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
import { incidentPath } from '@/features/navigation/nav';
import { useRemediations, useRunbooks } from '@/modes/data-hooks';

function RunbookCatalog() {
  const runbooks = useRunbooks();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Runbook catalogue</CardTitle>
        <CardDescription>
          Fixed, versioned actions. Each runs only on the resources it is allowlisted for, and only
          after Administrator approval. There is no free-form command input.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryBoundary query={runbooks} loadingLabel="Loading runbooks…">
          {({ data }) => (
            <Table label="Runbook catalogue">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Runbook</TableHead>
                  <TableHead scope="col">Action</TableHead>
                  <TableHead scope="col">Allowlisted resources</TableHead>
                  <TableHead scope="col">Approval</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((rb) => (
                  <TableRow key={rb.id}>
                    <TableCell className="whitespace-normal">
                      <div className="flex min-w-48 flex-col">
                        <span className="font-medium">
                          {rb.title}{' '}
                          <span className="font-data text-xs text-muted-foreground">
                            v{rb.version}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">{rb.description}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <MonoId>{rb.actionKey}</MonoId>
                    </TableCell>
                    <TableCell>
                      {rb.applicableResourceIds.map((id) => (
                        <MonoId key={id} className="block">
                          {id}
                        </MonoId>
                      ))}
                    </TableCell>
                    <TableCell>Administrator</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

function RecoveryHistory() {
  const remediations = useRemediations();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery requests</CardTitle>
        <CardDescription>
          Newest first. “Succeeded” is the runbook result; recovery is confirmed separately by
          health checks on the incident.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryBoundary query={remediations} loadingLabel="Loading recovery requests…">
          {({ data }) =>
            data.length === 0 ? (
              <EmptyState title="No recovery requests yet" />
            ) : (
              <Table label="Recovery requests">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Request</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Action</TableHead>
                    <TableHead scope="col">Incident</TableHead>
                    <TableHead scope="col">Requested / approved by</TableHead>
                    <TableHead scope="col">Requested</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((r) => (
                    <TableRow key={r.requestId}>
                      <TableCell>
                        <MonoId>{r.requestId}</MonoId>
                      </TableCell>
                      <TableCell>
                        <RunbookStateBadge state={r.status} />
                      </TableCell>
                      <TableCell>
                        <MonoId>{r.actionKey}</MonoId>
                      </TableCell>
                      <TableCell>
                        <Link to={incidentPath(r.incidentId)}>
                          <MonoId>{r.incidentId}</MonoId>
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.requestedBy} / {r.approvedBy ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Timestamp value={r.requestedAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

export function RecoveryCenterPage() {
  return (
    <>
      <PageHeader
        title="Recovery Center"
        description="Allowlisted runbooks, their eligibility, and every recovery request."
      />
      <ModeGuard>
        <div className="flex flex-col gap-6">
          <RunbookCatalog />
          <RecoveryHistory />
        </div>
      </ModeGuard>
    </>
  );
}
