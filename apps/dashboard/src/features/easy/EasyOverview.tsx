import { Link } from 'react-router';

import { HealthBadge } from '@/components/status/badges';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { guideSteps } from '@/features/demo/guide-steps';
import { incidentPath } from '@/features/navigation/nav';
import { useIncidents, useOverview, useResources } from '@/modes/data-hooks';
import { useDemoSession } from '@/modes/demo/demo-store';
import { useMode } from '@/modes/mode-store';
import { ACTIVE_INCIDENT_STATES, type Incident, type Severity } from '@/types/domain';

import { ago, plainResource, plainState } from './plain';
import { EasyPanel, EasyPrimary } from './ui';

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function mostUrgent(incidents: Incident[]): Incident | undefined {
  return [...incidents].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.openedAt.localeCompare(a.openedAt),
  )[0];
}

/** The answer to "Is everything OK, and if not, what do I press?" */
function Answer() {
  const overview = useOverview();
  const incidents = useIncidents();
  const resources = useResources();
  return (
    <QueryBoundary query={overview} loadingLabel="Checking your systems…">
      {({ data, meta }) => {
        const active = (incidents.data?.data ?? []).filter((i) =>
          ACTIVE_INCIDENT_STATES.includes(i.state),
        );
        const top = mostUrgent(active);
        const topType = resources.data?.data.find((r) => r.id === top?.resourceId)?.type;
        const working = data.healthCounts.HEALTHY;
        const unknown = data.healthCounts.UNKNOWN;
        return (
          <EasyPanel className="flex flex-col gap-5 sm:p-8">
            {top ? (
              <>
                <p className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] sm:text-[2rem]">
                  {active.length === 1
                    ? '1 problem needs you.'
                    : `${active.length} problems need you.`}
                </p>
                <div className="flex flex-col gap-1">
                  <p className="text-lg font-medium">{top.title}</p>
                  <p className="text-base text-muted-foreground">{plainState(top, topType)}</p>
                </div>
                <div>
                  <EasyPrimary asChild>
                    <Link to={incidentPath(top.id)}>Open the problem</Link>
                  </EasyPrimary>
                </div>
              </>
            ) : (
              <>
                <p className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] sm:text-[2rem]">
                  {working === data.monitoredResources
                    ? `All ${data.monitoredResources} systems are working.`
                    : `${working} of ${data.monitoredResources} systems are working.`}
                </p>
                <p className="text-base text-muted-foreground">
                  Nothing needs you right now
                  {unknown > 0 ? `. ${unknown} has no recent check, so its state is unknown` : ''}.
                  Last checked {ago(data.lastSyncAt, meta.generatedAt)}.
                </p>
                <div>
                  <EasyPrimary asChild>
                    <Link to="/simulation-lab">Practice a failure</Link>
                  </EasyPrimary>
                </div>
              </>
            )}
          </EasyPanel>
        );
      }}
    </QueryBoundary>
  );
}

/** Plain-words version of each walkthrough step, in the same order as guideSteps. */
const EASY_GUIDE: { title: string; hint: string }[] = [
  {
    title: 'Break something on purpose',
    hint: 'Open the Practice lab and press Break the web server.',
  },
  {
    title: 'Watch Opsentra notice',
    hint: 'Its health checks fail and it opens a problem. Skip ahead if you do not want to wait.',
  },
  { title: 'Take ownership', hint: 'Open the problem and say it is yours.' },
  { title: 'Look into it', hint: 'See what the monitors saw before changing anything.' },
  { title: 'Ask for a fix', hint: 'Ask to restart Nginx. Nothing runs until it is approved.' },
  {
    title: 'Approve the fix',
    hint: 'As an administrator, approve it. It runs on that one server only.',
  },
  {
    title: 'Watch it get checked',
    hint: 'It counts as fixed only after three checks pass in a row.',
  },
  { title: 'See what was recorded', hint: 'Every step you took is in the activity log.' },
];

function NextStepCard() {
  const engine = useDemoSession((s) => s.engine);
  const steps = guideSteps(engine);
  const idx = steps.findIndex((s) => !s.done);
  const step = steps[idx];
  return (
    <EasyPanel className="flex flex-col gap-3">
      <h2 className="text-base">Your next step</h2>
      {step ? (
        <>
          <p className="text-sm text-muted-foreground">
            Step {idx + 1} of {steps.length}
          </p>
          <p className="text-lg font-medium">{EASY_GUIDE[idx]?.title ?? step.title}</p>
          <p className="text-base text-muted-foreground">{EASY_GUIDE[idx]?.hint ?? step.hint}</p>
          {step.to ? (
            <Link to={step.to} className="w-fit text-base">
              Go there
            </Link>
          ) : null}
        </>
      ) : (
        <p className="text-base">
          You finished the walkthrough. Use Start over in the bar above to run it again.
        </p>
      )}
    </EasyPanel>
  );
}

function Systems() {
  const resources = useResources();
  return (
    <EasyPanel>
      <h2 className="mb-2 text-base">Your systems</h2>
      <QueryBoundary query={resources} loadingLabel="Loading systems…">
        {({ data }) => (
          <ul className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 border-b py-3 max-sm:last:border-0 sm:max-lg:[&:nth-last-child(-n+2)]:border-0 lg:[&:nth-last-child(-n+3)]:border-0"
              >
                <span className="text-base">{plainResource(r.type, true)}</span>
                <HealthBadge health={r.health} />
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </EasyPanel>
  );
}

export function EasyOverview() {
  const mode = useMode();
  return (
    <div className="flex flex-col gap-5">
      {/* Answer and next step share a row and a bottom edge; systems span the width. */}
      <div
        className={
          mode === 'demo'
            ? 'grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>*]:h-full'
            : 'grid gap-5'
        }
      >
        <Answer />
        {mode === 'demo' ? <NextStepCard /> : null}
      </div>
      <Systems />
    </div>
  );
}
