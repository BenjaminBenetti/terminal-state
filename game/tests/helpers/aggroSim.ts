// Task studio-beta-mall-round3-20261031-01 (lane ENEMY, R2 cross-atrium aggro): a deterministic Node scenario of the mall start —
// Game.updateZombies' perception / alert wiring (minus rendering / audio) on a REAL generated layout: every spawn with its runtime
// brain (zombie / Siren dormant / Blightbelly / rat-dog), the horde director, the game's gunfire alert (Game.alertZombies through
// ai/brain.ts alertListeners) and its horde calls. The player stands at the start (station storey) and fires a fixed volley, each
// shot killing the nearest station enemy in sight. Records, per enemy, the FIRST moment it started hunting (chase / attack) and why:
// 'sight' (its own sight test), 'gunfire' (the shot's hearing), 'call' (a horde mate's call), 'damage' (hit), 'other'.
// Deterministic: fixed clock, immediate path searches (no frame-budget deferral), seeded rand.

import {mulberry32} from '../../src/core/rng';
import {levelsOf, type Levels} from '../../src/gen/levels';
import {CELL, PathFinder, type Waypoint} from '../../src/gen/grid';
import {PropIndex} from '../../src/core/physics';
import {ZombieBrain, alertListeners, type BrainWorld} from '../../src/ai/brain';
import {CreatureBrain} from '../../src/ai/creatureActor';
import {SirenBrain} from '../../src/ai/siren';
import {BlightbellyBrain} from '../../src/ai/blightbelly';
import {moveZombie, sameLevel, settleZombie} from '../../src/ai/motor';
import {PathService, nearPlayerRule} from '../../src/ai/pathService';
import {lureWorld} from '../../src/ai/lightLure';
import {HordeDirector} from '../../src/ai/horde';
import {ChaseShare, atriumNearRule, atriumPathOptions, searchExpand} from '../../src/ai/chaseShare';
import {MALL_HORDE_RULES} from '../../src/ai/hordeSpec';
import {STAND_EYE} from '../../src/player/player';
import type {StationLayout} from '../../src/gen/stationTypes';
import type {LightSource} from '../../src/world/lightSources';

export type AlertCause = 'sight' | 'gunfire' | 'call' | 'damage' | 'other';
export interface Responder { index: number; level: number; archetype: string; horde: boolean; cause: AlertCause; t: number; dist: number }
export interface AggroOpts {
  /** Gunfire noise radius (weapons.ts: pistol 24, rifle 30, shotgun 38). */
  noise: number;
  /** Shot times (s). Each shot alerts by `noise` and kills the nearest living station-storey enemy in sight within `killRange`. */
  shots: readonly number[];
  killRange?: number;
  seconds: number;
  /**
   * The mall round-3 open-atrium perception (ATRIUM_PERCEPTION): BrainWorld.atriumNotice, alertListeners' `atrium`, the horde call's
   * targetY — false = the established perception. The atrium CHASE rules (BrainWorld.atrium, path service options, shared routes) are
   * on either way, as the game runs the mall.
   */
  atrium: boolean;
  /** Optional player walk: waypoints on the station storey (looped at `walkSpeed` m/s, default 1.6), starting from the start. */
  walk?: readonly [number, number][];
  walkSpeed?: number;
  /** The player's flashlight on (player/flashlight.ts BEAM: 20 m attract range, 0.58 rad half cone), aimed along the walk / start yaw, pitched 0.2 rad down. */
  flashlight?: boolean;
}

const HUNT = new Set(['chase', 'attack', 'stagger']);

