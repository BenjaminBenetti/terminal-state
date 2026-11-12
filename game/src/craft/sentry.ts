// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY; user: "Defense sentry … Interact to deposit real 5.56 ammunition; a roof
// turret deploys and automatically fires at nearby zombies using normal line-of-sight combat. Craft it empty; do not create free ammo."):
// THE SENTRY'S RULES — pure (no three.js, no Game, no DOM): every tuning number (SENTRY), the hopper's load / unload, the turret's
// geometry on the roof (pivot, muzzle, aim angles), the OWN-HULL rule and the VIRTUAL ORIGIN of its line of fire, the target order and
// the small vector helpers. world/sentryTurret.ts runs them against the live game (the equipment unit, the enemies, the level's rays).
//
// AMMO: the hopper holds real 5.56 mm rounds (craft/equipment.ts EQUIPMENT.sentry: ammoItem / ammoCap; the unit's `ammo`). A round only
// ever enters it out of the carried inventory (loadHopper: exactly min(carried, room)) and only ever leaves it as a shot (one per shot) or
// back into the inventory (unloadHopper: stack by stack, as many as fit — what does not fit stays loaded). Inventory + hopper is constant
// through any sequence of loads / unloads; nothing here makes a round.
//
// THE LINE OF FIRE (train-local frame of world/playerTrainSpec.ts: +X front, +Y up, origin at rail-top height on the centre line): from
// the turret's PIVOT (the yaw axis at the tilt axis' height, above craft/trainFixtures.ts turretMount) to the aim point.
//  1. OWN HULL (ownHullClear): while the line is above the car's plan outline (|x| <= length / 2, |z| <= width / 2) it stays at least
//     SENTRY.hullMargin above the roof outline (trainFixtures.ts TRAIN_ROOF_PROFILE: the cooked shell's highest roof point at or beyond
//     that |z|, vent boxes included; checked exactly against its steps). The turret never shoots through its own roof — which leaves a
//     dead zone close beside the car (a target under the eaves), and fore / aft along the roof, and inside the car.
//  2. THE VIRTUAL ORIGIN (hullExit): the parked car's colliders (world/playerTrain.ts trainColliders) include a ROOF BOX over the full
//     outline up to the vents' top, coarser than the real roof — a ray cast from the pivot would stop in it. So the level's rays (sight,
//     bullet) start where the line leaves the outline, SENTRY.hullPush outside it (every collider box of the car lies inside the outline).
//     A convex outline is never re-entered: from there on the car cannot be hit.
// Everything past the virtual origin is the game's normal combat (world/sentryTurret.ts): Levels.lineOfSight + the bullet's world ray, the
// enemies' own hit volumes, the rifle's damage / falloff / part multipliers.

import type {ItemStack} from '../items/inventory';
import {TRAIN_TURRET_MEASURED} from '../assets/trainEquipment.generated';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from '../world/playerTrainSpec';
import {TRAIN_ROOF_PROFILE, roofTopAt, turretMount} from './trainFixtures';

const DEG = Math.PI / 180;

