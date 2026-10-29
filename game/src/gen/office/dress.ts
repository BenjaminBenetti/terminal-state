// Iteration 16 (WORLD-GEN): office dressing around the station dresser (gen/stationDress.ts dress()). Pure data.
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

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, type Grid} from '../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../props';
import {signDims, wallSignSpot} from '../doorways';
import {
  backed, cellsOfBox, doorSide, forceProp, makePlaceCtx, placeAgainstWall, rowAlongWall, tryPlaceProp, wallRange, wallSpot, type PlaceCtx,
} from '../placeKit';
import type {Area, Door, LightPlacement, Side, SignPlacement, StationLayout} from '../stationTypes';
import {CEIL, MARGIN, type TowerFrame} from './frame';
import type {CarvedTower, OfficeAreaMeta} from './tower';

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
  /** Perimeter strip cells held blocked during dress(). */
  held: number[];
}

const q4 = (v: number) => Math.round(v * 4) / 4;
const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
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

export function preDress(d: OfficeDress): void {
  const g = officeGrid(d);
  d.held = perimeterStrip(d);
  for (const i of d.held) g.blocked[i] = 1;
  const ctx = makePlaceCtx(d.layout, d.rng.fork('office-pre'), d.level);
  for (const a of d.layout.areas) {
    const role = roleOf(d, a);
    if (role === 'open' || role === 'bay' || role === 'collapsed') cubicleFarm(d, ctx, a, role);
    else if (role === 'meeting') conferenceTable(d, ctx, a);
    else if (role === 'reception') reception(d, ctx, a);
    else if (role === 'transit' || role === 'lobby') lobbyWing(d, ctx, a, role);
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
function cubicleFarm(d: OfficeDress, ctx: PlaceCtx, a: Area, role: 'open' | 'bay' | 'collapsed'): void {
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
    for (const s of segs) {
      const U0 = du + s.u0, U1 = U0 + 5 * s.n, V0 = dv + r.v0;
      const V1 = V0 + (r.kind === 'double' ? 8 : 4);
      if (!box(U0, V0, U1, V1)) continue;
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
  const cab = d.tower.core.cab;
  const tx = (cab.x + cab.w / 2) * CELL + rng.pick([-7, -5, 5, 7]);
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
  // Waiting area: two couches facing each other across a gap, plants at the ends.
  const side = rng.chance(0.5) ? -1 : 1;
  const wx = (a.x + (side < 0 ? a.w * 0.2 : a.w * 0.8)) * CELL, wz = (a.y + a.h * 0.5) * CELL;
  for (const [dz, rot] of [[-1.25, 0], [1.25, Math.PI]] as const) {
    for (const dx of [0, 1, -1, 2, -2]) if (tryPlaceProp(ctx, a, 'couch', q4(wx + dx), q4(wz + dz), rot, {ring: 0.5})) break;
  }
  for (let i = 0, n = rng.int(3, 5); i < n; i++) placeAgainstWall(ctx, a, 'deadPlant', {sides: ['S', 'E', 'W'], front: 0.4});
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
  for (let i = 0, n = rng.int(1, 3); i < n; i++) placeAgainstWall(ctx, a, 'deadPlant', {front: 0.4});
}

// ---------------------------------------------------------------------------------------------
// After dress()

const OFFICE_DECOR_ROLES = new Set<OfficeAreaMeta['role']>(['open', 'bay', 'private', 'exec', 'collapsed', 'reception', 'security', 'meeting', 'copy', 'break']);
/** Areas whose fixtures this module lays out (the dresser's sparse room lights there are replaced). */
const GRID_LIT = new Set<OfficeAreaMeta['role']>(['open', 'bay', 'collapsed', 'private', 'exec', 'meeting', 'break', 'corridor', 'reception', 'lobby', 'transit', 'security', 'copy', 'storage']);

export function postDress(d: OfficeDress): void {
  const {layout} = d;
  const g = officeGrid(d);
  for (const i of d.held) g.blocked[i] = 0;
  d.held = [];
  const ctx = makePlaceCtx(layout, d.rng.fork('office-post'), d.level);
  const lv = d.level ? {level: d.level} : {};
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
      tryPlaceProp(ctx, hall, kind, q4((tx + MARGIN + 1) * CELL), q4(z + ctx.rng.range(0, 0.5)), ctx.rng.pick([0, Math.PI / 2]), {checkZone: false});
    }
  }
  officeLights(d);
  signage(d, ctx);
}

/** Host decor (chair / monitor / ...) beside or on a host prop: collides, never blocks the walk grid; absolute y. */
function hostDecor(d: OfficeDress, host: PropPlacement, hostIndex: number, kind: PropKind, x: number, z: number, rot: number, y: number, lv: {level?: number}): PropPlacement | null {
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
  const put = (a: Area, side: Side, t: number, yRel: number, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>) => wallSign(ctx, layout, a, side, t, base + yRel, {...s, ...lv});
  // Elevator: floor plate beside the door on the lobby / corridor side; the call panel itself is TOWER's.
  const door = core.cabDoor;
  const dx = (door.x + door.w / 2) * CELL;
  put(N, 'S', dx, CEIL.door + 0.3, {kind: 'info', text: `ELEVATOR · FLOORS 1–${8}`, w: 2.2});
  put(N, 'S', dx + 2.6, 1.75, {kind: 'service', text: `FLOOR ${floor}`, w: 1.0});
  // Stairwell door (corridor side) and the floor plate inside the vestibule beside the stair door.
  const vd = core.vestDoor;
  put(N, 'S', (vd.x + vd.w / 2) * CELL, CEIL.door + 0.3, {kind: 'exit', text: 'STAIRS · EXIT', w: 1.4});
  const v = core.vest;
  put(v, 'S', (v.x + v.w / 2) * CELL - 1.15, 1.6, {kind: 'service', text: `FLOOR ${floor}`, w: 0.9});
  put(v, 'S', (v.x + v.w / 2) * CELL + 1.15, 1.6, {kind: 'service', text: floor >= 8 ? 'STAIR B · ROOF CLOSED' : floor <= 1 ? 'STAIR B · UP' : 'STAIR B · UP / DOWN', w: 1.0});
  // Washrooms / rooms: plates beside their doors (corridor side).
  const plates = new Map<OfficeAreaMeta['role'], string>([['meeting', 'MEETING ROOM'], ['break', 'STAFF BREAK ROOM'], ['copy', 'COPY · MAIL'], ['storage', 'SUPPLY STORAGE'],
    ['server', 'SERVER ROOM · AUTHORIZED ONLY'], ['security', 'BUILDING SECURITY'], ['exec', 'EXECUTIVE SUITE']]);
  let suite = 0;
  for (const a of layout.areas) {
    const role = roleOf(d, a);
    if (!role) continue;
    let text = plates.get(role);
    if (a.type === 'washroom') text = a.label.startsWith('Men') ? 'MEN' : 'WOMEN';
    if (role === 'private') text = `SUITE ${floor}${String(++suite).padStart(2, '0')}`;
    if (role === 'bay') text = SUITES[(floor * 3 + suite++) % SUITES.length];
    if (!text) continue;
    for (const q of doorsOf(layout, a)) {
      const o = layout.areas[q.a === a.id ? q.b : q.a];
      if (!o || o.id === a.id || roleOf(d, o) === roleOf(d, a)) continue;
      const side = doorSide(q, o);
      const mid = q.h === 1 ? (q.x + q.w / 2) * CELL : (q.y + q.h / 2) * CELL;
      const w = text.length > 14 ? 2.0 : 1.3;
      put(o, side, mid + (q.h === 1 ? q.w : q.h) * CELL / 2 + 0.25 + w / 2, 1.75, {kind: 'service', text, w});
      break;
    }
  }
  // Lobby: the tower name over the reception side of the hall, transit wayfinding.
  if (floor === 1) {
    const hall = d.tower.north;
    put(hall, 'S', (frame.TW / 2 + MARGIN) * CELL + (core.cab.x + core.cab.w / 2 - frame.TW / 2 - MARGIN > 0 ? -6 : 6), 3.2, {kind: 'station', text: frame.name, w: 3.6});
  }
}

/** Wall plate on `area`'s wall `side` at absolute height y, slid to a wall-backed spot (stationDress.wallSign rules). */
export function wallSign(ctx: PlaceCtx, layout: StationLayout, area: Area, side: Side, t: number, y: number, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>): boolean {
  const dims = signDims(s);
  const spot = wallSignSpot(ctx.g, area, side, t, y, dims);
  if (spot === null) return false;
  if (!backed(ctx, area, side, spot - dims.w / 2, spot + dims.w / 2, y - dims.h / 2)) return false;
  if (y + dims.h / 2 > area.ceil - 0.04) return false;
  const ax0 = area.x * CELL, az0 = area.y * CELL, ax1 = (area.x + area.w) * CELL, az1 = (area.y + area.h) * CELL;
  const pos = side === 'N' ? {x: spot, z: az0 + 0.02, rot: 0} : side === 'S' ? {x: spot, z: az1 - 0.02, rot: Math.PI}
    : side === 'W' ? {x: ax0 + 0.02, z: spot, rot: Math.PI / 2} : {x: ax1 - 0.02, z: spot, rot: -Math.PI / 2};
  layout.signs.push({...s, ...pos, y, area: area.id});
  return true;
}
export {OPP};
export const wallSpotOf = wallSpot;
