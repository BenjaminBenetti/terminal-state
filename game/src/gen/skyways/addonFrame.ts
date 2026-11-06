// Task studio-skyways-level-20261106-054448 (lane ADDON): the shared hall frame / keep-mask / placement helpers of the Skyways add-on
// dressers (gen/skyways/addon.ts entry, addonConvention.ts, addonPrize.ts). Pure data (no three.js).
//
// Frame: like the food kit's 'absolute' frame — every prop is placed in its storey's LOCAL height frame (y above the hall floor) through
// the shared placement primitive (gen/placeKit.ts tryPlaceProp: area cells, door zones, keep strips, connectivity) and lifted onto the
// storey floor at the end (AddonDresser.lift; the station dresser's liftLevels has already run). Clear lanes and door strips are
// reserved first (PlaceCtx.keep), so nothing placed later stands in them.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../props';
import {doorSide, makePlaceCtx, markCell, tryPlaceProp, type PlaceCtx, type PlaceOpts} from '../placeKit';
import type {Area, Door, Side, StationLayout} from '../stationTypes';
import type {SkywaysAddon, SkywaysRect} from './skywaysTypes';

// ---------------------------------------------------------------------------------------------
// Hall frame: u along the entry wall (from its x0 / z0 end), v depth from the entry wall into the hall

export const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
export interface HallFrame {
  a: Area;
  front: Side; back: Side;
  x0: number; z0: number; x1: number; z1: number;
  /** Width along the entry wall, depth from it (m). */
  W: number; D: number;
  /** Yaws (three.js Y rotation; a prop's front +Z then faces): the entry wall (-v), the back wall (+v), +u, -u. */
  toFront: number; toBack: number; plusU: number; minusU: number;
}
export function hallFrame(a: Area, front: Side): HallFrame {
  const x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL;
  const alongX = front === 'N' || front === 'S';
  const r = {N: {f: Math.PI, pu: Math.PI / 2, mu: -Math.PI / 2}, S: {f: 0, pu: Math.PI / 2, mu: -Math.PI / 2}, W: {f: -Math.PI / 2, pu: 0, mu: Math.PI}, E: {f: Math.PI / 2, pu: 0, mu: Math.PI}}[front];
  return {a, front, back: OPP[front], x0, z0, x1, z1, W: alongX ? x1 - x0 : z1 - z0, D: alongX ? z1 - z0 : x1 - x0,
    toFront: r.f, toBack: normYaw(r.f + Math.PI), plusU: r.pu, minusU: r.mu};
}
/** (u, v) -> world (x, z). */
export function uvXZ(fr: HallFrame, u: number, v: number): [number, number] {
  switch (fr.front) {
    case 'N': return [fr.x0 + u, fr.z0 + v];
    case 'S': return [fr.x0 + u, fr.z1 - v];
    case 'W': return [fr.x0 + v, fr.z0 + u];
    default: return [fr.x1 - v, fr.z0 + u];
  }
}
/** World (x, z) -> (u, v). */
export function xzUV(fr: HallFrame, x: number, z: number): [number, number] {
  switch (fr.front) {
    case 'N': return [x - fr.x0, z - fr.z0];
    case 'S': return [x - fr.x0, fr.z1 - z];
    case 'W': return [z - fr.z0, x - fr.x0];
    default: return [z - fr.z0, fr.x1 - x];
  }
}
/** Yaw (prop front +Z -> (sin yaw, cos yaw)) facing the world direction (dx, dz). */
export const yawToward = (dx: number, dz: number): number => Math.atan2(dx, dz);
export function normYaw(a: number): number {
  let y = a % (2 * Math.PI);
  if (y > Math.PI) y -= 2 * Math.PI;
  if (y <= -Math.PI) y += 2 * Math.PI;
  return y;
}
/** The quarter turn nearest a yaw. */
export const quarter = (yaw: number): number => normYaw(Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2));

