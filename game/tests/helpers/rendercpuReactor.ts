// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU): the REAL Reactor on the game's build path (as
// tests/reactor-cpu-submit.test.ts realReactor: world, holders + loot display, shelf stock, shadow marks, culler registration, the
// enemies as Game.spawnEnemy builds them, the floor pickups, the CPU actor culling) as one scene, for post-warm-up first-use censuses.
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimContext, installCanvasShim} from './canvas2d';
import {fakeEnvTextures, loadStripped} from './openablesFixture';
import {LEVELS} from '../../src/levels/registry';
import {mulberry32} from '../../src/core/rng';
import {FLOOR} from '../../src/gen/grid';
import {WorldMaterials} from '../../src/world/materials';
import {buildWorld} from '../../src/world/builder';
import {ContainerManager} from '../../src/world/containers';
import {ShelfStock} from '../../src/world/shelfStock';
import {PickupManager} from '../../src/world/pickups';
import {fogCullDistance} from '../../src/world/levelCulling';
import {p7ModelKeysFor, P7_FILES} from '../../src/gen/props07';
import {selectLevelKeys} from '../../src/assets/levelAssets';
import {MODEL_FILES} from '../../src/assets/manifest';
import {lootProfile} from '../../src/items/lootTables';
import {Inventory} from '../../src/items/inventory';
import {markShadows} from '../../src/render/volumetric';
import {setAttributeInstancing} from '../../src/render/instancing';
import {ZombieLookLibrary} from '../../src/ai/outfits';
import {pickZombieLook} from '../../src/ai/wardrobe';
import {ZombieActor} from '../../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor} from '../../src/ai/creatureArchetypes';
import {ENEMY_MODEL_FILES, enemyModelKeysFor} from '../../src/ai/enemyModels';
import {REACTOR_MODEL_FILES, reactorModelKeysFor} from '../../src/world/reactor/archAssets';
import {WASTE_MODEL_FILES, wasteModelKeysFor} from '../../src/world/reactor/wasteAssets';
import {minesModelKeysFor} from '../../src/world/reactor/minesAssets';
import {bunkerModelKeysFor} from '../../src/gen/reactor/complex/bunkerKinds';
import {REACTOR_FOG} from '../../src/world/reactor/archInstall';
import {ReactorCpuCulling} from '../../src/world/reactor/cpuActorCulling';
import type {StationLayout} from '../../src/gen/stationTypes';
import type {Pose} from './rendercpuMall';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