/** Every tuning number of the sentry (one place; first-pass defaults of the lead's design). */
export const SENTRY = {
  /** Targets: within this horizontal distance of the turret (m), on any storey. */
  range: 28,
  /** A target is picked this often (s); at most `maxChecks` candidates are line-tested per pick, nearest first. */
  repick: 0.25,
  maxChecks: 12,
  /** Single aimed shots: seconds between two; the cone's half angle (rad). */
  interval: 0.4,
  spread: 0.012,
  /** The barrel points within this of the aim line before it fires (rad: 3 degrees). */
  align: 3 * DEG,
  /** Hold fire while the player's body axis (feet .. `headAbove` over the eye) is within this of the line of fire (m). */
  safeRadius: 0.6,
  headAbove: 0.12,
  /** The bullet's world ray reaches the aim point within this (m): the game's clear-line tolerance (Game.echoScan). */
  reach: 0.05,
  /** OWN HULL: the line stays this far above the roof outline (m). */
  hullMargin: 0.03,
  /** THE VIRTUAL ORIGIN: this far outside the car's plan outline (m). */
  hullPush: 0.04,
  /** The turret: yaw / pitch rates (rad/s), the elevation stops (rad), the idle scan (rad/s, its pitch). */
  yawRate: 200 * DEG,
  pitchRate: 120 * DEG,
  pitchMin: -35 * DEG,
  pitchMax: 20 * DEG,
  scanRate: 25 * DEG,
  scanPitch: -6 * DEG,
  /** Rising out of / sinking into the roof (s). */
  deployS: 0.8,
  /** Free height needed above the deployed turret's highest reach (m). */
  headroom: 0.05,
  /** The aim point on an enemy's torso volume: this fraction from its lower end to its upper end. */
  torsoUp: 0.7,
  /** The round it fires: weapons/weapons.ts WEAPONS[weapon] (damage, falloff, part multipliers, range, knockback, noise). */
  weapon: 'rifle',
  /** The pivot clears the roof's crest by at least this (m): lower, and the dead zone beside the car swallows the platform (a cook check). */
  pivotClearMin: 0.12,
} as const;

