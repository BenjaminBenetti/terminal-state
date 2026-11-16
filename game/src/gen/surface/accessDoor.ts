// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): SURFACE RUN — the way out of an Office tower lobby / a Mall to the
// street. RNG-NEUTRAL, nothing carved (the street side is a separate world, crossed behind a loading screen):
//  - Office: the lobby's boarded street doors (layout.office.windows kind 'entrance', gen/office/windows.ts) — one makeshift door is fitted
//    into the boarding at their middle, else the nearest spot along it whose walk-up can be opened (world/surface/accessView.ts draws it;
//    an EXIT plate is APPENDED above the opening). The barricade crates / cartons standing in front of it are MOVED aside along the
//    barricade (same index / kind / rotation / height; what rests on them moves with them; the grid's prop masks follow) so a 1.2 m
//    passage leads up to the door — the only change to a generated prop, and only in a station that has a way up (version-gated).
//  - Mall: one of the street-level exits (layout.mall.exits, all view-only and chained shut) is USABLE: picked by a hash of the level
//    seed; world/mallStreetExit.ts draws it without its lock (no chain / padlock, notices, board or lit EXIT CLOSED sign).
// Both record the [E] box in front of the door and a free return pose inside, facing away from it.

import {hashString} from '../../core/rng';
import {CELL, FLOOR, type Grid} from '../grid';
import {cellsOfBox} from '../placeKit';
import {levelDistance} from '../levelGen';
import type {SignPlacement, StationLayout} from '../stationTypes';
import type {SPose, SurfaceAccessInfo} from './surfaceTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Outward unit normal of a facade / exit side (from the inside to the street). */
const OUT: Record<string, [number, number]> = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]};

/** The office makeshift door's opening (m). */
export const OFFICE_DOOR = {w: 1.0, h: 2.1};

/**
 * A free standing pose inside a door: `depth` m (and further, up to `depth + 3`) inward from the wall plane, as near the door's middle
 * as the floor allows (a walkable cell, a 0.45 m circle clear of walls and blocking props, no prop box under it). Null: none.
 */
function freePose(layout: StationLayout, g: Grid, level: number, plane: number, mid: number, out: [number, number], depth: number, y: number): SPose | null {
  const [ox, oz] = out;
  const alongX = oz !== 0;
  const at = (d: number, s: number): [number, number] => alongX ? [mid + s, plane - oz * d] : [plane - ox * d, mid + s];
  const props = layout.props.filter(p => (p.level ?? 0) === level && !p.mounted && p.host === undefined && !p.cargoGone && p.h > 0.05);
  for (let k = 0; k <= 12; k++) {
    const d = depth + k * 0.25;
    for (const s of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
      const [x, z] = at(d, s);
      const [cx, cy] = g.cellOf(x, z);
      if (!g.walkable(cx, cy) || !g.circleClear(x, z, 0.45)) continue;
      if (props.some(p => Math.abs(p.x - x) < p.hx + 0.45 && Math.abs(p.z - z) < p.hz + 0.45)) continue;
      // facing away from the door: forward (-sin yaw, -cos yaw) = inward (-out)
      return {x: r3(x), z: r3(z), yaw: r3(Math.atan2(ox, oz)), level, y: r3(y)};
    }
  }
  return null;
}

/** The [E] box in front of a door: `half` m either side of its middle, from the wall plane `depth` m inward, y up 2.4 m from `y`. */
function triggerOf(plane: number, mid: number, out: [number, number], half: number, depth: number, y: number): SurfaceAccessInfo['trigger'] {
  const [ox, oz] = out;
  const a = oz !== 0 ? [mid - half, plane, mid + half, plane - oz * depth] : [plane, mid - half, plane - ox * depth, mid + half];
  return {x0: r3(Math.min(a[0], a[2])), z0: r3(Math.min(a[1], a[3])), x1: r3(Math.max(a[0], a[2])), z1: r3(Math.max(a[1], a[3])), y0: r3(y - 0.2), y1: r3(y + 2.4)};
}

