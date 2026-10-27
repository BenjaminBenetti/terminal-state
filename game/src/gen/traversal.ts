// Vertical traversal connectors (iteration 05): STAIR FLIGHTS (grid ramps with visual steps) and
// RESCUE LADDERS (grid nav links between a track bed and a platform), shared by generation, the
// builder, physics, the player and the AI. Pure data + math (no three.js).
//
// Generic by design (later levels): `layStairRun` carves a run of flights + landings between any
// two floor heights into a rect of cells; `placeLadders` hangs ladders on every platform face of
// every track bed; `finishTraversal` lifts dressing authored on the default floor onto the local
// floor height and keeps loot off stairs; `traversalIssues` validates (generation retry guard).
// Climbing (player and zombies) follows the same scripted path (`ladderClimbPath`).

import {CELL, FLOOR, VOID, type Grid, type Ramp, type StandPoint} from './grid';
import type {Rect, SignPlacement, StationLayout} from './stationTypes';

export type Vec3 = StandPoint;

/** Stair geometry (m). Risers ~0.17 x treads 0.28, at most 12 risers per flight, 1.2 m landings. */
export const STAIR = {riser: 0.17, tread: 0.28, maxRisers: 12, landing: 1.2, topLanding: 1.0, headroom: 2.5};
export type StairSpec = typeof STAIR;

/** Underpass below the tracks: platform 0, track bed -1.15, crossing passage floor (m). */
export const UNDERPASS_FLOOR = -3.9;

/** Rescue ladders: inset from the platform ends, max spacing, stand-off of the foot point from the face, top stand-in. */
export const LADDER = {endInset: 3, maxSpacing: 34, standOff: 0.42, topIn: 0.55, cost: 10, cover: 22};

/** One stair flight (a grid ramp) in world space. */
export interface StairFlight {
  id: number;
  /** Area the flight is in and its grid ramp index. */
  area: number;
  ramp: number;
  axis: 'x' | 'z';
  /** Pitch line from (s0, h0) to (s1, h1) along the axis (run direction); across-axis span a0..a1. */
  s0: number; s1: number; h0: number; h1: number; a0: number; a1: number;
  risers: number; riser: number; tread: number; headroom: number;
  /** Walkable stand points on the landings just above and below the flight. */
  top: Vec3; bottom: Vec3;
}

/** A steel rescue ladder on a platform face, climbing from the track bed to the platform. */
export interface Ladder {
  id: number;
  /** Track bed (layout.trenches index) and the platform area it climbs to. */
  trench: number;
  platform: number;
  /** Centre along the face (world X: platform faces run along X). */
  x: number;
  /** World z of the platform face; dir = +1 when the platform lies toward +Z of it. */
  faceZ: number;
  dir: 1 | -1;
  /** Track-bed and platform floor heights. */
  bottomY: number;
  topY: number;
  /** Stand points: in the track bed at the ladder foot, and on the platform above it. */
  bottom: Vec3;
  top: Vec3;
  /** Ladder straight across on the other face of the same bed, or -1. */
  pair: number;
  /** Grid nav link index. */
  link: number;
}

/** An underpass: the crossing passage (bar) and the stair legs down to it from each platform. */
export interface Underpass {
  bar: number;
  legs: {area: number; platform: number; flights: number[]; side: 'W' | 'E'}[];
}

export interface Traversal {
  stairs: StairFlight[];
  ladders: Ladder[];
  underpasses: Underpass[];
}

export function emptyTraversal(): Traversal {
  return {stairs: [], ladders: [], underpasses: []};
}

// ---------------------------------------------------------------------------------------------
// Stairs

export interface StairPlan { risers: number[]; riser: number; tread: number; landing: number; length: number }

/** Flights for a height change: equal risers near spec.riser, split into flights with landings. */
export function planStairs(rise: number, spec: StairSpec = STAIR): StairPlan {
  const n = Math.max(1, Math.round(Math.abs(rise) / spec.riser));
  const flights = Math.ceil(n / spec.maxRisers);
  const risers: number[] = [];
  for (let k = 0; k < flights; k++) risers.push(Math.floor(n / flights) + (k < n % flights ? 1 : 0));
  return {risers, riser: Math.abs(rise) / n, tread: spec.tread, landing: spec.landing, length: n * spec.tread + (flights - 1) * spec.landing};
}

