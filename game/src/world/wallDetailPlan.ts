// Iteration 08 (Lane W): wall treatment planning — pure data, deterministic per station seed.
//
// Every wall face (world/wallFaces.ts) gets a TREATMENT from its zone and base finish (platform tile
// with a station accent band, name tablets and tile pilasters; tunnel concrete with seepage and cable
// runs; concourse tile with per-hall accent bands; shop tile; service painted block with conduits and
// switch boxes; stair cores; upper finishes; raw board-formed lower concrete). On top of that rhythm,
// deterioration is COMPOSED, not sprinkled: structural bays put pilasters / expansion joints on one
// station-wide grid; leaks ("hotspots") at joints drive a streak from the ceiling, efflorescence at
// its foot and the finish damage around it (missing tiles, spalled paint, cracks, a repair patch);
// traffic wears the lower edges, outside corners and kick lines; neglect scales with the zone, the
// area's lighting profile and the station's age; a few genuinely broken sections (holes into the
// wall's blockwork with exposed rebar) go only where the wall is thick and solid behind.
//
// Output features are in face-local coordinates (s metres along the face from (x0, z0), absolute y)
// and carry everything the geometry pass needs (outlines, depths, atlas cells, tints). Openings,
// storefront frames, signs, props against the wall, handrails and ladders are keep-outs per layer,
// so cosmetic damage never sits on (or reads as) a doorway and nothing floats over a fitting.

import {CELL, FLOOR, SOLID, VOID} from '../gen/grid';
import {Levels} from '../gen/levels';
import {Rng, hashString} from '../core/rng';
import {passageRails, signDims} from '../gen/doorways';
import {storefrontParts} from '../gen/storefronts';
import type {StationLayout} from '../gen/station';
import type {WallFace, WallZone} from './wallFaces';
import {faceFrame, normalizeFaces, stationWallFaces, type TreatFace} from './wallDetailFaces';
import {CHUNK_M, stationLevels} from './levelGeometry';
import {FRIEZE_SIZE, type AtlasCell} from './wallDetailAtlas';
import {isExtensionArea} from '../gen/trackExt/types'; // Track 2 (lane GEN)

export type Treatment = 'platformTile' | 'trackTunnel' | 'trackFace' | 'concourseTile' | 'shopTile' | 'servicePaint' | 'stairCore' | 'upperFinish' | 'lowerConcrete'
  // Task office-overhaul-20261030 (lane ARCH): office storey walls (painted plasterboard / feature finishes) and the roof parapets.
  | 'officeWall' | 'officeRoof';
export type Finish = 'tile' | 'shopTile' | 'paint' | 'concrete' | 'office';
export type Layer = 'flush' | 'decal' | 'soft' | 'cut' | 'proud';
export type FeatureKind =
  | 'band' | 'frieze' | 'pilaster' | 'joint' | 'formwork'
  | 'tileLoss' | 'spall' | 'breach' | 'recess'
  | 'crack' | 'edgeChips' | 'cornerChips' | 'patch'
  | 'streak' | 'efflor' | 'damp' | 'soot' | 'grime' | 'scuff'
  | 'conduit' | 'switchBox' | 'pipe' | 'cables';

export const FEATURE_LAYER: Record<FeatureKind, Layer> = {
  band: 'flush', frieze: 'flush', pilaster: 'flush', joint: 'flush', formwork: 'flush',
  tileLoss: 'cut', spall: 'cut', breach: 'cut', recess: 'cut',
  crack: 'decal', edgeChips: 'decal', cornerChips: 'decal', patch: 'decal',
  streak: 'soft', efflor: 'soft', damp: 'soft', soot: 'soft', grime: 'soft', scuff: 'soft',
  conduit: 'proud', switchBox: 'proud', pipe: 'proud', cables: 'proud',
};

/** Zone -> treatment (track-bed faces split by finish: tunnel lining vs the platform face). */
export const ZONE_TREATMENT: Record<WallZone, Treatment> = {
  platform: 'platformTile', trackbed: 'trackTunnel', concourse: 'concourseTile', shop: 'shopTile',
  service: 'servicePaint', stair: 'stairCore', upper: 'upperFinish', lower: 'lowerConcrete',
};

export function finishFamily(finish: string): Finish {
  if (/^office-/.test(finish)) return 'office'; // task office-overhaul-20261030 (lane ARCH): world/officeArch.ts finish keys
  if (/shop/i.test(finish)) return 'shopTile';
  if (/tile/i.test(finish)) return 'tile';
  if (/paint|plaster|block/i.test(finish)) return 'paint';
  return 'concrete';
}

export function treatmentOf(face: Pick<WallFace, 'zone' | 'finish'>): Treatment {
  // Task office-overhaul-20261030 (lane ARCH): office finishes never take a station treatment (whatever their zone).
  if (/^office-roof/.test(face.finish)) return 'officeRoof';
  if (/^office-/.test(face.finish)) return 'officeWall';
  if (face.zone === 'trackbed' && /platformFace/i.test(face.finish)) return 'trackFace';
  return ZONE_TREATMENT[face.zone] ?? 'servicePaint';
}

/** Per-treatment recipe: rhythm, identity and deterioration rates (per 10 m of wall at condition 1). */
interface Recipe {
  /** Structural bay (m) on the station-wide grid; chance a bay line carries a tile pilaster / an expansion joint. */
  bay: number; pilaster: number; joint: number;
  band: 'station' | 'area' | 'none';
  frieze: boolean; formwork: boolean;
  /** Base neglect range. */
  condition: [number, number];
  hotspots: number;
  tileLoss: number; spall: number; crack: number; patch: number; streak: number;
  edgeChips: number; cornerChips: number;
  wear: 'kick' | 'grime' | 'rub' | 'none';
  soot: number; damp: number;
  conduit: number; switchBox: number; pipe: number; cables: boolean;
  /** Relative weight for the station's few broken sections (0 = never). */
  breach: number;
  /** Chance a structural bay line carries a shallow equipment recess (raised niche, never passage-like). */
  recess: number;
}

export const RECIPES: Record<Treatment, Recipe> = {
  platformTile: {bay: 5.4, pilaster: 0.75, joint: 0.25, band: 'station', frieze: true, formwork: false, condition: [0.35, 0.7], hotspots: 0.9, tileLoss: 2.4, spall: 0, crack: 1.6, patch: 0.8, streak: 0.5, edgeChips: 0.55, cornerChips: 0.8, wear: 'grime', soot: 0.15, damp: 0, conduit: 0, switchBox: 0, pipe: 0, cables: false, breach: 0.6, recess: 0},
  trackTunnel: {bay: 3.6, pilaster: 0, joint: 0.55, band: 'none', frieze: false, formwork: false, condition: [0.55, 0.85], hotspots: 1.0, tileLoss: 0, spall: 1.3, crack: 0.5, patch: 0.5, streak: 1.6, edgeChips: 0, cornerChips: 0, wear: 'none', soot: 0.7, damp: 0.75, conduit: 0, switchBox: 0, pipe: 0, cables: true, breach: 0.5, recess: 0.12},
  trackFace: {bay: 3.6, pilaster: 0, joint: 0.3, band: 'none', frieze: false, formwork: false, condition: [0.5, 0.8], hotspots: 0.3, tileLoss: 0, spall: 1.0, crack: 0.8, patch: 0.4, streak: 0.8, edgeChips: 0, cornerChips: 0, wear: 'none', soot: 0, damp: 0.3, conduit: 0, switchBox: 0, pipe: 0, cables: false, breach: 0, recess: 0},
  concourseTile: {bay: 7.2, pilaster: 0.55, joint: 0.25, band: 'area', frieze: false, formwork: false, condition: [0.25, 0.6], hotspots: 0.55, tileLoss: 1.8, spall: 0, crack: 1.2, patch: 0.8, streak: 0.4, edgeChips: 0.6, cornerChips: 0.85, wear: 'grime', soot: 0.1, damp: 0, conduit: 0, switchBox: 0.15, pipe: 0, cables: false, breach: 0.4, recess: 0},
  shopTile: {bay: 0, pilaster: 0, joint: 0, band: 'none', frieze: false, formwork: false, condition: [0.3, 0.65], hotspots: 0.5, tileLoss: 1.6, spall: 0, crack: 1.4, patch: 1.0, streak: 0.6, edgeChips: 0.5, cornerChips: 0.6, wear: 'grime', soot: 0.3, damp: 0, conduit: 0, switchBox: 0.5, pipe: 0, cables: false, breach: 0, recess: 0},
  servicePaint: {bay: 0, pilaster: 0, joint: 0, band: 'none', frieze: false, formwork: false, condition: [0.4, 0.8], hotspots: 0.6, tileLoss: 0, spall: 1.6, crack: 0.8, patch: 1.0, streak: 0.6, edgeChips: 0.4, cornerChips: 0.9, wear: 'kick', soot: 0.45, damp: 0.1, conduit: 0.55, switchBox: 0.7, pipe: 0.15, cables: false, breach: 1.0, recess: 0.12},
  stairCore: {bay: 0, pilaster: 0, joint: 0.2, band: 'none', frieze: false, formwork: false, condition: [0.35, 0.7], hotspots: 0.9, tileLoss: 0.8, spall: 1.0, crack: 1.2, patch: 0.6, streak: 0.9, edgeChips: 0.6, cornerChips: 0.9, wear: 'rub', soot: 0.2, damp: 0.2, conduit: 0, switchBox: 0, pipe: 0, cables: false, breach: 0.5, recess: 0},
  upperFinish: {bay: 4.8, pilaster: 0.3, joint: 0.3, band: 'area', frieze: false, formwork: false, condition: [0.15, 0.45], hotspots: 0.35, tileLoss: 0.5, spall: 0.6, crack: 0.6, patch: 0.5, streak: 0.4, edgeChips: 0.35, cornerChips: 0.6, wear: 'grime', soot: 0.1, damp: 0, conduit: 0.25, switchBox: 0.3, pipe: 0, cables: false, breach: 0.2, recess: 0.05},
  lowerConcrete: {bay: 4.8, pilaster: 0, joint: 0.5, band: 'none', frieze: false, formwork: true, condition: [0.55, 0.9], hotspots: 1.0, tileLoss: 0, spall: 1.5, crack: 0.8, patch: 0.6, streak: 1.2, edgeChips: 0.2, cornerChips: 0.7, wear: 'kick', soot: 0.5, damp: 0.7, conduit: 0.7, switchBox: 0.6, pipe: 0.55, cables: false, breach: 1.2, recess: 0.3},
  // Task office-overhaul-20261030 (lane ARCH): an abandoned office's plasterboard — no station identity (no tile bands, pilasters,
  // friezes, formwork), no service fittings (conduits, switch boxes, pipes, cables) and no cut damage (spalled block, lost tiles,
  // breaches, recesses: the T4 paint failure is in the wall shader). Wear stays: water damage runs from ceiling leaks with
  // cracks around them, damp tide marks, kick-line scuffs, chipped outside corners, a little soot.
  officeWall: {bay: 0, pilaster: 0, joint: 0, band: 'none', frieze: false, formwork: false, condition: [0.3, 0.7], hotspots: 0.45, tileLoss: 0, spall: 0, crack: 0.7, patch: 0, streak: 0.5, edgeChips: 0.15, cornerChips: 0.6, wear: 'kick', soot: 0.12, damp: 0.15, conduit: 0, switchBox: 0, pipe: 0, cables: false, breach: 0, recess: 0},
  // The roof's precast parapets / housings: weathering runs, damp at the foot, cracks; nothing mounted.
  officeRoof: {bay: 0, pilaster: 0, joint: 0.35, band: 'none', frieze: false, formwork: false, condition: [0.5, 0.85], hotspots: 0.6, tileLoss: 0, spall: 0, crack: 0.9, patch: 0, streak: 1.4, edgeChips: 0.3, cornerChips: 0.6, wear: 'none', soot: 0.3, damp: 0.6, conduit: 0, switchBox: 0, pipe: 0, cables: false, breach: 0, recess: 0},
};

