// Task studio-death-retry-render-fix-20261114-044607-01: a VALIDATING no-op WebGPU device for three r186's real WebGPURenderer in Node.
// tests/helpers/fakeWebgpu.ts answers every call with an inert object; this one keeps the state WebGPU itself validates at submit time,
// so a test can see what a real browser would silently drop:
//  - GPU textures / buffers / query sets and whether they were destroyed (a command buffer that references a destroyed one — as a render
//    attachment, a bind-group entry, a vertex / index buffer, a copy source / destination — is rejected WHOLE at queue.submit: nothing in
//    it runs, so a pass's target keeps its previous contents);
//  - each render pass's attachment state (colour formats, depth-stencil format, sample count) against the pipeline set in it (a mismatch
//    invalidates the encoder; again the whole submit is dropped);
//  - queue.writeBuffer / writeTexture / copyExternalImageToTexture into a destroyed resource.
// Nothing is executed or rasterised: the device only records which submits would have been dropped and why (with three's labels).
import {vi} from 'vitest';

let ids = 0;
interface Res { readonly kind: string; readonly id: number; label: string; destroyed: boolean; destroyedAt?: string }
/** Record where resources are destroyed (a short stack) — set by a test that wants to attribute a dropped submit. */
export const trace = {destroyStacks: false, phase: ''};
const stackHere = () => (trace.destroyStacks ? (new Error().stack ?? '').split('\n').slice(2, 14).map(l => l.trim()).join(' <- ') : '');

export interface GpuIssue { kind: 'destroyed-in-submit' | 'attachment-mismatch' | 'write-destroyed' | 'encoder'; detail: string; label: string }

export class GpuLog {
  readonly issues: GpuIssue[] = [];
  submits = 0;
  dropped = 0;
  /** Labels of the command encoders of dropped submits, in order. */
  readonly droppedLabels: string[] = [];
  /** Called for every submitted command buffer (dropped or not): its encoder label and whether it was dropped. */
  onSubmit: ((label: string, dropped: boolean, why: string[]) => void) | null = null;
  reset(): void { this.issues.length = 0; this.submits = 0; this.dropped = 0; this.droppedLabels.length = 0; }
}

class FakeBuffer implements Res {
  readonly kind = 'buffer'; readonly id = ids++; destroyed = false; mapState = 'unmapped';
  readonly size: number; readonly usage: number; label: string;
  private readonly data: ArrayBuffer;
  constructor(d: {size?: number; usage?: number; label?: string; mappedAtCreation?: boolean}) {
    this.size = d.size ?? 4; this.usage = d.usage ?? 0; this.label = d.label ?? '';
    this.data = new ArrayBuffer(Math.max(4, Math.ceil(this.size / 4) * 4));
  }
  destroy(): void { this.destroyed = true; this.destroyedAt = stackHere(); }
  destroyedAt?: string;
  mapAsync(): Promise<void> { return Promise.resolve(); }
  getMappedRange(off = 0, size?: number): ArrayBuffer { return this.data.slice(off, size === undefined ? undefined : off + size); }
  unmap(): void {}
}

class FakeTexture implements Res {
  readonly kind = 'texture'; readonly id = ids++; destroyed = false; label: string; readonly phase = trace.phase;
  readonly width: number; readonly height: number; readonly depthOrArrayLayers: number;
  readonly format: string; readonly mipLevelCount: number; readonly sampleCount: number; readonly dimension: string; readonly usage: number;
  constructor(d: {size?: number[] | {width?: number; height?: number; depthOrArrayLayers?: number}; format?: string; mipLevelCount?: number; sampleCount?: number; dimension?: string; usage?: number; label?: string}) {
    const s = Array.isArray(d.size) ? {width: d.size[0], height: d.size[1] ?? 1, depthOrArrayLayers: d.size[2] ?? 1} : {width: d.size?.width ?? 1, height: d.size?.height ?? 1, depthOrArrayLayers: d.size?.depthOrArrayLayers ?? 1};
    this.width = s.width; this.height = s.height; this.depthOrArrayLayers = s.depthOrArrayLayers;
    this.format = d.format ?? 'rgba8unorm'; this.mipLevelCount = d.mipLevelCount ?? 1; this.sampleCount = d.sampleCount ?? 1;
    this.dimension = d.dimension ?? '2d'; this.usage = d.usage ?? 0; this.label = d.label ?? '';
  }
  destroy(): void { this.destroyed = true; this.destroyedAt = stackHere(); }
  destroyedAt?: string;
  createView(d: {format?: string; label?: string} = {}): FakeView { return new FakeView(this, d.format ?? this.format, d.label ?? ''); }
}

