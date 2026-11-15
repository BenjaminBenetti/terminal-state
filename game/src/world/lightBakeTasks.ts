// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane WORKERS): what a BAKE WORKER does — the Enhanced-lighting gather
// (world/lightFieldGather.ts) and the reflection-probe bake (world/reflectionProbes.ts) off the main thread.
// world/lightBakeWorker.ts is the worker's script (it installs this on its global scope); world/lightBakePool.ts is the main thread's
// side. No renderer code is imported here or below (world/lightFieldLayout.ts has the why).
//
// A bake has one LEAD worker and up to two PARTS:
//  - the main thread talks to the lead alone: one message with everything a job reads (copied: the main thread keeps its arrays),
//    one answer with the result (transferred: nothing is copied back);
//  - the lead does everything that is one pass over the station (the gather's plan and surfaces, the sums over the bounces, the
//    smoothing and the rounding; the probes' placement and grid) and a share of what splits exactly: the gathering voxels' rays and
//    bounces, the probes' capture and filter. It hands the other shares to its parts over direct ports — the main thread never
//    relays a byte — and puts their rows / tiles where one pass would have written them;
//  - a part works on what the lead sends it and keeps nothing between two jobs. It is told what a job reads as soon as the lead
//    knows it (the gather's columns, the probes' source: before the lead starts its own one-pass work), so it makes ready — its
//    own plan and ray scene, the roughness kernels — while the lead works, and is told its share when that exists.
// The split is exact (see the two bake modules: a gathering voxel's row and a probe's tiles are functions of inputs that are complete
// before the first ray), so the result is the result of the bake on one thread, bit for bit, whatever the number of parts
// (tests/light-bake-workers.test.ts).
// A worker only ever reports what it has DONE: a stage message is sent when the lead starts that stage, i.e. when everything before
// it is finished; a `tick` only says "still working" (the pool's watchdog). There is no pacing here: nothing is drawn on this thread.
// A thrown error is reported as the job's failure — the pool then bakes on the main thread.

import {drainSync} from '../core/pacedBuild';
import type {ReflectionTier} from './enhancedLighting';
import type {ColumnGeometry} from './lightField';
import {
  GatherRows, gatherChunk, gatherKernel, gatherPlanBytes, gatherPlanSteps, gatherSurfaces, roundRows, smoothSteps,
  type GatherGeometry, type GatherKernel, type GatherPlan, type IndirectLight,
} from './lightFieldGather';
import {IND_STRIDE} from './lightFieldLayout';
import {BandScene} from './lightScene';
import {
  copyProbeMeta, copyProbeTiles, emptyProbeMaps, levelKernelsSteps, probeAtlasLayout, probeCapture, probeFilter, probeGridSteps, probePlacementSteps,
  type LevelKernel, type ProbePlacement, type ProbeSource,
} from './reflectionProbes';

// ---------------------------------------------------------------------------------------------
// Messages

/** Main thread -> a worker, once: its role in the bake's pool. */
export interface LeadRole { op: 'lead'; ports: MessagePort[] }
export interface PartRole { op: 'part'; port: MessagePort }

/** Main thread -> the lead: the gather of a station (world/lightFieldGather.ts gatherIndirectSteps' inputs, as plain arrays). */
export interface GatherJob {
  op: 'gather'; id: number;
  /** How many of its parts the lead may use (the pool's memory bound may allow fewer than it has). */
  parts: number;
  W: number; H: number; layers: number[]; geos: ColumnGeometry[];
  E: Float32Array[]; D: Float32Array[]; EL: Float32Array[]; GL: Float32Array[]; G2L: Float32Array[]; scatter: number;
  /** SurfaceAlbedo.slots. */
  albedo: Uint8Array[];
  rays: number; bounces: number; stride: 1 | 2; reach: number; gain: number; saturation: number; response: {lift: number; ceiling: number} | null;
}

