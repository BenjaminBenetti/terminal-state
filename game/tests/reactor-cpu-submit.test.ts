// Task studio-reactor-submit-roof-fog-20261102 (lane CPU, user: "Performance is very poor. Again it is a CPU time issue. GPU time is
// good. CPU spending around 20ms in 'submit' phase"): the Reactor's render-object budget per representative pose, measured in Node on
// the REAL build path (generated layout, the game's world / holders / shelf stock / loot display builders, stripped models), like
// mall-budget.test.ts.
//
// The user's perf overlay (WebGPU, quality high): rim gallery 1,230 draws / 5 passes / 21.7 ms render submit, looking down the pit
// 1,048 draws / 15.3 ms, against ~4 ms GPU — ~15-18 us of CPU encoding per draw. Every draw is a three r186 render object: its node /
// uniform / binding refresh and its encoded commands, in the scene pass AND (casters) the flashlight's shadow pass. Lane CPU's census
// (game/tests/reactor-cpu-submit.test.ts numbers; docs/reactor.md "CPU submission"): from the rim only ~15 % of the submitted scene
// draws own a visible pixel (depth oracle) — the rest were rooms, the three side complexes, holders and dressing behind the pit's rock
// walls / under the storeys' slabs, drawn because the culler only knew the pit as an atrium (every tier visible through it).
// Fixes pinned here:
//  - world/levelCulling.ts slab + same- / cross-storey OCCLUSION (the mall's exact rules, lane PERF) now also on the Reactor
//    (world/builder.ts; the vessel's undrawn grid column counts as see-through: ReactorArch.occlusionSee);
//  - storey-split chunks for the Reactor's holders / openables / purpose dressing and the per-storey, culler-decided loot display
//    (world/containers.ts, world/openables.ts, world/storefrontBuilder.ts: the mall's byStorey switch, now mall || reactor);
//  - correctness: a depth-buffered oracle (eye, and the flashlight's shadow camera within its range) finds no visible mesh hidden.
// Estimates mirror three r186's render lists (one draw per visible mesh x material group in the frustum; transparent double-sided:
// two), the flashlight pass = castShadow meshes in its SpotLightShadow frustum on the camera's layers. Static world + holders + shelf
// stock + loot display only (no enemies / pickups / viewmodel / post quads): Node estimates, not native measurements.
// LL_REACTOR_CPU_OUT=/tmp/x.txt writes the per-pose numbers (vitest hides console output).
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimContext, installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {visibleMeshes} from './helpers/visibleMeshes';
import {LEVELS} from '../src/levels/registry';
import {codeToSeed} from '../src/core/rng';
import {CELL, FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {ShelfStock} from '../src/world/shelfStock';
import {CULL_LAYER, fogCullDistance} from '../src/world/levelCulling';
import {p7ModelKeysFor, P7_FILES} from '../src/gen/props07';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {MODEL_FILES} from '../src/assets/manifest';
import {lootProfile} from '../src/items/lootTables';
import {Inventory} from '../src/items/inventory';
import {markShadows} from '../src/render/volumetric';
import {setAttributeInstancing} from '../src/render/instancing';
import {REACTOR_MODEL_FILES, reactorModelKeysFor} from '../src/world/reactor/archAssets';
import {WASTE_MODEL_FILES, wasteModelKeysFor} from '../src/world/reactor/wasteAssets';
import {minesModelKeysFor} from '../src/world/reactor/minesAssets';
import {bunkerModelKeysFor} from '../src/gen/reactor/complex/bunkerKinds';
import {REACTOR_FOG} from '../src/world/reactor/archInstall';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

const OUT = process.env.LL_REACTOR_CPU_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

// ---------------------------------------------------------------------------------------------------------------------------
// The real Reactor (the game's build path: Game.buildSection order)

const CATALOGUE = {...P7_FILES, ...REACTOR_MODEL_FILES, ...WASTE_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const modelCache = new Map<string, Promise<GLTF>>();
const loadModel = (url: string) => { let m = modelCache.get(url); if (!m) modelCache.set(url, (m = loadStripped(url))); return m; };

type RealReactor = {layout: StationLayout; world: ReturnType<typeof buildWorld>; cm: ContainerManager; roots: THREE.Object3D[]};
const reactors = new Map<number, Promise<RealReactor>>();
function realReactor(seed: number): Promise<RealReactor> {
  let r = reactors.get(seed);
  if (!r) reactors.set(seed, (r = (async () => {
    const layout = LEVELS.reactor.generate('main', {levelSeed: seed});
    // the lazy working set as Game.modelKeysFor selects it on a Reactor layout (props + the arch / mines / bunker / waste kits)
    const keys = selectLevelKeys('reactor', [...new Set([...p7ModelKeysFor(layout), ...reactorModelKeysFor(layout as never), ...minesModelKeysFor(layout as never),
      ...bunkerModelKeysFor(layout), ...wasteModelKeysFor(layout as never)])], CATALOGUE).keys;
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
    const roots = [world.group, cm.group, stock.group];
    for (const o of roots) o.updateMatrixWorld(true);
    return {layout, world, cm, roots};
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
  const cx = (g.x0 + g.x1) / 2, cz = (g.z0 + g.z1) / 2, d = Math.hypot(core.x - cx, core.z - cz);
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
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, rr = (cf.ring.r0 + cf.ring.r1) / 2, x = cf.x + Math.cos(a) * rr, z = cf.z + Math.sin(a) * rr;
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR || g.blocked[g.idx(cx, cy)]) continue;
      out.push({name: 'core-ring', x, y: cf.y + EYE, z, yaw: k % 2 ? yawTo(x, z, cf.x, cf.z) : yawTo(x, z, cf.x, cf.z) + Math.PI, pitch: k % 4 === 1 ? 0.35 : -0.1});
      if (out.filter(p => p.name === 'core-ring').length >= 4) break;
    }
  }
  for (const c of r.complexes ?? []) {
    for (const rm of c.rooms.filter((_, i) => i % 3 === 0)) {
      const a = layout.areas[rm.area], lv = layout.levels[a.level ?? 0], g = lv.grid;
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
          if (im.isInstancedMesh) { if (!im.boundingSphere) im.computeBoundingSphere(); sph.copy(im.boundingSphere!); } else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sph.copy(m.geometry.boundingSphere!); }
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

/** Scene + flashlight-shadow draws at a pose (the loot display filled for this eye, the culler forced), and the torch. */
function measure(R: RealReactor, p: Pose): {scene: number; shadow: number; cam: THREE.PerspectiveCamera; torch: THREE.SpotLight} {
  const cam = eyeCam(p), torch = torchOn(cam);
  const {world, cm, roots} = R;
  world.culler.viewpoints = [torch];
  // the loot display as the game fills it for this eye (ContainerManager.target sets the eye; update refreshes the lots)
  (cm as unknown as {lastEye: THREE.Vector3}).lastEye.copy(cam.position);
  (cm as unknown as {dirty: boolean}).dirty = true;
  cm.update(0.2, 0);
  for (const o of roots) o.updateMatrixWorld(true);
  world.culler.update(cam, true);
  torch.shadow.camera.layers.mask = cam.layers.mask;
  return {scene: renderDraws(roots, cam), shadow: renderDraws(roots, torch.shadow.camera, true), cam, torch};
}

// ---------------------------------------------------------------------------------------------------------------------------

const SEEDS = [codeToSeed('000070S')!, 637474, 218558]; // (000070S = 9100: the lead's Reactor QA seed; reactor-level.test.ts's seeds)

describe('the REAL Reactor: render objects per representative pose (scene + flashlight shadow pass)', () => {
  it('census per seed / pose', async () => {
    for (const seed of SEEDS) {
      const R = await realReactor(seed);
      for (const p of keyPoses(R.layout)) {
        const m = measure(R, p);
        out(`seed ${seed} ${p.name} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} yaw ${p.yaw.toFixed(2)} pitch ${p.pitch.toFixed(2)}): scene ${m.scene} + shadow ${m.shadow} = ${m.scene + m.shadow}; culled ${R.world.culler.stats.culled}`);
        m.cam.remove(m.torch, m.torch.target);
      }
    }
    expect(true).toBe(true);
  }, 600_000);

  it('oracle: no mesh with visible pixels is culled (eye), poses across every tier / complex / the core ring', async () => {
    const R = await realReactor(SEEDS[0]);
    const all = new THREE.Group();
    let checked = 0, bad = 0;
    try {
      for (const o of R.roots) all.add(o);
      for (const p of oraclePoses(R.layout)) {
        const m = measure(R, p);
        const fromEye = visibleMeshes(all, m.cam, 256, 134, {minPx: 1});
        const hidden = [...fromEye].filter(([mesh]) => isCulled(mesh)).map(([mesh, n]) => `${p.name}: ${mesh.name} ${n}px`);
        out(`oracle ${p.name} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} yaw ${p.yaw.toFixed(2)} pitch ${p.pitch}): scene ${m.scene} + shadow ${m.shadow}, eye-visible ${fromEye.size}, visible-but-culled ${hidden.length} ${hidden.slice(0, 4).join(' ')}`);
        bad += hidden.length;
        checked++;
        m.cam.remove(m.torch, m.torch.target);
      }
    } finally {
      for (const o of [...all.children]) all.remove(o);
    }
    out(`oracle poses ${checked}, visible-but-culled ${bad}`);
    expect(checked).toBeGreaterThan(30);
  }, 900_000);
});
