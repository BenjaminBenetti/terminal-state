// Task loot-tables-20261030 (lane LOOT): THE LOOT TABLES — the one typed data module for what can be found where, per LOGICAL
// level. Pure data + a small resolution API (no three.js), unit-tested in Node. Tuning guide: docs/loot-tables.md.
//
// User (2026-10-30): "a data structure in the code that contains these loot tables that's tied to levels that controls loot spawn
// in different areas where loot can spawn ... tune certain levels with certain loot spawn capability ... different placement spots
// would plug in to certain loot table entries (countertop -> average item loot slot ...) and different furniture / cabinets /
// cupboards plug into slots, then they pull from the loot table".
//
// How it fits together:
//  - PROFILES: one LootProfile per logical level (levels/registry.ts LevelId: 'subway', 'office'). A profile = the rate TABLES it
//    rolls with (BASE_TABLES: today's numbers) + per-level OVERRIDES (multipliers resolved at roll time; both levels: none, so
//    every roll is byte-identical to before — tests/loot-golden.test.ts). The Office's physical storeys share the ONE office
//    profile (per-storey floor programs still run per storey; rare gear is still one roll per logical level).
//  - SLOT CATEGORIES (HOLDER_SLOTS): every loot-holder kind (a prop the player can search) plugs into one named slot — 'surface'
//    (tables, desk tops), 'countertop', 'shelf', 'container' (cabinets, crates, lockers, drawers), the specialist fixtures
//    ('foodPrep', 'vend', 'cold', 'medical', 'arms', 'junk', 'stash') and 'fixture' (baked contents, no loot). A slot is a
//    classification and override target, not a flattening: each kind keeps its own numbers below.
//  - TABLES: which rows a holder rolls is decided by (in order) its OWN table (openable containers, OPENABLE_TABLES), the area's
//    PURPOSE table for that holder kind (gen/purposes.ts, which references the NAMED shared tables here), else the LEGACY
//    room-type tables (AREA_WEIGHTS x HOLDER_MOD -> LEGACY_POOL). The scarcity economy (THEME_ECONOMY ...) then thins / re-themes
//    the roll (items/lootEconomy.ts). Loose floor finds follow the per-level FLOOR PROGRAMS; rare gear GEAR_LOOT.
//  - Fit / occupancy stays in items/lootLayout.ts (an item that fits no surface is dropped); eligibility in HOLDER_ALLOW.
// Explicit exceptions (not table-driven): weapon finds + their paired ammo (gen/weaponFinds.ts, gen/office/spawns.ts) incl. the
// Subway pistol-start 9 mm boxes, the starter kit (run/starter.ts), fixtures with baked contents, vending pry / bin spill
// mechanics, shelf filler stock (decoration).
//
// Ammo: ammo is ordinary item rows + per-item count data (BOX_COUNT / HANDFUL). Nothing in the API names a weapon or calibre. Lane
// AMMO (knife-melee-20261030, merged from main): ammo items ARE calibers (ammo_9mm / ammo_556 / ammo_12ga, items/calibers.ts); a
// table's rifle / shotgun ammo rows are GENERIC ammo — genericAmmo(w) splits the row weight w evenly (~1/3 each) over the caliber
// items; rows that only ever held 9mm (office desks / drawers, police cabinets, toilet stashes) stay 9mm.

import {ITEMS} from './items';
import {GEAR_ITEMS} from './gear';
import {genericAmmo} from './calibers'; // lane AMMO (knife-melee-20261030): pure data, no imports
import {ARM_SLING, LEG_SPLINT, LIMB_TREATMENT_IDS, TRAUMA_KIT} from './medical';
import type {LootTheme} from '../gen/purposes';
import type {LootTilt} from '../gen/office/companies';
import type {LevelId} from '../levels/types';

// ---------------------------------------------------------------------------------------
// Types

/** Inclusive integer range [lo, hi] (lot counts, copies, stack sizes). */
export type LotRange = readonly [lo: number, hi: number];
/** [itemId, relative weight] — itemId must exist in items/items.ts (validateLootProfile checks). */
export type ItemRow = readonly [itemId: string, weight: number];
/** Weighted item rows. An EMPTY table (`[]`) is allowed and means "no loot" (nothing is drawn). */
export type ItemRows = readonly ItemRow[];
/** A purpose's table for one holder kind (gen/purposes.ts): `lots` / `empty` default to the holder kind's (HOLDER_LOTS / HOLDER_EMPTY). */
export interface LootSpec { items: ItemRows; lots?: LotRange; empty?: number }
/** A holder kind's OWN table (openable containers; desk-style drawers): lot range, empty chance, item rows. */
export interface OwnTable { lots: LotRange; empty: number; items: ItemRows }
/** Legacy category weights [food, drink, med, ammo] (room types, holder modifiers). */
export type CatWeights = readonly [food: number, drink: number, med: number, ammo: number];
export type LegacyCat = 'food' | 'drink' | 'med' | 'ammo';
export const LEGACY_CATS: readonly LegacyCat[] = ['food', 'drink', 'med', 'ammo'];

/** Economy category of an item (null: weapons / anything that is not a consumable resource). */
export type EconCat = 'food' | 'drink' | 'med' | 'ammo' | 'battery' | 'flare';
export const ECON_CATS: readonly EconCat[] = ['food', 'drink', 'med', 'ammo', 'battery', 'flare'];

/** Named slot categories every loot-holder kind plugs into (HOLDER_SLOTS). */
export const SLOT_CATEGORIES = ['surface', 'countertop', 'shelf', 'container', 'foodPrep', 'vend', 'cold', 'medical', 'arms', 'junk', 'stash', 'fixture'] as const;
export type SlotCategory = (typeof SLOT_CATEGORIES)[number];

// ---------------------------------------------------------------------------------------
// Item categories (economy)

/** The light lane's item ids (items/items.ts): a consumable torch battery and the throwable flare. */
export const BATTERY_ID = 'battery';
export const FLARE_ID = 'flare';
const FOOD = new Set(['chocolate', 'chips', 'beans', 'noodles']);
const DRINK = new Set(['water', 'cola', 'juice']);
/** HP medicine (bandage / med kit). Iteration 16 (lane INJURY): the limb treatments (items/medical.ts) are 'med' too. */
export const HP_MED: ReadonlySet<string> = new Set(['bandage', 'medkit']);
const MED = new Set<string>([...HP_MED, ...LIMB_TREATMENT_IDS]);

export function econCat(itemId: string): EconCat | null {
  if (itemId.startsWith('ammo_')) return 'ammo';
  if (FOOD.has(itemId)) return 'food';
  if (DRINK.has(itemId)) return 'drink';
  if (MED.has(itemId)) return 'med';
  if (itemId === BATTERY_ID) return 'battery';
  if (itemId === FLARE_ID) return 'flare';
  return null;
}

// ---------------------------------------------------------------------------------------
// Slots: which slot category each loot-holder kind plugs into (items/loot.ts isLootHolderKind — a test checks every kind).

