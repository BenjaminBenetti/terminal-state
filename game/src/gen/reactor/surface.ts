// Task studio-reactor-surface-ending-20261102 (lane ENDING): THE SURFACE EXIT of the Reactor — user: "when the gas is done clearing
// around the reactor … "external doors open". There should be an external sealed door on the top level that now becomes open. This
// door should lead up a set of stairs, towards a surface area, where the player may emerge in to the outside world! This area will be
// roughly situated around the hole on the roof."
//
// One continuous world, no teleport (pure data; the runtime door / message / objective: world/reactor/ending*.ts):
//  - THE DOOR: a 2 m x 2.8 m opening in a rim pit wall (stair / organ / south wall, seeded; never the station's north wall), from a
//    flat rim-gallery deck, nothing within its clearance (stair mouths, ladder heads, other doors, signs, props). Generated OPEN (the
//    grids, validation and reachability see the real route); the runtime seals it until the core's gas has cleared.
//  - THE STAIR: a walled U ("scissor") stair in the rock behind that wall. A short access passage (rim) runs straight in from the door
//    under the plaza's margin to the lower lobby; lane A climbs along the wall to a turn landing at half height, lane B (beside it,
//    a 0.5 m wall between) climbs back to the upper lobby at the surface; the upper passage runs back toward the pit to the plaza.
//    The flights are twin cells on the rim and surface grids (gen/levels.ts: a run carved into both storeys) — station-spec risers /
//    treads / landings (gen/traversal.ts layStairRun), 2 m lanes. The two passages are stacked (different storeys, 11+ m of rock).
//  - THE SURFACE: layout.levels[SURFACE_LEVEL] (role 'roof', baseY = the roof line + a 0.5 m slab), one open-air plaza over the pit
//    roof and a seeded 7-11 m margin beyond every pit wall, corners bitten off by seeded rubble lines; the roof opening is an aperture
//    (the core floor's band now rises through it to the sky: looking / shooting down the hole reaches the pit), its walkable edge kept
//    off by a ring of blocked cells under the drawn concrete parapet (+ hidden collision rails at the cell edges: levelIssues' well
//    rule). Open sky (levels[0].sky): ceil = the plaza's band top, `open` = the opening + the plaza, `outdoor` = closed columns are
//    open air above the 1.1 m parapet line (a building / the stair head house raises `tops`).
//  - Deterministic from the layout seed on its OWN stream (Rng 'reactor-surface'); it carves only rock nothing else used, BEFORE the
//    pit lamps are planned (they see the door) and after every population (nothing re-rolls: the existing records keep their values).

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR, SOLID, Grid} from '../grid';
import {STAIR, layStairRun, stairRunCells, type StairFlight} from '../traversal';
import {SLAB, levelDistance, setApertureMask} from '../levelGen';
import type {Level, LevelSky, RailRun} from '../levels';

import type {Area, AreaKind, AreaRole, LightPlacement, Rect, RoomType, StationLayout} from '../stationTypes';
import type {ReactorRect, ReactorSurface, ReactorSurfaceEdge} from './reactorTypes';
import type {ReactorCarve, WallId} from './carve';
import {ORG, REACTOR_LEVELS} from './frame';
import {roofOpeningOf} from './roofOpening';

/** layout.levels index of the surface storey (appended after the pit storeys: rim, tiers, core floor). */
export const SURFACE_LEVEL = REACTOR_LEVELS;

/** The surface exit's tunables (cells = 0.5 m unless noted). */
export const SURFACE = {
  /**
   * Deck above the roof line (m): the plaza stands on the roof slab (>= the storey slab rule), 2 cm over the roof curb's 0.6 m concrete
   * upstand (world/reactor/roofKit.ts ROOF_KIT.upstandH) — the deck reaches the opening's stepped edge with no curb to trip over.
   */
  slab: 0.62,
  /** Nominal open-air band height over the deck (m: headroom / light field only; LevelSky ceil). */
  ceil: 6,
  /** The plaza's boundary parapet line above the deck (m): closed columns are solid up to it. */
  parapet: 1.1,
  /** Plaza margin beyond each pit wall (cells, seeded per side). */
  margin: [14, 22] as [number, number],
  /** Corner rubble bites (cells) and their chance per corner. */
  bite: {p: 0.6, min: 6, max: 14},
  /** The exterior door: clear width (cells), height (m); rock kept solid either side in the wall (cells); clear deck rows in front. */
  door: {w: 4, h: 2.8, side: 3, front: 3},
  /** Stair lane width (cells), turn landing depth (cells), passage clear height (m). */
  lane: 4,
  turn: 3,
  passH: 3.0,
  /**
   * The barrier round the opening: a see-through steel guard railing just inside the opening radius (ringIn m inside: on the roof curb's
   * upstand, never over a walkable cell) ringTop above the deck, over a concrete apron out to ringT beyond the radius (it covers the
   * opening's cell-stepped deck edge). The walkable deck stops at that stepped edge (cells touching the opening are the hole: hidden
   * collision rails there): a body stands 0.34-1.05 m from the railing and can look steeply down the shaft at the core.
   */
  ringT: 0.75,
  ringIn: 0.06,
  ringTop: 1.1,
  /** Stair head house: its roof above the upper passage's ceiling (m). */
  headUp: 0.4,
  /** Least walkable plaza (m²). */
  minWalkM2: 1200,
  /** Daylight sources over the plaza: spacing (m), height above the deck (m), power. */
  daylight: {pitch: 11, up: 4.2, power: 0.55},
} as const;

/** Cool overcast daylight through the cleared rain sky (linear RGB, ~unit luminance) for the plaza's fixture-less light. */
export const SURFACE_SKY_TINT: readonly [number, number, number] = [0.86, 0.94, 1.0];

/** What planSurface / carveSurface did (QA / tests). */
export const SURFACE_STATS = {plans: 0, tried: 0, failed: 0, wall: '' as string, planMs: 0, carveMs: 0, finishMs: 0, why: {} as Record<string, number>};
const why = (k: string): false => { SURFACE_STATS.why[k] = (SURFACE_STATS.why[k] ?? 0) + 1; return false; };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The plan of one attempt (canonical wall frame + the cells it will use). */
interface SurfacePlan {
  wall: WallId;
  /** Door start along the wall (cells), lanes direction along the wall (+1 / -1), plaza margin on the door's wall (cells). */
  a0: number;
  dir: 1 | -1;
  G: number;
  margins: Record<'stair' | 'organ' | 'N' | 'S', number>;
  bites: {px: number; pz: number; w: number; h: number}[];
  Ys: number;
  H: number;
  Hm: number;
  R: number;
}

