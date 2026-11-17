// Task studio-mall-parking-glass-followup-20261117-043548-01: the Mall exterior views' VEHICLES are the game's EXISTING cooked wreck models
// (world/mallVehicles.ts planning, world/mallStreetExit.ts vehicleMeshes; user: "Use the existing destroyed car assets"), never block
// stand-ins:
//  - the catalogue: the Skyways street wrecks + the Office car / bus at Surface Run's checked sizes, the files present at their bytes, the
//    Mall allowed to fetch exactly these (no other Skyways kit), Game.sectionModelKeys' hook;
//  - the cooked files themselves (stripped of textures: Node has no decoder): grounded at y = 0, centred, nose along X, the catalogue size;
//  - placement (pure): deterministic, its own stream, burnt plan car -> the burnt sedan, a bus spot -> the bus, the far rows the lighter
//    wrecks, never two footprints touching, a model that did not load substituted within its class, else nothing;
//  - a real build with the models: one InstancedMesh per model part per view on the library's own geometry (no clone) and one shared
//    material per source material (not per car / view); every car on its support (the lot / the deck / the road), inside its view
//    volume, clear of the light poles; tagged like the view (storeys / aperture); bounded triangles; drawn from the glass by the culler.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {visibleMeshes} from './helpers/visibleMeshes';
import type {StationLayout} from '../src/gen/stationTypes';
import {generateMallLevel} from '../src/gen/mall/index';
import {mallQaPose} from '../src/gen/mall/qa';
import {SURFACE_WRECK_MODEL} from '../src/gen/surface/kinds';
import {assetAllowedIn, selectLevelKeys} from '../src/assets/levelAssets';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {CULL_LAYER} from '../src/world/levelCulling';
import {MALL_FOG} from '../src/world/mallAtmosphere';
import {LOT, planLot} from '../src/world/mallWindows';
import {modelParts} from '../src/world/exterior';
import {
  MALL_BURNT_MODEL, MALL_BUS_MODEL, MALL_CAR_MODELS, MALL_VEHICLE_MODELS, drawnKey, footprintsTouch, mallVehicleModelKeysFor,
  placeVehicles, type VehiclePlace, type VehicleSpot,
} from '../src/world/mallVehicles';

installCanvasShim(false);
const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['office-bus-wreck', 'office-car-wreck', 'skyways-wreck-sedan-burnt', 'skyways-wreck-sedan-rust', 'skyways-wreck-sedan-stripped', 'skyways-wreck-suv'];
const cache = new Map<string, StationLayout>();
const gen = (seed: number, version?: number): StationLayout => {
  const key = `${seed}:${version ?? 'cur'}`;
  let L = cache.get(key);
  if (!L) cache.set(key, (L = generateMallLevel({levelSeed: seed, startWeapon: 'pistol', ...(version !== undefined ? {layoutVersion: version} : {})})));
  return L;
};
let models: Record<string, GLTF> = {};
beforeAll(async () => { for (const k of KEYS) models[k] = await loadStripped(MALL_VEHICLE_MODELS[k].url); }, 60_000);

