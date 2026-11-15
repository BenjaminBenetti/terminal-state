// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane TESTS): the AMBIENT CUBE of an enhanced light field (world/lightField.ts
// BakedField.gi) — its slices, its encoding and what the CPU sampler makes of it. The gathered light comes in through
// FieldSource.indirect; these tests hand the bake rows of their own (helpers/lightCubeFixture.ts), so every expected byte is known.
//  - LAYOUT: the cube follows the slots (and an extended field's header group slices): per slot, per face of CUBE_FACES, one slice
//    per height layer, giDepth(slots) slices in all — one slot, three levels (4 + 3 + 3 layers) and a nine-storey tower;
//  - WITHOUT IT: a bake without `indirect` has no cube whatever `cube` says; an enhanced bake with `cube: false` is the cube bake's
//    slots, byte for byte; withoutCube is a view of the same bytes, not a copy;
//  - ENCODING: a texel is the COMPLETE AMBIENT of a surface facing that way — what the direct light scatters + the gathered face —
//    encoded as the main texels are (unsigned, square-root spaced up to FIELD_EMAX, 0 = none and all a closed cell holds); values
//    past the range are stored at it and counted (stats.cubeClipped); cubeAmbient undoes it within half a step;
//  - THE POINT OF IT: sampled with a normal at a voxel's centre, the ambient light is exactly that value, channel by channel (within
//    the cube's own 8-bit step) — also on a surface turned away from a strong direct light, where the main texel's ONE directional
//    share takes the gathered light's colour with it; the directional part stays the main texel's (T x rho);
//  - with a normal the cube REPLACES the main texel's ambient part: the faces the normal points at, weighted by its squares; never
//    negative; without a normal, or without a cube, the sample is the plain one;
//  - BETWEEN TWO LAYERS a face is one filtered value, decoded after the blend: never above the blend of the two layers' values, and
//    close to it on a real station (Subway 93 as the game bakes it: the bound that guards the encoding);
//  - downsampleField keeps the cube (averaged like the slots; the header slices before it are not touched by it).
import {describe, expect, it} from 'vitest';
import {CELL} from '../src/gen/grid';
import {generateStation} from '../src/gen/station';
import {GI_TIERS} from '../src/world/enhancedLighting';
import {
  AUX_LAYERS, CUBE_FACES, FIELD_EMAX, GI_FACES, LAYERS, bakeLightField, cubeAmbient, downsampleField, fieldDepth, fieldSlot, giDepth, giSlotBase,
  sampleField, slotLayers, withoutCube, type BakedField, type FieldSource,
} from '../src/world/lightField';
import {IND_STRIDE} from '../src/world/lightFieldGather';
import {stationBakeInput} from '../src/world/lights';
import {FIX, levelFixture} from './helpers/levelRenderFixture';
import {towerFixture} from './helpers/towerFixture';
import {
  bakeRows, cubeByte, cubeHalfStep, cubeRoom, gatheredRows, lum3, patternRows, sequence, uniformRows, voxelTerms, type RowBake, type V3,
} from './helpers/lightCubeFixture';

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const threeLevels = (lights = true): FieldSource => { const {layout, levels} = levelFixture({lights}); return {grid: layout.grid, lights: layout.lights, trenchFloorY: FIX.bedY, levels}; };
const tower = (): FieldSource => { const t = towerFixture({lights: false}); return {grid: t.layout.grid, lights: t.layout.lights, trenchFloorY: -1.15, levels: t.levels}; };
/** First byte of the cube texel (slot, face, layer, cell). */
const cubeAt = (f: BakedField, slot: number, face: number, k: number, i: number): number => ((f.gi! + giSlotBase(slot) + face * slotLayers(slot) + k) * f.w * f.h + i) * 4;

