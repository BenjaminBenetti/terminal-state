// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY, user: "better performance, especially stuttering"): two things
// play creates on first use that a complete 'full' warm-up did not cover (first-use census of every level kind, Node, three r186's
// REAL WebGPURenderer on a no-op device), now prepared by Game.refreshRuntimeVariants before every warm-up / journey preparation:
//  1. a pickup that appears in play — a dropped item, a lot shot off its holder, a stolen ware — is a new object with its own
//     material copies (world/pickups.ts add()): PickupManager.pickupPrototypes offers a pickup of every item to the runtime-variant
//     pool (family 'pickup'). A/B on the real renderer: the prototyped half of the item registry dropped after the warm-up builds 0
//     node variants and requests 0 pipelines; the other half (the control) still builds;
//  2. a shelf filler piece knocked loose is drawn by an InstancedMesh per (family, archetype, label), made by the first piece of it
//     that moves (world/shelfStock.ts frame): world/shelfStockWarm.ts prepareStockMovingSets makes every set hidden and empty first
//     (the 'shelf-stock-moving' pool). A/B on a real stocked station knocked loose through the filler's own physics: 0 builds /
//     0 pipelines with the sets prepared, the control builds one per set. Pinned too: the preparation changes no piece, rest mesh or
//     shadow flag, is idempotent, sizes a set like the build-time rule (up to FILLER_TUNING.maxActive pieces), and play then draws
//     with the prepared set (no replacement).
// Node / no-op device counts of three's JavaScript (node builds, render objects, pipeline requests): no native GPU timing is claimed.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {loadStripped} from './helpers/openablesFixture';
import {installStockCanvas, stockedStation} from './helpers/stockHelpers';
import {WarmupRegistry, runWarmup, type WarmupRenderer} from '../src/render/warmup';
import {RuntimeVariantPool, variantKey} from '../src/render/runtimeVariants';
import {renderContextDepth} from '../src/render/renderContextDepth';
import {installShadowAlphaTwin} from '../src/render/shadowOverride';
import {markShadows} from '../src/render/volumetric';
import {MODEL_FILES} from '../src/assets/manifest';
import {ITEMS} from '../src/items/items';
import {Inventory} from '../src/items/inventory';
import {isLazyModelWeapon} from '../src/weapons/lazyWeaponModels';
import {PickupManager, registerItemModels} from '../src/world/pickups';
import {prepareStockMovingSets, stockMovingSets} from '../src/world/shelfStockWarm';
import {FILLER_TUNING} from '../src/physics/fillerStock';
import {PhysicsSystem} from '../src/physics/world';
import type {ShelfStock} from '../src/world/shelfStock';

let uninstall: () => void = () => {};
let boot: Record<string, GLTF> = {};
beforeAll(async () => {
  uninstall = await installStockCanvas(false);
  for (const [k, f] of Object.entries(MODEL_FILES as Record<string, {url: string}>)) boot[k] = await loadStripped(f.url);
  registerItemModels(boot as never);
}, 120_000);
afterAll(() => { uninstall(); vi.unstubAllGlobals(); });

/** A real renderer on the no-op device drawing `scene` through a pass in a RenderPipeline (the game's depth-1 station draw). */
async function rig(scene: THREE.Scene) {
  const canvas = stubWebgpuGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const r = new W.WebGPURenderer({canvas});
  await r.init();
  installShadowAlphaTwin(r);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  const n = {builds: 0, pipelines: 0};
  const R = r as unknown as {_nodes: {nodeFrame: {update(): void}}; backend: {createNodeBuilder: (...a: unknown[]) => unknown; createRenderPipeline: (...a: unknown[]) => unknown}};
  const cnb = R.backend.createNodeBuilder.bind(R.backend);
  R.backend.createNodeBuilder = (...a: unknown[]) => { n.builds++; return cnb(...a); };
  const crp = R.backend.createRenderPipeline.bind(R.backend);
  R.backend.createRenderPipeline = (...a: unknown[]) => { n.pipelines++; return crp(...a); };
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
  cam.rotation.order = 'YXZ';
  const torch = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
  torch.position.set(0.2, -0.15, 0.1); torch.target.position.set(0.04, -0.12, -6); torch.castShadow = true; torch.shadow.mapSize.set(512, 512);
  cam.add(torch, torch.target);
  scene.add(cam, new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.4));
  const scenePass = TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: unknown};
  const pipe = new W.RenderPipeline(r, scenePass as never);
  const frame = () => { r.info.reset(); R._nodes.nodeFrame.update(); r.setRenderTarget(null); pipe.render(); };
  const reg = new WarmupRegistry();
  const warm = async () => {
    const res = await runWarmup({
      renderer: r as unknown as WarmupRenderer, scene, camera: cam, mode: 'full', registry: reg,
      sceneTarget: () => scenePass.renderTarget, torch, torchIntensity: 1, frame, finish: frame, hide: () => {}, alive: () => true,
      sceneDepth: () => { const m = cam.layers.mask; cam.layers.mask = 0; try { return renderContextDepth(r, scenePass.renderTarget, frame) ?? 0; } finally { cam.layers.mask = m; } },
    }, {yieldFrame: () => Promise.resolve()});
    expect(res.status).toBe('complete');
    expect(res.sceneDepth).toBe(1);
    return res;
  };
  /** What `fn` made three build / request. */
  const count = (fn: () => void) => { const b = n.builds, p = n.pipelines; fn(); return {builds: n.builds - b, pipelines: n.pipelines - p}; };
  return {r, n, cam, torch, frame, reg, warm, count};
}

