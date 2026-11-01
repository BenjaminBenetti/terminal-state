// Loot holders and their contents. Pure logic (no three.js) so it can be tested in Node.
//
// Holders: searchable containers (tall cabinet, low cupboard, crate — doors/lid animate) and
// open surfaces (shelf units, kiosk stalls, vending machines, tables). Each holder's contents are
// rolled ONCE from the station seed + holder index + room type, are finite and never rerolled.
// Every item is a visible "lot" placed on a real surface (items/lootLayout.ts) that the player
// takes individually by aiming at it (or all at once from the holder body). Nothing is
// transferred invisibly: whatever does not fit the inventory simply stays where it is.
//
// Iteration 12 (LOOT lane): SCARCE RESOURCES (items/lootEconomy.ts). The tables below still make each holder's original roll
// (same RNG stream as before); its ammo is kept exactly, ~1 in 5 of its other entries survive as finds re-themed by the room's
// purpose (security → ammo / flares / torch batteries, medical → dressings, food → food and drink, service → batteries and
// flares; ~15-20 % off-theme random finds). Most holders are now empty or nearly so — intended.

// Task loot-tables-20261030 (lane LOOT): the TABLES moved to items/lootTables.ts (per-logical-level LootProfile: rate tables +
// overrides; slot categories; named shared tables). Every roll function takes an optional trailing `profile` (default: the
// level-agnostic baseline = today's tables, no overrides — byte-identical draws, tests/loot-golden.test.ts); ContainerManager.build
// passes the section's logical level profile. holderTable() is the resolution step: which slot, which rows, empty chance, lots.

import {hashString, mulberry32} from '../core/rng';
import {PURPOSE_HOLDER_KINDS, type PurposeHolderKind} from '../gen/props';
import {purposeById, purposeLoot} from '../gen/purposes';
import {P7_HOLDER_KINDS, P7_HOLDER_META, type P7HolderKind} from '../gen/props07';
import {MALL_HOLDER_KINDS, type MallHolderKind} from '../gen/mall/kinds'; // Task track3-eaton-centre-20261031 (lane SHOPS): mall shop holders
import {effectText, itemDef} from './items';
import {ammoText} from './calibers'; // lane AMMO (knife-melee-20261030)
import type {Inventory} from './inventory';
import {packItems, type Placement, type Surface} from './lootLayout';
import {scarceFinds, type Find} from './lootEconomy';
import {withSalvage} from './lootEconomy'; // Task track3-eaton-centre-20261031 (lane PROFILES): mall salvage rows
import {
  BASELINE_PROFILE, LEGACY_CATS, catWeight, resolveRows, slotEmpty, slotLots, slotOf,
  type ItemRows, type LegacyCat, type LootProfile, type LootSpec, type LotRange, type OwnTable, type SlotCategory,
} from './lootTables';
import {rewardTable, type RewardTable} from './lootTables'; // Task office-interactions-layout-20261030 (lane ROOF): curated rewards
import {CONTAINER_THEMED} from './lootTables'; // Task office-interactions-layout-20261030 (lane OPEN): container-themed storage
import {HOLDER_ALLOW, STORAGE_FILL_CATS, STORAGE_FILL_FALLBACK, STORAGE_FILL_STOCK_THEMES, STORAGE_FILL_WEIGHTS, econCat, type EconCat} from './lootTables'; // Task mall-playtest-revision-20261031 (lane SHOPS, U10): storage fill
import {
  OPENABLE_CONTAINER_KINDS, OPENABLE_META, containerLoot, openableSpec, separateCompartmentLoot, type OpenableContainerKind,
} from '../world/openablesSpec';

/**
 * Iteration 08 (Lane I): searchable CONTAINERS now include the openable kinds of world/openablesSpec.ts (trash cans, wheelie
 * bins, newspaper boxes, staff lockers, filing cabinets, safes, chest freezers, wall first-aid / fire / defibrillator cabinets):
 * lids / doors / drawers that open per compartment (HolderState.parts).
 */
export type ContainerKind = 'cabinetTall' | 'cabinetLow' | 'crate' | OpenableContainerKind;
export const CONTAINER_KINDS: readonly ContainerKind[] = ['cabinetTall', 'cabinetLow', 'crate', ...OPENABLE_CONTAINER_KINDS];
export function isContainerKind(kind: string): kind is ContainerKind {
  return (CONTAINER_KINDS as readonly string[]).includes(kind);
}

/** Open loot surfaces placed by the layout lane (props that may not exist in every build). */
export type SurfaceKind = 'shelf' | 'stall' | 'vending' | 'table' | 'desk'
  // Iteration 04 storefront building blocks (gen/storefronts.ts): counter, display case, back counter, cooler.
  | 'shopCounter' | 'shopDisplay' | 'shopBackbar' | 'shopCooler'
  // Iteration 05 purpose holders (gen/props.ts PURPOSE_HOLDER_KINDS): store shelving, snack rack,
  // hot-dog cart, kitchen lines, staff kitchenette/fridge, gun locker, security desk, first-aid cabinet.
  | PurposeHolderKind
  // Iteration 07 (Lane P2): generated holders with measured surfaces (gen/props07.ts P7_HOLDER_KINDS).
  | P7HolderKind
  // Task track3-eaton-centre-20261031 (lane SHOPS): The Eaton's Center open shop holders (gen/mall/kinds.ts MALL_SURFACES).
  | MallHolderKind;
export const SURFACE_KINDS: readonly SurfaceKind[] = ['shelf', 'stall', 'vending', 'table', 'desk', 'shopCounter', 'shopDisplay', 'shopBackbar', 'shopCooler', ...PURPOSE_HOLDER_KINDS, ...P7_HOLDER_KINDS,
  ...MALL_HOLDER_KINDS];
