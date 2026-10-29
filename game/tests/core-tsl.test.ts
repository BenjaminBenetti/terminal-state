// Iteration 13 (CORE): the CORE TSL node graphs (rifle optic lens, viewmodel overlay composite) are BUILT by three r186's
// real node builder through WebGPURenderer's WebGL 2 backend (a Proxy GL context stands in for the GPU), so a broken graph
// fails here, not only in a browser. (The WebGPU backend compiles the same graphs to WGSL; that path is browser-only.)
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {WebGPURenderer} from 'three/webgpu';

vi.mock('../src/world/canvasTextures', () => ({canvasTexture: () => new THREE.Texture()}));

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

async function fragmentOf(material: THREE.Material): Promise<string> {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const errors = vi.spyOn(console, 'error');
  const sh = await renderer.debug.getShaderAsync(scene, new THREE.PerspectiveCamera(), mesh);
  expect(errors).not.toHaveBeenCalled(); // no "Material ... is not compatible" / node build errors
  errors.mockRestore();
  return sh.fragmentShader ?? '';
}

describe('CORE TSL graphs build (WebGL 2 backend GLSL)', () => {
  it('rifle optic lens: reticle bands, dot glow, coating sheen and un-premultiplied output', async () => {
    const {createOpticLensMaterial, OPTIC_LOOK} = await import('../src/weapons/optic');
    const m = createOpticLensMaterial();
    expect(m.isNodeMaterial).toBe(true);
    const fs = await fragmentOf(m);
    expect(fs).toMatch(/fwidth/);
    for (const v of [OPTIC_LOOK.thinHalf, OPTIC_LOOK.thickHalf, OPTIC_LOOK.gap, OPTIC_LOOK.post, OPTIC_LOOK.dotRadius]) expect(fs, String(v)).toContain(String(v));
    expect(fs).toContain(String(-2 * OPTIC_LOOK.glowRadius * OPTIC_LOOK.glowRadius)); // dot glow falloff
    expect(fs).toContain('-10.24'); // coating sheen
    expect(fs).toMatch(/max\( [^,]+\.w, 0\.0001 \)/); // acc.rgb / max(acc.a, 1e-4)
    // uniforms stay live: the reticle frame Vector3 IS the shader uniform's value
    const dir = m.uniforms.uDir.value;
    dir.set(0, 0, -1);
    expect((m.uniforms.uDir as unknown as {isNode?: boolean}).isNode).toBe(true);
  });

  it('viewmodel overlay composite: ACES at the renderer exposure + sRGB OETF, alpha-guarded unpremultiply', async () => {
    const {OverlayPass} = await import('../src/render/overlay');
    const pass = new OverlayPass(4);
    // the node output is already premultiplied: no second premultiply by three, explicit One / OneMinusSrcAlpha blending
    expect(pass.material.premultipliedAlpha).toBe(false);
    expect([pass.material.blending, pass.material.blendSrc, pass.material.blendDst, pass.material.blendSrcAlpha, pass.material.blendDstAlpha])
      .toEqual([THREE.CustomBlending, THREE.OneFactor, THREE.OneMinusSrcAlphaFactor, THREE.OneFactor, THREE.OneMinusSrcAlphaFactor]);
    expect(pass.material.transparent).toBe(true);
    expect(pass.target.texture.type).toBe(THREE.HalfFloatType);
    expect(pass.target.samples).toBe(4);
    const fs = await fragmentOf(pass.material);
    expect(fs).toMatch(/acesFilmicToneMapping/i);
    expect(fs).toMatch(/sRGBTransferOETF|pow\(/);
    expect(fs).toContain('0.0001');
    expect(fs).not.toMatch(/color\.xyz \* vec3\( color\.w \)/); // no premultiplyAlpha() on the output
    pass.setSize(1281.7, 0);
    expect([pass.target.width, pass.target.height]).toEqual([1281, 1]);
    pass.dispose();
  });

  it('overlay skips a hidden viewmodel (nothing drawn while holstered / empty-handed)', async () => {
    const {OverlayPass} = await import('../src/render/overlay');
    const scene = new THREE.Scene();
    const holder = new THREE.Group();
    holder.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    scene.add(new THREE.HemisphereLight(), holder);
    expect(OverlayPass.hasVisible(scene)).toBe(true);
    holder.visible = false;
    expect(OverlayPass.hasVisible(scene)).toBe(false);
  });
});
