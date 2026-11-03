// Task mall-lingerie-20261102 (lane STORE) / store-polish-20261103 (lane STORE): THE LINGERIE BOUTIQUE'S CHANGING SUITE and its display
// stock — pure data (no three.js), deterministic per shop (the shop's own dressing fork).
//
// User (polish, 2026-11-03): "The chaining rooms are like boxes placed in the store. This looks bad, It should be built, with normal walls,
// as like an actually ROOM in the store!" — the first version's free-standing booth panels are gone. The changing SUITE is now carved into
// the shop's own grid with the mall's normal wall / doorway system (the same primitives as gen/stationKit.ts carveDoor and the carver's
// stock rooms: SOLID wall cells one cell (0.5 m) thick, full height to the shop ceiling; openings = framed doorways (layout.doors, lowered
// cell ceiling = the lintel). World/builder then draws the walls with the shop's finish, the door frames in the mall trim, and nav /
// collision / hitscan / sight follow the grid like every other wall. Laid against one solid wall (the back wall first, else a side wall
// behind the shopfront):
//
//      wall #####################################
//      row 0-2   [ CORRIDOR 1.5 m (the stock-room door may open onto it) ]#
//      row 3     ###DD#####DD#####DD######        #     <- room doors (2 cells: 0.82 m clear between the jambs)
//      row 4-7   #  room  #  room  #  room  # pass#        3 x 4 cells each (1.5 x 2.0 m): bench + mirror on the back wall
//      row 8     ###########################[ DOOR ]#     <- the suite's doorway from the sales floor (3 cells: 1.32 m clear)
//                                     sales floor
//
// - CHANGING_SUITE: rooms of 3 x 4 free cells (1.5 m wide, 2.0 m deep: 1.5 x 1.5 m free in front of the bench), one-cell walls between
//   them, a 1.5 m corridor along the wall (1.0 m in a unit under 11 m deep) closed by the side wall at its far end, the passage beside the
//   last room with the suite's doorway onto the sales floor. 3 rooms (4 where the wall is >= 12 m: end units). The suite is 4n + 4 cells
//   along the wall, 9 cells (4.5 m) deep (8: 4.0 m with the narrow corridor).
// - Every cell is validated first (sales floor, free, off stair / lane cells and door zones — the corridor may take the stock-room door —,
//   a real wall / the shop's own stock-room door behind the corridor and beside the closed end, >= CHANGING_SUITE.frontClear from the
//   shopfront); then the walls / doorways are carved, the room furniture placed and every free suite cell reserved (keep); the shop's
//   connectivity is verified (placeKit.areaConnected) or the carve is undone.
// - The suite stays part of the SALES AREA (one area id: same purpose `mall-lingerie`, finish, lights, loot): its doors join the sales area
//   to itself (Door a = b = the sales floor) — real framed openings in real walls, no new Area records (every area-indexed table and draw
//   of the generator is unchanged).
// - Lane CONTEXT contract: MallShop.changing = world rects of every room's free floor (in front of its bench, beside its mirror: the two
//   doorway columns, 1.0 x 1.5 m), then the corridor LAST;
//   MallShop.changingEntry = the suite doorway's centre on the sales-floor side.

import {CELL, FLOOR, SOLID} from '../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../props';
import {areaBase, areaConnected, forceProp, markCell, tryPlaceProp} from '../placeKit';
import {DOOR_HEIGHT, type Door, type Side} from '../stationTypes';
import type {MallShop} from './mallTypes';
import {GARMENT_RAIL_Y, LINGERIE_RACK, LINGERIE_SET_KINDS, LINGERIE_SET_Y0} from './kinds';
import {frameOf, uvXZ, xzUV, type ShopDresser, type ShopFrame} from './shopsDress';
import {LINGERIE_BUILD} from '../../ai/lingerie.generated'; // lane FIT's build table (pure data): the stock's node names / sizes