/** Iteration 12 (ARCH): condition added to every wall for ~30 years without upkeep (world/decay.ts ages the surfaces). */
export const WALL_AGE_30Y = 0.12;

/** Per-station bounded budgets (features; geometry counts are reported by the builder). */
export const WALL_DETAIL_CAPS = {cut: 240, breach: 4, decal: 900, soft: 600, flush: 1400, proud: 220, perFaceCut: 4, perFaceCutPerM: 1 / 7};
/** Track 2 (VIS): the extension areas' own budgets (all service annexes of a level together; about a quarter of the core's). */
export const WALL_DETAIL_EXT_CAPS = {cut: 70, breach: 2, decal: 260, soft: 180, flush: 380, proud: 90};

/** Tile grids of the base finishes (must match the base wall textures). */
export const SUBWAY = {w: 0.36, h: 0.15, split: 1.8, upperH: 0.2989 / 2};
export const SHOP_TILE = 0.15;
export const BLOCK = {w: 0.4, h: 0.2};

export interface Rect { s0: number; s1: number; y0: number; y1: number }

export interface Feature extends Rect {
  kind: FeatureKind;
  layer: Layer;
  /** Index into plan.faces. */
  face: number;
  seed: number;
  /** Atlas cell (flush / decal / soft surfaces, cut backs). */
  cell?: AtlasCell | 'frieze';
  /** Vertex tint (linear-ish 0..1 RGB). */
  tint?: [number, number, number];
  /** Mirror the cell horizontally. */
  flip?: boolean;
  /** Cuts: outline polygon (s, y), counter-clockwise in (s, y); inset depth (m). */
  outline?: [number, number][];
  depth?: number;
  /** Cuts: atlas cells of the inset back / sides, and the rim ring (cell, width range m). */
  back?: AtlasCell; side?: AtlasCell;
  /**
   * UV alignment to a world grid: the cell origin sits at the largest world c <= the feature's
   * smallest c with c = ou (mod pu), and at y = ov (mod pv) — so drawn joints meet the base finish's.
   */
  grid?: {pu?: number; pv?: number; ou: number; ov: number};
  rim?: {cell: AtlasCell; w0: number; w1: number};
  /** Recess: a steel equipment panel mounted on its back (inside the wall plane). */
  panel?: boolean;
  /** Star-shaped outlines: the point the outline is star-shaped around (rims expand radially from it). */
  center?: [number, number];
  /** Breach: exposed reinforcement (along s or y at a depth) and rubble at the foot. */
  bars?: {axis: 's' | 'y'; at: number; depth: number; a0: number; a1: number}[];
  rubble?: number;
  /** Proud fittings: polyline (s, y) for conduits / pipes / cables, radius, stand-off, bracket spacing. */
  path?: [number, number][];
  radius?: number;
  off?: number;
  brackets?: number;
  /** Cables: parallel runs (y offsets). */
  runs?: number[];
  /** Hotspot id this feature belongs to (composition / tests). */
  hotspot?: number;
}

export interface PlannedFace {
  /** The face (sloped stair walls: y0 / y1 narrowed to the inscribed rectangle). */
  face: TreatFace;
  /** Face bottom is the floor (not a lintel / slab edge): floor-anchored wear may go here. */
  atFloor: boolean;
  /** Stair-flight side wall (no cuts / flush finishes / fittings). */
  sloped: boolean;
  treatment: Treatment;
  finish: Finish;
  condition: number;
  len: number;
  /** World axis coordinate at s = 0 and its direction (+1 / -1) along s. */
  c0: number; dir: number;
  /** Plane axis: 'z' when the face runs along X (plane z = const). */
  axis: 'x' | 'z';
  /** Vertical splits of the base finish (tile line) — cuts never straddle them. */
  splits: number[];
  /** Face ends: 'outside' corner (wall turns away), 'inside' corner, or 'open'. */
  ends: ['outside' | 'inside' | 'open', 'outside' | 'inside' | 'open'];
  keepouts: (Rect & {mask: number; why: string})[];
  accent: [number, number, number];
}

export interface WallDetailPlan {
  faces: PlannedFace[];
  features: Feature[];
  counts: Record<FeatureKind, number>;
  /** Features dropped by budgets or validation. */
  dropped: number;
  /** Station accent (band / tablets), hex. */
  accent: string;
  hotspots: number;
}

// Layer masks for keep-outs.
export const M = {flush: 1, decal: 2, soft: 4, cut: 8, proud: 16, all: 31} as const;
const LAYER_BIT: Record<Layer, number> = {flush: M.flush, decal: M.decal, soft: M.soft, cut: M.cut, proud: M.proud};

/** Station accent palettes (historic tile-band colours) and muted hall accents. */
const STATION_ACCENTS = ['#7a2a26', '#b8862b', '#2c4f8a', '#3d6b48', '#a5532f', '#2f6f6a', '#5e3a5c', '#8a6a2a'];
const HALL_ACCENTS = ['#6f7f86', '#8c7a5c', '#5f7462', '#86605a', '#5a647c', '#7c7358'];
const hexRgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

const OPENING_MARGIN = {flush: 0.0, decal: 0.12, soft: 0.1, cut: 0.35, proud: 0.18};
const BREACH_OPENING_CLEAR = 1.0;

export interface PlanOptions {
  /** Faces from the builder; omitted = derived from the layout (adapter). */
  faces?: readonly WallFace[];
}

/** Plan the wall treatment of a station. Deterministic for (layout, faces). */
export function planWallDetail(layout: StationLayout, opts: PlanOptions = {}): WallDetailPlan {
  // Track 2 (lane GEN): track-extension walls (tunnels / annexes) are not part of the core plan — its per-station caps, breaches
  // and seeds stay exactly the core's; the extensions' presentation plans their own walls (lane VIS).
  const faces = normalizeFaces((opts.faces ?? stationWallFaces(layout)).filter(f => !isExtensionArea(layout.areas[f.area])));
  const levels = new Levels(stationLevels(layout));
  const srng = new Rng(hashString('wall-detail', layout.seed >>> 0));
  const accent = STATION_ACCENTS[srng.int(0, STATION_ACCENTS.length - 1)];
  // Iteration 12 (ARCH): ~30 years without upkeep raise every wall's condition (more cracks, lost tiles, leak runs).
  const age = srng.range(-0.08, 0.14) + WALL_AGE_30Y;
  const bayPhase = srng.range(0, 1);
  const jointEvery = srng.int(2, 4);
  const hallAccent = new Map<number, string>();
  const ctx: PlanCtx = {layout, levels, features: [], hot: 0, rails: passageRails(layout), shopBoxes: shopBoxes(layout)};
  const planned: PlannedFace[] = [];
  for (const face0 of faces) {
    const sl = face0.slope;
    let face: TreatFace = sl ? {...face0, y0: Math.max(sl.b0, sl.b1), y1: Math.max(Math.max(sl.b0, sl.b1), Math.min(sl.t0, sl.t1))} : face0;
    // Only the part of the face that actually borders open space of its level gets detail.
    const open = openRange(levels, face);
    if (!open) continue;
    if (open[0] > face.y0 + 1e-3 || open[1] < face.y1 - 1e-3) face = {...face, y0: open[0], y1: open[1]};
    const treatment = treatmentOf(face);
    const R = RECIPES[treatment];
    const area = layout.areas[face.area];
    const rng = new Rng(face.seed ^ 0x51ed27);
    const light = area?.lighting === 'dark' ? 0.18 : area?.lighting === 'dim' ? 0.08 : 0;
    const condition = clamp01(R.condition[0] + (R.condition[1] - R.condition[0]) * rng.next() + age + light);
    let hall = hallAccent.get(face.area);
    if (!hall) hallAccent.set(face.area, (hall = HALL_ACCENTS[hashString('hall', face.area + layout.seed) % HALL_ACCENTS.length]));
    const {len, tx, tz} = faceFrame(face);
    const axis: 'x' | 'z' = Math.abs(tx) > 0.5 ? 'z' : 'x';
    const c0 = axis === 'z' ? face.x0 : face.z0;
    const dir = (axis === 'z' ? tx : tz) >= 0 ? 1 : -1;
    const fam = finishFamily(face.finish);
    const tl = face.base + SUBWAY.split;
    const splits = fam === 'tile' && tl > face.y0 + 0.05 && tl < face.y1 - 0.05 ? [tl] : [];
    planned.push({face, atFloor: Math.abs(face.y0 - face.base) < 0.02 && !sl, sloped: !!sl, treatment, finish: fam, condition, len, c0, dir, axis, splits, ends: faceEnds(layout, levels, face, len),
      keepouts: [], accent: hexRgb(R.band === 'station' ? accent : hall)});
  }
  // Track 2 (VIS): faces of extension areas (track tunnels / service annexes, Area.ext) are planned AFTER the core's, with
  // their own breach stream and budgets (WALL_DETAIL_EXT_CAPS), so the core station's treatment does not change with them.
  const isExtFace = (pf: PlannedFace) => !!(layout.areas[pf.face.area] as {ext?: string} | undefined)?.ext;
  if (planned.some(isExtFace)) { const core = planned.filter(pf => !isExtFace(pf)), ext = planned.filter(isExtFace); planned.length = 0; planned.push(...core, ...ext); }
  const nCore = planned.findIndex(isExtFace) < 0 ? planned.length : planned.findIndex(isExtFace);
  ctx.near = new PlaneIndex(ctx);
  planned.forEach((pf, i) => { pf.keepouts = keepoutsFor(ctx, pf); planFace(ctx, pf, i, {bayPhase, jointEvery}); });
  const byFace: Feature[][] = planned.map(() => []);
  for (const f of ctx.features) byFace[f.face].push(f);
  planBreaches(ctx, planned, srng.fork('breach'), byFace, 0, nCore);
  if (nCore < planned.length) planBreaches(ctx, planned, srng.fork('breach-ext'), byFace, nCore, planned.length, WALL_DETAIL_EXT_CAPS.breach);
  // Iteration 12 (ARCH): rust bleeding down the finish from wall-mounted steel (after every cut is final).
  planned.forEach((pf, i) => rustBleed({pf, idx: i, rng: new Rng(pf.face.seed ^ 0x7e57), placed: byFace[i]}, ctx));
  // Board-formed concrete last: its pattern runs around every cut, keep-out and other flush finish.
  planned.forEach((pf, i) => { if (RECIPES[pf.treatment].formwork && pf.finish === 'concrete' && !pf.sloped && pf.face.y1 - pf.face.y0 > 1.2) formworkRun({pf, idx: i, rng: new Rng(pf.face.seed ^ 0xf0f0), placed: byFace[i]}, ctx); });
  const coreCaps = applyCaps(ctx.features.filter(f => f.face < nCore), planned);
  const extCaps = nCore < planned.length ? applyCaps(ctx.features.filter(f => f.face >= nCore), planned, WALL_DETAIL_EXT_CAPS) : {features: [], dropped: 0};
  const features = [...coreCaps.features, ...extCaps.features], dropped = coreCaps.dropped + extCaps.dropped;
  const counts = Object.fromEntries(Object.keys(FEATURE_LAYER).map(k => [k, 0])) as Record<FeatureKind, number>;
  for (const f of features) counts[f.kind]++;
  return {faces: planned, features, counts, dropped, accent, hotspots: ctx.hot};
}

