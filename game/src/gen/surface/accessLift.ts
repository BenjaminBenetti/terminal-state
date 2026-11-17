// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): SURFACE RUN version 2 — the CARGO LIFT ends of the crossing.
// The crossing rides one cargo lift (the cargo lift kit, world/elevator.ts): its LOWER stop is in the host station, its UPPER stop inside
// the district's command tent (gen/surface/checkpoint.ts carves that end). Both ends are the same car (LIFT_CAR): a FLOOR room walled by a
// one-cell SOLID ring whose front row leaves the gate open (a doorway of LIFT_CAR.gateCells), drawn by world/surface/liftSite.ts.
//
// Subway (carveSubwayLift): at one of the station's CLOSED street-exit halls (gen/station.ts 'exit-stair': an 8 x 20-cell hall, a landing,
// then the locked grille's 'exitStair' block) whose parent is NOT the food court or the retail arcade (a ticket hall / exit concourse: a
// normal closed exit, never "off the food court" — only when a station has none of those does any closed hall qualify). The grille block
// goes (retired exactly as the version-1 stairwell retires it), and the hall's far end becomes the lift: the ring and the car replace the
// block's cells, the gate opens onto the hall. Nothing is dug into the rock (the shaft rises through the rock above the hall, drawn only
// by the kit). A hall with anything else on the lift's footprint (a prop, a pickup, a light, a spawn) is skipped.
//
// The landing's light (liftLandingLight, every version-2 end): one steady ceiling fixture over the landing in front of the gate, appended
// as the version-1 stairwell appends its own (gen/surface/accessStair.ts: its power by the hall's lighting), so the gate and the landing
// stand in the baked light at rest; the car itself carries its own lit finish (world/elevator.ts cargoLitMaterials).
//
// RNG-NEUTRAL and APPEND-ONLY, like the version-1 stairwell: no station stream is drawn; one area and one light are appended (the car,
// the landing's fixture); in place only the
// chosen hall changes (its far cells, its grille block retired, its signs and label). The hall order is rotated by a hash of the level
// seed (its own key: never the version-1 one), so the same station always gets the same lift.

import {hashString} from '../../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from '../grid';
import {cellsOfBox} from '../placeKit';
import {PENDANT_Y, type Area, type Door, type LightPlacement, type Rect, type Side, type StationLayout} from '../stationTypes';
import type {SPose, SRect, SurfaceAccessInfo, SurfaceLift} from './surfaceTypes';

/** The car (cells unless noted) — one shape for every end of every Surface Run lift. */
export const LIFT_CAR = {
  /** Interior width across the gate wall and depth from the gate wall to the back (cells: 3 m x 2.5 m). */
  width: 6, depth: 5,
  /** The gate's doorway through the ring (cells, centred) and the kit's gate clear width (m). */
  gateCells: 4, gateW: 1.8,
  /**
   * The car's interior height and the gate's clear height (m); the room's ceiling stands `ceilGap` m above the car's, its floor `sink` m
   * below the car's deck (the kit's deck covers it: no two coplanar floors).
   */
  cabH: 2.4, gateH: 2.2, ceilGap: 0.05, sink: 0.01,
  /** The distance (m) between the shaft's two stops (the ride's travel). */
  rise: 9,
} as const;

/** The hall parents a version-2 lift avoids (the station's public dining / shopping fronts). */
export const LIFT_AVOID_PARENTS: readonly string[] = ['food-court', 'retail-arcade'];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The side of a rect whose outward normal is (nx, nz). */
export function sideOfNormal(nx: number, nz: number): Side {
  return nz < 0 ? 'N' : nz > 0 ? 'S' : nx < 0 ? 'W' : 'E';
}

/** Yaw that looks along (fx, fz) (the view's forward is (-sin yaw, -cos yaw)). */
export const yawAlong = (fx: number, fz: number): number => r3(Math.atan2(-fx, -fz));

/**
 * The lift record of a carved car room: `cab` = its interior (world m), `doorSide` = the side of `cab` its gate is on, `along` = the
 * gate centre's coordinate along that side.
 */
