// Iteration 08 (Lane P): the station dresser's placement primitives, LEVEL-AWARE by construction. Pure data (no three.js).
//
// Moved out of stationDress.ts so the composition pass (gen/compose.ts), the iteration-07 prop dresser (gen/props07Dress.ts) and
// the legacy hall/room dressing share ONE placement primitive. A PlaceCtx is bound to one level of the station (gen/levels.ts):
// its grid (levels[L].grid; level 0 = layout.grid), the doors of that level, and masks on that grid —
//   zone      door rect +-2 cells (no props unless explicitly allowed)        doorCell  door rect +-1 cell (never props)
//   keep      reserved access strips / walkway rings / wall mounts            edge      platform safety band, stair flights +1 cell,
//   lane      desire lines between an area's portals (AI + player lanes)                  1.5 m stair approaches, landings, ladder
//   plaza     deliberate open floor (arrival plazas, hall centres)                         stand points, aperture / railing setback
// Floor props never go on lane / plaza cells once the composition pass marked them (legacy dressing runs before, so its anchored
// fixtures are unchanged). Placements authored on a level != 0 carry `level` and are authored in that level's LOCAL height frame
// (y relative to the level floor, area ceilings made relative while dressing); stationDress.liftLevels() moves them to absolute y.
// Transactions (begin / rollback) let a cluster place all-or-nothing.

import type {Rng} from '../core/rng';
import {CELL, FLOOR, SOLID, VOID, type Grid} from './grid';
import type {Level, LevelLink, LevelRole} from './levels';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from './props';
import {boxOverlap, doorClearVolumes, wallBacked, type DoorClearVolume} from './doorways';
import type {Area, Door, Side, StationLayout} from './stationTypes';

// ---------------------------------------------------------------------------------------------
// Levels (tolerant of layouts without the iteration-08 level fields)

export interface LevelInfo { id: number; role: LevelRole; grid: Grid; baseY: number }
type LeveledLayout = StationLayout & {levels?: Level[]; levelLinks?: LevelLink[]};

const mainOnly = new WeakMap<StationLayout, LevelInfo[]>();
/** The station's levels (levels[0] = main = layout.grid); a single main level when the layout has none. */
export function levelsOf(layout: StationLayout): readonly LevelInfo[] {
  const ls = (layout as LeveledLayout).levels;
  if (ls?.length) return ls;
  let m = mainOnly.get(layout);
  if (!m || m[0].grid !== layout.grid) mainOnly.set(layout, (m = [{id: 0, role: 'main', grid: layout.grid, baseY: 0}]));
  return m;
}
export function levelLinksOf(layout: StationLayout): readonly LevelLink[] {
  return (layout as LeveledLayout).levelLinks ?? [];
}
/** Level an area lies on (Area.level, default 0 = main). */
export const areaLevel = (a: Area): number => (a as Area & {level?: number}).level ?? 0;
/** Level a placement lies on (PropPlacement.level, default 0). */
export const propLevel = (p: {level?: number}): number => p.level ?? 0;
export function levelGrid(layout: StationLayout, level: number): Grid {
  return levelsOf(layout)[level]?.grid ?? layout.grid;
}
export function levelRole(layout: StationLayout, level: number): LevelRole {
  return levelsOf(layout)[level]?.role ?? 'main';
}
/** Floor height an area is dressed relative to: 0 on the main level, else its floorY / its level's base height. */
export function areaBase(layout: StationLayout, a: Area): number {
  const L = areaLevel(a);
  return a.floorY ?? (L === 0 ? 0 : levelsOf(layout)[L]?.baseY ?? 0);
}
/** Ceiling of an area relative to its floor. */
export const relCeil = (layout: StationLayout, a: Area): number => a.ceil - areaBase(layout, a);
/** Level a door lies on (the level of the areas it joins). */
export const doorLevel = (layout: StationLayout, d: Door): number => areaLevel(layout.areas[d.a]);

// ---------------------------------------------------------------------------------------------
// Context

export interface Tx {
  /** [mask, index, previous value] while a transaction is open. */
  log: [Uint8Array, number, number][] | null;
  props: number;
  depth: number;
}

export interface PlaceCtx {
  layout: StationLayout;
  level: number;
  g: Grid;
  rng: Rng;
  zone: Uint8Array;
  doorCell: Uint8Array;
  keep: Uint8Array;
  edge: Uint8Array;
  lane: Uint8Array;
  plaza: Uint8Array;
  /** Closed cells of this level that are apertures (light wells, stairwells): never a wall to back or mount on. */
  aperture: Uint8Array;
  doorsOf: Map<number, Door[]>;
  tx: Tx;
}

