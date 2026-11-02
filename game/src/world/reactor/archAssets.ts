// Task reactor-build-20261101 (lane ARCH): the Reactor's ASSET SEAMS — the GLB swap registry and the texture slots, on top of the
// lead's cooked kit (assets/reactorKit.generated.ts REACTOR_KIT / REACTOR_TEXTURES: Meshy T2.5 models from Codex reference images
// made with the selected B concept, Codex tileable surface sets; Meshy maps KEPT, never retextured).
//
// GLB SWAP (one entry per set piece; world/reactor/archKit.ts): a piece with `delivered: true` whose model the lazy prop library
// loaded (game.ts propModels + sectionModelKeys -> reactorModelKeysFor, fetched behind the Reactor's loading screen only:
// assets/levelAssets.ts LEVEL_ONLY_RULES owns assets/models/reactor-*.glb for the 'reactor' level) is INSTANCED on every record of
// that piece instead of the procedural body; `delivered: false` (or a model that failed to load: Node tests, a 404) keeps the
// procedural piece. Procedural extras stay with a model: fan blades (inside the housing's empty ring), generator start panel + lamps,
// cable runs, pipe-bank catwalks + lamps, the vessel's glow parts + ring gantries, crane runways / bridge, lamp lens glows (the
// Meshy lamp has no emission map: a per-tier emissive lens overlay carries setTierPower).
// Every REACTOR_KIT url is referenced from runtime code through REACTOR_MODEL_FILES (the release packager drops unreferenced GLBs).
//
// TEXTURE SLOTS: REACTOR_TEXTURES colour / normal / ORM (R ao, G roughness, B metal) JPEGs, loaded by the Reactor's section preload
// (LevelResources, level 'reactor': released when the run leaves the level), applied by world/reactor/archMaterials.ts with the
// tile span below. Before they resolve (Node tests, a failed fetch) the reactor surfaces reuse the repo's EXISTING approved surface
// sets with tints and the existing decay hooks — never a new hand-drawn texture (CLAUDE.md: Codex for INITIAL sources).
// Pure data + small helpers (no three.js).

import {REACTOR_KIT, REACTOR_TEXTURES as KIT_TEXTURES, type ReactorKitModel} from '../../assets/reactorKit.generated';
import {REACTOR_X_KIT} from '../../assets/reactorExpansionKit.generated'; // task reactor-expansion-20261101: the expansion's Meshy kit

/** The set pieces ARCH places (REACTOR_KIT keys; the items fuseCartridge / reactorKey are lane RESTART's). */
export type ReactorPiece =
  | 'vessel' | 'generator' | 'craneTrolley' | 'craneHook' | 'fanHousing' | 'switchgear' | 'coolantPump' | 'controlConsole'
  | 'pipeBank' | 'coolantValve' | 'floodLamp'
  // task reactor-expansion-20261101 (lane CORE): the hero reactor assembly (world/reactor/coreHero.ts; layout.reactor.coreFloor)
  | 'steamGenerator' | 'rcpVertical' | 'coolantManifold' | 'turbineGenerator'
  // (lane CORE follow-up: the lead's pipe elbow / sight-glass spool / CRDM service platform)
  | 'pipeElbow' | 'sightGlassSpool' | 'crdmPlatform';

/**
 * How a delivered model is fitted onto its record (models are real size, +Y up, front +Z, grounded min y 0, centred x / z):
 *  - 'uniform' : one uniform scale so the model fits the record's box (generator in its footprint; vessel to 2 x ReactorCore.radius);
 *  - 'real'    : real size (no scaling) at the record's anchor (trolley on the bridge, hook block at hookY, site machines, lamps);
 *  - 'stack'   : a stackable module tiled up / along the record (pipe bank: 4 m modules up the organ wall);
 *  - 'ring'    : uniform scale so the housing's empty ring matches the fan radius (fan housing: ring radius `ring` m at scale 1).
 */
export type ReactorFit = 'uniform' | 'real' | 'stack' | 'ring';