type Box = {x0: number; y0: number; z0: number; x1: number; y1: number; z1: number};
interface PlanCtx {
  layout: StationLayout;
  levels: Levels;
  features: Feature[];
  hot: number;
  rails: Box[];
  shopBoxes: Box[];
  near?: PlaneIndex;
}

/** Things that can sit against a wall, bucketed by wall plane (cell lines on X and on Z). */
class PlaneIndex {
  private readonly m = new Map<string, {shop: Box[]; signs: number[]; props: number[]; rails: Box[]}>();
  constructor(ctx: PlanCtx) {
    const put = (axis: 'x' | 'z', lo: number, hi: number, f: (e: {shop: Box[]; signs: number[]; props: number[]; rails: Box[]}) => void) => {
      for (let k = Math.floor((lo - 0.7) / CELL); k <= Math.floor((hi + 0.7) / CELL) + 1; k++) {
        const key = `${axis}${k}`;
        let e = this.m.get(key);
        if (!e) this.m.set(key, (e = {shop: [], signs: [], props: [], rails: []}));
        f(e);
      }
    };
    const both = (b: Box, f: (e: {shop: Box[]; signs: number[]; props: number[]; rails: Box[]}) => void) => { put('z', b.z0, b.z1, f); put('x', b.x0, b.x1, f); };
    for (const b of ctx.shopBoxes) both(b, e => e.shop.push(b));
    for (const b of ctx.rails) both(b, e => e.rails.push(b));
    ctx.layout.signs.forEach((sg, i) => { put('z', sg.z, sg.z, e => e.signs.push(i)); put('x', sg.x, sg.x, e => e.signs.push(i)); });
    ctx.layout.props.forEach((p, i) => both({x0: p.x - p.hx, x1: p.x + p.hx, z0: p.z - p.hz, z1: p.z + p.hz, y0: 0, y1: 0}, e => e.props.push(i)));
  }
  at(axis: 'x' | 'z', plane: number): {shop: Box[]; signs: number[]; props: number[]; rails: Box[]} {
    return this.m.get(`${axis}${Math.floor(plane / CELL + 1e-6)}`) ?? {shop: [], signs: [], props: [], rails: []};
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Vertical range of a face that borders open space of its own level (sampled just in front of it
 * along its length); null when under 0.4 m (faces hidden inside slabs / above ceilings get no detail).
 */
function openRange(levels: Levels, f: WallFace): [number, number] | null {
  const {len, tx, tz} = faceFrame(f);
  let lo = f.y0, hi = f.y1;
  for (const k of [0.15, 0.5, 0.85]) {
    const s = len * k, x = f.x0 + tx * s + f.nx * 0.1, z = f.z0 + tz * s + f.nz * 0.1;
    let a = Infinity, b = -Infinity;
    for (const band of levels.bands(x, z)) {
      if (band.level !== f.level) continue;
      const ya = Math.max(f.y0, band.floor), yb = Math.min(f.y1, band.ceil);
      if (yb > ya) { a = Math.min(a, ya); b = Math.max(b, yb); }
    }
    if (!(b > a)) return null;
    lo = Math.max(lo, a); hi = Math.min(hi, b);
  }
  return hi - lo >= 0.4 ? [lo, hi] : null;
}
const overlaps = (a: Rect, b: Rect, m = 0) => a.s0 < b.s1 + m && a.s1 > b.s0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;

function shopBoxes(layout: StationLayout): PlanCtx['shopBoxes'] {
  const out: PlanCtx['shopBoxes'] = [];
  for (const sf of layout.storefronts) {
    try { for (const b of storefrontParts(layout, sf).boxes) out.push(b); } catch { /* malformed bay: its opening keep-out still applies */ }
  }
  for (const b of layout.decor ?? []) out.push(b);
  return out;
}

/** World-axis coordinate <-> face s. */
const sOf = (pf: PlannedFace, c: number) => (c - pf.c0) * pf.dir;
const cOf = (pf: PlannedFace, s: number) => pf.c0 + s * pf.dir;
/** Plane coordinate (constant axis) of a face. */
const planeOf = (pf: PlannedFace) => (pf.axis === 'z' ? pf.face.z0 : pf.face.x0);

/** Project a world AABB near the face plane (on the open side) to a face rect, or null. */
function boxOnFace(pf: PlannedFace, b: {x0: number; y0: number; z0: number; x1: number; y1: number; z1: number}, reach: number): Rect | null {
  const f = pf.face, p = planeOf(pf);
  const n = pf.axis === 'z' ? f.nz : f.nx;
  const lo = pf.axis === 'z' ? b.z0 : b.x0, hi = pf.axis === 'z' ? b.z1 : b.x1;
  // Distance of the box from the plane into the open side.
  const near = n > 0 ? lo - p : p - hi, far = n > 0 ? hi - p : p - lo;
  if (far < -0.02 || near > reach) return null;
  const a0 = pf.axis === 'z' ? b.x0 : b.z0, a1 = pf.axis === 'z' ? b.x1 : b.z1;
  const s0 = Math.min(sOf(pf, a0), sOf(pf, a1)), s1 = Math.max(sOf(pf, a0), sOf(pf, a1));
  if (s1 < 0 || s0 > pf.len || b.y1 < f.y0 || b.y0 > f.y1) return null;
  return {s0, s1, y0: b.y0, y1: b.y1};
}

function keepoutsFor(ctx: PlanCtx, pf: PlannedFace): PlannedFace['keepouts'] {
  const f = pf.face, out: PlannedFace['keepouts'] = [];
  const add = (r: Rect, mask: number, why: string) => out.push({...r, mask, why});
  for (const o of f.openings) {
    for (const layer of ['flush', 'decal', 'soft', 'cut', 'proud'] as Layer[]) {
      const m = OPENING_MARGIN[layer];
      add({s0: o.s0 - m, s1: o.s1 + m, y0: f.y0 - 1, y1: o.top + m}, LAYER_BIT[layer], 'opening');
    }
  }
  const near = (ctx.near ?? new PlaneIndex(ctx)).at(pf.axis, planeOf(pf));
  // Storefront frames / fascias / decor boxes against the wall.
  for (const b of near.shop) {
    const r = boxOnFace(pf, b, 0.35);
    if (r) add({s0: r.s0 - 0.12, s1: r.s1 + 0.12, y0: r.y0 - 0.12, y1: r.y1 + 0.2}, M.all, 'storefront');
  }
  // Wall-mounted signs on this plane (bands may continue behind a sign; tablets / damage may not).
  for (const si of near.signs) {
    const s = ctx.layout.signs[si];
    if (s.hang || s.y < f.y0 - 0.5 || s.y > f.y1 + 0.5) continue;
    const sn = [Math.sin(s.rot), Math.cos(s.rot)];
    if (sn[0] * f.nx + sn[1] * f.nz < 0.9) continue;
    const dist = pf.axis === 'z' ? Math.abs(s.z - f.z0) : Math.abs(s.x - f.x0);
    if (dist > 0.3) continue;
    const {w, h} = signDims(s);
    const sc = sOf(pf, pf.axis === 'z' ? s.x : s.z);
    if (sc + w / 2 < 0 || sc - w / 2 > pf.len) continue;
    add({s0: sc - w / 2 - 0.15, s1: sc + w / 2 + 0.15, y0: s.y - h / 2 - 0.15, y1: s.y + h / 2 + 0.15}, M.all & ~M.flush, 'sign');
    add({s0: sc - w / 2 - 0.3, s1: sc + w / 2 + 0.3, y0: s.y - h / 2 - 0.3, y1: s.y + h / 2 + 0.3}, M.flush, 'sign-tablet');
  }
  // Props standing against the wall (and wall-mounted ones).
  for (const pi of near.props) {
    const p = ctx.layout.props[pi];
    const b = {x0: p.x - p.hx, x1: p.x + p.hx, z0: p.z - p.hz, z1: p.z + p.hz, y0: p.y, y1: p.y + p.h + (p.lift ?? 0)};
    const r = boxOnFace(pf, b, p.mounted ? 0.6 : 0.45);
    if (!r) continue;
    const lvl = (p as {level?: number}).level;
    if (lvl !== undefined && lvl !== f.level) continue;
    add({s0: r.s0 - 0.08, s1: r.s1 + 0.08, y0: f.y0 - 1, y1: r.y1 + 0.12}, (p.mounted ? M.all : M.cut | M.proud | M.decal), 'prop');
  }
  // Passage handrails.
  for (const b of near.rails) {
    const r = boxOnFace(pf, b, 0.25);
    if (r) add({s0: r.s0 - 0.1, s1: r.s1 + 0.1, y0: r.y0 - 0.15, y1: r.y1 + 0.15}, M.cut | M.proud | M.decal, 'rail');
  }
  // Rescue ladders on platform faces.
  if (pf.treatment === 'trackFace' || pf.face.zone === 'trackbed') {
    for (const l of ctx.layout.traversal?.ladders ?? []) {
      if (pf.axis !== 'z' || Math.abs(l.faceZ - f.z0) > 0.3) continue;
      const sc = sOf(pf, l.x);
      add({s0: sc - 0.7, s1: sc + 0.7, y0: f.y0 - 1, y1: f.y1 + 1}, M.all, 'ladder');
    }
  }
  return out;
}

/** Corner type at each end of a face (from the face level's grid). */
function faceEnds(layout: StationLayout, levels: Levels, f: WallFace, len: number): PlannedFace['ends'] {
  const L = levels.list.find(l => l.id === f.level) ?? levels.list[0];
  const g = L.grid;
  const {tx, tz} = faceFrame(f);
  const res: ('outside' | 'inside' | 'open')[] = [];
  for (const [s, sgn] of [[0, -1], [len, 1]] as const) {
    // Cell just beyond this end, on the open side of the face, and the one behind the face there.
    const ex = f.x0 + tx * (s + sgn * CELL * 0.5), ez = f.z0 + tz * (s + sgn * CELL * 0.5);
    const ox = ex + f.nx * CELL * 0.5, oz = ez + f.nz * CELL * 0.5;
    const bx = ex - f.nx * CELL * 0.5, bz = ez - f.nz * CELL * 0.5;
    const cellAt = (x: number, z: number) => { const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); return g.inBounds(cx, cz) ? g.cells[cz * g.w + cx] : SOLID; };
    const open = cellAt(ox, oz), behind = cellAt(bx, bz);
    const isOpen = (c: number) => c === FLOOR || c === VOID;
    // The wall continuing through a doorway is a door reveal (framed), not a corner to chip.
    const inDoor = (x: number, z: number) => { const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); return layout.doors.some(d => cx >= d.x && cx < d.x + d.w && cz >= d.y && cz < d.y + d.h); };
    if (!isOpen(open)) res.push('inside');
    else if (isOpen(behind) && !inDoor(bx, bz)) res.push('outside');
    else res.push('open');
  }
  return [res[0], res[1]];
}

