// Task enemy-spawn-tables-20261030 (lane SPAWN): per-logical-level ENEMY SPAWN PROFILES — the single source-backed data / API that
// the REAL generators read (pure data + pure resolution functions; no three.js). Guide: docs/enemy-spawns.md.
//
// One profile per LevelId (levels/registry.ts; Record<LevelId, …> makes a new level fail to typecheck until it has one). A profile
// holds the controls that used to be literals inside the generators, moved VERBATIM (same values, same draw order):
//  - `contexts`: the count rule + placement rules of every generation context the level's generator runs —
//      Subway (gen/station.ts → gen/stationDress.ts placeSpawns): 'station';
//      Office Space (gen/office/index.ts → gen/office/spawns.ts placeOfficeEnemies), ONE logical level: 'street' (station +
//      lobby, once), 'floor' (once per office floor 2..8), 'roof' (once). No per-floor reroll of the level.
//  - `levelMoves`: the Subway's storey moves after placement (gen/levelGenDress.ts placeLevelSpawns);
//  - `families`: the enemy family pool [family, weight] (an independent per-spawn roll REPLACES a zombie: ai/creatureSpawn.ts);
//  - `zombieTypes`: the shambler / coated type roll of every spawn (+ at least one of each). Appearance (wardrobe outfits,
//    ai/wardrobe.ts pickZombieLook) is a zombie sub-distribution chosen at spawn time — NOT a family;
//  - `rooms`: ROOM MODIFIERS per room key and family. Shipped: none (every room resolves to exactly 1).
//
// ROOM MODIFIER SEMANTICS (exact; tests/enemy-spawn-tables.test.ts demonstrates 0 and 2 with test-only profiles):
//  - Room key of an area: its purpose id (gen/purposes.ts) when it has one, else its room type (gen/stationTypes.ts RoomType).
//    Each field resolves purpose entry → room-type entry → 1 (missing = neutral). Family key 'all' carries a density that
//    multiplies every family's density in that room.
//  - p_f = the level pool weight of family f; w_f = its `weight` modifier in the room; d_f = its `density` modifier × 'all'.density.
//  - DENSITY (local intensity): the room's baseline AREA WEIGHT (the weighted area order of the placement) is multiplied by the
//    room intensity D = all.density × Σ_f p_f·w_f·d_f / Σ_f p_f·w_f (the mix-weighted mean family density), and the family mix of
//    spawns in the room by d_f. To first order family f's expected share of the context's spawns landing in the room scales by d_f
//    while the other families' stays put. It NEVER changes the count roll (the level / context total) and NEVER raises a cap:
//    caps, spacing, tries and eligibility still bound the room. D = 0 → the room is never chosen (its cells are not candidates).
//    D = 2 → the room is chosen earlier in every cap pass (more spawns there, fewer elsewhere, same total).
//  - WEIGHT (conditional composition): multiplies p_f for spawns that land in the room — the conditional chance a spawn there is
//    family f = p_f·w_f·d_f / Σ. It changes WHICH family a spawn becomes, never how many spawns the room attracts (D is unchanged
//    by weights alone). 0 → that family never spawns there; 2 → twice its relative odds there (before normalisation).
//  - A room with no entry takes the shipped path untouched (the same area weight number, the same pool array). Even an explicit
//    entry of 1 is bit-identical: x·1 === x and Σ/Σ === 1 exactly in IEEE doubles, so the RNG draws are identical too.
//  - Weight modifiers never touch an RNG stream (the family roll is a hash of (level seed, spawn index)). A density modifier
//    changes placement draws: on the Subway the storey moves of loose floor supplies follow on the SAME stream as the storey
//    moves of enemies (placeLevelSpawns), so those moved supplies may land on other cells (same items / counts / pools).

import type {Area, AreaKind, RoomType, ZombieType} from '../gen/stationTypes';
import {MIN_ZOMBIE_SPAWN_CELLS} from '../gen/stationTypes';
import type {LevelId} from '../levels/types';
import {ROOM_LABEL} from '../gen/stationKit';
import {ALL_PURPOSES} from '../gen/purposes';

