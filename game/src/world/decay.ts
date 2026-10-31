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
// 3. ONE NODE HOOK PAIR ('arch-decay-v1' colour + roughness, render/nodeHooks.ts order 200; iteration 13: TSL on node
//    materials, the iteration-12 GLSL maths unchanged) on the architectural materials only, with a
//    per-material profile (DECAY_PROFILES): glaze yellowing / paint fade, grime toward the floor and into
//    corners, vertical grime runs strongest under the ceiling line; where wet only: seepage hanging from the ceiling
//    seam to a wavy faint tide line, rising damp at the foot, salt bloom along those evaporation fronts; floor dust
//    vs worn lanes, irregular dried puddle marks, cracks, peeling paint, lost / lifted / discoloured floor tiles,
//    soft brown ceiling leak stains. Stains come from level sets of a smooth stain field: no stamped circles.
//    Bounded cost: 3 light-field texel fetches (level slot pick: column header + extended-column group texel, which the
//    shader only reads for a tower column; band floor / ceiling; world/lightFieldNode.ts lfBandAt),
//    4 texture fetches, no loops, no branches around texture samples (uniform control flow, WGSL-safe).
//    The detail texture has anisotropy 1 (render/softwareGl.ts, materials.ts thinTrim).
// The wall-treatment pass (world/wallDetailPlan.ts) adds the discrete pieces on walls (cracks, chips, lost tiles,
// leak streaks, rust bleed below wall-mounted steel) at its 30-year condition (WALL_AGE_30Y).

import * as THREE from 'three';
import {CELL, FLOOR, VOID} from '../gen/grid';
import type {Level} from '../gen/levels';
import type {Area, StationLayout} from '../gen/station';
import {hashString, mulberry32} from '../core/rng';
import {NodeMaterial, QuadMesh, RenderTarget, type Node} from 'three/webgpu';
import {
  Fn, clamp, dot, float, floor, fract, int, ivec2, materialColor, materialRoughness, max, min, mix, modelWorldMatrix, normalLocal, positionWorld, pow,
  screenCoordinate, smoothstep, step, texture, textureLoad, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {addNodeHook} from '../render/nodeHooks';
import {SurfaceNodeMaterial, cloneSurfaceMaterial, worldMapped, type MatKey, type WorldMapping, type WorldMaterials} from './materials';
import {shapeMaterial} from './shapeMaterials';
import {asColor, isNodeMaterial, lfBandNode, matRef, pick, sharedStage, skipInShadowPass} from './surfaceNodes';

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
  // Task office-seamless-20261029: tower storeys keep the main-level rule (iteration 16 built them as 'main' sections).
  if (area?.lighting === 'dark') n += 0.1;
  else if (area?.lighting === 'dim') n += 0.05;
  return Math.max(0, Math.min(1, n));
}

/**
 * Leak density per level role (relative): water finds its way down. Task office-seamless-20261029: 'office' = the dry,
 * heated tower storeys above the street (fewer leaks than the upper deck; no seepage).
 */
// Task office-overhaul-20261030 (lane STRUCT): 'roof' = the open-sky roof deck: rained on for decades (ponding, streaks).
// Task track3-eaton-centre-20261031 (lane GEN): 'ring' = the mall's retail rings under the glass roof (dry like the office storeys).
export const LEVEL_WETNESS: Record<Level['role'], number> = {upper: 0.6, main: 1, lower: 1.4, office: 0.35, roof: 1.2, ring: 0.35};
/** Wetness never exceeds this (the lower level must still read as tile / paint with stains, not as a pattern). */
export const WET_CAP = 0.7;

// ---------------------------------------------------------------------------------------------
// Decay field (CPU)