/**
 * Every cube texel of a bake against the test's own statement of the encoder (voxelTerms + cubeByte): how many open-voxel channels
 * were compared, how many differ, how many are past the range; closed cells must hold 0 in all four channels, open ones alpha 255.
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
        if (!t) { if (f.data[o] !== 0 || f.data[o + 1] !== 0 || f.data[o + 2] !== 0 || f.data[o + 3] !== 0) closedWrong++; continue; }
        if (f.data[o + 3] !== 255) alphaWrong++;
        for (let c = 0; c < 3; c++) {
          compared++;
          if (f.data[o + c] !== cubeByte(t.ambient[face][c])) wrong++;
          if (t.ambient[face][c] > FIELD_EMAX) clipped++;
        }
      }
    }
  }
  return {compared, wrong, clipped, closedWrong, alphaWrong, slices: seen.size};
}

/** World position of the centre of voxel (slot, cell i, layer k) as the SAMPLER sees it (its 8-bit floor / ceiling), or null when that height picks another slot. */
function voxelCentre(f: BakedField, b: RowBake, slot: number, i: number, k: number): V3 | null {
  const cx = i % f.w, cz = (i - cx) / f.w, L = slotLayers(slot);
  const hs = fieldSlot(f, cx, cz, b.ctx.geos[slot].layerY[i * L + k]);
  if (hs.slot !== slot || hs.ceil - hs.floor < 0.3) return null;
  return [(cx + 0.5) * CELL, hs.floor + (hs.ceil - hs.floor) * k / (L - 1), (cz + 0.5) * CELL];
}
/** A sample whose lookup lands exactly on point p for normal n (the sampler offsets the lookup along the normal). */
const atPoint = (f: BakedField, p: readonly number[], n: readonly [number, number, number]) => sampleField(f, p[0] - n[0] * CELL * 0.5, p[1] - n[1] * 0.2, p[2] - n[2] * CELL * 0.5, [1, 1, 1], n);

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

  it('one slot: gi = fieldDepth(1), 24 slices; every texel is the ambient of its own voxel, face and layer; closed cells hold nothing', () => {
    const b = bakeRows(cubeRoom(false), patternRows()), f = b.field;
    expect([f.slots, f.hdr, f.gi, f.depth]).toEqual([1, 0, fieldDepth(1), fieldDepth(1) + giDepth(1)]);
    expect(f.data.length).toBe(f.w * f.h * f.depth * 4);
    expect(f.stats.bytes).toBe(f.data.length);
    const c = checkCube(b);
    expect(c.compared).toBe(b.count * GI_FACES * 3);
    expect(c.compared).toBeGreaterThan(20000);
    expect([c.wrong, c.closedWrong, c.alphaWrong]).toEqual([0, 0, 0]);
    expect(c.slices).toBe(giDepth(1)); // every cube slice was reached, none twice over (the count above is per slice)
    // without direct light a texel is the gathered face itself — straight from the rows, whatever the layer (the main texel
    // holds one face, or a mean of four, per layer: the cube holds all six on every layer)
    const n = f.w * f.h, L = LAYERS;
    let off = 0, distinct = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < L; k++) {
      const row = b.index[0][i * L + k];
      if (row < 0) continue;
      for (let face = 0; face < GI_FACES; face++) for (let ch = 0; ch < 3; ch++) if (f.data[cubeAt(f, 0, face, k, i) + ch] !== cubeByte(b.rows[row * IND_STRIDE + face * 3 + ch])) off++;
      if (f.data[cubeAt(f, 0, 0, k, i)] !== f.data[cubeAt(f, 0, 1, k, i)]) distinct++;
    }
    expect(off).toBe(0);
    expect(distinct).toBeGreaterThan(1000); // (the faces of a voxel really differ in these rows)
  });

  it('three levels (4 + 3 + 3 layers): each slot\'s faces at gi + giSlotBase(slot), with the direct light\'s scatter in every lit texel', () => {
    const b = bakeRows(threeLevels(), patternRows()), f = b.field;
    expect([f.slots, f.hdr]).toEqual([3, 0]);
    expect(f.gi).toBe(fieldDepth(3));
    expect(f.depth).toBe(fieldDepth(3) + giDepth(3));
    expect([giSlotBase(1), giSlotBase(2), giDepth(3)]).toEqual([GI_FACES * LAYERS, GI_FACES * (LAYERS + AUX_LAYERS), GI_FACES * (LAYERS + 2 * AUX_LAYERS)]);
    const c = checkCube(b);
    expect(c.compared).toBe(b.count * GI_FACES * 3);
    expect([c.wrong, c.closedWrong, c.alphaWrong]).toEqual([0, 0, 0]);
    expect(c.slices).toBe(giDepth(3));
    // (the fixture is lit: the direct light's scatter was really part of what was compared — in voxels of every slot)
    const scattered = [0, 0, 0];
    for (let s = 0; s < 3; s++) for (let i = 0; i < f.w * f.h; i++) for (let k = 0; k < slotLayers(s); k++) {
      const t = voxelTerms(b, s, i, k);
      if (t && lum3(t.E) * (t.coh - t.sh) > cubeHalfStep(0.05) * 4) scattered[s]++;
    }
    for (const q of scattered) expect(q).toBeGreaterThan(300);
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
describe('encoding: the complete ambient of a face in one byte a channel', () => {
  it('cubeAmbient: 0 is nothing, 255 is FIELD_EMAX, ordered, square-root spaced — the main texels\' own decoding', () => {
    expect(cubeAmbient(0)).toBe(0);
    expect(cubeAmbient(255)).toBe(FIELD_EMAX);
    for (let b = 1; b < 256; b++) {
      expect(cubeAmbient(b)).toBeGreaterThan(cubeAmbient(b - 1));
      const v = b / 255;
      expect(cubeAmbient(b)).toBe(v * v * FIELD_EMAX);
    }
    // a filtered texel is any value between two bytes: still ordered
    expect(cubeAmbient(0.5)).toBeGreaterThan(0);
    expect(cubeAmbient(140.25)).toBeGreaterThan(cubeAmbient(140));
    expect(cubeAmbient(140.25)).toBeLessThan(cubeAmbient(141));
    // finest near nothing (where the eye sees a step), coarsest at the top
    expect(cubeAmbient(1)).toBeLessThan(FIELD_EMAX / 10000);
    expect(cubeAmbient(255) - cubeAmbient(254)).toBeLessThan(FIELD_EMAX / 60);
    // and it IS how a main texel's colour reads: a cube texel and a main texel holding the same byte hold the same light
    const b = bakeRows(cubeRoom(false), uniformRows(Array.from({length: IND_STRIDE}, (_, q) => (q < 18 ? 0.37 : 0)))), f = b.field;
    const sm = sampleField(f, 3.25, 1.2, 3.25), smN = sampleField(f, 3.25, 1.2, 3.25 - CELL * 0.5, [1, 1, 1], [0, 0, 1]);
    expect(sm.amb[0]).toBeGreaterThan(0.3);
    for (let c = 0; c < 3; c++) expect(smN.amb[c]).toBeCloseTo(sm.amb[c], 12); // (every face = every layer's share = 0.37: the same byte both ways)
  });

  it('the encoder and cubeAmbient are each other\'s inverse within half a step; a negative value is nothing', () => {
    // the test's own encoder against cubeAmbient, over the whole range
    let worst = 0;
    for (let q = 0; q <= 4000; q++) {
      const v = (q / 4000) ** 2 * FIELD_EMAX, back = cubeAmbient(cubeByte(v));
      worst = Math.max(worst, Math.abs(back - v) / cubeHalfStep(v));
      expect(cubeByte(back)).toBe(cubeByte(v));
    }
    expect(worst).toBeLessThanOrEqual(1);
    expect(worst).toBeGreaterThan(0.5); // (the bound is the encoding's real half step, not a loose one)
    expect([cubeByte(0), cubeByte(-1), cubeByte(FIELD_EMAX), cubeByte(FIELD_EMAX * 3)]).toEqual([0, 0, 255, 255]);
    // the bake's bytes decode to what was stored, within half a step, wherever the ceiling did not bind
    const b = bakeRows(cubeRoom(), patternRows()), f = b.field, n = f.w * f.h;
    let off = 0, checked = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < LAYERS; k++) {
      const t = voxelTerms(b, 0, i, k);
      if (!t) continue;
      for (let face = 0; face < GI_FACES; face++) for (let c = 0; c < 3; c++) {
        const byte = f.data[cubeAt(f, 0, face, k, i) + c], v = t.ambient[face][c];
        if (v > FIELD_EMAX) continue;
        checked++;
        if (Math.abs(cubeAmbient(byte) - v) > cubeHalfStep(v)) off++;
      }
    }
    expect(checked).toBeGreaterThan(20000);
    expect(off).toBe(0);
  });

  it('a value past FIELD_EMAX is stored at the ceiling and counted (stats.cubeClipped); a bake within it counts none', () => {
    // rows with one very bright face: every third voxel's up-facing face is 3 x the range in red and green, half of it in blue
    const big = FIELD_EMAX * 3;
    const b = bakeRows(cubeRoom(false), count => {
      const d = new Float32Array(count * IND_STRIDE);
      for (let v = 0; v < count; v += 3) { d[v * IND_STRIDE] = big; d[v * IND_STRIDE + 1] = big; d[v * IND_STRIDE + 2] = FIELD_EMAX * 0.5; }
      return d;
    });
    const c = checkCube(b), f = b.field;
    expect(c.wrong).toBe(0);
    expect(c.clipped).toBe(Math.ceil(b.count / 3) * 2); // (two channels of one face of every third voxel)
    expect(c.clipped).toBeGreaterThan(500);
    expect(f.stats.cubeClipped).toBe(c.clipped);
    // at the ceiling: 255, and only in the red and green of those texels
    let top = 0, topBlue = 0;
    for (let o = f.gi! * f.w * f.h * 4; o < f.data.length; o += 4) { if (f.data[o] === 255 && f.data[o + 1] === 255) top++; if (f.data[o + 2] === 255) topBlue++; }
    expect(top).toBe(c.clipped / 2);
    expect(topBlue).toBe(0);
    // the pattern rows stay inside
    const ok = bakeRows(cubeRoom(), patternRows());
    expect(checkCube(ok).clipped).toBe(0);
    expect(ok.field.stats.cubeClipped).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('sampling with a normal', () => {
  /** Half a step of the main texel's colour byte at T (square-root spaced to FIELD_EMAX). */
  const colourStep = (T: number): number => (Math.sqrt(FIELD_EMAX * Math.max(T, 0)) + 0.04) / 255;

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
          if (t.ambient[face].some(v => v > FIELD_EMAX)) continue;
          const sm = atPoint(f, p, CUBE_FACES[face]);
          for (let c = 0; c < 3; c++) {
            checked++;
            if (sm.amb[c] < 0) negative++;
            // (the cube's own 8-bit step and nothing else: the main texel's colour and share are not part of it)
            const err = Math.abs(sm.amb[c] - t.ambient[face][c]), tol = cubeHalfStep(t.ambient[face][c]) + 1e-9;
            worst = Math.max(worst, err / tol);
            if (err > tol) off++;
          }
          // a strong, directional direct light and a coloured face: where one share for three channels would cost the colour
          if (t.rho > 0.7 && t.el > 0.3) strong++;
          // the directional part is the main texel's, as without the cube: it has the luminance of the direct light's directional
          // part and the colour of the main texel (T x rho, not E x dl / el — what is left of the one-share split sits here)
          if (face === 0 && t.el > 0.05 && !t.T.some(v => v > FIELD_EMAX)) {
            dirChecked++;
            const want = t.T.map(v => v * t.rho), tolD = (c: number) => (colourStep(t.T[c]) + t.T[c] * 0.5 / 255) * 1.02 + 1e-6;
            if ([0, 1, 2].some(c => Math.abs(sm.dirColor[c] - want[c]) > tolD(c))) dirOff++;
            if (Math.abs(lum3(sm.dirColor) - t.dl) > tolD(0) + tolD(1) + tolD(2)) dirOff++;
          }
        }
      }
      console.log(`${name}: ${checked} channels at voxel centres, worst error ${(worst * 100).toFixed(0)} % of the cube's half step; ${strong} face samples under a strong directional light`);
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
      const sm = atPoint(f, p, CUBE_FACES[away]);
      checked++;
      // the white light's scatter adds the same to every channel: the gathered light's red excess (r - g) arrives whole
      if (!(sm.amb[0] - sm.amb[1] > (red[0] - red[1]) * 0.8)) cast++;
      // the plain sample (no normal: the main texel alone) has lost most of it to the directional part — what the cube is for
      const plain = sampleField(f, p[0], p[1], p[2]).amb;
      if (plain[0] - plain[1] < (red[0] - red[1]) * 0.3) plainCast++;
    }
    expect(checked).toBeGreaterThan(300);
    expect(cast).toBe(0);
    expect(plainCast).toBe(checked);
  });

  it('never negative, whatever the normal and wherever the sample; the cube stands in for the main texel\'s ambient part, weighted by the squares of the normal\'s components', () => {
    const b = bakeRows(threeLevels(), patternRows(2.5, 3)), f = b.field, rnd = sequence(99);
    const W = f.w * CELL, D = f.h * CELL;
    let negative = 0, combined = 0, off = 0, notPlain = 0;
    for (let q = 0; q < 6000; q++) {
      const p: V3 = [rnd() * W, FIX.lowerY - 0.5 + rnd() * (FIX.upperCeil - FIX.lowerY + 1), rnd() * D];
      const v: V3 = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1], l = Math.hypot(v[0], v[1], v[2]) || 1;
      // (some normals with a zero component, some along one axis)
      const nrm: V3 = q % 7 === 0 ? [0, v[1] < 0 ? -1 : 1, 0] : q % 5 === 0 ? [v[0] / Math.hypot(v[0], v[2]), 0, v[2] / Math.hypot(v[0], v[2])] : [v[0] / l, v[1] / l, v[2] / l];
      const sm = sampleField(f, p[0], p[1], p[2], [1, 1, 1], nrm);
      if (sm.amb.some(c => !(c >= 0)) || sm.dirColor.some(c => !(c >= 0))) negative++;
      // the same lookup position read with each axis normal: amb(n) = sum over the axes of n_a^2 x amb(the axis face n points at)
      const P: V3 = [p[0] + nrm[0] * CELL * 0.5, p[1] + nrm[1] * 0.2, p[2] + nrm[2] * CELL * 0.5];
      const want: V3 = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        if (nrm[a] === 0) continue;
        const ax: V3 = [0, 0, 0]; ax[a] = nrm[a] > 0 ? 1 : -1;
        const one = atPoint(f, P, ax).amb;
        for (let c = 0; c < 3; c++) want[c] += nrm[a] * nrm[a] * one[c];
      }
      combined++;
      if ([0, 1, 2].some(c => Math.abs(sm.amb[c] - want[c]) > 1e-9 + want[c] * 1e-9)) off++;
      // …and nothing of the main texel's ambient part is left in it (the plain sample of the same place)
      const plain = sampleField(f, P[0], P[1], P[2]).amb;
      if ([0, 1, 2].some(c => Math.abs(sm.amb[c] - plain[c]) > 1e-6)) notPlain++;
    }
    expect(negative).toBe(0);
    expect(combined).toBe(6000);
    expect(off).toBe(0);
    expect(notPlain).toBeGreaterThan(2000);
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
    // one multiplier for the whole voxel: ambient (the cube's) and directional parts keep their proportion
    const m = lum3(off.dirColor) / lum3(on.dirColor);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1);
    for (let c = 0; c < 3; c++) expect(off.amb[c]).toBeCloseTo(on.amb[c] * m, 9);
    expect(lum3(plain.dirColor)).toBeCloseTo(lum3(off.dirColor), 9);
  });
});

