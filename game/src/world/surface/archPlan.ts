// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): THE DISTRICT LOOK PLAN — everything the Surface Run district's
// architecture draws, decided once per layout from GEN's data (`layout.surface` + the grid). PURE (no three.js / DOM): the builder's
// surface arch (arch.ts) reads it for finish keys, face clipping / window cuts and its build step; the daylight bake (lookDaylight.ts)
// reads its height map; tests read it directly.
//
//  - GROUND: a class per level-0 cell — carriageway / sidewalk / lot / plaza / yard / checkpoint / tent / verge / interior. Streets come
//    from GEN's SurfaceStreet segments, else (the contract skeleton) from the gaps between the block rects (a block rect is the kerb
//    rect: its sidewalks included).
//  - MARKINGS: per street segment by rank (avenue: double yellow + dashed lanes + edge lines; street: dashed centre; lane: none),
//    crosswalks + stop lines at both junction ends; patches, cracks, potholes, manholes, drains, kerb strips; the rail spur into the
//    depot.
//  - BUILDINGS: per building its facade style (archStyles.ts), tint, storey height, roof line (a RUIN PROFILE per facade side: damaged =
//    a collapsed corner notch, gutted = a jagged burnt top, collapsed = a low jagged stump), roof decks, decorative window grid per
//    storey (glass / broken / boarded / dark / shutter), GEN's live window spans (AIR's panes: cut + framed, never glazed here),
//    shopfront bays + runtime-text signs, fire escapes, rooftop clutter and rubble.
//  - TENT: the checkpoint command tent's frame (walls, pitched roof, flap door seam for AIR, guy lines).
// Deterministic from the district seed (its own hash streams: never GEN's generator streams). Memoized per layout.

import {CELL, FLOOR, SOLID} from '../../gen/grid';
import type {Side, StationLayout} from '../../gen/stationTypes';
import type {SRect, SurfaceBuilding, SurfaceInfo, SurfaceStreet, SurfaceWindowSpan} from '../../gen/surface/surfaceTypes';
import {mulberry32} from '../../core/rng';
import {drainSync, type BuildSteps} from '../../core/pacedBuild';
import {FACADE_STYLES, INTERIOR_LOOKS, SHOPFRONT_NAMES, interiorFamilyOf, surfaceStyleOf, type FacadeStyle, type InteriorFamily} from './archStyles';

/**
 * Lane GEN's OPTIONAL shape / ground records (gen/surface/surfaceTypes.ts additive fields): read when present, the skeleton path
 * otherwise. Typed here structurally, so LOOK compiles before and after GEN's fields land.
 */
export interface GenBuildingShape {
  storeyHeights?: number[]; parapet?: number; roofY?: number; frontage?: Side; exposed?: Side[];
  collapse?: {corner: 'NW' | 'NE' | 'SW' | 'SE'; rect: SRect};
  host?: string;
}
export interface GenGround {
  lots?: {rect: SRect; use: string; grade: number; area: number; diagonal?: boolean}[];
  junctions?: {rect: SRect}[];
  rubble?: (SRect & {edge: number; crown: number; kind: string})[];
  rail?: {rects: SRect[]; dir: Side; centre: number};
  cordon?: SRect;
}
const shapeOf = (b: SurfaceBuilding): GenBuildingShape => b as SurfaceBuilding & GenBuildingShape;
/** The checkpoint's command tent drawn as GEN's building (its canvas walls are SOLID cells: LOOK draws canvas + the pitched roof). */
export const isTentBuilding = (b: SurfaceBuilding): boolean => shapeOf(b).host === 'tent' || b.facade === 'tent-canvas' || b.programme === 'tent';

/** Ground classes (per level-0 cell). */
export const GROUND = {none: 0, road: 1, walk: 2, lot: 3, plaza: 4, yard: 5, check: 6, tent: 7, verge: 8, interior: 9} as const;
export type GroundClass = typeof GROUND[keyof typeof GROUND];
export const GROUND_KEYS: Readonly<Record<number, string>> = {
  [GROUND.road]: 'surface-road', [GROUND.walk]: 'surface-walk', [GROUND.lot]: 'surface-lot', [GROUND.plaza]: 'surface-plaza',
  [GROUND.yard]: 'surface-yard', [GROUND.check]: 'surface-check', [GROUND.tent]: 'surface-tent-floor', [GROUND.verge]: 'surface-verge',
};

/** Owner codes of SOLID cells that are not a building (plan.owner). */
export const OWNER = {none: -1, cordon: -2, tent: -3, debris: -4} as const;

/** Look tunables (metres). */
export const LOOK_TUNE = {
  /** Cordon wall height above the street (the SOLID boundary ring's faces are clipped to it) and its coping. */
  cordonH: 3.4,
  /** Height of non-building SOLID debris / barricade blocks inside the district. */
  debrisH: 1.1,
  /** Tent: eave and ridge heights, guy-line spread. */
  tentEave: 2.15, tentRidge: 3.4, tentGuy: 1.6,
  /** Default sidewalk width where none is known, and the outer (cordon-side) sidewalk. */
  sidewalk: 3, outerWalk: 2.5,
  /** Decal heights above their floor. */
  decalY: 0.012,
  /** Parapet wall thickness (inner face inset), window reveal depth, dark room depth behind decorative panes. */
  parapetT: 0.3, reveal: 0.16, room: 0.9,
  /** Never clip a facade lower than this above an interior's ceiling (the room stays closed). */
  overCeil: 0.45,
} as const;

export interface StreetSeg {
  id: number;
  /** Travel axis: 'x' = runs east-west (constant z centre), 'z' = runs north-south. */
  axis: 'x' | 'z';
  /** Centre line coordinate across the axis, carriageway width, along-axis extent (junction edge to junction edge). */
  c: number; w: number; s0: number; s1: number;
  rank: SurfaceStreet['rank'];
  name: string;
  derived: boolean;
}

export type DecalKind = 'white' | 'yellow' | 'patch' | 'pothole' | 'crack' | 'scorch' | 'oil' | 'kerb' | 'gutter';
/** A flat ground decal (axis-aligned rect, or rotated by `rot` around its centre). */
export interface Decal { kind: DecalKind; x0: number; z0: number; x1: number; z1: number; y: number; rot?: number }
export interface Disc { kind: 'manhole' | 'drain'; x: number; z: number; y: number; r: number; rot: number }

export type HoleKind = 'glass' | 'broken' | 'boarded' | 'dark' | 'shutter' | 'air' | 'shop' | 'door-boarded';
/** A window / opening on a facade side, in world coordinates (s along the side's axis). */
export interface FacadeHole {
  side: Side; s0: number; s1: number; y0: number; y1: number;
  kind: HoleKind;
  /** Storey index; the AIR span id when kind 'air'; scorch above (burnt out). */
  storey: number; span?: string; scorch?: boolean;
}
export interface TopSeg { s0: number; s1: number; top: number }
export interface FacadeSide {
  side: Side;
  /** Plane coordinate (z for N / S, x for W / E), outward normal sign, extent along the axis (world). */
  plane: number; n: 1 | -1; s0: number; s1: number;
  alongX: boolean;
  /** Faces a street / open ground (not a party wall onto another building). */
  open: boolean;
  frontage: boolean;
  tops: TopSeg[];
}
export interface ShopSign { side: Side; s0: number; s1: number; y0: number; y1: number; text: string; plane: number; n: 1 | -1; alongX: boolean }
export interface FireEscape {
  side: Side; s: number; plane: number; n: 1 | -1; alongX: boolean; levels: number[];
  /** Each landing's y (its storey's floor) and the ground it rises from. */
  ys: number[]; base: number;
}
export interface Placement { model: 'hvac' | 'tank' | 'rubble' | 'vent'; x: number; y: number; z: number; yaw: number; s: number }
export interface DeckRect { x0: number; z0: number; x1: number; z1: number; y: number; burnt: boolean }

export interface BuildingLook {
  id: number;
  b: SurfaceBuilding;
  style: FacadeStyle;
  tint: number;
  family: InteriorFamily;
  /** Finish keys: facade wall, trim. */
  key: string;
  trimKey: string;
  storeyH: number;
  storeys: number;
  /** Nominal parapet top and roof deck. */
  top: number;
  deck: number;
  /** Lowest point of the roof line (ruins). */
  minTop: number;
  /** Bottom (y) and height of every storey (GEN's storeyHeights, else even storeys). */
  storeyY: number[]; storeyHs: number[];
  sides: FacadeSide[];
  holes: FacadeHole[];
  signs: ShopSign[];
  escapes: FireEscape[];
  decks: DeckRect[];
  /** Interior storeys (absolute y ranges of the building's carved interiors). */
  interiors: [number, number][];
  /** Absolute y of the highest interior ceiling (0: none). */
  ceilTop: number;
}

