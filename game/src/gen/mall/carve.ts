// Task track3-eaton-centre-20261031 (lane GEN): carving of THE EATON'S CENTER into ONE Kit (7 level grids: the station pit + six
// retail rings), canvas cells, before the crop. Pure data (gen/mall/index.ts crops, links, rails, dresses, populates, validates).
//
// Order: plan every footprint first (void mask, run slots, elevator shafts, bridges) as pure data, then carve
//  1. level 0: Kit.sideBlock (two side platforms + one double track bed along X: the shared station block builder, so k.trenches
//     exists for Track2), the north / south courts adjoining the platforms (no wall) under the ring-1 galleries;
//  2. rings 1..6: the gallery ring around the void (rect pieces, minus the wells / shafts), bridges on their rings, the four shop
//     bands (units: sales floor + stock room, shopfront onto the gallery, staff doors), the service-corridor loop, the four corner
//     service-stair cores (scissor lanes, rings 1..6) and back-of-house rooms;
//  3. the public vertical runs between consecutive storeys (escalator banks in the long galleries, stairs in the end galleries),
//     each lane its own straight layStairRun carved into both storeys' grids (open wells: the band rises to the gallery ceiling
//     of the upper storey; Ramp.headroom = OPEN_HEADROOM, see world/traversalBuilder.ts).
// Void cells stay SOLID on every ring (bridges excepted on their ring); the station's band under them rises to the roof apex, so
// registerApertures / deriveRails rail every gallery edge on the void and every bridge side automatically.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from '../grid';
import {Kit, type TrackBlock} from '../stationKit';
import {SLAB} from '../levelGen';
import {STAIR, layStairRun, planStairs, stairRunCells, type StairFlight, type StairSpec} from '../traversal';
import {DOOR_HEIGHT, type Area, type Door, type Rect} from '../stationTypes';
import {
  CLEAR, CORE, CORRIDOR, GALLERY, LANE, MALL_CANVAS, RINGS, ROOF, RUN, RUN_CELLS, STOREY, mallStoreyLabel, type MallFrame,
} from './frame';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Ramp headroom of an OPEN well (no ceiling follows the flight; the band is capped by the cell ceiling: levels.ts header). */
export const OPEN_HEADROOM = 40;
/** Service stair (corner cores): one storey = 28 risers of STOREY / 28 m on 0.28 m treads in 3 flights. */
export const SERVICE_STAIR: StairSpec = {...STAIR, riser: STOREY / 28};
export const SERVICE_RUN_CELLS = stairRunCells(STOREY, SERVICE_STAIR);

export interface CellRect { x: number; y: number; w: number; h: number }

/** One lane of a public run (escalator / stair): canvas cells of its rect, its flights (kit.flights ids). */
export interface RunLane { kind: 'escalator' | 'stair'; rect: CellRect; flights: number[] }
/** A public vertical run between storey `lower` and `lower + 1` (a bank of lanes on one shared pitch). */
export interface RunCarve {
  id: string;
  kind: 'escalator' | 'stair';
  lower: number;
  /** Footprint of the whole bank (canvas cells). */
  rect: CellRect;
  axis: 'x' | 'z';
  /** Which end of the rect is the TOP (the run starts there at the upper floor). */
  from: 'lo' | 'hi';
  lanes: RunLane[];
  area: number;
  side: 'N' | 'S' | 'W' | 'E';
}

export interface CoreCarve {
  id: string;
  /** Well rect (both lanes + divider + landings). */
  well: CellRect;
  /** Landing area per storey (index = storey; -1 = none). */
  landings: number[];
  runs: {lower: number; area: number; flights: number[]; lane: 'A' | 'B'}[];
}

export interface ShopCarve {
  id: string;
  level: number;
  side: 'N' | 'S' | 'W' | 'E';
  sales: number;
  back: number;
  kind: 'store' | 'anchor' | 'food';
  /** Shopfront opening (canvas cells) + the door record index. */
  front: CellRect;
  door: number;
  /** Sales rect (canvas cells), depth across the band, width along it. */
  rect: CellRect;
}

export interface WashroomCarve { level: number; side: 'W' | 'E'; passage: number; rooms: number[] }

/** Cells (along the band) of a ring's washroom slot: a 4-cell passage, a wall, 11 cells of washrooms. */
export const WC_SLOT = 16;

export interface BridgeCarve { level: number; areas: number[]; x0: number; x1: number; z0: number; z1: number }
export interface ElevatorCarve { id: string; shaft: CellRect; cab: CellRect; doorSide: 'N' | 'S'; door: {x: number; w: number}; landing: CellRect }

export interface MallCarve {
  f: MallFrame;
  /** Absolute floor of every storey (index = layout level). */
  bases: number[];
  /** Outer corridor floor extent (canvas cells, exclusive ends). */
  X0: number; Z0: number; X1: number; Z1: number;
  /** Gallery ring rect (canvas cells, exclusive ends). */
  gx0: number; gx1: number; gz0: number; gz1: number;
  /** Void bbox (canvas cells, exclusive) and its rect pieces. */
  vx0: number; vx1: number; vz0: number; vz1: number;
  voidRects: CellRect[];
  /** Per canvas cell: 1 = void (stride `cw`, the kit canvas width). */
  voidMask: Uint8Array;
  cw: number;
  block: TrackBlock;
  courts: {north: number[]; south: number[]};
  galleries: Map<number, number[]>;
  corridors: Map<number, number[]>;
  shops: ShopCarve[];
  runs: RunCarve[];
  cores: CoreCarve[];
  bridges: BridgeCarve[];
  elevators: ElevatorCarve[];
  boh: number[];
  /** Washroom passage per ring (public passage + men's / women's rooms). */
  washrooms: WashroomCarve[];
  /** The station's back-of-house areas (service spurs, washrooms, station rooms). */
  stationBoh: number[];
  roof: {springY: number; apexY: number};
  /** Main rect rows of the void (the band the station block fills). */
  mainZ0: number; mainZ1: number;
}

