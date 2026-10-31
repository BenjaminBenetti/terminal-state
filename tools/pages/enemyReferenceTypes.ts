// Task enemy-spawn-tables-20261030 (lane SPAWN): THE CONTRACT of the source-generated ENEMY SPAWN reference.
//
// `buildEnemyReference()` (tools/pages/enemyReference.ts) reads ONLY the real exported spawn profile API (game/src/ai/spawnTables.ts:
// SPAWN_PROFILES / spawnProfile, the family registry, the resolution functions) plus the registered levels (levels/registry.ts) and
// returns ONE `EnemyReference` object. The site renderer (lane SITE, tools/pages/render/*) renders ONLY from this object: it never
// imports game modules and never holds numbers of its own. Plain JSON (no Map / Set / functions), deterministic for a fixed source
// tree (no timestamps; commit / build id come from the caller). Guide: docs/enemy-spawns.md.
//
// UNITS / VOCABULARY (repeated in `vocabulary` for the pages):
//  - count range     the generator draws ONE uniform integer U{lo..hi} per run of a generation context (rng.int, inclusive). That is
//                    the number of spawns it TRIES to place; E[count] = (lo + hi) / 2 exactly. The runtime has NO per-area density:
//                    enemies are a count per context, spread over eligible areas.
//  - area weight     RELATIVE preference of an area in the weighted area order (Efraimidis–Spirakis keys u^(1/w)). It is never a
//                    chance and never a count: it decides which areas are visited first in each cap pass.
//  - cap             max spawns one area may hold after pass k (passes 1, 2, 3); platforms / closets / storefronts have own caps.
//  - family weight   relative weight of an enemy family in the level's pool; share = weight / denominator is the CONDITIONAL chance
//                    that one placed spawn is that family (an independent per-spawn roll that REPLACES a zombie).
//  - placed count    what the generator actually placed: can be BELOW the count when areas run out of eligible, spaced cells.
//  - sampled density enemies per 100 m² of ELIGIBLE floor (cells the generator's own candidate filter accepted, 0.25 m² each),
//                    measured over a small labelled seed corpus. Never from map bounding boxes. A census, not a runtime rule.
//  - room modifiers  per room key (area purpose id, else room type) and family: density (local intensity) and weight (conditional
//                    composition); missing = 1 (neutral). Shipped values: none / all 1.
//  - eligibility     (task track1-siren-blightbelly-20261031, schema 2) a family with an eligibility rule only takes placed slots where
//                    the rule holds; a draw elsewhere becomes the rule's fallback family (a zombie). Its placed share is therefore
//                    BELOW its draw share and is MEASURED (sampled eligibility census), never derived from the weight alone.
//  - tier            the level's explicit difficulty tier (levels/registry.ts LEVELS[id].tier): metadata, no scaling.
//  - family stats    combat / behaviour figures read from each family's exported constants (health hp, speeds m/s, reach m, damage
//                    hp per hit, times s); wake rules and the death burst where a family has them.

import type {SourceLoc} from './lootReferenceTypes';

export type {SourceLoc};

/** Bump when the shape changes incompatibly (the renderer may check it). 2 = task track1: tiers, family stats, eligibility. */
export const ENEMY_REFERENCE_SCHEMA = 2;

export type Range = readonly [lo: number, hi: number];

export interface EnemyReference {
  meta: EnemyReferenceMeta;
  /** Definitions of every unit / term the pages use (show near the tables). */
  vocabulary: readonly VocabEntry[];
  /** What the room modifiers mean (same for every level). */
  modifiers: ModifierSemantics;
  /** Every enemy family of the archetype registry (ai/creatureArchetypes.ts ENEMY_ARCHETYPES), in registry order. */
  families: readonly EnemyFamilyInfo[];
  /** Every registered logical level (levels/registry.ts LEVEL_IDS order). */
  levels: readonly EnemyLevelInfo[];
}

export interface EnemyReferenceMeta {
  schema: number;
  /** Source commit (GITHUB_SHA, else `git rev-parse HEAD`, else 'local') — supplied by the caller. */
  commit: string;
  /** Build id supplied by the caller; defaults to `dataHash`. */
  buildId: string;
  /** FNV-1a hash of the data (everything but meta.commit / meta.buildId). */
  dataHash: string;
  /** Repo-relative game files the values were read from. */
  generatedFrom: readonly string[];
  repo: {url: string; private: boolean; note: string};
  /** The sampled census corpus per level (empty when the census is disabled). Labelled "sampled" wherever its numbers appear. */
  census: readonly CensusCorpus[];
}

