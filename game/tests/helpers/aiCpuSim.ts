// Task studio-performance-recorder-20261103-043629-01 (lane AI-CPU): Game.updateZombies on a REAL generated level with the REAL
// enemy actors (stripped GLBs: wardrobe zombies incl. the lingerie store's variants, Sirens dormant, Blightbellies, rat/dogs,
// Strainers), the horde director, the path service on a real-time FrameBudget, the chase share, the vocal-reach field and the
// flashlight light lure — wired exactly as game.ts (brainWorld, spawnEnemy, updateZombies, alertZombies) minus rendering / audio
// (a no-op Sfx). The player walks / turns along a scripted route; per frame it records where the AI time went:
//   vocal-reach, horde director, brain (sight, state machine: excl. path), path searches (immediate: count, ms, A* expansions,
//   string-pulling probes + their ms), motor (+ body separation / settle), anim (cues, mixer update, hit-volume refresh), and the
//   frame-budget background chunks (far deferred re-plans, the vocal field build) run after it.
// Also a behaviour trace (`digest()`): every brain's state / position / yaw / path + the shared RNG draw count, frame by frame.
// The instrumentation only observes (wrapped calls return exactly what the wrapped ones return; the same calls in the same order).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {loadStripped} from './openablesFixture';
import {mulberry32} from '../../src/core/rng';
import {Levels} from '../../src/gen/levels';
import {CELL, PathFinder, type PathOpts, type Waypoint} from '../../src/gen/grid';
import {PropIndex} from '../../src/core/physics';
import {alertListeners, type BrainOutput, type BrainWorld, type ZombieBrain} from '../../src/ai/brain';
import {moveZombie, sameLevel, settleZombie} from '../../src/ai/motor';
import {PathService, nearPlayerRule, PATH_DEFER} from '../../src/ai/pathService';
import {FrameBudget} from '../../src/core/frameBudget';
import {VocalReach} from '../../src/ai/vocalReach';
import {lureWorld} from '../../src/ai/lightLure';
import {HordeDirector} from '../../src/ai/horde';
import {ChaseShare, atriumNearRule, atriumPathOptions, searchExpand} from '../../src/ai/chaseShare';
import {spawnProfile} from '../../src/ai/spawnTables';
import {MODEL_FILES} from '../../src/assets/manifest';
import {ENEMY_MODEL_FILES, withEnemyModels} from '../../src/ai/enemyModels';
import {ZombieLookLibrary} from '../../src/ai/outfits';
import {LINGERIE_MODEL_FILES, createLingerieLibrary} from '../../src/ai/lingerie';
import {chooseSpawnLook} from '../../src/ai/spawnLook';
import {ZombieActor} from '../../src/ai/zombieActor';
import {archetypeOf, createEnemyActor, enemyCues, type EnemyActor} from '../../src/ai/creatureArchetypes';
import {STAND_EYE} from '../../src/player/player';
import type {StationLayout, ZombieSpawn} from '../../src/gen/stationTypes';
import type {LightSource} from '../../src/world/lightSources';
import type {Sfx} from '../../src/audio/sfx';
import type {WardrobeLibrary} from '../../src/ai/wardrobe';

const now = () => performance.now();

/** Every enemy model a level may need (stripped: no texture decoding in Node), keyed like Game.assets.models / propModels. */
export async function loadEnemyModels(): Promise<Record<string, GLTF>> {
  const out: Record<string, GLTF> = {};
  const keys = Object.keys(MODEL_FILES).filter(k => k.startsWith('zombieBody_') || k.startsWith('outfit_') || k === 'creature_ratdog' || k === 'zombie');
  for (const k of keys) out[k] = await loadStripped((MODEL_FILES as Record<string, {url: string}>)[k].url);
  for (const [k, f] of Object.entries(ENEMY_MODEL_FILES)) out[k] = await loadStripped(f.url);
  for (const [k, f] of Object.entries(LINGERIE_MODEL_FILES)) out[k] = await loadStripped(f.url);
  return out;
}

