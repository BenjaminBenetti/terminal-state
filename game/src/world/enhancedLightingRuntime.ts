// Task studio-baked-lighting-reflections-20261114-050258-01: the game-side runtime of ENHANCED LIGHTING (world/enhancedLighting.ts is
// the contract): what a station is built with, the derived cache, and the status every surface shows.
//
// One station load, with enhanced lighting asked for and applicable:
//  1. prefetch (async, behind the loading screen / during the ride: Game.prepareSection) — the station's cache ADDRESS is hashed
//     from its realized layout (every level's cells, floors, ceilings, sight blockers, ramps; its fixtures; the bake parameters and
//     the tiers), in pieces with a breath between them, and the entry stored under it is read from the derived cache
//     (core/derivedCache.ts: IndexedDB, bounded, outside the save).
//  2. bakeSteps (sync build steps, where the baseline bake runs: Game.buildSectionSteps 'lighting') — the field's direct light is
//     baked exactly as always; then the indirect term (world/lightFieldGather.ts) and the reflection probes
//     (world/reflectionProbes.ts) are each either taken from the fetched entry or made now. An entry is only ever USED when the
//     digest of the real inputs matches the one stored with it: the direct light the bake just made, the column geometry, the
//     surface colours the builder really drew, the fixtures, the parameters and the code versions below. The address finds an entry;
//     it never vouches for one. A stale entry is baked again and replaced.
//  3. what was baked is stored (fire and forget; a failed write only means the next load bakes again).
// Nothing here reads or writes the campaign save, draws a random number or changes a layout: a cache hit, a miss, a cleared or
// unavailable cache give the same station, the same loot and the same light — only the load time differs.
// Enhanced lighting Off and the Reactor never open the cache and return nothing: the caller bakes the baseline as before.
//
// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane WORKERS): the two long parts of step 2 — the gather and the probes —
// run on the bake's WORKERS when the caller can wait for them (bakeSteps `offThread`: Game's paced and sliced builds; a synchronous
// build never) and workers were handed in (setBakeWorkers: main.ts). world/lightBakePool.ts has the contract: the same bytes as on
// this thread for any number of workers, so nothing below — the digests, the cache keys, what is stored, what the station looks
// like — knows or cares where they were made. Everything else of step 2 stays on this thread (the direct light, the surface
// colours, the digests, the field's encoding). When the workers cannot be used or give up, that part is baked here as before and
// the reason is reported (timings.bake, status().bake, a console warning): never silently, never a different station.
//
// Task rt-flashlight-compute-20261115-233136 (lane UI): RT FLASHLIGHT (world/rtFlashlight.ts). The plan says whether a station's bounce
// is to be traced on the GPU (plan.rt); bakeSteps hands that on (EnhancedBake.rt: only when the station's final shading is full) and
// records it (status().active.rt / rtReason); the lead's RT runtime reports what it could prepare (rtInstalled: the traced scene, or why
// the station keeps the standard bounce). The compute probe answers after the renderer is initialised: setRtCapability. A station that
// cannot take the traced bounce whatever the choice (its shading ended plain, its traced scene could not be prepared) makes the choice
// moot for it: an RT On / Off change is then not a pending change (no relight that would build the same station).

import {ContentHasher} from '../core/contentHash';
import {openDerivedCache, type DerivedBundle, type DerivedCache, type DerivedCacheStats} from '../core/derivedCache';
import type {BuildSteps} from '../core/pacedBuild';
import {BakeWorkersFailed, LightBakeSession, type LightBakeReport, type LightBakeWorkers} from './lightBakePool';
import {
  ENHANCED_LIGHTING_DEFAULT, FIELD_CUBE_BYTES, REFLECTIONS_DEFAULT, baselinePlan, planEnhancedLighting, planSignature, rtCapability,
  type EnhancedLightingActive, type EnhancedLightingPlan, type EnhancedLightingRequest, type EnhancedLightingStatus, type FieldShading, type GiTier, type LightingCacheUse,
  type LightingCapabilities, type ReflectionTier,
} from './enhancedLighting';
import {RT_NOT_INSTALLED_REASON, type RtCapability, type RtSceneInfo} from './rtFlashlight';
import {MAX_GROUPS, MAX_SLOTS, bakeLightFieldSteps, fieldDepth, giDepth, type BakedField, type ColumnGeometry, type FieldParams, type FieldSource} from './lightField';
import {GATHER_REACH, GATHER_TUNING, IND_STRIDE, gatherIndirectSteps, indirectIndex, rowBits, rowValue, type GatherOptions, type IndirectContext, type IndirectLight} from './lightFieldGather';
import {BandScene} from './lightScene';
import {
  PROBE_FIXTURE_RADIANCE, PROBE_LEVEL_SIGMA, PROBE_NORM_MIN, PROBE_REACH, bakeReflectionProbesSteps, probeBytes, type BakedProbes, type ProbeAtlasLayout, type ProbeBakeInput,
} from './reflectionProbes';
import {surfaceAlbedoSteps, type DrawnSurfaces, type SurfaceAlbedo} from './surfaceAlbedo';

/** The settings as the game holds them (game.ts Settings; optional: hosts / tests from before them read the defaults). (lane UI: + rtFlashlight, default On) */
export interface EnhancedLightingSettings { enhancedLighting?: EnhancedLightingRequest['lighting']; reflections?: EnhancedLightingRequest['reflections']; rtFlashlight?: boolean }

