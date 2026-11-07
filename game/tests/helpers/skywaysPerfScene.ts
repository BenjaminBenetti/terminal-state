// Task studio-skywalk-variety-20261107-231448-01 (lane PERF, user: "looking in some directions causes lag"): the REAL Skyways on the
// game's build path, as tests/reactor-cpu-submit.test.ts builds the Reactor — the generated layout (any layout version), the game's
// world / holders + loot display / shelf stock builders with the stripped real models, shadow marking and culler registration as
// Game.buildSection does them, the Skyways glazing / add-on / exterior section runtimes (fake hosts), the enemies as Game.spawnEnemy
// builds them and the floor pickups — plus three r186 render-list estimates per camera (scene pass, flashlight shadow pass) with a
// per-category breakdown. Node estimates of submitted render objects, never native timings.
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimContext, installCanvasShim} from './canvas2d';
import {fakeEnvTextures, loadStripped} from './openablesFixture';
import {LEVELS} from '../../src/levels/registry';
import {mulberry32} from '../../src/core/rng';
import {levelsOf} from '../../src/gen/levels';
import type {StationLayout} from '../../src/gen/stationTypes';
import {WorldMaterials} from '../../src/world/materials';
import {buildWorld} from '../../src/world/builder';
import {ContainerManager} from '../../src/world/containers';
import {ShelfStock} from '../../src/world/shelfStock';
import {PickupManager} from '../../src/world/pickups';
import {placementBox} from '../../src/items/lootLayout';
import {CULL_LAYER, fogCullDistance} from '../../src/world/levelCulling';
import {p7ModelKeysFor, P7_FILES} from '../../src/gen/props07';
import {selectLevelKeys} from '../../src/assets/levelAssets';
import {MODEL_FILES} from '../../src/assets/manifest';
import {OFFICE_MODEL_FILES} from '../../src/assets/officeAssets';
import {lootProfile} from '../../src/items/lootTables';
import {Inventory} from '../../src/items/inventory';
import {markShadows} from '../../src/render/volumetric';
import {setAttributeInstancing} from '../../src/render/instancing';
import {WarmupRegistry} from '../../src/render/warmup';
import {MOOD} from '../../src/world/lights';
import {ZombieLookLibrary} from '../../src/ai/outfits';
import {pickZombieLook} from '../../src/ai/wardrobe';
import {ZombieActor} from '../../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor} from '../../src/ai/creatureArchetypes';
import {ENEMY_MODEL_FILES, enemyModelKeysFor} from '../../src/ai/enemyModels';
import {SKYWAYS_KITCHEN_MODEL_FILES, skywaysKitchenModelKeysFor} from '../../src/gen/skyways/kitchenKinds';
import {SKYWAYS_ADDON_MODEL_FILES, skywaysAddonModelKeysFor} from '../../src/gen/skyways/addonKinds';
import {SKYWAYS_DEST_MODEL_FILES, skywaysDestModelKeysFor} from '../../src/gen/skyways/destinations/skywaysDestModels';
import {skywaysGardenModelKeysFor} from '../../src/world/skywaysGardens';
import {applySkywaysStageSupport} from '../../src/gen/skyways/stageSupport';
import {installSkywaysWindows, type SkywaysWindowRuntime} from '../../src/world/skywaysWindows';
import {installSkywaysExterior, type SkywaysExteriorRuntime} from '../../src/world/skywaysExterior';
import {installSkywaysAddon} from '../../src/world/skywaysAddonRuntime';
import {EXTERIOR} from '../../src/world/exterior';
import {SKYWAYS_CAR} from '../../src/assets/skywaysCar.generated';
import {COCKPIT_URLS} from '../../src/world/skywaysCarCockpit';
import {CAR_SPEC} from '../../src/world/skywaysCarSpec';
import {buildCarView, setSkywaysCarModelsForTests} from '../../src/world/skywaysCarModel';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...ENEMY_MODEL_FILES, ...SKYWAYS_KITCHEN_MODEL_FILES, ...SKYWAYS_ADDON_MODEL_FILES, ...SKYWAYS_DEST_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const modelCache = new Map<string, Promise<GLTF>>();
const loadModel = (url: string) => { let m = modelCache.get(url); if (!m) modelCache.set(url, (m = loadStripped(url))); return m; };