class FakeView { readonly kind = 'view'; constructor(readonly texture: FakeTexture, readonly format: string, readonly label: string) {} }

class FakeQuerySet implements Res {
  readonly kind = 'querySet'; readonly id = ids++; destroyed = false; label: string; readonly count: number; readonly type: string;
  constructor(d: {label?: string; count?: number; type?: string}) { this.label = d.label ?? ''; this.count = d.count ?? 1; this.type = d.type ?? 'occlusion'; }
  destroy(): void { this.destroyed = true; }
}

interface PipelineState { colorFormats: (string | null)[]; depthFormat: string | null; sampleCount: number }
class FakeRenderPipeline { readonly kind = 'renderPipeline'; constructor(readonly label: string, readonly state: PipelineState) {} getBindGroupLayout(): object { return {kind: 'bindGroupLayout'}; } }
class FakeComputePipeline { readonly kind = 'computePipeline'; constructor(readonly label: string) {} getBindGroupLayout(): object { return {kind: 'bindGroupLayout'}; } }

class FakeBindGroup {
  readonly kind = 'bindGroup';
  readonly refs: Res[] = [];
  readonly phase = trace.phase;
  constructor(readonly label: string, entries: {resource?: unknown}[]) {
    for (const e of entries ?? []) {
      const r = e.resource as {kind?: string; texture?: FakeTexture; buffer?: FakeBuffer} | undefined;
      if (!r) continue;
      if (r.kind === 'view' && r.texture) this.refs.push(r.texture);
      else if (r.kind === 'texture') this.refs.push(r as unknown as FakeTexture);
      else if (r.kind === 'buffer') this.refs.push(r as unknown as FakeBuffer);
      else if (r.buffer && r.buffer.kind === 'buffer') this.refs.push(r.buffer);
    }
  }
}

const pipelineState = (d: {fragment?: {targets?: ({format?: string} | null)[]}; depthStencil?: {format?: string}; multisample?: {count?: number}}): PipelineState =>
  ({colorFormats: (d.fragment?.targets ?? []).map(t => t?.format ?? null), depthFormat: d.depthStencil?.format ?? null, sampleCount: d.multisample?.count ?? 1});

const sameState = (a: PipelineState, b: PipelineState): boolean =>
  a.sampleCount === b.sampleCount && a.depthFormat === b.depthFormat && a.colorFormats.length === b.colorFormats.length && a.colorFormats.every((f, i) => f === b.colorFormats[i]);

const showState = (s: PipelineState) => `[${s.colorFormats.join(',')}|${s.depthFormat ?? '-'}|x${s.sampleCount}]`;

