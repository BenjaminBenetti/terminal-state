// Iteration 05 (Lane L): persistent, camera-independent station lighting + darker mood.
// - the baked light field (world/lightField.ts) is deterministic, covers every working fixture at any
//   distance, respects walls/doors/lintels/per-cell floor heights, and is cheap enough to bake on load;
// - StationLighting (world/lights.ts) never reassigns or switches lights by camera position and adds no
//   dynamic lights (flashlight + muzzle stay the only ones);
// - iteration 13: the WebGL ShaderChunk hook is gone; the TSL lighting node (WebGPURenderer) is covered by
//   tests/lighting-node.test.ts.
// LIGHT_PREVIEW=1 additionally CPU-renders before/after views into qa-artifacts/iter05-lighting/.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {generateStation, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import type {Fixture} from '../src/world/builder';
import {
  DEFAULT_FIELD, FIELD_EMAX, FixtureVisibility, LAYERS, SLOT_DEPTH, fieldDepth,
  bakeLightField, cellFloorFn, columnGeometry, fixtureGroup, groupLevel, sampleField, traceExact,
  type BakedField, type FieldSource,
} from '../src/world/lightField';
import {DYNAMIC_LIGHTS, MOOD, StationLighting} from '../src/world/lights';
import {LightFieldLight, activeLightField} from '../src/world/lightFieldNode';
import {nodeHookKeys} from '../src/render/nodeHooks';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {stationLevels} from '../src/world/levelGeometry';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(GAME, '..');
const lum = (v: readonly number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
/** Irradiance reaching a surface with normal n (what the shader computes before the BRDF). */
function irr(f: BakedField, x: number, y: number, z: number, n: [number, number, number] = [0, 1, 0], levels = [1, 1, 1]): number {
  const s = sampleField(f, x, y, z, levels, n);
  const ndl = Math.max(0, n[0] * s.dir[0] + n[1] * s.dir[1] + n[2] * s.dir[2]);
  return lum(s.amb) + lum(s.dirColor) * ndl;
}
const fixturesOf = (l: StationLayout): Fixture[] => l.lights.map((x, i) => ({x: x.x, y: x.y, z: x.z, broken: x.broken, flicker: x.flicker, warm: x.warm, dying: x.dying, power: x.power, area: x.area, phase: i * 1.7, level: x.broken ? 0 : 1}));
// Iteration 08: generated stations have upper / lower levels; the bake gets every level (one slot each).
const src = (l: StationLayout): FieldSource => ({grid: l.grid, lights: l.lights, trenchFloorY: l.trench.floorY, levels: stationLevels(l)});
/** Floor height under a fixture on its own level. */
const fixtureFloor = (l: StationLayout, x: {x: number; z: number; level?: number}) => {
  const g = stationLevels(l)[x.level ?? 0].grid;
  return cellFloorFn(g, l.trench.floorY)(...g.cellOf(x.x, x.z));
};

const stations = new Map<number, StationLayout>();
const station = (seed: number) => { let s = stations.get(seed); if (!s) stations.set(seed, (s = generateStation(seed))); return s; };
const bakes = new Map<number, BakedField>();
const baked = (seed: number) => { let b = bakes.get(seed); if (!b) bakes.set(seed, (b = bakeLightField(src(station(seed))))); return b; };

// ---------------------------------------------------------------------------------------------
describe('baked light field (camera independent)', () => {
  it('is deterministic, compact and cheap to bake on load', () => {
    const l = station(3);
    const a = bakeLightField(src(l)), b = bakeLightField(src(l));
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(a.depth).toBe(fieldDepth(a.slots)); // iteration 08: slot mask + one slot per level
    expect(SLOT_DEPTH).toBe(1 + 2 * LAYERS);
    expect(a.stats.bytes).toBe(l.grid.w * l.grid.h * a.depth * 4);
    // Iteration 08: one slot per level (main 4 layers, upper/lower AUX_LAYERS): 3-level stations measure 6-13 MB.
    expect(a.stats.bytes).toBeLessThan(16e6);
    expect(a.stats.ms).toBeLessThan(3000); // node CI budget; typically ~150-350 ms
    expect(Buffer.from(bakeLightField(src(station(4))).data).equals(Buffer.from(a.data))).toBe(false);
    console.log(`light field ${a.w}x${a.h}x${a.depth} RGBA8 = ${(a.stats.bytes / 1e6).toFixed(2)} MB, bake ${a.stats.ms.toFixed(0)} ms (warm ${b.stats.ms.toFixed(0)} ms), working ${a.stats.working}/${a.stats.fixtures}, circuits ${a.stats.circuits.join('/')}`);
  });

  it('every working fixture lights the floor below it, near or far from the spawn', () => {
    for (const seed of [1, 2, 6]) {
      const l = station(seed), f = baked(seed);
      const sp = l.playerSpawn;
      let far = 0;
      for (const x of l.lights) {
        if (x.broken || x.dying) continue;
        const g = stationLevels(l)[x.level ?? 0].grid;
        const [cx, cy] = g.cellOf(x.x, x.z);
        if (g.get(cx, cy) === SOLID) continue;
        // Iteration 08: light-well lamps hang ~9 m above the track bed; check them 4.4 m below the lamp
        // (a normal platform mounting height) instead of on the far floor.
        const e = irr(f, x.x, Math.max(fixtureFloor(l, x) + 0.02, x.y - 4.4), x.z);
        expect(e, `seed ${seed} fixture @${x.x.toFixed(1)},${x.z.toFixed(1)} power ${x.power.toFixed(2)}`).toBeGreaterThan(0.25 * x.power);
        if (Math.hypot(x.x - sp.x, x.z - sp.z) > 40) far++;
      }
      expect(far, 'fixtures > 40 m from the spawn checked').toBeGreaterThan(20);
    }
  });

  it('dark areas stay dark; lit areas get pools brighter than the gaps between fixtures', () => {
    const l = station(2), f = baked(2), g = l.grid;
    const fl = cellFloorFn(g, l.trench.floorY);
    const mean = (pred: (a: number) => boolean) => {
      let s = 0, n = 0;
      for (let i = 0; i < g.cells.length; i++) {
        if (g.cells[i] !== FLOOR || !pred(g.area[i])) continue;
        const cx = i % g.w, cy = (i - cx) / g.w;
        s += irr(f, (cx + 0.5) * CELL, fl(cx, cy) + 0.02, (cy + 0.5) * CELL, [0, 1, 0], [1, 1, 0]); n++;
      }
      return n ? s / n : 0;
    };
    const lit = mean(a => l.areas[a]?.lighting === 'lit');
    const dark = mean(a => l.areas[a]?.lighting === 'dark');
    expect(lit).toBeGreaterThan(0.4);
    expect(dark).toBeLessThan(lit * 0.2);
    // Pools: directly under a steady platform fixture vs the darkest point of the platform floor.
    const P = l.areas[l.platform];
    const under = l.lights.filter(x => x.area === P.id && !x.broken && !x.flicker).map(x => irr(f, x.x, 0.02, x.z));
    let lo = Infinity;
    for (let cy = P.y + 2; cy < P.y + P.h - 2; cy++) for (let cx = P.x + 2; cx < P.x + P.w - 2; cx++) lo = Math.min(lo, irr(f, (cx + 0.5) * CELL, 0.02, (cy + 0.5) * CELL));
    const med = under.sort((a, b) => a - b)[Math.floor(under.length / 2)];
    expect(med).toBeGreaterThan(lo * 2);
    console.log(`floor irradiance: lit areas ${lit.toFixed(2)}, dark areas ${dark.toFixed(3)}, platform pools ${med.toFixed(2)} vs darkest ${lo.toFixed(3)}`);
  });

  it('StationLighting renders identical state wherever the camera is, with no pooled/dynamic lights (one field light)', () => {
    const l = station(1);
    const run = (cams: THREE.Vector3[]) => {
      const scene = new THREE.Scene();
      const fixtures = fixturesOf(l);
      const tubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 0.05), new MeshBasicNodeMaterial(), fixtures.length);
      const hemi = new THREE.HemisphereLight();
      const sl = new StationLighting(scene, l, fixtures, tubes, {hemi, fogDensity: MOOD.fogDensity, far: 70});
      const frames: string[] = [];
      for (const cam of cams) {
        sl.update(1 / 30, cam);
        frames.push(JSON.stringify({
          levels: sl.levels, res: sl.volume.resolution.toArray(), hemi: hemi.intensity, ambient: sl.ambient,
          tubes: Array.from(tubes.instanceColor!.array as Float32Array).map(v => v.toFixed(4)).join(','),
          glow: Array.from(sl.glow!.instanceColor!.array as Float32Array).map(v => v.toFixed(4)).join(','),
          fix: fixtures.map(x => x.level.toFixed(3)).join(','),
        }));
      }
      let lights = 0, fieldLights = 0;
      scene.traverse(o => { if ((o as THREE.Light).isLight) { lights++; if (o instanceof LightFieldLight) fieldLights++; } });
      return {frames, lights, fieldLights, scene, sl};
    };
    const sp = l.playerSpawn, g = l.grid;
    const near = Array.from({length: 120}, () => new THREE.Vector3(sp.x, 1.6, sp.z));
    const far = Array.from({length: 120}, (_, i) => new THREE.Vector3((i * 37) % (g.w * CELL), 1.6, (i * 53) % (g.h * CELL)));
    const a = run(near);
    expect(a.lights).toBe(1); // iteration 13: only the session's static field light (no pooled / dynamic lights)
    expect(a.fieldLights).toBe(1);
    expect(activeLightField()).toBe(a.sl.volume);
    const b = run(far);
    expect(b.frames).toEqual(a.frames);
    expect(a.sl.lights.length).toBe(0);
    expect(DYNAMIC_LIGHTS).toBe(2); // flashlight + muzzle flash (game.ts) are the only dynamic lights
    // Hemisphere is a constant floor, never driven by the camera's area.
    expect(new Set(a.frames.map(fr => JSON.parse(fr).hemi)).size).toBe(1);
    // Flickering circuits actually animate (and identically for both cameras).
    expect(new Set(a.frames.map(fr => JSON.parse(fr).levels.join())).size).toBeGreaterThan(1);
    b.sl.dispose(b.scene);
    expect(b.scene.children.length).toBe(0);
    // Tubes: display-referred (iteration 12: never tone-mapped down) and a gentler fog curve so working lights read through
    // the haze — node hooks under WebGPURenderer (tests/lighting-node.test.ts compiles them).
    const tm = new MeshBasicNodeMaterial();
    const tubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 0.05), tm, l.lights.length);
    const sc2 = new THREE.Scene();
    const sl2 = new StationLighting(sc2, l, fixturesOf(l), tubes);
    expect(tm.toneMapped).toBe(false);
    expect(tm.fog).toBe(false);
    expect(tm.userData.glowFog).toBe(MOOD.glowFog);
    expect(nodeHookKeys(tm)).toEqual(['glow-fog', 'display-referred']);
    sl2.dispose(sc2);
  });

  it('flicker circuits: tubes, glow and field follow layout state + circuit level', () => {
    const l = station(6), f = baked(6);
    for (let i = 0; i < l.lights.length; i++) {
      const x = l.lights[i], gq = fixtureGroup(x, i);
      expect(f.groups[i]).toBe(gq);
      if (x.broken) expect(gq).toBe(-1);
      else if (x.dying) expect(gq).toBe(2);
      else if (x.flicker) expect([0, 1]).toContain(gq);
      else expect(gq).toBe(-1);
    }
    // Dying circuit is mostly dark; flicker circuits mostly on.
    const ts = Array.from({length: 2000}, (_, i) => i * 0.05);
    const share = (g: number, pred: (v: number) => boolean) => ts.filter(t => pred(groupLevel(g, t))).length / ts.length;
    expect(share(2, v => v === 0)).toBeGreaterThan(0.6);
    expect(share(0, v => v > 0.9)).toBeGreaterThan(0.6);
    expect(share(1, v => v > 0.9)).toBeGreaterThan(0.6);
    // A dying fixture's pool exists only while its circuit sputters.
    const dying = l.lights.find(x => !x.broken && x.dying);
    if (dying) {
      const fl = fixtureFloor(l, dying);
      const on = irr(f, dying.x, fl + 0.02, dying.z, [0, 1, 0], [1, 1, 1]);
      const off = irr(f, dying.x, fl + 0.02, dying.z, [0, 1, 0], [1, 1, 0]);
      expect(on).toBeGreaterThan(off * 3);
    }
  });

  it('falls back to a coarser volume when the GPU 3D texture limit is small (WebGL2 guarantees 256)', () => {
    const l = station(4), f = baked(4);
    const scene = new THREE.Scene();
    const sl = new StationLighting(scene, l, fixturesOf(l), null, {max3DTextureSize: 256});
    const k = Math.ceil(Math.max(f.w, f.h) / 256);
    expect(k).toBeGreaterThan(1);
    expect(sl.field.cellScale).toBe(k);
    expect(Math.max(sl.field.w, sl.field.h)).toBeLessThanOrEqual(256);
    // Same world extent (texel size derives from bounds / texture size in the shader).
    expect(sl.volume.boundingBox.max.x).toBeGreaterThanOrEqual(f.w * CELL);
    expect(sl.volume.boundingBox.max.x / sl.field.w).toBeCloseTo(CELL * k, 6);
    // Light under steady fixtures survives the downsample (no fixture goes dark).
    for (const x of l.lights.filter(q => !q.broken && !q.flicker && !q.dying && q.power > 0.8).slice(0, 60)) {
      const y = fixtureFloor(l, x) + 0.02;
      expect(irr(sl.field, x.x, y, x.z)).toBeGreaterThan(irr(f, x.x, y, x.z) * 0.3);
    }
    sl.dispose(scene);
  });

  it('fast visibility agrees with the exact per-ray DDA', () => {
    const l = station(5);
    const s = src(l);
    const geo = columnGeometry(s);
    const vis = new FixtureVisibility(l.grid, geo.open, geo.floorH, geo.ceilH, geo.layerY, LAYERS);
    const a = new Float32Array(LAYERS), b = new Float32Array(LAYERS);
    let agree = 0, total = 0, fastOnly = 0, exactOnly = 0;
    const W = l.grid.w;
    const working = l.lights.filter(x => !x.broken);
    for (let n = 0; n < working.length; n += 4) {
      const x = working[n];
      const [fx, fz] = l.grid.cellOf(x.x, x.z);
      const fi = fz * W + fx;
      if (!geo.open[fi]) continue;
      const fy = Math.max(geo.floorH[fi] + 0.3, Math.min(x.y - 0.05, geo.ceilH[fi] - 0.06));
      vis.begin(x.x, x.z, fy);
      for (let cy = fz - 18; cy <= fz + 18; cy++) for (let cx = fx - 18; cx <= fx + 18; cx++) {
        if (!l.grid.inBounds(cx, cy) || !geo.open[cy * W + cx]) continue;
        const d = Math.hypot((cx + 0.5) * CELL - x.x, (cy + 0.5) * CELL - x.z);
        if (d > DEFAULT_FIELD.range) continue;
        const okA = vis.query(cx, cy, d, a);
        const okB = traceExact(l.grid, geo.open, geo.floorH, geo.ceilH, x.x, x.z, fy, cx, cy, geo.layerY, (cy * W + cx) * LAYERS, LAYERS, b);
        for (let k = 0; k < LAYERS; k++) {
          const va = okA && a[k] > 0, vb = okB && b[k] > 0;
          total++;
          if (va === vb) agree++; else if (va) fastOnly++; else exactOnly++;
        }
      }
    }
    const rate = agree / total;
    console.log(`visibility agreement ${(rate * 100).toFixed(2)}% of ${total} (fast-only ${fastOnly}, exact-only ${exactOnly})`);
    expect(rate).toBeGreaterThan(0.95);
  });
});