/** The game camera's eye height over the floor used by the census (m). */
export const PERF_EYE = 1.62;

export interface SkywaysPerfScene {
  seed: number; version: number; layout: StationLayout; world: ReturnType<typeof buildWorld>; cm: ContainerManager; stock: ShelfStock;
  glazing: SkywaysWindowRuntime; exterior: SkywaysExteriorRuntime;
  /** Static, culler-registered roots (world, holders + loot display, shelf stock, glazing, add-on). */
  roots: THREE.Object3D[];
  /** The exterior root (not culler-registered: its own window / vault gate). */
  exteriorRoot: THREE.Object3D | null;
  /** Moving objects: enemy roots, the pickups group and the prize car's view (when the add-on places one). */
  enemies: EnemyActor[]; pickups: PickupManager; car: THREE.Object3D | null; dyn: THREE.Object3D[];
  /** The fake host camera the exterior runtime gates on (positioned by `gateExterior`). */
  hostCamera: THREE.PerspectiveCamera;
}

const scenes = new Map<string, Promise<SkywaysPerfScene>>();

/** The Skyways of `seed` at `version` built as Game.buildSection builds it (cached per seed x version). */
export function skywaysPerfScene(seed: number, version: number): Promise<SkywaysPerfScene> {
  const key = `${seed}:${version}`;
  let s = scenes.get(key);
  if (!s) scenes.set(key, (s = build(seed, version)));
  return s;
}

async function build(seed: number, version: number): Promise<SkywaysPerfScene> {
  const layout = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: version} as never) as StationLayout;
  const keys = selectLevelKeys('skyways', [...new Set([...p7ModelKeysFor(layout), ...skywaysKitchenModelKeysFor(layout), ...skywaysAddonModelKeysFor(layout),
    ...skywaysDestModelKeysFor(layout), ...skywaysGardenModelKeysFor(layout), ...enemyModelKeysFor(layout)])], CATALOGUE).keys;
  const models: Record<string, GLTF> = {};
  for (const k of keys) if (CATALOGUE[k]) models[k] = await loadModel(CATALOGUE[k].url);
  for (const [k, f] of Object.entries(MODEL_FILES as Record<string, {url: string}>)) models[k] ??= await loadModel(f.url);
  const lb = new THREE.Box3().setFromObject(models.light.scene).getSize(new THREE.Vector3());
  const mats = new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
  setAttributeInstancing(!!layout.mall || !!(layout as {reactor?: unknown}).reactor); // Game.buildSection (off on the Skyways)
  const world = buildWorld(layout, mats, models);
  const cm = new ContainerManager(models, mats, () => new Inventory());
  cm.build(layout, models, lootProfile('skyways'));
  applySkywaysStageSupport(layout);
  const stock = new ShelfStock();
  stock.build(layout, {models, lotsOf: p => cm.holderFor(p)?.state.lots.map(l => placementBox(l.itemId, l)) ?? []});
  // Game.buildSection: structure / holders cast + receive the flashlight shadow, shelf stock casts
  markShadows(world.group, true, true);
  markShadows(cm.group, true, true);
  markShadows(stock.group, true, false);
  world.culler.register(cm.group);
  world.culler.register(stock.group);
  world.culler.maxDistance = fogCullDistance(MOOD.fogDensity);
  // the enemies exactly as Game.spawnEnemy builds them (seeded looks, archetype actors, the floor height, shadow casters)
  const looks = new ZombieLookLibrary(models);
  const rand = mulberry32(seed ^ 0x5bd1e995);
  const enemies = layout.zombies.map((sp, i) => {
    const {actor} = createEnemyActor(sp, models, rand, () => new ZombieActor(looks.build(pickZombieLook(seed, i, sp.type, looks.available)), sp, rand));
    actor.brain.y = actor.root.position.y = sp.y ?? layout.levels[sp.level ?? 0].grid.floorAt(sp.x, sp.z);
    actor.syncTransform();
    markShadows(actor.root, false, false);
    return actor;
  });
  const pickups = new PickupManager({});
  const inv = new Inventory();
  for (const p of layout.pickups) pickups.add(inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, p.yaw ?? 0);
  // the Skyways section runtimes on a fake host (their build hooks, as Game runs them)
  const scene = new THREE.Scene();
  const hostCamera = new THREE.PerspectiveCamera(75, 3456 / 1944, 0.05, 70);
  hostCamera.rotation.order = 'YXZ';
  const lv = levelsOf(layout);
  const host = {
    scene, camera: hostCamera, mats, world, levels: lv, warmRegistry: new WarmupRegistry(), frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    player: {x: 0, z: 0, y: 0, radius: 0.3, alive: true}, zombies: [] as never[], atmosphere: {markShadows: (r: THREE.Object3D, structure: boolean) => { markShadows(r, true, structure); }},
    levelResources: {load: async () => null, own: <T,>(_l: string, r: T) => r}, physics: null,
  };
  const glazing = installSkywaysWindows(host as never);
  (host as unknown as {skywaysWindows: SkywaysWindowRuntime}).skywaysWindows = glazing; // (Game: the glazing runtime gates the exterior)
  const exterior = installSkywaysExterior(host as never);
  installSkywaysAddon(host as never);
  for (const h of host.sectionHooks) h.build?.(layout);
  const glazingRoot = glazing.glazing?.root ?? null;
  const addonRoot = scene.children.find(o => o.name === 'skyways-addon') ?? null;
  const exteriorRoot = exterior.view?.root ?? null;
  const roots = [world.group, cm.group, stock.group, ...(glazingRoot ? [glazingRoot] : []), ...(addonRoot ? [addonRoot] : [])];
  // the prize car's view at its spawn as SkywaysCar.onBuild / decorateView / syncView place it (stripped models; the paint casts)
  let car: THREE.Object3D | null = null;
  const spawn = layout.skyways?.addon?.car;
  if (spawn) {
    const [body, dash, seat] = await Promise.all([loadModel(SKYWAYS_CAR.url), loadModel(COCKPIT_URLS.dash), loadModel(COCKPIT_URLS.seat)]);
    setSkywaysCarModelsForTests({car: body, dash, seat});
    const v = buildCarView(CAR_SPEC);
    setSkywaysCarModelsForTests({car: null, dash: null, seat: null});
    markShadows(v.group, true, false);
    v.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.userData.noShadow || m.userData.carPart === 'glass' || v.cockpit.getObjectById(m.id))) m.castShadow = false; });
    v.group.position.set(spawn.x, spawn.y, spawn.z);
    v.group.rotation.set(0, spawn.yaw, 0, 'YXZ');
    car = new THREE.Group();
    car.name = 'skyways-car-root';
    car.add(v.group);
  }
  const dyn = [...enemies.map(e => e.root), pickups.group, ...(car ? [car] : [])];
  for (const o of [...roots, ...dyn, ...(exteriorRoot ? [exteriorRoot] : [])]) o.updateMatrixWorld(true);
  return {seed, version, layout, world, cm, stock, glazing, exterior, roots, exteriorRoot, enemies, pickups, car, dyn, hostCamera};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Cameras and render lists

