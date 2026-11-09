// Task player-train-shell-20261101-202805 (lane PLACE): WHERE the player's home train (one level-one subway car, PARKED / static for
// now) stands in a finished level layout, and the spawn pose inside it. Pure and deterministic: a function of the FINISHED layout
// (final coordinates: the Subway's finishExtensions translation is already applied to every record it reads) and the car spec
// (world/playerTrainSpec.ts, pure data). Generation is untouched and nothing here mutates the layout.
//
// Frame (the shared contract, world/playerTrainSpec.ts): origin = the car centre on the track centre line at RAIL-TOP height; +X =
// the front (cab end); +Y up; -Z = the PLATFORM side. World = (x, railTopY, z) + R_y(yaw) · local, yaw = three.js rotation.y.
// The car always lies along a track (tracks run along world X), so yaw is 0 or PI. Because the frame is right-handed and its -Z side
// must face the platform, the platform side FIXES the front direction: front = -platformSide (yaw 0 = front +X with the platform at
// world -Z). Use trainToWorld / worldToTrain (exact for both yaws) rather than re-deriving the trig.
//
// Choice: every platform edge that faces a track (the edge's track is the one 2.0 m out), the START platform first (the platform the
// level's start pose stands on: Subway P1 at layout.playerSpawn, Office the island at office.start, Mall P2 at mall.start). The car
// centre goes as near the start's x as the clear stretch allows: the whole body inside the platform span, between the rescue-ladder
// stations (LADDER_CLEAR from each ladder: room for a player at its foot / on the climb), clear of service hatches (bed entries), the
// bed ends / tunnel mouths, bed props (two-track centre columns), low ceilings and enemy spawns / loot in the bed. Ties: the nearer
// edge, then a front pointing along the platform AWAY from the nearer bed end (as if the car had run in from that end). Another
// platform is only a fallback when the start platform has no room; null = the level genuinely cannot fit the car (tested never to
// happen on the corpora: tests/player-train-placement.test.ts).

import {CELL, VOID, type Grid} from './grid';
import type {Area, StationLayout} from './stationTypes';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from '../world/playerTrainSpec';

/** Running-rail geometry of every bed (world/builder.ts rails = world/trackExt/shell.ts SHELL: railY 0.22 + railH 0.15 / 2; gauge 0.72). */
export const RAIL_TOP_ABOVE_BED = 0.22 + 0.15 / 2;
export const RAIL_GAUGE_HALF = 0.72;
/** Platform edge -> its track's centre line (gen/stationKit.ts beds: always 2.0 m). */
export const EDGE_TO_TRACK = 2.0;

/** Placement clearances (m). */
export const TRAIN_CLEAR = {
  /** Rescue ladder centre -> the nearest body end (a player standing at the ladder foot, the climb, the AI nav link). */
  ladder: 0.75,
  /** Fallback ladder clearance, used only when no platform edge of the level fits with `ladder` (player radius 0.3 + 0.15). */
  ladderMin: 0.45,
  /** Service-hatch opening edge -> the nearest body end (the hatch stays reachable from the bed). */
  hatch: 1.0,
  /** Bed end face (tunnel mouth / end wall) -> the nearest body end. */
  bedEnd: 2.0,
  /** Body footprint -> any prop standing in the bed (the two-track centre columns: their faces are 3.75 m from the edge). */
  prop: 0.1,
  /** Roof top -> the bed ceiling. */
  ceiling: 0.1,
  /** Enemy spawn / loose pickup in the bed -> the body footprint (nothing generated may start inside or under the car). */
  spawn: 0.6,
  /** Interior floor above the platform floor: at most one step. */
  maxStep: 0.45,
} as const;

/** Cost of a front that points TOWARD the nearer bed end (metres of distance-equivalent; a tie-breaker only). */
const FRONT_PENALTY = 1.0;
/** A candidate off the start platform (fallback only). */
const OFF_START = 1000;

export interface TrainPlacement {
  /** layout.levels index the car stands on (the station level, 0 on every current level). */
  level: number;
  /** Car centre on the track centre line (world). */
  x: number;
  z: number;
  /** Rotation about +Y (three.js rotation.y): 0 (front toward +X) or PI (front toward -X). */
  yaw: number;
  /** World X direction of the car's front (local +X). */
  front: 1 | -1;
  /** World y of the rail tops = the local origin's height. */
  railTopY: number;
  /** World y of the interior floor (railTopY + spec.floorY). */
  floorY: number;
  /** World z of the track centre line (= z). */
  trackZ: number;
  /** layout.trenches index and the index of the track in its `tracks`. */
  trenchIndex: number;
  trackIndex: number;
  /** The platform area the doors open onto, the world z of its edge, and which side of the track it lies on (+1 = toward +Z). */
  platformArea: number;
  platformEdgeZ: number;
  platformSide: 1 | -1;
  /** World X span of the body (x0 < x1) and the spec length / width it was placed for. */
  x0: number;
  x1: number;
  length: number;
  width: number;
}

