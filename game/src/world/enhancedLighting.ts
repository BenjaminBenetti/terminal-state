// Task studio-baked-lighting-reflections-20261114-050258-01: ENHANCED LIGHTING — the contract, the capability policy and the status text.
//
// Enhanced lighting is made from the REALIZED station (never from its seed); what is baked is cached as derived data outside the save
// (core/derivedCache.ts). Task studio-baked-gi-visual-uplift-20261115-004324-01 rebuilt it for a result that shows:
//  - the load-time light field (world/lightField.ts) baked with a ray-gathered, material-coloured, multi-bounce indirect term with
//    real architectural occlusion (world/lightFieldGather.ts), kept per voxel as an AMBIENT CUBE (what a floor, a ceiling and the
//    four wall orientations there receive) and — FULL shading — read by the surface normal: three more filtered fetches of the same
//    3D texture per lit pixel. PLAIN shading is the baseline's light node on the enhanced field: no frame cost;
//  - with full shading, the FLASHLIGHT'S BOUNCE, live (world/flashBounce.ts): a few virtual lights where the beam lands, coloured by
//    what it lands on — the only light there is in most of a station;
//  - cached local reflection probes for metal, glazed tile and glass (world/reflectionProbes.ts, world/reflectionNode.ts): small
//    prefiltered maps ray-cast on the CPU from the station's fixed architecture, its baked light and its fixtures;
//  - on top of the probes, a LIVE GLASS MIRROR (render/glassMirror.ts): the real scene drawn once more from behind the glass plane
//    the player faces — props, characters, the flashlight's light and its bounce.
//
// This module is a LEAF (no three, no DOM): the settings store, the menu, the game and the tests share it.
//  - Off  = the baseline: the unchanged bake, the unchanged light node, no cache access, no extra texture or shader.
//  - Auto = everything a hardware renderer does cheaply: the 'standard' bake and full shading on any hardware backend; reflections
//           and the mirror on the hardware WebGPU backend when its real limits fit them. A software renderer gets the bake with
//           plain shading (its frame budget is the unknown one), the WebGL 2 fallback no reflections.
//  - On   = the manual opt-in: the 'high' bake, full shading, reflections and the mirror on any renderer that can run them.
// What a browser does NOT tell us is never guessed: total / free VRAM is not exposed, and navigator.deviceMemory or an adapter limit
// proves nothing about it — so nothing here reads them. The feature's own GPU memory is bounded instead (the field's cube and
// FIELD_CUBE_BYTES, REFLECTION_TIERS, MIRROR_TEXELS), and what could not be used is reported with its reason (EnhancedLightingStatus).

export type EnhancedLightingMode = 'off' | 'auto' | 'on';
export type ReflectionQuality = 'off' | 'standard' | 'high';

export const ENHANCED_LIGHTING_MODES: readonly EnhancedLightingMode[] = ['off', 'auto', 'on'];
export const REFLECTION_QUALITIES: readonly ReflectionQuality[] = ['off', 'standard', 'high'];

/** The defaults (ui/settingsStore.ts SETTINGS_DEFAULTS; a record from before the settings existed reads these). */
export const ENHANCED_LIGHTING_DEFAULT: EnhancedLightingMode = 'auto';
export const REFLECTIONS_DEFAULT: ReflectionQuality = 'standard';

export const isEnhancedLightingMode = (v: unknown): v is EnhancedLightingMode => v === 'off' || v === 'auto' || v === 'on';
export const isReflectionQuality = (v: unknown): v is ReflectionQuality => v === 'off' || v === 'standard' || v === 'high';

/** What the player asked for (the two settings). */
export interface EnhancedLightingRequest { lighting: EnhancedLightingMode; reflections: ReflectionQuality }

// ---------------------------------------------------------------------------------------------
// Tiers (every number here is part of the cache key: world/enhancedLightingRuntime.ts)

/** The indirect-light gather of the enhanced bake (world/lightFieldGather.ts). */
export interface GiTier {
  id: 'standard' | 'high';
  /** Rays per gathering voxel. */
  rays: number;
  /** 2 = every other cell in x and z gathers (a 1 m lattice) and the cells between are filled from it; 1 = every cell gathers. */
  stride: 1 | 2;
  /** Light bounces followed. */
  bounces: number;
}

export const GI_TIERS: Readonly<Record<GiTier['id'], GiTier>> = {
  standard: {id: 'standard', rays: 16, stride: 2, bounces: 3},
  high: {id: 'high', rays: 32, stride: 1, bounces: 3},
};

