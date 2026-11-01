// Task track3-eaton-centre-20261031 (lane PERF): the mall's GPU working-set budget, measured in Node on the REAL build path.
//
// The mall's start view (pit platform, every storey visible through the atrium) is what the title screen draws first. The
// primary's serial browser check (Firefox + Mesa llvmpipe: programs, textures and buffers all live in system RAM) tripped the
// fixed 6.0 GiB guard while loading it. Lane PERF measured (lanes/PERF.notes): ~1,500 render objects in that view, ~740 of
// them small InstancedMeshes — and three r186 gives EVERY such InstancedMesh its own vertex shader (a uniform block named by a
// global node id), so the view linked ~760 programs (+ up to ~700 in the flashlight shadow pass); the Office's start view ~70.
// Fixes pinned here:
//  - render/instancing.ts: attribute instancing (the path three uses above the uniform-block limit) — identical transform,
//    one shared program per material; ON for the mall only (Game.buildSection), the Subway / Office build as before;
//  - assets/textureRelease.ts: in the mall the lazy AND boot models release their decoded images (ImageBitmaps: ~450 + ~370 MB)
//    once uploaded; the three colour samplers read the exact thumbnails they would have drawn (pixel-identical results); uploads
//    are staged behind the loading screen in byte-bounded batches (no title-frame peak of every decoded image + its GPU copy);
//  - world/levelCulling.ts slab occlusion (mall only): a mesh behind a storey slab whose every ray from the eye crosses closed
//    structure is not drawn (start view 1,524 -> 1,076 objects); a depth-buffered oracle on 12 QA poses finds no visible mesh
//    it hides;
//  - budgets for the real mall (seed t3a, the primary's QA seed): programs in the start view, render objects, triangles,
//    geometry / canvas-texture bytes, materials, the lazy model working set (decoded texture bytes from the GLB headers).
//    A budget failure means the mall's working set grew: measure again (LL_MALL_BUDGET_OUT=/tmp/x.json writes the numbers) and
//    decide consciously before raising a cap.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {ShimCanvas, ShimContext, installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {compileNodeMaterial} from './helpers/nodeCompile';
import {attributeInstancing, setAttributeInstancing} from '../src/render/instancing';
import {RELEASE_THUMB, SAMPLE_SIZES, modelTextures, pendingUploads, releaseAfterUpload, releaseModelTexturesAfterUpload, sampleSource, stageUploads, textureReleaseStats, trackUploads} from '../src/assets/textureRelease';
import {LEVELS, arrivalPose} from '../src/levels/registry';
import {codeToSeed} from '../src/core/rng';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {ShelfStock} from '../src/world/shelfStock';
import {CULL_LAYER, fogCullDistance} from '../src/world/levelCulling';
import {mallQaPose} from '../src/gen/mall/qa';
import type {StationLayout} from '../src/gen/station';
import {visibleMeshes} from './helpers/visibleMeshes';
import {MALL_FOG} from '../src/world/mallAtmosphere';
import {p7ModelKeysFor, P7_FILES} from '../src/gen/props07';
import {officeModelKeysFor} from '../src/gen/office/index';
import {enemyModelKeysFor, ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {MODEL_FILES} from '../src/assets/manifest';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../src/assets/mallAssets';
import {lootProfile} from '../src/items/lootTables';
import {readTowerInfo} from '../src/world/towerShared';
import {buildElevatorView, planElevator} from '../src/world/elevator';
import {Inventory} from '../src/items/inventory';
import {ROOF, setMallVariantOverride} from '../src/gen/mall/frame';
import {registerMovingLift} from '../src/world/towerRuntime';
import {OCCL_TOP} from '../src/world/levelCulling';
import {markShadows} from '../src/render/volumetric';

installCanvasShim(false);
// the pickups' label atlas clips its cells (ShimContext has no clip(); structural run: a no-op, like every other draw here)
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

/**
 * The budget. Task mall-playtest-revision-20261031 (lane ARCH) RE-PINNED for the revised, smaller mall (station + 3 floors, ~24 shops):
 * measured on t3a at 08:50Z (lanes/ARCH.notes) while lanes SHOPS / GEN still densify the shops — caps leave ~45-60 % headroom for
 * that, far below the six-ring mall's (Track3 PERF: start view 1,076 objects / 3.46 M tris, level 5,468 / 13.9 M / 60 MB / 285).
 */
const MALL_BUDGET = {
  /** Distinct GPU programs (vertex + fragment pairs) the start view needs with attribute instancing (measured 25). */
  startViewPrograms: 60,
  /** Render objects / triangles in the start view after the culler (with slab occlusion) + frustum (measured 305 / 0.36 M;
   *  415 / 0.66 M with the atrium rule alone). */
  startViewObjects: 500, startViewTriangles: 0.9e6,
  /** Whole level: render objects (1,524), triangles (3.31 M), geometry bytes (37 MB), materials (253). */
  objects: 2400, triangles: 5.5e6, geometryMB: 60, materials: 340,
  /** Canvas / data textures referenced by the level's materials, with mips (98.6 MB). */
  canvasTextureMB: 130,
  /** Lazy model working set: models (81) and their decoded GPU texture bytes with mips (436 MB). */
  lazyModels: 115, lazyTextureMB: 640,
} as const;

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...ENEMY_MODEL_FILES, ...MALL_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const MB = 1048576;

/** Decoded GPU bytes (RGBA8, full mip chain) of a GLB's embedded images, from the PNG / JPEG headers. */
function glbTextureBytes(file: string): number {
  const b = readFileSync(file);
  const jlen = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + jlen)) as {images?: {bufferView?: number; mimeType?: string}[]; bufferViews: {byteOffset?: number; byteLength: number}[]};
  const bin = 20 + jlen + 8;
  let bytes = 0;
  for (const img of json.images ?? []) {
    if (img.bufferView === undefined) continue;
    const bv = json.bufferViews[img.bufferView], d = b.subarray(bin + (bv.byteOffset ?? 0), bin + (bv.byteOffset ?? 0) + bv.byteLength);
    let w = 0, h = 0;
    if (img.mimeType === 'image/png') { w = d.readUInt32BE(16); h = d.readUInt32BE(20); } else if (img.mimeType === 'image/jpeg') {
      for (let i = 2; i < d.length - 9;) {
        if (d[i] !== 0xff) { i++; continue; }
        const m = d[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = d.readUInt16BE(i + 5); w = d.readUInt16BE(i + 7); break; }
        i += 2 + d.readUInt16BE(i + 2);
      }
    }
    bytes += w * h * 4 * 4 / 3;
  }
  return bytes;
}

