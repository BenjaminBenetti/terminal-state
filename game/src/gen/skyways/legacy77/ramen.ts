// FROZEN GAME77 GENERATOR (task studio-skyways-rework-20261107-054512-01): a verbatim snapshot of gen/skyways/ramen.ts at main
// be3173d (GAME77), kept ONLY to regenerate Skyways stations a player entered before the rework (layout versions 1 and 2:
// gen/skyways/layoutVersion.ts) byte-identically, so their saved holders / pickups / kills keep matching. Never edit (except a
// shared runtime bug fix that leaves the layout fingerprints of tests/skyways-dest-layout-version.test.ts unchanged).
// Task studio-skyways-level-20261106-054448 (lane FOOD): the Skyways RAMEN RESTAURANT kit — dresses an already-carved dining room (and an
// optional kitchen behind it) of the base shop pool as an ordinary ramen bar whose ramen bowls, sushi bento and bubble tea are EDIBLE.
// Pure (no three.js); every piece goes through the shared placement primitive (gen/placeKit.ts tryPlaceProp: door zones, access strips,
// stair / landing keep-outs and room connectivity), so a piece that cannot fit is skipped, never forced (reported in `skipped`).
//
//  dining (purpose 'skyways-ramen', gen/skyways/ramenPurposes.ts):
//   - the SERVICE COUNTER: a run of shopCounter modules (existing counter kind) facing the entry, an island with a 1.2 m staff aisle
//     behind it (open at one end) where the room is deep enough, else against the back wall;
//   - the SUSHI MASCOT figurine (skywaysSushiMascot) standing on the counter top (on-host decor: its span is cut out of the counter's
//     loot surface; dynamic: a shot knocks it off);
//   - a glass-door DRINKS COOLER (shopCooler: an existing openable) on a side wall;
//   - SEATING from the mall café catalogue: café bistro tables with two café chairs each (movable) and now and then a food-court table
//     set (a table and four stools on one fixed frame) — RAMEN_SEATING;
//  kitchen (purpose 'skyways-ramen-kitchen'), when given:
//   - the COMMERCIAL RANGE (skywaysRange: anchored) against a wall, the STOCK POT and the SAUCEPAN standing on its cooktop (on-host,
//     dynamic: they react to bullets);
//   - a stainless back counter (shopBackbar), the kitchen fridge (fridge) and open steel shelving (shelf), all existing kinds;
//  EDIBLE FOOD, finite and seeded: RAMEN_LOOSE (2-4) loose pickups (items/lootTables.ts RAMEN_LOOSE_ROWS) standing on the bistro tables'
//   tops and on the counter's pass (a host's span under a pickup is cut out of its loot surface: nothing overlaps), plus the holders'
//   own themed lots — every holder here carries the restaurant's loot key (PropPlacement.purpose), so the counter, cooler, fridge,
//   back counter and shelving roll the RAMEN_* named tables (exact, one or two lots, often none). Remembered like every pickup / holder
//   (never refilled).
//
// Frame: `frame: 'absolute'` (default) lifts every prop placed here onto its storey's floor before returning (a caller that runs after
// the station dresser's liftLevels); `frame: 'local'` leaves them in the storey's local height frame (a caller that runs BEFORE
// stationDress.dress(): its liftLevels lifts them — never both). Pickups are always absolute (y = the floor + the host's top).
// The areas' purposes are preset to the restaurant ids when they have none.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, footprint, type PropKind, type PropPlacement} from '../../props';
import {begin, cellsOfBox, commit, doorSide, levelGrid, makePlaceCtx, markCell, rollback, tryPlaceProp, wallRange, wallSpot, type PlaceCtx} from '../../placeKit';
import type {Area, Door, PickupPlacement, Side, StationLayout} from '../../stationTypes';
import {RAMEN_LOOSE_ROWS} from '../../../items/lootTables';
import {itemDims} from '../../../items/items';
import {SKYWAYS_RAMEN_PURPOSE} from '../ramenPurposes';