/** The carve: what finishSurface needs. */
export interface SurfaceCarve {
  plan: SurfacePlan;
  level: Level;
  areas: {lower: Area; stair: Area; upper: Area; plaza: Area};
  door: {rect: Rect; front: number; x: number; z: number; nx: number; nz: number};
  flights: number[];
  link: number;
  /** Grid cells of the plaza (walkable + keep-off) on the surface grid, and the upper passage / stair cells (head house). */
  plaza: number[];
  upper: number[];
  laneB: number[];
  stairRect: Rect;
}

// ---------------------------------------------------------------------------------------------
// Wall-local frame (the rooms' / suites' convention): a along the wall, d inward from it (d = -1 the wall row, d = -2 the deck's
// first row, d >= 0 into the rock).

function canonOf(rc: Pick<ReactorCarve, 'PW' | 'PD'>, w: WallId, a: number, d: number): [number, number] {
  switch (w) {
    case 'stair': return [-2 - d, a];
    case 'organ': return [rc.PW + 1 + d, a];
    case 'N': return [a, -2 - d];
    default: return [a, rc.PD + 1 + d];
  }
}

/** Grid cell (crop origin 0, 0: canvas = grid) of wall-local (a, d). */
function cellOf(rc: ReactorCarve, w: WallId, a: number, d: number): [number, number] {
  const [px, pz] = canonOf(rc, w, a, d);
  return [rc.cx(px), rc.PZ0 + pz];
}

/** Grid rect of the wall-local box a in [a0, a1), d in [d0, d1). */
function rectOf(rc: ReactorCarve, w: WallId, a0: number, a1: number, d0: number, d1: number): Rect {
  const [x0, y0] = cellOf(rc, w, a0, d0), [x1, y1] = cellOf(rc, w, a1 - 1, d1 - 1);
  return {x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1};
}