// ---------------------------------------------------------------------------------------------------------------------------

describe('attribute instancing (render/instancing.ts)', () => {
  it('three default: each small InstancedMesh has its own vertex program; ON: one shared program per material; skinned meshes unchanged', () => {
    const mat = new MeshStandardNodeMaterial({color: 0x808080});
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const inst = (n: number) => compileNodeMaterial(new THREE.InstancedMesh(geo, mat, n));
    const was = attributeInstancing();
    try {
      setAttributeInstancing(false);
      const a = inst(5), b = inst(5), big = inst(2000);
      expect(a.vertex).not.toBe(b.vertex); // the per-object uniform block (NodeBuffer_<node id>): a program per InstancedMesh
      expect(a.vertex).toMatch(/NodeBuffer_\d+/);
      expect(big.vertex).not.toMatch(/NodeBuffer_\d+/); // above the limit three streams attributes already
      setAttributeInstancing(true);
      const c = inst(5), d = inst(9), e = inst(2000);
      expect(c.vertex).toBe(d.vertex);
      expect(c.fragment).toBe(d.fragment);
      expect(c.vertex).not.toMatch(/NodeBuffer_\d+/);
      expect(c.vertex).toBe(big.vertex); // exactly three's own attribute path
      expect(e.vertex).toBe(big.vertex);
      // a plain mesh and a skinned mesh do not change with the switch
      const plain = (on: boolean) => { setAttributeInstancing(on); return compileNodeMaterial(new THREE.Mesh(geo, mat)); };
      expect(plain(true).vertex).toBe(plain(false).vertex);
      const skinned = (on: boolean) => {
        setAttributeInstancing(on);
        const g = new THREE.BoxGeometry(1, 1, 1);
        const n = g.attributes.position.count;
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
        const bones = [new THREE.Bone(), new THREE.Bone()];
        bones[0].add(bones[1]);
        const sm = new THREE.SkinnedMesh(g, mat);
        sm.add(bones[0]);
        sm.bind(new THREE.Skeleton(bones));
        return compileNodeMaterial(sm).vertex.replace(/\d+/g, '#'); // ids differ per build; the structure must not
      };
      expect(skinned(true)).toBe(skinned(false));
    } finally {
      setAttributeInstancing(was);
    }
  });

  // (task reactor-build-20261101: + the Reactor's open pit — every tier in view — exactly like the mall's atrium)
  it('the game turns it on for the mall and the Reactor only, before the world is built (Subway / Office keep three\'s default path)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    const i = src.indexOf('setAttributeInstancing(!!this.layout.mall || !!this.layout.reactor)'), w = src.indexOf('this.world = buildWorld(');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(w);
  });
});

