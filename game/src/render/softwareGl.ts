// Iteration 08 (primary): software WebGL rasterizers (Mesa llvmpipe/softpipe/lavapipe, SwiftShader, Microsoft Basic
// Render) implement anisotropic filtering on the CPU with a cost that explodes where UV derivatives are extreme. The
// world-mapped surfaces switch projection plane around thin cylinders/rails, and in the iteration-08 browser QA
// (Firefox + Mesa llvmpipe) single views along railings / cabled walls took 25-113 s per frame with 8x anisotropy and
// well under a second at 1x. Players whose browser falls back to software GL hit the same wall, so on a software
// rasterizer the renderer caps texture anisotropy at 1 (plain trilinear). Hardware GPUs are unchanged (8x as before).

import type * as THREE from 'three';

const SOFTWARE = /llvmpipe|softpipe|lavapipe|swiftshader|software|basic render/i;

/** Unmasked renderer string when the browser exposes it, else the (possibly generic) RENDERER string. */
export function rendererString(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof s === 'string' ? s : '';
  } catch {
    return '';
  }
}

export const isSoftwareRenderer = (name: string): boolean => SOFTWARE.test(name);

export interface SoftwareGlState { renderer: string; software: boolean; maxAnisotropy: number }

/** Caps anisotropic filtering at 1 on a software rasterizer; call right after creating the renderer (before uploads). */
export function adaptToSoftwareGl(renderer: Pick<THREE.WebGLRenderer, 'getContext' | 'capabilities'>): SoftwareGlState {
  const name = rendererString(renderer.getContext());
  const software = isSoftwareRenderer(name);
  if (software) renderer.capabilities.getMaxAnisotropy = () => 1;
  return {renderer: name, software, maxAnisotropy: renderer.capabilities.getMaxAnisotropy()};
}
