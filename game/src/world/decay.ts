// Iteration 12 (ARCH): about 30 years without upkeep, on the station's architectural SURFACES only (walls,
// floors, ceilings). User mandate: "Age the station walls and floor about 30 years, 30 years of no upkeep. It
// should feel like the world has been dead for a while, but not too long. There should be a feeling of decay.
// Only do walls / floor / ceiling surfaces." Props, guns, characters, shelf stock, fixtures and signs are untouched.
//
// Three parts, all deterministic per station seed:
// 1. DECAY FIELD (CPU, once per station): one RGBA8 texel per 0.5 m nav cell and level (levels stacked in v):
//    R traffic   worn walking lanes: shortest paths between every doorway / stair end and its nearest
//                neighbours, blurred into ~1.5 m lanes, plus worn thresholds at doorways;
//    G openness  share of open cells within 1.5 m: ~0.5 against a wall, ~0.3 in a corner, 1 mid-room
//                (dust and grime collect at the edges and in corners);
//    B wetness   seeded leak patches (more on the lower level and the track bed, fewer on upper decks),
//                drips at some light fixtures, damp along the track bed;
//    A neglect   per-area condition (service / lower / dark / abandoned shop units worse than platforms and
//                halls) modulated by a coarse world-space value noise: coherent patches, not uniform noise.
// 2. DETAIL TEXTURE (generated once, 512 px, tiling): R smooth warped fBm stain field (no stamped shapes), G hairline
//    cracks, B fine grain, A vertical grime runs. Sampled in world metres at two incommensurate scales.
// 3. ONE SHADER HOOK ('arch-decay-v1', render/shaderHooks.ts) on the architectural materials only, with a
//    per-material profile (DECAY_PROFILES): glaze yellowing / paint fade, grime toward the floor and into
//    corners, vertical grime runs strongest under the ceiling line; where wet only: seepage hanging from the ceiling
//    seam to a wavy faint tide line, rising damp at the foot, salt bloom along those evaporation fronts; floor dust
//    vs worn lanes, irregular dried puddle marks, cracks, peeling paint, lost / lifted / discoloured floor tiles,
//    soft brown ceiling leak stains. Stains come from level sets of a smooth stain field: no stamped circles.
//    Bounded cost: 2 light-field texel fetches (level slot + band floor / ceiling, only where the station light
//    field is installed), 4 texture fetches, no loops.
//    The detail texture has anisotropy 1 (render/softwareGl.ts, materials.ts thinTrim).
// The wall-treatment pass (world/wallDetailPlan.ts) adds the discrete pieces on walls (cracks, chips, lost tiles,
// leak streaks, rust bleed below wall-mounted steel) at its 30-year condition (WALL_AGE_30Y).

import * as THREE from 'three';
import {CELL, FLOOR, VOID} from '../gen/grid';
import type {Level} from '../gen/levels';
import type {Area, StationLayout} from '../gen/station';
import {hashString, mulberry32} from '../core/rng';
import {addShaderHook, cloneWithShaderHooks} from '../render/shaderHooks';
import {fieldSlotGLSL} from './lightField';
import type {MatKey, WorldMaterials} from './materials';
import {shapeMaterial} from './shapeMaterials';

// ---------------------------------------------------------------------------------------------
// Profiles

/** Per-material decay vocabulary (0..1 strengths at 30 years, before the local neglect scale). */
export interface DecayProfile {
  /** Grime film toward the floor and into corners (walls); soot toward the walls (ceilings). */
  grime: number;
  /** Vertical leak / grime runs on walls (stronger where it is wet). */
  streaks: number;
  /** White mineral bloom where it is wet: low on walls, around ceiling leaks, on floors. */
  efflor: number;
  /** Water stains: dried puddle marks and tide lines on floors, brown leak rings on ceilings. */
  stains: number;
  /** Worn walking lanes (floors): polished / ground-in grime; painted floors (safety edge) wear through. */
  wear: number;
  /** Dust / grit settled where nobody walks, thickest along walls and in corners (floors). */
  dust: number;
  /** Hairline cracks. */
  cracks: number;
  /** Peeling / flaking paint revealing the substrate (painted block, painted ceilings). */
  peel: number;
  /** Floor tile grid (m) for per-tile damage; 0 = monolithic. */
  tile: number;
  /** Share of floor tiles lost (bedding exposed) at full decay; about 2.5x as many are lifted / discoloured. */
  tileLoss: number;
  /** Colour aging: glaze yellowing (tile), paint fading / chalking (paint, safety edge). Bounded to stay readable. */
  fade: number;
  /** Painted floor: worn lanes expose the concrete under the paint (0 / 1). */
  paintWear: number;
  /** Grime / water tint (multiplier target, linear-ish RGB). */
  tint: [number, number, number];
}

const P = (o: Partial<DecayProfile> & {tint: [number, number, number]}): DecayProfile =>
  ({grime: 0, streaks: 0, efflor: 0, stains: 0, wear: 0, dust: 0, cracks: 0, peel: 0, tile: 0, tileLoss: 0, fade: 0, paintWear: 0, ...o});

const TILE_WALL = P({grime: 0.8, streaks: 0.75, efflor: 0.45, stains: 0.35, cracks: 0.18, fade: 0.3, tint: [0.6, 0.53, 0.43]});

/**
 * Decay profile per architectural surface key: MatKey walls / floors / ceilings plus the storefront-unit interior
 * finishes ('tileShop' walls, 'quarryTile' floors; their arch meshes get their own decayed material copies).
 */
