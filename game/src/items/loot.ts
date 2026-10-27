// Loot holders and their contents. Pure logic (no three.js) so it can be tested in Node.
//
// Holders: searchable containers (tall cabinet, low cupboard, crate — doors/lid animate) and
// open surfaces (shelf units, kiosk stalls, vending machines, tables). Each holder's contents are
// rolled ONCE from the station seed + holder index + room type, are finite and never rerolled.
// Every item is a visible "lot" placed on a real surface (items/lootLayout.ts) that the player
// takes individually by aiming at it (or all at once from the holder body). Nothing is
// transferred invisibly: whatever does not fit the inventory simply stays where it is.

import {hashString, mulberry32} from '../core/rng';
import {PURPOSE_HOLDER_KINDS, type PurposeHolderKind} from '../gen/props';
import {purposeLoot} from '../gen/purposes';
import {effectText, itemDef} from './items';
import type {Inventory} from './inventory';
import {packItems, type Placement, type Surface} from './lootLayout';

export type ContainerKind = 'cabinetTall' | 'cabinetLow' | 'crate';
export const CONTAINER_KINDS: readonly ContainerKind[] = ['cabinetTall', 'cabinetLow', 'crate'];
export function isContainerKind(kind: string): kind is ContainerKind {
  return (CONTAINER_KINDS as readonly string[]).includes(kind);
}

/** Open loot surfaces placed by the layout lane (props that may not exist in every build). */
export type SurfaceKind = 'shelf' | 'stall' | 'vending' | 'table' | 'desk'
  // Iteration 04 storefront building blocks (gen/storefronts.ts): counter, display case, back counter, cooler.
  | 'shopCounter' | 'shopDisplay' | 'shopBackbar' | 'shopCooler'
  // Iteration 05 purpose holders (gen/props.ts PURPOSE_HOLDER_KINDS): store shelving, snack rack,
  // hot-dog cart, kitchen lines, staff kitchenette/fridge, gun locker, security desk, first-aid cabinet.
  | PurposeHolderKind;
export const SURFACE_KINDS: readonly SurfaceKind[] = ['shelf', 'stall', 'vending', 'table', 'desk', 'shopCounter', 'shopDisplay', 'shopBackbar', 'shopCooler', ...PURPOSE_HOLDER_KINDS];
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
};
/** Back-compat alias (iteration 02 name). */
export const CONTAINER_LABEL = HOLDER_LABEL;

export interface LootEntry { itemId: string; count: number }
/** One visible item (or ammo box) resting on a holder surface. */
export interface Lot extends LootEntry, Placement { id: number }

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
}

// ---------------------------------------------------------------------------------------
// Loot tables

type Cat = 'food' | 'drink' | 'med' | 'ammo';
const CATS: readonly Cat[] = ['food', 'drink', 'med', 'ammo'];
type W4 = readonly [food: number, drink: number, med: number, ammo: number];

