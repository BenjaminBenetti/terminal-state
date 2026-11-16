// Task studio-rt-flashlight-compute-20261115-233136-01: the RT FLASHLIGHT's WebGPU side — the capability probe, the device resources,
// one frame's compute work, and their release. Raw WebGPU on three's OWN device (renderer.backend.device): plain compute pipelines and
// storage buffers, nothing three tracks; the two result textures are three StorageTextures (three owns and samples them, rtBounceNode.ts)
// written here through their GPU textures.
//
// Probe (once per renderer, asynchronous): the WebGPU backend, the device's actual limits against what the kernels bind (storage
// buffers / storage textures per stage, workgroup memory and size, the cone table's uniform size), then every kernel compiled and
// its pipeline created inside a validation error scope. No adapter name, vendor or memory size is consulted.
// Frame: the scene buffers' dirty parts uploaded (render/rt/rtScene.ts versions / ranges), the frame uniform written, one compute pass
// of six dispatches (rtKernels.ts) submitted on three's queue BEFORE three's own submit of the frame (queue order: the frame's lit
// materials read this frame's result). Optional GPU timing (timestamp-query, QA only) splits the pass into one per kernel.
// Fixed capacities: the receiver grid at most RT_GRID_MAX cells (the textures and the receiver buffers are made that size once — a
// window resize changes only the grid in use, no reallocation, the history restarts); the scene buffers grow (never shrink) as the
// station's geometry needs, up to the device's storage-binding limit (the caller's caps keep them below it).

import * as THREE from 'three';
import type {StorageTexture} from 'three/webgpu';
import {refreshTextureBindings} from '../bindingRefresh';
import {RTB, rtTexture} from '../../world/rtBounceNode';
import {RT_FALLBACK_REASON, RT_NOT_READY_REASON, rtBuildFailedReason, rtLimitsReason} from '../../world/rtFlashlight';
import {BLAS_TRI_FLOATS, BVH_NODE_FLOATS, type RtSceneBuffers} from './rtFormat';
import {FRAME_FLOATS, KERNEL_STORAGE_BUFFERS, KERNEL_STORAGE_TEXTURES, RECEIVER_VEC4, RT_KERNELS, VPL_COUNT, VPL_VEC4, WG, kernelSource, type RtKernel} from './rtKernels';

// (WebGPU's usage flags by value: the DOM typings declare the types but not these constants, and Node has neither)
const BUF = {COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80, QUERY_RESOLVE: 0x200, MAP_READ: 0x1} as const;

/** The receiver grid's largest size (cells); the grid is about half the drawing buffer's resolution, never more than this. */
export const RT_GRID_MAX = {w: 640, h: 360} as const;
/** The receiver grid for a drawing buffer of w x h pixels: half its size, scaled down to fit RT_GRID_MAX (same aspect). */
export function rtGridSize(w: number, h: number): {w: number; h: number} {
  const W = Math.max(1, Math.floor(w)), H = Math.max(1, Math.floor(h));
  const s = Math.min(0.5, RT_GRID_MAX.w / W, RT_GRID_MAX.h / H);
  return {w: Math.max(1, Math.min(RT_GRID_MAX.w, Math.ceil(W * s))), h: Math.max(1, Math.min(RT_GRID_MAX.h, Math.ceil(H * s)))};
}

/** What the kernels need of a device (the probe compares these with device.limits). */
/** The least spare room (bytes) of the traced scene's device buffers: 16384 BLAS nodes / triangles, 4096 TLAS vec4. */
export const RT_GPU_SPARE = {bn: 16384 * 32, bt: 16384 * 48, tl: 4096 * 16} as const;

export const RT_REQUIRED_LIMITS = {
  maxStorageBuffersPerShaderStage: Math.max(...RT_KERNELS.map(k => KERNEL_STORAGE_BUFFERS[k])),
  maxStorageTexturesPerShaderStage: Math.max(...RT_KERNELS.map(k => KERNEL_STORAGE_TEXTURES[k])),
  maxComputeWorkgroupStorageSize: 3 * 64 * 16,
  maxComputeInvocationsPerWorkgroup: 64,
  maxComputeWorkgroupSizeX: 64,
  maxComputeWorkgroupSizeY: WG,
  maxUniformBufferBindingSize: VPL_COUNT * 16,
  maxComputeWorkgroupsPerDimension: Math.ceil(RT_GRID_MAX.w / WG),
} as const;

