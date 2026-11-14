// Task studio-baked-lighting-reflections-20261114-050258-01: the ENHANCED light-field bake (world/lightFieldGather.ts,
// world/lightScene.ts, world/surfaceAlbedo.ts; FieldSource.indirect in world/lightField.ts).
// - without the hook the bake is the baseline, before and after an enhanced bake ran (Enhanced lighting Off = today's field);
// - bounced light is OCCLUDED by the architecture: nothing behind a sealed wall, less the further round a corner, and an alcove
//   that hides from every lit surface is darker than the open floor next to it — where the baseline's fill spreads one area's mean
//   everywhere in it;
// - bounced light takes the COLOUR of what it left (a red floor reddens the unlit ceiling), and no more energy than the surfaces
//   send back (a black room bounces nothing; a generated station's mean light stays what it was: no extra flat ambient);
// - a floor is not lit by its own bounce and the ceiling above it gets it (the field's bottom / top layers store what those surfaces
//   receive), while the field's one direction stays the direct light's, byte for byte (no bounce-steered veins on ceilings);
// - the three flicker circuits keep their share of the bounce (a circuit that is off takes its bounce with it);
// - nothing movable is in the ray scene (a cell holding a sight-blocking prop is open space to it);
// - deterministic, and independent of how the build is sliced; the standard tier's lattice + fill stays close to gathering everywhere.
import {describe, expect, it} from 'vitest';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {generateStation, type StationLayout} from '../src/gen/station';
import {stationLevels} from '../src/world/levelGeometry';
import {GI_TIERS, type GiTier} from '../src/world/enhancedLighting';
import {bakeLightField, bakeLightFieldSteps, fixtureGroup, sampleField, slotBase, slotLayers, type BakedField, type FieldSource} from '../src/world/lightField';
import {GATHER_GAIN, GATHER_REACH, IND_STRIDE, gatherIndirectSteps, indirectIndex, type IndirectContext, type IndirectLight} from '../src/world/lightFieldGather';
import {BandScene, HIT_CEIL, HIT_FLOOR, HIT_WALL, sphereDirections} from '../src/world/lightScene';
import {ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, surfaceAlbedo, type DrawnSurfaces, type SurfaceAlbedo} from '../src/world/surfaceAlbedo';
import type {BuildSteps} from '../src/core/pacedBuild';

