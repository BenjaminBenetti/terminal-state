// Task frame-budget-deferral-20261030 (lane MEASURE): Node benchmarks of the periodic / bursty work the game does inside a
// frame, on REAL generated levels (the Office, seed 4242, and a Subway station). OPT-IN — skipped in the default suite:
//
//   LL_BENCH=1 ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism \
//     game/tests/frame-costs.bench.test.ts
//
// Optional: LL_BENCH_OFFICE_SEED (default 4242), LL_BENCH_SUBWAY_SEED (default 1234), LL_BENCH_WORLD=0 skips the three.js
// world build (culler / containers / pickups / physics sections).
//
// Each section prints per-call distributions (n, median, p95, max, mean in ms on THIS machine) and the trigger / frequency
// the game uses, so the numbers can be ranked as frame-time candidates (lanes/MEASURE.notes). Nothing here asserts a
// timing (timings are machine-dependent); it only asserts that the measured job did its work. Uses the game's own code
// paths with the game's own parameters (PathFinder.find(…, 0.34, 26000, opts) as Game.brainWorld, VocalReach defaults,
// GasField on the tower domain as GasSystem.build, LevelCuller from buildWorld, ContainerManager.build / update / target).
//
// Every module is imported dynamically inside the tests, so the default (skipped) suite pays nothing for this file.

import {describe, expect, it} from 'vitest';

const BENCH = !!process.env.LL_BENCH;
const OFFICE_SEED = Number(process.env.LL_BENCH_OFFICE_SEED ?? 4242);
const SUBWAY_SEED = Number(process.env.LL_BENCH_SUBWAY_SEED ?? 1234);
const WORLD = process.env.LL_BENCH_WORLD !== '0';
const bench = BENCH ? describe : describe.skip;

const now = () => performance.now();

interface Dist { n: number; med: number; p95: number; max: number; mean: number; sum: number }
function dist(v: readonly number[]): Dist {
  if (!v.length) return {n: 0, med: NaN, p95: NaN, max: NaN, mean: NaN, sum: 0};
  const s = [...v].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  const sum = v.reduce((a, b) => a + b, 0);
  return {n: v.length, med: q(0.5), p95: q(0.95), max: s[s.length - 1], mean: sum / v.length, sum};
}
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const line = (label: string, d: Dist, extra = '') =>
  `  ${label.padEnd(46)} n ${String(d.n).padStart(5)}  med ${f3(d.med).padStart(8)}  p95 ${f3(d.p95).padStart(8)}  max ${f3(d.max).padStart(8)}  mean ${f3(d.mean).padStart(8)} ms${extra ? '  ' + extra : ''}`;
const out = (s: string) => process.stdout.write(s + '\n');

/** Deterministic PRNG for the bench's own choices (never the game's streams). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

type Mods = Awaited<ReturnType<typeof load>>;
async function load() {
  const [registry, levels, grid, physics, brain, creature, motor, lure, vocal, rngMod] = await Promise.all([
    import('../src/levels/registry'), import('../src/gen/levels'), import('../src/gen/grid'), import('../src/core/physics'),
    import('../src/ai/brain'), import('../src/ai/creatureActor'), import('../src/ai/motor'), import('../src/ai/lightLure'),
    import('../src/ai/vocalReach'), import('../src/core/rng'),
  ]);
  return {registry, levels, grid, physics, brain, creature, motor, lure, vocal, rngMod};
}

interface World {
  name: string;
  layout: import('../src/gen/stationTypes').StationLayout;
  L: import('../src/gen/levels').Levels;
  props: import('../src/core/physics').PropIndex;
  pf: import('../src/gen/grid').PathFinder;
  genMs: number;
  pfMs: number;
}

function makeWorld(m: Mods, level: 'office' | 'subway', seed: number): World {
  const t0 = now();
  const layout = m.registry.LEVELS[level].generate('main', {levelSeed: seed, startWeapon: 'pistol'});
  const t1 = now();
  const L = m.levels.levelsOf(layout);
  const props = new m.physics.PropIndex(L, layout.props);
  const t2 = now();
  const pf = new m.grid.PathFinder(L);
  const t3 = now();
  void t2;
  return {name: `${level} ${seed}`, layout, L, props, pf, genMs: t1 - t0, pfMs: t3 - t2};
}

/** Random walkable, prop-clear cell centres of level `lv` ([x, z, floor]). */
function walkables(w: World, m: Mods, lv: number, n: number, r: () => number): [number, number, number][] {
  const G = w.L.grid(lv), res: [number, number, number][] = [];
  for (let k = 0; k < n * 400 && res.length < n; k++) {
    const cx = Math.floor(r() * G.w), cy = Math.floor(r() * G.h);
    if (!G.walkable(cx, cy) || !G.circleClear((cx + 0.5) * m.grid.CELL, (cy + 0.5) * m.grid.CELL, 0.36)) continue;
    const c = G.center(cx, cy);
    res.push([c[0], c[1], G.cellFloor(cx, cy)]);
  }
  return res;
}

