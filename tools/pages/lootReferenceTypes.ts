// Task loot-reference-pages-20261030 (lane DATA): THE CONTRACT of the source-generated loot reference.
//
// `buildLootReference()` (tools/pages/lootReference.ts) reads the REAL exported game values (items/lootTables.ts and its
// consumers: items/loot.ts, items/lootEconomy.ts, gen/purposes.ts, world/openablesSpec.ts, gen/stationDress.ts, gen/office/*,
// gen/gearLoot.ts, gen/maskLoot.ts, gen/weaponFinds.ts, run/starter.ts, levels/registry.ts) and returns ONE `LootReference`
// object. The site renderer (lane SITE) renders ONLY from this object: it never imports game modules and never holds numbers of
// its own. Everything here is plain JSON (no Map / Set / functions / undefined-vs-missing games), deterministic for a fixed source
// tree (no timestamps; the commit / build id come from the caller).
//
// PROBABILITY VOCABULARY (docs/loot-reference.md "Probability definitions"; repeated in `probability` below):
//  - `weight`      relative weight of a row inside ONE table. Never a chance on its own.
//  - `share`       weight / `denominator` of that table = the CONDITIONAL selection chance of the row GIVEN that one lot is drawn
//                  from that table in that context. Always shown with its denominator.
//  - stage gates   per holder: empty chance -> lot count U{lo..hi} -> per-lot pick -> scarcity keep / re-theme -> limb post-pass
//                  -> fit / occupancy (NOT derivable) -> finite, persistent contents.
//  - `expected*`   EXACT expectations under the roll's stated distribution (ideal uniform draws) BEFORE fit / placement, derived
//                  analytically from the same values the roll functions read, and checked against the real roll functions in
//                  game/tests/loot-reference.test.ts. They are upper bounds of what ends up placed.
//  - No per-level "chance to find X" is ever stated: how many holders of a kind a level has is a generator outcome (only a small
//    labelled sample census is shown).

/**
 * IDS (table ids, context ids, special ids) are stable strings built from export paths and may contain ':', '@', '.', '[', ']',
 * '~', '#' and '-' (e.g. 'OPENABLE_TABLES.bin', 'narrowed:desk@OFFICE_DESK', 'office/desk.inside@office-open',
 * 'ROOF_CACHE.picks[0]', 'reward:roof-cache'): encode them for URLs / HTML ids.
 */
/** Bump when the shape changes incompatibly (the renderer may check it). */
export const LOOT_REFERENCE_SCHEMA = 1;

export type Range = readonly [lo: number, hi: number];

/**
 * How a source behaves (site labels):
 *  - guaranteed       always yields its contents (starter kit, the roof cache's picks: empty 0, lots >= 1);
 *  - conditional      table-driven, gated by chances (holders, floor programs, mask / filter counts);
 *  - special          an explicit exception outside the holder tables (rare gear, weapon finds + paired ammo, the reward rule);
 *  - non-loot         rolls nothing / moves existing lots only (fixtures' baked contents, pry / spill / detach rules);
 *  - decoration-only  looks like stock but is not an item (shelf filler stock).
 */
export type SourceClass = 'guaranteed' | 'conditional' | 'special' | 'non-loot' | 'decoration-only';

/**
 * The per-level override knob (items/lootTables.ts LootOverrides) that reaches a value. 'tables' = only by giving the profile its
 * own rate tables (`tables: {...BASE_TABLES, ...}`); 'rewards' = by replacing `tables.rewards`; 'none' = no override reaches it
 * (edit the source value itself).
 */
export type OverrideKnob =
  | 'itemWeight' | 'categoryWeight' | 'keep' | 'slot.empty' | 'slot.lots' | 'floor.chance' | 'floor.count'
  | 'gear.mean' | 'gear.cap' | 'gear.weight' | 'rewards' | 'tables' | 'none';

/** Where a value lives in the (PRIVATE) repository: links need repository access. */
export interface SourceLoc {
  /** Repo-relative path, e.g. 'game/src/items/lootTables.ts'. */
  file: string;
  /** Export (or path below an export), e.g. 'OPENABLE_TABLES.bin', 'STORE_PURPOSES.burger.loot.shopCounter', 'placeSpawns'. */
  symbol: string;
  /** 1-based line of the declaration when the generator could find it (optional: links fall back to the file). */
  line?: number;
}

