// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane WORKERS): the main thread's side of the BAKE WORKERS — the Enhanced-
// lighting gather and the reflection-probe bake of one station load, off the main thread (world/lightBakeTasks.ts is what a worker
// does; world/lightBakeWorker.ts its script).
//
// What it promises:
//  - THE SAME BYTES. The workers run the bake's own code over shares that split it exactly; the result is the in-process bake's, bit
//    for bit, for any number of workers (tests/light-bake-workers.test.ts). So the number of workers is a question of speed alone:
//    it is the only thing here that looks at the machine (bakeWorkerCount), and it can never change what a station looks like or
//    which cache entry it reads or writes (the digests are made on the main thread before a worker starts).
//  - BOUNDED. At most LIGHT_BAKE_POOL.maxWorkers workers, one on a machine that reports little memory, none without Workers; and
//    before a job starts, the typed arrays its workers will hold beyond the in-process bake's own are estimated: over
//    LIGHT_BAKE_POOL.maxExtraBytes the job uses fewer workers, then none. The workers live for one bake (LightBakeSession: made for
//    a station's bake, closed when it ends — nothing idles between two stations).
//  - NEVER SILENT, NEVER STUCK. No Worker, a worker that cannot start, throws, answers nonsense or stops answering (the watchdog:
//    LIGHT_BAKE_POOL.stallMs of a running event loop without a message), a job over the memory bound: the session throws
//    BakeWorkersFailed with the reason, its workers are terminated, and the caller (world/enhancedLightingRuntime.ts) bakes that part
//    in process and reports the reason (EnhancedLightingStatus.bake, EnhancedLightingTimings.bake, a console warning). A failure
//    that says something about the WORKERS (not about this station's size) is `lasting`: the caller does not start workers again on
//    this page — a browser whose workers never answer costs one wait for the watchdog, not one per station.
//  - CANCELLABLE. A job is a build generator (core/pacedBuild.ts) that PARKS on the workers' answers (`yield {wait}`); closed
//    before its result (the station was replaced, the device lost, the lighting choice changed again), its finally terminates the
//    workers: whatever they were making is dropped, nothing of it is installed or cached.
//  - TRUTHFUL. The stage labels it yields are the lead worker's own (sent when the stage before is finished).
// What stays on the main thread: the direct light, the surface colours, the digests and the cache, the field's encoding and its
// textures — and one copy of the job's inputs into the lead worker's message (measured: LightBakeReport.copyMs / copyBytes).

import {watchdog} from '../core/derivedCache';
import type {BuildSteps} from '../core/pacedBuild';
import type {ReflectionTier} from './enhancedLighting';
import type {ColumnGeometry} from './lightField';
import {indirectIndex, type GatherOptions, type IndirectContext, type IndirectLight} from './lightFieldGather';
import {IND_STRIDE} from './lightFieldLayout';
import type {BakeMemory, FromBakeWorker, GatherJob, GatherResult, ProbesJob, ProbesResult, ToBakeWorker} from './lightBakeTasks';
import {assembleProbes, probeAtlasLayout, probeSource, type BakedProbes, type ProbeBakeInput, type ProbeSource} from './reflectionProbes';

export const LIGHT_BAKE_POOL = {
  /** Most workers of one bake (one lead, the others its parts). */
  maxWorkers: 3,
  /** A machine that reports this much memory or less (navigator.deviceMemory, GB) bakes on one worker. */
  lowMemoryGb: 4,
  /** Most typed-array bytes a job's workers may hold beyond the in-process bake's own (estimated before they start). */
  maxExtraBytes: 512e6,
  /** Workers that send nothing for this long (ms in which the event loop ran: core/derivedCache.ts watchdog) are given up. */
  stallMs: 20000,
} as const;

/**
 * How many workers a bake may use on this machine: min(cores - 1, maxWorkers), at least one (a single core still gets the bake off
 * the main thread); one where the browser reports little memory; none without Workers. (Unknown numbers count as "one".)
 */
