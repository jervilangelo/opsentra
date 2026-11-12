import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useResolvedTheme } from '@/stores/preferences';

/**
 * Accessible toast region. Rule: never show a "success" toast until the backend
 * has confirmed the result (blueprint §2.3).
 */
export function Toaster(props: ToasterProps) {
  const theme = useResolvedTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'bg-popover text-popover-foreground border-border',
          description: 'text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