/** Train-local -> world (exact for yaw 0 / PI). */
export function trainToWorld(p: Pick<TrainPlacement, 'x' | 'z' | 'railTopY' | 'front'>, lx: number, ly: number, lz: number): {x: number; y: number; z: number} {
  return {x: p.x + p.front * lx, y: p.railTopY + ly, z: p.z + p.front * lz};
}

/** World -> train-local (exact for yaw 0 / PI). */
export function worldToTrain(p: Pick<TrainPlacement, 'x' | 'z' | 'railTopY' | 'front'>, wx: number, wy: number, wz: number): {x: number; y: number; z: number} {
  return {x: (wx - p.x) * p.front, y: wy - p.railTopY, z: (wz - p.z) * p.front};
}

interface Span { a: number; b: number }

/** [lo, hi] minus the union of the open intervals `cut`, as closed spans (ascending). */
function subtract(lo: number, hi: number, cut: Span[]): Span[] {
  if (!(hi >= lo)) return [];
  const sorted = cut.filter(c => c.b > lo && c.a < hi).sort((u, v) => u.a - v.a);
  const out: Span[] = [];
  let at = lo;
  for (const c of sorted) {
    if (c.a > at) out.push({a: at, b: Math.min(c.a, hi)});
    at = Math.max(at, c.b);
    if (at >= hi) break;
  }
  if (at <= hi) out.push({a: at, b: hi});
  // whole centimetres inside each span (a placement never sits a rounding hair inside a cut)
  return out.map(s => ({a: Math.ceil(s.a * 100 - 1e-6) / 100, b: Math.floor(s.b * 100 + 1e-6) / 100})).filter(s => s.b >= s.a);
}

/** The point of `spans` nearest to `want` (the lower one on an exact tie). */
function nearest(spans: Span[], want: number): number | null {
  let best: number | null = null;
  for (const s of spans) {
    const x = Math.min(s.b, Math.max(s.a, want));
    if (best === null || Math.abs(x - want) < Math.abs(best - want) - 1e-9) best = x;
  }
  return best;
}

interface Candidate {
  area: Area;
  level: number;
  trenchIndex: number;
  trackIndex: number;
  edgeZ: number;
  side: 1 | -1;
  start: boolean;
}

/** Every platform edge that faces a track bed with a track centre EDGE_TO_TRACK out (the start platform's flagged). */
function candidates(layout: StationLayout, startArea: number): Candidate[] {
  const out: Candidate[] = [];
  for (const id of layout.platforms) {
    const a = layout.areas[id];
    if (!a || a.kind !== 'platform') continue;
    const edges: ('N' | 'S')[] = a.edge === 'NS' ? ['N', 'S'] : [a.edge ?? 'N'];
    const ax0 = a.x * CELL, ax1 = (a.x + a.w) * CELL;
    for (const e of edges) {
      const edgeZ = (e === 'N' ? a.y : a.y + a.h) * CELL;
      // edge N: the platform's low-z edge faces a bed lying toward -Z (the platform is at +Z of the track); edge S the reverse
      const side: 1 | -1 = e === 'N' ? 1 : -1;
      layout.trenches.forEach((t, ti) => {
        if (Math.abs((e === 'N' ? t.z1 : t.z0) - edgeZ) > 1e-6) return;
        if (Math.min(t.platformX1, ax1) - Math.max(t.platformX0, ax0) <= 0) return;
        let k = -1;
        t.tracks.forEach((tz, i) => { if (Math.abs(Math.abs(tz - edgeZ) - EDGE_TO_TRACK) < 0.05 && (k < 0 || Math.abs(tz - edgeZ) < Math.abs(t.tracks[k] - edgeZ))) k = i; });
        if (k < 0) return;
        out.push({area: a, level: a.level ?? 0, trenchIndex: ti, trackIndex: k, edgeZ, side, start: id === startArea});
      });
    }
  }
  return out;
}

/** The start pose of a layout (Office / Mall platform starts, else the Subway's playerSpawn). Same order as levels/registry.ts arrivalPose. */
function startPoint(layout: StationLayout): {x: number; z: number; level: number} {
  const s = layout.office?.start ?? layout.mall?.start ?? layout.skyways?.start ?? layout.bunker?.start; // (+ Skyways' platform start; + the Bunker's: task studio-bunker-level-20261109-072224-01)
  if (s) return {x: s.x, z: s.z, level: s.level ?? 0};
  const sp = layout.playerSpawn as {x: number; z: number; level?: number};
  return {x: sp.x, z: sp.z, level: sp.level ?? 0};
}

