import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/* Public landing and about pages (ADR-022). */

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page must not scroll sideways').toBeLessThanOrEqual(0);
}

async function a11y(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test('landing page: brand, tagline, calls to action, accessible in both themes', async ({
  page,
}) => {
  for (const theme of ['dark', 'light']) {
    await page.addInitScript(
      (t) =>
        localStorage.setItem(
          'opsentra:preferences',
          JSON.stringify({ state: { theme: t }, version: 0 }),
        ),
      theme,
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Opsentra' })).toBeVisible();
    for (const word of ['Monitor.', 'Detect.', 'Respond.', 'Recover.']) {
      await expect(page.getByText(word, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Explore the live demo' })).toHaveAttribute(
      'href',
      /\/overview$/,
    );
    await expect(page.getByRole('link', { name: /Star on GitHub/ }).first()).toHaveAttribute(
      'href',
      'https://github.com/jervilangelo/opsentra',
    );
    // Let entrance animations finish so contrast is checked on the final state.
    await page.waitForTimeout(2500);
    await noSideScroll(page);
    await a11y(page);
  }
});

test('the star prompt appears, links to GitHub, and "Not now" is remembered', async ({ page }) => {
  await page.goto('/');
  const prompt = page.getByRole('complementary', { name: 'Star Opsentra on GitHub' });
  await expect(prompt).toBeVisible({ timeout: 8000 });
  await expect(prompt.getByRole('link', { name: /Star on GitHub/ })).toHaveAttribute(
    'href',
    'https://github.com/jervilangelo/opsentra',
  );
  await a11y(page);
  await prompt.getByRole('button', { name: 'Not now' }).click();
  await expect(prompt).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(5000);
  await expect(page.getByRole('complementary', { name: 'Star Opsentra on GitHub' })).toHaveCount(0);
});

test('about page credits the author, the certification and the website', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1, name: 'About Opsentra' })).toBeVisible();
  await expect(page.getByText('Jervil Angelo De Leon').first()).toBeVisible();
  await expect(page.getByText(/AWS Certified Cloud Practitioner \(CLF-C02\)/)).toBeVisible();
  await expect(page.getByRole('link', { name: /jervilangelo\.online/ }).first()).toHaveAttribute(
    'href',
    'https://jervilangelo.online',
  );
  await page.waitForTimeout(1500);
  await noSideScroll(page);
  await a11y(page);
});

test('the dashboard is one click away and still Demo by default', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Open the dashboard' }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('DEMO — SYNTHETIC DATA').first()).toBeVisible();
});

test('with reduced motion everything is visible at once', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  // No waiting for animations: the final state must already be shown.
  await expect(page.getByText('Recover.', { exact: true })).toBeVisible();
  const opacity = await page
    .getByText('Recover.', { exact: true })
    .evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBeGreaterThan(0.99);
  await context.close();
});