describe('mall vehicles: the catalogue', () => {
  it('the cooked wrecks at their checked sizes, files present; the Mall may fetch exactly these; the section model keys hook', () => {
    expect(Object.keys(MALL_VEHICLE_MODELS).sort()).toEqual(KEYS);
    for (const m of [...MALL_CAR_MODELS, MALL_BURNT_MODEL, MALL_BUS_MODEL]) {
      const kind = Object.values(SURFACE_WRECK_MODEL).find(q => q.key === m.key)!;
      expect(kind, m.key).toBeDefined();
      expect(MALL_VEHICLE_MODELS[m.key]).toMatchObject({url: kind.url, k: kind.k, w: kind.w, h: kind.h, d: kind.d});
      expect(fs.statSync(path.join(GAME, 'public', m.url)).size, m.url).toBe(m.bytes);
      expect(assetAllowedIn('mall', m.url), m.url).toBe(true);
      expect(assetAllowedIn('surface', m.url)).toBe(true);
      expect(assetAllowedIn('skyways', m.url)).toBe(true);
      expect(assetAllowedIn('subway', m.url) === m.key.startsWith('office-'), `${m.url} elsewhere`).toBe(true); // (the Office files are shared)
    }
    // the rest of the Skyways kit stays Skyways' (+ Surface's)
    for (const url of ['assets/models/skyways-prize-car.glb', 'assets/models/skyways-wreck-army-truck.glb'.replace('wreck-army-truck', 'mascot-statue'), 'assets/textures/skyways/convention-atlas.png']) {
      expect(assetAllowedIn('mall', url), url).toBe(false);
      expect(assetAllowedIn('skyways', url)).toBe(true);
    }
    const files = Object.fromEntries(Object.values(MALL_VEHICLE_MODELS).map(m => [m.key, {url: m.url, bytes: m.bytes}]));
    expect(selectLevelKeys('mall', KEYS, files)).toEqual({keys: KEYS, foreign: []});
    // the hook: a Mall with an exterior view (exits / window walls) fetches them all; anything else none
    expect(mallVehicleModelKeysFor(gen(2))).toEqual(KEYS);
    expect(mallVehicleModelKeysFor(gen(1, 1))).toEqual((gen(1, 1).mall!.exits?.length ?? 0) > 0 ? KEYS : []);
    expect(mallVehicleModelKeysFor({})).toEqual([]);
    expect(mallVehicleModelKeysFor({mall: {exits: [], windows: []}})).toEqual([]);
    const src = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    expect(src).toMatch(/sectionModelKeys[^\n]*mallVehicleModelKeysFor/);
  }, 60_000);

  it('the cooked files: grounded at y = 0, centred, nose along X, at the catalogue size (x k)', () => {
    for (const k of KEYS) {
      const m = MALL_VEHICLE_MODELS[k], b = new THREE.Box3().setFromObject(models[k].scene), s = b.getSize(new THREE.Vector3()).multiplyScalar(m.k);
      expect(Math.abs(b.min.y), `${k} grounded`).toBeLessThan(0.01);
      expect(Math.abs(b.min.x + b.max.x) / 2, `${k} centred x`).toBeLessThan(0.05);
      expect(Math.abs(b.min.z + b.max.z) / 2, `${k} centred z`).toBeLessThan(0.05);
      expect(s.x).toBeGreaterThan(s.z * 1.8); // long along X
      expect(s.x).toBeCloseTo(m.w, 2);
      expect(s.y).toBeCloseTo(m.h, 2);
      expect(s.z).toBeCloseTo(m.d, 2);
    }
    // real-world sizes beside a person (Surface Run's scale check, 2026-11-16): cars 4.6-4.9 m x 1.3-1.7 m, the bus ~9.4 m x ~3.4 m
    for (const m of [...MALL_CAR_MODELS, MALL_BURNT_MODEL]) expect(m.w >= 4.4 && m.w <= 5.0 && m.h >= 1.25 && m.h <= 1.75 && m.d >= 1.7 && m.d <= 2.2, m.key).toBe(true);
    expect(MALL_BUS_MODEL.w * 1).toBeGreaterThan(9);
    expect(MALL_BUS_MODEL.h).toBeLessThan(3.5);
  });
});

