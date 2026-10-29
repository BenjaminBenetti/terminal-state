// Iteration 13 (FOG): compile node materials / output nodes to GLSL (WebGL2 backend) and WGSL (WebGPU backend) in Node, with
// no GPU: three r186's GLSLNodeBuilder / WGSLNodeBuilder run the real TSL setup / analyse / generate passes on an
// uninitialised WebGPURenderer (the builders only query a few capabilities, stubbed here at the backends' minimums).
import * as THREE from 'three';
import {GLSLNodeBuilder, NodeMaterial, QuadMesh, WGSLNodeBuilder, WebGPURenderer, type Node} from 'three/webgpu';

const canvas = () => ({getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1}) as unknown as HTMLCanvasElement;
let gl: WebGPURenderer | null = null, gpu: WebGPURenderer | null = null;

function stub(r: WebGPURenderer): WebGPURenderer {
  const b = r.backend as unknown as {capabilities?: unknown; hasFeature?: unknown; renderer?: unknown};
  b.capabilities ??= {getUniformBufferLimit: () => 16384};
  b.renderer ??= r; // WGSL texture sample data reads backend.renderer.currentSamples
  const rr = r as unknown as {hasFeature: (n: string) => boolean; hasCompatibility: (n: string) => boolean};
  rr.hasFeature = () => false; // no float32-filterable etc.: the strictest WebGPU baseline
  rr.hasCompatibility = () => true; // depth-texture compare (both backends support it)
  b.hasFeature ??= () => false;
  return r;
}

export function rendererFor(backend: 'glsl' | 'wgsl'): WebGPURenderer {
  if (backend === 'glsl') return (gl ??= stub(new WebGPURenderer({canvas: canvas(), forceWebGL: true})));
  return (gpu ??= stub(new WebGPURenderer({canvas: canvas()})));
}

export interface Compiled { vertex: string; fragment: string }

/** Build `material` on a fullscreen quad with the backend's node builder; throws on any TSL / codegen error. */
export function compileQuad(material: NodeMaterial, backend: 'glsl' | 'wgsl'): Compiled {
  const r = rendererFor(backend);
  const quad = new QuadMesh(material);
  const B = (backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder) as unknown as new (o: THREE.Object3D, r: WebGPURenderer) => {
    scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; build(): void; vertexShader?: string; fragmentShader?: string;
  };
  const b = new B(quad as unknown as THREE.Object3D, r);
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  b.material = material;
  b.build();
  return {vertex: b.vertexShader ?? '', fragment: b.fragmentShader ?? ''};
}

/** Compile an output node (e.g. a RenderPipeline's) as the fragment of a plain node material. */
export function compileOutputNode(node: Node, backend: 'glsl' | 'wgsl'): Compiled {
  const m = new NodeMaterial();
  m.fragmentNode = node;
  return compileQuad(m, backend);
}
