// Iteration 12 (AI lane, mandate E): LIGHT ATTRACTS ENEMIES.
//
//   "If an enemy can see light. It will slowly move towards it. Not a full on attack but slowly walk towards it. If it
//    can see the player it will ignore the light and attack the player… The flare will do the same thing… a good tool
//    for drawing the enemies out in to the open."
//
// Pure perception + tuning for the brain's 'investigate' state (ai/brain.ts); no three.js, so tests drive it directly.
//  * Lights are the world/lightSources.ts registry's `attracting()` list, written by the light lane: the flashlight
//    (active only while the battery / flicker let it shine), thrown flares and the body glow. The body glow never lures
//    (its kind is excluded and any light with an attract range under LURE.minRange is ignored), so the soft orange
//    near-player glow is never a beacon.
//    The light lane owns the ranges and already scales them by brightness: flashlight 20 m x battery output (0 when off
//    / flickered off / empty), flare 28 m x its burn-out fade; body glow 0.
//  * An enemy notices a light when one of its points is
//      - within the light's attractRange (hard-capped at LURE.maxRange; not dimmed again here),
//      - in front of it (half field of view LURE.fovHalf) unless it is already aware of the player, already tracking
//        that light, or the light is within LURE.nearAny,
//      - and in 3D line of sight from its eye (gen/levels.ts lineOfSight: walls, closed shutters, sight-blocking props,
//        floors and slab undersides between storeys block; open stairwells and light wells do not).
//    The points are the lit SPOT (beam hit point / the flare itself, nudged LURE.surfaceOffset off the lit surface so
//    the surface holding it does not hide it) and, for a spot light, the EMITTER — seen only from inside the beam cone
//    (you see a torch's lens only when it points at you); a seen lens overrides that light's own spot (an enemy in the
//    beam walks toward the torch, not to the wall lit behind it).
//  * Each enemy re-evaluates every LURE.period s (jittered, phase-staggered per enemy), never while chasing / attacking
//    / staggered / climbing and never in a frame it can see the player (the player always wins).

import {CELL} from '../gen/grid';
import type {Levels} from '../gen/levels';
import type {LightSource, LightSourceKind} from '../world/lightSources';

/** Eye height over the feet used for light sight (m) — the same eye line game.ts uses for player sight. */
export const LURE_EYE = 1.5;

export const LURE = {
  /** Seconds between light checks per enemy (x 0.8..1.2 jitter; the first check is phase-staggered by position). */
  period: 0.4,
  /** Investigation walk speed = the archetype's wander speed x this (shambler 0.78, coated 0.66, rat/dog 0.9 m/s; chase 2.55 / 1.75 / 4.4). */
  speedMult: 1.2,
  /** Half field of view (rad) for noticing a NEW light while unaware of the player (player sight uses 1.3). */
  fovHalf: 1.6,
  /** A light point this close (m) is noticed whatever the facing. */
  nearAny: 3,
  /** Hard cap on any light's attract range (m): no across-map lure. */
  maxRange: 40,
  /** Lights with a smaller attract range (m) never lure (the body glow; a nearly flat battery). */
  minRange: 2,
  /** Emitter of a spot light: visible from inside the beam cone widened by this much cosine. */
  coneSlack: 0.12,
  /** Sight target pulled this far (m) off the lit surface: back along the beam, or up from a flare. */
  surfaceOffset: 0.25,
  /** LOS slack (m) at the target end. */
  sightSlack: 0.05,
  /** A flashlight spot this close (m, horizontal) to the observer is on / at it: nothing to walk to (a flare at its feet still holds it). */
  selfSpot: 1.0,
  /** Score multipliers (lower wins): a seen emitter beats its spot, the tracked light is sticky. */
  emitterBias: 0.5, stick: 0.8,
  /** Stop this far (m, + 0..arriveJitter per enemy) from the light point: gather around a flare, not on it. */
  arrive: 1.6, arriveJitter: 1.2,
  /** Out of sight this long (s) while standing at the light = it went out / was lost. */
  lostGrace: 0.6,
  /**
   * After losing the light it walks on to the last seen spot and lingers THERE; this is only a safety cap (s) on that walk
   * (a ~20 m walk at investigate pace), after which it lingers where it stands. Stuck / unreachable ends it sooner.
   */
  pursueAfterLoss: 25,
  /** Linger (s, + 0..lingerJitter) at the last seen spot before returning to wander. */
  linger: 3.5, lingerJitter: 2.5,
  /** Re-plan when the light's goal moved this far (m: a sweeping flashlight spot), at most every repathMin s. */
  repathMove: 1.5, repathMin: 0.8,
  /** Stuck this long (s) while walking: re-plan; this many times: give up and linger. */
  stuckTime: 1.5, stuckGiveUp: 3,
} as const;

