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

import {ContentHasher} from '../core/contentHash';
import {openDerivedCache, type DerivedBundle, type DerivedCache, type DerivedCacheStats} from '../core/derivedCache';
import type {BuildSteps} from '../core/pacedBuild';
import {
  ENHANCED_LIGHTING_DEFAULT, REFLECTIONS_DEFAULT, planEnhancedLighting, planSignature,
  type EnhancedLightingActive, type EnhancedLightingPlan, type EnhancedLightingRequest, type EnhancedLightingStatus, type GiTier, type LightingCacheUse,
  type LightingCapabilities, type ReflectionTier,
} from './enhancedLighting';
import {MAX_SLOTS, bakeLightFieldSteps, type BakedField, type ColumnGeometry, type FieldParams, type FieldSource} from './lightField';
import {GATHER_GAIN, GATHER_REACH, IND_STRIDE, gatherIndirectSteps, indirectIndex, type IndirectContext, type IndirectLight} from './lightFieldGather';
import {BandScene} from './lightScene';
import {
  PROBE_FIXTURE_RADIANCE, PROBE_LEVEL_SIGMA, PROBE_NORM_MIN, PROBE_REACH, bakeReflectionProbesSteps, probeBytes, type BakedProbes, type ProbeAtlasLayout,
} from './reflectionProbes';
import {surfaceAlbedoSteps, type DrawnSurfaces, type SurfaceAlbedo} from './surfaceAlbedo';

/** The two settings as the game holds them (game.ts Settings; optional: hosts / tests from before them read the defaults). */
export interface EnhancedLightingSettings { enhancedLighting?: EnhancedLightingRequest['lighting']; reflections?: EnhancedLightingRequest['reflections'] }

/**
 * Versions of the cached data. Bump GATHER when world/lightFieldGather.ts (or the ray scene / the albedo bytes it reads) gives a
 * different result for the same inputs, PROBES likewise for world/reflectionProbes.ts, ENTRY when the stored layout changes.
 * (Everything upstream — generation, fixtures, the direct bake, the finishes — is covered by content: see inputs digests.)
 */
export const DERIVED_LIGHTING_VERSIONS = {entry: 1, gather: 1, probes: 2} as const;

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
}

/** Main-thread times of the last enhanced load (ms; diagnostics / the cost report). */
export interface EnhancedLightingTimings {
  /** Hashing the address (prefetch) and reading + unpacking the entry. */
  addressMs: number; fetchMs: number;
  /** Surface colours, the inputs digests, the gather, the probes (0 when taken from the cache). */
  albedoMs: number; digestMs: number; giMs: number; probeMs: number;
  /** The whole lighting bake of the load (direct light and encoding included). */
  totalMs: number;
}

export interface EnhancedLightingRuntimeOptions {
  /** Opens the derived cache (default core/derivedCache.ts openDerivedCache(); tests inject one). Called at most once. */
  openCache?: () => DerivedCache;
  /** Clock (ms). */
  now?: () => number;
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
  /** What the live station was planned with (pending = the settings now plan something else for it). */
  private live: {signature: string; reactor: boolean} | null = null;
  private caps: LightingCapabilities = {backend: null, software: false, maxTextureSize: 0, max3DTextureSize: 0, halfFloatLinear: false};
  private cache: DerivedCache | null = null;
  private fetched: Fetched | null = null;
  private readonly now: () => number;
  /** The last enhanced load's main-thread times (null: none yet). */
  timings: EnhancedLightingTimings | null = null;

  constructor(private readonly settings: EnhancedLightingSettings, private readonly opts: EnhancedLightingRuntimeOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
  }

  /** What the initialised renderer really offers (Game.initRenderer; before it: nothing — no reflections are planned). */
  setCapabilities(caps: LightingCapabilities): void {
    this.caps = {...caps};
    this.changed();
  }
  capabilities(): LightingCapabilities { return {...this.caps}; }

  /** What the player asked for right now. */
  request(): EnhancedLightingRequest {
    return {lighting: this.settings.enhancedLighting ?? ENHANCED_LIGHTING_DEFAULT, reflections: this.settings.reflections ?? REFLECTIONS_DEFAULT};
  }

  /** The plan for a station under the settings and capabilities of this moment. */
  plan(reactor: boolean): EnhancedLightingPlan {
    return planEnhancedLighting(this.request(), this.caps, {reactor});
  }