/** Main thread -> the lead: the probes of a station (world/reflectionProbes.ts ProbeSource and the tier's numbers). */
export interface ProbesJob {
  op: 'probes'; id: number;
  /** How many of its parts the lead may use. */
  parts: number;
  source: ProbeSource;
  tier: Pick<ReflectionTier, 'tile' | 'maxProbes' | 'spacing'>;
}

export type ToBakeWorker = LeadRole | PartRole | GatherJob | ProbesJob;

/** What a worker held in typed arrays at its fullest (bytes): the lead, and the largest of its parts. */
export interface BakeMemory { lead: number; part: number }

export interface GatherResult {
  /** IndirectLight.data (the index is the caller's: indirectIndex). */
  data: Float32Array;
  stats: IndirectLight['stats'];
  /** Workers that traced (the lead and the parts with a share). */
  workers: number;
  memory: BakeMemory;
}

export interface ProbesResult {
  count: number; block: number; ramp: number;
  atlas: Uint16Array; meta: Float32Array; grid: Uint8Array; gridDepth: number;
  rays: number; fixtures: number; orphanCells: number;
  workers: number;
  memory: BakeMemory;
}

/** A worker -> the main thread. */
export type FromBakeWorker =
  | {kind: 'stage'; id: number; label: string}
  | {kind: 'tick'}
  | {kind: 'done'; id: number; result: GatherResult | ProbesResult}
  | {kind: 'error'; id: number; message: string};

/** The part of a worker's global scope / of a MessagePort this module uses. */
export interface BakePort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => unknown) | null;
}

// --- lead -> part (over the port of that part), each answered by one message with the same `id` ---
/** Not answered: what the gather to come reads (the part makes its plan and its ray scene ready). */
interface GatherReadyCall { op: 'g.ready'; geo: GatherGeometry; rays: number; stride: 1 | 2; reach: number }
interface TraceCall { op: 'g.trace'; id: number; p0: number; p1: number; rad: Float32Array; va: Float32Array }
interface BounceCall { op: 'g.bounce'; id: number; prev: Float32Array; meanL: Float32Array }
interface EndCall { op: 'g.end' }
/** Not answered: what the probes to come read (the part makes its ray scene and the roughness kernels ready). */
interface ProbesReadyCall { op: 'p.ready'; source: ProbeSource; tile: number }
interface RangeCall { op: 'p.range'; id: number; placement: ProbePlacement; p0: number; p1: number }
type PartCall = GatherReadyCall | TraceCall | BounceCall | EndCall | ProbesReadyCall | RangeCall;
interface RowsReply { id: number; rows: Float32Array; hits: number; bytes: number }
interface RangeReply { id: number; atlas: Uint16Array; meta: Float32Array; rays: number; fixtures: number; bytes: number }
interface FailedReply { id: number; error: string }

const message = (err: unknown): string => String((err as Error | null)?.message ?? err);
const bytesOf = (...arrays: (ArrayBufferView | null | undefined)[]): number => { let b = 0; for (const a of arrays) b += a?.byteLength ?? 0; return b; };
const geometryBytes = (geos: readonly ColumnGeometry[]): number => { let b = 0; for (const g of geos) b += bytesOf(g.open, g.floorH, g.ceilH, g.layerY); return b; };
const sourceBytes = (s: ProbeSource): number => {
  let b = s.data.byteLength + s.fixtures.byteLength + geometryBytes(s.geos);
  for (const a of s.albedo) b += a.byteLength;
  for (const a of s.areas) b += (a as ArrayBufferView | null)?.byteLength ?? 0;
  return b;
};

/** Says "still working" to the main thread, at most every TICK_MS. */
const TICK_MS = 100;
function ticker(scope: BakePort): () => void {
  let last = performance.now();
  return () => {
    const t = performance.now();
    if (t - last < TICK_MS) return;
    last = t;
    scope.postMessage({kind: 'tick'} satisfies FromBakeWorker, []);
  };
}

/**
 * The shares of `total` items for a lead and `parts` parts: [from, to) each, the lead's first. `lead` is the lead's weight against
 * a part's 1 (below 1 where it has one-pass work of its own to do meanwhile). Any split gives the same result: this is about time.
 */