export interface DecayField {
  /** Cells per level row / rows per level / levels; texel (x, y + level * h). */
  w: number; h: number; levels: number;
  /** World size of one texel (m; default CELL). Task office-seamless-20261029: > CELL only for a stack too tall for one texture. */
  cell?: number;
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
  const C = f.cell ?? CELL;
  const fx = x / C - 0.5, fz = Math.max(0, Math.min(f.h - 1, z / C - 0.5));
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
// Decay node hooks (Iteration 13, MAT-A: the iteration-12 GLSL hook 'arch-decay-v1' ported to TSL; same maths)

let neutralMap: THREE.DataTexture | null = null;
function neutral(): THREE.DataTexture {
  if (!neutralMap) {
    // Mid-traffic, open, dry, average neglect: a modest uniform patina until a station field exists.
    neutralMap = new THREE.DataTexture(new Uint8Array([90, 230, 20, 140]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    neutralMap.needsUpdate = true;
  }
  return neutralMap;
}

/**
 * Inputs shared by every decayed material (the station's field is swapped in per station): TSL texture / uniform nodes
 * (`.value` is the bound texture / vector, as the GLSL uniforms were).
 */
export const DECAY_UNIFORMS = {
  uDecayMap: texture(neutral()),
  /** (cells x, cells z per level, levels, cell size m). */
  uDecayGrid: uniform(new THREE.Vector4(1, 1, 1, CELL)),
  /**
   * The generated detail texture (bound on first applyDecay). Its own placeholder: three shares one sampler uniform between
   * texture nodes whose textures have the same uuid at build time, so the two inputs must never start on one texture.
   */
  uDecayTex: texture(Object.assign(new THREE.DataTexture(new Uint8Array([128, 0, 128, 0]), 1, 1), {needsUpdate: true, name: 'decay-detail-placeholder'})),
  uDecayAge: uniform(DECAY_AGE),
};

/** Hook keys: decay colour stage (iteration-12 name) and its roughness stage; order 200 (render/nodeHooks.ts). */
export const DECAY_HOOK = 'arch-decay-v1';
export const DECAY_ROUGH_HOOK = 'arch-decay-v1-roughness';
export const DECAY_ORDER = 200;

/** GLSL dcHash: 2D -> [0, 1) hash per floor tile. */
const dcHash = Fn(([p]: [Node<'vec2'>]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({name: 'dcHash', type: 'float', inputs: [{name: 'p', type: 'vec2'}]});

const dcP0 = matRef('decayP0', 'vec4'), dcP1 = matRef('decayP1', 'vec4'), dcP2 = matRef('decayP2', 'vec4'), dcTint = matRef('decayTint', 'vec3');
const f1 = float(1);
const sat = (x: Node<'float'>, hi = 1) => clamp(x, 0.0, hi);

/**
 * Everything of the decay that does not depend on the surface colour, shared (module singletons) by every decayed
 * material: surface orientation, the level band in front of the surface (station light field), the decay field texel,
 * the two detail samples + the along-wall edge lookup, and the roughness offset. Same maths as iteration 12.
 */
/**
 * The decay field texel for the open cell at `dp` (in front of the surface): the level band holding it (station light
 * field) picks the level's rows of the field texture. Shared by the material graph and the GPU probe (probeDecayGPU).
 */
function decayFieldAt(dp: Node<'vec3'>): {band: Node<'vec3'>; uv: Node<'vec2'>} {
  const band = lfBandNode(dp).toVar('dcBand');
  const G = DECAY_UNIFORMS.uDecayGrid as unknown as Node<'vec4'>;
  const cell = dp.xz.div(G.w);
  const row = clamp(cell.y, 0.5, G.y.sub(0.5)).add(min(band.x, G.z.sub(1.0)).mul(G.y));
  return {band, uv: vec2(cell.x.div(G.x), row.div(G.y.mul(G.z)))};
}

const DC = (() => {
  const pos = positionWorld;
  const dn = varying(normalLocal.transformDirection(modelWorldMatrix), 'vDecayN').normalize().toVar('dcN');
  const wallK = f1.sub(smoothstep(0.45, 0.75, dn.y.abs())).toVar('dcWallK');
  const floorK = smoothstep(0.6, 0.85, dn.y).toVar('dcFloorK');
  const ceilK = smoothstep(0.6, 0.85, dn.y.negate()).toVar('dcCeilK');
  // The open cell in front of the surface: its level slot, floor and ceiling (station light field, when installed).
  const dp = pos.add(dn.mul(0.2)).toVar('dcP');
  const {band, uv: fieldUv} = decayFieldAt(dp);
  const D = (DECAY_UNIFORMS.uDecayMap.sample(fieldUv) as unknown as Node<'vec4'>).toVar('dcD');
  const traffic = D.x, open = D.y, wet = D.z;
  const k = (DECAY_UNIFORMS.uDecayAge as unknown as Node<'float'>).mul(mix(0.55, 1.35, D.w)).toVar('dcK');
  const h = max(0.0, pos.y.sub(band.y)).toVar('dcH');
  const hTop = max(0.0, band.z.sub(pos.y)).toVar('dcHTop');
  const wuv = pick(wallK.greaterThan(0.5), vec2(pick(dn.x.abs().greaterThan(dn.z.abs()), pos.z, pos.x), pos.y), pos.xz);
  const tex = DECAY_UNIFORMS.uDecayTex;
  const TA = (tex.sample(wuv.mul(1 / DETAIL_SPANS[0])) as unknown as Node<'vec4'>).toVar('dcTA');
  const TB = (tex.sample(wuv.mul(1 / DETAIL_SPANS[1]).add(vec2(0.43, 0.17))) as unknown as Node<'vec4'>).toVar('dcTB');
  const edgeN = (tex.sample(vec2(wuv.x.mul(1 / EDGE_SPAN), 0.31)) as unknown as Node<'vec4'>).x.toVar('dcEdge');
  // Irregular stain field (smooth warped fBm at two incommensurate scales: no stamps, no visible repeat).
  const S = TA.x.mul(0.65).add(TB.x.mul(0.35)).toVar('dcS');
  const grain = TB.z, run = max(TA.w, TB.w.mul(0.6));
  const corner = f1.sub(smoothstep(0.32, 0.7, open)).toVar('dcCorner');
  const wetM = smoothstep(0.15, 0.65, wet).toVar('dcWetM');
  // Grime film: walls toward the floor and into corners; ceilings toward the walls (soot); floors soiled.
  const lowH = f1.sub(smoothstep(0.0, 1.4, h));
  const gr = dcP0.x.mul(k).mul(
    wallK.mul(lowH.mul(0.75).add(0.32).add(corner.mul(0.45)).add(S.sub(0.5).mul(0.3)))
      .add(ceilK.mul(corner.mul(0.6).add(0.3).add(S.sub(0.5).mul(0.3))))
      .add(floorK.mul(corner.mul(0.3).add(0.25)))).mul(grain.mul(0.4).add(0.8));
  // Walls: vertical grime runs, strongest just under the ceiling line / seams, heavier where wet.
  const topRun = f1.sub(smoothstep(0.3, 2.6, hTop).mul(0.6));
  const st = dcP0.y.mul(k).mul(wallK).mul(run).mul(wetM.add(0.6)).mul(topRun).mul(smoothstep(0.1, 0.5, h));
  // Walls, only where wet: seepage curtain from the ceiling seam to a wavy faint tide line, rising damp at the foot.
  const wW = smoothstep(0.3, 0.75, wet).mul(wallK).toVar('dcWW');
  const seepL = wW.mul(1.6).add(0.4).mul(edgeN.add(0.5));
  const curtain = wW.mul(f1.sub(smoothstep(seepL.sub(0.25), seepL.add(0.05), hTop))).mul(run.mul(0.4).add(0.6)).toVar('dcCurtain');
  const tT = hTop.sub(seepL).div(0.03), tideT = wW.mul(tT.mul(tT).negate().exp()).toVar('dcTideT');
  const foot = wW.mul(0.55).mul(edgeN.add(0.4)).add(0.25);
  const damp = wW.mul(f1.sub(smoothstep(foot.sub(0.12), foot, h))).toVar('dcDamp');
  const tF = h.sub(foot).div(0.03), tideF = wW.mul(tF.mul(tF).negate().exp()).toVar('dcTideF');
  const sw = dcP0.w.mul(k);
  // Efflorescence: salt along the evaporation fronts (wall tide lines); sparse irregular bloom on wet floors / ceilings.
  const S2 = smoothstep(0.62, 0.76, S);
  const ef = dcP0.z.mul(k).mul(tideT.mul(0.6).add(tideF).mul(smoothstep(0.3, 0.7, grain.add(0.2)))
    .add(floorK.mul(0.35).add(ceilK.mul(0.2)).mul(wetM).mul(S2))).toVar('dcEf');
  // Water stains (wet only): dried puddle marks (floors), brown leak stains (ceilings), faint tide edges.
  const stain = smoothstep(0.56, 0.7, S).toVar('dcStain');
  const rim = f1.sub(smoothstep(0.0, 0.02, S.sub(0.56).abs()));
  const sf = dcP0.w.mul(k).mul(floorK).mul(wetM.mul(0.8).add(0.12)).toVar('dcSf');
  const sc = dcP0.w.mul(k).mul(ceilK).mul(wetM.add(0.05));
  // Floors: worn lanes (polished, ground-in; painted edges wear through) vs dust where nobody walks.
  const lane = traffic.mul(floorK).toVar('dcLane');
  const laneWear = sat(dcP2.w.mul(dcP1.x).mul(lane).mul(smoothstep(0.3, 0.7, grain.add(S.sub(0.5).mul(0.25)))), 0.75);
  const dust = dcP1.y.mul(k).mul(floorK).mul(pow(f1.sub(traffic), 1.5).mul(corner.mul(0.6).add(0.4).add(f1.sub(open).mul(0.25))).mul(0.82).add(0.18))
    .mul(grain.mul(0.6).add(0.7)).toVar('dcDust');
  // Hairline cracks (worst where neglected).
  const cr = dcP1.z.mul(k).mul(smoothstep(0.45, 0.85, TB.y)).mul(D.w.mul(0.5).add(0.5));
  // Peeling paint: irregular flakes (stain-field level set, grain-broken edges) in damp, neglected patches.
  const pe = dcP1.w.mul(k).mul(wallK.add(ceilK));
  const pv = S.add(grain.sub(0.5).mul(0.15)).add(wet.mul(0.12)).add(D.w.mul(0.06));
  const peel = smoothstep(pe.mul(-0.1).add(0.82), pe.mul(-0.1).add(0.85), pv).mul(step(0.05, pe)).toVar('dcPeel');
  // Floor tiles: lost tiles (dark bedding, chipped edges), lifted / discoloured ones with grimy joints.
  const tc = wuv.div(max(dcP2.x, 1e-3));
  const tf = fract(tc);
  const r = dcHash(floor(tc));
  const loss = dcP2.y.mul(k);
  const tileOn = dcP2.x.greaterThan(0.0).and(floorK.greaterThan(0.5));
  const lost = float(tileOn.and(r.lessThan(loss))).toVar('dcLost');
  const lifted = float(tileOn.and(r.greaterThanEqual(loss)).and(r.lessThan(loss.mul(3.5)))).toVar('dcLifted');
  const edge = f1.sub(smoothstep(0.0, 0.05, min(min(tf.x, tf.y), min(f1.sub(tf.x), f1.sub(tf.y))))).toVar('dcEdge2');
  const rough = sat(curtain.add(damp)).mul(-0.12)
    .add(sat(ef).mul(0.2))
    .add(sat(sf.mul(stain)).mul(-0.1))
    .add(dcP1.x.mul(lane).mul(-0.2))
    .add(sat(dust).mul(0.3))
    .add(peel.mul(0.2))
    .add(lost.mul(0.35));
  return {D, k, wallK, floorK, ceilK, S, grain, corner, wetM, gr, st, curtain, damp, tideT, tideF, sw, ef, stain, rim, sf, sc, lane, laneWear, dust, cr, peel, lost, lifted, edge, rough: rough.toVar('dcRough')};
})();

/** The decayed albedo of linear colour `c0` (iteration-12 order of operations). */
function decayColor(c0: Node<'vec3'>): Node<'vec3'> {
  const d = DC;
  let c: Node<'vec3'> = c0;
  const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Colour aging: glaze yellowing / chalky paint, bounded so finishes keep their identity.
  c = mix(c, vec3(lum).mul(vec3(1.08, 1.0, 0.84)), sat(dcP2.z.mul(d.k).mul(0.45), 0.5));
  c = mix(c, c.mul(dcTint), sat(d.gr, 0.85));
  c = mix(c, c.mul(dcTint).mul(0.6), sat(d.st, 0.7));
  c = mix(c, c.mul(vec3(0.8, 0.74, 0.62)), sat(d.sw.mul(d.curtain.mul(0.45).add(d.damp.mul(0.35))), 0.4));
  c = mix(c, c.mul(vec3(0.66, 0.58, 0.46)), sat(d.sw.mul(d.tideT.add(d.tideF)).mul(0.3), 0.25));
  c = mix(c, vec3(0.7, 0.68, 0.61), sat(d.ef.mul(0.6), 0.45));
  c = mix(c, c.mul(vec3(0.66, 0.6, 0.5)), sat(d.sf.mul(d.stain).mul(0.5), 0.4));
  c = mix(c, c.mul(vec3(0.6, 0.54, 0.44)), sat(d.sf.mul(d.rim).mul(0.25), 0.2));
  c = mix(c, c.mul(vec3(0.85, 0.72, 0.52)), sat(d.sc.mul(d.stain).mul(0.6), 0.45));
  c = mix(c, c.mul(vec3(0.58, 0.46, 0.32)), sat(d.sc.mul(d.rim).mul(0.35), 0.3));
  c = c.mul(f1.sub(dcP1.x.mul(d.lane).mul(0.22)));
  c = mix(c, vec3(0.18, 0.17, 0.16).mul(d.grain.mul(0.3).add(0.85)), d.laneWear);
  c = mix(c, vec3(0.21, 0.19, 0.15).mul(d.grain.mul(0.4).add(0.8)), sat(d.dust, 0.75));
  c = c.mul(f1.sub(sat(d.cr.mul(0.75), 0.75)));
  c = mix(c, vec3(0.32, 0.31, 0.29).mul(d.grain.mul(0.4).add(0.8)), d.peel.mul(0.5));
  c = c.add(vec3(0.02).mul(d.peel.mul(f1.sub(d.peel)).mul(4.0)));
  // Lost tile: bedding with chipped edges; lifted / discoloured: tinted with grimy joints. 0 / 1 masks with mix (exact
  // selection; TSL select() isolates its branches, which would duplicate this whole colour chain per branch).
  const cLost = mix(vec3(0.064, 0.059, 0.051).mul(d.grain.mul(0.6).add(0.7)), c.mul(0.35), d.edge);
  const cLifted = c.mul(mix(vec3(0.8, 0.76, 0.68), vec3(0.45, 0.42, 0.38), d.edge));
  return mix(mix(c, cLifted, d.lifted), cLost, d.lost);
}

const decayColorStage = sharedStage(prev => {
  const c = asColor(prev, materialColor);
  return skipInShadowPass(vec4(decayColor(c.rgb), c.a), c, 'vec4');
});
const decayRoughStage = sharedStage(prev => clamp(float((prev ?? materialRoughness) as Node<'float'>).add(DC.rough), 0.04, 1.0));

type DecayTarget = NodeMaterial & Pick<SurfaceNodeMaterial, 'decayP0' | 'decayP1' | 'decayP2' | 'decayTint'>;

/**
 * Install the decay hooks on one (node) material with a profile (idempotent; replaces an earlier profile). The profile
 * lives in the material's decay properties (SurfaceNodeMaterial), so every decayed material shares the program.
 */
export function applyDecay(m: THREE.Material, profile: DecayProfile): void {
  if (!isNodeMaterial(m)) throw new Error(`applyDecay: ${m.type} "${m.name}" is not a node material`);
  if (DECAY_UNIFORMS.uDecayTex.value !== detailTex || !detailTex) DECAY_UNIFORMS.uDecayTex.value = decayDetailTexture();
  const t = m as DecayTarget;
  // Plain node materials get the properties too (clones keep them only on SurfaceNodeMaterial).
  if (!(t.decayP0 instanceof THREE.Vector4)) Object.assign(t, {decayP0: new THREE.Vector4(0, 0, 0, 0), decayP1: new THREE.Vector4(0, 0, 0, 0), decayP2: new THREE.Vector4(0, 0, 0, 0), decayTint: new THREE.Vector3(1, 1, 1)});
  t.decayP0.set(profile.grime, profile.streaks, profile.efflor, profile.stains);
  t.decayP1.set(profile.wear, profile.dust, profile.cracks, profile.peel);
  t.decayP2.set(profile.tile, profile.tileLoss, profile.fade, profile.paintWear);
  t.decayTint.set(...profile.tint);
  m.userData.decay = profile;
  addNodeHook(m, {key: DECAY_HOOK, stage: 'color', order: DECAY_ORDER, fn: decayColorStage});
  addNodeHook(m, {key: DECAY_ROUGH_HOOK, stage: 'roughness', order: DECAY_ORDER, fn: decayRoughStage});
  // World-mapped finishes (storefront-unit tile / quarry tile): iteration 12 applied the decay BEFORE the world-mapping
  // floor grime / tone variation (both GLSL hooks patched after <map_fragment>, the later one landing first); keep that.
  const wm = m.userData.worldMapping as WorldMapping | undefined;
  if (wm && m instanceof SurfaceNodeMaterial) worldMapped(m, wm, DECAY_ORDER + 50);
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
    m = cloneSurfaceMaterial(shapeMaterial(mats, key));
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

/**
 * Most texture rows of the decay field (levels are stacked in v): WebGPU's default maxTextureDimension2D. Task
 * office-seamless-20261029: a taller stack (many storeys x a deep grid) is box-downsampled in X/Z until it fits (the
 * shader reads the texel size from uDecayGrid.w, so it needs no change); every Subway station and the tower fit as is.
 */
export const MAX_DECAY_ROWS = 8192;

/** Box-downsample a decay field by k in X/Z (per level; texel = k cells). */
export function downsampleDecay(f: DecayField, k: number): DecayField {
  if (k <= 1) return f;
  const W = Math.ceil(f.w / k), H = Math.ceil(f.h / k), data = new Uint8Array(W * H * f.levels * 4);
  for (let L = 0; L < f.levels; L++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const acc = [0, 0, 0, 0];
    let n = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const sx = Math.min(f.w - 1, x * k + dx), sy = Math.min(f.h - 1, y * k + dy), o = ((L * f.h + sy) * f.w + sx) * 4;
      for (let c = 0; c < 4; c++) acc[c] += f.data[o + c];
      n++;
    }
    const o = ((L * H + y) * W + x) * 4;
    for (let c = 0; c < 4; c++) data[o + c] = Math.round(acc[c] / n);
  }
  return {...f, w: W, h: H, data, cell: (f.cell ?? CELL) * k};
}

/** The field as uploaded: downsampled until its stacked rows fit MAX_DECAY_ROWS (identity for every station today). */
export function fitDecayField(f: DecayField, maxRows = MAX_DECAY_ROWS): DecayField {
  let k = 1;
  while (Math.ceil(f.h / k) * f.levels > maxRows && k < f.h) k++;
  return downsampleDecay(f, k);
}

let fieldTex: THREE.DataTexture | null = null;
let currentField: DecayField | null = null;
/** The decay field bound to the shared inputs (QA / tests). */
export const activeDecayField = (): DecayField | null => currentField;
/** Upload a station's decay field to the shared decay inputs (disposes the previous station's texture). */
export function setDecayField(field: DecayField): THREE.DataTexture {
  const f = fitDecayField(field);
  currentField = f;
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
  DECAY_UNIFORMS.uDecayGrid.value.set(f.w, f.h, f.levels, f.cell ?? CELL);
  if (DECAY_UNIFORMS.uDecayTex.value !== detailTex || !detailTex) DECAY_UNIFORMS.uDecayTex.value = decayDetailTexture();
  return t;
}

/** Builder entry: age a station's architecture (field + hooks). Returns the field (stats / tests). */
export function applyStationDecay(layout: StationLayout, levels: readonly Level[], mats: WorldMaterials): DecayField {
  decayWorldMaterials(mats);
  const f = buildDecayField(layout, levels);
  setDecayField(f);
  return f;
}

// ---------------------------------------------------------------------------------------------
// QA: the decay inputs as the GPU sees them (Iteration 13, MAT-A)

export interface DecayProbe {
  /** World point on a surface and its outward normal (the shader reads the open cell at p + 0.2 n). */
  p: readonly [number, number, number]; n: readonly [number, number, number];
}
export interface DecayProbeValue {
  /** GPU: decay field texel (traffic, open, wet, neglect) and level band (slot, floor, ceiling). */
  gpu: {field: [number, number, number, number]; band: [number, number, number]};
  /** CPU: sampleDecay of the bound field at the same point, on the GPU-picked level slot. */
  cpu: {traffic: number; open: number; wet: number; neglect: number} | null;
}
interface ProbeRenderer {
  getRenderTarget(): unknown; setRenderTarget(t: unknown): void;
  readRenderTargetPixelsAsync(rt: unknown, x: number, y: number, w: number, h: number): Promise<ArrayLike<number>>;
}

/**
 * Render the decay inputs of `pts` (the same TSL as the materials: decayFieldAt + the decay field texture) into float
 * targets and read them back, next to the CPU field sample. Browser QA proof that the station field, its level rows and
 * the light-field band reach the surface shaders on the running backend.
 */
export async function probeDecayGPU(renderer: ProbeRenderer, pts: readonly DecayProbe[]): Promise<DecayProbeValue[]> {
  const N = pts.length;
  const P = new Float32Array(N * 4);
  pts.forEach((q, i) => P.set([q.p[0] + q.n[0] * 0.2, q.p[1] + q.n[1] * 0.2, q.p[2] + q.n[2] * 0.2, 1], i * 4));
  const posT = new THREE.DataTexture(P, N, 1, THREE.RGBAFormat, THREE.FloatType);
  posT.minFilter = posT.magFilter = THREE.NearestFilter;
  posT.generateMipmaps = false;
  posT.needsUpdate = true;
  const row = uniform(0);
  const mat = new NodeMaterial();
  mat.name = 'decay-probe';
  mat.depthTest = mat.depthWrite = false;
  mat.blending = THREE.NoBlending;
  mat.fragmentNode = Fn(() => {
    const i = int(floor((screenCoordinate as unknown as Node<'vec2'>).x));
    const dp = (textureLoad(posT, ivec2(i, 0)) as unknown as Node<'vec4'>).xyz;
    const {band, uv} = decayFieldAt(dp);
    const D = DECAY_UNIFORMS.uDecayMap.sample(uv) as unknown as Node<'vec4'>;
    return mix(D, vec4(band, 1), (row as unknown as Node<'float'>));
  })();
  const quad = new QuadMesh(mat);
  const rts = [0, 1].map(() => new RenderTarget(N, 1, {type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, samples: 0}));
  const prev = renderer.getRenderTarget();
  try {
    rts.forEach((rt, k) => { row.value = k; renderer.setRenderTarget(rt); quad.render(renderer as never); });
    renderer.setRenderTarget(prev);
    const [d, b] = await Promise.all(rts.map(rt => renderer.readRenderTargetPixelsAsync(rt, 0, 0, N, 1)));
    const f = currentField;
    return pts.map((_, i) => {
      const field = [0, 1, 2, 3].map(c => +Number(d[i * 4 + c]).toFixed(4)) as [number, number, number, number];
      const band = [0, 1, 2].map(c => +Number(b[i * 4 + c]).toFixed(3)) as [number, number, number];
      const cpu = f ? sampleDecay(f, Math.min(f.levels - 1, Math.round(band[0])), P[i * 4], P[i * 4 + 2]) : null;
      return {gpu: {field, band}, cpu};
    });
  } finally {
    renderer.setRenderTarget(prev);
    for (const rt of rts) rt.dispose();
    posT.dispose();
    mat.dispose();
  }
}