export function isSurfaceKind(kind: string): kind is SurfaceKind {
  return (SURFACE_KINDS as readonly string[]).includes(kind);
}
export type HolderKind = ContainerKind | SurfaceKind;
export function isLootHolderKind(kind: string): kind is HolderKind {
  return isContainerKind(kind) || isSurfaceKind(kind);
}

export const HOLDER_LABEL: Record<HolderKind, string> = {
  cabinetTall: 'supply cabinet', cabinetLow: 'cupboard', crate: 'crate',
  shelf: 'shelf', stall: 'kiosk', vending: 'vending machine', table: 'table', desk: 'desk',
  shopCounter: 'counter', shopDisplay: 'display case', shopBackbar: 'back counter', shopCooler: 'drinks cooler',
  stockShelf: 'shelf', snackRack: 'snack rack', hotdogCart: 'hot-dog cart', grillLine: 'grill line', espressoBar: 'espresso bar',
  wokLine: 'wok station', deliLine: 'prep line', blenderBar: 'juice station', kitchenette: 'kitchenette', fridge: 'fridge',
  gunLocker: 'gun locker', monitorDesk: 'security desk', medCabinet: 'first-aid cabinet',
  ...P7_HOLDER_META.label,
  ...OPENABLE_META.label,
  // Task track3-eaton-centre-20261031 (lane SHOPS): mall shop holders
  glassCounter: 'display counter', merchTable: 'display table', wallBay: 'shelving bay', produceStand: 'produce stand', bookstoreBookcase: 'bookcase',
  retailGondola: 'gondola shelf', clothingWallUnit: 'clothing bay', checkoutLane: 'checkout', outdoorsPlankShelving: 'plank shelving', storageTote: 'storage tote',
  shoeWallDisplay: 'shoe wall', foodCourtTableSet: 'table',
  multideckOpenCooler: 'open cooler', cosmeticsWallUnit: 'cosmetics stand', // lane ASSETS batch 2 resume (12c)
};
/** Back-compat alias (iteration 02 name). */
export const CONTAINER_LABEL = HOLDER_LABEL;

export interface LootEntry { itemId: string; count: number }
/** One visible item (or ammo box) resting on a holder surface. */
export interface Lot extends LootEntry, Placement {
  id: number;
  /** Iteration 08 (Lane I): compartment (openable part index) the lot rests in; absent = an exposed surface. */
  part?: number;
}

export interface HolderState {
  /** Index among holders of the same group (containers / surfaces) in layout order. */
  index: number;
  kind: HolderKind;
  /** Room type of the holder's area (loot table key). */
  areaType: string;
  /** Containers: doors/lid open. Vending: pried open. Shelves/stalls/tables: always open. */
  open: boolean;
  /** Ever opened/pried (contents seen). A searched holder never rolls new loot. */
  searched: boolean;
  /** Items still there (finite). */
  lots: Lot[];
  /** Lots rolled at station start (QA/tests). */
  rolled: number;
  /** Iteration 08 (Lane I): openable compartments (world/openablesSpec.ts parts): open now / ever opened. Persist; never re-roll. */
  parts?: boolean[];
  seen?: boolean[];
}

// ---------------------------------------------------------------------------------------
// Resolution (tables: items/lootTables.ts)

type Row = readonly [itemId: string, weight: number];

/**
 * Task loot-tables-20261030 (lane LOOT): what a holder rolls from under a profile — its SLOT category, where the rows come from
 * ('own' openable table narrowed by the room's purpose / 'purpose' table for that holder kind / 'legacy' room-type tables /
 * 'fixture' = baked contents, no loot), the resolved empty chance, lot range and item rows (legacy: flattened category x pool
 * rows, what re-themed finds prefer). Baseline profile: the very same row arrays and numbers as the tables hold.
 */
export interface HolderTable {
  slot: SlotCategory | undefined;
  /** ... | 'reward' = a curated reward (lane ROOF, office-interactions-layout-20261030: lootTables REWARD_TABLES; exact, no scarcity cut). */
  source: 'own' | 'purpose' | 'legacy' | 'fixture' | 'reward';
  empty: number;
  lots: LotRange;
  rows: ItemRows;
  /** Playtest revision: an annex-local table (LootSpec.exact) — no level-wide scarcity cut (a level's slot scaling still applies). */
  exact?: boolean;
}

/**
 * Playtest revision: does a holder kind roll its ROOM PURPOSE's table (the loot key / area purpose decides)? False for the openable
 * containers with their own tables and the fixtures (holderTable below: `containerLoot(kind) !== undefined`): a loot key never
 * changes what a first-aid wall kit or an extinguisher cabinet holds.
 */
export function rollsPurposeTable(kind: string): boolean {
  return containerLoot(kind) === undefined;
}

