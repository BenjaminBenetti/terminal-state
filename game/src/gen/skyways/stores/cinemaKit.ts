// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-CINEMA): the placement kit of the Aurora Picture House's dresser
// (stores/cinemaDress.ts). Pure data (no three.js).
//
// Why its own kit (not destinations/skywaysShopsBKit.ts): at layout version 3 a store's back room may be INSET in the lobby band (carve.ts
// insetBack), which splits the lobby into the sales floor area and one or more child pieces (parent = the floor). One open room, several
// area ids: the auditorium door can open off a piece while it is recorded against the floor. This kit works on REGIONS — a set of area
// ids dressed as one room (the lobby = the floor + its pieces; the auditorium; a back room) — in one (u, v) frame over the region's
// bounding rect (gen/skyways/addonFrame.ts hallFrame: u along the storefront side, v depth from it):
//  - a floor prop may stand on any cells of its region (never straddling into another room); its `area` is the area under its centre;
//  - the region stays CONNECTED as one room (every free cell reachable, every door of the region still touched), checked over the union
//    (placeKit.areaConnected checks one area id: it would refuse every non-trivial placement in the floor when its zone door opens off a
//    piece);
//  - the rest is the shared primitive's rules (gen/placeKit.ts tryPlaceProp): free / unreserved floor, door cells and zones, stair edges,
//    3D clearance (boxClear), openable access strips (OPENABLE_FRONT), stocked displays' open front, walkway rings; wall mounts and wall
//    backing are placeKit.mountProp itself.
// Every placement is journaled: tx() / save() + restore() undo props and cell marks exactly (all-or-nothing clusters).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, SOLID} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {OPENABLE_FRONT, STOCK_DISPLAY_KINDS, STOCK_OPEN_FRONT, boxClear, cellsOfBox, makePlaceCtx, mountProp, type PlaceCtx} from '../../placeKit';
import {isLootHolderKind} from '../../../items/loot';
import type {Area, Door, Side, SignPlacement, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {hallFrame, normYaw, segDist, toWorld, uvXZ, xzUV, type HallFrame} from '../addonFrame';

export const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** The quarter turn nearest a yaw (placements stay axis-aligned). */
export const quarterYaw = (yaw: number): number => r3(normYaw(Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2)));

/** A frame wall: L (u = 0), R (u = W), B (the back, v = D), F (the front, v = 0). */
export type Wall = 'L' | 'R' | 'B' | 'F';

/** A door of a region (not its storefront) in the region's frame: centre, the unit normal INTO the region, half width, the other area. */
export interface RegionDoor { d: Door; u: number; v: number; nu: number; nv: number; half: number; to: number; staff: boolean }

/** A dressed room: its area ids, its frame, its floor height, its doors. */
export interface Region {
  name: string;
  ids: ReadonlySet<number>;
  fr: HallFrame;
  base: number;
  /** Every door touching the region (incl. the storefront) — the connectivity check keeps each one reachable. */
  allDoors: Door[];
  /** Its doors other than the storefront, in the frame. */
  doors: RegionDoor[];
  /** Cell window (inclusive) of the region's rect + 1. */
  win: {x0: number; y0: number; x1: number; y1: number};
}

export interface PutOpts {
  /** Clear access strip in front (m). */
  front?: number;
  /** Walkway ring kept all round (m). */
  ring?: number;
  variant?: number;
  /** Per-holder loot key (PropPlacement.purpose: the ramen precedent). */
  purpose?: string;
  doorOk?: boolean;
  /** Skip the door-zone rule (1 m round every door): only for pieces that belong beside a door (a bin, a cabinet by the frame). */
  zoneOk?: boolean;
}

export class CinemaKit {
  readonly ctx: PlaceCtx;
  readonly level: number;
  readonly floor: Area;
  readonly lobby: Region;
  readonly placed: PropPlacement[] = [];
  readonly skipped: string[] = [];
  /** The storefront entry: centre along the front (u, lobby frame) and its half width (m). */
  readonly entryU: number;
  readonly entryHalf: number;
  private readonly p0: number;
  /** The journal: every mask cell this kit set (0 -> 1), in order. */
  private readonly marks: [Uint8Array, number][] = [];