export function bakeShares(total: number, parts: number, lead = 1): [number, number][] {
  const out: [number, number][] = [], sum = lead + parts;
  let at = 0, w = 0;
  for (let i = 0; i <= parts; i++) {
    w += i === 0 ? lead : 1;
    const to = i === parts ? total : Math.min(total, Math.floor(total * w / sum));
    out.push([at, to]);
    at = to;
  }
  return out;
}
/** The lead's weight in the probes' capture: it makes the grid while its parts already capture. */
const PROBES_LEAD_SHARE = 0.5;

// ---------------------------------------------------------------------------------------------
// The lead's line to one part: a call is answered by the message with its id

class PartLine {
  private seq = 0;
  private readonly waiting = new Map<number, {resolve: (v: never) => void; reject: (err: Error) => void}>();
  constructor(private readonly port: BakePort) {
    port.onmessage = ev => {
      const r = ev.data as {id: number} & Partial<FailedReply>, w = this.waiting.get(r.id);
      if (!w) return;
      this.waiting.delete(r.id);
      if (typeof r.error === 'string') w.reject(new Error(`a bake worker failed: ${r.error}`));
      else w.resolve(r as never);
    };
  }
  /** `call` (copied but for `transfer`) to the part; resolves with its answer. */
  call<R>(call: Omit<TraceCall, 'id'> | Omit<BounceCall, 'id'> | Omit<RangeCall, 'id'>, transfer: Transferable[] = []): Promise<R> {
    const id = ++this.seq;
    return new Promise<R>((resolve, reject) => {
      this.waiting.set(id, {resolve: resolve as (v: never) => void, reject});
      this.port.postMessage({...call, id}, transfer);
    });
  }
  /** A message that is not answered. */
  tell(call: GatherReadyCall | ProbesReadyCall | EndCall): void { this.port.postMessage(call, []); }
}

// ---------------------------------------------------------------------------------------------
// The lead's jobs

