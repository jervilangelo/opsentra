import { Link } from 'react-router';

import { Logo } from '@/components/brand/Logo';
import { ModeBadge } from '@/components/mode/ModeBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Auth layout. There is deliberately no username/password form: Live sign-in
 * will use the Cognito hosted flow (Authorization Code + PKCE) in Phase 3.
 */
export function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo height={36} />
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="sr-only">Sign in</h1>
          <CardTitle>Sign in to Live AWS Mode</CardTitle>
          <CardDescription>
            Live sign-in uses Amazon Cognito and arrives in Phase 3. It is not available yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button disabled className="w-full">
            Sign in with Cognito (Phase 3)
          </Button>
          <div className="flex flex-col items-center gap-2 border-t pt-4 text-center text-sm">
            <p className="text-muted-foreground">No account needed for the public demo.</p>
            <ModeBadge mode="demo" />
            <Button asChild variant="outline" className="w-full">
              <Link to="/" className="no-underline">
                Continue to Demo Mode
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
