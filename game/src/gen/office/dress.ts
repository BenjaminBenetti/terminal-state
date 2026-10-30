// Iteration 16 (WORLD-GEN) / seamless (GEN): office dressing around the station dresser (gen/stationDress.ts dress()), one
// OfficeDress per tower storey of the one layout (preDress for every storey → ONE dress() → postDress for every storey). Pure data.
//
//  preDress  (before dress()): the perimeter strip along the facade walls is held blocked (so the room rules / generated props
//            never stand a tall cabinet in front of a window), then the program furniture the purpose rules cannot express:
//            CUBICLE FARMS (back-to-back pods of fabric partitions, a desk per cubicle against the spine, aisles all round),
//            the lobby's reception desk + waiting area + transit-concourse benches / vending / kiosk, conference tables.
//  postDress (after dress()): the strip is released; every office desk gets a chair pulled up and (mostly) a monitor on top
//            (host decor: they collide but never block the walk grid; the desk's loot surface gives up the monitor span),
//            chairs round the conference tables, the lobby entrance barricade, ceiling fixture grids (troffers) replacing the
//            dresser's sparse room lights in offices / halls / corridors, and signage (floor plates, stair / elevator / room plates).
// Everything goes through the dresser's placement primitive (gen/placeKit.ts: door zones, access strips, rings, connectivity).
//
// Task office-overhaul-20261030 (lane TENANTS): company floors are dressed by gen/office/companyDress.ts (companyPre / companyExtras
// in preDress, companyPost at the end of postDress): receptions, themed rooms, executive suites (item 7), server-room rack rows
// (item 9), corridor clearance + small plants (item 8), company plates / labels, the lobby's tenant directory. The lobby keeps a
// neutral corporate dressing (modern lobby sofas / armchairs, planter trees).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, type Grid} from '../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../props';
import {signDims, wallSignSpot} from '../doorways';
import {
  backed, begin, cellsOfBox, commit, propBlocksDoorway, rollback, doorSide, forceProp, makePlaceCtx, placeAgainstWall, rowAlongWall, tryPlaceProp, wallRange, type PlaceCtx,
} from '../placeKit';
import type {Area, Door, LightPlacement, Side, SignPlacement, StationLayout} from '../stationTypes';
import {CEIL, MARGIN, type TowerFrame} from './frame';
import type {CarvedTower, OfficeAreaMeta} from './tower';
import {companyExtras, companyPost, companyPre, companySignStyle, companyOf, roomPlate} from './companyDress';
import {freeRows, island, refurnish, scatter} from './companyDress'; // Task office-interactions-layout-20261030 (lane LAYOUT): large-room fill
import {BASE_ROOMS, type RoomKey, type Step} from './companies';

export interface OfficeDress {
  layout: StationLayout;
  frame: TowerFrame;
  tower: CarvedTower;
  floor: number;
  top: boolean;
  /** Level index of the office storey and its floor height. */
  level: number;
  base: number;
  rng: Rng;
  /** Street entrance (lobby only; tower-local columns on the north facade). */
  entrance?: {x0: number; x1: number};
  /** Perimeter strip (+ elevator landing strip) cells held blocked during dress(). */
  held: number[];
  /** TENANTS: company steps deferred to postDress (pieces by the windows, once the strip is released). */
  deferred?: {area: number; step: Step}[];
}

/** Elevator landing strip in front of the shaft door (tower-local cells): 5 cols x 3 rows, kept walkable and prop-free. */
export function landingStrip(f: TowerFrame): {x: number; y: number; w: number; h: number} {
  return {x: f.door.x - 1, y: f.cy0 - 4, w: f.door.w + 2, h: 3};
}

const q4 = (v: number) => Math.round(v * 4) / 4;
const roleOf = (d: OfficeDress, a: Area): OfficeAreaMeta['role'] | undefined => d.tower.meta.get(a.id)?.role;
const officeGrid = (d: OfficeDress): Grid => d.layout.levels[d.level].grid;
const doorsOf = (layout: StationLayout, a: Area): Door[] => layout.doors.filter(q => q.a === a.id || q.b === a.id);

