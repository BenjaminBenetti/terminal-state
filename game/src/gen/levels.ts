// Iteration 08: multi-level stations — the shared layer contract (primary-authored; see
// reference/tasks/vertical-slice-iteration08-20261027/design.md). Lane B extends it with the
// y-aware world queries every gameplay system uses (support, collision, ceilings, 3D raycast /
// line of sight, nav helpers, railings).
//
// Model: a station is a stack of LEVELS. Each level owns a full Grid with the SAME dimensions and
// world origin as `layout.grid` (which is levels[0], the main level). A level grid uses the
// existing cell semantics (FLOOR / VOID track bed / SOLID, absolute floor + ceil per cell, ramps,
// links). Free space is the UNION of every level's open columns: a point (x, y, z) is free when
// some level has an open cell at (x, z) whose [floor, ceil] band contains y. That one rule drives
// support (what you stand on), collision, ceilings/headroom, raycasts (walls, floors, ceilings,
// slab undersides) and sight. Levels may overlap in X/Z (an upper concourse over the platform and
// tracks, a lower service crossing under them); the slab between them is the gap between the
// lower band's ceil and the upper band's floor.
//
// Stairs between levels: a flight is carved into BOTH level grids with the same Ramp (same cells,
// same pitch line, same headroom); its bottom landing is open on the lower level and its top
// landing on the upper level. An actor on the flight resolves to either level identically, so the
// hand-over is seamless (PathFinder joins such "twin" cells with a free edge). Apertures
// (stairwells, light wells, catwalk edges) are cells that are not walkable on the upper level while
// the lower level's band extends up through them.
//
// Band of a ramp cell (Lane B): [pitch line, min(pitch line + headroom, grid.ceil[i])] — addRamp
// stores ceil[i] = max over the cell + headroom, so legacy flights are unchanged; an OPEN
// stairwell (no ceiling following the flight) uses a large Ramp.headroom and caps it with ceil[i]
// (the hall ceiling over it).
//
// Railings (Lane B): `Levels.rails` is the generator's list (layout.rails, Lane A / G format) when the
// layout has one — collision then matches exactly what the builder renders, and an edge left open
// is a real drop (no fall damage). Layouts without a list (legacy, hand-made fixtures) derive rails
// by one rule: a walkable edge whose neighbouring column offers no support within RAIL_DROP below it
// (stairwell, light well, mezzanine / catwalk edge, a flight side high above the floor);
// `unrailedDrops()` lists such edges a generator list leaves open (QA). Rails stop walking bodies
// and physics bodies at their deck height; bullets / sight pass an open 'railing' but not a solid
// 'parapet'. The main-level platform edge (1.15 m into the track bed) is a drop, not a rail.

import {CELL, FLOOR, VOID, STEP_UP, NAV_STEP, MAX_DROP, rampHeight, stepTop, type Grid, type NavLevels, type CrossLink, type StandPoint} from './grid';

/** 'office' (task office-seamless-20261029): a tower storey above the lobby (dry indoor air, office walls). 'roof' (task
 *  office-overhaul-20261030, lane STRUCT): the open-sky roof deck on top of the tower (outdoor air; see Level.sky). */
/** 'ring' (task track3-eaton-centre-20261031, lane GEN): a retail ring of The Eaton's Center (a stacked tower-like storey around the
 *  open atrium: the engine treats it like an 'office' storey — e.g. physics caps solid columns above a column's top band). */
export type LevelRole = 'main' | 'upper' | 'lower' | 'office' | 'roof' | 'ring';

/**
 * Task office-overhaul-20261030 (lane STRUCT): an OPEN-SKY storey (the tower roof). Its grid bands end at `ceil` (a high
 * nominal band top that only bounds headroom / the light field); nothing is built there and rays leaving any band through a
 * ceiling at or above `ceil` fly into the open sky (Levels.raycast / lineOfSight: no hit). Closed columns (the parapet wall
 * ring and everything beyond it, the elevator overrun) are solid only up to their top: `top` (the parapet coping, absolute y)
 * unless `tops[cell]` (absolute, > 0) says otherwise; a ray entering a closed column above that height is in open air.
 * Collision is unchanged (closed columns block walking bodies at any height: nobody walks or jumps off the roof).
 */
export interface LevelSky {
  /** Deck height (absolute): the open-air rule only applies above it. */
  y: number;
  /** Nominal band top of the open-sky storey (absolute). */
  ceil: number;
  /** Default top of closed columns (absolute: the parapet coping). */
  top: number;
  /** Per grid cell: absolute top of a taller closed structure (elevator overrun); 0 = `top`. */
  tops?: Float32Array;
  /**
   * Task reactor-submit-roof-fog-20261102 (lane ROOF): a ROOF OPENING mask (per grid cell, 1 = open). Present: only those columns'
   * band tops at or above `ceil` open to the sky (the Reactor pit's single hole over the core); every other band top there is a real
   * ceiling and closed columns are solid at every height (no open air above `top` / `tops`, no face clipping). Absent: every column
   * (the Office's open roof deck).
   */
  open?: Uint8Array;
  /**
   * Task studio-reactor-surface-ending-20261102 (lane ENDING): with `open`, the OUTDOORS over a walkable open-air storey (the Reactor's
   * surface plaza round the roof opening, layout.levels[level]): closed columns are open air above `y` (that storey's parapet line),
   * or above `tops[cell]` where a taller structure stands (the stair head house), and that storey's wall faces stand only that high
   * (world/levelGeometry.ts clipSkyFaces). Absent: with `open` every closed column is solid at every height.
   */
  outdoor?: {level: number; y: number};
}

export interface Level {
  /** Index into layout.levels (0 = main; ascending ids are NOT height-ordered). */
  id: number;
  role: LevelRole;
  /** Same w/h/origin as layout.grid; levels[0].grid === layout.grid. */
  grid: Grid;
  /** Nominal walking height of the level (most of its floor; ramps/beds differ). */
  baseY: number;
  /**
   * Optional explicit railings of this level (Lane A). Absent: derived (see `Levels.rails`). Present
   * (even empty): used as-is for this level.
   */
  rails?: RailRun[];
  /** Task office-overhaul-20261030 (lane STRUCT): open-sky storey (the roof); see LevelSky. */
  sky?: LevelSky;
}

/**
 * A vertical connection between two levels (stairs carved into both grids, or a ladder link). Task office-overhaul-20261030
 * (lane STRUCT): a 'ladder' link WITHOUT traversalId (the roof access ladder) is a PLAYER-ONLY climb: player reachability
 * (levelGen.levelDistance, levelIssues) follows it, the AI path graph (crossLinks / PathFinder) never does.
 */
export interface LevelLink {
  id: number;
  kind: 'stairs' | 'ladder';
  /** Lower and upper level ids. */
  lower: number;
  upper: number;
  /** Stairs: ramp index in BOTH grids (identical Ramp). */
  ramp?: number;
  /** Stand points just off the bottom and top of the connector. */
  bottom: {x: number; y: number; z: number};
  top: {x: number; y: number; z: number};
  /** traversal.stairs / traversal.ladders id, when the connector is also listed there. */
  traversalId?: number;
  /** Ladders: nav cost in cell steps (default 10, like rescue ladders). */
  cost?: number;
}

/** What an actor stands on at a world point. */
export interface Support {
  level: number;
  floor: number;
  ceil: number;
  /** Grid cell index (same indexing on every level). */
  cell: number;
  area: number;
  /** Task office-seamless (lane LIFT): set when the support is a dynamic volume (the moving elevator cab), not a grid band. */
  volume?: DynamicVolume;
}

// -------------------------------------------------------------------------------------------------
// Task office-seamless-20261029 (lane LIFT): dynamic free-space volumes — the moving elevator cab.
//
// A volume is an axis-aligned box over grid columns (its footprint cell aligned; a cell belongs to it when its centre lies
// inside) whose free band [floorY, ceilY] may move every frame (the cab rides the shaft). Inside the footprint, grid bands
// whose floor lies within the volume's stop range are HIDDEN (the shaft is solid on every storey grid anyway) and the
// volume band replaces them: support, collision, headroom, nav helpers, raycasts and sight see the cab interior as free
// space bounded by the surrounding solid cells (walls), its floor and its ceiling. A GATE is an opening on one side of the
// footprint (the cab door through the shaft wall): in its passage columns every grid band whose floor sits at a stop is
// SOLID unless the gate is open and that band's floor is the volume floor (the cab level at that stop, doors open); when
// the gate is open and no grid band is there (a doorway kept solid in the grids), the passage band [floorY, floorY +
// height] is added instead. So the landing doors are solid whenever they are not open, and nobody walks, falls, shoots or
// sees into the shaft. Path finding (PathFinder / reachable) ignores volumes (enemies never ride). No volume = no cost.

/** Side of a footprint ('N' = -z, 'S' = +z, 'W' = -x, 'E' = +x). */
export type VolumeSide = 'N' | 'S' | 'E' | 'W';

/** An opening on one side of a dynamic volume (the cab door + the landing door in the shaft wall). */
export interface VolumeGate {
  side: VolumeSide;
  /** Opening range along the side (world m: x for N / S, z for E / W). */
  a0: number;
  a1: number;
  /** Passage depth beyond the side (m): the shaft wall up to the landing. */
  depth: number;
  /** Clear height of the opening above the volume floor (m). */
  height: number;
  /** Passable only while open (the runtime: cab level at a stop and the doors open). */
  open: boolean;
}