export interface RtProbe {
  ok: boolean;
  /** Why not (one short line), null when ok. */
  reason: string | null;
  /** The compiled pipelines (ok only). */
  pipelines: Record<RtKernel, GPUComputePipeline> | null;
  device: GPUDevice | null;
  /** The device's storage-binding limit (bytes): the scene buffers must stay below it. */
  maxStorageBinding: number;
  /** ms the compile took. */
  compileMs: number;
  timestamps: boolean;
}

/** Why the probe failed (world/rtFlashlight.ts' reason strings: the settings' help line shows them). */
export const RT_PROBE_REASONS = {
  webgl: RT_FALLBACK_REASON,
  noDevice: RT_NOT_READY_REASON,
  limits: (what: string) => rtLimitsReason(what),
  compile: (msg: string) => rtBuildFailedReason(msg),
} as const;

interface BackendLike { isWebGPUBackend?: boolean; device?: GPUDevice | null; get?(o: object): {texture?: GPUTexture} }
interface RendererLike { backend?: BackendLike | null; initTexture?(t: THREE.Texture): void }

const fail = (reason: string, compileMs = 0): RtProbe => ({ok: false, reason, pipelines: null, device: null, maxStorageBinding: 0, compileMs, timestamps: false});

/** Can this renderer run the traced bounce? Compiles the kernels once (the pipelines are kept for the session). Never throws. */
export async function probeRtCompute(renderer: RendererLike): Promise<RtProbe> {
  const backend = renderer?.backend;
  if (!backend || backend.isWebGPUBackend !== true) return fail(RT_PROBE_REASONS.webgl);
  const device = backend.device;
  if (!device || typeof device.createComputePipelineAsync !== 'function') return fail(RT_PROBE_REASONS.noDevice);
  const L = device.limits as unknown as Record<string, number>;
  const short: string[] = [];
  for (const [k, need] of Object.entries(RT_REQUIRED_LIMITS)) if (!(Number(L[k]) >= need)) short.push(`${k} ${L[k] ?? '?'} < ${need}`);
  if (short.length) return fail(RT_PROBE_REASONS.limits(short.join(', ')));
  const t0 = performance.now();
  const pipelines = {} as Record<RtKernel, GPUComputePipeline>;
  try {
    device.pushErrorScope('validation');
    let compileError: string | null = null;
    for (const k of RT_KERNELS) {
      const module = device.createShaderModule({code: kernelSource(k), label: `rt-${k}`});
      const info = typeof module.getCompilationInfo === 'function' ? await module.getCompilationInfo() : null;
      const err = info?.messages.find(m => m.type === 'error');
      if (err) { compileError = `${k}: ${err.message} (line ${err.lineNum})`; break; }
      pipelines[k] = await device.createComputePipelineAsync({layout: 'auto', compute: {module, entryPoint: 'main'}, label: `rt-${k}`});
    }
    const scoped = await device.popErrorScope();
    if (compileError) return fail(RT_PROBE_REASONS.compile(compileError.slice(0, 160)), performance.now() - t0);
    if (scoped) return fail(RT_PROBE_REASONS.compile(String(scoped.message).slice(0, 160)), performance.now() - t0);
  } catch (e) {
    return fail(RT_PROBE_REASONS.compile(String((e as Error)?.message ?? e).slice(0, 160)), performance.now() - t0);
  }
  const maxStorageBinding = Math.min(Number(L.maxStorageBufferBindingSize) || 0, Number(L.maxBufferSize) || Infinity);
  return {ok: true, reason: null, pipelines, device, maxStorageBinding, compileMs: performance.now() - t0, timestamps: device.features.has('timestamp-query')};
}

/** A probe that has not answered after this long (ms) counts as failed (its pipelines are never used). */
export const RT_PROBE_TIMEOUT_MS = 15000;