/** A no-op Sfx (every method returns 0 / undefined): the cues still run their timers and RNG draws exactly. */
export const SILENT_SFX = new Proxy({}, {get: () => () => 0}) as unknown as Sfx;

/** Per-frame cost record (ms unless noted). */
export interface FrameCost {
  frame: number;
  ai: number; vocal: number; horde: number; brain: number; path: number; motor: number; anim: number;
  /** anim split: mixer (animate), hit-volume refresh (updateVolumes incl. the actor's matrixWorld), cues. */
  mixer: number; volumes: number; cues: number;
  /** Immediate path searches: count, A* expansions, string-pulling probes, ms inside the probes. */
  searches: number; expanded: number; probes: number; pullMs: number;
  /** Requests that returned queued / shared / held (no synchronous search). */
  queued: number; shared: number;
  /** Sight / light rays and walk tests (brain world). */
  los: number; walk: number;
  /** Background chunks after the AI (FrameBudget.run). */
  deferred: number;
  /** Enemies newly in a hunting state this frame (alert bursts). */
  alerted: number;
  animated: number;
}

export interface SimRoutePoint { x: number; z: number; y: number }
export interface AiCpuSimOpts {
  /** Real actors (animation / hit volumes) — false: brains only (cheaper; the AI decisions are identical). */
  actors?: Record<string, GLTF> | null;
  /** The player's route (feet points; walked at `speed` m/s, looped) and yaw sweep (rad/s of camera turning; 0 = look ahead). */
  route?: readonly SimRoutePoint[];
  speed?: number;
  turnRate?: number;
  /** Flashlight on (player/flashlight.ts BEAM: 20 m attract range, 0.58 rad half cone), aimed along the camera yaw, pitch -0.12. */
  flashlight?: boolean;
  /** Gunshots (s) at the player: Game.alertZombies with this noise radius (pistol 24). */
  shots?: readonly number[];
  noise?: number;
  /** RNG seed of the game's shared stream (Game.rand = mulberry32(layout.seed ^ 0x5bd1e995)). */
  seed?: number;
  /** Frame dt (s); default 1/60. */
  dt?: number;
}