export interface ReactorModelSpec {
  piece: ReactorPiece;
  /** Lazy-library key (assets/loader.ts PropModelLibrary) = REACTOR_KIT[piece].key. */
  key: string;
  /** Site-relative runtime path (level-only: the Reactor). */
  url: string;
  bytes: number;
  tris: number;
  /** Real-size W x H x D (m) as cooked (front +Z, base at y 0). */
  dims: readonly [number, number, number];
  fit: ReactorFit;
  /** false: not cooked — never fetched; the procedural piece stands. */
  delivered: boolean;
  /** Most instances drawn from the model per level (the rest stay procedural): bounds the triangles of heavy kit pieces. */
  cap: number;
  /** Measured anchors in model space (m at scale 1; probed from the cooked GLBs, 2026-11-01). */
  anchors?: Readonly<Record<string, readonly [number, number, number] | number>>;
}

const fromKit = (piece: ReactorPiece, m: ReactorKitModel, fit: ReactorFit, cap: number, anchors?: ReactorModelSpec['anchors']): ReactorModelSpec =>
  ({piece, key: m.key, url: m.url, bytes: m.bytes, tris: m.tris, dims: m.dims, fit, delivered: true, cap, ...(anchors ? {anchors} : {})});

/**
 * THE registry. Anchors (probed vertex bounds of the cooked GLBs):
 *  - fanHousing: back flange plate at z -0.68..-0.34 (against the wall), duct ring inner radius ~0.70 about (0, 1.256) at z 0.02..0.36,
 *    motor pod r < 0.45 at z -0.24..0.47 -> blades in the ring at z ~0.14, radius 0.66;
 *  - floodLamp: wall plate at the -Z end (z -0.219, y 0.27..0.45), caged head at z 0..0.22, lens face ~0.19 x 0.28 at z 0.21, y 0.17;
 *  - generator: control box on the +Z long side near +X (x 1.54..2.35, y 0.76..1.65);
 *  - vessel: hazard plinth radius 6.4 (y 0..1.66), nozzles to +-7 (y 1.66..4.15), body radius ~5.0 (y 4.15..5.8), dome to 9.97;
 *  - craneTrolley: rope stubs below its middle; craneHook: rope stubs on top (height 2.2).
 */