/** probeRtCompute, bounded by RT_PROBE_TIMEOUT_MS. Never throws. */
export function probeRtComputeBounded(renderer: RendererLike, ms = RT_PROBE_TIMEOUT_MS): Promise<RtProbe> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<RtProbe>(resolve => { timer = setTimeout(() => resolve(fail(RT_PROBE_REASONS.compile(`no answer within ${Math.round(ms / 1000)} s`), ms)), ms); });
  return Promise.race([probeRtCompute(renderer).catch(e => fail(RT_PROBE_REASONS.compile(String((e as Error)?.message ?? e).slice(0, 160)))), late])
    .finally(() => { if (timer) clearTimeout(timer); });
}

/** One frame's inputs, already in the frame block's layout (rtKernels.ts FRAME_FLOATS). */
export interface RtFrameBlock { f32: Float32Array; u32: Uint32Array }
export function rtFrameBlock(): RtFrameBlock {
  const buf = new ArrayBuffer(FRAME_FLOATS * 4);
  return {f32: new Float32Array(buf), u32: new Uint32Array(buf)};
}

export interface RtGpuStats {
  /** Bytes on the GPU by buffer. */
  bytes: Record<string, number>;
  /** Uploads this session (bytes) of the BLAS buffers / the TLAS ranges. */
  uploadedBlas: number;
  uploadedTlas: number;
  frames: number;
  /** The last frame's encode + submit on the CPU (ms). */
  encodeMs: number;
  /** GPU ms per kernel of the last timed frame (timestamp-query; null when not measured). */
  gpuMs: Record<RtKernel, number> | null;
}

interface Buffers {
  frame: GPUBuffer;
  cone: GPUBuffer;
  vpl: GPUBuffer;
  rc: [GPUBuffer, GPUBuffer];
  vTmp: GPUBuffer;
  bn: GPUBuffer | null;
  bt: GPUBuffer | null;
  tl: GPUBuffer | null;
  texE: StorageTexture;
  texN: StorageTexture;
  viewE: GPUTextureView;
  viewN: GPUTextureView;
}

/**
 * The device resources of the traced bounce for one renderer. Made after a successful probe (it keeps the probe's pipelines for the
 * session); the buffers and the two result textures exist only between alloc() — which also points rtBounceNode's texture nodes at
 * the textures — and free(), which points them back at the (zero) placeholders and destroys everything. Off = nothing allocated.
 */
export class RtGpu {
  readonly device: GPUDevice;
  private readonly pipes: Record<RtKernel, GPUComputePipeline>;
  private buf: Buffers | null = null;
  // bind groups by ping-pong side (the receivers written this frame: rc[side]); rebuilt when a scene buffer is replaced
  private groups: [Record<RtKernel, GPUBindGroup> | null, Record<RtKernel, GPUBindGroup> | null] = [null, null];
  private side = 0;
  // what the device holds: the scene's arrays and layout version last uploaded (null = nothing: upload everything)
  private readonly uploaded: {nodes: Float32Array | null; tris: Float32Array | null; tlas: Float32Array | null; layout: number} = {nodes: null, tris: null, tlas: null, layout: -1};
  private readonly maxBinding: number;
  private readonly timestamps: boolean;
  private timing: {set: GPUQuerySet; resolve: GPUBuffer; read: GPUBuffer; busy: boolean} | null = null;
  /** Measure the GPU time per kernel (QA: one readback in flight at most; needs the device's timestamp-query feature). */
  timeGpu = false;
  readonly stats: RtGpuStats = {bytes: {}, uploadedBlas: 0, uploadedTlas: 0, frames: 0, encodeMs: 0, gpuMs: null};
  /** Allocations / frees this session (QA: Off releases everything). */
  readonly lifecycle = {allocs: 0, frees: 0};

  constructor(private readonly renderer: RendererLike, probe: RtProbe) {
    if (!probe.ok || !probe.device || !probe.pipelines) throw new Error('RtGpu: the probe failed');
    this.device = probe.device;
    this.pipes = probe.pipelines;
    this.timestamps = probe.timestamps;
    this.maxBinding = Math.max(16, probe.maxStorageBinding || 128 * 1024 * 1024);
  }

  get allocated(): boolean { return this.buf !== null; }

