// Iteration 08 (Lane G): rendering multi-level stations.
// - wall faces exist exactly where a level's open band borders closed space (never through another
//   level's open band), slab undersides / floors on overlaps, railings on drop edges;
// - the baked light field keeps one slot per level: no light through slabs, light through wells/stairs;
// - the medium (fog density) picks the level band;
// - the world builds in Node for the synthetic fixture and for generated stations of every family,
//   with bounded draw calls / triangles in view (frustum-culled per-level chunks).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {FIX, levelFixture} from './helpers/levelRenderFixture';
import {ARCHETYPES, generateStation, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR, VOID, rampHeight} from '../src/gen/grid';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {CHUNK_M, LevelColumns, cellCeil, deriveRails, extractWallFaces, stationLevels, subtractBands, type BuiltFace} from '../src/world/levelGeometry';
import {bakeLightField, downsampleField, fieldDepth, sampleField, type BakedField} from '../src/world/lightField';
import {ATMOSPHERE, buildDensityMap, densityAt, sampleDensityMap} from '../src/render/atmosphere';
import {StationLighting} from '../src/world/lights';
import {CULL_LAYER, fogCullDistance} from '../src/world/levelCulling';
import {MOOD} from '../src/world/lights';
import {createFogUniforms, createMarchMaterial} from '../src/render/volumetricShaders';
import {compileQuad} from './helpers/fogCompile';
import {overdraw} from './helpers/overdraw';
import {codeToSeed} from '../src/core/rng';

