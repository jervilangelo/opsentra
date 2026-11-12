import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type * as React from 'react';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useResolvedTheme } from '@/stores/preferences';

import { createQueryClient } from './query-client';

/** Keeps the `dark` class on <html> in sync with the theme preference. */
function ThemeSync() {
  const theme = useResolvedTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);
  return null;
}

export function Providers({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300}>
        <ThemeSync />
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