/** Game.brainWorld() as of main ed4f9b7 (no light sources: nothing lures). `findPath` is wrapped for counting. */
function brainWorld(w: World, m: Mods, player: {x: number; y: number; z: number}, rand: () => number, onPath: (ms: number, expanded: number) => void) {
  const g = w.layout.grid, L = w.L, multi = L.count > 1, CELL = m.grid.CELL;
  return {
    px: player.x, pz: player.z, playerAlive: true,
    los: (ax: number, az: number, bx: number, bz: number, ay?: number, by?: number) => multi && ay !== undefined && by !== undefined ? L.lineOfSight({x: ax, y: ay + 1.5, z: az}, {x: bx, y: by + 1.5, z: bz}) : g.lineOfSight(ax, az, bx, bz),
    walkClear: (ax: number, az: number, bx: number, bz: number, r: number, ay?: number, by?: number) => multi && ay !== undefined ? L.walkLineClear(ax, ay, az, bx, bz, r, by) : g.walkLineClearH(ax, az, bx, bz, r),
    findPath: (ax: number, az: number, bx: number, bz: number, opts?: import('../src/gen/grid').PathOpts) => {
      const t = now();
      const p = w.pf.find(ax, az, bx, bz, 0.34, 26000, opts);
      onPath(now() - t, w.pf.lastExpanded);
      return p;
    },
    py: player.y,
    ladder: (id: number) => w.layout.traversal.ladders[id],
    randomNear: (x: number, z: number, r: number, y?: number) => {
      const lv = multi && y !== undefined ? L.levelAt(x, z, y + 0.05) : 0;
      const G = lv > 0 ? L.grid(lv) : g;
      for (let i = 0; i < 14; i++) {
        const tx = x + (rand() * 2 - 1) * r, tz = z + (rand() * 2 - 1) * r;
        const [cx, cy] = G.cellOf(tx, tz);
        if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) {
          const c = G.center(cx, cy);
          return (multi ? [c[0], c[1], G.cellFloor(cx, cy)] : c) as [number, number, number];
        }
      }
      return null;
    },
    rand,
    ...m.lure.lureWorld(L, {attracting: () => []}),
  };
}

function spawnBrains(w: World, m: Mods) {
  return w.layout.zombies.map(s => {
    const b = s.archetype === 'ratdog' ? new m.creature.CreatureBrain(s.x, s.z, s.yaw) : new m.brain.ZombieBrain(s.type, s.x, s.z, s.yaw);
    b.y = s.y ?? w.L.grid(s.level ?? 0).floorAt(s.x, s.z);
    return b;
  });
}

/** Player feet at the layout's spawn (level 0 floor). */
function spawnPose(w: World): {x: number; y: number; z: number} {
  const s = w.layout.playerSpawn;
  return {x: s.x, y: w.L.grid(0).floorAt(s.x, s.z), z: s.z};
}

