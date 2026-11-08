// Iteration 08 (Lane G): level visibility culling for multi-level stations.
//
// Frustum culling alone draws the deck above and the service crossing below whenever they are in the
// view frustum, although slabs hide them. The station is a stack of levels joined only through
// PORTALS - columns whose free band spans two levels' walking heights (light wells, double-height
// voids, stair flights between levels). The camera's own level renders normally; another level's
// meshes render only within MARGIN of a portal tile that is (a) in the view frustum, (b) within fog
// distance and (c) in 3D line of sight from the eye through the union free space (gen/levels.ts).
// Hidden meshes are moved to an unused layer (never touching `visible`, which other systems own), so
// both the main pass and the flashlight shadow pass skip them. Meshes spanning several levels, or with
// no geometry at registration (dynamic / pooled instances), are never culled.
// Also on a single level: registered (lit, fogged) meshes whose box lies entirely beyond the distance
// where the scene's FogExp2 is >= 99.8 % opaque are hidden (they render as pure fog colour). Emissive
// tubes and glow cards (fixture state readable from afar) are not registered and stay.
//
// Iteration 12 (ARCH, user: "right at the moment where you get to the bottom of the stairs the geometry
// often disappears"): a stair RUN (flights + intermediate landings + its lead) is carved identically into
// the two level grids it joins, so LevelColumns keeps ONE band for it, owned by the lower level index
// (main). The camera's level on the whole run therefore resolved to main: at the bottom of a run down to
// the lower level (and at the top of a run up to the upper level) the destination level was culled
// unless a portal tile - only the few mid-run columns whose band reached BOTH fixed walking zones - was
// in the frustum, and those lie behind you once you face off the last step. Now:
// - the camera stands on EVERY level whose own (pre-dedup) band holds the eye, so on a shared run both
//   levels are current and nothing of either is level-culled;
// - every shared column (identical band in both grids: the whole run) is a portal tile of that pair, so
//   just off either end the run and the level it came from stay visible through it;
// - a portal tile right next to the eye counts as visible without the frustum / sight-line test.
//
// Task office-seamless-20261029 (ENGINE): N storeys (the 9-storey Office Space tower in one world).
// - Portals are built in one pass over the columns for every level pair (identical tiles to the per-pair loop).
// - Visibility propagates through any number of portal hops (breadth-first over levels; each tile's frustum / sight test
//   runs at most once per update), not just two: looking up a scissor stair shows each storey whose run is in sight.
// - Multi-level meshes: `userData.levels` (the builder tags every stair flight with the two storeys it joins) renders when
//   any of those levels is current or seen through a portal near it - a flight is drawn only when one of its storeys is,
//   instead of never being culled. In stacks of more than LEGACY_STACK levels an untagged mesh spanning several bands
//   (or taller than 4.5 m) is tagged with every level whose walking zone its box reaches, instead of never being culled;
//   Subway stations (<= 3 levels) keep the iteration-08 rule.
// Culling only moves meshes to CULL_LAYER (render visibility); it never touches actors, items or any world state, and the
// iteration-14 warm-up still finds culled meshes there (render/warmup.ts planWarmup 'full').
//
// Task track3-eaton-centre-20261031 (lane ARCH): the ATRIUM of The Eaton's Center — one open column from the subway platform
// through six retail rings to the glass roof (35+ m), seen from almost everywhere on every storey. Pair portals would put
// C(7, 2) = 21 copies of every void tile in the list, each sight-tested on every update, and PORTAL_MAX_DIST (55 m) would drop
// the far end of a long galleria that the mall's light haze still shows (black pop-ins). With `opts.atrium` (a per-cell mask
// of the void outline, mall layouts only) the void's columns become ATRIUM TILES instead: one tile per TILE x TILE cells, joining
// every level whose walking zone its free bands reach. Per update: frustum + distance (the fog cull distance, not 55 m) on each
// atrium tile, then sight tests nearest-first until ONE succeeds (at most ATRIUM_SIGHT_TESTS; a tile right beside the eye or
// within ATRIUM_NEAR counts outright — the platform under the void, a balustrade, the glass lift cab). If the void is seen,
// every frustum-visible atrium tile is visible for all its levels (over-drawing an occluded corner never pops; under-drawing
// would), those levels join the breadth-first pass. With the mall's SLAB OCCLUSION (opts.slabs, lane PERF) every mesh of such a level
// is a candidate and the slab planes (inside each slab, SLAB_DROP under the storey floor) remove the storey-occluded bulk exactly:
// the former 20 m ATRIUM_MARGIN popped deep back-of-house slivers seen through distant openings (PERF's depth oracle: 22 meshes,
// 1-8 px, on 17 poses), now 0 — and the start view draws fewer objects than margin + floor-height planes did. Without slabs (QA A/B)
// the margin rule stands: a mesh of an atrium-visible level renders within ATRIUM_MARGIN of a visible atrium tile. Without `opts.atrium` (every Subway station, the Office) nothing here runs: identical behaviour and stats.
//
// Task studio-reactor-submit-roof-fog-20261102 (lane CPU, user: "CPU spending around 20ms in 'submit'"): THE REACTOR takes the same
// slab + same- / cross-storey occlusion (world/builder.ts passes `slabs` for it too). Its pit is the atrium; its rooms, the three side
// complexes and the tier rooms sit behind the pit's rock walls / under the storey slabs, and from the rim only ~15 % of the submitted
// draws owned a pixel. The rules are the mall's, unchanged; the Reactor's grid holds one column the builder does NOT draw — the
// vessel's (the hero model stands there: ReactorArch.occlusionSee) — passed as a `see` rect (open on every storey). `slabs.glass`
// names the glazed lift shafts of the atrium / aperture rules separately (default: `see`, the mall's shafts); the Reactor has none.

//
// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU, user: "turning the camera around in the mall causes the spike"):
// a full update runs on EVERY turning frame (the skip only holds while the camera is still). Turning in place does not move the eye,
// and several decisions depend on the eye POSITION only: the slab test of each entry (eye + box), the sight rays to the atrium /
// portal tiles and through street-exit openings (eye + fixed grid targets). Those results are now kept per eye position (`posStamp`:
// bumped whenever the eye or its override changes; a changed box clears its own) instead of being recomputed per frame; everything
// that depends on the view direction (frustum, fog depth, the occlusion wedge) still runs every update. The hot loop no longer
// allocates per entry (closures, one-element level arrays, per-update tile memo / sets / candidate objects), and the moving lift /
// loot batches bring their shared parents' matrices up to date once per pass instead of once per mesh. Decisions are identical
// (tests/rendercpu-culler.test.ts compares every entry's layer against fresh, uncached decisions over mall yaw sweeps and walks).
//
// Task studio-skywalk-variety-20261107-231448-01 (lane PERF, user: "looking in some directions causes lag"): THE SKYWAYS takes the same
// slab + same- / cross-storey occlusion (world/builder.ts; the see-through parts from world/skywaysOcclusion.ts). Its grids hold see-
// through structure the builder draws as glass or not at all — the glazed window spans cut out of SOLID wall runs and the outdoor air
// over the streets (solid on every grid) — so a `see` rect may carry a height range [y0, y1] (default: every height, the mall's /
// Reactor's rects unchanged): it opens its cells for a storey's closed columns only where it overlaps that storey's range, and across a
// slab plane only where it straddles it (a window opens its own storey, the street air every height above the street, never the
// street surface over the underground storey). The portal / level rule knew only grid openings (stairs, atria): another storey seen
// through two panes across a street (a lobby from a bridge, a bridge from a lobby) was culled although visible (lane PERF's depth
// oracle: 78 visible meshes hidden on 62 Skyways poses). With `slabs.windows` (Skyways: every glazed span, its storey and heights):
//  - the sight rays (portal tiles, windows) also pass through the see rects' volumes (the glass, the street air);
//  - WINDOW TILES: a span of a storey the eye is not on, in the frustum, inside the fog and in sight (every cell along the span at four
//    heights, just inside its face toward the eye; kept per eye position), makes its storey AIR-VISIBLE: every mesh of it is a candidate
//    (no margin) and the slab planes + storey occlusion decide them exactly, as the mall's atrium-visible storeys; air-visible storeys
//    seed the portal hops;
//  - a mesh rising over the top storey's occlusion range (stair wells' walls up to the building tops, the atrium vaults: seen over the
//    roofs through any glass) is never level-culled.
// `everyStorey` (QA / tests): every storey a candidate, no portal / level rule at all (the upper bound the window rule is checked
// against). And on such a stack of <= LEGACY_STACK storeys (the Skyways' three) a mesh spanning several bands registers as an
// unlevelled entry (fog, slab planes, per-storey slices) instead of never being culled. Without `slabs.windows` nothing here runs.

import * as THREE from 'three';
import {CELL, FLOOR, VOID, type Grid} from '../gen/grid';
import type {Level} from '../gen/levels';
import {LevelColumns, cellCeil, rampsEqual} from './levelGeometry';
import type {LevelResolver} from './builder';

/** Layer that no camera renders: culled meshes live here. */
export const CULL_LAYER = 31;
/** Layers.mask of an object set to CULL_LAYER only (three: (1 << layer | 0) >>> 0). */
const CULL_MASK = (1 << CULL_LAYER | 0) >>> 0;
/** A level's mesh renders if its X/Z box comes within this distance of a visible portal tile (m). */
export const PORTAL_MARGIN = 12;
/** Portal tiles beyond this distance are not tested (fog makes them invisible; FogExp2 0.043 -> ~1% at 50 m). */
export const PORTAL_MAX_DIST = 55;
/** Portal tiles are square groups of portal columns of this many cells. */
const TILE = 6;
/** Fog transmittance below which a surface is treated as invisible (FogExp2: exp(-(d * density)^2)). */
export const FOG_CULL_TRANSMITTANCE = 0.002;
export function fogCullDistance(fogDensity: number): number {
  return fogDensity > 0 ? Math.sqrt(-Math.log(FOG_CULL_TRANSMITTANCE)) / fogDensity : Infinity;
}
/** Height range above a level's base that counts as its walking/viewing zone (m). */
const ZONE: [number, number] = [0.2, 2.4];
/** A portal tile within this horizontal distance of the eye (and spanning its height) is visible outright (m). */
export const PORTAL_NEAR = 1.0;
/** Band tolerance when deciding which levels the eye stands on (as the builder's levelAt). */
const EYE_TOL = 0.3;
/** Stacks up to this many levels (every Subway station) keep the iteration-08 rule for untagged multi-level meshes. */
export const LEGACY_STACK = 3;
/** Task track3-eaton-centre-20261031 (lane ARCH): atrium tiles are tested up to this horizontal distance (m; capped by the fog). */
export const ATRIUM_MAX_DIST = 240;
/** Most sight tests per update before the void counts as unseen (nearest frustum-visible atrium tiles first). */
export const ATRIUM_SIGHT_TESTS = 12;
/** An atrium tile this close to the eye horizontally (m) is seen outright (balustrade edge, glass lift cab beside the void). */
export const ATRIUM_NEAR = 2.5;
/** The same for an eye inside the (solid) glass lift shaft (eyeOverride set): the shaft stands beside the void. */
export const ATRIUM_CAB_NEAR = 8;
/** Task mall-playtest-revision (lane ARCH, U07): an eye this close (m) to a glass lift shaft, looking at it, counts as at the car. */
export const GLASS_LOBBY = 3.5;
/**
 * A mesh of an atrium-visible storey renders within this distance (m) of a visible atrium tile: a gallery (4-6 m) plus a whole
 * sales floor (10-12 m) seen through its shopfront across the void (PORTAL_MARGIN 12 popped the back of the shop); stock rooms /
 * service corridors behind (~20+ m from the void edge) stay hidden from other storeys.
 */
export const ATRIUM_MARGIN = 20;

/**
 * Task track3-eaton-centre-20261031 (lane PERF): SLAB OCCLUSION (mall only, opts.slabs). The atrium rule above shows every mesh
 * within ATRIUM_MARGIN of a visible void tile, on every storey; from the pit platform that is ~1,100 world meshes of which a
 * depth-buffered oracle sees ~260 — the rest stand on gallery slabs seen from below (or under slabs seen from above). A mesh is
 * now also hidden when, for some storey floor plane y = Y between the eye and the WHOLE mesh box, every ray from the eye to the
 * box crosses that plane over closed structure: the box's 8 corners projected from the eye onto the plane bound every crossing
 * point; if no cell of that rectangle is open across Y (no free band of any level straddles Y there, contiguous bands merged —
 * the void, escalator / stair wells and band joints are open), every such ray leaves free space through a drawn floor, ceiling
 * or wall before reaching the box. Exact in geometry, conservative in extent (bounding rectangle; boxes straddling a plane,
 * anything outside the grid and `see`-through cells — the glass lift shaft, closed on every grid but glazed — never cull).
 */
const SLAB_EPS = 0.05;
/** Task track3 (lane ARCH): slab planes sit this far under their storey floor (inside the slab; every mall slab is >= 0.4 m). */
const SLAB_DROP = 0.2;

/**
 * Task mall-round2-20261031 (lane ARCH, M09): a locked street exit's glazed opening (world/mallStreetExit.ts apertureOf): the hall-side
 * wall plane (x for E / W exits, z for N / S), the span along it, floor / head y, the outward normal. Meshes tagged
 * `userData.aperture` (the exit's doors, glass, the street view and its fog beyond the glass — mall only) render only when, besides
 * their storey's usual rule, the opening itself is potentially visible: eye on the hall side, within the fog distance, the opening
 * (+ its reveal) in the frustum, and a sight ray through the free bands reaching a hall cell right in front of it (every 0.25 m
 * along the span at four heights) — or the eye right beside it, or inside a glazed lift shaft (rays cannot start in its solid
 * cells: conservative). Every view of the exterior passes through the opening, so this never hides a visible pixel; from rooms
 * beside / behind the exit (walls between) the street is not submitted at all. Untagged meshes (Subway / Office) never reach it.
 */
