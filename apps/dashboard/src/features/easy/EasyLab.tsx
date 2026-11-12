import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { describeError } from '@/api/describe-error';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { hasRole } from '@/domain/incident-machine';
import { QueryBoundary } from '@/features/common/QueryBoundary';
import { incidentPath } from '@/features/navigation/nav';
import { useIdempotencyKey } from '@/lib/idempotency';
import { useLabs, useStartLab } from '@/modes/data-hooks';
import { useDemoSession } from '@/modes/demo/demo-store';
import { useCurrentRole } from '@/modes/session';
import { usePreferences } from '@/stores/preferences';
import { ROLE_LABEL } from '@/types/display';

import type { PathStep } from './plain';
import { RecoveryPath } from './RecoveryPath';
import { EasyPanel, EasyPrimary } from './ui';

const EASY_SCENARIO = 'nginx-outage';

/** The journey ahead, before anything has happened. */
const PREVIEW: PathStep[] = [
  { id: 'spotted', label: 'Spotted', status: 'current' },
  { id: 'owned', label: 'Owned', status: 'todo' },
  { id: 'approved', label: 'Fix approved', status: 'todo' },
  { id: 'ran', label: 'Fix ran', status: 'todo' },
  { id: 'checked', label: 'Checked', status: 'todo' },
  { id: 'resolved', label: 'Resolved', status: 'todo' },
];

const PHASE: Record<string, string> = {
  detecting: 'The web server is broken. Opsentra is noticing: its health checks are failing.',
  open: 'Opsentra opened a problem. Go and fix it.',
  remediating: 'The fix is running.',
  verifying: 'Opsentra is checking the fix worked.',
  done: 'This practice run is finished.',
};

/** Easy view of the lab: one practice scenario, one button. */
export function EasyLab() {
  const labs = useLabs();
  const start = useStartLab();
  const role = useCurrentRole();
  const run = useDemoSession((s) => s.engine.run);
  const setView = usePreferences((s) => s.setView);
  const { key, renew } = useIdempotencyKey();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const isAdmin = role ? hasRole(role, 'ADMIN') : false;

  return (
    <QueryBoundary query={labs} loadingLabel="Loading the lab…">
      {({ data }) => {
        const scenario = data.find((s) => s.id === EASY_SCENARIO);
        if (!scenario) return null;
        return (
          <div className="flex flex-col gap-5">
            <EasyPanel className="flex flex-col gap-4 sm:p-8">
              <h2 className="text-[1.75rem] leading-tight tracking-[-0.02em]">
                Practice a web server outage
              </h2>
              <p className="max-w-prose text-base">
                Opsentra will stop Nginx on the practice web server. You then watch it get noticed,
                take ownership, approve a restart, and see Opsentra check the fix really worked.
                Everything is simulated. Nothing real is touched.
              </p>
              <div>
                <EasyPrimary
                  onClick={() => {
                    renew();
                    setError(undefined);
                    setOpen(true);
                  }}
                  disabled={!scenario.available || !isAdmin}
                >
                  Break the web server
                </EasyPrimary>
              </div>
              {!isAdmin && role ? (
                <p className="text-sm">
                  Only an administrator can start a practice run. You are viewing as{' '}
                  {ROLE_LABEL[role]}.
                </p>
              ) : !scenario.available ? (
                <p className="text-sm">{scenario.unavailableReason}</p>
              ) : null}
            </EasyPanel>

            {!run ? (
              <EasyPanel className="flex flex-col gap-4">
                <h2 className="text-base">What you will do</h2>
                <RecoveryPath steps={PREVIEW} now={undefined} />
                <p className="text-sm text-muted-foreground">
                  The same path, with real times, appears on the problem once you start.
                </p>
              </EasyPanel>
            ) : null}

            {run ? (
              <EasyPanel className="flex flex-col gap-2">
                <h2 className="text-base">Your practice run</h2>
                <p className="text-base" role="status" aria-live="polite">
                  {PHASE[run.phase]}
                </p>
                {run.incidentId ? (
                  <Link to={incidentPath(run.incidentId)} className="w-fit text-base">
                    Open the problem
                  </Link>
                ) : null}
              </EasyPanel>
            ) : null}

            <p className="text-sm text-muted-foreground">
              Want the failed-restart and other scenarios?{' '}
              <button
                type="button"
                onClick={() => setView('advanced')}
                className="text-link underline underline-offset-4"
              >
                Switch to Advanced view
              </button>
            </p>

            <ConfirmDialog
              open={open}
              onOpenChange={setOpen}
              action="Break the web server"
              confirmLabel="Break the web server"
              destructive
              resource={`Web server · ${scenario.resourceId}`}
              environment="Practice lab (simulated)"
              description="Stops Nginx on the practice server only. Demo Mode: nothing real is touched or billed."
              error={error}
              onConfirm={async () => {
                try {
                  await start.mutateAsync({
                    scenarioId: scenario.id,
                    input: { idempotencyKey: key },
                  });
                  setOpen(false);
                  toast.success('Practice run started. Watch Opsentra notice the problem.');
                } catch (e) {
                  setError(describeError(e).detail);
                }
              }}
            />
          </div>
        );
      }}
    </QueryBoundary>
  );
}
