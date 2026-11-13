import type { DataSource } from '@/api/data-source';
import { ApiRequestError, LiveUnavailableError } from '@/api/errors';
import { env, liveConfigured } from '@/config/env';
import type { ApiErrorBody, ApiSuccess } from '@/types/api';
import type { Role } from '@/types/domain';

import { accessToken, signOut, useLiveAuth } from './auth';

/**
 * Live AWS Mode data source: the authenticated Opsentra API (§4.2).
 *
 * Fails closed. Any missing configuration, missing sign-in, network failure or
 * HTTP error rejects; nothing here can return synthetic data. Methods whose
 * backend arrives in a later phase reject with `not-implemented`.
 * This module must never import Demo Mode code (enforced by ESLint).
 */

export interface LiveStatus {
  available: boolean;
  reason?: 'not-configured' | 'signed-out';
}

export function getLiveStatus(signedIn = useLiveAuth.getState().signedIn): LiveStatus {
  if (!liveConfigured()) return { available: false, reason: 'not-configured' };
  if (!signedIn) return { available: false, reason: 'signed-out' };
  return { available: true };
}

const later = (phase: string) => (): Promise<never> =>
  Promise.reject(
    new LiveUnavailableError('not-implemented', `This part of Live AWS Mode arrives in ${phase}.`),
  );

/** Backoff before each retry of a throttled or unreachable request. */
export const RETRY_DELAYS_MS: readonly number[] = [700, 1500];

interface SendOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string;
}

async function get<T>(path: string, opts: SendOptions = {}): Promise<ApiSuccess<T>> {
  if (!liveConfigured() || !env.apiBaseUrl) {
    throw new LiveUnavailableError(
      'not-configured',
      'Live AWS Mode is not configured for this build.',
    );
  }
  const token = await accessToken();
  if (!token) throw new LiveUnavailableError('unauthenticated', 'Sign in to use Live AWS Mode.');

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const url = `${env.apiBaseUrl.replace(/\/$/, '')}${path}`;
  const send = () =>
    fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

  // The stage throttle (burst 10) can reject a CORS preflight with 429, which
  // the browser reports as a network failure. Retrying is safe: reads have no
  // effect and every write carries the same Idempotency-Key, so the backend
  // returns the stored result instead of acting twice (live gate, 2026-11-13).
  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await send();
      if (res.status !== 429 || attempt >= RETRY_DELAYS_MS.length) break;
    } catch {
      if (attempt >= RETRY_DELAYS_MS.length) {
        throw new LiveUnavailableError('network', 'The Opsentra API could not be reached.');
      }
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }

  if (res.status === 401) {
    signOut(false); // expired or revoked: sign in again
    throw new LiveUnavailableError('unauthenticated', 'Your session ended. Sign in again.');
  }
  const body = (await res.json().catch(() => ({}))) as ApiSuccess<T> | ApiErrorBody;
  if (!res.ok || !('data' in body)) {
    const err = 'error' in body ? body.error : undefined;
    throw new ApiRequestError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? 'The request failed.',
      err?.requestId,
    );
  }
  if (body.meta.dataset !== 'live') {
    throw new ApiRequestError(500, 'DATASET_MISMATCH', 'Unexpected dataset from the Live API.');
  }
  return body;
}

export interface Me {
  sub: string;
  username?: string;
  role: Role;
  permittedActions: string[];
  environment: string;
}

export const getMe = () => get<Me>('/v1/me');

const enc = encodeURIComponent;

export const liveDataSource: DataSource = {
  mode: 'live',
  getOverview: () => get('/v1/overview'),
  listResources: () => get('/v1/resources'),
  listIncidents: () => get('/v1/incidents'),
  getIncident: (id) => get(`/v1/incidents/${enc(id)}`),
  getTimeline: (id) => get(`/v1/incidents/${enc(id)}/timeline`),
  listRunbooks: () => get('/v1/runbooks'),
  listRemediations: (incidentId) =>
    get(`/v1/remediations${incidentId ? `?incidentId=${enc(incidentId)}` : ''}`),
  getAnalytics: later('Phase 8'),
  listAudit: () => get('/v1/audit'),
  listLabs: () => get('/v1/labs'),
  acknowledgeIncident: (id, input) =>
    get(`/v1/incidents/${enc(id)}/acknowledge`, {
      method: 'POST',
      body: { expectedVersion: input.expectedVersion, reason: input.reason },
      idempotencyKey: input.idempotencyKey,
    }),
  investigateIncident: (id, input) =>
    get(`/v1/incidents/${enc(id)}/investigate`, {
      method: 'POST',
      body: { expectedVersion: input.expectedVersion },
      idempotencyKey: input.idempotencyKey,
    }),
  // Only a runbook ID is sent: the backend resolves the resource, instance and
  // document from its own allowlist (ADR-017).
  requestRemediation: (id, input) =>
    get(`/v1/incidents/${enc(id)}/request-remediation`, {
      method: 'POST',
      body: {
        expectedVersion: input.expectedVersion,
        runbookId: input.runbookId,
        reason: input.reason,
      },
      idempotencyKey: input.idempotencyKey,
    }),
  decideRemediation: (requestId, input) =>
    get(`/v1/remediations/${enc(requestId)}/decision`, {
      method: 'POST',
      body: {
        expectedVersion: input.expectedVersion,
        decision: input.decision,
        reason: input.reason,
      },
      idempotencyKey: input.idempotencyKey,
    }),
  closeIncident: (id, input) =>
    get(`/v1/incidents/${enc(id)}/close`, {
      method: 'POST',
      body: { expectedVersion: input.expectedVersion },
      idempotencyKey: input.idempotencyKey,
    }),
  // Called only from the confirmation dialog, which is the impact acknowledgement.
  // Only the scenario ID travels: the backend resolves the instance and the
  // hash-pinned documents from its registry (ADR-018).
  startLab: (scenarioId, input) =>
    get(`/v1/labs/${enc(scenarioId)}/start`, {
      method: 'POST',
      body: { acknowledgeImpact: true },
      idempotencyKey: input.idempotencyKey,
    }),
  resetLab: (scenarioId, input) =>
    get(`/v1/labs/${enc(scenarioId)}/reset`, {
      method: 'POST',
      body: {},
      idempotencyKey: input.idempotencyKey,
    }),
};