/** Loose edible pickups per restaurant (inclusive range). */
export const RAMEN_LOOSE: readonly [number, number] = [2, 4];
/** Seating kinds (the mall café catalogue: bistro table + café chairs, the food-court table set). */
export const RAMEN_SEATING = {table: 'cafeBistroTable', chair: 'cafeChair', set: 'foodCourtTableSet'} as const satisfies Record<string, PropKind>;
/** Staff aisle (m) kept behind an island counter; customer strip (m) in front of it. */
export const RAMEN_STAFF_AISLE = 1.25;
export const RAMEN_CUSTOMER_STRIP = 0.9;

export interface RamenDressOpts {
  dining: Area;
  kitchen?: Area;
  /** Storey (layout.levels id) of both rooms. */
  level: number;
  /** Height frame of the props placed (see the header). Default 'absolute'. */
  frame?: 'absolute' | 'local';
}

export interface RamenDressResult {
  counter: PropPlacement[];
  mascot: PropPlacement | null;
  cooler: PropPlacement | null;
  tables: PropPlacement[];
  chairs: PropPlacement[];
  sets: PropPlacement[];
  range: PropPlacement | null;
  cookware: PropPlacement[];
  kitchen: PropPlacement[];
  /** The loose edible pickups (indices into layout.pickups: `pickupIndex`). */
  pickups: PickupPlacement[];
  pickupIndex: number[];
  /** Every prop placed here (layout.props order). */
  props: PropPlacement[];
  /** Pieces that could not be placed (QA). */
  skipped: string[];
}

// ---------------------------------------------------------------------------------------------
// Room frame: u along the entry wall (from its x0 / z0 end), v depth from the entry wall into the room