export const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** Host-local (x, z) -> world, for a host turned by `rot` (three.js Y rotation). */
export function toWorld(host: {x: number; z: number; rot: number}, lx: number, lz: number): [number, number] {
  const c = Math.cos(host.rot), s = Math.sin(host.rot);
  return [host.x + lx * c + lz * s, host.z - lx * s + lz * c];
}
/** World centre of a door rect and the unit normal into `a` from it. */
export function doorPoint(d: Door, a: Area): {x: number; z: number; nx: number; nz: number; side: Side; half: number} {
  const side = doorSide(d, a);
  const x = (d.x + d.w / 2) * CELL, z = (d.y + d.h / 2) * CELL;
  const n = {N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0]}[side];
  return {x, z, nx: n[0], nz: n[1], side, half: (side === 'N' || side === 'S' ? d.w : d.h) * CELL / 2};
}
/** The door joining two areas (either way round). */
export const doorBetween = (layout: StationLayout, a: number, b: number): Door | undefined => layout.doors.find(d => (d.a === a && d.b === b) || (d.a === b && d.b === a));

// ---------------------------------------------------------------------------------------------
// The dresser context

export class AddonDresser {
  readonly ctx: PlaceCtx;
  readonly fr: HallFrame;
  /** Absolute floor height of the hall (its storey). */
  readonly base: number;
  readonly level: number;
  /** The opening from the network into the hall (a door of the hall to an area outside the add-on). */
  readonly entry: Door;
  readonly p0: number;
  readonly skipped: string[] = [];
  readonly placed: PropPlacement[] = [];
  /** The add-on's areas (hall + support rooms). */
  readonly own: ReadonlySet<number>;

  constructor(readonly layout: StationLayout, readonly rng: Rng, readonly addon: SkywaysAddon, readonly hall: Area) {
    this.level = addon.level;
    const own = (this.own = new Set(addon.areas));
    const rooms = addon.areas.map(id => layout.areas[id]).filter(Boolean);
    // masks over every add-on area (+2 cells): the hall and its support rooms
    const win = {x0: Math.min(...rooms.map(a => a.x)) - 3, y0: Math.min(...rooms.map(a => a.y)) - 3, x1: Math.max(...rooms.map(a => a.x + a.w)) + 2, y1: Math.max(...rooms.map(a => a.y + a.h)) + 2};
    this.ctx = makePlaceCtx(layout, rng, this.level, win);
    // (layout-variety pass: a hall reached through its foyer — an add-on area of concourse kind — is entered by that door)
    const outside = (id: number) => !own.has(id) || layout.areas[id]?.kind === 'concourse';
    const ins = layout.doors.filter(d => (d.a === hall.id && outside(d.b)) || (d.b === hall.id && outside(d.a)));
    // the entry: the hall's door nearest the record's entry point
    this.entry = ins.sort((p, q) => dist2(doorPoint(p, hall), addon.entry) - dist2(doorPoint(q, hall), addon.entry))[0];
    this.fr = hallFrame(hall, this.entry ? doorSide(this.entry, hall) : 'S');
    this.base = hall.floorY ?? layout.levels[this.level]?.baseY ?? 0;
    this.p0 = layout.props.length;
  }

  get g() { return this.ctx.g; }

  /** A floor prop through the shared primitive (local height frame); recorded. */
  put(kind: PropKind, x: number, z: number, rot: number, o: PlaceOpts & {area?: Area} = {}): PropPlacement | null {
    const p = tryPlaceProp(this.ctx, o.area ?? this.hall, kind, r3(x), r3(z), r3(rot), o);
    if (p) this.placed.push(p);
    return p;
  }

  /** A round prop (symmetric footprint) at any yaw: placed square, then turned (its collider is the upright cylinder). */
  putRound(kind: PropKind, x: number, z: number, yaw: number, o: PlaceOpts & {area?: Area} = {}): PropPlacement | null {
    const p = this.put(kind, x, z, 0, o);
    if (!p) return null;
    p.rot = r3(normYaw(yaw));
    p.round = true;
    const {hx} = footprint(kind, 0);
    p.hx = p.hz = r3(hx);
    return p;
  }