/** A moving free-space box (Levels.addDynamicVolume). Mutate floorY / ceilY / level / area / gate.open in place. */
export interface DynamicVolume {
  /** Interior footprint (world m, cell aligned). */
  x0: number; z0: number; x1: number; z1: number;
  /** Current floor / ceiling (absolute y). */
  floorY: number;
  ceilY: number;
  /** Storey the volume reports for support (levelAt / Support.level). */
  level: number;
  /** Area id it reports (default -1). */
  area?: number;
  gates: VolumeGate[];
  /** Absolute floor y of every stop (gates open there; grid bands hidden in that range). Default: [floorY] when added. */
  stops?: readonly number[];
  /** Shaft wall thickness around the interior (m, default one cell): physics keeps it solid over the whole shaft height. */
  shell?: number;
  name?: string;
}

/** One column's membership of a volume (Levels.volumeColumn; read-only for callers). */
export interface VolumeColumn {
  readonly v: DynamicVolume;
  /** null: interior column; else the gate whose passage this column is. */
  readonly gate: VolumeGate | null;
  /** Per level index: 1 = that grid's open band here belongs to the volume (interior: hidden; passage: gated). */
  readonly hide: Uint8Array;
  /** Per level index: that grid band's floor (passage match test). */
  readonly at: Float64Array;
}

/** Most volume bands one column can hold (scratch sizing; a column is in at most this many volumes). */
const VOL_MAX = 4;
/** Floor match tolerance between a passage band and the volume floor (m). */
const GATE_MATCH = 0.05;
/** A grid band within this of a stop (passage) / of the stop range (interior) belongs to the volume. */
const STOP_TOL = 0.3;
/** Scratch out of volumeBand(). */
const VB = {floor: 0, ceil: 0};

/** Volume band of a membership right now into VB; false = none (closed gate, or the grid's own passage band serves). */
function volumeBand(c: VolumeColumn, nl: number): boolean {
  const v = c.v, g = c.gate;
  if (!g) { VB.floor = v.floorY; VB.ceil = v.ceilY; return true; }
  if (!g.open) return false;
  for (let k = 0; k < nl; k++) if (c.hide[k] && Math.abs(c.at[k] - v.floorY) < GATE_MATCH) return false;
  VB.floor = v.floorY; VB.ceil = v.floorY + g.height;
  return true;
}

/** The grid band of level index k (floor f) in a volume column is hidden right now. */
function gridHidden(vc: readonly VolumeColumn[], k: number, f: number): boolean {
  for (const c of vc) {
    if (!c.hide[k]) continue;
    if (!c.gate) return true;
    if (!(c.gate.open && Math.abs(f - c.v.floorY) < GATE_MATCH)) return true;
  }
  return false;
}

/** A free vertical interval of one column, tagged with the level whose band it is. */
export interface Band { level: number; floor: number; ceil: number }

/**
 * A straight railing along a cell edge (world metres; structurally the layout's RailRun from
 * stationTypes.ts). y0 / y1 = walking surface at each end (follows a stair pitch along a flight
 * side); top = base + h (default RAIL_H). (nx, nz): unit normal pointing to the walkable side.
 * 'parapet' = a solid low wall (also stops bullets / sight below its top); default 'railing'.
 */
export interface RailRun {
  level: number;
  x0: number; z0: number; x1: number; z1: number;
  y0: number; y1: number;
  nx: number; nz: number;
  kind?: 'railing' | 'parapet';
  h?: number;
  /** Task office-overhaul-20261030 (lane STRUCT): collision-only (the builder draws no railing: escalator glass balustrades,
   *  stair handrails and roof fixtures render their own geometry). */
  hidden?: boolean;
}

/** Result of `Levels.raycast`: kind + ray parameter + surface normal + the level whose band the ray was in. */
export interface LevelHit {
  /** Ray parameter (point = o + d * t; the distance when d is unit length). */
  t: number;
  kind: 'wall' | 'floor' | 'ceiling' | 'prop' | 'none';
  /** Level of the band the ray travelled in when it hit (-1 for 'none' / outside). */
  level: number;
  nx: number; ny: number; nz: number;
  /** Column index of the hit: the blocking column for walls, the column the ray was in otherwise (-1: none / outside). */
  cell: number;
  /** Index into opts.props for exact prop hits (sight-blocking prop cells report kind 'prop' without an index). */
  prop?: number;
}

export interface RaycastOpts {
  /** Exact prop boxes (absolute y / h): hitscan. Tested in 3D, so props on other levels never block a slab-separated ray. */
  props?: readonly {x: number; y: number; z: number; hx: number; hz: number; h: number; round?: boolean}[]; // round: lane FIX (U04)
  /** Treat sight-blocking prop cells (grid.sightBlocked of the band's level) as opaque (line of sight). */
  sightProps?: boolean;
  /** Floor for VOID cells without an explicit height (legacy hand-built grids; layout.trench.floorY). */
  trenchY?: number;
  /** Ceiling for cells without one (legacy hitscan used 3 m; default Infinity). */
  unsetCeil?: number;
}

export interface Vec3 { x: number; y: number; z: number }

/** Drop (m) beyond which a walkable edge is railed (the 1.15 m platform edge stays open). */
export const RAIL_DROP = 1.3;
/** Railing height above the deck (m) and the half thickness used for collision (m). */
export const RAIL_H = 1.1;
export const RAIL_HALF = 0.03;
/** Clear height a non-player walking body needs (zombies stoop under soffits; m). */
export const BODY_CLEAR = 1.6;
/** Tolerance (m) for a point counting as inside a band near its ceiling. */
const CAP_TOL = 0.05;

const isOpen = (g: Grid, i: number): boolean => { const c = g.cells[i]; return c === FLOOR || c === VOID; };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Floor of open cell i (column cx, cy) at its point nearest (x, z) (ramps: the pitch line). */
export function floorNearCell(g: Grid, i: number, cx: number, cy: number, x: number, z: number, voidY?: number): number {
  const r = g.rampIdx[i];
  if (r < 0) {
    const f = g.floor[i];
    return f === 0 && g.cells[i] === VOID ? (voidY ?? g.voidFloor) : f;
  }
  const R = g.ramps[r];
  return rampHeight(R, R.axis === 'x' ? clamp(x, cx * CELL, (cx + 1) * CELL) : clamp(z, cy * CELL, (cy + 1) * CELL));
}

/** Ceiling of open cell i at its point nearest (x, z): flights follow the pitch (capped by ceil[i]); `unset` when none. */
export function ceilNearCell(g: Grid, i: number, cx: number, cy: number, x: number, z: number, unset = Infinity): number {
  const has = g.ceil[i] !== 0 || g.floor[i] !== 0;
  const r = g.rampIdx[i];
  if (r < 0) return has ? g.ceil[i] : unset;
  const R = g.ramps[r];
  const c = rampHeight(R, R.axis === 'x' ? clamp(x, cx * CELL, (cx + 1) * CELL) : clamp(z, cy * CELL, (cy + 1) * CELL)) + R.headroom;
  return has ? Math.min(c, g.ceil[i]) : c;
}

/** Step-profile surface (tread tops on ramps) of open cell i at (x, z). */
function stepNearCell(g: Grid, i: number, cx: number, cy: number, x: number, z: number, voidY?: number): number {
  const r = g.rampIdx[i];
  if (r < 0) return floorNearCell(g, i, cx, cy, x, z, voidY);
  const R = g.ramps[r];
  return stepTop(R, R.axis === 'x' ? clamp(x, cx * CELL, (cx + 1) * CELL) : clamp(z, cy * CELL, (cy + 1) * CELL));
}

/**
 * Multi-level world queries. Construct once per station (cheap: no copies; rails / indices are
 * built lazily). Every consumer that used `grid.floorAt / ceilAt / raycast / lineOfSight` on the main
 * grid should move to these y-aware queries; with a single level they reduce to the old behaviour.
 */
export class Levels implements NavLevels {
  readonly list: Level[];
  /** Level links (stairs / ladders between levels). */
  readonly links: LevelLink[];
  private railList: RailRun[] | null = null;
  private railIndex: Map<number, RailRun[]> | null = null;
  /** Task frame-budget-deferral-20261030 (lane MEASURE): 1 = railIndex has rails at this column (railCrosses skips the map lookup). */
  private railMask: Uint8Array | null = null;
  /**
   * Task frame-budget-deferral-20261030 (lane MEASURE): the level index whose band last cleared a cell in circleClear — tried
   * first next time (circleClear is an existence test over the levels: any order gives the same answer; on the 10-storey office
   * the right storey is usually found at once instead of after every storey below it).
   */
  private clearHint = 0;
  private parapetList: RailRun[] | null = null;
  private edgeList: {level: number; a: number; b: number}[] | null = null;
  private rayScratch: {fA: Float64Array; cA: Float64Array; fB: Float64Array; cB: Float64Array; open: Uint8Array; lid: Int32Array} | null = null;
  /** Lane LIFT: registered dynamic volumes and their column index (null = none: every query takes the plain grid path). */
  private volList: DynamicVolume[] = [];
  private volCells: Map<number, VolumeColumn[]> | null = null;
  /** Per column: 1 = some volume covers it (a typed-array test before the map lookup on hot paths). */
  private volMask: Uint8Array | null = null;
  /** Bumped whenever a volume is added / removed (physics rebuilds its static boxes around the shaft). */
  volumeVersion = 0;
  /** Generator railings (layout.rails); undefined = derive. */
  private readonly explicitRails: readonly RailRun[] | undefined;
  /** The rails array this instance was built from (levelsOf cache check). */
  get railSource(): readonly RailRun[] | undefined {
    return this.explicitRails;
  }
  constructor(levels: Level[], links: LevelLink[] = [], rails?: readonly RailRun[]) {
    this.list = levels;
    this.links = links;
    this.explicitRails = rails;
    this.sky = levels.find(l => l.sky)?.sky ?? null;
  }
  /** Task office-overhaul-20261030 (lane STRUCT): the open-sky storey's rule (the roof), or null (every other station). */
  readonly sky: LevelSky | null;
  /** Open sky at height y entering closed column i (out of the grid: i < 0): above the column's solid top. */
  private openAir(i: number, y: number): boolean {
    const s = this.sky;
    if (!s || y <= s.y) return false;
    const t = i >= 0 && s.tops ? s.tops[i] : 0;
    // (lane ROOF: with an opening mask the closed columns are solid at every height — task studio-reactor-surface-ending-20261102,
    // lane ENDING: except above the surface storey's parapet line / a structure's top, the outdoors)
    if (s.open) return !!s.outdoor && y > (t > 0 ? t : s.outdoor.y);
    return y > (t > 0 ? t : s.top);
  }
  /** Task reactor-submit-roof-fog-20261102 (lane ROOF): column i's band top at / above sky.ceil opens to the sky (LevelSky.open). */
  private skyOpen(i: number): boolean {
    const s = this.sky;
    return !!s && (!s.open || (i >= 0 && s.open[i] === 1));
  }
  get main(): Grid {
    return this.list[0].grid;
  }
  get count(): number {
    return this.list.length;
  }
  grid(level: number): Grid {
    return this.list[level].grid;
  }