export const HOLDER_SLOTS: Readonly<Record<string, SlotCategory>> = {
  // ordinary small-item surfaces (exposed tops)
  table: 'surface', desk: 'surface', monitorDesk: 'surface',
  // counters (tills, back counters, kiosk counter + back shelf, kitchenette top)
  shopCounter: 'countertop', shopBackbar: 'countertop', stall: 'countertop', kitchenette: 'countertop',
  // open shelving / baskets
  shelf: 'shelf', stockShelf: 'shelf', shoppingCart: 'shelf',
  // general closed storage
  cabinetTall: 'container', cabinetLow: 'container', crate: 'container', staffLockers: 'container', filingCabinet: 'container', safe: 'container',
  rollingToolChest: 'container',
  // specialist fixtures (HOLDER_ALLOW keeps their finds plausible)
  grillLine: 'foodPrep', espressoBar: 'foodPrep', wokLine: 'foodPrep', deliLine: 'foodPrep', blenderBar: 'foodPrep', hotdogCart: 'foodPrep', busCart: 'foodPrep',
  vending: 'vend', snackRack: 'vend', shopDisplay: 'vend', newspaperVendingBox: 'vend',
  shopCooler: 'cold', fridge: 'cold', chestFreezer: 'cold',
  medCabinet: 'medical', firstAidWallKit: 'medical', crashCart: 'medical', wheeledStretcher: 'medical',
  gunLocker: 'arms',
  bin: 'junk', wheelieBin: 'junk',
  toiletStall: 'stash',
  // baked contents only (the extinguisher, the defibrillator): no loot table
  fireExtinguisherCabinet: 'fixture', aedWallCabinet: 'fixture',
};
/** Separate compartment rolls (desk / security-desk drawers, kitchenette cupboards) are closed storage. */
export const COMPARTMENT_SLOT: SlotCategory = 'container';

/** Slot category of a holder kind (`compartment`: its separate drawer / cupboard roll). */
export function slotOf(kind: string, compartment = false): SlotCategory | undefined {
  return compartment ? COMPARTMENT_SLOT : HOLDER_SLOTS[kind];
}

// ---------------------------------------------------------------------------------------
// Legacy room-type tables (moved verbatim from items/loot.ts): holders whose area has NO purpose table (platforms, halls, ...).

/** Category weights by room type (`area.type`); unknown types use `default`. */
export const AREA_WEIGHTS: Readonly<Record<string, CatWeights>> = {
  'default': [1, 1, 1, 1],
  'platform': [1, 1.2, 0.6, 0.8],
  'passage': [1, 1.2, 0.6, 0.6],
  'concourse': [1, 1.2, 0.6, 0.6],
  'exit-stair': [0.8, 1, 0.8, 0.8],
  'fare-hall': [1, 1.2, 0.8, 0.8],
  'service-corridor': [0.6, 1, 1, 1.6],
  'agent-office': [1.4, 1.6, 1.2, 1],
  'storage': [1.4, 1.4, 1.2, 2],
  'stock-room': [3, 3, 0.4, 0.3],
  'crew-room': [2.6, 2.6, 0.8, 0.5],
  'utility': [0.5, 1, 1, 2.4],
  'supply-closet': [0.6, 0.8, 2.4, 1.6],
  'janitor-closet': [0.4, 1, 1.2, 0.8],
  'food-court': [3, 3, 0.15, 0.05],
  'retail-arcade': [2.2, 2.4, 0.6, 0.2],
  'washroom': [0.2, 0.6, 2, 0.3],
  'eatery': [3, 3, 0.1, 0.05],
  'shop': [2.4, 2.6, 0.7, 0.2],
};

/**
 * Generated iteration-07 holders (gen/props07.ts `holder` references these): lot range, empty chance, category modifiers
 * [food, drink, med, ammo] (rooms / stores stock them from their purpose table; halls from these modifiers).
 */
export const P7_HOLDER_LOOT = {
  shoppingCart: {lots: [1, 3], empty: 0.35, mod: [1.6, 1.4, 0.2, 0]},
  busCart: {lots: [1, 3], empty: 0.4, mod: [1.5, 1.5, 0, 0]},
  crashCart: {lots: [1, 3], empty: 0.2, mod: [0, 0.3, 3, 0]},
  wheeledStretcher: {lots: [1, 2], empty: 0.45, mod: [0, 0.3, 3, 0]},
  rollingToolChest: {lots: [1, 3], empty: 0.3, mod: [0.2, 0.6, 1, 1.6]},
} as const satisfies Readonly<Record<string, {lots: LotRange; empty: number; mod: CatWeights}>>;
const P7_LOOT = P7_HOLDER_LOOT as Readonly<Record<string, {lots: LotRange; empty: number; mod: CatWeights}>>;
const p7 = <T>(f: (e: {lots: LotRange; empty: number; mod: CatWeights}) => T): Record<string, T> => Object.fromEntries(Object.entries(P7_LOOT).map(([k, e]) => [k, f(e)]));

/** Holder modifiers (multiplied with the room weights). Openable containers roll their own tables (OPENABLE_TABLES) instead. */
export const HOLDER_MOD: Readonly<Record<string, CatWeights>> = {
  cabinetTall: [1, 1, 1.1, 1], cabinetLow: [1, 1, 1, 1], crate: [0.8, 0.9, 0.6, 1.6],
  shelf: [1, 1, 0.9, 0.6], stall: [1.3, 1.3, 0.05, 0], vending: [1, 1, 0, 0], table: [1, 1.4, 0.1, 0], desk: [1, 1.3, 0.4, 0.2],
  shopCounter: [1.3, 1.2, 0.1, 0.05], shopDisplay: [2, 0.6, 0, 0], shopBackbar: [1.4, 1, 0.1, 0.05], shopCooler: [0.15, 3, 0, 0],
  // Purpose holders: used only when no purpose table applies (their purposes normally decide).
  stockShelf: [1, 1, 0.9, 0.3], snackRack: [2, 0.5, 0, 0], hotdogCart: [1.5, 1.5, 0, 0], grillLine: [1.4, 1, 0, 0], espressoBar: [1, 1.4, 0, 0],
  wokLine: [1.6, 0.8, 0, 0], deliLine: [1.4, 1, 0, 0], blenderBar: [0.5, 2, 0, 0], kitchenette: [2, 1, 0.1, 0], fridge: [0.6, 2.4, 0, 0],
  gunLocker: [0, 0, 0.4, 3], monitorDesk: [1, 1.2, 0.2, 0.3], medCabinet: [0, 0.2, 3, 0],
  ...p7(e => e.mod),
};
/** Empty-roll chance of the original table roll (iteration 12: most holders end up empty anyway — items/lootEconomy.ts). */
export const HOLDER_EMPTY: Readonly<Record<string, number>> = {
  cabinetTall: 0.08, cabinetLow: 0.1, crate: 0.12, shelf: 0.08, stall: 0.1, vending: 0.12, table: 0.65, desk: 0.55, shopCounter: 0.3, shopDisplay: 0.25, shopBackbar: 0.3, shopCooler: 0.15,
  stockShelf: 0.12, snackRack: 0.15, hotdogCart: 0.2, grillLine: 0.35, espressoBar: 0.35, wokLine: 0.35, deliLine: 0.35, blenderBar: 0.35,
  kitchenette: 0.25, fridge: 0.15, gunLocker: 0.08, monitorDesk: 0.4, medCabinet: 0.15,
  ...p7(e => e.empty),
};
/** Lot-count range of the original table roll. */
export const HOLDER_LOTS: Readonly<Record<string, LotRange>> = {
  cabinetTall: [2, 5], cabinetLow: [2, 4], crate: [1, 3], shelf: [2, 5], stall: [2, 5], vending: [3, 6], table: [1, 2], desk: [1, 2],
  shopCounter: [1, 3], shopDisplay: [2, 4], shopBackbar: [1, 3], shopCooler: [3, 7],
  stockShelf: [2, 5], snackRack: [2, 4], hotdogCart: [2, 4], grillLine: [1, 3], espressoBar: [1, 3], wokLine: [1, 3], deliLine: [1, 3], blenderBar: [1, 3],
  kitchenette: [1, 3], fridge: [2, 5], gunLocker: [2, 4], monitorDesk: [1, 2], medCabinet: [1, 4],
  ...p7(e => e.lots),
};
/** Stocked rooms get fuller shelves: `extra` more lots at the high end for these holder kinds (legacy tables only). */
export const FULL_ROOMS = {
  rooms: new Set(['stock-room', 'food-court', 'retail-arcade', 'storage', 'crew-room', 'shop']) as ReadonlySet<string>,
  kinds: ['shelf', 'stall'] as readonly string[],
  extra: 2,
};
/** Items of a legacy category (its ammo weight differs from GLOBAL_POOL's — do not merge). */
export const LEGACY_POOL: Readonly<Record<LegacyCat, ItemRows>> = {
  food: [['chocolate', 1.2], ['chips', 1.1], ['beans', 0.9], ['noodles', 1]],
  drink: [['water', 1.3], ['cola', 1.2], ['juice', 0.9]],
  med: [['bandage', 1], ['medkit', 0.35]],
  // Lane AMMO (knife-melee-20261030): generic ammo = ~1/3 each 9mm / 5.56×45mm / 12-gauge (was rifle 1.4 : shells 1, no 9mm —
  // "the pistol ammo ... only spawns on the floor"). The category weight is unchanged, so the number of ammo lots is too.
  ammo: genericAmmo(2.4),
};
/** Vending machines sell snacks, not tins of beans (legacy food rows of a vending machine). */
export const VENDING_FOOD: ItemRows = [['chocolate', 1.5], ['chips', 1.5], ['noodles', 0.3]];