interface Frame {
  a: Area;
  front: Side; back: Side; L: Side; R: Side;
  x0: number; z0: number; x1: number; z1: number;
  W: number; D: number;
  /** Yaw facing the entry wall (a counter's customers), facing +u, facing -u. */
  face: number; plusU: number; minusU: number;
}
const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
function frameOf(a: Area, front: Side): Frame {
  const x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL;
  const alongX = front === 'N' || front === 'S';
  const r = {
    N: {face: Math.PI, plusU: Math.PI / 2, minusU: -Math.PI / 2, L: 'W' as Side, R: 'E' as Side},
    S: {face: 0, plusU: Math.PI / 2, minusU: -Math.PI / 2, L: 'W' as Side, R: 'E' as Side},
    W: {face: -Math.PI / 2, plusU: 0, minusU: Math.PI, L: 'N' as Side, R: 'S' as Side},
    E: {face: Math.PI / 2, plusU: 0, minusU: Math.PI, L: 'N' as Side, R: 'S' as Side},
  }[front];
  return {a, front, back: OPP[front], L: r.L, R: r.R, x0, z0, x1, z1, W: alongX ? x1 - x0 : z1 - z0, D: alongX ? z1 - z0 : x1 - x0, face: r.face, plusU: r.plusU, minusU: r.minusU};
}
function uvXZ(fr: Frame, u: number, v: number): [number, number] {
  switch (fr.front) {
    case 'N': return [fr.x0 + u, fr.z0 + v];
    case 'S': return [fr.x0 + u, fr.z1 - v];
    case 'W': return [fr.x0 + v, fr.z0 + u];
    default: return [fr.x1 - v, fr.z0 + u];
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const snap = (v: number) => Math.round(v / CELL) * CELL;
/** Host-local (x, z) -> world, for a host turned by `rot` (three.js Y rotation). */
function toWorld(host: PropPlacement, lx: number, lz: number): [number, number] {
  const c = Math.cos(host.rot), s = Math.sin(host.rot);
  return [host.x + lx * c + lz * s, host.z - lx * s + lz * c];
}

/** The door joining two areas (either way round), if any. */
const doorBetween = (layout: StationLayout, a: number, b: number): Door | undefined => layout.doors.find(d => (d.a === a && d.b === b) || (d.a === b && d.b === a));

/** The dining room's entry wall: its door to anything but the kitchen; else the wall opposite the kitchen; else south. */
function diningFront(layout: StationLayout, dining: Area, kitchen?: Area): Side {
  const doors = layout.doors.filter(d => (d.a === dining.id || d.b === dining.id) && (!kitchen || (d.a !== kitchen.id && d.b !== kitchen.id)));
  if (doors.length) return doorSide(doors[0], dining);
  const k = kitchen && doorBetween(layout, dining.id, kitchen.id);
  return k ? OPP[doorSide(k, dining)] : 'S';
}

// ---------------------------------------------------------------------------------------------

class Dresser {
  readonly placed: PropPlacement[] = [];
  readonly skipped: string[] = [];
  constructor(readonly layout: StationLayout, readonly ctx: PlaceCtx, readonly rng: Rng) {}

  put(a: Area, kind: PropKind, x: number, z: number, rot: number, o: {front?: number; ring?: number; purpose?: string} = {}): PropPlacement | null {
    const p = tryPlaceProp(this.ctx, a, kind, r3(x), r3(z), rot, {front: o.front, ring: o.ring});
    if (!p) return null;
    if (o.purpose) p.purpose = o.purpose;
    this.placed.push(p);
    return p;
  }

  /** Back to a wall of `a` (one of `walls`), a seeded spot along it; null when none fits. */
  againstWall(a: Area, kind: PropKind, walls: readonly Side[], o: {front?: number; purpose?: string; t0?: number; t1?: number} = {}): PropPlacement | null {
    const def = PROP_DEFS[kind];
    for (let t = 0; t < 24; t++) {
      const side = this.rng.pick(walls);
      const [lo, hi] = wallRange(a, side);
      const a0 = Math.max(lo, o.t0 ?? lo) + def.w / 2 + 0.1, a1 = Math.min(hi, o.t1 ?? hi) - def.w / 2 - 0.1;
      if (a1 < a0) continue;
      const along = Math.round(this.rng.range(a0, a1) * 4) / 4;
      const s = wallSpot(a, side, along, kind);
      const p = this.put(a, kind, s.x, s.z, s.rot, o);
      if (p) return p;
    }
    return null;
  }

  /** Keep-out ring (cells of `a`) round a world box: the next island keeps its distance. */
  keep(a: Area, x0: number, z0: number, x1: number, z1: number): void {
    const g = this.ctx.g, [cx0, cy0, cx1, cy1] = cellsOfBox((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2);
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      if (!g.inBounds(x, y)) continue;
      const i = g.idx(x, y);
      if (g.area[i] === a.id && g.cells[i] === FLOOR && !g.blocked[i]) markCell(this.ctx, this.ctx.keep, i);
    }
  }

  /** On-host decor standing on `host`'s top at host-local (lx, lz); `top` = the host-relative support height. */
  onTop(host: PropPlacement, kind: PropKind, lx: number, lz: number, top: number, rot = host.rot, cut = false): PropPlacement | null {
    const hi = this.layout.props.indexOf(host);
    if (hi < 0) return null;
    const def = PROP_DEFS[kind], hd = PROP_DEFS[host.kind];
    if (Math.abs(lx) + def.w / 2 > hd.w / 2 + 1e-6 || Math.abs(lz) + def.d / 2 > hd.d / 2 + 0.03) return null;
    const [x, z] = toWorld(host, lx, lz);
    const {hx, hz} = footprint(kind, rot);
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r3(host.y + top), rot, area: host.area, hx, hz, h: def.h, blocksSight: false, variant: 0, host: hi,
      ...(host.level ? {level: host.level} : {})};
    if (cut) (host.cut ??= []).push({y: top, x0: r3(lx - def.w / 2 - 0.03), x1: r3(lx + def.w / 2 + 0.03)});
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }
}

/**
 * A run of `n` counter modules facing the entry from u0 (cell-aligned): an island at depth V (the staff aisle behind it) or against the
 * back wall (V = null). All or nothing (a transaction); [] when any module does not fit.
 */
function counterRun(d: Dresser, fr: Frame, n: number, V: number | null, u0: number): PropPlacement[] {
  const def = PROP_DEFS.shopCounter;
  begin(d.ctx);
  const out: PropPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const u = u0 + def.w * (i + 0.5);
    let p: PropPlacement | null;
    if (V === null) {
      const t = fr.front === 'N' || fr.front === 'S' ? fr.x0 + u : fr.z0 + u;
      const s = wallSpot(fr.a, fr.back, t, 'shopCounter');
      p = tryPlaceProp(d.ctx, fr.a, 'shopCounter', r3(s.x), r3(s.z), s.rot, {front: RAMEN_CUSTOMER_STRIP});
    } else {
      const [x, z] = uvXZ(fr, u, V + def.d / 2 + 0.01);
      p = tryPlaceProp(d.ctx, fr.a, 'shopCounter', r3(x), r3(z), fr.face, {front: RAMEN_CUSTOMER_STRIP});
    }
    if (!p) { rollback(d.ctx); return []; }
    out.push(p);
  }
  commit(d.ctx);
  for (const p of out) { p.purpose = SKYWAYS_RAMEN_PURPOSE.dining; d.placed.push(p); }
  return out;
}

