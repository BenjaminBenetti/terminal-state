// Task reactor-build-20261101 (lane ARCH): the Reactor's ASSET SEAMS — the GLB swap registry and the texture slots.
//
// GLB SWAP (one entry per set piece). Every piece is procedural today (world/reactor/archKit.ts). When the lead cooks a GLB into
// game/public/assets/models/reactor-<piece>.glb he flips that ONE entry to `delivered: true` with its real bytes / tris / dims; then
//  - REACTOR_MODEL_FILES lists it for the lazy prop library (game.ts propModels: fetched behind the Reactor's loading screen only —
//    assets/levelAssets.ts LEVEL_ONLY_RULES owns assets/models/reactor-*.glb for the 'reactor' level, like mall-*.glb for the mall);
//  - reactorModelKeysFor(layout) asks for it on a Reactor layout (game.ts sectionModelKeys);
//  - the kit builder instances the model on every record of that piece instead of the procedural body (fit below) and keeps its
//    procedural extras (generator control box + lamps, cable runs, pipe-bank catwalks + lamps, vessel glow parts, crane runways).
// `delivered: false` entries are never fetched and never in the file map (no 404s, no late fetches): procedural pieces stand.
//
// TEXTURE SLOTS: the Codex tileable textures (lead-delivered, game/public/assets/textures/reactor/*.jpg). Same switch: a slot with
// `delivered: true` is loaded by the Reactor's section preload (LevelResources, level 'reactor': released when the run leaves the
// level) and replaces the reused approved surface set of the materials using it (world/reactor/archMaterials.ts). Until then the
// reactor surfaces reuse the repo's EXISTING approved surface sets (tunnel concrete, painted block, steel / slat sets) with tints
// and the existing decay hooks — no new hand-drawn texture (CLAUDE.md "Codex for INITIAL sources").
// Pure data + small helpers (no three.js): Node tests, the CI packager families and the runtime agree.

/** The set pieces that can switch from procedural to a cooked GLB. */
export type ReactorPiece =
  | 'crane-trolley' | 'crane-hook' | 'pipe-bank' | 'aux-generator' | 'vessel'
  | 'switchgear' | 'coolant-pump' | 'valve' | 'control-console';

/**
 * How a delivered model is fitted onto its record:
 *  - 'record'  : stretched to the record's box (generator size w x h x d; machine boxes) — base on the floor, front +Z;
 *  - 'uniform' : one uniform scale so the model's real `dims` fit the record's box (keeps proportions), base anchored;
 *  - 'real'    : real size (dims are metres; no scaling) at the record's anchor (trolley on the bridge, hook block at hookY);
 *  - 'stack'   : a stackable module tiled along the record (pipe bank: every dims[0] m along the wall, every dims[1] m up).
 */
export type ReactorFit = 'record' | 'uniform' | 'real' | 'stack';

export interface ReactorModelSpec {
  piece: ReactorPiece;
  /** Lazy-library key (assets/loader.ts PropModelLibrary): 'reactor-<piece>'. */
  key: string;
  /** Site-relative runtime path: 'assets/models/reactor-<piece>.glb' (level-only: the Reactor). */
  url: string;
  /** Cooked GLB bytes / triangles (0 until delivered). */
  bytes: number;
  tris: number;
  /** Real-size W x H x D (m) of the model as authored (front +Z, base at y 0); the procedural stand-in's nominal size until delivered. */
  dims: readonly [number, number, number];
  fit: ReactorFit;
  anchor: 'bottom' | 'top';
  /** false: not cooked yet — never fetched; the procedural piece stands. */
  delivered: boolean;
}

const spec = (piece: ReactorPiece, dims: readonly [number, number, number], fit: ReactorFit, anchor: 'bottom' | 'top' = 'bottom'): ReactorModelSpec =>
  ({piece, key: `reactor-${piece}`, url: `assets/models/reactor-${piece}.glb`, bytes: 0, tris: 0, dims, fit, anchor, delivered: false});

/**
 * THE registry (the lead edits one entry per delivered model: delivered true + bytes / tris / dims).
 * Nominal dims = the procedural stand-in's size (archKit.ts), so a delivered model of the same size drops in unchanged.
 */
export const REACTOR_MODELS: Readonly<Record<ReactorPiece, ReactorModelSpec>> = {
  'crane-trolley': spec('crane-trolley', [2.6, 1.6, 2.4], 'real'),
  'crane-hook': spec('crane-hook', [1.1, 2.6, 0.6], 'real', 'top'),
  'pipe-bank': spec('pipe-bank', [4, 4, 1.6], 'stack'),
  'aux-generator': spec('aux-generator', [4.2, 2.4, 1.8], 'record'),
  vessel: spec('vessel', [10, 12, 10], 'uniform'),
  switchgear: spec('switchgear', [0.8, 2.1, 0.6], 'record'),
  'coolant-pump': spec('coolant-pump', [1.8, 1.3, 1.1], 'record'),
  valve: spec('valve', [0.9, 1.6, 0.6], 'record'),
  'control-console': spec('control-console', [1.6, 1.15, 0.85], 'record'),
};

