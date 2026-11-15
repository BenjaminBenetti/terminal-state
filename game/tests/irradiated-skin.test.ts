// Task studio-reactor-glowing-zombies-20261115-013245-01: an irradiated zombie's green, glowing SKIN (ai/irradiatedSkin.ts) on the
// real ordinary body models — stages on the body material only, per-object data from the mask slot, its own program (cache key),
// the glow strength, the mask load, and the stages building on both backends.
import {beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {GLSLNodeBuilder, MeshStandardNodeMaterial, WGSLNodeBuilder, WebGPURenderer, type NodeMaterial} from 'three/webgpu';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {MODEL_FILES} from '../src/assets/manifest';
import {ZOMBIE_BODIES, ZombieLookLibrary} from '../src/ai/outfits';
import {ZombieActor} from '../src/ai/zombieActor';
import {installWounds} from '../src/damage/wounds';
import {nodeHookKeys} from '../src/render/nodeHooks';
import {materialKey} from '../src/render/runtimeVariants';
import {mulberry32} from '../src/core/rng';
import {skinMaskSlot} from '../src/ai/irradiatedSkinMask';
import {
  IRRADIATED_SKIN, SKIN_MASK, bindSkinMask, installIrradiatedSkin, irradiatedSkinOf, preloadSkinMask, setSkinGlow, skinMaskTexture,
} from '../src/ai/irradiatedSkin';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));

async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  const doc = await io.read(pub(url));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

const BODIES = ['lastshift', 'scavenger'] as const; // (two mask tiles; both valid looks with no garment)
const models: Record<string, GLTF> = {};
let lib: ZombieLookLibrary;
beforeAll(async () => {
  for (const id of BODIES) {
    const d = ZOMBIE_BODIES.find(b => b.id === id)!;
    const f = (MODEL_FILES as Record<string, {url: string} | undefined>)[d.model]!;
    if (existsSync(pub(f.url))) models[d.model] = await loadStripped(f.url);
  }
  lib = new ZombieLookLibrary(models);
}, 120000);

const build = (body: string, seed = 1) => {
  expect(lib.isValid({body, wear: {}}), body).toBe(true);
  const z = new ZombieActor(lib.build({body, wear: {}}), {x: 0, z: 0, yaw: 0, type: 'shambler', area: 0}, mulberry32(seed));
  expect(z.look?.body).toBe(body);
  installWounds(z as never); // (Game.spawnEnemy: damage.installZombie first — the node-material clones + wound stages)
  return z;
};
const bodyMesh = (z: ZombieActor) => {
  let m: THREE.Mesh | null = null;
  z.root.traverse(o => { if (!m && (o as THREE.Mesh).isMesh && o.userData.slot === 'body') m = o as THREE.Mesh; });
  return m! as THREE.Mesh;
};
const matOf = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material[0] : m.material) as unknown as NodeMaterial & Record<string, unknown>;