export function cellsOfBox(x: number, z: number, hx: number, hz: number): [number, number, number, number] {
  const e = 0.04;
  return [Math.floor((x - hx + e) / CELL), Math.floor((z - hz + e) / CELL), Math.floor((x + hx - e) / CELL), Math.floor((z + hz - e) / CELL)];
}

/** Clear stair approach in front of every flight end (m) and its cells. */
export const STAIR_APPROACH = 1.5;

export function makePlaceCtx(layout: StationLayout, rng: Rng, level = 0): PlaceCtx {
  const g = levelGrid(layout, level);
  const n = g.w * g.h;
  const zone = new Uint8Array(n), doorCell = new Uint8Array(n);
  const doorsOf = new Map<number, Door[]>();
  for (const d of layout.doors) {
    for (const id of [d.a, d.b]) { let l = doorsOf.get(id); if (!l) doorsOf.set(id, (l = [])); l.push(d); }
    if (doorLevel(layout, d) !== level) continue;
    for (let y = d.y - 2; y < d.y + d.h + 2; y++) for (let x = d.x - 2; x < d.x + d.w + 2; x++) {
      if (!g.inBounds(x, y)) continue;
      const i = g.idx(x, y);
      zone[i] = 1;
      if (y >= d.y - 1 && y <= d.y + d.h && x >= d.x - 1 && x <= d.x + d.w) doorCell[i] = 1;
    }
  }
  const edge = new Uint8Array(n);
  const mark = (x: number, y: number) => { if (g.inBounds(x, y)) edge[g.idx(x, y)] = 1; };
  // Never dress stairs or the cell beside them; keep a 1.5 m approach clear beyond both ends of every flight.
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.rampIdx[g.idx(x, y)] < 0) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) mark(x + ox, y + oy);
  }
  const ap = Math.ceil(STAIR_APPROACH / CELL - 1e-6);
  for (const r of g.ramps) {
    if (r.axis === 'x') { for (let y = r.y - 1; y <= r.y + r.h; y++) for (let k = 1; k <= ap; k++) { mark(r.x - k, y); mark(r.x + r.w - 1 + k, y); } }
    else for (let x = r.x - 1; x <= r.x + r.w; x++) for (let k = 1; k <= ap; k++) { mark(x, r.y - k); mark(x, r.y + r.h - 1 + k); }
  }
  // Ladder stand points (main level) and level-link landings / ladder ends on this level.
  const stand = (p: {x: number; z: number}) => { const [cx, cy] = g.cellOf(p.x, p.z); for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) mark(cx + ox, cy + oy); };
  if (level === 0) for (const l of layout.traversal?.ladders ?? []) { stand(l.top); stand(l.bottom); }
  for (const k of levelLinksOf(layout)) { if (k.lower === level) stand(k.bottom); if (k.upper === level) stand(k.top); }
  // Task office-props-physics-scale-20261030: an office room under 16 m2 (closets, small offices) keeps a 1.5 m turning square
  // (3 x 3 cells) free just inside its main door. It held only by luck before; resized company props reshuffled a scrubber into it.
  if (levelRole(layout, level) === 'office') for (const a of layout.areas) { // (layout.office is set after dressing)
    if ((a.level ?? 0) !== level || a.kind === 'passage' || a.w < 3 || a.h < 3 || a.w * a.h * CELL * CELL >= 16) continue;
    const d = (doorsOf.get(a.id) ?? []).find(q => doorLevel(layout, q) === level);
    if (!d) continue;
    const side = doorSide(d, a), across = side === 'N' || side === 'S';
    const along = (c0: number, len: number, lo: number, hi: number) => Math.max(lo, Math.min(hi - 3, c0 + Math.floor(len / 2) - 1));
    const x0 = across ? along(d.x, d.w, a.x, a.x + a.w) : side === 'W' ? a.x : a.x + a.w - 3;
    const y0 = across ? (side === 'N' ? a.y : a.y + a.h - 3) : along(d.y, d.h, a.y, a.y + a.h);
    for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) mark(x, y);
  }
  // Apertures (stairwells, light wells, overlook edges): a cell closed on this level while another level's band rises through it.
  // Floor cells next to one keep a one-cell setback (railings stay readable, nothing half over a drop).
  const levels = levelsOf(layout);
  const aperture = new Uint8Array(n);
  if (levels.length > 1) {
    const others = levels.filter(L => L.id !== level).map(L => L.grid);
    const cells = g.cells, W = g.w;
    for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (cells[i] !== SOLID) continue;
      // Highest floor of this level beside the closed cell: an aperture when another level's band, open at this column, starts
      // below that floor and rises above it (you look down through it); a slab or plain rock is not.
      let nb = -Infinity;
      if (cells[i - 1] === FLOOR) nb = Math.max(nb, g.floorOf(i - 1));
      if (cells[i + 1] === FLOOR) nb = Math.max(nb, g.floorOf(i + 1));
      if (cells[i - W] === FLOOR) nb = Math.max(nb, g.floorOf(i - W));
      if (cells[i + W] === FLOOR) nb = Math.max(nb, g.floorOf(i + W));
      if (nb === -Infinity) continue;
      let through = false;
      for (const og of others) {
        const c = og.cells[i];
        if ((c === FLOOR || c === VOID) && og.floorOf(i) < nb - 0.2 && og.ceil[i] > nb + 0.2) { through = true; break; }
      }
      if (!through) continue;
      aperture[i] = 1;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const j = i + oy * W + ox; if (cells[j] === FLOOR) edge[j] = 1; }
    }
  }
  return {layout, level, g, rng, zone, doorCell, keep: new Uint8Array(n), edge, lane: new Uint8Array(n), plaza: new Uint8Array(n), aperture, doorsOf, tx: {log: null, props: 0, depth: 0}};
}