/** Cells a run of flights needs along its axis, including the top landing. */
export function stairRunCells(rise: number, spec: StairSpec = STAIR): number {
  return Math.ceil((planStairs(rise, spec).length + spec.topLanding) / CELL - 1e-6);
}

/**
 * Carves a run of flights into a rect of cells (full width): the run starts at the `from` end
 * of the rect at height h0 (top landing there) and ends flush with the far end at h1. Sets every
 * cell's floor and flight-following ceiling (floor + headroom), registers one grid ramp per flight.
 * Coordinates are the grid's own (pre-crop during generation; see shiftFlight).
 */
export function layStairRun(g: Grid, rect: Rect, area: number, axis: 'x' | 'z', from: 'lo' | 'hi', h0: number, h1: number, spec: StairSpec = STAIR): StairFlight[] {
  const plan = planStairs(h1 - h0, spec);
  const lo = (axis === 'x' ? rect.x : rect.y) * CELL, hi = lo + (axis === 'x' ? rect.w : rect.h) * CELL;
  const a0 = (axis === 'x' ? rect.y : rect.x) * CELL, a1 = a0 + (axis === 'x' ? rect.h : rect.w) * CELL;
  const lead = hi - lo - plan.length;
  if (lead < spec.topLanding - 1e-6) throw new Error(`stair run does not fit: ${hi - lo} m < ${plan.length + spec.topLanding} m`);
  const sgn = from === 'lo' ? 1 : -1, origin = from === 'lo' ? lo : hi;
  const S = (u: number) => origin + sgn * u;
  const dir = Math.sign(h1 - h0);
  const segs: {u0: number; u1: number; hA: number; hB: number; n: number}[] = [];
  let u = lead, h = h0;
  for (const n of plan.risers) {
    const u1 = u + n * plan.tread, hB = h + dir * n * plan.riser;
    segs.push({u0: u, u1, hA: h, hB, n});
    u = u1 + plan.landing;
    h = hB;
  }
  segs[segs.length - 1].hB = h1; // exact end height
  const profile = (uu: number): number => {
    for (const s of segs) {
      if (uu < s.u0) return s.hA;
      if (uu <= s.u1) return s.hA + (s.hB - s.hA) * (uu - s.u0) / (s.u1 - s.u0);
    }
    return h1;
  };
  // Flat floors / ceilings from the profile at each cell centre (ramps then overwrite their cells).
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = g.idx(x, y);
      const c = ((axis === 'x' ? x : y) + 0.5) * CELL;
      const f = profile((c - origin) * sgn);
      g.floor[i] = f;
      g.ceil[i] = f + spec.headroom;
    }
  }
  const out: StairFlight[] = [];
  for (const s of segs) {
    const p = S(s.u0), q = S(s.u1);
    const c0 = Math.floor(Math.min(p, q) / CELL + 1e-6), c1 = Math.ceil(Math.max(p, q) / CELL - 1e-6);
    const r: Ramp = axis === 'x'
      ? {x: c0, y: rect.y, w: c1 - c0, h: rect.h, axis, s0: p, s1: q, h0: s.hA, h1: s.hB, risers: s.n, headroom: spec.headroom}
      : {x: rect.x, y: c0, w: rect.w, h: c1 - c0, axis, s0: p, s1: q, h0: s.hA, h1: s.hB, risers: s.n, headroom: spec.headroom};
    const ramp = g.addRamp(r);
    const f: StairFlight = {id: -1, area, ramp, axis, s0: p, s1: q, h0: s.hA, h1: s.hB, a0, a1, risers: s.n, riser: plan.riser, tread: plan.tread, headroom: spec.headroom, top: {x: 0, y: 0, z: 0}, bottom: {x: 0, y: 0, z: 0}};
    standPoints(f);
    out.push(f);
  }
  return out;
}

/** Stand points 0.45 m beyond each end of the pitch line, centred across the flight. */
function standPoints(f: StairFlight): void {
  const sgn = Math.sign(f.s1 - f.s0) || 1;
  const ac = (f.a0 + f.a1) / 2;
  const at = (s: number, y: number): Vec3 => (f.axis === 'x' ? {x: s, y, z: ac} : {x: ac, y, z: s});
  const start = at(f.s0 - sgn * 0.45, f.h0), end = at(f.s1 + sgn * 0.45, f.h1);
  [f.top, f.bottom] = f.h0 >= f.h1 ? [start, end] : [end, start];
}