/** Changing-suite geometry (cells of 0.5 m unless noted). */
export const CHANGING_SUITE = {
  /** Corridor rows along the wall: 1.5 m, or 1.0 m in a shallow unit (sales depth below `wideFrom` m) so its sales floor stays shoppable. */
  corridorRows: 3,
  corridorRowsShallow: 2,
  wideFrom: 11,
  /** Room interior: columns (1.5 m) x rows (2.0 m, the bench row included). */
  roomCols: 3,
  roomRows: 4,
  /** Room doorway width (cells) and the suite doorway from the sales floor. */
  roomDoor: 2,
  entryDoor: 3,
  /** Rooms: 3, or 4 on a wall of at least `fourFrom` cells (12 m). */
  rooms: 3,
  fourFrom: 24,
  /** No suite cell closer than this to the shopfront (m, depth from the frontage; lane CONTEXT keeps its spawns >= 4 m off it). */
  frontClear: 4.0,
} as const;
/** Suite depth in cells: corridor + door wall + rooms + front wall (4.5 m; 4.0 m with the shallow unit's corridor). */
export const suiteRows = (corridor: number = CHANGING_SUITE.corridorRows) => corridor + 1 + CHANGING_SUITE.roomRows + 1;
/** Suite length along the wall in cells for n rooms: (room + wall) x n + the passage + its end wall. */
export const suiteCols = (n: number) => (CHANGING_SUITE.roomCols + 1) * n + CHANGING_SUITE.entryDoor + 1;

export interface ChangingRect { x0: number; z0: number; x1: number; z1: number }
export interface ChangingSuite {
  /** The wall the corridor runs along, and which way the rooms run from its closed corner (+1: toward +u of the zone frame). */
  wall: Side;
  dir: 1 | -1;
  rooms: number;
  /** World rects of each room's free floor (in front of its bench, beside its mirror strip; from the closed corner), then the corridor. */
  rects: ChangingRect[];
  roomRects: ChangingRect[];
  corridor: ChangingRect;
  /** Centre of the suite doorway on the sales-floor side (world m). */
  entry: {x: number; z: number};
  /** The suite's footprint (world rect, walls included). */
  zone: ChangingRect;
  /** The doorways carved (layout.doors entries: the rooms', then the suite's). */
  doors: Door[];
  props: PropPlacement[];
}

const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Carves the changing suite into `d`'s sales floor (before the rest of the boutique): the back wall first, then the side walls (seeded
 * order), the suite's doorway toward the shop's entry first. Records the rects on `shop` (MallShop.changing / changingEntry). Returns null
 * (nothing carved) when no wall takes it.
 */
export function placeChangingSuite(d: ShopDresser, shop?: MallShop): ChangingSuite | null {
  const fr = d.fr;
  const sides = d.rng.chance(0.5) ? [fr.L, fr.R] : [fr.R, fr.L];
  for (const wall of [fr.back, ...sides]) {
    const Z = wall === fr.back ? fr : frameOf(d.a, OPP[wall]);
    const cols = Math.round(Z.W / CELL);
    const entryMid = (fr.entry[0] + fr.entry[1]) / 2;
    const dirs: (1 | -1)[] = wall === fr.back ? (entryMid >= fr.W / 2 ? [1, -1] : [-1, 1]) : [1, -1];
    const ns = cols >= CHANGING_SUITE.fourFrom ? [4, 3] : [3];
    const corridor = fr.D < CHANGING_SUITE.wideFrom ? CHANGING_SUITE.corridorRowsShallow : CHANGING_SUITE.corridorRows;
    for (const n of ns) for (const dir of dirs) {
      const r = trySuite(d, Z, wall, dir, n, corridor, shop);
      if (r) {
        if (shop) { shop.changing = r.rects.map(q => ({...q})); shop.changingEntry = {...r.entry}; }
        return r;
      }
    }
  }
  return null;
}