async function gatherLead(m: GatherJob, lines: readonly PartLine[], scope: BakePort): Promise<{result: GatherResult; transfer: Transferable[]}> {
  const t0 = performance.now(), tick = ticker(scope);
  const stage = (label: string): void => { scope.postMessage({kind: 'stage', id: m.id, label} satisfies FromBakeWorker, []); };
  const geo: GatherGeometry = {W: m.W, H: m.H, geos: m.geos, layers: m.layers};
  // (the parts make their own plan and scene from the same columns while this thread makes its plan and the surfaces' rows)
  for (const line of lines) line.tell({op: 'g.ready', geo, rays: m.rays, stride: m.stride, reach: m.reach});
  stage('gather.index');
  const plan = drainSync(gatherPlanSteps(geo, m.rays, m.stride));
  const {count, probes, N} = plan;
  const rows = new GatherRows(plan);
  const surf = gatherSurfaces(plan, {...geo, E: m.E, D: m.D, EL: m.EL, GL: m.GL, G2L: m.G2L, scatter: m.scatter}, {albedo: {slots: m.albedo, stats: NO_STATS}, saturation: m.saturation, ...(m.response ? {response: m.response} : {})});
  for (let c = 0; c < count; c += 16384) { surf.range(c, Math.min(count, c + 16384)); tick(); }
  const scene = new BandScene(m.W, m.H, m.geos);
  // the shares: the lead's own first, then one per part (a part whose share is empty — fewer gathering voxels than workers — is left out)
  const split = bakeShares(probes, lines.length), own1 = split[0][1];
  const parts = lines.map((line, i) => ({line, p0: split[i + 1][0], p1: split[i + 1][1]})).filter(x => x.p1 > x.p0);
  const kernel = gatherKernel(plan, scene, m.reach, surf.rad, surf.va, 0, own1);
  let partBytes = 0;

  stage('gather.trace');
  // (the parts' copies of the surfaces' rows are made here, on this thread)
  const traced = parts.map(x => x.line.call<RowsReply>({op: 'g.trace', p0: x.p0, p1: x.p1, rad: surf.rad, va: surf.va}));
  const CHUNK = gatherChunk(N);
  for (let p = 0; p < own1; p += CHUNK) { kernel.trace(p, Math.min(own1, p + CHUNK), rows.cur, -1); tick(); }
  let hits = kernel.hits();
  (await Promise.all(traced)).forEach((r, i) => { rows.place(r.rows, parts[i].p0, parts[i].p1); hits += r.hits; if (r.bytes > partBytes) partBytes = r.bytes; });
  const traceMs = performance.now() - t0;

  const bounces = Math.max(1, Math.round(m.bounces));
  rows.add(0, probes);
  for (let b = 1; b < bounces; b++) {
    stage('gather.bounce');
    rows.swap();
    // (a bounce reads the whole bounce before: each part gets its own copy, made here)
    const bounced = parts.map(x => x.line.call<RowsReply>({op: 'g.bounce', prev: rows.prev, meanL: rows.meanL}));
    for (let p = 0; p < own1; p += CHUNK * 8) { kernel.bounce(p, Math.min(own1, p + CHUNK * 8), rows.prev, rows.meanL, rows.cur, -1); tick(); }
    (await Promise.all(bounced)).forEach((r, i) => { rows.place(r.rows, parts[i].p0, parts[i].p1); if (r.bytes > partBytes) partBytes = r.bytes; });
    rows.add(0, probes);
  }
  for (const line of lines) line.tell({op: 'g.end'});

  stage('gather.smooth');
  drainSync(smoothSteps(plan, rows.tot, rows.prev));
  tick();
  const mean = roundRows(rows.tot, 0, count, m.gain, 0);
  const lead = geometryBytes(m.geos) + bytesOf(...m.E, ...m.D, ...m.EL, ...m.GL, ...m.G2L, ...m.albedo) + gatherPlanBytes(plan) + rows.bytes + bytesOf(surf.rad, surf.va) + kernel.bytes
    + (probes - own1) * IND_STRIDE * 4; // (+ the parts' rows while they are put in place)
  return {
    result: {
      data: rows.tot, workers: parts.length + 1, memory: {lead, part: partBytes},
      stats: {voxels: count, probes, rays: probes * N, hits, bounces, ms: performance.now() - t0, traceMs, mean: count ? mean / count : 0},
    },
    transfer: [rows.tot.buffer],
  };
}
const NO_STATS = {keys: 0, floors: 0, ceils: 0, open: 0, walls: 0, defaults: 0};

