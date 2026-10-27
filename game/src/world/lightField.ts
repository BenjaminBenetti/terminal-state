// Iteration 05 (Lane L): persistent, camera-independent station lighting.
//
// Every fixture's on/off/flicker/dying state is layout data (gen/stationDress.ts applyLighting). This
// module bakes ALL working fixtures of a station, once on load, into a world-space light field:
// a W x H grid (one texel per 0.5 m nav cell) with LAYERS height layers spanning each column's own
// floor..ceiling (so per-cell floor heights - track bed, underpass stairs - are respected). Each voxel
// holds the tinted irradiance from every visible fixture (2D grid line of sight + per-layer height
// clearance against every traversed cell's floor/ceiling, soft transmittance through sight-blocking
// props), its dominant light direction and a share for the time-varying "flicker circuits", plus a
// cheap wall-respecting bounce fill.
//
// At runtime the field is handed to three r186's built-in light-probe-grid path (WebGLRenderer pushes
// any scene object with `isLightProbeGrid`, defines USE_LIGHT_PROBES_GRID for every lit material and
// uploads probesSH/probesMin/probesMax/probesResolution) - so static world, storefronts, GLB props,
// zombies, items and every future lit material sample it automatically with no per-material patches.
// The decoding chunk (lightprobes_pars_fragment) is replaced by ours, and lights_fragment_begin feeds
// the field's directional part through RE_Direct (N.L diffuse + GGX specular) and the rest into the
// indirect irradiance. `probesResolution` carries the three flicker-circuit levels (see
// LightFieldVolume). Nothing here depends on the camera: a fixture 60 m away lights its pool exactly
// as it does when you stand under it.

import * as THREE from 'three';
import {CELL, SOLID, VOID, type Grid} from '../gen/grid';
import type {LightPlacement} from '../gen/station';

// ---------------------------------------------------------------------------------------------
// Tunables

/** Height layers per column (relative floor..ceiling). Texture depth = 1 + 2 * LAYERS slices. */
export const LAYERS = 4;
/** Relative height of each layer between the column floor (0) and ceiling (1). */
const LAYER_T = [0, 1 / 3, 2 / 3, 1];
/** Encoded irradiance range (sqrt-encoded in 8 bits: fine steps in the dark, headroom in pools). */
export const FIELD_EMAX = 12;
/** Soft transmittance through cells holding sight-blocking props (columns, tall cabinets). */
const PROP_TRANSMITTANCE = 0.55;
/** Height tolerance when a ray grazes a floor/ceiling/lintel (m). */
const CLEAR_EPS = 0.08;

/** Bake parameters (the scene "mood"); see MOOD in lights.ts for the user-facing knobs. */
export interface FieldParams {
  /** Fixture output scale (irradiance at 1 m from a full-power tube, straight below). */
  gain: number;
  /** Max reach of one fixture (m) at full power; scaled by sqrt(power). Window fades to 0 there. */
  range: number;
  /** Emission straight up/sideways relative to straight down (0..1). Lower = tighter pools. */
  uplight: number;
  /** Downward lobe: emission ~ uplight + (1 - uplight) * cos^lobe (1 or 2; 2 = tighter pools). */
  lobe: 1 | 2;
  /** Share of non-directional (scattered) light that reaches any surface. */
  scatter: number;
  /** Bounce fill as a fraction of the local/area direct light (0 = black between pools). */
  bounce: number;
}

export const DEFAULT_FIELD: FieldParams = {gain: 21, range: 9, uplight: 0.16, lobe: 2, scatter: 0.17, bounce: 0.1};

/**
 * Light colour per fixture kind (linear RGB, ~unit luminance). Concept-board grading: cool-white
 * fluorescents with a sickly green cast, aged tubes yellow-green, a minority of warm sodium/incandescent.
 */
export const TINT = {
  cool: [0.88, 1.03, 0.92] as const,
  aged: [0.95, 1.04, 0.6] as const,
  warm: [1.38, 0.86, 0.42] as const,
};

export function fixtureTint(l: Pick<LightPlacement, 'warm' | 'power'>): readonly [number, number, number] {
  return l.warm ? TINT.warm : l.power < 0.8 ? TINT.aged : TINT.cool;
}

// ---------------------------------------------------------------------------------------------
// Flicker circuits: fixture state is layout data; time-varying fixtures share one of three circuits so
// the baked field can follow them (the shader scales each circuit's share by its current level).

export const FLICKER_GROUPS = 3;

/** -1 = steady (or broken), 0/1 = flickering circuits, 2 = dying (sputtering) circuit. */
export function fixtureGroup(l: Pick<LightPlacement, 'broken' | 'flicker' | 'dying'>, index: number): number {
  if (l.broken) return -1;
  if (l.dying) return 2;
  if (l.flicker) return ((index * 2654435761) >>> 0) % 2;
  return -1;
}

