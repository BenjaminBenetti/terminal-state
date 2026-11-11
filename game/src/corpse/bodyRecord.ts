// Task studio-corpse-chipper-fuel-20261110-235304-01 (user: carry real dead undead bodies one at a time to the train's woodchipper for
// emergency fuel): the BODY RECORD — one real dead body that left the enemy that died (a carried, dropped, aboard or in-hopper body). Pure
// (no three.js / DOM). The live truth is the corpse system (world/corpses.ts); records are what a save, a station lane, the train's
// cargo and the chipper's job keep.
//
// IDENTITY: '<section id>#<layout enemy index>' of the enemy it was (levels/types.ts sectionId + Game.enemyIndex; the same shape as a
// carried prop's id, run/trainCargo.ts PROP_ID_RE). An index dies at most once per timeline (killed enemies never respawn; Retry rolls the
// death back with everything else), so the id names one death. A body lives in exactly ONE place: the player's hands, a station's lane,
// the train's cargo or the chipper's job; a body the chipper finished exists nowhere.
//
// LOOK: the inputs the enemy's model was built from (its archetype, the source layout's seed and the spawn's type / look), so the same
// body is rebuilt at any station. POSE: a known resting pose (`pose`) at an object-frame position + orientation: world + storey in a
// station, train-local aboard. Bodies are never conjured from old kill lists (those have no pose): only enemies killed with this feature
// present become bodies.

import type {EnemyArchetypeId} from '../ai/creatureSpawn';
import type {SpawnLook, ZombieType} from '../gen/stationTypes';

/** Bounds of the body records (input safety of the save format, never truncation points: a departure / drop is refused instead). */
export const BODIES = {
  /** Bodies lying in one station (its lane STATION_BODIES_LANE `here`). */
  stationHere: 256,
  /** Bodies lying in the train (train cargo `bodies`): more refuses the departure, nothing is cut. */
  maxAboard: 64,
  /** Train-local / world coordinate bounds (m). */
  pos: 40, world: 1e5,
  /** Task corpse-chipper (lane CORPSE): the body's uniform size factor bounds (EnemyActor.scale; input safety). */
  scaleMin: 0.5, scaleMax: 2,
} as const;

/** The resting poses a body record can name (the corpse system owns their shapes). */
export const BODY_POSES = ['lying'] as const;
export type BodyPose = typeof BODY_POSES[number];

export const BODY_TYPES: readonly ZombieType[] = ['shambler', 'coated'];
export const BODY_LOOKS: readonly SpawnLook[] = ['lingerie', 'cosplay'];

export interface BodyRecordJSON {
  /** '<section id>#<layout enemy index>'. Never changes. */
  id: string;
  /** The enemy archetype it was (an ENEMY_ARCHETYPES key whose corpse trait is feedable). */
  arch: EnemyArchetypeId;
  /** Look inputs: the source layout's seed, the spawn's type and store-local look (absent = the ordinary pool). */
  seed: number;
  type: ZombieType;
  look?: SpawnLook;
  pose: BodyPose;
  /** Object-frame position (bottom centre) + orientation (unit quaternion x, y, z, w). */
  x: number; y: number; z: number;
  q: [number, number, number, number];
  /** Storey (station records only). */
  level?: number;
  /**
   * Task corpse-chipper (lane CORPSE): the body's uniform size factor (EnemyActor.scale: its root scale, drawn once from the spawn's
   * stream) — a rebuilt body keeps the exact size it died with. Absent = 1.
   */
  scale?: number;
  /**
   * The spawn's body variant (ZombieSpawn.variant: a family with several approved bodies, e.g. the Screacher's sc01..sc04 —
   * ENEMY_ARCHETYPES[arch].variantModels): a rebuilt body is the same body. Absent = the family's only / default body.
   */
  variant?: string;
}

/** A body variant id (the archetype's own table decides which exist: an unknown one rebuilds as its default body). */
export const BODY_VARIANT_RE = /^[a-z0-9_-]{1,16}$/;

/** '<section id>#<layout enemy index>'. */
export const BODY_ID_RE = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{1,32}#\d{1,6}$/;
export const bodyId = (section: string, index: number): string => `${section}#${index}`;

const finite = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const BODY_KEYS = ['id', 'arch', 'seed', 'type', 'look', 'pose', 'x', 'y', 'z', 'q', 'level', 'scale', 'variant'];

/**
 * Why one body record is malformed (null = fine). `world`: a station record (world pose + storey); else train-local (aboard / a job).
 * `feedable`: the archetype check (ai/creatureArchetypes.ts corpseFeedable), injected so this module stays registry-free.
 */
export function bodyProblem(v: unknown, o: {world: boolean; feedable: (arch: string) => boolean}): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a body must be an object';
  const b = v as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!BODY_KEYS.includes(k)) return `unexpected body field '${k}'`;
  if (typeof b.id !== 'string' || !BODY_ID_RE.test(b.id)) return 'a body needs its identity';
  if (typeof b.arch !== 'string' || !o.feedable(b.arch)) return `body ${b.id} is not a carriable undead body`;
  if (typeof b.seed !== 'number' || !Number.isInteger(b.seed) || b.seed < 0 || b.seed > 0xffffffff) return `body ${b.id} needs its look seed`;
  if (!BODY_TYPES.includes(b.type as ZombieType)) return `body ${b.id} needs its type`;
  if (b.look !== undefined && !BODY_LOOKS.includes(b.look as SpawnLook)) return `body ${b.id} has an unknown look`;
  if (!BODY_POSES.includes(b.pose as BodyPose)) return `body ${b.id} needs a known pose`;
  const lim = o.world ? BODIES.world : BODIES.pos;
  for (const k of ['x', 'y', 'z']) if (!finite(b[k], lim)) return `body ${b.id} ${k} out of range`;
  const q = b.q;
  if (!Array.isArray(q) || q.length !== 4 || !q.every(x => finite(x, 1.0001))) return `body ${b.id} orientation must be a quaternion`;
  if (Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1) > 1e-3) return `body ${b.id} orientation must be a unit quaternion`;
  if (o.world) { if (typeof b.level !== 'number' || !Number.isInteger(b.level) || b.level < 0 || b.level > 64) return `body ${b.id} needs its storey`; }
  else if (b.level !== undefined) return `body ${b.id} aboard has no storey`;
  if (b.variant !== undefined && (typeof b.variant !== 'string' || !BODY_VARIANT_RE.test(b.variant))) return `body ${b.id} has a malformed body variant`;
  if (b.scale !== undefined && (typeof b.scale !== 'number' || !Number.isFinite(b.scale) || b.scale < BODIES.scaleMin || b.scale > BODIES.scaleMax)) return `body ${b.id} size out of range`;
  return null;
}

/** Why a list of body records is malformed (null = fine). Identities are unique (`ids`: shared across lists — one body, one place). */
export function bodiesProblem(v: unknown, o: {world: boolean; max: number; feedable: (arch: string) => boolean; ids?: Set<string>}): string | null {
  if (!Array.isArray(v) || v.length > o.max) return `at most ${o.max} bodies`;
  const ids = o.ids ?? new Set<string>();
  for (const b of v) {
    const p = bodyProblem(b, o);
    if (p) return p;
    const id = (b as BodyRecordJSON).id;
    if (ids.has(id)) return `body ${id} is listed twice`;
    ids.add(id);
  }
  return null;
}

export const copyBody = (b: BodyRecordJSON): BodyRecordJSON => ({...b, q: [b.q[0], b.q[1], b.q[2], b.q[3]]});