async function probesLead(m: ProbesJob, lines: readonly PartLine[], scope: BakePort): Promise<{result: ProbesResult; transfer: Transferable[]}> {
  const tick = ticker(scope), src = m.source, tile = m.tier.tile;
  const stage = (label: string): void => { scope.postMessage({kind: 'stage', id: m.id, label} satisfies FromBakeWorker, []); };
  // (each part's copy of the source — the field's texels are most of it — is made here, on this thread; the parts make their scene
  // and the roughness kernels ready while this thread places the probes)
  for (const line of lines) line.tell({op: 'p.ready', source: src, tile});
  stage('probes.place');
  const pl = drainSync(probePlacementSteps(src, m.tier));
  const count = pl.count, split = bakeShares(count, lines.length, PROBES_LEAD_SHARE), own1 = split[0][1];
  const parts = lines.map((line, i) => ({line, p0: split[i + 1][0], p1: split[i + 1][1]})).filter(x => x.p1 > x.p0);
  const ranged = parts.map(x => x.line.call<RangeReply>({op: 'p.range', placement: pl, p0: x.p0, p1: x.p1}));

  stage('probes.grid');
  const {grid, gridDepth, orphanCells} = drainSync(probeGridSteps(src, pl));
  tick();
  if (!count) {
    const maps = emptyProbeMaps(tile);
    return {result: {count: 0, block: pl.block, ramp: pl.ramp, ...maps, grid, gridDepth, rays: 0, fixtures: 0, orphanCells, workers: 1, memory: {lead: sourceBytes(src) + bytesOf(maps.atlas, maps.meta, grid), part: 0}}, transfer: [maps.atlas.buffer, maps.meta.buffer, grid.buffer]};
  }

  stage('probes.capture');
  const scene = new BandScene(src.W, src.H, src.geos);
  const capture = probeCapture(src, pl, tile, scene, 0, own1), T2 = tile * tile;
  for (let p = 0; p < own1; p++) { capture.texels(p, 0, T2); capture.finish(p); tick(); }

  stage('probes.filter');
  const kernels = drainSync(levelKernelsSteps(tile));
  tick();
  const layout = probeAtlasLayout(tile, count), atlas = new Uint16Array(layout.width * layout.height * 4);
  const filter = probeFilter(layout, kernels, capture.cap, 0, atlas);
  for (let p = 0; p < own1; p++) { filter(p); tick(); }
  let rays = capture.rays(), fixtures = capture.fixtures(), partBytes = 0;
  (await Promise.all(ranged)).forEach((r, i) => {
    copyProbeTiles(atlas, r.atlas, layout, parts[i].p0, parts[i].p1);
    copyProbeMeta(capture.meta, r.meta, count, parts[i].p0, parts[i].p1);
    rays += r.rays; fixtures += r.fixtures;
    if (r.bytes > partBytes) partBytes = r.bytes;
  });
  const lead = sourceBytes(src) + bytesOf(capture.cap, capture.meta, atlas, grid) + kernelBytes(kernels) + parts.length * atlas.byteLength; // (+ the parts' atlases while their tiles are copied)
  return {
    result: {count, block: pl.block, ramp: pl.ramp, atlas, meta: capture.meta, grid, gridDepth, rays, fixtures, orphanCells, workers: parts.length + 1, memory: {lead, part: partBytes}},
    transfer: [atlas.buffer, capture.meta.buffer, grid.buffer],
  };
}
const kernelBytes = (kernels: readonly {share: Float32Array; start: Int32Array; src: Uint16Array; w: Float32Array}[]): number => { let b = 0; for (const k of kernels) b += bytesOf(k.share, k.start, k.src, k.w); return b; };

// ---------------------------------------------------------------------------------------------
// A part

/** What a part keeps of a gather: made ready from its columns, then its share's kernel from the trace to the last bounce. */
interface PartGather { geo: GatherGeometry; plan: GatherPlan; scene: BandScene; reach: number; kernel: GatherKernel | null; p0: number; p1: number; bytes: number }
/** What a part keeps of the probes: made ready from their source. */
interface PartProbes { source: ProbeSource; tile: number; scene: BandScene; kernels: LevelKernel[] }

