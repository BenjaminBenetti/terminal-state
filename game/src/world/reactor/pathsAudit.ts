// Task reactor-expansion-20261101 (lane PATHS): THE PATHWAY / COLLISION AUDIT of the Reactor — user feedback "bars going through the
// stair wells", "the railing is not cut out for ladders", "large steel beams often intersect walk ways … a full audit needs to be
// performed to make sure pathways are free of clipping". Pure (three.js math only, no renderer / DOM): runs in Node on real generated
// layouts (game/tests/reactor-x-paths-*.test.ts) and at build time (world/reactor/arch.ts hands the WalkVolume to the kit planner so
// the steel never lands in walkable space).
//
// THE BODY VOLUME (WalkVolume): every walkable cell of every storey (FLOOR / track bed, no blocking prop) — decks, galleries, landings,
// bridges, tower decks, the rim gallery and platform, rooms, doorways, the side complexes, and every stair-run cell with its PITCH LINE
// (two slices per ramp cell) — as a box from floor + BODY.foot to floor + BODY.h (1.9 m). The footprint is the cell; a side whose
// neighbour is not a walkable continuation (a wall, a rail / drop, a prop) is pulled in by BODY.edge (wall- / edge-mounted fixtures
// within 10 cm are designed edges: railings on the deck edge line, toe plates, wall paint, panel buttons). Interior cell boundaries are
// NOT pulled in, so a thin bar across a walkway is always caught. Ramp cells shared by two storey grids count once.
//
// THE SOLIDS: every instance the kit plan draws (KitPlan.parts: unit geometries as oriented boxes), its lamps, model placements
// (REACTOR_MODELS dims as oriented boxes), merged meshes (exact triangles), fan rotors, plus arch.ts's caged fixtures over GEN's pit
// lights — and the COLLISION world: railings (a rail with walkable floor at its base height on BOTH sides blocks a path), props / blocked
// cells on the designed path points (stair runs, link landings, ladder feet / heads, objective stand points, the train's door approaches)
// and the LADDER CLIMBS (the scripted climb path swept with the body against every rail and solid: the climb must not pass a rail).
//
// API (re-run after merging the side complexes; `areas` scopes the volume to a complex):
//   auditReactorPaths(layout, {models, areas, plan}) -> PathAuditReport {hits, byKind, …}
//   new WalkVolume(layout, {areas}) -> the KitWalk the kit planner consults (archKit.ts KitOptions.walk).

import * as THREE from 'three';
import {CELL, FLOOR, STEP_UP, VOID, rampHeight, type Grid} from '../../gen/grid';
import {floorNearCell, levelsOf, type Level, type RailRun} from '../../gen/levels';
import {ladderClimbPath, sampleClimb, CLIMB, type Ladder} from '../../gen/traversal';
import type {StationLayout} from '../../gen/stationTypes';
import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import {playerTrainPlacement} from '../../gen/playerTrain';
import {PLAYER_TRAIN_SPEC} from '../playerTrainSpec';
import {inPoly, planReactorKit, type KitGeo, type KitPlan, type KitWalk} from './archKit';
import {REACTOR_MODELS, REACTOR_PIECES, type ReactorPiece} from './archAssets';
import {isMounted, planMountedLamps} from './gaslightFixtures';
import {planMinesVisuals, type MineBox, type MinePlace} from './minesVisuals';
import {MINES_ANCHORS, MINES_MODELS, type MinesModel} from './minesAssets';
import {bunkerModelOrigin, bunkerModelPlacements} from './bunkerModels';
import {BUNKER_KINDS, BUNKER_MODELS} from '../../gen/reactor/complex/bunkerKinds';
import {MAP_BOARD, planMapBoards} from './mapBoardPlan';
import {screenFacing} from './restartViews';
import {BEACONS, planBeacons} from './startupBeaconPlan'; // task reactor-playtest-round2-20261102 (lane STARTUP): the orange beacons

/** The player body (m): radius, height above the floor (1.9 m: a 1.8 m person + margin), floor slack, edge tolerance. */
export const BODY = {r: 0.3, h: 1.9, foot: 0.03, edge: 0.1} as const;
/** Penetrations below this (m) are contact, not intrusion. */
export const PATH_EPS = 0.004;
/**
 * A solid whose top stays within this height (m) of every floor it touches is walked over, not into (the mine's rail line on its
 * sleepers, like the subway track bed's rails): reported as `checked.stepOver`, not as an intrusion.
 */
export const STEP_OVER = 0.16;

// ---------------------------------------------------------------------------------------------------------------------------
// Geometry: oriented box vs axis-aligned box (separating axes, with the penetration depth), triangle vs axis-aligned box

/** An oriented box: centre, unit axes (rows u0, u1, u2), half extents. */
export interface Obb { c: [number, number, number]; u: [number, number, number, number, number, number, number, number, number]; e: [number, number, number] }

/** Oriented box of a unit-geometry instance: matrix m applied to the local box lo..hi. Null for a degenerate matrix. */
export function obbOf(m: THREE.Matrix4, lo: readonly number[], hi: readonly number[]): Obb | null {
  const E = m.elements;
  const cols: [number, number, number][] = [[E[0], E[1], E[2]], [E[4], E[5], E[6]], [E[8], E[9], E[10]]];
  const u: number[] = [], e: number[] = [];
  const lc = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  for (let k = 0; k < 3; k++) {
    const [x, y, z] = cols[k], len = Math.hypot(x, y, z);
    if (!(len > 1e-9)) return null;
    u.push(x / len, y / len, z / len);
    e.push((len * Math.abs(hi[k] - lo[k])) / 2);
  }
  const c: [number, number, number] = [
    E[12] + cols[0][0] * lc[0] + cols[1][0] * lc[1] + cols[2][0] * lc[2],
    E[13] + cols[0][1] * lc[0] + cols[1][1] * lc[1] + cols[2][1] * lc[2],
    E[14] + cols[0][2] * lc[0] + cols[1][2] * lc[1] + cols[2][2] * lc[2],
  ];
  return {c, u: u as Obb['u'], e: e as Obb['e']};
}

/** World AABB of an oriented box: [x0, y0, z0, x1, y1, z1]. */
export function obbBounds(o: Obb): [number, number, number, number, number, number] {
  const r = [0, 0, 0];
  for (let j = 0; j < 3; j++) r[j] = o.e[0] * Math.abs(o.u[j]) + o.e[1] * Math.abs(o.u[3 + j]) + o.e[2] * Math.abs(o.u[6 + j]);
  return [o.c[0] - r[0], o.c[1] - r[1], o.c[2] - r[2], o.c[0] + r[0], o.c[1] + r[1], o.c[2] + r[2]];
}

/**
 * Penetration of an oriented box into an axis-aligned box (min overlap over the 15 separating axes, m): <= 0 = apart. Gottschalk's
 * test with B = the AABB (world axes): R[i][j] = u_i . w_j = u[3i + j].
 */