/** Interior (tower-local [0, TW) x [0, TD)) cells next to the perimeter wall ring, in grid cells. */
function perimeterStrip(d: OfficeDress): number[] {
  const g = officeGrid(d), {TW, TD} = d.frame, out: number[] = [];
  for (let ty = 0; ty < TD; ty++) for (let tx = 0; tx < TW; tx++) {
    if (tx !== 0 && ty !== 0 && tx !== TW - 1 && ty !== TD - 1) continue;
    const i = g.idx(tx + MARGIN, ty + MARGIN);
    if (g.cells[i] === FLOOR && !g.blocked[i] && d.tower.meta.has(g.area[i])) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Before dress()

/**
 * TENANTS: the storeys share ONE ramps list (gen/office/common.ts cropKit), and placeKit.makePlaceCtx keeps a 1.5 m "stair
 * approach" clear beyond the ends of EVERY ramp in it — so the station stair run and the other storeys' scissor runs stamped
 * phantom keep-out patches into the S band of every office floor (cubicle pods / company furniture there failed). While a storey
 * is dressed (preDress .. end of postDress) its grid sees the ramps of other storeys parked far outside the grid (same indices,
 * so its own rampIdx lookups are untouched); postDress restores the shared list.
 */
const SHARED_RAMPS = new WeakMap<Grid, Grid['ramps']>();
function ownRampsOnly(g: Grid): void {
  if (SHARED_RAMPS.has(g)) return;
  const own = new Set<number>();
  for (let i = 0; i < g.rampIdx.length; i++) if (g.rampIdx[i] >= 0) own.add(g.rampIdx[i]);
  SHARED_RAMPS.set(g, g.ramps);
  g.ramps = g.ramps.map((r, k) => (own.has(k) ? r : {...r, x: -10000, y: -10000}));
}
function restoreRamps(g: Grid): void {
  const all = SHARED_RAMPS.get(g);
  if (all) { g.ramps = all; SHARED_RAMPS.delete(g); }
}

export function preDress(d: OfficeDress): void {
  const g = officeGrid(d);
  ownRampsOnly(g);
  d.held = perimeterStrip(d);
  // The row of the elevator landing strip farthest from the shaft (the rows nearer to it are the shaft opening's door zone,
  // gen/office/index.ts withShaftOpenings).
  const ls = landingStrip(d.frame);
  for (let x = ls.x; x < ls.x + ls.w; x++) { const i = g.idx(x + MARGIN, ls.y + MARGIN); if (g.cells[i] === FLOOR && !g.blocked[i]) d.held.push(i); }
  for (const i of d.held) g.blocked[i] = 1;
  const ctx = makePlaceCtx(d.layout, d.rng.fork('office-pre'), d.level);
  for (const a of d.layout.areas) {
    const m = d.tower.meta.get(a.id);
    if (!m) continue;
    // TENANTS: company rooms / receptions / executive suites / server rooms first; base rooms fall through, then get extras.
    if (companyPre(d, ctx, a, m)) continue;
    const role = m.role;
    if (role === 'open' || role === 'bay' || role === 'collapsed') cubicleFarm(d, ctx, a, role);
    else if (role === 'meeting') conferenceTable(d, ctx, a);
    else if (role === 'reception') reception(d, ctx, a);
    else if (role === 'transit' || role === 'lobby') lobbyWing(d, ctx, a, role);
    companyExtras(d, ctx, a, m);
  }
}

/** Margin (cells) kept free inside each wall of an open area: facades 2 (1 m window aisle), walls with openings 3. */
function margins(d: OfficeDress, a: Area): Record<Side, number> {
  const m: Record<Side, number> = {N: 2, S: 2, E: 2, W: 2};
  for (const q of doorsOf(d.layout, a)) m[doorSide(q, a)] = 3;
  return m;
}

/**
 * Cubicle farm: pods along the area's long axis — double pods (two rows of cubicles back to back on a partition spine, 4.5 m)
 * with 1.5 m aisles between pods and cross aisles every 2-5 cubicles; a single row where a double pod does not fit. Each
 * cubicle is 2.5 m wide (side partitions on the module lines) with its desk against the spine. Admin bays get a row of desks.
 * Collapsed (top floor): pods partly missing, partitions knocked down, debris.
 */
export function cubicleFarm(d: OfficeDress, ctx: PlaceCtx, a: Area, role: 'open' | 'bay' | 'collapsed', pods = false): void {
  const rng = ctx.rng, g = ctx.g;
  const m = margins(d, a);
  const ix0 = a.x + m.W, iy0 = a.y + m.N, iw = a.w - m.W - m.E, ih = a.h - m.N - m.S;
  if (iw < 6 || ih < 4) return;
  if (role === 'bay' || Math.min(iw, ih) < 5) {
    // Narrow admin bay: assistants' desks along the wall shared with the private offices (door zones stay clear).
    const off = d.tower.meta.get(a.id)?.facade ?? [];
    const sides: Side[] = (['N', 'S', 'E', 'W'] as Side[]).filter(s => !off.includes(s) && !doorsOf(d.layout, a).some(q => doorSide(q, a) === s && !d.layout.areas[q.a === a.id ? q.b : q.a]?.type.startsWith('office-room')));
    for (const s of sides.length ? sides : ['N', 'S'] as Side[]) {
      const [lo, hi] = wallRange(a, s);
      if (rowAlongWall(ctx, a, s, 'desk', {from: lo + 0.6, to: hi - 0.6, max: rng.int(2, 4), cluster: 2, gap: 1.6, front: 0.8}).length) break;
    }
    return;
  }
  const alongX = iw >= ih;
  const U = alongX ? iw : ih, V = alongX ? ih : iw;
  const xy = (u: number, v: number): [number, number] => (alongX ? [ix0 + u, iy0 + v] : [ix0 + v, iy0 + u]);
  // Pod rows across V.
  const rows: {v0: number; kind: 'double' | 'single'}[] = [];
  let v = 0;
  while (V - v >= 9) { rows.push({v0: v, kind: 'double'}); v += 12; }
  if (V - v >= 5) { rows.push({v0: v, kind: 'single'}); v += 8; }
  if (!rows.length) return;
  const usedV = Math.min(V, v - 3);
  const dv = Math.floor((V - usedV) / 2);
  // Segments along U.
  const nMax = rng.int(3, 5);
  const segs: {u0: number; n: number}[] = [];
  let u = 0;
  while (U - u >= 11) {
    const n = Math.min(nMax, Math.floor((U - u - 1) / 5));
    if (n < 2) break;
    segs.push({u0: u, n});
    u += 5 * n + 1 + 3;
  }
  if (!segs.length) return;
  const usedU = u - 3;
  const du = Math.floor((U - usedU) / 2);
  const free = (cx: number, cy: number) => g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] === FLOOR && g.area[g.idx(cx, cy)] === a.id && !g.blocked[g.idx(cx, cy)]
    && !ctx.zone[g.idx(cx, cy)] && !ctx.doorCell[g.idx(cx, cy)] && !ctx.edge[g.idx(cx, cy)] && !ctx.keep[g.idx(cx, cy)];
  const box = (ua: number, va: number, ub: number, vb: number): boolean => {
    for (let uu = ua; uu <= ub; uu++) for (let vv = va; vv <= vb; vv++) { const [cx, cy] = xy(uu, vv); if (!free(cx, cy)) return false; }
    return true;
  };
  /** Partition over the cell run (ua, va) .. (ub, vb) inclusive (one of the two spans is a single cell). */
  const partition = (ua: number, va: number, ub: number, vb: number): void => {
    // TENANTS: open studios / newsrooms are bench desking (desk pods without fabric partitions).
    if (pods) return;
    const [x0, y0] = xy(Math.min(ua, ub), Math.min(va, vb)), [x1, y1] = xy(Math.max(ua, ub), Math.max(va, vb));
    const cx = (Math.min(x0, x1) + Math.max(x0, x1) + 1) / 2 * CELL, cz = (Math.min(y0, y1) + Math.max(y0, y1) + 1) / 2 * CELL;
    const lx = (Math.abs(x1 - x0) + 1) * CELL, lz = (Math.abs(y1 - y0) + 1) * CELL;
    const hx = lx > CELL ? lx / 2 : 0.04, hz = lz > CELL ? lz / 2 : 0.04;
    const p = forceProp(ctx, a, 'cubiclePartition', cx, cz, hx, hz, PROP_DEFS.cubiclePartition.h, false);
    p.variant = rng.int(0, 2);
  };
  const desk = (uCell: number, vDesk0: number, dir: -1 | 1): void => {
    // Desk: 3 cells along U starting at uCell, 2 cells across V from vDesk0; front (the sitter's side) toward dir.
    const [xa, ya] = xy(uCell, vDesk0);
    const cx = alongX ? (xa + 1.5) * CELL : (xa + 1) * CELL;
    const cz = alongX ? (ya + 1) * CELL : (ya + 1.5) * CELL;
    const rot = alongX ? (dir < 0 ? Math.PI : 0) : (dir < 0 ? -Math.PI / 2 : Math.PI / 2);
    tryPlaceProp(ctx, a, 'desk', cx, cz, rot, {variant: rng.int(0, 2)});
  };
  const collapsed = role === 'collapsed';
  for (const r of rows) {
    for (const s0 of segs) {
      const V0 = dv + r.v0;
      const V1 = V0 + (r.kind === 'double' ? 8 : 4);
      // TENANTS: a pod that does not fit (a stair approach, company furniture) shrinks / slides to the cubicles that do.
      let fit: {U0: number; n: number} | null = null;
      for (let off = 0; off <= 5 * (s0.n - 2) && !fit; off += 5) {
        for (let n = s0.n - off / 5; n >= 2 && !fit; n--) if (box(du + s0.u0 + off, V0, du + s0.u0 + off + 5 * n, V1)) fit = {U0: du + s0.u0 + off, n};
      }
      if (!fit) continue;
      const s = {u0: fit.U0 - du, n: fit.n}, U0 = fit.U0, U1 = U0 + 5 * s.n;
      if (collapsed && rng.chance(0.45)) continue;
      const spineV = r.kind === 'double' ? V0 + 4 : V0 + 4;
      const knock = collapsed ? 0.4 : 0.08;
      partition(U0, spineV, U1, spineV);
      for (let i = 0; i <= s.n; i++) if (i === 0 || i === s.n || !rng.chance(knock)) partition(U0 + 5 * i, V0, U0 + 5 * i, V1);
      for (let i = 0; i < s.n; i++) {
        const shift = rng.int(0, 1);
        if (!rng.chance(collapsed ? 0.4 : 0.1)) desk(U0 + 5 * i + 1 + shift, spineV - 2, -1);
        if (r.kind === 'double' && !rng.chance(collapsed ? 0.4 : 0.1)) desk(U0 + 5 * i + 1 + shift, spineV + 1, 1);
      }
    }
  }
  if (collapsed) {
    // Fallen ceiling, toppled furniture: crates / cartons / bags heaped in the open floor (cover; crates hold finite loot).
    for (let i = 0, n = rng.int(4, 7); i < n; i++) {
      const kind: PropKind = rng.pick(['crate', 'cartonStack', 'crate', 'officeFiling'] as PropKind[]);
      const x = q4(rng.range((a.x + 2) * CELL, (a.x + a.w - 2) * CELL)), z = q4(rng.range((a.y + 2) * CELL, (a.y + a.h - 2) * CELL));
      tryPlaceProp(ctx, a, kind, x, z, rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), {ring: 0.6});
    }
  }
}

