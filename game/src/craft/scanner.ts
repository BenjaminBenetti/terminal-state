// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER; user: "Item/enemy scanner: … A movable plugged console opens a
// black/green 360-degree radar around the train, approximately 100m range. About every 30 active seconds a sweep refreshes snapshot
// blips … No floorplan/map or continuous live tracking; it should give broad awareness rather than precise navigation."): THE SCANNER'S
// RULES — pure (no three.js / DOM / Game): every number (SCANNER), what counts as what (scanCategory), one SNAPSHOT of the world's
// resources as coarse cells (takeSnapshot), what a MODE shows of it (scanBlips) and the sweep clock (SweepClock). world/itemScanner.ts
// feeds it the game's lists and owns the scope; ui/scannerView.ts draws a mode's blips.
//
// Task studio-scanner-console-refinements-20261114-031614-01 (user: "cycle through exactly this order: All → Food/Water → Ammo → Fuel →
// Weapon → Equipment → Material → All. ALL means all RESOURCES ONLY: remove enemies from this display. Every mode shows ONLY GREEN dots
// … Use common item/resource traits so new weapons and gear integrate naturally, not another brittle per-kind whitelist … Filter the
// captured resource snapshot when changing mode rather than inventing live tracking or an extra scan."): the scanner is a RESOURCE
// scanner now — no enemies, no red / gold classes — and its MODES (SCAN_MODES, in that order) filter one captured snapshot.
//
// WHAT AN ITEM IS (scanCategory: its catalogue TRAITS, never a list of ids — a new weapon / ammo / gear / material / food joins its mode
// by being what it is):
//   weapon     kind 'weapon' or a weaponId (guns and melee);
//   ammo       kind 'ammo' or a caliber;
//   fuel       the train fuel system's own item (fuel/fuel.ts FUEL.canItem);
//   equipment  kind 'gear' or a gear spec (worn gear: backpacks, armour, masks, helmets …);
//   material   kind 'material' (the bench's crafting salvage);
//   food       eaten or drunk (items/items.ts isFoodOrDrink: food, drinks, beers);
//   none of these (medical supplies, batteries, flares and crafted grenades, gas filters, reactor parts, currency): a resource that
//   shows in ALL only. An id the catalogue does not know is no resource at all (never a dot).
//
// A SNAPSHOT is taken at ONE instant and never updated: a dot is where a resource WAS at the last sweep (a taken item stays shown until
// the next one). It holds, within SCANNER.range (horizontal, from the car's centre), EVERY STOREY FLATTENED onto one plane (no height, no
// storey), the cells that held a RESOURCE: a loose pickup, a holder that still holds lots, a grounded backpack (the bag itself and what
// is in it), a station's fuel cart with fuel in it. Each cell counts its things per MODE: 'all' every resource thing there, a category
// the things holding at least one item of it (a crate of beans and 9mm counts once in ALL, once in FOOD/WATER, once in AMMO).
// Never in it: an enemy (none is read), a market stall's displayed ware (Pickup.owner), anything that is the train's own (lying in the
// parked car, its cargo, a cart of the train), an empty holder / cart, an unknown item id.
//
// A MODE is a filter on that snapshot (scanBlips): the cells whose count for the mode is above zero, their counts — nothing is read from
// the world and nothing is swept when the mode changes. The scope draws every mode the same way: green dots.
//
// COARSE ON PURPOSE (broad awareness, not navigation): positions are quantised to a SCANNER.cell grid in the TRAIN's frame (x toward
// the car's front, z to its right seen from above); the things of one mode in one cell are ONE dot (its count only makes the mark a
// little larger: SCANNER.countCap). At most SCANNER.maxBlips dots per mode, the nearest first (the draw stays bounded). A snapshot has no
// walls, rooms, routes, labels or distances. Deterministic: the same things give the same cells in the same order, whatever order the
// lists come in.
//
// THE CLOCK counts ACTIVE seconds only (the caller ticks it while the scanner is plugged into the parked train in live play): the first
// sweep of a world SCANNER.warmup after the scanner is first active there, then one every SCANNER.period. Time spent unplugged does not
// count and replugging neither resets nor advances it (no free sweep). The snapshot is never saved: a new world starts empty. (The
// selected MODE is the scanner unit's own setting: saved with its equipment record — craft/equipment.ts EquipmentDef.displayModes.)

import {ITEMS, isFoodOrDrink, type ItemDef} from '../items/items';
import {FUEL} from '../fuel/fuel';

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
   * Dots per mode at most (the nearest first): a bound on the draw, chosen so it does not bite — with EVERY loot holder counted as
   * holding something, 56 generated levels (8 seeds x 7 level kinds) gave at most 245 item cells in range (160 would have cut the far
   * field at 46 - 73 m on the Mall / Subway / Bunker).
   */
  maxBlips: 256,
  /** A dot's mark grows with the things merged into it up to this count (x1 at one thing .. x countGrow at countCap or more). */
  countCap: 6,
  countGrow: 1.5,
  /** The scope's range rings (m; the last one is the range). */
  rings: [25, 50, 75, 100],
  /** A dot is at full brightness right after a sweep and dims to this just before the next (never gone before it). */
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
  /** The key that cycles the open scope's mode (KeyboardEvent.code; unbound anywhere else in play). */
  modeKey: 'KeyX',
} as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// Modes and what an item is

