// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): SURFACE RUN's DOORS — a physical leaf in every intact building
// entrance (gen/surface/surfaceTypes.ts SurfaceEntrance.door 'closed' / 'open') and the checkpoint tent's flap. Pure: no three.js / DOM
// (world/surface/airDoorView.ts draws the leaves; world/surface/air.ts runs them in the Game).
//
//  - STATES as generated: 'closed' = an intact door, shut (a sealed building stays sealed while it is shut); 'open' = propped open (stays
//    open until someone shuts it); 'smashed' = no leaf, a PERMANENT opening; 'boarded' = blocked (GEN keeps the doorway cells SOLID: nothing
//    here). The tent's flap starts shut (the tent is a sealed enclosure, like an intact building).
//  - [E] at a door (on its storey, within DOOR_RT.reach of the doorway, looking at it) opens / shuts it; it swings INTO the building over
//    DOOR_RT.time. Never shut on a body: a living body in the doorway refuses / re-opens a closing door (the player train's rule). A living
//    enemy pressing against a shut leaf for DOOR_RT.pushOpen s pushes it open (the train / lift "push into a shut door" rule, for enemies).
//    [Task studio-surface-run-field-followup-20261116-211729-01 (lane FIXES), user: "Large doors must be closable while aiming at the
//    actual door/leaf from a clear position, not only at the opening centre where the player blocks closing. Retain real obstruction/
//    safety rules rather than deleting those checks." — the AIM is the crosshair ray on the door's actual leaves (each at its pose) or its
//    opening, within DOOR_RT.reach of the eye along the ray (doorAimHit; world/surface/air.ts adds the storey and the nothing-structural-
//    in-between rules); the OBSTRUCTION is each leaf's real path (doorSweeps: the quarter-disc sector its width sweeps about its hinge
//    between its current and target angle, padded by half its thickness): a body whose circle reaches that path refuses / re-opens the
//    closing door, one standing clear of it (beside / behind an open leaf, out on the street) does not. The leaves fill the doorway to its
//    head (a 4.2 m depot doorway: no gap over a shut door).]
//    A door opened in play (by the player or an enemy) swings shut by itself after DOOR_RT.autoClose s of a clear doorway (a self-closing
//    street door); one that stood open as generated stays open until shut.
//  - COLLISION: the player train's pattern — 'column' prop boxes (anchored steel: damage/materials NEVER('steel'), not dynamic, not a holder)
//    in game.propIndex (player / enemy collision) and in layout.props (bullets, melee, the flashlight's bounce stop at a shut leaf): one box
//    across the doorway while it is (mostly) shut, one per leaf along its jamb once open; the inactive one has zero height (every reader skips
//    it; it stays bucketed). The tent flap is canvas: its boxes block walking only (game.propIndex, never layout.props).
//  - GAS: a door that is not shut is an OPENING — a breach `door:<id>` on its building's zone (world/surface/airField.ts) over the doorway's
//    building-side cells at the outdoor strength, while open; shutting it removes the source and what came in lingers and thins away
//    (world/gas/field.ts StoreyGas.removeSources: below the damage threshold in ~30 s, never a vanish). A
//    smashed doorway is a permanent source. The flap likewise for the tent.
//  - PERSISTENCE: lane store SURFACE_DOORS_LANE (per district memory): each leafed door's open state and, if open, how long it has been open
//    (capped at GAS.AGE_CAP_S: its gas is replayed that far on the next build). Unknown / invalid entries fall back to the generated state.

import {CELL, FLOOR} from '../../gen/grid';
import type {PropPlacement} from '../../gen/props';
import type {Side} from '../../gen/stationTypes';
import type {SurfaceEntrance, SurfaceInfo} from '../../gen/surface/surfaceTypes';
import {GAS} from '../gas/field';
import {rayBox, sideNormal, type Box3Like, type P3} from '../towerShared';
import {storeyFloor} from './airPanes';

/** RUN lane store (per district memory) of the doors' state. */
export const SURFACE_DOORS_LANE = 'surface.doors';