describe('mall vehicles: placement (pure)', () => {
  const spots = (n: number, seed: number, o: Partial<VehicleSpot> = {}): VehicleSpot[] => {
    let s = seed;
    const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
    return Array.from({length: n}, (_, i) => ({u: (i % 20) * 2.6, y: 0, w: 4 + Math.floor(i / 20) * 12, yaw: (r() - 0.5) * 0.7 + (r() < 0.5 ? Math.PI : 0), kind: 'car' as const, burnt: r() < 0.12, ...o}));
  };

  it('deterministic per seed; burnt -> the burnt sedan, bus -> the bus; the far rows only the lighter wrecks; every near model used', () => {
    const sp = spots(80, 3);
    const a = placeVehicles(sp, 11), b = placeVehicles(sp, 11), c = placeVehicles(sp, 12);
    expect(b).toEqual(a);
    expect(c.map(p => p.key)).not.toEqual(a.map(p => p.key));
    const lighter = new Set(MALL_CAR_MODELS.filter(m => m.far > 0).map(m => m.key));
    expect(lighter.size).toBeGreaterThan(0);
    const far = placeVehicles(sp.map(s => ({...s, burnt: false})), 11, () => true);
    for (const p of far) expect(lighter.has(p.key), p.key).toBe(true);
    const near = placeVehicles(sp.map(s => ({...s, burnt: false})), 11);
    expect(new Set(near.map(p => p.key))).toEqual(new Set(MALL_CAR_MODELS.map(m => m.key)));
    for (const p of placeVehicles(sp.map(s => ({...s, burnt: true})), 11)) expect(p.key).toBe(MALL_BURNT_MODEL.key);
    for (const p of placeVehicles(spots(4, 5, {kind: 'bus', w: 4, burnt: false}).map((s, i) => ({...s, u: i * 14})), 11)) expect(p.key).toBe(MALL_BUS_MODEL.key);
    // the stream never depends on a spot's class: the cars after a bus spot pick exactly as after a car spot
    const mixed = sp.slice(0, 10).map((s, i) => (i === 0 ? {...s, kind: 'bus' as const, w: -40} : s));
    expect(placeVehicles(mixed, 11).slice(1).map(p => p.key)).toEqual(placeVehicles([{...sp[0], w: -40}, ...sp.slice(1, 10)], 11).slice(1).map(p => p.key));
    // the plan heading turned to the model frame (Z-long stand-ins -> nose +X): unless straightened
    for (const p of a) {
      const s = sp.find(q => q.u === p.u && q.w === p.w)!;
      const d = p.yaw - (s.yaw - Math.PI / 2);
      expect(Math.abs(d) < 1e-9 || Math.abs(p.yaw / (Math.PI / 2) - Math.round(p.yaw / (Math.PI / 2))) < 1e-9).toBe(true);
    }
  });

  it('never two footprints touching at one height (askew cars straightened, else dropped); separating-axis test sanity', () => {
    const dense = spots(120, 9).map((s, i) => ({...s, u: (i % 30) * 2.1, w: 3 + Math.floor(i / 30) * 4.2}));
    const out = placeVehicles(dense, 4);
    expect(out.length).toBeGreaterThan(30);
    expect(out.length).toBeLessThan(dense.length);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      if (Math.abs(out[i].y - out[j].y) < 1) expect(footprintsTouch(out[i], out[j]), `${i} x ${j}`).toBe(false);
    }
    // deck storeys never meet: the same spot one storey up is placed too
    const one = dense.slice(0, 1);
    expect(placeVehicles([...one, {...one[0], y: 3.1}], 4).length).toBe(2);
    const car = (u: number, w: number, yaw: number): VehiclePlace => ({key: 'x', u, y: 0, w, yaw, k: 1, len: 4.6, wid: 1.8, kind: 'car'});
    expect(footprintsTouch(car(0, 0, 0), car(0, 0, 1))).toBe(true);
    // nose to tail (the nose along w at yaw 0): 4.6 m of car + the 0.15 m clearance
    expect(footprintsTouch(car(0, 0, 0), car(0, 4.7, 0))).toBe(true);
    expect(footprintsTouch(car(0, 0, 0), car(0, 4.8, 0))).toBe(false);
    expect(footprintsTouch(car(0, 0, 0), car(0, 4.7, 0), 0)).toBe(false);
    expect(footprintsTouch(car(0, 0, 0), car(0, 4.5, 0), 0)).toBe(true);
    expect(footprintsTouch(car(0, 0, 0), car(2.0, 0, 0))).toBe(false); // side by side: 1.8 + 0.15
    expect(footprintsTouch(car(0, 0, 0), car(1.9, 0, 0))).toBe(true);
    expect(footprintsTouch(car(0, 0, 0), car(3.4, 0, Math.PI / 2))).toBe(false); // a crossing T: 0.9 + 2.3 + 0.15
    expect(footprintsTouch(car(0, 0, 0), car(3.2, 0, Math.PI / 2))).toBe(true);
    expect(footprintsTouch(car(0, 0, 0), car(4.0, 0, Math.PI / 4))).toBe(false); // askew beside it
    expect(footprintsTouch(car(0, 0, 0), car(1.6, 2.0, Math.PI / 4))).toBe(true);
  });

  it('a model that did not load takes a loaded one of its class, else the spot is not drawn (never a stand-in)', () => {
    expect(drawnKey({key: 'skyways-wreck-suv', kind: 'car'}, () => true)).toBe('skyways-wreck-suv');
    expect(drawnKey({key: 'skyways-wreck-suv', kind: 'car'}, k => k === 'office-car-wreck')).toBe('office-car-wreck');
    expect(drawnKey({key: 'skyways-wreck-sedan-burnt', kind: 'car'}, k => k === 'skyways-wreck-sedan-burnt')).toBe('skyways-wreck-sedan-burnt');
    expect(drawnKey({key: 'office-bus-wreck', kind: 'bus'}, k => k !== 'office-bus-wreck')).toBeNull(); // never a car for the bus
    expect(drawnKey({key: 'skyways-wreck-suv', kind: 'car'}, k => k === 'office-bus-wreck')).toBeNull(); // never the bus for a car
    expect(drawnKey({key: 'skyways-wreck-suv', kind: 'car'}, () => false)).toBeNull();
  });
});

