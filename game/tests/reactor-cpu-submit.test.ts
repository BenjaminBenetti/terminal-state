// Task studio-reactor-submit-roof-fog-20261102 (lane CPU, user: "Performance is very poor. Again it is a CPU time issue. GPU time is
// good. CPU spending around 20ms in 'submit' phase"): the Reactor's render-object budget per representative pose, measured in Node on
// the REAL build path (generated layout, the game's world / holders / shelf stock / loot display builders, the real enemies and the
// floor pickups, stripped models), like mall-budget.test.ts.
//
// The user's perf overlay (WebGPU, quality high): rim gallery 1,230 draws / 5 passes / 21.7 ms render submit, looking down the pit
// 1,048 draws / 15.3 ms, against ~4 ms GPU — ~15-18 us of CPU per draw. Every draw is a three r186 render object: its node / uniform /
// binding refresh and its encoded commands, in the scene pass AND (casters) the flashlight's shadow pass. Lane CPU's census (docs/
// reactor.md "CPU submission"): from the rim only ~15 % of the submitted scene draws owned a visible pixel (depth oracle) — the rest
// were rooms, the three side complexes, holders, dressing and enemies behind the pit's rock walls / under the storey slabs, drawn
// because the culler knew the pit only as an atrium (every tier visible through it) and moving objects were frustum-culled only.
// Fixes pinned here:
//  - world/levelCulling.ts slab + same- / cross-storey OCCLUSION (the mall's exact rules, lane PERF) on the Reactor too
//    (world/builder.ts; the vessel's undrawn grid column is see-through: ReactorArch.occlusionSee);
//  - storey-split chunks for the Reactor's holders / openables / purpose dressing and the per-storey, culler-decided loot display
//    (world/containers.ts, world/openables.ts, world/storefrontBuilder.ts: the mall's byStorey switch, now mall || reactor);
//  - enemies and pickups decided by the same rules from their boxes every update (LevelCuller.track, world/reactor/cpuActorCulling.ts);
//  - correctness: a depth-buffered oracle — the eye, and the flashlight's shadow camera within its range — finds no visible mesh hidden,
//    and no hidden enemy / pickup whose whole cull box shows a pixel.
// Estimates mirror three r186's render lists (one draw per visible mesh x material group in the frustum; transparent double-sided:
// two), the flashlight pass = castShadow meshes in its SpotLightShadow frustum on the camera's layers. No viewmodel / post quads /
// restart controls / map boards (a few dozen, culler-registered): Node estimates, never native timings.
// LL_REACTOR_CPU_OUT=/tmp/x.txt writes the per-pose numbers (vitest hides console output).
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimContext, installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {visibleMeshes} from './helpers/visibleMeshes';
import {compileNodeMaterial} from './helpers/nodeCompile';
import {LEVELS} from '../src/levels/registry';
import {codeToSeed, mulberry32} from '../src/core/rng';
import {CELL, FLOOR, Grid} from '../src/gen/grid';
import type {Level} from '../src/gen/levels';
import {LevelColumns} from '../src/world/levelGeometry';
import type {StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {ShelfStock} from '../src/world/shelfStock';
import {PickupManager} from '../src/world/pickups';
import {CULL_LAYER, LevelCuller, fogCullDistance} from '../src/world/levelCulling';
import {p7ModelKeysFor, P7_FILES} from '../src/gen/props07';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {MODEL_FILES} from '../src/assets/manifest';
import {lootProfile} from '../src/items/lootTables';
import {Inventory} from '../src/items/inventory';
import {markShadows} from '../src/render/volumetric';
import {attributeInstancing, setAttributeInstancing} from '../src/render/instancing';
import {ZombieLookLibrary} from '../src/ai/outfits';
import {pickZombieLook} from '../src/ai/wardrobe';
import {ZombieActor} from '../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {ENEMY_MODEL_FILES, enemyModelKeysFor} from '../src/ai/enemyModels';
import {REACTOR_MODEL_FILES, reactorModelKeysFor} from '../src/world/reactor/archAssets';
import {WASTE_MODEL_FILES, wasteModelKeysFor} from '../src/world/reactor/wasteAssets';
import {minesModelKeysFor} from '../src/world/reactor/minesAssets';
import {bunkerModelKeysFor} from '../src/gen/reactor/complex/bunkerKinds';
import {REACTOR_FOG} from '../src/world/reactor/archInstall';
import {ReactorCpuCulling} from '../src/world/reactor/cpuActorCulling';
import {emptyReactorState} from '../src/world/reactor/runState';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

const OUT = process.env.LL_REACTOR_CPU_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

/**
 * The budget: scene + flashlight-shadow draws per representative pose (static world + holders + loot display + enemies + pickups).
 * Measured with lane CPU's fixes on the feature branch with ROOF + FOG merged (000070S / 637474 / 218558): worst 714 (637474 mid-deck),
 * total 5,328 over the 9 views; the same harness on the branch WITHOUT them (docs/reactor.md "CPU submission"): worst 1,165, total 9,307
 * (000070S rim gallery 1,005 -> 486, rim down to the core 1,032 -> 614, mid-tier deck 956 -> 561). A budget failure means the Reactor's submitted work
 * grew: measure again (LL_REACTOR_CPU_OUT) and decide consciously before raising a cap.
 */
const BUDGET = {
  /** Worst pose over the three seeds (scene + shadow; measured 714), and the sum over the 9 seed x pose views (measured 5,328). */
  worst: 790, total: 5850,
  /** The slab / storey occlusion + tracking must remove at least this share of the rules-off draws on every rim view (measured 25-46 %). */
  rimCut: 0.2,
} as const;

// ---------------------------------------------------------------------------------------------------------------------------
// The real Reactor (the game's build path: Game.buildSection order)

const CATALOGUE = {...P7_FILES, ...REACTOR_MODEL_FILES, ...WASTE_MODEL_FILES, ...ENEMY_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const modelCache = new Map<string, Promise<GLTF>>();
const loadModel = (url: string) => { let m = modelCache.get(url); if (!m) modelCache.set(url, (m = loadStripped(url))); return m; };

type RealReactor = {
  layout: StationLayout; world: ReturnType<typeof buildWorld>; cm: ContainerManager;
  /** Static roots (world, holders + loot display, shelf stock) and the moving ones (enemy roots, the pickups group). */
  roots: THREE.Object3D[]; enemies: EnemyActor[]; pickups: PickupManager; dyn: THREE.Object3D[]; tracking: ReactorCpuCulling;
};
const reactors = new Map<number, Promise<RealReactor>>();
function realReactor(seed: number): Promise<RealReactor> {
  let r = reactors.get(seed);
  if (!r) reactors.set(seed, (r = (async () => {
    const layout = LEVELS.reactor.generate('main', {levelSeed: seed});
    // the lazy working set as Game.modelKeysFor selects it on a Reactor layout (props + the arch / mines / bunker / waste kits + enemies)
    const keys = selectLevelKeys('reactor', [...new Set([...p7ModelKeysFor(layout), ...reactorModelKeysFor(layout as never), ...minesModelKeysFor(layout as never),
      ...bunkerModelKeysFor(layout), ...wasteModelKeysFor(layout as never), ...enemyModelKeysFor(layout)])], CATALOGUE).keys;
    const models: Record<string, GLTF> = {};
    for (const k of keys) if (CATALOGUE[k]) models[k] = await loadModel(CATALOGUE[k].url);
    for (const [k, f] of Object.entries(MODEL_FILES as Record<string, {url: string}>)) models[k] ??= await loadModel(f.url);
    const lb = new THREE.Box3().setFromObject(models.light.scene).getSize(new THREE.Vector3());
    const mats = new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
    setAttributeInstancing(true); // Game.buildSection: on for the Reactor
    const world = buildWorld(layout, mats, models);
    const cm = new ContainerManager(models, mats, () => new Inventory());
    cm.build(layout, models, lootProfile('reactor'));
    const stock = new ShelfStock();
    stock.build(layout, {models, lotsOf: () => []});
    // Game.buildSection: structure / holders cast + receive the flashlight shadow, shelf stock casts
    markShadows(world.group, true, true);
    markShadows(cm.group, true, true);
    markShadows(stock.group, true, false);
    world.culler.register(cm.group);
    world.culler.register(stock.group);
    world.culler.maxDistance = Math.min(fogCullDistance(REACTOR_FOG.density), REACTOR_FOG.far); // archInstall.ts apply()
    // the enemies exactly as Game.spawnEnemy builds them (seeded looks, archetype actors, the floor height, shadow casters)
    const looks = new ZombieLookLibrary(models);
    const rand = mulberry32(seed ^ 0x5bd1e995);
    const enemies = layout.zombies.map((s, i) => {
      const {actor} = createEnemyActor(s, models, rand, () => new ZombieActor(looks.build(pickZombieLook(seed, i, s.type, looks.available)), s, rand));
      actor.brain.y = actor.root.position.y = s.y ?? layout.levels[s.level ?? 0].grid.floorAt(s.x, s.z);
      actor.syncTransform();
      markShadows(actor.root, false, false);
      return actor;
    });
    // the floor pickups (item stand-ins where the item models are not registered in Node)
    const pickups = new PickupManager({});
    const inv = new Inventory();
    for (const p of layout.pickups) pickups.add(inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, p.yaw ?? 0);
    const roots = [world.group, cm.group, stock.group];
    const dyn = [...enemies.map(e => e.root), pickups.group];
    for (const o of [...roots, ...dyn]) o.updateMatrixWorld(true);
    const host = {frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {teardown?(): void}[], layout, world, zombies: enemies, pickups};
    const tracking = new ReactorCpuCulling(host);
    return {layout, world, cm, roots, enemies, pickups, dyn, tracking};
  })()));
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Poses, cameras, three r186 render lists

interface Pose { name: string; x: number; y: number; z: number; yaw: number; pitch: number }
const EYE = 1.62;
/** yaw (camera rotation.y, 'YXZ') looking from (x, z) toward (tx, tz). */
const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/** The representative poses: the user's two screenshots (rim gallery along it; rim looking down at the core), a mid-tier deck. */
function keyPoses(layout: StationLayout): Pose[] {
  const r = layout.reactor!, core = r.core;
  const rimDecks = r.decks.filter(d => d.kind === 'gallery' && d.level === 0);
  const span = (d: (typeof rimDecks)[number]) => Math.max(d.rect.x1 - d.rect.x0, d.rect.z1 - d.rect.z0);
  const long = [...rimDecks].sort((a, b) => span(b) - span(a))[0];
  const g = long.rect, alongX = g.x1 - g.x0 >= g.z1 - g.z0;
  const gx = alongX ? g.x0 + 1.5 : (g.x0 + g.x1) / 2, gz = alongX ? (g.z0 + g.z1) / 2 : g.z0 + 1.5;
  const poses: Pose[] = [{name: 'rim-gallery', x: gx, y: long.y + EYE, z: gz, yaw: alongX ? yawTo(gx, gz, g.x1, gz) : yawTo(gx, gz, gx, g.z1), pitch: -0.1}];
  // at the gallery's pit edge (0.6 m inside the rail, like the screenshot: leaning over the railing), looking down at the core
  const cx = alongX ? (g.x0 + g.x1) / 2 : core.x < (g.x0 + g.x1) / 2 ? g.x0 + 0.6 : g.x1 - 0.6;
  const cz = alongX ? (core.z < (g.z0 + g.z1) / 2 ? g.z0 + 0.6 : g.z1 - 0.6) : (g.z0 + g.z1) / 2, d = Math.hypot(core.x - cx, core.z - cz);
  poses.push({name: 'rim-down', x: cx, y: long.y + EYE, z: cz, yaw: yawTo(cx, cz, core.x, core.z), pitch: Math.atan2(core.y0 + 3 - (long.y + EYE), d)});
  const tier = r.tiers.find(t => t.index === 2) ?? r.tiers[2];
  const mid = r.decks.filter(q => q.level === tier.level && q.kind !== 'stair-landing').sort((a, b) => (b.rect.x1 - b.rect.x0) * (b.rect.z1 - b.rect.z0) - (a.rect.x1 - a.rect.x0) * (a.rect.z1 - a.rect.z0))[0];
  const mx = (mid.rect.x0 + mid.rect.x1) / 2, mz = (mid.rect.z0 + mid.rect.z1) / 2, pc = r.pit.bounds;
  poses.push({name: 'mid-deck', x: mx, y: mid.y + EYE, z: mz, yaw: yawTo(mx, mz, (pc.x0 + pc.x1) / 2, (pc.z0 + pc.z1) / 2), pitch: -0.15});
  return poses;
}

/** Many poses for the correctness oracle: every deck kind per tier x 4 directions, the core ring, complex rooms, the rim platform. */
function oraclePoses(layout: StationLayout): Pose[] {
  const r = layout.reactor!, out: Pose[] = [];
  const seen = new Set<string>();
  const dirs: [number, number][] = [[0, -0.3], [Math.PI / 2, 0], [Math.PI, -0.6], [-Math.PI / 2, 0.3]];
  for (const d of r.decks) {
    if (d.kind === 'stair-landing' || seen.has(`${d.kind}${d.level}`)) continue;
    seen.add(`${d.kind}${d.level}`);
    const x = (d.rect.x0 + d.rect.x1) / 2, z = (d.rect.z0 + d.rect.z1) / 2;
    for (const [yaw, pitch] of dirs) out.push({name: `${d.kind}-L${d.level}`, x, y: d.y + EYE, z, yaw, pitch});
  }
  const cf = r.coreFloor;
  if (cf) {
    const g = layout.levels[layout.levels.length - 1].grid;
    for (let k = 0, n = 0; k < 8 && n < 4; k++) {
      const a = k * Math.PI / 4, rr = (cf.ring.r0 + cf.ring.r1) / 2, x = cf.x + Math.cos(a) * rr, z = cf.z + Math.sin(a) * rr;
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR || g.blocked[g.idx(cx, cy)]) continue;
      out.push({name: 'core-ring', x, y: cf.y + EYE, z, yaw: yawTo(x, z, cf.x, cf.z) + (k % 2 ? 0 : Math.PI), pitch: k % 4 === 1 ? 0.35 : -0.1});
      n++;
    }
  }
  for (const c of r.complexes ?? []) {
    for (const rm of c.rooms.filter((_, i) => i % 3 === 0)) {
      const a = layout.areas[rm.area], g = layout.levels[a.level ?? 0].grid;
      const x = (a.x + a.w / 2) * CELL, z = (a.y + a.h / 2) * CELL, [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR) continue;
      out.push({name: `${c.id}-${rm.key}`, x, y: g.floor[g.idx(cx, cy)] + EYE, z, yaw: (a.id * 2.4) % (2 * Math.PI), pitch: -0.1});
    }
  }
  const sp = r.start;
  out.push({name: 'rim-platform', x: sp.x, y: EYE, z: sp.z, yaw: sp.yaw, pitch: -0.05}, {name: 'rim-platform', x: sp.x, y: EYE, z: sp.z, yaw: sp.yaw + Math.PI, pitch: -0.05});
  return out;
}

/** A game camera (fov 75, the user's 3456 x 1813 aspect, the Reactor's far plane) at a pose. */
function eyeCam(p: Pose): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 3456 / 1813, 0.05, REACTOR_FOG.far);
  cam.position.set(p.x, p.y, p.z);
  cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** The game's flashlight (game.ts: SpotLight(.., 30 m, 0.58 rad, .., 1.2), camera-local offsets) on `cam`, torch on. */
function torchOn(cam: THREE.PerspectiveCamera): THREE.SpotLight {
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

/** three r186 render list of a camera under `roots`: draws (transparent double-sided = 2) of the meshes it would submit. */
function renderDraws(roots: readonly THREE.Object3D[], cam: THREE.Camera, casters = false): number {
  cam.updateMatrixWorld(true);
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices((cam as THREE.PerspectiveCamera).projectionMatrix, cam.matrixWorldInverse));
  const sph = new THREE.Sphere();
  let n = 0;
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && o.layers.test(cam.layers) && (!casters || m.castShadow)) {
      const im = m as THREE.InstancedMesh;
      if (!(im.isInstancedMesh && im.count === 0)) {
        let inView = true;
        if (m.frustumCulled !== false) {
          const own = (m as unknown as {boundingSphere?: THREE.Sphere | null}).boundingSphere; // InstancedMesh / SkinnedMesh (the actors set one)
          if (im.isInstancedMesh && !own) im.computeBoundingSphere();
          if (own || im.isInstancedMesh) sph.copy((m as unknown as {boundingSphere: THREE.Sphere}).boundingSphere); else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sph.copy(m.geometry.boundingSphere!); }
          inView = fr.intersectsSphere(sph.applyMatrix4(m.matrixWorld));
        }
        if (inView) {
          const mats = Array.isArray(m.material) ? m.geometry.groups.map(g => (m.material as THREE.Material[])[g.materialIndex!]).filter(Boolean) : [m.material as THREE.Material];
          for (const mt of mats) if (mt.visible) n += !casters && mt.transparent && mt.side === THREE.DoubleSide && !mt.forceSinglePass ? 2 : 1;
        }
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const r of roots) walk(r);
  return n;
}