const GUNS = (): Record<string, GLTF> => ({rifle: boot.rifle, shotgun: boot.shotgun, pistol: boot.pistol, ...(boot.knife ? {knife: boot.knife} : {})});
/**
 * Every item a plain pickup can show (the lazily delivered weapon models — the variety weapons and, task
 * studio-flamethrower-fire-20261114-031614-01, the Flamethrower — are their own pool's: world/weaponVarietyModels.ts).
 */
const PICKUP_IDS = Object.keys(ITEMS).filter(id => !isLazyModelWeapon(id));

describe('pickups: PickupManager.pickupPrototypes', () => {
  it('are add()\'s meshes, variant for variant, for every item; pure (no pickup, no group child, no id used)', () => {
    const pm = new PickupManager(GUNS());
    const inv = new Inventory();
    const first = pm.add(inv.makeStack('bandage', 1), 0, 0, 0);
    pm.remove(first);
    const proto = pm.pickupPrototypes([...PICKUP_IDS, ...PICKUP_IDS, 'rifle']);
    expect(pm.list.length).toBe(0);
    expect(pm.group.children.length).toBe(0);
    expect(pm.add(inv.makeStack('bandage', 1), 0, 0, 0).id).toBe(first.id + 1); // (no pickup id was taken)
    const protoKeys = new Map<string, Set<string>>();
    for (const m of proto.meshes) {
      expect(m.matrixAutoUpdate).toBe(false);
      const id = PICKUP_IDS.find(i => m.name === `pickup-${i}` || m.name.startsWith(`pickup-${i}-`));
      expect(id, m.name).toBeTruthy();
      let keys = protoKeys.get(id!);
      if (!keys) protoKeys.set(id!, (keys = new Set()));
      keys.add(variantKey(m));
    }
    // each item's prototypes carry exactly the variants a real pickup of it is drawn with
    for (const id of PICKUP_IDS) {
      const p = pm.add(inv.makeStack(id, 1), 3, 0, -2, 1.1);
      const keys = new Set<string>();
      p.obj.traverse(o => { if ((o as THREE.Mesh).isMesh) keys.add(variantKey(o as THREE.Mesh)); });
      expect([...protoKeys.get(id) ?? []].sort(), id).toEqual([...keys].sort());
      pm.remove(p);
    }
    // every material is the prototypes' own copy (the pool releases them), never a template's shared one
    const meshMats = new Set(proto.meshes.flatMap(m => (Array.isArray(m.material) ? m.material : [m.material])));
    for (const m of meshMats) expect(proto.materials).toContain(m);
    expect(protoKeys.has('rifle')).toBe(true);
    expect(protoKeys.size).toBe(PICKUP_IDS.length);
  });

  it('A/B after a full warm-up: a drop of every prototyped item builds 0 and requests 0 pipelines; the unprototyped half still builds', async () => {
    const scene = new THREE.Scene();
    const k = await rig(scene);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({color: 0x333333}));
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = floor.receiveShadow = true;
    scene.add(floor);
    const pm = new PickupManager(GUNS());
    scene.add(pm.group);
    const pool = new RuntimeVariantPool();
    scene.add(pool.root);
    k.reg.addPool('runtime-variants', () => [pool.root]);
    const A = PICKUP_IDS.filter((_, i) => i % 2 === 0), B = PICKUP_IDS.filter((_, i) => i % 2 === 1);
    const proto = pm.pickupPrototypes(A);
    const st = pool.rebuild([{name: 'pickup', meshes: proto.meshes}], {materials: proto.materials});
    expect(st.families.pickup.kept).toBeGreaterThan(5);
    k.cam.position.set(0, 1.62, 0);
    k.cam.updateMatrixWorld(true);
    await k.warm();
    k.frame();
    const inv = new Inventory();
    const drop = (ids: readonly string[]) => {
      const built: string[] = [];
      let builds = 0, pipelines = 0;
      for (const id of ids) {
        const c = k.count(() => {
          const p = pm.add(inv.makeStack(id, 1), 0, 0.6, -1.4, 0.3);
          pm.update(0);
          k.frame(); k.frame();
          pm.remove(p);
        });
        if (c.builds || c.pipelines) built.push(`${id}: ${c.builds} / ${c.pipelines}`);
        builds += c.builds; pipelines += c.pipelines;
      }
      return {builds, pipelines, built};
    };
    const a = drop(A);
    expect(a, 'prototyped half').toEqual({builds: 0, pipelines: 0, built: []});
    const b = drop(B);
    expect(b.builds, 'the control: the unprototyped half builds on first drop').toBeGreaterThan(0);
    // and the prototyped half again, after the control's drops: still nothing
    expect(drop(A)).toEqual({builds: 0, pipelines: 0, built: []});
  }, 240_000);
});