export type LurePart = 'spot' | 'emitter';
export interface LurePoint { part: LurePart; x: number; y: number; z: number }

/** What an enemy needs for light perception (ZombieBrain satisfies it). `y` = feet height. */
export interface LureObserver { x: number; y: number; z: number; yaw: number; aware: boolean }

/** 3D sight from an observer's eye (feet ay + LURE_EYE) to a world point. */
export type SeePoint = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean;

export interface LureSighting {
  light: LightSource;
  part: LurePart;
  /** The point seen (sight target just off the lit surface). */
  x: number; y: number; z: number;
  /** Eye-to-point distance (m). */
  dist: number;
  /** Salience (lower = stronger): dist / range x biases. */
  score: number;
}

/**
 * Notice range of a light (m); 0 = never lures (off, body glow, tiny range). The source's attractRange already carries
 * its brightness (light lane), so it is only capped here.
 */
export function lureRange(s: LightSource): number {
  if (!s.active || s.kind === 'bodyGlow' || !(s.attractRange >= LURE.minRange)) return 0;
  return Math.min(LURE.maxRange, s.attractRange);
}

const isSpotLight = (s: LightSource) => !!s.dir && s.cosHalfAngle < 1;

/**
 * The points of a light an enemy can notice (sight targets just off the lit surface). A spot light lists its emitter
 * (lens) first: seen from inside the beam it overrides that light's own spot (an enemy in the beam looks at the torch,
 * not at the wall lit behind it).
 */
export function lurePoints(s: LightSource, out: LurePoint[] = []): LurePoint[] {
  out.length = 0;
  const off = LURE.surfaceOffset;
  if (isSpotLight(s)) out.push({part: 'emitter', x: s.x, y: s.y, z: s.z});
  if (s.spot) {
    const d = s.dir;
    // back along the beam (toward the emitter: the lit side of the surface), or up off the floor for an omni light
    if (d && isSpotLight(s)) out.push({part: 'spot', x: s.spot.x - d.x * off, y: s.spot.y - d.y * off, z: s.spot.z - d.z * off});
    else out.push({part: 'spot', x: s.spot.x, y: s.spot.y + off, z: s.spot.z});
  }
  if (!isSpotLight(s) && (!s.spot || Math.hypot(s.spot.x - s.x, s.spot.y - s.y, s.spot.z - s.z) > 0.5)) out.push({part: 'emitter', x: s.x, y: s.y + off, z: s.z});
  return out;
}

export interface LurePointProbe {
  part: LurePart; x: number; y: number; z: number; dist: number;
  inRange: boolean; inCone: boolean; inFov: boolean; self: boolean; los: boolean | null;
}

/**
 * Per-point checks of one light for one observer, in order (range, beam cone, self, field of view, sight). `los` is
 * only evaluated (a ray) when every cheaper check passed, unless `full` (QA probe: evaluate every ray).
 */
function checkPoints(o: LureObserver, s: LightSource, range: number, tracked: boolean, see: SeePoint, full: boolean, pts: LurePoint[]): LurePointProbe[] {
  const ex = o.x, ey = o.y + LURE_EYE, ez = o.z;
  const res: LurePointProbe[] = [];
  for (const p of lurePoints(s, pts)) {
    const dx = p.x - ex, dy = p.y - ey, dz = p.z - ez, d = Math.hypot(dx, dy, dz);
    const inRange = d <= range;
    let inCone = true;
    if (p.part === 'emitter' && isSpotLight(s)) {
      // the eye sits inside the (slightly widened) beam cone: it sees the lens
      const c = -(dx * s.dir!.x + dy * s.dir!.y + dz * s.dir!.z) / Math.max(d, 1e-6);
      inCone = c >= s.cosHalfAngle - LURE.coneSlack;
    }
    const self = p.part === 'spot' && isSpotLight(s) && Math.hypot(p.x - o.x, p.z - o.z) < LURE.selfSpot && Math.abs(p.y - ey) < 2;
    let inFov = true;
    if (!tracked && !o.aware && d > LURE.nearAny) {
      const a = Math.atan2(dx, dz) - o.yaw;
      inFov = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= LURE.fovHalf;
    }
    const cheap = inRange && inCone && !self && inFov;
    res.push({part: p.part, x: p.x, y: p.y, z: p.z, dist: d, inRange, inCone, inFov, self, los: cheap || full ? see(o.x, o.y, o.z, p.x, p.y, p.z) : null});
  }
  return res;
}

