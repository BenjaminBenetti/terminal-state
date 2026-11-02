// Task mall-lingerie-20261102 (lane STORE): THE LINGERIE BOUTIQUE'S WALK-IN CHANGING AREA and its display stock — pure data (no three.js),
// deterministic per shop (the shop's own dressing fork).
//
// User (scope): "Revisit the Mall for one new women's lingerie store: it must occupy a LARGE store spot only, never a small one ... Make the
// store match its theme with a large fitting/changing area." The womenswear store's `fittingRooms` is a solid 2.4 x 1.5 m block; this is
// a real walk-in area on the shop's 0.5 m grid, laid against one solid wall (the back wall first, else a side wall behind the shopfront):
//
//      wall ##################################################
//      row 0-2   [ the booth AISLE, 1.5 m: the stock-room door may open onto it ] [ turn ]
//      row 3-5   P  booth  P  booth  P  booth  P  booth  P     [ opening ]   <- curtain gathered beside the next partition,
//      row 6     P==bench==P==bench==P==bench==P==bench==P     [  1.5 m  ]      a full-length mirror on the partition face
//                        (booth back panels: the changing area's wall to the sales floor)
//                                      sales floor
//
// - CHANGING.pitch: one booth = a partition column + two free columns (1.44 m clear between the panels); n = 4..6 booths (as many as the
//   wall takes), n + 1 partitions (2.0 m: the booth depth + the back row), a back panel + a built-in bench per booth in the back row,
//   a full-length mirror on the partition face inside each booth and its curtain gathered open beside the other partition (the rail
//   runs overhead across the opening: the 1.0 m nav opening of every booth stays clear).
// - Free floor: each booth 2 x 3 cells (1.0 x 1.5 m nav, ~1.44 x 1.5 m between the panels); the aisle 3 cells (1.5 m >= 1.2 m) along
//   the booths, closed by the side wall at its far end; the OPENING from the sales floor is the 3-cell (1.5 m) gap past the last
//   partition, open to the aisle's end (you look straight down the aisle from the turn). Every free cell is reserved (keep) so no later
//   fixture lands in the changing area; the room's connectivity is verified (placeKit.areaConnected) or the attempt is rolled back.
// - The pieces are placed with placeKit.forceProp after this planner has validated every cell itself (floor of the sales area, free,
//   off door / stair / lane cells, a solid wall behind the aisle — or the shop's own stock-room door —, >= CHANGING.frontClear from the
//   shopfront): the thin panels share their 0.5 m cell column with the mirror / curtain / bench, which tryPlaceProp's one-prop-per-cell
//   rule would refuse. Colliders are the real panels / bench (no invisible box over the bench).
// - Lane CONTEXT contract: MallShop.changing = world rects of every booth's free floor + the aisle along the booths (not the turn in front
//   of the opening); MallShop.changingEntry = the opening's centre on the sales-floor side.

import {CELL, FLOOR} from '../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../props';
import {areaConnected, begin, commit, forceProp, markCell, rollback} from '../placeKit';
import type {Side} from '../stationTypes';
import type {MallShop} from './mallTypes';
import {LINGERIE_SET_KINDS, LINGERIE_SET_Y0} from './kinds';
import {frameOf, uvXZ, xzUV, type ShopDresser, type ShopFrame} from './shopsDress';

/** Changing-area geometry (cells of 0.5 m unless noted). */
export const CHANGING = {
  /** Aisle rows along the wall (1.5 m: >= 1.2 m clear). */
  aisleRows: 3,
  /** Free standing rows of a booth (1.5 m deep in front of its bench). */
  boothRows: 3,
  /** Booth pitch along the wall: one partition column + two free columns (1.5 m centre to centre). */
  pitch: 3,
  /** The opening from the sales floor past the last partition (1.5 m). */
  entryCols: 3,
  minBooths: 4,
  maxBooths: 6,
  /** Panel height (m): open above (the shop's ceiling is >= 2.4 m). */
  panelH: 2.1,
  /** No changing-area cell closer than this to the shopfront (m, depth from the frontage; lane CONTEXT keeps its spawns >= 4 m off it). */
  frontClear: 4.0,
} as const;
/** Rows of the whole zone: aisle + booths + the booth-back row (3.5 m). */
export const CHANGING_ROWS = CHANGING.aisleRows + CHANGING.boothRows + 1;
/** Cells along the wall for n booths (partitions + free columns + the opening). */
export const changingCols = (n: number) => CHANGING.pitch * n + 1 + CHANGING.entryCols;