export function obbAabbDepth(o: Obb, b: readonly number[]): number {
  const hx = (b[3] - b[0]) / 2, hy = (b[4] - b[1]) / 2, hz = (b[5] - b[2]) / 2;
  const h = [hx, hy, hz];
  const T = [(b[0] + b[3]) / 2 - o.c[0], (b[1] + b[4]) / 2 - o.c[1], (b[2] + b[5]) / 2 - o.c[2]];
  const R = o.u, e = o.e, AR: number[] = [];
  for (let k = 0; k < 9; k++) AR.push(Math.abs(R[k]) + 1e-9);
  let depth = Infinity;
  // the AABB's axes
  for (let j = 0; j < 3; j++) {
    const ra = e[0] * AR[j] + e[1] * AR[3 + j] + e[2] * AR[6 + j];
    const d = ra + h[j] - Math.abs(T[j]);
    if (d <= 0) return d;
    if (d < depth) depth = d;
  }
  // the box's axes
  const t = [T[0] * R[0] + T[1] * R[1] + T[2] * R[2], T[0] * R[3] + T[1] * R[4] + T[2] * R[5], T[0] * R[6] + T[1] * R[7] + T[2] * R[8]];
  for (let i = 0; i < 3; i++) {
    const rb = h[0] * AR[3 * i] + h[1] * AR[3 * i + 1] + h[2] * AR[3 * i + 2];
    const d = e[i] + rb - Math.abs(t[i]);
    if (d <= 0) return d;
    if (d < depth) depth = d;
  }
  // the cross axes u_i x w_j
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
    const len = Math.sqrt(Math.max(0, 1 - R[3 * i + j] * R[3 * i + j]));
    if (len < 1e-6) continue; // parallel: covered by the face axes
    const ra = e[i1] * AR[3 * i2 + j] + e[i2] * AR[3 * i1 + j];
    const rb = h[j1] * AR[3 * i + j2] + h[j2] * AR[3 * i + j1];
    const dist = Math.abs(t[i2] * R[3 * i1 + j] - t[i1] * R[3 * i2 + j]);
    const d = (ra + rb - dist) / len;
    if (d <= 0) return d;
    if (d < depth) depth = d;
  }
  return depth;
}

/** Triangle vs axis-aligned box (Akenine-Möller's separating axes), with a small inward tolerance. */
export function triAabb(a: readonly number[], b: readonly number[], c: readonly number[], box: readonly number[], eps = PATH_EPS): boolean {
  const cx = (box[0] + box[3]) / 2, cy = (box[1] + box[4]) / 2, cz = (box[2] + box[5]) / 2;
  const h = [(box[3] - box[0]) / 2 - eps, (box[4] - box[1]) / 2 - eps, (box[5] - box[2]) / 2 - eps];
  if (h[0] <= 0 || h[1] <= 0 || h[2] <= 0) return false;
  const v = [[a[0] - cx, a[1] - cy, a[2] - cz], [b[0] - cx, b[1] - cy, b[2] - cz], [c[0] - cx, c[1] - cy, c[2] - cz]];
  for (let k = 0; k < 3; k++) {
    const mn = Math.min(v[0][k], v[1][k], v[2][k]), mx = Math.max(v[0][k], v[1][k], v[2][k]);
    if (mn > h[k] || mx < -h[k]) return false;
  }
  const f = [0, 1, 2].map(k => [v[(k + 1) % 3][0] - v[k][0], v[(k + 1) % 3][1] - v[k][1], v[(k + 1) % 3][2] - v[k][2]]);
  const n = [f[0][1] * f[1][2] - f[0][2] * f[1][1], f[0][2] * f[1][0] - f[0][0] * f[1][2], f[0][0] * f[1][1] - f[0][1] * f[1][0]];
  const sep = (ax: number[]): boolean => {
    if (Math.abs(ax[0]) + Math.abs(ax[1]) + Math.abs(ax[2]) < 1e-12) return false;
    const p = v.map(q => q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2]);
    const r = h[0] * Math.abs(ax[0]) + h[1] * Math.abs(ax[1]) + h[2] * Math.abs(ax[2]);
    return Math.min(p[0], p[1], p[2]) > r || Math.max(p[0], p[1], p[2]) < -r;
  };
  if (sep(n)) return false;
  for (const e of f) for (const w of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    if (sep([e[1] * w[2] - e[2] * w[1], e[2] * w[0] - e[0] * w[2], e[0] * w[1] - e[1] * w[0]])) return false;
  }
  return true;
}