const cellsOf = (g: Grid, r: Rect): number[] => {
  const out: number[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(g.idx(x, y));
  return out;
};

/** The wall's length along a (cells). */
const wallLen = (rc: Pick<ReactorCarve, 'PW' | 'PD'>, w: WallId) => (w === 'stair' || w === 'organ' ? rc.PD : rc.PW);

// ---------------------------------------------------------------------------------------------
// Planning

/**
 * Picks the door / stair / plaza of the surface exit (null: no roof opening, or no wall with room — the generator retries the attempt).
 * Reads the finished pit storeys only; its own rng.
 */
export function planSurface(layout: StationLayout, rc: ReactorCarve, seed: number, keepOut: readonly Rect[] = []): SurfacePlan | null {
  const info = layout.reactor;
  if (!info || !roofOpeningOf(info)) return null;
  SURFACE_STATS.plans++;
  const t0 = now();
  try { return planIn(layout, rc, seed, keepOut, info); } finally { SURFACE_STATS.planMs = now() - t0; }
}

function planIn(layout: StationLayout, rc: ReactorCarve, seed: number, keepOut: readonly Rect[], info: NonNullable<StationLayout['reactor']>): SurfacePlan | null {
  const rng = new Rng(hashString('reactor-surface', seed >>> 0));
  const g0 = layout.levels[0].grid, W = g0.w, Hh = g0.h;
  const Ys = r2(info.pit.roofY + SURFACE.slab), H = r2(Ys - rc.bases[0]), Hm = r2(H / 2);
  const R = Math.max(stairRunCells(Hm, STAIR), stairRunCells(H - Hm, STAIR));
  const margins = {stair: rng.int(...SURFACE.margin), organ: rng.int(...SURFACE.margin), N: rng.int(...SURFACE.margin), S: rng.int(...SURFACE.margin)};
  // corner bites (canonical pit-local cells of the plaza rect's corners)
  const bites: SurfacePlan['bites'] = [];
  for (const [cxs, czs] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    if (!rng.chance(SURFACE.bite.p)) continue;
    const bw = rng.int(SURFACE.bite.min, SURFACE.bite.max), bh = rng.int(SURFACE.bite.min, SURFACE.bite.max);
    const px = cxs ? rc.PW + margins.organ - bw : -margins.stair, pz = czs ? rc.PD + margins.S - bh : -margins.N;
    bites.push({px, pz, w: bw, h: bh});
  }
  const deckAreas = new Set(rc.decks.filter(d => d.level === 0).map(d => d.area));
  const stand: {x: number; z: number}[] = [];
  for (const k of layout.levelLinks) { if (k.lower === 0) stand.push(k.bottom); if (k.upper === 0) stand.push(k.top); }
  for (const l of layout.traversal.ladders) if ((l.level ?? 0) === 0 || l.topLevel === 0) stand.push(l.top, l.bottom);
  const DW = SURFACE.door.w;
  // inside the core crop, clear (2 cells) of every planned Track2 extension rect (its cells are carved into the rim grid later)
  const inGrid = (x: number, y: number) => x >= ORG + 1 && y >= ORG + 1 && x < Math.min(W, rc.coreW) - ORG - 1 && y < Math.min(Hh, rc.coreH) - ORG - 1
    && !keepOut.some(r => x >= r.x - 2 && y >= r.y - 2 && x < r.x + r.w + 2 && y < r.y + r.h + 2);
  const walls = rng.shuffle(['S', 'stair', 'organ'] as WallId[]);
  for (const w of walls) {
    // the plaza covers wall-local rows d <= G - 2 (its margin); the upper passage starts at d = G - 1, the lanes at d = G (one rock row)
    const G = margins[w as 'stair' | 'organ' | 'S'], L = wallLen(rc, w), S0 = G;
    const starts: number[] = [];
    for (let a = 2; a + DW <= L - 2; a++) starts.push(a);
    rng.shuffle(starts);
    const dirs = rng.shuffle([1, -1] as (1 | -1)[]);
    for (const a0 of starts) for (const dir of dirs) {
      SURFACE_STATS.tried++;
      const plan: SurfacePlan = {wall: w, a0, dir, G, margins, bites, Ys, H, Hm, R};
      if (fits(layout, rc, plan, S0, deckAreas, stand, inGrid)) {
        SURFACE_STATS.wall = w;
        return plan;
      }
    }
  }
  SURFACE_STATS.failed++;
  return null;
}

/** The lane / turn a ranges of a plan (wall-local cells): lanes [l0, l1), turn [t0, t1). */
function laneSpan(p: SurfacePlan): {l0: number; l1: number; t0: number; t1: number} {
  const DW = SURFACE.door.w, T = SURFACE.turn;
  return p.dir > 0
    ? {l0: p.a0 + DW, l1: p.a0 + DW + p.R, t0: p.a0 + DW + p.R, t1: p.a0 + DW + p.R + T}
    : {l0: p.a0 - p.R, l1: p.a0, t0: p.a0 - p.R - T, t1: p.a0 - p.R};
}

function fits(layout: StationLayout, rc: ReactorCarve, p: SurfacePlan, S0: number, deckAreas: ReadonlySet<number>, stand: readonly {x: number; z: number}[], inGrid: (x: number, y: number) => boolean): boolean {
  const g0 = layout.levels[0].grid, DW = SURFACE.door.w, LW = SURFACE.lane;
  const info = layout.reactor!;
  const at = (a: number, d: number) => cellOf(rc, p.wall, a, d);
  // 1. the door + solid wall either side of it
  for (let a = p.a0 - SURFACE.door.side; a < p.a0 + DW + SURFACE.door.side; a++) {
    const [x, y] = at(a, -1);
    if (!g0.inBounds(x, y) || g0.cells[g0.idx(x, y)] !== SOLID) return why('wall');
  }
  // 2. flat, clear rim deck in front (and one cell beyond each jamb)
  let front = -1;
  for (let d = -2; d >= -1 - SURFACE.door.front; d--) for (let a = p.a0 - 1; a < p.a0 + DW + 1; a++) {
    const [x, y] = at(a, d);
    if (!g0.inBounds(x, y)) return why('front-grid');
    const i = g0.idx(x, y);
    if (g0.cells[i] !== FLOOR || g0.rampIdx[i] >= 0 || g0.blocked[i] || Math.abs(g0.floor[i] - rc.bases[0]) > 0.01 || !deckAreas.has(g0.area[i])) return why('front-deck');
    if (d === -2 && a === p.a0) front = g0.area[i];
  }
  if (front < 0) return why('front');
  // nothing standing at the door: stair mouths / ladder heads (4 m), signs and props (2 m) of the rim
  const [dx, dy] = at(p.a0 + DW / 2, -1), dcx = dx * CELL + CELL / 2, dcz = dy * CELL + CELL / 2;
  for (const q of stand) if (Math.hypot(q.x - dcx, q.z - dcz) < 4.5) return why('mouth');
  for (const s of layout.signs) if ((s.level ?? 0) === 0 && Math.hypot(s.x - dcx, s.z - dcz) < 2.6) return why('sign');
  for (const q of layout.props) if ((q.level ?? 0) === 0 && Math.hypot(q.x - dcx, q.z - dcz) < 2.2) return why('prop');
  // (3. a side complex's rooms may lie under the passage / stair: they are 'reactor-room' areas like the rim office, the slab rule of
  // step 5 keeps the storeys apart — complexIssues' "under the rim station" is about the station's own halls and track bed)
  const sp = laneSpan(p);
  void info;
  // 4. the upper passage (surface storey: above everything) inside the grid
  for (let a = p.a0; a < p.a0 + DW; a++) for (let d = p.G - 1; d < S0 + 2 * LW + 1; d++) { const [x, y] = at(a, d); if (!inGrid(x, y)) return why('upper'); }
  // 5. the rock it carves (rim storey + 1 cell of rock round it; no band of a lower storey closer than a slab under the rim)
  const used: number[] = [];
  const add = (a: number, d: number): boolean => { const [x, y] = at(a, d); if (!inGrid(x, y)) return false; used.push(g0.idx(x, y)); return true; };
  for (let a = p.a0; a < p.a0 + DW; a++) for (let d = 0; d < S0 + LW; d++) if (!add(a, d)) return why('grid');
  for (let a = sp.l0; a < sp.l1; a++) for (let d = S0; d < S0 + 2 * LW + 1; d++) if (!add(a, d)) return why('grid');
  for (let a = sp.t0; a < sp.t1; a++) for (let d = S0; d < S0 + 2 * LW + 1; d++) if (!add(a, d)) return why('grid');
  const W = g0.w, cap = rc.bases[0] - SLAB + 1e-3; // (levelIssues' slab rule: a band top at most a slab under the rim floor)
  for (const i of used) {
    if (g0.cells[i] !== SOLID) return why('rock');
    for (let L = 1; L < layout.levels.length; L++) {
      const g = layout.levels[L].grid;
      if (g.cells[i] !== SOLID && (g.hasCeil(i) ? g.ceil[i] : g.floorOf(i) + 3) > cap) return why('below');
    }
  }
  // the 1-cell rock margin (8-neighbours of every carved cell, except the door's wall row, which step 1 checked)
  const mark = scratch(g0.w * g0.h);
  for (const i of used) mark[i] = 1;
  const [wx0, wy0] = at(p.a0 - SURFACE.door.side, -1), [wx1, wy1] = at(p.a0 + DW + SURFACE.door.side - 1, -1);
  const wallRow = (x: number, y: number) => x >= Math.min(wx0, wx1) && x <= Math.max(wx0, wx1) && y >= Math.min(wy0, wy1) && y <= Math.max(wy0, wy1);
  let ok = true;
  for (const i of used) {
    const x = i % W, y = (i - x) / W;
    for (let oy = -1; oy <= 1 && ok; oy++) for (let ox = -1; ox <= 1; ox++) {
      const qx = x + ox, qy = y + oy, j = qy * W + qx;
      if (mark[j] || wallRow(qx, qy)) continue;
      if (!inGrid(qx, qy) || g0.cells[j] !== SOLID) { ok = false; break; }
    }
    if (!ok) break;
  }
  for (const i of used) mark[i] = 0;
  return ok || why('margin');
}

let scratchBuf = new Uint8Array(0);
/** A zeroed reusable mask (callers clear what they set). */
function scratch(n: number): Uint8Array {
  if (scratchBuf.length < n) scratchBuf = new Uint8Array(n);
  return scratchBuf;
}

// ---------------------------------------------------------------------------------------------
// Carving (before planPitLamps: the lamps / beacons / kit then see the door)

function newArea(layout: StationLayout, r: Rect, kind: AreaKind, type: RoomType, label: string, ceil: number, level: number, floorY: number, role: AreaRole, parent: number): Area {
  const a: Area = {...r, id: layout.areas.length, kind, type, label, ceil: r2(ceil), parent, depth: parent >= 0 ? (layout.areas[parent]?.depth ?? 0) + 1 : 0, publicSpace: false, lighting: 'dim', role};
  if (level) { a.level = level; a.floorY = floorY; }
  layout.areas.push(a);
  return a;
}

/** Carves the plan (mutates the layout: the surface storey, areas, the door, the flights + link, lights, signs). */
export function carveSurface(layout: StationLayout, rc: ReactorCarve, p: SurfacePlan): SurfaceCarve {
  const t0 = now();
  try { return carveIn(layout, rc, p); } finally { SURFACE_STATS.carveMs = now() - t0; }
}

function carveIn(layout: StationLayout, rc: ReactorCarve, p: SurfacePlan): SurfaceCarve {
  const g0 = layout.levels[0].grid, W = g0.w, Hh = g0.h;
  const gS = new Grid(W, Hh);
  gS.ramps = g0.ramps; // one ramps list per station (twin flights)
  gS.voidFloor = g0.voidFloor;
  const level: Level = {id: layout.levels.length, role: 'roof', grid: gS, baseY: p.Ys};
  if (level.id !== SURFACE_LEVEL) throw new Error(`surface storey index ${level.id} (expected ${SURFACE_LEVEL})`);
  layout.levels = [...layout.levels, level]; // a fresh array: the per-levels-array caches (levelArrays, levelsOf) rebuild
  const DW = SURFACE.door.w, LW = SURFACE.lane, S0 = p.G, sp = laneSpan(p), rim = rc.bases[0];
  const at = (a: number, d: number) => cellOf(rc, p.wall, a, d);
  const idx = (a: number, d: number) => { const [x, y] = at(a, d); return g0.idx(x, y); };
  const stamp = (g: Grid, i: number, area: number, f: number, c: number) => { g.cells[i] = FLOOR; g.area[i] = area; g.floor[i] = f; g.ceil[i] = r3(c); };
  // the door's deck area (front) and the door
  const front = g0.area[idx(p.a0, -2)];
  const lowerRect = rectOf(rc, p.wall, p.a0, p.a0 + DW, 0, S0 + LW);
  const lower = newArea(layout, lowerRect, 'passage', 'stair-core', 'Surface access', rim + SURFACE.passH, 0, rim, 'reactor-room', front);
  for (let a = p.a0; a < p.a0 + DW; a++) for (let d = 0; d < S0 + LW; d++) stamp(g0, idx(a, d), lower.id, rim, rim + SURFACE.passH);
  const doorRect = rectOf(rc, p.wall, p.a0, p.a0 + DW, -1, 0), doorCells = cellsOf(g0, doorRect);
  for (const i of doorCells) stamp(g0, i, lower.id, rim, rim + SURFACE.door.h);
  layout.doors.push({...doorRect, id: layout.doors.length, a: front, b: lower.id, height: SURFACE.door.h, arch: false, staff: true});
  // the stair: lane A (near the pit: rim -> the turn), lane B (beyond the divider: the turn -> the surface), the turn landing
  const laneA = rectOf(rc, p.wall, sp.l0, sp.l1, S0, S0 + LW), laneB = rectOf(rc, p.wall, sp.l0, sp.l1, S0 + LW + 1, S0 + 2 * LW + 1);
  const turn = rectOf(rc, p.wall, sp.t0, sp.t1, S0, S0 + 2 * LW + 1);
  const stairRect = rectOf(rc, p.wall, Math.min(sp.l0, sp.t0), Math.max(sp.l1, sp.t1), S0, S0 + 2 * LW + 1);
  const stair = newArea(layout, stairRect, 'passage', 'stair-core', 'Surface stair', p.Hm + STAIR.headroom, 0, rim, 'reactor-room', lower.id);
  const laneBCells = cellsOf(g0, laneB);
  for (const r of [laneA, laneB]) for (const i of cellsOf(g0, r)) for (const g of [g0, gS]) stamp(g, i, stair.id, rim, rim + 3);
  // the axis along the wall: 'z' on the stair / organ walls (a = pz), 'x' on the south wall (a = px); the run's far (turn) end in grid
  // coordinates decides `from` (the flights' high landing at the turn: lane A goes DOWN to the rim, lane B UP to the surface)
  const axis: 'x' | 'z' = p.wall === 'S' ? 'x' : 'z';
  const near = at(p.dir > 0 ? sp.l0 : sp.l1 - 1, S0), far = at(p.dir > 0 ? sp.l1 - 1 : sp.l0, S0);
  const farHi = axis === 'x' ? far[0] > near[0] : far[1] > near[1];
  const from: 'lo' | 'hi' = farHi ? 'hi' : 'lo';
  const fl: StairFlight[] = [
    ...layStairRun([g0, gS], laneA, stair.id, axis, from, p.Hm, rim, STAIR),
    ...layStairRun([g0, gS], laneB, stair.id, axis, from, p.Hm, p.Ys, STAIR),
  ];
  for (const i of cellsOf(g0, turn)) for (const g of [g0, gS]) stamp(g, i, stair.id, p.Hm, p.Hm + STAIR.headroom);
  // the divider between the lanes stays rock on both grids (layStairRun only wrote floors / ceilings into the lane rects)
  // the upper passage + lobby (surface storey)
  const upperRect = rectOf(rc, p.wall, p.a0, p.a0 + DW, p.G - 1, S0 + 2 * LW + 1);
  const upper = newArea(layout, upperRect, 'passage', 'stair-core', 'Surface access', p.Ys + SURFACE.passH, SURFACE_LEVEL, p.Ys, 'reactor-room', stair.id);
  const upperCells: number[] = [];
  for (let a = p.a0; a < p.a0 + DW; a++) for (let d = p.G - 1; d < S0 + 2 * LW + 1; d++) { const i = idx(a, d); stamp(gS, i, upper.id, p.Ys, p.Ys + SURFACE.passH); upperCells.push(i); }
  // flights + the one link rim -> surface (bottom: lane A's foot in the lower lobby; top: lane B's head in the upper lobby)
  const ids: number[] = [];
  for (const f of fl) { f.id = layout.traversal.stairs.length; layout.traversal.stairs.push(f); ids.push(f.id); }
  const lo = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
  const hi = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
  const link = layout.levelLinks.length;
  layout.levelLinks.push({id: link, kind: 'stairs', lower: 0, upper: SURFACE_LEVEL, ramp: lo.ramp, bottom: {...lo.bottom}, top: {...hi.top}, traversalId: lo.id});
  // the plaza (surface storey): the pit rect grown by the margins, minus the corner bites, the opening, the stair's rock
  const M = p.margins;
  const plazaRect = rc.rectC(-M.stair, -M.N, rc.PW + M.stair + M.organ, rc.PD + M.N + M.S);
  const o = roofOpeningOf(layout.reactor!)!;
  const bitten = new Uint8Array(W * Hh);
  const exitFront = new Set<number>();
  for (let a = p.a0 - 2; a < p.a0 + DW + 2; a++) for (let d = p.G - 8; d < p.G - 1; d++) exitFront.add(idx(a, d));
  for (const b of p.bites) {
    const r = rc.rectC(b.px, b.pz, b.w, b.h), cells = cellsOf(g0, clip(r, W, Hh));
    if (cells.some(i => exitFront.has(i))) continue;
    for (const i of cells) bitten[i] = 1;
  }
  const plazaArea = newArea(layout, clip(plazaRect, W, Hh), 'concourse', 'concourse', 'Surface', p.Ys + SURFACE.ceil, SURFACE_LEVEL, p.Ys, 'reactor-surface', upper.id);
  plazaArea.publicSpace = true;
  plazaArea.lighting = 'lit';
  const plaza: number[] = [];
  const pr = clip(plazaRect, W, Hh);
  for (let y = Math.max(pr.y, ORG + 1); y < Math.min(pr.y + pr.h, Hh - ORG - 1); y++) for (let x = Math.max(pr.x, ORG + 1); x < Math.min(pr.x + pr.w, W - ORG - 1); x++) {
    const i = gS.idx(x, y);
    if (bitten[i] || gS.cells[i] !== SOLID) continue; // (the upper passage / lanes are already stamped: never plaza)
    const nx = Math.max(x * CELL, Math.min((x + 1) * CELL, o.x)) - o.x, nz = Math.max(y * CELL, Math.min((y + 1) * CELL, o.z)) - o.z;
    if (nx * nx + nz * nz < o.r * o.r) continue; // the opening (roofOpeningMask's rule: the cell touches the disc)
    // a band of another storey reaching up into the deck's slab: no deck there
    let ok = true;
    for (let L = 0; L < SURFACE_LEVEL && ok; L++) { const g = layout.levels[L].grid; if (g.cells[i] !== SOLID && g.ceil[i] > p.Ys - SLAB + 1e-3) ok = false; }
    if (!ok) continue;
    stamp(gS, i, plazaArea.id, p.Ys, p.Ys + SURFACE.ceil);
    plaza.push(i);
  }
  // lights: dim steady work lamps in the passages and the stair (station power: the exit was always wired)
  const lamp = (a: number, d: number, y: number, area: Area, lv: number) => {
    const [x, z] = at(a, d), rot = axis === 'x' ? 0 : Math.PI / 2;
    const l: LightPlacement = {x: r3((x + 0.5) * CELL), y: r3(y), z: r3((z + 0.5) * CELL), rot, area: area.id, broken: false, flicker: false, warm: true, power: 0.55, dying: false, ...(lv ? {level: lv} : {})};
    layout.lights.push(l);
  };
  const midA = Math.floor(p.a0 + DW / 2);
  lamp(midA, Math.floor(S0 / 2), rim + SURFACE.passH - 0.15, lower, 0);
  lamp(midA, S0 + 1, rim + SURFACE.passH - 0.15, lower, 0);
  lamp(Math.floor((sp.t0 + sp.t1) / 2), S0 + LW, p.Hm + STAIR.headroom - 0.15, stair, 0);
  lamp(midA, S0 + LW + 2, p.Ys + SURFACE.passH - 0.15, upper, SURFACE_LEVEL);
  lamp(midA, p.G, p.Ys + SURFACE.passH - 0.15, upper, SURFACE_LEVEL);
  // one lamp half way along each lane, under its flight-following ceiling
  const midL = Math.floor((sp.l0 + sp.l1) / 2);
  for (const d of [S0 + 1, S0 + LW + 2]) { const i = idx(midL, d); lamp(midL, d, g0.floorOf(i) + 2.3, stair, 0); }
  // signs: over the door on the gallery side, at the stair foot, and at the exit on the plaza (the way back down)
  const [ddx, ddy] = at(p.a0, -1), [ddx2, ddy2] = at(p.a0 + DW - 1, -1);
  const dcx = ((ddx + ddx2) / 2 + 0.5) * CELL, dcz = ((ddy + ddy2) / 2 + 0.5) * CELL;
  const [ix, iy] = at(p.a0, 0), [ox2, oy2] = at(p.a0, -2);
  const nX = Math.sign(ox2 - ix), nZ = Math.sign(oy2 - iy); // the door's outward normal (into the pit)
  const rotOut = Math.atan2(nX, nZ);
  layout.signs.push({x: r3(dcx + nX * (CELL / 2 + 0.02)), y: r3(rim + SURFACE.door.h + 0.55), z: r3(dcz + nZ * (CELL / 2 + 0.02)), rot: rotOut, kind: 'exit', text: 'SURFACE EXIT', area: front, w: 1.8});
  {
    // the exit onto the plaza: the plate over the upper passage's mouth, facing the plaza
    const [ex, ey] = at(p.a0, p.G - 2), [ex2, ey2] = at(p.a0 + DW - 1, p.G - 2), [jx, jy] = at(p.a0, p.G - 1);
    const mx = ((ex + ex2) / 2 + 0.5) * CELL, mz = ((ey + ey2) / 2 + 0.5) * CELL, ux = Math.sign(ex - jx), uz = Math.sign(ey - jy);
    layout.signs.push({x: r3(mx - ux * (CELL / 2 - 0.02)), y: r3(p.Ys + SURFACE.passH + 0.1), z: r3(mz - uz * (CELL / 2 - 0.02)), rot: Math.atan2(ux, uz), kind: 'exit', text: 'TO RIM · STATION', area: plazaArea.id, w: 1.8, level: SURFACE_LEVEL});
  }
  return {
    plan: p, level, areas: {lower, stair, upper, plaza: plazaArea},
    door: {rect: doorRect, front, x: r3(dcx), z: r3(dcz), nx: nX, nz: nZ},
    flights: ids, link, plaza, upper: upperCells, laneB: laneBCells, stairRect,
  };
}

function clip(r: Rect, W: number, H: number): Rect {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h);
  return {x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)};
}