export function liftRecord(cab: SRect, doorSide: Side, along: number, y: number, level: number, area: number, end: SurfaceLift['end']): SurfaceLift {
  const c = {x0: r3(cab.x0), z0: r3(cab.z0), x1: r3(cab.x1), z1: r3(cab.z1)};
  const shaft = {x0: r3(c.x0 - CELL), z0: r3(c.z0 - CELL), x1: r3(c.x1 + CELL), z1: r3(c.z1 + CELL)};
  const alongX = doorSide === 'N' || doorSide === 'S';
  const plane = doorSide === 'N' ? c.z0 : doorSide === 'S' ? c.z1 : doorSide === 'W' ? c.x0 : c.x1;
  const door = alongX ? {x: r3(along), z: plane, width: LIFT_CAR.gateW} : {x: plane, z: r3(along), width: LIFT_CAR.gateW};
  return {cab: c, shaft, doorSide, door, y: r3(y), level, area, end};
}

/** The pose of a player standing in the car's middle, facing its gate. */
export function liftInsidePose(l: SurfaceLift): SPose {
  const n = outward(l.doorSide);
  const cx = (l.cab.x0 + l.cab.x1) / 2, cz = (l.cab.z0 + l.cab.z1) / 2;
  return {x: r3(cx - n[0] * 0.15), z: r3(cz - n[1] * 0.15), yaw: yawAlong(n[0], n[1]), level: l.level, y: l.y};
}

/** The car interior as the crossing's [E] box (absolute y). */
export function liftTrigger(l: SurfaceLift): {x0: number; z0: number; x1: number; z1: number; y0: number; y1: number} {
  return {x0: l.cab.x0, z0: l.cab.z0, x1: l.cab.x1, z1: l.cab.z1, y0: r3(l.y - 0.2), y1: r3(l.y + LIFT_CAR.cabH)};
}

/** The landing's fixture: its distance (m) out from the gate's plane over the landing. */
export const LIFT_LANDING_LIGHT = {out: 1.0} as const;

/**
 * The landing's light (every version-2 lift end in a station; the tent's is its own work lamp, gen/surface/checkpoint.ts): one steady
 * ceiling fixture over the landing, its tube along the gate, at the station's fixture height under the landing's ceiling (`g`: the
 * lift's storey grid), its power by the landing area's lighting (the version-1 stairwell's rule: dark 0.45, dim 0.7, else 1).
 */
export function liftLandingLight(g: Grid, l: SurfaceLift, area: number, lighting: Area['lighting']): LightPlacement {
  const n = outward(l.doorSide), x = l.door.x + n[0] * LIFT_LANDING_LIGHT.out, z = l.door.z + n[1] * LIFT_LANDING_LIGHT.out;
  const [cx, cy] = g.cellOf(x, z), rel = g.ceil[g.idx(cx, cy)] - l.y;
  const power = lighting === 'dark' ? 0.45 : lighting === 'dim' ? 0.7 : 1;
  const L: LightPlacement = {x: r3(x), y: r3(l.y + (rel > PENDANT_Y + 0.15 ? PENDANT_Y : rel - 0.02)), z: r3(z), rot: l.doorSide === 'N' || l.doorSide === 'S' ? 0 : Math.PI / 2,
    area, broken: false, flicker: false, warm: false, power, dying: false};
  if (l.level) L.level = l.level;
  return L;
}

/** Outward unit normal (x, z) of a side. */
export function outward(s: Side): [number, number] {
  return s === 'N' ? [0, -1] : s === 'S' ? [0, 1] : s === 'W' ? [-1, 0] : [1, 0];
}

// ---------------------------------------------------------------------------------------------
// The car room on a grid (local frame: +u from the landing INTO the car, +v across)

/** A lift's local frame on a grid: the gate row's first cell (ox, oy), the grid steps of +u / +v. */
export interface LiftFrame { ox: number; oy: number; dx: number; dy: number; ax: number; ay: number }

/** The cell of local (u, v). */
export const liftCell = (f: LiftFrame, u: number, v: number): [number, number] => [f.ox + u * f.dx + v * f.ax, f.oy + u * f.dy + v * f.ay];

/** Grid rect of the local box u in [u0, u1), v in [v0, v1). */
export function liftRect(f: LiftFrame, u0: number, u1: number, v0: number, v1: number): Rect {
  const [x0, y0] = liftCell(f, u0, v0), [x1, y1] = liftCell(f, u1 - 1, v1 - 1);
  return {x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1};
}