// ---------------------------------------------------------------------------------------------------------------------------
// Families

/** Enemy families (= the archetype registry ai/creatureArchetypes.ts ENEMY_ARCHETYPES; tests check they agree). */
export type EnemyFamilyId = 'zombie' | 'ratdog';
export const ENEMY_FAMILY_IDS: readonly EnemyFamilyId[] = ['zombie', 'ratdog'];
/** Room-modifier family key that applies its density to every family of the room. */
export const ALL_FAMILIES = 'all';

/** A family pool: [family, relative weight] in roll order (the pick walks it in this order). */
export type FamilyPool = readonly (readonly [EnemyFamilyId, number])[];

/**
 * Relative spawn weight of each family at ANY spawn point (iteration 07 Lane Q, moved from ai/creatureSpawn.ts). The user asked
 * for the field-notes rat/dog to be about 5 % of the enemies. Both shipped levels use this pool.
 */
export const ENEMY_POOL: FamilyPool = [['zombie', 0.95], ['ratdog', 0.05]];

/**
 * Iteration 12 (AI lane, mandate F "More enemies. Double the number of enemies."): enemy spawn points per station (moved from
 * ai/creatureSpawn.ts). Before iteration 12 (d632ce8) placeSpawns drew rng.int(11, 16) — measured over a 78-station corpus (60
 * natural seeds + 3 per archetype): 1033 enemies, mean 13.24, 11..16, rat/dog 4.84 %, coated 38.8 % of zombies, levels main
 * 74.5 / upper 14.0 / lower 11.4 %. Now the same single draw over the doubled range.
 */
export const ENEMY_SPAWNS_BASELINE = {min: 11, max: 16, mean: 13.24} as const;
export const ENEMY_POPULATION_SCALE = 2;
export const ENEMY_SPAWNS = {min: ENEMY_SPAWNS_BASELINE.min * ENEMY_POPULATION_SCALE, max: ENEMY_SPAWNS_BASELINE.max * ENEMY_POPULATION_SCALE} as const;

// ---------------------------------------------------------------------------------------------------------------------------
// Rule shapes

/** Matches an area when ANY listed criterion matches (kind in `kind`, type in `type`, public space, storefront unit). */
export interface AreaMatch {
  readonly kind?: readonly AreaKind[];
  readonly type?: readonly RoomType[];
  readonly publicSpace?: true;
  readonly storefront?: true;
}
/** Baseline area weight: the FIRST matching rule wins, else `otherwise`. */
export interface AreaWeights {
  readonly rules: readonly {readonly when: AreaMatch; readonly weight: number; readonly why: string}[];
  readonly otherwise: number;
  readonly otherwiseWhy: string;
}
/** Per-area cap after pass k (k = the pass cap): first matching rule — `fixed` (absolute) or `plus` (pass cap + n); else the pass cap. */
export interface AreaCaps {
  readonly passes: readonly number[];
  readonly rules: readonly ({readonly when: AreaMatch; readonly why: string} & ({readonly fixed: number} | {readonly plus: number}))[];
}
export interface PlacementRules {
  readonly areaWeights: AreaWeights;
  readonly caps: AreaCaps;
  /** Random cell picks per area visit before the visit gives up. */
  readonly tries: number;
  /** Minimum straight-line distance (m) to every enemy already placed (Office: on the same storey). */
  readonly spacingM: number;
  /** Minimum walking distance (cells of 0.5 m) from the player start. */
  readonly startCells: number;
  /** The candidate cell and its 8 neighbours within this radius (cells) are walkable. */
  readonly clearCells: number;
  /** Office: straight-line keep-off (m) from the keep points (stair / elevator landings, roof hatch, ladder foot). */
  readonly landingKeepM?: number;
}
/** What the generator's validation accepts (else the whole attempt is regenerated): 'count' = the context's own count bound. */
export interface PlacedCheck {
  readonly min: number | 'count' | null;
  readonly max: number | 'count' | null;
}
export interface SpawnContextRule {
  readonly label: string;
  /** rng.int(lo, hi): ONE uniform integer draw per run = the spawns the run tries to place. */
  readonly count: readonly [number, number];
  readonly placement: PlacementRules;
  readonly accept: PlacedCheck;
}
/** Subway storey moves (gen/levelGenDress.ts placeLevelSpawns) — totals unchanged. */
export interface LevelMoveRules {
  readonly areaWeights: AreaWeights;
  /** Never move more than (placed − mainKeep). */
  readonly mainKeep: number;
  readonly passes: number;
  readonly tries: number;
  readonly spacingM: number;
  /** Spacing applies only between enemies within this height difference (m). */
  readonly spacingDy: number;
  readonly startCells: number;
}
export interface ZombieTypeRule {
  /** Per spawn: rng.chance(coatedChance) → 'coated', else 'shambler'. */
  readonly coatedChance: number;
  /** Then: no coated → index 0 becomes coated; no shambler (and count > 1) → index 1 becomes shambler. */
  readonly atLeastOneEach: boolean;
}
export interface FamilyRoomModifier {
  readonly density?: number;
  readonly weight?: number;
}
/** Per family (or 'all': density only) of one room key. */
export type RoomModifier = Readonly<Partial<Record<EnemyFamilyId | typeof ALL_FAMILIES, FamilyRoomModifier>>>;
/** Room key (purpose id, else room type) → modifier. Missing = 1. */
export type RoomModifiers = Readonly<Record<string, RoomModifier>>;