export function bakeWorkerCount(env: {workers: boolean; hardwareConcurrency?: number | null; deviceMemory?: number | null}): number {
  if (!env.workers) return 0;
  const cores = env.hardwareConcurrency, memory = env.deviceMemory;
  let k = typeof cores === 'number' && Number.isFinite(cores) ? Math.min(LIGHT_BAKE_POOL.maxWorkers, Math.floor(cores) - 1) : 1;
  if (k < 1) k = 1;
  if (typeof memory === 'number' && memory <= LIGHT_BAKE_POOL.lowMemoryGb) k = 1;
  return k;
}

/** The part of a Worker the pool uses (a browser Worker is one; tests hand in their own). */
export interface BakeWorker {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onerror: ((ev: ErrorEvent) => unknown) | null;
  onmessageerror: ((ev: MessageEvent) => unknown) | null;
}

/** The workers a bake may use (Game hands the runtime the browser's; absent: every bake runs in process). */
export interface LightBakeWorkers {
  /** How many (bakeWorkerCount; 0 = none). */
  count: number;
  /** With count 0: why there are none, as it is reported (absent: "no bake worker is available"). */
  unavailable?: string;
  /** A new worker running world/lightBakeWorker.ts. It may throw (no Worker, a blocked script): the bake then runs in process. */
  spawn(): BakeWorker;
  /** Tests: LIGHT_BAKE_POOL.stallMs / maxExtraBytes. */
  stallMs?: number;
  maxExtraBytes?: number;
}

/**
 * The workers could not do (or finish) a job: the caller bakes it in process. `message` is the reason as reported. `lasting`: the
 * reason is about the workers themselves (they could not be started, failed, answered something else, stopped answering), not about
 * this job (a station past the memory bound) — the next bake would meet it again.
 */
export class BakeWorkersFailed extends Error {
  constructor(reason: string, readonly lasting = true) { super(reason); this.name = 'BakeWorkersFailed'; }
}

/** How a bake used its workers (diagnostics: EnhancedLightingTimings.bake). */
export interface LightBakeReport {
  /** Workers its jobs ran on (the most of its jobs; 0: all of it ran on the calling thread). */
  workers: number;
  /** Why the bake — or the rest of it — ran on the calling thread although workers were to be used (null: it did not). */
  fallback: string | null;
  /** Calling-thread time (ms): starting the workers; handing the jobs over (the copy of their inputs). */
  startMs: number; copyMs: number;
  /** Bytes copied to the lead worker (the jobs' inputs). */
  copyBytes: number;
  /** Typed-array bytes a worker held at its fullest: the lead, and the largest of its parts. */
  memory: BakeMemory;
}

const reason = (err: unknown): string => String((err as Error | null)?.message ?? err);
const sum = (arrays: readonly (ArrayBufferView | null)[]): number => { let b = 0; for (const a of arrays) b += a?.byteLength ?? 0; return b; };
const geometryBytes = (geos: readonly ColumnGeometry[]): number => { let b = 0; for (const g of geos) b += g.open.byteLength + g.floorH.byteLength + g.ceilH.byteLength + g.layerY.byteLength; return b; };
/** `a` itself when it is the whole of its buffer (a message copies a view's whole buffer), else a copy of just its part. */
const whole = <T extends ArrayBufferView>(a: T): T => (a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : (a as unknown as {slice(): T}).slice());

/** Bytes a gather job copies to the lead (its inputs). */
function gatherInputBytes(ctx: IndirectContext, opt: GatherOptions): number {
  return geometryBytes(ctx.geos) + sum(ctx.E) + sum(ctx.D) + sum(ctx.EL) + sum(ctx.GL) + sum(ctx.G2L) + sum(opt.albedo.slots);
}

/**
 * Typed-array bytes the gather's workers hold beyond the in-process gather's own, for `K` workers — an estimate from the station's
 * size, made before they start: the lead's copy of the inputs, and per part its copy of the columns, the plan, the surfaces' rows,
 * the bounce before, its share of the hits and the rows it answers with.
 */
