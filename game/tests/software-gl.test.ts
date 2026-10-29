// Iteration 08 (primary): software WebGL rasterizers get anisotropic filtering capped at 1 (render/softwareGl.ts);
// hardware renderers keep their max. See the module header for the browser-QA evidence.
// Iteration 13 (CORE): the renderer is WebGPURenderer — the WebGL 2 backend is read through its own GL context and
// capabilities; the WebGPU backend through the device's adapter info, clamping the samplers it creates.
import {describe, expect, it} from 'vitest';
import {DEFAULT_MAX_ANISOTROPY, adaptToSoftwareGl, isSoftwareRenderer} from '../src/render/softwareGl';

function fakeGl(name: string | null) {
  const ext = {UNMASKED_RENDERER_WEBGL: 0x9246};
  return {RENDERER: 0x1f01, getExtension: (n: string) => (n === 'WEBGL_debug_renderer_info' && name !== null ? ext : null), getParameter: (p: number) => (p === 0x9246 ? name : 'WebKit WebGL')} as unknown as WebGL2RenderingContext;
}
/** A WebGPURenderer-shaped object on three's WebGL 2 backend (backend.gl + backend.capabilities). */
function webgl2Renderer(name: string | null, max = 16) {
  return {backend: {isWebGLBackend: true, gl: fakeGl(name), capabilities: {getMaxAnisotropy: () => max}}};
}
/** ... on the WebGPU backend (device.adapterInfo + backend.updateSampler). */
function webgpuRenderer(info: Record<string, unknown> | undefined) {
  const seen: number[] = [];
  const backend = {
    isWebGPUBackend: true, device: info ? {adapterInfo: info} : {}, capabilities: {getMaxAnisotropy: () => 16},
    updateSampler(binding: {texture: {anisotropy: number}}) { seen.push(binding.texture.anisotropy); return `key-${binding.texture.anisotropy}`; },
  };
  return {renderer: {backend}, seen};
}

describe('software GL adaptation', () => {
  it('recognises common software rasterizers only', () => {
    for (const s of ['llvmpipe (LLVM 15.0.7, 256 bits)', 'Mesa softpipe', 'Google SwiftShader', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'Microsoft Basic Render Driver', 'lavapipe']) expect(isSoftwareRenderer(s), s).toBe(true);
    for (const s of ['NVIDIA GeForce RTX 3070/PCIe/SSE2', 'AMD Radeon RX 6800', 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'Apple M2', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)', 'WebKit WebGL']) expect(isSoftwareRenderer(s), s).toBe(false);
  });

  it('WebGL 2 backend: caps anisotropy at 1 on llvmpipe (backend capabilities) and leaves hardware unchanged', () => {
    const sw = webgl2Renderer('llvmpipe (LLVM 15.0.7, 256 bits)');
    const a = adaptToSoftwareGl(sw);
    expect(a).toMatchObject({software: true, source: 'webgl2-renderer-string', maxAnisotropy: 1});
    expect(sw.backend.capabilities.getMaxAnisotropy()).toBe(1); // what three's WebGLTextureUtils clamps texture.anisotropy to
    const hw = webgl2Renderer('NVIDIA GeForce RTX 3070/PCIe/SSE2');
    const b = adaptToSoftwareGl(hw);
    expect(b.software).toBe(false);
    expect(hw.backend.capabilities.getMaxAnisotropy()).toBe(16);
    expect(adaptToSoftwareGl(webgl2Renderer(null)).software).toBe(false); // masked renderer string: unchanged
  });

  it('WebGL 2 backend without a readable context: conservative default cap', () => {
    const r = {backend: {isWebGLBackend: true, gl: null, capabilities: {getMaxAnisotropy: () => 16}}};
    const s = adaptToSoftwareGl(r);
    expect(s).toMatchObject({software: false, source: 'default', maxAnisotropy: DEFAULT_MAX_ANISOTROPY});
    expect(r.backend.capabilities.getMaxAnisotropy()).toBe(DEFAULT_MAX_ANISOTROPY);
  });

  it('WebGPU backend: a fallback / software adapter clamps every sampler to anisotropy 1 (texture value untouched)', () => {
    for (const info of [{vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader Device (Subzero)'}, {vendor: 'mesa', description: 'llvmpipe (LLVM 19)', isFallbackAdapter: false}, {vendor: 'x', isFallbackAdapter: true}]) {
      const {renderer, seen} = webgpuRenderer(info);
      const s = adaptToSoftwareGl(renderer);
      expect(s, JSON.stringify(info)).toMatchObject({software: true, source: 'webgpu-adapter-info', maxAnisotropy: 1});
      const tex = {anisotropy: 8};
      expect(renderer.backend.updateSampler({texture: tex})).toBe('key-1');
      expect(seen.at(-1)).toBe(1);
      expect(tex.anisotropy).toBe(8);
      adaptToSoftwareGl(renderer); // idempotent: not wrapped twice
      renderer.backend.updateSampler({texture: tex});
      expect(seen.at(-1)).toBe(1);
    }
  });

  it('WebGPU backend: a hardware adapter keeps its anisotropy; unreported adapter info is not treated as software', () => {
    const {renderer, seen} = webgpuRenderer({vendor: 'nvidia', architecture: 'ampere', description: 'NVIDIA GeForce RTX 3070', isFallbackAdapter: false});
    expect(adaptToSoftwareGl(renderer)).toMatchObject({software: false, source: 'webgpu-adapter-info', maxAnisotropy: 16});
    renderer.backend.updateSampler({texture: {anisotropy: 8}});
    expect(seen.at(-1)).toBe(8);
    const none = webgpuRenderer(undefined);
    expect(adaptToSoftwareGl(none.renderer)).toMatchObject({software: false, source: 'default'});
  });
});
