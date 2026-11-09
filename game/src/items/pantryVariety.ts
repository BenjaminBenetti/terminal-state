// Task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): FOOD VARIETY by FAMILY SUBSTITUTION at realization. User intent:
// "more VARIETY of collectible food and drinks across the game, less repetition like 30 % chocolate bars" — without adding food.
//
// What it does: when a loot lot or a generated floor pickup has rolled one of the OLD foods / drinks (chocolate, chips, beans, noodles,
// cola, juice, water — bread and the Skyways ramen food stay as they are), a seeded hash of its STABLE identity (station seed + holder
// kind / index + lot id; or the layout pickup index) picks a member of the same FAMILY (items/pantryFood.ts), weighted by context: the
// logical level's palette (which pantry items a level stocks: rice crackers in Skyways / Market / Mall / Office shops, field rations and
// ration bricks in the Subway / Office / Reactor / Market, ...), the holder's loot theme and slot (rations in security / service rooms and
// lockers, milk and pudding in fridges, iced coffee in vending machines ...). The old item stays one member of its family (KEEP share).
//
// What it never does: no table row is re-weighted, no RNG stream is drawn (a pure hash), nothing is added or removed — one lot stays one
// lot with the same count, position and lot slot, so every non-food lot, every ammo / medicine / material roll and every placement of
// the rolled loot is byte-identical (tests/loot-golden.test.ts is unchanged: realization runs after rollHolderLots, in the game's
// ContainerManager.build hook and the first-visit pickup spawn). A variant must FIT where the original lies (the surface's clear height
// and bounds, never across the mid-line to a neighbour lot — decided against the neighbours' ROLLED boxes, so each lot's realization is
// independent of every other's) else the original stays. The expected food / water per substituted lot stays within ~10 % of the
// original's (tests/food-variety.test.ts, every level x theme x slot context).
//
// PERSISTENCE (holder memory keeps lot ids only: run/memory.ts). A substituted lot gets the id `rolled id + PANTRY_LOT_OFFSET x (code + 1)`
// (code = the variant's index in PANTRY_CODE, append-only), so a remembered holder record names exactly what was realized:
//  - a FRESH holder (no record: unvisited station / new holder): realized as above; its record then lists the variant ids;
//  - a REMEMBERED holder: a lot whose record lists a variant id realizes exactly that variant (no re-pick, no fit re-check: the record
//    wins); every other lot keeps its ROLLED item (an old save's record lists the rolled ids: the holder keeps exactly its old items —
//    no reroll, no refill, no injection; a taken lot is still filtered out by applyHolderRecord).
// Floor pickups: only the first-visit spawn (memory pickups === null) is realized; a remembered section restores its recorded stacks.
// Ids stay below the save validator's 1e9 (holder indices < 10 000: SAVE_LIMITS.holders 5 000) and keep `id % 1000` (salvage / fuel slots).
import {hashString} from '../core/rng';
import {ITEMS, itemDims} from './items';
import {placementBox, type Orient, type Placement, type Surface} from './lootLayout';
import {slotOf, type SlotCategory} from './lootTables';
import {holderTheme, lootTheme, type LootTheme} from './lootEconomy';
import {holderTable, type HolderKind} from './loot';
import {BASELINE_PROFILE, catWeight, lootProfile, type LootProfile} from './lootTables';
import {holderKey} from '../run/memory';
import type {StationLayout} from '../gen/stationTypes';
import {
  BUTTER_COOKIES, CORNED_BEEF, FIELD_RATION, FRUIT_PUREE, GINGER_SODA, HONEY, ICED_COFFEE, ICED_TEA, JERKY, JUICE_BOXES, PANTRY_IDS,
  PEANUT_BUTTER, PICKLES, PUDDING_CUPS, RAISINS, RATION_BRICK, RICE_CRACKERS, ROLLED_OATS, SALTINES, SARDINES, SMOKED_SAUSAGE,
  SPORTS_DRINK, TRAIL_MIX, UHT_MILK, WAX_CHEESE, isPantryItem, type PantryId,
} from './pantryFood';

// ---------------------------------------------------------------------------------------
// Families

/** A family: the OLD item it substitutes, the share it keeps, and its members' base weights (before the context leans). */
export interface PantryFamily { base: string; keep: number; members: Readonly<Partial<Record<PantryId, number>>> }

