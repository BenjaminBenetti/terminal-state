// Task track3-eaton-centre-20261031 (lane HORDE, atrium AI): Game.updateZombies minus rendering / audio on a REAL generated layout,
// wired like game.ts (brainWorld, the vocal-reach route field for the NEAR rule, the path service on a FrameBudget, the horde
// director) so the atrium chase work can be measured / tested in Node. `atrium` turns the mall-only chase rules on exactly as the
// game does for a layout with `mall` (BrainWorld.atrium, PathService atrium options, the level-wide chase route share).
// Records every path request (who / class / ms / expansions) per frame, and the frame's AI ms.

import {mulberry32} from '../../src/core/rng';
import {levelsOf, type Levels} from '../../src/gen/levels';
import {CELL, PathFinder, type PathOpts, type Waypoint} from '../../src/gen/grid';
import {PropIndex} from '../../src/core/physics';
import {ZombieBrain, type BrainWorld} from '../../src/ai/brain';
import {CreatureBrain} from '../../src/ai/creatureActor';
import {moveZombie, sameLevel, settleZombie} from '../../src/ai/motor';
import {PathService, nearPlayerRule, PATH_DEFER} from '../../src/ai/pathService';
import {FrameBudget} from '../../src/core/frameBudget';
import {VocalReach} from '../../src/ai/vocalReach';
import {lureWorld} from '../../src/ai/lightLure';
import {HordeDirector} from '../../src/ai/horde';
import {ChaseShare, atriumNearRule, atriumPathOptions, searchExpand} from '../../src/ai/chaseShare';
import {MALL_HORDE_RULES} from '../../src/ai/hordeSpec';
import {S, UpdateProfiler} from '../../src/debug/updateProfile';
import type {StationLayout} from '../../src/gen/stationTypes';

export interface SimPlayer { x: number; y: number; z: number; alive: boolean }
export interface PathRec { frame: number; ms: number; expanded: number; cls: 'chase-seen' | 'chase-unseen' | 'plain' | 'horde'; result: 'path' | 'null' | 'queued' | 'shared'; req: [number, number, number, number, PathOpts | undefined] }

