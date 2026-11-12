import { Link } from 'react-router';

import { IncidentStateBadge } from '@/components/status/badges';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { incidentPath } from '@/features/navigation/nav';
import { useIncidents } from '@/modes/data-hooks';
import { ACTIVE_INCIDENT_STATES, type Incident } from '@/types/domain';

import { ago } from './plain';
import { EasyPanel } from './ui';

function Rows({ items, now }: { items: Incident[]; now: string }) {
  return (
    <ul className="flex flex-col">
      {items.map((i) => (
        <li
          key={i.id}
          className="flex flex-col gap-2 border-b py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4"
        >
          <Link to={incidentPath(i.id)} className="text-base font-medium">
            {i.title}
          </Link>
          <span className="flex items-center gap-3 sm:ml-auto">
            <IncidentStateBadge state={i.state} />
            <span className="shrink-0 text-sm text-muted-foreground">{ago(i.openedAt, now)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Easy view: what needs you, then what is done. No filters, IDs or table. */
export function EasyIncidents() {
  const incidents = useIncidents();
  return (
    <QueryBoundary query={incidents} loadingLabel="Loading incidents…">
      {({ data, meta }) => {
        const open = data.filter((i) => ACTIVE_INCIDENT_STATES.includes(i.state));
        const done = data.filter((i) => !ACTIVE_INCIDENT_STATES.includes(i.state));
        return (
          <div className="flex flex-col gap-5">
            <EasyPanel>
              <h2 className="mb-2 text-base">Needs you</h2>
              {open.length === 0 ? (
                <p className="py-2 text-base text-muted-foreground">
                  Nothing is open. Start a practice failure from the Practice lab.
                </p>
              ) : (
                <Rows items={open} now={meta.generatedAt} />
              )}
            </EasyPanel>
            <EasyPanel>
              <h2 className="mb-2 text-base">Done</h2>
              {done.length === 0 ? (
                <p className="py-2 text-base text-muted-foreground">Nothing finished yet.</p>
              ) : (
                <Rows items={done.slice(0, 6)} now={meta.generatedAt} />
              )}
              {done.length > 6 ? (
                <p className="pt-3 text-sm text-muted-foreground">
                  Showing the latest 6 of {done.length}. Advanced view lists them all.
                </p>
              ) : null}
            </EasyPanel>
          </div>
        );
      }}
    </QueryBoundary>
  );
}
