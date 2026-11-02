// Task reactor-expansion-20261101 (lane BUNKER): THE BUNKER's dress hook — called by the host once after the crop and the station
// dresser (which already furnished / lit / plated the rooms of the existing purposes: guard post, infirmary, mess, stores, workshop,
// switch room, filtration plant, generator hall; the radio room's side racks), before the populations. World metres, this storey's grid.
//
//  - the BLAST DOOR (REACTOR_X_KIT.blastDoor, bunkerKinds.ts): leaf + frame collision in the lock / decon bulkhead, a steel-lined lane
//    over the raised threshold (tread plates), the heavy hazard-striped frame round the pit-wall entrance, the 'SHELTER 7' plate on the
//    gallery side;
//  - the lock / decontamination room (bench, suit lockers, wash troughs, bins), the DORMITORIES (barracks rows of REACTOR_X_KIT bunks,
//    a footlocker at each foot, locker banks), the MESS tables and folding chairs, the ARMOURY (gun lockers, ammunition cabinets, crates:
//    the dead-end reward), the RADIO CONSOLE, the AIR FILTRATION UNITS;
//  - the GENERATOR HALL: switchboard panels where the cable trench meets the wall, two diesel day tanks on their bund, the hazard-striped
//    skid outline, a second row of fixtures, its plates;
//  - ventilation ducts under the corridor ceilings, door plates in the bunker's own words, wayfinding in the muster corridor.
// Every storage placed opens (footlockers, lockers, cabinets, crates, gun lockers: existing openables / holders, loot by the room's
// purpose); loose things move (folding chairs, extinguishers); anchored plant / bunks / the console / the door are classified
// (bunkerKinds.ts, docs/prop-affordances.md). Machinery boxes / trims are layout.decor (existing shape materials) over collision-only
// 'annexMachine' footprints. Never inside a doorway's clear volume; every area stays connected (placeKit); the generator's skid and
// use point stay clear.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, type Grid} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import type {Area, Door, Side, SignPlacement, StationLayout} from '../../stationTypes';
import type {ShopMat} from '../../storefronts';
import {signDims, wallSignSpot, propBlocksDoorway} from '../../doorways';
import {
  areaConnected, backed, boxClear, cellsOfBox, doorSide, makePlaceCtx, placeAgainstWall, rowAlongWall, tryPlaceProp, wallRange, wallSpot,
  type PlaceCtx,
} from '../../placeKit';
import type {BunkerCarveRec} from './bunker';
import {BLAST} from './bunkerKinds';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
const NORMAL: Record<Side, [number, number]> = {N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0]};
const sideOfDir = (dx: number, dz: number): Side => (Math.abs(dz) >= Math.abs(dx) ? (dz < 0 ? 'N' : 'S') : dx < 0 ? 'W' : 'E');
/** Yaw (prop convention: front = (sin rot, cos rot)) of a prop whose front faces (dx, dz). */
const rotFacing = (dx: number, dz: number): number => (Math.abs(dz) >= Math.abs(dx) ? (dz > 0 ? 0 : Math.PI) : dx > 0 ? Math.PI / 2 : -Math.PI / 2);

/** QA / tests: what the last dress placed. */
export const BUNKER_DRESS_STATS = {ms: 0, props: 0, decor: 0, lights: 0, signs: 0, beds: 0, footlockers: 0, tanks: 0, panels: 0, skipped: [] as string[]};

interface Dx {
  layout: StationLayout;
  rec: BunkerCarveRec;
  g: Grid;
  ctx: PlaceCtx;
  lv: number;
  base: number;
  rng: Rng;
  area(key: string): Area | undefined;
  /** World (x, z) of local continuous (u, v). */
  W(u: number, v: number): [number, number];
  /** World AABB of a local continuous box. */
  box(u0: number, u1: number, v0: number, v1: number): {x0: number; z0: number; x1: number; z1: number};
  decor(m: ShopMat, b: {x0: number; z0: number; x1: number; z1: number}, y0: number, y1: number): void;
  doors(a: Area): Door[];
}