/** Local extents of the kit's unit geometries (archMeshes.ts kitGeometry); null = a flat decal / sheet (never a solid). */
export function kitGeoExtents(geo: KitGeo | string): {lo: [number, number, number]; hi: [number, number, number]} | null {
  switch (geo) {
    case 'plane': return null; // painted bands / stencils / screen faces on walls
    case 'stripe': return {lo: [-0.5, -0.5, -0.005], hi: [0.5, 0.5, 0.005]}; // hazard stripes on the fascia face
    case 'cage': return {lo: [-0.6, -0.53, -0.6], hi: [0.6, 0.57, 0.6]};
    case 'blade': return {lo: [-1, -1, -0.1], hi: [1, 1, 0.1]};
    default: return {lo: [-0.5, -0.5, -0.5], hi: [0.5, 0.5, 0.5]};
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The walkable body volume

export interface WalkBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; level: number; cell: number; area: number; ramp: boolean }

export interface WalkOptions {
  /** Only these area ids (e.g. one side complex); default every walkable cell. */
  areas?: ReadonlySet<number>;
  /** Only cells inside these world rects (the runtime build: where the kit places anything — kitWalkRegions); default everywhere. */
  regions?: readonly {x0: number; z0: number; x1: number; z1: number}[];
  /** Body overrides (tests). */
  body?: Partial<typeof BODY>;
}

/**
 * Every walkable cell of every storey as body boxes, indexed by grid column (all storeys share one grid size). Implements the kit
 * planner's KitWalk: `intrudes(m, lo, hi)` (an instance would stand in walkable space) and `bandsIn(rect)` (walkable bands there).
 */
export class WalkVolume implements KitWalk {
  readonly W: number;
  readonly H: number;
  readonly boxes: WalkBox[] = [];
  private readonly start: Int32Array;
  private readonly list: Int32Array;
  readonly body: typeof BODY;

  constructor(readonly layout: StationLayout, opts: WalkOptions = {}) {
    this.body = {...BODY, ...opts.body};
    const levels: readonly Level[] = layout.levels?.length ? layout.levels : [{id: 0, role: 'main', grid: layout.grid, baseY: 0}];
    const g0 = levels[0].grid;
    this.W = g0.w; this.H = g0.h;
    const {foot, h: bh, edge} = this.body;
    const open = (g: Grid, i: number) => (g.cells[i] === FLOOR || g.cells[i] === VOID) && !g.blocked[i];
    const voidY = layout.trench?.floorY;
    // the collision railings' cell edges (a railing is a designed edge: the side it stands on is a boundary) with their base heights
    // numeric edge ids: a vertical cell edge (line lx, row cy) = 2 (cy (W + 1) + lx), a horizontal one (col cx, line ly) = that + 1
    const W1 = this.W + 1, vKey = (lx: number, cy: number) => 2 * (cy * W1 + lx), hKey = (cx: number, ly: number) => 2 * (ly * W1 + cx) + 1;
    const railEdge = new Map<number, number[]>();
    for (const r of layout.rails ?? []) {
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      if (len < 0.02) continue;
      const alongZ = Math.abs(r.x1 - r.x0) < 1e-3, alongX = Math.abs(r.z1 - r.z0) < 1e-3;
      if (!alongZ && !alongX) continue;
      for (let s = Math.min(0.05, len / 2); s < len; s += 0.1) {
        const u = s / len, x = r.x0 + (r.x1 - r.x0) * u, z = r.z0 + (r.z1 - r.z0) * u, y = r.y0 + (r.y1 - r.y0) * u;
        const key = alongZ ? vKey(Math.round(x / CELL), Math.floor(z / CELL)) : hKey(Math.floor(x / CELL), Math.round(z / CELL));
        let l = railEdge.get(key);
        if (!l) railEdge.set(key, (l = []));
        if (!l.some(q => Math.abs(q - y) < 0.05)) l.push(y);
      }
    }
    /** A walkable continuation across the cell side (dx, dy) at the edge point: no railing on it, some storey's open neighbour within a
     *  step. */
    const cont = (cx: number, cy: number, dx: number, dy: number, f: number, ex: number, ez: number): boolean => {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) return false;
      const rl = railEdge.size ? railEdge.get(dx ? vKey(dx > 0 ? cx + 1 : cx, cy) : hKey(cx, dy > 0 ? cy + 1 : cy)) : undefined;
      if (rl) for (const y of rl) if (Math.abs(y - f) < 0.6) return false;
      const j = ny * this.W + nx;
      for (const M of levels) {
        const gm = M.grid;
        if (!open(gm, j)) continue;
        if (Math.abs(floorNearCell(gm, j, nx, ny, ex, ez, voidY) - f) <= STEP_UP + 0.05) return true;
      }
      return false;
    };
    const per = new Int32Array(this.W * this.H);
    let inside: Uint8Array | null = null;
    if (opts.regions) {
      inside = new Uint8Array(this.W * this.H);
      for (const r of opts.regions) {
        for (let cy = Math.max(0, Math.floor(r.z0 / CELL)); cy <= Math.min(this.H - 1, Math.floor(r.z1 / CELL)); cy++) {
          for (let cx = Math.max(0, Math.floor(r.x0 / CELL)); cx <= Math.min(this.W - 1, Math.floor(r.x1 / CELL)); cx++) inside[cy * this.W + cx] = 1;
        }
      }
    }
    for (const L of levels) {
      const g = L.grid;
      for (let cy = 0; cy < this.H; cy++) for (let cx = 0; cx < this.W; cx++) {
        const i = cy * this.W + cx;
        if ((inside && !inside[i]) || !open(g, i)) continue;
        const area = g.area[i];
        if (opts.areas && !opts.areas.has(area)) continue;
        const ri = g.rampIdx[i];
        // a stair cell carved into two storey grids is one band: keep the first storey's copy
        if (ri >= 0) {
          let dup = false;
          for (const M of levels) if (M.id < L.id && M.grid.rampIdx[i] === ri && M.grid.ramps[ri] === g.ramps[ri]) { dup = true; break; }
          if (dup) continue;
        }
        const x0 = cx * CELL, z0 = cy * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
        const xm = x0 + CELL / 2, zm = z0 + CELL / 2;
        const sE = cont(cx, cy, 1, 0, floorNearCell(g, i, cx, cy, x1, zm, voidY), x1, zm) ? 0 : edge;
        const sW = cont(cx, cy, -1, 0, floorNearCell(g, i, cx, cy, x0, zm, voidY), x0, zm) ? 0 : edge;
        const sS = cont(cx, cy, 0, 1, floorNearCell(g, i, cx, cy, xm, z1, voidY), xm, z1) ? 0 : edge;
        const sN = cont(cx, cy, 0, -1, floorNearCell(g, i, cx, cy, xm, z0, voidY), xm, z0) ? 0 : edge;
        if (ri < 0) {
          const f = g.floorOf(i);
          this.boxes.push({x0: x0 + sW, y0: f + foot, z0: z0 + sN, x1: x1 - sE, y1: f + bh, z1: z1 - sS, level: L.id, cell: i, area, ramp: false});
          per[i]++;
          continue;
        }
        // a ramp cell: two slices along the run, each from its lowest pitch point to its highest + the body height
        const R = g.ramps[ri], ax = R.axis === 'x';
        const a0 = ax ? x0 : z0;
        for (let k = 0; k < 2; k++) {
          const s0 = a0 + (k * CELL) / 2, s1 = s0 + CELL / 2;
          const hA = rampHeight(R, s0), hB = rampHeight(R, s1);
          const lo = Math.min(hA, hB), hi = Math.max(hA, hB);
          const b: WalkBox = ax
            ? {x0: k === 0 ? x0 + sW : s0, x1: k === 1 ? x1 - sE : s1, z0: z0 + sN, z1: z1 - sS, y0: lo + foot, y1: hi + bh, level: L.id, cell: i, area, ramp: true}
            : {z0: k === 0 ? z0 + sN : s0, z1: k === 1 ? z1 - sS : s1, x0: x0 + sW, x1: x1 - sE, y0: lo + foot, y1: hi + bh, level: L.id, cell: i, area, ramp: true};
          this.boxes.push(b);
          per[i]++;
        }
      }
    }
    this.start = new Int32Array(this.W * this.H + 1);
    for (let i = 0; i < per.length; i++) this.start[i + 1] = this.start[i] + per[i];
    this.list = new Int32Array(this.boxes.length);
    const fill = this.start.slice(0, per.length);
    this.boxes.forEach((b, k) => { this.list[fill[b.cell]++] = k; });
  }

  /** Body boxes of the columns overlapping the world rect (each box once). */
  near(x0: number, z0: number, x1: number, z1: number, out: number[] = []): number[] {
    out.length = 0;
    const cx0 = Math.max(0, Math.floor(x0 / CELL)), cx1 = Math.min(this.W - 1, Math.floor(x1 / CELL));
    const cy0 = Math.max(0, Math.floor(z0 / CELL)), cy1 = Math.min(this.H - 1, Math.floor(z1 / CELL));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const i = cy * this.W + cx;
      for (let k = this.start[i]; k < this.start[i + 1]; k++) out.push(this.list[k]);
    }
    return out;
  }

  /** Body boxes an oriented box intrudes into (penetration > eps): [box index, depth] pairs. */
  obbHits(o: Obb, eps = PATH_EPS): [number, number][] {
    const bb = obbBounds(o), out: [number, number][] = [];
    for (const k of this.near(bb[0], bb[2], bb[3], bb[5], scratch)) {
      const b = this.boxes[k];
      if (bb[4] <= b.y0 || bb[1] >= b.y1 || bb[3] <= b.x0 || bb[0] >= b.x1 || bb[5] <= b.z0 || bb[2] >= b.z1) continue;
      const d = obbAabbDepth(o, [b.x0, b.y0, b.z0, b.x1, b.y1, b.z1]);
      if (d > eps) out.push([k, d]);
    }
    return out;
  }

  /** KitWalk: would a unit-geometry instance (matrix m, local box lo..hi, default the unit cube) stand in walkable space? */
  intrudes(m: THREE.Matrix4, lo: readonly number[] = UNIT_LO, hi: readonly number[] = UNIT_HI): boolean {
    const o = obbOf(m, lo, hi);
    return !!o && this.obbHits(o).length > 0;
  }

  /** KitWalk: the walkable body bands [y0, y1] (merged) of the boxes whose footprint touches the world rect. */
  bandsIn(x0: number, z0: number, x1: number, z1: number): {y0: number; y1: number}[] {
    const raw: [number, number][] = [];
    for (const k of this.near(x0, z0, x1, z1, scratch)) {
      const b = this.boxes[k];
      if (b.x1 <= x0 || b.x0 >= x1 || b.z1 <= z0 || b.z0 >= z1) continue;
      raw.push([b.y0, b.y1]);
    }
    raw.sort((p, q) => p[0] - q[0]);
    const out: {y0: number; y1: number}[] = [];
    for (const [a, c] of raw) {
      const last = out[out.length - 1];
      if (last && a <= last.y1 + 0.05) last.y1 = Math.max(last.y1, c);
      else out.push({y0: a, y1: c});
    }
    return out;
  }
}

const scratch: number[] = [];

/**
 * The world rects the kit planner places anything in (runtime WalkVolume regions): the pit outline's bounds + 3 m (decks, towers, wall
 * steel, doorways in the pit walls) and every generator's panel / cable run + 3 m (a generator in a side complex draws its riser and
 * cable there). The tests audit the whole level (no regions).
 */
export function kitWalkRegions(info: ReactorInfo): {x0: number; z0: number; x1: number; z1: number}[] {
  const m = 3, b = info.pit.bounds, out = [{x0: b.x0 - m, z0: b.z0 - m, x1: b.x1 + m, z1: b.z1 + m}];
  for (const g of info.generators) {
    const pts = [{x: g.x, z: g.z}, g.panel, ...g.cable];
    out.push({x0: Math.min(...pts.map(p => p.x)) - m, z0: Math.min(...pts.map(p => p.z)) - m, x1: Math.max(...pts.map(p => p.x)) + m, z1: Math.max(...pts.map(p => p.z)) + m});
  }
  return out;
}
const UNIT_LO = [-0.5, -0.5, -0.5] as const, UNIT_HI = [0.5, 0.5, 0.5] as const;

