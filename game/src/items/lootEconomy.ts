// Iteration 12 (LOOT lane): the SCARCE-RESOURCE ECONOMY. Pure data / logic (no three.js), unit-tested in Node.
//
// User (iteration 12): "currently the station is packed with resource. Reduce resource amount to about 20% of current level. On
// all resource, except ammo, the game is about shooting things after all!" and "resource placement makes more sense, try to make
// sure resources spawn in rooms that fit that resource. I.e. a security office has ammo, ect. This is not 100% a hard rule, there
// should still be random ammo and such".
//
// How a holder's contents are decided (items/loot.ts rollHolderLots, per holder, deterministic per station seed + holder index):
//  1. The holder's ORIGINAL table roll is made exactly as before (same RNG stream, same tables): every AMMO entry it rolls is
//     kept as rolled — ammo has its own unchanged roll, so fewer finds never mean less ammo.
//  2. Each original NON-AMMO entry survives with probability THEME_ECONOMY[theme].keep (~1 in 5; own RNG stream `:scarce`).
//     Everything else is gone: most holders are now empty ("searched — empty"), which is intended.
//  3. Each survivor is a FIND whose category follows the place's theme (gen/purposes.ts `theme`, else THEME_OF_TYPE; trash bins
//     are always 'public' = random):
//       - with probability `on` (0.75-0.8) an ON-THEME find: the rolled item itself when it already fits the theme (a pharmacy
//         shelf's bandage stays a bandage), else a category drawn from the theme's `weights` (a security cabinet's old cola
//         becomes a box of 9 mm / a flare / a torch battery; a maintenance shelf's old water becomes a battery or a flare);
//       - otherwise an OFF-THEME random find: a category from OFF_THEME_WEIGHTS that is NOT on-theme (food in a security office,
//         a bandage or a handful of rounds in a café, ...) — the "not 100 % a hard rule" part. Ammo is never excluded anywhere.
//     The item of a category comes from the holder's OWN rows when it has any (a store's stock still matches its sign), else
//     from GLOBAL_POOL. HOLDER_ALLOW keeps fixtures plausible (a drinks cooler only ever holds drinks, a first-aid cabinet
//     dressings, a gun locker no food); when nothing allowed fits, the rolled item stays. Off-theme ammo is a handful of rounds.
//     Measured over the 18-station corpus: ~16-18 % of all finds in themed rooms are off-theme.
//  4. Loose floor supplies (gen/stationDress.ts placeSpawns): ammo boxes unchanged; each old loose dressing / first-aid kit
//     survives with FLOOR_ECONOMY.medKeep; plus one torch battery (always) and sometimes a flare, dropped in service / security
//     rooms first (FLOOR_ECONOMY.themeWeight).
// Weapon finds (gen/weaponFinds.ts) are untouched. Contents are rolled once and never rerolled or replenished.
// The corpus numbers (baseline d632ce8 vs now) are in reference/tasks/atmosphere-light-survival-20261028/loot/economy.json.

import {purposeById, type LootTheme} from '../gen/purposes';
import {ITEMS} from './items';

export type {LootTheme};

/** Economy category of an item (null: weapons / anything that is not a consumable resource). */
export type EconCat = 'food' | 'drink' | 'med' | 'ammo' | 'battery' | 'flare';
export const ECON_CATS: readonly EconCat[] = ['food', 'drink', 'med', 'ammo', 'battery', 'flare'];
/** The light lane's item ids (items/items.ts): a consumable torch battery and the throwable flare. */
export const BATTERY_ID = 'battery';
export const FLARE_ID = 'flare';

const FOOD = new Set(['chocolate', 'chips', 'beans', 'noodles']);
const DRINK = new Set(['water', 'cola', 'juice']);
const MED = new Set(['bandage', 'medkit']);

export function econCat(itemId: string): EconCat | null {
  if (itemId.startsWith('ammo_')) return 'ammo';
  if (FOOD.has(itemId)) return 'food';
  if (DRINK.has(itemId)) return 'drink';
  if (MED.has(itemId)) return 'med';
  if (itemId === BATTERY_ID) return 'battery';
  if (itemId === FLARE_ID) return 'flare';
  return null;
}

