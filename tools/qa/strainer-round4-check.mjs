// Beyond the Station round 4 browser spot check (task studio-alpha-beyond-station-round4-20261101-01; adapted from the round-3 check) —
// ONE short, serial, low-footprint session (root CLAUDE.md browser policy; lock / watchdog / cleanup from browser-env.mjs; the 6 GiB
// anon + shmem guard closes the owned browser, plus an EARLIER self-stop at STOP_GIB). Primary only.
//   1. load one Subway seed, start, wait; read the level's Beyond the Station area roll (layout.extensions.area) and its service spawns;
//   2. QA DEBUG spawn (strainerSpawnNear: the lazy enemy_strainer model is fetched through the normal library, then ONE Strainer goes
//      through Game.spawnEnemy 5 m in front of the player): read its actor registry (model / rig / clip / hit volumes / scale), then
//      again after ~1.5 s of game time (the clip and brain state advance: no T-pose / slide);
//   3. one internal diagnostic frame aimed at its head, only with headroom (not a user picture).
// llvmpipe CPU rendering: functional evidence only, not GPU performance or native WebGPU.
//
//   npm run build && node tools/qa/strainer-round4-check.mjs [seedCode] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const code = process.argv[2] ?? '00000ST';
const out = path.resolve(process.argv[3] ?? 'qa-artifacts/strainer-round4-browser');
const STOP_GIB = 5.7;
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const gib = () => +(anon() / 1024 ** 3).toFixed(2);
const report = {code, started: new Date().toISOString(), steps: [], consoleErrors: [], peakGiB: 0, guard: false, stoppedAt: null};
const step = (name, data = {}) => { report.steps.push({name, gib: gib(), t: new Date().toISOString(), ...data}); console.log(name, `${gib()} GiB`, JSON.stringify(data).slice(0, 900)); };
const headroom = name => { if (gib() >= STOP_GIB) { report.stoppedAt = name; step(`self-stop before ${name}`, {stopGib: STOP_GIB}); return false; } return true; };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null;
  const guard = setInterval(() => { const b = anon(); report.peakGiB = Math.max(report.peakGiB, b / 1024 ** 3); if (b > 6 * 1024 ** 3 && !report.guard) { report.guard = true; console.error('memory guard: closing the owned browser'); void browser?.close(); } }, 1000);
  try {
    step('before launch');
    browser = await launchBrowser({protocolTimeout: 300000});
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 20) report.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => { if (report.consoleErrors.length < 20) report.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await page.setViewport({width: 640, height: 360});
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${code}&quality=low&warmup=off`);
    let ready = false;
    for (let i = 0; i < 360 && !ready; i++) { ready = await page.evaluate(() => window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false); if (!ready) await sleep(1000); }
    step('title', {ready, seconds: (Date.now() - t0) / 1000});
    if (!ready) throw new Error('no title screen');
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const clock = () => ev(() => window.__game.clock);
    const waitGame = async (sec, capS = 240) => { const c0 = await clock(), r0 = Date.now(); while ((await clock()) - c0 < sec && Date.now() - r0 < capS * 1000) await sleep(500); return (await clock()) - c0; };
    await page.click('#btn-start');
    for (let i = 0; i < 180; i++) { if (await ev(() => window.__LL.state() === 'playing').catch(() => false)) break; await sleep(1000); }
    await waitGame(1, 180);
    step('playing');
    // 1. the level's area roll + its service spawns (the real build)
    step('area roll', await ev(() => {
      const l = window.__game.layout, X = l.extensions ?? {};
      return {area: X.area ?? null, annexes: (X.annexes ?? []).length, layoutStrainers: window.__LL.strainers().layoutSpawns, modelLoaded: window.__LL.strainers().modelLoaded};
    }));
    // 2. one DEBUG Strainer in front of the player, through the normal lazy model + spawnEnemy path
    if (!headroom('spawn')) return;
    const spawned = await ev(() => window.__LL.strainerSpawnNear(5));
    step('strainerSpawnNear', spawned ?? {missing: 'spot'});
    if (!spawned) return;
    const pick = () => ev(i => { const s = window.__LL.strainers(); return {modelLoaded: s.modelLoaded, fallbacks: s.fallbacks, actor: s.actors.find(a => a.index === i) ?? null}; }, spawned.index);
    step('actor t0', await pick());
    await waitGame(1.5, 240);
    step('actor +1.5 s', await pick());
    // 3. one internal diagnostic frame at its head (headroom only)
    if (headroom('frame')) {
      step('aim head', await ev(i => window.__LL.strainerAim(i, 'head'), spawned.index) ?? {missing: 'head volume'});
      await waitGame(0.3, 180);
      if (headroom('screenshot')) { await page.screenshot({path: path.join(out, `${code}-strainer.png`)}); step('screenshot strainer (internal diagnostic)'); }
    }
    // 4. (round 4 follow-up) one tunnel frame: the decay field's extension cells inside the core rectangle now keep their own
    //    (bed-level wet) rules — a harness camera placement in the tunnel cell nearest the station, looking along the tunnel
    if (headroom('tunnel')) {
      const t = await ev(() => {
        const l = window.__game.layout, g = l.grid, P = window.__game.player;
        const ids = new Set(l.areas.flatMap((a, i) => a.ext === 'tunnel' ? [i] : []));
        let best = null, far = null;
        for (let i = 0; i < g.cells.length; i++) if (ids.has(g.area[i])) {
          const x = (i % g.w + 0.5) * 0.5, z = (Math.floor(i / g.w) + 0.5) * 0.5, d = Math.hypot(x - P.x, z - P.z);
          if (!best || d < best.d) best = {x, z, d, area: g.area[i]};
        }
        if (!best) return null;
        for (let i = 0; i < g.cells.length; i++) if (g.area[i] === best.area) {
          const x = (i % g.w + 0.5) * 0.5, z = (Math.floor(i / g.w) + 0.5) * 0.5, d = Math.hypot(x - best.x, z - best.z);
          if (!far || d > far.d) far = {x, z, d};
        }
        const k = Math.min(1, 6 / Math.max(1e-6, far.d)), sx = best.x + (far.x - best.x) * k, sz = best.z + (far.z - best.z) * k;
        const ok = window.__LL.teleport(sx, sz);
        window.__LL.lookAt(far.x, (window.__game.player.y ?? 0) + 1.4, far.z);
        return {ok, at: {x: +sx.toFixed(1), z: +sz.toFixed(1)}, area: best.area, lookM: +far.d.toFixed(1)};
      });
      step('placement tunnel', t ?? {missing: 'tunnel'});
      if (t?.ok) { await waitGame(0.8, 180); if (headroom('tunnel screenshot')) { await page.screenshot({path: path.join(out, `${code}-tunnel.png`)}); step('screenshot tunnel (internal diagnostic)'); } }
    }
  } catch (e) {
    step('error', {message: String(e?.message ?? e).slice(0, 400)});
  } finally {
    clearInterval(guard);
    await browser?.close().catch(() => {});
    server.close();
    report.finished = new Date().toISOString();
    fs.writeFileSync(path.join(out, `${code}-report.json`), JSON.stringify(report, null, 1));
    console.log('peak anon+shmem GiB', report.peakGiB.toFixed(2), 'guard', report.guard, 'self-stop', report.stoppedAt, 'console errors', report.consoleErrors.length);
  }
});
