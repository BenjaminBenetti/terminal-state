// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the truck's LANE STORE (pure: save/validate.ts imports it).
//
// One record per district section memory (the lane store is scoped to the section: the district is `${station}:surface`): where the
// truck was left, its lamps, and its storage compartments' slots (StackJSON with their uids: the Lockbox format; save/validate.ts checks
// every stack strictly, their uids in the run-wide uid set). Written at the section teardown, whenever the player gets out and when play
// pauses (so a save made in between is current); read at the district's build — once saved, the record wins over the generated pose.
// Strict: exactly these keys, finite bounded numbers; a malformed record is rejected by the save validator and ignored by the runtime.
// No fuel or maintenance simulation (user).
//
// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): record v2 adds the truck's CONDITION (finite 0..1: 1 = sound,
// 0 = broken down; world/surface/truckCondition.ts derives the smoke / fire / mobility / disabled states from it, so a burning truck burns
// again after a reload). A v1 record (an older save) is still valid and upgrades ONCE (upgradeTruckRecord): condition 1 — everything
// else exactly as stored; it is written back as v2.

import type {StackJSON} from '../../items/inventory';
import {TRUCK_ANCHORS} from './truckAnchors.generated';

export const SURFACE_TRUCK_LANE = 'surface.truck';

/** The storage compartments (the cook's measured boxes): id, name, slot count — finite (ordinary inventory slots). */
export const TRUCK_COMPARTMENTS: readonly {id: string; name: string; slots: number}[] = TRUCK_ANCHORS.storage.map(s => ({id: s.id, name: s.name, slots: s.slots}));

export type TruckStorageJSON = (StackJSON | null)[][];

export interface SurfaceTruckRecordV1 { v: 1; x: number; y: number; z: number; yaw: number; level: number; lights: boolean; storage: TruckStorageJSON }
export interface SurfaceTruckRecord { v: 2; x: number; y: number; z: number; yaw: number; level: number; lights: boolean; storage: TruckStorageJSON; condition: number }

/** Bounds (m / rad / storeys). */
export const TRUCK_RECORD_LIMITS = {pos: 1e5, y: 1e4, yaw: 8, levels: 64} as const;

const KEYS_V1: readonly string[] = ['v', 'x', 'y', 'z', 'yaw', 'level', 'lights', 'storage'];
const KEYS_V2: readonly string[] = [...KEYS_V1, 'condition'];
const finite = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
/** (v2) A condition as stored: clamped to 0..1, 1e-4 steps (a non-finite value: 1, sound). */
export const truckConditionValue = (c: number): number => (Number.isFinite(c) ? r4(Math.max(0, Math.min(1, c))) : 1);

/** Why a truck record is malformed (null = fine). v1 or v2; the compartments' stacks themselves are checked by save/validate.ts. */
export function surfaceTruckProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the truck record must be an object';
  const o = v as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2) return 'unsupported truck record version';
  const keys = o.v === 1 ? KEYS_V1 : KEYS_V2;
  for (const k of Object.keys(o)) if (!keys.includes(k)) return `unexpected truck field '${k}'`;
  for (const k of keys) if (!(k in o)) return `missing truck field '${k}'`;
  if (o.v === 2 && (typeof o.condition !== 'number' || !Number.isFinite(o.condition) || o.condition < 0 || o.condition > 1)) return 'truck condition out of range';
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

/** A valid record as v2 (a v1 record: condition 1 — sound — once; everything else as stored; it is written back as v2). */
export function upgradeTruckRecord(r: SurfaceTruckRecordV1 | SurfaceTruckRecord): SurfaceTruckRecord {
  if (r.v === 2) return r;
  return {...r, v: 2, condition: 1};
}

/**
 * A fresh record (rounded to 0.1 mm; the yaw wrapped to (-PI, PI]); lamps off / empty compartments / condition 1 (sound) unless given
 * (stacks deep-copied; the condition clamped to 0..1 in 1e-4 steps).
 */
export function surfaceTruckRecord(x: number, y: number, z: number, yaw: number, level: number, o: {lights?: boolean; storage?: readonly (readonly (StackJSON | null)[])[]; condition?: number} = {}): SurfaceTruckRecord {
  let a = (yaw + Math.PI) % (Math.PI * 2);
  if (a <= 0) a += Math.PI * 2;
  const storage = emptyTruckStorage();
  if (o.storage) storage.forEach((c, i) => { for (let k = 0; k < c.length; k++) c[k] = o.storage![i]?.[k] ? structuredClone(o.storage![i][k]) as StackJSON : null; });
  return {v: 2, x: r4(x), y: r4(y), z: r4(z), yaw: r4(a - Math.PI), level: Math.max(0, Math.floor(level)), lights: !!o.lights, storage, condition: truckConditionValue(o.condition ?? 1)};
}
