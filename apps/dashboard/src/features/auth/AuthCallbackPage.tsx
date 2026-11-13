import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Logo } from '@/components/brand/Logo';
import { ErrorState, LoadingState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { completeSignIn } from '@/modes/live/auth';
import { useModeStore } from '@/modes/mode-store';

/** Cognito returns here with ?code&state; exchange it, then open Live mode. */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const setMode = useModeStore((s) => s.setMode);
  const [error, setError] = useState<string | undefined>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev
    started.current = true;
    completeSignIn(window.location.search)
      .then(() => {
        setMode('live');
        void navigate('/overview', { replace: true });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Sign-in failed.'));
  }, [navigate, setMode]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4">
      <Logo height={32} />
      <h1 className="text-2xl">Signing in</h1>
      {error ? (
        <ErrorState
          title="Sign-in did not complete"
          description={error}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/" className="no-underline">
                Back to Opsentra
              </Link>
            </Button>
          }
        />
      ) : (
        <LoadingState label="Finishing sign-in…" />
      )}
    </main>
  );
}
