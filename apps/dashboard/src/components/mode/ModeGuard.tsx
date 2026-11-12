import { LogIn } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';

import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { beginSignIn, useLiveAuth } from '@/modes/live/auth';
import { getLiveStatus } from '@/modes/live/liveDataSource';
import { useModeStore } from '@/modes/mode-store';

/**
 * Fail-closed gate for data-driven pages. In Live mode, if Live is unavailable,
 * render an error (or a sign-in prompt) and nothing else: never synthetic data
 * under a Live label.
 */
export function ModeGuard({ children }: { children: React.ReactNode }) {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const signedIn = useLiveAuth((s) => s.signedIn);
  const [error, setError] = useState<string | undefined>();

  if (mode !== 'live') return <>{children}</>;

  const status = getLiveStatus(signedIn);
  if (status.available) return <>{children}</>;

  const backToDemo = (
    <Button variant="outline" size="sm" onClick={() => setMode('demo')}>
      Switch to Demo Mode
    </Button>
  );

  if (status.reason === 'signed-out') {
    return (
      <ErrorState
        title="Sign in to Live AWS Mode"
        description={
          <>
            <p>
              Live data comes from the authenticated Opsentra API. Nothing is shown until you sign
              in.
            </p>
            {error ? <p className="mt-1 text-status-critical">{error}</p> : null}
          </>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                setError(undefined);
                beginSignIn().catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : 'Sign-in could not start.'),
                );
              }}
            >
              <LogIn aria-hidden="true" />
              Sign in
            </Button>
            {backToDemo}
          </div>
        }
      />
    );
  }

  return (
    <ErrorState
      title="Live AWS Mode is not connected"
      description={
        <>
          <p>This build has no Live API configuration, so no live data is shown.</p>
          <p className="mt-1">Opsentra never substitutes synthetic data for live data.</p>
        </>
      }
      action={backToDemo}
    />
  );
}