function gridOf(layout: StationLayout, level: number): Grid {
  return (level > 0 ? layout.levels?.[level]?.grid : undefined) ?? layout.grid;
}

/** Centre-x spans of one candidate where the whole car fits (null: none), with the ladder clearance `ladderClear`. */
function freeSpans(layout: StationLayout, c: Candidate, spec: PlayerTrainSpec, ladderClear: number): Span[] {
  const t = layout.trenches[c.trenchIndex];
  const g = gridOf(layout, c.level);
  const L = spec.length, W = spec.width, half = L / 2;
  const trackZ = t.tracks[c.trackIndex];
  const railTopY = t.floorY + RAIL_TOP_ABOVE_BED;
  const roofY = railTopY + spec.roofY;
  const zA = trackZ - W / 2, zB = trackZ + W / 2;
  // the interior floor must be one step at most above the platform it opens onto
  const platFloor = g.floorAt((c.area.x + c.area.w / 2) * CELL, c.edgeZ + c.side * CELL / 2);
  const step = railTopY + spec.floorY - platFloor;
  if (!(step >= 0 && step <= TRAIN_CLEAR.maxStep)) return [];
  // the body inside the platform span (the trench's face span AND the platform area) and clear of the bed ends
  const lo = Math.max(t.platformX0, c.area.x * CELL, t.x0 + TRAIN_CLEAR.bedEnd) + half;
  const hi = Math.min(t.platformX1, (c.area.x + c.area.w) * CELL, t.x1 - TRAIN_CLEAR.bedEnd) - half;
  const cut: Span[] = [];
  const block = (x0: number, x1: number, pad: number) => cut.push({a: x0 - pad - half, b: x1 + pad + half});
  // rescue ladders whose foot / climb lies within reach of the body (the near face; never the far face of a two-track bed)
  for (const l of layout.traversal.ladders) {
    if (l.trench !== c.trenchIndex || (l.kind ?? 'rescue') !== 'rescue') continue;
    if (Math.abs(l.bottom.z - trackZ) < W / 2 + ladderClear) block(l.x, l.x, ladderClear);
  }
  // service hatches in this bed's walls (GEN-2 / the Office fallback): the opening plus its approach
  for (const n of layout.extensions?.annexes ?? []) {
    const b = n.bed;
    if (b && b.trench === c.trenchIndex) block(b.x - b.width / 2, b.x + b.width / 2, TRAIN_CLEAR.hatch);
  }
  // props standing in the bed within the body's band and height (columns; anything else a level puts there)
  const bandA = zA - TRAIN_CLEAR.prop, bandB = zB + TRAIN_CLEAR.prop;
  for (const p of layout.props) {
    if ((p.level ?? 0) !== c.level) continue;
    if (p.z + p.hz <= bandA || p.z - p.hz >= bandB) continue;
    if (p.y + p.h <= t.floorY + 0.02 || p.y >= roofY + TRAIN_CLEAR.ceiling) continue;
    block(p.x - p.hx, p.x + p.hx, TRAIN_CLEAR.prop);
  }
  // generated enemies / loose pickups in the bed under or beside the body
  const sA = Math.max(zA - TRAIN_CLEAR.spawn, t.z0), sB = Math.min(zB + TRAIN_CLEAR.spawn, t.z1);
  for (const s of layout.zombies) {
    if ((s.level ?? 0) !== c.level || s.z <= sA || s.z >= sB || (s.y ?? 0) > roofY) continue;
    block(s.x, s.x, TRAIN_CLEAR.spawn);
  }
  for (const p of layout.pickups) {
    if ((p.level ?? 0) !== c.level || p.z <= sA || p.z >= sB || p.y > roofY) continue;
    block(p.x, p.x, TRAIN_CLEAR.spawn);
  }
  // every grid cell under the body: track bed (VOID at the bed floor) with headroom over the roof
  const cy0 = Math.floor(zA / CELL), cy1 = Math.ceil(zB / CELL) - 1;
  const cx0 = Math.max(0, Math.floor((lo - half) / CELL)), cx1 = Math.min(g.w - 1, Math.ceil((hi + half) / CELL) - 1);
  for (let cx = cx0; cx <= cx1; cx++) {
    let ok = true;
    for (let cy = cy0; cy <= cy1 && ok; cy++) {
      if (!g.inBounds(cx, cy)) { ok = false; break; }
      const i = g.idx(cx, cy);
      if (g.cells[i] !== VOID || Math.abs(g.floorOf(i) - t.floorY) > 0.01) ok = false;
      else if (g.hasCeil(i) && g.ceil[i] < roofY + TRAIN_CLEAR.ceiling) ok = false;
    }
    if (!ok) block(cx * CELL, (cx + 1) * CELL, 0);
  }
  return subtract(lo, hi, cut);
}