  // -------------------------------------------------------------------------------------------
  // Dynamic volumes (lane LIFT)

  /** Registers a moving free-space box (the elevator cab). Its footprint / gates / stops are indexed now; floorY / ceilY / level / gate.open are read live. */
  addDynamicVolume(v: DynamicVolume): DynamicVolume {
    if (!this.volList.includes(v)) {
      if (!v.stops || !v.stops.length) v.stops = [v.floorY];
      this.volList.push(v);
      this.reindexVolumes();
    }
    return v;
  }

  removeDynamicVolume(v: DynamicVolume): void {
    const i = this.volList.indexOf(v);
    if (i < 0) return;
    this.volList.splice(i, 1);
    this.reindexVolumes();
  }

  get dynamicVolumes(): readonly DynamicVolume[] {
    return this.volList;
  }

  /** The volume whose interior footprint holds (x, z) (and, given y, whose band holds y within `pad`); null when none. */
  volumeAt(wx: number, wz: number, y?: number, pad = 0.3): DynamicVolume | null {
    for (const v of this.volList) {
      if (wx < v.x0 || wx > v.x1 || wz < v.z0 || wz > v.z1) continue;
      if (y === undefined || (y >= v.floorY - pad && y <= v.ceilY + pad)) return v;
    }
    return null;
  }

  /** Volume memberships of column index i (undefined: none). */
  volumeColumn(i: number): readonly VolumeColumn[] | undefined {
    return this.vcol(i);
  }

  private vcol(i: number): VolumeColumn[] | undefined {
    const m = this.volMask;
    return m !== null && m[i] === 1 ? this.volCells!.get(i) : undefined;
  }

  /** Physics / statics: whether the grid band of level index k (floor f) in column i is hidden by a volume right now. */
  gridBandHidden(i: number, k: number, f: number): boolean {
    const vc = this.vcol(i);
    return !!vc && gridHidden(vc, k, f);
  }

  /** Physics / statics: the band a volume membership adds right now ({floor, ceil} into `out`); false = none. */
  volumeBandOf(c: VolumeColumn, out: {floor: number; ceil: number}): boolean {
    if (!volumeBand(c, this.list.length)) return false;
    out.floor = VB.floor; out.ceil = VB.ceil;
    return true;
  }

