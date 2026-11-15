// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane TESTS): the AMBIENT CUBE of an enhanced light field (world/lightField.ts
// BakedField.gi) — its slices, its encoding and what the CPU sampler makes of it. The gathered light comes in through
// FieldSource.indirect; these tests hand the bake rows of their own (helpers/lightCubeFixture.ts), so every expected byte is known.
//  - LAYOUT: the cube follows the slots (and an extended field's header group slices): per slot, per face of CUBE_FACES, one slice
//    per height layer, giDepth(slots) slices in all — one slot, three levels (4 + 3 + 3 layers) and a nine-storey tower;
//  - WITHOUT IT: a bake without `indirect` has no cube whatever `cube` says; an enhanced bake with `cube: false` is the cube bake's
//    slots, byte for byte; withoutCube is a view of the same bytes, not a copy;
//  - ENCODING: a texel is a signed difference, 128 = none, square-root spaced to +-FIELD_DMAX, clamped there and counted
//    (stats.cubeClipped); cubeDifference undoes it within half a step;
//  - THE POINT OF IT: sampled with a normal at a voxel's centre, the ambient light is the direct light's scatter + the gathered face
//    of that orientation, channel by channel (within the 8-bit steps) — also on a surface turned away from a strong direct light,
//    where the main texel's ONE directional share would otherwise take the gathered light's colour with it; what is left of that
//    split sits in the directional part (its luminance is the direct light's, its colour the main texel's);
//  - never negative; without a normal, or without a cube, the sample is the plain one;
//  - downsampleField keeps the cube (averaged like the slots; the header slices before it are not touched by it).
import {describe, expect, it} from 'vitest';
import {CELL} from '../src/gen/grid';
import {
  AUX_LAYERS, CUBE_FACES, FIELD_DMAX, FIELD_EMAX, GI_FACES, LAYERS, bakeLightField, cubeDifference, downsampleField, fieldDepth, fieldSlot, giDepth, giSlotBase,
  sampleField, slotBase, slotLayers, withoutCube, type BakedField, type FieldSource,
} from '../src/world/lightField';
import {IND_STRIDE} from '../src/world/lightFieldGather';
import {FIX, levelFixture} from './helpers/levelRenderFixture';
import {towerFixture} from './helpers/towerFixture';
import {bakeRows, cubeByte, cubeHalfStep, cubeRoom, lum3, patternRows, sequence, uniformRows, voxelTerms, type RowBake, type V3} from './helpers/lightCubeFixture';

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const threeLevels = (lights = true): FieldSource => { const {layout, levels} = levelFixture({lights}); return {grid: layout.grid, lights: layout.lights, trenchFloorY: FIX.bedY, levels}; };
const tower = (): FieldSource => { const t = towerFixture({lights: false}); return {grid: t.layout.grid, lights: t.layout.lights, trenchFloorY: -1.15, levels: t.levels}; };
/** First byte of the cube texel (slot, face, layer, cell). */
const cubeAt = (f: BakedField, slot: number, face: number, k: number, i: number): number => ((f.gi! + giSlotBase(slot) + face * slotLayers(slot) + k) * f.w * f.h + i) * 4;

/**
 * Every cube texel of a bake against the test's own statement of the encoder (voxelTerms + cubeByte): how many open-voxel channels
 * were compared, how many differ, how many are past the clamp; closed cells must hold 128 in all four channels, open ones alpha 255.
 */
function checkCube(b: RowBake): {compared: number; wrong: number; clipped: number; closedWrong: number; alphaWrong: number; slices: number} {
  const f = b.field, n = f.w * f.h, seen = new Set<number>();
  let compared = 0, wrong = 0, clipped = 0, closedWrong = 0, alphaWrong = 0;
  for (let s = 0; s < f.slots; s++) {
    const L = slotLayers(s);
    for (let i = 0; i < n; i++) for (let k = 0; k < L; k++) {
      const t = voxelTerms(b, s, i, k);
      for (let face = 0; face < GI_FACES; face++) {
        const o = cubeAt(f, s, face, k, i);
        seen.add((o / 4 - i) / n);
        if (!t) { if (f.data[o] !== 128 || f.data[o + 1] !== 128 || f.data[o + 2] !== 128 || f.data[o + 3] !== 128) closedWrong++; continue; }
        if (f.data[o + 3] !== 255) alphaWrong++;
        for (let c = 0; c < 3; c++) {
          compared++;
          if (f.data[o + c] !== cubeByte(t.stored[face][c])) wrong++;
          if (Math.abs(t.stored[face][c]) > FIELD_DMAX) clipped++;
        }
      }
    }
  }
  return {compared, wrong, clipped, closedWrong, alphaWrong, slices: seen.size};
}