/** Category offered at all (battery / flare only once the light lane's items exist in items/items.ts). */
export function catAvailable(c: EconCat): boolean {
  return c === 'battery' ? BATTERY_ID in ITEMS : c === 'flare' ? FLARE_ID in ITEMS : true;
}

// ---------------------------------------------------------------------------------------
// Themes

/** Theme of room types that have no purpose (public halls, generic store units). */
export const THEME_OF_TYPE: Readonly<Record<string, LootTheme>> = {
  'food-court': 'food', 'eatery': 'food', 'shop': 'food', 'stock-room': 'food', 'crew-room': 'food',
  'agent-office': 'security',
  'storage': 'service', 'utility': 'service', 'service-corridor': 'service', 'janitor-closet': 'service',
  'supply-closet': 'medical',
  'platform': 'public', 'passage': 'public', 'concourse': 'public', 'fare-hall': 'public', 'retail-arcade': 'public',
  'exit-stair': 'public', 'underpass': 'public', 'stair-core': 'public', 'washroom': 'public',
};

/** Loot theme of a holder's area key (purpose id when the area / prop has one, else its room type). */
export function lootTheme(areaKey: string): LootTheme {
  return purposeById(areaKey)?.theme ?? THEME_OF_TYPE[areaKey] ?? 'public';
}

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

/** Items of a category when the holder's own table has none (ammo: 9 mm first — the pistol is the starting gun). */
export const GLOBAL_POOL: Readonly<Record<EconCat, readonly (readonly [string, number])[]>> = {
  food: [['chocolate', 1.2], ['chips', 1.1], ['beans', 0.9], ['noodles', 1]],
  drink: [['water', 1.3], ['cola', 1.2], ['juice', 0.9]],
  med: [['bandage', 1], ['medkit', 0.35]],
  ammo: [['ammo_pistol', 1.3], ['ammo_rifle', 1], ['ammo_shells', 0.8]],
  battery: [[BATTERY_ID, 1]],
  flare: [[FLARE_ID, 1]],
};

/** Off-theme ammo is a handful of loose rounds, not a full box (keeps total ammo where it was). */
export const HANDFUL: Readonly<Record<string, readonly [number, number]>> = {ammo_pistol: [4, 7], ammo_rifle: [3, 5], ammo_shells: [2, 3]};

const FD: readonly EconCat[] = ['food', 'drink'];
/** Fixtures that only take certain categories (everything else — cabinets, crates, shelves, desks, lockers, bins — takes any). */
export const HOLDER_ALLOW: Readonly<Partial<Record<string, readonly EconCat[]>>> = {
  shopCooler: ['drink'], fridge: FD, chestFreezer: FD,
  vending: ['food', 'drink', 'battery'], snackRack: ['food', 'battery'], newspaperVendingBox: ['food', 'drink', 'battery'],
  shopDisplay: ['food'], hotdogCart: FD, grillLine: FD, espressoBar: FD, wokLine: FD, deliLine: FD, blenderBar: FD, busCart: FD,
  kitchenette: ['food', 'drink', 'med', 'battery'],
  medCabinet: ['med'], firstAidWallKit: ['med'], crashCart: ['med', 'battery'], wheeledStretcher: ['med'],
  gunLocker: ['ammo', 'med', 'flare', 'battery'],
  // trash: discarded snacks, a dressing, a few rounds, a battery — never a flare
  bin: ['food', 'drink', 'med', 'ammo', 'battery'], wheelieBin: ['food', 'drink', 'med', 'ammo', 'battery'],
};
/** Junk holders: whatever the room, their few finds are random (a bin in a security office is still a bin). */
export const RANDOM_HOLDERS: ReadonlySet<string> = new Set(['bin', 'wheelieBin']);

/** Theme a holder's finds follow: its area's, except junk holders (random, like a public hall). */
export function holderTheme(kind: string, areaKey: string): LootTheme {
  return RANDOM_HOLDERS.has(kind) ? 'public' : lootTheme(areaKey);
}

function allowedCats(kind: string): EconCat[] {
  return (HOLDER_ALLOW[kind] ?? ECON_CATS).filter(catAvailable);
}

