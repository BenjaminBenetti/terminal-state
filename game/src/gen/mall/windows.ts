// Task studio-mall-layout-variety-20261117-005520-01: the Mall's parking-lot WINDOW WALLS (layout version >= 2: gen/mall/layoutVersion.ts).
//
// User: "suggest larger outside windows with views of a parking lot". Real enclosed malls are mostly blank outside and concentrate their
// glass at an entrance court, a food court or a terrace over the lot (reference/tasks/mall-layout-variety-20261117-005520/research/
// RESEARCH.md); here:
//  - 'designed': a plan family's glazed end court (EndSpec.window: gen/mall/plans.ts) — its end wall glazed floor to ceiling on every
//    retail floor it reaches (the carver kept the outside free: gen/mall/carve.ts 3c);
//  - 'gallery': a blank OUTER walkway wall found by a scan of the finished grids (every family, the atrium family's version-2 build
//    included): a walkway run whose wall backs onto rock that stays free (no carved cell on any retail storey, nothing below reaching
//    street level) all the way out to the grid edge, and deep and wide enough for the lot.
// Behind the glazing plane the grid stays SOLID: a one-cell curtain wall (glass + mullions) and then the exterior VIEW volume, which
// world/mallWindows.ts dresses as the mall's parking lot (asphalt, stall rows, islands, light poles, abandoned cars, a parking deck and
// the town beyond) in the street exits' outdoor shading and the Office's green murk. Collision is the SOLID cells (player / zombies /
// bullets / sight / physics): no prop, no Door record, never the breakable shopGlazing, no Travel. (The panes are the Office's breakable
// windows at runtime, a broken one letting the outside gas in: world/mallWindowPanes.ts; nothing here records them.)
//
// WHEN: an APPEND-ONLY post-pass after the street exits (gen/mall/index.ts): only virtual daylight lights and layout.mall.windows are
// added, so every core record and every exit of the build keep their indices and values. Placement reads only the finished grids and
// its own rng (never the generator's streams).

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR, SOLID} from '../grid';
import type {LightPlacement, StationLayout} from '../stationTypes';
import {MALL_STREET_LEVEL} from './exits';
import type {MallRect, MallWindowWall} from './mallTypes';
import type {CellRect, EndSpec, Side4} from './skeleton';

/** Window wall dimensions (cells = 0.5 m unless noted). */
export const WINDOW = {
  /** At most this many window walls per mall. */
  max: 2,
  /** Wall kept each side of the glazing (cells). */
  pier: 2,
  /** Glazed span (cells): at least 6 m, a scanned wall at most 26 m. */
  minSpan: 12,
  maxSpan: 52,
  /** Curtain-wall depth behind the plane (cells, SOLID): the glass and its mullions. */
  depth: 1,
  /** Exterior view volume beyond the curtain wall (cells): depth / side margin (min, max). */
  viewDepth: [40, 150] as const,
  viewSide: [8, 60] as const,
  /** Minimum distance between two window walls' centres (cells). */
  apart: 40,
  /** Glazing head below the storey's clear ceiling in front (m) and the tallest band (m). */
  headDrop: 0.35,
  maxBand: 6.5,
  /** Exterior view volume height above / below the street (m); nothing below reaches closer than `slab` to the street level (m). */
  viewUp: 30,
  viewDown: 1,
  slab: 0.3,
} as const;

/** Daylight through the window glass (linear RGB, ~unit luminance): the street exits' / the Office's green-cast daylight. */
const DAYLIGHT_TINT: readonly [number, number, number] = [0.78, 0.98, 0.86];

/** A glazed end the skeleton designed (cropped grid cells): `line` = the first rock row / column beyond it. */
export interface DesignedWindowEnd { dir: Side4; line: number; a0: number; a1: number }

/** Per-call report (QA / tests). */
export const MALL_WINDOW_STATS = {designed: 0, scanned: 0, candidates: 0, placed: 0, ms: 0, rejects: {edge: 0, wall: 0, floors: 0, view: 0}};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const SIGN: Record<Side4, number> = {N: -1, S: 1, W: -1, E: 1};