/**
 * Versions of the cached data. Bump GATHER when world/lightFieldGather.ts (or the ray scene / the albedo bytes it reads) gives a
 * different result for the same inputs, PROBES likewise for world/reflectionProbes.ts, ENTRY when the stored layout changes.
 * (Everything upstream — generation, fixtures, the direct bake, the finishes — is covered by content: see inputs digests.)
 */
export const DERIVED_LIGHTING_VERSIONS = {entry: 2, gather: 2, probes: 4} as const;

/** What a station's enhanced bake reads (world/lights.ts stationBakeInput). */
export interface StationBakeInput {
  source: FieldSource;
  params: FieldParams;
  /** The Reactor: never enhanced (its lighting is unchanged). */
  reactor: boolean;
  /** Whatever else shapes the bake and is not in the source's arrays (the mall roof's outline), as text: part of the address. */
  extra: string;
}

/** What bakeSteps hands the station lighting (world/lights.ts StationLightingOptions.baked / .probes). */
export interface EnhancedBake {
  /** The enhanced field (undefined: bake the baseline). */
  baked: BakedField | undefined;
  probes: BakedProbes | null;
  /** How the field is to be shaded ('full': it holds its ambient cube; world/enhancedLighting.ts). */
  shading: FieldShading;
  /** The live glass mirror is planned (with probes only). */
  mirror: boolean;
  /**
   * With full shading: the station's fixed architecture as a ray scene and its surface colours — what the flashlight's bounce
   * traces its beam against (world/flashBounce.ts). null otherwise.
   */
  bounce: {scene: BandScene; albedo: SurfaceAlbedo} | null;
  /**
   * (lane UI) The bounce is to be traced on the GPU (RT Flashlight: the plan's rt, and the station's shading really is full) — the RT
   * light variant replaces the virtual-light bounce; false: the bounce (where there is one) is the standard one.
   */
  rt: boolean;
  /** Why not although it was asked for (null: it is, or it was not asked for). */
  rtReason: string | null;
}

/**
 * Times of the last enhanced load (ms; diagnostics / the cost report). They are this thread's own time where the work ran on this
 * thread; a part the bake's workers made (`bake.workers` > 0) counts the time it took from asking to having it — this thread was
 * free meanwhile (its own share of a build is in the build's statistics: core/pacedBuild.ts PacedBuildStats.stages / .parked).
 */
export interface EnhancedLightingTimings {
  /** Hashing the address (prefetch) and reading + unpacking the entry. */
  addressMs: number; fetchMs: number;
  /** Surface colours, the inputs digests, the gather, the probes (0 when taken from the cache). */
  albedoMs: number; digestMs: number; giMs: number; probeMs: number;
  /** The whole lighting bake of the load (direct light and encoding included). */
  totalMs: number;
  /**
   * How the gather and the probes were made, when either was (null: both came from the cache): on how many workers, what handing
   * them the station cost this thread, what they held — and, when they were to be used and were not (for all of it), why.
   */
  bake: LightBakeReport | null;
}

export interface EnhancedLightingRuntimeOptions {
  /** Opens the derived cache (default core/derivedCache.ts openDerivedCache(); tests inject one). Called at most once. */
  openCache?: () => DerivedCache;
  /** Clock (ms). */
  now?: () => number;
  /** The workers a bake may use (world/lightBakePool.ts; setBakeWorkers replaces them). Absent: every bake runs on the calling thread. */
  bakeWorkers?: LightBakeWorkers | null;
}

interface Captured { geos: readonly ColumnGeometry[]; albedo: SurfaceAlbedo; scene: BandScene | null; digest: string; rows: Float32Array; stats: IndirectLight['stats'] }

interface Fetched {
  grid: unknown;
  /** The layout part of the address (tiers excluded). */
  layoutKey: string;
  key: string;
  bundle: DerivedBundle | null;
  persistent: boolean;
  addressMs: number; fetchMs: number;
}

const BREATH_MS = 4;

/** A typed array of a bundle, checked. */
function arr<T extends Float32Array | Uint16Array | Uint8Array>(b: DerivedBundle, name: string, type: {new (n: number): T}, length: number): T | null {
  const a = b.arrays[name];
  return a instanceof type && a.length === length ? a as T : null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : -1);

function lightsView(src: FieldSource): Float64Array {
  const L = src.lights, out = new Float64Array(L.length * 13);
  for (let i = 0; i < L.length; i++) {
    const l = L[i], o = i * 13;
    out[o] = l.x; out[o + 1] = l.y; out[o + 2] = l.z; out[o + 3] = l.rot; out[o + 4] = l.power; out[o + 5] = l.level ?? 0;
    out[o + 6] = (l.broken ? 1 : 0) | (l.flicker ? 2 : 0) | (l.warm ? 4 : 0) | (l.dying ? 8 : 0) | (l.virtual ? 16 : 0) | (l.mount ? 32 : 0) | (l.tint ? 64 : 0);
    out[o + 7] = l.tint?.[0] ?? 0; out[o + 8] = l.tint?.[1] ?? 0; out[o + 9] = l.tint?.[2] ?? 0;
    const m = l.mount as unknown;
    // a mount is a small record of numbers / a tag: its text length and a cheap sum are enough for an address
    if (m) { const t = JSON.stringify(m); let h = 0; for (let c = 0; c < t.length; c++) h = (h * 31 + t.charCodeAt(c)) | 0; out[o + 10] = t.length; out[o + 11] = h; }
    out[o + 12] = l.area;
  }
  return out;
}

