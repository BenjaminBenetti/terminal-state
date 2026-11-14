// Task studio-baked-lighting-reflections-20261114-050258-01 (lane PROBES): the CPU bake of the cached reflection probes
// (world/reflectionProbes.ts) against its data contract — the atlas layout and the octahedral map with its gutter wrap, where the
// probes sit and what the weight / id grid holds, what a probe's sharp level shows (a surface's finish colour under the baked field,
// the fixtures as tubes, an open ceiling as the light arriving there), the blurred levels (energy kept), NORM and the parallax box.
// Everything here is Node / CPU: no renderer, no browser.
import {describe, expect, it} from 'vitest';
import {DataUtils} from 'three';
import {CELL, FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import type {Level} from '../src/gen/levels';
import type {LightPlacement} from '../src/gen/station';
import {drainSync} from '../src/core/pacedBuild';
import {LEVELS} from '../src/levels/registry';
import {stationLevels} from '../src/world/levelGeometry';
import {
  FIELD_EMAX, TINT, bakeLightField, fixtureTint, levelGeometries, slotBase, slotLayers,
  type BakedField, type ColumnGeometry, type ExtraDirectContext, type FieldSource,
} from '../src/world/lightField';
import {BandScene, HIT_CEIL, HIT_FLOOR, HIT_WALL, sphereDirections} from '../src/world/lightScene';
import {ALBEDO_LUT, ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, surfaceAlbedo, type SurfaceAlbedo} from '../src/world/surfaceAlbedo';
import {REFLECTION_TIERS, type ReflectionTier} from '../src/world/enhancedLighting';
import {
  PROBE_COLS, PROBE_FIXTURE_RADIANCE, PROBE_GUTTER, PROBE_LEVELS, PROBE_NORM_MIN, PROBE_RADIANCE_MAX, PROBE_REACH,
  bakeReflectionProbesSteps, octDecode, octEncode, octTexelDirections, octTexelSolidAngles, octWrapTexel, probeAtlasLayout,
  probeBlockCells, probeBytes, probeHalf, probeTileOrigin,
  type BakedProbes, type ProbeBakeInput,
} from '../src/world/reflectionProbes';

type V3 = [number, number, number];
const lum = (v: readonly number[]): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: readonly number[], b: readonly number[]): number => Math.acos(Math.min(1, Math.max(-1, dot(a, b) / Math.hypot(a[0], a[1], a[2]) / Math.hypot(b[0], b[1], b[2]))));
const DEG = Math.PI / 180;
const HALF_ONE = 0x3c00;
const bytes = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

// ---------------------------------------------------------------------------------------------
// Hand-built stations

/** w x h grid, solid border, everything else FLOOR (area 0) with ceiling `ceil`. */
function box(w: number, h: number, ceil = 4.4): Grid {
  const g = new Grid(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { g.set(x, y, FLOOR); g.ceil[y * w + x] = ceil; g.area[y * w + x] = 0; }
  return g;
}
const light = (x: number, z: number, y = 4.35, over: Partial<LightPlacement> = {}): LightPlacement => ({x, y, z, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false, ...over});

interface Rig { grid: Grid; field: BakedField; geos: ColumnGeometry[]; levels: Level[]; albedo: SurfaceAlbedo; lights: LightPlacement[] }
function rig(grid: Grid, lights: LightPlacement[] = [], extraDirect?: FieldSource['extraDirect']): Rig {
  const src: FieldSource = {grid, lights, trenchFloorY: -1.15, extraDirect};
  const levels: Level[] = [{id: 0, role: 'main', grid, baseY: 0}];
  const geos = levelGeometries(src);
  return {grid, field: bakeLightField(src), geos, levels, albedo: surfaceAlbedo(grid.w, grid.h, levels, geos, null), lights};
}
const input = (r: Rig, over: Partial<ProbeBakeInput> = {}): ProbeBakeInput => ({field: r.field, geos: r.geos, levels: r.levels, albedo: r.albedo, lights: r.lights, ...over});
const bake = (r: Rig, tier: ReflectionTier, over: Partial<ProbeBakeInput> = {}): BakedProbes => drainSync(bakeReflectionProbesSteps(input(r, over), tier));
/** A tier for hand-built rooms: the standard tile, any spacing (4 m = the smallest block: 8 cells, ramp 2). */
const tierOf = (spacing: number, maxProbes = 192, tile = REFLECTION_TIERS.standard.tile): ReflectionTier => ({id: 'standard', tile, maxProbes, spacing});

// ---------------------------------------------------------------------------------------------
// Reading a bake

/** rgb of texel (i, j) of probe p's level l (i or j = -1 or the tile edge: its gutter). */
function rgbAt(b: BakedProbes, p: number, l: number, i: number, j: number): V3 {
  const [ox, oy] = probeTileOrigin(b.layout, p, l), o = ((oy + j) * b.layout.width + ox + i) * 4;
  return [DataUtils.fromHalfFloat(b.atlas[o]), DataUtils.fromHalfFloat(b.atlas[o + 1]), DataUtils.fromHalfFloat(b.atlas[o + 2])];
}
const metaAt = (b: BakedProbes, p: number, row: number): number[] => Array.from(b.meta.subarray((row * b.count + p) * 4, (row * b.count + p) * 4 + 4));
const gridAt = (b: BakedProbes, slice: number, cx: number, cz: number, c: number): number => b.grid[((slice * b.gridH + cz) * b.gridW + cx) * 4 + c];
/** The four weight bytes / ids of a cell of slot s. */
const weightsAt = (b: BakedProbes, s: number, cx: number, cz: number): number[] => [0, 1, 2, 3].map(c => gridAt(b, 2 * s, cx, cz, c));
const idsAt = (b: BakedProbes, s: number, cx: number, cz: number): number[] => [0, 1, 2, 3].map(c => gridAt(b, 2 * s + 1, cx, cz, c));

/**
 * What a ray from `o` along `d` shows, read straight from the field's bytes and the albedo (the test's own reading of the contract):
 * the hit surface's finish colour x the irradiance its voxel gives its normal / pi; an open ceiling: the light arriving from above.
 */
function shown(r: Rig, scene: BandScene, o: readonly number[], d: readonly number[]): {rgb: V3; kind: number; cell: number; up: number; down: number} | null {
  if (!scene.trace(o[0], o[1], o[2], d[0], d[1], d[2], PROBE_REACH)) return null;
  const s = scene.slot[scene.hitBand], cell = scene.hitCol, L = slotLayers(s), n = r.field.w * r.field.h, kind = scene.hitKind;
  const A = r.albedo.slots[s];
  let k = 0, nrm: V3 = [0, 1, 0], off = ALB_FLOOR;
  if (kind === HIT_CEIL) { k = L - 1; nrm = [0, -1, 0]; off = ALB_CEIL; }
  else if (kind === HIT_WALL) {
    const ly = r.geos[s].layerY;
    for (let q = 1; q < L; q++) if (Math.abs(ly[cell * L + q] - scene.hitY) < Math.abs(ly[cell * L + k] - scene.hitY)) k = q;
    nrm = [scene.hitNx, 0, scene.hitNz]; off = ALB_WALL;
  }
  let alb: V3 = [ALBEDO_LUT[A[cell * ALBEDO_STRIDE + off]], ALBEDO_LUT[A[cell * ALBEDO_STRIDE + off + 1]], ALBEDO_LUT[A[cell * ALBEDO_STRIDE + off + 2]]];
  if (kind === HIT_CEIL && A[cell * ALBEDO_STRIDE + off] + A[cell * ALBEDO_STRIDE + off + 1] + A[cell * ALBEDO_STRIDE + off + 2] === 0) { nrm = [0, 1, 0]; alb = [1, 1, 1]; }
  const oa = ((slotBase(s) + 1 + 2 * k) * n + cell) * 4, ob = ((slotBase(s) + 2 + 2 * k) * n + cell) * 4, f = r.field.data;
  const T = [0, 1, 2].map(c => (f[oa + c] / 255) ** 2 * FIELD_EMAX), rho = f[oa + 3] / 255;
  let dir = [0, 1, 2].map(c => f[ob + c] / 255 * 2 - 1);
  const dl = Math.hypot(dir[0], dir[1], dir[2]);
  dir = dl < 1e-4 ? [0, 1, 0] : dir.map(v => v / dl);
  const E = (nn: readonly number[]): number => (1 - rho) + rho * Math.max(0, dot(nn, dir));
  const e = E(nrm);
  return {rgb: [alb[0] * T[0] * e / Math.PI, alb[1] * T[1] * e / Math.PI, alb[2] * T[2] * e / Math.PI], kind, cell, up: lum(T) * E([0, 1, 0]), down: lum(T) * E([0, -1, 0])};
}
/** Half-float rounding (11 bits) and the bake's float32 working precision. */
const near = (act: number, exp: number): boolean => Math.abs(act - exp) <= Math.abs(exp) * 6e-4 + 1e-7;

/**
 * Exact solid angle of every texel of a t-px octahedral tile (the test's own: each texel as two spherical triangles, cut along the
 * diagonal that follows the octahedron's edge in its quadrant, so each triangle lies on one face and its sides are great circles).
 */
const exactOmega = new Map<number, Float64Array>();
function texelSolidAngles(t: number): Float64Array {
  const hit = exactOmega.get(t);
  if (hit) return hit;
  const tri = (a: V3, b: V3, c: V3): number => {
    const det = Math.abs(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]));
    return 2 * Math.atan2(det, 1 + dot(a, b) + dot(b, c) + dot(c, a));
  };
  const out = new Float64Array(t * t);
  for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) {
    const c00 = octDecode(i / t, j / t), c10 = octDecode((i + 1) / t, j / t), c01 = octDecode(i / t, (j + 1) / t), c11 = octDecode((i + 1) / t, (j + 1) / t);
    const sameSign = (i + 0.5 - t / 2) * (j + 0.5 - t / 2) > 0;
    out[j * t + i] = sameSign ? tri(c00, c10, c01) + tri(c11, c10, c01) : tri(c00, c10, c11) + tri(c00, c01, c11);
  }
  exactOmega.set(t, out);
  return out;
}
/** Solid-angle-weighted mean (rgb) and the largest luminance of probe p's level l. */
function levelStats(b: BakedProbes, p: number, l: number): {mean: V3; max: number; min: number} {
  const t = b.layout.levelTile[l], om = texelSolidAngles(t), mean: V3 = [0, 0, 0];
  let max = 0, min = Infinity;
  for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) {
    const v = rgbAt(b, p, l, i, j), w = om[j * t + i] / (4 * Math.PI);
    mean[0] += v[0] * w; mean[1] += v[1] * w; mean[2] += v[2] * w;
    max = Math.max(max, lum(v)); min = Math.min(min, lum(v));
  }
  return {mean, max, min};
}