// ---------------------------------------------------------------------------------------------
// Transactions (all-or-nothing clusters)

export function begin(ctx: PlaceCtx): number {
  if (ctx.tx.depth++ === 0) { ctx.tx.log = []; ctx.tx.props = ctx.layout.props.length; }
  return ctx.layout.props.length;
}
/** Close the outermost transaction (keeps everything placed). */
export function commit(ctx: PlaceCtx): void {
  if (--ctx.tx.depth <= 0) { ctx.tx.depth = 0; ctx.tx.log = null; }
}
/** Undo everything placed since begin() (props, blocked / sight / keep cells) and close the transaction. */
export function rollback(ctx: PlaceCtx): void {
  const log = ctx.tx.log;
  if (log) for (let k = log.length - 1; k >= 0; k--) { const [arr, i, v] = log[k]; arr[i] = v; }
  ctx.layout.props.length = ctx.tx.props;
  ctx.tx.log = null;
  ctx.tx.depth = 0;
}
function setMask(ctx: PlaceCtx, arr: Uint8Array, i: number, v: number): void {
  if (arr[i] === v) return;
  ctx.tx.log?.push([arr, i, arr[i]]);
  arr[i] = v;
}

// ---------------------------------------------------------------------------------------------
// Connectivity

let stamp = new Int32Array(0);
let stack = new Int32Array(0);
let stampCur = 0;

/** Area stays fully connected (every walkable cell reachable, every door still touched). */
export function areaConnected(ctx: PlaceCtx, area: Area): boolean {
  const g = ctx.g;
  const n = g.w * g.h;
  if (stamp.length !== n) { stamp = new Int32Array(n); stack = new Int32Array(n); stampCur = 0; }
  const id = area.id;
  const free = (i: number) => g.area[i] === id && g.cells[i] === FLOOR && g.blocked[i] === 0;
  let total = 0, start = -1;
  for (let y = Math.max(0, area.y - 1); y <= Math.min(g.h - 1, area.y + area.h); y++) {
    for (let x = Math.max(0, area.x - 1); x <= Math.min(g.w - 1, area.x + area.w); x++) {
      const i = y * g.w + x;
      if (!free(i)) continue;
      total++;
      if (start < 0) start = i;
    }
  }
  if (!total) return false;
  const cur = ++stampCur;
  stamp[start] = cur;
  let sp = 0, count = 0;
  stack[sp++] = start;
  while (sp) {
    const c = stack[--sp];
    count++;
    const nb0 = c - 1, nb1 = c + 1, nb2 = c - g.w, nb3 = c + g.w;
    if (stamp[nb0] !== cur && free(nb0)) { stamp[nb0] = cur; stack[sp++] = nb0; }
    if (stamp[nb1] !== cur && free(nb1)) { stamp[nb1] = cur; stack[sp++] = nb1; }
    if (stamp[nb2] !== cur && free(nb2)) { stamp[nb2] = cur; stack[sp++] = nb2; }
    if (stamp[nb3] !== cur && free(nb3)) { stamp[nb3] = cur; stack[sp++] = nb3; }
  }
  if (count !== total) return false;
  for (const d of ctx.doorsOf.get(id) ?? []) {
    let touch = false;
    for (let y = d.y - 1; y <= d.y + d.h && !touch; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) {
      const i = y * g.w + x;
      if (g.area[i] === id && stamp[i] === cur) { touch = true; break; }
    }
    if (!touch) return false;
  }
  return true;
}

