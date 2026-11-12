import type { DataSource } from '@/api/data-source';
import { LiveUnavailableError } from '@/api/errors';

/**
 * Live AWS Mode data source.
 *
 * There is no backend yet, so every call fails closed with `not-configured`.
 * The authenticated API adapter arrives in Phase 3/4.
 * This module must never import Demo Mode code (enforced by ESLint).
 */

const unavailable = (): Promise<never> =>
  Promise.reject(
    new LiveUnavailableError(
      'not-configured',
      'Live AWS Mode is not connected yet. The authenticated API arrives in Phase 3–4.',
    ),
  );

export interface LiveStatus {
  available: boolean;
  reason?: 'not-configured';
}

/** Live is not available until the backend exists. */
export function getLiveStatus(): LiveStatus {
  return { available: false, reason: 'not-configured' };
}

export const liveDataSource: DataSource = {
  mode: 'live',
  getOverview: unavailable,
  listResources: unavailable,
  listIncidents: unavailable,
  getIncident: unavailable,
  getTimeline: unavailable,
  listRunbooks: unavailable,
  listRemediations: unavailable,
  getAnalytics: unavailable,
  listAudit: unavailable,
  listLabs: unavailable,
  acknowledgeIncident: unavailable,
  investigateIncident: unavailable,
  requestRemediation: unavailable,
  decideRemediation: unavailable,
  closeIncident: unavailable,
  startLab: unavailable,
};
