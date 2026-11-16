// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): the Surface Run look RUNTIME (world/surface/look.ts) on a host
// with the Game's registries — the district's mood (overcast haze, never green; far plane; culler distance) applied and restored
// exactly, the runtime group (sky dome, ground ring, surroundings, decor, rooftop plant) built / distance culled / released at
// teardown, district-only GPU resources owned by LevelResources 'surface' and released with the family, full warm-up coverage
// (distance-hidden decor included), and nothing at all outside a district layout.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {lookFixture, plainLayout} from './helpers/surfaceLookFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {LevelResources} from '../src/assets/levelResources';
import {WarmupRegistry, planWarmup} from '../src/render/warmup';
import {MOOD} from '../src/world/lights';
import {fogCullDistance} from '../src/world/levelCulling';
import type {Game} from '../src/game';
import {
  LOOK_DECOR, LOOK_HIDDEN_MASK, SURFACE_LOOK_MODEL_KEYS, SurfaceLook, buildSurfaceLookView, cullSurfaceDecor, disposeSurfaceLookView, lookShown, surfaceQaPoses,
} from '../src/world/surface/look';
import {FAR_CITY, FAR_CITY_KEYS, farCityPlan} from '../src/world/surface/lookCity';
import {installSurfaceAir, type SurfaceAirHost} from '../src/world/surface/air';
import {LOOK_SKY, liveLookMaterials, releaseLookMaterials} from '../src/world/surface/lookSky';
import {SURFACE_TEXTURES, SURFACE_TEX_SLOTS, liveSurfaceMaterials, setSurfaceResourceOwner, setSurfaceTexture, surfaceTexturesReady} from '../src/world/surface/archMaterials';

installCanvasShim(false);

const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

/** A stand-in GLB per key: two parts (a box and a cone) with their own standard materials (a colour map on the first). */
const fakeModels = (): ((key: string) => GLTF | undefined) => {
  const cache = new Map<string, GLTF>();
  return key => {
    let g = cache.get(key);
    if (!g) {
      const scene = new THREE.Group();
      const map = new THREE.Texture({width: 4, height: 4} as unknown as HTMLImageElement);
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(4, 6, 4), new THREE.MeshStandardMaterial({map})));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2, 6), new THREE.MeshStandardMaterial({color: 0x887766}));
      cone.position.y = 4;
      scene.add(cone);
      g = {scene, scenes: [scene], animations: [], cameras: [], asset: {}, parser: null, userData: {}} as unknown as GLTF;
      cache.set(key, g);
    }
    return g;
  };
};

/** The Game surface the look runtime touches (registries, scene, camera, world, resources, models). */
function fakeHost(world: unknown, m: WorldMaterials) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
  const loads: string[] = [];
  const host = {
    sectionModelKeys: [] as ((l: unknown) => readonly string[])[],
    sectionPreloads: [] as ((l: unknown) => Promise<void>)[],
    sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[],
    frameHooks: [] as ((dt: number) => void)[],
    warmRegistry: new WarmupRegistry(),
    levelResources: new LevelResources(async url => { loads.push(url); return new THREE.Texture({width: 8, height: 8} as unknown as HTMLImageElement); }),
    scene, camera: new THREE.PerspectiveCamera(75, 1, 0.05, 70), world, mats: m,
    propModels: {get: fakeModels()},
  };
  return {host, loads, game: host as unknown as Game};
}

