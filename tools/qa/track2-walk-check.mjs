// Track 2 (Beyond the Station) browser spot check — ONE short serial session (root CLAUDE.md browser policy; lock / watchdog /
// cleanup from browser-env.mjs; memory guard on cgroup anon + shmem > 6 GiB):
//   a real W walk (QA walker: the game's own pathfinder route, the W key held toward each waypoint; no teleport) from the
//   player's platform down into the track bed, along a track tunnel, through the service-annex door into the annex, a real
//   E press on annex loot (an openable holder, else a floor pickup), and the walk back up to the platform (the bed ladder).
//   Screenshots: start, tunnel, door, annex, loot, back. QA aiming (lookAt) only points the camera for screenshots / E.
// llvmpipe CPU rendering: functional / visual evidence only, not GPU performance or native WebGPU.
//
//   npm run build && node tools/qa/track2-walk-check.mjs [seedCode] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from './browser-env.mjs';
import {serveStatic} from './static-server.mjs';

const code = process.argv[2] ?? '00000RU'; // seed 1002: a tunnel annex ~30 m of walking from the start
const out = path.resolve(process.argv[3] ?? 'qa-artifacts/track2-walk');
fs.mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anon = () => { try { const s = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'); const g = k => Number(new RegExp(`^${k} (\\d+)$`, 'm').exec(s)?.[1] ?? 0); return g('anon') + g('shmem'); } catch { return 0; } };
const report = {code, started: new Date().toISOString(), steps: [], consoleErrors: [], peakGiB: 0, guard: false};
const step = (name, data) => { report.steps.push({name, ...data}); console.log(name, JSON.stringify(data).slice(0, 900)); };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(path.resolve('dist/game'), {prefix: '/'});
  let browser = null;
  const guard = setInterval(() => { const b = anon(); report.peakGiB = Math.max(report.peakGiB, b / 1024 ** 3); if (b > 6 * 1024 ** 3 && !report.guard) { report.guard = true; console.error('memory guard: closing the owned browser'); void browser?.close(); } }, 1000);
  try {
    browser = await launchBrowser({protocolTimeout: 300000});
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 20) report.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => { if (report.consoleErrors.length < 20) report.consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`); });
    await page.setViewport({width: 960, height: 540});
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${code}&quality=low&warmup=off`);
    let ready = false;
    for (let i = 0; i < 360 && !ready; i++) { ready = await page.evaluate(() => window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false); if (!ready) await sleep(1000); }
    step('loaded', {ready, seconds: (Date.now() - t0) / 1000});
    if (!ready) throw new Error('no title screen');
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const clock = () => ev(() => window.__game.clock);
    const waitGame = async (sec, capS = 240) => { const c0 = await clock(), r0 = Date.now(); while ((await clock()) - c0 < sec && Date.now() - r0 < capS * 1000) await sleep(600); return +((await clock()) - c0).toFixed(2); };
    const waitFor = async (fn, capS, arg) => { const r0 = Date.now(); while (Date.now() - r0 < capS * 1000) { if (await ev(fn, arg)) return true; await sleep(700); } return false; };
    const shot = n => page.screenshot({path: path.join(out, `${code}-${n}.png`)});
    await page.click('#btn-start');
    await waitFor(() => window.__LL.state() === 'playing', 180);
    await waitGame(1, 180);

    // The level's extensions (gen/trackExt): prefer an annex reached through a tunnel, nearest to the start.
    const info = await ev(() => {
      const l = window.__game.layout, e = l.extensions, sp = l.playerSpawn, C = 0.5;
      if (!e || !e.annexes.length) return {seed: l.seed, annexes: 0};
      const rect = id => { const a = l.areas[id]; return {id, x0: a.x * C, z0: a.y * C, x1: (a.x + a.w) * C, z1: (a.y + a.h) * C}; };
      const annexes = e.annexes.map(a => ({id: a.id, tunnel: a.tunnel, door: a.door, exit: a.exit, floorY: a.floorY, areaM2: a.areaM2, rects: a.areas.map(rect),
        dist: Math.hypot(a.exit.x - sp.x, a.exit.z - sp.z)})).sort((p, q) => (q.tunnel >= 0) - (p.tunnel >= 0) || p.dist - q.dist);
      const a = annexes[0], t = a.tunnel >= 0 ? e.tunnels[a.tunnel] : null;
      const doorS = t ? t.doors.find(d => d.annex === a.id)?.s ?? t.length / 2 : 0;
      const at = s => { if (!t) return null; let acc = 0; for (let i = 1; i < t.path.length; i++) { const p = t.path[i - 1], q = t.path[i], d = Math.hypot(q.x - p.x, q.z - p.z); if (acc + d >= s) { const f = (s - acc) / d; return {x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f}; } acc += d; } return t.path[t.path.length - 1]; };
      return {seed: l.seed, spawn: sp, annexes: annexes.length, tunnels: e.tunnels.length, pick: a, tunnel: t ? {id: t.id, length: t.length, cap: t.cap, floorY: t.floorY, mouth: at(0), in6: at(Math.min(6, doorS / 2)), beforeDoor: at(Math.max(0, doorS - 4)), atDoor: at(doorS), clues: t.clues.length} : null};
    });
    step('extensions', info);
    if (!info.annexes) throw new Error('this seed has no service annex');
    const A = info.pick, T = info.tunnel, fy = A.floorY;
    await ev(() => window.__LL.traceStart());
    if (T) await ev((p, y) => window.__LL.lookAt(p.x, y + 1.4, p.z), T.in6, fy);
    await waitGame(0.5, 90);
    await shot('0-start');

    // walk (real W) to a waypoint on storey height y; returns the walker status
    const walk = async (x, z, y, label, capS = 900) => {
      const n = await ev((a, b, c) => window.__LL.walkTo(a, b, c), x, z, y);
      if (!n) { step(`walk ${label}`, {status: 'no-path'}); return 'no-path'; }
      const r0 = Date.now(), c0 = await clock();
      await waitFor(() => window.__LL.walkStatus().status !== 'walking', capS);
      const st = await ev(() => window.__LL.walkStatus());
      step(`walk ${label}`, {waypoints: n, status: st.status, player: st.player, gameS: +((await clock()) - c0).toFixed(1), realS: (Date.now() - r0) / 1000});
      return st.status;
    };

    if (T) {
      await walk(T.in6.x, T.in6.z, fy, 'platform -> bed -> tunnel');
      await ev((p, y) => window.__LL.lookAt(p.x, y + 1.5, p.z), T.beforeDoor, fy);
      await waitGame(0.5, 90);
      await shot('1-tunnel');
      await walk(T.beforeDoor.x, T.beforeDoor.z, fy, 'along the tunnel to the door');
      await ev((p, y) => window.__LL.lookAt(p.x, y + 1.2, p.z), A.exit, fy);
      await waitGame(0.5, 90);
      await shot('2-door');
    }
    // into the annex: the far half of the entry corridor (the area the door opens into), then its first room
    const inner = A.rects.map(r => ({...r, cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2})).sort((p, q) => Math.hypot(p.cx - A.exit.x, p.cz - A.exit.z) - Math.hypot(q.cx - A.exit.x, q.cz - A.exit.z));
    const entry = inner[0];
    await walk(entry.cx, entry.cz, fy, 'through the door into the annex');
    const inside = await ev((rects) => { const p = window.__game.player; return rects.some(r => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1); }, A.rects);
    step('inside annex', {inside});
    const look = inner[1] ? {x: inner[1].cx, z: inner[1].cz} : {x: entry.cx + 2, z: entry.cz};
    await ev((q, y) => window.__LL.lookAt(q.x, y + 1.3, q.z), look, fy);
    await waitGame(0.5, 90);
    await shot('3-annex');

    // annex loot: an openable holder with lots (E opens; E on a lot takes it), else a floor pickup (E takes it)
    const loot = await ev((rects) => {
      const g = window.__game, inR = (x, z) => rects.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1), p = g.player;
      const holders = (g.containers?.all ?? []).map((h, serial) => ({serial, kind: h.kind, x: h.prop.x, z: h.prop.z, lots: h.state.lots.length, openable: !!h.open}))
        .filter(h => inR(h.x, h.z) && h.lots > 0).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const pickups = g.pickups.list.map((k, i) => ({i, itemId: k.stack.itemId, count: k.stack.count, x: k.x, y: k.y, z: k.z})).filter(k => inR(k.x, k.z))
        .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      return {holders: holders.length, pickups: pickups.length, holder: holders[0] ?? null, pickup: pickups[0] ?? null};
    }, A.rects);
    step('annex loot', loot);
    const invTotal = () => ev(() => { const v = window.__game.inv; return [...v.hotbar, ...v.pack, ...v.throwSlot, ...v.meleeSlot].reduce((n, s) => n + (s ? s.count : 0), 0); });
    if (loot.holder) {
      const aim = await ev(s => window.__LL.aimHolder(s), loot.holder.serial);
      await walk(aim.stand.x, aim.stand.z, fy, `to the ${loot.holder.kind}`);
      await ev(s => window.__LL.aimHolder(s), loot.holder.serial);
      await waitGame(0.3, 60);
      const before = await invTotal();
      if (loot.holder.openable) { await page.keyboard.press('KeyE'); await waitGame(1.2, 120); }
      await shot('4-holder');
      const st = await ev(s => window.__LL.aimHolder(s), loot.holder.serial);
      await waitGame(0.3, 60);
      await page.keyboard.press('KeyE'); await waitGame(0.8, 120);
      const after = await ev(s => window.__LL.aimHolder(s), loot.holder.serial);
      step('loot (holder)', {kind: loot.holder.kind, opened: st?.open ?? null, lotsBefore: loot.holder.lots, lotsAfter: after?.lots, invBefore: before, invAfter: await invTotal()});
      await shot('5-loot');
    } else if (loot.pickup) {
      const k = loot.pickup;
      await walk(k.x + 0.9, k.z, fy, `to the ${k.itemId}`);
      await ev(q => window.__LL.lookAt(q.x, q.y + 0.05, q.z), k);
      await waitGame(0.3, 60);
      const before = await invTotal(), n0 = await ev(() => window.__game.pickups.list.length);
      await page.keyboard.press('KeyE'); await waitGame(0.8, 120);
      step('loot (pickup)', {itemId: k.itemId, invBefore: before, invAfter: await invTotal(), pickupsBefore: n0, pickupsAfter: await ev(() => window.__game.pickups.list.length)});
      await shot('5-loot');
    }

    // back to the platform: out through the door, along the tunnel / bed, up the bed ladder
    const back = await walk(info.spawn.x, info.spawn.z, 0, 'annex -> tunnel -> bed -> ladder -> platform', 1200);
    const end = await ev(() => { const p = window.__game.player; return {x: p.x, y: p.y, z: p.z, alive: p.alive}; });
    step('back on the platform', {status: back, player: end, onPlatform: Math.abs(end.y) < 0.3});
    await ev(s => window.__LL.lookAt(s.x + 4, 1.4, s.z), info.spawn);
    await waitGame(0.4, 60);
    await shot('6-back');
    step('trace', await ev(() => window.__LL.traceSummary?.() ?? null));
  } catch (e) {
    step('error', {message: String(e?.message ?? e).slice(0, 400)});
  } finally {
    clearInterval(guard);
    await browser?.close().catch(() => {});
    server.close();
    report.finished = new Date().toISOString();
    fs.writeFileSync(path.join(out, `${code}-report.json`), JSON.stringify(report, null, 1));
    console.log('peak anon+shmem GiB', report.peakGiB.toFixed(2), 'guard', report.guard, 'console errors', report.consoleErrors.length);
  }
});
