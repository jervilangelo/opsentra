import type { UseQueryResult } from '@tanstack/react-query';
import type * as React from 'react';

import { describeError as describe } from '@/api/describe-error';
import { LiveUnavailableError } from '@/api/errors';
import { ErrorState, LoadingState, PlannedPanel } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';

/** Standard loading / error handling for one query. Never invents data on failure. */
export function QueryBoundary<T>({
  query,
  loadingLabel,
  children,
}: {
  query: UseQueryResult<T>;
  loadingLabel?: string;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending) return <LoadingState {...(loadingLabel ? { label: loadingLabel } : {})} />;
  if (query.isError) {
    // A Live feature from a later phase is planned, not broken: say so plainly.
    if (query.error instanceof LiveUnavailableError && query.error.reason === 'not-implemented') {
      const phase = /Phase \d+/.exec(query.error.message)?.[0] ?? 'a later phase';
      return (
        <PlannedPanel phase={phase} title="Not available in Live AWS Mode yet">
          {query.error.message} Switch to Demo Mode to see how it will work.
        </PlannedPanel>
      );
    }
    const { title, detail } = describe(query.error);
    return (
      <ErrorState
        title={title}
        description={detail}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  return <>{children(query.data)}</>;
}
