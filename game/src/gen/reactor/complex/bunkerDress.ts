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
//  - ventilation ducts under the corridor ceilings, door plates in the bunker's own words, 'GENERATOR HALL' wayfinding in every
//    corridor on the way there.
// (task reactor-playtest-round2-20261102, lane BUNKER: the rooms come from the SEEDED room graph of ./bunkerPlan.ts — the hall lies
// along local u or v, any corridor may carry the route; nothing here assumes the old fixed band / spine plan.)
// Every storage placed opens (footlockers, lockers, cabinets, crates, gun lockers: existing openables / holders, loot by the room's
// purpose); loose things move (folding chairs, extinguishers); anchored plant / bunks / the console / the door are classified
// (bunkerKinds.ts, docs/prop-affordances.md). Machinery boxes / trims are layout.decor (existing shape materials) over collision-only
// 'annexMachine' footprints. Never inside a doorway's clear volume; every area stays connected (placeKit); the generator's skid and
// use point stay clear.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, STEP_UP, type Grid} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import type {Area, Door, Side, SignPlacement, StationLayout} from '../../stationTypes';
import type {ShopMat} from '../../storefronts';
import {signDims, wallSignSpot, propBlocksDoorway} from '../../doorways';
import {
  areaConnected, backed, boxClear, cellsOfBox, doorSide, makePlaceCtx, placeAgainstWall, rowAlongWall, tryPlaceProp, wallRange, wallSpot,
  type PlaceCtx,
} from '../../placeKit';
import type {BunkerCarveRec} from './bunker';
import {BLAST, isBunkerKind} from './bunkerKinds';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
const NORMAL: Record<Side, [number, number]> = {N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0]};
const sideOfDir = (dx: number, dz: number): Side => (Math.abs(dz) >= Math.abs(dx) ? (dz < 0 ? 'N' : 'S') : dx < 0 ? 'W' : 'E');
/** Yaw (prop convention: front = (sin rot, cos rot)) of a prop whose front faces (dx, dz). */
const rotFacing = (dx: number, dz: number): number => (Math.abs(dz) >= Math.abs(dx) ? (dz > 0 ? 0 : Math.PI) : dx > 0 ? Math.PI / 2 : -Math.PI / 2);

/** QA / tests: what the last dress placed. */
export const BUNKER_DRESS_STATS = {ms: 0, dropped: 0, filled: 0, props: 0, decor: 0, lights: 0, signs: 0, beds: 0, footlockers: 0, tanks: 0, panels: 0, skipped: [] as string[]};

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
  /** Cells the host holds clear while this hook runs (blocked now, free floor afterwards): never a pocket wall. */
  held: Set<number>;
}

export function dressBunker(layout: StationLayout, rng: Rng, crop: {ox: number; oy: number}, rec: BunkerCarveRec): void {
  const S = BUNKER_DRESS_STATS;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  S.props = S.decor = S.lights = S.signs = S.beds = S.footlockers = S.tanks = S.panels = S.dropped = S.filled = 0;
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
    held: new Set<number>(),
  };
  // the host's holds (entrance apron, use point …): blocked cells of the bunker's window that no prop covers
  {
    const covered = new Set<number>();
    for (const p of layout.props) {
      if ((p.level ?? 0) !== lv || p.x < (win.x0 - 2) * CELL || p.x > (win.x1 + 2) * CELL || p.z < (win.y0 - 2) * CELL || p.z > (win.y1 + 2) * CELL) continue;
      const [c0, r0, c1, r1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) if (g.inBounds(cx, cy)) covered.add(g.idx(cx, cy));
    }
    for (let y = Math.max(0, win.y0); y <= Math.min(g.h - 1, win.y1); y++) for (let x = Math.max(0, win.x0); x <= Math.min(g.w - 1, win.x1); x++) {
      const i = g.idx(x, y);
      if (g.cells[i] === FLOOR && g.blocked[i] && !covered.has(i)) D.held.add(i);
    }
  }
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
  // the guarantee: no floor pocket anywhere in the bunker (a prop of this pass that closes one off goes again)
  sweepPockets(D, areas, p0);
  S.props = layout.props.length - p0; S.decor = layout.decor.length - d0; S.lights = layout.lights.length - l0; S.signs = layout.signs.length - s0;
  S.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Placement helpers