const CATALOGUE = {...P7_FILES, ...REACTOR_MODEL_FILES, ...WASTE_MODEL_FILES, ...ENEMY_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const modelCache = new Map<string, Promise<GLTF>>();
const loadModel = (url: string) => { let m = modelCache.get(url); if (!m) modelCache.set(url, (m = loadStripped(url))); return m; };

export interface RealReactorScene {
  seed: number; layout: StationLayout; world: ReturnType<typeof buildWorld>; cm: ContainerManager; enemies: EnemyActor[]; scene: THREE.Scene;
  tracking: ReactorCpuCulling; poses: Pose[];
}

/** The Reactor of `seed` as one scene (seed 9100 = 000070S, the lead's Reactor QA seed). */
export async function realReactorScene(seed = 9100): Promise<RealReactorScene> {
  const layout = LEVELS.reactor.generate('main', {levelSeed: seed});
  const keys = selectLevelKeys('reactor', [...new Set([...p7ModelKeysFor(layout), ...reactorModelKeysFor(layout as never), ...minesModelKeysFor(layout as never),
    ...bunkerModelKeysFor(layout), ...wasteModelKeysFor(layout as never), ...enemyModelKeysFor(layout)])], CATALOGUE).keys;
  const models: Record<string, GLTF> = {};
  for (const k of keys) if (CATALOGUE[k]) models[k] = await loadModel(CATALOGUE[k].url);
  for (const [k, f] of Object.entries(MODEL_FILES as Record<string, {url: string}>)) models[k] ??= await loadModel(f.url);
  const lb = new THREE.Box3().setFromObject(models.light.scene).getSize(new THREE.Vector3());
  const mats = new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
  setAttributeInstancing(true);
  const world = buildWorld(layout, mats, models);
  const cm = new ContainerManager(models, mats, () => new Inventory());
  cm.build(layout, models, lootProfile('reactor'));
  const stock = new ShelfStock();
  stock.build(layout, {models, lotsOf: () => []});
  markShadows(world.group, true, true);
  markShadows(cm.group, true, true);
  markShadows(stock.group, true, false);
  world.culler.register(cm.group);
  world.culler.register(stock.group);
  world.culler.maxDistance = Math.min(fogCullDistance(REACTOR_FOG.density), REACTOR_FOG.far);
  const looks = new ZombieLookLibrary(models);
  const rand = mulberry32(seed ^ 0x5bd1e995);
  const enemies = layout.zombies.map((s, i) => {
    const {actor} = createEnemyActor(s, models, rand, () => new ZombieActor(looks.build(pickZombieLook(seed, i, s.type, looks.available)), s, rand));
    actor.brain.y = actor.root.position.y = s.y ?? layout.levels[s.level ?? 0].grid.floorAt(s.x, s.z);
    actor.syncTransform();
    markShadows(actor.root, false, false);
    return actor;
  });
  const pickups = new PickupManager({});
  const inv = new Inventory();
  for (const p of layout.pickups) pickups.add(inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, p.yaw ?? 0);
  const scene = new THREE.Scene();
  for (const o of [world.group, cm.group, stock.group, ...enemies.map(e => e.root), pickups.group]) scene.add(o);
  scene.updateMatrixWorld(true);
  const host = {frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {teardown?(): void}[], layout, world, zombies: enemies, pickups};
  const tracking = new ReactorCpuCulling(host);
  tracking.sync();
  // poses: the start (rim platform), the rim gallery looking along it, a tier-2 deck across the pit, the core floor ring
  const r = layout.reactor!, out: Pose[] = [{name: 'start', x: r.start.x, y: 0, z: r.start.z, yaw: r.start.yaw, pitch: 0}];
  const g0 = r.decks.filter(d => d.kind === 'gallery' && d.level === 0).sort((a, b) => Math.max(b.rect.x1 - b.rect.x0, b.rect.z1 - b.rect.z0) - Math.max(a.rect.x1 - a.rect.x0, a.rect.z1 - a.rect.z0))[0];
  if (g0) out.push({name: 'rim-gallery', x: (g0.rect.x0 + g0.rect.x1) / 2, y: g0.y, z: (g0.rect.z0 + g0.rect.z1) / 2, yaw: 0, pitch: 0});
  const tier = r.tiers.find(t => t.index === 2) ?? r.tiers[2];
  const mid = tier && r.decks.filter(q => q.level === tier.level && q.kind !== 'stair-landing').sort((a, b) => (b.rect.x1 - b.rect.x0) * (b.rect.z1 - b.rect.z0) - (a.rect.x1 - a.rect.x0) * (a.rect.z1 - a.rect.z0))[0];
  if (mid) out.push({name: 'tier-deck', x: (mid.rect.x0 + mid.rect.x1) / 2, y: mid.y, z: (mid.rect.z0 + mid.rect.z1) / 2, yaw: 0, pitch: 0});
  const cf = r.coreFloor;
  if (cf) {
    const g = layout.levels[layout.levels.length - 1].grid;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, rr = (cf.ring.r0 + cf.ring.r1) / 2, x = cf.x + Math.cos(a) * rr, z = cf.z + Math.sin(a) * rr;
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR || g.blocked[g.idx(cx, cy)]) continue;
      out.push({name: 'core-floor', x, y: cf.y, z, yaw: 0, pitch: 0});
      break;
    }
  }
  return {seed, layout, world, cm, enemies, scene, tracking, poses: out};
}
