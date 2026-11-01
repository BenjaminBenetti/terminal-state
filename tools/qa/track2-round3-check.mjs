// Beyond the Station round 3 browser spot check (task studio-alpha-track2-round3-recovery01-20261101-01; adapted from the round-2 check) — ONE short, serial, low-footprint
// session (root CLAUDE.md browser policy; lock / watchdog / cleanup from browser-env.mjs; the unchanged 6 GiB anon + shmem guard, plus
// an EARLIER self-stop at STOP_GIB so this check ends itself before the guard). Primary only.
//   1. load seed 00000ST (its one annex has a sewage room, a ventilation plant and a generator room), start, wait;
//   2. read the live game's registries: the annex machinery (water / foam meshes, fan rotors, the generated genset instances), the
//      fan audio channels, the survivor-cache holders, the service enemies' families;
//   3. HARNESS CAMERA PLACEMENTS (teleport; screenshots only — NOT a traversed route), each only with headroom:
//      a. the generator room: the generated genset on its plinth (+ concrete walls);
//      b. a wall fan from ~2 m: two frames 0.5 s of game time apart (rotor pose change) + the fan audio channel state;
//      c. the sewage channel: two frames 1 s apart (water flow);
//      d. the survivor cache room (bed / storage), if any headroom is left.
// llvmpipe CPU rendering: functional / visual evidence only, not GPU performance or native WebGPU; audio state is structural (the
// page has no listener — not an audition).
//
//   npm run build && node tools/qa/track2-round2-check.mjs [seedCode] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const code = process.argv[2] ?? '00000ST';
const out = path.resolve(process.argv[3] ?? 'qa-artifacts/track2-round3-browser');
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
    const shot = async name => { if (!headroom(name)) return false; await page.screenshot({path: path.join(out, `${code}-${name}.png`)}); step(`screenshot ${name}`); return true; };
    // 2. live registries (the real build): hideout caches, the gear piece, the survivor marks, the lantern lights, fans + their audio
    const live = await ev(() => {
      const g = window.__game, l = g.layout, X = l.extensions ?? {}, A = X.annexes ?? [];
      const hs = (g.containers?.all ?? []).filter(h => h.prop.purpose === 'annex-cache');
      const marks = X.cacheMarks ?? [];
      const gear = l.pickups.filter(p => p.reward === 'annex-cache-gear');
      return {
        annexes: A.map(a => ({id: a.id, areas: a.areas.length, hideout: a.hideout ?? null})),
        cacheHolders: hs.length, cacheStocked: hs.filter(h => h.state.lots.length).length, cacheLots: hs.reduce((n, h) => n + h.state.lots.length, 0),
        cacheItems: hs.flatMap(h => h.state.lots.map(lt => lt.itemId)).slice(0, 30),
        marks: {total: marks.length, arrow: marks.filter(m => m.kind === 'arrow').length, hideout: marks.filter(m => m.kind === 'hideout').length, tally: marks.filter(m => m.kind === 'tally').length},
        gearPickups: gear.map(p => p.itemId),
        lanternLights: l.lights.filter(li => li.virtual && li.warm).length,
        hideoutProps: l.props.filter(p => ['bedroll', 'palletBed', 'campTable', 'campLantern', 'campStove', 'footlocker'].includes(p.kind)).map(p => p.kind),
        fanAudio: window.__LL.audio().fans,
      };
    });
    step('annex runtime registries', live);
    // 3. fan audio at round-3 range: stand ~25-35 m from a wall fan on its storey (beyond round 2's 14 m cut-off), read the channels
    if (headroom('fan range')) {
      const r = await ev(() => {
        const l = window.__game.layout, ms = (l.extensions?.machines ?? []).filter(m => m.kind === 'fanWall');
        const ids = new Set((l.extensions?.annexes ?? []).flatMap(a => a.areas));
        for (const m of ms) {
          // candidate stand points 25-35 m away inside the annex (walkable), the nearest that teleports
          for (let d = 25; d <= 35; d += 2.5) for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2, x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
            const [cx, cy] = l.grid.cellOf(x, z);
            if (!l.grid.inBounds(cx, cy) || !ids.has(l.grid.area[l.grid.idx(cx, cy)])) continue;
            if (window.__LL.teleport(x, z)) { const P = window.__game.player; return {fan: {x: m.x, z: m.z, y: m.y}, at: {x: +P.x.toFixed(1), y: +P.y.toFixed(2), z: +P.z.toFixed(1)}, dist: +Math.hypot(P.x - m.x, P.z - m.z).toFixed(1)}; }
          }
        }
        return null;
      });
      step('placement fan range', r ?? {missing: 'stand point'});
      if (r) { await waitGame(0.6, 180); step('fan audio at range', {fans: await ev(() => window.__LL.audio().fans)}); }
    }
    // 4. one picture: the hideout from its doorway (camera placement, NOT a walked route), only with headroom
    if (headroom('hideout')) {
      const c = await ev(() => {
        const g = window.__game, l = g.layout, A = l.extensions?.annexes ?? [];
        const hid = A.map(a => a.hideout).find(h => h !== undefined);
        const h = (g.containers?.all ?? []).find(x => x.prop.purpose === 'annex-cache');
        const area = hid ?? h?.prop.area;
        if (area === undefined) return null;
        const a = l.areas[area], d = l.doors.find(q => q.a === area || q.b === area);
        const cx = (a.x + a.w / 2) * 0.5, cz = (a.y + a.h / 2) * 0.5, dx = d ? (d.x + d.w / 2) * 0.5 : cx, dz = d ? (d.y + d.h / 2) * 0.5 : cz;
        const ok = window.__LL.teleport(dx + (cx - dx) * 0.25, dz + (cz - dz) * 0.25);
        window.__LL.lookAt(cx, (a.floorY ?? 0) + 0.6, cz);
        return {ok, area, purpose: a.purpose, depth: a.depth};
      });
      step('placement hideout', c ?? {missing: 'hideout'});
      if (c) { await waitGame(0.8, 180); await shot('a-hideout'); }
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
