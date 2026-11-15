// Task studio-baked-lighting-reflections-20261114-050258-01: the ENHANCED light-field bake (world/lightFieldGather.ts,
// world/lightScene.ts, world/surfaceAlbedo.ts; FieldSource.indirect in world/lightField.ts).
// Task studio-baked-gi-visual-uplift-20261115-004324-01: the gather is PHYSICAL and keeps its directions — per voxel an ambient cube
// (the irradiance of a floor, a ceiling and the four wall orientations there), no budget and no scale to the baseline's amount.
// - without the hook the bake is the baseline, before and after an enhanced bake ran (Enhanced lighting Off = today's field);
// - bounced light is OCCLUDED by the architecture: nothing behind a sealed wall, less the further round a corner, and an alcove
//   that hides from every lit surface is darker than the open floor next to it — where the baseline's fill spreads one area's mean
//   everywhere in it;
// - bounced light has a DIRECTION: a ceiling gets the lit floor's bounce on the face that looks down at it and nothing on the face
//   that looks away, a floor is not lit by itself, and the face turned to a lit red wall is redder than the face turned away;
// - bounced light takes the COLOUR of what it left; a black room bounces nothing (the field is then the direct light alone and
//   its cube holds what that light scatters, the same on all six faces; nothing at all in a room no light reaches);
// - ENERGY: every further bounce adds light and adds less than the one before (surfaces send back less than they get: a closed
//   pale room converges); `gain` scales the stored light linearly, `saturation` moves the chroma of the surface colours and never
//   the amount; neither is pinned here by value (GATHER_GAIN / GATHER_SATURATION are tuned by the lighting's look);
// - the rows are 16-bit fixed points (rowBits / rowValue): what a fresh gather returns is exactly what the derived cache gives back;
// - the field's one direction stays the direct light's, byte for byte (no bounce-steered veins on ceilings);
// - the three flicker circuits keep their share of the bounce (a circuit that is off takes its bounce with it);
// - nothing movable is in the ray scene (a cell holding a sight-blocking prop is open space to it);
// - deterministic, and independent of how the build is sliced; the standard tier's lattice + fill stays close to gathering everywhere.
import {describe, expect, it} from 'vitest';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {generateStation, type StationLayout} from '../src/gen/station';
import {stationLevels} from '../src/world/levelGeometry';
import {GI_TIERS, type GiTier} from '../src/world/enhancedLighting';
import {
  CUBE_FACES, DEFAULT_FIELD, GI_FACES, bakeLightField, bakeLightFieldSteps, fieldDepth, fixtureGroup, giDepth, sampleField, slotBase, slotLayers,
  type BakedField, type FieldSource,
} from '../src/world/lightField';
import {
  GATHER_GAIN, GATHER_REACH, GATHER_SATURATION, IND_CIRCUITS, IND_STRIDE, ROW_MAX, cubeMean, gatherIndirectSteps, indirectIndex, rowBits, rowValue,
  type GatherOptions, type IndirectContext, type IndirectLight,
} from '../src/world/lightFieldGather';
import {BandScene, HIT_CEIL, HIT_FLOOR, HIT_WALL, sphereDirections} from '../src/world/lightScene';
import {ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, surfaceAlbedo, type DrawnSurfaces, type SurfaceAlbedo} from '../src/world/surfaceAlbedo';
import type {BuildSteps} from '../src/core/pacedBuild';