/** Category weights by room type (`area.type`); unknown types use `default`. */
const AREA_WEIGHTS: Record<string, W4> = {
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
/** Holder modifiers (multiplied with the room weights). */
const HOLDER_MOD: Record<HolderKind, W4> = {
  cabinetTall: [1, 1, 1.1, 1], cabinetLow: [1, 1, 1, 1], crate: [0.8, 0.9, 0.6, 1.6],
  shelf: [1, 1, 0.9, 0.6], stall: [1.3, 1.3, 0.05, 0], vending: [1, 1, 0, 0], table: [1, 1.4, 0.1, 0], desk: [1, 1.3, 0.4, 0.2],
  shopCounter: [1.3, 1.2, 0.1, 0.05], shopDisplay: [2, 0.6, 0, 0], shopBackbar: [1.4, 1, 0.1, 0.05], shopCooler: [0.15, 3, 0, 0],
  // Purpose holders: used only when no purpose table applies (their purposes normally decide).
  stockShelf: [1, 1, 0.9, 0.3], snackRack: [2, 0.5, 0, 0], hotdogCart: [1.5, 1.5, 0, 0], grillLine: [1.4, 1, 0, 0], espressoBar: [1, 1.4, 0, 0],
  wokLine: [1.6, 0.8, 0, 0], deliLine: [1.4, 1, 0, 0], blenderBar: [0.5, 2, 0, 0], kitchenette: [2, 1, 0.1, 0], fridge: [0.6, 2.4, 0, 0],
  gunLocker: [0, 0, 0.4, 3], monitorDesk: [1, 1.2, 0.2, 0.3], medCabinet: [0, 0.2, 3, 0],
};
/** Empties are rare (and clearly labelled when opened). */
const EMPTY_CHANCE: Record<HolderKind, number> = {
  cabinetTall: 0.08, cabinetLow: 0.1, crate: 0.12, shelf: 0.08, stall: 0.1, vending: 0.12, table: 0.65, desk: 0.55, shopCounter: 0.3, shopDisplay: 0.25, shopBackbar: 0.3, shopCooler: 0.15,
  stockShelf: 0.12, snackRack: 0.15, hotdogCart: 0.2, grillLine: 0.35, espressoBar: 0.35, wokLine: 0.35, deliLine: 0.35, blenderBar: 0.35,
  kitchenette: 0.25, fridge: 0.15, gunLocker: 0.08, monitorDesk: 0.4, medCabinet: 0.15,
};
const LOT_COUNT: Record<HolderKind, readonly [number, number]> = {
  cabinetTall: [2, 5], cabinetLow: [2, 4], crate: [1, 3], shelf: [2, 5], stall: [2, 5], vending: [3, 6], table: [1, 2], desk: [1, 2],
  shopCounter: [1, 3], shopDisplay: [2, 4], shopBackbar: [1, 3], shopCooler: [3, 7],
  stockShelf: [2, 5], snackRack: [2, 4], hotdogCart: [2, 4], grillLine: [1, 3], espressoBar: [1, 3], wokLine: [1, 3], deliLine: [1, 3], blenderBar: [1, 3],
  kitchenette: [1, 3], fridge: [2, 5], gunLocker: [2, 4], monitorDesk: [1, 2], medCabinet: [1, 4],
};
/** Stocked rooms get fuller shelves. */
const FULL_ROOMS = new Set(['stock-room', 'food-court', 'retail-arcade', 'storage', 'crew-room', 'shop']);

type Row = readonly [itemId: string, weight: number];
const POOL: Record<Cat, readonly Row[]> = {
  food: [['chocolate', 1.2], ['chips', 1.1], ['beans', 0.9], ['noodles', 1]],
  drink: [['water', 1.3], ['cola', 1.2], ['juice', 0.9]],
  med: [['bandage', 1], ['medkit', 0.35]],
  ammo: [['ammo_rifle', 1.4], ['ammo_shells', 1]],
};
/** Vending machines sell snacks, not tins of beans. */
const VENDING_FOOD: readonly Row[] = [['chocolate', 1.5], ['chips', 1.5], ['noodles', 0.3]];

function pick<T>(rows: readonly (readonly [T, number])[], r: () => number): T {
  const total = rows.reduce((s, row) => s + row[1], 0);
  let x = r() * total;
  for (const row of rows) { x -= row[1]; if (x < 0) return row[0]; }
  return rows[rows.length - 1][0];
}

function lotCount(itemId: string, kind: HolderKind, r: () => number): number {
  const range = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  if (itemId === 'ammo_rifle') return kind === 'crate' || kind === 'gunLocker' ? range(8, 12) : range(5, 10);
  if (itemId === 'ammo_shells') return kind === 'crate' || kind === 'gunLocker' ? range(3, 6) : range(2, 4);
  return 1;
}

function holderRng(seed: number, index: number, kind: HolderKind): () => number {
  return mulberry32(hashString(`loot:${kind}:${index}`, seed >>> 0));
}

function rollItems(r: () => number, kind: HolderKind, areaType: string): LootEntry[] {
  // Iteration 05: a room/store PURPOSE (gen/purposes.ts) decides what its holders contain
  // (`areaType` is the purpose id when the area has one; plain room types use the tables below).
  const spec = purposeLoot(areaType, kind);
  if (spec) {
    if (!spec.items.length || r() < (spec.empty ?? EMPTY_CHANCE[kind])) return [];
    const [lo, hi] = spec.lots ?? LOT_COUNT[kind];
    const n = lo + Math.floor(r() * (hi - lo + 1));
    const out: LootEntry[] = [];
    for (let i = 0; i < n; i++) {
      const itemId = pick(spec.items, r);
      out.push({itemId, count: lotCount(itemId, kind, r)});
    }
    return out;
  }
  if (r() < EMPTY_CHANCE[kind]) return [];
  const [lo, hi0] = LOT_COUNT[kind];
  const hi = hi0 + ((kind === 'shelf' || kind === 'stall') && FULL_ROOMS.has(areaType) ? 2 : 0);
  const n = lo + Math.floor(r() * (hi - lo + 1));
  const room = AREA_WEIGHTS[areaType] ?? AREA_WEIGHTS.default;
  const mod = HOLDER_MOD[kind];
  const catRows = CATS.map((c, i) => [c, room[i] * mod[i]] as const).filter(([, w]) => w > 0);
  const out: LootEntry[] = [];
  for (let i = 0; i < n; i++) {
    const cat = pick(catRows, r);
    const itemId = pick(kind === 'vending' && cat === 'food' ? VENDING_FOOD : POOL[cat], r);
    out.push({itemId, count: lotCount(itemId, kind, r)});
  }
  return out;
}

/** Deterministic contents (no placement) of holder `index`; same seed → same items. */
export function rollLootItems(seed: number, index: number, kind: HolderKind, areaType = 'default'): LootEntry[] {
  return rollItems(holderRng(seed, index, kind), kind, areaType);
}

/** Deterministic contents placed on the holder's surfaces (items that fit nowhere are dropped). */
export function rollHolderLots(seed: number, index: number, kind: HolderKind, areaType: string, surfaces: readonly Surface[]): Lot[] {
  const r = holderRng(seed, index, kind);
  const items = rollItems(r, kind, areaType);
  const placed = packItems(items.map(e => e.itemId), surfaces, r, kind === 'crate' && r() < 0.5);
  const lots: Lot[] = [];
  placed.forEach((p, i) => { if (p) lots.push({id: index * 1000 + i, ...items[i], ...p}); });
  return lots;
}

export function createHolderState(seed: number, index: number, kind: HolderKind, areaType: string, surfaces: readonly Surface[], lots?: Lot[]): HolderState {
  const list = (lots ?? rollHolderLots(seed, index, kind, areaType, surfaces)).map(l => ({...l}));
  const alwaysOpen = isSurfaceKind(kind) && kind !== 'vending';
  return {index, kind, areaType, open: alwaysOpen, searched: alwaysOpen, lots: list, rolled: list.length};
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

export type HolderAction = 'open' | 'pry' | 'take' | 'close' | 'none';

/** What [E] on the holder body does next. */
export function nextHolderAction(s: HolderState): HolderAction {
  if (isContainerKind(s.kind)) return !s.open ? 'open' : s.lots.length ? 'take' : 'close';
  if (s.kind === 'vending' && !s.open) return 'pry';
  return s.lots.length ? 'take' : 'none';
}

// ---------------------------------------------------------------------------------------
// Text

/** "12 rifle rounds, bandage, 2 × Water" */
export function describeLoot(entries: readonly LootEntry[]): string {
  return entries.map(({itemId, count: n}) => {
    switch (itemId) {
      case 'ammo_rifle': return `${n} rifle round${n === 1 ? '' : 's'}`;
      case 'ammo_shells': return `${n} shotgun shell${n === 1 ? '' : 's'}`;
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
  const what = d.kind === 'ammo' ? describeLoot([l]) : d.name;
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