export const DOOR_RT = {
  /** Swing time (s) shut <-> open. */
  time: 0.6,
  /**
   * [E] reach (m along the crosshair ray, eye to the aimed point on a leaf / the opening), same storey (feet within this of the door
   * floor, m). (lane FIXES: was 2.1 m horizontal to the doorway CENTRE in a look cone, out of reach of a wide door's leaf ends.)
   */
  reach: 2.4,
  storey: 1.2,
  /** (lane FIXES) A leaf's aim box is padded by this (m) round its slab; a body within this (m) of a leaf's path is in it. */
  aimPad: 0.06,
  sweepPad: 0.03,
  /** A living enemy pressing on a shut leaf this long (s) pushes it open; "pressing" = its circle within this (m) of the leaf box. */
  pushOpen: 1.2,
  pushReach: 0.18,
  /** A door opened in play swings shut after this long (s) with its doorway clear. */
  autoClose: 8,
  /** Leaf inset from the facade line into the wall (m), its thickness, the double-door threshold (m of clear width). */
  inset: 0.12,
  thick: 0.05,
  double: 1.7,
  /** Leaf gap (m) below the doorway head; the tent flap's width / height (m). */
  headGap: 0.03,
  flapWidth: 1.2,
  flapHeight: 2.0,
  /** Open fraction above which the open-leaf boxes collide instead of the shut box. */
  boxSwap: 0.5,
} as const;

/** A planned door (leafed entrance or the tent flap). */
export interface SurfaceDoorPlan {
  id: string;
  /** Building id, or -1 for the tent. */
  building: number;
  tent: boolean;
  level: number;
  /** Doorway centre on the facade line, the facade it pierces, its axes. */
  x: number; z: number; side: Side;
  /** Outward unit normal (x, z) and the along axis. */
  n: [number, number];
  along: 'x' | 'z';
  /** Along-axis coordinate of the doorway centre and of the facade line on the cross axis. */
  a: number; c: number;
  width: number; height: number;
  floor: number;
  /** Generated state. */
  gen: 'closed' | 'open' | 'smashed';
  /** The layout area of its interior (the entrance's `inner`, the tent's area): its collision boxes' area. */
  area: number;
  /** The doorway's building-side cells (gas source while open). */
  cells: number[];
  /** Leaves: hinge along-coordinate and the direction the leaf extends when shut (+1 / -1 along). */
  leaves: {hinge: number; dir: 1 | -1; width: number}[];
}

/** The runtime state of one door. */
export interface SurfaceDoorState {
  plan: SurfaceDoorPlan;
  /** Open fraction 0 (shut) .. 1 (open) and its target. */
  t: number;
  target: 0 | 1;
  /** Opened in play (auto-closes) vs open as generated / restored open-as-generated. */
  auto: boolean;
  /** Clock time it opened (gas age), NaN while shut. */
  openedAt: number;
  /** Seconds the doorway has been clear while open (auto-close), seconds an enemy has pressed the shut leaf. */
  clear: number;
  push: number;
  /** A body stands in the doorway (sensed this frame). */
  blocked: boolean;
  /** Collision boxes: [shut box, ...one per leaf open box]. */
  boxes: PropPlacement[];
  /** The gas source is running. */
  gas: boolean;
}

const hashStr = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

function leavesFor(id: string, a: number, width: number): SurfaceDoorPlan['leaves'] {
  const a0 = a - width / 2, a1 = a + width / 2;
  if (width >= DOOR_RT.double) return [{hinge: a0, dir: 1, width: width / 2}, {hinge: a1, dir: -1, width: width / 2}];
  return hashStr(id) % 2 ? [{hinge: a0, dir: 1, width}] : [{hinge: a1, dir: -1, width}];
}

/** The grid the door plan reads (level 0: the street level). */
export interface DoorGrid { w: number; h: number; cells: ArrayLike<number>; area: ArrayLike<number>; floor?: ArrayLike<number> }

/** The outer face of a rect's `side` (the facade line a doorway in that wall pierces). */
export function facadeLine(r: {x0: number; z0: number; x1: number; z1: number}, side: Side): number {
  return side === 'N' ? r.z0 : side === 'S' ? r.z1 : side === 'W' ? r.x0 : r.x1;
}

/**
 * The tent's doorway (GEN carves it FLOOR in the tent's wall ring, tent area): the run of such cells through the flap's cell along its
 * wall — its centre / width along the wall and its cells (the flap's gas source while open). Without such cells (an older record): a
 * DOOR_RT.flapWidth opening at the flap point.
 */