export class EnhancedLightingRuntime {
  private active: EnhancedLightingActive | null = null;
  /**
   * What the live station was planned with (pending = the settings now plan something else for it). (lane UI) `plan`: that plan;
   * `rtBlocked`: the station cannot take the traced bounce whatever the choice (its shading ended plain, its traced scene could not be
   * prepared) — its signature and the one it is compared with leave RT out.
   */
  private live: {signature: string; reactor: boolean; plan?: EnhancedLightingPlan; rtBlocked?: boolean} | null = null;
  private caps: LightingCapabilities = {backend: null, software: false, maxTextureSize: 0, max3DTextureSize: 0, halfFloatLinear: false};
  private cache: DerivedCache | null = null;
  private fetched: Fetched | null = null;
  private readonly now: () => number;
  private bakeWorkers: LightBakeWorkers | null;
  /** Why no worker is started any more (they failed in a way the next bake would meet again: BakeWorkersFailed.lasting). */
  private bakeWorkersOff: string | null = null;
  /** The last enhanced load's times (null: none yet). */
  timings: EnhancedLightingTimings | null = null;

  constructor(private readonly settings: EnhancedLightingSettings, private readonly opts: EnhancedLightingRuntimeOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.bakeWorkers = opts.bakeWorkers ?? null;
  }

  /**
   * The workers the next bakes may use (world/lightBakePool.ts LightBakeWorkers; null: none — every bake on the calling thread).
   * How many is the host's business (main.ts asks the browser): it changes how long a bake takes, never what it makes.
   */
  setBakeWorkers(workers: LightBakeWorkers | null): void {
    this.bakeWorkers = workers;
    this.bakeWorkersOff = null;
  }

  /**
   * What the initialised renderer really offers (Game.initRenderer; before it: nothing — no reflections are planned). Everything is
   * replaced: caps without `rt` = RT Flashlight's compute path not probed yet on this renderer (setRtCapability answers it later).
   */
  setCapabilities(caps: LightingCapabilities): void {
    this.caps = {...caps, ...(caps.rt ? {rt: {...caps.rt}} : {})};
    this.changed();
  }
  capabilities(): LightingCapabilities { return {...this.caps}; }

  /**
   * (lane UI) The answer of RT Flashlight's compute probe for the renderer of the last setCapabilities (it finishes after the renderer is
   * initialised; null: not known — not used). Only this capability changes; the plan, pending and the status follow it like any other
   * capability change (a live station that would now be built differently has a pending change).
   */
  setRtCapability(cap: RtCapability | null): void {
    const was = this.caps.rt ?? null;
    if (was === cap || (was && cap && was.ok === cap.ok && was.reason === cap.reason)) return;
    this.caps = {...this.caps, rt: cap ? {ok: cap.ok, reason: cap.reason} : null};
    this.changed();
  }

  /** What the player asked for right now. */
  request(): EnhancedLightingRequest {
    return {lighting: this.settings.enhancedLighting ?? ENHANCED_LIGHTING_DEFAULT, reflections: this.settings.reflections ?? REFLECTIONS_DEFAULT, rt: this.settings.rtFlashlight !== false};
  }

  /** The plan for a station under the settings and capabilities of this moment. */
  plan(reactor: boolean): EnhancedLightingPlan {
    return planEnhancedLighting(this.request(), this.caps, {reactor});
  }

  /** What the live station uses, what was asked, whether a change is not applied yet, being applied, or failed to apply. */
  status(): EnhancedLightingStatus {
    const want = this.pendingSignature();
    const pending = !!this.live && want !== this.live.signature;
    return {
      // (during a rebuild in place the station is lit by what it had until the new lighting is installed: bakeSteps writes its record earlier)
      requested: this.request(), active: this.applying && this.litBy ? this.litBy.active : this.active, pending, cacheBackend: this.cache ? this.cache.backend : 'none',
      applying: this.applying, error: pending && this.failure?.signature === want ? this.failure.reason : null,
      bake: this.timings?.bake ? {workers: this.timings.bake.workers, fallback: this.timings.bake.fallback} : null,
      rtCapability: rtCapability(this.caps), // (lane UI)
    };
  }

  /** (lane UI) A plan's signature as the live station compares it: without RT where the station cannot take the traced bounce. */
  private liveSignature(plan: EnhancedLightingPlan): string {
    return planSignature(this.live?.rtBlocked && plan.rt ? {...plan, rt: false} : plan);
  }

  /** (lane UI) The live station cannot take the traced bounce whatever the choice: RT leaves its signature (no pending churn). */
  private blockRt(): void {
    const L = this.live;
    if (!L || L.rtBlocked || !L.plan?.rt) return;
    this.live = {...L, rtBlocked: true, signature: planSignature({...L.plan, rt: false})};
  }

  // Task studio-graphics-gpu-materials-toggle-20261114-212239-01: a changed choice applied to the LIVE station (Game.relightAfterSettings).
  private applying = false;
  /** The plan that could not be applied to the live station, and why (reported while that plan is still the pending one). */
  private failure: {signature: string; reason: string} | null = null;
  /** What the station was lit by when a rebuild in place began (checkpoint): the status's `active` until the new lighting is installed. */
  private litBy: {active: EnhancedLightingActive | null} | null = null;

  /** The live station's lighting is being rebuilt (true) / the rebuild ended (false): the forms say so and hold their choices. */
  setApplying(on: boolean): void {
    if (!on) this.litBy = null;
    if (this.applying === on) return;
    this.applying = on;
    this.changed();
  }

  /** The signature of what the settings now plan for the live station (null: no station). */
  pendingSignature(): string | null {
    return this.live ? this.liveSignature(this.plan(this.live.reactor)) : null;
  }