  /** On-host decor on `host`'s top at host-local (lx, lz) (`top` = support height above the host's base). */
  onTop(host: PropPlacement, kind: PropKind, lx: number, lz: number, top: number, rot = host.rot): PropPlacement | null {
    const hi = this.layout.props.indexOf(host);
    if (hi < 0) return null;
    const [x, z] = toWorld(host, lx, lz);
    const {hx, hz} = footprint(kind, rot);
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r3(host.y + top), rot: r3(rot), area: host.area, hx: r3(hx), hz: r3(hz), h: PROP_DEFS[kind].h, blocksSight: false, variant: 0, host: hi,
      ...(host.level ? {level: host.level} : {})};
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }

  /** A prop pushed without grid masks (mounted / collision boxes the caller checked). */
  push(p: PropPlacement): PropPlacement {
    if (this.level) p.level = this.level;
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }

  /** Is the cell at world (x, z) free floor of `a` (no prop, not reserved)? */
  freeAt(x: number, z: number, a: Area = this.hall): boolean {
    const [cx, cy] = this.g.cellOf(x, z);
    if (!this.g.inBounds(cx, cy)) return false;
    const i = this.g.idx(cx, cy);
    return this.g.cells[i] === FLOOR && this.g.area[i] === a.id && !this.g.blocked[i] && !this.ctx.keep[i];
  }

  // --- keep mask (reserved floor: lanes, door strips, clearances) ---
  keepCell(cx: number, cy: number): void {
    const g = this.g;
    if (!g.inBounds(cx, cy)) return;
    const i = g.idx(cx, cy);
    if (g.cells[i] === FLOOR && this.own.has(g.area[i])) markCell(this.ctx, this.ctx.keep, i);
  }
  /** Cells whose centre lies within `half` of the segment a -> b. */
  keepSegment(ax: number, az: number, bx: number, bz: number, half: number): number {
    const x0 = Math.min(ax, bx) - half, x1 = Math.max(ax, bx) + half, z0 = Math.min(az, bz) - half, z1 = Math.max(az, bz) + half;
    let n = 0;
    for (let cy = Math.floor(z0 / CELL); cy <= Math.floor(z1 / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      if (segDist((cx + 0.5) * CELL, (cy + 0.5) * CELL, ax, az, bx, bz) <= half) { this.keepCell(cx, cy); n++; }
    }
    return n;
  }
  keepDisc(x: number, z: number, r: number): void { this.keepSegment(x, z, x, z, r); }
  /** The `depth` m strip of `a` in front of a door (the door's span +- `side` m). */
  keepDoor(d: Door, a: Area, depth: number, side = 0.5): void {
    const p = doorPoint(d, a), alongX = p.side === 'N' || p.side === 'S';
    const s0 = (alongX ? p.x : p.z) - p.half - side, s1 = (alongX ? p.x : p.z) + p.half + side;
    for (let k = 0; k * CELL < depth; k++) {
      for (let s = s0 + CELL / 2; s < s1; s += CELL) {
        const off = (k + 0.5) * CELL + CELL / 2; // from the door's centre line (it lies in the wall cell) into the room
        const x = alongX ? s : p.x + p.nx * off, z = alongX ? p.z + p.nz * off : s;
        const [cx, cy] = this.g.cellOf(x, z);
        if (this.g.inBounds(cx, cy) && this.g.area[this.g.idx(cx, cy)] === a.id) this.keepCell(cx, cy);
      }
    }
  }

  /** Lifts every prop placed here onto its storey floor (hosted decor follows its host's floor). */
  lift(): void {
    const g = this.g, props = this.layout.props;
    const floorUnder = (p: PropPlacement): number => {
      const [cx, cy] = g.cellOf(p.x, p.z);
      const i = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
      return i >= 0 && g.cells[i] === FLOOR && g.rampIdx[i] < 0 ? g.floorOf(i) : this.base;
    };
    const fl = new Map<PropPlacement, number>();
    for (let k = this.p0; k < props.length; k++) { const p = props[k]; if (p.host === undefined || p.host < this.p0) fl.set(p, floorUnder(p)); }
    for (let k = this.p0; k < props.length; k++) {
      const p = props[k];
      const f = fl.get(p) ?? fl.get(props[p.host!]) ?? this.base;
      p.y = r3(p.y + f);
    }
  }
}

const dist2 = (a: {x: number; z: number}, b: {x: number; z: number}) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
/** Distance from (px, pz) to the segment a -> b. */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
/** A prop's world box as a rect (its AABB footprint). */
export const propRect = (p: PropPlacement): SkywaysRect => ({x0: r3(p.x - p.hx), z0: r3(p.z - p.hz), x1: r3(p.x + p.hx), z1: r3(p.z + p.hz)});