/** One candidate: n rooms along `wall` (zone frame Z: its back = the wall), the closed corner at u = 0 (dir 1) or u = W (dir -1). */
function trySuite(d: ShopDresser, Z: ShopFrame, wall: Side, dir: 1 | -1, n: number, corridor: number, shop?: MallShop): ChangingSuite | null {
  const ctx = d.ctx, g = ctx.g, a = d.a, S = CHANGING_SUITE;
  const width = suiteCols(n), rows = suiteRows(corridor);
  if (width > Math.round(Z.W / CELL) || Math.round(Z.D / CELL) < rows + 4) return null;
  // zone cell (c, r): column c from the closed corner along the wall, row r from the wall (r = -1: the wall row behind the corridor)
  const uOf = (c: number) => (dir > 0 ? (c + 0.5) * CELL : Z.W - (c + 0.5) * CELL);
  const vOf = (r: number) => Z.D - (r + 0.5) * CELL;
  const cell = (c: number, r: number): number => {
    const [x, z] = uvXZ(Z, uOf(c), vOf(r));
    const [cx, cy] = g.cellOf(x, z);
    return g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
  };
  const doorRow = corridor, room0 = doorRow + 1, frontRow = rows - 1;
  const pass0 = (S.roomCols + 1) * n, endCol = width - 1; // passage columns pass0 .. pass0 + entryDoor - 1, then the end wall
  /** what a suite cell becomes: wall / room door / suite door / free floor */
  const inRoomCols = (c: number) => c < pass0 && c % (S.roomCols + 1) < S.roomCols;
  const roomDoorCol = (c: number) => inRoomCols(c) && c % (S.roomCols + 1) >= S.roomCols - S.roomDoor; // the 2 cells toward the passage
  const kindOf = (c: number, r: number): 'wall' | 'roomDoor' | 'entry' | 'floor' => {
    if (r < doorRow) return c === endCol ? 'wall' : 'floor';
    if (c === endCol) return 'wall';
    if (c >= pass0) return r === frontRow ? 'entry' : 'floor'; // the passage, its doorway in the front wall
    if (!inRoomCols(c)) return 'wall'; // separators
    if (r === doorRow) return roomDoorCol(c) ? 'roomDoor' : 'wall';
    return r === frontRow ? 'wall' : 'floor';
  };
  const backroom = shop?.backroom;
  const own = (i: number) => i >= 0 && g.cells[i] === FLOOR && g.area[i] === a.id;
  const free = (i: number) => own(i) && !g.blocked[i] && !ctx.edge[i] && !ctx.lane[i] && !ctx.plaza[i] && !ctx.keep[i];
  const wallOk = (i: number) => i < 0 || g.cells[i] !== FLOOR || (backroom !== undefined && g.area[i] === backroom);
  for (let c = 0; c < width; c++) {
    if (!wallOk(cell(c, -1))) return null;
    for (let r = 0; r <= rows; r++) {
      const i = cell(c, r);
      if (r === rows) { if (c >= pass0 && c < endCol && !free(i)) return null; continue; } // the approach to the suite doorway
      const [x, z] = uvXZ(Z, uOf(c), vOf(r));
      if (xzUV(d.fr, x, z)[1] < S.frontClear) return null;
      if (!free(i)) return null;
      // only the corridor may take an existing doorway's zone (the stock-room door opens onto it); walls never touch a doorway
      if ((r >= doorRow || kindOf(c, r) === 'wall') && (ctx.doorCell[i] || (r >= doorRow && ctx.zone[i]))) return null;
    }
  }
  for (let r = 0; r < rows; r++) if (!wallOk(cell(-1, r))) return null;

  // --- carve: walls SOLID, doorways = lowered ceilings + door records (undone when the shop would lose its connectivity) ---------------
  const base = areaBase(d.layout, a), lv = a.level ?? 0;
  const saved: [number, number, number, number, number][] = [];
  const set = (i: number, cells: number, area: number, ceil: number, floor: number) => { saved.push([i, g.cells[i], g.area[i], g.ceil[i], g.floor[i]]); g.cells[i] = cells; g.area[i] = area; g.ceil[i] = ceil; g.floor[i] = floor; };
  const doorH = Math.min(DOOR_HEIGHT, a.ceil - base);
  for (let c = 0; c < width; c++) for (let r = 0; r < rows; r++) {
    const i = cell(c, r), k = kindOf(c, r);
    if (k === 'wall') set(i, SOLID, -1, 0, 0);
    else if (k === 'roomDoor' || k === 'entry') set(i, FLOOR, a.id, base + doorH, g.floor[i]);
  }
  const doors: Door[] = [];
  const doorRect = (c0: number, c1: number, r: number) => {
    const p0 = uvXZ(Z, uOf(c0), vOf(r)), p1 = uvXZ(Z, uOf(c1), vOf(r));
    const [x0, y0] = g.cellOf(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1])), [x1, y1] = g.cellOf(Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]));
    return {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1};
  };
  const addDoor = (c0: number, c1: number, r: number) => {
    const dr: Door = {...doorRect(c0, c1, r), id: d.layout.doors.length + doors.length, a: a.id, b: a.id, height: doorH, arch: false, ...(lv ? {level: lv} : {})};
    doors.push(dr);
  };
  for (let k = 0; k < n; k++) { const c0 = (S.roomCols + 1) * k + S.roomCols - S.roomDoor; addDoor(c0, c0 + S.roomDoor - 1, doorRow); }
  addDoor(pass0, pass0 + S.entryDoor - 1, frontRow);
  if (!areaConnected(ctx, a)) {
    for (let k = saved.length - 1; k >= 0; k--) { const [i, cells, area, ceil, floor] = saved[k]; g.cells[i] = cells; g.area[i] = area; g.ceil[i] = ceil; g.floor[i] = floor; }
    return null;
  }
  d.layout.doors.push(...doors);
  const list = ctx.doorsOf.get(a.id) ?? [];
  list.push(...doors);
  ctx.doorsOf.set(a.id, list);
  // door cells / zones for the later placements (makePlaceCtx built them before these doors existed)
  for (const dr of doors) for (let y = dr.y - 2; y < dr.y + dr.h + 2; y++) for (let x = dr.x - 2; x < dr.x + dr.w + 2; x++) {
    if (!g.inBounds(x, y)) continue;
    const i = g.idx(x, y);
    markCell(ctx, ctx.zone, i);
    if (y >= dr.y - 1 && y <= dr.y + dr.h && x >= dr.x - 1 && x <= dr.x + dr.w) markCell(ctx, ctx.doorCell, i);
  }
  // --- furniture: per room a built-in bench against its back wall and a full-length mirror on its side wall (the side away from its
  // doorway, by the bench). The mirror's 0.5 m strip of floor is kept off the nav grid (the mirror itself is a 2 cm panel the player can
  // stand at): no room then offers the 3 x 3 clear floor an ambient spawn needs — the rooms are the store-local variants' (lane CONTEXT) ---
  const props: PropPlacement[] = [];
  const BE = PROP_DEFS.fittingBench, MI = PROP_DEFS.fittingMirror;
  const alongX = Z.side === 'N' || Z.side === 'S';
  const vBack = Z.D - frontRow * CELL; // the rooms' back wall face (the wall row toward the sales floor)
  const towardC = dir > 0 ? Z.plusU : Z.minusU;
  for (let k = 0; k < n; k++) {
    const c0 = (S.roomCols + 1) * k, um = (c0 + S.roomCols / 2) * CELL;
    const [bx, bz] = uvXZ(Z, dir > 0 ? um : Z.W - um, vBack + BE.d / 2 + 0.01);
    const bench = tryPlaceProp(ctx, a, 'fittingBench', r3(bx), r3(bz), Z.inward, {checkZone: false});
    if (bench) { props.push(bench); d.placed.push(bench); }
    // the mirror on the wall at the room's first column (c0: its wall is the previous separator / the closed corner's side wall), over
    // the two rows in front of the bench
    const uM = c0 * CELL + MI.d / 2 + 0.005, vM = vBack + 2 * CELL;
    const [mx, mz] = uvXZ(Z, dir > 0 ? uM : Z.W - uM, vM);
    const mirror = forceProp(ctx, a, 'fittingMirror', r3(mx), r3(mz), r3(alongX ? MI.d / 2 : MI.w / 2), r3(alongX ? MI.w / 2 : MI.d / 2), MI.h, false);
    mirror.rot = towardC;
    props.push(mirror); d.placed.push(mirror);
    for (const r of [frontRow - 1 - 1, frontRow - 1 - 2]) { const i = cell(c0, r); if (own(i)) markCell(ctx, g.blocked, i); }
  }
  // reserve every free suite cell (and the doorway's approach) so no sales-floor fixture lands in the suite
  const keepCell = (i: number) => { if (own(i) && !g.blocked[i]) markCell(ctx, ctx.keep, i); };
  for (let c = 0; c < width; c++) for (let r = 0; r <= rows; r++) if (r < rows ? kindOf(c, r) !== 'wall' : c >= pass0 && c < endCol) keepCell(cell(c, r));
  // --- records -----------------------------------------------------------------------------------------------------------------------
  /** World rect of the zone cell block [c0..c1] x [r0..r1]. */
  const rectOf = (c0: number, c1: number, r0: number, r1: number): ChangingRect => {
    const ua = dir > 0 ? c0 * CELL : Z.W - (c1 + 1) * CELL, ub = dir > 0 ? (c1 + 1) * CELL : Z.W - c0 * CELL;
    const va = Z.D - (r1 + 1) * CELL, vb = Z.D - r0 * CELL;
    const [xa, za] = uvXZ(Z, ua, va), [xb, zb] = uvXZ(Z, ub, vb);
    return {x0: r3(Math.min(xa, xb)), z0: r3(Math.min(za, zb)), x1: r3(Math.max(xa, xb)), z1: r3(Math.max(za, zb))};
  };
  // a room's free floor: its columns, from the door row's inside to the bench row (exclusive)
  // a room's free floor in front of its bench, beside the mirror strip: its two doorway columns (1.0 x 1.5 m)
  const roomRects = Array.from({length: n}, (_, k) => rectOf((S.roomCols + 1) * k + 1, (S.roomCols + 1) * k + S.roomCols - 1, room0, frontRow - 2));
  const corridorRect = rectOf(0, endCol - 1, 0, doorRow - 1);
  const uE = (pass0 + S.entryDoor / 2) * CELL;
  const [ex, ez] = uvXZ(Z, dir > 0 ? uE : Z.W - uE, Z.D - rows * CELL);
  return {wall, dir, rooms: n, rects: [...roomRects, corridorRect], roomRects, corridor: corridorRect, entry: {x: r3(ex), z: r3(ez)}, zone: rectOf(0, width - 1, 0, rows - 1), doors, props};
}

