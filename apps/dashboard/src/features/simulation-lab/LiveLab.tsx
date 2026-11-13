import { CircleCheck, CircleX, FlaskConical, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { describeError } from '@/api/describe-error';
import { MonoId } from '@/components/data/MonoId';
import { Timestamp } from '@/components/data/Timestamp';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { PlannedPanel } from '@/components/feedback/states';
import { LabRunBadge } from '@/components/status/badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { hasRole } from '@/domain/incident-machine';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { incidentPath } from '@/features/navigation/nav';
import { useIdempotencyKey } from '@/lib/idempotency';
import { useLabs, useResetLab, useStartLab } from '@/modes/data-hooks';
import { useModeStore } from '@/modes/mode-store';
import { useCurrentRole } from '@/modes/session';
import type { LabRun, LabScenario } from '@/types/domain';

const ENVIRONMENT = 'lab · ap-southeast-1 (Live AWS)';

const INJECTION_TEXT: Record<LabRun['injection'], string> = {
  PENDING: 'Sending the fault injection…',
  SENT: 'Fault injection sent. Waiting for SSM to confirm.',
  SUCCEEDED: 'Nginx stopped (SSM confirmed). Waiting for detection.',
  FAILED: 'The fault injection failed.',
};

/** Cost and safety disclosure shown before any live action (§11). */
export function LiveLabDisclosure() {
  return (
    <p className="text-sm text-muted-foreground">
      This stops a real service on the disposable lab instance, which is tagged{' '}
      <MonoId>opsentra:lab=true</MonoId> and registered by Terraform. Nothing else can be targeted.
      While the lab is deployed it costs roughly US$0.01–0.02 per hour (t4g.nano, public IPv4, 8 GB
      gp3, one alarm and a 1-minute probe). SSM Run Command on EC2 has no extra charge. Destroy the
      lab when you finish.
    </p>
  );
}

function Preflight({ scenario }: { scenario: LabScenario }) {
  if (!scenario.preflight?.length) return null;
  return (
    <section aria-label="Preflight checks" className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">Preflight checks</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {scenario.preflight.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            {c.ok ? (
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-status-healthy"
                aria-hidden="true"
              />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0 text-status-critical" aria-hidden="true" />
            )}
            <span>
              <span className="sr-only">{c.ok ? 'Passed: ' : 'Failed: '}</span>
              {c.label}
              {!c.ok && c.detail ? (
                <span className="block text-xs text-muted-foreground">{c.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunDetails({ run }: { run: LabRun }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Run</dt>
      <dd>
        <MonoId>{run.runId}</MonoId> <LabRunBadge status={run.status} />
      </dd>
      <dt className="text-muted-foreground">Started</dt>
      <dd>
        <Timestamp value={run.startedAt} /> by {run.startedBy}
      </dd>
      {run.status === 'ACTIVE' ? (
        <>
          <dt className="text-muted-foreground">Auto-reset at</dt>
          <dd>
            <Timestamp value={run.expiresAt} />
          </dd>
        </>
      ) : null}
      {run.incidentId ? (
        <>
          <dt className="text-muted-foreground">Incident</dt>
          <dd>
            <Link to={incidentPath(run.incidentId)} className="font-medium">
              <MonoId>{run.incidentId}</MonoId>
            </Link>
          </dd>
        </>
      ) : null}
      {run.endedAt ? (
        <>
          <dt className="text-muted-foreground">Ended</dt>
          <dd>
            <Timestamp value={run.endedAt} />
            {run.endReason ? ` · ${run.endReason}` : ''}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function ActiveRunPanel({ scenario, run }: { scenario: LabScenario; run: LabRun }) {
  return (
    <section aria-label="Current run" className="flex flex-col gap-2 rounded-md border p-3">
      <p role="status" aria-live="polite" className="text-sm font-medium">
        {run.incidentId
          ? 'Incident detected. Recover it from the incident page with an approved runbook.'
          : INJECTION_TEXT[run.injection]}
      </p>
      <RunDetails run={run} />
      <p className="text-xs text-muted-foreground">
        The incident resolves only after the independent probe verifies recovery. Resetting restarts
        Nginx and ends this run; it does not mark the incident resolved.
      </p>
      <ResetButton scenario={scenario} label="Reset scenario" />
    </section>
  );
}

function ResetButton({ scenario, label }: { scenario: LabScenario; label: string }) {
  const role = useCurrentRole();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { key, renew } = useIdempotencyKey();
  const reset = useResetLab();
  if (!(role && hasRole(role, 'ADMIN')) || !scenario.resourceId) return null;
  return (
    <>
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => {
          renew();
          setError(undefined);
          setOpen(true);
        }}
      >
        <RotateCcw aria-hidden="true" />
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        action="Reset: restart Nginx"
        confirmLabel="Restart Nginx"
        resource={scenario.resourceId}
        environment={ENVIRONMENT}
        description="Runs the allowlisted Opsentra-Lab-RestartNginx document on this lab instance and ends the active run."
        error={error}
        onConfirm={async () => {
          try {
            await reset.mutateAsync({ scenarioId: scenario.id, input: { idempotencyKey: key } });
            setOpen(false);
            toast.success('Restart sent. Recovery is confirmed only by the health probe.');
          } catch (e) {
            setError(describeError(e).detail);
          }
        }}
      />
    </>
  );
}

function LiveScenarioCard({ scenario }: { scenario: LabScenario }) {
  const role = useCurrentRole();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { key, renew } = useIdempotencyKey();
  const start = useStartLab();
  const isAdmin = role ? hasRole(role, 'ADMIN') : false;
  const run = scenario.activeRun;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Scenario {scenario.group}: {scenario.title}
        </CardTitle>
        <CardDescription>{scenario.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">
          <span className="text-muted-foreground">Expected: </span>
          {scenario.expectedOutcome}
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">Target: </span>
          {scenario.resourceId ? <MonoId>{scenario.resourceId}</MonoId> : 'Lab not deployed'}
          {scenario.labExpiresAt ? (
            <>
              {' '}
              · lab expires <Timestamp value={scenario.labExpiresAt} />
            </>
          ) : null}
        </p>
        {run ? <ActiveRunPanel scenario={scenario} run={run} /> : <Preflight scenario={scenario} />}
        {!run && scenario.lastRun ? (
          <section aria-label="Last run" className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Last run</h3>
            <RunDetails run={scenario.lastRun} />
          </section>
        ) : null}
        {!run ? (
          <div className="flex flex-col gap-2">
            <LiveLabDisclosure />
            <div className="flex flex-wrap gap-2">
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
                Start live scenario
              </Button>
              <ResetButton scenario={scenario} label="Restart Nginx (cleanup)" />
            </div>
            {!isAdmin ? (
              <p className="text-xs text-muted-foreground">
                Starting a scenario requires the Administrator role.
              </p>
            ) : !scenario.available ? (
              <p className="text-xs text-muted-foreground">{scenario.unavailableReason}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        action={`Start: ${scenario.title}`}
        confirmLabel="Stop Nginx now"
        destructive
        resource={scenario.resourceId}
        environment={ENVIRONMENT}
        description="Live AWS: this really stops Nginx on the lab instance. One run at a time; it resets itself after 45 minutes if left running."
        error={error}
        onConfirm={async () => {
          try {
            await start.mutateAsync({ scenarioId: scenario.id, input: { idempotencyKey: key } });
            setOpen(false);
            toast.success('Fault injection sent. Watch for detection.');
          } catch (e) {
            setError(describeError(e).detail);
          }
        }}
      />
    </Card>
  );
}

function LabOff() {
  const setMode = useModeStore((s) => s.setMode);
  return (
    <Card>
      <CardHeader>
        <CardTitle>The live lab is off</CardTitle>
        <CardDescription>
          The disposable lab is deployed only for tests, so there is nothing to break right now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-fit" onClick={() => setMode('demo')}>
          Try the scenarios in Demo Mode
        </Button>
      </CardContent>
    </Card>
  );
}

export function LiveLab() {
  const role = useCurrentRole();
  if (!role) return null; // waiting for /v1/me
  if (!hasRole(role, 'ADMIN')) {
    return (
      <p className="text-sm text-muted-foreground">
        The live Simulation Lab is for administrators. Your role can follow lab incidents from the
        Incidents page.
      </p>
    );
  }
  return <AdminLiveLab />;
}

function AdminLiveLab() {
  const labs = useLabs();
  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={labs} loadingLabel="Running preflight checks…">
        {({ data }) =>
          data.every((s) => !s.resourceId && !s.activeRun) ? (
            <LabOff />
          ) : (
            <>
              {data.map((s) => (
                <LiveScenarioCard key={s.id} scenario={s} />
              ))}
            </>
          )
        }
      </QueryBoundary>
      <PlannedPanel phase="later" title="Scenarios B and C (live)">
        Lambda regression rollback and security group exposure run in Demo Mode only for now. Their
        live versions are planned stretch work (blueprint §6.2, §6.3).
      </PlannedPanel>
    </div>
  );
}
