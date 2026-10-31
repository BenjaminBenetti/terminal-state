// Task enemy-spawn-tables-20261030 (lane SPAWN): per-logical-level ENEMY SPAWN PROFILES — the single source-backed data / API that
// the REAL generators read (pure data + pure resolution functions; no three.js). Guide: docs/enemy-spawns.md.
//
// One profile per LevelId (levels/registry.ts; Record<LevelId, …> makes a new level fail to typecheck until it has one). A profile
// holds the controls that used to be literals inside the generators, moved VERBATIM (same values, same draw order):
//  - `contexts`: the count rule + placement rules of every generation context the level's generator runs —
//      Subway (gen/station.ts → gen/stationDress.ts placeSpawns): 'station';
//      Office Space (gen/office/index.ts → gen/office/spawns.ts placeOfficeEnemies), ONE logical level: 'street' (station +
//      lobby, once), 'floor' (once per office floor 2..8), 'roof' (once). No per-floor reroll of the level.
//      Both (Track 2, lane CONTENT): 'service' (once per seeded service annex off a track tunnel, gen/annexContent.ts; appended last).
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

import type {Area, AreaKind, Door, RoomType, ZombieType} from '../gen/stationTypes';
import {MIN_ZOMBIE_SPAWN_CELLS} from '../gen/stationTypes';
import type {LevelId} from '../levels/types';
import {ROOM_LABEL} from '../gen/stationKit';
import {ALL_PURPOSES} from '../gen/purposes';
// Task track3-eaton-centre-20261031 (lane PROFILES): the horde pool's rules (lane HORDE owns the type / validation / defaults;
// hordeSpec.ts imports only TYPES from this module, so there is no runtime import cycle).
import {HORDE_FORBIDDEN_FAMILIES, MALL_HORDE_RULES, validateHordeRules, type HordeRules} from './hordeSpec';
export type {HordeRules} from './hordeSpec';

// ---------------------------------------------------------------------------------------------------------------------------
// Families

/**
 * Enemy families (= the archetype registry ai/creatureArchetypes.ts ENEMY_ARCHETYPES, SAME key order; tests check they agree).
 * Task track1-siren-blightbelly-20261031 (lane SPAWN): 'blightbelly' and 'siren' sit BEFORE 'ratdog' — the order is also every
 * shipped pool's roll order, so the rat/dog keeps the top 5 % band of the same roll and every rat/dog draw stays identical.
 */
export type EnemyFamilyId = 'zombie' | 'blightbelly' | 'siren' | 'ratdog';
export const ENEMY_FAMILY_IDS: readonly EnemyFamilyId[] = ['zombie', 'blightbelly', 'siren', 'ratdog'];
/** Room-modifier family key that applies its density to every family of the room. */
export const ALL_FAMILIES = 'all';

/** A family pool: [family, relative weight] in roll order (the pick walks it in this order). */
export type FamilyPool = readonly (readonly [EnemyFamilyId, number])[];

/** A non-zombie family (the zombie always takes the remainder of a pool built by familyPool). */
export type ShareFamilyId = Exclude<EnemyFamilyId, 'zombie'>;

/**
 * Task track1-siren-blightbelly-20261031 (lane SPAWN): the DEFAULT share of every non-zombie family in a level's pool (familyPool).
 *  - ratdog 0.05: iteration 07 (Lane Q), the user asked for the field-notes rat/dog to be about 5 % of the enemies.
 *  - blightbelly 0.05: the user asked for the exploding Blightbelly on every level, "roughly as rare as the rat dog" — DEFAULT ON.
 *  - siren 0: the Siren is OPT-IN per level (OPT_IN_FAMILIES): a level enables her deliberately with a weight AND an eligibility
 *    rule (Office only today; never the Subway). Nothing is enabled by a level's tier.
 */
export const DEFAULT_FAMILY_SHARES: Readonly<Record<ShareFamilyId, number>> = {blightbelly: 0.05, siren: 0, ratdog: 0.05};
/** Families a level must enable deliberately: weight > 0 is only valid together with an explicit `eligibility` rule. */
export const OPT_IN_FAMILIES: readonly EnemyFamilyId[] = ['siren'];

/**
 * A level's family pool in ENEMY_FAMILY_IDS order: DEFAULT_FAMILY_SHARES overridden by `shares`, the zombie = the remainder (rounded
 * to 1e-9 so the table reads 0.9, not 0.8999999999999999; the rat/dog band [0.95, 1) of the roll is unchanged by that rounding).
 */
export function familyPool(shares: Partial<Record<ShareFamilyId, number>> = {}): FamilyPool {
  const s: Record<ShareFamilyId, number> = {...DEFAULT_FAMILY_SHARES, ...shares};
  let rest = 1;
  for (const f of ENEMY_FAMILY_IDS) if (f !== 'zombie') rest -= s[f];
  rest = Math.round(rest * 1e9) / 1e9;
  if (!(rest >= 0)) throw new Error(`familyPool: the non-zombie shares exceed 1 (${JSON.stringify(s)})`);
  return ENEMY_FAMILY_IDS.map(f => [f, f === 'zombie' ? rest : s[f]] as const);
}

/**
 * The DEFAULT pool (the Subway's, and every level that does not opt in to the Siren): zombie 0.9, blightbelly 0.05, siren 0,
 * ratdog 0.05. Before task track1 both shipped levels used [zombie 0.95, ratdog 0.05]: the rat/dog keeps its band of the same
 * roll (identical draws), the Blightbelly takes 5 % of the old zombie band (placed slots replaced, never added).
 */
export const ENEMY_POOL: FamilyPool = familyPool();

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