/**
 * Cells a footprint covers by more than 5 mm (placeKit's cellsOfBox forgives 4 cm at each edge): a hero model's visible body never
 * stands over a walkable cell (user rule: collision matches the visible geometry; lane PATHS' audit).
 */
function coverCells(x: number, z: number, hx: number, hz: number): [number, number, number, number] {
  const e = 0.005;
  return [Math.floor((x - hx + e) / CELL), Math.floor((z - hz + e) / CELL), Math.floor((x + hx - e) / CELL), Math.floor((z + hz - e) / CELL)];
}

/**
 * After a placement of a hero model kind: block the extra cells its footprint covers (coverCells); undone (prop removed) when one of
 * them is not this area's free floor or the area would split. `p` must be the last prop pushed.
 */
function sealOrDrop(D: Dx, a: Area, p: PropPlacement): boolean {
  const {g, ctx, layout} = D;
  const [c0, r0, c1, r1] = coverCells(p.x, p.z, p.hx, p.hz);
  const extra: number[] = [];
  let ok = true;
  for (let cy = r0; cy <= r1 && ok; cy++) for (let cx = c0; cx <= c1; cx++) {
    const i = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
    if (i >= 0 && g.blocked[i]) continue;
    if (i < 0 || g.cells[i] !== FLOOR || g.area[i] !== a.id || ctx.doorCell[i] || ctx.zone[i] || ctx.keep[i] || ctx.edge[i]) { ok = false; break; }
    extra.push(i);
  }
  if (ok) {
    for (const i of extra) { g.blocked[i] = 1; if (p.blocksSight) g.sightBlocked[i] = 1; }
    if (areaConnected(ctx, a)) return true;
    for (const i of extra) { g.blocked[i] = 0; g.sightBlocked[i] = 0; }
  }
  // drop it: its own cells (placed on free cells) back to free floor
  const [b0, s0, b1, s1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
  for (let cy = s0; cy <= s1; cy++) for (let cx = b0; cx <= b1; cx++) if (g.inBounds(cx, cy)) { const i = g.idx(cx, cy); g.blocked[i] = 0; g.sightBlocked[i] = 0; }
  if (layout.props[layout.props.length - 1] === p) layout.props.pop();
  return false;
}

/** A collision prop over a world AABB (forced: the bunker's own anchored pieces), blocking its floor cells of `areaIds`. */
function solidProp(D: Dx, kind: PropKind, a: Area, b: {x0: number; z0: number; x1: number; z1: number}, h: number, rot: number, variant: number, sight: boolean): PropPlacement {
  const {g, layout, lv} = D;
  const x = r3((b.x0 + b.x1) / 2), z = r3((b.z0 + b.z1) / 2), hx = r3((b.x1 - b.x0) / 2), hz = r3((b.z1 - b.z0) / 2);
  const [c0, r0, c1, r1] = coverCells(x, z, hx, hz);
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
function scanWall(D: Dx, a: Area, kind: PropKind, sides: readonly Side[], front: number, prefer?: number, pockets = false): PropPlacement | null {
  const w = PROP_DEFS[kind].w;
  for (const sd of sides) {
    const [lo, hi] = wallRange(a, sd);
    const ts: number[] = [];
    for (let t = lo + w / 2 + 0.1; t <= hi - w / 2 - 0.1 + 1e-6; t += 0.25) ts.push(Math.round(t * 4) / 4);
    const c = prefer ?? (lo + hi) / 2;
    ts.sort((p, q) => Math.abs(p - c) - Math.abs(q - c));
    for (const t of ts) {
      const sp = wallSpot(a, sd, t, kind);
      const n0 = D.layout.props.length;
      const p = tryPlaceProp(D.ctx, a, kind, sp.x, sp.z, sp.rot, {front});
      if (!p || (isBunkerKind(kind) && !sealOrDrop(D, a, p))) continue;
      if (pockets && pocketCells(D, a).length) { dropProps(D, n0); continue; }
      return p;
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
  D.decor('plasticSeat', D.box(uo, uo + 3, LD - 3, LD - 2.9), r3(sill / 3) - 0.005, r3(sill / 3) + 0.014);
  D.decor('plasticSeat', D.box(uo, uo + 3, LD + BW + 2.9, LD + BW + 3), r3(sill / 3) - 0.005, r3(sill / 3) + 0.014);
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
  // (placeKit's areaConnected scans one cell round an area: the decon owns the 2-cell-deep bulkhead lane, so its count is off —
  // every placement here is re-checked with the bunker's own height-aware pocket test and taken back when it closes one off)
  const safe = (a: Area, put: () => unknown): void => {
    const n0 = D.layout.props.length;
    put();
    if (D.layout.props.length > n0 && pocketCells(D, a).length) dropProps(D, n0);
  };
  if (lock) {
    safe(lock, () => placeAgainstWall(D.ctx, lock, 'bench', {sides: [front], front: 0.6, tries: 16}));
    safe(lock, () => placeAgainstWall(D.ctx, lock, 'noticeBoard', {sides: [front], y: 1.1, tries: 12}));
    safe(lock, () => placeAgainstWall(D.ctx, lock, 'fireExtinguisher', {sides: [front], front: 0.5, tries: 12}));
  }
  if (decon) {
    const back = OPP[front];
    const sides: Side[] = front === 'N' || front === 'S' ? ['W', 'E'] : ['N', 'S'];
    for (let i = 0; i < 2; i++) safe(decon, () => scanWall(D, decon, 'washCounter', [back, ...sides], 0.7, undefined, true));
    for (let i = 0; i < 3; i++) safe(decon, () => scanWall(D, decon, 'staffLockers', sides, 1.0, undefined, true));
    safe(decon, () => scanWall(D, decon, 'bench', sides, 0.6, undefined, true));
    safe(decon, () => scanWall(D, decon, 'bin', [back, ...sides], 0, undefined, true));
  }
}

/**
 * Free floor cells of area `a` no walker reaches (height-aware: a step <= STEP_UP), searched from every opening of the area — over
 * the area's rect + 3 cells (its deep doorway cells: the bulkhead lane belongs to the decon).
 */
function pocketCells(D: Dx, a: Area): number[] {
  const {g} = D;
  const doors = D.doors(a);
  const x0 = a.x - 3, y0 = a.y - 3, x1 = a.x + a.w + 2, y1 = a.y + a.h + 2;
  const inWin = (x: number, y: number) => x >= x0 && y >= y0 && x <= x1 && y <= y1 && g.inBounds(x, y);
  const free = (i: number) => g.cells[i] === FLOOR && (!g.blocked[i] || D.held.has(i));
  const seen = new Set<number>(), q: number[] = [];
  // seeds: the door cells (any area) and their free neighbours
  for (const d of doors) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) {
    const i = g.idx(x, y);
    if (free(i) && !seen.has(i)) { seen.add(i); q.push(i); }
  }
  while (q.length) {
    const i = q.pop()!, x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (!inWin(nx, ny)) continue;
      const j = g.idx(nx, ny);
      if (seen.has(j) || !free(j) || Math.abs(g.floor[j] - g.floor[i]) > STEP_UP + 1e-6) continue;
      const aj = g.area[j];
      if (aj !== a.id && !doors.some(d => nx >= d.x && ny >= d.y && nx < d.x + d.w && ny < d.y + d.h)) continue;
      seen.add(j); q.push(j);
    }
  }
  const out: number[] = [];
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const i = g.idx(x, y);
    if (g.area[i] === a.id && free(i) && !seen.has(i)) out.push(i);
  }
  return out;
}

/** Takes back every prop from index `n0` (their floor cells back to free floor). */
function dropProps(D: Dx, n0: number): void {
  const {g, layout} = D;
  while (layout.props.length > n0) {
    const p = layout.props.pop()!;
    unblockProp(g, p);
    BUNKER_DRESS_STATS.dropped++;
  }
}
function unblockProp(g: Grid, p: PropPlacement): void {
  if (p.mounted || p.kind === 'noticeBoard') return;
  const [c0, r0, c1, r1] = isBunkerKind(p.kind) ? coverCells(p.x, p.z, p.hx, p.hz) : cellsOfBox(p.x, p.z, p.hx, p.hz);
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) if (g.inBounds(cx, cy)) { const i = g.idx(cx, cy); g.blocked[i] = 0; g.sightBlocked[i] = 0; }
}