/** Brightness 0..1 of a flicker circuit at time t (s). Deterministic; never depends on the camera. */
export function groupLevel(g: number, t: number): number {
  if (g === 2) {
    // Mostly dead: a sputtering burst every several seconds.
    const s = Math.sin(t * 0.83) + Math.sin(t * 2.31 + 0.7) * 0.7;
    if (s < 1.3) return 0;
    return Math.abs(Math.sin(t * 31)) > 0.4 ? 0.85 : 0.08;
  }
  if (g === 0 || g === 1) {
    // Mostly on, with irregular stutters (the two circuits are de-phased and run at slightly different rates).
    const u = g === 0 ? t : t * 1.13 + 5.3;
    const s = Math.sin(u * 1.3) + Math.sin(u * 3.7 + 1.1) * 0.6 + Math.sin(u * 17.0) * 0.25;
    return s > 1.2 ? 0.15 + 0.2 * Math.abs(Math.sin(u * 40)) : 0.92;
  }
  return 1;
}

// ---------------------------------------------------------------------------------------------
// Bake

export interface FieldSource {
  grid: Grid;
  lights: readonly LightPlacement[];
  /** Track-bed floor (VOID cells) when no per-cell floor height is available. */
  trenchFloorY: number;
  /** Per-cell floor height (cell coords). Defaults to cellFloorFn(grid, trenchFloorY). */
  floorAt?: (cx: number, cy: number) => number;
}

export interface BakedField {
  w: number; h: number; layers: number; depth: number;
  /** RGBA8 voxels, slice-major: ((slice * h + y) * w + x) * 4. Slice 0 = heights + circuit shares. */
  data: Uint8Array;
  /** Height encoding range (slice 0 R/G). */
  yMin: number; yMax: number;
  /** Grid cells per texel in X/Z (1 = full resolution; see downsampleField). */
  cellScale?: number;
  /** Flicker circuit per light (-1 steady/broken). */
  groups: Int8Array;
  stats: {ms: number; bytes: number; fixtures: number; working: number; steady: number; circuits: [number, number, number]; rays: number};
}

/**
 * Per-cell floor height: uses the grid's own per-cell floor data when present (iteration 05 traversal
 * work adds it: a `floor` Float32Array or a `floorAt(wx, wz)` helper), else track bed for VOID cells and
 * the station floor (y = 0) elsewhere.
 */
export function cellFloorFn(grid: Grid, trenchFloorY: number): (cx: number, cy: number) => number {
  const g = grid as Grid & {floor?: ArrayLike<number>; floorOf?: (i: number) => number; floorAt?: (wx: number, wz: number) => number};
  const ofIdx = typeof g.floorOf === 'function' ? g.floorOf.bind(g) : null;
  const arr = g.floor && g.floor.length === g.w * g.h ? g.floor : null;
  const fn = typeof g.floorAt === 'function' ? g.floorAt.bind(g) : null;
  return (cx, cy) => {
    const i = cy * g.w + cx;
    const v = ofIdx ? ofIdx(i) : arr ? arr[i] : fn ? fn((cx + 0.5) * CELL, (cy + 0.5) * CELL) : 0;
    const f = Number.isFinite(v) ? v : 0;
    // Track bed cells left at 0 mean "unset": they sit at the bed floor.
    return g.cells[i] === VOID && f === 0 ? trenchFloorY : f;
  };
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Per-cell open/solid state, floor, ceiling and layer heights (shared by the bake and tests). */
export interface ColumnGeometry { open: Uint8Array; floorH: Float32Array; ceilH: Float32Array; layerY: Float32Array; yMin: number; yMax: number }

export function columnGeometry(src: FieldSource): ColumnGeometry {
  const g = src.grid;
  const W = g.w, H = g.h, n = W * H, L = LAYERS;
  const floorOf = src.floorAt ?? cellFloorFn(g, src.trenchFloorY);
  const open = new Uint8Array(n);       // 0 solid, 1 open, 2 open but holds a sight-blocking prop
  const floorH = new Float32Array(n), ceilH = new Float32Array(n);
  const layerY = new Float32Array(n * L);
  let yMin = Infinity, yMax = -Infinity;
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx;
    if (g.cells[i] === SOLID) continue;
    open[i] = g.sightBlocked[i] ? 2 : 1;
    const f = floorOf(cx, cy);
    const c = g.ceil[i] > f + 0.5 ? g.ceil[i] : f + 3;
    floorH[i] = f; ceilH[i] = c;
    for (let k = 0; k < L; k++) layerY[i * L + k] = f + 0.05 + (c - 0.13 - f) * LAYER_T[k];
    if (f < yMin) yMin = f;
    if (c > yMax) yMax = c;
  }
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 4; }
  return {open, floorH, ceilH, layerY, yMin: yMin - 0.5, yMax: yMax + 0.5};
}