export function holderTable(kind: HolderKind, areaType: string, profile: LootProfile = BASELINE_PROFILE): HolderTable {
  const T = profile.tables, slot = slotOf(kind);
  // Lane ROOF (office-interactions-layout-20261030): a holder whose loot key names a curated reward (the Office roof cache) rolls it.
  const reward = rewardOf(kind, areaType, profile);
  if (reward) return rewardHolderTable(slot, reward);
  // Iteration 08 (Lane I): new openable containers use their own tables whatever the room (a pharmacy bin is still a bin);
  // fixtures (fire / defibrillator cabinets) hold only what is baked into their model.
  const own = containerLoot(kind);
  if (own === null) return {slot, source: 'fixture', empty: 1, lots: [0, 0], rows: []};
  if (own !== undefined) {
    // Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): an EXACT purpose table that names this openable kind EXPLICITLY (the
    // survivor hideout's footlocker under the 'annex-cache' key) rolls instead of its own table — exactly, like the cache's other holders
    // (no `default` fallback: every other own-table container keeps its table in every room, as before)
    const ex = (purposeById(areaType)?.loot as Partial<Record<string, LootSpec>> | undefined)?.[kind];
    if (ex?.exact) return {...resolved(profile, slot, 'purpose', {items: ex.items, empty: ex.empty ?? 0, lots: ex.lots ?? [1, 1]}, kind, areaType), exact: true};
    return resolved(profile, slot, 'own', purposeRows(own, areaType, kind), kind, areaType);
  }
  // Iteration 05: a room/store PURPOSE (gen/purposes.ts) decides what its holders contain
  // (`areaType` is the purpose id when the area has one; plain room types use the legacy tables).
  const spec = purposeLoot(areaType, kind);
  if (spec?.exact) return {...resolved(profile, slot, 'purpose', {items: spec.items, empty: spec.empty ?? T.holderEmpty[kind], lots: spec.lots ?? T.holderLots[kind]}, kind, areaType), exact: true};
  if (spec) return resolved(profile, slot, 'purpose', {items: spec.items, empty: spec.empty ?? T.holderEmpty[kind], lots: spec.lots ?? T.holderLots[kind]}, kind, areaType);
  const [lo, hi] = T.holderLots[kind];
  // Stocked rooms get fuller shelves.
  const full = T.fullRooms.kinds.includes(kind) && T.fullRooms.rooms.has(areaType);
  return {slot, source: 'legacy', empty: slotEmpty(profile, slot, T.holderEmpty[kind]), lots: slotLots(profile, slot, full ? [lo, hi + T.fullRooms.extra] : T.holderLots[kind]), rows: legacyRows(kind, areaType, profile)};
}

/** The separate compartment roll of a desk-style holder (drawers / cupboards: their own table, slot 'container'); null: none. */
export function compartmentTable(kind: HolderKind, areaType: string, profile: LootProfile = BASELINE_PROFILE): HolderTable | null {
  const inside = separateCompartmentLoot(kind);
  return inside ? resolved(profile, slotOf(kind, true), 'own', purposeRows(inside, areaType, kind), kind, areaType) : null;
}

/** Task track3-eaton-centre-20261031 (lane PROFILES): + the level's salvage rows (lootEconomy withSalvage; same array when none). */
function resolved(profile: LootProfile, slot: SlotCategory | undefined, source: HolderTable['source'], t: OwnTable, kind: string, areaType: string): HolderTable {
  return {slot, source, empty: slotEmpty(profile, slot, t.empty), lots: slotLots(profile, slot, t.lots), rows: withSalvage(profile, kind, areaType, resolveRows(profile, t.items))};
}

// ---------------------------------------------------------------------------------------
// Task office-interactions-layout-20261030 (lane ROOF): CURATED REWARDS (lootTables REWARD_TABLES, docs/loot-tables.md "Roof
// reward"). A holder whose loot key (`areaType` = PropPlacement.purpose) names a reward for its kind — the Office roof cache —
// rolls that reward ONCE on its own seeded holder stream like any holder (finite; remembered by lot id), but EXACTLY: its picks in
// order, no scarcity cut / re-theme / limb conversion (all entries are `roll`s), and every rolled lot is placed (bounded re-packs).

/** Extra deterministic packing attempts for a reward whose lots did not all fit on the first pack (own `:repack<k>` streams). */
export const REWARD_REPACKS = 16;

function rewardOf(kind: HolderKind, areaType: string, profile: LootProfile): RewardTable | undefined {
  const t = rewardTable(profile, areaType);
  return t && t.holder === kind ? t : undefined;
}

/** A reward as a HolderTable (QA / tests): all picks' rows, lots = the summed pick ranges, empty = every pick empty. */
function rewardHolderTable(slot: SlotCategory | undefined, t: RewardTable): HolderTable {
  const lo = t.picks.reduce((s, p) => s + p.lots[0], 0), hi = t.picks.reduce((s, p) => s + p.lots[1], 0);
  return {slot, source: 'reward', empty: t.picks.reduce((e, p) => e * (p.lots[1] > 0 && p.items.length ? p.empty : 1), 1), lots: [lo, hi], rows: t.picks.flatMap(p => p.items)};
}

/** The reward's picks rolled in order on the holder stream (each an own-table roll: empty?, lots, items + stack sizes). */
function rollReward(r: () => number, kind: HolderKind, t: RewardTable, profile: LootProfile): LootEntry[] {
  return t.picks.flatMap(p => rollRows(r, kind, {slot: slotOf(kind), source: 'reward', empty: p.empty, lots: p.lots, rows: p.items}, profile));
}

/**
 * Packs a reward so that every lot is placed: the standard packer on the holder stream, then (only when something did not fit)
 * up to REWARD_REPACKS fresh packs on the holder's own repack streams; the first full pack wins, else the one placing the most
 * (the guaranteed picks come first, so they always find room in an empty holder).
 */
function packReward(seed: number, index: number, kind: HolderKind, ids: readonly string[], surfaces: readonly Surface[], r: () => number): (Placement | null)[] {
  let best = packItems(ids, surfaces, r, false);
  const n = (p: readonly (Placement | null)[]) => p.filter(Boolean).length;
  for (let k = 0; k < REWARD_REPACKS && n(best) < ids.length; k++) {
    const p = packItems(ids, surfaces, mulberry32(hashString(`loot:${kind}:${index}:repack${k}`, seed >>> 0)), false);
    if (n(p) > n(best)) best = p;
  }
  return best;
}

/** Legacy category weights of a holder in a plain room (room type x holder modifier; categories with weight > 0). */
function legacyCats(kind: HolderKind, areaType: string, profile: LootProfile): (readonly [LegacyCat, number])[] {
  const T = profile.tables;
  const room = T.areaWeights[areaType] ?? T.areaWeights.default;
  const mod = T.holderMod[kind];
  return LEGACY_CATS.map((c, i) => [c, catWeight(profile, c, room[i] * mod[i])] as const).filter(([, w]) => w > 0);
}