/**
 * The walk-up passage to the office door: `width` m clear from the wall plane `depth` m into the lobby (through the barricade line, which
 * stands within ~2 m of the boarding: gen/office/dress.ts) — no standing prop box in it and no prop cell on the grid cells it touches
 * (the enemies' navigation reads the cells). The entrance barricade's pieces (`kinds`) standing in it are MOVED sideways along the
 * barricade line (`step` m at a time, at most `reach` m beyond the passage; else `back` m deeper / nearer) — same index, kind, rotation
 * and height; its on-top decor moves with it. A piece stacked on another / under another, or any other prop in the way: that door
 * position is not used (the next one along the boarding is tried).
 */
export const OFFICE_PASSAGE = {
  width: 1.2, depth: 2.6, step: 0.25, reach: 4, back: [0, 0.5, -0.25, 1],
  kinds: ['crate', 'cartonStack'] as const,
  /** Only when no door position works with the barricade pieces alone: light LOOSE props (each physically pushable in play: damage/materials.ts PROP_PHYSICS dynamic) are slid aside too. */
  loose: ['wetFloorSign'] as const,
};

type Move = {i: number; x: number; z: number};

/**
 * Plan the moves that clear the passage in front of a door at `mid` (null: something not of `kinds` stands in it, or a piece has no legal
 * free spot). Pure: nothing is changed.
 */