// ---------------------------------------------------------------------------------------------
// Per-face planning

interface FaceState {
  pf: PlannedFace;
  idx: number;
  rng: Rng;
  placed: Feature[];
}

/** Allowed vertical bands for cuts (strictly inside one base quad). */
function cutBands(pf: PlannedFace): [number, number][] {
  const f = pf.face, edges = [f.y0, ...pf.splits, f.y1];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < edges.length; i++) out.push([edges[i] + 0.03, edges[i + 1] - 0.03]);
  return out;
}

/**
 * A cut must lie strictly inside ONE base-wall quad: within a vertical finish band and within one
 * architecture chunk (the builder splits wall quads on the CHUNK_M grid).
 */
function cutFits(pf: PlannedFace, r: Rect): boolean {
  if (!cutBands(pf).some(([a, b]) => r.y0 >= a && r.y1 <= b)) return false;
  const ca = Math.min(cOf(pf, r.s0), cOf(pf, r.s1)) - 0.03, cb = Math.max(cOf(pf, r.s0), cOf(pf, r.s1)) + 0.03;
  return Math.floor(ca / CHUNK_M) === Math.floor(cb / CHUNK_M);
}

/** Whether a rect may host a feature of `layer` on this face. */
function free(st: FaceState, r: Rect, layer: Layer, gap = 0.02): boolean {
  const pf = st.pf, f = pf.face;
  const endM = layer === 'flush' ? 0 : layer === 'cut' ? 0.3 : layer === 'proud' ? 0.2 : 0.04;
  if (r.s0 < endM - 1e-6 || r.s1 > pf.len - endM + 1e-6 || r.y0 < f.y0 - 1e-6 || r.y1 > f.y1 + 1e-6 || r.s1 <= r.s0 || r.y1 <= r.y0) return false;
  if (pf.sloped && (layer === 'cut' || layer === 'flush' || layer === 'proud')) return false;
  const bit = LAYER_BIT[layer];
  for (const k of pf.keepouts) if ((k.mask & bit) && overlaps(r, k)) return false;
  if (layer === 'cut' && !cutFits(pf, r)) return false;
  for (const p of st.placed) {
    const ok = compatible(layer, p.layer);
    if (ok) continue;
    if (overlaps(r, p, layer === 'cut' || p.layer === 'cut' ? 0.04 : gap)) return false;
  }
  return true;
}

/** Layers that may overlap on a face (separate depth offsets / transparent blending). */
function compatible(a: Layer, b: Layer): boolean {
  if (a === 'cut' || b === 'cut') return false;
  if (a === b) return a === 'soft';
  if (a === 'proud' || b === 'proud') return true;
  return true; // flush / decal / soft at separate offsets
}

function push(st: FaceState, ctx: PlanCtx, f: Omit<Feature, 'face' | 'layer' | 'seed'> & {seed?: number}): Feature {
  const feat: Feature = {...f, face: st.idx, layer: FEATURE_LAYER[f.kind], seed: f.seed ?? st.rng.int(0, 0x7fffffff)};
  st.placed.push(feat);
  ctx.features.push(feat);
  return feat;
}

function place(st: FaceState, ctx: PlanCtx, f: Omit<Feature, 'face' | 'layer' | 'seed'>, gap?: number): Feature | null {
  if (!free(st, f, FEATURE_LAYER[f.kind], gap)) return null;
  return push(st, ctx, f);
}

/** Expected count for a rate per 10 m at condition c (deterministic rounding by the face rng). */
function countFor(st: FaceState, rate: number, c: number, scale = 1): number {
  const x = rate * st.pf.len / 10 * scale * (0.25 + 0.95 * c);
  return Math.floor(x + st.rng.next());
}

