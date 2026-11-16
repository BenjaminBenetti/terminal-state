// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): SURFACE RUN — the Subway's way up. One of the station's sealed
// street-exit halls (gen/station.ts 'exit-stair': an 8 x 20-cell hall, a 4 m landing, then the 6 m 'exitStair' block behind its locked
// grille) is OPENED: the grille block goes, and a long stair climb is carved from the hall's far end into the rock — several flights and
// landings like the station's own stairs (gen/traversal.ts layStairRun: STAIR risers / treads / landings / headroom), ~9.5 m up (8.2 m when
// the rock is tighter), ending on a top landing at a CLOSED street door (world/surface/accessView.ts draws it; the crossing happens behind
// a loading screen, nothing of the city is in the station's world).
//
// RNG-NEUTRAL and APPEND-ONLY: no station stream is drawn. The climb's cells are rock (SOLID on every storey grid, with a one-cell rock
// ring) turned to floor; new areas / lights / signs / flights are APPENDED; in place only the chosen hall changes: its far cells carry the
// first flight, its grille block is retired (cargoGone, no cells, no sight block — the "not part of this station any more" every reader
// honours; the cargo runtime hides its instances and drops its box at build), its door sign reads "… · EXIT", its grille notice becomes a hanging "TO STREET"
// sign and its label loses "(closed)". The plan is deterministic: the hall order is rotated by a hash of the level seed, the first plan
// that fits wins (straight on, then turned legs), so the same station always gets the same stairwell.

import {hashString} from '../../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from '../grid';
import {cellsOfBox} from '../placeKit';
import {STAIR, layStairRun, planStairs, type StairFlight} from '../traversal';
import type {Area, Door, LightPlacement, Rect, SignPlacement, StationLayout} from '../stationTypes';
import type {SurfaceAccessInfo} from './surfaceTypes';
import {playerTrainPlacement} from '../playerTrain';
import {RIDE_BOX, ridePortals} from '../../world/ridePortal'; // (pure: the ride tunnel's portals from the layout)

/** The climb's shape (exported for tests / QA). */
export const ACCESS_STAIR = {
  /** Total risers, first choice and the tighter fallback (x STAIR.riser 0.17 = 9.52 m / 8.16 m). */
  risers: [56, 48] as const,
  /** First stair cell (local depth from the hall's door edge): the hall keeps a 4.5 m landing at the foot. */
  start: 9,
  /** Top landing (vestibule) depth in front of the street door (m) and its ceiling above the top floor. */
  vestibule: 2.5,
  vestibuleCeil: 3.2,
  /** Intermediate landing at the top of a leg (m, >= STAIR.landing). */
  legLanding: 1.2,
  /** Width (cells) of a leg that turns off the hall's axis. */
  turnWidth: 6,
  /** The street door's opening (m). */
  door: {w: 1.8, h: 2.2},
} as const;

/** A hall's local frame: depth u from the door edge into the hall (and on into the rock), across v. */
interface Frame {
  ox: number; oy: number;
  /** Grid step of +u and of +v. */
  dx: number; dy: number; ax: number; ay: number;
  /** Width (cells along v) and depth (cells along u) of the hall. */
  W0: number; D0: number;
}

function frameOf(a: Area, d: Door): Frame | null {
  if (d.h === 1 && d.y < a.y) return {ox: a.x, oy: a.y, dx: 0, dy: 1, ax: 1, ay: 0, W0: a.w, D0: a.h};
  if (d.h === 1 && d.y >= a.y + a.h) return {ox: a.x, oy: a.y + a.h - 1, dx: 0, dy: -1, ax: 1, ay: 0, W0: a.w, D0: a.h};
  if (d.w === 1 && d.x < a.x) return {ox: a.x, oy: a.y, dx: 1, dy: 0, ax: 0, ay: 1, W0: a.h, D0: a.w};
  if (d.w === 1 && d.x >= a.x + a.w) return {ox: a.x + a.w - 1, oy: a.y, dx: -1, dy: 0, ax: 0, ay: 1, W0: a.h, D0: a.w};
  return null;
}

/** Grid rect of the local box u in [u0, u1), v in [v0, v1). */
function rectOf(f: Frame, u0: number, u1: number, v0: number, v1: number): Rect {
  const x0 = f.ox + u0 * f.dx + v0 * f.ax, y0 = f.oy + u0 * f.dy + v0 * f.ay;
  const x1 = f.ox + (u1 - 1) * f.dx + (v1 - 1) * f.ax, y1 = f.oy + (u1 - 1) * f.dy + (v1 - 1) * f.ay;
  return {x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1};
}