/** Moves a ramp by a crop offset of (ox, oy) cells. */
export function shiftRamp(r: Ramp, ox: number, oy: number): Ramp {
  const ds = (r.axis === 'x' ? ox : oy) * CELL;
  return {...r, x: r.x - ox, y: r.y - oy, s0: r.s0 - ds, s1: r.s1 - ds};
}

/** Moves a flight by a crop offset of (ox, oy) cells. */
export function shiftFlight(f: StairFlight, ox: number, oy: number): StairFlight {
  const ds = (f.axis === 'x' ? ox : oy) * CELL, da = (f.axis === 'x' ? oy : ox) * CELL;
  const mv = (p: Vec3): Vec3 => ({x: p.x - ox * CELL, y: p.y, z: p.z - oy * CELL});
  return {...f, s0: f.s0 - ds, s1: f.s1 - ds, a0: f.a0 - da, a1: f.a1 - da, top: mv(f.top), bottom: mv(f.bottom)};
}

// ---------------------------------------------------------------------------------------------
// Ladders

/** Evenly spaced stations along [x0, x1] (inset ends), at most maxSpacing apart. */
export function ladderStations(x0: number, x1: number, spec = LADDER): number[] {
  const a = x0 + spec.endInset, b = x1 - spec.endInset;
  if (b <= a) return [(x0 + x1) / 2];
  const n = Math.max(1, Math.ceil((b - a) / spec.maxSpacing));
  return Array.from({length: n + 1}, (_, k) => Math.round((a + (b - a) * k / n) * 4) / 4);
}

/**
 * Rescue ladders on every platform face of every track bed: one near each platform end and at
 * most LADDER.maxSpacing apart in between, straight across from each other on two-sided beds.
 * Registers a grid nav link per ladder (track-bed foot <-> platform top).
 */