  /** Whether `signature` (pendingSignature) is the plan that already failed to apply: the game does not retry it by itself. */
  failedFor(signature: string | null): boolean {
    return !!this.failure && this.failure.signature === signature;
  }

  /**
   * The live station's record before a rebuild in place (bakeSteps replaces it at its first step): restore() puts it back when the
   * rebuild did not happen, and records why — the status then says what the station still uses and that the change failed.
   */
  checkpoint(): () => void {
    const active = this.active, live = this.live, timings = this.timings;
    this.litBy = {active};
    return () => { this.active = active; this.live = live; this.timings = timings; this.litBy = null; };
  }
  /** A rebuild in place ended with the BASELINE lighting installed instead of what was planned (world/lights.ts replaceSteps). */
  installedBaseline(reason: string): void {
    const base = baselinePlan();
    if (this.live) this.live = {...this.live, signature: planSignature(base), plan: base, rtBlocked: false};
    this.timings = null;
    this.litBy = null;
    this.active = {gi: 'baseline', giReason: reason, shading: 'plain', shadingReason: null, mirror: false, reflections: 'off', reflectionsReason: null, cache: 'none', giMs: 0, probeMs: 0, probes: 0, probeBytes: 0,
      rt: false, rtReason: this.request().rt !== false ? reason : null, rtScene: null}; // (lane UI: no bounce — the same reason)
    this.changed();
  }

  /**
   * (lane UI) What the lead's RT runtime could make of the live station's traced bounce, once its scene is prepared (or could not be):
   * `ok` with the scene's size — the status says the bounce is traced on the GPU; not ok with the reason (too much geometry, a pipeline
   * that failed for this station) — the station keeps the standard bounce, the status says why, and the choice is moot for this station
   * (no pending change). Ignored for a station whose bounce was not planned traced (nothing is ever claimed that was not built).
   */
  rtInstalled(ok: boolean, reason: string | null, scene: RtSceneInfo | null = null): void {
    const a = this.active;
    if (!a || a.rt !== true) return;
    const sc = scene ? {...scene} : null;
    if (ok) this.active = {...a, rtReason: null, rtScene: sc};
    else {
      this.active = {...a, rt: false, rtReason: reason || RT_NOT_INSTALLED_REASON, rtScene: sc};
      this.blockRt();
    }
    this.changed();
  }
  failed(signature: string | null, reason: string, restore?: () => void): void {
    restore?.();
    this.failure = signature ? {signature, reason} : null;
    this.changed();
  }

  private readonly listeners = new Set<() => void>();
  /** Told whenever status() may have changed (a station was built, the cache was cleared). Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  protected changed(): void {
    for (const fn of [...this.listeners]) { try { fn(); } catch (err) { console.warn('enhanced lighting: a status listener failed', err); } }
  }

  private openCache(): DerivedCache {
    return (this.cache ??= (this.opts.openCache ?? openDerivedCache)());
  }

  /** The derived cache's numbers (null while it was never opened: enhanced lighting off all session). Never rejects. */
  async cacheStats(): Promise<DerivedCacheStats | null> {
    if (!this.cache) return null;
    try { return await this.cache.stats(); } catch (err) { console.warn('enhanced lighting: the cache statistics could not be read', err); return null; }
  }

  /** Delete every cached bake of this browser (they are rebuilt when next needed). Never rejects. */
  async clearCache(): Promise<void> {
    try { await this.openCache().clear(); } catch (err) { console.warn('enhanced lighting: the cache could not be cleared', err); }
    this.fetched = null;
    this.changed();
  }

  // -------------------------------------------------------------------------------------------
  // 1. prefetch

  private entryKey(layoutKey: string, plan: EnhancedLightingPlan, shading: FieldShading): string {
    // (the shading is part of the address: the probes of a fully shaded station are lit by its cube)
    return `el${DERIVED_LIGHTING_VERSIONS.entry}-${plan.gi!.id}-${shading}-${plan.reflections?.id ?? 'none'}-${layoutKey}`;
  }

  /**
   * How a station planned with `plan` is really shaded: full shading needs the field's ambient cube in the 3D texture, so only where
   * the renderer's 3D textures and the byte bound (FIELD_CUBE_BYTES) take it — else plain, with the reason. (The plan itself, and
   * with it what counts as a pending settings change, does not depend on the station.)
   */
  private shadingFor(plan: EnhancedLightingPlan, src: FieldSource, max3D: number): {shading: FieldShading; reason: string | null} {
    if (plan.shading !== 'full') return {shading: 'plain', reason: plan.shadingReason};
    const S = Math.min(MAX_SLOTS, src.levels?.length || 1), depth = fieldDepth(S) + MAX_GROUPS + giDepth(S), bytes = src.grid.w * src.grid.h * depth * 4;
    if (depth > max3D) return {shading: 'plain', reason: `this station's field with its cube (${depth} slices) is deeper than this renderer's 3D textures (${max3D})`};
    if (bytes > FIELD_CUBE_BYTES) return {shading: 'plain', reason: `this station's field with its cube (${Math.round(bytes / 1e6)} MB) is past the ${Math.round(FIELD_CUBE_BYTES / 1e6)} MB bound`};
    return {shading: 'full', reason: null};
  }