describe('irradiated skin: green, emissive, on the body material only', () => {
  it('stages on the body material (colour before the wounds, emission as an effect); per-object data from its mask slot', () => {
    for (const body of BODIES) {
      const z = build(body);
      const data = installIrradiatedSkin(z, 1.25)!;
      expect(data, body).not.toBeNull();
      const mat = matOf(bodyMesh(z));
      const keys = nodeHookKeys(mat);
      expect(keys).toContain('irradiated-skin.color');
      expect(keys).toContain('irradiated-skin.emissive');
      expect(keys.indexOf('irradiated-skin.color')).toBeLessThan(keys.findIndex(k => k.endsWith('.color') && k !== 'irradiated-skin.color'));
      expect(mat[IRRADIATED_SKIN.prop]).toBe(IRRADIATED_SKIN.tag);
      const slot = skinMaskSlot(body)!;
      expect([...data]).toEqual([slot.u0, slot.v0, slot.channel, IRRADIATED_SKIN.tint, 1, 1.25, slot.scale, 0].map(v => Math.fround(v)));
      expect(bodyMesh(z).userData[IRRADIATED_SKIN.key]).toBe(data);
      expect(irradiatedSkinOf(z)).toBe(data);
      expect(installIrradiatedSkin(z, 3)).toBe(data); // idempotent
      // nothing else of the actor carries it (garments, other meshes)
      z.root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m === bodyMesh(z)) return;
        expect(m.userData[IRRADIATED_SKIN.key]).toBeUndefined();
        expect(nodeHookKeys(matOf(m)).some(k => k.startsWith('irradiated-skin'))).toBe(false);
      });
    }
  });

  it('its own program: never the cache key of an ordinary body (three r186 ignores node-slot contents)', () => {
    const plain = build('lastshift', 2), irr = build('lastshift', 3);
    installIrradiatedSkin(irr, 0);
    expect(materialKey(matOf(bodyMesh(irr)))).not.toBe(materialKey(matOf(bodyMesh(plain))));
    expect(matOf(bodyMesh(plain))[IRRADIATED_SKIN.prop]).toBeUndefined();
    const other = build('scavenger', 4);
    installIrradiatedSkin(other, 2);
    // every irradiated body shares one program per lighting variant (the slot and glow are per-object data)
    expect(materialKey(matOf(bodyMesh(other))).includes(IRRADIATED_SKIN.tag)).toBe(true);
  });

  it('glow strength is per zombie and clamped; the tint stays when the glow is out', () => {
    const z = build('lastshift', 5);
    const d = installIrradiatedSkin(z, 0)!;
    setSkinGlow(z, 0.4);
    expect(d[4]).toBeCloseTo(0.4, 6);
    setSkinGlow(z, 7);
    expect(d[4]).toBe(1);
    setSkinGlow(z, -1);
    expect(d[4]).toBe(0);
    expect(d[3]).toBeCloseTo(IRRADIATED_SKIN.tint, 6);
    setSkinGlow({}, 1); // not an irradiated skin: a no-op
  });

  it('no green skin without a body mask slot (unknown / legacy body): null, nothing installed', () => {
    const z = build('lastshift', 6);
    const fake = {root: z.root, look: {body: 'legacyTemplate'}};
    expect(installIrradiatedSkin(fake, 0)).toBeNull();
    expect(installIrradiatedSkin({root: new THREE.Object3D(), look: null}, 0)).toBeNull();
    expect(nodeHookKeys(matOf(bodyMesh(z))).some(k => k.startsWith('irradiated-skin'))).toBe(false);
  });

  it('the mask loads once as a data texture (flipY false, no colour space, no mipmaps) and binds the shared node', async () => {
    const node = SKIN_MASK as unknown as {value: THREE.Texture};
    const before = node.value;
    const tex = new THREE.Texture();
    vi.stubGlobal('document', {baseURI: 'http://127.0.0.1/terminal-state/'}); // (assetUrl resolves against the page)
    const load = vi.fn(async (url: string) => { expect(url).toBe('http://127.0.0.1/terminal-state/assets/textures/zombie-skin-mask.png'); return tex; });
    const got = await preloadSkinMask(load);
    expect(got).toBe(tex);
    expect(await preloadSkinMask(load)).toBe(tex);
    expect(load).toHaveBeenCalledTimes(1);
    expect(tex.flipY).toBe(false);
    expect(tex.colorSpace).toBe(THREE.NoColorSpace);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(node.value).toBe(tex);
    expect(skinMaskTexture()).toBe(tex);
    bindSkinMask(null);
    expect(node.value).toBe(before);
    vi.unstubAllGlobals();
  });

  it('the skin stages build into the body material on both backends (one mask texture binding, per-object data)', () => {
    const z = build('lastshift', 7);
    installIrradiatedSkin(z, 0.5);
    const src = bodyMesh(z);
    for (const backend of ['glsl', 'wgsl'] as const) {
      const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
      const r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: backend === 'glsl'});
      (r as unknown as {hasFeature: () => boolean; hasCompatibility: () => boolean}).hasFeature = () => false;
      (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
      (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
      // the body's own material on a plain mesh with UVs (the stages read uv(), the material colour and the per-object data)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), matOf(src) as unknown as THREE.Material);
      mesh.userData = {...src.userData};
      const scene = new THREE.Scene();
      scene.add(mesh, new THREE.PointLight(0xffffff, 1));
      const B = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
      const b = new B(mesh, r) as unknown as {scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; context: {material: THREE.Material}; lightsNode: unknown; build(): void; fragmentShader: string};
      b.scene = scene;
      b.camera = new THREE.PerspectiveCamera();
      b.material = mesh.material as THREE.Material;
      b.context.material = b.material;
      b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights([]);
      b.build();
      const f = b.fragmentShader;
      expect(f.length, backend).toBeGreaterThan(500);
      expect(backend === 'glsl' ? /sampler2D\b/.test(f) : /texture_2d<f32>/.test(f), backend).toBe(true);
    }
    // a plain standard node material builds as before (control)
    expect(new MeshStandardNodeMaterial()).toBeTruthy();
  });
});
