// Task studio-skyways-rework-20261107-054512-01 (lane MAPS): the PLACEMENT of the Skyways LOCAL DIRECTORY BOARDS (`skywaysMapBoard`,
// gen/skyways/mapBoardKind.ts) — layout version 3 only (the live generator; legacy77/ never calls it). One tagged call in
// gen/skyways/index.ts after the destinations / greenery / ramen dressers and before the populations, on its own rng fork.
//
// Where (logical junctions and public hubs), in priority order, capped at SKYWAYS_MAP_BOARDS.max:
//  1. the station concourse near the foot of the transit stair;
//  2. every building's street-level lobby and skyway-level court / concourse (one per building-storey with public hub floor), near the
//     storey's main stair / escalator arrival (else the hub's centre);
//  3. both ends of every bridge — at its LANDING inside the building, beside the deck's walking lane (never on the deck), facing the
//     arrivals (skipped when a board already stands near that landing);
//  4. a second board in a big hub (SKYWAYS_MAP_BOARDS.bigHub m2 of hub floor on a storey), far from the first.
// How it stands: on flat public floor (the station placement kit: no door zones / door cells, no stair approaches / run mouths / link
// stand points, connectivity kept), off the composition's walking lanes and plazas, clear of the landmark discs, the anchors' storefront
// entries (and the other shop fronts), the add-on's entry / display and every bridge's lane into its buildings; a clear reading strip in
// front; its back toward the nearest wall where there is one (the middle of a court stays open). Lifted onto the storey's absolute floor.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, type Grid} from '../grid';
import {cellsOfBox, makePlaceCtx, markCell, tryPlaceProp, type PlaceCtx} from '../placeKit';
import {compositionOf} from '../compose';
import type {Area, StationLayout} from '../stationTypes';
import {footprint, type PropPlacement} from '../props';
import {keepLandmarkClear} from './destinations/landmarks';
import type {SkywaysRect} from './skywaysTypes';
import type {SkywaysMapBoardKind} from './mapBoardKind';

const KIND: SkywaysMapBoardKind = 'skywaysMapBoard';
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const SKYWAYS_MAP_BOARDS = {
  /** Boards per map at most. */
  max: 20,
  /** Hub floor (m2) of one building-storey that earns a second board. */
  bigHub: 900,
  /** Two boards of one storey stand at least this far apart (m); a second board in a big hub this far from the first. */
  spacing: 9,
  second: 16,
  /** A bridge landing already served by a board within this distance (m) gets none of its own. */
  landingServed: 10,
  /** How far (m) the landing point lies inside the facade; the search radius round a target. */
  landingIn: 3,
  search: 10,
  /** Preferred distance band (m) from the target (the stair foot / the landing / the hub centre). */
  near: [2.5, 7] as const,
  /** Preferred distance (m) of the board's centre from the nearest wall (back to a wall, the court's middle open). */
  wall: 1.3,
  /** Clear reading strip in front of the face (m) and a walking ring round it (m). */
  front: 1.2,
  ring: 0.5,
  /** Kept clear (m): in front of an anchor's storefront opening / another shop front; round the add-on's entry; round the prize display. */
  anchorFront: 3,
  shopFront: 1.5,
  addonEntry: 3.5,
  /** Each bridge's deck lane continued this far (m) into both buildings. */
  bridgeLane: 6,
  /** Round every stair / escalator stand point (m). */
  linkMouth: 3,
} as const;

/** Why a board stands where it does (QA / tests: SKYWAYS_MAP_BOARD_SITES). */
export type SkywaysBoardWhy = 'concourse' | 'lobby' | 'skyway' | 'bridge' | 'hub2';
export interface SkywaysBoardSite { why: SkywaysBoardWhy; building: string; level: number; target: {x: number; z: number}; placed: PropPlacement | null; ref?: string }
/** The sites of the last placement pass (QA / tests). */
export const SKYWAYS_MAP_BOARD_SITES: SkywaysBoardSite[] = [];