  /**
   * Hash a station's cache address and read its entry (Game.prepareSection: before the station is built). Never rejects; does
   * nothing when the station would not be enhanced.
   */
  async prefetch(input: StationBakeInput): Promise<void> {
    try {
      const plan = this.plan(input.reactor);
      if (!plan.gi) { this.fetched = null; return; }
      const t0 = this.now();
      const layoutKey = await layoutAddress(input, this.now);
      const t1 = this.now();
      const cache = this.openCache();
      const key = this.entryKey(layoutKey, plan, this.shadingFor(plan, input.source, this.caps.max3DTextureSize).shading);
      const bundle = await cache.get(key);
      await cache.ready();
      this.fetched = {grid: input.source.grid, layoutKey, key, bundle, persistent: cache.backend === 'indexeddb', addressMs: t1 - t0, fetchMs: this.now() - t1};
    } catch (err) {
      console.warn('enhanced lighting: the cache could not be read (the station is baked now)', err);
      this.fetched = null;
    }
  }

  // -------------------------------------------------------------------------------------------
  // 2. bake

  /**
   * The enhanced part of a station's lighting bake, as build steps (core/pacedBuild.ts): {baked: undefined} when the station is not
   * enhanced (the caller bakes the baseline: nothing was touched), else the enhanced field and — when planned — its probes.
   * `drawn` is what the builder really drew (BuiltWorld.drawn; null: the neutral finish colours).
   * `offThread`: the caller drains these steps with a driver that can wait (core/pacedBuild.ts runPaced / runSliced), so the gather
   * and the probes may run on the bake's workers — the steps then PARK (yield a BuildWait) while the workers work. Without it every
   * step runs on the calling thread (drainSync and every other synchronous caller).
   */
  *bakeSteps(input: StationBakeInput, drawn: DrawnSurfaces | null | undefined, o: {max3DTextureSize?: number; offThread?: boolean} = {}): BuildSteps<EnhancedBake> {
    // the bake's workers, for this station's bake alone (started by the first part that is not in the cache; closed here whatever
    // happens: a bake that is abandoned half-way takes its workers with it)
    const pool = o.offThread ? this.bakeWorkers : null, off = this.bakeWorkersOff;
    const session = pool && pool.count > 0 && !off ? new LightBakeSession(pool, this.now) : null;
    const unavailable = !pool || session ? null : pool.count > 0 && off ? `the bake workers failed earlier on this page (${off})` : pool.unavailable ?? 'no bake worker is available';
    try {
      return yield* this.bakeWith(session, unavailable, input, drawn, o);
    } finally {
      session?.close();
    }
  }