// ---------------------------------------------------------------------------------------------
describe('occlusion and heights (synthetic grids)', () => {
  /** w x h grid, solid border, everything else FLOOR with ceiling `ceil`. */
  function box(w: number, h: number, ceil = 4.4): Grid {
    const g = new Grid(w, h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { g.set(x, y, FLOOR); g.ceil[y * w + x] = ceil; g.area[y * w + x] = 0; }
    return g;
  }
  const light = (x: number, z: number, y = 4.35) => ({x, y, z, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false});
  const wall = (g: Grid, x: number) => { for (let y = 0; y < g.h; y++) g.set(x, y, SOLID); };

  it('walls stop light completely; a door lets it spill only along line of sight', () => {
    const g = box(60, 24);
    wall(g, 30);
    for (let y = 0; y < g.h; y++) for (let x = 31; x < 59; x++) if (g.get(x, y) === FLOOR) g.area[y * g.w + x] = 1;
    const lights = [light(11, 6)];
    const sealed = bakeLightField({grid: g, lights, trenchFloorY: -1.15});
    expect(irr(sealed, 16, 0.02, 6)).toBe(0); // room B, right behind the wall
    expect(irr(sealed, 25, 0.02, 3)).toBe(0);
    expect(irr(sealed, 10, 0.02, 6)).toBeGreaterThan(0.3); // room A
    // Door at z 5..7 m (cells 10..13) in the wall.
    for (let y = 10; y < 14; y++) { g.set(30, y, FLOOR); g.ceil[y * g.w + 30] = 4.4; }
    const door = bakeLightField({grid: g, lights, trenchFloorY: -1.15});
    expect(irr(door, 17, 0.02, 6)).toBeGreaterThan(0.01); // in line with the door
    expect(irr(door, 17, 0.02, 11)).toBeLessThan(irr(door, 17, 0.02, 6) * 0.25); // out of line: bounce only
  });

  it('a low lintel shadows the upper wall beyond the door but not the floor', () => {
    const g = box(60, 24);
    wall(g, 30);
    for (let y = 10; y < 14; y++) { g.set(30, y, FLOOR); g.ceil[y * g.w + 30] = 2.1; }
    const f = bakeLightField({grid: g, lights: [light(13, 6)], trenchFloorY: -1.15});
    // Just past the door: floor lit through the opening, the space near the ceiling blocked by the lintel.
    expect(irr(f, 16.5, 0.02, 6)).toBeGreaterThan(0.02);
    const s = sampleField(f, 16.5, 4.2, 6);
    expect(lum(s.amb) + lum(s.dirColor)).toBeLessThan(irr(f, 16.5, 0.02, 6) * 0.5);
  });

  it('per-cell floor heights: a lower level is not lit through the floor above it', () => {
    const g = box(60, 20);
    // x >= 30: lower level (floor -3.4, ceiling -0.3), open to the upper hall along x = 30 (a stair head).
    const floor = new Float32Array(g.w * g.h);
    for (let y = 0; y < g.h; y++) for (let x = 30; x < g.w; x++) { floor[y * g.w + x] = -3.4; g.ceil[y * g.w + x] = -0.3; if (g.get(x, y) === FLOOR) g.area[y * g.w + x] = 1; }
    (g as Grid & {floor: Float32Array}).floor = floor;
    expect(cellFloorFn(g, -1.15)(40, 10)).toBeCloseTo(-3.4, 5);
    const fUpper = bakeLightField({grid: g, lights: [light(10, 5)], trenchFloorY: -1.15});
    expect(irr(fUpper, 22, -3.38, 5)).toBe(0); // deep inside the lower level
    expect(irr(fUpper, 10, 0.02, 5)).toBeGreaterThan(0.3);
    // The lower level is lit by its own fixtures.
    const fLower = bakeLightField({grid: g, lights: [light(22, 5, -0.4)], trenchFloorY: -1.15});
    expect(irr(fLower, 22, -3.38, 5)).toBeGreaterThan(0.3);
    expect(irr(fLower, 5, 0.02, 5)).toBeLessThan(0.02); // and that light stays below
  });

  it('track bed cells default to the trench floor', () => {
    const g = box(20, 20);
    for (let y = 8; y < 12; y++) for (let x = 1; x < 19; x++) g.set(x, y, VOID);
    const fl = cellFloorFn(g, -1.15);
    expect(fl(5, 9)).toBeCloseTo(-1.15, 5);
    expect(fl(5, 3)).toBe(0);
    const geo = columnGeometry({grid: g, lights: [], trenchFloorY: -1.15});
    expect(geo.floorH[9 * 20 + 5]).toBeCloseTo(-1.15, 5);
    expect(FIELD_EMAX).toBeGreaterThan(4);
  });
});

// ---------------------------------------------------------------------------------------------
describe.runIf(!!process.env.LIGHT_PREVIEW)('CPU lighting previews (LIGHT_PREVIEW=1)', () => {
  it('renders before/after views', async () => {
    const sharp = (await import('sharp')).default;
    const {previewScene, renderPreview} = await import('./helpers/lightPreview');
    const out = path.join(REPO, 'qa-artifacts', 'iter05-lighting');
    fs.mkdirSync(out, {recursive: true});
    const W = 400, H = 225;
    const seeds = (process.env.LIGHT_PREVIEW_SEEDS ?? '1,6').split(',').map(Number);
    for (const seed of seeds) {
      const l = station(seed), f = baked(seed), sc = previewScene(l);
      const P = l.areas[l.platform], sp = l.playerSpawn;
      const food = l.areas.find(a => a.type === 'food-court')!;
      const views: {label: string; cam: {x: number; y: number; z: number; yaw: number; pitch: number; fov: number}}[] = [];
      views.push({label: 'spawn', cam: {x: sp.x, y: 1.6, z: sp.z, yaw: sp.yaw, pitch: 0.02, fov: 75}});
      // Down the full length of platform 1 from one end (distant fixtures).
      const pz = (P.y + P.h / 2) * CELL;
      views.push({label: 'platform length', cam: {x: (P.x + 3) * CELL, y: 1.6, z: pz, yaw: -Math.PI / 2, pitch: 0.04, fov: 75}});
      const fz = food.w >= food.h;
      views.push({label: 'food court', cam: {x: (food.x + (fz ? 3 : food.w / 2)) * CELL, y: 1.6, z: (food.y + (fz ? food.h / 2 : 3)) * CELL, yaw: fz ? -Math.PI / 2 : Math.PI, pitch: 0.05, fov: 75}});
      // Underpass (iteration 05 traversal: below the track bed, lit by its own fixtures).
      const bar = l.areas.filter(a => a.type === 'underpass').sort((p, q) => cellFloorFn(l.grid, l.trench.floorY)(p.x + 1, p.y + 1) - cellFloorFn(l.grid, l.trench.floorY)(q.x + 1, q.y + 1))[0];
      if (bar) {
        const flu = cellFloorFn(l.grid, l.trench.floorY)(bar.x + Math.floor(bar.w / 2), bar.y + 1);
        const along = bar.h >= bar.w;
        views.push({label: 'underpass', cam: {x: (bar.x + (along ? bar.w / 2 : 1.5)) * CELL, y: flu + 1.6, z: (bar.y + (along ? 1.5 : bar.h / 2)) * CELL, yaw: along ? Math.PI : -Math.PI / 2, pitch: 0, fov: 75}});
      }
      // Into a dark back-of-house room through its door.
      const darkDoor = l.doors.find(d => { const a = l.areas[d.a], b = l.areas[d.b]; return (a.lighting === 'dark') !== (b.lighting === 'dark') && d.w + d.h >= 4; });
      if (darkDoor) {
        const a = l.areas[darkDoor.a], b = l.areas[darkDoor.b];
        const lit = a.lighting === 'dark' ? b : a;
        const dx = (darkDoor.x + darkDoor.w / 2) * CELL, dz = (darkDoor.y + darkDoor.h / 2) * CELL;
        const lx = (lit.x + lit.w / 2) * CELL, lz = (lit.y + lit.h / 2) * CELL;
        const v = [dx - lx, dz - lz], vl = Math.hypot(v[0], v[1]);
        const horiz = darkDoor.h === 1;
        const dir = horiz ? [0, Math.sign(v[1])] : [Math.sign(v[0]), 0];
        void vl;
        views.push({label: `door into dark ${(a.lighting === 'dark' ? a : b).type}`, cam: {x: dx - dir[0] * 3.5, y: 1.6, z: dz - dir[1] * 3.5, yaw: Math.atan2(-dir[0], -dir[1]), pitch: -0.05, fov: 75}});
      }
      const rows: Buffer[] = [];
      const labels: string[] = [];
      for (const v of views) {
        const before = renderPreview(sc, v.cam, {mode: 'before', mood: MOOD, width: W, height: H});
        const after = renderPreview(sc, v.cam, {mode: 'after', mood: MOOD, field: f, width: W, height: H});
        const afterNoFlash = renderPreview(sc, v.cam, {mode: 'after', mood: MOOD, field: f, width: W, height: H, flashlight: false});
        const row = Buffer.alloc(W * 3 * H * 3);
        for (let y = 0; y < H; y++) {
          before.copy(row, (y * W * 3) * 3, y * W * 3, (y + 1) * W * 3);
          after.copy(row, (y * W * 3 + W) * 3, y * W * 3, (y + 1) * W * 3);
          afterNoFlash.copy(row, (y * W * 3 + 2 * W) * 3, y * W * 3, (y + 1) * W * 3);
        }
        rows.push(row);
        labels.push(v.label);
      }
      // Plan view of floor irradiance over the whole station: r4 (lights pooled around the spawn camera,
      // hemisphere of the spawn area) vs r5 (every working fixture, baked). Tone-mapped like the previews.
      {
        const g = l.grid, PW = g.w, PH = g.h, plan = Buffer.alloc(PW * 2 * PH * 3, 0);
        const fl = cellFloorFn(g, l.trench.floorY);
        const pool = new Set((() => {
          const sc2: {i: number; s: number}[] = [];
          l.lights.forEach((x, i) => { if (x.broken) return; const d = Math.hypot(x.x - sp.x, x.z - sp.z); if (d > 16) return; sc2.push({i, s: d * (g.lineOfSight(sp.x, sp.z, x.x, x.z) ? 1 : 2.2)}); });
          return sc2.sort((p, q) => p.s - q.s).slice(0, 8).map(s2 => s2.i);
        })());
        const tm = (e: number, exp: number) => { const v = e * 0.2 * exp / 0.6; const t = (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081); const c = Math.min(1, Math.max(0, t)); return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255); };
        for (let cy = 0; cy < PH; cy++) for (let cx = 0; cx < PW; cx++) {
          if (g.cells[cy * PW + cx] === SOLID) continue;
          const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL, y = fl(cx, cy);
          let e4 = 0.6 * 0.5;
          for (const li of pool) { const q = l.lights[li]; const dd = Math.hypot(q.x - x, q.y - 0.3 - y, q.z - z); const ndl = (q.y - 0.3 - y) / dd; e4 += 20 * q.power * Math.min(1.5, Math.max(0.8, Math.pow(Math.max(0.01, q.y) / 3.2, 1.3))) / Math.pow(dd, 1.6) * Math.pow(Math.max(0, 1 - Math.pow(dd / 12, 4)), 2) * ndl; }
          const e5 = irr(f, x, y + 0.02, z) + MOOD.ambient * 0.9;
          const o4 = ((PH - 1 - cy) * PW * 2 + cx) * 3, o5 = o4 + PW * 3;
          const v4 = tm(e4, 1), v5 = tm(e5, MOOD.exposure);
          plan[o4] = plan[o4 + 1] = plan[o4 + 2] = v4;
          plan[o5] = v5; plan[o5 + 1] = v5; plan[o5 + 2] = v5;
        }
        const [sx, sz] = g.cellOf(sp.x, sp.z);
        for (let k = -3; k <= 3; k++) for (const [ox, oy] of [[k, 0], [0, k]]) {
          const xx = sx + ox, yy = PH - 1 - (sz + oy);
          if (xx < 0 || yy < 0 || xx >= PW || yy >= PH) continue;
          for (const base of [0, PW]) { const o = (yy * PW * 2 + xx + base) * 3; plan[o] = 255; plan[o + 1] = 40; plan[o + 2] = 40; }
        }
        await sharp(plan, {raw: {width: PW * 2, height: PH, channels: 3}}).resize(PW * 4, PH * 2, {kernel: 'nearest'}).png().toFile(path.join(out, `floor-plan-seed${seed}.png`));
      }
      const LH = 20, TW = W * 3, TH = rows.length * (H + LH);
      const big = Buffer.alloc(TW * TH * 3, 16);
      rows.forEach((r, i) => r.copy(big, ((i * (H + LH) + LH) * TW) * 3));
      const svg = `<svg width="${TW}" height="${TH}">${labels.map((t, i) => `<text x="6" y="${i * (H + LH) + 15}" font-family="DejaVu Sans" font-size="13" fill="#ddd">seed ${seed} · ${t} — left: r4 model (pooled nearest lights, area-following ambient) · middle: r5 baked field + flashlight · right: r5 flashlight off</text>`).join('')}</svg>`;
      await sharp(big, {raw: {width: TW, height: TH, channels: 3}}).composite([{input: Buffer.from(svg)}]).png().toFile(path.join(out, `before-after-seed${seed}.png`));
    }
  }, 600000);
});
