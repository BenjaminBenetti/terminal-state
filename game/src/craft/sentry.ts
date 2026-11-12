// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): the defense sentry — a movable console that plugs into the train and is
// fed real 5.56 mm rounds, and a roof turret that fires them at nearby enemies through the game's normal line-of-sight combat. It is
// crafted empty; no round is ever made here.
// THE SENTRY'S RULES — pure (no three.js, no Game, no DOM): every tuning number (SENTRY), the hopper's load / unload, the turret's
// geometry on the roof (pivot, muzzle, aim angles), the OWN-HULL rule and the VIRTUAL ORIGIN of its line of fire, the target order and
// the small vector helpers. world/sentryTurret.ts runs them against the live game (the equipment unit, the enemies, the level's rays).
//
// AMMO: the hopper holds real 5.56 mm rounds (craft/equipment.ts EQUIPMENT.sentry: ammoItem / ammoCap; the unit's `ammo`). A round only
// ever enters it out of the carried inventory (loadHopper: exactly min(carried, room)) and only ever leaves it as a shot (one per shot) or
// back into the inventory (unloadHopper: stack by stack, as many as fit — what does not fit stays loaded). Inventory + hopper is constant
// through any sequence of loads / unloads; nothing here makes a round.
//
// THE TURRET stands on the car's middle roof hatch (craft/trainFixtures.ts turretMount: the yaw axis, the underside of the base ring).
// Its tilt axis is NOT on the yaw axis: the cooked model's pitch pivot (assets/trainEquipment.generated.ts TRAIN_TURRET_MEASURED.
// pitchPivot) sits a few centimetres ahead of it, so the PIVOT orbits the yaw axis as the gun turns (turretPivot(yaw)).
// THE LINE OF FIRE (train-local frame of world/playerTrainSpec.ts: +X front, +Y up, origin at rail-top height on the centre line): from
// the PIVOT of the turret at the yaw it has — for a clear-shot test, at the yaw that points at that target (turretPivotToward) — to the
// aim point.
//  1. OWN HULL (ownHullClear): while the line is above the car's plan it stays at least SENTRY.hullMargin above the measured roof
//     outline AT EACH STATION ALONG IT (trainFixtures.ts roofTopAtPoint: per 2 cm band of |z| the highest roof point at or beyond it, with
//     its own outline over each of the three hatch boxes, the end caps and the body between them). The outline is constant inside each
//     plan rectangle (band x stretch), so the test is exact: the line's height where it enters / leaves every rectangle it crosses. The
//     turret never shoots through its own roof — which leaves a dead zone close beside the car (a target under the eaves; straight
//     across the car the lower elevation stop binds before the roof does), fore / aft along the roof, and inside the car.
//  2. THE VIRTUAL ORIGIN (hullExit): the parked car's colliders (world/playerTrain.ts trainColliders) include a ROOF BOX over the full
//     outline up to the hatches' top, coarser than the real roof — a ray cast from the pivot would stop in it. So the level's rays (sight,
//     bullet) start where the line leaves the outline, SENTRY.hullPush outside it (every collider box of the car lies inside the outline).
//     A convex outline is never re-entered: from there on the car cannot be hit.
// Everything past the virtual origin is the game's normal combat (world/sentryTurret.ts): Levels.lineOfSight + the bullet's world ray, the
// enemies' own hit volumes, the rifle's damage / falloff / part multipliers.

import type {ItemStack} from '../items/inventory';
import {TRAIN_TURRET_MEASURED} from '../assets/trainEquipment.generated';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from '../world/playerTrainSpec';
import {TRAIN_ROOF, roofTopAtPoint, turretMount} from './trainFixtures';

const DEG = Math.PI / 180;