/** A real stocked station (tests/helpers/stockHelpers.ts) with the filler on its own physics, shadow-marked as the game marks it. */
async function stockScene() {
  const {layout, cm, stock} = await stockedStation(9001);
  const scene = new THREE.Scene();
  scene.add(stock.group);
  markShadows(stock.group, true, false); // (Game.buildSection: atmosphere.markShadows(stock.group, false))
  const physics = new PhysicsSystem(null, null);
  physics.build(layout as never);
  physics.holderBoxes = p => stock.physicsBoxes(p, cm.physicsBoxes(p));
  stock.filler.attach(physics);
  return {scene, stock, physics};
}
/** One piece of every moving set of the station (as ShelfStock keys them). */
function onePerSet(stock: ShelfStock) {
  const one = new Map<string, ShelfStock['filler']['pieces'][number]>();
  for (const p of stock.filler.pieces) { const key = setKey(stock, p.id); if (!one.has(key)) one.set(key, p); }
  return one;
}
/** The moving set a piece is drawn with, as ShelfStock keys them (a modelled prop per archetype, the authored filler per archetype and label). */
const setKey = (stock: ShelfStock, id: number) => { const i = stock.pieceInfo(id); return i.model ? `model:${i.arch}` : `stock:${i.arch}:${i.variant}`; };
/** A hash of every rest mesh's vertices (positions and normals). */
const restBytes = (stock: ShelfStock) => {
  const out: string[] = [];
  for (const o of stock.group.children) {
    const m = o as THREE.Mesh;
    if ((m as THREE.InstancedMesh).isInstancedMesh || !m.isMesh) continue;
    const h = createHash('sha1');
    for (const a of [m.geometry.attributes.position, m.geometry.attributes.normal]) { const v = a.array as ArrayLike<number> & ArrayBufferView; h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength)); }
    out.push(`${m.name}:${h.digest('hex')}`);
  }
  return out;
};