// ---------------------------------------------------------------------------------------------
// Finishing (after planPitLamps: levels[0].sky exists)

/**
 * The open sky over the plaza, the opening's column through the deck, the keep-off ring's rails, the head house, daylight and the
 * record (layout.reactor.surface). Null (and nothing changed) without the pit roof's sky.
 */
export function finishSurface(layout: StationLayout, c: SurfaceCarve): ReactorSurface | null {
  const t0 = now();
  try { return finishIn(layout, c); } finally { SURFACE_STATS.finishMs = now() - t0; }
}

function finishIn(layout: StationLayout, c: SurfaceCarve): ReactorSurface | null {
  const info = layout.reactor!, L0 = layout.levels[0], sky0 = L0.sky, o = roofOpeningOf(info);
  if (!sky0?.open || !o) return null;
  const p = c.plan, gS = c.level.grid, W = gS.w, Hh = gS.h;
  const S = r2(p.Ys + SURFACE.ceil), roofY = info.pit.roofY, parapetY = r2(p.Ys + SURFACE.parapet);
  // 1. the opening's column rises through the deck to the open band top (the pit band that reached the roof line)
  const hole: number[] = [];
  for (let i = 0; i < sky0.open.length; i++) {
    if (!sky0.open[i]) continue;
    hole.push(i);
    for (let L = 0; L < SURFACE_LEVEL; L++) { const g = layout.levels[L].grid; if (g.cells[i] !== SOLID && Math.abs(g.ceil[i] - roofY) < 1e-3) g.ceil[i] = S; }
  }
  // 2. the head house: closed rock round the upper passage and lane B's top (above the parapet line), solid to its roof
  const headTop = r2(p.Ys + SURFACE.passH + SURFACE.headUp);
  const tops = sky0.tops ?? new Float32Array(W * Hh);
  const head = new Set<number>();
  // (every indoor column of the exit rising above the deck: the upper passage and lane B's top flights — the head house roofs them all)
  const near = [...c.upper, ...c.laneB.filter(i => gS.ceil[i] > p.Ys - 0.05)];
  for (const i of near) tops[i] = headTop; // the passage's / flight's own column above its ceiling: solid to the head house roof
  let hx0 = Infinity, hz0 = Infinity, hx1 = -Infinity, hz1 = -Infinity;
  const plazaSet = new Set(c.plaza);
  for (const i of near) {
    const x = i % W, y = (i - x) / W;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const qx = x + ox, qy = y + oy;
      if (!gS.inBounds(qx, qy)) continue;
      const j = gS.idx(qx, qy);
      if (plazaSet.has(j) || gS.cells[j] !== SOLID) continue;
      head.add(j);
    }
    hx0 = Math.min(hx0, x * CELL); hz0 = Math.min(hz0, y * CELL); hx1 = Math.max(hx1, (x + 1) * CELL); hz1 = Math.max(hz1, (y + 1) * CELL);
  }
  for (const j of head) tops[j] = headTop;
  // 3. the open sky: band top = the plaza's, the opening + the plaza open, the outdoors above the parapet line
  const open = sky0.open.slice();
  for (const i of c.plaza) open[i] = 1;
  const sky: LevelSky = {...sky0, ceil: S, open, tops, outdoor: {level: SURFACE_LEVEL, y: parapetY}};
  L0.sky = sky;
  // 4. apertures (the opening is the surface's well) and its railings: collision-only at the cell edges (the parapet ring is drawn)
  layout.levels = layout.levels.slice(); // the bands changed (the opening's column): fresh per-array caches
  // registerApertures' rule for the surface storey alone (every other storey's mask is unchanged: the opening's column was already
  // their well): closed on the deck while another storey's flat band spans the deck height
  const ap = new Uint8Array(W * Hh), lo = p.Ys - 0.2, hi = p.Ys + 0.2;
  for (const i of hole) {
    if (gS.cells[i] !== SOLID) continue;
    for (let L = 0; L < SURFACE_LEVEL; L++) {
      const g = layout.levels[L].grid;
      if (g.cells[i] === SOLID || g.rampIdx[i] >= 0) continue;
      const f = g.floorOf(i), cl = g.ceil[i] !== 0 || f !== 0 ? g.ceil[i] : Infinity;
      if (f < lo && cl > hi) { ap[i] = 1; break; }
    }
  }
  setApertureMask(gS, ap);
  // its railings (gen/levelGen.ts deriveRails' runs exactly — levelIssues checks the keys): collision-only (the parapet ring is drawn)
  layout.rails.push(...apertureRails(gS, ap, SURFACE_LEVEL).map(r => ({...r, h: SURFACE.ringTop, hidden: true})));
  // 5. daylight over the plaza (fixture-less, baked: the overcast rain sky)
  const D = SURFACE.daylight;
  const walkable = (i: number) => gS.cells[i] === FLOOR && !gS.blocked[i] && gS.area[i] === c.areas.plaza.id;
  const pr = c.areas.plaza;
  for (let z = pr.y * CELL + D.pitch / 2; z < (pr.y + pr.h) * CELL; z += D.pitch) for (let x = pr.x * CELL + D.pitch / 2; x < (pr.x + pr.w) * CELL; x += D.pitch) {
    const [cx, cy] = gS.cellOf(x, z);
    if (!gS.inBounds(cx, cy) || !walkable(gS.idx(cx, cy))) continue;
    layout.lights.push({x: r3(x), y: r2(p.Ys + D.up), z: r3(z), rot: 0, area: pr.id, broken: false, flicker: false, warm: false, power: D.power, dying: false, virtual: true, tint: SURFACE_SKY_TINT, level: SURFACE_LEVEL});
  }
  // 6. the record
  const walk = walkRects(gS, i => walkable(i));
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const r of walk) { bx0 = Math.min(bx0, r.x0); bz0 = Math.min(bz0, r.z0); bx1 = Math.max(bx1, r.x1); bz1 = Math.max(bz1, r.z1); }
  const link = layout.levelLinks[c.link];
  const yawOut = Math.atan2(-c.door.nx, -c.door.nz); // camera yaw whose forward (-sin, -cos) is the outward normal
  const exitP = (() => {
    // the passage mouth on the plaza (the upper area's cells next to plaza cells), facing out onto the plaza
    let sx = 0, sz = 0, n = 0;
    for (const i of c.upper) {
      const x = i % W, y = (i - x) / W;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => gS.inBounds(x + dx, y + dy) && plazaSet.has(gS.idx(x + dx, y + dy)))) { sx += (x + 0.5) * CELL; sz += (y + 0.5) * CELL; n++; }
    }
    return n ? {x: r3(sx / n), z: r3(sz / n)} : {x: link.top.x, z: link.top.z};
  })();
  const rec: ReactorSurface = {
    version: 1, level: SURFACE_LEVEL, y: p.Ys, ceil: S, parapetY,
    bounds: {x0: r3(bx0), z0: r3(bz0), x1: r3(bx1), z1: r3(bz1)}, walk,
    edges: plazaEdges(gS, new Set(c.plaza), hole),
    // (the walkable deck never touches the opening's disc: keepR = its radius; the railing ring r0 stands just inside it)
    hole: {x: o.x, z: o.z, r: o.r, parapet: {r0: r3(o.r - SURFACE.ringIn), r1: r3(o.r + SURFACE.ringT), top: r2(p.Ys + SURFACE.ringTop)}, keepR: o.r},
    door: {
      level: 0, x: c.door.x, y: info.pit.rimY, z: c.door.z, yaw: r3(yawOut), nx: c.door.nx, nz: c.door.nz, w: r2(SURFACE.door.w * CELL), h: SURFACE.door.h,
      rect: {x0: c.door.rect.x * CELL, z0: c.door.rect.y * CELL, x1: (c.door.rect.x + c.door.rect.w) * CELL, z1: (c.door.rect.y + c.door.rect.h) * CELL}, front: c.door.front,
    },
    stairs: {
      flights: c.flights.slice(), link: c.link, bottom: {...link.bottom, level: 0}, top: {...link.top, level: SURFACE_LEVEL},
      // the flights, the turn landing and the upper passage (indoors: the stair up to the plaza's edge)
      rect: (() => { const a = c.stairRect, u = c.areas.upper; return {x0: Math.min(a.x, u.x) * CELL, z0: Math.min(a.y, u.y) * CELL, x1: Math.max(a.x + a.w, u.x + u.w) * CELL, z1: Math.max(a.y + a.h, u.y + u.h) * CELL}; })(),
    },
    head: {rect: {x0: r3(hx0 - 2 * CELL), z0: r3(hz0 - 2 * CELL), x1: r3(hx1 + 2 * CELL), z1: r3(hz1 + 2 * CELL)}, top: headTop},
    exit: {x: exitP.x, y: p.Ys, z: exitP.z, yaw: r3(yawOut)},
    areas: {lower: c.areas.lower.id, stair: c.areas.stair.id, upper: c.areas.upper.id, plaza: c.areas.plaza.id},
  };
  info.surface = rec;
  return rec;
}

