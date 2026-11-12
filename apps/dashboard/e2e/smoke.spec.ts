import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGES = [
  { path: '/', heading: 'Overview', shot: 'overview' },
  { path: '/infrastructure', heading: 'Infrastructure', shot: 'infrastructure' },
  { path: '/incidents', heading: 'Incidents', shot: 'incidents' },
  { path: '/incidents/INC-DEMO-0001', heading: 'Incident Detail', shot: 'incident-detail' },
  { path: '/recovery', heading: 'Recovery Center', shot: 'recovery' },
  { path: '/simulation-lab', heading: 'Simulation Lab', shot: 'simulation-lab' },
  { path: '/analytics', heading: 'Analytics', shot: 'analytics' },
  { path: '/architecture', heading: 'Architecture', shot: 'architecture' },
  { path: '/audit', heading: 'Audit & Settings', shot: 'audit-settings' },
  { path: '/sign-in', heading: 'Sign in', shot: 'sign-in' },
];

/** Screenshots for the Phase 1 gate, saved only when SCREENSHOTS=1. */
const SHOT_DIR = process.env.SHOT_DIR ?? '../../docs/phases/phase-1/screenshots';

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page must not scroll sideways').toBeLessThanOrEqual(0);
}

/** These specs exercise the Advanced view; Easy has its own spec (easy-flow.spec.ts). */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('opsentra:preferences')) {
      localStorage.setItem(
        'opsentra:preferences',
        JSON.stringify({ state: { view: 'advanced' }, version: 0 }),
      );
    }
  });
});

test.beforeEach(async ({ page }) => {
  // Fail the test if the app tries to reach anything except itself.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === 'localhost' ? route.continue() : route.abort();
  });
  page.on('request', (req) => {
    expect(new URL(req.url()).hostname, `unexpected request to ${req.url()}`).toBe('localhost');
  });
});

for (const p of PAGES) {
  test(`${p.path} renders without clipping, with the mode banner`, async ({ page }, info) => {
    await page.goto(p.path);
    await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
    if (p.path !== '/sign-in') {
      await expect(page.getByText('DEMO — SYNTHETIC DATA').first()).toBeVisible();
    }
    await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
    await noHorizontalOverflow(page);

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

    if (process.env.SCREENSHOTS) {
      await page.screenshot({
        path: `${SHOT_DIR}/${p.shot}-${info.project.name}-dark.png`,
        fullPage: true,
      });
    }
  });
}

test('light theme passes contrast checks on the overview and incidents', async ({ page }, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'opsentra:preferences',
      JSON.stringify({ state: { theme: 'light', view: 'advanced' }, version: 0 }),
    ),
  );
  for (const path of ['/', '/incidents', '/audit']) {
    await page.goto(path);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
    expect(axe.violations.map((v) => `${v.id} on ${path}`)).toEqual([]);
    if (process.env.SCREENSHOTS) {
      const name = path === '/' ? 'overview' : path.slice(1);
      await page.screenshot({
        path: `${SHOT_DIR}/${name}-${info.project.name}-light.png`,
        fullPage: true,
      });
    }
  }
});

test('keyboard: skip link and visible focus on navigation', async ({ page }, info) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  if (info.project.name === 'desktop') {
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  }
});

test('live mode fails closed and shows no synthetic data', async ({ page }) => {
  await page.goto('/incidents');
  await expect(page.getByText('Ticketing API 5xx responses')).toBeVisible();
  await page.getByRole('button', { name: 'Live AWS' }).click();
  await expect(page.getByText('Live AWS Mode is not connected')).toBeVisible();
  await expect(page.getByText('LIVE AWS — ap-southeast-1')).toBeVisible();
  await expect(page.getByText('DEMO — SYNTHETIC DATA')).toHaveCount(0);
  await expect(page.getByText(/INC-DEMO/)).toHaveCount(0);
});

test('mobile navigation drawer opens and navigates', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Incidents' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
