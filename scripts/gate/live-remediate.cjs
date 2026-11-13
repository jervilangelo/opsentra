// Phase 6 gate: drive recovery through the Live UI with test users (env vars,
// never printed). Usage: node live-remediate.cjs <outDir> <incidentId> <mode>
//   request  operator: acknowledge, investigate, request "Restart Nginx"
//   approve  admin: approve, then watch until Resolved/Escalated (screenshots)
//   self     admin: acknowledge, investigate, request and approve (self-approval)
//   watch    operator: watch until Resolved/Escalated, screenshot
//   shot     admin: screenshot the incident, Recovery Center and Audit
const { createRequire } = require('module');
const req = createRequire(require('path').resolve(__dirname, '../../apps/dashboard/package.json'));
const { chromium } = req('@playwright/test');
// The dashboard under test: local dev by default, or the published site.
const UI = (process.env.OPSENTRA_UI_URL || 'http://localhost:5173/').replace(/\/?$/, '/');
const [out, incidentId, mode] = process.argv.slice(2);
let page;
const t = () => new Date().toISOString().slice(11, 19);

(async () => {
  const role = ['request', 'watch'].includes(mode) ? 'OPERATOR' : 'ADMIN';
  const user = process.env[`OPSENTRA_TEST_${role}_USER`], pass = process.env[`OPSENTRA_TEST_${role}_PASSWORD`];
  if (!user || !pass) throw new Error('test credentials not set');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('opsentra:preferences', JSON.stringify({ state: { view: 'advanced' }, version: 0 })));
  const p = await ctx.newPage();
  page = p;
  await p.goto(UI + 'overview');
  await p.getByRole('button', { name: 'Live AWS' }).click();
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL(/amazoncognito\.com/, { timeout: 20000 });
  await p.locator('input[name="username"]:visible').fill(user);
  await p.locator('input[name="password"]:visible').fill(pass);
  await p.locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible').first().click();
  await p.waitForURL((u) => (u.href + '/').startsWith(UI) && !u.pathname.includes('/auth/'), { timeout: 30000 });
  const live = async () => {
    if ((await p.getByText('LIVE AWS — ap-southeast-1').count()) < 1) throw new Error('not in Live mode');
    if ((await p.getByText('DEMO — SYNTHETIC DATA').count()) > 0) throw new Error('demo banner in Live');
  };
  const nav = (label) => p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
  const state = () => p.getByRole('status').filter({ hasText: 'Incident state:' }).first().textContent();
  const stateIs = (label, ms = 30000) =>
    p.getByRole('status').filter({ hasText: label instanceof RegExp ? label : `Incident state: ${label}` }).waitFor({ state: 'attached', timeout: ms });
  const dialogConfirm = async (name, reasonLabel, reason) => {
    const dlg = p.getByRole('dialog');
    if (reasonLabel) await dlg.getByLabel(new RegExp(reasonLabel)).fill(reason);
    await dlg.getByRole('button', { name }).click();
  };
  const openIncident = async () => {
    await nav('Incidents');
    const row = p.getByRole('row').filter({ hasText: incidentId });
    await row.waitFor({ timeout: 20000 });
    await row.getByRole('link').first().click();
    await p.getByText('Timeline').first().waitFor({ timeout: 20000 });
    await live();
  };
  const request = async () => {
    if (/state: Open/.test(await state())) {
      await p.getByRole('button', { name: 'Acknowledge', exact: true }).click();
      await dialogConfirm('Acknowledge incident', 'Reason', 'Gate test: taking ownership');
      await stateIs('Acknowledged');
    }
    if (/state: Acknowledged/.test(await state())) {
      await p.getByRole('button', { name: 'Start investigation' }).click();
      await dialogConfirm('Start investigation');
      await stateIs('Investigating');
    }
    await p.getByRole('button', { name: /Request recovery/ }).click();
    await p.getByRole('dialog').getByRole('radio', { name: /Restart Nginx/ }).check();
    await dialogConfirm(/^Request: Restart Nginx/, 'Why this runbook', 'Nginx stopped; restart is the allowlisted fix');
    await stateIs('Awaiting approval');
    console.log(t(), 'requested (confirmed by backend)');
  };
  const approve = async () => {
    await p.getByRole('button', { name: 'Approve & execute' }).click();
    await dialogConfirm('Approve & execute', 'Approval reason', 'Gate test: lab restart approved');
    await stateIs(/Incident state: (Remediating|Verifying|Resolved|Escalated)/, 30000);
    console.log(t(), 'approved (confirmed by backend):', await state());
  };
  const watch = async () => {
    let last = '';
    for (let i = 0; i < 120; i++) {
      const s = await state();
      if (s !== last) {
        console.log(t(), s);
        last = s;
        const tag = s.replace('Incident state: ', '').toLowerCase().replace(/\s+/g, '-');
        await p.screenshot({ path: `${out}/live-${mode}-${tag}.png`, fullPage: true });
      }
      if (/Resolved|Escalated/.test(s)) break;
      await p.waitForTimeout(5000);
    }
    const items = await p.locator('ol li').allTextContents();
    console.log('timeline:', items.map((x) => x.replace(/\s+/g, ' ').slice(0, 110)));
  };

  if (mode === 'shot') {
    await openIncident();
    await p.screenshot({ path: `${out}/live-incident-${incidentId}.png`, fullPage: true });
    await nav('Recovery Center');
    await p.getByText(incidentId).first().waitFor({ timeout: 20000 });
    await live();
    await p.screenshot({ path: `${out}/live-recovery-center.png`, fullPage: true });
    await nav('Audit & Settings');
    await p.getByText(/Incident opened/).first().waitFor({ timeout: 20000 });
    await p.screenshot({ path: `${out}/live-audit.png`, fullPage: true });
    console.log('shots taken');
  } else {
    await openIncident();
    if (mode === 'request') await request();
    if (mode === 'self') {
      await request();
      await approve();
    }
    if (mode === 'approve') await approve();
    if (mode !== 'request') await watch();
  }
  await b.close();
})().catch(async (e) => {
  console.error('FAILED:', e.message.split('\n')[0]);
  if (page) {
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'opsentra-gate-debug.png'), fullPage: true });
    console.error('dialog:', (await page.getByRole('dialog').allTextContents()).join(' | ').slice(0, 600));
  }
  process.exit(1);
});