export function aiCpuSim(layout: StationLayout, o: AiCpuSimOpts = {}) {
  // a private Levels (levelsOf caches one per layout: the instrumentation below must not leak into other users of the layout)
  const L: Levels = layout.levels?.length ? new Levels(layout.levels, layout.levelLinks ?? [], layout.rails) : new Levels([{id: 0, role: 'main', grid: layout.grid, baseY: 0}], layout.levelLinks ?? [], layout.rails);
  const props = new PropIndex(L, layout.props);
  const pf = new PathFinder(L), farFinder = pf.fork();
  const dt = o.dt ?? 1 / 60;
  const route = o.route?.length ? o.route : [{x: layout.playerSpawn.x, z: layout.playerSpawn.z, y: L.grid(0).floorAt(layout.playerSpawn.x, layout.playerSpawn.z)}];
  const player = {x: route[0].x, y: route[0].y, z: route[0].z, eye: route[0].y + STAND_EYE, yaw: layout.playerSpawn.yaw, alive: true, radius: 0.3};
  // the game's shared stream, counted (Game.rand)
  const baseRand = mulberry32((o.seed ?? (layout.seed ^ 0x5bd1e995)) >>> 0);
  let draws = 0;
  const rand = () => { draws++; return baseRand(); };
  // --- instrumentation (observe only) ---
  let inFind = false, probes = 0, pullMs = 0, losN = 0, walkN = 0;
  const walkLine = L.walkLineClear.bind(L);
  (L as {walkLineClear: Levels['walkLineClear']}).walkLineClear = (ax, ay, az, bx, bz, r, by) => {
    if (!inFind) return walkLine(ax, ay, az, bx, bz, r, by);
    probes++;
    const t = now();
    const res = walkLine(ax, ay, az, bx, bz, r, by);
    pullMs += now() - t;
    return res;
  };
  let searches = 0, expanded = 0;
  /** Every immediate search: frame, requester class (its brain's state, or horde leg / regroup), args, cost, result size. */
  const requests: {frame: number; cls: string; args: [number, number, number, number, PathOpts]; ms: number; expanded: number; probes: number; pullMs: number; wps: number}[] = [];
  let reqCls = 'other';
  let reqActor: EnemyActor | null = null;
  const timedFind = (ax: number, az: number, bx: number, bz: number, op: PathOpts) => {
    inFind = true;
    const p0 = probes, m0 = pullMs, t0 = now();
    const r = pf.find(ax, az, bx, bz, 0.34, searchExpand(op), op);
    const ms = now() - t0;
    inFind = false;
    searches++;
    expanded += pf.lastExpanded;
    requests.push({frame, cls: reqActor ? `${archetypeOf(reqActor)}:${reqActor.brain.state}${(op as {local?: boolean}).local ? ':local' : ''}${(op as {seen?: boolean}).seen ? ':seen' : ''}` : reqCls, args: [ax, az, bx, bz, {...op}], ms, expanded: pf.lastExpanded, probes: probes - p0, pullMs: pullMs - m0, wps: r ? r.length : -1});
    return r;
  };
  // --- the game's wiring (Game.buildSection) ---
  const fb = new FrameBudget();
  const reach = new VocalReach(L);
  reach.attachScheduler(fb);
  const nearPlayer = (x: number, z: number, y: number | undefined) => {
    const fy = y ?? player.y;
    return nearPlayerRule(Math.hypot(x - player.x, z - player.z, fy - player.y), () => (reach.ready ? reach.pathTo(x, fy + 1.2, z) : null));
  };
  const atriumLevel = !!(layout.mall || layout.reactor);
  const atrium = atriumLevel ? atriumPathOptions((x, z, y) => Math.hypot(x - player.x, z - player.z, (y ?? player.y) - player.y) < PATH_DEFER.nearM,
    (x, z, y) => { const fy = y ?? player.y; return atriumNearRule(Math.hypot(x - player.x, z - player.z, fy - player.y), fy - player.y, () => (reach.ready ? reach.pathTo(x, fy + 1.2, z) : null)); }) : undefined;
  const ps = new PathService(timedFind, (ax, az, bx, bz, op, chunk) => farFinder.search(ax, az, bx, bz, 0.34, searchExpand(op), op, chunk), fb, nearPlayer, atrium);
  const share = atriumLevel ? new ChaseShare(L) : null;
  // --- enemies (Game.spawnEnemy) ---
  const models = o.actors ?? null;
  const zombies: EnemyActor[] = [];
  const brains: ZombieBrain[] = [];
  let looks: ZombieLookLibrary | null = null, lingerie: WardrobeLibrary | null = null;
  if (models) {
    looks = new ZombieLookLibrary(models);
    const lz = Object.keys(LINGERIE_MODEL_FILES).filter(k => models[k]);
    lingerie = lz.length ? createLingerieLibrary(models) : null;
  }
  const seed = layout.seed >>> 0;
  layout.zombies.forEach((s: ZombieSpawn, i) => {
    if (models) {
      const {actor} = createEnemyActor(s, withEnemyModels(models, k => models[k]), rand, () => {
        const pick = chooseSpawnLook(seed, i, s, looks!, s.look === 'lingerie' ? lingerie : null);
        const src = (pick.library === 'lingerie' ? lingerie! : looks!).build(pick.look);
        return new ZombieActor(src, s, rand);
      });
      actor.brain.y = actor.root.position.y = s.y ?? L.grid(s.level ?? 0).floorAt(s.x, s.z);
      zombies.push(actor);
      brains.push(actor.brain);
    } else {
      // brains only: the archetype's brain exactly as its actor constructs it (no rand draws there for brains)
      throw new Error('aiCpuSim: brains-only mode is not supported (the actors construct the brains); pass actors');
    }
  });
  const director = layout.hordes?.length ? new HordeDirector(layout, L, i => brains[i], spawnProfile('mall').horde?.patrol) : null;
  // --- lights (the flashlight: world/lightSources.ts contract, player/flashlight.ts beam) ---
  const beam: LightSource = {id: 1, kind: 'flashlight', active: !!o.flashlight, x: 0, y: 0, z: 0, dir: {x: 0, y: 0, z: -1}, cosHalfAngle: Math.cos(0.58), spot: null, attractRange: 20, intensity: 1};
  const lights = {attracting: () => (beam.active ? [beam] : [])};
  const aimBeam = () => {
    if (!beam.active) return;
    const pitch = -0.12, c = Math.cos(pitch), d = {x: -Math.sin(player.yaw) * c, y: Math.sin(pitch), z: -Math.cos(player.yaw) * c};
    beam.x = player.x; beam.y = player.eye; beam.z = player.z; beam.dir = d;
    const h = L.raycast({x: beam.x, y: beam.y, z: beam.z}, d, 30);
    const t = h.kind === 'none' ? 30 : h.t;
    beam.spot = {x: beam.x + d.x * t, y: beam.y + d.y * t, z: beam.z + d.z * t};
  };
  // --- Game.brainWorld (per frame) ---
  const g = layout.grid, multi = L.count > 1;
  const world = (): BrainWorld => ({
    px: player.x, pz: player.z, playerAlive: player.alive,
    los: (ax, az, bx, bz, ay, by) => { losN++; return multi && ay !== undefined && by !== undefined ? L.lineOfSight({x: ax, y: ay + 1.5, z: az}, {x: bx, y: by + 1.5, z: bz}) : g.lineOfSight(ax, az, bx, bz); },
    walkClear: (ax, az, bx, bz, r, ay, by) => { walkN++; return multi && ay !== undefined ? L.walkLineClear(ax, ay, az, bx, bz, r, by) : g.walkLineClearH(ax, az, bx, bz, r); },
    findPath: (ax, az, bx, bz, opts) => {
      const shared = share ? share.lookup(ax, az, bx, bz, opts) : undefined;
      const s0 = searches;
      const path = shared !== undefined ? shared : ps.request(ax, az, bx, bz, opts);
      if (share && shared === undefined) share.remember(ax, az, bx, bz, opts, path);
      if (shared !== undefined) cost.shared++;
      else if (path === undefined || searches === s0) { if (path === undefined) cost.queued++; }
      return path;
    },
    py: player.y,
    ladder: id => layout.traversal.ladders[id],
    randomNear: (x, z, r, y) => {
      const lv = multi && y !== undefined ? L.levelAt(x, z, y + 0.05) : 0;
      const G = lv > 0 ? L.grid(lv) : g;
      for (let i = 0; i < 14; i++) {
        const tx = x + (rand() * 2 - 1) * r, tz = z + (rand() * 2 - 1) * r;
        const [cx, cy] = G.cellOf(tx, tz);
        if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) {
          const c = G.center(cx, cy);
          return multi ? [c[0], c[1], G.cellFloor(cx, cy)] : c;
        }
      }
      return null;
    },
    rand,
    ...(() => { const lw = lureWorld(L, lights); return {...lw, seePoint: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => { losN++; return lw.seePoint(ax, ay, az, bx, by, bz); }}; })(),
    ...(atriumLevel ? {atrium: true, atriumNotice: true} : {}),
  });
  // --- the player's walk / camera ---
  let leg = 0, t = 0, look = player.yaw;
  const walkPlayer = () => {
    if (route.length >= 2) {
      const tgt = route[(leg + 1) % route.length];
      const dx = tgt.x - player.x, dz = tgt.z - player.z, d = Math.hypot(dx, dz), s = (o.speed ?? 3) * dt;
      if (d > 1e-6) look = Math.atan2(-dx, -dz); // forward = (-sin yaw, -cos yaw)
      if (d <= s) { player.x = tgt.x; player.z = tgt.z; player.y = tgt.y; leg = (leg + 1) % route.length; }
      else { const f = s / d; player.x += dx * f; player.z += dz * f; player.y += (tgt.y - player.y) * f; }
    }
    player.eye = player.y + STAND_EYE;
    player.yaw = (o.turnRate ?? 0) ? look + Math.sin(t * (o.turnRate ?? 0) / Math.PI) * Math.PI : look;
  };
  const shots = [...(o.shots ?? [])].sort((a, b) => a - b);
  let shotK = 0;
  const bases = L.list.map(l => l.baseY);
  const HUNT = new Set(['chase', 'attack']);
  const costs: FrameCost[] = [];
  let cost: FrameCost = null as never;
  let frame = 0, raf = 0;
  const sim = {
    L, pf, ps, fb, reach, share, director, zombies, brains, player, costs, beam, requests,
    get draws() { return draws; },
    get frame() { return frame; },
    /** One play frame: the player, gunfire, then Game.updateZombies, then the frame-budget background chunks. */
    step(): FrameCost {
      frame++; t += dt;
      raf += dt * 1000;
      cost = {frame, ai: 0, vocal: 0, horde: 0, brain: 0, path: 0, motor: 0, anim: 0, mixer: 0, volumes: 0, cues: 0, searches: 0, expanded: 0, probes: 0, pullMs: 0,
        queued: 0, shared: 0, los: 0, walk: 0, deferred: 0, alerted: 0, animated: 0};
      walkPlayer();
      aimBeam();
      const huntBefore = brains.map(b => HUNT.has(b.state));
      while (shotK < shots.length && shots[shotK] <= t) {
        shotK++;
        alertListeners(brains, player, o.noise ?? 24, b => L.lineOfSight({x: player.x, y: player.eye, z: player.z}, {x: b.x, y: b.y + 1.5, z: b.z}), bases, atriumLevel);
      }
      fb.hold(null);
      fb.beginFrame(raf);
      const s0 = searches, e0 = expanded, p0 = probes, m0 = pullMs, l0 = losN, w0 = walkN;
      const a0 = now();
      // ---- Game.updateZombies ----
      ps.tick();
      const w = world();
      let c0 = now();
      reach.update(dt, player.x, player.y, player.z);
      let c1 = now(); cost.vocal = c1 - c0;
      const H = director;
      share?.tick(dt);
      reqCls = 'horde'; reqActor = null;
      H?.update(dt, w, player);
      c0 = now(); cost.horde = c0 - c1;
      for (const z of zombies) {
        const b = z.brain;
        reqActor = z;
        const seqBefore = b.attackSeq;
        const sb = searches, pb = pullMs;
        let c2 = now();
        const out: BrainOutput = b.update(dt, w);
        let c3 = now();
        // (path time inside the brain: the immediate searches' share is measured by the wrapped find below)
        cost.brain += c3 - c2;
        void sb; void pb;
        reqActor = null;
        if (H && out.alerted) H.alerted(b, player.y);
        c2 = now();
        if (out.face !== null) {
          let d = out.face - b.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * dt;
          b.yaw += Math.max(-turn, Math.min(turn, d));
        }
        const moved = moveZombie(b, out, dt, L, props);
        if (b.alive && !b.climbing) {
          for (const q of zombies) {
            if (q === z || !q.brain.alive || !sameLevel(b.y, q.brain.y)) continue;
            const dx = b.x - q.brain.x, dz = b.z - q.brain.z, d = Math.hypot(dx, dz), min = b.stats.radius + q.brain.stats.radius;
            if (d > 1e-4 && d < min) { const push = (min - d) * 0.5; b.x += dx / d * push; b.z += dz / d * push; }
          }
          const dx = b.x - player.x, dz = b.z - player.z, d = Math.hypot(dx, dz), min = b.stats.radius + player.radius + 0.22;
          if (d > 1e-4 && d < min && sameLevel(b.y, player.y)) { b.x += dx / d * (min - d); b.z += dz / d * (min - d); }
          settleZombie(b, L, props);
        }
        c3 = now(); cost.motor += c3 - c2;
        // Game.panOf distance (plan)
        const dist = Math.hypot(b.x - player.x, b.z - player.z);
        const cues = enemyCues(z);
        if (out.alerted) cues.alert(SILENT_SFX, z);
        if (b.attackSeq !== seqBefore) cues.attack(SILENT_SFX, z);
        H?.vocalGate(b, z, dt, rand);
        cues.tick(SILENT_SFX, z, dt, moved, dist, rand);
        const c4 = now(); cost.cues += c4 - c3;
        const adt = H ? H.animStep(b, dt, dist) : dt;
        if (adt > 0) { z.animate(adt, out.anim, moved); cost.animated++; }
        z.syncTransform();
        if (!z.ragdolled) z.root.position.y = b.y;
        const c5 = now(); cost.mixer += c5 - c4;
        void archetypeOf; // (the Strainer's wet trail is visual only, Math.random: not simulated)
        if (adt > 0) z.updateVolumes();
        cost.volumes += now() - c5;
      }
      cost.ai = now() - a0;
      cost.searches = searches - s0; cost.expanded = expanded - e0; cost.probes = probes - p0; cost.pullMs = pullMs - m0;
      cost.los = losN - l0; cost.walk = walkN - w0;
      cost.anim = cost.cues + cost.mixer + cost.volumes;
      // the brain span includes its synchronous path searches (game.ts: ai.path nested in ai.brain)
      cost.path = cost.searches ? pathMsSince(s0) : 0;
      cost.alerted = brains.reduce((n, b, i) => n + (!huntBefore[i] && HUNT.has(b.state) ? 1 : 0), 0);
      const d0 = now();
      fb.run();
      cost.deferred = now() - d0;
      costs.push(cost);
      return cost;
    },
    run(seconds: number) { for (let i = 0, n = Math.round(seconds / dt); i < n; i++) sim.step(); return sim; },
    /** Behaviour fingerprint of this frame (state, position, yaw, path head, RNG draws): equal fingerprints = equal behaviour. */
    digest(): string {
      return `${draws}|` + brains.map(b => `${b.state}:${b.x.toFixed(9)},${b.y.toFixed(9)},${b.z.toFixed(9)},${b.yaw.toFixed(9)}`).join(';');
    },
  };
  // per-search ms (the wrapped find is timed by the PathService call site: measure it here)
  const searchMs: number[] = [];
  const pathMsSince = (s0: number) => { let m = 0; for (let k = s0; k < searchMs.length; k++) m += searchMs[k]; return m; };
  const innerFind = timedFind;
  const wrapped = (ax: number, az: number, bx: number, bz: number, op: PathOpts) => { const t0 = now(); const r = innerFind(ax, az, bx, bz, op); searchMs.push(now() - t0); return r; };
  (ps as unknown as {find: typeof timedFind}).find = wrapped;
  return sim;
}

/** Distribution summary of one cost field over frames. */
export function dist(v: readonly number[]) {
  const s = [...v].sort((a, b) => a - b), q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : 0);
  return {avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0, p95: q(0.95), p99: q(0.99), max: s.length ? s[s.length - 1] : 0};
}

/** The scripted player route: feet points along PathFinder routes between `stops` (world x, z, feet y). */
export function routeThrough(L: Levels, stops: readonly SimRoutePoint[]): SimRoutePoint[] {
  const pf = new PathFinder(L), out: SimRoutePoint[] = [stops[0]];
  for (let k = 1; k < stops.length; k++) {
    const a = out[out.length - 1], b = stops[k];
    const p = pf.find(a.x, a.z, b.x, b.z, 0.3, 60000, {ay: a.y, by: b.y, noLinks: true});
    if (!p) continue;
    for (const w of p as Waypoint[]) out.push({x: w[0], z: w[1], y: w[3] ?? a.y});
  }
  return out;
}

void THREE;