function planPassage(layout: StationLayout, g: Grid, level: number, plane: number, mid: number, out: [number, number], kinds: readonly string[]): Move[] | null {
  const P = OFFICE_PASSAGE, [ox, oz] = out, alongX = oz !== 0, half = P.width / 2;
  // local frame: s along the facade (from the door's middle), d inward from the wall plane
  const local = (x: number, z: number): [number, number] => alongX ? [x - mid, (z - plane) * -oz] : [z - mid, (x - plane) * -ox];
  const world = (s: number, d: number): [number, number] => alongX ? [mid + s, plane - oz * d] : [plane - ox * d, mid + s];
  const ext = (hx: number, hz: number): [number, number] => alongX ? [hx, hz] : [hz, hx];
  const standing = (i: number) => { const p = layout.props[i]; return (p.level ?? 0) === level && !p.mounted && p.host === undefined && !p.cargoGone && p.h > 0.05; };
  const boxes = layout.props.map((p, i) => standing(i) ? {i, x: p.x, z: p.z, hx: p.hx, hz: p.hz} : null).filter((b): b is NonNullable<typeof b> => !!b);
  // the passage's cells too (the grid's walkable mask is what the enemies' navigation reads): none may hold a prop's cell
  const [ax, az] = world(-half, 0), [bx, bz] = world(half, P.depth), e = 1e-6;
  const pc = [Math.floor((Math.min(ax, bx) + e) / CELL), Math.floor((Math.min(az, bz) + e) / CELL), Math.floor((Math.max(ax, bx) - e) / CELL), Math.floor((Math.max(az, bz) - e) / CELL)];
  const inPassage = (x: number, z: number, hx: number, hz: number) => {
    const [s, d] = local(x, z), [hs, hd] = ext(hx, hz), c = cellsOfBox(x, z, hx, hz);
    return (Math.abs(s) < half + hs && d - hd < P.depth && d + hd > -0.05) || (c[0] <= pc[2] && c[2] >= pc[0] && c[1] <= pc[3] && c[3] >= pc[1]);
  };
  const leaving = boxes.filter(o => inPassage(o.x, o.z, o.hx, o.hz)), gone = new Set(leaving.map(o => o.i));
  const left = leaving.map(o => cellsOfBox(o.x, o.z, o.hx, o.hz));
  const zombies = layout.zombies.filter(z => (z.level ?? 0) === level), items = layout.pickups.filter(k => (k.level ?? 0) === level);
  const moves: Move[] = [];
  for (const b of leaving) {
    const p = layout.props[b.i];
    if (!kinds.includes(p.kind)) return null; // (a desk / plant / column in the way: not a piece to move)
    const [s0, d0] = local(p.x, p.z), [hs] = ext(p.hx, p.hz), fl = g.floorAt(p.x, p.z);
    // (a piece stacked on another, or with another standing on it: not one to slide along the floor)
    if (Math.abs(p.y - fl) > 0.05 || boxes.some(o => o.i !== b.i && Math.abs(layout.props[o.i].y - (p.y + p.h)) < 0.05 && Math.abs(o.x - p.x) < p.hx && Math.abs(o.z - p.z) < p.hz)) return null;
    // what stays: every standing box not leaving the passage, and the pieces already given their new spot
    const stay = [...boxes.filter(o => !gone.has(o.i)), ...moves.map(m => ({...boxes.find(o => o.i === m.i)!, x: m.x, z: m.z}))];
    const stayCells = stay.map(o => cellsOfBox(o.x, o.z, o.hx, o.hz));
    const legal = (x: number, z: number): boolean => {
      if (inPassage(x, z, p.hx, p.hz)) return false;
      if (stay.some(o => Math.abs(o.x - x) < o.hx + p.hx + 0.02 && Math.abs(o.z - z) < o.hz + p.hz + 0.02)) return false; // (no overlap)
      // every cell under it: the same area's open floor at the same height, blocked by nothing but pieces leaving the passage
      const [cx0, cy0, cx1, cy1] = cellsOfBox(x, z, p.hx, p.hz);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        if (!g.inBounds(cx, cy)) return false;
        const c = g.idx(cx, cy);
        if (g.cells[c] !== FLOOR || g.area[c] !== p.area || Math.abs(g.floor[c] - fl) > 0.01) return false;
        if (g.blocked[c] && (!left.some(r => inBox(cx, cy, r)) || stayCells.some(r => inBox(cx, cy, r)))) return false;
      }
      // never over an enemy spawn (the validator's 0.35 m clear circle) or a loose item lying on the floor
      const wx0 = cx0 * CELL, wz0 = cy0 * CELL, wx1 = (cx1 + 1) * CELL, wz1 = (cy1 + 1) * CELL;
      const near = (px: number, pz: number, r: number) => Math.hypot(px - Math.max(wx0, Math.min(px, wx1)), pz - Math.max(wz0, Math.min(pz, wz1))) < r;
      return !zombies.some(zb => near(zb.x, zb.z, 0.4)) && !items.some(k => k.y < fl + 0.3 && near(k.x, k.z, 0.1));
    };
    // the nearest legal spot along the barricade line (its own side first), else a little deeper / nearer the boarding
    let spot: [number, number] | null = null;
    find: for (const dd of P.back) for (const side of s0 < -0.01 ? [-1, 1] : [1, -1]) for (let k = 0; k * P.step <= P.reach; k++) {
      const [x, z] = world(side * (half + hs + 0.05 + k * P.step), d0 + dd);
      if (legal(x, z)) { spot = [r3(x), r3(z)]; break find; }
    }
    if (!spot) return null;
    moves.push({i: b.i, x: spot[0], z: spot[1]});
  }
  return moves;
}