// ---------------------------------------------------------------------------------------------
describe('layout: the cube\'s slices follow the slots', () => {
  it('the slice arithmetic: six faces x a slot\'s layers, the main slot first', () => {
    expect([GI_FACES, CUBE_FACES.length]).toEqual([6, 6]);
    expect(giSlotBase(0)).toBe(0);
    expect(giDepth(1)).toBe(GI_FACES * LAYERS);
    for (let s = 1; s < 16; s++) {
      expect(giSlotBase(s)).toBe(giSlotBase(s - 1) + GI_FACES * slotLayers(s - 1));
      expect(giDepth(s + 1)).toBe(giSlotBase(s) + GI_FACES * slotLayers(s));
      expect(giDepth(s + 1)).toBe(GI_FACES * (LAYERS + s * AUX_LAYERS));
    }
  });

  it('one slot: gi = fieldDepth(1), 24 slices; every texel is the stored difference of its own voxel, face and layer; closed cells say "none"', () => {
    const b = bakeRows(cubeRoom(false), patternRows()), f = b.field;
    expect([f.slots, f.hdr, f.gi, f.depth]).toEqual([1, 0, fieldDepth(1), fieldDepth(1) + giDepth(1)]);
    expect(f.data.length).toBe(f.w * f.h * f.depth * 4);
    expect(f.stats.bytes).toBe(f.data.length);
    const c = checkCube(b);
    expect(c.compared).toBe(b.count * GI_FACES * 3);
    expect(c.compared).toBeGreaterThan(20000);
    expect([c.wrong, c.closedWrong, c.alphaWrong]).toEqual([0, 0, 0]);
    expect(c.slices).toBe(giDepth(1)); // every cube slice was reached, none twice over (the count above is per slice)
    // without direct light the stored difference is the face minus the layer's own share: the bottom layer's up-facing texels and
    // the top layer's down-facing texels are "none" (those faces ARE the main texel), and other faces are not
    const n = f.w * f.h, L = LAYERS;
    let none = 0, some = 0;
    for (let i = 0; i < n; i++) {
      if (b.index[0][i * L] < 0) continue;
      for (const [face, k] of [[0, 0], [1, L - 1]]) { const o = cubeAt(f, 0, face, k, i); if (f.data[o] !== 128 || f.data[o + 1] !== 128 || f.data[o + 2] !== 128) none++; }
      for (const [face, k] of [[1, 0], [0, L - 1], [2, 1], [5, 2]]) { const o = cubeAt(f, 0, face, k, i); if (f.data[o] !== 128 || f.data[o + 1] !== 128 || f.data[o + 2] !== 128) some++; }
    }
    expect(none).toBe(0);
    expect(some).toBeGreaterThan(1000);
  });

  it('three levels (4 + 3 + 3 layers): each slot\'s faces at gi + giSlotBase(slot), with the direct light\'s correction in every texel', () => {
    const b = bakeRows(threeLevels(), patternRows()), f = b.field;
    expect([f.slots, f.hdr]).toEqual([3, 0]);
    expect(f.gi).toBe(fieldDepth(3));
    expect(f.depth).toBe(fieldDepth(3) + giDepth(3));
    expect([giSlotBase(1), giSlotBase(2), giDepth(3)]).toEqual([GI_FACES * LAYERS, GI_FACES * (LAYERS + AUX_LAYERS), GI_FACES * (LAYERS + 2 * AUX_LAYERS)]);
    const c = checkCube(b);
    expect(c.compared).toBe(b.count * GI_FACES * 3);
    expect([c.wrong, c.closedWrong, c.alphaWrong]).toEqual([0, 0, 0]);
    expect(c.slices).toBe(giDepth(3));
    // (the fixture is lit: the correction term was really part of what was compared)
    let lit = 0;
    for (let s = 0; s < 3; s++) for (let v = 0; v < b.ctx.EL[s].length; v++) if (b.ctx.EL[s][v] > 0.05) lit++;
    expect(lit).toBeGreaterThan(5000);
  });

  it('a nine-storey tower (extended column headers): the cube starts after the header\'s group slices', () => {
    const b = bakeRows(tower(), patternRows(0.8)), f = b.field;
    expect(f.slots).toBe(9);
    expect(f.hdr).toBe(3);
    expect(f.gi).toBe(fieldDepth(9) + 3);
    expect(f.depth).toBe(fieldDepth(9) + 3 + giDepth(9));
    const c = checkCube(b);
    expect(c.compared).toBe(b.count * GI_FACES * 3);
    expect([c.wrong, c.closedWrong, c.alphaWrong]).toEqual([0, 0, 0]);
    expect(c.slices).toBe(giDepth(9));
    // the slices before the cube are the bake without one (slots and group slices: nothing moved)
    const plain = bakeRows(tower(), patternRows(0.8), {cube: false}).field;
    expect([plain.gi, plain.depth, plain.hdr]).toEqual([undefined, fieldDepth(9) + 3, 3]);
    expect(same(f.data.subarray(0, f.gi! * f.w * f.h * 4), plain.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('without the cube', () => {
  it('no `indirect`: the baseline bake, whatever `cube` says — no gi, the baseline\'s depth and bytes', () => {
    for (const src of [cubeRoom(), threeLevels()]) {
      const base = bakeLightField(src);
      expect(base.gi).toBeUndefined();
      expect('gi' in base).toBe(false);
      expect(base.depth).toBe(fieldDepth(base.slots) + (base.hdr ?? 0));
      expect(base.stats.cubeClipped).toBeUndefined();
      expect(base.stats.indirect).toBeUndefined();
      for (const cube of [true, false]) {
        const f = bakeLightField({...src, cube});
        expect([f.gi, f.depth]).toEqual([undefined, base.depth]);
        expect(same(f.data, base.data)).toBe(true);
      }
    }
  });

  it('`cube: false`: the enhanced slots alone — byte for byte the slices before the cube of the bake that has one', () => {
    for (const src of [cubeRoom(), threeLevels()]) {
      const full = bakeRows(src, patternRows()).field, bare = bakeRows(src, patternRows(), {cube: false}).field, dflt = bakeRows(src, patternRows(), {cube: true}).field;
      expect(bare.gi).toBeUndefined();
      expect('gi' in bare).toBe(false);
      expect(bare.depth).toBe(fieldDepth(bare.slots) + (bare.hdr ?? 0));
      expect(bare.stats.cubeClipped).toBeUndefined();
      expect(bare.stats.indirect).toBeDefined();
      expect(full.gi).toBe(bare.depth);
      expect(same(full.data.subarray(0, full.gi! * full.w * full.h * 4), bare.data)).toBe(true);
      expect(same(full.data, dflt.data)).toBe(true); // (the default is with the cube)
      // and it is an ENHANCED field: not the baseline's bytes
      expect(same(bare.data, bakeLightField(src).data)).toBe(false);
    }
  });

  it('withoutCube: a view of the same bytes (nothing copied) with the cube forgotten; a field without one is returned as it is', () => {
    const f = bakeRows(threeLevels(), patternRows()).field, v = withoutCube(f);
    expect(v).not.toBe(f);
    expect(v.data.buffer).toBe(f.data.buffer);
    expect([v.data.byteOffset, v.data.byteLength]).toEqual([f.data.byteOffset, f.gi! * f.w * f.h * 4]);
    expect([v.gi, 'gi' in v, v.depth, v.stats.bytes]).toEqual([undefined, false, f.gi, v.data.byteLength]);
    expect([v.w, v.h, v.slots, v.layers, v.hdr, v.yMin, v.yMax, v.cellScale]).toEqual([f.w, f.h, f.slots, f.layers, f.hdr, f.yMin, f.yMax, f.cellScale]);
    expect([v.slotY === f.slotY, v.masks === f.masks, v.groups === f.groups]).toEqual([true, true, true]);
    expect(v.stats.indirect).toBe(f.stats.indirect);
    // the original is untouched, and the view is the bake made without a cube
    expect([f.gi, f.depth, f.stats.bytes]).toEqual([fieldDepth(3), fieldDepth(3) + giDepth(3), f.data.length]);
    expect(same(v.data, bakeRows(threeLevels(), patternRows(), {cube: false}).field.data)).toBe(true);
    expect(withoutCube(v)).toBe(v);
    const base = bakeLightField(cubeRoom());
    expect(withoutCube(base)).toBe(base);
  });
});

// ---------------------------------------------------------------------------------------------
describe('encoding: a signed difference in one byte', () => {
  it('cubeDifference: 128 is nothing, 255 / 1 are +-FIELD_DMAX, ordered, the same either side of 128', () => {
    expect(cubeDifference(128)).toBe(0);
    expect(cubeDifference(255)).toBe(FIELD_DMAX);
    expect(cubeDifference(1)).toBe(-FIELD_DMAX);
    for (let b = 1; b < 256; b++) expect(cubeDifference(b)).toBeGreaterThan(cubeDifference(b - 1));
    for (let e = 1; e <= 127; e++) expect(cubeDifference(128 - e)).toBe(-cubeDifference(128 + e));
    // a filtered texel is any value between two bytes: still ordered, still 0 at 128
    expect(cubeDifference(128.5)).toBeGreaterThan(0);
    expect(cubeDifference(127.5)).toBeLessThan(0);
    expect(cubeDifference(140.25)).toBeGreaterThan(cubeDifference(140));
    // finest near nothing (where the eye sees a step), coarsest at the limit
    expect(cubeDifference(129)).toBeLessThan(FIELD_DMAX / 10000);
    expect(cubeDifference(255) - cubeDifference(254)).toBeLessThan(FIELD_DMAX / 60);
  });

  it('the encoder and cubeDifference are each other\'s inverse within half a step; byte 0 is never written', () => {
    // the test's own encoder against cubeDifference, over the whole range
    let worst = 0;
    for (let q = -4000; q <= 4000; q++) {
      const v = Math.sign(q) * (q / 4000) ** 2 * FIELD_DMAX, back = cubeDifference(cubeByte(v));
      worst = Math.max(worst, Math.abs(back - v) / cubeHalfStep(v));
      expect(cubeByte(back)).toBe(cubeByte(v));
    }
    expect(worst).toBeLessThanOrEqual(1);
    expect([cubeByte(0), cubeByte(FIELD_DMAX), cubeByte(-FIELD_DMAX), cubeByte(FIELD_DMAX * 3), cubeByte(-FIELD_DMAX * 3)]).toEqual([128, 255, 1, 255, 1]);
    // the bake's bytes decode to what was stored, within half a step, wherever the clamp did not bind
    const b = bakeRows(cubeRoom(), patternRows()), f = b.field, n = f.w * f.h;
    let off = 0, zero = 0, checked = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < LAYERS; k++) {
      const t = voxelTerms(b, 0, i, k);
      if (!t) continue;
      for (let face = 0; face < GI_FACES; face++) for (let c = 0; c < 3; c++) {
        const byte = f.data[cubeAt(f, 0, face, k, i) + c], v = t.stored[face][c];
        if (byte === 0) zero++;
        if (Math.abs(v) > FIELD_DMAX) continue;
        checked++;
        if (Math.abs(cubeDifference(byte) - v) > cubeHalfStep(v)) off++;
      }
    }
    expect(checked).toBeGreaterThan(20000);
    expect([off, zero]).toEqual([0, 0]);
    for (let o = f.gi! * n * 4; o < f.data.length; o++) if (f.data[o] === 0) zero++;
    expect(zero).toBe(0);
  });

  it('a difference past +-FIELD_DMAX is stored at the limit and counted (stats.cubeClipped); a bake within it counts none', () => {
    // rows with faces far apart: some voxels' up-facing face is 3 x the limit, their other faces nothing
    const big = FIELD_DMAX * 3;
    const b = bakeRows(cubeRoom(false), count => {
      const d = new Float32Array(count * IND_STRIDE);
      for (let v = 0; v < count; v += 3) { d[v * IND_STRIDE] = big; d[v * IND_STRIDE + 1] = big; d[v * IND_STRIDE + 2] = FIELD_DMAX * 0.5; }
      return d;
    });
    const c = checkCube(b), f = b.field;
    expect(c.wrong).toBe(0);
    expect(c.clipped).toBeGreaterThan(1000);
    expect(f.stats.cubeClipped).toBe(c.clipped);
    // at the limit either way: +limit where the face is far above its layer's share, -limit where the share is far above the face
    let top = 0, bottom = 0;
    for (let o = f.gi! * f.w * f.h * 4; o < f.data.length; o += 4) { if (f.data[o] === 255) top++; if (f.data[o] === 1) bottom++; }
    expect(top).toBeGreaterThan(100);
    expect(bottom).toBeGreaterThan(100);
    // the pattern rows stay inside
    const ok = bakeRows(cubeRoom(), patternRows());
    expect(checkCube(ok).clipped).toBe(0);
    expect(ok.field.stats.cubeClipped).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('sampling with a normal', () => {
  /** World position of the centre of voxel (slot, cell i, layer k) as the SAMPLER sees it (its 8-bit floor / ceiling), or null when that height picks another slot. */
  function voxelCentre(f: BakedField, b: RowBake, slot: number, i: number, k: number): V3 | null {
    const cx = i % f.w, cz = (i - cx) / f.w, L = slotLayers(slot);
    const hs = fieldSlot(f, cx, cz, b.ctx.geos[slot].layerY[i * L + k]);
    if (hs.slot !== slot || hs.ceil - hs.floor < 0.3) return null;
    return [(cx + 0.5) * CELL, hs.floor + (hs.ceil - hs.floor) * k / (L - 1), (cz + 0.5) * CELL];
  }
  /** A sample whose lookup lands exactly on a voxel's centre for normal n (the sampler offsets the lookup along the normal). */
  const atCentre = (f: BakedField, p: V3, n: readonly [number, number, number]) => sampleField(f, p[0] - n[0] * CELL * 0.5, p[1] - n[1] * 0.2, p[2] - n[2] * CELL * 0.5, [1, 1, 1], n);
  /** Half a step of the main texel's colour byte at T (square-root spaced to FIELD_EMAX). */
  const colourStep = (T: number): number => (Math.sqrt(FIELD_EMAX * Math.max(T, 0)) + 0.04) / 255;
  /** The 8-bit steps a sample of one voxel carries: the main texel's colour, its share (half a byte), the cube's byte. */
  const stepsOf = (T: number, rho: number, stored: number): number => (colourStep(T) * (1 - rho + 0.5 / 255) + Math.max(T, 0) * 0.5 / 255 + cubeHalfStep(stored)) * 1.02 + 1e-6;

  for (const [name, src] of [['one room', cubeRoom], ['three levels', threeLevels]] as const) {
    it(`${name}: at a voxel's centre the ambient light is the direct light's scatter + the gathered face of that orientation, channel by channel`, () => {
      const b = bakeRows(src(), patternRows(1.2, 11)), f = b.field, n = f.w * f.h;
      let checked = 0, off = 0, negative = 0, strong = 0, worst = 0, dirOff = 0, dirChecked = 0;
      for (let s = 0; s < f.slots; s++) for (let i = 0; i < n; i++) for (let k = 0; k < slotLayers(s); k++) {
        const t = voxelTerms(b, s, i, k);
        if (!t) continue;
        const p = voxelCentre(f, b, s, i, k);
        if (!p) continue;
        for (let face = 0; face < GI_FACES; face++) {
          if (t.stored[face].some(v => Math.abs(v) > FIELD_DMAX) || t.T.some(v => v > FIELD_EMAX)) continue;
          const sm = atCentre(f, p, CUBE_FACES[face]);
          for (let c = 0; c < 3; c++) {
            checked++;
            if (sm.amb[c] < 0) negative++;
            const err = Math.abs(sm.amb[c] - t.ambient[face][c]), tol = stepsOf(t.T[c], t.rho, t.stored[face][c]);
            worst = Math.max(worst, err / tol);
            if (err > tol) off++;
          }
          // a strong, directional direct light and a coloured face: where one share for three channels used to cost the colour
          if (t.rho > 0.7 && t.el > 0.3) strong++;
          // what is left of the one-share split sits in the directional part: it has the luminance of the direct light's
          // directional part and the colour of the main texel (T x rho, not E x dl / el)
          if (face === 0 && t.el > 0.05) {
            dirChecked++;
            const want = t.T.map(v => v * t.rho), tolD = (c: number) => (colourStep(t.T[c]) + t.T[c] * 0.5 / 255) * 1.02 + 1e-6;
            if ([0, 1, 2].some(c => Math.abs(sm.dirColor[c] - want[c]) > tolD(c))) dirOff++;
            if (Math.abs(lum3(sm.dirColor) - t.dl) > tolD(0) + tolD(1) + tolD(2)) dirOff++;
          }
        }
      }
      console.log(`${name}: ${checked} channels at voxel centres, worst error ${(worst * 100).toFixed(0)} % of the 8-bit steps; ${strong} face samples under a strong directional light`);
      expect(checked).toBeGreaterThan(20000);
      expect(strong).toBeGreaterThan(1000);
      expect([off, negative]).toEqual([0, 0]);
      expect(dirChecked).toBeGreaterThan(1000);
      expect(dirOff).toBe(0);
    });
  }

  it('a surface turned away from a strong white light keeps the colour of what was gathered (no complementary cast)', () => {
    // every voxel: a red gathered light on all six faces; the room's fixtures white
    const src = cubeRoom();
    const white: FieldSource = {...src, lights: src.lights.map(l => ({...l, warm: false, flicker: false, tint: [1, 1, 1] as [number, number, number]}))};
    const red = [0.30, 0.05, 0.04], row = Array.from({length: IND_STRIDE}, (_, q) => (q < 18 ? red[q % 3] : 0));
    const b = bakeRows(white, uniformRows(row)), f = b.field, n = f.w * f.h;
    let checked = 0, cast = 0, plainCast = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < LAYERS; k++) {
      const t = voxelTerms(b, 0, i, k);
      if (!t || t.rho < 0.8) continue; // (the strongly lit voxels: most of the main texel is directional)
      const p = voxelCentre(f, b, 0, i, k);
      if (!p) continue;
      // the face that looks away from the light: its normal against the direct light's direction
      const d = sampleField(f, p[0], p[1], p[2]).dir, away = CUBE_FACES.map((nf, face) => [nf[0] * d[0] + nf[1] * d[1] + nf[2] * d[2], face]).sort((x, y) => x[0] - y[0])[0][1];
      const sm = atCentre(f, p, CUBE_FACES[away]);
      checked++;
      // the white light's scatter adds the same to every channel: the gathered light's red excess (r - g) arrives whole
      if (!(sm.amb[0] - sm.amb[1] > (red[0] - red[1]) * 0.8)) cast++;
      // the plain sample (no normal: the main texel alone) has lost most of it to the directional part — why the cube corrects it
      const plain = sampleField(f, p[0], p[1], p[2]).amb;
      if (plain[0] - plain[1] < (red[0] - red[1]) * 0.3) plainCast++;
    }
    expect(checked).toBeGreaterThan(300);
    expect(cast).toBe(0);
    expect(plainCast).toBe(checked);
  });

  it('never negative, whatever the normal and wherever the sample; the weights are the squares of the normal\'s components', () => {
    const b = bakeRows(threeLevels(), patternRows(2.5, 3)), f = b.field, rnd = sequence(99);
    const W = f.w * CELL, D = f.h * CELL;
    let negative = 0, combined = 0, off = 0;
    for (let q = 0; q < 6000; q++) {
      const p: V3 = [rnd() * W, FIX.lowerY - 0.5 + rnd() * (FIX.upperCeil - FIX.lowerY + 1), rnd() * D];
      const v: V3 = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1], l = Math.hypot(v[0], v[1], v[2]) || 1;
      // (some normals with a zero component, some along one axis)
      const nrm: V3 = q % 7 === 0 ? [0, v[1] < 0 ? -1 : 1, 0] : q % 5 === 0 ? [v[0] / Math.hypot(v[0], v[2]), 0, v[2] / Math.hypot(v[0], v[2])] : [v[0] / l, v[1] / l, v[2] / l];
      const sm = sampleField(f, p[0], p[1], p[2], [1, 1, 1], nrm);
      if (sm.amb.some(c => !(c >= 0)) || sm.dirColor.some(c => !(c >= 0))) negative++;
      // the same lookup position read with each axis normal: amb(n) = plain + sum over the axes of n_a^2 x (amb(axis) - plain)
      const P: V3 = [p[0] + nrm[0] * CELL * 0.5, p[1] + nrm[1] * 0.2, p[2] + nrm[2] * CELL * 0.5];
      const plain = sampleField(f, P[0], P[1], P[2]).amb, want: V3 = [plain[0], plain[1], plain[2]];
      let clamped = false;
      for (let a = 0; a < 3; a++) {
        if (nrm[a] === 0) continue;
        const ax: V3 = [0, 0, 0]; ax[a] = nrm[a] > 0 ? 1 : -1;
        const one = sampleField(f, P[0] - ax[0] * CELL * 0.5, P[1] - ax[1] * 0.2, P[2] - ax[2] * CELL * 0.5, [1, 1, 1], ax).amb;
        if (one.some(c => c === 0)) clamped = true;
        for (let c = 0; c < 3; c++) want[c] += nrm[a] * nrm[a] * (one[c] - plain[c]);
      }
      if (clamped || want.some(c => c <= 0)) continue;
      combined++;
      if ([0, 1, 2].some(c => Math.abs(sm.amb[c] - want[c]) > 1e-9 + want[c] * 1e-9)) off++;
    }
    expect(negative).toBe(0);
    expect(combined).toBeGreaterThan(2000);
    expect(off).toBe(0);
  });

  it('without a normal, or without a cube, the sample is the plain one', () => {
    const b = bakeRows(threeLevels(), patternRows()), f = b.field, bare = withoutCube(f), rnd = sequence(5);
    const W = f.w * CELL, D = f.h * CELL;
    let differ = 0, cubeMatters = 0;
    for (let q = 0; q < 3000; q++) {
      const p: V3 = [rnd() * W, FIX.lowerY + rnd() * (FIX.upperCeil - FIX.lowerY), rnd() * D], nrm = CUBE_FACES[q % 6];
      const lv = [rnd(), rnd(), rnd()];
      // no normal: the cube is not read
      const a = sampleField(f, p[0], p[1], p[2], lv), a0 = sampleField(bare, p[0], p[1], p[2], lv);
      // a normal on a field without a cube: the lookup is offset along it, nothing else
      const n0 = sampleField(bare, p[0], p[1], p[2], lv, nrm), moved = sampleField(bare, p[0] + nrm[0] * CELL * 0.5, p[1] + nrm[1] * 0.2, p[2] + nrm[2] * CELL * 0.5, lv);
      const eq = (x: typeof a, y: typeof a) => [0, 1, 2].every(c => x.amb[c] === y.amb[c] && x.dirColor[c] === y.dirColor[c] && x.dir[c] === y.dir[c]);
      if (!eq(a, a0) || !eq(n0, moved)) differ++;
      // with the cube and a normal: the direct part is the plain one, the ambient part is not
      const n1 = sampleField(f, p[0], p[1], p[2], lv, nrm);
      if ([0, 1, 2].some(c => n1.dirColor[c] !== n0.dirColor[c] || n1.dir[c] !== n0.dir[c])) differ++;
      if ([0, 1, 2].some(c => n1.amb[c] !== n0.amb[c])) cubeMatters++;
    }
    expect(differ).toBe(0);
    expect(cubeMatters).toBeGreaterThan(1000);
  });

  it('the flicker circuits dim the cube\'s light with the rest of the voxel\'s', () => {
    const b = bakeRows(cubeRoom(), patternRows()), f = b.field;
    const p: V3 = [10.6, 1.5, 5.2], nrm: V3 = [0, 0, 1];
    const on = sampleField(f, p[0], p[1], p[2], [1, 1, 1], nrm), off = sampleField(f, p[0], p[1], p[2], [0, 0, 0], nrm), plain = sampleField(f, p[0], p[1] + 0, p[2] + CELL * 0.5, [0, 0, 0]);
    expect(lum3(on.amb)).toBeGreaterThan(0);
    expect(lum3(off.amb)).toBeLessThan(lum3(on.amb));
    // one multiplier for the whole voxel: ambient (cube included) and directional parts keep their proportion
    const m = lum3(off.dirColor) / lum3(on.dirColor);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1);
    for (let c = 0; c < 3; c++) expect(off.amb[c]).toBeCloseTo(on.amb[c] * m, 9);
    expect(lum3(plain.dirColor)).toBeCloseTo(lum3(off.dirColor), 9);
  });
});

// ---------------------------------------------------------------------------------------------
describe('downsampleField keeps the cube', () => {
  it('gi, depth and the header slices are kept; every cube texel is the rounded mean of its k x k source texels', () => {
    for (const [src, k] of [[threeLevels(), 2], [cubeRoom(), 3], [tower(), 2]] as const) {
      const f = bakeRows(src, patternRows()).field, d = downsampleField(f, k);
      expect([d.gi, d.depth, d.slots, d.hdr, d.layers, d.cellScale]).toEqual([f.gi, f.depth, f.slots, f.hdr, f.layers, k]);
      expect([d.w, d.h]).toEqual([Math.ceil(f.w / k), Math.ceil(f.h / k)]);
      expect(d.data.length).toBe(d.w * d.h * d.depth * 4);
      expect(d.stats.bytes).toBe(d.data.length);
      let wrong = 0, checked = 0;
      for (let s = f.gi!; s < f.depth; s++) for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) acc += f.data[((s * f.h + Math.min(f.h - 1, y * k + dy)) * f.w + Math.min(f.w - 1, x * k + dx)) * 4 + c];
        checked++;
        if (d.data[((s * d.h + y) * d.w + x) * 4 + c] !== Math.round(acc / (k * k))) wrong++;
      }
      expect(checked).toBe(giDepth(f.slots) * d.w * d.h * 4);
      expect(wrong).toBe(0);
      // the slices before the cube (column header, slots, an extended field's group slices) are those of the field without it
      const bare = downsampleField(withoutCube(f), k);
      expect([bare.gi, bare.depth]).toEqual([undefined, f.gi]);
      expect(same(d.data.subarray(0, f.gi! * d.w * d.h * 4), bare.data)).toBe(true);
      expect(downsampleField(f, 1)).toBe(f);
    }
  });

  it('a uniform cube stays uniform: "no difference" stays 128, and a field of one gathered light reads the same at half resolution', () => {
    // no gathered light at all: every cube byte of the open cells' rgb is 128 before and after
    const dark = bakeRows(cubeRoom(), uniformRows([])).field, dd = downsampleField(dark, 2);
    for (const f of [dark, dd]) {
      let set = 0;
      for (let o = f.gi! * f.w * f.h * 4; o < f.data.length; o += 4) if (f.data[o] !== 128 || f.data[o + 1] !== 128 || f.data[o + 2] !== 128) set++;
      expect(set).toBe(0);
    }
    // one gathered light everywhere, a different value per face, no direct light: a surface at a layer's height, away from the
    // walls, gets its own face's value at full and at half resolution (the cube's slices were averaged with their own kind)
    const faces = [0.9, 0.1, 0.5, 0.3, 0.7, 0.2], row = Array.from({length: IND_STRIDE}, (_, q) => (q < 18 ? faces[Math.floor(q / 3)] * (1 + 0.1 * (q % 3)) : 0));
    const g = bakeRows(cubeRoom(false), uniformRows(row)).field, gd = downsampleField(g, 2);
    for (const f of [g, gd]) {
      const C = CELL * (f.cellScale ?? 1);
      for (let face = 0; face < GI_FACES; face++) for (const [x, z] of [[2.2, 6.1], [3, 6.5], [2.6, 5.8]] as const) for (let k = 0; k < LAYERS; k++) {
        const nrm = CUBE_FACES[face], hs = fieldSlot(f, Math.floor(x / C), Math.floor(z / C), 1), y = hs.floor + (hs.ceil - hs.floor) * k / (LAYERS - 1);
        const sm = sampleField(f, x, y - nrm[1] * 0.2, z, [1, 1, 1], nrm);
        // (within the two bytes' steps: the main texel's colour and the cube's difference)
        for (let c = 0; c < 3; c++) expect(Math.abs(sm.amb[c] - faces[face] * (1 + 0.1 * c))).toBeLessThan(0.04);
        expect(sm.dirColor).toEqual([0, 0, 0]);
      }
    }
  });
});
