// Iteration 13 (CORE): renderer backend selection / initialization / indicator (render/backend.ts).
// The renderer here is three r186's real WebGPURenderer, initialized in Node against a MOCKED navigator.gpu (adapter +
// device objects) or a Proxy WebGL 2 context, so backend selection, the WebGPU -> WebGL 2 fallback and the reported
// backend are read from the actual initialized backend object (never from navigator.gpu).
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  backendLabel, backendTag, createGameRenderer, describeBackend, fallbackReason, installBackendIndicator, maxTexture3DSize, recordGpuError,
  renderStats, rendererRequest, watchDevice, type GpuInfo,
} from '../src/render/backend';

const ARRAY_PARAMS = new Set([0x0ba2, 0x0c10, 0x0c22, 0x0b73]);
/** Enough of a WebGL 2 context for three's WebGLBackend.init (every method exists; constants are distinct numbers). */
function proxyGl(renderer = 'llvmpipe (LLVM 19.1.7, 256 bits)'): WebGL2RenderingContext {
  const gl: WebGL2RenderingContext = new Proxy({} as WebGL2RenderingContext, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return 0x1000 + (k.length * 7919 + k.charCodeAt(0) * 31 + k.charCodeAt(k.length - 1)) % 60000;
      if (k === 'getParameter') return (p: number) => (ARRAY_PARAMS.has(p) ? new Int32Array([0, 0, 300, 150]) : p === gl.RENDERER ? renderer : p === gl.MAX_3D_TEXTURE_SIZE ? 2048 : 16);
      if (k === 'getSupportedExtensions') return () => [];
      if (k === 'getExtension') return () => null;
      if (k === 'getContextAttributes') return () => ({antialias: true});
      return () => ({});
    },
  });
  return gl;
}

function fakeCanvas(gl: WebGL2RenderingContext | null = proxyGl()) {
  return {width: 300, height: 150, style: {}, addEventListener() {}, removeEventListener() {},
    getContext: (k: string) => (k === 'webgl2' ? gl : k === 'webgpu' ? {configure() {}, unconfigure() {}, getCurrentTexture: () => ({})} : null)} as unknown as HTMLCanvasElement;
}

interface FakeDevice { features: Set<string>; limits: {maxTextureDimension3D: number}; lost: Promise<unknown>; adapterInfo?: Record<string, unknown>; [k: string]: unknown }
function fakeGpu(o: {adapter?: boolean; info?: Record<string, unknown>; deviceFails?: boolean} = {}) {
  let lose: (info: unknown) => void = () => {};
  const device: FakeDevice = {
    features: new Set(['core-features-and-limits']), limits: {maxTextureDimension3D: 2048}, lost: new Promise(r => { lose = r; }),
    adapterInfo: o.info ?? {vendor: 'testvendor', architecture: 'testarch', device: '', description: 'Mock GPU', isFallbackAdapter: false},
    createTexture: () => ({createView: () => ({}), destroy() {}}), createSampler: () => ({}), createBuffer: () => ({}), queue: {submit() {}, writeBuffer() {}},
  };
  const adapter = {features: new Set<string>(), requestDevice: async () => { if (o.deviceFails) throw new Error('device request denied'); return device; }};
  return {gpu: {requestAdapter: async () => (o.adapter === false ? null : adapter), getPreferredCanvasFormat: () => 'bgra8unorm'}, device, lose: (info: unknown) => lose(info)};
}

