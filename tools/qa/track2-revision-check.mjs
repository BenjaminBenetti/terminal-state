// Track 2 playtest revision browser spot check (task studio-alpha-track2-playtest-revision-20261031-01) — ONE short, serial, low-
// footprint session (root CLAUDE.md browser policy; lock / watchdog / cleanup from browser-env.mjs; the unchanged 6 GiB anon + shmem
// guard, plus an EARLIER self-stop at STOP_GIB so this check ends itself before the guard):
//   1. load a preselected Subway seed (00000ST: its invitation art is in line of sight of the player's spawn), start, wait 1 s;
//   2. NO movement: aim the camera at the nearest station art and take screenshot 1 (station invitation in context);
//   3. read the live game's registries: the annex's holders (ContainerManager) with their lots, its enemies (actors) with their
//      brain state / position / height, the annex props in the scene — the runtime "registered / rendered" stage of the real build;
//   4. only with headroom: a HARNESS CAMERA PLACEMENT (teleport; screenshot only — NOT a traversed route) into the annex's nearest
//      signature room, aim at its focal machinery and take screenshot 2. Stop here.
// The traversal itself is covered by game/tests/track2-walk.test.ts / annex-route evidence (real Player in Node). llvmpipe CPU
// rendering: functional / visual evidence only, not GPU performance or native WebGPU.
//
//   npm run build && node tools/qa/track2-revision-check.mjs [seedCode] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const code = process.argv[2] ?? '00000ST';
const out = path.resolve(process.argv[3] ?? 'qa-artifacts/track2-revision-browser');
const STOP_GIB = 5.7;
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const gib = () => +(anon() / 1024 ** 3).toFixed(2);
const report = {code, started: new Date().toISOString(), steps: [], consoleErrors: [], peakGiB: 0, guard: false, stoppedAt: null};
const step = (name, data = {}) => { report.steps.push({name, gib: gib(), t: new Date().toISOString(), ...data}); console.log(name, `${gib()} GiB`, JSON.stringify(data).slice(0, 700)); };
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
    const waitGame = async (sec, capS = 240) => { const c0 = await clock(), r0 = Date.now(); while ((await clock()) - c0 < sec && Date.now() - r0 < capS * 1000) await sleep(600); };
    await page.click('#btn-start');
    for (let i = 0; i < 180; i++) { if (await ev(() => window.__LL.state() === 'playing').catch(() => false)) break; await sleep(1000); }
    await waitGame(1, 180);
    step('playing');
    if (!headroom('screenshot 1')) return;
    // 2. the station invitation from the spawn (no movement): aim at the nearest art record with a clear sight line
    const art = await ev(() => {
      const l = window.__game.layout, P = window.__game.player;
      const list = (l.extensions?.art ?? []).map(a => {
        const tr = l.trenches[a.trench];
        const x = a.wall === 'end' && a.end ? a.end.x : a.from === 'x1' ? tr.x1 - a.s : tr.x0 + a.s;
        const z = a.wall === 'end' && a.end ? a.end.z : a.wall === 'N' ? tr.z0 : tr.z1;
        return {kind: a.kind, entry: a.entry, wall: a.wall, x, y: a.y, z, d: Math.hypot(x - P.x, z - P.z)};
      }).sort((p, q) => p.d - q.d);
      return {count: list.length, nearest: list.slice(0, 4), player: {x: P.x, y: P.y, z: P.z}};
    });
    step('station art', art);
    const target = art.nearest.find(a => a.kind !== 'stencil') ?? art.nearest[0];
    if (target) { await ev(t => window.__LL.lookAt(t.x, t.y, t.z), target); await waitGame(0.6, 120); await page.screenshot({path: path.join(out, `${code}-1-station-invitation.png`)}); step('screenshot 1', {target}); }
    // 3. the live game's registries for the annex (registered / rendered stage of the real build)
    const live = await ev(() => {
      const g = window.__game, l = g.layout, A = l.extensions?.annexes ?? [];
      const ids = new Set(A.flatMap(a => a.areas));
      const inA = (x, z) => { const [cx, cy] = l.grid.cellOf(x, z); return l.grid.inBounds(cx, cy) && ids.has(l.grid.area[l.grid.idx(cx, cy)]); };
      const hs = (g.containers?.all ?? []).filter(h => ids.has(h.prop.area));
      const zs = g.zombies.filter(z => inA(z.brain.x, z.brain.z));
      let meshes = 0, hidden = 0;
      g.containers?.group.traverse(o => { if (o.isMesh && inA(o.getWorldPosition(o.position.clone()).x, o.getWorldPosition(o.position.clone()).z)) { meshes++; if (!o.visible) hidden++; } });
      return {
        annexes: A.map(a => ({id: a.id, tunnel: a.tunnel, areas: a.areas.length, exit: a.exit})),
        holders: hs.length, stocked: hs.filter(h => h.state.lots.length).length, lots: hs.reduce((n, h) => n + h.state.lots.length, 0),
        supply: hs.filter(h => h.prop.purpose === 'annex-supply').length,
        enemies: zs.map(z => ({state: z.brain.state, alive: z.brain.alive, y: +z.brain.y.toFixed(2), x: +z.brain.x.toFixed(1), z: +z.brain.z.toFixed(1), visible: z.root.visible})),
        holderMeshes: meshes, holderMeshesHidden: hidden, machines: l.extensions?.machines?.length ?? 0,
      };
    });
    step('annex runtime registries', live);
    if (!headroom('screenshot 2')) return;
    // 4. harness camera placement (screenshot only) into the annex's nearest signature room, aimed at its focal machinery
    const room = await ev(() => {
      const l = window.__game.layout, A = l.extensions.annexes[0], SIG = /boiler|generator|sewage|overflow|spillway|turbine|ventilation/;
      const rooms = A.areas.map(id => l.areas[id]).filter(a => SIG.test(a.purpose ?? '')).sort((p, q) => p.depth - q.depth);
      const r = rooms[0];
      if (!r) return null;
      const m = (l.extensions.machines ?? []).find(q => q.area === r.id);
      const cx = (r.x + r.w / 2) * 0.5, cz = (r.y + r.h / 2) * 0.5;
      return {area: r.id, purpose: r.purpose, depth: r.depth, w: r.w * 0.5, h: r.h * 0.5, stand: {x: (r.x + 1.2) * 0.5 + 0.6, z: cz}, focus: m ? {x: m.x ?? cx, z: m.z ?? cz} : {x: cx, z: cz}, floor: A.floorY};
    });
    step('signature room', room ?? {});
    if (room) {
      const ok = await ev(r => window.__LL.teleport(r.stand.x, r.stand.z), room);
      await ev(r => window.__LL.lookAt(r.focus.x, r.floor + 1.2, r.focus.z), room);
      await waitGame(0.8, 180);
      if (headroom('screenshot 2 capture')) { await page.screenshot({path: path.join(out, `${code}-2-annex-${room.purpose}.png`)}); step('screenshot 2 (harness camera placement, not a traversed route)', {teleport: ok}); }
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