/** The footprint of the ring + car (u in [0, depth + 1), v in [0, width + 2)): the gate row is u = 0. */
export const LIFT_FOOT = {u: LIFT_CAR.depth + 1, v: LIFT_CAR.width + 2} as const;

/**
 * Carves the car room: the ring SOLID (area -1), the car's cells FLOOR (`area`, floor `y`, ceiling cabH + ceilGap), the gate's cells
 * FLOOR (`gateArea`: the landing side's area, ceiling gateH). Returns the car's interior rect (world m) and its gate centre along the front.
 */
export function carveLiftRoom(g: Grid, f: LiftFrame, y: number, area: number, gateArea: number): {cab: SRect; along: number; doorSide: Side} {
  const C = LIFT_CAR, g0 = Math.floor((C.width + 2 - C.gateCells) / 2);
  for (let u = 0; u < LIFT_FOOT.u; u++) for (let v = 0; v < LIFT_FOOT.v; v++) {
    const [x, yy] = liftCell(f, u, v), i = g.idx(x, yy);
    const car = u >= 1 && v >= 1 && v <= C.width;
    const gate = u === 0 && v >= g0 && v < g0 + C.gateCells;
    g.blocked[i] = 0; g.sightBlocked[i] = 0;
    if (car || gate) {
      g.cells[i] = FLOOR; g.area[i] = car ? area : gateArea; g.floor[i] = car ? y - C.sink : y; g.ceil[i] = y + (car ? C.cabH + C.ceilGap : C.gateH + C.ceilGap);
    } else { g.cells[i] = SOLID; g.area[i] = -1; g.floor[i] = 0; g.ceil[i] = 0; }
  }
  const r = liftRect(f, 1, LIFT_FOOT.u, 1, 1 + C.width);
  const cab = {x0: r.x * CELL, z0: r.y * CELL, x1: (r.x + r.w) * CELL, z1: (r.y + r.h) * CELL};
  const doorSide = sideOfNormal(-f.dx, -f.dy);
  const [gx, gy] = liftCell(f, 0, g0), [hx, hy] = liftCell(f, 0, g0 + C.gateCells - 1);
  const along = doorSide === 'N' || doorSide === 'S' ? ((Math.min(gx, hx) + Math.max(gx, hx) + 1) * CELL) / 2 : ((Math.min(gy, hy) + Math.max(gy, hy) + 1) * CELL) / 2;
  return {cab, along, doorSide};
}

// ---------------------------------------------------------------------------------------------
// Subway: the lift at a closed street-exit hall

/** A hall's frame (u from its door edge into the hall, v across) — as gen/surface/accessStair.ts frames it. */
interface HallFrame { ox: number; oy: number; dx: number; dy: number; ax: number; ay: number; W0: number; D0: number }

function hallFrame(a: Area, d: Door): HallFrame | null {
  if (d.h === 1 && d.y < a.y) return {ox: a.x, oy: a.y, dx: 0, dy: 1, ax: 1, ay: 0, W0: a.w, D0: a.h};
  if (d.h === 1 && d.y >= a.y + a.h) return {ox: a.x, oy: a.y + a.h - 1, dx: 0, dy: -1, ax: 1, ay: 0, W0: a.w, D0: a.h};
  if (d.w === 1 && d.x < a.x) return {ox: a.x, oy: a.y, dx: 1, dy: 0, ax: 0, ay: 1, W0: a.h, D0: a.w};
  if (d.w === 1 && d.x >= a.x + a.w) return {ox: a.x + a.w - 1, oy: a.y, dx: -1, dy: 0, ax: 0, ay: 1, W0: a.h, D0: a.w};
  return null;
}

/** The lift's frame at a hall's far end (null: the hall is not as wide as the lift's footprint or too short to keep its landing). */
function liftFrameOf(h: HallFrame): LiftFrame | null {
  if (h.W0 < LIFT_FOOT.v || h.D0 < LIFT_FOOT.u + 8) return null;
  const v0 = Math.floor((h.W0 - LIFT_FOOT.v) / 2), u0 = h.D0 - LIFT_FOOT.u;
  return {ox: h.ox + u0 * h.dx + v0 * h.ax, oy: h.oy + u0 * h.dy + v0 * h.ay, dx: h.dx, dy: h.dy, ax: h.ax, ay: h.ay};
}