export const DECAY_PROFILES = {
  // Glazed tile walls: yellowed glaze, grime low and in corners, leak runs, bloom where wet.
  tileLower: TILE_WALL,
  tileUpper: TILE_WALL,
  tileBase: TILE_WALL,
  tileShop: P({grime: 0.8, streaks: 0.65, efflor: 0.3, stains: 0.35, cracks: 0.2, fade: 0.35, tint: [0.58, 0.51, 0.41]}),
  // Painted block (back of house): chalky faded paint, flaking where damp, kick grime.
  paint: P({grime: 0.6, streaks: 0.5, efflor: 0.35, stains: 0.35, cracks: 0.25, peel: 0.7, fade: 0.5, tint: [0.58, 0.54, 0.47]}),
  // Concrete walls (tunnel, platform faces / slab edges): soot, long leak runs, heavy bloom.
  tunnel: P({grime: 0.5, streaks: 0.8, efflor: 0.6, stains: 0.35, cracks: 0.3, tint: [0.5, 0.47, 0.42]}),
  platformFace: P({grime: 0.5, streaks: 0.7, efflor: 0.55, stains: 0.3, cracks: 0.3, tint: [0.52, 0.48, 0.42]}),
  // Floors.
  terrazzo: P({grime: 0.4, wear: 0.6, dust: 0.65, stains: 0.55, efflor: 0.25, cracks: 0.4, tile: 1.0, tileLoss: 0.05, tint: [0.5, 0.45, 0.37]}),
  concrete: P({wear: 0.5, dust: 0.75, stains: 0.6, efflor: 0.3, cracks: 0.55, grime: 0.3, tint: [0.5, 0.46, 0.4]}),
  platformSlab: P({grime: 0.35, wear: 0.6, dust: 0.55, stains: 0.5, efflor: 0.2, cracks: 0.45, tile: 1.2, tileLoss: 0.015, tint: [0.5, 0.46, 0.39]}),
  safetyEdge: P({grime: 0.25, wear: 0.7, dust: 0.4, stains: 0.3, cracks: 0.2, fade: 0.45, paintWear: 1, tint: [0.52, 0.48, 0.4]}),
  quarryTile: P({grime: 0.35, wear: 0.55, dust: 0.6, stains: 0.6, efflor: 0.2, cracks: 0.25, tile: 0.3, tileLoss: 0.05, tint: [0.48, 0.42, 0.35]}),
  ballast: P({dust: 0.25, stains: 0.45, grime: 0.25, tint: [0.45, 0.42, 0.38]}),
  // Ceilings: brown water rings around leaks and fixture drips, flaking paint, soot toward the walls.
  ceiling: P({grime: 0.3, stains: 0.8, efflor: 0.3, cracks: 0.3, peel: 0.55, fade: 0.2, tint: [0.6, 0.53, 0.42]}),
  ceilingService: P({grime: 0.4, stains: 0.85, efflor: 0.35, cracks: 0.35, peel: 0.65, fade: 0.2, tint: [0.56, 0.5, 0.4]}),
} as const satisfies Record<string, DecayProfile>;

export type DecayKey = keyof typeof DECAY_PROFILES;
/** Architectural MatKeys that age (every other material - trim steel, track, props, signs, tubes - does not). */
export const DECAY_MAT_KEYS = ['tileLower', 'tileUpper', 'tileBase', 'paint', 'tunnel', 'platformFace', 'terrazzo', 'concrete', 'platformSlab', 'safetyEdge', 'ballast', 'ceiling', 'ceilingService'] as const satisfies readonly (MatKey & DecayKey)[];
/** Storefront-unit interior finishes (shape-material keys) that age on their ARCH meshes only. */
export const DECAY_SHOP_KEYS = ['tileShop', 'quarryTile'] as const satisfies readonly DecayKey[];

/** Overall age: 1 = about 30 years without upkeep. */
export const DECAY_AGE = 1;

/**
 * Base neglect per area (0..1): back-of-house, the lower level, the track bed and abandoned shop units decay
 * most; platforms, halls and the upper decks less (purpose stays readable: the finish identity never changes,
 * only how worn it is).
 */
export function areaNeglect(area: Area | undefined, levelRole: Level['role'], voidCell: boolean): number {
  if (voidCell) return 0.85;
  let n: number;
  if (!area) n = 0.7;
  else if (area.type === 'eatery' || area.type === 'shop') n = 0.62;
  else if (!area.publicSpace) n = 0.78;
  else if (area.kind === 'platform') n = 0.52;
  else if (area.type === 'stair-core' || area.type === 'exit-stair') n = 0.58;
  else n = 0.48;
  if (levelRole === 'lower') n += 0.12;
  else if (levelRole === 'upper') n -= 0.05;
  if (area?.lighting === 'dark') n += 0.1;
  else if (area?.lighting === 'dim') n += 0.05;
  return Math.max(0, Math.min(1, n));
}

/** Leak density per level role (relative): water finds its way down. */
export const LEVEL_WETNESS: Record<Level['role'], number> = {upper: 0.6, main: 1, lower: 1.4};
/** Wetness never exceeds this (the lower level must still read as tile / paint with stains, not as a pattern). */
export const WET_CAP = 0.7;

// ---------------------------------------------------------------------------------------------
// Decay field (CPU)

