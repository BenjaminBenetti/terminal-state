// Iteration 13 (MAT-B): build an object's node material into REAL generated shader code in Node (no GPU), for BOTH
// backends of three r186's WebGPURenderer: WGSLNodeBuilder (WebGPU) and GLSLNodeBuilder (the WebGL 2 fallback). The
// renderers are constructed but never initialised (no adapter / context needed to set up, analyse and generate a TSL
// graph). Every three `error()` / `warn()` emitted while building is captured, so a test can require a clean build.
// (MAT-A's tests/helpers/nodeCompile.ts does the GLSL half for surface materials; this one adds WGSL, skinning and
// sprites / instancing for the effect + character materials.)
import * as THREE from 'three';
import {GLSLNodeBuilder, WGSLNodeBuilder, WebGPURenderer} from 'three/webgpu';

export type ShaderBackend = 'wgsl' | 'glsl';

const renderers: Partial<Record<ShaderBackend, WebGPURenderer>> = {};
function nodeRenderer(kind: ShaderBackend): WebGPURenderer {
  let r = renderers[kind];
  if (r) return r;
  const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
  r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: kind === 'glsl'});
  // uninitialised backend: the one capability the builders query (skinning / instancing: uniform buffer vs texture),
  // at the WebGL 2 / WebGPU minimum (16 KiB uniform blocks)
  const backend = r.backend as unknown as {capabilities?: {getUniformBufferLimit?: () => number}};
  backend.capabilities ??= {};
  backend.capabilities.getUniformBufferLimit = () => 16384;
  // optional device features (float32-filterable, clip distances ...): report none, the portable baseline
  (r as unknown as {hasFeature: () => boolean}).hasFeature = () => false;
  renderers[kind] = r;
  return r;
}

export interface BuiltShader {
  backend: ShaderBackend;
  vertex: string;
  fragment: string;
  /** three error() / warn() messages during the build (must be empty for a clean graph). */
  errors: string[];
}

/** Build `object`'s material (or `material`) as the given backend would, with `lights` in the scene. */
export function buildShaders(object: THREE.Object3D, backend: ShaderBackend, opts: {lights?: THREE.Light[]; material?: THREE.Material} = {}): BuiltShader {
  const r = nodeRenderer(backend);
  const scene = new THREE.Scene();
  const parent = object.parent;
  scene.add(object);
  for (const l of opts.lights ?? []) scene.add(l);
  const camera = new THREE.PerspectiveCamera(70, 1.5, 0.05, 100);
  scene.updateMatrixWorld(true);
  const errors: string[] = [];
  const oe = console.error, ow = console.warn;
  const grab = (...a: unknown[]) => { errors.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' ')); };
  console.error = grab;
  console.warn = grab;
  let b: {scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; build(): void; vertexShader?: string; fragmentShader?: string};
  try {
    b = (backend === 'glsl' ? new GLSLNodeBuilder(object, r) : new WGSLNodeBuilder(object, r)) as unknown as typeof b;
    b.scene = scene;
    b.camera = camera;
    if (opts.material) b.material = opts.material;
    const lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene, c: THREE.Camera): {setLights(l: THREE.Light[]): void}}}).lighting.getNode(scene, camera);
    lightsNode.setLights(opts.lights ?? []);
    (b as unknown as {lightsNode: unknown}).lightsNode = lightsNode;
    b.build();
  } finally {
    console.error = oe;
    console.warn = ow;
    scene.remove(object);
    if (parent) parent.add(object);
  }
  return {backend, vertex: b.vertexShader ?? '', fragment: b.fragmentShader ?? '', errors};
}

/** Both backends. */
export function buildBoth(object: THREE.Object3D, opts: {lights?: THREE.Light[]; material?: THREE.Material} = {}): BuiltShader[] {
  return (['wgsl', 'glsl'] as const).map(k => buildShaders(object, k, opts));
}