/** Conference table on the room's long axis (two end to end in a big boardroom); chairs come in postDress. */
function conferenceTable(_d: OfficeDress, ctx: PlaceCtx, a: Area): void {
  const alongX = a.w >= a.h;
  const rot = alongX ? 0 : Math.PI / 2;
  const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  const len = (alongX ? a.w : a.h) * CELL;
  const two = len >= 11;
  const offs = two ? [-1.5, 1.5] : [0];
  for (const o of offs) {
    for (const j of [0, 0.5, -0.5, 1, -1]) {
      const x = q4(alongX ? cx + o + j : cx), z = q4(alongX ? cz : cz + o + j);
      if (tryPlaceProp(ctx, a, 'conferenceTable', x, z, rot, {ring: two ? 0.4 : 0.9})) break;
    }
  }
}

/** Lobby main hall: the reception desk on the axis between the entrance and the elevators, a waiting area, plants. */
function reception(d: OfficeDress, ctx: PlaceCtx, a: Area): void {
  const rng = ctx.rng;
  const cab = d.frame.cab;
  const tx = (cab.x + MARGIN + cab.w / 2) * CELL + rng.pick([-7, -5, 5, 7]);
  const tz = (a.y + a.h * 0.45) * CELL;
  let desk: PropPlacement | null = null;
  for (const dx of [0, 1, -1, 2, -2, 3, -3]) {
    desk = tryPlaceProp(ctx, a, 'receptionDesk', q4(tx + dx), q4(tz), Math.PI, {ring: 1.2});
    if (desk) break;
  }
  if (desk) {
    // Back counter behind the desk (drawers: a holder), the receptionist's side.
    tryPlaceProp(ctx, a, 'cabinetLow', desk.x, q4(desk.z + 1.9), 0, {front: 0.6});
  }
  // Waiting area (TENANTS: the neutral corporate lobby): two modern lobby sofas facing each other across a gap, lounge armchairs
  // closing the ends, planter trees against the walls (a dead pot plant here and there).
  const side = rng.chance(0.5) ? -1 : 1;
  // The pair of sofas is placed together (all-or-nothing) at the first spot that takes both: the preferred end of the hall first.
  let sx: number | null = null, wz = (a.y + a.h * 0.5) * CELL;
  search: for (const fx of side < 0 ? [0.2, 0.8, 0.3, 0.7, 0.12, 0.88] : [0.8, 0.2, 0.7, 0.3, 0.88, 0.12]) {
    for (const fz of [0.5, 0.42, 0.58, 0.35, 0.65]) for (const dx of [0, 1, -1, 2, -2]) {
      const wx = (a.x + a.w * fx) * CELL, z = (a.y + a.h * fz) * CELL;
      begin(ctx);
      const p0 = tryPlaceProp(ctx, a, 'lobbySofa', q4(wx + dx), q4(z - 1.3), 0, {ring: 0.5});
      const p1 = p0 && tryPlaceProp(ctx, a, 'lobbySofa', q4(wx + dx), q4(z + 1.3), Math.PI, {ring: 0.5});
      if (p0 && p1) { commit(ctx); sx = p0.x; wz = z; break search; }
      rollback(ctx);
    }
  }
  if (sx !== null) for (const s of [-1, 1]) tryPlaceProp(ctx, a, 'loungeArmchair', q4(sx + s * (PROP_DEFS.lobbySofa.w / 2 + 1.1)), q4(wz), s < 0 ? Math.PI / 2 : -Math.PI / 2, {ring: 0.4});
  for (let i = 0, n = rng.int(2, 4); i < n; i++) placeAgainstWall(ctx, a, 'planterTree', {sides: ['S', 'E', 'W'], front: 0.5});
  for (let i = 0, n = rng.int(0, 2); i < n; i++) placeAgainstWall(ctx, a, 'deadPlant', {sides: ['S', 'E', 'W'], front: 0.4});
}