describe('shelf filler: prepareStockMovingSets', () => {
  it('makes every set hidden and empty, sized by the build-time rule; changes no piece / rest mesh / shadow flag; idempotent; play uses the prepared set', async () => {
    const {stock, physics} = await stockScene();
    const sets = onePerSet(stock);
    expect(sets.size).toBeGreaterThan(10);
    const stats0 = JSON.stringify(stock.filler.stats()), rest0 = restBytes(stock), states0 = stock.filler.pieces.map(p => `${p.state}:${p.p.toArray()}:${p.q.toArray()}`);
    const n = prepareStockMovingSets(stock);
    const made = stockMovingSets(stock);
    expect(n).toBe(made.length);
    expect(made.length).toBe(sets.size);
    for (const m of made) {
      expect([m.visible, m.count]).toEqual([false, 0]);
      // shadow flags: what a set made on first use has (made after the station marked its casters: three's defaults)
      expect([m.castShadow, m.receiveShadow]).toEqual([false, false]);
    }
    // capacity: ShelfStock's own rule (at least 8, a power of two) for up to maxActive pieces of the set — all of them when fewer,
    // never every piece of a big archetype (a set's whole instance buffer is written on every frame it draws)
    const perSet = new Map<string, number>();
    for (const p of stock.filler.pieces) { const key = setKey(stock, p.id); perSet.set(key, (perSet.get(key) ?? 0) + 1); }
    expect([...perSet.values()].some(v => v > FILLER_TUNING.maxActive)).toBe(true); // (the bound matters on this station)
    const want = [...perSet.values()].map(v => Math.max(8, 1 << Math.ceil(Math.log2(Math.min(v, FILLER_TUNING.maxActive))))).sort((a, b) => a - b);
    expect(made.map(m => m.instanceMatrix.count).sort((a, b) => a - b)).toEqual(want);
    expect(JSON.stringify(stock.filler.stats())).toBe(stats0);
    expect(restBytes(stock)).toEqual(rest0);
    expect(stock.filler.pieces.map(p => `${p.state}:${p.p.toArray()}:${p.q.toArray()}`)).toEqual(states0);
    // idempotent: the same set objects
    const ids = made.map(m => m.uuid).sort();
    expect(prepareStockMovingSets(stock)).toBe(n);
    expect(stockMovingSets(stock).map(m => m.uuid).sort()).toEqual(ids);
    // play: one piece of every set knocked loose by the filler's own physics draws with the prepared sets (none made or replaced)
    for (const p of sets.values()) stock.filler.shoot(p, p.p.clone(), new THREE.Vector3(0, 0.2, 1), 0.4);
    for (let f = 0; f < 4; f++) physics.update(1 / 60);
    const after = stockMovingSets(stock);
    expect(after.map(m => m.uuid).sort()).toEqual(ids);
    expect(after.filter(m => m.visible && m.count > 0).length).toBeGreaterThan(0);
  }, 120_000);

  it('A/B after a full warm-up: knocking one piece of every set loose builds 0 / requests 0 pipelines with the sets prepared; the control builds', async () => {
    const knock = async (prepare: boolean) => {
      const {scene, stock, physics} = await stockScene();
      const k = await rig(scene);
      k.reg.addPool('shelf-junk-moving', () => stock.warmRoots());
      k.reg.addPool('shelf-stock-moving', () => stockMovingSets(stock));
      if (prepare) prepareStockMovingSets(stock);
      const p0 = stock.filler.pieces[0];
      k.cam.position.set(p0.p.x, p0.p.y + 0.3, p0.p.z + 2);
      k.cam.updateMatrixWorld(true);
      await k.warm();
      k.frame();
      const sets = onePerSet(stock);
      const c = k.count(() => {
        let i = 0;
        for (const p of sets.values()) {
          stock.filler.shoot(p, p.p.clone(), new THREE.Vector3(0, 0.2, 1), 0.4);
          if (++i % 6 === 0) { physics.update(1 / 60); k.frame(); }
        }
        for (let f = 0; f < 4; f++) { physics.update(1 / 60); k.frame(); }
      });
      return {...c, sets: sets.size, drawn: stockMovingSets(stock).filter(m => m.visible && m.count > 0).length};
    };
    const fixed = await knock(true);
    expect(fixed.drawn).toBeGreaterThan(0);
    expect({builds: fixed.builds, pipelines: fixed.pipelines}).toEqual({builds: 0, pipelines: 0});
    const control = await knock(false);
    expect(control.drawn).toBe(fixed.drawn);
    expect(control.builds, 'the control: every set made on first use builds').toBeGreaterThanOrEqual(control.drawn);
  }, 300_000);
});

describe('Game wiring', () => {
  it('refreshRuntimeVariants offers the pickups and prepares the moving sets; the sets are a registered pool', () => {
    const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('private refreshRuntimeVariants('), src.indexOf('prepareBeforeShow(root'));
    expect(body).toContain('this.pickups.pickupPrototypes(Object.keys(ITEMS))');
    expect(body).toContain("{name: 'pickup', meshes: pickup.meshes}");
    expect(body).toContain('materials: pickup.materials');
    expect(body).toContain('prepareStockMovingSets(this.stock)');
    // (before the pool rebuild: the 'full' early return clears the pool and prepares nothing)
    expect(body.indexOf("if (mode !== 'full'")).toBeLessThan(body.indexOf('prepareStockMovingSets'));
    expect(src).toContain("this.warmRegistry.addPool('shelf-stock-moving', () => stockMovingSets(this.stock));");
  });
});