/**
 * Where a run of `len` m may start (u of its first module, cell steps): flush with one side wall first (the other end open: the staff
 * way in behind an island), then sliding toward the other end. An island keeps at least one end >= 1.2 m from its side wall.
 */
function runStarts(fr: Frame, len: number, island: boolean, flushRight: boolean): number[] {
  const max = Math.floor((fr.W - len) / CELL + 1e-6) * CELL;
  const out: number[] = [];
  for (let u = 0; u <= max + 1e-6; u += CELL) if (!island || u >= 1.2 - 1e-6 || fr.W - len - u >= 1.2 - 1e-6) out.push(r3(u));
  const pref = flushRight ? max : 0;
  return out.sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref)).slice(0, 12);
}

/** One café set: a bistro table on a cell corner at (u, v), a café chair either side along u, facing it. */
function cafeSet(d: Dresser, fr: Frame, u: number, v: number): {table: PropPlacement; chairs: PropPlacement[]} | null {
  const T = PROP_DEFS[RAMEN_SEATING.table], C = PROP_DEFS[RAMEN_SEATING.chair];
  const off = 1.5 * CELL, half = off + C.d / 2;
  const [x, z] = uvXZ(fr, u, v);
  const table = d.put(fr.a, RAMEN_SEATING.table, x, z, fr.face);
  if (!table) return null;
  const chairs: PropPlacement[] = [];
  for (const [du, rot] of [[-off, fr.plusU], [off, fr.minusU]] as const) {
    const [cx, cz] = uvXZ(fr, u + du, v);
    const c = d.put(fr.a, RAMEN_SEATING.chair, cx, cz, rot);
    if (c) chairs.push(c);
  }
  const [xa, za] = uvXZ(fr, u - half - 0.6, v - T.d / 2 - 0.6), [xb, zb] = uvXZ(fr, u + half + 0.6, v + T.d / 2 + 0.6);
  d.keep(fr.a, Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb));
  return {table, chairs};
}

