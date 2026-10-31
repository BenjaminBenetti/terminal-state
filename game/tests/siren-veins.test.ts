// Task track1-siren-blightbelly-20261031 (lane SIREN): the Siren vein material's TSL graph is BUILT by three r186's real node builder
// through WebGPURenderer's WebGL 2 backend (a Proxy GL context stands in for the GPU, as tests/core-tsl.test.ts) — a broken graph
// fails here, not only in a browser. One shared material serves every patch (per-patch data via objectData) and the hidden warm-up
// prototype builds the same program.
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {WebGPURenderer} from 'three/webgpu';

const ARRAY_PARAMS = new Set([0x0ba2, 0x0c10, 0x0c22, 0x0b73]);
function proxyGl(): WebGL2RenderingContext {
  return new Proxy({} as WebGL2RenderingContext, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return 0x1000 + (k.length * 7919 + k.charCodeAt(0) * 31 + k.charCodeAt(k.length - 1)) % 60000;
      if (k === 'getParameter') return (p: number) => (ARRAY_PARAMS.has(p) ? new Int32Array([0, 0, 300, 150]) : 16);
      if (k === 'getSupportedExtensions') return () => [];
      if (k === 'getExtension') return () => null;
      if (k === 'getContextAttributes') return () => ({antialias: true});
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return () => true;
      if (k === 'getShaderInfoLog' || k === 'getProgramInfoLog') return () => '';
      return () => ({});
    },
  });
}

let renderer: WebGPURenderer;
beforeAll(async () => {
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => setTimeout(() => f(performance.now()), 2));
  vi.stubGlobal('cancelAnimationFrame', (i: ReturnType<typeof setTimeout>) => clearTimeout(i));
  vi.stubGlobal('ImageBitmap', class {});
  const {WebGPURenderer} = await import('three/webgpu');
  const gl = proxyGl();
  const canvas = {width: 300, height: 150, style: {}, addEventListener() {}, removeEventListener() {}, getContext: (k: string) => (k === 'webgl2' ? gl : null)} as unknown as HTMLCanvasElement;
  renderer = new WebGPURenderer({canvas, forceWebGL: true});
  await renderer.init();
});
afterAll(() => { renderer?.dispose(); vi.unstubAllGlobals(); });

async function shaderOf(mesh: THREE.Mesh): Promise<{vertexShader: string; fragmentShader: string}> {
  const scene = new THREE.Scene();
  scene.add(mesh);
  const errors = vi.spyOn(console, 'error');
  const sh = await renderer.debug.getShaderAsync(scene, new THREE.PerspectiveCamera(), mesh);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
  return {vertexShader: sh.vertexShader ?? '', fragmentShader: sh.fragmentShader ?? ''};
}

describe('Siren vein material (TSL, WebGL 2 backend GLSL)', () => {
  it('builds: discard outside the veins, animated by the global time, transparent + polygon offset, no depth write', async () => {
    const {SirenVeinField, SIREN_VEINS, veinGeometry} = await import('../src/world/sirenVeins');
    const f = new SirenVeinField();
    const m = f.material;
    expect(m.isNodeMaterial).toBe(true);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.polygonOffset).toBe(true);
    expect(m.polygonOffsetFactor).toBeLessThan(0);
    const mesh = new THREE.Mesh(veinGeometry({level: 0, floor: 0, cells: [[0, 0], [1, 0], [0, 1]]}), m);
    mesh.userData.sirenVein = new Float32Array([0.5, 0.5, SIREN_VEINS.radius, 12.3, 1, 0, 0, 0]);
    const {fragmentShader: fs} = await shaderOf(mesh);
    expect(fs).toMatch(/discard/);
    expect(fs).toMatch(/sin\(/);
    expect(fs).toContain(String(SIREN_VEINS.glow));
    // the warm-up prototype: same material and attribute layout (one program for every patch)
    const proto = await shaderOf(f.prototype);
    expect(proto.fragmentShader).toBe(fs);
    f.dispose();
  });
});