/** Where a bake's probes are, read back from its grid and meta, with every placement / grid rule of the contract checked. */
function checkGrid(b: BakedProbes, geos: readonly ColumnGeometry[]): {slot: number; bx: number; bz: number; cx: number; cz: number; colour: number}[] {
  const W = b.gridW, H = b.gridH, n = W * H, block = b.block, grow = b.ramp + 1;
  expect(b.gridDepth).toBe(2 * b.slots);
  expect(b.grid.length).toBe(n * b.gridDepth * 4);
  expect(b.ramp).toBe(block / 2 - 2);
  expect(block % 2).toBe(0);
  expect(block).toBeGreaterThanOrEqual(8);
  // every id: one slot, one channel, exactly its expanded block
  const seen = new Map<number, {slot: number; c: number; x0: number; x1: number; z0: number; z1: number; cells: number}>();
  for (let s = 0; s < b.slots; s++) for (let c = 0; c < 4; c++) for (let i = 0; i < n; i++) {
    const id = b.grid[((2 * s + 1) * n + i) * 4 + c];
    if (!id) continue;
    const cx = i % W, cz = (i - cx) / W, e = seen.get(id);
    if (!e) { seen.set(id, {slot: s, c, x0: cx, x1: cx, z0: cz, z1: cz, cells: 1}); continue; }
    if (e.slot !== s || e.c !== c) throw new Error(`id ${id} in two slots / channels`);
    e.x0 = Math.min(e.x0, cx); e.x1 = Math.max(e.x1, cx); e.z0 = Math.min(e.z0, cz); e.z1 = Math.max(e.z1, cz); e.cells++;
  }
  expect(seen.size).toBe(b.count);
  const probes: {slot: number; bx: number; bz: number; cx: number; cz: number; colour: number}[] = [];
  for (let p = 0; p < b.count; p++) {
    const e = seen.get(p + 1), [x, y, z] = metaAt(b, p, 0);
    if (!e) throw new Error(`probe ${p} has no id region`);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), i = cz * W + cx, g = geos[e.slot];
    expect(x).toBeCloseTo((cx + 0.5) * CELL, 6);
    expect(z).toBeCloseTo((cz + 0.5) * CELL, 6);
    expect(g.open[i], `probe ${p} stands in an open cell of slot ${e.slot}`).toBeGreaterThan(0);
    expect(y).toBeCloseTo(g.floorH[i] + Math.min(1.5, 0.5 * (g.ceilH[i] - g.floorH[i])), 5);
    const bx = Math.floor(cx / block), bz = Math.floor(cz / block), colour = (bx & 1) + 2 * (bz & 1);
    expect(e.c).toBe(colour);
    expect([e.x0, e.x1, e.z0, e.z1]).toEqual([Math.max(0, bx * block - grow), Math.min(W, (bx + 1) * block + grow) - 1, Math.max(0, bz * block - grow), Math.min(H, (bz + 1) * block + grow) - 1]);
    expect(e.cells).toBe((e.x1 - e.x0 + 1) * (e.z1 - e.z0 + 1));
    // the block has at least 4 open cells of the slot, and the probe's own cell carries its weight
    let open = 0;
    for (let zz = bz * block; zz < Math.min(H, (bz + 1) * block); zz++) for (let xx = bx * block; xx < Math.min(W, (bx + 1) * block); xx++) if (g.open[zz * W + xx]) open++;
    expect(open).toBeGreaterThanOrEqual(4);
    expect(gridAt(b, 2 * e.slot, cx, cz, colour)).toBeGreaterThan(0);
    probes.push({slot: e.slot, bx, bz, cx, cz, colour});
  }
  // index order: slot, then bz, then bx
  for (let p = 1; p < probes.length; p++) {
    const a = probes[p - 1], q = probes[p];
    expect(a.slot < q.slot || (a.slot === q.slot && (a.bz < q.bz || (a.bz === q.bz && a.bx < q.bx))), `probe ${p} follows probe ${p - 1}`).toBe(true);
  }
  // weights: only in open cells, only under an id; two probes of one colour never weigh on adjacent cells
  let orphans = 0, clash = 0, stray = 0;
  for (let s = 0; s < b.slots; s++) {
    const wo = 2 * s * n * 4, io = (2 * s + 1) * n * 4, open = geos[s].open;
    for (let i = 0; i < n; i++) {
      const cx = i % W;
      let any = 0;
      for (let c = 0; c < 4; c++) {
        const w = b.grid[wo + i * 4 + c];
        if (!w) continue;
        any = 1;
        const id = b.grid[io + i * 4 + c];
        if (!open[i] || !id) stray++;
        for (const j of [i + 1, i + W - 1, i + W, i + W + 1]) {
          if (j >= n || Math.abs((j % W) - cx) > 1) continue;
          if (b.grid[wo + j * 4 + c] && b.grid[io + j * 4 + c] !== id) clash++;
        }
      }
      if (open[i] && !any) orphans++;
    }
  }
  expect(stray).toBe(0);
  expect(clash).toBe(0);
  expect(b.stats.orphanCells).toBe(orphans);
  return probes;
}

