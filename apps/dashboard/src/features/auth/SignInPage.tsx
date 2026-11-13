import { LogIn } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { Logo } from '@/components/brand/Logo';
import { ModeBadge } from '@/components/mode/ModeBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { liveConfigured } from '@/config/env';
import { beginSignIn } from '@/modes/live/auth';
import { useModeStore } from '@/modes/mode-store';

/**
 * Auth layout. There is deliberately no username/password form: Live sign-in
 * uses the Cognito hosted UI (Authorization Code + PKCE, no client secret).
 * Builds without Live configuration say so instead of offering a dead button.
 */
export function SignInPage() {
  const setMode = useModeStore((s) => s.setMode);
  const [error, setError] = useState<string | undefined>();
  const configured = liveConfigured();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo height={36} />
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="sr-only">Sign in</h1>
          <CardTitle>Sign in to Live AWS Mode</CardTitle>
          <CardDescription>
            {configured
              ? 'Live AWS Mode shows real data from the authenticated Opsentra API. Accounts are created by the administrator; there is no self sign-up.'
              : 'This build has no Live AWS configuration, so sign-in is not available here.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {configured ? (
            <>
              <Button
                className="w-full"
                onClick={() => {
                  setError(undefined);
                  setMode('live');
                  beginSignIn().catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : 'Sign-in could not start.'),
                  );
                }}
              >
                <LogIn aria-hidden="true" />
                Sign in with Cognito
              </Button>
              {error ? <p className="text-sm text-status-critical">{error}</p> : null}
            </>
          ) : null}
          <div className="flex flex-col items-center gap-2 border-t pt-4 text-center text-sm">
            <p className="text-muted-foreground">No account needed for the public demo.</p>
            <ModeBadge mode="demo" />
            <Button asChild variant="outline" className="w-full">
              <Link to="/overview" className="no-underline">
                Continue to Demo Mode
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
