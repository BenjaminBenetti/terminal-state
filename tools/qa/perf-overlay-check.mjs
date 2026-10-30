// Debug overlay (Ctrl+Shift+P) browser spot check — ONE short, serial session (root CLAUDE.md browser policy):
// the built game (dist/game) in Office Space with warmup=off / quality=low, overlay off by default, real Ctrl+Shift+P
// key events toggle it on, a few seconds of play are sampled (window.__perf.snapshot(), ?qa=1), one screenshot, then
// it is toggled off again. The game must never pause. A memory guard (cgroup anon + shmem > 6.0 GiB) stops the
// session and closes the owned browser; the watchdog / lock come from browser-env.mjs.
//
//   node tools/qa/perf-overlay-check.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const out = path.resolve(process.argv[2] ?? 'qa-artifacts/perf-overlay');
fs.mkdirSync(out, {recursive: true});
const GUARD_BYTES = 6.0 * 1024 ** 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {started: new Date().toISOString(), steps: [], memoryPeakGiB: 0, guardTripped: false};
const step = (name, data) => { report.steps.push({name, at: new Date().toISOString(), ...data}); console.log(name, JSON.stringify(data)); };

function cgroupAnonShmem() {
  try {
    const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8');
    const get = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0);
    return get('anon') + get('shmem');
  } catch { return 0; }
}

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null, guard = null;
  try {
    browser = await launchBrowser({protocolTimeout: 240000});
    guard = setInterval(() => {
      const b = cgroupAnonShmem();
      report.memoryPeakGiB = Math.max(report.memoryPeakGiB, b / 1024 ** 3);
      if (b > GUARD_BYTES && !report.guardTripped) {
        report.guardTripped = true;
        console.error(`memory guard: anon+shmem ${(b / 1024 ** 3).toFixed(2)} GiB > 6.0 GiB; closing the owned browser`);
        void browser?.close();
      }
    }, 1000);
    const page = await browser.newPage();
    await page.setViewport({width: 1280, height: 720});
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&level=office&warmup=off&quality=low`);
    let ready = false;
    for (let i = 0; i < 300 && !ready; i++) {
      ready = await page.evaluate(() => window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false);
      if (!ready) await sleep(1000);
    }
    step('loaded', {ready, seconds: (Date.now() - t0) / 1000});
    if (!ready) throw new Error('game did not reach the title screen');
    const perf = () => page.evaluate(() => window.__perf.snapshot());
    const dom = () => page.evaluate(() => { const el = document.getElementById('perf-overlay'); return el ? {exists: true, hidden: el.classList.contains('hidden'), display: getComputedStyle(el).display, pointerEvents: getComputedStyle(el).pointerEvents} : {exists: false}; });
    const hotkey = async () => {
      await page.keyboard.down('Control');
      await page.keyboard.down('Shift');
      await page.keyboard.press('KeyP');
      await page.keyboard.up('Shift');
      await page.keyboard.up('Control');
      await sleep(300);
    };
    let s = await perf();
    step('default', {visible: s.visible, built: s.built, dom: await dom(), state: await page.evaluate(() => window.__LL.state())});
    await hotkey();
    s = await perf();
    step('after Ctrl+Shift+P (title)', {visible: s.visible, dom: await dom(), state: await page.evaluate(() => window.__LL.state())});
    await page.click('#btn-start');
    for (let i = 0; i < 60; i++) { if (await page.evaluate(() => window.__LL.state() === 'playing')) break; await sleep(500); }
    const framesBefore = await page.evaluate(() => window.__LL.snapshot().frames);
    await sleep(8000);
    s = await perf();
    const play = await page.evaluate(() => ({state: window.__LL.state(), frames: window.__LL.snapshot().frames, gpu: window.__LL.gpu?.()?.label ?? null}));
    step('playing with overlay', {state: play.state, framesAdvanced: play.frames - framesBefore, backend: play.gpu, visible: s.visible, failed: s.failed,
      scaleMs: s.scaleMs, slots: s.slots, summary: s.summary, gpuTiming: s.gpuTiming, longFrames: s.longFrames, pressure: s.pressure, text: s.text});
    await page.screenshot({path: path.join(out, 'overlay-playing.png')});
    await hotkey();
    s = await perf();
    const after = await page.evaluate(() => ({state: window.__LL.state(), frames: window.__LL.snapshot().frames}));
    await sleep(1500);
    const later = await page.evaluate(() => window.__LL.snapshot().frames);
    step('after second Ctrl+Shift+P', {visible: s.visible, dom: await dom(), gpuTimingEnabled: s.gpuTiming.enabled, state: after.state, framesAdvancedAfterToggle: later - after.frames});
    report.lastError = await page.evaluate(() => window.__game?.lastError ?? null);
  } finally {
    clearInterval(guard);
    server.close();
    report.finished = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
}, {maxMinutes: 10, label: 'perf-overlay-check'});