/** Shared bookkeeping of one command encoder / render bundle encoder: referenced resources and encoder-level errors. */
class Recorder {
  readonly refs = new Set<Res>();
  /** Where each resource was first referenced: pass / pipeline / bind group (for diagnostics). */
  readonly ctx = new Map<Res, string>();
  where = '';
  readonly errors: string[] = [];
  /** Draw calls recorded (diagnostics). */
  draws = 0;
  add(r: unknown, what = ''): void { if (r && typeof r === 'object' && 'destroyed' in (r as object)) { this.refs.add(r as Res); if (!this.ctx.has(r as Res)) this.ctx.set(r as Res, `${what} ${this.where}`); } }
  addGroup(bg: unknown): void { const g = bg as FakeBindGroup | undefined; if (g?.refs) for (const r of g.refs) this.add(r, `bindGroup "${g.label}" (made in ${g.phase}; refs ${g.refs.map(x => `${x.label || x.kind}#${x.id}`).join(',')})`); }
}

class FakePassEncoder {
  pipeline: FakeRenderPipeline | null = null;
  constructor(protected readonly rec: Recorder, readonly label: string, readonly state: PipelineState | null) { rec.where = `in pass "${label}"`; }
  setPipeline(p: FakeRenderPipeline | FakeComputePipeline): void {
    this.rec.where = `in pass "${this.label}" pipeline "${p.label}"`;
    if (p instanceof FakeRenderPipeline) {
      this.pipeline = p;
      if (this.state && !sameState(p.state, this.state)) this.rec.errors.push(`attachment-mismatch in pass "${this.label}": pipeline "${p.label}" ${showState(p.state)} vs pass ${showState(this.state)}`);
    }
  }
  setBindGroup(_i: number, bg: unknown): void { this.rec.addGroup(bg); }
  setVertexBuffer(s: number, b: unknown): void { this.rec.add(b, `vertex slot ${s}`); }
  setIndexBuffer(b: unknown): void { this.rec.add(b, 'index'); }
  draw(): void { this.rec.draws++; }
  drawIndexed(): void { this.rec.draws++; }
  drawIndirect(b: unknown): void { this.rec.add(b); this.rec.draws++; }
  drawIndexedIndirect(b: unknown): void { this.rec.add(b); this.rec.draws++; }
  dispatchWorkgroups(): void {}
  dispatchWorkgroupsIndirect(b: unknown): void { this.rec.add(b); }
  executeBundles(bundles: {rec?: Recorder; state?: PipelineState; label?: string}[]): void {
    for (const b of bundles ?? []) {
      if (!b?.rec) continue;
      for (const r of b.rec.refs) this.rec.add(r, b.rec.ctx.get(r) ?? `bundle "${b.label}"`);
      this.rec.errors.push(...b.rec.errors);
      if (this.state && b.state && !sameState(b.state, this.state)) this.rec.errors.push(`bundle "${b.label}" ${showState(b.state)} executed in pass "${this.label}" ${showState(this.state)}`);
      this.rec.draws += b.rec.draws;
    }
  }
  setViewport(): void {} setScissorRect(): void {} setBlendConstant(): void {} setStencilReference(): void {}
  beginOcclusionQuery(): void {} endOcclusionQuery(): void {} pushDebugGroup(): void {} popDebugGroup(): void {} insertDebugMarker(): void {}
  writeTimestamp(): void {}
  end(): void {}
}

class FakeBundleEncoder extends FakePassEncoder {
  finish(d: {label?: string} = {}): {kind: string; rec: Recorder; state: PipelineState | null; label: string} { return {kind: 'renderBundle', rec: this.rec, state: this.state, label: d.label ?? this.label}; }
}

class FakeCommandEncoder {
  readonly rec = new Recorder();
  constructor(readonly label: string) {}
  beginRenderPass(d: {label?: string; colorAttachments?: ({view?: FakeView; resolveTarget?: FakeView} | null)[]; depthStencilAttachment?: {view?: FakeView}; occlusionQuerySet?: unknown; timestampWrites?: {querySet?: unknown}}): FakePassEncoder {
    let samples = 0;
    const colorFormats: (string | null)[] = [];
    for (const a of d.colorAttachments ?? []) {
      if (!a?.view) { colorFormats.push(null); continue; }
      this.rec.add(a.view.texture);
      if (a.resolveTarget) this.rec.add(a.resolveTarget.texture);
      colorFormats.push(a.view.format);
      samples = a.view.texture.sampleCount;
    }
    const dv = d.depthStencilAttachment?.view;
    if (dv) { this.rec.add(dv.texture); samples ||= dv.texture.sampleCount; }
    this.rec.add(d.occlusionQuerySet); this.rec.add(d.timestampWrites?.querySet);
    return new FakePassEncoder(this.rec, d.label ?? this.label, {colorFormats, depthFormat: dv?.format ?? null, sampleCount: samples || 1});
  }
  beginComputePass(d: {label?: string} = {}): FakePassEncoder { return new FakePassEncoder(this.rec, d.label ?? this.label, null); }
  copyBufferToBuffer(a: unknown, _o: number, b: unknown): void { this.rec.add(a); this.rec.add(b); }
  copyBufferToTexture(a: {buffer?: unknown}, b: {texture?: unknown}): void { this.rec.add(a?.buffer); this.rec.add(b?.texture); }
  copyTextureToBuffer(a: {texture?: unknown}, b: {buffer?: unknown}): void { this.rec.add(a?.texture); this.rec.add(b?.buffer); }
  copyTextureToTexture(a: {texture?: unknown}, b: {texture?: unknown}): void { this.rec.add(a?.texture); this.rec.add(b?.texture); }
  clearBuffer(b: unknown): void { this.rec.add(b); }
  resolveQuerySet(q: unknown, _f: number, _c: number, b: unknown): void { this.rec.add(q); this.rec.add(b); }
  pushDebugGroup(): void {} popDebugGroup(): void {} insertDebugMarker(): void {} writeTimestamp(): void {}
  finish(d: {label?: string} = {}): {kind: string; rec: Recorder; label: string} { return {kind: 'commandBuffer', rec: this.rec, label: d.label ?? this.label}; }
}

const resName = (r: Res) => `${r.kind} "${r.label || '#' + r.id}"`;

/** A validating device + queue writing into `log`. */
export function validatingDevice(log: GpuLog): Record<string, unknown> {
  const limits: Record<string, number> = new Proxy({} as Record<string, number>, {get: (_t, k) => (typeof k === 'string' ? (k.startsWith('max') ? (k.includes('Size') ? 1 << 28 : 1 << 16) : k.startsWith('min') ? 256 : 0) : undefined)});
  const writeCheck = (what: string, r: Res | undefined) => { if (r?.destroyed) log.issues.push({kind: 'write-destroyed', detail: `${what} into destroyed ${resName(r)}`, label: r.label}); };
  const queue = {
    label: 'queue',
    submit(cbs: {rec?: Recorder; label?: string}[]) {
      for (const cb of cbs ?? []) {
        log.submits++;
        const why: string[] = [];
        if (cb?.rec) {
          for (const e of cb.rec.errors) { why.push(e); log.issues.push({kind: e.startsWith('attachment') || e.startsWith('bundle') ? 'attachment-mismatch' : 'encoder', detail: e, label: cb.label ?? ''}); }
          for (const r of cb.rec.refs) if (r.destroyed) {
            why.push(`destroyed ${resName(r)}`);
            log.issues.push({kind: 'destroyed-in-submit', detail: `${resName(r)} #${r.id} used ${cb.rec.ctx.get(r) ?? ''} (encoder "${cb.label}")${r.destroyedAt ? `; destroyed at ${r.destroyedAt}` : ''}`, label: r.label});
          }
        }
        if (why.length) { log.dropped++; log.droppedLabels.push(cb?.label ?? ''); }
        log.onSubmit?.(cb?.label ?? '', why.length > 0, why);
      }
    },
    writeBuffer(b: FakeBuffer) { writeCheck('writeBuffer', b); },
    writeTexture(d: {texture?: FakeTexture}) { writeCheck('writeTexture', d?.texture); },
    copyExternalImageToTexture(_s: unknown, d: {texture?: FakeTexture}) { writeCheck('copyExternalImageToTexture', d?.texture); },
    onSubmittedWorkDone: () => Promise.resolve(),
  };
  const device: Record<string, unknown> = {
    label: 'validating-device',
    features: new Set(['core-features-and-limits', 'float32-filterable', 'depth32float-stencil8', 'rg11b10ufloat-renderable']),
    limits, lost: new Promise(() => {}), onuncapturederror: null, queue,
    addEventListener() {}, removeEventListener() {},
    createBuffer: (d: ConstructorParameters<typeof FakeBuffer>[0]) => new FakeBuffer(d ?? {}),
    createTexture: (d: ConstructorParameters<typeof FakeTexture>[0]) => new FakeTexture(d ?? {}),
    createSampler: (d: {label?: string} = {}) => ({kind: 'sampler', label: d.label ?? ''}),
    createBindGroupLayout: (d: {label?: string} = {}) => ({kind: 'bindGroupLayout', label: d.label ?? ''}),
    createPipelineLayout: (d: {label?: string} = {}) => ({kind: 'pipelineLayout', label: d.label ?? ''}),
    createBindGroup: (d: {label?: string; entries?: {resource?: unknown}[]}) => new FakeBindGroup(d?.label ?? '', d?.entries ?? []),
    createShaderModule: (d: {label?: string} = {}) => ({kind: 'shaderModule', label: d.label ?? '', getCompilationInfo: () => Promise.resolve({messages: []})}),
    createRenderPipeline: (d: {label?: string}) => new FakeRenderPipeline(d?.label ?? '', pipelineState(d as never)),
    createRenderPipelineAsync: (d: {label?: string}) => Promise.resolve(new FakeRenderPipeline(d?.label ?? '', pipelineState(d as never))),
    createComputePipeline: (d: {label?: string}) => new FakeComputePipeline(d?.label ?? ''),
    createComputePipelineAsync: (d: {label?: string}) => Promise.resolve(new FakeComputePipeline(d?.label ?? '')),
    createCommandEncoder: (d: {label?: string} = {}) => new FakeCommandEncoder(d.label ?? ''),
    createRenderBundleEncoder: (d: {label?: string; colorFormats?: (string | null)[]; depthStencilFormat?: string; sampleCount?: number}) =>
      new FakeBundleEncoder(new Recorder(), d?.label ?? '', {colorFormats: [...(d?.colorFormats ?? [])], depthFormat: d?.depthStencilFormat ?? null, sampleCount: d?.sampleCount ?? 1}),
    createQuerySet: (d: ConstructorParameters<typeof FakeQuerySet>[0]) => new FakeQuerySet(d ?? {}),
    importExternalTexture: () => ({kind: 'externalTexture'}),
    pushErrorScope() {}, popErrorScope: () => Promise.resolve(null),
    destroy() {},
  };
  return device;
}

/** The canvas context: a fresh swap-chain texture per frame (never destroyed). */
function canvasContext(w: () => number, h: () => number) {
  return {
    configure() {}, unconfigure() {},
    getCurrentTexture: () => new FakeTexture({size: [w(), h()], format: 'bgra8unorm', label: 'canvas'}),
  };
}

/**
 * Stubs the browser globals three's WebGPU backend touches (as tests/helpers/fakeWebgpu.ts) with the VALIDATING device; returns the
 * canvas to create the renderer with and the log. `raf` = the requestAnimationFrame to install (default: never ticks).
 */
export function stubValidatingWebgpu(o: {raf?: (cb: FrameRequestCallback) => number; cancelRaf?: (h: number) => void; width?: number; height?: number} = {}): {canvas: HTMLCanvasElement; log: GpuLog} {
  const log = new GpuLog();
  const device = validatingDevice(log);
  const adapter = {features: new Set(['core-features-and-limits']), limits: {}, info: {vendor: 'node', architecture: 'validating', description: 'validating no-op device'}, requestDevice: async () => device};
  vi.stubGlobal('navigator', {gpu: {requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'bgra8unorm', wgslLanguageFeatures: new Set()}, userAgent: 'node'});
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('requestAnimationFrame', o.raf ?? (() => 0));
  vi.stubGlobal('cancelAnimationFrame', o.cancelRaf ?? (() => {}));
  vi.stubGlobal('scheduler', {yield: () => new Promise<void>(r => setImmediate(r))});
  vi.stubGlobal('ProgressEvent', class { constructor(readonly type: string, x: {loaded?: number; total?: number} = {}) { Object.assign(this, x); } });
  for (const g of ['GPURenderBundleEncoder', 'GPUTexture', 'GPUBuffer', 'GPUCanvasContext', 'GPUDevice', 'GPUAdapter', 'ImageBitmap']) vi.stubGlobal(g, class {});
  const flags = new Proxy({}, {get: (_t, k) => (typeof k === 'string' ? 1 << (k.length % 16) : undefined)});
  for (const g of ['GPUBufferUsage', 'GPUTextureUsage', 'GPUMapMode', 'GPUShaderStage', 'GPUColorWrite']) vi.stubGlobal(g, flags);
  const size = {w: o.width ?? 1280, h: o.height ?? 720};
  const ctx = canvasContext(() => size.w, () => size.h);
  const canvas = {
    get width() { return size.w; }, set width(v: number) { size.w = v; },
    get height() { return size.h; }, set height(v: number) { size.h = v; },
    clientWidth: size.w, clientHeight: size.h, style: {} as Record<string, string>,
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
    getBoundingClientRect: () => ({left: 0, top: 0, right: size.w, bottom: size.h, width: size.w, height: size.h}),
    getContext: (k: string) => (k === 'webgpu' ? ctx : null),
    requestPointerLock: () => undefined,
  } as unknown as HTMLCanvasElement;
  return {canvas, log};
}