  private reindexVolumes(): void {
    this.volumeVersion++;
    if (!this.volList.length) { this.volCells = null; this.volMask = null; return; }
    const m = new Map<number, VolumeColumn[]>();
    const g0 = this.main, nl = this.list.length;
    const mask = new Uint8Array(g0.w * g0.h);
    const add = (cx: number, cy: number, v: DynamicVolume, gate: VolumeGate | null) => {
      if (!g0.inBounds(cx, cy)) return;
      const i = cy * g0.w + cx;
      const hide = new Uint8Array(nl), at = new Float64Array(nl);
      const stops = v.stops ?? [v.floorY];
      const lo = Math.min(...stops) - STOP_TOL, hi = Math.max(...stops) + (v.ceilY - v.floorY) + STOP_TOL;
      for (let k = 0; k < nl; k++) {
        const g = this.list[k].grid;
        if (!isOpen(g, i)) continue;
        const f = g.floorOf(i);
        at[k] = f;
        if (gate ? stops.some(s => Math.abs(f - s) <= STOP_TOL) : f >= lo && f <= hi) hide[k] = 1;
      }
      let list = m.get(i);
      if (!list) m.set(i, (list = []));
      if (list.length < VOL_MAX) list.push({v, gate, hide, at});
      mask[i] = 1;
    };
    const cellsOf = (x0: number, z0: number, x1: number, z1: number, fn: (cx: number, cy: number) => void) => {
      for (let cy = Math.floor(z0 / CELL); cy <= Math.floor(z1 / CELL); cy++) {
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
          const mx = (cx + 0.5) * CELL, mz = (cy + 0.5) * CELL;
          if (mx > x0 && mx < x1 && mz > z0 && mz < z1) fn(cx, cy);
        }
      }
    };
    for (const v of this.volList) {
      cellsOf(v.x0, v.z0, v.x1, v.z1, (cx, cy) => add(cx, cy, v, null));
      for (const g of v.gates) {
        const a0 = Math.min(g.a0, g.a1), a1 = Math.max(g.a0, g.a1), d = Math.max(0, g.depth);
        if (g.side === 'N') cellsOf(a0, v.z0 - d, a1, v.z0, (cx, cy) => add(cx, cy, v, g));
        else if (g.side === 'S') cellsOf(a0, v.z1, a1, v.z1 + d, (cx, cy) => add(cx, cy, v, g));
        else if (g.side === 'W') cellsOf(v.x0 - d, a0, v.x0, a1, (cx, cy) => add(cx, cy, v, g));
        else cellsOf(v.x1, a0, v.x1 + d, a1, (cx, cy) => add(cx, cy, v, g));
      }
    }
    this.volCells = m;
    this.volMask = mask;
  }

  /** Column index of world (x, z), or -1 outside. */
  cellIndex(wx: number, wz: number): number {
    const g0 = this.main;
    const cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
    return g0.inBounds(cx, cy) ? cy * g0.w + cx : -1;
  }

  /** Free bands of the column at world (x, z), sorted by floor (ramps use their local height). */
  bands(wx: number, wz: number, out: Band[] = []): Band[] {
    out.length = 0;
    const g0 = this.main;
    const cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
    if (!g0.inBounds(cx, cy)) return out;
    const i = cy * g0.w + cx;
    const vc = this.vcol(i);
    for (let k = 0; k < this.list.length; k++) {
      const L = this.list[k], g = L.grid;
      if (!isOpen(g, i)) continue;
      const f = floorNearCell(g, i, cx, cy, wx, wz);
      if (vc && gridHidden(vc, k, f)) continue;
      out.push({level: L.id, floor: f, ceil: ceilNearCell(g, i, cx, cy, wx, wz)});
    }
    if (vc) for (const c of vc) if (volumeBand(c, this.list.length)) out.push({level: c.v.level, floor: VB.floor, ceil: VB.ceil});
    out.sort((a, b) => a.floor - b.floor);
    return out;
  }

  /** True when (x, y, z) lies inside some level's open band. */
  isFree(wx: number, y: number, wz: number): boolean {
    const g0 = this.main;
    const cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
    if (!g0.inBounds(cx, cy)) return false;
    const i = cy * g0.w + cx;
    const vc = this.vcol(i);
    for (let k = 0; k < this.list.length; k++) {
      const g = this.list[k].grid;
      if (!isOpen(g, i)) continue;
      const f = floorNearCell(g, i, cx, cy, wx, wz);
      if (vc && gridHidden(vc, k, f)) continue;
      if (y >= f - 1e-4 && y <= ceilNearCell(g, i, cx, cy, wx, wz) + 1e-4) return true;
    }
    if (vc) for (const c of vc) if (volumeBand(c, this.list.length) && y >= VB.floor - 1e-4 && y <= VB.ceil + 1e-4) return true;
    return false;
  }

  /**
   * The surface an actor whose feet are at height y stands on at (x, z): the highest open floor
   * at or below y + tol whose band contains the feet; failing that (a query from inside a slab or
   * from far above, e.g. y = Infinity for "top floor"), the highest floor at or below y + tol of a
   * band at least 0.5 m tall. null over a wall / outside.
   */
  supportAt(wx: number, wz: number, y: number, tol = STEP_UP): Support | null {
    return this.support(wx, wz, y, tol, false);
  }

  /**
   * Strict support for physical bodies: like supportAt, but only bands that contain the feet
   * (null when the point is inside a slab or wall: callers keep their height rather than drop
   * through a floor).
   */
  supportIn(wx: number, wz: number, y: number, tol = STEP_UP): Support | null {
    return this.support(wx, wz, y, tol, true);
  }

  private support(wx: number, wz: number, y: number, tol: number, strict: boolean): Support | null {
    const g0 = this.main;
    const cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
    if (!g0.inBounds(cx, cy)) return null;
    const i = cy * g0.w + cx;
    let best: Support | null = null, loose: Support | null = null;
    const vc = this.vcol(i);
    for (let k = 0; k < this.list.length; k++) {
      const L = this.list[k], g = L.grid;
      if (!isOpen(g, i)) continue;
      const f = floorNearCell(g, i, cx, cy, wx, wz);
      if (f > y + tol) continue;
      if (vc && gridHidden(vc, k, f)) continue;
      const c = ceilNearCell(g, i, cx, cy, wx, wz);
      if (c >= y - CAP_TOL) {
        if (!best || f > best.floor) best = {level: L.id, floor: f, ceil: c, cell: i, area: g.area[i]};
      } else if (!strict && c >= f + 0.5 && (!loose || f > loose.floor)) loose = {level: L.id, floor: f, ceil: c, cell: i, area: g.area[i]};
    }
    if (vc) {
      for (const cv of vc) {
        if (!volumeBand(cv, this.list.length)) continue;
        const f = VB.floor, c = VB.ceil, v = cv.v;
        if (f > y + tol) continue;
        if (c >= y - CAP_TOL) {
          if (!best || f > best.floor) best = {level: v.level, floor: f, ceil: c, cell: i, area: v.area ?? -1, volume: v};
        } else if (!strict && c >= f + 0.5 && (!loose || f > loose.floor)) loose = {level: v.level, floor: f, ceil: c, cell: i, area: v.area ?? -1, volume: v};
      }
    }
    return best ?? loose;
  }

  /**
   * Task frame-budget-deferral-20261030 (lane MEASURE): `supportIn(wx, wz, y, tol)?.floor` without allocating — the same band
   * choice as support(…, strict) (first of the highest floors, grid levels then volumes); -Infinity when nothing supports
   * the feet (a real floor is never -Infinity). walkLineClear's per-sample query (A* string pulling).
   */
  private supportFloorIn(wx: number, wz: number, y: number, tol: number): number {
    const g0 = this.main;
    const cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
    if (!g0.inBounds(cx, cy)) return -Infinity;
    const i = cy * g0.w + cx;
    let has = false, best = 0;
    const vc = this.vcol(i);
    for (let k = 0; k < this.list.length; k++) {
      const g = this.list[k].grid;
      if (!isOpen(g, i)) continue;
      const f = floorNearCell(g, i, cx, cy, wx, wz);
      if (f > y + tol) continue;
      if (vc && gridHidden(vc, k, f)) continue;
      if (ceilNearCell(g, i, cx, cy, wx, wz) >= y - CAP_TOL && (!has || f > best)) { has = true; best = f; }
    }
    if (vc) {
      for (const cv of vc) {
        if (!volumeBand(cv, this.list.length)) continue;
        const f = VB.floor;
        if (f > y + tol) continue;
        if (VB.ceil >= y - CAP_TOL && (!has || f > best)) { has = true; best = f; }
      }
    }
    return has ? best : -Infinity;
  }

  /** Floor under an actor at height y (or -Infinity when nothing supports it). */
  floorAt(wx: number, wz: number, y: number, tol = STEP_UP): number {
    return this.supportAt(wx, wz, y, tol)?.floor ?? -Infinity;
  }
  /** Ceiling above an actor at height y (Infinity when unset / outside). */
  ceilAt(wx: number, wz: number, y: number, tol = STEP_UP): number {
    return this.supportAt(wx, wz, y, tol)?.ceil ?? Infinity;
  }
  /** Level index an actor at height y is on (-1 when unsupported). */
  levelAt(wx: number, wz: number, y: number, tol = STEP_UP): number {
    return this.supportAt(wx, wz, y, tol)?.level ?? -1;
  }
  /** Area id under an actor at height y (-1 when unsupported). */
  areaAt(wx: number, wz: number, y: number, tol = STEP_UP): number {
    return this.supportAt(wx, wz, y, tol)?.area ?? -1;
  }
  /** Physical surface (stair tread tops) under an actor at height y; NaN when unsupported. */
  stepAt(wx: number, wz: number, y: number, tol = STEP_UP): number {
    const s = this.supportAt(wx, wz, y, tol);
    if (!s) return NaN;
    if (s.volume) return s.floor; // the cab floor is flat
    const g = this.grid(s.level), cx = Math.floor(wx / CELL), cy = Math.floor(wz / CELL);
    return stepNearCell(g, s.cell, cx, cy, wx, wz);
  }
  /** Grid cell value (SOLID / FLOOR / VOID) of the level an actor at height y stands on (SOLID when unsupported). */
  cellKindAt(wx: number, wz: number, y: number): number {
    const s = this.supportAt(wx, wz, y);
    return s ? (s.volume ? FLOOR : this.grid(s.level).cells[s.cell]) : 0;
  }

  // -------------------------------------------------------------------------------------------
  // Collision (core/physics.ts) and headroom

  /**
   * Whether column (cx, cy) blocks a walking body centred at (x, z) with feet at `feet` and clear
   * height `height`: no band whose floor (nearest point) is within STEP_UP above the feet and whose
   * ceiling leaves `height` over max(feet, floor). Slab edges, risers, low soffits and walls block;
   * a drop (platform edge, open aperture) does not.
   */
  blocksAt(cx: number, cy: number, x: number, z: number, feet: number, height = BODY_CLEAR): boolean {
    const g0 = this.main;
    if (!g0.inBounds(cx, cy)) return true;
    const i = cy * g0.w + cx;
    const vc = this.vcol(i);
    for (let k = 0; k < this.list.length; k++) {
      const g = this.list[k].grid;
      if (!isOpen(g, i)) continue;
      const f = floorNearCell(g, i, cx, cy, x, z);
      if (f > feet + STEP_UP) continue;
      if (vc && gridHidden(vc, k, f)) continue;
      const c = ceilNearCell(g, i, cx, cy, x, z);
      if (c < Math.max(feet, f) + height - 0.02) continue;
      return false;
    }
    if (vc) for (const c of vc) if (volumeBand(c, this.list.length) && VB.floor <= feet + STEP_UP && VB.ceil >= Math.max(feet, VB.floor) + height - 0.02) return false;
    return true;
  }

  /** Ceiling of the band holding a body with feet at `feet` in column (cx, cy) at its point nearest (x, z) (NaN: none). */
  bandCeil(cx: number, cy: number, x: number, z: number, feet: number): number {
    const g0 = this.main;
    if (!g0.inBounds(cx, cy)) return NaN;
    const i = cy * g0.w + cx;
    let bf = -Infinity, bc = NaN;
    const vc = this.vcol(i);
    for (let k = 0; k < this.list.length; k++) {
      const g = this.list[k].grid;
      if (!isOpen(g, i)) continue;
      const f = floorNearCell(g, i, cx, cy, x, z);
      if (f > feet + STEP_UP || f <= bf) continue;
      if (vc && gridHidden(vc, k, f)) continue;
      const c = ceilNearCell(g, i, cx, cy, x, z);
      if (c <= feet) continue;
      bf = f; bc = c;
    }
    if (vc) for (const c of vc) if (volumeBand(c, this.list.length) && VB.floor <= feet + STEP_UP && VB.floor > bf && VB.ceil > feet) { bf = VB.floor; bc = VB.ceil; }
    return bc;
  }

  /**
   * Lowest ceiling over a circle's footprint for the band the body (feet height) is in: area
   * ceilings, lintels, slab undersides, ceilings following flights, the underside of a stair
   * flight overhead. Columns with no band at that height are ignored (walls). Infinity if none.
   */
  ceilingOver(x: number, z: number, r: number, feet: number): number {
    let ceil = Infinity;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((z - r) / CELL), y1 = Math.floor((z + r) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const nx = Math.max(cx * CELL, Math.min(x, (cx + 1) * CELL)), nz = Math.max(cy * CELL, Math.min(z, (cy + 1) * CELL));
        if ((x - nx) ** 2 + (z - nz) ** 2 >= r * r) continue;
        const c = this.bandCeil(cx, cy, x, z, feet);
        if (c < ceil) ceil = c;
      }
    }
    return ceil;
  }

  // -------------------------------------------------------------------------------------------
  // Railings

  /** Every railing run: the layout's list when it has one, else Level.rails / derived per level (cached). */
  get rails(): readonly RailRun[] {
    if (!this.railList) this.railList = this.explicitRails ? [...this.explicitRails] : this.withoutVolumes(() => this.buildRails());
    return this.railList;
  }

  /** Static derivations (railings) never see the moving volumes. */
  private withoutVolumes<T>(fn: () => T): T {
    const saved = this.volCells, mask = this.volMask;
    this.volCells = null; this.volMask = null;
    try { return fn(); } finally { this.volCells = saved; this.volMask = mask; }
  }

  /** Solid parapet runs (block rays below their top). */
  get parapets(): readonly RailRun[] {
    if (!this.parapetList) this.parapetList = this.rails.filter(r => r.kind === 'parapet');
    return this.parapetList;
  }

  /**
   * QA / generator check: derived drop edges (the RAIL_DROP rule) that no railing covers — places a
   * body can walk off a deck. Empty when the layout derives its rails.
   */
  unrailedDrops(): RailRun[] {
    if (!this.explicitRails) return [];
    return this.withoutVolumes(() => this.unrailedDropsNow());
  }

  private unrailedDropsNow(): RailRun[] {
    const out: RailRun[] = [];
    for (const L of this.list) {
      for (const e of this.deriveRails(L)) {
        const mx = (e.x0 + e.x1) / 2, mz = (e.z0 + e.z1) / 2, base = (e.y0 + e.y1) / 2;
        const i = this.cellIndex(mx - e.nx * 0.01, mz - e.nz * 0.01);
        const near = i >= 0 ? this.railsAt(i) : undefined;
        if (!near?.some(r => segSegDist(mx, mz, mx, mz, r.x0, r.z0, r.x1, r.z1) < 0.05 && Math.abs(Levels.railBaseAt(r, mx, mz) - base) < 0.6)) out.push(e);
      }
    }
    return mergeRails(out);
  }

  /** Railings touching column index i (cells on both sides of the railed edge). */
  railsAt(i: number): readonly RailRun[] | undefined {
    if (!this.railIndex) this.buildRailIndex();
    return this.railIndex!.get(i);
  }

  /** The rail column index (built once, like the rails it indexes) + its typed-array mask (task frame-budget-deferral-20261030). */
  private buildRailIndex(): void {
    const m = new Map<number, RailRun[]>();
    const g0 = this.main;
    const mask = new Uint8Array(g0.w * g0.h);
    for (const r of this.rails) {
      const xa = Math.min(r.x0, r.x1), xb = Math.max(r.x0, r.x1), za = Math.min(r.z0, r.z1), zb = Math.max(r.z0, r.z1);
      const cx0 = Math.floor((xa - 0.01) / CELL), cx1 = Math.floor((xb + 0.01) / CELL), cy0 = Math.floor((za - 0.01) / CELL), cy1 = Math.floor((zb + 0.01) / CELL);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        if (!g0.inBounds(cx, cy)) continue;
        const k = cy * g0.w + cx;
        let a = m.get(k);
        if (!a) m.set(k, (a = []));
        a.push(r);
        mask[k] = 1;
      }
    }
    this.railIndex = m;
    this.railMask = mask;
  }

  private buildRails(): RailRun[] {
    const out: RailRun[] = [];
    const edges: RailRun[] = [];
    const seen = new Set<string>();
    for (const L of this.list) {
      if (L.rails) { out.push(...L.rails); continue; }
      // unit edges; a stair band carved into two levels derives the same edge twice: keep one
      for (const e of this.deriveRails(L)) {
        const k = `${e.x0},${e.z0},${e.x1},${e.z1},${e.nx},${e.nz},${Math.round(e.y0 * 100)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        edges.push(e);
      }
    }
    out.push(...mergeRails(edges));
    return out;
  }

  /**
   * Derived railing edges of one level: every open cell edge where an actor standing on the edge
   * (floor at the edge midpoint) who steps across finds support more than RAIL_DROP lower (an
   * aperture / mezzanine edge, or the same level continuing far below: the side of a flight).
   */
  private deriveRails(L: Level): RailRun[] {
    const g = L.grid, W = g.w, H = g.h;
    const edges: RailRun[] = [];
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        const i = cy * W + cx;
        if (!isOpen(g, i)) continue;
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (!g.inBounds(nx, ny)) continue;
          const j = ny * W + nx;
          // edge midpoint and endpoints (world)
          const ex = dx ? (dx > 0 ? (cx + 1) * CELL : cx * CELL) : (cx + 0.5) * CELL;
          const ez = dy ? (dy > 0 ? (cy + 1) * CELL : cy * CELL) : (cy + 0.5) * CELL;
          const fi = floorNearCell(g, i, cx, cy, ex, ez);
          if (isOpen(g, j) && fi - floorNearCell(g, j, nx, ny, ex, ez) <= RAIL_DROP) continue;
          const s = this.supportIn(ex + dx * 0.02, ez + dy * 0.02, fi, STEP_UP);
          if (!s || fi - s.floor <= RAIL_DROP) continue;
          // base at both ends of the edge (a flight side follows the pitch)
          let x0: number, z0: number, x1: number, z1: number;
          if (dx) { x0 = x1 = ex; z0 = cy * CELL; z1 = (cy + 1) * CELL; } else { z0 = z1 = ez; x0 = cx * CELL; x1 = (cx + 1) * CELL; }
          const b0 = floorNearCell(g, i, cx, cy, x0 - dx * 0.001, z0 - dy * 0.001), b1 = floorNearCell(g, i, cx, cy, x1 - dx * 0.001, z1 - dy * 0.001);
          edges.push({level: L.id, x0, z0, x1, z1, y0: b0, y1: b1, nx: -dx, nz: -dy, kind: 'railing', h: RAIL_H});
        }
      }
    }
    return edges;
  }

  /** Base height of a rail at the point of its line nearest (x, z). */
  static railBaseAt(r: RailRun, x: number, z: number): number {
    const lx = r.x1 - r.x0, lz = r.z1 - r.z0, l2 = lx * lx + lz * lz;
    const t = l2 > 0 ? clamp(((x - r.x0) * lx + (z - r.z0) * lz) / l2, 0, 1) : 0;
    return r.y0 + (r.y1 - r.y0) * t;
  }

  // -------------------------------------------------------------------------------------------
  // 3D raycast / line of sight

  /**
   * 3D ray through the union of open columns: DDA over the cells the ray's horizontal projection
   * crosses; inside a column the ray is in one band (floor / ceiling linear on ramps) and hits its
   * floor ('floor', ny = +1) or ceiling / slab underside ('ceiling', ny = -1) when it leaves it
   * (overlapping bands chain); entering a column at a height no band holds is a 'wall' (walls,
   * risers, the platform face, slab edges, lintels). Optional exact props (absolute boxes) and
   * sight-blocking prop cells. With a single level this is exactly the iteration-05 hitscan.
   */
  raycast(o: Vec3, d: Vec3, maxDist: number, opts: RaycastOpts = {}): LevelHit {
    const best = this.structuralRay(o, d, maxDist, opts);
    this.parapetRay(o, d, best);
    const props = opts.props;
    if (props) {
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        // cheap reject: distance from ray origin
        const dx = p.x - o.x, dz = p.z - o.z;
        if (dx * dx + dz * dz > (best.t + 2) * (best.t + 2)) continue;
        // lane FIX (U04): round props (mall atrium columns) are hit as their upright cylinder, not the square box
        const h = p.round ? rayCylinder(o, d, p.x, p.z, p.hx, p.y, p.y + p.h) : rayBox(o, d, p.x - p.hx, p.y, p.z - p.hz, p.x + p.hx, p.y + p.h, p.z + p.hz);
        if (h && h.t < best.t) {
          best.t = h.t; best.kind = 'prop'; best.nx = h.n[0]; best.ny = h.n[1]; best.nz = h.n[2]; best.prop = i;
          best.cell = this.cellIndex(o.x + d.x * h.t, o.z + d.z * h.t);
          best.level = this.levelAt(o.x + d.x * h.t, o.z + d.z * h.t, p.y + 0.01, 0.1);
        }
      }
    }
    return best;
  }

  /** Solid parapets (thin boxes along their edge, base..base + h) nearer than the current hit. */
  private parapetRay(o: Vec3, d: Vec3, best: LevelHit): void {
    const list = this.parapets;
    if (!list.length) return;
    for (const r of list) {
      const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2, len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      const dx = mx - o.x, dz = mz - o.z;
      if (dx * dx + dz * dz > (best.t + len + 1) ** 2) continue;
      const h = r.h ?? RAIL_H;
      const hit = rayBox(o, d, Math.min(r.x0, r.x1) - RAIL_HALF, Math.min(r.y0, r.y1), Math.min(r.z0, r.z1) - RAIL_HALF, Math.max(r.x0, r.x1) + RAIL_HALF, Math.max(r.y0, r.y1) + h, Math.max(r.z0, r.z1) + RAIL_HALF);
      if (!hit || hit.t >= best.t) continue;
      // sloped parapets: below the top at the hit point
      const px = o.x + d.x * hit.t, py = o.y + d.y * hit.t, pz = o.z + d.z * hit.t;
      if (py > Levels.railBaseAt(r, px, pz) + h) continue;
      best.t = hit.t; best.kind = 'wall'; best.nx = hit.n[0]; best.ny = hit.n[1]; best.nz = hit.n[2]; best.level = r.level; best.cell = this.cellIndex(px, pz);
      delete best.prop;
    }
  }

  private structuralRay(o: Vec3, d: Vec3, tMax: number, opts: RaycastOpts): LevelHit {
    const g0 = this.main, W = g0.w;
    const L = this.list, nl = L.length;
    // bands per column: the grid levels, then (lane LIFT) up to VOL_MAX dynamic-volume bands (none: exactly the old path)
    const vols = this.volCells, nb = vols ? nl + VOL_MAX : nl;
    const voidY = opts.trenchY, unset = opts.unsetCeil ?? Infinity;
    const none = (): LevelHit => ({t: tMax, kind: 'none', level: -1, nx: 0, ny: 0, nz: 0, cell: -1});
    let cx = Math.floor(o.x / CELL), cy = Math.floor(o.z / CELL);
    const hl = Math.hypot(d.x, d.z);
    if (!g0.inBounds(cx, cy)) return {t: 0, kind: 'wall', level: -1, nx: hl > 1e-9 ? -d.x / hl : 0, ny: 0, nz: hl > 1e-9 ? -d.z / hl : 0, cell: -1};
    if (!this.rayScratch || this.rayScratch.open.length !== nb) {
      this.rayScratch = {fA: new Float64Array(nb), cA: new Float64Array(nb), fB: new Float64Array(nb), cB: new Float64Array(nb), open: new Uint8Array(nb), lid: new Int32Array(nb)};
      for (let k = 0; k < nl; k++) this.rayScratch.lid[k] = L[k].id;
    }
    const {fA, cA, fB, cB, open, lid} = this.rayScratch;
    const evalCol = (i: number, ccx: number, ccy: number, ax: number, az: number, bx: number, bz: number) => {
      let any = false;
      const vc = vols ? this.vcol(i) : undefined;
      for (let k = 0; k < nl; k++) {
        const g = L[k].grid;
        if (!isOpen(g, i)) { open[k] = 0; continue; }
        fA[k] = floorNearCell(g, i, ccx, ccy, ax, az, voidY);
        if (vc && gridHidden(vc, k, fA[k])) { open[k] = 0; continue; }
        open[k] = 1; any = true;
        cA[k] = ceilNearCell(g, i, ccx, ccy, ax, az, unset);
        fB[k] = floorNearCell(g, i, ccx, ccy, bx, bz, voidY); cB[k] = ceilNearCell(g, i, ccx, ccy, bx, bz, unset);
      }
      if (vols) {
        let k = nl;
        if (vc) for (const c of vc) {
          if (k >= nb || !volumeBand(c, nl)) continue;
          open[k] = 1; any = true; lid[k] = c.v.level;
          fA[k] = fB[k] = VB.floor; cA[k] = cB[k] = VB.ceil;
          k++;
        }
        for (; k < nb; k++) open[k] = 0;
      }
      return any;
    };
    // band holding height y at the entry point (prefer `prefer`); -1 none
    const pick = (y: number, prefer: number, tol: number): number => {
      if (prefer >= 0 && open[prefer] && y >= fA[prefer] - tol && y <= cA[prefer] + tol) return prefer;
      for (let k = 0; k < nb; k++) if (open[k] && y >= fA[k] - tol && y <= cA[k] + tol) return k;
      return -1;
    };
    let i = cy * W + cx;
    // origin column
    if (hl < 1e-6) {
      if (!evalCol(i, cx, cy, o.x, o.z, o.x, o.z)) return {t: 0, kind: 'wall', level: -1, nx: 0, ny: 0, nz: 0, cell: i};
      let k = pick(o.y, -1, 1e-3);
      if (k < 0) k = nearestBand(o.y, open, fA, cA, nb);
      // effective floor / ceiling through chained overlapping bands
      let f = fA[k], c = cA[k];
      for (let changed = true; changed;) {
        changed = false;
        for (let m = 0; m < nb; m++) {
          if (!open[m]) continue;
          if (fA[m] < f && cA[m] >= f - 1e-4) { f = fA[m]; changed = true; }
          if (cA[m] > c && fA[m] <= c + 1e-4) { c = cA[m]; changed = true; }
        }
      }
      if (d.y < 0) { const t = (f - o.y) / d.y; return t >= 0 && t < tMax ? {t, kind: 'floor', level: lid[k], nx: 0, ny: 1, nz: 0, cell: i} : none(); }
      // Task office-overhaul-20261030 (lane STRUCT): an open-sky band top is no surface (the ray flies into the sky).
      if (d.y > 0) { const t = (c - o.y) / d.y; return t >= 0 && t < tMax && !(this.skyOpen(i) && c >= this.sky!.ceil - 1e-3) ? {t, kind: 'ceiling', level: lid[k], nx: 0, ny: -1, nz: 0, cell: i} : none(); } // (lane ROOF: + skyOpen)
      return none();
    }
    const ux = d.x / hl, uz = d.z / hl;
    const stepX = ux > 0 ? 1 : -1, stepY = uz > 0 ? 1 : -1;
    const dX = ux !== 0 ? Math.abs(CELL / ux) : Infinity, dY = uz !== 0 ? Math.abs(CELL / uz) : Infinity;
    let mX = ux !== 0 ? ((ux > 0 ? (cx + 1) * CELL - o.x : o.x - cx * CELL) / Math.abs(ux)) : Infinity;
    let mY = uz !== 0 ? ((uz > 0 ? (cy + 1) * CELL - o.z : o.z - cy * CELL) / Math.abs(uz)) : Infinity;
    let tA = 0, lastX = false, cur = -1;
    const sight = !!opts.sightProps;
    for (let guard = 0; guard < 8192 && tA < tMax; guard++) {
      // (lane STRUCT: leaving the grid above the roof parapet = open sky, no hit)
      if (!g0.inBounds(cx, cy)) return this.sky && this.openAir(-1, o.y + d.y * tA) ? none() : {t: tA, kind: 'wall', level: cur >= 0 ? lid[cur] : -1, nx: lastX ? -stepX : 0, ny: 0, nz: lastX ? 0 : -stepY, cell: -1};
      i = cy * W + cx;
      const tB = Math.min(tMax, Math.min(mX, mY) / hl);
      const ax = o.x + d.x * tA, ay = o.y + d.y * tA, az = o.z + d.z * tA;
      const bx = o.x + d.x * tB, by = o.y + d.y * tB, bz = o.z + d.z * tB;
      // (cur's level id is read before evalCol may reuse a volume slot)
      const curLevel = cur >= 0 ? lid[cur] : -1;
      const any = evalCol(i, cx, cy, ax, az, bx, bz);
      if (!any) return this.sky && tA > 1e-6 && this.openAir(i, ay) ? none() : {t: tA, kind: 'wall', level: curLevel, nx: lastX ? -stepX : (tA > 0 ? 0 : -ux), ny: 0, nz: lastX ? 0 : (tA > 0 ? -stepY : -uz), cell: i};
      if (tA > 1e-6) {
        // entering this column below every floor / above every ceiling at this height: a face
        const k = pick(ay, cur, 1e-3);
        if (k < 0) return this.sky && this.openAir(i, ay) ? none() : {t: tA, kind: 'wall', level: curLevel, nx: lastX ? -stepX : 0, ny: 0, nz: lastX ? 0 : -stepY, cell: i};
        cur = k;
      } else {
        cur = pick(ay, -1, 1e-3);
        if (cur < 0) cur = nearestBand(ay, open, fA, cA, nb);
      }
      if (sight && cur < nl && L[cur].grid.sightBlocked[i] === 1) return {t: tA, kind: 'prop', level: lid[cur], nx: lastX ? -stepX : 0, ny: 0, nz: lastX ? 0 : -stepY, cell: i};
      // in-cell: leave the band through its floor or ceiling (chain into an overlapping band)
      let t0 = tA;
      for (let pass = 0; pass < 4; pass++) {
        const span = tB - tA;
        const u0 = span > 1e-12 ? (t0 - tA) / span : 0;
        const y0 = o.y + d.y * t0;
        const f0 = fA[cur] + (fB[cur] - fA[cur]) * u0, c0 = cA[cur] + (cB[cur] - cA[cur]) * u0;
        const gA = y0 - f0, gB = by - fB[cur];
        const hA = c0 - y0, hB = cB[cur] - by;
        let tf = Infinity, tc = Infinity;
        if (gA >= 0 && gB < 0) tf = t0 + (tB - t0) * gA / (gA - gB);
        if (Number.isFinite(c0) && hA >= 0 && hB < 0) tc = t0 + (tB - t0) * hA / (hA - hB);
        if (tf === Infinity && tc === Infinity) break;
        const down = tf <= tc, th = down ? tf : tc;
        const yh = o.y + d.y * th, uh = span > 1e-12 ? (th - tA) / span : 0;
        let next = -1;
        for (let m = 0; m < nb; m++) {
          if (m === cur || !open[m]) continue;
          const fm = fA[m] + (fB[m] - fA[m]) * uh, cm = cA[m] + (cB[m] - cA[m]) * uh;
          if (down ? fm < yh - 1e-4 && cm >= yh - 1e-4 : cm > yh + 1e-4 && fm <= yh + 1e-4) { next = m; break; }
        }
        if (next < 0) return down ? {t: th, kind: 'floor', level: lid[cur], nx: 0, ny: 1, nz: 0, cell: i}
          : this.skyOpen(i) && yh >= this.sky!.ceil - 1e-3 ? none() : {t: th, kind: 'ceiling', level: lid[cur], nx: 0, ny: -1, nz: 0, cell: i}; // (lane ROOF: + skyOpen)
        cur = next; t0 = th;
      }
      if (tB >= tMax) return none();
      tA = tB;
      if (mX < mY) { mX += dX; cx += stepX; lastX = true; } else { mY += dY; cy += stepY; lastX = false; }
    }
    return none();
  }

  /**
   * 3D line of sight between two points (eyes): walls, floors, ceilings / slab undersides and
   * sight-blocking prop cells block; open stairwells and apertures do not. `slack`: a blocker this
   * close to b still counts as seeing it (items resting on stair treads).
   */
  lineOfSight(a: Vec3, b: Vec3, opts: {sightProps?: boolean; slack?: number} = {}): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) return true;
    const dir = {x: dx / dist, y: dy / dist, z: dz / dist};
    const h = this.structuralRay(a, dir, dist, {sightProps: opts.sightProps ?? true});
    this.parapetRay(a, dir, h);
    return h.kind === 'none' || h.t >= dist - (opts.slack ?? 1e-4);
  }

  // -------------------------------------------------------------------------------------------
  // Nav helpers (level-aware versions of Grid.passable / circleClearH / walkLineClearH)

  /** A body can stand on level `level` at cell (cx, cy) (open, no blocking prop). */
  passable(level: number, cx: number, cy: number): boolean {
    return this.grid(level).passable(cx, cy);
  }

  /**
   * A circle standing at `feet` overlaps only columns with a passable band (no blocking prop of
   * that band's level) whose floor (nearest point) is within NAV_STEP of the feet and whose ceiling
   * leaves BODY_CLEAR — no walls, slab edges, props, ledges up or drops down.
   */
  circleClear(wx: number, wz: number, r: number, feet: number): boolean {
    const g0 = this.main;
    const x0 = Math.floor((wx - r) / CELL), x1 = Math.floor((wx + r) / CELL);
    const y0 = Math.floor((wz - r) / CELL), y1 = Math.floor((wz + r) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        let ok = false;
        if (g0.inBounds(cx, cy)) {
          const i = cy * g0.w + cx;
          const vc = this.vcol(i);
          const NL = this.list.length, h = this.clearHint < NL ? this.clearHint : 0;
          for (let q = 0; q < NL; q++) {
            // lane MEASURE: the hinted level first, then the others in index order (each exactly once; no side effects)
            const k = q === 0 ? h : q <= h ? q - 1 : q;
            const g = this.list[k].grid;
            if (!isOpen(g, i) || g.blocked[i]) continue;
            const f = floorNearCell(g, i, cx, cy, wx, wz);
            if (Math.abs(f - feet) > NAV_STEP) continue;
            if (vc && gridHidden(vc, k, f)) continue;
            if (ceilNearCell(g, i, cx, cy, wx, wz) < Math.max(f, feet) + BODY_CLEAR) continue;
            ok = true;
            this.clearHint = k;
            break;
          }
          if (!ok && vc) for (const c of vc) if (volumeBand(c, this.list.length) && Math.abs(VB.floor - feet) <= NAV_STEP && VB.ceil >= Math.max(VB.floor, feet) + BODY_CLEAR) { ok = true; break; }
        }
        if (ok) continue;
        const nx = Math.max(cx * CELL, Math.min(wx, (cx + 1) * CELL));
        const nz = Math.max(cy * CELL, Math.min(wz, (cy + 1) * CELL));
        if ((wx - nx) ** 2 + (wz - nz) ** 2 < r * r) return false;
      }
    }
    return !this.railCrosses(wx, wz, wx, wz, r, feet);
  }

  /**
   * Height-aware straight walk from feet height ay at a to b: the feet follow the support (stairs
   * up / down, no drop or step over 0.3 m between samples), every sample's circle is clear and no
   * railing crosses the line. `by`: the walk must end at that height (same storey).
   */
  walkLineClear(ax: number, ay: number, az: number, bx: number, bz: number, r: number, by?: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (CELL * 0.4)));
    // lane MEASURE: supportIn(…)?.floor without allocating a Support per sample (A* string pulling calls this ~10^5 times a path)
    const f0 = this.supportFloorIn(ax, az, ay + 0.05, NAV_STEP);
    let feet = f0 === -Infinity ? ay : f0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const s = this.supportFloorIn(px, pz, feet, NAV_STEP);
      if (s === -Infinity || Math.abs(s - feet) > 0.3) return false;
      feet = s;
      if (!this.circleClear(px, pz, r, feet)) return false;
    }
    if (this.railCrosses(ax, az, bx, bz, r * 0.5, feet)) return false;
    return by === undefined || Math.abs(feet - by) <= 0.35;
  }

  /** Whether a railing at about `feet` height lies within `r` of the segment a-b. */
  railCrosses(ax: number, az: number, bx: number, bz: number, r: number, feet: number): boolean {
    if (!this.rails.length) return false;
    if (!this.railIndex) this.buildRailIndex();
    const g0 = this.main, mask = this.railMask!, index = this.railIndex!;
    const x0 = Math.floor((Math.min(ax, bx) - r) / CELL), x1 = Math.floor((Math.max(ax, bx) + r) / CELL);
    const y0 = Math.floor((Math.min(az, bz) - r) / CELL), y1 = Math.floor((Math.max(az, bz) + r) / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!g0.inBounds(cx, cy)) continue;
      const k = cy * g0.w + cx;
      if (!mask[k]) continue; // lane MEASURE: no rail at this column (the typed array before the map lookup)
      const list = index.get(k);
      if (!list) continue;
      for (const rl of list) {
        const base = Levels.railBaseAt(rl, (ax + bx) / 2, (az + bz) / 2);
        if (feet > base + (rl.h ?? RAIL_H) - 0.3 || feet < base - 0.6) continue;
        if (segSegDist(ax, az, bx, bz, rl.x0, rl.z0, rl.x1, rl.z1) < r + RAIL_HALF) return true;
      }
    }
    return false;
  }

  /**
   * PathFinder / reachable(): neighbour steps a railing closes — every unit cell edge under a rail
   * run, on each level open on both sides at about the rail's base height (a deck edge, the side of
   * a flight above the platform, a stairwell rim).
   */
  blockedEdges(): readonly {level: number; a: number; b: number}[] {
    if (this.edgeList) return this.edgeList;
    const out: {level: number; a: number; b: number}[] = [];
    const g0 = this.main, W = g0.w;
    for (const r of this.rails) {
      const alongX = Math.abs(r.z1 - r.z0) < 1e-6;
      if (!alongX && Math.abs(r.x1 - r.x0) > 1e-6) continue; // not axis-aligned
      const s0 = alongX ? Math.min(r.x0, r.x1) : Math.min(r.z0, r.z1), s1 = alongX ? Math.max(r.x0, r.x1) : Math.max(r.z0, r.z1);
      const line = Math.round((alongX ? r.z0 : r.x0) / CELL);
      for (let k = Math.floor(s0 / CELL + 1e-6); k < Math.ceil(s1 / CELL - 1e-6); k++) {
        const [ax, ay, bx, by] = alongX ? [k, line - 1, k, line] : [line - 1, k, line, k];
        if (!g0.inBounds(ax, ay) || !g0.inBounds(bx, by)) continue;
        const a = ay * W + ax, b = by * W + bx;
        const mx = alongX ? (k + 0.5) * CELL : line * CELL, mz = alongX ? line * CELL : (k + 0.5) * CELL;
        const base = Levels.railBaseAt(r, mx, mz);
        for (const L of this.list) {
          const g = L.grid;
          if (!isOpen(g, a) || !isOpen(g, b)) continue;
          if (Math.abs(g.floorOf(a) - base) > 0.7 && Math.abs(g.floorOf(b) - base) > 0.7) continue;
          out.push({level: L.id, a, b});
        }
      }
    }
    this.edgeList = out;
    return out;
  }

  /** PathFinder: cross-level ladder links (LevelLinks with a traversal ladder id not already a same-level grid link). */
  crossLinks(): readonly CrossLink[] {
    const out: CrossLink[] = [];
    const known = new Set<number>();
    for (const L of this.list) for (const l of L.grid.links) known.add(l.id);
    const g0 = this.main;
    for (const k of this.links) {
      if (k.kind !== 'ladder' || k.traversalId === undefined || known.has(k.traversalId)) continue;
      const [ax, ay] = g0.cellOf(k.bottom.x, k.bottom.z), [bx, by] = g0.cellOf(k.top.x, k.top.z);
      if (!g0.inBounds(ax, ay) || !g0.inBounds(bx, by)) continue;
      out.push({la: k.lower, a: g0.idx(ax, ay), lb: k.upper, b: g0.idx(bx, by), cost: k.cost ?? 10, id: k.traversalId, pa: {...k.bottom}, pb: {...k.top}});
    }
    return out;
  }

  /** Node index (level, cell) used by PathFinder / reachable(). */
  node(level: number, cell: number): number {
    return level * this.main.w * this.main.h + cell;
  }

  /**
   * Walking distance (cell steps) from (level, cx, cy) to every node (level * cells + cell; -1 =
   * unreachable): NAV_STEP neighbours per level, shared stair cells between levels, same-level nav
   * links and cross-level ladder links both ways, optional one-way drops down to MAX_DROP.
   */
  reachable(level: number, cx: number, cy: number, opts: {drops?: boolean; noLinks?: boolean} = {}): Int32Array {
    const g0 = this.main, W = g0.w, H = g0.h, NC = W * H, nl = this.list.length;
    const dist = new Int32Array(NC * nl).fill(-1);
    if (!this.grid(level).passable(cx, cy)) return dist;
    const fl = new Float32Array(NC * nl), ok = new Uint8Array(NC * nl);
    for (let k = 0; k < nl; k++) {
      const g = this.list[k].grid;
      for (let i = 0; i < NC; i++) { const c = g.cells[i]; if ((c === FLOOR || c === VOID) && !g.blocked[i]) { ok[k * NC + i] = 1; fl[k * NC + i] = g.floorOf(i); } }
    }
    const links = new Map<number, number[]>();
    const addL = (a: number, b: number) => { let x = links.get(a); if (!x) links.set(a, (x = [])); x.push(b); };
    if (!opts.noLinks) {
      for (let k = 0; k < nl; k++) for (const l of this.list[k].grid.links) { addL(k * NC + l.a, k * NC + l.b); addL(k * NC + l.b, k * NC + l.a); }
      for (const l of this.crossLinks()) { addL(l.la * NC + l.a, l.lb * NC + l.b); addL(l.lb * NC + l.b, l.la * NC + l.a); }
    }
    const shut = new Set<number>();
    for (const e of this.blockedEdges()) { shut.add((e.level * NC + e.a) * 4 + edgeDir(e.b - e.a, W)); shut.add((e.level * NC + e.b) * 4 + edgeDir(e.a - e.b, W)); }
    const q = new Int32Array(NC * nl);
    let head = 0, tail = 0;
    const s = level * NC + cy * W + cx;
    dist[s] = 0; q[tail++] = s;
    while (head < tail) {
      const n = q[head++];
      const k = Math.floor(n / NC), c = n - k * NC;
      const x = c % W, y = (c - x) / W, nd = dist[n] + 1, f = fl[n];
      const nbs = [x > 0 ? n - 1 : -1, x < W - 1 ? n + 1 : -1, y > 0 ? n - W : -1, y < H - 1 ? n + W : -1];
      for (const m of nbs) {
        if (m < 0 || dist[m] >= 0 || !ok[m]) continue;
        if (shut.size && shut.has(n * 4 + edgeDir(m - n, W))) continue;
        const dh = fl[m] - f;
        if (dh > NAV_STEP || dh < (opts.drops ? -MAX_DROP : -NAV_STEP)) continue;
        dist[m] = nd; q[tail++] = m;
      }
      for (let o = 0; o < nl; o++) {
        if (o === k) continue;
        const m = o * NC + c;
        if (dist[m] < 0 && ok[m] && Math.abs(fl[m] - f) < 0.05) { dist[m] = dist[n]; q[tail++] = m; }
      }
      const ls = links.get(n);
      if (ls) for (const m of ls) if (dist[m] < 0 && ok[m]) { dist[m] = nd; q[tail++] = m; }
    }
    return dist;
  }

  /** QA / report summary: levels (open cells, floor range), links and railings. */
  summary(): {levels: {id: number; role: LevelRole; baseY: number; openCells: number; floor: [number, number]; ceil: [number, number]}[]; links: {id: number; kind: string; lower: number; upper: number; bottom: StandPoint; top: StandPoint}[]; rails: number; railMetres: number} {
    const levels = this.list.map(L => {
      const g = L.grid;
      let n = 0, f0 = Infinity, f1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      for (let i = 0; i < g.cells.length; i++) {
        if (!isOpen(g, i)) continue;
        n++;
        const f = g.floorOf(i);
        f0 = Math.min(f0, f); f1 = Math.max(f1, f);
        if (g.hasCeil(i)) { c0 = Math.min(c0, g.ceil[i]); c1 = Math.max(c1, g.ceil[i]); }
      }
      return {id: L.id, role: L.role, baseY: L.baseY, openCells: n, floor: [f0, f1] as [number, number], ceil: [c0, c1] as [number, number]};
    });
    const rails = this.rails;
    return {levels, links: this.links.map(l => ({id: l.id, kind: l.kind, lower: l.lower, upper: l.upper, bottom: l.bottom, top: l.top})), rails: rails.length,
      railMetres: Math.round(rails.reduce((s, r) => s + Math.hypot(r.x1 - r.x0, r.z1 - r.z0), 0) * 10) / 10};
  }
}

/** Direction index of a neighbour step (+x 0, -x 1, +y 2, -y 3). */
function edgeDir(d: number, W: number): number {
  return d === 1 ? 0 : d === -1 ? 1 : d === W ? 2 : 3;
}

/** Merge collinear unit rail edges (same level / side / line) while the base height continues linearly. */
function mergeRails(edges: RailRun[]): RailRun[] {
  edges.sort((a, b) => (a.level - b.level) || (a.nx - b.nx) || (a.nz - b.nz) || (a.nx ? a.x0 - b.x0 || a.z0 - b.z0 : a.z0 - b.z0 || a.x0 - b.x0));
  const runs: RailRun[] = [];
  for (const e of edges) {
    const p = runs[runs.length - 1];
    if (p && p.level === e.level && p.nx === e.nx && p.nz === e.nz && (e.nx ? p.x0 === e.x0 && Math.abs(p.z1 - e.z0) < 1e-6 : p.z0 === e.z0 && Math.abs(p.x1 - e.x0) < 1e-6) && Math.abs(p.y1 - e.y0) < 0.01) {
      const lp = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
      const sp = (p.y1 - p.y0) / lp, se = (e.y1 - e.y0) / CELL;
      if (Math.abs(sp - se) < 1e-3) { p.x1 = e.x1; p.z1 = e.z1; p.y1 = e.y1; continue; }
    }
    runs.push({...e});
  }
  return runs;
}

/** Band index nearest (vertically) to y among open bands (origin slightly outside every band). */
function nearestBand(y: number, open: Uint8Array, f: Float64Array, c: Float64Array, n: number): number {
  let best = -1, bd = Infinity;
  for (let k = 0; k < n; k++) {
    if (!open[k]) continue;
    const dd = y < f[k] ? f[k] - y : y > c[k] ? y - c[k] : 0;
    if (dd < bd) { bd = dd; best = k; }
  }
  return best;
}

/** Ray vs axis-aligned box; entry parameter and face normal, or null. */
function rayBox(o: Vec3, d: Vec3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): {t: number; n: [number, number, number]} | null {
  let tmin = -Infinity, tmax = Infinity;
  let n: [number, number, number] = [0, 0, 0];
  const O = [o.x, o.y, o.z], D = [d.x, d.y, d.z], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(D[a]) < 1e-12) {
      if (O[a] < lo[a] || O[a] > hi[a]) return null;
      continue;
    }
    let t1 = (lo[a] - O[a]) / D[a], t2 = (hi[a] - O[a]) / D[a];
    let sign = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
    if (t1 > tmin) { tmin = t1; n = [0, 0, 0]; n[a] = sign; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return {t: Math.max(0, tmin), n};
}

/**
 * Task mall-playtest-revision-20261031 (lane FIX, U04): ray vs an upright capped cylinder (axis y, centre cx / cz, radius r,
 * y0..y1). Entry t (>= 0, 0 when the origin is inside) and the outward normal at the entry (side: radial; caps: +-y).
 */
export function rayCylinder(o: Vec3, d: Vec3, cx: number, cz: number, r: number, y0: number, y1: number): {t: number; n: [number, number, number]} | null {
  const ox = o.x - cx, oz = o.z - cz;
  let tmin = -Infinity, tmax = Infinity;
  let n: [number, number, number] = [0, 0, 0];
  // radial slab: |(o + d t).xz| <= r
  const a = d.x * d.x + d.z * d.z, b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r;
  if (a < 1e-12) {
    if (c > 0) return null;
  } else {
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / a, t2 = (-b + sq) / a;
    tmin = t1; tmax = t2;
    const hx = ox + d.x * t1, hz = oz + d.z * t1, l = Math.hypot(hx, hz) || 1;
    n = [hx / l, 0, hz / l];
  }
  // vertical slab: y0 <= o.y + d.y t <= y1
  if (Math.abs(d.y) < 1e-12) {
    if (o.y < y0 || o.y > y1) return null;
  } else {
    let s1 = (y0 - o.y) / d.y, s2 = (y1 - o.y) / d.y, ny = -1;
    if (s1 > s2) { const t = s1; s1 = s2; s2 = t; ny = 1; }
    if (s1 > tmin) { tmin = s1; n = [0, ny, 0]; }
    tmax = Math.min(tmax, s2);
  }
  if (tmin > tmax || tmax < 0) return null;
  return {t: Math.max(0, tmin), n};
}

/** Distance between segments p0-p1 and q0-q1 in the XZ plane. */
function segSegDist(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const ptSeg = (px: number, pz: number, x0: number, z0: number, x1: number, z1: number) => {
    const lx = x1 - x0, lz = z1 - z0, l2 = lx * lx + lz * lz;
    const t = l2 > 0 ? clamp(((px - x0) * lx + (pz - z0) * lz) / l2, 0, 1) : 0;
    return Math.hypot(px - (x0 + lx * t), pz - (z0 + lz * t));
  };
  // proper intersection
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  const o1 = o(ax, az, bx, bz, cx, cz), o2 = o(ax, az, bx, bz, dx, dz), o3 = o(cx, cz, dx, dz, ax, az), o4 = o(cx, cz, dx, dz, bx, bz);
  if (o1 !== o2 && o3 !== o4 && o1 * o2 <= 0 && o3 * o4 <= 0 && (o1 || o2) && (o3 || o4)) return 0;
  return Math.min(ptSeg(ax, az, cx, cz, dx, dz), ptSeg(bx, bz, cx, cz, dx, dz), ptSeg(cx, cz, ax, az, bx, bz), ptSeg(dx, dz, ax, az, bx, bz));
}

/** Wrap a single-grid layout (tests, legacy callers): one main level. */
export function singleLevel(grid: Grid): Levels {
  return new Levels([{id: 0, role: 'main', grid, baseY: 0}]);
}

const wrapped = new WeakMap<object, Levels>();

/**
 * Levels of a layout-like object ({grid, levels?, levelLinks?, rails?}); cached per levels array /
 * grid. `rails` (the generator's railings) are authoritative when present.
 */
export function levelsOf(layout: {grid: Grid; levels?: Level[]; levelLinks?: LevelLink[]; rails?: readonly RailRun[]}): Levels {
  const multi = !!(layout.levels && layout.levels.length);
  const key: object = multi ? layout.levels! : layout.grid;
  let L = wrapped.get(key);
  if (!L || (layout.levelLinks !== undefined && L.links !== layout.levelLinks) || (layout.rails !== undefined && L.railSource !== layout.rails)) {
    L = multi ? new Levels(layout.levels!, layout.levelLinks ?? [], layout.rails) : new Levels([{id: 0, role: 'main', grid: layout.grid, baseY: 0}], layout.levelLinks ?? [], layout.rails);
    wrapped.set(key, L);
  }
  return L;
}

/** A Levels for either a plain Grid (one main level, cached) or an existing Levels. */
export function asLevels(w: Grid | Levels): Levels {
  if (w instanceof Levels) return w;
  let L = wrapped.get(w);
  if (!L) { L = singleLevel(w); wrapped.set(w, L); }
  return L;
}