export interface DecayField {
  /** Cells per level row / rows per level / levels; texel (x, y + level * h). */
  w: number; h: number; levels: number;
  /** RGBA8: traffic, openness, wetness, neglect. */
  data: Uint8Array;
  stats: {ms: number; sources: number[]; leaks: number[]};
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Separable box blur (radius r cells) of a W x H float field, `passes` times, in place. */
function boxBlur(a: Float32Array, W: number, H: number, r: number, passes: number): void {
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      let s = 0;
      const row = y * W;
      for (let x = -r; x <= r; x++) s += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = s / (2 * r + 1);
        s += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = s / (2 * r + 1);
        s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
  }
}

/** Smooth 2D value noise (deterministic per seed), ~`period` cells per feature, in [0, 1]. */
function valueNoise(seed: number, period: number): (x: number, y: number) => number {
  const h = (i: number, j: number) => { let v = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ seed; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  return (x, y) => {
    const fx = x / period, fy = y / period, ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/**
 * The station's decay field (deterministic per layout seed). Levels are `levels` in order (index = light-field
 * slot = layout.levels index).
 */
export function buildDecayField(layout: StationLayout, levels: readonly Level[]): DecayField {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const g0 = levels[0].grid, W = g0.w, H = g0.h, S = levels.length, n = W * H;
  const data = new Uint8Array(W * H * S * 4);
  const seed = hashString('decay-v1', layout.seed >>> 0);
  const sources: number[] = [], leaks: number[] = [];
  const doors = layout.doors ?? [];
  const links = (layout as {levelLinks?: {kind: string; lower: number; upper: number; bottom: {x: number; z: number}; top: {x: number; z: number}}[]}).levelLinks ?? [];
  for (let L = 0; L < S; L++) {
    const g = levels[L].grid, role = levels[L].role, id = levels[L].id;
    const rnd = mulberry32(seed ^ Math.imul(L + 1, 0x9e3779b1));
    const walk = new Uint8Array(n), open = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const c = g.cells[i]; walk[i] = c === FLOOR ? 1 : 0; open[i] = c === FLOOR || c === VOID ? 1 : 0; }
    // --- G: openness (share of open cells within 3 cells) via a summed-area table.
    const sat = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += open[y * W + x]; sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row; } }
    const R = 3;
    const openness = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
      const s = sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
      openness[y * W + x] = s / ((2 * R + 1) * (2 * R + 1));
    }
    // --- R: traffic lanes between doorways / stair ends.
    const src: number[] = [];
    const addSrc = (cx: number, cy: number) => { if (cx >= 0 && cy >= 0 && cx < W && cy < H && walk[cy * W + cx]) src.push(cy * W + cx); };
    for (const d of doors) {
      if (((d as {level?: number}).level ?? (layout.areas[d.a] as {level?: number} | undefined)?.level ?? 0) !== id) continue;
      addSrc(d.x + (d.w >> 1), d.y + (d.h >> 1));
    }
    for (const k of links) {
      if (k.kind !== 'stairs') continue;
      if (k.lower === id) addSrc(Math.floor(k.bottom.x / CELL), Math.floor(k.bottom.z / CELL));
      if (k.upper === id) addSrc(Math.floor(k.top.x / CELL), Math.floor(k.top.z / CELL));
    }
    const uniq = [...new Set(src)];
    sources.push(uniq.length);
    const acc = new Float32Array(n);
    if (uniq.length > 1) {
      const dist = new Int32Array(n), parent = new Int32Array(n), queue = new Int32Array(n);
      const isSrc = new Uint8Array(n);
      for (const s of uniq) isSrc[s] = 1;
      for (const s of uniq) {
        dist.fill(-1);
        let qh = 0, qt = 0, found = 0;
        dist[s] = 0; parent[s] = -1; queue[qt++] = s;
        const targets: number[] = [];
        const visit = (j: number, i: number, d: number) => {
          if (walk[j] && dist[j] < 0) { dist[j] = d + 1; parent[j] = i; queue[qt++] = j; }
        };
        while (qh < qt && found < 3) {
          const i = queue[qh++], x = i % W, d = dist[i];
          if (d > 160) break; // 80 m
          if (i !== s && isSrc[i]) { targets.push(i); found++; }
          if (x > 0) visit(i - 1, i, d);
          if (x < W - 1) visit(i + 1, i, d);
          if (i >= W) visit(i - W, i, d);
          if (i + W < n) visit(i + W, i, d);
        }
        for (const t of targets) for (let i = t; i >= 0; i = parent[i]) acc[i] += 1;
      }
    }
    boxBlur(acc, W, H, 2, 2);
    let mx = 0;
    for (let i = 0; i < n; i++) if (walk[i] && acc[i] > mx) mx = acc[i];
    const traffic = new Float32Array(n);
    for (let i = 0; i < n; i++) traffic[i] = walk[i] && mx > 0 ? clamp01(Math.sqrt(acc[i] / (mx * 0.35))) : 0;
    // Worn thresholds: every doorway on this level.
    for (const s of uniq) {
      const sx = s % W, sy = (s - sx) / W;
      for (let y = Math.max(0, sy - 3); y <= Math.min(H - 1, sy + 3); y++) for (let x = Math.max(0, sx - 3); x <= Math.min(W - 1, sx + 3); x++) {
        const i = y * W + x, d = Math.hypot(x - sx, y - sy) * CELL;
        if (walk[i] && d < 1.6) traffic[i] = Math.max(traffic[i], 0.75 * (1 - d / 1.6));
      }
    }
    // --- B: wetness: leak patches (seeded), fixture drips, damp track bed.
    const wet = new Float32Array(n);
    let openCells = 0;
    for (let i = 0; i < n; i++) { if (open[i]) openCells++; if (g.cells[i] === VOID) wet[i] = 0.3; }
    const nLeaks = Math.min(160, Math.round(openCells * CELL * CELL / 55 * LEVEL_WETNESS[role]));
    const stamp = (cx: number, cy: number, r: number, s: number) => {
      const rc = Math.ceil(r / CELL);
      for (let y = Math.max(0, cy - rc); y <= Math.min(H - 1, cy + rc); y++) for (let x = Math.max(0, cx - rc); x <= Math.min(W - 1, cx + rc); x++) {
        const d = Math.hypot(x - cx, y - cy) * CELL / r;
        if (d >= 1) continue;
        const v = s * Math.pow(1 - d * d, 1.5), i = y * W + x;
        wet[i] = 1 - (1 - wet[i]) * (1 - v);
      }
    };
    let placed = 0;
    for (let k = 0, tries = 0; k < nLeaks && tries < nLeaks * 40; tries++) {
      const i = Math.floor(rnd() * n);
      if (!open[i]) continue;
      // Most leaks come through walls and slab joints: prefer cells near a wall.
      if (openness[i] > 0.75 && rnd() < 0.65) continue;
      stamp(i % W, Math.floor(i / W), 1.0 + 3.0 * Math.pow(rnd(), 1.5), 0.4 + 0.6 * rnd());
      k++; placed++;
    }
    // Seepage along the foot of the walls below ground (the lower level sits in wet rock).
    if (role === 'lower') for (let i = 0; i < n; i++) if (open[i]) wet[i] = 1 - (1 - wet[i]) * (1 - 0.22 * clamp01((0.8 - openness[i]) / 0.35));
    for (const l of layout.lights ?? []) {
      if (((l as {level?: number}).level ?? 0) !== id || rnd() > 0.22 * LEVEL_WETNESS[role]) continue;
      stamp(Math.floor(l.x / CELL), Math.floor(l.z / CELL), 0.5 + 0.5 * rnd(), 0.55 + 0.3 * rnd());
      placed++;
    }
    leaks.push(placed);
    // --- A: neglect: per-area condition x coarse noise (patches of worse / better kept surfaces).
    const areaN = new Map<number, number>();
    const noise = valueNoise(seed ^ (L * 7919), 14), noise2 = valueNoise(seed ^ 0x51ab ^ L, 5);
    const base = L * n * 4;
    for (let i = 0; i < n; i++) {
      const a = g.area[i], voidCell = g.cells[i] === VOID;
      const key = voidCell ? -2 : a;
      let an = areaN.get(key);
      if (an === undefined) {
        an = areaNeglect(a >= 0 ? layout.areas[a] : undefined, role, voidCell) + (mulberry32(seed ^ Math.imul(key + 3, 2654435761))() - 0.5) * 0.24;
        areaN.set(key, an);
      }
      const x = i % W, y = (i - x) / W;
      const neg = clamp01(an + (noise(x, y) - 0.5) * 0.45 + (noise2(x, y) - 0.5) * 0.15);
      const o = base + i * 4;
      data[o] = Math.round(traffic[i] * 255);
      data[o + 1] = Math.round(clamp01(openness[i]) * 255);
      data[o + 2] = Math.round(Math.min(WET_CAP, wet[i]) * 255);
      data[o + 3] = Math.round(neg * 255);
    }
  }
  return {w: W, h: H, levels: S, data, stats: {ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0, sources, leaks}};
}