export interface ChangingRect { x0: number; z0: number; x1: number; z1: number }
export interface ChangingArea {
  /** The wall the aisle runs along, and which way the booth row runs from its corner (+1: toward +u of the zone frame). */
  wall: Side;
  dir: 1 | -1;
  booths: number;
  /** World rects of each booth's free floor (booth order from the closed corner), then the aisle along the booths. */
  rects: ChangingRect[];
  boothRects: ChangingRect[];
  aisle: ChangingRect;
  /** Centre of the opening on the sales-floor side (world m). */
  entry: {x: number; z: number};
  /** The zone's footprint (world rect, the opening included) and the props placed. */
  zone: ChangingRect;
  props: PropPlacement[];
}

const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Lays out the walk-in changing area in `d`'s sales floor (before the rest of the boutique): the back wall first, then the side walls
 * (seeded order), the most booths that fit (CHANGING.maxBooths .. minBooths), the opening toward the shop's entry first. Records the
 * rects on `shop` (MallShop.changing / changingEntry). Returns null (nothing placed) when no wall takes >= minBooths booths.
 */
export function placeChangingArea(d: ShopDresser, shop?: MallShop): ChangingArea | null {
  const fr = d.fr;
  const sides = d.rng.chance(0.5) ? [fr.L, fr.R] : [fr.R, fr.L];
  for (const wall of [fr.back, ...sides]) {
    const Z = wall === fr.back ? fr : frameOf(d.a, OPP[wall]);
    const cols = Math.round(Z.W / CELL);
    // the opening toward the shop's entry first (back wall: the end nearer the entry's middle), the other end next
    const entryMid = (fr.entry[0] + fr.entry[1]) / 2;
    const dirs: (1 | -1)[] = wall === fr.back ? (entryMid >= fr.W / 2 ? [1, -1] : [-1, 1]) : [1, -1];
    for (let n = Math.min(CHANGING.maxBooths, Math.floor((cols - 1 - CHANGING.entryCols) / CHANGING.pitch)); n >= CHANGING.minBooths; n--) {
      for (const dir of dirs) {
        const r = tryZone(d, Z, wall, dir, n, shop);
        if (r) {
          if (shop) { shop.changing = r.rects.map(q => ({...q})); shop.changingEntry = {...r.entry}; }
          return r;
        }
      }
    }
  }
  return null;
}

