// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): ANY level kind of the registry as one scene, built the way
// Game.buildSection builds it (buildWorld, holders + loot display, shelf stock, flashlight shadow marking, culler registration) with
// the stripped real models — the registry-driven counterpart of rendercpuLevels.realLevelScene (Subway / Office only) for the ride
// portal tests. The lazy model set is the game's (p7 props + every section model-key hook that applies to the layout), filtered by
// the level rule (assets/levelAssets.ts). Enemies / pickups are not built here (the tests add stand-in movers where they need them).
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimContext, installCanvasShim} from './canvas2d';
import {fakeEnvTextures, loadStripped} from './openablesFixture';
import {LEVELS} from '../../src/levels/registry';
import type {LevelId} from '../../src/levels/types';
import {WorldMaterials} from '../../src/world/materials';
import {buildWorld, type BuiltWorld} from '../../src/world/builder';
import {ContainerManager} from '../../src/world/containers';
import {ShelfStock, shelfJunkModelKeysFor, SHELF_JUNK_KEY, SHELF_JUNK_MODEL_FILES} from '../../src/world/shelfStock';
import {placementBox} from '../../src/items/lootLayout';
import {fogCullDistance} from '../../src/world/levelCulling';
import {dropUnloadedP7, p7ModelKeysFor, P7_FILES} from '../../src/gen/props07';
import {officeModelKeysFor} from '../../src/gen/office/index';
import {selectLevelKeys} from '../../src/assets/levelAssets';
import {MODEL_FILES} from '../../src/assets/manifest';
import {OFFICE_MODEL_FILES} from '../../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../../src/assets/mallAssets';
import {ANNEX_GENSET, gensetModelKeysFor} from '../../src/assets/annexGenset';
import {REACTOR_MODEL_FILES, reactorModelKeysFor} from '../../src/world/reactor/archAssets';
import {WASTE_MODEL_FILES, wasteModelKeysFor} from '../../src/world/reactor/wasteAssets';
import {minesModelKeysFor} from '../../src/world/reactor/minesAssets';
import {bunkerModelKeysFor} from '../../src/gen/reactor/complex/bunkerKinds';
import {BUNKER_KIT_MODEL_FILES, bunkerModelKindKeysFor} from '../../src/gen/bunker/bunkerKinds';
import {SKYWAYS_KITCHEN_MODEL_FILES, skywaysKitchenModelKeysFor} from '../../src/gen/skyways/kitchenKinds';
import {SKYWAYS_ADDON_MODEL_FILES, skywaysAddonModelKeysFor} from '../../src/gen/skyways/addonKinds';
import {SKYWAYS_DEST_MODEL_FILES, skywaysDestModelKeysFor} from '../../src/gen/skyways/destinations/skywaysDestModels';
import {skywaysGardenModelKeysFor} from '../../src/world/skywaysGardens';
import {lingerieDisplayModelKeys} from '../../src/gen/mall/lingerieStore';
import {lootProfile} from '../../src/items/lootTables';
import {Inventory} from '../../src/items/inventory';
import {markShadows} from '../../src/render/volumetric';
import {setAttributeInstancing} from '../../src/render/instancing';
import {MOOD} from '../../src/world/lights';
import {playerTrainPlacement, type TrainPlacement} from '../../src/gen/playerTrain';
import {ridePortals, type RidePortals} from '../../src/world/ridePortal';
import type {StationLayout} from '../../src/gen/stationTypes';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...MALL_MODEL_FILES, [ANNEX_GENSET.key]: {url: ANNEX_GENSET.url, bytes: ANNEX_GENSET.bytes},
  ...REACTOR_MODEL_FILES, ...WASTE_MODEL_FILES, ...SKYWAYS_KITCHEN_MODEL_FILES, ...SKYWAYS_ADDON_MODEL_FILES, ...SKYWAYS_DEST_MODEL_FILES, ...SHELF_JUNK_MODEL_FILES, ...BUNKER_KIT_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
/** Game.sectionModelKeys (the static-world ones): each may not apply to a layout (it then names nothing). */
const KEY_HOOKS: ((layout: never) => readonly string[])[] = [officeModelKeysFor, gensetModelKeysFor, lingerieDisplayModelKeys, shelfJunkModelKeysFor, bunkerModelKindKeysFor, skywaysKitchenModelKeysFor,
  skywaysAddonModelKeysFor, skywaysDestModelKeysFor, skywaysGardenModelKeysFor, reactorModelKeysFor, minesModelKeysFor, bunkerModelKeysFor, wasteModelKeysFor] as never;