  /** What the live station uses, what was asked, and whether a change is waiting for the next station load. */
  status(): EnhancedLightingStatus {
    const pending = !!this.live && planSignature(this.plan(this.live.reactor)) !== this.live.signature;
    return {requested: this.request(), active: this.active, pending, cacheBackend: this.cache ? this.cache.backend : 'none'};
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

  private entryKey(layoutKey: string, plan: EnhancedLightingPlan): string {
    return `el${DERIVED_LIGHTING_VERSIONS.entry}-${plan.gi!.id}-${plan.reflections?.id ?? 'none'}-${layoutKey}`;
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
      const key = this.entryKey(layoutKey, plan);
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
   */
  *bakeSteps(input: StationBakeInput, drawn: DrawnSurfaces | null | undefined, o: {max3DTextureSize?: number} = {}): BuildSteps<EnhancedBake> {
    const plan = this.plan(input.reactor);
    this.live = {signature: planSignature(plan), reactor: input.reactor};
    if (!plan.gi) {
      this.fetched = null;
      this.timings = null;
      this.active = {gi: 'baseline', giReason: plan.giReason, reflections: 'off', reflectionsReason: plan.reflectionsReason, cache: 'none', giMs: 0, probeMs: 0, probes: 0, probeBytes: 0};
      this.changed();
      return {baked: undefined, probes: null};
    }
    const now = this.now, tStart = now();
    const src = input.source, gi = plan.gi;
    // the fetched entry, if it is this station's and this plan's
    let fetched = this.fetched;
    this.fetched = null;
    if (fetched && fetched.grid !== src.grid) fetched = null;
    if (fetched && fetched.key !== this.entryKey(fetched.layoutKey, plan)) fetched = {...fetched, key: this.entryKey(fetched.layoutKey, plan), bundle: null};
    const entry = fetched?.bundle && isObject(fetched.bundle.meta) && fetched.bundle.meta.v === DERIVED_LIGHTING_VERSIONS.entry ? fetched.bundle : null;
    const timings: EnhancedLightingTimings = {addressMs: fetched?.addressMs ?? 0, fetchMs: fetched?.fetchMs ?? 0, albedoMs: 0, digestMs: 0, giMs: 0, probeMs: 0, totalMs: 0};
    const levels = (src.levels ?? [{id: 0, role: 'main', grid: src.grid, baseY: 0}]).slice(0, MAX_SLOTS) as NonNullable<FieldSource['levels']>;

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
        const rows = arr(entry!, 'gi', Float32Array, count * IND_STRIDE);
        if (rows) {
          hook.use = 'hit';
          const stats = g.stats as IndirectLight['stats'];
          hook.got = {geos: ctx.geos, albedo, scene: null, digest, rows, stats};
          return {index, data: rows, stats};
        }
      }
      hook.use = g ? 'stale' : 'miss';
      const scene = new BandScene(ctx.W, ctx.H, ctx.geos);
      const ind = yield* gatherIndirectSteps(ctx, {rays: gi.rays, bounces: gi.bounces, stride: gi.stride, reach: GATHER_REACH, gain: GATHER_GAIN, albedo, scene});
      timings.giMs = ind.stats.ms;
      hook.got = {geos: ctx.geos, albedo, scene, digest, rows: ind.data, stats: ind.stats};
      return ind;
    };
    const baked = yield* bakeLightFieldSteps({...src, indirect}, input.params);
    const got = hook.got, giUse = hook.use;
    if (!got) throw new Error('enhanced lighting: the bake did not run its indirect step');

    // --- reflection probes ---------------------------------------------------------------------
    let probes: BakedProbes | null = null, rpUse: 'hit' | 'miss' | 'stale' | 'none' = 'none', rpDigest = '';
    let reflectionsReason = plan.reflectionsReason;
    const tier = plan.reflections;
    const max3D = o.max3DTextureSize ?? this.caps.max3DTextureSize;
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
        probes = yield* bakeReflectionProbesSteps({field: baked, geos: got.geos, levels, albedo: got.albedo, lights: src.lights, scene: got.scene ?? undefined}, tier);
        timings.probeMs = now() - t;
      }
    }

    // --- 3. store what was made --------------------------------------------------------------
    const baked1 = giUse !== 'hit' || (rpUse !== 'hit' && rpUse !== 'none');
    const persistent = fetched ? fetched.persistent : false;
    let use: LightingCacheUse = !baked1 ? 'hit' : giUse === 'stale' || rpUse === 'stale' ? 'stale' : 'miss';
    if (baked1) {
      const key = fetched?.key ?? null;
      if (key) this.store(key, got, probes, rpDigest);
      else this.storeLater(input, plan, got, probes, rpDigest);
      if (fetched && !persistent) use = 'unavailable';
    }
    timings.totalMs = now() - tStart;
    this.timings = timings;
    this.active = {
      gi: gi.id, giReason: null, reflections: probes && probes.count > 0 ? probes.tier : 'off',
      reflectionsReason: tier && probes && probes.count < 1 ? 'this station has no place for a probe' : reflectionsReason,
      cache: use, giMs: timings.giMs, probeMs: timings.probeMs, probes: probes?.count ?? 0, probeBytes: probes && probes.count > 0 ? probeBytes(probes) : 0,
    };
    this.changed();
    return {baked, probes: probes && probes.count > 0 ? probes : null};
  }

  /**
   * What the station lighting made of the probes (world/lights.ts StationLighting.reflectionsSkipped): they may not have been
   * usable after all (no node library, a grid past the 3D texture limit) — the status says so.
   */
  applied(skipped: string | null): void {
    const a = this.active;
    if (!a || !skipped || a.reflections === 'off') return;
    this.active = {...a, reflections: 'off', reflectionsReason: skipped, probes: 0, probeBytes: 0};
    this.changed();
  }

  private store(key: string, got: {digest: string; rows: Float32Array; stats: IndirectLight['stats']}, probes: BakedProbes | null, rpDigest: string): void {
    const bundle: DerivedBundle = {
      meta: {v: DERIVED_LIGHTING_VERSIONS.entry, gi: {inputs: got.digest, stats: {...got.stats}}, rp: null},
      arrays: {gi: got.rows},
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
  private storeLater(input: StationBakeInput, plan: EnhancedLightingPlan, got: {digest: string; rows: Float32Array; stats: IndirectLight['stats']}, probes: BakedProbes | null, rpDigest: string): void {
    layoutAddress(input, this.now).then(k => this.store(this.entryKey(k, plan), got, probes, rpDigest), err => { console.warn('enhanced lighting: the bake could not be cached', err); });
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
    .num(gi.rays, gi.stride, gi.bounces, GATHER_REACH, GATHER_GAIN, ctx.scatter, ctx.W, ctx.H, ctx.geos.length).num(...ctx.layers);
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
    .str(gatherDigest).num(field.w, field.h, field.depth, field.slots, field.layers, field.yMin, field.yMax, field.hdr ?? 0).view(field.data).view(field.groups);
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