/** Items of a legacy category for a holder (vending machines sell snacks, not tins of beans). */
function legacyPool(kind: HolderKind, cat: LegacyCat, profile: LootProfile): ItemRows {
  return resolveRows(profile, kind === 'vending' && cat === 'food' ? profile.tables.vendingFood : profile.tables.pool[cat]);
}

/** The legacy tables flattened into weighted item rows (what a plain-room holder's re-themed finds prefer). */
function legacyRows(kind: HolderKind, areaType: string, profile: LootProfile): Row[] {
  const rows: Row[] = [];
  for (const [c, w] of legacyCats(kind, areaType, profile)) {
    const pool = legacyPool(kind, c, profile);
    const total = pool.reduce((s, x) => s + x[1], 0);
    for (const [id, x] of pool) rows.push([id, w * x / total]);
  }
  return rows;
}

function pick<T>(rows: readonly (readonly [T, number])[], r: () => number): T {
  const total = rows.reduce((s, row) => s + row[1], 0);
  let x = r() * total;
  for (const row of rows) { x -= row[1]; if (x < 0) return row[0]; }
  return rows[rows.length - 1][0];
}

/** Stack size of a rolled item: lootTables BOX_COUNT (big boxes in crates / gun lockers); unlisted items are single and draw nothing. */
function lotCount(itemId: string, kind: HolderKind, r: () => number, profile: LootProfile): number {
  const box = profile.tables.boxCount[itemId];
  if (!box) return 1;
  const [a, b] = profile.tables.bigBoxHolders.has(kind) ? box.big : box.small;
  return a + Math.floor(r() * (b - a + 1));
}

function holderRng(seed: number, index: number, kind: HolderKind): () => number {
  return mulberry32(hashString(`loot:${kind}:${index}`, seed >>> 0));
}

/** Iteration 12 (LOOT lane): a holder's own scarcity stream (items/lootEconomy.ts), separate from its table roll. */
function scarceRng(seed: number, index: number, kind: HolderKind, part = ''): () => number {
  return mulberry32(hashString(`loot:${kind}:${index}${part}:scarce`, seed >>> 0));
}

/** Iteration 12 (LOOT lane): the original roll thinned / re-themed into scarce finds (ammo exactly as rolled). */
function scarce(raw: LootEntry[], s: () => number, kind: HolderKind, areaType: string, rows: readonly Row[], profile: LootProfile): LootEntry[] {
  return scarceFinds(raw, findContext(kind, areaType, rows, profile), s).map(f => ({itemId: f.itemId, count: f.count}));
}

function findContext(kind: HolderKind, areaType: string, rows: readonly Row[], profile: LootProfile) {
  return {kind, areaKey: areaType, rows, boxCount: (id: string, r: () => number) => lotCount(id, kind, r, profile), profile};
}

/** Iteration 12 (LOOT lane, QA / tests): the holder's ORIGINAL table roll (the pre-scarcity contents; its ammo is what survives). */
export function rollTableItems(seed: number, index: number, kind: HolderKind, areaType = 'default', profile: LootProfile = BASELINE_PROFILE): LootEntry[] {
  return rollItems(holderRng(seed, index, kind), kind, holderTable(kind, areaType, profile), areaType, profile);
}

/**
 * Iteration 12 (LOOT lane, QA / tests): the holder's contents before placement, each tagged `roll` (its original, exempt ammo
 * roll) or `find` (a scarce, re-themed find) — the same entries rollLootItems returns. Desk-style compartments included.
 */
export function holderFinds(seed: number, index: number, kind: HolderKind, areaType: string, withCompartments = false, profile: LootProfile = BASELINE_PROFILE): Find[] {
  const t = holderTable(kind, areaType, profile);
  // lane ROOF: a curated reward is exact (every entry its own roll, nothing cut)
  if (t.source === 'reward') return rollItems(holderRng(seed, index, kind), kind, t, areaType, profile).map(e => ({...e, source: 'roll' as const}));
  const out = t.exact ? rollItems(holderRng(seed, index, kind), kind, t, areaType, profile).map(e => ({...e, source: 'roll' as const}))
    : scarceFinds(rollItems(holderRng(seed, index, kind), kind, t, areaType, profile), findContext(kind, areaType, t.rows, profile), scarceRng(seed, index, kind));
  const inside = withCompartments ? compartmentTable(kind, areaType, profile) : null;
  if (inside) {
    out.push(...scarceFinds(rollRows(mulberry32(hashString(`loot:${kind}:${index}:inside`, seed >>> 0)), kind, inside, profile), findContext(kind, areaType, inside.rows, profile), scarceRng(seed, index, kind, ':inside')));
  }
  return out;
}

/**
 * Iteration 08 (Lane I): an openable's own table narrowed to what its room / store purpose stocks (a pharmacy trash can holds
 * pharmacy things, a newsstand's its snacks) — or the purpose's own rows when nothing overlaps. Plain halls keep the table.
 */
function purposeRows(own: OwnTable, areaType: string, kind: HolderKind): OwnTable {
  // Task office-interactions-layout-20261030 (lane OPEN): container-themed storage keeps its own rows in any room (lootTables CONTAINER_THEMED)
  if (CONTAINER_THEMED.has(kind)) return own;
  const spec = purposeLoot(areaType, kind);
  if (!spec || !spec.items.length) return own;
  const allowed = new Set(spec.items.map(r => r[0]));
  const rows = own.items.filter(r => allowed.has(r[0]));
  return {...own, items: rows.length ? rows : spec.items};
}

/**
 * One table roll (own / purpose tables): empty?, lot count, then per lot an item (+ its stack size). An empty row list is no loot
 * (nothing drawn). Iteration 08 (Lane I): own tables (junk-tier bins, office drawers, lockers, ...) are finite, small, never
 * ammo-heavy.
 */
