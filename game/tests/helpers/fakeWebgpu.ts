// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU): three r186's REAL WebGPURenderer + WebGPUBackend (WGSL node
// builder, render objects, bindings, pipelines, command encoding) running in Node against a NO-OP GPUDevice: every device / queue /
// encoder / pass method exists and returns an inert object (promises resolve at once). What this measures is three's own JavaScript
// on the WebGPU path — node builds, render-object creation, binding / uniform refresh, draw encoding — the CPU work the user's
// "render submit" shows. It does NOT measure the browser's / driver's work behind the API calls (WGSL -> native compile, pipeline
// creation, uploads): those are counted (`calls`), never timed.
import {vi} from 'vitest';

/** API calls per method name since the last reset (createRenderPipeline, createBindGroup, createBuffer, writeBuffer, draw, …). */
export const gpuCalls = new Map<string, number>();
export const resetGpuCalls = () => gpuCalls.clear();
const count = (k: string) => gpuCalls.set(k, (gpuCalls.get(k) ?? 0) + 1);

const PROMISE_METHODS = new Set(['createRenderPipelineAsync', 'createComputePipelineAsync', 'popErrorScope', 'getCompilationInfo', 'mapAsync', 'onSubmittedWorkDone', 'requestAdapterInfo']);

/** An inert GPU object: any property is another inert object (cached), any call returns one; `then` is undefined (never thenable). */
function inert(name: string, extra: Record<string | symbol, unknown> = {}): unknown {
  const cache = new Map<string | symbol, unknown>();
  const target = function () { /* callable */ } as unknown as Record<string | symbol, unknown>;
  return new Proxy(target, {
    get(_t, k) {
      if (k in extra) return extra[k];
      if (typeof k === 'symbol' || k === 'then' || k === 'toJSON') return undefined;
      if (k === 'label') return name;
      let v = cache.get(k);
      if (v === undefined) {
        v = (...args: unknown[]) => {
          count(k);
          if (k === 'getMappedRange') return new ArrayBuffer(Math.max(4, Number((extra.size as number) ?? 4)));
          if (k === 'createBuffer') { const d = args[0] as {size?: number} | undefined; return inert('buffer', {size: d?.size ?? 4, destroy() {}}); }
          if (k === 'createTexture') {
            const d = (args[0] ?? {}) as {size?: number[] | {width?: number; height?: number; depthOrArrayLayers?: number}; format?: string; mipLevelCount?: number; sampleCount?: number; dimension?: string; usage?: number; textureBindingViewDimension?: string};
            const sz = Array.isArray(d.size) ? {width: d.size[0], height: d.size[1] ?? 1, depthOrArrayLayers: d.size[2] ?? 1} : {width: d.size?.width ?? 1, height: d.size?.height ?? 1, depthOrArrayLayers: d.size?.depthOrArrayLayers ?? 1};
            return inert('texture', {...sz, format: d.format ?? 'rgba8unorm', mipLevelCount: d.mipLevelCount ?? 1, sampleCount: d.sampleCount ?? 1, dimension: d.dimension ?? '2d', usage: d.usage ?? 0,
              textureBindingViewDimension: d.textureBindingViewDimension, destroy() {}, createView: () => inert('view')});
          }
          const o = inert(k);
          return PROMISE_METHODS.has(k) ? Promise.resolve(k === 'popErrorScope' ? null : k === 'getCompilationInfo' ? {messages: []} : o) : o;
        };
        cache.set(k, v);
      }
      return v;
    },
    set(_t, k, v) { cache.set(k, v); return true; },
  });
}

export function fakeDevice(): Record<string, unknown> {
  const limits: Record<string, number> = new Proxy({} as Record<string, number>, {get: (_t, k) => (typeof k === 'string' ? (k.startsWith('max') ? (k.includes('Size') ? 1 << 28 : 1 << 16) : k.startsWith('min') ? 256 : 0) : undefined)});
  return inert('device', {features: new Set(['core-features-and-limits', 'float32-filterable', 'depth32float-stencil8', 'rg11b10ufloat-renderable']), limits, lost: new Promise(() => {}),
    onuncapturederror: null, queue: inert('queue', {writeBuffer: () => count('writeBuffer'), writeTexture: () => count('writeTexture'), copyExternalImageToTexture: () => count('copyExternalImageToTexture'), submit: () => count('submit'), onSubmittedWorkDone: () => Promise.resolve()})}) as Record<string, unknown>;
}

/** Stubs the browser globals three's WebGPU backend touches; returns the canvas to create the renderer with. */
export function stubWebgpuGlobals(): HTMLCanvasElement {
  const device = fakeDevice();
  const adapter = {features: new Set(['core-features-and-limits']), limits: {}, info: {vendor: 'node', architecture: 'noop', description: 'no-op device'}, requestDevice: async () => device};
  vi.stubGlobal('navigator', {gpu: {requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'bgra8unorm', wgslLanguageFeatures: new Set()}, userAgent: 'node'});
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('requestAnimationFrame', () => 0); // (three's animation loop never ticks: frames are driven by the test)
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('scheduler', {yield: () => new Promise<void>(r => setImmediate(r))}); // three's yieldToMain (compileAsync)
  vi.stubGlobal('ProgressEvent', class { constructor(readonly type: string, o: {loaded?: number; total?: number} = {}) { Object.assign(this, o); } }); // (compileAsync progress)
  for (const g of ['GPURenderBundleEncoder', 'GPUTexture', 'GPUBuffer', 'GPUCanvasContext', 'GPUDevice', 'GPUAdapter', 'ImageBitmap']) vi.stubGlobal(g, class {});
  const flags = new Proxy({}, {get: (_t, k) => (typeof k === 'string' ? 1 << (k.length % 16) : undefined)});
  for (const g of ['GPUBufferUsage', 'GPUTextureUsage', 'GPUMapMode', 'GPUShaderStage', 'GPUColorWrite']) vi.stubGlobal(g, flags);
  const ctx = {configure() {}, unconfigure() {}, getCurrentTexture: () => inert('canvasTexture', {width: 1280, height: 720, format: 'bgra8unorm', createView: () => inert('canvasView')})};
  return {width: 1280, height: 720, style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getContext: (k: string) => (k === 'webgpu' ? ctx : k === 'webgl2' ? fakeGl() : null)} as unknown as HTMLCanvasElement;
}

const GL_ARRAY_PARAMS = new Set([0x0ba2, 0x0c10, 0x0c22, 0x0b73]);
/** An inert WebGL 2 context (every method exists; constants are distinct numbers) for three's WebGL 2 backend (`forceWebGL`). */
function fakeGl(): WebGL2RenderingContext {
  const gl: WebGL2RenderingContext = new Proxy({} as WebGL2RenderingContext, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return 0x1000 + (k.length * 7919 + k.charCodeAt(0) * 31 + k.charCodeAt(k.length - 1)) % 60000;
      if (k === 'getParameter') return (p: number) => (GL_ARRAY_PARAMS.has(p) ? new Int32Array([0, 0, 1280, 720]) : p === gl.MAX_3D_TEXTURE_SIZE ? 2048 : 16);
      if (k === 'getSupportedExtensions') return () => [];
      if (k === 'getExtension') return () => null;
      if (k === 'getContextAttributes') return () => ({antialias: true});
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return () => true;
      if (k === 'getShaderInfoLog' || k === 'getProgramInfoLog') return () => '';
      if (k === 'checkFramebufferStatus') return () => gl.FRAMEBUFFER_COMPLETE;
      if (k === 'isContextLost') return () => false;
      return () => ({});
    },
  });
  return gl;
}