export interface ExitAperture { nx: number; nz: number; plane: number; s0: number; s1: number; y0: number; y1: number }
/**
 * A see-through rect of the occlusion rules (world m; slabs.see). Task studio-skywalk-variety (lane PERF): an optional height range
 * [y0, y1] (default -Infinity .. Infinity: open on every storey and across every slab plane, as before).
 */
export interface SeeRect { x0: number; z0: number; x1: number; z1: number; y0?: number; y1?: number }
/** Task studio-skywalk-variety (lane PERF): a glazed span (world m: its wall cells' box) of storey `level` (a level id), open y0 .. y1. */
export interface WindowSpan { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; level: number }
/** A window tile: its span, storey and the cell centres along it (sight targets, x z pairs). */
interface WindowTile extends WindowSpan { pts: Float64Array }
/** The cells of the rects of `see` that `use` keeps (1 = see-through), on a W x H grid. */
function seeMaskOf(see: readonly SeeRect[], W: number, H: number, use: (r: SeeRect) => boolean): Uint8Array {
  const m = new Uint8Array(W * H);
  for (const r of see) {
    if (!use(r)) continue;
    for (let cy = Math.max(0, Math.floor(r.z0 / CELL)); cy < Math.min(H, Math.ceil(r.z1 / CELL)); cy++)
      for (let cx = Math.max(0, Math.floor(r.x0 / CELL)); cx < Math.min(W, Math.ceil(r.x1 / CELL)); cx++) m[cy * W + cx] = 1;
  }
  return m;
}
/** An eye this close (m, horizontally) to an exit opening at its height sees it outright. */
export const EXIT_NEAR = 1.2;

/**
 * Task mall-round2-20261031 (lane PERF, user: "when looking certain directions there can be FPS drop, caused by ~1,500 draw calls
 * and the CPU spending a lot of time in submit"): SAME-STOREY OCCLUSION (mall only, with slab occlusion; opts.slabs). PERF's
 * matched-view census (seed t3a, arcade-loop, the primary's QA poses; lanes/PERF.notes) found that of the meshes the culler +
 * frustum submitted only 8–47 % own a single visible pixel (depth oracle) — the bulk are props, loot holders, room dressing and
 * shell chunks ON THE EYE'S STOREY inside shops, stock rooms and back-of-house behind walls, each drawn in the scene pass AND again
 * in the flashlight shadow pass (~0.06 ms of CPU submit per draw on the primary's llvmpipe baseline). The atrium / slab rules
 * above only reason across storeys.
 *
 * Rule: a storey's walls are the columns CLOSED over its whole height range [base - OCCL_BELOW, next storey base - OCCL_GAP]
 * (no free band of any level there; the glazed lift shaft and other `see` rects are open). A ray between two points inside that
 * range stays inside it, so it can only pass a closed column by crossing a drawn wall face (the builder draws a face wherever a
 * free band borders closed space). Per update, for each viewpoint (the eye and `viewpoints` — the flashlight, whose shadow pass
 * uses the same layers) a 1D polar occlusion buffer is built from the boundary runs of those columns (straight runs of cell
 * edges between open and closed columns with the closed side on the same side: crossing one anywhere enters a closed column):
 * bin b holds the smallest far-end distance of a run whose angular span FULLY covers the bin. A single-storey mesh whose box lies
 * in that range is hidden when, for every viewpoint, every bin its footprint (padded by OCCL_PAD) overlaps is covered closer than
 * the footprint's nearest point — then every ray to every point of it crosses a wall first (conservative: corners between runs
 * and partly covered bins count as open). A hidden mesh never draws a visible pixel, and since nothing from the flashlight's
 * position reaches it either it can never win a shadow-map depth test: both passes are unchanged except for the work.
 * Exact per frame: between the culler's full updates (skipped for < 0.25 m / small turns) the occlusion part re-runs whenever a
 * viewpoint moved (mesh visibility around a corner changes with any step). Opt-outs: userData.noOcclusion, meshes not touching an
 * open cell of their storey, multi-storey / unlevelled meshes, the eye in the lift cab (eyeOverride) or inside a closed column.
 * An InstancedMesh whose bounds grew (damage/propDamage.ts reattach: a loose prop handed back where it came to rest) has its
 * registered box refreshed before every decision (mall only).
 */
export const OCCL_BINS = 2048;
/** Footprint pad (m): a mesh flush with a wall face (signs, shelving) is decided by the open cell in front of it. */
export const OCCL_PAD = CELL;
const OCCL_BELOW = 0.3;
const OCCL_GAP = 0.1;
/** The top storey's range ends this far above its floor: under the vault's glass (gen/mall/frame.ts ROOF.spring 5.6 m). */
export const OCCL_TOP = 5.5;
/** Cross-storey buffers: angular bins, near-distance buckets and the bucket size (m). */
export const OCCL_XBINS = 512;
const OCCL_XJ = 32;
const OCCL_XS = 2;
const TAU = Math.PI * 2;
/** cos / sin of the bin edges (edge e at angle -pi + e * 2 pi / bins; e = 0..bins) of the same- and cross-storey buffers. */
function binEdges(n: number): {cos: Float64Array; sin: Float64Array} {
  const cos = new Float64Array(n + 1), sin = new Float64Array(n + 1);
  for (let e = 0; e <= n; e++) { const t = -Math.PI + e * TAU / n; cos[e] = Math.cos(t); sin[e] = Math.sin(t); }
  return {cos, sin};
}
const OCCL_EDGES = binEdges(OCCL_BINS);
const OCCL_XEDGES = binEdges(OCCL_XBINS);
/** Margin (rad) around the camera's azimuth range within which the occlusion buffers are rasterized. */
const OCCL_WEDGE_MARGIN = 0.25;
/** Between full updates the occlusion re-runs once a viewpoint moved this far (m). */
const OCCL_MOVE = 1e-3;
/** One storey's occlusion data: its height range, closed columns (1) and boundary runs (x0, z0, x1, z1 per run). */
interface OcclLevel { lo: number; hi: number; closed: Uint8Array; openSat: Int32Array; runs: Float64Array }

const isOpen = (g: Grid, i: number) => g.cells[i] === FLOOR || g.cells[i] === VOID;
/** Lane RENDER-CPU: any of `list` in `set` (no closure on the culler's hot path). */
function anyIn(list: readonly number[], set: ReadonlySet<number>): boolean {
  for (let i = 0; i < list.length; i++) if (set.has(list[i])) return true;
  return false;
}

/** Lowest floor / highest ceiling of column i's band on grid g (ramps: the band the cell sweeps). */
function bandOf(g: Grid, i: number): [number, number] {
  return ramp(g, i) ?? [g.floorOf(i), cellCeil(g, i)];
}

/** True when column i is the SAME band in both grids (a stair run carved into both levels it joins). */
export function sharedColumn(ga: Grid, gb: Grid, i: number): boolean {
  if (!isOpen(ga, i) || !isOpen(gb, i)) return false;
  const ra = ga.rampIdx[i], rb = gb.rampIdx[i];
  if (ra >= 0 || rb >= 0) return ra >= 0 && rb >= 0 && rampsEqual(ga.ramps[ra], gb.ramps[rb]);
  return Math.abs(ga.floorOf(i) - gb.floorOf(i)) < 1e-3 && Math.abs(cellCeil(ga, i) - cellCeil(gb, i)) < 1e-3;
}

interface Tile { a: number; b: number; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; cells: number[] }
interface Entry {
  obj: THREE.Mesh; level: number; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; mask: number; culled: boolean;
  /** Multi-level mesh (stair flight, tall shaft piece): renders when any of these levels does (level is NaN then). */
  levels?: readonly number[];
  /** Task track3 (lane ARCH): atrium tiles within ATRIUM_MARGIN of the box (built on first use; mall only). */
  near?: Int32Array;
  /** Task mall-round2 (lane PERF): level index of the same-storey occlusion test (-1: never occlusion-culled); mall only. */
  occ?: number;
  /** Shown by every other rule at the last full update (the occlusion refresh between full updates decides only these). */
  base?: boolean;
  /** Hidden by the occlusion rule at the last decision. */
  occluded?: boolean;
  /** InstancedMesh: its local bounding box at registration (min xyz, max xyz) — a grown box re-registers the entry (mall only). */
  lb?: Float64Array;
  /** Its world matrix at registration / last refresh — a moved mesh (a sliding landing door, a swinging stall door) re-registers (mall only). */
  mw?: Float32Array;
  /** Storeys (bit = level index) with an open cell within OCCL_PAD of the footprint (slice test). */
  occMask?: number;
  /** userData.dynamicBounds (mall only): bounds re-derived every update from the CURRENT world matrix / instance bounds (the lift cab
   *  and rig, the loot display's pooled batches); `empty` while it holds nothing (then no rule decides it: it draws nothing). */
  dyn?: boolean;
  empty?: boolean;
  /** Task mall-round2 (lane ARCH, M09): the street exit opening this mesh is seen through (mall only; see ExitAperture). */
  aperture?: ExitAperture;
  /** Lane RENDER-CPU: the slab test's result (sh) for the eye position of stamp `sk` (LevelCuller.posStamp); unset = not computed. */
  sk?: number;
  sh?: boolean;
}
/** Task track3 (lane ARCH): an atrium tile — open void columns joining every level in `levels`. */
interface AtriumTile { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; cells: number[]; levels: number[] }
/**
 * Task studio-reactor-submit-roof-fog-20261102 (lane CPU): a MOVING object (an enemy, a loose pickup) the culler decides on every
 * update from a box it asks for then (`box`: false = no bounds now, never hidden); its meshes go to CULL_LAYER while hidden.
 */
interface Tracked { obj: THREE.Object3D; box: (out: THREE.Box3) => boolean; meshes: THREE.Object3D[]; masks: number[]; hidden: boolean }

export class LevelCuller {
  readonly entries: Entry[] = [];
  private readonly tiles: Tile[] = [];
  private readonly levelIds: number[];
  private readonly fr = new THREE.Frustum();
  private readonly pm = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly eye = new THREE.Vector3();
  private last = {x: NaN, y: NaN, z: NaN, qx: 0, qy: 0, qz: 0, qw: 0, ov: null as number | null};
  /** Levels the eye stands on (scratch of update). */
  private readonly here = new Set<number>();
  /**
   * Task office-elevator-visibility-20261104-063115: the last level the eye was resolved on outside a solid column (or an override).
   * An eye inside a column with no open band on any storey (the Office lift's door wall / threshold: the shaft is solid on every
   * grid) keeps it instead of the resolver's default 0, which culled the whole current storey ("the level disappears"). -1: none.
   */
  private lastOpenLevel = -1;
  /** Diagnostics of the last update (`level`: the resolver's level; `levels`: every level the eye stands on). */
  stats = {level: 0, levels: [0] as number[], tilesTested: 0, tilesVisible: 0, culled: 0, fogged: 0, registered: 0, uncullable: 0,
    /** Levels rendered this update (current + seen through portals), portal hops used, multi-level entries. */
    visibleLevels: [0] as number[], hops: 0, multi: 0};
  enabled = true;
  /** Hide registered meshes entirely beyond this distance (m); set from the scene fog (fogCullDistance). */
  maxDistance = Infinity;
  /**
   * Task office-seamless-20261029: the level id the eye is on regardless of the grids, or null (resolve from the level
   * bands, the default). The moving elevator cab (world/towerRuntime.ts) sets it while the camera is inside the cab: its
   * shaft is SOLID on every storey grid, so the grid lookup alone would put the eye on the station. Never set in a Subway
   * station.
   */
  eyeOverride: number | null = null;
  /** Task track3 (lane ARCH): atrium tiles (mall only; empty elsewhere) and the last update's atrium diagnostics. */
  private readonly atriumTiles: AtriumTile[] = [];
  /** Task mall-playtest-revision (lane ARCH): the glazed lift shafts (mall only: the builder's slabs.see rects). */
  private readonly glassShafts: {x0: number; z0: number; x1: number; z1: number}[];
  private atriumVis = new Uint8Array(0);
  private readonly atriumLevels = new Set<number>();
  atriumStats = {tiles: 0, inFrustum: 0, seen: false, sightTests: 0, levels: [] as number[]};
  /** Task track3 (lane PERF): storey floor planes (y) and, per plane, a summed-area table of cells open across it (mall only). */
  private readonly slabPlanes: number[] = [];
  private readonly slabOpen: Int32Array[] = [];
  /** Meshes hidden by slab occlusion in the last update (mall only; 0 elsewhere). */
  slabCulled = 0;
  /** Slab occlusion on / off (mall only; tests / QA A-B). */
  slabs = true;
  /** Task mall-round2 (lane ARCH, M09): street-exit meshes hidden by their aperture gate in the last update, and the gate's memo. */
  apertureCulled = 0;
  private readonly apertureSeenMemo = new Map<ExitAperture, boolean>();
  /** Task mall-round2 (lane PERF): same-storey occlusion on / off (mall only; tests / QA A-B). */
  occlusion = true;
  /** Meshes hidden by the same-storey occlusion at the last decision (mall only; 0 elsewhere). */
  occlusionCulled = 0;
  /**
   * Task mall-round2 (lane PERF): further viewpoints whose sight also keeps a mesh drawn (game.ts: the flashlight — its shadow pass
   * draws with these layers). Only the same-storey occlusion reads them.
   */
  viewpoints: THREE.Object3D[] = [];
  /** Per level index: same-storey occlusion data (mall only; empty elsewhere). */
  private readonly occl: (OcclLevel | null)[] = [];
  /** Polar buffers per (viewpoint, level index) and the viewpoints / levels of the last occlusion decision. */
  private readonly occlBufs: Float32Array[] = [];
  private readonly occlX: Float32Array[] = [];
  private readonly occlPts: number[] = [];
  private readonly occlRange: number[] = [];
  private readonly occlBuilt: number[] = [];
  private readonly occlBuiltX: number[] = [];
  private occlStamp = 0;
  private occlW0 = -Infinity;
  private occlW1 = Infinity;
  private readonly occlWv = new Float64Array(4);
  private readonly occlOn: boolean[] = [];
  private readonly occlHere = new Set<number>();
  private readonly allLevelIds: ReadonlySet<number>;
  private occlTopHi = -Infinity;
  private occlState = false;
  private readonly vp = new THREE.Vector3();
  /**
   * Lane RENDER-CPU: the eye position (and override) the position-only caches below were computed for, and its stamp (bumped on any
   * change). Per stamp: each entry's slab test (Entry.sk / sh), each atrium / portal tile's sight test, each exit opening's sight rays.
   */
  private posStamp = 0;
  private readonly posEye = new Float64Array([NaN, NaN, NaN, NaN]);
  private atriumSeeK = new Int32Array(0);
  private atriumSeeV = new Uint8Array(0);
  private tileSeeK = new Int32Array(0);
  private tileSeeV = new Uint8Array(0);
  private readonly apertureRays = new Map<ExitAperture, {k: number; v: boolean}>();
  /** Lane RENDER-CPU: reused per-update scratch (no per-frame allocation). */
  private tileMemo = new Int8Array(0);
  private readonly visTiles = new Map<number, Tile[]>();
  private readonly shownSet = new Set<number>();
  private readonly hopSet = new Set<number>();
  private readonly candK: number[] = [];
  private readonly candD: number[] = [];
  private readonly candOrder: number[] = [];
  /** Parents of dynamic-bounds meshes whose world matrices were brought up to date in the current pass (refreshBox). */
  private readonly dynParents = new Set<THREE.Object3D>();
  /** Task studio-reactor-submit (lane CPU): moving objects decided by their box every update (see track()); none unless registered. */
  private readonly tracked = new Map<THREE.Object3D, Tracked>();
  private readonly trackEntry = {obj: new THREE.Object3D(), level: NaN, levels: [] as readonly number[], x0: 0, z0: 0, x1: 0, z1: 0, y0: 0, y1: 0, mask: 0, culled: false} as Entry;
  /** Tracked objects hidden at the last update (0 unless track() is used: the Reactor's runtime). */
  trackedCulled = 0;