export function dressBunker(layout: StationLayout, rng: Rng, crop: {ox: number; oy: number}, rec: BunkerCarveRec): void {
  const S = BUNKER_DRESS_STATS;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  S.props = S.decor = S.lights = S.signs = S.beds = S.footlockers = S.tanks = S.panels = 0;
  S.skipped = [];
  const lv = rec.level, g = layout.levels[lv]?.grid;
  if (!g) return;
  const f = rec.frame;
  const areas = Object.values(rec.area).map(id => layout.areas[id]).filter(Boolean);
  const win = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
  for (const a of areas) { win.x0 = Math.min(win.x0, a.x - 6); win.y0 = Math.min(win.y0, a.y - 6); win.x1 = Math.max(win.x1, a.x + a.w + 6); win.y1 = Math.max(win.y1, a.y + a.h + 6); }
  const ctx = makePlaceCtx(layout, rng.fork('ctx'), lv, win);
  const p0 = layout.props.length, d0 = layout.decor.length, l0 = layout.lights.length, s0 = layout.signs.length;
  const W = (u: number, v: number): [number, number] => [
    r3((f.origin[0] + u * f.du[0] + v * f.dv[0] - crop.ox) * CELL), r3((f.origin[1] + u * f.du[1] + v * f.dv[1] - crop.oy) * CELL),
  ];
  const D: Dx = {
    layout, rec, g, ctx, lv, base: rec.baseY, rng,
    area: key => (rec.area[key] !== undefined ? layout.areas[rec.area[key]] : undefined),
    W,
    box: (u0, u1, v0, v1) => {
      const [ax, az] = W(u0, v0), [bx, bz] = W(u1, v1);
      return {x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz)};
    },
    decor: (m, b, y0, y1) => { layout.decor.push({m, x0: r3(b.x0), y0: r3(rec.baseY + y0), z0: r3(b.z0), x1: r3(b.x1), y1: r3(rec.baseY + y1), z1: r3(b.z1)}); },
    doors: a => ctx.doorsOf.get(a.id) ?? [],
  };
  // the generator's skid (+ a 1-cell ring) and its use point (+ 2 cells) stay clear of everything placed here
  {
    const fr = f.rect(rec.plan.gen.foot), [ux, uy] = f.cell(rec.plan.gen.use.u, rec.plan.gen.use.v);
    const keep = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.inBounds(x, y)) ctx.keep[g.idx(x, y)] = 1; };
    keep(fr.x - crop.ox - 1, fr.y - crop.oy - 1, fr.x + fr.w - crop.ox, fr.y + fr.h - crop.oy);
    keep(ux - crop.ox - 2, uy - crop.oy - 2, ux - crop.ox + 2, uy - crop.oy + 2);
  }
  // placements made here are authored in the storey's LOCAL height frame (placeKit): lift each step's onto the floor right away (the
  // station dresser's liftLevels already ran), so later 3D checks (boxClear) compare absolute heights
  let lifted = p0;
  const lift = () => {
    for (; lifted < layout.props.length; lifted++) {
      const p = layout.props[lifted];
      if ((p.level ?? 0) !== lv) continue;
      const [cx, cy] = g.cellOf(p.x, p.z), k = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
      p.y = r3(p.y + (k >= 0 && g.cells[k] === FLOOR && g.rampIdx[k] < 0 ? g.floorOf(k) : rec.baseY));
    }
  };
  const step = (name: string, fn: () => void) => { try { fn(); } catch (e) { S.skipped.push(`${name}: ${(e as Error).message}`); } lift(); };
  step('blastDoor', () => blastDoor(D));
  step('entrance', () => entranceFrame(D));
  step('lock', () => lockAndDecon(D));
  for (const key of Object.keys(rec.area)) {
    const a = D.area(key)!;
    const purpose = a.purpose ?? '';
    if (purpose === 'reactor-bunker-dormitory') step(key, () => dormitory(D, a));
    else if (key === 'mess') step(key, () => mess(D, a));
    else if (key === 'armoury') step(key, () => armoury(D, a));
    else if (key === 'radio') step(key, () => radioRoom(D, a));
    else if (key === 'filtration') step(key, () => filtration(D, a));
  }
  step('hall', () => generatorHall(D));
  step('ducts', () => corridorDucts(D));
  step('signs', () => bunkerSigns(D));
  S.props = layout.props.length - p0; S.decor = layout.decor.length - d0; S.lights = layout.lights.length - l0; S.signs = layout.signs.length - s0;
  S.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Placement helpers

/** A collision prop over a world AABB (forced: the bunker's own anchored pieces), blocking its floor cells of `areaIds`. */
function solidProp(D: Dx, kind: PropKind, a: Area, b: {x0: number; z0: number; x1: number; z1: number}, h: number, rot: number, variant: number, sight: boolean): PropPlacement {
  const {g, layout, lv} = D;
  const x = r3((b.x0 + b.x1) / 2), z = r3((b.z0 + b.z1) / 2), hx = r3((b.x1 - b.x0) / 2), hz = r3((b.z1 - b.z0) / 2);
  const [c0, r0, c1, r1] = cellsOfBox(x, z, hx, hz);
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR) continue;
    g.blocked[i] = 1;
    if (sight) g.sightBlocked[i] = 1;
  }
  const p: PropPlacement = {kind, x, z, y: 0, rot, area: a.id, hx, hz, h: r3(h), blocksSight: sight, variant, level: lv};
  layout.props.push(p);
  return p;
}

/** Free floor cells of area `a` under a world AABB (not blocked / kept / in a door zone), and the area stays connected once blocked. */
function freeFor(D: Dx, a: Area, b: {x0: number; z0: number; x1: number; z1: number}): boolean {
  const {g, ctx} = D;
  const [c0, r0, c1, r1] = cellsOfBox((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2);
  const cells: number[] = [];
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    if (!g.inBounds(cx, cy)) return false;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || ctx.keep[i] || ctx.zone[i] || ctx.edge[i]) return false;
    cells.push(i);
  }
  for (const i of cells) g.blocked[i] = 1;
  const ok = areaConnected(ctx, a);
  for (const i of cells) g.blocked[i] = 0;
  return ok;
}