export type SpawnContextId = 'station' | 'street' | 'floor' | 'roof';
export const SPAWN_CONTEXT_IDS: readonly SpawnContextId[] = ['station', 'street', 'floor', 'roof'];

export interface SpawnProfile {
  /** The logical level (LevelId) a registered profile belongs to. */
  readonly id: string;
  readonly label: string;
  readonly families: FamilyPool;
  readonly zombieTypes: ZombieTypeRule;
  readonly contexts: Readonly<Partial<Record<SpawnContextId, SpawnContextRule>>>;
  readonly levelMoves?: LevelMoveRules;
  readonly rooms: RoomModifiers;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The baseline rules (moved verbatim from the generators)

/** Subway area weights (gen/stationDress.ts placeSpawns `weightOf`, identical to levelGenDress's `zombieWeight`). */
export const SUBWAY_AREA_WEIGHTS: AreaWeights = {
  rules: [
    {when: {kind: ['platform']}, weight: 2.2, why: 'platforms: the long public edges by the tracks'},
    {when: {type: ['exit-stair', 'washroom']}, weight: 0.5, why: 'closed street exits and washrooms: dead-end pockets'},
    {when: {type: ['eatery', 'shop']}, weight: 0.5, why: 'storefront units'},
    {when: {publicSpace: true}, weight: 1, why: 'other public halls, passages and concourses'},
    {when: {kind: ['closet']}, weight: 0.6, why: 'closets'},
  ],
  otherwise: 1.4,
  otherwiseWhy: 'back-of-house rooms and service corridors',
};
/** Subway caps (placeSpawns `limit`): passes 1 / 2 / 3; platforms one more; closets, exit stairs and storefront units one. */
export const SUBWAY_CAPS: AreaCaps = {
  passes: [1, 2, 3],
  rules: [
    {when: {kind: ['platform']}, plus: 1, why: 'platforms hold one more per pass'},
    {when: {kind: ['closet'], type: ['exit-stair'], storefront: true}, fixed: 1, why: 'closets, closed exits and storefront units: at most one'},
  ],
};
/** Office area weights (gen/office/spawns.ts `zombieWeight`): stairwells / stair cores / the elevator cab never. */
export const OFFICE_AREA_WEIGHTS: AreaWeights = {
  rules: [
    {when: {kind: ['platform']}, weight: 2.2, why: 'the platform of the station under the tower'},
    {when: {type: ['exit-stair', 'washroom']}, weight: 0.5, why: 'closed street exits and washrooms'},
    {when: {type: ['office-stair', 'stair-core', 'office-elevator']}, weight: 0, why: 'never in a stairwell, stair core or the elevator cab'},
    {when: {type: ['eatery', 'shop']}, weight: 0.5, why: 'storefront units'},
    {when: {kind: ['closet']}, weight: 0.5, why: 'closets'},
    {when: {type: ['office-open']}, weight: 1.6, why: 'open-plan office floors'},
    {when: {publicSpace: true}, weight: 1, why: 'other public halls, lobby and corridors'},
  ],
  otherwise: 1.3,
  otherwiseWhy: 'enclosed office rooms and back-of-house rooms',
};
/** Office caps (placeOfficeEnemies): passes 1 / 2 / 3; platforms one more; closets one. */
export const OFFICE_CAPS: AreaCaps = {
  passes: [1, 2, 3],
  rules: [
    {when: {kind: ['platform']}, plus: 1, why: 'platforms hold one more per pass'},
    {when: {kind: ['closet']}, fixed: 1, why: 'closets: at most one'},
  ],
};

/** Subway station placement (placeSpawns): 12 tries, 4 m spacing, >= 36 walking cells (18 m) from the start, 3 x 3 clear. */
export const SUBWAY_PLACEMENT: PlacementRules = {
  areaWeights: SUBWAY_AREA_WEIGHTS, caps: SUBWAY_CAPS, tries: 12, spacingM: 4, startCells: MIN_ZOMBIE_SPAWN_CELLS, clearCells: 1,
};
/** Office placement (placeOfficeEnemies, every storey context): 14 tries, 4 m same-storey spacing, 36 cells, 5 m off landings. */
export const OFFICE_PLACEMENT: PlacementRules = {
  areaWeights: OFFICE_AREA_WEIGHTS, caps: OFFICE_CAPS, tries: 14, spacingM: 4, startCells: 36, clearCells: 1, landingKeepM: 5,
};

/** The shambler / coated roll of both levels (40 % coated, at least one of each). */
export const ZOMBIE_TYPES: ZombieTypeRule = {coatedChance: 0.4, atLeastOneEach: true};

/**
 * THE PER-LEVEL PROFILES. Both shipped levels keep today's controls exactly and NO room modifiers (every room resolves to 1). A new
 * level adds its entry here (Record<LevelId, …> makes that mandatory); tests/enemy-spawn-tables.test.ts checks coverage.
 */
export const SPAWN_PROFILES: Readonly<Record<LevelId, SpawnProfile>> = {
  subway: {
    id: 'subway', label: 'Subway', families: ENEMY_POOL, zombieTypes: ZOMBIE_TYPES,
    contexts: {
      station: {label: 'Station', count: [ENEMY_SPAWNS.min, ENEMY_SPAWNS.max], placement: SUBWAY_PLACEMENT, accept: {min: 8, max: null}},
    },
    levelMoves: {areaWeights: SUBWAY_AREA_WEIGHTS, mainKeep: 6, passes: 3, tries: 12, spacingM: 4, spacingDy: 2, startCells: MIN_ZOMBIE_SPAWN_CELLS},
    rooms: {},
  },
  office: {
    id: 'office', label: 'Office Space', families: ENEMY_POOL, zombieTypes: ZOMBIE_TYPES,
    contexts: {
      street: {label: 'Station + lobby', count: [5, 8], placement: OFFICE_PLACEMENT, accept: {min: 'count', max: 'count'}},
      floor: {label: 'Office floor', count: [3, 6], placement: OFFICE_PLACEMENT, accept: {min: 'count', max: 'count'}},
      roof: {label: 'Roof', count: [0, 2], placement: OFFICE_PLACEMENT, accept: {min: null, max: 'count'}},
    },
    rooms: {},
  },
};

/** The spawn profile of a logical level. */
export function spawnProfile(levelId: LevelId): SpawnProfile {
  const p = SPAWN_PROFILES[levelId];
  if (!p) throw new Error(`no spawn profile for level '${levelId}'`);
  return p;
}

/** A generation context of a profile (throws when the generator asks for one the profile does not declare). */
export function spawnContext(p: SpawnProfile, id: SpawnContextId): SpawnContextRule {
  const c = p.contexts[id];
  if (!c) throw new Error(`spawn profile '${p.id}' has no '${id}' context`);
  return c;
}

/** The lower / upper bound a context's validation accepts for its placed count (null = unchecked). */
export function acceptedPlaced(c: SpawnContextRule): {min: number | null; max: number | null} {
  return {min: c.accept.min === 'count' ? c.count[0] : c.accept.min, max: c.accept.max === 'count' ? c.count[1] : c.accept.max};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Baseline rule evaluation

type AreaLike = Pick<Area, 'kind' | 'type' | 'publicSpace' | 'storefront' | 'purpose'>;

export function areaMatches(m: AreaMatch, a: AreaLike): boolean {
  return (m.kind !== undefined && m.kind.includes(a.kind)) || (m.type !== undefined && m.type.includes(a.type))
    || (m.publicSpace === true && !!a.publicSpace) || (m.storefront === true && a.storefront !== undefined);
}

/** The baseline area weight (first matching rule). */
export function baseAreaWeight(w: AreaWeights, a: AreaLike): number {
  for (const r of w.rules) if (areaMatches(r.when, a)) return r.weight;
  return w.otherwise;
}

/** How many spawns an area may hold after the pass with cap `passCap`. */
export function areaCap(c: AreaCaps, a: AreaLike, passCap: number): number {
  for (const r of c.rules) if (areaMatches(r.when, a)) return 'fixed' in r ? r.fixed : passCap + r.plus;
  return passCap;
}

/** The shambler / coated types of `count` spawns: the rng draws of the historical loop, then the at-least-one-each fix. */
export function rollZombieTypes(rng: {chance(p: number): boolean}, count: number, rule: ZombieTypeRule): ZombieType[] {
  const types: ZombieType[] = [];
  for (let i = 0; i < count; i++) types.push(rng.chance(rule.coatedChance) ? 'coated' : 'shambler');
  if (rule.atLeastOneEach) {
    if (!types.includes('coated')) types[0] = 'coated';
    if (count > 1 && !types.includes('shambler')) types[1] = 'shambler';
  }
  return types;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Room modifiers

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The room key of an area: its purpose id, else its room type. */
export function roomKey(a: Pick<Area, 'purpose' | 'type'>): string {
  return a.purpose ?? a.type;
}

function entries(p: SpawnProfile, a: Pick<Area, 'purpose' | 'type'>): [RoomModifier | undefined, RoomModifier | undefined] {
  const r = p.rooms;
  return [a.purpose !== undefined && own(r, a.purpose) ? r[a.purpose] : undefined, own(r, a.type) ? r[a.type] : undefined];
}

/** True when a profile has an entry for this area's purpose or room type (else every resolution is the untouched baseline). */
export function hasRoomEntry(p: SpawnProfile, a: Pick<Area, 'purpose' | 'type'> | undefined): boolean {
  if (!a) return false;
  const [byP, byT] = entries(p, a);
  return byP !== undefined || byT !== undefined;
}

/** Resolved modifiers of family `f` in an area: per field purpose entry → room-type entry → 1; density × the 'all' density. */
export function roomModifier(p: SpawnProfile, a: Pick<Area, 'purpose' | 'type'> | undefined, f: EnemyFamilyId): {density: number; weight: number} {
  if (!a) return {density: 1, weight: 1};
  const [byP, byT] = entries(p, a);
  const all = byP?.all?.density ?? byT?.all?.density ?? 1;
  const density = (byP?.[f]?.density ?? byT?.[f]?.density ?? 1) * all;
  const weight = byP?.[f]?.weight ?? byT?.[f]?.weight ?? 1;
  return {density, weight};
}

/**
 * Room intensity D (multiplies the room's baseline area weight): all.density × Σ p·w·d / Σ p·w over the pool (family densities
 * without 'all'), 0 when no family can spawn there. Exactly 1 for a room without an entry (and for an all-1 entry).
 */
export function roomIntensity(p: SpawnProfile, a: Pick<Area, 'purpose' | 'type'> | undefined): number {
  if (!a || !hasRoomEntry(p, a)) return 1;
  const [byP, byT] = entries(p, a);
  const all = byP?.all?.density ?? byT?.all?.density ?? 1;
  let num = 0, den = 0;
  for (const [f, w] of p.families) {
    const pw = Math.max(0, w) * (byP?.[f]?.weight ?? byT?.[f]?.weight ?? 1);
    num += pw * (byP?.[f]?.density ?? byT?.[f]?.density ?? 1);
    den += pw;
  }
  return den > 0 ? all * (num / den) : 0;
}

/** The family pool for a spawn in an area: the profile's pool itself (same array) without an entry, else p·w·d per family. */
export function roomFamilyPool(p: SpawnProfile, a: Pick<Area, 'purpose' | 'type'> | undefined): FamilyPool {
  if (!a || !hasRoomEntry(p, a)) return p.families;
  const [byP, byT] = entries(p, a);
  return p.families.map(([f, w]) => [f, Math.max(0, w) * (byP?.[f]?.weight ?? byT?.[f]?.weight ?? 1) * (byP?.[f]?.density ?? byT?.[f]?.density ?? 1)] as const);
}

/** The effective area weight of the weighted area order: baseline × room intensity (× 1 is exact). */
export function areaSpawnWeight(w: AreaWeights, p: SpawnProfile, a: AreaLike): number {
  return baseAreaWeight(w, a) * roomIntensity(p, a);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Census hook (QA / the reference's sampled census): generation-time only, null by default — no runtime / per-frame cost.

export interface SpawnCandidateReport {
  /** The layout being generated (a generator may try several attempts: match the returned object). */
  layout: object;
  context: SpawnContextId | 'levelMoves';
  /** Area id → eligible candidate cells the generator's own filter accepted for this context run. */
  cells: ReadonlyMap<number, number>;
}
let censusHook: ((r: SpawnCandidateReport) => void) | null = null;
export function setSpawnCensusHook(fn: ((r: SpawnCandidateReport) => void) | null): void {
  censusHook = fn;
}
export function reportSpawnCandidates(layout: object, context: SpawnCandidateReport['context'], byArea: ReadonlyMap<number, readonly unknown[]>): void {
  if (!censusHook) return;
  censusHook({layout, context, cells: new Map([...byArea].map(([id, l]) => [id, l.length]))});
}

// ---------------------------------------------------------------------------------------------------------------------------
// Validation

const AREA_KINDS: Readonly<Record<AreaKind, true>> = {platform: true, passage: true, concourse: true, service: true, room: true, closet: true};

/** Every room key a level generator can produce: every RoomType (stationKit ROOM_LABEL) and every purpose id (gen/purposes.ts). */
export function spawnRoomKeys(): Set<string> {
  return new Set([...Object.keys(ROOM_LABEL), ...ALL_PURPOSES.map(p => p.id)]);
}

const finiteNonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Problems with a profile (empty = valid): unknown knobs / families / contexts / room keys / area kinds / room types, non-finite or
 * negative values, count ranges that are not integers 0 <= lo <= hi, chances outside [0, 1], a pool listing a family twice or
 * missing one, and an all-zero pool while some context would place enemies (use count [0, 0] for "no enemies").
 */
export function validateSpawnProfile(p: SpawnProfile, roomKeys: ReadonlySet<string> = spawnRoomKeys()): string[] {
  const issues: string[] = [];
  const bad = (path: string, msg: string) => issues.push(`${p.id}: ${path}: ${msg}`);
  const known = (path: string, o: object, keys: readonly string[]) => { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${path}.${k}`, 'unknown knob'); };
  const num = (path: string, v: unknown) => { if (!finiteNonNeg(v)) bad(path, `${String(v)} is not a finite number >= 0`); };
  const int = (path: string, v: unknown) => { if (!nonNegInt(v)) bad(path, `${String(v)} is not an integer >= 0`); };
  const match = (path: string, m: AreaMatch) => {
    if (!m || typeof m !== 'object') { bad(path, 'not a match'); return; }
    known(path, m, ['kind', 'type', 'publicSpace', 'storefront']);
    if (m.kind === undefined && m.type === undefined && m.publicSpace === undefined && m.storefront === undefined) bad(path, 'matches nothing');
    for (const k of m.kind ?? []) if (!own(AREA_KINDS, k)) bad(`${path}.kind`, `unknown area kind ${k}`);
    for (const t of m.type ?? []) if (!own(ROOM_LABEL, t)) bad(`${path}.type`, `unknown room type ${t}`);
    if (m.publicSpace !== undefined && m.publicSpace !== true) bad(`${path}.publicSpace`, 'must be true');
    if (m.storefront !== undefined && m.storefront !== true) bad(`${path}.storefront`, 'must be true');
  };
  const weights = (path: string, w: AreaWeights) => {
    if (!w || !Array.isArray(w.rules)) { bad(path, 'not area weights'); return; }
    known(path, w, ['rules', 'otherwise', 'otherwiseWhy']);
    w.rules.forEach((r, i) => { known(`${path}.rules[${i}]`, r, ['when', 'weight', 'why']); match(`${path}.rules[${i}].when`, r.when); num(`${path}.rules[${i}].weight`, r.weight); });
    num(`${path}.otherwise`, w.otherwise);
  };
  const placement = (path: string, pl: PlacementRules) => {
    if (!pl || typeof pl !== 'object') { bad(path, 'missing'); return; }
    known(path, pl, ['areaWeights', 'caps', 'tries', 'spacingM', 'startCells', 'clearCells', 'landingKeepM']);
    weights(`${path}.areaWeights`, pl.areaWeights);
    const c = pl.caps;
    if (!c || !Array.isArray(c.passes) || !Array.isArray(c.rules)) bad(`${path}.caps`, 'not caps');
    else {
      known(`${path}.caps`, c, ['passes', 'rules']);
      if (!c.passes.length) bad(`${path}.caps.passes`, 'no passes');
      c.passes.forEach((v, i) => int(`${path}.caps.passes[${i}]`, v));
      c.rules.forEach((r, i) => {
        known(`${path}.caps.rules[${i}]`, r, ['when', 'why', 'fixed', 'plus']);
        match(`${path}.caps.rules[${i}].when`, r.when);
        if (('fixed' in r) === ('plus' in r)) bad(`${path}.caps.rules[${i}]`, 'needs exactly one of fixed / plus');
        else int(`${path}.caps.rules[${i}].${'fixed' in r ? 'fixed' : 'plus'}`, 'fixed' in r ? r.fixed : r.plus);
      });
    }
    if (!(nonNegInt(pl.tries) && pl.tries >= 1)) bad(`${path}.tries`, `${String(pl.tries)} is not an integer >= 1`);
    num(`${path}.spacingM`, pl.spacingM);
    int(`${path}.startCells`, pl.startCells);
    int(`${path}.clearCells`, pl.clearCells);
    if (pl.landingKeepM !== undefined) num(`${path}.landingKeepM`, pl.landingKeepM);
  };

  known('profile', p, ['id', 'label', 'families', 'zombieTypes', 'contexts', 'levelMoves', 'rooms']);
  // --- families
  const seen = new Set<string>();
  let poolSum = 0;
  if (!Array.isArray(p.families)) bad('families', 'not a pool');
  else p.families.forEach((row, i) => {
    const [f, w] = Array.isArray(row) ? row : [undefined, undefined];
    if (typeof f !== 'string' || !(ENEMY_FAMILY_IDS as readonly string[]).includes(f)) bad(`families[${i}]`, `unknown family ${String(f)}`);
    else if (seen.has(f)) bad(`families[${i}]`, `family ${f} listed twice`);
    else seen.add(f);
    num(`families[${i}].weight`, w);
    if (finiteNonNeg(w)) poolSum += w;
  });
  for (const f of ENEMY_FAMILY_IDS) if (Array.isArray(p.families) && !seen.has(f)) bad('families', `family ${f} missing (list it with weight 0 to exclude it)`);
  // --- zombie types
  const zt = p.zombieTypes;
  if (!zt || typeof zt !== 'object') bad('zombieTypes', 'missing');
  else {
    known('zombieTypes', zt, ['coatedChance', 'atLeastOneEach']);
    if (!(finiteNonNeg(zt.coatedChance) && zt.coatedChance <= 1)) bad('zombieTypes.coatedChance', `${String(zt.coatedChance)} is outside [0, 1]`);
    if (typeof zt.atLeastOneEach !== 'boolean') bad('zombieTypes.atLeastOneEach', 'not a boolean');
  }
  // --- contexts
  let places = false;
  if (!p.contexts || typeof p.contexts !== 'object') bad('contexts', 'missing');
  else for (const [id, c] of Object.entries(p.contexts) as [string, SpawnContextRule][]) {
    const path = `contexts.${id}`;
    if (!(SPAWN_CONTEXT_IDS as readonly string[]).includes(id)) bad(path, 'unknown spawn context');
    if (!c || typeof c !== 'object') { bad(path, 'missing'); continue; }
    known(path, c, ['label', 'count', 'placement', 'accept']);
    const [lo, hi] = Array.isArray(c.count) ? c.count : [undefined, undefined];
    if (!(nonNegInt(lo) && nonNegInt(hi) && lo <= hi && c.count.length === 2)) bad(`${path}.count`, `range ${JSON.stringify(c.count)} is not integers 0 <= lo <= hi`);
    else if (hi > 0) places = true;
    placement(`${path}.placement`, c.placement);
    if (!c.accept || typeof c.accept !== 'object') bad(`${path}.accept`, 'missing');
    else {
      known(`${path}.accept`, c.accept, ['min', 'max']);
      for (const k of ['min', 'max'] as const) { const v = c.accept[k]; if (v !== null && v !== 'count' && !nonNegInt(v)) bad(`${path}.accept.${k}`, `${String(v)} is not null / 'count' / an integer >= 0`); }
    }
  }
  if (places && poolSum <= 0) bad('families', 'every family weight is 0 but a context places enemies (use count [0, 0] for none)');
  // --- level moves
  const m = p.levelMoves;
  if (m !== undefined) {
    known('levelMoves', m, ['areaWeights', 'mainKeep', 'passes', 'tries', 'spacingM', 'spacingDy', 'startCells']);
    weights('levelMoves.areaWeights', m.areaWeights);
    int('levelMoves.mainKeep', m.mainKeep);
    int('levelMoves.passes', m.passes);
    if (!(nonNegInt(m.tries) && m.tries >= 1)) bad('levelMoves.tries', `${String(m.tries)} is not an integer >= 1`);
    num('levelMoves.spacingM', m.spacingM);
    num('levelMoves.spacingDy', m.spacingDy);
    int('levelMoves.startCells', m.startCells);
    const st = p.contexts?.station;
    if (!st) bad('levelMoves', 'storey moves need a station context');
    else if (nonNegInt(m.startCells) && m.startCells < st.placement?.startCells) bad('levelMoves.startCells', `below the station context's ${st.placement.startCells}: moved enemies would fail validation`);
  }
  // --- room modifiers
  if (!p.rooms || typeof p.rooms !== 'object') bad('rooms', 'missing');
  else for (const [key, mod] of Object.entries(p.rooms)) {
    const path = `rooms.${key}`;
    if (!roomKeys.has(key)) bad(path, 'unknown room key (purpose id or room type)');
    if (!mod || typeof mod !== 'object') { bad(path, 'not a modifier'); continue; }
    for (const [f, fm] of Object.entries(mod) as [string, FamilyRoomModifier][]) {
      const fp = `${path}.${f}`;
      if (f !== ALL_FAMILIES && !(ENEMY_FAMILY_IDS as readonly string[]).includes(f)) bad(fp, 'unknown family');
      if (!fm || typeof fm !== 'object') { bad(fp, 'not a modifier'); continue; }
      known(fp, fm, f === ALL_FAMILIES ? ['density'] : ['density', 'weight']);
      if (fm.density !== undefined) num(`${fp}.density`, fm.density);
      if (fm.weight !== undefined) num(`${fp}.weight`, fm.weight);
    }
  }
  return issues;
}
