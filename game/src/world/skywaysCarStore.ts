// Task studio-skyways-level-20261106-054448 (lane CAR): the prize car's per-station LANE STORE (pure: save/validate.ts imports it).
// One record per station section memory (RunState.laneStore scopes it to the current station): where the car was left. Written at
// the section teardown (and whenever the player gets out / play pauses, so a save made in between is current); read at the station's
// build. Strict: exactly these keys, finite bounded numbers — a malformed record is rejected by the save validator and ignored by the
// runtime (the generator's spawn pose is used instead).
//
// Task studio-beta-skyways-vehicle-20261107-054512-01: v2 adds the car's own state that stays with it at its station — `lights` (its
// lamps on / off) and `trunk` (TRUNK_SLOTS storage slots: StackJSON with their uids, the Lockbox format; save/validate.ts checks every
// stack strictly). A v1 record (an older save) is still valid and upgrades ONCE (upgradeCarRecord): lamps off, an EMPTY trunk.

import type {StackJSON} from '../items/inventory';

export const SKYWAYS_CAR_LANE = 'skyways.car';

/** The trunk's storage slots (ordinary inventory slots: the item's own stack size, a backpack whole with its contents). */
export const TRUNK_SLOTS = 16;

export interface SkywaysCarRecordV1 { v: 1; x: number; y: number; z: number; yaw: number; level: number }
export interface SkywaysCarRecord { v: 2; x: number; y: number; z: number; yaw: number; level: number; lights: boolean; trunk: (StackJSON | null)[] }

/** Bounds (m / rad / storeys). */
export const CAR_RECORD_LIMITS = {pos: 1e5, y: 1e4, yaw: 8, levels: 64} as const;

const KEYS_V1: readonly string[] = ['v', 'x', 'y', 'z', 'yaw', 'level'];
const KEYS_V2: readonly string[] = [...KEYS_V1, 'lights', 'trunk'];
const finite = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Why a car record is malformed (null = fine). v1 or v2; the trunk's stacks themselves are checked by save/validate.ts. */
export function skywaysCarProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the car record must be an object';
  const o = v as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2) return 'unsupported car record version';
  const keys = o.v === 1 ? KEYS_V1 : KEYS_V2;
  for (const k of Object.keys(o)) if (!keys.includes(k)) return `unexpected car field '${k}'`;
  for (const k of keys) if (!(k in o)) return `missing car field '${k}'`;
  if (!finite(o.x, CAR_RECORD_LIMITS.pos) || !finite(o.z, CAR_RECORD_LIMITS.pos)) return 'car position out of range';
  if (!finite(o.y, CAR_RECORD_LIMITS.y)) return 'car height out of range';
  if (!finite(o.yaw, CAR_RECORD_LIMITS.yaw)) return 'car heading out of range';
  if (!Number.isInteger(o.level) || (o.level as number) < 0 || (o.level as number) >= CAR_RECORD_LIMITS.levels) return 'car storey out of range';
  if (o.v === 2) {
    if (typeof o.lights !== 'boolean') return 'car lights must be on or off';
    if (!Array.isArray(o.trunk) || o.trunk.length !== TRUNK_SLOTS) return `the car trunk must list ${TRUNK_SLOTS} slots`;
    for (const s of o.trunk) if (s !== null && (typeof s !== 'object' || Array.isArray(s))) return 'a malformed car trunk slot';
  }
  return null;
}

/** An empty trunk. */
export const emptyTrunk = (): (StackJSON | null)[] => new Array(TRUNK_SLOTS).fill(null);

/** A valid record as v2 (a v1 record: lamps off, an EMPTY trunk — once; it is written back as v2). */
export function upgradeCarRecord(r: SkywaysCarRecordV1 | SkywaysCarRecord): SkywaysCarRecord {
  if (r.v === 2) return r;
  return {...r, v: 2, lights: false, trunk: emptyTrunk()};
}

/** A fresh record (rounded to 0.1 mm; the yaw wrapped to (-PI, PI]); lamps off / an empty trunk unless given. */
export function skywaysCarRecord(x: number, y: number, z: number, yaw: number, level: number, o: {lights?: boolean; trunk?: readonly (StackJSON | null)[]} = {}): SkywaysCarRecord {
  let a = (yaw + Math.PI) % (Math.PI * 2);
  if (a <= 0) a += Math.PI * 2;
  const trunk = emptyTrunk();
  if (o.trunk) for (let i = 0; i < TRUNK_SLOTS; i++) trunk[i] = o.trunk[i] ? structuredClone(o.trunk[i]) as StackJSON : null;
  return {v: 2, x: r4(x), y: r4(y), z: r4(z), yaw: r4(a - Math.PI), level: Math.max(0, Math.floor(level)), lights: !!o.lights, trunk};
}