/** The reflection probes (world/reflectionProbes.ts). */
export interface ReflectionTier {
  id: 'standard' | 'high';
  /** Edge of a probe's sharpest octahedral map (px); three blurrier levels halve it. */
  tile: number;
  /** Most probes in one station (ids are one byte: at most 255). */
  maxProbes: number;
  /** Target spacing between probes along a large space (m). */
  spacing: number;
}

export const REFLECTION_TIERS: Readonly<Record<ReflectionTier['id'], ReflectionTier>> = {
  standard: {id: 'standard', tile: 32, maxProbes: 192, spacing: 9},
  high: {id: 'high', tile: 64, maxProbes: 240, spacing: 7},
};

// ---------------------------------------------------------------------------------------------
// Capabilities and the plan

/** What the initialised renderer really offers (world/enhancedLightingRuntime.ts lightingCapabilities; never VRAM). */
export interface LightingCapabilities {
  backend: 'webgpu' | 'webgl2' | null;
  /** A software rasterizer (render/softwareGl.ts: llvmpipe, SwiftShader, lavapipe, a fallback adapter). */
  software: boolean;
  /** Largest 2D / 3D texture edge. */
  maxTextureSize: number;
  max3DTextureSize: number;
  /** RGBA16F textures can be sampled with linear filtering (core in WebGPU and WebGL2; false only on a broken / unknown backend). */
  halfFloatLinear: boolean;
}

/** How an enhanced field is shaded (see the module doc). */
export type FieldShading = 'plain' | 'full';

/** What a station is built with. null = that part is the baseline; the reason says why when it was asked for. */
export interface EnhancedLightingPlan {
  gi: GiTier | null;
  /** 'full' only with `gi`. */
  shading: FieldShading;
  reflections: ReflectionTier | null;
  /** The live glass mirror, with `reflections` only. */
  mirror: boolean;
  giReason: string | null;
  /** Why the shading is plain although the bake is enhanced. */
  shadingReason: string | null;
  reflectionsReason: string | null;
}

/** The plan of a station that is not enhanced. */
export const baselinePlan = (giReason: string | null = null, reflectionsReason: string | null = null): EnhancedLightingPlan =>
  ({gi: null, shading: 'plain', reflections: null, mirror: false, giReason, shadingReason: null, reflectionsReason});

/**
 * Most bytes of a station's field texture WITH its ambient cube (RGBA8, 3D). A larger station keeps the enhanced bake and is
 * shaded plain (the cube is left out). The six stations measured (seed 93): 3 to 45 MB.
 */
export const FIELD_CUBE_BYTES = 96e6;
/** Texels of the glass mirror's target per reflection tier (width x height; drawn at the scene pass's sample count). */
export const MIRROR_TEXELS: Readonly<Record<ReflectionTier['id'], readonly [number, number]>> = {standard: [1024, 512], high: [1536, 768]};

export const REACTOR_REASON = 'not used in the Reactor (its lighting is unchanged)';
export const SOFTWARE_SHADING_REASON = 'Auto keeps the baseline shader on a software renderer (On uses the full one)';
export const SOFTWARE_REASON = 'Auto skips reflections on a software renderer (On forces them)';
export const FALLBACK_REASON = 'Auto skips reflections on the WebGL 2 fallback renderer (On forces them)';

/** Smallest 2D texture edge the probe atlas of `t` needs (world/reflectionProbes.ts atlasLayout: 16 tiles a row, four levels). */
export function reflectionAtlasEdge(t: ReflectionTier): number {
  const cols = 16, rows = Math.ceil(t.maxProbes / cols);
  let h = 0;
  for (let l = 0, s = t.tile; l < 4; l++, s = Math.max(1, s >> 1)) h += rows * (s + 2);
  return Math.max(cols * (t.tile + 2), h + 4);
}

/**
 * The plan for one station: pure, from the request, the renderer's real capabilities and the level. Auto never asks for what the
 * capabilities do not show; On asks for everything that can run and says what cannot.
 */