/**
 * Generation contexts (one count rule each). A same-world annex zone (e.g. Track 2's track-tunnel service annexes) adds its
 * own id here and declares its count in the profile of every level that has it (docs/level-enemy-contract.md).
 * Task track3-eaton-centre-20261031 (lane PROFILES): the mall adds 'pit' (the subway station storey at the bottom of the
 * void, once), 'ring' (one retail ring, once per ring); since the Track2 integration (lane INTEG) it declares Track2's 'service' zone
 * context (SERVICE_CONTEXT) like the Subway / Office.
 * Lane INTEG (Track1 integration): 'horde' = HORDE_CONTEXT, the tag of the SEPARATE roaming-horde pool's members. It is never a
 * `contexts` entry: a profile declares it by declaring `horde` (HordeRules: groups x size, budgets, placement) — see
 * declaredSpawnContexts. No ambient family rule (eligibility) can name it, so no ambient roll ever reaches a horde member.
 */
export type SpawnContextId = 'station' | 'street' | 'floor' | 'roof' | 'pit' | 'ring' | 'service' | 'horde';
/**
 * Track 2 (lane CONTENT): 'service' = ONE run per seeded SERVICE ANNEX of a track-bearing level (gen/annexContent.ts
 * placeServiceSpawns; 0-2 annexes per level): a per-annex ZONE BUDGET placed in that annex's areas only, on its own fork, appended
 * after every core spawn and tagged markSpawnContext(…, 'service'); excluded from the core station / street / floor counts and
 * reported separately. No family is enabled by it (the Office's Siren eligibility lists only 'floor').
 */
export const SPAWN_CONTEXT_IDS: readonly SpawnContextId[] = ['station', 'street', 'floor', 'roof', 'pit', 'ring', 'service', 'horde'];
/** Lane INTEG: the context tag of horde members (ai/hordePlace.ts placeHordes tags every member it appends). */
export const HORDE_CONTEXT = 'horde' as const satisfies SpawnContextId;

/**
 * Lane INTEG (task track3-eaton-centre-20261031, Track1 integration): a whole-level minimum SPACING for a family that has an
 * eligibility rule (Track1's FamilyEligibility has no spacing field, so the mall keeps its 30 m Siren spacing as this small
 * post-pass: ai/familySpacing.ts applyFamilySpacing, run once right after assignEnemyArchetypes). In spawn-index order an
 * ELIGIBLE draw of the family is placed only while fewer than the rule's maxPerLevel are kept AND it is at least `spacingM`
 * (straight 3D line) from every kept one; otherwise it becomes the rule's fallback. Pure, RNG-free; horde members never take part.
 */
export interface FamilySpacing {
  readonly spacingM: number;
  readonly why: string;
}
/** Task track3-eaton-centre-20261031 (lane PROFILES): explicit caps of the AMBIENT pool (the horde pool's are horde.budget). */
export interface AmbientBudget {
  /** Ambient spawns in the whole logical level (Σ over the context runs). */
  readonly total: number;
  /** Ambient spawns of one storey run (every context's count hi must fit). */
  readonly perStorey: number;
}

/**
 * Task track1-siren-blightbelly-20261031 (lane SPAWN): WHERE a family may take a placed slot. A spawn whose (unchanged) family roll
 * lands on the family but which fails ANY criterion becomes `fallback` instead — never renormalised, so every other family's
 * draws and share are untouched (the rat/dog stays exactly its 5 %). Criteria are checked only for spawns that drew the family
 * (no extra RNG, no per-frame cost). Absent criteria = no restriction.
 */
export interface FamilyEligibility {
  /** The spawn's generation context (markSpawnContext) must be one of these (an untagged spawn of a multi-context profile: never). */
  readonly contexts: readonly SpawnContextId[];
  /** Area kinds allowed. */
  readonly kinds?: readonly AreaKind[];
  /** Room keys (purpose ids or room types) never allowed — matched against BOTH the area's purpose and its room type. */
  readonly excludeRooms?: readonly string[];
  /** The area's shorter side >= this many cells (0.5 m). */
  readonly minSideCells?: number;
  /** The area's w x h >= this many cells. */
  readonly minAreaCells?: number;
  /** The spawn cell and every cell within this Chebyshev radius are walkable floor of the SAME area (pose + ground patch). */
  readonly clearCells?: number;
  /** Straight-line distance (m) from the spawn to the centre of every opening (door) of its area. */
  readonly doorKeepM?: number;
  /**
   * Fair passage (m): with a disc of this radius around the spawn treated as impassable, every walkable cell around the disc stays
   * in ONE connected region of the storey (pockets of <= PASSAGE_NOOK_CELLS cells ignored) — she never seals off part of a floor.
   */
  readonly passageRadiusM?: number;
  /**
   * At most this many of the family per generated LEVEL (every context of the one logical level, annexes included): eligible draws
   * beyond it, in spawn-index order, fall back too.
   */
  readonly maxPerLevel?: number;
  /** What an ineligible draw becomes (a family without an eligibility rule of its own). */
  readonly fallback: EnemyFamilyId;
  readonly why: string;
}