// ---------------------------------------------------------------------------------------
// Per-item stack sizes (count data; replaces the old hard-coded lotCount / HANDFUL ammo branches — same values, same draws)

/** Box size of an item rolled in a holder: `big` in BIG_BOX_HOLDERS, else `small`. Items not listed are single (count 1, no draw). */
export const BOX_COUNT: Readonly<Record<string, {small: LotRange; big: LotRange}>> = {
  // Lane AMMO: per caliber (5.56×45mm = the old rifle rounds, 12-gauge = the old shells, 9mm = the old 9 mm boxes).
  ammo_556: {small: [5, 10], big: [8, 12]},
  ammo_12ga: {small: [2, 4], big: [3, 6]},
  // 9mm: lane AMMO (knife-melee-20261030) — now ~1/3 of every generic ammo pick (it used to be a rare security find at 10-15 / 6-12),
  // so a holder's 9mm lot is ~half a magazine like the other calibers (4-8 / 6-10): total holder ammo stays in its band (tests).
  ammo_9mm: {small: [4, 8], big: [6, 10]},
};
/** Holders that hold full-size boxes (crates, gun lockers). */
export const BIG_BOX_HOLDERS: ReadonlySet<string> = new Set(['crate', 'gunLocker']);
/** Off-theme ammo is a handful of loose rounds, not a full box (keeps total ammo where it was). */
export const HANDFUL: Readonly<Record<string, LotRange>> = {ammo_9mm: [4, 7], ammo_556: [3, 5], ammo_12ga: [2, 3]};
/** Handful of an ammo item HANDFUL does not list. */
export const HANDFUL_FALLBACK: LotRange = [3, 6];

// ---------------------------------------------------------------------------------------
// Scarcity economy (moved verbatim from items/lootEconomy.ts; the logic stays there)

export interface ThemeEconomy {
  /** Chance an original non-ammo entry survives as a find (the 80 % cut). */
  keep: number;
  /** Chance a find is on-theme (the rest are off-theme random finds). */
  on: number;
  /** Categories that fit the theme. */
  cats: readonly EconCat[];
  /** On-theme category weights when the rolled item does not already fit. */
  weights: Readonly<Partial<Record<EconCat, number>>>;
}

/**
 * THE WEIGHTS TABLE (documented in economy.json and the lane report). keep: survival of an original non-ammo entry; on: share of
 * finds that are on-theme; cats: what fits the theme; weights: what an on-theme re-pick becomes. Service rooms thin harder (their
 * old water / beans rows become batteries and flares, and there are many of them: maintenance stores, caches, corridors).
 */
export const THEME_ECONOMY: Readonly<Record<LootTheme, ThemeEconomy>> = {
  security: {keep: 0.24, on: 0.75, cats: ['ammo', 'flare', 'battery'], weights: {ammo: 0.55, flare: 0.25, battery: 0.2}},
  medical: {keep: 0.21, on: 0.8, cats: ['med'], weights: {med: 1}},
  food: {keep: 0.27, on: 0.76, cats: ['food', 'drink'], weights: {food: 0.5, drink: 0.5}},
  service: {keep: 0.06, on: 0.75, cats: ['battery', 'flare'], weights: {battery: 0.45, flare: 0.55}},
  tech: {keep: 0.15, on: 0.8, cats: ['battery'], weights: {battery: 1}},
  personal: {keep: 0.21, on: 0.75, cats: ['food', 'drink', 'med'], weights: {food: 0.35, drink: 0.4, med: 0.25}},
  // Platforms / halls: no theme — every find is a sparse random one (OFF_THEME_WEIGHTS over every category).
  public: {keep: 0.2, on: 0, cats: [], weights: {}},
};

/** Off-theme random finds (and every find in public halls): category weights; the theme's own categories are excluded. */
export const OFF_THEME_WEIGHTS: Readonly<Record<EconCat, number>> = {food: 0.32, drink: 0.37, med: 0.09, ammo: 0.035, battery: 0.006, flare: 0.004};

/**
 * Items of a category when the holder's own table has none. Lane AMMO (knife-melee-20261030): ammo is generic — ~1/3 each 9mm /
 * 5.56×45mm / 12-gauge (was 9 mm 1.3 : rifle 1 : shells 0.8).
 */
export const GLOBAL_POOL: Readonly<Record<EconCat, ItemRows>> = {
  food: [['chocolate', 1.2], ['chips', 1.1], ['beans', 0.9], ['noodles', 1]],
  drink: [['water', 1.3], ['cola', 1.2], ['juice', 0.9]],
  med: [['bandage', 1], ['medkit', 0.35]],
  ammo: genericAmmo(3.1),
  battery: [[BATTERY_ID, 1]],
  flare: [[FLARE_ID, 1]],
};

/** Theme of room types that have no purpose (public halls, generic store units). */
export const THEME_OF_TYPE: Readonly<Record<string, LootTheme>> = {
  'food-court': 'food', 'eatery': 'food', 'shop': 'food', 'stock-room': 'food', 'crew-room': 'food',
  'agent-office': 'security',
  'storage': 'service', 'utility': 'service', 'service-corridor': 'service', 'janitor-closet': 'service',
  'supply-closet': 'medical',
  'platform': 'public', 'passage': 'public', 'concourse': 'public', 'fare-hall': 'public', 'retail-arcade': 'public',
  'exit-stair': 'public', 'underpass': 'public', 'stair-core': 'public', 'washroom': 'public',
};