/** The dining room's seating inside the zone u0..u1 x v0..v1: maybe one table set, then café sets. */
function seating(d: Dresser, fr: Frame, zone: {u0: number; u1: number; v0: number; v1: number}, res: RamenDressResult): void {
  const du = zone.u1 - zone.u0, dv = zone.v1 - zone.v0;
  if (du < 1.6 || dv < 0.8) { d.skipped.push('seating: no floor in front of the counter'); return; }
  const S = PROP_DEFS[RAMEN_SEATING.set];
  // a food-court table set (fixed frame, four stools) in a roomy dining room, now and then
  if (du >= S.w + 2.2 && dv >= S.d + 1.6 && d.rng.chance(0.45)) {
    for (let t = 0; t < 12; t++) {
      const u = snap(d.rng.range(zone.u0 + S.w / 2 + 0.5, zone.u1 - S.w / 2 - 0.5)), v = snap(d.rng.range(zone.v0 + S.d / 2 + 0.3, zone.v1 - S.d / 2 - 0.3));
      const [x, z] = uvXZ(fr, u, v);
      const p = d.put(fr.a, RAMEN_SEATING.set, x, z, fr.face, {ring: 0.8, purpose: SKYWAYS_RAMEN_PURPOSE.dining});
      if (p) { res.sets.push(p); break; }
    }
  }
  // café sets on a seeded lattice of the zone (2.0 m along u, 1.5 m along v), up to one per ~6 m2
  const want = Math.max(1, Math.min(5, Math.round(du * dv / 6)));
  const spots: [number, number][] = [];
  for (let v = zone.v0 + 0.4; v <= zone.v1 - 0.4 + 1e-6; v += 1.5) for (let u = zone.u0 + 1.05; u <= zone.u1 - 1.05 + 1e-6; u += 2.25) spots.push([snap(u), snap(v)]);
  for (const [u, v] of d.rng.shuffle(spots)) {
    if (res.tables.length >= want) break;
    const s = cafeSet(d, fr, u, v);
    if (s) { res.tables.push(s.table); res.chairs.push(...s.chairs); }
  }
  if (!res.tables.length && !res.sets.length) d.skipped.push('seating: no café set fitted');
}

/** The kitchen: the range against a wall with its pot / saucepan on the cooktop, a back counter, the fridge, open shelving. */
function kitchen(d: Dresser, k: Area, front: Side, res: RamenDressResult): void {
  const fr = frameOf(k, front), walls = [fr.back, fr.L, fr.R], P = SKYWAYS_RAMEN_PURPOSE.kitchen;
  const range = d.againstWall(k, 'skywaysRange', walls, {front: 1.0});
  res.range = range;
  if (!range) d.skipped.push('kitchen: no wall for the range');
  else {
    const top = PROP_DEFS.skywaysRange.h, flip = d.rng.chance(0.5) ? -1 : 1;
    // the stock pot on one side burner, the saucepan on the other (its handle along the range's width), a little forward of the centre
    const pot = d.onTop(range, 'skywaysStockPot', flip * -0.4, 0.06, top);
    if (pot) res.cookware.push(pot); else d.skipped.push('kitchen: stock pot');
    if (d.rng.chance(0.8)) {
      const pan = d.onTop(range, 'skywaysSaucepan', flip * 0.4, 0.12, top, flip > 0 ? range.rot : range.rot + Math.PI);
      if (pan) res.cookware.push(pan); else d.skipped.push('kitchen: saucepan');
    }
  }
  for (const [kind, front, chance] of [['shopBackbar', 0.9, 1], ['fridge', 0.6, 1], ['shelf', 0.9, 0.6]] as const) {
    if (!d.rng.chance(chance)) continue;
    const p = d.againstWall(k, kind, walls, {front, purpose: P});
    if (p) res.kitchen.push(p); else d.skipped.push(`kitchen: ${kind}`);
  }
}

/** A loose pickup standing on a host's top at host-local (lx, lz) (its span cut out of the host's loot surface). */
function pickupOn(host: PropPlacement, top: number, lx: number, lz: number, itemId: string, floor: number, level: number): PickupPlacement {
  const [x, z] = toWorld(host, lx, lz), dims = itemDims(itemId);
  (host.cut ??= []).push({y: top, x0: r3(lx - dims.w / 2 - 0.03), x1: r3(lx + dims.w / 2 + 0.03)});
  return {itemId, count: 1, x: r3(x), y: r3(floor + top), z: r3(z), area: host.area, ...(level ? {level} : {}), ...(itemId === 'sushi_bento' ? {yaw: host.rot} : {})};
}