const inBox = (cx: number, cy: number, [x0, y0, x1, y1]: [number, number, number, number]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;

/** What applyMoves may change (every prop / pickup position, the storey grid's prop masks) and the function that puts it back. */
function snapshotMoves(layout: StationLayout, g: Grid): () => void {
  const props = layout.props.map(p => [p.x, p.z] as const), picks = layout.pickups.map(k => [k.x, k.z] as const);
  const blocked = g.blocked.slice(), sight = g.sightBlocked.slice();
  return () => {
    layout.props.forEach((p, i) => { [p.x, p.z] = props[i]; });
    layout.pickups.forEach((k, i) => { [k.x, k.z] = picks[i]; });
    g.blocked.set(blocked);
    g.sightBlocked.set(sight);
  };
}

/** Apply planned moves: the props (and what rests on them: hosted props, loose items on the top) move; the grid's prop masks follow. */
function applyMoves(layout: StationLayout, g: Grid, level: number, moves: readonly Move[]): void {
  const touched: [number, number, number, number][] = [];
  for (const m of moves) {
    const p = layout.props[m.i], dx = m.x - p.x, dz = m.z - p.z, top = p.y + p.h;
    const old = cellsOfBox(p.x, p.z, p.hx, p.hz);
    touched.push(old);
    for (const q of layout.props) if (q.host === m.i) { q.x = r3(q.x + dx); q.z = r3(q.z + dz); } // (its on-top decor)
    for (const k of layout.pickups) {
      if ((k.level ?? 0) !== level || Math.abs(k.x - p.x) > p.hx || Math.abs(k.z - p.z) > p.hz || k.y < top - 0.05 || k.y > top + 0.6) continue;
      k.x = r3(k.x + dx); k.z = r3(k.z + dz);
    }
    p.x = m.x; p.z = m.z;
  }
  // the masks: the cells the pieces left are re-derived from every standing prop of the storey still on them; the new cells blocked
  for (const [x0, y0, x1, y1] of touched) for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (g.inBounds(cx, cy)) { const c = g.idx(cx, cy); g.blocked[c] = 0; g.sightBlocked[c] = 0; }
  for (const q of layout.props) {
    if ((q.level ?? 0) !== level || q.mounted || q.host !== undefined || q.cargoGone || q.h <= 0.05) continue;
    const b = cellsOfBox(q.x, q.z, q.hx, q.hz);
    if (!touched.some(t => b[0] <= t[2] && b[2] >= t[0] && b[1] <= t[3] && b[3] >= t[1]) && !moves.some(m => layout.props[m.i] === q)) continue;
    for (let cy = b[1]; cy <= b[3]; cy++) for (let cx = b[0]; cx <= b[2]; cx++) if (g.inBounds(cx, cy)) { const c = g.idx(cx, cy); g.blocked[c] = 1; if (q.blocksSight) g.sightBlocked[c] = 1; }
  }
}

/** Every walkable cell reachable from the spawn before the moves still is (the cells the pieces now stand on excepted). */
function keepsReach(layout: StationLayout, before: readonly Int32Array[], after: readonly Int32Array[]): boolean {
  return layout.levels.every((L, k) => { const b = L.grid.blocked; for (let i = 0; i < b.length; i++) if (before[k][i] >= 0 && after[k][i] < 0 && !b[i]) return false; return true; });
}

/** Office Space: the makeshift door in the lobby's boarded street doors. Null: no entrance span (never for a generated tower). */
export function carveOfficeAccess(layout: StationLayout): SurfaceAccessInfo | null {
  const ent = layout.office?.windows.find(w => w.kind === 'entrance');
  const out = ent && OUT[ent.side];
  if (!ent || !out) return null;
  const level = ent.level ?? 1, L = layout.levels[level];
  if (!L) return null;
  const g = L.grid, alongX = out[1] !== 0;
  // the inner wall plane (the lobby side) and the opening's middle along the facade
  const plane = alongX ? (out[1] < 0 ? ent.z1 : ent.z0) : (out[0] < 0 ? ent.x1 : ent.x0);
  const lo = alongX ? ent.x0 : ent.z0, hi = alongX ? ent.x1 : ent.z1;
  const y = ent.baseY ?? L.baseY; // (the lobby storey's floor)
  // the door: the span's middle, else the nearest position along the boarding (0.5 m steps) whose walk-up passage can be opened by moving
  // barricade pieces (failing every position: barricade pieces and light loose props), that cuts nothing reachable off and has a free
  // return pose behind it (a candidate that fails after its moves is put back exactly: nothing half-done)
  const reach = () => { const [sx, sy] = layout.levels[0].grid.cellOf(layout.playerSpawn.x, layout.playerSpawn.z); return levelDistance(layout.levels, sx, sy, 0, layout.levelLinks); };
  let mid = 0, returnPose: SPose | null = null, before: Int32Array[] | null = null;
  for (const kinds of [OFFICE_PASSAGE.kinds, [...OFFICE_PASSAGE.kinds, ...OFFICE_PASSAGE.loose]] as readonly string[][]) {
    for (let k = 0; k < 2 * Math.ceil((hi - lo) / 0.5) + 1 && !returnPose; k++) {
      const m = (lo + hi) / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
      if (m - OFFICE_DOOR.w / 2 - 0.15 < lo || m + OFFICE_DOOR.w / 2 + 0.15 > hi) continue;
      const moves = planPassage(layout, g, level, plane, m, out, kinds);
      if (!moves) continue;
      if (moves.length && !before) before = reach(); // (the station as generated: every failed candidate was put back)
      const undo = snapshotMoves(layout, g);
      applyMoves(layout, g, level, moves);
      const pose = moves.length && !keepsReach(layout, before!, reach()) ? null : freePose(layout, g, level, plane, m, out, 3.4, y);
      if (pose) { returnPose = pose; mid = m; } else undo();
    }
    if (returnPose) break;
  }
  if (!returnPose) return null;
  const inX = alongX ? mid : plane - out[0] * 0.3, inZ = alongX ? plane - out[1] * 0.3 : mid;
  const yaw = Math.atan2(-out[0], -out[1]); // the door's front faces into the lobby
  const lobby = g.areaAt(inX, inZ);
  // an EXIT plate over the opening (on the wall above the entrance head)
  const head = ent.head ?? 2.6;
  const sp: SignPlacement = {x: r3(alongX ? mid : plane - out[0] * 0.06), y: r3(y + head + 0.32), z: r3(alongX ? plane - out[1] * 0.06 : mid), rot: r3(yaw), kind: 'exit', text: 'EXIT · STREET', area: lobby >= 0 ? lobby : 0, w: 1.4};
  if (level) sp.level = level;
  layout.signs.push(sp);
  return {
    v: 1, kind: 'office-door', label: 'the street', areas: lobby >= 0 ? [lobby] : [],
    trigger: triggerOf(plane, mid, out, 1.1, 3.4, y), returnPose,
    door: {x: r3(alongX ? mid : plane), z: r3(alongX ? plane : mid), y: r3(y), yaw: r3(yaw), w: OFFICE_DOOR.w, h: OFFICE_DOOR.h, level},
  };
}

/** The Mall: one usable street exit (hashed by the level seed). Null: the mall has no street exits. */
export function carveMallAccess(layout: StationLayout, levelSeed: number): SurfaceAccessInfo | null {
  const exits = layout.mall?.exits ?? [];
  if (!exits.length) return null;
  const start = hashString('surface-access-mall-v1', levelSeed >>> 0) % exits.length;
  for (let k = 0; k < exits.length; k++) {
    const e = exits[(start + k) % exits.length];
    const out = OUT[e.side], L = layout.levels[e.level];
    if (!out || !L) continue;
    const {plane, s0, s1} = e.door;
    const mid = (s0 + s1) / 2, y = e.streetY;
    const returnPose = freePose(layout, L.grid, e.level, plane, mid, out, 2.2, y);
    if (!returnPose) continue;
    const g = L.grid, alongX = out[1] !== 0;
    const area = g.areaAt(alongX ? mid : plane - out[0] * 0.3, alongX ? plane - out[1] * 0.3 : mid);
    return {
      v: 1, kind: 'mall-door', label: 'the street', areas: area >= 0 ? [area] : [],
      trigger: triggerOf(plane, mid, out, Math.max(0.6, (s1 - s0) / 2), 2.4, y), returnPose, exit: e.id,
    };
  }
  return null;
}

/** (tests) the outward normal of a side. */
export const accessOutward = (side: string): [number, number] | undefined => OUT[side];