  constructor(readonly layout: StationLayout, readonly rng: Rng, readonly anchor: SkywaysAnchor) {
    this.floor = layout.areas[anchor.floor];
    this.level = anchor.level;
    const zones = new Set(anchor.zones);
    const lobbyIds = [anchor.floor, ...layout.areas.filter(a => a.parent === anchor.floor && a.type === 'shop' && !zones.has(a.id)).map(a => a.id)];
    const rooms = [...lobbyIds, ...anchor.zones, ...anchor.stock].map(id => layout.areas[id]).filter(Boolean);
    const win = {x0: Math.min(...rooms.map(a => a.x)) - 3, y0: Math.min(...rooms.map(a => a.y)) - 3, x1: Math.max(...rooms.map(a => a.x + a.w)) + 2, y1: Math.max(...rooms.map(a => a.y + a.h)) + 2};
    this.ctx = makePlaceCtx(layout, rng, this.level, win);
    this.p0 = layout.props.length;
    this.lobby = this.region('lobby', lobbyIds, anchor.front);
    // the storefront entry (its open span along the opening)
    const sf = layout.storefronts[anchor.storefront];
    const alongX = anchor.front === 'N' || anchor.front === 'S';
    const o0 = alongX ? sf.ox : sf.oy, [e0, e1] = sf.entry;
    const mid = (o0 + (e0 + e1) / 2) * CELL;
    this.entryU = r3(alongX ? mid - this.lobby.fr.x0 : mid - this.lobby.fr.z0);
    this.entryHalf = r3((e1 - e0) * CELL / 2);
  }

  get g() { return this.ctx.g; }

