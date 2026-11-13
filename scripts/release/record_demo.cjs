// Phase 10: record the public Demo walkthrough as a video (synthetic data only).
// Usage: node record_demo.cjs <siteUrl> <outFile.webm>
// Easy view: break the web server, take ownership, request and approve the
// restart, watch the verified fix; then the Advanced timeline and analytics.
// Every frame shows DEMO — SYNTHETIC DATA. No AWS is called.
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.resolve(__dirname, '../../apps/dashboard/package.json'));
const { chromium } = req('@playwright/test');
const [site, outFile] = process.argv.slice(2);
const pause = (p, ms = 1400) => p.waitForTimeout(ms);

(async () => {
  if (!site || !outFile) throw new Error('usage: record_demo.cjs <siteUrl> <outFile.webm>');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'opsentra-video-'));
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: tmp, size: { width: 1280, height: 720 } },
      reducedMotion: 'reduce',
    });
    const p = await ctx.newPage();
    const confirm = async (name) => {
      const d = p.getByRole('dialog');
      await d.waitFor();
      await pause(p, 900);
      await d.getByRole('button', { name, exact: true }).click();
      await d.waitFor({ state: 'detached' });
    };
    const skip = p.getByRole('button', { name: 'Skip ahead' }).first();

    await p.goto(site);
    await p.getByText('DEMO — SYNTHETIC DATA').first().waitFor();
    await pause(p, 2500);
    await p.getByRole('link', { name: 'Practice a failure' }).click();
    await pause(p);
    await p.getByRole('button', { name: 'Break the web server' }).click();
    await confirm('Break the web server');
    await pause(p);

    const openLink = p.getByRole('link', { name: 'Open the problem' });
    for (let i = 0; i < 10 && (await openLink.count()) === 0; i++) {
      await skip.click();
      await pause(p, 700);
    }
    await openLink.first().click();
    await pause(p, 2200);
    for (const step of ['Take ownership', 'Look into it', 'Ask to restart Nginx']) {
      await p.getByRole('button', { name: step, exact: true }).click();
      await confirm(step);
      await pause(p);
    }
    await p.getByRole('button', { name: 'Approve the fix', exact: true }).click();
    await confirm('Approve the fix');
    const fixed = p.getByText('Fixed and checked. The web server is working again.');
    for (let i = 0; i < 12 && (await fixed.count()) === 0; i++) {
      await skip.click();
      await pause(p, 700);
    }
    await fixed.waitFor();
    await pause(p, 2500);

    await p.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Advanced' }).click();
    await pause(p, 1800);
    await p.mouse.wheel(0, 900);
    await pause(p, 2500);
    await p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Analytics' }).click();
    await pause(p, 3000);

    const video = p.video();
    await ctx.close();
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.copyFileSync(await video.path(), outFile);
    console.log('saved', outFile, `${Math.round(fs.statSync(outFile).size / 1024)} KB`);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
});
