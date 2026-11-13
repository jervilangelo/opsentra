import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Easy view (ADR-013), the default for new visitors: the whole outage using
 * only the big buttons, on desktop and phone, with no network beyond the app.
 */

const SHOT_DIR = '../../docs/phases/phase-2/screenshots';

async function shot(page: Page, name: string, project: string) {
  if (process.env.SCREENSHOTS) {
    await page.screenshot({ path: `${SHOT_DIR}/easy-${name}-${project}.png`, fullPage: true });
  }
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page must not scroll sideways').toBeLessThanOrEqual(0);
}

async function a11y(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function confirm(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  page.on('request', (req) => {
    expect(new URL(req.url()).hostname, `unexpected request to ${req.url()}`).toBe('localhost');
  });
});

test('Easy view: practice outage from start to verified fix', async ({ page }, info) => {
  const p = info.project.name;
  await page.goto('/overview');
  await expect(page.getByText('5 of 6 systems are working.')).toBeVisible();
  await noSideScroll(page);
  await a11y(page);
  await shot(page, '01-home', p);

  await page.getByRole('link', { name: 'Practice a failure' }).click();
  await page.getByRole('button', { name: 'Break the web server' }).click();
  await expect(page.getByRole('dialog')).toContainText('i-0demo7c1a2e9b4f01');
  await confirm(page, 'Break the web server');

  const skip = page.getByRole('button', { name: 'Skip ahead' }).first();
  const openLink = page.getByRole('link', { name: 'Open the problem' });
  for (let i = 0; i < 10 && (await openLink.count()) === 0; i++) await skip.click();
  await openLink.first().click();

  await expect(page.getByText('The web server has a problem. Nobody owns it yet.')).toBeVisible();
  await noSideScroll(page);
  await a11y(page);
  await shot(page, '02-problem', p);

  for (const step of ['Take ownership', 'Look into it', 'Ask to restart Nginx']) {
    await page.getByRole('button', { name: step, exact: true }).click();
    await confirm(page, step);
  }
  await page.getByRole('button', { name: 'Approve the fix', exact: true }).click();
  await shot(page, '03-approve', p);
  await confirm(page, 'Approve the fix');

  const fixed = page.getByText('Fixed and checked. The web server is working again.');
  for (let i = 0; i < 12 && (await fixed.count()) === 0; i++) await skip.click();
  await expect(fixed).toBeVisible();
  await noSideScroll(page);
  await a11y(page);
  await shot(page, '04-fixed', p);
});

test('Easy nav hides the advanced pages, and the toggle switches views', async ({ page }, info) => {
  await page.goto('/overview');
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('link', { name: 'Analytics' })).toHaveCount(0);
    await drawer.getByRole('button', { name: 'Advanced' }).click();
    await expect(drawer.getByRole('link', { name: 'Analytics' })).toBeVisible();
  } else {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveCount(4);
    await page
      .getByRole('group', { name: 'View' })
      .getByRole('button', { name: 'Advanced' })
      .click();
    await expect(nav.getByRole('link')).toHaveCount(8);
    await page.reload();
    await expect(nav.getByRole('link')).toHaveCount(8);
  }
});