export function tentDoorway(info: Pick<SurfaceInfo, 'checkpoint'>, g: DoorGrid): {a: number; width: number; cells: number[]} {
  const t = info.checkpoint.tent, d = t.door, n = sideNormal(d.side), alongX = n[0] === 0;
  const a0 = alongX ? d.x : d.z;
  // the wall ring's cell row on that side
  const edge = facadeLine(t.rect, d.side), ring = Math.floor((edge - (n[0] + n[1]) * CELL * 0.5) / CELL);
  const at = (k: number) => (alongX ? ring * g.w + k : k * g.w + ring);
  const ok = (k: number) => {
    if (k < 0 || k >= (alongX ? g.w : g.h) || ring < 0 || ring >= (alongX ? g.h : g.w)) return false;
    const i = at(k);
    return g.cells[i] === FLOOR && g.area[i] === t.area;
  };
  const k0 = Math.floor(a0 / CELL);
  if (!ok(k0)) return {a: a0, width: DOOR_RT.flapWidth, cells: []};
  let lo = k0, hi = k0;
  while (ok(lo - 1) && k0 - lo < 16) lo--;
  while (ok(hi + 1) && hi - k0 < 16) hi++;
  const cells: number[] = [];
  for (let k = lo; k <= hi; k++) cells.push(at(k));
  return {a: (lo + hi + 1) * CELL / 2, width: (hi - lo + 1) * CELL, cells};
}

/** Every door of a district (leafed entrances, smashed openings, the tent flap) — deterministic. `g` = the street-level grid. */
export function planSurfaceDoors(info: SurfaceInfo, g: DoorGrid, levels?: readonly {id: number; baseY: number}[]): SurfaceDoorPlan[] {
  const out: SurfaceDoorPlan[] = [];
  // a street doorway's threshold is its own cells' floor (the kerb-height slab); other storeys: the storey floor
  const doorFloor = (e: Pick<SurfaceEntrance, 'level' | 'cells'>): number => (e.level === 0 && g.floor && e.cells.length ? g.floor[e.cells[0]] : storeyFloor(info, e.level, levels));
  const mk = (e: Pick<SurfaceEntrance, 'id' | 'building' | 'level' | 'x' | 'z' | 'side' | 'width' | 'height' | 'cells' | 'inner'>, gen: SurfaceDoorPlan['gen'], tent: boolean, c: number, floor?: number) => {
    const n = sideNormal(e.side), along: 'x' | 'z' = n[0] === 0 ? 'x' : 'z';
    const a = along === 'x' ? e.x : e.z;
    const x = along === 'x' ? e.x : c, z = along === 'x' ? c : e.z;
    out.push({id: e.id, building: e.building, tent, level: e.level, x, z, side: e.side, n, along, a, c, width: e.width, height: e.height,
      floor: floor ?? doorFloor(e), gen, area: e.inner, cells: [...e.cells], leaves: gen === 'smashed' ? [] : leavesFor(e.id, a, e.width)});
  };
  for (const b of info.buildings) for (const e of b.entrances) {
    if (e.door === 'boarded') continue;
    // the leaf sits in the building's own facade wall (its outer face), whatever point along the doorway's depth the record names
    const alongX = sideNormal(e.side)[0] === 0;
    mk(e, e.door, false, b.footprint ? facadeLine(b.footprint, e.side) : alongX ? e.z : e.x);
  }
  // (v2, lane INTERIOR, task studio-surface-run-field-followup-20261116-211729-01) a reachable roof's door: a leaf in the stair BULKHEAD's
  // wall (its outer face on the roof side), on the roof's level and floor — the same door runtime / breach rule as a street door (the
  // roof's outdoor air comes in while it is not shut)
  for (const b of info.buildings) {
    const ra = b.roofAccess, e = ra?.door;
    if (!ra || !e || e.door === 'boarded') continue;
    mk(e, e.door, false, facadeLine(ra.bulkhead, e.side), ra.y);
  }
  const t = info.checkpoint.tent, dw = tentDoorway(info, g), alongX = sideNormal(t.door.side)[0] === 0;
  mk({id: 'tent', building: -1, level: 0, x: alongX ? dw.a : t.door.x, z: alongX ? t.door.z : dw.a, side: t.door.side, width: dw.width, height: DOOR_RT.flapHeight, inner: t.area, cells: dw.cells},
    'closed', true, facadeLine(t.rect, t.door.side));
  return out;
}

/** The gas breach id of a door. */
export const doorBreachId = (id: string): string => `door:${id}`;