export function planEnhancedLighting(req: EnhancedLightingRequest, caps: LightingCapabilities, level: {reactor: boolean}): EnhancedLightingPlan {
  if (req.lighting === 'off') return baselinePlan();
  if (level.reactor) return baselinePlan(REACTOR_REASON, req.reflections === 'off' ? null : REACTOR_REASON);
  const gi = GI_TIERS[req.lighting === 'on' ? 'high' : 'standard'];
  // full shading: asked for outright (On), or on any hardware renderer (Auto)
  const shadingReason = !caps.backend ? 'the renderer is not ready' : req.lighting === 'auto' && caps.software ? SOFTWARE_SHADING_REASON : null;
  const base = {gi, shading: (shadingReason ? 'plain' : 'full') as FieldShading, giReason: null, shadingReason};
  const no = (reflectionsReason: string | null): EnhancedLightingPlan => ({...base, reflections: null, mirror: false, reflectionsReason});
  if (req.reflections === 'off') return no(null);
  if (!caps.backend) return no('the renderer is not ready');
  if (!caps.halfFloatLinear) return no('this renderer cannot filter half-float textures');
  if (req.lighting === 'auto' && caps.software) return no(SOFTWARE_REASON);
  if (req.lighting === 'auto' && caps.backend !== 'webgpu') return no(FALLBACK_REASON);
  let tier = REFLECTION_TIERS[req.reflections];
  if (reflectionAtlasEdge(tier) > caps.maxTextureSize) {
    tier = REFLECTION_TIERS.standard;
    if (reflectionAtlasEdge(tier) > caps.maxTextureSize) return no(`this renderer's largest texture (${caps.maxTextureSize} px) is too small for the probe atlas`);
    return {...base, reflections: tier, mirror: true, reflectionsReason: `High needs a larger texture than this renderer allows (${caps.maxTextureSize} px): Standard is used`};
  }
  return {...base, reflections: tier, mirror: true, reflectionsReason: null};
}

// ---------------------------------------------------------------------------------------------
// Status (what the settings form, the perf overlay, the recorder and QA show)

/** How the live station's enhanced data was obtained. */
export type LightingCacheUse = 'hit' | 'miss' | 'stale' | 'unavailable' | 'none';

/** What the LIVE station was actually built with. */
export interface EnhancedLightingActive {
  /** The field bake: 'baseline' (today's) or the enhanced tier. */
  gi: 'baseline' | GiTier['id'];
  giReason: string | null;
  /** How the field is shaded ('plain' with the baseline bake; absent in a record from before the field existed: plain). */
  shading?: FieldShading;
  shadingReason?: string | null;
  /** The live glass mirror is part of the station's lighting (it draws only while the volumetric frame path is on). */
  mirror?: boolean;
  reflections: 'off' | ReflectionTier['id'];
  reflectionsReason: string | null;
  /** 'hit' = read from the derived cache; 'miss' = baked now and stored; 'stale' = an entry existed but its inputs differed (baked again);
   *  'unavailable' = baked now, nothing could be stored; 'none' = nothing enhanced, the cache was not touched. */
  cache: LightingCacheUse;
  /** Main-thread time of the enhanced work in this load (ms; 0 on a cache hit): the gather / the probes. */
  giMs: number;
  probeMs: number;
  /** Probes in the station (0 without reflections) and the reflection textures' GPU bytes. */
  probes: number;
  probeBytes: number;
}

export interface EnhancedLightingStatus {
  requested: EnhancedLightingRequest;
  /** null before the first station of the session is built. */
  active: EnhancedLightingActive | null;
  /**
   * The settings would build the live station differently. The game applies such a change to the live station from the pause menu
   * (Game.relightAfterSettings: at once when it is made there, else the next time the game is paused); a station load applies it too.
   */
  pending: boolean;
  /** The derived cache's backend: 'indexeddb', 'memory' (this session only: storage is unavailable) or 'none' (not opened: Off). */
  cacheBackend: 'indexeddb' | 'memory' | 'none';
  /** The live station's lighting is being rebuilt for a changed choice right now (the pause menu holds Resume meanwhile). */
  applying?: boolean;
  /** Why the last change could not be applied to the live station (null / absent: none failed; cleared by the next one that works). */
  error?: string | null;
}

export const ENHANCED_LIGHTING_LABEL = 'Enhanced lighting';
export const REFLECTIONS_LABEL = 'Reflections';
export const ENHANCED_LIGHTING_OPTIONS: readonly {value: EnhancedLightingMode; label: string}[] = [{value: 'auto', label: 'Auto'}, {value: 'on', label: 'On'}, {value: 'off', label: 'Off'}];
export const REFLECTION_OPTIONS: readonly {value: ReflectionQuality; label: string}[] = [{value: 'standard', label: 'Standard'}, {value: 'high', label: 'High'}, {value: 'off', label: 'Off'}];

/** What each choice means, without a station (the form's line before one is built). */
export function enhancedLightingSummary(mode: EnhancedLightingMode): string {
  return mode === 'off' ? 'Off: the baseline station lighting'
    : mode === 'on' ? 'On: bounced, material-coloured light baked per station at full quality (a longer first load) and the flashlight\'s bounce, on any renderer'
      : 'Auto: bounced, material-coloured light baked per station and the flashlight\'s bounce; reflections on a hardware WebGPU renderer';
}

