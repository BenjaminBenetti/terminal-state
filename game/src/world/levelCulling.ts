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
// would), those levels join the breadth-first pass, and a mesh of such a level renders within ATRIUM_MARGIN (20 m: a gallery plus a
// whole sales floor seen through its shopfront) of a visible atrium tile (per-entry tile lists, built once). Back-of-house meshes
// deeper than that (stock rooms, service corridors) stay hidden when seen from another storey. Without `opts.atrium` (every Subway station, the Office) nothing here runs: identical behaviour and stats.

import * as THREE from 'three';
import {CELL, FLOOR, VOID, type Grid} from '../gen/grid';
import type {Level} from '../gen/levels';
import {LevelColumns, cellCeil, rampsEqual} from './levelGeometry';
import type {LevelResolver} from './builder';

/** Layer that no camera renders: culled meshes live here. */
export const CULL_LAYER = 31;
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

const isOpen = (g: Grid, i: number) => g.cells[i] === FLOOR || g.cells[i] === VOID;

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
}
/** Task track3 (lane ARCH): an atrium tile — open void columns joining every level in `levels`. */
interface AtriumTile { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; cells: number[]; levels: number[] }

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

  constructor(private readonly levels: readonly Level[], private readonly cols: LevelColumns, private readonly levelAt: LevelResolver,
    opts?: {atrium?: Uint8Array; slabs?: {see?: readonly {x0: number; z0: number; x1: number; z1: number}[]}}) {
    this.levelIds = levels.map(l => l.id);
    if (levels.length > 1) this.buildPortals(opts?.atrium);
    if (levels.length > 1 && opts?.slabs) this.buildSlabs(opts.slabs.see ?? []);
  }

  /** Task track3 (lane PERF): per storey floor plane, the cells open across it (summed-area table, (W + 1) x (H + 1)). */
  private buildSlabs(see: readonly {x0: number; z0: number; x1: number; z1: number}[]): void {
    const {W, H} = this.cols;
    const base = Math.min(...this.levels.map(l => l.baseY));
    const planes = [...new Set(this.levels.map(l => l.baseY).filter(y => y > base + 1))].sort((a, b) => a - b);
    const seeMask = new Uint8Array(W * H);
    for (const r of see) {
      for (let cy = Math.max(0, Math.floor(r.z0 / CELL)); cy < Math.min(H, Math.ceil(r.z1 / CELL)); cy++)
        for (let cx = Math.max(0, Math.floor(r.x0 / CELL)); cx < Math.min(W, Math.ceil(r.x1 / CELL)); cx++) seeMask[cy * W + cx] = 1;
    }
    const lo: number[] = [], hi: number[] = [], ord: number[] = [];
    for (const Y of planes) {
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
      if (im.isInstancedMesh) {
        if (im.count === 0 || m.frustumCulled === false) { this.stats.uncullable++; return; }
        im.computeBoundingBox();
        this.box.copy(im.boundingBox!).applyMatrix4(m.matrixWorld);
      } else this.box.setFromObject(m);
      if (this.box.isEmpty()) { this.stats.uncullable++; return; }
      const b = this.box, entry = {obj: m, level: NaN, x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z, y0: b.min.y, y1: b.max.y, mask: m.layers.mask, culled: false} as Entry;
      // Task office-seamless-20261029: a mesh tagged with several levels (stair flights) renders with any of them.
      const tag = Array.isArray(m.userData.levels) ? (m.userData.levels as unknown[]).filter((l): l is number => typeof l === 'number' && this.levelIds.includes(l)) : [];
      if (tag.length) { entry.levels = tag; this.stats.multi++; this.entries.push(entry); return; }
      let level = typeof m.userData.level === 'number' ? m.userData.level : NaN;
      if (Number.isNaN(level)) {
        const lo = this.levelAt((b.min.x + b.max.x) / 2, b.min.y + 0.05, (b.min.z + b.max.z) / 2);
        const hi = this.levelAt((b.min.x + b.max.x) / 2, b.max.y - 0.05, (b.min.z + b.max.z) / 2);
        if (lo !== hi || b.max.y - b.min.y > 4.5) {
          // Iteration 08: never level-culled. Tall stacks: render with every level whose storey (base .. base + 4.5 m) it spans.
          const span = this.levels.length > LEGACY_STACK ? this.levels.filter(l => l.baseY <= b.max.y + 0.3 && l.baseY + 4.5 >= b.min.y).map(l => l.id) : [];
          if (!span.length || span.length === this.levels.length) { this.stats.uncullable++; return; }
          entry.levels = span; this.stats.multi++; this.entries.push(entry); return;
        }
        level = lo;
      }
      // Not a station level (e.g. builder STAIR_LEVEL flights, seen from both levels): fog culling only.
      entry.level = this.levelIds.includes(level) ? level : NaN;
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
      && Math.abs(q.x - l.qx) + Math.abs(q.y - l.qy) + Math.abs(q.z - l.qz) + Math.abs(q.w - l.qw) < 0.02) return;
    Object.assign(l, {x: e.x, y: e.y, z: e.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, ov});
    const camLevel = ov ?? this.levelAt(e.x, e.y, e.z);
    // Iteration 12 (ARCH): every level whose band holds the eye is current (a shared stair run = both). An override
    // (the eye in the elevator cab) is the only current level.
    const here = ov !== null ? this.onlyLevel(ov) : this.eyeLevels(e, camLevel);
    this.stats.level = camLevel;
    this.stats.levels = [...here];
    // Visible portal tiles from the camera's level(s), per other level.
    const vis = new Map<number, Tile[]>();
    const shown = new Set<number>(here);
    let tested = 0, visible = 0, hops = 0;
    if (this.enabled) {
      this.pm.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
      this.fr.setFromProjectionMatrix(this.pm);
      const seen = (t: Tile): boolean => {
        const dx = Math.max(t.x0 - e.x, 0, e.x - t.x1), dz = Math.max(t.z0 - e.z, 0, e.z - t.z1);
        if (dx * dx + dz * dz > PORTAL_MAX_DIST * PORTAL_MAX_DIST) return false;
        this.box.min.set(t.x0, t.y0, t.z0); this.box.max.set(t.x1, t.y1, t.z1);
        // Right beside the tile (just off a run's end): visible without frustum / sight tests.
        const inside = dx * dx + dz * dz <= PORTAL_NEAR * PORTAL_NEAR && e.y >= t.y0 - 0.5 && e.y <= t.y1 + 0.5;
        if (!inside && !this.fr.intersectsBox(this.box)) return false;
        tested++;
        if (!inside && !this.sees(e, t)) return false;
        visible++;
        return true;
      };
      const add = (other: number, t: Tile) => { let list = vis.get(other); if (!list) vis.set(other, (list = [])); list.push(t); };
      // Task track3 (lane ARCH): the atrium first (mall only): its levels join `shown` before the pair-portal hops.
      if (this.atriumTiles.length) this.updateAtrium(e, shown, ov !== null);
      // Breadth-first over levels (iteration 12: one extra hop, the lower level down the second run of a stair core seen
      // from the upper landing; task office-seamless-20261029: as many hops as storeys, e.g. up a scissor stair). A hop
      // tests the tiles with exactly one side among the levels shown so far; each tile's test runs at most once.
      const memo = new Int8Array(this.tiles.length);
      for (let added = true; added && hops < this.levels.length;) {
        added = false;
        const before = new Set(shown);
        for (let k = 0; k < this.tiles.length; k++) {
          const t = this.tiles[k];
          const ha = before.has(t.a), hb = before.has(t.b);
          if (ha === hb) continue; // neither level is shown yet, or both already are
          if (!memo[k]) memo[k] = seen(t) ? 1 : -1;
          if (memo[k] < 0) continue;
          const other = ha ? t.b : t.a;
          add(other, t);
          if (!shown.has(other)) { shown.add(other); added = true; }
        }
        hops++;
      }
    }
    let culled = 0, fogged = 0, slab = 0;
    // Iteration 12 (ARCH): three's FogExp2 fogs by VIEW DEPTH (-mvPosition.z), not distance: at the screen corners
    // a box 58 m away is only ~31 m deep (~17 % visible). Fog-cull a box only when its nearest point along the view
    // axis lies beyond maxDistance (conservative, so nothing still visible through the fog pops out at the edges).
    const me = camera.matrixWorld.elements;
    const fl = Math.hypot(me[8], me[9], me[10]) || 1;
    const fx = -me[8] / fl, fy = -me[9] / fl, fz = -me[10] / fl;
    const far = this.maxDistance;
    for (const en of this.entries) {
      let show: boolean;
      const depth = Math.min(fx * (en.x0 - e.x), fx * (en.x1 - e.x)) + Math.min(fy * (en.y0 - e.y), fy * (en.y1 - e.y)) + Math.min(fz * (en.z0 - e.z), fz * (en.z1 - e.z));
      if (!this.enabled) show = true;
      else if (depth > far) { show = false; fogged++; } // entirely inside opaque fog
      else if (en.levels) show = en.levels.some(l => here.has(l)) || en.levels.some(l => this.nearPortal(en, vis.get(l))) || this.nearAtrium(en, en.levels);
      else if (Number.isNaN(en.level) || here.has(en.level)) show = true;
      // Another level: only near a portal tile the camera can see (task track3: or near a visible atrium tile of that level).
      else show = this.nearPortal(en, vis.get(en.level)) || this.nearAtrium(en, [en.level]);
      // Task track3 (lane PERF): the mall's slab occlusion (no planes elsewhere: Subway / Office unchanged)
      if (show && this.enabled && this.slabs && this.slabPlanes.length && this.slabHidden(en, e)) { show = false; slab++; }
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
    // void beside the shaft counts as seen within ATRIUM_CAB_NEAR
    const nearR = inCab ? ATRIUM_CAB_NEAR : ATRIUM_NEAR;
    vis.fill(0);
    this.atriumLevels.clear();
    const maxD = Math.min(ATRIUM_MAX_DIST, this.maxDistance);
    const cand: {k: number; d2: number}[] = [];
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
      cand.push({k, d2});
    }
    st.inFrustum = cand.length;
    st.sightTests = 0;
    let seen = near;
    if (!seen && cand.length) {
      cand.sort((a, b) => a.d2 - b.d2);
      for (let c = 0; c < cand.length && c < ATRIUM_SIGHT_TESTS && !seen; c++) {
        st.sightTests++;
        seen = this.sees(e, T[cand[c].k] as unknown as Tile);
      }
    }
    st.seen = seen;
    if (!seen) { vis.fill(0); st.levels = []; return; }
    for (const {k} of cand) for (const l of T[k].levels) { this.atriumLevels.add(l); shown.add(l); }
    st.levels = [...this.atriumLevels].sort((a, b) => a - b);
  }

  /** Whether an entry of one of `levels` lies within ATRIUM_MARGIN of an atrium tile visible this update (mall only). */
  private nearAtrium(en: Entry, levels: readonly number[]): boolean {
    if (!this.atriumTiles.length || !this.atriumStats.seen || !levels.some(l => this.atriumLevels.has(l))) return false;
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
      if (vis[k] && levels.some(l => this.atriumTiles[k].levels.includes(l))) return true;
    }
    return false;
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

  /** 3D segment free in the union of open bands (2D DDA over columns, height span per column). */
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

  /** Show everything again (debug / before disposal). */
  reset(): void {
    for (const en of this.entries) if (en.culled) { en.obj.layers.mask = en.mask; en.culled = false; }
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