interface HallPick { hall: Area; door: Door; frame: HallFrame; lift: LiftFrame }

/** A closed exit hall the lift can take: one door, the street level, its grille block in place, the footprint free of everything else. */
function hallPick(layout: StationLayout, a: Area): HallPick | null {
  const doors = layout.doors.filter(d => d.a === a.id || d.b === a.id);
  if (doors.length !== 1 || (a.level ?? 0) !== 0) return null;
  if (!layout.props.some(p => p.kind === 'exitStair' && p.area === a.id && !p.cargoGone)) return null;
  const frame = hallFrame(a, doors[0]), lift = frame && liftFrameOf(frame);
  if (!frame || !lift) return null;
  const r = liftRect(lift, 0, LIFT_FOOT.u, 0, LIFT_FOOT.v);
  const x0 = r.x * CELL, z0 = r.y * CELL, x1 = (r.x + r.w) * CELL, z1 = (r.y + r.h) * CELL;
  const inside = (x: number, z: number, m = 0) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;
  const g = layout.grid;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = g.idx(x, y); if (g.cells[i] !== FLOOR || g.area[i] !== a.id) return null; }
  // the cells behind the car (the hall's far wall) are rock
  for (let v = 0; v < LIFT_FOOT.v; v++) { const [x, y] = liftCell(lift, LIFT_FOOT.u, v); if (!g.inBounds(x, y) || g.cells[g.idx(x, y)] !== SOLID) return null; }
  for (const p of layout.props) {
    if (p.cargoGone || (p.level ?? 0) !== 0 || (p.kind === 'exitStair' && p.area === a.id)) continue;
    if (Math.abs(p.x - (x0 + x1) / 2) < (x1 - x0) / 2 + p.hx && Math.abs(p.z - (z0 + z1) / 2) < (z1 - z0) / 2 + p.hz) return null;
  }
  if (layout.pickups.some(q => (q.level ?? 0) === 0 && inside(q.x, q.z, 0.2))) return null;
  if (layout.lights.some(l => ((l as {level?: number}).level ?? 0) === 0 && inside(l.x, l.z, 0.3))) return null;
  if (layout.zombies.some(z => ((z as {level?: number}).level ?? 0) === 0 && inside(z.x, z.z, 0.5))) return null;
  return {hall: a, door: doors[0], frame, lift};
}

/** The station's closed exit halls in the lift's order: preferred parents first (the hashed rotation within each group). */
export function subwayLiftCandidates(layout: StationLayout, levelSeed: number): {hall: number; parent: string; preferred: boolean; fits: boolean}[] {
  const halls = layout.areas.filter(a => a.type === 'exit-stair' && layout.doors.filter(d => d.a === a.id || d.b === a.id).length === 1 && (a.level ?? 0) === 0
    && layout.props.some(p => p.kind === 'exitStair' && p.area === a.id && !p.cargoGone));
  const h = hashString('surface-access-subway-lift-v2', levelSeed >>> 0);
  const rot = halls.length ? h % halls.length : 0;
  const order = halls.map((_, i) => halls[(i + rot) % halls.length]);
  const parentOf = (a: Area) => (a.parent !== undefined && a.parent >= 0 ? layout.areas[a.parent]?.type ?? '' : '');
  const preferred = order.filter(a => !LIFT_AVOID_PARENTS.includes(parentOf(a)));
  const rest = order.filter(a => LIFT_AVOID_PARENTS.includes(parentOf(a)));
  return [...preferred, ...rest].map(a => ({hall: a.id, parent: parentOf(a), preferred: !LIFT_AVOID_PARENTS.includes(parentOf(a)), fits: !!hallPick(layout, a)}));
}

/**
 * Version 2: carves the Subway's cargo lift into `layout` and returns its access record, or null when no closed exit hall can take it
 * (the caller then falls back). A hall off the food court / retail arcade is used only when no other closed hall fits.
 */