export const REACTOR_PIECES = Object.keys(REACTOR_MODELS) as ReactorPiece[];

/** Lazy-library file map of the DELIVERED Reactor models (game.ts propModels). Empty until the lead delivers one. */
export function reactorModelFiles(models: Readonly<Record<ReactorPiece, ReactorModelSpec>> = REACTOR_MODELS): Record<string, {url: string; bytes: number}> {
  const out: Record<string, {url: string; bytes: number}> = {};
  for (const p of REACTOR_PIECES) { const m = models[p]; if (m.delivered) out[m.key] = {url: m.url, bytes: m.bytes}; }
  return out;
}
export const REACTOR_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = reactorModelFiles();

/** The lazy keys a layout needs (game.ts sectionModelKeys): every delivered Reactor model on a Reactor layout, else none. */
export function reactorModelKeysFor(layout: {reactor?: unknown}, models: Readonly<Record<ReactorPiece, ReactorModelSpec>> = REACTOR_MODELS): readonly string[] {
  if (!layout.reactor) return [];
  return REACTOR_PIECES.filter(p => models[p].delivered).map(p => models[p].key);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Texture slots (Codex tileable textures, lead-delivered)

export type ReactorTextureSlot = 'pitConcrete' | 'rustedSteel' | 'grating';

export interface ReactorTextureSpec {
  slot: ReactorTextureSlot;
  /** Colour map (sRGB): 'assets/textures/reactor/<name>.jpg'. Optional normal map (linear) beside it: '<name>-normal.jpg'. */
  url: string;
  normalUrl: string;
  /** Real-world span (m) one tile covers (u, v): world-mapped / UV scale of the surfaces using it. */
  span: readonly [number, number];
  /** Which reactor surfaces / dressing materials take it (archMaterials.ts). */
  uses: readonly string[];
  delivered: boolean;
  /** The normal map is delivered too. */
  normal: boolean;
}

const tex = (slot: ReactorTextureSlot, name: string, span: readonly [number, number], uses: readonly string[]): ReactorTextureSpec =>
  ({slot, url: `assets/textures/reactor/${name}.jpg`, normalUrl: `assets/textures/reactor/${name}-normal.jpg`, span, uses, delivered: false, normal: false});

/** THE texture slots (the lead flips `delivered` / `normal` when the Codex files land). */
export const REACTOR_TEXTURES: Readonly<Record<ReactorTextureSlot, ReactorTextureSpec>> = {
  pitConcrete: tex('pitConcrete', 'pit-concrete', [4, 4], ['reactor-wall', 'reactor-roof']),
  rustedSteel: tex('rustedSteel', 'rusted-steel', [2, 2], ['reactor-deck-under', 'reactor-plate', 'steel', 'steelDark']),
  grating: tex('grating', 'grating', [1, 1], ['reactor-grating', 'grating']),
};

export const REACTOR_TEXTURE_SLOTS = Object.keys(REACTOR_TEXTURES) as ReactorTextureSlot[];

/** The level id the Reactor's level-only assets belong to (levels/types.ts LevelId 'reactor'). */
export const REACTOR_LEVEL = 'reactor';

/** Delivered texture files to preload ([url, srgb] pairs; colour + optional normal). Empty until the lead delivers one. */
export function reactorTextureLoads(textures: Readonly<Record<ReactorTextureSlot, ReactorTextureSpec>> = REACTOR_TEXTURES): {slot: ReactorTextureSlot; url: string; srgb: boolean; normal: boolean}[] {
  const out: {slot: ReactorTextureSlot; url: string; srgb: boolean; normal: boolean}[] = [];
  for (const s of REACTOR_TEXTURE_SLOTS) {
    const t = textures[s];
    if (!t.delivered) continue;
    out.push({slot: s, url: t.url, srgb: true, normal: false});
    if (t.normal) out.push({slot: s, url: t.normalUrl, srgb: false, normal: true});
  }
  return out;
}

/**
 * The textures the Reactor's section preload resolved (per slot: colour / normal), read synchronously by the material factory
 * while the world is built. `version` bumps on every change so cached materials pick up a reloaded texture after a level change
 * (LevelResources disposes the old ones when the run leaves the Reactor).
 */
export const reactorTextureStore: {version: number; color: Partial<Record<ReactorTextureSlot, unknown>>; normal: Partial<Record<ReactorTextureSlot, unknown>>} =
  {version: 0, color: {}, normal: {}};

export function setReactorTexture(slot: ReactorTextureSlot, kind: 'color' | 'normal', t: unknown | null): void {
  const cur = reactorTextureStore[kind][slot];
  if (cur === (t ?? undefined)) return;
  if (t) reactorTextureStore[kind][slot] = t; else delete reactorTextureStore[kind][slot];
  reactorTextureStore.version++;
}
