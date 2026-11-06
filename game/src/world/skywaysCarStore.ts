// Task studio-skyways-level-20261106-054448 (lane CAR): the prize car's per-station LANE STORE (pure: save/validate.ts imports it).
// One record per station section memory (RunState.laneStore scopes it to the current station): where the car was left. Written at
// the section teardown (and whenever the player gets out / play pauses, so a save made in between is current); read at the station's
// build. Strict: exactly these keys, finite bounded numbers — a malformed record is rejected by the save validator and ignored by the
// runtime (the generator's spawn pose is used instead).

export const SKYWAYS_CAR_LANE = 'skyways.car';

export interface SkywaysCarRecord { v: 1; x: number; y: number; z: number; yaw: number; level: number }

/** Bounds (m / rad / storeys). */
export const CAR_RECORD_LIMITS = {pos: 1e5, y: 1e4, yaw: 8, levels: 64} as const;

const KEYS: readonly string[] = ['v', 'x', 'y', 'z', 'yaw', 'level'];
const finite = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Why a car record is malformed (null = fine). */
export function skywaysCarProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the car record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) return `unexpected car field '${k}'`;
  for (const k of KEYS) if (!(k in o)) return `missing car field '${k}'`;
  if (o.v !== 1) return 'unsupported car record version';
  if (!finite(o.x, CAR_RECORD_LIMITS.pos) || !finite(o.z, CAR_RECORD_LIMITS.pos)) return 'car position out of range';
  if (!finite(o.y, CAR_RECORD_LIMITS.y)) return 'car height out of range';
  if (!finite(o.yaw, CAR_RECORD_LIMITS.yaw)) return 'car heading out of range';
  if (!Number.isInteger(o.level) || (o.level as number) < 0 || (o.level as number) >= CAR_RECORD_LIMITS.levels) return 'car storey out of range';
  return null;
}

/** A fresh record (rounded to 0.1 mm; the yaw wrapped to (-PI, PI]). */
export function skywaysCarRecord(x: number, y: number, z: number, yaw: number, level: number): SkywaysCarRecord {
  let a = (yaw + Math.PI) % (Math.PI * 2);
  if (a <= 0) a += Math.PI * 2;
  return {v: 1, x: r4(x), y: r4(y), z: r4(z), yaw: r4(a - Math.PI), level: Math.max(0, Math.floor(level))};
}