export const REACTOR_MODELS: Readonly<Record<ReactorPiece, ReactorModelSpec>> = {
  vessel: fromKit('vessel', REACTOR_KIT.vessel, 'uniform', 1, {plinthR: 6.4, plinthTop: 1.66, bodyR: 5.0, seamY: 4.35, width: 14}),
  generator: fromKit('generator', REACTOR_KIT.generator, 'uniform', 8, {controlBox: [1.95, 1.2, 0.84]}),
  craneTrolley: fromKit('craneTrolley', REACTOR_KIT.craneTrolley, 'real', 1),
  craneHook: fromKit('craneHook', REACTOR_KIT.craneHook, 'real', 1),
  fanHousing: fromKit('fanHousing', REACTOR_KIT.fanHousing, 'ring', 16, {ringR: 0.7, ringY: 1.256, back: -0.679, bladeZ: 0.14, bladeR: 0.66}),
  switchgear: fromKit('switchgear', REACTOR_KIT.switchgear, 'real', 12),
  coolantPump: fromKit('coolantPump', REACTOR_KIT.coolantPump, 'real', 3),
  controlConsole: fromKit('controlConsole', REACTOR_KIT.controlConsole, 'real', 3),
  // 4 m modules at ~15 k triangles each: the top of each bank (clear air, seen from the rim) is modelled, the gassed depths stay
  // procedural pipes (a ring catwalk hides the seam): 24 modules max per level (~360 k triangles)
  pipeBank: fromKit('pipeBank', REACTOR_KIT.pipeBank, 'stack', 24),
  coolantValve: fromKit('coolantValve', REACTOR_KIT.coolantValve, 'real', 3),
  // ~4 k triangles each: the pit-wall / catwalk / gantry lamps take the model (up to the cap, top-down: the clear upper tiers seen
  // from the rim); deeper / railing lamps stay cheap cages (~100 triangles)
  floodLamp: fromKit('floodLamp', REACTOR_KIT.floodLamp, 'real', 32, {plate: [0, 0.36, -0.219], lens: [0, 0.167, 0.212], lensW: 0.17, lensH: 0.24}),
  // task reactor-expansion-20261101 (lane CORE): the hero assembly (the lead's expansion kit, REACTOR_X_KIT; real size, Meshy maps
  // kept): a steam generator + vertical reactor coolant pump + coolant manifold per coolant loop (4 loops), one turbine generator
  steamGenerator: fromKit('steamGenerator', REACTOR_X_KIT.steamGenerator, 'real', 4),
  rcpVertical: fromKit('rcpVertical', REACTOR_X_KIT.rcpVertical, 'real', 4),
  coolantManifold: fromKit('coolantManifold', REACTOR_X_KIT.coolantManifold, 'real', 4),
  turbineGenerator: fromKit('turbineGenerator', REACTOR_X_KIT.turbineGenerator, 'real', 1),
  // (lane CORE follow-up) anchors probed from the cooked GLBs (2026-11-02): the elbow stands on its down port (centre (0.385, 0, 0), facing
  // -Y), its side port faces -X at (-0.9, 1.125, 0), bore OD ~0.73; the spool runs along X, its axis at y 0.355 (OD ~0.71), the armoured
  // window on +Z (0.66 x 0.17 at y 0.38, face z ~0.405); the CRDM platform's skirt (r ~2.45) sits on the dome, grating deck at +1.82,
  // the housings' flat top ring at +3.51 (r 1.8), the outer railing at r 3.25 (top ~2.38)
  pipeElbow: fromKit('pipeElbow', REACTOR_X_KIT.pipeElbow, 'uniform', 24, {down: [0.385, 0, 0], side: [-0.9, 1.125, 0], od: 0.73}),
  sightGlassSpool: fromKit('sightGlassSpool', REACTOR_X_KIT.sightGlassSpool, 'uniform', 8, {axisY: 0.355, od: 0.71, len: 1.6, window: [0, 0.38, 0.412], windowW: 0.66, windowH: 0.17}),
  crdmPlatform: fromKit('crdmPlatform', REACTOR_X_KIT.crdmPlatform, 'real', 1, {skirtR: 2.45, deckY: 1.82, topY: 3.51, ringR: 1.8, railR: 3.25, railTop: 2.38}),
};

export const REACTOR_PIECES = Object.keys(REACTOR_MODELS) as ReactorPiece[];

/**
 * Lazy-library file map of the whole cooked kit (game.ts propModels; RESTART's item models fuseCartridge / reactorKey included so
 * the library can serve them): every REACTOR_KIT url is referenced from runtime code here.
 */
export function reactorModelFiles(): Record<string, {url: string; bytes: number}> {
  const out: Record<string, {url: string; bytes: number}> = {};
  for (const m of Object.values(REACTOR_KIT) as ReactorKitModel[]) out[m.key] = {url: m.url, bytes: m.bytes};
  // task reactor-expansion-20261101 (lane CORE): + the whole expansion kit (hero assembly + the side complexes' set pieces): every
  // REACTOR_X_KIT url referenced from runtime code (the release packager drops unreferenced GLBs); fetched only when a layout asks
  for (const m of Object.values(REACTOR_X_KIT) as ReactorKitModel[]) out[m.key] = {url: m.url, bytes: m.bytes};
  return out;
}
export const REACTOR_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = reactorModelFiles();