const lum = (v: readonly number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const irr = (f: BakedField, x: number, y: number, z: number) => { const s = sampleField(f, x, y, z, [1, 1, 1], [0, 1, 0]); return lum(s.amb) + lum(s.dirColor) * Math.max(0, s.dir[1]); };

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

/** Generated stations of every family (cached); `levels` reports how many level grids each has. */
const genCache = new Map<string, StationLayout | Error>();
function generated(a: (typeof ARCHETYPES)[number], seed = 9001): StationLayout | Error {
  const key = `${a}:${seed}`;
  if (!genCache.has(key)) {
    try { genCache.set(key, generateStation(seed, {archetype: a})); } catch (e) { genCache.set(key, e as Error); }
  }
  return genCache.get(key)!;
}

/** Face sample points (along s, height y) away from edges and openings. */
function facePoints(f: BuiltFace): {x: number; z: number; y: number; s: number}[] {
  const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
  const s0 = alongX ? f.x0 : f.z0, s1 = alongX ? f.x1 : f.z1, plane = alongX ? f.z0 : f.x0;
  const out: {x: number; z: number; y: number; s: number}[] = [];
  for (let s = s0 + CELL / 2; s < s1; s += CELL) {
    const u = (s - s0) / Math.max(1e-9, s1 - s0);
    const yb = f.slope ? f.slope.b0 + (f.slope.b1 - f.slope.b0) * u : f.y0, yt = f.slope ? f.slope.t0 + (f.slope.t1 - f.slope.t0) * u : f.y1;
    if (yt - yb < 0.08) continue;
    const local = s - s0;
    for (const t of [0.15, 0.5, 0.85]) {
      const y = yb + (yt - yb) * t;
      if (f.openings.some(o => local > o.s0 && local < o.s1 && y < o.top + 0.02)) continue;
      out.push(alongX ? {x: s, z: plane, y, s} : {x: plane, z: s, y, s});
    }
  }
  return out;
}

/** Union free test with a ramp's pitch (cellCeil/floorOf use the cell centre; faces follow the pitch). */
function freeAt(cols: LevelColumns, x: number, z: number, y: number, only?: number, margin = 1e-3): boolean {
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  if (cx < 0 || cy < 0 || cx >= cols.W || cy >= cols.H) return false;
  const i = cy * cols.W + cx;
  for (let k = 0; k < cols.levels.length; k++) {
    if (only !== undefined && k !== only) continue;
    const g = cols.levels[k].grid;
    if (g.cells[i] !== FLOOR && g.cells[i] !== VOID) continue;
    const f = g.floorAt(x, z), c = g.rampIdx[i] >= 0 ? f + g.ramps[g.rampIdx[i]].headroom : cellCeil(g, i);
    if (y >= f - margin && y <= c + margin) return true;
  }
  return false;
}

function faceViolations(layout: StationLayout): string[] {
  const levels = stationLevels(layout), cols = new LevelColumns(levels);
  const faces = extractWallFaces(layout, levels, cols, {tileLowerHeight: 1.8});
  const bad: string[] = [];
  for (const f of faces) {
    for (const p of facePoints(f)) {
      const fx = p.x + f.nx * 0.2, fz = p.z + f.nz * 0.2, bx = p.x - f.nx * 0.2, bz = p.z - f.nz * 0.2;
      // In front: the face's own level is open there (skirts of flight walls hide under the treads).
      const front = freeAt(cols, fx, fz, p.y, f.level) || (f.slope && p.y < f.slope.b0 + 0.36 + Math.abs(f.slope.b1 - f.slope.b0));
      // Behind: closed on EVERY level (a wall never stands in another level's open band).
      const back = freeAt(cols, bx, bz, p.y, undefined, -0.01);
      if (!front || back) bad.push(`L${f.level} ${f.finish} ${f.zone} @${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)} n=${f.nx},${f.nz} front=${!!front} back=${back}`);
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------
describe('multi-level wall faces (union of open columns)', () => {
  it('band subtraction: walls, openings, slab fascias and sloped pieces', () => {
    // A tall void band next to a column with an under-slab band and a deck band: the slab fascia and the
    // bulkhead above the deck ceiling are the visible pieces.
    const ps = subtractBands({f0: -1.15, f1: -1.15, c0: 7.95, c1: 7.95}, [{f0: 0, f1: 0, c0: 4.4, c1: 4.4}, {f0: 4.75, f1: 4.75, c0: 7.6, c1: 7.6}]);
    expect(ps.map(p => [p.b0, p.t0])).toEqual([[-1.15, 0], [4.4, 4.75], [7.6, 7.95]]);
    // Next to a sloped flight band: one trapezoid above the flight's ceiling, one below its floor.
    const sl = subtractBands({f0: 0, f1: 0, c0: 8, c1: 8}, [{f0: 1, f1: 2, c0: 3.5, c1: 4.5}]);
    expect(sl).toHaveLength(2);
    expect(sl[0]).toMatchObject({b0: 0, b1: 0, t0: 1, t1: 2});
    expect(sl[1]).toMatchObject({b0: 3.5, b1: 4.5, t0: 8, t1: 8});
    // A crossing line splits the edge into trapezoids.
    const cr = subtractBands({f0: 0, f1: 0, c0: 3, c1: 3}, [{f0: -1, f1: 1, c0: 0.5, c1: 4}]);
    expect(cr.length).toBeGreaterThanOrEqual(1);
    for (const p of cr) { expect(p.t0).toBeGreaterThanOrEqual(p.b0 - 1e-9); expect(p.t1).toBeGreaterThanOrEqual(p.b1 - 1e-9); }
  });

  it('fixture: every face has its own open band in front and closed space behind (never crosses another band)', () => {
    const {layout} = levelFixture();
    expect(faceViolations(layout)).toEqual([]);
  });

  it('fixture: slab fascias at the light well, stair-core walls per level, upper/lower zones', () => {
    const {layout, levels} = levelFixture();
    const cols = new LevelColumns(levels);
    const faces = extractWallFaces(layout, levels, cols, {tileLowerHeight: 1.8});
    // From the well (main track bed band) the deck slab edge between 4.4 and 4.75 is a concrete fascia.
    const fascia = faces.filter(f => f.level === 0 && f.kind === 'slab' && Math.abs(f.y0 - FIX.platCeil) < 1e-4 && Math.abs(f.y1 - FIX.upperY) < 1e-4);
    expect(fascia.length).toBeGreaterThanOrEqual(2);
    expect(fascia.every(f => f.finish === 'platformFace' && f.zone === 'trackbed')).toBe(true);
    const wellSpan = (f: BuiltFace) => [Math.min(f.x0, f.x1), Math.max(f.x0, f.x1)];
    expect(fascia.some(f => wellSpan(f)[0] <= 15 + 1e-6 && wellSpan(f)[1] >= 25 - 1e-6)).toBe(true);
    // Every level has walls; upper/lower zones are tagged; flight side walls are published as sloped stair faces.
    for (const L of [0, 1, 2]) expect(faces.some(f => f.level === L), `level ${L}`).toBe(true);
    expect(faces.some(f => f.level === 1 && f.zone === 'upper')).toBe(true);
    expect(faces.some(f => f.level === 2 && f.zone === 'lower')).toBe(true);
    const sloped = faces.filter(f => f.slope);
    expect(sloped.length).toBeGreaterThanOrEqual(4);
    expect(sloped.every(f => f.zone === 'stair')).toBe(true);
    // A flight shared by two levels is walled once (no duplicate coplanar faces).
    const key = (f: BuiltFace) => `${f.finish}|${f.x0}|${f.z0}|${f.x1}|${f.z1}|${f.y0.toFixed(3)}|${f.y1.toFixed(3)}`;
    const seen = new Set<string>();
    for (const f of faces) { expect(seen.has(key(f)), key(f)).toBe(false); seen.add(key(f)); }
    // Deck walls along the bed outside the well stand above the bed ceiling only (upper band).
    expect(faces.some(f => f.level === 1 && f.nz === -1 && Math.abs(f.z0 - 8) < 1e-6 && Math.abs(f.y0 - FIX.upperY) < 1e-4)).toBe(true);
  });

  it('fixture: railings exactly on the deck edges facing the light well (none on platform edges)', () => {
    const {layout} = levelFixture();
    const rails = deriveRails(layout);
    expect(rails.length).toBe(2);
    for (const r of rails) {
      expect(r.level).toBe(1);
      expect(r.y0).toBeCloseTo(FIX.upperY, 6);
      expect(Math.min(r.x0, r.x1)).toBeCloseTo(15, 6);
      expect(Math.max(r.x0, r.x1)).toBeCloseTo(25, 6);
      // On the deck side of the edge line, facing the deck.
      expect(r.nz === 1 ? r.z0 > 8 - 1e-6 : r.z0 < 16 + 1e-6).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('multi-level light field (one slot per level)', () => {
  const only = (pred: (i: number) => boolean) => {
    const {layout, levels} = levelFixture();
    const lights = layout.lights.filter((_, i) => pred(i));
    return {layout, f: bakeLightField({grid: layout.grid, lights, trenchFloorY: FIX.bedY, levels}), lights};
  };

  it('layout: slot mask + one slot per level; bounded size and bake time', () => {
    const {layout, levels} = levelFixture();
    const f = bakeLightField({grid: layout.grid, lights: layout.lights, trenchFloorY: FIX.bedY, levels});
    expect(f.slots).toBe(3);
    expect(f.depth).toBe(fieldDepth(3)); // main slot 4 layers, upper/lower slots AUX_LAYERS
    expect(f.stats.bytes).toBe(FIX.W * FIX.H * f.depth * 4);
    expect(f.stats.crossRays).toBeGreaterThan(0);
    // Every column's mask names exactly the levels open there (a shared flight cell counts once).
    const cols = new LevelColumns(levels);
    for (let i = 0; i < FIX.W * FIX.H; i++) {
      const mask = f.data[i * 4];
      expect(mask.toString(2).split('').filter(c => c === '1').length).toBe(cols.count(i));
    }
    // (iteration 13: the surface decode is TSL; one packed texel fetch picks the slot, no per-slot loop —
    // tests/lighting-node.test.ts counts the fetches / loops in the generated WGSL and GLSL)
  });

  it('a main fixture lights the platform under the deck but neither the deck above nor the crossing below', () => {
    const {layout} = levelFixture();
    const li = layout.lights.findIndex(l => l.x === 20 && l.z === 5.5 && (l.level ?? 0) === 0);
    const {f} = only(i => i === li); // platform 1 light at x 20, z 5.5 (deck 1 above, crossing below)
    expect(irr(f, 20, 0.02, 5.5)).toBeGreaterThan(0.3);
    expect(irr(f, 20, FIX.upperY + 0.02, 5.5)).toBe(0);
    expect(irr(f, 21.5, FIX.lowerY + 0.02, 5.5)).toBe(0);
  });

  it('an upper fixture lights the deck and, through the light well, the track bed - never the platform under the slab', () => {
    const {layout, levels} = levelFixture({lights: false});
    const deckEdge = {x: 20, y: FIX.upperCeil - 0.15, z: 7.6, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false, level: 1};
    const f = bakeLightField({grid: layout.grid, lights: [deckEdge], trenchFloorY: FIX.bedY, levels});
    expect(irr(f, 20, FIX.upperY + 0.02, 7.25)).toBeGreaterThan(0.3);   // deck under it
    expect(irr(f, 20, FIX.bedY + 0.05, 9.5)).toBeGreaterThan(0.02);    // bed floor down the well
    expect(irr(f, 20, 0.02, 6)).toBe(0);                                 // platform below the deck slab
    // Without cross-level transport the well stays dark (the test above really exercises the union rays).
    const f2 = bakeLightField({grid: layout.grid, lights: [deckEdge], trenchFloorY: FIX.bedY, levels, crossLevel: false});
    expect(irr(f2, 20, FIX.bedY + 0.05, 9.5)).toBe(0);
  });

  it('a top-landing fixture lights down the shared stair flight', () => {
    const {layout, levels, rampUp} = levelFixture({lights: false});
    const top = {x: 37, y: FIX.upperY + 2.85, z: 1.5, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false, level: 1};
    const f = bakeLightField({grid: layout.grid, lights: [top], trenchFloorY: FIX.bedY, levels});
    const s = 33; // upper part of the flight
    expect(irr(f, s, rampHeight(rampUp, s) + 0.05, 1.5)).toBeGreaterThan(0.02);
    // The main platform (other side of the core wall) stays dark.
    expect(irr(f, 33, 0.02, 4)).toBe(0);
  });

  it('generated stations: no light through slabs (upper-only bake leaves floors under deck interiors dark; main-only bake leaves the lower crossing dark)', () => {
    for (const a of ['side-mezzanine', 'island-ends', 'deep'] as const) {
      const l = generated(a);
      if (l instanceof Error) throw l;
      const levels = stationLevels(l);
      if (levels.length < 3) continue;
      const cols = new LevelColumns(levels);
      const W = cols.W, H = cols.H;
      /** Columns where level `lo` lies under level `hi` with a slab between, and so does every column within r cells (no well/stair/edge near). */
      const covered = (lo: number, hi: number, r: number): number[] => {
        const capped = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) {
          const gl = levels[lo].grid, gh = levels[hi].grid;
          const ol = gl.cells[i] === FLOOR || gl.cells[i] === VOID, oh = gh.cells[i] === FLOOR || gh.cells[i] === VOID;
          if (ol && oh && gl.rampIdx[i] < 0 && gh.rampIdx[i] < 0 && cellCeil(gl, i) < gh.floorOf(i) - 0.2) capped[i] = 1;
        }
        const out: number[] = [];
        for (let y = r; y < H - r; y++) for (let x = r; x < W - r; x++) {
          let ok = true;
          for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) {
            const j = (y + dy) * W + x + dx;
            const anyLo = levels[lo].grid.cells[j] !== 0, anyHi = levels[hi].grid.cells[j] !== 0;
            if ((anyLo || anyHi) && !capped[j]) { ok = false; break; }
          }
          if (ok) out.push(y * W + x);
        }
        return out;
      };
      const bake = (lv: number) => bakeLightField({grid: l.grid, lights: l.lights.filter(x => (x.level ?? 0) === lv), trenchFloorY: l.trench.floorY, levels});
      const upperOnly = bake(1), mainOnly = bake(0);
      const underDeck = covered(0, 1, 6), underMain = covered(2, 0, 6);
      expect(underDeck.length, `${a}: deck interiors over the main level`).toBeGreaterThan(20);
      expect(underMain.length, `${a}: crossing interiors under the main level`).toBeGreaterThan(5);
      const at = (f: BakedField, lv: number, i: number) => irr(f, (i % W + 0.5) * CELL, levels[lv].grid.floorOf(i) + 0.02, (Math.floor(i / W) + 0.5) * CELL);
      expect(underDeck.filter(i => at(upperOnly, 0, i) > 0).length, `${a}: main floor lit through the deck slab`).toBe(0);
      expect(underMain.filter(i => at(mainOnly, 2, i) > 0).length, `${a}: lower floor lit through the platform slab`).toBe(0);
      // ... while each level's own fixtures do light those floors somewhere.
      expect(underDeck.some(i => at(mainOnly, 0, i) > 0.1), a).toBe(true);
    }
  });

  it('StationLighting caps the field memory (downsamples past maxFieldBytes) and reports the slots', () => {
    const {layout} = levelFixture();
    const scene = new THREE.Scene();
    const fixtures = layout.lights.map((x, i) => ({x: x.x, y: x.y, z: x.z, broken: x.broken, flicker: x.flicker, warm: x.warm, dying: x.dying, power: x.power, area: x.area, phase: i, level: 1}));
    const full = new StationLighting(scene, layout, fixtures, null);
    expect(full.field.cellScale ?? 1).toBe(1);
    expect(full.debug().field.slots).toBe(3);
    const capped = new StationLighting(new THREE.Scene(), layout, fixtures, null, {maxFieldBytes: full.field.stats.bytes / 3});
    expect(capped.field.cellScale).toBe(2);
    expect(capped.field.stats.bytes).toBeLessThanOrEqual(full.field.stats.bytes / 3);
    full.dispose(scene);
  });

  it('downsampling ORs the slot mask and keeps per-level light', () => {
    const {layout, levels} = levelFixture();
    const f = bakeLightField({grid: layout.grid, lights: layout.lights, trenchFloorY: FIX.bedY, levels});
    const d = downsampleField(f, 2);
    expect(d.depth).toBe(f.depth);
    expect(d.data[0 * 4]).toBe(f.data[0] | f.data[4] | f.data[FIX.W * 4] | f.data[(FIX.W + 1) * 4]);
    expect(irr(d, 20, 0.02, 5.5)).toBeGreaterThan(irr(f, 20, 0.02, 5.5) * 0.3);
    expect(irr(d, 20, FIX.upperY + 0.02, 5.5)).toBeGreaterThan(irr(f, 20, FIX.upperY + 0.02, 5.5) * 0.3);
  });
});

// ---------------------------------------------------------------------------------------------
describe('per-level medium (fog density map)', () => {
  it('one layer per level; the band holding the point decides multiplier and local floor', () => {
    const {layout} = levelFixture();
    const m = buildDensityMap(layout, ATMOSPHERE);
    expect(m.slots).toBe(3);
    expect(m.data.length).toBe(FIX.W * FIX.H * 3 * 4);
    // Same column (x 21.5, z 5.5): crossing below, platform, deck above.
    const [mLow, fLow] = sampleDensityMap(m, 21.25, 5.75, FIX.lowerY + 1);
    const [mMain, fMain] = sampleDensityMap(m, 21.25, 5.75, 1);
    const [mUp, fUp] = sampleDensityMap(m, 21.25, 5.75, FIX.upperY + 1);
    expect(fLow).toBeCloseTo(FIX.lowerY, 1);
    expect(fMain).toBeCloseTo(0, 1);
    expect(fUp).toBeCloseTo(FIX.upperY, 1);
    expect(mLow).toBeGreaterThan(mMain); // damp service crossing (service corridor x lower-level factor)
    expect(mUp).toBeLessThan(mMain * 1.0001);
    // Height falloff is relative to each band's own floor: 1.6 m above every floor reads alike (per multiplier).
    const d = (y: number) => densityAt([21.25, y, 5.75], m, null, ATMOSPHERE, 0);
    expect(d(FIX.upperY + 1.6) / mUp).toBeCloseTo(d(1.6) / mMain, 2);
  });
});

// ---------------------------------------------------------------------------------------------
interface ViewNumbers { meshes: number; triangles: number; callsAvg: number; callsMax: number; trisAvg: number; trisMax: number }
function viewNumbers(group: THREE.Group, cams: {x: number; y: number; z: number}[]): ViewNumbers {
  group.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) meshes.push(m); });
  const tris = (m: THREE.Mesh) => ((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
  const calls: number[] = [], tt: number[] = [];
  for (const c of cams) for (let k = 0; k < 4; k++) {
    cam.position.set(c.x, c.y, c.z); cam.rotation.set(0, k * Math.PI / 2, 0); cam.updateMatrixWorld(true);
    fr.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let n = 0, t = 0;
    for (const m of meshes) {
      const im = m as THREE.InstancedMesh;
      if (im.isInstancedMesh) { if (!im.boundingSphere) im.computeBoundingSphere(); sph.copy(im.boundingSphere!); } else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sph.copy(m.geometry.boundingSphere!); }
      sph.applyMatrix4(m.matrixWorld);
      if (fr.intersectsSphere(sph)) { n++; t += tris(m); }
    }
    calls.push(n); tt.push(t);
  }
  let total = 0;
  for (const m of meshes) total += tris(m);
  const avg = (a: number[]) => Math.round(a.reduce((p, q) => p + q, 0) / a.length);
  return {meshes: meshes.length, triangles: Math.round(total), callsAvg: avg(calls), callsMax: Math.max(...calls), trisAvg: avg(tt), trisMax: Math.max(...tt)};
}
function cameras(layout: StationLayout, n = 8): {x: number; y: number; z: number}[] {
  const levels = stationLevels(layout);
  const out: {x: number; y: number; z: number}[] = [];
  for (const L of levels) {
    const g = L.grid, open: number[] = [];
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && g.rampIdx[i] < 0) open.push(i);
    if (!open.length) continue;
    for (let k = 0; k < n; k++) {
      const i = open[Math.floor((open.length * (k + 0.5)) / n)];
      out.push({x: (i % g.w + 0.5) * CELL, y: g.floorOf(i) + 1.6, z: (Math.floor(i / g.w) + 0.5) * CELL});
    }
  }
  return out;
}

describe('multi-level world build (Node, stubbed canvas)', () => {
  it('fixture: per-level chunked architecture, slab undersides and floors on overlaps, rendered railings', () => {
    const un = installCanvasShim(false);
    try {
      const {layout} = levelFixture();
      const w = buildWorld(layout, mats(), {});
      expect(w.stats.levels).toBe(3);
      expect(w.wallFaces.length).toBeGreaterThan(40);
      expect(w.rails.length).toBe(2);
      const arch: THREE.Mesh[] = [];
      w.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.name.startsWith('arch-')) arch.push(m); });
      expect(new Set(arch.map(m => m.userData.level))).toEqual(new Set([0, 1, 2, -1])); // -1 = stair flights (both levels)
      // Chunks: no architecture mesh is much larger than a chunk (frustum culling has something to cull).
      for (const m of arch) expect(m.geometry.boundingSphere!.radius, m.name).toBeLessThan(CHUNK_M * 0.75 + 6);
      const rc = new THREE.Raycaster();
      const hit = (x: number, y: number, z: number, dy: number) => {
        rc.set(new THREE.Vector3(x, y, z), new THREE.Vector3(0, dy, 0));
        rc.far = 20;
        const h = rc.intersectObjects(arch, false)[0];
        return h ? h.point.y : NaN;
      };
      // Platform under the deck: ceiling = slab underside; deck floor above; crossing ceiling below the platform slab.
      expect(hit(12.1, 2, 5.6, 1)).toBeCloseTo(FIX.platCeil, 3);
      expect(hit(12.1, 6, 5.6, -1)).toBeCloseTo(FIX.upperY, 3);
      expect(hit(12.1, 6, 5.6, 1)).toBeCloseTo(FIX.upperCeil, 3);
      expect(hit(21.6, FIX.lowerY + 1, 5.6, 1)).toBeCloseTo(FIX.lowerCeil, 3);
      expect(hit(21.6, FIX.lowerY + 1, 5.6, -1)).toBeCloseTo(FIX.lowerY, 3);
      // Track bed under the bridge: its own ceiling; in the light well: the upper ceiling (double height).
      expect(hit(7.6, 0, 12.1, 1)).toBeCloseTo(FIX.platCeil, 3);
      expect(hit(20.1, 0, 12.1, 1)).toBeCloseTo(FIX.upperCeil, 3);
      // Railings: steel trim along the well edge at guard height above the deck.
      let railHit = false;
      w.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.name.startsWith('trim-steel')) return;
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!;
        if (b.max.y > FIX.upperY + 1.0 && b.min.y < FIX.upperY + 0.2 && b.min.z < 8 && b.max.z > 7.8) railHit = true;
      });
      expect(railHit).toBe(true);
    } finally { un(); }
  });

  it('every family builds; generated multi-level stations keep faces valid and draw calls bounded', () => {
    const un = installCanvasShim(false);
    const rows: string[] = [];
    try {
      const m = mats();
      const fx = levelFixture().layout;
      const list: [string, StationLayout][] = [['fixture', fx]];
      for (const a of ARCHETYPES) {
        const l = generated(a);
        if (l instanceof Error) throw l;
        list.push([a, l]);
      }
      for (const [name, l] of list) {
        const levels = stationLevels(l);
        const t0 = performance.now();
        const w = buildWorld(l, m, {});
        const ms = performance.now() - t0;
        const v = viewNumbers(w.group, cameras(l));
        rows.push(`${name}: levels ${levels.length}, build ${ms.toFixed(0)} ms, ${w.stats.meshes} meshes (${w.stats.archMeshes} arch), ${v.triangles} tris; in view calls avg ${v.callsAvg} / max ${v.callsMax}, tris avg ${v.trisAvg} / max ${v.trisMax}; faces ${w.wallFaces.length}, rails ${w.rails.length}`);
        expect(faceViolations(l), name).toEqual([]);
        // Budgets (no GLB models here; frustum-culled per-level chunks, see REPORT).
        expect(v.callsMax, name).toBeLessThan(900);
        expect(v.trisMax, name).toBeLessThan(400000);
        for (const f of w.wallFaces) expect(Number.isFinite(f.y0) && Number.isFinite(f.y1) && f.y1 > f.y0, name).toBe(true);
      }
    } finally { un(); }
    console.log(rows.join('\n'));
  });

  it('generated stations: every derived drop edge is railed in layout.rails (when the generator provides levels)', () => {
    const missing: string[] = [];
    for (const a of ARCHETYPES) {
      const l = generated(a);
      if (l instanceof Error) throw l;
      const given = (l as {rails?: ReturnType<typeof deriveRails>}).rails;
      if (stationLevels(l).length < 2 || !given) continue;
      const derived = deriveRails({grid: l.grid, areas: l.areas} as StationLayout);
      const covered = (x: number, z: number, lv: number) => given.some(r => r.level === lv
        && x >= Math.min(r.x0, r.x1) - 0.3 && x <= Math.max(r.x0, r.x1) + 0.3 && z >= Math.min(r.z0, r.z1) - 0.3 && z <= Math.max(r.z0, r.z1) + 0.3);
      for (const r of derived) {
        const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
        for (let s = 0.25; s < len; s += 0.5) {
          const x = r.x0 + (r.x1 - r.x0) * s / len, z = r.z0 + (r.z1 - r.z0) * s / len;
          if (!covered(x, z, r.level)) { missing.push(`${a} L${r.level} @${x.toFixed(2)},${z.toFixed(2)} y ${r.y0.toFixed(2)}`); break; }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('render cost: triangle sanity, overdraw, level / fog culling, draw-call budget', () => {
  const cam = (x: number, y: number, z: number, yaw: number, pitch = 0) => {
    const c = new THREE.PerspectiveCamera(75, 1280 / 720, 0.05, 70);
    c.rotation.order = 'YXZ';
    c.position.set(x, y, z); c.rotation.set(pitch, yaw, 0);
    c.updateMatrixWorld(true);
    return c;
  };
  const shown = (m: THREE.Object3D) => m.layers.test(new THREE.Layers());
  const levelMeshes = (g: THREE.Group, lv: number) => { const out: THREE.Mesh[] = []; g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.level === lv) out.push(m); }); return out; };

  it('no NaN / huge / degenerate architecture triangles; bounded overdraw at the QA poses (seed 1A2B3C stair foot + spawn)', () => {
    const un = installCanvasShim(false);
    try {
      const l = generateStation(codeToSeed('1A2B3C')!);
      const w = buildWorld(l, mats(), {});
      // Sanity over the whole station (a bird's-eye camera sees every mesh).
      const top = new THREE.PerspectiveCamera(170, 1, 0.01, 1e5);
      top.position.set(l.grid.w * CELL / 2, 400, l.grid.h * CELL / 2); top.lookAt(l.grid.w * CELL / 2, 0, l.grid.h * CELL / 2);
      const all = overdraw(w.group, top, 16, 16);
      for (const c of all) {
        expect(c.nan, c.name).toBe(0);
        expect(c.huge, c.name).toBe(0);
        if (/^(arch|trim|sign|traversal|sleepers)/.test(c.name)) expect(c.maxEdge, c.name).toBeLessThanOrEqual(CHUNK_M * Math.SQRT2 + 1);
      }
      let degenerate = 0;
      w.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.name.startsWith('arch-')) return;
        const P = m.geometry.attributes.position, idx = m.geometry.index!;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        for (let t = 0; t < idx.count; t += 3) {
          a.fromBufferAttribute(P, idx.getX(t)); b.fromBufferAttribute(P, idx.getX(t + 1)); c.fromBufferAttribute(P, idx.getX(t + 2));
          if (b.clone().sub(a).cross(c.clone().sub(a)).length() < 1e-8) degenerate++;
        }
      });
      // Zero-area slivers draw no pixels; the builder itself emits none (a few come from Lane W's inset cuts).
      let archTris = 0;
      w.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.name.startsWith('arch-')) archTris += m.geometry.index!.count / 3; });
      expect(degenerate).toBeLessThanOrEqual(Math.ceil(archTris * 0.001));
      // Overdraw (front-facing covered pixels / screen, before depth rejection) and per-mesh cost at the QA poses.
      const sp = l.playerSpawn;
      for (const c of [cam(72.47, 1.62, 24, -Math.PI / 2, 0.15), cam(sp.x, 1.62, sp.z, sp.yaw)]) {
        w.culler.maxDistance = fogCullDistance(MOOD.fogDensity);
        w.culler.update(c, true);
        const r = overdraw(w.group, c, 1280, 720);
        const px = r.reduce((s2, q) => s2 + q.px, 0) / (1280 * 720);
        expect(px).toBeLessThan(4);
        const steel = r.find(q => q.name === 'traversal-steel');
        if (steel) expect(steel.px / (1280 * 720)).toBeLessThan(0.15);
      }
    } finally { un(); }
  });

  it('level culling: hidden levels move to the cull layer; levels seen through a portal stay; fog hides far chunks', () => {
    const un = installCanvasShim(false);
    try {
      const {layout} = levelFixture();
      const w = buildWorld(layout, mats(), {});
      const cu = w.culler;
      expect(cu.portalTiles).toBeGreaterThan(3);
      // Platform 1, looking along it with the light well in view: deck (through the well) drawn, crossing (under the slab) hidden.
      cu.update(cam(6, 1.62, 5.5, -Math.PI / 2 + 0.6), true);
      expect(cu.stats.level).toBe(0);
      expect(levelMeshes(w.group, 1).some(shown)).toBe(true);
      expect(levelMeshes(w.group, 2).length).toBeGreaterThan(0);
      expect(levelMeshes(w.group, 2).every(m => !shown(m))).toBe(true);
      expect(levelMeshes(w.group, 2).every(m => m.layers.isEnabled(CULL_LAYER))).toBe(true);
      // Inside the crossing looking away from its stair: the main level and the deck are hidden.
      // (Iteration 12: yaw 0 looks -z, away from stair core B at z 21.5-23.5; yaw PI looked TOWARD it, where the
      // run's walls are in view and the whole run is now a main<->lower portal, so main correctly stays drawn.)
      cu.update(cam(21.5, FIX.lowerY + 1.62, 12, 0), true);
      expect(cu.stats.level).toBe(2);
      expect(levelMeshes(w.group, 2).some(shown)).toBe(true);
      expect(levelMeshes(w.group, 0).every(m => !shown(m))).toBe(true);
      expect(levelMeshes(w.group, 1).every(m => !shown(m))).toBe(true);
      // In front of the stair opening looking up the flight: the main level shows through the stairwell,
      // and the flight itself (stairs pseudo-level, seen from both levels) is never level-culled.
      const towardStair = cam(21.5, FIX.lowerY + 1.62, 22.5, -Math.PI / 2, 0.25);
      cu.update(towardStair, true);
      expect(levelMeshes(w.group, 0).some(shown)).toBe(true);
      cu.update(cam(21.5, FIX.lowerY + 1.62, 12, Math.PI), true);
      const flights = levelMeshes(w.group, -1);
      expect(flights.length).toBeGreaterThan(0);
      expect(flights.every(shown)).toBe(true);
      // Walking back onto the platform restores everything that is visible again (no stuck layers).
      cu.update(cam(6, 1.62, 5.5, -Math.PI / 2 + 0.6), true);
      expect(levelMeshes(w.group, 0).every(shown)).toBe(true);
      // Fog: from 120 m away every registered chunk is inside opaque fog.
      cu.maxDistance = fogCullDistance(MOOD.fogDensity);
      expect(cu.maxDistance).toBeGreaterThan(50);
      cu.update(cam(-120, 1.62, 5.5, -Math.PI / 2), true);
      expect(cu.stats.fogged).toBeGreaterThan(0);
      expect(levelMeshes(w.group, 0).every(m => !shown(m))).toBe(true);
      cu.reset();
      expect(levelMeshes(w.group, 0).every(shown)).toBe(true);
      // A holder carried off by physics is released (never culled again with a stale box).
      const some = levelMeshes(w.group, 0)[0];
      cu.release([some]);
      expect(cu.entries.some(e => e.obj === some)).toBe(false);
    } finally { un(); }
  });

  it('shader cost: the surface and march decodes pick the level slot from the packed column header, no per-slot loops', () => {
    // iteration 13: the surface decode is TSL (tests/lighting-node.test.ts); the fog march is TSL too (render/volumetricShaders.ts):
    // compiled here for the WebGL2 backend, the station light field is read with exactly three texel fetches per step (the
    // packed slot pick, shared by the density map and the field: column header + the extended-column group texel, read only
    // in a tower column (task office-seamless-20261029); + the slot header) and no loop runs over slots.
    const arr = (c: number) => new THREE.DataArrayTexture(new Uint8Array(4 * c), 1, 1, 4);
    const f = compileQuad(createMarchMaterial(createFogUniforms(), {depth: new THREE.DepthTexture(4, 4), noise: new THREE.Data3DTexture(new Uint8Array(64), 2, 2, 4), density: arr(4), air: arr(1), vis: arr(1), shadow: null}, {steps: 8}), 'glsl').fragment;
    const sampler3D = [...f.matchAll(/uniform (?:highp )?sampler3D (\w+);/g)].map(m => m[1]);
    const fetches = sampler3D.reduce((n, name) => n + (f.match(new RegExp(`texelFetch\\( ${name},`, 'g')) ?? []).length, 0);
    expect(fetches).toBe(3);
    const loops = [...f.matchAll(/for \( int (\w+) = 0; \1 < (\w+); \1 \+\+ \)/g)].map(m => m[2]);
    expect(loops).toEqual(['8', '4', '8', '4']); // steps; smoke emitters + their puffs; scatter lights (no per-slot loop)
  });

  it('draw-call budget with level + fog culling (no GLB models; every family, cameras on every level)', () => {
    const un = installCanvasShim(false);
    const rows: string[] = [];
    try {
      const m = mats();
      for (const a of ARCHETYPES) {
        const l = generated(a);
        if (l instanceof Error) throw l;
        const w = buildWorld(l, m, {});
        w.culler.maxDistance = fogCullDistance(MOOD.fogDensity);
        const cams = cameras(l, 6);
        const calls: number[] = [], tris: number[] = [];
        const pc = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
        pc.rotation.order = 'YXZ';
        for (const c of cams) for (let k = 0; k < 4; k++) {
          pc.position.set(c.x, c.y, c.z); pc.rotation.set(0, k * Math.PI / 2, 0); pc.updateMatrixWorld(true);
          w.culler.update(pc, true);
          const r = overdraw(w.group, pc, 64, 36);
          calls.push(r.reduce((s2, q) => s2 + q.calls, 0)); tris.push(r.reduce((s2, q) => s2 + q.tris, 0));
        }
        const avg = (v: number[]) => Math.round(v.reduce((p, q) => p + q, 0) / v.length);
        rows.push(`${a}: calls avg ${avg(calls)} max ${Math.max(...calls)}, tris avg ${avg(tris)} max ${Math.max(...tris)}`);
        expect(Math.max(...calls), a).toBeLessThan(260);
        expect(avg(calls), a).toBeLessThan(160);
      }
    } finally { un(); }
    console.log(rows.join('\n'));
  });
});
