// Performance overlay placement check (task perf-overlay-right-20261030) — a short, isolated browser check: the BUILT game
// with ?perf=1 shows the overlay at boot (before any world is built); its box is measured at 960x540 and 1280x720 (same page,
// viewport resized), toggled off / on with real Ctrl+Shift+P key events, and the browser is closed right away — the session
// ends long before the station / office would build or render. One serial session under the workspace lock (browser-env.mjs),
// memory guard on cgroup anon + shmem.
//
//   npm run build && node tools/qa/perf-overlay-placement-check.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const out = path.resolve(process.argv[2] ?? 'qa-artifacts/perf-overlay-placement');
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const report = {started: new Date().toISOString(), cases: [], toggle: null, peakGiB: 0};

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null;
  const guard = setInterval(() => { const b = anon(); report.peakGiB = Math.max(report.peakGiB, b / 1024 ** 3); if (b > 6 * 1024 ** 3) { report.guard = true; void browser?.close(); } }, 1000);
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({width: 960, height: 540});
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&perf=1`);
    for (let i = 0; i < 60; i++) { if (await page.evaluate(() => !!document.getElementById('perf-overlay')).catch(() => false)) break; await sleep(250); }
    const box = () => page.evaluate(() => {
      const el = document.getElementById('perf-overlay');
      if (!el) return null;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, vw: innerWidth, vh: innerHeight, display: cs.display,
        rightGap: innerWidth - r.right, visible: window.__perf?.snapshot().visible ?? null, rows: Object.keys(window.__perf?.snapshot().text ?? {}).length};
    });
    for (const [w, h] of [[960, 540], [1280, 720]]) {
      await page.setViewport({width: w, height: h});
      await sleep(400);
      const b = await box();
      const ok = !!b && b.display !== 'none' && Math.abs(b.rightGap - 12) <= 1 && b.left >= 0 && b.right <= b.vw && Math.abs(b.top - 100) <= 1 && b.left > b.vw / 2;
      report.cases.push({size: `${w}x${h}`, ok, ...b});
      await page.screenshot({path: path.join(out, `${w}x${h}.png`)});
      console.log(`${w}x${h}`, ok ? 'OK' : 'FAIL', JSON.stringify(b));
    }
    const combo = async () => { await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyP'); await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(250); };
    await combo();
    const off = await box();
    await combo();
    const on = await box();
    report.toggle = {afterFirst: {display: off?.display, visible: off?.visible}, afterSecond: {display: on?.display, visible: on?.visible, rightGap: on?.rightGap},
      ok: off?.display === 'none' && off?.visible === false && on?.display !== 'none' && on?.visible === true};
    console.log('toggle', report.toggle.ok ? 'OK' : 'FAIL', JSON.stringify(report.toggle));
  } finally {
    clearInterval(guard);
    server.close();
    report.finished = new Date().toISOString();
    report.ok = report.cases.length === 2 && report.cases.every(c => c.ok) && !!report.toggle?.ok && !report.guard;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
}, {maxMinutes: 4, label: 'perf-overlay-placement-check'});
if (!report.ok) process.exitCode = 1;
