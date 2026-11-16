// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary): ONE short, serial browser spot check of Surface Run (root CLAUDE.md
// browser policy: the workspace lock / watchdog / owned-browser cleanup of browser-env.mjs; a 10 GiB anon + shmem guard closes the owned
// browser, plus an earlier self-stop at STOP_GIB). Firefox + Mesa (llvmpipe WebGL2, or lavapipe WebGPU when enabled) on this worker:
// functional evidence and after-views only, never hardware performance.
//   1. a campaign New game on a Subway station whose roll carries Surface Run (ACCESS's route: networkSeed 1 → st-00), the stairwell
//      door (one frame), then the REAL crossing up ([E] path: __LL.surface.cross('up') = Game.crossSurface: loading screen, prepare,
//      build, full warm-up);
//   2. the district: the arrival view (portal → checkpoint, tent, truck), the planning map overlay, a street view, a store interior, the
//      truck cab view — at most MAX_SHOTS frames, each taken right after its pose;
//   3. the crossing back down, the station state (no district objects / 'surface' resources left), close.
//   npm run build && node tools/qa/surface-run-check.mjs [outDir] [--size=960x540] [--quality=low] [--plan=all|journey|views]
//   --plan=journey: door, loading, arrival, map, then straight back down (the whole normal journey, fewest new views compiled);
//   --plan=views: up, arrival, truck / cab / roll, avenue, store interior (no return); all = both in one session.
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const ARGS = process.argv.slice(2), POS = ARGS.filter(a => !a.startsWith('--'));
const opt = (k, d) => (ARGS.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const out = path.resolve(POS[0] ?? 'qa-artifacts/surface-run-browser');
const SIZE = opt('size', '960x540').split('x').map(Number), QUALITY = opt('quality', ''), PLAN = ARGS.includes('--up-only') ? 'views' : opt('plan', 'all');
const VIEWS = PLAN !== 'journey', RETURN = PLAN !== 'views';
const NETWORK_SEED = Number(opt('network', '1')), HOST = opt('host', 'subway');
const GUARD_GIB = 10, STOP_GIB = 9.4;
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const gib = () => +(anon() / 1024 ** 3).toFixed(2);
const report = {started: new Date().toISOString(), size: SIZE, quality: QUALITY || 'default', plan: PLAN, steps: [], shots: [], consoleErrors: [], peakGiB: 0, guard: false, stoppedAt: null};
const step = (name, data = {}) => { report.steps.push({name, gib: gib(), t: new Date().toISOString(), ...data}); console.log(name, `${gib()} GiB`, JSON.stringify(data).slice(0, 1200)); };
const headroom = name => { if (gib() >= STOP_GIB) { report.stoppedAt = name; step(`self-stop before ${name}`, {stopGib: STOP_GIB}); return false; } return true; };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null;
  const guard = setInterval(() => { const b = anon(); report.peakGiB = Math.max(report.peakGiB, +(b / 1024 ** 3).toFixed(2)); if (b > GUARD_GIB * 1024 ** 3 && !report.guard) { report.guard = true; console.error('memory guard: closing the owned browser'); void browser?.close(); } }, 500);
  try {
    step('before launch');
    browser = await launchBrowser({protocolTimeout: 600000});
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 40) report.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => { if (report.consoleErrors.length < 40) report.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await page.setViewport({width: SIZE[0], height: SIZE[1]});
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const q = QUALITY ? `&quality=${QUALITY}` : '';
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&qaPrebuild=0&menuScene=0${q}`);
    let booted = false;
    // the game files are loaded once the pickups manager exists (the menu's New game is enabled then; campaign-loop-check.mjs)
    for (let i = 0; i < 300 && !booted && !report.guard; i++) { booted = await ev(() => !!window.__game?.pickups && !!window.__LL).catch(() => false); if (!booted) await sleep(1000); }
    step('booted', {booted, seconds: (Date.now() - t0) / 1000});
    if (!booted) throw new Error('game did not boot');
    const waitState = async (want, capS) => { const r0 = Date.now(); while (Date.now() - r0 < capS * 1000 && !report.guard) { if (await ev(w => window.__game.state === w, want).catch(() => false)) return true; await sleep(1000); } return false; };
    const shot = async (name, note) => {
      if (report.guard) return;
      await sleep(400);
      const file = path.join(out, `${String(report.shots.length + 1).padStart(2, '0')}-${name}.png`);
      await page.screenshot({path: file});
      report.shots.push({name, file: path.basename(file), note, gib: gib()});
      step(`shot ${name}`, {note});
      save();
    };
    const frames = async n => { await ev(k => new Promise(res => { let i = 0; const f = () => (++i >= k ? res(null) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n).catch(() => {}); };
    if (!headroom('new campaign')) return;
    const t1 = Date.now();
    await ev((seed, host) => { window.__srNewGame = null; void window.__game.newCampaign(1, {overwrite: true, networkSeed: seed, dev: {level: host}}).then(r => { window.__srNewGame = r; }, e => { window.__srNewGame = {ok: false, error: String(e)}; }); }, NETWORK_SEED, HOST);
    const playing = await waitState('playing', 900);
    step('station playing', {playing, seconds: (Date.now() - t1) / 1000, state: await ev(() => window.__game.state).catch(e => String(e)), newGame: await ev(() => window.__srNewGame).catch(e => String(e)),
      station: await ev(() => ({id: window.__game.run.current.station, name: window.__game.layout?.name})).catch(e => String(e)), access: await ev(() => window.__LL.surface.access()).catch(e => String(e))});
    if (!playing) throw new Error('station never reached playing');
    await frames(30);
    step('station renderer (before)', await ev(() => { const i = window.__game.renderer.info; return {geometries: i.memory?.geometries, textures: i.memory?.textures, calls: i.render?.calls, triangles: i.render?.triangles}; }).catch(e => String(e)));
    if (!headroom('door')) return;
    step('go door', {ok: await ev(() => window.__LL.surface.go())});
    await frames(20);
    await shot('station-stair-door', 'the extended stairwell top: the closed street door (the occlusion boundary)');
    if (!headroom('cross up')) return;
    const t2 = Date.now();
    const crossUp = ev(() => window.__LL.surface.cross('up')).catch(e => ({ok: false, error: String(e)}));
    // the loading screen while the district prepares / builds / warms (one frame, mid-crossing)
    await sleep(4000);
    if (!report.guard) await shot('crossing-loading', 'the crossing loading screen (truthful progress)');
    const up = await crossUp;
    step('crossed up', {up, seconds: (Date.now() - t2) / 1000, state: await ev(() => window.__LL.surface.state()).catch(e => String(e))});
    if (!up?.ok) throw new Error(`crossing up failed: ${JSON.stringify(up)}`);
    await waitState('playing', 300);
    await frames(40);
    await shot('district-arrival', 'arrival at the portal: the checkpoint, tent and truck');
    step('district renderer', await ev(() => { const i = window.__game.renderer.info; return {geometries: i.memory?.geometries, textures: i.memory?.textures, calls: i.render?.calls, triangles: i.render?.triangles}; }).catch(e => String(e)));
    const S = await ev(() => { const s = window.__game.layout.surface; return s && {portal: s.portal.pose, cp: s.checkpoint, truck: s.truck, core: s.core,
      dest: s.buildings.filter(b => b.destination && b.enterable).map(b => ({id: b.id, name: b.name, programme: b.programme, kind: b.kind, fp: b.footprint, areas: b.areas, ent: b.entrances.map(e => ({x: e.x, z: e.z, side: e.side, door: e.door}))})),
      streets: s.streets.filter(t => t.rank === 'avenue').map(t => ({name: t.name, ax: t.ax, az: t.az, bx: t.bx, bz: t.bz}))}; });
    fs.writeFileSync(path.join(out, 'district.json'), JSON.stringify(S, null, 1));
    if (!headroom('map')) return;
    step('map open', {ok: await ev(() => window.__LL.surfaceMapOpen()), map: await ev(() => window.__LL.surfaceMap()).catch(e => String(e))});
    await sleep(1500);
    await shot('planning-map', 'the checkpoint planning map (real roads, destinations, notes, exploration, player and truck)');
    await page.keyboard.press('KeyE');
    await waitState('playing', 60);
    if (VIEWS) {
    if (!headroom('truck view')) return;
    // the truck from the checkpoint (third person standing), then the street down the nearest avenue
    await ev(t => { window.__LL.lookAt(t.x, 1.4, t.z); }, S.truck);
    await frames(20);
    await shot('checkpoint-truck', 'the truck at the checkpoint');
    if (!headroom('cab')) return;
    // the truck's cab: stand outside the left door facing it, [E] (the real controller's enter), the first-person road view, a short
    // forward roll (W), [E] out
    const door = await ev(() => { const c = window.__game.skywaysCar, b = c.body, S = c.spec, lx = -(S.width / 2 + 0.7), lz = S.exits.left.z;
      const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw); return {x: b.x + lx * cs + lz * sn, z: b.z - lx * sn + lz * cs, bx: b.x, bz: b.z, y: b.y}; });
    await ev(d => { window.__LL.teleport(d.x, d.z, Math.atan2(-(d.bx - d.x), -(d.bz - d.z)), 0); window.__LL.lookAt(d.bx, d.y + 1.6, d.bz); }, door);
    await frames(10);
    await page.keyboard.press('KeyE');
    await frames(30);
    const seated = await ev(() => window.__game.skywaysCar.driving);
    step('truck seat', {seated, truck: await ev(() => window.__LL.truck()?.state).catch(e => String(e))});
    if (seated) {
      await shot('truck-cab', 'first-person from the truck seat (dash, wheel, glazing, road view)');
      await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
      await page.keyboard.down('Space'); await sleep(1500); await page.keyboard.up('Space');
      await frames(20);
      await shot('truck-rolling', 'after a short forward roll (wheels, lamps, the street ahead)');
      await page.keyboard.press('KeyE');
      await frames(20);
    }
    if (!headroom('street')) return;
    const av = S.streets[0];
    if (av) {
      const mx = (av.ax + av.bx) / 2, mz = (av.az + av.bz) / 2;
      await ev((x, z, tx, tz) => { window.__LL.teleport(x, z, Math.atan2(-(tx - x), -(tz - z)), 0); }, mx, mz, av.bx, av.bz);
      await frames(40);
      await shot('avenue', `down ${av.name}`);
    }
    if (!headroom('interior')) return;
    const store = S.dest.find(d => d.kind === 'store' && d.areas.length) ?? S.dest[0];
    if (store) {
      const e = store.ent[0];
      const c = {x: (store.fp.x0 + store.fp.x1) / 2, z: (store.fp.z0 + store.fp.z1) / 2};
      const n = {N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0]}[e?.side ?? 'S'];
      const sx = e ? e.x + n[0] * 2.2 : c.x, sz = e ? e.z + n[1] * 2.2 : c.z;
      await ev((x, z, tx, tz) => { window.__LL.teleport(x, z, Math.atan2(-(tx - x), -(tz - z)), 0); }, sx, sz, c.x, c.z);
      await frames(40);
      await shot('store-interior', `${store.name} (${store.programme}) from inside its door`);
    }
    }
    if (RETURN && headroom('cross down')) {
      await ev(() => window.__LL.surface.go());
      const down = await ev(() => window.__LL.surface.cross('down')).catch(e => ({ok: false, error: String(e)}));
      await waitState('playing', 600);
      await frames(30);
      step('crossed down', {down, state: await ev(() => window.__LL.surface.state()).catch(e => String(e))});
      step('station renderer', await ev(() => { const i = window.__game.renderer.info; return {geometries: i.memory?.geometries, textures: i.memory?.textures, calls: i.render?.calls}; }).catch(e => String(e)));
      await shot('station-return', 'back in the station at the stairwell (no district left)');
    }
  } finally {
    clearInterval(guard);
    save();
    server.close();
  }
}, {maxMinutes: 40, waitMinutes: 30, label: 'surface-run-check'});
console.log('report', path.join(out, 'report.json'), 'peak', report.peakGiB, 'GiB');
