import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { DEMO_SPEEDS, useDemoSession, type DemoSpeed } from '@/modes/demo/demo-store';
import { clockRunning } from '@/modes/demo/engine/engine';
import { ROLE_LABEL } from '@/types/display';
import type { Role } from '@/types/domain';
import { useView } from '@/stores/preferences';

const ROLES: Role[] = ['ADMIN', 'OPERATOR', 'VIEWER'];

const clockFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

const selectClass = 'border-input bg-background h-8 rounded-md border px-2 text-xs font-medium';

/**
 * Demo-only controls: simulated clock, pause/speed/next event, simulated role
 * and reset. Never rendered in Live mode.
 */
export function DemoControlBar() {
  const clockMs = useDemoSession((s) => s.engine.clockMs);
  const running = useDemoSession((s) => clockRunning(s.engine));
  const hasNext = useDemoSession((s) => s.engine.queue.length > 0);
  const paused = useDemoSession((s) => s.paused);
  const speed = useDemoSession((s) => s.speed);
  const role = useDemoSession((s) => s.role);
  const { setPaused, setSpeed, setRole, nextStep, reset } = useDemoSession.getState();
  const [confirmReset, setConfirmReset] = useState(false);
  const speedId = useId();
  const roleId = useId();
  const iso = new Date(clockMs).toISOString();
  const view = useView();
  const hasRun = useDemoSession((s) => Boolean(s.engine.run));
  const waitingForYou = running && !hasNext;

  const resetDialog = (
    <ConfirmDialog
      open={confirmReset}
      onOpenChange={setConfirmReset}
      action={view === 'easy' ? 'Start over' : 'Reset demo'}
      resource="Demo session (synthetic data)"
      environment="This browser tab only"
      description="Restores the starting snapshot and clears scenario runs. No AWS resources exist in Demo Mode."
      onConfirm={() => {
        reset();
        setConfirmReset(false);
        toast('Demo reset to the starting snapshot.');
      }}
    />
  );

  if (view === 'easy') {
    return (
      <div className="border-b bg-muted/40">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6">
          <p role="status" aria-live="polite">
            {!running
              ? hasRun
                ? 'Practice run finished. Start over to run it again.'
                : 'Practice mode. Nothing is running.'
              : paused
                ? 'Practice run paused.'
                : waitingForYou
                  ? 'Practice run: waiting for you.'
                  : 'Practice run in progress.'}
            {role !== 'ADMIN' ? (
              <span className="text-muted-foreground">
                {' '}
                Viewing as {ROLE_LABEL[role]}; change it in Advanced view.
              </span>
            ) : null}
          </p>
          <div className="flex items-center gap-1 sm:ml-auto">
            <Button variant="ghost" size="sm" onClick={nextStep} disabled={!hasNext}>
              <SkipForward aria-hidden="true" />
              Skip ahead
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
              <RotateCcw aria-hidden="true" />
              Start over
            </Button>
          </div>
        </div>
        {resetDialog}
      </div>
    );
  }

  return (
    <div className="border-b bg-muted/40">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-xs sm:px-6">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Simulated time</span>
          <time dateTime={iso} title={`${iso} (UTC)`} className="font-data">
            {clockFormat.format(clockMs)}
          </time>
          <span className="text-muted-foreground">
            {running ? (paused ? '· paused' : `· running ${speed}×`) : '· idle'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaused(!paused)}
            aria-pressed={paused}
            disabled={!running}
          >
            {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={nextStep}
            disabled={!hasNext}
            title={
              hasNext ? 'Jump to the next scheduled system event' : 'Waiting for a user action'
            }
          >
            <SkipForward aria-hidden="true" />
            Next event
          </Button>
          <label htmlFor={speedId} className="sr-only">
            Simulation speed
          </label>
          <select
            id={speedId}
            className={selectClass}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) as DemoSpeed)}
          >
            {DEMO_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}× speed
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor={roleId} className="text-muted-foreground">
            Simulated role
          </label>
          <select
            id={roleId}
            className={selectClass}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="sm:ml-auto"
          onClick={() => setConfirmReset(true)}
        >
          <RotateCcw aria-hidden="true" />
          Reset demo
        </Button>
      </div>

      {resetDialog}
    </div>
  );
}