/** Every tuning number of the sentry (one place). */
export const SENTRY = {
  /** Targets: within this horizontal distance of the turret (m), on any storey. */
  range: 28,
  /**
   * A target is picked this often (s), nearest first: at most `maxChecks` candidates are refused by the costly world rays and at most
   * `maxCandidates` are looked at per pick (the ones refused by the own-roof rule cost nothing and do not count).
   */
  repick: 0.25,
  maxChecks: 12,
  maxCandidates: 48,
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
  /** The turret: yaw / pitch rates (rad/s). */
  yawRate: 200 * DEG,
  pitchRate: 120 * DEG,
  /**
   * The elevation stops (rad, up positive) — the cooked turret's own.
   * DOWN: TRAIN_TURRET_MEASURED.pitchClear.overPlane — the largest depression at which the barrel's tip stays 10 mm above the plane
   * the base stands on (the hatch top under it).
   * UP: 8 degrees. Raising the muzzle sinks the head's rear lugs into the yoke's rear arm housings — a nested-lug overlap, hidden from
   * the platform: 1.6 cm2 at 2 degrees, 12.2 cm2 at 10 degrees where the gun's underside starts to touch the yoke's floor, 78.5 cm2 at
   * 12 degrees (the gun body through the floor). 8 keeps a margin below the 10-degree contact; pitchClear.up (0) stays the strict
   * no-overlap limit.
   */
  pitchMin: -TRAIN_TURRET_MEASURED.pitchClear.overPlane * DEG,
  pitchMax: 8 * DEG,
  /** The idle scan (rad/s) and its pitch: a small depression. */
  scanRate: 25 * DEG,
  scanPitch: -6 * DEG,
  /** Rising out of / sinking into the roof (s). */
  deployS: 0.8,
  /** Free height needed above the deployed turret's highest reach (m). */
  headroom: 0.05,
  /**
   * The cooked head's highest point above the base's underside at the LOWER stop (m): the sensor box at its rear rises as the muzzle
   * goes down (TRAIN_TURRET_MEASURED.size.h at rest). Measured on the model's vertices; tests/sentry-turret-model.test.ts re-measures
   * it on the GLB. TODO(lead): a number for the cook's TRAIN_TURRET_MEASURED (the highest point over the elevation range).
   */
  topDepressed: 0.568,
  /** The aim point on an enemy's torso volume: this fraction from its lower end to its upper end. */
  torsoUp: 0.7,
  /** The round it fires: weapons/weapons.ts WEAPONS[weapon] (damage, falloff, part multipliers, range, knockback, noise). */
  weapon: 'rifle',
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

/**
 * The turret's highest reach above its base's underside (m) anywhere between the elevation stops: its height at rest, the head's rear
 * at the lower stop (SENTRY.topDepressed), the barrel's tip at the upper stop.
 */
export function turretReach(): number {
  const M = TRAIN_TURRET_MEASURED, dy = M.muzzle.y - M.pitchPivot.y, dz = M.muzzle.z - M.pitchPivot.z;
  const tip = M.pitchPivot.y + dy * Math.cos(SENTRY.pitchMax) + dz * Math.sin(SENTRY.pitchMax) + 0.02;
  return Math.max(M.size.h, SENTRY.topDepressed, tip);
}

/** The radius the turning turret sweeps about its yaw axis (m): the cook's measurement. */
export function turretSweep(): number {
  return TRAIN_TURRET_MEASURED.swingRadius;
}

/**
 * The PIVOT of a turret turned `yaw` (about +Y; 0 = the car's +Z): the middle of the tilt axis — where the line of fire starts
 * (train-local). It is NOT on the yaw axis (TRAIN_TURRET_MEASURED.pitchPivot is ahead of it): it orbits the axis with the yaw.
 */
export function turretPivot(yaw: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, out: V3 = {x: 0, y: 0, z: 0}): V3 {
  const P = TRAIN_TURRET_MEASURED.pitchPivot, m = turretMount(spec), c = Math.cos(yaw), s = Math.sin(yaw);
  out.x = m.x + P.x * c + P.z * s; out.y = m.y + P.y; out.z = m.z - P.x * s + P.z * c;
  return out;
}

/**
 * The pivot of a turret turned to POINT AT the train-local plan point (x, z) — the line of fire to a target there starts here. The yaw
 * is the bearing of the point from the yaw axis: the tilt axis' middle lies in the gun's own vertical plane (pitchPivot.x = 0; pinned
 * by tests/sentry-hull), so the pivot is on that bearing and the line from it to the point has the same yaw. No trigonometry.
 */
export function turretPivotToward(x: number, z: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, out: V3 = {x: 0, y: 0, z: 0}): V3 {
  const P = TRAIN_TURRET_MEASURED.pitchPivot, m = turretMount(spec), ax = x - m.x, az = z - m.z, h = Math.hypot(ax, az);
  const s = h > 1e-9 ? ax / h : 0, c = h > 1e-9 ? az / h : 1;
  out.x = m.x + P.x * c + P.z * s; out.y = m.y + P.y; out.z = m.z - P.x * s + P.z * c;
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

// THE OUTLINE AS A TABLE. roofTopAtPoint is constant inside each rectangle of the plan: a band of |z| (TRAIN_ROOF.step wide; the hatch
// boxes' sides |z| = hatchZ are band edges) x a stretch along the car between two of the stations where the outline changes (the end
// caps' starts, each hatch box's two ends). The table below is READ FROM roofTopAtPoint once (at the middle of every rectangle), so
// the values are the contract's own whatever it composes them from; tests/sentry-hull compares the rule against roofTopAtPoint itself
// along thousands of lines. (The outline is the one cooked shell's; a `spec` only bounds the plan the line is walked over.)

const SPAN: [number, number] = [0, 0];
/** A point this close to a rectangle's edge (m) counts as on it: the higher of the adjoining rectangles is taken. */
const EDGE = 1e-6;
/** roofTopAtPoint knows a roof up to this far beyond the car's half width (m). */
const ROOF_SIDE = 0.02;
/** The stations along the car where the outline changes, ascending. */
const ROOF_XS: readonly number[] = [-TRAIN_ROOF.endX, TRAIN_ROOF.endX, ...TRAIN_ROOF.hatches.flatMap(h => [h.x0, h.x1])].sort((a, b) => a - b);
/** Bands per stretch (the last one: beyond the roof). */
const ROOF_BANDS: number = TRAIN_ROOF.body.length;
/** ROOF_TOP[s * ROOF_BANDS + k]: the outline in band k of stretch s (ROOF_XS[s - 1] .. ROOF_XS[s]; the first / last: to the car's ends). */
const ROOF_TOP: Float64Array = (() => {
  const n = ROOF_XS.length, T = new Float64Array((n + 1) * ROOF_BANDS);
  for (let s = 0; s <= n; s++) {
    const x = s === 0 ? ROOF_XS[0] - 0.5 : s === n ? ROOF_XS[n - 1] + 0.5 : (ROOF_XS[s - 1] + ROOF_XS[s]) / 2;
    for (let k = 0; k < ROOF_BANDS; k++) T[s * ROOF_BANDS + k] = roofTopAtPoint(x, (k + 0.5) * TRAIN_ROOF.step);
  }
  return T;
})();
/** The highest outline anywhere on the car: a line that stays above it needs no walk. */
const ROOF_MAX: number = ROOF_TOP.reduce((a, b) => Math.max(a, b), -Infinity);

/** The band of a distance from the centre line (the contract's own rounding: trainFixtures.ts roofBand). */
function bandOf(absZ: number): number {
  const k = Math.floor(absZ / TRAIN_ROOF.step + 1e-9);
  return k < 0 ? 0 : k >= ROOF_BANDS ? ROOF_BANDS - 1 : k;
}

/** The higher outline of bands k0 / k1 at station x (of both stretches when x is on a stretch's edge). */
function topAt(x: number, k0: number, k1: number): number {
  const n = ROOF_XS.length;
  let s = 0;
  while (s < n && ROOF_XS[s] < x - EDGE) s++;
  let top = Math.max(ROOF_TOP[s * ROOF_BANDS + k0], ROOF_TOP[s * ROOF_BANDS + k1]);
  if (s < n && ROOF_XS[s] < x + EDGE) { s++; top = Math.max(top, ROOF_TOP[s * ROOF_BANDS + k0], ROOF_TOP[s * ROOF_BANDS + k1]); }
  return top;
}

/** The highest outline at the plan point (x, z): on a rectangle's edge the higher side, on a corner the highest of the four. */
function topNear(x: number, z: number): number {
  const a = Math.abs(z);
  return topAt(x, bandOf(a - EDGE), bandOf(a + EDGE));
}

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
 * OWN HULL: the ray o + d t (unit d, 0 <= t <= maxT) never comes within `margin` of the car's roof outline (trainFixtures.ts
 * roofTopAtPoint at the station under it) while it is above the car's plan. False: the shot would go through the car's own roof (or
 * starts under it). EXACT, no sampling: the outline is constant inside each rectangle of the plan — a 2 cm band of |z| x a stretch
 * along the car (a hatch box, an end cap, the body between) — and the line is straight, so against each rectangle it is lowest where
 * it enters or leaves it. Tested: the two ends of its span over the car, every crossing of a band's edge (|z| = j x step, the hatch
 * boxes' sides among them) and of a stretch's edge (each hatch box's ends, the end caps), against the higher outline adjoining the
 * crossing. No allocation, a table read per crossing; at most ~160 crossings (a line right across the car), none for a line that
 * stays above the highest hatch.
 */
export function ownHullClear(o: V3, d: V3, maxT: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, margin: number = SENTRY.hullMargin): boolean {
  if (!planSpan(o, d, maxT, spec.length / 2, spec.width / 2 + ROOF_SIDE, SPAN)) return true;
  const t0 = SPAN[0], t1 = SPAN[1], y0 = o.y + d.y * t0, y1 = o.y + d.y * t1;
  if (Math.min(y0, y1) >= ROOF_MAX + margin) return true;
  if (y0 < topNear(o.x + d.x * t0, o.z + d.z * t0) + margin) return false;
  if (y1 < topNear(o.x + d.x * t1, o.z + d.z * t1) + margin) return false;
  if (Math.abs(d.z) > 1e-12) {
    // the bands' edges across the car (z = 0 is not one: the same band either side of the centre line)
    const step = TRAIN_ROOF.step, za = o.z + d.z * t0, zb = o.z + d.z * t1, j1 = Math.floor(Math.max(za, zb) / step);
    for (let j = Math.ceil(Math.min(za, zb) / step); j <= j1; j++) {
      if (j === 0) continue;
      const t = (j * step - o.z) / d.z, k = Math.min(j < 0 ? -j : j, ROOF_BANDS); // the edge between bands k - 1 and k
      if (o.y + d.y * t < topAt(o.x + d.x * t, k - 1, k < ROOF_BANDS ? k : k - 1) + margin) return false;
    }
  }
  if (Math.abs(d.x) > 1e-12) {
    // the stretches' edges along the car
    for (let i = 0; i < ROOF_XS.length; i++) {
      const x = ROOF_XS[i], t = (x - o.x) / d.x;
      if (t > t0 && t < t1 && o.y + d.y * t < topNear(x, o.z + d.z * t) + margin) return false;
    }
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
 * candidate — dead, ragdolled, dormant); candidates beyond `range` are never asked. `clear` is asked nearest first and answers true
 * (take it), false (refused after the costly world rays) or null (refused for free: the own roof / the elevation stops). At most
 * `maxChecks` costly refusals and `maxCands` candidates per pick — so a crowd pressed against the car (all refused for free) never
 * hides a clear target behind it. Equal distances keep the list order. No allocation.
 */
export function pickTarget<T>(
  cands: readonly T[], dist2: (c: T) => number, clear: (c: T) => boolean | null,
  range: number = SENTRY.range, maxChecks: number = SENTRY.maxChecks, maxCands: number = SENTRY.maxCandidates,
): T | null {
  const r2 = range * range;
  let lastD = -1, lastI = -1, checks = 0;
  for (let k = 0; k < maxCands && checks < maxChecks; k++) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const d = dist2(cands[i]);
      if (!(d <= r2)) continue;
      if (d < lastD || (d === lastD && i <= lastI)) continue; // already asked
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0) return null;
    const c = clear(cands[bi]);
    if (c) return cands[bi];
    if (c === false) checks++;
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
