// Task studio-reactor-playtest-round2-20261102 (lane COMBAT, user: "zombies cannot be damaged when on a different level than the
// player, so for example shooting at a zombie who is down stairs. this appears to apply to all levels in the game."): the ONE
// bullet / pellet vs enemy test of the hitscan pipeline (game.ts fire(), the damage QA shot).
//
// Root cause of the bug: fire()'s per-enemy cheap reject projected the enemy's feet onto the ray with the 3D direction's horizontal
// components (along = dx * d.x + dz * d.z) but never divided by the horizontal length squared, so on a pitched ray the "closest
// point" landed short of the enemy by D * sin^2(pitch) (D = horizontal distance) and every enemy more than sqrt(1.6) = 1.26 m off
// that wrong point was skipped before its hit volumes were tested. Level shots barely pitch (hits worked); shooting down a
// stairwell / atrium / the Reactor pit, or up at a gallery, pitches 20-60 degrees: a zombie 6 m away one storey down was skipped
// on every level. The world ray (Levels.raycast) was always 3D and correct.
//
// This test has no level / storey filter and no layer / visibility input: render culling (CULL_LAYER, LevelCuller.track) never
// removes a target. Its cheap reject is EXACT: the ray against the axis-aligned box around the enemy's own volumes (every
// volume lies inside it, so a volume the ray can reach is never skipped), for any pitch, any creature size and any pose.
// The caller passes the world hit distance as `maxT`: walls, slabs, floors, closed doors and props stop the bullet first.

import {rayCapsule, raySphere, type Vec3} from './hitscan';

export type RayPart = 'head' | 'torso' | 'limb';

/** An enemy hit volume (ai/zombieActor.ts HitVolume): sphere when `b` is null, else capsule a-b. */
export interface RayVolume { part: RayPart; a: Vec3; b: Vec3 | null; r: number }

/** What the test reads from an enemy (EnemyActor satisfies it). */
export interface RayEnemy {
  readonly brain: {readonly alive: boolean};
  readonly hitVolumes: readonly RayVolume[];
}

export interface EnemyRayHit<T> {
  enemy: T;
  /** Distance along the (unit) ray to the volume's surface. */
  t: number;
  part: RayPart;
}

/** Box padding (m) against float rounding: the box test may only ever be MORE permissive than the volumes. */
const PAD = 1e-4;

/**
 * Entry distance of the ray o + d t (t >= 0) into the axis-aligned box around every volume (Infinity: the ray misses it). The box
 * contains each sphere / capsule, so a ray reaching a volume at t enters the box at or before t.
 */
export function volumesBoxEntry(o: Vec3, d: Vec3, vols: readonly RayVolume[]): number {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k < vols.length; k++) {
    const v = vols[k], r = v.r + PAD, a = v.a, b = v.b ?? a;
    x0 = Math.min(x0, a.x - r, b.x - r); x1 = Math.max(x1, a.x + r, b.x + r);
    y0 = Math.min(y0, a.y - r, b.y - r); y1 = Math.max(y1, a.y + r, b.y + r);
    z0 = Math.min(z0, a.z - r, b.z - r); z1 = Math.max(z1, a.z + r, b.z + r);
  }
  let tmin = 0, tmax = Infinity;
  // slabs per axis (a zero direction component: inside the slab or never)
  if (Math.abs(d.x) < 1e-12) { if (o.x < x0 || o.x > x1) return Infinity; } else {
    let t0 = (x0 - o.x) / d.x, t1 = (x1 - o.x) / d.x;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
  }
  if (Math.abs(d.y) < 1e-12) { if (o.y < y0 || o.y > y1) return Infinity; } else {
    let t0 = (y0 - o.y) / d.y, t1 = (y1 - o.y) / d.y;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
  }
  if (Math.abs(d.z) < 1e-12) { if (o.z < z0 || o.z > z1) return Infinity; } else {
    let t0 = (z0 - o.z) / d.z, t1 = (z1 - o.z) / d.z;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
  }
  return tmin <= tmax ? tmin : Infinity;
}

/**
 * The nearest live enemy volume the unit ray o + d t crosses before `maxT` (the world hit: walls / slabs / closed doors / props),
 * in enemy order then volume order on ties (the old loop's order). null = no enemy before the world hit. Every live enemy on every
 * storey is a candidate; nothing here reads render state.
 */
export function nearestEnemyHit<T extends RayEnemy>(o: Vec3, d: Vec3, maxT: number, enemies: Iterable<T>): EnemyRayHit<T> | null {
  let best: EnemyRayHit<T> | null = null, bestT = maxT;
  for (const e of enemies) {
    if (!e.brain.alive) continue;
    const vols = e.hitVolumes;
    if (!vols.length || volumesBoxEntry(o, d, vols) >= bestT) continue;
    for (let k = 0; k < vols.length; k++) {
      const v = vols[k];
      const t = v.b ? rayCapsule(o, d, v.a, v.b, v.r) : raySphere(o, d, v.a, v.r);
      if (t < bestT) { bestT = t; best = {enemy: e, t, part: v.part}; }
    }
  }
  return best;
}