function planFace(ctx: PlanCtx, pf: PlannedFace, idx: number, station: {bayPhase: number; jointEvery: number}): void {
  const R = RECIPES[pf.treatment];
  const st: FaceState = {pf, idx, rng: new Rng(pf.face.seed), placed: []};
  const f = pf.face, c = pf.condition, H = f.y1 - f.y0;
  if (pf.len < 0.6 || H < 0.4) return;

  // --- 1. structure: bay lines (station-wide grid) -> pilasters / expansion joints ------------
  const bayLines: number[] = [];
  if (R.bay > 0 && H > 1.6) {
    const ca = Math.min(cOf(pf, 0), cOf(pf, pf.len)), cb = Math.max(cOf(pf, 0), cOf(pf, pf.len));
    const phase = station.bayPhase * R.bay;
    for (let k = Math.ceil((ca - phase) / R.bay); phase + k * R.bay < cb; k++) {
      const s = sOf(pf, phase + k * R.bay);
      if (s < 0.6 || s > pf.len - 0.6) continue;
      bayLines.push(s);
      const lineRng = new Rng(hashString(`bay${k}`, ctx.layout.seed >>> 0) ^ (pf.axis === 'z' ? 1 : 2));
      const jointHere = Math.abs(k) % station.jointEvery === 0 && lineRng.chance(0.4 + R.joint);
      if (jointHere && R.joint > 0) {
        const r = {s0: s - 0.03, s1: s + 0.03, y0: f.y0, y1: f.y1};
        if (free(st, r, 'flush')) push(st, ctx, {kind: 'joint', ...r, cell: 'joint'});
      } else if (R.pilaster > 0 && lineRng.chance(R.pilaster) && pf.finish === 'tile') {
        const y0 = Math.min(f.y1, Math.max(f.y0, f.base + 0.3));
        const r = {s0: s - SUBWAY.w / 2, s1: s + SUBWAY.w / 2, y0, y1: f.y1};
        if (free(st, r, 'flush')) push(st, ctx, {kind: 'pilaster', ...r, cell: 'pilaster', tint: mix(pf.accent, [0.86, 0.84, 0.78], 0.45), grid: {pv: SUBWAY.h, ou: 0, ov: f.base}});
      }
    }
  }
  // Equipment recesses on the structural rhythm (raised, shallow, panel inside): not a doorway.
  if (R.recess > 0 && H > 2.2 && pf.atFloor) {
    const lines = bayLines.length ? bayLines : Array.from({length: Math.floor(pf.len / 6)}, (_, k) => (k + 0.5) * pf.len / Math.floor(pf.len / 6)).filter(v => v > 1 && v < pf.len - 1);
    for (const s0 of lines) {
      if (!st.rng.chance(R.recess)) continue;
      const s = s0 + (st.rng.chance(0.5) ? 1 : -1) * st.rng.range(0.5, 0.9);
      const w = st.rng.range(0.5, 0.8), h = st.rng.range(0.7, 1.05), yb = f.y0 + st.rng.range(0.85, 1.05);
      if (yb + h > Math.min(f.y1 - 0.25, f.y0 + 2.2)) continue;
      const r = {s0: s - w / 2, s1: s + w / 2, y0: yb, y1: yb + h};
      if (f.openings.some(o => r.s1 > o.s0 - 0.6 && r.s0 < o.s1 + 0.6)) continue;
      const depth = st.rng.range(0.1, 0.14);
      if (!free(st, r, 'cut') || !solidBehind(ctx.levels, pf, r, depth + 0.1)) continue;
      const outline: [number, number][] = [[r.s0, r.y0], [r.s1, r.y0], [r.s1, r.y1], [r.s0, r.y1]];
      push(st, ctx, {kind: 'recess', ...r, outline, depth, back: 'concretePatch', side: 'concretePatch', panel: pf.treatment !== 'trackTunnel' || st.rng.chance(0.5)});
    }
  }

  // --- 2. identity: accent band (around pilasters), station-name tablets, formwork ----------
  if (R.band !== 'none' && pf.finish === 'tile' && H > 2.9) {
    const n0 = R.band === 'station' ? 4 : 2; // courses above the tile line
    const y0 = f.base + SUBWAY.split + n0 * SUBWAY.upperH, y1 = y0 + 2 * SUBWAY.upperH;
    if (y1 < f.y1 - 0.25) bandRun(st, ctx, 'band', y0, y1, 'band', shade(pf.accent, R.band === 'station' ? 1 : 0.95), 3.24, {pu: SUBWAY.w, ou: 0, ov: y0});
  }
  if (R.frieze && pf.finish === 'tile' && H > 3.6 && pf.len > 4) {
    const yb = f.base + SUBWAY.split + 7 * SUBWAY.upperH; // above the band
    if (yb + FRIEZE_SIZE.h < f.y1 - 0.2) {
      // Centre tablets in alternate bays (or every 9 m on faces without a bay grid).
      const centres = bayLines.length > 1 ? bayLines.slice(0, -1).map((s, i) => (s + bayLines[i + 1]) / 2).filter((_, i) => i % 2 === (f.seed & 1)) : [pf.len / 2];
      for (const sc of centres) {
        const r = {s0: sc - FRIEZE_SIZE.w / 2, s1: sc + FRIEZE_SIZE.w / 2, y0: yb, y1: yb + FRIEZE_SIZE.h};
        if (free(st, r, 'flush', 0.1)) push(st, ctx, {kind: 'frieze', ...r, cell: 'frieze'});
      }
    }
  }

  // --- 3. leaks (hotspots): streak from the ceiling + efflorescence + finish damage around ---
  const nHot = countFor(st, R.hotspots * 0.7, c);
  const candidates = bayLines.length ? st.rng.shuffle(bayLines.slice()) : [];
  for (let h = 0; h < nHot; h++) {
    const sc = candidates[h] !== undefined ? candidates[h] + st.rng.range(-0.25, 0.25) : st.rng.range(0.8, pf.len - 0.8);
    hotspot(st, ctx, sc, ++ctx.hot);
  }

  // --- 4. background wear and tear -------------------------------------------------------------
  const n = (rate: number, scale = 1) => countFor(st, rate, c, scale);
  for (let i = n(pf.finish === 'tile' || pf.finish === 'shopTile' ? R.tileLoss : 0); i > 0; i--) {
    const low = pf.atFloor && st.rng.chance(0.4);
    finishDamage(st, ctx, st.rng.range(0.4, pf.len - 0.4), f.y0 + (low ? st.rng.range(0.16, 0.6) : st.rng.range(0.2, Math.min(2.4, H - 0.2))), low ? 0.4 : 0.8);
  }
  for (let i = n(pf.finish === 'paint' || pf.finish === 'concrete' ? R.spall : 0); i > 0; i--) finishDamage(st, ctx, st.rng.range(0.4, pf.len - 0.4), f.y0 + st.rng.range(0.25, Math.min(2.4, H - 0.2)), 0.7);
  for (let i = n(R.crack); i > 0; i--) crackAt(st, ctx, st.rng.range(0.4, pf.len - 0.4), f.y0 + st.rng.range(0.3, Math.min(2.6, H - 0.3)));
  for (let i = n(R.patch); i > 0; i--) patchAt(st, ctx, st.rng.range(0.4, pf.len - 0.4), f.y0 + st.rng.range(0.3, Math.min(2.2, H - 0.3)));
  for (let i = n(R.streak, 0.6); i > 0; i--) streakAt(st, ctx, st.rng.range(0.5, pf.len - 0.5), st.rng.range(0.25, 0.45), 'grime');
  // Lower edges chipped where traffic is: wall segments next to openings first.
  if (R.edgeChips > 0 && H > 1 && pf.atFloor) {
    for (const [a, b] of segments(pf)) {
      if (b - a < 0.8 || !st.rng.chance(R.edgeChips * (0.5 + c))) continue;
      const nearOpen = f.openings.some(o => Math.abs(o.s1 - a) < 0.6 || Math.abs(o.s0 - b) < 0.6);
      const L = Math.min(b - a - 0.3, st.rng.range(0.7, 2.0));
      const s0 = nearOpen && f.openings.some(o => Math.abs(o.s1 - a) < 0.6) ? a + 0.15 : nearOpen ? b - 0.15 - L : st.rng.range(a + 0.1, b - 0.1 - L);
      place(st, ctx, {kind: 'edgeChips', s0, s1: s0 + L, y0: f.y0, y1: f.y0 + 0.25, cell: st.rng.chance(0.5) ? 'chipsEdgeA' : 'chipsEdgeB', flip: st.rng.chance(0.5)});
    }
  }
  // Outside corners chipped (both faces of a corner get their own strip).
  if (R.cornerChips > 0 && H > 1.2 && pf.atFloor) {
    pf.ends.forEach((e, k) => {
      if (e !== 'outside' || !st.rng.chance(R.cornerChips)) return;
      const h = st.rng.range(0.9, Math.min(1.6, H - 0.2));
      const r = k === 0 ? {s0: 0, s1: 0.25} : {s0: pf.len - 0.25, s1: pf.len};
      const feat = {kind: 'cornerChips' as const, ...r, y0: f.y0 + 0.02, y1: f.y0 + 0.02 + h, cell: (st.rng.chance(0.5) ? 'cornerChipA' : 'cornerChipB') as AtlasCell, flip: k === 1};
      // Corner strips sit at the very end of the face (allowed inside the usual decal end margin).
      if (keepoutClear(pf, feat, 'decal') && !st.placed.some(p => p.layer === 'decal' || p.layer === 'cut' ? overlaps(feat, p, 0.02) : false)) push(st, ctx, feat);
    });
  }
  // Use wear: kick-line scuffs (service / lower), hand-rub grime band (public / stairs).
  if (R.wear !== 'none' && H > 1.4 && pf.atFloor) {
    for (const [a, b] of segments(pf)) {
      if (b - a < 1 || !st.rng.chance(0.2 + 0.35 * c)) continue;
      const [ya, yb, kind] = R.wear === 'kick' ? [0.04, 0.38, 'scuff' as const] : R.wear === 'rub' ? [0.85, 1.25, 'grime' as const] : [0.75, 1.15, 'grime' as const];
      for (let s = a + st.rng.range(0.1, 0.8); s < b - 0.6; s += st.rng.range(2.2, 4.5)) {
        const L = Math.min(st.rng.range(0.8, 2.0), b - 0.2 - s);
        if (L < 0.5) break;
        if (!st.rng.chance(0.6)) continue;
        place(st, ctx, {kind, s0: s, s1: s + L, y0: f.y0 + ya, y1: f.y0 + yb, cell: kind, tint: kind === 'scuff' ? [0.12, 0.11, 0.1] : [0.28, 0.25, 0.21], flip: st.rng.chance(0.5)});
      }
    }
  }
  // Soot / damp under the ceiling, damp tide marks at the foot.
  if (R.soot > 0 && H > 1.6) {
    for (let i = n(R.soot * 1.4); i > 0; i--) {
      const L = st.rng.range(1.0, 2.0), s0 = st.rng.range(0.1, Math.max(0.1, pf.len - L - 0.1));
      place(st, ctx, {kind: 'soot', s0, s1: Math.min(pf.len, s0 + L), y0: f.y1 - Math.min(0.6, H * 0.2), y1: f.y1, cell: 'soot', tint: [0.16, 0.15, 0.13], flip: st.rng.chance(0.5)});
    }
  }
  if (R.damp > 0 && pf.atFloor && st.rng.chance(R.damp * (0.3 + c)) && H > 1.0) bandRun(st, ctx, 'damp', f.y0, f.y0 + Math.min(0.6, H * 0.4), 'damp', [0.42, 0.41, 0.38], 2.0);

  // --- 5. restrained service details ---------------------------------------------------------
  fittings(st, ctx, R);
}

/** Wall segments between openings (s ranges). */
function segments(pf: PlannedFace): [number, number][] {
  const out: [number, number][] = [];
  let a = 0;
  for (const o of pf.face.openings) { if (o.s0 > a) out.push([a, o.s0]); a = Math.max(a, o.s1); }
  if (a < pf.len) out.push([a, pf.len]);
  return out;
}

function keepoutClear(pf: PlannedFace, r: Rect, layer: Layer): boolean {
  const bit = LAYER_BIT[layer];
  return !pf.keepouts.some(k => (k.mask & bit) && overlaps(r, k)) && r.y0 >= pf.face.y0 - 1e-6 && r.y1 <= pf.face.y1 + 1e-6 && r.s0 >= -1e-6 && r.s1 <= pf.len + 1e-6;
}

const shade = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A horizontal flush / soft run along the whole face, split around keep-outs and placed features. */
function bandRun(st: FaceState, ctx: PlanCtx, kind: 'band' | 'soot' | 'damp', y0: number, y1: number, cell: AtlasCell, tint: [number, number, number], piece = 3.6, grid?: Feature['grid']): void {
  const pf = st.pf;
  const layer = FEATURE_LAYER[kind];
  // Blocked s intervals at this height.
  const blocks: [number, number][] = [];
  const probe = {s0: 0, s1: pf.len, y0, y1};
  for (const k of pf.keepouts) if ((k.mask & LAYER_BIT[layer]) && overlaps(probe, k)) blocks.push([k.s0, k.s1]);
  for (const p of st.placed) if (!compatible(layer, p.layer) && overlaps(probe, p)) blocks.push([p.s0 - 0.005, p.s1 + 0.005]);
  blocks.sort((a, b) => a[0] - b[0]);
  let s = 0;
  const spans: [number, number][] = [];
  for (const [a, b] of blocks) { if (a > s) spans.push([s, a]); s = Math.max(s, b); }
  if (s < pf.len) spans.push([s, pf.len]);
  for (const [a, b] of spans) {
    if (b - a < 0.3) continue;
    for (let x = a; x < b - 0.05; x += piece) {
      const e = Math.min(b, x + piece);
      if (e - x < 0.1) break;
      const r = {s0: x, s1: e, y0, y1};
      if (kind === 'damp' && !st.rng.chance(0.6)) continue; // tide marks come and go along a wall
      if (layer === 'soft' || free(st, r, layer, 0)) push(st, ctx, {kind, ...r, cell, tint, grid, flip: kind !== 'band' && st.rng.chance(0.5)});
    }
  }
}

/** Board-formed concrete over the free parts of the face: one feature per free span of each 0.6 m row. */
function formworkRun(st: FaceState, ctx: PlanCtx): void {
  const pf = st.pf, f = pf.face, P = 0.6;
  for (let y = f.y0; y < f.y1 - 0.05; y += P) {
    const y1 = Math.min(f.y1, y + P);
    const probe = {s0: 0, s1: pf.len, y0: y, y1};
    const blocks: [number, number][] = [];
    for (const k of pf.keepouts) if ((k.mask & M.flush) && overlaps(probe, k)) blocks.push([k.s0, k.s1]);
    for (const p of st.placed) if (!compatible('flush', p.layer) && overlaps(probe, p, 0.02)) blocks.push([p.s0 - 0.02, p.s1 + 0.02]);
    blocks.sort((a, b) => a[0] - b[0]);
    let s = 0;
    for (const [a, b] of [...blocks, [pf.len, pf.len] as [number, number]]) {
      if (a - s >= 0.3) push(st, ctx, {kind: 'formwork', s0: s, s1: Math.min(a, pf.len), y0: y, y1, cell: 'formwork', tint: [0.55, 0.53, 0.5], grid: {pu: 2.4, pv: 1.2, ou: 0, ov: f.base}});
      s = Math.max(s, b);
    }
  }
}

