// Iteration-08 browser check of the STATIC build (Firefox + Xvfb/Mesa, normal sandbox, /tmp/ll-browser-qa.lock).
// Multilevel stations: stairs walked by real keyboard input (W held; QA only sets the view yaw toward the
// next waypoint, standing in for mouse look), screenshots on upper/main/lower, wall zones, an enemy chasing
// across a stair connector, shots blocked by a slab vs through a light well, items on different storeys;
// USER-UPDATE-01: openable bins/other containers (real [E]), 3D shelf stock scattered by an ORDINARY
// frame-synced shotgun mouse shot, filler vs real-loot highlight/pickup, resource counts. ?qa=1 hooks set up
// positions/aim and read state; they are never the proof of movement, shooting or opening.
// Usage: node game/e2e/iter08-check.mjs OUTDIR [--dist=dist/game] [--seed=1A2B3C] [--only=a,b]
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, withBrowserLock} from '../../tools/qa/browser-env.mjs';
import {serveStatic} from '../../tools/qa/static-server.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'qa-artifacts/iter08');
const dist = path.resolve(arg('dist', 'dist/game'));
const SEED = arg('seed', '1A2B3C');
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const want = k => !ONLY || ONLY.includes(k);
fs.mkdirSync(outDir, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {startedAt: new Date().toISOString(), dist, seed: SEED, steps: [], pageErrors: [], console: [], badResponses: [], screenshots: [], resources: []};
const step = (name, ok, detail = {}) => { report.steps.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(detail).slice(0, 900)); return ok; };

