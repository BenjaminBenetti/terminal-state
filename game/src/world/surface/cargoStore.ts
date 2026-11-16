// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): THE DISTRICT'S CARGO RECORD — lane 'surface.cargo' of a Surface
// Run district section (`${station}:surface`). Pure (no three.js / DOM): the save validator reads it.
//
//   {v: 1, seeded?: 1, secured?: [{point, unit}]}
//  - `seeded`: the depot recoverables were put into this district's equipment lane ('train-equipment.here') — written in the SAME step
//    as those units, so a district is seeded exactly once: never refilled, never seeded again after a save / reload / re-entry.
//  - `secured`: the train units secured to the truck's attachment points (world/trainEquipment.ts mode 'mount'): the point id and a
//    station-style unit record (its last world pose + storey, slots, display). These units are in NO other record (the station lane, the
//    train's): save/validate.ts checks their uids in the run's one equipment scope ("is in two places") and their stacks in the run's
//    item uid set.

import {equipmentProblem, copyEquipment, type EquipmentJSON} from '../../craft/equipment';
import type {MountedJSON} from '../trainEquipment';

export const SURFACE_CARGO_LANE = 'surface.cargo';

/** Input-safety bounds of the record (never truncation points: a record beyond one is invalid). */
export const SURFACE_CARGO_LIMITS = {secured: 16, pointChars: 48} as const;

export interface SurfaceCargoJSON {
  v: 1;
  seeded?: 1;
  secured?: MountedJSON[];
}

const POINT = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

/** Why a cargo record is malformed (null = fine). Shapes, ranges, one unit per point and per uid; the stacks are the validator's. */
export function surfaceCargoProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the district cargo record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['v', 'seeded', 'secured'].includes(k)) return `unexpected district cargo field '${k.slice(0, 24)}'`;
  if (o.v !== 1) return 'unsupported district cargo version';
  if (o.seeded !== undefined && o.seeded !== 1) return 'district cargo seeded flag must be 1';
  if (o.secured === undefined) return null;
  const L = SURFACE_CARGO_LIMITS;
  if (!Array.isArray(o.secured) || o.secured.length > L.secured) return `the secured cargo must be a list of at most ${L.secured} units`;
  const points = new Set<string>(), uids = new Set<string>();
  for (const m of o.secured as unknown[]) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return 'a secured cargo entry must be an object';
    const e = m as Record<string, unknown>;
    for (const k of Object.keys(e)) if (k !== 'point' && k !== 'unit') return `unexpected secured cargo field '${k.slice(0, 24)}'`;
    if (typeof e.point !== 'string' || e.point.length > L.pointChars || !POINT.test(e.point)) return 'a secured cargo entry needs its attachment point';
    if (points.has(e.point)) return `two units on attachment point ${e.point}`;
    points.add(e.point);
    const p = equipmentProblem(e.unit, true);
    if (p) return p;
    const uid = (e.unit as EquipmentJSON).uid;
    if (uids.has(uid)) return `duplicate equipment unit ${uid}`;
    uids.add(uid);
  }
  return null;
}

/** The record of a lane value (a missing / malformed one: none — never invented cargo). */
export function surfaceCargoOf(v: unknown): SurfaceCargoJSON {
  if (v === undefined || surfaceCargoProblem(v) !== null) return {v: 1};
  const o = v as SurfaceCargoJSON, out: SurfaceCargoJSON = {v: 1};
  if (o.seeded === 1) out.seeded = 1;
  if (o.secured?.length) out.secured = o.secured.map(m => ({point: m.point, unit: copyEquipment(m.unit)}));
  return out;
}

/** The units of a record (copies). */
export function securedOf(v: unknown): MountedJSON[] {
  return surfaceCargoOf(v).secured ?? [];
}

/** A record to write (undefined = nothing to keep: no lane). */
export function surfaceCargoRecord(seeded: boolean, secured: readonly MountedJSON[]): SurfaceCargoJSON | undefined {
  if (!seeded && !secured.length) return undefined;
  const out: SurfaceCargoJSON = {v: 1};
  if (seeded) out.seeded = 1;
  // (never more than the bound: cargo.ts offers at most SURFACE_CARGO_LIMITS.secured points, one unit each)
  if (secured.length) out.secured = secured.map(m => ({point: m.point, unit: copyEquipment(m.unit)}));
  return out;
}