/**
 * Fast connectivity proof: if the free cells on the ring around a footprint form a single arc,
 * blocking the footprint cannot disconnect anything (any path through it can follow the arc).
 */
function ringSafe(g: Grid, id: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const ok = (x: number, y: number) => { const i = y * g.w + x; return g.area[i] === id && g.cells[i] === FLOOR && g.blocked[i] === 0; };
  const ring: boolean[] = [];
  for (let x = x0 - 1; x <= x1 + 1; x++) ring.push(ok(x, y0 - 1));
  for (let y = y0; y <= y1 + 1; y++) ring.push(ok(x1 + 1, y));
  for (let x = x1; x >= x0 - 1; x--) ring.push(ok(x, y1 + 1));
  for (let y = y1; y >= y0; y--) ring.push(ok(x0 - 1, y));
  let rises = 0;
  for (let i = 0; i < ring.length; i++) if (ring[i] && !ring[(i + ring.length - 1) % ring.length]) rises++;
  return rises <= 1;
}

// ---------------------------------------------------------------------------------------------
// Placement

/**
 * front: clear access strip (m) in front of the prop; ring: walkway (m) kept clear all round a
 * centre island (its cells must be open floor and are reserved); y >= WALL_MOUNT_Y: wall-mounted
 * (notice boards) — reserves its cells for other props but does not block walking.
 * laneOk / plazaOk: may stand on desire-line / plaza cells (landmark islands only).
 */
export interface PlaceOpts { checkZone?: boolean; front?: number; y?: number; variant?: number; h?: number; doorOk?: boolean; ring?: number; laneOk?: boolean; plazaOk?: boolean }
export const WALL_MOUNT_Y = 0.9;

/**
 * Iteration 08 (USER-UPDATE-01, Lane I openables): kinds with doors / drawers / a drop-down front keep at least this access strip
 * (m) open in front of them over their FULL width (door swing / drawer travel never meets a column, prop or wall). Lids that lift
 * (bins, wheelie bins, chest freezers, crates) need no front strip; nothing is ever mounted over a floor prop's top except the
 * composer's deliberate mounts above tool chests / pumps / podiums, well clear of lids.
 */
export const OPENABLE_FRONT: Readonly<Record<string, number>> = {
  cabinetTall: 0.6, cabinetLow: 0.6, staffLockers: 0.6, gunLocker: 0.6, filingCabinet: 0.7, rollingToolChest: 0.6, shopCooler: 0.8,
  fridge: 0.6, newspaperVendingBox: 0.5, safe: 0.6, keyCabinet: 0.5,
};
/**
 * Iteration 08 (USER-UPDATE-01, Lane S shelf stock): stocked displays need this much space in front (m) that is not wall / rock
 * (another fixture across an aisle is fine): stock knocked off by a shotgun blast flies out, never straight into a wall.
 */
export const STOCK_OPEN_FRONT = 1.5;
export const STOCK_DISPLAY_KINDS: ReadonlySet<string> = new Set([
  'stockShelf', 'shelf', 'snackRack', 'magazineRack', 'shopCooler', 'shopDisplay', 'breadRack', 'deviceWall', 'techDisplay', 'showcase', 'flowerStand',
  'spinnerRack', 'chestFreezer',
]);

function tag(ctx: PlaceCtx, p: PropPlacement): PropPlacement {
  if (ctx.level !== 0) p.level = ctx.level;
  return p;
}

