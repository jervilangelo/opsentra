import { useQuery } from '@tanstack/react-query';

import type { Role } from '@/types/domain';

import { useDemoSession } from './demo/demo-store';
import { useLiveAuth } from './live/auth';
import { getLiveStatus, getMe } from './live/liveDataSource';
import { useMode } from './mode-store';

/**
 * The signed-in identity in Live mode, from GET /v1/me (roles come from trusted
 * Cognito groups, checked by the backend).
 */
export function useLiveMe() {
  const mode = useMode();
  const signedIn = useLiveAuth((s) => s.signedIn);
  return useQuery({
    queryKey: ['live', 'me'],
    queryFn: getMe,
    enabled: mode === 'live' && getLiveStatus(signedIn).available,
    staleTime: 5 * 60_000,
  });
}

/**
 * The current user's role, for deciding which controls to offer. This is a UI
 * convenience only: the data source (the backend in Live) enforces roles.
 * Demo: the simulated role. Live: the role /v1/me reports, once signed in.
 */
export function useCurrentRole(): Role | undefined {
  const mode = useMode();
  const demoRole = useDemoSession((s) => s.role);
  const me = useLiveMe();
  return mode === 'demo' ? demoRole : me.data?.data.role;
}
