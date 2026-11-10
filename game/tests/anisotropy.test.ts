// Task mall-playtest-revision-20261031 (lane FIX, U08): floor / wall / ceiling textures request 16x anisotropy; the effective value
// is clamped by the ACTIVE backend (render/anisotropy.ts, render/softwareGl.ts). Propagation is checked through three r186's REAL
// backend code: WebGPUBackend.updateSampler -> device.createSampler descriptors (mocked device) and WebGLTextureUtils.
// setTextureParameters -> gl.texParameterf(TEXTURE_MAX_ANISOTROPY_EXT) (Proxy WebGL 2 context with EXT_texture_filter_anisotropic).
// Hardware / software / no-extension / default cases; the request path at material creation and the build-time scene pass.
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {createGameRenderer, rendererRequest} from '../src/render/backend';
import {adaptToSoftwareGl, anisotropyCapability, DEFAULT_MAX_ANISOTROPY} from '../src/render/softwareGl';
import {
  GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT, GL_TEXTURE_MAX_ANISOTROPY_EXT, SURFACE_ANISOTROPY, anisotropyApplies, anisotropyReport, effectiveAnisotropy,
  observeBackendAnisotropy, requestMaterialAnisotropy, requestSurfaceAnisotropy,
} from '../src/render/anisotropy';
import {envTextureRole} from '../src/assets/loader';
import {OFFICE_TEXTURE_ROLE} from '../src/assets/officeAssets';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials, surfaceMaterial, thinTrim} from '../src/world/materials';
import {applyDecay, decayDetailTexture, DECAY_PROFILES} from '../src/world/decay';
import {architectureRole, requestArchitectureAnisotropy} from '../src/world/surfaceAnisotropy';
import {installCanvasShim} from './helpers/canvas2d';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------------------------------------
// harness: real WebGPURenderer on a mocked navigator.gpu / a Proxy WebGL 2 context (same approach as backend.test.ts)

const ARRAY_PARAMS = new Set([0x0ba2, 0x0c10, 0x0c22, 0x0b73]);
const EXT = {TEXTURE_MAX_ANISOTROPY_EXT: GL_TEXTURE_MAX_ANISOTROPY_EXT, MAX_TEXTURE_MAX_ANISOTROPY_EXT: GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT};
const DBG = {UNMASKED_RENDERER_WEBGL: 0x9246};
/** WebGL 2 context: `max` = the extension's MAX_TEXTURE_MAX_ANISOTROPY_EXT (null: no extension); records texParameterf calls. */
function proxyGl(renderer: string, max: number | null, calls: [number, number, number][]): WebGL2RenderingContext {
  const own: Record<string, unknown> = {};
  const gl: WebGL2RenderingContext = new Proxy(own as unknown as WebGL2RenderingContext, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in own) return own[k];
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return 0x1000 + (k.length * 7919 + k.charCodeAt(0) * 31 + k.charCodeAt(k.length - 1)) % 60000;
      if (k === 'getParameter') return (p: number) => (ARRAY_PARAMS.has(p) ? new Int32Array([0, 0, 300, 150]) : p === DBG.UNMASKED_RENDERER_WEBGL ? renderer : p === GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT ? max : p === gl.MAX_3D_TEXTURE_SIZE ? 2048 : 16);
      if (k === 'getSupportedExtensions') return () => (max === null ? ['WEBGL_debug_renderer_info'] : ['EXT_texture_filter_anisotropic', 'WEBGL_debug_renderer_info']);
      if (k === 'getExtension') return (n: string) => (n === 'EXT_texture_filter_anisotropic' ? (max === null ? null : EXT) : n === 'WEBGL_debug_renderer_info' ? DBG : null);
      if (k === 'getContextAttributes') return () => ({antialias: true});
      if (k === 'texParameterf') return (t: number, p: number, v: number) => { calls.push([t, p, v]); };
      return () => ({});
    },
    set(_t, k, v) { own[k as string] = v; return true; },
  });
  return gl;
}
function fakeCanvas(gl: WebGL2RenderingContext | null) {
  return {width: 300, height: 150, style: {}, addEventListener() {}, removeEventListener() {},
    getContext: (k: string) => (k === 'webgl2' ? gl : k === 'webgpu' ? {configure() {}, unconfigure() {}, getCurrentTexture: () => ({})} : null)} as unknown as HTMLCanvasElement;
}
function fakeGpu(info: Record<string, unknown>, made: {maxAnisotropy?: number}[]) {
  const device = {
    features: new Set(['core-features-and-limits']), limits: {maxTextureDimension3D: 2048, maxUniformBufferBindingSize: 65536}, lost: new Promise(() => {}), adapterInfo: info,
    createTexture: () => ({createView: () => ({}), destroy() {}}), createSampler: (d: {maxAnisotropy?: number}) => { made.push({maxAnisotropy: d.maxAnisotropy}); return {}; },
    createBuffer: () => ({}), queue: {submit() {}, writeBuffer() {}},
  };
  const adapter = {features: new Set<string>(), requestDevice: async () => device};
  return {requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'bgra8unorm'};
}
async function boot(search: string, nav: Record<string, unknown>, canvas: HTMLCanvasElement) {
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const g = createGameRenderer(canvas, rendererRequest(search, nav as {gpu?: unknown}, true));
  await g.renderer.init();
  return g.renderer;
}
const surfaceTex = (role: 'floor' | 'wall' = 'floor') => requestSurfaceAnisotropy(new THREE.Texture(), role);