await withBrowserLock(async () => {
  const {server, port} = await serveStatic(dist, {prefix: '/'});
  const browser = await launchBrowser();
  report.browser = await browser.version();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 600)));
  page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) report.console.push(`${m.type()}: ${m.text()}`.slice(0, 500)); });
  page.on('response', r => { if (r.status() >= 400) report.badResponses.push(`${r.status()} ${r.url()}`); });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const snap = () => ev(() => window.__LL.snapshot());
  const shot = async name => { const f = path.join(outDir, `${name}.png`); await page.screenshot({path: f}); report.screenshots.push(f); };
  const waitFor = async (fn, timeout = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) return null; await sleep(200); } };
  const frames = n => ev(k => new Promise(res => { let i = 0; const t = setTimeout(() => res(i), 60000); const f = () => { if (++i >= k) { clearTimeout(t); res(i); } else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
  const fireNormal = async () => { await page.mouse.down(); await frames(2); await page.mouse.up(); await frames(8); };
  const pl = () => ev(() => { const p = window.__game.player, L = window.__game.levels; const s = L.supportAt(p.x, p.z, p.y + 0.05); return {x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), level: s?.level ?? -1, floor: s?.floor ?? null, ceil: s?.ceil ?? null, crouched: !!p.crouched}; });
  /** QA setup between sections: keep the player alive (long llvmpipe runs give zombies time to wander in). */
  const heal = () => ev(() => { const p = window.__game.player; if (p.hp > 0) p.hp = p.maxHp; return {hp: p.hp, alive: p.alive, state: window.__LL.state()}; });
  const resources = async label => { const s = await snap(); const r = {label, render: s.render, level: s.level?.player, stock: await ev(() => window.__LL.stock?.() ?? null).catch(() => null), dyn: await ev(() => window.__LL.dynamics?.()?.dynamic?.counts ?? null).catch(() => null)}; report.resources.push(r); return r; };

  /**
   * Walk to a target with the W key held (normal player controller). Every few frames the view yaw is
   * pointed at the next path waypoint (QA stand-in for mouse look; no position is ever set here).
   */
  const walkTo = async (target, {timeout = 60000, reach = 0.7, crouch = false} = {}) => {
    const trace = [];
    let prev = await pl();
    trace.push(prev);
    let maxJump = 0;
    if (crouch) await page.keyboard.press('KeyC');
    await page.keyboard.down('KeyW');
    const t0 = Date.now();
    let ok = false;
    try {
      while (Date.now() - t0 < timeout) {
        await ev(t => {
          const g = window.__game, p = g.player;
          const path = window.__LL.pathTo(t.x, t.z, t.y);
          const wps = Array.isArray(path) ? path : path?.points ?? path?.path ?? [];
          let next = null;
          for (const w of wps) { const d = Math.hypot(w[0] - p.x, w[1] - p.z); if (d > 0.45) { next = w; break; } }
          const nx = next ? next[0] : t.x, nz = next ? next[1] : t.z;
          p.yaw = Math.atan2(-(nx - p.x), -(nz - p.z));
          p.pitch = 0;
        }, target);
        await frames(4);
        const q = await pl();
        maxJump = Math.max(maxJump, Math.abs(q.y - prev.y));
        trace.push(q);
        prev = q;
        if (Math.hypot(q.x - target.x, q.z - target.z) < reach && Math.abs(q.y - target.y) < 0.6) { ok = true; break; }
      }
    } finally {
      await page.keyboard.up('KeyW');
      if (crouch) await page.keyboard.press('KeyC');
    }
    await frames(6);
    return {ok, end: await pl(), maxStepDy: +maxJump.toFixed(3), samples: trace.length, levels: [...new Set(trace.map(t => t.level))], trace: trace.filter((_, i) => i % 4 === 0).slice(0, 80)};
  };

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html?qa=1&seed=${SEED}`);
    const ready = await waitFor(() => ev(() => !!window.__LL?.ready() && window.__LL.state() === 'title').catch(() => false), 480000);
    step('loads to title', !!ready);
    await page.click('#btn-start');
    await waitFor(async () => (await snap()).state === 'playing', 180000);
    await sleep(3000);
    // QA setup: keep the player alive for the whole run (llvmpipe frames are slow, so zombies on other storeys reach a
    // player standing still at a container). Zombies still perceive, chase and attack normally; damage is just refilled.
    await ev(() => { const p = window.__game.player; window.__qaHeal = setInterval(() => { if (p.hp > 0 && p.hp < p.maxHp) p.hp = p.maxHp; }, 100); });
    let s = await snap();
    const lv = await ev(() => window.__LL.levels());
    const links = await ev(() => (window.__game.layout.levelLinks ?? []).map(k => ({id: k.id, kind: k.kind, lower: k.lower, upper: k.upper, bottom: k.bottom, top: k.top})));
    const roles = await ev(() => window.__game.layout.levels.map(l => ({id: l.id, role: l.role, baseY: l.baseY})));
    step('station has stacked levels and stair connectors', (lv?.count ?? 0) >= 2 && links.length >= 2, {archetype: s.layout.archetype, roles, links: links.length, summary: {...lv, zombies: undefined}, unrailedDrops: lv?.unrailedDrops});
    await resources('spawn');
    await shot('00-spawn');

    const upperId = roles.find(r => r.role === 'upper')?.id;
    const lowerId = roles.find(r => r.role === 'lower')?.id;
    const upLink = links.find(k => k.lower === 0 && k.upper === upperId);
    const downLink = links.find(k => k.upper === 0 && k.lower === lowerId);

    if (want('stairs')) {
      // UP: main -> upper, by real input
      if (upLink) {
        const at = await ev(i => window.__LL.goLevelStairs(i, 'bottom'), links.indexOf(upLink));
        await frames(10); await shot('01-stair-up-foot');
        const w = await walkTo(upLink.top, {timeout: 90000});
        await shot('02-stair-up-top-upper-level');
        step('walks UP a stair connector main -> upper by held W (no snapping)', w.ok && w.end.level === upperId && w.maxStepDy < 0.6, {start: at, end: w.end, maxStepDy: w.maxStepDy, levels: w.levels, samples: w.samples});
        report.upTrace = w.trace;
        // look over the light well / deck edge
        const rail = await ev(() => { const r = (window.__game.layout.rails ?? [])[0]; return r ? {x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, y: r.y0, nx: r.nx, nz: r.nz, level: r.level} : null; });
        if (rail) {
          await ev(r => { window.__LL.teleport(r.x + r.nx * 1.6, r.z + r.nz * 1.6, undefined, r.level); window.__LL.lookAt(r.x - r.nx * 4, r.y - 2.5, r.z - r.nz * 4); }, rail);
          await frames(10); await shot('03-upper-railing-view-down');
          step('upper railing overlook (screenshot)', true, {rail, at: await pl()});
        }
        // walk back DOWN the same connector
        await ev(i => window.__LL.goLevelStairs(i, 'top'), links.indexOf(upLink));
        await frames(6);
        const d = await walkTo(upLink.bottom, {timeout: 90000});
        step('walks DOWN upper -> main by held W', d.ok && d.end.level === 0 && d.maxStepDy < 0.6, {end: d.end, maxStepDy: d.maxStepDy, levels: d.levels});
      } else step('upper connector exists', false, {links});

      // DOWN: main -> lower
      if (downLink) {
        await ev(i => window.__LL.goLevelStairs(i, 'top'), links.indexOf(downLink));
        await frames(10); await shot('04-stair-down-top');
        const w = await walkTo(downLink.bottom, {timeout: 90000});
        // then on into the service crossing (stair cells belong to both storeys; off the flight the storey is unambiguous)
        const dx = downLink.bottom.x - downLink.top.x, dz = downLink.bottom.z - downLink.top.z, dl = Math.hypot(dx, dz) || 1;
        const beyond = await ev((b, ux, uz, lv) => { const g = window.__game; for (const k of [2.5, 2.0, 1.5, 1.0]) { const x = b.x + ux * k, z = b.z + uz * k; const s = g.levels.supportAt(x, z, b.y + 0.05); if (s && s.level === lv && g.snap(x, z, lv)) return {x, y: s.floor, z}; } return null; }, downLink.bottom, dx / dl, dz / dl, lowerId);
        const w2 = beyond ? await walkTo(beyond, {timeout: 60000, reach: 0.5}) : null;
        await frames(6); await shot('05-lower-level-service');
        const endD = w2?.end ?? w.end;
        step('walks DOWN main -> lower service level by held W', w.ok && !!w2?.ok && endD.level === lowerId && w.maxStepDy < 0.6, {end: w.end, beyond, endBeyond: w2?.end, maxStepDy: w.maxStepDy, levels: [...new Set([...w.levels, ...(w2?.levels ?? [])])]});
        // headroom on the lower band
        const lq = await ev(() => window.__LL.levels().player);
        step('lower level headroom >= 2.1 m at the stair foot', (lq?.headroom ?? 0) >= 2.1, {lq});
        // under a platform? check a band above
        const bands = await ev(() => { const p = window.__game.player; return window.__game.levels.bands(p.x, p.z); });
        report.lowerBands = bands;
        const back = await walkTo(downLink.top, {timeout: 90000});
        step('walks back UP lower -> main by held W', back.ok && back.end.level === 0, {end: back.end, levels: back.levels});
      } else step('lower connector exists', false, {links});
    }

    await heal();
    if (want('overlap')) {
      // stand directly under an upper deck on main, and directly above on upper (same X/Z)
      const pt = await ev((u) => {
        const g = window.__game, L = g.levels, gr = g.layout.grid;
        for (let i = 0; i < gr.cells.length; i++) {
          const cx = i % gr.w, cy = Math.floor(i / gr.w);
          const x = (cx + 0.5) * 0.5, z = (cy + 0.5) * 0.5;
          const b = L.bands(x, z);
          const m = b.find(q => q.level === 0), up = b.find(q => q.level === u);
          if (m && up && gr.cells[i] === 1 && up.floor - m.ceil > 0.2 && m.ceil - m.floor > 2.3 && g.snap(x, z, 0) && g.snap(x, z, u)) return {x, z, main: m, upper: up};
        }
        return null;
      }, upperId);
      if (pt) {
        await ev(p => { window.__LL.teleport(p.x, p.z, 0.3, 0); }, pt); await frames(8);
        const a = await pl(); await ev(() => { window.__game.player.pitch = 0.5; }); await frames(4); await shot('06-main-under-upper-deck');
        await ev((p, u) => { window.__LL.teleport(p.x, p.z, 0.3, u); }, pt, upperId); await frames(8);
        const b = await pl(); await shot('07-upper-above-same-xz');
        // walk a little on the upper deck: no fall-through / snapping
        await page.keyboard.down('KeyW'); await frames(30); await page.keyboard.up('KeyW'); await frames(6);
        const c = await pl();
        step('overlapping storeys at the same X/Z: main under the slab, upper above; walking keeps the storey', a.level === 0 && b.level === upperId && c.level === upperId, {pt, a, b, c});
      } else step('found an overlap column', false);
    }

    await heal();
    if (want('shoot')) {
      // slab between shooter and target blocks; an aperture/light well does not (world ray query)
      const r = await ev((u) => {
        const g = window.__game, L = g.levels, gr = g.layout.grid;
        let slab = null, well = null;
        for (let i = 0; i < gr.cells.length && !(slab && well); i++) {
          const cx = i % gr.w, cy = Math.floor(i / gr.w);
          const x = (cx + 0.5) * 0.5, z = (cy + 0.5) * 0.5;
          const b = L.bands(x, z);
          const up = b.find(q => q.level === u), m = b.find(q => q.level === 0);
          if (!slab && up && m && up.floor - m.ceil > 0.2) {
            const h = L.raycast({x, y: up.floor + 1.5, z}, {x: 0, y: -1, z: 0}, 20, {props: g.layout.props});
            slab = {x, z, upFloor: up.floor, mainCeil: m.ceil, hit: h && {t: h.t, kind: h.kind, level: h.level, ny: h.ny}};
          }
          if (!well && m && !up && m.ceil > (g.layout.levels[u]?.baseY ?? 5) + 1) {
            const h = L.raycast({x, y: m.ceil - 0.3, z}, {x: 0, y: -1, z: 0}, 20, {props: g.layout.props});
            well = {x, z, mainCeil: m.ceil, mainFloor: m.floor, hit: h && {t: h.t, kind: h.kind, level: h.level}};
          }
        }
        return {slab, well};
      }, upperId);
      const slabOk = r.slab?.hit?.kind === 'floor' && Math.abs((r.slab.upFloor + 1.5) - r.slab.hit.t - r.slab.upFloor) < 0.05;
      const wellOk = r.well && r.well.hit && (r.well.hit.kind === 'floor') && r.well.hit.t > 3;
      step('ray down from the upper deck stops on its slab; ray down a light well reaches the floor below', !!slabOk && !!wellOk, r);

      // real shot: player on upper, zombie below the slab (QA-placed) -> rifle shot into the slab doesn't hurt it
      const zi = await ev(() => window.__game.zombies.findIndex(z => z.brain.alive && (z.archetype ?? 'zombie') === 'zombie'));
      if (zi >= 0 && r.slab) {
        await ev((i, p, u) => { const g = window.__game, z = g.zombies[i]; z.brain.x = p.x; z.brain.z = p.z; z.brain.y = p.mainFloor ?? g.levels.grid(0).floorAt(p.x, p.z); z.brain.state = 'idle'; window.__LL.teleport(p.x + 1.2, p.z, undefined, u); window.__LL.lookAt(p.x, (p.mainFloor ?? 0) + 1.2, p.z); }, zi, {...r.slab, mainFloor: null}, upperId);
        await page.keyboard.press('Digit1'); await frames(30);
        const hp0 = await ev(i => window.__game.zombies[i].brain.hp, zi);
        const m0 = (await snap()).held?.mag;
        await fireNormal(); await frames(10);
        const hp1 = await ev(i => window.__game.zombies[i].brain.hp, zi);
        const m1 = (await snap()).held?.mag;
        await shot('08-shot-into-slab');
        step('ordinary mouse shot from the upper deck down at a zombie below the slab is stopped by the slab', m1 < m0 && hp1 === hp0, {hp0, hp1, ammo: [m0, m1]});
      }
    }

    if (want('pursuit') && upLink) {
      // enemy pursuit across a connector: player at the stair top (upper), zombie QA-placed on main near the foot;
      // a real gunshot (noise) draws it; it must climb the stairs (its storey changes) and approach
      await ev(i => window.__LL.goLevelStairs(i, 'top'), links.indexOf(upLink)); await frames(6);
      const me = await pl();
      const zi = await ev(() => window.__game.zombies.findIndex(z => z.brain.alive && (z.archetype ?? 'zombie') === 'zombie'));
      if (zi >= 0) {
        const placed = await ev((i, b) => { const g = window.__game, z = g.zombies[i]; const p = g.snap(b.x + 1.0, b.z, 0) ?? [b.x, b.z]; z.brain.x = p[0]; z.brain.z = p[1]; z.brain.y = g.levels.grid(0).floorAt(p[0], p[1]); z.brain.state = 'idle'; return {x: z.brain.x, y: z.brain.y, z: z.brain.z, level: g.levels.levelAt(z.brain.x, z.brain.z, z.brain.y + 0.05)}; }, zi, upLink.bottom);
        await ev(() => { window.__game.player.pitch = 0.6; }); await frames(4);
        await fireNormal(); // noise
        const lvSeen = new Set();
        const tr = [];
        const t0 = Date.now();
        let reached = null;
        while (Date.now() - t0 < 60000) {
          await frames(10);
          const z = await ev((i) => { const g = window.__game, b = g.zombies[i].brain, p = g.player; return {x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), level: g.levels.levelAt(b.x, b.z, b.y + 0.05), state: b.state, d: +Math.hypot(b.x - p.x, b.z - p.z, b.y - p.y).toFixed(2), hp: b.hp}; }, zi);
          lvSeen.add(z.level); tr.push(z);
          if ((z.level === upperId || z.y >= me.y - 0.45) && z.d < 2.5) { reached = z; break; }
          await heal();
        }
        await ev((i) => { const b = window.__game.zombies[i].brain; window.__LL.lookAt(b.x, b.y + 1.4, b.z); }, zi); await frames(4);
        await shot('09-zombie-pursuit-up-stairs');
        await ev(i => { const b = window.__game.zombies[i].brain; if (b.alive) b.damage(b.hp + 1, b.x, b.z); }, zi); await heal();
        step('zombie chases the player across the stair connector (main -> upper)', !!reached && placed.y < 0.5 && placed.level === 0, {me, placed, firstSample: tr[0], reached, levelsSeen: [...lvSeen], trace: tr.filter((_, i) => i % 3 === 0).slice(0, 40)});
      }
    }

    await heal();
    if (want('items')) {
      // drop items on the upper deck and on main under the slab; they settle on their own storey
      const res = [];
      for (const [label, lvl] of [['upper', upperId], ['main', 0], ['lower', lowerId]]) {
        if (lvl === undefined) continue;
        const pt = await ev((lv) => {
          const g = window.__game, gr = g.levels.grid(lv), L = g.levels; const cand = [];
          for (let i = 0; i < gr.cells.length; i++) {
            if (gr.cells[i] !== 1) continue; const a = g.layout.areas[gr.area[i]]; if (!a || (a.level ?? 0) !== lv) continue;
            const x = (i % gr.w + 0.5) * 0.5, z = (Math.floor(i / gr.w) + 0.5) * 0.5; const s = L.supportAt(x, z, gr.floor[i] + 0.05);
            if (s && s.level === lv && Math.abs(gr.floor[i] - (g.layout.levels[lv].baseY)) < 0.05 && g.snap(x, z, lv)) cand.push({x, z});
          }
          return cand.length ? cand[Math.floor(cand.length / 2)] : null;
        }, lvl);
        if (!pt) continue;
        await ev((p, lv) => window.__LL.teleport(p.x, p.z, 0, lv), pt, lvl); await frames(8);
        const before = await ev(() => window.__game.pickups.list?.length ?? window.__game.pickups.items?.length ?? null);
        // drop the selected stack with the normal key (Q / G per controls)
        const dropSlot = await ev(() => { const h = window.__game.inv.hotbar; const i = h.findIndex(s => s && s.itemId !== 'rifle' && s.itemId !== 'shotgun'); return i; });
        if (dropSlot < 0) continue;
        await page.keyboard.press(`Digit${dropSlot + 1}`); await frames(4);
        await page.keyboard.press('KeyG'); await frames(60);
        const after = await ev(() => { const g = window.__game; const arr = g.pickups.list ?? g.pickups.items ?? []; const p = g.player; return arr.map(q => ({id: q.stack?.itemId, x: q.x, y: q.y, z: q.z, d: Math.hypot(q.x - p.x, q.z - p.z)})).filter(q => q.d < 3); });
        const me = await pl();
        res.push({label, level: lvl, me, before, near: after.slice(0, 4)});
        // pick it back up with a real [E]
        if (after.length) { await ev(q => window.__LL.lookAt(q.x, q.y + 0.05, q.z), after[0]); await frames(4); await page.keyboard.press('KeyE'); await frames(20); }
      }
      await shot('10-items-on-storeys');
      const ok = res.length >= 2 && res.every(r => r.near.length === 0 || r.near.every(q => Math.abs(q.y - (r.me.floor ?? r.me.y)) < 0.4));
      step('dropped items settle on the storey they were dropped on', ok, {res});
    }

    await heal();
    if (want('walls')) {
      // wall zones: platform, service, lower, tunnel, concourse — aim at faces published by the builder
      const faces = await ev(() => { const f = window.__game.world?.wallFaces ?? []; const pick = {}; for (const w of f) { if (w.slope) continue; const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0); if (len < 4 || w.y1 - w.y0 < 1.5) continue; if (!pick[w.zone] || Math.random() < 0.15) pick[w.zone] = {zone: w.zone, level: w.level, finish: w.finish, x: (w.x0 + w.x1) / 2, z: (w.z0 + w.z1) / 2, nx: w.nx, nz: w.nz, y0: w.y0, y1: w.y1}; } return Object.values(pick); });
      // real loot: still highlighted + pickable after a blast (aim at a lot / lifted pickup nearby, ordinary [E])
      const shots = [];
      for (const f of faces.slice(0, 8)) {
        const ok = await ev(w => window.__LL.teleport(w.x + w.nx * 2.6, w.z + w.nz * 2.6, undefined, w.level), f);
        if (!ok) continue;
        await ev(w => window.__LL.lookAt(w.x, w.y0 + 1.3, w.z), f); await frames(8);
        await shot(`11-wall-${f.zone}`); shots.push(f.zone);
      }
      step('wall zone screenshots (platform / service / lower / tunnel / concourse …)', shots.length >= 4, {zones: shots, available: faces.map(f => f.zone), wallDetail: await ev(() => window.__game.world?.wallDetail?.stats ?? window.__game.world?.wallDetailStats ?? null).catch(() => null)});
    }

    await heal();
    if (want('openables')) {
      const info0 = await ev(() => window.__LL.openables?.() ?? null);
      const have = Object.keys(info0?.byKind ?? {});
      const order = ['bin', 'wheelieBin', 'filingCabinet', 'staffLockers', 'newspaperVendingBox', 'rollingToolChest', 'chestFreezer', 'shopCooler', 'kitchenette', 'desk', 'securityDesk', 'safe', 'firstAidCabinet', 'crashCart'];
      const kinds = [...order.filter(k => have.includes(k)), ...have.filter(k => !order.includes(k))];
      const P = () => page.$eval('#prompt', e => e.textContent).catch(() => null);
      const ids = st => (st?.parts?.[0]?.lots ?? []).map(l => `${l.id}:${l.itemId}x${l.count}`).sort();
      const invCount = () => ev(() => { const g = window.__game; return [...g.inv.hotbar, ...g.inv.pack].reduce((n, s) => n + (s ? s.count : 0), 0); });
      // QA setup: pick a holder of `kind` (optionally on `level`), preferring one whose compartment holds loot; stand + aim at that part
      const pick = (k, level) => ev((k, level) => {
        const g = window.__game, cm = g.containers, L = g.levels, p = g.player;
        const list = cm.openList.filter(h => h.kind === k && h.open && !h.open.loose && (level === undefined || (h.prop.level ?? 0) === level))
          .map(h => ({h, lotParts: [...new Set(h.state.lots.filter(l => l.part !== undefined).map(l => l.part))]}))
          .sort((a, b) => (b.lotParts.length > 0) - (a.lotParts.length > 0) || Math.hypot(a.h.prop.x - p.x, a.h.prop.z - p.z) - Math.hypot(b.h.prop.x - p.x, b.h.prop.z - p.z));
        for (const {h, lotParts} of list) {
          const part = lotParts[0] ?? 0;
          const st = cm.openableState(h.serial); const t = st?.parts[part];
          if (!t) continue;
          const lv = h.prop.level ?? 0;
          if (!window.__LL.teleport(t.stand.x, t.stand.z, undefined, lv)) continue;
          if (Math.hypot(p.x - t.stand.x, p.z - t.stand.z) > 0.4) continue;
          if (!L.lineOfSight({x: p.x, y: p.y + 1.6, z: p.z}, t.aim, {slack: 0.3})) continue;
          window.__LL.lookAt(t.aim.x, t.aim.y, t.aim.z);
          return {serial: h.serial, part, st};
        }
        return null;
      }, k, level);
      const aimPart = (serial, part) => ev((sr, pt) => { const a = window.__LL.openableState(sr).parts[pt].aim; window.__LL.lookAt(a.x, a.y, a.z); }, serial, part);
      const partState = (serial, part) => ev((sr, pt) => { const s = window.__LL.openableState(sr); const q = s.parts[pt]; return {open: q.open, t: q.t, lots: q.lots.map(l => `${l.id}:${l.itemId}x${l.count}`).sort(), loose: s.loose}; }, serial, part);
      const one = async (k, level, tag) => {
        const sel = await pick(k, level);
        if (!sel) return null;
        const {serial, part, st: st0} = sel;
        await frames(4); await aimPart(serial, part); await frames(6);
        const s0 = await partState(serial, part);
        const r = {kind: k, tag, serial, part, level: st0.level, label: st0.label, partName: st0.parts[part].name, move: st0.parts[part].move, prompt0: await P(), closed: s0.open === false, lotsAtStart: s0.lots};
        await shot(`12-${tag}-${k}-closed`);
        await page.keyboard.press('KeyE'); await frames(45);
        const s1 = await partState(serial, part);
        r.opened = !!s1.open && s1.t > 0.5; r.t = s1.t; r.lotsOpen = s1.lots; r.prompt1 = await P();
        r.sameLotsAfterOpen = JSON.stringify(s1.lots) === JSON.stringify(s0.lots);
        await shot(`13-${tag}-${k}-open`);
        // walk-away persistence (QA reposition), then back: still open, identical lots
        await ev(() => { const p = window.__game.player; window.__LL.teleport(p.x + 6, p.z, undefined, window.__game.levels.levelAt(p.x, p.z, p.y + 0.05)); }); await frames(20);
        const st = st0.parts[part].stand;
        await ev((s, lv) => window.__LL.teleport(s.x, s.z, undefined, lv), st, st0.level); await frames(4); await aimPart(serial, part); await frames(6);
        const s2 = await partState(serial, part);
        r.persisted = !!s2.open && JSON.stringify(s2.lots) === JSON.stringify(r.lotsOpen);
        if (r.lotsOpen.length) {
          const n0 = await invCount();
          await aimPart(serial, part); await frames(4);
          await page.keyboard.press('KeyE'); await frames(30);
          const s3 = await partState(serial, part);
          r.took = (await invCount()) - n0; r.lotsAfterTake = s3.lots;
        }
        // [E] closes (empty), [E] reopens: nothing regenerates
        if ((await partState(serial, part)).lots.length === 0) {
          await aimPart(serial, part); await frames(4);
          await page.keyboard.press('KeyE'); await frames(45);
          r.closedAgain = (await partState(serial, part)).open === false;
          await aimPart(serial, part); await frames(4);
          await page.keyboard.press('KeyE'); await frames(45);
          const s5 = await partState(serial, part);
          r.reopened = !!s5.open; r.lotsOnReopen = s5.lots;
          await shot(`13b-${tag}-${k}-reopened-empty`);
        }
        return r;
      };
      const results = [];
      for (const k of kinds) { const r = await one(k, undefined, 'main'); if (r) results.push(r); if (results.length >= 6) break; }
      // the same on another storey
      const elev = [];
      for (const lv of [upperId, lowerId]) {
        if (lv === undefined) continue;
        for (const k of kinds) { if (!(info0.byKind[k]?.levels?.[lv] > 0)) continue; const r = await one(k, lv, `level${lv}`); if (r) { elev.push(r); break; } }
      }
      const okR = r => r.closed && r.opened && r.sameLotsAfterOpen && r.persisted && (r.took === undefined || (r.took > 0 && r.lotsAfterTake.length === 0)) && (r.closedAgain === undefined || (r.closedAgain && r.reopened && r.lotsOnReopen.length === 0));
      const bin = results.find(r => r.kind === 'bin' || r.kind === 'wheelieBin');
      step('garbage can opens with an ordinary [E]; lid moves; contents finite and persistent', !!bin && okR(bin), {bin});
      step('representative other container types open/take/close/reopen by [E] without regenerating loot', results.filter(okR).length >= 4, {results});
      step('openables on a nonzero elevation behave the same', elev.length >= 1 && elev.every(okR), {elev});
      report.openables = {info0, results, elev, after: await ev(() => window.__LL.openables())};
    }

    await heal();
    if (want('stock')) {
      // QA setup: give a shotgun + shells (the station loot may not have one near); the SHOT is an ordinary mouse click
      await ev(() => {
        const g = window.__game, inv = g.inv;
        // free quick slot 3 (move whatever is there into the backpack), then put the shotgun there + shells in the pack
        const at = {bar: 'hotbar', index: 2};
        if (inv.get(at)) { const j = inv.pack.findIndex(s => !s); if (j >= 0) inv.move(at, {bar: 'pack', index: j}); else inv.set(at, null); }
        inv.set(at, inv.makeStack('shotgun', 1, 6));
        inv.add(inv.makeStack('ammo_shells', 18));
      });
      const slot = await ev(() => window.__game.inv.hotbar.findIndex(s => s?.itemId === 'shotgun'));
      const st0 = await ev(() => window.__LL.stock());
      step('stocked shelves carry separate 3D filler pieces (counts/draw calls)', (st0?.pieces ?? st0?.filler ?? 0) > 0 || Object.values(st0?.byLevel ?? {}).some(v => v.pieces > 0), {stock: {...st0, shops: st0?.shops?.slice(0, 6)}});
      const blast = async (level, tag) => {
        const sh = await ev(lv => window.__LL.goStockedShelf(lv), level);
        if (!sh) return {level, missing: true};
        await page.keyboard.press(`Digit${slot + 1}`); await frames(50);
        await ev(a => window.__LL.lookAt(a.x, a.y, a.z), sh.aim); await frames(4);
        const prompt = await page.$eval('#prompt', e => (e.offsetParent ? e.textContent : '')).catch(() => null);
        const target = await ev(() => { const g = window.__game, t = g.containerTarget, pk = g.currentTarget; return {holder: t?.container.kind ?? null, lot: t?.lot ? {id: t.lot.id, itemId: t.lot.itemId} : null, pickup: pk ? pk.stack.itemId : null}; });
        await shot(`14-${tag}-stocked-shelf-before`);
        const m0 = await ev(() => window.__LL.stockMoved());
        const ammo0 = (await snap()).held?.mag;
        const dyn0 = await ev(() => window.__LL.dynamics()?.liftedLots?.length ?? 0);
        await fireNormal(); await frames(4);
        await shot(`15-${tag}-shotgun-blast-flying`);
        const mid = await ev(() => window.__LL.stockMoved());
        const t0 = Date.now(); let m1 = mid;
        while (Date.now() - t0 < 25000) { await frames(20); m1 = await ev(() => window.__LL.stockMoved()); if ((m1.physics?.awake ?? 0) === 0) break; }
        await shot(`16-${tag}-stock-settled`);
        const ammo1 = (await snap()).held?.mag;
        const dyn1 = await ev(() => window.__LL.dynamics()?.liftedLots?.length ?? 0);
        // aim straight at a knocked-down filler piece lying on the floor: nothing may target it
        const floorPiece = await ev(() => {
          const g = window.__game, p = g.player, L = g.levels; let best = null;
          for (const q of g.stock.filler.pieces) { if (!q.moved) continue; const f = L.floorAt(q.p.x, q.p.z, q.p.y + 0.2); if (!(q.p.y - f < 0.25)) continue; const d = Math.hypot(q.p.x - p.x, q.p.z - p.z); if (d > 0.8 && d < 2.2 && (!best || d < best.d)) best = {x: q.p.x, y: q.p.y, z: q.p.z, d}; }
          return best;
        });
        let floorAim = null;
        if (floorPiece) {
          await ev(q => window.__LL.lookAt(q.x, q.y + 0.03, q.z), floorPiece); await frames(4);
          floorAim = {piece: floorPiece, prompt: await page.$eval('#prompt', e => (e.offsetParent ? e.textContent : '')).catch(() => null),
            target: await ev(() => { const g = window.__game, t = g.containerTarget, pk = g.currentTarget; return {holder: t?.container.kind ?? null, lot: t?.lot?.itemId ?? null, pickup: pk ? pk.stack.itemId : null}; })};
          await shot(`16b-${tag}-aim-at-filler-on-floor`);
        }
        return {level, tag, shelf: sh, promptOnShelf: prompt, targetOnShelf: target, floorAim, ammo: [ammo0, ammo1], before: m0, mid, after: m1, liftedLots: [dyn0, dyn1], res: await resources(`after-shotgun-${tag}`)};
      };
      const takeRealLoot = async () => {
      const lot = await ev(() => {
        const g = window.__game, p = g.player, cm = g.containers;
        let best = null;
        for (const pk of g.pickups.list) { if (Math.abs(pk.y - p.y) > 2.5) continue; const d = Math.hypot(pk.x - p.x, pk.z - p.z); if (d < 4 && (!best || d < best.d)) best = {pickup: pk.stack.itemId, at: {x: pk.x, y: pk.y + 0.05, z: pk.z}, d}; }
        for (const h of cm.all) {
          if (h.group !== 'surface' || Math.hypot(h.prop.x - p.x, h.prop.z - p.z) > 6 || Math.abs(h.prop.y - p.y) > 2.5) continue;
          for (const l of h.state.lots) { const at = cm.lotPoint(h, l); if (at && (!best || Math.hypot(at.x - p.x, at.z - p.z) < best.d)) best = {serial: h.serial, id: l.id, itemId: l.itemId, at, d: Math.hypot(at.x - p.x, at.z - p.z)}; }
        }
        return best;
      });
      if (lot) {
        const inv0 = await ev(() => { const g = window.__game; return [...g.inv.hotbar, ...g.inv.pack].reduce((n, s) => n + (s ? s.count : 0), 0); });
        await ev(l => window.__LL.lookAt(l.at.x, l.at.y, l.at.z), lot); await frames(6);
        const prompt = await page.$eval('#prompt', e => (e.offsetParent ? e.textContent : '')).catch(() => null);
        await shot('17-real-loot-highlight-after-blast');
        await page.keyboard.press('KeyE'); await frames(20);
        const inv1 = await ev(() => { const g = window.__game; return [...g.inv.hotbar, ...g.inv.pack].reduce((n, s) => n + (s ? s.count : 0), 0); });
        return {lot, prompt, inv: [inv0, inv1]};
      }
      return {lot: null, note: 'no real loot within reach'};
      };
      let realLoot = null;
      const shots = [];
      if (slot >= 0) {
        shots.push(await blast(undefined, 'main'));
        realLoot = await takeRealLoot();
        for (const lv of [lowerId, upperId]) { if (lv === undefined) continue; const r = await blast(lv, `level${lv}`); shots.push(r); if (!r.missing) break; }
      }
      const okShot = r => !r.missing && r.ammo[1] < r.ammo[0] && (r.after.displaced - r.before.displaced) >= 3 && r.after.belowFloor === 0 && r.after.outside === 0 && (r.mid.physics?.awake ?? 0) <= (r.mid.physics?.max ?? 48);
      step('ordinary frame-synced shotgun mouse shot sends multiple stocked objects flying; they settle in bounds (active bodies bounded)', shots.length > 0 && okShot(shots[0]), {shot: shots[0]});
      step('shotgun scatter works the same on a nonzero elevation', shots.slice(1).some(okShot), {shots: shots.slice(1)});
      const real = r => !/\[E\]/.test(r.promptOnShelf ?? '') || !!r.targetOnShelf?.lot || !!r.targetOnShelf?.pickup;
      const floorOk = r => !r.floorAim || (!/\[E\]/.test(r.floorAim.prompt ?? '') || !!r.floorAim.target.pickup || !!r.floorAim.target.lot);
      const got = shots.filter(r => !r.missing);
      step('filler is never targeted: shelf prompts name only real loot / the holder, and a knocked-down filler piece aimed at directly gets no [E]', got.length > 0 && got.every(real) && got.every(floorOk) && got.some(r => r.floorAim), {checks: got.map(r => ({tag: r.tag, promptOnShelf: r.promptOnShelf, targetOnShelf: r.targetOnShelf, floorAim: r.floorAim}))});
      step('real loot near the blasted shelf keeps its prompt/highlight and is taken with [E] (right after the main blast)', !!realLoot?.lot && /\[E\]/.test(realLoot.prompt ?? '') && realLoot.inv[1] > realLoot.inv[0], {realLoot});
      report.stock = {before: st0, shots, after: await ev(() => window.__LL.stock())};
    }

    s = await snap();
    await resources('end');
    const shaderErr = report.console.filter(x => /shader|program|webgl|glsl/i.test(x));
    step('no page errors, shader errors or failed requests', report.pageErrors.length === 0 && !s.lastError && shaderErr.length === 0 && report.badResponses.length === 0,
      {pageErrors: report.pageErrors.slice(0, 3), lastError: s.lastError, shaderErr: shaderErr.slice(0, 3), bad: report.badResponses.slice(0, 5), consoleCount: report.console.length, console: report.console.slice(0, 6)});
  } catch (e) {
    step('script error', false, {error: String(e?.stack ?? e).slice(0, 900)});
  } finally {
    await browser.close();
    server.close();
    report.ok = report.steps.every(x => x.ok);
    fs.writeFileSync(path.join(outDir, 'iter08-check.json'), JSON.stringify(report, null, 2));
  }
});