describe('Surface Run look: the surroundings plan', () => {
  it('berms on every cordon side, collapsed blocks just beyond, the far city further out — inside the triangle budget', () => {
    const S = lookFixture().layout.surface!;
    const p = farCityPlan(S);
    expect(p.stats.berm).toBeGreaterThan(40);
    expect(p.stats.collapsed).toBeGreaterThan(10);
    expect(p.stats.far).toBeGreaterThan(10);
    expect(p.tris).toBeLessThanOrEqual(FAR_CITY.berm.tris + FAR_CITY.collapsed.tris + FAR_CITY.far.tris);
    const E = S.extent;
    const out = (x: number, z: number) => Math.hypot(Math.max(E.x0 - x, 0, x - E.x1), Math.max(E.z0 - z, 0, z - E.z1));
    for (const q of p.placements) expect(out(q.x, q.z), `${q.entry} at ${q.x.toFixed(0)}, ${q.z.toFixed(0)}`).toBeGreaterThan(0.5);
    // every side of the cordon has berms
    const sides = new Set(p.placements.filter(q => q.band === 'berm').map(q => (q.z < E.z0 ? 'N' : q.z > E.z1 ? 'S' : q.x < E.x0 ? 'W' : 'E')));
    expect([...sides].sort()).toEqual(['E', 'N', 'S', 'W']);
    // deterministic, and undelivered models drop out
    expect(farCityPlan(S).placements).toEqual(p.placements);
    expect(farCityPlan(S, () => false).placements).toEqual([]);
    for (const k of FAR_CITY_KEYS) expect(SURFACE_LOOK_MODEL_KEYS).toContain(k);
  });
});