  // --- regions ----------------------------------------------------------------------------------
  /** A region over `ids` (its frame: front side `front` of the ids' bounding rect). */
  region(name: string, ids: readonly number[], front: Side): Region {
    const as = ids.map(id => this.layout.areas[id]);
    const x0 = Math.min(...as.map(a => a.x)), y0 = Math.min(...as.map(a => a.y)), x1 = Math.max(...as.map(a => a.x + a.w)), y1 = Math.max(...as.map(a => a.y + a.h));
    const box: Area = {...as[0], x: x0, y: y0, w: x1 - x0, h: y1 - y0};
    const fr = hallFrame(box, front), set = new Set(ids), g = this.g;
    const base = as[0].floorY ?? this.layout.levels[this.level]?.baseY ?? 0;
    const allDoors = this.layout.doors.filter(d => this.touches(d, set));
    const doors: RegionDoor[] = [];
    for (const d of allDoors) {
      if (d.shopfront) continue;
      const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
      // the normal into the region: the side of the door's line with the region's cells
      let nx = 0, nz = 0;
      if (d.h === 1 && d.w >= 1) nz = this.inSet(set, Math.floor(cx), d.y - 1) ? -1 : 1;
      else nx = this.inSet(set, d.x - 1, Math.floor(cy)) ? -1 : 1;
      const [u, v] = xzUV(fr, cx * CELL, cy * CELL), [u2, v2] = xzUV(fr, cx * CELL + nx, cy * CELL + nz);
      const to = set.has(d.a) ? d.b : d.a;
      doors.push({d, u: r3(u), v: r3(v), nu: Math.round(u2 - u), nv: Math.round(v2 - v), half: (d.h === 1 ? d.w : d.h) * CELL / 2, to, staff: !!(d as {staff?: boolean}).staff});
    }
    void g;
    return {name, ids: set, fr, base, allDoors, doors, win: {x0: x0 - 1, y0: y0 - 1, x1: x1, y1: y1}};
  }
  /** Does door `d` open onto a cell of the set (a cell beside its rect)? */
  private touches(d: Door, set: ReadonlySet<number>): boolean {
    for (let y = d.y - 1; y <= d.y + d.h; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (this.inSet(set, x, y)) return true;
    return false;
  }
  private inSet(set: ReadonlySet<number>, x: number, y: number): boolean {
    const g = this.g;
    return g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR && set.has(g.area[g.idx(x, y)]);
  }
  /** The area of a region under a world point (null: not the region's floor). */
  areaAt(rg: Region, x: number, z: number): Area | null {
    const g = this.g, [cx, cy] = g.cellOf(x, z);
    return this.inSet(rg.ids, cx, cy) ? this.layout.areas[g.area[g.idx(cx, cy)]] : null;
  }
  xz(rg: Region, u: number, v: number): [number, number] { return uvXZ(rg.fr, u, v); }
  uv(rg: Region, x: number, z: number): [number, number] { return xzUV(rg.fr, x, z); }
  /** Yaw of a prop with its back to frame wall `w` (facing into the room). */
  faceFrom(rg: Region, w: Wall): number { return w === 'F' ? rg.fr.toBack : w === 'B' ? rg.fr.toFront : w === 'L' ? rg.fr.plusU : rg.fr.minusU; }
  /** The world side of a frame wall. */
  side(rg: Region, w: Wall): Side {
    const fr = rg.fr, alongX = fr.front === 'N' || fr.front === 'S';
    return w === 'F' ? fr.front : w === 'B' ? fr.back : w === 'L' ? (alongX ? 'W' : 'N') : (alongX ? 'E' : 'S');
  }

  // --- journal --------------------------------------------------------------------------------
  private mark(arr: Uint8Array, i: number): void { if (!arr[i]) { arr[i] = 1; this.marks.push([arr, i]); } }
  save(): [number, number, number] { return [this.layout.props.length, this.placed.length, this.marks.length]; }
  restore(s: [number, number, number]): void {
    for (let k = this.marks.length - 1; k >= s[2]; k--) { const [arr, i] = this.marks[k]; arr[i] = 0; }
    this.marks.length = s[2];
    this.layout.props.length = s[0];
    this.placed.length = s[1];
  }
  /** All-or-nothing cluster: `fn` says whether it is complete; when not, everything it placed / reserved is undone. */
  tx(fn: () => boolean): boolean {
    const s = this.save();
    if (fn()) return true;
    this.restore(s);
    return false;
  }

  // --- reserved floor (keep) ------------------------------------------------------------------------
  keepCell(rg: Region, cx: number, cy: number): void {
    if (this.inSet(rg.ids, cx, cy)) this.mark(this.ctx.keep, this.g.idx(cx, cy));
  }
  /** Reserve the region's cells whose centre lies within `half` of the frame segment (u0, v0) -> (u1, v1). */
  keepUV(rg: Region, u0: number, v0: number, u1: number, v1: number, half: number): void {
    const [ax, az] = this.xz(rg, u0, v0), [bx, bz] = this.xz(rg, u1, v1);
    const x0 = Math.min(ax, bx) - half, x1 = Math.max(ax, bx) + half, z0 = Math.min(az, bz) - half, z1 = Math.max(az, bz) + half;
    for (let cy = Math.floor(z0 / CELL); cy <= Math.floor(z1 / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      if (segDist((cx + 0.5) * CELL, (cy + 0.5) * CELL, ax, az, bx, bz) <= half) this.keepCell(rg, cx, cy);
    }
  }
  /** The approach point of a door (0.9 m in front of it, inside the region). */
  approach(dr: RegionDoor, off = 0.9): [number, number] { return [r3(dr.u + dr.nu * off), r3(dr.v + dr.nv * off)]; }
  /** A lane from (u0, v0) to a door: across at `vRun` to the door's approach line, then straight to its opening. */
  laneToDoor(rg: Region, u0: number, v0: number, vRun: number, dr: RegionDoor, half = 0.75): void {
    const [au, av] = this.approach(dr);
    if (dr.nu !== 0) {
      // a door in a side wall: along v to its depth, across to it
      this.keepUV(rg, u0, v0, u0, av, half); this.keepUV(rg, u0, av, dr.u, dr.v, half);
    } else {
      this.keepUV(rg, u0, v0, u0, vRun, half); this.keepUV(rg, u0, vRun, au, vRun, half); this.keepUV(rg, au, vRun, au, av, half); this.keepUV(rg, au, av, dr.u, dr.v, half);
    }
  }

  // --- floor props -----------------------------------------------------------------------------------
  /** Floor height (absolute) under a world point of the region. */
  floorAt(rg: Region, x: number, z: number): number {
    const g = this.g, [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy)) return rg.base;
    const i = g.idx(cx, cy);
    return g.cells[i] === FLOOR && g.rampIdx[i] < 0 ? g.floorOf(i) : rg.base;
  }

  put(rg: Region, kind: PropKind, u: number, v: number, yaw: number, o: PutOpts = {}): PropPlacement | null {
    const [x, z] = this.xz(rg, u, v);
    return this.putXZ(rg, kind, x, z, yaw, o);
  }

  /** A floor prop at world (x, z) on the region's floor (the rules in the header); recorded and journaled. */
  putXZ(rg: Region, kind: PropKind, x: number, z: number, yaw: number, o: PutOpts = {}): PropPlacement | null {
    const g = this.g, ctx = this.ctx, def = PROP_DEFS[kind];
    const rot = quarterYaw(yaw);
    const {hx, hz} = footprint(kind, rot);
    x = r3(x); z = r3(z);
    const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!this.inSet(rg.ids, cx, cy)) return null;
      const i = g.idx(cx, cy);
      if (g.blocked[i] || ctx.keep[i] || ctx.edge[i] || g.rampIdx[i] >= 0) return null;
      if (ctx.doorCell[i] && !o.doorOk) return null;
      if (ctx.zone[i] && !o.zoneOk) return null;
    }
    const area = this.areaAt(rg, x, z);
    if (!area) return null;
    const f = this.floorAt(rg, x, z);
    if (!boxClear(ctx, x - hx, x + hx, f, f + def.h, z - hz, z + hz)) return null;
    // walkway ring
    let ring: [number, number, number, number] | null = null;
    if (o.ring) {
      const rc = Math.max(1, Math.ceil(o.ring / CELL - 1e-6));
      ring = [x0 - rc, y0 - rc, x1 + rc, y1 + rc];
      for (let cy = ring[1]; cy <= ring[3]; cy++) for (let cx = ring[0]; cx <= ring[2]; cx++) {
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) continue;
        if (!g.walkable(cx, cy)) return null;
        const i = g.idx(cx, cy);
        if (ctx.keep[i] && !rg.ids.has(g.area[i])) return null;
      }
    }
    // access strip in front (openables: their swing / drawer strip over the full width)
    let strip: [number, number, number, number] | null = null;
    const swing = OPENABLE_FRONT[kind] ?? 0, fx = Math.round(Math.sin(rot)), fz = Math.round(Math.cos(rot));
    if (o.front || swing) {
      const hd = def.d / 2, fl = Math.max(o.front ?? 0, swing), hw = swing ? def.w / 2 - 0.02 : def.w / 2 * 0.8;
      strip = cellsOfBox(x + fx * (hd + fl / 2), z + fz * (hd + fl / 2), fx ? fl / 2 : hw, fz ? fl / 2 : hw);
      for (let cy = strip[1]; cy <= strip[3]; cy++) for (let cx = strip[0]; cx <= strip[2]; cx++) if (!g.walkable(cx, cy)) return null;
    }
    // stocked displays: no wall within 1.5 m in front
    if (STOCK_DISPLAY_KINDS.has(kind)) {
      const hd = def.d / 2, fl = STOCK_OPEN_FRONT, hw = def.w / 2 * 0.8;
      const [c0, c1, c2, c3] = cellsOfBox(x + fx * (hd + fl / 2), z + fz * (hd + fl / 2), fx ? fl / 2 : hw, fz ? fl / 2 : hw);
      for (let cy = c1; cy <= c3; cy++) for (let cx = c0; cx <= c2; cx++) if (g.get(cx, cy) === SOLID) return null;
    }
    const s = this.save();
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); this.mark(g.blocked, i); if (def.blocksSight) this.mark(g.sightBlocked, i); }
    if (!this.connected(rg)) { this.restore(s); return null; }
    if (strip) for (let cy = strip[1]; cy <= strip[3]; cy++) for (let cx = strip[0]; cx <= strip[2]; cx++) if (g.inBounds(cx, cy)) this.mark(ctx.keep, g.idx(cx, cy));
    if (ring) for (let cy = ring[1]; cy <= ring[3]; cy++) for (let cx = ring[0]; cx <= ring[2]; cx++) if (g.inBounds(cx, cy) && !g.blocked[g.idx(cx, cy)]) this.mark(ctx.keep, g.idx(cx, cy));
    const p: PropPlacement = {kind, x, z, y: r3(f), rot, area: area.id, hx: r3(hx), hz: r3(hz), h: def.h, blocksSight: def.blocksSight, variant: o.variant ?? 0,
      ...(this.level ? {level: this.level} : {}), ...(o.purpose ? {purpose: o.purpose} : {})};
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }
  /** A round (symmetric) prop: placed square, its collider the upright cylinder. */
  putRound(rg: Region, kind: PropKind, u: number, v: number, yaw: number, o: PutOpts = {}): PropPlacement | null {
    const p = this.put(rg, kind, u, v, 0, o);
    if (!p) return null;
    p.rot = r3(normYaw(yaw));
    p.round = true;
    const {hx} = footprint(kind, 0);
    p.hx = p.hz = r3(hx);
    return p;
  }
  /** Contiguous units (seat rows, counter runs): all or nothing. */
  putRow(rg: Region, items: readonly {kind: PropKind; x: number; z: number; rot: number; variant?: number}[], o: PutOpts = {}): PropPlacement[] {
    const out: PropPlacement[] = [];
    const ok = items.length > 0 && this.tx(() => items.every(it => { const p = this.putXZ(rg, it.kind, it.x, it.z, it.rot, {...o, variant: it.variant ?? o.variant}); if (p) out.push(p); return !!p; }));
    return ok ? out : [];
  }

  /**
   * The region still one room: every free cell of its areas reachable from every other (4-neighbour, over the union of its area ids)
   * and every door touching it still touched by a reachable cell (a door already cut off before this kit placed anything is ignored).
   */
  private connected(rg: Region): boolean {
    const g = this.g, {x0, y0, x1, y1} = rg.win;
    const free = (x: number, y: number) => { if (x < x0 || x > x1 || y < y0 || y > y1 || !g.inBounds(x, y)) return false; const i = g.idx(x, y); return g.cells[i] === FLOOR && !g.blocked[i] && rg.ids.has(g.area[i]); };
    const seen = new Uint8Array((x1 - x0 + 1) * (y1 - y0 + 1));
    const at = (x: number, y: number) => (y - y0) * (x1 - x0 + 1) + (x - x0);
    let total = 0, sx = -1, sy = -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (free(x, y)) { total++; if (sx < 0) { sx = x; sy = y; } }
    if (!total) return false;
    const stack: number[] = [sx, sy];
    seen[at(sx, sy)] = 1;
    let count = 0;
    while (stack.length) {
      const y = stack.pop()!, x = stack.pop()!;
      count++;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (free(nx, ny) && !seen[at(nx, ny)]) { seen[at(nx, ny)] = 1; stack.push(nx, ny); }
    }
    if (count !== total) return false;
    for (const d of rg.allDoors) {
      let touch = false;
      for (let y = d.y - 1; y <= d.y + d.h && !touch; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (free(x, y) && seen[at(x, y)]) { touch = true; break; }
      if (!touch) return false;
    }
    return true;
  }
  /** Drop the doors no free cell touches before dressing (so the check never refuses everything). */
  settleDoors(rg: Region): void {
    const keep: Door[] = [];
    for (const d of rg.allDoors) { const one = {...rg, allDoors: [d]}; if (this.connectedDoorsOnly(one)) keep.push(d); }
    rg.allDoors.length = 0;
    rg.allDoors.push(...keep);
  }
  private connectedDoorsOnly(rg: Region): boolean {
    const g = this.g, d = rg.allDoors[0];
    for (let y = d.y - 1; y <= d.y + d.h; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) {
      if (!g.inBounds(x, y)) continue;
      const i = g.idx(x, y);
      if (g.cells[i] === FLOOR && !g.blocked[i] && rg.ids.has(g.area[i])) return true;
    }
    return false;
  }

  /**
   * Units of `kind` with their backs to frame wall `w` from `from` to `to` (m along it), `gap` apart (one at a time; each unit's own
   * checks). Stops after `max`.
   */
  wallRow(rg: Region, w: Wall, kind: PropKind, from: number, to: number, o: PutOpts & {gap?: number; max?: number; variant?: number; step?: number} = {}): PropPlacement[] {
    const def = PROP_DEFS[kind], out: PropPlacement[] = [], gap = o.gap ?? 0.04, max = o.max ?? 99;
    const up = (t: number) => Math.ceil(t / CELL - 1e-6) * CELL;
    for (let t = up(from); t + def.w <= to + 1e-6 && out.length < max;) {
      const p = this.atWall(rg, w, t + def.w / 2, kind, o);
      if (p) { out.push(p); t = up(t + def.w + gap); } else t += o.step ?? CELL;
    }
    return out;
  }
  /** A prop with its back to frame wall `w`, centred `t` m along it (3 cm off the wall face). */
  atWall(rg: Region, w: Wall, t: number, kind: PropKind, o: PutOpts = {}, off = 0): PropPlacement | null {
    const fr = rg.fr, dd = PROP_DEFS[kind].d / 2 + 0.03 + off;
    const [u, v] = w === 'L' ? [dd, t] : w === 'R' ? [fr.W - dd, t] : w === 'B' ? [t, fr.D - dd] : [t, dd];
    return this.put(rg, kind, u, v, this.faceFrom(rg, w), o);
  }

  // --- host decor, wall mounts, signs ------------------------------------------------------------------
  /**
   * On-host decor on `host`'s top at host-local (lx, lz), `top` m above the host's base; a loot holder's span is cut out of its top
   * surface (no lot is packed under it). Never on a dynamic host.
   */
  onTop(host: PropPlacement, kind: PropKind, lx: number, lz: number, top: number, rot = host.rot): PropPlacement | null {
    const hi = this.layout.props.indexOf(host);
    if (hi < 0 || PROP_DEFS[host.kind].physics?.dynamic) return null;
    const [x, z] = toWorld(host, lx, lz);
    const {hx, hz} = footprint(kind, rot);
    const y = r3(host.y + top);
    if (!boxClear(this.ctx, x - hx, x + hx, y, y + PROP_DEFS[kind].h, z - hz, z + hz, new Set([host]))) return null;
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y, rot: r3(rot), area: host.area, hx: r3(hx), hz: r3(hz), h: PROP_DEFS[kind].h, blocksSight: false, variant: 0, host: hi,
      ...(host.level ? {level: host.level} : {})};
    if (isLootHolderKind(host.kind)) {
      const w = Math.abs(Math.cos(rot - host.rot)) > 0.5 ? PROP_DEFS[kind].w : PROP_DEFS[kind].d;
      host.cut = [...(host.cut ?? []), {y: r3(top), x0: r3(lx - w / 2 - 0.02), x1: r3(lx + w / 2 + 0.02)}];
    }
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }

  /** A window / boarded entrance of this storey in the wall behind side `side` of `a` over [t0, t1] (world m along it). */
  glazedSpan(a: Area, side: Side, t0: number, t1: number): boolean {
    const alongX = side === 'N' || side === 'S';
    const c = side === 'N' ? a.y * CELL - CELL / 2 : side === 'S' ? (a.y + a.h) * CELL + CELL / 2 : side === 'W' ? a.x * CELL - CELL / 2 : (a.x + a.w) * CELL + CELL / 2;
    for (const w of this.layout.skyways?.windows ?? []) {
      if (w.level !== this.level) continue;
      const [s0, s1, q0, q1] = alongX ? [w.x0, w.x1, w.z0, w.z1] : [w.z0, w.z1, w.x0, w.x1];
      if (s1 > t0 + 1e-6 && s0 < t1 - 1e-6 && c >= q0 - CELL / 2 - 1e-6 && c <= q1 + CELL / 2 + 1e-6) return true;
    }
    return false;
  }
  /**
   * A wall mount on frame wall `w` of the region at `t` m along it, `y` m above its floor: on the area whose own rect side IS that wall
   * there (placeKit.mountProp: solid backing, clear of props / doorways, under the ceiling), never over glazing.
   */
  mount(rg: Region, w: Wall, t: number, kind: PropKind, y: number, variant = 0): PropPlacement | null {
    const side = this.side(rg, w), fr = rg.fr;
    const [u, v] = w === 'L' ? [0.25, t] : w === 'R' ? [fr.W - 0.25, t] : w === 'B' ? [t, fr.D - 0.25] : [t, 0.25];
    const [x, z] = this.xz(rg, u, v), a = this.areaAt(rg, x, z);
    if (!a) return null;
    const edge = side === 'N' ? a.y * CELL : side === 'S' ? (a.y + a.h) * CELL : side === 'W' ? a.x * CELL : (a.x + a.w) * CELL;
    const want = side === 'N' ? fr.z0 : side === 'S' ? fr.z1 : side === 'W' ? fr.x0 : fr.x1;
    if (Math.abs(edge - want) > 1e-6) return null;
    return this.mountOn(a, side, side === 'N' || side === 'S' ? x : z, kind, y, variant);
  }
  /** A wall mount on side `side` of area `a` at world `t` along it, `y` m above the region floor. */
  mountOn(a: Area, side: Side, t: number, kind: PropKind, y: number, variant = 0): PropPlacement | null {
    if (this.glazedSpan(a, side, t - PROP_DEFS[kind].w / 2 - 0.1, t + PROP_DEFS[kind].w / 2 + 0.1)) return null;
    const base = a.floorY ?? this.layout.levels[this.level]?.baseY ?? 0;
    const n0 = this.layout.props.length;
    const p = mountProp(this.ctx, a, side, r3(t), kind, r3(base + y), 0);
    if (!p) return null;
    p.variant = variant;
    if (this.layout.props.length !== n0 + 1) return p;
    this.placed.push(p);
    if (y < 2) {
      const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (this.g.inBounds(cx, cy)) this.mark(this.ctx.keep, this.g.idx(cx, cy));
    }
    return p;
  }
  /** A sign plate on frame wall `w` (its face into the room) at `t` m along it, centre `y` m above the floor (absolute y). */
  wallSign(rg: Region, w: Wall, t: number, y: number, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>): SignPlacement | null {
    const fr = rg.fr, [u, v] = w === 'L' ? [0.02, t] : w === 'R' ? [fr.W - 0.02, t] : w === 'B' ? [t, fr.D - 0.02] : [t, 0.02];
    const [x, z] = this.xz(rg, u, v);
    const [ix, iz] = this.xz(rg, w === 'L' ? 0.3 : w === 'R' ? fr.W - 0.3 : u, w === 'B' ? fr.D - 0.3 : w === 'F' ? 0.3 : v);
    const a = this.areaAt(rg, ix, iz);
    if (!a) return null;
    const sign: SignPlacement = {...s, x: r3(x), y: r3(rg.base + y), z: r3(z), rot: this.faceFrom(rg, w), area: a.id, ...(this.level ? {level: this.level} : {})};
    this.layout.signs.push(sign);
    return sign;
  }
  /** A sign over a door, on the region's side of its wall (its face into the region), centre `y` m up. */
  doorSign(rg: Region, dr: RegionDoor, y: number, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>): SignPlacement | null {
    const [x, z] = this.xz(rg, dr.u + dr.nu * 0.27, dr.v + dr.nv * 0.27);
    const [ix, iz] = this.xz(rg, dr.u + dr.nu * 0.75, dr.v + dr.nv * 0.75);
    const a = this.areaAt(rg, ix, iz);
    if (!a) return null;
    // the plate's face points along the door's normal into the region
    const [nx, nz] = ((): [number, number] => { const [bx, bz] = this.xz(rg, dr.u, dr.v); return [x - bx, z - bz]; })();
    const sign: SignPlacement = {...s, x: r3(x), y: r3(rg.base + y), z: r3(z), rot: r3(Math.atan2(nx, nz)), area: a.id, ...(this.level ? {level: this.level} : {})};
    this.layout.signs.push(sign);
    return sign;
  }

  /** Props this kit placed. */
  get count(): number { return this.layout.props.length - this.p0; }
}
