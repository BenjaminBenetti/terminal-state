// Beyond the Station round 2 browser spot check (task studio-alpha-track2-round2-20261031-01) — ONE short, serial, low-footprint
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
const out = path.resolve(process.argv[3] ?? 'qa-artifacts/track2-round2-browser');
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
    // 2. live registries
    const live = await ev(() => {
      const g = window.__game, l = g.layout, A = l.extensions?.annexes ?? [];
      const ids = new Set(A.flatMap(a => a.areas));
      const te = g.world?.trackExt;
      const hs = (g.containers?.all ?? []).filter(h => ids.has(h.prop.area));
      const cache = hs.filter(h => h.prop.purpose === 'annex-cache' || /cache/.test(h.prop.purpose ?? ''));
      const inA = (x, z) => { const [cx, cy] = l.grid.cellOf(x, z); return l.grid.inBounds(cx, cy) && ids.has(l.grid.area[l.grid.idx(cx, cy)]); };
      const zs = g.zombies.filter(z => inA(z.brain.x, z.brain.z));
      return {
        annexes: A.length, machines: te?.machines ? {draws: te.machines.draws, motion: te.machines.motion, rotors: !!te.machines.rotors} : null,
        gensets: te?.gensets ?? null, gensetRecords: (l.extensions?.machines ?? []).filter(m => m.kind === 'genset').length,
        fanAudio: window.__LL.audio().fans,
        cache: {holders: cache.length, stocked: cache.filter(h => h.state.lots.length).length, lots: cache.reduce((n, h) => n + h.state.lots.length, 0), items: cache.flatMap(h => h.state.lots.map(lt => lt.itemId)).slice(0, 24)},
        enemies: zs.map(z => z.archetype ?? z.kind ?? 'zombie'),
      };
    });
    step('annex runtime registries', live);
    const placeAt = async (label, kind, o) => {
      if (!headroom(label)) return null;
      const r = await ev((kind, o) => {
        const l = window.__game.layout, ms = (l.extensions?.machines ?? []).filter(m => m.kind === kind);
        const m = ms[o.pick ?? 0];
        if (!m) return null;
        const fx = Math.sin(m.rot), fz = Math.cos(m.rot), back = m.d / 2 + o.stand;
        const ok = window.__LL.teleport(m.x + fx * back + (o.side ?? 0) * fz, m.z + fz * back - (o.side ?? 0) * fx);
        const R = (m.p?.[0] ?? 1.6) / 2;
        const ty = kind === 'fanWall' ? m.y + 0.3 + R : m.y + (o.lookY ?? 0.9);
        window.__LL.lookAt(m.x + (kind === 'fanWall' ? fx * (-m.d / 2 + 0.38) : 0), ty, m.z + (kind === 'fanWall' ? fz * (-m.d / 2 + 0.38) : 0));
        const P = window.__game.player;
        return {ok, machine: {x: m.x, y: m.y, z: m.z, rot: m.rot, w: m.w, d: m.d, h: m.h}, player: {x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2)}};
      }, kind, o);
      step(`placement ${label}`, r ?? {missing: kind});
      return r;
    };
    const shot = async name => { if (!headroom(name)) return false; await page.screenshot({path: path.join(out, `${code}-${name}.png`)}); step(`screenshot ${name}`); return true; };
    // a. generator room
    if (await placeAt('genset', 'genset', {stand: 2.6, side: 0.8, lookY: 0.8})) { await waitGame(0.8, 180); await shot('a-genset'); }
    // b. wall fan pair + fan audio
    if (await placeAt('fan', 'fanWall', {stand: 1.6})) {
      await waitGame(0.8, 180);
      if (await shot('b-fan-t0')) {
        const dt = await waitGame(0.5, 120);
        await shot('b-fan-t1');
        step('fan audio near a fan', {gameSeconds: +dt.toFixed(2), fans: await ev(() => window.__LL.audio().fans)});
      }
    }
    // c. sewage channel pair
    if (await placeAt('channel', 'channel', {stand: 1.2, lookY: -0.2})) {
      await waitGame(0.8, 180);
      if (await shot('c-water-t0')) { const dt = await waitGame(1, 120); await shot('c-water-t1'); step('water pair', {gameSeconds: +dt.toFixed(2)}); }
    }
    // d. the survivor cache room (camera inside it, aimed at the bed / storage), only with headroom
    if (headroom('cache')) {
      const c = await ev(() => {
        const g = window.__game, l = g.layout;
        const h = (g.containers?.all ?? []).find(x => x.prop.purpose === 'annex-cache' || /cache/.test(x.prop.purpose ?? ''));
        if (!h) return null;
        const a = l.areas[h.prop.area], cx = (a.x + a.w / 2) * 0.5, cz = (a.y + a.h / 2) * 0.5;
        const ok = window.__LL.teleport(cx + (cx - h.prop.x) * 0.6, cz + (cz - h.prop.z) * 0.6);
        window.__LL.lookAt(h.prop.x, (a.floorY ?? 0) + 0.7, h.prop.z);
        return {ok, area: a.id, purpose: a.purpose, depth: a.depth, holder: h.kind};
      });
      step('placement cache', c ?? {missing: 'cache'});
      if (c) { await waitGame(0.8, 180); await shot('d-cache'); }
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