function servePart(port: BakePort, scope: BakePort): void {
  let gather: PartGather | null = null, probes: PartProbes | null = null;
  /** Why a `ready` call failed (it has no answer of its own: the call that follows is answered with it). */
  let unready: string | null = null;
  const tick = ticker(scope);
  port.onmessage = ev => {
    const m = ev.data as PartCall;
    if (m.op === 'g.end') { gather = null; return; }
    if (m.op === 'g.ready' || m.op === 'p.ready') {
      gather = null; probes = null; unready = null;
      try {
        if (m.op === 'g.ready') {
          const plan = drainSync(gatherPlanSteps(m.geo, m.rays, m.stride));
          tick();
          gather = {geo: m.geo, plan, scene: new BandScene(m.geo.W, m.geo.H, m.geo.geos), reach: m.reach, kernel: null, p0: 0, p1: 0, bytes: 0};
        } else {
          const scene = new BandScene(m.source.W, m.source.H, m.source.geos);
          tick();
          probes = {source: m.source, tile: m.tile, scene, kernels: drainSync(levelKernelsSteps(m.tile))};
        }
      } catch (err) { unready = message(err); }
      tick();
      return;
    }
    try {
      if (unready !== null) throw new Error(unready);
      if (m.op === 'g.trace') {
        if (!gather) throw new Error('a trace without its columns');
        const {geo, plan, scene, reach} = gather;
        const kernel = gatherKernel(plan, scene, reach, m.rad, m.va, m.p0, m.p1);
        const rows = new Float32Array((m.p1 - m.p0) * IND_STRIDE), CHUNK = gatherChunk(plan.N);
        for (let p = m.p0; p < m.p1; p += CHUNK) { kernel.trace(p, Math.min(m.p1, p + CHUNK), rows, m.p0); tick(); }
        // (at its fullest during a bounce: + the bounce before, its means, and the rows it answers with)
        const bytes = geometryBytes(geo.geos) + gatherPlanBytes(plan) + bytesOf(m.rad, m.va) + kernel.bytes + rows.byteLength + plan.count * (IND_STRIDE + 1) * 4;
        gather = {...gather, kernel, p0: m.p0, p1: m.p1, bytes};
        port.postMessage({id: m.id, rows, hits: kernel.hits(), bytes} satisfies RowsReply, [rows.buffer]);
      } else if (m.op === 'g.bounce') {
        if (!gather?.kernel) throw new Error('a bounce without its trace');
        const {plan, kernel, p0, p1} = gather;
        const rows = new Float32Array((p1 - p0) * IND_STRIDE), CHUNK = gatherChunk(plan.N) * 8;
        for (let p = p0; p < p1; p += CHUNK) { kernel.bounce(p, Math.min(p1, p + CHUNK), m.prev, m.meanL, rows, p0); tick(); }
        port.postMessage({id: m.id, rows, hits: kernel.hits(), bytes: gather.bytes} satisfies RowsReply, [rows.buffer]);
      } else {
        if (!probes) throw new Error('a range of probes without their source');
        const {source: src, tile, scene, kernels} = probes, {placement: pl, p0, p1} = m;
        probes = null; // (one range a job: the source is let go with this call)
        const capture = probeCapture(src, pl, tile, scene, p0, p1), T2 = tile * tile;
        for (let p = p0; p < p1; p++) { capture.texels(p, 0, T2); capture.finish(p); tick(); }
        const layout = probeAtlasLayout(tile, pl.count), atlas = new Uint16Array(layout.width * layout.height * 4);
        const filter = probeFilter(layout, kernels, capture.cap, p0, atlas);
        for (let p = p0; p < p1; p++) { filter(p); tick(); }
        const bytes = sourceBytes(src) + bytesOf(capture.cap, capture.meta, atlas) + kernelBytes(kernels);
        port.postMessage({id: m.id, atlas, meta: capture.meta, rays: capture.rays(), fixtures: capture.fixtures(), bytes} satisfies RangeReply, [atlas.buffer, capture.meta.buffer]);
      }
    } catch (err) {
      gather = null; probes = null;
      port.postMessage({id: m.id, error: message(err)} satisfies FailedReply, []);
    }
  };
}

// ---------------------------------------------------------------------------------------------

/** Makes `scope` (a worker's global scope) a bake worker: it takes its role, then its jobs. */
export function installBakeTasks(scope: BakePort): void {
  let lines: PartLine[] = [];
  const run = (id: number, job: () => Promise<{result: GatherResult | ProbesResult; transfer: Transferable[]}>): void => {
    job().then(
      r => { scope.postMessage({kind: 'done', id, result: r.result} satisfies FromBakeWorker, r.transfer); },
      err => { scope.postMessage({kind: 'error', id, message: message(err)} satisfies FromBakeWorker, []); },
    );
  };
  scope.onmessage = ev => {
    const m = ev.data as ToBakeWorker;
    if (m.op === 'lead') lines = m.ports.map(p => new PartLine(p as unknown as BakePort));
    else if (m.op === 'part') servePart(m.port as unknown as BakePort, scope);
    else if (m.op === 'gather') run(m.id, async () => gatherLead(m, lines.slice(0, Math.max(0, m.parts)), scope));
    else if (m.op === 'probes') run(m.id, async () => probesLead(m, lines.slice(0, Math.max(0, m.parts)), scope));
  };
}