export interface V3 { x: number; y: number; z: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------------------------------------------------------------
// The hopper: loading / unloading real rounds

/** What the hopper needs of the carried inventory (items/inventory.ts Inventory: pockets + quick slots). */
export interface AmmoInventory {
  count(itemId: string): number;
  /** Removes up to n; returns how many were removed. */
  take(itemId: string, n: number): number;
  makeStack(itemId: string, count: number): ItemStack;
  /** Adds as much of the stack as fits; returns the count that did NOT fit. */
  add(stack: ItemStack): number;
}

/** What the hopper is (craft/equipmentApi.ts EquipmentUnit). */
export interface AmmoHopper {
  readonly ammo: number;
  setAmmo(n: number): number;
  readonly def: {readonly ammoCap: number; readonly ammoItem: string | null};
}

/** Rounds a load moves: every carried round the hopper has room for (whole, never negative). */
export function planLoad(carried: number, ammo: number, cap: number): number {
  return Math.max(0, Math.min(Math.floor(carried), Math.floor(cap) - Math.floor(ammo)));
}

/** The next stack an unload hands back: at most one full stack of what is loaded. */
export function planUnload(ammo: number, stackMax: number): number {
  return Math.max(0, Math.min(Math.floor(ammo), Math.max(1, Math.floor(stackMax))));
}

/**
 * LOAD: every carried round the hopper has room for goes in. Returns the rounds moved (0: nothing carried / full / no hopper). The
 * rounds leave the inventory first; a round the hopper did not take (never, by planLoad) goes back, so the total is exact either way.
 */
export function loadHopper(inv: AmmoInventory, unit: AmmoHopper): number {
  const item = unit.def.ammoItem;
  if (!item) return 0;
  const before = unit.ammo;
  const n = planLoad(inv.count(item), before, unit.def.ammoCap);
  if (n <= 0) return 0;
  const taken = inv.take(item, n);
  if (taken <= 0) return 0;
  const moved = unit.setAmmo(before + taken) - before;
  if (moved < taken) inv.add(inv.makeStack(item, taken - moved));
  return Math.max(0, moved);
}

/**
 * UNLOAD: the loaded rounds go back into the inventory as ordinary stacks, stack by stack, as many as fit; what does not fit stays
 * loaded. Returns the rounds moved.
 */
export function unloadHopper(inv: AmmoInventory, unit: AmmoHopper, stackMax: number): number {
  const item = unit.def.ammoItem;
  if (!item) return 0;
  let total = 0;
  for (let guard = 0; guard < 64 && unit.ammo > 0; guard++) {
    const n = planUnload(unit.ammo, stackMax);
    const left = inv.add(inv.makeStack(item, n));
    const moved = n - Math.max(0, Math.min(n, left));
    if (moved > 0) { unit.setAmmo(unit.ammo - moved); total += moved; }
    if (moved < n) break;
  }
  return total;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The turret on the roof (train-local)

/** The turret's highest reach above its base (m): its own height, or the barrel's tip at full elevation. */
export function turretReach(): number {
  const M = TRAIN_TURRET_MEASURED, dy = M.muzzle.y - M.pitchPivot.y, dz = M.muzzle.z - M.pitchPivot.z;
  const tip = M.pitchPivot.y + Math.hypot(dy, dz) * Math.sin(SENTRY.pitchMax + Math.atan2(dy, dz)) + 0.02;
  return Math.max(M.size.h, tip);
}

/** The radius the turning turret sweeps about its yaw axis (m). */
export function turretSweep(): number {
  const M = TRAIN_TURRET_MEASURED;
  return Math.hypot(Math.max(Math.abs(M.muzzle.z), M.size.l - Math.abs(M.muzzle.z)), M.size.w / 2);
}

/** The PIVOT: the point of the yaw axis at the tilt axis' height — where the line of fire starts (train-local). */
export function turretPivot(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, out: V3 = {x: 0, y: 0, z: 0}): V3 {
  const m = turretMount(spec);
  out.x = m.x; out.y = m.y + TRAIN_TURRET_MEASURED.pitchPivot.y; out.z = m.z;
  return out;
}

/** The muzzle of a turret turned `yaw` (about +Y; 0 = the car's +Z) and elevated `pitch` (rad, up positive), train-local. */
export function turretMuzzle(yaw: number, pitch: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, out: V3 = {x: 0, y: 0, z: 0}): V3 {
  const M = TRAIN_TURRET_MEASURED, P = M.pitchPivot, m = turretMount(spec);
  const dx = M.muzzle.x - P.x, dy = M.muzzle.y - P.y, dz = M.muzzle.z - P.z;
  const ce = Math.cos(pitch), se = Math.sin(pitch), c = Math.cos(yaw), s = Math.sin(yaw);
  // the head's tilt about X through the pivot, then the yoke's turn about +Y through the origin
  const hx = P.x + dx, hy = P.y + dy * ce + dz * se, hz = P.z + dz * ce - dy * se;
  out.x = m.x + hx * c + hz * s; out.y = m.y + hy; out.z = m.z - hx * s + hz * c;
  return out;
}

/** The yaw / pitch that point the barrel along unit direction d (train-local). */
export function aimAngles(d: V3, out: {yaw: number; pitch: number} = {yaw: 0, pitch: 0}): {yaw: number; pitch: number} {
  out.yaw = Math.atan2(d.x, d.z);
  out.pitch = Math.asin(clamp(d.y, -1, 1));
  return out;
}

/** The barrel's unit direction at a yaw / pitch (train-local). */
export function barrelDir(yaw: number, pitch: number, out: V3 = {x: 0, y: 0, z: 0}): V3 {
  const ce = Math.cos(pitch);
  out.x = Math.sin(yaw) * ce; out.y = Math.sin(pitch); out.z = Math.cos(yaw) * ce;
  return out;
}

/** a in (-PI, PI]. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** `cur` turned toward `want` by at most `max` (rad; the short way round). */
export function turnToward(cur: number, want: number, max: number): number {
  const d = wrapAngle(want - cur);
  return Math.abs(d) <= max ? want : cur + Math.sign(d) * max;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The own-hull rule and the virtual origin (train-local)

const SPAN: [number, number] = [0, 0];

/** The part [t0, t1] of the ray o + d t, 0 <= t <= maxT, above the plan rect |x| <= hx, |z| <= hz (into `out`); false: none. */
export function planSpan(o: V3, d: V3, maxT: number, hx: number, hz: number, out: [number, number] = [0, 0]): boolean {
  let t0 = 0, t1 = maxT;
  if (Math.abs(d.x) < 1e-12) { if (Math.abs(o.x) > hx) return false; } else {
    let a = (-hx - o.x) / d.x, b = (hx - o.x) / d.x;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
  }
  if (Math.abs(d.z) < 1e-12) { if (Math.abs(o.z) > hz) return false; } else {
    let a = (-hz - o.z) / d.z, b = (hz - o.z) / d.z;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
  }
  if (t0 > t1) return false;
  out[0] = t0; out[1] = t1;
  return true;
}

/**
 * OWN HULL: the ray o + d t (unit d, 0 <= t <= maxT) never comes within `margin` of the car's roof outline while it is above the car's
 * plan outline. False: the shot would go through the car's own roof (or starts under it). EXACT against the stepped outline (no
 * sampling): the line is straight and the outline is constant between its steps, so the line is lowest against each step where it
 * enters / leaves it — the ends of its span over the car and every crossing of a step's |z| (on either side of the centre line),
 * where the higher (inner) step counts.
 */
export function ownHullClear(o: V3, d: V3, maxT: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, margin: number = SENTRY.hullMargin): boolean {
  if (!planSpan(o, d, maxT, spec.length / 2, spec.width / 2, SPAN)) return true;
  const t0 = SPAN[0], t1 = SPAN[1];
  if (o.y + d.y * t0 < roofTopAt(o.z + d.z * t0, spec) + margin) return false;
  if (o.y + d.y * t1 < roofTopAt(o.z + d.z * t1, spec) + margin) return false;
  if (Math.abs(d.z) < 1e-12) return true; // along the car: the same step all the way
  const P = TRAIN_ROOF_PROFILE;
  for (let i = 1; i < P.length; i++) {
    const z = P[i][0], inner = Math.max(P[i - 1][1], P[i][1]) + margin;
    let t = (z - o.z) / d.z;
    if (t > t0 && t < t1 && o.y + d.y * t < inner) return false;
    t = (-z - o.z) / d.z;
    if (t > t0 && t < t1 && o.y + d.y * t < inner) return false;
  }
  return true;
}

/**
 * THE VIRTUAL ORIGIN: the distance along the ray at which it is `push` outside the car's plan outline (0: it starts there); null: it
 * does not get out within maxT (the aim point is on / in the car). Every collider box of the car lies inside the outline, and a convex
 * outline is never re-entered: a level ray cast from there cannot hit the car.
 */
export function hullExit(o: V3, d: V3, maxT: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, push: number = SENTRY.hullPush): number | null {
  const hx = spec.length / 2 + push, hz = spec.width / 2 + push;
  if (Math.abs(o.x) >= hx || Math.abs(o.z) >= hz) return 0;
  let t = Infinity;
  if (Math.abs(d.x) > 1e-12) t = Math.min(t, ((d.x > 0 ? hx : -hx) - o.x) / d.x);
  if (Math.abs(d.z) > 1e-12) t = Math.min(t, ((d.z > 0 ? hz : -hz) - o.z) / d.z);
  return t < maxT ? t : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Targets

/**
 * THE TARGET: the nearest candidate with a clear shot. `dist2(c)` = its squared horizontal distance from the turret (Infinity: not a
 * candidate — dead, ragdolled, dormant); candidates beyond `range` are never tested; `clear` (the costly line tests) is asked nearest
 * first, at most `maxChecks` times. Equal distances keep the list order. No allocation.
 */
export function pickTarget<T>(cands: readonly T[], dist2: (c: T) => number, clear: (c: T) => boolean, range: number = SENTRY.range, maxChecks: number = SENTRY.maxChecks): T | null {
  const r2 = range * range;
  let lastD = -1, lastI = -1;
  for (let k = 0; k < maxChecks; k++) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const d = dist2(cands[i]);
      if (!(d <= r2)) continue;
      if (d < lastD || (d === lastD && i <= lastI)) continue; // already asked
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0) return null;
    if (clear(cands[bi])) return cands[bi];
    lastD = bd; lastI = bi;
  }
  return null;
}

/** A hit volume as the enemies carry them (combat/enemyRay.ts RayVolume: a sphere when `b` is null, else the capsule a-b). */
export interface AimVolume { part: 'head' | 'torso' | 'limb'; a: V3; b: V3 | null; r: number }

/**
 * The aim point on a body's `part` volume (into `out`; false: it has none): a sphere's centre; a capsule's point SENTRY.torsoUp of the
 * way from its lower end to its upper end (the UPPER torso of an upright body; the same fraction along a lying / four-legged one).
 */
export function aimPoint(vols: readonly AimVolume[], part: 'head' | 'torso', out: V3): boolean {
  for (let i = 0; i < vols.length; i++) {
    const v = vols[i];
    if (v.part !== part) continue;
    if (!v.b) { out.x = v.a.x; out.y = v.a.y; out.z = v.a.z; return true; }
    const lo = v.a.y <= v.b.y ? v.a : v.b, hi = lo === v.a ? v.b : v.a, k = SENTRY.torsoUp;
    out.x = lo.x + (hi.x - lo.x) * k; out.y = lo.y + (hi.y - lo.y) * k; out.z = lo.z + (hi.z - lo.z) * k;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Distances

/** Distance from point p to the segment a-b. */
export function segmentPointDistance(a: V3, b: V3, p: V3): number {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, l2 = ux * ux + uy * uy + uz * uz;
  const t = l2 > 1e-18 ? clamp(((p.x - a.x) * ux + (p.y - a.y) * uy + (p.z - a.z) * uz) / l2, 0, 1) : 0;
  return Math.hypot(a.x + ux * t - p.x, a.y + uy * t - p.y, a.z + uz * t - p.z);
}

/** Shortest distance between the segments a0-a1 and b0-b1. */
export function segmentSegmentDistance(a0: V3, a1: V3, b0: V3, b1: V3): number {
  const ux = a1.x - a0.x, uy = a1.y - a0.y, uz = a1.z - a0.z;
  const vx = b1.x - b0.x, vy = b1.y - b0.y, vz = b1.z - b0.z;
  const wx = a0.x - b0.x, wy = a0.y - b0.y, wz = a0.z - b0.z;
  const A = ux * ux + uy * uy + uz * uz, B = ux * vx + uy * vy + uz * vz, C = vx * vx + vy * vy + vz * vz;
  const D = ux * wx + uy * wy + uz * wz, E = vx * wx + vy * wy + vz * wz;
  if (A < 1e-18) return segmentPointDistance(b0, b1, a0);
  if (C < 1e-18) return segmentPointDistance(a0, a1, b0);
  const den = A * C - B * B;
  let s = den > 1e-12 ? clamp((B * E - C * D) / den, 0, 1) : 0;
  let t = (B * s + E) / C;
  if (t < 0) { t = 0; s = clamp(-D / A, 0, 1); } else if (t > 1) { t = 1; s = clamp((B - D) / A, 0, 1); }
  return Math.hypot(wx + ux * s - vx * t, wy + uy * s - vy * t, wz + uz * s - vz * t);
}

/** The line of fire a-b keeps SENTRY.safeRadius off a standing body's axis (feet .. SENTRY.headAbove over the eye). */
export function clearOfBody(a: V3, b: V3, feet: V3, eyeY: number, radius: number = SENTRY.safeRadius): boolean {
  HEAD.x = feet.x; HEAD.y = Math.max(feet.y, eyeY + SENTRY.headAbove); HEAD.z = feet.z;
  return segmentSegmentDistance(a, b, feet, HEAD) >= radius;
}
const HEAD: V3 = {x: 0, y: 0, z: 0};