/** Field channels at a world point of a level (bilinear like the shader; 0..1). Tests / QA. */
export function sampleDecay(f: DecayField, level: number, x: number, z: number): {traffic: number; open: number; wet: number; neglect: number} {
  const fx = x / CELL - 0.5, fz = Math.max(0, Math.min(f.h - 1, z / CELL - 0.5));
  const x0 = Math.max(0, Math.min(f.w - 1, Math.floor(fx))), z0 = Math.floor(fz), x1 = Math.min(f.w - 1, x0 + 1), z1 = Math.min(f.h - 1, z0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0)), tz = fz - z0;
  const at = (cx: number, cz: number, c: number) => f.data[((level * f.h + cz) * f.w + cx) * 4 + c] / 255;
  const ch = (c: number) => (at(x0, z0, c) * (1 - tx) + at(x1, z0, c) * tx) * (1 - tz) + (at(x0, z1, c) * (1 - tx) + at(x1, z1, c) * tx) * tz;
  return {traffic: ch(0), open: ch(1), wet: ch(2), neglect: ch(3)};
}

// ---------------------------------------------------------------------------------------------
// Detail texture (generated, tiling)

export const DETAIL_SIZE = 512;
/**
 * World metres per repeat of the two detail samples, plus the 1D along-wall lookup that shapes seepage edges.
 * Incommensurate spans: the combined stain field only repeats every ~45 m, and the station's own decay field
 * (unique per seed) decides where any of it shows.
 */
export const DETAIL_SPANS = [5.3, 1.7] as const;
export const EDGE_SPAN = 2.9;