/** Lobby wings / transit concourse: benches, vending, bins, a newsstand kiosk, plants. */
function lobbyWing(_d: OfficeDress, ctx: PlaceCtx, a: Area, role: 'transit' | 'lobby'): void {
  const rng = ctx.rng;
  if (a.w * a.h < 60) return;
  for (let i = 0, n = rng.int(1, 2); i < n; i++) placeAgainstWall(ctx, a, 'vending', {front: 1.0, variant: rng.int(0, 2)});
  if (role === 'transit') {
    for (let i = 0, n = rng.int(1, 3); i < n; i++) placeAgainstWall(ctx, a, 'bench', {sides: ['N'], front: 0.8, variant: i});
    if (rng.chance(0.55) && a.w >= 30) {
      const p = tryPlaceProp(ctx, a, 'stall', q4((a.x + a.w * rng.range(0.3, 0.7)) * CELL), q4((a.y + a.h / 2) * CELL), rng.pick([0, Math.PI]), {front: 1.2, ring: 0.8, variant: rng.int(0, 3)});
      if (p) p.purpose = 'newsstand';
    }
  }
  placeAgainstWall(ctx, a, 'bin', {front: 0.4});
  // TENANTS: planter trees in the wide halls, the small pot plant where the hall is narrow.
  const wide = Math.min(a.w, a.h) * CELL >= 6;
  for (let i = 0, n = rng.int(1, 3); i < n; i++) placeAgainstWall(ctx, a, wide ? 'planterTree' : 'pottedPlantSmall', {front: 0.4});
  if (wide && rng.chance(0.5)) {
    const p = tryPlaceProp(ctx, a, 'lobbySofa', q4((a.x + a.w * rng.range(0.3, 0.7)) * CELL), q4((a.y + a.h / 2) * CELL), rng.pick([0, Math.PI]), {ring: 0.8});
    void p;
  }
}

// ---------------------------------------------------------------------------------------------
// After dress()

const OFFICE_DECOR_ROLES = new Set<OfficeAreaMeta['role']>(['open', 'bay', 'private', 'exec', 'collapsed', 'reception', 'security', 'meeting', 'copy', 'break', 'amenity']);
/** Areas whose fixtures this module lays out (the dresser's sparse room lights there are replaced). */
const GRID_LIT = new Set<OfficeAreaMeta['role']>(['open', 'bay', 'collapsed', 'private', 'exec', 'meeting', 'break', 'corridor', 'reception', 'lobby', 'transit', 'security', 'copy', 'storage', 'amenity']);

export function postDress(d: OfficeDress): void {
  const {layout} = d;
  const g = officeGrid(d);
  for (const i of d.held) g.blocked[i] = 0;
  d.held = [];
  const ctx = makePlaceCtx(layout, d.rng.fork('office-post'), d.level);
  const lv = d.level ? {level: d.level} : {};
  // Lane LAYOUT (item 5): large rooms the room rules left nearly empty get purposeful furniture (before chairs / monitors below).
  fillLargeRooms(d, makePlaceCtx(layout, d.rng.fork('office-fill'), d.level));
  // --- Desk decor: chair pulled up, a monitor on top (host decor, absolute heights: dress() already lifted the storey). ---
  const n0 = layout.props.length;
  for (let pi = 0; pi < n0; pi++) {
    const p = layout.props[pi];
    const a = layout.areas[p.area];
    if (!a || !OFFICE_DECOR_ROLES.has(roleOf(d, a)!) || (p.kind !== 'desk' && p.kind !== 'receptionDesk' && p.kind !== 'conferenceTable')) continue;
    if (layout.props.some(q => q.host === pi)) continue;
    const def = PROP_DEFS[p.kind];
    const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
    const lx = Math.cos(p.rot), lz = -Math.sin(p.rot);
    if (p.kind === 'conferenceTable') {
      // Chairs down both long sides (and sometimes one pushed back).
      const per = Math.max(2, Math.floor(def.w / 0.75));
      for (const sgn of [-1, 1]) for (let i = 0; i < per; i++) {
        if (ctx.rng.chance(0.18)) continue;
        const t = (i + 0.5) / per * def.w - def.w / 2;
        const off = def.d / 2 + 0.28 + (ctx.rng.chance(0.2) ? 0.35 : 0);
        hostDecor(d, p, pi, 'officeChair', p.x + lx * t + fx * off * sgn, p.z + lz * t + fz * off * sgn, sgn > 0 ? p.rot + Math.PI : p.rot, p.y, lv);
      }
      continue;
    }
    if (p.kind === 'desk' && ctx.rng.chance(0.85)) {
      const off = ctx.rng.pick([-0.3, -0.2, 0.25]);
      const m = hostDecor(d, p, pi, 'officeMonitor', p.x + lx * off, p.z + lz * off, p.rot, p.y + p.h, lv);
      if (m) (p.cut ??= []).push({y: p.h, x0: off - 0.3, x1: off + 0.3});
    }
    if (p.kind === 'receptionDesk') hostDecor(d, p, pi, 'officeMonitor', p.x - lx * 0.6 - fx * 0.15, p.z - lz * 0.6 - fz * 0.15, p.rot + Math.PI, p.y + 0.74, lv);
    if (ctx.rng.chance(0.82)) {
      const back = p.kind === 'receptionDesk' ? -1 : 1;
      const off = def.d / 2 + 0.3 + (ctx.rng.chance(0.15) ? 0.45 : 0);
      const spin = ctx.rng.chance(0.25) ? ctx.rng.pick([Math.PI / 2, -Math.PI / 2]) : 0;
      hostDecor(d, p, pi, 'officeChair', p.x + fx * off * back, p.z + fz * off * back, (back > 0 ? p.rot + Math.PI : p.rot) + spin, p.y, lv);
    }
  }
  // --- Lobby: barricade of crates / cartons behind the boarded street entrance. ---
  if (d.entrance) {
    const hall = d.tower.north;
    const z = (MARGIN) * CELL + 1.0;
    for (let tx = d.entrance.x0; tx < d.entrance.x1; tx += 2) {
      const kind: PropKind = ctx.rng.pick(['crate', 'cartonStack', 'crate'] as PropKind[]);
      const p = tryPlaceProp(ctx, hall, kind, q4((tx + MARGIN + 1) * CELL), q4(z + ctx.rng.range(0, 0.5)), ctx.rng.pick([0, Math.PI / 2]), {checkZone: false});
      if (p) p.y += d.base; // placed after dress() lifted the storey: absolute height
    }
  }
  officeLights(d);
  signage(d, ctx);
  companyPost(d, ctx);
  restoreRamps(g);
}

