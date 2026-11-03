// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU): the REAL mall built through the game's build path
// (Game.buildSection order: world, holders + loot display, shelf stock, the glass lift, shadow marks, culler registration, the
// flashlight viewpoint) PLUS the runtime population the warm-up sees in the game — every spawn's enemy exactly as Game.spawnEnemy
// builds it (seeded looks incl. the lingerie store's fitted sets) and the floor pickups — for yaw-sweep cost / first-use census tests.
// Models are stripped (no textures; geometry, materials and node structure as in the game).
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimContext, installCanvasShim} from './canvas2d';
import {fakeEnvTextures, loadStripped} from './openablesFixture';
import {LEVELS, arrivalPose} from '../../src/levels/registry';
import {codeToSeed, mulberry32} from '../../src/core/rng';
import {WorldMaterials} from '../../src/world/materials';
import {buildWorld} from '../../src/world/builder';
import {ContainerManager} from '../../src/world/containers';
import {ShelfStock} from '../../src/world/shelfStock';
import {placementBox} from '../../src/items/lootLayout';
import {PickupManager} from '../../src/world/pickups';
import {fogCullDistance} from '../../src/world/levelCulling';
import {MALL_FOG} from '../../src/world/mallAtmosphere';
import {p7ModelKeysFor, P7_FILES} from '../../src/gen/props07';
import {officeModelKeysFor} from '../../src/gen/office/index';
import {ENEMY_MODEL_FILES, enemyModelKeysFor, withEnemyModels} from '../../src/ai/enemyModels';
import {selectLevelKeys} from '../../src/assets/levelAssets';
import {MODEL_FILES} from '../../src/assets/manifest';
import {OFFICE_MODEL_FILES} from '../../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../../src/assets/mallAssets';
import {lootProfile} from '../../src/items/lootTables';
import {readTowerInfo} from '../../src/world/towerShared';
import {buildElevatorView, planElevator} from '../../src/world/elevator';
import {Inventory} from '../../src/items/inventory';
import {registerMovingLift} from '../../src/world/towerRuntime';
import {markShadows} from '../../src/render/volumetric';
import {setAttributeInstancing} from '../../src/render/instancing';
import {ZombieLookLibrary} from '../../src/ai/outfits';
import {ZombieActor} from '../../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor} from '../../src/ai/creatureArchetypes';
import {chooseSpawnLook, lingerieModelKeysFor} from '../../src/ai/spawnLook';
import {LINGERIE_MODEL_FILES, createLingerieLibrary} from '../../src/ai/lingerie';
import {lingerieDisplayModelKeys} from '../../src/gen/mall/lingerieStore';
import type {StationLayout} from '../../src/gen/stationTypes';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...ENEMY_MODEL_FILES, ...MALL_MODEL_FILES, ...LINGERIE_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const modelCache = new Map<string, Promise<GLTF>>();
const loadModel = (url: string) => { let m = modelCache.get(url); if (!m) modelCache.set(url, (m = loadStripped(url))); return m; };

export interface RealMallScene {
  seed: number; layout: StationLayout; world: ReturnType<typeof buildWorld>; cm: ContainerManager; stock: ShelfStock;
  enemies: EnemyActor[]; pickups: PickupManager; scene: THREE.Scene;
  /** Static roots (world, holders + loot display, shelf stock) and the moving ones (enemies, pickups). */
  roots: THREE.Object3D[]; dyn: THREE.Object3D[];
  /** The glass lift's view root (the game's 'tower' warm-up pool in the mall: towerRuntime), null without a lift. */
  liftRoot: THREE.Object3D | null;
}

