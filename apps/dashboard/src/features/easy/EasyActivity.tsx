import { ModeGuard } from '@/components/mode/ModeGuard';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { useAudit, useIncidents, useLabs, useRemediations } from '@/modes/data-hooks';
import type { AuditEvent } from '@/types/domain';

import { ago, plainEvent } from './plain';
import { EasyPanel } from './ui';

/** Easy view of the audit log: the latest 20 events as sentences. */
function Activity() {
  const audit = useAudit();
  const incidents = useIncidents();
  const remediations = useRemediations();
  const labs = useLabs();

  /** What an event was about, in words: the incident's title or the practice scenario. */
  function about(a: AuditEvent): string {
    const titleOf = (id: string | undefined) =>
      incidents.data?.data.find((i) => i.id === id)?.title;
    if (a.targetType === 'INCIDENT') return titleOf(a.targetId) ?? '';
    if (a.targetType === 'REMEDIATION') {
      const req = remediations.data?.data.find((r) => r.requestId === a.targetId);
      return titleOf(req?.incidentId) ?? '';
    }
    const lab = labs.data?.data.find((l) => l.id === a.targetId);
    return lab ? `Practice: ${lab.title}` : '';
  }

  return (
    <QueryBoundary query={audit} loadingLabel="Loading activity…">
      {({ data, meta }) => (
        <EasyPanel>
          <h2 className="mb-1 text-base">Latest activity</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Every action is recorded and cannot be edited, including attempts that were not allowed.
          </p>
          <ol className="flex flex-col">
            {data.slice(0, 20).map((a) => (
              <li
                key={a.id}
                className="grid gap-x-6 gap-y-0.5 border-b py-2.5 text-base last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-baseline"
              >
                <span>
                  {plainEvent(a.action, a.actorType === 'USER' ? a.actorId : undefined)}
                  {a.outcome === 'DENIED' ? (
                    <span className="text-status-critical"> · not allowed</span>
                  ) : null}
                </span>
                <span className="text-sm text-muted-foreground sm:truncate">{about(a)}</span>
                <span className="shrink-0 text-sm text-muted-foreground sm:text-right">
                  {ago(a.occurredAt, meta.generatedAt)}
                </span>
              </li>
            ))}
          </ol>
        </EasyPanel>
      )}
    </QueryBoundary>
  );
}

export function EasyActivity() {
  return (
    <ModeGuard>
      <Activity />
    </ModeGuard>
  );
}
