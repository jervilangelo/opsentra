import { QueryClient } from '@tanstack/react-query';

import { isNonRetryable } from '@/api/errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Auth, permission, validation and "Live not connected" errors are not
        // retried: the UI shows them instead of quietly trying again.
        retry: (failureCount, error) => !isNonRetryable(error) && failureCount < 2,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}