export function gatherWorkersBytes(ctx: IndirectContext, opt: Pick<GatherOptions, 'rays' | 'stride' | 'albedo'>, K: number): number {
  const n = ctx.W * ctx.H, N = Math.max(4, Math.round(opt.rays));
  let count = 0, layers = 0;
  for (let s = 0; s < ctx.geos.length; s++) { const open = ctx.geos[s].open, L = ctx.layers[s]; let c = 0; for (let i = 0; i < n; i++) if (open[i]) c++; count += c * L; layers += L; }
  // (stride 2: a quarter of the voxels gather, and the cells with no lattice neighbour — a third is a safe round number)
  const probes = opt.stride === 2 ? Math.ceil(count / 3) : count;
  const plan = count * 10 + probes * 4 + n * layers * 4 + n * ctx.geos.length * (opt.stride === 2 ? 17 : 1);
  const part = geometryBytes(ctx.geos) + plan + count * (21 + 9 + IND_STRIDE + 1) * 4 + Math.ceil(probes / K) * (N * 6 + IND_STRIDE * 4);
  return gatherInputBytes(ctx, opt as GatherOptions) + (K - 1) * part;
}

/** Bytes of a probe source (what a probes job copies to the lead, and the lead to each part). */
function sourceBytes(s: ProbeSource): number {
  return s.data.byteLength + s.fixtures.byteLength + geometryBytes(s.geos) + sum(s.albedo) + sum(s.areas as readonly (ArrayBufferView | null)[]);
}

/**
 * Typed-array bytes the probes' workers hold beyond the in-process bake's own, for `K` workers (an estimate before they start, at
 * the tier's most probes): a copy of the source each, and per part its share of the level-0 maps and an atlas of its own (held
 * twice while the lead puts it into the whole one).
 */
export function probeWorkersBytes(src: ProbeSource, tier: Pick<ReflectionTier, 'tile' | 'maxProbes'>, K: number): number {
  const most = Math.max(1, Math.min(255, Math.floor(tier.maxProbes))), layout = probeAtlasLayout(tier.tile, most);
  const atlas = layout.width * layout.height * 4 * 2, cap = Math.ceil(most / K) * tier.tile * tier.tile * 12;
  return K * sourceBytes(src) + (K - 1) * (2 * atlas + cap + most * 48);
}

/** One job's messages from the workers, in order; the job's generator parks on next() while there is none. */
class JobLine {
  readonly events: Exclude<FromBakeWorker, {kind: 'tick'}>[] = [];
  private wake: (() => void) | null = null;
  constructor(readonly id: number) {}
  push(ev: Exclude<FromBakeWorker, {kind: 'tick'}>): void {
    this.events.push(ev);
    const w = this.wake;
    this.wake = null;
    w?.();
  }
  next(): Promise<void> {
    return this.events.length ? Promise.resolve() : new Promise<void>(resolve => { this.wake = resolve; });
  }
}

/**
 * The workers of ONE station's bake: started by its first job, shared by its gather and its probes, closed when the bake ends
 * (close(): the caller's finally — also when the bake is abandoned). After a failure the session stays failed: the rest of that bake
 * runs in process.
 */
export class LightBakeSession {
  /** Why the workers are not used (any more) in this bake (null: they are). */
  failure: string | null = null;
  readonly report: LightBakeReport = {workers: 0, fallback: null, startMs: 0, copyMs: 0, copyBytes: 0, memory: {lead: 0, part: 0}};
  private workers: BakeWorker[] = [];
  private ports: MessagePort[] = [];
  private job: JobLine | null = null;
  private seq = 0;
  private unwatch: (() => void) | null = null;

  constructor(private readonly cfg: LightBakeWorkers, private readonly now: () => number = () => performance.now()) {}

  /** Workers alive right now (tests; 0 before the first job and after close()). */
  get live(): number { return this.workers.length; }

