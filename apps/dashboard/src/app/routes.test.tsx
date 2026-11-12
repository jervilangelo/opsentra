import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

import { DEMO_LABEL } from '@/components/mode/ModeBadge';
import { NAV_ITEMS } from '@/features/navigation/nav';
import { useModeStore } from '@/modes/mode-store';
import { renderRoute } from '@/test/render';

const PAGES = [
  ...NAV_ITEMS.map((n) => ({ path: n.path, heading: n.heading })),
  { path: '/incidents/INC-DEMO-0002', heading: 'Incident Detail' },
];

describe('routes', () => {
  it.each(PAGES)('$path renders its heading and the demo banner', async ({ path, heading }) => {
    renderRoute(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_LABEL).length).toBeGreaterThan(0);
  });

  it.each(PAGES)('$path has no axe violations', async ({ path, heading }) => {
    const { container } = renderRoute(path);
    await screen.findByRole('heading', { level: 1, name: heading });
    // Let queries settle so the final DOM is checked.
    await waitFor(() => expect(screen.queryByRole('status', { name: /loading/i })).toBeNull());
    const results = await axe(container);
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it('sidebar lists all eight top-level pages', () => {
    renderRoute('/');
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: item.label })).toBeInTheDocument();
    }
  });

  it('shows the not-found page for unknown routes', async () => {
    renderRoute('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('shows not-found for an unknown incident', async () => {
    renderRoute('/incidents/INC-NOPE');
    expect(await screen.findByText('Incident not found')).toBeInTheDocument();
  });

  it('sign-in page has no password field', async () => {
    const { container } = renderRoute('/sign-in');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('renders demo fixture data on the incidents page', async () => {
    renderRoute('/incidents');
    expect(await screen.findByText('Ticketing API 5xx responses')).toBeInTheDocument();
  });
});

describe('live mode fails closed in the UI', () => {
  it.each([
    '/',
    '/infrastructure',
    '/incidents',
    '/incidents/INC-DEMO-0002',
    '/recovery',
    '/simulation-lab',
    '/analytics',
    '/audit',
  ])('%s shows the not-connected error and no fixture data', async (path) => {
    useModeStore.setState({ mode: 'live' });
    renderRoute(path);
    expect(await screen.findByText('Live AWS Mode is not connected')).toBeInTheDocument();
    expect(screen.queryByText(/INC-DEMO|i-0demo|HarborPoint sandbox/)).toBeNull();
    expect(screen.queryByText(DEMO_LABEL)).toBeNull();
    expect(screen.getByText(/LIVE AWS — ap-southeast-1/)).toBeInTheDocument();
  });

  it('switching from demo to live replaces the data with the error', async () => {
    const user = userEvent.setup();
    renderRoute('/incidents');
    await screen.findByText('Ticketing API 5xx responses');
    await user.click(screen.getByRole('button', { name: 'Live AWS' }));
    expect(await screen.findByText('Live AWS Mode is not connected')).toBeInTheDocument();
    expect(screen.queryByText('Ticketing API 5xx responses')).toBeNull();
    // Demo-only controls disappear in Live mode.
    expect(screen.queryByRole('button', { name: 'Reset demo' })).toBeNull();
  });
});