const lum = (v: readonly number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
/** Irradiance reaching a surface with normal n (what the shader computes before the BRDF). */
function irr(f: BakedField, x: number, y: number, z: number, n: [number, number, number] = [0, 1, 0], levels = [1, 1, 1]): number {
  const s = sampleField(f, x, y, z, levels, n);
  const ndl = Math.max(0, n[0] * s.dir[0] + n[1] * s.dir[1] + n[2] * s.dir[2]);
  return lum(s.amb) + lum(s.dirColor) * ndl;
}

/** w x h grid, solid border, everything else FLOOR with ceiling `ceil`. */
function box(w: number, h: number, ceil = 4.4): Grid {
  const g = new Grid(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { g.set(x, y, FLOOR); g.ceil[y * w + x] = ceil; g.area[y * w + x] = 0; }
  return g;
}
const light = (x: number, z: number, o: Partial<FieldSource['lights'][number]> = {}) => ({x, y: 4.35, z, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false, ...o});
const wall = (g: Grid, x: number, y0 = 0, y1 = g.h) => { for (let y = y0; y < y1; y++) g.set(x, y, SOLID); };

interface Enhanced { field: BakedField; ind: IndirectLight; ctx: IndirectContext; albedo: SurfaceAlbedo }
/** The enhanced bake of a source: the gather of `tier` over neutral (or painted) surface colours. */
function enhanced(src: FieldSource, tier: GiTier = GI_TIERS.standard, paint?: (a: SurfaceAlbedo) => void, drawn: DrawnSurfaces | null = null): Enhanced {
  const out: Partial<Enhanced> = {};
  out.field = bakeLightField({
    ...src,
    indirect: function* (ctx): BuildSteps<IndirectLight> {
      const levels = src.levels ?? [{id: 0, role: 'main' as const, grid: src.grid, baseY: 0}];
      const albedo = surfaceAlbedo(ctx.W, ctx.H, levels, ctx.geos, drawn);
      paint?.(albedo);
      out.ctx = ctx; out.albedo = albedo;
      return (out.ind = yield* gatherIndirectSteps(ctx, {rays: tier.rays, bounces: tier.bounces, stride: tier.stride, reach: GATHER_REACH, gain: GATHER_GAIN, albedo}));
    },
  });
  return out as Enhanced;
}
/** The gathered (bounced) light's luminance at a point, straight from the gather's float rows (the field's bytes quantise it). */
function gathered(e: Enhanced, x: number, y: number, z: number, slot = 0): number {
  const W = e.ctx.W, i = Math.floor(z / 0.5) * W + Math.floor(x / 0.5), L = e.ctx.layers[slot], ly = e.ctx.geos[slot].layerY;
  let k = 0;
  for (let q = 1; q < L; q++) if (Math.abs(ly[i * L + q] - y) < Math.abs(ly[i * L + k] - y)) k = q;
  const row = e.ind.index[slot][i * L + k];
  if (row < 0) return 0;
  const d = e.ind.data, o = row * IND_STRIDE;
  return lum([d[o], d[o + 1], d[o + 2]]);
}
const fillAlbedo = (a: SurfaceAlbedo, off: number, rgb: readonly [number, number, number]) => {
  for (const s of a.slots) for (let o = 0; o < s.length; o += ALBEDO_STRIDE) { s[o + off] = Math.round(Math.sqrt(rgb[0]) * 255); s[o + off + 1] = Math.round(Math.sqrt(rgb[1]) * 255); s[o + off + 2] = Math.round(Math.sqrt(rgb[2]) * 255); }
};
const src = (l: StationLayout): FieldSource => ({grid: l.grid, lights: l.lights, trenchFloorY: l.trench.floorY, levels: stationLevels(l)});
const same = (a: Uint8Array | Float32Array, b: Uint8Array | Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

// ---------------------------------------------------------------------------------------------
describe('the ray scene (fixed architecture only)', () => {
  it('rays hit floors, ceilings and wall faces of the field\'s own bands; a doorway passes; a lintel stops what is above it', () => {
    const g = box(40, 20);
    wall(g, 20);
    for (let y = 8; y < 12; y++) { g.set(20, y, FLOOR); g.ceil[y * g.w + 20] = 2.1; }
    const e = enhanced({grid: g, lights: [light(5, 5)], trenchFloorY: -1.15});
    const sc = new BandScene(e.ctx.W, e.ctx.H, e.ctx.geos);
    // straight down / up
    expect(sc.trace(5, 1.5, 5, 0, -1, 0, 20)).toBe(true);
    expect([sc.hitKind, +sc.hitT.toFixed(3)]).toEqual([HIT_FLOOR, 1.5]);
    expect(sc.trace(5, 1.5, 5, 0, 1, 0, 20)).toBe(true);
    expect([sc.hitKind, +sc.hitT.toFixed(3)]).toEqual([HIT_CEIL, 2.9]);
    // +x into the dividing wall (its face is at x = 10 m), away from the door
    expect(sc.trace(5, 1.5, 2, 1, 0, 0, 30)).toBe(true);
    expect([sc.hitKind, +sc.hitT.toFixed(3), sc.hitNx, sc.hitNz]).toEqual([HIT_WALL, 5, -1, 0]);
    // through the door at head height: on to the far wall of the next room (x = 19.5 m)
    expect(sc.trace(5, 1.5, 5, 1, 0, 0, 30)).toBe(true);
    expect([sc.hitKind, +sc.hitT.toFixed(3)]).toEqual([HIT_WALL, 14.5]);
    // above the lintel (2.1 m): stopped at the wall
    expect(sc.trace(5, 3, 5, 1, 0, 0, 30)).toBe(true);
    expect([sc.hitKind, +sc.hitT.toFixed(3)]).toEqual([HIT_WALL, 5]);
    // a ray that ends in free space reports no hit
    expect(sc.trace(5, 1.5, 5, 1, 0, 0, 3)).toBe(false);
  });

  it('a cell holding a sight-blocking prop is open space: nothing movable is in the scene or in what is gathered', () => {
    const g = box(30, 20);
    const e = enhanced({grid: g, lights: [light(4, 5)], trenchFloorY: -1.15});
    const geos = e.ctx.geos.map(q => ({...q, open: Uint8Array.from(q.open)}));
    // a row of "props" (open = 2) across the room
    for (let y = 1; y < 19; y++) geos[0].open[y * 30 + 15] = 2;
    const a = new BandScene(30, 20, e.ctx.geos), b = new BandScene(30, 20, geos);
    expect(same(a.f, b.f) && same(a.c, b.c)).toBe(true);
    expect(b.trace(2, 1, 5, 1, 0, 0, 30)).toBe(true);
    expect(+b.hitT.toFixed(3)).toBe(12.5); // the far wall, not the prop row at 7.5 m
    let ind: IndirectLight | null = null;
    const steps = gatherIndirectSteps({...e.ctx, geos}, {rays: 16, bounces: 3, stride: 2, reach: GATHER_REACH, gain: GATHER_GAIN, albedo: e.albedo});
    for (let r = steps.next(); ; r = steps.next()) if (r.done) { ind = r.value; break; }
    expect(same(ind!.data, e.ind.data)).toBe(true);
  });

  it('sphere directions are unit, cover both hemispheres evenly and are the same every call', () => {
    const d = sphereDirections(64);
    let sx = 0, sy = 0, sz = 0, up = 0;
    for (let i = 0; i < 64; i++) { const x = d[i * 3], y = d[i * 3 + 1], z = d[i * 3 + 2]; expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5); sx += x; sy += y; sz += z; if (y > 0) up++; }
    expect(Math.hypot(sx, sy, sz) / 64).toBeLessThan(0.05);
    expect(up).toBe(32);
    expect(same(d, sphereDirections(64))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('occlusion (synthetic rooms)', () => {
  /** Two rooms (A: x < 15 m, B beyond) with one light in A at (5.5, 6). */
  const rooms = (door: boolean): FieldSource => {
    const g = box(60, 24);
    wall(g, 30);
    for (let y = 0; y < g.h; y++) for (let x = 31; x < 59; x++) if (g.get(x, y) === FLOOR) g.area[y * g.w + x] = 1;
    if (door) for (let y = 10; y < 14; y++) { g.set(30, y, FLOOR); g.ceil[y * g.w + 30] = 4.4; }
    return {grid: g, lights: [light(11, 6)], trenchFloorY: -1.15};
  };

  it('nothing bounces through a sealed wall; a door lets the bounce in, fading round the corner — but never to nothing', () => {
    const sealed = enhanced(rooms(false));
    expect(irr(sealed.field, 16, 0.02, 6)).toBe(0);
    expect(irr(sealed.field, 25, 2, 3, [-1, 0, 0])).toBe(0);
    expect(gathered(sealed, 16, 1, 6)).toBe(0);
    expect(gathered(sealed, 25, 1, 3)).toBe(0);
    expect(irr(sealed.field, 10, 0.02, 6)).toBeGreaterThan(0.3);
    const open = enhanced(rooms(true));
    expect(irr(open.field, 17, 0.02, 6)).toBeGreaterThan(0.01); // in line with the door: direct light
    // the gathered (bounced) light itself, as floats: beside the door, further along the wall, the far corner
    const near = gathered(open, 16.5, 1, 9), mid = gathered(open, 19, 1, 10.5), far = gathered(open, 27, 1, 2);
    console.log(`bounce past the door: beside it ${near.toExponential(2)}, along the wall ${mid.toExponential(2)}, far corner ${far.toExponential(2)}; room A ${gathered(open, 8, 1, 9).toExponential(2)}`);
    expect(near).toBeGreaterThan(0);
    expect(mid).toBeLessThan(near);
    expect(far).toBeLessThan(mid); // further from the door, round the corner
    expect(far).toBeGreaterThan(0); // several bounces reach it
    expect(gathered(open, 8, 1, 9)).toBeGreaterThan(near * 5); // the lit room itself
  });

  it('an alcove that hides from the lit room is darker than the open floor beside it; the baseline fill cannot tell them apart', () => {
    // one room (one area), a light towards its west end; near the east end a closet: three walls, its mouth facing EAST (away from the light)
    const g = box(60, 24);
    for (let x = 40; x <= 46; x++) { g.set(x, 8, SOLID); g.set(x, 16, SOLID); }
    for (let y = 8; y <= 16; y++) g.set(40, y, SOLID);
    const s: FieldSource = {grid: g, lights: [light(13, 6)], trenchFloorY: -1.15};
    const base = bakeLightField(s), e = enhanced(s);
    // inside the closet (x 21.5 m, z 6 m) and on the open floor south of it at the same distance from the light (x 21.5, z 10)
    const inB = irr(base, 21.5, 0.02, 6), outB = irr(base, 21.5, 0.02, 10);
    const inE = gathered(e, 21.5, 1, 6), outE = gathered(e, 21.5, 1, 10);
    console.log(`alcove / open floor: baseline fill ${inB.toFixed(4)} / ${outB.toFixed(4)} = ${(inB / outB).toFixed(3)}, gathered ${inE.toExponential(2)} / ${outE.toExponential(2)} = ${(inE / outE).toFixed(3)}`);
    expect(outE).toBeGreaterThan(0);
    expect(inE).toBeGreaterThan(0);
    expect(inE / outE).toBeLessThan(0.6);
    // the baseline's fill is one area's mean: the same in the closet as outside it
    expect(inB / outB).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------------------------
describe('material colour and energy', () => {
  const room = (): FieldSource => ({grid: box(30, 24), lights: [light(7.5, 6)], trenchFloorY: -1.15});

  it('a red floor reddens what its bounce lights (the ceiling above the fixtures); a neutral one does not', () => {
    const neutral = enhanced(room(), GI_TIERS.high, a => { fillAlbedo(a, ALB_FLOOR, [0.5, 0.5, 0.5]); fillAlbedo(a, ALB_WALL, [0.5, 0.5, 0.5]); fillAlbedo(a, ALB_CEIL, [0.5, 0.5, 0.5]); });
    const red = enhanced(room(), GI_TIERS.high, a => { fillAlbedo(a, ALB_FLOOR, [0.7, 0.08, 0.06]); fillAlbedo(a, ALB_WALL, [0.5, 0.5, 0.5]); fillAlbedo(a, ALB_CEIL, [0.5, 0.5, 0.5]); });
    // what a ceiling facing down receives at the room's far end
    const up = (f: BakedField) => { const s = sampleField(f, 12, 4.3, 9, [1, 1, 1], [0, -1, 0]); const k = Math.max(0, -s.dir[1]); return [s.amb[0] + s.dirColor[0] * k, s.amb[1] + s.dirColor[1] * k, s.amb[2] + s.dirColor[2] * k]; };
    const n = up(neutral.field), r = up(red.field);
    console.log(`ceiling light: neutral floor rgb ${n.map(v => v.toFixed(4))}, red floor rgb ${r.map(v => v.toFixed(4))}`);
    expect(n[0] / n[1]).toBeGreaterThan(0.7);
    expect(n[0] / n[1]).toBeLessThan(1.3);
    expect(r[0] / r[1]).toBeGreaterThan((n[0] / n[1]) * 1.35);
    expect(r[1]).toBeLessThan(n[1]); // the red floor sends back less green than the grey one
  });

  it('a floor is not lit by its own bounce, the ceiling above it gets it; and the field\'s direction stays the direct light\'s, texel for texel', () => {
    // only the floor sends light back (walls and ceiling black): one bounce, floor -> everything else
    const only = (floor: readonly [number, number, number]) => enhanced(room(), GI_TIERS.high, a => { fillAlbedo(a, ALB_FLOOR, floor); fillAlbedo(a, ALB_WALL, [0, 0, 0]); fillAlbedo(a, ALB_CEIL, [0, 0, 0]); });
    const black = only([0, 0, 0]), lit = only([0.7, 0.7, 0.7]);
    const rows: string[] = [];
    for (const [x, z] of [[7.5, 6], [10, 8], [4, 3]] as const) {
      const f0 = irr(black.field, x, 0.02, z), f1 = irr(lit.field, x, 0.02, z);
      const c0 = irr(black.field, x, 4.38, z, [0, -1, 0]), c1 = irr(lit.field, x, 4.38, z, [0, -1, 0]);
      const mid = gathered(lit, x, 2.2, z);
      rows.push(`(${x}, ${z}) floor ${f0.toFixed(3)} -> ${f1.toFixed(3)}, ceiling ${c0.toFixed(3)} -> ${c1.toFixed(3)}, gathered mean at mid height ${mid.toFixed(3)}`);
      // the floor: the direct light, and next to nothing of its own bounce (the sphere mean alone would add about a third of it)
      expect(f1).toBeGreaterThanOrEqual(f0 * 0.999);
      expect(f1).toBeLessThan(f0 * 1.1);
      // the ceiling: clearly more than the mid-height mean (a ceiling faces the floor; the mean looks at the black ceiling too)
      expect(c1 - c0).toBeGreaterThan(mid * 1.3);
    }
    console.log(`floor-only bounce: ${rows.join('; ')}`);
    // the direction slices of the enhanced field are the baseline's bytes (xyz of every layer of every slot)
    const base = bakeLightField(room()), e = lit.field;
    expect([e.w, e.h, e.depth, e.slots]).toEqual([base.w, base.h, base.depth, base.slots]);
    const n = e.w * e.h;
    let differ = 0, lit3 = 0;
    for (let s = 0; s < e.slots; s++) for (let k = 0; k < slotLayers(s); k++) {
      const b = (slotBase(s) + 2 + 2 * k) * n * 4;
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
        if (e.data[b + i * 4 + c] !== base.data[b + i * 4 + c]) differ++;
        if (c !== 1 && base.data[b + i * 4 + c] !== 128) lit3++;
      }
    }
    expect(lit3).toBeGreaterThan(1000); // (real directions were compared, not a field of defaults)
    expect(differ).toBe(0);
  });

  it('black surfaces bounce nothing: the field is the direct light alone; brighter surfaces bounce more', () => {
    const black = enhanced(room(), GI_TIERS.standard, a => { for (const o of [ALB_FLOOR, ALB_WALL, ALB_CEIL]) fillAlbedo(a, o, [0, 0, 0]); });
    expect(black.ind.stats.mean).toBe(0);
    expect(black.ind.data.every(v => v === 0)).toBe(true);
    const dim = enhanced(room(), GI_TIERS.standard, a => { for (const o of [ALB_FLOOR, ALB_WALL, ALB_CEIL]) fillAlbedo(a, o, [0.2, 0.2, 0.2]); });
    const bright = enhanced(room(), GI_TIERS.standard, a => { for (const o of [ALB_FLOOR, ALB_WALL, ALB_CEIL]) fillAlbedo(a, o, [0.7, 0.7, 0.7]); });
    expect(dim.ind.stats.mean).toBeGreaterThan(0);
    // more than the albedo ratio: the later bounces compound
    expect(bright.ind.stats.mean).toBeGreaterThan(dim.ind.stats.mean * 3.5);
    // a shadowed spot (under nothing: the far corner's wall, facing away from the light) is lit by the bounce only
    const corner = (f: BakedField) => irr(f, 14.2, 2, 11.2, [1, 0, 0]);
    expect(corner(black.field)).toBeLessThan(corner(dim.field));
    expect(corner(dim.field)).toBeLessThan(corner(bright.field));
  });

  it('a generated station keeps its overall light: the bounce is redistributed by the architecture, not added as flat ambient', () => {
    const l = generateStation(11), s = src(l);
    const base = bakeLightField(s), e = enhanced(s);
    // mean stored irradiance over the open voxels of the main level (the bytes the shader reads: sqrt-encoded rgb)
    const mean = (f: BakedField) => {
      let sum = 0, n = 0;
      const g = l.grid;
      for (let cz = 2; cz < g.h; cz += 3) for (let cx = 2; cx < g.w; cx += 3) {
        if (g.get(cx, cz) === SOLID) continue;
        const sm = sampleField(f, (cx + 0.5) * 0.5, g.floor[cz * g.w + cx] + 1.2, (cz + 0.5) * 0.5);
        sum += lum(sm.amb) + lum(sm.dirColor); n++;
      }
      return sum / n;
    };
    const mb = mean(base), me = mean(e.field);
    console.log(`station 11 mean light at 1.2 m: baseline ${mb.toFixed(4)}, enhanced ${me.toFixed(4)} (${(me / mb).toFixed(3)}x); gather ${JSON.stringify(e.ind.stats)}`);
    expect(me / mb).toBeGreaterThan(0.8);
    expect(me / mb).toBeLessThan(1.15);
    expect(same(e.field.data, base.data)).toBe(false);
    // same format: dimensions, slots, header layout
    expect([e.field.w, e.field.h, e.field.depth, e.field.slots, e.field.layers]).toEqual([base.w, base.h, base.depth, base.slots, base.layers]);
    expect(e.field.stats.indirect?.voxels).toBe(e.ind.stats.voxels);
    expect(base.stats.indirect).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
describe('flicker circuits', () => {
  it('a flickering fixture\'s bounce follows its circuit: off with it, and a steady fixture\'s bounce stays', () => {
    // two rooms joined by a door; a steady light in A, a flickering one in B
    const g = box(60, 24);
    wall(g, 30);
    for (let y = 10; y < 14; y++) { g.set(30, y, FLOOR); g.ceil[y * g.w + 30] = 4.4; }
    const lights = [light(6, 6), light(24, 6, {flicker: true})];
    const e = enhanced({grid: g, lights, trenchFloorY: -1.15});
    const c = fixtureGroup(lights[1], 1);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(e.field.groups[0]).toBe(-1);
    const off = [1, 1, 1]; off[c] = 0;
    // a wall of room B that faces away from its light (the light is at x 24; the dividing wall's B side faces +x: lit from the east) —
    // take the spot behind a view of neither light directly: the north-east corner's ceiling-facing sample
    const p: [number, number, number] = [28.5, 2, 11.2];
    const nrm: [number, number, number] = [1, 0, 0]; // facing east: away from both lights (the flickering one is to the west of it)
    const on = irr(e.field, ...p, nrm), dark = irr(e.field, ...p, nrm, off);
    console.log(`room B back wall: circuits on ${on.toFixed(4)}, its circuit off ${dark.toFixed(4)}`);
    expect(on).toBeGreaterThan(0);
    expect(dark).toBeLessThan(on * 0.35); // what is left came from room A through the door
    // room A, out of the door's line: the steady light's bounce does not flicker
    const a: [number, number, number] = [3, 2, 11.2];
    const an: [number, number, number] = [-1, 0, 0];
    expect(irr(e.field, ...a, an, off)).toBeGreaterThan(irr(e.field, ...a, an) * 0.9);
  });
});

// ---------------------------------------------------------------------------------------------
describe('determinism', () => {
  it('two bakes are identical; so is one stepped a step at a time with other work between (the paced build)', () => {
    const l = generateStation(4), s = src(l);
    const a = enhanced(s), b = enhanced(s);
    expect(same(a.field.data, b.field.data)).toBe(true);
    expect(same(a.ind.data, b.ind.data)).toBe(true);
    // stepped: the bake as build steps with the gather inside, a little unrelated allocation between steps
    let ind: IndirectLight | null = null;
    const steps = bakeLightFieldSteps({
      ...s,
      indirect: function* (ctx): BuildSteps<IndirectLight> {
        const albedo = surfaceAlbedo(ctx.W, ctx.H, s.levels!, ctx.geos, null);
        return (ind = yield* gatherIndirectSteps(ctx, {rays: 16, bounces: 3, stride: 2, reach: GATHER_REACH, gain: GATHER_GAIN, albedo}));
      },
    });
    let n = 0, junk = 0;
    let r = steps.next();
    while (!r.done) { n++; junk += new Float32Array(64).length; r = steps.next(); }
    expect(junk).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(20);
    expect(same(r.value.data, a.field.data)).toBe(true);
    expect(same(ind!.data, a.ind.data)).toBe(true);
    // and the baseline is what it was before any enhanced bake ran
    const base1 = bakeLightField(s), base2 = bakeLightField({...s, indirect: undefined});
    expect(same(base1.data, base2.data)).toBe(true);
  });

  it('the index is the plain enumeration of the open voxels (a cached gather stores only its rows)', () => {
    const e = enhanced({grid: box(20, 12), lights: [light(5, 3)], trenchFloorY: -1.15});
    const {index, count} = indirectIndex(e.ctx.geos, e.ctx.layers, e.ctx.W * e.ctx.H);
    expect(count * IND_STRIDE).toBe(e.ind.data.length);
    expect(count).toBe(e.ind.stats.voxels);
    expect(index.length).toBe(e.ind.index.length);
    for (let s = 0; s < index.length; s++) expect(Buffer.from(index[s].buffer).equals(Buffer.from(e.ind.index[s].buffer))).toBe(true);
  });

  it('the standard tier (a 1 m lattice, the cells between filled) stays close to gathering in every cell', () => {
    const l = generateStation(7), s = src(l);
    const std = enhanced(s, GI_TIERS.standard), high = enhanced(s, GI_TIERS.high);
    expect(std.ind.stats.voxels).toBe(high.ind.stats.voxels);
    expect(std.ind.stats.probes).toBeLessThan(high.ind.stats.probes * 0.4);
    let d = 0, m = 0, holes = 0;
    const A = std.ind.data, B = high.ind.data;
    for (let o = 0; o < A.length; o += IND_STRIDE) {
      const la = lum([A[o], A[o + 1], A[o + 2]]), lb = lum([B[o], B[o + 1], B[o + 2]]);
      d += Math.abs(la - lb); m += lb;
      if (lb > 0.02 && la === 0) holes++;
    }
    console.log(`station 7: standard vs high mean ${(std.ind.stats.mean).toFixed(4)} / ${(high.ind.stats.mean).toFixed(4)}, mean abs difference ${(d / m * 100).toFixed(1)} % of the mean, unfilled voxels ${holes}`);
    expect(std.ind.stats.mean / high.ind.stats.mean).toBeGreaterThan(0.9);
    expect(std.ind.stats.mean / high.ind.stats.mean).toBeLessThan(1.1);
    expect(d / m).toBeLessThan(0.3);
    expect(holes).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('surface colours (what the builder drew)', () => {
  const mat = (hex: number) => ({color: {r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255}, userData: {}}) as never;
  it('floor / ceiling rects and wall faces colour their cells; an open ceiling is black; what was not drawn is neutral', () => {
    const g = box(20, 12);
    const e = enhanced({grid: g, lights: [light(5, 3)], trenchFloorY: -1.15});
    const levels = [{id: 0, role: 'main' as const, grid: g, baseY: 0}];
    const drawn: DrawnSurfaces = {
      keys: ['red', 'blue'],
      floors: [0, 0.5, 0.5, 5, 5.5, 0, 0],   // red floor over x 0.5..5 m
      ceils: [0, 0.5, 0.5, 5, 5.5, 4.4, 1,   // blue ceiling there
        0, 5, 0.5, 9.5, 5.5, 4.4, -1],       // open sky over the rest
      faces: [{level: 0, x0: 0.5, z0: 0.5, x1: 9.5, z1: 0.5, y0: 0, y1: 4.4, nx: 0, nz: 1, finish: 'green'}],
      material: k => (k === 'red' ? mat(0xcc0000) : k === 'blue' ? mat(0x0000cc) : k === 'green' ? mat(0x00cc00) : undefined),
    };
    const a = surfaceAlbedo(e.ctx.W, e.ctx.H, levels, e.ctx.geos, drawn);
    const at = (cx: number, cz: number, off: number) => [...a.slots[0].subarray((cz * 20 + cx) * ALBEDO_STRIDE + off, (cz * 20 + cx) * ALBEDO_STRIDE + off + 3)];
    const red = at(4, 4, ALB_FLOOR), blue = at(4, 4, ALB_CEIL);
    expect(red[0]).toBeGreaterThan(150); expect(red[1]).toBe(0); expect(red[2]).toBe(0);
    expect(blue[2]).toBeGreaterThan(150); expect(blue[0]).toBe(0);
    expect(at(14, 4, ALB_CEIL)).toEqual([0, 0, 0]); // open: light that reaches it is gone
    const dflt = at(14, 4, ALB_FLOOR);
    expect(dflt[0]).toBeGreaterThan(60); expect(Math.abs(dflt[0] - dflt[2])).toBeLessThan(30); // neutral concrete
    const green = at(4, 1, ALB_WALL);
    expect(green[1]).toBeGreaterThan(150); expect(green[0]).toBe(0);
    expect(at(4, 6, ALB_WALL)[0]).toBeGreaterThan(60); // a cell with no drawn face: the neutral wall
    expect(a.stats.floors).toBeGreaterThan(0);
    expect(a.stats.open).toBeGreaterThan(0);
    expect(a.stats.walls).toBeGreaterThan(0);
    // nothing brighter than fresh white paint, whatever a material says
    const white = surfaceAlbedo(e.ctx.W, e.ctx.H, levels, e.ctx.geos, {...drawn, material: () => mat(0xffffff)});
    expect(Math.max(...white.slots[0])).toBeLessThanOrEqual(Math.round(Math.sqrt(0.8) * 255));
  });

});
