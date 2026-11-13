import { expect, test } from '@playwright/test';

/*
 * Phase 9 (finding F5): the production build ships a Content Security Policy,
 * and the app works under it. E2E runs against `npm run build && npm run
 * preview`, so the policy here is the one users get.
 */

const PATHS = [
  '/',
  '/infrastructure',
  '/incidents',
  '/incidents/INC-DEMO-0001',
  '/recovery',
  '/simulation-lab',
  '/analytics',
  '/architecture',
  '/audit',
  '/sign-in',
];

test('the production build carries a strict CSP', async ({ page }) => {
  await page.goto('/');
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toBeTruthy();
  const policy = csp ?? '';
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'self'");
  // Scripts: this origin and hashed inline scripts only.
  const scripts = /script-src ([^;]+)/.exec(policy)?.[1] ?? '';
  expect(
    scripts.split(' ').every((s) => s === "'self'" || /^'sha256-[A-Za-z0-9+/=]+'$/.test(s)),
  ).toBe(true);
  expect(scripts).not.toContain('unsafe');
});

test('every page and a report export run with no CSP violation or script error', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) {
      problems.push(m.text());
    }
  });
  page.on('pageerror', (e) => problems.push(e.message));

  for (const path of PATHS) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
  }

  // Exports use a Blob download, which the policy must not block.
  await page.goto('/analytics');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^opsentra-DEMO-synthetic-analytics-\d+d\.json$/);

  expect(problems).toEqual([]);
});
