// Phase 10: smoke-check a published (or locally previewed) site as an anonymous
// visitor. Usage: node check_site.cjs <siteUrl>   e.g. https://jervilangelo.github.io/opsentra/
// Checks: Demo Mode loads with no sign-in and shows DEMO — SYNTHETIC DATA; deep
// links work (GitHub Pages 404.html fallback); the guided scenario starts; Live
// mode asks for sign-in and shows no data; no CSP violation or script error.
// --expect-live: the build must have Live config (a Sign in button in Live
// mode, and a CSP whose connect-src is exactly this site, the API and Cognito).
const { createRequire } = require('module');
const req = createRequire(require('path').resolve(__dirname, '../../apps/dashboard/package.json'));
const { chromium } = req('@playwright/test');
const site = (process.argv[2] || '').replace(/\/?$/, '/');
const expectLive = process.argv.includes('--expect-live');
let failures = 0;
const check = (name, ok, extra = '') => {
  failures += ok ? 0 : 1;
  console.log(`${ok ? 'ok ' : 'BAD'} ${name}${extra ? ` (${extra})` : ''}`);
};

(async () => {
  if (!site.startsWith('http')) throw new Error('usage: check_site.cjs <siteUrl>');
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    const p = await ctx.newPage();
    const problems = [];
    p.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
    });
    p.on('pageerror', (e) => problems.push(e.message));

    const res = await p.goto(site);
    check('home page loads', res && res.status() < 400, String(res && res.status()));
    await p.getByText('DEMO — SYNTHETIC DATA').first().waitFor({ timeout: 20000 });
    check('Demo Mode by default, labelled synthetic, no sign-in needed', (await p.getByRole('button', { name: 'Sign in' }).count()) === 0);

    for (const path of ['incidents', 'analytics', 'simulation-lab', 'architecture']) {
      const r = await p.goto(site + path);
      await p.getByRole('main').waitFor({ timeout: 20000 });
      const shown = await p.getByRole('heading', { level: 1 }).first().textContent();
      check(`deep link /${path} renders`, Boolean(shown), `${r && r.status()} → ${shown && shown.trim()}`);
    }

    await p.goto(site + 'simulation-lab');
    await p.getByRole('button', { name: /Break the web server|Start scenario/ }).first().waitFor({ timeout: 20000 });
    check('Demo scenario control is available', true);

    await p.goto(site);
    await p.getByRole('button', { name: 'Live AWS' }).click();
    await p.waitForTimeout(1500);
    const live = await p.locator('main').innerText();
    check('Live mode needs sign-in or says it is not configured, and shows no data', /Sign in|not configured|not connected|no Live API configuration/i.test(live) && !/INC-DEMO/.test(live));
    check('Live mode shows no demo banner', (await p.getByText('DEMO — SYNTHETIC DATA').count()) === 0);
    if (expectLive) {
      check('Live build: Sign in is offered', (await p.getByRole('button', { name: 'Sign in' }).count()) > 0);
      const csp = (await p.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) || '';
      const connect = ((/connect-src ([^;]+)/.exec(csp) || [])[1] || '').split(' ');
      const ok =
        connect.length === 3 &&
        connect.includes("'self'") &&
        connect.some((c) => /^https:\/\/[a-z0-9]+\.execute-api\.ap-southeast-1\.amazonaws\.com$/.test(c)) &&
        connect.some((c) => /^https:\/\/[a-z0-9-]+\.auth\.ap-southeast-1\.amazoncognito\.com$/.test(c));
      check('Live build: CSP connect-src is exactly self, the API and Cognito', ok, connect.join(' '));
    }

    check('no CSP violation or script error', problems.length === 0, problems.slice(0, 2).join(' | '));
  } catch (err) {
    failures += 1;
    console.error('FAILED:', err.message);
  } finally {
    await b.close();
    console.log(failures ? `FAILURES: ${failures}` : 'SITE OK');
    process.exitCode = failures ? 1 : 0;
  }
})();