/** One straight leg: its rect, the grid step from its foot to its head (one of the four axis units) and its risers. */
interface Leg { rect: Rect; sx: number; sy: number; risers: number; lead: number; inHall: boolean }
interface StairPlan { legs: Leg[]; flats: Rect[]; shape: string }

const runLen = (risers: number): number => planStairs(risers * STAIR.riser).length;
const cellsFor = (m: number): number => Math.ceil(m / CELL - 1e-6);

/** The most risers a leg of `len` m carries with a landing of `lead` m at its head. */
function maxRisers(len: number, lead: number): number {
  let n = 0;
  while (runLen(n + 1) + lead <= len + 1e-6) n++;
  return n;
}

/** Candidate plans for a hall, best first: straight on, then (for each extension of the straight part) a turn either way. */
function plansFor(f: Frame, total: number, turnFirst: 1 | -1): StairPlan[] {
  const S = ACCESS_STAIR, D0 = f.D0, W0 = f.W0, W2 = S.turnWidth;
  const stepU = [f.dx, f.dy] as const, stepV = [f.ax, f.ay] as const;
  const hallLen = (D0 - S.start) * CELL;
  const n1 = Math.min(total, maxRisers(hallLen, S.legLanding));
  if (n1 <= 0) return [];
  const hall: Leg = {rect: rectOf(f, S.start, D0, 0, W0), sx: stepU[0], sy: stepU[1], risers: n1, lead: hallLen - runLen(n1), inHall: true};
  const out: StairPlan[] = [];
  const rest = total - n1;
  // straight on: one leg beyond the hall end, its head the vestibule
  {
    const L = cellsFor(runLen(rest) + S.vestibule);
    out.push({legs: [hall, {rect: rectOf(f, D0, D0 + L, 0, W0), sx: stepU[0], sy: stepU[1], risers: rest, lead: L * CELL - runLen(rest), inHall: false}], flats: [], shape: 'straight'});
  }
  // a straight extension of k whole flights (k = 3 .. 0), a turn landing, then the rest across (either side, the hashed side first)
  for (let k = 3; k >= 0; k--) {
    const ext = Math.min(rest, k * STAIR.maxRisers);
    if (k > 0 && ext <= 0) continue;
    const across = rest - ext;
    if (across <= 0) continue;
    const E = ext > 0 ? cellsFor(runLen(ext) + S.legLanding) : 0;
    const legs0: Leg[] = [hall];
    if (E > 0) legs0.push({rect: rectOf(f, D0, D0 + E, 0, W0), sx: stepU[0], sy: stepU[1], risers: ext, lead: E * CELL - runLen(ext), inHall: false});
    const u0 = D0 + E, corner = rectOf(f, u0, u0 + W2, 0, W0);
    const L = cellsFor(runLen(across) + S.vestibule);
    for (const side of [turnFirst, -turnFirst as 1 | -1]) {
      const leg = side > 0
        ? {rect: rectOf(f, u0, u0 + W2, W0, W0 + L), sx: stepV[0], sy: stepV[1]}
        : {rect: rectOf(f, u0, u0 + W2, -L, 0), sx: -stepV[0], sy: -stepV[1]};
      out.push({legs: [...legs0, {...leg, risers: across, lead: L * CELL - runLen(across), inHall: false}], flats: [corner], shape: `turn${side > 0 ? '+' : '-'}${k}`});
    }
  }
  // out through a SIDE wall of the hall at its head landing (a hall at the edge of the rock / facing the ride tunnel): a shorter first
  // flight leaves a landing as long as the side leg is wide, the side leg carries the rest
  {
    const nS = Math.min(total, maxRisers(hallLen, W2 * CELL + 0.01));
    const across = total - nS;
    if (nS > 0 && across > 0) {
      const hallS: Leg = {...hall, risers: nS, lead: hallLen - runLen(nS)};
      const L = cellsFor(runLen(across) + S.vestibule);
      for (const side of [turnFirst, -turnFirst as 1 | -1]) {
        const leg = side > 0
          ? {rect: rectOf(f, D0 - W2, D0, W0, W0 + L), sx: stepV[0], sy: stepV[1]}
          : {rect: rectOf(f, D0 - W2, D0, -L, 0), sx: -stepV[0], sy: -stepV[1]};
        out.push({legs: [hallS, {...leg, risers: across, lead: L * CELL - runLen(across), inHall: false}], flats: [], shape: `side${side > 0 ? '+' : '-'}`});
      }
    }
  }
  return out;
}

function cellsOf(r: Rect): number[][] {
  const out: number[][] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push([x, y]);
  return out;
}

