import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useDemoSession } from '@/modes/demo/demo-store';
import { renderRoute } from '@/test/render';

/** Jumps the simulated clock until `pred` holds (bounded). */
function advanceUntil(pred: () => boolean, max = 40) {
  for (let i = 0; i < max && !pred(); i++) {
    act(() => useDemoSession.getState().nextStep());
  }
  if (!pred()) throw new Error('condition not reached');
}

const runIncidentId = () => useDemoSession.getState().engine.run?.incidentId;
const runIncident = () => {
  const e = useDemoSession.getState().engine;
  return e.incidents.find((i) => i.id === e.run?.incidentId);
};

async function confirmIn(dialogName: RegExp, button: string, reason?: string) {
  const user = userEvent.setup();
  const dialog = await screen.findByRole('dialog', { name: dialogName });
  if (reason) await user.type(within(dialog).getByRole('textbox'), reason);
  await user.click(within(dialog).getByRole('button', { name: button }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

// Phase 2 gate: Detect → Investigate → Approve → Recover, with audit, no AWS.
describe('guided Demo Mode flow', () => {
  it('runs Scenario A from fault injection to verified recovery', async () => {
    const user = userEvent.setup();
    const { router } = renderRoute('/simulation-lab');

    const startButtons = await screen.findAllByRole('button', { name: 'Start scenario' });
    await user.click(startButtons[0]!);
    await confirmIn(/Start: Nginx outage, verified recovery/, 'Start scenario');

    advanceUntil(() => Boolean(runIncidentId()));
    await act(() => router.navigate(`/incidents/${runIncidentId()}`));
    expect(
      await screen.findByRole('heading', { name: /Nginx health check failing/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('HEALTH_PROBE_FAILED').length).toBeGreaterThanOrEqual(3);

    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await confirmIn(/Acknowledge incident/, 'Acknowledge incident', 'Taking ownership');
    expect(runIncident()?.state).toBe('ACKNOWLEDGED');

    await user.click(await screen.findByRole('button', { name: 'Start investigation' }));
    await confirmIn(/Start investigation/, 'Start investigation');

    await user.click(await screen.findByRole('button', { name: 'Request recovery' }));
    await confirmIn(/Request: Restart Nginx/, 'Request: Restart Nginx', 'Nginx is down');
    expect(await screen.findByText('Waiting for Administrator approval.')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Approve & execute' }));
    await confirmIn(/Approve & execute/, 'Approve & execute', 'Safe allowlisted restart');

    advanceUntil(() => runIncident()?.state === 'RESOLVED');
    expect(
      await screen.findByText('Recovery verified by independent health checks.'),
    ).toBeInTheDocument();
    expect(runIncident()?.verifiedHealthyAt).toBeDefined();

    await act(() => router.navigate('/audit'));
    expect(await screen.findAllByText('Incident resolved')).not.toHaveLength(0);
  }, 15_000); // a full UI walk-through; the 5 s default flakes under full-suite load

  it('as Operator, approval is not offered and the reason is explained', async () => {
    const user = userEvent.setup();
    const { router } = renderRoute('/simulation-lab');
    await user.click((await screen.findAllByRole('button', { name: 'Start scenario' }))[0]!);
    await confirmIn(/Start:/, 'Start scenario');
    advanceUntil(() => Boolean(runIncidentId()));

    act(() => useDemoSession.setState({ role: 'OPERATOR' }));
    await act(() => router.navigate(`/incidents/${runIncidentId()}`));
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await confirmIn(/Acknowledge incident/, 'Acknowledge incident', 'mine');
    await user.click(await screen.findByRole('button', { name: 'Request recovery' }));
    await confirmIn(/Request:/, 'Request: Restart Nginx', 'restart');

    expect(await screen.findByRole('button', { name: 'Approve & execute' })).toBeDisabled();
    expect(
      screen.getByText(/Approve & execute requires the Administrator role/),
    ).toBeInTheDocument();
  });

  it('a viewer cannot start a scenario', async () => {
    act(() => useDemoSession.setState({ role: 'VIEWER' }));
    renderRoute('/simulation-lab');
    const buttons = await screen.findAllByRole('button', { name: 'Start scenario' });
    for (const b of buttons) expect(b).toBeDisabled();
  });
});