function stubBrowser(nav: Record<string, unknown>) {
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // three's "WebGPU is not available, running under WebGL2" (expected)
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** createGameRenderer + init + describeBackend: what Game.initRenderer does. */
async function boot(search: string, nav: Record<string, unknown>, canvas = fakeCanvas()) {
  stubBrowser(nav);
  const req = rendererRequest(search, nav as {gpu?: unknown}, true);
  const g = createGameRenderer(canvas, req);
  await g.renderer.init();
  return {...g, gpu: describeBackend(g.renderer.backend as never, req, g.fallbackError())};
}

describe('renderer request', () => {
  it('?renderer=webgl2 forces the fallback; otherwise WebGPU first; navigator.gpu presence is recorded', () => {
    expect(rendererRequest('?renderer=webgl2', {gpu: {}}, true)).toEqual({requested: 'webgl2', forceWebGL: true, webgpuApi: true, secure: true});
    expect(rendererRequest('?qa=1&seed=AB', {gpu: {}}, true)).toMatchObject({requested: 'auto', forceWebGL: false, webgpuApi: true});
    expect(rendererRequest('', {}, true).webgpuApi).toBe(false);
    expect(rendererRequest('?renderer=webgpu', undefined, false)).toMatchObject({forceWebGL: false, webgpuApi: false, secure: false});
  });

  it('fallback reasons: forced, no API (secure / insecure), no adapter, device failure', () => {
    const req = (o: Partial<ReturnType<typeof rendererRequest>>) => ({requested: 'auto' as const, forceWebGL: false, webgpuApi: true, secure: true, ...o});
    expect(fallbackReason(req({forceWebGL: true}), null)).toBe('forced by ?renderer=webgl2');
    expect(fallbackReason(req({webgpuApi: false}), new TypeError('x'))).toMatch(/no navigator\.gpu/);
    expect(fallbackReason(req({webgpuApi: false, secure: false}), null)).toMatch(/secure context/);
    expect(fallbackReason(req({}), new Error('THREE.WebGPUBackend: Unable to create WebGPU adapter.'))).toMatch(/no WebGPU adapter/);
    expect(fallbackReason(req({}), new Error('device request denied'))).toMatch(/device initialization failed \(device request denied\)/);
  });
});

describe('backend selection on the real WebGPURenderer (mocked navigator.gpu / GL)', () => {
  it('WebGPU adapter + device: the WebGPU backend initializes and is reported with its adapter info', async () => {
    const f = fakeGpu();
    const {renderer, gpu} = await boot('', {gpu: f.gpu});
    expect((renderer.backend as {isWebGPUBackend?: boolean}).isWebGPUBackend).toBe(true);
    expect((renderer.backend as {device?: unknown}).device).toBe(f.device);
    expect(gpu).toMatchObject({backend: 'webgpu', reason: null, requested: 'auto', webgpuApi: true, glRenderer: null, compatibilityMode: false, label: 'Renderer: WebGPU'});
    expect(gpu.adapter).toEqual({vendor: 'testvendor', architecture: 'testarch', device: '', description: 'Mock GPU', isFallbackAdapter: false});
    expect(maxTexture3DSize(renderer.backend as never)).toBe(2048);
  });

  it('a software (fallback) WebGPU adapter is still WebGPU, but labelled as such', async () => {
    const {gpu} = await boot('', {gpu: fakeGpu({info: {vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader', isFallbackAdapter: true}}).gpu});
    expect(gpu.backend).toBe('webgpu');
    expect(gpu.adapter?.isFallbackAdapter).toBe(true);
    expect(gpu.label).toBe('Renderer: WebGPU (software fallback adapter)');
  });

  it('no navigator.gpu: the SAME renderer falls back to its WebGL 2 backend; reported as webgl2-fallback with the reason', async () => {
    const {renderer, gpu, fallbackError} = await boot('?qa=1', {});
    expect((renderer.backend as {isWebGLBackend?: boolean}).isWebGLBackend).toBe(true);
    expect((renderer.backend as {isWebGPUBackend?: boolean}).isWebGPUBackend).toBeUndefined();
    expect(fallbackError()).toBeInstanceOf(TypeError); // navigator.gpu.requestAdapter on undefined, captured from three's fallback hook
    expect(gpu).toMatchObject({backend: 'webgl2-fallback', adapter: null, webgpuApi: false, glRenderer: 'llvmpipe (LLVM 19.1.7, 256 bits)'});
    expect(gpu.label).toBe('Renderer: WebGL2 (fallback — WebGPU unavailable: this browser exposes no navigator.gpu)');
    expect(maxTexture3DSize(renderer.backend as never)).toBe(2048);
  });

  it('navigator.gpu without an adapter, or a failing device request: WebGL 2 fallback with that reason', async () => {
    const a = await boot('', {gpu: fakeGpu({adapter: false}).gpu});
    expect(a.gpu.backend).toBe('webgl2-fallback');
    expect(a.gpu.webgpuApi).toBe(true); // the API exists — it is NOT proof of WebGPU
    expect(a.gpu.reason).toBe('WebGPU unavailable: no WebGPU adapter (requestAdapter returned null)');
    vi.unstubAllGlobals();
    const d = await boot('', {gpu: fakeGpu({deviceFails: true}).gpu});
    expect(d.gpu.backend).toBe('webgl2-fallback');
    expect(d.gpu.reason).toMatch(/device initialization failed \(device request denied\)/);
  });

  it('?renderer=webgl2 forces the WebGL 2 backend even with a working WebGPU adapter', async () => {
    const f = fakeGpu();
    let asked = 0;
    const gpu0 = {...f.gpu, requestAdapter: async () => { asked++; return f.gpu.requestAdapter(); }};
    const {renderer, gpu} = await boot('?renderer=webgl2', {gpu: gpu0});
    expect((renderer.backend as {isWebGLBackend?: boolean}).isWebGLBackend).toBe(true);
    expect(asked).toBe(0);
    expect(gpu).toMatchObject({backend: 'webgl2-fallback', requested: 'webgl2', reason: 'forced by ?renderer=webgl2', label: 'Renderer: WebGL2 (fallback — forced by ?renderer=webgl2)'});
  });

  it('renderer options: antialias, opaque canvas, high-performance', async () => {
    const {renderer} = await boot('', {gpu: fakeGpu().gpu});
    expect(renderer.samples).toBe(4);
    expect(renderer.alpha).toBe(false);
    expect((renderer.backend as unknown as {parameters: {powerPreference: string}}).parameters.powerPreference).toBe('high-performance');
  });

  it('software WebGPU adapter: the real WebGPUBackend sampler path creates samplers with anisotropy 1 (hardware: as authored)', async () => {
    const {adaptToSoftwareGl} = await import('../src/render/softwareGl');
    const THREE = await import('three');
    for (const [info, want] of [[{vendor: 'google', architecture: 'swiftshader', description: 'SwiftShader Device', isFallbackAdapter: true}, 1], [{vendor: 'nvidia', description: 'RTX', isFallbackAdapter: false}, 8]] as const) {
      const f = fakeGpu({info});
      const made: {maxAnisotropy?: number}[] = [];
      f.device.createSampler = (d: {maxAnisotropy?: number}) => { made.push({maxAnisotropy: d.maxAnisotropy}); return {}; };
      const {renderer} = await boot('', {gpu: f.gpu});
      const sw = adaptToSoftwareGl(renderer);
      expect(sw.software).toBe(want === 1);
      const tex = new THREE.Texture();
      tex.anisotropy = 8; // linear mipmapped (the default filters): anisotropy applies
      (renderer.backend as unknown as {updateSampler(b: unknown): unknown}).updateSampler({texture: tex, textureNode: {isSampleCompare: () => false}});
      expect(made.at(-1)?.maxAnisotropy, JSON.stringify(info)).toBe(want);
      expect(tex.anisotropy).toBe(8);
      vi.unstubAllGlobals();
    }
  });

  it('describeBackend refuses a backend that is neither WebGPU nor WebGL 2', () => {
    expect(() => describeBackend({}, rendererRequest('', {}, true), null)).toThrow(/neither WebGPU nor WebGL 2/);
  });
});

describe('device loss / GPU errors are surfaced, not swallowed', () => {
  it('a lost WebGPU device marks the renderer lost, records the message and calls the overlay hook once', async () => {
    const f = fakeGpu();
    const {renderer, gpu} = await boot('', {gpu: f.gpu});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lost: string[] = [];
    watchDevice(renderer, gpu, {onLost: t => lost.push(t)});
    f.lose({reason: 'unknown', message: 'GPU process crashed'});
    await new Promise(r => setTimeout(r, 0));
    expect(lost).toEqual(['WebGPU device lost: GPU process crashed (unknown)']);
    expect(gpu.deviceLost).toBe(lost[0]);
    expect((renderer as unknown as {_isDeviceLost: boolean})._isDeviceLost).toBe(true); // three stops rendering
    expect(err).toHaveBeenCalled(); // three's own log still runs
    (renderer as unknown as {onDeviceLost: (i: unknown) => void}).onDeviceLost({api: 'WebGPU', message: 'again'});
    expect(lost.length).toBe(1);
    // uncaptured GPU errors are recorded (bounded) and still logged
    (renderer as unknown as {onError: (i: unknown) => void}).onError({api: 'WebGPU', type: 'GPUValidationError', message: 'bad pipeline'});
    expect(gpu.errors.at(-1)).toBe('WebGPU GPUValidationError: bad pipeline');
    for (let i = 0; i < 40; i++) recordGpuError(gpu, `e${i}`);
    expect(gpu.errors.length).toBe(24);
    expect(gpu.errors.at(-1)).toBe('e39');
  });

  it('WebGL 2 fallback: shader compile errors are logged and recorded', async () => {
    const {renderer, gpu} = await boot('', {});
    watchDevice(renderer, gpu, {onLost: () => {}});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const gl = {getProgramInfoLog: () => 'link failed', getShaderInfoLog: () => 'ERROR: 0:12 bad'} as unknown as WebGL2RenderingContext;
    (renderer as unknown as {debug: {onShaderError: (...a: unknown[]) => void}}).debug.onShaderError(gl, {}, {}, {});
    expect(err).toHaveBeenCalled();
    expect(gpu.errors.at(-1)).toMatch(/^WebGL2 program error: link failed ERROR: 0:12 bad/);
  });
});

describe('indicator text + DOM', () => {
  const base: GpuInfo = {backend: 'webgpu', adapter: null, reason: null, requested: 'auto', webgpuApi: true, glRenderer: null, compatibilityMode: false, label: '', deviceLost: null, errors: []};
  it('labels never call the fallback WebGPU', () => {
    expect(backendLabel(base)).toBe('Renderer: WebGPU');
    expect(backendTag(base)).toBe('WebGPU');
    const fb = {...base, backend: 'webgl2-fallback' as const, reason: 'WebGPU unavailable: no WebGPU adapter (requestAdapter returned null)'};
    expect(backendLabel(fb)).toBe('Renderer: WebGL2 (fallback — WebGPU unavailable: no WebGPU adapter (requestAdapter returned null))');
    expect(backendLabel(fb)).not.toMatch(/Renderer: WebGPU/);
    expect(backendTag(fb)).toBe('WebGL2 fallback');
  });

  /** Minimal DOM for installBackendIndicator. */
  function fakeDoc(ids: string[]) {
    class El {
      id = ''; className = ''; textContent = ''; title = ''; dataset: Record<string, string> = {}; children: El[] = []; parentElement: El | null = null;
      appendChild(c: El) { c.parentElement = this; this.children.push(c); return c; }
      querySelector(sel: string) { return sel === ':scope > .gpu-badge' ? this.children.find(c => c.className.split(' ').includes('gpu-badge')) ?? null : null; }
    }
    const els = new Map<string, El>(ids.map(id => { const e = new El(); e.id = id; return [id, e]; }));
    const head = new El();
    const doc = {
      head,
      createElement: () => new El(),
      getElementById: (id: string) => els.get(id) ?? [...els.values()].flatMap(e => e.children).find(c => c.id === id) ?? (head.children.find(c => c.id === id) ?? null),
    };
    return {doc: doc as unknown as Document, els};
  }

  it('title + pause badges and the HUD tag show the actual backend (idempotent; device loss updates them)', () => {
    const {doc, els} = fakeDoc(['title', 'pause', 'hud']);
    const g: GpuInfo = {...base, backend: 'webgl2-fallback', reason: 'WebGPU unavailable: this browser exposes no navigator.gpu', glRenderer: 'llvmpipe'};
    g.label = backendLabel(g);
    installBackendIndicator(doc, g);
    installBackendIndicator(doc, g);
    for (const id of ['title', 'pause']) {
      const badges = els.get(id)!.children.filter(c => c.className.includes('gpu-badge'));
      expect(badges.length, id).toBe(1);
      expect(badges[0].textContent).toBe('Renderer: WebGL2 (fallback — WebGPU unavailable: this browser exposes no navigator.gpu)');
      expect(badges[0].className).toBe('gpu-badge fallback');
      expect(badges[0].dataset.backend).toBe('webgl2-fallback');
      expect(badges[0].title).toBe('llvmpipe');
    }
    const tag = els.get('hud')!.children.find(c => c.id === 'gpu-tag')!;
    expect(tag.textContent).toBe('WebGL2 fallback');
    g.deviceLost = 'WebGL device lost: context lost';
    installBackendIndicator(doc, g);
    expect(els.get('title')!.children.find(c => c.className.includes('gpu-badge'))!.textContent).toMatch(/DEVICE LOST$/);
    expect(els.get('title')!.children.find(c => c.className.includes('gpu-badge'))!.className).toBe('gpu-badge lost');
  });
});

describe('renderer.info in the QA shape', () => {
  it('`calls` keeps meaning draw calls this frame (r186 drawCalls; render() count separate)', () => {
    expect(renderStats({render: {calls: 812, frameCalls: 3, drawCalls: 140, triangles: 9000, points: 4, lines: 2}}))
      .toEqual({calls: 140, drawCalls: 140, triangles: 9000, points: 4, lines: 2, passes: 3, renderCallsTotal: 812});
  });
});