/** A tunable value: where it lives and which override reaches it. */
export interface TuningKnob {
  /** What it is ("empty chance", "row weights", "lot range", "keep chance (food)"). */
  what: string;
  /** Current value as shown (number / range / short text). */
  value: number | Range | string;
  at: SourceLoc;
  overrides: readonly OverrideKnob[];
  note?: string;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Meta

export interface LootReferenceMeta {
  schema: number;
  /** Source commit (GITHUB_SHA, else `git rev-parse HEAD`, else 'local') — supplied by the caller. */
  commit: string;
  /** Build id supplied by the caller (CI run id / 'local'); defaults to `dataHash`. */
  buildId: string;
  /** FNV-1a hash of the data (everything but meta.commit / meta.buildId): equal source -> equal hash. */
  dataHash: string;
  /** Repo-relative game files the values were read from. */
  generatedFrom: readonly string[];
  repo: {url: string; private: boolean; note: string};
  /** The small fixed-seed census used to mark which holder contexts occur in which level (not exhaustive). */
  census: readonly CensusInfo[];
}

export interface CensusInfo {
  level: string;
  seeds: readonly number[];
  startWeapon: 'pistol' | 'rifle';
  /** Loot holders found over all sample levels (props that are loot holders, as ContainerManager.build indexes them). */
  holders: number;
  /** Distinct (holder kind, area key) contexts observed. */
  contexts: number;
  note: string;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Items

/** Display group of an item (economy category where it has one). */
export type ItemGroup = 'food' | 'drink' | 'med' | 'ammo' | 'battery' | 'flare' | 'material' | 'gear' | 'supply' | 'weapon'; // + material: lane RACK (office-props-physics-scale-20261030)

export interface ItemInfo {
  id: string;
  name: string;
  short: string;
  /** items/items.ts ItemDef.kind. */
  kind: string;
  /** Economy category (items/lootTables.ts econCat; null = not a consumable resource: weapons, gear, supplies). */
  econ: string | null;
  group: ItemGroup;
  caliber?: string;
  stackMax: number;
  /** Ids of every table (LootReference.tables) whose rows name it. */
  tables: readonly string[];
  /** Ids of every non-holder source (floor programs, special sources) that can produce it. */
  sources: readonly string[];
}

export interface ItemGroupInfo { id: ItemGroup; label: string; items: readonly string[] }

// ---------------------------------------------------------------------------------------------------------------------------
// Tables (deduplicated: a shared table appears ONCE and lists the contexts that use it)

export type TableKind =
  | 'named'          // a named shared export of lootTables.ts (STORE_DRINKS, CACHE_CRATE, TENANT_*, *_ROWS ...)
  | 'openable'       // OPENABLE_TABLES.<kind> (own table of an openable container / a desk-style compartment)
  | 'purpose'        // a purpose's own table for a holder kind (gen/purposes.ts) that is not a named export
  | 'purpose-merged' // purposeLoot() fallback: every row the purpose stocks, summed (holder kinds the purpose does not list)
  | 'narrowed'       // an openable's own rows narrowed to what the room purpose stocks (items/loot.ts purposeRows)
  | 'legacy'         // plain-room tables flattened: AREA_WEIGHTS x HOLDER_MOD categories x LEGACY_POOL items
  | 'pool'           // GLOBAL_POOL / LEGACY_POOL / VENDING_FOOD category pools
  | 'reward-pick'    // one pick of a curated reward (ROOF_CACHE.picks[i])
  | 'limb';          // LIMB_ECONOMY.pool (limb-treatment conversion)

export interface TableRow {
  itemId: string;
  /** Relative weight (resolved under the profile; baseline = the source value). */
  weight: number;
  /** weight / denominator: conditional selection share GIVEN one draw from this table. */
  share: number;
}

export interface LootTableInfo {
  id: string;
  label: string;
  kind: TableKind;
  rows: readonly TableRow[];
  /** Σ weights (the share denominator). 0 for an empty table. */
  denominator: number;
  /** The table's own lot range / empty chance when it declares them (undefined: the holder kind's default applies). */
  lots?: Range;
  empty?: number;
  /** `rows` is [] — an intentional "no loot" table (nothing is drawn). */
  emptyTable: boolean;
  /** Shared row list it uses, when that is a named export (e.g. OPENABLE_TABLES.bin -> 'JUNK_ROWS'). */
  rowsFrom?: string;
  /** Base table it was derived from (narrowed / merged / legacy). */
  derivedFrom?: readonly string[];
  at: SourceLoc;
  knobs: readonly TuningKnob[];
  /** HolderContext ids (all levels) that draw from it; special-source ids for pools / picks. */
  usedBy: readonly string[];
  /** Declared but not observed in any sample level (still a real table). */
  unobserved?: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Slots and holder kinds

export interface SlotInfo {
  /** One of the 12 SLOT_CATEGORIES. */
  id: string;
  label: string;
  description: string;
  /** HOLDER_SLOTS kinds in this slot. */
  holderKinds: readonly string[];
  /** Kinds whose SEPARATE compartment roll (drawers / cupboards) is classified here (COMPARTMENT_SLOT). */
  compartmentOf: readonly string[];
  knobs: readonly TuningKnob[];
}

export interface HolderKindInfo {
  kind: string;
  label: string;
  slot: string;
  /** items/loot.ts: 'container' (opens) or 'surface' (open top / shelf; may gain compartments). */
  group: 'container' | 'surface';
  /** Has an openable spec (world/openablesSpec.ts). */
  openable: boolean;
  /** OPENABLE_TABLES own table (containers) — rolled whatever the room (narrowed unless container-themed). */
  ownTable?: string;
  /** Separate compartment table (desk / security-desk drawers, kitchenette cupboards). */
  compartmentTable?: string;
  /** HOLDER_EMPTY / HOLDER_LOTS / HOLDER_MOD defaults (purpose tables without own lots / empty use them). */
  defaults: {empty?: number; lots?: Range; mod?: readonly number[]};
  /** HOLDER_ALLOW (null: takes any category). */
  allow: readonly string[] | null;
  containerThemed: boolean;
  randomHolder: boolean;
  bigBoxes: boolean;
  /** LIMB_ECONOMY.holder share (overrides a lower theme share). */
  limbShare?: number;
  /** Light dynamic holder that spills its finite lots when shot loose. */
  spill: boolean;
  /** Fixture: baked contents text, no loot. */
  fixtureContents?: string;
  generated: boolean;
  class: SourceClass;
  knobs: readonly TuningKnob[];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Holder contexts (per level): one (holder kind, compartment?, area key) as holderTable() resolves it under the level profile

export interface StageGates {
  /** Resolved empty chance (slotEmpty applied). */
  empty: number;
  /** 1 - empty (and 0 when the table is empty / the slot rolls 0 lots). */
  pNotEmpty: number;
  lots: Range;
  /** E[n] = (lo + hi) / 2 given the holder is not empty (exact). */
  expectedLotsIfRolled: number;
  /** Legacy plain-room tables: the category stage (room type x holder modifier, resolved), with conditional shares. */
  categories?: readonly {cat: string; weight: number; share: number}[];
  /** FULL_ROOMS extra lots applied at the high end (legacy shelves / stalls in stocked rooms). */
  fullRoomsExtra?: number;
  /** BOX_COUNT uses the `big` ranges (BIG_BOX_HOLDERS). */
  bigBoxes: boolean;
}

export interface ScarcityStage {
  /** Curated reward: rolled exactly — no keep cut, no re-theme, no limb conversion. */
  exempt: boolean;
  theme: string;
  /** Where the theme comes from. */
  themeFrom: 'purpose' | 'room-type' | 'random-holder' | 'default-public';
  /** Resolved keep chance per economy category (ammo: always 1 — kept exactly as rolled). */
  keep: Readonly<Record<string, number>>;
  /** Chance a kept find is on-theme. */
  on: number;
  onCats: readonly string[];
  /** On-theme re-pick categories AFTER the allow filter, with conditional shares (empty: the rolled item stays). */
  onPick: readonly {cat: string; weight: number; share: number}[];
  /** Off-theme pick over every off-theme category (BEFORE the allow filter, as the code draws it); `allowed` false -> the rolled item stays. */
  offPick: readonly {cat: string; weight: number; share: number; allowed: boolean}[];
  /** HOLDER_ALLOW list (null = any). */
  allow: readonly string[] | null;
  /** Limb post-pass: share of HP-med finds converted to a limb treatment, and where the share comes from. */
  limbShare: number;
  limbFrom: 'theme' | 'holder';
  /** Re-themed ammo source: 'own-rows' or 'global-pool' (security rooms always use the generic pool). */
  securityAmmoFromPool: boolean;
}

export interface ExpectedItem {
  itemId: string;
  /** Expected lots of this item from the ORIGINAL table roll (before scarcity), per holder. */
  rawLots: number;
  rawUnits: number;
  /** Expected lots / units after scarcity + limb post-pass, BEFORE fit / placement, per holder. */
  lots: number;
  units: number;
  /** P(the holder's rolled contents include >= 1 of this item), before fit (exact; independent per-lot outcomes). */
  pAtLeastOne: number;
}

export interface ExpectedUnits {
  basis: 'exact-before-fit';
  items: readonly ExpectedItem[];
  rawLots: number;
  rawUnits: number;
  lots: number;
  units: number;
  /** P(the holder's rolled contents are non-empty), before fit. */
  pAny: number;
  /** Per display group: expected lots / units after scarcity, before fit. */
  byGroup: Readonly<Record<string, {lots: number; units: number}>>;
}

export interface OccurrenceInfo {
  /** 'observed' = seen in the sample census; 'declared' = a purpose / table declares it but no sample level placed it. */
  basis: 'observed' | 'declared';
  /** Sample levels (of `samples`) in which at least one such holder was placed. */
  levelsObserved: number;
  samples: number;
  /** Holders seen over all sample levels. */
  holdersObserved: number;
  /** Office: storey labels where observed ('Station', 'Lobby', 'Floor 2' .. 'Floor 8', 'Roof'). */
  storeys?: readonly string[];
  /** Office: tenant companies whose floors held it (company ids). */
  companies?: readonly string[];
}

export interface HolderContext {
  /** `${level}/${kind}[.inside]@${areaKey}` */
  id: string;
  level: string;
  kind: string;
  kindLabel: string;
  slot: string;
  /** The separate compartment roll (drawers / cupboards) of a desk-style holder. */
  compartment: boolean;
  /** Loot key: purpose id, plain room type, 'default' or a reward key. */
  areaKey: string;
  areaLabel: string;
  areaKind: 'purpose' | 'room-type' | 'default' | 'reward-key';
  /** holderTable() source. */
  source: 'own' | 'purpose' | 'legacy' | 'fixture' | 'reward';
  /** Table id (LootReference.tables); null for fixtures. */
  tableId: string | null;
  /** Reward picks (source 'reward'), in roll order. */
  rewardPicks?: readonly string[];
  gates: StageGates;
  scarcity: ScarcityStage;
  /**
   * Task track3-eaton-centre-20261031 (lane PROFILES): the level's SALVAGE rows this holder's table gained (crafting materials kept
   * exactly as rolled; `share` = their part of the table weight before overrides; `from` = the purpose entry or the loot theme).
   */
  salvage?: {from: string; share: number; rows: readonly TableRow[]};
  /** null for fixtures. */
  expected: ExpectedUnits | null;
  occurrence: OccurrenceInfo;
  class: SourceClass;
  notes: readonly string[];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Economy (resolved per level profile)

export interface ThemeInfo {
  id: string;
  keep: number;
  on: number;
  cats: readonly string[];
  weights: readonly {cat: string; weight: number; share: number}[];
  limbShare: number;
  /** Purposes / room types that map to it. */
  purposes: readonly string[];
  roomTypes: readonly string[];
}

export interface EconomyInfo {
  themes: readonly ThemeInfo[];
  offTheme: readonly {cat: string; weight: number; share: number}[];
  /** Category -> table id (GLOBAL_POOL.<cat>). */
  globalPool: Readonly<Record<string, string>>;
  themeOfType: Readonly<Record<string, string>>;
  allow: readonly {kind: string; cats: readonly string[]}[];
  containerThemed: readonly string[];
  randomHolders: readonly string[];
  boxCount: readonly {itemId: string; small: Range; big: Range}[];
  bigBoxHolders: readonly string[];
  handful: readonly {itemId: string; range: Range}[];
  handfulFallback: Range;
  limb: {share: Readonly<Record<string, number>>; holder: Readonly<Record<string, number>>; poolTable: string};
  /** Task track3-eaton-centre-20261031 (lane PROFILES): the profile's salvage rules (absent = none: every shipped Subway / Office table). */
  salvage?: {purposes: readonly {key: string; share: number; rows: readonly TableRow[]}[]; themes: readonly {key: string; share: number; rows: readonly TableRow[]}[]; note: string};
  /** Task mall-playtest-revision-20261031 (lane SHOPS, U10): the profile's per-compartment storage fill (absent = none: every Subway / Office table). */
  storageFill?: {kinds: readonly {kind: string; chance: number; area: number; lots: readonly [number, number]; cats: readonly string[]; weights: Readonly<Record<string, number>>; fallback: readonly string[]}[]; stockThemes: readonly string[]; note: string};
  legacy: {
    areaWeights: readonly {roomType: string; weights: readonly number[]}[];
    holderMod: readonly {kind: string; mod: readonly number[]}[];
    cats: readonly string[];
    fullRooms: {rooms: readonly string[]; kinds: readonly string[]; extra: number};
    pools: Readonly<Record<string, string>>;
    vendingFood: string;
  };
  knobs: readonly TuningKnob[];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Loose floor programs

export interface FloorFind {
  /** Program stage ('boxes', 'kept', 'light' / 'street.box', 'street.extra', 'tower.box', 'scarce.med' ...). */
  stage: string;
  itemId: string;
  /** Units per placed copy. */
  count: number;
  /** n copies drawn uniformly (null when a single chance draw decides). */
  copies: Range | null;
  /** Chance of the draw / per-copy keep (null = always). */
  chance: number | null;
  /** Expected copies ATTEMPTED (before placement; exact). */
  expectedCopies: number;
  expectedUnits: number;
  knobs: readonly TuningKnob[];
  note?: string;
}

export interface FloorVariant {
  /** e.g. 'station' / 'street' / 'tower:none' / 'tower:medical' ... */
  id: string;
  label: string;
  /** How often this variant runs ("once per station", "once per tower floor whose tenant has this tilt"). */
  runs: string;
  finds: readonly FloorFind[];
  /** Σ expectedCopies / expectedUnits per item. */
  totals: readonly {itemId: string; copies: number; units: number}[];
  /** Office tower: the company loot tilt (multipliers [med, battery, flare, food]) and the companies that carry it. */
  tilt?: {id: string; multipliers: readonly number[]; companies: readonly string[]; odds: readonly number[]};
}

export interface FloorProgramInfo {
  id: string;
  level: string;
  label: string;
  variants: readonly FloorVariant[];
  /** Where finds land (area weights; placement success is NOT derivable). */
  placement: {derivable: false; reason: string; weights: readonly {name: string; weights: Readonly<Record<string, number>>}[]};
  /** Office: expected attempts per logical level (street + floors over the tenant pool), when exact. */
  perLevel?: {basis: string; totals: readonly {itemId: string; copies: number; units: number}[]};
  at: readonly SourceLoc[];
  knobs: readonly TuningKnob[];
  notes: readonly string[];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Special sources (outside the holder tables) — never silently omitted

// (+ 'objective': task reactor-build-20261101 — the Reactor's restart parts, placed once by its generator, never in a loot table)
export type SpecialFamily = 'gear' | 'mask' | 'weapon' | 'starter' | 'reward' | 'objective' | 'fixture' | 'interaction' | 'decoration' | 'floor-moved';

export interface SpecialItem {
  itemId: string;
  /** Units (fixed) or a uniform range. */
  count?: number | Range;
  weight?: number;
  /** Conditional share (with `denominator` on the source). */
  share?: number;
  chance?: number;
  note?: string;
}

export interface SpecialSource {
  id: string;
  family: SpecialFamily;
  label: string;
  class: SourceClass;
  /** Level ids it applies to. */
  levels: readonly string[];
  summary: string;
  items: readonly SpecialItem[];
  denominator?: number;
  /** Count distribution (gear count, weapon copies, mask / filter counts): P(k) exact. */
  distribution?: readonly {k: number; p: number}[];
  /** Expected count (exact) when stated. */
  expected?: number;
  probability: string;
  knobs: readonly TuningKnob[];
  at: readonly SourceLoc[];
  /** Per-level detail (e.g. mask counts per level, gear per profile). */
  perLevel?: readonly {level: string; summary: string; distribution?: readonly {k: number; p: number}[]; expected?: number}[];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Levels

export interface OverrideEntry { knob: OverrideKnob; key: string; multiplier: number }

export interface ProfileInfo {
  id: string;
  label: string;
  /** The profile rolls with BASE_TABLES (today's numbers). */
  baseTables: boolean;
  /** Resolved overrides (empty = none: every roll uses the source values). */
  overrides: readonly OverrideEntry[];
  /** validateLootProfile() problems (should be empty). */
  validation: readonly string[];
  at: SourceLoc;
}

export interface StoreyInfo { id: string; label: string; layoutLevels: readonly number[]; floorVariant: string; note?: string }
export interface CompanyInfo { id: string; name: string; tilt: string; note: string }

export interface LevelContexts {
  /** Office: storeys of the one logical level (contexts, never separate levels / gear rolls). */
  storeys?: readonly StoreyInfo[];
  /** Office: tenant companies (one per tower floor, seeded) and their floor loot tilt. */
  companies?: readonly CompanyInfo[];
  note: string;
}

export interface PurposeUse { purpose: string; label: string; theme: string; levelsObserved: number; samples: number }

export interface LevelInfo {
  id: string;
  label: string;
  blurb: string;
  profile: ProfileInfo;
  contexts: LevelContexts;
  /** Slot id -> HolderContext ids of this level (all 12 slots present; [] where the level has none). */
  slots: readonly {slot: string; contexts: readonly string[]}[];
  /** HolderContexts of this level. */
  holders: readonly HolderContext[];
  /** Purposes observed in the census (+ declared-only ones). */
  purposes: readonly PurposeUse[];
  economy: EconomyInfo;
  floor: FloorProgramInfo;
  /** SpecialSource ids that apply to this level. */
  specials: readonly string[];
  /**
   * Task track3-eaton-centre-20261031 (lane PROFILES): CRAFTING-MATERIAL RICHNESS in native units — expected material units per sample
   * level from its holders (Σ over the census holders of their context's exact expected units, BEFORE fit) and from the loose floor
   * program (expected attempts, before placement), per material item, plus the holders per level whose context can yield one.
   */
  materials: {perLevelHolders: Readonly<Record<string, number>>; perLevelFloor: Readonly<Record<string, number>>; holdersPerLevel: number; materialHoldersPerLevel: number; note: string};
}

export interface PurposeInfo {
  id: string;
  label: string;
  category: string;
  theme: string;
  /** Structural room types it may fill (back rooms) or 'storefront'. */
  slots: readonly string[];
  /** Holder kind (or 'default') -> table id. */
  loot: readonly {holder: string; tableId: string}[];
  floor?: Readonly<Record<string, number>>;
  /** Levels where the census observed it. */
  levels: readonly string[];
  at: SourceLoc;
}

export interface ProbabilityNote { id: string; title: string; text: string }

// ---------------------------------------------------------------------------------------------------------------------------
// The one object

export interface LootReference {
  meta: LootReferenceMeta;
  items: Readonly<Record<string, ItemInfo>>;
  itemGroups: readonly ItemGroupInfo[];
  /** All 12 slot categories in SLOT_CATEGORIES order. */
  slots: readonly SlotInfo[];
  holderKinds: Readonly<Record<string, HolderKindInfo>>;
  tables: Readonly<Record<string, LootTableInfo>>;
  purposes: Readonly<Record<string, PurposeInfo>>;
  /** Registered logical levels (LEVEL_IDS order). Never the test-only reducedFood profile. */
  levels: readonly LevelInfo[];
  specials: readonly SpecialSource[];
  probability: readonly ProbabilityNote[];
}
