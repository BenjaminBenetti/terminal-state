// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): THE TRUCK'S RESPONSE TO THE FOG PRESSURE — the pure rules (no
// three.js / DOM). The field itself is lane FOG's (world/surface/fogPressure.ts fogPressureAt over `layout.surface.boundary`: 0 inside the
// clear district, 1 at FOG_PRESSURE.full, more beyond toward the geometry edge; a version-1 district has no boundary -> no pressure).
//
// User: "On the truck dash show a red blinking light and 'Fog Pressure'; escalating mechanical groans and truck damage get stronger deeper
// out. The truck must lose mobility and break down before reaching the geometry edge, even approaching at speed."
//  - DAMAGE (truckPressureLoss): STRAIN for every step OUT through the ramp — the cumulative strain pressureStrain(p) = q^shape of the
//    depth q = (p - warn) / (full - warn): going out from the warning line to FOG_PRESSURE.full costs a whole sound truck (condition 1 -> 0)
//    whatever the speed, and every step further out past it costs `beyond` per unit of q; any step OUT at or past `full` breaks it down
//    outright (whatever it had left: a truck repaired inside the ramp too) — so a truck is broken down AT THE LATEST on the frame it
//    reaches pressure `full` going out, and then rolls to rest with its brakes on (world/surface/truckCondition.ts). Coming back in strains
//    nothing (a truck repaired past the line can still be reversed back in). Plus WEAR while someone sits in it in the pressure
//    (wearPerS x q², beyondPerS past full): standing or creaking along deep in the fog keeps grinding it down. A parked, empty truck takes
//    no wear (its engine is off).
//  - STOPPING: the worst case is a truck entering the ramp at its top speed: broken down at pressure 1 at the latest, it stops within
//    TRUCK_PRESSURE_STOP_M of that line (truckStopBound: braking from TRUCK_PHYS.forwardMax at brake + roll, plus one 0.1 s frame of
//    travel) — lane FOG puts the geometry edge beyond it with margin (tests/surface-truck-pressure.test.ts measures it on the controller).
//  - THE DASH: a red lamp beside a "FOG PRESSURE" label (world/surface/truckPressureDash.ts) blinks from FOG_PRESSURE.warn, faster deeper
//    (blinkMin .. blinkMax Hz at full).
//  - GROANS: while seated in the pressure the truck's body groans (the existing steel-creak / pipe-clank takes, pitched down, louder deeper:
//    audio/sfx.ts truckGroan), every groanSlow .. groanFast s.

import {FOG_PRESSURE} from './fogPressure';
import {TRUCK_PHYS} from './truckSpec';

export const TRUCK_PRESSURE = {
  /** The strain curve's shape (q^shape: gentle at the ramp's start, steep near full) and the strain per unit of q past full. */
  shape: 1.5,
  beyond: 10,
  /** Seated wear (condition / s): wearPerS x min(q, 1)² inside the ramp, + beyondPerS past full. */
  wearPerS: 0.03,
  beyondPerS: 0.15,
  /** The dash lamp's blink (Hz) at the warning line .. at full and beyond. */
  blinkMin: 1.2,
  blinkMax: 4.5,
  /** Groans: one every groanSlow s at the warning line .. groanFast s at full; strength 0.3 .. 1. */
  groanSlow: 6,
  groanFast: 1.1,
  /** The "fog pressure" toast at most every this (s). */
  noteEvery: 20,
} as const;

export const TRUCK_PRESSURE_TEXT = {
  warn: 'Fog pressure — the truck is straining. Turn back',
} as const;

/** The depth into the pressure ramp: 0 at / inside the warning line, 1 at FOG_PRESSURE.full, more beyond. */
export function pressureDepth(p: number): number {
  const w = FOG_PRESSURE.warn, f = FOG_PRESSURE.full;
  return p > w ? (p - w) / (f - w) : 0;
}

/** The cumulative strain at pressure p (condition units: 0 at the warning line, exactly 1 at full, + beyond per unit of depth after). */
export function pressureStrain(p: number): number {
  const q = pressureDepth(p);
  if (!(q > 0)) return 0;
  return q <= 1 ? q ** TRUCK_PRESSURE.shape : 1 + (q - 1) * TRUCK_PRESSURE.beyond;
}

/**
 * The condition the pressure takes this frame: the strain of the step OUT from `from` to `to` (0 coming back in) + the seated wear
 * over dt at `to`.
 */
export function truckPressureLoss(from: number, to: number, seated: boolean, dt: number): number {
  let loss = Math.max(0, pressureStrain(to) - pressureStrain(from));
  // a step OUT at or past full breaks it down whatever it had left (a truck repaired inside the ramp included); in, it only wears
  if (to >= FOG_PRESSURE.full && to > from) loss = Math.max(loss, 1);
  if (seated && dt > 0) {
    const q = pressureDepth(to);
    if (q > 0) loss += dt * (TRUCK_PRESSURE.wearPerS * Math.min(1, q) ** 2 + (q > 1 ? TRUCK_PRESSURE.beyondPerS : 0));
  }
  return loss;
}

/** The dash lamp's blink frequency (Hz) at pressure p (0: not warning). */
export function dashBlinkHz(p: number): number {
  if (!(p >= FOG_PRESSURE.warn)) return 0;
  const q = Math.min(1, pressureDepth(p));
  return TRUCK_PRESSURE.blinkMin + (TRUCK_PRESSURE.blinkMax - TRUCK_PRESSURE.blinkMin) * q;
}

/** Seconds to the next groan and its strength 0..1 at pressure p (null: no groans here). */
export function groanAt(p: number): {every: number; strength: number} | null {
  if (!(p >= FOG_PRESSURE.warn)) return null;
  const q = Math.min(1, pressureDepth(p));
  return {every: TRUCK_PRESSURE.groanSlow + (TRUCK_PRESSURE.groanFast - TRUCK_PRESSURE.groanSlow) * q, strength: 0.3 + 0.7 * q};
}

/**
 * The analytic bound (m) from the pressure-1 line to standstill for a truck that reaches it at its top speed: one capped frame
 * (0.1 s) of travel before the breakdown is seen, then braking at brake + roll (+ drag, ignored: it only shortens it).
 */
export function truckStopBound(): number {
  const v = TRUCK_PHYS.forwardMax, a = TRUCK_PHYS.brake + TRUCK_PHYS.roll;
  return v * TRUCK_PHYS.maxDt + (v * v) / (2 * a);
}

/** (lane FOG's interface note) The worst-case metres from the pressure-1 line to the stopped truck (see truckStopBound). */
export const TRUCK_PRESSURE_STOP_M = Math.ceil(truckStopBound() * 10) / 10;