export function tryPlaceProp(ctx: PlaceCtx, area: Area, kind: PropKind, x: number, z: number, rot: number, opts: PlaceOpts = {}): PropPlacement | null {
  const g = ctx.g;
  const {hx, hz} = footprint(kind, rot);
  const def = PROP_DEFS[kind];
  const checkZone = opts.checkZone ?? true;
  const mounted = (opts.y ?? 0) >= WALL_MOUNT_Y;
  const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!g.inBounds(cx, cy)) return null;
      const i = g.idx(cx, cy);
      if (g.cells[i] !== FLOOR || g.area[i] !== area.id || g.blocked[i] || ctx.keep[i] || ctx.edge[i]) return null;
      if (ctx.doorCell[i] && !opts.doorOk) return null;
      if (checkZone && ctx.zone[i]) return null;
      if (!mounted && ((ctx.lane[i] && !opts.laneOk) || (ctx.plaza[i] && !opts.plazaOk))) return null;
    }
  }
  // Walkway ring around an island: open floor all round (reserved below).
  let ringBox: [number, number, number, number] | null = null;
  if (opts.ring) {
    const rc = Math.max(1, Math.ceil(opts.ring / CELL - 1e-6));
    ringBox = [x0 - rc, y0 - rc, x1 + rc, y1 + rc];
    for (let cy = ringBox[1]; cy <= ringBox[3]; cy++) for (let cx = ringBox[0]; cx <= ringBox[2]; cx++) {
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) continue;
      if (!g.walkable(cx, cy) || ctx.keep[g.idx(cx, cy)] && g.area[g.idx(cx, cy)] !== area.id) return null;
      if (ctx.doorCell[g.idx(cx, cy)] && g.area[g.idx(cx, cy)] !== area.id) return null;
    }
  }
  if (mounted) {
    const p: PropPlacement = {kind, x, z, y: opts.y!, rot, area: area.id, hx, hz, h: opts.h ?? def.h, blocksSight: false, variant: opts.variant ?? 0};
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) setMask(ctx, ctx.keep, g.idx(cx, cy), 1);
    ctx.layout.props.push(tag(ctx, p));
    return p;
  }
  // Access strip in front of the prop's front face must be open floor (openables: their swing / drawer strip, full width).
  let strip: [number, number, number, number] | null = null;
  const swing = OPENABLE_FRONT[kind] ?? 0;
  const fx = Math.round(Math.sin(rot)), fz = Math.round(Math.cos(rot));
  if (opts.front || swing) {
    const hd = def.d / 2, f = Math.max(opts.front ?? 0, swing);
    const hw = swing ? def.w / 2 - 0.02 : def.w / 2 * 0.8;
    const sx = x + fx * (hd + f / 2), sz = z + fz * (hd + f / 2);
    strip = cellsOfBox(sx, sz, fx ? f / 2 : hw, fz ? f / 2 : hw);
    for (let cy = strip[1]; cy <= strip[3]; cy++) for (let cx = strip[0]; cx <= strip[2]; cx++) {
      if (!g.walkable(cx, cy)) return null;
    }
  }
  // Stocked displays: no wall within 1.5 m in front.
  if (STOCK_DISPLAY_KINDS.has(kind)) {
    const hd = def.d / 2, f = STOCK_OPEN_FRONT, hw = def.w / 2 * 0.8;
    const [c0, c1, c2, c3] = cellsOfBox(x + fx * (hd + f / 2), z + fz * (hd + f / 2), fx ? f / 2 : hw, fz ? f / 2 : hw);
    for (let cy = c1; cy <= c3; cy++) for (let cx = c0; cx <= c2; cx++) if (g.get(cx, cy) === SOLID) return null;
  }
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); setMask(ctx, g.blocked, i, 1); if (def.blocksSight) setMask(ctx, g.sightBlocked, i, 1); }
  if (!ringSafe(g, area.id, x0, y0, x1, y1) && !areaConnected(ctx, area)) {
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); setMask(ctx, g.blocked, i, 0); setMask(ctx, g.sightBlocked, i, 0); }
    return null;
  }
  if (strip) for (let cy = strip[1]; cy <= strip[3]; cy++) for (let cx = strip[0]; cx <= strip[2]; cx++) setMask(ctx, ctx.keep, g.idx(cx, cy), 1);
  if (ringBox) for (let cy = ringBox[1]; cy <= ringBox[3]; cy++) for (let cx = ringBox[0]; cx <= ringBox[2]; cx++) if (g.inBounds(cx, cy) && !g.blocked[g.idx(cx, cy)]) setMask(ctx, ctx.keep, g.idx(cx, cy), 1);
  const p: PropPlacement = {kind, x, z, y: opts.y ?? 0, rot, area: area.id, hx, hz, h: opts.h ?? def.h, blocksSight: def.blocksSight, variant: opts.variant ?? 0};
  ctx.layout.props.push(tag(ctx, p));
  return p;
}