const CULLED = (1 << CULL_LAYER) >>> 0;
const isCulled = (m: THREE.Object3D) => (m.layers.mask >>> 0) === CULLED;

interface Measured { scene: number; shadow: number; dynScene: number; dynShadow: number; cam: THREE.PerspectiveCamera; torch: THREE.SpotLight }

/**
 * Scene + flashlight-shadow draws at a pose: the loot display filled for this eye, the moving objects tracked (the game's frame hook)
 * or not, the culler forced. `rules: false` = the Reactor culler's slab / occlusion rules and the tracking off (the atrium rule alone).
 */
function measure(R: RealReactor, p: Pose, rules = true, near = false): Measured {
  const cam = eyeCam(p), torch = torchOn(cam);
  const {world, cm, roots, dyn, tracking} = R;
  // task reactor-playtest-round2-20261102 (lane COOLANT): the near coolant LOD as the frame hook drives it for this eye (budget poses)
  if (near) world.reactorArch?.visuals.core?.lod(cam.position);
  const c = world.culler;
  c.viewpoints = [torch];
  c.slabs = c.occlusion = rules;
  // the loot display as the game fills it for this eye (ContainerManager.target sets the eye; update refreshes the lots)
  (cm as unknown as {lastEye: THREE.Vector3}).lastEye.copy(cam.position);
  (cm as unknown as {dirty: boolean}).dirty = true;
  cm.update(0.2, 0);
  for (const o of [...roots, ...dyn]) o.updateMatrixWorld(true);
  if (rules) tracking.sync(); else tracking.clear();
  c.update(cam, true);
  torch.shadow.camera.layers.mask = cam.layers.mask;
  const dynScene = renderDraws(dyn, cam), dynShadow = renderDraws(dyn, torch.shadow.camera, true);
  return {scene: renderDraws(roots, cam) + dynScene, shadow: renderDraws(roots, torch.shadow.camera, true) + dynShadow, dynScene, dynShadow, cam, torch};
}
const done = (m: Measured) => m.cam.remove(m.torch, m.torch.target);