// ---------------------------------------------------------------------------------------------------------------------------

describe('U08 request policy', () => {
  it('a floor / wall texture requests 16x, is tagged with its role, and is re-flagged for upload when it already was', () => {
    const t = new THREE.Texture();
    t.anisotropy = 4;
    t.needsUpdate = true;
    const v = t.version;
    requestSurfaceAnisotropy(t, 'floor');
    expect(t.anisotropy).toBe(SURFACE_ANISOTROPY);
    expect(SURFACE_ANISOTROPY).toBe(16);
    expect(t.userData.anisotropyRole).toBe('floor');
    expect(t.version).toBe(v + 1); // both backends re-read the value (upload / sampler key)
    requestSurfaceAnisotropy(t, 'wall'); // idempotent: first role kept, no second bump
    expect(t.userData.anisotropyRole).toBe('floor');
    expect(t.version).toBe(v + 1);
    // filters that exclude anisotropy (data tables): tagged, value left alone (mipmaps / filters never changed)
    const n = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    n.minFilter = n.magFilter = THREE.NearestFilter;
    requestSurfaceAnisotropy(n, 'detail');
    expect(n.anisotropy).toBe(1);
    expect(anisotropyApplies(n)).toBe(false);
    expect(n.minFilter).toBe(THREE.NearestFilter);
  });

  it('effective = 1 when filters exclude it, else min(requested, cap) and never below 1', () => {
    expect(effectiveAnisotropy(16, 16)).toBe(16);
    expect(effectiveAnisotropy(16, 8)).toBe(8);
    expect(effectiveAnisotropy(16, 1)).toBe(1);
    expect(effectiveAnisotropy(16, 0)).toBe(1); // three's WebGL capability without the extension
    expect(effectiveAnisotropy(16, 16, false)).toBe(1);
    expect(effectiveAnisotropy(4, 16)).toBe(4);
  });

  it('environment / office textures: every floor, wall and ceiling map has a role (16x); non-architectural office textures keep 4x', () => {
    for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) expect(['floor', 'wall', 'ceiling']).toContain(envTextureRole(k));
    expect(envTextureRole('platformColor')).toBe('floor');
    expect(envTextureRole('edgeNormal')).toBe('floor');
    expect(envTextureRole('wallOrm')).toBe('wall');
    expect(envTextureRole('tunnelColor')).toBe('wall');
    expect(envTextureRole('ceilingNormal')).toBe('ceiling');
    expect(OFFICE_TEXTURE_ROLE).toEqual({'office-wall': 'wall', 'office-carpet': 'floor', 'ceiling-tile': 'ceiling'});
  });

  it('station materials: wall crops + painted block / terrazzo / concrete / ballast at 16x, thin trim stays 1x, decay detail 16x', () => {
    const un = installCanvasShim(false);
    try {
      const env = {} as Record<TextureKey, THREE.Texture>;
      for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) env[k] = requestSurfaceAnisotropy(new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement), envTextureRole(k));
      const mats = new WorldMaterials(env, 7, {w: 1.2, h: 0.19, d: 0.17});
      for (const k of ['tileLower', 'tileUpper', 'tileBase', 'platformSlab', 'safetyEdge', 'ceiling', 'tunnel', 'platformFace', 'paint', 'terrazzo', 'concrete', 'ballast'] as const) {
        const m = mats.get(k) as THREE.MeshStandardMaterial;
        for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap].filter(Boolean) as THREE.Texture[]) expect(t.anisotropy, k).toBe(16);
      }
      for (const k of ['steel', 'rail'] as const) {
        const m = mats.get(k) as THREE.MeshStandardMaterial;
        for (const t of [m.map, m.normalMap, m.roughnessMap].filter(Boolean) as THREE.Texture[]) { expect(t.anisotropy, k).toBe(1); expect(t.userData.anisotropyRole).toBe('thin-trim'); }
      }
      expect(decayDetailTexture().anisotropy).toBe(16);
      expect(decayDetailTexture().generateMipmaps).toBe(true); // mipmaps / filters unchanged
      expect(decayDetailTexture().minFilter).toBe(THREE.LinearMipmapLinearFilter);
    } finally { un(); }
  });

  it('build-time pass: every DECAYED (architectural) material in a scene asks for 16x with its role; props and thin trim untouched', () => {
    const un = installCanvasShim(false);
    try {
      const wallMap = new THREE.Texture(), floorMap = new THREE.Texture(), propMap = new THREE.Texture();
      for (const t of [wallMap, floorMap, propMap]) t.anisotropy = 4;
      const wm = surfaceMaterial('paintedPanel');
      wm.map = wallMap;
      applyDecay(wm, DECAY_PROFILES.paint);
      const fm = surfaceMaterial('quarryTile');
      fm.map = floorMap;
      applyDecay(fm, DECAY_PROFILES.terrazzo);
      const prop = surfaceMaterial('laminate');
      prop.map = propMap;
      const trim = thinTrim(surfaceMaterial('paintedSteel'));
      const g = new THREE.Group();
      for (const m of [wm, fm, prop, trim]) g.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(), [wm, prop]));
      expect(architectureRole(wm)).toBe('wall');
      expect(architectureRole(fm)).toBe('floor');
      expect(architectureRole(prop)).toBeNull();
      const r = requestArchitectureAnisotropy(g);
      expect(r.materials).toBe(2);
      expect(wallMap.anisotropy).toBe(16);
      expect(floorMap.anisotropy).toBe(16);
      expect(propMap.anisotropy).toBe(4);
      expect((trim.map as THREE.Texture).anisotropy).toBe(1);
    } finally { un(); }
  });
});