type V3 = [number, number, number];
const lum = (v: readonly number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
/** What reaches a surface with normal n, rgb (what the full light node computes before the BRDF: the field's ambient cube included). */
function irrRgb(f: BakedField, x: number, y: number, z: number, n: V3 = [0, 1, 0], levels = [1, 1, 1]): V3 {
  const s = sampleField(f, x, y, z, levels, n);
  const ndl = Math.max(0, n[0] * s.dir[0] + n[1] * s.dir[1] + n[2] * s.dir[2]);
  return [s.amb[0] + s.dirColor[0] * ndl, s.amb[1] + s.dirColor[1] * ndl, s.amb[2] + s.dirColor[2] * ndl];
}
/** Its luminance. */
const irr = (f: BakedField, x: number, y: number, z: number, n: V3 = [0, 1, 0], levels = [1, 1, 1]): number => lum(irrRgb(f, x, y, z, n, levels));

/** w x h grid, solid border, everything else FLOOR with ceiling `ceil`. */
function box(w: number, h: number, ceil = 4.4): Grid {
  const g = new Grid(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { g.set(x, y, FLOOR); g.ceil[y * w + x] = ceil; g.area[y * w + x] = 0; }
  return g;
}
const light = (x: number, z: number, o: Partial<FieldSource['lights'][number]> = {}) => ({x, y: 4.35, z, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false, ...o});
const wall = (g: Grid, x: number, y0 = 0, y1 = g.h) => { for (let y = y0; y < y1; y++) g.set(x, y, SOLID); };

/** The gather's options that are not a tier's. Default: the game's, by name (both are tuned by the lighting's look). */
interface Look { gain?: number; saturation?: number; bounces?: number }
/** The bounce as the surfaces give it: nothing stylised. */
const PHYSICAL: Look = {gain: 1, saturation: 1};
const gatherOptions = (tier: GiTier, albedo: SurfaceAlbedo, look: Look = {}): GatherOptions => ({
  rays: tier.rays, bounces: look.bounces ?? tier.bounces, stride: tier.stride, reach: GATHER_REACH,
  gain: look.gain ?? GATHER_GAIN, saturation: look.saturation ?? GATHER_SATURATION, albedo,
});
interface Enhanced { field: BakedField; ind: IndirectLight; ctx: IndirectContext; albedo: SurfaceAlbedo }
/** The enhanced bake of a source: the gather of `tier` over neutral (or painted) surface colours. */
function enhanced(src: FieldSource, tier: GiTier = GI_TIERS.standard, paint?: (a: SurfaceAlbedo, ctx: IndirectContext) => void, drawn: DrawnSurfaces | null = null, look: Look = {}): Enhanced {
  const out: Partial<Enhanced> = {};
  out.field = bakeLightField({
    ...src,
    indirect: function* (ctx): BuildSteps<IndirectLight> {
      const levels = src.levels ?? [{id: 0, role: 'main' as const, grid: src.grid, baseY: 0}];
      const albedo = surfaceAlbedo(ctx.W, ctx.H, levels, ctx.geos, drawn);
      paint?.(albedo, ctx);
      out.ctx = ctx; out.albedo = albedo;
      return (out.ind = yield* gatherIndirectSteps(ctx, gatherOptions(tier, albedo, look)));
    },
  });
  return out as Enhanced;
}
/** The row (its offset into ind.data) of the voxel nearest a point, -1 in a closed cell. */
function rowAt(e: Enhanced, x: number, y: number, z: number, slot = 0): number {
  const W = e.ctx.W, i = Math.floor(z / 0.5) * W + Math.floor(x / 0.5), L = e.ctx.layers[slot], ly = e.ctx.geos[slot].layerY;
  let k = 0;
  for (let q = 1; q < L; q++) if (Math.abs(ly[i * L + q] - y) < Math.abs(ly[i * L + k] - y)) k = q;
  const row = e.ind.index[slot][i * L + k];
  return row < 0 ? -1 : row * IND_STRIDE;
}
/** One face (rgb) of the voxel nearest a point, CUBE_FACES order (+y, -y, +x, -x, +z, -z), straight from the gather's rows. */
function faceAt(e: Enhanced, face: number, x: number, y: number, z: number): V3 {
  const o = rowAt(e, x, y, z), d = e.ind.data;
  return o < 0 ? [0, 0, 0] : [d[o + face * 3], d[o + face * 3 + 1], d[o + face * 3 + 2]];
}
/** The gathered (bounced) light's luminance at a point — the mean of its six faces — from the gather's rows (the field's bytes quantise it). */
function gathered(e: Enhanced, x: number, y: number, z: number, slot = 0): number {
  const o = rowAt(e, x, y, z, slot);
  return o < 0 ? 0 : lum(cubeMean(e.ind.data, o, [0, 0, 0]));
}
const fillAlbedo = (a: SurfaceAlbedo, off: number, rgb: readonly [number, number, number]) => {
  for (const s of a.slots) for (let o = 0; o < s.length; o += ALBEDO_STRIDE) { s[o + off] = Math.round(Math.sqrt(rgb[0]) * 255); s[o + off + 1] = Math.round(Math.sqrt(rgb[1]) * 255); s[o + off + 2] = Math.round(Math.sqrt(rgb[2]) * 255); }
};
/** Every surface the same grey. */
const allAlbedo = (v: number) => (a: SurfaceAlbedo) => { for (const o of [ALB_FLOOR, ALB_WALL, ALB_CEIL]) fillAlbedo(a, o, [v, v, v]); };
const src = (l: StationLayout): FieldSource => ({grid: l.grid, lights: l.lights, trenchFloorY: l.trench.floorY, levels: stationLevels(l)});
const same = (a: Uint8Array | Float32Array, b: Uint8Array | Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
/** The rounding a stored row value may carry: half the distance to its neighbouring 16-bit code, and a hair for the float32. */
const rowHalfStep = (v: number): number => (Math.sqrt(Math.max(0, v) / ROW_MAX) * 65535 + 1) / 65535 ** 2 * ROW_MAX + Math.abs(v) * 1e-6;
/** The slices before a field's ambient cube (all of a field without one). */
const slotBytes = (f: BakedField): Uint8Array => f.data.subarray(0, (f.gi ?? f.depth) * f.w * f.h * 4);
/**
 * The ambient cube of a one-slot field, face against face: texels (rgb) of faces 1..5 that differ from face 0's texel of the same
 * voxel, and face-0 texels that hold any light.
 */
function cubeFaces(f: BakedField): {differ: number; lit: number} {
  const n4 = f.w * f.h * 4, L = slotLayers(0), g = f.gi! * n4;
  let differ = 0, lit = 0;
  for (let k = 0; k < L; k++) for (let o = 0; o < n4; o += 4) {
    const a = g + k * n4 + o;
    if (f.data[a] !== 0 || f.data[a + 1] !== 0 || f.data[a + 2] !== 0) lit++;
    for (let face = 1; face < GI_FACES; face++) { const b = g + (face * L + k) * n4 + o; if (f.data[b] !== f.data[a] || f.data[b + 1] !== f.data[a + 1] || f.data[b + 2] !== f.data[a + 2]) differ++; }
  }
  return {differ, lit};
}

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
    const steps = gatherIndirectSteps({...e.ctx, geos}, gatherOptions(GI_TIERS.standard, e.albedo));
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

  it('a sealed room stays black: every face of every voxel in it is zero, its cube holds nothing, no surface there is lit', () => {
    const e = enhanced(rooms(false), GI_TIERS.high), {W, H} = e.ctx, L = e.ctx.layers[0], f = e.field, n = W * H;
    let rows = 0, lit = 0, roomA = 0, cube = 0;
    for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) for (let k = 0; k < L; k++) {
      const row = e.ind.index[0][(cz * W + cx) * L + k];
      if (row < 0) continue;
      let any = false;
      for (let q = 0; q < IND_STRIDE; q++) if (e.ind.data[row * IND_STRIDE + q] !== 0) any = true;
      if (cx < 30) { if (any) roomA++; continue; }
      rows++;
      if (any) lit++;
      // its texel of each face's slice of this layer: no light (neither a fixture's scatter nor anything gathered)
      for (let face = 0; face < GI_FACES; face++) { const o = ((f.gi! + face * L + k) * n + cz * W + cx) * 4; if (f.data[o] !== 0 || f.data[o + 1] !== 0 || f.data[o + 2] !== 0) cube++; }
    }
    expect(rows).toBeGreaterThan(1000);
    expect(roomA).toBeGreaterThan(1000); // (the lit room next door did gather)
    expect([lit, cube]).toEqual([0, 0]);
    // whichever way a surface in the sealed room faces
    for (const nrm of CUBE_FACES) for (const [x, y, z] of [[16, 0.2, 6], [22, 2, 3], [27, 4.2, 10]] as const) expect(irr(f, x, y, z, [...nrm] as V3)).toBe(0);
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
describe('direction and colour (the ambient cube)', () => {
  const room = (o: Partial<FieldSource['lights'][number]> = {}, x = 7.5): FieldSource => ({grid: box(30, 24), lights: [light(x, 6, o)], trenchFloorY: -1.15});
  /** Only the floor sends light back (walls and ceiling black): one bounce, floor -> everything else. */
  const floorOnly = (floor: readonly [number, number, number], look: Look = PHYSICAL) =>
    enhanced(room(), GI_TIERS.high, a => { fillAlbedo(a, ALB_FLOOR, floor); fillAlbedo(a, ALB_WALL, [0, 0, 0]); fillAlbedo(a, ALB_CEIL, [0, 0, 0]); }, null, look);

  it('a ceiling over a lit floor gets the floor\'s bounce on the face that looks down and nothing on the face that looks up; a floor is not lit by itself', () => {
    const lit = floorOnly([0.7, 0.7, 0.7]), d = lit.ind.data;
    // the rows: nothing comes from above anywhere in the room (what is up there is black), every voxel gets the floor from below
    let up = 0, noDown = 0;
    for (let o = 0; o < d.length; o += IND_STRIDE) {
      if (d[o] !== 0 || d[o + 1] !== 0 || d[o + 2] !== 0) up++;
      if (!(d[o + 3] > 0 && d[o + 4] > 0 && d[o + 5] > 0)) noDown++;
    }
    expect([up, noDown]).toEqual([0, 0]);
    // over the pool of light the down-looking face holds more than the room's far corner's, and more than any wall face there
    // (those see the lit floor at a grazing angle)
    const under = faceAt(lit, 1, 7.5, 4.3, 6), corner = faceAt(lit, 1, 14, 4.3, 11);
    expect(lum(under)).toBeGreaterThan(lum(corner) * 2);
    for (let f = 2; f < GI_FACES; f++) expect(lum(faceAt(lit, f, 7.5, 4.3, 6))).toBeLessThan(lum(under) * 0.75);
    // the field, read as the full light node reads it: black-floor bake against the lit-floor bake
    const black = floorOnly([0, 0, 0]);
    expect(black.ind.data.every(v => v === 0)).toBe(true);
    const rows: string[] = [];
    for (const [x, z] of [[7.5, 6], [10, 8], [4, 3]] as const) {
      const f0 = irr(black.field, x, 0.02, z), f1 = irr(lit.field, x, 0.02, z);
      const c0 = irr(black.field, x, 4.38, z, [0, -1, 0]), c1 = irr(lit.field, x, 4.38, z, [0, -1, 0]);
      // (a surface that looks UP from just under the ceiling: the top of a duct, say)
      const u0 = irr(black.field, x, 4.1, z, [0, 1, 0]), u1 = irr(lit.field, x, 4.1, z, [0, 1, 0]);
      const face = lum(faceAt(lit, 1, x, 4.3, z));
      rows.push(`(${x}, ${z}) floor ${f0.toFixed(3)} -> ${f1.toFixed(3)}, ceiling ${c0.toFixed(3)} -> ${c1.toFixed(3)} (down-looking face ${face.toFixed(3)}), up-looking under the ceiling ${u0.toFixed(3)} -> ${u1.toFixed(3)}`);
      // the floor: the direct light, and nothing of its own bounce (within the field's 8-bit steps)
      expect(Math.abs(f1 - f0)).toBeLessThan(0.02 + f0 * 0.02);
      // the ceiling: the floor's bounce, as much as the gather's down-looking face holds there
      // (the sample blends the cells and the two layers round it: not the one voxel exactly)
      expect(c1 - c0).toBeGreaterThan(face * 0.7);
      expect(c1 - c0).toBeLessThan(face * 1.3);
      // and a surface up there that looks away from the floor gets none of it
      expect(Math.abs(u1 - u0)).toBeLessThan(0.02 + u0 * 0.02);
      expect(c1 - c0).toBeGreaterThan(Math.abs(u1 - u0) * 5);
    }
    console.log(`floor-only bounce: ${rows.join('; ')}`);
  });

  it('the field\'s one direction stays the direct light\'s, texel for texel, whatever was gathered', () => {
    const lit = enhanced(room(), GI_TIERS.high);
    // the direction slices of the enhanced field are the baseline's bytes (xyz of every layer of every slot)
    const base = bakeLightField(room()), e = lit.field;
    expect([e.w, e.h, e.slots, e.layers, e.gi]).toEqual([base.w, base.h, base.slots, base.layers, base.depth]);
    expect(e.depth).toBe(base.depth + giDepth(e.slots));
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
    expect(lit.ind.stats.mean).toBeGreaterThan(0);
  });

  it('the face turned to a lit red wall is redder than the face turned away from it', () => {
    // a white light near the west wall; that wall red, everything else grey
    const red: [number, number, number] = [0.7, 0.08, 0.06];
    const e = enhanced(room({tint: [1, 1, 1]}, 4), GI_TIERS.high, (a, ctx) => {
      allAlbedo(0.5)(a);
      const s = a.slots[0];
      for (let cz = 0; cz < ctx.H; cz++) for (let cx = 0; cx <= 2; cx++) { const o = (cz * ctx.W + cx) * ALBEDO_STRIDE + ALB_WALL; for (let c = 0; c < 3; c++) s[o + c] = Math.round(Math.sqrt(red[c]) * 255); }
    }, null, PHYSICAL);
    const rows: string[] = [], checks: number[][] = [];
    for (const [x, y, z] of [[5, 2, 6], [2, 1.4, 8], [3, 3, 4]] as const) {
      // the rows: face 3 looks west (normal -x) at the red wall, face 2 looks east at the grey one
      const west = faceAt(e, 3, x, y, z), east = faceAt(e, 2, x, y, z);
      // the field: the ambient light of a west-facing and of an east-facing surface there (the white direct light aside)
      const fw = sampleField(e.field, x, y, z, [1, 1, 1], [-1, 0, 0]).amb, fe = sampleField(e.field, x, y, z, [1, 1, 1], [1, 0, 0]).amb;
      rows.push(`(${x}, ${y}, ${z}) r/g gathered west ${(west[0] / west[1]).toFixed(2)} east ${(east[0] / east[1]).toFixed(2)}; ambient west ${(fw[0] / fw[1]).toFixed(2)} east ${(fe[0] / fe[1]).toFixed(2)}`);
      checks.push([west[1], east[1], west[0] / west[1], east[0] / east[1], fw[0] / fw[1], fe[0] / fe[1]]);
    }
    console.log(`red west wall: ${rows.join('; ')}`);
    for (const [wg, eg, west, east, fw, fe] of checks) {
      expect(wg).toBeGreaterThan(0);
      expect(eg).toBeGreaterThan(0);
      expect(west).toBeGreaterThan(east * 1.3);
      expect(west).toBeGreaterThan(1.4); // (the red wall, and the grey floor and ceiling it also sees)
      expect(east).toBeLessThan(1.3); // (the grey room's second bounce carries a little of the red round)
      expect(east).toBeGreaterThan(0.99); // white light on grey and red surfaces: never less red than green
      // as shaded: the same picture — and no complementary cast on the side turned away (the main texel's one directional share
      // is corrected per channel in the cube: light-field-cube.test.ts)
      expect(fw).toBeGreaterThan(fe * 1.2);
      expect(fe).toBeGreaterThan(0.9);
      expect(fe).toBeLessThan(1.4);
    }
  });

  it('a red floor reddens what its bounce lights (the ceiling above the fixtures); a neutral one does not', () => {
    const neutral = enhanced(room(), GI_TIERS.high, allAlbedo(0.5));
    const red = enhanced(room(), GI_TIERS.high, a => { allAlbedo(0.5)(a); fillAlbedo(a, ALB_FLOOR, [0.7, 0.08, 0.06]); });
    // what a ceiling facing down receives at the room's far end
    const n = irrRgb(neutral.field, 12, 4.3, 9, [0, -1, 0]), r = irrRgb(red.field, 12, 4.3, 9, [0, -1, 0]);
    console.log(`ceiling light: neutral floor rgb ${n.map(v => v.toFixed(4))}, red floor rgb ${r.map(v => v.toFixed(4))}`);
    expect(n[0] / n[1]).toBeGreaterThan(0.7);
    expect(n[0] / n[1]).toBeLessThan(1.3);
    expect(r[0] / r[1]).toBeGreaterThan((n[0] / n[1]) * 1.35);
    expect(r[1]).toBeLessThan(n[1]); // the red floor sends back less green than the grey one
  });
});

// ---------------------------------------------------------------------------------------------
describe('energy', () => {
  const room = (o: Partial<FieldSource['lights'][number]> = {}): FieldSource => ({grid: box(30, 24), lights: [light(7.5, 6, o)], trenchFloorY: -1.15});

  it('black surfaces bounce nothing: the field is the direct light alone and its cube holds that light\'s scatter, the same on all six faces', () => {
    const black = enhanced(room(), GI_TIERS.standard, allAlbedo(0));
    expect(black.ind.stats.mean).toBe(0);
    expect(black.ind.data.every(v => v === 0)).toBe(true);
    // the slots: the baseline bake with its bounce fill switched off, byte for byte
    const direct = bakeLightField(room(), {...DEFAULT_FIELD, bounce: 0});
    expect(direct.gi).toBeUndefined();
    expect(black.field.gi).toBe(direct.depth);
    expect(same(slotBytes(black.field), direct.data)).toBe(true);
    // the cube: what the direct light scatters and nothing else — no face of a voxel differs from another, nothing clipped
    const faces = cubeFaces(black.field);
    expect(faces.differ).toBe(0);
    expect(faces.lit).toBeGreaterThan(100); // (one fixture: its light has a direction nearly everywhere, little of it is scattered)
    expect(black.field.stats.cubeClipped).toBe(0);
    // so a surface is lit the same whichever way the node reads it: the cube's ambient is the main texel's own ambient part
    // (two encodings of one value: within their 8-bit steps), the directional part is the very same texel
    let worst = 0;
    for (const nrm of CUBE_FACES) for (const [x, y, z] of [[9, 2, 7], [7.5, 0.3, 6], [3, 4, 10], [12, 1, 3]] as const) {
      const a = sampleField(black.field, x, y, z, [1, 1, 1], nrm), b = sampleField(direct, x, y, z, [1, 1, 1], nrm);
      expect([a.dirColor, a.dir]).toEqual([b.dirColor, b.dir]);
      const total = lum(b.amb) + lum(b.dirColor);
      expect(total).toBeGreaterThan(0);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a.amb[c] - b.amb[c]) / total);
    }
    console.log(`black room: the cube's ambient against the main texel's ambient part, worst difference ${(worst * 100).toFixed(2)} % of the light there`);
    expect(worst).toBeLessThan(0.02);
  });

  it('brighter surfaces bounce more, and more than in proportion (the later bounces compound)', () => {
    const dim = enhanced(room(), GI_TIERS.standard, allAlbedo(0.2), null, PHYSICAL), bright = enhanced(room(), GI_TIERS.standard, allAlbedo(0.7), null, PHYSICAL);
    expect(dim.ind.stats.mean).toBeGreaterThan(0);
    expect(bright.ind.stats.mean).toBeGreaterThan(dim.ind.stats.mean * 3.5);
    // a shadowed spot (the far corner's wall, facing away from the light) is lit by the bounce only
    const black = enhanced(room(), GI_TIERS.standard, allAlbedo(0), null, PHYSICAL);
    const corner = (f: BakedField) => irr(f, 14.2, 2, 11.2, [1, 0, 0]);
    expect(corner(black.field)).toBeLessThan(corner(dim.field));
    expect(corner(dim.field)).toBeLessThan(corner(bright.field));
    // nothing is scaled to anything: the pale room's field simply holds more light (the first version of this bake held both at the baseline's amount)
    const mean = (f: BakedField) => { let t = 0, c = 0; for (let z = 1; z < 11; z += 0.5) for (let x = 1; x < 14; x += 0.5) { const sm = sampleField(f, x, 2.2, z); t += lum(sm.amb) + lum(sm.dirColor); c++; } return t / c; };
    const mk = mean(black.field), md = mean(dim.field), mb = mean(bright.field);
    console.log(`mean light at mid height: black room ${mk.toFixed(4)}, dim ${md.toFixed(4)}, pale ${mb.toFixed(4)}; gathered means ${dim.ind.stats.mean.toFixed(4)} / ${bright.ind.stats.mean.toFixed(4)}`);
    expect(md).toBeGreaterThan(mk);
    expect(mb - mk).toBeGreaterThan((md - mk) * 3.5);
  });

  it('every further bounce adds light, and less than the one before: a closed pale room converges', () => {
    const RHO = 0.6, N = 6;
    const means: number[] = [], data: Float32Array[] = [];
    for (let b = 1; b <= N; b++) { const e = enhanced(room(), GI_TIERS.standard, allAlbedo(RHO), null, {...PHYSICAL, bounces: b}); means.push(e.ind.stats.mean); data.push(e.ind.data); expect(e.ind.stats.bounces).toBe(b); }
    const adds = means.slice(1).map((m, i) => m - means[i]);
    console.log(`bounces 1..${N}: mean ${means.map(m => m.toFixed(4)).join(', ')}; each adds ${adds.map(a => a.toFixed(4)).join(', ')} (ratios ${adds.slice(1).map((a, i) => (a / adds[i]).toFixed(3)).join(', ')})`);
    expect(means[0]).toBeGreaterThan(0);
    for (const a of adds) expect(a).toBeGreaterThan(0);
    // a surface sends back at most RHO of what it gets, and some of that leaves the gather's reach: each bounce adds at most RHO x the one before
    expect(adds[0]).toBeLessThan(means[0] * RHO * 1.05);
    for (let i = 1; i < adds.length; i++) expect(adds[i]).toBeLessThan(adds[i - 1] * RHO * 1.05);
    // so the total stays under the geometric series' sum, however many bounces are followed
    expect(means[N - 1]).toBeLessThan(means[0] / (1 - RHO));
    // and no voxel loses light to a further bounce (every face of every row, within the rows' rounding)
    for (let b = 1; b < N; b++) {
      let less = 0;
      const p = data[b - 1], q = data[b];
      for (let o = 0; o < q.length; o++) if (q[o] < p[o] - rowHalfStep(p[o]) * 2) less++;
      expect(less).toBe(0);
    }
  });

  it('`gain` scales the stored light linearly; the game\'s own gain is one such scale of the physical gather', () => {
    const at = (gain: number) => enhanced(room(), GI_TIERS.standard, allAlbedo(0.5), null, {gain, saturation: 1});
    const one = at(1);
    for (const g of [2, 0.5, GATHER_GAIN]) {
      const e = at(g), a = one.ind.data, b = e.ind.data;
      let off = 0, top = 0;
      for (let o = 0; o < a.length; o++) {
        // (both rows are rounded to 16 bits after the scale: the unscaled row's rounding is scaled with it)
        if (Math.abs(b[o] - g * a[o]) > g * rowHalfStep(a[o]) + rowHalfStep(b[o])) off++;
        if (b[o] > top) top = b[o];
      }
      expect(off).toBe(0);
      expect(top).toBeLessThan(ROW_MAX); // (nothing at the rows' ceiling: the comparison is of real values)
      expect(e.ind.stats.mean / one.ind.stats.mean).toBeCloseTo(g, 3);
      // what the field stores of it: the direct light is not scaled, the gathered light is
      const extra = (x: Enhanced) => irr(x.field, 14.2, 2, 11.2, [1, 0, 0]);
      expect(extra(e) / extra(one)).toBeGreaterThan(g * 0.9);
      expect(extra(e) / extra(one)).toBeLessThan(g * 1.1);
    }
    // gain 0: nothing is stored
    expect(at(0).ind.data.every(v => v === 0)).toBe(true);
  });

  it('`saturation` 1 leaves a neutral room neutral; more of it deepens a coloured bounce without changing how much light it is', () => {
    const white = {tint: [1, 1, 1] as [number, number, number]};
    // a grey room under a white light: every face of every voxel is grey, at any saturation, and the rows do not depend on it
    const grey = (saturation: number | undefined) => enhanced(room(white), GI_TIERS.standard, allAlbedo(0.5), null, {gain: 1, saturation});
    const g1 = grey(1), d = g1.ind.data;
    let tinted = 0;
    for (let o = 0; o < d.length; o += IND_STRIDE) for (let f = 0; f < GI_FACES; f++) { const r = d[o + f * 3], g = d[o + f * 3 + 1], b = d[o + f * 3 + 2]; if (Math.abs(r - g) > rowHalfStep(g) * 2 || Math.abs(b - g) > rowHalfStep(g) * 2) tinted++; }
    expect(tinted).toBe(0);
    expect(g1.ind.stats.mean).toBeGreaterThan(0);
    const dflt = enhanced(room(white), GI_TIERS.standard, allAlbedo(0.5), null, {gain: 1, saturation: undefined});
    expect(same(dflt.ind.data, d)).toBe(true); // (the option's default is 1)
    for (const s of [GATHER_SATURATION, 2]) {
      const gs = grey(s).ind.data;
      let off = 0;
      for (let o = 0; o < d.length; o++) if (Math.abs(gs[o] - d[o]) > rowHalfStep(d[o]) * 2) off++;
      expect(off).toBe(0);
    }
    // a red floor, one bounce: more saturation = a redder bounce of (nearly) the same luminance
    const redFloor = (saturation: number) => enhanced(room(white), GI_TIERS.high, a => { allAlbedo(0)(a); fillAlbedo(a, ALB_FLOOR, [0.5, 0.2, 0.2]); }, null, {gain: 1, saturation});
    const r1 = redFloor(1), r2 = redFloor(1.5);
    const f1 = faceAt(r1, 1, 7.5, 4.3, 6), f2 = faceAt(r2, 1, 7.5, 4.3, 6);
    console.log(`red floor's bounce on the ceiling: saturation 1 rgb ${f1.map(v => v.toFixed(4))}, 1.5 rgb ${f2.map(v => v.toFixed(4))}`);
    expect(f2[0] / f2[1]).toBeGreaterThan(f1[0] / f1[1] * 1.2);
    expect(lum(f2) / lum(f1)).toBeGreaterThan(0.97);
    expect(lum(f2) / lum(f1)).toBeLessThan(1.03);
    expect(r2.ind.stats.mean / r1.ind.stats.mean).toBeGreaterThan(0.97);
    expect(r2.ind.stats.mean / r1.ind.stats.mean).toBeLessThan(1.03);
  });

  it('a generated station: the same slots with the cube after them, and the gathered light on top of the direct light — nowhere a loss', () => {
    const l = generateStation(11), s = src(l);
    const base = bakeLightField(s), direct = bakeLightField(s, {...DEFAULT_FIELD, bounce: 0}), e = enhanced(s);
    // same format: dimensions, slots, header layout; the cube follows the slots
    expect([e.field.w, e.field.h, e.field.slots, e.field.layers, e.field.hdr]).toEqual([base.w, base.h, base.slots, base.layers, base.hdr]);
    expect(e.field.gi).toBe(base.depth);
    expect(base.depth).toBe(fieldDepth(base.slots) + (base.hdr ?? 0));
    expect(e.field.depth).toBe(base.depth + giDepth(base.slots));
    expect(e.field.stats.indirect?.voxels).toBe(e.ind.stats.voxels);
    expect(base.stats.indirect).toBeUndefined();
    expect(base.gi).toBeUndefined();
    expect(same(slotBytes(e.field), base.data)).toBe(false);
    // mean stored irradiance over the open cells of the main level, 1.2 m up (no normal: the main texels, what the fog and a plain light node read)
    const g = l.grid;
    let sb = 0, sd = 0, se = 0, n = 0, darker = 0;
    for (let cz = 2; cz < g.h; cz += 3) for (let cx = 2; cx < g.w; cx += 3) {
      if (g.get(cx, cz) === SOLID) continue;
      const at = (f: BakedField) => { const sm = sampleField(f, (cx + 0.5) * 0.5, g.floor[cz * g.w + cx] + 1.2, (cz + 0.5) * 0.5); return lum(sm.amb) + lum(sm.dirColor); };
      const vb = at(base), vd = at(direct), ve = at(e.field);
      sb += vb; sd += vd; se += ve; n++;
      if (ve < vd - 0.01 - vd * 0.02) darker++;
    }
    console.log(`station 11 mean light at 1.2 m: direct alone ${(sd / n).toFixed(4)}, baseline ${(sb / n).toFixed(4)}, enhanced ${(se / n).toFixed(4)} (${(se / sb).toFixed(3)}x the baseline); gather ${JSON.stringify(e.ind.stats)}`);
    expect(darker).toBe(0);
    expect(se).toBeGreaterThan(sd);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the rows (16 bits, as the derived cache stores them)', () => {
  it('rowBits / rowValue: every code is a fixed point, the codes are ordered, and a value comes back within half a step', () => {
    let fixed = 0, ordered = 0;
    for (let b = 0; b < 65536; b++) {
      if (rowBits(rowValue(b)) === b) fixed++;
      if (b && rowValue(b) > rowValue(b - 1)) ordered++;
    }
    expect([fixed, ordered]).toEqual([65536, 65535]);
    expect([rowValue(0), rowValue(65535)]).toEqual([0, ROW_MAX]);
    expect(rowValue(1)).toBeGreaterThan(0);
    // out of range: nothing negative or undefined is stored, the top is the top
    expect([rowBits(0), rowBits(-1), rowBits(NaN), rowBits(-Infinity)]).toEqual([0, 0, 0, 0]);
    expect([rowBits(ROW_MAX), rowBits(ROW_MAX * 4), rowBits(Infinity)]).toEqual([65535, 65535, 65535]);
    // a fixed spread of values over the whole range (square-root spaced like the codes, and linearly)
    let worst = 0, backwards = 0, prev = 0;
    for (let i = 0; i <= 20000; i++) {
      for (const v of [ROW_MAX * (i / 20000) ** 2, ROW_MAX * i / 20000, 1e-7 * i]) {
        const got = rowValue(rowBits(v)), err = Math.abs(got - v) / rowHalfStep(v);
        if (err > worst) worst = err;
        if (rowBits(rowValue(rowBits(v))) !== rowBits(v)) backwards++;
      }
      const b = rowBits(ROW_MAX * i / 20000);
      if (b < prev) backwards++;
      prev = b;
    }
    expect(worst).toBeLessThanOrEqual(1);
    expect(backwards).toBe(0);
    // finer than a half float where the light is faint: a bounce a ten-thousandth of the range still has hundreds of codes under it
    expect(rowBits(ROW_MAX * 1e-4)).toBeGreaterThan(600);
  });

  it('a gather returns rows that are already those 16 bits (a cached row is the row), and its mean is their mean', () => {
    const l = generateStation(4), e = enhanced(src(l)), d = e.ind.data;
    let off = 0, neg = 0, sum = 0;
    const m: V3 = [0, 0, 0];
    for (let o = 0; o < d.length; o++) { if (rowValue(rowBits(d[o])) !== d[o]) off++; if (!(d[o] >= 0)) neg++; }
    for (let o = 0; o < d.length; o += IND_STRIDE) sum += lum(cubeMean(d, o, m));
    expect([off, neg]).toEqual([0, 0]);
    expect(d.length).toBe(e.ind.stats.voxels * IND_STRIDE);
    expect(e.ind.stats.mean).toBeGreaterThan(0);
    expect(e.ind.stats.mean).toBeCloseTo(sum / e.ind.stats.voxels, 9);
    // the circuits' shares are shares of the mean: never more than it (within rounding), each of them and together
    let over = 0;
    for (let o = 0; o < d.length; o += IND_STRIDE) {
      const ml = lum(cubeMean(d, o, m)), c = d[o + IND_CIRCUITS] + d[o + IND_CIRCUITS + 1] + d[o + IND_CIRCUITS + 2];
      if (c > ml * 1.001 + rowHalfStep(ml) * 8) over++;
    }
    expect(over).toBe(0);
    // cubeMean is the plain mean of the six faces
    const row = Float32Array.from({length: IND_STRIDE}, (_, q) => q + 1);
    expect(cubeMean(row, 0, [0, 0, 0])).toEqual([(1 + 4 + 7 + 10 + 13 + 16) / 6, (2 + 5 + 8 + 11 + 14 + 17) / 6, (3 + 6 + 9 + 12 + 15 + 18) / 6]);
    expect(CUBE_FACES.map(f => [...f])).toEqual([[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]);
    expect([GI_FACES * 3, IND_CIRCUITS + 3]).toEqual([IND_CIRCUITS, IND_STRIDE]);
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
    // the rows: in room B nearly all of the gathered light is the flickering circuit's, in room A's far end next to none
    const share = (x: number, z: number) => { const o = rowAt(e, x, 2, z); return e.ind.data[o + IND_CIRCUITS + c] / lum(cubeMean(e.ind.data, o, [0, 0, 0])); };
    expect(share(26, 4)).toBeGreaterThan(0.8);
    expect(share(3, 4)).toBeLessThan(0.1);
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
        return (ind = yield* gatherIndirectSteps(ctx, gatherOptions(GI_TIERS.standard, albedo)));
      },
    });
    let n = 0, junk = 0;
    let r = steps.next();
    while (!r.done) { n++; junk += new Float32Array(64).length; r = steps.next(); }
    expect(junk).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(20);
    expect(same(r.value.data, a.field.data)).toBe(true);
    expect(same(ind!.data, a.ind.data)).toBe(true);
    expect(r.value.gi).toBe(a.field.gi);
    // and the baseline is what it was before any enhanced bake ran
    const base1 = bakeLightField(s), base2 = bakeLightField({...s, indirect: undefined});
    expect(same(base1.data, base2.data)).toBe(true);
    expect([base1.gi, base1.depth]).toEqual([undefined, a.field.gi]);
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
    let d = 0, m = 0, holes = 0, df = 0, mf = 0;
    const A = std.ind.data, B = high.ind.data, ma: V3 = [0, 0, 0], mb: V3 = [0, 0, 0];
    for (let o = 0; o < A.length; o += IND_STRIDE) {
      const la = lum(cubeMean(A, o, ma)), lb = lum(cubeMean(B, o, mb));
      d += Math.abs(la - lb); m += lb;
      if (lb > 0.02 * GATHER_GAIN && la === 0) holes++;
      // face by face too (the direction survives the lattice)
      for (let f = 0; f < GI_FACES; f++) { const q = o + f * 3; df += Math.abs(lum([A[q], A[q + 1], A[q + 2]]) - lum([B[q], B[q + 1], B[q + 2]])); mf += lum([B[q], B[q + 1], B[q + 2]]); }
    }
    console.log(`station 7: standard vs high mean ${(std.ind.stats.mean).toFixed(4)} / ${(high.ind.stats.mean).toFixed(4)}, mean abs difference ${(d / m * 100).toFixed(1)} % of the mean (per face ${(df / mf * 100).toFixed(1)} %), unfilled voxels ${holes}`);
    expect(std.ind.stats.mean / high.ind.stats.mean).toBeGreaterThan(0.9);
    expect(std.ind.stats.mean / high.ind.stats.mean).toBeLessThan(1.1);
    expect(d / m).toBeLessThan(0.3);
    expect(df / mf).toBeLessThan(0.4);
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