describe('mall vehicles: a real build with the cooked models (promenade seed 2, galleria 5)', () => {
  const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const worlds = new Map<number, BuiltWorld>();
  const fw = (seed: number): BuiltWorld => { let w = worlds.get(seed); if (!w) worlds.set(seed, (w = buildWorld(gen(seed), mats(), models))); return w; };
  const vehMeshes = (w: BuiltWorld) => { const out: THREE.InstancedMesh[] = []; w.group.traverse(o => { if (/-vehicle-/.test(o.name)) out.push(o as THREE.InstancedMesh); }); return out; };
  /** Each placed car's world box (the union of its model's parts: the parts of one key share instance order). */
  const carBoxes = (mine: THREE.InstancedMesh[]): {key: string; box: THREE.Box3}[] => {
    const byKey = new Map<string, THREE.InstancedMesh[]>();
    for (const m of mine) { const k = m.name.replace(/^.*-vehicle-/, '').replace(/-\d+$/, ''); byKey.set(k, [...(byKey.get(k) ?? []), m]); }
    const out: {key: string; box: THREE.Box3}[] = [], im = new THREE.Matrix4();
    for (const [key, ms] of byKey) for (let j = 0; j < ms[0].count; j++) {
      const box = new THREE.Box3();
      for (const m of ms) {
        expect(m.count).toBe(ms[0].count);
        m.updateMatrixWorld(true);
        m.getMatrixAt(j, im);
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(m.matrixWorld, im)));
      }
      out.push({key, box});
    }
    return out;
  };

  it('one InstancedMesh per model part per view on the library\'s own geometry; one shared material per source material; tagged like the view', () => {
    const libGeo = new Set<THREE.BufferGeometry>(), parts = new Map<string, number>();
    for (const k of KEYS) { const p = modelParts(models[k]); parts.set(k, p.length); for (const q of p) libGeo.add(q.geometry); }
    const seen = new Map<THREE.Material, string>();
    for (const seed of [2, 5]) {
      const w = fw(seed), L = gen(seed), all = vehMeshes(w);
      expect(all.length).toBeGreaterThan(0);
      for (const m of all) {
        expect(m.isInstancedMesh, m.name).toBe(true);
        expect(libGeo.has(m.geometry), `${m.name}: the library geometry (no clone)`).toBe(true);
        expect((m.material as THREE.Material).name).toBe('mall-exit-vehicle');
        expect(m.castShadow || m.receiveShadow).toBe(false);
        expect(m.userData.aperture).toBeDefined();
        expect(m.userData.vehicleExit).toBeInstanceOf(THREE.Vector4);
        expect(m.userData.vehicleView).toBeInstanceOf(THREE.Vector4);
        const key = m.name.replace(/^.*-vehicle-/, '').replace(/-\d+$/, ''), mat = m.material as THREE.Material, tag = `${key}:${m.geometry.uuid}`;
        // a material serves every instance, view and seed drawing that part (keyed by its source map / side), never one per car
        if (seen.has(mat)) expect(seen.get(mat)!.split(':')[0]).toBe(key);
        seen.set(mat, tag);
      }
      for (const r of L.mall!.windows!) {
        const mine = all.filter(m => m.userData.windowWall === r.id), c = w.mallArch!.stats.windowCost.find(q => q.id === r.id)!;
        expect(mine.every(m => m.name.startsWith(`mall-window-${r.id}-vehicle-`) && JSON.stringify(m.userData.levels) === JSON.stringify(r.bands.map(b => b.level)))).toBe(true);
        expect(mine.length).toBe(Object.keys(c.vehicleModels).reduce((n, k) => n + parts.get(k)!, 0));
        expect(mine.length).toBe(c.vehicleDraws);
        expect(Object.values(c.vehicleModels).reduce((a, b) => a + b, 0)).toBe(c.cars);
        expect(c.cars, `${r.id} cars drawn`).toBeGreaterThanOrEqual(Math.ceil(c.carSpots * 0.7)); // (a few askew cars do not fit: dropped)
        expect(c.cars).toBeLessThanOrEqual(c.carSpots);
        expect(Object.keys(c.vehicleModels).length, `${r.id} model mix`).toBeGreaterThanOrEqual(4);
        expect(c.vehicleTriangles, `${r.id} vehicle triangles`).toBeLessThan(520_000);
      }
      for (const c of w.mallArch!.stats.exitCost) {
        const mine = all.filter(m => m.userData.streetExit === c.id);
        expect(mine.length).toBe(c.vehicleDraws);
        expect(mine.every(m => m.name.startsWith(`mall-exit-${c.id}-vehicle-`))).toBe(true);
        expect(c.vehicleTriangles).toBeLessThan(60_000);
      }
    }
    expect(new Set(seen.keys()).size).toBeLessThanOrEqual([...parts.values()].reduce((a, b) => a + b, 0) * 2); // (per source material x side)
  }, 180_000);

  it('every car on its support (the lot / a deck storey / the road), inside its view volume, clear of the light poles and of each other', () => {
    for (const seed of [2, 5]) {
      const w = fw(seed), specs = w.mallArch!.windowWalls(), all = vehMeshes(w);
      for (const s of specs) {
        const plan = planLot(s), boxes = carBoxes(all.filter(m => m.userData.windowWall === s.id));
        const supports = [s.streetY + LOT.curbY, ...(plan.deck ? Array.from({length: plan.deck.levels}, (_, k) => s.streetY + (k + 1) * LOT.deckStorey) : [])];
        expect(boxes.length).toBeGreaterThan(10);
        for (const {key, box} of boxes) {
          expect(supports.some(y => Math.abs(box.min.y - y) < 0.02), `${s.id} ${key} grounded at ${box.min.y.toFixed(3)}`).toBe(true);
          const v = s.view;
          expect(box.min.x >= v.x0 - 0.05 && box.max.x <= v.x1 + 0.05 && box.min.z >= v.z0 - 0.05 && box.max.z <= v.z1 + 0.05, `${s.id} ${key} in the view`).toBe(true);
          expect(box.max.y).toBeLessThanOrEqual(Math.min(s.capY, v.y1));
        }
        // the poles (0.6 m footings): no car footprint reaches one (frame: u along, w outward; the box in world -> local)
        const alongX = s.nz !== 0, c = (s.s0 + s.s1) / 2, sg = alongX ? s.nz : -s.nx;
        for (const p of plan.poles) {
          const px = alongX ? c + sg * p.u : s.plane + s.nx * p.w, pz = alongX ? s.plane + s.nz * p.w : c + sg * p.u;
          const pole = new THREE.Box3(new THREE.Vector3(px - 0.3, s.streetY - 1, pz - 0.3), new THREE.Vector3(px + 0.3, s.streetY + 1, pz + 0.3));
          for (const {key, box} of boxes) if (Math.abs(box.min.y - supports[0]) < 0.02) {
            const shrunk = box.clone().expandByVector(new THREE.Vector3(-0.35, 0, -0.35)); // (a box of a yawed car over-covers its corners)
            expect(shrunk.intersectsBox(pole), `${s.id} ${key} on a pole at ${p.u.toFixed(1)},${p.w.toFixed(1)}`).toBe(false);
          }
        }
      }
      for (const e of w.mallArch!.exits()) {
        const boxes = carBoxes(all.filter(m => m.userData.streetExit === e.id));
        expect(boxes.length).toBe(w.mallArch!.stats.exitCost.find(q => q.id === e.id)!.vehicles);
        for (const {key, box} of boxes) {
          expect(Math.abs(box.min.y - (e.streetY - 0.15)), `${e.id} ${key} on the road`).toBeLessThan(0.02);
          expect(box.min.x >= e.view.x0 - 0.05 && box.max.x <= e.view.x1 + 0.05 && box.min.z >= e.view.z0 - 0.05 && box.max.z <= e.view.z1 + 0.05, `${e.id} ${key} in the view`).toBe(true);
        }
      }
    }
  }, 180_000);

  it('culling: the cars are drawn from the glass (visible pixels) and not submitted facing away', () => {
    const w = fw(2), L = gen(2);
    w.culler.maxDistance = Math.min(Math.sqrt(-Math.log(0.002)) / MALL_FOG.density, MALL_FOG.far);
    const culled = (m: THREE.Object3D) => (m.layers.mask >>> 0) === ((1 << CULL_LAYER) >>> 0);
    const eye = (p: {x: number; y: number; z: number; yaw: number; pitch: number}, turn = 0) => {
      const c = new THREE.PerspectiveCamera(75, 960 / 540, 0.05, MALL_FOG.far);
      c.position.set(p.x, p.y + 1.62, p.z); c.rotation.set(turn ? 0 : p.pitch, p.yaw + turn, 0, 'YXZ'); c.updateMatrixWorld(true); c.updateProjectionMatrix();
      return c;
    };
    for (const [k, r] of L.mall!.windows!.entries()) {
      const p = mallQaPose(L, 'window-wall', k)!, mine = vehMeshes(w).filter(m => m.userData.windowWall === r.id);
      const c = eye(p);
      w.culler.update(c, true);
      expect(mine.every(m => !culled(m)), `${r.id}: drawn`).toBe(true);
      const vis = visibleMeshes(w.group, c, 128, 72, {minPx: 1});
      expect([...vis].filter(([m]) => culled(m)).map(([m]) => m.name), 'visible but culled').toEqual([]);
      const px = mine.reduce((n, m) => n + (vis.get(m) ?? 0), 0);
      expect(px, `${r.id}: car pixels`).toBeGreaterThan(30);
      w.culler.update(eye(p, Math.PI), true);
      expect(mine.every(culled), `${r.id} facing away: not submitted`).toBe(true);
    }
  }, 180_000);
});