export function aggroSim(layout: StationLayout, o: AggroOpts) {
  const L: Levels = levelsOf(layout);
  const props = new PropIndex(L, layout.props);
  const pf = new PathFinder(L);
  const sp = layout.playerSpawn;
  const py = L.grid(0).floorAt(sp.x, sp.z);
  const player = {x: sp.x, y: py, z: sp.z, eye: py + STAND_EYE, alive: true};
  const near = (x: number, z: number, y: number | undefined) => nearPlayerRule(Math.hypot(x - player.x, z - player.z, (y ?? player.y) - player.y), () => null);
  const find = (ax: number, az: number, bx: number, bz: number, op: object) => pf.find(ax, az, bx, bz, 0.34, searchExpand(op), op);
  const ps = new PathService(find, null, null, near, atriumPathOptions(() => true, (x, z, y) => atriumNearRule(Math.hypot(x - player.x, z - player.z, (y ?? player.y) - player.y), (y ?? player.y) - player.y, () => null)));
  const share = new ChaseShare(L);
  const brains: ZombieBrain[] = layout.zombies.map(s => {
    const b = s.archetype === 'ratdog' ? new CreatureBrain(s.x, s.z, s.yaw)
      : s.archetype === 'siren' ? new SirenBrain(s.x, s.z, s.yaw, undefined, true)
        : s.archetype === 'blightbelly' ? new BlightbellyBrain(s.x, s.z, s.yaw)
          : new ZombieBrain(s.type, s.x, s.z, s.yaw);
    b.y = s.y ?? L.grid(s.level ?? 0).floorAt(s.x, s.z);
    return b;
  });
  const levelOf = (i: number) => layout.zombies[i].level ?? 0;
  const director = new HordeDirector(layout, L, i => brains[i], MALL_HORDE_RULES.patrol, layout.mall?.patrol ?? []);
  const rand = mulberry32(99);
  let cause: AlertCause = 'other';
  let t = 0;
  const responders = new Map<number, Responder>();
  /** Upper-floor spawns that stood on the station storey at some point (came down). */
  const reached = new Set<number>();
  /** Upper-floor spawns that investigated the flashlight (slow walk, not a chase). */
  const lured = new Set<number>();
  const record = (i: number, c: AlertCause) => {
    if (responders.has(i)) return;
    const b = brains[i], s = layout.zombies[i];
    responders.set(i, {index: i, level: levelOf(i), archetype: s.archetype ?? 'zombie', horde: s.horde !== undefined, cause: c, t: +t.toFixed(2), dist: +Math.hypot(b.x - player.x, b.y - player.y, b.z - player.z).toFixed(1)});
  };
  // every hear() under a known cause
  brains.forEach((b, i) => {
    const hear = b.hear.bind(b);
    b.hear = (x, z, r, y) => { const was = HUNT.has(b.state); hear(x, z, r, y); if (!was && HUNT.has(b.state)) record(i, cause); };
  });
  const world = (): BrainWorld => ({
    px: player.x, pz: player.z, py: player.y, playerAlive: player.alive,
    los: (ax, az, bx, bz, ay, by) => L.lineOfSight({x: ax, y: (ay ?? 0) + 1.5, z: az}, {x: bx, y: (by ?? 0) + 1.5, z: bz}),
    walkClear: (ax, az, bx, bz, r, ay, by) => L.walkLineClear(ax, ay ?? 0, az, bx, bz, r, by),
    findPath: (ax, az, bx, bz, op) => {
      const shared = share.lookup(ax, az, bx, bz, op);
      const r: Waypoint[] | null | undefined = shared !== undefined ? shared : ps.request(ax, az, bx, bz, op ?? {});
      if (shared === undefined) share.remember(ax, az, bx, bz, op, r);
      return r;
    },
    randomNear: (x, z, r, y) => {
      const lv = y !== undefined ? L.levelAt(x, z, y + 0.05) : 0;
      const G = L.grid(lv);
      for (let k = 0; k < 14; k++) {
        const tx = x + (rand() * 2 - 1) * r, tz = z + (rand() * 2 - 1) * r;
        const [cx, cy] = G.cellOf(tx, tz);
        if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) { const c = G.center(cx, cy); return [c[0], c[1], G.cellFloor(cx, cy)]; }
      }
      return null;
    },
    rand,
    atrium: true,
    ...(o.atrium ? {atriumNotice: true} : {}),
    ...lureWorld(L, {attracting: () => (beam ? [beam] : [])}),
  });
  // the flashlight: a spot light at the eye along the player's heading (the walk leg's direction, else the start yaw)
  let heading = sp.yaw;
  const beam: LightSource | null = o.flashlight ? {id: 1, kind: 'flashlight', active: true, x: 0, y: 0, z: 0, dir: {x: 0, y: 0, z: -1}, cosHalfAngle: Math.cos(0.58), spot: null, attractRange: 20, intensity: 1} : null;
  const aimBeam = () => {
    if (!beam) return;
    const c = Math.cos(0.2), d = {x: -Math.sin(heading) * c, y: -Math.sin(0.2), z: -Math.cos(heading) * c};
    beam.x = player.x; beam.y = player.eye; beam.z = player.z; beam.dir = d;
    const h = L.raycast({x: beam.x, y: beam.y, z: beam.z}, d, 30);
    const tt = h.kind === 'none' ? 30 : h.t;
    beam.spot = {x: beam.x + d.x * tt, y: beam.y + d.y * tt, z: beam.z + d.z * tt};
  };
  const bases = L.list.map(l => l.baseY);
  const shots = [...o.shots].sort((a, b) => a - b);
  let shotK = 0, kills = 0;
  const shoot = () => {
    // the kill: nearest living station-storey enemy in sight of the player's eye within killRange
    let best = -1, bd = o.killRange ?? 25;
    brains.forEach((b, i) => {
      if (!b.alive || b.y > 2.5) return;
      const d = Math.hypot(b.x - player.x, b.z - player.z, b.y - player.y);
      if (d < bd && L.lineOfSight({x: player.x, y: player.eye, z: player.z}, {x: b.x, y: b.y + 1.3, z: b.z})) { bd = d; best = i; }
    });
    if (best >= 0) {
      const b = brains[best];
      const was = HUNT.has(b.state);
      if (b.damage(b.hp + 1, player.x, player.z, player.y)) kills++;
      if (!was) record(best, 'damage');
    }
    cause = 'gunfire';
    // Game.alertZombies (stacked levels): 3D sight from the player's eye to the listener's chest line
    alertListeners(brains, player, o.noise, b => L.lineOfSight({x: player.x, y: player.eye, z: player.z}, {x: b.x, y: b.y + 1.5, z: b.z}), bases, o.atrium);
    cause = 'other';
  };
  const route: [number, number][] = o.walk?.length ? [[sp.x, sp.z], ...o.walk] : [];
  let leg = 0;
  const walkPlayer = (dt: number) => {
    if (route.length < 2) return;
    const [tx, tz] = route[(leg + 1) % route.length];
    const dx = tx - player.x, dz = tz - player.z, d = Math.hypot(dx, dz), s = (o.walkSpeed ?? 1.6) * dt;
    if (d > 1e-6) heading = Math.atan2(-dx, -dz); // forward = (-sin yaw, -cos yaw)
    if (d <= s) { player.x = tx; player.z = tz; leg = (leg + 1) % route.length; } else { player.x += dx / d * s; player.z += dz / d * s; }
    player.y = L.grid(0).floorAt(player.x, player.z); player.eye = player.y + STAND_EYE;
  };
  const step = () => {
    const dt = 1 / 60;
    t += dt;
    walkPlayer(dt);
    aimBeam();
    while (shotK < shots.length && shots[shotK] <= t) { shotK++; shoot(); }
    ps.tick();
    share.tick(dt);
    const w = world();
    director.update(dt, w, player);
    brains.forEach((b, i) => {
      const was = HUNT.has(b.state);
      const out = b.update(dt, w);
      if (!was && HUNT.has(b.state)) record(i, 'sight');
      if (b.state === 'investigate' && levelOf(i) >= 1) lured.add(i);
      if (out.alerted) { cause = 'call'; director.alerted(b, o.atrium ? player.y : undefined); cause = 'other'; } // Game.updateZombies: H.alerted(b, p.y)
      if (out.face !== null) {
        let d = out.face - b.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * dt;
        b.yaw += Math.max(-turn, Math.min(turn, d));
      }
      moveZombie(b, out, dt, L, props);
      if (b.y < 2.5 && levelOf(i) >= 1) reached.add(i);
      if (b.alive && !b.climbing) {
        for (const q of brains) {
          if (q === b || !q.alive || !sameLevel(b.y, q.y)) continue;
          const dx = b.x - q.x, dz = b.z - q.z, dd = Math.hypot(dx, dz), min = b.stats.radius + q.stats.radius;
          if (dd > 1e-4 && dd < min) { const push = (min - dd) * 0.5; b.x += dx / dd * push; b.z += dz / dd * push; }
        }
        settleZombie(b, L, props);
      }
    });
  };
  for (let f = 0; f < Math.round(o.seconds * 60); f++) step();
  const rs = [...responders.values()];
  const upper = rs.filter(r => r.level >= 1);
  const byCause = (list: Responder[]) => list.reduce((m, r) => { m[r.cause] = (m[r.cause] ?? 0) + 1; return m; }, {} as Record<string, number>);
  // "came down": upper-floor spawns standing on the station storey (or within a storey of it and still hunting) at the end
  const cameDown = upper.filter(r => brains[r.index].alive && brains[r.index].y < 2.5).length;
  const upperSpawns = layout.zombies.filter((_, i) => levelOf(i) >= 1 && brains[i]).length;
  // the largest group of upper-floor enemies set hunting by ONE event (same frame, same cause)
  const burst = new Map<string, number>();
  for (const r of upper) burst.set(`${r.t}|${r.cause}`, (burst.get(`${r.t}|${r.cause}`) ?? 0) + 1);
  return {
    lured: lured.size, luredReached: [...lured].filter(i => reached.has(i)).length,
    reached: [...reached].filter(i => responders.has(i)).length, maxBurst: Math.max(0, ...burst.values()),
    responders: rs, upper, upperByCause: byCause(upper), stationByCause: byCause(rs.filter(r => r.level === 0)), cameDown, kills, upperSpawns,
    brains, player, callsHeard: director.callsHeard, alertsCalled: director.alertsCalled,
    huntingUpperAtEnd: upper.filter(r => brains[r.index].alive && HUNT.has(brains[r.index].state)).length,
  };
}