// ---------------------------------------------------------------------------------------------
// Task office-interactions-layout-20261030 (lane LAYOUT, item 5): "the big rooms feel too empty"

/** Rooms at least this big (m2) are checked; below FILL_BELOW furnished share they are filled toward FILL_TARGET. */
export const FILL_MIN_M2 = 40;
export const FILL_BELOW = 0.11;
export const FILL_TARGET = 0.14;
/** Roles whose large rooms get the fill (receptions, executive suites, server rooms, the collapsed office are dressed on purpose). */
const FILL_ROLES = new Set<OfficeAreaMeta['role']>(['open', 'bay', 'storage', 'copy', 'break', 'meeting', 'amenity', 'collapsed']);

/**
 * Furnished floor share of an area: the footprint of its free-standing props (not host decor such as chairs / monitors, not wall
 * mounts), clipped to the area, over its floor area. QA / tests measure "emptiness" with it.
 */
export function furnishedShare(layout: StationLayout, a: Area): number {
  let s = 0;
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  for (const p of layout.props) {
    if (p.area !== a.id || p.host !== undefined || p.mounted) continue;
    const x0 = Math.max(p.x - p.hx, ax0), x1 = Math.min(p.x + p.hx, ax1), z0 = Math.max(p.z - p.hz, az0), z1 = Math.min(p.z + p.hz, az1);
    if (x1 > x0 && z1 > z0) s += (x1 - x0) * (z1 - z0);
  }
  return s / ((ax1 - ax0) * (az1 - az0));
}

/**
 * Large rooms the purpose / company rules left nearly empty get PURPOSEFUL furniture through the placement primitive (door zones,
 * access strips, connectivity): store rooms aisles of shelving, print rooms a collating table / copier / carton stock / board,
 * break rooms a second table and seating, meeting rooms a credenza / whiteboard, open-plan areas work clusters (back-to-back desk
 * pairs, a print point, a whiteboard, a work table), company rooms a second pass of their own recipe's rows. Mostly NON-holder
 * pieces; the holders among them roll the lean 'office-fill' table — the furnishing never inflates the level's loot. Never in front
 * of the windows (the facade strip is held again) or in front of an existing piece's access strip. Runs at the start of postDress:
 * placements are lifted to the storey.
 */
function fillLargeRooms(d: OfficeDress, ctx: PlaceCtx): void {
  const {layout} = d;
  const g = officeGrid(d);
  const hold = perimeterStrip(d);
  for (const i of hold) g.blocked[i] = 1;
  // Access strips (0.7 m) in front of what already stands on this storey: the fill never blocks a drawer / door / counter front.
  for (const p of layout.props) {
    if ((p.level ?? 0) !== d.level || p.host !== undefined || p.mounted) continue;
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot)), hd = fx ? p.hx : p.hz, hw = fx ? p.hz : p.hx;
    const [x0, y0, x1, y1] = cellsOfBox(p.x + fx * (hd + 0.35), p.z + fz * (hd + 0.35), fx ? 0.35 : hw * 0.8, fz ? 0.35 : hw * 0.8);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (g.inBounds(cx, cy)) ctx.keep[g.idx(cx, cy)] = 1;
  }
  const n0 = layout.props.length;
  try {
    for (const [id, m] of d.tower.meta) {
      const a = layout.areas[id];
      if (!a || !FILL_ROLES.has(m.role) || a.w * a.h * CELL * CELL < FILL_MIN_M2 || furnishedShare(layout, a) >= FILL_BELOW) continue;
      const steps = fillSteps(d, ctx, a, m, hold);
      for (let round = 0; round < 3 && furnishedShare(layout, a) < FILL_TARGET; round++) {
        let any = false;
        for (const step of steps) {
          if (furnishedShare(layout, a) >= FILL_TARGET) break;
          if (step()) any = true;
        }
        if (!any) break;
      }
    }
  } finally {
    // (cells a fill piece now stands on stay blocked: the window desks may stand in the strip)
    const under = new Set<number>();
    for (let k = n0; k < layout.props.length; k++) {
      const p = layout.props[k];
      if (p.host !== undefined || p.mounted) continue;
      const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) under.add(g.idx(cx, cy));
    }
    for (const i of hold) if (!under.has(i)) g.blocked[i] = 0;
  }
  // Lifted to the storey; holders among them roll the lean 'office-fill' table (gen/purposes.ts): furnishing never inflates the loot.
  for (let i = n0; i < layout.props.length; i++) {
    const p = layout.props[i];
    if (p.host !== undefined) continue;
    p.y += d.base;
    p.purpose = 'office-fill';
  }
}