export function bakeLightField(src: FieldSource, p: FieldParams = DEFAULT_FIELD): BakedField {
  const t0 = performance.now();
  const g = src.grid;
  const W = g.w, H = g.h, n = W * H, L = LAYERS;
  const {open, floorH, ceilH, layerY, yMin, yMax} = columnGeometry(src);

  // --- Direct light ------------------------------------------------------------------------
  const E = new Float32Array(n * L * 3);       // tinted fluence (rgb)
  const D = new Float32Array(n * L * 3);       // luminance-weighted light direction (toward the light)
  const EL = new Float32Array(n * L);          // fluence luminance
  const GL = new Float32Array(n * FLICKER_GROUPS); // per column: luminance from each circuit (all layers)
  const G2L = new Float32Array(n * L);         // per layer: luminance from the dying circuit
  const groups = new Int8Array(src.lights.length);
  const trans = new Float32Array(L);
  const circuits: [number, number, number] = [0, 0, 0];
  let working = 0, steady = 0, rays = 0;
  const vis = new FixtureVisibility(g, open, floorH, ceilH, layerY, L);

  for (let li = 0; li < src.lights.length; li++) {
    const l = src.lights[li];
    const grp = fixtureGroup(l, li);
    groups[li] = grp;
    if (l.broken || l.power <= 0.01) continue;
    working++;
    if (grp < 0) steady++; else circuits[grp]++;
    const [tr, tg, tb] = fixtureTint(l);
    const tl = lum(tr, tg, tb);
    const R = Math.max(4, p.range * Math.sqrt(Math.min(1.5, l.power)));
    const R2 = R * R;
    const k0 = p.gain * l.power * 0.5; // two sub-points along the tube
    // Tube ends (the fixture is a ~1.2 m strip): elongated pools along the fixture axis.
    const ax = Math.cos(l.rot) * 0.35, az = -Math.sin(l.rot) * 0.35;
    const [fcx, fcy] = g.cellOf(l.x, l.z);
    if (!g.inBounds(fcx, fcy)) continue;
    const fi = fcy * W + fcx;
    if (!open[fi]) continue;
    // Fixtures hang just under their own cell's ceiling (pendants lower): keep the emitter inside the cell.
    const fy = Math.max(floorH[fi] + 0.3, Math.min(l.y - 0.05, ceilH[fi] - 0.06));
    vis.begin(l.x, l.z, fy);
    const x0 = Math.max(0, Math.floor((l.x - R) / CELL)), x1 = Math.min(W - 1, Math.floor((l.x + R) / CELL));
    const y0 = Math.max(0, Math.floor((l.z - R) / CELL)), y1 = Math.min(H - 1, Math.floor((l.z + R) / CELL));
    for (let cy = y0; cy <= y1; cy++) {
      const pz = (cy + 0.5) * CELL;
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * W + cx;
        if (!open[i]) continue;
        const px = (cx + 0.5) * CELL;
        const hx = px - l.x, hz = pz - l.z, h2 = hx * hx + hz * hz;
        if (h2 > R2) continue;
        rays++;
        if (!vis.query(cx, cy, Math.sqrt(h2), trans)) continue;
        // Within 3 m the tube is two emitters (elongated pool); further out one point is indistinguishable.
        const near = h2 < 9, ns = near ? 2 : 1, kw = near ? k0 : k0 * 2;
        for (let k = 0; k < L; k++) {
          const tk = trans[k];
          if (tk <= 0) continue;
          const py = layerY[i * L + k];
          let e = 0, dx = 0, dy = 0, dz = 0;
          for (let si = 0; si < ns; si++) {
            const s = near ? si * 2 - 1 : 0;
            const lx = l.x + ax * s - px, ly = fy - py, lz = l.z + az * s - pz;
            const d2 = lx * lx + ly * ly + lz * lz;
            if (d2 >= R2) continue;
            const d = Math.sqrt(d2);
            const down = ly > 0 ? ly / d : 0;
            const emit = p.uplight + (1 - p.uplight) * (p.lobe === 2 ? down * down : down);
            const q = d2 / R2, win = (1 - q * q) * (1 - q * q);
            const v = kw * emit * win / (d2 + 0.3);
            e += v;
            dx += v * lx / d; dy += v * ly / d; dz += v * lz / d;
          }
          if (e <= 0) continue;
          e *= tk; dx *= tk; dy *= tk; dz *= tk;
          const vi = (i * L + k) * 3;
          E[vi] += e * tr; E[vi + 1] += e * tg; E[vi + 2] += e * tb;
          D[vi] += dx * tl; D[vi + 1] += dy * tl; D[vi + 2] += dz * tl;
          EL[i * L + k] += e * tl;
          if (grp >= 0) {
            GL[i * FLICKER_GROUPS + grp] += e * tl;
            if (grp === 2) G2L[i * L + k] += e * tl;
          }
        }
      }
    }
  }

  // --- Bounce fill: half area mean, half local, then a short wall-respecting diffusion ----------
  // (Open cells only, typed arrays and precomputed neighbour masks: this runs before the JIT warms up.)
  let maxArea = 0;
  for (let i = 0; i < n; i++) if (g.area[i] > maxArea) maxArea = g.area[i];
  const aSum = new Float64Array((maxArea + 2) * 4); // r, g, b, count per area (+1 slot for area -1)
  const cells: number[] = [];
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (!open[i]) continue;
    cells.push(i);
    let r = 0, gg = 0, b = 0;
    for (let k = 0; k < L; k++) { const vi = (i * L + k) * 3; r += E[vi]; gg += E[vi + 1]; b += E[vi + 2]; }
    r /= L; gg /= L; b /= L;
    col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
    const a = (g.area[i] + 1) * 4;
    aSum[a] += r; aSum[a + 1] += gg; aSum[a + 2] += b; aSum[a + 3]++;
  }
  const oc = Int32Array.from(cells);
  // Neighbour mask: bounce flows between open neighbours, but not over cliffs (platform edge, stair wells).
  const nmask = new Uint8Array(oc.length);
  for (let q = 0; q < oc.length; q++) {
    const i = oc[q], cx = i % W, cy = (i - cx) / W, f = floorH[i];
    let m = 0;
    if (cx > 0 && open[i - 1] && Math.abs(floorH[i - 1] - f) < 0.6) m |= 1;
    if (cx < W - 1 && open[i + 1] && Math.abs(floorH[i + 1] - f) < 0.6) m |= 2;
    if (cy > 0 && open[i - W] && Math.abs(floorH[i - W] - f) < 0.6) m |= 4;
    if (cy < H - 1 && open[i + W] && Math.abs(floorH[i + W] - f) < 0.6) m |= 8;
    nmask[q] = m;
  }
  let B = new Float32Array(n * 3), B2 = new Float32Array(n * 3);
  for (let q = 0; q < oc.length; q++) {
    const i = oc[q], a = (g.area[i] + 1) * 4, an = aSum[a + 3];
    for (let c = 0; c < 3; c++) B[i * 3 + c] = p.bounce * (0.5 * aSum[a + c] / an + 0.5 * col[i * 3 + c]);
  }
  for (let it = 0; it < 10; it++) {
    for (let q = 0; q < oc.length; q++) {
      const i = oc[q], m = nmask[q], i3 = i * 3;
      let r = B[i3], gg = B[i3 + 1], b = B[i3 + 2], cnt = 1;
      if (m & 1) { const j = i3 - 3; r += B[j]; gg += B[j + 1]; b += B[j + 2]; cnt++; }
      if (m & 2) { const j = i3 + 3; r += B[j]; gg += B[j + 1]; b += B[j + 2]; cnt++; }
      if (m & 4) { const j = i3 - W * 3; r += B[j]; gg += B[j + 1]; b += B[j + 2]; cnt++; }
      if (m & 8) { const j = i3 + W * 3; r += B[j]; gg += B[j + 1]; b += B[j + 2]; cnt++; }
      B2[i3] = r / cnt; B2[i3 + 1] = gg / cnt; B2[i3 + 2] = b / cnt;
    }
    [B, B2] = [B2, B];
  }

  // --- Encode --------------------------------------------------------------------------------
  const depth = 1 + 2 * L;
  const data = new Uint8Array(W * H * depth * 4);
  const yr = yMax - yMin;
  const enc = (v: number) => Math.round(Math.sqrt(Math.min(1, Math.max(0, v / FIELD_EMAX))) * 255);
  const u8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx;
    // Solid cells: zero light; heights borrowed from an open neighbour so filtering near walls stays sane.
    let hi = i;
    if (!open[i]) {
      hi = -1;
      for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < n && open[j] && Math.abs((j % W) - cx) <= 1) { hi = j; break; }
    }
    const o0 = (cy * W + cx) * 4;
    data[o0] = hi >= 0 ? u8((floorH[hi] - yMin) / yr) : u8((0 - yMin) / yr);
    data[o0 + 1] = hi >= 0 ? u8((ceilH[hi] - yMin) / yr) : u8((3 - yMin) / yr);
    if (!open[i]) continue;
    let tot = 0;
    for (let k = 0; k < L; k++) tot += EL[i * L + k];
    data[o0 + 2] = tot > 0 ? u8(GL[i * FLICKER_GROUPS] / tot) : 0;
    data[o0 + 3] = tot > 0 ? u8(GL[i * FLICKER_GROUPS + 1] / tot) : 0;
    const br = B[i * 3], bg = B[i * 3 + 1], bb = B[i * 3 + 2], bl = lum(br, bg, bb);
    for (let k = 0; k < L; k++) {
      const vi = (i * L + k) * 3, el = EL[i * L + k];
      const dxv = D[vi], dyv = D[vi + 1], dzv = D[vi + 2];
      const dmag = Math.sqrt(dxv * dxv + dyv * dyv + dzv * dzv);
      const dl = Math.min(el, dmag);
      // Directional luminance |D|; the incoherent remainder reaches surfaces at `scatter`; bounce on top.
      const coh = el > 0 ? (dl + (el - dl) * p.scatter) / el : 0;
      const r = E[vi] * coh + br, gg = E[vi + 1] * coh + bg, b = E[vi + 2] * coh + bb;
      const tl = el * coh + bl;
      const rho = tl > 0 ? dl / tl : 0;
      const oa = (((1 + 2 * k) * H + cy) * W + cx) * 4, ob = (((2 + 2 * k) * H + cy) * W + cx) * 4;
      data[oa] = enc(r); data[oa + 1] = enc(gg); data[oa + 2] = enc(b); data[oa + 3] = u8(rho);
      const inv = dl > 1e-6 ? 1 / dmag : 0;
      data[ob] = u8(dl > 1e-6 ? dxv * inv * 0.5 + 0.5 : 0.5);
      data[ob + 1] = u8(dl > 1e-6 ? dyv * inv * 0.5 + 0.5 : 1);
      data[ob + 2] = u8(dl > 1e-6 ? dzv * inv * 0.5 + 0.5 : 0.5);
      data[ob + 3] = el > 0 ? u8(G2L[i * L + k] / el) : 0;
    }
  }
  return {
    w: W, h: H, layers: L, depth, data, yMin, yMax, groups,
    stats: {ms: performance.now() - t0, bytes: data.byteLength, fixtures: src.lights.length, working, steady, circuits, rays},
  };
}