/**
 * Iteration 12 (ARCH): rust bleed - orange-brown runs from the fixings of wall-mounted sign plates and passage
 * handrail brackets down the finish (soft layer; never over openings, storefronts, ladders or cut features).
 */
function rustBleed(st: FaceState, ctx: PlanCtx): void {
  const pf = st.pf, f = pf.face;
  if (pf.len < 0.6 || f.y1 - f.y0 < 0.8) return;
  const hard = pf.keepouts.filter(k => (k.mask & M.soft) && k.why !== 'sign' && k.why !== 'sign-tablet' && k.why !== 'rail');
  const run = (sc: number, top: number, w: number, len: number) => {
    const r = {s0: sc - w / 2, s1: sc + w / 2, y0: Math.max(f.y0 + 0.05, top - len), y1: Math.min(f.y1, top)};
    if (r.y1 - r.y0 < 0.25 || r.s0 < 0.04 || r.s1 > pf.len - 0.04) return;
    if (hard.some(k => overlaps(r, k)) || st.placed.some(p => p.layer === 'cut' && overlaps(r, p, 0.04))) return;
    push(st, ctx, {kind: 'streak', ...r, cell: st.rng.pick(['streakA', 'streakB', 'streakC'] as const), tint: [0.4, 0.22, 0.1], flip: st.rng.chance(0.5)});
  };
  const near = ctx.near!.at(pf.axis, planeOf(pf));
  for (const si of near.signs) {
    const s = ctx.layout.signs[si];
    if (s.hang || s.y < f.y0 - 0.5 || s.y > f.y1 + 0.5) continue;
    if (Math.sin(s.rot) * f.nx + Math.cos(s.rot) * f.nz < 0.9) continue;
    if ((pf.axis === 'z' ? Math.abs(s.z - f.z0) : Math.abs(s.x - f.x0)) > 0.3) continue;
    const {w, h} = signDims(s);
    const sc = sOf(pf, pf.axis === 'z' ? s.x : s.z);
    for (const side of [-1, 1]) if (st.rng.chance(0.15 + 0.7 * pf.condition)) run(sc + side * w * 0.38, s.y - h / 2 + 0.01, st.rng.range(0.1, 0.22), st.rng.range(0.3, 1.2));
  }
  for (const b of near.rails) {
    const r = boxOnFace(pf, b, 0.25);
    if (!r) continue;
    for (let s = r.s0 + 0.3; s < r.s1 - 0.2; s += 1.2) if (st.rng.chance(0.35 * pf.condition)) run(s, r.y0 - 0.02, st.rng.range(0.08, 0.16), st.rng.range(0.25, 0.8));
  }
}

/** A leak: streak down from the ceiling, efflorescence at its foot, finish damage around it. */
function hotspot(st: FaceState, ctx: PlanCtx, sc: number, id: number): void {
  const pf = st.pf, f = pf.face, H = f.y1 - f.y0, rng = st.rng;
  const rust = rng.chance(0.4);
  const streak = streakAt(st, ctx, sc, rng.range(0.55, 0.85), rust ? 'rust' : 'water', id);
  const footY = streak ? streak.y0 : f.y1 - Math.min(H, 1.8);
  if (rng.chance(0.75)) {
    const ey = Math.max(f.y0, footY - rng.range(0.1, 0.3));
    const r = {s0: sc - 0.6, s1: sc + 0.6, y0: ey, y1: Math.min(f.y1, ey + 0.6)};
    if (r.s0 > 0.05 && r.s1 < pf.len - 0.05) place(st, ctx, {kind: 'efflor', ...r, cell: 'efflor', tint: [0.93, 0.92, 0.88], hotspot: id});
  }
  // Damage concentrated around the wet zone.
  const nDmg = 1 + (rng.chance(pf.condition) ? 1 : 0) + (rng.chance(pf.condition * 0.5) ? 1 : 0);
  for (let k = 0; k < nDmg; k++) {
    const ds = rng.range(-0.9, 0.9), y = Math.max(f.y0 + 0.2, Math.min(f.y1 - 0.3, footY + rng.range(-0.5, 0.9)));
    finishDamage(st, ctx, sc + ds, y, 1, id);
  }
  if (rng.chance(0.8)) crackAt(st, ctx, sc + rng.range(-0.6, 0.6), Math.max(f.y0 + 0.4, footY + rng.range(-0.2, 0.6)), id);
  if (rng.chance(0.45)) patchAt(st, ctx, sc + rng.range(-1.4, 1.4), f.y0 + rng.range(0.4, Math.min(2.0, H - 0.4)), id);
}

function streakAt(st: FaceState, ctx: PlanCtx, sc: number, w: number, tone: 'water' | 'rust' | 'grime', id?: number): Feature | null {
  const pf = st.pf, f = pf.face, H = f.y1 - f.y0, rng = st.rng;
  const len = Math.min(H - 0.1, rng.range(1.0, 2.6));
  if (len < 0.5) return null;
  const tint: [number, number, number] = tone === 'rust' ? [0.36, 0.22, 0.12] : tone === 'water' ? [0.3, 0.29, 0.26] : [0.24, 0.23, 0.21];
  const r = {s0: sc - w / 2, s1: sc + w / 2, y0: f.y1 - len, y1: f.y1};
  return place(st, ctx, {kind: 'streak', ...r, cell: rng.pick(['streakA', 'streakB', 'streakC'] as const), tint, flip: rng.chance(0.5), hotspot: id});
}

function crackAt(st: FaceState, ctx: PlanCtx, sc: number, yc: number, id?: number): void {
  const k = st.rng.range(0.45, 0.85);
  place(st, ctx, {kind: 'crack', s0: sc - k / 2, s1: sc + k / 2, y0: yc - k / 2, y1: yc + k / 2, cell: st.rng.chance(0.5) ? 'crackA' : 'crackB', flip: st.rng.chance(0.5), hotspot: id});
}

/** Repair patch: whole replacement tiles (tile walls), repainted rectangle or render patch. */
function patchAt(st: FaceState, ctx: PlanCtx, sc: number, yc: number, id?: number): void {
  const pf = st.pf, f = pf.face, rng = st.rng;
  if (pf.finish === 'tile') {
    const r = tileRect(pf, sc, yc, rng.int(2, 3), rng.int(2, 3));
    if (!r) return;
    // Replacement tiles are plain cream: keep them off the charcoal base courses and the teal band.
    const rel0 = r.rect.y0 - f.base, rel1 = r.rect.y1 - f.base;
    if (rel0 < 0.3 - 1e-6 || (rel0 < 1.5 - 1e-6 && rel1 > 1.35 + 1e-6)) return;
    const tone = rng.pick([[1.02, 1.02, 1.0], [0.86, 0.88, 0.86], [0.93, 0.95, 0.9], [0.9, 0.86, 0.78]] as [number, number, number][]);
    place(st, ctx, {kind: 'patch', ...r.rect, cell: 'tilePatch', tint: tone, grid: r.grid, hotspot: id});
  } else if (pf.finish === 'shopTile') {
    const w = SHOP_TILE * rng.int(2, 4), h = SHOP_TILE * rng.int(2, 4);
    const s0 = snapC(pf, sc - w / 2, SHOP_TILE), y0 = Math.round(yc / SHOP_TILE) * SHOP_TILE;
    const r = {s0: Math.min(s0, s0 + w * pf.dir), s1: Math.max(s0, s0 + w * pf.dir), y0, y1: y0 + h};
    place(st, ctx, {kind: 'patch', ...r, cell: 'shopTilePatch', tint: [0.95, 0.96, 0.93], hotspot: id});
  } else {
    const w = rng.range(0.4, 1.0), h = rng.range(0.3, 0.8);
    // Paint walls: keep a repaint inside one colour zone of the painted block (dado to 1.15 m).
    let y0 = yc - h / 2, y1 = yc + h / 2;
    const rel = (y: number) => y - f.base;
    let tint: [number, number, number] = [0.66, 0.65, 0.62];
    if (pf.finish === 'paint') {
      if (rel(yc) < 1.15) { y0 = Math.max(f.base + 0.16, y0); y1 = Math.min(f.base + 1.12, y1); tint = rng.chance(0.5) ? [0.3, 0.5, 0.48] : [0.34, 0.47, 0.46]; }
      else { y0 = Math.max(f.base + 1.2, y0); tint = rng.chance(0.5) ? [0.86, 0.83, 0.74] : [0.8, 0.79, 0.72]; }
    }
    if (y1 - y0 < 0.2) return;
    place(st, ctx, {kind: 'patch', s0: sc - w / 2, s1: sc + w / 2, y0, y1, cell: pf.finish === 'paint' ? 'paintPatch' : 'concretePatch', tint, hotspot: id});
  }
}

/** Snap a face s to the world grid of period p (returns s of the grid line at or below in c). */
function snapC(pf: PlannedFace, s: number, p: number, off = 0): number {
  const c = cOf(pf, s);
  return sOf(pf, Math.floor((c - off) / p) * p + off);
}

/** Subway-tile course containing relative height `rel` (from the face base). */
export function subwayCourse(rel: number): {y0: number; y1: number; offset: boolean; idx: number} {
  if (rel < SUBWAY.split) {
    const k = Math.max(0, Math.floor(rel / SUBWAY.h + 1e-9));
    return {y0: k * SUBWAY.h, y1: (k + 1) * SUBWAY.h, offset: k % 2 === 0, idx: k};
  }
  const n = Math.floor((rel - SUBWAY.split) / SUBWAY.upperH + 1e-9);
  return {y0: SUBWAY.split + n * SUBWAY.upperH, y1: SUBWAY.split + (n + 1) * SUBWAY.upperH, offset: n % 2 === 0, idx: 12 + n};
}

/** Tile-aligned rect (cols x rows tiles) around (sc, yc) on a subway-tile face, with its back-grid. */
function tileRect(pf: PlannedFace, sc: number, yc: number, cols: number, rows: number): {rect: Rect; grid: Feature['grid']} | null {
  const f = pf.face;
  const course = subwayCourse(yc - f.base);
  const y0 = f.base + course.y0;
  let y1 = y0;
  for (let i = 0; i < rows; i++) y1 = f.base + subwayCourse(y1 - f.base + 1e-6).y1;
  // Patches (flush decal) are tile-aligned on the bottom course's joints; staggered rows are handled by the cell.
  const off = course.offset ? SUBWAY.w / 2 : 0;
  const ca = Math.floor((cOf(pf, sc) - off) / SUBWAY.w - cols / 2) * SUBWAY.w + off;
  const cb = ca + cols * SUBWAY.w;
  const s0 = Math.min(sOf(pf, ca), sOf(pf, cb)), s1 = Math.max(sOf(pf, ca), sOf(pf, cb));
  return {rect: {s0, s1, y0, y1}, grid: {pu: SUBWAY.w, pv: 2 * SUBWAY.h, ou: course.offset ? 0 : SUBWAY.w / 2, ov: course.offset ? y0 : y0 - SUBWAY.h}};
}