/** One candidate: n booths along `wall` (zone frame Z: its back = the wall), the closed corner at u = 0 (dir 1) or u = W (dir -1). */
function tryZone(d: ShopDresser, Z: ShopFrame, wall: Side, dir: 1 | -1, n: number, shop?: MallShop): ChangingArea | null {
  const ctx = d.ctx, g = ctx.g, a = d.a;
  const cols = Math.round(Z.W / CELL);
  const last = CHANGING.pitch * n; // column of the last partition
  const width = changingCols(n);
  if (width > cols || Math.round(Z.D / CELL) < CHANGING_ROWS + 4) return null;
  // zone cell (c, r): column c from the closed corner along the wall, row r from the wall (r = -1: the wall row behind the aisle)
  const uOf = (c: number) => (dir > 0 ? (c + 0.5) * CELL : Z.W - (c + 0.5) * CELL);
  const vOf = (r: number) => Z.D - (r + 0.5) * CELL;
  const cell = (c: number, r: number): number => {
    const [x, z] = uvXZ(Z, uOf(c), vOf(r));
    const [cx, cy] = g.cellOf(x, z);
    return g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
  };
  const backroom = shop?.backroom;
  const own = (i: number) => i >= 0 && g.cells[i] === FLOOR && g.area[i] === a.id;
  const free = (i: number) => own(i) && !g.blocked[i] && !ctx.edge[i] && !ctx.lane[i] && !ctx.plaza[i];
  /** structure / booth cells: also off doorways and their zones, and not reserved by an earlier keep-out (the shop entry) */
  const solidOk = (i: number) => free(i) && !ctx.doorCell[i] && !ctx.zone[i] && !ctx.keep[i];
  /** behind the aisle / beside the closed corner: a real wall, or the shop's own stock-room door */
  const wallOk = (i: number) => i < 0 || g.cells[i] !== FLOOR || (backroom !== undefined && g.area[i] === backroom);
  const frontOk = (c: number, r: number) => {
    const [x, z] = uvXZ(Z, uOf(c), vOf(r));
    return xzUV(d.fr, x, z)[1] >= CHANGING.frontClear;
  };
  const booth = CHANGING.aisleRows, back = CHANGING_ROWS - 1;
  for (let c = 0; c < width; c++) {
    if (!wallOk(cell(c, -1))) return null;
    for (let r = 0; r <= back + 1; r++) {
      const i = cell(c, r);
      const gap = c > last;
      if (r === back + 1) { if (gap && !free(i)) return null; continue; } // the approach in front of the opening
      if (!frontOk(c, r)) return null;
      if (r < booth || gap) { if (!free(i) || (!gap && ctx.keep[i]) || (gap && r >= booth && (ctx.doorCell[i] || ctx.keep[i]))) return null; }
      else if (!solidOk(i)) return null;
    }
  }
  for (let r = 0; r <= back; r++) if (!wallOk(cell(-1, r))) return null;

  // --- place (one transaction: rolled back when the room would lose its connectivity) ---------------------------------------------
  const before = d.placed.length;
  begin(ctx);
  const props: PropPlacement[] = [];
  const alongX = Z.side === 'N' || Z.side === 'S';
  /** A piece centred at zone (u from the corner, v), its long axis along u (`alongU`) or v, half extents (long, thin). */
  const put = (kind: PropKind, u: number, v: number, alongU: boolean, half: number, thin: number, rot: number, sight: boolean) => {
    const [x, z] = uvXZ(Z, dir > 0 ? u : Z.W - u, v);
    const hu = alongU ? half : thin, hv = alongU ? thin : half;
    const p = forceProp(ctx, a, kind, r3(x), r3(z), r3(alongX ? hu : hv), r3(alongX ? hv : hu), PROP_DEFS[kind].h, sight);
    p.rot = rot;
    props.push(p);
    d.placed.push(p);
    return p;
  };
  const towardC = dir > 0 ? Z.plusU : Z.minusU, awayC = dir > 0 ? Z.minusU : Z.plusU;
  const uc = (c: number) => (c + 0.5) * CELL;
  const vBack0 = Z.D - CHANGING_ROWS * CELL; // outer face of the booth-back row (the sales-floor side)
  const vBooth0 = Z.D - CHANGING.aisleRows * CELL; // booth opening line (aisle edge)
  const P = PROP_DEFS.fittingPartition, BP = PROP_DEFS.fittingBackPanel, BE = PROP_DEFS.fittingBench, MI = PROP_DEFS.fittingMirror, CU = PROP_DEFS.fittingCurtain;
  for (let k = 0; k <= n; k++) put('fittingPartition', uc(CHANGING.pitch * k), vBack0 + P.w / 2, false, P.w / 2, P.d / 2, towardC, true);
  for (let k = 0; k < n; k++) {
    const um = (CHANGING.pitch * k + 2) * CELL; // between the booth's two free columns
    put('fittingBackPanel', um, vBack0 + BP.d / 2, true, BP.w / 2, BP.d / 2, Z.inward, true);
    put('fittingBench', um, vBack0 + BP.d + BE.d / 2, true, BE.w / 2, BE.d / 2, Z.inward, false);
    // the mirror on this booth's first partition (facing into the booth), half way down the booth
    put('fittingMirror', uc(CHANGING.pitch * k) + P.d / 2 + MI.d / 2, vBooth0 - 0.75, false, MI.w / 2, MI.d / 2, towardC, false);
    // the curtain gathered beside the next partition, its rail (local +x) running back across the opening toward this booth's mirror side
    const cu = uc(CHANGING.pitch * (k + 1)) - P.d / 2 - CU.w / 2 - 0.01;
    const rail = railRot(Z, awayC);
    put('fittingCurtain', cu, vBooth0 - CU.d / 2 - 0.02, true, CU.w / 2, CU.d / 2, rail, false);
  }
  // reserve the free floor: the aisle (+ its turn), every booth, the opening and its approach
  const keepCell = (i: number) => { if (i >= 0 && own(i) && !g.blocked[i]) markCell(ctx, ctx.keep, i); };
  for (let c = 0; c < width; c++) for (let r = 0; r < booth; r++) keepCell(cell(c, r));
  for (let k = 0; k < n; k++) for (let c = CHANGING.pitch * k + 1; c < CHANGING.pitch * (k + 1); c++) for (let r = booth; r < back; r++) keepCell(cell(c, r));
  for (let c = last + 1; c < width; c++) for (let r = booth; r <= back + 1; r++) keepCell(cell(c, r));
  if (!areaConnected(ctx, a)) {
    rollback(ctx);
    d.placed.length = before;
    return null;
  }
  commit(ctx);
  // --- records -----------------------------------------------------------------------------------------------------------------------
  /** World rect of the zone cell block [c0..c1] x [r0..r1]. */
  const rectOf = (c0: number, c1: number, r0: number, r1: number): ChangingRect => {
    const ua = dir > 0 ? c0 * CELL : Z.W - (c1 + 1) * CELL, ub = dir > 0 ? (c1 + 1) * CELL : Z.W - c0 * CELL;
    const va = Z.D - (r1 + 1) * CELL, vb = Z.D - r0 * CELL;
    const [xa, za] = uvXZ(Z, ua, va), [xb, zb] = uvXZ(Z, ub, vb);
    return {x0: r3(Math.min(xa, xb)), z0: r3(Math.min(za, zb)), x1: r3(Math.max(xa, xb)), z1: r3(Math.max(za, zb))};
  };
  const boothRects = Array.from({length: n}, (_, k) => rectOf(CHANGING.pitch * k + 1, CHANGING.pitch * k + 2, booth, back - 1));
  const aisle = rectOf(0, last, 0, booth - 1);
  const [ex, ez] = uvXZ(Z, dir > 0 ? (last + 1 + CHANGING.entryCols / 2) * CELL : Z.W - (last + 1 + CHANGING.entryCols / 2) * CELL, vBack0);
  return {wall, dir, booths: n, rects: [...boothRects, aisle], boothRects, aisle, entry: {x: r3(ex), z: r3(ez)}, zone: rectOf(0, width - 1, 0, back), props};
}