export interface TentPlan {
  rect: SRect;
  door: {x: number; z: number; side: Side; width: number; height: number};
  /** The tent's floor and its eave / ridge (absolute y). */
  base: number; eave: number; ridge: number;
  /** The ridge runs along X (the tent is wider in X) or along Z. */
  ridgeX: boolean;
  /** Guy-line anchor points (ground) and their eave attach points. */
  guys: {ax: number; az: number; ex: number; ey: number; ez: number}[];
  /** The tent's walls are SOLID grid cells GEN carved (true) or LOOK draws free-standing canvas (false). */
  carved: boolean;
}

export interface RailSpur { points: {x: number; z: number}[]; y: number; gauge: number; buffer: {x: number; z: number; yaw: number} | null }

/**
 * Lane ROOMS' depot shed gear as published on `layout.surface.depot.features` (gen/surface/surfaceTypes.ts SurfaceDepotFeatures; read
 * structurally here: world metres, absolute heights). Optional and additive: absent = nothing drawn.
 */
export interface DepotFeaturesIn {
  tracks?: {x0: number; z0: number; x1: number; z1: number; gauge: number}[];
  pits?: {x0: number; z0: number; x1: number; z1: number; depth: number}[];
  crane?: {x0: number; z0: number; x1: number; z1: number; span: number; y: number; at: number; hookY: number; axis: 'x' | 'z'} | null;
}

/** The depot shed's gear LOOK draws (validated, floors resolved): embedded rails, the grated inspection pit, the overhead crane. */
export interface DepotGear {
  tracks: {x0: number; z0: number; x1: number; z1: number; gauge: number; y: number}[];
  pits: {x0: number; z0: number; x1: number; z1: number; y: number}[];
  crane: {x0: number; z0: number; x1: number; z1: number; y: number; at: number; hookY: number; axis: 'x' | 'z'; floor: number} | null;
}

export interface SurfaceLookPlan {
  W: number; H: number;
  seed: number;
  /** Per level-0 cell: ground class. */
  ground: Uint8Array;
  /** Per level-0 cell: building id of SOLID footprint cells / interior cells (>= 0), else an OWNER code. */
  owner: Int16Array;
  /** Outdoor area ids (layout areas). */
  outdoorAreas: ReadonlySet<number>;
  /** Interior area id -> building id. */
  areaBuilding: ReadonlyMap<number, number>;
  /** The tent's interior area ids (canvas walls, its floor boards, no flat ceiling: the pitched roof). */
  tentAreas: ReadonlySet<number>;
  /** Doorway cells (level-0 indices) of every entrance -> building id (their reveals take the facade). */
  doorCells: ReadonlyMap<number, number>;
  segments: StreetSeg[];
  decals: Decal[];
  discs: Disc[];
  buildings: BuildingLook[];
  /** AIR's live spans by id. */
  spans: ReadonlyMap<string, SurfaceWindowSpan>;
  tent: TentPlan | null;
  rail: RailSpur | null;
  /** The depot shed's tracks / pit / crane (lane ROOMS' features), null when none were published. */
  depot: DepotGear | null;
  placements: Placement[];
  /** The playable rect inside the cordon (world m). */
  inner: SRect;
  stats: Record<string, number>;
}

const cache = new WeakMap<StationLayout, SurfaceLookPlan | null>();

/** The district look plan of a layout (null: no `layout.surface`). Memoized per layout object. */
export function surfaceLookPlan(layout: StationLayout): SurfaceLookPlan | null {
  return cache.has(layout) ? cache.get(layout)! : drainSync(surfaceLookPlanSteps(layout));
}

/**
 * Follow-up 1 (lane LOOK): the plan as BUILD STEPS (core/pacedBuild.ts) — ~0.9 s of work on a real district, so the world build plans
 * it in slices (world/builder.ts, before SurfaceArch.for) and the loading screen keeps painting. The same work in the same order as
 * surfaceLookPlan; memoized alike (a plan someone finished meanwhile wins: one plan object per layout).
 */
export function* surfaceLookPlanSteps(layout: StationLayout): BuildSteps<SurfaceLookPlan | null> {
  if (cache.has(layout)) return cache.get(layout)!;
  const s = (layout as {surface?: SurfaceInfo}).surface;
  const p = s ? yield* planSurfaceLook(layout, s) : null;
  if (cache.has(layout)) return cache.get(layout)!;
  cache.set(layout, p);
  return p;
}

/** Whether the plan of `layout` is made (QA / tests: the section preload must not plan it). */
export const surfaceLookPlanned = (layout: StationLayout): boolean => cache.has(layout);

/**
 * Plan step label; cells per step of the plan's full-grid passes (a district grid is ~1.1 M cells: ~18 steps per pass, each a few ms
 * up to ~25 ms measured in Node; the whole plan ~0.4-0.7 s in ~200 steps).
 */
const PLAN_STEP = 'world.surface.plan';
const PLAN_CELLS = 1 << 16;

/** A seeded stream for one purpose (never GEN's generator streams). */
const stream = (seed: number, tag: number) => mulberry32(((seed ^ Math.imul(tag + 0x9e37, 0x85ebca6b)) >>> 0) || 1);
const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(r() * a.length))];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const SIDE_NORMAL: Readonly<Record<Side, {alongX: boolean; n: 1 | -1}>> = {
  N: {alongX: true, n: -1}, S: {alongX: true, n: 1}, W: {alongX: false, n: -1}, E: {alongX: false, n: 1},
};

/** The facade side a face lies on (normal + plane on the footprint edge), or null. */
export function sideOfPlane(fp: SRect, alongX: boolean, plane: number, n: number): Side | null {
  const e = 1e-4;
  if (alongX) return n < 0 && Math.abs(plane - fp.z0) < e ? 'N' : n > 0 && Math.abs(plane - fp.z1) < e ? 'S' : null;
  return n < 0 && Math.abs(plane - fp.x0) < e ? 'W' : n > 0 && Math.abs(plane - fp.x1) < e ? 'E' : null;
}

/**
 * Whether a cordon face (wall plane `plane` along X when `alongX`, its point `s` along it) closes a STREET: a carriageway (with its
 * sidewalks) that would run on through the cordon there. Those faces are drawn as a steel-plate barricade instead of the concrete wall.
 */
export function streetEndSpans(plan: Pick<SurfaceLookPlan, 'segments'>, alongX: boolean, plane: number): {s0: number; s1: number}[] {
  // a wall along X closes the streets running along Z (and the other way round) whose near end comes within `reach` of it (GEN's
  // frame: the perimeter carriageway between; the street would go on through the cordon). Returns the wall stretches (sorted,
  // merged) that face such a street end: carriageway + sidewalks.
  const reach = 42, out: {s0: number; s1: number}[] = [];
  for (const g of plan.segments) {
    if ((g.axis === 'z') !== alongX || g.derived && g.rank === 'lane') continue;
    if (Math.min(Math.abs(g.s0 - plane), Math.abs(g.s1 - plane)) > reach) continue;
    const h = g.w / 2 + LOOK_TUNE.sidewalk;
    out.push({s0: g.c - h, s1: g.c + h});
  }
  out.sort((a, b) => a.s0 - b.s0);
  const m: {s0: number; s1: number}[] = [];
  for (const r of out) { const l = m[m.length - 1]; if (l && r.s0 <= l.s1) l.s1 = Math.max(l.s1, r.s1); else m.push({...r}); }
  return m;
}

/**
 * The floor an entrance stands on: its doorway cell's grid floor (GEN's kerb, 0.15 m; lane AIR hangs its leaves from it), else the
 * open cell just outside (a boarded doorway stays SOLID: the sidewalk), else the level's base.
 */
export function entranceFloor(layout: StationLayout, e: {level: number; side: Side; x: number; z: number}): number {
  const lv = layout.levels?.[e.level];
  const g = lv?.grid ?? layout.grid;
  const {alongX, n} = SIDE_NORMAL[e.side];
  for (const off of [0, CELL, -CELL / 2, CELL / 2]) {
    const x = alongX ? e.x : e.x + n * off, z = alongX ? e.z + n * off : e.z;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= g.w || cz >= g.h) continue;
    const i = cz * g.w + cx;
    if (g.cells[i] === FLOOR) return g.floor[i];
  }
  return lv?.baseY ?? 0;
}

/** Roof line height at world s on a side (the segment containing s; the side's nominal top outside). */
export function topAt(side: FacadeSide, s: number, fallback: number): number {
  for (const t of side.tops) if (s >= t.s0 - 1e-6 && s <= t.s1 + 1e-6) return t.top;
  return fallback;
}