const FD: readonly EconCat[] = ['food', 'drink'];
/** ELIGIBILITY — fixtures that only take certain categories (everything else — cabinets, crates, shelves, desks, lockers — takes any). */
export const HOLDER_ALLOW: Readonly<Partial<Record<string, readonly EconCat[]>>> = {
  shopCooler: ['drink'], fridge: FD, chestFreezer: FD,
  vending: ['food', 'drink', 'battery'], snackRack: ['food', 'battery'], newspaperVendingBox: ['food', 'drink', 'battery'],
  shopDisplay: ['food'], hotdogCart: FD, grillLine: FD, espressoBar: FD, wokLine: FD, deliLine: FD, blenderBar: FD, busCart: FD,
  kitchenette: ['food', 'drink', 'med', 'battery'],
  medCabinet: ['med'], firstAidWallKit: ['med'], crashCart: ['med', 'battery'], wheeledStretcher: ['med'],
  gunLocker: ['ammo', 'med', 'flare', 'battery'],
  // trash: discarded snacks, a dressing, a few rounds, a battery — never a flare
  bin: ['food', 'drink', 'med', 'ammo', 'battery'], wheelieBin: ['food', 'drink', 'med', 'ammo', 'battery'],
  // Task office-overhaul-20261030: something stashed in a toilet / on its tank lid — sealed water, a dressing, rounds, a battery, a flare; never snacks
  toiletStall: ['drink', 'med', 'ammo', 'battery', 'flare'],
};
/** Junk holders: whatever the room, their few finds are random (a bin in a security office is still a bin). */
export const RANDOM_HOLDERS: ReadonlySet<string> = new Set(['bin', 'wheelieBin']);

/**
 * Iteration 16 (lane INJURY): LIMB TREATMENTS — each HP-med find (bandage / med kit) becomes a limb treatment with probability
 * `share[theme]` (or the fixture's `holder` share). The roll code reads this LIVE object (tests zero it in place).
 */
export const LIMB_ECONOMY = {
  share: {medical: 0.27, personal: 0.2, security: 0.2, service: 0.2, tech: 0.2, public: 0.19, food: 0.14} as Readonly<Record<LootTheme, number>>,
  /** First-aid fixtures hold treatments whatever room they hang in (a wall first-aid kit in an office break room / corridor). */
  holder: {firstAidWallKit: 0.36, medCabinet: 0.3, crashCart: 0.36, wheeledStretcher: 0.36} as Readonly<Partial<Record<string, number>>>,
  /** Splints a little ahead of slings: legs are hurt more often (hard landings, rat / dog bites go low). */
  pool: [[LEG_SPLINT, 1.1], [ARM_SLING, 0.9], [TRAUMA_KIT, 0.3]] as ItemRows,
};

// ---------------------------------------------------------------------------------------
// Named shared tables (gen/purposes.ts and world/openablesSpec.ts reference these SAME objects). Unambiguous names: the old local
// names SNACKS / KITCHEN meant different rows in the store and tenant sections.

/** Store drinks cooler. */
export const STORE_DRINKS: LootSpec = {items: [['water', 3], ['cola', 3], ['juice', 2]], lots: [3, 7], empty: 0.12};
/** Store snack rack. */
export const STORE_SNACKS: LootSpec = {items: [['chocolate', 3], ['chips', 3]], lots: [2, 4], empty: 0.15};
/** Store till / counter: a few leftovers. */
export const storeTill = (items: ItemRows, empty = 0.45): LootSpec => ({items, lots: [1, 2], empty});
/** Store kitchen line / back counter. */
export const storeKitchen = (items: ItemRows): LootSpec => ({items, lots: [1, 3], empty: 0.35});
/** Back-of-house supply crate (security, electrical, storage, workshop, office storage / armory / mailroom ...). */
export const CACHE_CRATE: LootSpec = {items: [...genericAmmo(3.4), ['beans', 1], ['water', 1], ['bandage', 0.8]], lots: [1, 3], empty: 0.12};
/** Office desk top. */
export const OFFICE_DESK: LootSpec = {items: [['chocolate', 1], ['water', 1], ['cola', 0.8], ['chips', 0.6], ['bandage', 0.4], ['juice', 0.3]], lots: [1, 1], empty: 0.62};
/** Office credenza / low cabinet drawers (9mm only: the deliberate sidearm stock). */
export const OFFICE_DRAWERS: LootSpec = {items: [['chocolate', 1], ['water', 0.8], ['bandage', 0.7], ['chips', 0.5], ['ammo_9mm', 0.25]], lots: [1, 2], empty: 0.35};
// Task office-overhaul-20261030 (lane TENANTS): the company rooms' shared tables.
export const TENANT_SNACKS: LootSpec = {items: [['chocolate', 2], ['chips', 2], ['cola', 2], ['water', 1]], lots: [3, 6], empty: 0.15};
export const TENANT_FRIDGE: LootSpec = {items: [['juice', 2], ['water', 2], ['cola', 2], ['beans', 0.6]], lots: [2, 5], empty: 0.15};
export const TENANT_KITCHEN: LootSpec = {items: [['noodles', 2], ['chocolate', 1], ['beans', 1.4], ['chips', 0.6]], lots: [1, 3], empty: 0.25};
export const TENANT_TABLE: LootSpec = {items: [['cola', 1], ['chocolate', 1], ['water', 0.8], ['chips', 0.6]], lots: [1, 2], empty: 0.5};
export const TENANT_MEDS: LootSpec = {items: [['bandage', 2], ['medkit', 0.5], ['water', 0.6]], lots: [1, 3], empty: 0.2};
// lane AMMO (knife-melee-20261030): the armory's ammo weight (5.2) split ~1/3 each over 9mm / 5.56×45mm / 12-gauge
export const TENANT_ARMS: LootSpec = {items: [...genericAmmo(5.2), ['flare', 0.3], ['medkit', 0.2]], lots: [2, 4], empty: 0.1};
export const TENANT_SUPPLY: LootSpec = {items: [['water', 1.2], ['battery', 0.8], ['flare', 0.4], ['bandage', 0.6], ['beans', 0.6]], lots: [1, 3], empty: 0.25};

// Openable holders' item rows (iteration 08, lane I; world/openablesSpec.ts).
export const JUNK_ROWS: ItemRows = [['chips', 1], ['chocolate', 1], ['cola', 1.2], ['water', 0.5], ['juice', 0.5], ['noodles', 0.3], ['bandage', 0.12]];
/** Newspaper vending box (snacks). */
export const NEWSBOX_ROWS: ItemRows = [['chocolate', 1], ['chips', 0.6], ['water', 0.4], ['cola', 0.4]];
/** Staff lockers. */
export const PERSONAL_ROWS: ItemRows = [['water', 1], ['cola', 0.8], ['chocolate', 1], ['chips', 0.6], ['bandage', 0.8], ['juice', 0.5], ['noodles', 0.4], ...genericAmmo(0.5)];
/** Filing cabinet / desk drawers. */
export const OFFICE_ROWS: ItemRows = [['chocolate', 1], ['water', 0.6], ['cola', 0.5], ['chips', 0.4], ['bandage', 0.5], ['juice', 0.3], ...genericAmmo(0.15)];
/** Wall first-aid kit. */
export const WALL_KIT_ROWS: ItemRows = [['bandage', 3], ['medkit', 0.35], ['water', 0.3]];
export const SAFE_ROWS: ItemRows = [...genericAmmo(2), ['bandage', 0.6], ['medkit', 0.25], ['chocolate', 0.3]];
/** Chest freezer. */
export const FROZEN_ROWS: ItemRows = [['water', 1], ['juice', 1], ['cola', 0.8], ['beans', 0.4], ['noodles', 0.3]];
/** Kitchenette cupboards. */
export const PANTRY_ROWS: ItemRows = [['noodles', 1], ['beans', 1], ['water', 0.8], ['chocolate', 0.6], ['cola', 0.5], ['chips', 0.4], ['bandage', 0.2]];
/** Task office-overhaul-20261030 (lane INTERACT): stashed in a toilet (bowl / tank lid) — a bottle, a dressing, a box of 9 mm, rarely better. */
export const TOILET_ROWS: ItemRows = [['water', 1], ['bandage', 0.8], ['ammo_9mm', 0.15], ['medkit', 0.12], ['battery', 0.18], ['flare', 0.1]];
/** Security desk drawers. */
export const SECURITY_DRAWER_ROWS: ItemRows = [...genericAmmo(1.2), ['bandage', 0.6], ['chocolate', 0.5], ['water', 0.3]];