/** Why the last attempts failed (QA / tests). */
export const MALL_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { MALL_CARVE_FAILS[why] = (MALL_CARVE_FAILS[why] ?? 0) + 1; return null; };

/** Greedy decomposition of a cell mask (within a rect) into maximal-run rectangles (row-major, deterministic). */
export function decompose(mask: (x: number, y: number) => boolean, r: CellRect): CellRect[] {
  const W = r.w, H = r.h;
  const used = new Uint8Array(W * H);
  const ok = (x: number, y: number) => !used[(y - r.y) * W + (x - r.x)] && mask(x, y);
  const out: CellRect[] = [];
  for (let y = r.y; y < r.y + H; y++) for (let x = r.x; x < r.x + W; x++) {
    if (!ok(x, y)) continue;
    let w = 1;
    while (x + w < r.x + W && ok(x + w, y)) w++;
    let h = 1;
    grow: while (y + h < r.y + H) {
      for (let xx = x; xx < x + w; xx++) if (!ok(xx, y + h)) break grow;
      h++;
    }
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[(yy - r.y) * W + (xx - r.x)] = 1;
    out.push({x, y, w, h});
  }
  return out;
}

/**
 * Carves the whole mall into a fresh kit (levels 0..RINGS); null when the program does not fit (the caller retries with another
 * seed).
 */
