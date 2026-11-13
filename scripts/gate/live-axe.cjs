// Phase 9 gate: axe (WCAG 2.0/2.1/2.2 A and AA) on every Live AWS screen as the
// admin test user (env vars, never printed). Demo screens are covered by the
// Playwright E2E suite; this adds the Live-only states (Simulation Lab panel,
// Live analytics, report card and CloudWatch links).
// Usage: node live-axe.cjs <outDir> <incidentId> <label>
// The dev server must be running on :5173 (npm run dev in apps/dashboard).
const { createRequire } = require('module');
const req = createRequire(require('path').resolve(__dirname, '../../apps/dashboard/package.json'));
const { chromium } = req('@playwright/test');
// The dashboard under test: local dev by default, or the published site.
const UI = (process.env.OPSENTRA_UI_URL || 'http://localhost:5173/').replace(/\/?$/, '/');
const AxeBuilder = req('@axe-core/playwright').default;
const [out, incidentId, label = 'live'] = process.argv.slice(2);

(async () => {
  const user = process.env.OPSENTRA_TEST_ADMIN_USER, pass = process.env.OPSENTRA_TEST_ADMIN_PASSWORD;
  if (!user || !pass || !out || !incidentId) throw new Error('usage: live-axe.cjs <outDir> <incidentId> [label] (test credentials in env)');
  const b = await chromium.launch();
  let failures = 0;
  try {
  for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem('opsentra:preferences', JSON.stringify({ state: { view: 'advanced', theme: t }, version: 0 })), theme);
    const p = await ctx.newPage();
    await p.goto(UI + 'overview');
    await p.getByRole('button', { name: 'Live AWS' }).click();
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForURL(/amazoncognito\.com/, { timeout: 20000 });
    await p.locator('input[name="username"]:visible').fill(user);
    await p.locator('input[name="password"]:visible').fill(pass);
    await p.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible').first().click();
    await p.waitForURL((u) => (u.href + '/').startsWith(UI) && !u.pathname.includes('/auth/'), { timeout: 30000 });
    const nav = (name) => p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
    const pages = [
      ['Overview', null],
      ['Infrastructure', null],
      ['Incidents', null],
      ['Incident detail', async () => {
        await nav('Incidents');
        const row = p.getByRole('row').filter({ hasText: incidentId });
        await row.waitFor({ timeout: 20000 });
        await row.getByRole('link').first().click();
        await p.getByText('Report').first().waitFor({ timeout: 20000 });
      }],
      ['Recovery Center', null],
      ['Simulation Lab', async () => {
        await nav('Simulation Lab');
        await p.getByText(/^Scenario A:|The live lab is off/).first().waitFor({ timeout: 30000 });
      }],
      ['Analytics', async () => {
        await nav('Analytics');
        await p.getByText('Dataset: live').waitFor({ timeout: 30000 });
      }],
      ['Audit & Settings', null],
    ];
    for (const [name, open] of pages) {
      if (open) await open();
      else await nav(name);
      await p.waitForLoadState('networkidle');
      await p.getByRole('status', { name: /loading/i }).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
      if ((await p.getByText('DEMO — SYNTHETIC DATA').count()) > 0) throw new Error(`demo banner on Live ${name}`);
      // Never audit an error page as if it were the screen (Phase 9 lesson).
      if ((await p.getByText(/Live AWS Mode is unavailable|could not be reached/).count()) > 0) {
        throw new Error(`Live error state on ${name}`);
      }
      const axe = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const v = axe.violations.map((x) => `${x.id} (${x.nodes.length})`);
      failures += v.length;
      console.log(`${v.length ? 'BAD' : 'ok '} ${label} ${theme} ${name}${v.length ? `: ${v.join(', ')}` : ''}`);
      if (name === 'Simulation Lab') await p.screenshot({ path: `${out}/${label}-${theme}-simulation-lab.png`, fullPage: true });
    }
    await ctx.close();
  }
  } finally {
    await b.close(); // always, so a failed step never leaves the process hanging
  }
  console.log(failures ? `VIOLATIONS: ${failures}` : 'NO AXE VIOLATIONS');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
});