  /** bakeSteps with its workers (`session`; null: none — `unavailable` says why when there were to be some). */
  private *bakeWith(session: LightBakeSession | null, unavailable: string | null, input: StationBakeInput, drawn: DrawnSurfaces | null | undefined, o: {max3DTextureSize?: number}): BuildSteps<EnhancedBake> {
    const plan = this.plan(input.reactor);
    this.live = {signature: planSignature(plan), reactor: input.reactor, plan, rtBlocked: false};
    this.failure = null; // (a station is being lit for the current choice: an earlier failed change is history)
    if (!plan.gi) {
      this.fetched = null;
      this.timings = null;
      this.active = {gi: 'baseline', giReason: plan.giReason, shading: 'plain', shadingReason: null, mirror: false, reflections: 'off', reflectionsReason: plan.reflectionsReason, cache: 'none', giMs: 0, probeMs: 0, probes: 0, probeBytes: 0,
        rt: false, rtReason: plan.rtReason, rtScene: null};
      this.changed();
      return {baked: undefined, probes: null, shading: 'plain', mirror: false, bounce: null, rt: false, rtReason: plan.rtReason};
    }
    const now = this.now, tStart = now();
    const src = input.source, gi = plan.gi;
    const max3D = o.max3DTextureSize ?? this.caps.max3DTextureSize;
    const {shading, reason: shadingReason} = this.shadingFor(plan, src, max3D);
    // (lane UI) the traced bounce needs the bounce: a station shaded plain after all has none (the reason it is plain says why)
    const rt = plan.rt && shading === 'full';
    const rtReason = shading === 'full' ? plan.rtReason : plan.rt || plan.rtReason !== null ? shadingReason : null;
    if (plan.rt && !rt) this.blockRt();
    // the fetched entry, if it is this station's and this plan's
    let fetched = this.fetched;
    this.fetched = null;
    if (fetched && fetched.grid !== src.grid) fetched = null;
    if (fetched && fetched.key !== this.entryKey(fetched.layoutKey, plan, shading)) fetched = {...fetched, key: this.entryKey(fetched.layoutKey, plan, shading), bundle: null};
    const entry = fetched?.bundle && isObject(fetched.bundle.meta) && fetched.bundle.meta.v === DERIVED_LIGHTING_VERSIONS.entry ? fetched.bundle : null;
    const timings: EnhancedLightingTimings = {addressMs: fetched?.addressMs ?? 0, fetchMs: fetched?.fetchMs ?? 0, albedoMs: 0, digestMs: 0, giMs: 0, probeMs: 0, totalMs: 0, bake: null};
    const levels = (src.levels ?? [{id: 0, role: 'main', grid: src.grid, baseY: 0}]).slice(0, MAX_SLOTS) as NonNullable<FieldSource['levels']>;

    /** Why a part meant for the workers is made on this thread instead (the first reason; null: none was). */
    let fallback = unavailable;
    /** The gather or the probes were made in this load (not taken from the cache). */
    let made = false;
    const workersOff = (why: string): void => { this.bakeWorkersOff ??= why; };
    /** `steps` on the workers; null when they cannot do it (the reason is kept and said once): the caller makes it here. */
    const onWorkers = function* <T>(what: string, steps: (s: LightBakeSession) => BuildSteps<T>): BuildSteps<T | null> {
      if (!session || session.failure) return null;
      try { return yield* steps(session); } catch (err) {
        if (!(err instanceof BakeWorkersFailed)) throw err;
        fallback ??= err.message;
        if (err.lasting) workersOff(err.message); // (the next station's bake would meet it again: no worker is started for it)
        console.warn(`enhanced lighting: the ${what} is baked on the main thread (${err.message})`);
        return null;
      }
    };

    // what the bake's indirect hook saw and made (the probes read the same columns and colours)
    const hook: {got: Captured | null; use: 'hit' | 'miss' | 'stale'} = {got: null, use: 'miss'};
    const indirect = function* (ctx: IndirectContext): BuildSteps<IndirectLight> {
      yield 'gather.surfaces';
      let t = now();
      const albedo = yield* surfaceAlbedoSteps(ctx.W, ctx.H, levels, ctx.geos, drawn ?? null);
      timings.albedoMs = now() - t;
      yield 'gather.digest';
      t = now();
      const digest = yield* gatherDigestSteps(ctx, albedo, gi);
      timings.digestMs += now() - t;
      const n = ctx.W * ctx.H;
      const g = entry && isObject(entry.meta.gi) ? entry.meta.gi : null;
      if (g && g.inputs === digest && isObject(g.stats)) {
        const {index, count} = indirectIndex(ctx.geos, ctx.layers, n);
        const halves = arr(entry!, 'gi', Uint16Array, count * IND_STRIDE);
        if (halves) {
          hook.use = 'hit';
          // (16 bits a value in the cache, and those 16 bits' values in a fresh gather: the same numbers)
          const rows = new Float32Array(halves.length);
          for (let q = 0; q < rows.length; q++) rows[q] = rowValue(halves[q]);
          const stats = g.stats as IndirectLight['stats'];
          hook.got = {geos: ctx.geos, albedo, scene: null, digest, rows, stats};
          return {index, data: rows, stats};
        }
      }
      hook.use = g ? 'stale' : 'miss';
      const opt: GatherOptions = {rays: gi.rays, bounces: gi.bounces, stride: gi.stride, reach: GATHER_REACH, gain: GATHER_TUNING.gain, saturation: GATHER_TUNING.saturation, ...(GATHER_TUNING.lift > 0 ? {response: {lift: GATHER_TUNING.lift, ceiling: GATHER_TUNING.ceiling}} : {}), albedo};
      let scene: BandScene | null = null;
      let ind = yield* onWorkers('gather', s => s.gatherSteps(ctx, opt));
      if (!ind) {
        scene = new BandScene(ctx.W, ctx.H, ctx.geos);
        ind = yield* gatherIndirectSteps(ctx, {...opt, scene});
      }
      timings.giMs = ind.stats.ms;
      made = true;
      hook.got = {geos: ctx.geos, albedo, scene, digest, rows: ind.data, stats: ind.stats};
      return ind;
    };
    const baked = yield* bakeLightFieldSteps({...src, indirect, cube: shading === 'full'}, input.params);
    const got = hook.got, giUse = hook.use;
    if (!got) throw new Error('enhanced lighting: the bake did not run its indirect step');

    // --- reflection probes ---------------------------------------------------------------------
    let probes: BakedProbes | null = null, rpUse: 'hit' | 'miss' | 'stale' | 'none' = 'none', rpDigest = '';
    let reflectionsReason = plan.reflectionsReason;
    const tier = plan.reflections;
    if (tier && Math.max(baked.w, baked.h, 2 * baked.slots) > max3D) {
      reflectionsReason = `the station (${baked.w} x ${baked.h} cells) is larger than this renderer's 3D textures (${max3D})`;
    } else if (tier) {
      yield 'probes.digest';
      let t = now();
      rpDigest = probesDigest(got.digest, baked, src, levels, tier);
      timings.digestMs += now() - t;
      const r = entry && isObject(entry.meta.rp) ? entry.meta.rp : null;
      probes = r && r.inputs === rpDigest ? probesFromEntry(entry!, r, tier) : null;
      if (probes) rpUse = 'hit';
      else {
        rpUse = r ? 'stale' : 'miss';
        yield 'probes.bake';
        t = now();
        const from: ProbeBakeInput = {field: baked, geos: got.geos, levels, albedo: got.albedo, lights: src.lights, scene: got.scene ?? undefined};
        probes = (yield* onWorkers('reflection probes', s => s.probesSteps(from, tier))) ?? (yield* bakeReflectionProbesSteps(from, tier));
        timings.probeMs = now() - t;
        made = true;
      }
    }
    if (made) timings.bake = {...(session ? session.report : {workers: 0, startMs: 0, copyMs: 0, copyBytes: 0, memory: {lead: 0, part: 0}}), fallback};

    // --- 3. store what was made --------------------------------------------------------------
    const baked1 = giUse !== 'hit' || (rpUse !== 'hit' && rpUse !== 'none');
    const persistent = fetched ? fetched.persistent : false;
    let use: LightingCacheUse = !baked1 ? 'hit' : giUse === 'stale' || rpUse === 'stale' ? 'stale' : 'miss';
    if (baked1) {
      const key = fetched?.key ?? null;
      if (key) this.store(key, got, probes, rpDigest);
      else this.storeLater(input, plan, shading, got, probes, rpDigest);
      if (fetched && !persistent) use = 'unavailable';
    }
    timings.totalMs = now() - tStart;
    this.timings = timings;
    const usable = !!probes && probes.count > 0, mirror = usable && plan.mirror;
    this.active = {
      gi: gi.id, giReason: null, shading, shadingReason, mirror, reflections: usable ? probes!.tier : 'off',
      reflectionsReason: tier && probes && probes.count < 1 ? 'this station has no place for a probe' : reflectionsReason,
      cache: use, giMs: timings.giMs, probeMs: timings.probeMs, probes: probes?.count ?? 0, probeBytes: usable ? probeBytes(probes!) : 0,
      rt, rtReason, rtScene: null, // (lane UI: the traced scene is reported by rtInstalled once it is prepared)
    };
    this.changed();
    // the flashlight's bounce traces the same scene the gather did (a cache hit made none: it is cheap to make)
    const bounce = shading === 'full' ? {scene: got.scene ?? new BandScene(baked.w, baked.h, got.geos), albedo: got.albedo} : null;
    return {baked, probes: usable ? probes : null, shading, mirror, bounce, rt, rtReason};
  }