export interface SpawnProfile {
  /** The logical level (LevelId) a registered profile belongs to. */
  readonly id: string;
  readonly label: string;
  readonly families: FamilyPool;
  readonly zombieTypes: ZombieTypeRule;
  readonly contexts: Readonly<Partial<Record<SpawnContextId, SpawnContextRule>>>;
  readonly levelMoves?: LevelMoveRules;
  readonly rooms: RoomModifiers;
  /** Per-family placement eligibility (task track1, lane SPAWN). Required for an OPT_IN_FAMILIES family with weight > 0. */
  readonly eligibility?: Readonly<Partial<Record<EnemyFamilyId, FamilyEligibility>>>;
  /** Task track3-eaton-centre-20261031 (lane HORDE / PROFILES): the SEPARATE roaming-horde pool (ai/hordeSpec.ts); absent = none. */
  readonly horde?: HordeRules;
  /** Lane INTEG: whole-level spacing of families with an eligibility rule (FamilySpacing, ai/familySpacing.ts); absent = none. */
  readonly spacing?: Readonly<Partial<Record<EnemyFamilyId, FamilySpacing>>>;
  /** Lane PROFILES: explicit ambient-pool caps (AmbientBudget); absent = the contexts' count ranges alone. */
  readonly budgets?: {readonly ambient: AmbientBudget};
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
 * Track 2 (lane CONTENT): area weights inside a SERVICE ANNEX (the cramped, dark back-of-house reached through a side door off a
 * track tunnel): rooms (pump / electrical rooms, stores, workshops) like the Subway's back-of-house, the 1.5-2 m service corridors
 * less (nobody is jumped point-blank in a corridor), closets least.
 */
export const SERVICE_AREA_WEIGHTS: AreaWeights = {
  rules: [
    {when: {kind: ['closet']}, weight: 0.6, why: 'annex closets (janitor / electrical / supply)'},
    {when: {kind: ['service']}, weight: 1, why: 'annex service corridors (1.5-2 m wide)'},
  ],
  otherwise: 1.4,
  otherwiseWhy: 'annex rooms (pump / electrical rooms, stores, workshops, custodial rooms)',
};
/** Annex caps: passes 1 / 2 (a cramped room holds at most two); closets one. */
export const SERVICE_CAPS: AreaCaps = {
  passes: [1, 2],
  rules: [{when: {kind: ['closet']}, fixed: 1, why: 'closets: at most one'}],
};
/**
 * Annex placement (each annex run): 12 tries, 5 m spacing (wider than the station's 4 m: the annex is dark and cramped), >= 36
 * walking cells from the start (an annex lies far beyond it anyway), 3 x 3 clear, and 6 m straight-line keep-off from the annex's
 * entry door (its keep point): the way in and out is never guarded point-blank.
 */
export const SERVICE_PLACEMENT: PlacementRules = {
  areaWeights: SERVICE_AREA_WEIGHTS, caps: SERVICE_CAPS, tries: 12, spacingM: 5, startCells: MIN_ZOMBIE_SPAWN_CELLS, clearCells: 1, landingKeepM: 6,
};
/**
 * THE PER-ANNEX ZONE BUDGET (Track 2, lane CONTENT): spawns ONE service-annex run tries to place, rng.int(lo, hi) per annex, ADDITIVE
 * to the core contexts. Census basis (docs/enemy-spawns.md "Service annexes"): an annex is ~25 % of the Subway's walkable-exploration
 * baseline (~1840 m² of the 7371 m² core station, gen/trackExt/config.ts); the station's 22-32 spawns over that baseline would put
 * ~6.8 into an annex at the same density. The annex is cramped and much darker, so it gets ~60 % of that density: 3-5 per annex
 * (E 4). The level's own pool / zombie types apply (no annex families, no guarantee); killed annex enemies stay dead for the run
 * (the per-index memory); 0-2 annexes per level, so a level gains 0-10. Census (Track 2 lane CONTENT, docs/enemy-spawns.md): Subway
 * 24 seeds 1.12 annexes / level (GEN-2 incidence) -> 4.3 service spawns / level (max 10) on top of the station's ~27; Office 10 seeds
 * 1.5 annexes -> 5.6 / level (max 9); 3.7-3.9 placed per annex, no run short of its count.
 */
export const SERVICE_ZONE_BUDGET: readonly [number, number] = [3, 5];
/** The 'service' context of a level whose stations grow annexes (the per-annex zone budget; never regenerates a level). */
export const SERVICE_CONTEXT: SpawnContextRule = {label: 'Service annex (per annex)', count: SERVICE_ZONE_BUDGET, placement: SERVICE_PLACEMENT, accept: {min: null, max: 'count'}};

// ---------------------------------------------------------------------------------------------------------------------------
// Task track3-eaton-centre-20261031 (lane PROFILES): THE MALL (LevelId 'mall', tier 2; display name seeded per run: "<Name> Center",
// gen/mall/names.ts mallNameOf(levelSeed)) — ONE logical level: the subway station at the bottom of the atrium (storey 0) and the
// retail floors above it, generated once per level seed (gen/mall/index.ts, lane GEN). docs/enemy-spawns.md "The mall".
// Task mall-playtest-revision-20261031 (lane PROFILES, D07): the COMPACT mall — station + THREE retail floors (was six rings);
// measured core ~6,400 m² (station ~1,180, retail ~5,220: floor 1 ~2,260 / floor 2 ~1,740 / floor 3 ~1,220) + an optional Track2
// tunnel / service annex (~2,200 m²), vs ~43,800 m² before. The old counts in the new mall would have been 1.11 enemies per 100 m²
// of core (2.5x the Office's 0.45): re-proportioned below (counts per storey, horde groups / budget / route capacity, Siren draw).
//
// Two SEPARATE pools, never mixed:
//  - AMBIENT (contexts 'pit' once + 'ring' once per ring, the generic Office placement gen/office/spawns.ts placeOfficeEnemies, which
//    tags each run's spawns with its context): the ambient family pool familyPool({siren: MALL_SIREN_WEIGHT}) — Track1's Blightbelly
//    5 % and the rat/dog 5 % (default shares), a rare Siren (opt-in: MALL_SIREN_ELIGIBILITY + the whole-mall MALL_SIREN_SPACING),
//    zombies the remainder; rolled ONCE by assignEnemyArchetypes after every ambient context. Capped by budgets.ambient.
//  - HORDE (ai/hordeSpec.ts HordeRules, placed LAST by ai/hordePlace.ts, lane HORDE; members tagged HORDE_CONTEXT): ordinary zombies
//    only — its own explicit family pool (Blightbelly / Siren / rat/dog weight 0; a Siren never, by validation), 5..20 members per
//    group, global + per-storey budgets. Appended after the ambient family roll, which never reaches them.
// Plus (lane INTEG, Track2 integration) the 'service' zone context SERVICE_CONTEXT: once per seeded service annex of the pit station
// (Track 2's per-annex budget, the mall's family pool, no Siren), appended after every core spawn — hordes included. Accounted
// SEPARATELY from the core (station / retail) numbers: the annex is optional (0..1 per mall).
// Density (mall revision, measured: evidence/census in the task folder): ambient ~19 per run = ~0.30 per 100 m² of core (station 3..5
// on ~1,180 m², 4..6 per retail floor of 1,200-2,700 m²) — lighter than the Office's ~0.45 ambient, because the hordes (~1.5 groups,
// ~16 members, on the retail floors only) concentrate the mall's threat; core total ~0.53-0.67 per 100 m² (old mall 0.26, sparse and
// vast). Census: evidence/census/final-census.md in the task folder; docs/enemy-spawns.md "The mall".

/** Mall area weights (the Office's rules; storefront / shop units are ordinary rooms here, galleries and courts public space). */
export const MALL_AREA_WEIGHTS: AreaWeights = {
  rules: [
    {when: {kind: ['platform']}, weight: 2.2, why: 'the platforms of the station at the bottom of the pit'},
    {when: {type: ['exit-stair', 'washroom']}, weight: 0.5, why: 'closed street exits and washrooms'},
    {when: {type: ['office-stair', 'stair-core', 'office-elevator']}, weight: 0, why: 'never in a stairwell, stair core or an elevator cab'},
    {when: {kind: ['closet']}, weight: 0.5, why: 'closets'},
    {when: {publicSpace: true}, weight: 1, why: 'gallery walkways, bridges, the pit plaza and courts'},
  ],
  otherwise: 1.3,
  otherwiseWhy: 'shop sales floors, stock rooms and back-of-house rooms',
};
/** Mall caps: passes 1 / 2 / 3; platforms one more; closets one. */
export const MALL_CAPS: AreaCaps = {
  passes: [1, 2, 3],
  rules: [
    {when: {kind: ['platform']}, plus: 1, why: 'platforms hold one more per pass'},
    {when: {kind: ['closet']}, fixed: 1, why: 'closets: at most one'},
  ],
};
/** Mall placement (every ambient context): the Office values — 14 tries, 4 m same-storey spacing, 36 cells (18 m), 5 m off landings. */
export const MALL_PLACEMENT: PlacementRules = {
  areaWeights: MALL_AREA_WEIGHTS, caps: MALL_CAPS, tries: 14, spacingM: 4, startCells: 36, clearCells: 1, landingKeepM: 5,
};
/**
 * Lane INTEG (Track1 integration, modelled on OFFICE_SIREN_ELIGIBILITY): where a mall Siren may lie dormant. She is an
 * ENCLOSED-SHOP encounter of the retail rings: context 'ring' only (never the 'pit' station storey with its platforms, plaza and
 * courts, never a Track2 'service' annex, never a horde — hordes are a separate pool no ambient rule reaches); area kind 'room'
 * (shop sales floors and stock rooms: never a gallery walkway, bridge or court — kind concourse —, a washroom passage or run —
 * passage —, a service corridor — service — or a closet); never a washroom, stair core / landing, plant room (storage / utility)
 * or an elevator. The Office's gates: room >= 4 x 4 m (shorter side 8 cells, 100 cells), a clear 1.5 x 1.5 m patch of its own
 * floor, every doorway (shopfront included) >= 3 m away, a 2.5 m disc never seals passage, at most 4 in the whole mall. An
 * ineligible or over-cap draw becomes an ordinary zombie.
 */
export const MALL_SIREN_ELIGIBILITY: FamilyEligibility = {
  contexts: ['ring'],
  kinds: ['room'],
  excludeRooms: ['washroom', 'stair-core', 'storage', 'utility', 'office-stair', 'office-elevator'],
  // (mall revision, D07) the Office's room gates unchanged; the whole-mall cap 4 -> 2 for the compact mall (census below)
  minSideCells: 8, minAreaCells: 100, clearCells: 1, doorKeepM: 3, passageRadiusM: 2.5, maxPerLevel: 2,
  fallback: 'zombie',
  why: 'enclosed shop sales floors / stock rooms of the retail floors only, room >= 4 x 4 m, clear floor patch, doorways >= 3 m away, never seals passage, <= 2 per mall',
};
/** Lane INTEG: the mall's whole-level Siren spacing (FamilySpacing; ai/familySpacing.ts) — the 30 m of the interim MALL_RARE_RULES. */
export const MALL_SIREN_SPACING: FamilySpacing = {
  spacingM: 30,
  why: 'rare ambient Sirens (at most 2 in the compact mall): never two within earshot of one another',
};
/**
 * The mall's Siren DRAW weight (NOT the Office's 0.19). A draw only becomes a Siren in an eligible retail-floor shop / stock-room
 * slot (MALL_SIREN_ELIGIBILITY), within the cap and 30 m apart (MALL_SIREN_SPACING), so the draw weight sits well above the placed
 * share. Task mall-playtest-revision-20261031 (lane PROFILES, D07): re-tuned for the COMPACT mall by a bounded census (48 generated
 * malls, evidence/census/siren-sweep.json in the task folder): only ~1.25 of the ~19.2 ambient slots of a run are eligible (small
 * shops; 29 % of runs have none at all), so 0.32 / cap 4 (the old six-ring tuning) gave 0.44 per run with 60 % of runs none. The
 * standing user decision ("rare Sirens MUST appear in the Mall … roughly 5 % ambient share") asks for the most the retail-room rule
 * allows: 0.8 / cap 2 / 30 m = mean 0.85 Sirens per run = 4.5 % of the placed ambient enemies (tuning half 0.96 / 5.0 %, validation
 * half 0.75 / 3.9 %), 35 % of runs none (29 % have no eligible slot at all), max 2 (21 % of runs), per storey floor 1 / 2 / 3 = 14 / 15
 * / 12 (48 runs); never the station storey, an annex or a horde. The draw SATURATES here: 0.85 and 0.9 give the identical placements
 * (every eligible slot outside the Blightbelly / rat-dog bands is already a Siren) — more would need more eligible slots (a room
 * modifier or the cap), not a larger weight. Blightbelly 5.8 % / rat-dog 6.0 % placed keep their 5 % draw bands (never
 * renormalised). (Track3 census, six rings: 0.32 -> 2.88 per run, 4.9 %; first compact tuning 0.5 -> 0.69, 3.6 %.)
 */
export const MALL_SIREN_WEIGHT = 0.8;
/** The mall's AMBIENT pool: zombie (remainder), blightbelly 0.05, siren MALL_SIREN_WEIGHT, ratdog 0.05 (ENEMY_FAMILY_IDS order). */
export const MALL_ENEMY_POOL: FamilyPool = familyPool({siren: MALL_SIREN_WEIGHT});
/**
 * The mall's horde pool (lane HORDE's semantics; the pool, sizes, budgets and route capacity: MALL_HORDE_RULES, lane PROFILES). Task
 * mall-playtest-revision-20261031 (D07): 1..2 groups (was 3..5) of 5..20 ordinary zombies, at most 32 horde members in the mall (was
 * 64), one group (<= 20 members) starting per retail floor, clipped to the floor's patrol route (18 m per member). Every registry
 * family is listed explicitly (lane INTEG): only the zombie has weight — no Blightbelly, Siren or rat/dog in a horde.
 */
export const MALL_HORDE: HordeRules = {
  label: 'Roaming hordes',
  groups: MALL_HORDE_RULES.groups,
  size: [5, 20],
  families: [['zombie', 1], ['blightbelly', 0], ['siren', 0], ['ratdog', 0]],
  zombieTypes: {coatedChance: 0.4, atLeastOneEach: false},
  budget: MALL_HORDE_RULES.budget,
  placement: MALL_HORDE_RULES.placement,
  patrol: MALL_HORDE_RULES.patrol,
};
/** The mall's spawn profile (SPAWN_PROFILES.mall). The label is the generic one: the display name is seeded per run ("<Name> Center"). */
export const MALL_SPAWN_PROFILE: SpawnProfile = {
  id: 'mall', label: 'Mall (seeded "<Name> Center")', families: MALL_ENEMY_POOL, zombieTypes: ZOMBIE_TYPES,
  contexts: {
    // (mall revision, D07) pit 3..5 (was 6..9) on the ~1,180 m² station storey; ring 4..6 (was 7..10) on each retail floor
    pit: {label: 'Station storey (platforms + Fountain court + station back of house, storey 0)', count: [3, 5], placement: MALL_PLACEMENT, accept: {min: 'count', max: 'count'}},
    ring: {label: 'Retail floor (each of storeys 1..3: courts, corridors, shops, stock rooms, service corridors)', count: [4, 6], placement: MALL_PLACEMENT, accept: {min: 'count', max: 'count'}},
    // lane INTEG (Track2 integration): the pit station's service annexes (LEVELS.mall.trackExtensions) — Track2's per-annex zone
    // budget, as on the Subway / Office (logical-level inheritance; not in MALL_SIREN_ELIGIBILITY.contexts: no Siren in an annex).
    service: SERVICE_CONTEXT,
  },
  rooms: {},
  eligibility: {siren: MALL_SIREN_ELIGIBILITY},
  spacing: {siren: MALL_SIREN_SPACING},
  horde: MALL_HORDE,
  // (mall revision, D07) every context run fits: 5 + 3 x 6 = 23 (was 69 / 10)
  budgets: {ambient: {total: 23, perStorey: 6}},
};

/**
 * Task track1-siren-blightbelly-20261031 (lane SPAWN): where an Office Siren may lie dormant. She is an INDOOR-ROOM encounter of the
 * office floors (2..8): never on the station or in the lobby (context 'street'), never on the roof (context 'roof'), never in a
 * corridor (kind passage), closet, washroom, stairwell / stair core or the elevator. Her room is at least 4 x 4 m (shorter side 8
 * cells, 100 cells = 25 m2); she lies on a clear 1.5 x 1.5 m patch of free floor of the room itself (3 x 3 cells: pose + the
 * centre of the ground corruption, never across a doorway); every doorway of her room is at least 3 m away (stepping in does not
 * wake her: the 2 m proximity wake leaves a step to see her and back off); and a 2.5 m disc around her (wake radius + 0.5 m)
 * never seals off part of the floor — the player can always walk around her, so avoiding her is a real choice. At most 4 per
 * level (the whole logical level, annex contexts included: an outlier run never fills the tower with them). An ineligible or
 * over-cap Siren draw becomes an ordinary zombie (its shambler / coated type roll is already there).
 * (Census, docs/enemy-spawns.md: a 2.5 x 2.5 m clear patch left only ~2.4 eligible slots per run in furnished rooms — too few to
 * spread her over the tower; 1.5 x 1.5 m leaves ~11.4 of the ~31 office-floor slots.)
 */
export const OFFICE_SIREN_ELIGIBILITY: FamilyEligibility = {
  contexts: ['floor'],
  kinds: ['room'],
  excludeRooms: ['washroom', 'office-stair', 'stair-core', 'office-elevator', 'office-lobby', 'office-corridor', 'office-roof'],
  minSideCells: 8, minAreaCells: 100, clearCells: 1, doorKeepM: 3, passageRadiusM: 2.5, maxPerLevel: 4,
  fallback: 'zombie',
  why: 'office-floor rooms only, room >= 4 x 4 m, clear floor patch, doorways >= 3 m away, never seals passage, <= 4 per level',
};

/**
 * Task track1-siren-blightbelly-20261031 (lane SPAWN): the Office's Siren DRAW weight, tuned by census so that a complete Office run
 * places about 2 Sirens (not 2 per floor). Only ~11.3 of the ~38.7 placed slots of a run are eligible (OFFICE_SIREN_ELIGIBILITY:
 * office-floor rooms) and an ineligible draw becomes a zombie, so the draw weight is above the placed share: 0.19 x ~11.3 eligible
 * slots -> mean 1.97 Sirens per run (400-run census: 12.5 % of runs none, max 4 = the cap), ~5.1 % of the placed enemies — the
 * brief's 5 % starting split, measured. The rat/dog keeps its band [0.95, 1) of the roll. Census: docs/enemy-spawns.md.
 */
export const OFFICE_SIREN_WEIGHT = 0.19;
/** The Office pool: zombie (remainder), blightbelly 0.05, siren OFFICE_SIREN_WEIGHT, ratdog 0.05. */
export const OFFICE_ENEMY_POOL: FamilyPool = familyPool({siren: OFFICE_SIREN_WEIGHT});

/**
 * THE PER-LEVEL PROFILES. Every level lists every family (familyPool); the Office opts in to the Siren with its eligibility rule.
 * No room modifiers (every room resolves to 1). A new level adds its entry here (Record<LevelId, …> makes that mandatory;
 * levels/levelContract.ts validateLevelRegistry + tests/enemy-spawn-contract.test.ts check coverage and the tier).
 */
export const SPAWN_PROFILES: Readonly<Record<LevelId, SpawnProfile>> = {
  subway: {
    id: 'subway', label: 'Subway', families: ENEMY_POOL, zombieTypes: ZOMBIE_TYPES,
    contexts: {
      station: {label: 'Station', count: [ENEMY_SPAWNS.min, ENEMY_SPAWNS.max], placement: SUBWAY_PLACEMENT, accept: {min: 8, max: null}},
      // Track 2 (lane CONTENT): the station's service annexes (LEVELS.subway.trackExtensions) — the per-annex zone budget.
      service: SERVICE_CONTEXT,
    },
    levelMoves: {areaWeights: SUBWAY_AREA_WEIGHTS, mainKeep: 6, passes: 3, tries: 12, spacingM: 4, spacingDy: 2, startCells: MIN_ZOMBIE_SPAWN_CELLS},
    rooms: {},
  },
  office: {
    id: 'office', label: 'Office Space', families: OFFICE_ENEMY_POOL, zombieTypes: ZOMBIE_TYPES,
    contexts: {
      street: {label: 'Station + lobby', count: [5, 8], placement: OFFICE_PLACEMENT, accept: {min: 'count', max: 'count'}},
      floor: {label: 'Office floor', count: [3, 6], placement: OFFICE_PLACEMENT, accept: {min: 'count', max: 'count'}},
      roof: {label: 'Roof', count: [0, 2], placement: OFFICE_PLACEMENT, accept: {min: null, max: 'count'}},
      // Track 2 (lane CONTENT): the street station's service annexes (LEVELS.office.trackExtensions) — the per-annex zone budget. Not
      // in OFFICE_SIREN_ELIGIBILITY.contexts: no Siren is ever drawn in an annex (her whole-level rarity and cap are unchanged).
      service: SERVICE_CONTEXT,
    },
    rooms: {},
    eligibility: {siren: OFFICE_SIREN_ELIGIBILITY},
  },
  // Task track3-eaton-centre-20261031: wired by lane GEN with LevelId 'mall' (the profile itself is lane PROFILES' MALL_SPAWN_PROFILE).
  mall: MALL_SPAWN_PROFILE,
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
// Task track1-siren-blightbelly-20261031 (lane SPAWN): spawn context tags + family eligibility (zombie fallback).

/**
 * Generation-time side table: the context of every spawn a placement routine appended (layout data unchanged, so no layout
 * fingerprint moves). Keyed by the layout object; garbage with it.
 */
const SPAWN_CONTEXTS = new WeakMap<object, SpawnContextId[]>();

/** A placement routine tags the spawns it appended (indices first .. zombies.length - 1) with its context. */
export function markSpawnContext(layout: {readonly zombies: readonly unknown[]}, first: number, context: SpawnContextId): void {
  let tags = SPAWN_CONTEXTS.get(layout);
  if (!tags) SPAWN_CONTEXTS.set(layout, (tags = []));
  for (let i = first; i < layout.zombies.length; i++) tags[i] = context;
}

/**
 * The generation context of spawn `index`: its tag, else — only when the profile declares exactly ONE context (unambiguous, e.g.
 * the Subway's 'station') — that context, else undefined (never eligible for a context-restricted family).
 */
export function spawnContextOf(layout: object, profile: SpawnProfile, index: number): SpawnContextId | undefined {
  const tag = SPAWN_CONTEXTS.get(layout)?.[index];
  if (tag) return tag;
  const ids = Object.keys(profile.contexts) as SpawnContextId[];
  return ids.length === 1 ? ids[0] : undefined;
}

/** The grid surface the eligibility checks read (gen/grid.ts Grid satisfies it). */
export interface EligibilityGrid {
  readonly w: number;
  readonly h: number;
  readonly area: ArrayLike<number>;
  walkable(x: number, y: number): boolean;
  cellOf(wx: number, wz: number): [number, number];
  center(x: number, y: number): [number, number];
}
/** The layout surface the eligibility checks read (gen/stationTypes.ts StationLayout satisfies it). */
export interface EligibilityLayout {
  readonly areas?: readonly (Pick<Area, 'type' | 'purpose'> & Partial<Pick<Area, 'kind' | 'w' | 'h'>>)[];
  readonly doors?: readonly Pick<Door, 'x' | 'y' | 'w' | 'h' | 'a' | 'b'>[];
  readonly levels?: readonly {readonly grid: EligibilityGrid}[];
  readonly grid?: EligibilityGrid;
}
export interface EligibilitySpawn {
  readonly x?: number;
  readonly z?: number;
  readonly area?: number;
  readonly level?: number;
}

/** Fair-passage pockets up to this many cells (between desks, behind a column) may be cut off. */
export const PASSAGE_NOOK_CELLS = 8;

/**
 * True when a disc of radius `r` (m) around (cx, cz) treated as impassable splits the walkable cells around it into more than one
 * region larger than PASSAGE_NOOK_CELLS (4-connected flood over the storey grid, outside the disc).
 */
export function sealsPassage(g: EligibilityGrid, cx: number, cz: number, r: number): boolean {
  const cell = g.center(1, 0)[0] - g.center(0, 0)[0];
  const [sx, sy] = g.cellOf(cx, cz);
  const rc = Math.ceil(r / cell) + 1;
  const inDisc = (x: number, y: number): boolean => { const [wx, wz] = g.center(x, y); return Math.hypot(wx - cx, wz - cz) <= r; };
  const free = (x: number, y: number): boolean => g.walkable(x, y) && !inDisc(x, y);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const boundary: number[] = [];
  for (let y = sy - rc; y <= sy + rc; y++) for (let x = sx - rc; x <= sx + rc; x++) {
    if (!free(x, y)) continue;
    if (N4.some(([ox, oy]) => inDisc(x + ox, y + oy) && g.walkable(x + ox, y + oy))) boundary.push(y * g.w + x);
  }
  const label = new Int32Array(g.w * g.h);
  const queue = new Int32Array(g.w * g.h);
  let big = 0;
  for (let k = 0, comp = 0; k < boundary.length; k++) {
    if (label[boundary[k]]) continue;
    comp++;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = boundary[k];
    label[boundary[k]] = comp;
    while (head < tail) {
      const i = queue[head++], x = i % g.w, y = (i - x) / g.w;
      size++;
      for (const [ox, oy] of N4) {
        const nx = x + ox, ny = y + oy, j = ny * g.w + nx;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h || label[j] || !free(nx, ny)) continue;
        label[j] = comp;
        queue[tail++] = j;
      }
    }
    if (size > PASSAGE_NOOK_CELLS && ++big > 1) return true;
  }
  return false;
}

const roomExcluded = (rule: FamilyEligibility, a: Pick<Area, 'purpose' | 'type'>): boolean =>
  !!rule.excludeRooms && (rule.excludeRooms.includes(a.type) || (a.purpose !== undefined && rule.excludeRooms.includes(a.purpose)));

/**
 * The first criterion of `rule` spawn `s` fails ('context', 'kind', 'room', 'size', 'clear', 'door', 'passage', 'geometry'), or
 * null when the spawn is eligible. Geometry the rule needs but the layout lacks (synthetic test layouts) fails: conservative.
 */
export function eligibilityFailure(rule: FamilyEligibility, layout: EligibilityLayout, s: EligibilitySpawn, context: SpawnContextId | undefined): string | null {
  if (context === undefined || !rule.contexts.includes(context)) return 'context';
  const a = s.area !== undefined ? layout.areas?.[s.area] : undefined;
  if (!a) return 'geometry';
  if (rule.kinds && (a.kind === undefined || !rule.kinds.includes(a.kind))) return a.kind === undefined ? 'geometry' : 'kind';
  if (roomExcluded(rule, a)) return 'room';
  if (rule.minSideCells !== undefined || rule.minAreaCells !== undefined) {
    if (a.w === undefined || a.h === undefined) return 'geometry';
    if ((rule.minSideCells !== undefined && Math.min(a.w, a.h) < rule.minSideCells) || (rule.minAreaCells !== undefined && a.w * a.h < rule.minAreaCells)) return 'size';
  }
  const needsGrid = rule.clearCells !== undefined || rule.doorKeepM !== undefined || rule.passageRadiusM !== undefined;
  if (!needsGrid) return null;
  const lv = s.level ?? 0;
  const g = layout.levels?.[lv]?.grid ?? (lv === 0 ? layout.grid : undefined);
  if (!g || s.x === undefined || s.z === undefined) return 'geometry';
  if (rule.clearCells !== undefined) {
    const [x, y] = g.cellOf(s.x, s.z), r = rule.clearCells;
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (!g.walkable(x + ox, y + oy) || g.area[(y + oy) * g.w + x + ox] !== s.area) return 'clear';
    }
  }
  if (rule.doorKeepM !== undefined) {
    if (!layout.doors) return 'geometry';
    for (const d of layout.doors) {
      if (d.a !== s.area && d.b !== s.area) continue;
      const [dx, dz] = g.center(d.x + (d.w - 1) / 2, d.y + (d.h - 1) / 2);
      if (Math.hypot(dx - s.x, dz - s.z) < rule.doorKeepM) return 'door';
    }
  }
  if (rule.passageRadiusM !== undefined && sealsPassage(g, s.x, s.z, rule.passageRadiusM)) return 'passage';
  return null;
}

