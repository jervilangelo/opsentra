import type { Role } from '@/types/domain';

import { useDemoSession } from './demo/demo-store';
import { useMode } from './mode-store';

/**
 * The current user's role, for deciding which controls to offer. This is a UI
 * convenience only: the data source (the backend in Live) enforces roles.
 * Demo: the simulated role. Live: undefined until Cognito sign-in (Phase 3).
 */
export function useCurrentRole(): Role | undefined {
  const mode = useMode();
  const demoRole = useDemoSession((s) => s.role);
  return mode === 'demo' ? demoRole : undefined;
}