// ---------------------------------------------------------------------------------------------
describe('between two layers', () => {
  /** Cells whose own column and eight neighbours are open on every layer of the slot (no closed cell in any filtered fetch there). */
  function interior(b: RowBake, slot: number): number[] {
    const W = b.ctx.W, H = b.ctx.H, L = b.ctx.layers[slot], ix = b.index[slot], out: number[] = [];
    for (let cz = 1; cz < H - 1; cz++) for (let cx = 1; cx < W - 1; cx++) {
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) for (let k = 0; k < L; k++) if (ix[((cz + dz) * W + cx + dx) * L + k] < 0) { ok = false; break; }
      if (ok) out.push(cz * W + cx);
    }
    return out;
  }
  /** The point `w` of the way from layer k to layer k + 1 over the centre of cell i (null: one of the two heights picks another slot). */
  function between(f: BakedField, b: RowBake, slot: number, i: number, k: number, w: number): V3 | null {
    const p0 = voxelCentre(f, b, slot, i, k), p1 = voxelCentre(f, b, slot, i, k + 1);
    if (!p0 || !p1) return null;
    const y = p0[1] + (p1[1] - p0[1]) * w, cx = i % f.w, cz = (i - cx) / f.w;
    return fieldSlot(f, cx, cz, y).slot === slot ? [p0[0], y, p0[2]] : null;
  }

  it('a face is ONE filtered value, decoded after the blend: dec(mix(byte below, byte above)) — never above the blend of the two layers, never below the darker one', () => {
    const b = bakeRows(threeLevels(), patternRows(1.2, 11)), f = b.field;
    let checked = 0, off = 0, above = 0, below = 0, gap = 0;
    for (let s = 0; s < f.slots; s++) {
      const L = slotLayers(s);
      for (const i of interior(b, s)) for (let k = 0; k < L - 1; k++) for (const w of [0.25, 0.5, 0.8]) {
        const p = between(f, b, s, i, k, w);
        if (!p) continue;
        // (the sampler's own position between the layers: its 8-bit floor and ceiling are not exactly the voxels')
        const hs = fieldSlot(f, i % f.w, Math.floor(i / f.w), p[1]), wk = (p[1] - hs.floor) / Math.max(hs.ceil - hs.floor, 0.3) * (L - 1) - k;
        for (let face = 0; face < GI_FACES; face++) {
          const sm = atPoint(f, p, CUBE_FACES[face]), o0 = cubeAt(f, s, face, k, i), o1 = cubeAt(f, s, face, k + 1, i);
          for (let c = 0; c < 3; c++) {
            const b0 = f.data[o0 + c], b1 = f.data[o1 + c], v0 = cubeAmbient(b0), v1 = cubeAmbient(b1);
            checked++;
            if (Math.abs(sm.amb[c] - cubeAmbient(b0 + (b1 - b0) * wk)) > 1e-9) off++;
            if (sm.amb[c] > v0 + (v1 - v0) * wk + 1e-9) above++;
            if (sm.amb[c] < Math.min(v0, v1) - 1e-9) below++;
            if (v0 + (v1 - v0) * wk - sm.amb[c] > 1e-3) gap++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50000);
    expect([off, above, below]).toEqual([0, 0, 0]);
    expect(gap).toBeGreaterThan(1000); // (these rows differ a lot from layer to layer: the blend of the bytes is really below the blend of the values)
  });

  // The guard of the encoding. A cube texel holds a face's COMPLETE ambient, so the two layers of a face hold nearly the same value in
  // a real station and decoding after the blend costs next to nothing. (An earlier encoding stored each face as a signed difference
  // to the main texel's share, which changes from layer to layer: halfway between two layers a wall's ambient was 10 to 16 % off on
  // average, and more than 20 % off on a fifth of the walls.)
  it('Subway 93 as the game bakes it: halfway between two layers the shaded ambient is the blend of the two layers\' exact values, within a few per cent', () => {
    const input = stationBakeInput(generateStation(93));
    const b = bakeRows(input.source, gatheredRows(input.source, GI_TIERS.standard), {params: input.params}), f = b.field;
    expect(f.gi).toBeDefined();
    interface Acc { n: number; abs: number; signed: number; over10: number; over20: number; worst: number }
    const groups = new Map<string, Acc>();
    const add = (key: string, e: number) => {
      let a = groups.get(key);
      if (!a) groups.set(key, (a = {n: 0, abs: 0, signed: 0, over10: 0, over20: 0, worst: 0}));
      a.n++; a.abs += Math.abs(e); a.signed += e;
      if (Math.abs(e) > 0.1) a.over10++;
      if (Math.abs(e) > 0.2) a.over20++;
      if (Math.abs(e) > Math.abs(a.worst)) a.worst = e;
    };
    let above = 0;
    for (let s = 0; s < f.slots; s++) {
      const L = slotLayers(s);
      for (const i of interior(b, s)) for (let k = 0; k < L - 1; k++) {
        const t0 = voxelTerms(b, s, i, k)!, t1 = voxelTerms(b, s, i, k + 1)!;
        const p = between(f, b, s, i, k, 0.5);
        if (!p) continue;
        const gapName = k === 0 ? 'bottom gap' : k === L - 2 ? 'top gap' : 'middle gap';
        for (let face = 0; face < GI_FACES; face++) {
          // the linear blend of the two layers' exact values (before any byte), and what full shading shows there
          const want = 0.5 * (lum3(t0.ambient[face]) + lum3(t1.ambient[face]));
          if (want < 0.01) continue; // (too dark for a share of it to mean anything: under a hundredth of a lit floor)
          const got = lum3(atPoint(f, p, CUBE_FACES[face]).amb), e = (got - want) / want;
          add('all', e);
          add(`${gapName}, ${face === 0 ? 'up-facing' : face === 1 ? 'down-facing' : 'walls'}`, e);
          // decoding after the blend can only lose light (the encoding is concave) — beyond the bytes' own rounding
          if (got > want + cubeHalfStep(lum3(t0.ambient[face])) + cubeHalfStep(lum3(t1.ambient[face]))) above++;
        }
      }
    }
    const pc = (v: number) => `${(v * 100).toFixed(2)} %`;
    const line = (k: string, a: Acc) => `${k}: ${a.n} samples, mean |error| ${pc(a.abs / a.n)}, signed ${pc(a.signed / a.n)}, over 10 % off ${pc(a.over10 / a.n)}, over 20 % off ${pc(a.over20 / a.n)}, worst ${pc(a.worst)}`;
    console.log(`Subway 93 (standard bake, ${f.w} x ${f.h}, ${f.slots} slots, ${f.stats.cubeClipped} cube channels clipped), halfway between two layers:\n  ${[...groups].sort((x, y) => x[0].localeCompare(y[0])).map(([k, a]) => line(k, a)).join('\n  ')}`);
    // Measured 2026-11-15 (the absolute cube): all 1.95 % mean |error|, signed -1.41 %, 0.48 % of the samples over 20 % off; the worst
    // group (up-facing surfaces in the top gap: the top of something just under a ceiling) 3.79 % and 2.83 %. The bounds leave room
    // for a retuned gather, not for an encoding whose layers disagree.
    const all = groups.get('all')!;
    expect(all.n).toBeGreaterThan(50000);
    expect(above).toBe(0);
    expect(all.signed / all.n).toBeLessThanOrEqual(0);
    expect(all.abs / all.n).toBeLessThan(0.03);
    expect(all.over20 / all.n).toBeLessThan(0.01);
    for (const [k, a] of groups) {
      expect(a.n, k).toBeGreaterThan(1000);
      expect(a.signed / a.n, k).toBeLessThanOrEqual(0);
      expect(a.abs / a.n, k).toBeLessThan(0.06);
      expect(a.over20 / a.n, k).toBeLessThan(0.05);
    }
  }, 120000);
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

  it('a uniform cube stays uniform: nothing stays nothing, and a field of one gathered light reads the same at half resolution', () => {
    // no light at all (no fixture, nothing gathered): every cube byte's rgb is 0 before and after
    const dark = bakeRows(cubeRoom(false), uniformRows([])).field, dd = downsampleField(dark, 2);
    for (const f of [dark, dd]) {
      let set = 0;
      for (let o = f.gi! * f.w * f.h * 4; o < f.data.length; o += 4) if (f.data[o] !== 0 || f.data[o + 1] !== 0 || f.data[o + 2] !== 0) set++;
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
        // (within the cube byte's own step)
        for (let c = 0; c < 3; c++) { const want = faces[face] * (1 + 0.1 * c); expect(Math.abs(sm.amb[c] - want)).toBeLessThan(cubeHalfStep(want) * 1.01); }
        expect(sm.dirColor).toEqual([0, 0, 0]);
      }
    }
  });
});