/** The yaw (front +-v of the zone frame) whose local +x points along the zone-frame direction `toward` (a yaw facing that way). */
function railRot(Z: ShopFrame, toward: number): number {
  const tx = Math.sin(toward), tz = Math.cos(toward);
  for (const r of [Z.inward, Z.face]) if (Math.cos(r) * tx - Math.sin(r) * tz > 0.5) return r;
  return Z.inward;
}

// ---------------------------------------------------------------------------------------------
// Display stock: the six lingerie sets on display busts (the sets are riders: they ride the bust when it tips over)

/** The designs in lane FIT's LINGERIE_SETS order (green, purple, blush, black, red, ivory). */
export const LINGERIE_DESIGNS = Object.keys(LINGERIE_SET_KINDS) as (keyof typeof LINGERIE_SET_KINDS)[];

/** Dresses a display bust with the set of `design` (index into LINGERIE_DESIGNS): a rider at the bust's torso. */
export function dressBust(d: ShopDresser, bust: PropPlacement, design: number): PropPlacement | null {
  const hi = d.layout.props.indexOf(bust);
  if (hi < 0 || bust.kind !== 'lingerieBust') return null;
  const kind = LINGERIE_SET_KINDS[LINGERIE_DESIGNS[((design % LINGERIE_DESIGNS.length) + LINGERIE_DESIGNS.length) % LINGERIE_DESIGNS.length]];
  const def = PROP_DEFS[kind];
  const quarter = Math.round(bust.rot / (Math.PI / 2)) & 1;
  const p: PropPlacement = {kind, x: bust.x, z: bust.z, y: bust.y + LINGERIE_SET_Y0, rot: bust.rot, area: bust.area, hx: r3((quarter ? def.d : def.w) / 2), hz: r3((quarter ? def.w : def.d) / 2),
    h: def.h, blocksSight: false, variant: 0, host: hi, ...(bust.level ? {level: bust.level} : {})};
  d.layout.props.push(p);
  d.placed.push(p);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Lane FIT seam (coordinator, 2026-11-02): the static display meshes are the unskinned nodes `LingerieDisplay_<design>_top` /
// `LingerieDisplay_<design>_bottom` INSIDE each `outfit-lingerie-<design>.glb` (sharing its texture), loaded lazily through lane FIT's
// LINGERIE_MODEL_FILES (game/src/ai/lingerie.ts) — the SAME model key the store-local zombies wear, so the store adds no bytes. Until those
// files are registered with the prop library, the set kinds render their procedural stand-ins (kinds.ts mallShape) through the same path.

/** Where a display set's meshes come from (world/mallLingerieDisplay.ts renders them on the set's rider placement). */
export const LINGERIE_DISPLAY_SOURCE = {
  /** Prop-library key of a design's outfit file (lane FIT's LINGERIE_MODEL_FILES key; the existing wardrobe keys read `outfit_<id>`). */
  modelKey: (design: string) => `outfit_lingerie_${design}`,
  /** The display nodes of a design inside that file (blush may be one piece: whichever exist render). */
  nodes: (design: string) => [`LingerieDisplay_${design}_top`, `LingerieDisplay_${design}_bottom`],
  /** The nodes face -Z (a half turn onto the set's +Z front)? The wardrobe files face +Z like the zombie bodies. */
  turn: false,
} as const;

/** The design of a lingerie display-set kind (undefined for any other kind). */
export function lingerieSetDesign(kind: string): (typeof LINGERIE_DESIGNS)[number] | undefined {
  return LINGERIE_DESIGNS.find(k => LINGERIE_SET_KINDS[k] === kind);
}
/** Game.sectionModelKeys hook: the outfit files whose display meshes the layout's lingerie store shows (only the designs placed). */
export function lingerieDisplayModelKeys(layout: {props: readonly {kind: string}[]}): string[] {
  const s = new Set<string>();
  for (const p of layout.props) { const d = lingerieSetDesign(p.kind); if (d) s.add(LINGERIE_DISPLAY_SOURCE.modelKey(d)); }
  return [...s].sort();
}