/**
 * The outside a designed window end keeps free while the carver builds (canvas cells beyond the end line: the curtain wall + the near
 * lot, the side margin each way). The carver clips it to the canvas (beyond the canvas is outside the building).
 */
export function windowReserveRect(e: Pick<EndSpec, 'dir' | 'line' | 'a0' | 'a1'>): CellRect {
  const D = WINDOW.depth + WINDOW.viewDepth[0] + 4, s = WINDOW.viewSide[0];
  const t0 = e.a0 - s, t1 = e.a1 + s;
  switch (e.dir) {
    case 'N': return {x: t0, y: e.line - D + 1, w: t1 - t0, h: D};
    case 'S': return {x: t0, y: e.line, w: t1 - t0, h: D};
    case 'W': return {x: e.line - D + 1, y: t0, w: D, h: t1 - t0};
    default: return {x: e.line, y: t0, w: D, h: t1 - t0};
  }
}

/**
 * Places the window walls of a finished version-2 mall layout (mutates it: virtual daylight sources, layout.mall.windows). Returns
 * the records ([] when no designed end or blank outer wall qualifies).
 */
export function placeMallWindows(layout: StationLayout, designed: readonly DesignedWindowEnd[], levelSeed: number): MallWindowWall[] {
  const t0ms = typeof performance !== 'undefined' ? performance.now() : Date.now();
  Object.assign(MALL_WINDOW_STATS, {designed: 0, scanned: 0, candidates: 0, placed: 0, ms: 0, rejects: {edge: 0, wall: 0, floors: 0, view: 0}});
  const rej = MALL_WINDOW_STATS.rejects;
  const info = layout.mall;
  if (!info) return [];
  const SL = MALL_STREET_LEVEL, levels = layout.levels, top = levels.length - 1;
  if (top < SL) return (info.windows = []);
  const g1 = levels[SL].grid, W = g1.w, H = g1.h, n = W * H;
  const streetY = levels[SL].baseY;
  // --- free: no retail storey carved there and nothing below reaching street level (the curtain wall / the lot) -----------------
  const free = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let f = true;
    for (let lv = 0; lv < SL && f; lv++) { const q = levels[lv].grid; if (q.cells[i] !== SOLID && q.ceil[i] > streetY - WINDOW.slab) f = false; }
    for (let lv = SL; lv <= top && f; lv++) if (levels[lv].grid.cells[i] !== SOLID) f = false;
    free[i] = f ? 1 : 0;
  }
  const block = (b: {x0: number; z0: number; x1: number; z1: number}, pad: number) => {
    const x0 = Math.floor(b.x0 / CELL) - pad, x1 = Math.ceil(b.x1 / CELL) + pad, y0 = Math.floor(b.z0 / CELL) - pad, y1 = Math.ceil(b.z1 / CELL) + pad;
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) free[y * W + x] = 0;
  };
  // never by the glass lift (2 m), never over a street exit's pocket or its street view
  for (const e of info.elevators) block(e.shaft, 4);
  for (const e of info.exits ?? []) { block(e.collider, 2); block(e.view, 0); }
  const s = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += free[y * W + x] ? 0 : 1; s[(y + 1) * (W + 1) + x + 1] = s[y * (W + 1) + x + 1] + row; } }
  /** No unfree cell in [x0, x1) x [y0, y1) (clipped to the grid: beyond it is outside the building). */
  const ok = (x0: number, y0: number, x1: number, y1: number): boolean => {
    const a = Math.max(0, x0), b = Math.max(0, y0), c = Math.min(W, x1), d = Math.min(H, y1);
    if (c <= a || d <= b) return true;
    const w1 = W + 1;
    return s[d * w1 + c] - s[b * w1 + c] - s[d * w1 + a] + s[b * w1 + a] === 0;
  };
  const rectOf = (dir: Side4, line: number, t0: number, t1: number, d0: number, d1: number): [number, number, number, number] => {
    switch (dir) {
      case 'N': return [t0, line - d1 + 1, t1, line - d0 + 1];
      case 'S': return [t0, line + d0, t1, line + d1];
      case 'W': return [line - d1 + 1, t0, line - d0 + 1, t1];
      default: return [line + d0, t0, line + d1, t1];
    }
  };
  const cellAt = (dir: Side4, line: number, t: number, d: number): [number, number] =>
    dir === 'N' ? [t, line - d] : dir === 'S' ? [t, line + d] : dir === 'W' ? [line - d, t] : [line + d, t];
  /** Cells from the wall line out to the grid edge (the wall is an OUTER wall: nothing of the mall beyond it). */
  const toEdge = (dir: Side4, line: number) => (dir === 'N' ? line + 1 : dir === 'S' ? H - line : dir === 'W' ? line + 1 : W - line);
  const walkSets = levels.map((_, lv) => new Set(info.galleries.find(q => q.level === lv)?.areas ?? []));
  const isWalk = (lv: number, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const g = levels[lv].grid, i = y * W + x;
    return g.cells[i] === FLOOR && g.rampIdx[i] < 0 && walkSets[lv].has(g.area[i]);
  };
  /** The glazed storeys of a wall span (its walkway rows in front on that storey: two rows deep). */
  const floorsOf = (dir: Side4, line: number, t0: number, t1: number): number[] => {
    const out: number[] = [];
    for (let lv = SL; lv <= top; lv++) {
      let all = true;
      for (let t = t0; t < t1 && all; t++) for (const d of [-1, -2]) { const [x, y] = cellAt(dir, line, t, d); if (!isWalk(lv, x, y)) { all = false; break; } }
      if (all) out.push(lv);
    }
    return out;
  };
  /** The largest view (depth D, side margin sm) beyond the curtain wall over [t0, t1), or null below the minimums. */
  const viewOf = (dir: Side4, line: number, t0: number, t1: number): {D: number; sm: number} | null => {
    const dv = WINDOW.depth;
    const fits = (D: number, sm: number) => ok(...rectOf(dir, line, t0 - sm - 1, t1 + sm + 1, dv, dv + D + 1)); // (+ a free cell round it: never on the mall's own wall face)
    let D = 0;
    for (let d: number = WINDOW.viewDepth[1]; d >= WINDOW.viewDepth[0]; d -= 4) if (fits(d, WINDOW.viewSide[0])) { D = d; break; }
    if (!D) return null;
    let sm: number = WINDOW.viewSide[0];
    for (let q: number = WINDOW.viewSide[1]; q > sm; q -= 4) if (fits(D, q)) { sm = q; break; }
    return {D, sm};
  };

  interface Cand { kind: MallWindowWall['kind']; dir: Side4; line: number; t0: number; t1: number; floors: number[]; D: number; sm: number; score: number }
  const cands: Cand[] = [];
  const rng = new Rng(hashString('mall-window-walls', levelSeed >>> 0));
  const P = WINDOW.pier;
  // --- designed glazed ends ------------------------------------------------------------------------------------------------------
  const designedKeys = new Set<string>();
  for (const e of designed) {
    designedKeys.add(`${e.dir}:${e.line}`);
    const t0 = e.a0 + P, t1 = e.a1 - P;
    if (t1 - t0 < WINDOW.minSpan) continue;
    const floors = floorsOf(e.dir, e.line, t0, t1);
    if (!floors.length || !ok(...rectOf(e.dir, e.line, t0 - P, t1 + P, 0, WINDOW.depth))) continue;
    const v = viewOf(e.dir, e.line, t0, t1);
    if (!v) continue;
    cands.push({kind: 'designed', dir: e.dir, line: e.line, t0, t1, floors, D: v.D, sm: v.sm, score: 10 + floors.length + v.D / 150 + rng.next() * 0.2});
    MALL_WINDOW_STATS.designed++;
  }
  // --- blank outer walkway walls (every storey's walkway runs against free rock that reaches the grid edge) ----------------------
  const seen = new Map<string, Cand>();
  for (let lv = SL; lv <= top; lv++) {
    for (const dir of ['N', 'S', 'W', 'E'] as const) {
      const [dx, dy] = dir === 'N' ? [0, -1] : dir === 'S' ? [0, 1] : dir === 'W' ? [-1, 0] : [1, 0];
      const alongX = dx === 0, outer = alongX ? H : W, inner = alongX ? W : H;
      for (let o = 1; o < outer - 1; o++) {
        let start = -1;
        for (let a = 0; a <= inner; a++) {
          const x = alongX ? a : o, y = alongX ? o : a;
          const on = a < inner && isWalk(lv, x, y) && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && free[(y + dy) * W + x + dx] === 1;
          if (on && start < 0) start = a;
          if (on || start < 0) continue;
          const line = alongX ? o + dy : o + dx, a0 = start, a1 = a;
          start = -1;
          if (designedKeys.has(`${dir}:${line}`) || a1 - a0 < WINDOW.minSpan + 2 * P) continue;
          MALL_WINDOW_STATS.scanned++;
          // the widest span in the run (centred first, then sliding outward) that passes: an OUTER wall (free from the line out to the
          // grid edge, or at least a 30 m deep lot), its curtain-wall cells, walkway in front, the lot volume
          const room = a1 - a0 - 2 * P;
          let got: Cand | null = null;
          for (let span = Math.min(room, WINDOW.maxSpan); span >= WINDOW.minSpan && !got; span -= 8) {
            const mid = a0 + P + ((room - span) >> 1), offs = [0];
            for (let k = 4; mid - k >= a0 + P || mid + k + span <= a1 - P; k += 4) { if (mid + k + span <= a1 - P) offs.push(k); if (mid - k >= a0 + P) offs.push(-k); }
            for (const off of offs) {
              const t0 = mid + off, t1 = t0 + span, key = `${dir}:${line}:${t0}:${t1}`;
              if (seen.has(key)) { got = seen.get(key)!; break; }
              if (!ok(...rectOf(dir, line, t0 - P, t1 + P, 0, WINDOW.depth))) { rej.wall++; continue; }
              const floors = floorsOf(dir, line, t0, t1);
              if (!floors.length) { rej.floors++; continue; }
              const v = viewOf(dir, line, t0, t1);
              if (!v) { rej.view++; continue; }
              if (v.D < 60 && !ok(...rectOf(dir, line, t0, t1, 0, toEdge(dir, line)))) { rej.edge++; continue; }
              got = {kind: 'gallery', dir, line, t0, t1, floors, D: v.D, sm: v.sm, score: floors.length + span / WINDOW.maxSpan + v.D / 150 + rng.next() * 0.4};
              seen.set(key, got);
              cands.push(got);
              break;
            }
          }
        }
      }
    }
  }
  MALL_WINDOW_STATS.candidates = cands.length;
  // --- choose (designed first), spaced apart, footprints / views never touching ---------------------------------------------------
  cands.sort((p, q) => q.score - p.score || p.line - q.line || p.t0 - q.t0);
  const centre = (c: Cand) => cellAt(c.dir, c.line, (c.t0 + c.t1) / 2, 0);
  const foot = (c: Cand) => rectOf(c.dir, c.line, c.t0 - P, c.t1 + P, 0, WINDOW.depth);
  const view = (c: Cand) => rectOf(c.dir, c.line, c.t0 - c.sm, c.t1 + c.sm, WINDOW.depth, WINDOW.depth + c.D);
  const chosen: Cand[] = [];
  for (const c of cands) {
    if (chosen.length >= WINDOW.max) break;
    const [cx, cy] = centre(c);
    if (chosen.some(q => { const [qx, qy] = centre(q); return Math.hypot(qx - cx, qy - cy) < WINDOW.apart; })) continue;
    if (chosen.some(q => touch(foot(q), foot(c), 2) || touch(view(q), view(c), 0) || touch(view(q), foot(c), 0) || touch(view(c), foot(q), 0))) continue;
    chosen.push(c);
  }
  // --- record + daylight ---------------------------------------------------------------------------------------------------------
  const windows: MallWindowWall[] = [];
  for (const c of chosen) {
    const sg = SIGN[c.dir], alongX = c.dir === 'N' || c.dir === 'S';
    const planeCell = c.dir === 'N' || c.dir === 'W' ? c.line + 1 : c.line;
    const plane = r3(planeCell * CELL), facade = r3(plane + sg * WINDOW.depth * CELL);
    const bands = c.floors.map(lv => {
      const g = levels[lv].grid, y0 = levels[lv].baseY;
      let ceil = Infinity;
      for (let t = c.t0; t < c.t1; t++) { const [x, y] = cellAt(c.dir, c.line, t, -1); ceil = Math.min(ceil, g.ceil[y * W + x]); }
      const [mx, my] = cellAt(c.dir, c.line, (c.t0 + c.t1) >> 1, -1);
      return {level: lv, y0: r3(y0), y1: r3(Math.min(ceil - WINDOW.headDrop, y0 + WINDOW.maxBand)), area: g.area[my * W + mx]};
    });
    const boxOf = (t0: number, t1: number, d0: number, d1: number, y0: number, y1: number): MallRect & {y0: number; y1: number} => {
      const [x0, z0, x1, z1] = rectOf(c.dir, c.line, t0, t1, d0, d1);
      return {x0: r3(x0 * CELL), z0: r3(z0 * CELL), x1: r3(x1 * CELL), z1: r3(z1 * CELL), y0: r3(y0), y1: r3(y1)};
    };
    const w: MallWindowWall = {
      id: `window-${windows.length + 1}`, kind: c.kind, side: c.dir, streetY: r3(streetY), plane, s0: r3(c.t0 * CELL), s1: r3(c.t1 * CELL), bands, facade,
      collider: boxOf(c.t0 - P, c.t1 + P, 0, WINDOW.depth, bands[0].y0, bands[bands.length - 1].y1),
      view: boxOf(c.t0 - c.sm, c.t1 + c.sm, WINDOW.depth, WINDOW.depth + c.D, streetY - WINDOW.viewDown, streetY + WINDOW.viewUp),
      seed: hashString(`mall-window:${c.dir}:${c.line}:${c.t0}`, levelSeed >>> 0) >>> 0,
    };
    windows.push(w);
    // daylight falling in through the glass on every glazed storey (fixture-less, steady, green-cast like the exits' / the Office's)
    const inward = -sg, s0 = w.s0, s1 = w.s1;
    const k = Math.max(2, Math.round((s1 - s0) / 3));
    for (const b of bands) {
      const g = levels[b.level].grid;
      for (let i = 0; i < k; i++) {
        const t = s0 + (s1 - s0) * (i + 0.5) / k, depth = 1.2;
        const x = alongX ? t : plane + inward * depth, z = alongX ? plane + inward * depth : t;
        const lx = Math.floor(x / CELL), ly = Math.floor(z / CELL);
        if (lx < 0 || ly < 0 || lx >= W || ly >= H || g.cells[ly * W + lx] !== FLOOR) continue;
        const l: LightPlacement = {
          x: r3(x), y: r3(Math.min(b.y1 - 0.15, g.ceil[ly * W + lx] - 0.1)), z: r3(z), rot: alongX ? 0 : Math.PI / 2, area: g.area[ly * W + lx],
          broken: false, flicker: false, warm: false, power: 0.34, dying: false, virtual: true, tint: DAYLIGHT_TINT, level: b.level,
        };
        layout.lights.push(l);
      }
    }
  }
  info.windows = windows;
  MALL_WINDOW_STATS.placed = windows.length;
  MALL_WINDOW_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0ms;
  return windows;
}

function touch(a: [number, number, number, number], b: [number, number, number, number], m: number): boolean {
  return a[0] < b[2] + m && b[0] < a[2] + m && a[1] < b[3] + m && b[1] < a[3] + m;
}

/** Grid cells (per glazed storey) of a window wall's collider box — the SOLID cells behind its glazing (tests / QA). */
export function windowColliderCells(layout: StationLayout, w: MallWindowWall): {level: number; cells: number[]}[] {
  const x0 = Math.round(w.collider.x0 / CELL), x1 = Math.round(w.collider.x1 / CELL), y0 = Math.round(w.collider.z0 / CELL), y1 = Math.round(w.collider.z1 / CELL);
  return w.bands.map(b => {
    const g = layout.levels[b.level].grid, cells: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g.inBounds(x, y)) cells.push(g.idx(x, y));
    return {level: b.level, cells};
  });
}
