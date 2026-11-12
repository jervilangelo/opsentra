import type * as React from 'react';

import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { useModeStore } from '@/modes/mode-store';
import { getLiveStatus } from '@/modes/live/liveDataSource';

/**
 * Fail-closed gate for data-driven pages. In Live mode, if Live is unavailable,
 * render an error and nothing else: never synthetic data under a Live label.
 */
export function ModeGuard({ children }: { children: React.ReactNode }) {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);

  if (mode === 'live') {
    const status = getLiveStatus();
    if (!status.available) {
      return (
        <ErrorState
          title="Live AWS Mode is not connected"
          description={
            <>
              <p>
                No live data is shown. The authenticated Live API (Cognito sign-in, API Gateway and
                Lambda) arrives in Phase 3, and real resource health in Phase 4.
              </p>
              <p className="mt-1">Opsentra never substitutes synthetic data for live data.</p>
            </>
          }
          action={
            <Button variant="outline" size="sm" onClick={() => setMode('demo')}>
              Switch to Demo Mode
            </Button>
          }
        />
      );
    }
  }
  return <>{children}</>;
}
