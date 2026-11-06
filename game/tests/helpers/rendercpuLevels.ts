// Task static-batching-warmup-20261105: the Subway / Office worlds as ONE scene each, built the way Game.buildSection builds them
// (buildWorld, holders + loot display, shelf stock, flashlight shadow marking, culler registration) with the real Meshy / prop
// models — the Subway / Office counterpart of rendercpuMall.realMallScene / rendercpuReactor.realReactorScene (draw census + A/B
// harnesses). Enemies are not built here (the static-batching census counts the world's static draws).
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimContext, installCanvasShim} from './canvas2d';
import {fakeEnvTextures, loadStripped} from './openablesFixture';
import {LEVELS} from '../../src/levels/registry';
import {WorldMaterials} from '../../src/world/materials';
import {buildWorld} from '../../src/world/builder';
import {ContainerManager} from '../../src/world/containers';
import {ShelfStock} from '../../src/world/shelfStock';
import {placementBox} from '../../src/items/lootLayout';
import {fogCullDistance} from '../../src/world/levelCulling';
import {p7ModelKeysFor, P7_FILES} from '../../src/gen/props07';
import {officeModelKeysFor} from '../../src/gen/office/index';
import {selectLevelKeys} from '../../src/assets/levelAssets';
import {MODEL_FILES} from '../../src/assets/manifest';
import {OFFICE_MODEL_FILES} from '../../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../../src/assets/companyAssets';
import {lootProfile} from '../../src/items/lootTables';
import {Inventory} from '../../src/items/inventory';
import {markShadows} from '../../src/render/volumetric';
import {setAttributeInstancing} from '../../src/render/instancing';
import {MOOD} from '../../src/world/lights';
import type {StationLayout} from '../../src/gen/stationTypes';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const modelCache = new Map<string, Promise<GLTF>>();
const loadModel = (url: string) => { let m = modelCache.get(url); if (!m) modelCache.set(url, (m = loadStripped(url))); return m; };

export interface RealLevelScene {
  level: 'subway' | 'office'; seed: number; layout: StationLayout; world: ReturnType<typeof buildWorld>; cm: ContainerManager; stock: ShelfStock;
  scene: THREE.Scene; roots: THREE.Object3D[];
}

/** A Subway / Office world of `seed` as one scene (static roots only). */
export async function realLevelScene(level: 'subway' | 'office', seed: number): Promise<RealLevelScene> {
  const def = LEVELS[level];
  const layout = def.generate(def.entry, {levelSeed: seed, startWeapon: 'pistol'} as never);
  const keys = selectLevelKeys(level, [...new Set([...p7ModelKeysFor(layout), ...(level === 'office' ? officeModelKeysFor(layout as never) : [])])], CATALOGUE).keys;
  const models: Record<string, GLTF> = {};
  for (const k of keys) if (CATALOGUE[k]) models[k] = await loadModel(CATALOGUE[k].url);
  for (const [k, f] of Object.entries(MODEL_FILES as Record<string, {url: string}>)) models[k] ??= await loadModel(f.url);
  const lb = new THREE.Box3().setFromObject(models.light.scene).getSize(new THREE.Vector3());
  const mats = new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
  setAttributeInstancing(false); // Game.buildSection: off outside the mall / Reactor
  const world = buildWorld(layout, mats, models);
  const cm = new ContainerManager(models, mats, () => new Inventory());
  cm.build(layout, models, lootProfile(level));
  const stock = new ShelfStock();
  stock.build(layout, {models, lotsOf: p => cm.holderFor(p)?.state.lots.map(l => placementBox(l.itemId, l)) ?? []});
  markShadows(world.group, true, true);
  markShadows(cm.group, true, true);
  markShadows(stock.group, true, false);
  world.culler.register(cm.group);
  world.culler.register(stock.group);
  world.culler.maxDistance = fogCullDistance(MOOD.fogDensity);
  const scene = new THREE.Scene();
  const roots = [world.group, cm.group, stock.group];
  for (const o of roots) scene.add(o);
  scene.updateMatrixWorld(true);
  return {level, seed, layout, world, cm, stock, scene, roots};
}