/** Per-face bound on cut features (long walls get proportionally more). */
export function perFaceCutCap(len: number): number {
  return Math.floor(WALL_DETAIL_CAPS.perFaceCut + len * WALL_DETAIL_CAPS.perFaceCutPerM);
}

/** Missing tiles (tile walls) or spalled finish (paint / concrete) around (sc, yc). */
function finishDamage(st: FaceState, ctx: PlanCtx, sc: number, yc: number, scale: number, id?: number): void {
  const pf = st.pf;
  if (pf.finish === 'office') return; // task office-overhaul-20261030 (lane ARCH): plasterboard leaks show as runs + cracks, never cut block
  if (st.placed.filter(p => p.layer === 'cut').length >= perFaceCutCap(pf.len)) return;
  if (pf.finish === 'tile') tileLoss(st, ctx, sc, yc, scale, id);
  else if (pf.finish === 'shopTile') shopTileLoss(st, ctx, sc, yc, id);
  else spall(st, ctx, sc, yc, scale, id);
}

/** Stepped cluster of whole missing subway tiles (rows overlap so the outline is one simple polygon). */
function tileLoss(st: FaceState, ctx: PlanCtx, sc: number, yc: number, scale: number, id?: number): void {
  const pf = st.pf, f = pf.face, rng = st.rng;
  // Leaks debond whole fields of tiles (up to 5 courses); elsewhere 1-3 courses.
  const field = scale >= 1 && rng.chance(0.35 + 0.4 * pf.condition);
  const rows = field ? rng.int(3, 5) : 1 + (rng.chance(0.6 * scale) ? 1 : 0) + (rng.chance(0.35 * scale) ? 1 : 0);
  const base = subwayCourse(yc - f.base);
  // Never start in the bottom course (it sits on the quad edge at the floor).
  if (base.idx < 1) return;
  let c = cOf(pf, sc);
  const rects: {c0: number; c1: number; y0: number; y1: number}[] = [];
  let y = base.y0; // relative to the face's texture base
  let prev: [number, number] | null = null;
  for (let r = 0; r < rows; r++) {
    const co = subwayCourse(y + 1e-6);
    const off = co.offset ? SUBWAY.w / 2 : 0;
    const n = field ? rng.int(2, 4) : rng.int(r === 0 ? 2 : 1, r === 0 ? 3 : 2);
    let j0 = Math.floor((c - off) / SUBWAY.w);
    if (prev) {
      // Overlap the row below by at least half a tile.
      const lo = Math.ceil((prev[0] + SUBWAY.w / 2 - off) / SUBWAY.w) - n, hi = Math.floor((prev[1] - SUBWAY.w / 2 - off) / SUBWAY.w);
      j0 = Math.max(lo, Math.min(hi, j0 - (n > 1 ? rng.int(0, 1) : 0)));
    }
    const c0 = off + j0 * SUBWAY.w, c1 = c0 + n * SUBWAY.w;
    if (prev && (c1 <= prev[0] + 0.1 || c0 >= prev[1] - 0.1)) break;
    rects.push({c0, c1, y0: f.base + co.y0, y1: f.base + co.y1});
    prev = [c0, c1];
    c = (c0 + c1) / 2;
    y = co.y1;
  }
  while (rects.length > 1 && (Math.max(...rects.map(q => q.c1)) - Math.min(...rects.map(q => q.c0)) > 1.75 || rects[rects.length - 1].y1 - rects[0].y0 > 0.85)) rects.pop();
  if (!rects.length) return;
  const outline = steppedOutline(pf, rects);
  const b = bounds(outline);
  place(st, ctx, {kind: 'tileLoss', ...b, outline, depth: rng.range(0.014, 0.018), back: 'mortarBed', side: 'tileBody',
    grid: {pu: SUBWAY.w, pv: 2 * SUBWAY.h, ou: 0, ov: f.base}, hotspot: id});
}

function shopTileLoss(st: FaceState, ctx: PlanCtx, sc: number, yc: number, id?: number): void {
  const pf = st.pf, f = pf.face, rng = st.rng, T = SHOP_TILE;
  const cols = rng.int(1, 3), rows = rng.int(1, 2);
  const c0 = Math.floor(cOf(pf, sc) / T) * T, y0 = Math.max(Math.ceil((f.y0 + 0.05) / T) * T, Math.floor(yc / T) * T);
  const rects = [{c0, c1: c0 + cols * T, y0, y1: y0 + T}];
  if (rows > 1) { const k = rng.int(0, cols - 1); rects.push({c0: c0 + k * T, c1: c0 + (k + 1) * T, y0: y0 + T, y1: y0 + 2 * T}); }
  const outline = steppedOutline(pf, rects);
  place(st, ctx, {kind: 'tileLoss', ...bounds(outline), outline, depth: rng.range(0.012, 0.016), back: 'mortarBed', side: 'tileBody', hotspot: id});
}

/** Spalled paint / render / concrete: irregular star-shaped flake exposing the substrate. */
function spall(st: FaceState, ctx: PlanCtx, sc: number, yc: number, scale: number, id?: number): void {
  const pf = st.pf, rng = st.rng;
  const concrete = pf.finish === 'concrete';
  const rx = rng.range(0.1, 0.3) * (0.7 + 0.5 * scale), ry = Math.min(0.3, rx * rng.range(0.55, 1.05));
  const {outline, center} = starOutline(rng, sc, yc, rx, ry, 22, concrete ? 0.3 : 0.4);
  const brick = pf.treatment === 'upperFinish' && rng.chance(0.5);
  const back: AtlasCell = concrete ? 'concreteRaw' : brick ? 'brickBare' : 'blockBare';
  place(st, ctx, {kind: 'spall', ...bounds(outline), outline, center, depth: concrete ? rng.range(0.018, 0.035) : rng.range(0.008, 0.016), back, side: 'breakSide',
    grid: back === 'blockBare' ? {pu: BLOCK.w, pv: 2 * BLOCK.h, ou: 0, ov: pf.face.base} : undefined,
    rim: concrete ? {cell: 'fracture', w0: 0.008, w1: 0.03} : {cell: 'skim', w0: 0.006, w1: 0.022}, hotspot: id});
}

/**
 * Star-shaped jagged outline (counter-clockwise in s, y), fitted to the box sc +- rx, yc +- ry, and
 * the point it is star-shaped around.
 */
export function starOutline(rng: Rng, sc: number, yc: number, rx: number, ry: number, n: number, jag: number): {outline: [number, number][]; center: [number, number]} {
  const raw: [number, number][] = [];
  const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const lobe = 1 + 0.18 * Math.sin(2 * a + ph[0]) + 0.12 * Math.sin(3 * a + ph[1]) + 0.08 * Math.sin(5 * a + ph[2]);
    const r = Math.max(0.45, lobe * (1 - jag / 2 + jag * rng.next()));
    raw.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const b = bounds(raw);
  const cx = (b.s0 + b.s1) / 2, cy = (b.y0 + b.y1) / 2, kx = 2 * rx / (b.s1 - b.s0), ky = 2 * ry / (b.y1 - b.y0);
  return {outline: raw.map(([x, y]) => [sc + (x - cx) * kx, yc + (y - cy) * ky] as [number, number]), center: [sc - cx * kx, yc - cy * ky]};
}

function bounds(o: [number, number][]): Rect {
  let s0 = Infinity, s1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [s, y] of o) { s0 = Math.min(s0, s); s1 = Math.max(s1, s); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return {s0, s1, y0, y1};
}