// ---------------------------------------------------------------------------------------------------------------------------

const SEEDS = [codeToSeed('000070S')!, 637474, 218558]; // (000070S = 9100: the lead's Reactor QA seed; reactor-level.test.ts's seeds)

describe('the REAL Reactor: render objects per representative pose (scene + flashlight shadow pass)', () => {
  it('rim gallery / rim down to the core / mid-tier deck within budget on three seeds; the rules cut the rim views', async () => {
    let worst = 0, total = 0;
    for (const seed of SEEDS) {
      const R = await realReactor(seed);
      // (lane COOLANT) the coolant pumping (the near goop layer's most expensive state), reset after: the oracle runs without it
      const vis = R.world.reactorArch!.visuals, pumping = {...emptyReactorState(3, 3), fuses: [true, true], breaker: true, valve: true, pump: true};
      vis.setRestartState(pumping, true);
      for (const p of keyPoses(R.layout)) {
        const off = measure(R, p, false, true);
        done(off);
        const on = measure(R, p, true, true);
        const c = R.world.culler;
        out(`seed ${seed} ${p.name}: near coolant draws ${R.world.reactorArch!.core?.near?.draws() ?? 0}`);
        out(`seed ${seed} ${p.name} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} yaw ${p.yaw.toFixed(2)} pitch ${p.pitch.toFixed(2)}): `
          + `rules off ${off.scene} + ${off.shadow} = ${off.scene + off.shadow} (enemies / pickups ${off.dynScene} + ${off.dynShadow}) | `
          + `on ${on.scene} + ${on.shadow} = ${on.scene + on.shadow} (enemies / pickups ${on.dynScene} + ${on.dynShadow}); slab ${c.slabCulled}, occluded ${c.occlusionCulled}, tracked hidden ${c.trackedCulled} / ${c.trackedCount}`);
        expect(on.scene + on.shadow, `${seed} ${p.name}`).toBeLessThanOrEqual(off.scene + off.shadow); // the rules only remove work
        if (p.name.startsWith('rim')) expect(on.scene + on.shadow, `${seed} ${p.name} cut`).toBeLessThanOrEqual((off.scene + off.shadow) * (1 - BUDGET.rimCut));
        worst = Math.max(worst, on.scene + on.shadow);
        total += on.scene + on.shadow;
        done(on);
      }
      vis.setRestartState(emptyReactorState(3, 3), true); // (lane COOLANT) back to dormant: no near layer
    }
    out(`worst ${worst}, total ${total}`);
    expect(worst).toBeLessThanOrEqual(BUDGET.worst);
    expect(total).toBeLessThanOrEqual(BUDGET.total);
  }, 900_000);

  it('oracle: no visible mesh is culled (eye, any rule); nothing the new rules hide is seen by the flashlight; no hidden enemy / pickup box shows', async () => {
    const R = await realReactor(SEEDS[0]);
    const all = new THREE.Group(), withProxies = new THREE.Group();
    const proxyMat = new THREE.MeshBasicMaterial({side: THREE.DoubleSide, transparent: true, depthWrite: false}); // tested, never occludes
    let checked = 0, bad = 0, torchBad = 0, boxBad = 0, hiddenBoxes = 0, newHidden = 0;
    const c = R.world.culler;
    try {
      for (const o of R.roots) all.add(o);
      for (const p of oraclePoses(R.layout)) {
        // the meshes the atrium rule alone shows and the new rules hide (slab / storey occlusion)
        const off = measure(R, p, false);
        done(off);
        const shownOff = new Set<THREE.Object3D>();
        for (const o of R.roots) o.traverse(x => { if ((x as THREE.Mesh).isMesh && !isCulled(x)) shownOff.add(x); });
        const m = measure(R, p);
        const fresh = new Set<THREE.Object3D>();
        for (const o of R.roots) o.traverse(x => { if ((x as THREE.Mesh).isMesh && isCulled(x) && shownOff.has(x)) fresh.add(x); });
        newHidden += fresh.size;
        const fromEye = visibleMeshes(all, m.cam, 256, 134, {minPx: 1});
        const hidden = [...fromEye].filter(([mesh]) => isCulled(mesh)).map(([mesh, n]) => `${p.name}: ${mesh.name} ${n}px`);
        // the flashlight's shadow camera (its 30 m range: three's SpotLightShadow far = distance) on every other pose
        let tb: string[] = [];
        if (checked % 2 === 0) {
          const fromTorch = visibleMeshes(all, m.torch.shadow.camera as THREE.PerspectiveCamera, 128, 128, {minPx: 1, maxDist: m.torch.distance});
          tb = [...fromTorch].filter(([mesh]) => fresh.has(mesh)).map(([mesh, n]) => `${p.name} torch: ${mesh.name} ${n}px`);
        }
        // every hidden enemy / pickup: its whole cull box (the box the culler decided) owns no pixel from the eye or the torch
        const boxes: THREE.Mesh[] = [];
        const tracked = (c as unknown as {tracked: Map<THREE.Object3D, {box(o: THREE.Box3): boolean; hidden: boolean}>}).tracked;
        for (const t of tracked.values()) {
          if (!t.hidden) continue;
          const b = new THREE.Box3();
          t.box(b);
          const px = new THREE.Mesh(new THREE.BoxGeometry(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), proxyMat);
          px.position.copy(b.getCenter(new THREE.Vector3()));
          px.name = 'tracked-box';
          boxes.push(px);
        }
        hiddenBoxes += boxes.length;
        let bb: string[] = [];
        if (boxes.length) {
          for (const o of R.roots) withProxies.add(o);
          withProxies.add(...boxes);
          const eyeBoxes = visibleMeshes(withProxies, m.cam, 256, 134, {minPx: 1});
          const torchBoxes = visibleMeshes(withProxies, m.torch.shadow.camera as THREE.PerspectiveCamera, 128, 128, {minPx: 1, maxDist: m.torch.distance});
          bb = boxes.filter(b => eyeBoxes.has(b) || torchBoxes.has(b)).map(b => `${p.name}: box at ${b.position.toArray().map(v => v.toFixed(1))} ${eyeBoxes.get(b) ?? 0}/${torchBoxes.get(b) ?? 0}px`);
          withProxies.remove(...boxes);
          for (const o of R.roots) all.add(o);
          for (const b of boxes) b.geometry.dispose();
        }
        out(`oracle ${p.name} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} yaw ${p.yaw.toFixed(2)} pitch ${p.pitch}): ${off.scene} + ${off.shadow} -> ${m.scene} + ${m.shadow}, `
          + `eye-visible ${fromEye.size}, newly hidden ${fresh.size}, tracked hidden ${boxes.length}; visible-but-culled ${hidden.length} ${hidden.slice(0, 3).join(' ')}; torch ${tb.length} ${tb.slice(0, 3).join(' ')}; boxes ${bb.length} ${bb.slice(0, 3).join(' ')}`);
        bad += hidden.length; torchBad += tb.length; boxBad += bb.length;
        expect(hidden).toEqual([]);
        expect(tb).toEqual([]);
        expect(bb).toEqual([]);
        checked++;
        done(m);
      }
    } finally {
      for (const o of [...all.children]) all.remove(o);
      for (const o of [...withProxies.children]) withProxies.remove(o);
      c.viewpoints = [];
      c.slabs = c.occlusion = true;
    }
    out(`oracle poses ${checked}: visible-but-culled ${bad}, torch ${torchBad}, hidden enemy / pickup boxes ${hiddenBoxes} (visible ${boxBad}); meshes the new rules hid ${newHidden}`);
    expect(checked).toBeGreaterThan(30);
    expect(newHidden).toBeGreaterThan(0); // the rules actually cull on these poses
    expect(hiddenBoxes).toBeGreaterThan(0); // and the tracked enemies / pickups too
  }, 900_000);

  it('tracked moving objects: decided every update from their current box, shown again when moved into view / untracked; none without occlusion data', async () => {
    const R = await realReactor(SEEDS[0]);
    const c = R.world.culler;
    const p = keyPoses(R.layout)[1]; // rim down to the core
    const g = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial());
    g.add(mesh);
    const r = R.layout.reactor!, pit = r.pit.bounds;
    const q = new THREE.Vector3();
    const box = (o: THREE.Box3) => { o.min.set(q.x - 0.3, q.y - 0.3, q.z - 0.3); o.max.set(q.x + 0.3, q.y + 0.3, q.z + 0.3); return true; };
    expect(c.track(g, box)).toBe(true);
    try {
      const m = measure(R, p);
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(m.cam.projectionMatrix, m.cam.matrixWorldInverse));
      // a point in the view cone behind the rock (a candidate the rules hide), found by scanning round the pit on every tier
      let found: THREE.Vector3 | null = null;
      for (const t of r.tiers) for (let x = pit.x0 - 24; x <= pit.x1 + 24 && !found; x += 4) for (let z = pit.z0 - 24; z <= pit.z1 + 24 && !found; z += 4) {
        q.set(x, t.baseY + 1, z);
        if (!fr.containsPoint(q)) continue;
        c.update(m.cam);
        if (isCulled(mesh)) found = q.clone();
      }
      expect(found, 'a hidden probe position in view').not.toBeNull();
      // into the open pit air 12 m along the view axis: shown at the next update (the camera did not move)
      q.copy(m.cam.position).addScaledVector(m.cam.getWorldDirection(new THREE.Vector3()), 12);
      c.update(m.cam);
      expect(isCulled(mesh)).toBe(false);
      q.copy(found!);
      c.update(m.cam);
      expect(isCulled(mesh)).toBe(true);
      expect(c.trackedCulled).toBeGreaterThan(0);
      c.untrack(g);
      expect(isCulled(mesh)).toBe(false); // untracked: its layers back
      out(`tracked probe: hidden at ${found!.toArray().map(v => v.toFixed(1))}, shown over the core`);
      done(m);
    } finally {
      c.untrack(g);
    }
    // the runtime (Game's frame hook): every live enemy / pickup tracked; a ragdolled enemy released (shown, never re-tracked); a
    // pickup taken (gone from the list) untracked and shown; teardown shows everything
    const m2 = measure(R, keyPoses(R.layout)[0]);
    const hiddenEnemy = R.enemies.find(z => z.root.children.length && (() => { let h = false; z.root.traverse(o => { if ((o as THREE.Mesh).isMesh && isCulled(o)) h = true; }); return h; })());
    expect(hiddenEnemy, 'an enemy hidden behind rock from the rim gallery').toBeTruthy();
    const tracked0 = c.trackedCount;
    expect(tracked0).toBe(R.enemies.length + R.pickups.list.length);
    const shown = (o: THREE.Object3D) => { let ok = true; o.traverse(x => { if ((x as THREE.Mesh).isMesh && isCulled(x)) ok = false; }); return ok; };
    (hiddenEnemy as {ragdolled: boolean}).ragdolled = true;
    try {
      R.tracking.sync();
      expect(shown(hiddenEnemy!.root)).toBe(true);
      expect(c.trackedCount).toBe(tracked0 - 1);
      c.update(m2.cam, true);
      expect(shown(hiddenEnemy!.root)).toBe(true); // released: never hidden again
    } finally {
      (hiddenEnemy as {ragdolled: boolean}).ragdolled = false;
    }
    const pk = R.pickups.list.find(q => !shown(q.obj));
    if (pk) {
      const i = R.pickups.list.indexOf(pk);
      (R.pickups.list as unknown as typeof pk[]).splice(i, 1);
      R.tracking.sync();
      expect(shown(pk.obj)).toBe(true);
      (R.pickups.list as unknown as typeof pk[]).splice(i, 0, pk);
    }
    R.tracking.clear();
    expect(c.trackedCount).toBe(0);
    for (const z of R.enemies) expect(shown(z.root)).toBe(true);
    done(m2);
    // a culler without slab / storey occlusion data (Subway / Office) tracks nothing
    const grid = new Grid(8, 8), lv = [{id: 0, role: 'main', grid, baseY: 0} as unknown as Level];
    expect(new LevelCuller(lv, new LevelColumns(lv), () => 0).track(g, box)).toBe(false);
  }, 600_000);

  it('one InstancedMesh per kit part: every band\'s instances, one tag set, the same program as a small instanced mesh (no new uniform buffer)', async () => {
    const R = await realReactor(SEEDS[0]);
    const plan = R.world.reactorArch!.plan!, kit: THREE.InstancedMesh[] = [];
    R.world.group.traverse(o => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh && /^reactor-(box|ibeam|cyl|tube|stripe|plane|cage|bulb)-/.test(m.name) && !/-b\d+$/.test(m.name)) kit.push(m); });
    const names = new Set(kit.map(m => m.name));
    expect(names.size).toBe(kit.length); // one mesh per (geo, material) part
    let inst = 0;
    for (const [key, part] of plan.parts) {
      if (part.mat === 'marker' || !part.list.length) continue;
      const m = kit.find(x => x.name === `reactor-${part.geo}-${part.mat}`);
      expect(m, key).toBeTruthy();
      expect(m!.count, key).toBe(part.list.length);
      inst += m!.count;
      const want = new Set(part.list.flatMap(q => plan.bandLevels(q.band)));
      expect(new Set(m!.userData.levels as number[]), key).toEqual(want); // tagged with every band's tiers
    }
    expect(inst).toBe([...plan.parts.values()].filter(p => p.mat !== 'marker').reduce((n, p) => n + p.list.length, 0));
    // the merged mesh compiles to exactly the program a small (per-band sized) InstancedMesh of the same part does on the Reactor's
    // attribute-instancing path: same uniform buffers / textures (WebGPU's 12-per-stage budget untouched), no per-mesh instance block
    const was = attributeInstancing();
    try {
      setAttributeInstancing(true);
      const big = [...kit].sort((a, b) => b.count - a.count)[0];
      const a = compileNodeMaterial(new THREE.InstancedMesh(big.geometry, big.material, big.count));
      const b = compileNodeMaterial(new THREE.InstancedMesh(big.geometry, big.material, 3));
      expect(a.vertex).toBe(b.vertex);
      expect(a.fragment).toBe(b.fragment);
      expect(a.vertex).not.toMatch(/NodeBuffer_\d+/);
      out(`kit: ${kit.length} part meshes, ${inst} instances; largest ${big.name} x ${big.count}: same program as x 3`);
    } finally {
      setAttributeInstancing(was);
    }
  }, 600_000);
});