  /** The gather on the workers (world/lightFieldGather.ts gatherIndirectSteps' result, bit for bit). Throws BakeWorkersFailed. */
  *gatherSteps(ctx: IndirectContext, opt: GatherOptions): BuildSteps<IndirectLight> {
    const t0 = this.now();
    const K = this.fit(k => gatherWorkersBytes(ctx, opt, k), 'the gather\'s');
    const r = yield* this.run<GatherResult>(K, (id, parts): GatherJob => {
      this.report.copyBytes += gatherInputBytes(ctx, opt);
      return {
        op: 'gather', id, parts, W: ctx.W, H: ctx.H, layers: [...ctx.layers], geos: ctx.geos.map(wholeGeometry),
        E: ctx.E.map(whole), D: ctx.D.map(whole), EL: ctx.EL.map(whole), GL: ctx.GL.map(whole), G2L: ctx.G2L.map(whole), scatter: ctx.scatter,
        albedo: opt.albedo.slots.map(whole),
        rays: opt.rays, bounces: opt.bounces, stride: opt.stride, reach: opt.reach, gain: opt.gain, saturation: opt.saturation ?? 1, response: opt.response ?? null,
      };
    });
    const {index, count} = indirectIndex(ctx.geos, ctx.layers, ctx.W * ctx.H);
    if (!(r.data instanceof Float32Array) || r.data.length !== count * IND_STRIDE || !r.stats) throw this.broken('the bake workers answered the gather with something else');
    this.noted(r.workers, r.memory);
    return {index, data: r.data, stats: {...r.stats, ms: this.now() - t0}};
  }

  /** The probes on the workers (world/reflectionProbes.ts bakeReflectionProbesSteps' result, bit for bit). Throws BakeWorkersFailed. */
  *probesSteps(input: ProbeBakeInput, tier: ReflectionTier): BuildSteps<BakedProbes> {
    const t0 = this.now();
    const src = probeSource(input, tier); // (a bad tier or field throws here as it does in process: not a worker failure)
    const K = this.fit(k => probeWorkersBytes(src, tier, k), 'the reflection probes\'');
    const r = yield* this.run<ProbesResult>(K, (id, parts): ProbesJob => {
      this.report.copyBytes += sourceBytes(src);
      return {
        op: 'probes', id, parts, tier: {tile: tier.tile, maxProbes: tier.maxProbes, spacing: tier.spacing},
        source: {W: src.W, H: src.H, data: whole(src.data), gi: src.gi, geos: src.geos.map(wholeGeometry), areas: src.areas.map(a => (a ? whole(a as unknown as ArrayBufferView) as unknown as ArrayLike<number> : null)), albedo: src.albedo.map(whole), fixtures: src.fixtures},
      };
    });
    const layout = probeAtlasLayout(tier.tile, Math.max(1, r.count | 0)), n = src.W * src.H;
    const ok = Number.isInteger(r.count) && r.count >= 0 && r.count <= 255 && r.atlas instanceof Uint16Array && r.atlas.length === layout.width * layout.height * 4
      && r.meta instanceof Float32Array && r.meta.length === Math.max(1, r.count) * 12 && r.grid instanceof Uint8Array && r.grid.length === n * r.gridDepth * 4;
    if (!ok) throw this.broken('the bake workers answered the probes with something else');
    this.noted(r.workers, r.memory);
    return assembleProbes(tier, src, r, r, r, this.now() - t0);
  }

  /** Ends the session: every worker is terminated (whatever it was doing is dropped). Safe to call twice. */
  close(): void {
    this.unwatch?.();
    this.unwatch = null;
    this.job = null;
    for (const w of this.workers) {
      w.onmessage = null; w.onerror = null; w.onmessageerror = null;
      try { w.terminate(); } catch { /* it is gone either way */ }
    }
    for (const p of this.ports) { try { p.close(); } catch { /* closed */ } }
    this.workers = [];
    this.ports = [];
  }

  // -------------------------------------------------------------------------------------------

  /** The most workers (at most the session's) whose estimated extra bytes fit the bound; throws when not even one does. */
  private fit(bytes: (K: number) => number, whose: string): number {
    if (this.failure) throw new BakeWorkersFailed(this.failure, false);
    const cap = this.cfg.maxExtraBytes ?? LIGHT_BAKE_POOL.maxExtraBytes;
    const most = Math.max(0, Math.min(LIGHT_BAKE_POOL.maxWorkers, Math.floor(this.cfg.count), this.workers.length || Infinity));
    for (let k = most; k >= 1; k--) if (bytes(k) <= cap) return k;
    // (about this station, not about the workers: not `lasting`)
    throw this.broken(most < 1 ? 'no bake worker is available' : `${whose} worker copy of this station (${Math.round(bytes(1) / 1e6)} MB) is past the ${Math.round(cap / 1e6)} MB bound`, false);
  }