// ---------------------------------------------------------------------------------------------
describe('probe atlas layout and the octahedral map', () => {
  it('lays the tiles out in bands per level, none overlapping, gutters included', () => {
    const L = probeAtlasLayout(32, 20);
    expect([L.cols, L.rows, L.width, L.height]).toEqual([PROBE_COLS, 2, 16 * 34, 2 * (34 + 18 + 10 + 6)]);
    expect(L.levelTile).toEqual([32, 16, 8, 4]);
    expect(L.levelY).toEqual([0, 68, 104, 124]);
    expect(probeTileOrigin(L, 0, 0)).toEqual([1, 1]);
    expect(probeTileOrigin(L, 17, 1)).toEqual([18 + 1, 68 + 18 + 1]);
    expect(probeAtlasLayout(64, 0).rows).toBe(1);
    expect(probeAtlasLayout(64, 240).height).toBe(15 * (66 + 34 + 18 + 10));
    // every texel of the atlas belongs to at most one (probe, level) tile, gutters counted
    const S = probeAtlasLayout(8, 37), owner = new Int32Array(S.width * S.height).fill(-1);
    for (let p = 0; p < 37; p++) for (let l = 0; l < PROBE_LEVELS; l++) {
      const [ox, oy] = probeTileOrigin(S, p, l), t = S.levelTile[l];
      for (let j = -PROBE_GUTTER; j < t + PROBE_GUTTER; j++) for (let i = -PROBE_GUTTER; i < t + PROBE_GUTTER; i++) {
        const x = ox + i, y = oy + j;
        expect(x >= 0 && y >= 0 && x < S.width && y < S.height).toBe(true);
        expect(owner[y * S.width + x]).toBe(-1);
        owner[y * S.width + x] = p * PROBE_LEVELS + l;
      }
    }
  });

  it('octEncode / octDecode are inverse, unit and put the poles where the contract says', () => {
    for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) {
      const u = (i + 0.37) / 40, v = (j + 0.61) / 40, d = octDecode(u, v);
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 12);
      const e = octEncode(d[0], d[1], d[2]);
      expect(e[0]).toBeCloseTo(u, 10);
      expect(e[1]).toBeCloseTo(v, 10);
    }
    const dirs = sphereDirections(300);
    for (let q = 0; q < 300; q++) {
      const d: V3 = [dirs[q * 3], dirs[q * 3 + 1], dirs[q * 3 + 2]], e = octEncode(d[0], d[1], d[2]), back = octDecode(e[0], e[1]);
      expect(e[0] >= 0 && e[0] <= 1 && e[1] >= 0 && e[1] <= 1).toBe(true);
      expect(angle(d, back)).toBeLessThan(1e-6);
    }
    expect(octEncode(0, 1, 0)).toEqual([0.5, 0.5]); // straight up: the middle
    expect(angle(octDecode(0.5, 0.5), [0, 1, 0])).toBe(0);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expect(octDecode(u, v)[1]).toBeCloseTo(-1, 12); // the corners: straight down
    expect(octDecode(0.75, 0.75)[1]).toBeCloseTo(0, 12); // the inner diamond's edge: the horizon
    expect(octDecode(0.6, 0.55)[1]).toBeGreaterThan(0);
    expect(octDecode(0.95, 0.9)[1]).toBeLessThan(0);
    // the scratch tuple is filled and returned (no allocation in the bake's loops)
    const out: [number, number] = [0, 0];
    expect(octEncode(0.3, -0.5, 0.2, out)).toBe(out);
  });

  it('the gutter wrap continues the map across every edge and corner', () => {
    for (const t of [4, 8, 16, 32, 64]) {
      const dirs = octTexelDirections(t), texel = Math.sqrt(4 * Math.PI) / t;
      const centre = (i: number, j: number): V3 => [dirs[(j * t + i) * 3], dirs[(j * t + i) * 3 + 1], dirs[(j * t + i) * 3 + 2]];
      for (let j = -1; j <= t; j++) for (let i = -1; i <= t; i++) {
        const outX = i < 0 || i >= t, outZ = j < 0 || j >= t, [wi, wj] = octWrapTexel(i, j, t);
        if (!outX && !outZ) { expect([wi, wj]).toEqual([i, j]); continue; }
        expect(wi >= 0 && wi < t && wj >= 0 && wj < t).toBe(true);
        // the contract's table
        if (outX && outZ) expect([wi, wj]).toEqual([i < 0 ? t - 1 : 0, j < 0 ? t - 1 : 0]);
        else if (outX) expect([wi, wj]).toEqual([i < 0 ? 0 : t - 1, t - 1 - j]);
        else expect([wi, wj]).toEqual([t - 1 - i, j < 0 ? 0 : t - 1]);
        // the map folds along an edge: the gutter texel is the interior texel next to it, mirrored in the plane the edge lies in
        // (an i edge: z = 0; a j edge: x = 0; a corner: both — the pole straight down)
        const e = centre(Math.min(t - 1, Math.max(0, i)), Math.min(t - 1, Math.max(0, j)));
        const across: V3 = [outZ ? -e[0] : e[0], e[1], outX ? -e[2] : e[2]];
        expect(angle(across, centre(wi, wj))).toBeLessThan(1e-7);
        // ... so a direction just across the edge encodes into the wrapped texel
        const uv = octEncode(across[0], across[1], across[2]);
        expect([Math.floor(uv[0] * t), Math.floor(uv[1] * t)]).toEqual([wi, wj]);
        // and the map carried on past the edge (the gutter texel's own centre, decoded) points nearly where the wrapped texel does
        expect(angle(octDecode((i + 0.5) / t, (j + 0.5) / t), centre(wi, wj))).toBeLessThan(0.75 * texel);
      }
    }
    const out: [number, number] = [0, 0];
    expect(octWrapTexel(-1, 3, 8, out)).toBe(out);
    expect(out).toEqual([0, 4]);
  });

  it('texel solid angles sum to the sphere, match the exact ones and halve consistently; half floats round to nearest', () => {
    for (const t of [2, 4, 8, 16, 32, 64]) {
      const mine = texelSolidAngles(t), om = octTexelSolidAngles(t);
      let a = 0, b = 0;
      for (let q = 0; q < t * t; q++) { a += mine[q]; b += om[q]; expect(om[q] / mine[q]).toBeGreaterThan(0.998); expect(om[q] / mine[q]).toBeLessThan(1.002); }
      expect(a).toBeCloseTo(4 * Math.PI, 9);
      expect(b).toBeCloseTo(4 * Math.PI, 9);
      if (t < 64) {
        const up = octTexelSolidAngles(2 * t);
        for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) expect(up[2 * j * 2 * t + 2 * i] + up[2 * j * 2 * t + 2 * i + 1] + up[(2 * j + 1) * 2 * t + 2 * i] + up[(2 * j + 1) * 2 * t + 2 * i + 1]).toBeCloseTo(om[j * t + i], 12);
      }
    }
    expect(probeHalf(1)).toBe(HALF_ONE);
    expect(probeHalf(0)).toBe(0);
    expect(probeHalf(-3)).toBe(0);
    expect(probeHalf(NaN)).toBe(0);
    expect(DataUtils.fromHalfFloat(probeHalf(1e9))).toBe(PROBE_RADIANCE_MAX);
    expect(DataUtils.fromHalfFloat(probeHalf(Infinity))).toBe(PROBE_RADIANCE_MAX);
    let v = 1.1e-8; // (from under half the smallest half float: 0, up past the clamp)
    for (let q = 0; q < 440; q++, v *= 1.071) {
      const x = Math.min(v, PROBE_RADIANCE_MAX), h = probeHalf(x), back = DataUtils.fromHalfFloat(h);
      expect(Number.isFinite(back)).toBe(true);
      // nearest: never further than half a step of the half-float grid (2^-11 relative; 2^-25 in the subnormals)
      expect(Math.abs(back - x)).toBeLessThanOrEqual(Math.max(x * 2 ** -11, 2 ** -25) * 1.0000001);
      for (const other of [h - 1, h + 1]) if (other >= 0) expect(Math.abs(DataUtils.fromHalfFloat(other) - x)).toBeGreaterThanOrEqual(Math.abs(back - x));
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('probe placement and the weight / id grid', () => {
  it('one probe per block with open cells, in the block\'s largest space, nearest its centroid', () => {
    // 18 x 10 cells, blocks of 8: (0,0) 49 open cells in two areas, (1,0) 56, (2,0) 7, (0,1) 7, (1,1) 8, (2,1) ONE cell: no probe
    const g = box(18, 10);
    for (let z = 1; z <= 7; z++) for (let x = 1; x <= 7; x++) g.area[z * 18 + x] = x <= 3 ? 3 : 9; // area 3: 21 cells, area 9: 28
    for (let z = 1; z <= 7; z++) for (let x = 8; x <= 15; x++) g.area[z * 18 + x] = (x + z) & 1 ? 5 : 2; // a tie (28 each): the lower id
    for (let x = 8; x <= 15; x++) g.ceil[8 * 18 + x] = 2.4; // a low strip: its probe sits at half height
    const r = rig(g), b = bake(r, tierOf(4));
    expect(probeBlockCells(4)).toBe(8);
    expect([b.count, b.block, b.ramp]).toEqual([5, 8, 2]);
    const probes = checkGrid(b, r.geos);
    expect(probes.map(p => [p.bx, p.bz])).toEqual([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]]);
    // area 9 spans x 4..7, z 1..7: centroid (5.5, 4), the nearest cells (5, 4) and (6, 4) tie: the lower index
    expect([probes[0].cx, probes[0].cz]).toEqual([5, 4]);
    expect(metaAt(b, 0, 0).slice(0, 3)).toEqual([2.75, 1.5, 2.25]);
    // block (1, 0): areas 2 and 5 tie at 28 cells, area 2 (the cells with x + z even) wins; its centroid (11.57, 4) -> its cell (12, 4)
    expect(g.area[probes[1].cz * 18 + probes[1].cx]).toBe(2);
    expect([probes[1].cx, probes[1].cz]).toEqual([12, 4]);
    expect([probes[2].cx, probes[2].cz]).toEqual([16, 4]);
    expect([probes[3].cx, probes[3].cz]).toEqual([4, 8]);
    expect([probes[4].cx, probes[4].cz]).toEqual([11, 8]);
    expect(metaAt(b, 4, 0)[1]).toBeCloseTo(1.2, 6); // the 2.4 m strip
    expect(probes.map(p => p.colour)).toEqual([0, 1, 0, 2, 3]);
    // the lone cell of block (2, 1): under the expanded blocks of three colours (its own block, colour 2, holds no probe) ...
    expect(idsAt(b, 0, 16, 8)).toEqual([3, 2, 0, 5]);
    expect(weightsAt(b, 0, 16, 8)[0]).toBe(Math.round(0.625 * 0.375 * 255)); // ... and weighed on by block (2, 0)'s probe next to it
    expect(b.stats.orphanCells).toBe(0);
  });

  it('the block grows by two cells until the station fits the tier\'s probe count', () => {
    const r = rig(box(66, 66));
    const fine = bake(r, tierOf(4));
    expect([fine.count, fine.block, fine.ramp]).toEqual([80, 8, 2]); // 9 x 9 blocks; the corner one holds a single open cell
    const coarse = bake(r, tierOf(4, 30));
    expect([coarse.count, coarse.block, coarse.ramp]).toEqual([25, 14, 5]); // 80 -> 49 (10) -> 36 (12) -> 25 (14)
    checkGrid(coarse, r.geos);
    expect(coarse.layout).toEqual(probeAtlasLayout(coarse.layout.tile, 25));
    expect(probeBlockCells(9)).toBe(18);
    expect(probeBlockCells(7)).toBe(14);
    expect(probeBlockCells(1)).toBe(8);
    // fewer probes than level slots can ever need: still one bake, never more than the tier allows
    const one = bake(r, tierOf(4, 1));
    expect(one.count).toBe(1);
    expect(one.block).toBe(66);
  });

  it('weights are a tensor of trapezoids: 1 in the core, 0 `ramp` cells into the neighbours, and the four colours sum to 1', () => {
    const r = rig(box(66, 66)), b = bake(r, tierOf(4));
    const probes = checkGrid(b, r.geos);
    expect(b.stats.orphanCells).toBe(0);
    for (let cz = 10; cz <= 54; cz++) for (let cx = 10; cx <= 54; cx++) {
      const sum = weightsAt(b, 0, cx, cz).reduce((a, v) => a + v, 0);
      if (Math.abs(sum - 255) > 2) throw new Error(`weights at ${cx},${cz} sum to ${sum}`);
    }
    // block (2, 2) = cells 16..23, colour 0, its probe at the centroid cell
    const p = probes.findIndex(q => q.bx === 2 && q.bz === 2);
    expect([probes[p].cx, probes[p].cz, probes[p].colour]).toEqual([19, 19, 0]);
    // along x through the core row: outside by 2.5 / 1.5 / 0.5 cells, inside by 0.5 / 1.5 / 2.5
    expect([13, 14, 15, 16, 17, 18, 19].map(cx => gridAt(b, 0, cx, 19, 0))).toEqual([0, 32, 96, 159, 223, 255, 255]);
    expect(gridAt(b, 0, 15, 15, 0)).toBe(Math.round(0.375 * 0.375 * 255)); // a corner: the product of the two ramps
    // ids: the whole expanded block (3 cells out), then a 2-cell gap to the next block of the colour
    expect([10, 11, 12, 13, 26, 27, 28, 29].map(cx => gridAt(b, 1, cx, 19, 0))).toEqual([p - 1, 0, 0, p + 1, p + 1, 0, 0, p + 3]);
  });

  it('a probe weighs only on cells it can walk to inside its expanded block: not behind a wall, not down a platform edge', () => {
    // two rooms split by a wall at x = 12; the only door at z = 20
    const g = box(34, 26);
    for (let z = 0; z < 26; z++) { g.set(12, z, SOLID); for (let x = 13; x < 33; x++) if (g.get(x, z) === FLOOR) g.area[z * 34 + x] = 1; }
    g.set(12, 20, FLOOR); g.ceil[20 * 34 + 12] = 4.4; g.area[20 * 34 + 12] = 1;
    const r = rig(g), b = bake(r, tierOf(4)), probes = checkGrid(b, r.geos);
    // block (1, 0) (x 8..15, z 0..7): 28 cells of room A against 21 of room B: its probe stands in A, the wall has no door near it
    const a = probes.findIndex(q => q.bx === 1 && q.bz === 0);
    expect([probes[a].cx, probes[a].cz, probes[a].colour]).toEqual([9, 4, 1]);
    for (let z = 1; z <= 7; z++) for (let x = 13; x <= 15; x++) {
      expect(gridAt(b, 1, x, z, 1)).toBe(a + 1); // the id is there (the block's whole expanded rect) ...
      expect(gridAt(b, 0, x, z, 1)).toBe(0); // ... the weight is not: room B never reflects room A's probe
    }
    expect(gridAt(b, 0, 11, 4, 1)).toBe(255); // room A's side of the wall: full weight
    expect(weightsAt(b, 0, 14, 4)).toEqual([32, 0, 0, 0]); // room B gets block (2, 0)'s probe (its own room), as far as its ramp reaches
    expect(weightsAt(b, 0, 13, 4)).toEqual([0, 0, 0, 0]); // past that ramp: no probe (the surface shades without reflections)
    expect(b.stats.orphanCells).toBeGreaterThan(0);
    // block (1, 2) (z 16..23) has the door inside its expanded block: its probe (room A again) reaches room B through it
    const d = probes.findIndex(q => q.bx === 1 && q.bz === 2);
    expect(g.area[probes[d].cz * 34 + probes[d].cx]).toBe(0);
    expect(gridAt(b, 0, 13, 20, 1)).toBe(255);
    expect(gridAt(b, 0, 14, 17, 1)).toBeGreaterThan(0);

    // a platform edge: the bed (x >= 13, 1.15 m down) is another space for the platform's probe, and the other way round
    const e = box(18, 10);
    for (let z = 1; z <= 8; z++) for (let x = 13; x <= 16; x++) { e.set(x, z, VOID); e.area[z * 18 + x] = -1; }
    const re = rig(e), be = bake(re, tierOf(4)), pe = checkGrid(be, re.geos);
    const plat = pe.findIndex(q => q.bx === 1 && q.bz === 0), bed = pe.findIndex(q => q.bx === 2 && q.bz === 0);
    expect([pe[plat].cx, pe[plat].cz, pe[bed].cx, pe[bed].cz]).toEqual([10, 4, 16, 4]);
    expect(metaAt(be, bed, 0)[1]).toBeCloseTo(-1.15 + 1.5, 5);
    expect([12, 13, 14, 15].map(x => gridAt(be, 0, x, 4, 1))).toEqual([255, 0, 0, 0]); // the platform probe stops at the edge
    expect([12, 13, 14, 15].map(x => gridAt(be, 0, x, 4, 0))).toEqual([0, 0, 32, 96]); // the bed probe: its ramp, bed cells only
  });
});

// ---------------------------------------------------------------------------------------------
describe('what a probe shows', () => {
  // A closed 9 x 9 m room, one probe (a 10 m block covers the grid), one tube.
  const TIER = tierOf(10), T = TIER.tile;
  const room = (lights: LightPlacement[], ceil = 4.4): Rig => rig(box(20, 20, ceil), lights);
  const LAMP = light(6.75, 3.25);
  const lit = room([LAMP]);
  const base = bake(lit, TIER);
  const POS: V3 = [4.75, 1.5, 4.75];
  /** The tube colour StationLighting draws (world/lights.ts applyLevels) x PROBE_FIXTURE_RADIANCE. */
  const tubeRadiance = (l: LightPlacement, level: number): V3 => {
    const t = fixtureTint(l), mx = Math.max(t[0], t[1], t[2]), s = l.tint ? 0.65 : 0.35, k = 0.12 + 0.88 * l.power * level;
    return [0, 1, 2].map(c => PROBE_FIXTURE_RADIANCE * k * (1 - s + s * t[c] / mx)) as V3;
  };
  /** Level 0 of probe 0 against the test's own reading of every texel; returns what is left over (the fixtures), per texel. */
  function compare(r: Rig, b: BakedProbes, pos: V3 = POS): {glow: V3[]; kinds: number[]; cells: number[]; shownLum: number[]; ups: number[]; downs: number[]} {
    const scene = new BandScene(r.field.w, r.field.h, r.geos), glow: V3[] = [], kinds: number[] = [], cells: number[] = [], shownLum: number[] = [], ups: number[] = [], downs: number[] = [];
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const d = octDecode((i + 0.5) / T, (j + 0.5) / T), e = shown(r, scene, pos, d), act = rgbAt(b, 0, 0, i, j);
      const exp: V3 = e ? e.rgb : [0, 0, 0];
      kinds.push(e ? e.kind : -1); cells.push(e ? e.cell : -1); shownLum.push(lum(exp)); ups.push(e ? e.up : 0); downs.push(e ? e.down : 0);
      // never darker than the surface; a texel is either the surface exactly or has fixture light on top
      const g: V3 = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        if (near(act[c], exp[c])) continue;
        if (act[c] < exp[c]) throw new Error(`texel ${i},${j} channel ${c}: ${act[c]} is below the surface's ${exp[c]}`);
        g[c] = act[c] - exp[c];
      }
      glow.push(g);
    }
    return {glow, kinds, cells, shownLum, ups, downs};
  }
  const tubeDir = (l: LightPlacement, pos: V3 = POS): V3 => [l.x - pos[0], l.y - 0.08 - pos[1], l.z - pos[2]];
  /** Solid angle (sr) of a tube from the probe: 1 m long, 0.12 m wide seen from below, 0.07 m from the side. */
  const tubeSr = (l: LightPlacement, pos: V3 = POS): number => {
    const d = tubeDir(l, pos), dist = Math.hypot(d[0], d[1], d[2]), ay = Math.abs(d[1]) / dist;
    return (0.12 * ay + 0.07 * (1 - ay)) / (dist * dist);
  };
  /** The tube's light in a comparison's leftovers: radiance x solid angle, summed over the texels (their real sizes), per channel. */
  const glowEnergy = (glow: V3[]): V3 => {
    const om = texelSolidAngles(T), e: V3 = [0, 0, 0];
    glow.forEach((g, q) => { e[0] += g[0] * om[q]; e[1] += g[1] * om[q]; e[2] += g[2] * om[q]; });
    return e;
  };

  it('one probe in the middle of the room, with NORM from its own voxel and the room as its parallax box', () => {
    expect([base.count, base.block, base.ramp]).toEqual([1, 20, 8]);
    expect(base.tier).toBe('standard');
    checkGrid(base, lit.geos);
    const [x, y, z, norm] = metaAt(base, 0, 0);
    expect([x, y, z]).toEqual(POS);
    // NORM: the luminance of the field voxel the probe is in (cell 9, 9; the layer nearest 1.5 m: layers at 0.05, 1.47, 2.90, 4.32)
    const f = lit.field, o = ((slotBase(0) + 1 + 2 * 1) * f.w * f.h + 9 * 20 + 9) * 4;
    const own = lum([0, 1, 2].map(c => (f.data[o + c] / 255) ** 2 * FIELD_EMAX));
    expect(own).toBeGreaterThan(PROBE_NORM_MIN);
    expect(norm).toBeCloseTo(own, 5);
    // the box: the walls 0.5 m in from the grid's edge, floor to ceiling
    const lo = metaAt(base, 0, 1), hi = metaAt(base, 0, 2);
    [0.5, 0, 0.5].forEach((v, c) => expect(lo[c]).toBeCloseTo(v, 3));
    [9.5, 4.4, 9.5].forEach((v, c) => expect(hi[c]).toBeCloseTo(v, 3));
    // a dark room: NORM is the floor value, never 0 (the shader divides by it)
    const dark = bake(room([]), TIER);
    expect(metaAt(dark, 0, 0)[3]).toBe(Math.fround(PROBE_NORM_MIN));
    expect(dark.atlas.some((v, q) => q % 4 !== 3 && v !== 0)).toBe(false); // no light anywhere: every texel black
    expect(dark.stats.fixtures).toBe(0);
  });

  it('level 0: every texel is the hit surface\'s finish colour under the field\'s light there, plus the tube', () => {
    const {glow, kinds, shownLum} = compare(lit, base);
    // (the room is closed: every ray hits; floors, walls and the ceiling are all in view)
    expect(kinds.filter(k => k === HIT_FLOOR).length).toBeGreaterThan(100);
    expect(kinds.filter(k => k === HIT_WALL).length).toBeGreaterThan(300);
    expect(kinds.filter(k => k === HIT_CEIL).length).toBeGreaterThan(50);
    expect(kinds.includes(-1)).toBe(false);
    // the lit floor is really lit (the comparison above is not 0 = 0)
    const floorLum = shownLum.filter((_, q) => kinds[q] === HIT_FLOOR);
    expect(Math.max(...floorLum)).toBeGreaterThan(0.02);
    // the tube: a handful of texels round its direction, the one it points at among them, each well above the surface behind it
    const dir = tubeDir(LAMP), L = tubeRadiance(LAMP, 1);
    expect(L[0]).toBeCloseTo(10 * (0.65 + 0.35 * TINT.cool[0] / TINT.cool[1]), 9);
    const uv = octEncode(dir[0], dir[1], dir[2]), at = Math.floor(uv[1] * T) * T + Math.floor(uv[0] * T);
    const lit0 = glow.map((g, q) => (lum(g) > 0 ? q : -1)).filter(q => q >= 0);
    expect(lit0.length).toBeGreaterThanOrEqual(4);
    expect(lit0.length).toBeLessThanOrEqual(24);
    expect(lit0).toContain(at);
    for (const q of lit0) {
      const d = octDecode((q % T + 0.5) / T, (Math.floor(q / T) + 0.5) / T);
      expect(angle(d, dir)).toBeLessThan(20 * DEG);
      for (let c = 0; c < 3; c++) expect(glow[q][c]).toBeLessThanOrEqual(L[c] * 1.001);
    }
    expect(lum(glow[at])).toBeGreaterThan(10 * shownLum[at]); // far brighter than the ceiling it hangs from
    expect(lum(rgbAt(base, 0, 0, at % T, Math.floor(at / T)))).toBeGreaterThan(5 * Math.max(...floorLum));
    // its energy: radiance x solid angle, wherever on the map (big texels or small) it falls
    const sr = tubeSr(LAMP), energy = glowEnergy(glow);
    expect(sr / texelSolidAngles(T)[at]).toBeGreaterThan(0.2); // (a good part of a texel, but no texel is full: nothing is clamped)
    expect(sr / texelSolidAngles(T)[at]).toBeLessThan(1);
    for (let c = 0; c < 3; c++) expect(energy[c] / (L[c] * sr)).toBeCloseTo(1, 2);
    expect(base.stats.fixtures).toBe(1);
    expect(base.stats.rays).toBe(T * T + 1 + 6); // the capture, one visibility ray, the six box rays
  });

  it('fixtures: only working tubes in sight are drawn, in the colour and at the level the station draws them', () => {
    const sum = (r: Rig, l: LightPlacement[]): {b: BakedProbes; total: V3} => {
      const b = bake(r, TIER, {lights: l});
      return {b, total: glowEnergy(compare(r, b).glow)};
    };
    const steady = sum(lit, [LAMP]);
    for (const off of [{broken: true}, {virtual: true}, {power: 0.005}] as Partial<LightPlacement>[]) {
      const s = sum(lit, [{...LAMP, ...off}]);
      expect(s.b.stats.fixtures).toBe(0);
      expect(lum(s.total)).toBe(0);
    }
    const ratio = (s: {total: V3}, l: LightPlacement, level: number): void => {
      const L = tubeRadiance(l, level), L0 = tubeRadiance(LAMP, 1);
      for (let c = 0; c < 3; c++) expect(s.total[c] / steady.total[c]).toBeCloseTo(L[c] / L0[c], 2);
    };
    // the dying circuit glows at a tenth; a flicker circuit is captured at its steady 0.92; the index picks the circuit, not the colour
    const dying = {...LAMP, dying: true}, flicker = {...LAMP, flicker: true};
    ratio(sum(lit, [dying]), dying, 0.1);
    ratio(sum(lit, [flicker]), flicker, 0.92);
    expect(tubeRadiance(dying, 0.1)[1]).toBeCloseTo(10 * (0.12 + 0.088), 9);
    // colours: a warm tube, an aged one (low power), an explicit tint (two thirds of the colour shows)
    const warm = {...LAMP, warm: true}, aged = {...LAMP, power: 0.6}, tinted = {...LAMP, tint: [1.2, 0.4, 0.4] as const};
    ratio(sum(lit, [warm]), warm, 1);
    ratio(sum(lit, [aged]), aged, 1);
    ratio(sum(lit, [tinted]), tinted, 1);
    expect(tubeRadiance(tinted, 1)[1] / tubeRadiance(tinted, 1)[0]).toBeCloseTo(0.35 + 0.65 / 3, 9);
    // two tubes add up, each with its own solid angle; in the other order they are the same picture (they do not overlap)
    const second = light(2.25, 6.25, 4.35, {rot: 0.7});
    const both = sum(lit, [LAMP, second]);
    expect(both.b.stats.fixtures).toBe(2);
    expect(both.total[1] / steady.total[1]).toBeCloseTo(1 + tubeSr(second) / tubeSr(LAMP), 2);
    expect(bytes(bake(lit, TIER, {lights: [second, LAMP]}).atlas).equals(bytes(both.b.atlas))).toBe(true);
    // a tube right over the probe covers whole texels: they show its radiance, never more
    const low = room([light(4.85, 4.85, 1.55)], 1.6), bl = bake(low, TIER), pos = metaAt(bl, 0, 0).slice(0, 3) as V3;
    expect(pos.map(v => +v.toFixed(5))).toEqual([4.75, 0.8, 4.75]);
    const {glow} = compare(low, bl, pos), L = tubeRadiance(low.lights[0], 1), full = glow.filter(g => g[1] > L[1] * 0.999).length;
    for (let c = 0; c < 3; c++) expect(Math.max(...glow.map(g => g[c]))).toBeLessThanOrEqual(L[c] * 1.0006);
    // 0.7 m away the tube is 10 degrees wide and 70 long: a solid line of full texels, not five dots — and less light than its
    // solid angle x radiance, the rest being what the clamp cut
    expect(full).toBeGreaterThanOrEqual(12);
    expect(glowEnergy(glow)[1]).toBeLessThan(0.9 * L[1] * tubeSr(low.lights[0], pos));
    expect(glowEnergy(glow)[1]).toBeGreaterThan(0.2 * L[1] * tubeSr(low.lights[0], pos));
    // behind a wall: the probe of the other room does not see it
    const g2 = box(34, 18);
    for (let z = 0; z < 18; z++) { g2.set(16, z, SOLID); for (let x = 17; x < 33; x++) if (g2.get(x, z) === FLOOR) g2.area[z * 34 + x] = 1; }
    const two = rig(g2, [light(6.5, 4.5)]), b2 = bake(two, tierOf(8.5));
    expect([b2.count, b2.block]).toEqual([2, 18]);
    expect(b2.stats.fixtures).toBe(1);
    const dark = levelStats(b2, 1, 0), bright = levelStats(b2, 0, 0);
    expect(dark.max).toBe(0); // the sealed room: no light, no tube
    expect(bright.max).toBeGreaterThan(0.5);
  });

  it('levels 1..3 are blurrier, keep the energy, and every tile carries its gutter', () => {
    const s = [0, 1, 2, 3].map(l => levelStats(base, 0, l));
    for (let l = 1; l < PROBE_LEVELS; l++) {
      for (let c = 0; c < 3; c++) expect(s[l].mean[c] / s[0].mean[c], `level ${l} channel ${c} mean`).toBeCloseTo(1, 2);
      expect(s[l].max).toBeLessThan(s[l - 1].max * 0.9); // the tube's peak spreads out
      expect(s[l].max).toBeGreaterThan(s[l].min);
      expect(s[l].max - s[l].min).toBeLessThan(s[l - 1].max - s[l - 1].min);
    }
    expect(s[0].max / s[0].mean[1]).toBeGreaterThan(20);
    expect(s[3].max / s[3].mean[1]).toBeLessThan(4);
    // level 3 still knows where the light is: brighter toward the tube than away from it
    const t3 = base.layout.levelTile[3], dir = tubeDir(LAMP);
    const toward = octEncode(dir[0], dir[1], dir[2]), away = octEncode(-dir[0], -dir[1], -dir[2]);
    expect(lum(rgbAt(base, 0, 3, Math.floor(toward[0] * t3), Math.floor(toward[1] * t3)))).toBeGreaterThan(1.5 * lum(rgbAt(base, 0, 3, Math.floor(away[0] * t3), Math.floor(away[1] * t3))));
    // gutters: the wrapped texel, bit for bit; alpha 1 over the whole tile; nothing outside the tiles in use
    const used = new Uint8Array(base.layout.width * base.layout.height);
    for (let l = 0; l < PROBE_LEVELS; l++) {
      const t = base.layout.levelTile[l], [ox, oy] = probeTileOrigin(base.layout, 0, l), W = base.layout.width;
      for (let j = -1; j <= t; j++) for (let i = -1; i <= t; i++) {
        const o = ((oy + j) * W + ox + i) * 4, [wi, wj] = octWrapTexel(i, j, t), w = ((oy + wj) * W + ox + wi) * 4;
        used[(oy + j) * W + ox + i] = 1;
        expect([base.atlas[o], base.atlas[o + 1], base.atlas[o + 2], base.atlas[o + 3]]).toEqual([base.atlas[w], base.atlas[w + 1], base.atlas[w + 2], HALF_ONE]);
      }
    }
    for (let q = 0; q < used.length; q++) if (!used[q] && (base.atlas[q * 4] | base.atlas[q * 4 + 1] | base.atlas[q * 4 + 2] | base.atlas[q * 4 + 3])) throw new Error(`atlas texel ${q} outside the tiles in use is not 0`);
    expect(base.atlas.length).toBe(base.layout.width * base.layout.height * 4);
    expect(base.stats.bytes).toBe(probeBytes(base));
    expect(base.stats.bytes).toBe(base.atlas.byteLength + base.meta.byteLength + base.grid.byteLength);
    expect(base.meta.length).toBe(12);
  });

  it('a red-walled room reflects red on its walls only', () => {
    const red = room([LAMP]), A = red.albedo.slots[0];
    for (let i = 0; i < 400; i++) { A[i * ALBEDO_STRIDE + ALB_WALL] = 230; A[i * ALBEDO_STRIDE + ALB_WALL + 1] = 30; A[i * ALBEDO_STRIDE + ALB_WALL + 2] = 30; }
    const b = bake(red, TIER), {glow, kinds} = compare(red, b);
    let walls = 0, floors = 0;
    for (let q = 0; q < T * T; q++) {
      if (lum(glow[q]) > 0) continue; // (the tube's texels)
      const v = rgbAt(b, 0, 0, q % T, Math.floor(q / T));
      if (lum(v) < 1e-3) continue;
      if (kinds[q] === HIT_WALL) { walls++; expect(v[0]).toBeGreaterThan(20 * v[1]); expect(v[0]).toBeGreaterThan(20 * v[2]); }
      else if (kinds[q] === HIT_FLOOR) { floors++; expect(v[0]).toBeLessThan(1.5 * v[1]); }
    }
    expect(walls).toBeGreaterThan(200);
    expect(floors).toBeGreaterThan(100);
    // the same room with its neutral walls: the walls differ, the floor and ceiling texels are the same bytes
    for (let q = 0; q < T * T; q++) {
      const same = rgbAt(b, 0, 0, q % T, Math.floor(q / T)).every((v, c) => v === rgbAt(base, 0, 0, q % T, Math.floor(q / T))[c]);
      if (kinds[q] !== HIT_WALL && lum(glow[q]) === 0) expect(same).toBe(true);
    }
  });

  it('an open ceiling shows the light that falls through it, and is black where none does', () => {
    // a 4 x 4 cell patch of daylight from straight above in the top layer of an otherwise unlit room (FieldSource.extraDirect)
    const patch = (cx: number, cz: number): boolean => cx >= 12 && cx < 16 && cz >= 4 && cz < 8;
    const sky = (ctx: ExtraDirectContext): void => {
      const L = ctx.layers[0];
      for (let cz = 4; cz < 8; cz++) for (let cx = 12; cx < 16; cx++) {
        const v = (cz * ctx.W + cx) * L + L - 1;
        ctx.E[0][v * 3] += 3; ctx.E[0][v * 3 + 1] += 3; ctx.E[0][v * 3 + 2] += 3; ctx.D[0][v * 3 + 1] += 3; ctx.EL[0][v] += 3;
      }
    };
    const open = rig(box(20, 20), [], sky), A = open.albedo.slots[0];
    for (let i = 0; i < 400; i++) { A[i * ALBEDO_STRIDE + ALB_CEIL] = 0; A[i * ALBEDO_STRIDE + ALB_CEIL + 1] = 0; A[i * ALBEDO_STRIDE + ALB_CEIL + 2] = 0; }
    const b = bake(open, TIER), {glow, kinds, cells, ups, downs} = compare(open, b); // (compare: every texel as the contract says)
    expect(glow.every(g => lum(g) === 0)).toBe(true);
    let inPatch = 0, outside = 0, brightest = 0, discriminating = 0;
    for (let q = 0; q < T * T; q++) {
      if (kinds[q] !== HIT_CEIL) continue;
      const v = lum(rgbAt(b, 0, 0, q % T, Math.floor(q / T))), cx = cells[q] % 20, cz = Math.floor(cells[q] / 20);
      if (patch(cx, cz)) { inPatch++; expect(v).toBeGreaterThan(0.5); brightest = Math.max(brightest, v); expect(v).toBeCloseTo(ups[q] / Math.PI, 3); if (ups[q] > 2 * downs[q]) discriminating++; }
      else if (Math.abs(cx - 13.5) > 4 || Math.abs(cz - 5.5) > 4) { outside++; expect(v).toBeLessThan(0.1); }
    }
    expect(inPatch).toBeGreaterThan(3);
    expect(discriminating).toBe(inPatch); // (the light comes from above: a ceiling facing down would show far less)
    expect(outside).toBeGreaterThan(30);
    expect(brightest).toBeGreaterThan(0.8);
    // the same field under a REAL ceiling: the patch is a surface lit from behind — nearly dark
    const closed = rig(box(20, 20), [], sky), bc = bake(closed, TIER), cc = compare(closed, bc);
    for (let q = 0; q < T * T; q++) if (cc.kinds[q] === HIT_CEIL && patch(cc.cells[q] % 20, Math.floor(cc.cells[q] / 20))) expect(lum(rgbAt(bc, 0, 0, q % T, Math.floor(q / T)))).toBeLessThan(0.1 * brightest);
  });

  it('nothing movable is in a probe: a prop cell (sightBlocked / blocked) does not change the bake', () => {
    const g = box(20, 20);
    for (const [x, z] of [[9, 9], [10, 9], [14, 6], [3, 3], [1, 12], [18, 18]]) { g.sightBlocked[z * 20 + x] = 1; g.blocked[z * 20 + x] = 1; }
    const src: FieldSource = {grid: g, lights: [LAMP], trenchFloorY: -1.15}, geos = levelGeometries(src), levels: Level[] = [{id: 0, role: 'main', grid: g, baseY: 0}];
    expect(geos[0].open[9 * 20 + 9]).toBe(2); // (the field's geometry does mark the prop cell ...)
    expect(lit.geos[0].open[9 * 20 + 9]).toBe(1);
    // ... and the probes of the SAME field are the same bytes with it: the probe even stands in that cell
    const b = drainSync(bakeReflectionProbesSteps({field: lit.field, geos, levels, albedo: surfaceAlbedo(20, 20, levels, geos, null), lights: [LAMP]}, TIER));
    expect(bytes(b.atlas).equals(bytes(base.atlas))).toBe(true);
    expect(bytes(b.meta).equals(bytes(base.meta))).toBe(true);
    expect(bytes(b.grid).equals(bytes(base.grid))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the bake as build steps', () => {
  const same = (a: BakedProbes, b: BakedProbes): void => {
    expect(bytes(a.atlas).equals(bytes(b.atlas))).toBe(true);
    expect(bytes(a.meta).equals(bytes(b.meta))).toBe(true);
    expect(bytes(a.grid).equals(bytes(b.grid))).toBe(true);
    expect({...a, atlas: 0, meta: 0, grid: 0, stats: {...a.stats, ms: 0}}).toEqual({...b, atlas: 0, meta: 0, grid: 0, stats: {...b.stats, ms: 0}});
  };
  const g = box(40, 30);
  for (let z = 0; z < 30; z++) if (z < 12 || z > 15) g.set(22, z, SOLID);
  const r = rig(g, [light(5, 5), light(15, 9, 4.35, {flicker: true}), light(16, 4, 4.35, {warm: true, rot: 1.1})]);
  const TIER = tierOf(5, 192, 64); // 10-cell blocks, the high tier's tile (several capture steps a probe)

  it('is deterministic, and the same whatever the slicing', () => {
    const a = bake(r, TIER), b = bake(r, TIER);
    expect(a.count).toBe(12);
    same(a, b);
    // a manual loop: the stage labels in order, and a pause at least once per probe while capturing and while filtering
    const steps = bakeReflectionProbesSteps(input(r), TIER), labels: string[] = [], plain: Record<string, number> = {};
    let it = steps.next(), stage = '';
    while (!it.done) {
      if (typeof it.value === 'string') { stage = it.value; labels.push(stage); } else plain[stage] = (plain[stage] ?? 0) + 1;
      it = steps.next();
    }
    expect(labels).toEqual(['probes.place', 'probes.grid', 'probes.capture', 'probes.filter']);
    expect(plain['probes.capture']).toBeGreaterThanOrEqual(a.count * 3); // 4096 rays a probe: a pause every ~1500
    expect(plain['probes.filter']).toBeGreaterThanOrEqual(a.count);
    same(it.value as BakedProbes, a);
    // two bakes of different stations advanced in turn (nothing of one leaks into the other between steps)
    const other = rig(box(24, 24, 3), [light(4, 8, 2.95)]), want = bake(other, tierOf(4, 192, 64));
    const s1 = bakeReflectionProbesSteps(input(r), TIER), s2 = bakeReflectionProbesSteps(input(other), tierOf(4, 192, 64));
    let r1 = s1.next(), r2 = s2.next();
    while (!r1.done || !r2.done) { if (!r1.done) r1 = s1.next(); if (!r2.done) r2 = s2.next(); }
    same(r1.value as BakedProbes, a);
    same(r2.value as BakedProbes, want);
    // the caller's own ray scene gives the same bake
    same(bake(r, TIER, {scene: new BandScene(g.w, g.h, r.geos)}), a);
  });

  it('a station with no open cell bakes to an empty, valid set; a wrong tile or a downsampled field is refused', () => {
    const solid = rig(new Grid(16, 16)), b = bake(solid, tierOf(4));
    expect(b.count).toBe(0);
    expect(b.layout).toEqual(probeAtlasLayout(REFLECTION_TIERS.standard.tile, 1));
    expect(b.atlas.length).toBe(b.layout.width * b.layout.height * 4);
    expect(b.atlas.some(v => v !== 0)).toBe(false);
    expect(b.meta.length).toBe(12);
    expect([b.gridW, b.gridH, b.gridDepth, b.slots]).toEqual([16, 16, 2, 1]);
    expect(b.grid.length).toBe(16 * 16 * 2 * 4);
    expect(b.grid.some(v => v !== 0)).toBe(false);
    expect(b.stats).toMatchObject({rays: 0, fixtures: 0, orphanCells: 0, bytes: probeBytes(b)});
    expect(() => bake(r, tierOf(4, 192, 24))).toThrow(/tile 24/);
    expect(() => bake(r, tierOf(4), {field: {...r.field, cellScale: 2}})).toThrow(/full-resolution/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('a generated station', () => {
  it('bakes both tiers within their probe counts and budgets, with nearly every open cell under a probe', () => {
    const layout = LEVELS.subway.generate('main', {levelSeed: 11, startWeapon: 'pistol'} as never);
    const levels = stationLevels(layout);
    const src: FieldSource = {grid: layout.grid, lights: layout.lights, trenchFloorY: layout.trench.floorY, levels};
    const field = bakeLightField(src), geos = levelGeometries(src), albedo = surfaceAlbedo(field.w, field.h, levels, geos, null);
    let open = 0;
    for (const q of geos) for (let i = 0; i < q.open.length; i++) if (q.open[i]) open++;
    expect(geos.length).toBeGreaterThan(1);
    for (const id of ['standard', 'high'] as const) {
      const tier = REFLECTION_TIERS[id];
      const b = drainSync(bakeReflectionProbesSteps({field, geos, levels, albedo, lights: layout.lights}, tier));
      const again = drainSync(bakeReflectionProbesSteps({field, geos, levels, albedo, lights: layout.lights}, tier));
      console.log(`reflection probes, Subway seed 11 (${field.w}x${field.h} cells, ${geos.length} slots, ${open} open cells, ${layout.lights.length} lights), ${id} tier: ` +
        `${b.stats.ms.toFixed(0)} ms cold / ${again.stats.ms.toFixed(0)} ms warm, ${b.count} probes (max ${tier.maxProbes}), block ${b.block} cells (asked ${probeBlockCells(tier.spacing)}), ramp ${b.ramp}, ` +
        `${b.stats.rays} rays, ${b.stats.fixtures} fixture views, atlas ${b.layout.width}x${b.layout.height} = ${(b.atlas.byteLength / 1e6).toFixed(2)} MB, grid ${(b.grid.byteLength / 1e6).toFixed(2)} MB, ` +
        `total ${(b.stats.bytes / 1e6).toFixed(2)} MB, orphan cells ${b.stats.orphanCells} (${(b.stats.orphanCells / open * 100).toFixed(2)} % of open)`);
      expect(bytes(again.atlas).equals(bytes(b.atlas))).toBe(true);
      expect(bytes(again.grid).equals(bytes(b.grid))).toBe(true);
      expect(bytes(again.meta).equals(bytes(b.meta))).toBe(true);
      expect(b.count).toBeGreaterThan(40);
      expect(b.count).toBeLessThanOrEqual(tier.maxProbes);
      expect(b.block).toBeGreaterThanOrEqual(probeBlockCells(tier.spacing));
      expect(b.layout).toEqual(probeAtlasLayout(tier.tile, b.count));
      expect(b.meta.length).toBe(b.count * 12);
      expect(b.slots).toBe(geos.length);
      const probes = checkGrid(b, geos);
      expect(new Set(probes.map(p => p.slot)).size).toBe(geos.length); // every level has probes
      expect(b.stats.orphanCells / open).toBeLessThan(0.25);
      expect(b.stats.fixtures).toBeGreaterThan(b.count);
      expect(b.stats.rays).toBeGreaterThanOrEqual(b.count * (tier.tile * tier.tile + 6));
      // meta: NORM never under its floor, the box round its probe (at least 0.5 m, at most 30 m each way)
      let lit = 0;
      for (let p = 0; p < b.count; p++) {
        const [x, y, z, norm] = metaAt(b, p, 0), lo = metaAt(b, p, 1), hi = metaAt(b, p, 2), at = [x, y, z];
        expect(norm).toBeGreaterThanOrEqual(Math.fround(PROBE_NORM_MIN));
        expect(Number.isFinite(norm)).toBe(true);
        if (norm > 0.2) lit++;
        for (let c = 0; c < 3; c++) {
          expect(at[c] - lo[c]).toBeGreaterThanOrEqual(0.5 - 1e-4);
          expect(hi[c] - at[c]).toBeGreaterThanOrEqual(0.5 - 1e-4);
          expect(at[c] - lo[c]).toBeLessThanOrEqual(30 + 1e-4);
          expect(hi[c] - at[c]).toBeLessThanOrEqual(30 + 1e-4);
        }
      }
      expect(lit).toBeGreaterThan(b.count / 4);
      // the atlas: finite, never negative, alpha 1 exactly on the tiles in use; the levels keep each probe's energy
      let bad = 0, some = 0;
      for (let q = 0; q < b.atlas.length; q++) {
        const h = b.atlas[q];
        if ((h & 0x7c00) === 0x7c00 || h & 0x8000 || (q % 4 === 3 && h !== 0 && h !== HALF_ONE)) bad++;
        if (h && q % 4 !== 3) some++;
      }
      expect(bad).toBe(0);
      expect(some).toBeGreaterThan(b.count * tier.tile * tier.tile);
      for (const p of [0, Math.floor(b.count / 2), b.count - 1]) for (const l of [0, 3]) for (let j = 0; j < b.layout.levelTile[l]; j += 3) expect(rgbAt(b, p, l, j, j).every(v => Number.isFinite(v) && v >= 0 && v <= PROBE_RADIANCE_MAX)).toBe(true);
      let worst = 0;
      for (let p = 0; p < b.count; p += 7) {
        const m0 = levelStats(b, p, 0).mean;
        if (lum(m0) < 1e-3) continue;
        for (let l = 1; l < PROBE_LEVELS; l++) worst = Math.max(worst, Math.abs(lum(levelStats(b, p, l).mean) / lum(m0) - 1));
      }
      expect(worst).toBeLessThan(0.02);
    }
  });
});
