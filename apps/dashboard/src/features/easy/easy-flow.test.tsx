import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

import { useDemoSession } from '@/modes/demo/demo-store';
import { usePreferences } from '@/stores/preferences';
import { renderRoute } from '@/test/render';

const incidentOfRun = () => {
  const e = useDemoSession.getState().engine;
  return e.incidents.find((i) => i.id === e.run?.incidentId);
};

function advanceUntil(pred: () => boolean, max = 40) {
  for (let i = 0; i < max && !pred(); i++) act(() => useDemoSession.getState().nextStep());
  if (!pred()) throw new Error('condition not reached');
}

async function confirm(name: RegExp) {
  const user = userEvent.setup();
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

beforeEach(() => {
  usePreferences.setState({ view: 'easy' });
});

describe('Easy view', () => {
  it('is the default for a new visitor', () => {
    expect(usePreferences.getInitialState().view).toBe('easy');
  });

  it('shows four plain destinations in the nav', async () => {
    renderRoute('/');
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    const links = within(nav)
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(links).toEqual(['Home', 'Incidents', 'Practice lab', 'Activity & settings']);
  });

  it('answers the overview question in one sentence with one button', async () => {
    renderRoute('/');
    expect(await screen.findByText('5 of 6 systems are working.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Practice a failure' })).toBeInTheDocument();
  });

  it('toggles to Advanced and back, and remembers the choice', async () => {
    const user = userEvent.setup();
    renderRoute('/');
    await user.click(screen.getAllByRole('button', { name: 'Advanced' })[0]!);
    expect(await screen.findByText('Monitored resources')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('opsentra:preferences') ?? '{}').state.view).toBe(
      'advanced',
    );
    await user.click(screen.getAllByRole('button', { name: 'Easy' })[0]!);
    expect(await screen.findByText('5 of 6 systems are working.')).toBeInTheDocument();
  });

  it('runs the whole outage using only the big buttons', async () => {
    const user = userEvent.setup();
    const { router } = renderRoute('/simulation-lab');
    await user.click(await screen.findByRole('button', { name: 'Break the web server' }));
    await confirm(/Break the web server/);

    advanceUntil(() => Boolean(incidentOfRun()));
    await act(() => router.navigate('/'));
    expect(await screen.findByText('1 problem needs you.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Open the problem' }));

    expect(
      await screen.findByText('The web server has a problem. Nobody owns it yet.'),
    ).toBeInTheDocument();
    for (const [button, confirmName] of [
      ['Take ownership', /Take ownership/],
      ['Look into it', /Look into it/],
      ['Ask to restart Nginx', /Ask to restart Nginx/],
      ['Approve the fix', /Approve the fix/],
    ] as const) {
      await user.click(await screen.findByRole('button', { name: button }));
      await confirm(confirmName);
    }
    expect(incidentOfRun()?.state).toBe('REMEDIATING');

    // "Skip ahead" on the page drives the system steps.
    for (let i = 0; i < 10 && incidentOfRun()?.state !== 'RESOLVED'; i++) {
      await user.click(screen.getAllByRole('button', { name: 'Skip ahead' })[0]!);
    }
    expect(
      await screen.findByText('Fixed and checked. The web server is working again.'),
    ).toBeInTheDocument();
    expect(incidentOfRun()?.verifiedHealthyAt).toBeDefined();

    // Same audit trail as Advanced.
    const corr = useDemoSession.getState().engine.run?.correlationId;
    const actions = useDemoSession
      .getState()
      .engine.audit.filter((a) => a.correlationId === corr)
      .map((a) => a.action);
    expect(actions).toContain('REMEDIATION_APPROVED');
    expect(actions.at(-1)).toBe('INCIDENT_RESOLVED');
  });

  it('as Operator, approval is disabled with a plain reason', async () => {
    const user = userEvent.setup();
    const { router } = renderRoute('/simulation-lab');
    await user.click(await screen.findByRole('button', { name: 'Break the web server' }));
    await confirm(/Break the web server/);
    advanceUntil(() => Boolean(incidentOfRun()));
    act(() => useDemoSession.setState({ role: 'OPERATOR' }));
    await act(() => router.navigate(`/incidents/${incidentOfRun()?.id}`));
    for (const [button, name] of [
      ['Take ownership', /Take ownership/],
      ['Look into it', /Look into it/],
      ['Ask to restart Nginx', /Ask to restart Nginx/],
    ] as const) {
      await user.click(await screen.findByRole('button', { name: button }));
      await confirm(name);
    }
    expect(await screen.findByRole('button', { name: 'Approve the fix' })).toBeDisabled();
    expect(
      screen.getByText(/Only an administrator can do this\. You are viewing as Operator\./),
    ).toBeInTheDocument();
  });

  it.each(['/', '/incidents', '/simulation-lab', '/audit', '/incidents/INC-DEMO-0003'])(
    '%s has no axe violations in Easy view',
    async (path) => {
      const { container } = renderRoute(path);
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(screen.queryByRole('status', { name: /loading/i })).toBeNull());
      const results = await axe(container);
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    },
  );
});