const inside = (r: SkywaysRect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const areaCentre = (a: Area) => ({x: (a.x + a.w / 2) * CELL, z: (a.y + a.h / 2) * CELL});
/** Front direction of a placement yaw (prop frame front +Z). */
const ROTS = [0, Math.PI / 2, Math.PI, -Math.PI / 2] as const;

/** Places the directory boards; returns how many were placed. */
export function placeSkywaysMapBoards(layout: StationLayout, rng: Rng): number {
  SKYWAYS_MAP_BOARD_SITES.length = 0;
  const info = layout.skyways;
  if (!info) return 0;
  const levels = layout.levels ?? [];
  const comp = compositionOf(layout);
  const ctxs = new Map<number, PlaceCtx>();
  const walls = new Map<number, Float32Array>();
  const ctxOf = (lv: number): PlaceCtx => {
    let c = ctxs.get(lv);
    if (!c) {
      c = makePlaceCtx(layout, rng, lv);
      // the composition's walking lanes / plazas of this storey (desire lines between portals, deliberate open floor)
      const m = comp?.masks[lv];
      if (m && m.lane.length === c.lane.length) { c.lane.set(m.lane); c.plaza.set(m.plaza); }
      keepLandmarkClear(c, layout);
      keepClear(c, layout);
      ctxs.set(lv, c);
    }
    return c;
  };
  const wallOf = (lv: number): Float32Array => { let w = walls.get(lv); if (!w) walls.set(lv, (w = wallDistance(levels[lv].grid))); return w; };
  const placed: PropPlacement[] = [];
  const addonAreas = new Set(info.addon.areas);
  const anchorAreas = new Set<number>((info.anchors ?? []).flatMap(an => [an.floor, ...(an.upper !== undefined ? [an.upper] : []), ...an.zones]));
  const bridgeAreas = new Set(info.bridges.map(b => b.area));
  /** The public HUB areas of a building on a storey (lobbies, courts, galleries, arcades, entrance halls, the food court). */
  const hubsOf = (bRect: SkywaysRect | null, lv: number): Area[] => layout.areas.filter(a => {
    if ((a.level ?? 0) !== lv || !a.publicSpace || a.ext || addonAreas.has(a.id) || anchorAreas.has(a.id) || bridgeAreas.has(a.id)) return false;
    if (a.kind !== 'concourse' || (a.type !== 'concourse' && a.type !== 'retail-arcade')) return false;
    if (/^Pedway to /.test(a.label)) return false;
    const c = areaCentre(a);
    return !bRect || inside(bRect, c.x, c.z);
  });
  const hubFloor = (areas: Area[]) => areas.reduce((s, a) => s + a.w * a.h * CELL * CELL, 0);

  const site = (why: SkywaysBoardWhy, building: string, lv: number, target: {x: number; z: number}, areas: Area[], look: {x: number; z: number}, ref?: string, minFrom: number = SKYWAYS_MAP_BOARDS.spacing): PropPlacement | null => {
    if (placed.length >= SKYWAYS_MAP_BOARDS.max || !levels[lv] || !areas.length) { SKYWAYS_MAP_BOARD_SITES.push({why, building, level: lv, target, placed: null, ...(ref ? {ref} : {})}); return null; }
    const others = placed.filter(q => (q.level ?? 0) === lv);
    let p = placeNear(ctxOf(lv), wallOf(lv), areas, target, look, others, minFrom);
    // a building-storey's own board: no room near its stair arrival -> round the centres of its hub pieces (largest first)
    if (!p && (why === 'lobby' || why === 'skyway' || why === 'concourse')) {
      for (const a of areas.slice().sort((q, r) => r.w * r.h - q.w * q.h).slice(0, 4)) {
        const c = areaCentre(a);
        if ((p = placeNear(ctxOf(lv), wallOf(lv), [a], c, c, others, minFrom))) break;
      }
    }
    if (p) placed.push(p);
    SKYWAYS_MAP_BOARD_SITES.push({why, building, level: lv, target, placed: p, ...(ref ? {ref} : {})});
    return p;
  };
  const stationB = info.buildings.find(b => b.role === 'station');

  // 1. the station concourse, near the foot of the transit stair
  {
    const transit = (layout.levelLinks ?? []).find(k => k.lower === 0 && /Concourse – Street level/.test(layout.areas[layout.traversal.stairs[k.traversalId ?? -1]?.area ?? -1]?.label ?? ''));
    const hubs = hubsOf(null, 0);
    if (transit && hubs.length) site('concourse', stationB?.id ?? '', 0, transit.bottom, hubs, transit.bottom);
  }
  // 2. every building-storey with public hub floor: its street lobby and its skyway court / concourse, near its main stair arrival
  for (const b of info.buildings) for (const lv of [1, 2]) {
    const hubs = hubsOf(b.rect, lv);
    if (!hubs.length) continue;
    const big = hubs.reduce((p, q) => (q.w * q.h > p.w * p.h ? q : p));
    const arrivals = (layout.levelLinks ?? []).flatMap(k => (k.lower === lv ? [k.bottom] : k.upper === lv ? [k.top] : [])).filter(q => inside(b.rect, q.x, q.z));
    const c = areaCentre(big);
    const target = arrivals.length ? arrivals.reduce((p, q) => (Math.hypot(q.x - c.x, q.z - c.z) < Math.hypot(p.x - c.x, p.z - c.z) ? q : p)) : c;
    site(lv === 1 ? 'lobby' : 'skyway', b.id, lv, target, hubs, target);
  }
  // 3. both ends of every bridge: at the landing inside each building, facing the arrivals
  for (const br of info.bridges) {
    const alongX = br.axis === 'x', mid = alongX ? (br.rect.z0 + br.rect.z1) / 2 : (br.rect.x0 + br.rect.x1) / 2;
    for (const id of [br.a, br.b]) {
      const b = info.buildings.find(q => q.id === id);
      if (!b) continue;
      const bc = {x: (b.rect.x0 + b.rect.x1) / 2, z: (b.rect.z0 + b.rect.z1) / 2};
      // the deck end at this building's facade and the inward direction
      const end = alongX ? (bc.x < (br.rect.x0 + br.rect.x1) / 2 ? br.rect.x0 : br.rect.x1) : (bc.z < (br.rect.z0 + br.rect.z1) / 2 ? br.rect.z0 : br.rect.z1);
      const dir = alongX ? Math.sign(bc.x - end) : Math.sign(bc.z - end);
      const mouth = alongX ? {x: end, z: mid} : {x: mid, z: end};
      const landing = alongX ? {x: end + dir * SKYWAYS_MAP_BOARDS.landingIn, z: mid} : {x: mid, z: end + dir * SKYWAYS_MAP_BOARDS.landingIn};
      if (placed.some(q => (q.level ?? 0) === br.level && Math.hypot(q.x - landing.x, q.z - landing.z) < SKYWAYS_MAP_BOARDS.landingServed)) {
        SKYWAYS_MAP_BOARD_SITES.push({why: 'bridge', building: id, level: br.level, target: landing, placed: null, ref: `${br.id}:served`});
        continue;
      }
      site('bridge', id, br.level, landing, hubsOf(b.rect, br.level), mouth, br.id);
    }
  }
  // 4. a second board in a big hub, far from the boards already there
  for (const b of info.buildings) for (const lv of [1, 2]) {
    const hubs = hubsOf(b.rect, lv);
    if (hubFloor(hubs) < SKYWAYS_MAP_BOARDS.bigHub) continue;
    const mine = placed.filter(q => (q.level ?? 0) === lv && inside(b.rect, q.x, q.z));
    if (mine.length >= 2) continue;
    // the hub cell farthest from the boards there: its area's centre (largest pieces first)
    const cands = hubs.slice().sort((p, q) => q.w * q.h - p.w * p.h).map(areaCentre)
      .filter(c => mine.every(q => Math.hypot(q.x - c.x, q.z - c.z) >= SKYWAYS_MAP_BOARDS.second));
    if (!cands.length) continue;
    site('hub2', b.id, lv, cands[0], hubs, cands[0], undefined, SKYWAYS_MAP_BOARDS.second);
  }
  return placed.length;
}

/** Cells kept clear for the boards on this storey: run mouths, bridge lanes, shop fronts, the add-on's entry and display. */
function keepClear(ctx: PlaceCtx, layout: StationLayout): void {
  const info = layout.skyways!, g = ctx.g, lv = ctx.level;
  const box = (x0: number, z0: number, x1: number, z1: number, area?: number) => {
    for (let cy = Math.floor(z0 / CELL); cy <= Math.floor(z1 / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      if (!g.inBounds(cx, cy)) continue;
      const i = g.idx(cx, cy);
      if (g.cells[i] === FLOOR && (area === undefined || g.area[i] === area)) markCell(ctx, ctx.keep, i);
    }
  };
  const disc = (x: number, z: number, r: number) => box(x - r, z - r, x + r, z + r);
  const M = SKYWAYS_MAP_BOARDS;
  for (const k of layout.levelLinks ?? []) { if (k.lower === lv) disc(k.bottom.x, k.bottom.z, M.linkMouth); if (k.upper === lv) disc(k.top.x, k.top.z, M.linkMouth); }
  for (const br of info.bridges) {
    if (br.level !== lv) continue;
    const r = br.rect, L = M.bridgeLane;
    if (br.axis === 'x') box(r.x0 - L, r.z0, r.x1 + L, r.z1); else box(r.x0, r.z0 - L, r.x1, r.z1 + L);
  }
  const anchorFronts = new Set((info.anchors ?? []).map(an => an.storefront));
  for (const sf of layout.storefronts ?? []) {
    if ((sf.level ?? 0) !== lv) continue;
    const d = anchorFronts.has(sf.id) ? M.anchorFront : M.shopFront;
    box(sf.ox * CELL - d, sf.oy * CELL - d, (sf.ox + sf.ow) * CELL + d, (sf.oy + sf.oh) * CELL + d);
  }
  const a = info.addon;
  if (a.level === lv) {
    disc(a.entry.x, a.entry.z, M.addonEntry);
    if (a.id === 'prize-car') box(a.hall.x0 - 1.5, a.hall.z0 - 1.5, a.hall.x1 + 1.5, a.hall.z1 + 1.5);
    if (a.car) disc(a.car.x, a.car.z, 7);
  }
}

/** Distance (m) of every cell to the nearest non-floor cell of the storey (multi-source BFS, 4-neighbour, in cells x CELL). */
function wallDistance(g: Grid): Float32Array {
  const n = g.w * g.h, d = new Float32Array(n).fill(Infinity), q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (g.cells[i] !== FLOOR) { d[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++], x = i % g.w, y = (i - x) / g.w, nd = d[i] + CELL;
    if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[qt++] = i - 1; }
    if (x < g.w - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[qt++] = i + 1; }
    if (y > 0 && d[i - g.w] > nd) { d[i - g.w] = nd; q[qt++] = i - g.w; }
    if (y < g.h - 1 && d[i + g.w] > nd) { d[i + g.w] = nd; q[qt++] = i + g.w; }
  }
  return d;
}

/**
 * The best spot for a board among `areas` near `target`: candidate cell centres within the search radius, scored by the distance band
 * from the target, the wall distance (back to a wall) and a little seeded jitter; at each, the yaws whose front looks most toward
 * `look` and away from the nearest wall first. Lifted onto the storey's absolute floor; flat floor only (no ramp, one floor height).
 */
function placeNear(ctx: PlaceCtx, wall: Float32Array, areas: Area[], target: {x: number; z: number}, look: {x: number; z: number}, others: PropPlacement[], minFrom: number): PropPlacement | null {
  const g = ctx.g, M = SKYWAYS_MAP_BOARDS, ids = new Set(areas.map(a => a.id));
  const byId = new Map(areas.map(a => [a.id, a]));
  const R = M.search;
  const cands: {x: number; z: number; s: number; a: Area}[] = [];
  for (let cy = Math.floor((target.z - R) / CELL); cy <= Math.floor((target.z + R) / CELL); cy++) for (let cx = Math.floor((target.x - R) / CELL); cx <= Math.floor((target.x + R) / CELL); cx++) {
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR || !ids.has(g.area[i]) || g.rampIdx[i] >= 0) continue;
    // board centres on cell corners or centres: the footprint (1.0 x 0.56 m) snaps to the 0.5 m lattice
    const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL, dt = Math.hypot(x - target.x, z - target.z);
    if (dt > R || others.some(o => Math.hypot(o.x - x, o.z - z) < minFrom)) continue;
    const band = dt < M.near[0] ? M.near[0] - dt : dt > M.near[1] ? dt - M.near[1] : 0;
    const s = band * 0.6 + Math.abs(wall[i] - M.wall) * 1.0 + ctx.rng.next() * 0.25;
    cands.push({x, z, s, a: byId.get(g.area[i])!});
  }
  cands.sort((p, q) => p.s - q.s);
  for (const c of cands.slice(0, 120)) {
    for (const rot of yawOrder(g, wall, c.x, c.z, look)) {
      const x = r3(c.x), z = r3(c.z), {hx, hz} = footprint(KIND, rot);
      if (!flatUnder(g, x, z, hx, hz)) continue;
      const p = tryPlaceProp(ctx, c.a, KIND, x, z, rot, {front: M.front, ring: M.ring});
      if (!p) continue;
      const [px, py] = g.cellOf(p.x, p.z);
      p.y = r3(g.floorOf(g.idx(px, py)));
      p.level = ctx.level;
      return p;
    }
  }
  return null;
}