/**
 * The family spawn `index` of `layout` takes: `drawn` when it has no eligibility rule in the profile or the spawn passes it, else
 * the rule's fallback (eligibility never consumes RNG and never changes another family's draw).
 */
export function eligibleFamily(
  profile: SpawnProfile, drawn: EnemyFamilyId, layout: EligibilityLayout & object, s: EligibilitySpawn, index: number,
  placedSoFar?: ReadonlyMap<EnemyFamilyId, number>,
): EnemyFamilyId {
  const rule = profile.eligibility?.[drawn];
  if (!rule) return drawn;
  if (rule.maxPerLevel !== undefined && (placedSoFar?.get(drawn) ?? 0) >= rule.maxPerLevel) return rule.fallback;
  return eligibilityFailure(rule, layout, s, spawnContextOf(layout, profile, index)) === null ? drawn : rule.fallback;
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

  known('profile', p, ['id', 'label', 'families', 'zombieTypes', 'contexts', 'levelMoves', 'rooms', 'eligibility', 'horde', 'spacing', 'budgets']);
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
  // --- task track3-eaton-centre-20261031 (lane PROFILES / INTEG): the horde pool, whole-level family spacing, ambient budgets
  const registry = ENEMY_FAMILY_IDS as readonly string[];
  if (p.contexts && typeof p.contexts === 'object' && own(p.contexts, HORDE_CONTEXT)) bad(`contexts.${HORDE_CONTEXT}`, 'reserved for the separate horde pool: declare it with `horde` (HordeRules), never as an ambient context');
  if (p.horde !== undefined) {
    issues.push(...validateHordeRules(p.horde, registry).map(s => `${p.id}: ${s}`));
    const fams = Array.isArray(p.horde?.families) ? p.horde.families : [];
    for (const f of registry) if (!fams.some(r => r[0] === f)) bad('horde.families', `family ${f} missing (list it with weight 0 to exclude it: the horde pool is explicit)`);
    for (const [f, w] of fams) if (HORDE_FORBIDDEN_FAMILIES.includes(f) && w > 0) bad('horde.families', `${f} never joins an ordinary-zombie horde`);
  }
  const sp = p.spacing;
  if (sp !== undefined && (!sp || typeof sp !== 'object')) bad('spacing', 'not a map');
  else if (sp) for (const [f, rule] of Object.entries(sp) as [string, FamilySpacing][]) {
    const path = `spacing.${f}`;
    if (!registry.includes(f)) bad(path, 'unknown family');
    else if (!(p.eligibility && own(p.eligibility, f))) bad(path, `refines eligibility.${f}: declare that rule (its maxPerLevel is the cap the spacing shares)`);
    if (!rule || typeof rule !== 'object') { bad(path, 'not a rule'); continue; }
    known(path, rule, ['spacingM', 'why']);
    if (!(finiteNonNeg(rule.spacingM) && rule.spacingM > 0)) bad(`${path}.spacingM`, `${String(rule.spacingM)} is not a finite distance > 0`);
    if (typeof rule.why !== 'string' || !rule.why.trim()) bad(`${path}.why`, 'needs a reason');
  }
  if (p.budgets !== undefined) {
    const b = p.budgets?.ambient;
    if (!b || typeof b !== 'object') bad('budgets.ambient', 'missing');
    else {
      known('budgets', p.budgets, ['ambient']);
      known('budgets.ambient', b, ['total', 'perStorey']);
      int('budgets.ambient.total', b.total);
      int('budgets.ambient.perStorey', b.perStorey);
      if (nonNegInt(b.perStorey)) for (const [id, c] of Object.entries(p.contexts ?? {}) as [string, SpawnContextRule][]) {
        if (c && Array.isArray(c.count) && nonNegInt(c.count[1]) && c.count[1] > b.perStorey) bad(`budgets.ambient.perStorey`, `${b.perStorey} < context ${id}'s count hi ${c.count[1]}`);
      }
      if (nonNegInt(b.total) && nonNegInt(b.perStorey) && b.total < b.perStorey) bad('budgets.ambient.total', `${b.total} < perStorey ${b.perStorey}`);
    }
  }
  // --- family eligibility (task track1-siren-blightbelly-20261031, lane SPAWN)
  const el = p.eligibility;
  if (el !== undefined && (!el || typeof el !== 'object')) bad('eligibility', 'not a map');
  else if (el) for (const [f, rule] of Object.entries(el) as [string, FamilyEligibility][]) {
    const path = `eligibility.${f}`;
    if (!(ENEMY_FAMILY_IDS as readonly string[]).includes(f)) bad(path, 'unknown family');
    if (!rule || typeof rule !== 'object') { bad(path, 'not a rule'); continue; }
    known(path, rule, ['contexts', 'kinds', 'excludeRooms', 'minSideCells', 'minAreaCells', 'clearCells', 'doorKeepM', 'passageRadiusM', 'maxPerLevel', 'fallback', 'why']);
    if (!Array.isArray(rule.contexts) || !rule.contexts.length) bad(`${path}.contexts`, 'needs at least one context');
    else for (const c of rule.contexts) {
      if (!(SPAWN_CONTEXT_IDS as readonly string[]).includes(c)) bad(`${path}.contexts`, `unknown spawn context ${c}`);
      else if (c === HORDE_CONTEXT) bad(`${path}.contexts`, 'hordes are a separate pool with their own explicit families: no ambient family rule applies there (lane INTEG)');
      else if (!p.contexts || !own(p.contexts, c)) bad(`${path}.contexts`, `context ${c} is not declared by this profile`);
    }
    for (const k of rule.kinds ?? []) if (!own(AREA_KINDS, k)) bad(`${path}.kinds`, `unknown area kind ${k}`);
    for (const k of rule.excludeRooms ?? []) if (!roomKeys.has(k)) bad(`${path}.excludeRooms`, `unknown room key ${k}`);
    for (const k of ['minSideCells', 'minAreaCells', 'clearCells', 'maxPerLevel'] as const) if (rule[k] !== undefined) int(`${path}.${k}`, rule[k]);
    for (const k of ['doorKeepM', 'passageRadiusM'] as const) if (rule[k] !== undefined) num(`${path}.${k}`, rule[k]);
    if (!(ENEMY_FAMILY_IDS as readonly string[]).includes(rule.fallback)) bad(`${path}.fallback`, `unknown family ${String(rule.fallback)}`);
    else if (rule.fallback === f) bad(`${path}.fallback`, 'falls back to itself');
    else if (own(el, rule.fallback)) bad(`${path}.fallback`, `${rule.fallback} has an eligibility rule of its own (the fallback must always be valid)`);
    if (typeof rule.why !== 'string' || !rule.why.trim()) bad(`${path}.why`, 'needs a reason');
  }
  // --- opt-in families: a weight > 0 needs an explicit eligibility rule (the Siren is never enabled by default / by tier)
  if (Array.isArray(p.families)) for (const [f, w] of p.families) {
    if (OPT_IN_FAMILIES.includes(f) && finiteNonNeg(w) && w > 0 && !(el && own(el, f))) bad(`families.${f}`, `opt-in family with weight ${w} needs an eligibility.${f} rule (where it may spawn)`);
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Lane INTEG (task track3-eaton-centre-20261031, Track1 integration): the contexts a profile declares

/**
 * Every context tag a spawn of a level built from `p` may carry: the ambient `contexts` (annex contexts included) plus
 * HORDE_CONTEXT when the profile declares a horde pool. tests/enemy-spawn-contract.test.ts checks every placed spawn against it.
 */
export function declaredSpawnContexts(p: SpawnProfile): SpawnContextId[] {
  const ids = Object.keys(p.contexts) as SpawnContextId[];
  return p.horde ? [...ids, HORDE_CONTEXT] : ids;
}
