// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (primary): ONE short, serial, low-footprint browser spot check of
// the Reactor's redesigned surface + the end credits (root CLAUDE.md browser policy; lock / watchdog / cleanup from browser-env.mjs; the
// 6 GiB anon + shmem guard closes the owned browser, plus an earlier self-stop at STOP_GIB). llvmpipe / WebGL2: functional evidence only,
// not native WebGPU or GPU performance.
//   1. a Reactor scratch run (?qa=1, no menu diorama), the restart chain + the doors forced through lane ENDING's QA hooks (setup, not
//      traversal proof), the player 2 m out of the exit on the plaza;
//   2. the surface state (outside, clear, rain), the plant's fans (their angles advance), the city / plant census, console errors;
//   3. at most four internal frames (toward the aperture + a tower, toward the far city on two headings, the credits);
//   4. the credits: fast-forward the 30 s count (QA hook), the column top-right, the end card, Main Menu -> the menu (a scratch run has
//      no campaign: no save).
//   npm run build && node tools/qa/reactor-surface-check.mjs [reactorSeedCode] [outDir] [--views]
//   --views: instead of 3 / 4, four framed views from the ring round the opening (the collar + each tower, the far city away from the
//   head house, the collar looking down at the railing)
//   --ending (task reactor-ending-polish-20261104): the exit door straight on (lamp + SURFACE EXIT plate) and at a grazing angle (the
//   frame), under a pit flight looking up (its underside), the stairwell from the stair's top landing (no ground across it)
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const ARGS = process.argv.slice(2), VIEWS = ARGS.includes('--views'), ENDING = ARGS.includes('--ending'), POS = ARGS.filter(a => !a.startsWith('--'));
const code = POS[0] ?? '000070S';
const out = path.resolve(POS[1] ?? (ENDING ? 'qa-artifacts/reactor-ending-views' : VIEWS ? 'qa-artifacts/reactor-surface-views' : 'qa-artifacts/reactor-surface-browser'));
const STOP_GIB = 5.75;
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
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 30) report.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => { if (report.consoleErrors.length < 30) report.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    const SIZE = (ARGS.find(a => a.startsWith('--size=')) ?? '--size=640x360').slice(7).split('x').map(Number);
    await page.setViewport({width: SIZE[0], height: SIZE[1]});
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&level=reactor&reactorSeed=${code}&quality=low&warmup=off&menuScene=0`);
    let ready = false;
    for (let i = 0; i < 420 && !ready && !report.guard; i++) { ready = await ev(() => window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false); if (!ready) await sleep(1000); }
    step('title', {ready, seconds: (Date.now() - t0) / 1000});
    if (!ready) throw new Error('no title screen');
    const clock = () => ev(() => window.__game.clock);
    const waitGame = async (sec, capS = 240) => { const c0 = await clock(), r0 = Date.now(); while ((await clock()) - c0 < sec && Date.now() - r0 < capS * 1000 && !report.guard) await sleep(500); return (await clock()) - c0; };
    if (!headroom('start')) return;
    await page.click('#btn-start');
    for (let i = 0; i < 240; i++) { if (await ev(() => window.__LL.state() === 'playing').catch(() => false)) break; await sleep(1000); }
    await waitGame(1, 180);
    step('playing');
    if (ENDING) {
      if (!headroom('ending views')) return;
      const shot = async (name, setup, arg) => {
        if (!headroom(name)) return;
        const info = await ev(setup, arg);
        await waitGame(1.5, 120);
        await page.screenshot({path: path.join(out, `${name}.png`)});
        step(`view ${name} (internal)`, info);
      };
      // the door, sealed (red lamp), straight on, aimed at the lintel / plate
      await shot('door', () => { window.__LL.reactorEnding({go: 'door'}); const d = window.__game.layout.reactor.surface.door; window.__LL.lookAt(d.x, d.y + 2.6, d.z); return {door: d}; });
      // the frame at a grazing angle: 1.2 m out, 2.6 m along the wall, aimed at the near jamb's edge
      await shot('door-frame', () => {
        const d = window.__game.layout.reactor.surface.door, ux = -d.nz, uz = d.nx;
        window.__LL.teleport(d.x + d.nx * 1.2 + ux * 2.6, d.z + d.nz * 1.2 + uz * 2.6, undefined, d.level);
        window.__LL.lookAt(d.x + ux * (d.w / 2 + 0.12), d.y + 1.6, d.z + uz * (d.w / 2 + 0.12));
        return {ok: true};
      });
      // close-ups of the frame (--frame: the two upper corners and the head, 1.1 m out)
      if (ARGS.includes('--frame')) {
        for (const [name, side, up] of [['frame-left', -1, 0], ['frame-right', 1, 0], ['frame-head', 0, 1]]) {
          await shot(name, (o) => {
            const d = window.__game.layout.reactor.surface.door, ux = -d.nz, uz = d.nx, [sd, up] = o;
            const ax = d.x + ux * sd * (d.w / 2 + 0.1), az = d.z + uz * sd * (d.w / 2 + 0.1);
            window.__LL.teleport(d.x + d.nx * (up ? 0.9 : 1.1) + ux * sd * 0.6, d.z + d.nz * (up ? 0.9 : 1.1) + uz * sd * 0.6, undefined, d.level);
            window.__LL.lookAt(ax, d.y + (up ? 2.95 : 2.7), az);
            return {side: sd};
          }, [side, up]);
        }
        return;
      }
      // under a pit flight: the lower storey's open floor cell under a flight's mid point with the most room, looking up at it
      await shot('stair-under', () => {
        const g = window.__game, L = g.layout, C = 0.5, b = L.reactor.pit.bounds, lv = L.levels;
        let best = null;
        for (let k = 0; k < lv.length; k++) for (const r of lv[k].grid.ramps) {
          const mx = (r.x + r.w / 2) * C, mz = (r.y + r.h / 2) * C;
          if (mx < b.x0 || mx > b.x1 || mz < b.z0 || mz > b.z1) continue;
          const top = (r.h0 + r.h1) / 2;
          for (let j = 0; j < lv.length; j++) {
            const q = lv[j].grid, i = q.idx(Math.floor(mx / C), Math.floor(mz / C));
            if (q.cells[i] !== 1 || q.rampIdx[i] >= 0) continue;
            const f = q.floorOf(i), gap = top - f;
            if (gap > 2.6 && gap < 9 && (!best || gap < best.gap)) best = {x: mx, z: mz, level: j, f, top, gap};
          }
        }
        if (!best) return {none: true};
        window.__LL.teleport(best.x + 1.2, best.z + 1.2, undefined, best.level);
        window.__LL.lookAt(best.x, best.top - 0.2, best.z);
        return best;
      });
      // the stairwell from the stair's top landing (inside the head house), looking down the flight
      await shot('stair-top', () => {
        const s = window.__game.layout.reactor.surface, t = s.stairs.top, r = s.stairs.rect;
        window.__LL.teleport(t.x, t.z, undefined, t.level);
        const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
        window.__LL.lookAt(t.x + (cx - t.x) * 0.25, t.y - 2.5, t.z + (cz - t.z) * 0.25);
        return {top: t, rect: r};
      });
      return;
    }
    // 1. the restart chain + the doors (QA setup), the player on the plaza
    if (!headroom('online')) return;
    step('online', await ev(() => window.__LL.reactorEnding({online: true})));
    await waitGame(3, 240);
    step('open', await ev(() => window.__LL.reactorEnding({open: true, skipMessage: true})));
    await waitGame(1, 120);
    step('exit', await ev(() => window.__LL.reactorEnding({go: 'exit'})));
    await waitGame(3, 300);
    // 2. the surface + the plant
    const surf = () => ev(() => { const q = window.__LL.reactorSurface(); return {shown: q.shown, plan: q.plan && {buildings: q.plan.buildings, maxDist: q.plan.maxDist}, plant: q.plant, visibleMeshes: q.visibleMeshes, tris: q.tris}; });
    const s1 = await surf();
    step('surface', s1);
    await waitGame(2, 120);
    const s2 = await surf();
    step('fans turning', {angle0: s1.plant?.angle, angle1: s2.plant?.angle, speed: s2.plant?.speed});
    if (VIEWS) {
      const g = await ev(() => { const s = window.__game.layout.reactor.surface; return {hole: s.hole, y: s.y, exit: s.exit, towers: (window.__LL.reactorSurface().plant?.towers ?? [])}; });
      const h = g.hole, R = h.keepR + 2.5;
      const at = (tx, tz, r) => { const dx = tx - h.x, dz = tz - h.z, l = Math.hypot(dx, dz) || 1; return [h.x + dx / l * r, h.z + dz / l * r]; };
      const views = [];
      for (const t of g.towers.slice(0, 2)) views.push({name: `tower-${views.length + 1}`, p: at(t.x, t.z, R), look: [t.x, g.y + 10, t.z]});
      const ax = h.x - g.exit.x, az = h.z - g.exit.z, al = Math.hypot(ax, az) || 1;
      const pc = [h.x + ax / al * (h.keepR + 6), h.z + az / al * (h.keepR + 6)];
      views.push({name: 'far-city', p: pc, look: [pc[0] + ax / al * 120, g.y + 9, pc[1] + az / al * 120]});
      const pd = at(g.exit.x, g.exit.z, h.keepR + 4.2);
      views.push({name: 'collar', p: pd, look: [h.x, g.y - 0.5, h.z]});
      for (const v of views) {
        if (!headroom(v.name)) break;
        const ok = await ev((v) => { const r = window.__LL.teleport(v.p[0], v.p[1], undefined, window.__game.layout.reactor.surface.level); window.__LL.lookAt(v.look[0], v.look[1], v.look[2]); return r; }, v);
        await waitGame(1.5, 120);
        await page.screenshot({path: path.join(out, `${v.name}.png`)});
        step(`view ${v.name} (internal)`, {teleported: ok, p: v.p.map(n => +n.toFixed(1))});
      }
      return;
    }
    // 3. frames (internal evidence; at most four)
    const look = (dx, dy, dz) => ev((d) => { const g = window.__game, p = g.player; window.__LL.lookAt(p.x + d[0], p.y + 1.6 + d[1], p.z + d[2]); }, [dx, dy, dz]);
    const hole = await ev(() => { const s = window.__game.layout.reactor.surface; return {x: s.hole.x, z: s.hole.z, y: s.y}; });
    const towers = await ev(() => (window.__LL.reactorSurface().plant?.towers ?? []).map(t => ({x: t.x, z: t.z})));
    const P = await ev(() => ({x: window.__game.player.x, z: window.__game.player.z}));
    if (headroom('frame hole')) {
      const t = towers[0] ?? hole;
      await look((hole.x + t.x) / 2 - P.x, 4, (hole.z + t.z) / 2 - P.z);
      await waitGame(1.5, 120);
      await page.screenshot({path: path.join(out, '1-aperture-tower.png')});
      step('frame: aperture + tower (internal)');
    }
    // the far city: away from the aperture (the horizon the user saw end), and across it
    const ax = P.x - hole.x, az = P.z - hole.z, L = Math.hypot(ax, az) || 1;
    if (headroom('frame city')) {
      await look(ax / L * 60, 6, az / L * 60);
      await waitGame(1.5, 120);
      await page.screenshot({path: path.join(out, '2-far-city.png')});
      step('frame: far city (internal)');
    }
    if (headroom('frame across')) {
      await look(-az / L * 60, 8, ax / L * 60);
      await waitGame(1.5, 120);
      await page.screenshot({path: path.join(out, '3-city-side.png')});
      step('frame: city to the side (internal)');
    }
    // 4. the credits
    if (headroom('credits')) {
      step('credits skip', await ev(() => window.__LL.reactorCredits({skip: 29})));
      await waitGame(2, 120);
      step('credits running', await ev(() => { const q = window.__LL.reactorCredits(); const el = document.querySelector('#reactor-credits'); const r = el?.getBoundingClientRect(); return {q, rect: r && {x: r.x, y: r.y, w: r.width, h: r.height}, vw: innerWidth}; }));
      await page.screenshot({path: path.join(out, '4-credits.png')});
      step('frame: credits (internal)');
      step('credits end', await ev(() => window.__LL.reactorCredits({end: true})));
      await waitGame(1, 60);
      step('end card', await ev(() => { const b = document.querySelector('#btn-credits-menu'); const r = b?.getBoundingClientRect(); return {button: b?.textContent, visible: !!r && r.width > 0, text: document.body.innerText.includes('Thank you for playing')}; }));
      await ev(() => document.querySelector('#btn-credits-menu')?.click());
      await sleep(1500);
      step('after Main Menu', {state: await ev(() => window.__LL.state())});
    }
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
});