/** Tileable value noise on a `period` x `period` lattice over an N x N texture (smoothstep interpolation). */
function tileNoise(N: number, period: number, rnd: () => number): Float32Array {
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * period, iy = Math.floor(fy);
    let ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
    const y0 = (iy % period) * period, y1 = ((iy + 1) % period) * period;
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * period, ix = Math.floor(fx);
      let tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
      const x0 = ix % period, x1 = (ix + 1) % period;
      const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
      out[y * N + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

/** Tileable fBm (octave periods `p0`, 2 p0, ...), normalised to mean 0.5 / standard deviation `sd`. */
function tileFbm(N: number, p0: number, octaves: number, rnd: () => number, sd: number): Float32Array {
  const out = new Float32Array(N * N);
  for (let o = 0, amp = 1; o < octaves; o++, amp *= 0.5) {
    const n = tileNoise(N, p0 << o, rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
  }
  let m = 0, v = 0;
  for (const x of out) m += x;
  m /= out.length;
  for (const x of out) v += (x - m) * (x - m);
  const k = sd / Math.sqrt(v / out.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 + (out[i] - m) * k;
  return out;
}

/**
 * RGBA8 tiling detail. Deterministic. Iteration 12 QA fix: no stamped shapes anywhere (an earlier version tiled
 * round blotches with tide rims, which read as polka dots / coffee rings across lower-level walls).
 * R: smooth domain-warped fBm "stain field" (mean 0.5, sd 0.16): the shader takes soft thresholds and level sets of
 *    it, so stains and their tide edges are irregular and soft-edged;
 * G: branching hairline cracks; B: fine fBm grain (no dots); A: vertical grime / drip runs (1-5 cm wide).
 */
export function decayDetailData(size = DETAIL_SIZE, seed = 0x1d2e3f): Uint8Array {
  const N = size, rnd = mulberry32(seed);
  const G = new Float32Array(N * N), A = new Float32Array(N * N);
  const wrap = (v: number) => ((v % N) + N) % N;
  // R: fBm sampled through a tileable warp (irregular, non-circular shapes).
  const base = tileFbm(N, 3, 6, rnd, 0.16);
  const wx = tileNoise(N, 4, rnd), wy = tileNoise(N, 4, rnd);
  const R = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const sx = wrap(Math.round(x + (wx[i] - 0.5) * N * 0.12)), sy = wrap(Math.round(y + (wy[i] - 0.5) * N * 0.12));
    R[i] = base[sy * N + sx];
  }
  // B: fine grain (smooth, a touch of pixel noise).
  const B = tileFbm(N, 48, 3, rnd, 0.12);
  for (let i = 0; i < N * N; i++) B[i] += (rnd() - 0.5) * 0.06;
  // G: branching hairline cracks (random walks), 1-2 px.
  for (let k = 0; k < 26; k++) {
    let x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2;
    const len = 30 + rnd() * 160;
    const stack: [number, number, number, number][] = [[x, y, a, len]];
    while (stack.length) {
      const [sx, sy, sa, sl] = stack.pop()!;
      x = sx; y = sy; a = sa;
      for (let s = 0; s < sl; s++) {
        a += (rnd() - 0.5) * 0.5;
        x += Math.cos(a); y += Math.sin(a);
        const w = s < sl * 0.8 ? 1 : 0.6;
        G[wrap(Math.round(y)) * N + wrap(Math.round(x))] = Math.max(G[wrap(Math.round(y)) * N + wrap(Math.round(x))], w);
        if (rnd() < 0.35) G[wrap(Math.round(y + 1)) * N + wrap(Math.round(x))] = Math.max(G[wrap(Math.round(y + 1)) * N + wrap(Math.round(x))], 0.5 * w);
        if (sl > 40 && rnd() < 0.012 && stack.length < 6) stack.push([x, y, a + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd()), sl * 0.45]);
      }
    }
  }
  // A: vertical drip runs (v = up): a bright head fading downward, slightly wavy, wrapping vertically.
  // Widths ~1-5 cm at the 3.4 m sample (6.6 mm / px): real grime runs, not hairlines.
  for (let k = 0; k < 110; k++) {
    let x = rnd() * N;
    const y0 = rnd() * N, len = N * (0.15 + 0.6 * rnd()), w = 1.2 + 5.5 * rnd() * rnd(), s = 0.4 + 0.6 * rnd();
    for (let t = 0; t < len; t++) {
      x += (rnd() - 0.5) * 0.35;
      const fade = s * Math.pow(1 - t / len, 0.8);
      for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
        const v = fade * Math.min(1, 1.6 * Math.max(0, 1 - Math.abs(dx) / (w + 0.5)));
        const i = wrap(Math.round(y0 - t)) * N + wrap(Math.round(x + dx));
        A[i] = Math.max(A[i], v);
      }
    }
  }
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    out[i * 4] = Math.round(clamp01(R[i]) * 255);
    out[i * 4 + 1] = Math.round(clamp01(G[i]) * 255);
    out[i * 4 + 2] = Math.round(clamp01(B[i]) * 255);
    out[i * 4 + 3] = Math.round(clamp01(A[i]) * 255);
  }
  return out;
}

