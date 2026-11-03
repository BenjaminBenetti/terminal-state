// Lane RIDE (task studio-alpha-campaign-foundation-20261102-230708-01): ONE short serial browser spot check of the moving train —
// __LL.rideDemo(0) on one Subway seed (depart -> tunnel -> transit loop -> re-arrive at the same station, no world rebuild).
// Lock / watchdog / cleanup from browser-env.mjs; the 6 GiB anon + shmem guard closes the owned browser; self-stop at STOP_GIB.
// llvmpipe CPU rendering: functional evidence only (not GPU performance, not native WebGPU). Internal screenshots stay in /tmp.
//
//   npm run build && node tools/qa/train-ride-check.mjs [seedCode] [outDir]
// (seed 0000002: an express station whose only tunnel is behind the car: rear-first out, a transit reversal, back in the same way)
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const code = process.argv[2] ?? '0000002';
const out = path.resolve(process.argv[3] ?? '/tmp/train-ride-check');
const STOP_GIB = 5.8;
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const gib = () => +(anon() / 1024 ** 3).toFixed(2);
const report = {code, started: new Date().toISOString(), steps: [], consoleErrors: [], peakGiB: 0, guard: false, stoppedAt: null};
const step = (name, data = {}) => { report.steps.push({name, gib: gib(), t: new Date().toISOString(), ...data}); console.log(name, `${gib()} GiB`, JSON.stringify(data).slice(0, 700)); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1)); };
const headroom = name => { if (gib() >= STOP_GIB) { report.stoppedAt = name; step(`self-stop before ${name}`, {stopGib: STOP_GIB}); return false; } return true; };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null;
  const guard = setInterval(() => { const b = anon(); report.peakGiB = Math.max(report.peakGiB, b / 1024 ** 3); if (b > 6 * 1024 ** 3 && !report.guard) { report.guard = true; console.error('memory guard: closing the owned browser'); void browser?.close(); } }, 500);
  try {
    step('before launch');
    browser = await launchBrowser({protocolTimeout: 300000});
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 30) report.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => { if (report.consoleErrors.length < 30) report.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await page.setViewport({width: 640, height: 360});
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${code}&quality=low&warmup=off`);
    let ready = false;
    for (let i = 0; i < 360 && !ready; i++) { ready = await page.evaluate(() => window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false); if (!ready) await sleep(1000); }
    step('title', {ready, seconds: (Date.now() - t0) / 1000});
    if (!ready) throw new Error('no title screen');
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const clock = () => ev(() => window.__game.clock);
    const waitGame = async (sec, capS = 240) => { const c0 = await clock(), r0 = Date.now(); while ((await clock()) - c0 < sec && Date.now() - r0 < capS * 1000) await sleep(400); return (await clock()) - c0; };
    await page.click('#btn-start');
    for (let i = 0; i < 180; i++) { if (await ev(() => window.__LL.state() === 'playing').catch(() => false)) break; await sleep(1000); }
    await waitGame(1, 180);
    step('playing', await ev(() => ({train: (({built, placement, playerInside}) => ({built, placement, playerInside}))(window.__LL.train()), ride: window.__LL.ride().phase})));
    if (!headroom('depart')) return;
    // look along the direction the car will leave (front or rear-first) from the saloon, through the windows / the cab doorway
    const look = () => ev(() => {
      const r = window.__LL.ride(), P = window.__game.player, c = r.car;
      const d = r.dir ?? 1; // local +X * dir, in world: R_y(yaw) (d, 0, 0) = (d cos yaw, 0, -d sin yaw)
      // local (lx, lz) -> world: (lx cos + lz sin, -lx sin + lz cos); departing / arriving: ahead (+ a little to the far side),
      // transit: mostly sideways at the far-side windows (the passing lamps)
      const [lx, lz] = r.phase === 'transit' ? [d * 4, 10] : [d * 10, 3];
      window.__LL.lookAt(P.x + lx * Math.cos(c.yaw) + lz * Math.sin(c.yaw), P.y + 1.55, P.z - lx * Math.sin(c.yaw) + lz * Math.cos(c.yaw));
      return {phase: r.phase, dir: r.dir};
    });
    await ev(() => { window.__rideDone = null; window.__LL.rideDemo(0).then(r => { window.__rideDone = r; }, e => { window.__rideDone = {error: String(e)}; }); });
    const shots = new Set();
    const shot = async (name) => { if (shots.has(name) || !headroom(name)) return; shots.add(name); await look(); await waitGame(0.15, 60); await page.screenshot({path: path.join(out, `${code}-${name}.png`)}); step(`screenshot ${name} (internal)`); };
    let last = '', samples = 0;
    const r0 = Date.now();
    while (Date.now() - r0 < 14 * 60000) {
      const s = await ev(() => ({ride: window.__LL.ride(), done: window.__rideDone, prompt: window.__game.hud?.lastPrompt ?? null})).catch(() => null);
      if (!s) { await sleep(1000); continue; }
      const r = s.ride;
      if (r.phase !== last || samples % 10 === 0) step(`phase ${r.phase}`, {u: r.u, speed: r.speed, dir: r.dir, plan: r.plan, car: r.car, local: r.local, jostle: r.jostle, transit: r.transit, counts: r.counts});
      last = r.phase; samples++;
      if (r.phase === 'departing' && r.u > 25) await shot('departing');
      if (r.phase === 'transit' && r.transit.t > 2.5) await shot('transit');
      if (r.phase === 'arriving' && r.plan && r.u < r.plan.uMouth + 2) await shot('arriving');
      if (s.done) { step('demo resolved', s.done); break; }
      if (report.guard) break;
      await sleep(1500);
    }
    if (report.guard) return;
    await waitGame(0.5, 60);
    step('after stop', await ev(() => {
      const t = window.__LL.train(), r = window.__LL.ride();
      return {ride: {phase: r.phase, car: r.car, local: r.local, counts: r.counts}, train: {placement: t.placement, playerInside: t.playerInside, doors: t.doors.map(d => d.t), riding: t.riding, heldView: t.heldView, lights: t.lights.head}};
    }));
    await shot('stopped');
  } catch (e) {
    step('error', {message: String(e?.message ?? e).slice(0, 400)});
  } finally {
    clearInterval(guard);
    await browser?.close().catch(() => {});
    server.close();
    report.finished = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
    console.log('peak anon+shmem GiB', report.peakGiB.toFixed(2), 'guard', report.guard, 'self-stop', report.stoppedAt, 'console errors', report.consoleErrors.length);
  }
}, {maxMinutes: 22, label: 'lane RIDE ride-check'});