  /**
   * What the station lighting made of the probes (world/lights.ts StationLighting.reflectionsSkipped): they may not have been
   * usable after all (no node library, a grid past the 3D texture limit) — the status says so. Likewise `plainBecause`
   * (StationLighting.shadingSkipped): the field could not keep its cube on the GPU and is shaded plain — (lane UI) and so has no
   * flashlight bounce to trace: RT Flashlight is moot for this station.
   */
  applied(skipped: string | null, plainBecause: string | null = null): void {
    const inPlace = this.litBy !== null; // (a rebuild in place: from here the status describes the new lighting)
    this.litBy = null;
    let a = this.active, changed = false;
    if (a && skipped && a.reflections !== 'off') { a = {...a, reflections: 'off', reflectionsReason: skipped, mirror: false, probes: 0, probeBytes: 0}; changed = true; }
    if (a && plainBecause && a.shading === 'full') {
      const rt = a.rt === undefined ? {} : {rt: false, rtReason: a.rt || a.rtReason ? plainBecause : null, rtScene: null};
      if (a.rt) this.blockRt();
      a = {...a, shading: 'plain', shadingReason: plainBecause, ...rt};
      changed = true;
    }
    if (changed) this.active = a;
    else if (!inPlace) return;
    this.changed();
  }

  private store(key: string, got: {digest: string; rows: Float32Array; stats: IndirectLight['stats']}, probes: BakedProbes | null, rpDigest: string): void {
    const bundle: DerivedBundle = {
      meta: {v: DERIVED_LIGHTING_VERSIONS.entry, gi: {inputs: got.digest, stats: {...got.stats}}, rp: null},
      arrays: {gi: halves(got.rows)},
    };
    if (probes) {
      bundle.meta.rp = {
        inputs: rpDigest, tier: probes.tier, count: probes.count, block: probes.block, ramp: probes.ramp, layout: {...probes.layout, levelTile: [...probes.layout.levelTile], levelY: [...probes.layout.levelY]},
        gridW: probes.gridW, gridH: probes.gridH, gridDepth: probes.gridDepth, slots: probes.slots, stats: {...probes.stats},
      };
      bundle.arrays.atlas = probes.atlas; bundle.arrays.pmeta = probes.meta; bundle.arrays.grid = probes.grid;
    }
    this.openCache().put(key, bundle, 'station lighting').then(ok => { if (ok) this.changed(); }, err => { console.warn('enhanced lighting: the bake could not be cached', err); });
  }

  /** No prefetch ran for this station (a caller that builds without preparing): hash the address now, off the build, then store. */
  private storeLater(input: StationBakeInput, plan: EnhancedLightingPlan, shading: FieldShading, got: {digest: string; rows: Float32Array; stats: IndirectLight['stats']}, probes: BakedProbes | null, rpDigest: string): void {
    layoutAddress(input, this.now).then(k => this.store(this.entryKey(k, plan, shading), got, probes, rpDigest), err => { console.warn('enhanced lighting: the bake could not be cached', err); });
  }
}

// ---------------------------------------------------------------------------------------------
// Addresses and digests

/**
 * The layout part of a station's cache address: its realized geometry and fixtures and the bake parameters (hashed in pieces, a
 * breath between them when they took a few milliseconds: this runs while the journey's car is drawn).
 */
export async function layoutAddress(input: StationBakeInput, now: () => number = () => performance.now()): Promise<string> {
  const src = input.source, p = input.params;
  const h = new ContentHasher().str('terminal-state.lighting.address').num(DERIVED_LIGHTING_VERSIONS.gather, DERIVED_LIGHTING_VERSIONS.probes)
    .num(p.gain, p.range, p.uplight, p.lobe, p.scatter, p.bounce).num(src.trenchFloorY).bool(src.crossLevel !== false).str(input.extra);
  let t = now();
  const levels = (src.levels ?? [{id: 0, grid: src.grid, baseY: 0}]).slice(0, MAX_SLOTS);
  h.num(levels.length);
  for (const L of levels) {
    const g = L.grid;
    h.num(L.id, L.baseY, g.w, g.h).view(g.cells).view(g.floor).view(g.ceil).view(g.sightBlocked).view(g.rampIdx);
    if (now() - t >= BREATH_MS) { await new Promise<void>(r => setTimeout(r, 0)); t = now(); }
  }
  h.view(lightsView(src));
  return h.digest();
}