  /** Make the buffers and the result textures and bind the textures to the material lookup (rtBounceNode.ts RTB). Idempotent. */
  alloc(): void {
    if (this.buf) return;
    const d = this.device, cells = RT_GRID_MAX.w * RT_GRID_MAX.h, bytes: Record<string, number> = {};
    const mk = (label: string, size: number, usage: number): GPUBuffer => {
      bytes[label] = (bytes[label] ?? 0) + size;
      return d.createBuffer({label: `rt-${label}`, size, usage});
    };
    const texE = rtTexture(RT_GRID_MAX.w, RT_GRID_MAX.h, 'E'), texN = rtTexture(RT_GRID_MAX.w, RT_GRID_MAX.h, 'N');
    const r = this.renderer;
    r.initTexture?.(texE);
    r.initTexture?.(texN);
    const gE = r.backend?.get?.(texE)?.texture, gN = r.backend?.get?.(texN)?.texture;
    if (!gE || !gN) { texE.dispose(); texN.dispose(); throw new Error('RtGpu: the result textures have no GPU texture'); }
    bytes.textures = cells * (8 + 4);
    this.buf = {
      frame: mk('frame', FRAME_FLOATS * 4, BUF.UNIFORM | BUF.COPY_DST),
      cone: mk('cone', VPL_COUNT * 16, BUF.UNIFORM | BUF.COPY_DST),
      vpl: mk('vpl', VPL_COUNT * VPL_VEC4 * 16, BUF.STORAGE | BUF.COPY_SRC),
      rc: [mk('receivers', cells * RECEIVER_VEC4 * 16, BUF.STORAGE | BUF.COPY_SRC), mk('receivers', cells * RECEIVER_VEC4 * 16, BUF.STORAGE | BUF.COPY_SRC)],
      vTmp: mk('vTmp', cells * 4, BUF.STORAGE),
      bn: null, bt: null, tl: null,
      texE, texN, viewE: gE.createView(), viewN: gN.createView(),
    };
    this.stats.bytes = bytes;
    this.groups = [null, null];
    this.uploaded.nodes = this.uploaded.tris = this.uploaded.tlas = null;
    if (this.timestamps) {
      try {
        this.timing = {
          set: d.createQuerySet({type: 'timestamp', count: 2 * RT_KERNELS.length}),
          resolve: d.createBuffer({size: 16 * RT_KERNELS.length, usage: BUF.QUERY_RESOLVE | BUF.COPY_SRC}),
          read: d.createBuffer({size: 16 * RT_KERNELS.length, usage: BUF.COPY_DST | BUF.MAP_READ}),
          busy: false,
        };
      } catch { this.timing = null; }
    }
    (RTB.E as unknown as {value: THREE.Texture}).value = texE;
    (RTB.N as unknown as {value: THREE.Texture}).value = texN;
    refreshTextureBindings();
    this.coneHeld = null;
    this.lifecycle.allocs++;
  }

  /**
   * The cone table this allocation's uniform holds (null: none yet — a fresh allocation's buffer is zeros, every light ray would
   * have no direction). Kept per allocation, so a table is written again after every free + alloc.
   */
  get coneTable(): Float32Array | null { return this.buf ? this.coneHeld : null; }
  private coneHeld: Float32Array | null = null;

  /** Upload the cone table (a new allocation, or the spot's angle / penumbra changed). */
  writeCone(dirs: Float32Array): void {
    if (!this.buf) return;
    this.device.queue.writeBuffer(this.buf.cone, 0, dirs.buffer, dirs.byteOffset, dirs.byteLength);
    this.coneHeld = dirs;
  }