/**
 * Game.updateZombies() minus rendering / audio (brain.update -> turn -> moveZombie -> separation -> settle) for `frames`
 * frames at 60 Hz; returns per-frame ms + per-frame path counts / ms. `alert(frame)` may fire a noise (Game.alertZombies).
 */
function simulateAi(w: World, m: Mods, brains: import('../src/ai/brain').ZombieBrain[], player: {x: number; y: number; z: number}, frames: number,
  alert?: (frame: number, brains: import('../src/ai/brain').ZombieBrain[]) => void) {
  const dt = 1 / 60, rand = m.rngMod.mulberry32(77);
  let pathN = 0, pathMs = 0, expMax = 0;
  const pathCalls: number[] = [];
  const world = brainWorld(w, m, player, rand, (ms, e) => { pathN++; pathMs += ms; pathCalls.push(ms); if (e > expMax) expMax = e; });
  const find0 = world.findPath;
  let failN = 0, failMs = 0;
  world.findPath = (ax, az, bx, bz, opts) => { const t = now(); const p = find0(ax, az, bx, bz, opts); if (!p) { failN++; failMs += now() - t; } return p; };
  const frameMs: number[] = [], framePaths: number[] = [], framePathMs: number[] = [];
  for (let f = 0; f < frames; f++) {
    alert?.(f, brains);
    const n0 = pathN, ms0 = pathMs, t0 = now();
    for (const b of brains) {
      const out = b.update(dt, world);
      if (out.face !== null) {
        let d = out.face - b.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * dt;
        b.yaw += Math.max(-turn, Math.min(turn, d));
      }
      m.motor.moveZombie(b, out, dt, w.L, w.props);
      if (b.alive && !b.climbing) {
        for (const o of brains) {
          if (o === b || !o.alive || !m.motor.sameLevel(b.y, o.y)) continue;
          const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot(dx, dz), min = b.stats.radius + o.stats.radius;
          if (d > 1e-4 && d < min) { const push = (min - d) * 0.5; b.x += dx / d * push; b.z += dz / d * push; }
        }
        m.motor.settleZombie(b, w.L, w.props);
      }
    }
    frameMs.push(now() - t0);
    framePaths.push(pathN - n0);
    framePathMs.push(pathMs - ms0);
  }
  return {frameMs, framePaths, framePathMs, pathCalls, pathN, pathMs, expMax, failN, failMs};
}