// ---------------------------------------------------------------------------------------------------------------------------
// The audit

export type PathSource = 'kit' | 'lamp' | 'model' | 'merged' | 'fan' | 'fixture' | 'extra' | 'rail' | 'prop' | 'ladder';

/** One intrusion: a solid (or a collision element) in walkable space — the deepest contact of that solid. */
export interface PathHit {
  /** What intrudes: the planner tag + part ('decks ibeam|steel'), 'model vessel', 'rail', 'ladder-rail' … */
  kind: string;
  source: PathSource;
  /** The walkable storey / area / cell of the deepest contact and its world point (body-box centre). */
  level: number;
  area: number;
  label: string;
  x: number;
  y: number;
  z: number;
  /** Penetration (m) and how many body boxes the solid touches. */
  depth: number;
  boxes: number;
  /** Stair-run cell (on a flight's pitch) at the deepest contact. */
  ramp: boolean;
}

export interface PathAuditReport {
  hits: PathHit[];
  /** Hit count per kind. */
  byKind: Record<string, number>;
  checked: {boxes: number; instances: number; lamps: number; models: number; merged: number; fans: number; fixtures: number; extras: number; carried: number; stepOver: number; rails: number; ladders: number; stands: number};
}

export interface PathAuditOptions extends WalkOptions {
  /** The plan to audit (default: planReactorKit like arch.ts, with `models` and the owned rails). */
  plan?: KitPlan;
  /** Which delivered models the plan draws: 'all' (the game, default), 'none' (the procedural fallback) or a set. */
  models?: 'all' | 'none' | ReadonlySet<ReactorPiece>;
  /** Hand the walk volume to the planner (the fixed kit: default true; false = the plan as if no walk volume existed). */
  walkAware?: boolean;
  /** Skip the collision-world checks (rails / props / ladders / stands). */
  kitOnly?: boolean;
  /**
   * The delivered models' REAL triangles by site-relative url (glbTriangles of the cooked GLB: Node tests read game/public/<url>).
   * A model whose box intrudes is then checked triangle by triangle (portal-shaped models: timber sets, the blast door, the vessel);
   * without it the box (or the measured anchor parts) stands for the model.
   */
  meshOf?: (url: string) => Float32Array | null | undefined;
}

type GltfJson = {
  nodes?: {mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]}[];
  scenes?: {nodes: number[]}[]; scene?: number;
  meshes: {primitives: {attributes: {POSITION: number}; indices?: number; mode?: number}[]}[];
  accessors: {bufferView: number; byteOffset?: number; componentType: number; count: number; type: string}[];
  bufferViews: {byteOffset?: number; byteLength: number; byteStride?: number}[];
  extensionsRequired?: string[];
};

/**
 * Triangles of an uncompressed binary glTF (positions only): xyz x 3 per triangle in the GLB's scene space (node transforms applied) —
 * the cooked Reactor models are plain single-mesh GLBs. Throws on anything it cannot read (a compressed / external-buffer file).
 */
export function glbTriangles(data: ArrayBuffer | Uint8Array): Float32Array {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('glbTriangles: not a GLB');
  let off = 12, json: GltfJson | null = null, bin: DataView | null = null;
  while (off + 8 <= u8.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(u8.subarray(off + 8, off + 8 + len))) as GltfJson;
    else if (type === 0x004e4942) bin = new DataView(u8.buffer, u8.byteOffset + off + 8, len);
    off += 8 + len;
  }
  if (!json || !bin || json.extensionsRequired?.length) throw new Error('glbTriangles: unsupported GLB');
  const J = json, B = bin, out: number[] = [];
  const read = (ai: number, k: number, c: number): number => {
    const a = J.accessors[ai], bv = J.bufferViews[a.bufferView], n = a.type === 'VEC3' ? 3 : 1;
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const at = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0) + k * (bv.byteStride ?? n * size) + c * size;
    switch (a.componentType) {
      case 5126: return B.getFloat32(at, true);
      case 5125: return B.getUint32(at, true);
      case 5123: return B.getUint16(at, true);
      default: return B.getUint8(at);
    }
  };
  const v = new THREE.Vector3();
  const walk = (ni: number, parent: THREE.Matrix4) => {
    const nd = J.nodes![ni];
    const t = nd.translation ?? [0, 0, 0], r = nd.rotation ?? [0, 0, 0, 1], sc = nd.scale ?? [1, 1, 1];
    const local = nd.matrix ? new THREE.Matrix4().fromArray(nd.matrix)
      : new THREE.Matrix4().compose(new THREE.Vector3(t[0], t[1], t[2]), new THREE.Quaternion(r[0], r[1], r[2], r[3]), new THREE.Vector3(sc[0], sc[1], sc[2]));
    const m = parent.clone().multiply(local);
    if (nd.mesh !== undefined) for (const pr of J.meshes[nd.mesh].primitives) {
      if ((pr.mode ?? 4) !== 4) continue;
      const pa = pr.attributes.POSITION, n = pr.indices !== undefined ? J.accessors[pr.indices].count : J.accessors[pa].count;
      for (let k = 0; k < n; k++) {
        const vi = pr.indices !== undefined ? read(pr.indices, k, 0) : k;
        v.set(read(pa, vi, 0), read(pa, vi, 1), read(pa, vi, 2)).applyMatrix4(m);
        out.push(v.x, v.y, v.z);
      }
    }
    for (const c of nd.children ?? []) walk(c, m);
  };
  const roots = J.scenes?.[J.scene ?? 0]?.nodes ?? (J.nodes ?? []).map((_, i) => i);
  for (const ri of roots) walk(ri, new THREE.Matrix4());
  return new Float32Array(out);
}

/** Bounds of a triangle soup: [x0, y0, z0, x1, y1, z1]. */
function triBounds(t: Float32Array): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], t[i + k]); b[3 + k] = Math.max(b[3 + k], t[i + k]); }
  return b;
}

/** arch.ts ReactorArch.ownsRail without the renderer: the pit-cell mask test at the rail's two sides. */
export function reactorOwnsRail(info: ReactorInfo, r: RailRun): boolean {
  if (r.kind === 'parapet') return false;
  const inPit = (x: number, z: number) => inPoly(info.pit.outline, (Math.floor(x / CELL) + 0.5) * CELL, (Math.floor(z / CELL) + 0.5) * CELL);
  const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
  return r.level > 0 || inPit(mx + r.nx * 0.3, mz + r.nz * 0.3) || inPit(mx - r.nx * 0.3, mz - r.nz * 0.3);
}

/** The delivered model set of an option. */
export function auditModels(m: PathAuditOptions['models'] = 'all'): ReadonlySet<ReactorPiece> {
  if (m === 'none') return new Set();
  if (m === 'all') return new Set(REACTOR_PIECES.filter(p => REACTOR_MODELS[p].delivered));
  return m;
}

/** The world fixture tube size (world/materials.ts WorldMaterials.fixture): the mounted lamps' lens mapping only. */
const FIXTURE_TUBE = {w: 1.2, h: 0.19, d: 0.18};

/** The kit plan exactly as arch.ts builds it (owned, visible rails; lane GASLIGHT's mounted pit lamps; the walk volume when walk-aware). */
export function auditPlan(layout: StationLayout, models: ReadonlySet<ReactorPiece>, walk?: KitWalk): KitPlan {
  const info = layout.reactor!;
  const rails = layout.rails.filter(r => !r.hidden && reactorOwnsRail(info, r));
  const fixtures = layout.lights.some(l => isMounted(l));
  const plan = planReactorKit(info, {models, rails, fixtures, ...(walk ? {walk} : {})});
  if (fixtures) { plan.tag = 'mounted-lamps'; planMountedLamps(plan, layout.lights, FIXTURE_TUBE); plan.tag = ''; }
  return plan;
}