/** The fill recipe of a room (each step places one group; true when something was placed). `hold` = the held facade strip. */
function fillSteps(d: OfficeDress, ctx: PlaceCtx, a: Area, m: OfficeAreaMeta, hold: readonly number[]): (() => boolean)[] {
  const facade = new Set(m.facade);
  const inner = (['N', 'S', 'E', 'W'] as Side[]).filter(s => !facade.has(s));
  // (wall pieces once per room — one print point / filing bank / credenza — the repeating steps are the work clusters / islands)
  const wall = (kind: PropKind, front = 0.6) => {
    let done = false;
    return () => !done && (done = !!placeAgainstWall(ctx, a, kind, {sides: inner.length ? inner : undefined, front, tries: 10}));
  };
  const isle = (kind: PropKind, ring = 0.8) => () => !!island(ctx, a, kind, ring);
  const company = d.tower.tenant && m.program && !BASE_ROOMS.has(m.program as RoomKey) && m.program !== 'cubicles' && m.program !== 'pods' && m.program !== 'newsroom';
  const own: (() => boolean)[] = company ? [() => refurnish(d, ctx, a, m) > 0] : [];
  const m2 = a.w * a.h * CELL * CELL;
  // A shallow open bay along the glass (<= 5 m deep): a bench of desks facing the windows (desks stay below the sill).
  const shallow = Math.min(a.w, a.h) <= 10 && !m.commons;
  const windowDesks = () => besideWindows(d, a, hold, () => {
    let n = 0;
    for (const side of m.facade) {
      const [lo, hi] = wallRange(a, side);
      if (hi - lo < 4) continue;
      n += rowAlongWall(ctx, a, side, 'desk', {from: lo + 0.6, to: hi - 0.6, cluster: 2, gap: 1.2, front: 1.0, variant: () => ctx.rng.int(0, 2)}).length;
    }
    return n > 0;
  });
  switch (m.role) {
    case 'storage': return [...own, () => freeRows(ctx, a, 'shelf', ctx.rng.int(3, 6), true, 1.3).length > 0, wall('cartonStack', 0.5), wall('cabinetTall', 0.7)];
    case 'copy': return [...own, isle('table', 0.9), wall('officePhotocopier', 0.9), wall('cartonStack', 0.5), wall('officeWhiteboard', 0.6)];
    case 'break': return [...own, isle('table', 0.9), wall('couch', 0.7), wall('vending', 1.0), wall('officeWaterCooler', 0.6), isle('table', 0.9)];
    // (a second table keeps 2 m clear round it: both tables' chairs pull out into the gap)
    case 'meeting': return [...own, ...(m2 >= 50 || !ctx.layout.props.some(p => p.area === a.id && p.kind === 'conferenceTable') ? [isle('conferenceTable', 2.0)] : []),
      wall('cabinetLow', 0.7), wall('officeWhiteboard', 0.6), wall('officeShelf', 0.6)];
    case 'open': case 'bay': return [...own, ...(shallow ? [windowDesks] : []), () => deskPair(ctx, a), wall('officePhotocopier', 0.9), wall('officeWhiteboard', 0.6),
      () => deskPair(ctx, a), isle('table', 0.9)];
    // The collapsed office: more of its fallen furniture (crates hold finite loot), heaped, never in the door zones.
    case 'collapsed': return [...(shallow ? [windowDesks] : []), ...(['crate', 'cartonStack', 'officeFiling', 'desk', 'crate'] as PropKind[]).map(kind => () => !!scatter(ctx, a, kind, 0.6))];
    default: return [...own, wall('cabinetLow', 0.7), wall('shelf', 0.8), isle('table', 0.9)];
  }
}

/** Runs a fill placement with this room's facade strip released (low pieces by the glass); the cells left free are held again. */
function besideWindows(d: OfficeDress, a: Area, hold: readonly number[], fn: () => boolean): boolean {
  const g = officeGrid(d);
  const mine = hold.filter(i => g.area[i] === a.id);
  for (const i of mine) g.blocked[i] = 0;
  const n0 = d.layout.props.length;
  const ok = fn();
  const under = new Set<number>();
  for (let k = n0; k < d.layout.props.length; k++) {
    const p = d.layout.props[k];
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) under.add(g.idx(cx, cy));
  }
  for (const i of mine) if (!under.has(i)) g.blocked[i] = 1;
  return ok;
}

/** A work cluster: two desks back to back (a 1.5 m pod), with a walkway ring; chairs / monitors come with the desk decor. */
function deskPair(ctx: PlaceCtx, a: Area): boolean {
  const alongX = a.w >= a.h, def = PROP_DEFS.desk;
  for (let t = 0; t < 24; t++) {
    // (cell-aligned: the two desks one cell either side of a cell line, 0.25 m apart, never sharing a grid cell)
    const cx = Math.round(ctx.rng.range(a.x + 4, a.x + a.w - 4)), cy = Math.round(ctx.rng.range(a.y + 4, a.y + a.h - 4));
    const x = alongX ? cx * CELL + def.w / 2 : cx * CELL, z = alongX ? cy * CELL : cy * CELL + def.w / 2;
    const off = CELL;
    const [ax, az, bx, bz] = alongX ? [x, z - off, x, z + off] : [x - off, z, x + off, z];
    const ra = alongX ? Math.PI : -Math.PI / 2, rb = alongX ? 0 : Math.PI / 2;
    // Open floor round the whole pod: 0.9 m at its ends, 1.6 m on both long (sitter) sides where the chairs pull out.
    const hx = alongX ? def.w / 2 + 0.9 : off + def.d / 2 + 1.6, hz = alongX ? off + def.d / 2 + 1.6 : def.w / 2 + 0.9;
    const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
    let open = true;
    for (let cy = y0; cy <= y1 && open; cy++) for (let cx = x0; cx <= x1; cx++) {
      const i = ctx.g.idx(cx, cy);
      if (!ctx.g.walkable(cx, cy) || ctx.g.area[i] !== a.id || ctx.keep[i] || ctx.doorCell[i] || ctx.zone[i]) { open = false; break; }
    }
    if (!open) continue;
    begin(ctx);
    const p = tryPlaceProp(ctx, a, 'desk', ax, az, ra, {variant: ctx.rng.int(0, 2)});
    const q = p && tryPlaceProp(ctx, a, 'desk', bx, bz, rb, {variant: ctx.rng.int(0, 2)});
    if (p && q) {
      commit(ctx);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = ctx.g.idx(cx, cy); if (!ctx.g.blocked[i]) ctx.keep[i] = 1; }
      return true;
    }
    rollback(ctx);
  }
  return false;
}