function rollRows(r: () => number, kind: HolderKind, t: HolderTable, profile: LootProfile): LootEntry[] {
  if (!t.rows.length || r() < t.empty) return [];
  const [lo, hi] = t.lots;
  const n = lo + Math.floor(r() * (hi - lo + 1));
  const out: LootEntry[] = [];
  for (let i = 0; i < n; i++) {
    const itemId = pick(t.rows, r);
    out.push({itemId, count: lotCount(itemId, kind, r, profile)});
  }
  return out;
}

function rollItems(r: () => number, kind: HolderKind, t: HolderTable, areaType: string, profile: LootProfile): LootEntry[] {
  if (t.source === 'fixture') return [];
  if (t.source === 'reward') { const rw = rewardOf(kind, areaType, profile); return rw ? rollReward(r, kind, rw, profile) : []; } // lane ROOF
  if (t.source !== 'legacy') return rollRows(r, kind, t, profile);
  // Legacy room-type tables: a category per lot (room x holder weights), then an item of it.
  if (r() < t.empty) return [];
  const [lo, hi] = t.lots;
  const n = lo + Math.floor(r() * (hi - lo + 1));
  const catRows = legacyCats(kind, areaType, profile);
  if (!catRows.length) return [];
  const out: LootEntry[] = [];
  for (let i = 0; i < n; i++) {
    const cat = pick(catRows, r);
    const rows = legacyPool(kind, cat, profile);
    if (!rows.length) continue;
    const itemId = pick(rows, r);
    out.push({itemId, count: lotCount(itemId, kind, r, profile)});
  }
  return out;
}

/**
 * Deterministic contents (no placement) of holder `index`; same seed → same items. Iteration 12 (LOOT lane): the scarce finds of
 * the original roll (items/lootEconomy.ts) — ammo as rolled, ~1 in 5 other entries, re-themed by the room's purpose.
 */
export function rollLootItems(seed: number, index: number, kind: HolderKind, areaType = 'default', profile: LootProfile = BASELINE_PROFILE): LootEntry[] {
  const t = holderTable(kind, areaType, profile);
  if (t.source === 'reward') return rollItems(holderRng(seed, index, kind), kind, t, areaType, profile); // lane ROOF: exact, no scarcity cut
  // (round 2, lane CACHE: an annex-local exact table too — as holderFinds / rollHolderLots roll it; this QA helper used to cut it)
  if (t.exact) return rollItems(holderRng(seed, index, kind), kind, t, areaType, profile);
  return scarce(rollItems(holderRng(seed, index, kind), kind, t, areaType, profile), scarceRng(seed, index, kind), kind, areaType, t.rows, profile);
}

/** Deterministic contents placed on the holder's surfaces (items that fit nowhere are dropped). */
export function rollHolderLots(seed: number, index: number, kind: HolderKind, areaType: string, surfaces: readonly Surface[], profile: LootProfile = BASELINE_PROFILE): Lot[] {
  const t = holderTable(kind, areaType, profile);
  // Lane ROOF (office-interactions-layout-20261030): a curated reward — rolled exactly, every lot placed (packReward).
  if (t.source === 'reward') {
    const r = holderRng(seed, index, kind);
    const items = rollItems(r, kind, t, areaType, profile);
    const placed = packReward(seed, index, kind, items.map(e => e.itemId), surfaces, r);
    const lots: Lot[] = [];
    placed.forEach((p, i) => { if (p) lots.push(tagPart({id: index * 1000 + i, ...items[i], ...p}, surfaces)); });
    return lots;
  }
  // Iteration 08 (Lane I): a surface holder that gained compartments (desk drawers) keeps its exposed surfaces' roll exactly and
  // rolls the compartments separately (own stream + table) — closed drawers are not where the old loot went.
  const inside = compartmentTable(kind, areaType, profile);
  if (inside && surfaces.some(s => s.part !== undefined)) {
    const exposed = surfaces.map((s, i) => ({s, i})).filter(e => e.s.part === undefined);
    const parts = surfaces.map((s, i) => ({s, i})).filter(e => e.s.part !== undefined);
    // Iteration 12 (LOOT lane): both rolls thinned by their own scarcity streams.
    const s1 = scarceRng(seed, index, kind), s2 = scarceRng(seed, index, kind, ':inside');
    const a = rollOn(holderRng(seed, index, kind), index * 1000, r => (t.exact ? rollItems(r, kind, t, areaType, profile) : scarce(rollItems(r, kind, t, areaType, profile), s1, kind, areaType, t.rows, profile)), exposed);
    const r2 = mulberry32(hashString(`loot:${kind}:${index}:inside`, seed >>> 0));
    const b = rollOn(r2, index * 1000 + 500, r => scarce(rollRows(r, kind, inside, profile), s2, kind, areaType, inside.rows, profile), parts);
    const ab = [...a, ...b].map(l => tagPart(l, surfaces));
    return t.exact ? ab : storageFill(seed, index, kind, areaType, surfaces, ab, inside.rows, profile); // (lane SHOPS, U10: none unless the profile has one)
  }
  const r = holderRng(seed, index, kind);
  const raw = rollItems(r, kind, t, areaType, profile);
  const items = t.exact ? raw : scarce(raw, scarceRng(seed, index, kind), kind, areaType, t.rows, profile);
  const placed = packItems(items.map(e => e.itemId), surfaces, r, kind === 'crate' && r() < 0.5);
  const lots: Lot[] = [];
  placed.forEach((p, i) => { if (p) lots.push(tagPart({id: index * 1000 + i, ...items[i], ...p}, surfaces)); });
  // (playtest revision: an exact annex table is the annex's whole budget — the mall's storage fill never tops it up, so a searched-clean
  // holder stays clean and the annex economy is the same on every level)
  return t.exact ? lots : storageFill(seed, index, kind, areaType, surfaces, lots, t.rows, profile); // (lane SHOPS, U10: none unless the profile has one)
}

