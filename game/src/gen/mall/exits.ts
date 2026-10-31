// Task mall-round2-20261031 (lane GEN, M09): LOCKED glazed STREET EXITS at street-level hall ends.
//
// User (round 2): "I would also love if some hallways ended at doors out of the mall, where you can see the city through the glass
// with the green fog and all that." Clarification: the doors are LOCKED.
//
// STREET LEVEL = retail floor 1 (MALL_STREET_LEVEL): the mall's Track2 context declares rockLevels [0] (only the station storey is
// enclosed in rock: gen/mall/trackExt.ts), the station is a shallow box one storey below grade (platforms y 0, 4.4 m ceiling under
// the 5.0 m floor-1 slab), and the Office's convention is the same (its station is level 0, its street / lobby level 1: officeInfo
// groundY = bases[1]). The station and floors 2-3 never get a street exit.
//
// WHAT (pure data, deterministic per level seed; layout.mall.exits = MallStreetExit[], 0..EXIT.max):
//  - 'corridor-end': a floor-1 corridor the skeleton DESIGNED to end at the street (EndSpec.exit; new variants only) — its end wall
//    becomes the locked glazing, nothing is carved;
//  - 'entrance-hall': a short public hall (4-14 m) carved off a blank floor-1 walkway wall straight out to the building's edge, ending
//    at the locked glazing (every variant; the only kind the three original variants get).
// Behind the glazing plane the grid stays SOLID (rock): a vestibule pocket (EXIT.vest) and then the EXTERIOR VIEW volume — a box
// with no carved cell on any storey >= street (and nothing below reaching street level), the space lane ARCH dresses with city
// facades and the Office's green fog. Collision is the SOLID cells themselves (player / zombies / bullets / sight / physics): no
// prop, no Door record, never the breakable shopGlazing; nothing to open, no Travel destination, no gas / exposure rule.
//
// WHEN: an APPEND-ONLY post-pass on the FINISHED layout (gen/mall/index.ts, after validation chose the attempt and after the Track2
// attach): its areas / lights are the LAST records, so every core record (areas, doors, props, pickups, zombies, lights, rails,
// links, the MallInfo fields) of an existing (seed, variant) keeps its index and value. Placement reads only the finished grids
// (props = grid.blocked) and its own rng (never the generator's streams).

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR, SOLID} from '../grid';
import type {Area, LightPlacement, StationLayout} from '../stationTypes';
import {CLEAR} from './frame';
import type {MallRect, MallStreetExit} from './mallTypes';
import type {Side4} from './skeleton';

/** The street storey (layout.levels index): retail floor 1. */
export const MALL_STREET_LEVEL = 1;

/** Exit dimensions (cells = 0.5 m unless noted). */
export const EXIT = {
  /** At most this many exits per mall. */
  max: 2,
  /** Entrance hall clear widths tried, widest first (cells): 6 m / 5 m / 4 m. */
  hallW: [12, 10, 8] as const,
  /** Wall kept each side of the glazed opening (cells). */
  pier: 1,
  /** Entrance hall length range (cells): 4 - 20 m, ~8 m preferred (a real hallway, not a door in a side wall). */
  stub: [8, 40] as const,
  stubPref: 16,
  /** Vestibule pocket behind the inner glazing (cells, SOLID: never walkable). */
  vest: 5,
  /** Exterior view volume beyond the facade (cells): depth / side margin (min, max). */
  viewDepth: [24, 60] as const,
  viewSide: [6, 24] as const,
  /** Walkway rows in front of the mouth that must be prop-free (cells). */
  approach: 4,
  /** Minimum distance between two exits' door centres (cells). */
  apart: 40,
  /** Glazing head / door leaf height above the floor (m); door leaf width (m). */
  head: 3.0,
  leafH: 2.3,
  leaf: 0.9,
  /** Exterior view volume height above / below the street (m). */
  viewUp: 30,
  viewDown: 1,
  /** Nothing below the street storey may reach closer than this to the street level under a hall / pocket / view (m). */
  slab: 0.3,
} as const;

/** Daylight through the exit glass (linear RGB, ~unit luminance): the Office's green-cast daylight (gen/office/windows.ts). */
const DAYLIGHT_TINT: readonly [number, number, number] = [0.78, 0.98, 0.86];