/**
 * Fixture -> cell visibility for one fixture at a time, O(1) amortised per cell: each cell's "parent" is
 * the cell one step (0.5 m) back toward the fixture, so visibility, prop transmittance and the vertical
 * clearance of every cell strictly between fixture and target are memoised along parent chains as
 * slope bounds (the tightest ceiling/lintel above and floor/edge below the ray). A target layer is lit
 * when its ray slope fits the bounds. Diagonal steps through two solid corner cells are blocked (no
 * leaks through wall corners). Close to the exact per-ray DDA (traceExact; agreement checked in tests).
 */
export class FixtureVisibility {
  private readonly stamp: Int32Array;
  private readonly mT: Float32Array;
  private readonly mHi: Float32Array;
  private readonly mLo: Float32Array;
  /** Highest floor / lowest ceiling strictly between fixture and cell (decides whether a bound can bind). */
  private readonly mFloor: Float32Array;
  private readonly mCeil: Float32Array;
  private readonly stack = new Int32Array(8192);
  private readonly pstack = new Int32Array(8192);
  private st = 0;
  private fx = 0; private fz = 0; private fy = 0; private fi = -1;
  constructor(private readonly g: Grid, private readonly open: Uint8Array, private readonly floorH: Float32Array, private readonly ceilH: Float32Array,
    private readonly layerY: Float32Array, private readonly L: number) {
    const n = g.w * g.h;
    this.stamp = new Int32Array(n);
    this.mT = new Float32Array(n);
    this.mHi = new Float32Array(n);
    this.mLo = new Float32Array(n);
    this.mFloor = new Float32Array(n);
    this.mCeil = new Float32Array(n);
  }