/**
 * The seven families (old item -> members). `keep` = the old item's share wherever the level stocks at least one member (chocolate keeps
 * 30 %: it was the most repeated find). Bread (bakery cases only) and the Skyways ramen / bento / bubble tea are not substituted.
 */
export const PANTRY_FAMILIES: Readonly<Record<string, PantryFamily>> = {
  chocolate: {base: 'chocolate', keep: 0.30, members: {[BUTTER_COOKIES]: 1.0, [PUDDING_CUPS]: 0.9, [RAISINS]: 1.0, [HONEY]: 0.7, [FRUIT_PUREE]: 0.8}},
  chips: {base: 'chips', keep: 0.40, members: {[JERKY]: 1.0, [TRAIL_MIX]: 1.1, [RICE_CRACKERS]: 0.8, [SALTINES]: 1.0}},
  beans: {base: 'beans', keep: 0.40, members: {[CORNED_BEEF]: 1.2, [SARDINES]: 1.1, [PICKLES]: 0.4, [FIELD_RATION]: 0.7, [RATION_BRICK]: 0.18, [WAX_CHEESE]: 0.5, [SMOKED_SAUSAGE]: 0.5}},
  noodles: {base: 'noodles', keep: 0.45, members: {[ROLLED_OATS]: 1.2, [PEANUT_BUTTER]: 1.0, [SMOKED_SAUSAGE]: 0.8, [WAX_CHEESE]: 0.6}},
  cola: {base: 'cola', keep: 0.50, members: {[GINGER_SODA]: 1.0, [ICED_COFFEE]: 1.0}},
  juice: {base: 'juice', keep: 0.45, members: {[JUICE_BOXES]: 1.0, [UHT_MILK]: 0.9, [ICED_TEA]: 1.0}},
  water: {base: 'water', keep: 0.85, members: {[SPORTS_DRINK]: 1.0}}, // plain water stays dominant
};
/** The old items that have a family. */
export const PANTRY_BASES: readonly string[] = Object.keys(PANTRY_FAMILIES);
export const isPantryBase = (id: string): boolean => id in PANTRY_FAMILIES;

/**
 * Which pantry items each logical level (levels/types.ts LevelId) stocks — its palette; a level without an entry (QA / the baseline
 * profile) stocks all. Every item is in at least one level; each level loads only its palette's models (world/pantryModels.ts).
 */
export const LEVEL_PANTRY: Readonly<Record<string, readonly PantryId[]>> = {
  // a transit station: kiosks, vending, staff rooms, maintenance, survivor annexes
  subway: [BUTTER_COOKIES, RAISINS, FRUIT_PUREE, JERKY, TRAIL_MIX, SALTINES, CORNED_BEEF, SARDINES, FIELD_RATION, RATION_BRICK, PEANUT_BUTTER,
    ROLLED_OATS, GINGER_SODA, ICED_COFFEE, JUICE_BOXES, ICED_TEA, SPORTS_DRINK],
  // office floors: break rooms, desks, the security office, the cafeteria
  office: [BUTTER_COOKIES, PUDDING_CUPS, RAISINS, HONEY, TRAIL_MIX, RICE_CRACKERS, SALTINES, SARDINES, FIELD_RATION, RATION_BRICK, WAX_CHEESE,
    PEANUT_BUTTER, ROLLED_OATS, ICED_COFFEE, GINGER_SODA, JUICE_BOXES, UHT_MILK, ICED_TEA, SPORTS_DRINK],
  // the mall: grocery, food court, specialty shops — the widest shelf
  mall: [BUTTER_COOKIES, PUDDING_CUPS, RAISINS, HONEY, FRUIT_PUREE, JERKY, TRAIL_MIX, RICE_CRACKERS, SALTINES, CORNED_BEEF, SARDINES, PICKLES,
    WAX_CHEESE, PEANUT_BUTTER, ROLLED_OATS, SMOKED_SAUSAGE, GINGER_SODA, ICED_COFFEE, JUICE_BOXES, UHT_MILK, ICED_TEA, SPORTS_DRINK],
  // the survivor market: preserved goods and traded staples
  market: [HONEY, RAISINS, BUTTER_COOKIES, JERKY, RICE_CRACKERS, TRAIL_MIX, CORNED_BEEF, SARDINES, PICKLES, FIELD_RATION, RATION_BRICK, WAX_CHEESE,
    SMOKED_SAUSAGE, ROLLED_OATS, PEANUT_BUTTER, GINGER_SODA, UHT_MILK, ICED_TEA, SPORTS_DRINK],
  // the skyways: skywalk shops, the ramen restaurant's fridges, the convention
  skyways: [PUDDING_CUPS, FRUIT_PUREE, BUTTER_COOKIES, RICE_CRACKERS, TRAIL_MIX, JERKY, CORNED_BEEF, SARDINES, PICKLES, WAX_CHEESE, SMOKED_SAUSAGE,
    ICED_COFFEE, GINGER_SODA, ICED_TEA, JUICE_BOXES, UHT_MILK, SPORTS_DRINK],
  // the reactor: control rooms, bunkers, maintenance
  reactor: [RAISINS, HONEY, JERKY, SALTINES, FIELD_RATION, RATION_BRICK, CORNED_BEEF, SARDINES, PEANUT_BUTTER, ROLLED_OATS, ICED_COFFEE, UHT_MILK, SPORTS_DRINK],
};