  /**
   * Bring the scene buffers up to date (render/rt/rtFormat.ts protocol): a buffer that grows, an array the scene replaced, a moved
   * layout or a fresh allocation is uploaded whole; otherwise only the BLAS spans and the TLAS ranges marked dirty. Then markUploaded().
   */
  upload(S: RtSceneBuffers): void {
    const B = this.buf;
    if (!B) return;
    const d = this.device, q = d.queue, cap = this.maxBinding;
    const ensure = (key: 'bn' | 'bt' | 'tl', bytes: number): boolean => {
      const need = Math.max(16, Math.ceil(bytes / 16) * 16), cur = B[key];
      if (cur && cur.size >= need) return false;
      if (need > cap) throw new Error(`the traced scene's ${key} buffer (${need} bytes) is larger than this device's storage binding limit (${cap})`);
      // (with room to spare — an eighth, at least RT_GPU_SPARE: what a station adds in play, a dropped pickup or a model that arrives
      // late, fits the buffer it has instead of a new buffer and the whole scene uploaded again in one frame)
      const spare = Math.max(Math.ceil(need / 8), RT_GPU_SPARE[key]);
      const size = Math.min(cap, Math.ceil(Math.max(need + spare, cur ? cur.size * 1.25 : 0) / 16) * 16);
      cur?.destroy();
      B[key] = d.createBuffer({label: `rt-${key}`, size, usage: BUF.STORAGE | BUF.COPY_DST});
      this.stats.bytes[key] = size;
      this.groups = [null, null];
      return true;
    };
    const L = S.layout, nodeBytes = S.blasNodeCount * BVH_NODE_FLOATS * 4, triBytes = S.blasTriCount * BLAS_TRI_FLOATS * 4, tlBytes = L.vec4Count * 16;
    const write = (dst: GPUBuffer, src: Float32Array, start: number, end: number): number => {
      const e = Math.min(end, src.byteLength);
      if (!(e > start)) return 0;
      q.writeBuffer(dst, start, src.buffer, src.byteOffset + start, e - start);
      return e - start;
    };
    const U = this.uploaded;
    if (ensure('bn', nodeBytes) || U.nodes !== S.blasNodes) this.stats.uploadedBlas += write(B.bn!, S.blasNodes, 0, nodeBytes);
    else if (S.blasDirtyNodeEnd > S.blasDirtyNodeStart) this.stats.uploadedBlas += write(B.bn!, S.blasNodes, S.blasDirtyNodeStart * BVH_NODE_FLOATS * 4, Math.min(S.blasDirtyNodeEnd * BVH_NODE_FLOATS * 4, nodeBytes));
    if (ensure('bt', triBytes) || U.tris !== S.blasTris) this.stats.uploadedBlas += write(B.bt!, S.blasTris, 0, triBytes);
    else if (S.blasDirtyTriEnd > S.blasDirtyTriStart) this.stats.uploadedBlas += write(B.bt!, S.blasTris, S.blasDirtyTriStart * BLAS_TRI_FLOATS * 4, Math.min(S.blasDirtyTriEnd * BLAS_TRI_FLOATS * 4, triBytes));
    if (ensure('tl', tlBytes) || U.tlas !== S.tlas || U.layout !== S.layoutVersion) this.stats.uploadedTlas += write(B.tl!, S.tlas, 0, tlBytes);
    else for (let i = 0; i < S.tlasDirtyCount; i++) this.stats.uploadedTlas += write(B.tl!, S.tlas, S.tlasDirty[2 * i] * 16, Math.min(S.tlasDirty[2 * i + 1] * 16, tlBytes));
    U.nodes = S.blasNodes; U.tris = S.blasTris; U.tlas = S.tlas; U.layout = S.layoutVersion;
    S.markUploaded();
  }

  private makeGroups(B: Buffers, side: number): Record<RtKernel, GPUBindGroup> {
    const d = this.device, cur = B.rc[side], prev = B.rc[1 - side];
    const buf = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({binding, resource: {buffer}});
    const scene = [buf(1, B.bn!), buf(2, B.bt!), buf(3, B.tl!)];
    const frame = buf(0, B.frame);
    const g = (k: RtKernel, entries: GPUBindGroupEntry[]): GPUBindGroup =>
      d.createBindGroup({label: `rt-${k}-${side}`, layout: this.pipes[k].getBindGroupLayout(0), entries});
    return {
      light: g('light', [frame, ...scene, buf(4, B.cone), buf(5, B.vpl)]),
      receivers: g('receivers', [frame, ...scene, buf(4, cur)]),
      gather: g('gather', [frame, ...scene, buf(4, B.vpl), buf(5, cur)]),
      temporal: g('temporal', [frame, buf(4, cur), buf(5, prev)]),
      spatial1: g('spatial1', [frame, buf(4, cur), buf(5, B.vTmp)]),
      spatial2: g('spatial2', [frame, buf(4, cur), buf(5, B.vTmp), {binding: 6, resource: B.viewE}, {binding: 7, resource: B.viewN}]),
    };
  }