  begin(fx: number, fz: number, fy: number): void {
    this.st++;
    this.fx = fx; this.fz = fz; this.fy = fy;
    const cx = Math.floor(fx / CELL), cy = Math.floor(fz / CELL);
    this.fi = this.g.inBounds(cx, cy) ? cy * this.g.w + cx : -1;
  }

  private parentOf(c: number): number {
    const W = this.g.w, cx = c % W, cy = (c - cx) / W;
    const px = (cx + 0.5) * CELL, pz = (cy + 0.5) * CELL;
    const vx = this.fx - px, vz = this.fz - pz, d = Math.sqrt(vx * vx + vz * vz);
    if (d < CELL) return this.fi; // adjacent to the fixture's cell (open cells never share a wall edge)
    const qx = Math.floor((px + vx / d * CELL) / CELL), qy = Math.floor((pz + vz / d * CELL) / CELL);
    if (qx < 0 || qy < 0 || qx >= W || qy >= this.g.h) return -1;
    return qy * W + qx;
  }

  /** Resolve memo for cell c (bounds over the cells strictly between the fixture and c). */
  private resolve(c: number): void {
    const {stamp, mT, mHi, mLo, mFloor, mCeil, open, st} = this;
    let sp = 0, cur = c;
    while (stamp[cur] !== st) {
      if (cur === this.fi) { stamp[cur] = st; mT[cur] = 1; mHi[cur] = Infinity; mLo[cur] = -Infinity; mFloor[cur] = -Infinity; mCeil[cur] = Infinity; break; }
      const p = this.parentOf(cur);
      if (p < 0 || !open[cur] && cur !== c) { stamp[cur] = st; mT[cur] = 0; break; }
      this.stack[sp] = cur; this.pstack[sp] = p; sp++;
      if (sp >= this.stack.length) break;
      cur = p;
    }
    const W = this.g.w;
    while (sp > 0) {
      sp--;
      const ch = this.stack[sp], p = this.pstack[sp];
      stamp[ch] = st;
      if (stamp[p] !== st || mT[p] <= 0 || !open[p]) { mT[ch] = 0; continue; }
      if (p === this.fi) { mT[ch] = 1; mHi[ch] = Infinity; mLo[ch] = -Infinity; mFloor[ch] = -Infinity; mCeil[ch] = Infinity; continue; }
      // Diagonal step: blocked when both side cells are solid (corner leak).
      const chx = ch % W, pxi = p % W;
      if (chx !== pxi && (ch - chx) !== (p - pxi) && !open[(ch - chx) + pxi] && !open[(p - pxi) + chx]) { mT[ch] = 0; continue; }
      // Parent's own constraint (it lies strictly between the fixture and ch).
      const pcx = (pxi + 0.5) * CELL, pcz = ((p - pxi) / W + 0.5) * CELL;
      const s = Math.sqrt((pcx - this.fx) ** 2 + (pcz - this.fz) ** 2);
      const sNear = Math.max(0.05, s - 0.36), sFar = s + 0.36;
      const up = this.ceilH[p] + CLEAR_EPS - this.fy, dn = this.floorH[p] - CLEAR_EPS - this.fy;
      const hi = up >= 0 ? up / sFar : up / sNear;
      const lo = dn <= 0 ? dn / sFar : dn / sNear;
      mT[ch] = mT[p] * (open[p] === 2 ? PROP_TRANSMITTANCE : 1);
      mHi[ch] = Math.min(mHi[p], hi);
      mLo[ch] = Math.max(mLo[p], lo);
      mFloor[ch] = Math.max(mFloor[p], this.floorH[p]);
      mCeil[ch] = Math.min(mCeil[p], this.ceilH[p]);
    }
  }