describe('decoded model images released after upload in the mall (assets/textureRelease.ts)', () => {
  const bitmap = (w = 1024, h = 1024) => ({width: w, height: h, closed: false, close() { this.closed = true; }});
  const tick = () => new Promise(r => setTimeout(r, 1));

  it('releases a decoded image once uploaded, waits for every texture sharing it, keeps the texture\'s own hook', async () => {
    const s0 = {...textureReleaseStats};
    const bmA = bitmap(), a = new THREE.Texture(bmA as never);
    let own = 0;
    a.onUpdate = () => { own++; };
    // GLTFLoader clones a texture per sampler: clones share the source
    const bmB = bitmap(512, 512), b = new THREE.Texture(bmB as never), b2 = b.clone();
    expect(b2.source).toBe(b.source);
    expect(releaseAfterUpload([a, b, b2, a])).toBe(2); // two images
    a.onUpdate!(a); // three: upload done
    expect(own).toBe(1);
    expect((a.image as {width: number}).width).toBe(RELEASE_THUMB);
    a.onUpdate!(a);
    expect(own).toBe(2); // the texture's own hook keeps running
    b.onUpdate!(b);
    expect(b.image).toBe(bmB); // b2 has not been uploaded yet: the image stays
    b2.onUpdate!(b2);
    expect((b.image as {width: number}).width).toBe(RELEASE_THUMB);
    expect(bmA.closed || bmB.closed).toBe(false); // closed on the next task (a WebGPU copy has been captured by then)
    await tick();
    expect(bmA.closed && bmB.closed).toBe(true);
    expect(textureReleaseStats.released - s0.released).toBe(2);
    expect(textureReleaseStats.bytes - s0.bytes).toBe((1024 * 1024 + 512 * 512) * 4);
  });

  it('an image uploaded BEFORE the mall asked (boot models: the item icons at load) is released at once; trackers alone change nothing', async () => {
    const bm = bitmap(256, 256), t = new THREE.Texture(bm as never);
    expect(trackUploads([t])).toBe(1); // Game.load: a recorder only
    t.onUpdate!(t); // uploaded by the icon render
    expect(t.image).toBe(bm); // nothing released outside the mall
    expect(releaseAfterUpload([t])).toBe(1); // the mall's buildSection
    expect((t.image as {width: number}).width).toBe(RELEASE_THUMB);
    await tick();
    expect(bm.closed).toBe(true);
  });

  it('the colour samplers read the EXACT pixels they would have drawn from the original image (16 / 24 / 32 px)', async () => {
    const restore = installCanvasShim(true); // rasterizing shim: real pixels
    try {
      const src = Object.assign(document.createElement('canvas') as unknown as ShimCanvas, {close() { /* a decoded bitmap */ }});
      src.width = 64; src.height = 48;
      for (let i = 0; i < src.data.length; i += 4) { src.data[i] = (i * 7) % 251; src.data[i + 1] = (i * 13) % 241; src.data[i + 2] = (i * 3) % 199; src.data[i + 3] = 255; }
      const draw = (img: unknown, n: number) => { const c = document.createElement('canvas') as unknown as ShimCanvas; c.width = c.height = n; c.getContext().drawImage(img, 0, 0, n, n); return Array.from(c.data); };
      const before = SAMPLE_SIZES.map(n => draw(src, n));
      const t = new THREE.Texture(src as never);
      releaseAfterUpload([t]);
      t.onUpdate!(t);
      expect(t.image).not.toBe(src);
      SAMPLE_SIZES.forEach((n, k) => expect(draw(sampleSource(t.image, n), n)).toEqual(before[k]));
      expect(sampleSource(src, 24)).toBe(src); // an image never released passes through (Subway / Office: byte-identical)
      // every CPU reader of a model image draws through sampleSource at a size the release keeps
      const read = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');
      expect(read('world/meshSplit.ts')).toMatch(/drawImage\(sampleSource\(img, 24\), 0, 0, 24, 24\)/);
      expect(read('damage/wounds.ts')).toMatch(/drawImage\(sampleSource\(img, 16\), 0, 0, 16, 16\)/);
      expect(read('damage/sample.ts')).toMatch(/const SIZE = 32;[\s\S]*drawImage\(sampleSource\(img, SIZE\), 0, 0, SIZE, SIZE\)/);
      expect([...SAMPLE_SIZES]).toEqual([16, 24, 32]);
    } finally {
      restore();
    }
  });

  it('staged uploads: byte-bounded batches, each batch\'s bitmaps closed before the next batch uploads; only pending textures', async () => {
    const bms = [bitmap(512, 512), bitmap(512, 512), bitmap(512, 512)], ts = bms.map(b => new THREE.Texture(b as never));
    const done = new THREE.Texture(bitmap(64, 64) as never), other = new THREE.Texture(bitmap(64, 64) as never);
    releaseAfterUpload([...ts, done]);
    done.onUpdate!(done); // already uploaded: not staged again
    trackUploads([other]); // tracked but not hooked for release: never staged
    const closedAt: number[] = [];
    const n = await stageUploads(t => { closedAt.push(bms.filter(b => b.closed).length); t.onUpdate!(t); }, [...ts, done, other], {batchBytes: 512 * 512 * 4});
    expect(n).toBe(3);
    expect(closedAt).toEqual([0, 1, 2]); // the previous batch's image was closed before each upload
    expect(bms.every(b => b.closed)).toBe(true);
    expect(pendingUploads([...ts, done, other])).toEqual([]);
  });

  it('never hooks canvases / image elements / data textures; collects every texture of a model; idempotent', () => {
    const canvas = new THREE.CanvasTexture(document.createElement('canvas') as never);
    const element = new THREE.Texture({width: 64, height: 64} as never);
    const data = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    expect(releaseAfterUpload([canvas, element, data])).toBe(0);
    const map = new THREE.Texture(bitmap() as never), normal = new THREE.Texture(bitmap(256, 256) as never);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({map, normalMap: normal})));
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({map})));
    expect([...modelTextures({scene})].length).toBe(2);
    expect(releaseModelTexturesAfterUpload({scene})).toBe(2);
    expect(releaseModelTexturesAfterUpload({scene})).toBe(0);
  });

  it('game wiring: boot models tracked at load, lazy models after fetch, both released in the mall only, uploads staged before the warm-up mode check', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    const load = src.indexOf('async load('), icons = src.indexOf('await buildItemIcons(');
    const track = src.indexOf('for (const g of Object.values(m)) trackUploads(modelTextures(g));');
    expect(track).toBeGreaterThan(load);
    expect(track).toBeLessThan(icons); // before the icons upload the guns / items
    expect(src).toMatch(/await this\.propModels\.ensure\(lazyKeys, onProgress\);\s*for \(const k of lazyKeys\) \{ const g = this\.propModels\.get\(k\); if \(g\) trackUploads\(modelTextures\(g\)\); \}/);
    expect(src).toMatch(/if \(this\.layout\.mall\) \{\s*for \(const k of keep\) \{ const g = this\.propModels\.get\(k\); if \(g\) releaseModelTexturesAfterUpload\(g\); \}\s*for \(const g of Object\.values\(this\.assets\.models\)\) releaseModelTexturesAfterUpload\(g\);\s*\}/);
    const run = src.indexOf('private async runWarmup('), stage = src.indexOf('await this.stageLevelTextures(ui);', run), mode = src.indexOf('const mode = warmupMode(', run);
    expect(stage).toBeGreaterThan(run);
    expect(stage).toBeLessThan(mode); // runs with ?warmup=off too
    expect(src).toMatch(/private async stageLevelTextures\(ui: WarmupUi\): Promise<void> \{\s*if \(!this\.layout\?\.mall/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------

/** The real mall t3a built once through the game's build path (shared by the budget and the slab-occlusion oracle tests). */
type RealMall = {layout: StationLayout; world: ReturnType<typeof buildWorld>; cm: ContainerManager; stock: ShelfStock; roots: THREE.Object3D[]; keys: string[]; lazyTex: number};
const realByVariant = new Map<string, Promise<RealMall>>();
const modelCache = new Map<string, Promise<GLTF>>();
const loadModel = (url: string) => { let m = modelCache.get(url); if (!m) modelCache.set(url, (m = loadStripped(url))); return m; };
/**
 * Task mall-round2-20261031 (lane PERF): `variant` forces a mall variant (the primary's M05 matched views use t3a with
 * ?mallVariant=arcade-loop); default = the seed's own variant (the budget / slab-oracle tests below). Models are loaded once.
 */
function realMall(variant?: string): Promise<RealMall> {
  const key = variant ?? '';
  let r = realByVariant.get(key);
  if (!r) realByVariant.set(key, (r = (async () => {
    if (variant) setMallVariantOverride(variant);
    let layout: StationLayout;
    try { layout = LEVELS.mall.generate(LEVELS.mall.entry, {levelSeed: codeToSeed('t3a')!, startWeapon: 'pistol'}); } finally { if (variant) setMallVariantOverride(null); }
    // the lazy working set exactly as Game.modelKeysFor selects it
    const keys = selectLevelKeys('mall', [...new Set([...p7ModelKeysFor(layout), ...officeModelKeysFor(layout as never), ...enemyModelKeysFor(layout)])], CATALOGUE).keys;
    const lazyTex = keys.reduce((s, k) => s + glbTextureBytes(pub(CATALOGUE[k].url)), 0);
    const models: Record<string, GLTF> = {};
    for (const k of keys) { if (!k.startsWith('enemy_')) models[k] = await loadModel(CATALOGUE[k].url); }
    for (const k of ['light', 'sign', 'turnstile', 'bench', 'cabinetTall', 'cabinetLow', 'stall', 'vending', 'shelf', 'trashCan', 'crate', 'shopCounter', 'shopBackbar', 'shopCooler', 'shopDisplay', 'janitorCart', 'magazineRack', 'techDisplay'] as const) {
      models[k] ??= await loadModel((MODEL_FILES as Record<string, {url: string}>)[k].url);
    }
    const lb = new THREE.Box3().setFromObject(models.light.scene).getSize(new THREE.Vector3());
    const mats = new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
    const world = buildWorld(layout, mats, models);
    const cm = new ContainerManager(models, mats, () => new Inventory());
    cm.build(layout, models, lootProfile('mall'));
    const stock = new ShelfStock();
    stock.build(layout, {models, lotsOf: () => []});
    world.culler.register(cm.group);
    world.culler.register(stock.group);
    // (task mall-playtest-revision, lane ARCH U07: the shaft's landing doorways are real apertures now — the game's tower runtime
    // adds the glass elevator's view (landing doors shut, the cab at the bottom stop, the rig) and registers the landings with the
    // culler exactly so: towerRuntime.build. Without it this scene would look through an open hole into the shaft.)
    const lift = readTowerInfo(layout)?.elevator;
    if (lift) {
      const view = buildElevatorView(planElevator(lift), mats, {glass: true});
      view.setCab(lift.stops[0].y, 0);
      world.group.add(view.root);
      for (const g of view.landings) world.culler.register(g);
      // task mall-round2 (lane PERF): + the moving car / rig, as towerRuntime.build registers them in the mall
      registerMovingLift(world.culler, view, lift.stops.map(q => q.levelId));
    }
    world.culler.maxDistance = Math.min(fogCullDistance(MALL_FOG.density), MALL_FOG.far);
    return {layout, world, cm, stock, roots: [world.group, cm.group, stock.group], keys, lazyTex};
  })()));
  return r;
}

/** A game camera (fov 75, 960 x 540, the mall's far plane) at a pose's eye (floor + 1.62 m). */
function eyeCam(x: number, floorY: number, z: number, yaw: number, pitch: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 960 / 540, 0.05, MALL_FOG.far);
  cam.position.set(x, floorY + 1.62, z);
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** Render objects a camera would draw (level culler + three's per-object frustum test). */
function drawnBy(roots: readonly THREE.Object3D[], cam: THREE.PerspectiveCamera): THREE.Mesh[] {
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const sph = new THREE.Sphere(), out: THREE.Mesh[] = [];
  for (const r of roots) r.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return;
    if (!cam.layers.test(m.layers)) return;
    const im = m as THREE.InstancedMesh;
    if (im.isInstancedMesh) { im.computeBoundingSphere(); sph.copy(im.boundingSphere!); } else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sph.copy(m.geometry.boundingSphere!); }
    if (m.frustumCulled !== false && !fr.intersectsSphere(sph.applyMatrix4(m.matrixWorld))) return;
    out.push(m);
  });
  return out;
}
const trisOf = (l: readonly THREE.Mesh[]) => l.reduce((s, m) => { const g = m.geometry; return s + (g.index ? g.index.count : g.attributes.position.count) / 3 * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1); }, 0);

describe('the REAL mall (seed t3a, the primary\'s QA seed): GPU working-set budget', () => {
  it('start view programs / objects, level objects / triangles / bytes / materials, lazy model working set within budget', async () => {
    const {layout, world, roots, keys, lazyTex} = await realMall();

    // whole level
    const arrays = new Set<unknown>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    let objects = 0, triangles = 0, geometry = 0;
    const addArr = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null) => {
      if (!a) return;
      const arr = (a as THREE.InterleavedBufferAttribute).data ? (a as THREE.InterleavedBufferAttribute).data.array : (a as THREE.BufferAttribute).array;
      if (!arrays.has(arr)) { arrays.add(arr); geometry += (arr as ArrayBufferView).byteLength; }
    };
    const texOf = (v: unknown, seen: Set<unknown>, depth: number): void => {
      if (!v || typeof v !== 'object' || seen.has(v) || depth > 40) return;
      seen.add(v);
      if ((v as THREE.Texture).isTexture) { textures.add(v as THREE.Texture); return; }
      if (Array.isArray(v)) { for (const x of v) texOf(x, seen, depth + 1); return; }
      const o = v as Record<string, unknown>;
      if (o.isNode || o.isMaterial || o.isUniform) for (const k of Object.keys(o)) if (k !== 'parent') texOf(o[k], seen, depth + 1);
    };
    for (const r of roots) r.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      objects++;
      const g = m.geometry, im = o as THREE.InstancedMesh;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3 * (im.isInstancedMesh ? im.count : 1);
      for (const a of Object.values(g.attributes)) addArr(a as THREE.BufferAttribute);
      addArr(g.index);
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (!materials.has(mt)) { materials.add(mt); texOf(mt, new Set(), 0); }
    });
    let canvasTex = 0;
    for (const t of textures) {
      const img = t.image as {width?: number; height?: number; depth?: number; data?: ArrayBufferView} | null;
      if (!img) continue;
      const raw = img.data ? img.data.byteLength : (img.width ?? 0) * (img.height ?? 0) * 4;
      canvasTex += !img.data && t.generateMipmaps && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? raw * 4 / 3 : raw;
    }

    // the start view (the title screen's first frame): the level culler (+ the mall's slab occlusion) + the frustum, arrival pose
    const pose = arrivalPose(layout, {kind: 'start'} as never);
    const lv = pose.level ?? 0;
    const y0 = pose.y ?? (lv > 0 ? (layout.levels?.[lv - 1]?.grid ?? layout.grid) : layout.grid).floorAt(pose.x, pose.z);
    const cam = eyeCam(pose.x, y0, pose.z, pose.yaw, (pose as {pitch?: number}).pitch ?? 0);
    for (const r of roots) r.updateMatrixWorld(true);
    // (task mall-round2 lane PERF: the slab A/B and the instancing ratio below are measured as pinned — without the newer same- /
    // cross-storey occlusion, which then removes more on top: inViewOccl)
    world.culler.occlusion = false;
    world.culler.slabs = false;
    world.culler.update(cam, true);
    const noSlab = drawnBy(roots, cam);
    world.culler.slabs = true;
    world.culler.update(cam, true);
    const inView = drawnBy(roots, cam);
    const slabCulled = world.culler.slabCulled;
    world.culler.occlusion = true;
    world.culler.update(cam, true);
    const inViewOccl = drawnBy(roots, cam);
    const smallInstanced = inView.filter(m => (m as THREE.InstancedMesh).isInstancedMesh && (m as THREE.InstancedMesh).count * 64 <= 65536).length;
    // distinct programs with attribute instancing (as Game.buildSection sets it for the mall): one compile per material /
    // attribute-layout group (GLSL node builder = the WebGL 2 path), deduplicated by the generated code
    const groups = new Map<string, THREE.Mesh>();
    for (const m of inView) {
      const im = m as THREE.InstancedMesh, g = m.geometry;
      const layoutKey = Object.keys(g.attributes).sort().map(k => `${k}:${(g.attributes[k] as THREE.BufferAttribute).itemSize}`).join(',') + (g.index ? '|i' : '');
      const key = `${im.isInstancedMesh ? `inst${im.instanceColor ? 'c' : ''}` : 'mesh'}|${(Array.isArray(m.material) ? m.material : [m.material]).map(x => x.uuid).join('+')}|${layoutKey}`;
      if (!groups.has(key)) groups.set(key, m);
    }
    const was = attributeInstancing();
    const codes = new Set<string>();
    try {
      setAttributeInstancing(true);
      for (const m of groups.values()) {
        const im = m as THREE.InstancedMesh;
        const probe = im.isInstancedMesh ? new THREE.InstancedMesh(m.geometry, m.material, im.count) : new THREE.Mesh(m.geometry, m.material);
        if (im.isInstancedMesh && im.instanceColor) (probe as THREE.InstancedMesh).instanceColor = im.instanceColor;
        const c = compileNodeMaterial(probe);
        codes.add(`${c.vertex}\u0000${c.fragment}`);
      }
    } finally {
      setAttributeInstancing(was);
    }

    const report = {
      startView: {objects: inView.length, triangles: Math.round(trisOf(inView)), objectsNoSlab: noSlab.length, trianglesNoSlab: Math.round(trisOf(noSlab)), slabCulled, smallInstanced, programsDefault: smallInstanced + codes.size, programsAttribute: codes.size,
        objectsOcclusion: inViewOccl.length, trianglesOcclusion: Math.round(trisOf(inViewOccl)), occlusionCulled: world.culler.occlusionCulled},
      level: {objects, triangles: Math.round(triangles), geometryMB: +(geometry / MB).toFixed(1), materials: materials.size, canvasTextureMB: +(canvasTex / MB).toFixed(1)},
      lazy: {models: keys.length, textureMB: +(lazyTex / MB).toFixed(1)},
    };
    console.log(`[mall budget] ${JSON.stringify(report)}`);
    if (process.env.LL_MALL_BUDGET_OUT) writeFileSync(process.env.LL_MALL_BUDGET_OUT, JSON.stringify(report, null, 1)); // (vitest hides console output of passing tests)
    expect(codes.size).toBeLessThanOrEqual(MALL_BUDGET.startViewPrograms);
    // the fix: several times fewer programs than three's default here (six-ring mall: 768 -> 29; the smaller revised mall has fewer
    // small instanced meshes in its start view: measured 128 -> 25)
    expect(codes.size * 4).toBeLessThan(smallInstanced + codes.size);
    expect(inView.length).toBeLessThanOrEqual(MALL_BUDGET.startViewObjects);
    expect(trisOf(inView)).toBeLessThanOrEqual(MALL_BUDGET.startViewTriangles);
    // slab occlusion vs the atrium rule alone: the six-ring mall culled >= 20 % of the OBJECTS (measured -29 %); the compact revised
    // mall has far fewer storeys stacked over the start view, so the object count drops less (measured 364 -> 307, -16 %) while the
    // triangles still halve (657k -> 368k): pin both honestly.
    expect(inView.length).toBeLessThan(noSlab.length);
    expect(trisOf(inView)).toBeLessThan(trisOf(noSlab) * 0.7);
    // task mall-round2 (lane PERF): the occlusion only removes (world/levelCulling.ts OCCL_*; correctness: 'M05 matched views' below)
    expect(inViewOccl.length).toBeLessThanOrEqual(inView.length);
    expect(objects).toBeLessThanOrEqual(MALL_BUDGET.objects);
    expect(triangles).toBeLessThanOrEqual(MALL_BUDGET.triangles);
    expect(geometry / MB).toBeLessThanOrEqual(MALL_BUDGET.geometryMB);
    expect(materials.size).toBeLessThanOrEqual(MALL_BUDGET.materials);
    expect(canvasTex / MB).toBeLessThanOrEqual(MALL_BUDGET.canvasTextureMB);
    expect(keys.length).toBeLessThanOrEqual(MALL_BUDGET.lazyModels);
    expect(lazyTex / MB).toBeLessThanOrEqual(MALL_BUDGET.lazyTextureMB);
  }, 240_000);

  it('slab occlusion never hides a mesh with visible pixels (depth-buffered oracle) on QA poses across every storey', async () => {
    const {layout, world} = await realMall();
    // (+ task track3 lane ARCH: every ring edge and more escalators — the poses ARCH's former 20 m atrium margin missed slivers from)
    // (task mall-playtest-revision, lane ARCH: the revised storeys — station + floors 1..3 — and lane GEN's new poses: corridor wings,
    // wing ends; no bridges)
    const poses: [Parameters<typeof mallQaPose>[1], number?][] = [['platform-lookup'], ['court'], ['ring-edge', 1], ['ring-edge', 2], ['ring-edge', 3],
      ['shopfront', 1], ['shopfront', 3], ['escalator', 0], ['escalator', 1], ['escalator', 2], ['corridor', 1], ['corridor', 3], ['wing-end', 2], ['elevator'], ['washrooms', 1]];
    const culledLayer = new THREE.Layers();
    culledLayer.set(CULL_LAYER);
    const out: string[] = [];
    let slabTotal = 0, checked = 0;
    for (const [name, ring] of poses) {
      const p = mallQaPose(layout, name, ring);
      if (!p) continue;
      const cam = eyeCam(p.x, p.y, p.z, p.yaw, p.pitch);
      world.group.updateMatrixWorld(true);
      // baseline: the culler without slab occlusion (ARCH's atrium rule hides deep back of house from other storeys by design)
      world.culler.slabs = false;
      world.culler.update(cam, true);
      const before = new Set<THREE.Mesh>();
      world.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.layers.mask === culledLayer.mask) before.add(o as THREE.Mesh); });
      world.culler.slabs = true;
      world.culler.update(cam, true);
      slabTotal += world.culler.slabCulled;
      const seen = visibleMeshes(world.group, cam, 128, 72, {minPx: 1});
      const pre = [...seen.keys()].filter(m => before.has(m));
      const hidden = [...seen.keys()].filter(m => m.layers.mask === culledLayer.mask && !before.has(m));
      // task track3 (lane ARCH): with the full mall culler (atrium + slab occlusion) NO oracle-visible mesh is culled by any rule
      const hiddenAll = [...seen.keys()].filter(m => m.layers.mask === culledLayer.mask);
      const drawn = drawnBy([world.group], cam);
      out.push(`${name}${ring ?? ''}: drawn ${drawn.length} / ${(trisOf(drawn) / 1e6).toFixed(2)} M tris, slab-culled ${world.culler.slabCulled}, oracle-visible ${seen.size}, visible-but-culled ${hidden.length}${hidden.length ? ` (${hidden.slice(0, 5).map(m => m.name).join(', ')})` : ''}, any-rule ${hiddenAll.length}`);
      if (pre.length) out.push(`  (culled with slab occlusion OFF — the 20 m atrium margin alone: ${pre.map(m => `${m.name} ${seen.get(m)}px`).join(', ')})`);
      if (hiddenAll.length && process.env.LL_MALL_BUDGET_OUT) writeFileSync(process.env.LL_MALL_BUDGET_OUT.replace(/\.json$/, '') + '-hidden.json', JSON.stringify(hiddenAll.map(m => ({pose: `${name}${ring ?? ''}`, mesh: m.name, level: m.userData.level, levels: m.userData.levels, box: new THREE.Box3().setFromObject(m), eye: cam.position.toArray(), slabOff: before.has(m), visibleLevels: [...world.culler.stats.visibleLevels], atrium: world.culler.atriumStats})), null, 1));
      expect(hidden.map(m => `${name}${ring ?? ''}: ${m.name} (${seen.get(m)} px)`)).toEqual([]);
      expect(hiddenAll.map(m => `${name}${ring ?? ''}: ${m.name} (${seen.get(m)} px)`)).toEqual([]);
      checked++;
    }
    if (process.env.LL_MALL_BUDGET_OUT) writeFileSync(process.env.LL_MALL_BUDGET_OUT.replace(/\.json$/, '') + '-slabs.txt', out.join('\n'));
    expect(checked).toBeGreaterThanOrEqual(10);
    expect(slabTotal).toBeGreaterThan(0); // the rule actually culls on these poses
    world.culler.update(eyeCam(layout.mall!.start.x, 0, layout.mall!.start.z, 0, 0), true);
  }, 300_000);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Task mall-round2-20261031 (lane PERF, user M05: "when looking certain directions there can be FPS drop, caused by ~1,500 draw
// calls and the CPU spending a lot of time in the submit phase"). The primary's matched views (seed t3a, ?mallVariant=arcade-loop,
// the 7 QA poses; evidence/perf/baseline-*.json at 1366b95, llvmpipe WebGL2: 286–863 draws, CPU submit ~0.06–0.07 ms per draw) and
// lane PERF's census of the same views in Node (lanes/PERF.notes): only 8–47 % of the submitted meshes own a visible pixel; the bulk
// were holders / props / room dressing behind walls — on the eye's storey and on the storeys seen through the atrium — each drawn in
// the scene pass and again in the flashlight's shadow pass. Fixes: world/levelCulling.ts same- / cross-storey OCCLUSION (OCCL_*),
// and storey-split chunks for the mall's openable holders / legacy container bodies / purpose dressing (a batch spanning two storeys
// could never be culled). Estimates below mirror three r186's render lists (Renderer._projectObject / renderObject): one draw per
// visible mesh x material group in the frustum (transparent double-sided: two), the flashlight pass = castShadow meshes in its
// SpotLightShadow frustum on the camera's layers. Static world only (no enemies / viewmodel / loot display / post quads): Node
// estimates, not llvmpipe or native measurements.

/**
 * Matched-view budget (static world + the loot display filled for the eye, scene + flashlight shadow draws; lanes/PERF.notes).
 * Follow-up (primary, after the browser check): the glass lift's car / rig and the loot display's batches are culler-registered too.
 */
const M05_BUDGET = {
  /** Sum over the 7 matched views (measured 3,062; ~3,545 before the lift / loot registration; 3,479 + loot at 1366b95). */
  total: 3250,
  /** The worst matched view, ring-edge 2 (measured 728). */
  worst: 800,
  /** Draws the lift / loot registration removes over the 7 views (measured ~483: the loot display 538 -> 59). */
  followUp: 300,
} as const;

const M05_POSES: [string, Parameters<typeof mallQaPose>[1] | 'start', number?][] = [['start', 'start'], ['platform-lookup', 'platform-lookup'],
  ['escalator1', 'escalator', 1], ['ring-edge2', 'ring-edge', 2], ['court1', 'court'], ['corridor1', 'corridor', 1], ['shopfront1', 'shopfront', 1]];

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

describe('M05 matched views (t3a, arcade-loop forced): draws per pass and occlusion correctness', () => {
  it('scene + flashlight-shadow draw estimates within budget, below 1366b95, occlusion hides nothing the eye or the torch sees', async () => {
    const {layout, world, roots, cm} = await realMall('arcade-loop');
    expect(OCCL_TOP).toBeLessThan(ROOF.spring); // the top storey's occlusion range stays under the vault's glass
    // game.ts buildSection: the station structure / holders cast + receive, shelf stock casts
    markShadows(world.group, true, true);
    markShadows(roots[1], true, true);
    markShadows(roots[2], true, false);
    const all = new THREE.Group();
    const lines: string[] = [];
    let total = 0, worst = 0, totalOff = 0, prevTotal = 0;
    try {
      for (const r of roots) all.add(r);
      for (const [label, name, ring] of M05_POSES) {
        let p: {x: number; y: number; z: number; yaw: number; pitch: number} | null;
        if (name === 'start') {
          const a = arrivalPose(layout, {kind: 'start'} as never), lv = a.level ?? 0;
          p = {x: a.x, y: a.y ?? (lv > 0 ? layout.levels[lv].grid : layout.grid).floorAt(a.x, a.z), z: a.z, yaw: a.yaw, pitch: (a as {pitch?: number}).pitch ?? 0};
        } else p = mallQaPose(layout, name, ring);
        expect(p, label).toBeTruthy();
        const cam = eyeCam(p!.x, p!.y, p!.z, p!.yaw, p!.pitch);
        const fl = torchOn(cam);
        world.culler.viewpoints = [fl];
        // the loot display as the game fills it for this eye (ContainerManager.target sets the eye; update refreshes the lots)
        (cm as unknown as {lastEye: THREE.Vector3}).lastEye.copy(cam.position);
        cm.update(0.2, 0);
        const count = () => { world.culler.update(cam, true); fl.shadow.camera.layers.mask = cam.layers.mask; return [renderDraws(roots, cam), renderDraws(roots, fl.shadow.camera, true)]; };
        world.culler.occlusion = false;
        const [s0, h0] = count();
        world.culler.occlusion = true;
        const [s1, h1] = count();
        // correctness: no mesh the occlusion hides owns a pixel seen from the eye, nor from the flashlight (its shadow camera)
        const occluded = new Set(world.culler.entries.filter(e => e.occluded).map(e => e.obj));
        const fromEye = visibleMeshes(all, cam, 256, 144, {minPx: 1}), fromTorch = visibleMeshes(all, fl.shadow.camera as THREE.PerspectiveCamera, 160, 160, {minPx: 1});
        const bad = [...fromEye.keys()].filter(m => occluded.has(m)).map(m => `${label} eye: ${m.name} ${fromEye.get(m)}px`)
          .concat([...fromTorch.keys()].filter(m => occluded.has(m)).map(m => `${label} torch: ${m.name} ${fromTorch.get(m)}px`));
        expect(bad).toEqual([]);
        expect(s1 + h1, label).toBeLessThanOrEqual(s0 + h0); // the occlusion only ever removes work
        // follow-up accounting: the lift car / rig and the loot display before this task registered them (lift: frustum only; loot:
        // one unbounded batch per item type with a shown lot, drawn in both passes) vs now
        const liftMeshes: THREE.Mesh[] = [], lootMeshes: THREE.InstancedMesh[] = [];
        for (const r of roots) r.traverse(o => { if ((o as THREE.Mesh).isMesh && o.userData.dynamicBounds) (o.name.startsWith('loot-') ? lootMeshes : liftMeshes).push(o as THREE.InstancedMesh); });
        const liftNow = renderDraws(liftMeshes, cam) + renderDraws(liftMeshes, fl.shadow.camera, true), lootNow = renderDraws(lootMeshes, cam) + renderDraws(lootMeshes, fl.shadow.camera, true);
        const saved = liftMeshes.map(m => m.layers.mask);
        liftMeshes.forEach(m => { m.layers.mask = cam.layers.mask; });
        const liftBefore = renderDraws(liftMeshes, cam) + renderDraws(liftMeshes, fl.shadow.camera, true);
        liftMeshes.forEach((m, i) => { m.layers.mask = saved[i]; });
        const shownTypes = new Map<string, number>(); // item type -> draws of its old single batch (template parts x material groups)
        for (const im of lootMeshes) if (im.count > 0 && !shownTypes.has(im.name)) {
          const parts = lootMeshes.filter(q => q.name === im.name && q.userData.levels); // the all-storey batch: one per template part
          shownTypes.set(im.name, parts.reduce((n, q) => n + (Array.isArray(q.material) ? q.material.length : 1), 0));
        }
        const lootBefore = 2 * [...shownTypes.values()].reduce((a, b) => a + b, 0);
        const pre = s1 + h1 - liftNow - lootNow + liftBefore + lootBefore;
        lines.push(`${label}: occlusion off ${s0} + ${h0} = ${s0 + h0} | on ${s1} + ${h1} = ${s1 + h1} (occluded ${occluded.size}, eye-visible ${fromEye.size}) | lift ${liftBefore} -> ${liftNow}, loot ${lootBefore} -> ${lootNow}; before this follow-up ~${pre}`);
        total += s1 + h1; totalOff += s0 + h0; worst = Math.max(worst, s1 + h1);
        prevTotal += pre;
        if (label === 'corridor1') expect(s1 + h1).toBeLessThan((s0 + h0) * 0.75); // a corridor between shops: most holders sit behind walls
        cam.remove(fl, fl.target);
      }
    } finally {
      for (const r of [...all.children]) all.remove(r);
      world.culler.viewpoints = [];
      world.culler.occlusion = true;
    }
    console.log(`[mall M05] ${lines.join(' ; ')} ; total ${total} (occlusion off ${totalOff}, before the lift / loot registration ~${prevTotal}), worst ${worst}`);
    if (process.env.LL_MALL_BUDGET_OUT) writeFileSync(process.env.LL_MALL_BUDGET_OUT.replace(/\.json$/, '') + '-m05.txt', [...lines, `total ${total} (off ${totalOff}; before lift / loot registration ~${prevTotal}) worst ${worst}`].join('\n'));
    expect(prevTotal - total).toBeGreaterThan(M05_BUDGET.followUp); // registering the lift / loot batches only removes draws
    expect(total).toBeLessThanOrEqual(M05_BUDGET.total);
    expect(worst).toBeLessThanOrEqual(M05_BUDGET.worst);
  }, 300_000);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Task mall-round2-20261031 (lane ARCH, M09 for the M05 accounting): the LOCKED street exits' render cost on the same real mall
// (t3a, arcade-loop forced: lane GEN places two entrance-hall exits there). Per exit 4 meshes = 4 scene draws when its opening may
// be seen (frame, glass, street, fog cards; one shared material each = 4 programs for every exit, one shared 1024² canvas atlas)
// + the frame in the flashlight pass when lit; ~1.1–2.0 k triangles. The aperture gate (world/levelCulling.ts ExitAperture) keeps
// them out of every view that cannot see the opening (of the 7 matched views only corridor1 sees one: exit-1 down the corridor, 4 draws).
const EXIT_BUDGET = {
  /** Meshes (= scene draws) per exit (measured 4) and triangles per exit (measured 1,690–1,890 on t3a arcade-loop). */
  meshes: 4, triangles: 2400,
  /** Exit draws allowed in a matched view beyond `meshes` per exit the depth oracle sees there (measured 0; corridor1 sees exit-1). */
  matchedViewDraws: 0,
} as const;

describe('M09 street exits on the matched-view mall (t3a, arcade-loop): per-exit cost, culled from the matched views, drawn at the exit', () => {
  it('4 draws / <= 2.4 k tris per exit, shared materials + atlas; matched views draw an exit only when it is in sight; at the exit pose the oracle sees nothing culled', async () => {
    const {layout, world, roots} = await realMall('arcade-loop');
    markShadows(world.group, true, true); // game.ts buildSection: the station structure casts (the exit frame does: it is lit + opaque)
    const exits = layout.mall!.exits ?? [];
    expect(exits.length, 'lane GEN places exits on t3a arcade-loop').toBeGreaterThan(0);
    const exitMeshes: THREE.Mesh[] = [];
    world.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.name.startsWith('mall-exit-')) exitMeshes.push(o as THREE.Mesh); });
    const cost = world.mallArch!.stats.exitCost;
    expect(cost.length).toBe(exits.length);
    const mats = new Set(exitMeshes.map(m => m.material as THREE.Material));
    expect(mats.size).toBe(4); // every exit shares the four materials (four programs in total)
    const atlases = new Set<THREE.Texture>();
    for (const m of mats) { const t = (m as {map?: THREE.Texture | null}).map; if (t) atlases.add(t); }
    expect(atlases.size).toBeLessThanOrEqual(1);
    for (const c of cost) { expect(c.meshes, c.id).toBe(EXIT_BUDGET.meshes); expect(c.triangles, c.id).toBeLessThanOrEqual(EXIT_BUDGET.triangles); }
    const culledLayer = (1 << CULL_LAYER) >>> 0;
    const isCulled = (m: THREE.Object3D) => (m.layers.mask >>> 0) === culledLayer;
    const lines: string[] = [`exits ${exits.map(e => `${e.id} ${e.kind} ${e.side}`).join(', ')}; per exit ${cost.map(c => `${c.id}: ${c.meshes} meshes / ${c.triangles} tris`).join(', ')}`];
    // the 7 matched views (lane PERF's M05_POSES): no exit submitted (its opening is not in sight from any of them)
    for (const [label, name, ring] of M05_POSES) {
      let p: {x: number; y: number; z: number; yaw: number; pitch: number} | null;
      if (name === 'start') {
        const a = arrivalPose(layout, {kind: 'start'} as never), lv = a.level ?? 0;
        p = {x: a.x, y: a.y ?? (lv > 0 ? layout.levels[lv].grid : layout.grid).floorAt(a.x, a.z), z: a.z, yaw: a.yaw, pitch: (a as {pitch?: number}).pitch ?? 0};
      } else p = mallQaPose(layout, name, ring);
      if (!p) continue;
      const cam = eyeCam(p.x, p.y, p.z, p.yaw, p.pitch);
      world.culler.update(cam, true);
      const drawn = exitMeshes.filter(m => !isCulled(m));
      const seen = visibleMeshes(world.group, cam, 128, 72, {minPx: 1});
      lines.push(`${label}: exit meshes drawn ${drawn.length} (scene draws ${renderDraws(drawn, cam)}); oracle-visible ${exitMeshes.filter(m => seen.has(m)).map(m => `${m.name} ${seen.get(m)}px`).join(', ') || 'none'}`);
      // an exit is submitted only when it is really in sight (corridor1 looks down the corridor to exit-1's doors: 4 draws, by
      // design part of M05's count); never one the depth oracle sees culled
      const inSight = new Set(exitMeshes.filter(m => seen.has(m)).map(m => m.userData.streetExit as string));
      expect(renderDraws(drawn, cam), label).toBeLessThanOrEqual(EXIT_BUDGET.matchedViewDraws + EXIT_BUDGET.meshes * inSight.size);
      expect(drawn.every(m => inSight.has(m.userData.streetExit as string)), `${label}: an exit drawn out of sight`).toBe(true);
      expect(exitMeshes.filter(m => seen.has(m) && isCulled(m)).map(m => m.name), `${label}: exit visible but culled`).toEqual([]);
    }
    // at each exit's QA pose: its 4 meshes drawn = 4 scene draws (glass / fog cards single-sided: three would draw a transparent
    // double-sided material twice), the frame in the torch pass; the depth oracle finds nothing visible culled
    for (const [k, e] of exits.entries()) {
      const p = mallQaPose(layout, 'street-exit', k);
      expect(p, e.id).toBeTruthy();
      const cam = eyeCam(p!.x, p!.y, p!.z, p!.yaw, p!.pitch);
      const fl = torchOn(cam);
      world.culler.viewpoints = [fl];
      world.culler.update(cam, true);
      fl.shadow.camera.layers.mask = cam.layers.mask;
      const mine = exitMeshes.filter(m => m.userData.streetExit === e.id);
      expect(mine.every(m => !isCulled(m)), `${e.id} drawn at its pose`).toBe(true);
      const scene = renderDraws(mine, cam), torch = renderDraws(mine, fl.shadow.camera, true);
      const vis = visibleMeshes(world.group, cam, 128, 72, {minPx: 1});
      const bad = [...vis].filter(([m]) => isCulled(m)).map(([m, n]) => `${m.name} ${n}px`);
      lines.push(`street-exit ${k} (${e.id}): exit scene draws ${scene} (${mine.length} meshes), torch ${torch}; visible ${mine.filter(m => vis.has(m)).map(m => `${m.name.split('-').pop()} ${vis.get(m)}px`).join(', ')}; visible-but-culled ${bad.length}`);
      expect(bad, `${e.id}: visible but culled`).toEqual([]);
      expect(scene).toBeLessThanOrEqual(EXIT_BUDGET.meshes); // frame, street, glass, fog cards: one draw each
      expect(torch).toBeLessThanOrEqual(1); // only the frame casts (the street / fog / glass never: unlit or transparent)
      expect(mine.filter(m => m.castShadow).map(m => m.name.split('-').pop())).toEqual(['frame']);
      cam.remove(fl, fl.target);
      world.culler.viewpoints = [];
    }
    void roots;
    if (process.env.LL_MALL_BUDGET_OUT) writeFileSync(process.env.LL_MALL_BUDGET_OUT.replace(/\.json$/, '') + '-exits.txt', lines.join('\n'));
  }, 300_000);
});