export function placeLadders(layout: StationLayout, spec = LADDER): Ladder[] {
  const g = layout.grid;
  const out: Ladder[] = [];
  layout.trenches.forEach((t, ti) => {
    const rowN = Math.round(t.z0 / CELL) - 1, rowS = Math.round(t.z1 / CELL);
    const xs = ladderStations(t.platformX0, t.platformX1, spec);
    const faces: {faceZ: number; dir: 1 | -1; row: number}[] = [];
    for (const [row, faceZ, dir] of [[rowN, t.z0, -1], [rowS, t.z1, 1]] as const) {
      const cx = Math.floor(xs[Math.floor(xs.length / 2)] / CELL);
      const a = g.get(cx, row) === FLOOR ? g.area[g.idx(cx, row)] : -1;
      if (a >= 0 && layout.areas[a].kind === 'platform') faces.push({faceZ, dir, row});
    }
    const ids: number[][] = [];
    for (const f of faces) {
      const list: number[] = [];
      for (const x0 of xs) {
        // Slide along the face (deterministically) if a stand point is obstructed.
        for (const dx of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
          const x = x0 + dx;
          const bottom = {x, y: 0, z: f.faceZ - f.dir * spec.standOff};
          const top = {x, y: 0, z: f.faceZ + f.dir * spec.topIn};
          const [bx, by] = g.cellOf(bottom.x, bottom.z), [tx, ty] = g.cellOf(top.x, top.z);
          if (!g.passable(bx, by) || g.get(bx, by) !== VOID || !g.passable(tx, ty) || g.get(tx, ty) !== FLOOR) continue;
          if (!g.circleClearH(top.x, top.z, 0.34, g.floorAt(top.x, top.z))) continue;
          bottom.y = g.floorAt(bottom.x, bottom.z);
          top.y = g.floorAt(top.x, top.z);
          const id = out.length;
          const link = g.addLink({a: g.idx(bx, by), b: g.idx(tx, ty), cost: spec.cost, id, pa: bottom, pb: top});
          out.push({id, trench: ti, platform: g.area[g.idx(tx, ty)], x, faceZ: f.faceZ, dir: f.dir, bottomY: bottom.y, topY: top.y, bottom, top, pair: -1, link});
          list.push(id);
          break;
        }
      }
      ids.push(list);
    }
    if (ids.length === 2) {
      for (const a of ids[0]) {
        let best = -1, bd = 1.6;
        for (const b of ids[1]) { const d = Math.abs(out[a].x - out[b].x); if (d < bd) { bd = d; best = b; } }
        if (best >= 0 && out[best].pair < 0) { out[a].pair = best; out[best].pair = a; }
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Climbing (player + zombies share the scripted path)

/** Climb speeds: approach (m/s), vertical climb (m/s), over-the-edge duration (s). */
export const CLIMB = {
  player: {approach: 2.4, climb: 1.05, over: 0.42},
  zombie: {approach: 1.2, climb: 0.5, over: 0.8},
};

export interface ClimbPath {
  pts: Vec3[];
  /** Cumulative time at each point (t[0] = 0). */
  t: number[];
  /** Segment index that is the hand-over-hand climb (rung sounds, cancel = let go). */
  vertical: number;
  /** Segment index that crosses the platform edge (arcs slightly). */
  over: number;
  up: boolean;
}

export function ladderClimbPath(l: Ladder, up: boolean, from: Vec3, sp: {approach: number; climb: number; over: number} = CLIMB.player): ClimbPath {
  const foot: Vec3 = {x: l.x, y: l.bottomY, z: l.faceZ - l.dir * LADDER.standOff};
  const hang: Vec3 = {x: l.x, y: l.topY + 0.12, z: foot.z};
  const top: Vec3 = {x: l.x, y: l.topY, z: l.faceZ + l.dir * LADDER.topIn};
  const pts = up ? [from, foot, hang, top] : [from, top, hang, foot];
  const first = pts[1];
  const approach = Math.max(0.12, Math.hypot(first.x - from.x, first.y - from.y, first.z - from.z) / sp.approach);
  const climb = Math.abs(hang.y - foot.y) / sp.climb;
  const durs = up ? [approach, climb, sp.over] : [approach, sp.over, climb * 0.85];
  const t = [0];
  for (const d of durs) t.push(t[t.length - 1] + d);
  return {pts, t, vertical: up ? 1 : 2, over: up ? 2 : 1, up};
}

export function climbDuration(p: ClimbPath): number {
  return p.t[p.t.length - 1];
}

/** Position on a climb path at time `time` (clamped); returns the segment index. */
export function sampleClimb(p: ClimbPath, time: number, out: Vec3): number {
  const T = p.t;
  let k = 0;
  while (k < T.length - 2 && time > T[k + 1]) k++;
  const f = Math.max(0, Math.min(1, (time - T[k]) / Math.max(1e-6, T[k + 1] - T[k])));
  const a = p.pts[k], b = p.pts[k + 1];
  const e = k === p.over ? f * f * (3 - 2 * f) : f;
  out.x = a.x + (b.x - a.x) * e;
  out.y = a.y + (b.y - a.y) * e + (k === p.over ? 0.07 * Math.sin(Math.PI * f) : 0);
  out.z = a.z + (b.z - a.z) * e;
  return k;
}

/**
 * The ladder the player is looking at within reach: from the track bed the ladder itself (climb
 * up), from the platform the ladder head at the edge (climb down). Null if none.
 */
export function ladderTarget(ladders: readonly Ladder[], eye: Vec3, dir: Vec3, feetY: number, reach = 1.9): {ladder: Ladder; up: boolean; t: number} | null {
  let best: {ladder: Ladder; up: boolean; t: number} | null = null;
  for (const l of ladders) {
    if (Math.abs(eye.x - l.x) > 3 || Math.abs(eye.z - l.faceZ) > 3) continue;
    let up: boolean, min: Vec3, max: Vec3, r = reach;
    const zA = l.faceZ, zB = l.faceZ - l.dir * 0.32;
    if (Math.abs(feetY - l.bottomY) < 0.5) {
      up = true;
      min = {x: l.x - 0.38, y: l.bottomY + 0.05, z: Math.min(zA, zB)};
      max = {x: l.x + 0.38, y: l.topY + 0.75, z: Math.max(zA, zB)}; // the ladder head + the edge you grab
    } else if (Math.abs(feetY - l.topY) < 0.35) {
      up = false;
      r = reach + 0.4;
      const zC = l.faceZ + l.dir * 0.32;
      min = {x: l.x - 0.45, y: l.topY - 1.1, z: Math.min(zB, zC)};
      max = {x: l.x + 0.45, y: l.topY + 0.12, z: Math.max(zB, zC)};
    } else continue;
    const t = rayBox(eye, dir, min, max);
    if (t !== null && t <= r && (!best || t < best.t)) best = {ladder: l, up, t};
  }
  return best;
}

function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number | null {
  let t0 = -Infinity, t1 = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < min[k] || o[k] > max[k]) return null; continue; }
    let a = (min[k] - o[k]) / d[k], b = (max[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t1 < 0 ? null : Math.max(0, t0);
}

// ---------------------------------------------------------------------------------------------
// Post-dressing pass

/**
 * After dressing/spawns/lighting: fixtures follow the stepped/sloped ceilings of flights and the
 * underpass; props and loose pickups authored on the default floor (y relative to 0) are lifted
 * onto the local floor height; pickups never rest on stairs (moved to the nearest landing cell);
 * underpass wayfinding and ladder plates are added.
 */
export function finishTraversal(layout: StationLayout): void {
  const g = layout.grid;
  for (const l of layout.lights) {
    const [cx, cy] = g.cellOf(l.x, l.z);
    if (!g.inBounds(cx, cy)) continue;
    const r = g.rampIdx[g.idx(cx, cy)];
    const c = g.ceilAt(l.x, l.z);
    if (r >= 0) { l.y = c - 0.02; l.rot = g.ramps[r].axis === 'x' ? Math.PI / 2 : 0; }
    else if (Number.isFinite(c) && c < l.y + 0.02) l.y = c - 0.02;
  }
  const lift = (x: number, z: number): number => {
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy)) return 0;
    const i = g.idx(cx, cy);
    return g.cells[i] === FLOOR && g.rampIdx[i] < 0 ? g.floorOf(i) : 0;
  };
  for (const p of layout.props) p.y += lift(p.x, p.z);
  const used = new Set<number>();
  for (const p of layout.pickups) {
    let [cx, cy] = g.cellOf(p.x, p.z);
    if (g.inBounds(cx, cy) && g.rampIdx[g.idx(cx, cy)] >= 0) {
      const spot = nearestLanding(g, cx, cy, g.area[g.idx(cx, cy)], used);
      if (spot) {
        [cx, cy] = spot;
        [p.x, p.z] = g.center(cx, cy);
        p.y = 0;
        p.area = g.area[g.idx(cx, cy)];
      }
    }
    if (g.inBounds(cx, cy)) used.add(g.idx(cx, cy));
    p.y += lift(p.x, p.z);
  }
  addTraversalSigns(layout);
}

function nearestLanding(g: Grid, x: number, y: number, area: number, used: Set<number>): [number, number] | null {
  let any: [number, number] | null = null;
  for (let r = 1; r <= 16; r++) {
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
      const cx = x + ox, cy = y + oy;
      if (!g.walkable(cx, cy)) continue;
      const i = g.idx(cx, cy);
      if (g.rampIdx[i] >= 0 || used.has(i)) continue;
      if (g.area[i] === area) return [cx, cy];
      any ??= [cx, cy];
    }
    if (any) return any;
  }
  return any;
}

function addTraversalSigns(layout: StationLayout): void {
  const {grid: g, areas, traversal} = layout;
  const push = (s: SignPlacement) => layout.signs.push(s);
  for (const u of traversal.underpasses) {
    const bar = areas[u.bar];
    for (const leg of u.legs) {
      const A = areas[leg.area];
      const other = u.legs.find(l => l !== leg);
      const dest = other ? areas[other.platform] : null;
      const first = traversal.stairs[leg.flights[0]];
      if (!first) continue;
      const az = (A.y + A.h / 2) * CELL;
      // Hanging sign over the top landing, facing the platform door.
      const sgn = Math.sign(first.s1 - first.s0);
      const topX = first.s0 - sgn * 0.55;
      if (dest) push({x: topX, y: first.h0 + 2.05, z: az, rot: sgn < 0 ? Math.PI / 2 : -Math.PI / 2, kind: 'info', text: `UNDERPASS · TO ${dest.label.toUpperCase()}`, arrow: 'down', area: A.id, hang: true, w: 2.6});
      // At the bottom: plate on the crossing passage's outer wall facing this leg's mouth.
      const P = areas[leg.platform];
      const toward = P.towardsN ?? P.towardsS;
      const wallX = leg.side === 'W' ? bar.x * CELL + 0.02 : (bar.x + bar.w) * CELL - 0.02;
      const floor = g.floorAt((bar.x + bar.w / 2) * CELL, az);
      push({x: wallX, y: floor + 2.0, z: az, rot: leg.side === 'W' ? Math.PI / 2 : -Math.PI / 2, kind: 'info', text: `${P.label.toUpperCase()}${toward ? ` · TO ${toward.toUpperCase()}` : ''}`, arrow: 'up', area: bar.id, w: 2.6});
    }
  }
  for (const l of traversal.ladders) {
    push({x: l.x + 0.95, y: l.bottomY + 0.72, z: l.faceZ - l.dir * 0.02, rot: l.dir > 0 ? Math.PI : 0, kind: 'service', text: 'EMERGENCY LADDER', area: l.platform, w: 1.1});
  }
}

// ---------------------------------------------------------------------------------------------
// Validation + QA

/** Traversal invariants (generation retry guard and tests). */
export function traversalIssues(layout: StationLayout): string[] {
  const issues: string[] = [];
  const g = layout.grid;
  const {stairs, ladders} = layout.traversal;
  for (const f of stairs) {
    for (const [name, p] of [['top', f.top], ['bottom', f.bottom]] as const) {
      const [cx, cy] = g.cellOf(p.x, p.z);
      if (!g.passable(cx, cy) || Math.abs(g.floorAt(p.x, p.z) - p.y) > 0.05) issues.push(`flight ${f.id} ${name} landing not walkable`);
    }
    const r = g.ramps[f.ramp];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (g.blocked[g.idx(x, y)]) issues.push(`flight ${f.id} has a prop on its steps`);
  }
  for (const p of layout.pickups) {
    const [cx, cy] = g.cellOf(p.x, p.z);
    if (g.inBounds(cx, cy) && g.rampIdx[g.idx(cx, cy)] >= 0) issues.push(`pickup ${p.itemId} on stairs`);
  }
  for (const l of ladders) {
    const [bx, by] = g.cellOf(l.bottom.x, l.bottom.z), [tx, ty] = g.cellOf(l.top.x, l.top.z);
    if (!g.passable(bx, by) || g.get(bx, by) !== VOID) issues.push(`ladder ${l.id} foot blocked`);
    if (!g.passable(tx, ty) || !g.circleClearH(l.top.x, l.top.z, 0.34, l.topY)) issues.push(`ladder ${l.id} head blocked`);
  }
  // No softlock: every walkable track-bed cell has a ladder within LADDER.cover metres.
  layout.trenches.forEach((t, ti) => {
    const own = ladders.filter(l => l.trench === ti);
    if (!own.length) { issues.push(`track bed ${ti} has no ladder`); return; }
    for (let y = Math.round(t.z0 / CELL); y < Math.round(t.z1 / CELL); y++) {
      for (let x = Math.round(t.x0 / CELL); x < Math.round(t.x1 / CELL); x++) {
        if (!g.passable(x, y) || g.get(x, y) !== VOID) continue;
        const [wx, wz] = g.center(x, y);
        if (!own.some(l => Math.hypot(l.bottom.x - wx, l.bottom.z - wz) <= LADDER.cover)) { issues.push(`track bed ${ti} cell ${x},${y} has no ladder within ${LADDER.cover} m`); return; }
      }
    }
  });
  return issues;
}

/** Connector list for QA hooks / reports. */
export function traversalSummary(layout: StationLayout) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const p3 = (p: Vec3) => ({x: r2(p.x), y: r2(p.y), z: r2(p.z)});
  return {
    stairs: layout.traversal.stairs.map(f => ({id: f.id, area: f.area, label: layout.areas[f.area]?.label, axis: f.axis, risers: f.risers, riser: r2(f.riser), tread: r2(f.tread), top: p3(f.top), bottom: p3(f.bottom)})),
    ladders: layout.traversal.ladders.map(l => ({id: l.id, trench: l.trench, platform: l.platform, x: r2(l.x), faceZ: r2(l.faceZ), pair: l.pair, bottom: p3(l.bottom), top: p3(l.top)})),
    underpasses: layout.traversal.underpasses.map(u => ({bar: u.bar, floor: r2(layout.grid.floorAt((layout.areas[u.bar].x + layout.areas[u.bar].w / 2) * CELL, (layout.areas[u.bar].y + layout.areas[u.bar].h / 2) * CELL)), ceil: r2(layout.areas[u.bar].ceil), legs: u.legs.map(l => ({area: l.area, platform: l.platform, side: l.side, flights: l.flights}))})),
  };
}

/** True if a world point lies on a stair flight (no props/loot there). */
export function onStairs(g: Grid, x: number, z: number): boolean {
  const [cx, cy] = g.cellOf(x, z);
  return g.inBounds(cx, cy) && g.rampIdx[g.idx(cx, cy)] >= 0;
}