/** The pantry items `level` can realize (its palette; every item for an unknown level). */
export function levelPantryIds(level: string): readonly PantryId[] {
  return LEVEL_PANTRY[level] ?? PANTRY_IDS;
}

/**
 * The pantry models a level's loading screen fetches for its OWN loot (world/pantryModels.ts): its palette — none for a level whose loot
 * profile rolls no food and no drink at all (the Survivor Market: its goods are trader stock, MARKET_PROFILE zeroes both categories).
 */
export function levelPreloadPantryIds(level: string): readonly PantryId[] {
  const p = lootProfile(level as never);
  return catWeight(p, 'food', 1) > 0 || catWeight(p, 'drink', 1) > 0 ? levelPantryIds(level) : [];
}

/** The holder context of a realization: the logical level, the holder's loot theme and slot ('floor' for a loose layout pickup). */
export interface PantryContext { level: string; theme: LootTheme; slot: SlotCategory | 'floor' | undefined }

/** Context of a loot holder (its kind's slot, its area key's theme: items/lootEconomy.ts holderTheme). */
export function holderPantryContext(level: string, kind: string, areaType: string): PantryContext {
  return {level, theme: holderTheme(kind, areaType), slot: slotOf(kind)};
}

/**
 * Context LEANS: multipliers on member weights (the family's keep share is never leaned). Field rations / ration bricks in security and
 * service rooms, lockers and stashes (more in the Reactor); preserved goods in food places; milk / pudding / cheese in fridges and
 * coolers; iced coffee and trail mix in vending; office snacks in personal / tech rooms; rice crackers in Skyways and Market shops.
 */
function lean(id: PantryId, c: PantryContext): number {
  let k = 1;
  const t = c.theme, s = c.slot, L = c.level;
  if (id === FIELD_RATION || id === RATION_BRICK) {
    if (t === 'security' || t === 'service' || s === 'arms' || s === 'stash') k *= 2.5;
    if (L === 'reactor') k *= 1.5;
    if (s === 'vend' || s === 'cold') k *= 0.4;
  }
  if (id === JERKY && (t === 'security' || t === 'service')) k *= 1.5;
  if (id === CORNED_BEEF && (t === 'security' || t === 'service' || s === 'stash')) k *= 1.3;
  if (t === 'food') {
    if (id === PICKLES || id === SMOKED_SAUSAGE) k *= 1.4;
    if (id === PEANUT_BUTTER || id === ROLLED_OATS) k *= 1.4;
    if (id === WAX_CHEESE || id === RICE_CRACKERS) k *= 1.3;
  }
  if (s === 'cold') {
    if (id === UHT_MILK || id === PUDDING_CUPS) k *= 2;
    if (id === WAX_CHEESE) k *= 1.5;
    if (id === FRUIT_PUREE) k *= 1.4;
    if (id === ICED_TEA) k *= 1.3;
  }
  if (s === 'vend') {
    if (id === ICED_COFFEE) k *= 1.5;
    if (id === TRAIL_MIX) k *= 1.3;
    if (id === RICE_CRACKERS) k *= 1.2;
  }
  if (t === 'medical') {
    if (id === FRUIT_PUREE) k *= 1.6;
    if (id === PUDDING_CUPS) k *= 1.4;
    if (id === SPORTS_DRINK) k *= 1.5;
  }
  if (t === 'personal' || t === 'tech') {
    if (id === BUTTER_COOKIES || id === ICED_COFFEE) k *= 1.4;
    if (id === JUICE_BOXES) k *= 1.3;
    if (id === TRAIL_MIX) k *= 1.2;
  }
  if (t === 'service' && id === SPORTS_DRINK) k *= 1.5;
  if ((L === 'skyways' || L === 'market') && id === RICE_CRACKERS) k *= 1.8;
  if (L === 'market') {
    if (id === HONEY) k *= 1.5;
    if (id === WAX_CHEESE || id === SMOKED_SAUSAGE) k *= 1.3;
  }
  if (L === 'office' && id === ICED_COFFEE) k *= 1.3;
  return k;
}

