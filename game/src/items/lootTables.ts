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
//  - CURATED REWARDS (task office-interactions-layout-20261030, lane ROOF): REWARD_TABLES / LootTables.rewards — the Office roof cache
//    (ROOF_CACHE), keyed by its holder's loot key, rolled exactly (the documented exception to the scarcity cut).
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
import {BIO_MATER, ELECTRICAL_PARTS, SCRAP_METAL, isMaterialItem} from './craftMaterials'; // lane RACK (office-props-physics-scale-20261030)
import {BUBBLE_TEA, RAMEN, RAMEN_CHASHU, SKYWAYS_DRINK_IDS, SKYWAYS_FOOD_IDS, SUSHI_BENTO} from './skywaysFood'; // task studio-skyways-level-20261106-054448 (lane FOOD)
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
export interface LootSpec {
  items: ItemRows; lots?: LotRange; empty?: number;
  /**
   * Playtest revision (studio-alpha-track2-playtest-revision-20261031-01): an ANNEX-LOCAL table rolled EXACTLY — no level-wide
   * scarcity cut / re-theme / limb conversion (items/lootEconomy.ts scarceFinds): its own `empty` / `lots` / rows ARE the odds (a
   * level profile's slot scaling still applies, as for every table). Only the service-annex keys (ANNEX_*) set it; every core table
   * keeps the scarcity economy unchanged.
   */
  exact?: boolean;
  /**
   * Task studio-alpha-track2-round2-20261031-01 (lane CACHE, R5): `false` = a level's SALVAGE rows (LootTables.salvage, the mall's
   * crafting materials) never join this table (items/lootEconomy.ts salvageRule) — the annex survivor caches hold no crafting material
   * on any level. Absent = the level's salvage rule applies as before.
   */
  salvage?: false;
}
/** A holder kind's OWN table (openable containers; desk-style drawers): lot range, empty chance, item rows. */
export interface OwnTable { lots: LotRange; empty: number; items: ItemRows }
/** Legacy category weights [food, drink, med, ammo] (room types, holder modifiers). */
export type CatWeights = readonly [food: number, drink: number, med: number, ammo: number];
export type LegacyCat = 'food' | 'drink' | 'med' | 'ammo';
export const LEGACY_CATS: readonly LegacyCat[] = ['food', 'drink', 'med', 'ammo'];

/**
 * Economy category of an item (null: weapons / anything that is not a consumable resource). Task office-props-physics-scale-20261030
 * (lane RACK): 'material' = the crafting materials (items/craftMaterials.ts) — kept exactly as rolled by the scarcity economy (like
 * ammo), never an off-theme re-pick (OFF_THEME_WEIGHTS 0) and on no theme's re-pick list, so only the holders whose OWN rows list
 * them (server racks / cupboards, lab storage) ever hold one.
 */
export type EconCat = 'food' | 'drink' | 'med' | 'ammo' | 'battery' | 'flare' | 'material';
export const ECON_CATS: readonly EconCat[] = ['food', 'drink', 'med', 'ammo', 'battery', 'flare', 'material'];

/** Named slot categories every loot-holder kind plugs into (HOLDER_SLOTS). */
export const SLOT_CATEGORIES = ['surface', 'countertop', 'shelf', 'container', 'foodPrep', 'vend', 'cold', 'medical', 'arms', 'junk', 'stash', 'fixture'] as const;
export type SlotCategory = (typeof SLOT_CATEGORIES)[number];

// ---------------------------------------------------------------------------------------
// Item categories (economy)