/** The modes in their cycling order (the user's: All → Food/Water → Ammo → Fuel → Weapon → Equipment → Material → All). */
export const SCAN_MODES = ['all', 'food', 'ammo', 'fuel', 'weapon', 'equipment', 'material'] as const;
export type ScanMode = (typeof SCAN_MODES)[number];
/** A mode that is one kind of resource (every mode but 'all'). */
export type ScanCategory = Exclude<ScanMode, 'all'>;
export const SCAN_CATEGORIES: readonly ScanCategory[] = SCAN_MODES.filter((m): m is ScanCategory => m !== 'all');
/** A scanner with no recorded mode (a new one, every record written before the modes) shows ALL. */
export const SCAN_DEFAULT_MODE: ScanMode = SCAN_MODES[0];

/** The modes' names (the scope upper-cases them). */
export const SCAN_MODE_LABEL: Readonly<Record<ScanMode, string>> = {
  all: 'All', food: 'Food/Water', ammo: 'Ammo', fuel: 'Fuel', weapon: 'Weapon', equipment: 'Equipment', material: 'Material',
};

export const isScanMode = (v: unknown): v is ScanMode => typeof v === 'string' && (SCAN_MODES as readonly string[]).includes(v);

/** The next mode in the cycle (an unknown one starts it over at ALL). */
export function nextScanMode(m: ScanMode): ScanMode {
  const i = SCAN_MODES.indexOf(m);
  return SCAN_MODES[i < 0 ? 0 : (i + 1) % SCAN_MODES.length];
}

/** The category of a catalogue item by its TRAITS (the file comment); null: a resource of none of them (it shows in ALL only). */
export function scanCategory(def: ItemDef): ScanCategory | null {
  if (def.kind === 'weapon' || def.weaponId) return 'weapon';
  if (def.kind === 'ammo' || def.caliber) return 'ammo';
  if (def.id === FUEL.canItem) return 'fuel';
  if (def.kind === 'gear' || def.gear) return 'equipment';
  if (def.kind === 'material') return 'material';
  if (isFoodOrDrink(def)) return 'food';
  return null;
}

/** A thing's modes as a bit set: bit 0 = ALL (any resource), bit 1 + i = SCAN_CATEGORIES[i]. 0: no resource. */
const BIT: Readonly<Record<ScanMode, number>> = Object.fromEntries(SCAN_MODES.map((m, i) => [m, 1 << i])) as Record<ScanMode, number>;

/** The modes of ONE item id (0: not in the catalogue — never a dot; not even an Object.prototype name). */
export function itemModes(itemId: string): number {
  if (typeof itemId !== 'string' || !Object.hasOwn(ITEMS, itemId)) return 0;
  const c = scanCategory(ITEMS[itemId]);
  return BIT.all | (c ? BIT[c] : 0);
}

/** A stack as the scanner reads it: its item and, for a backpack, what is in it. */
export interface ScanStack { readonly itemId: string; readonly bag?: readonly (ScanStack | null)[] | null }

/** The modes of a stack: its item and everything in its bag. */
export function stackModes(s: ScanStack | null | undefined): number {
  if (!s) return 0;
  let m = itemModes(s.itemId);
  for (const c of s.bag ?? []) if (c) m |= itemModes(c.itemId);
  return m;
}

/** Whether a mode set (itemModes / stackModes) includes `mode`. */
export const hasMode = (modes: number, mode: ScanMode): boolean => (modes & BIT[mode]) !== 0;

// ---------------------------------------------------------------------------------------------------------------------------------
// The sources (structural: Game's own lists fit without adapters; tests pass plain objects)

export interface ScanPickup { readonly stack: ScanStack; readonly x: number; readonly z: number; readonly owner?: unknown }
export interface ScanHolder { readonly prop: {readonly x: number; readonly y?: number; readonly z: number}; readonly state: {readonly lots: readonly {readonly itemId: string}[]} }
/** A grounded backpack (world/groundBag.ts): its stack is the bag itself (gear) with its contents; without one it counts as gear. */
export interface ScanBag { readonly pose: {readonly x: number; readonly z: number}; readonly grounded?: boolean; readonly stack?: ScanStack | null }
/** A fuel cart (world/fuelCarts.ts FuelCartReadout): fuel when a station's and not empty. */
export interface ScanCart { readonly units: number; readonly owner: string; readonly x: number; readonly z: number }

export interface ScanSources {
  pickups?: Iterable<ScanPickup> | null;
  holders?: Iterable<ScanHolder> | null;
  bags?: Iterable<ScanBag> | null;
  carts?: Iterable<ScanCart> | null;
  /** The train's own cargo (lying in the parked car): never a dot. Absent = nothing is cargo. */
  cargoPickup?(p: ScanPickup): boolean;
  cargoBag?(b: ScanBag): boolean;
  cargoHolder?(h: ScanHolder): boolean;
}