function reportAi(label: string, r: ReturnType<typeof simulateAi>, nZ: number) {
  const top = r.frameMs.map((ms, i) => ({i, ms, paths: r.framePaths[i], pathMs: r.framePathMs[i]})).sort((a, b) => b.ms - a.ms).slice(0, 5);
  out(line(`${label}: AI frame (all ${nZ} enemies)`, dist(r.frameMs)));
  out(line(`${label}: AI frame minus findPath`, dist(r.frameMs.map((ms, i) => ms - r.framePathMs[i]))));
  out(line(`${label}: findPath call`, dist(r.pathCalls), `max expanded ${r.expMax}; failed ${r.failN} (${r.failMs.toFixed(1)} ms total)`));
  out(`  ${label}: frames with >= 1 path ${r.framePaths.filter(n => n > 0).length}/${r.frameMs.length}; max paths in one frame ${Math.max(...r.framePaths)}; top frames ${top.map(t => `#${t.i} ${t.ms.toFixed(2)} ms (${t.paths} paths ${t.pathMs.toFixed(2)} ms)`).join(', ')}`);
}

// ---------------------------------------------------------------------------------------------------------------------

bench('frame-cost benchmarks (opt-in LL_BENCH=1; numbers go to lanes/MEASURE.notes)', () => {
  let m: Mods;
  let office: World;
  let subway: World;

  it('setup: generate the real levels (section build time, not per frame)', async () => {
    m = await load();
    out(`\n[bench] node ${process.version} · ${new Date().toISOString()}`);
    office = makeWorld(m, 'office', OFFICE_SEED);
    subway = makeWorld(m, 'subway', SUBWAY_SEED);
    for (const w of [office, subway]) {
      const G = w.L.grid(0);
      out(`[bench] ${w.name}: ${w.L.count} levels, grid ${G.w}x${G.h}, ${w.layout.zombies.length} enemies, ${w.layout.props.length} props, ${w.layout.pickups.length} pickups; generate ${w.genMs.toFixed(0)} ms, PathFinder ctor ${w.pfMs.toFixed(1)} ms (level heuristic ${w.pf.levelHeuristicMs.toFixed(1)} ms)`);
    }
    expect(office.L.count).toBeGreaterThan(5);
  });

  it('PathFinder.find distribution (A* + string pulling) — chase / wander / cross-storey requests', () => {
    for (const w of [office, subway]) {
      const r = rng(0xbeef), T: Record<string, number[]> = {}, E: Record<string, number[]> = {}, fails: Record<string, number> = {};
      const failMs: number[] = [], failExp: number[] = [];
      const rec = (k: string, ms: number, ok: boolean) => { (T[k] ??= []).push(ms); (E[k] ??= []).push(w.pf.lastExpanded); if (!ok) { fails[k] = (fails[k] ?? 0) + 1; failMs.push(ms); failExp.push(w.pf.lastExpanded); } };
      // walkLineClear (string pulling) share: count + time on the Levels instance the PathFinder holds
      const Lw = w.L as unknown as {walkLineClear: (...a: number[]) => boolean};
      const orig = Lw.walkLineClear.bind(w.L);
      let pullMs = 0, pullN = 0;
      const probe = (on: boolean) => { Lw.walkLineClear = on ? (...a: number[]) => { const t = now(); const v = orig(...a); pullMs += now() - t; pullN++; return v; } : orig; };
      const NL = w.L.count;
      const pts = Array.from({length: NL}, (_, lv) => walkables(w, m, lv, 40, r));
      const runs: {k: string; a: [number, number, number]; b: [number, number, number]; drops: boolean}[] = [];
      for (const s of w.layout.zombies) {
        const lv = s.level ?? 0, a: [number, number, number] = [s.x, s.z, s.y ?? w.L.grid(lv).floorAt(s.x, s.z)];
        const same = pts[lv].filter(p => { const d = Math.hypot(p[0] - a[0], p[1] - a[1]); return d > 3 && d < 22; });
        if (same.length) runs.push({k: 'same storey chase 3-22 m (drops)', a, b: same[Math.floor(r() * same.length)], drops: true});
        const near = pts[lv].filter(p => Math.hypot(p[0] - a[0], p[1] - a[1]) < 6);
        if (near.length) runs.push({k: 'wander <= 6 m', a, b: near[Math.floor(r() * near.length)], drops: false});
        for (const dl of [1, 3]) {
          const tl = lv + dl < NL ? lv + dl : lv - dl;
          if (tl < 0 || tl >= NL || !pts[tl].length) continue;
          runs.push({k: `cross-storey ${dl} (drops)`, a, b: pts[tl][Math.floor(r() * pts[tl].length)], drops: true});
        }
      }
      // two passes: plain timing, then the string-pulling probe (its own pass so the probe's timer calls do not skew pass 1)
      for (const q of runs) { const t = now(); const p = w.pf.find(q.a[0], q.a[1], q.b[0], q.b[1], 0.34, 26000, {drops: q.drops, ay: q.a[2], by: q.b[2]}); rec(q.k, now() - t, !!p); }
      probe(true);
      const pullByKind: Record<string, number[]> = {};
      for (const q of runs) { pullMs = 0; w.pf.find(q.a[0], q.a[1], q.b[0], q.b[1], 0.34, 26000, {drops: q.drops, ay: q.a[2], by: q.b[2]}); (pullByKind[q.k] ??= []).push(pullMs); }
      probe(false);
      out(`\n[bench] ${w.name}: PathFinder.find(…, 0.34, 26000) — ${runs.length} requests from every enemy spawn`);
      for (const k of Object.keys(T)) {
        out(line(k, dist(T[k]), `expanded med ${dist(E[k]).med} max ${dist(E[k]).max}; fails ${fails[k] ?? 0}; string-pull med ${f3(dist(pullByKind[k]).med)} max ${f3(dist(pullByKind[k]).max)} ms`));
      }
      out(line('FAILED searches (null)', dist(failMs), `expanded ${failExp.join(', ')} (cap 26000)`));
      void pullN;
      expect(runs.length).toBeGreaterThan(0);
    }
  });

  it('AI think per frame (brain + motor + separation): idle/wander, one gunshot, and a whole-level alert burst', () => {
    for (const w of [office, subway]) {
      const P = spawnPose(w);
      out(`\n[bench] ${w.name}: Game.updateZombies minus render/audio, player at the spawn (${w.layout.zombies.length} enemies, 60 Hz frames)`);
      // warm the JIT on a throwaway population (the game has been running for a while when a spike matters)
      simulateAi(w, m, spawnBrains(w, m), P, 120);
      reportAi('idle/wander 10 s', simulateAi(w, m, spawnBrains(w, m), P, 600), w.layout.zombies.length);
      const multi = w.L.count > 1, bases = multi ? w.L.list.map(l => l.baseY) : null;
      const shot = (radius: number) => (f: number, bs: import('../src/ai/brain').ZombieBrain[]) => {
        if (f !== 30) return;
        for (const b of bs) {
          if (!b.alive || Math.hypot(b.x - P.x, b.z - P.z, b.y - P.y) > radius) continue;
          const los = multi ? w.L.lineOfSight({x: P.x, y: P.y + 1.6, z: P.z}, {x: b.x, y: b.y + 1.5, z: b.z}) : w.layout.grid.lineOfSight(P.x, P.z, b.x, b.z);
          b.hear(P.x, P.z, radius * m.brain.hearingMuffle(los, bases ? m.brain.slabsBetween(bases, P.y, b.y) : 0), P.y);
        }
      };
      reportAi('shotgun (38 m) at frame 30, 10 s', simulateAi(w, m, spawnBrains(w, m), P, 600, shot(38)), w.layout.zombies.length);
      // worst case (not a game event today): every enemy on every storey hears the player at once -> every one re-paths
      const all = (f: number, bs: import('../src/ai/brain').ZombieBrain[]) => { if (f === 30) for (const b of bs) b.hear(P.x, P.z, 1e9, P.y); };
      reportAi('whole-level alert at frame 30, 10 s', simulateAi(w, m, spawnBrains(w, m), P, 600, all), w.layout.zombies.length);
    }
  });

  it('VocalReach: time-sliced route field (budget 1000 nodes / update) — build cost per update and per build', () => {
    for (const w of [office, subway]) {
      const t0 = now();
      const vr = new m.vocal.VocalReach(w.L);
      const ctor = now() - t0;
      let r = rng(0x5eed), steps: number[] = [], builds: number[] = [], perBuild: number[] = [], idle: number[] = [];
      for (let pass = 0; pass < 2; pass++) {
      // pass 0 = cold JIT (first builds of the session), pass 1 = warm (the same positions again) — reported separately
      if (pass === 1) {
        out(`\n[bench] ${w.name}: VocalReach COLD pass (first builds of the session)`);
        out(line('update() while building (one slice)', dist(steps)));
        out(line('whole build (sum of slices)', dist(builds)));
        r = rng(0x5eed); steps = []; builds = []; perBuild = []; idle = [];
      }
      for (let lv = 0; lv < w.L.count; lv++) {
        for (const p of walkables(w, m, lv, 3, r)) {
          let n = 0, tot = 0;
          let t = now(); vr.update(1, p[0], p[2], p[1]); let d = now() - t; steps.push(d); tot += d; n++;
          while (vr.building && n < 5000) { t = now(); vr.update(1 / 60, p[0], p[2], p[1]); d = now() - t; steps.push(d); tot += d; n++; }
          builds.push(tot); perBuild.push(n);
          for (let k = 0; k < 20; k++) { t = now(); vr.update(1 / 60, p[0], p[2], p[1]); idle.push(now() - t); }
        }
      }
      }
      out(`[bench] ${w.name}: VocalReach WARM pass ${vr.W}x${vr.H}x${vr.NL} (ctor ${ctor.toFixed(1)} ms; at most one build start per 0.4 s, only after a >= 1 m move)`);
      out(line('update() while building (one slice)', dist(steps)));
      out(line('whole build (sum of slices)', dist(builds), `updates per build med ${dist(perBuild).med} max ${dist(perBuild).max}; nodes ${vr.stats.nodes}`));
      out(line('update() idle (field current)', dist(idle)));
      expect(vr.ready).toBe(true);
    }
  });

  it('gas field: 10 Hz tick over the gassed storeys (GasSystem frame), and the section-build fast-forward', async () => {
    const [{GasField, GAS}, {WindowBreaches, sourceCells}, {planWindows}, {readTowerInfo}] = await Promise.all([
      import('../src/world/gas/field'), import('../src/world/windowBreach'), import('../src/world/officeWindows'), import('../src/world/towerShared'),
    ]);
    const L = office.layout, info = readTowerInfo(L)!;
    const CELL = m.grid.CELL, ex = info.exterior, shaft = L.office!.elevator.shaft;
    const domain = {x0: Math.floor(ex.x0 / CELL) - 1, y0: Math.floor(ex.z0 / CELL) - 1, x1: Math.ceil(ex.x1 / CELL) + 1, y1: Math.ceil(ex.z1 / CELL) + 1};
    const closed = (cx: number, cy: number) => { const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL; return x > shaft.x0 && x < shaft.x1 && z > shaft.z0 && z < shaft.z1; };
    const W8 = new WindowBreaches(planWindows(info));
    const plans = planWindows(info);
    const storeys = new Set(plans.map(p => p.level));
    const mk = () => new GasField(L.levels.filter(l => storeys.has(l.id)).map(l => ({id: l.id, grid: l.grid})), {domain, closed});
    const refs = [...W8.refs.values()].filter(ref => sourceCells(ref, L.levels[ref.plan.level].grid).length);
    const byLevel = new Map<number, typeof refs>();
    for (const ref of refs) { let a = byLevel.get(ref.plan.level); if (!a) byLevel.set(ref.plan.level, (a = [])); a.push(ref); }
    out(`\n[bench] ${office.name}: gas — ${refs.length} breakable panes on ${byLevel.size} storeys; domain ${domain.x1 - domain.x0}x${domain.y1 - domain.y0} cells`);
    for (const scen of [{label: '1 breach', storeys: 1, per: 1}, {label: '4 breaches on 2 storeys', storeys: 2, per: 2}, {label: '12 breaches on 4 storeys', storeys: 4, per: 3}]) {
      const f = mk();
      const lvls = [...byLevel.keys()].slice(0, scen.storeys);
      let added = 0;
      for (const lv of lvls) for (const ref of byLevel.get(lv)!.slice(0, scen.per)) if (f.addBreach({id: ref.id, level: lv, cells: sourceCells(ref, L.levels[lv].grid)})) added++;
      const frames: number[] = [], ticks: number[] = [];
      for (let k = 0; k < 60 * 90; k++) { // 90 s of play at 60 Hz
        const t = now(); const n = f.tick(1 / 60); const d = now() - t;
        frames.push(d); if (n > 0) ticks.push(d / n);
      }
      const stats = f.storeys.map(s => s.stats());
      out(line(`${scen.label} (${added}): frame with >= 1 tick`, dist(ticks), `active cells ${stats.reduce((a, s) => a + s.activeCells, 0)}, asleep ${stats.filter(s => s.asleep).length}/${stats.length}`));
      out(line(`${scen.label}: every frame (60 Hz)`, dist(frames)));
      // the section-build replay (GasSystem.fastForward: AGE_CAP_S in FAST_FORWARD_STEP_S steps)
      const g = mk();
      for (const lv of lvls) for (const ref of byLevel.get(lv)!.slice(0, scen.per)) g.addBreach({id: ref.id, level: lv, cells: sourceCells(ref, L.levels[lv].grid)});
      const t = now(); g.advance(GAS.AGE_CAP_S); out(`  ${scen.label}: section-build fast-forward of ${GAS.AGE_CAP_S} s: ${(now() - t).toFixed(1)} ms (loading screen, not a play frame)`);
    }
    expect(refs.length).toBeGreaterThan(0);
  });

  it('three.js world: LevelCuller.update (render), ContainerManager update / target, pickups glow, idle physics', async () => {
    if (!WORLD) { out('[bench] LL_BENCH_WORLD=0: world sections skipped'); return; }
    const THREE = await import('three');
    const [{installCanvasShim}, {fakeEnvTextures}, {WorldMaterials}, {buildWorld}, {ContainerManager}, {Inventory}, {PickupManager}, {PhysicsSystem}, {LOOT_TABLE_PROFILES}] = await Promise.all([
      import('./helpers/canvas2d'), import('./helpers/openablesFixture'), import('../src/world/materials'), import('../src/world/builder'),
      import('../src/world/containers'), import('../src/items/inventory'), import('../src/world/pickups'), import('../src/physics/world'),
      import('../src/items/lootTables').then(x => ({LOOT_TABLE_PROFILES: (x as unknown as {LOOT_TABLE_PROFILES?: unknown}).LOOT_TABLE_PROFILES})),
    ]);
    void LOOT_TABLE_PROFILES;
    installCanvasShim(false);
    {
      const ctx = (document as unknown as {createElement(t: string): {getContext(k: string): object}}).createElement('canvas').getContext('2d');
      const proto = Object.getPrototypeOf(ctx) as {clip?: () => void};
      proto.clip ??= () => {};
    }
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    for (const w of [office, subway]) {
      const t0 = now();
      const world = buildWorld(w.layout, mats, {});
      const buildMs = now() - t0;
      const c = world.culler;
      const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
      cam.rotation.order = 'YXZ';
      const r = rng(0xc011);
      const ms: number[] = [], skip: number[] = [], perLevel: Record<number, number[]> = {};
      for (let lv = 0; lv < w.L.count; lv++) {
        for (const p of walkables(w, m, lv, 6, r)) {
          for (let k = 0; k < 12; k++) {
            cam.position.set(p[0], p[2] + 1.6, p[1]);
            cam.rotation.set(0, k * 0.55, 0);
            cam.updateMatrixWorld(true);
            const t = now(); c.update(cam); const d = now() - t;
            ms.push(d); (perLevel[lv] ??= []).push(d);
            const t2 = now(); c.update(cam); skip.push(now() - t2); // unchanged camera: the early-out
          }
        }
      }
      out(`\n[bench] ${w.name}: buildWorld ${buildMs.toFixed(0)} ms; LevelCuller ${c.entries.length} entries, ${c.portalTiles} portal tiles (render(): every frame the camera moved > 0.25 m or turned)`);
      out(line('culler.update (camera moved / turned)', dist(ms)));
      out(line('culler.update (camera still: early-out)', dist(skip)));
      const worst = Object.entries(perLevel).map(([lv, v]) => [Number(lv), dist(v)] as const).sort((a, b) => b[1].p95 - a[1].p95).slice(0, 3);
      out(`  worst storeys by p95: ${worst.map(([lv, d]) => `L${lv} med ${f3(d.med)} p95 ${f3(d.p95)} max ${f3(d.max)}`).join(' · ')}`);

      // containers (no models: the procedural holder bodies; the loot is real)
      const cm = new ContainerManager({}, mats, () => new Inventory());
      const tb = now();
      cm.build(w.layout);
      const cmBuild = now() - tb;
      const P = spawnPose(w);
      const eye = new THREE.Vector3(P.x, P.y + 1.6, P.z), dir = new THREE.Vector3(0, 0, -1);
      const upd: number[] = [], refresh: number[] = [], tgt: number[] = [];
      for (let k = 0; k < 600; k++) {
        dir.set(Math.sin(k * 0.05), -0.1, Math.cos(k * 0.05)).normalize();
        let t = now(); cm.target(eye, dir, w.L); tgt.push(now() - t);
        (cm as unknown as {dirty: boolean}).dirty = false;
        t = now(); cm.update(1 / 60, k / 60); const d = now() - t;
        if ((cm as unknown as {refreshT: number}).refreshT > 0.15 - 1e-6) refresh.push(d); else upd.push(d);
      }
      const holders = (cm as unknown as {all: unknown[]}).all.length;
      out(`  ContainerManager: ${holders} holders (${cm.openList.length} openable); build ${cmBuild.toFixed(0)} ms`);
      out(line('containers.update (no refresh)', dist(upd)));
      out(line('containers.update with refresh() (every 0.15 s)', dist(refresh)));
      out(line('containers.target (crosshair, every frame)', dist(tgt)));
      // run memory (Game.leaveSection: section teardown before a travel / Retry / NewGame — the loading transition, not a play frame)
      {
        const {captureHolders} = await import('../src/run/worldMemory');
        const cap: number[] = [];
        for (let k = 0; k < 20; k++) { const t = now(); captureHolders(cm); cap.push(now() - t); }
        out(line('run memory captureHolders (section teardown only)', dist(cap)));
      }

      // pickups: the per-frame readability glow (Pickups.update)
      try {
        const pm = new PickupManager({});
        for (const p of w.layout.pickups) pm.add({uid: 0, itemId: p.itemId, count: p.count ?? 1} as never, p.x, p.y ?? 0, p.z);
        const pu: number[] = [], pt: number[] = [];
        for (let k = 0; k < 600; k++) {
          let t = now(); pm.update(k / 60); pu.push(now() - t);
          t = now(); pm.target(eye, dir, w.L); pt.push(now() - t);
        }
        out(`  PickupManager: ${pm.list.length} pickups`);
        out(line('pickups.update (glow, every frame)', dist(pu)));
        out(line('pickups.target (every frame)', dist(pt)));
      } catch (err) { out(`  PickupManager skipped: ${String((err as Error).message ?? err).slice(0, 160)}`); }

      // physics idle path (nothing awake): PhysicsSystem.update every frame
      try {
        const ph = new PhysicsSystem(null);
        ph.build(w.layout);
        const walker = {id: {}, x: P.x, y: P.y, z: P.z, r: 0.35, wake: true}; // id: an object (Game passes the Player)
        (ph.dynamicItems as unknown as {walkers?: () => unknown[]}).walkers = () => [walker];
        const pu: number[] = [];
        for (let k = 0; k < 600; k++) { walker.x = P.x + Math.sin(k / 60) * 2; walker.z = P.z + Math.cos(k / 60) * 2; const t = now(); ph.update(1 / 60); pu.push(now() - t); }
        out(line('physics.update idle (player walking, nothing awake)', dist(pu)));
      } catch (err) { out(`  physics skipped: ${String((err as Error).stack ?? err).split('\n').slice(0, 4).join(' / ').slice(0, 400)}`); }
      world.group.removeFromParent?.();
    }
  }, 600_000);
});