/** Lot id offset of storage-fill lots (index * 1000 + FILL_ID_BASE + (compartment + 1) * 3 + k: clear of the roll's own ids). */
export const FILL_ID_BASE = 600;
/**
 * Task mall-playtest-revision-20261031 (lane PROFILES): running tallies of the storage fill (census / QA only — a generation-time counter,
 * never read by the game): empty compartments considered, compartments that drew lots, items drawn, items packed (drawn − packed = the
 * fill's fit failures).
 */
export const STORAGE_FILL_STATS = {compartments: 0, rolled: 0, entries: 0, placed: 0};

/**
 * Task mall-playtest-revision-20261031 (lane SHOPS, U10): the profile's STORAGE FILL (lootTables StorageFill / LootTables.storageFill,
 * the mall only — absent elsewhere, so this returns `lots` untouched and no stream is drawn). Every compartment the holder's own roll
 * left empty (openable part; a one-door / one-lid holder without parts = one compartment; exposed tops / shelves never) rolls once on
 * `loot:<kind>:<index>:fill<part>`: chance x min(1, its loot area / `area`), then U{lots} items from the holder's resolved `rows` within
 * the fill's categories and HOLDER_ALLOW, re-weighted by category (stack sizes as any roll of this holder kind), packed on that
 * compartment's surfaces only (lane PROFILES, mall revision: drawn only among the pool items that fit that compartment alone). (Lane PROFILES, mall revision: the fill's `fallback` categories — snacks / drinks by default — join the
 * pool only when it holds no other category — except in a place of a STORAGE_FILL_STOCK_THEMES theme (food), where they are its stock.)
 */
function storageFill(seed: number, index: number, kind: HolderKind, areaType: string, surfaces: readonly Surface[], lots: Lot[], rows: readonly Row[], profile: LootProfile): Lot[] {
  const f = profile.tables.storageFill?.[kind];
  if (!f || !rows.length) return lots;
  const cats = f.cats ?? STORAGE_FILL_CATS, allow = HOLDER_ALLOW[kind];
  const weights: Readonly<Partial<Record<EconCat, number>>> = f.weights ?? (f.cats ? {} : STORAGE_FILL_WEIGHTS);
  // (lane PROFILES, mall revision) snacks / drinks only where nothing else fits — except in a food place, where they ARE its stock
  const fb = f.fallback ?? (f.cats ? [] : STORAGE_FILL_FALLBACK);
  const fallback = fb.length && STORAGE_FILL_STOCK_THEMES.includes(purposeById(areaType)?.theme ?? 'public') ? [] : fb;
  let pool: Row[] = [];
  for (const [id, w] of rows) {
    const c = econCat(id);
    if (c === null || !cats.includes(c) || (allow && !allow.includes(c))) continue;
    const ww = w * (weights[c] ?? 1);
    if (ww > 0) pool.push([id, ww]);
  }
  if (fallback.length && pool.some(([id]) => !fallback.includes(econCat(id)!))) pool = pool.filter(([id]) => !fallback.includes(econCat(id)!));
  if (!pool.length) return lots;
  // compartment -> its surface indices (a part index; -1 = the whole holder behind its one door / lid)
  const single = !openableSpec(kind) && isContainerKind(kind);
  const comps = new Map<number, number[]>();
  surfaces.forEach((s, i) => {
    const c = s.part ?? (single ? -1 : undefined);
    if (c === undefined) return;
    const l = comps.get(c);
    if (l) l.push(i); else comps.set(c, [i]);
  });
  const full = new Set(lots.map(l => l.part ?? (single ? -1 : -2)));
  const out = lots.slice();
  for (const [c, idx] of [...comps].sort((a, b) => a[0] - b[0])) {
    if (full.has(c)) continue;
    STORAGE_FILL_STATS.compartments++;
    const area = idx.reduce((a, i) => a + Math.max(0, surfaces[i].x1 - surfaces[i].x0) * Math.max(0, surfaces[i].z1 - surfaces[i].z0), 0);
    const r = mulberry32(hashString(`loot:${kind}:${index}:fill${c}`, seed >>> 0));
    if (r() >= f.chance * Math.min(1, area / f.area)) continue;
    // (lane PROFILES, mall revision) draw only what fits this compartment on its own (a 5 cm tool-chest drawer takes a board of parts,
    // never a bracket of scrap): no compartment rolls an item it must then drop. A pure fit test (no stream draw).
    const own = idx.map(i => surfaces[i]);
    const fits = pool.filter(([id]) => packItems([id], own, () => 0.5, false)[0]);
    if (!fits.length) continue;
    const n = f.lots[0] + Math.floor(r() * (f.lots[1] - f.lots[0] + 1));
    STORAGE_FILL_STATS.rolled++;
    STORAGE_FILL_STATS.entries += n;
    const items: LootEntry[] = [];
    for (let k = 0; k < n; k++) { const itemId = pick(fits, r); items.push({itemId, count: lotCount(itemId, kind, r, profile)}); }
    const placed = packItems(items.map(e => e.itemId), own, r, false);
    placed.forEach((p, k) => { if (p) { STORAGE_FILL_STATS.placed++; out.push(tagPart({id: index * 1000 + FILL_ID_BASE + (c + 1) * 3 + k, ...items[k], ...p, surface: idx[p.surface]}, surfaces)); } });
  }
  return out;
}

function tagPart(l: Lot, surfaces: readonly Surface[]): Lot {
  const part = surfaces[l.surface]?.part;
  return part === undefined ? l : {...l, part};
}

