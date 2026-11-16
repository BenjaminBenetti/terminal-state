// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): THE TRUCK'S CONDITION — the pure rules (no three.js / DOM).
//
// User: "Add persistent truck condition: progressively physical smoke, eventually fire, progressively worse mobility, finally disabled.
// Keep lockers, secured cargo, item UIDs/contents/condition and truck pose exact; no cargo deletion, free respawn/heal on reentry or new
// fuel simulation. Exit must still work when disabled."
//
// ONE NUMBER: `condition` (0..1; 1 = sound, 0 = broken down) kept in the truck's record (world/surface/truckStore.ts v2) — read at the
// district's build, written with the pose (teardown, getting out, play pausing), so it survives teardown / rebuild / crossing / save /
// Continue / Retry exactly like the pose (Retry restores the station-entry snapshot, as for every lane). Never healed by a re-entry: only
// a repair (world/surface/truckRepair.ts: 5 scrap metal) restores it. Everything else is DERIVED from it, so a reload shows the same state:
//  - below TRUCK_CONDITION.smoke the engine smokes (grey, thickening and darkening toward `heavy`), below `fire` it BURNS (and the fire
//    eats the rest at burnPerS while the district is live), at 0 it is BROKEN DOWN — and keeps burning until repaired;
//  - mobility (truckMobility): from `full` down, the top speed and the pull fall toward speedMin / accelMin; over the reduced cap the drive
//    is cut and the truck labours down at `labour` (no speed snap); broken down: no drive at all and the brakes on (it rolls to rest from
//    top speed in ~8 m) — so the driver can always get out (the controller's exitSpeed rule) and steer while it stops.
// What lowers it: an enemy's hit on the SEATED truck (the closed cab takes the claw instead of the driver: Game.hurtPlayer ->
// world/surface/truckConditionRuntime.ts shieldTruckHit; a blast / a survivor's round likewise), the fog pressure
// (world/surface/truckPressure.ts) and the engine fire. Nothing here touches the compartments, the secured cargo or the pose.
//
// The vehicle controller asks the truck's definition for the geometry to step each frame (VehicleDef.tune -> tuneTruck): a sound truck
// (condition >= full) steps EXACTLY its own TRUCK_GEOM; a worn one a reused copy with scaled numbers (no allocation per frame).

import type {CarControls, CarGeom, CarPhys} from '../skywaysCarPhysics';
import {TRUCK_GEOM, TRUCK_PHYS} from './truckSpec';

export const TRUCK_CONDITION = {
  /** Below these: the engine smokes (light grey), smokes heavily (dark), burns. 0 = broken down. */
  smoke: 0.75,
  heavy: 0.5,
  fire: 0.25,
  /** An enemy's claw / pounce on the seated truck: its raw attack damage x this (a shambler's 10 -> 0.006: ~165 hits, sound to broken). */
  perHitPoint: 0.0006,
  /** A blast / a survivor's round reaching the closed cab: its damage x this. */
  perBlastPoint: 0.0006,
  /** A burning truck loses this per second while its district is live (from `fire` to broken down in 100 s). */
  burnPerS: 0.0025,
  /** Mobility: full at or above `full`; below it the top speed / pull fall linearly to speedMin / accelMin (x the truck's own) at 0+. */
  full: 0.75,
  speedMin: 0.35,
  accelMin: 0.4,
  /** Over the reduced speed cap the drive is cut and the truck slows at this (m/s²): it labours down, never a speed snap. */
  labour: 2.5,
  /** Refusal notes (a broken-down truck's pedal) at most every this (s). */
  noteEvery: 3,
} as const;

export const TRUCK_CONDITION_TEXT = {
  smoking: 'The truck\'s engine is smoking',
  burning: 'The truck\'s engine is on fire!',
  disabled: 'The truck has broken down — it needs a repair (5 scrap metal)',
  dead: 'The truck has broken down — get out and repair it (5 scrap metal)',
} as const;

export type TruckStage = 'sound' | 'smoking' | 'heavy' | 'burning' | 'disabled';

/** The visible / mechanical stage of a condition (see the header). */
export function truckStage(c: number): TruckStage {
  const T = TRUCK_CONDITION;
  if (!(c > 0)) return 'disabled';
  if (c < T.fire) return 'burning';
  if (c < T.heavy) return 'heavy';
  if (c < T.smoke) return 'smoking';
  return 'sound';
}

/** The engine burns (also when broken down: until repaired). */
export const truckBurning = (c: number): boolean => c < TRUCK_CONDITION.fire;
/** Broken down: no drive. */
export const truckDisabled = (c: number): boolean => !(c > 0);