/**
 * The guarantee after the whole pass: a pocket left in any bunker area loses the latest removable prop of this pass bordering it
 * (never the blast door's anchored parts) until none is left; a pocket with no such prop (none expected) is filled (blocked).
 */
function sweepPockets(D: Dx, areas: readonly Area[], p0: number): void {
  const {g, layout} = D;
  for (const a of areas) {
    for (let guard = 0; guard < 24; guard++) {
      const pocket = pocketCells(D, a);
      if (!pocket.length) break;
      const near = new Set<number>();
      for (const i of pocket) { const x = i % g.w, y = (i / g.w) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near.add(g.idx(x + dx, y + dy)); }
      let k = -1;
      for (let i = layout.props.length - 1; i >= p0 && k < 0; i--) {
        const p = layout.props[i];
        if ((p.level ?? 0) !== D.lv || p.kind === 'blastDoor' || p.mounted || p.kind === 'noticeBoard') continue;
        const [c0, r0, c1, r1] = coverCells(p.x, p.z, p.hx, p.hz);
        for (let cy = r0; cy <= r1 && k < 0; cy++) for (let cx = c0; cx <= c1; cx++) if (near.has(g.idx(cx, cy))) { k = i; break; }
      }
      if (k < 0) { for (const i of pocket) if (!D.held.has(i)) g.blocked[i] = 1; BUNKER_DRESS_STATS.filled += pocket.length; break; }
      unblockProp(g, layout.props[k]);
      layout.props.splice(k, 1);
      BUNKER_DRESS_STATS.dropped++;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rooms

/** Barracks rows: bunks head to the long walls, a footlocker at each foot, a bank of lockers on a short wall. */
function dormitory(D: Dx, a: Area): void {
  const S = BUNKER_DRESS_STATS;
  const horiz = a.w >= a.h;
  const byDoors = (p: Side, q: Side) => doorCount(D, a, p) - doorCount(D, a, q);
  const longs: Side[] = (horiz ? ['N', 'S'] as Side[] : ['W', 'E'] as Side[]).sort(byDoors);
  const shorts: Side[] = (horiz ? ['W', 'E'] as Side[] : ['N', 'S'] as Side[]).sort(byDoors);
  const depth = (horiz ? a.h : a.w) * CELL;
  const bed = PROP_DEFS.bunkBed, fl = PROP_DEFS.footlocker;
  const rowDepth = bed.w + 0.05 + fl.d;
  // both long walls carry a footlocker row when the room leaves an aisle between them, else the one with fewer doors
  const twoRows = depth >= 2 * rowDepth + 1.3;
  const walls = twoRows ? longs : [longs[0]];
  // first the lockers, on the short wall with fewer doors, clear of the bunk rows' corners (task reactor-playtest-round2-20261102: in a
  // one-row room too — the lockers once took the row's first bunk spot)
  const midOf = (sd: Side): {from?: number; to?: number} => {
    const [lo, hi] = wallRange(a, sd);
    if (twoRows) return {from: lo + rowDepth + 0.05, to: hi - rowDepth - 0.05};
    return longs[0] === 'N' || longs[0] === 'W' ? {from: lo + rowDepth + 0.05} : {to: hi - rowDepth - 0.05};
  };
  if (!rowAlongWall(D.ctx, a, shorts[0], 'staffLockers', {front: 1.0, max: 4, ...midOf(shorts[0])}).length && !rowAlongWall(D.ctx, a, shorts[1], 'staffLockers', {front: 1.0, max: 3, ...midOf(shorts[1])}).length) {
    // both short walls busy (doors, bunk ends): any free wall spot, the long walls too
    for (let i = 0; i < 2; i++) if (!scanWall(D, a, 'staffLockers', [...shorts, ...longs], 1.0)) break;
  }
  let beds = 0, lockers = 0;
  /**
   * A bunk row against wall `sd`: bunks on the cell grid — head against the wall (2.0 m = 4 cells), centres on cell boundaries (0.85 m
   * bunk = 2 cells) at least 1.5 m apart, so each covers whole cells only (its collision is its visible body) — trying EVERY boundary
   * along the wall (a door zone or a locker costs one spot, not the rest of the row), seeded scan direction; a footlocker in the next
   * cell at a bunk's foot (`withLockers`; the first two of the room always).
   */
  const row = (sd: Side, withLockers: boolean): void => {
    const [lo, hi] = wallRange(a, sd), [nx, nz] = NORMAL[sd], fc = face(a, sd);
    const along = sd === 'N' || sd === 'S';
    const bedRot = along ? Math.PI / 2 : 0, flRot = rotFacing(-nx, -nz);
    const off = bed.w / 2, foff = bed.w + 0.05 + fl.d / 2;
    const ts: number[] = [];
    for (let t = Math.ceil((lo + 0.3 + bed.d / 2) / CELL) * CELL; t + bed.d / 2 <= hi - 0.3 + 1e-6; t += CELL) ts.push(r3(t));
    if (D.rng.chance(0.5)) ts.reverse();
    let last = -Infinity;
    for (const t of ts) {
      if (Math.abs(t - last) < 1.5 - 1e-6) continue;
      const bx = along ? t : fc - nx * off, bz = along ? fc - nz * off : t;
      const p = tryPlaceProp(D.ctx, a, 'bunkBed', bx, bz, bedRot);
      if (!p || !sealOrDrop(D, a, p)) continue;
      last = t;
      beds++; S.beds++;
      if (!withLockers || (lockers >= 2 && !D.rng.chance(0.8))) continue;
      const fx = along ? t : fc - nx * foff, fz = along ? fc - nz * foff : t;
      if (tryPlaceProp(D.ctx, a, 'footlocker', fx, fz, flRot)) { lockers++; S.footlockers++; }
    }
  };
  for (const sd of walls) row(sd, true);
  // a narrow room or doors in the way (task reactor-playtest-round2-20261102: every dormitory sleeps >= 4): the other long wall (the
  // bunks' feet across a ~1 m aisle, no footlockers there), then the short walls
  if (beds < 4 && !twoRows) row(longs[1], false);
  for (const sd of shorts) if (beds < 4) row(sd, false);
  if (beds < 4) S.skipped.push(`dormitory ${a.label}: ${beds} bunks`);
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
  const rot = horiz ? Math.PI / 2 : 0; // the table's long side (d 1.6) along the room's long axis
  const put = (x: number, z: number): boolean => {
    const t = tryPlaceProp(D.ctx, a, 'table', x, z, rot);
    if (!t) return false;
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
    return true;
  };
  for (let i = 0; i < nL && n < 6; i++) for (let k = 0; k < nC && n < 6; k++) {
    const l = ((horiz ? aw : ah) - (nL - 1) * stepL) / 2 + i * stepL, c = ((horiz ? ah : aw) - (nC - 1) * stepC) / 2 + k * stepC;
    put(Math.round((ax0 + (horiz ? l : c)) * 4) / 4, Math.round((az0 + (horiz ? c : l)) * 4) / 4);
  }
  // (task reactor-playtest-round2-20261102: a seeded mess hall may be a through room with several doors and the dresser's stock on
  // its walls) fewer than three tables on the even grid: a 0.5 m lattice, nearest the room's centre first
  if (n < 3) {
    const spots: [number, number][] = [];
    for (let x = ax0 + 1.75; x <= ax0 + aw - 1.75 + 1e-6; x += 0.5) for (let z = az0 + 1.75; z <= az0 + ah - 1.75 + 1e-6; z += 0.5) spots.push([r3(x), r3(z)]);
    const mx = ax0 + aw / 2, mz = az0 + ah / 2;
    spots.sort((p, q) => Math.hypot(p[0] - mx, p[1] - mz) - Math.hypot(q[0] - mx, q[1] - mz) || p[0] - q[0] || p[1] - q[1]);
    for (const [x, z] of spots) { if (n >= 3) break; put(x, z); }
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
  // every wall taken (the dresser's signal racks, doors): a free-standing console island facing the door, a walkway all round
  if (!p) p = island(D, a, 'radioConsole', ms, 0.7);
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
  for (const sd of [far, ...sides, ms]) {
    if (n >= 2) break;
    if (scanWall(D, a, 'airFilterUnit', [sd], 1.0)) n++;
  }
  // (task reactor-playtest-round2-20261102) every wall taken by the dresser's plant stock / doors: one unit free-standing on its skid
  if (!n && island(D, a, 'airFilterUnit', ms, 0.7)) n++;
  if (!n) BUNKER_DRESS_STATS.skipped.push('airFilterUnit: no wall');
  ceilingDuct(D, a, far, 0.62);
}

/**
 * (task reactor-playtest-round2-20261102, lane BUNKER) A hero piece free-standing in room `a`, its front toward wall `face`, a
 * walkway `ring` all round: the whole room on a 0.25 m lattice, nearest its centre first (the seeded rooms' doors / the dresser's
 * stock may hold every wall spot).
 */
function island(D: Dx, a: Area, kind: PropKind, face: Side, ring: number): PropPlacement | null {
  const [fx, fz] = NORMAL[face], cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  const spots: [number, number][] = [];
  for (let x = a.x * CELL + 1.2; x <= (a.x + a.w) * CELL - 1.2 + 1e-6; x += 0.25) for (let z = a.y * CELL + 1.2; z <= (a.y + a.h) * CELL - 1.2 + 1e-6; z += 0.25) spots.push([r3(x), r3(z)]);
  spots.sort((s, t) => Math.hypot(s[0] - cx, s[1] - cz) - Math.hypot(t[0] - cx, t[1] - cz) || s[0] - t[0] || s[1] - t[1]);
  for (const [x, z] of spots) {
    const p = tryPlaceProp(D.ctx, a, kind, x, z, rotFacing(fx, fz), {ring});
    if (p && sealOrDrop(D, a, p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The generator hall

function generatorHall(D: Dx): void {
  const hall = D.area('hall'), H = D.rec.plan.rooms.find(r => r.key === 'hall')?.r;
  if (!hall || !H) return;
  const S = BUNKER_DRESS_STATS;
  const {plan, frame: f} = D.rec;
  // (task reactor-playtest-round2-20261102, lane BUNKER: the seeded hall lies along local u or v — everything here works in the
  // skid's along / across frame; LA maps it back to local (u, v))
  const ft = plan.gen.foot, end = plan.gen.end, axU = plan.gen.axis === 'u';
  const LA = (al: number, ac: number): [number, number] => (axU ? [al, ac] : [ac, al]);
  const boxLA = (a0: number, a1: number, c0: number, c1: number) => { const [u0, v0] = LA(a0, c0), [u1, v1] = LA(a1, c1); return D.box(u0, u1, v0, v1); };
  const fa0 = axU ? ft.u : ft.v, faL = axU ? ft.w : ft.h, fc0 = axU ? ft.v : ft.u, fcL = axU ? ft.h : ft.w;
  const ha0 = axU ? H.u : H.v, haL = axU ? H.w : H.h, hc0 = axU ? H.v : H.u;
  const dirA = axU ? f.du : f.dv, dirC = axU ? f.dv : f.du;
  const aEnd = end === 'hi' ? fa0 + faL : fa0;
  const cMid = fc0 + fcL / 2;
  // the switchboard wall: the hall wall beyond the skid's panel end
  const sgn = end === 'hi' ? 1 : -1;
  const sbSide = sideOfDir(sgn * dirA[0], sgn * dirA[1]);
  const aWall = end === 'hi' ? ha0 + haL : ha0; // the hall's wall line in that direction
  // cable trench: a grated channel from the skid's panel end to the switchboard wall (floor finish, 0.6 m wide)
  {
    const a0 = Math.min(aEnd, aWall), a1 = Math.max(aEnd, aWall);
    D.decor('grille', boxLA(a0, a1, cMid - 0.6, cMid + 0.6), 0, 0.014);
    D.decor('steelDark', boxLA(a0, a1, cMid - 0.7, cMid - 0.6), 0, 0.018);
    D.decor('steelDark', boxLA(a0, a1, cMid + 0.6, cMid + 0.7), 0, 0.018);
  }
  // hazard outline round the skid (0.6 m out), amber
  {
    const m = 1.2, w = 0.2;
    const a0 = fa0 - m, a1 = fa0 + faL + m, c0 = fc0 - m, c1 = fc0 + fcL + m;
    for (const b of [boxLA(a0, a1, c0, c0 + w), boxLA(a0, a1, c1 - w, c1), boxLA(a0, a0 + w, c0, c1), boxLA(a1 - w, a1, c0, c1)]) D.decor('plasticSeat', b, 0, 0.008);
  }
  // the switchboard: a row of panels on that wall, centred on the trench
  {
    const [tx, tz] = D.W(...LA(aWall, cMid));
    const t = sbSide === 'N' || sbSide === 'S' ? tx : tz;
    let n = rowAlongWall(D.ctx, hall, sbSide, 'electricalPanel', {from: t - 3.4, to: t + 3.4, front: 1.0, max: 4}).length;
    for (const sd of [sbSide, sideOfDir(dirC[0], dirC[1]), sideOfDir(-dirC[0], -dirC[1])]) while (n < 2 && scanWall(D, hall, 'electricalPanel', [sd], 1.0, t)) n++;
    S.panels = n;
  }
  // two diesel day tanks on their bund against a long wall (the one with fewer doors first; then the other, then the short wall facing
  // the switchboard), clear of the skid: every 0.25 m along the wall, nearest ~4.2 m off the skid's centre first (the seeded halls
  // are narrower / shorter than the old fixed one: the station dresser's stock may hold any fixed spot)
  {
    const longs = [sideOfDir(dirC[0], dirC[1]), sideOfDir(-dirC[0], -dirC[1])].sort((p, q) => doorCount(D, hall, p) - doorCount(D, hall, q));
    const [gx, gz] = D.W(...LA(fa0 + faL / 2, cMid));
    // the 2.9 m tanks first; a hall ringed by doors / stock takes compact 2.0 m ones
    for (const hl of [1.45, 1.0]) for (const back of [...longs, OPP[sbSide], sbSide]) {
      if (S.tanks >= 2 || (hl < 1.45 && S.tanks >= 1)) break;
      const [lo, hi] = wallRange(hall, back);
      const tc = back === 'N' || back === 'S' ? gx : gz;
      const ts: number[] = [];
      for (let t = lo + hl + 0.4; t <= hi - hl - 0.4 + 1e-6; t += 0.25) ts.push(r3(t));
      ts.sort((p, q) => Math.abs(Math.abs(p - tc) - 4.2) - Math.abs(Math.abs(q - tc) - 4.2) || p - q);
      for (const t of ts) {
        if (S.tanks >= 2) break;
        const b = wallBox(hall, back, t - hl, t + hl, 0.05, 1.35);
        if (!freeFor(D, hall, b) || propBlocksDoorway(D.layout, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, D.base, 1.8)) continue;
        dayTank(D, hall, back, t, hl);
        S.tanks++;
      }
    }
  }
  // a second row of fixtures (the dresser hung one down the middle)
  {
    const own = D.layout.lights.filter(l => l.area === hall.id);
    const [ax, az] = D.W(...LA(fa0 + faL / 2, cMid));
    const [bx, bz] = D.W(...LA(fa0 + faL / 2, hc0 + 3));
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
function dayTank(D: Dx, a: Area, side: Side, t: number, hl = 1.45): void {
  // `hl`: the bund's half length (1.45 m: the 2.9 m tank; 1.0 m: the compact one) — every part scales off its ends
  const b = wallBox(a, side, t - hl, t + hl, 0.05, 1.35);
  solidProp(D, 'annexMachine', a, b, 1.6, 0, 0, false);
  const inner = wallBox(a, side, t - hl + 0.25, t + hl - 0.25, 0.2, 1.2);
  // bund curb (0.18 m) and its floor
  D.decor('shopFrame', {x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1}, 0, 0.03);
  for (const e of [wallBox(a, side, t - hl, t + hl, 0.05, 0.13), wallBox(a, side, t - hl, t + hl, 1.27, 1.35), wallBox(a, side, t - hl, t - hl + 0.08, 0.05, 1.35), wallBox(a, side, t + hl - 0.08, t + hl, 0.05, 1.35)]) D.decor('steelDark', e, 0, 0.18);
  // saddles and the tank body, an amber 'DIESEL' band, the fill neck / vent and a sight gauge
  for (const s of [t - hl + 0.65, t + hl - 0.65]) D.decor('black', wallBox(a, side, s - 0.08, s + 0.08, 0.25, 1.15), 0.03, 0.3);
  D.decor('steelDark', inner, 0.3, 1.45);
  D.decor('plasticSeat', wallBox(a, side, t - hl + 0.24, t + hl - 0.24, 0.19, 1.21), 0.95, 1.08);
  D.decor('kitchenSteel', wallBox(a, side, t + hl - 0.85, t + hl - 0.7, 0.6, 0.75), 1.45, 1.6);
  D.decor('kitchenSteel', wallBox(a, side, t - hl + 0.7, t - hl + 0.8, 0.55, 0.65), 1.45, 1.58);
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

/** A duct along one long wall of every corridor (the one with fewer doors; task reactor-playtest-round2-20261102: the seeded corridors). */
function corridorDucts(D: Dx): void {
  for (const p of D.rec.plan.rooms) {
    if (p.role !== 'corridor') continue;
    const a = D.area(p.key);
    if (!a) continue;
    const longs: Side[] = a.w >= a.h ? ['N', 'S'] : ['W', 'E'];
    longs.sort((s, t) => doorCount(D, a, s) - doorCount(D, a, t));
    ceilingDuct(D, a, longs[0]);
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
  wayfinding(D);
}

/**
 * (task reactor-playtest-round2-20261102, lane BUNKER) The way to the generator hall through the SEEDED room graph: the shortest door
 * path from the decontamination room to the hall; in every corridor on it a 'GENERATOR HALL' plate on the wall facing the door you
 * came in by, its arrow toward the door you leave by (for a reader facing the wall: right = (-fwd.z, fwd.x)).
 */
function wayfinding(D: Dx): void {
  const {layout, rec} = D;
  const start = rec.area.decon, goal = rec.area.hall;
  if (start === undefined || goal === undefined) return;
  const mine = new Set(Object.values(rec.area));
  const prev = new Map<number, Door | null>([[start, null]]), q = [start];
  for (let h = 0; h < q.length && !prev.has(goal); h++) {
    for (const d of D.doors(layout.areas[q[h]])) {
      const o = d.a === q[h] ? d.b : d.a;
      if (!mine.has(o) || prev.has(o) || o === rec.area.lock) continue;
      prev.set(o, d);
      q.push(o);
    }
  }
  if (!prev.has(goal)) return;
  const path: {area: number; via: Door}[] = [];
  for (let x = goal; prev.get(x);) { const d = prev.get(x)!; path.unshift({area: x, via: d}); x = d.a === x ? d.b : d.a; }
  const corridors = new Set(rec.plan.rooms.filter(p => p.role === 'corridor').map(p => rec.area[p.key]));
  for (let i = 0; i + 1 < path.length; i++) {
    const a = layout.areas[path[i].area];
    if (!corridors.has(a.id)) continue;
    const din = path[i].via, dout = path[i + 1].via;
    const side = OPP[doorSide(din, a)];
    const alongX = side === 'N' || side === 'S';
    const cx = (din.x + din.w / 2) * CELL, cz = (din.y + din.h / 2) * CELL;
    const ox = (dout.x + dout.w / 2) * CELL, oz = (dout.y + dout.h / 2) * CELL;
    const fwd = NORMAL[side], right = [-fwd[1], fwd[0]];
    const sx = alongX ? cx : face(a, side), sz = alongX ? face(a, side) : cz;
    const proj = (ox - sx) * right[0] + (oz - sz) * right[1];
    const arrow = Math.abs(proj) < 1.2 ? 'up' : proj > 0 ? 'right' : 'left';
    const t = alongX ? cx : cz, toward = Math.sign(proj) * (alongX ? right[0] : right[1]);
    // that wall spot taken (a door opposite): 1.6 m along the wall toward the way out
    for (const dt of [0, 1.6 * (toward || 1), -1.6 * (toward || 1)]) if (wallSign(D, a, side, t + dt, 2.25, {kind: 'info', text: 'GENERATOR HALL', w: 1.9, arrow})) break;
  }
}