export function mallAiSim(layout: StationLayout, o: {atrium: boolean; player: SimPlayer; hordes?: boolean; prof?: UpdateProfiler}) {
  const L: Levels = levelsOf(layout);
  const props = new PropIndex(L, layout.props);
  const pf = new PathFinder(L), fork = pf.fork();
  const player = o.player;
  const clock = {t: 0};
  // the game's budget clock: real time (a frozen clock would make every background chunk look free)
  const fb = new FrameBudget();
  const reach = new VocalReach(L);
  reach.attachScheduler(fb);
  // Game.nearPlayer
  const near = (x: number, z: number, y: number | undefined) => {
    const fy = y ?? player.y;
    return nearPlayerRule(Math.hypot(x - player.x, z - player.z, fy - player.y), () => (reach.ready ? reach.pathTo(x, fy + 1.2, z) : null));
  };
  let lastExp = 0;
  const find = (ax: number, az: number, bx: number, bz: number, op: PathOpts) => { const r = pf.find(ax, az, bx, bz, 0.34, searchExpand(op), op); lastExp = pf.lastExpanded; return r; };
  const ps = new PathService(find, (ax, az, bx, bz, op, chunk) => fork.search(ax, az, bx, bz, 0.34, searchExpand(op), op, chunk), fb, near,
    o.atrium ? atriumPathOptions((x, z, y) => Math.hypot(x - player.x, z - player.z, (y ?? player.y) - player.y) < PATH_DEFER.nearM,
      (x, z, y) => { const fy = y ?? player.y; return atriumNearRule(Math.hypot(x - player.x, z - player.z, fy - player.y), fy - player.y, () => (reach.ready ? reach.pathTo(x, fy + 1.2, z) : null)); }) : undefined);
  const share = o.atrium ? new ChaseShare(L) : null;
  const brains: ZombieBrain[] = layout.zombies.map(s => {
    const b = s.archetype === 'ratdog' ? new CreatureBrain(s.x, s.z, s.yaw) : new ZombieBrain(s.type, s.x, s.z, s.yaw);
    b.y = s.y ?? 0;
    return b;
  });
  const director = new HordeDirector(layout, L, i => (o.hordes === false ? undefined : brains[i]), MALL_HORDE_RULES.patrol, layout.mall?.patrol ?? []);
  const rand = mulberry32(99);
  const prof = o.prof ?? null;
  const recs: PathRec[] = [];
  let frame = 0, raf = 0;
  const world = (): BrainWorld => ({
    px: player.x, pz: player.z, py: player.y, playerAlive: player.alive,
    los: (ax, az, bx, bz, ay, by) => L.lineOfSight({x: ax, y: (ay ?? 0) + 1.5, z: az}, {x: bx, y: (by ?? 0) + 1.5, z: bz}),
    walkClear: (ax, az, bx, bz, r, ay, by) => L.walkLineClear(ax, ay ?? 0, az, bx, bz, r, by),
    findPath: (ax, az, bx, bz, op) => {
      prof?.begin(S.path);
      const t = performance.now();
      lastExp = 0;
      const shared = share ? share.lookup(ax, az, bx, bz, op) : undefined;
      const r: Waypoint[] | null | undefined = shared !== undefined ? shared : ps.request(ax, az, bx, bz, op ?? {});
      if (share && shared === undefined) share.remember(ax, az, bx, bz, op, r);
      const ms = performance.now() - t;
      prof?.end(S.path);
      const owner = op?.defer;
      const cls: PathRec['cls'] = owner && !(owner instanceof ZombieBrain) ? 'horde' : op?.drops ? ((op as {seen?: boolean}).seen || !owner ? 'chase-seen' : 'chase-unseen') : 'plain';
      recs.push({frame, ms, expanded: lastExp, cls, result: shared !== undefined ? 'shared' : r === undefined ? 'queued' : r === null ? 'null' : 'path', req: [ax, az, bx, bz, op]});
      return r;
    },
    randomNear: (x, z, r, y) => {
      const lv = y !== undefined ? L.levelAt(x, z, y + 0.05) : 0;
      const G = L.grid(lv);
      for (let i = 0; i < 14; i++) {
        const tx = x + (rand() * 2 - 1) * r, tz = z + (rand() * 2 - 1) * r;
        const [cx, cy] = G.cellOf(tx, tz);
        if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) { const c = G.center(cx, cy); return [c[0], c[1], G.cellFloor(cx, cy)]; }
      }
      return null;
    },
    rand,
    ...(o.atrium ? {atrium: true} : {}),
    ...lureWorld(L, {attracting: () => []}),
  });
  const frameMs: number[] = [], deferredMs: number[] = [];
  const sim = {
    L, pf, ps, fb, reach, brains, director, share, player, recs, frameMs, deferredMs,
    get frame() { return frame; },
    step(): number {
      frame++;
      raf += 1000 / 60;
      clock.t = Math.max(clock.t, raf);
      fb.hold(null);
      fb.beginFrame(raf);
      if (prof) { prof.frameBegin(); prof.lap(S.input); prof.lap(S.ai); }
      const t0 = performance.now();
      ps.tick();
      share?.tick(1 / 60);
      const w = world();
      prof?.begin(S.vocal);
      reach.update(1 / 60, player.x, player.y, player.z);
      prof?.end(S.vocal);
      director.update(1 / 60, w, player);
      for (const b of brains) {
        prof?.begin(S.brain);
        const out = b.update(1 / 60, w);
        prof?.end(S.brain);
        if (out.alerted) director.alerted(b);
        prof?.begin(S.motor);
        if (out.face !== null) {
          let d = out.face - b.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) / 60;
          b.yaw += Math.max(-turn, Math.min(turn, d));
        }
        moveZombie(b, out, 1 / 60, L, props);
        if (b.alive && !b.climbing) {
          for (const q of brains) {
            if (q === b || !q.alive || !sameLevel(b.y, q.y)) continue;
            const dx = b.x - q.x, dz = b.z - q.z, dd = Math.hypot(dx, dz), min = b.stats.radius + q.stats.radius;
            if (dd > 1e-4 && dd < min) { const push = (min - dd) * 0.5; b.x += dx / dd * push; b.z += dz / dd * push; }
          }
          settleZombie(b, L, props);
        }
        prof?.end(S.motor);
      }
      const ms = performance.now() - t0;
      prof?.lap(S.deferred);
      const t1 = performance.now();
      fb.run();
      deferredMs.push(performance.now() - t1);
      prof?.frameEnd();
      frameMs.push(ms);
      return ms;
    },
    run(seconds: number) { for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(); },
  };
  return sim;
}