/** The weighted rows a family realizes from in a context: [old item, keep], then the level's members by weight x lean (sum 1). */
export function familyRows(base: string, c: PantryContext): [string, number][] {
  const f = PANTRY_FAMILIES[base];
  if (!f) return [[base, 1]];
  const palette = new Set(levelPantryIds(c.level));
  const mem = (Object.entries(f.members) as [PantryId, number][]).filter(([id, w]) => palette.has(id) && w > 0).map(([id, w]) => [id, w * lean(id, c)] as [PantryId, number]);
  const total = mem.reduce((s, [, w]) => s + w, 0);
  if (!(total > 0)) return [[base, 1]];
  return [[base, f.keep], ...mem.map(([id, w]) => [id, (1 - f.keep) * w / total] as [string, number])];
}

/** Expected [food, water] of one realized item of `base` in context `c` (tests: the ~10 % nutrition rule). */
export function familyExpectation(base: string, c: PantryContext): {hunger: number; thirst: number} {
  let hunger = 0, thirst = 0;
  for (const [id, w] of familyRows(base, c)) { hunger += w * (ITEMS[id]?.hunger ?? 0); thirst += w * (ITEMS[id]?.thirst ?? 0); }
  return {hunger, thirst};
}

// ---------------------------------------------------------------------------------------
// Lot ids

/** Variant lot id step (rolled ids are < holder index x 1000 + 1000 < 1e7; variant ids stay < 1e9, the save validator's bound). */
export const PANTRY_LOT_OFFSET = 10_000_000;
/** Variant codes (APPEND-ONLY: a remembered variant lot id names its item through this list). */
export const PANTRY_CODE: readonly PantryId[] = PANTRY_IDS;

/** The variant lot id of a rolled lot realized as `id` (null: not a pantry item / the rolled id is out of range). */
export function variantLotId(rolledId: number, id: string): number | null {
  const code = (PANTRY_CODE as readonly string[]).indexOf(id);
  if (code < 0 || !Number.isInteger(rolledId) || rolledId < 0 || rolledId >= PANTRY_LOT_OFFSET) return null;
  return rolledId + PANTRY_LOT_OFFSET * (code + 1);
}
/** Decodes a lot id: the rolled id and, for a variant id, the pantry item it realizes. */
export function decodeLotId(id: number): {rolled: number; variant: PantryId | null} {
  if (!Number.isInteger(id) || id < PANTRY_LOT_OFFSET) return {rolled: id, variant: null};
  const code = Math.floor(id / PANTRY_LOT_OFFSET) - 1;
  return {rolled: id % PANTRY_LOT_OFFSET, variant: PANTRY_CODE[code] ?? null};
}
export const isVariantLotId = (id: number): boolean => decodeLotId(id).variant !== null;

// ---------------------------------------------------------------------------------------
// Picking