type Row = readonly [string, number];
type Rnd = () => number;
interface Entry { itemId: string; count: number }
/** A holder entry after the economy: `roll` = the holder's original ammo roll (exempt), `find` = a scarce (re-themed) find. */
export interface Find extends Entry { source: 'roll' | 'find' }

function pickRow<T>(rows: readonly (readonly [T, number])[], r: Rnd): T {
  const total = rows.reduce((s, row) => s + row[1], 0);
  let x = r() * total;
  for (const row of rows) { x -= row[1]; if (x < 0) return row[0]; }
  return rows[rows.length - 1][0];
}

const range = (r: Rnd, [a, b]: readonly [number, number]) => a + Math.floor(r() * (b - a + 1));

export interface FindContext {
  /** Holder kind (items/loot.ts HolderKind). */
  kind: string;
  /** Purpose id / room type (the holder's loot key). */
  areaKey: string;
  /** The holder's own weighted item rows (its table). */
  rows: readonly Row[];
  /** Full-box count of an ammo item for this holder (items/loot.ts lotCount). */
  boxCount: (itemId: string, r: Rnd) => number;
}

/** Item of category `c`: from the holder's own rows of that category when it has any, else the global pool. */
function itemOf(c: EconCat, ctx: FindContext, r: Rnd, security: boolean): string {
  const own = ctx.rows.filter(([id, w]) => w > 0 && econCat(id) === c);
  // security / police: the service sidearm's 9 mm leads (the pistol is the starting gun)
  return pickRow(own.length && !(security && c === 'ammo') ? own : GLOBAL_POOL[c], r);
}

/**
 * The scarce finds of one holder from its original roll `raw` (step 1-3 above). `s`: the holder's own scarcity stream.
 * Returns the entries in roll order (ammo exactly as rolled; surviving / re-themed finds in place of their original entry).
 */
export function scarceFinds(raw: readonly Entry[], ctx: FindContext, s: Rnd): Find[] {
  const theme = holderTheme(ctx.kind, ctx.areaKey);
  const T = THEME_ECONOMY[theme];
  const allow = allowedCats(ctx.kind);
  const out: Find[] = [];
  for (const e of raw) {
    const c = econCat(e.itemId);
    if (c === 'ammo' || c === null) { out.push({itemId: e.itemId, count: e.count, source: 'roll'}); continue; }
    if (s() >= T.keep) continue;
    const keep: Find = {itemId: e.itemId, count: e.count, source: 'find'};
    const on = s() < T.on;
    let cat: EconCat | null = null;
    if (on) {
      if (T.cats.includes(c)) { out.push(keep); continue; }
      const opts = T.cats.filter(k => allow.includes(k)).map(k => [k, T.weights[k] ?? 0] as const).filter(o => o[1] > 0);
      if (opts.length) cat = pickRow(opts, s);
    } else {
      // Drawn over EVERY off-theme category, then dropped back to the rolled item when the fixture cannot hold it: a café vending
      // machine's rare off-theme find is not always a battery just because that is all a vending machine may take besides snacks.
      const opts = ECON_CATS.filter(k => !T.cats.includes(k) && catAvailable(k)).map(k => [k, OFF_THEME_WEIGHTS[k]] as const);
      if (opts.length) cat = pickRow(opts, s);
      if (cat && !allow.includes(cat)) cat = null;
    }
    if (!cat || cat === c) { out.push(keep); continue; }
    const itemId = itemOf(cat, ctx, s, theme === 'security');
    const count = cat !== 'ammo' ? 1 : on ? ctx.boxCount(itemId, s) : range(s, HANDFUL[itemId] ?? [3, 6]);
    out.push({itemId, count, source: 'find'});
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Loose floor supplies (gen/stationDress.ts placeSpawns)

export const FLOOR_ECONOMY = {
  /** Survival of each old loose dressing / first-aid kit (ammo boxes on the floor are unchanged). */
  medKeep: 0.2,
  /** Chance of one loose torch battery (always: every station has at least one) and of one loose flare per station. */
  batteryChance: 1,
  flareChance: 0.35,
  /** Area weight per theme for the loose battery / flare (service and security rooms first; never a food counter). */
  themeWeight: {service: 3, security: 2.2, tech: 1, personal: 1, medical: 0.4, food: 0, public: 0.35} as Readonly<Record<LootTheme, number>>,
};