/** A corridor end the skeleton designed to meet the street (cropped grid cells): `line` = the first rock row / column beyond it. */
export interface DesignedExitEnd { dir: Side4; line: number; a0: number; a1: number }

/** Per-call report (QA / tests). */
export const MALL_EXIT_STATS = {runs: 0, candidates: 0, designed: 0, placed: 0, ms: 0};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const SIGN: Record<Side4, number> = {N: -1, S: 1, W: -1, E: 1};

/**
 * Places the street exits of a finished mall layout (mutates it: entrance-hall areas + their floor-1 cells, virtual daylight
 * sources, layout.mall.exits). Returns the records ([] when no suitable hall end exists).
 */
export function placeStreetExits(layout: StationLayout, designed: readonly DesignedExitEnd[], levelSeed: number): MallStreetExit[] {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  Object.assign(MALL_EXIT_STATS, {runs: 0, candidates: 0, designed: 0, placed: 0, ms: 0});
  const info = layout.mall;
  if (!info) return [];
  const SL = MALL_STREET_LEVEL;
  const levels = layout.levels;
  if (levels.length <= SL) return (info.exits = []);
  const g = levels[SL].grid, W = g.w, H = g.h, n = W * H;
  const streetY = levels[SL].baseY;
  const top = levels.length - 1;
  const walkSet = new Set(info.galleries.find(q => q.level === SL)?.areas ?? []);
  const corridorSet = new Set(info.corridors?.find(q => q.level === SL)?.areas ?? []);
  // --- Per-cell masks --------------------------------------------------------------------------------------------------------
  // free: no storey >= street carved there, nothing below reaching street level - slab (the exterior / pocket test)
  // rock: SOLID on the street storey with nothing below reaching street level - slab (an entrance hall may be carved there)
  // wall: SOLID on the street storey (a hall's side wall)
  const below = (i: number) => {
    for (let lv = 0; lv < SL; lv++) {
      const q = levels[lv].grid;
      if (q.cells[i] !== SOLID && q.ceil[i] > streetY - EXIT.slab) return false;
    }
    return true;
  };
  const free = new Uint8Array(n), rock = new Uint8Array(n), wall = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const b = below(i);
    wall[i] = g.cells[i] === SOLID ? 1 : 0;
    rock[i] = wall[i] && b ? 1 : 0;
    let f = b;
    for (let lv = SL; lv <= top && f; lv++) if (levels[lv].grid.cells[i] !== SOLID) f = false;
    free[i] = f ? 1 : 0;
  }
  // keep clear of the glass elevator's shaft (2 m)
  for (const e of info.elevators) {
    const x0 = Math.floor(e.shaft.x0 / CELL) - 4, x1 = Math.ceil(e.shaft.x1 / CELL) + 4, y0 = Math.floor(e.shaft.z0 / CELL) - 4, y1 = Math.ceil(e.shaft.z1 / CELL) + 4;
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) { const i = y * W + x; free[i] = 0; rock[i] = 0; }
  }
  // summed-area tables of the "bad" cells (outside the grid: free for the view, never for a hall / pocket)
  const sat = (m: Uint8Array) => {
    const s = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) { row += m[y * W + x] ? 0 : 1; s[(y + 1) * (W + 1) + x + 1] = s[y * (W + 1) + x + 1] + row; }
    }
    return s;
  };
  const satFree = sat(free), satRock = sat(rock), satWall = sat(wall);
  /** No bad cell in the cell rect [x0, x1) x [y0, y1) (clipped to the grid; `inside`: the rect must lie inside the grid). */
  const ok = (s: Int32Array, x0: number, y0: number, x1: number, y1: number, inside: boolean): boolean => {
    if (inside && (x0 < 1 || y0 < 1 || x1 > W - 1 || y1 > H - 1)) return false;
    const a = Math.max(0, x0), b = Math.max(0, y0), c = Math.min(W, x1), d = Math.min(H, y1);
    if (c <= a || d <= b) return true;
    const w1 = W + 1;
    return s[d * w1 + c] - s[b * w1 + c] - s[d * w1 + a] + s[b * w1 + a] === 0;
  };
  /** Cell rect of along [t0, t1) x depth [d0, d1) beyond the wall line (d = 0 at `line`, growing outward). */
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
  const isWalk = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = y * W + x;
    return g.cells[i] === FLOOR && g.rampIdx[i] < 0 && walkSet.has(g.area[i]);
  };
  const clearWalk = (x: number, y: number) => isWalk(x, y) && !g.blocked[y * W + x];
  /** The largest view (depth D, side margin s) beyond depth dv over along [t0, t1), or null below the minimums. */
  const viewOf = (dir: Side4, line: number, t0: number, t1: number, dv: number): {D: number; s: number} | null => {
    const fits = (D: number, s: number) => ok(satFree, ...rectOf(dir, line, t0 - s, t1 + s, dv, dv + D), false);
    let D = 0;
    for (let d: number = EXIT.viewDepth[1]; d >= EXIT.viewDepth[0]; d -= 2) if (fits(d, EXIT.viewSide[0])) { D = d; break; }
    if (!D) return null;
    let s: number = EXIT.viewSide[0];
    for (let q: number = EXIT.viewSide[1]; q > s; q -= 2) if (fits(D, q)) { s = q; break; }
    return {D, s};
  };

  interface Cand { kind: MallStreetExit['kind']; dir: Side4; line: number; t0: number; t1: number; Ls: number; D: number; s: number; score: number; front: number }
  const cands: Cand[] = [];
  const rng = new Rng(hashString('mall-street-exits', levelSeed >>> 0));
  // --- Designed corridor ends (new variants): the corridor end wall itself --------------------------------------------------
  const designedKeys = new Set<string>();
  for (const e of designed) {
    designedKeys.add(`${e.dir}:${e.line}`);
    const t0 = e.a0, t1 = e.a1;
    let walkRow = true;
    for (let t = t0; t < t1 && walkRow; t++) { const [x, y] = cellAt(e.dir, e.line, t, -1); if (!isWalk(x, y)) walkRow = false; }
    if (!walkRow) continue;
    if (!ok(satFree, ...rectOf(e.dir, e.line, t0 - 1, t1 + 1, 0, EXIT.vest), true)) continue;
    let clear = true;
    for (let d = -EXIT.approach; d < 0 && clear; d++) for (let t = t0 + EXIT.pier; t < t1 - EXIT.pier && clear; t++) { const [x, y] = cellAt(e.dir, e.line, t, d); if (!clearWalk(x, y)) clear = false; }
    if (!clear) continue;
    const v = viewOf(e.dir, e.line, t0, t1, EXIT.vest);
    if (!v) continue;
    const [fx, fy] = cellAt(e.dir, e.line, (t0 + t1) >> 1, -1);
    cands.push({kind: 'corridor-end', dir: e.dir, line: e.line, t0, t1, Ls: 0, D: v.D, s: v.s, score: 10 + v.D / 60 + v.s / 24 + rng.next() * 0.2, front: g.area[fy * W + fx]});
    MALL_EXIT_STATS.designed++;
  }
  // --- Entrance halls off blank walkway walls --------------------------------------------------------------------------------
  let runs = 0;
  for (const dir of ['N', 'S', 'W', 'E'] as const) {
    const [dx, dy] = dir === 'N' ? [0, -1] : dir === 'S' ? [0, 1] : dir === 'W' ? [-1, 0] : [1, 0];
    const alongX = dx === 0;
    const outer = alongX ? H : W, inner = alongX ? W : H;
    for (let o = 1; o < outer - 1; o++) {
      let start = -1;
      for (let a = 0; a <= inner; a++) {
        const x = alongX ? a : o, y = alongX ? o : a;
        const on = a < inner && isWalk(x, y) && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && rock[(y + dy) * W + x + dx] === 1;
        if (on && start < 0) start = a;
        if (!on && start >= 0) {
          const line = alongX ? o + dy : o + dx, a0 = start, a1 = a;
          start = -1;
          if (designedKeys.has(`${dir}:${line}`)) continue;
          runs++;
          for (const hw of EXIT.hallW) {
            if (a1 - a0 < hw + 2) continue;
            // positions from the run's middle outward (every other cell), the hall's side walls inside the run
            const mid = Math.round((a0 + a1 - hw) / 2), pos: number[] = [];
            for (let k = 0; ; k++) {
              const p1 = mid + k * 2, p2 = mid - k * 2;
              const in1 = p1 >= a0 + 1 && p1 + hw <= a1 - 1, in2 = k > 0 && p2 >= a0 + 1 && p2 + hw <= a1 - 1;
              if (!in1 && !in2) break;
              if (in1) pos.push(p1);
              if (in2) pos.push(p2);
            }
            let found = false;
            for (const t0 of pos.slice(0, 10)) {
              const t1 = t0 + hw;
              // approach: prop-free walkway in front of the mouth
              let clear = true;
              for (let d = -EXIT.approach; d < 0 && clear; d++) for (let t = t0; t < t1 && clear; t++) { const [cx, cy] = cellAt(dir, line, t, d); if (!clearWalk(cx, cy)) clear = false; }
              if (!clear) continue;
              let best: Cand | null = null;
              const hallOk = (Ls: number) => ok(satRock, ...rectOf(dir, line, t0, t1, 0, Ls), true) && ok(satWall, ...rectOf(dir, line, t0 - 1, t1 + 1, 0, Ls), true);
              const outside = (Ls: number) => ok(satFree, ...rectOf(dir, line, t0 - 1, t1 + 1, Ls, Ls + EXIT.vest), true) ? viewOf(dir, line, t0, t1, Ls + EXIT.vest) : null;
              for (let Ls: number = EXIT.stub[0]; Ls <= EXIT.stub[1]; Ls++) {
                // the hall (rock, nothing below near street level) and its side walls; a row that is not rock ends the search
                if (!hallOk(Ls)) break;
                let v = outside(Ls);
                if (!v) continue;
                // the shortest hall that reaches the outside — lengthened toward a real ~6-8 m hallway while it still does
                let L2 = Ls;
                for (let q = Math.max(Ls + 1, EXIT.stubPref - 4); q <= EXIT.stubPref; q++) {
                  if (!hallOk(q)) break;
                  const v2 = outside(q);
                  if (v2) { L2 = q; v = v2; }
                }
                Ls = L2;
                const [fx, fy] = cellAt(dir, line, (t0 + t1) >> 1, -1);
                const front = g.area[fy * W + fx];
                const score = (corridorSet.has(front) ? 2 : 0) + v.D / 60 + v.s / 24 - Math.abs(Ls - EXIT.stubPref) / 40 + (hw === EXIT.hallW[0] ? 0.3 : 0) + rng.next() * 0.4;
                best = {kind: 'entrance-hall', dir, line, t0, t1, Ls, D: v.D, s: v.s, score, front};
                break;
              }
              if (best) { cands.push(best); found = true; break; }
            }
            if (found) break;
          }
        }
      }
    }
  }
  MALL_EXIT_STATS.runs = runs;
  MALL_EXIT_STATS.candidates = cands.length;
  // --- Choose (designed ends first, then the best halls), spaced apart ------------------------------------------------------
  cands.sort((p, q) => q.score - p.score || p.line - q.line || p.t0 - q.t0);
  const centre = (c: Cand) => cellAt(c.dir, c.line, (c.t0 + c.t1) / 2, c.Ls);
  const chosen: Cand[] = [];
  for (const c of cands) {
    if (chosen.length >= EXIT.max) break;
    const [cx, cy] = centre(c);
    if (chosen.some(q => { const [qx, qy] = centre(q); return Math.hypot(qx - cx, qy - cy) < EXIT.apart; })) continue;
    // two exits never touch: hall + pocket footprints apart, neither view over the other's hall / pocket (it becomes floor)
    const foot = (q: Cand) => rectOf(q.dir, q.line, q.t0 - 1, q.t1 + 1, 0, q.Ls + EXIT.vest);
    const view = (q: Cand) => rectOf(q.dir, q.line, q.t0 - q.s, q.t1 + q.s, q.Ls + EXIT.vest, q.Ls + EXIT.vest + q.D);
    if (chosen.some(q => rectsTouch(foot(q), foot(c), 2) || rectsTouch(view(q), foot(c), 0) || rectsTouch(view(c), foot(q), 0))) continue;
    chosen.push(c);
  }
  // --- Carve / record --------------------------------------------------------------------------------------------------------
  const exits: MallStreetExit[] = [];
  for (const c of chosen) {
    const sg = SIGN[c.dir], alongX = c.dir === 'N' || c.dir === 'S';
    let hallArea = c.front;
    const ceil = r3(streetY + CLEAR.gallery);
    if (c.kind === 'entrance-hall') {
      const [x0, y0, x1, y1] = rectOf(c.dir, c.line, c.t0, c.t1, 0, c.Ls);
      const parent = layout.areas[c.front];
      const A: Area = {
        x: x0, y: y0, w: x1 - x0, h: y1 - y0, id: layout.areas.length, kind: 'concourse', type: 'retail-arcade', label: 'Street entrance · Level 1',
        ceil, parent: c.front, depth: (parent?.depth ?? 0) + 1, publicSpace: true, lighting: 'lit', role: 'mall', level: SL, floorY: streetY,
      };
      layout.areas.push(A);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; g.cells[i] = FLOOR; g.area[i] = A.id; g.ceil[i] = ceil; g.floor[i] = streetY; }
      hallArea = A.id;
    }
    // world geometry: the inner glazing plane (between hall row Ls-1 and the first rock row Ls), the facade, the opening
    const planeCell = c.dir === 'N' || c.dir === 'W' ? c.line - c.Ls + 1 : c.line + c.Ls;
    const plane = r3(planeCell * CELL);
    const facade = r3(plane + sg * EXIT.vest * CELL);
    const s0 = r3((c.t0 + EXIT.pier) * CELL), s1 = r3((c.t1 - EXIT.pier) * CELL);
    const hallCeil = c.kind === 'entrance-hall' ? ceil : (() => { const [hx, hy] = cellAt(c.dir, c.line, (c.t0 + c.t1) >> 1, c.Ls - 1); return r3(g.ceil[hy * W + hx]); })();
    const head = r3(Math.min(streetY + EXIT.head, hallCeil - 0.3));
    const boxOf = (t0: number, t1: number, d0: number, d1: number, y0: number, y1: number): MallRect & {y0: number; y1: number} => {
      const [x0, z0, x1, z1] = rectOf(c.dir, c.line, t0, t1, d0, d1);
      return {x0: r3(x0 * CELL), z0: r3(z0 * CELL), x1: r3(x1 * CELL), z1: r3(z1 * CELL), y0: r3(y0), y1: r3(y1)};
    };
    const collider = boxOf(c.t0 - 1, c.t1 + 1, c.Ls, c.Ls + EXIT.vest, streetY, hallCeil);
    const view = boxOf(c.t0 - c.s, c.t1 + c.s, c.Ls + EXIT.vest, c.Ls + EXIT.vest + c.D, streetY - EXIT.viewDown, streetY + EXIT.viewUp);
    // hall depth: the carved hall itself / the corridor's walkway rows straight back from the doors (up to 40 m)
    let depthCells = c.Ls;
    if (c.kind === 'corridor-end') {
      depthCells = 0;
      for (let d = -1; d >= -80; d--) { const [hx, hy] = cellAt(c.dir, c.line, (c.t0 + c.t1) >> 1, d); if (!isWalk(hx, hy)) break; depthCells++; }
    }
    const exit: MallStreetExit = {
      id: `exit-${exits.length + 1}`, kind: c.kind, level: SL, streetY, side: c.dir,
      door: {plane, s0, s1, y0: streetY, y1: head},
      panels: panelsOf(s0, s1, streetY, head),
      vestibule: r3(EXIT.vest * CELL), facade,
      collider, view,
      hall: {area: hallArea, depth: r3(depthCells * CELL), width: r3((c.t1 - c.t0) * CELL), ceil: hallCeil},
      locked: true, sign: 'EXIT CLOSED',
      seed: hashString(`mall-exit:${c.dir}:${c.line}:${c.t0}`, levelSeed >>> 0) >>> 0,
    };
    exits.push(exit);
    // daylight falling in through the glass (fixture-less, steady, green-cast like the Office's windows) — and down a long hall
    const inward = -sg;
    const k = Math.max(1, Math.round((s1 - s0) / 2.5));
    const addLight = (t: number, depth: number, power: number) => {
      const x = alongX ? t : plane + inward * depth, z = alongX ? plane + inward * depth : t;
      const [lx, ly] = [Math.floor(x / CELL), Math.floor(z / CELL)];
      if (lx < 0 || ly < 0 || lx >= W || ly >= H || g.cells[ly * W + lx] !== FLOOR) return;
      const l: LightPlacement = {
        x: r3(x), y: r3(Math.min(head - 0.12, hallCeil - 0.08)), z: r3(z), rot: alongX ? 0 : Math.PI / 2, area: g.area[ly * W + lx],
        broken: false, flicker: false, warm: false, power, dying: false, virtual: true, tint: DAYLIGHT_TINT, level: SL,
      };
      layout.lights.push(l);
    };
    for (let i = 0; i < k; i++) addLight(s0 + (s1 - s0) * (i + 0.5) / k, 0.9, 0.36);
    if (depthCells * CELL >= 8) addLight((s0 + s1) / 2, Math.min(depthCells * CELL - 1.5, 6), 0.22);
  }
  info.exits = exits;
  // per-levels-array caches (levelArrays, levelsOf) were built before the halls were carved: a fresh array key rebuilds them (the
  // Track2 attach does the same). Light-well apertures cannot change: a hall is flat floor under the floor-2 slab.
  if (chosen.some(c => c.kind === 'entrance-hall')) layout.levels = layout.levels.slice();
  MALL_EXIT_STATS.placed = exits.length;
  MALL_EXIT_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return exits;
}