/** Rolls `roll` and packs it onto a subset of the holder's surfaces (placements keep FULL-list surface indices). */
function rollOn(r: () => number, idBase: number, roll: (r: () => number) => LootEntry[], subset: {s: Surface; i: number}[]): Lot[] {
  const items = roll(r);
  if (!subset.length) return [];
  const placed = packItems(items.map(e => e.itemId), subset.map(e => e.s), r, false);
  const lots: Lot[] = [];
  placed.forEach((p, i) => { if (p) lots.push({id: idBase + i, ...items[i], ...p, surface: subset[p.surface].i}); });
  return lots;
}

/** A holder's runtime state: its lots rolled ONCE (finite; never re-rolled) under the level's loot `profile`, or the given `lots`. */
export function createHolderState(seed: number, index: number, kind: HolderKind, areaType: string, surfaces: readonly Surface[], lots?: Lot[], profile: LootProfile = BASELINE_PROFILE): HolderState {
  const list = (lots ?? rollHolderLots(seed, index, kind, areaType, surfaces, profile)).map(l => ({...l}));
  const alwaysOpen = isSurfaceKind(kind) && kind !== 'vending';
  const st: HolderState = {index, kind, areaType, open: alwaysOpen, searched: alwaysOpen, lots: list, rolled: list.length};
  const spec = openableSpec(kind);
  if (spec) { st.parts = spec.parts.map(() => false); st.seen = spec.parts.map(() => false); }
  return st;
}

// ---------------------------------------------------------------------------------------
// Taking

export interface TransferResult {
  taken: LootEntry[];
  remaining: LootEntry[];
  /** What was attempted but did not fit (stays in place). */
  blocked: LootEntry[];
  /** True when this was the holder's first search (kept for the iteration-02 event shape). */
  firstSearch: boolean;
}

/** Aggregates lots by item: [{itemId, count}] in first-seen order. */
export function lotEntries(lots: readonly LootEntry[]): LootEntry[] {
  const out: LootEntry[] = [];
  for (const l of lots) {
    const e = out.find(x => x.itemId === l.itemId);
    if (e) e.count += l.count; else out.push({itemId: l.itemId, count: l.count});
  }
  return out;
}

export function remainingCount(s: HolderState): number {
  return s.lots.reduce((n, l) => n + l.count, 0);
}

/** Moves as much of a lot as fits; returns how many went in. */
function transferLot(l: Lot, inv: Inventory): number {
  const max = itemDef(l.itemId).stackMax;
  let got = 0;
  while (l.count > 0) {
    const n = Math.min(l.count, max);
    const notFit = inv.add(inv.makeStack(l.itemId, n));
    got += n - notFit;
    l.count -= n - notFit;
    if (notFit > 0) break;
  }
  return got;
}

function finish(s: HolderState, taken: LootEntry[], tried: readonly Lot[], firstSearch: boolean): TransferResult {
  const blocked = lotEntries(tried.filter(l => l.count > 0));
  s.lots = s.lots.filter(l => l.count > 0);
  return {taken: lotEntries(taken), remaining: lotEntries(s.lots), blocked, firstSearch};
}

/** Takes one visible lot (partially if the inventory is nearly full). Never adds loot. */
export function takeLot(s: HolderState, lotId: number, inv: Inventory): TransferResult {
  const firstSearch = !s.searched;
  s.searched = true;
  const l = s.lots.find(x => x.id === lotId);
  const taken: LootEntry[] = [];
  if (l) { const got = transferLot(l, inv); if (got) taken.push({itemId: l.itemId, count: got}); }
  return finish(s, taken, l ? [l] : [], firstSearch);
}

/** Takes everything that fits; the rest stays visible in place. Never adds loot. */
export function takeAll(s: HolderState, inv: Inventory): TransferResult {
  const firstSearch = !s.searched;
  s.searched = true;
  const taken: LootEntry[] = [];
  for (const l of s.lots) { const got = transferLot(l, inv); if (got) taken.push({itemId: l.itemId, count: got}); }
  return finish(s, taken, s.lots, firstSearch);
}

/** Iteration 08 (Lane I): takes everything that fits from the given lots only (one open drawer / locker). Never adds loot. */
export function takeLots(s: HolderState, ids: readonly number[], inv: Inventory): TransferResult {
  const firstSearch = !s.searched;
  s.searched = true;
  const taken: LootEntry[] = [];
  const tried = s.lots.filter(l => ids.includes(l.id));
  for (const l of tried) { const got = transferLot(l, inv); if (got) taken.push({itemId: l.itemId, count: got}); }
  return finish(s, taken, tried, firstSearch);
}

export type HolderAction = 'open' | 'pry' | 'take' | 'close' | 'none';

/** What [E] on the holder body does next. */
export function nextHolderAction(s: HolderState): HolderAction {
  if (isContainerKind(s.kind)) return !s.open ? 'open' : s.lots.length ? 'take' : 'close';
  if (s.kind === 'vending' && !s.open) return 'pry';
  return s.lots.length ? 'take' : 'none';
}

// ---------------------------------------------------------------------------------------
// Iteration 08 (Lane I): openable compartments (world/openablesSpec.ts parts: lid / door / drawer / pane)

export type PartAction = 'open' | 'take' | 'close';

/** What [E] on compartment `part` does: open it, take what is in it, or close it again. */
export function partAction(s: HolderState, part: number): PartAction {
  if (!s.parts?.[part]) return 'open';
  return s.lots.some(l => l.part === part) ? 'take' : 'close';
}

