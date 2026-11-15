// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane TESTS): light fields baked from HAND-MADE gather rows.
// FieldSource.indirect is the seam the enhanced bake reads its gathered light through (world/lightField.ts): a test that returns its
// own rows there knows every value the encoder was given, so the ambient cube's layout, its encoding and what the samplers make of
// it can be checked exactly — without the ray gather (world/lightFieldGather.ts has its own tests: light-gather.test.ts).
//  - bakeRows: a bake of `src` whose gathered light is the rows `make` returns (index = the plain enumeration of the open voxels);
//  - patternRows: deterministic, strongly coloured rows, a different value per voxel, face and channel (a mixed-up slice shows);
//  - voxelTerms: the test's own statement of what the encoder stores for one voxel, from the bake's direct-light arrays and the rows.
import {FLOOR, Grid, SOLID} from '../../src/gen/grid';
import {
  FIELD_EMAX, GI_FACES, IND_CIRCUITS, IND_STRIDE, bakeLightField,
  type BakedField, type FieldParams, type FieldSource,
} from '../../src/world/lightField';
import {
  GATHER_GAIN, GATHER_REACH, GATHER_SATURATION, cubeMean, gatherIndirectSteps, indirectIndex, rowBits, rowValue, type IndirectContext, type IndirectLight,
} from '../../src/world/lightFieldGather';
import type {GiTier} from '../../src/world/enhancedLighting';
import {surfaceAlbedo} from '../../src/world/surfaceAlbedo';
import {drainSync, type BuildSteps} from '../../src/core/pacedBuild';

export type V3 = [number, number, number];
export const lum3 = (v: readonly number[]): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