  /**
   * Task studio-skywalk-variety (lane PERF): every storey's meshes are candidates of the slab / storey occlusion, no portal / level
   * rule (QA / tests: the upper bound of the window rule; set from `slabs.everyStorey`, off by default).
   */
  everyStorey: boolean;
  /** Task studio-skywalk-variety (lane PERF): the window tiles (Skyways: slabs.windows) and the storeys air-visible at the last update. */
  private readonly winTiles: WindowTile[] = [];
  private readonly airLevels = new Set<number>();
  /** Per window tile: its sight result (1 / 0) for the eye position of stamp winSeeK (LevelCuller.posStamp). */
  private winSeeK = new Int32Array(0);
  private winSeeV = new Uint8Array(0);
  /** See-through volumes of the sight rays (slabs.windows only): per column (CSR) the [y0, y1] of every see rect over it. */
  private seeStart: Int32Array | null = null;
  private seeY = new Float64Array(0);
  /** Window tiles tested / seen and the air-visible storeys of the last update (Skyways; zeros elsewhere). */
  airStats = {tested: 0, seen: 0, levels: [] as number[]};
  /** The window rule on / off (Skyways only; tests / QA A-B: off = the portal / level rule alone, as before). */
  windowRule = true;

  constructor(private readonly levels: readonly Level[], private readonly cols: LevelColumns, private readonly levelAt: LevelResolver,
    opts?: {atrium?: Uint8Array; slabs?: {see?: readonly SeeRect[]; glass?: readonly {x0: number; z0: number; x1: number; z1: number}[]; everyStorey?: boolean;
      windows?: readonly WindowSpan[]}}) {
    this.levelIds = levels.map(l => l.id);
    this.allLevelIds = new Set(this.levelIds);
    if (levels.length > 1) this.buildPortals(opts?.atrium);
    if (levels.length > 1 && opts?.slabs) this.buildSlabs(opts.slabs.see ?? []);
    if (levels.length > 1 && opts?.slabs) this.buildOcclusion(opts.slabs.see ?? []);
    this.everyStorey = levels.length > 1 && !!opts?.slabs?.everyStorey;
    if (levels.length > 1 && opts?.slabs?.windows?.length) this.buildWindows(opts.slabs.windows, opts.slabs.see ?? []);
    // (task studio-reactor-submit, lane CPU: `glass` when given — the Reactor's see-through vessel column is no lift shaft — else `see`)
    this.glassShafts = opts?.atrium ? [...(opts.slabs?.glass ?? opts.slabs?.see ?? [])] : [];
  }

  /**
   * Task studio-skywalk-variety (lane PERF): the window tiles (spans of known storeys, their cell centres) and the see volumes of the
   * sight rays: per column (CSR) the [y0, y1] of every `see` rect over it.
   */
  private buildWindows(windows: readonly WindowSpan[], see: readonly SeeRect[]): void {
    const {W, H} = this.cols;
    const cellsOf = (r: SeeRect, f: (i: number) => void) => {
      for (let cy = Math.max(0, Math.floor(r.z0 / CELL)); cy < Math.min(H, Math.ceil(r.z1 / CELL)); cy++)
        for (let cx = Math.max(0, Math.floor(r.x0 / CELL)); cx < Math.min(W, Math.ceil(r.x1 / CELL)); cx++) f(cy * W + cx);
    };
    const start = new Int32Array(W * H + 1);
    for (const r of see) cellsOf(r, i => { start[i + 1]++; });
    for (let i = 0; i < W * H; i++) start[i + 1] += start[i];
    const fill = start.slice(0, W * H), ys = new Float64Array(2 * start[W * H]);
    for (const r of see) cellsOf(r, i => { const k = fill[i]++; ys[2 * k] = r.y0 ?? -Infinity; ys[2 * k + 1] = r.y1 ?? Infinity; });
    this.seeStart = start;
    this.seeY = ys;
    for (const w of windows) {
      if (!this.levelIds.includes(w.level) || !(w.y1 > w.y0)) continue;
      const pts: number[] = [];
      cellsOf(w, i => { const cx = i % W, cy = (i - cx) / W; pts.push((cx + 0.5) * CELL, (cy + 0.5) * CELL); });
      if (pts.length) this.winTiles.push({...w, pts: Float64Array.from(pts)});
    }
  }

  /**
   * Task studio-skywalk-variety (lane PERF): the storeys seen through glass this update (window tiles of storeys the eye is not on: in
   * the frustum, nearest point along the view axis inside the fog, a sight ray through the free bands + see volumes to a cell of the
   * span at its heights). Marks airLevels and adds them to `shown` (the portal hops start from them too).
   */
  private updateAir(e: THREE.Vector3, shown: Set<number>, here: ReadonlySet<number>, fx: number, fy: number, fz: number): void {
    const T = this.winTiles, air = this.airLevels;
    air.clear();
    if (this.winSeeK.length !== T.length) { this.winSeeK = new Int32Array(T.length).fill(-1); this.winSeeV = new Uint8Array(T.length); }
    let tested = 0, seen = 0;
    for (let k = 0; k < T.length && this.windowRule; k++) {
      const t = T[k];
      if (here.has(t.level) || air.has(t.level)) continue;
      const depth = Math.min(fx * (t.x0 - e.x), fx * (t.x1 - e.x)) + Math.min(fy * (t.y0 - e.y), fy * (t.y1 - e.y)) + Math.min(fz * (t.z0 - e.z), fz * (t.z1 - e.z));
      if (depth > this.maxDistance) continue;
      this.box.min.set(t.x0, t.y0, t.z0); this.box.max.set(t.x1, t.y1, t.z1);
      if (!this.fr.intersectsBox(this.box)) continue;
      tested++;
      if (this.winSeeK[k] !== this.posStamp) { this.winSeeV[k] = this.windowSeen(t, e) ? 1 : 0; this.winSeeK[k] = this.posStamp; }
      if (!this.winSeeV[k]) continue;
      seen++;
      air.add(t.level);
      shown.add(t.level);
    }
    this.airStats.tested = tested;
    this.airStats.seen = seen;
    this.airStats.levels = [...air].sort((a, b) => a - b);
  }

  /**
   * Task studio-skywalk-variety (lane PERF, Skyways only: window tiles): a mesh whose box rises over the top storey's occlusion range
   * (the stair wells' walls up to the building tops, the atrium vaults) — its upper part stands over the roofs, where the sky through
   * any glass may show it — is never level-culled (fog, slab planes and its storey slices still decide it).
   */
  private overRoofs(en: Entry): boolean {
    return this.winTiles.length > 0 && en.y1 > this.occlTopHi;
  }

  /**
   * A sight ray from the eye to some point of a window span: every cell along it, just inside the wall face(s) toward the eye (both
   * when the eye is level with the wall), at the eye height clamped into the span, its middle, just over the sill and under the head.
   */
  private windowSeen(t: WindowTile, e: THREE.Vector3): boolean {
    const thinX = t.x1 - t.x0 <= t.z1 - t.z0, ec = thinX ? e.x : e.z, a0 = thinX ? t.x0 : t.z0, a1 = thinX ? t.x1 : t.z1;
    const faces = ec < a0 ? [a0 + 0.05] : ec > a1 ? [a1 - 0.05] : [a0 + 0.05, a1 - 0.05];
    const ys = [Math.min(t.y1 - 0.1, Math.max(t.y0 + 0.1, e.y)), (t.y0 + t.y1) / 2, t.y0 + 0.1, t.y1 - 0.1];
    for (let q = 0; q < t.pts.length; q += 2) for (const f of faces) for (let h = 0; h < ys.length; h++) {
      if (h > 0 && ys[h] === ys[0]) continue;
      const tx = thinX ? f : t.pts[q], tz = thinX ? t.pts[q + 1] : f;
      if (this.ray(e.x, e.y, e.z, tx, ys[h], tz)) return true;
    }
    return false;
  }