export interface PerfPose { name: string; x: number; y: number; z: number; yaw: number; pitch: number }

/** A game camera (fov 75, the trace's 3456 x 1944 aspect, the exterior's raised far plane) at a pose (rotation 'YXZ': yaw = rotation.y). */
export function perfCam(p: PerfPose, far: number = EXTERIOR.far): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 3456 / 1944, 0.05, far);
  cam.position.set(p.x, p.y, p.z);
  cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** The game's flashlight (game.ts: SpotLight(.., 30 m, 0.58 rad, .., 1.2), camera-local offsets) on `cam`, torch on. */
export function perfTorch(cam: THREE.PerspectiveCamera): THREE.SpotLight {
  const fl = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
  fl.position.set(0.2, -0.15, 0.1);
  fl.target.position.set(0.04, -0.12, -6);
  cam.add(fl, fl.target);
  cam.updateMatrixWorld(true);
  fl.shadow.camera.near = 0.2;
  fl.shadow.mapSize.set(1024, 1024);
  fl.shadow.updateMatrices(fl);
  fl.shadow.camera.layers.mask = cam.layers.mask; // ShadowNode.updateShadow: the camera's layers
  return fl;
}

/** Census categories of a submitted mesh (by its root / name). */
export type PerfCategory = 'arch' | 'storefront' | 'dressing' | 'props' | 'holders' | 'loot' | 'stock' | 'glazing' | 'exterior' | 'enemies' | 'pickups' | 'car' | 'other';
export const PERF_CATEGORIES: readonly PerfCategory[] = ['arch', 'storefront', 'dressing', 'props', 'holders', 'loot', 'stock', 'glazing', 'exterior', 'enemies', 'pickups', 'car', 'other'];