/** w x h grid, solid border, everything else FLOOR with ceiling `ceil`. */
export function boxGrid(w: number, h: number, ceil = 4.4): Grid {
  const g = new Grid(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { g.set(x, y, FLOOR); g.ceil[y * w + x] = ceil; g.area[y * w + x] = 0; }
  return g;
}
export const fixtureAt = (x: number, z: number, o: Partial<FieldSource['lights'][number]> = {}): FieldSource['lights'][number] =>
  ({x, y: 4.35, z, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false, ...o});

/**
 * One room with something of everything: a pier and a partition (closed cells inside it), a lower ceiling over one end, and — with
 * `lights` — a white, a warm and a flickering fixture (so the direct light has a colour, a direction and a circuit of its own).
 */
export function cubeRoom(lights = true): FieldSource {
  const g = boxGrid(26, 18);
  for (let y = 6; y < 9; y++) for (let x = 9; x < 11; x++) g.set(x, y, SOLID);
  for (let y = 1; y < 11; y++) g.set(18, y, SOLID);
  for (let y = 1; y < 17; y++) for (let x = 19; x < 25; x++) g.ceil[y * g.w + x] = 3.1;
  return {
    grid: g, trenchFloorY: -1.15,
    lights: lights ? [fixtureAt(3.2, 3.4, {tint: [1, 1, 1]}), fixtureAt(7.1, 6.3, {warm: true}), fixtureAt(10.6, 5.2, {flicker: true, y: 3.05})] : [],
  };
}

export interface RowBake {
  field: BakedField;
  /** The bake's own direct-light arrays and geometry (what FieldSource.indirect was handed). */
  ctx: IndirectContext;
  index: Int32Array[];
  count: number;
  rows: Float32Array;
}
export type RowMaker = (count: number, ctx: IndirectContext, index: Int32Array[]) => Float32Array;

/** A bake of `src` whose gathered light is `make`'s rows (IND_STRIDE floats per open voxel, in index order). */
export function bakeRows(src: FieldSource, make: RowMaker, opt: {cube?: boolean; params?: FieldParams} = {}): RowBake {
  const out: Partial<RowBake> = {};
  out.field = bakeLightField({
    ...src,
    ...(opt.cube === undefined ? {} : {cube: opt.cube}),
    indirect: function* (ctx): BuildSteps<IndirectLight> {
      const {index, count} = indirectIndex(ctx.geos, ctx.layers, ctx.W * ctx.H);
      const rows = make(count, ctx, index);
      if (rows.length !== count * IND_STRIDE) throw new Error(`rows: ${rows.length} floats for ${count} voxels`);
      out.ctx = ctx; out.index = index; out.count = count; out.rows = rows;
      return {index, data: rows, stats: {voxels: count, probes: 0, rays: 0, hits: 0, bounces: 0, ms: 0, traceMs: 0, mean: 0}};
    },
  }, opt.params);
  return out as RowBake;
}

/** A fixed pseudo-random sequence in [0, 1) (the tests' own: nothing in the game uses it). */
export function sequence(seed: number): () => number {
  let s = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Deterministic rows: per voxel, face and channel its own value in 0 .. `top` (most of them small, as gathered light is), already
 * the 16-bit values a gather returns (rowValue(rowBits(v))); the three circuit channels are shares of the cube's mean luminance.
 */
export function patternRows(top = 1.5, seed = 7): RowMaker {
  return count => {
    const d = new Float32Array(count * IND_STRIDE), rnd = sequence(seed), m: V3 = [0, 0, 0];
    for (let v = 0; v < count; v++) {
      const o = v * IND_STRIDE;
      for (let q = 0; q < IND_CIRCUITS; q++) { const u = rnd(); d[o + q] = rowValue(rowBits(u * u * top)); }
      const ml = lum3(cubeMean(d, o, m));
      d[o + IND_CIRCUITS] = rowValue(rowBits(ml * rnd() * 0.5)); d[o + IND_CIRCUITS + 1] = rowValue(rowBits(ml * rnd() * 0.3)); d[o + IND_CIRCUITS + 2] = rowValue(rowBits(ml * rnd() * 0.2));
    }
    return d;
  };
}

/**
 * The REAL gather as rows (world/lightFieldGather.ts, as the game runs it: `tier`, the game's own gain and saturation by name, the
 * neutral finish colours): for tests that need a real station's light AND the exact values the encoder was given.
 */
export const gatheredRows = (src: FieldSource, tier: GiTier): RowMaker => (_count, ctx) => {
  const levels = src.levels ?? [{id: 0, role: 'main' as const, grid: src.grid, baseY: 0}];
  const albedo = surfaceAlbedo(ctx.W, ctx.H, levels, ctx.geos, null);
  return drainSync(gatherIndirectSteps(ctx, {rays: tier.rays, bounces: tier.bounces, stride: tier.stride, reach: GATHER_REACH, gain: GATHER_GAIN, saturation: GATHER_SATURATION, albedo})).data;
};

/** The same row in every voxel. */
export const uniformRows = (row: readonly number[]): RowMaker => count => {
  const d = new Float32Array(count * IND_STRIDE);
  for (let v = 0; v < count; v++) for (let q = 0; q < IND_STRIDE; q++) d[v * IND_STRIDE + q] = row[q] ?? 0;
  return d;
};

export interface VoxelTerms {
  /** Direct light: tinted fluence, its luminance, the luminance of its directional part. */
  E: V3; el: number; dl: number;
  /** Share of the direct light that reaches a surface at all (directional + scattered), and its directional share. */
  coh: number; sh: number;
  /** The main texel: what it holds of the gathered light for this layer, the texel's colour and its one directional share. */
  base: V3; T: V3; rho: number;
  /** The row's six faces. */
  face: V3[];
  /**
   * Per face: the complete ambient of a surface of that orientation — what the direct light scatters (the share of it that has no
   * direction) + the gathered face. What the cube stores (before its ceiling and its 8-bit steps) and what full shading shows.
   */
  ambient: V3[];
}

/**
 * What the enhanced encoder is given, and stores, for the voxel (slot, cell i, layer k) — the documented rule, written out a second
 * time (world/lightField.ts encodeRowEnhanced): the main texel holds the direct light + the gathered light's share for the layer
 * (bottom: the up-facing face, top: the down-facing face, between: the mean of the four wall faces; one layer: the mean of the six)
 * with ONE directional share; each cube face stores the complete ambient of its orientation, per channel:
 * E x (coh - dl / el) + the face. null in a closed cell.
 */
export function voxelTerms(b: RowBake, slot: number, i: number, k: number): VoxelTerms | null {
  const L = b.ctx.layers[slot], row = b.index[slot][i * L + k];
  if (row < 0) return null;
  const q = row * IND_STRIDE, d = b.rows, v = i * L + k, v3 = v * 3;
  const E: V3 = [b.ctx.E[slot][v3], b.ctx.E[slot][v3 + 1], b.ctx.E[slot][v3 + 2]], el = b.ctx.EL[slot][v];
  const D = b.ctx.D[slot], dmag = Math.sqrt(D[v3] * D[v3] + D[v3 + 1] * D[v3 + 1] + D[v3 + 2] * D[v3 + 2]), dl = Math.min(el, dmag);
  // (the encoder keeps the share and the layer's base in 32-bit floats)
  const coh = Math.fround(el > 0 ? (dl + (el - dl) * b.ctx.scatter) / el : 0), sh = el > 0 ? dl / el : 0;
  const face: V3[] = [];
  for (let f = 0; f < GI_FACES; f++) face.push([d[q + f * 3], d[q + f * 3 + 1], d[q + f * 3 + 2]]);
  const base: V3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    base[c] = Math.fround(L < 2 ? (face[0][c] + face[1][c] + face[2][c] + face[3][c] + face[4][c] + face[5][c]) / 6
      : k === 0 ? face[0][c] : k === L - 1 ? face[1][c] : (face[2][c] + face[3][c] + face[4][c] + face[5][c]) / 4);
  }
  const bl = Math.fround(lum3(base));
  const T: V3 = [E[0] * coh + base[0], E[1] * coh + base[1], E[2] * coh + base[2]], tl = el * coh + bl, rho = tl > 0 ? dl / tl : 0;
  const sc = el > 0 ? coh - sh : 0;
  const ambient = face.map((fc): V3 => [fc[0] + E[0] * sc, fc[1] + E[1] * sc, fc[2] + E[2] * sc]);
  return {E, el, dl, coh, sh, base, T, rho, face, ambient};
}

/** The cube's byte for an ambient value (the encoding's rule, written out: the main texels' own — square-root spaced from 0 = none up to FIELD_EMAX). */
export function cubeByte(v: number): number {
  return Math.round(Math.sqrt(Math.min(1, Math.max(0, v / FIELD_EMAX))) * 255);
}
/** The largest rounding error of a value stored as cubeByte(v) (below the ceiling): half the distance to the neighbouring byte's value. */
export function cubeHalfStep(v: number): number {
  return (Math.sqrt(FIELD_EMAX * Math.max(0, v)) + FIELD_EMAX * 0.25 / 255) / 255 + 1e-9;
}