// ---------------------------------------------------------------------------------------------
// Display stock: the six lingerie sets dressed on the female mannequins, hanging stock on the rails / racks / clothing bays

/** The designs in lane FIT's LINGERIE_SETS order (green, purple, blush, black, red, ivory). */
export const LINGERIE_DESIGNS = Object.keys(LINGERIE_SET_KINDS) as (keyof typeof LINGERIE_SET_KINDS)[];
const designAt = (k: number) => LINGERIE_DESIGNS[((k % LINGERIE_DESIGNS.length) + LINGERIE_DESIGNS.length) % LINGERIE_DESIGNS.length];

/** Dresses a female mannequin with the set of `design` (index into LINGERIE_DESIGNS): a rider sharing its x / z / yaw. */
export function dressMannequin(d: ShopDresser, host: PropPlacement, design: number): PropPlacement | null {
  const hi = d.layout.props.indexOf(host);
  if (hi < 0 || host.kind !== 'mannequinFemale') return null;
  const kind = LINGERIE_SET_KINDS[designAt(design)];
  const def = PROP_DEFS[kind];
  const quarter = Math.round(host.rot / (Math.PI / 2)) & 1;
  const p: PropPlacement = {kind, x: host.x, z: host.z, y: host.y + LINGERIE_SET_Y0, rot: host.rot, area: host.area, hx: r3((quarter ? def.d : def.w) / 2), hz: r3((quarter ? def.w : def.d) / 2),
    h: def.h, blocksSight: false, variant: 0, host: hi, ...(host.level ? {level: host.level} : {})};
  d.layout.props.push(p);
  d.placed.push(p);
  return p;
}