describe('U08 backend capability: requested / supported / effective', () => {
  const webgl = (name: string, max: number | null) => {
    const gl = proxyGl(name, max, []);
    const caps = {getMaxAnisotropy: () => (max ?? 0)};
    return {backend: {isWebGLBackend: true, gl, capabilities: caps}};
  };
  it('WebGL 2 hardware: supported = the extension maximum; 16 -> 16, 8 -> 8; no extension -> 1', () => {
    for (const [max, eff, src] of [[16, 16, 'EXT_texture_filter_anisotropic'], [8, 8, 'EXT_texture_filter_anisotropic'], [null, 1, 'no-extension']] as const) {
      const s = adaptToSoftwareGl(webgl('NVIDIA GeForce RTX 3070/PCIe/SSE2', max));
      const c = anisotropyCapability(s);
      expect(c, String(max)).toMatchObject({backend: 'webgl2', software: false, supported: max ?? 1, supportedSource: src});
      expect(effectiveAnisotropy(SURFACE_ANISOTROPY, c.cap)).toBe(eff);
    }
  });
  it('WebGL 2 software rasterizer (llvmpipe): supported 16 is REPORTED, the cap stays 1 (hang guard) -> effective 1', () => {
    const s = adaptToSoftwareGl(webgl('llvmpipe (LLVM 19.1.7, 256 bits)', 16));
    const c = anisotropyCapability(s);
    expect(c).toMatchObject({backend: 'webgl2', software: true, supported: 16, cap: 1});
    expect(c.capReason).toMatch(/software/);
    expect(effectiveAnisotropy(SURFACE_ANISOTROPY, c.cap)).toBe(1);
  });
  it('WebGPU: hardware adapter 16 (spec clamp), fallback adapter capped at 1; no context: conservative default', () => {
    const hw = anisotropyCapability(adaptToSoftwareGl({backend: {isWebGPUBackend: true, device: {adapterInfo: {vendor: 'nvidia', description: 'RTX', isFallbackAdapter: false}}, capabilities: {getMaxAnisotropy: () => 16}, updateSampler() {}}}));
    expect(hw).toMatchObject({backend: 'webgpu', software: false, supported: 16, supportedSource: 'webgpu-spec-clamp', cap: 16});
    const sw = anisotropyCapability(adaptToSoftwareGl({backend: {isWebGPUBackend: true, device: {adapterInfo: {vendor: 'google', description: 'SwiftShader', isFallbackAdapter: true}}, capabilities: {getMaxAnisotropy: () => 16}, updateSampler() {}}}));
    expect(sw).toMatchObject({software: true, cap: 1});
    const none = anisotropyCapability(adaptToSoftwareGl({backend: {isWebGLBackend: true, gl: null, capabilities: {getMaxAnisotropy: () => 16}}}));
    expect(none.cap).toBe(DEFAULT_MAX_ANISOTROPY);
    expect(anisotropyCapability(null).cap).toBe(1);
  });
});