/** The smoke's strength 0..1 (0 at `smoke` and above, 1 at 0). */
export function truckSmokeLevel(c: number): number {
  const s = TRUCK_CONDITION.smoke;
  return c >= s ? 0 : Math.min(1, (s - Math.max(0, c)) / s);
}

/** The fire's strength 0..1 (0 at `fire` and above; it catches at 0.35 and grows to 1 at 0). */
export function truckFireLevel(c: number): number {
  const f = TRUCK_CONDITION.fire;
  return c >= f ? 0 : 0.35 + 0.65 * Math.min(1, (f - Math.max(0, c)) / f);
}

/** Mobility factors of a condition (x the truck's top speed / pull): 1 at `full` and above, 0 broken down. */
export function truckMobility(c: number): {speed: number; accel: number} {
  const T = TRUCK_CONDITION;
  if (c >= T.full) return {speed: 1, accel: 1};
  if (!(c > 0)) return {speed: 0, accel: 0};
  const k = c / T.full;
  return {speed: T.speedMin + (1 - T.speedMin) * k, accel: T.accelMin + (1 - T.accelMin) * k};
}

type MutablePhys = {-readonly [K in keyof CarPhys]: number};

/** One truck's live condition state (per vehicle controller: the controller serves one truck at a time). */
export interface TruckConditionState {
  /** 0..1 (see the header). */
  condition: number;
  /** The reused physics copy / geometry a worn truck steps (rewritten each frame from TRUCK_PHYS). */
  readonly phys: MutablePhys;
  readonly geom: CarGeom;
  /** Seconds since the last refusal note. */
  noteT: number;
  /** QA / tests. */
  readonly counts: {hits: number; blasts: number; capped: number; refusedDrive: number; repairs: number};
}

const states = new WeakMap<object, TruckConditionState>();

/** The truck condition state of a vehicle controller (created sound on first use). */
export function truckStateOf(car: object): TruckConditionState {
  let s = states.get(car);
  if (!s) {
    const phys: MutablePhys = {...TRUCK_PHYS};
    s = {condition: 1, phys, geom: {...TRUCK_GEOM, phys}, noteT: TRUCK_CONDITION.noteEvery, counts: {hits: 0, blasts: 0, capped: 0, refusedDrive: 0, repairs: 0}};
    states.set(car, s);
  }
  return s;
}

/** A condition as kept (clamped 0..1; NaN: sound). */
export const clampCondition = (c: number): number => (Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 1);

/**
 * The vehicle controller's per-step hook for the truck (VehicleDef.tune; `v` = the body's speed now, `note` = the controller's toast):
 * the geometry to step with the condition's mobility, and the controls filtered — over the reduced cap the drive is cut (it labours
 * down), broken down no drive at all and the brakes on (the pedal noted, rate-limited). A truck at or above `full` steps TRUCK_GEOM
 * itself, its controls untouched.
 */
export function tuneTruck(st: TruckConditionState, ctl: CarControls, v: number, dt: number, note: (text: string) => void): CarGeom {
  const T = TRUCK_CONDITION, c = st.condition;
  st.noteT += Math.max(0, dt);
  if (c >= T.full) return TRUCK_GEOM;
  const B = TRUCK_PHYS, P = st.phys;
  Object.assign(P, B);
  if (!(c > 0)) {
    if ((ctl.forward || ctl.back) && st.noteT >= T.noteEvery) { st.noteT = 0; st.counts.refusedDrive++; note(TRUCK_CONDITION_TEXT.dead); }
    ctl.forward = ctl.back = false;
    P.accel = P.reverseAccel = 0;
    P.roll = B.brake + B.roll; // (the brakes on: it rolls to rest)
    return st.geom;
  }
  const m = truckMobility(c), cap = B.forwardMax * m.speed, rcap = B.reverseMax * m.speed;
  P.accel = B.accel * m.accel;
  P.reverseAccel = B.reverseAccel * m.accel;
  // over the cap: the drive is cut and it labours down (the cap follows the speed down: never a snap); else the reduced cap holds it
  if (v > cap) { ctl.forward = false; P.forwardMax = v; P.roll = Math.max(B.roll, T.labour); st.counts.capped++; }
  else P.forwardMax = cap;
  if (-v > rcap) { ctl.back = false; P.reverseMax = -v; P.roll = Math.max(B.roll, T.labour); }
  else P.reverseMax = rcap;
  // the steering lock stays the truck's own at every speed (physics steerMax scales it by v / forwardMax: rescaled for the lower cap)
  P.steerHigh = B.steerLow + (B.steerHigh - B.steerLow) * (P.forwardMax / B.forwardMax);
  return st.geom;
}