/**
 * OWN tables of the openable kinds (world/openablesSpec.ts `loot` references these): NEW container kinds roll theirs over every
 * compartment whatever the room (narrowed to what the room's purpose stocks); desk-style surface holders roll theirs for their
 * drawers / cupboards (a separate compartment roll). Fixtures (fire / defibrillator cabinets) and shared-roll openables have
 * `loot: null` in their spec.
 */
export const OPENABLE_TABLES = {
  bin: {lots: [1, 2], empty: 0.6, items: JUNK_ROWS},
  wheelieBin: {lots: [1, 3], empty: 0.5, items: JUNK_ROWS},
  newspaperVendingBox: {lots: [1, 1], empty: 0.72, items: NEWSBOX_ROWS},
  staffLockers: {lots: [1, 4], empty: 0.2, items: PERSONAL_ROWS},
  filingCabinet: {lots: [1, 3], empty: 0.35, items: OFFICE_ROWS},
  safe: {lots: [1, 3], empty: 0.4, items: SAFE_ROWS},
  chestFreezer: {lots: [1, 3], empty: 0.35, items: FROZEN_ROWS},
  firstAidWallKit: {lots: [1, 3], empty: 0.3, items: WALL_KIT_ROWS},
  toiletStall: {lots: [1, 2], empty: 0.2, items: TOILET_ROWS},
  // compartments of surface holders (their exposed tops keep their own roll)
  kitchenette: {lots: [1, 2], empty: 0.45, items: PANTRY_ROWS},
  desk: {lots: [1, 1], empty: 0.6, items: OFFICE_ROWS},
  monitorDesk: {lots: [1, 1], empty: 0.5, items: SECURITY_DRAWER_ROWS},
} as const satisfies Readonly<Record<string, OwnTable>>;

// ---------------------------------------------------------------------------------------
// Loose floor finds: per-level programs (generation time), interpreted in exactly their historical draw order.

/** Shared floor-economy numbers (iteration 12): the Subway program's keep / chances and the Office's base med odds come from here. */
export const FLOOR_ECONOMY = {
  /** Survival of each old loose dressing / first-aid kit (ammo boxes on the floor are unchanged). */
  medKeep: 0.2,
  /** Chance of one loose torch battery (always: every station has at least one) and of one loose flare per station. */
  batteryChance: 1,
  flareChance: 0.35,
  /** Area weight per theme for the loose battery / flare (service and security rooms first; never a food counter). */
  themeWeight: {service: 3, security: 2.2, tech: 1, personal: 1, medical: 0.4, food: 0, public: 0.35} as Readonly<Record<LootTheme, number>>,
};

/** A floor find drawn `n` times (inclusive range). */
export interface FloorCopies { itemId: string; count: number; n: LotRange }
/** A floor find with a chance (scarce stream). */
export interface FloorChance { itemId: string; count: number; chance: number }

/**
 * Subway station (gen/stationDress.ts placeSpawns, stream `spawns`): `boxes` (n copies each on the spawn stream), then the old
 * loose dressings / kits (`n` on the spawn stream, each kept with `keep` on the `scarce-floor` fork — interleaved), then the
 * `light` finds (scarce-floor). Zombies are placed on the same spawn stream afterwards: changing these draws moves them too.
 */
export interface SubwayFloorProgram { boxes: readonly FloorCopies[]; kept: readonly (FloorCopies & {keep: number})[]; light: readonly FloorChance[] }
export const SUBWAY_FLOOR: SubwayFloorProgram = {
  // lane AMMO (knife-melee-20261030): the loose floor boxes keep a single caliber each (5.56×45mm / 12-gauge; 9mm comes with the
  // pistol start — gen/weaponFinds.ts)
  boxes: [{itemId: 'ammo_556', count: 30, n: [3, 4]}, {itemId: 'ammo_12ga', count: 8, n: [2, 3]}],
  kept: [{itemId: 'medkit', count: 1, n: [1, 2], keep: FLOOR_ECONOMY.medKeep}, {itemId: 'bandage', count: 1, n: [2, 3], keep: FLOOR_ECONOMY.medKeep}],
  light: [{itemId: BATTERY_ID, count: 1, chance: FLOOR_ECONOMY.batteryChance}, {itemId: FLARE_ID, count: 1, chance: FLOOR_ECONOMY.flareChance}],
};

/**
 * Task office-overhaul-20261030 (lane TENANTS): a company floor's loot tilt shifts the MIX of its scarce loose finds (same expected
 * count): the clinic's floor leans to dressings, the logistics / aerospace floors to torch batteries and flares, the security
 * firm's to flares and a surer ammo box, the food companies trade some battery chance for a snack. Multipliers per category
 * [med, battery, flare, food]; renormalised to the untilted total (gen/office/spawns.ts scarceOdds).
 */
export const OFFICE_FLOOR_TILT: Readonly<Record<LootTilt, readonly [number, number, number, number]>> = {
  none: [1, 1, 1, 0], medical: [1.9, 0.6, 0.6, 0], light: [0.6, 1.5, 1.6, 0], ammo: [0.8, 0.7, 1.6, 0], food: [1, 0.6, 1, 0.5],
};
/**
 * Office Space, run once per PHYSICAL storey (gen/office/spawns.ts placeOfficeSupplies, stream `office-supplies-<floor>`) under the
 * ONE office profile. Street storey (station + lobby): `street.box`, then `street.extra` with its chance. Tower storeys: one draw
 * against the cumulative `thresholds` (a security company's floor: `ammoThresholds`) -> `boxes[i]` or nothing. Then the scarce
 * finds (`scarce-floor` fork): med (`medkit` share of it a kit), battery, flare, and food only when its odds are > 0.
 */
export interface OfficeFloorProgram {
  street: {box: {itemId: string; count: number}; extra: FloorChance};
  tower: {boxes: readonly {itemId: string; count: number}[]; thresholds: readonly number[]; ammoThresholds: readonly number[]};
  scarce: {base: readonly [med: number, battery: number, flare: number]; cap: number; medkit: number; food: readonly string[]};
  tilt: Readonly<Record<LootTilt, readonly [number, number, number, number]>>;
}
export const OFFICE_FLOOR: OfficeFloorProgram = {
  // lane AMMO (knife-melee-20261030): caliber items (9mm / 5.56×45mm / 12-gauge), one caliber per loose box
  street: {box: {itemId: 'ammo_556', count: 30}, extra: {itemId: 'ammo_12ga', count: 8, chance: 0.6}},
  tower: {boxes: [{itemId: 'ammo_9mm', count: 15}, {itemId: 'ammo_556', count: 30}, {itemId: 'ammo_12ga', count: 8}], thresholds: [0.55, 0.8, 0.93], ammoThresholds: [0.42, 0.72, 0.97]},
  scarce: {base: [FLOOR_ECONOMY.medKeep * 1.5, 0.35, 0.14], cap: 0.95, medkit: 0.3, food: ['chocolate', 'cola', 'water', 'chips']},
  tilt: OFFICE_FLOOR_TILT,
};