/**
 * gen/levelGen.ts deriveRails for ONE level with its aperture mask `ap` (the same loop, bounds and merging: identical runs and keys —
 * levelIssues' "well edge without railing" compares them). Floors from the level's own grid (the surface deck is flat: its floorOf).
 */
export function apertureRails(g: Grid, ap: Uint8Array, level: number): RailRun[] {
  const out: RailRun[] = [], W = g.w, H = g.h, cells = g.cells, ramp = g.rampIdx;
  const rowHas = new Uint8Array(H), colHas = new Uint8Array(W);
  for (let i = 0; i < ap.length; i++) if (ap[i]) { rowHas[(i / W) | 0] = 1; colHas[i % W] = 1; }
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    const alongX = dx === 0;
    const outer = alongX ? H : W, inner = alongX ? W : H;
    const step = dx + dy * W;
    for (let a = 1; a < outer - 1; a++) {
      if (!(alongX ? rowHas[a + dy] : colHas[a + dx])) continue;
      let start = -1, fy = 0;
      const line = (alongX ? (dy < 0 ? a : a + 1) : (dx < 0 ? a : a + 1)) * CELL;
      for (let b = 1; b < inner; b++) {
        let on = false, f = 0;
        if (b < inner - 1) {
          const i = alongX ? a * W + b : b * W + a;
          if (cells[i] === FLOOR && ramp[i] < 0) { f = g.floorOf(i); on = ap[i + step] === 1; }
        }
        if (start >= 0 && (!on || Math.abs(f - fy) > 1e-3)) {
          const s0 = start * CELL, s1 = b * CELL;
          out.push(alongX
            ? {level, x0: s0, z0: line, x1: s1, z1: line, y0: fy, y1: fy, nx: 0, nz: -dy, kind: 'railing'}
            : {level, x0: line, z0: s0, x1: line, z1: s1, y0: fy, y1: fy, nx: -dx, nz: 0, kind: 'railing'});
          start = -1;
        }
        if (on && start < 0) { start = b; fy = f; }
      }
    }
  }
  return out;
}

