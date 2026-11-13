import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

import { Logo } from '@/components/brand/Logo';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';

const APP_ROOT = import.meta.env.BASE_URL;

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="This page does not exist"
        description="Check the address, or go back to the overview."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/overview" className="no-underline">
              Go to Overview
            </Link>
          </Button>
        }
      />
    </>
  );
}

/** Rendered by the router when a route throws. Never shows stack traces. */
export function RouteErrorPage() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : undefined;
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4">
      <Logo height={32} />
      <h1 className="text-2xl">Something went wrong</h1>
      <ErrorState
        title={status ?? 'Unexpected error'}
        description="The page failed to load. No data was changed."
        action={
          <Button asChild variant="outline" size="sm">
            <a href={APP_ROOT} className="no-underline">
              Reload Opsentra
            </a>
          </Button>
        }
      />
    </main>
  );
}