/** Per-frame summary of a run: AI ms distribution, immediate searches per frame, worst frames with their composition. */
export function summarize(sim: ReturnType<typeof mallAiSim>, from = 0) {
  const fm = sim.frameMs.slice(from);
  const sorted = [...fm].sort((a, b) => a - b), q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const recs = sim.recs.filter(r => r.frame > from);
  const searched = recs.filter(r => r.result === 'path' || r.result === 'null');
  const perFrame = new Map<number, {n: number; ms: number}>();
  for (const r of searched) { const e = perFrame.get(r.frame) ?? {n: 0, ms: 0}; e.n++; e.ms += r.ms; perFrame.set(r.frame, e); }
  const byCls: Record<string, {n: number; ms: number; max: number; queued: number; shared: number}> = {};
  for (const r of recs) {
    const c = (byCls[r.cls] ??= {n: 0, ms: 0, max: 0, queued: 0, shared: 0});
    if (r.result === 'queued') c.queued++; else if (r.result === 'shared') c.shared++; else { c.n++; c.ms += r.ms; if (r.ms > c.max) c.max = r.ms; }
  }
  const nPer = [...perFrame.values()].map(e => e.n);
  const expPer = new Map<number, number>();
  for (const r of searched) expPer.set(r.frame, (expPer.get(r.frame) ?? 0) + r.expanded);
  const exps = searched.map(r => r.expanded).sort((a, b) => a - b);
  const top = fm.map((ms, i) => ({i: i + from + 1, ms})).sort((a, b) => b.ms - a.ms).slice(0, 4).map(t => {
    const rs = recs.filter(r => r.frame === t.i && (r.result === 'path' || r.result === 'null'));
    const by: Record<string, number> = {};
    for (const r of rs) by[r.cls] = (by[r.cls] ?? 0) + 1;
    return `#${t.i} ${t.ms.toFixed(1)} ms (${rs.length} searches ${rs.reduce((s, r) => s + r.ms, 0).toFixed(1)} ms ${rs.reduce((s, r) => s + r.expanded, 0)} exp ${JSON.stringify(by)})`;
  });
  return {frames: fm.length, med: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), searchesMaxPerFrame: nPer.length ? Math.max(...nPer) : 0,
    searchMsMaxPerFrame: Math.max(0, ...[...perFrame.values()].map(e => e.ms)), byCls, top, frames10ms: fm.filter(x => x > 10).length,
    /** Synchronous search expansions: the most in one frame, per search p99 / max, and the total. */
    expMaxPerFrame: Math.max(0, ...expPer.values()), expP99: exps.length ? exps[Math.floor(0.99 * (exps.length - 1))] : 0, expMax: exps.length ? exps[exps.length - 1] : 0,
    expTotal: exps.reduce((a, b) => a + b, 0), searches: searched.length,
    /** The frame-budget background chunks run after the AI (real-time budget): max / p99 ms per frame, and AI + background max. */
    deferredMax: Math.max(0, ...sim.deferredMs.slice(from)), deferredP99: [...sim.deferredMs.slice(from)].sort((a, b) => a - b)[Math.floor(0.99 * Math.max(0, sim.deferredMs.length - from - 1))] ?? 0,
    totalMax: Math.max(0, ...fm.map((m, i) => m + (sim.deferredMs[from + i] ?? 0)))};
}