/** Runs the whole audit on a generated Reactor layout. */
export function auditReactorPaths(layout: StationLayout, opts: PathAuditOptions = {}): PathAuditReport {
  const info = layout.reactor;
  if (!info) throw new Error('auditReactorPaths: not a Reactor layout');
  const vol = new WalkVolume(layout, opts);
  const full = opts.areas ? new WalkVolume(layout, {body: opts.body}) : vol;
  const models = auditModels(opts.models);
  const plan = opts.plan ?? auditPlan(layout, models, opts.walkAware === false ? undefined : full);
  const hits: PathHit[] = [];
  const checked: PathAuditReport['checked'] = {boxes: vol.boxes.length, instances: 0, lamps: 0, models: 0, merged: 0, fans: 0, fixtures: 0, extras: 0, carried: 0, stepOver: 0, rails: 0, ladders: 0, stands: 0};
  const label = (b: WalkBox) => layout.areas[b.area]?.label ?? `area ${b.area}`;
  const carried = propCarrier(layout), carriedPoint = propPointCarrier(layout);
  /** The body boxes a model's triangles (placement m) intrude into, skipping triangles inside a collision prop. */
  const meshHits = (tris: Float32Array, m: THREE.Matrix4): [number, number][] => {
    const w = new Float32Array(tris.length), v = new THREE.Vector3();
    for (let i = 0; i < tris.length; i += 3) { v.set(tris[i], tris[i + 1], tris[i + 2]).applyMatrix4(m); w[i] = v.x; w[i + 1] = v.y; w[i + 2] = v.z; }
    return triHits(vol, w, carriedPoint);
  };
  /** A model box hit refined by its real triangles when the caller provides them. */
  const refine = (found: [number, number][], m: THREE.Matrix4, url: string): [number, number][] => {
    if (!found.length) return found;
    const tris = opts.meshOf?.(url);
    return tris ? meshHits(tris, m) : found;
  };
  const record = (kind: string, source: PathSource, found: [number, number][], o?: Obb | null) => {
    if (!found.length) return;
    // a solid inside its own collision prop's box (a machine model, a cart, a bunk bed): visual and collision agree — not a clip
    if (o && carried(o)) { checked.carried++; return; }
    // floor-level detail the body walks over (rails / sleepers)
    if (o) { const top = obbBounds(o)[4]; if (found.every(([k]) => top <= vol.boxes[k].y0 - vol.body.foot + STEP_OVER)) { checked.stepOver++; return; } }
    let best = found[0];
    for (const f of found) if (f[1] > best[1]) best = f;
    const b = vol.boxes[best[0]];
    hits.push({kind, source, level: b.level, area: b.area, label: label(b), x: r2((b.x0 + b.x1) / 2), y: r2(b.y0), z: r2((b.z0 + b.z1) / 2), depth: r3(best[1]), boxes: found.length, ramp: b.ramp});
  };

  // --- kit instances ---------------------------------------------------------------------------------------------------------
  for (const [key, part] of plan.parts) {
    const ext = kitGeoExtents(part.geo);
    if (!ext) continue;
    for (const inst of part.list) {
      checked.instances++;
      const o = obbOf(inst.m, ext.lo, ext.hi);
      if (o) record(`${inst.tag || 'kit'} ${key}`, 'kit', vol.obbHits(o), o);
    }
  }
  for (const l of plan.lamps) {
    checked.lamps++;
    const o = obbOf(l.m, UNIT_LO, UNIT_HI);
    if (o) record(`${l.tag || 'kit'} lamp`, 'lamp', vol.obbHits(o));
  }
  // --- model placements (real-size dims: base at y 0, centred x / z) ---------------------------------------------------------
  for (const [piece, list] of plan.modelPlacements) {
    // a piece outside the registry (a later lane's own model key): its placement's scaled size (size, model space = placement) or skip
    const spec = (REACTOR_MODELS as Partial<Record<string, (typeof REACTOR_MODELS)[ReactorPiece]>>)[piece];
    for (const p of list) {
      checked.models++;
      const [W, Hh, D] = spec ? spec.dims : (p.size ?? [0, 0, 0]);
      if (!spec) {
        if (!(W > 0)) continue;
        const E = p.m.elements, k = Math.hypot(E[0], E[1], E[2]) || 1, o = obbOf(p.m, [-W / 2 / k, 0, -D / 2 / k], [W / 2 / k, Hh / k, D / 2 / k]);
        if (o) record(`${p.tag || 'kit'} model ${piece}`, 'model', vol.obbHits(o), o);
        continue;
      }
      if (piece === 'vessel' && !opts.meshOf?.(REACTOR_MODELS.vessel.url)) {
        // the round vessel: its hazard plinth (the widest solid at body height; the nozzles start above it) as a vertical cylinder
        const E = p.m.elements, s = Math.hypot(E[0], E[1], E[2]), A = REACTOR_MODELS.vessel.anchors!;
        record(`${p.tag || 'kit'} model vessel`, 'model', cylHits(vol, E[12], E[14], (A.plinthR as number) * s, E[13], E[13] + Hh * s));
        continue;
      }
      const o = obbOf(p.m, [-W / 2, 0, -D / 2], [W / 2, Hh, D / 2]);
      if (o) record(`${p.tag || 'kit'} model ${piece}`, 'model', refine(vol.obbHits(o), p.m, spec.url), o);
    }
  }
  // --- merged meshes (exact triangles) ---------------------------------------------------------------------------------------
  for (const mg of plan.merged) for (const g of mg.geos) {
    checked.merged++;
    record(`merged ${mg.name}`, 'merged', triHits(vol, g));
  }
  // --- fan rotors (a disc of the fan radius in the housing ring) -------------------------------------------------------------
  for (const f of plan.fans) {
    checked.fans++;
    const m = f.basis.clone().multiply(new THREE.Matrix4().makeScale(f.radius, f.radius, 1));
    const o = obbOf(m, [-1, -1, -0.1], [1, 1, 0.1]);
    if (o) record('fans rotor', 'fan', vol.obbHits(o));
  }
  // --- arch.ts's caged fixtures over GEN's pit lights (cage 0.26 x 0.34 under the light point, hanger above) ----------------------
  for (const l of layout.lights) {
    if (isMounted(l)) continue; // lane GASLIGHT's mounted lamps: their bodies are in the plan (planMountedLamps)
    if ((l as {virtual?: boolean}).virtual || !inPoly(info.pit.outline, (Math.floor(l.x / CELL) + 0.5) * CELL, (Math.floor(l.z / CELL) + 0.5) * CELL)) continue;
    checked.fixtures++;
    const o = obbOf(new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y - 0.19, l.z), new THREE.Quaternion(), new THREE.Vector3(0.26, 0.34, 0.26)), UNIT_LO, UNIT_HI);
    if (o) record('fixture pit-lamp', 'fixture', vol.obbHits(o));
  }
  // --- the visuals drawn outside the kit: the side complexes' builders (mines workings, bunker models), the map boards ----------
  for (const x of extraSolids(layout)) {
    checked.extras++;
    const found = vol.obbHits(x.o);
    if (!found.length) continue;
    if (x.model) {
      const tris = opts.meshOf?.(x.model.url);
      let m = x.model.m;
      if (tris && x.model.recentre) { const b = triBounds(tris); m = m.clone().multiply(new THREE.Matrix4().makeTranslation(-(b[0] + b[3]) / 2, -b[1], -(b[2] + b[5]) / 2)); }
      if (tris) { record(x.kind, 'extra', meshHits(tris, m), x.o); continue; }
      const parts = MODEL_PARTS[x.model.url];
      if (parts) { for (const [lo, hi] of parts) { const po = obbOf(m, lo, hi); if (po) record(x.kind, 'extra', vol.obbHits(po), po); } continue; }
    }
    record(x.kind, 'extra', found, x.o);
  }
  if (!opts.kitOnly) {
    checked.rails = railHits(layout, vol, hits, opts.areas);
    checked.ladders = ladderHits(layout, plan, hits);
    checked.stands = standHits(layout, hits, opts.areas);
  }
  const byKind: Record<string, number> = {};
  for (const h of hits) byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
  return {hits, byKind, checked};
}

