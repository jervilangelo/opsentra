import { useId, useState } from 'react';

import { MonoId } from '@/components/data/MonoId';
import { Timestamp } from '@/components/data/Timestamp';
import { EmptyState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModeGuard } from '@/components/mode/ModeGuard';
import { HealthBadge } from '@/components/status/badges';
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
import { useResources } from '@/modes/data-hooks';
import { HEALTH_DISPLAY, RESOURCE_TYPE_LABEL } from '@/types/display';
import type { Health } from '@/types/domain';

const HEALTH_FILTERS: (Health | 'all')[] = ['all', 'HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN'];

function InfrastructureContent() {
  const resources = useResources();
  const [health, setHealth] = useState<Health | 'all'>('all');
  const filterId = useId();
  return (
    <QueryBoundary query={resources} loadingLabel="Loading resources…">
      {({ data: all }) => {
        const data = all
          .filter((r) => health === 'all' || r.health === health)
          .sort((a, b) => RESOURCE_TYPE_LABEL[a.type].localeCompare(RESOURCE_TYPE_LABEL[b.type]));
        return all.length === 0 ? (
          <EmptyState
            title="No registered resources"
            description="Only allowlisted resources are monitored."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor={filterId} className="text-sm font-medium">
                Health
              </label>
              <select
                id={filterId}
                value={health}
                onChange={(e) => setHealth(e.target.value as Health | 'all')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {HEALTH_FILTERS.map((h) => (
                  <option key={h} value={h}>
                    {h === 'all' ? 'All' : HEALTH_DISPLAY[h].label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {data.length} of {all.length} resources
              </span>
            </div>
            <Card>
              <CardContent className="pt-4">
                <Table label="Registered resources">
                  <TableCaption>
                    Allowlisted resources only, grouped by type. Unknown means no recent evidence.
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Resource</TableHead>
                      <TableHead scope="col">Type</TableHead>
                      <TableHead scope="col">Health</TableHead>
                      <TableHead scope="col">Environment</TableHead>
                      <TableHead scope="col">Region</TableHead>
                      <TableHead scope="col">Last checked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <MonoId>{r.id}</MonoId>
                        </TableCell>
                        <TableCell>{RESOURCE_TYPE_LABEL[r.type]}</TableCell>
                        <TableCell>
                          <HealthBadge health={r.health} />
                        </TableCell>
                        <TableCell>{r.environment}</TableCell>
                        <TableCell>
                          <MonoId>{r.region}</MonoId>
                        </TableCell>
                        <TableCell>
                          <Timestamp value={r.lastCheckedAt} fallback="No evidence yet" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        );
      }}
    </QueryBoundary>
  );
}

export function InfrastructurePage() {
  return (
    <>
      <PageHeader
        title="Infrastructure"
        description="Registered EC2, Lambda, API Gateway, DynamoDB, S3 and security group resources and their health."
      />
      <ModeGuard>
        <InfrastructureContent />
      </ModeGuard>
    </>
  );
}