export interface PartInfo {
  /** HUD name of the part ("trash can", "top drawer", "left locker"). */
  name: string;
  /** Holder label ("filing cabinet"). */
  label: string;
  /** Has a loot table (fixtures with baked contents do not). */
  loot: boolean;
  /** Fixture contents text when opened without loot. */
  contents?: string;
  /** Glass door: its lots are visible while closed. */
  glass?: boolean;
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const lotsIn = (s: HolderState, part: number) => s.lots.filter(l => l.part === part);

/** HUD prompt for a compartment (`key` = show the [E] key cap). */
export function partPrompt(s: HolderState, part: number, info: PartInfo, o: {roomForAny: boolean}): {key: boolean; text: string} {
  const n = lotsIn(s, part).length;
  const seen = !!s.seen?.[part];
  const room = o.roomForAny ? '' : ' — no room (Tab: inventory)';
  switch (partAction(s, part)) {
    case 'open':
      if (info.glass && n) return {key: true, text: `Open ${info.name} (${n} item${n === 1 ? '' : 's'} inside)`};
      if (!seen || !info.loot) return {key: true, text: `Open ${info.name}`};
      return {key: true, text: n ? `Open ${info.name} (${n} item${n === 1 ? '' : 's'} left inside)` : `Open ${info.name} (searched — empty)`};
    case 'take': return {key: true, text: `Take all (${n})${room} · or aim at an item`};
    default: return {key: true, text: info.loot ? `Close ${info.name} — empty` : `Close ${info.name}`};
  }
}

/**
 * Toast when a compartment is first opened: what is visibly inside, its fixture contents, or a clear "empty". `also` (task
 * mall-playtest-revision-20261031, lane SHOPS U10): partner compartments that opened with it (openablesSpec PartSpec.opensWith).
 */
export function partOpenMessage(s: HolderState, part: number, info: PartInfo, also: readonly number[] = []): {text: string; warn: boolean} {
  const lots = [...lotsIn(s, part), ...also.flatMap(j => lotsIn(s, j))];
  if (lots.length) return {text: `Inside: ${short(lotEntries(lots), 4)}`, warn: false};
  if (info.contents) return {text: `${cap(info.name)}: ${info.contents}`, warn: false};
  return {text: `${cap(info.name)}: empty`, warn: false};
}

// ---------------------------------------------------------------------------------------
// Text

/** "12 5.56mm rounds, 3 12-gauge shells, 9 9mm rounds, bandage, 2 × Water" (lane AMMO: ammo by caliber) */
export function describeLoot(entries: readonly LootEntry[]): string {
  return entries.map(({itemId, count: n}) => {
    const ammo = ammoText(itemId, n);
    if (ammo) return ammo;
    switch (itemId) {
      case 'bandage': return n === 1 ? 'bandage' : `${n} bandages`;
      case 'medkit': return n === 1 ? 'first-aid kit' : `${n} first-aid kits`;
      default: { const d = itemDef(itemId); return n === 1 ? d.short : `${n} × ${d.short}`; }
    }
  }).join(', ');
}

function short(entries: readonly LootEntry[], max = 3): string {
  const text = describeLoot(entries.slice(0, max));
  return entries.length > max ? `${text} …` : text;
}

/** HUD prompt for the holder body (`key` = show the [E] key cap). */
export function holderPrompt(s: HolderState, o: {roomForAny: boolean; prying?: boolean}): {key: boolean; text: string} {
  const label = HOLDER_LABEL[s.kind];
  const n = s.lots.length;
  const room = o.roomForAny ? '' : ' — no room (Tab: inventory)';
  if (o.prying) return {key: false, text: `Prying open the ${label}…`};
  switch (nextHolderAction(s)) {
    case 'open':
      if (!s.searched) return {key: true, text: `Open ${label}`};
      return {key: true, text: n ? `Open ${label} (${n} item${n === 1 ? '' : 's'} left inside)` : `Open ${label} (searched — empty)`};
    case 'pry': return {key: true, text: `Pry open ${label}`};
    case 'take': return {key: true, text: `Take all (${n})${room} · or aim at an item`};
    case 'close': return {key: true, text: `Close ${label} — empty`};
    default: return {key: false, text: s.kind === 'vending' ? 'Vending machine — empty' : `${label[0].toUpperCase()}${label.slice(1)} — nothing left`};
  }
}

/** HUD prompt for an aimed item. */
export function lotPrompt(l: LootEntry, roomFor: boolean): {key: boolean; text: string} {
  const d = itemDef(l.itemId);
  // lane RACK (office-props-physics-scale-20261030): a lot of several crafting materials names its count ("2 × Electrical parts")
  const what = d.kind === 'ammo' ? describeLoot([l]) : l.count > 1 ? `${l.count} × ${d.name}` : d.name;
  const fx = effectText(d);
  return {key: true, text: `Take ${what}${fx ? ` · ${fx}` : ''}${roomFor ? '' : ' — no room'}`};
}

/** Toast when a holder is first opened/pried: what is visibly inside (or a clear "empty"). */
export function openMessage(s: HolderState): {text: string; warn: boolean} {
  const label = HOLDER_LABEL[s.kind];
  const cap = label[0].toUpperCase() + label.slice(1);
  if (!s.lots.length) return {text: s.kind === 'vending' ? 'Pried open — the machine is empty' : `${cap}: empty`, warn: false};
  const lead = s.kind === 'vending' ? `The front gives way — ${s.lots.length} item${s.lots.length === 1 ? '' : 's'} spill out` : `Inside: ${short(lotEntries(s.lots), 4)}`;
  return {text: lead, warn: false};
}

/** Toast after taking. */
export function transferMessage(s: HolderState, r: TransferResult): {text: string; warn: boolean} {
  const label = HOLDER_LABEL[s.kind];
  if (r.taken.length) {
    return r.blocked.length
      ? {text: `Took ${describeLoot(r.taken)} — no room for ${short(r.blocked)}`, warn: true}
      : {text: `Took ${describeLoot(r.taken)}`, warn: false};
  }
  if (r.blocked.length) return {text: `No room in inventory — ${short(r.blocked)} left in the ${label}`, warn: true};
  return {text: `Nothing left in the ${label}`, warn: false};
}