/** World-space wall face coordinate of a side of an area, and the along-wall world range. */
function face(a: Area, s: Side): number {
  return s === 'N' ? a.y * CELL : s === 'S' ? (a.y + a.h) * CELL : s === 'W' ? a.x * CELL : (a.x + a.w) * CELL;
}
/** World AABB of a box against wall `s` of `a`: along [t0, t1], `off0`..`off1` m out from the wall face. */
function wallBox(a: Area, s: Side, t0: number, t1: number, off0: number, off1: number): {x0: number; z0: number; x1: number; z1: number} {
  const fc = face(a, s), [nx, nz] = NORMAL[s];
  if (s === 'N' || s === 'S') { const z0 = fc - nz * off0, z1 = fc - nz * off1; return {x0: t0, x1: t1, z0: Math.min(z0, z1), z1: Math.max(z0, z1)}; }
  const x0 = fc - nx * off0, x1 = fc - nx * off1;
  return {x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: t0, z1: t1};
}

/** The side of `a` holding most of its doors / the main (parent) door. */
function mainSide(D: Dx, a: Area): Side | null {
  const ds = D.doors(a);
  const d = ds.find(q => q.a === a.parent || q.b === a.parent) ?? ds[0];
  return d ? doorSide(d, a) : null;
}
const doorCount = (D: Dx, a: Area, s: Side) => D.doors(a).filter(d => doorSide(d, a) === s).length;

/**
 * Deterministic exhaustive wall placement: every 0.25 m along each wall of `sides` (in order), nearest `prefer` (world, along the wall)
 * first; the placement primitive's checks (door zones, access strip, connectivity, real wall behind) decide. Null when nothing fits.
 */
