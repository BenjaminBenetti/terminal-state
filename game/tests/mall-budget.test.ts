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
//  - assets/textureRelease.ts: the mall's lazy models release their decoded images (ImageBitmaps, ~450 MB) once uploaded,
//    keeping a 32² colour thumbnail for the colour samplers; boot models / other levels untouched;
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
import {ShimContext, installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {compileNodeMaterial} from './helpers/nodeCompile';
import {attributeInstancing, setAttributeInstancing} from '../src/render/instancing';
import {RELEASE_THUMB, modelTextures, releaseAfterUpload, releaseModelTexturesAfterUpload, textureReleaseStats} from '../src/assets/textureRelease';
import {LEVELS, arrivalPose} from '../src/levels/registry';
import {codeToSeed} from '../src/core/rng';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {ShelfStock} from '../src/world/shelfStock';
import {fogCullDistance} from '../src/world/levelCulling';
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
import {Inventory} from '../src/items/inventory';

installCanvasShim(false);
// the pickups' label atlas clips its cells (ShimContext has no clip(); structural run: a no-op, like every other draw here)
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

/** The budget (measured values in lanes/PERF.done; caps leave ~25-30 % headroom). */
const MALL_BUDGET = {
  /** Distinct GPU programs (vertex + fragment pairs) the start view needs with attribute instancing (measured 29). */
  startViewPrograms: 60,
  /** Render objects (meshes + instanced meshes) in the start view after the culler + frustum (measured 1,527). */
  startViewObjects: 2000,
  /** Whole level: render objects (5,468), triangles (13.9 M), geometry bytes (60 MB), materials (285). */
  objects: 7000, triangles: 18e6, geometryMB: 80, materials: 380,
  /** Canvas / data textures referenced by the level's materials, with mips (104 MB). */
  canvasTextureMB: 135,
  /** Lazy model working set: models (104) and their decoded GPU texture bytes with mips (595 MB). */
  lazyModels: 130, lazyTextureMB: 760,
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

  it('the game turns it on for the mall only, before the world is built (Subway / Office keep three\'s default path)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    const i = src.indexOf('setAttributeInstancing(!!this.layout.mall)'), w = src.indexOf('this.world = buildWorld(');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(w);
    expect(src).toMatch(/if \(this\.layout\.mall\) for \(const k of keep\) \{ const g = this\.propModels\.get\(k\); if \(g\) releaseModelTexturesAfterUpload\(g\); \}/);
  });
});

