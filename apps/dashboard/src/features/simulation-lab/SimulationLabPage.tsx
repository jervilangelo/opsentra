import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { describeError } from '@/api/describe-error';
import { MonoId } from '@/components/data/MonoId';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { PlannedPanel } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModeGuard } from '@/components/mode/ModeGuard';
import { IncidentStateBadge } from '@/components/status/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { hasRole } from '@/domain/incident-machine';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { DemoGuide } from '@/features/demo/DemoGuide';
import { incidentPath } from '@/features/navigation/nav';
import { useIdempotencyKey } from '@/lib/idempotency';
import { useIncidents, useLabs, useStartLab } from '@/modes/data-hooks';
import { useDemoSession } from '@/modes/demo/demo-store';
import { useMode } from '@/modes/mode-store';
import { useView } from '@/stores/preferences';
import { EasyLab } from '@/features/easy/EasyLab';
import { useCurrentRole } from '@/modes/session';
import type { LabScenario } from '@/types/domain';

const GROUP_TITLE: Record<LabScenario['group'], string> = {
  A: 'Scenario A: Nginx outage and verified recovery',
  B: 'Scenario B: Lambda deployment regression and rollback',
  C: 'Scenario C: Security group rule exposure',
};

function ScenarioGroup({ first, scenarios }: { first: LabScenario; scenarios: LabScenario[] }) {
  const role = useCurrentRole();
  const [selected, setSelected] = useState(first.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { key, renew } = useIdempotencyKey();
  const start = useStartLab();
  const scenario = scenarios.find((s) => s.id === selected) ?? first;
  const isAdmin = role ? hasRole(role, 'ADMIN') : false;
  const group = scenario.group;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{GROUP_TITLE[group]}</CardTitle>
        <CardDescription>{scenario.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {scenarios.length > 1 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Outcome to simulate</legend>
            {scenarios.map((s) => (
              <label key={s.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <input
                  type="radio"
                  name={`scenario-${group}`}
                  value={s.id}
                  checked={selected === s.id}
                  onChange={() => setSelected(s.id)}
                  className="mt-1"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{s.title}</span>
                  <span className="text-xs text-muted-foreground">{s.expectedOutcome}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-sm">
            <span className="text-muted-foreground">Expected: </span>
            {scenario.expectedOutcome}
          </p>
        )}
        <p className="text-sm">
          <span className="text-muted-foreground">Target: </span>
          <MonoId>{scenario.resourceId}</MonoId>
        </p>
        <div className="flex flex-col gap-1">
          <Button
            onClick={() => {
              renew();
              setError(undefined);
              setOpen(true);
            }}
            disabled={!scenario.available || !isAdmin}
            className="w-fit"
          >
            <FlaskConical aria-hidden="true" />
            Start scenario
          </Button>
          {!isAdmin ? (
            <p className="text-xs text-muted-foreground">
              Starting a scenario requires the Administrator role.
            </p>
          ) : !scenario.available ? (
            <p className="text-xs text-muted-foreground">{scenario.unavailableReason}</p>
          ) : null}
        </div>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        action={`Start: ${scenario.title}`}
        confirmLabel="Start scenario"
        destructive
        resource={scenario.resourceId}
        environment="lab · ap-southeast-1 (simulated)"
        description="Injects a simulated fault on this lab resource only. Demo Mode: no AWS resources are touched and nothing is billed."
        error={error}
        onConfirm={async () => {
          try {
            await start.mutateAsync({ scenarioId: scenario.id, input: { idempotencyKey: key } });
            setOpen(false);
            toast.success('Scenario started. Watch for detection.');
          } catch (e) {
            setError(describeError(e).detail);
          }
        }}
      />
    </Card>
  );
}

function ActiveRun() {
  const run = useDemoSession((s) => s.engine.run);
  const incidents = useIncidents();
  if (!run) return null;
  const incident = incidents.data?.data.find((i) => i.id === run.incidentId);
  const PHASE: Record<string, string> = {
    detecting: 'Fault injected. Waiting for detection.',
    open: 'Incident open. Respond from the incident page.',
    remediating: 'Runbook executing.',
    verifying: 'Verifying service health.',
    done: 'Scenario finished.',
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current run</CardTitle>
        <CardDescription>
          Correlation ID <MonoId>{run.correlationId}</MonoId>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p role="status" aria-live="polite">
          {PHASE[run.phase]}
        </p>
        {incident ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link to={incidentPath(incident.id)} className="font-medium">
              {incident.title}
            </Link>
            <IncidentStateBadge state={incident.state} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LabContent() {
  const labs = useLabs();
  return (
    <QueryBoundary query={labs} loadingLabel="Loading scenarios…">
      {({ data }) => {
        const groups = (['A', 'B', 'C'] as const).map((g) => ({
          group: g,
          scenarios: data.filter((s) => s.group === g),
        }));
        return (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
            <div className="flex flex-col gap-4">
              <ActiveRun />
              {groups.map((g) => {
                const [first] = g.scenarios;
                return first ? (
                  <ScenarioGroup key={g.group} first={first} scenarios={g.scenarios} />
                ) : null;
              })}
            </div>
            <DemoGuide className="h-fit" />
          </div>
        );
      }}
    </QueryBoundary>
  );
}

export function SimulationLabPage() {
  const mode = useMode();
  const view = useView();
  return (
    <>
      <PageHeader
        title="Simulation Lab"
        description={
          view === 'easy'
            ? 'Break something on purpose and fix it, safely. Everything here is simulated.'
            : 'Run a failure scenario and follow it from detection to verified recovery.'
        }
      />
      <ModeGuard>
        {mode === 'demo' ? view === 'easy' ? <EasyLab /> : <LabContent /> : null}
      </ModeGuard>
      {mode === 'live' ? (
        <PlannedPanel phase="Phase 7" title="Live scenarios" className="mt-4">
          Admin-only live tests on tagged, disposable lab resources with preflight checks, cooldown
          and cleanup.
        </PlannedPanel>
      ) : null}
    </>
  );
}