/** Uniform [0, 1) of a stable identity (no RNG stream: an FNV-1a hash with a murmur3 finalizer, so neighbouring ids spread well). */
function unit(identity: string, seed: number): number {
  let h = hashString(identity, seed >>> 0);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A weighted pick among the rows that pass `ok` (renormalized); the old item always passes. */
function pickRow(rows: readonly [string, number][], u: number, ok: (id: string) => boolean): string {
  const live = rows.filter(([id, w], i) => w > 0 && (i === 0 || ok(id)));
  const total = live.reduce((s, [, w]) => s + w, 0);
  let x = u * total;
  for (const [id, w] of live) { x -= w; if (x < 0) return id; }
  return live[live.length - 1]?.[0] ?? rows[0][0];
}

/** Orientation options of an item (items/lootLayout.ts packItems' rule: flat items upright only; others upright / lying down). */
function orients(itemId: string, lying: boolean): Orient[] {
  const shape = itemDims(itemId).shape;
  if (shape === 'flat') return ['up'];
  const down: Orient = shape === 'cylinder' ? 'side' : 'back';
  return lying ? [down, 'up'] : ['up', down];
}

type Box = ReturnType<typeof placementBox>;
const yOverlap = (a: Box, b: Box) => a.min[1] < b.max[1] - 0.002 && a.max[1] > b.min[1] + 0.002;

/**
 * Does a variant box stay on its own side of every neighbour (decided on the ROLLED boxes: the mid-line of the gap along the axis that
 * separates the rolled lot from that neighbour; overlapping rolled boxes: the variant may not grow past the rolled box there).
 */
function clearOf(v: Box, own: Box, others: readonly Box[]): boolean {
  const pad = 0.002;
  for (const o of others) {
    if (!yOverlap(v, o) && !yOverlap(own, o)) continue;
    const gx = Math.max(o.min[0] - own.max[0], own.min[0] - o.max[0]), gz = Math.max(o.min[2] - own.max[2], own.min[2] - o.max[2]);
    if (gx <= 0 && gz <= 0) {
      if (v.min[0] < own.min[0] - 1e-9 || v.max[0] > own.max[0] + 1e-9 || v.min[2] < own.min[2] - 1e-9 || v.max[2] > own.max[2] + 1e-9) return false;
      continue;
    }
    const ax = gx >= gz ? 0 : 2;
    if (o.min[ax] >= own.max[ax]) { const mid = (own.max[ax] + o.min[ax]) / 2; if (v.max[ax] > mid - pad) return false; }
    else { const mid = (o.max[ax] + own.min[ax]) / 2; if (v.min[ax] < mid + pad) return false; }
  }
  return true;
}

/** Where `itemId` would rest in the rolled lot's spot (same surface / x / z / yaw; its own orientation), or null when it does not fit. */
export function fitInPlace(itemId: string, at: Placement, rolledItem: string, surfaces: readonly Surface[], others: readonly Box[]): Placement | null {
  const s = surfaces[at.surface];
  if (!s) return null;
  const own = placementBox(rolledItem, at);
  const lo = [Math.min(s.x0, own.min[0]), Math.min(s.z0, own.min[2])], hi = [Math.max(s.x1, own.max[0]), Math.max(s.z1, own.max[2])];
  for (const orient of orients(itemId, at.orient !== 'up')) {
    const p: Placement = {surface: at.surface, x: at.x, y: at.y, z: at.z, yaw: at.yaw, orient};
    const b = placementBox(itemId, p);
    if (b.max[1] - b.min[1] + 0.004 > s.clear) continue;
    if (b.min[0] < lo[0] - 1e-9 || b.max[0] > hi[0] + 1e-9 || b.min[2] < lo[1] - 1e-9 || b.max[2] > hi[1] + 1e-9) continue;
    if (!clearOf(b, own, others)) continue;
    return p;
  }
  return null;
}

/** A lot as realization reads / writes it (items/loot.ts Lot). */
export interface PantryLot extends Placement { id: number; itemId: string; count: number; part?: number }

/** The holder a realization runs for (ContainerManager.build: layout seed, kind / index / loot key, its surfaces). */
export interface PantryHolder { seed: number; kind: string; index: number; areaType: string; surfaces: readonly Surface[] }

/**
 * Realize a holder's rolled lots (see the header). `remembered` = the lot ids its section memory record lists (undefined: a fresh holder).
 * Returns the same array when nothing changes, else a new one (same length, same order; only food / drink lots may differ, in itemId /
 * id / orientation).
 */
export function realizeHolderLots<L extends PantryLot>(h: PantryHolder, level: string, lots: readonly L[], remembered?: readonly number[]): readonly L[] {
  if (!lots.some(l => isPantryBase(l.itemId))) return lots;
  const boxes = lots.map(l => placementBox(l.itemId, l));
  let ctx: PantryContext | null = null;
  const recorded = remembered ? new Map(remembered.map(id => [decodeLotId(id).rolled, decodeLotId(id).variant] as const).filter(([, v]) => v !== null)) : null;
  let out: L[] | null = null;
  lots.forEach((l, i) => {
    if (!isPantryBase(l.itemId) || l.id >= PANTRY_LOT_OFFSET) return;
    const others = boxes.filter((_, j) => j !== i);
    let pick: string;
    let place: Placement | null;
    if (recorded) {
      // a remembered holder: exactly what its record names (a variant id), else the rolled item (an old save / a kept original)
      const v = recorded.get(l.id);
      if (!v || !ITEMS[v]) return;
      pick = v;
      place = fitInPlace(v, l, l.itemId, h.surfaces, others) ?? {surface: l.surface, x: l.x, y: l.y, z: l.z, yaw: l.yaw, orient: orients(v, l.orient !== 'up')[0]};
    } else {
      ctx ??= holderPantryContext(level, h.kind, h.areaType);
      const fits = new Map<string, Placement | null>();
      const ok = (id: string) => { if (!fits.has(id)) fits.set(id, fitInPlace(id, l, l.itemId, h.surfaces, others)); return !!fits.get(id); };
      pick = pickRow(familyRows(l.itemId, ctx), unit(`pantry:${h.kind}:${h.index}:${l.id}`, h.seed), ok);
      if (pick === l.itemId) return;
      place = fits.get(pick) ?? null;
      if (!place) return;
    }
    const id = variantLotId(l.id, pick);
    if (id === null) return;
    out ??= lots.slice();
    out[i] = {...l, id, itemId: pick, orient: place.orient};
  });
  return out ?? lots;
}

/**
 * Realize a generated floor pickup's item at its FIRST spawn (memory pickups === null): the family pick of its layout index (no fit rule
 * on a floor; a variant must hold the pickup's whole count in one stack). `reward` pickups (curated finds) are never substituted.
 */
export function realizePickupItem(seed: number, layoutIndex: number, level: string, theme: LootTheme, p: {itemId: string; count: number; reward?: string}): string {
  if (!isPantryBase(p.itemId) || p.reward) return p.itemId;
  const ctx: PantryContext = {level, theme, slot: 'floor'};
  return pickRow(familyRows(p.itemId, ctx), unit(`pantry:pickup:${layoutIndex}:${p.itemId}`, seed), id => (ITEMS[id]?.stackMax ?? 0) >= p.count);
}

/**
 * The ContainerManager.build realization hook for a section (game.ts buildSection): every holder's rolled lots through realizeHolderLots
 * with its REMEMBERED record (`records` = the section memory's holders, run/memory.ts holderKey; {} on a first visit). Curated rewards
 * (the Office roof cache: lootTables REWARD_TABLES) are never substituted.
 */
export function pantryHolderRealizer(level: string, records: Readonly<Record<string, {lots: readonly number[]}>>, profile: LootProfile = BASELINE_PROFILE) {
  return <L extends PantryLot>(h: PantryHolder & {prop: {level?: number; x: number; z: number}}, lots: readonly L[]): readonly L[] => {
    if (!lots.some(l => isPantryBase(l.itemId))) return lots;
    if (holderTable(h.kind as HolderKind, h.areaType, profile).source === 'reward') return lots;
    return realizeHolderLots(h, level, lots, records[holderKey(h.kind, h.prop.level, h.prop.x, h.prop.z)]?.lots);
  };
}

/** The item a generated layout pickup spawns as on its FIRST spawn in `level` (game.ts buildSection plan.fromLayout). */
export function pantryPickupItem(layout: Pick<StationLayout, 'seed' | 'areas' | 'pickups'>, layoutIndex: number, level: string): string {
  const p = layout.pickups[layoutIndex];
  if (!p || !isPantryBase(p.itemId)) return p?.itemId ?? '';
  const area = layout.areas[p.area];
  return realizePickupItem(layout.seed, layoutIndex, level, lootTheme(area?.purpose ?? area?.type ?? 'default'), p);
}

/** Pantry item ids anywhere in a JSON-like value (an inventory / store / memory record: every `itemId` field). Bounded depth. */
export function pantryIdsIn(v: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 12 || v === null || typeof v !== 'object') return out;
  if (Array.isArray(v)) { for (const x of v) pantryIdsIn(x, out, depth + 1); return out; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === 'itemId' && typeof x === 'string' && isPantryItem(x)) out.add(x);
    else if (x && typeof x === 'object') pantryIdsIn(x, out, depth + 1);
  }
  return out;
}
