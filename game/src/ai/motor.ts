// Zombie locomotion on the height-aware world (iteration 05, Lane T): the brain decides where to
// go; the motor moves the body with height-aware collision (ledges above STEP_UP are walls, the
// platform edge is a drop), keeps the feet on the floor (stair ramps) or lets them fall, and leaves
// ladder climbs to the brain's scripted path.
//
// Iteration 08 (Lane B): bodies move through the stacked `Levels` (a plain Grid is one level): the
// feet follow the band they are in (stairs between levels hand over without a snap, a slab above or
// below never captures them, an aperture lets them fall to the floor below), collision uses the
// body's clear height (zombies stoop under BODY_CLEAR soffits) and railings.

import {moveCircle, resolveCircle, settleFeet, type PropIndex} from '../core/physics';
import {STEP_UP, type Grid} from '../gen/grid';
import {asLevels, BODY_CLEAR, type Levels} from '../gen/levels';
import type {BrainOutput, ZombieBrain} from './brain';

/** Bodies whose feet differ by more than this (platform vs track bed) do not shove each other (m). */
export const SAME_LEVEL = 1.0;
/** Nominal ground speed reported while climbing (drives the gait clip). */
const CLIMB_GAIT = 0.4;

/** Moves one zombie for a frame. Returns its ground speed (m/s) for animation/footsteps. */
export function moveZombie(b: ZombieBrain, out: BrainOutput, dt: number, world: Grid | Levels, props: PropIndex | null): number {
  if (!b.alive) return 0;
  const L = asLevels(world);
  if (b.climbing) { b.vy = 0; return CLIMB_GAIT; }
  let moved = 0;
  if (out.speed > 0) {
    const align = Math.cos(Math.atan2(out.dirX, out.dirZ) - b.yaw);
    const sp = out.speed * Math.max(0.25, align);
    const ox = b.x, oz = b.z;
    [b.x, b.z] = moveCircle(L, props, b.x, b.z, out.dirX * sp * dt, out.dirZ * sp * dt, b.stats.radius, b.y, b.stats.height ?? BODY_CLEAR);
    moved = Math.hypot(b.x - ox, b.z - oz) / Math.max(dt, 1e-6);
  }
  settleFeet(b, groundOf(L, b.x, b.z, b.y), dt);
  return moved;
}

/** Floor of the band holding feet at y (inside a slab / wall: the current height — never drop through). */
export function groundOf(L: Levels, x: number, z: number, y: number): number {
  return (L.supportIn(x, z, y, STEP_UP) ?? L.supportAt(x, z, y, STEP_UP))?.floor ?? y;
}

/** Final overlap fix after separation pushes (skipped mid-climb: the scripted path is valid). */
export function settleZombie(b: ZombieBrain, world: Grid | Levels, props: PropIndex | null): void {
  if (!b.alive || b.climbing) return;
  [b.x, b.z] = resolveCircle(asLevels(world), props, b.x, b.z, b.stats.radius, b.y, b.stats.height ?? BODY_CLEAR);
}

/** Same-level test for body separation (zombie-zombie, zombie-player). */
export function sameLevel(ay: number, by: number): boolean {
  return Math.abs(ay - by) < SAME_LEVEL;
}