/** The digest of everything the gather reads: its options, the columns, the direct light the bake just made, the surface colours. */
function* gatherDigestSteps(ctx: IndirectContext, albedo: SurfaceAlbedo, gi: GiTier): BuildSteps<string> {
  const h = new ContentHasher().str('terminal-state.lighting.gather').num(DERIVED_LIGHTING_VERSIONS.gather)
    .num(gi.rays, gi.stride, gi.bounces, GATHER_REACH, GATHER_TUNING.gain, GATHER_TUNING.saturation, GATHER_TUNING.lift, GATHER_TUNING.ceiling, ctx.scatter, ctx.W, ctx.H, ctx.geos.length).num(...ctx.layers);
  for (let s = 0; s < ctx.geos.length; s++) {
    const g = ctx.geos[s];
    h.num(g.yMin, g.yMax).view(g.open).view(g.floorH).view(g.ceilH).view(g.layerY);
    yield;
    h.view(ctx.E[s]).view(ctx.D[s]).view(ctx.EL[s]).view(ctx.GL[s]).view(ctx.G2L[s]).view(albedo.slots[s]);
    yield;
  }
  return h.digest();
}

/** The digest of everything the probes read: the gather's inputs (columns, surface colours), the final field, the fixtures, the tier. */
function probesDigest(gatherDigest: string, field: BakedField, src: FieldSource, levels: readonly {id: number; baseY: number}[], tier: ReflectionTier): string {
  const h = new ContentHasher().str('terminal-state.lighting.probes').num(DERIVED_LIGHTING_VERSIONS.probes)
    .num(tier.tile, tier.maxProbes, tier.spacing, PROBE_FIXTURE_RADIANCE, PROBE_NORM_MIN, PROBE_REACH).num(...PROBE_LEVEL_SIGMA)
    .str(gatherDigest).num(field.w, field.h, field.depth, field.slots, field.layers, field.yMin, field.yMax, field.hdr ?? 0, field.gi ?? -1).view(field.data).view(field.groups);
  if (field.slotY) h.view(field.slotY);
  for (const L of levels) h.num(L.id, L.baseY);
  return h.view(lightsView(src)).digest();
}

/** A stored entry's probes, checked field by field (null: not usable — baked again). */
function probesFromEntry(entry: DerivedBundle, r: Record<string, unknown>, tier: ReflectionTier): BakedProbes | null {
  const L = r.layout;
  if (r.tier !== tier.id || !isObject(L) || !isObject(r.stats)) return null;
  const count = int(r.count), gridW = int(r.gridW), gridH = int(r.gridH), gridDepth = int(r.gridDepth), slots = int(r.slots), block = int(r.block);
  const width = int(L.width), height = int(L.height), cols = int(L.cols), rows = int(L.rows);
  const lt = L.levelTile, ly = L.levelY;
  if (count < 0 || gridW < 1 || gridH < 1 || gridDepth < 1 || slots < 1 || block < 1 || width < 1 || height < 1 || cols < 1 || rows < 1 || L.tile !== tier.tile) return null;
  if (!Array.isArray(lt) || !Array.isArray(ly) || lt.length !== 4 || ly.length !== 4 || lt.some(v => int(v) < 1) || ly.some(v => int(v) < 0)) return null;
  if (typeof r.ramp !== 'number' || !(r.ramp >= 0)) return null;
  const atlas = arr(entry, 'atlas', Uint16Array, width * height * 4);
  const grid = arr(entry, 'grid', Uint8Array, gridW * gridH * gridDepth * 4);
  const meta = entry.arrays.pmeta;
  if (!atlas || !grid || !(meta instanceof Float32Array) || meta.length < count * 12 || meta.length % 12 !== 0) return null;
  const layout: ProbeAtlasLayout = {tile: tier.tile, cols, rows, width, height, levelTile: lt as ProbeAtlasLayout['levelTile'], levelY: ly as ProbeAtlasLayout['levelY']};
  return {tier: tier.id, count, block, ramp: r.ramp, layout, atlas, meta, grid, gridW, gridH, gridDepth, slots, stats: r.stats as BakedProbes['stats']};
}

/** The gather's rows (world/lightFieldGather.ts: every value a rowValue) as their 16 bits: what the cache stores. */
function halves(rows: Float32Array): Uint16Array {
  const out = new Uint16Array(rows.length);
  for (let q = 0; q < rows.length; q++) out[q] = rowBits(rows[q]);
  return out;
}

/**
 * The capabilities of an initialised renderer backend (three's WebGPUBackend / WebGLBackend), read from the backend itself: the
 * device limits on WebGPU, the context's on WebGL 2. Never VRAM, never navigator.deviceMemory (see world/enhancedLighting.ts).
 * RGBA16F textures filter linearly in both APIs' core; `software` is the caller's (render/softwareGl.ts).
 */
export function lightingCapabilities(backend: unknown, kind: 'webgpu' | 'webgl2' | null, software: boolean, max3DTextureSize: number): LightingCapabilities {
  const b = backend as {device?: {limits?: {maxTextureDimension2D?: number}}; gl?: {MAX_TEXTURE_SIZE: number; getParameter(p: number): unknown}} | null | undefined;
  let max2D = 0;
  try {
    const lim = b?.device?.limits?.maxTextureDimension2D;
    if (typeof lim === 'number' && lim > 0) max2D = lim;
    else if (b?.gl && typeof b.gl.getParameter === 'function') { const v = b.gl.getParameter(b.gl.MAX_TEXTURE_SIZE); if (typeof v === 'number' && v > 0) max2D = v; }
  } catch { max2D = 0; }
  return {backend: kind, software, maxTextureSize: max2D, max3DTextureSize: Math.max(0, max3DTextureSize | 0), halfFloatLinear: kind !== null && max2D > 0};
}