export function carveMall(k: Kit, rng: Rng, f: MallFrame): MallCarve | null {
  const bases = Array.from({length: RINGS + 1}, (_, i) => r2(i * STOREY));
  const GL = GALLERY.long, GE = GALLERY.end, CW = CORRIDOR, D = f.D;
  // --- X layout -------------------------------------------------------------------------------------------------------------
  const X0 = MALL_CANVAS.org + 1, Z0 = MALL_CANVAS.org + 1;
  const gx0 = X0 + CW + 1 + D + 1;
  const vx0 = gx0 + GE, vx1 = vx0 + f.VL;
  const gx1 = vx1 + GE;
  const X1 = gx1 + 1 + D + 1 + CW;
  // --- Z layout: the station block decides the void's main rows -------------------------------------------------------------
  const gz0 = Z0 + CW + 1 + D + 1;
  const vzMin = gz0 + GL;
  const mainZ0 = vzMin + f.AE;
  const P2y = mainZ0 + 2;
  const px0 = vx0 - 1, Lp = f.VL + 2;
  if (X1 + 4 > k.g.w) return fail('canvas-w');
  const block = k.sideBlock(px0, P2y, Lp, CLEAR.platform, ['Platform 1', 'Platform 2']);
  const [P1, P2] = block.platforms;
  const mainZ1 = P1.y + P1.h + 2;
  const vzMax = mainZ1 + f.AE;
  const gz1 = vzMax + GL;
  const Z1 = gz1 + 1 + D + 1 + CW;
  if (Z1 + 4 > k.g.h) return fail('canvas-h');
  // The mall's station: no columns down the bed (it runs under the open atrium), platforms open onto the courts (no fare line).
  for (const t of k.trenches) t.columns = false;
  for (const P of block.platforms) delete P.paid;
  P1.platformNo = 1; P2.platformNo = 2;

  // --- Void outline (rect pieces) per variant ---------------------------------------------------------------------------------
  const VWm = mainZ1 - mainZ0;
  const voidRects: CellRect[] = [];
  const R = (x0: number, z0: number, x1: number, z1: number) => voidRects.push({x: x0, y: z0, w: x1 - x0, h: z1 - z0});
  if (f.variant === 'galleria') {
    const s = Math.round(VWm * 0.22);
    R(vx0 + f.inset, mainZ0, vx1 - f.inset, mainZ1);
    R(vx0, mainZ0 + s, vx0 + f.inset, mainZ1 - s);
    R(vx1 - f.inset, mainZ0 + s, vx1, mainZ1 - s);
  } else if (f.variant === 'oval-court') {
    const t = f.inset, s = Math.round(VWm * 0.2);
    R(vx0 + 2 * t, vzMin, vx1 - 2 * t, vzMax);
    R(vx0 + t, mainZ0, vx0 + 2 * t, mainZ1);
    R(vx1 - 2 * t, mainZ0, vx1 - t, mainZ1);
    R(vx0, mainZ0 + s, vx0 + t, mainZ1 - s);
    R(vx1 - t, mainZ0 + s, vx1, mainZ1 - s);
  } else {
    const aw = f.inset, xc = vx0 + Math.floor(f.VL / 2);
    R(vx0, mainZ0, xc - Math.floor(aw / 2), mainZ1);
    R(xc - Math.floor(aw / 2), vzMin, xc - Math.floor(aw / 2) + aw, vzMax);
    R(xc - Math.floor(aw / 2) + aw, mainZ0, vx1, mainZ1);
  }
  const W = k.g.w;
  const voidMask = new Uint8Array(W * k.g.h);
  for (const r of voidRects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) voidMask[y * W + x] = 1;
  const isVoid = (x: number, y: number) => voidMask[y * W + x] === 1;
  const top = (x: number) => { for (let y = vzMin; y < vzMax; y++) if (isVoid(x, y)) return y; return vzMax; };
  const bottom = (x: number) => { for (let y = vzMax - 1; y >= vzMin; y--) if (isVoid(x, y)) return y + 1; return vzMin; };
  const left = (y: number) => { for (let x = vx0; x < vx1; x++) if (isVoid(x, y)) return x; return vx1; };
  const right = (y: number) => { for (let x = vx1 - 1; x >= vx0; x--) if (isVoid(x, y)) return x + 1; return vx0; };

  // --- Roof ---------------------------------------------------------------------------------------------------------------------
  const springY = r2(bases[RINGS] + ROOF.spring);
  const apexY = r2(springY + (vzMax - vzMin) * CELL * ROOF.riseFrac);

  // --- Run slots (pure data) ----------------------------------------------------------------------------------------------------
  // Escalator banks: two lanes (3 cells each) along X in the 6-row strip next to the void in the long galleries; slot A (west)
  // serves even storey pairs on the north side / odd ones on the south side, slot B the others: two banks per storey pair on
  // opposite sides (loops), positions alternating storey to storey (no two runs share a storey's cells).
  const RL = RUN_CELLS, SW = GALLERY.strip;
  const slotX = (frac: number) => vx0 + Math.round(f.VL * frac);
  const xa = slotX(f.escA), xb = slotX(f.escB);
  const stripN = (x0: number, w: number): CellRect | null => {
    let mt = Infinity; for (let x = x0; x < x0 + w; x++) mt = Math.min(mt, top(x));
    const r = {x: x0, y: mt - SW, w, h: SW};
    return r.y - gz0 >= GALLERY.walkway ? r : null;
  };
  const stripS = (x0: number, w: number): CellRect | null => {
    let mb = -Infinity; for (let x = x0; x < x0 + w; x++) mb = Math.max(mb, bottom(x));
    const r = {x: x0, y: mb, w, h: SW};
    return gz1 - (r.y + r.h) >= GALLERY.walkway ? r : null;
  };
  const NA = stripN(xa, RL), NB = stripN(xb, RL), SA = stripS(xa, RL), SB = stripS(xb, RL);
  if (!NA || !NB || !SA || !SB) return fail('escalator-strip');
  // End stairs (storeys >= 1: the station's bed / platforms lie under the end galleries' strip on level 0): one 5-cell lane along
  // Z in the end gallery next to the void; west: odd storeys north half, even south; east mirrored.
  const zMid = Math.floor((mainZ0 + mainZ1) / 2);
  const endW = (z0: number): CellRect | null => {
    let ml = Infinity; for (let y = z0; y < z0 + RL; y++) ml = Math.min(ml, left(y));
    const r = {x: ml - LANE.stair, y: z0, w: LANE.stair, h: RL};
    return r.x - gx0 >= GALLERY.walkway ? r : null;
  };
  const endE = (z0: number): CellRect | null => {
    let mr = -Infinity; for (let y = z0; y < z0 + RL; y++) mr = Math.max(mr, right(y));
    const r = {x: mr, y: z0, w: LANE.stair, h: RL};
    return gx1 - (r.x + r.w) >= GALLERY.walkway ? r : null;
  };
  const WN = endW(zMid - 2 - RL), WS = endW(zMid + 2), EN = endE(zMid - 2 - RL), ES = endE(zMid + 2);
  if (!WN || !WS || !EN || !ES) return fail('end-stair-strip');
  interface Plan { id: string; kind: 'escalator' | 'stair'; lower: number; rect: CellRect; axis: 'x' | 'z'; from: 'lo' | 'hi'; side: RunCarve['side'] }
  const plans: Plan[] = [];
  for (let L = 0; L < RINGS; L++) {
    const even = L % 2 === 0;
    // Escalators rise toward the centre of the long side (top end inward): A rises east (top = hi), B rises west (top = lo).
    plans.push({id: `esc-N${even ? 'A' : 'B'}-${L}`, kind: 'escalator', lower: L, rect: even ? NA : NB, axis: 'x', from: even ? 'hi' : 'lo', side: 'N'});
    plans.push({id: `esc-S${even ? 'B' : 'A'}-${L}`, kind: 'escalator', lower: L, rect: even ? SB : SA, axis: 'x', from: even ? 'lo' : 'hi', side: 'S'});
    if (L >= 1) {
      // Stairs rise away from the void's middle row (top end outward).
      plans.push({id: `stair-W${even ? 'S' : 'N'}-${L}`, kind: 'stair', lower: L, rect: even ? WS : WN, axis: 'z', from: even ? 'hi' : 'lo', side: 'W'});
      plans.push({id: `stair-E${even ? 'N' : 'S'}-${L}`, kind: 'stair', lower: L, rect: even ? EN : ES, axis: 'z', from: even ? 'lo' : 'hi', side: 'E'});
    }
  }
  // Glass elevators: a 7 x 6 shaft in a long gallery's strip (between the escalator slots), the cab door facing the shops.
  const elevators: ElevatorCarve[] = [];
  {
    // Clear of the escalator slots on that side (and their mouths: 4 cells), searched from a preferred position.
    const clearOf = (x: number, slots: CellRect[]) => slots.every(s => x + 7 <= s.x - 4 || x >= s.x + s.w + 4);
    const pick = (pref: number, slots: CellRect[], strip: (x0: number, w: number) => CellRect | null): CellRect | null => {
      const p = slotX(pref);
      for (let d = 0; d < f.VL; d++) for (const x of [p + d, p - d]) if (x >= vx0 + 2 && x + 7 <= vx1 - 2 && clearOf(x, slots)) { const s = strip(x, 7); if (s) return s; }
      return null;
    };
    const cands: [CellRect | null, 'N' | 'S'][] = [[pick(0.42, [NA, NB], stripN), 'N'], [pick(0.88, [SA, SB], stripS), 'S']];
    for (const [s, side] of cands.slice(0, f.elevators)) {
      if (!s) return fail('elevator-strip');
      const cab = {x: s.x + 1, y: s.y + 1, w: 5, h: 4};
      const doorRow = side === 'N' ? s.y : s.y + s.h - 1;
      const landing = side === 'N' ? {x: s.x, y: s.y - 4, w: 7, h: 4} : {x: s.x, y: s.y + s.h, w: 7, h: 4};
      elevators.push({id: `lift-${side}`, shaft: s, cab, doorSide: side, door: {x: s.x + 2, w: 3}, landing});
      void doorRow;
    }
  }
  // Bridges: on the frame's bridge storeys, an 8-cell deck across the void along Z, away from the escalator slots' columns.
  const bridgeCols: {level: number; x0: number; x1: number}[] = [];
  {
    // Clear of every escalator slot / elevator shaft column (their mouths included: 4 cells) and of each other: a deck end always
    // meets open gallery walkway on both sides.
    const fr = f.variant === 'galleria' ? [0.38, 0.8] : f.variant === 'oval-court' ? [0.5] : [0.3, 0.72];
    const busy = [NA, NB, SA, SB, ...elevators.map(e => e.shaft)];
    for (const [i, lv] of f.bridgeRings.entries()) {
      const p = vx0 + Math.round(f.VL * fr[i % fr.length]) - 4;
      let got = -1;
      for (let d = 0; d < f.VL && got < 0; d++) for (const bx of [p + d, p - d]) {
        if (bx < vx0 + 2 || bx + 8 > vx1 - 2) continue;
        if (busy.some(r => bx + 8 > r.x - 4 && bx < r.x + r.w + 4) || bridgeCols.some(b => bx + 8 > b.x0 - 6 && bx < b.x1 + 6)) continue;
        got = bx; break;
      }
      if (got < 0) return fail('bridge-columns');
      bridgeCols.push({level: lv, x0: got, x1: got + 8});
    }
  }
  const runsTouching = (lv: number) => plans.filter(p => p.lower === lv || p.lower + 1 === lv);
  const inRect = (r: CellRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const shaftAt = (x: number, y: number) => elevators.some(e => inRect(e.shaft, x, y));

  // --- 1. Level 0: courts (the platforms' back edges open straight onto them) ---------------------------------------------------
  const g0 = k.grid(0);
  const courtCeil = CLEAR.court;
  const courts = {north: [] as number[], south: [] as number[]};
  const excl0 = (x: number, y: number) => shaftAt(x, y) || runsTouching(0).some(p => inRect(p.rect, x, y));
  const courtOf = (r: CellRect, label: string, list: number[]) => {
    for (const q of decompose((x, y) => !excl0(x, y), r)) {
      const a = k.addArea(q, 'concourse', 'concourse', courtCeil, P1.id, {label, publicSpace: true, role: 'great-hall'});
      list.push(a.id);
    }
  };
  courtOf({x: gx0, y: gz0, w: gx1 - gx0, h: P2.y - gz0}, 'Fountain court', courts.north);
  courtOf({x: gx0, y: P1.y + P1.h, w: gx1 - gx0, h: gz1 - (P1.y + P1.h)}, 'South court', courts.south);
  // Level-0 band under the void rises to the roof apex (the station sees the rings and the glass roof).
  for (let y = vzMin; y < vzMax; y++) for (let x = vx0; x < vx1; x++) {
    if (!isVoid(x, y)) continue;
    const i = g0.idx(x, y);
    if (g0.cells[i] === SOLID) return fail('void-over-rock');
    g0.ceil[i] = apexY;
  }

  // --- 2. Rings -------------------------------------------------------------------------------------------------------------
  const galleries = new Map<number, number[]>(), corridors = new Map<number, number[]>();
  const shops: ShopCarve[] = [], boh: number[] = [], washrooms: WashroomCarve[] = [];
  const bridges: BridgeCarve[] = [];
  const gallAt = (lv: number, x: number, y: number): Area | undefined => {
    const g = k.grid(lv), i = g.idx(x, y);
    return g.cells[i] === FLOOR ? k.areas[g.area[i]] : undefined;
  };
  for (let lv = 1; lv <= RINGS; lv++) {
    const base = bases[lv];
    const opt = {level: lv, floorY: base};
    // Gallery ring (minus the void, the wells of the runs touching this storey, the elevator shafts).
    const touching = runsTouching(lv);
    const gl: number[] = [];
    for (const q of decompose((x, y) => !isVoid(x, y) && !shaftAt(x, y) && !touching.some(p => inRect(p.rect, x, y)), {x: gx0, y: gz0, w: gx1 - gx0, h: gz1 - gz0})) {
      const a = k.addArea(q, 'concourse', 'retail-arcade', r2(base + CLEAR.gallery), -1, {...opt, label: `Gallery · ${mallStoreyLabel(lv)}`, publicSpace: true, role: 'mall'});
      gl.push(a.id);
    }
    galleries.set(lv, gl);
    // Bridges of this storey: every void cell in the bridge's columns (deck band up to the roof apex).
    for (const b of bridgeCols.filter(q => q.level === lv)) {
      const ids: number[] = [];
      let z0 = Infinity, z1 = -Infinity;
      for (const q of decompose((x, y) => isVoid(x, y), {x: b.x0, y: vzMin, w: b.x1 - b.x0, h: vzMax - vzMin})) {
        const a = k.addArea(q, 'concourse', 'concourse', apexY, gl[0], {...opt, label: `Bridge · ${mallStoreyLabel(lv)}`, publicSpace: true, role: 'crossover'});
        ids.push(a.id);
        z0 = Math.min(z0, q.y); z1 = Math.max(z1, q.y + q.h);
      }
      // Under the deck the station's band stops a slab below it.
      for (let y = z0; y < z1; y++) for (let x = b.x0; x < b.x1; x++) if (isVoid(x, y)) g0.ceil[g0.idx(x, y)] = r2(base - SLAB);
      bridges.push({level: lv, areas: ids, x0: b.x0, x1: b.x1, z0, z1});
    }
    // Service corridor loop.
    const cr: number[] = [];
    const corr = (r: CellRect) => { const a = k.addArea(r, 'service', 'service-corridor', r2(base + CLEAR.corridor), gl[0], {...opt, label: 'Service corridor', publicSpace: false}); cr.push(a.id); return a; };
    const cN = corr({x: X0, y: Z0, w: X1 - X0, h: CW});
    const cS = corr({x: X0, y: Z1 - CW, w: X1 - X0, h: CW});
    const cW = corr({x: X0, y: Z0 + CW, w: CW, h: Z1 - Z0 - 2 * CW});
    const cE = corr({x: X1 - CW, y: Z0 + CW, w: CW, h: Z1 - Z0 - 2 * CW});
    corridors.set(lv, cr);
    // Shop bands.
    const bands: {side: 'N' | 'S' | 'W' | 'E'; a0: number; a1: number}[] = [
      {side: 'N', a0: gx0, a1: gx1}, {side: 'S', a0: gx0, a1: gx1}, {side: 'W', a0: gz0, a1: gz1}, {side: 'E', a0: gz0, a1: gz1},
    ];
    const brng = rng.fork(`bands-${lv}`);
    // The washroom passage of this storey: mid-band on the west (odd storeys) / east (even) end band — a public passage from the
    // gallery through the band to the service corridor (staff door) with the men's / women's washrooms off it.
    const wcSide: 'W' | 'E' = lv % 2 === 1 ? 'W' : 'E';
    const wcS0 = Math.floor((gz0 + gz1) / 2) - Math.floor(WC_SLOT / 2) + (brng.chance(0.5) ? -6 : 6);
    for (const band of bands) {
      const anchor = f.anchors.some(q => q.ring === lv && q.side === band.side);
      const segs: [number, number][] = band.side === wcSide ? [[band.a0, wcS0 - 1], [wcS0 + WC_SLOT + 1, band.a1]] : [[band.a0, band.a1]];
      let anchored = !anchor, ui = 0;
      for (const [s0, s1] of segs) {
        const widths = splitBand(brng, s1 - s0, anchor && !anchored);
        let a = s0;
        for (const w of widths) {
          const unit = carveUnit(k, brng, {lv, base, side: band.side, a0: a, w, D, Ds: f.Ds, Db: f.Db, gx0, gx1, gz0, gz1, corridor: band.side === 'N' ? cN : band.side === 'S' ? cS : band.side === 'W' ? cW : cE, gallAt});
          if (unit) {
            if (!anchored && w >= 48) { unit.kind = 'anchor'; anchored = true; }
            unit.id = `L${lv}-${band.side}${String(++ui).padStart(2, '0')}`;
            shops.push(unit);
          }
          a += w + 1;
        }
      }
    }
    const wc = carveWashrooms(k, {lv, base, side: wcSide, s0: wcS0, D, X0, CW, gx0, gx1, corridor: wcSide === 'W' ? cW : cE, gallAt});
    if (!wc) return fail('washrooms');
    washrooms.push(wc);
  }

  // --- 3. Corner service-stair cores (rings 1..6) + back-of-house rooms ----------------------------------------------------------
  const cores: CoreCarve[] = [], stationBoh: number[] = [];
  const L = 2 * CORE.landing + SERVICE_RUN_CELLS, WH = 2 * CORE.lane + CORE.divider;
  if (L > D) return fail('core-long');
  const corners: {id: string; x: number; y: number; north: boolean; west: boolean}[] = [
    {id: 'NW', x: X0 + CW + 1, y: Z0 + CW + 1, north: true, west: true},
    {id: 'NE', x: gx1 + 1, y: Z0 + CW + 1, north: true, west: false},
    {id: 'SW', x: X0 + CW + 1, y: gz1 + 1, north: false, west: true},
    {id: 'SE', x: gx1 + 1, y: gz1 + 1, north: false, west: false},
  ];
  for (const c of corners) {
    // The well hugs the N / S corridor; the run axis is X; its far end from the W / E corridor.
    const wx = c.west ? c.x : c.x + D - L;
    const wy = c.north ? c.y : c.y + D - WH;
    const well: CellRect = {x: wx, y: wy, w: L, h: WH};
    const landings: number[] = new Array(RINGS + 1).fill(-1);
    // Landing ends alternate storey to storey (scissor lanes); the station's landing is at the end toward the courts.
    const endOf = (lv: number): 'lo' | 'hi' => ((lv % 2 === 1) === c.west ? 'lo' : 'hi');
    for (let lv = 0; lv <= RINGS; lv++) {
      const base = bases[lv];
      const lx = endOf(lv) === 'lo' ? wx : wx + L - CORE.landing;
      const la = k.addArea({x: lx, y: wy, w: CORE.landing, h: WH}, 'room', 'stair-core', r2(base + (lv ? CLEAR.core : CLEAR.core0)), -1,
        {...(lv ? {level: lv, floorY: base} : {}), label: `Service stairs · ${mallStoreyLabel(lv)}`, publicSpace: false, role: 'landing'});
      landings[lv] = la.id;
      if (lv === 0) {
        // The station's back of house: a service spur from the landing to its court (staff door) and rooms beside it.
        const spur = stationSpur(k, rng, {c, la, lx, wy, WH, D, gx0, gx1, gz0, gz1});
        if (!spur) return fail('station-spur');
        boh.push(...spur.rooms);
        stationBoh.push(...spur.areas, ...spur.rooms);
        continue;
      }
      const corr = k.areas[corridors.get(lv)![c.north ? 0 : 1]];
      const doorY = c.north ? wy - 1 : wy + WH;
      k.carveDoor({x: lx, y: doorY, w: CORE.landing, h: 1}, corr, la, CLEAR.door, false);
      // Back-of-house room in the rest of the corner block (door onto the W / E corridor).
      const by = c.north ? wy + WH + 1 : c.y, bh = D - WH - 1;
      if (bh >= 8) {
        const room = k.addArea({x: c.x, y: by, w: D, h: bh}, 'room', lv % 2 ? 'storage' : 'utility', r2(base + CLEAR.back), corr.id,
          {level: lv, floorY: base, label: 'Plant room', publicSpace: false});
        const side = k.areas[corridors.get(lv)![c.west ? 2 : 3]];
        const dx = c.west ? c.x - 1 : c.x + D;
        k.carveDoor({x: dx, y: by + Math.floor(bh / 2) - 1, w: 1, h: 3}, side, room, CLEAR.door, false, {staff: true});
        boh.push(room.id);
      }
    }
    const runs: CoreCarve['runs'] = [];
    for (let lv = 0; lv < RINGS; lv++) {
      const lane: 'A' | 'B' = lv % 2 === 1 ? 'A' : 'B';
      const ry = lane === 'A' ? wy : wy + CORE.lane + CORE.divider;
      const rect: Rect = {x: wx + CORE.landing, y: ry, w: SERVICE_RUN_CELLS, h: CORE.lane};
      const area = k.addArea(rect, 'room', 'stair-core', r2(bases[lv] + SERVICE_STAIR.headroom), landings[lv],
        {...(lv ? {level: lv, floorY: bases[lv]} : {}), also: [lv + 1], role: 'stair', publicSpace: false, label: `Service stairs · ${mallStoreyLabel(lv)} – ${mallStoreyLabel(lv + 1)}`});
      const fl = layStairRun([k.grid(lv), k.grid(lv + 1)], rect, area.id, 'x', endOf(lv), bases[lv], bases[lv + 1], SERVICE_STAIR);
      const ids: number[] = [];
      for (const q of fl) { q.id = k.flights.length; ids.push(q.id); k.flights.push(q); }
      runs.push({lower: lv, area: area.id, flights: ids, lane});
    }
    cores.push({id: c.id, well, landings, runs});
  }

  // --- 4. Public vertical runs (escalator banks + end stairs) --------------------------------------------------------------------
  const runs: RunCarve[] = [];
  for (const p of plans) {
    const lo = p.lower, hi = lo + 1;
    const ceil = r2(bases[hi] + CLEAR.gallery);
    const area = k.addArea(p.rect, 'passage', 'stair-core', ceil, -1, {
      ...(lo ? {level: lo, floorY: bases[lo]} : {}), also: [hi], role: 'stair', publicSpace: true,
      label: p.kind === 'escalator' ? `Escalators · ${mallStoreyLabel(lo)} – ${mallStoreyLabel(hi)}` : `Stairs · ${mallStoreyLabel(lo)} – ${mallStoreyLabel(hi)}`,
    });
    const lanes: RunLane[] = [];
    const laneW = p.kind === 'escalator' ? LANE.escalator : LANE.stair;
    const nLanes = p.kind === 'escalator' ? 2 : 1;
    const spec: StairSpec = {...(p.kind === 'escalator' ? RUN.escalator : RUN.stair), headroom: OPEN_HEADROOM};
    for (let li = 0; li < nLanes; li++) {
      const rect: CellRect = p.axis === 'x' ? {x: p.rect.x, y: p.rect.y + li * laneW, w: p.rect.w, h: laneW} : {x: p.rect.x + li * laneW, y: p.rect.y, w: laneW, h: p.rect.h};
      const fl: StairFlight[] = layStairRun([k.grid(lo), k.grid(hi)], rect, area.id, p.axis, p.from, bases[hi], bases[lo], spec);
      const ids: number[] = [];
      for (const q of fl) { q.id = k.flights.length; q.spec = p.kind === 'escalator' ? 'escalator' : 'transit'; ids.push(q.id); k.flights.push(q); }
      lanes.push({kind: p.kind, rect, flights: ids});
    }
    // Open well: both storeys' bands rise to the upper storey's gallery ceiling (no ceiling following the pitch).
    for (const g of [k.grid(lo), k.grid(hi)]) for (let y = p.rect.y; y < p.rect.y + p.rect.h; y++) for (let x = p.rect.x; x < p.rect.x + p.rect.w; x++) g.ceil[g.idx(x, y)] = ceil;
    runs.push({id: p.id, kind: p.kind, lower: lo, rect: p.rect, axis: p.axis, from: p.from, lanes, area: area.id, side: p.side});
  }
  // A ring cell next to the top / bottom of a run must be walkable on the storey it lands on (the mouths).
  for (const rc of runs) {
    for (const [lv, end] of [[rc.lower, rc.from === 'lo' ? 'hi' : 'lo'], [rc.lower + 1, rc.from]] as const) {
      const g = k.grid(lv), r = rc.rect;
      let ok = 0;
      for (let t = 0; t < (rc.axis === 'x' ? r.h : r.w); t++) {
        const x = rc.axis === 'x' ? (end === 'lo' ? r.x - 1 : r.x + r.w) : r.x + t;
        const y = rc.axis === 'x' ? r.y + t : (end === 'lo' ? r.y - 1 : r.y + r.h);
        if (g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR && g.rampIdx[g.idx(x, y)] < 0) ok++;
      }
      if (ok < (rc.axis === 'x' ? r.h : r.w)) return fail(`run-mouth-${rc.id}-${lv}`);
    }
  }
  void planStairs;
  return {
    f, bases, X0, Z0, X1, Z1, gx0, gx1, gz0, gz1, vx0, vx1, vz0: vzMin, vz1: vzMax, voidRects, voidMask, cw: W, block, courts, galleries, corridors,
    shops, runs, cores, bridges, elevators, boh, washrooms, stationBoh, roof: {springY, apexY}, mainZ0, mainZ1,
  };
}

/** Unit widths along a band of `len` cells (1-cell walls between): 26-40 cells (13-20 m), an anchor 48-60 cells. */
function splitBand(rng: Rng, len: number, anchor: boolean): number[] {
  const out: number[] = [];
  let rest = len;
  const want: number[] = [];
  if (anchor && len >= 90) want.push(rng.int(48, 60));
  while (rest > 0) {
    const w = want.length ? want.shift()! : rng.int(26, 40);
    if (rest - w - 1 < 26) { out.push(rest); break; }
    out.push(w);
    rest -= w + 1;
  }
  // Anchor somewhere along the band (seeded), not always first.
  if (out.length > 2 && anchor) {
    const i = rng.int(0, out.length - 2);
    const [a] = out.splice(0, 1);
    out.splice(i, 0, a);
  }
  return out;
}

interface UnitCtx {
  lv: number; base: number; side: 'N' | 'S' | 'W' | 'E'; a0: number; w: number; D: number; Ds: number; Db: number;
  gx0: number; gx1: number; gz0: number; gz1: number; corridor: Area; gallAt: (lv: number, x: number, y: number) => Area | undefined;
}

/** One shop unit: sales floor on the gallery (shopfront), stock room behind it (staff door), a staff door onto the corridor. */
function carveUnit(k: Kit, rng: Rng, u: UnitCtx): ShopCarve | null {
  const {lv, base, side, a0, w, Ds, Db} = u;
  const opt = {level: lv, floorY: base};
  let sales: Rect, back: Rect, front: Rect, sb: Rect, bc: Rect, galleryCell: [number, number];
  const fw = Math.max(4, w - 2);
  if (side === 'N') {
    sales = {x: a0, y: u.gz0 - 1 - Ds, w, h: Ds};
    back = {x: a0, y: u.gz0 - 2 - Ds - Db, w, h: Db};
    front = {x: a0 + 1, y: u.gz0 - 1, w: fw, h: 1};
    sb = {x: a0 + (rng.chance(0.5) ? 2 : w - 5), y: u.gz0 - 2 - Ds, w: 3, h: 1};
    bc = {x: a0 + Math.floor(w / 2) - 1, y: back.y - 1, w: 3, h: 1};
    galleryCell = [a0 + Math.floor(w / 2), u.gz0];
  } else if (side === 'S') {
    sales = {x: a0, y: u.gz1 + 1, w, h: Ds};
    back = {x: a0, y: u.gz1 + 2 + Ds, w, h: Db};
    front = {x: a0 + 1, y: u.gz1, w: fw, h: 1};
    sb = {x: a0 + (rng.chance(0.5) ? 2 : w - 5), y: u.gz1 + 1 + Ds, w: 3, h: 1};
    bc = {x: a0 + Math.floor(w / 2) - 1, y: back.y + Db, w: 3, h: 1};
    galleryCell = [a0 + Math.floor(w / 2), u.gz1 - 1];
  } else if (side === 'W') {
    sales = {x: u.gx0 - 1 - Ds, y: a0, w: Ds, h: w};
    back = {x: u.gx0 - 2 - Ds - Db, y: a0, w: Db, h: w};
    front = {x: u.gx0 - 1, y: a0 + 1, w: 1, h: fw};
    sb = {x: u.gx0 - 2 - Ds, y: a0 + (rng.chance(0.5) ? 2 : w - 5), w: 1, h: 3};
    bc = {x: back.x - 1, y: a0 + Math.floor(w / 2) - 1, w: 1, h: 3};
    galleryCell = [u.gx0, a0 + Math.floor(w / 2)];
  } else {
    sales = {x: u.gx1 + 1, y: a0, w: Ds, h: w};
    back = {x: u.gx1 + 2 + Ds, y: a0, w: Db, h: w};
    front = {x: u.gx1, y: a0 + 1, w: 1, h: fw};
    sb = {x: u.gx1 + 1 + Ds, y: a0 + (rng.chance(0.5) ? 2 : w - 5), w: 1, h: 3};
    bc = {x: back.x + Db, y: a0 + Math.floor(w / 2) - 1, w: 1, h: 3};
    galleryCell = [u.gx1 - 1, a0 + Math.floor(w / 2)];
  }
  const gal = u.gallAt(lv, galleryCell[0], galleryCell[1]);
  if (!gal) return null;
  const S = k.addArea(sales, 'room', 'shop', r2(base + CLEAR.shop), gal.id, {...opt, label: 'Shop', publicSpace: true});
  const B = k.addArea(back, 'room', 'stock-room', r2(base + CLEAR.back), S.id, {...opt, label: 'Stock room', publicSpace: false});
  B.purpose = 'stock-room';
  const door: Door = k.carveDoor(front, gal, S, CLEAR.shopfront, false, {shopfront: true});
  k.carveDoor(sb, S, B, DOOR_HEIGHT, false, {staff: true});
  k.carveDoor(bc, u.corridor, B, DOOR_HEIGHT, false, {staff: true});
  return {id: '', level: lv, side, sales: S.id, back: B.id, kind: 'store', front, door: door.id, rect: sales};
}

/** Grid helper: the floor cells of a level grid inside a rect. */
export function floorCells(g: Grid, r: CellRect): number {
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (g.cells[g.idx(x, y)] === FLOOR) n++;
  return n;
}

interface WcCtx {
  lv: number; base: number; side: 'W' | 'E'; s0: number; D: number; X0: number; CW: number; gx0: number; gx1: number; corridor: Area;
  gallAt: (lv: number, x: number, y: number) => Area | undefined;
}

/** A ring's washroom passage (gallery -> service corridor, staff door at the far end) with the men's / women's washrooms off it. */
function carveWashrooms(k: Kit, u: WcCtx): WashroomCarve | null {
  const {lv, base, side, s0, D} = u;
  const opt = {level: lv, floorY: base};
  const bx0 = side === 'W' ? u.X0 + u.CW + 1 : u.gx1 + 1;
  const gal = u.gallAt(lv, side === 'W' ? u.gx0 : u.gx1 - 1, s0 + 2);
  if (!gal) return null;
  const P = k.addArea({x: bx0, y: s0, w: D, h: 4}, 'passage', 'passage', r2(base + CLEAR.corridor), gal.id, {...opt, label: `Washrooms · ${mallStoreyLabel(lv)}`, publicSpace: true});
  k.carveDoor({x: side === 'W' ? u.gx0 - 1 : u.gx1, y: s0, w: 1, h: 4}, gal, P, 2.6, false);
  k.carveDoor({x: side === 'W' ? bx0 - 1 : bx0 + D, y: s0 + 1, w: 1, h: 3}, u.corridor, P, CLEAR.door, false, {staff: true});
  const m = Math.floor((D - 1) / 2);
  const rooms: number[] = [];
  const parts: [number, number, string][] = side === 'W' ? [[bx0, m, "Men's washroom"], [bx0 + m + 1, D - m - 1, "Women's washroom"]] : [[bx0, m, "Women's washroom"], [bx0 + m + 1, D - m - 1, "Men's washroom"]];
  for (const [x, w, label] of parts) {
    const R = k.addArea({x, y: s0 + 5, w, h: WC_SLOT - 5}, 'room', 'washroom', r2(base + CLEAR.back), P.id, {...opt, label, publicSpace: true});
    k.carveDoor({x: x === bx0 ? x + 2 : x + w - 5, y: s0 + 4, w: 3, h: 1}, P, R, DOOR_HEIGHT, false);
    rooms.push(R.id);
  }
  return {level: lv, side, passage: P.id, rooms};
}

interface SpurCtx {
  c: {id: string; x: number; y: number; north: boolean; west: boolean}; la: Area; lx: number; wy: number; WH: number; D: number;
  gx0: number; gx1: number; gz0: number; gz1: number;
}

/**
 * The station storey's back of house at one corner core: a 1.5 m service spur from the core's station landing out of the corner
 * block, across under the shop band and through a staff door into its court; beside it in the corner block a washroom pair (NW / SE)
 * or a station room (NE: station agent office, SW: maintenance store).
 */
function stationSpur(k: Kit, rng: Rng, u: SpurCtx): {areas: number[]; rooms: number[]} | null {
  const {c, la, lx, wy, WH, D} = u;
  const ceil = CLEAR.core0;
  // Vertical leg (the landing's width) from the well's court-side wall to the court's door rows; horizontal leg to the court wall.
  const doorRows: [number, number] = c.north ? [u.gz0 + 1, u.gz0 + 5] : [u.gz1 - 5, u.gz1 - 1];
  const vy0 = c.north ? wy + WH + 1 : doorRows[0], vy1 = c.north ? doorRows[1] : wy - 1;
  const V = k.addArea({x: lx, y: vy0, w: CORE.landing, h: vy1 - vy0}, 'service', 'service-corridor', ceil, la.id, {label: 'Service corridor', publicSpace: false});
  k.carveDoor({x: lx, y: c.north ? wy + WH : wy - 1, w: CORE.landing, h: 1}, V, la, CLEAR.door, false);
  const areas = [V.id];
  const wallX = c.west ? u.gx0 - 1 : u.gx1;
  const hx0 = c.west ? lx + CORE.landing : wallX + 1, hx1 = c.west ? wallX : lx;
  let host = V;
  if (hx1 > hx0) {
    const H = k.addArea({x: hx0, y: doorRows[0], w: hx1 - hx0, h: doorRows[1] - doorRows[0]}, 'service', 'service-corridor', ceil, V.id, {label: 'Service corridor', publicSpace: false});
    areas.push(H.id);
    host = H;
  }
  const court = (() => { const g = k.grid(0), x = c.west ? u.gx0 : u.gx1 - 1, i = g.idx(x, doorRows[0] + 1); return g.cells[i] === FLOOR ? k.areas[g.area[i]] : undefined; })();
  if (!court) return null;
  k.carveDoor({x: wallX, y: doorRows[0], w: 1, h: 3}, court, host, CLEAR.door, false, {staff: true});
  // Rooms in the corner block beside the vertical leg.
  const rx0 = c.west ? c.x : lx + CORE.landing + 1, rx1 = c.west ? lx - 1 : c.x + D;
  const ry0 = c.north ? wy + WH + 1 : c.y, ry1 = c.north ? c.y + D : wy - 1;
  const rooms: number[] = [];
  if (rx1 - rx0 >= 8 && ry1 - ry0 >= 8) {
    const doorX = c.west ? lx - 1 : lx + CORE.landing;
    if (c.id === 'NW' || c.id === 'SE') {
      const mh = Math.floor((ry1 - ry0 - 1) / 2);
      for (const [y, h, label] of [[ry0, mh, "Men's washroom"], [ry0 + mh + 1, ry1 - ry0 - mh - 1, "Women's washroom"]] as const) {
        const R = k.addArea({x: rx0, y, w: rx1 - rx0, h}, 'room', 'washroom', CLEAR.back, V.id, {label, publicSpace: true});
        k.carveDoor({x: doorX, y: y + Math.floor(h / 2) - 1, w: 1, h: 3}, V, R, DOOR_HEIGHT, false);
        rooms.push(R.id);
      }
    } else {
      const type = c.id === 'NE' ? 'agent-office' : 'storage';
      const R = k.addArea({x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0}, 'room', type, CLEAR.back, V.id, {label: type === 'agent-office' ? 'Station agent office' : 'Maintenance store', publicSpace: false});
      k.carveDoor({x: doorX, y: ry0 + Math.floor((ry1 - ry0) / 2) - 1 + (rng.chance(0.5) ? 1 : -1), w: 1, h: 3}, V, R, DOOR_HEIGHT, false, {staff: true});
      rooms.push(R.id);
    }
  }
  return {areas, rooms};
}