describe('Surface Run look: the runtime group', () => {
  it('builds the sky dome, the ground ring, the surroundings, the decor and the rooftop plant; distance culls decor; releases its own', () => {
    const layout = lookFixture().layout;
    const v = buildSurfaceLookView(layout, mats(), fakeModels())!;
    expect(v).not.toBeNull();
    expect(v.dome.frustumCulled).toBe(false);
    expect(v.stats.groundTris).toBeGreaterThan(0);
    expect(v.stats.farMeshes).toBeGreaterThan(0);
    expect(v.stats.decorMeshes).toBeGreaterThan(10);
    expect(v.stats.clutterInstances).toBeGreaterThan(10);
    expect(v.stats.missingModels).toEqual([]);
    expect(v.stats.railM).toBeGreaterThan(5);
    // distance culling: at the district's centre most decor near, at a corner the far side hidden
    const S = layout.surface!, cx = (S.extent.x0 + S.extent.x1) / 2, cz = (S.extent.z0 + S.extent.z1) / 2;
    const atCentre = cullSurfaceDecor(v, cx, cz), atCorner = cullSurfaceDecor(v, S.extent.x0 + 10, S.extent.z0 + 10);
    expect(atCorner).toBeLessThan(v.culled.length);
    expect(atCentre).toBeGreaterThan(0);
    for (const c of v.culled) expect(lookShown(c.obj)).toBe(Math.hypot(c.x - (S.extent.x0 + 10), c.z - (S.extent.z0 + 10)) - c.r < c.near);
    // (render only — P0 follow-up: a hidden piece is on the culler's layer, never invisible: the traced flashlight scene keeps it)
    expect(v.culled.every(c => c.obj.visible)).toBe(true);
    expect(v.culled.filter(c => !lookShown(c.obj)).every(c => c.obj.layers.mask === LOOK_HIDDEN_MASK)).toBe(true);
    expect(LOOK_DECOR.near).toBeLessThan(fogCullDistance(LOOK_SKY.fogDensity));
    // release: every geometry the view made is disposed; the model library's are not
    let disposed = 0;
    for (const g of v.geometries) g.addEventListener('dispose', () => disposed++);
    const model = fakeModels()(SURFACE_LOOK_MODEL_KEYS[0])!;
    let modelDisposed = 0;
    model.scene.traverse(o => (o as THREE.Mesh).geometry?.addEventListener('dispose', () => modelDisposed++));
    const n = v.geometries.length;
    disposeSurfaceLookView(v);
    expect(disposed).toBe(n);
    expect(modelDisposed).toBe(0);
    expect(v.root.parent).toBeNull();
  });

  it('the runtime: district mood applied and restored exactly, the group in the scene, the dome following the eye, inert elsewhere', async () => {
    const m = mats(), layout = lookFixture().layout;
    const world = {culler: {maxDistance: fogCullDistance(MOOD.fogDensity)}};
    const {host, loads, game} = fakeHost(world, m);
    const look = new SurfaceLook(game);
    // registries
    expect(host.sectionModelKeys[0](layout)).toEqual(SURFACE_LOOK_MODEL_KEYS);
    expect(host.sectionModelKeys[0](plainLayout())).toEqual([]);
    // preload: the district's texture sets under the 'surface' family (existing approved files only)
    await host.sectionPreloads[0](layout);
    expect(new Set(loads)).toEqual(new Set(SURFACE_TEX_SLOTS.map(s => SURFACE_TEXTURES[s].url)));
    expect(surfaceTexturesReady().length).toBe(SURFACE_TEX_SLOTS.length);
    for (const url of loads) expect(url).toMatch(/^assets\/textures\/(reactor|skyways|office)\//);
    // build
    host.sectionHooks[0].build!(layout);
    const fog = host.scene.fog as THREE.FogExp2;
    expect(fog.density).toBe(LOOK_SKY.fogDensity);
    expect(fog.color.getHex()).toBe(LOOK_SKY.fogColor);
    // ordinary fog is never green
    expect(fog.color.g).toBeLessThanOrEqual(Math.max(fog.color.r, fog.color.b) * 1.02);
    expect(host.camera.far).toBe(LOOK_SKY.far);
    expect(world.culler.maxDistance).toBeCloseTo(Math.min(fogCullDistance(LOOK_SKY.fogDensity), LOOK_SKY.far), 6);
    expect(look.view && look.view.root.parent).toBe(host.scene);
    host.camera.position.set(100, 1.6, 140);
    for (const f of host.frameHooks) f(1 / 60);
    expect(look.view!.dome.position.toArray()).toEqual([100, 1.6, 140]);
    // warm-up pool: the whole group, so distance-hidden decor still compiles
    const pools = host.warmRegistry.poolRoots();
    expect(pools).toContain(look.view!.root);
    // teardown: MOOD and the far plane back exactly, the group gone
    const root = look.view!.root;
    host.sectionHooks[0].teardown!();
    expect(fog.density).toBe(MOOD.fogDensity);
    expect(fog.color.getHex()).toBe(MOOD.fogColor);
    expect(host.camera.far).toBe(70);
    expect(root.parent).toBeNull();
    expect(look.view).toBeNull();
    // a plain level: nothing applied, nothing built
    host.sectionHooks[0].build!(plainLayout());
    expect(fog.density).toBe(MOOD.fogDensity);
    expect(host.camera.far).toBe(70);
    expect(look.view).toBeNull();
    expect(look.active).toBe(false);
    setSurfaceResourceOwner(null);
    for (const s of SURFACE_TEX_SLOTS) setSurfaceTexture(s, null);
  });

  it("district-only materials are owned by LevelResources 'surface' and released when the run moves to another family", async () => {
    // the module caches are process-wide: drop what earlier tests (other hosts, no owner) left, so the counts below are this run's
    releaseLookMaterials();
    for (const mm of [...liveSurfaceMaterials]) mm.dispose();
    expect(liveSurfaceMaterials.size + liveLookMaterials()).toBe(0);
    const m = mats(), layout = lookFixture().layout;
    const {host, game} = fakeHost({culler: {maxDistance: 0}}, m);
    const look = new SurfaceLook(game);
    await host.sectionPreloads[0](layout);
    const w = buildWorld(layout, m, {});
    (host as {world: unknown}).world = w;
    host.sectionHooks[0].build!(layout);
    const owned = host.levelResources.summary().surface;
    expect(owned.owned).toBeGreaterThan(20);
    expect(owned.textures).toBe(SURFACE_TEX_SLOTS.length);
    expect(liveSurfaceMaterials.size).toBeGreaterThan(10);
    expect(liveLookMaterials()).toBeGreaterThan(2);
    // a Retry in the district keeps them
    expect(host.levelResources.retainOnly('surface')).toBe(0);
    host.sectionHooks[0].teardown!();
    // the next level is another family: every district material / texture is released (the caches evict them)
    const released = host.levelResources.retainOnly('subway');
    expect(released).toBeGreaterThan(20);
    expect(liveSurfaceMaterials.size).toBe(0);
    expect(liveLookMaterials()).toBe(0);
    expect(host.levelResources.summary().surface).toBeUndefined();
    void look;
    setSurfaceResourceOwner(null);
    for (const s of SURFACE_TEX_SLOTS) setSurfaceTexture(s, null);
  });

  it('warm-up coverage: every material of the district scene is planned (world group + look group, distance-hidden decor included)', () => {
    const m = mats(), layout = lookFixture().layout;
    const w = buildWorld(layout, m, {});
    const {host, game} = fakeHost(w, m);
    const look = new SurfaceLook(game);
    host.scene.add(w.group);
    host.sectionHooks[0].build!(layout);
    // stand in a corner: far decor chunks are hidden by distance
    host.camera.position.set(layout.surface!.extent.x0 + 8, 1.6, layout.surface!.extent.z0 + 8);
    for (let k = 0; k < LOOK_DECOR.every; k++) for (const f of host.frameHooks) f(1 / 60);
    expect(look.view!.culled.some(c => !lookShown(c.obj))).toBe(true);
    const cam = new THREE.PerspectiveCamera();
    const plan = planWarmup(host.scene, {mode: 'full', cameraMask: cam.layers.mask, pools: host.warmRegistry.poolRoots()});
    const planned = new Set([...plan.items, ...plan.others].map(i => i.object));
    const missing: string[] = [];
    const check = (o: THREE.Object3D) => { const mm = o as THREE.Mesh; if (mm.isMesh && !planned.has(mm)) missing.push(`${o.name} (${(mm.material as THREE.Material).name})`); };
    look.view!.root.traverse(check);
    for (const mm of w.surfaceArch!.meshes) check(mm);
    expect(missing.slice(0, 12)).toEqual([]);
    expect(plan.items.length).toBeGreaterThan(10);
    host.sectionHooks[0].teardown!();
    setSurfaceResourceOwner(null);
  });

  it("lane AIR's door runtime drives the arch's own tent flap (wired before the section build; AIR then draws none)", async () => {
    const air = installSurfaceAir({
      scene: new THREE.Scene(), gas: {windowSources: [], outdoorAir: null, field: null}, sectionHooks: [], frameHooks: [], interactHandlers: [],
      promptProviders: [], warmRegistry: {addPool: () => undefined}, sectionPreloads: [],
    } as unknown as SurfaceAirHost);
    expect(air.tentFlap).toBeNull();
    const m = mats(), layout = lookFixture().layout;
    const w = buildWorld(layout, m, {});
    const {host, game} = fakeHost({culler: {maxDistance: 0}}, m);
    (host as {world: unknown}).world = w;
    new SurfaceLook(game);
    await host.sectionPreloads[0](layout);
    expect(air.tentFlap).toBeTypeOf('function');
    const leaf = w.surfaceArch!.meshes.find(q => q.name === 'surface-tent-flap-leaf')!;
    const lowest = () => { leaf.updateMatrixWorld(true); return new THREE.Box3().setFromObject(leaf).min.y; };
    air.tentFlap!(0);
    const shut = lowest();
    air.tentFlap!(1);
    expect(lowest()).toBeGreaterThan(shut + 1);
    air.tentFlap!(0);
    expect(lowest()).toBeCloseTo(shut, 5);
    setSurfaceResourceOwner(null);
    for (const s of SURFACE_TEX_SLOTS) setSurfaceTexture(s, null);
  });

  it('QA poses: an avenue, a facade, an interior, the cordon, the tent, the rail spur', () => {
    const poses = surfaceQaPoses(lookFixture().layout);
    const names = poses.map(p => p.name);
    for (const n of ['avenue', 'facade', 'interior', 'cordon', 'tent', 'rail']) expect(names, n).toContain(n);
    for (const p of poses) for (const v of [p.x, p.z, p.yaw, p.look.x, p.look.y, p.look.z]) expect(Number.isFinite(v)).toBe(true);
    expect(surfaceQaPoses(plainLayout())).toEqual([]);
  });
});
