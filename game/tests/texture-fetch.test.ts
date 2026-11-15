// Task studio-graphics-gpu-materials-toggle-20261114-212239-01: render/textureFetch.ts — lookups of data textures without three's
// uv-transform uniform.
//  1. the three r186 behaviour it works around (pinned on the real nodes): every `.load()` / `.sample()` of a uv-less base node is a
//     clone that transforms its coordinates by the texture's matrix again — also when the base itself was told not to;
//  2. the helpers: the same lookup (reference, coordinates, sampler) without that;
//  3. in the generated shaders (WGSL = WebGPU, GLSL = WebGL2): a mat3 uniform and a per-object update per lookup with three's own
//     calls, none with the helpers — and nothing else about the lookup changes;
//  4. the game's global nodes that use them hold textures whose matrix is the identity (the same texel either way), and no direct
//     lookup of them is left in the source.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLSLNodeBuilder, MeshBasicNodeMaterial, WGSLNodeBuilder, WebGPURenderer} from 'three/webgpu';
import {ivec2, texture, uv, vec4} from 'three/tsl';
import {fetchTexel, plainTexture, sampleAt} from '../src/render/textureFetch';
import {REFL} from '../src/world/reflectionNode';
import {DECAY_UNIFORMS} from '../src/world/decay';
import {FLARE_VIS} from '../src/world/flareLight';

interface TexNode { updateMatrix: boolean; sampler: boolean; uvNode: unknown; referenceNode: unknown; value: THREE.Texture; isTextureNode?: boolean; updateType: string;
  load(c: unknown): TexNode; sample(c: unknown): TexNode; rgb: {add(o: unknown): {add(o: unknown): unknown}} }
const data = (): THREE.DataTexture => Object.assign(new THREE.DataTexture(new Float32Array(16), 2, 2, THREE.RGBAFormat, THREE.FloatType), {needsUpdate: true});
const base = (): TexNode => texture(data()) as unknown as TexNode;

