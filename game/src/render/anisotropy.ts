// Task mall-playtest-revision-20261031 (lane FIX, U08): sampler anisotropy for floor / wall / ceiling surfaces.
//
// User report: "a low anisotropic filtering setting causing the floor texture to look muddy at a short distance from the camera;
// if you can increase to 16x". Floor / wall / ceiling textures were created with 4x (loaded env / office textures, canvas floors)
// or 8x (canvas surface library), the shared decay detail texture with 1x. Those surfaces now REQUEST 16x; what the GPU actually
// uses is clamped by the ACTIVE backend, and this module reports requested / supported / effective per backend.
//
// How three r186 propagates `texture.anisotropy` (both backends read it at upload / sampler creation only):
//  - WebGL 2 backend (WebGLTextureUtils.setTextureParameters, run by createTexture / updateTexture): sets
//    TEXTURE_MAX_ANISOTROPY_EXT = min(texture.anisotropy, backend.capabilities.getMaxAnisotropy()) when the context has
//    EXT_texture_filter_anisotropic, magFilter is not Nearest, minFilter is (Nearest|Linear)MipmapLinear and anisotropy > 1.
//    getMaxAnisotropy() is the extension's MAX_TEXTURE_MAX_ANISOTROPY_EXT (0 without the extension: nothing is set = 1x).
//    render/softwareGl.ts replaces getMaxAnisotropy with 1 on a software rasterizer (llvmpipe hang, iteration 08).
//  - WebGPU backend (WebGPUTextureUtils.updateSampler; sampler cache keyed by texture.anisotropy, re-run when texture.version
//    changes): GPUSamplerDescriptor.maxAnisotropy = texture.anisotropy when mag / min / mipmap filters are all linear, else 1.
//    WebGPU exposes no anisotropy limit: the spec clamps the used value to what the platform supports (three's
//    WebGPUCapabilities.getMaxAnisotropy() reports 16). render/softwareGl.ts clamps the descriptor to 1 on a fallback adapter.
//  So a value changed after a texture was first used only lands after `needsUpdate` (requestSurfaceAnisotropy bumps it).
//
// Effective value = 1 when the filters exclude anisotropy, else max(1, min(requested, cap)) with cap = the backend's real maximum
// (WebGL: the extension max, 1 without it; WebGPU: 16 by spec / three) or 1 on a software rasterizer / adapter. QA:
// `__LL.anisotropy()` (anisotropyReport) also counts what the backend was actually handed (sampler descriptors / texParameterf).
// Nothing here changes mipmaps, colour space, wrapping or the warm-up.

import * as THREE from 'three';

/** Requested anisotropy of floor / wall / ceiling surface textures (the user's "16x"). */
export const SURFACE_ANISOTROPY = 16;
/** userData key naming why a texture asked for SURFACE_ANISOTROPY. */
export const ANISO_ROLE = 'anisotropyRole';
/** Roles: architectural floor / wall / ceiling maps, 'architecture' (a decayed surface of unknown orientation), 'detail' (decay / wall-treatment detail sampled on those surfaces). */
export type SurfaceRole = 'floor' | 'wall' | 'ceiling' | 'architecture' | 'detail';
export const SURFACE_ROLES: readonly SurfaceRole[] = ['floor', 'wall', 'ceiling', 'architecture', 'detail'];
/** EXT_texture_filter_anisotropic enums. */
export const GL_TEXTURE_MAX_ANISOTROPY_EXT = 0x84fe;
export const GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84ff;

/** Material texture slots that sample a surface map. */
export const MAP_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'emissiveMap', 'alphaMap'] as const;

/** Whether BOTH backends apply anisotropy to this texture (linear mag + linear-mipmap-linear min; the default filters). */
export function anisotropyApplies(t: Pick<THREE.Texture, 'magFilter' | 'minFilter'>): boolean {
  return t.magFilter === THREE.LinearFilter && t.minFilter === THREE.LinearMipmapLinearFilter;
}

/** Requests per role (QA). */
export const anisotropyStats = {requests: Object.fromEntries(SURFACE_ROLES.map(r => [r, 0])) as Record<SurfaceRole, number>, notApplicable: 0, bumped: 0};

/**
 * Ask for SURFACE_ANISOTROPY on a floor / wall / ceiling texture (idempotent). Tags `userData.anisotropyRole` (first role wins).
 * A texture already flagged for upload (version > 0) gets `needsUpdate` when the value changes, so both backends re-read it.
 * Textures whose filters exclude anisotropy (nearest / non-mipmapped data tables) are tagged but left at their value.
 */