  /**
   * Task mall-round2 (lane PERF): per storey, its closed columns (no free band of any level over the storey's height range; `see`
   * rects open), their summed-area table of OPEN cells and the boundary runs between open and closed columns.
   */
  private buildOcclusion(see: readonly SeeRect[]): void {
    const {W, H} = this.cols;
    const minBase = Math.min(...this.levels.map(l => l.baseY));
    for (const L of this.levels) {
      const above = this.levels.filter(o => o.baseY > L.baseY + 1).map(o => o.baseY);
      // (the lowest storey's range is open below — floors / pits enclose everything under it; the top storey's ends OCCL_TOP above
      // its floor, under the roof vault's glass, above which a ray can leave the building over columns nothing is drawn on)
      const lo = L.baseY <= minBase + 1 ? -Infinity : L.baseY - OCCL_BELOW, hi = above.length ? Math.min(...above) - OCCL_GAP : L.baseY + OCCL_TOP;
      // (task studio-skywalk-variety, lane PERF: a rect with a height range opens only the storeys whose range it overlaps)
      const seeMask = seeMaskOf(see, W, H, r => (r.y0 ?? -Infinity) < hi && (r.y1 ?? Infinity) > lo);
      const closed = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        if (seeMask[i]) continue;
        let open = false;
        for (let k = 0; k < this.cols.count(i) && !open; k++) {
          const g = this.levels[this.cols.level(i, k)].grid;
          if (g.cells[i] !== FLOOR && g.cells[i] !== VOID) continue;
          const [f, c] = bandOf(g, i);
          open = f < hi && c > lo;
        }
        if (!open) closed[i] = 1;
      }
      const openSat = new Int32Array((W + 1) * (H + 1));
      for (let cy = 0; cy < H; cy++) {
        let row = 0;
        for (let cx = 0; cx < W; cx++) { row += 1 - closed[cy * W + cx]; openSat[(cy + 1) * (W + 1) + cx + 1] = openSat[cy * (W + 1) + cx + 1] + row; }
      }
      // boundary runs: cell edges between an open and a closed column, merged along a straight line while the closed side stays
      const runs: number[] = [];
      for (let cy = 1; cy < H; cy++) { // edges z = cy * CELL (closed below: -1, above: +1)
        let start = -1, side = 0;
        for (let cx = 0; cx <= W; cx++) {
          const s = cx < W ? closed[(cy - 1) * W + cx] - closed[cy * W + cx] : 0;
          if (s !== side) {
            if (side !== 0) runs.push(start * CELL, cy * CELL, cx * CELL, cy * CELL);
            start = cx; side = s;
          }
        }
      }
      for (let cx = 1; cx < W; cx++) { // edges x = cx * CELL
        let start = -1, side = 0;
        for (let cy = 0; cy <= H; cy++) {
          const s = cy < H ? closed[cy * W + cx - 1] - closed[cy * W + cx] : 0;
          if (s !== side) {
            if (side !== 0) runs.push(cx * CELL, start * CELL, cx * CELL, cy * CELL);
            start = cy; side = s;
          }
        }
      }
      this.occl.push({lo, hi, closed, openSat, runs: Float64Array.from(runs)});
      this.occlTopHi = Math.max(this.occlTopHi, hi);
    }
  }

  /**
   * Task mall-round2 (lane PERF): an entry's occlusion test — its storey's level index (its box lies in that storey's range), -2 =
   * SLICES (a multi-storey or taller mesh — escalators, stair flights, the glass lift's cab / rig: decided per storey slice of its box,
   * hidden only when every slice is), or -1 (never; see OCCL_* — opt-outs). `occMask`: storeys with an open cell within OCCL_PAD of the
   * footprint (a slice on another storey is never hidden).
   */
  private occlusionLevel(en: Entry): number {
    if (!this.occl.length || en.obj.userData.noOcclusion === true) return -1;
    const {W, H} = this.cols;
    const cx0 = Math.floor((en.x0 - OCCL_PAD) / CELL), cx1 = Math.floor((en.x1 + OCCL_PAD) / CELL);
    const cy0 = Math.floor((en.z0 - OCCL_PAD) / CELL), cy1 = Math.floor((en.z1 + OCCL_PAD) / CELL);
    if (cx0 < 0 || cy0 < 0 || cx1 >= W || cy1 >= H) return -1;
    const R = W + 1;
    let mask = 0;
    this.occl.forEach((o, k) => {
      const q = o!.openSat;
      if (q[(cy1 + 1) * R + cx1 + 1] - q[cy0 * R + cx1 + 1] - q[(cy1 + 1) * R + cx0] + q[cy0 * R + cx0] > 0) mask |= 1 << k;
    });
    en.occMask = mask;
    if (!en.levels && !Number.isNaN(en.level)) {
      const k = this.levelIds.indexOf(en.level), o = this.occl[k];
      if (o && en.y0 >= o.lo && en.y1 <= o.hi) return (mask >> k) & 1 ? k : -1;
    }
    return mask ? -2 : -1;
  }

  /**
   * Task mall-round2 (lane PERF): a registered mesh that MOVED (world matrix changed: sliding lift landing doors, swinging doors) or an
   * InstancedMesh whose bounds grew (damage/propDamage.ts reattach: a pushed prop handed back where it came to rest) takes its new box
   * before any decision (mall only; the registered box was the only one before). At most one frame behind a move (matrices update
   * in the render after this) — far inside the occlusion's footprint pad.
   */
  private refreshBox(en: Entry): void {
    if (en.dyn) {
      // the cab / rig moved this frame: its matrices before the render's update (lane RENDER-CPU: each shared parent chain once per
      // pass — dynParents is cleared at the start of every pass — then the mesh itself: the same matrices as updateWorldMatrix(true))
      const p = en.obj.parent;
      if (p && !this.dynParents.has(p)) { p.updateWorldMatrix(true, false); this.dynParents.add(p); }
      en.obj.updateWorldMatrix(false, false);
    }
    const mw = en.mw!, e = en.obj.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16 && !moved; i++) moved = mw[i] !== Math.fround(e[i]);
    const lb = en.lb, bb = (en.obj as THREE.InstancedMesh).boundingBox;
    // a static batch only grows (reattach); a dynamic (pooled) one changes freely
    const grown = !!lb && !!bb && (en.dyn ? bb.min.x !== lb[0] || bb.min.y !== lb[1] || bb.min.z !== lb[2] || bb.max.x !== lb[3] || bb.max.y !== lb[4] || bb.max.z !== lb[5]
      : !(bb.min.x >= lb[0] && bb.min.y >= lb[1] && bb.min.z >= lb[2] && bb.max.x <= lb[3] && bb.max.y <= lb[4] && bb.max.z <= lb[5]));
    if (!moved && !grown) return;
    if (moved) mw.set(e);
    if (lb && bb) {
      lb[0] = bb.min.x; lb[1] = bb.min.y; lb[2] = bb.min.z; lb[3] = bb.max.x; lb[4] = bb.max.y; lb[5] = bb.max.z;
      this.box.copy(bb).applyMatrix4(en.obj.matrixWorld);
    } else this.box.setFromObject(en.obj);
    if (en.dyn) en.empty = this.box.isEmpty();
    if (this.box.isEmpty()) return;
    en.x0 = this.box.min.x; en.y0 = this.box.min.y; en.z0 = this.box.min.z; en.x1 = this.box.max.x; en.y1 = this.box.max.y; en.z1 = this.box.max.z;
    en.near = undefined;
    en.sk = undefined; // (lane RENDER-CPU) a new box: its slab test again
    if (en.occ !== undefined) en.occ = this.occlusionLevel(en);
  }

  /**
   * Task mall-round2 (lane PERF): the occlusion buffers of this decision — for the eye and every lit `viewpoints` entry, for each
   * storey in `levels` (every storey: buffers are built lazily, on the first candidate that needs one). A viewpoint INSIDE the storey's height
   * range gets a same-storey buffer (OCCL_BINS: nearest covering run); one above / below it a cross-storey buffer (OCCL_XBINS x
   * OCCL_XJ: per bin and run-near-distance bucket, the nearest covering run — see occludedNow). A storey a viewpoint cannot decide
   * (inside a closed column of it, outside the grid) is not decided at all. Marks occlOn per level index; false when none.
   */
  private prepareOcclusion(camera: THREE.Camera, levels: ReadonlySet<number>, inCab: boolean): boolean {
    const on = this.occlOn, NL = this.occl.length;
    on.length = NL;
    on.fill(false);
    const pts = this.occlPts;
    pts.length = 0;
    this.occlRange.length = 0;
    this.occlState = this.occlusion && this.enabled;
    if (this.occlHere !== levels) { this.occlHere.clear(); for (const l of levels) this.occlHere.add(l); }
    if (!NL || !this.occlusion || !this.enabled || inCab) return false;
    const e = this.eye;
    pts.push(e.x, e.y, e.z);
    this.occlRange.push(Infinity);
    for (const v of this.viewpoints) {
      // a dark / hidden light draws no shadow pass: its sight keeps nothing
      if (!v.visible || (v as THREE.Light).isLight && (v as THREE.Light).intensity <= 0) continue;
      v.updateWorldMatrix(true, false);
      this.vp.setFromMatrixPosition(v.matrixWorld);
      pts.push(this.vp.x, this.vp.y, this.vp.z);
      // a light's shadow camera reaches its distance only (three: SpotLightShadow far = light.distance)
      const d = (v as THREE.SpotLight).isLight ? (v as THREE.SpotLight).distance ?? 0 : 0;
      this.occlRange.push(d > 0 ? d : Infinity);
    }
    const {W, H} = this.cols, np = pts.length / 3;
    if (np > 4) return false; // (buffer slots: 4 viewpoints per storey)
    let any = false;
    for (const id of levels) {
      const k = this.levelIds.indexOf(id), o = this.occl[k];
      if (!o) continue;
      let ok = true;
      for (let p = 0; p < np && ok; p++) {
        const py = pts[3 * p + 1];
        if (py <= o.lo || py >= o.hi) continue; // cross-storey: decided from anywhere
        const cx = Math.floor(pts[3 * p] / CELL), cy = Math.floor(pts[3 * p + 2] / CELL);
        ok = cx >= 0 && cy >= 0 && cx < W && cy < H && o.closed[cy * W + cx] === 0;
      }
      if (!ok) continue;
      on[k] = true; // (its buffers are built on first use: occlBuffer)
      any = true;
    }
    this.occlStamp++;
    if (any) this.viewWedge(camera);
    return any;
  }

  /**
   * The camera's frustum as an azimuth range [occlW0, occlW1] (rad, + a margin), or the full circle when it holds the vertical:
   * buffers are rasterized only there (an unrasterized bin is open — never hides anything; candidates outside the frustum are not
   * decided at all).
   */
  private viewWedge(camera: THREE.Camera): void {
    const me = camera.matrixWorld.elements, cam = camera as THREE.PerspectiveCamera;
    this.occlW0 = -Infinity; this.occlW1 = Infinity;
    if (!cam.isPerspectiveCamera) return;
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / (cam.zoom || 1), th = tv * cam.aspect;
    const rl = Math.hypot(me[0], me[1], me[2]) || 1, ul = Math.hypot(me[4], me[5], me[6]) || 1, fl = Math.hypot(me[8], me[9], me[10]) || 1;
    const rx = me[0] / rl, ry = me[1] / rl, rz = me[2] / rl, ux = me[4] / ul, uy = me[5] / ul, uz = me[6] / ul;
    const fx = -me[8] / fl, fy = -me[9] / fl, fz = -me[10] / fl;
    // the vertical (up or down) inside the view cone: its ground projection is every azimuth
    for (const sg of [1, -1]) { const z = sg * fy; if (z > 0 && Math.abs(sg * ry) <= th * z && Math.abs(sg * uy) <= tv * z) return; }
    const af = Math.atan2(fz, fx);
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < 4; c++) {
      const sx = c & 1 ? th : -th, sy = c & 2 ? tv : -tv;
      const dx = fx + rx * sx + ux * sy, dz = fz + rz * sx + uz * sy;
      let a = Math.atan2(dz, dx) - af;
      a -= TAU * Math.round(a / TAU);
      if (a < lo) lo = a; if (a > hi) hi = a;
    }
    if (hi - lo + 2 * OCCL_WEDGE_MARGIN >= Math.PI) return;
    this.occlW0 = af + lo - OCCL_WEDGE_MARGIN; this.occlW1 = af + hi + OCCL_WEDGE_MARGIN;
    this.occlWv[0] = Math.cos(this.occlW0); this.occlWv[1] = Math.sin(this.occlW0); this.occlWv[2] = Math.cos(this.occlW1); this.occlWv[3] = Math.sin(this.occlW1);
  }

  /** A run (relative endpoints) lies wholly beyond one boundary ray of the view wedge (< pi): it can cover no wedge bin. */
  private outsideWedge(ax: number, az: number, bx: number, bz: number): boolean {
    if (!Number.isFinite(this.occlW0)) return false;
    const w = this.occlWv;
    return (w[0] * az - w[1] * ax < 0 && w[0] * bz - w[1] * bx < 0) || (ax * w[3] - az * w[2] < 0 && bx * w[3] - bz * w[2] < 0);
  }

  /** The polar buffer of viewpoint p for level index k in this decision (built on first use). */
  private occlBuffer(k: number, p: number, same: boolean): Float32Array {
    const slot = k * 4 + p, o = this.occl[k]!, pts = this.occlPts;
    const stamp = (same ? this.occlBuilt : this.occlBuiltX);
    if (same) {
      const buf = (this.occlBufs[slot] ??= new Float32Array(OCCL_BINS));
      if (stamp[slot] !== this.occlStamp) { this.rasterRuns(buf, o.runs, pts[3 * p], pts[3 * p + 2]); stamp[slot] = this.occlStamp; }
      return buf;
    }
    const T = (this.occlX[slot] ??= new Float32Array(OCCL_XBINS * OCCL_XJ));
    if (stamp[slot] !== this.occlStamp) { this.rasterRunsX(T, o.runs, pts[3 * p], pts[3 * p + 2]); stamp[slot] = this.occlStamp; }
    return T;
  }

  /** Bin range [b0, b1] of an angular span clipped to the view wedge (b1 < b0: nothing), in an nb-bin circle (b0 may exceed nb). */
  private wedgeBins(t0: number, t1: number, nb: number): [number, number] {
    const K = nb / TAU;
    let b0 = Math.ceil((t0 + Math.PI) * K + 1e-6), b1 = Math.floor((t1 + Math.PI) * K - 1e-6) - 1;
    if (Number.isFinite(this.occlW0)) {
      // the wedge in the same unwrapped frame as [t0, t1] (t0 in [-pi, pi], t1 < t0 + 2 pi)
      let w0 = this.occlW0, w1 = this.occlW1;
      const sh = TAU * Math.round(((t0 + t1) / 2 - (w0 + w1) / 2) / TAU);
      w0 += sh; w1 += sh;
      b0 = Math.max(b0, Math.floor((w0 + Math.PI) * K));
      b1 = Math.min(b1, Math.ceil((w1 + Math.PI) * K));
    }
    return [b0, b1];
  }

  /**
   * Same-storey polar buffer from (px, pz): bin = the smallest distance by which some boundary run covering the WHOLE bin is crossed
   * by every ray of the bin (a straight run at perpendicular distance p in direction phi is crossed at p / cos(theta - phi): largest
   * at one of the bin's edges).
   */
  private rasterRuns(buf: Float32Array, runs: Float64Array, px: number, pz: number): void {
    buf.fill(Infinity);
    const NB = OCCL_BINS, CE = OCCL_EDGES.cos, SE = OCCL_EDGES.sin;
    for (let r = 0; r < runs.length; r += 4) {
      const ax = runs[r] - px, az = runs[r + 1] - pz, bx = runs[r + 2] - px, bz = runs[r + 3] - pz;
      const cross = ax * bz - az * bx;
      if (Math.abs(cross) < 1e-9 || this.outsideWedge(ax, az, bx, bz)) continue; // edge-on (the viewpoint on its line) / out of view
      const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez);
      let nx = -ez / len, nz = ex / len, pd = ax * nx + az * nz;
      if (pd < 0) { nx = -nx; nz = -nz; pd = -pd; }
      let t0 = Math.atan2(az, ax), t1 = Math.atan2(bz, bx);
      if (cross < 0) { const t = t0; t0 = t1; t1 = t; }
      if (t1 < t0) t1 += TAU;
      const [b0, b1] = this.wedgeBins(t0, t1, NB);
      for (let b = b0; b <= b1; b++) {
        const i = ((b % NB) + NB) % NB;
        const c = Math.min(CE[i] * nx + SE[i] * nz, CE[i + 1] * nx + SE[i + 1] * nz);
        if (c <= 1e-9) continue;
        const d = pd / c;
        if (d < buf[i]) buf[i] = d;
      }
    }
  }

  /**
   * Cross-storey polar buffer from (px, pz): T[bin * OCCL_XJ + j] = the smallest per-bin FAR crossing distance of a run covering the
   * whole bin whose per-bin NEAR crossing distance is at least j * OCCL_XS (bucketed, then suffix minima over j).
   */
  private rasterRunsX(T: Float32Array, runs: Float64Array, px: number, pz: number): void {
    T.fill(Infinity);
    const NB = OCCL_XBINS, J = OCCL_XJ, CE = OCCL_XEDGES.cos, SE = OCCL_XEDGES.sin, K = NB / TAU;
    for (let r = 0; r < runs.length; r += 4) {
      const ax = runs[r] - px, az = runs[r + 1] - pz, bx = runs[r + 2] - px, bz = runs[r + 3] - pz;
      const cross = ax * bz - az * bx;
      if (Math.abs(cross) < 1e-9 || this.outsideWedge(ax, az, bx, bz)) continue;
      const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez);
      let nx = -ez / len, nz = ex / len, pd = ax * nx + az * nz;
      if (pd < 0) { nx = -nx; nz = -nz; pd = -pd; }
      const bf = ((Math.floor((Math.atan2(nz, nx) + Math.PI) * K) % NB) + NB) % NB; // the bin holding the foot of the perpendicular
      let t0 = Math.atan2(az, ax), t1 = Math.atan2(bz, bx);
      if (cross < 0) { const q = t0; t0 = t1; t1 = q; }
      if (t1 < t0) t1 += TAU;
      const [b0, b1] = this.wedgeBins(t0, t1, NB);
      for (let b = b0; b <= b1; b++) {
        const i = ((b % NB) + NB) % NB;
        const c0 = CE[i] * nx + SE[i] * nz, c1 = CE[i + 1] * nx + SE[i + 1] * nz, lo = Math.min(c0, c1);
        if (lo <= 1e-9) continue;
        const far = pd / lo, near = i === bf ? pd : pd / Math.max(c0, c1);
        const k = i * J + Math.min(J - 1, Math.floor(near / OCCL_XS));
        if (far < T[k]) T[k] = far;
      }
    }
    // suffix minima over the buckets, only where runs were rasterized (the view wedge; elsewhere every bin stays open)
    let s0 = 0, s1 = OCCL_XBINS - 1;
    if (Number.isFinite(this.occlW0)) { s0 = Math.floor((this.occlW0 + Math.PI) * OCCL_XBINS / TAU) - 1; s1 = Math.ceil((this.occlW1 + Math.PI) * OCCL_XBINS / TAU) + 1; }
    for (let q = s0; q <= s1; q++) {
      const b = ((q % OCCL_XBINS) + OCCL_XBINS) % OCCL_XBINS;
      for (let j = J - 2, i = b * J + j; j >= 0; j--, i--) if (T[i + 1] < T[i]) T[i] = T[i + 1];
    }
  }

  /**
   * Whether an occlusion candidate is hidden from every viewpoint of the last prepareOcclusion (see OCCL_*). Only meshes in the
   * eye's frustum are decided (the renderer frustum-culls the rest; a mesh turning into view is drawn until the next decision).
   * Cross-storey (the viewpoint above / below the mesh's storey range [lo, hi]): a ray to a point P of the box is inside the range
   * only over its last part, from the horizontal distance f(P) * |P| on (f = (lo - eye y) / (P.y - eye y) from below, (eye y - hi) /
   * (eye y - P.y) from above; largest at the box's lowest / highest point: fmax); a storey run crossed there enters a closed column.
   * So a bin is blocked when a run covering it lies between fmax * (the footprint's far distance) and its near distance.
   */
  private occludedNow(en: Entry): boolean {
    const k = en.occ!;
    if (k === -1) return false;
    this.box.min.set(en.x0, en.y0, en.z0); this.box.max.set(en.x1, en.y1, en.z1);
    if (!this.fr.intersectsBox(this.box)) return false;
    if (k >= 0) return this.occlOn[k] ? this.hiddenSlice(en, k, en.y0, en.y1) : false;
    // slices: every storey range the box reaches must hide its part of the box; a part above every range (roof) is never hidden
    if (en.y1 > this.occlTopHi) return false;
    for (let q = 0; q < this.occl.length; q++) {
      const o = this.occl[q]!;
      const y0 = Math.max(en.y0, o.lo), y1 = Math.min(en.y1, o.hi);
      if (y0 > y1) continue;
      if (!((en.occMask! >> q) & 1) || !this.occlOn[q] || !this.hiddenSlice(en, q, y0, y1)) return false;
    }
    return true;
  }

  /** Whether the part y0..y1 (inside storey q's range) of an entry's box is hidden from every viewpoint by storey q's closed columns. */
  private hiddenSlice(en: Entry, k: number, sy0: number, sy1: number): boolean {
    const x0 = en.x0 - OCCL_PAD, x1 = en.x1 + OCCL_PAD, z0 = en.z0 - OCCL_PAD, z1 = en.z1 + OCCL_PAD;
    const pts = this.occlPts, np = pts.length / 3, o = this.occl[k]!;
    for (let p = 0; p < np; p++) {
      const px = pts[3 * p], py = pts[3 * p + 1], pz = pts[3 * p + 2];
      if (px >= x0 && px <= x1 && pz >= z0 && pz <= z1) return false;
      const dx = Math.max(x0 - px, 0, px - x1), dz = Math.max(z0 - pz, 0, pz - z1);
      const near = Math.sqrt(dx * dx + dz * dz) - 1e-4;
      if (near > this.occlRange[p]) continue; // beyond this light's shadow camera: it never draws the mesh
      const same = py > o.lo && py < o.hi;
      let j = 0;
      if (!same) {
        const den = py <= o.lo ? sy0 - py : py - sy1;
        if (den <= 1e-6) return false;
        const fmax = (py <= o.lo ? o.lo - py : py - o.hi) / den;
        const fx = Math.max(Math.abs(x0 - px), Math.abs(x1 - px)), fz = Math.max(Math.abs(z0 - pz), Math.abs(z1 - pz));
        j = Math.floor(fmax * Math.sqrt(fx * fx + fz * fz) / OCCL_XS) + 1;
        if (fmax >= 1 || j >= OCCL_XJ) return false;
      }
      // the footprint excludes the viewpoint: its angular span (< pi) around the direction to its centre, no wrap-around
      const tc = Math.atan2((z0 + z1) / 2 - pz, (x0 + x1) / 2 - px), cs = Math.cos(tc), sn = Math.sin(tc);
      let a0 = Infinity, a1 = -Infinity;
      for (let c = 0; c < 4; c++) {
        const rx = (c & 1 ? x1 : x0) - px, rz = (c & 2 ? z1 : z0) - pz;
        const a = Math.atan2(rz * cs - rx * sn, rx * cs + rz * sn);
        if (a < a0) a0 = a; if (a > a1) a1 = a;
      }
      const NB = same ? OCCL_BINS : OCCL_XBINS, K = NB / TAU;
      const buf = this.occlBuffer(k, p, same), stride = same ? 1 : OCCL_XJ;
      const b0 = Math.floor((tc + a0 + Math.PI) * K), b1 = Math.floor((tc + a1 + Math.PI) * K);
      for (let b = b0; b <= b1; b++) {
        const i = ((b % NB) + NB) % NB;
        if (buf[i * stride + j] >= near) return false; // a ray into the footprint may reach it before any wall
      }
    }
    return true;
  }

  /** Between full updates: re-decide the occlusion candidates when the eye / a viewpoint moved (exact per frame). */
  private refreshOcclusion(camera: THREE.Camera): void {
    if (!this.occl.length) return;
    const prev = this.occlPts, e = this.eye;
    let moved = (this.occlusion && this.enabled) !== this.occlState
      || Math.abs(prev[0] - e.x) > OCCL_MOVE || Math.abs(prev[1] - e.y) > OCCL_MOVE || Math.abs(prev[2] - e.z) > OCCL_MOVE;
    let n = 3;
    for (const v of this.viewpoints) {
      if (moved) break;
      if (!v.visible || (v as THREE.Light).isLight && (v as THREE.Light).intensity <= 0) continue;
      v.updateWorldMatrix(true, false);
      this.vp.setFromMatrixPosition(v.matrixWorld);
      moved = n + 2 >= prev.length || Math.abs(prev[n] - this.vp.x) > OCCL_MOVE || Math.abs(prev[n + 1] - this.vp.y) > OCCL_MOVE || Math.abs(prev[n + 2] - this.vp.z) > OCCL_MOVE;
      n += 3;
    }
    if (!moved && n !== prev.length && prev.length) moved = true; // a light switched on / off
    if (!moved) return; // the last decision stands
    this.prepareOcclusion(camera, this.occlHere, this.last.ov !== null);
    let occl = 0, culled = 0;
    this.dynParents.clear();
    for (const en of this.entries) {
      if (en.mw) this.refreshBox(en);
      if (en.base && en.occ !== undefined && en.occ !== -1) {
        const hide = this.occludedNow(en);
        if (hide !== !!en.occluded) {
          en.occluded = hide;
          if (hide) { en.mask = en.obj.layers.mask; en.obj.layers.set(CULL_LAYER); en.culled = true; } else { en.obj.layers.mask = en.mask; en.culled = false; }
        }
      }
      if (en.occluded) occl++;
      if (en.culled) culled++;
    }
    this.occlusionCulled = occl;
    this.stats.culled = culled;
  }

  /** Task track3 (lane PERF): per storey floor plane, the cells open across it (summed-area table, (W + 1) x (H + 1)). */
  private buildSlabs(see: readonly SeeRect[]): void {
    const {W, H} = this.cols;
    const base = Math.min(...this.levels.map(l => l.baseY));
    const planes = [...new Set(this.levels.map(l => l.baseY).filter(y => y > base + 1))].sort((a, b) => a - b);
    const lo: number[] = [], hi: number[] = [], ord: number[] = [];
    for (const Y0 of planes) {
      // Task track3 (lane ARCH): the plane lies SLAB_DROP inside the slab under storey floor Y0 (a mesh starting on that floor is
      // strictly above it, so the storey right above the eye can be slab-culled too); a band reaching into it stays open below.
      const Y = Y0 - SLAB_DROP;
      // (task studio-skywalk-variety, lane PERF: a rect with a height range is open across the planes it straddles only)
      const seeMask = seeMaskOf(see, W, H, r => (r.y0 ?? -Infinity) < Y && (r.y1 ?? Infinity) > Y);
      const sat = new Int32Array((W + 1) * (H + 1));
      for (let cy = 0; cy < H; cy++) {
        let row = 0;
        for (let cx = 0; cx < W; cx++) {
          const i = cy * W + cx;
          let open = seeMask[i] === 1;
          if (!open) {
            lo.length = hi.length = ord.length = 0;
            for (let k = 0; k < this.cols.count(i); k++) {
              const g = this.levels[this.cols.level(i, k)].grid;
              if (g.cells[i] !== FLOOR && g.cells[i] !== VOID) continue;
              const ra = ramp(g, i);
              ord.push(lo.length); lo.push(ra ? ra[0] : g.floorOf(i)); hi.push(ra ? ra[1] : cellCeil(g, i));
            }
            ord.sort((a, b) => lo[a] - lo[b]);
            // merged free intervals (bands meeting at a joint are one open space: no floor / ceiling is drawn there)
            let a = Infinity, b = -Infinity;
            for (const q of ord) {
              if (lo[q] > b + 0.02) { if (a < Y - SLAB_EPS && b > Y + SLAB_EPS) { open = true; break; } a = lo[q]; b = hi[q]; } else b = Math.max(b, hi[q]);
            }
            if (!open && a < Y - SLAB_EPS && b > Y + SLAB_EPS) open = true;
          }
          if (open) row++;
          sat[(cy + 1) * (W + 1) + cx + 1] = sat[cy * (W + 1) + cx + 1] + row;
        }
      }
      this.slabPlanes.push(Y);
      this.slabOpen.push(sat);
    }
  }

  /** Task track3 (lane PERF): whether a floor plane between the eye and the whole box blocks every ray to it (see SLAB_EPS). */
  private slabHidden(en: Entry, e: THREE.Vector3): boolean {
    const {W, H} = this.cols;
    for (let p = 0; p < this.slabPlanes.length; p++) {
      const Y = this.slabPlanes[p];
      const up = e.y < Y - SLAB_EPS && en.y0 > Y + SLAB_EPS, down = e.y > Y + SLAB_EPS && en.y1 < Y - SLAB_EPS;
      if (!up && !down) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let c = 0; c < 8; c++) {
        const px = c & 1 ? en.x1 : en.x0, py = c & 2 ? en.y1 : en.y0, pz = c & 4 ? en.z1 : en.z0;
        const t = (Y - e.y) / (py - e.y);
        const x = e.x + (px - e.x) * t, z = e.z + (pz - e.z) * t;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL), cy0 = Math.floor(z0 / CELL), cy1 = Math.floor(z1 / CELL);
      if (cx0 < 0 || cy0 < 0 || cx1 >= W || cy1 >= H) continue; // leaves the grid: never culled by this plane
      const s = this.slabOpen[p], R = W + 1;
      const open = s[(cy1 + 1) * R + cx1 + 1] - s[cy0 * R + cx1 + 1] - s[(cy1 + 1) * R + cx0] + s[cy0 * R + cx0];
      if (open === 0) return true;
    }
    return false;
  }

  /**
   * Portal tiles between every pair of levels (columns whose free band reaches both walking zones, and stair-run columns
   * shared by both grids). One pass over the columns; per pair, tiles keep the column order of the iteration-08 loop.
   */
  private buildPortals(atrium?: Uint8Array): void {
    const {W, H} = this.cols;
    const L = this.levels, NL = L.length;
    const zone = L.map(l => [l.baseY + ZONE[0], l.baseY + ZONE[1]] as const);
    const pairTiles = new Map<number, Map<number, Tile>>();
    const lo = new Float64Array(NL * NL).fill(Infinity), hi = new Float64Array(NL * NL).fill(-Infinity);
    const touched: number[] = [];
    const bandLo: number[] = [], bandHi: number[] = [], reach: number[] = [], open: number[] = [];
    const aTiles = new Map<number, AtriumTile & {mask: number}>();
    for (let i = 0; i < W * H; i++) {
      const cnt = this.cols.count(i);
      if (!cnt) continue;
      // Task track3 (lane ARCH): an atrium column joins every level its free bands reach in ONE atrium tile (no pair tiles).
      if (atrium && atrium[i]) {
        let mask = 0, y0 = Infinity, y1 = -Infinity;
        for (let k = 0; k < cnt; k++) {
          const g = L[this.cols.level(i, k)].grid;
          if (g.cells[i] !== FLOOR && g.cells[i] !== VOID) continue;
          const ra = ramp(g, i), f = ra ? ra[0] : g.floorOf(i), c = ra ? ra[1] : cellCeil(g, i);
          y0 = Math.min(y0, f); y1 = Math.max(y1, c);
          for (let a = 0; a < NL; a++) if (f <= zone[a][1] && c >= zone[a][0]) mask |= 1 << a;
        }
        if (mask) {
          const cx = i % W, cy = (i - cx) / W, key = Math.floor(cy / TILE) * 100000 + Math.floor(cx / TILE);
          let t = aTiles.get(key);
          if (!t) aTiles.set(key, (t = {x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity, cells: [], levels: [], mask: 0}));
          t.x0 = Math.min(t.x0, cx * CELL); t.x1 = Math.max(t.x1, (cx + 1) * CELL);
          t.z0 = Math.min(t.z0, cy * CELL); t.z1 = Math.max(t.z1, (cy + 1) * CELL);
          t.y0 = Math.min(t.y0, y0); t.y1 = Math.max(t.y1, y1);
          t.cells.push(i);
          t.mask |= mask;
        }
        continue;
      }
      touched.length = 0;
      const hit = (a: number, b: number, y0: number, y1: number) => {
        const k = a * NL + b;
        if (lo[k] === Infinity) touched.push(k);
        if (y0 < lo[k]) lo[k] = y0;
        if (y1 > hi[k]) hi[k] = y1;
      };
      bandLo.length = bandHi.length = 0;
      for (let k = 0; k < cnt; k++) {
        const g = L[this.cols.level(i, k)].grid;
        if (g.cells[i] !== FLOOR && g.cells[i] !== VOID) continue;
        // A flight's column sweeps its whole pitch: test its lowest floor / highest ceiling.
        const ra = ramp(g, i);
        bandLo.push(ra ? ra[0] : g.floorOf(i)); bandHi.push(ra ? ra[1] : cellCeil(g, i));
      }
      // a band reaching the walking zones of several levels joins each pair of them
      for (let q = 0; q < bandLo.length; q++) {
        const y0 = bandLo[q], y1 = bandHi[q];
        reach.length = 0;
        for (let a = 0; a < NL; a++) if (y0 <= zone[a][1] && y1 >= zone[a][0]) reach.push(a);
        for (let x = 0; x < reach.length; x++) for (let y = x + 1; y < reach.length; y++) hit(reach[x], reach[y], y0, y1);
      }
      // Iteration 12 (ARCH): every column of a stair run shared by both grids joins the two levels.
      open.length = 0;
      for (let a = 0; a < NL; a++) if (isOpen(L[a].grid, i)) open.push(a);
      for (let x = 0; x < open.length; x++) for (let y = x + 1; y < open.length; y++) {
        const a = open[x], b = open[y];
        if (sharedColumn(L[a].grid, L[b].grid, i)) { const [y0, y1] = bandOf(L[a].grid, i); hit(a, b, y0, y1); }
      }
      if (!touched.length) continue;
      const cx = i % W, cy = (i - cx) / W;
      const key = Math.floor(cy / TILE) * 100000 + Math.floor(cx / TILE);
      for (const k of touched) {
        const a = Math.floor(k / NL), b = k - a * NL;
        let m = pairTiles.get(k);
        if (!m) pairTiles.set(k, (m = new Map()));
        let t = m.get(key);
        if (!t) m.set(key, (t = {a: L[a].id, b: L[b].id, x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, y0: lo[k], y1: hi[k], cells: []}));
        t.x0 = Math.min(t.x0, cx * CELL); t.x1 = Math.max(t.x1, (cx + 1) * CELL);
        t.z0 = Math.min(t.z0, cy * CELL); t.z1 = Math.max(t.z1, (cy + 1) * CELL);
        t.y0 = Math.min(t.y0, lo[k]); t.y1 = Math.max(t.y1, hi[k]);
        t.cells.push(i);
        lo[k] = Infinity; hi[k] = -Infinity;
      }
    }
    for (const k of [...pairTiles.keys()].sort((p, q) => p - q)) this.tiles.push(...pairTiles.get(k)!.values());
    for (const k of [...aTiles.keys()].sort((p, q) => p - q)) {
      const t = aTiles.get(k)!;
      for (let a = 0; a < NL; a++) if ((t.mask >> a) & 1) t.levels.push(L[a].id);
      this.atriumTiles.push({x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1, y0: t.y0, y1: t.y1, cells: t.cells, levels: t.levels});
    }
    this.atriumVis = new Uint8Array(this.atriumTiles.length);
    this.atriumStats.tiles = this.atriumTiles.length;
  }

  /** Task track3 (lane ARCH): atrium tiles of this culler (mall only). */
  get atriumTileCount(): number { return this.atriumTiles.length; }

  get portalTiles(): number { return this.tiles.length; }

  /**
   * Register every mesh under `root` (call once per station after building). Level = userData.level
   * (builder / stock chunks), else the level holding its box centre when the box fits one level band.
   */
  register(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      this.stats.registered++;
      const im = m as THREE.InstancedMesh;
      // Task mall-round2 (lane PERF): a dynamic-bounds mesh (mall only) registers even while empty / pooled (see Entry.dyn)
      const dyn = this.occl.length > 0 && m.userData.dynamicBounds === true;
      if (im.isInstancedMesh) {
        if ((im.count === 0 || m.frustumCulled === false) && !dyn) { this.stats.uncullable++; return; }
        if (!dyn || !im.boundingBox) im.computeBoundingBox();
        this.box.copy(im.boundingBox!).applyMatrix4(m.matrixWorld);
      } else this.box.setFromObject(m);
      if (this.box.isEmpty() && !dyn) { this.stats.uncullable++; return; }
      const b = this.box, entry = {obj: m, level: NaN, x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z, y0: b.min.y, y1: b.max.y, mask: m.layers.mask, culled: false} as Entry;
      if (dyn) { entry.dyn = true; entry.empty = b.isEmpty(); }
      // Task mall-round2 (lane PERF): the mall tracks moved meshes, InstancedMesh bounds growth (a reattached loose prop) and the
      // occlusion test (refreshBox)
      if (this.occl.length) {
        entry.mw = Float32Array.from(m.matrixWorld.elements);
        if (im.isInstancedMesh) { const lb = im.boundingBox!; entry.lb = Float64Array.of(lb.min.x, lb.min.y, lb.min.z, lb.max.x, lb.max.y, lb.max.z); }
      }
      // Task office-seamless-20261029: a mesh tagged with several levels (stair flights) renders with any of them.
      const tag = Array.isArray(m.userData.levels) ? (m.userData.levels as unknown[]).filter((l): l is number => typeof l === 'number' && this.levelIds.includes(l)) : [];
      if (tag.length) { entry.levels = tag; this.stats.multi++; if (this.occl.length) entry.occ = this.occlusionLevel(entry); this.entries.push(entry); return; }
      let level = typeof m.userData.level === 'number' ? m.userData.level : NaN;
      // Task mall-playtest-revision-20261031 (lane ARCH, mall only: the culler has atrium tiles): an untagged mesh whose box sits in
      // ONE storey's y band takes that storey — its box centre can lie in a wall / another area of a smaller mall (a 12 m dressing
      // chunk 'purpose-8,3|panel' on floor 1 resolved to the station by levelAt and was culled while 87 px visible). The mall's
      // storeys are distinct y bands (no split levels); Subway / Office keep the levelAt rule below.
      if (Number.isNaN(level) && this.atriumTiles.length) {
        const byY = [...this.levels].sort((p, q) => p.baseY - q.baseY);
        const band = (y: number) => { let id = byY[0]?.id ?? 0; for (const l of byY) if (y >= l.baseY - 0.3) id = l.id; return id; };
        const lo = band(b.min.y + 0.05), hi = band(Math.max(b.min.y + 0.05, b.max.y - 0.05));
        if (lo === hi && b.max.y - b.min.y <= 4.5) level = lo;
      }
      if (Number.isNaN(level)) {
        const lo = this.levelAt((b.min.x + b.max.x) / 2, b.min.y + 0.05, (b.min.z + b.max.z) / 2);
        const hi = this.levelAt((b.min.x + b.max.x) / 2, b.max.y - 0.05, (b.min.z + b.max.z) / 2);
        if (lo !== hi || b.max.y - b.min.y > 4.5) {
          // Iteration 08: never level-culled. Tall stacks: render with every level whose storey (base .. base + 4.5 m) it spans.
          const span = this.levels.length > LEGACY_STACK ? this.levels.filter(l => l.baseY <= b.max.y + 0.3 && l.baseY + 4.5 >= b.min.y).map(l => l.id) : [];
          // Task studio-skywalk-variety (lane PERF): a small stack WITH occlusion data and window tiles (the Skyways) keeps it as an
          // unlevelled entry — fog, slab planes and per-storey slices decide it (never level-culled, as before)
          if (!span.length && this.occl.length && this.winTiles.length) { entry.occ = this.occlusionLevel(entry); this.entries.push(entry); return; }
          if (!span.length || span.length === this.levels.length) { this.stats.uncullable++; return; }
          entry.levels = span; this.stats.multi++; if (this.occl.length) entry.occ = this.occlusionLevel(entry); this.entries.push(entry); return;
        }
        level = lo;
      }
      // Not a station level (e.g. builder STAIR_LEVEL flights, seen from both levels): fog culling only.
      entry.level = this.levelIds.includes(level) ? level : NaN;
      // Task mall-round2 (lane ARCH, M09): a street exit's meshes carry their glazed opening (mall only; never set elsewhere)
      const ap = m.userData.aperture as ExitAperture | undefined;
      if (ap && [ap.plane, ap.s0, ap.s1, ap.y0, ap.y1, ap.nx, ap.nz].every(Number.isFinite)) entry.aperture = ap;
      if (this.occl.length) entry.occ = this.occlusionLevel(entry); // task mall-round2 (lane PERF), mall only
      this.entries.push(entry);
    });
  }

  /** Re-evaluate for the camera (cheap; skipped while the camera does not move). */
  update(camera: THREE.Camera, force = false): void {
    if (!this.entries.length) return;
    camera.updateMatrixWorld();
    const e = this.eye.setFromMatrixPosition(camera.matrixWorld);
    const q = camera.quaternion, l = this.last;
    const ov = this.eyeOverride !== null && this.levelIds.includes(this.eyeOverride) ? this.eyeOverride : null;
    if (!force && ov === l.ov && Math.abs(e.x - l.x) < 0.25 && Math.abs(e.y - l.y) < 0.15 && Math.abs(e.z - l.z) < 0.25
      && Math.abs(q.x - l.qx) + Math.abs(q.y - l.qy) + Math.abs(q.z - l.qz) + Math.abs(q.w - l.qw) < 0.02) { this.refreshOcclusion(camera); this.decideTracked(camera); return; }
    l.x = e.x; l.y = e.y; l.z = e.z; l.qx = q.x; l.qy = q.y; l.qz = q.z; l.qw = q.w; l.ov = ov;
    this.notePosition(e, ov);
    let camLevel = ov ?? this.levelAt(e.x, e.y, e.z);
    if (ov === null && this.solidColumn(e) && this.lastOpenLevel >= 0) camLevel = this.lastOpenLevel; // (inside a wall: keep the storey)
    else this.lastOpenLevel = camLevel;
    // Iteration 12 (ARCH): every level whose band holds the eye is current (a shared stair run = both). An override
    // (the eye in the elevator cab) is the only current level.
    const here = ov !== null ? this.onlyLevel(ov) : this.eyeLevels(e, camLevel);
    this.stats.level = camLevel;
    this.stats.levels = [...here];
    // Visible portal tiles from the camera's level(s), per other level. (lane RENDER-CPU: reused map / set; lists emptied)
    const vis = this.visTiles;
    for (const list of vis.values()) list.length = 0;
    const shown = this.shownSet;
    shown.clear();
    for (const l of here) shown.add(l);
    let tested = 0, visible = 0, hops = 0;
    if (this.enabled) {
      this.pm.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
      this.fr.setFromProjectionMatrix(this.pm);
      const seen = (t: Tile, k: number): boolean => {
        const dx = Math.max(t.x0 - e.x, 0, e.x - t.x1), dz = Math.max(t.z0 - e.z, 0, e.z - t.z1);
        if (dx * dx + dz * dz > PORTAL_MAX_DIST * PORTAL_MAX_DIST) return false;
        this.box.min.set(t.x0, t.y0, t.z0); this.box.max.set(t.x1, t.y1, t.z1);
        // Right beside the tile (just off a run's end): visible without frustum / sight tests.
        const inside = dx * dx + dz * dz <= PORTAL_NEAR * PORTAL_NEAR && e.y >= t.y0 - 0.5 && e.y <= t.y1 + 0.5;
        if (!inside && !this.fr.intersectsBox(this.box)) return false;
        tested++;
        if (!inside && !this.tileSees(k, t, e)) return false;
        visible++;
        return true;
      };
      const add = (other: number, t: Tile) => { let list = vis.get(other); if (!list) vis.set(other, (list = [])); list.push(t); };
      // Task track3 (lane ARCH): the atrium first (mall only): its levels join `shown` before the pair-portal hops.
      if (this.atriumTiles.length) this.updateAtrium(e, shown, ov !== null);
      // Task studio-skywalk-variety (lane PERF): the storeys seen through glass (Skyways only) join `shown` before the hops too
      if (this.winTiles.length) {
        const me0 = camera.matrixWorld.elements, f0 = Math.hypot(me0[8], me0[9], me0[10]) || 1;
        this.updateAir(e, shown, here, -me0[8] / f0, -me0[9] / f0, -me0[10] / f0);
      }
      // Breadth-first over levels (iteration 12: one extra hop, the lower level down the second run of a stair core seen
      // from the upper landing; task office-seamless-20261029: as many hops as storeys, e.g. up a scissor stair). A hop
      // tests the tiles with exactly one side among the levels shown so far; each tile's test runs at most once.
      if (this.tileMemo.length !== this.tiles.length) this.tileMemo = new Int8Array(this.tiles.length);
      const memo = this.tileMemo;
      memo.fill(0);
      const before = this.hopSet;
      for (let added = true; added && hops < this.levels.length;) {
        added = false;
        before.clear();
        for (const l of shown) before.add(l);
        for (let k = 0; k < this.tiles.length; k++) {
          const t = this.tiles[k];
          const ha = before.has(t.a), hb = before.has(t.b);
          if (ha === hb) continue; // neither level is shown yet, or both already are
          if (!memo[k]) memo[k] = seen(t, k) ? 1 : -1;
          if (memo[k] < 0) continue;
          const other = ha ? t.b : t.a;
          add(other, t);
          if (!shown.has(other)) { shown.add(other); added = true; }
        }
        hops++;
      }
    }
    let culled = 0, fogged = 0, slab = 0, occl = 0;
    // Task mall-round2 (lane PERF): same-storey occlusion buffers for this update (mall only; false elsewhere / when off)
    const occlOn = this.occl.length ? this.prepareOcclusion(camera, this.allLevelIds, ov !== null) : false; // (buffers built lazily)
    // Iteration 12 (ARCH): three's FogExp2 fogs by VIEW DEPTH (-mvPosition.z), not distance: at the screen corners
    // a box 58 m away is only ~31 m deep (~17 % visible). Fog-cull a box only when its nearest point along the view
    // axis lies beyond maxDistance (conservative, so nothing still visible through the fog pops out at the edges).
    const me = camera.matrixWorld.elements;
    const fl = Math.hypot(me[8], me[9], me[10]) || 1;
    const fx = -me[8] / fl, fy = -me[9] / fl, fz = -me[10] / fl;
    const far = this.maxDistance;
    this.apertureSeenMemo.clear();
    let apCulled = 0;
    this.dynParents.clear();
    for (const en of this.entries) {
      let show: boolean;
      if (en.mw) this.refreshBox(en); // task mall-round2 (lane PERF): a moved mesh / grown InstancedMesh box first (mall only)
      if (en.empty) { en.base = false; en.occluded = false; if (en.culled) { en.obj.layers.mask = en.mask; en.culled = false; } continue; } // holds nothing
      const depth = Math.min(fx * (en.x0 - e.x), fx * (en.x1 - e.x)) + Math.min(fy * (en.y0 - e.y), fy * (en.y1 - e.y)) + Math.min(fz * (en.z0 - e.z), fz * (en.z1 - e.z));
      if (!this.enabled) show = true;
      else if (depth > far) { show = false; fogged++; } // entirely inside opaque fog
      else if (this.everyStorey) show = true; // (task studio-skywalk-variety, lane PERF: QA / tests — the slab / storey occlusion below decides)
      else if (en.levels) show = anyIn(en.levels, here) || this.nearAnyPortal(en, en.levels, vis) || this.nearAtrium(en, en.levels, NaN) || anyIn(en.levels, this.airLevels) || this.overRoofs(en);
      else if (Number.isNaN(en.level) || here.has(en.level)) show = true;
      // Another level: only near a portal tile the camera can see (task track3: or near a visible atrium tile of that level; task
      // studio-skywalk-variety, lane PERF: or any mesh of a storey seen through glass, or one rising over the roofs — Skyways only, the
      // occlusion below decides)
      else show = this.nearPortal(en, vis.get(en.level)) || this.nearAtrium(en, null, en.level) || this.airLevels.has(en.level) || this.overRoofs(en);
      // Task mall-round2 (lane ARCH, M09): a street exit's doors / street view only while its glazed opening may be seen (mall only)
      if (show && this.enabled && en.aperture && !this.apertureSeen(en.aperture, e, ov !== null)) { show = false; apCulled++; }
      // Task track3 (lane PERF): the mall's slab occlusion (no planes elsewhere: Subway / Office unchanged)
      if (show && this.enabled && this.slabs && this.slabPlanes.length && this.slabHiddenAt(en, e)) { show = false; slab++; }
      // Task mall-round2 (lane PERF): same-storey occlusion last (only meshes every other rule shows; see OCCL_*)
      if (this.occl.length) {
        en.base = show;
        en.occluded = show && occlOn && en.occ !== undefined && en.occ !== -1 && this.occludedNow(en);
        if (en.occluded) { show = false; occl++; }
      }
      if (show === !en.culled) continue;
      if (show) { en.obj.layers.mask = en.mask; en.culled = false; } else { en.mask = en.obj.layers.mask; en.obj.layers.set(CULL_LAYER); en.culled = true; }
    }
    for (const en of this.entries) if (en.culled) culled++;
    this.stats.tilesTested = tested;
    this.stats.tilesVisible = visible;
    this.stats.visibleLevels = [...shown];
    this.stats.hops = hops;
    this.stats.culled = culled;
    this.stats.fogged = fogged;
    this.slabCulled = slab;
    this.occlusionCulled = occl;
    this.apertureCulled = apCulled;
    this.decideTracked(camera);
  }

  /**
   * Task studio-reactor-submit-roof-fog-20261102 (lane CPU): decide a MOVING object every update by the box `box` reports then (world
   * space; false = none: shown). Only with the slab / storey occlusion data (the mall's and the Reactor's cullers; false elsewhere —
   * nothing tracked). The box is decided like a registered mesh tagged with EVERY level: fog distance, the slab planes, then the
   * same- / cross-storey occlusion per storey slice of the box (eye + `viewpoints`: the flashlight's shadow pass keeps what it sees).
   * The portal / atrium level rules are not applied (the box alone decides). A hidden object's meshes (collected when it hides) go
   * to CULL_LAYER and get their masks back when shown, untracked, or reset().
   */
  track(obj: THREE.Object3D, box: (out: THREE.Box3) => boolean): boolean {
    if (!this.occl.length) return false;
    if (!this.tracked.has(obj)) this.tracked.set(obj, {obj, box, meshes: [], masks: [], hidden: false});
    return true;
  }

  /** Stop deciding `obj` (shown again). */
  untrack(obj: THREE.Object3D): void {
    const t = this.tracked.get(obj);
    if (!t) return;
    this.showTracked(t);
    this.tracked.delete(obj);
  }

  /** Objects currently tracked (QA / tests). */
  get trackedCount(): number { return this.tracked.size; }

  private showTracked(t: Tracked): void {
    if (!t.hidden) return;
    t.meshes.forEach((m, i) => { if (m.layers.mask === CULL_MASK) m.layers.mask = t.masks[i]; });
    t.meshes.length = t.masks.length = 0;
    t.hidden = false;
  }

  private decideTracked(camera: THREE.Camera): void {
    if (!this.tracked.size) { this.trackedCulled = 0; return; }
    const e = this.eye, me = camera.matrixWorld.elements, en = this.trackEntry;
    const fl = Math.hypot(me[8], me[9], me[10]) || 1;
    const fx = -me[8] / fl, fy = -me[9] / fl, fz = -me[10] / fl;
    (en as {levels: readonly number[]}).levels = this.levelIds;
    let n = 0;
    for (const t of this.tracked.values()) {
      let hide = false;
      if (this.enabled && t.box(this.box) && !this.box.isEmpty()) {
        const b = this.box;
        en.x0 = b.min.x; en.y0 = b.min.y; en.z0 = b.min.z; en.x1 = b.max.x; en.y1 = b.max.y; en.z1 = b.max.z;
        const depth = Math.min(fx * (en.x0 - e.x), fx * (en.x1 - e.x)) + Math.min(fy * (en.y0 - e.y), fy * (en.y1 - e.y)) + Math.min(fz * (en.z0 - e.z), fz * (en.z1 - e.z));
        hide = depth > this.maxDistance
          || (this.slabs && this.slabPlanes.length > 0 && this.slabHidden(en, e))
          || (this.occlusion && this.occlState && (en.occ = this.occlusionLevel(en)) !== -1 && this.occludedNow(en));
      }
      if (hide && !t.hidden) {
        t.obj.traverse(o => { if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) { t.meshes.push(o); t.masks.push(o.layers.mask); o.layers.set(CULL_LAYER); } });
        t.hidden = true;
      } else if (!hide && t.hidden) this.showTracked(t);
      if (t.hidden) n++;
    }
    this.trackedCulled = n;
  }

  /**
   * Task mall-round2-20261031 (lane ARCH, M09): whether a street exit's glazed opening may be seen from the eye this update (memoised
   * per aperture): hall side, fog distance, beside it, the opening (+ 0.6 m reveal) in the frustum, then sight rays through the free
   * bands to the hall cells in front of it. An eye in the lift cab / a glazed shaft skips the rays (they cannot start in its solid
   * cells): conservative.
   */
  private apertureSeen(a: ExitAperture, e: THREE.Vector3, inCab: boolean): boolean {
    const memo = this.apertureSeenMemo.get(a);
    if (memo !== undefined) return memo;
    const r = this.apertureTest(a, e, inCab);
    this.apertureSeenMemo.set(a, r);
    return r;
  }

  private apertureTest(a: ExitAperture, e: THREE.Vector3, inCab: boolean): boolean {
    const alongX = a.nz !== 0, n = alongX ? a.nz : a.nx;
    const sd = ((alongX ? e.z : e.x) - a.plane) * n; // signed distance, outward positive
    if (sd > 0.05) return false; // the eye is never outside; a stray override position: hidden
    const along = alongX ? e.x : e.z;
    const da = Math.max(a.s0 - along, 0, along - a.s1);
    const d2 = da * da + sd * sd;
    if (d2 > this.maxDistance * this.maxDistance) return false;
    if (d2 <= EXIT_NEAR * EXIT_NEAR && e.y >= a.y0 - 0.5 && e.y <= a.y1 + 0.5) return true;
    const p0 = a.plane, p1 = a.plane + n * 0.6;
    if (alongX) { this.box.min.set(a.s0, a.y0, Math.min(p0, p1)); this.box.max.set(a.s1, a.y1, Math.max(p0, p1)); }
    else { this.box.min.set(Math.min(p0, p1), a.y0, a.s0); this.box.max.set(Math.max(p0, p1), a.y1, a.s1); }
    if (!this.fr.intersectsBox(this.box)) return false;
    if (inCab || this.glassShafts.some(r => e.x >= r.x0 && e.x <= r.x1 && e.z >= r.z0 && e.z <= r.z1)) return true;
    // (lane RENDER-CPU) the rays depend on the eye position only: kept per eye position
    let m = this.apertureRays.get(a);
    if (!m) this.apertureRays.set(a, (m = {k: -1, v: false}));
    if (m.k !== this.posStamp) { m.v = this.apertureRaysSee(a, e, alongX, n); m.k = this.posStamp; }
    return m.v;
  }

  /** The aperture's sight rays (see apertureTest). */
  private apertureRaysSee(a: ExitAperture, e: THREE.Vector3, alongX: boolean, n: number): boolean {
    // sight: every CELL / 2 along the span (ends inset 0.1 m), to the hall cell centre in front of the plane, at four heights
    const inset = CELL / 2, ys = [Math.min(a.y1 - 0.2, Math.max(a.y0 + 0.2, e.y)), (a.y0 + a.y1) / 2, a.y0 + 0.3, a.y1 - 0.2];
    const n0 = a.s0 + 0.1, n1 = a.s1 - 0.1, steps = Math.max(1, Math.ceil((n1 - n0) / (CELL / 2)));
    for (let k = 0; k <= steps; k++) {
      const s = n0 + ((n1 - n0) * k) / steps;
      const tx = alongX ? s : a.plane - n * inset, tz = alongX ? a.plane - n * inset : s;
      for (const ty of ys) if (this.ray(e.x, e.y, e.z, tx, ty, tz)) return true;
    }
    return false;
  }

  /** The eye's level set holding just `level` (eyeOverride). */
  private onlyLevel(level: number): Set<number> {
    this.here.clear();
    this.here.add(level);
    return this.here;
  }

  /** Whether an entry's X/Z box comes within PORTAL_MARGIN of one of these visible portal tiles. */
  private nearPortal(en: Entry, list: readonly Tile[] | undefined): boolean {
    if (list) for (const t of list) {
      if (en.x1 >= t.x0 - PORTAL_MARGIN && en.x0 <= t.x1 + PORTAL_MARGIN && en.z1 >= t.z0 - PORTAL_MARGIN && en.z0 <= t.z1 + PORTAL_MARGIN) return true;
    }
    return false;
  }

  /**
   * Task track3-eaton-centre-20261031 (lane ARCH): atrium visibility for this update (frustum + distance per atrium tile, then
   * nearest-first sight tests until the void is seen). Marks atriumVis and adds the seen tiles' levels to `shown`.
   */
  private updateAtrium(e: THREE.Vector3, shown: Set<number>, inCab = false): void {
    const T = this.atriumTiles, vis = this.atriumVis, st = this.atriumStats;
    // the eye inside the glass lift car (eyeOverride): its shaft is solid on every grid, so no sight ray can start there — the
    // void beside the shaft counts as seen within ATRIUM_CAB_NEAR. Task mall-playtest-revision (lane ARCH, U07): the same for an eye
    // on a landing right in front of the glass shaft looking at it (through the open doors / the glass car to the atrium beyond:
    // the sight rays would stop in the solid shaft) — conservative: it may draw a little more near the lift, never less.
    let lobby = false;
    for (const r of this.glassShafts) {
      const dx = Math.max(r.x0 - e.x, 0, e.x - r.x1), dz = Math.max(r.z0 - e.z, 0, e.z - r.z1);
      if (dx * dx + dz * dz > GLASS_LOBBY * GLASS_LOBBY) continue;
      this.box.min.set(r.x0, e.y - 1.5, r.z0); this.box.max.set(r.x1, e.y + 1.5, r.z1);
      if (this.fr.intersectsBox(this.box)) { lobby = true; break; }
    }
    const nearR = inCab || lobby ? ATRIUM_CAB_NEAR : ATRIUM_NEAR;
    vis.fill(0);
    this.atriumLevels.clear();
    const maxD = Math.min(ATRIUM_MAX_DIST, this.maxDistance);
    const cand = this.candK, candD = this.candD, ord = this.candOrder; // (lane RENDER-CPU: reused; ord = indices sorted by distance)
    cand.length = candD.length = ord.length = 0;
    let near = false;
    for (let k = 0; k < T.length; k++) {
      const t = T[k];
      const dx = Math.max(t.x0 - e.x, 0, e.x - t.x1), dz = Math.max(t.z0 - e.z, 0, e.z - t.z1), d2 = dx * dx + dz * dz;
      if (d2 > maxD * maxD) continue;
      const beside = d2 <= nearR * nearR && e.y >= t.y0 - 0.5 && e.y <= t.y1 + 0.5;
      this.box.min.set(t.x0, t.y0, t.z0); this.box.max.set(t.x1, t.y1, t.z1);
      if (!beside && !this.fr.intersectsBox(this.box)) continue;
      vis[k] = 1;
      if (beside) near = true;
      ord.push(cand.length);
      cand.push(k); candD.push(d2);
    }
    st.inFrustum = cand.length;
    st.sightTests = 0;
    let seen = near;
    if (!seen && cand.length) {
      ord.sort((a, b) => candD[a] - candD[b] || a - b); // (as the former stable sort by distance: ties keep their tile order)
      for (let c = 0; c < ord.length && c < ATRIUM_SIGHT_TESTS && !seen; c++) {
        st.sightTests++;
        seen = this.atriumSees(cand[ord[c]], e);
      }
    }
    st.seen = seen;
    if (!seen) { vis.fill(0); st.levels = []; return; }
    for (const k of cand) for (const l of T[k].levels) { this.atriumLevels.add(l); shown.add(l); }
    st.levels = [...this.atriumLevels].sort((a, b) => a - b);
  }

  /**
   * Whether an entry of one of `levels` may show through the atrium this update (mall only). With slab occlusion (opts.slabs) the
   * storey-occluded bulk is removed exactly afterwards, so EVERY mesh of a storey the void is seen into is a candidate (no distance
   * margin: deep back-of-house slivers through distant openings are visible, the 20 m margin popped them — task track3 ARCH, the
   * PERF oracle); without slabs the ATRIUM_MARGIN rule below stands.
   */
  private nearAtrium(en: Entry, levels: readonly number[] | null, level: number): boolean {
    // (lane RENDER-CPU: `levels` — a multi-level entry — or the single `level`; no per-call arrays / closures on the hot path)
    if (!this.atriumTiles.length || !this.atriumStats.seen) return false;
    if (levels ? !anyIn(levels, this.atriumLevels) : !this.atriumLevels.has(level)) return false;
    if (this.slabPlanes.length && this.slabs) return true;
    if (!en.near) {
      const out: number[] = [];
      this.atriumTiles.forEach((t, k) => {
        if (en.x1 >= t.x0 - ATRIUM_MARGIN && en.x0 <= t.x1 + ATRIUM_MARGIN && en.z1 >= t.z0 - ATRIUM_MARGIN && en.z0 <= t.z1 + ATRIUM_MARGIN) out.push(k);
      });
      en.near = Int32Array.from(out);
    }
    const vis = this.atriumVis;
    for (let i = 0; i < en.near.length; i++) {
      const k = en.near[i];
      if (!vis[k]) continue;
      const tl = this.atriumTiles[k].levels;
      if (levels ? levels.some(l => tl.includes(l)) : tl.includes(level)) return true;
    }
    return false;
  }

  /** Lane RENDER-CPU: a multi-level entry near a visible portal tile of any of its levels (nearPortal per level, no closure). */
  private nearAnyPortal(en: Entry, levels: readonly number[], vis: ReadonlyMap<number, readonly Tile[]>): boolean {
    for (let i = 0; i < levels.length; i++) if (this.nearPortal(en, vis.get(levels[i]))) return true;
    return false;
  }

  /** The eye's grid column has no open band on any storey (inside a wall / the lift shaft's solid door wall). Off the grid: false. */
  private solidColumn(e: THREE.Vector3): boolean {
    const cx = Math.floor(e.x / CELL), cy = Math.floor(e.z / CELL);
    return cx >= 0 && cy >= 0 && cx < this.cols.W && cy < this.cols.H && this.cols.count(cy * this.cols.W + cx) === 0;
  }

  /**
   * Lane RENDER-CPU: a new eye position (or override) starts a new stamp of the position-only caches (slab tests, sight rays). Exact:
   * a cached result is reused only for the identical eye coordinates it was computed at.
   */
  private notePosition(e: THREE.Vector3, ov: number | null): void {
    const p = this.posEye, o = ov ?? -1;
    if (p[0] === e.x && p[1] === e.y && p[2] === e.z && p[3] === o) return;
    p[0] = e.x; p[1] = e.y; p[2] = e.z; p[3] = o;
    this.posStamp++;
  }

  /** Lane RENDER-CPU: slabHidden for a registered entry, kept per eye position (Entry.sk / sh; a box change clears it). */
  private slabHiddenAt(en: Entry, e: THREE.Vector3): boolean {
    if (en.sk !== this.posStamp) { en.sh = this.slabHidden(en, e); en.sk = this.posStamp; }
    return en.sh!;
  }

  /** Lane RENDER-CPU: `sees` for portal tile k, kept per eye position. */
  private tileSees(k: number, t: Tile, e: THREE.Vector3): boolean {
    if (this.tileSeeK.length !== this.tiles.length) { this.tileSeeK = new Int32Array(this.tiles.length).fill(-1); this.tileSeeV = new Uint8Array(this.tiles.length); }
    if (this.tileSeeK[k] !== this.posStamp) { this.tileSeeV[k] = this.sees(e, t) ? 1 : 0; this.tileSeeK[k] = this.posStamp; }
    return this.tileSeeV[k] === 1;
  }

  /** Lane RENDER-CPU: `sees` for atrium tile k, kept per eye position. */
  private atriumSees(k: number, e: THREE.Vector3): boolean {
    const T = this.atriumTiles;
    if (this.atriumSeeK.length !== T.length) { this.atriumSeeK = new Int32Array(T.length).fill(-1); this.atriumSeeV = new Uint8Array(T.length); }
    if (this.atriumSeeK[k] !== this.posStamp) { this.atriumSeeV[k] = this.sees(e, T[k] as unknown as Tile) ? 1 : 0; this.atriumSeeK[k] = this.posStamp; }
    return this.atriumSeeV[k] === 1;
  }

  /**
   * Iteration 12 (ARCH): the levels the eye stands on: `camLevel` (the resolver's pick) plus every level whose
   * OWN open band at the eye's column holds the eye (within EYE_TOL). A stair run carved into two grids is one
   * deduplicated band in LevelColumns (owned by the lower level index), but it belongs to both levels it joins.
   */
  private eyeLevels(e: THREE.Vector3, camLevel: number): Set<number> {
    const here = this.here;
    here.clear();
    here.add(camLevel);
    const cx = Math.floor(e.x / CELL), cy = Math.floor(e.z / CELL);
    if (cx < 0 || cy < 0 || cx >= this.cols.W || cy >= this.cols.H) return here;
    const i = cy * this.cols.W + cx;
    for (const L of this.levels) {
      const g = L.grid;
      if (!isOpen(g, i)) continue;
      const f = g.floorAt(e.x, e.z);
      const r = g.rampIdx[i];
      const c = r >= 0 ? Math.max(cellCeil(g, i), f + g.ramps[r].headroom) : cellCeil(g, i);
      if (e.y >= f - EYE_TOL && e.y <= c + EYE_TOL) here.add(L.id);
    }
    return here;
  }

  /** Line of sight from the eye to a few columns of a portal tile, through the union of free bands. */
  private sees(e: THREE.Vector3, t: Tile): boolean {
    const n = t.cells.length;
    const picks = n <= 4 ? t.cells : [t.cells[0], t.cells[n - 1], t.cells[n >> 1], t.cells[n >> 2], t.cells[(3 * n) >> 2]];
    for (const i of picks) {
      const cx = i % this.cols.W, cy = (i - cx) / this.cols.W;
      const tx = (cx + 0.5) * CELL, tz = (cy + 0.5) * CELL;
      // Aim at the eye height clamped into the portal band (looking straight across / up / down into it).
      const ty = Math.min(t.y1 - 0.2, Math.max(t.y0 + 0.2, e.y));
      if (this.ray(e.x, e.y, e.z, tx, ty, tz)) return true;
      if (ty !== (t.y0 + t.y1) / 2 && this.ray(e.x, e.y, e.z, tx, (t.y0 + t.y1) / 2, tz)) return true;
    }
    return false;
  }

  /** 3D segment free in the union of open bands (+ the see volumes, slabs.windows only) (2D DDA over columns, height span per column). */
  private ray(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const {W, H} = this.cols;
    const dx = bx - ax, dz = bz - az;
    let x = Math.floor(ax / CELL), y = Math.floor(az / CELL);
    const tx = Math.floor(bx / CELL), ty = Math.floor(bz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tDX = adx > 1e-9 ? CELL / adx : Infinity, tDY = adz > 1e-9 ? CELL / adz : Infinity;
    let tMaxX = adx > 1e-9 ? (dx > 0 ? (x + 1) * CELL - ax : ax - x * CELL) / adx : Infinity;
    let tMaxY = adz > 1e-9 ? (dz > 0 ? (y + 1) * CELL - az : az - y * CELL) / adz : Infinity;
    let tIn = 0;
    for (let guard = 0; guard < 1024; guard++) {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const i = y * W + x;
      const tOut = Math.min(tMaxX, tMaxY, 1);
      const ya = ay + (by - ay) * tIn, yb = ay + (by - ay) * tOut;
      const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
      let ok = false;
      for (let k = 0; k < this.cols.count(i) && !ok; k++) {
        const g = this.levels[this.cols.level(i, k)].grid;
        const r = ramp(g, i);
        const f = r ? r[0] : g.floorOf(i), c = r ? r[1] : cellCeil(g, i);
        ok = lo >= f - 0.1 && hi <= c + 0.1;
      }
      // task studio-skywalk-variety (lane PERF): or inside a see volume over the column (Skyways: glass spans, the street air)
      const ss = this.seeStart;
      if (!ok && ss) for (let k = ss[i]; k < ss[i + 1] && !ok; k++) ok = lo >= this.seeY[2 * k] - 0.1 && hi <= this.seeY[2 * k + 1] + 0.1;
      if (!ok) return false;
      if (x === tx && y === ty) return true;
      if (tMaxX < tMaxY) { tIn = tMaxX; tMaxX += tDX; x += stepX; } else { tIn = tMaxY; tMaxY += tDY; y += stepY; }
    }
    return true;
  }

  /** Stop culling these objects (and their meshes), e.g. a holder knocked loose and carried by physics. */
  release(objs: readonly THREE.Object3D[]): void {
    if (!objs.length) return;
    const gone = new Set<THREE.Object3D>();
    for (const o of objs) o.traverse(x => { gone.add(x); });
    for (let k = this.entries.length - 1; k >= 0; k--) {
      const en = this.entries[k];
      if (!gone.has(en.obj)) continue;
      if (en.culled) en.obj.layers.mask = en.mask;
      this.entries.splice(k, 1);
    }
  }

  /** Lane RENDER-CPU (tests / QA A-B): forget the position-only caches (slab tests, sight rays); the next update recomputes them. */
  forgetPositionCaches(): void {
    this.posStamp++;
    this.posEye.fill(NaN);
  }

  /** Show everything again (debug / before disposal). */
  reset(): void {
    for (const en of this.entries) if (en.culled) { en.obj.layers.mask = en.mask; en.culled = false; en.occluded = false; }
    for (const t of this.tracked.values()) this.showTracked(t); // (task studio-reactor-submit, lane CPU: tracked moving objects too)
  }
}

/** Lowest floor / highest ceiling a flight cell sweeps (null off ramps). */
function ramp(g: Level['grid'], i: number): [number, number] | null {
  const r = g.rampIdx[i];
  if (r < 0) return null;
  const R = g.ramps[r], W = g.w, cx = i % W, cy = (i - cx) / W;
  const a = ((R.axis === 'x' ? cx : cy)) * CELL;
  const h0 = Math.min(rh(R, a), rh(R, a + CELL)), h1 = Math.max(rh(R, a), rh(R, a + CELL));
  return [h0, h1 + R.headroom];
}
function rh(R: {s0: number; s1: number; h0: number; h1: number}, s: number): number {
  const t = (s - R.s0) / (R.s1 - R.s0);
  return R.h0 + (R.h1 - R.h0) * (t < 0 ? 0 : t > 1 ? 1 : t);
}