/** The light lane's item ids (items/items.ts): a consumable torch battery and the throwable flare. */
export const BATTERY_ID = 'battery';
export const FLARE_ID = 'flare';
// + the Skyways ramen restaurant's food / bubble tea (task studio-skyways-level-20261106-054448, lane FOOD): only its own RAMEN_* tables and its
// loose table pickups name them — no shared row, global pool or golden draw changes (econCat only classifies rows that already hold them)
const FOOD = new Set(['chocolate', 'chips', 'beans', 'noodles', 'bread', ...SKYWAYS_FOOD_IDS]); // + bread: lane FURN (office-props-physics-scale-20261030), bakery cases only
const DRINK = new Set<string>(['water', 'cola', 'juice', ...SKYWAYS_DRINK_IDS]);
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
  if (isMaterialItem(itemId)) return 'material'; // lane RACK
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
  footlocker: 'container', // lane HIDEOUT (round 3): the survivor hideout's footlocker
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
  // Task office-interactions-layout-20261030 (lane OPEN): the office-overhaul storage that opens now (world/openablesSpec.ts)
  officeFiling: 'container', executiveDesk: 'container', serverCabinet: 'container', serverRack: 'container', archiveBoxes: 'container',
  vaultSafe: 'arms', labBench: 'medical', examTable: 'medical', biohazardFridge: 'medical',
  // Task office-props-physics-scale-20261030 (lane FURN): the bakery display case (its trays of loaves are a shop display)
  bakeryCase: 'vend',
  // Task track3-eaton-centre-20261031 (lane SHOPS): The Eaton's Center open shop holders (gen/mall/kinds.ts)
  glassCounter: 'countertop', merchTable: 'surface', wallBay: 'shelf', produceStand: 'shelf', bookstoreBookcase: 'container',
  // lane ASSETS batch 1 fixtures (lane SHOPS): open holders + the openable back counters / cabinet / kiosk cart
  retailGondola: 'shelf', clothingWallUnit: 'shelf', checkoutLane: 'countertop', outdoorsPlankShelving: 'shelf', storageTote: 'container', shoeWallDisplay: 'shelf',
  foodCourtTableSet: 'surface', mallCashwrapCounter: 'countertop', glassDisplayCabinet: 'vend', pharmacyDispensaryCounter: 'medical', mallKioskCart: 'countertop',
  medicineDrawerCabinet: 'medical', // lane ASSETS batch 2 M29 (lane SHOPS)
  // lane ASSETS batch 2 resume (12c): the gun safe holds arms by the deliberate rule; the open cooler is cold food / drink
  gunSafeTall: 'arms', dresserDrawers: 'container', cardboardBoxFlaps: 'container', multideckOpenCooler: 'cold', cosmeticsWallUnit: 'shelf',
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
  // track3 lane SHOPS: mall shop holders (their purposes normally decide; these apply in a purpose-less area only)
  glassCounter: [0.8, 0.6, 0.6, 0.2], merchTable: [1, 1, 0.4, 0.1], wallBay: [1, 1, 0.6, 0.2], produceStand: [2, 0.8, 0, 0], bookstoreBookcase: [1, 1, 0.5, 0.1],
  retailGondola: [1.2, 1, 0.6, 0.1], clothingWallUnit: [1, 1, 0.6, 0.1], checkoutLane: [1.2, 1, 0.2, 0.05], outdoorsPlankShelving: [1, 1.2, 0.6, 0.2],
  multideckOpenCooler: [0.8, 2.4, 0, 0], cosmeticsWallUnit: [0.6, 0.6, 1, 0],
  shoeWallDisplay: [1, 1, 0.5, 0.1], foodCourtTableSet: [1, 1.4, 0.1, 0],
};
/** Empty-roll chance of the original table roll (iteration 12: most holders end up empty anyway — items/lootEconomy.ts). */
export const HOLDER_EMPTY: Readonly<Record<string, number>> = {
  cabinetTall: 0.08, cabinetLow: 0.1, crate: 0.12, shelf: 0.08, stall: 0.1, vending: 0.12, table: 0.65, desk: 0.55, shopCounter: 0.3, shopDisplay: 0.25, shopBackbar: 0.3, shopCooler: 0.15,
  stockShelf: 0.12, snackRack: 0.15, hotdogCart: 0.2, grillLine: 0.35, espressoBar: 0.35, wokLine: 0.35, deliLine: 0.35, blenderBar: 0.35,
  kitchenette: 0.25, fridge: 0.15, gunLocker: 0.08, monitorDesk: 0.4, medCabinet: 0.15,
  ...p7(e => e.empty),
  glassCounter: 0.35, merchTable: 0.5, wallBay: 0.3, produceStand: 0.3, bookstoreBookcase: 0.4, // track3 lane SHOPS
  retailGondola: 0.3, clothingWallUnit: 0.5, checkoutLane: 0.45, outdoorsPlankShelving: 0.3, shoeWallDisplay: 0.4, foodCourtTableSet: 0.65,
  multideckOpenCooler: 0.25, cosmeticsWallUnit: 0.45,
};
/** Lot-count range of the original table roll. */
export const HOLDER_LOTS: Readonly<Record<string, LotRange>> = {
  cabinetTall: [2, 5], cabinetLow: [2, 4], crate: [1, 3], shelf: [2, 5], stall: [2, 5], vending: [3, 6], table: [1, 2], desk: [1, 2],
  shopCounter: [1, 3], shopDisplay: [2, 4], shopBackbar: [1, 3], shopCooler: [3, 7],
  stockShelf: [2, 5], snackRack: [2, 4], hotdogCart: [2, 4], grillLine: [1, 3], espressoBar: [1, 3], wokLine: [1, 3], deliLine: [1, 3], blenderBar: [1, 3],
  kitchenette: [1, 3], fridge: [2, 5], gunLocker: [2, 4], monitorDesk: [1, 2], medCabinet: [1, 4],
  ...p7(e => e.lots),
  glassCounter: [1, 3], merchTable: [1, 2], wallBay: [1, 3], produceStand: [1, 3], bookstoreBookcase: [1, 2], // track3 lane SHOPS
  retailGondola: [1, 3], clothingWallUnit: [1, 2], checkoutLane: [1, 2], outdoorsPlankShelving: [1, 3], shoeWallDisplay: [1, 2], foodCourtTableSet: [1, 2],
  multideckOpenCooler: [2, 4], cosmeticsWallUnit: [1, 2],
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
  // Task office-props-physics-scale-20261030 (lane RACK): crafting materials come a few to a lot (a handful of parts / offcuts; a jar or two)
  [ELECTRICAL_PARTS]: {small: [1, 2], big: [2, 3]}, [SCRAP_METAL]: {small: [1, 2], big: [1, 3]}, [BIO_MATER]: {small: [1, 1], big: [1, 2]},
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
 * Task track3-eaton-centre-20261031 (lane PROFILES): SALVAGE — crafting-material rows a level adds to the holders of a themed place
 * (LootTables.salvage). `rows` = the salvage mix (relative weights); `share` = the fraction of the holder's resolved table weight the
 * salvage rows take (0 < share < 1): each salvage row gets weight share / (1 − share) × Σ(table) × rowShare, then the level's item /
 * category weight overrides like any row. Rolled per lot like every row and kept EXACTLY as rolled (category 'material'), so the
 * share is the per-lot material chance before overrides. Applied at RESOLUTION time (items/lootEconomy.ts withSalvage) to own /
 * purpose tables only (never legacy room-type tables, curated rewards or fixtures), only where the holder may hold materials
 * (HOLDER_ALLOW), never to container-themed storage (CONTAINER_THEMED: the container decides) or junk holders.
 */
export interface SalvageRule { rows: ItemRows; share: number }
/** Salvage per place: by purpose id first (gen/purposes.ts), else by the holder's loot theme. Absent = none (every shipped level). */
export interface SalvageTables {
  purposes?: Readonly<Record<string, SalvageRule>>;
  themes?: Readonly<Partial<Record<LootTheme, SalvageRule>>>;
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
export const OFF_THEME_WEIGHTS: Readonly<Record<EconCat, number>> = {food: 0.32, drink: 0.37, med: 0.09, ammo: 0.035, battery: 0.006, flare: 0.004, material: 0}; // lane RACK: materials never off-theme

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
  // lane RACK (office-props-physics-scale-20261030): no theme / off-theme weight re-picks into 'material', so this pool is never drawn today
  material: [[ELECTRICAL_PARTS, 1], [SCRAP_METAL, 1], [BIO_MATER, 1]],
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
  // Task office-interactions-layout-20261030 (lane OPEN): office storage keeps to what its container holds — a vault safe ammo (the
  // deliberate rule) / dressings / flares / batteries; clinic and lab storage medicine and bottled water (lab drawers also spare
  // cells); server cupboards and racks spares (cells, flares, a dressing, bottled water); an archive box a forgotten snack / cell /
  // dressing / flare. Each list covers its own rows' categories (a kept original roll is never re-themed away).
  vaultSafe: ['ammo', 'med', 'flare', 'battery'], examTable: ['med', 'drink'], biohazardFridge: ['med', 'drink'], labBench: ['med', 'battery', 'drink', 'material'], // + material: bio mater (lane FURN)
  // office drawers hold personal stock (snacks, a drink, a dressing, a cell) — never a flare; only the executive desk keeps the
  // generic sidearm rows (the deliberate desk stock)
  officeFiling: ['food', 'drink', 'med', 'battery'], executiveDesk: ['food', 'drink', 'med', 'ammo', 'battery'],
  // lane RACK (office-props-physics-scale-20261030): server racks / cupboards also hold crafting materials (electrical parts, scrap)
  serverCabinet: ['battery', 'flare', 'med', 'drink', 'material'], serverRack: ['battery', 'flare', 'material'], archiveBoxes: ['food', 'med', 'battery', 'flare'],
  // lane FURN (office-props-physics-scale-20261030): a bakery display case only ever holds food (its own rows: bread)
  bakeryCase: ['food'],
  // Task track3-eaton-centre-20261031 (lane SHOPS): a produce stand holds food and drink only (its bins), never salvage or medicine
  produceStand: ['food', 'drink'],
  // lane SHOPS (track3): a glass display cabinet shows goods (no ammo / salvage); the dispensary counter holds medicine and bottled water;
  // a kiosk cart snacks, drinks and cells; a food-court table what diners left
  glassDisplayCabinet: ['food', 'drink', 'med', 'battery', 'flare'], pharmacyDispensaryCounter: ['med', 'drink'], mallKioskCart: ['food', 'drink', 'battery'],
  foodCourtTableSet: ['food', 'drink'],
  medicineDrawerCabinet: ['med', 'drink'], // lane SHOPS (track3, batch 2 M29): a medicine drawer cabinet holds medicine (and bottled water)
  // lane SHOPS (track3, 12c): the gun safe — ammo / gun-care only (never guns: the weapon plan places those); the open cooler food / drink
  gunSafeTall: ['ammo', 'flare', 'battery'], multideckOpenCooler: ['food', 'drink'],
};
/**
 * Task office-interactions-layout-20261030 (lane OPEN): openable containers whose OWN table is never narrowed to the room purpose's
 * rows (items/loot.ts purposeRows): the CONTAINER decides what it holds ("the items inside should be related to the type of container
 * it is"); the room's theme still steers the scarce re-themes within HOLDER_ALLOW. (A bin keeps the narrowing: a pharmacy bin holds
 * pharmacy things.)
 */
export const CONTAINER_THEMED: ReadonlySet<string> = new Set(['officeFiling', 'executiveDesk', 'labBench', 'examTable', 'vaultSafe', 'serverCabinet', 'serverRack', 'biohazardFridge', 'archiveBoxes',
  'bakeryCase', // lane FURN (office-props-physics-scale-20261030): a bakery case holds bread whatever the room
  'pharmacyDispensaryCounter', // lane SHOPS (track3): a dispensary counter holds medicine whatever shop it stands in
  'medicineDrawerCabinet', // lane SHOPS (track3, batch 2 M29): so does the medicine drawer cabinet
  'gunSafeTall']); // lane SHOPS (track3, 12c): a gun safe holds ammo / gun-care whatever back room it stands in (the deliberate ammo rule)
/** Junk holders: whatever the room, their few finds are random (a bin in a security office is still a bin). */
export const RANDOM_HOLDERS: ReadonlySet<string> = new Set(['bin', 'wheelieBin']);

/**
 * Iteration 16 (lane INJURY): LIMB TREATMENTS — each HP-med find (bandage / med kit) becomes a limb treatment with probability
 * `share[theme]` (or the fixture's `holder` share). The roll code reads this LIVE object (tests zero it in place).
 */
export const LIMB_ECONOMY = {
  share: {medical: 0.27, personal: 0.2, security: 0.2, service: 0.2, tech: 0.2, public: 0.19, food: 0.14} as Readonly<Record<LootTheme, number>>,
  /** First-aid fixtures hold treatments whatever room they hang in (a wall first-aid kit in an office break room / corridor). */
  holder: {firstAidWallKit: 0.36, medCabinet: 0.3, crashCart: 0.36, wheeledStretcher: 0.36,
    examTable: 0.36, biohazardFridge: 0.3, // + office clinic storage (lane OPEN)
    pharmacyDispensaryCounter: 0.3, medicineDrawerCabinet: 0.3} as Readonly<Partial<Record<string, number>>>, // + the mall dispensary counter / medicine cabinet (track3 lane SHOPS)
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
// Task office-interactions-layout-20261030 (lane OPEN): the office-overhaul storage's own rows (container-themed: CONTAINER_THEMED).
/** Lateral filing cabinet drawers: office stock without the sidearm rows (ammo only by deliberate rule: the vault safe, the desk). */
export const LATERAL_FILE_ROWS: ItemRows = [['chocolate', 1], ['water', 0.6], ['cola', 0.5], ['chips', 0.4], ['bandage', 0.5], ['juice', 0.3], ['battery', 0.2]];
/** Executive desk drawers: personal stock — snacks, a drink, a dressing, a spare cell, a few rounds of the deliberate desk sidearm stock. */
export const EXEC_DESK_ROWS: ItemRows = [['chocolate', 1], ['water', 0.8], ['juice', 0.6], ['bandage', 0.7], ['battery', 0.3], ...genericAmmo(0.45)];
/**
 * Lab bench drawers: dressings and spare cells (rows unchanged by the bench's rescale). Task office-props-physics-scale-20261030 (lane
 * FURN, user: "Include new resource hear. "Bio mater" for the player to collect"): + a sealed specimen jar of bio mater now and then
 * (a crafting material: kept exactly as rolled, one jar per lot — lootTables BOX_COUNT; finite like every holder).
 */
export const LAB_DRAWER_ROWS: ItemRows = [['bandage', 2], ['battery', 0.45], ['water', 0.3], [BIO_MATER, 0.6]];
/** Exam table drawers: clinic dressings (limb treatments come through LIMB_ECONOMY.holder). */
export const CLINIC_DRAWER_ROWS: ItemRows = [['bandage', 3], ['water', 0.3]];
/** Specimen fridge: cold-chain medicine. */
export const COLD_MED_ROWS: ItemRows = [['bandage', 1.6], ['medkit', 0.6], ['water', 0.4]];
/**
 * Server room cupboards: spares — torch cells, a flare, a dressing, bottled water; task office-props-physics-scale-20261030 (lane RACK):
 * plus salvaged electrical parts and some scrap metal (crafting materials, kept as rolled: ~25 % of the cupboard lots).
 */
/**
 * Task office-props-physics-scale-20261030 (lane FURN): bakery display case trays — stale loaves (the `bread` FOOD item, cut out of the
 * case model). Thinned by the scarcity economy like all food (keep ~0.27 in a food-themed room): ~1 loaf left per case on average.
 */
export const BAKERY_ROWS: ItemRows = [['bread', 1]];
export const SERVER_SPARES_ROWS: ItemRows = [['battery', 1.4], ['flare', 0.6], ['bandage', 0.5], ['water', 0.6], [ELECTRICAL_PARTS, 0.8], [SCRAP_METAL, 0.25]];
/**
 * Task studio-alpha-track2-round2-20261031-01 (round 2): the annex signature rooms' tool lockers — the server spares WITHOUT the
 * crafting materials. The annexes grow on the Subway too, and the Subway never holds a material (craft-materials test); the
 * playtest revision's lockers used SERVER_SPARES_ROWS, so a deep intact boiler / generator-room locker could roll electrical parts
 * (found on Subway 1002 / 1043 / 1234). Materials stay in the server racks / cupboards.
 */
export const ANNEX_SPARES_ROWS: ItemRows = SERVER_SPARES_ROWS.filter(([id]) => !isMaterialItem(id));
/**
 * Task office-props-physics-scale-20261030 (lane RACK): the rebuilt 42U rack's three empty bays — mostly salvage: electrical parts
 * (the common find), some scrap metal (bent rails / brackets), now and then a spare torch cell or a flare left on a shelf. The
 * materials are kept as rolled (scarcity: category 'material'); the cell / flare rows are thinned like every consumable.
 */
export const SERVER_RACK_ROWS: ItemRows = [[ELECTRICAL_PARTS, 3], [SCRAP_METAL, 1.2], ['battery', 0.6], ['flare', 0.2]];
/** Vault safe: the deliberate ammo rule (generic calibre rows) plus dressings / a first-aid kit / a flare — no snacks in a vault. */
export const VAULT_ROWS: ItemRows = [...genericAmmo(2), ['bandage', 0.6], ['medkit', 0.3], ['flare', 0.2]];
/** Archive box: mostly paper; rarely something forgotten. */
export const ARCHIVE_ROWS: ItemRows = [['chocolate', 1], ['battery', 0.6], ['bandage', 0.5], ['flare', 0.3]];
/**
 * Task track3-eaton-centre-20261031 (lane SHOPS): the mall bookstore bookcase (shelves + two base drawers): what people left behind on a
 * shelf or in a staff drawer — narrowed to the shop purpose's rows like every non-themed container (items/loot.ts purposeRows).
 */
export const BOOKCASE_ROWS: ItemRows = [['chocolate', 1], ['water', 0.8], ['cola', 0.5], ['bandage', 0.5], ['chips', 0.4], ['battery', 0.3]];
/** Lane SHOPS (track3): the till / back counter's drawers, cupboard and shelves — staff leftovers (narrowed to the shop purpose's rows). */
export const CASHWRAP_ROWS: ItemRows = [['chocolate', 1], ['water', 0.8], ['battery', 0.6], ['bandage', 0.5], ['cola', 0.5], ['chips', 0.4]];
/** Lane SHOPS (track3): a glass display cabinet's shelves — the shop's small goods (narrowed to its purpose's rows). */
export const GLASS_CABINET_ROWS: ItemRows = [['battery', 1], ['bandage', 0.9], ['water', 0.6], ['chocolate', 0.5], ['flare', 0.2], ['medkit', 0.15]];
/** Lane SHOPS (track3): the dispensary counter (container-themed: medicine in any shop) — dressings, first-aid kits, bottled water. */
export const DISPENSARY_ROWS: ItemRows = [['bandage', 3], ['medkit', 0.7], ['water', 0.5]];
/** Lane SHOPS (track3, batch 2 M29): the medicine drawer cabinet (container-themed) — dressings in the small drawers, kits on the shelves. */
export const MEDICINE_CABINET_ROWS: ItemRows = [['bandage', 3], ['medkit', 0.6], ['water', 0.3]];
/** Lane SHOPS (track3, M18): a stock-room storage tote — what stock rooms keep (narrowed to the room purpose's rows: room-themed). */
export const TOTE_ROWS: ItemRows = [['water', 1], ['beans', 0.8], ['noodles', 0.6], ['bandage', 0.5], ['battery', 0.5], ['chips', 0.4]];
/** Lane SHOPS (track3, 12c M35): a tall gun safe — generic ammo (all calibres equal), flares, cells for the weapon lights; never a gun. */
export const GUN_SAFE_ROWS: ItemRows = [...genericAmmo(2.6), ['flare', 0.5], ['battery', 0.4]];
/** Lane SHOPS (track3, 12c M45): a dresser's drawers — household odds and ends (narrowed to the room purpose's rows). */
export const DRESSER_ROWS: ItemRows = [['bandage', 0.7], ['battery', 0.6], ['chocolate', 0.6], ['water', 0.6], ['cola', 0.4], ['flare', 0.15]];
/** Lane SHOPS (track3, 12c M47): a stock-room carton (narrowed to the room purpose's rows). */
export const CARTON_ROWS: ItemRows = [['water', 1], ['beans', 0.8], ['noodles', 0.6], ['chips', 0.6], ['chocolate', 0.5], ['battery', 0.3], ['bandage', 0.3]];
/** Lane SHOPS (track3): a gallery kiosk cart's cabinet — snacks, drinks, a cell. */
export const KIOSK_CART_ROWS: ItemRows = [['chocolate', 2], ['chips', 2], ['water', 1.2], ['cola', 1.2], ['battery', 0.4]];
/**
 * Task studio-skyways-level-20261106-054448 (lane FOOD): the Skyways RAMEN RESTAURANT's holders (purpose 'skyways-ramen', gen/skyways/
 * ramenPurposes.ts; placed by gen/skyways/ramen.ts with that loot key). Its edible food lies where a ramen bar keeps it — bowls and bento
 * on the service counter's pass, bento / bowls in the kitchen fridge, bubble tea in the glass-door drinks cooler. EXACT (no scarcity
 * cut: the rows are the numbers), small and finite: one or two lots, often none — a restaurant is a treat, not a food fountain. A
 * level profile's 'countertop' / 'cold' slot scaling still applies. The loose pickups are the dresser's own (2-4 per restaurant: RAMEN_LOOSE_ROWS).
 */
export const RAMEN_COUNTER: LootSpec = {items: [[RAMEN, 1.2], [RAMEN_CHASHU, 0.8], [SUSHI_BENTO, 1], [BUBBLE_TEA, 0.4]], lots: [1, 2], empty: 0.35, exact: true};
export const RAMEN_COOLER: LootSpec = {items: [[BUBBLE_TEA, 2.4], ['water', 0.8], ['cola', 0.5]], lots: [1, 2], empty: 0.3, exact: true};
export const RAMEN_FRIDGE: LootSpec = {items: [[SUSHI_BENTO, 1.4], [RAMEN, 0.9], [RAMEN_CHASHU, 0.6], [BUBBLE_TEA, 0.6], ['water', 0.5]], lots: [1, 2], empty: 0.3, exact: true};
/** The kitchen's stainless worktop / open shelving: now and then a covered bento or a bottle left on it. */
export const RAMEN_KITCHEN: LootSpec = {items: [[SUSHI_BENTO, 1], ['water', 0.8], [RAMEN, 0.4]], lots: [1, 1], empty: 0.6, exact: true};
/** What was left standing on the dining tables / the counter's pass: the dresser's few LOOSE pickups (gen/skyways/ramen.ts RAMEN_LOOSE). */
export const RAMEN_LOOSE_ROWS: ItemRows = [[RAMEN, 1.2], [RAMEN_CHASHU, 0.8], [SUSHI_BENTO, 1], [BUBBLE_TEA, 1]];

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
  // task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): the footlocker's own table (only ever placed in a hideout, where the
  // 'annex-cache' key's exact ANNEX_CACHE_LOCKER rolls instead: items/loot.ts holderTable)
  footlocker: {lots: [1, 3], empty: 0.3, items: PERSONAL_ROWS},
  filingCabinet: {lots: [1, 3], empty: 0.35, items: OFFICE_ROWS},
  safe: {lots: [1, 3], empty: 0.4, items: SAFE_ROWS},
  chestFreezer: {lots: [1, 3], empty: 0.35, items: FROZEN_ROWS},
  firstAidWallKit: {lots: [1, 3], empty: 0.3, items: WALL_KIT_ROWS},
  toiletStall: {lots: [1, 2], empty: 0.2, items: TOILET_ROWS},
  // compartments of surface holders (their exposed tops keep their own roll)
  kitchenette: {lots: [1, 2], empty: 0.45, items: PANTRY_ROWS},
  desk: {lots: [1, 1], empty: 0.6, items: OFFICE_ROWS},
  monitorDesk: {lots: [1, 1], empty: 0.5, items: SECURITY_DRAWER_ROWS},
  // Task office-interactions-layout-20261030 (lane OPEN): office-overhaul storage (themed by container: CONTAINER_THEMED; finite,
  // thinned again by the scarcity economy like every holder). The kinds placed in numbers (filing cabinets ~30, lab benches ~20,
  // server racks ~25-60 per Office level since lane RACK's 0.6 m rebuild) are emptier, so the new storage adds ~10 % to the Office's
  // consumable holder lots, not a new economy (tests/office-openables.test.ts measures it); the racks' crafting materials (lane RACK,
  // office-props-physics-scale-20261030) are a separate, bounded resource (~10-40 units per Office level, same test).
  officeFiling: {lots: [1, 2], empty: 0.55, items: LATERAL_FILE_ROWS},
  executiveDesk: {lots: [1, 3], empty: 0.3, items: EXEC_DESK_ROWS},
  labBench: {lots: [1, 2], empty: 0.7, items: LAB_DRAWER_ROWS},
  examTable: {lots: [1, 2], empty: 0.3, items: CLINIC_DRAWER_ROWS},
  vaultSafe: {lots: [1, 3], empty: 0.3, items: VAULT_ROWS},
  serverCabinet: {lots: [1, 3], empty: 0.35, items: SERVER_SPARES_ROWS},
  serverRack: {lots: [1, 2], empty: 0.7, items: SERVER_RACK_ROWS}, // lane RACK: three real empty bays now (was 1 lot, 0.86 empty, spares)
  biohazardFridge: {lots: [1, 1], empty: 0.6, items: COLD_MED_ROWS},
  archiveBoxes: {lots: [1, 1], empty: 0.7, items: ARCHIVE_ROWS},
  // lane FURN (office-props-physics-scale-20261030): the bakery case's three display trays (a handful of goldencrust floors only)
  bakeryCase: {lots: [3, 6], empty: 0.1, items: BAKERY_ROWS},
  // task track3-eaton-centre-20261031 (lane SHOPS): the mall bookcase (open shelves + 2 base drawers), placed in numbers in bookstores
  bookstoreBookcase: {lots: [1, 2], empty: 0.55, items: BOOKCASE_ROWS},
  // lane SHOPS (track3): lane ASSETS batch 1 storage — one counter / dispensary per shop, cabinets / carts a few per mall
  mallCashwrapCounter: {lots: [1, 3], empty: 0.4, items: CASHWRAP_ROWS},
  glassDisplayCabinet: {lots: [1, 3], empty: 0.45, items: GLASS_CABINET_ROWS},
  pharmacyDispensaryCounter: {lots: [2, 4], empty: 0.25, items: DISPENSARY_ROWS},
  mallKioskCart: {lots: [1, 3], empty: 0.35, items: KIOSK_CART_ROWS},
  // lane SHOPS (track3): batch 2 M29 — one per pharmacy / clinic / first-aid room (35 compartments, most of them empty)
  medicineDrawerCabinet: {lots: [2, 4], empty: 0.3, items: MEDICINE_CABINET_ROWS},
  // lane SHOPS (track3): M18 storage totes — 1-3 per stock room, so most stay empty
  storageTote: {lots: [1, 2], empty: 0.55, items: TOTE_ROWS},
  // lane SHOPS (track3, 12c): one gun safe per gun / outdoors back room; dressers a few per home / department store; cartons 1-2 per stock room
  gunSafeTall: {lots: [1, 3], empty: 0.3, items: GUN_SAFE_ROWS},
  dresserDrawers: {lots: [1, 2], empty: 0.45, items: DRESSER_ROWS},
  cardboardBoxFlaps: {lots: [1, 2], empty: 0.55, items: CARTON_ROWS},
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

// ---------------------------------------------------------------------------------------
// Track 2 (lane CONTENT): the SERVICE ANNEX loot context — the cramped, dark back-of-house reached through a side door off a track
// tunnel (gen/trackExt; 0-2 per track-bearing level, each ~25 % of the Subway's walkable exploration area). Its rooms are dressed
// with the existing back-of-house purposes (pump / electrical rooms, stores, workshops, custodial rooms, closets, service
// corridors), so their holders roll those purposes' tables exactly like the core's; the annex ADDS (gen/annexContent.ts, own forks,
// appended after every core record): a STASH holder in its dead-end rooms (loot key ANNEX_STASH_KEY → ANNEX_STASH) and a loose
// floor program per annex (ANNEX_FLOOR). Worth the walk, never guaranteed: every stash may be empty, the floor finds are chances,
// the scarcity cut applies, and the level's ONE rare-gear roll, mask roll, weapon finds and the Office roof rewards are untouched
// (they never land in an annex).

/** Loot key (PropPlacement.purpose = gen/purposes.ts 'annex-stash') of the stash holders a service annex hides in its dead ends. */
export const ANNEX_STASH_KEY = 'annex-stash';
/**
 * A survivor's stash left in a service annex (a crate / tall cabinet in a dead-end room): bottled water and tins, dressings, now
 * and then a first-aid kit, a torch battery or a flare, and generic ammo (~1/3 each caliber).
 * Playtest revision: rolled EXACTLY (`exact`). Before, the level-wide scarcity cut ALSO applied on top of these odds (~1 in 5
 * non-ammo entries kept) and most stashes came up empty or ammo-only (main 312a653, seed 1043: 0 of 2 stashes stocked).
 */
export const ANNEX_STASH_ROWS: ItemRows = [['water', 1.2], ['beans', 1], ['bandage', 1], ['medkit', 0.15], ['battery', 0.5], ['flare', 0.4], ...genericAmmo(1.4)];
/** The stash table (lots / empty): about one stash in ten is empty, the rest 2-3 lots (exact). */
export const ANNEX_STASH: LootSpec = {items: ANNEX_STASH_ROWS, lots: [2, 3], empty: 0.1, exact: true};
/**
 * Loot key (PropPlacement.purpose = gen/purposes.ts 'annex-picked') of an annex's PICKED-OVER storage: GEN's annexes are dozens of
 * small plant rooms, stores and closets, and their purposes' ammo-heavy tables (ammo is never thinned) would have multiplied the
 * level's ammo (measured: +390-570 rounds per level, 1.2-2x the core's holder ammo). So only the DEEPEST holders of each annex keep
 * their room's table (gen/annexContent.ts ANNEX_CONTENT.m2PerIntactHolder: ~8 per annex; deeper = worth the walk); every other
 * annex holder is real, openable, finite storage that someone already went through — mostly bare (like the Office's large-room
 * fill, 'office-fill'), never ammo.
 */
export const ANNEX_PICKED_KEY = 'annex-picked';
/** What a picked-over annex holder may still hold (rows kept for the reference; ANNEX_PICKED itself is searched clean). */
export const ANNEX_PICKED_ROWS: ItemRows = [['water', 1], ['beans', 0.6], ['chips', 0.4], ['bandage', 0.4], ['battery', 0.3]];
/**
 * The picked-over table. Playtest revision: SEARCHED CLEAN (empty 1, exact). Before, it was 90 % empty AND thinned by the
 * level-wide scarcity cut: measured 4 of 609 Subway picked holders stocked (0.7 %), so an ordinary route through an annex opened
 * only empty storage (user report: "I couldn't find one piece of loot"). The annex's finds now come from its distributed SUPPLY
 * holders (ANNEX_SUPPLY, spread entry -> deep), a few SCRAPS (ANNEX_SCRAPS), the stash and the deepest room-table holders
 * (gen/annexContent.ts pickOver) — deterministic counts per annex, not a per-holder lottery.
 */
export const ANNEX_PICKED: LootSpec = {items: ANNEX_PICKED_ROWS, lots: [1, 1], empty: 1, exact: true};

/**
 * Playtest revision (studio-alpha-track2-playtest-revision-20261031-01): loot key of an annex SUPPLY holder — ordinary finite
 * supplies an explorer reliably finds along the way (gen/annexContent.ts ANNEX_CONTENT.loot: ~1 per 170 m² of annex, 6-12, half
 * of them in the entry third, <= 2 per room). Never empty, one lot, rolled exactly; no ammo (the annex's ammo
 * stays its deepest room-table holders' + stash + floor boxes, as before) and nothing high-tier guaranteed (a kit is a 1-in-~25 row).
 * Calibration: the core Subway station stocks ~1/3 of its holders (77-99 of 238-290 on seeds 1043 / 1002 / 777001 / 777002) and
 * yields ~60-100 non-ammo supplies; an annex is ~1/4 of its walkable area, so ~15-25 non-ammo finds per annex is the core's density.
 */
export const ANNEX_SUPPLY_KEY = 'annex-supply';
// (no crafting materials: they belong to the server racks / cupboards only — items/lootTables.ts HOLDER_ALLOW, craft-materials /
// office-openables tests: "the Subway never holds a material")
export const ANNEX_SUPPLY_ROWS: ItemRows = [
  ['water', 1], ['cola', 0.45], ['beans', 0.85], ['noodles', 0.4], ['chocolate', 0.4], ['bandage', 0.75], ['medkit', 0.12],
  ['battery', 0.6], ['flare', 0.35],
];
export const ANNEX_SUPPLY: LootSpec = {items: ANNEX_SUPPLY_ROWS, lots: [1, 1], empty: 0, exact: true};
/** Playtest revision: loot key of an annex SCRAPS holder — one leftover item in otherwise picked-over storage (a capped few per annex). */
export const ANNEX_SCRAPS_KEY = 'annex-scraps';
export const ANNEX_SCRAPS_ROWS: ItemRows = [['water', 1], ['beans', 0.6], ['chips', 0.5], ['bandage', 0.5], ['battery', 0.4]];
export const ANNEX_SCRAPS: LootSpec = {items: ANNEX_SCRAPS_ROWS, lots: [1, 1], empty: 0, exact: true};

/**
 * Task studio-alpha-track2-round2-20261031-01 (lane CACHE, item R5; user: "there's not enough of a reason to go to this place, there
 * should be some "cache" rooms that spawn deeper in, a room like a survivor had been living there"): loot key of the storage in an
 * annex SURVIVOR CACHE room (gen/annexCache.ts: a deep, quiet room with a pallet bed, the survivor's own storage and a few camp
 * things). ONE key, themed per container (gen/purposes.ts 'annex-cache' loot by holder kind), every table rolled EXACTLY
 * (LootSpec.exact: no scarcity cut, no re-theme / limb conversion; the Mall's storage fill never tops it up), NEVER EMPTY, 2-3 lots,
 * and `salvage: false` (no crafting material on any level). Finite like every holder: rolled once per holder stream, remembered by
 * run memory, never refilled. No rare gear, mask or weapon (those stay the level's ONE rolls, never in an annex).
 *  - the open SHELF is the survivor's PANTRY: tins, noodles, chocolate, bottled water, a soda (food / drink only);
 *  - the tall / low CABINET their KIT: dressings, now and then a first-aid kit or a splint / sling, torch batteries, gas-mask filters,
 *    bottled water;
 *  - the CRATE their SUPPLY CRATE — the ONLY cache holder with ammo (the deliberate ammo rule): generic ammo split evenly over the
 *    three calibers every level uses (9mm pistol start, 5.56 rifle, 12-gauge shotgun finds: genericAmmo), in the crate's big-box
 *    stacks (BOX_COUNT big: ~8 / 10 / 4.5 rounds a lot), plus a few tins, water, a dressing, a cell.
 * Expected per cache before fit (3 holders x E[lots] 2.5): food ~1.9, drink ~1.6, dressings ~1.2, first-aid kits ~0.3, batteries
 * ~0.9, gas filters ~0.4, ammo ~1.2 lots (~9 rounds); a 2-holder cache (no third piece fitted) ~2/3 of that. docs/loot-tables.md.
 */
export const ANNEX_CACHE_KEY = 'annex-cache';
export const ANNEX_CACHE_PANTRY_ROWS: ItemRows = [['water', 1.2], ['beans', 1.1], ['noodles', 0.6], ['chocolate', 0.5], ['cola', 0.35]];
// (primary, after the first CI run: the injury economy's "treatments ≈ as common as med kits" — exact tables skip the limb conversion,
// so the kit carries the survivor's own splint / sling and slightly fewer med kits: per Subway station treatments / med kits stays
// in 0.8-1.7, injuries.test.ts)
export const ANNEX_CACHE_KIT_ROWS: ItemRows = [['bandage', 1.3], ['medkit', 0.35], ['leg_splint', 0.12], ['arm_sling', 0.12], ['battery', 0.9], ['gas_filter', 0.55], ['water', 0.4]];
export const ANNEX_CACHE_CRATE_ROWS: ItemRows = [...genericAmmo(1.5), ['beans', 0.5], ['water', 0.4], ['bandage', 0.4], ['battery', 0.3]];
/**
 * Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT; user: "it should have substantial detail applied and contain substantial
 * loot … it needs to be a good pay off for navigating the confusing maze of rooms"): the hideout's FOOTLOCKER at the foot of the bed —
 * the survivor's personal kit: their spare boxes of rounds (the second and last cache holder with ammo: the deliberate rule, generic
 * calibers), flares, torch cells, gas-mask filters, dressings, a treat. No medkit (the injury economy's treatments ≈ med kits band:
 * the kit cabinet carries the cache's med kits with their splint / sling), no material, no gear (the gear piece is its own roll below).
 */
export const ANNEX_CACHE_LOCKER_ROWS: ItemRows = [...genericAmmo(1.0), ['flare', 0.7], ['battery', 0.7], ['gas_filter', 0.5], ['bandage', 0.6], ['chocolate', 0.4], ['water', 0.3]];
/** The cache's pantry shelf: food / drink, never empty, 3-4 lots (round 3: was 2-3; exact, no salvage). */
export const ANNEX_CACHE_PANTRY: LootSpec = {items: ANNEX_CACHE_PANTRY_ROWS, lots: [3, 4], empty: 0, exact: true, salvage: false};
/** The cache's kit cabinet: medicine, cells, gas-mask filters, water, never empty, 2-3 lots (exact, no salvage). */
export const ANNEX_CACHE_KIT: LootSpec = {items: ANNEX_CACHE_KIT_ROWS, lots: [2, 3], empty: 0, exact: true, salvage: false};
/** The cache's supply crate: the deliberate ammo (generic calibers) + a few supplies, never empty, 3-4 lots (round 3: was 2-3; exact, no salvage). */
export const ANNEX_CACHE_CRATE: LootSpec = {items: ANNEX_CACHE_CRATE_ROWS, lots: [3, 4], empty: 0, exact: true, salvage: false};
/** (round 3, lane HIDEOUT) The hideout's footlocker: personal kit + spare rounds, never empty, 2-3 lots (exact, no salvage). */
export const ANNEX_CACHE_LOCKER: LootSpec = {items: ANNEX_CACHE_LOCKER_ROWS, lots: [2, 3], empty: 0, exact: true, salvage: false};
/**
 * (round 3, lane HIDEOUT; user: "perhaps a boosted chance of gear spawning") the hideout's GEAR piece: with `chance` per hideout (each
 * annex's FIRST cache only) ONE piece of rare gear lies in the hideout — drawn from the level profile's gear pool (gearParams(profile)
 * .weights: the level's own GEAR_WEIGHTS with its overrides) plus the gas mask at `gasMask` (its filter charge seeded like the level's
 * mask find, gen/maskLoot.ts). A layout pickup tagged `reward: ANNEX_CACHE_GEAR_KEY` (finite: rolled once from the layout seed,
 * remembered by run memory, never re-rolled); the level's ONE gear roll and mask roll are separate and unchanged.
 */
export const ANNEX_CACHE_GEAR_KEY = 'annex-cache-gear';
export const ANNEX_CACHE_GEAR = {chance: 0.6, gasMask: 0.8} as const;

/**
 * Per service annex (gen/annexContent.ts placeAnnexFloor, fork `track-ext-content` → `loot`), the Subway program's shape: `boxes`
 * (n copies each), the old loose dressings / kits (`n`, each kept with `keep`), then the `light` finds (chances). Landing: the
 * annex rooms' purpose `floor` weights (ammo / med) and FLOOR_ECONOMY.themeWeight (battery / flare). At most one box of each
 * caliber, a kit only through the keep cut: nothing high-tier is guaranteed.
 */
export const ANNEX_FLOOR: SubwayFloorProgram = {
  boxes: [{itemId: 'ammo_556', count: 30, n: [0, 1]}, {itemId: 'ammo_12ga', count: 8, n: [0, 1]}],
  kept: [{itemId: 'medkit', count: 1, n: [0, 1], keep: FLOOR_ECONOMY.medKeep}, {itemId: 'bandage', count: 1, n: [1, 2], keep: FLOOR_ECONOMY.medKeep}],
  light: [{itemId: BATTERY_ID, count: 1, chance: 0.6}, {itemId: FLARE_ID, count: 1, chance: 0.45}],
};

/**
 * Task track3-eaton-centre-20261031 (lane PROFILES): loose floor finds of ONE storey of the mall (gen/mall/supplies.ts
 * placeMallSupplies, stream `mall-supplies-<storey>`, run once per storey under the ONE mall profile; variant `pit` = the subway
 * station storey at the bottom of the atrium, `ring` = each retail floor). Draw order: `ammo.draws` draws against the cumulative
 * `thresholds` -> `boxes[i]` or nothing; then the scarce finds (`scarce-floor` fork): `scarce.draws` times med (a `medkit` share of
 * them a kit, else a bandage), battery, flare; then `salvage.n` loose crafting materials (`salvage` fork: items by `salvage.items`,
 * stack size BOX_COUNT small). WHERE (`place`): a weighted area of the storey — gallery walkways / bridges (`gallery`), shop sales
 * floors (`shop`, × `themed` when the shop's purpose theme is in `themedFor`), back of house (`back`) — on a free walkable cell
 * >= `minCells` walking from the start and off the stair / escalator / elevator landings; a draw with no free cell places nothing.
 * Bounded: at most ammo.draws + 4 × scarce.draws + salvage.n[1] pickups per storey.
 */
export interface MallStoreyFloor {
  ammo: {draws: number; boxes: readonly {itemId: string; count: number}[]; thresholds: readonly number[]};
  scarce: {draws: number; med: number; medkit: number; battery: number; flare: number};
  salvage: {n: LotRange; items: ItemRows};
}
export interface MallFloorProgram {
  pit: MallStoreyFloor;
  ring: MallStoreyFloor;
  place: {gallery: number; shop: number; back: number; themed: number; themedFor: readonly LootTheme[]; minCells: number};
}
/** Loose salvage on a mall floor: shopfitting scrap and stripped wiring first, now and then a dropped specimen jar. */
export const MALL_LOOSE_SALVAGE: ItemRows = [[SCRAP_METAL, 1.4], [ELECTRICAL_PARTS, 1], [BIO_MATER, 0.2]];
/**
 * A ring is ~6-8x an Office storey's floor area but most of it is shop floors full of searchable holders: loose finds scale by ~2x
 * per ring (two ammo-band draws, two scarce draws), not by area. The station pit runs the Office tower storey's odds once.
 * Task mall-playtest-revision-20261031 (lane PROFILES, D08): the compact retail floors are ~1,200-2,700 m² (a little above an
 * Office storey); the ammo / scarce draws are kept (mall ammo per 100 m² of core stays ~0.9x the Office's, food / drink / dressings
 * inside the consumables guard), the loose SALVAGE re-proportioned to the smaller storeys: ring 2..4 -> 1..3, station 1..2 -> 1
 * (crafting materials now come mostly from the shops' drawers / cupboards: MALL_STORAGE_FILL).
 */
export const MALL_FLOOR: MallFloorProgram = {
  pit: {
    ammo: {draws: 1, boxes: [{itemId: 'ammo_9mm', count: 15}, {itemId: 'ammo_556', count: 30}, {itemId: 'ammo_12ga', count: 8}], thresholds: [0.5, 0.75, 0.9]},
    scarce: {draws: 1, med: FLOOR_ECONOMY.medKeep * 1.5, medkit: 0.3, battery: 0.35, flare: 0.14},
    salvage: {n: [1, 1], items: MALL_LOOSE_SALVAGE},
  },
  ring: {
    ammo: {draws: 2, boxes: [{itemId: 'ammo_9mm', count: 15}, {itemId: 'ammo_556', count: 30}, {itemId: 'ammo_12ga', count: 8}], thresholds: [0.4, 0.65, 0.8]},
    scarce: {draws: 2, med: FLOOR_ECONOMY.medKeep * 1.5, medkit: 0.3, battery: 0.3, flare: 0.12},
    salvage: {n: [1, 3], items: MALL_LOOSE_SALVAGE},
  },
  place: {gallery: 1, shop: 0.8, back: 1.3, themed: 2, themedFor: ['tech', 'service'], minCells: 16},
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
/**
 * Relative draw weights (the backpack a little more likely: it is the piece that changes play the most). Task filter-tension-airtank-
 * 20261104-072836: + the Airtank Backpack (back-slot gear, tier 1) at 0.8 — a little rarer than a base piece (optional preparation,
 * not a free 600 s for everyone). It is the ONLY loot change of that task: the count (mean / cap), the other weights and every gas
 * filter / mask table stay exactly as they were; levels whose gear pool inherits these weights (gearParams, the hideout gear rows)
 * can roll it like any other piece, with no level-specific boost.
 */
export const GEAR_WEIGHTS: Readonly<Record<string, number>> = {armor_vest: 1, chest_rig: 1, backpack: 1.4, helmet: 1, boots: 1, gloves: 1, airtank_backpack: 0.8};
export interface GearLoot { mean: number; cap: number; weights: Readonly<Record<string, number>> }
export const GEAR_LOOT: GearLoot = {mean: GEAR_MEAN_PER_LEVEL, cap: GEAR_CAP_PER_LEVEL, weights: GEAR_WEIGHTS};
/**
 * Task mall-round3-20261031 (lane SHOPS, R6): a level's RARE-GEAR PLACEMENT BIAS (LootTables.gearPlace; absent = none, so the Subway
 * / Office placements stay byte-identical). gen/gearLoot.ts placeGear multiplies an area's gear-spot weight (gearAreaWeight, only
 * where it is already > 0: never a passage / stair / platform / extension) by `purposes[area.purpose]` and, for the piece being
 * placed, `items[piece][area.purpose]` (absent: 1). It moves WHERE the level's ONE gear roll lands, never how much gear there is.
 */
export interface GearPlacement {
  /** Multiplier on an area's gear-spot weight by its room purpose (gen/purposes.ts id), for every piece. */
  purposes: Readonly<Record<string, number>>;
  /** Per gear piece (items/gear.ts id): an extra multiplier by room purpose (a pair of work boots is likelier in a shoe store). */
  items?: Readonly<Partial<Record<string, Readonly<Record<string, number>>>>>;
}

// ---------------------------------------------------------------------------------------
// Task office-interactions-layout-20261030 (lane ROOF): CURATED REWARDS — a fixed-place payoff with its own curated table.
// User (2026-10-30): "There is no loot on the roof. The roof is sorta the 'end' of the level so I think there should at least be
// good item up there." docs/loot-tables.md "Roof reward".
//
// A reward is keyed by its holder's LOOT KEY (PropPlacement.purpose; the generator sets it on the one holder it places) and lives in
// the profile's rate tables (LootTables.rewards), so a level tunes or drops it like any table (`tables: {...BASE_TABLES, rewards:
// {...}}`; `{}` = no reward). It is the EXPLICIT EXCEPTION to the scarcity economy: rolled ONCE on its holder's own seeded stream
// like every holder (finite, remembered by run memory, never re-rolled), but EXACTLY — no ~1-in-5 keep cut, no re-theme, no limb
// conversion — and every rolled lot is placed (items/loot.ts packs it with bounded re-packs). Item / category weight overrides
// still apply to its rows; keep / slot overrides do not reach it. No rare-gear roll: gear stays ONE roll per logical level.

/**
 * A curated reward: `holder` = the existing searchable holder kind that carries it (HOLDER_SLOTS); `picks` roll in order, each an
 * own-table roll ({lots, empty, items}: `empty` 0 + `lots` lo >= 1 = guaranteed). Stack sizes follow BOX_COUNT for the holder.
 */
export interface RewardTable { holder: string; label: string; picks: readonly OwnTable[] }

/** Loot key (PropPlacement.purpose) of the Office roof cache (gen/office/roof.ts placeRoofReward). */
export const ROOF_CACHE_KEY = 'roof-cache';
/**
 * THE ROOF CACHE (Office Space, the roof deck — the level's "end"): a supply crate tucked against the roof plant. Value: ONE
 * top-tier medicine, always (a first-aid kit 2 : 1 a trauma kit — the "good item"), and ONE full crate box of ammunition, always
 * (generic: ~1/3 each 9mm 6-10 / 5.56 8-12 / 12-gauge 3-6 rounds, BOX_COUNT big). Finite: one medicine + one box per logical Office
 * run, not a per-floor increase. (Measured: a first-aid kit + a box share the 0.55 m crate floor in >= 93 % of packs — the bounded
 * re-packs place both every time —, a third item beside a first-aid kit in under 15 %, so no light extra: nothing rolled is lost.)
 */
export const ROOF_CACHE: RewardTable = {
  holder: 'crate', label: 'roof supply cache',
  picks: [
    {lots: [1, 1], empty: 0, items: [['medkit', 2], [TRAUMA_KIT, 1]]},
    {lots: [1, 1], empty: 0, items: genericAmmo(1)},
  ],
};
/** Every curated reward by loot key (BASE_TABLES.rewards). */
export const REWARD_TABLES: Readonly<Record<string, RewardTable>> = {[ROOF_CACHE_KEY]: ROOF_CACHE};

// ---------------------------------------------------------------------------------------
// Task gas-mask-roof-feedback-20261030 (user item 10): "Roof also needs more loot. I got just a med kit in this run which is a little
// anti climatic. It should have at least 1 gear or weapon item up there." docs/loot-tables.md "Roof reward".
//
// Why a run showed "just a med kit": the roof cache (above) always holds exactly one medicine + one small generic ammo box (BOX_COUNT
// big: 3-12 rounds, a 2-in-3 chance of a caliber the pistol start cannot use) — nothing is ever lost at runtime (every lot is packed,
// shown and takeable), and nothing else is placed on the roof (weapon finds / supplies are tower-storey programs, rare gear never
// picks the roof). A gun cannot be a crate lot either (no gun display in holders; the crate floor fits one row). So the payoff gets
// a REWARD FIND: one meaningful item laid on the deck beside the cache as an ordinary layout pickup.

/**
 * A curated FIND reward: ONE item rolled from `items` (exactly once per logical level, on its own seeded stream: never a holder roll,
 * no scarcity cut) and laid on the floor as an ordinary layout pickup — finite, remembered by run memory (layout pickup index),
 * never re-rolled. A weapon row also lays a box of the weapon's OWN caliber beside it when `pairedAmmo` (gen/weaponFinds.ts
 * WEAPON_FIND_AMMO — the weapon-find convention); a gear row is the piece alone. Rows naming the run's START weapon are never
 * placed (the starter kit has it; gen/office/validate.ts forbids it as a pickup). Item weight overrides apply to its rows.
 */
export interface RewardFind { label: string; items: ItemRows; pairedAmmo: boolean }

/** Key of the Office roof find (PickupPlacement.reward; gen/office/roof.ts placeRoofFind). */
export const ROOF_FIND_KEY = 'roof-find';
/**
 * THE ROOF FIND (Office Space, beside the roof cache): ONE non-starter long gun with a box of its own ammunition (the rifle + 20
 * 5.56 rounds, the shotgun + 6 shells: 2 in 3 runs) or one piece of protective gear (an armor vest or a hard hat: 1 in 3). Always
 * placed — verified on the reachable deck after placement (gen/office/roof.ts roofRewardIssues rejects an attempt without it).
 * An explicit roof exception: the level's ONE rare-gear roll and every storey's loot are unchanged.
 */
export const ROOF_FIND: RewardFind = {
  label: 'roof weapon / gear find',
  items: [['rifle', 2], ['shotgun', 2], ['armor_vest', 1], ['helmet', 1]],
  pairedAmmo: true,
};
/** Every curated find reward by key (BASE_TABLES.rewardFinds). */
export const REWARD_FINDS: Readonly<Record<string, RewardFind>> = {[ROOF_FIND_KEY]: ROOF_FIND};

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
  /**
   * Loose floor programs (+ task track3-eaton-centre-20261031 lane PROFILES: the mall's per-storey program). Track 2 (lane CONTENT):
   * `annex` = once per service annex (absent = no annex floor finds).
   */
  floor: {subway: SubwayFloorProgram; office: OfficeFloorProgram; mall: MallFloorProgram; annex?: SubwayFloorProgram};
  /** Rare gear. */
  gear: GearLoot;
  /** Task office-interactions-layout-20261030 (lane ROOF): curated rewards by loot key (REWARD_TABLES; absent / {} = none). */
  rewards?: Readonly<Record<string, RewardTable>>;
  /** Task gas-mask-roof-feedback-20261030 (item 10): curated find rewards by key (REWARD_FINDS; absent / {} = none). */
  rewardFinds?: Readonly<Record<string, RewardFind>>;
  /** Task track3-eaton-centre-20261031 (lane PROFILES): crafting-material salvage per place (SalvageTables; absent = none). */
  salvage?: SalvageTables;
  /**
   * Task mall-playtest-revision-20261031 (lane SHOPS, U10): per-COMPARTMENT storage fill by holder kind (StorageFill; absent = none:
   * every Subway / Office table, so their rolls stay byte-identical — tests/loot-golden.test.ts).
   */
  storageFill?: Readonly<Partial<Record<string, StorageFill>>>;
  /** Task mall-round3-20261031 (lane SHOPS, R6): rare-gear placement bias by room purpose / piece (GearPlacement; absent = none). */
  gearPlace?: GearPlacement;
}
export const BASE_TABLES: LootTables = {
  areaWeights: AREA_WEIGHTS, holderMod: HOLDER_MOD, holderEmpty: HOLDER_EMPTY, holderLots: HOLDER_LOTS, fullRooms: FULL_ROOMS,
  pool: LEGACY_POOL, vendingFood: VENDING_FOOD,
  boxCount: BOX_COUNT, bigBoxHolders: BIG_BOX_HOLDERS, handful: HANDFUL, handfulFallback: HANDFUL_FALLBACK,
  themes: THEME_ECONOMY, offTheme: OFF_THEME_WEIGHTS, globalPool: GLOBAL_POOL, limb: LIMB_ECONOMY,
  floor: {subway: SUBWAY_FLOOR, office: OFFICE_FLOOR, mall: MALL_FLOOR, annex: ANNEX_FLOOR}, // + mall: read only by gen/mall/supplies.ts (lane PROFILES); Track 2 (lane CONTENT): + the per-annex program
  gear: GEAR_LOOT,
  rewards: REWARD_TABLES, // lane ROOF (office-interactions-layout-20261030)
  rewardFinds: REWARD_FINDS, // task gas-mask-roof-feedback-20261030 (item 10)
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

// ---------------------------------------------------------------------------------------
// Task track3-eaton-centre-20261031 (lane PROFILES): THE EATON'S CENTER (LevelId 'mall', tier 2). User: "I also want the shopping
// mall to be a significant source of the crafting materials, the electrical parts, the scrap metal, and the bio material ... It
// should be much more common in this area". docs/loot-tables.md "The mall" (the display name is seeded per run: "<Name> Center").
//
// The mall rolls the SHARED base tables (every consumable, ammo, box size, scarcity and limb number is the Subway / Office one) plus
// MALL SALVAGE: crafting-material rows added at resolution time to the own / purpose tables of the shops and back-of-house rooms
// whose purpose / theme fits (electronics -> electrical parts, hardware -> scrap metal, pharmacy / clinic -> bio mater, stock rooms
// and service corridors -> mixed salvage), kept exactly as rolled like every material, finite and placed only where they fit (the
// holder's surfaces: items/lootLayout.ts). Loose salvage lies on the floors too (MALL_FLOOR). Normalised richness vs the Office
// (per holder / per 100 m² of usable floor, placed + reachable) is measured by game/tests/mall-profiles.test.ts.

/** Electronics / phone / arcade / music stock and back rooms: salvaged boards and wiring first, some chassis scrap. */
export const MALL_ELECTRONICS_SALVAGE: ItemRows = [[ELECTRICAL_PARTS, 3], [SCRAP_METAL, 0.7]];
/** Hardware / home / sports / outdoors / workshops: offcuts, brackets and fixings first, some wiring. */
export const MALL_HARDWARE_SALVAGE: ItemRows = [[SCRAP_METAL, 3], [ELECTRICAL_PARTS, 0.9]];
/** Pharmacy / clinic / optical lab / pet care: sealed specimen jars of culture. */
export const MALL_BIO_SALVAGE: ItemRows = [[BIO_MATER, 1]];
/** Back of house (stock rooms, service corridors, loading): shelving brackets, conduit, cable, the odd forgotten jar. */
export const MALL_STOCKROOM_SALVAGE: ItemRows = [[SCRAP_METAL, 1.6], [ELECTRICAL_PARTS, 1.1], [BIO_MATER, 0.15]];

/**
 * THE MALL SALVAGE (LootTables.salvage): purpose entries first (shared purpose ids that occur in the mall; SHOPS' mall purposes add
 * theirs through their theme or here), else the holder's loot theme. Shares are per-lot material chances in a fitting holder.
 * Food counters / coolers / fridges, first-aid fixtures and gun lockers never take materials (HOLDER_ALLOW); public halls roll the
 * legacy tables (no salvage there: their salvage is the loose MALL_FLOOR program).
 */
export const MALL_SALVAGE: SalvageTables = {
  purposes: {
    // tech shops and their stock rooms (the 'tech' theme gives the rest of them electronics salvage at 0.3)
    'mall-electronics': {rows: MALL_ELECTRONICS_SALVAGE, share: 0.35}, 'mall-electronics-back': {rows: MALL_ELECTRONICS_SALVAGE, share: 0.4},
    'mall-phone': {rows: MALL_ELECTRONICS_SALVAGE, share: 0.35}, 'mall-phone-back': {rows: MALL_ELECTRONICS_SALVAGE, share: 0.4},
    'mall-arcade-back': {rows: MALL_ELECTRONICS_SALVAGE, share: 0.4}, 'mall-music-back': {rows: MALL_ELECTRONICS_SALVAGE, share: 0.35},
    // hardware / outdoors / sports / home / jewellery / luggage: scrap metal first
    'mall-hardware': {rows: MALL_HARDWARE_SALVAGE, share: 0.4}, 'mall-hardware-back': {rows: MALL_HARDWARE_SALVAGE, share: 0.45},
    'mall-outdoors': {rows: MALL_HARDWARE_SALVAGE, share: 0.25}, 'mall-outdoors-back': {rows: MALL_HARDWARE_SALVAGE, share: 0.3},
    'mall-sports': {rows: MALL_HARDWARE_SALVAGE, share: 0.15}, 'mall-sports-back': {rows: MALL_HARDWARE_SALVAGE, share: 0.2},
    'mall-home': {rows: MALL_STOCKROOM_SALVAGE, share: 0.15}, 'mall-home-back': {rows: MALL_STOCKROOM_SALVAGE, share: 0.25},
    'mall-jewelry': {rows: MALL_HARDWARE_SALVAGE, share: 0.1}, 'mall-luggage': {rows: MALL_HARDWARE_SALVAGE, share: 0.1},
    'mall-toys': {rows: MALL_ELECTRONICS_SALVAGE, share: 0.12}, 'mall-department-back': {rows: MALL_STOCKROOM_SALVAGE, share: 0.2},
    'mall-guns-back': {rows: MALL_HARDWARE_SALVAGE, share: 0.2},
    // pharmacy / clinic / optician / first aid: bio mater (the 'medical' theme gives 0.15); pet care and the florist's workroom too
    'mall-clinic': {rows: MALL_BIO_SALVAGE, share: 0.2}, 'mall-clinic-back': {rows: MALL_BIO_SALVAGE, share: 0.25},
    'mall-pharmacy-back': {rows: MALL_BIO_SALVAGE, share: 0.2}, 'mall-optical-back': {rows: MALL_BIO_SALVAGE, share: 0.2},
    'mall-pet': {rows: MALL_BIO_SALVAGE, share: 0.12}, 'mall-pet-back': {rows: MALL_BIO_SALVAGE, share: 0.18},
    'mall-florist-back': {rows: MALL_BIO_SALVAGE, share: 0.1},
    // stripped vacant units and the janitorial rooms: shopfitting debris, conduit, cable
    'mall-vacant': {rows: MALL_STOCKROOM_SALVAGE, share: 0.2}, 'mall-vacant-back': {rows: MALL_STOCKROOM_SALVAGE, share: 0.2},
    'mall-janitorial': {rows: MALL_STOCKROOM_SALVAGE, share: 0.3},
    // shared back-of-house purposes, should the mall's service ring use them
    'electrical-room': {rows: MALL_ELECTRONICS_SALVAGE, share: 0.35}, 'electrical-closet': {rows: MALL_ELECTRONICS_SALVAGE, share: 0.35},
    workshop: {rows: MALL_HARDWARE_SALVAGE, share: 0.35}, 'pump-room': {rows: MALL_HARDWARE_SALVAGE, share: 0.3},
  },
  themes: {
    tech: {rows: MALL_ELECTRONICS_SALVAGE, share: 0.3},
    service: {rows: MALL_STOCKROOM_SALVAGE, share: 0.3},
    medical: {rows: MALL_BIO_SALVAGE, share: 0.15},
    security: {rows: MALL_HARDWARE_SALVAGE, share: 0.1},
    personal: {rows: MALL_STOCKROOM_SALVAGE, share: 0.08},
  },
};
/**
 * Task mall-playtest-revision-20261031 (lane SHOPS, U10 — user: "a lot of drawers and cupboards are openable however I'm not seeing
 * much loot in them ... just make sure we put loot inside the drawers and cupboards"): STORAGE FILL — a per-compartment roll for the
 * closed storage of a level (LootTables.storageFill, by holder kind).
 *
 * Why: a storage holder rolls ONE table roll for the whole unit (own empty 0.3-0.55, 1-3 lots), the iteration-12 scarcity cut keeps
 * ~1 in 5 non-ammo entries (1 in 16 in the 'service'-themed mall stock rooms) and the survivors spread over EVERY surface of the unit
 * — exposed tops / shelves included. Measured on the dressed synthetic mall (2 seeds, mall profile): ~5 % of compartments held
 * anything (cash-wrap counter 3 of 84, medicine cabinet 2 of 350, bookcase drawers 2 of 88, totes 19 of 121, carton flaps 19 of 196,
 * kitchenette cupboards 1 of 72, desk drawers 1 of 48), although every placed lot was visible and takeable once opened.
 *
 * What: AFTER the holder's own roll (its lots, streams and placements unchanged), every compartment it left EMPTY rolls once on its
 * own stream `loot:<kind>:<index>:fill<part>` (a one-door / one-lid holder is one compartment): with probability `chance` x
 * min(1, compartment loot area / `area`) — so a 6 cm wide pill drawer is far less likely than a cupboard — it gets U{lots} lots drawn
 * from the holder's RESOLVED rows (its own / purpose table: container- or purpose-themed, incl. the place's salvage rows) restricted to
 * `cats` and HOLDER_ALLOW and re-weighted by category (`weights`), packed on that compartment's own surfaces only (an item that fits
 * nowhere is dropped). Defaults (STORAGE_FILL_CATS / STORAGE_FILL_WEIGHTS): the shop's own stock — food and drink at 0.25 of their row
 * weight (lane PROFILES' guard: mall consumables per 100 m² stay < 2.5x the Office's), torch cells, flares and the place's salvage
 * (crafting materials: the mall's signature resource, only where its rows carry them); dressings only in first-aid / medical storage
 * (MED_FILL), food in food storage (FOOD_FILL), ammo only by the deliberate arms rule. Finite, seeded once with the level, remembered
 * by lot id like every holder lot (never re-rolled on open / close / revisit). Not every drawer holds something: these are the
 * intentional empty odds.
 */
export interface StorageFill {
  /** Chance an empty compartment gets lots (full-size compartment). */
  chance: number;
  /** Loot area (m², its surfaces summed) at and above which the full chance applies; smaller compartments scale linearly. */
  area: number;
  /** Lots per filled compartment. */
  lots: LotRange;
  /** Economy categories the fill draws (default STORAGE_FILL_CATS). */
  cats?: readonly EconCat[];
  /** Row-weight multipliers by category (absent category: 1; default STORAGE_FILL_WEIGHTS when `cats` is absent too). */
  weights?: Readonly<Partial<Record<EconCat, number>>>;
  /**
   * Task mall-playtest-revision-20261031 (lane PROFILES, U10 follow-up): FALLBACK categories (a subset of `cats`) — drawn only when the
   * compartment's pool holds no row of any other category (default STORAGE_FILL_FALLBACK when `cats` is absent too; [] otherwise).
   */
  fallback?: readonly EconCat[];
}
/**
 * What a storage fill draws by default: the shop's stock (food / drink weighed down), torch cells, flares and the place's salvage — no
 * dressings (first-aid storage only: MED_FILL) and no ammo (the arms rule only).
 * Task mall-playtest-revision-20261031 (lane PROFILES, U10 follow-up): the drawers / cupboards now favour the mall's CRAFTING
 * MATERIALS (x3 on the place's salvage rows — only where the place carries salvage: electronics / hardware / stock rooms /
 * medical labs, never a food unit's cupboard) and the small themed items (torch cells, flares) over snacks: food / drink 0.25 -> 0.05
 * (lane PROFILES' consumables guard: mall food / drink / dressings per 100 m² of core stay < 2.5x the Office's — the compact mall's
 * dense shop rolls alone reach ~1.8x; measured in game/tests/mall-profiles.test.ts).
 */
export const STORAGE_FILL_CATS: readonly EconCat[] = ['food', 'drink', 'battery', 'flare', 'material'];
export const STORAGE_FILL_WEIGHTS: Readonly<Partial<Record<EconCat, number>>> = {battery: 0.25, material: 3};
/**
 * (lane PROFILES, mall revision) Snacks / drinks fill a drawer or cupboard only where the place stocks nothing else that fits there
 * (an optician's display cabinet: bottled water) or where they ARE the place's stock (STORAGE_FILL_STOCK_THEMES: a grocer's / food
 * unit's / pet shop's storage); elsewhere the fill is the place's salvage (stock rooms: shelving brackets, conduit, cable; tills: a
 * dead card reader's boards), torch cells and flares — the consumables guard (docs/loot-tables.md) holds.
 */
export const STORAGE_FILL_FALLBACK: readonly EconCat[] = ['food', 'drink'];
/** (lane PROFILES, mall revision) Loot themes whose fallback categories are the place's OWN stock (never held back): food places. */
export const STORAGE_FILL_STOCK_THEMES: readonly LootTheme[] = ['food'];
const MED_FILL = {cats: ['med', 'drink'], weights: {drink: 0.25}} as const; // (lane PROFILES, mall revision: drink 0.5 -> 0.25)
const FOOD_FILL = {cats: ['food', 'drink'], weights: {}} as const;
const ARMS_FILL = {cats: ['ammo', 'flare', 'battery'], weights: {}} as const;
/** (ci-followup 20261101) a crash cart's drawers: medicine, and spare defibrillator / monitor cells — the only stock that fits its 6.5-7.8 cm upper drawers. */
const CRASH_CART_FILL = {cats: ['med', 'battery', 'drink'], weights: {drink: 0.25}} as const;
/** (lane PROFILES, mall revision) a kiosk cart's cupboards: its own snack / drink / cell stock at its row weights. */
const KIOSK_FILL = {cats: ['food', 'drink', 'battery'], weights: {}} as const;
const fillRule = (chance: number, area = 0.12, lots: LotRange = [1, 1], o?: {cats: readonly EconCat[]; weights: Readonly<Partial<Record<EconCat, number>>>}): StorageFill =>
  ({chance, area, lots, ...(o ? {cats: o.cats, weights: o.weights} : {})});
/**
 * The mall's storage fill (lane SHOPS, U10): drawers / cupboards / cabinets a shop or its stock room is fitted with (the mall's own
 * storage + the station / office storage reused in its back rooms); the gun safe tops up with ammo by the deliberate arms rule;
 * crates, bins, coolers, old / vault safes (already themed ammo / medicine stores) and open holders are unchanged.
 * Task mall-playtest-revision-20261031 (lane PROFILES, U10 follow-up — the user: "make sure we put loot inside the drawers and
 * cupboards"): SHOPS' first fill left ~17 % of the drawer / cupboard compartments of a generated compact mall stocked (cash wrap 16 %,
 * bookcase drawers 14 %, cartons 10 %, medicine cabinet 12 %, tool chest 4 %: evidence/census/baseline-before.json). Chances raised so
 * a player opening drawers / cupboards in shops and stock rooms finds something themed in roughly a third to a half of them. MEASURED
 * stocked rate per compartment (the holder's own roll included; 10 generated malls, task folder evidence/census/after.json):
 *   cash-wrap drawers 41 %, carton halves 38 %, totes 42 %, dresser drawers 48 %, tall / low cabinets 58 % / 51 %, desks 38 %, kiosk
 *   carts 39 %, staff lockers 37 %, glass display cabinets 31 %, kitchenette cupboards 30 %, dispensary drawers / cupboards 30 %,
 *   bookcase drawers 27 %, tool-chest drawers 22 % (shallow top drawers take only flat items); the medicine cabinet's 33 pill drawers
 *   23 % (dressings only: a pharmacy is a medicine source already; every pill drawer filled would flood dressings past the
 *   consumables guard). Overall 35 % of the drawer / cupboard compartments of a mall hold something (38 % without the pill drawers);
 *   the rest are the intentional empty odds. Still finite, seeded once, remembered by lot id; the themes and HOLDER_ALLOW unchanged.
 */
export const MALL_STORAGE_FILL: Readonly<Partial<Record<string, StorageFill>>> = {
  // the mall's own storage (lane ASSETS models; the medicine cabinet's 33 pill drawers (0.04 m²) each 16 %, its cupboard / door bay too)
  mallCashwrapCounter: fillRule(0.4), pharmacyDispensaryCounter: fillRule(0.35, 0.12, [1, 1], MED_FILL), medicineDrawerCabinet: fillRule(0.16, 0.04, [1, 1], MED_FILL), dresserDrawers: fillRule(0.43),
  glassDisplayCabinet: fillRule(0.25, 0.3), mallKioskCart: fillRule(0.32, 0.2, [1, 1], KIOSK_FILL), bookstoreBookcase: fillRule(0.25), storageTote: fillRule(0.4), cardboardBoxFlaps: fillRule(0.5, 0.08),
  gunSafeTall: fillRule(0.4, 0.1, [1, 1], ARMS_FILL),
  // station / office storage in the mall's back rooms, offices, clinic and food units
  cabinetTall: fillRule(0.45), cabinetLow: fillRule(0.45), staffLockers: fillRule(0.2, 0.1), kitchenette: fillRule(0.3, 0.2, [1, 1], FOOD_FILL), desk: fillRule(0.36), monitorDesk: fillRule(0.3),
  filingCabinet: fillRule(0.3), officeFiling: fillRule(0.3), chestFreezer: fillRule(0.2, 0.12, [1, 1], FOOD_FILL), examTable: fillRule(0.25, 0.12, [1, 1], MED_FILL),
  labBench: fillRule(0.15, 0.12, [1, 1], MED_FILL), biohazardFridge: fillRule(0.3, 0.12, [1, 1], MED_FILL), crashCart: fillRule(0.35, 0.12, [1, 1], CRASH_CART_FILL), /* (ci-followup 20261101: 0.25 -> 0.35, like the dispensary / tool chest) */ rollingToolChest: fillRule(0.35),
};
/** (lane SHOPS, R6) multiplier `sales` on the sales floor and `back` on the stock room of each mall program (`mall-<p>` / `mall-<p>-back`). */
const mallShops = (progs: readonly string[], sales: number, back = sales): Record<string, number> =>
  Object.fromEntries(progs.flatMap(p => [[`mall-${p}`, sales], [`mall-${p}-back`, back]]));
/** Fashion / accessory shops: a hard hat or body armour is out of place there. */
const MALL_BOUTIQUES = ['clothing', 'womenswear', 'shoes', 'luggage', 'department', 'lingerie']; // (+ task mall-lingerie-20261102, lane STORE)
/**
 * Task mall-round3-20261031 (lane SHOPS, R6 — user: "clothing stores should have higher gear drop chance (no need to change if this is
 * already the case). The same idea applies to all stores where the theme would reasonably boost spawn chance of associated loot."):
 * THE MALL'S RARE-GEAR PLACEMENT BIAS (LootTables.gearPlace, read by gen/gearLoot.ts placeGear). It was NOT the case: a shop's sales
 * floor weighed 0.4 and its stock room 1.5 whatever it sold, so a clothing store held a piece in ~3 % of runs, like any shop (measured
 * on 10 generated malls: gear-themed stores 3.4 % per store per run vs 2.4 % elsewhere; 21 % of the gear in them).
 *  - purposes: the wearable-gear shops (clothing, womenswear, outdoors, sports, shoes, department, luggage) weigh x12 on the sales
 *    floor (0.4 -> 4.8: the piece lies by a rack / mannequin / counter) and x4 in their stock room (1.5 -> 6);
 *  - items (per piece; the gear is workwear / kit: items/gear.ts): the work boots -> shoe store x3, hardware x4, outdoors / clothing /
 *    womenswear x1.5; the work gloves -> hardware x6, clothing / womenswear x2, outdoors / sports x1.5; the daypack -> luggage x4,
 *    outdoors / sports x2, clothing / womenswear / department x1.5; the hard hat -> hardware x10, outdoors x1.5; the armour vest /
 *    chest rig -> the gun shop x10 (its benches / pickups leave few free cells), mall security x3 (the rig also outdoors x1.5); the
 *    hard hat x0.4 and the armour x0.2-0.25 in the boutiques, the armour x0.5 in sporting goods.
 * Still ONE roll per logical level with the shared GEAR_LOOT count / weights (no mean change): only where the pieces land moves.
 * Measured (the same 10 generated malls, womenswear on, unbiased vs biased placement on identical layouts, 240 level rolls each): a
 * gear-themed store holds a piece in 8.0 % of runs (was 3.4 %; other shops 2.4 % -> 1.7 %: 4.7x), 50 % of the gear lands in them (21 %),
 * a run has a piece in one of them 39 % of the time (19 %); clothing 3.3 -> 7.0 %, womenswear 3.0 -> 6.3 %, outdoors 3.9 -> 12.9 %,
 * sports 4.4 -> 10 %, shoes 3.0 -> 6.6 %; hard hats in hardware, armour in the gun shop (docs/loot-tables.md "The mall";
 * tests/mall-themed-loot.test.ts).
 */
export const MALL_GEAR_PLACE: GearPlacement = {
  purposes: mallShops(['clothing', 'womenswear', 'outdoors', 'sports', 'shoes', 'department', 'luggage'], 12, 4),
  items: {
    boots: {...mallShops(['shoes'], 3), ...mallShops(['hardware'], 4), ...mallShops(['outdoors', 'clothing', 'womenswear'], 1.5)},
    gloves: {...mallShops(['hardware'], 6), ...mallShops(['clothing', 'womenswear'], 2), ...mallShops(['outdoors', 'sports'], 1.5)},
    // (ci-followup 20261101: + shoes x1.5 like its fashion peers — shoe stores stock bags; without it the shoe store was the one wearable-gear
    // shop with NO daypack affinity, so a mall with a luggage store (its x4 holds ~30 % of the daypack weight) left it at 1.87x per store)
    backpack: {...mallShops(['luggage'], 4), ...mallShops(['outdoors', 'sports'], 2), ...mallShops(['clothing', 'womenswear', 'department', 'shoes'], 1.5)},
    helmet: {...mallShops(['hardware'], 10), ...mallShops(['outdoors'], 1.5), ...mallShops(MALL_BOUTIQUES, 0.4)},
    armor_vest: {...mallShops(['guns'], 10), 'mall-security': 3, ...mallShops(['sports'], 0.5), ...mallShops(MALL_BOUTIQUES, 0.2)},
    chest_rig: {...mallShops(['guns'], 10), 'mall-security': 3, ...mallShops(['outdoors'], 1.5), ...mallShops(['sports'], 0.5), ...mallShops(MALL_BOUTIQUES, 0.25)},
  },
};
/**
 * The mall's rate tables: the shared base tables + the mall salvage (the floor program MALL_FLOOR is in BASE_TABLES.floor.mall) + (lane
 * SHOPS, U10) its storage fill + (lane SHOPS, R6) its rare-gear placement bias.
 */
export const MALL_TABLES: LootTables = {...BASE_TABLES, salvage: MALL_SALVAGE, storageFill: MALL_STORAGE_FILL, gearPlace: MALL_GEAR_PLACE};
/**
 * The mall's per-level overrides — the tuning dial on top of MALL_SALVAGE (docs/loot-tables.md "The mall"):
 *  - categoryWeight.material: every material row of the mall's tables (the salvage rows included, and so the storage fill's pools)
 *    weighs this much. Track3 (six rings, ~2,600 holders a run): 0.6 brought the raw ~13x the Office's materials per 100 m² to ~8x
 *    (per reachable holder ~7x). Task mall-playtest-revision-20261031 (lane PROFILES, D08): 0.6 -> 0.25 — the compact mall packs its
 *    shops ~1.5x denser per m² (8.6 vs 5.7 holders per 100 m² in the Office) and the U10 storage fill now puts the salvage INSIDE the
 *    drawers / cupboards (x3 there); with 0.25 the open shelves keep a lighter share, and the whole mall measures ~14x the Office per
 *    100 m² of core and ~8.5x per reachable holder (same-method census, evidence/census/after.json; without the fill ~7x / ~4x) —
 *    the level's signature resource, concentrated in its storage;
 *  - itemWeight.bio_mater 1.5: the scarcest material (pharmacy / clinic / optician / pet stock rooms only) lifted so it stays a real
 *    mall find.
 */
export const MALL_OVERRIDES: LootOverrides = {categoryWeight: {material: 0.25}, itemWeight: {[BIO_MATER]: 1.5}};
/** (mall revision, U01) the label is the generic one: the mall's display name is seeded per run ("<Name> Center", gen/mall/names.ts). */
export const MALL_PROFILE: LootProfile = {id: 'mall', label: 'Mall (seeded "<Name> Center")', tables: MALL_TABLES, overrides: MALL_OVERRIDES};
/** Task reactor-playtest-round2-20261102 (lane ARRIVAL): the Reactor's lot-range multiplier on ordinary holders (REACTOR_OVERRIDES.slot). */
export const REACTOR_PICKED_OVER = 0.7;
/**
 * Task reactor-playtest-round2-20261102 (lane ARRIVAL): the Reactor's storage-fill chance multiplier. The mall's fill tops up EVERY
 * compartment a holder's own roll left empty (batteries, flares, the crafting materials), so fewer lots alone would only move units into
 * the fill; the Reactor's tables are the mall's with this one rule scaled (REACTOR_TABLES). The mall itself is unchanged.
 */
export const REACTOR_FILL_SCALE = 0.65;
export const REACTOR_TABLES: LootTables = {
  ...MALL_TABLES,
  storageFill: Object.fromEntries(Object.entries(MALL_STORAGE_FILL).map(([k, f]) => [k, {...f!, chance: f!.chance * REACTOR_FILL_SCALE}])),
};
/** Task reactor-build-20261101 (primary): THE REACTOR (tier 3) — MALL_TABLES under scarcer ammo / medicine / batteries. */
export const REACTOR_OVERRIDES: LootOverrides = {
  categoryWeight: {ammo: 0.75, med: 0.8, battery: 0.85, material: 0.2},
  // task reactor-playtest-round2-20261102 (lane ARRIVAL): the round-2 rooms (rock suites, the arrival station area, the complexes' room
  // graphs) brought ~45 % more furnished holders; the level's TOTAL loot stays at its previous level — every ordinary holder rolls
  // fewer lots (picked over before you got there). The armoury's gun lockers (arms), the fixtures and the floor finds are untouched.
  slot: {
    ...Object.fromEntries((['shelf', 'surface', 'countertop', 'vend', 'cold', 'medical', 'junk', 'stash'] as const).map(s => [s, {lots: REACTOR_PICKED_OVER}])),
    container: {lots: REACTOR_PICKED_OVER, empty: 1.45},
  },
};
export const REACTOR_PROFILE: LootProfile = {id: 'reactor', label: 'Reactor', tables: REACTOR_TABLES, overrides: REACTOR_OVERRIDES};

/**
 * THE PER-LEVEL PROFILES. Both current levels use today's tables with NO overrides (the user likes the current rates). A new level
 * adds its entry here (Record<LevelId, …> makes that mandatory); a deeper level tunes through `overrides` (docs/loot-tables.md).
 */
export const PROFILES: Readonly<Record<LevelId, LootProfile>> = {
  subway: {id: 'subway', label: 'Subway', tables: BASE_TABLES, overrides: {}},
  office: {id: 'office', label: 'Office Space', tables: BASE_TABLES, overrides: {}},
  // Task track3-eaton-centre-20261031: wired by lane GEN with LevelId 'mall' (the profile itself is lane PROFILES' MALL_PROFILE).
  mall: MALL_PROFILE,
  // Task studio-skyways-level-20261106-054448-01 (primary): SKYWAYS — today's tables, no overrides (its shops / eateries / back-of-house
  // rooms use the station purposes; its edible ramen-restaurant food is that room's own finite purpose rows).
  skyways: {id: 'skyways', label: 'Skyways', tables: BASE_TABLES, overrides: {}},
  // Task reactor-build-20261101 (primary): THE REACTOR — the mall's tables (its per-storey loose floor program serves the tiers) with
  // the culminating level's pressure: ammo, medicine and batteries scarcer, materials a little rarer (docs/loot-tables.md overrides).
  reactor: REACTOR_PROFILE,
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

/**
 * (round 3, lane HIDEOUT) The rows of a hideout's gear piece (ANNEX_CACHE_GEAR): the level profile's gear pool (gearParams: the
 * level's gear weights with its overrides; ids the caller keeps to real gear items) plus the gas mask at ANNEX_CACHE_GEAR.gasMask
 * (scaled by an `itemWeight.gas_mask` override); rows with weight <= 0 dropped (a level tunes it to nothing with zero weights).
 */
export function annexCacheGearRows(profile: LootProfile): ItemRows {
  const rows: [string, number][] = Object.entries(gearParams(profile).weights).filter(([, w]) => w > 0);
  const mask = ANNEX_CACHE_GEAR.gasMask * (profile.overrides.itemWeight?.gas_mask ?? 1);
  if (mask > 0 && !rows.some(r => r[0] === 'gas_mask')) rows.push(['gas_mask', mask]);
  return rows;
}

/**
 * Task office-interactions-layout-20261030 (lane ROOF): the curated reward a holder with loot key `key` rolls under `profile`
 * (undefined: none). The tables' own object when no item / category weight override touches its rows; otherwise a copy with the
 * rows resolved (resolveRows). Keep / slot overrides never reach a reward (the documented exception).
 */
export function rewardTable(profile: LootProfile, key: string): RewardTable | undefined {
  const t = profile.tables.rewards?.[key];
  if (!t) return undefined;
  const picks = t.picks.map(p => { const items = resolveRows(profile, p.items); return items === p.items ? p : {...p, items}; });
  return picks.every((p, i) => p === t.picks[i]) ? t : {...t, picks};
}

/**
 * Task gas-mask-roof-feedback-20261030 (item 10): the curated find reward `key` under `profile` (undefined: none). The tables' own
 * object when no item / category weight override touches its rows; otherwise a copy with the rows resolved (resolveRows).
 */
export function rewardFind(profile: LootProfile, key: string): RewardFind | undefined {
  const t = profile.tables.rewardFinds?.[key];
  if (!t) return undefined;
  const items = resolveRows(profile, t.items);
  return items === t.items ? t : {...t, items};
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
  // Track 2 (lane CONTENT): the per-annex program (same shape as the Subway's)
  const A = t.floor.annex;
  if (A) {
    A.boxes.forEach((b, i) => { item(`tables.floor.annex.boxes[${i}]`, b.itemId, b.count); range(`tables.floor.annex.boxes[${i}].n`, b.n); });
    A.kept.forEach((b, i) => { item(`tables.floor.annex.kept[${i}]`, b.itemId, b.count); range(`tables.floor.annex.kept[${i}].n`, b.n); chance(`tables.floor.annex.kept[${i}].keep`, b.keep); });
    A.light.forEach((b, i) => { item(`tables.floor.annex.light[${i}]`, b.itemId, b.count); chance(`tables.floor.annex.light[${i}].chance`, b.chance); });
  }
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
  // Task track3-eaton-centre-20261031 (lane PROFILES): the mall's per-storey floor program
  const M = t.floor.mall;
  if (!M || typeof M !== 'object') bad('tables.floor.mall', 'missing');
  else {
    for (const v of ['pit', 'ring'] as const) {
      const S2 = M[v], path = `tables.floor.mall.${v}`;
      if (!S2) { bad(path, 'missing'); continue; }
      if (!Number.isInteger(S2.ammo.draws) || S2.ammo.draws < 0) bad(`${path}.ammo.draws`, 'not an integer >= 0');
      S2.ammo.boxes.forEach((b, i) => item(`${path}.ammo.boxes[${i}]`, b.itemId, b.count));
      if (S2.ammo.thresholds.length !== S2.ammo.boxes.length) bad(`${path}.ammo.thresholds`, 'one threshold per box');
      S2.ammo.thresholds.forEach((x, i) => { chance(`${path}.ammo.thresholds[${i}]`, x); if (i && x < S2.ammo.thresholds[i - 1]) bad(`${path}.ammo.thresholds`, 'thresholds must ascend'); });
      if (!Number.isInteger(S2.scarce.draws) || S2.scarce.draws < 0) bad(`${path}.scarce.draws`, 'not an integer >= 0');
      for (const k of ['med', 'medkit', 'battery', 'flare'] as const) chance(`${path}.scarce.${k}`, S2.scarce[k]);
      range(`${path}.salvage.n`, S2.salvage.n);
      rows(`${path}.salvage.items`, S2.salvage.items);
      S2.salvage.items.forEach(([id], i) => { if (!isMaterialItem(id)) bad(`${path}.salvage.items[${i}]`, `${id} is not a crafting material`); });
    }
    for (const k of ['gallery', 'shop', 'back', 'themed'] as const) weight(`tables.floor.mall.place.${k}`, M.place[k]);
    for (const th of M.place.themedFor) if (!(th in THEME_ECONOMY)) bad('tables.floor.mall.place.themedFor', `unknown loot theme ${th}`);
    if (!Number.isInteger(M.place.minCells) || M.place.minCells < 0) bad('tables.floor.mall.place.minCells', 'not an integer >= 0');
  }
  // lane PROFILES: salvage (crafting-material rows per purpose / theme; purpose ids are checked by tests/mall-profiles.test.ts)
  if (t.salvage !== undefined) {
    const sv = t.salvage;
    if (!sv || typeof sv !== 'object') bad('tables.salvage', 'not salvage tables');
    else {
      known('tables.salvage', sv, ['purposes', 'themes']);
      const rule = (path: string, r: SalvageRule) => {
        if (!r || typeof r !== 'object') { bad(path, 'not a salvage rule'); return; }
        known(path, r, ['rows', 'share']);
        rows(`${path}.rows`, r.rows);
        if (Array.isArray(r.rows)) r.rows.forEach((row, i) => { if (!isMaterialItem(row[0])) bad(`${path}.rows[${i}]`, `${String(row[0])} is not a crafting material`); });
        if (!(typeof r.share === 'number' && r.share > 0 && r.share < 1)) bad(`${path}.share`, `${String(r.share)} is not in (0, 1)`);
        if (Array.isArray(r.rows) && !r.rows.some(row => finiteNonNeg(row[1]) && row[1] > 0)) bad(`${path}.rows`, 'no row with weight > 0');
      };
      for (const [k, r] of Object.entries(sv.purposes ?? {})) rule(`tables.salvage.purposes.${k}`, r);
      for (const [k, r] of Object.entries(sv.themes ?? {})) { if (!(k in THEME_ECONOMY)) bad(`tables.salvage.themes.${k}`, 'unknown loot theme'); rule(`tables.salvage.themes.${k}`, r as SalvageRule); }
    }
  }
  // Task mall-playtest-revision-20261031 (lane SHOPS, U10): storage fill (holder kinds are checked by tests/mall-storage-loot.test.ts)
  for (const [k, f] of Object.entries(t.storageFill ?? {})) {
    const path = `tables.storageFill.${k}`;
    if (!f || typeof f !== 'object') { bad(path, 'not a storage fill'); continue; }
    known(path, f, ['chance', 'area', 'lots', 'cats', 'weights', 'fallback']);
    chance(`${path}.chance`, f.chance);
    if (!(typeof f.area === 'number' && f.area > 0)) bad(`${path}.area`, `${String(f.area)} is not > 0`);
    range(`${path}.lots`, f.lots);
    for (const c of f.cats ?? []) if (!isCat(c)) bad(`${path}.cats`, `unknown economy category ${c}`);
    // (lane PROFILES, mall revision) fallback categories are a subset of the fill's categories
    for (const c of f.fallback ?? []) if (!(f.cats ?? STORAGE_FILL_CATS).includes(c)) bad(`${path}.fallback`, `${c} is not one of the fill's categories`);
    mults(`${path}.weights`, f.weights, isCat, 'economy category');
  }
  weight('tables.gear.mean', t.gear.mean);
  if (!Number.isInteger(t.gear.cap) || t.gear.cap < 0) bad('tables.gear.cap', `${t.gear.cap} is not an integer >= 0`);
  mults('tables.gear.weights', t.gear.weights, k => k in GEAR_ITEMS, 'gear id');
  // Task mall-round3-20261031 (lane SHOPS, R6): rare-gear placement bias (purpose ids are checked by tests/mall-themed-loot.test.ts)
  if (t.gearPlace !== undefined) {
    const gp = t.gearPlace;
    if (!gp || typeof gp !== 'object') bad('tables.gearPlace', 'not a gear placement bias');
    else {
      known('tables.gearPlace', gp, ['purposes', 'items']);
      if (gp.purposes === undefined) bad('tables.gearPlace.purposes', 'missing');
      mults('tables.gearPlace.purposes', gp.purposes, k => k.length > 0, 'purpose id');
      if (gp.items !== undefined && (!gp.items || typeof gp.items !== 'object')) bad('tables.gearPlace.items', 'not a per-piece map');
      else for (const [id, m] of Object.entries(gp.items ?? {})) {
        if (!(id in GEAR_ITEMS)) bad(`tables.gearPlace.items.${id}`, 'unknown gear id');
        mults(`tables.gearPlace.items.${id}`, m ?? {}, k => k.length > 0, 'purpose id');
      }
    }
  }

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
  // --- lane ROOF (office-interactions-layout-20261030): curated rewards — a real loot holder, valid picks, at least one guaranteed
  for (const [k, rw] of Object.entries(t.rewards ?? {})) {
    const path = `tables.rewards.${k}`;
    if (!rw || typeof rw !== 'object' || !Array.isArray(rw.picks)) { bad(path, 'not a reward table'); continue; }
    if (!(rw.holder in HOLDER_SLOTS) || HOLDER_SLOTS[rw.holder] === 'fixture') bad(`${path}.holder`, `${String(rw.holder)} is not a loot holder kind`);
    rw.picks.forEach((q, i) => { rows(`${path}.picks[${i}].items`, q.items); range(`${path}.picks[${i}].lots`, q.lots); chance(`${path}.picks[${i}].empty`, q.empty); });
    if (!rw.picks.some(q => q.empty === 0 && isRange(q.lots) && q.lots[0] >= 1 && Array.isArray(q.items) && q.items.some((r: ItemRow) => finiteNonNeg(r[1]) && r[1] > 0))) {
      bad(path, 'no guaranteed pick (empty 0, lots lo >= 1, a row with weight > 0)');
    }
  }
  // --- task gas-mask-roof-feedback-20261030 (item 10): curated find rewards — valid rows, at least one placeable item
  for (const [k, rf] of Object.entries(t.rewardFinds ?? {})) {
    const path = `tables.rewardFinds.${k}`;
    if (!rf || typeof rf !== 'object' || !Array.isArray(rf.items)) { bad(path, 'not a find reward'); continue; }
    rows(`${path}.items`, rf.items);
    if (typeof rf.pairedAmmo !== 'boolean') bad(`${path}.pairedAmmo`, 'not a boolean');
    if (!rf.items.some((r: ItemRow) => finiteNonNeg(r[1]) && r[1] > 0)) bad(path, 'no item with weight > 0 (the find is guaranteed)');
  }
  return issues;
}