/** Every new cell is rock on every storey grid, and so is the one-cell ring round the new cells (except the hall / the plan's own). */
function fits(grids: readonly Grid[], hall: Rect, plan: StairPlan): boolean {
  const g = grids[0];
  const own = new Set<number>();
  const fresh: Rect[] = [...plan.legs.filter(l => !l.inHall).map(l => l.rect), ...plan.flats];
  const inRect = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  for (const r of fresh) for (const [x, y] of cellsOf(r)) {
    if (x < 1 || y < 1 || x > g.w - 2 || y > g.h - 2 || inRect(hall, x, y)) return false;
    own.add(g.idx(x, y));
  }
  for (const i of own) for (const G of grids) if (G.cells[i] !== SOLID) return false;
  for (const r of fresh) {
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (inRect(r, x, y) || inRect(hall, x, y)) continue;
      const i = g.idx(x, y);
      if (own.has(i)) continue;
      for (const G of grids) if (G.cells[i] !== SOLID) return false;
    }
  }
  return true;
}

/** The hall's door (its only opening) and the grille block in it. */
function hallParts(layout: StationLayout, a: Area): {door: Door; frame: Frame} | null {
  const doors = layout.doors.filter(d => d.a === a.id || d.b === a.id);
  if (doors.length !== 1 || (a.level ?? 0) !== 0) return null;
  if (!layout.props.some(p => p.kind === 'exitStair' && p.area === a.id && !p.cargoGone)) return null;
  const frame = frameOf(a, doors[0]);
  return frame && frame.D0 > ACCESS_STAIR.start + 4 ? {door: doors[0], frame} : null;
}

/**
 * Carves the Subway's way up into `layout` and returns its access record, or null when no exit hall has room (the caller then has
 * no access: never a half-carved station). `levelSeed` only orders the halls.
 */
export function carveSubwayAccess(layout: StationLayout, levelSeed: number): SurfaceAccessInfo | null {
  if (!layout.levels?.length) return null; // (every generated station has its storeys: the carve re-keys their derived views below)
  const grids: readonly Grid[] = layout.levels.map(l => l.grid);
  const halls = layout.areas.filter(a => a.type === 'exit-stair' && hallParts(layout, a));
  if (!halls.length) return null;
  const h = hashString('surface-access-subway-v1', levelSeed >>> 0);
  const rot = h % halls.length, turnFirst: 1 | -1 = (h >>> 8) & 1 ? 1 : -1;
  const order = halls.map((_, i) => halls[(i + rot) % halls.length]);
  // (shape-major: a straight climb from any hall beats a turned one from the hashed hall)
  const zones = rideZones(layout);
  for (const total of ACCESS_STAIR.risers) {
    const options = order.map(a => {
      const parts = hallParts(layout, a)!;
      return {a, frame: parts.frame, plans: plansFor(parts.frame, total, turnFirst)};
    });
    const shapes: string[] = [];
    for (const o of options) for (const p of o.plans) if (!shapes.includes(p.shape)) shapes.push(p.shape);
    for (const shape of shapes) {
      for (const o of options) {
        const plan = o.plans.find(p => p.shape === shape);
        if (plan && fits(grids, o.a, plan) && clearOfTracks(zones, plan)) return carve(layout, o.a, o.frame, plan, total);
      }
    }
  }
  return null;
}

/** (tests / QA) every candidate the planner weighs for a station, in its order: hall, shape, risers, whether the rock / tracks allow it. */
export function surveySubwayAccess(layout: StationLayout, levelSeed: number): {hall: number; shape: string; risers: number; rock: boolean; tracks: boolean}[] {
  const grids: readonly Grid[] = layout.levels?.length ? layout.levels.map(l => l.grid) : [layout.grid];
  const halls = layout.areas.filter(a => a.type === 'exit-stair' && hallParts(layout, a));
  const h = hashString('surface-access-subway-v1', levelSeed >>> 0);
  const turnFirst: 1 | -1 = (h >>> 8) & 1 ? 1 : -1;
  const out: {hall: number; shape: string; risers: number; rock: boolean; tracks: boolean}[] = [];
  const zones = rideZones(layout);
  for (const total of ACCESS_STAIR.risers) for (const a of halls) for (const p of plansFor(hallParts(layout, a)!.frame, total, turnFirst)) out.push({hall: a.id, shape: p.shape, risers: total, rock: fits(grids, a, p), tracks: clearOfTracks(zones, p)});
  return out;
}

/** How far beyond a ride portal's plane the player train's ride tunnel stub reaches (m; world/trainTransitTunnel.ts: 192 m) + margin. */
const RIDE_REACH = 200;