const modelCache = new Map<string, Promise<GLTF>>();
const loadModel = (url: string) => { let m = modelCache.get(url); if (!m) modelCache.set(url, (m = loadStripped(url))); return m; };

export interface PortalWorld {
  id: LevelId; seed: number; layout: StationLayout; mats: WorldMaterials; world: BuiltWorld; cm: ContainerManager; stock: ShelfStock;
  scene: THREE.Scene;
  /** The model library's geometries (Game.propModels.ownsGeometry: shared by every station, never edited by a level). */
  modelGeometries: Set<THREE.BufferGeometry>;
  /** The three static roots Game.buildSection shows: the world group, the holders, the shelf stock. */
  roots: THREE.Object3D[];
  /** The parked car's placement and its two ride portals (null: the level places no car on this seed). */
  placement: TrainPlacement | null; portals: RidePortals | null;
  /** Wall-clock build time (ms, Node): buildWorld alone / everything. */
  ms: {world: number; all: number};
}

let materials: WorldMaterials | null = null;

/** The lazy + boot models of `layout` as the game selects them for level `id`. */
export async function portalModels(id: LevelId, layout: StationLayout): Promise<Record<string, GLTF>> {
  const want = new Set<string>(p7ModelKeysFor(layout));
  for (const f of KEY_HOOKS) { try { for (const k of f(layout as never)) want.add(k); } catch { /* the hook does not apply to this level */ } }
  const keys = selectLevelKeys(id, [...want], CATALOGUE).keys;
  const models: Record<string, GLTF> = {};
  for (const k of keys) if (CATALOGUE[k]) models[k] = await loadModel(CATALOGUE[k].url);
  for (const [k, f] of Object.entries(MODEL_FILES as Record<string, {url: string}>)) models[k] ??= await loadModel(f.url);
  return models;
}

/** Level `id` of `seed` as one scene (static roots only). Not cached: a test owns (and may mutate) its world. */
export async function portalWorld(id: LevelId, seed: number, o: {layout?: StationLayout} = {}): Promise<PortalWorld> {
  const def = LEVELS[id];
  const layout = o.layout ?? (def.generate(def.entry, {levelSeed: seed, startWeapon: 'pistol'} as never) as StationLayout);
  const models = await portalModels(id, layout);
  dropUnloadedP7(layout as never, new Set(p7ModelKeysFor(layout).filter(k => !!models[k]))); // Game.buildSection: placements without their model are dropped
  if (!materials) {
    const lb = new THREE.Box3().setFromObject(models.light.scene).getSize(new THREE.Vector3());
    materials = new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
  }
  const mats = materials;
  setAttributeInstancing(!!layout.mall || !!(layout as {reactor?: unknown}).reactor); // Game.buildSection
  const t0 = performance.now();
  const world = buildWorld(layout, mats, models);
  const t1 = performance.now();
  const cm = new ContainerManager(models, mats, () => new Inventory());
  cm.build(layout, models, lootProfile(id));
  const stock = new ShelfStock();
  stock.build(layout, {models: {...models, [SHELF_JUNK_KEY]: models[SHELF_JUNK_KEY]} as never, lotsOf: p => cm.holderFor(p)?.state.lots.map(l => placementBox(l.itemId, l)) ?? []});
  markShadows(world.group, true, true);
  markShadows(cm.group, true, true);
  markShadows(stock.group, true, false);
  world.culler.register(cm.group);
  world.culler.register(stock.group);
  world.culler.maxDistance = fogCullDistance(MOOD.fogDensity);
  const scene = new THREE.Scene();
  const roots = [world.group, cm.group, stock.group];
  for (const r of roots) scene.add(r);
  scene.updateMatrixWorld(true);
  const placement = playerTrainPlacement(layout);
  const modelGeometries = new Set<THREE.BufferGeometry>();
  for (const g of Object.values(models)) g.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) modelGeometries.add(m.geometry); });
  return {id, seed, layout, mats, world, cm, stock, scene, modelGeometries, roots, placement, portals: placement ? ridePortals(layout, placement) : null, ms: {world: t1 - t0, all: performance.now() - t0}};
}