/** Panes of a glazed opening along [s0, s1]: leaf pairs (two 0.9 m push-bar leaves each) centred, sidelights, a transom over all. */
export function panelsOf(s0: number, s1: number, y0: number, y1: number): MallStreetExit['panels'] {
  const out: {kind: 'door' | 'sidelight' | 'transom'; s0: number; s1: number; y0: number; y1: number}[] = [];
  const w = s1 - s0, pair = 2 * EXIT.leaf, mull = 0.1;
  const pairs = w >= 2 * pair + 3 * mull + 0.4 ? 2 : 1;
  const doors = pairs * pair + (pairs - 1) * mull;
  const a = s0 + (w - doors) / 2, leafTop = Math.min(y0 + EXIT.leafH, y1 - 0.1);
  if (a - s0 > 0.05) out.push({kind: 'sidelight', s0: r3(s0), s1: r3(a), y0, y1: r3(leafTop)});
  for (let p = 0; p < pairs; p++) {
    const b = a + p * (pair + mull);
    out.push({kind: 'door', s0: r3(b), s1: r3(b + EXIT.leaf), y0, y1: r3(leafTop)}, {kind: 'door', s0: r3(b + EXIT.leaf), s1: r3(b + pair), y0, y1: r3(leafTop)});
  }
  if (s1 - (a + doors) > 0.05) out.push({kind: 'sidelight', s0: r3(a + doors), s1: r3(s1), y0, y1: r3(leafTop)});
  if (y1 - leafTop > 0.15) out.push({kind: 'transom', s0: r3(s0), s1: r3(s1), y0: r3(leafTop + 0.05), y1: r3(y1)});
  return out;
}

function rectsTouch(a: [number, number, number, number], b: [number, number, number, number], m: number): boolean {
  return a[0] < b[2] + m && b[0] < a[2] + m && a[1] < b[3] + m && b[1] < a[3] + m;
}

/** Grid cells (street storey) of an exit's collider box — the SOLID cells behind its glazing (tests / QA). */
export function exitColliderCells(layout: StationLayout, e: MallStreetExit): number[] {
  const g = layout.levels[e.level].grid, out: number[] = [];
  const x0 = Math.round(e.collider.x0 / CELL), x1 = Math.round(e.collider.x1 / CELL), y0 = Math.round(e.collider.z0 / CELL), y1 = Math.round(e.collider.z1 / CELL);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
  return out;
}