/** The train's frame on the ground plane: the car's centre (world x / z) and the world X direction of its front (gen/playerTrain.ts TrainPlacement). */
export interface ScanFrame { readonly x: number; readonly z: number; readonly front: 1 | -1 }

/** One dot: its cell's centre in the train's frame (m; x toward the car's front, z to its right seen from above) and the things merged into it. */
export interface ScanBlip { readonly x: number; readonly z: number; readonly n: number }

/** One cell of a snapshot: its centre (train frame) and its things per mode ('all': every resource thing in it). */
export interface ScanCell { readonly x: number; readonly z: number; readonly n: Readonly<Record<ScanMode, number>> }

export interface ScanSnapshot {
  /** Every cell in range that held a resource, the nearest first (ties: the cell index). */
  readonly cells: readonly ScanCell[];
  /** Things in range per mode before merging (QA / tests; never drawn). */
  readonly seen: Readonly<Record<ScanMode, number>>;
}

/** World x / z -> the train's frame (gen/playerTrain.ts worldToTrain on the ground plane: exact for yaw 0 / PI). */
export function toScanFrame(f: ScanFrame, wx: number, wz: number): {x: number; z: number} {
  return {x: (wx - f.x) * f.front, z: (wz - f.z) * f.front};
}

const CELLS = Math.ceil(SCANNER.range / SCANNER.cell) + 1, SPAN = 2 * CELLS + 1, R2 = SCANNER.range * SCANNER.range;
const zeroCounts = (): Record<ScanMode, number> => ({all: 0, food: 0, ammo: 0, fuel: 0, weapon: 0, equipment: 0, material: 0});

/** ONE snapshot of `src`'s resources around the train (the rules above). Reads only; allocates only its own result. */
export function takeSnapshot(src: ScanSources, frame: ScanFrame): ScanSnapshot {
  const cells = new Map<number, Record<ScanMode, number>>();
  const seen = zeroCounts();
  /** Count a thing of `modes` at world (wx, wz) into its cell (nothing: no resource, out of range, not a finite position). */
  const put = (modes: number, wx: number, wz: number): void => {
    if (!modes) return;
    const lx = (wx - frame.x) * frame.front, lz = (wz - frame.z) * frame.front;
    if (!(lx * lx + lz * lz <= R2)) return;
    const key = (Math.floor(lx / SCANNER.cell) + CELLS) * SPAN + Math.floor(lz / SCANNER.cell) + CELLS;
    let n = cells.get(key);
    if (!n) cells.set(key, n = zeroCounts());
    for (const m of SCAN_MODES) if (modes & BIT[m]) { n[m]++; seen[m]++; }
  };
  for (const p of src.pickups ?? []) {
    if (p.owner !== undefined && p.owner !== null) continue;
    const m = stackModes(p.stack);
    if (m && !src.cargoPickup?.(p)) put(m, p.x, p.z);
  }
  for (const h of src.holders ?? []) {
    if (!h.state.lots.length) continue;
    let m = 0;
    for (const lot of h.state.lots) m |= itemModes(lot.itemId);
    if (m && !src.cargoHolder?.(h)) put(m, h.prop.x, h.prop.z);
  }
  for (const b of src.bags ?? []) {
    if (b.grounded === false || src.cargoBag?.(b)) continue;
    put(b.stack ? stackModes(b.stack) : BIT.all | BIT.equipment, b.pose.x, b.pose.z);
  }
  for (const c of src.carts ?? []) if (c.owner !== 'train' && c.units > 0) put(BIT.all | BIT.fuel, c.x, c.z);
  const all: (ScanCell & {d: number; key: number})[] = [];
  for (const [key, n] of cells) {
    const x = (Math.floor(key / SPAN) - CELLS + 0.5) * SCANNER.cell, z = (key % SPAN - CELLS + 0.5) * SCANNER.cell;
    all.push({x, z, n, d: x * x + z * z, key});
  }
  all.sort((a, b) => a.d - b.d || a.key - b.key);
  return {cells: all.map(c => ({x: c.x, z: c.z, n: c.n})), seen};
}

/**
 * What MODE shows of a snapshot (the filter: nothing read, nothing swept): the cells with things of that mode as dots, the nearest first,
 * at most SCANNER.maxBlips (`dropped`: the cells the cap left out).
 */
export function scanBlips(s: ScanSnapshot, mode: ScanMode): {blips: ScanBlip[]; dropped: number} {
  const blips: ScanBlip[] = [];
  let dropped = 0;
  for (const c of s.cells) {
    const n = c.n[mode];
    if (!(n > 0)) continue;
    if (blips.length < SCANNER.maxBlips) blips.push({x: c.x, z: c.z, n});
    else dropped++;
  }
  return {blips, dropped};
}

/** How much larger a dot of `n` merged things is drawn (1 .. SCANNER.countGrow). */
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

/** A dot's brightness `left` active seconds before the next sweep: 1 right after a sweep, SCANNER.dim just before the next. */
export function blipBrightness(left: number): number {
  const age = Math.max(0, Math.min(1, 1 - left / SCANNER.period));
  return 1 - (1 - SCANNER.dim) * age;
}
