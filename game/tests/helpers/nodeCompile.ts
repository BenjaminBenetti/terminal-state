// Iteration 13 (MAT-A): compile a node material to shader code in Node (no GPU). three r186's GLSLNodeBuilder (the
// WebGL2-backend code path of WebGPURenderer) runs on an uninitialised WebGPURenderer: the TSL graph is set up, analysed
// and generated exactly as in the browser, so tests can inspect the real generated GLSL (varyings, functions, uniforms,
// the order of hook stages) without a WebGL / WebGPU context.
import * as THREE from 'three';
import {GLSLNodeBuilder, WebGPURenderer} from 'three/webgpu';

let renderer: WebGPURenderer | null = null;
function nodeRenderer(): WebGPURenderer {
  if (renderer) return renderer;
  const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
  renderer = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: true});
  // Uninitialised backend: the one capability the builder queries (instancing: uniform vs attribute matrices), at the
  // WebGL2 minimum (16 KiB uniform blocks).
  const backend = renderer.backend as unknown as {capabilities: unknown};
  backend.capabilities ??= {getUniformBufferLimit: () => 16384};
  return renderer;
}

export interface CompiledShader { vertex: string; fragment: string; fragmentMain: string }

/** Build `mesh`'s (node) material for `mesh` with the GLSL backend builder; `lights` adds scene lights. */
export function compileNodeMaterial(mesh: THREE.Mesh, lights: THREE.Light[] = []): CompiledShader {
  const r = nodeRenderer();
  const scene = new THREE.Scene();
  scene.add(mesh);
  for (const l of lights) scene.add(l);
  const camera = new THREE.PerspectiveCamera();
  // three's .d.ts omits the builder's runtime fields (scene / camera / build / generated code)
  const B = GLSLNodeBuilder as unknown as new (o: THREE.Object3D, r: WebGPURenderer) => {
    scene: THREE.Scene; camera: THREE.Camera; build(): void; vertexShader?: string; fragmentShader?: string;
  };
  const b = new B(mesh, r);
  b.scene = scene;
  b.camera = camera;
  const lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene, c: THREE.Camera): {setLights(l: THREE.Light[]): void}}}).lighting.getNode(scene, camera);
  lightsNode.setLights(lights);
  (b as unknown as {lightsNode: unknown}).lightsNode = lightsNode;
  b.build();
  scene.remove(mesh);
  const fragment = b.fragmentShader ?? '';
  const i = fragment.indexOf('void main()');
  return {vertex: b.vertexShader ?? '', fragment, fragmentMain: i >= 0 ? fragment.slice(i) : fragment};
}

/** Compile `material` on a unit box (instanced when `instanced`). */
export function compileOnBox(material: THREE.Material, instanced = false): CompiledShader {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const mesh = instanced ? new THREE.InstancedMesh(g, material, 2) : new THREE.Mesh(g, material);
  return compileNodeMaterial(mesh);
}
