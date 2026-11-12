import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 2 gate: a visitor follows Detect → Investigate → Approve → Recover and
 * reviews the audit trail entirely in the browser, with no AWS access.
 * Screenshots are saved when SCREENSHOTS=1.
 */

const SHOT_DIR = '../../docs/phases/phase-2/screenshots';

async function shot(page: Page, name: string, project: string) {
  if (process.env.SCREENSHOTS) {
    await page.screenshot({ path: `${SHOT_DIR}/${name}-${project}.png`, fullPage: true });
  }
}

async function confirm(page: Page, button: string, reason?: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (reason) await dialog.getByRole('textbox').fill(reason);
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Press "Next event" until `done` resolves true. */
async function skipUntil(page: Page, done: () => Promise<boolean>, max = 30) {
  for (let i = 0; i < max; i++) {
    if (await done()) return;
    await page.getByRole('button', { name: 'Next event' }).click();
  }
  expect(await done(), 'condition not reached').toBe(true);
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
  page.on('request', (req) => {
    expect(new URL(req.url()).hostname, `unexpected request to ${req.url()}`).toBe('localhost');
  });
});

test('Scenario A: detect, investigate, approve and verify recovery', async ({ page }, info) => {
  const p = info.project.name;
  await page.goto('/');
  await expect(
    page.getByText('Guided demo: Detect → Investigate → Approve → Recover'),
  ).toBeVisible();
  await shot(page, '01-overview-guide', p);

  await page.goto('/simulation-lab');
  await page.getByRole('button', { name: 'Start scenario' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('i-0demo7c1a2e9b4f01');
  await shot(page, '02-start-confirmation', p);
  await confirm(page, 'Start scenario');

  const incidentLink = page.getByRole('link', {
    name: 'Nginx health check failing on corporate web server',
  });
  await skipUntil(page, async () => (await incidentLink.count()) > 0);
  await shot(page, '03-detected', p);
  await incidentLink.first().click();

  await expect(page.getByRole('heading', { level: 1, name: 'Incident Detail' })).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await confirm(page, 'Acknowledge incident', 'Taking ownership');
  await page.getByRole('button', { name: 'Start investigation' }).click();
  await confirm(page, 'Start investigation');
  await page.getByRole('button', { name: 'Request recovery' }).click();
  await confirm(page, 'Request: Restart Nginx', 'Nginx is not responding');

  await page.getByRole('button', { name: 'Approve & execute' }).click();
  await expect(page.getByRole('dialog')).toContainText('lab · ap-southeast-1 (simulated)');
  await shot(page, '04-approval', p);
  await confirm(page, 'Approve & execute', 'Allowlisted restart is safe');

  const verified = page.getByText('Recovery verified by independent health checks.');
  await skipUntil(page, async () => (await verified.count()) > 0);
  await expect(page.locator('[data-tone]').getByText('Resolved', { exact: true })).toBeVisible();
  await shot(page, '05-recovered', p);

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await page.goto('/audit');
  await expect(page.getByText('Incident resolved').first()).toBeVisible();
  await shot(page, '06-audit', p);

  await page.goto('/analytics');
  await expect(page.getByText('MTTR (mean time to verified recovery)')).toBeVisible();
  await shot(page, '07-analytics', p);
});

test('SSM success but service still down escalates instead of resolving', async ({ page }) => {
  await page.goto('/simulation-lab');
  await page.getByLabel('Nginx outage, SSM success but still down').check();
  await page.getByRole('button', { name: 'Start scenario' }).first().click();
  await confirm(page, 'Start scenario');
  const link = page.getByRole('link', {
    name: 'Nginx health check failing on corporate web server',
  });
  await skipUntil(page, async () => (await link.count()) > 0);
  await link.first().click();
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await confirm(page, 'Acknowledge incident', 'on it');
  await page.getByRole('button', { name: 'Request recovery' }).click();
  await confirm(page, 'Request: Restart Nginx', 'restart');
  await page.getByRole('button', { name: 'Approve & execute' }).click();
  await confirm(page, 'Approve & execute', 'go');
  const escalated = page.getByText(/health checks failed\. Incident escalated\./);
  await skipUntil(page, async () => (await escalated.count()) > 0);
  const stateBadges = page.locator('[data-tone]');
  await expect(stateBadges.getByText('Escalated', { exact: true }).first()).toBeVisible();
  await expect(stateBadges.getByText('Resolved', { exact: true })).toHaveCount(0);
});

test('demo state survives a reload and Reset restores the baseline', async ({ page }) => {
  await page.goto('/simulation-lab');
  await page.getByRole('button', { name: 'Start scenario' }).first().click();
  await confirm(page, 'Start scenario');
  await expect(page.getByText('Current run')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Current run')).toBeVisible();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await confirm(page, 'Reset demo');
  await expect(page.getByText('Current run')).toHaveCount(0);
});