/** Row runs of `ok` cells merged into rects (identical spans in consecutive rows join). World metres. */
function walkRects(g: Grid, ok: (i: number) => boolean): ReactorRect[] {
  const open = new Map<string, ReactorRect>();
  const out: ReactorRect[] = [];
  for (let y = 0; y < g.h; y++) {
    const runs: [number, number][] = [];
    for (let x = 0; x < g.w;) {
      if (!ok(g.idx(x, y))) { x++; continue; }
      let e = x + 1;
      while (e < g.w && ok(g.idx(e, y))) e++;
      runs.push([x, e]);
      x = e;
    }
    const next = new Map<string, ReactorRect>();
    for (const [x0, x1] of runs) {
      const k = `${x0}:${x1}`, prev = open.get(k);
      if (prev) { prev.z1 = (y + 1) * CELL; next.set(k, prev); }
      else { const r = {x0: x0 * CELL, z0: y * CELL, x1: x1 * CELL, z1: (y + 1) * CELL}; out.push(r); next.set(k, r); }
    }
    open.clear();
    for (const [k, v] of next) open.set(k, v);
  }
  return out;
}

/** The plaza's outer boundary: cell edges between a plaza cell and a closed cell (not the opening), merged into straight runs. */
function plazaEdges(g: Grid, plaza: ReadonlySet<number>, hole: readonly number[]): ReactorSurfaceEdge[] {
  const holeSet = new Set(hole), W = g.w;
  const out: ReactorSurfaceEdge[] = [];
  const closed = (x: number, y: number) => !g.inBounds(x, y) || (!plaza.has(g.idx(x, y)) && !holeSet.has(g.idx(x, y)) && g.cells[g.idx(x, y)] === SOLID);
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    const alongX = dx === 0;
    for (let a = 0; a < (alongX ? g.h : W); a++) {
      let start = -1;
      for (let b = 0; b <= (alongX ? W : g.h); b++) {
        const x = alongX ? b : a, y = alongX ? a : b;
        const on = b < (alongX ? W : g.h) && plaza.has(g.idx(x, y)) && closed(x + dx, y + dy);
        if (on && start < 0) start = b;
        if (!on && start >= 0) {
          const line = (alongX ? (dy < 0 ? a : a + 1) : (dx < 0 ? a : a + 1)) * CELL;
          out.push(alongX ? {x0: start * CELL, z0: line, x1: b * CELL, z1: line, nx: 0, nz: dy} : {x0: line, z0: start * CELL, x1: line, z1: b * CELL, nx: dx, nz: 0});
          start = -1;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validation (gen/reactor/validate.ts reactorIssues)

/**
 * The surface exit: the record; the storey above everything (role 'roof'); the door an opening of the rim with a clear deck in front;
 * the stair link rim -> surface; the plaza bounded (every walkable cell enclosed by deck / closed rock / the railed opening), big
 * enough, nothing walkable inside the keep-off radius; the surface reached ONLY through the door (with the door shut no plaza cell is
 * reachable from the start). A layout with a roof opening and no surface record is an issue (the generator retries the attempt).
 */
export function surfaceIssues(layout: StationLayout, dist?: Int32Array[]): string[] {
  const info = layout.reactor;
  if (!info) return [];
  const s = info.surface;
  if (!s) return roofOpeningOf(info) ? ['surface: missing'] : [];
  const out: string[] = [];
  const L = layout.levels[s.level];
  if (!L || L.role !== 'roof' || Math.abs(L.baseY - s.y) > 1e-6) return ['surface: storey record'];
  if (!(s.y > info.pit.roofY + SLAB - 1e-3)) out.push('surface: deck not above the roof slab');
  const g = L.grid, g0 = layout.levels[0].grid;
  if (!layout.levels[0].sky?.outdoor || layout.levels[0].sky.outdoor.level !== s.level) out.push('surface: no outdoor sky');
  const doorCells = surfaceDoorCells(s, g0);
  if (!doorCells.length) out.push('surface: no door cells');
  for (const i of doorCells) if (g0.cells[i] !== FLOOR || g0.blocked[i]) { out.push('surface: door cell closed at generation'); break; }
  const link = layout.levelLinks[s.stairs.link];
  if (!link || link.lower !== 0 || link.upper !== s.level || link.kind !== 'stairs') out.push('surface: no stair link rim -> surface');
  for (const id of s.stairs.flights) if (!layout.traversal.stairs[id]) out.push(`surface: flight ${id} missing`);
  // walkable plaza: size, keep-off, enclosure
  let cells = 0, inner = 0, leak = 0;
  const kr2 = s.hole.keepR * s.hole.keepR;
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] !== FLOOR || g.area[i] !== s.areas.plaza) continue;
    const x = i % g.w, y = (i - x) / g.w;
    if (!g.blocked[i]) {
      cells++;
      const nx = Math.max(x * CELL, Math.min((x + 1) * CELL, s.hole.x)) - s.hole.x, nz = Math.max(y * CELL, Math.min((y + 1) * CELL, s.hole.z)) - s.hole.z;
      if (nx * nx + nz * nz < kr2 - 1e-6) inner++;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!g.inBounds(x + dx, y + dy)) leak++;
  }
  if (cells * CELL * CELL < SURFACE.minWalkM2) out.push(`surface: ${(cells * CELL * CELL).toFixed(0)} m² walkable`);
  if (inner) out.push(`surface: ${inner} walkable cells inside the opening's keep-off ring`);
  if (leak) out.push('surface: plaza at the grid edge');
  if (dist && dist[s.level]) {
    // reached at all (reactorIssues' reachability covers every cell), and only through the door
    const shut: [number, number][] = doorCells.map(i => [i, g0.blocked[i]]);
    for (const i of doorCells) g0.blocked[i] = 1;
    try {
      // from the exit (on the plaza) with the door shut: the start is never reached (the surface + stair are a sealed pocket)
      const [ex, ez] = g.cellOf(s.exit.x, s.exit.z);
      const d = reachFrom(layout, ex, ez, s.level);
      const [sx, sz] = g0.cellOf(info.start.x, info.start.z);
      if (d[0][g0.idx(sx, sz)] >= 0) out.push('surface: the start is reachable from the surface with the door shut');
      let n = 0;
      for (let i = 0; i < g.cells.length; i++) if (d[s.level][i] >= 0) n++;
      if (n < 4) out.push('surface: the exit is not on the plaza');
    } finally { for (const [i, b] of shut) g0.blocked[i] = b; }
  }
  return out;
}

/** The exterior door's grid cells on the rim grid `g` (from its world rect: valid in any grid frame of the finished layout). */
export function surfaceDoorCells(s: Pick<ReactorSurface, 'door'>, g: Pick<Grid, 'w' | 'h' | 'idx' | 'inBounds'>): number[] {
  const r = s.door.rect, out: number[] = [];
  for (let y = Math.round(r.z0 / CELL); y < Math.round(r.z1 / CELL); y++) for (let x = Math.round(r.x0 / CELL); x < Math.round(r.x1 / CELL); x++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
  return out;
}

function reachFrom(layout: StationLayout, sx: number, sz: number, level = 0): Int32Array[] {
  return levelDistance(layout.levels, sx, sz, level, layout.levelLinks);
}