/** The lazy keys a layout needs (game.ts sectionModelKeys): ARCH's delivered pieces on a Reactor layout, else none. */
export function reactorModelKeysFor(layout: {reactor?: unknown}, models: Readonly<Record<ReactorPiece, ReactorModelSpec>> = REACTOR_MODELS): readonly string[] {
  if (!layout.reactor) return [];
  return REACTOR_PIECES.filter(p => models[p].delivered).map(p => models[p].key);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Texture slots (Codex tileable sets)

export type ReactorTextureSlot = 'pitConcrete' | 'rustedSteel' | 'grating';
export type ReactorTextureMap = 'color' | 'normal' | 'orm';

export interface ReactorTextureSpec {
  slot: ReactorTextureSlot;
  /** colour (sRGB), normal + ORM (linear; R ao, G roughness, B metal) — site-relative paths. */
  color: string;
  normal: string;
  orm: string;
  /** Real-world span (m) one tile covers (u, v): world-mapped / UV scale of the surfaces using it. */
  span: readonly [number, number];
  /** Reactor surface keys / dressing materials that take it (archMaterials.ts). */
  uses: readonly string[];
  delivered: boolean;
}

const tex = (slot: ReactorTextureSlot, set: {color: string; normal: string; orm: string}, span: readonly [number, number], uses: readonly string[]): ReactorTextureSpec =>
  ({slot, color: set.color, normal: set.normal, orm: set.orm, span, uses, delivered: true});

/** THE texture slots (tile spans are ARCH's choice: board-formed concrete 3 m, riveted plate 1.6 m, bar grating 1 m). */
export const REACTOR_TEXTURES: Readonly<Record<ReactorTextureSlot, ReactorTextureSpec>> = {
  pitConcrete: tex('pitConcrete', KIT_TEXTURES['pit-concrete'], [3, 3], ['reactor-wall', 'reactor-roof', 'reactor-floor', 'concrete']),
  rustedSteel: tex('rustedSteel', KIT_TEXTURES['rusted-steel'], [1.6, 1.6], ['reactor-deck-under', 'reactor-room-wall', 'reactor-trim', 'steel', 'steelDark', 'machine']),
  grating: tex('grating', KIT_TEXTURES.grating, [1, 1], ['reactor-grating', 'grating']),
};

export const REACTOR_TEXTURE_SLOTS = Object.keys(REACTOR_TEXTURES) as ReactorTextureSlot[];

/** The level id the Reactor's level-only assets belong to (levels/types.ts LevelId 'reactor'). */
export const REACTOR_LEVEL = 'reactor';

/** Delivered texture files to preload (colour sRGB, normal / ORM linear). */
export function reactorTextureLoads(textures: Readonly<Record<ReactorTextureSlot, ReactorTextureSpec>> = REACTOR_TEXTURES): {slot: ReactorTextureSlot; map: ReactorTextureMap; url: string; srgb: boolean}[] {
  const out: {slot: ReactorTextureSlot; map: ReactorTextureMap; url: string; srgb: boolean}[] = [];
  for (const s of REACTOR_TEXTURE_SLOTS) {
    const t = textures[s];
    if (!t.delivered) continue;
    out.push({slot: s, map: 'color', url: t.color, srgb: true}, {slot: s, map: 'normal', url: t.normal, srgb: false}, {slot: s, map: 'orm', url: t.orm, srgb: false});
  }
  return out;
}

/**
 * The textures the Reactor's section preload resolved, read synchronously by the material factory while the world is built.
 * `version` bumps on every change so cached materials pick up reloaded textures after a level change (LevelResources disposes the
 * old ones when the run leaves the Reactor).
 */
export const reactorTextureStore: {version: number; maps: Partial<Record<`${ReactorTextureSlot}:${ReactorTextureMap}`, unknown>>} = {version: 0, maps: {}};

export function setReactorTexture(slot: ReactorTextureSlot, map: ReactorTextureMap, t: unknown | null): void {
  const k = `${slot}:${map}` as const;
  if (reactorTextureStore.maps[k] === (t ?? undefined)) return;
  if (t) reactorTextureStore.maps[k] = t; else delete reactorTextureStore.maps[k];
  reactorTextureStore.version++;
}

/** A slot's colour map is resolved (its normal / ORM may be missing: then the colour alone is used). */
export function reactorTexture(slot: ReactorTextureSlot, map: ReactorTextureMap): unknown | undefined {
  return reactorTextureStore.maps[`${slot}:${map}`];
}