export function categoryOf(S: SkywaysPerfScene, m: THREE.Object3D): PerfCategory {
  let r: THREE.Object3D = m;
  while (r.parent) r = r.parent;
  let top: THREE.Object3D | null = m;
  while (top && !S.roots.includes(top) && !S.dyn.includes(top) && top !== S.exteriorRoot) top = top.parent;
  if (top === S.exteriorRoot) return 'exterior';
  if (top === S.pickups.group) return 'pickups';
  if (top && top === S.car) return 'car';
  if (top && S.dyn.includes(top)) return 'enemies';
  if (top === S.stock.group) return 'stock';
  if (top === S.cm.group) return /^loot-/.test(m.name) ? 'loot' : 'holders';
  if (top && top !== S.world.group) return 'glazing'; // the glazing / add-on roots
  const n = m.name;
  if (/^(arch-|trim-|skyways-roof|skyways-trim|skyways-atrium|skyways-bridge-roof|skyways-skylight|light-tubes|mall-|reactor-)/.test(n)) return 'arch';
  if (/^(shopfront-|shop-)/.test(n)) return 'storefront';
  if (/^purpose-/.test(n)) return 'dressing';
  if (/^(prop-|light|sign-|skyways-)/.test(n)) return 'props';
  return 'other';
}

export type Census = Record<PerfCategory, number> & {total: number};
const emptyCensus = (): Census => Object.assign(Object.fromEntries(PERF_CATEGORIES.map(c => [c, 0])), {total: 0}) as Census;

/**
 * three r186 render list of `cam` under `roots`: draws (transparent double-sided = 2 in the scene pass) of the meshes it would submit
 * (visible chain, the camera's layers, frustum vs the mesh's / instanced bounding sphere; casters only for the shadow pass), by category.
 */
export function renderCensus(S: SkywaysPerfScene, roots: readonly THREE.Object3D[], cam: THREE.Camera, casters = false, list?: THREE.Mesh[]): Census {
  cam.updateMatrixWorld(true);
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices((cam as THREE.PerspectiveCamera).projectionMatrix, cam.matrixWorldInverse));
  const sph = new THREE.Sphere();
  const out = emptyCensus();
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && o.layers.test(cam.layers) && (!casters || m.castShadow)) {
      const im = m as THREE.InstancedMesh;
      if (!(im.isInstancedMesh && im.count === 0)) {
        let inView = true;
        if (m.frustumCulled !== false) {
          const own = (m as unknown as {boundingSphere?: THREE.Sphere | null}).boundingSphere;
          if (im.isInstancedMesh && !own) im.computeBoundingSphere();
          if (own || im.isInstancedMesh) sph.copy((m as unknown as {boundingSphere: THREE.Sphere}).boundingSphere); else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sph.copy(m.geometry.boundingSphere!); }
          inView = fr.intersectsSphere(sph.applyMatrix4(m.matrixWorld));
        }
        if (inView) {
          const mats = Array.isArray(m.material) ? m.geometry.groups.map(g => (m.material as THREE.Material[])[g.materialIndex!]).filter(Boolean) : [m.material as THREE.Material];
          let n = 0;
          for (const mt of mats) if (mt.visible) n += !casters && mt.transparent && mt.side === THREE.DoubleSide && !mt.forceSinglePass ? 2 : 1;
          if (n) { out[categoryOf(S, m)] += n; out.total += n; list?.push(m); }
        }
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

export const CULLED_MASK = (1 << CULL_LAYER) >>> 0;
export const isCulled = (m: THREE.Object3D) => (m.layers.mask >>> 0) === CULLED_MASK;

/** Gates the exterior root as its runtime does for this camera (the fake host camera follows `cam`). */
export function gateExterior(S: SkywaysPerfScene, cam: THREE.PerspectiveCamera): void {
  const h = S.hostCamera;
  h.position.copy(cam.position);
  h.quaternion.copy(cam.quaternion);
  h.updateMatrixWorld(true);
  (S.exterior as unknown as {checkT: number}).checkT = 0;
  S.exterior.frame(0.2);
}