/** The loose edible pickups: one or two per bistro table, the rest on the counter's free span (cut beside the mascot). */
function loosePickups(d: Dresser, res: RamenDressResult, floorUnder: (p: PropPlacement) => number, level: number): void {
  const n = d.rng.int(RAMEN_LOOSE[0], RAMEN_LOOSE[1]);
  const pick = () => d.rng.weighted(RAMEN_LOOSE_ROWS);
  const out: PickupPlacement[] = [];
  const tables = d.rng.shuffle(res.tables.slice());
  // tables: one centred (a little jitter), a second one opposite on a table when the restaurant has few tables
  const perTable = tables.length && tables.length < n ? 2 : 1;
  for (const t of tables) {
    if (out.length >= n) break;
    const top = PROP_DEFS[t.kind].h, f = floorUnder(t);
    if (perTable === 1 || out.length + 1 >= n) out.push(pickupOn(t, top, r3(d.rng.range(-0.06, 0.06)), r3(d.rng.range(-0.06, 0.06)), pick(), f, level));
    else for (const s of [-1, 1]) out.push(pickupOn(t, top, 0.17 * s, 0, pick(), f, level));
  }
  // the counter's pass: free spans of its modules (clear of the mascot's / earlier pickups' cut spans)
  for (const c of d.rng.shuffle(res.counter.slice())) {
    if (out.length >= n) break;
    const w = PROP_DEFS.shopCounter.w / 2 - 0.16, f = floorUnder(c);
    for (const lx of d.rng.shuffle([-0.45, 0, 0.45])) {
      if (out.length >= n || Math.abs(lx) > w) break;
      const item = pick(), hw = itemDims(item).w / 2 + 0.03;
      if ((c.cut ?? []).some(s => lx + hw > s.x0 && lx - hw < s.x1)) continue;
      out.push(pickupOn(c, SHOP_COUNTER_TOP_Y, lx, 0, item, f, level));
    }
  }
  for (const p of out) { res.pickupIndex.push(d.layout.pickups.length); d.layout.pickups.push(p); res.pickups.push(p); }
  if (out.length < RAMEN_LOOSE[0]) d.skipped.push(`loose food: ${out.length} placed (no table / counter room)`);
}

/**
 * Dresses the ramen restaurant (see the header). `rng` is consumed only here (fork it at the call site). Returns what was placed; the
 * placements are already in layout.props / layout.pickups.
 */