  /** The session has failed for good: its workers are terminated. Returns the error to throw. */
  private broken(why: string, lasting = true): BakeWorkersFailed {
    this.failure ??= why;
    this.report.fallback ??= why;
    this.close();
    return new BakeWorkersFailed(why, lasting);
  }

  private noted(workers: number, memory: BakeMemory | undefined): void {
    const r = this.report;
    if (workers > r.workers) r.workers = workers;
    if (memory && memory.lead > r.memory.lead) r.memory.lead = memory.lead;
    if (memory && memory.part > r.memory.part) r.memory.part = memory.part;
  }

  private start(K: number): void {
    if (this.workers.length) return;
    const t = this.now();
    try {
      // (a part is reached over a port of its own: without MessageChannel the lead works alone)
      const count = typeof MessageChannel === 'function' ? K : 1;
      for (let i = 0; i < count; i++) {
        const w = this.cfg.spawn();
        this.workers.push(w);
        w.onmessage = ev => { this.heard(ev.data as FromBakeWorker); };
        w.onerror = ev => { this.lost(`a bake worker failed${ev && typeof ev.message === 'string' && ev.message ? `: ${ev.message}` : ''}`); };
        w.onmessageerror = () => { this.lost('a bake worker\'s message could not be read'); };
      }
      for (let i = 1; i < count; i++) {
        const ch = new MessageChannel();
        this.ports.push(ch.port1);
        this.workers[i].postMessage({op: 'part', port: ch.port2} satisfies ToBakeWorker, [ch.port2]);
      }
      const ports = [...this.ports];
      this.workers[0].postMessage({op: 'lead', ports} satisfies ToBakeWorker, ports);
    } catch (err) {
      throw this.broken(`the bake workers could not be started (${reason(err)})`);
    }
    this.report.startMs += this.now() - t;
  }

  /** A message from any worker: they are alive (the watchdog starts over); a job's message goes to its line. */
  private heard(m: FromBakeWorker): void {
    const job = this.job;
    if (!job) return;
    this.watch();
    if (!m || m.kind === 'tick' || m.id !== job.id) return;
    job.push(m);
  }

  /** A worker is gone (or the watchdog expired): the job in flight fails with the reason; without one the session just fails. */
  private lost(why: string): void {
    const job = this.job;
    if (job) job.push({kind: 'error', id: job.id, message: why});
    else this.broken(why);
  }

  private watch(): void {
    this.unwatch?.();
    const ms = this.cfg.stallMs ?? LIGHT_BAKE_POOL.stallMs;
    this.unwatch = watchdog(ms, () => { this.lost(`the bake workers sent nothing for ${ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms)} ms`}`); });
  }

  /** One job on the lead: posts it, then yields the lead's stages as they arrive and parks between them; returns its result. */
  private *run<R>(K: number, build: (id: number, parts: number) => GatherJob | ProbesJob): BuildSteps<R> {
    let done = false;
    try {
      this.start(K);
      const job = this.job = new JobLine(++this.seq);
      const t = this.now();
      try { this.workers[0].postMessage(build(job.id, Math.min(K, this.workers.length) - 1), []); }
      catch (err) { throw this.broken(`the job could not be handed to the bake workers (${reason(err)})`); }
      this.report.copyMs += this.now() - t;
      this.watch();
      for (;;) {
        const ev = job.events.shift();
        if (!ev) { yield {wait: job.next()}; continue; }
        if (ev.kind === 'stage') { yield ev.label; continue; }
        if (ev.kind === 'done') { done = true; return ev.result as R; }
        throw this.broken(ev.message);
      }
    } finally {
      this.unwatch?.();
      this.unwatch = null;
      this.job = null;
      if (!done) this.close(); // (failed, or abandoned by its caller: whatever the workers were making is dropped)
    }
  }
}

const wholeGeometry = (g: ColumnGeometry): ColumnGeometry => ({open: whole(g.open), floorH: whole(g.floorH), ceilH: whole(g.ceilH), layerY: whole(g.layerY), yMin: g.yMin, yMax: g.yMax});