function scanWall(D: Dx, a: Area, kind: PropKind, sides: readonly Side[], front: number, prefer?: number): PropPlacement | null {
  const w = PROP_DEFS[kind].w;
  for (const sd of sides) {
    const [lo, hi] = wallRange(a, sd);
    const ts: number[] = [];
    for (let t = lo + w / 2 + 0.1; t <= hi - w / 2 - 0.1 + 1e-6; t += 0.25) ts.push(Math.round(t * 4) / 4);
    const c = prefer ?? (lo + hi) / 2;
    ts.sort((p, q) => Math.abs(p - c) - Math.abs(q - c));
    for (const t of ts) {
      const sp = wallSpot(a, sd, t, kind);
      const p = tryPlaceProp(D.ctx, a, kind, sp.x, sp.z, sp.rot, {front});
      if (p) return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The blast door (bulkhead between the lock and the decontamination room) and the pit-wall entrance

function blastDoor(D: Dx): void {
  const lock = D.area('lock'), decon = D.area('decon');
  if (!lock || !decon) return;
  const {uf, vo, xs, facing, uo} = D.rec.plan.blast;
  // facing the lock: the frame's front (+z, the open leaf) toward the lock; facing the decon: a half turn
  const yaw = facing > 0 ? D.rec.frame.modelYaw : Math.atan2(-Math.sin(D.rec.frame.modelYaw), -Math.cos(D.rec.frame.modelYaw));
  const front = facing > 0 ? lock : decon, back = facing > 0 ? decon : lock;
  /** Local box of a model-space box (x along xs * u, z along -facing * v). */
  const mbox = (x0: number, x1: number, z0: number, z1: number) => D.box(uf + xs * x0 / CELL, uf + xs * x1 / CELL, vo - facing * z0 / CELL, vo - facing * z1 / CELL);
  const zc = (BLAST.bodyZ[0] + BLAST.bodyZ[1]) / 2, half = D.rec.plan.dims.BW / 2 * CELL;
  const frontFace = zc + half, backFace = zc - half;
  const lx0 = BLAST.openX - BLAST.laneHalf, lx1 = BLAST.openX + BLAST.laneHalf;
  const hFront = Math.min(BLAST.bodyH, front.ceil - D.base) - 0.05, hBack = Math.min(BLAST.bodyH, back.ceil - D.base) - 0.05;
  // variant 0: the open round leaf (+ the frame foot on its side) - the render anchor (world/reactor/bunkerModels.ts)
  solidProp(D, 'blastDoor', front, mbox(BLAST.leaf.x[0], BLAST.leaf.x[1], BLAST.leaf.z[0], BLAST.leaf.z[1]), BLAST.leaf.h, yaw, 0, true);
  // variant 1: the frame's protrusions / feet beside the lane on both faces of the bulkhead
  solidProp(D, 'blastDoor', front, mbox(-BLAST.halfW, lx0, frontFace, BLAST.frontFeetZ), hFront, 0, 1, true);
  solidProp(D, 'blastDoor', front, mbox(lx1, BLAST.halfW, frontFace, BLAST.frontFeetZ), hFront, 0, 1, true);
  solidProp(D, 'blastDoor', back, mbox(-BLAST.halfW, lx0, BLAST.backPlinthZ, backFace), hBack, 0, 1, true);
  solidProp(D, 'blastDoor', back, mbox(lx1, BLAST.halfW, BLAST.backPlinthZ, backFace), hBack, 0, 1, true);
  // the lane through the bulkhead: steel lining on both jambs (above the threshold), tread plates on the risers
  const {LD, BW} = D.rec.plan.dims;
  const sill = BLAST.sill, top = sill + 2.26;
  D.decor('shopFrame', D.box(uo, uo + 0.04, LD, LD + BW), sill, top);
  D.decor('shopFrame', D.box(uo + 2.96, uo + 3, LD, LD + BW), sill, top);
  for (const [v, n] of D.rec.plan.blast.steps) {
    const y = r3(n * sill / 3);
    D.decor('steelDark', D.box(uo, uo + 3, v, v + 1), y, y + 0.012);
  }
  // amber nosing on the first riser each side (the threshold reads from both rooms)
  D.decor('plasticSeat', D.box(uo, uo + 3, LD - 2, LD - 1.9), r3(sill / 3) - 0.005, r3(sill / 3) + 0.014);
  D.decor('plasticSeat', D.box(uo, uo + 3, LD + BW + 1.9, LD + BW + 2), r3(sill / 3) - 0.005, r3(sill / 3) + 0.014);
}

/** The heavy hazard-striped steel frame round the pit-wall entrance (both faces), the plate over it on the gallery side. */
function entranceFrame(D: Dx): void {
  const lock = D.area('lock');
  if (!lock) return;
  const {e0, e1} = D.rec.frame;
  const door = D.layout.doors.find(d => d.b === lock.id && d.a === D.rec.frontArea);
  const h = door?.height ?? 3.0;
  const J = 0.7, T = 0.24; // jamb width / depth (cells): 0.35 m x 0.12 m
  for (const [v0, v1, sv] of [[-1 - T, -1, -1], [0, T, 1]] as const) {
    D.decor('steelDark', D.box(e0 - J, e0, v0, v1), 0, h + 0.45);
    D.decor('steelDark', D.box(e1, e1 + J, v0, v1), 0, h + 0.45);
    D.decor('steelDark', D.box(e0 - J, e1 + J, v0, v1), h, h + 0.45);
    // hazard bands on the jamb faces (amber / black, 0.25 m)
    const fv0 = sv > 0 ? v1 : v0 - 0.02, fv1 = sv > 0 ? v1 + 0.02 : v0;
    for (let k = 0; k < 8; k++) {
      const y = 0.1 + k * 0.25;
      for (const [a0, a1] of [[e0 - J, e0], [e1, e1 + J]]) D.decor(k % 2 ? 'black' : 'plasticSeat', D.box(a0, a1, fv0, fv1), y, y + 0.25);
    }
  }
}

/** The lock (bench, notice board, extinguisher by the entrance) and the decontamination room (wash troughs, suit lockers, bench). */
function lockAndDecon(D: Dx): void {
  const lock = D.area('lock'), decon = D.area('decon');
  const front = sideOfDir(-D.rec.frame.dv[0], -D.rec.frame.dv[1]);
  if (lock) {
    placeAgainstWall(D.ctx, lock, 'bench', {sides: [front], front: 0.6, tries: 16});
    placeAgainstWall(D.ctx, lock, 'noticeBoard', {sides: [front], y: 1.1, tries: 12});
    placeAgainstWall(D.ctx, lock, 'fireExtinguisher', {sides: [front], front: 0.5, tries: 12});
  }
  if (decon) {
    const back = OPP[front];
    const sides: Side[] = front === 'N' || front === 'S' ? ['W', 'E'] : ['N', 'S'];
    placeAgainstWall(D.ctx, decon, 'washCounter', {sides: [back, ...sides], front: 0.7, tries: 20});
    placeAgainstWall(D.ctx, decon, 'washCounter', {sides: [back, ...sides], front: 0.7, tries: 12});
    for (const sd of D.rng.shuffle(sides.slice())) if (rowAlongWall(D.ctx, decon, sd, 'staffLockers', {front: 1.0, max: 3}).length) break;
    placeAgainstWall(D.ctx, decon, 'bench', {sides, front: 0.6, tries: 12});
    placeAgainstWall(D.ctx, decon, 'bin', {sides: [back, ...sides], tries: 12});
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rooms

/** Barracks rows: bunks head to the long walls, a footlocker at each foot, a bank of lockers on a short wall. */
function dormitory(D: Dx, a: Area): void {
  const S = BUNKER_DRESS_STATS;
  const horiz = a.w >= a.h;
  const longs: Side[] = horiz ? ['N', 'S'] : ['W', 'E'];
  const depth = (horiz ? a.h : a.w) * CELL;
  const bed = PROP_DEFS.bunkBed, fl = PROP_DEFS.footlocker;
  const rowDepth = 0.04 + bed.w + 0.06 + fl.d;
  const walls = depth >= 2 * rowDepth + 1.3 ? longs : [longs.slice().sort((p, q) => doorCount(D, a, p) - doorCount(D, a, q))[0]];
  for (const sd of walls) {
    const [lo, hi] = wallRange(a, sd), [nx, nz] = NORMAL[sd], fc = face(a, sd);
    const along = sd === 'N' || sd === 'S';
    const bedRot = along ? Math.PI / 2 : 0;
    const flRot = rotFacing(-nx, -nz);
    const pitch = bed.d + D.rng.range(0.55, 0.7);
    for (let t = lo + 0.3 + bed.d / 2; t + bed.d / 2 <= hi - 0.3; t += pitch) {
      const off = 0.04 + bed.w / 2, foff = 0.04 + bed.w + 0.06 + fl.d / 2;
      const bx = along ? t : fc - nx * off, bz = along ? fc - nz * off : t;
      const p = tryPlaceProp(D.ctx, a, 'bunkBed', bx, bz, bedRot);
      if (!p) continue;
      S.beds++;
      if (!D.rng.chance(0.8)) continue;
      const fx = along ? t : fc - nx * foff, fz = along ? fc - nz * foff : t;
      if (tryPlaceProp(D.ctx, a, 'footlocker', fx, fz, flRot)) S.footlockers++;
    }
  }
  // lockers on the short wall with fewer doors, a tall cabinet somewhere
  const shorts: Side[] = horiz ? ['W', 'E'] : ['N', 'S'];
  const sw = shorts.sort((p, q) => doorCount(D, a, p) - doorCount(D, a, q));
  if (!rowAlongWall(D.ctx, a, sw[0], 'staffLockers', {front: 1.0, max: 4}).length) rowAlongWall(D.ctx, a, sw[1], 'staffLockers', {front: 1.0, max: 3});
  if (D.rng.chance(0.6)) placeAgainstWall(D.ctx, a, 'cabinetTall', {front: 0.8, tries: 16});
}

/** Mess tables in rows with folding chairs (the station dresser already put the kitchenette, fridge, a table, notice board …). */
function mess(D: Dx, a: Area): void {
  const tbl = PROP_DEFS.table, ch = PROP_DEFS.foldingChair;
  const horiz = a.w >= a.h;
  const ax0 = a.x * CELL, az0 = a.y * CELL, aw = a.w * CELL, ah = a.h * CELL;
  const stepL = 3.0, stepC = 3.2;
  const nL = Math.max(1, Math.floor(((horiz ? aw : ah) - 2.4) / stepL) + 1), nC = Math.max(1, Math.floor(((horiz ? ah : aw) - 2.6) / stepC) + 1);
  let n = 0;
  for (let i = 0; i < nL && n < 6; i++) for (let k = 0; k < nC && n < 6; k++) {
    const l = ((horiz ? aw : ah) - (nL - 1) * stepL) / 2 + i * stepL, c = ((horiz ? ah : aw) - (nC - 1) * stepC) / 2 + k * stepC;
    const x = Math.round((ax0 + (horiz ? l : c)) * 4) / 4, z = Math.round((az0 + (horiz ? c : l)) * 4) / 4;
    const rot = horiz ? Math.PI / 2 : 0; // the table's long side (d 1.6) along the room's long axis
    const t = tryPlaceProp(D.ctx, a, 'table', x, z, rot);
    if (!t) continue;
    n++;
    // folding chairs at the long sides, facing the table
    for (const sgn of [-1, 1]) {
      const off = tbl.w / 2 + ch.d / 2 + 0.05;
      const cx = horiz ? x : x + sgn * off, cz = horiz ? z + sgn * off : z;
      for (const sl of [-0.35, 0.35]) {
        if (!D.rng.chance(0.75)) continue;
        tryPlaceProp(D.ctx, a, 'foldingChair', horiz ? cx + sl : cx, horiz ? cz : cz + sl, horiz ? rotFacing(0, -sgn) : rotFacing(-sgn, 0), {laneOk: true});
      }
    }
  }
}

/** The dead-end ARMOURY: gun lockers along the far wall, ammunition cabinets, crates, a bench. */
function armoury(D: Dx, a: Area): void {
  const ms = mainSide(D, a) ?? 'S';
  const far = OPP[ms];
  const sides: Side[] = ms === 'N' || ms === 'S' ? ['W', 'E'] : ['N', 'S'];
  if (rowAlongWall(D.ctx, a, far, 'gunLocker', {front: 0.8, max: 3}).length < 2) placeAgainstWall(D.ctx, a, 'gunLocker', {sides, front: 0.8, tries: 16});
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'cabinetTall', {sides, front: 0.8, tries: 16});
  for (let i = 0; i < 3; i++) placeAgainstWall(D.ctx, a, 'crate', {sides: [far, ...sides], tries: 16});
  if (D.rng.chance(0.6)) {
    const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    tryPlaceProp(D.ctx, a, 'bench', Math.round(cx * 4) / 4, Math.round(cz * 4) / 4, a.w >= a.h ? 0 : Math.PI / 2, {ring: 0.8});
  }
}

/** The radio operator's console (REACTOR_X_KIT.radioConsole) against a free wall, its chair. */
function radioRoom(D: Dx, a: Area): void {
  const ms = mainSide(D, a) ?? 'S';
  const order: Side[] = [OPP[ms], ...(ms === 'N' || ms === 'S' ? ['W', 'E'] as Side[] : ['N', 'S'] as Side[]), ms];
  let p = scanWall(D, a, 'radioConsole', order, 0.9);
  // every wall taken (the dresser's signal racks): a free-standing console island facing the door, a walkway all round
  if (!p) {
    const [fx0, fz0] = NORMAL[ms], cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    for (const o of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const alongX = ms === 'N' || ms === 'S';
      p = tryPlaceProp(D.ctx, a, 'radioConsole', Math.round((cx + (alongX ? o : 0)) * 4) / 4, Math.round((cz + (alongX ? 0 : o)) * 4) / 4, rotFacing(fx0, fz0), {ring: 0.7});
      if (p) break;
    }
  }
  if (p) {
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
    const off = PROP_DEFS.radioConsole.d / 2 + 0.45;
    tryPlaceProp(D.ctx, a, 'officeSwivelChair', p.x + fx * off, p.z + fz * off, rotFacing(-fx, -fz), {laneOk: true});
    // the log / codebook filing cabinet (openable storage)
    scanWall(D, a, 'filingCabinet', order.slice(1), 0.8);
    return;
  }
  BUNKER_DRESS_STATS.skipped.push('radioConsole: no wall');
}

/** Air filtration units (REACTOR_X_KIT.airFilter) against the walls, a ceiling duct along the room. */
function filtration(D: Dx, a: Area): void {
  const ms = mainSide(D, a) ?? 'S';
  const far = OPP[ms];
  const sides: Side[] = ms === 'N' || ms === 'S' ? ['W', 'E'] : ['N', 'S'];
  let n = 0;
  for (const sd of [far, ...sides]) {
    if (n >= 2) break;
    if (scanWall(D, a, 'airFilterUnit', [sd], 1.0)) n++;
  }
  if (!n) BUNKER_DRESS_STATS.skipped.push('airFilterUnit: no wall');
  ceilingDuct(D, a, far, 0.62);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The generator hall

function generatorHall(D: Dx): void {
  const hall = D.area('hall');
  if (!hall) return;
  const S = BUNKER_DRESS_STATS;
  const {plan, frame: f} = D.rec;
  const ft = plan.gen.foot, end = plan.gen.end;
  const uEnd = end === 'hi' ? ft.u + ft.w : ft.u;
  const vMid = ft.v + ft.h / 2;
  // the switchboard wall: the hall wall beyond the skid's panel end (local +-u)
  const sgn = end === 'hi' ? 1 : -1;
  const sbSide = sideOfDir(sgn * f.du[0], sgn * f.du[1]);
  const uWall = end === 'hi' ? plan.dims.uE + plan.dims.SW : plan.dims.uW; // the hall's wall line in that direction
  // cable trench: a grated channel from the skid's panel end to the switchboard wall (floor finish, 0.6 m wide)
  {
    const a0 = Math.min(uEnd, uWall), a1 = Math.max(uEnd, uWall);
    D.decor('grille', D.box(a0, a1, vMid - 0.6, vMid + 0.6), 0, 0.014);
    D.decor('steelDark', D.box(a0, a1, vMid - 0.7, vMid - 0.6), 0, 0.018);
    D.decor('steelDark', D.box(a0, a1, vMid + 0.6, vMid + 0.7), 0, 0.018);
  }
  // hazard outline round the skid (0.6 m out), amber
  {
    const m = 1.2, w = 0.2;
    const u0 = ft.u - m, u1 = ft.u + ft.w + m, v0 = ft.v - m, v1 = ft.v + ft.h + m;
    for (const b of [D.box(u0, u1, v0, v0 + w), D.box(u0, u1, v1 - w, v1), D.box(u0, u0 + w, v0, v1), D.box(u1 - w, u1, v0, v1)]) D.decor('plasticSeat', b, 0, 0.008);
  }
  // the switchboard: a row of panels on that wall, centred on the trench
  {
    const [tx, tz] = D.W(uWall, vMid);
    const t = sbSide === 'N' || sbSide === 'S' ? tx : tz;
    let n = rowAlongWall(D.ctx, hall, sbSide, 'electricalPanel', {from: t - 3.4, to: t + 3.4, front: 1.0, max: 4}).length;
    for (const sd of [sbSide, sideOfDir(f.dv[0], f.dv[1])]) while (n < 2 && scanWall(D, hall, 'electricalPanel', [sd], 1.0, t)) n++;
    S.panels = n;
  }
  // two diesel day tanks on their bund against the back wall (local +v), clear of the skid
  {
    const back = sideOfDir(f.dv[0], f.dv[1]);
    const [lo, hi] = wallRange(hall, back);
    const [gx, gz] = D.W(ft.u + ft.w / 2, vMid);
    const tc = back === 'N' || back === 'S' ? gx : gz;
    for (const off of D.rng.shuffle([-4.2, 4.2, -7.0, 7.0])) {
      if (S.tanks >= 2) break;
      const t = tc + off;
      if (t - 1.45 < lo + 0.4 || t + 1.45 > hi - 0.4) continue;
      const b = wallBox(hall, back, t - 1.45, t + 1.45, 0.05, 1.35);
      if (!freeFor(D, hall, b) || propBlocksDoorway(D.layout, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, D.base, 1.8)) continue;
      dayTank(D, hall, back, t);
      S.tanks++;
    }
  }
  // a second row of fixtures (the dresser hung one down the middle)
  {
    const own = D.layout.lights.filter(l => l.area === hall.id);
    const [ax, az] = D.W(ft.u + ft.w / 2, ft.v + ft.h / 2);
    const [bx, bz] = D.W(ft.u + ft.w / 2, plan.dims.vH + 3);
    const dx = bx - ax, dz = bz - az;
    const rel = hall.ceil - D.base, y = r3(D.base + (rel > 4.65 ? 4.5 : rel - 0.02));
    for (const l of own.slice(0, 3)) {
      const nl = {...l, x: r3(l.x + dx), z: r3(l.z + dz), y, level: D.lv};
      if (D.g.area[D.g.idx(...D.g.cellOf(nl.x, nl.z))] !== hall.id) continue;
      if (D.layout.lights.some(q => q.area === hall.id && Math.hypot(q.x - nl.x, q.z - nl.z) < 2)) continue;
      D.layout.lights.push(nl);
    }
  }
}

/** A diesel day tank: a painted steel tank on saddles inside a low spill bund, fill neck and gauge; collision-only footprint. */
function dayTank(D: Dx, a: Area, side: Side, t: number): void {
  const b = wallBox(a, side, t - 1.45, t + 1.45, 0.05, 1.35);
  solidProp(D, 'annexMachine', a, b, 1.6, 0, 0, false);
  const inner = wallBox(a, side, t - 1.2, t + 1.2, 0.2, 1.2);
  // bund curb (0.18 m) and its floor
  D.decor('shopFrame', {x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1}, 0, 0.03);
  for (const e of [wallBox(a, side, t - 1.45, t + 1.45, 0.05, 0.13), wallBox(a, side, t - 1.45, t + 1.45, 1.27, 1.35), wallBox(a, side, t - 1.45, t - 1.37, 0.05, 1.35), wallBox(a, side, t + 1.37, t + 1.45, 0.05, 1.35)]) D.decor('steelDark', e, 0, 0.18);
  // saddles and the tank body, an amber 'DIESEL' band, the fill neck / vent and a sight gauge
  for (const s of [t - 0.8, t + 0.8]) D.decor('black', wallBox(a, side, s - 0.08, s + 0.08, 0.25, 1.15), 0.03, 0.3);
  D.decor('steelDark', inner, 0.3, 1.45);
  D.decor('plasticSeat', wallBox(a, side, t - 1.21, t + 1.21, 0.19, 1.21), 0.95, 1.08);
  D.decor('kitchenSteel', wallBox(a, side, t + 0.6, t + 0.75, 0.6, 0.75), 1.45, 1.6);
  D.decor('kitchenSteel', wallBox(a, side, t - 0.75, t - 0.65, 0.55, 0.65), 1.45, 1.58);
  D.decor('black', wallBox(a, side, t - 0.15, t + 0.15, 1.2, 1.215), 0.45, 1.3);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ducts, plates, wayfinding

/** A rectangular ventilation duct under the ceiling along wall `side` of `a` (segments skip props / doorway volumes). */
function ceilingDuct(D: Dx, a: Area, side: Side, w = 0.45): void {
  const rel = a.ceil - D.base;
  const y1 = rel - 0.08, y0 = y1 - 0.34;
  if (y0 < 2.5) return;
  const [lo, hi] = wallRange(a, side);
  for (let t = lo + 0.1; t < hi - 0.1; t += 2) {
    const t1 = Math.min(hi - 0.1, t + 2);
    const b = wallBox(a, side, t, t1, 0.06, 0.06 + w);
    if (!boxClear(D.ctx, b.x0, b.x1, D.base + y0, D.base + y1, b.z0, b.z1)) continue;
    D.decor('steelBright', b, y0, y1);
    // a hanger strap every segment
    D.decor('steelDark', wallBox(a, side, t + 0.9, t + 0.95, 0.04, 0.08 + w), y1, rel);
  }
}

function corridorDucts(D: Dx): void {
  const f = D.rec.frame;
  const muster = D.area('muster');
  if (muster) ceilingDuct(D, muster, sideOfDir(-f.dv[0], -f.dv[1]));
  for (const key of ['spineW', 'spineE']) {
    const a = D.area(key);
    if (a) ceilingDuct(D, a, sideOfDir((key === 'spineW' ? -1 : 1) * f.du[0], (key === 'spineW' ? -1 : 1) * f.du[1]));
  }
}

/** A wall sign on `side` of `area` near `t` (world along the wall), `yRel` above the floor (centre); false when no backed spot. */
function wallSign(D: Dx, area: Area, side: Side, t: number, yRel: number, s: Pick<SignPlacement, 'kind' | 'text'> & Partial<Pick<SignPlacement, 'w' | 'arrow'>>): boolean {
  const y = r3(D.base + yRel), dims = signDims(s);
  const spot = wallSignSpot(D.g, area, side, t, y, dims);
  if (spot === null || !backed(D.ctx, area, side, spot - dims.w / 2, spot + dims.w / 2, y - dims.h / 2)) return false;
  const ax0 = area.x * CELL, az0 = area.y * CELL, ax1 = (area.x + area.w) * CELL, az1 = (area.y + area.h) * CELL;
  const pos = side === 'N' ? {x: spot, z: az0 + 0.02, rot: 0} : side === 'S' ? {x: spot, z: az1 - 0.02, rot: Math.PI}
    : side === 'W' ? {x: ax0 + 0.02, z: spot, rot: Math.PI / 2} : {x: ax1 - 0.02, z: spot, rot: -Math.PI / 2};
  D.layout.signs.push({...s, x: r3(pos.x), y, z: r3(pos.z), rot: pos.rot, area: area.id, level: D.lv});
  return true;
}

/** A plate on `outside`'s side of door `d`: over the opening when there is a soffit, else beside it. */
function doorPlate(D: Dx, d: Door, outside: Area, text: string, w = 1.4): boolean {
  const side = doorSide(d, outside);
  const mid = d.h === 1 || (d.w > 1 && (side === 'N' || side === 'S')) ? (d.x + d.w / 2) * CELL : (d.y + d.h / 2) * CELL;
  const rel = outside.ceil - D.base;
  if (rel - d.height >= 0.5) return wallSign(D, outside, side, mid, Math.min(d.height + 0.32, rel - 0.24), {kind: 'service', text, w});
  const span = (side === 'N' || side === 'S' ? d.w : d.h) * CELL;
  return wallSign(D, outside, side, mid + span / 2 + 0.2 + w / 2, 1.9, {kind: 'service', text, w});
}

/** The bunker's plates: in its own words (the station dresser's stock plates near its doors are re-lettered), wayfinding. */
const PLATE: Readonly<Record<string, string>> = {
  guard: 'GUARD POST', decon: 'DECONTAMINATION', mess: 'MESS HALL', dorm: 'DORMITORY A', dorm2: 'DORMITORY B', infirmary: 'INFIRMARY',
  radio: 'RADIO ROOM', filtration: 'AIR FILTRATION', washroom: 'LATRINES', stores: 'SHELTER STORES', workshop: 'WORKSHOP',
  warden: 'WARDEN', rations: 'RATION STORE', lockers: 'LOCKER ROOM', switch: 'SWITCH ROOM · DANGER', armoury: 'ARMOURY · AUTHORISED ONLY',
  hall: 'AUX GENERATOR 1 · DANGER',
};

function bunkerSigns(D: Dx): void {
  const {layout, rec} = D;
  const f = rec.frame;
  // re-letter the dresser's purpose plates beside each room's main door (TRANSIT SECURITY -> GUARD POST, SIGNAL RELAY ROOM -> RADIO …)
  const mine = new Set(Object.values(rec.area));
  for (const [key, id] of Object.entries(rec.area)) {
    const text = PLATE[key];
    if (!text) continue;
    const a = layout.areas[id];
    const d = D.doors(a).find(q => q.a === a.parent || q.b === a.parent);
    if (!d) continue;
    const outside = layout.areas[d.a === a.id ? d.b : d.a];
    const cx = (d.x + d.w / 2) * CELL, cz = (d.y + d.h / 2) * CELL;
    const rotOf: Record<Side, number> = {N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2};
    const wallRot = rotOf[doorSide(d, outside)];
    const near = layout.signs.filter(sg => sg.area === outside.id && sg.kind === 'service' && mine.has(sg.area) && Math.abs(sg.rot - wallRot) < 1e-3
      && Math.hypot(sg.x - cx, sg.z - cz) < 2.6 && !/AUTHORI[SZ]ED PERSONNEL/.test(sg.text));
    if (near.length) { for (const sg of near) { sg.text = text; sg.w = Math.max(sg.w ?? 1.2, 1.4); } continue; }
    doorPlate(D, d, outside, text, text.length > 14 ? 2.0 : 1.4);
  }
  // the gallery-side plate over the entrance frame
  {
    const front = layout.areas[rec.frontArea], lock = D.area('lock');
    const door = lock ? layout.doors.find(d => d.b === lock.id && d.a === rec.frontArea) : undefined;
    if (front && door) {
      const side = sideOfDir(f.dv[0], f.dv[1]);
      const [x, z] = D.W((f.e0 + f.e1) / 2, -1);
      wallSign(D, front, side, side === 'N' || side === 'S' ? x : z, door.height + 0.85, {kind: 'service', text: 'SHELTER 7 · CIVIL DEFENCE', w: 2.6});
    }
  }
  // inside the lock: over the blast door's lane
  {
    const lock = D.area('lock');
    const {uo} = rec.plan.blast;
    if (lock) {
      const side = sideOfDir(f.dv[0], f.dv[1]);
      const [x, z] = D.W(uo + 1.5, rec.plan.dims.LD);
      wallSign(D, lock, side, side === 'N' || side === 'S' ? x : z, Math.min(lock.ceil - D.base - 0.35, 3.55), {kind: 'info', text: 'DECONTAMINATION · SHELTER 7', w: 2.4});
    }
  }
  // the muster corridor: the way to the generator hall (both spines lead there) on the wall facing the decontamination door, the arrow
  // toward the nearer spine mouth (for a reader facing the wall, i.e. looking along +v: right = (-fwd.z, fwd.x))
  {
    const muster = D.area('muster'), decon = D.area('decon');
    const d = muster && decon ? D.doors(muster).find(q => q.a === decon.id || q.b === decon.id) : undefined;
    if (muster && d) {
      const side = sideOfDir(f.dv[0], f.dv[1]);
      const cx = (d.x + d.w / 2) * CELL, cz = (d.y + d.h / 2) * CELL;
      const {uW, uE, SW, vS} = rec.plan.dims;
      const mouths = [D.W(uW + SW / 2, vS), D.W(uE + SW / 2, vS)];
      const m = mouths.reduce((p, q) => (Math.hypot(q[0] - cx, q[1] - cz) < Math.hypot(p[0] - cx, p[1] - cz) ? q : p));
      const right = [-f.dv[1], f.dv[0]];
      const arrow = (m[0] - cx) * right[0] + (m[1] - cz) * right[1] > 0 ? 'right' : 'left';
      wallSign(D, muster, side, side === 'N' || side === 'S' ? cx : cz, 2.25, {kind: 'info', text: 'GENERATOR HALL', w: 1.9, arrow});
    }
  }
}