/** Outline of stacked overlapping row rects (world c, y) as a CCW polygon in face (s, y). */
function steppedOutline(pf: PlannedFace, rows: {c0: number; c1: number; y0: number; y1: number}[]): [number, number][] {
  const r = rows.map(q => {
    const a = sOf(pf, q.c0), b = sOf(pf, q.c1);
    return {a: Math.min(a, b), b: Math.max(a, b), y0: q.y0, y1: q.y1};
  });
  const pts: [number, number][] = [[r[0].a, r[0].y0], [r[0].b, r[0].y0]];
  for (let i = 0; i < r.length; i++) {
    pts.push([r[i].b, r[i].y1]);
    if (i + 1 < r.length) pts.push([r[i + 1].b, r[i].y1]);
  }
  const top = r.length - 1;
  pts.push([r[top].a, r[top].y1]);
  for (let i = top; i > 0; i--) { pts.push([r[i].a, r[i].y0]); pts.push([r[i - 1].a, r[i].y0]); }
  // Drop repeated / collinear points.
  const clean: [number, number][] = [];
  for (const p of pts) {
    const q = clean[clean.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
    clean.push(p);
  }
  if (clean.length > 1 && Math.abs(clean[0][0] - clean[clean.length - 1][0]) < 1e-6 && Math.abs(clean[0][1] - clean[clean.length - 1][1]) < 1e-6) clean.pop();
  const out: [number, number][] = [];
  for (let i = 0; i < clean.length; i++) {
    const a = clean[(i + clean.length - 1) % clean.length], b = clean[i], c = clean[(i + 1) % clean.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Service details

function fittings(st: FaceState, ctx: PlanCtx, R: Recipe): void {
  const pf = st.pf, f = pf.face, H = f.y1 - f.y0, rng = st.rng;
  // Tunnel cable runs: three cables on brackets along the whole wall, broken at keep-outs.
  if (R.cables && H > 2.2 && pf.len > 3) {
    const y = f.y0 + Math.min(1.95, H - 0.4);
    proudRun(st, ctx, 'cables', y, 0.012, 0.09, 1.2, [0, -0.09, -0.18]);
  }
  // Conduit along the top of service walls (passes over doorways whose lintel is well below it).
  if (R.conduit > 0 && H > 2.5 && pf.len > 2 && rng.chance(R.conduit * (st.pf.face.areaType === 'service-corridor' ? 1.3 : 1))) {
    const y = Math.min(f.y1 - 0.18, f.y0 + rng.range(2.35, 2.75));
    proudRun(st, ctx, 'conduit', y, 0.014, 0.035, 0.9);
  }
  if (R.pipe > 0 && H > 2.2 && pf.len > 3 && rng.chance(R.pipe)) {
    const low = rng.chance(0.5);
    const y = low ? f.y0 + rng.range(0.35, 0.5) : Math.min(f.y1 - 0.25, f.y0 + rng.range(2.15, 2.4));
    proudRun(st, ctx, 'pipe', y, rng.range(0.035, 0.055), 0.09, 1.5);
  }
  // Light switch / junction boxes beside doorways (service doors), fed from above.
  if (R.switchBox > 0) {
    for (const o of f.openings) {
      if (o.top > f.y1 - 0.2 || !rng.chance(R.switchBox)) continue;
      for (const side of rng.chance(0.5) ? [1, -1] : [-1, 1]) {
        const sc = side > 0 ? o.s1 + 0.3 : o.s0 - 0.3;
        const box = {s0: sc - 0.05, s1: sc + 0.05, y0: f.y0 + 1.18, y1: f.y0 + 1.32};
        if (!free(st, box, 'proud')) continue;
        const run = st.placed.find(p => p.kind === 'conduit' && p.path && p.s0 <= sc && p.s1 >= sc);
        const topY = run ? run.path![0][1] : f.y1 - 0.02;
        const drop = {s0: sc - 0.02, s1: sc + 0.02, y0: box.y1, y1: topY};
        if (drop.y1 - drop.y0 > 0.1 && !freeIgnoring(st, drop, 'proud', run)) continue;
        push(st, ctx, {kind: 'switchBox', ...box, off: 0.03});
        if (drop.y1 - drop.y0 > 0.1) push(st, ctx, {kind: 'conduit', ...drop, path: [[sc, box.y1], [sc, topY]], radius: 0.011, off: 0.035, brackets: 0.8});
        break;
      }
    }
  }
}

function freeIgnoring(st: FaceState, r: Rect, layer: Layer, ignore: Feature | undefined): boolean {
  if (!ignore) return free(st, r, layer);
  const i = st.placed.indexOf(ignore);
  st.placed.splice(i, 1);
  const ok = free(st, r, layer);
  st.placed.splice(i, 0, ignore);
  return ok;
}

/** Horizontal proud run at height y, split into pieces around keep-outs (ends get a box). */
function proudRun(st: FaceState, ctx: PlanCtx, kind: 'conduit' | 'pipe' | 'cables', y: number, radius: number, off: number, brackets: number, runs?: number[]): void {
  const pf = st.pf;
  const lo = runs ? Math.min(...runs) : 0, hi = runs ? Math.max(...runs) : 0;
  const pad = Math.max(radius, 0.03);
  const probe = {s0: 0, s1: pf.len, y0: y + lo - pad, y1: y + hi + pad};
  const blocks: [number, number][] = [];
  for (const k of pf.keepouts) if ((k.mask & M.proud) && overlaps(probe, k)) blocks.push([k.s0, k.s1]);
  for (const p of st.placed) if (p.layer === 'cut' || p.layer === 'proud') if (overlaps(probe, p, 0.04)) blocks.push([p.s0 - 0.04, p.s1 + 0.04]);
  blocks.sort((a, b) => a[0] - b[0]);
  let s = 0.25;
  const spans: [number, number][] = [];
  for (const [a, b] of blocks) { if (a > s) spans.push([s, a]); s = Math.max(s, b); }
  if (s < pf.len - 0.25) spans.push([s, pf.len - 0.25]);
  for (const [a, b] of spans) {
    if (b - a < 1.2) continue;
    const r = {s0: a, s1: b, y0: probe.y0, y1: probe.y1};
    if (!free(st, r, 'proud')) continue;
    push(st, ctx, {kind, ...r, path: [[a, y], [b, y]], radius, off, brackets, runs});
  }
}

// ---------------------------------------------------------------------------------------------
// Station-level: a few genuinely broken sections

function planBreaches(ctx: PlanCtx, faces: PlannedFace[], rng: Rng, byFace: Feature[][], from = 0, to = faces.length, maxBreach: number = WALL_DETAIL_CAPS.breach): void {
  type Cand = {i: number; score: number};
  const cands: Cand[] = [];
  faces.forEach((pf, i) => {
    if (i < from || i >= to) return;
    const R = RECIPES[pf.treatment];
    if (R.breach <= 0 || pf.len < 3 || pf.face.y1 - pf.face.y0 < 2.3) return;
    const area = ctx.layout.areas[pf.face.area];
    const dark = area?.lighting === 'dark' ? 0.5 : area?.lighting === 'dim' ? 0.25 : 0;
    cands.push({i, score: R.breach * (0.4 + pf.condition + dark) * (0.6 + 0.8 * new Rng(pf.face.seed ^ 0xb4ea).next())});
  });
  cands.sort((a, b) => b.score - a.score || a.i - b.i);
  const want = Math.min(maxBreach, 2 + (rng.chance(0.5) ? 1 : 0) + (rng.chance(0.25) ? 1 : 0));
  const placedAt: [number, number, number][] = [];
  for (const c of cands) {
    if (placedAt.length >= want) break;
    const pf = faces[c.i], f = pf.face;
    const frng = new Rng(f.seed ^ 0xb7ea);
    for (let t = 0; t < 6; t++) {
      const w = frng.range(0.45, 0.85), h = frng.range(0.4, 0.75);
      // A face may end at a doorway (the builder ends faces at trailing openings): keep 1 m from the ends too.
      const sc = frng.range(BREACH_OPENING_CLEAR + w / 2, pf.len - BREACH_OPENING_CLEAR - w / 2);
      const yc = f.y0 + frng.range(0.45 + h / 2, Math.min(1.75, f.y1 - f.y0 - 0.4) - h / 2);
      if (!Number.isFinite(sc) || !Number.isFinite(yc)) continue;
      const [wx, , wz] = [f.x0 + (f.x1 - f.x0) * sc / pf.len, 0, f.z0 + (f.z1 - f.z0) * sc / pf.len];
      if (placedAt.some(([x, y, z]) => Math.hypot(x - wx, z - wz) < 15 && Math.abs(y - yc) < 3)) break;
      const {outline, center} = starOutline(frng, sc, yc, w / 2, h / 2, 26, 0.32);
      const b = bounds(outline);
      if (f.openings.some(o => b.s1 > o.s0 - BREACH_OPENING_CLEAR && b.s0 < o.s1 + BREACH_OPENING_CLEAR)) continue;
      if (b.y0 < f.y0 + 0.35 || b.y1 > f.y0 + 1.9) continue;
      if (pf.sloped || !cutFits(pf, {...b, s0: b.s0 - 0.12, s1: b.s1 + 0.12})) continue;
      const depth = frng.range(0.18, 0.27);
      if (!solidBehind(ctx.levels, pf, b, depth + 0.12)) continue;
      // A breach replaces lighter damage it overlaps (decals / stains under it): structure, other cuts and fittings block it.
      const blocking = byFace[c.i].filter(p => (p.layer === 'cut' || p.layer === 'flush' || p.layer === 'proud') && overlaps(b, p, 0.1));
      if (blocking.length) continue;
      const rim = {cell: 'fracture' as AtlasCell, w0: 0.03, w1: 0.11};
      const ring = {s0: b.s0 - rim.w1, s1: b.s1 + rim.w1, y0: b.y0 - rim.w1, y1: b.y1 + rim.w1};
      if (!keepoutClear(pf, ring, 'cut')) continue;
      // Remove decal / soft features under the breach and its rim.
      const gone = new Set(byFace[c.i].filter(x => (x.layer === 'decal' || x.layer === 'soft') && overlaps(ring, x)));
      if (gone.size) {
        byFace[c.i] = byFace[c.i].filter(x => !gone.has(x));
        for (let k = ctx.features.length - 1; k >= 0; k--) if (gone.has(ctx.features[k])) ctx.features.splice(k, 1);
      }
      const bars: Feature['bars'] = [];
      const nb = frng.int(2, 4);
      for (let k = 0; k < nb; k++) {
        const horiz = k % 2 === 0;
        const at = horiz ? frng.range(b.y0 + 0.08, b.y1 - 0.08) : frng.range(b.s0 + 0.08, b.s1 - 0.08);
        bars.push({axis: horiz ? 's' : 'y', at, depth: frng.range(0.05, Math.min(0.11, depth - 0.04)), a0: (horiz ? b.s0 : b.y0) - 0.12, a1: (horiz ? b.s1 : b.y1) + 0.12});
      }
      const feat: Feature = {kind: 'breach', layer: 'cut', face: c.i, seed: frng.int(0, 0x7fffffff), ...b, outline, center, depth, back: 'cavity', side: 'breakSide',
        rim, bars, rubble: pf.atFloor ? frng.int(5, 9) : 0};
      ctx.features.push(feat);
      byFace[c.i].push(feat);
      placedAt.push([wx, yc, wz]);
      break;
    }
  }
}

/** True when the wall volume behind a face rect (to `depth`) is solid on every level. */
export function solidBehind(levels: Levels, pf: PlannedFace, r: Rect, depth: number): boolean {
  const f = pf.face;
  for (let s = r.s0 - 0.1; s <= r.s1 + 0.1 + 1e-6; s += 0.1) {
    const along = Math.min(Math.max(s, 0), pf.len);
    const bx = f.x0 + (f.x1 - f.x0) * along / pf.len, bz = f.z0 + (f.z1 - f.z0) * along / pf.len;
    for (const d of [0.04, depth / 2, depth]) {
      const x = bx - f.nx * d, z = bz - f.nz * d;
      for (let y = r.y0 - 0.05; y <= r.y1 + 0.05 + 1e-6; y += 0.12) if (levels.isFree(x, y, z)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------

/** Enforce per-station budgets (structure / identity first, then hotspot damage, then background). */
function applyCaps(features: Feature[], faces: PlannedFace[], caps: Record<Layer, number> = WALL_DETAIL_CAPS): {features: Feature[]; dropped: number} {
  void faces;
  const rank = (f: Feature) => (f.layer === 'flush' ? 0 : f.kind === 'breach' ? 1 : f.hotspot !== undefined ? 2 : 3);
  const order = features.map((f, i) => ({f, i})).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i);
  const used: Record<Layer, number> = {flush: 0, decal: 0, soft: 0, cut: 0, proud: 0};
  const cap: Record<Layer, number> = {flush: caps.flush, decal: caps.decal, soft: caps.soft, cut: caps.cut, proud: caps.proud};
  const keep = new Set<number>();
  for (const {f, i} of order) {
    if (used[f.layer] >= cap[f.layer]) continue;
    used[f.layer]++;
    keep.add(i);
  }
  const out = features.filter((_, i) => keep.has(i));
  return {features: out, dropped: features.length - out.length};
}
