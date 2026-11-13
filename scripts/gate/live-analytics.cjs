// Phase 8 gate: Analytics, exports and investigation links through the Live UI
// as the admin test user (env vars, never printed), then the same in Demo Mode
// to show the datasets never mix. Usage: node live-analytics.cjs <outDir> <incidentId>
// The dev server must be running on :5173 (npm run dev in apps/dashboard).
const fs = require('fs');
const { createRequire } = require('module');
const req = createRequire(require('path').resolve(__dirname, '../../apps/dashboard/package.json'));
const { chromium } = req('@playwright/test');
const [out, incidentId] = process.argv.slice(2);
const t = () => new Date().toISOString().slice(11, 19);
let failures = 0;
const check = (name, ok, extra = '') => {
  failures += ok ? 0 : 1;
  console.log(`${ok ? 'ok ' : 'BAD'} ${name}${extra ? ` (${extra})` : ''}`);
};

(async () => {
  const user = process.env.OPSENTRA_TEST_ADMIN_USER, pass = process.env.OPSENTRA_TEST_ADMIN_PASSWORD;
  if (!user || !pass || !out || !incidentId) throw new Error('usage: live-analytics.cjs <outDir> <incidentId> (test credentials in env)');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => localStorage.setItem('opsentra:preferences', JSON.stringify({ state: { view: 'advanced' }, version: 0 })));
  const p = await ctx.newPage();
  const shot = (name) => p.screenshot({ path: `${out}/${t().replace(/:/g, '')}-${name}.png`, fullPage: true });
  const nav = (label) => p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
  const grab = async (button) => {
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: button }).first().click()]);
    const file = `${out}/${dl.suggestedFilename()}`;
    await dl.saveAs(file);
    return { name: dl.suggestedFilename(), text: fs.readFileSync(file, 'utf8') };
  };
  const clean = (text) => !/\b\d{12}\b/.test(text) && !/arn:aws/.test(text);
  try {
    await p.goto('http://localhost:5173/');
    await p.getByRole('button', { name: 'Live AWS' }).click();
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForURL(/amazoncognito\.com/, { timeout: 20000 });
    await p.locator('input[name="username"]:visible').fill(user);
    await p.locator('input[name="password"]:visible').fill(pass);
    await p.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible').first().click();
    await p.waitForURL(/localhost:5173\/(?!auth)/, { timeout: 30000 });

    // Live analytics
    await nav('Analytics');
    await p.getByLabel('Time range').selectOption('7');
    await p.getByText('Dataset: live').waitFor({ timeout: 30000 });
    await p.getByText('Recovery outcomes').waitFor({ timeout: 30000 });
    check('Live analytics shows the live dataset and no demo banner', (await p.getByText('DEMO — SYNTHETIC DATA').count()) === 0);
    check('Data quality notes are shown', (await p.getByText(/Probes cover/).count()) > 0);
    await shot('live-analytics');
    const aj = await grab('Export JSON');
    const aJson = JSON.parse(aj.text);
    check('Live analytics JSON: dataset live, file named live', aJson.dataset === 'live' && aj.name.startsWith('opsentra-live-'), aj.name);
    check('Live analytics JSON: no account IDs or ARNs', clean(aj.text));
    const ac = await grab('Export CSV');
    check('Live analytics CSV: labelled LIVE, clean', ac.text.startsWith('"# LIVE AWS') && clean(ac.text), ac.name);
    const dash = await p.getByRole('link', { name: /Operations dashboard/ }).getAttribute('href');
    check('Dashboard link: region only, no account ID', /ap-southeast-1/.test(dash) && clean(dash));

    // Live incident report and investigation links
    await nav('Incidents');
    const row = p.getByRole('row').filter({ hasText: incidentId });
    await row.waitFor({ timeout: 20000 });
    await row.getByRole('link').first().click();
    await p.getByText('Investigate in CloudWatch').waitFor({ timeout: 20000 });
    const hrefs = await p.getByRole('region', { name: 'Investigate in CloudWatch' }).getByRole('link').evaluateAll((as) => as.map((a) => a.href));
    check('Incident links: alarm, 4 log searches, dashboard', hrefs.length === 6, `${hrefs.length} links`);
    check('Incident links: all clean and filtered by the incident ID', hrefs.every(clean) && hrefs.filter((h) => h.includes(incidentId)).length === 4);
    await shot('live-incident-report');
    const ij = await grab('Export JSON');
    const iJson = JSON.parse(ij.text);
    check('Incident JSON: live, this incident, measured from verified health', iJson.dataset === 'live' && iJson.incident.id === incidentId && typeof iJson.measurements.timeToVerifiedRecoverySeconds === 'number', ij.name);
    check('Incident JSON: no account IDs or ARNs', clean(ij.text));

    // Demo Mode: same pages, synthetic data, labelled
    await p.getByRole('button', { name: 'Demo' }).click();
    await nav('Analytics');
    await p.getByText('Dataset: synthetic').waitFor({ timeout: 20000 });
    check('Demo analytics shows the demo banner', (await p.getByText('DEMO — SYNTHETIC DATA').count()) > 0);
    const dj = await grab('Export JSON');
    const dJson = JSON.parse(dj.text);
    check('Demo export: synthetic, labelled, named DEMO', dJson.dataset === 'synthetic' && dJson.label === 'DEMO — SYNTHETIC DATA' && dj.name.startsWith('opsentra-DEMO-synthetic-'), dj.name);
    check('Demo export contains no live incident IDs', !dj.text.includes('INC-2026111'));
    await shot('demo-analytics');
  } catch (err) {
    failures += 1;
    await shot('error').catch(() => {});
    console.error(t(), 'FAILED:', err.message);
  } finally {
    await b.close();
    console.log(failures ? `FAILURES: ${failures}` : 'ALL CHECKS PASSED');
    process.exitCode = failures ? 1 : 0;
  }
})();
