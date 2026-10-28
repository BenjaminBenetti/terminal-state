// Iteration 08 (primary): software WebGL rasterizers get anisotropic filtering capped at 1 (render/softwareGl.ts);
// hardware renderers keep their max. See the module header for the browser-QA evidence.
import {describe, expect, it} from 'vitest';
import {adaptToSoftwareGl, isSoftwareRenderer} from '../src/render/softwareGl';

function fakeRenderer(name: string | null, max = 16) {
  const ext = {UNMASKED_RENDERER_WEBGL: 0x9246};
  const gl = {RENDERER: 0x1f01, getExtension: (n: string) => (n === 'WEBGL_debug_renderer_info' && name !== null ? ext : null), getParameter: (p: number) => (p === 0x9246 ? name : 'WebKit WebGL')};
  return {getContext: () => gl as unknown as WebGL2RenderingContext, capabilities: {getMaxAnisotropy: () => max} as unknown as import('three').WebGLCapabilities};
}

describe('software GL adaptation', () => {
  it('recognises common software rasterizers only', () => {
    for (const s of ['llvmpipe (LLVM 15.0.7, 256 bits)', 'Mesa softpipe', 'Google SwiftShader', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'Microsoft Basic Render Driver', 'lavapipe']) expect(isSoftwareRenderer(s), s).toBe(true);
    for (const s of ['NVIDIA GeForce RTX 3070/PCIe/SSE2', 'AMD Radeon RX 6800', 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'Apple M2', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)', 'WebKit WebGL']) expect(isSoftwareRenderer(s), s).toBe(false);
  });
  it('caps anisotropy at 1 on llvmpipe and leaves hardware unchanged', () => {
    const sw = fakeRenderer('llvmpipe (LLVM 15.0.7, 256 bits)');
    const a = adaptToSoftwareGl(sw);
    expect(a.software).toBe(true);
    expect(sw.capabilities.getMaxAnisotropy()).toBe(1);
    const hw = fakeRenderer('NVIDIA GeForce RTX 3070/PCIe/SSE2');
    const b = adaptToSoftwareGl(hw);
    expect(b.software).toBe(false);
    expect(hw.capabilities.getMaxAnisotropy()).toBe(16);
    expect(adaptToSoftwareGl(fakeRenderer(null)).software).toBe(false); // masked renderer string: unchanged
  });
});