/**
 * Leaf height of a door (m): up to the doorway head (the flap: at most its own height). (lane FIXES: street leaves were capped at 2.4 m,
 * leaving a 0.2 m slit over every shut 2.6 m door and 1.8 m of open doorway over the depot's 4.2 m one.)
 */
export const leafHeight = (p: SurfaceDoorPlan): number => Math.max(0.5, (p.tent ? Math.min(p.height, DOOR_RT.flapHeight) : p.height) - DOOR_RT.headGap);

/** World point at along-coordinate a, cross offset `inward` (m, into the building) from the facade line. */
export function doorPoint(p: SurfaceDoorPlan, a: number, inward: number): {x: number; z: number} {
  const c = p.c - (p.n[0] + p.n[1]) * inward; // inward = against the outward normal
  return p.along === 'x' ? {x: a, z: c} : {x: c, z: a};
}

const ease = (t: number): number => t * t * (3 - 2 * t);

/** (lane FIXES) A leaf's swing angle (rad) at open fraction t: 0 shut (along the facade) .. PI / 2 open (straight in). */
export const leafAngle = (t: number): number => ease(Math.min(1, Math.max(0, t))) * Math.PI / 2;

type Leaf = SurfaceDoorPlan['leaves'][number];

/** A leaf's shut direction u (along the facade, hinge -> tip) and the inward normal v. */
const leafAxes = (p: SurfaceDoorPlan, leaf: Leaf): [number, number, number, number] =>
  (p.along === 'x' ? [leaf.dir, 0, -p.n[0], -p.n[1]] : [0, leaf.dir, -p.n[0], -p.n[1]]);

/** A leaf's pose at open fraction t: its centre (x, z) and the unit direction of its width (shut = along the facade, open = inward). */
export function leafPose(p: SurfaceDoorPlan, leaf: Leaf, t: number): {x: number; z: number; dx: number; dz: number} {
  const phi = leafAngle(t);
  const [ux, uz, vx, vz] = leafAxes(p, leaf);
  const dx = Math.cos(phi) * ux + Math.sin(phi) * vx, dz = Math.cos(phi) * uz + Math.sin(phi) * vz;
  const h = doorPoint(p, leaf.hinge, DOOR_RT.inset);
  return {x: h.x + dx * leaf.width / 2, z: h.z + dz * leaf.width / 2, dx, dz};
}

/**
 * (lane FIXES) Does a leaf swinging from open fraction `from` to `to` pass through a body circle (x, z, radius r)? Its PATH is the sector
 * its width sweeps about the hinge between the two angles, padded by half its thickness + r + DOOR_RT.sweepPad (so the target pose is in
 * it: a shut leaf on a body in the threshold is refused). A body on the side the leaf swings AWAY from (behind its starting pose: beside
 * the back of an open leaf as it shuts) is not in its path; one beyond the leaf's tip arc or out past the shut line (the street side)
 * only where the padding reaches it. No motion (from == to): only a body overlapping the leaf where it stands.
 */
export function leafSweeps(p: SurfaceDoorPlan, leaf: Leaf, from: number, to: number, x: number, z: number, r: number): boolean {
  const L = leaf.width, R = r + DOOR_RT.thick / 2 + DOOR_RT.sweepPad;
  const h = doorPoint(p, leaf.hinge, DOOR_RT.inset);
  const ox = x - h.x, oz = z - h.z;
  if (ox * ox + oz * oz > (L + R) * (L + R)) return false;
  const [ux, uz, vx, vz] = leafAxes(p, leaf);
  const s = ox * ux + oz * uz, w = ox * vx + oz * vz; // along the shut leaf, inward
  const rho = Math.hypot(s, w);
  if (rho < 1e-9) return true;
  const a0 = leafAngle(from), a1 = leafAngle(to), lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  const th = Math.atan2(w, s);
  // the vacated side: behind the starting pose, away from the swing
  if (a1 < a0 && th > a0) return false;
  if (a1 > a0 && th < a0) return false;
  if (th >= lo && th <= hi) return rho - L < R;
  // nearest of the two bounding poses (segments hinge -> tip)
  const seg = (phi: number): number => {
    const cx = Math.cos(phi), cz = Math.sin(phi), k = Math.min(L, Math.max(0, s * cx + w * cz));
    return Math.hypot(s - k * cx, w - k * cz);
  };
  return Math.min(seg(lo), seg(hi)) < R;
}