  /**
   * Encode and submit one frame of the traced bounce: `block` holds the frame's uniform values (its grid fields W x H included).
   * Call after upload(); the receivers written now become the next frame's history. False when nothing was dispatched.
   */
  dispatch(block: RtFrameBlock): boolean {
    const B = this.buf;
    if (!B || !B.bn || !B.bt || !B.tl) return false;
    const t0 = performance.now();
    const d = this.device;
    this.side = 1 - this.side;
    const groups = this.groups[this.side] ?? (this.groups[this.side] = this.makeGroups(B, this.side));
    d.queue.writeBuffer(B.frame, 0, block.f32.buffer, block.f32.byteOffset, block.f32.byteLength);
    const W = block.u32[68], H = block.u32[69];
    const gx = Math.ceil(W / WG), gy = Math.ceil(H / WG);
    const counts: Record<RtKernel, readonly [number, number]> = COUNTS;
    COUNTS.receivers = COUNTS.gather = COUNTS.temporal = COUNTS.spatial1 = COUNTS.spatial2 = [gx, gy];
    const enc = d.createCommandEncoder({label: 'rt-flashlight'});
    const timing = this.timeGpu && this.timing && !this.timing.busy ? this.timing : null;
    if (timing) {
      RT_KERNELS.forEach((k, i) => {
        const pass = enc.beginComputePass({label: `rt-${k}`, timestampWrites: {querySet: timing.set, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1}});
        pass.setPipeline(this.pipes[k]);
        pass.setBindGroup(0, groups[k]);
        pass.dispatchWorkgroups(counts[k][0], counts[k][1]);
        pass.end();
      });
      enc.resolveQuerySet(timing.set, 0, 2 * RT_KERNELS.length, timing.resolve, 0);
      enc.copyBufferToBuffer(timing.resolve, 0, timing.read, 0, 16 * RT_KERNELS.length);
    } else {
      const pass = enc.beginComputePass({label: 'rt-flashlight'});
      for (const k of RT_KERNELS) {
        pass.setPipeline(this.pipes[k]);
        pass.setBindGroup(0, groups[k]);
        pass.dispatchWorkgroups(counts[k][0], counts[k][1]);
      }
      pass.end();
    }
    d.queue.submit([enc.finish()]);
    if (timing) {
      timing.busy = true;
      timing.read.mapAsync(1).then(() => {
        if (this.timing !== timing) return;
        const ts = new BigUint64Array(timing.read.getMappedRange().slice(0));
        timing.read.unmap();
        const ms = {} as Record<RtKernel, number>;
        RT_KERNELS.forEach((k, i) => { ms[k] = Number(ts[2 * i + 1] - ts[2 * i]) / 1e6; });
        this.stats.gpuMs = ms;
      }).catch(() => undefined).finally(() => { timing.busy = false; });
    }
    this.stats.frames++;
    this.stats.encodeMs = performance.now() - t0;
    return true;
  }

  /** Release every buffer and texture; the material lookup goes back to the (zero) placeholders. Idempotent; alloc() may follow. */
  free(): void {
    const B = this.buf;
    if (!B) return;
    this.buf = null;
    if ((RTB.E as unknown as {value: THREE.Texture}).value === B.texE) {
      (RTB.E as unknown as {value: THREE.Texture}).value = PLACEHOLDER.E;
      (RTB.N as unknown as {value: THREE.Texture}).value = PLACEHOLDER.N;
      refreshTextureBindings();
    }
    for (const b of [B.frame, B.cone, B.vpl, B.rc[0], B.rc[1], B.vTmp, B.bn, B.bt, B.tl]) b?.destroy();
    if (this.timing) { const t = this.timing; this.timing = null; t.set.destroy(); t.resolve.destroy(); t.read.destroy(); }
    B.texE.dispose();
    B.texN.dispose();
    this.groups = [null, null];
    this.stats.bytes = {};
    this.lifecycle.frees++;
  }
}

const COUNTS: Record<RtKernel, readonly [number, number]> = {
  light: [Math.ceil(VPL_COUNT / 64), 1], receivers: [1, 1], gather: [1, 1], temporal: [1, 1], spatial1: [1, 1], spatial2: [1, 1],
};

/** rtBounceNode's original placeholder textures (what RTB points at while no runtime is bound). */
const PLACEHOLDER = {
  E: (RTB.E as unknown as {value: THREE.Texture}).value,
  N: (RTB.N as unknown as {value: THREE.Texture}).value,
};