describe('mall lazy-model decoded images (assets/textureRelease.ts)', () => {
  const bitmap = (w = 1024, h = 1024) => ({width: w, height: h, closed: false, close() { this.closed = true; }});
  const tick = () => new Promise(r => setTimeout(r, 1));

  it('releases a decoded image once uploaded, waits for every texture sharing it, keeps a colour thumbnail and the texture\'s own hook', async () => {
    const s0 = {...textureReleaseStats};
    const bmA = bitmap(), a = new THREE.Texture(bmA as never);
    let own = 0;
    a.onUpdate = () => { own++; };
    // GLTFLoader clones a texture per sampler: clones share the source
    const bmB = bitmap(512, 512), b = new THREE.Texture(bmB as never), b2 = b.clone();
    expect(b2.source).toBe(b.source);
    expect(releaseAfterUpload([a, b, b2, a])).toBe(3);
    a.onUpdate!(a); // three: upload done
    expect(own).toBe(1);
    expect((a.image as {width: number}).width).toBe(RELEASE_THUMB);
    expect(a.onUpdate).not.toBeNull(); // the texture's own hook is back
    a.onUpdate!(a);
    expect(own).toBe(2);
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

  it('never hooks canvases / image elements / data textures; collects every texture of a model', () => {
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
    expect(releaseModelTexturesAfterUpload({scene})).toBe(0); // idempotent
  });
});

// ---------------------------------------------------------------------------------------------------------------------------

describe('the REAL mall (seed t3a, the primary\'s QA seed): GPU working-set budget', () => {
  it('start view programs / objects, level objects / triangles / bytes / materials, lazy model working set within budget', async () => {
    const layout = LEVELS.mall.generate(LEVELS.mall.entry, {levelSeed: codeToSeed('t3a')!, startWeapon: 'pistol'});
    // the lazy working set exactly as Game.modelKeysFor selects it
    const keys = selectLevelKeys('mall', [...new Set([...p7ModelKeysFor(layout), ...officeModelKeysFor(layout as never), ...enemyModelKeysFor(layout)])], CATALOGUE).keys;
    const lazyTex = keys.reduce((s, k) => s + glbTextureBytes(pub(CATALOGUE[k].url)), 0);
    const models: Record<string, GLTF> = {};
    for (const k of keys) { if (!k.startsWith('enemy_')) models[k] = await loadStripped(CATALOGUE[k].url); }
    for (const k of ['light', 'sign', 'turnstile', 'bench', 'cabinetTall', 'cabinetLow', 'stall', 'vending', 'shelf', 'trashCan', 'crate', 'shopCounter', 'shopBackbar', 'shopCooler', 'shopDisplay', 'janitorCart', 'magazineRack', 'techDisplay'] as const) {
      models[k] ??= await loadStripped((MODEL_FILES as Record<string, {url: string}>)[k].url);
    }
    const lb = new THREE.Box3().setFromObject(models.light.scene).getSize(new THREE.Vector3());
    const mats = new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
    const world = buildWorld(layout, mats, models);
    const cm = new ContainerManager(models, mats, () => new Inventory());
    cm.build(layout, models, lootProfile('mall'));
    const stock = new ShelfStock();
    stock.build(layout, {models, lotsOf: () => []});
    const roots = [world.group, cm.group, stock.group];

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

    // the start view (the title screen's first frame): the level culler + the frustum from the arrival pose
    const pose = arrivalPose(layout, {kind: 'start'} as never);
    const lv = pose.level ?? 0;
    const y0 = pose.y ?? (lv > 0 ? (layout.levels?.[lv - 1]?.grid ?? layout.grid) : layout.grid).floorAt(pose.x, pose.z);
    const cam = new THREE.PerspectiveCamera(75, 960 / 540, 0.05, MALL_FOG.far);
    cam.position.set(pose.x, y0 + 1.62, pose.z);
    cam.rotation.set((pose as {pitch?: number}).pitch ?? 0, pose.yaw, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    world.culler.register(cm.group);
    world.culler.register(stock.group);
    world.culler.maxDistance = Math.min(fogCullDistance(MALL_FOG.density), MALL_FOG.far);
    for (const r of roots) r.updateMatrixWorld(true);
    world.culler.update(cam, true);
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const sph = new THREE.Sphere();
    const inView: THREE.Mesh[] = [];
    for (const r of roots) r.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return;
      if (!cam.layers.test(m.layers)) return;
      const im = m as THREE.InstancedMesh;
      if (im.isInstancedMesh) { im.computeBoundingSphere(); sph.copy(im.boundingSphere!); } else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sph.copy(m.geometry.boundingSphere!); }
      if (m.frustumCulled !== false && !fr.intersectsSphere(sph.applyMatrix4(m.matrixWorld))) return;
      inView.push(m);
    });
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
      startView: {objects: inView.length, smallInstanced, programsDefault: smallInstanced + codes.size, programsAttribute: codes.size},
      level: {objects, triangles: Math.round(triangles), geometryMB: +(geometry / MB).toFixed(1), materials: materials.size, canvasTextureMB: +(canvasTex / MB).toFixed(1)},
      lazy: {models: keys.length, textureMB: +(lazyTex / MB).toFixed(1)},
    };
    console.log(`[mall budget] ${JSON.stringify(report)}`);
    if (process.env.LL_MALL_BUDGET_OUT) writeFileSync(process.env.LL_MALL_BUDGET_OUT, JSON.stringify(report, null, 1)); // (vitest hides console output of passing tests)
    expect(codes.size).toBeLessThanOrEqual(MALL_BUDGET.startViewPrograms);
    expect(codes.size * 10).toBeLessThan(smallInstanced + codes.size); // the fix: >= 10x fewer programs than three's default here
    expect(inView.length).toBeLessThanOrEqual(MALL_BUDGET.startViewObjects);
    expect(objects).toBeLessThanOrEqual(MALL_BUDGET.objects);
    expect(triangles).toBeLessThanOrEqual(MALL_BUDGET.triangles);
    expect(geometry / MB).toBeLessThanOrEqual(MALL_BUDGET.geometryMB);
    expect(materials.size).toBeLessThanOrEqual(MALL_BUDGET.materials);
    expect(canvasTex / MB).toBeLessThanOrEqual(MALL_BUDGET.canvasTextureMB);
    expect(keys.length).toBeLessThanOrEqual(MALL_BUDGET.lazyModels);
    expect(lazyTex / MB).toBeLessThanOrEqual(MALL_BUDGET.lazyTextureMB);
  }, 240_000);
});