  /** Per-layer transmittance from the current fixture to the layers of cell (cx, cy); false = all dark. */
  query(cx: number, cy: number, dist: number, out: Float32Array): boolean {
    const i = cy * this.g.w + cx;
    if (!this.open[i] || this.fi < 0) return false;
    this.resolve(i);
    const T = this.mT[i];
    if (T <= 0) return false;
    const hi = this.mHi[i], lo = this.mLo[i], fy = this.fy, L = this.L, pf = this.mFloor[i], pc = this.mCeil[i];
    // The target cell's own near edge only matters when the fixture is above its ceiling / below its floor.
    const sNear = Math.max(0.05, dist - 0.36);
    const tHi = fy > this.ceilH[i] + CLEAR_EPS ? (this.ceilH[i] + CLEAR_EPS - fy) / sNear : Infinity;
    const tLo = fy < this.floorH[i] - CLEAR_EPS ? (this.floorH[i] - CLEAR_EPS - fy) / sNear : -Infinity;
    let any = false;
    for (let k = 0; k < L; k++) {
      if (dist < 1e-3) { out[k] = T; any = true; continue; }
      const yk = this.layerY[i * L + k], slope = (yk - fy) / dist;
      // The ray spans [min(fy, yk), max(fy, yk)]: floors below / ceilings above that range can never block
      // it (the slope bounds are conservative near the target, so only apply them when they can bind).
      const ok = (pc + CLEAR_EPS >= Math.max(fy, yk) || slope <= hi) && (pf - CLEAR_EPS <= Math.min(fy, yk) || slope >= lo) && slope <= tHi && slope >= tLo;
      out[k] = ok ? T : 0;
      any ||= ok;
    }
    return any;
  }
}

/**
 * Exact reference: 2D DDA from the fixture (fx, fz at height fy) to the centre of cell (tx, ty), checking
 * every traversed cell's floor/ceiling against each layer's ray height. Per-layer transmittance in `out`.
 */
export function traceExact(g: Grid, open: Uint8Array, floorH: Float32Array, ceilH: Float32Array, fx: number, fz: number, fy: number,
  tx: number, ty: number, layerY: Float32Array, lo: number, L: number, out: Float32Array): boolean {
  const W = g.w;
  const ex = (tx + 0.5) * CELL, ez = (ty + 0.5) * CELL;
  const dx = ex - fx, dz = ez - fz;
  let x = Math.floor(fx / CELL), y = Math.floor(fz / CELL);
  const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const tDX = adx > 1e-9 ? CELL / adx : Infinity, tDY = adz > 1e-9 ? CELL / adz : Infinity;
  let tMaxX = adx > 1e-9 ? (dx > 0 ? (x + 1) * CELL - fx : fx - x * CELL) / adx : Infinity;
  let tMaxY = adz > 1e-9 ? (dz > 0 ? (y + 1) * CELL - fz : fz - y * CELL) / adz : Infinity;
  let tIn = 0, t = 1, alive = L;
  for (let k = 0; k < L; k++) out[k] = 1;
  const start = y * W + x;
  for (let guard = 0; guard < 4096; guard++) {
    if (x < 0 || y < 0 || x >= W || y >= g.h) return false;
    const i = y * W + x;
    const o = open[i];
    if (!o) return false;
    if (o === 2 && i !== start && !(x === tx && y === ty)) t *= PROP_TRANSMITTANCE;
    const tOut = Math.min(tMaxX, tMaxY, 1);
    const fl = floorH[i] - CLEAR_EPS, ce = ceilH[i] + CLEAR_EPS;
    for (let k = 0; k < L; k++) {
      if (out[k] <= 0) continue;
      const dy = layerY[lo + k] - fy;
      const ya = fy + dy * tIn, yb = fy + dy * tOut;
      if (Math.min(ya, yb) < fl || Math.max(ya, yb) > ce) { out[k] = 0; alive--; }
    }
    if (!alive) return false;
    if (x === tx && y === ty) break;
    if (tMaxX < tMaxY) { tIn = tMaxX; tMaxX += tDX; x += stepX; } else { tIn = tMaxY; tMaxY += tDY; y += stepY; }
  }
  if (t < 1) for (let k = 0; k < L; k++) out[k] *= t;
  return true;
}

// ---------------------------------------------------------------------------------------------
// CPU sampling (mirror of the shader; used for the viewmodel light level, tests and previews)

export interface FieldSample {
  /** Non-directional irradiance (rgb) added to every surface regardless of normal. */
  amb: [number, number, number];
  /** Directional irradiance colour, applied with N.L along `dir`. */
  dirColor: [number, number, number];
  /** Unit direction toward the dominant light (world). */
  dir: [number, number, number];
}

const dec = (b: number) => { const v = b / 255; return v * v * FIELD_EMAX; };

