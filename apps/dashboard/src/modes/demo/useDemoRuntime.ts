import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useDemoSession } from './demo-store';

const TICK_MS = 250;

/**
 * Drives Demo Mode while it is active:
 * - advances the simulated clock (only while a scenario is running and not paused);
 * - refreshes Demo queries whenever engine data changes (not on every clock tick).
 * Mounted once by the app shell, only in Demo mode.
 */
export function useDemoRuntime(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      useDemoSession.getState().tick(now - last);
      last = now;
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let revision = useDemoSession.getState().engine.revision;
    return useDemoSession.subscribe((s) => {
      if (s.engine.revision !== revision) {
        revision = s.engine.revision;
        void queryClient.invalidateQueries({ queryKey: ['demo'] });
      }
    });
  }, [enabled, queryClient]);
}