export function requestSurfaceAnisotropy<T extends THREE.Texture>(t: T, role: SurfaceRole, level = SURFACE_ANISOTROPY): T {
  if (t.userData[ANISO_ROLE] === undefined) t.userData[ANISO_ROLE] = role;
  anisotropyStats.requests[role]++;
  if (!anisotropyApplies(t)) { anisotropyStats.notApplicable++; return t; }
  if (t.anisotropy !== level) {
    t.anisotropy = level;
    if (t.version > 0) { t.needsUpdate = true; anisotropyStats.bumped++; }
  }
  return t;
}

/** requestSurfaceAnisotropy on every surface map of a material (single or array). Returns the textures touched. */
export function requestMaterialAnisotropy(m: THREE.Material | THREE.Material[], role: SurfaceRole): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const mat of Array.isArray(m) ? m : [m]) {
    const rec = mat as unknown as Record<string, unknown>;
    for (const k of MAP_SLOTS) {
      const t = rec[k];
      if (t instanceof THREE.Texture) { requestSurfaceAnisotropy(t, role); out.push(t); }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Backend capability -> effective value

export type AnisoBackend = 'webgpu' | 'webgl2' | 'unknown';
export type SupportedSource = 'EXT_texture_filter_anisotropic' | 'no-extension' | 'webgpu-spec-clamp' | 'default';

/** What the active backend supports and the cap the game applies (render/softwareGl.ts decides `software`). */
export interface AnisoCapability {
  backend: AnisoBackend;
  /** The backend's real maximum: WebGL = MAX_TEXTURE_MAX_ANISOTROPY_EXT (1 without the extension); WebGPU = 16 (spec clamp, no queryable limit). */
  supported: number;
  supportedSource: SupportedSource;
  software: boolean;
  /** The maximum the game lets the backend use: 1 on a software rasterizer / adapter, the conservative default without a readable context, else `supported`. */
  cap: number;
  capReason: string;
}

/** The capability of a WebGL 2 context: the extension's maximum, 1 without it (three then sets nothing). */
export function webglSupportedAnisotropy(gl: Pick<WebGL2RenderingContext, 'getExtension' | 'getParameter'> | null | undefined): {supported: number; source: SupportedSource} {
  if (!gl) return {supported: 1, source: 'default'};
  try {
    const ext = gl.getExtension('EXT_texture_filter_anisotropic') as {MAX_TEXTURE_MAX_ANISOTROPY_EXT?: number} | null;
    if (!ext) return {supported: 1, source: 'no-extension'};
    const v = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT ?? GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    return {supported: typeof v === 'number' && v >= 1 ? v : 1, source: 'EXT_texture_filter_anisotropic'};
  } catch {
    return {supported: 1, source: 'no-extension'};
  }
}

/** WebGPU: no queryable limit; samplers accept up to 16 and the platform clamps (three's capability reports 16). */
export const WEBGPU_SUPPORTED_ANISOTROPY = 16;

/** Effective anisotropy of a texture asking for `requested` under `cap` (1 when its filters exclude anisotropy). */
export function effectiveAnisotropy(requested: number, cap: number, applies = true): number {
  if (!applies) return 1;
  return Math.max(1, Math.min(Math.max(1, requested), Math.max(1, cap)));
}

// ---------------------------------------------------------------------------------------------
// Observation: what the backend was actually handed

/** Histogram of anisotropy values the backend passed to the API since `observeBackendAnisotropy` (value -> count). */
export interface AnisoObserved {
  /** 'createSampler' (WebGPU descriptors) / 'texParameterf' (WebGL TEXTURE_MAX_ANISOTROPY_EXT) / null when not observable. */
  api: 'createSampler' | 'texParameterf' | null;
  values: Record<string, number>;
}

interface ObservableBackend {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  device?: {createSampler?: (d: {maxAnisotropy?: number}) => unknown} | null;
  gl?: {texParameterf?: (target: number, pname: number, value: number) => void} | null;
}
const observed = new WeakMap<object, AnisoObserved>();

/**
 * Count the anisotropy values the backend hands the API (WebGPU device.createSampler descriptors; WebGL texParameterf for
 * TEXTURE_MAX_ANISOTROPY_EXT). Idempotent; the wrapped calls behave exactly as before. A WebGL texture three sets no value for
 * (filters / no extension / anisotropy 1) samples at 1x and is not counted.
 */
export function observeBackendAnisotropy(backend: unknown): AnisoObserved {
  const b = backend as ObservableBackend;
  const prev = observed.get(b as object);
  if (prev) return prev;
  const rec: AnisoObserved = {api: null, values: {}};
  const count = (v: number) => { const k = String(v); rec.values[k] = (rec.values[k] ?? 0) + 1; };
  if (b.isWebGPUBackend && b.device && typeof b.device.createSampler === 'function') {
    const dev = b.device, inner = dev.createSampler!;
    dev.createSampler = function (d: {maxAnisotropy?: number}) { count(d?.maxAnisotropy ?? 1); return inner.call(this, d); };
    rec.api = 'createSampler';
  } else if (b.isWebGLBackend && b.gl && typeof b.gl.texParameterf === 'function') {
    const gl = b.gl, inner = gl.texParameterf!;
    gl.texParameterf = function (target: number, pname: number, value: number) { if (pname === GL_TEXTURE_MAX_ANISOTROPY_EXT) count(value); return inner.call(this, target, pname, value); };
    rec.api = 'texParameterf';
  }
  observed.set(b as object, rec);
  return rec;
}

// ---------------------------------------------------------------------------------------------
// QA report

export interface AnisoRoleCensus { textures: number; requested: Record<string, number>; effective: Record<string, number> }
export interface AnisotropyReport extends AnisoCapability {
  requested: number;
  /** Effective value for a surface texture that asked for `requested` with the default (linear mipmapped) filters. */
  effective: number;
  /** Scene census: textures by role with their requested and effective values (untagged textures under 'other'). */
  roles: Record<SurfaceRole | 'other', AnisoRoleCensus>;
  observed: AnisoObserved | null;
  /** Honest scope notes (no native-GPU claim from software rendering). */
  note: string;
}

const bump = (r: Record<string, number>, k: number) => { const s = String(k); r[s] = (r[s] ?? 0) + 1; };

/** Census of the textures reachable from `root` (materials' surface map slots + extra textures such as uniform-bound detail maps). */
export function anisotropyCensus(root: THREE.Object3D | null, cap: number, extra: Iterable<THREE.Texture> = []): Record<SurfaceRole | 'other', AnisoRoleCensus> {
  const roles = Object.fromEntries([...SURFACE_ROLES, 'other'].map(r => [r, {textures: 0, requested: {}, effective: {}}])) as Record<SurfaceRole | 'other', AnisoRoleCensus>;
  const seen = new Set<THREE.Texture>();
  const add = (t: THREE.Texture) => {
    if (seen.has(t)) return;
    seen.add(t);
    const role = (t.userData?.[ANISO_ROLE] as SurfaceRole | undefined) ?? 'other';
    const c = roles[role] ?? roles.other;
    c.textures++;
    bump(c.requested, t.anisotropy);
    bump(c.effective, effectiveAnisotropy(t.anisotropy, cap, anisotropyApplies(t)));
  };
  root?.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      const rec = mat as unknown as Record<string, unknown>;
      for (const k of MAP_SLOTS) { const t = rec[k]; if (t instanceof THREE.Texture) add(t); }
    }
  });
  for (const t of extra) add(t);
  return roles;
}

export function anisotropyReport(cap: AnisoCapability, root: THREE.Object3D | null, obs: AnisoObserved | null, extra: Iterable<THREE.Texture> = []): AnisotropyReport {
  const effective = effectiveAnisotropy(SURFACE_ANISOTROPY, cap.cap);
  const note = cap.software
    ? 'software rasterizer / adapter: surfaces REQUEST 16x but the backend is capped at 1x (iteration-08 llvmpipe hang guard); this proves the request path only, not native-GPU sharpness or cost'
    : cap.backend === 'webgpu'
      ? 'WebGPU: samplers are created with maxAnisotropy = requested; the platform may clamp below 16 (not queryable). No native-GPU visual claim from metadata.'
      : 'WebGL 2: TEXTURE_MAX_ANISOTROPY_EXT = min(requested, extension max) at upload. No native-GPU visual claim from metadata.';
  return {...cap, requested: SURFACE_ANISOTROPY, effective, roles: anisotropyCensus(root, cap.cap, extra), observed: obs, note};
}