/**
 * A collision prop carries the solid: every corner of the oriented box lies inside some prop's box of the layout (rotated, its height
 * band; grown by BODY.edge) — the body is pushed out of it there (core/physics.ts props), so what is drawn is what collides.
 */
export function propCarrier(layout: StationLayout): (o: Obb) => boolean {
  const props = layout.props;
  return (o: Obb) => {
    const bb = obbBounds(o), e = BODY.edge;
    const near = props.filter(p => {
      const r = Math.hypot(p.hx, p.hz) + e;
      return p.x + r > bb[0] && p.x - r < bb[3] && p.z + r > bb[2] && p.z - r < bb[5] && p.y - 0.05 < bb[4] && p.y + p.h + e > bb[1];
    });
    if (!near.length) return false;
    for (let k = 0; k < 8; k++) {
      const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1, sz = k & 4 ? 1 : -1;
      const x = o.c[0] + sx * o.e[0] * o.u[0] + sy * o.e[1] * o.u[3] + sz * o.e[2] * o.u[6];
      const y = o.c[1] + sx * o.e[0] * o.u[1] + sy * o.e[1] * o.u[4] + sz * o.e[2] * o.u[7];
      const z = o.c[2] + sx * o.e[0] * o.u[2] + sy * o.e[1] * o.u[5] + sz * o.e[2] * o.u[8];
      const inside = near.some(p => {
        if (y < p.y - 0.05 || y > p.y + p.h + e) return false;
        const c = Math.cos(p.rot ?? 0), s = Math.sin(p.rot ?? 0), dx = x - p.x, dz = z - p.z;
        // three.js Y rotation: the prop's local (lx, lz) -> world (lx c + lz s, -lx s + lz c)
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        return Math.abs(lx) <= p.hx + e && Math.abs(lz) <= p.hz + e;
      });
      if (!inside) return false;
    }
    return true;
  };
}

/** A point lies inside some collision prop's box (rotated; its height band; grown by BODY.edge). Indexed by cell. */
export function propPointCarrier(layout: StationLayout): (x: number, y: number, z: number) => boolean {
  const e = BODY.edge, idx = new Map<number, number[]>();
  layout.props.forEach((p, k) => {
    const r = Math.hypot(p.hx, p.hz) + e;
    for (let cx = Math.floor((p.x - r) / CELL); cx <= Math.floor((p.x + r) / CELL); cx++) for (let cz = Math.floor((p.z - r) / CELL); cz <= Math.floor((p.z + r) / CELL); cz++) {
      const key = cx * 65536 + cz;
      let l = idx.get(key);
      if (!l) idx.set(key, (l = []));
      l.push(k);
    }
  });
  return (x: number, y: number, z: number) => (idx.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)) ?? []).some(k => {
    const p = layout.props[k];
    if (y < p.y - 0.05 || y > p.y + p.h + e) return false;
    const c = Math.cos(p.rot ?? 0), s = Math.sin(p.rot ?? 0), dx = x - p.x, dz = z - p.z;
    return Math.abs(dx * c - dz * s) <= p.hx + e && Math.abs(dx * s + dz * c) <= p.hz + e;
  });
}

/**
 * Measured solid PARTS of portal-shaped models (model space), used when the GLB triangles are not provided: the timber set's two posts
 * and its cap (world/reactor/minesAssets.ts MINES_ANCHORS: inner post faces +-1.03, cap underside 1.79, top 2.516).
 */
const MODEL_PARTS: Record<string, [number[], number[]][]> = (() => {
  const T = MINES_ANCHORS.timberSet, [W, , D] = MINES_MODELS.timberSet.dims;
  return {[MINES_MODELS.timberSet.url]: [
    [[-W / 2, 0, -D / 2], [-T.postInner, T.capUnder, D / 2]], [[T.postInner, 0, -D / 2], [W / 2, T.capUnder, D / 2]], [[-W / 2, T.capUnder, -D / 2], [W / 2, T.top, D / 2]],
  ]};
})();

/** A visual solid drawn outside the kit plan (tagged); a model also carries its placement (model space -> world) and GLB url. */
export interface ExtraSolid { kind: string; o: Obb; model?: {m: THREE.Matrix4; url: string; recentre?: number} }

/**
 * Every visual solid the Reactor draws OUTSIDE the kit plan, as oriented boxes — the generic hook for the side complexes' own builders
 * (re-run the audit after a complex lands; add its builder's plan here):
 *  - lane MINES (world/reactor/minesVisuals.ts planMinesVisuals): timber sets / carts / winch / drill models, timber / rail / steel /
 *    rock boxes (cribs, rubble, the winze, the rail line), sheave wheels (the standing-water surface is a wade-through effect);
 *  - lane BUNKER (world/reactor/bunkerModels.ts): the hero models on their prop placements (blast door, filtration unit, radio, bunks);
 *  - lane CONTROLS (world/reactor/mapBoardPlan.ts planMapBoards): the floor-map boards beside the instruction screens.
 */