export function carveSubwayLift(layout: StationLayout, levelSeed: number): SurfaceAccessInfo | null {
  if (!layout.levels?.length) return null;
  const cands = subwayLiftCandidates(layout, levelSeed);
  const pickAny = (pref: boolean) => cands.filter(c => c.preferred === pref && c.fits).map(c => hallPick(layout, layout.areas[c.hall])!)[0] ?? null;
  const pick = pickAny(true) ?? pickAny(false);
  return pick ? carve(layout, pick) : null;
}

function carve(layout: StationLayout, P: HallPick): SurfaceAccessInfo {
  const g = layout.grid, hall = P.hall;
  const [fx, fy] = liftCell(P.lift, 0, 0);
  const base = g.floor[g.idx(fx, fy)] || 0;
  // the grille block: retired as the version-1 stairwell retires it (no cells / sight; its height kept for the render index)
  for (const p of layout.props) {
    if (p.kind !== 'exitStair' || p.area !== hall.id || p.cargoGone) continue;
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.inBounds(x, y)) { const i = g.idx(x, y); g.blocked[i] = 0; g.sightBlocked[i] = 0; }
    p.cargoGone = true; p.blocksSight = false;
  }
  // (anything else standing on those cells keeps its block)
  for (const p of layout.props) {
    if (p.cargoGone || p.mounted || p.host !== undefined || (p.level ?? 0) !== 0 || p.area !== hall.id) continue;
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.inBounds(x, y)) { const i = g.idx(x, y); g.blocked[i] = 1; if (p.blocksSight) g.sightBlocked[i] = 1; }
  }
  // the car: an appended area (the hall's child), its room and ring in the hall's far cells
  const carRect = liftRect(P.lift, 1, LIFT_FOOT.u, 1, 1 + LIFT_CAR.width);
  const car: Area = {...carRect, id: layout.areas.length, kind: 'passage', type: 'exit-stair', label: 'Cargo lift', ceil: base + LIFT_CAR.cabH + LIFT_CAR.ceilGap,
    parent: hall.id, depth: hall.depth + 1, publicSpace: hall.publicSpace, lighting: hall.lighting};
  if (hall.paid !== undefined) car.paid = hall.paid;
  layout.areas.push(car);
  const room = carveLiftRoom(g, P.lift, base, car.id, hall.id);
  const lift = liftRecord(room.cab, room.doorSide, room.along, base, 0, car.id, 'lower');
  layout.lights.push(liftLandingLight(g, lift, hall.id, hall.lighting));
  // signs: the hall's door sign and grille notice change in place (as the version-1 stairwell's)
  let street = '';
  const dcx = (P.door.x + P.door.w / 2) * CELL, dcz = (P.door.y + P.door.h / 2) * CELL;
  const doorSign = layout.signs.filter(s => s.kind === 'exit' && s.text.endsWith(' · EXIT CLOSED') && Math.hypot(s.x - dcx, s.z - dcz) < 4)
    .sort((p, q) => Math.hypot(p.x - dcx, p.z - dcz) - Math.hypot(q.x - dcx, q.z - dcz))[0];
  if (doorSign) { street = doorSign.text.slice(0, -' · EXIT CLOSED'.length); doorSign.text = `${street} · EXIT`; }
  const notice = layout.signs.find(s => s.area === hall.id && s.text === 'STREET ENTRANCE SEALED');
  if (notice) { notice.text = 'LIFT TO STREET'; notice.kind = 'exit'; notice.arrow = 'up'; notice.hang = true; notice.y = r3(Math.min(hall.ceil - 0.45, 2.85)); }
  if (/\(closed\)/i.test(hall.label)) hall.label = hall.label.replace(/\s*\(closed\)/i, '').trim() || 'Street exit';
  // the storeys' derived views are cached by the levels ARRAY (as the version-1 carve): a new array re-derives them from the carved grid
  if (layout.levels?.length) layout.levels = layout.levels.slice();
  return {
    v: 2, kind: 'lift', trigger: liftTrigger(lift), returnPose: liftInsidePose(lift), areas: [hall.id, car.id], label: 'the street',
    hall: hall.id, rise: LIFT_CAR.rise, street: street ? titleCase(street) : undefined, lift,
  };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_, n, t) => n + t.toLowerCase());
}
