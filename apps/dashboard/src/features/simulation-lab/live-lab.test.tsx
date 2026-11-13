import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import type * as DataHooks from '@/modes/data-hooks';
import { testQueryClient } from '@/test/render';
import type { ApiSuccess } from '@/types/api';
import type { LabScenario, Role } from '@/types/domain';

/*
 * Live Simulation Lab panel (ADR-018). The data source is stubbed at the
 * liveDataSource boundary; the backend is what enforces roles and preflight.
 */

const role = vi.hoisted(() => ({ current: 'ADMIN' as Role | undefined }));
const live = vi.hoisted(() => ({
  listLabs: vi.fn(),
  startLab: vi.fn(),
  resetLab: vi.fn(),
}));

vi.mock('@/modes/session', () => ({ useCurrentRole: () => role.current }));
vi.mock('@/modes/data-hooks', async (orig) => {
  const real = await orig<typeof DataHooks>();
  const { useMutation, useQuery } = await import('@tanstack/react-query');
  return {
    ...real,
    useLabs: () => useQuery({ queryKey: ['live', 'labs'], queryFn: live.listLabs }),
    useStartLab: () =>
      useMutation({
        mutationFn: (v: { scenarioId: string; input: { idempotencyKey: string } }) =>
          live.startLab(v.scenarioId, v.input),
      }),
    useResetLab: () =>
      useMutation({
        mutationFn: (v: { scenarioId: string; input: { idempotencyKey: string } }) =>
          live.resetLab(v.scenarioId, v.input),
      }),
  };
});

const { LiveLab } = await import('./LiveLab');

const meta = { requestId: 'r', generatedAt: '2026-11-13T00:00:00Z', dataset: 'live' as const };
const ok = <T,>(data: T): ApiSuccess<T> => ({ data, meta });

const ready: LabScenario = {
  id: 'nginx-outage',
  group: 'A',
  title: 'Stop Nginx on the lab web server',
  summary: 'Stops Nginx through a fixed SSM document.',
  expectedOutcome: 'An incident opens within about 4 minutes.',
  resourceId: 'i-0lab',
  runbookId: 'rb-restart-nginx',
  available: true,
  labExpiresAt: '2026-11-13T04:00:00Z',
  preflight: [
    { id: 'registered', label: 'Lab deployed and registered', ok: true },
    { id: 'baseline', label: 'Service healthy on a recent probe', ok: true },
  ],
};

function renderLab() {
  const router = createMemoryRouter([{ path: '/', element: <LiveLab /> }]);
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role.current = 'ADMIN';
  live.listLabs.mockReset();
  live.startLab.mockReset();
  live.resetLab.mockReset();
});

describe('Live Simulation Lab', () => {
  it('shows preflight checks, the target and the cost disclosure', async () => {
    live.listLabs.mockResolvedValue(ok([ready]));
    renderLab();
    expect(await screen.findByText('Lab deployed and registered')).toBeInTheDocument();
    expect(screen.getByText('i-0lab')).toBeInTheDocument();
    expect(screen.getByText(/US\$0\.01–0\.02 per hour/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start live scenario/i })).toBeEnabled();
  });

  it('labels failed checks in text, not colour alone, and blocks the start', async () => {
    live.listLabs.mockResolvedValue(
      ok([
        {
          ...ready,
          available: false,
          unavailableReason: 'Last probe: UNHEALTHY at 2026-11-13T00:00:00Z.',
          preflight: [
            {
              id: 'baseline',
              label: 'Service healthy on a recent probe',
              ok: false,
              detail: 'Last probe: UNHEALTHY.',
            },
          ],
        },
      ]),
    );
    renderLab();
    expect(await screen.findByText('Failed:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start live scenario/i })).toBeDisabled();
    expect(screen.getByText(/Last probe: UNHEALTHY at/)).toBeInTheDocument();
  });

  it('starts only after confirmation and sends only an idempotency key', async () => {
    live.listLabs.mockResolvedValue(ok([ready]));
    live.startLab.mockResolvedValue(ok(ready));
    renderLab();
    await userEvent.click(await screen.findByRole('button', { name: /start live scenario/i }));
    expect(live.startLab).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('i-0lab')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /stop nginx now/i }));
    await waitFor(() => expect(live.startLab).toHaveBeenCalledTimes(1));
    const [id, input] = live.startLab.mock.calls[0]!;
    expect(id).toBe('nginx-outage');
    expect(Object.keys(input as object)).toEqual(['idempotencyKey']);
  });

  it('keeps the dialog open with the backend error when the start is refused', async () => {
    live.listLabs.mockResolvedValue(ok([ready]));
    const { ApiRequestError } = await import('@/api/errors');
    live.startLab.mockRejectedValue(
      new ApiRequestError(409, 'LAB_BUSY', 'Another scenario started first.'),
    );
    renderLab();
    await userEvent.click(await screen.findByRole('button', { name: /start live scenario/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /stop nginx now/i }));
    expect(await within(dialog).findByText(/Another scenario started first/)).toBeInTheDocument();
  });

  it('shows the active run, its incident link and a reset that never claims recovery', async () => {
    live.listLabs.mockResolvedValue(
      ok([
        {
          ...ready,
          available: false,
          activeRun: {
            runId: 'LAB-20261113-ABC123',
            scenarioId: 'nginx-outage',
            resourceId: 'i-0lab',
            status: 'ACTIVE',
            injection: 'SUCCEEDED',
            startedAt: '2026-11-13T00:00:00Z',
            startedBy: 'opsentra-admin',
            expiresAt: '2026-11-13T00:45:00Z',
            incidentId: 'INC-20261113-AAAAAA',
          },
        },
      ]),
    );
    renderLab();
    expect(await screen.findByText('LAB-20261113-ABC123')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /INC-20261113-AAAAAA/ })).toBeInTheDocument();
    expect(screen.getByText(/does not mark the incident resolved/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start live scenario/i })).toBeNull();
    expect(screen.getByRole('button', { name: /reset scenario/i })).toBeInTheDocument();
  });

  it('offers Demo Mode when the lab is not deployed', async () => {
    live.listLabs.mockResolvedValue(
      ok([
        {
          ...ready,
          resourceId: '',
          available: false,
          unavailableReason: 'The live lab is not deployed.',
        },
      ]),
    );
    renderLab();
    expect(await screen.findByText('The live lab is off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /demo mode/i })).toBeInTheDocument();
  });

  it('never queries the lab for non-admins', async () => {
    role.current = 'OPERATOR';
    renderLab();
    expect(await screen.findByText(/for administrators/)).toBeInTheDocument();
    expect(live.listLabs).not.toHaveBeenCalled();
  });
});
