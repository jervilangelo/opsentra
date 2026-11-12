import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type * as React from 'react';

import { LiveUnavailableError } from '@/api/errors';
import { testQueryClient } from '@/test/render';

import { dataSourceFor, useIncidents, useOverview } from './data-hooks';
import { useDemoSession } from './demo/demo-store';
import { demoDataSource } from './demo/demoDataSource';
import { liveDataSource } from './live/liveDataSource';
import { useModeStore } from './mode-store';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

describe('mode selection', () => {
  it('picks the demo source in demo mode and the live source in live mode', () => {
    expect(dataSourceFor('demo')).toBe(demoDataSource);
    expect(dataSourceFor('live')).toBe(liveDataSource);
  });

  it('demo payloads are tagged synthetic', async () => {
    const { result } = renderHook(() => useOverview(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.meta.dataset).toBe('synthetic');
  });

  // Blueprint §10.2 test 11: Live failure never displays synthetic data as real.
  it('live mode fails closed and never returns demo data', async () => {
    useModeStore.setState({ mode: 'live' });
    const { result } = renderHook(() => useIncidents(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(LiveUnavailableError);
    expect(result.current.data).toBeUndefined();
  });

  it('every live method rejects with LiveUnavailableError', async () => {
    const calls = Object.entries(liveDataSource).filter(([, v]) => typeof v === 'function');
    expect(calls.length).toBeGreaterThanOrEqual(16);
    for (const [, fn] of calls) {
      await expect((fn as (...a: unknown[]) => Promise<unknown>)('x', {})).rejects.toBeInstanceOf(
        LiveUnavailableError,
      );
    }
  });
});

describe('demo data source', () => {
  // Blueprint §10.2 test 10: Demo Mode never calls AWS endpoints.
  it('makes no network calls, including during a full scenario', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
    await demoDataSource.getOverview();
    await demoDataSource.listResources();
    await demoDataSource.listAudit();
    await demoDataSource.listLabs();
    await demoDataSource.startLab('nginx-outage', { idempotencyKey: 'net-1' });
    for (let i = 0; i < 10; i++) useDemoSession.getState().nextStep();
    const incidents = await demoDataSource.listIncidents();
    for (const i of incidents.data) {
      await demoDataSource.getIncident(i.id);
      await demoDataSource.getTimeline(i.id);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  });

  it('returns copies so engine state cannot be mutated', async () => {
    const first = await demoDataSource.listResources();
    first.data[0]!.health = 'UNHEALTHY';
    const second = await demoDataSource.listResources();
    expect(second.data[0]!.health).toBe('HEALTHY');
  });

  it('maps engine errors to API errors', async () => {
    await expect(demoDataSource.getIncident('INC-NOPE')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    useDemoSession.setState({ role: 'OPERATOR' });
    await expect(
      demoDataSource.startLab('nginx-outage', { idempotencyKey: 'op-1' }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});