/** Collision blocker placed regardless of door zones (storefront glazing / shutters in an opening). */
export function forceProp(ctx: PlaceCtx, area: Area, kind: PropKind, x: number, z: number, hx: number, hz: number, h: number, blocksSight: boolean): PropPlacement {
  const g = ctx.g;
  const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); setMask(ctx, g.blocked, i, 1); if (blocksSight) setMask(ctx, g.sightBlocked, i, 1); }
  const p: PropPlacement = {kind, x, z, y: 0, rot: 0, area: area.id, hx, hz, h, blocksSight, variant: 0};
  ctx.layout.props.push(tag(ctx, p));
  return p;
}

/** Mark cells of a mask (lane / plaza / keep) inside the transaction log. */
export function markCell(ctx: PlaceCtx, arr: Uint8Array, i: number): void {
  setMask(ctx, arr, i, 1);
}

// ---------------------------------------------------------------------------------------------
// Doorway clearance (bucketed)

const DOOR_BUCKET = 4;
const doorCache = new WeakMap<StationLayout, {doors: number; vols: DoorClearVolume[]; buckets: Map<number, number[]>}>();
/**
 * doorways.propBlocksDoorway with the clear volumes bucketed on a 4 m XZ grid (same volumes, same answer; generation calls it
 * thousands of times). Heights are absolute (a prop on another level passes its absolute base).
 */
export function propBlocksDoorway(layout: StationLayout, x: number, z: number, hx: number, hz: number, y = 0, h = 2): DoorClearVolume | null {
  let c = doorCache.get(layout);
  if (!c || c.doors !== layout.doors.length) {
    const vols = doorClearVolumes(layout), buckets = new Map<number, number[]>();
    vols.forEach((v, i) => {
      for (let bx = Math.floor(v.x0 / DOOR_BUCKET); bx <= Math.floor(v.x1 / DOOR_BUCKET); bx++) for (let bz = Math.floor(v.z0 / DOOR_BUCKET); bz <= Math.floor(v.z1 / DOOR_BUCKET); bz++) {
        const k = bx * 65536 + bz;
        const l = buckets.get(k);
        if (l) l.push(i); else buckets.set(k, [i]);
      }
    });
    doorCache.set(layout, (c = {doors: layout.doors.length, vols, buckets}));
  }
  const box = {x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: y, y1: y + h};
  for (let bx = Math.floor(box.x0 / DOOR_BUCKET); bx <= Math.floor(box.x1 / DOOR_BUCKET); bx++) for (let bz = Math.floor(box.z0 / DOOR_BUCKET); bz <= Math.floor(box.z1 / DOOR_BUCKET); bz++) {
    for (const i of c.buckets.get(bx * 65536 + bz) ?? []) if (boxOverlap(c.vols[i], box)) return c.vols[i];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// 3D clearance, wall mounts above floor props, ceiling-hung props

const OVERLAP_EPS = 0.01;
/** A world box (local level height frame) overlaps no prop of the same level (optionally ignoring some). */
export function boxClear(ctx: PlaceCtx, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, ignore?: ReadonlySet<PropPlacement>): boolean {
  for (const p of ctx.layout.props) {
    if (propLevel(p) !== ctx.level || ignore?.has(p)) continue;
    const by0 = p.y + (p.lift ?? 0), by1 = p.y + p.h;
    if (p.x + p.hx - OVERLAP_EPS <= x0 || p.x - p.hx + OVERLAP_EPS >= x1) continue;
    if (p.z + p.hz - OVERLAP_EPS <= z0 || p.z - p.hz + OVERLAP_EPS >= z1) continue;
    if (by1 - OVERLAP_EPS <= y0 || by0 + OVERLAP_EPS >= y1) continue;
    return false;
  }
  return true;
}

/** Lowest ceiling over a footprint on the context's level grid (Infinity when unset). */
export function ceilOver(ctx: PlaceCtx, x: number, z: number, hx: number, hz: number): number {
  let c = Infinity;
  for (const [px, pz] of [[x - hx, z - hz], [x + hx, z - hz], [x - hx, z + hz], [x + hx, z + hz], [x, z]]) c = Math.min(c, ctx.g.ceilAt(px, pz));
  return c;
}

/**
 * Wall mount at height y (local frame) that may hang ABOVE a floor prop (valve manifold over a pump, CCTV over a podium):
 * wall-backed over its width at y, inside the area, under the ceiling (5 cm), clear of every prop box and of doorways.
 * Low mounts (y < 2 m) reserve their cells so later floor props do not stand into them.
 */
export function mountProp(ctx: PlaceCtx, area: Area, side: Side, t: number, kind: PropKind, y: number, base: number): PropPlacement | null {
  const def = PROP_DEFS[kind];
  const rot = WALL_ROT[side];
  const {hx, hz} = footprint(kind, rot);
  const [x, z] = wallXZ(area, side, t, def.d / 2 + 0.03);
  const g = ctx.g;
  if (!backed(ctx, area, side, t - def.w / 2, t + def.w / 2, base + y)) return null;
  const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (!g.inBounds(cx, cy)) return null;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR || g.area[i] !== area.id || ctx.doorCell[i] || ctx.edge[i]) return null;
  }
  if (ceilOver(ctx, x, z, hx, hz) - base < y + def.h + 0.05) return null;
  if (!boxClear(ctx, x - hx, x + hx, y, y + def.h, z - hz, z + hz)) return null;
  if (propBlocksDoorway(ctx.layout, x, z, hx, hz, base + y, def.h)) return null;
  const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r2(y), rot, area: area.id, hx, hz, h: def.h, blocksSight: false, variant: 0, mounted: true};
  if (y < 2) for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) setMask(ctx, ctx.keep, g.idx(cx, cy), 1);
  ctx.layout.props.push(tag(ctx, p));
  return p;
}