/** Host decor (chair / monitor / ...) beside or on a host prop: collides, never blocks the walk grid; absolute y. */
export function hostDecor(d: OfficeDress, host: PropPlacement, hostIndex: number, kind: PropKind, x: number, z: number, rot: number, y: number, lv: {level?: number}): PropPlacement | null {
  const q = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
  const {hx, hz} = footprint(kind, q);
  const g = officeGrid(d);
  // Stay on open floor of the host's area (chairs) / on the host's top (monitors).
  if (y <= host.y + 0.01) {
    const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!g.inBounds(cx, cy)) return null;
      const i = g.idx(cx, cy);
      if (g.cells[i] !== FLOOR || (g.blocked[i] && !inBox(host, cx, cy))) return null;
    }
    // TENANTS: a chair never reaches into a doorway's clear volume (company desks / consoles stand closer to doors).
    if (propBlocksDoorway(d.layout, x, z, hx, hz, y, PROP_DEFS[kind].h)) return null;
  }
  const p: PropPlacement = {kind, x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000, y, rot: q, area: host.area, hx, hz, h: PROP_DEFS[kind].h, blocksSight: false, variant: 0, host: hostIndex, ...lv};
  d.layout.props.push(p);
  return p;
}
const inBox = (p: PropPlacement, cx: number, cy: number) => {
  const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
  return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
};

/** Troffer grids in offices / halls / corridors (replacing the dresser's sparse room lights there). */
function officeLights(d: OfficeDress): void {
  const {layout, rng} = d;
  const managed = new Set<number>();
  for (const a of layout.areas) { const r = roleOf(d, a); if (r && GRID_LIT.has(r)) managed.add(a.id); }
  layout.lights = layout.lights.filter(l => !managed.has(l.area));
  for (const id of managed) {
    const a = layout.areas[id];
    const role = roleOf(d, a)!;
    const y = Math.round((a.ceil - 0.02) * 1000) / 1000;
    const ax0 = a.x * CELL, az0 = a.y * CELL, aw = a.w * CELL, ah = a.h * CELL;
    const alongX = aw >= ah;
    const put = (x: number, z: number) => {
      const l: LightPlacement = {x: q4(x), y, z: q4(z), rot: alongX ? 0 : Math.PI / 2, area: id, broken: false, flicker: false, warm: rng.chance(0.08), power: 1, dying: false};
      if (d.level) l.level = d.level;
      layout.lights.push(l);
    };
    if (role === 'corridor') {
      const len = alongX ? aw : ah, n = Math.max(1, Math.round(len / 4.2));
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; put(alongX ? ax0 + aw * t : ax0 + aw / 2, alongX ? az0 + ah / 2 : az0 + ah * t); }
      continue;
    }
    const sx = role === 'lobby' || role === 'reception' || role === 'transit' ? 4.6 : 3.8, sz = role === 'lobby' || role === 'reception' || role === 'transit' ? 4.2 : 3.4;
    const nx = Math.max(1, Math.round((aw - 1.2) / sx)), nz = Math.max(1, Math.round((ah - 1.2) / sz));
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) put(ax0 + aw * (i + 0.5) / nx, az0 + ah * (k + 0.5) / nz);
  }
}

// ---------------------------------------------------------------------------------------------
// Signage

const SUITES = ['ACCOUNTS', 'HUMAN RESOURCES', 'LEGAL', 'CLAIMS', 'PAYROLL', 'UNDERWRITING', 'COMPLIANCE', 'SALES', 'AUDIT', 'PROCUREMENT', 'FACILITIES', 'RECORDS'];