/**
 * WHERE loose finds land: weight of public room types without a purpose (purposes carry their own `floor` weights). Three
 * DIFFERENT historical copies, kept distinct (do not merge): the station program, the multi-level share (gen/levelGenDress.ts:
 * moves part of the loose ammo / dressings onto the upper / lower levels, totals unchanged) and the office storeys.
 */
export const PUBLIC_FLOOR_WEIGHTS: Readonly<Record<'station' | 'stationLevels' | 'officeStorey', Readonly<Partial<Record<string, number>>>>> = {
  station: {'fare-hall': 0.4, 'concourse': 0.4, 'food-court': 0.2, 'passage': 0.25, 'underpass': 0.3, 'platform': 0.5, 'retail-arcade': 0.25, 'exit-stair': 0.2},
  stationLevels: {'concourse': 0.4, 'passage': 0.25, 'service-corridor': 0},
  officeStorey: {'fare-hall': 0.4, 'concourse': 0.4, 'passage': 0.25, 'platform': 0.5, 'exit-stair': 0.2},
};

// ---------------------------------------------------------------------------------------
// Rare gear (lane GEAR, gen/gearLoot.ts): ONE roll per logical level (key `gear-roll:${levelId}`), never per storey.

/** Mean of the per-level gear count before the cap (Poisson). */
export const GEAR_MEAN_PER_LEVEL = 1;
/** Hard cap of gear items per logical level. */
export const GEAR_CAP_PER_LEVEL = 5;
/** Relative draw weights (the backpack a little more likely: it is the piece that changes play the most). */
export const GEAR_WEIGHTS: Readonly<Record<string, number>> = {armor_vest: 1, chest_rig: 1, backpack: 1.4, helmet: 1, boots: 1, gloves: 1};
export interface GearLoot { mean: number; cap: number; weights: Readonly<Record<string, number>> }
export const GEAR_LOOT: GearLoot = {mean: GEAR_MEAN_PER_LEVEL, cap: GEAR_CAP_PER_LEVEL, weights: GEAR_WEIGHTS};

// ---------------------------------------------------------------------------------------
// Profiles

/** The rate tables a profile rolls with. BASE_TABLES = today's numbers; a future level may swap one wholesale (`{...BASE_TABLES, ...}`). */
export interface LootTables {
  /** Legacy room-type tables (areas without a purpose table). */
  areaWeights: Readonly<Record<string, CatWeights>>;
  holderMod: Readonly<Record<string, CatWeights>>;
  /** Per holder kind defaults (purpose / own tables may set their own). */
  holderEmpty: Readonly<Record<string, number>>;
  holderLots: Readonly<Record<string, LotRange>>;
  fullRooms: typeof FULL_ROOMS;
  pool: Readonly<Record<LegacyCat, ItemRows>>;
  vendingFood: ItemRows;
  /** Per-item stack sizes. */
  boxCount: Readonly<Record<string, {small: LotRange; big: LotRange}>>;
  bigBoxHolders: ReadonlySet<string>;
  handful: Readonly<Record<string, LotRange>>;
  handfulFallback: LotRange;
  /** Scarcity economy. */
  themes: Readonly<Record<LootTheme, ThemeEconomy>>;
  offTheme: Readonly<Record<EconCat, number>>;
  globalPool: Readonly<Record<EconCat, ItemRows>>;
  limb: typeof LIMB_ECONOMY;
  /** Loose floor programs. */
  floor: {subway: SubwayFloorProgram; office: OfficeFloorProgram};
  /** Rare gear. */
  gear: GearLoot;
}
export const BASE_TABLES: LootTables = {
  areaWeights: AREA_WEIGHTS, holderMod: HOLDER_MOD, holderEmpty: HOLDER_EMPTY, holderLots: HOLDER_LOTS, fullRooms: FULL_ROOMS,
  pool: LEGACY_POOL, vendingFood: VENDING_FOOD,
  boxCount: BOX_COUNT, bigBoxHolders: BIG_BOX_HOLDERS, handful: HANDFUL, handfulFallback: HANDFUL_FALLBACK,
  themes: THEME_ECONOMY, offTheme: OFF_THEME_WEIGHTS, globalPool: GLOBAL_POOL, limb: LIMB_ECONOMY,
  floor: {subway: SUBWAY_FLOOR, office: OFFICE_FLOOR},
  gear: GEAR_LOOT,
};

/** Multiplier tables (all optional; 1 = unchanged, 0 = never). */
export type Multipliers<K extends string> = Readonly<Partial<Record<K, number>>>;
export interface SlotOverride {
  /** Multiplier on the slot's empty chance (result capped at 1). */
  empty?: number;
  /** Multiplier on the slot's lot-count range (both ends scaled and rounded; 0 = nothing). */
  lots?: number;
}
/**
 * Per-level adjustments, applied at RESOLUTION time by item id / economy category / slot category (never by table identity), all
 * multiplicative and independent (they simply multiply where they meet):
 *  - itemWeight / categoryWeight: RELATIVE weights — a row's weight x itemWeight[id] x categoryWeight[cat]; also the legacy
 *    category picks and the scarcity re-picks (theme / off-theme). Lowering one shifts draws to the other rows of the same table.
 *  - keep: AVAILABILITY — the scarcity keep chance of non-ammo finds of a category (capped at 1); ammo is kept exactly as rolled.
 *  - slot: per slot category, how often a holder is empty (`empty`) and how many lots it rolls (`lots`).
 *  - floor: loose floor finds per category — `chance` on chance / keep draws, `count` on how many copies.
 *  - gear: rare gear `mean` (multiplier), `cap` (absolute), `weight` per gear id (multiplier). Still ONE roll per logical level.
 */
export interface LootOverrides {
  itemWeight?: Multipliers<string>;
  categoryWeight?: Multipliers<EconCat>;
  keep?: Multipliers<EconCat>;
  slot?: Readonly<Partial<Record<SlotCategory, SlotOverride>>>;
  floor?: {chance?: Multipliers<EconCat>; count?: Multipliers<EconCat>};
  gear?: {mean?: number; cap?: number; weight?: Multipliers<string>};
}
export interface LootProfile {
  /** The logical level (levels/types.ts LevelId) a registered profile belongs to; 'baseline' = level-agnostic. */
  readonly id: string;
  readonly label: string;
  readonly tables: LootTables;
  readonly overrides: LootOverrides;
}

/** Level-agnostic default of every roll function (QA / tests / callers without a level): today's tables, no overrides. */
export const BASELINE_PROFILE: LootProfile = {id: 'baseline', label: 'Baseline (no level)', tables: BASE_TABLES, overrides: {}};

/**
 * THE PER-LEVEL PROFILES. Both current levels use today's tables with NO overrides (the user likes the current rates). A new level
 * adds its entry here (Record<LevelId, …> makes that mandatory); a deeper level tunes through `overrides` (docs/loot-tables.md).
 */