function place(layout: StationLayout, spec: PlayerTrainSpec, ladderClear: number): TrainPlacement | null {
  const start = startPoint(layout);
  const g = gridOf(layout, start.level);
  const [scx, scy] = g.cellOf(start.x, start.z);
  const startArea = g.inBounds(scx, scy) ? g.area[g.idx(scx, scy)] : -1;
  let best: {cost: number; c: Candidate; cx: number} | null = null;
  for (const c of candidates(layout, startArea)) {
    const cx = nearest(freeSpans(layout, c, spec, ladderClear), start.x);
    if (cx === null) continue;
    const t = layout.trenches[c.trenchIndex];
    const front = -c.side as 1 | -1;
    const nearEnd = Math.sign(cx - (t.x0 + t.x1) / 2);
    const cost = Math.abs(cx - start.x) + Math.abs(c.edgeZ - start.z) + (nearEnd !== 0 && front === nearEnd ? FRONT_PENALTY : 0) + (c.start ? 0 : OFF_START);
    if (!best || cost < best.cost - 1e-9) best = {cost, c, cx};
  }
  if (!best) return null;
  const {c, cx} = best;
  const t = layout.trenches[c.trenchIndex];
  const front = -c.side as 1 | -1;
  const railTopY = t.floorY + RAIL_TOP_ABOVE_BED;
  const z = t.tracks[c.trackIndex];
  return Object.freeze({
    level: c.level, x: cx, z, yaw: front === 1 ? 0 : Math.PI, front, railTopY, floorY: railTopY + spec.floorY, trackZ: z,
    trenchIndex: c.trenchIndex, trackIndex: c.trackIndex, platformArea: c.area.id, platformEdgeZ: c.edgeZ, platformSide: c.side,
    x0: cx - spec.length / 2, x1: cx + spec.length / 2, length: spec.length, width: spec.width,
  });
}

const cache = new WeakMap<StationLayout, TrainPlacement | null>();

/**
 * The parked player train of a finished layout (see the file header), or null when no platform edge of the level fits the car.
 * Memoized per layout for the default spec (the same frozen object for the spawn and lane TRAIN's runtime).
 */
export function playerTrainPlacement(layout: StationLayout, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): TrainPlacement | null {
  const useCache = spec === PLAYER_TRAIN_SPEC;
  if (useCache && cache.has(layout)) return cache.get(layout)!;
  const p = place(layout, spec, TRAIN_CLEAR.ladder) ?? place(layout, spec, TRAIN_CLEAR.ladderMin);
  if (useCache) cache.set(layout, p);
  return p;
}

/** The player pose of a START arrival inside the parked train (levels/registry.ts arrivalPose). */
export interface TrainSpawnPose { x: number; z: number; yaw: number; level: number; y: number; source: 'train' }

/** Spawn clearances (m): from the saloon's end wall / cab partition and the side walls; distance back from the facing door's wall. */
export const TRAIN_SPAWN = {wallClear: 0.5, doorBack: 1.15} as const;

/**
 * The spawn point in train-local coordinates: in the passenger saloon (never the cab), in front of the MIDDLE platform-side door (the
 * side -1 door nearest x = 0; lane TRAIN: the doors start closed, so the first view is its "[E] Open doors"), TRAIN_SPAWN.doorBack
 * from that wall, at least TRAIN_SPAWN.wallClear from the partition / end wall and both side walls.
 */
export function trainSpawnLocal(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): {x: number; z: number} {
  const c = TRAIN_SPAWN.wallClear;
  const x0 = spec.interior.x0 + c, x1 = Math.min(spec.interior.x1, spec.cab.x0) - c;
  let door: number | null = null;
  for (const d of spec.doors) if (d.side === -1 && d.x >= x0 && d.x <= x1 && (door === null || Math.abs(d.x) < Math.abs(door))) door = d.x;
  const x = Math.min(x1, Math.max(x0, door ?? 0));
  const hw = spec.interior.halfWidth;
  const z = Math.min(hw - c, Math.max(-hw + c, -hw + TRAIN_SPAWN.doorBack));
  return {x, z};
}

/**
 * Where a START arrival puts the player: on the interior floor (EXPLICIT y = floorY — the grid floor under the car is the bed, -1.15) in
 * the passenger saloon, facing its middle platform-side door (trainSpawnLocal; local -Z: player yaw = the train's yaw, since the player's
 * forward is (-sin yaw, -cos yaw)). Lane TRAIN's section hook builds the floor volume synchronously before the first update (game.ts
 * buildSection).
 */
export function trainSpawnPose(_layout: StationLayout, p: TrainPlacement, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): TrainSpawnPose {
  const l = trainSpawnLocal(spec);
  const w = trainToWorld(p, l.x, spec.floorY, l.z);
  return {x: w.x, z: w.z, yaw: p.yaw, level: p.level, y: p.floorY, source: 'train'};
}