function signage(d: OfficeDress, ctx: PlaceCtx): void {
  const {layout, frame, floor, base} = d;
  const lv = d.level ? {level: d.level} : {};
  const core = d.tower.core;
  const N = d.tower.north;
  const label = floor === 1 ? 'LOBBY' : `FLOOR ${floor}`;
  const put = (a: Area, side: Side, t: number, yRel: number, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>) => wallSign(ctx, layout, a, side, t, base + yRel, {...s, ...lv});
  // TENANTS: door plates and wayfinding of a company floor in its signage style, room names from its program.
  const company = companyOf(d);
  const style = company ? companySignStyle(company) : undefined;
  // Elevator: a floor plate on the shaft pier on the side away from the call panel (lane LIFT owns the door face: indicator +
  // call panel on the other pier); the stairwell doorway gets its exit sign over the lintel.
  const f = frame, stairWest = f.well.x < f.cab.x;
  const doorX0 = (f.door.x + MARGIN) * CELL, doorX1 = (f.door.x + f.door.w + MARGIN) * CELL;
  put(N, 'S', stairWest ? doorX0 - 0.5 : doorX1 + 0.5, 1.6, {kind: 'service', text: floor === 1 ? 'L' : String(floor), w: 0.6});
  const ld = core.landingDoor;
  put(N, 'S', (ld.x + ld.w / 2) * CELL, CEIL.door + 0.25, {kind: 'exit', text: 'STAIRS', w: 1.0});
  // Inside the landing: floor plate + direction plate on the well's end wall, facing the flights.
  const L = core.landing, endW = L.x - MARGIN === f.well.x;
  const z = (L.y + L.h / 2) * CELL;
  put(L, endW ? 'W' : 'E', z - 0.75, 1.6, {kind: 'service', text: label, w: 1.0});
  put(L, endW ? 'W' : 'E', z + 0.75, 1.6, {kind: 'service', text: floor >= 8 ? 'STAIRS · DOWN' : floor <= 1 ? 'STAIRS · UP' : 'STAIRS · UP / DOWN', w: 1.1});
  // Washrooms / rooms: plates beside their doors (corridor side).
  const plates = new Map<OfficeAreaMeta['role'], string>([['meeting', 'MEETING ROOM'], ['break', 'STAFF BREAK ROOM'], ['copy', 'COPY · MAIL'], ['storage', 'SUPPLY STORAGE'],
    ['server', 'SERVER ROOM · AUTHORIZED ONLY'], ['security', 'BUILDING SECURITY'], ['exec', 'EXECUTIVE SUITE']]);
  let suite = 0;
  for (const a of layout.areas) {
    const role = roleOf(d, a);
    if (!role) continue;
    // (lane LAYOUT: support rooms carry their own plate — UTILITY ROOM, PRINT ROOM, KITCHENETTE, IT · COMMS, ROOF ACCESS …)
    let text = d.tower.meta.get(a.id)?.plate ?? plates.get(role);
    if (a.type === 'washroom') text = a.label.startsWith('Men') ? 'MEN' : 'WOMEN';
    if (role === 'private') text = `SUITE ${floor}${String(++suite).padStart(2, '0')}`;
    if (role === 'bay') text = SUITES[(floor * 3 + suite++) % SUITES.length];
    const prog = d.tower.meta.get(a.id)?.program;
    if (company && prog) {
      if (role === 'private') text = prog === 'exam' ? `EXAM ${suite}` : prog === 'partner' ? `${floor}${String(suite).padStart(2, '0')} · COUNSEL` : text;
      else if (role !== 'open' || (prog !== 'cubicles' && prog !== 'pods')) text = roomPlate(company, prog, text ?? a.label.toUpperCase());
    }
    if (!text) continue;
    for (const q of doorsOf(layout, a)) {
      const o = layout.areas[q.a === a.id ? q.b : q.a];
      if (!o || o.id === a.id || roleOf(d, o) === roleOf(d, a)) continue;
      const side = doorSide(q, o);
      const mid = q.h === 1 ? (q.x + q.w / 2) * CELL : (q.y + q.h / 2) * CELL;
      const w = text.length > 14 ? 2.0 : 1.3;
      put(o, side, mid + (q.h === 1 ? q.w : q.h) * CELL / 2 + 0.25 + w / 2, 1.75, {kind: 'service', text, w, ...(style && a.type !== 'washroom' ? {style} : {})});
      break;
    }
  }
  // Lobby: the tower name over the reception side of the hall, transit wayfinding.
  if (floor === 1) {
    const hall = d.tower.north;
    put(hall, 'S', (frame.TW / 2 + MARGIN) * CELL + (frame.cab.x + frame.cab.w / 2 - frame.TW / 2 > 0 ? -6 : 6), 3.2, {kind: 'station', text: frame.name, w: 3.6});
  }
}

/** Wall plate on `area`'s wall `side` at absolute height y, slid to a wall-backed spot (stationDress.wallSign rules). */
export function wallSign(ctx: PlaceCtx, layout: StationLayout, area: Area, side: Side, t: number, y: number, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>): boolean {
  const dims = signDims(s);
  if (y + dims.h / 2 > area.ceil - 0.04) return false;
  const ax0 = area.x * CELL, az0 = area.y * CELL, ax1 = (area.x + area.w) * CELL, az1 = (area.y + area.h) * CELL;
  const posOf = (spot: number) => (side === 'N' ? {x: spot, z: az0 + 0.02, rot: 0} : side === 'S' ? {x: spot, z: az1 - 0.02, rot: Math.PI}
    : side === 'W' ? {x: ax0 + 0.02, z: spot, rot: Math.PI / 2} : {x: ax1 - 0.02, z: spot, rot: -Math.PI / 2});
  // Task office-interactions-layout-20261030 (lane LAYOUT, item 4): never on top of another plate of the same wall — the wanted spot
  // first (unchanged where it is free), else the nearest free wall-backed spot within 3 m along the wall, else no plate.
  const level = s.level ?? 0;
  for (let k = 0; k <= 24; k++) {
    const tc = t + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
    const spot = wallSignSpot(ctx.g, area, side, tc, y, dims);
    if (spot === null) return false;
    if (k > 0 && Math.abs(spot - tc) > 1e-6) continue;
    if (!backed(ctx, area, side, spot - dims.w / 2, spot + dims.w / 2, y - dims.h / 2)) continue;
    const pos = posOf(spot);
    if (signOverlaps(layout, level, pos, y, dims)) continue;
    layout.signs.push({...s, ...pos, y, area: area.id});
    return true;
  }
  return false;
}

/**
 * Lane LAYOUT: whether a plate at `pos` / `y` (`dims`) would overlap a sign already on the same wall face of `level` (same facing,
 * within 0.1 m of the plane; their rects overlap with < 0.05 m between them). QA / tests use it over a whole layout too.
 */
export function signOverlaps(layout: StationLayout, level: number, pos: {x: number; z: number; rot: number}, y: number, dims: {w: number; h: number}, skip?: SignPlacement,
  gap = {w: 0.05, h: 0.02}): boolean {
  const alongX = Math.abs(Math.cos(pos.rot)) > 0.5;
  for (const q of layout.signs) {
    if (q === skip || (q.level ?? 0) !== level) continue;
    if (Math.abs(Math.cos(q.rot) - Math.cos(pos.rot)) > 1e-3 || Math.abs(Math.sin(q.rot) - Math.sin(pos.rot)) > 1e-3) continue;
    if ((alongX ? Math.abs(q.z - pos.z) : Math.abs(q.x - pos.x)) > 0.1) continue;
    const qd = signDims(q);
    const da = alongX ? Math.abs(q.x - pos.x) : Math.abs(q.z - pos.z);
    if (da < (qd.w + dims.w) / 2 + gap.w && Math.abs(q.y - y) < (qd.h + dims.h) / 2 + gap.h) return true;
  }
  return false;
}