export const PROFILES: Readonly<Record<LevelId, LootProfile>> = {
  subway: {id: 'subway', label: 'Subway', tables: BASE_TABLES, overrides: {}},
  office: {id: 'office', label: 'Office Space', tables: BASE_TABLES, overrides: {}},
};

/** The loot profile of a logical level. */
export function lootProfile(levelId: LevelId): LootProfile {
  return PROFILES[levelId] ?? BASELINE_PROFILE;
}

// ---------------------------------------------------------------------------------------
// Resolution API. Identity for an untouched profile: the SAME arrays / numbers come back, so baseline draws are byte-identical.

/** Weight multiplier of one item under a profile (1 = untouched). */
function rowFactor(o: LootOverrides, itemId: string): number {
  const c = econCat(itemId);
  return (o.itemWeight?.[itemId] ?? 1) * (c ? o.categoryWeight?.[c] ?? 1 : 1);
}

/**
 * The item rows a holder / pool draws from under `profile`: the SAME array when no override touches any of its rows; otherwise a
 * re-weighted copy without rows whose weight drops to 0 (all zero -> `[]` = no loot, nothing drawn).
 */
export function resolveRows(profile: LootProfile, rows: ItemRows): ItemRows {
  const o = profile.overrides;
  if (!o.itemWeight && !o.categoryWeight) return rows;
  let touched = false;
  const out: ItemRow[] = [];
  for (const row of rows) {
    const f = rowFactor(o, row[0]);
    if (f === 1) { out.push(row); continue; }
    touched = true;
    const w = row[1] * f;
    if (w > 0) out.push([row[0], w]);
  }
  return touched ? out : rows;
}

/** A category weight (legacy category pick, theme / off-theme re-pick) under `profile`: `w` itself when untouched. */
export function catWeight(profile: LootProfile, cat: EconCat, w: number): number {
  const m = profile.overrides.categoryWeight?.[cat];
  return m === undefined ? w : w * m;
}

/** Availability: the scarcity keep chance of a non-ammo find of category `cat` (`base` itself when untouched; capped at 1). */
export function keepChance(profile: LootProfile, base: number, cat: EconCat): number {
  const m = profile.overrides.keep?.[cat];
  return m === undefined ? base : Math.min(1, base * m);
}

/** A slot's empty chance (`base` itself when untouched; capped at 1). */
export function slotEmpty(profile: LootProfile, slot: SlotCategory | undefined, base: number): number {
  const m = slot ? profile.overrides.slot?.[slot]?.empty : undefined;
  return m === undefined ? base : Math.min(1, base * m);
}

/** A slot's lot-count range (`base` itself when untouched; both ends scaled and rounded). */
export function slotLots(profile: LootProfile, slot: SlotCategory | undefined, base: LotRange): LotRange {
  const m = slot ? profile.overrides.slot?.[slot]?.lots : undefined;
  return m === undefined ? base : [Math.round(base[0] * m), Math.round(base[1] * m)];
}

/** A floor find's chance / keep draw (`p` itself when untouched; capped at 1). */
export function floorChance(profile: LootProfile, cat: EconCat | null, p: number): number {
  const m = cat ? profile.overrides.floor?.chance?.[cat] : undefined;
  return m === undefined ? p : Math.min(1, p * m);
}

/** A floor find's copy range (`n` itself when untouched; both ends scaled and rounded). */
export function floorCount(profile: LootProfile, cat: EconCat | null, n: LotRange): LotRange {
  const m = cat ? profile.overrides.floor?.count?.[cat] : undefined;
  return m === undefined ? n : [Math.round(n[0] * m), Math.round(n[1] * m)];
}

/** Rare-gear parameters under `profile` (the tables' own object when untouched). */
export function gearParams(profile: LootProfile): GearLoot {
  const g = profile.tables.gear, o = profile.overrides.gear;
  if (!o) return g;
  const weights = o.weight ? Object.fromEntries(Object.entries(g.weights).map(([id, w]) => [id, w * (o.weight![id] ?? 1)])) : g.weights;
  return {mean: o.mean === undefined ? g.mean : g.mean * o.mean, cap: o.cap ?? g.cap, weights};
}

// ---------------------------------------------------------------------------------------
// Validation

const finiteNonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isChance = (v: unknown): v is number => finiteNonNeg(v) && v <= 1;
const isRange = (v: unknown): v is LotRange => Array.isArray(v) && v.length === 2 && v.every(x => Number.isInteger(x) && x >= 0) && v[0] <= v[1];

/**
 * Problems with a profile (empty list = valid): its overrides (unknown item / category / slot / gear ids, non-finite or negative
 * multipliers, unknown knobs) and every table it resolves against (unknown item ids, non-finite / negative weights, lots with
 * lo > hi, chances outside [0, 1]) — its rate tables plus the shared named / openable tables and the slot map. An EMPTY table is
 * valid (= no loot). Purpose tables are validated by tests/purposes.test.ts.
 */