export function extraSolids(layout: StationLayout): ExtraSolid[] {
  const out: ExtraSolid[] = [];
  const push = (kind: string, m: THREE.Matrix4, lo: readonly number[], hi: readonly number[], model?: ExtraSolid['model']) => { const o = obbOf(m, lo, hi); if (o) out.push({kind, o, ...(model ? {model} : {})}); };
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), eu = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0);
  const mp = planMinesVisuals(layout);
  if (mp) {
    for (const [mat, list] of Object.entries(mp.boxes) as [string, MineBox[]][]) {
      if (mat === 'water') continue;
      for (const b of list) {
        eu.set(b.rx ?? 0, b.yaw, b.rz ?? 0, 'YXZ');
        push(`mines ${mat}`, new THREE.Matrix4().compose(p.set(b.x, b.y, b.z), q.setFromEuler(eu), sc.set(b.w, b.h, b.d)), UNIT_LO, UNIT_HI);
      }
    }
    for (const w of mp.sheaves) push('mines sheave', new THREE.Matrix4().compose(p.set(w.x, w.y, w.z), q.setFromAxisAngle(UP, w.yaw), sc.set(w.r, w.r, w.r)), [-1.08, -1.08, -0.08], [1.08, 1.08, 0.08]);
    for (const [key, list] of Object.entries(mp.models) as [MinesModel, MinePlace[]][]) {
      const [W, Hh, D] = MINES_MODELS[key].dims;
      for (const m of list) {
        const M = new THREE.Matrix4().compose(p.set(m.x, m.y, m.z), q.setFromAxisAngle(UP, m.yaw), sc.set(m.sx, m.sy, m.sz));
        push(`mines model ${key}`, M, [-W / 2, 0, -D / 2], [W / 2, Hh, D / 2], {m: M, url: MINES_MODELS[key].url});
      }
    }
  }
  for (const kind of BUNKER_KINDS) {
    const spec = BUNKER_MODELS[kind], [W, Hh, D] = spec.model.dims, k = spec.scale;
    for (const pl of bunkerModelPlacements(layout, kind)) {
      const [x, z] = bunkerModelOrigin(pl);
      const M = new THREE.Matrix4().compose(p.set(x, pl.y, z), q.setFromAxisAngle(UP, pl.rot), sc.set(k, k, k));
      push(`bunker model ${kind}`, M, [-W / 2, 0, -D / 2], [W / 2, Hh, D / 2], {m: M, url: spec.model.url, recentre: 1}); // (bunkerModels.ts re-centres on the measured box)
    }
  }
  const info = layout.reactor;
  if (info) {
    const openAt = (x: number, z: number, level: number): boolean => {
      const g = layout.levels?.[level]?.grid ?? (level === 0 ? layout.grid : null);
      if (!g) return true;
      const [cx, cy] = g.cellOf(x, z);
      return g.inBounds(cx, cy) && g.passable(cx, cy);
    };
    for (const b of planMapBoards(layout, info, s => screenFacing(s, openAt))) {
      const d = MAP_BOARD.depth;
      push('map board', new THREE.Matrix4().compose(p.set(b.x - b.nx * d / 2, b.y, b.z - b.nz * d / 2), q.setFromAxisAngle(UP, Math.atan2(b.nx, b.nz)), sc.set(MAP_BOARD.w, MAP_BOARD.h, d)), UNIT_LO, UNIT_HI);
    }
    // task reactor-playtest-round2-20261102 (lane STARTUP): every beacon's envelope on its wall bracket (plate .. head top, wall face .. pedestal rim)
    const B = BEACONS;
    for (const s of planBeacons(layout)) {
      push('beacon', new THREE.Matrix4().compose(p.set(s.x, s.y, s.z), q.setFromAxisAngle(UP, Math.atan2(s.nx, s.nz)), sc.set(1, 1, 1)),
        [-B.plate.w / 2, B.plate.y - B.plate.h / 2, 0], [B.plate.w / 2, B.head.h, B.out + B.pedestal.r]);
    }
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Body boxes a vertical cylinder (centre x / z, radius r, y0..y1) intrudes into. */
function cylHits(vol: WalkVolume, cx: number, cz: number, r: number, y0: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  for (const k of vol.near(cx - r, cz - r, cx + r, cz + r, [])) {
    const b = vol.boxes[k];
    if (y1 <= b.y0 || y0 >= b.y1) continue;
    const qx = Math.max(b.x0, Math.min(cx, b.x1)), qz = Math.max(b.z0, Math.min(cz, b.z1));
    const d = r - Math.hypot(qx - cx, qz - cz);
    if (d > PATH_EPS) out.push([k, d]);
  }
  return out;
}

/** Body boxes the triangles of a (world-space) geometry / triangle soup intrude into (a triangle inside a collision prop is skipped). */
function triHits(vol: WalkVolume, g: THREE.BufferGeometry | Float32Array, carried?: (x: number, y: number, z: number) => boolean): [number, number][] {
  const soup = g instanceof Float32Array ? g : null;
  const pos = soup ? null : (g as THREE.BufferGeometry).getAttribute('position');
  if (!soup && !pos) return [];
  const idx = soup ? null : (g as THREE.BufferGeometry).getIndex();
  const n = soup ? soup.length / 3 : idx ? idx.count : pos!.count;
  const depthOf = new Map<number, number>(), out: [number, number][] = [];
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  const get = (k: number, P: number[]) => {
    if (soup) { P[0] = soup[3 * k]; P[1] = soup[3 * k + 1]; P[2] = soup[3 * k + 2]; return; }
    const i = idx ? idx.getX(k) : k; P[0] = pos!.getX(i); P[1] = pos!.getY(i); P[2] = pos!.getZ(i);
  };
  const near: number[] = [];
  for (let t = 0; t + 2 < n; t += 3) {
    get(t, A); get(t + 1, B); get(t + 2, C);
    if (carried && carried(A[0], A[1], A[2]) && carried(B[0], B[1], B[2]) && carried(C[0], C[1], C[2])) continue;
    const x0 = Math.min(A[0], B[0], C[0]), x1 = Math.max(A[0], B[0], C[0]), z0 = Math.min(A[2], B[2], C[2]), z1 = Math.max(A[2], B[2], C[2]);
    const y0 = Math.min(A[1], B[1], C[1]), y1 = Math.max(A[1], B[1], C[1]);
    for (const k of vol.near(x0, z0, x1, z1, near)) {
      const b = vol.boxes[k];
      if (y1 <= b.y0 || y0 >= b.y1 || x1 <= b.x0 || x0 >= b.x1 || z1 <= b.z0 || z0 >= b.z1) continue;
      // penetration: the deepest vertex inside the box (horizontal distance to its nearest side); a crossing triangle counts 5 mm
      let d = 0.005;
      for (const P of [A, B, C]) {
        if (P[1] <= b.y0 || P[1] >= b.y1) continue;
        d = Math.max(d, Math.min(P[0] - b.x0, b.x1 - P[0], P[2] - b.z0, b.z1 - P[2]));
      }
      const had = depthOf.get(k);
      if (had !== undefined && had >= d) continue;
      if (triAabb(A, B, C, [b.x0, b.y0, b.z0, b.x1, b.y1, b.z1])) depthOf.set(k, d);
    }
  }
  for (const [k, d] of depthOf) out.push([k, Math.round(d * 1000) / 1000]);
  return out;
}

/**
 * Collision rails across a path: a rail edge with an open, unblocked walkable cell at its base height (within a step) on BOTH sides
 * (a body must cross it to continue). Counted per rail run.
 */
function railHits(layout: StationLayout, vol: WalkVolume, hits: PathHit[], areas?: ReadonlySet<number>): number {
  const levels = layout.levels?.length ? layout.levels : [{id: 0, role: 'main' as const, grid: layout.grid, baseY: 0}];
  const voidY = layout.trench?.floorY;
  const walkAt = (x: number, z: number, y: number): {level: number; area: number} | null => {
    for (const L of levels) {
      const g = L.grid, [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy)) continue;
      const i = g.idx(cx, cy);
      if (!(g.cells[i] === FLOOR || g.cells[i] === VOID) || g.blocked[i]) continue;
      if (Math.abs(floorNearCell(g, i, cx, cy, x, z, voidY) - y) <= STEP_UP) return {level: L.id, area: g.area[i]};
    }
    return null;
  };
  let n = 0;
  for (const r of layout.rails) {
    n++;
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    if (len < 0.05) continue;
    let bad = 0, at: {x: number; z: number; y: number; level: number; area: number} | null = null;
    for (let s = Math.min(0.25, len / 2); s < len; s += CELL) {
      const u = s / len, x = r.x0 + (r.x1 - r.x0) * u, z = r.z0 + (r.z1 - r.z0) * u, y = r.y0 + (r.y1 - r.y0) * u;
      const a = walkAt(x + r.nx * 0.2, z + r.nz * 0.2, y), b = walkAt(x - r.nx * 0.2, z - r.nz * 0.2, y);
      if (!a || !b) continue;
      if (areas && !areas.has(a.area) && !areas.has(b.area)) continue;
      bad++;
      at ??= {x, z, y, level: a.level, area: a.area};
    }
    if (bad && at) hits.push({kind: 'rail across a path', source: 'rail', level: at.level, area: at.area, label: layout.areas[at.area]?.label ?? '', x: r2(at.x), y: r2(at.y), z: r2(at.z), depth: 0, boxes: bad, ramp: false});
  }
  void vol;
  return n;
}

/**
 * Ladder climbs (player and AI share ladderClimbPath): the body (shoulder half width 0.25 m, feet + 0.05 .. + 1.8) swept along the
 * up-climb against every collision rail (base .. top) and every kit solid except the ladder's own pieces (tag 'ladder').
 */