/** The rock the player train's ride tunnel takes beyond the station's two ride portals (xz boxes, world m; world/ridePortal.ts). */
function rideZones(layout: StationLayout): {x0: number; x1: number; z0: number; z1: number}[] {
  const p = playerTrainPlacement(layout);
  if (!p) return [];
  const ports = ridePortals(layout, p), m = RIDE_BOX.half + CELL;
  return [ports.front, ports.rear].map(q => ({x0: Math.min(q.x, q.x + q.out * RIDE_REACH), x1: Math.max(q.x, q.x + q.out * RIDE_REACH), z0: q.z - m, z1: q.z + m}));
}

/** The climb (with its rock ring) never meets the ride tunnel drawn outside the carved cells beyond the station's ride portals. */
function clearOfTracks(zones: readonly {x0: number; x1: number; z0: number; z1: number}[], plan: StairPlan): boolean {
  for (const r of [...plan.legs.filter(l => !l.inHall).map(l => l.rect), ...plan.flats]) {
    const x0 = (r.x - 1) * CELL, x1 = (r.x + r.w + 1) * CELL, z0 = (r.y - 1) * CELL, z1 = (r.y + r.h + 1) * CELL;
    for (const q of zones) if (x1 > q.x0 && x0 < q.x1 && z1 > q.z0 && z0 < q.z1) return false;
  }
  return true;
}

