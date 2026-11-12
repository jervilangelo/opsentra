import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { DataSource } from '@/api/data-source';
import type {
  AcknowledgeInput,
  Mode,
  MutationGuard,
  RemediationDecisionInput,
  RemediationRequestInput,
  StartLabInput,
} from '@/types/domain';

import { demoDataSource } from './demo/demoDataSource';
import { liveDataSource } from './live/liveDataSource';
import { useMode } from './mode-store';

/** The only place that chooses between the Demo and Live data sources. */
export function dataSourceFor(mode: Mode): DataSource {
  return mode === 'live' ? liveDataSource : demoDataSource;
}

export function useDataSource(): DataSource {
  return dataSourceFor(useMode());
}

/**
 * Query keys always start with the mode, so cached Demo and Live results can
 * never be served in each other's place.
 */
export const queryKeys = {
  overview: (mode: Mode) => [mode, 'overview'] as const,
  resources: (mode: Mode) => [mode, 'resources'] as const,
  incidents: (mode: Mode) => [mode, 'incidents'] as const,
  incident: (mode: Mode, id: string) => [mode, 'incidents', id] as const,
  timeline: (mode: Mode, id: string) => [mode, 'incidents', id, 'timeline'] as const,
  runbooks: (mode: Mode) => [mode, 'runbooks'] as const,
  remediations: (mode: Mode, incidentId?: string) =>
    [mode, 'remediations', incidentId ?? 'all'] as const,
  analytics: (mode: Mode, from: string, to: string) => [mode, 'analytics', from, to] as const,
  audit: (mode: Mode) => [mode, 'audit'] as const,
  labs: (mode: Mode) => [mode, 'labs'] as const,
};

/** Live data is re-read every 30 s; Demo data changes only when the engine does. */
const LIVE_POLL_MS = 30_000;
const poll = (mode: Mode) => (mode === 'live' ? LIVE_POLL_MS : false);

export function useOverview() {
  const source = useDataSource();
  return useQuery({
    queryKey: queryKeys.overview(source.mode),
    queryFn: () => source.getOverview(),
    refetchInterval: poll(source.mode),
  });
}

export function useResources() {
  const source = useDataSource();
  return useQuery({
    queryKey: queryKeys.resources(source.mode),
    queryFn: () => source.listResources(),
    refetchInterval: poll(source.mode),
  });
}

export function useIncidents() {
  const source = useDataSource();
  return useQuery({
    queryKey: queryKeys.incidents(source.mode),
    queryFn: () => source.listIncidents(),
    refetchInterval: poll(source.mode),
  });
}

export function useIncident(incidentId: string) {
  const source = useDataSource();
  return useQuery({
    queryKey: queryKeys.incident(source.mode, incidentId),
    queryFn: () => source.getIncident(incidentId),
  });
}

export function useTimeline(incidentId: string) {
  const source = useDataSource();
  return useQuery({
    queryKey: queryKeys.timeline(source.mode, incidentId),
    queryFn: () => source.getTimeline(incidentId),
  });
}

export function useRunbooks() {
  const source = useDataSource();
  return useQuery({
    queryKey: queryKeys.runbooks(source.mode),
    queryFn: () => source.listRunbooks(),
  });
}

export function useRemediations(incidentId?: string) {
  const source = useDataSource();
  return useQuery({
    queryKey: queryKeys.remediations(source.mode, incidentId),
    queryFn: () => source.listRemediations(incidentId),
  });
}

export function useAnalytics(from: string, to: string) {
  const source = useDataSource();
  return useQuery({
    queryKey: queryKeys.analytics(source.mode, from, to),
    queryFn: () => source.getAnalytics({ from, to }),
  });
}

export function useAudit() {
  const source = useDataSource();
  return useQuery({ queryKey: queryKeys.audit(source.mode), queryFn: () => source.listAudit() });
}

export function useLabs() {
  const source = useDataSource();
  return useQuery({ queryKey: queryKeys.labs(source.mode), queryFn: () => source.listLabs() });
}

/**
 * Mutations. After any result (success or failure) the mode's queries are
 * refreshed from the source of truth; the UI never assumes success.
 */
function useSourceMutation<TVars, TData>(fn: (source: DataSource, vars: TVars) => Promise<TData>) {
  const source = useDataSource();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => fn(source, vars),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [source.mode] }),
  });
}

export const useAcknowledge = () =>
  useSourceMutation((s, v: { incidentId: string; input: AcknowledgeInput }) =>
    s.acknowledgeIncident(v.incidentId, v.input),
  );

export const useInvestigate = () =>
  useSourceMutation((s, v: { incidentId: string; input: MutationGuard }) =>
    s.investigateIncident(v.incidentId, v.input),
  );

export const useRequestRemediation = () =>
  useSourceMutation((s, v: { incidentId: string; input: RemediationRequestInput }) =>
    s.requestRemediation(v.incidentId, v.input),
  );

export const useDecideRemediation = () =>
  useSourceMutation((s, v: { requestId: string; input: RemediationDecisionInput }) =>
    s.decideRemediation(v.requestId, v.input),
  );

export const useCloseIncident = () =>
  useSourceMutation((s, v: { incidentId: string; input: MutationGuard }) =>
    s.closeIncident(v.incidentId, v.input),
  );

export const useStartLab = () =>
  useSourceMutation((s, v: { scenarioId: string; input: StartLabInput }) =>
    s.startLab(v.scenarioId, v.input),
  );