/**
 * Hangs lingerie stock on a rail host (garmentRail / clothingWallUnit: a face-out row; garmentRailRound: round the ring): a rider whose box
 * is the hung stock (top on the rail line, LINGERIE_RACK.drop below), `variant` = the stock code (rackStock: two designs + a pattern seed).
 */
export function hangLingerie(d: ShopDresser, host: PropPlacement, code: number): PropPlacement | null {
  const hi = d.layout.props.indexOf(host);
  const rail = GARMENT_RAIL_Y[host.kind as keyof typeof GARMENT_RAIL_Y];
  const rowHalf = LINGERIE_RACK.row[host.kind as keyof typeof LINGERIE_RACK.row], ring = LINGERIE_RACK.ring[host.kind as keyof typeof LINGERIE_RACK.ring];
  if (hi < 0 || rail === undefined || (rowHalf === undefined && ring === undefined)) return null;
  const kind: PropKind = ring !== undefined ? 'lingerieRackRing' : 'lingerieRackRow';
  const quarter = Math.round(host.rot / (Math.PI / 2)) & 1;
  const w = ring !== undefined ? 2 * ring + 0.1 : 2 * rowHalf! + 0.1, dd = ring !== undefined ? 2 * ring + 0.1 : PROP_DEFS.lingerieRackRow.d;
  const p: PropPlacement = {kind, x: host.x, z: host.z, y: host.y + r3(rail - LINGERIE_RACK.drop), rot: host.rot, area: host.area,
    hx: r3((quarter ? dd : w) / 2), hz: r3((quarter ? w : dd) / 2), h: LINGERIE_RACK.drop, blocksSight: false, variant: code, host: hi,
    ...(host.level ? {level: host.level} : {})};
  d.layout.props.push(p);
  d.placed.push(p);
  return p;
}

