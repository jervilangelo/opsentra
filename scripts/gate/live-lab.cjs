// Phase 7 gate: drive the Live Simulation Lab through the UI as the admin test
// user (env vars, never printed). Usage: node live-lab.cjs <outDir> <mode>
//   start   check preflight, start "Stop Nginx", wait for the run, screenshot
//   watch   poll until the run links an incident (or ends), screenshot
//   reset   reset the active run (restart Nginx), screenshot
//   shot    screenshot the lab page and the Audit page
// The dev server must be running on :5173 (npm run dev in apps/dashboard).
const { createRequire } = require('module');
const req = createRequire(require('path').resolve(__dirname, '../../apps/dashboard/package.json'));
const { chromium } = req('@playwright/test');
const [out, mode] = process.argv.slice(2);
const t = () => new Date().toISOString().slice(11, 19);

(async () => {
  const user = process.env.OPSENTRA_TEST_ADMIN_USER, pass = process.env.OPSENTRA_TEST_ADMIN_PASSWORD;
  if (!user || !pass) throw new Error('test credentials not set');
  if (!out || !['start', 'watch', 'reset', 'shot'].includes(mode)) throw new Error('usage: live-lab.cjs <outDir> start|watch|reset|shot');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('opsentra:preferences', JSON.stringify({ state: { view: 'advanced' }, version: 0 })));
  const p = await ctx.newPage();
  const shot = (name) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  try {
    await p.goto('http://localhost:5173/');
    await p.getByRole('button', { name: 'Live AWS' }).click();
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForURL(/amazoncognito\.com/, { timeout: 20000 });
    await p.locator('input[name="username"]:visible').fill(user);
    await p.locator('input[name="password"]:visible').fill(pass);
    await p.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible').first().click();
    await p.waitForURL(/localhost:5173\/(?!auth)/, { timeout: 30000 });
    if ((await p.getByText('DEMO — SYNTHETIC DATA').count()) > 0) throw new Error('demo banner in Live');
    const nav = (label) => p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
    await nav('Simulation Lab');
    await p.getByText(/Preflight checks|Current run|The live lab is off/).first().waitFor({ timeout: 30000 });

    if (mode === 'start') {
      await shot(`${t().replace(/:/g, '')}-lab-preflight`);
      const startBtn = p.getByRole('button', { name: 'Start live scenario' });
      if (await startBtn.isDisabled()) throw new Error('preflight not passing; see screenshot');
      await startBtn.click();
      await p.getByRole('dialog').getByRole('button', { name: 'Stop Nginx now' }).click();
      await p.getByRole('region', { name: 'Current run' }).waitFor({ timeout: 30000 });
      console.log(t(), 'run started:', (await p.getByRole('region', { name: 'Current run' }).getByRole('status').textContent()).trim());
      await shot(`${t().replace(/:/g, '')}-lab-started`);
    } else if (mode === 'watch') {
      const deadline = Date.now() + 10 * 60_000;
      for (;;) {
        const run = p.getByRole('region', { name: 'Current run' });
        if ((await run.count()) === 0) { console.log(t(), 'no active run'); break; }
        if ((await run.getByRole('link').count()) > 0) { console.log(t(), 'incident linked:', (await run.getByRole('link').first().textContent()).trim()); break; }
        if (Date.now() > deadline) throw new Error('no incident within 10 minutes');
        await p.waitForTimeout(15000);
      }
      await shot(`${t().replace(/:/g, '')}-lab-watch`);
    } else if (mode === 'reset') {
      await p.getByRole('button', { name: /Reset scenario|Restart Nginx \(cleanup\)/ }).first().click();
      await p.getByRole('dialog').getByRole('button', { name: 'Restart Nginx' }).click();
      await p.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 });
      console.log(t(), 'reset sent');
      await shot(`${t().replace(/:/g, '')}-lab-reset`);
    } else {
      await shot(`${t().replace(/:/g, '')}-lab`);
      await nav('Audit');
      await p.getByRole('table').first().waitFor({ timeout: 20000 });
      await shot(`${t().replace(/:/g, '')}-audit`);
    }
  } catch (err) {
    await shot(`${t().replace(/:/g, '')}-error`).catch(() => {});
    console.error(t(), 'FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await b.close();
  }
})();