type Backend = 'glsl' | 'wgsl';
const renderers = new Map<Backend, WebGPURenderer>();
function headless(backend: Backend): WebGPURenderer {
  let r = renderers.get(backend);
  if (r) return r;
  const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
  r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: backend === 'glsl'});
  (r as unknown as {hasFeature: () => boolean}).hasFeature = () => false;
  (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
  (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
  renderers.set(backend, r);
  return r;
}
/** The fragment shader of a basic material whose colour is `color`, and the per-object texture updates its build asks for. */
function compile(backend: Backend, color: unknown): {frag: string; objectTextureUpdates: number} {
  const m = new MeshBasicNodeMaterial();
  (m as unknown as {colorNode: unknown}).colorNode = color;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
  const r = headless(backend);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const errors: string[] = [];
  const oe = console.error, ow = console.warn;
  console.error = console.warn = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  try {
    const B = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
    const b = new B(mesh, r) as unknown as {scene: THREE.Scene; camera: THREE.Camera; lightsNode: unknown; build(): void; fragmentShader: string; updateNodes: TexNode[]};
    b.scene = scene;
    b.camera = new THREE.PerspectiveCamera();
    b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights([]);
    b.build();
    expect(errors, `${backend}: a clean build`).toEqual([]);
    return {frag: b.fragmentShader, objectTextureUpdates: b.updateNodes.filter(n => n.isTextureNode === true && n.updateType === 'object').length};
  } finally {
    console.error = oe; console.warn = ow;
  }
}
const mat3s = (backend: Backend, frag: string): number => (frag.match(backend === 'wgsl' ? /:\s*mat3x3<f32>/g : /^\s*(?:uniform\s+)?mat3\s+\w+;/gm) ?? []).length;
const lookups = (backend: Backend, frag: string): number => (frag.match(backend === 'wgsl' ? /textureLoad\(|textureSample\w*\(/g : /texelFetch\(|texture\(|textureLod\(/g) ?? []).length;

describe('three r186: a lookup of a uv-less texture node transforms its coordinates again', () => {
  it('the base node and every .load() / .sample() clone of it have updateMatrix on — also clones of a base that was switched off', () => {
    const b = base();
    expect(b.uvNode).toBeNull();
    expect(b.updateMatrix).toBe(true); // (right for a material map with its own uv set: the default uv is transformed by the map's matrix)
    expect(b.load(ivec2(0, 0)).updateMatrix).toBe(true);
    expect(b.sample(uv()).updateMatrix).toBe(true);
    // switching the base off does not reach its clones: the clone is constructed before it gets its coordinates
    plainTexture(b);
    expect(b.updateMatrix).toBe(false);
    expect(b.load(ivec2(0, 0)).updateMatrix).toBe(true);
    expect(b.sample(uv()).updateMatrix).toBe(true);
    // a clone of a node that HAS coordinates is not affected (why `.sample(x).level(0)` chains need nothing)
    expect(b.sample(uv()).sample(uv()).updateMatrix).toBe(false);
    // the lines this follows from
    const three = readFileSync(new URL('../../node_modules/three/build/three.webgpu.js', import.meta.url), 'utf8');
    expect(three).toMatch(/this\.setUpdateMatrix\( uvNode === null \);/);
    expect(three).toMatch(/const newNode = new this\.constructor\( this\.value, this\.uvNode, this\.levelNode, this\.biasNode \);/);
    expect(three).toMatch(/if \( this\.updateMatrix === true \) \{\s+uvNode = this\.getTransformedUV\( uvNode \);/);
  });
});

describe('fetchTexel / sampleAt / plainTexture', () => {
  it('the same lookup as three\'s own call — reference, coordinates, sampler — without the matrix', () => {
    const b = base(), at = ivec2(1, 0), st = uv();
    expect(plainTexture(b)).toBe(b);
    const f = fetchTexel(b, at), own = b.load(at);
    expect([f.referenceNode, f.sampler, f.value]).toEqual([b, false, b.value]);
    expect(f.uvNode).toBe(own.uvNode);
    expect(f.updateMatrix).toBe(false);
    const s = sampleAt(b, st), ownS = b.sample(st);
    expect([s.referenceNode, s.sampler, s.value]).toEqual([b, true, b.value]);
    expect(s.uvNode).toBe(ownS.uvNode);
    expect(s.updateMatrix).toBe(false);
    // a swapped texture (a station's own) reaches the lookups through the base, as before
    const next = data();
    b.value = next;
    expect([f.value, s.value]).toEqual([next, next]);
  });

  for (const backend of ['wgsl', 'glsl'] as const) {
    it(`${backend}: three's own calls add a mat3 uniform per lookup (+ per-object updates); the helpers add none; the lookups themselves stay`, () => {
      const colour = (pick: (b: TexNode, k: number) => TexNode): unknown => {
        const b = base();
        return vec4(pick(b, 0).rgb.add(pick(b, 1).rgb).add(pick(b, 2).rgb) as never, 1);
      };
      const own = compile(backend, colour((b, k) => k === 2 ? b.sample(uv()) : b.load(ivec2(k, 0))));
      const ours = compile(backend, colour((b, k) => { if (k === 0) plainTexture(b); return k === 2 ? sampleAt(b, uv()) : fetchTexel(b, ivec2(k, 0)); }));
      expect(mat3s(backend, own.frag)).toBe(3);
      expect(mat3s(backend, ours.frag)).toBe(0);
      expect(lookups(backend, ours.frag)).toBe(3);
      expect(lookups(backend, own.frag)).toBe(3);
      if (backend === 'wgsl') {
        // (three clones + the base they refer to; WebGL2 keeps one per lookup for its flip-Y uniform, with or without the matrix)
        expect(own.objectTextureUpdates).toBe(4);
        expect(ours.objectTextureUpdates).toBe(0);
      } else expect(ours.objectTextureUpdates).toBeLessThanOrEqual(own.objectTextureUpdates);
    });
  }
});

describe('the game\'s nodes that use them', () => {
  it('hold untransformed textures (identity matrix: the same texel with or without it) and are switched off themselves', () => {
    const nodes = {reflAtlas: REFL.atlas, reflMeta: REFL.meta, decayMap: DECAY_UNIFORMS.uDecayMap, decayTex: DECAY_UNIFORMS.uDecayTex, flareVis: FLARE_VIS} as unknown as Record<string, TexNode>;
    const identity = new THREE.Matrix3();
    for (const [name, node] of Object.entries(nodes)) {
      expect(node.updateMatrix, name).toBe(false);
      const t = node.value;
      t.updateMatrix();
      expect(t.matrix.equals(identity), `${name}: identity uv transform`).toBe(true);
    }
  });

  it('no direct .load() / .sample() of the probe table or the decay textures is left (each would bring the matrix back)', () => {
    const refl = readFileSync(new URL('../src/world/reflectionNode.ts', import.meta.url), 'utf8');
    expect(refl).not.toMatch(/REFL\.meta\)?\.(load|sample)\(/);
    expect(refl.match(/fetchTexel\(REFL\.meta,/g)).toHaveLength(3);
    // the atlas is sampled through `.sample(x).level(0)`: the node that is built is the second clone (it has coordinates)
    expect(refl).toMatch(/n\(REFL\.atlas\)\.sample\([^\n]+\)\.level\(0\)/);
    const decay = readFileSync(new URL('../src/world/decay.ts', import.meta.url), 'utf8');
    expect(decay).not.toMatch(/(uDecayMap|uDecayTex|\btex)\.sample\(/);
    expect(decay.match(/sampleAt\(/g)!.length).toBeGreaterThanOrEqual(5);
  });
});