/** A rail's stock code: designs A / B (0..5) and a pattern seed (0..9999). */
export const rackCode = (a: number, b: number, seed: number) => (((a % 6) + 6) % 6) + 6 * (((b % 6) + 6) % 6) + 36 * (Math.abs(Math.floor(seed)) % 10000);
/** The designs and seed of a rail's stock code. */
export function rackStock(code: number): {a: (typeof LINGERIE_DESIGNS)[number]; b: (typeof LINGERIE_DESIGNS)[number]; seed: number} {
  return {a: designAt(code % 6), b: designAt(Math.floor(code / 6) % 6), seed: Math.floor(code / 36)};
}

// ---------------------------------------------------------------------------------------------
// Lane FIT seam (polish, 2026-11-03; lane FIT 31772e0): in each `outfit-lingerie-<design>.glb` (prop-library key = its LINGERIE_BUILD model,
// lane FIT's LINGERIE_MODEL_FILES — the SAME files the store-local zombies wear: no extra bytes), unskinned static nodes:
//  - LingerieMannequin_<design>_top / _bottom: the set fitted offline to the female mannequin's mesh, in the mannequin model's LOCAL frame
//    (identity node transform): drawn under the mannequin prop's exact runtime transform;
//  - LingerieHang_<design>_<item>: one hanging item each (lace garment + its hanger, the hanger the last primitive), origin = the hook's
//    contact point on the rail, +Y up, the garment's front +Z, hanger width along x; the one-piece blush set hangs whole.
// The data (node names, drops, widths, spacings) is lane FIT's generated build table (ai/lingerie.generated.ts: pure data).
// World/mallLingerieDisplay.ts renders both; until the files are in the prop library the riders draw their procedural stand-ins.

const BUILD = (design: string) => LINGERIE_BUILD.find(s => s.design === design);
export const LINGERIE_DISPLAY_SOURCE = {
  /** Prop-library key of a design's outfit file (lane FIT's LINGERIE_MODEL_FILES key). */
  modelKey: (design: string) => BUILD(design)?.model ?? `outfit_lingerie_${design}`,
  /** The mannequin-fitted set nodes of a design (blush as two halves: whichever exist render). */
  mannequinNodes: (design: string) => { const b = BUILD(design); return b ? [b.mannequin.top, b.mannequin.bottom] : []; },
  /** The hanging items of a design (top / bottom, or the whole set): node name, drop / width (m), side-on pitch along a rail (m). */
  hangItems: (design: string): readonly {node: string; item: string; dropM: number; widthM: number; spacingSideOnM: number; spacingFaceOutM: number}[] => BUILD(design)?.hang ?? [],
  /** The female mannequin's model key (the set nodes share its runtime transform). */
  mannequinModelKey: 'office-mannequin-female',
} as const;

/** The design of a lingerie set kind (undefined for any other kind). */
export function lingerieSetDesign(kind: string): (typeof LINGERIE_DESIGNS)[number] | undefined {
  return LINGERIE_DESIGNS.find(k => LINGERIE_SET_KINDS[k] === kind);
}
/** Game.sectionModelKeys hook: the outfit files whose display / hanging meshes the layout's lingerie store shows (the designs placed). */
export function lingerieDisplayModelKeys(layout: {props: readonly {kind: string; variant?: number}[]}): string[] {
  const s = new Set<string>();
  for (const p of layout.props) {
    const d = lingerieSetDesign(p.kind);
    if (d) s.add(LINGERIE_DISPLAY_SOURCE.modelKey(d));
    if (p.kind === 'lingerieRackRow' || p.kind === 'lingerieRackRing') { const r = rackStock(p.variant ?? 0); s.add(LINGERIE_DISPLAY_SOURCE.modelKey(r.a)); s.add(LINGERIE_DISPLAY_SOURCE.modelKey(r.b)); }
  }
  return [...s].sort();
}