export function reflectionsSummary(q: ReflectionQuality): string {
  return q === 'off' ? 'Off: no reflections of the station'
    : q === 'high' ? 'High: a live mirror image in the glass you face, sharper cached reflections on metal, glazed tile and other glass (more probes, about four times the texture memory)'
      : 'Standard: a live mirror image in the glass you face, cached reflections of the station on metal, glazed tile and other glass';
}

/** A changed choice that the live station does not use yet (see EnhancedLightingStatus.pending). */
export const PENDING_NOTE = 'Not applied yet: it is applied when the game is paused, or when a station next loads.';
/** The live station's lighting is being rebuilt for a changed choice. */
export const APPLYING_NOTE = 'Rebuilding this station\'s lighting…';
/** A change that could not be applied: the station keeps what it had (`reason` as reported). */
export const applyFailedNote = (reason: string): string => `The change could not be applied (${reason}): the station keeps this lighting.`;

/** What follows a "This station: …" line: the rebuild in progress, a failed change, a change not applied yet — or nothing. */
function changeNote(s: EnhancedLightingStatus): string {
  return s.applying ? APPLYING_NOTE : s.error ? applyFailedNote(s.error) : s.pending ? PENDING_NOTE : '';
}

const cacheText = (c: LightingCacheUse): string => c === 'hit' ? 'from the cache' : c === 'miss' ? 'baked and cached' : c === 'stale' ? 'baked again (the cached one no longer matched)'
  : c === 'unavailable' ? 'baked (browser storage is unavailable: it is baked on every load)' : '';

/** The line under the Enhanced lighting choice: what the live station really uses (and why not what was asked), else what the choice means. */
export function describeEnhancedLighting(s: EnhancedLightingStatus): string {
  const a = s.active, want = s.requested.lighting;
  if (!a) return enhancedLightingSummary(want);
  const now = a.gi === 'baseline'
    ? (a.giReason ? `This station: baseline lighting — ${a.giReason}` : 'This station: baseline lighting')
    : `This station: enhanced bake (${a.gi}), ${cacheText(a.cache)}${a.shading === 'plain' && a.shadingReason ? ` — ${a.shadingReason}` : ''}`;
  const note = changeNote(s);
  return note ? `${now}. ${note}` : want === 'off' && a.gi === 'baseline' && !a.giReason ? enhancedLightingSummary('off') : now;
}

/** The line under the Reflections choice. */
export function describeReflections(s: EnhancedLightingStatus): string {
  const a = s.active, want = s.requested.reflections;
  if (s.requested.lighting === 'off') return 'Needs Enhanced lighting (it is off)';
  if (!a) return reflectionsSummary(want);
  const now = a.reflections === 'off'
    ? (a.reflectionsReason ? `This station: no reflections — ${a.reflectionsReason}` : 'This station: no reflections')
    : `This station: ${a.mirror ? 'glass mirror, ' : ''}${a.probes} probes (${a.reflections})${a.reflectionsReason ? ` — ${a.reflectionsReason}` : ''}`;
  const note = changeNote(s);
  return note ? `${now}. ${note}` : want === 'off' && a.reflections === 'off' && !a.reflectionsReason ? reflectionsSummary('off') : now;
}

/** One compact line (perf overlay / recorder / QA): 'auto: bake standard full · refl standard ×187 + mirror · cache hit', 'off: baseline · refl off'. */
export function enhancedLightingLine(s: EnhancedLightingStatus): string {
  const a = s.active;
  if (!a) return `${s.requested.lighting} (no station)`;
  const gi = a.gi === 'baseline' ? `baseline${a.giReason ? ` (${a.giReason})` : ''}` : `bake ${a.gi}${a.shading === 'full' ? ' full' : ' plain'}`;
  const rf = a.reflections === 'off' ? `refl off${a.reflectionsReason ? ` (${a.reflectionsReason})` : ''}` : `refl ${a.reflections} ×${a.probes}${a.mirror ? ' + mirror' : ''}`;
  return `${s.requested.lighting}: ${gi} · ${rf}${a.cache !== 'none' ? ` · cache ${a.cache}` : ''}${s.applying ? ' · applying a change' : s.error ? ' · change failed' : s.pending ? ' · change pending' : ''}`;
}

/** The plan as the `active` fields it would produce (to tell whether a settings change is pending). */
export function planSignature(p: EnhancedLightingPlan): string {
  return `${p.gi ? `${p.gi.id}-${p.shading}` : 'baseline'}|${p.reflections ? `${p.reflections.id}${p.mirror ? '+mirror' : ''}` : 'off'}`;
}