export function dressSkywaysRamen(layout: StationLayout, rng: Rng, opts: RamenDressOpts): RamenDressResult {
  const {dining, kitchen: kit, level} = opts;
  const res: RamenDressResult = {counter: [], mascot: null, cooler: null, tables: [], chairs: [], sets: [], range: null, cookware: [], kitchen: [], pickups: [], pickupIndex: [], props: [], skipped: []};
  dining.purpose ??= SKYWAYS_RAMEN_PURPOSE.dining;
  if (kit) kit.purpose ??= SKYWAYS_RAMEN_PURPOSE.kitchen;
  // a placement window round both rooms (+2 cells): the masks are built there only
  const rooms = kit ? [dining, kit] : [dining];
  const win = {x0: Math.min(...rooms.map(a => a.x)) - 2, y0: Math.min(...rooms.map(a => a.y)) - 2, x1: Math.max(...rooms.map(a => a.x + a.w)) + 1, y1: Math.max(...rooms.map(a => a.y + a.h)) + 1};
  const ctx = makePlaceCtx(layout, rng, level, win);
  const d = new Dresser(layout, ctx, rng);
  const p0 = layout.props.length;

  // --- dining: the counter (island with a staff aisle when deep enough, else against the back wall) and its mascot ---
  const fr = frameOf(dining, diningFront(layout, dining, kit));
  const n = fr.W >= 8.5 ? 3 : fr.W >= 4.5 ? 2 : 1;
  const flushRight = rng.chance(0.5);
  const cd = PROP_DEFS.shopCounter.d;
  const islandV = Math.floor((fr.D - cd - RAMEN_STAFF_AISLE) / CELL) * CELL;
  search: for (const [k, V] of [[n, islandV], [n - 1, islandV], [n, null], [n - 1, null], [1, null]] as const) {
    if (k < 1 || (V !== null && V < 2.5)) continue;
    for (const u0 of runStarts(fr, k * PROP_DEFS.shopCounter.w, V !== null, flushRight)) {
      res.counter = counterRun(d, fr, k, V, u0);
      if (res.counter.length) break search;
    }
  }
  if (!res.counter.length) d.skipped.push('dining: no room for the counter');
  const front = res.counter.length ? Math.min(...res.counter.map(p => Math.abs((fr.front === 'N' ? p.z - fr.z0 : fr.front === 'S' ? fr.z1 - p.z : fr.front === 'W' ? p.x - fr.x0 : fr.x1 - p.x)) - cd / 2)) : fr.D - 0.4;
  if (res.counter.length) {
    const host = res.counter[rng.int(0, res.counter.length - 1)];
    // near one end of its module (its own width from the end, so a wide figurine still stands wholly on the top)
    const mx = Math.max(0, PROP_DEFS.shopCounter.w / 2 - PROP_DEFS.skywaysSushiMascot.w / 2 - 0.06);
    res.mascot = d.onTop(host, 'skywaysSushiMascot', rng.chance(0.5) ? -mx : mx, 0, SHOP_COUNTER_TOP_Y, host.rot, true);
    if (!res.mascot) d.skipped.push('dining: mascot');
  }
  // --- the drinks cooler on a side wall, on the customers' side of the counter ---
  {
    const sides = rng.chance(0.5) ? [fr.L, fr.R] : [fr.R, fr.L];
    const tv = (v: number) => (fr.front === 'N' ? fr.z0 + v : fr.front === 'S' ? fr.z1 - v : fr.front === 'W' ? fr.x0 + v : fr.x1 - v);
    const [ta, tb] = [tv(1.0), tv(Math.max(1.6, front))];
    for (const s of sides) {
      res.cooler = d.againstWall(dining, 'shopCooler', [s], {front: 0.8, purpose: SKYWAYS_RAMEN_PURPOSE.dining, t0: Math.min(ta, tb), t1: Math.max(ta, tb)});
      if (res.cooler) break;
    }
    if (!res.cooler) d.skipped.push('dining: drinks cooler');
  }
  // --- seating between the entry and the counter's customer strip ---
  seating(d, fr, {u0: 0.4, u1: fr.W - 0.4, v0: 1.0, v1: front - RAMEN_CUSTOMER_STRIP - 0.15}, res);
  // --- kitchen ---
  if (kit) {
    const kd = doorBetween(layout, dining.id, kit.id);
    // the kitchen's entry wall: its door to the dining room (else: it lies behind the dining room's back wall, entered from that side)
    kitchen(d, kit, kd ? doorSide(kd, kit) : fr.front, res);
  }

  // --- the loose edible pickups (absolute heights: the cell floor under their host + the host's top) ---
  const g = levelGrid(layout, level);
  const floorUnder = (p: PropPlacement): number => {
    const [cx, cy] = g.cellOf(p.x, p.z);
    const i = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
    return i >= 0 && g.cells[i] === FLOOR && g.rampIdx[i] < 0 ? g.floorOf(i) : layout.areas[p.area]?.floorY ?? 0;
  };
  loosePickups(d, res, floorUnder, level);

  // --- height frame: lift onto the storey floor (hosted decor follows its host's floor) ---
  if ((opts.frame ?? 'absolute') === 'absolute') {
    for (let k = p0; k < layout.props.length; k++) { const p = layout.props[k]; if (p.host === undefined) p.y = r3(p.y + floorUnder(p)); }
    for (let k = p0; k < layout.props.length; k++) { const p = layout.props[k]; if (p.host !== undefined) p.y = r3(p.y + floorUnder(layout.props[p.host])); }
  }
  res.props = layout.props.slice(p0);
  res.skipped.push(...d.skipped);
  return res;
}
