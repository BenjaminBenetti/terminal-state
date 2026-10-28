// Iteration-08 ordinary UNHOOKED play check of the STATIC build: no ?qa=1 (no __LL / __game), no seed — a fresh
// random station as a player gets it. Real keyboard/mouse only: start, walk, look (mouse moves), shoot, interact,
// inventory, pause/resume. Evidence: screenshots + no page/shader errors / failed requests. It cannot read game state.
// Usage: node game/e2e/iter08-unhooked.mjs OUTDIR [--dist=dist/game]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter08-unhooked');
const dist = path.resolve(arg('dist', 'dist/game'));
fs.mkdirSync(outDir, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {startedAt: new Date().toISOString(), dist, steps: [], pageErrors: [], console: [], badResponses: [], screenshots: []};
const step = (name, ok, detail = {}) => { report.steps.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(detail).slice(0, 500)); return ok; };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(dist, {prefix: '/'});
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 600)));
  page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) report.console.push(`${m.type()}: ${m.text()}`.slice(0, 500)); });
  page.on('response', r => { if (r.status() >= 400) report.badResponses.push(`${r.status()} ${r.url()}`); });
  const shot = async name => { const f = path.join(outDir, `${name}.png`); await page.screenshot({path: f}); report.screenshots.push(f); };
  const hidden = sel => page.$eval(sel, e => !e.offsetParent || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden').catch(() => true);
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 480000) { ready = await page.$eval('#btn-start', b => !b.disabled).catch(() => false); if (ready) break; await sleep(500); }
    const exposed = await page.evaluate(() => ({LL: typeof window.__LL, game: typeof window.__game}));
    step('loads to an enabled Start button without QA hooks', ready && exposed.LL === 'undefined' && exposed.game === 'undefined', {ms: Date.now() - t0, exposed, intro: await page.$eval('#station-intro', e => e.textContent).catch(() => null)});
    await shot('u01-title');
    await page.click('#btn-start');
    await sleep(6000);
    step('Start hides the title overlay (playing)', await hidden('#btn-start'), {});
    await shot('u02-playing');
    // walk + look with real input
    await page.keyboard.down('KeyW'); await sleep(2500);
    await page.mouse.move(640, 360); await page.mouse.move(760, 360, {steps: 8});
    await sleep(1500); await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyD'); await sleep(1200); await page.keyboard.up('KeyD');
    await shot('u03-after-walk');
    // shoot (rifle in slot 1) and interact
    await page.keyboard.press('Digit1'); await sleep(1200);
    await page.mouse.down(); await sleep(250); await page.mouse.up(); await sleep(1500);
    await shot('u04-after-shot');
    await page.keyboard.press('KeyE'); await sleep(1200);
    await page.keyboard.press('KeyF'); await sleep(800); // flashlight toggle
    await shot('u05-after-interact-flashlight');
    await page.keyboard.press('Tab'); await sleep(1500);
    await shot('u06-inventory');
    await page.keyboard.press('Tab'); await sleep(1000);
    await page.keyboard.press('Escape'); await sleep(1500);
    await shot('u07-pause');
    await page.keyboard.press('Escape'); await sleep(1500);
    await page.keyboard.down('KeyW'); await sleep(2000); await page.keyboard.up('KeyW');
    await shot('u08-resumed');
    const shaderErr = report.console.filter(x => /shader|program|webgl|glsl/i.test(x));
    step('ordinary play: no page errors, shader errors or failed requests', report.pageErrors.length === 0 && shaderErr.length === 0 && report.badResponses.length === 0, {pageErrors: report.pageErrors.slice(0, 3), shaderErr: shaderErr.slice(0, 3), bad: report.badResponses.slice(0, 5), console: report.console.slice(0, 6)});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 800)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter08-unhooked.json'), JSON.stringify(report, null, 2));
  }
});
