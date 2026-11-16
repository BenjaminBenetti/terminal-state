// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the truck's LANE STORE (pure: save/validate.ts imports it).
//
// One record per district section memory (the lane store is scoped to the section: the district is `${station}:surface`): where the
// truck was left, its lamps, and its storage compartments' slots (StackJSON with their uids: the Lockbox format; save/validate.ts checks
// every stack strictly, their uids in the run-wide uid set). Written at the section teardown, whenever the player gets out and when play
// pauses (so a save made in between is current); read at the district's build — once saved, the record wins over the generated pose.
// Strict: exactly these keys, finite bounded numbers; a malformed record is rejected by the save validator and ignored by the runtime.
// No fuel, wear or damage: the truck has no condition to keep (user: no fuel / maintenance simulation).

import type {StackJSON} from '../../items/inventory';
import {TRUCK_ANCHORS} from './truckAnchors.generated';

export const SURFACE_TRUCK_LANE = 'surface.truck';

/** The storage compartments (the cook's measured boxes): id, name, slot count — finite (ordinary inventory slots). */
export const TRUCK_COMPARTMENTS: readonly {id: string; name: string; slots: number}[] = TRUCK_ANCHORS.storage.map(s => ({id: s.id, name: s.name, slots: s.slots}));

export type TruckStorageJSON = (StackJSON | null)[][];

export interface SurfaceTruckRecord { v: 1; x: number; y: number; z: number; yaw: number; level: number; lights: boolean; storage: TruckStorageJSON }

/** Bounds (m / rad / storeys). */
export const TRUCK_RECORD_LIMITS = {pos: 1e5, y: 1e4, yaw: 8, levels: 64} as const;

const KEYS: readonly string[] = ['v', 'x', 'y', 'z', 'yaw', 'level', 'lights', 'storage'];
const finite = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Why a truck record is malformed (null = fine). The compartments' stacks themselves are checked by save/validate.ts. */
export function surfaceTruckProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the truck record must be an object';
  const o = v as Record<string, unknown>;
  if (o.v !== 1) return 'unsupported truck record version';
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) return `unexpected truck field '${k}'`;
  for (const k of KEYS) if (!(k in o)) return `missing truck field '${k}'`;
  if (!finite(o.x, TRUCK_RECORD_LIMITS.pos) || !finite(o.z, TRUCK_RECORD_LIMITS.pos)) return 'truck position out of range';
  if (!finite(o.y, TRUCK_RECORD_LIMITS.y)) return 'truck height out of range';
  if (!finite(o.yaw, TRUCK_RECORD_LIMITS.yaw)) return 'truck heading out of range';
  if (!Number.isInteger(o.level) || (o.level as number) < 0 || (o.level as number) >= TRUCK_RECORD_LIMITS.levels) return 'truck storey out of range';
  if (typeof o.lights !== 'boolean') return 'truck lights must be on or off';
  if (!Array.isArray(o.storage) || o.storage.length !== TRUCK_COMPARTMENTS.length) return `the truck storage must list ${TRUCK_COMPARTMENTS.length} compartments`;
  for (let i = 0; i < TRUCK_COMPARTMENTS.length; i++) {
    const c = o.storage[i] as unknown;
    if (!Array.isArray(c) || c.length !== TRUCK_COMPARTMENTS[i].slots) return `the truck ${TRUCK_COMPARTMENTS[i].id} must list ${TRUCK_COMPARTMENTS[i].slots} slots`;
    for (const s of c) if (s !== null && (typeof s !== 'object' || Array.isArray(s))) return `a malformed truck ${TRUCK_COMPARTMENTS[i].id} slot`;
  }
  return null;
}

/** Empty compartments. */
export const emptyTruckStorage = (): TruckStorageJSON => TRUCK_COMPARTMENTS.map(c => new Array<StackJSON | null>(c.slots).fill(null));

/** A fresh record (rounded to 0.1 mm; the yaw wrapped to (-PI, PI]); lamps off / empty compartments unless given (stacks deep-copied). */
export function surfaceTruckRecord(x: number, y: number, z: number, yaw: number, level: number, o: {lights?: boolean; storage?: readonly (readonly (StackJSON | null)[])[]} = {}): SurfaceTruckRecord {
  let a = (yaw + Math.PI) % (Math.PI * 2);
  if (a <= 0) a += Math.PI * 2;
  const storage = emptyTruckStorage();
  if (o.storage) storage.forEach((c, i) => { for (let k = 0; k < c.length; k++) c[k] = o.storage![i]?.[k] ? structuredClone(o.storage![i][k]) as StackJSON : null; });
  return {v: 1, x: r4(x), y: r4(y), z: r4(z), yaw: r4(a - Math.PI), level: Math.max(0, Math.floor(level)), lights: !!o.lights, storage};
}