/** Ceiling-hung prop (clock): top 2 cm under the local ceiling, >= 2.2 m headroom, >= 1.5 m from fixtures and hung signs. */
export function hangProp(ctx: PlaceCtx, area: Area, kind: PropKind, x: number, z: number, rot: number, base: number): PropPlacement | null {
  const def = PROP_DEFS[kind];
  const {hx, hz} = footprint(kind, rot);
  const g = ctx.g;
  const [cx, cy] = g.cellOf(x, z);
  if (!g.inBounds(cx, cy) || g.area[g.idx(cx, cy)] !== area.id || g.cells[g.idx(cx, cy)] !== FLOOR || g.rampIdx[g.idx(cx, cy)] >= 0) return null;
  // Area ceilings are absolute (outside stationDress's local-frame dressing of other levels).
  const ceil = Math.min(ceilOver(ctx, x, z, hx, hz), area.ceil);
  const y = Math.round((ceil - base - def.h - 0.02) * 100) / 100;
  if (!Number.isFinite(y) || y < 2.2) return null;
  for (const l of ctx.layout.lights) if (l.area === area.id && Math.hypot(l.x - x, l.z - z) < 1.5) return null;
  for (const s of ctx.layout.signs) if (s.area === area.id && s.hang && Math.hypot(s.x - x, s.z - z) < 1.5) return null;
  if (!boxClear(ctx, x - hx, x + hx, y, y + def.h, z - hz, z + hz)) return null;
  if (propBlocksDoorway(ctx.layout, x, z, hx, hz, base + y, def.h)) return null;
  const p: PropPlacement = {kind, x: r3(x), z: r3(z), y, rot, area: area.id, hx, hz, h: def.h, blocksSight: false, variant: 0, mounted: true};
  ctx.layout.props.push(tag(ctx, p));
  return p;
}

// ---------------------------------------------------------------------------------------------
// Walls and doors

export const OPPOSITE: Record<Side, Side> = {N: 'S', S: 'N', W: 'E', E: 'W'};
/** Facing (yaw) of a prop with its back to a wall. */
export const WALL_ROT: Record<Side, number> = {N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2};
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** World XZ of a point `t` along a wall of `a`, `off` metres in from its face. */
export function wallXZ(a: Area, side: Side, t: number, off: number): [number, number] {
  if (side === 'N') return [t, a.y * CELL + off];
  if (side === 'S') return [t, (a.y + a.h) * CELL - off];
  if (side === 'W') return [a.x * CELL + off, t];
  return [(a.x + a.w) * CELL - off, t];
}

/** Position for a prop with its back against one wall of the area; `t` = world coordinate along the wall. */
export function wallSpot(area: Area, side: Side, t: number, kind: PropKind): {x: number; z: number; rot: number} {
  const d = PROP_DEFS[kind].d, gap = 0.03;
  const ax0 = area.x * CELL, az0 = area.y * CELL, ax1 = (area.x + area.w) * CELL, az1 = (area.y + area.h) * CELL;
  if (side === 'N') return {x: t, z: az0 + d / 2 + gap, rot: 0};
  if (side === 'S') return {x: t, z: az1 - d / 2 - gap, rot: Math.PI};
  if (side === 'W') return {x: ax0 + d / 2 + gap, z: t, rot: Math.PI / 2};
  return {x: ax1 - d / 2 - gap, z: t, rot: -Math.PI / 2};
}