const scratch: LurePoint[] = [];

/**
 * The most salient light this observer can see now, or null. `trackId` = the light it is already investigating
 * (no field-of-view limit, sticky score). Rays are cast only for points that pass the cheap checks and could beat
 * the current best.
 */
export function perceiveLight(o: LureObserver, lights: readonly LightSource[], see: SeePoint, trackId: number | null = null): LureSighting | null {
  let best: LureSighting | null = null;
  const ex = o.x, ey = o.y + LURE_EYE, ez = o.z;
  for (const s of lights) {
    const range = lureRange(s);
    if (range <= 0) continue;
    const tracked = s.id === trackId;
    const lens = isSpotLight(s);
    for (const p of lurePoints(s, scratch)) {
      const dx = p.x - ex, dy = p.y - ey, dz = p.z - ez, d = Math.hypot(dx, dy, dz);
      if (d > range) continue;
      const emitter = p.part === 'emitter';
      if (emitter && lens && -(dx * s.dir!.x + dy * s.dir!.y + dz * s.dir!.z) / Math.max(d, 1e-6) < s.cosHalfAngle - LURE.coneSlack) continue;
      if (!emitter && lens && Math.hypot(p.x - o.x, p.z - o.z) < LURE.selfSpot && Math.abs(p.y - ey) < 2) continue;
      if (!tracked && !o.aware && d > LURE.nearAny) {
        const a = Math.atan2(dx, dz) - o.yaw;
        if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > LURE.fovHalf) continue;
      }
      const score = d / range * (emitter ? LURE.emitterBias : 1) * (tracked ? LURE.stick : 1);
      // a lens is always ray-tested (when seen it overrides its own spot); other points only when they could win
      if (!(emitter && lens) && best && score >= best.score) continue;
      if (!see(o.x, o.y, o.z, p.x, p.y, p.z)) continue;
      if (!best || score < best.score) best = {light: s, part: p.part, x: p.x, y: p.y, z: p.z, dist: d, score};
      if (emitter && lens) break; // the lens is in view: skip this light's spot
    }
  }
  return best;
}

/** QA: every light's effective range and per-point checks for one observer (casts every ray). */
export function probeLights(o: LureObserver, lights: readonly LightSource[], see: SeePoint, trackId: number | null = null) {
  return lights.map(s => {
    const range = lureRange(s);
    return {id: s.id, kind: s.kind as LightSourceKind, active: s.active, intensity: s.intensity, attractRange: s.attractRange, range,
      points: range > 0 ? checkPoints(o, s, range, s.id === trackId, see, true, []) : []};
  });
}

/**
 * A standable point near a lit point on the storey whose band contains it: [x, z, floor] of the nearest passable
 * cell (Chebyshev rings up to `maxR` cells) whose support band holds the point's height; null when none (the brain
 * then aims at the point itself on its own storey).
 */
export function lureGoal(L: Levels, x: number, y: number, z: number, maxR = 4): [number, number, number] | null {
  const g0 = L.main;
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  for (let r = 0; r <= maxR; r++) {
    let best: [number, number, number] | null = null, bd = Infinity;
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
      const nx = cx + ox, ny = cy + oy;
      if (!g0.inBounds(nx, ny)) continue;
      const wx = (nx + 0.5) * CELL, wz = (ny + 0.5) * CELL;
      const s = L.supportIn(wx, wz, y);
      if (!s || !L.grid(s.level).passable(nx, ny)) continue;
      const d = (wx - x) ** 2 + (wz - z) ** 2;
      if (d < bd) { bd = d; best = [wx, wz, s.floor]; }
    }
    if (best) return best;
  }
  return null;
}

/**
 * The BrainWorld lure fields for a station (game.ts brainWorld spreads this): this frame's attracting lights, 3D
 * eye-to-point sight on the stacked levels and the standable goal near a lit point.
 */
export function lureWorld(L: Levels, sources: {attracting(): LightSource[]}): {
  lights: readonly LightSource[];
  seePoint: SeePoint;
  lureGoal: (x: number, y: number, z: number) => [number, number, number] | null;
} {
  return {
    lights: sources.attracting(),
    seePoint: (ax, ay, az, bx, by, bz) => L.lineOfSight({x: ax, y: ay + LURE_EYE, z: az}, {x: bx, y: by, z: bz}, {slack: LURE.sightSlack}),
    lureGoal: (x, y, z) => lureGoal(L, x, y, z),
  };
}
