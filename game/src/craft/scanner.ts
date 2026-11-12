// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER; user: "Item/enemy scanner: … A movable plugged console opens a
// black/green 360-degree radar around the train, approximately 100m range. About every 30 active seconds a sweep refreshes snapshot
// blips: red enemies, green ordinary items, gold weapons/gear. No floorplan/map or continuous live tracking; it should give broad
// awareness rather than precise navigation."): THE SCANNER'S RULES — pure (no three.js / DOM / Game): every number (SCANNER), what
// counts as what (classifyItem), one SNAPSHOT of the world as coarse blips (takeSnapshot) and the sweep clock (SweepClock).
// world/itemScanner.ts feeds it the game's lists and owns the scope; ui/scannerView.ts draws a snapshot.
//
// A SNAPSHOT is taken at ONE instant and never updated: a blip is where a thing WAS at the last sweep (a killed enemy / a taken item
// stays shown until the next one). It holds, within SCANNER.range (horizontal, from the car's centre), EVERY STOREY FLATTENED onto one
// plane (no height, no storey):
//   enemy (red)   a living, non-ragdolled enemy (Game.zombies; corpses and the market's people are not in that list);
//   item  (green) a loose pickup / a holder that still holds lots, whose items are all ordinary (ammo, food, drink, medical supplies,
//                 batteries, flares, filters, fuel cans, materials, parts, currency);
//   gear  (gold)  the same with a WEAPON (guns and melee) or a piece of GEAR among them, and every grounded backpack.
// Never a blip: a market stall's displayed ware (Pickup.owner), anything lying in the parked car (the train's own cargo), an empty
// holder, an unknown item id, a dead / ragdolled enemy.
//
// COARSE ON PURPOSE (broad awareness, not navigation): positions are quantised to a SCANNER.cell grid in the TRAIN's frame (x toward
// the car's front, z to its right seen from above) and the things of one class in one cell merge into ONE blip (its count only makes
// the mark a little larger: SCANNER.countCap). At most SCANNER.maxBlips blips per class, the nearest first (the draw stays bounded).
// A snapshot has no walls, rooms, routes, labels or distances. Deterministic: the same things give the same blips in the same order,
// whatever order the lists come in.
//
// THE CLOCK counts ACTIVE seconds only (the caller ticks it while the scanner is plugged into the parked train in live play): the first
// sweep of a world SCANNER.warmup after the scanner is first active there, then one every SCANNER.period. Time spent unplugged does not
// count and replugging neither resets nor advances it (no free sweep). Nothing is saved: a new world starts empty.

import {ITEMS} from '../items/items';
import {isGearItem} from '../items/gear';

/** Every number of the scanner (one place). */
export const SCANNER = {
  /** Reach (m): horizontal distance from the car's centre; the scope's outer ring. */
  range: 100,
  /** Active seconds between two sweeps. */
  period: 30,
  /** Active seconds before a world's FIRST sweep. */
  warmup: 4,
  /** The grid a snapshot is quantised to (m, train frame). */
  cell: 4,
  /**
   * Blips per class at most (the nearest first): a bound on the draw, chosen so it does not bite — with EVERY loot holder counted as
   * holding something, 56 generated levels (8 seeds x 7 level kinds) gave at most 245 item cells in range (160 would have cut the far
   * field at 46 - 73 m on the Mall / Subway / Bunker).
   */
  maxBlips: 256,
  /** A blip's mark grows with the things merged into it up to this count (x1 at one thing .. x countGrow at countCap or more). */
  countCap: 6,
  countGrow: 1.5,
  /** The scope's range rings (m; the last one is the range). */
  rings: [25, 50, 75, 100],
  /** A blip is at full brightness right after a sweep and dims to this just before the next (never gone before it). */
  dim: 0.4,
  /** The open scope closes when the player is farther than this from the scanner (m, horizontal) or this far above / below it. */
  closeDist: 2.6,
  closeDy: 2,
  /** The scope redraws at most this often (the sweep hand's steps; Hz of ACTIVE time). */
  redrawHz: 10,
  /** The sweep hand's fading trail: its width (rad) and the wedges it is drawn with. */
  trail: 0.9,
  trailSteps: 12,
  /** The scope's canvas: this fraction of the smaller viewport side, at most `max` and at least `min` CSS px; devicePixelRatio capped. */
  canvas: {frac: 0.8, max: 720, min: 240, dpr: 2},
} as const;

