// Iteration 08 (primary): software WebGL rasterizers (Mesa llvmpipe/softpipe/lavapipe, SwiftShader, Microsoft Basic
// Render) implement anisotropic filtering on the CPU with a cost that explodes where UV derivatives are extreme. The
// world-mapped surfaces switch projection plane around thin cylinders/rails, and in the iteration-08 browser QA
// (Firefox + Mesa llvmpipe) single views along railings / cabled walls took 25-113 s per frame with 8x anisotropy and
// well under a second at 1x. Players whose browser falls back to software GL hit the same wall, so on a software
// rasterizer the renderer caps texture anisotropy at 1 (plain trilinear). Hardware GPUs are unchanged (8x as before).
//
// Iteration 13 (CORE): the renderer is three r186's WebGPURenderer.
//  - WebGL 2 backend: the renderer string comes from the backend's own GL context (backend.gl); a software one caps
//    `backend.capabilities.getMaxAnisotropy` at 1, which three's WebGLTextureUtils applies to every texture (as the
//    WebGLRenderer capability did). Without a readable context the conservative default caps anisotropy at 4.
//  - WebGPU backend: three passes `texture.anisotropy` straight into each sampler (no capability clamp), so on a
//    software / fallback adapter (GPUAdapterInfo.isFallbackAdapter, or a SwiftShader / lavapipe / llvmpipe
//    description) the backend's sampler creation is clamped to anisotropy 1 instead.
//
// Task mall-playtest-revision-20261031 (lane FIX, U08): floor / wall / ceiling surfaces now REQUEST 16x (render/anisotropy.ts);
// the software cap above still applies (requested 16 -> effective 1 there), and the state records the backend's real maximum.

import {glRendererString, type BackendLike} from './backend';
import {WEBGPU_SUPPORTED_ANISOTROPY, webglSupportedAnisotropy, type AnisoCapability, type SupportedSource} from './anisotropy'; // lane FIX (U08)

const SOFTWARE = /llvmpipe|softpipe|lavapipe|swiftshader|software|basic render/i;

/** Unmasked renderer string when the browser exposes it, else the (possibly generic) RENDERER string. */
export function rendererString(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  return glRendererString(gl);
}

export const isSoftwareRenderer = (name: string): boolean => SOFTWARE.test(name);

export interface SoftwareGlState {
  /** Renderer string (WebGL 2) or adapter description (WebGPU) the decision used. */
  renderer: string;
  software: boolean;
  maxAnisotropy: number;
  /** Which backend / source decided: GL renderer string, WebGPU adapter info, or the conservative default. */
  source: 'webgl2-renderer-string' | 'webgpu-adapter-info' | 'default';
  /**
   * Task mall-playtest-revision-20261031 (lane FIX, U08): the backend's REAL anisotropy maximum read before any cap (WebGL 2:
   * EXT_texture_filter_anisotropic MAX, 1 without the extension; WebGPU: 16, the spec clamp) and where it came from.
   * `maxAnisotropy` stays the cap the backend now applies (1 on software, the conservative default without a context).
   */
  supportedAnisotropy: number;
  supportedSource: SupportedSource;
  backend: 'webgpu' | 'webgl2' | 'unknown';
}

/** Conservative anisotropy cap when the backend exposes nothing to decide by. */
export const DEFAULT_MAX_ANISOTROPY = 4;

interface SamplerBinding { texture: {anisotropy: number} | null }
interface AdaptableBackend extends BackendLike {
  capabilities?: {getMaxAnisotropy(): number} | null;
  updateSampler?: (binding: SamplerBinding) => unknown;
}

/** WebGPU backend: clamp the anisotropy every sampler is created with (the texture's own value is left untouched). */
function clampWebGpuSamplers(backend: AdaptableBackend, cap: number): void {
  const inner = backend.updateSampler;
  if (typeof inner !== 'function' || (inner as {__anisoCap?: number}).__anisoCap !== undefined) return;
  const wrapped = function (this: unknown, binding: SamplerBinding) {
    const t = binding.texture;
    if (!t || !(t.anisotropy > cap)) return inner.call(this, binding);
    const a = t.anisotropy;
    t.anisotropy = cap;
    try { return inner.call(this, binding); } finally { t.anisotropy = a; }
  };
  (wrapped as {__anisoCap?: number}).__anisoCap = cap;
  backend.updateSampler = wrapped;
}

/**
 * Caps anisotropic filtering at 1 on a software rasterizer / software WebGPU adapter. Call right after
 * `await renderer.init()` (the backend's context / device exist then) and before the first render (uploads).
 */
export function adaptToSoftwareGl(renderer: {backend: unknown}): SoftwareGlState {
  const b = renderer.backend as AdaptableBackend;
  if (b.isWebGPUBackend) {
    const a = b.device?.adapterInfo;
    const name = a ? [a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(' ') : '';
    const software = a?.isFallbackAdapter === true || isSoftwareRenderer(name);
    if (software) clampWebGpuSamplers(b, 1);
    return {renderer: name, software, maxAnisotropy: software ? 1 : b.capabilities?.getMaxAnisotropy() ?? 16, source: a ? 'webgpu-adapter-info' : 'default',
      supportedAnisotropy: WEBGPU_SUPPORTED_ANISOTROPY, supportedSource: 'webgpu-spec-clamp', backend: 'webgpu'};
  }
  const caps = b.capabilities;
  if (b.gl && caps) {
    const name = rendererString(b.gl);
    const software = isSoftwareRenderer(name);
    // lane FIX (U08): the context's real maximum, read before the software cap replaces three's capability
    const real = webglSupportedAnisotropy(b.gl);
    if (software) caps.getMaxAnisotropy = () => 1;
    return {renderer: name, software, maxAnisotropy: caps.getMaxAnisotropy(), source: 'webgl2-renderer-string',
      supportedAnisotropy: real.supported, supportedSource: real.source, backend: 'webgl2'};
  }
  // no context / capabilities to read: conservative default
  const real = caps ? caps.getMaxAnisotropy() : DEFAULT_MAX_ANISOTROPY;
  if (caps) { const max = real; caps.getMaxAnisotropy = () => Math.min(max, DEFAULT_MAX_ANISOTROPY); }
  return {renderer: '', software: false, maxAnisotropy: DEFAULT_MAX_ANISOTROPY, source: 'default',
    supportedAnisotropy: Math.max(1, real), supportedSource: 'default', backend: b.isWebGLBackend ? 'webgl2' : 'unknown'};
}

/**
 * Lane FIX (U08): the anisotropy capability of the adapted backend — real maximum, the cap the game applies and why
 * (render/anisotropy.ts effectiveAnisotropy / anisotropyReport).
 */
export function anisotropyCapability(s: SoftwareGlState | null): AnisoCapability {
  if (!s) return {backend: 'unknown', supported: 1, supportedSource: 'default', software: false, cap: 1, capReason: 'renderer not initialized'};
  const capReason = s.software
    ? `software rasterizer / adapter (${s.renderer || 'unnamed'}): capped at 1 (iteration-08 llvmpipe hang guard)`
    : s.source === 'default'
      ? `no readable context / adapter info: conservative cap ${DEFAULT_MAX_ANISOTROPY}`
      : s.backend === 'webgpu' ? 'hardware WebGPU adapter: sampler maxAnisotropy as requested (platform clamp)' : 'hardware WebGL 2: extension maximum';
  return {backend: s.backend, supported: s.supportedAnisotropy, supportedSource: s.supportedSource, software: s.software, cap: Math.min(s.maxAnisotropy, s.supportedAnisotropy), capReason};
}