const malls = new Map<string, Promise<RealMallScene>>();
/** The mall of `code` (default t3a, the primary's QA seed), built once per seed. */
export function realMallScene(code = 't3a'): Promise<RealMallScene> {
  let r = malls.get(code);
  if (!r) malls.set(code, (r = (async () => {
    const seed = /^\d+$/.test(code) ? Number(code) : codeToSeed(code)!;
    const layout = LEVELS.mall.generate(LEVELS.mall.entry, {levelSeed: seed, startWeapon: 'pistol'});
    // the lazy working set as Game.modelKeysFor selects it (p7 + office / genset / lingerie display + lingerie garments + enemies)
    const keys = selectLevelKeys('mall', [...new Set([...p7ModelKeysFor(layout), ...officeModelKeysFor(layout as never), ...lingerieDisplayModelKeys(layout),
      ...lingerieModelKeysFor(layout), ...enemyModelKeysFor(layout)])], CATALOGUE).keys;
    const models: Record<string, GLTF> = {};
    for (const k of keys) if (CATALOGUE[k]) models[k] = await loadModel(CATALOGUE[k].url);
    for (const [k, f] of Object.entries(MODEL_FILES as Record<string, {url: string}>)) models[k] ??= await loadModel(f.url);
    const lb = new THREE.Box3().setFromObject(models.light.scene).getSize(new THREE.Vector3());
    const mats = new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
    setAttributeInstancing(true); // Game.buildSection: on for the mall
    const world = buildWorld(layout, mats, models);
    const cm = new ContainerManager(models, mats, () => new Inventory());
    cm.build(layout, models, lootProfile('mall'));
    const stock = new ShelfStock();
    stock.build(layout, {models, lotsOf: p => cm.holderFor(p)?.state.lots.map(l => placementBox(l.itemId, l)) ?? []});
    const lift = readTowerInfo(layout)?.elevator;
    let liftRoot: THREE.Object3D | null = null;
    if (lift) {
      const view = buildElevatorView(planElevator(lift), mats, {glass: true});
      view.setCab(lift.stops[0].y, 0);
      world.group.add(view.root);
      liftRoot = view.root;
      for (const g of view.landings) world.culler.register(g);
      registerMovingLift(world.culler, view, lift.stops.map(q => q.levelId));
    }
    markShadows(world.group, true, true);
    markShadows(cm.group, true, true);
    markShadows(stock.group, true, false);
    world.culler.register(cm.group);
    world.culler.register(stock.group);
    world.culler.maxDistance = Math.min(fogCullDistance(MALL_FOG.density), MALL_FOG.far);
    // enemies exactly as Game.spawnEnemy builds them (ordinary seeded looks, the lingerie store's fitted sets)
    const looks = new ZombieLookLibrary(models);
    const lazyLingerie = Object.keys(LINGERIE_MODEL_FILES).filter(k => models[k]);
    const lingerie = lazyLingerie.length ? createLingerieLibrary(models) : null;
    const rand = mulberry32(seed ^ 0x5bd1e995);
    const enemies = layout.zombies.map((s, i) => {
      const {actor} = createEnemyActor(s, withEnemyModels(models, k => models[k]), rand, () => {
        const pick = chooseSpawnLook(seed, i, s, looks, s.look === 'lingerie' ? lingerie : null);
        return new ZombieActor((pick.library === 'lingerie' ? lingerie! : looks).build(pick.look), s, rand);
      });
      actor.brain.y = actor.root.position.y = s.y ?? layout.levels[s.level ?? 0].grid.floorAt(s.x, s.z);
      actor.syncTransform();
      markShadows(actor.root, false, false);
      return actor;
    });
    const pickups = new PickupManager({});
    const inv = new Inventory();
    for (const p of layout.pickups) pickups.add(inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, p.yaw ?? 0);
    const scene = new THREE.Scene();
    const roots = [world.group, cm.group, stock.group];
    const dyn = [...enemies.map(e => e.root), pickups.group];
    for (const o of [...roots, ...dyn]) scene.add(o);
    scene.updateMatrixWorld(true);
    return {seed, layout, world, cm, stock, enemies, pickups, scene, roots, dyn, liftRoot};
  })()));
  return r;
}

export interface Pose { name: string; x: number; y: number; z: number; yaw: number; pitch: number }
/** The arrival (start) pose as Game.buildSection places the player (eye 1.62 m over the floor). */
export function startPose(layout: StationLayout): Pose {
  const a = arrivalPose(layout, {kind: 'start'} as never), lv = a.level ?? 0;
  const y = a.y ?? (lv > 0 ? layout.levels[lv].grid : layout.grid).floorAt(a.x, a.z);
  return {name: 'start', x: a.x, y, z: a.z, yaw: a.yaw, pitch: 0};
}

/** A game camera (fov 75, 16:9, the mall's far plane) at a pose's eye (floor + 1.62 m). */
export function eyeCam(p: Pose, yaw = p.yaw, pitch = p.pitch): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, MALL_FOG.far);
  cam.position.set(p.x, p.y + 1.62, p.z);
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

/** The game's flashlight (game.ts: SpotLight(.., 30 m, 0.58 rad, .., 1.2), camera-local offsets) on `cam`, torch on. */
export function torchOn(cam: THREE.PerspectiveCamera): THREE.SpotLight {
  const fl = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
  fl.position.set(0.2, -0.15, 0.1);
  fl.target.position.set(0.04, -0.12, -6);
  cam.add(fl, fl.target);
  fl.castShadow = true;
  cam.updateMatrixWorld(true);
  fl.shadow.camera.near = 0.2;
  fl.shadow.mapSize.set(1024, 1024);
  fl.shadow.updateMatrices(fl);
  fl.shadow.camera.layers.mask = cam.layers.mask;
  return fl;
}

/** three r186 Renderer._projectObject, structurally: the renderables a camera submits (visible chain, layers, frustum unless off). */
export function submitted(root: THREE.Object3D, cam: THREE.Camera, casters = false): THREE.Mesh[] {
  cam.updateMatrixWorld(true);
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices((cam as THREE.PerspectiveCamera).projectionMatrix, cam.matrixWorldInverse));
  const sph = new THREE.Sphere(), out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if ((m.isMesh || (m as unknown as THREE.Points).isPoints || (m as unknown as THREE.Line).isLine) && o.layers.test(cam.layers) && (!casters || m.castShadow)) {
      const im = m as THREE.InstancedMesh;
      let inView = true;
      if (m.frustumCulled !== false) {
        const own = (m as unknown as {boundingSphere?: THREE.Sphere | null}).boundingSphere;
        if (im.isInstancedMesh && !own) im.computeBoundingSphere();
        if (own || im.isInstancedMesh) sph.copy((m as unknown as {boundingSphere: THREE.Sphere}).boundingSphere);
        else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sph.copy(m.geometry.boundingSphere!); }
        inView = fr.intersectsSphere(sph.applyMatrix4(m.matrixWorld));
      }
      if (inView) out.push(m);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return out;
}

/** Draws of a submitted list (one per visible material group; a transparent double-sided material twice in the scene pass). */
export function drawsOf(list: readonly THREE.Mesh[], shadow = false): number {
  let n = 0;
  for (const m of list) {
    const im = m as THREE.InstancedMesh;
    if (im.isInstancedMesh && im.count === 0) continue;
    const mats = Array.isArray(m.material) ? m.geometry.groups.map(g => (m.material as THREE.Material[])[g.materialIndex!]).filter(Boolean) : [m.material as THREE.Material];
    for (const mt of mats) if (mt.visible) n += !shadow && mt.transparent && mt.side === THREE.DoubleSide && !mt.forceSinglePass ? 2 : 1;
  }
  return n;
}