describe('U08 propagation through three r186 backends (what the API is handed)', () => {
  it('WebGPU (real WebGPUBackend.updateSampler): createSampler maxAnisotropy 16 on hardware, 1 on a fallback adapter; nearest-filtered 1', async () => {
    for (const [info, want] of [[{vendor: 'nvidia', description: 'RTX', isFallbackAdapter: false}, 16], [{vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader Device', isFallbackAdapter: true}, 1]] as const) {
      const made: {maxAnisotropy?: number}[] = [];
      const renderer = await boot('', {gpu: fakeGpu(info, made)}, fakeCanvas(null));
      adaptToSoftwareGl(renderer);
      const obs = observeBackendAnisotropy(renderer.backend);
      expect(obs.api).toBe('createSampler');
      const be = renderer.backend as unknown as {updateSampler(b: unknown): unknown};
      const tex = surfaceTex();
      be.updateSampler({texture: tex, textureNode: {isSampleCompare: () => false}});
      expect(made.at(-1)?.maxAnisotropy, JSON.stringify(info)).toBe(want);
      expect(tex.anisotropy).toBe(16); // the texture keeps its request; only the sampler is clamped
      expect(obs.values[String(want)]).toBeGreaterThanOrEqual(1);
      const near = surfaceTex();
      near.magFilter = THREE.NearestFilter;
      be.updateSampler({texture: near, textureNode: {isSampleCompare: () => false}});
      expect(made.at(-1)?.maxAnisotropy).toBe(1); // WebGPU: anisotropy only with all-linear filtering (descriptor default 1)
      vi.unstubAllGlobals();
    }
  });

  it('WebGL 2 (real WebGLTextureUtils.setTextureParameters): TEXTURE_MAX_ANISOTROPY_EXT = min(16, extension max); llvmpipe 1; no extension: none', async () => {
    for (const [name, max, want] of [['NVIDIA GeForce RTX 3070/PCIe/SSE2', 16, 16], ['Mesa Intel(R) UHD Graphics 620', 8, 8], ['llvmpipe (LLVM 19.1.7, 256 bits)', 16, 1], ['NVIDIA GeForce RTX 3070/PCIe/SSE2', null, null]] as const) {
      const calls: [number, number, number][] = [];
      const gl = proxyGl(name, max, calls);
      const renderer = await boot('?renderer=webgl2', {gpu: undefined}, fakeCanvas(gl));
      const be = renderer.backend as unknown as {isWebGLBackend: boolean; textureUtils: {setTextureParameters(type: number, t: THREE.Texture): void}};
      expect(be.isWebGLBackend).toBe(true);
      const s = adaptToSoftwareGl(renderer);
      const obs = observeBackendAnisotropy(renderer.backend);
      expect(obs.api).toBe('texParameterf');
      const tex = surfaceTex('wall');
      be.textureUtils.setTextureParameters(gl.TEXTURE_2D, tex);
      const aniso = calls.filter(c => c[1] === GL_TEXTURE_MAX_ANISOTROPY_EXT).map(c => c[2]);
      if (want === null) expect(aniso, name).toEqual([]); // nothing set = 1x
      else expect(aniso, `${name} max ${max}`).toEqual([want]);
      expect(anisotropyCapability(s).supported).toBe(max ?? 1);
      if (want !== null) expect(obs.values[String(want)]).toBe(1);
      vi.unstubAllGlobals();
    }
  });
});

describe('U08 QA report (__LL.anisotropy())', () => {
  it('reports backend, requested / supported / effective and a per-role census of the scene textures', () => {
    const g = new THREE.Group();
    const floor = surfaceTex('floor'), wall = surfaceTex('wall'), other = new THREE.Texture();
    other.anisotropy = 4;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({map: floor, normalMap: wall})));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({map: other})));
    const cap = {backend: 'webgl2' as const, supported: 16, supportedSource: 'EXT_texture_filter_anisotropic' as const, software: true, cap: 1, capReason: 'software'};
    const r = anisotropyReport(cap, g, {api: 'texParameterf', values: {1: 3}}, [decayDetailTexture()]);
    expect(r).toMatchObject({requested: 16, supported: 16, effective: 1, software: true});
    expect(r.roles.floor).toMatchObject({textures: 1, requested: {16: 1}, effective: {1: 1}});
    expect(r.roles.wall.textures).toBe(1);
    expect(r.roles.detail.textures).toBe(1);
    expect(r.roles.other).toMatchObject({textures: 1, requested: {4: 1}});
    expect(r.note).toMatch(/not native-GPU/);
    const hw = anisotropyReport({...cap, software: false, cap: 16}, g, null);
    expect(hw.effective).toBe(16);
    expect(hw.roles.floor.effective).toEqual({16: 1});
  });

  it('requestMaterialAnisotropy covers every surface map slot of single and array materials', () => {
    const m = new THREE.MeshStandardMaterial({map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture(), metalnessMap: new THREE.Texture(), aoMap: new THREE.Texture()});
    const got = requestMaterialAnisotropy([m, new THREE.MeshBasicMaterial({map: new THREE.Texture()})], 'ceiling');
    expect(got.length).toBe(6);
    for (const t of got) { expect(t.anisotropy).toBe(16); expect(t.userData.anisotropyRole).toBe('ceiling'); }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Procedural mall finishes (world/mallSurfaces.ts via world/proceduralAa.ts): anisotropic line anti-aliasing

describe('U08 procedural mall floors: lines filtered per axis by coverage (the procedural 16x), not one isotropic fade', () => {
  it('measured line contrast (tile grout 4 mm half-width, 0.30 m tiles; eye 1.62 m, vFOV 75, 1080 px): along-view lines stay crisp', async () => {
    const {floorFootprint, lineAACpu, oldJointCpu} = await import('../src/world/proceduralAa');
    const w = 0.004, S = 0.3;
    const row = (d: number) => {
      const f = floorFootprint(d);
      const oldPx = Math.max(f.along, f.across); // max(fwidth(x), fwidth(z)) facing straight along z
      return {d, old: oldJointCpu(0, w, oldPx, 0.01, 0.03), alongView: lineAACpu(0, w, f.across, S), acrossView: lineAACpu(0, w, f.along, S)};
    };
    const r3 = row(3), r5 = row(5), r8 = row(8), r12 = row(12);
    // before: every grout line (both directions) half gone by ~4.5 m and gone by ~6 m ("muddy at a short distance")
    expect(r5.old).toBeLessThan(0.3);
    expect(r8.old).toBe(0);
    // after: the lines running ALONG the view keep near-full contrast far beyond (their own footprint is the small across one)
    expect(r5.alongView).toBeGreaterThan(0.8); // a 6.4 mm line in a 7.5 mm pixel
    expect(r8.alongView).toBeGreaterThan(0.5);
    expect(r12.alongView).toBeGreaterThan(0.3);
    // cross-view lines are box-filtered: a faint line of their real ink instead of an aliased / vanished one
    expect(r3.acrossView).toBeGreaterThan(0.5);
    expect(r8.acrossView).toBeGreaterThan(0.05);
    expect(r8.acrossView).toBeLessThan(0.3);
    // never brighter than the line itself; far footprints settle to the average density (1.6 w / S), no moire
    for (const d of [1, 2, 4, 6, 10, 20, 40]) { const q = row(d); for (const v of [q.alongView, q.acrossView]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
    expect(lineAACpu(0, w, 0.5, S)).toBeCloseTo(1.6 * w / S, 6);
    expect(lineAACpu(0.15, w, 0.5, S)).toBeCloseTo(1.6 * w / S, 6);
    // up close it is the old joint profile (full ink inside 0.6 w, gone beyond w)
    expect(lineAACpu(0, w, 0.0005, S)).toBe(1);
    expect(lineAACpu(0.0045, w, 0.0005, S)).toBe(0);
  });

  it('the mall surface graphs build on WGSL / GLSL with every derivative taken before the pattern If chain (WGSL uniformity)', async () => {
    const {buildBoth} = await import('./helpers/tslShaders');
    const {MALL_FINISH_ATTR, mallSurfaceMaterial} = await import('../src/world/mallSurfaces');
    const geo = () => { const g = new THREE.PlaneGeometry(1, 1); g.setAttribute(MALL_FINISH_ATTR, new THREE.Float32BufferAttribute(new Float32Array(4).fill(3), 1)); return g; };
    for (const k of ['wall', 'floor', 'ceiling'] as const) {
      const wgsl = buildBoth(new THREE.Mesh(geo(), mallSurfaceMaterial(k)), {lights: [new THREE.SpotLight(0xffffff, 1)]});
      for (const sh of wgsl) expect(sh.errors, `${k} ${sh.backend}`).toEqual([]);
      const frag = wgsl.find(s => s.backend === 'wgsl')!.fragment;
      const lines = frag.split('\n').filter(l => /\b(fwidth|dpdx|dpdy)\s*\(/.test(l));
      expect(lines.filter(l => /fwidth/.test(l)).length, k).toBeGreaterThanOrEqual(2); // per-axis footprints (+ the ring radius on floors)
      // every derivative is a top-level statement of the fragment main (never inside the pattern If chain)
      for (const l of lines) expect(l, `${k}: ${l}`).toMatch(/^\t[\w.]+ = /);
    }
  });
});

describe('U08 game wiring (source guards)', () => {
  it('the build-time pass runs right after buildWorld (before the scene / warm-up sees the level); the observer after the software cap', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    // (task studio-perf-ao-train-continuity-20261110-022206-01, lane BUILD: Game.buildSectionSteps delegates to the stepped world builder)
    expect(src).toMatch(/this\.world = yield\* buildWorldSteps\([^\n]*\n\s*requestArchitectureAnisotropy\(this\.world\.group\);[^\n]*\n\s*this\.scene\.add\(this\.world\.group\);/);
    expect(src).toMatch(/this\.softwareGl = adaptToSoftwareGl\(this\.renderer\);[^\n]*\n\s*observeBackendAnisotropy\(this\.renderer\.backend\);/);
    const qa = fs.readFileSync(new URL('../src/qa.ts', import.meta.url), 'utf8');
    expect(qa).toMatch(/anisotropy: \(\) => anisotropyReport\(anisotropyCapability\(game\.softwareGl\)/);
  });
});