export interface CensusCorpus {
  level: string;
  seeds: readonly number[];
  startWeapon: 'pistol' | 'rifle';
  note: string;
}

export interface VocabEntry {
  /** 'count range', 'E[count]', 'area weight', 'cap', 'family weight', 'share', 'placed', 'sampled density', 'density', 'weight'. */
  term: string;
  /** Native unit ('spawns per run', 'relative (no unit)', 'enemies per 100 m² eligible floor (sampled)', ...). */
  unit: string;
  definition: string;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Room modifier semantics

export interface ModifierSemantics {
  /** How a room key is formed and resolved ("area purpose id, then room type; missing = 1"). */
  key: string;
  /** The neutral value (1). */
  neutral: number;
  fields: readonly ModifierFieldInfo[];
  /** The reserved family key 'all' (density applies to every family of the room). */
  allFamilies: string;
  /** How caps / spacing / count interact with the modifiers. */
  caps: string;
  /** Why × 1 is bit-identical (neutral = the shipped behaviour exactly). */
  neutralParity: string;
  notes: readonly string[];
  at: SourceLoc;
}

export interface ModifierFieldInfo {
  field: 'density' | 'weight';
  /** 'local intensity' (density) | 'conditional composition' (weight). */
  changes: string;
  /** Plain formula, e.g. "area weight × D(room), D = Σ p·w·d / Σ p·w". */
  formula: string;
  /** What 0 does. */
  zero: string;
  /** What 2 does. */
  two: string;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Families

export interface EnemyFamilyInfo {
  /** Registry id ('zombie', 'ratdog'). */
  id: string;
  /** Registry label ('Infected', 'Tunnel scavenger (rat/dog)'). */
  label: string;
  /** Model key (null = the zombie wardrobe). */
  model: string | null;
  /**
   * Sub-distributions INSIDE this family that are not families (zombie: the shambler / coated type roll and the wardrobe
   * outfits chosen at spawn time); null = none.
   */
  variants: string | null;
  /** Levels whose pool gives this family weight > 0. */
  levels: readonly string[];
  at: SourceLoc;
  /** Task track1 (schema 2): combat figures per variant, read from the family's exported stats (brain.ts ZombieStats shape). */
  stats: readonly FamilyStatsVariant[];
  /** Task track1 (schema 2): behaviour rules read from the family's exported constants (wake rules, death burst, lunge); [] = none. */
  rules: readonly FamilyRuleGroup[];
}

/** One stats block (the zombie has one per type: shambler / coated; other families one, variant null). */
export interface FamilyStatsVariant {
  variant: string | null;
  /** Health (hp). */
  hp: number;
  /** m/s. */
  wanderSpeed: number;
  chaseSpeed: number;
  /** Attack range (m, centre to centre) and damage per hit (hp). */
  attackRange: number;
  attackDamage: number;
  /** Swing length and the moment it lands (s). */
  attackDuration: number;
  attackImpact: number;
  /** Recovery after a swing (s); null = the brain's default. */
  attackCooldown: number | null;
  /** Sight range when awake (m). */
  sightRange: number;
  /** Body radius (m). */
  radius: number;
  at: SourceLoc;
}

export interface FamilyRuleGroup {
  /** 'Dormant wake', 'Death burst', 'Claw lunge' … */
  title: string;
  rows: readonly {what: string; value: number | string; unit: string}[];
  at: SourceLoc;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Levels

export interface EnemyLevelInfo {
  /** LevelId ('subway', 'office'). */
  id: string;
  name: string;
  blurb: string;
  /** Task track1 (schema 2): the explicit difficulty tier (Subway 0, Office 1) — metadata only. */
  tier: {value: number; at: SourceLoc; note: string};
  profile: {label: string; at: SourceLoc};
  /** The real generator that reads this profile. */
  generator: {fn: string; at: SourceLoc; note: string};
  /** Spawns the level's contexts TRY to place in total: Σ runs × count (exact range / mean), before any placement shortfall. */
  total: {lo: number; hi: number; mean: number; note: string};
  contexts: readonly SpawnContextInfo[];
  pool: FamilyPoolInfo;
  zombieTypes: ZombieTypeInfo;
  /** Subway only: the storey moves after placement (gen/levelGenDress.ts placeLevelSpawns); null = the level has none. */
  levelMoves: LevelMovesInfo | null;
  rooms: RoomModifierTable;
  /** Sampled census of the real generator (null when disabled). */
  census: LevelCensus | null;
  /** Task track1 (schema 2): sampled census of the families with an eligibility rule (null = none restricted / census disabled). */
  eligibilityCensus: EligibilityCensus | null;
  /** Where to tune what. */
  knobs: readonly EnemyKnob[];
}

export interface SpawnContextInfo {
  /** Profile context id: 'station' (Subway); 'street' | 'floor' | 'roof' (Office, one logical level). */
  id: string;
  label: string;
  /** Which storeys ONE run covers ("main level (then storey moves)", "station + lobby (levels 0 + 1)", "one office floor"). */
  storeys: string;
  /** Runs per level (Office floor: once per office floor 2..8 = 7). */
  runs: number;
  /** Per run: U{lo..hi}, mean = (lo + hi) / 2. */
  count: {lo: number; hi: number; mean: number; distribution: string};
  /** runs × count. */
  perLevel: {lo: number; hi: number; mean: number};
  placement: PlacementInfo;
  /** Validation rules that reject a whole generation attempt (the generator retries with another attempt seed). */
  rejection: readonly string[];
  at: SourceLoc;
}

export interface PlacementInfo {
  areaWeights: {
    /** First matching rule wins; a rule matches when ANY of its criteria matches. */
    rules: readonly {match: string; weight: number; why: string}[];
    otherwise: number;
    note: string;
  };
  caps: {
    /** Pass caps in order (1, 2, 3): an ordinary area may hold up to the pass cap after that pass. */
    passes: readonly number[];
    rules: readonly {match: string; cap: string; why: string}[];
    otherwise: string;
    note: string;
  };
  triesPerArea: number;
  spacing: {metres: number; scope: string};
  /** Keep-away rules: walking distance from the start, clearance, landing keep-off … */
  keepAway: readonly {rule: string; value: number; unit: string; metres: number | null}[];
  /** Plain-language eligibility of a candidate cell (in order). */
  eligibility: readonly string[];
  /** Plain-language walk-through of the placement (why spacing / eligibility / caps change outcomes). */
  explanation: readonly string[];
  at: SourceLoc;
}

export interface FamilyPoolInfo {
  denominator: number;
  /** share = weight / denominator = the DRAW share; `restricted` = the family has an eligibility rule (placed share is lower). */
  rows: readonly {family: string; weight: number; share: number; restricted?: boolean}[];
  /** How the roll works (independent per-spawn roll keyed on (level seed, spawn index), REPLACES a zombie). */
  roll: string;
  /**
   * Expected spawns of each family per level, before placement shortfall. basis 'exact' = share × total.mean (no eligibility rule
   * touches the family); 'sampled' = measured by the eligibility census (a restricted family and its fallback); mean null = not
   * measured in this build (census disabled).
   */
  expectedPerLevel: readonly {family: string; mean: number | null; basis: 'exact' | 'sampled'}[];
  /** Task track1 (schema 2): the eligibility rules of the profile (one per restricted family; [] = none). */
  eligibility: readonly EligibilityInfo[];
  at: SourceLoc;
}

export interface EligibilityInfo {
  family: string;
  /** Generation contexts the family may take (every other context's draws fall back). */
  contexts: readonly string[];
  /** Plain-language criteria, in check order. */
  criteria: readonly string[];
  fallback: string;
  /** At most this many per generated level (all contexts), null = no cap. */
  maxPerLevel: number | null;
  why: string;
  at: SourceLoc;
}

export interface EligibilityCensus {
  seeds: readonly number[];
  layouts: number;
  note: string;
  /** Placed spawns per family over the sample (all families). */
  placed: readonly {family: string; total: number; perLevel: number; share: number}[];
  restricted: readonly {
    family: string;
    /** Spawns whose roll drew the family, and how many of those it actually took. */
    draws: number;
    placed: number;
    /** Placed per level: mean, layouts with none, max, and the histogram. */
    perLevel: {mean: number; none: number; max: number; histogram: readonly {count: number; layouts: number}[]};
    /** Draws that fell back, by the first failed criterion. */
    fallbacks: readonly {reason: string; draws: number}[];
    byContext: readonly {context: string; placed: number}[];
  }[];
}

export interface ZombieTypeInfo {
  /** Per-spawn type chances (coated / shambler) before the at-least-one-each fix. */
  types: readonly {type: string; chance: number}[];
  atLeastOneEach: boolean;
  rule: string;
  /** EXACT expected coated share of one context run of n spawns incl. the fix: (n·c + (1−c)^n − c^n) / n (n ≥ 2), at lo / hi. */
  expectedCoated: readonly {context: string; count: number; share: number}[];
  /** Appearance (wardrobe outfits) note: a zombie sub-distribution, NOT a family. */
  appearance: string;
  at: SourceLoc;
}

export interface LevelMovesInfo {
  what: string;
  /** Plain formula of how many spawns move off the main level. */
  formula: string;
  /** "same as the station context" or its own rules. */
  areaWeights: string;
  mainKeep: number;
  passes: number;
  triesPerArea: number;
  spacing: {metres: number; verticalMetres: number};
  keepAwayCells: number;
  at: SourceLoc;
}

export interface RoomModifierTable {
  /** Explicit entries of the profile's `rooms` (shipped: none). density / weight null = not set (= 1). */
  entries: readonly {room: string; family: string; density: number | null; weight: number | null}[];
  /** Every room key this level can produce (generator catalog ∪ sampled census), resolved per family. Sorted by key. */
  rows: readonly RoomRow[];
  note: string;
}

export interface RoomRow {
  room: string;
  keyKind: 'purpose' | 'room-type';
  label: string;
  /**
   * Room types of the sampled areas carrying this key, with their labels (null = not sampled). A purpose can sit on several
   * types — e.g. the Office roof deck (type 'office-roof') carries the preset purpose 'office-stair' ("Stairwell"), so a modifier
   * meant for the roof targets the room type 'office-roof' (the purpose → room type fallback reaches it).
   */
  types: readonly {type: string; label: string}[] | null;
  /** Resolved modifiers per family (1 = neutral); `from` = 'profile' when an explicit entry supplied a value, else 'default'. */
  families: readonly {family: string; density: number; weight: number; from: 'default' | 'profile'}[];
  /** Resolved room intensity multiplier D(room) applied to the area weight (1 = neutral). */
  intensity: number;
  /** Distinct baseline area weights areas with this key had in the sampled census (null = not sampled). */
  baselineWeights: readonly number[] | null;
  /** Sampled census of this key (null = not observed). */
  observed: RoomCensus | null;
}

export interface RoomCensus {
  /** Sample layouts in which the key occurred. */
  samples: number;
  /** Areas with this key over the sample. */
  areas: number;
  /** Eligible candidate cells (the generator's own filter) and their floor area. */
  eligibleCells: number;
  eligibleM2: number;
  /** Placed spawns per family over the whole sample. */
  placed: Readonly<Record<string, number>>;
  /** All placed per 100 m² of eligible floor (null when eligibleM2 = 0). SAMPLED. */
  per100m2: number | null;
}

export interface LevelCensus {
  seeds: readonly number[];
  startWeapon: 'pistol' | 'rifle';
  layouts: number;
  cellM2: number;
  eligibleCells: number;
  eligibleM2: number;
  /** Placed spawns per family: total over the sample, mean per level, per 100 m² eligible floor. SAMPLED. */
  placed: readonly {family: string; total: number; perLevel: number; per100m2: number}[];
  byContext: readonly {context: string; eligibleM2: number; placed: number; perLevel: number; per100m2: number | null}[];
  byAreaKind: readonly {kind: string; eligibleM2: number; placed: Readonly<Record<string, number>>; per100m2: number | null}[];
  /** Zombie-family spawns by type over the sample. */
  zombieTypes: Readonly<Record<string, number>>;
  note: string;
}

export interface EnemyKnob {
  what: string;
  value: number | Range | string;
  at: SourceLoc;
  note?: string;
}