/** (lane FIXES) Does any leaf of the door, swinging from open fraction `from` to `to`, pass through the body circle (x, z, r)? */
export function doorSweeps(p: SurfaceDoorPlan, from: number, to: number, x: number, z: number, r: number): boolean {
  for (const l of p.leaves) if (leafSweeps(p, l, from, to, x, z, r)) return true;
  return false;
}

const aimBox: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};
const aimO: P3 = {x: 0, y: 0, z: 0}, aimD: P3 = {x: 0, y: 0, z: 0};

/**
 * (lane FIXES) The crosshair ray (eye o, unit d) on a door at open fraction t: the nearest t <= maxT on one of its LEAVES (each at its
 * pose: its slab padded by DOOR_RT.aimPad, floor to leaf top) or its OPENING (the doorway's span and head across the leaf line: aiming
 * through an open doorway, or at it from inside), or null. Pure geometry: the caller adds the storey / nothing-in-between rules.
 */
export function doorAimHit(p: SurfaceDoorPlan, t: number, o: P3, d: P3, maxT: number): number | null {
  if (!p.leaves.length) return null;
  const H = leafHeight(p), pad = DOOR_RT.aimPad, T = DOOR_RT.thick / 2 + pad;
  let best: number | null = null, bt = maxT;
  for (const l of p.leaves) {
    // the leaf's own frame: x' along its width (centre 0), z' across its slab
    const q = leafPose(p, l, t), ex = q.dx, ez = q.dz;
    const rx = o.x - q.x, rz = o.z - q.z;
    aimO.x = rx * ex + rz * ez; aimO.y = o.y; aimO.z = -rx * ez + rz * ex;
    aimD.x = d.x * ex + d.z * ez; aimD.y = d.y; aimD.z = -d.x * ez + d.z * ex;
    aimBox.min.x = -l.width / 2 - pad; aimBox.max.x = l.width / 2 + pad;
    aimBox.min.y = p.floor; aimBox.max.y = p.floor + H;
    aimBox.min.z = -T; aimBox.max.z = T;
    const hit = rayBox(aimO, aimD, aimBox, bt);
    if (hit !== null && hit < bt) { bt = hit; best = hit; }
  }
  // the opening: the doorway's span x its head, across the leaf line (the facade line to just inside the shut leaf)
  const a = doorPoint(p, p.a - p.width / 2, -pad), b = doorPoint(p, p.a + p.width / 2, DOOR_RT.inset + T);
  aimBox.min.x = Math.min(a.x, b.x); aimBox.max.x = Math.max(a.x, b.x);
  aimBox.min.y = p.floor; aimBox.max.y = p.floor + Math.max(H, p.height);
  aimBox.min.z = Math.min(a.z, b.z); aimBox.max.z = Math.max(a.z, b.z);
  const hit = rayBox(o, d, aimBox, bt);
  if (hit !== null && hit < bt) best = hit;
  return best;
}

/** Axis-aligned box helper (a 'column' collision box on the door's storey floor). */
function box(p: SurfaceDoorPlan, x0: number, z0: number, x1: number, z1: number, h: number, area: number): PropPlacement {
  return {kind: 'column', x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: p.floor, rot: 0, area, hx: Math.abs(x1 - x0) / 2, hz: Math.abs(z1 - z0) / 2, h, blocksSight: false, variant: 0, level: p.level};
}

/** The door's collision boxes: [the shut box across the doorway, one open box per leaf along its jamb]. */
export function doorBoxes(p: SurfaceDoorPlan, area = p.area): PropPlacement[] {
  if (!p.leaves.length) return [];
  const H = leafHeight(p), T = DOOR_RT.thick;
  const a0 = p.a - p.width / 2, a1 = p.a + p.width / 2;
  const s0 = doorPoint(p, a0, DOOR_RT.inset - T), s1 = doorPoint(p, a1, DOOR_RT.inset + T);
  const out = [box(p, Math.min(s0.x, s1.x), Math.min(s0.z, s1.z), Math.max(s0.x, s1.x), Math.max(s0.z, s1.z), H, area)];
  for (const l of p.leaves) {
    const q0 = doorPoint(p, l.hinge + l.dir * (T * 0.2), DOOR_RT.inset), q1 = doorPoint(p, l.hinge + l.dir * (T * 2.2), DOOR_RT.inset + l.width);
    out.push(box(p, Math.min(q0.x, q1.x), Math.min(q0.z, q1.z), Math.max(q0.x, q1.x), Math.max(q0.z, q1.z), 0, area));
  }
  return out;
}

