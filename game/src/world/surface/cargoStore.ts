// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): THE DISTRICT'S CARGO RECORD — lane 'surface.cargo' of a Surface
// Run district section (`${station}:surface`). Pure (no three.js / DOM): the save validator reads it.
//
//   {v: 1, seeded?: 1, secured?: [{point, unit}]}  |  {v: 2, seeded?: 1, depot?: number[], secured?: [{point, unit}]}
//  - `seeded`: the depot recoverables were put into this district's equipment lane ('train-equipment.here') — written in the SAME step
//    as those units, so a district is seeded exactly once: never refilled, never seeded again after a save / reload / re-entry.
//  - `depot` (version 2; task studio-surface-run-field-followup-20261116-211729-01, lane FIXES): the indices (in the layout's
//    recoverables list) the depot was seeded with under the ONE-train-upgrade rule (world/surface/cargoSeed.ts seedDepot; [] = none).
//    A version-1 record (a depot seeded before that rule: every recoverable) stays valid and is read as it is — the planning map then
//    counts the whole collection (cargoSeed.ts depotRecoverables); a record is written as version 2 only when it carries `depot`.
//  - `secured`: the train units secured to the truck's attachment points (world/trainEquipment.ts mode 'mount'): the point id and a
//    station-style unit record (its last world pose + storey, slots, display). These units are in NO other record (the station lane, the
//    train's): save/validate.ts checks their uids in the run's one equipment scope ("is in two places") and their stacks in the run's
//    item uid set.

import {equipmentProblem, copyEquipment, type EquipmentJSON} from '../../craft/equipment';
import type {MountedJSON} from '../trainEquipment';

export const SURFACE_CARGO_LANE = 'surface.cargo';

/** Input-safety bounds of the record (never truncation points: a record beyond one is invalid). */
export const SURFACE_CARGO_LIMITS = {secured: 16, pointChars: 48, depot: 16, depotIndex: 63} as const;

export interface SurfaceCargoJSON {
  v: 1 | 2;
  seeded?: 1;
  /** (v2, lane FIXES) The recoverables' indices the depot was seeded with (the one-upgrade rule). */
  depot?: number[];
  secured?: MountedJSON[];
}

const POINT = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

/** Why a cargo record is malformed (null = fine). Shapes, ranges, one unit per point and per uid; the stacks are the validator's. */
export function surfaceCargoProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the district cargo record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['v', 'seeded', 'depot', 'secured'].includes(k)) return `unexpected district cargo field '${k.slice(0, 24)}'`;
  if (o.v !== 1 && o.v !== 2) return 'unsupported district cargo version';
  if (o.seeded !== undefined && o.seeded !== 1) return 'district cargo seeded flag must be 1';
  // (lane FIXES) version 2 = a seeded depot's list; version 1 never carries one
  if (o.v === 1 && o.depot !== undefined) return 'a version 1 district cargo record has no depot list';
  if (o.v === 2) {
    if (o.seeded !== 1 || o.depot === undefined) return 'a version 2 district cargo record needs the seeded flag and the depot list';
    const L = SURFACE_CARGO_LIMITS;
    if (!Array.isArray(o.depot) || o.depot.length > L.depot) return `the seeded depot list must be a list of at most ${L.depot} indices`;
    const seen = new Set<number>();
    for (const i of o.depot as unknown[]) {
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i > L.depotIndex || seen.has(i)) return 'a seeded depot index must be a distinct integer 0..63';
      seen.add(i);
    }
  }
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
  const o = v as SurfaceCargoJSON, out: SurfaceCargoJSON = {v: o.v};
  if (o.seeded === 1) out.seeded = 1;
  if (o.v === 2 && o.depot) out.depot = [...o.depot]; // (lane FIXES)
  if (o.secured?.length) out.secured = o.secured.map(m => ({point: m.point, unit: copyEquipment(m.unit)}));
  return out;
}

/** The units of a record (copies). */
export function securedOf(v: unknown): MountedJSON[] {
  return surfaceCargoOf(v).secured ?? [];
}

/**
 * A record to write (undefined = nothing to keep: no lane). (lane FIXES) `depot`: a seeded depot's list under the one-upgrade rule (the
 * record is version 2 then); absent / null: version 1 as before (a depot seeded before that rule, or none seeded).
 */
export function surfaceCargoRecord(seeded: boolean, secured: readonly MountedJSON[], depot?: readonly number[] | null): SurfaceCargoJSON | undefined {
  if (!seeded && !secured.length) return undefined;
  const out: SurfaceCargoJSON = {v: seeded && depot ? 2 : 1};
  if (seeded) out.seeded = 1;
  if (seeded && depot) out.depot = [...depot];
  // (never more than the bound: cargo.ts offers at most SURFACE_CARGO_LIMITS.secured points, one unit each)
  if (secured.length) out.secured = secured.map(m => ({point: m.point, unit: copyEquipment(m.unit)}));
  return out;
}