let detailTex: THREE.DataTexture | null = null;
/** The shared detail texture (generated on first use; anisotropy 1, mipmapped, repeating, linear data). */
export function decayDetailTexture(): THREE.DataTexture {
  if (detailTex) return detailTex;
  const t = new THREE.DataTexture(decayDetailData(), DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 1;
  t.colorSpace = THREE.NoColorSpace;
  t.name = 'decay-detail';
  t.needsUpdate = true;
  return (detailTex = t);
}

// ---------------------------------------------------------------------------------------------
// Shader hook

/** Uniforms shared by every decayed material (the station's field is swapped in per station). */
export const DECAY_UNIFORMS = {
  uDecayMap: {value: null as THREE.Texture | null},
  /** (cells x, cells z per level, levels, cell size m). */
  uDecayGrid: {value: new THREE.Vector4(1, 1, 1, CELL)},
  uDecayTex: {value: null as THREE.Texture | null},
  uDecayAge: {value: DECAY_AGE},
};

let neutralMap: THREE.DataTexture | null = null;
function neutral(): THREE.DataTexture {
  if (!neutralMap) {
    // Mid-traffic, open, dry, average neglect: a modest uniform patina until a station field exists.
    neutralMap = new THREE.DataTexture(new Uint8Array([90, 230, 20, 140]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    neutralMap.needsUpdate = true;
  }
  return neutralMap;
}

export const DECAY_HOOK = 'arch-decay-v1';

export const DECAY_VERTEX = /* glsl */ `
{
	vec4 dcP = vec4( transformed, 1.0 );
	vec3 dcN = objectNormal;
	#ifdef USE_INSTANCING
		dcP = instanceMatrix * dcP;
		dcN = mat3( instanceMatrix ) * dcN;
	#endif
	dcP = modelMatrix * dcP;
	vDecayPos = dcP.xyz;
	vDecayN = normalize( mat3( modelMatrix ) * dcN );
}`;

export const DECAY_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uDecayMap;
uniform vec4 uDecayGrid;
uniform sampler2D uDecayTex;
uniform float uDecayAge;
uniform vec4 uDecayP0;
uniform vec4 uDecayP1;
uniform vec4 uDecayP2;
uniform vec3 uDecayTint;
varying vec3 vDecayPos;
varying vec3 vDecayN;
float dcHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }`;

/**
 * Fragment code after <map_fragment> (diffuseColor holds the textured albedo); declares dcRough (roughness offset,
 * applied after <roughnessmap_fragment>). P0 = grime, streaks, efflorescence, stains; P1 = wear, dust, cracks,
 * peel; P2 = tile grid (m), tile loss, fade, paint wear.
 */
export const DECAY_FRAGMENT = /* glsl */ `
float dcRough = 0.0;
{
	vec3 dn = normalize( vDecayN );
	float wallK = 1.0 - smoothstep( 0.45, 0.75, abs( dn.y ) );
	float floorK = smoothstep( 0.6, 0.85, dn.y );
	float ceilK = smoothstep( 0.6, 0.85, - dn.y );
	// The open cell in front of the surface: its level slot and floor (station light field, when installed).
	vec3 dp = vDecayPos + dn * 0.2;
	float dcSlot = 0.0;
	float dcFloor = 0.0;
	float dcCeil = 3.2;
	#ifdef LF_FLOOR_AT
	{
		ivec3 size = textureSize( probesSH, 0 );
		vec2 cell = ( probesMax.xz - probesMin.xz ) / vec2( size.xy );
		ivec2 ci = clamp( ivec2( floor( ( dp.xz - probesMin.xz ) / cell ) ), ivec2( 0 ), size.xy - 1 );
		float yr = probesMax.y - probesMin.y;
		${fieldSlotGLSL('probesSH', 'ci', 'size', 'dp.y', 'probesMin.y', 'yr')}
		dcSlot = float( lfSlot );
		dcFloor = lfFl;
		dcCeil = lfCe;
	}
	#endif
	vec2 dcCell = dp.xz / uDecayGrid.w;
	float dcRow = clamp( dcCell.y, 0.5, uDecayGrid.y - 0.5 ) + min( dcSlot, uDecayGrid.z - 1.0 ) * uDecayGrid.y;
	vec4 D = texture2D( uDecayMap, vec2( dcCell.x / uDecayGrid.x, dcRow / ( uDecayGrid.y * uDecayGrid.z ) ) );
	float traffic = D.r, open = D.g, wet = D.b;
	float k = uDecayAge * mix( 0.55, 1.35, D.a );
	float h = max( 0.0, vDecayPos.y - dcFloor );
	float hTop = max( 0.0, dcCeil - vDecayPos.y );
	vec2 wuv = wallK > 0.5 ? vec2( abs( dn.x ) > abs( dn.z ) ? vDecayPos.z : vDecayPos.x, vDecayPos.y ) : vDecayPos.xz;
	vec4 TA = texture2D( uDecayTex, wuv * ${(1 / DETAIL_SPANS[0]).toFixed(5)} );
	vec4 TB = texture2D( uDecayTex, wuv * ${(1 / DETAIL_SPANS[1]).toFixed(5)} + vec2( 0.43, 0.17 ) );
	// Irregular stain field (smooth warped fBm at two incommensurate scales: no stamps, no visible repeat).
	float S = TA.r * 0.65 + TB.r * 0.35;
	float grain = TB.b;
	float run = max( TA.a, TB.a * 0.6 );
	vec3 c = diffuseColor.rgb;
	float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	float corner = 1.0 - smoothstep( 0.32, 0.7, open );
	float wetM = smoothstep( 0.15, 0.65, wet );
	// Colours are LINEAR (diffuseColor after the sRGB map decode).
	// Colour aging: glaze yellowing / chalky paint, bounded so finishes keep their identity.
	c = mix( c, vec3( lum ) * vec3( 1.08, 1.0, 0.84 ), clamp( uDecayP2.z * k * 0.45, 0.0, 0.5 ) );
	// Grime film: walls darken toward the floor and into corners; ceilings toward the walls (soot); floors soiled.
	// Large-scale variation from the stain field is gentle (no shapes).
	float lowH = 1.0 - smoothstep( 0.0, 1.4, h );
	float gr = uDecayP0.x * k * ( wallK * ( 0.32 + 0.75 * lowH + 0.45 * corner + 0.3 * ( S - 0.5 ) ) + ceilK * ( 0.3 + 0.6 * corner + 0.3 * ( S - 0.5 ) ) + floorK * ( 0.25 + 0.3 * corner ) );
	gr *= 0.8 + 0.4 * grain;
	c = mix( c, c * uDecayTint, clamp( gr, 0.0, 0.85 ) );
	// Walls: vertical grime runs, strongest just under the ceiling line / seams, heavier where wet.
	float topRun = 1.0 - 0.6 * smoothstep( 0.3, 2.6, hTop );
	float st = uDecayP0.y * k * wallK * run * ( 0.6 + 1.0 * wetM ) * topRun * smoothstep( 0.1, 0.5, h );
	c = mix( c, c * uDecayTint * 0.6, clamp( st, 0.0, 0.7 ) );
	// Walls, only where wet: seepage hanging from the ceiling seam down to a wavy edge (a faint tide line there) with
	// runs inside it, and rising damp at the foot below a faint wavy tide line. Edges vary along the wall only.
	float edgeN = texture2D( uDecayTex, vec2( wuv.x * ${(1 / EDGE_SPAN).toFixed(5)}, 0.31 ) ).r;
	float wW = smoothstep( 0.3, 0.75, wet ) * wallK;
	float seepL = ( 0.4 + 1.6 * wW ) * ( 0.5 + edgeN );
	float curtain = wW * ( 1.0 - smoothstep( seepL - 0.25, seepL + 0.05, hTop ) ) * ( 0.6 + 0.4 * run );
	float tideT = wW * exp( - pow( ( hTop - seepL ) / 0.03, 2.0 ) );
	float foot = 0.25 + 0.55 * wW * ( 0.4 + edgeN );
	float damp = wW * ( 1.0 - smoothstep( foot - 0.12, foot, h ) );
	float tideF = wW * exp( - pow( ( h - foot ) / 0.03, 2.0 ) );
	float sw = uDecayP0.w * k;
	c = mix( c, c * vec3( 0.8, 0.74, 0.62 ), clamp( sw * ( curtain * 0.45 + damp * 0.35 ), 0.0, 0.4 ) );
	c = mix( c, c * vec3( 0.66, 0.58, 0.46 ), clamp( sw * ( tideT + tideF ) * 0.3, 0.0, 0.25 ) );
	dcRough -= 0.12 * clamp( curtain + damp, 0.0, 1.0 );
	// Efflorescence: salt left along the evaporation fronts (wall tide lines); sparse irregular bloom on wet floors /
	// ceilings.
	float S2 = smoothstep( 0.62, 0.76, S );
	float ef = uDecayP0.z * k * ( ( tideT * 0.6 + tideF ) * smoothstep( 0.3, 0.7, grain + 0.2 ) + ( floorK * 0.35 + ceilK * 0.2 ) * wetM * S2 );
	c = mix( c, vec3( 0.7, 0.68, 0.61 ), clamp( ef * 0.6, 0.0, 0.45 ) );
	dcRough += 0.2 * clamp( ef, 0.0, 1.0 );
	// Water stains, only where wet: irregular dried puddle marks (floors) and brown leak stains (ceilings), each with a
	// faint irregular tide edge (a level set of the stain field).
	float stain = smoothstep( 0.56, 0.7, S );
	float rim = 1.0 - smoothstep( 0.0, 0.02, abs( S - 0.56 ) );
	float sf = uDecayP0.w * k * floorK * ( 0.12 + 0.8 * wetM );
	c = mix( c, c * vec3( 0.66, 0.6, 0.5 ), clamp( sf * stain * 0.5, 0.0, 0.4 ) );
	c = mix( c, c * vec3( 0.6, 0.54, 0.44 ), clamp( sf * rim * 0.25, 0.0, 0.2 ) );
	float sc = uDecayP0.w * k * ceilK * ( 0.05 + wetM );
	c = mix( c, c * vec3( 0.85, 0.72, 0.52 ), clamp( sc * stain * 0.6, 0.0, 0.45 ) );
	c = mix( c, c * vec3( 0.58, 0.46, 0.32 ), clamp( sc * rim * 0.35, 0.0, 0.3 ) );
	dcRough -= 0.1 * clamp( sf * stain, 0.0, 1.0 );
	// Floors: worn lanes (polished, ground-in grime; painted edges wear through) vs dust where nobody walks.
	float lane = traffic * floorK;
	c *= 1.0 - 0.22 * uDecayP1.x * lane;
	dcRough -= 0.2 * uDecayP1.x * lane;
	c = mix( c, vec3( 0.18, 0.17, 0.16 ) * ( 0.85 + 0.3 * grain ), clamp( uDecayP2.w * uDecayP1.x * lane * smoothstep( 0.3, 0.7, grain + 0.25 * ( S - 0.5 ) ), 0.0, 0.75 ) );
	float dust = uDecayP1.y * k * floorK * ( 0.18 + 0.82 * pow( 1.0 - traffic, 1.5 ) * ( 0.4 + 0.6 * corner + 0.25 * ( 1.0 - open ) ) );
	dust *= 0.7 + 0.6 * grain;
	c = mix( c, vec3( 0.21, 0.19, 0.15 ) * ( 0.8 + 0.4 * grain ), clamp( dust, 0.0, 0.75 ) );
	dcRough += 0.3 * clamp( dust, 0.0, 1.0 );
	// Hairline cracks (worst where neglected).
	float cr = uDecayP1.z * k * smoothstep( 0.45, 0.85, TB.g ) * ( 0.5 + 0.5 * D.a );
	c *= 1.0 - clamp( cr * 0.75, 0.0, 0.75 );
	// Peeling paint: irregular flakes (stain-field level set, grain-broken edges) in damp, neglected patches.
	float pe = uDecayP1.w * k * ( wallK + ceilK );
	float pv = S + 0.15 * ( grain - 0.5 ) + 0.12 * wet + 0.06 * D.a;
	float peel = smoothstep( 0.82 - 0.1 * pe, 0.85 - 0.1 * pe, pv ) * step( 0.05, pe );
	c = mix( c, vec3( 0.32, 0.31, 0.29 ) * ( 0.8 + 0.4 * grain ), peel * 0.5 );
	c += vec3( 0.02 ) * peel * ( 1.0 - peel ) * 4.0;
	dcRough += 0.2 * peel;
	// Floor tiles: lost tiles (dark bedding, chipped edges), lifted / discoloured ones with grimy joints.
	if ( uDecayP2.x > 0.0 && floorK > 0.5 ) {
		vec2 tc = wuv / uDecayP2.x;
		vec2 tf = fract( tc );
		float r = dcHash( floor( tc ) );
		float loss = uDecayP2.y * k;
		float edge = 1.0 - smoothstep( 0.0, 0.05, min( min( tf.x, tf.y ), min( 1.0 - tf.x, 1.0 - tf.y ) ) );
		if ( r < loss ) {
			c = mix( vec3( 0.064, 0.059, 0.051 ) * ( 0.7 + 0.6 * grain ), c * 0.35, edge );
			dcRough += 0.35;
		} else if ( r < loss * 3.5 ) {
			c *= mix( vec3( 0.8, 0.76, 0.68 ), vec3( 0.45, 0.42, 0.38 ), edge );
		}
	}
	diffuseColor.rgb = c;
}`;

export const DECAY_ANCHORS = {vertex: ['#include <common>', '#include <fog_vertex>'], fragment: ['#include <common>', '#include <map_fragment>', '#include <roughnessmap_fragment>']};

/** Install the decay hook on one material with a profile (idempotent; replaces an earlier profile). */
export function applyDecay(m: THREE.Material, profile: DecayProfile): void {
  if (!DECAY_UNIFORMS.uDecayTex.value) DECAY_UNIFORMS.uDecayTex.value = decayDetailTexture();
  if (!DECAY_UNIFORMS.uDecayMap.value) DECAY_UNIFORMS.uDecayMap.value = neutral();
  const p0 = new THREE.Vector4(profile.grime, profile.streaks, profile.efflor, profile.stains);
  const p1 = new THREE.Vector4(profile.wear, profile.dust, profile.cracks, profile.peel);
  const p2 = new THREE.Vector4(profile.tile, profile.tileLoss, profile.fade, profile.paintWear);
  const tint = new THREE.Vector3(...profile.tint);
  m.userData.decay = profile;
  addShaderHook(m, DECAY_HOOK, sh => {
    Object.assign(sh.uniforms, DECAY_UNIFORMS, {uDecayP0: {value: p0}, uDecayP1: {value: p1}, uDecayP2: {value: p2}, uDecayTint: {value: tint}});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDecayPos;\nvarying vec3 vDecayN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + DECAY_VERTEX);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DECAY_FRAGMENT_PARS)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + DECAY_FRAGMENT)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp( roughnessFactor + dcRough, 0.04, 1.0 );');
  });
}

const shopCopies = new WeakMap<WorldMaterials, Map<string, THREE.Material>>();
/**
 * Storefront-unit interior finish for ARCH meshes: a decayed copy of the shared shape material (the shared one
 * stays unaged: counters, displays and other props use it).
 */
export function archShopMaterial(mats: WorldMaterials, key: string): THREE.Material {
  let cache = shopCopies.get(mats);
  if (!cache) shopCopies.set(mats, (cache = new Map()));
  let m = cache.get(key);
  if (!m) {
    m = cloneWithShaderHooks(shapeMaterial(mats, key));
    m.name = `arch-shop-${key}`;
    const prof = (DECAY_PROFILES as Record<string, DecayProfile>)[key];
    if (prof) applyDecay(m, prof);
    cache.set(key, m);
  }
  return m;
}

const decayed = new WeakSet<WorldMaterials>();
/** Hook every architectural MatKey of `mats` (once per WorldMaterials). */
export function decayWorldMaterials(mats: WorldMaterials): void {
  if (decayed.has(mats)) return;
  decayed.add(mats);
  for (const k of DECAY_MAT_KEYS) applyDecay(mats.get(k), DECAY_PROFILES[k]);
}

let fieldTex: THREE.DataTexture | null = null;
/** Upload a station's decay field to the shared uniforms (disposes the previous station's texture). */
export function setDecayField(f: DecayField): THREE.DataTexture {
  const t = new THREE.DataTexture(f.data, f.w, f.h * f.levels, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.unpackAlignment = 1;
  t.name = 'decay-field';
  t.needsUpdate = true;
  if (fieldTex) fieldTex.dispose();
  fieldTex = t;
  DECAY_UNIFORMS.uDecayMap.value = t;
  DECAY_UNIFORMS.uDecayGrid.value.set(f.w, f.h, f.levels, CELL);
  if (!DECAY_UNIFORMS.uDecayTex.value) DECAY_UNIFORMS.uDecayTex.value = decayDetailTexture();
  return t;
}

/** Builder entry: age a station's architecture (field + hooks). Returns the field (stats / tests). */
export function applyStationDecay(layout: StationLayout, levels: readonly Level[], mats: WorldMaterials): DecayField {
  decayWorldMaterials(mats);
  const f = buildDecayField(layout, levels);
  setDecayField(f);
  return f;
}