export function validateLootProfile(p: LootProfile): string[] {
  const issues: string[] = [];
  const bad = (path: string, msg: string) => issues.push(`${p.id}: ${path}: ${msg}`);
  const rows = (path: string, r: unknown) => {
    if (!Array.isArray(r)) { bad(path, 'not a row list'); return; }
    r.forEach((row, i) => {
      const [id, w] = Array.isArray(row) ? row as [unknown, unknown] : [undefined, undefined];
      if (typeof id !== 'string' || !(id in ITEMS)) bad(`${path}[${i}]`, `unknown item id ${String(id)}`);
      if (!finiteNonNeg(w)) bad(`${path}[${i}]`, `weight ${String(w)} is not a finite number >= 0`);
    });
  };
  const range = (path: string, r: unknown) => { if (!isRange(r)) bad(path, `range ${JSON.stringify(r)} is not integers 0 <= lo <= hi`); };
  const chance = (path: string, v: unknown) => { if (!isChance(v)) bad(path, `chance ${String(v)} is outside [0, 1]`); };
  const weight = (path: string, v: unknown) => { if (!finiteNonNeg(v)) bad(path, `${String(v)} is not a finite number >= 0`); };
  const mults = (path: string, m: unknown, known: (k: string) => boolean, what: string) => {
    if (m === undefined) return;
    if (!m || typeof m !== 'object') { bad(path, 'not a multiplier map'); return; }
    for (const [k, v] of Object.entries(m)) {
      if (!known(k)) bad(`${path}.${k}`, `unknown ${what}`);
      weight(`${path}.${k}`, v);
    }
  };
  const isCat = (k: string) => (ECON_CATS as readonly string[]).includes(k);
  const isSlot = (k: string) => (SLOT_CATEGORIES as readonly string[]).includes(k);
  const known = (path: string, o: object, keys: readonly string[]) => { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${path}.${k}`, 'unknown knob'); };

  // --- overrides
  const o = p.overrides ?? {};
  known('overrides', o, ['itemWeight', 'categoryWeight', 'keep', 'slot', 'floor', 'gear']);
  mults('overrides.itemWeight', o.itemWeight, k => k in ITEMS, 'item id');
  mults('overrides.categoryWeight', o.categoryWeight, isCat, 'economy category');
  mults('overrides.keep', o.keep, isCat, 'economy category');
  if (o.slot) for (const [k, s] of Object.entries(o.slot)) {
    if (!isSlot(k)) bad(`overrides.slot.${k}`, 'unknown slot category');
    if (!s || typeof s !== 'object') { bad(`overrides.slot.${k}`, 'not an object'); continue; }
    known(`overrides.slot.${k}`, s, ['empty', 'lots']);
    if (s.empty !== undefined) weight(`overrides.slot.${k}.empty`, s.empty);
    if (s.lots !== undefined) weight(`overrides.slot.${k}.lots`, s.lots);
  }
  if (o.floor) {
    known('overrides.floor', o.floor, ['chance', 'count']);
    mults('overrides.floor.chance', o.floor.chance, isCat, 'economy category');
    mults('overrides.floor.count', o.floor.count, isCat, 'economy category');
  }
  if (o.gear) {
    known('overrides.gear', o.gear, ['mean', 'cap', 'weight']);
    if (o.gear.mean !== undefined) weight('overrides.gear.mean', o.gear.mean);
    if (o.gear.cap !== undefined && !(Number.isInteger(o.gear.cap) && o.gear.cap >= 0)) bad('overrides.gear.cap', `${String(o.gear.cap)} is not an integer >= 0`);
    mults('overrides.gear.weight', o.gear.weight, k => k in GEAR_ITEMS, 'gear id');
  }

  // --- rate tables
  const t = p.tables;
  for (const [k, w] of Object.entries(t.areaWeights)) w.forEach((v, i) => weight(`tables.areaWeights.${k}[${i}]`, v));
  for (const [k, w] of Object.entries(t.holderMod)) w.forEach((v, i) => weight(`tables.holderMod.${k}[${i}]`, v));
  for (const [k, v] of Object.entries(t.holderEmpty)) chance(`tables.holderEmpty.${k}`, v);
  for (const [k, r] of Object.entries(t.holderLots)) range(`tables.holderLots.${k}`, r);
  if (!Number.isInteger(t.fullRooms.extra) || t.fullRooms.extra < 0) bad('tables.fullRooms.extra', 'not an integer >= 0');
  for (const c of LEGACY_CATS) rows(`tables.pool.${c}`, t.pool[c]);
  rows('tables.vendingFood', t.vendingFood);
  for (const [id, c] of Object.entries(t.boxCount)) {
    if (!(id in ITEMS)) bad(`tables.boxCount.${id}`, 'unknown item id');
    range(`tables.boxCount.${id}.small`, c.small); range(`tables.boxCount.${id}.big`, c.big);
  }
  for (const [id, r] of Object.entries(t.handful)) { if (!(id in ITEMS)) bad(`tables.handful.${id}`, 'unknown item id'); range(`tables.handful.${id}`, r); }
  range('tables.handfulFallback', t.handfulFallback);
  for (const [k, T] of Object.entries(t.themes)) {
    chance(`tables.themes.${k}.keep`, T.keep); chance(`tables.themes.${k}.on`, T.on);
    for (const c of T.cats) if (!isCat(c)) bad(`tables.themes.${k}.cats`, `unknown economy category ${c}`);
    mults(`tables.themes.${k}.weights`, T.weights, isCat, 'economy category');
  }
  mults('tables.offTheme', t.offTheme, isCat, 'economy category');
  for (const c of ECON_CATS) rows(`tables.globalPool.${c}`, t.globalPool[c]);
  for (const [k, v] of Object.entries(t.limb.share)) chance(`tables.limb.share.${k}`, v);
  for (const [k, v] of Object.entries(t.limb.holder)) chance(`tables.limb.holder.${k}`, v);
  rows('tables.limb.pool', t.limb.pool);
  const item = (path: string, id: string, count: number) => {
    if (!(id in ITEMS)) bad(path, `unknown item id ${id}`);
    if (!Number.isInteger(count) || count < 1) bad(path, `count ${count} is not an integer >= 1`);
  };
  const S = t.floor.subway;
  S.boxes.forEach((b, i) => { item(`tables.floor.subway.boxes[${i}]`, b.itemId, b.count); range(`tables.floor.subway.boxes[${i}].n`, b.n); });
  S.kept.forEach((b, i) => { item(`tables.floor.subway.kept[${i}]`, b.itemId, b.count); range(`tables.floor.subway.kept[${i}].n`, b.n); chance(`tables.floor.subway.kept[${i}].keep`, b.keep); });
  S.light.forEach((b, i) => { item(`tables.floor.subway.light[${i}]`, b.itemId, b.count); chance(`tables.floor.subway.light[${i}].chance`, b.chance); });
  const O = t.floor.office;
  item('tables.floor.office.street.box', O.street.box.itemId, O.street.box.count);
  item('tables.floor.office.street.extra', O.street.extra.itemId, O.street.extra.count);
  chance('tables.floor.office.street.extra.chance', O.street.extra.chance);
  O.tower.boxes.forEach((b, i) => item(`tables.floor.office.tower.boxes[${i}]`, b.itemId, b.count));
  for (const key of ['thresholds', 'ammoThresholds'] as const) {
    const th = O.tower[key];
    if (th.length !== O.tower.boxes.length) bad(`tables.floor.office.tower.${key}`, 'one threshold per box');
    th.forEach((v, i) => { chance(`tables.floor.office.tower.${key}[${i}]`, v); if (i && v < th[i - 1]) bad(`tables.floor.office.tower.${key}`, 'thresholds must ascend'); });
  }
  O.scarce.base.forEach((v, i) => chance(`tables.floor.office.scarce.base[${i}]`, v));
  chance('tables.floor.office.scarce.cap', O.scarce.cap); chance('tables.floor.office.scarce.medkit', O.scarce.medkit);
  O.scarce.food.forEach((id, i) => item(`tables.floor.office.scarce.food[${i}]`, id, 1));
  for (const [k, w] of Object.entries(O.tilt)) w.forEach((v, i) => weight(`tables.floor.office.tilt.${k}[${i}]`, v));
  weight('tables.gear.mean', t.gear.mean);
  if (!Number.isInteger(t.gear.cap) || t.gear.cap < 0) bad('tables.gear.cap', `${t.gear.cap} is not an integer >= 0`);
  mults('tables.gear.weights', t.gear.weights, k => k in GEAR_ITEMS, 'gear id');

  // --- shared named / openable tables, eligibility, slot map
  const specs: Record<string, LootSpec> = {STORE_DRINKS, STORE_SNACKS, CACHE_CRATE, OFFICE_DESK, OFFICE_DRAWERS, TENANT_SNACKS, TENANT_FRIDGE, TENANT_KITCHEN, TENANT_TABLE, TENANT_MEDS, TENANT_ARMS, TENANT_SUPPLY};
  for (const [k, s] of Object.entries(specs)) {
    rows(`shared.${k}.items`, s.items);
    if (s.lots) range(`shared.${k}.lots`, s.lots);
    if (s.empty !== undefined) chance(`shared.${k}.empty`, s.empty);
  }
  for (const [k, s] of Object.entries(OPENABLE_TABLES as Readonly<Record<string, OwnTable>>)) {
    rows(`shared.OPENABLE_TABLES.${k}.items`, s.items); range(`shared.OPENABLE_TABLES.${k}.lots`, s.lots); chance(`shared.OPENABLE_TABLES.${k}.empty`, s.empty);
  }
  for (const [k, cats] of Object.entries(HOLDER_ALLOW)) for (const c of cats ?? []) if (!isCat(c)) bad(`shared.HOLDER_ALLOW.${k}`, `unknown economy category ${c}`);
  for (const [k, s] of Object.entries(HOLDER_SLOTS)) if (!isSlot(s)) bad(`shared.HOLDER_SLOTS.${k}`, `unknown slot category ${s}`);
  return issues;
}