/** Applies a door's open fraction to its boxes (the shut box below DOOR_RT.boxSwap, the open ones above). True when a box changed. */
export function fitDoorBoxes(d: SurfaceDoorState): boolean {
  if (!d.boxes.length) return false;
  const H = leafHeight(d.plan), shut = d.t < DOOR_RT.boxSwap;
  let changed = false;
  d.boxes.forEach((b, k) => {
    const h = (k === 0) === shut ? H : 0;
    if (b.h !== h) { b.h = h; changed = true; }
  });
  return changed;
}

/**
 * The doorway's passage box (the doorway's width from a margin outside to the longest leaf's reach inside). (lane FIXES: no longer the
 * closing rule — that is each leaf's real path, doorSweeps; this box took a player standing clear beside an open leaf of a wide door.)
 */
export function inDoorway(p: SurfaceDoorPlan, x: number, z: number, r: number): boolean {
  const out = p.n[0] + p.n[1];
  const a = p.along === 'x' ? x : z, c = p.along === 'x' ? z : x;
  const inward = (p.c - c) * out; // + inside the building
  const maxLeaf = Math.max(0, ...p.leaves.map(l => l.width));
  return Math.abs(a - p.a) < p.width / 2 + r - 0.04 && inward > -0.35 - r && inward < DOOR_RT.inset + maxLeaf + r;
}

/** Distance (m) from a circle centre to the shut leaf's box (enemy push sensing). */
export function shutLeafDistance(p: SurfaceDoorPlan, x: number, z: number): number {
  const a = p.along === 'x' ? x : z, c = p.along === 'x' ? z : x;
  const out = p.n[0] + p.n[1];
  const cIn = p.c - out * DOOR_RT.inset; // the leaf plane (cross coordinate)
  const da = Math.max(Math.abs(a - p.a) - p.width / 2, 0), dc = Math.max(Math.abs(c - cIn) - DOOR_RT.thick, 0);
  return Math.hypot(da, dc);
}

// ---------------------------------------------------------------------------------------------
// Persistence

/** Saved state (JSON-safe): per leafed door, open (1) / shut (0) and, if open, its age (s, capped). */
export interface SurfaceDoorsRecord { v: 1; doors: Record<string, {open: 0 | 1; age?: number}> }

/** The record of the live doors at game time `clock`. */
export function saveDoors(doors: readonly SurfaceDoorState[], clock: number): SurfaceDoorsRecord {
  const out: SurfaceDoorsRecord = {v: 1, doors: {}};
  for (const d of doors) {
    if (!d.plan.leaves.length) continue; // smashed: generated, never stored
    const open = d.target === 1 || d.t > 0.02;
    out.doors[d.plan.id] = open ? {open: 1, age: Math.round(Math.min(GAS.AGE_CAP_S, Math.max(0, Number.isFinite(d.openedAt) ? clock - d.openedAt : GAS.AGE_CAP_S)) * 1000) / 1000} : {open: 0};
  }
  return out;
}

/** A door's initial state from the record (validated) or its generated state: open?, age (s), auto-close. */
export function restoredDoor(p: SurfaceDoorPlan, rec: unknown): {open: boolean; age: number; auto: boolean} {
  if (p.gen === 'smashed') return {open: true, age: GAS.AGE_CAP_S, auto: false};
  const r = rec as {v?: unknown; doors?: Record<string, unknown>} | null | undefined;
  const e = r && typeof r === 'object' && r.v === 1 && r.doors && typeof r.doors === 'object' ? r.doors[p.id] as {open?: unknown; age?: unknown} | undefined : undefined;
  if (e && typeof e === 'object' && (e.open === 0 || e.open === 1)) {
    const age = Number(e.age);
    // a door found open on return stays open (never swings shut on its own after a rebuild)
    return e.open === 1 ? {open: true, age: Math.min(GAS.AGE_CAP_S, Math.max(0, Number.isFinite(age) ? age : GAS.AGE_CAP_S)), auto: false} : {open: false, age: 0, auto: false};
  }
  return p.gen === 'open' ? {open: true, age: GAS.AGE_CAP_S, auto: false} : {open: false, age: 0, auto: false};
}