/** The four yaws ordered: front toward `look`, preferring the one whose back is nearest a wall. */
function yawOrder(g: Grid, wall: Float32Array, x: number, z: number, look: {x: number; z: number}): number[] {
  const lx = look.x - x, lz = look.z - z, ll = Math.hypot(lx, lz) || 1;
  const backWall = (rot: number) => {
    // free floor behind the board (m, up to 3 m): a short run = a wall close behind
    const bx = -Math.round(Math.sin(rot)), bz = -Math.round(Math.cos(rot));
    let k = 1;
    for (; k <= 6; k++) { const [cx, cy] = g.cellOf(x + bx * k * CELL, z + bz * k * CELL); if (!g.inBounds(cx, cy) || wall[g.idx(cx, cy)] === 0) break; }
    return k * CELL;
  };
  return ROTS.map(rot => ({rot, s: -(Math.sin(rot) * lx + Math.cos(rot) * lz) / ll * 1.0 + backWall(rot) * 0.35}))
    .sort((p, q) => p.s - q.s).map(e => e.rot);
}

/** The footprint stands on one flat floor (no ramp cell, one floor height). */
function flatUnder(g: Grid, x: number, z: number, hx: number, hz: number): boolean {
  const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
  let f = NaN;
  for (let y = y0; y <= y1; y++) for (let cx = x0; cx <= x1; cx++) {
    if (!g.inBounds(cx, y)) return false;
    const i = g.idx(cx, y);
    if (g.rampIdx[i] >= 0) return false;
    const h = g.floorOf(i);
    if (Number.isNaN(f)) f = h; else if (Math.abs(h - f) > 0.01) return false;
  }
  return true;
}