/** Sample like the shader: bilinear in XZ (texel centres = cell centres), linear between layers. */
export function sampleField(f: BakedField, x: number, y: number, z: number, levels: readonly number[] = [1, 1, 1], normal?: readonly [number, number, number]): FieldSample {
  const W = f.w, H = f.h, L = f.layers, d = f.data, C = CELL * (f.cellScale ?? 1);
  if (normal) { x += normal[0] * C * 0.5; y += normal[1] * 0.2; z += normal[2] * C * 0.5; }
  const ci = Math.min(W - 1, Math.max(0, Math.floor(x / C))), cj = Math.min(H - 1, Math.max(0, Math.floor(z / C)));
  const h0 = (cj * W + ci) * 4, yr = f.yMax - f.yMin;
  const fl = f.yMin + d[h0] / 255 * yr, ce = f.yMin + d[h0 + 1] / 255 * yr;
  const rel = Math.min(1, Math.max(0, (y - fl) / Math.max(ce - fl, 0.3))) * (L - 1);
  const k0 = Math.floor(rel), k1 = Math.min(k0 + 1, L - 1), wk = rel - k0;
  // Bilinear texel weights (clamped to edge).
  const u = x / C - 0.5, v = z / C - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const tex = (slice: number, c: number): number => {
    let acc = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const xx = Math.min(W - 1, Math.max(0, iu + a)), yy = Math.min(H - 1, Math.max(0, iv + b));
      const w = (a ? fu : 1 - fu) * (b ? fv : 1 - fv);
      acc += w * d[((slice * H + yy) * W + xx) * 4 + c];
    }
    return acc;
  };
  const decT = (slice: number, c: number) => dec(tex(slice, c));
  const mix = (a: number, b: number) => a + (b - a) * wk;
  const sa0 = 1 + 2 * k0, sa1 = 1 + 2 * k1, sb0 = 2 + 2 * k0, sb1 = 2 + 2 * k1;
  const T: [number, number, number] = [mix(decT(sa0, 0), decT(sa1, 0)), mix(decT(sa0, 1), decT(sa1, 1)), mix(decT(sa0, 2), decT(sa1, 2))];
  const rho = mix(tex(sa0, 3), tex(sa1, 3)) / 255;
  const dirRaw = [0, 1, 2].map(c => mix(tex(sb0, c), tex(sb1, c)) / 255 * 2 - 1);
  const dl = Math.hypot(dirRaw[0], dirRaw[1], dirRaw[2]) || 1;
  const f0 = tex(0, 2) / 255, f1 = tex(0, 3) / 255, f2 = mix(tex(sb0, 3), tex(sb1, 3)) / 255;
  const m = Math.max(0, 1 - f0 * (1 - levels[0]) - f1 * (1 - levels[1]) - f2 * (1 - levels[2]));
  return {
    amb: [T[0] * (1 - rho) * m, T[1] * (1 - rho) * m, T[2] * (1 - rho) * m],
    dirColor: [T[0] * rho * m, T[1] * rho * m, T[2] * rho * m],
    dir: [dirRaw[0] / dl, dirRaw[1] / dl, dirRaw[2] / dl],
  };
}

/**
 * Box-downsample a baked field by `k` in X/Z (fallback for GPUs whose MAX_3D_TEXTURE_SIZE is below the
 * station grid: WebGL2 only guarantees 256). The shader derives the texel size from the texture size,
 * so a coarser volume needs no shader change; light bleeds up to k/2 cells further near walls.
 */
export function downsampleField(f: BakedField, k: number): BakedField {
  if (k <= 1) return f;
  const W = Math.ceil(f.w / k), H = Math.ceil(f.h / k), D = f.depth;
  const data = new Uint8Array(W * H * D * 4);
  for (let s = 0; s < D; s++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const acc = [0, 0, 0, 0];
    let n = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const sx = Math.min(f.w - 1, x * k + dx), sy = Math.min(f.h - 1, y * k + dy);
      const o = ((s * f.h + sy) * f.w + sx) * 4;
      for (let c = 0; c < 4; c++) acc[c] += f.data[o + c];
      n++;
    }
    const o = ((s * H + y) * W + x) * 4;
    for (let c = 0; c < 4; c++) data[o + c] = Math.round(acc[c] / n);
  }
  return {...f, w: W, h: H, data, stats: {...f.stats, bytes: data.byteLength}, cellScale: k};
}

// ---------------------------------------------------------------------------------------------
// three.js integration

/**
 * The baked field as a scene object three r186's WebGLRenderer treats as a light probe grid
 * (`isLightProbeGrid`, `texture`, `boundingBox`, `resolution`). It must be in the rendered scene.
 * `resolution` is NOT a probe resolution here: the renderer copies it into the `probesResolution`
 * uniform on every material refresh (at least once per material per frame) and our decoding chunk
 * reads it as the three flicker-circuit levels. Texture dims come from textureSize() in the shader.
 */
export class LightFieldVolume extends THREE.Object3D {
  readonly isLightProbeGrid = true;
  readonly texture: THREE.Data3DTexture;
  readonly boundingBox: THREE.Box3;
  /** Flicker circuit levels (x, y, z = circuits 0, 1, 2); see class doc. */
  readonly resolution = new THREE.Vector3(1, 1, 1);
  constructor(readonly field: BakedField) {
    super();
    this.name = 'light-field';
    const t = new THREE.Data3DTexture(field.data, field.w, field.h, field.depth);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.unpackAlignment = 1;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    this.texture = t;
    const span = CELL * (field.cellScale ?? 1);
    this.boundingBox = new THREE.Box3(new THREE.Vector3(0, field.yMin, 0), new THREE.Vector3(field.w * span, field.yMax, field.h * span));
  }
  setLevels(l0: number, l1: number, l2: number): void {
    this.resolution.set(l0, l1, l2);
  }
  dispose(): void {
    this.texture.dispose();
  }
}

