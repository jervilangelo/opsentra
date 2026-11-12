import type { UseQueryResult } from '@tanstack/react-query';
import type * as React from 'react';

import { describeError as describe } from '@/api/describe-error';
import { ErrorState, LoadingState } from '@/components/feedback/states';
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