export type ScanClass = 'enemy' | 'item' | 'gear';
/** Draw order: enemies last (on top). */
export const SCAN_CLASSES: readonly ScanClass[] = ['item', 'gear', 'enemy'];

/**
 * What an item is to the scanner: 'gear' (gold) for a weapon — guns and melee — or a piece of gear, 'item' (green) for everything else
 * in the catalogue, null for an id the catalogue does not know (ignored: never a blip).
 */
export function classifyItem(itemId: string): 'item' | 'gear' | null {
  if (typeof itemId !== 'string' || !Object.hasOwn(ITEMS, itemId)) return null;
  const kind = ITEMS[itemId].kind;
  return kind === 'weapon' || kind === 'gear' || isGearItem(itemId) ? 'gear' : 'item';
}

/** The class of a set of items lying together (a holder's lots): gold when any is gold, green when any is known, else null. */
export function classifyItems(items: Iterable<{itemId: string}>): 'item' | 'gear' | null {
  let c: 'item' | 'gear' | null = null;
  for (const it of items) {
    const k = classifyItem(it.itemId);
    if (k === 'gear') return 'gear';
    if (k) c = k;
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The sources (structural: Game's own lists fit without adapters; tests pass plain objects)

export interface ScanEnemy { readonly brain: {readonly alive: boolean; readonly x: number; readonly z: number}; readonly ragdolled?: boolean }
export interface ScanPickup { readonly stack: {readonly itemId: string}; readonly x: number; readonly z: number; readonly owner?: unknown }
export interface ScanHolder { readonly prop: {readonly x: number; readonly y?: number; readonly z: number}; readonly state: {readonly lots: readonly {readonly itemId: string}[]} }
export interface ScanBag { readonly pose: {readonly x: number; readonly z: number}; readonly grounded?: boolean }

export interface ScanSources {
  enemies?: Iterable<ScanEnemy> | null;
  pickups?: Iterable<ScanPickup> | null;
  holders?: Iterable<ScanHolder> | null;
  bags?: Iterable<ScanBag> | null;
  /** The train's own cargo (lying in the parked car): never a blip. Absent = nothing is cargo. */
  cargoPickup?(p: ScanPickup): boolean;
  cargoBag?(b: ScanBag): boolean;
  cargoHolder?(h: ScanHolder): boolean;
}

/** The train's frame on the ground plane: the car's centre (world x / z) and the world X direction of its front (gen/playerTrain.ts TrainPlacement). */
export interface ScanFrame { readonly x: number; readonly z: number; readonly front: 1 | -1 }

/** One blip: its cell's centre in the train's frame (m; x toward the car's front, z to its right seen from above) and the things merged into it. */
export interface ScanBlip { readonly x: number; readonly z: number; readonly n: number }

export interface ScanSnapshot {
  readonly enemy: readonly ScanBlip[];
  readonly item: readonly ScanBlip[];
  readonly gear: readonly ScanBlip[];
  /** Things in range per class before merging (QA / tests; never drawn). */
  readonly seen: Readonly<Record<ScanClass, number>>;
  /** Cells the per-class cap left out (QA / tests; 0: everything in range is on the scope). */
  readonly dropped: Readonly<Record<ScanClass, number>>;
}

/** World x / z -> the train's frame (gen/playerTrain.ts worldToTrain on the ground plane: exact for yaw 0 / PI). */
export function toScanFrame(f: ScanFrame, wx: number, wz: number): {x: number; z: number} {
  return {x: (wx - f.x) * f.front, z: (wz - f.z) * f.front};
}

const CELLS = Math.ceil(SCANNER.range / SCANNER.cell) + 1, SPAN = 2 * CELLS + 1, R2 = SCANNER.range * SCANNER.range;

/** Count a thing at world (wx, wz) into its cell (false: out of range / not a finite position). */
function mark(cells: Map<number, number>, f: ScanFrame, wx: number, wz: number): boolean {
  const lx = (wx - f.x) * f.front, lz = (wz - f.z) * f.front;
  if (!(lx * lx + lz * lz <= R2)) return false;
  const key = (Math.floor(lx / SCANNER.cell) + CELLS) * SPAN + Math.floor(lz / SCANNER.cell) + CELLS;
  cells.set(key, (cells.get(key) ?? 0) + 1);
  return true;
}

/** The cells as blips: the nearest first (ties: the cell index), at most SCANNER.maxBlips. */
function blipsOf(cells: Map<number, number>): {blips: ScanBlip[]; dropped: number} {
  const all: {x: number; z: number; n: number; d: number; key: number}[] = [];
  for (const [key, n] of cells) {
    const x = (Math.floor(key / SPAN) - CELLS + 0.5) * SCANNER.cell, z = (key % SPAN - CELLS + 0.5) * SCANNER.cell;
    all.push({x, z, n, d: x * x + z * z, key});
  }
  all.sort((a, b) => a.d - b.d || a.key - b.key);
  const kept = all.length > SCANNER.maxBlips ? all.slice(0, SCANNER.maxBlips) : all;
  return {blips: kept.map(b => ({x: b.x, z: b.z, n: b.n})), dropped: all.length - kept.length};
}

/** ONE snapshot of `src` around the train (the rules above). Reads only; allocates only its own result. */
export function takeSnapshot(src: ScanSources, frame: ScanFrame): ScanSnapshot {
  const cells: Record<ScanClass, Map<number, number>> = {enemy: new Map(), item: new Map(), gear: new Map()};
  const seen: Record<ScanClass, number> = {enemy: 0, item: 0, gear: 0};
  const put = (c: ScanClass, x: number, z: number): void => { if (mark(cells[c], frame, x, z)) seen[c]++; };
  for (const e of src.enemies ?? []) if (e.brain.alive && !e.ragdolled) put('enemy', e.brain.x, e.brain.z);
  for (const p of src.pickups ?? []) {
    if (p.owner !== undefined && p.owner !== null) continue;
    const c = classifyItem(p.stack.itemId);
    if (c && !src.cargoPickup?.(p)) put(c, p.x, p.z);
  }
  for (const h of src.holders ?? []) {
    if (!h.state.lots.length) continue;
    const c = classifyItems(h.state.lots);
    if (c && !src.cargoHolder?.(h)) put(c, h.prop.x, h.prop.z);
  }
  for (const b of src.bags ?? []) if (b.grounded !== false && !src.cargoBag?.(b)) put('gear', b.pose.x, b.pose.z);
  const enemy = blipsOf(cells.enemy), item = blipsOf(cells.item), gear = blipsOf(cells.gear);
  return {enemy: enemy.blips, item: item.blips, gear: gear.blips, seen, dropped: {enemy: enemy.dropped, item: item.dropped, gear: gear.dropped}};
}

/** How much larger a blip of `n` merged things is drawn (1 .. SCANNER.countGrow). */
export function blipScale(n: number): number {
  const k = Math.min(SCANNER.countCap, Math.max(1, n)) - 1;
  return 1 + (SCANNER.countGrow - 1) * k / (SCANNER.countCap - 1);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The sweep clock

/** ACTIVE seconds to the next sweep. The caller ticks it only while the scanner works; nothing else moves it. */
export class SweepClock {
  /** Active seconds left until the next sweep (> 0). */
  left: number = SCANNER.warmup;
  /** Sweeps taken since the last arm(). */
  sweeps = 0;

  /** A new world: the first sweep comes SCANNER.warmup active seconds from now. */
  arm(): void {
    this.left = SCANNER.warmup;
    this.sweeps = 0;
  }

  /** `dt` more ACTIVE seconds. True exactly when a sweep is due now (never more than one a call: a long frame queues none). */
  tick(dt: number): boolean {
    if (!(dt > 0)) return false;
    this.left -= dt;
    if (this.left > 0) return false;
    this.left += SCANNER.period;
    if (!(this.left > 0)) this.left = SCANNER.period;
    this.sweeps++;
    return true;
  }

  /** The whole seconds shown as "next sweep in N s" (1 .. period). */
  get seconds(): number { return secondsLeft(this.left); }
}

/** "next sweep in N s": the whole seconds of `left` (rounded up, at least 1). */
export function secondsLeft(left: number): number {
  return Math.max(1, Math.min(SCANNER.period, Math.ceil(left - 1e-6)));
}

/** The sweep hand's angle (rad, clockwise from "up"): one turn per period, crossing up at the sweep instant (left = 0 / = period). */
export function sweepAngle(left: number): number {
  const turn = 1 - left / SCANNER.period;
  return (turn - Math.floor(turn)) * Math.PI * 2;
}

/** A blip's brightness `left` active seconds before the next sweep: 1 right after a sweep, SCANNER.dim just before the next. */
export function blipBrightness(left: number): number {
  const age = Math.max(0, Math.min(1, 1 - left / SCANNER.period));
  return 1 - (1 - SCANNER.dim) * age;
}