/** Marker so tests (and a second install) can tell the chunks are ours. */
export const LIGHT_FIELD_MARK = '// last-line light field v1';
/** three r186 anchor replaced in lights_fragment_begin (tests assert it still exists upstream). */
export const LIGHT_FIELD_ANCHOR = 'irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );';

export const LIGHT_FIELD_PARS = /* glsl */ `
#ifdef USE_LIGHT_PROBES_GRID
${LIGHT_FIELD_MARK}
// Station light field (world/lightField.ts): slice 0 = (floor, ceil, circuit0 share, circuit1 share) per
// column; per height layer k: slice 1+2k = (sqrt-encoded irradiance rgb, directional share), slice 2+2k =
// (direction to light, dying-circuit share). probesResolution = circuit levels.
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 lfDirColor = vec3( 0.0 );
vec3 lfDirWorld = vec3( 0.0, 1.0, 0.0 );
vec3 lfDecode( vec3 v ) { return v * v * ${FIELD_EMAX.toFixed(1)}; }
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	ivec3 size = textureSize( probesSH, 0 );
	vec3 dims = vec3( size );
	float layers = ( dims.z - 1.0 ) * 0.5;
	vec2 cell = ( probesMax.xz - probesMin.xz ) / dims.xy;
	// Offset along the normal: wall faces read the cell in front of them, never the rock behind.
	vec3 p = worldPos + worldNormal * vec3( cell.x * 0.5, 0.2, cell.y * 0.5 );
	vec2 cxy = ( p.xz - probesMin.xz ) / cell;
	ivec2 ci = clamp( ivec2( floor( cxy ) ), ivec2( 0 ), size.xy - 1 );
	vec4 hc = texelFetch( probesSH, ivec3( ci, 0 ), 0 );
	float yr = probesMax.y - probesMin.y;
	float fl = probesMin.y + hc.r * yr;
	float ce = probesMin.y + hc.g * yr;
	float rel = clamp( ( p.y - fl ) / max( ce - fl, 0.3 ), 0.0, 1.0 ) * ( layers - 1.0 );
	float k0 = floor( rel );
	float k1 = min( k0 + 1.0, layers - 1.0 );
	float wk = rel - k0;
	vec2 uv = cxy / dims.xy;
	vec4 a0 = texture( probesSH, vec3( uv, ( 1.5 + 2.0 * k0 ) / dims.z ) );
	vec4 a1 = texture( probesSH, vec3( uv, ( 1.5 + 2.0 * k1 ) / dims.z ) );
	vec4 b0 = texture( probesSH, vec3( uv, ( 2.5 + 2.0 * k0 ) / dims.z ) );
	vec4 b1 = texture( probesSH, vec3( uv, ( 2.5 + 2.0 * k1 ) / dims.z ) );
	vec2 fr = texture( probesSH, vec3( uv, 0.5 / dims.z ) ).ba;
	vec3 T = mix( lfDecode( a0.rgb ), lfDecode( a1.rgb ), wk );
	float rho = mix( a0.a, a1.a, wk );
	vec4 b = mix( b0, b1, wk );
	float m = max( 0.0, 1.0 - fr.x * ( 1.0 - probesResolution.x ) - fr.y * ( 1.0 - probesResolution.y ) - b.a * ( 1.0 - probesResolution.z ) );
	vec3 dir = b.rgb * 2.0 - 1.0;
	float dl = length( dir );
	lfDirWorld = dl > 1e-4 ? dir / dl : vec3( 0.0, 1.0, 0.0 );
	lfDirColor = T * rho * m;
	return T * ( 1.0 - rho ) * m;
}
#endif
`;

export const LIGHT_FIELD_BEGIN = /* glsl */ `irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
		${LIGHT_FIELD_MARK}
		#if defined( RE_Direct )
		{
			#if defined( STANDARD ) && !( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
				material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / ( material.dfg.x + material.dfg.y ) - 1.0 );
			#endif
			IncidentLight lfLight;
			lfLight.color = lfDirColor;
			lfLight.direction = normalize( ( viewMatrix * vec4( lfDirWorld, 0.0 ) ).xyz );
			lfLight.visible = true;
			RE_Direct( lfLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		}
		#endif`;

/**
 * Replace three's light-probe-grid decoding with the station light field (idempotent). Must run before
 * the first program with USE_LIGHT_PROBES_GRID compiles (i.e. before a LightFieldVolume is rendered).
 * Only programs compiled with that define (scenes containing a LightFieldVolume) are affected.
 */
export function installLightFieldShader(): boolean {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.lightprobes_pars_fragment.includes(LIGHT_FIELD_MARK)) return true;
  if (!C.lights_fragment_begin.includes(LIGHT_FIELD_ANCHOR)) {
    console.warn('light field: three lights_fragment_begin anchor missing; station lighting falls back to the probe-grid default');
    return false;
  }
  C.lightprobes_pars_fragment = LIGHT_FIELD_PARS;
  C.lights_fragment_begin = C.lights_fragment_begin.replace(LIGHT_FIELD_ANCHOR, LIGHT_FIELD_BEGIN);
  return true;
}