function ladderHits(layout: StationLayout, plan: KitPlan, hits: PathHit[]): number {
  const ladders = layout.traversal.ladders;
  if (!ladders.length) return 0;
  const Lv = levelsOf(layout);
  const solids: {o: Obb; kind: string}[] = [];
  const bound = ladders.map(l => [Math.min(l.x, l.x) - 1.5, Math.min(l.faceZ - 1.5, l.faceZ + 1.5), l.x + 1.5, l.faceZ + 1.5, Math.min(l.bottomY, l.topY) - 0.5, Math.max(l.bottomY, l.topY) + 2.5]);
  const nearAny = (bb: number[]) => bound.some(q => !(bb[3] < q[0] || bb[0] > q[2] || bb[5] < q[1] || bb[2] > q[3] || bb[4] < q[4] || bb[1] > q[5]));
  for (const [key, part] of plan.parts) {
    const ext = kitGeoExtents(part.geo);
    if (!ext) continue;
    for (const inst of part.list) {
      if (inst.tag === 'ladder') continue;
      const o = obbOf(inst.m, ext.lo, ext.hi);
      if (o && nearAny(obbBounds(o))) solids.push({o, kind: `${inst.tag || 'kit'} ${key}`});
    }
  }
  const p = {x: 0, y: 0, z: 0};
  for (const l of ladders) {
    for (const [who, sp] of [['player', CLIMB.player], ['zombie', CLIMB.zombie]] as const) {
      const from = {x: l.x, y: l.bottomY, z: l.faceZ - l.dir * 0.9};
      const path = ladderClimbPath(l, true, from, sp);
      const T = path.t[path.t.length - 1];
      const railHit = new Set<RailRun>(), solidHit = new Map<string, number>();
      for (let t = path.t[1]; t <= T + 1e-9; t += 0.02) {
        sampleClimb(path, t, p);
        const box = [p.x - 0.25, p.y + 0.05, p.z - 0.25, p.x + 0.25, p.y + 1.8, p.z + 0.25];
        for (const r of Lv.rails) {
          if (railHit.has(r)) continue;
          const xa = Math.min(r.x0, r.x1) - 0.03, xb = Math.max(r.x0, r.x1) + 0.03, za = Math.min(r.z0, r.z1) - 0.03, zb = Math.max(r.z0, r.z1) + 0.03;
          if (xb <= box[0] || xa >= box[3] || zb <= box[2] || za >= box[5]) continue;
          const base = r.y0 + (r.y1 - r.y0) * clamp01(Math.hypot(p.x - r.x0, p.z - r.z0) / (Math.hypot(r.x1 - r.x0, r.z1 - r.z0) || 1));
          if (base + (r.h ?? 1.1) <= box[1] || base >= box[4]) continue;
          railHit.add(r);
        }
        for (const s of solids) {
          const d = obbAabbDepth(s.o, box);
          if (d > 0.02) solidHit.set(s.kind, Math.max(solidHit.get(s.kind) ?? 0, d));
        }
      }
      const lv = l.topLevel ?? 0, area = l.platform;
      if (railHit.size) hits.push({kind: `ladder climb through a rail (${who})`, source: 'ladder', level: lv, area, label: layout.areas[area]?.label ?? '', x: r2(l.x), y: r2(l.topY), z: r2(l.faceZ), depth: 0, boxes: 1, ramp: false});
      for (const [kind, d] of solidHit) hits.push({kind: `ladder climb through ${kind} (${who})`, source: 'ladder', level: lv, area, label: layout.areas[area]?.label ?? '', x: r2(l.x), y: r2(l.topY), z: r2(l.faceZ), depth: r3(d), boxes: 1, ramp: false});
    }
  }
  return ladders.length;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Designed path points: link landings, ladder feet / heads, objective stand points, the train's door approaches. */
export function pathStandPoints(layout: StationLayout): {what: string; level: number; x: number; z: number; r: number}[] {
  const out: {what: string; level: number; x: number; z: number; r: number}[] = [];
  for (const k of layout.levelLinks ?? []) {
    out.push({what: `${k.kind} link ${k.id} bottom`, level: k.lower, x: k.bottom.x, z: k.bottom.z, r: BODY.r});
    out.push({what: `${k.kind} link ${k.id} top`, level: k.upper, x: k.top.x, z: k.top.z, r: BODY.r});
  }
  for (const l of layout.traversal.ladders as Ladder[]) {
    if (l.kind !== 'maintenance') continue;
    out.push({what: `ladder ${l.id} foot`, level: l.level ?? 0, x: l.bottom.x, z: l.bottom.z, r: BODY.r});
    out.push({what: `ladder ${l.id} head`, level: l.topLevel ?? 0, x: l.top.x, z: l.top.z, r: BODY.r});
  }
  const info = layout.reactor;
  if (info) {
    for (const s of info.sites) for (const c of s.controls) out.push({what: `${s.id} ${c.id} stand`, level: c.stand.level, x: c.stand.x, z: c.stand.z, r: BODY.r});
    for (const g of info.generators) out.push({what: `generator ${g.id} use`, level: g.use.level, x: g.use.x, z: g.use.z, r: BODY.r});
  }
  const tp = playerTrainPlacement(layout);
  if (tp) {
    // the platform-side doors (spec side -1): the stand point 0.8 m in from the platform edge in front of each opening
    for (const d of PLAYER_TRAIN_SPEC.doors) {
      if (d.side !== -1) continue;
      out.push({what: `train door ${d.x.toFixed(1)}`, level: tp.level, x: tp.x + tp.front * d.x, z: tp.platformEdgeZ + tp.platformSide * 0.8, r: BODY.r});
    }
  }
  return out;
}

/** Stand points free of blocked cells, collision props (vertical overlap with the body) and rails. */
function standHits(layout: StationLayout, hits: PathHit[], areas?: ReadonlySet<number>): number {
  const Lv = levelsOf(layout);
  const pts = pathStandPoints(layout);
  for (const p of pts) {
    const L = layout.levels?.[p.level] ?? {id: 0, grid: layout.grid}, g = L.grid;
    const [cx, cy] = g.cellOf(p.x, p.z);
    if (!g.inBounds(cx, cy)) continue;
    const area = g.area[g.idx(cx, cy)];
    if (areas && !areas.has(area)) continue;
    const feet = g.floorAt(p.x, p.z);
    const why: string[] = [];
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (!g.inBounds(x, y)) continue;
      const i = g.idx(x, y);
      const nx = Math.max(x * CELL, Math.min(p.x, (x + 1) * CELL)), nz = Math.max(y * CELL, Math.min(p.z, (y + 1) * CELL));
      if (Math.hypot(nx - p.x, nz - p.z) >= p.r - 0.02) continue;
      if (g.blocked[i]) why.push('blocked cell');
    }
    for (const pr of layout.props) {
      if ((pr.level ?? 0) !== p.level) continue;
      if (pr.y + pr.h <= feet + 0.05 || pr.y >= feet + BODY.h) continue;
      const c = Math.cos(pr.rot ?? 0), s = Math.sin(pr.rot ?? 0), dx = p.x - pr.x, dz = p.z - pr.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const qx = Math.max(-pr.hx, Math.min(pr.hx, lx)), qz = Math.max(-pr.hz, Math.min(pr.hz, lz));
      if (Math.hypot(lx - qx, lz - qz) < p.r - 0.02) why.push(`prop ${pr.kind}`);
    }
    for (const r of Lv.rails) {
      const ex = r.x1 - r.x0, ez = r.z1 - r.z0, L2 = ex * ex + ez * ez || 1;
      const t = clamp01(((p.x - r.x0) * ex + (p.z - r.z0) * ez) / L2);
      const base = r.y0 + (r.y1 - r.y0) * t;
      if (base + (r.h ?? 1.1) <= feet + 0.05 || base >= feet + BODY.h) continue;
      if (Math.hypot(r.x0 + ex * t - p.x, r.z0 + ez * t - p.z) < p.r - 0.02) why.push('rail');
    }
    if (why.length) hits.push({kind: `stand point blocked (${[...new Set(why)].join(', ')})`, source: 'prop', level: p.level, area, label: `${p.what} · ${layout.areas[area]?.label ?? ''}`, x: r2(p.x), y: r2(feet), z: r2(p.z), depth: 0, boxes: 1, ramp: false});
  }
  return pts.length;
}

/** A compact text summary of a report (diagnostics / test messages). */
export function pathAuditSummary(rep: PathAuditReport, max = 12): string {
  const kinds = Object.entries(rep.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} x ${k}`);
  const first = rep.hits.slice(0, max).map(h => `${h.kind} @ L${h.level} (${h.x}, ${h.y}, ${h.z}) ${h.label} depth ${h.depth} boxes ${h.boxes}${h.ramp ? ' [stairs]' : ''}`);
  return [`${rep.hits.length} intrusions`, ...kinds, '--', ...first].join('\n');
}