function carve(layout: StationLayout, hall: Area, f: Frame, plan: StairPlan, total: number): SurfaceAccessInfo {
  const g = layout.grid, S = ACCESS_STAIR;
  const base = g.floor[g.idx(f.ox + (S.start - 1) * f.dx, f.oy + (S.start - 1) * f.dy)] || 0;
  const areas: number[] = [hall.id];
  // the grille block: retired (no cells / sight; the cargo runtime hides its drawn instances and drops its box at build:
  // world/trainPropCargo.ts hideOriginal). Its height is KEPT here: the render index (damage/propDamage.ts RenderIndex) finds a prop's
  // instances by their distance to its box, so a zero-height box would leave the block drawn in the stairwell.
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
  const newArea = (r: Rect, label: string, ceil: number): Area => {
    const a: Area = {...r, id: layout.areas.length, kind: 'passage', type: 'exit-stair', label, ceil, parent: hall.id, depth: hall.depth + 1, publicSpace: hall.publicSpace, lighting: hall.lighting};
    if (hall.paid !== undefined) a.paid = hall.paid;
    layout.areas.push(a);
    areas.push(a.id);
    for (const [x, y] of cellsOf(r)) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.area[i] = a.id; g.blocked[i] = 0; g.sightBlocked[i] = 0; }
    return a;
  };
  const flights: StairFlight[] = [];
  let y = base;
  const top = base + total * STAIR.riser;
  let lastArea = hall;
  for (let k = 0; k < plan.legs.length; k++) {
    const leg = plan.legs[k];
    const y1 = y + leg.risers * STAIR.riser;
    const last = k === plan.legs.length - 1;
    const area = leg.inHall ? hall : newArea(leg.rect, last ? 'Street stairs · top' : 'Street stairs', (last ? top + S.vestibuleCeil : y1 + STAIR.headroom));
    // the run's head (its lead) is at the leg's far end: from = that end, h0 = the head's height, h1 = the foot's (flush)
    const axis: 'x' | 'z' = leg.sx !== 0 ? 'x' : 'z';
    const from: 'lo' | 'hi' = (leg.sx || leg.sy) > 0 ? 'hi' : 'lo';
    for (const fl of layStairRun([g], leg.rect, area.id, axis, from, y1, y)) { fl.id = layout.traversal.stairs.length + flights.length; flights.push(fl); }
    y = y1;
    lastArea = area;
    // the turn landing after this leg (flat at its head height)
    if (!last && plan.flats.length && k === plan.legs.length - 2) {
      const c = newArea(plan.flats[0], 'Street stairs · landing', y + STAIR.headroom);
      for (const [x, yy] of cellsOf(plan.flats[0])) { const i = g.idx(x, yy); g.floor[i] = y; g.ceil[i] = y + STAIR.headroom; }
      void c;
    }
  }
  layout.traversal.stairs.push(...flights);
  // the top landing: a taller ceiling for the door and its sign
  const head = plan.legs[plan.legs.length - 1];
  for (const [x, yy] of cellsOf(head.rect)) {
    const i = g.idx(x, yy);
    if (g.rampIdx[i] < 0 && Math.abs(g.floor[i] - top) < 1e-4) g.ceil[i] = top + S.vestibuleCeil;
  }
  // the street door on the far wall of the top landing, facing back down the climb
  const {sx, sy} = head, r = head.rect;
  const plane = sx > 0 ? (r.x + r.w) * CELL : sx < 0 ? r.x * CELL : sy > 0 ? (r.y + r.h) * CELL : r.y * CELL;
  const mid = sx !== 0 ? (r.y + r.h / 2) * CELL : (r.x + r.w / 2) * CELL;
  const at = (back: number, side = 0): [number, number] => sx !== 0 ? [plane - sx * back, mid + side] : [mid + side, plane - sy * back];
  const [dx, dz] = at(0);
  const doorYaw = Math.atan2(-sx, -sy); // front normal (sin, cos) = back down the climb
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const width = (sx !== 0 ? r.h : r.w) * CELL;
  const tw = Math.min(width, S.door.w + 1.2) / 2;
  const t0 = at(0, -tw), t1 = at(1.6, tw);
  const trigger = {x0: r3(Math.min(t0[0], t1[0])), z0: r3(Math.min(t0[1], t1[1])), x1: r3(Math.max(t0[0], t1[0])), z1: r3(Math.max(t0[1], t1[1])), y0: r3(top - 0.2), y1: r3(top + 2.4)};
  const [rx, rz] = at(1.9);
  const returnPose = {x: r3(rx), z: r3(rz), yaw: r3(Math.atan2(sx, sy)), level: 0, y: r3(top)};
  // lights: one over the landing at the head of every flight, one over the street door
  const power = hall.lighting === 'dark' ? 0.45 : hall.lighting === 'dim' ? 0.7 : 1;
  const light = (x: number, z: number, yy: number, alongZ: boolean, area: number): LightPlacement => ({x: r3(x), y: r3(yy), z: r3(z), rot: alongZ ? 0 : Math.PI / 2, area, broken: false, flicker: false, warm: false, power, dying: false});
  for (const fl of flights) if (Math.abs(fl.top.y - top) > 0.05) layout.lights.push(light(fl.top.x, fl.top.z, fl.top.y + STAIR.headroom - 0.05, fl.axis === 'z', fl.area));
  const [lx, lz] = at(1.2);
  layout.lights.push(light(lx, lz, top + S.vestibuleCeil - 0.05, sx === 0, lastArea.id));
  // signs: the hall's door sign and grille notice change in place; a STREET EXIT plate over the door is appended
  let street = '';
  const door = layout.doors.find(d => d.a === hall.id || d.b === hall.id)!;
  const dcx = (door.x + door.w / 2) * CELL, dcz = (door.y + door.h / 2) * CELL;
  const doorSign = layout.signs.filter(s => s.kind === 'exit' && s.text.endsWith(' · EXIT CLOSED') && Math.hypot(s.x - dcx, s.z - dcz) < 4)
    .sort((p, q) => Math.hypot(p.x - dcx, p.z - dcz) - Math.hypot(q.x - dcx, q.z - dcz))[0];
  if (doorSign) { street = doorSign.text.slice(0, -' · EXIT CLOSED'.length); doorSign.text = `${street} · EXIT`; }
  const notice = layout.signs.find(s => s.area === hall.id && s.text === 'STREET ENTRANCE SEALED');
  if (notice) { notice.text = 'TO STREET'; notice.kind = 'exit'; notice.arrow = 'up'; notice.hang = true; notice.y = r3(Math.min(hall.ceil - 0.45, 2.85)); }
  if (/\(closed\)/i.test(hall.label)) hall.label = hall.label.replace(/\s*\(closed\)/i, '').trim() || 'Street exit';
  const [sgx, sgz] = at(0.06);
  const plate: SignPlacement = {x: r3(sgx), y: r3(top + S.door.h + 0.45), z: r3(sgz), rot: doorYaw, kind: 'exit', text: street ? `${street} · STREET` : 'STREET EXIT', area: lastArea.id, w: 2.2};
  layout.signs.push(plate);
  // the storeys' derived views (gen/levelGen.ts levelArrays, gen/levels.ts levelsOf) are cached by the levels ARRAY: generation already
  // built them over the uncarved grids — a new array (the same Level objects) makes every reader derive them from the carved grids
  if (layout.levels?.length) layout.levels = layout.levels.slice();
  return {
    v: 1, kind: 'subway-stair', trigger, returnPose, areas, label: 'the street',
    door: {x: r3(dx), z: r3(dz), y: r3(top), yaw: r3(doorYaw), w: S.door.w, h: S.door.h, level: 0},
    hall: hall.id, rise: r3(top - base), street: street ? titleCase(street) : undefined,
  };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_, n, t) => n + t.toLowerCase());
}