export function wallRange(area: Area, side: Side): [number, number] {
  return side === 'N' || side === 'S' ? [area.x * CELL, (area.x + area.w) * CELL] : [area.y * CELL, (area.y + area.h) * CELL];
}

/**
 * Wall backing on the context's level: doorways.wallBacked (solid wall, or a lintel below `yb`, absolute) AND no aperture
 * (light well / stairwell edge) behind the span — a plate or a prop is never "backed" by a railing over a drop.
 */
export function backed(ctx: PlaceCtx, area: Area, side: Side, t0: number, t1: number, yb: number): boolean {
  if (!wallBacked(ctx.g, area, side, t0, t1, yb)) return false;
  const alongX = side === 'N' || side === 'S';
  const behind = side === 'N' ? area.y - 1 : side === 'S' ? area.y + area.h : side === 'W' ? area.x - 1 : area.x + area.w;
  for (let c = Math.floor(t0 / CELL + 1e-6); c <= Math.ceil(t1 / CELL - 1e-6) - 1; c++) {
    const [x, y] = alongX ? [c, behind] : [behind, c];
    if (ctx.g.inBounds(x, y) && ctx.aperture[ctx.g.idx(x, y)]) return false;
  }
  return true;
}

/** Random spot against a random (or given) wall. */
export function placeAgainstWall(ctx: PlaceCtx, area: Area, kind: PropKind, opts: PlaceOpts & {sides?: Side[]; tries?: number} = {}): PropPlacement | null {
  const def = PROP_DEFS[kind];
  const sides = opts.sides ?? ['N', 'S', 'W', 'E'];
  for (let t = 0; t < (opts.tries ?? 14); t++) {
    const side = ctx.rng.pick(sides);
    const [lo, hi] = wallRange(area, side);
    if (hi - lo < def.w + 0.3) continue;
    const along = Math.round(ctx.rng.range(lo + def.w / 2 + 0.1, hi - def.w / 2 - 0.1) * 4) / 4;
    const s = wallSpot(area, side, along, kind);
    const p = tryPlaceProp(ctx, area, kind, s.x, s.z, s.rot, opts);
    if (p) return p;
  }
  return null;
}

/**
 * A row of props side by side against one wall (vending banks, shelving runs, ticket machines).
 * Clusters of `cluster` units separated by `gap` metres; skips doors/zones. Returns placements.
 */
export function rowAlongWall(ctx: PlaceCtx, area: Area, side: Side, kind: PropKind, o: {from?: number; to?: number; cluster?: number; gap?: number; max?: number; front?: number; variant?: () => number} = {}): PropPlacement[] {
  const def = PROP_DEFS[kind];
  const [lo, hi] = wallRange(area, side);
  const from = Math.max(lo + 0.4, o.from ?? lo + 0.4), to = Math.min(hi - 0.4, o.to ?? hi - 0.4);
  const out: PropPlacement[] = [];
  let t = from + def.w / 2, inCluster = 0;
  while (t + def.w / 2 <= to && out.length < (o.max ?? 99)) {
    const s = wallSpot(area, side, t, kind);
    const p = tryPlaceProp(ctx, area, kind, s.x, s.z, s.rot, {front: o.front, variant: o.variant?.()});
    if (p) {
      out.push(p);
      inCluster++;
      t += def.w + 0.02;
      if (o.cluster && inCluster >= o.cluster) { t += o.gap ?? 1; inCluster = 0; }
    } else {
      t += 0.5;
      inCluster = 0;
    }
  }
  return out;
}

/** Which wall of `area` a door sits in. */
export function doorSide(d: Door, area: Area): Side {
  if (d.h === 1 && d.w > 1) return d.y < area.y ? 'N' : 'S';
  if (d.w === 1 && d.h > 1) return d.x < area.x ? 'W' : 'E';
  return d.y < area.y ? 'N' : d.y >= area.y + area.h ? 'S' : d.x < area.x ? 'W' : 'E';
}

/** The door a room is entered by (towards its parent), else its first door. */
export function mainDoor(ctx: PlaceCtx, a: Area): Door | undefined {
  const ds = ctx.doorsOf.get(a.id) ?? [];
  return ds.find(d => d.a === a.parent || d.b === a.parent) ?? ds[0];
}

/** Wall side a wall-backed prop stands against (from its yaw), or null. */
export function sideOfRot(rot: number): Side {
  const q = ((Math.round(rot / (Math.PI / 2)) % 4) + 4) % 4;
  return q === 0 ? 'N' : q === 1 ? 'W' : q === 2 ? 'S' : 'E';
}
