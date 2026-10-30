// Task knife-melee-20261030 (lane KNIFE): the knife's swing, resolved ONCE at blade contact — a short fan of rays from the
// eye through the same pieces as the bullet pipeline (game.fire): world occlusion via Levels.raycast (walls / risers /
// slabs of every storey / prop boxes: combat/hitscan.ts raycastWorld), enemy hit volumes via rayCapsule / raySphere
// (zombie head / torso / limb), corpses as blockers. Misses stay misses, nothing is hit through geometry, and at most ONE
// enemy takes damage per swing (the centre-most ray that reaches one decides; no area clear). Pure: no THREE, no DOM.

import {rayCapsule, raySphere, type Vec3} from './hitscan';

export type MeleePart = 'head' | 'torso' | 'limb';

/** An enemy hit volume (ai/zombieActor.ts HitVolume): sphere when `b` is null, else capsule a-b. */
export interface MeleeVolume { part: MeleePart; a: Vec3; b: Vec3 | null; r: number }

export interface MeleeTarget<T> {
  id: T;
  alive: boolean;
  /** Body position (feet), for the cheap reject. */
  x: number; y?: number; z: number;
  volumes: readonly MeleeVolume[];
}

/** World ray query: first surface hit before `max` (t = max and kind 'none' when nothing). */
export type MeleeWorldRay<W extends {t: number; kind: string} = {t: number; kind: string}> = (o: Vec3, d: Vec3, max: number) => W;
/** Corpse ray query (damage/system.ts corpseHit): a dead body on the ray before `maxT`, or null. */
export type MeleeCorpseRay<C> = (o: Vec3, d: Vec3, maxT: number) => ({t: number} & C) | null;

/**
 * Sweep pattern: [yaw, pitch] offsets (radians) from the crosshair, tried IN ORDER (centre first). The default fan is a
 * narrow horizontal slash arc (±0.09 / ±0.18 rad ≈ ±5° / ±10°) plus a little vertical tolerance (±0.07 rad ≈ ±4°).
 */
export const KNIFE_RAYS: readonly (readonly [number, number])[] = [
  [0, 0], [0.09, 0], [-0.09, 0], [0, 0.07], [0, -0.07], [0.18, 0], [-0.18, 0],
];

export interface MeleeHit<T> {
  kind: 'enemy';
  target: T;
  part: MeleePart;
  /** Distance from the eye along the ray (m). */
  t: number;
  point: Vec3;
  dir: Vec3;
  /** Index into the ray pattern that connected. */
  ray: number;
}
export interface MeleeCorpseContact<C> { kind: 'corpse'; corpse: C; t: number; point: Vec3; dir: Vec3; ray: number }
export interface MeleeWorldContact<W = {t: number; kind: string}> { kind: 'world'; surface: string; t: number; point: Vec3; dir: Vec3; ray: number; hit: W }
export type MeleeResult<T, C = unknown, W = {t: number; kind: string}> = MeleeHit<T> | MeleeCorpseContact<C> | MeleeWorldContact<W> | null;

/** Unit ray directions for a pattern around `fwd` (camera basis: right, up). */
export function meleeRayDirs(fwd: Vec3, right: Vec3, up: Vec3, rays: readonly (readonly [number, number])[] = KNIFE_RAYS): Vec3[] {
  return rays.map(([yaw, pitch]) => {
    const ty = Math.tan(yaw), tp = Math.tan(pitch);
    const x = fwd.x + right.x * ty + up.x * tp, y = fwd.y + right.y * ty + up.y * tp, z = fwd.z + right.z * ty + up.z * tp;
    const l = Math.hypot(x, y, z) || 1;
    return {x: x / l, y: y / l, z: z / l};
  });
}

/**
 * Resolve one swing at contact. Each ray stops at the first world surface (and at the nearest corpse) within `reach`;
 * the nearest live enemy volume before that is what the ray strikes. The first ray in pattern order that strikes a live
 * enemy decides the ONE target and its part. Without an enemy, the first ray that struck a corpse / surface is reported
 * (feedback only); null = a clean miss.
 */
export function resolveMelee<T, C = unknown, W extends {t: number; kind: string} = {t: number; kind: string}>(o: Vec3, dirs: readonly Vec3[], reach: number,
  targets: Iterable<MeleeTarget<T>>, world: MeleeWorldRay<W>, corpse?: MeleeCorpseRay<C>): MeleeResult<T, C, W> {
  const live = [...targets].filter(t => t.alive && Math.hypot(t.x - o.x, t.z - o.z) <= reach + 1.5); // bodies are < 1.5 m from their feet
  let contact: MeleeCorpseContact<C> | MeleeWorldContact<W> | null = null;
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    const wh = world(o, d, reach);
    let bestT = Math.min(reach, wh.t);
    let best: {id: T; part: MeleePart} | null = null;
    for (const tg of live) {
      for (const v of tg.volumes) {
        const t = v.b ? rayCapsule(o, d, v.a, v.b, v.r) : raySphere(o, d, v.a, v.r);
        if (t < bestT) { bestT = t; best = {id: tg.id, part: v.part}; }
      }
    }
    const c = corpse?.(o, d, bestT) ?? null;
    const at = (t: number): Vec3 => ({x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t});
    if (c && c.t < bestT) {
      contact ??= {kind: 'corpse', corpse: c, t: c.t, point: at(c.t), dir: d, ray: i};
      continue;
    }
    if (best) return {kind: 'enemy', target: best.id, part: best.part, t: bestT, point: at(bestT), dir: d, ray: i};
    if (wh.kind !== 'none' && wh.t <= reach) contact ??= {kind: 'world', surface: wh.kind, t: wh.t, point: at(wh.t), dir: d, ray: i, hit: wh};
  }
  return contact;
}

/** Damage of one melee hit on a body part (no range falloff: the reach is the range). */
export function meleeDamage(def: {damage: number; headMult: number; limbMult: number}, part: MeleePart): number {
  return def.damage * (part === 'head' ? def.headMult : part === 'limb' ? def.limbMult : 1);
}

/** Hits of `part` needed to kill an enemy with `hp` (balance documentation / tests). */
export function meleeHitsToKill(def: {damage: number; headMult: number; limbMult: number}, part: MeleePart, hp: number): number {
  return Math.ceil(hp / meleeDamage(def, part) - 1e-9);
}