function* planSurfaceLook(layout: StationLayout, S: SurfaceInfo): BuildSteps<SurfaceLookPlan> {
  const g = layout.grid, W = g.w, H = g.h, n = W * H;
  const seed = S.seed >>> 0;
  const stats: Record<string, number> = {};
  const outdoorAreas = new Set<number>(S.outdoorAreas);
  outdoorAreas.add(S.checkpoint.area);
  const areaBuilding = new Map<number, number>();
  for (const b of S.buildings) for (const a of b.areas) areaBuilding.set(a, b.id);
  const doorCells = new Map<number, number>();
  for (const b of S.buildings) for (const e of b.entrances) for (const c of e.cells) doorCells.set(c, b.id);
  const cellOf = (m: number) => Math.floor(m / CELL + 1e-6);

  // --- owners ---------------------------------------------------------------------------------------------------------------------
  const owner = new Int16Array(n).fill(OWNER.none);
  const tentIds = new Set(S.buildings.filter(isTentBuilding).map(b => b.id));
  const tentAreas = new Set<number>([...S.buildings.filter(b => tentIds.has(b.id)).flatMap(b => b.areas), S.checkpoint.tent.area]);
  let fpK = 0;
  for (const b of S.buildings) {
    if (++fpK % 8 === 0) yield PLAN_STEP;
    if (tentIds.has(b.id)) continue;
    const f = b.footprint;
    for (let y = Math.max(0, cellOf(f.z0)); y < Math.min(H, cellOf(f.z1)); y++) for (let x = Math.max(0, cellOf(f.x0)); x < Math.min(W, cellOf(f.x1)); x++) {
      const i = y * W + x;
      if (g.cells[i] === SOLID || areaBuilding.has(g.area[i])) owner[i] = b.id;
    }
  }
  yield PLAN_STEP;
  for (let i0 = 0; i0 < n; i0 += PLAN_CELLS) {
    for (let i = i0, e = Math.min(n, i0 + PLAN_CELLS); i < e; i++) if (g.cells[i] === FLOOR && areaBuilding.has(g.area[i]) && !tentIds.has(areaBuilding.get(g.area[i])!)) owner[i] = areaBuilding.get(g.area[i])!;
    yield PLAN_STEP;
  }
  // the playable rect: the extent minus the SOLID cordon band (measured on the extent's mid lines)
  const ext = S.extent;
  const band = (x0: number, y0: number, dx: number, dy: number) => { let k = 0; for (let x = x0, y = y0; x >= 0 && y >= 0 && x < W && y < H && g.cells[y * W + x] === SOLID && k < 64; x += dx, y += dy) k++; return k; };
  const midX = Math.floor(W / 2), midY = Math.floor(H / 2);
  const ex0 = cellOf(ext.x0), ez0 = cellOf(ext.z0), ex1 = Math.min(W, cellOf(ext.x1)) - 1, ez1 = Math.min(H, cellOf(ext.z1)) - 1;
  const inner: SRect = {
    x0: (ex0 + band(ex0, midY, 1, 0)) * CELL, x1: (ex1 + 1 - band(ex1, midY, -1, 0)) * CELL,
    z0: (ez0 + band(midX, ez0, 0, 1)) * CELL, z1: (ez1 + 1 - band(midX, ez1, 0, -1)) * CELL,
  };
  const tentB = S.buildings.find(b => tentIds.has(b.id));
  const tentR = tentB ? tentB.footprint : S.checkpoint.tent.rect;
  for (let i0 = 0; i0 < n; i0 += PLAN_CELLS) {
    for (let i = i0, e = Math.min(n, i0 + PLAN_CELLS); i < e; i++) {
      if (g.cells[i] !== SOLID || owner[i] !== OWNER.none) continue;
      const x = (i % W + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL;
      if (x >= tentR.x0 - 0.6 && x <= tentR.x1 + 0.6 && z >= tentR.z0 - 0.6 && z <= tentR.z1 + 0.6) owner[i] = OWNER.tent;
      else if (x < inner.x0 + 0.01 || x > inner.x1 - 0.01 || z < inner.z0 + 0.01 || z > inner.z1 - 0.01) owner[i] = OWNER.cordon;
      else owner[i] = OWNER.debris;
    }
    yield PLAN_STEP;
  }

  // --- streets -----------------------------------------------------------------------------------------------------------------------
  const segments: StreetSeg[] = S.streets.length ? S.streets.map(streetSeg) : deriveSegments(S, inner);
  stats.segments = segments.length;
  stats.derivedStreets = S.streets.length ? 0 : 1;
  yield PLAN_STEP;

  // --- ground ------------------------------------------------------------------------------------------------------------------------
  const ground = new Uint8Array(n);
  const blockOf = new Int16Array(n).fill(-1);
  for (const bl of S.blocks) {
    const r = bl.rect;
    for (let y = Math.max(0, cellOf(r.z0)); y < Math.min(H, cellOf(r.z1)); y++) for (let x = Math.max(0, cellOf(r.x0)); x < Math.min(W, cellOf(r.x1)); x++) blockOf[y * W + x] = bl.id;
    if (bl.id % 8 === 7) yield PLAN_STEP;
  }
  yield PLAN_STEP;
  // per block side: sidewalk width (the nearest building's setback, else the default)
  const swOf = S.blocks.map(bl => {
    const fps = bl.buildings.map(id => S.buildings[id]?.footprint).filter((f): f is SRect => !!f);
    const set = (d: number[]) => { const m = Math.min(...d); return Number.isFinite(m) && m <= 6.5 ? clamp(m, 1.5, 4) : LOOK_TUNE.sidewalk; };
    return {
      N: set(fps.map(f => f.z0 - bl.rect.z0)), S: set(fps.map(f => bl.rect.z1 - f.z1)),
      W: set(fps.map(f => f.x0 - bl.rect.x0)), E: set(fps.map(f => bl.rect.x1 - f.x1)),
    };
  });
  const yardBlocks = new Set<number>(), plazaBlocks = new Set<number>();
  for (const b of S.buildings) {
    if (b.kind === 'depot' || b.kind === 'industrial') yardBlocks.add(b.block);
    if (b.kind === 'civic' || b.kind === 'centre') plazaBlocks.add(b.block);
  }
  const cp = S.checkpoint.rect;
  // GEN's open lots (when published): their use decides the ground (paving / asphalt / packed earth)
  const GG = S as SurfaceInfo & GenGround;
  const LOT_GROUND: Readonly<Record<string, number>> = {
    plaza: GROUND.plaza, forecourt: GROUND.plaza, court: GROUND.plaza, park: GROUND.verge, vacant: GROUND.verge, rubble: GROUND.verge,
    parking: GROUND.lot, loading: GROUND.yard, yard: GROUND.yard, compound: GROUND.check, gangway: GROUND.lot, alley: GROUND.lot, rail: GROUND.yard,
  };
  const lots = (GG.lots ?? []).filter(l => LOT_GROUND[l.use] !== undefined);
  // the lot under each cell centre: painted once, last listed first, so the FIRST lot listed holding the centre wins (the per-cell scan
  // of every lot this replaces: the same centre test, the same result, a fraction of the ground pass's time)
  const lotOf = new Uint8Array(n);
  for (let k = lots.length - 1; k >= 0; k--) {
    if (k % 8 === 0) yield PLAN_STEP;
    const r = lots[k].rect, v = LOT_GROUND[lots[k].use];
    for (let y = Math.max(0, Math.floor(r.z0 / CELL) - 1); y <= Math.min(H - 1, Math.floor(r.z1 / CELL) + 1); y++) {
      const z = (y + 0.5) * CELL;
      if (!(z >= r.z0 && z < r.z1)) continue;
      for (let x = Math.max(0, Math.floor(r.x0 / CELL) - 1); x <= Math.min(W - 1, Math.floor(r.x1 / CELL) + 1); x++) {
        const xc = (x + 0.5) * CELL;
        if (xc >= r.x0 && xc < r.x1) lotOf[y * W + x] = v;
      }
    }
  }
  stats.genLots = lots.length;
  for (let i0 = 0; i0 < n; i0 += PLAN_CELLS) {
    for (let i = i0, e = Math.min(n, i0 + PLAN_CELLS); i < e; i++) {
      if (g.cells[i] !== FLOOR) continue;
      const a = g.area[i];
      if (tentAreas.has(a)) { ground[i] = GROUND.tent; continue; }
      if (areaBuilding.has(a)) { ground[i] = GROUND.interior; continue; }
      if (!outdoorAreas.has(a) && !(a >= 0 && layout.areas[a]?.type === 'street')) continue;
      const x = (i % W + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL;
      if (x >= tentR.x0 && x < tentR.x1 && z >= tentR.z0 && z < tentR.z1) { ground[i] = GROUND.tent; continue; }
      if (x >= cp.x0 && x < cp.x1 && z >= cp.z0 && z < cp.z1) { ground[i] = GROUND.check; continue; }
      const lot = lotOf[i];
      if (lot) { ground[i] = lot; continue; }
      const bl = blockOf[i];
      if (bl >= 0) {
        const r = S.blocks[bl].rect, sw = swOf[bl];
        const walk = z - r.z0 < sw.N || r.z1 - z < sw.S || x - r.x0 < sw.W || r.x1 - x < sw.E;
        ground[i] = walk ? GROUND.walk : yardBlocks.has(bl) ? GROUND.yard : plazaBlocks.has(bl) ? GROUND.plaza : GROUND.lot;
        continue;
      }
      // outside every block: the carriageway, except the cordon-side outer sidewalk and a rubble verge along the cordon itself
      const d = Math.min(x - inner.x0, inner.x1 - x, z - inner.z0, inner.z1 - z);
      ground[i] = d < 0.9 ? GROUND.verge : d < LOOK_TUNE.outerWalk + 0.9 ? GROUND.walk : GROUND.road;
    }
    yield PLAN_STEP;
  }

  // --- markings, wear, street furniture of the ground -------------------------------------------------------------------------------
  const decals: Decal[] = [], discs: Disc[] = [];
  const floorAt = (x: number, z: number) => { const cx = clamp(cellOf(x), 0, W - 1), cz = clamp(cellOf(z), 0, H - 1); return g.floor[cz * W + cx] || 0; };
  const roadAt = (x: number, z: number) => { const cx = cellOf(x), cz = cellOf(z); return cx >= 0 && cz >= 0 && cx < W && cz < H && ground[cz * W + cx] === GROUND.road; };
  const rect = (kind: DecalKind, axis: 'x' | 'z', s0: number, s1: number, c0: number, c1: number, yOff = 0): void => {
    const [x0, x1, z0, z1] = axis === 'x' ? [s0, s1, c0, c1] : [c0, c1, s0, s1];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (kind !== 'kerb' && kind !== 'gutter' && !roadAt(cx, cz)) return;
    decals.push({kind, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y: floorAt(cx, cz) + LOOK_TUNE.decalY + yOff});
  };
  const mr = stream(seed, 11);
  /** A line along a segment, worn: broken into pieces with gaps (dash = dash length, 0 = solid). */
  const line = (sg: StreetSeg, kind: DecalKind, off: number, wid: number, dash: number, gap: number, from: number, to: number): void => {
    if (to - from < 1) return;
    let s = from + (dash ? mr() * gap : 0);
    while (s < to) {
      const e = dash ? Math.min(to, s + dash) : Math.min(to, s + 6 + mr() * 14);
      if (mr() > 0.08) rect(kind, sg.axis, s, e, sg.c + off - wid / 2, sg.c + off + wid / 2);
      s = e + (dash ? gap : mr() < 0.3 ? 0.4 + mr() * 1.6 : 0);
    }
  };
  let segK = 0;
  for (const sg of segments) {
    if (++segK % 8 === 0) yield PLAN_STEP;
    const L = sg.s1 - sg.s0, hw = sg.w / 2;
    if (L < 6 || sg.w < 4) continue;
    const from = sg.s0 + 5.2, to = sg.s1 - 5.2;
    if (sg.rank === 'avenue' || sg.w >= 17) {
      line(sg, 'yellow', -0.12, 0.12, 0, 0, from, to);
      line(sg, 'yellow', 0.12, 0.12, 0, 0, from, to);
      line(sg, 'white', -hw / 2, 0.12, 3, 6, from, to);
      line(sg, 'white', hw / 2, 0.12, 3, 6, from, to);
      line(sg, 'white', -hw + 0.45, 0.12, 0, 0, from, to);
      line(sg, 'white', hw - 0.45, 0.12, 0, 0, from, to);
    } else if (sg.rank === 'street') {
      line(sg, 'yellow', 0, 0.12, 3, 6, from, to);
    }
    if (sg.rank !== 'lane' && L > 14) for (const [end, dir] of [[sg.s0, 1], [sg.s1, -1]] as const) {
      // zebra crosswalk (stripes along the travel axis) and a stop line on the approach lane
      const z0 = end + dir * 0.6, z1 = end + dir * 3.6;
      for (let c = -hw + 0.6; c + 0.5 <= hw - 0.4; c += 1.1) if (mr() > 0.12) rect('white', sg.axis, Math.min(z0, z1), Math.max(z0, z1), sg.c + c, sg.c + c + 0.5);
      const st = end + dir * 4.4;
      const [c0, c1] = dir > 0 ? [0.15, hw - 0.4] : [-hw + 0.4, -0.15];
      if (mr() > 0.15) rect('white', sg.axis, Math.min(st, st + dir * 0.35), Math.max(st, st + dir * 0.35), sg.c + c0, sg.c + c1);
    }
    // wear: patches, potholes, cracks, oil
    const nWear = Math.round(L / 9);
    for (let k = 0; k < nWear; k++) {
      const s = sg.s0 + 2 + mr() * (L - 4), c = sg.c + (mr() * 2 - 1) * (hw - 0.8);
      const t = mr();
      if (t < 0.32) { const a = 0.8 + mr() * 2.6, b = 0.7 + mr() * 1.8; rect('patch', sg.axis, s - a / 2, s + a / 2, c - b / 2, c + b / 2, 0.001); }
      else if (t < 0.5) { const a = 0.35 + mr() * 0.8; rect('pothole', sg.axis, s - a / 2, s + a / 2, c - a * 0.4, c + a * 0.4, 0.002); }
      else if (t < 0.62) { const a = 0.6 + mr() * 1.5; rect('oil', sg.axis, s - a / 2, s + a / 2, c - a * 0.35, c + a * 0.35, 0.0015); }
      else {
        const len = 2 + mr() * 5, rot = (mr() * 2 - 1) * 0.6;
        const [cx, cz] = sg.axis === 'x' ? [s, c] : [c, s];
        if (roadAt(cx, cz)) decals.push({kind: 'crack', x0: cx - len / 2, z0: cz - 0.025, x1: cx + len / 2, z1: cz + 0.025, y: floorAt(cx, cz) + LOOK_TUNE.decalY + 0.0025, rot: (sg.axis === 'x' ? 0 : Math.PI / 2) + rot});
      }
    }
    // manholes on the centre line, storm drains at the kerbs by the junction ends
    for (let s = sg.s0 + 8 + mr() * 10; s < sg.s1 - 8; s += 26 + mr() * 22) {
      const c = sg.c + (mr() * 2 - 1) * Math.min(2, hw * 0.4);
      const [x, z] = sg.axis === 'x' ? [s, c] : [c, s];
      if (roadAt(x, z)) discs.push({kind: 'manhole', x, z, y: floorAt(x, z) + LOOK_TUNE.decalY + 0.003, r: 0.34, rot: mr() * Math.PI});
    }
    for (const s of [sg.s0 + 6.5, sg.s1 - 6.5]) for (const side of [-1, 1]) {
      if (mr() < 0.35) continue;
      const c = sg.c + side * (hw - 0.35);
      const [x, z] = sg.axis === 'x' ? [s, c] : [c, s];
      if (roadAt(x, z)) discs.push({kind: 'drain', x, z, y: floorAt(x, z) + LOOK_TUNE.decalY + 0.003, r: 0.42, rot: sg.axis === 'x' ? 0 : Math.PI / 2});
    }
  }
  // kerb stones (a light strip on the walk side) and the gutter (a dark strip on the road side) along every block rect edge
  for (const bl of S.blocks) {
    const r = bl.rect;
    const edges: [('x' | 'z'), number, number, number, 1 | -1][] = [['x', r.z0, r.x0, r.x1, 1], ['x', r.z1, r.x0, r.x1, -1], ['z', r.x0, r.z0, r.z1, 1], ['z', r.x1, r.z0, r.z1, -1]];
    for (const [axis, c, s0, s1, inward] of edges) {
      const yk = floorAt(axis === 'x' ? (s0 + s1) / 2 : c + inward * 0.2, axis === 'x' ? c + inward * 0.2 : (s0 + s1) / 2);
      const yr = floorAt(axis === 'x' ? (s0 + s1) / 2 : c - inward * 0.3, axis === 'x' ? c - inward * 0.3 : (s0 + s1) / 2);
      decals.push(axisRect('kerb', axis, s0, s1, c, c + inward * 0.3, yk + LOOK_TUNE.decalY));
      decals.push(axisRect('gutter', axis, s0, s1, c - inward * 0.45, c, yr + LOOK_TUNE.decalY));
    }
  }

  // parking bays: painted bay lines across GEN's parking lots (2.6 m bays in rows along the lot's long side)
  for (const l of lots) {
    if (l.use !== 'parking') continue;
    const r = l.rect, alongX = r.x1 - r.x0 >= r.z1 - r.z0, L = alongX ? r.x1 - r.x0 : r.z1 - r.z0, D = alongX ? r.z1 - r.z0 : r.x1 - r.x0;
    const rows = D >= 14 ? 2 : D >= 6 ? 1 : 0;
    for (let row = 0; row < rows; row++) {
      const c0 = (alongX ? r.z0 : r.x0) + (row === 0 ? 0.4 : D - 5.4), c1 = c0 + 5;
      for (let sb = (alongX ? r.x0 : r.z0) + 1; sb <= (alongX ? r.x0 : r.z0) + L - 1; sb += 2.6) {
        if (mr() < 0.12) continue;
        const [x0, x1, z0, z1] = alongX ? [sb, sb + 0.1, c0, c1] : [c0, c1, sb, sb + 0.1];
        decals.push({kind: 'white', x0, z0, x1, z1, y: floorAt((x0 + x1) / 2, (z0 + z1) / 2) + LOOK_TUNE.decalY});
      }
    }
  }

  // --- buildings -----------------------------------------------------------------------------------------------------------------
  yield PLAN_STEP;
  const spans = new Map(S.windows.map(w => [w.id, w]));
  const buildings: BuildingLook[] = [];
  for (const b of S.buildings) {
    buildings.push(planBuilding(layout, b, ground, spans, seed));
    if (buildings.length % 4 === 0) yield PLAN_STEP;
  }
  yield PLAN_STEP;
  // the tent is drawn by the tent build (canvas walls via OWNER.tent, the roof, the flap): no facade parts of its own
  for (const bl of buildings) if (tentIds.has(bl.id)) { bl.sides = []; bl.holes = []; bl.signs = []; bl.escapes = []; bl.decks = []; }
  // scorch decals on the ground below burnt-out openings (soot fans) — on the sidewalk only
  for (const bl of buildings) for (const h of bl.holes) {
    if (!h.scorch || h.storey !== 0) continue;
    const sd = bl.sides.find(sd => sd.side === h.side)!;
    const [x0, x1, z0, z1] = sd.alongX ? [h.s0, h.s1, sd.plane, sd.plane + sd.n * 1.2] : [sd.plane, sd.plane + sd.n * 1.2, h.s0, h.s1];
    decals.push({kind: 'scorch', x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y: floorAt((x0 + x1) / 2, (z0 + z1) / 2) + LOOK_TUNE.decalY + 0.001});
  }
  // rooftop clutter / water tanks / rubble on the decks
  const placements: Placement[] = [];
  const pr = stream(seed, 23);
  for (const bl of buildings) {
    if (bl.style.wall === 'canvas') continue;
    for (const d of bl.decks) {
      const w = d.x1 - d.x0, dd = d.z1 - d.z0;
      if (w < 4 || dd < 4) continue;
      const area = w * dd;
      const ins = (v: number, a: number, b: number, m: number) => a + m + v * Math.max(0, b - a - 2 * m);
      if (d.burnt) {
        const nr = clamp(Math.round(area / 90), 1, 5);
        for (let k = 0; k < nr; k++) placements.push({model: 'rubble', x: ins(pr(), d.x0, d.x1, 2.5), z: ins(pr(), d.z0, d.z1, 2.5), y: d.y - 0.5, yaw: pr() * Math.PI * 2, s: 0.6 + pr() * 0.7});
        continue;
      }
      const nc = clamp(Math.round(area / 100 * bl.style.clutter), 0, 4);
      for (let k = 0; k < nc; k++) placements.push({model: pr() < 0.7 ? 'hvac' : 'vent', x: ins(pr(), d.x0, d.x1, 2.2), z: ins(pr(), d.z0, d.z1, 2.2), y: d.y, yaw: Math.floor(pr() * 4) * Math.PI / 2, s: 0.9 + pr() * 0.25});
      if (bl.style.tanks && bl.storeys >= 3 && pr() < 0.7) placements.push({model: 'tank', x: ins(pr(), d.x0, d.x1, 3.5), z: ins(pr(), d.z0, d.z1, 3.5), y: d.y, yaw: pr() * Math.PI, s: 0.85 + pr() * 0.2});
    }
  }

  yield PLAN_STEP;
  const tent = planTent(S, owner, W, tentB ?? null, floorAt);
  yield PLAN_STEP;
  const depot = depotGear(S, floorAt);
  const rail = genRail(GG, floorAt) ?? planRail(S, buildings, segments, floorAt, !!depot?.tracks.length);
  stats.buildings = buildings.length;
  stats.holes = buildings.reduce((a, b) => a + b.holes.length, 0);
  stats.airHoles = buildings.reduce((a, b) => a + b.holes.filter(h => h.kind === 'air').length, 0);
  stats.signs = buildings.reduce((a, b) => a + b.signs.length, 0);
  stats.escapes = buildings.reduce((a, b) => a + b.escapes.length, 0);
  stats.decals = decals.length;
  stats.discs = discs.length;
  stats.placements = placements.length;
  stats.depotTracks = depot?.tracks.length ?? 0;
  stats.depotPits = depot?.pits.length ?? 0;
  stats.depotCrane = depot?.crane ? 1 : 0;
  return {W, H, seed, ground, owner, outdoorAreas, areaBuilding, tentAreas, doorCells, segments, decals, discs, buildings, spans, tent, rail, depot, placements, inner, stats};
}

function axisRect(kind: DecalKind, axis: 'x' | 'z', s0: number, s1: number, c0: number, c1: number, y: number): Decal {
  const [x0, x1, z0, z1] = axis === 'x' ? [s0, s1, c0, c1] : [c0, c1, s0, s1];
  return {kind, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y};
}

function streetSeg(st: SurfaceStreet): StreetSeg {
  const axis: 'x' | 'z' = Math.abs(st.az - st.bz) < 1e-6 ? 'x' : 'z';
  const c = axis === 'x' ? st.az : st.ax;
  const s0 = axis === 'x' ? Math.min(st.ax, st.bx) : Math.min(st.az, st.bz), s1 = axis === 'x' ? Math.max(st.ax, st.bx) : Math.max(st.az, st.bz);
  return {id: st.id, axis, c, w: st.width, s0, s1, rank: st.rank, name: st.name, derived: false};
}

/** Street segments from the gaps between the block rects (the contract skeleton has no SurfaceStreet records). */
function deriveSegments(S: SurfaceInfo, inner: SRect): StreetSeg[] {
  const out: StreetSeg[] = [];
  const at = (c: number, r: number) => S.blocks.find(b => b.col === c && b.row === r);
  const push = (axis: 'x' | 'z', a: number, b: number, s0: number, s1: number, outer: -1 | 0 | 1) => {
    // the perimeter gaps keep an outer sidewalk on their cordon side
    let lo = a, hi = b;
    if (outer < 0) lo += LOOK_TUNE.outerWalk + 0.9;
    if (outer > 0) hi -= LOOK_TUNE.outerWalk + 0.9;
    const w = hi - lo;
    if (w < 3 || s1 - s0 < 2) return;
    out.push({id: out.length, axis, c: (lo + hi) / 2, w, s0, s1, rank: w >= 17 ? 'avenue' : w >= 8 ? 'street' : 'lane', name: '', derived: true});
  };
  for (const b of S.blocks) {
    const r = b.rect;
    // the gap east of this block (a north-south street between columns), along the block's own z extent
    const e = at(b.col + 1, b.row);
    if (e) push('z', r.x1, e.rect.x0, Math.max(r.z0, e.rect.z0), Math.min(r.z1, e.rect.z1), 0);
    else push('z', r.x1, inner.x1, r.z0, r.z1, 1);
    if (b.col === 0) push('z', inner.x0, r.x0, r.z0, r.z1, -1);
    const s = at(b.col, b.row + 1);
    if (s) push('x', r.z1, s.rect.z0, Math.max(r.x0, s.rect.x0), Math.min(r.x1, s.rect.x1), 0);
    else push('x', r.z1, inner.z1, r.x0, r.x1, 1);
    if (b.row === 0) push('x', inner.z0, r.z0, r.x0, r.x1, -1);
  }
  return out;
}

const HOLE_ODDS: Readonly<Record<SurfaceBuilding['condition'], readonly [HoleKind, number][]>> = {
  intact: [['glass', 0.66], ['broken', 0.14], ['boarded', 0.12], ['dark', 0.08]],
  damaged: [['glass', 0.36], ['broken', 0.32], ['boarded', 0.16], ['dark', 0.16]],
  gutted: [['glass', 0.04], ['broken', 0.2], ['boarded', 0.14], ['dark', 0.62]],
  collapsed: [['broken', 0.25], ['boarded', 0.1], ['dark', 0.65]],
};
const rollHole = (r: () => number, cond: SurfaceBuilding['condition']): HoleKind => {
  let u = r();
  for (const [k, p] of HOLE_ODDS[cond] ?? HOLE_ODDS.intact) { if ((u -= p) <= 0) return k; }
  return 'dark';
};

function planBuilding(layout: StationLayout, b: SurfaceBuilding, ground: Uint8Array, spans: ReadonlyMap<string, SurfaceWindowSpan>, seed: number): BuildingLook {
  const g = layout.grid, W = g.w, H = g.h;
  const r = stream(seed, 1000 + b.id * 7);
  const style = surfaceStyleOf(b);
  const tint = pick(r, style.tints);
  const family = interiorFamilyOf(b);
  const fp = b.footprint;
  const gs = shapeOf(b);
  const parapet = gs.parapet ?? style.parapet;
  const gh = gs.storeyHeights?.length ? gs.storeyHeights : null;
  const storeys = gh ? gh.length : Math.max(1, Math.round(b.storeys || 1));
  // the ground storey's floor: GEN's storeys stand on the kerb (roofY - their heights); the skeleton's on 0
  const base0 = gh && gs.roofY !== undefined ? clamp(gs.roofY - gh.reduce((a, c) => a + c, 0), 0, 1) : 0;
  const top = Math.max(base0 + 2.4, b.height || base0 + (gh ? gh.reduce((a, c) => a + c, 0) : storeys * style.storey) + parapet);
  const storeyH = clamp((top - base0 - parapet) / storeys, 2.6, 9);
  const storeyHs = gh ? gh.map(h => Math.max(2.2, h)) : Array.from({length: storeys}, () => storeyH);
  const storeyY: number[] = [];
  for (let k = 0, y = base0; k < storeys; k++) { storeyY.push(y); y += storeyHs[k]; }
  const deck = Math.max(2.2, gs.roofY ?? top - parapet);
  // interiors: each of the building's levels' storey floor .. its carved ceiling
  const interiors: [number, number][] = [];
  let ceilTop = 0;
  for (const lv of new Set(b.levels)) {
    const base = layout.levels?.[lv]?.baseY ?? 0;
    let ceil = base + 2.4;
    for (const a of b.areas) { const ar = layout.areas[a]; if (ar && (ar.level ?? 0) === lv) ceil = Math.max(ceil, ar.ceil ?? ceil); }
    interiors.push([base, ceil]);
    ceilTop = Math.max(ceilTop, ceil);
  }
  const minAllowed = (s: number, side: Side) => {
    let m = Math.max(base0 + storeyHs[0] + 0.8, ceilTop > 0 ? ceilTop + LOOK_TUNE.overCeil : 0);
    for (const e of b.entrances) if (e.side === side && Math.abs((SIDE_NORMAL[side].alongX ? e.x : e.z) - s) < e.width / 2 + 1) m = Math.max(m, entranceFloor(layout, e) + e.height + 0.8);
    return Math.min(m, top);
  };
  // which sides face open ground (sample a cell 1.5 m out at a few points)
  const cellAt = (x: number, z: number) => { const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); return cx < 0 || cz < 0 || cx >= W || cz >= H ? -1 : cz * W + cx; };
  const roadScore = new Map<Side, number>();
  const sides: FacadeSide[] = (['N', 'S', 'W', 'E'] as const).map(side => {
    const {alongX, n} = SIDE_NORMAL[side];
    const plane = side === 'N' ? fp.z0 : side === 'S' ? fp.z1 : side === 'W' ? fp.x0 : fp.x1;
    const s0 = alongX ? fp.x0 : fp.z0, s1 = alongX ? fp.x1 : fp.z1;
    let open = 0, road = 0;
    for (let k = 1; k <= 5; k++) {
      const s = s0 + (s1 - s0) * k / 6;
      const i = alongX ? cellAt(s, plane + n * 1.5) : cellAt(plane + n * 1.5, s);
      if (i >= 0 && g.cells[i] === FLOOR && ground[i] !== GROUND.interior && ground[i] !== GROUND.none) open++;
      const j = alongX ? cellAt(s, plane + n * 6) : cellAt(plane + n * 6, s);
      if (j >= 0 && (ground[j] === GROUND.road || ground[j] === GROUND.walk)) road++;
    }
    roadScore.set(side, road);
    // (GEN's `exposed` sides, when published, decide which faces are party walls)
    return {side, plane, n, s0, s1, alongX, open: gs.exposed ? gs.exposed.includes(side) : open >= 3, frontage: false, tops: []};
  });
  const front = gs.frontage ?? b.entrances[0]?.side ?? [...sides].sort((p, q) => roadScore.get(q.side)! - roadScore.get(p.side)! || (q.s1 - q.s0) - (p.s1 - p.s0))[0].side;
  for (const sd of sides) sd.frontage = sd.side === front;

  // --- the roof line (ruin profiles) ---
  const cond: SurfaceBuilding['condition'] = gs.collapse && b.condition === 'intact' ? 'damaged' : b.condition;
  let minTop = top;
  const decks: DeckRect[] = [];
  // the collapsed corner: GEN's (when published: its rubble lies below it), else a seeded one on damaged shells
  const gc = gs.collapse;
  const rc = Math.floor(r() * 4);
  const corner = gc ? Math.max(0, ['NW', 'NE', 'SW', 'SE'].indexOf(gc.corner)) : rc; // NW NE SW SE
  const notch = {wx: (fp.x1 - fp.x0) * (0.25 + r() * 0.2), wz: (fp.z1 - fp.z0) * (0.25 + r() * 0.2)};
  const notchTop = base0 + Math.max(storeyH * Math.max(1, storeys - 1 - Math.floor(r() * 2)), storeyH + 1);
  const notchRect: SRect = gc ? {...gc.rect} : {
    x0: corner % 2 ? fp.x1 - notch.wx : fp.x0, x1: corner % 2 ? fp.x1 : fp.x0 + notch.wx,
    z0: corner >= 2 ? fp.z1 - notch.wz : fp.z0, z1: corner >= 2 ? fp.z1 : fp.z0 + notch.wz,
  };
  const stumpTop = base0 + Math.max(storeyH + 1.2, (top - base0) * (0.35 + r() * 0.22));
  for (const sd of sides) {
    const tops: TopSeg[] = [];
    const L = sd.s1 - sd.s0;
    if (cond === 'intact' || style.wall === 'canvas') tops.push({s0: sd.s0, s1: sd.s1, top});
    else {
      let s = sd.s0;
      while (s < sd.s1 - 1e-6) {
        const step = cond === 'damaged' ? 1.2 + r() * 1.6 : 0.9 + r() * 1.8;
        const e = Math.min(sd.s1, s + step);
        const mid = (s + e) / 2;
        let t = top;
        if (cond === 'damaged') {
          const inNotch = sd.alongX ? mid >= notchRect.x0 && mid <= notchRect.x1 && (sd.side === 'N' ? corner < 2 : corner >= 2)
            : mid >= notchRect.z0 && mid <= notchRect.z1 && (sd.side === 'W' ? corner % 2 === 0 : corner % 2 === 1);
          t = inNotch ? notchTop + r() * 1.1 : top - (r() < 0.25 ? r() * 0.6 : 0);
        } else if (cond === 'gutted') t = top - r() * storeyH * 0.9 - (r() < 0.18 ? storeyH * 0.8 : 0);
        else t = stumpTop + (r() * 2 - 1) * 1.4 - (r() < 0.2 ? 1.5 : 0);
        t = clamp(Math.round(Math.max(t, minAllowed(mid, sd.side)) * 20) / 20, 1, top);
        tops.push({s0: s, s1: e, top: t});
        minTop = Math.min(minTop, t);
        s = e;
      }
      if (L <= 0) tops.push({s0: sd.s0, s1: sd.s1, top});
    }
    sd.tops = tops;
  }
  const inset = LOOK_TUNE.parapetT;
  const deckIn = {x0: fp.x0 + inset, z0: fp.z0 + inset, x1: fp.x1 - inset, z1: fp.z1 - inset};
  if (style.wall === 'canvas') { /* the tent: no deck (its roof is drawn by the tent build) */ }
  else if (cond === 'damaged') {
    // the main deck round the collapsed corner (an L of two rects) and the notch's lower deck under its rubble
    const nx = corner % 2 ? [deckIn.x0, notchRect.x0] : [notchRect.x1, deckIn.x1], nz = corner >= 2 ? [deckIn.z0, notchRect.z0] : [notchRect.z1, deckIn.z1];
    decks.push({x0: deckIn.x0, x1: deckIn.x1, z0: nz[0], z1: nz[1], y: deck, burnt: false});
    decks.push({x0: nx[0], x1: nx[1], z0: corner >= 2 ? notchRect.z0 : deckIn.z0, z1: corner >= 2 ? deckIn.z1 : notchRect.z1, y: deck, burnt: false});
    decks.push({x0: Math.max(deckIn.x0, notchRect.x0), x1: Math.min(deckIn.x1, notchRect.x1), z0: Math.max(deckIn.z0, notchRect.z0), z1: Math.min(deckIn.z1, notchRect.z1), y: Math.max(ceilTop + 0.2, notchTop - 0.5), burnt: true});
  } else if (cond === 'gutted' || cond === 'collapsed') decks.push({...deckIn, y: Math.max(ceilTop + 0.2, Math.min(deck, minTop - 0.5)), burnt: true});
  else decks.push({...deckIn, y: deck, burnt: false});

  // --- openings: AIR's live spans (cut + framed, never glazed here) ---
  const holes: FacadeHole[] = [];
  for (const id of b.windows) {
    const sp = spans.get(id);
    if (!sp) continue;
    const base = layout.levels?.[sp.level]?.baseY ?? 0;
    const alongX = SIDE_NORMAL[sp.side].alongX;
    const sk = Math.max(0, storeyY.findIndex((y, k) => base + sp.sill >= y - 0.05 && base + sp.sill < y + storeyHs[k]));
    holes.push({side: sp.side, s0: alongX ? sp.x0 : sp.z0, s1: alongX ? sp.x1 : sp.z1, y0: base + sp.sill, y1: base + sp.head, kind: 'air', storey: sk, span: sp.id});
  }
  const blocked = (side: Side, s0: number, s1: number, y0: number, y1: number) => {
    for (const h of holes) if (h.side === side && s1 > h.s0 - 0.35 && s0 < h.s1 + 0.35 && y1 > h.y0 - 0.2 && y0 < h.y1 + 0.2) return true;
    for (const e of b.entrances) {
      if (e.side !== side) continue;
      const c = SIDE_NORMAL[side].alongX ? e.x : e.z, base = entranceFloor(layout, e);
      if (s1 > c - e.width / 2 - 0.5 && s0 < c + e.width / 2 + 0.5 && y0 < base + e.height + 0.4 && y1 > base) return true;
    }
    return false;
  };
  const inInterior = (y0: number, y1: number) => interiors.some(([a, c]) => y1 > a + 0.05 && y0 < c - 0.05);
  // boarded-up entrances (the doorway cells stay SOLID: boards over where the door was)
  for (const e of b.entrances) if (e.door === 'boarded') {
    const c = SIDE_NORMAL[e.side].alongX ? e.x : e.z, base = entranceFloor(layout, e);
    holes.push({side: e.side, s0: c - e.width / 2, s1: c + e.width / 2, y0: base, y1: base + e.height, kind: 'door-boarded', storey: 0});
  }
  // --- decorative windows (storeys without an interior), shopfront bays, signs ---
  const signs: ShopSign[] = [];
  const nameR = stream(seed, 5000 + b.id);
  const signName = (k: number) => (k === 0 && b.name ? b.name.toUpperCase() : pick(nameR, SHOPFRONT_NAMES));
  for (const sd of sides) {
    if (!sd.open || style.wall === 'canvas') continue;
    const L = sd.s1 - sd.s0;
    const topHere = (s0: number, s1: number) => Math.min(topAt(sd, s0, top), topAt(sd, s1, top), topAt(sd, (s0 + s1) / 2, top));
    const add = (s0: number, s1: number, y0: number, y1: number, kind: HoleKind, storey: number) => {
      if (s0 < sd.s0 + 0.5 || s1 > sd.s1 - 0.5 || y1 > topHere(s0, s1) - 0.35 || blocked(sd.side, s0, s1, y0, y1)) return false;
      holes.push({side: sd.side, s0, s1, y0, y1, kind, storey, scorch: (kind === 'dark' || kind === 'broken') && (cond === 'gutted' || cond === 'collapsed') && r() < 0.55});
      return true;
    };
    // ground storey
    const h0 = storeyHs[0];
    const groundFree = !inInterior(base0 + 0.3, base0 + h0 - 0.6);
    if (style.ground === 'shopfront' || style.ground === 'canopy') {
      if (sd.frontage || (sd.open && style.ground === 'canopy' && L > 12)) {
        const nb = clamp(Math.round(L / 8.5), 1, 5), bw = L / nb;
        for (let k = 0; k < nb; k++) {
          const a = sd.s0 + k * bw + 0.55, e = sd.s0 + (k + 1) * bw - 0.55;
          if (groundFree) add(a, e, base0 + 0.45, base0 + Math.min(2.7, h0 - 0.7), r() < 0.42 ? 'shutter' : 'shop', 0);
          const sy0 = base0 + Math.min(h0 - 0.65, 2.95), sy1 = Math.min(base0 + h0 - 0.1, sy0 + 0.6);
          if (sy1 - sy0 > 0.3 && sy1 < topHere(a, e) - 0.2 && (sd.frontage || k % 2 === 0) && (style.ground === 'canopy' || b.kind !== 'ruin' || r() < 0.6))
            signs.push({side: sd.side, s0: a + 0.2, s1: e - 0.2, y0: sy0, y1: sy1, text: signName(signs.length), plane: sd.plane, n: sd.n, alongX: sd.alongX});
        }
      }
    } else if (style.ground === 'dock' && sd.frontage) {
      for (let s = sd.s0 + 3; s + 4 < sd.s1 - 2; s += 10) add(s, s + 4, base0, base0 + Math.min(4.4, h0 - 1), 'shutter', 0);
    } else if (style.ground === 'lobby' && sd.frontage && groundFree) {
      const c = (sd.s0 + sd.s1) / 2, hwid = Math.min(5, L / 4);
      add(c - hwid, c + hwid, base0 + 0.15, base0 + Math.min(3.1, h0 - 0.4), rollHole(r, cond) === 'glass' ? 'shop' : 'boarded', 0);
    }
    if (b.destination && b.name && !signs.some(s => s.side === sd.side) && sd.frontage) {
      const c = b.entrances.find(e => e.side === sd.side), cs = c ? (sd.alongX ? c.x : c.z) : (sd.s0 + sd.s1) / 2;
      const hw = Math.min(L / 2 - 1, Math.max(2.2, b.name.length * 0.19));
      const y0 = (c ? entranceFloor(layout, c) + c.height : base0 + 2.6) + 0.35;
      if (y0 + 0.6 < topHere(cs - hw, cs + hw) - 0.2) signs.push({side: sd.side, s0: cs - hw, s1: cs + hw, y0, y1: y0 + 0.6, text: b.name.toUpperCase(), plane: sd.plane, n: sd.n, alongX: sd.alongX});
    }
    // window grid per storey
    if (style.windows === 'none') continue;
    const wn = style.win;
    for (let k = 0; k < storeys; k++) {
      const yb = storeyY[k], hk = storeyHs[k];
      // the ground storey's frontage is the ground treatment's (shopfront bays / lobby / dock doors); the plinth and plain styles keep
      // their window rows there, and a shed's clerestory is its only row
      if (k === 0 && style.windows !== 'high' && style.ground !== 'none' && style.ground !== 'plinth' && sd.frontage) continue;
      const y0 = yb + wn.sill, y1 = y0 + wn.h;
      if (y1 > yb + hk - 0.15 && style.windows !== 'high' && style.windows !== 'curtain') continue;
      if (inInterior(y0, y1)) continue;
      const pitch = style.windows === 'band' ? wn.w + 0.32 : wn.pitch;
      const nwin = Math.floor((L - 1.6) / pitch);
      if (nwin < 1) continue;
      const startC = sd.s0 + (L - (nwin - 1) * pitch) / 2;
      for (let j = 0; j < nwin; j++) {
        const c = startC + j * pitch, hw = (style.windows === 'curtain' ? pitch - 0.1 : wn.w) / 2;
        add(c - hw, c + hw, y0, Math.min(y1, yb + hk - 0.08), rollHole(r, cond), k);
      }
    }
  }
  // --- fire escapes (3+ storeys, a side / rear face onto open ground, not a ruin stump) ---
  const escapes: FireEscape[] = [];
  if (storeys >= 3 && cond !== 'collapsed' && r() < style.fireEscape) {
    const cand = sides.filter(sd => sd.open && !sd.frontage && sd.s1 - sd.s0 >= 9);
    if (cand.length) {
      const sd = pick(r, cand);
      const s = (sd.s0 + sd.s1) / 2 + (r() * 2 - 1) * ((sd.s1 - sd.s0) / 2 - 3.5);
      const lv: number[] = [];
      for (let k = 1; k < storeys; k++) if (storeyY[k] + 1.2 < topAt(sd, s, top)) lv.push(k);
      if (lv.length) escapes.push({side: sd.side, s, plane: sd.plane, n: sd.n, alongX: sd.alongX, levels: lv, ys: lv.map(k => storeyY[k]), base: base0});
    }
  }
  const key = `surface-facade-${style.wall}-${tint.toString(16).padStart(6, '0')}`;
  const trimKey = `surface-trim-${style.trim.toString(16).padStart(6, '0')}`;
  return {id: b.id, b, style, tint, family, key, trimKey, storeyH, storeys, storeyY, storeyHs, top, deck, minTop, sides, holes, signs, escapes, decks, interiors, ceilTop};
}

function planTent(S: SurfaceInfo, owner: Int16Array, W: number, tb: SurfaceBuilding | null, floorAt: (x: number, z: number) => number): TentPlan | null {
  const t = S.checkpoint.tent;
  const r = tb ? tb.footprint : t.rect;
  if (!(r.x1 - r.x0 > 1.5 && r.z1 - r.z0 > 1.5)) return null;
  // its floor (the compound's grade), the eave above it; GEN's tent building: its canvas walls are carved (SOLID ring), its height
  // (absolute) the ridge, its door its entrance
  const base = floorAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
  const te = tb?.entrances.find(e => e.side === t.door.side) ?? tb?.entrances[0];
  const ridge = Math.max(base + LOOK_TUNE.tentEave + 0.6, tb ? tb.height || base + LOOK_TUNE.tentRidge : base + LOOK_TUNE.tentRidge);
  let carved = !!tb;
  for (let x = Math.floor(r.x0 / CELL); x < Math.ceil(r.x1 / CELL) && !carved; x++) {
    const i = Math.floor(r.z0 / CELL) * W + x;
    if (owner[i] === OWNER.tent) carved = true;
  }
  const ridgeX = r.x1 - r.x0 >= r.z1 - r.z0;
  const guys: TentPlan['guys'] = [];
  const g = LOOK_TUNE.tentGuy, eave = base + LOOK_TUNE.tentEave;
  const along = ridgeX ? [r.x0 + 0.4, (r.x0 + r.x1) / 2, r.x1 - 0.4] : [r.z0 + 0.4, (r.z0 + r.z1) / 2, r.z1 - 0.4];
  for (const a of along) {
    if (ridgeX) { guys.push({ax: a, az: r.z0 - g, ex: a, ey: eave, ez: r.z0}); guys.push({ax: a, az: r.z1 + g, ex: a, ey: eave, ez: r.z1}); }
    else { guys.push({ax: r.x0 - g, az: a, ex: r.x0, ey: eave, ez: a}); guys.push({ax: r.x1 + g, az: a, ex: r.x1, ey: eave, ez: a}); }
  }
  const door = te ? {x: te.x, z: te.z, side: te.side, width: te.width, height: Math.min(te.height, LOOK_TUNE.tentEave - 0.05)} : {...t.door, width: 1.4, height: 2.0};
  return {rect: {...r}, door, base, eave, ridge, ridgeX, guys, carved};
}

/** GEN's rail spur (when published): the track's centre line along its corridor rects, from the cordon to the shed. */
function genRail(S: GenGround, floorAt: (x: number, z: number) => number): RailSpur | null {
  const R = S.rail;
  if (!R || !R.rects.length) return null;
  const alongZ = R.dir === 'N' || R.dir === 'S';
  const lo = Math.min(...R.rects.map(q => (alongZ ? q.z0 : q.x0))), hi = Math.max(...R.rects.map(q => (alongZ ? q.z1 : q.x1)));
  if (!(hi - lo > 2)) return null;
  const P = (s: number) => (alongZ ? {x: R.centre, z: s} : {x: s, z: R.centre});
  const pts = [P(lo + 0.5), P(hi - 0.5)];
  return {points: pts, y: floorAt(pts[0].x, pts[0].z), gauge: 1.435, buffer: null};
}

/**
 * The depot's gear from lane ROOMS' features (finite numbers only; a track shorter than 1 m, an empty pit, a crane box under 2 m or a
 * runway under 3 m above the floor is dropped): floors from the grid at each piece's middle.
 */
export function depotGear(S: SurfaceInfo, floorAt: (x: number, z: number) => number): DepotGear | null {
  const F = (S.depot as (typeof S.depot & {features?: DepotFeaturesIn | null}) | undefined)?.features;
  if (!F) return null;
  const fin = (...v: number[]) => v.every(Number.isFinite);
  const tracks = (F.tracks ?? []).filter(t => fin(t.x0, t.z0, t.x1, t.z1, t.gauge) && t.gauge > 0.5 && t.gauge < 3 && Math.hypot(t.x1 - t.x0, t.z1 - t.z0) > 1)
    .map(t => ({x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1, gauge: t.gauge, y: floorAt((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2)}));
  const pits = (F.pits ?? []).filter(q => fin(q.x0, q.z0, q.x1, q.z1) && q.x1 - q.x0 > 0.2 && q.z1 - q.z0 > 0.2)
    .map(q => ({x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1, y: floorAt((q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2)}));
  // an inspection pit lies BETWEEN its track's rails: one planned wider than the gauge (whole cells) is drawn inside them, so the rail
  // heads stay on solid floor beside the grating
  for (const p of pits) for (const t of tracks) {
    const h = t.gauge / 2 - 0.1;
    if (Math.abs(t.x1 - t.x0) < 1e-3 && t.x0 > p.x0 && t.x0 < p.x1 && (p.x1 - p.x0) / 2 > h) { p.x0 = t.x0 - h; p.x1 = t.x0 + h; }
    else if (Math.abs(t.z1 - t.z0) < 1e-3 && t.z0 > p.z0 && t.z0 < p.z1 && (p.z1 - p.z0) / 2 > h) { p.z0 = t.z0 - h; p.z1 = t.z0 + h; }
  }
  const c = F.crane;
  let crane: DepotGear['crane'] = null;
  if (c && fin(c.x0, c.z0, c.x1, c.z1, c.y, c.at, c.hookY) && (c.axis === 'x' || c.axis === 'z') && c.x1 - c.x0 > 2 && c.z1 - c.z0 > 2) {
    const floor = floorAt((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2);
    if (c.y - floor > 3) crane = {x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1, y: c.y, at: clamp(c.at, 0.05, 0.95), hookY: clamp(c.hookY, floor + 2.2, c.y - 1.6), axis: c.axis, floor};
  }
  return tracks.length || pits.length || crane ? {tracks, pits, crane} : null;
}

/**
 * The rail spur: from deep in the depot, out through its widest entrance, across the street, along it to the cordon. `shedTracks`: lane
 * ROOMS drew the shed's own tracks (DepotGear), so the spur stops at the doorway.
 */
function planRail(S: SurfaceInfo, buildings: BuildingLook[], segs: StreetSeg[], floorAt: (x: number, z: number) => number, shedTracks = false): RailSpur | null {
  const dep = buildings.find(b => b.id === S.depot.building);
  if (!dep) return null;
  const b = dep.b, fp = b.footprint;
  const ent = [...b.entrances].sort((p, q) => q.width - p.width)[0];
  const side: Side = ent?.side ?? 'S';
  const {alongX, n} = SIDE_NORMAL[side];
  const c = ent ? (alongX ? ent.x : ent.z) : alongX ? (fp.x0 + fp.x1) / 2 : (fp.z0 + fp.z1) / 2;
  const plane = side === 'N' ? fp.z0 : side === 'S' ? fp.z1 : side === 'W' ? fp.x0 : fp.x1;
  const depthIn = alongX ? fp.z1 - fp.z0 : fp.x1 - fp.x0;
  const P = (along: number, out: number) => (alongX ? {x: along, z: plane + n * out} : {x: plane + n * out, z: along});
  // the street in front: the nearest segment running parallel to the facade
  const para = segs.filter(s => (s.axis === 'x') === alongX && (n > 0 ? s.c > plane : s.c < plane) && c >= s.s0 - 20 && c <= s.s1 + 20)
    .sort((p, q) => Math.abs(p.c - plane) - Math.abs(q.c - plane))[0];
  const out = para ? Math.abs(para.c - plane) : 12;
  const pts: {x: number; z: number}[] = [P(c, shedTracks ? -0.3 : -Math.max(3, depthIn - 4)), P(c, out - 6)];
  // a quarter curve (radius 6 m) onto the street toward the nearer district edge, then along it
  const toLow = para ? (c - para.s0 < para.s1 - c) : true;
  const sgn = toLow ? -1 : 1;
  for (let k = 1; k <= 6; k++) {
    const a = (k / 6) * Math.PI / 2;
    const along = c + sgn * 6 * (1 - Math.cos(a)), o = out - 6 + 6 * Math.sin(a);
    pts.push(P(along, o));
  }
  const end = para ? (toLow ? para.s0 - 4 : para.s1 + 4) : c + sgn * 40;
  pts.push(P(end, out));
  return {points: pts, y: floorAt(pts[0].x, pts[0].z), gauge: 1.435, buffer: (() => { const p = pts[0]; return {x: p.x, z: p.z, yaw: alongX ? 0 : Math.PI / 2}; })()};
}

/** Look summary of one building (QA / tests). */
export function buildingLookSummary(b: BuildingLook): Record<string, unknown> {
  return {id: b.id, style: b.style.id, tint: b.tint.toString(16), storeys: b.storeys, top: b.top, minTop: b.minTop, holes: b.holes.length,
    air: b.holes.filter(h => h.kind === 'air').length, signs: b.signs.map(s => s.text), escapes: b.escapes.length, decks: b.decks.length,
    family: b.family, interior: INTERIOR_LOOKS[b.family].floor.kind, cond: b.b.condition};
}

/** Every style id the plan can produce (tests). */
export const PLAN_STYLE_IDS = Object.keys(FACADE_STYLES);
