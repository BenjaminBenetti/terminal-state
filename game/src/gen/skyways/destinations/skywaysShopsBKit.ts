// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-B (C)): the placement context of this lane's ANCHOR dressers
// (destinations/shopsB.ts: garden, arcade, cinema, science, hockey). Pure data (no three.js).
//
// Frame: the anchor's sales floor in (u, v) — u along its storefront wall (from the x0 / z0 end), v depth from it (gen/skyways/addonFrame.ts
// hallFrame). Every floor prop goes through the shared placement primitive (gen/placeKit.ts tryPlaceProp: area cells, door zones, keep
// strips, connectivity) in the storey's LOCAL height frame and is lifted onto its floor at once, so layout.props stays absolute at every
// step: the 3D clearance checks (placeKit.boxClear) then compare like with like — this dresser's props, the other dressers' (already
// absolute) and the storefront glazing. Clear lanes are reserved first (PlaceCtx.keep): the storefront entry to every zone / back-room
// door, so nothing placed later stands in them. Contiguous runs (cinema seat rows, pinball rows, cabinet banks) are placed all-or-nothing
// with touching AABBs (putRow): their cells are blocked and the area must stay connected.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {areaConnected, begin, boxClear, cellsOfBox, ceilOver, commit, makePlaceCtx, markCell, mountProp, rollback, tryPlaceProp, wallSpot,
  type PlaceCtx, type PlaceOpts} from '../../placeKit';
import {isLootHolderKind} from '../../../items/loot';
import type {Area, Door, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {OPP, doorPoint, hallFrame, normYaw, segDist, toWorld, uvXZ, xzUV, type HallFrame} from '../addonFrame';
import {DEST_POSTERS_OF} from './art';
import {DEST_POSTER_BASE_Y} from './kindsLandmarks';
import {HUNG_CLEAR} from './kindsShopsB';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** The quarter turn nearest a yaw (placements stay axis-aligned). */
export const quarterYaw = (yaw: number): number => r3(normYaw(Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2)));

/** Which wall of the frame: L (u = 0), R (u = W), B (the back, v = D), F (the storefront, v = 0). */
export type Wall = 'L' | 'R' | 'B' | 'F';

/** A door of the sales floor other than the storefront, in the frame. */
export interface FloorDoor { d: Door; wall: Wall; u: number; v: number; half: number; to: number }

export class ShopsBDresser {
  readonly ctx: PlaceCtx;
  readonly fr: HallFrame;
  readonly floor: Area;
  readonly level: number;
  /** Absolute floor height of the sales floor and its clear height (to the anchor's ceiling). */
  readonly base: number;
  readonly clear: number;
  /** Every area of the anchor (floor, zones, child floor pieces) — the masks' window. */
  readonly own: ReadonlySet<number>;
  /** The storefront entry: centre along the front (u) and its half width (m). */
  readonly entryU: number;
  readonly entryHalf: number;
  /** The floor's other doors (zones, back rooms) in the frame. */
  readonly doors: FloorDoor[];
  readonly placed: PropPlacement[] = [];
  readonly skipped: string[] = [];
  private readonly p0: number;

  constructor(readonly layout: StationLayout, readonly rng: Rng, readonly anchor: SkywaysAnchor) {
    const floor = (this.floor = layout.areas[anchor.floor]);
    this.level = anchor.level;
    const ids = [anchor.floor, ...anchor.zones, ...layout.areas.filter(a => a.parent === anchor.floor && a.type === 'shop').map(a => a.id)];
    this.own = new Set(ids);
    const rooms = [...this.own].map(id => layout.areas[id]);
    const win = {x0: Math.min(...rooms.map(a => a.x)) - 3, y0: Math.min(...rooms.map(a => a.y)) - 3, x1: Math.max(...rooms.map(a => a.x + a.w)) + 2, y1: Math.max(...rooms.map(a => a.y + a.h)) + 2};
    this.ctx = makePlaceCtx(layout, rng, this.level, win);
    this.fr = hallFrame(floor, anchor.front);
    this.base = floor.floorY ?? layout.levels[this.level]?.baseY ?? 0;
    this.clear = floor.ceil - this.base;
    this.p0 = layout.props.length;
    // the storefront entry (its open span along the opening)
    const sf = layout.storefronts[anchor.storefront];
    const alongX = anchor.front === 'N' || anchor.front === 'S';
    const o0 = alongX ? sf.ox : sf.oy, [e0, e1] = sf.entry;
    const mid = (o0 + (e0 + e1) / 2) * CELL;
    this.entryU = r3(alongX ? mid - this.fr.x0 : mid - this.fr.z0);
    this.entryHalf = r3((e1 - e0) * CELL / 2);
    this.doors = layout.doors.filter(d => !d.shopfront && (d.a === floor.id || d.b === floor.id)).map(d => {
      const p = doorPoint(d, floor);
      const [u, v] = xzUV(this.fr, p.x, p.z);
      return {d, wall: this.wallOf(p.side), u: r3(u), v: r3(v), half: p.half, to: d.a === floor.id ? d.b : d.a};
    });
  }

  get g() { return this.ctx.g; }
  get W() { return this.fr.W; }
  get D() { return this.fr.D; }

  // --- frame ---------------------------------------------------------------------------------
  /** The area side of a frame wall. */
  side(w: Wall, fr: HallFrame = this.fr): Side {
    const alongX = fr.front === 'N' || fr.front === 'S';
    return w === 'F' ? fr.front : w === 'B' ? fr.back : w === 'L' ? (alongX ? 'W' : 'N') : (alongX ? 'E' : 'S');
  }
  wallOf(s: Side, fr: HallFrame = this.fr): Wall {
    return (['F', 'B', 'L', 'R'] as Wall[]).find(w => this.side(w, fr) === s)!;
  }
  /** Yaw of a prop whose back is to frame wall `w` (it faces into the room). */
  faceFrom(w: Wall, fr: HallFrame = this.fr): number {
    return w === 'F' ? fr.toBack : w === 'B' ? fr.toFront : w === 'L' ? fr.plusU : fr.minusU;
  }
  xz(u: number, v: number, fr: HallFrame = this.fr): [number, number] { return uvXZ(fr, u, v); }

  /** Absolute floor height under a world point (the sales floor's base off the grid). */
  floorAt(x: number, z: number): number {
    const g = this.g, [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy)) return this.base;
    const i = g.idx(cx, cy);
    return g.cells[i] === FLOOR && g.rampIdx[i] < 0 ? g.floorOf(i) : this.base;
  }

  // --- reserved floor (keep mask) ----------------------------------------------------------------
  keepCell(cx: number, cy: number): void {
    const g = this.g;
    if (!g.inBounds(cx, cy)) return;
    const i = g.idx(cx, cy);
    if (g.cells[i] === FLOOR && this.own.has(g.area[i])) markCell(this.ctx, this.ctx.keep, i);
  }
  /** Cells whose centre lies within `half` of the world segment a -> b. */
  keepSegment(ax: number, az: number, bx: number, bz: number, half: number): void {
    const x0 = Math.min(ax, bx) - half, x1 = Math.max(ax, bx) + half, z0 = Math.min(az, bz) - half, z1 = Math.max(az, bz) + half;
    for (let cy = Math.floor(z0 / CELL); cy <= Math.floor(z1 / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      if (segDist((cx + 0.5) * CELL, (cy + 0.5) * CELL, ax, az, bx, bz) <= half) this.keepCell(cx, cy);
    }
  }
  /** keepSegment in frame coordinates. */
  keepUV(u0: number, v0: number, u1: number, v1: number, half: number, fr: HallFrame = this.fr): void {
    const [ax, az] = this.xz(u0, v0, fr), [bx, bz] = this.xz(u1, v1, fr);
    this.keepSegment(ax, az, bx, bz, half);
  }
  keepDisc(x: number, z: number, r: number): void { this.keepSegment(x, z, x, z, r); }

  /**
   * The clear walking lanes (>= 1.2 m: cells within `half` of each leg): the storefront entry straight in to `mainTo` (wide over the first
   * 3 m), and from that spine to every other door of the floor — a side-wall door straight across at its depth, a back-wall door along
   * `backV` (default 2.2 m in front of the back wall) and then straight in. The door's own strip stays clear (placeKit door zones).
   */
  reserveLanes(o: {mainTo?: number; backV?: number; half?: number} = {}): void {
    const half = o.half ?? 0.75, u0 = this.entryU;
    const mainTo = Math.min(o.mainTo ?? this.D - 2.0, this.D - 0.6);
    this.keepUV(u0, 0, u0, Math.min(3, mainTo), Math.max(half, Math.min(1.1, this.entryHalf)));
    this.keepUV(u0, 0, u0, mainTo, half);
    for (const fd of this.doors) this.laneTo(fd, o.backV ?? this.D - 2.2, half);
  }
  /** One door's lane from the entry spine. */
  laneTo(fd: FloorDoor, backV: number, half = 0.75): void {
    const u0 = this.entryU, D = this.D;
    if (fd.wall === 'B') {
      const vm = Math.max(1.5, Math.min(D - 1.2, backV));
      this.keepUV(u0, 0, u0, vm, half); this.keepUV(u0, vm, fd.u, vm, half); this.keepUV(fd.u, vm, fd.u, D, half);
    } else if (fd.wall === 'L' || fd.wall === 'R') {
      const v = Math.max(1.2, Math.min(D - 1.0, fd.v));
      this.keepUV(u0, 0, u0, v, half); this.keepUV(u0, v, fd.wall === 'L' ? 0 : this.W, v, half);
    } else {
      this.keepUV(u0, 0.8, fd.u, 0.8, half); this.keepUV(fd.u, 0, fd.u, 1.6, half);
    }
  }

  // --- floor props ------------------------------------------------------------------------------
  /** Open floor of `a` at world (x, z): no prop, not reserved. */
  freeAt(x: number, z: number, a: Area = this.floor): boolean {
    const [cx, cy] = this.g.cellOf(x, z);
    if (!this.g.inBounds(cx, cy)) return false;
    const i = this.g.idx(cx, cy);
    return this.g.cells[i] === FLOOR && this.g.area[i] === a.id && !this.g.blocked[i] && !this.ctx.keep[i];
  }
  /** No prop of this storey intersects the world box (absolute heights). */
  boxFree(x: number, z: number, hx: number, hz: number, y0: number, y1: number): boolean {
    return boxClear(this.ctx, x - hx, x + hx, y0, y1, z - hz, z + hz);
  }

  /** A floor prop at frame (u, v) through the shared primitive, lifted onto its floor; recorded. */
  put(kind: PropKind, u: number, v: number, yaw: number, o: PlaceOpts & {area?: Area; fr?: HallFrame} = {}): PropPlacement | null {
    const [x, z] = this.xz(u, v, o.fr);
    return this.putXZ(kind, x, z, yaw, o);
  }
  putXZ(kind: PropKind, x: number, z: number, yaw: number, o: PlaceOpts & {area?: Area} = {}): PropPlacement | null {
    const rot = quarterYaw(yaw);
    const {hx, hz} = footprint(kind, rot), f = this.floorAt(x, z);
    if (!this.boxFree(x, z, hx, hz, f, f + (o.h ?? PROP_DEFS[kind].h))) return null;
    const {y: _y, ...opts} = o; void _y; // floor props only (a y >= 0.9 would make the primitive treat it as a wall mount)
    const p = tryPlaceProp(this.ctx, o.area ?? this.floor, kind, r3(x), r3(z), rot, opts);
    if (!p) return null;
    p.y = r3(p.y + f);
    this.placed.push(p);
    return p;
  }
  /** A round (symmetric) prop: placed square, collider the upright cylinder. */
  putRound(kind: PropKind, u: number, v: number, yaw: number, o: PlaceOpts & {area?: Area; fr?: HallFrame} = {}): PropPlacement | null {
    const p = this.put(kind, u, v, 0, o);
    if (!p) return null;
    p.rot = r3(normYaw(yaw));
    p.round = true;
    const {hx} = footprint(kind, 0);
    p.hx = p.hz = r3(hx);
    return p;
  }

  /**
   * A contiguous run (seat rows, machine banks): every footprint on free unreserved floor of `a` (no door strip / zone), no 3D overlap with
   * any prop or with each other, then all cells blocked at once; all-or-nothing, and `a` must stay connected (every door reached).
   * `front` (m): the strip in front of each unit must be walkable and is reserved (players / the play space).
   */
  putRow(items: readonly {kind: PropKind; x: number; z: number; rot: number; variant?: number}[], a: Area = this.floor, front = 0): PropPlacement[] {
    if (!items.length) return [];
    const g = this.g, ctx = this.ctx;
    const boxes = items.map(it => {
      const rot = quarterYaw(it.rot), {hx, hz} = footprint(it.kind, rot);
      return {...it, rot, hx, hz, x: r3(it.x), z: r3(it.z), f: this.floorAt(it.x, it.z), h: PROP_DEFS[it.kind].h};
    });
    for (const [k, b] of boxes.entries()) {
      const [x0, y0, x1, y1] = cellsOfBox(b.x, b.z, b.hx, b.hz);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        if (!g.inBounds(cx, cy)) return [];
        const i = g.idx(cx, cy);
        if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || ctx.keep[i] || ctx.edge[i] || ctx.doorCell[i] || ctx.zone[i]) return [];
      }
      if (!this.boxFree(b.x, b.z, b.hx, b.hz, b.f, b.f + b.h)) return [];
      for (let j = 0; j < k; j++) {
        const q = boxes[j];
        if (Math.min(b.x + b.hx, q.x + q.hx) - Math.max(b.x - b.hx, q.x - q.hx) > 0.01 && Math.min(b.z + b.hz, q.z + q.hz) - Math.max(b.z - b.hz, q.z - q.hz) > 0.01) return [];
      }
      if (front > 0) {
        const fx = Math.round(Math.sin(b.rot)), fz = Math.round(Math.cos(b.rot)), hd = PROP_DEFS[b.kind].d / 2, hw = PROP_DEFS[b.kind].w / 2 * 0.8;
        const [s0, s1, s2, s3] = cellsOfBox(b.x + fx * (hd + front / 2), b.z + fz * (hd + front / 2), fx ? front / 2 : hw, fz ? front / 2 : hw);
        for (let cy = s1; cy <= s3; cy++) for (let cx = s0; cx <= s2; cx++) if (!g.walkable(cx, cy)) return [];
      }
    }
    // block the cells (logged in an open transaction); undone by hand when the area would split (never rolls back an outer transaction)
    const set: [Uint8Array, number][] = [];
    const mark = (arr: Uint8Array, i: number) => { if (!arr[i]) { markCell(ctx, arr, i); set.push([arr, i]); } };
    for (const b of boxes) {
      const [x0, y0, x1, y1] = cellsOfBox(b.x, b.z, b.hx, b.hz);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const i = g.idx(cx, cy);
        mark(g.blocked, i);
        if (PROP_DEFS[b.kind].blocksSight) mark(g.sightBlocked, i);
      }
    }
    if (!areaConnected(ctx, a)) { for (const [arr, i] of set) arr[i] = 0; return []; }
    const out: PropPlacement[] = [];
    for (const b of boxes) {
      if (front > 0) {
        const fx = Math.round(Math.sin(b.rot)), fz = Math.round(Math.cos(b.rot)), hd = PROP_DEFS[b.kind].d / 2, hw = PROP_DEFS[b.kind].w / 2 * 0.8;
        const [s0, s1, s2, s3] = cellsOfBox(b.x + fx * (hd + front / 2), b.z + fz * (hd + front / 2), fx ? front / 2 : hw, fz ? front / 2 : hw);
        for (let cy = s1; cy <= s3; cy++) for (let cx = s0; cx <= s2; cx++) if (g.inBounds(cx, cy) && !g.blocked[g.idx(cx, cy)]) markCell(ctx, ctx.keep, g.idx(cx, cy));
      }
      const p: PropPlacement = {kind: b.kind, x: b.x, z: b.z, y: r3(b.f), rot: b.rot, area: a.id, hx: r3(b.hx), hz: r3(b.hz), h: b.h, blocksSight: PROP_DEFS[b.kind].blocksSight, variant: b.variant ?? 0,
        ...(this.level ? {level: this.level} : {})};
      this.layout.props.push(p);
      this.placed.push(p);
      out.push(p);
    }
    return out;
  }

  /**
   * All-or-nothing group: `fn` places a cluster and says whether it is complete; when not, everything it placed (props, blocked / keep
   * cells) is undone. Not nested.
   */
  tx(fn: () => boolean): boolean {
    const n0 = this.placed.length;
    begin(this.ctx);
    if (fn()) { commit(this.ctx); return true; }
    rollback(this.ctx);
    this.placed.length = n0;
    return false;
  }

  /**
   * Units of `kind` side by side with their backs to frame wall `w` from `from` to `to` (m along it), `gap` apart; contiguous runs of `run`
   * (each run starts on a cell boundary: the frame origin is one, so a run never straddles a reserved / blocked cell it could have cleared).
   */
  wallRow(w: Wall, kind: PropKind, from: number, to: number, o: {gap?: number; run?: number; front?: number; variant?: () => number; max?: number; area?: Area; fr?: HallFrame} = {}): PropPlacement[] {
    const fr = o.fr ?? this.fr, a = o.area ?? fr.a, def = PROP_DEFS[kind];
    const out: PropPlacement[] = [];
    const run = Math.max(1, o.run ?? 1), gap = o.gap ?? 0.04, max = o.max ?? 99;
    const up = (t: number) => Math.ceil(t / CELL - 1e-6) * CELL;
    let t = up(from);
    while (t + def.w <= to + 1e-6 && out.length < max) {
      const n0 = Math.min(run, Math.floor((to - t + gap) / (def.w + gap)), max - out.length);
      if (n0 <= 0) break;
      let got: PropPlacement[] = [];
      for (let n = n0; n >= 1 && !got.length; n--) {
        const items = Array.from({length: n}, (_, k) => {
          const s = this.wallSpotUV(fr, w, t + def.w / 2 + k * (def.w + gap), kind);
          return {kind, x: s.x, z: s.z, rot: s.rot, variant: o.variant?.() ?? 0};
        });
        got = n > 1 || o.front ? this.putRow(items, a, o.front ?? 0) : (() => { const p = this.putXZ(kind, items[0].x, items[0].z, items[0].rot, {area: a, variant: items[0].variant}); return p ? [p] : []; })();
        if (run === 1) break;
      }
      if (got.length) { out.push(...got); t = up(t + got.length * (def.w + gap) + (run > 1 ? 0.45 : gap)); } else t += CELL;
    }
    return out;
  }
  /** Position of a prop with its back to frame wall `w` at `t` m along it (from the frame's u = 0 / v = 0 end). */
  wallSpotUV(fr: HallFrame, w: Wall, t: number, kind: PropKind): {x: number; z: number; rot: number} {
    const side = this.side(w, fr);
    const [x, z] = w === 'L' || w === 'R' ? uvXZ(fr, w === 'L' ? 0 : fr.W, t) : uvXZ(fr, t, w === 'F' ? 0 : fr.D);
    const along = side === 'N' || side === 'S' ? x : z;
    return wallSpot(fr.a, side, along, kind);
  }

  // --- host decor, wall mounts, hung pieces -------------------------------------------------------
  /**
   * On-host decor on `host`'s top at host-local (lx, lz), `top` m above the host's base; a loot holder's span is cut out of its top
   * surface (no lot is packed under it). Never on a dynamic host (a prop something rests on never moves).
   */
  onTop(host: PropPlacement, kind: PropKind, lx: number, lz: number, top: number, rot = host.rot): PropPlacement | null {
    const hi = this.layout.props.indexOf(host);
    if (hi < 0 || PROP_DEFS[host.kind].physics?.dynamic) return null;
    const [x, z] = toWorld(host, lx, lz);
    const {hx, hz} = footprint(kind, rot);
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r3(host.y + top), rot: r3(rot), area: host.area, hx: r3(hx), hz: r3(hz), h: PROP_DEFS[kind].h, blocksSight: false, variant: 0, host: hi,
      ...(host.level ? {level: host.level} : {})};
    if (isLootHolderKind(host.kind)) {
      const w = Math.abs(Math.cos(rot - host.rot)) > 0.5 ? PROP_DEFS[kind].w : PROP_DEFS[kind].d;
      host.cut = [...(host.cut ?? []), {y: r3(top), x0: r3(lx - w / 2 - 0.02), x1: r3(lx + w / 2 + 0.02)}];
    }
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }

  /**
   * A wall mount on side `side` of `a` at `t` (world m along it), `y` m above the floor: a backed solid wall clear of props and doorways
   * (placeKit.mountProp) and never over glazing — no Skyways window / boarded entrance of this storey in that wall span.
   */
  mount(a: Area, side: Side, t: number, kind: PropKind, y: number, variant = 0): PropPlacement | null {
    if (this.glazedSpan(a, side, t - PROP_DEFS[kind].w / 2 - 0.1, t + PROP_DEFS[kind].w / 2 + 0.1)) return null;
    const p = mountProp(this.ctx, a, side, t, kind, r3(this.base + y), 0);
    if (!p) return null;
    p.variant = variant;
    if (y < 2) {
      const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) this.keepCell(cx, cy);
    }
    this.placed.push(p);
    return p;
  }

  /** A window / boarded entrance of this storey lies in the wall behind side `side` of `a` over [t0, t1] (world m along it). */
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
   * A ceiling-hung piece: its hang point `hangY` (above its base) 2 cm under the ceiling, its underside >= HUNG_CLEAR above the floor, clear of
   * every prop box and of the ceiling lights' fixtures (horizontal distance >= its half span + `lightGap`).
   */
  hang(a: Area, kind: PropKind, x: number, z: number, hangY: number, lightGap = 0.6): PropPlacement | null {
    const g = this.g, def = PROP_DEFS[kind], {hx, hz} = footprint(kind, 0);
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy) || g.area[g.idx(cx, cy)] !== a.id || g.cells[g.idx(cx, cy)] !== FLOOR || g.rampIdx[g.idx(cx, cy)] >= 0) return null;
    // the whole span over this room's floor
    for (const [px, pz] of [[x - hx, z - hz], [x + hx, z - hz], [x - hx, z + hz], [x + hx, z + hz]]) { const [qx, qy] = g.cellOf(px, pz); if (!g.inBounds(qx, qy) || !this.own.has(g.area[g.idx(qx, qy)])) return null; }
    const ceil = Math.min(ceilOver(this.ctx, x, z, hx, hz), a.ceil);
    const y = r3(ceil - 0.02 - hangY), f = this.floorAt(x, z);
    if (!Number.isFinite(y) || y - f < HUNG_CLEAR || y + def.h > ceil + 1e-6) return null;
    for (const l of this.layout.lights) if ((l.level ?? 0) === this.level && Math.hypot(l.x - x, l.z - z) < Math.max(hx, hz) + lightGap) return null;
    if (!this.boxFree(x, z, hx, hz, y, y + def.h)) return null;
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y, rot: 0, area: a.id, hx: r3(hx), hz: r3(hz), h: def.h, blocksSight: false, variant: 0, mounted: true, ...(this.level ? {level: this.level} : {})};
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }

  /** The family's wall posters (skyDPoster, its art pieces in turn) on the listed frame walls (solid wall only: never glazing / doors). */
  posters(n: number, walls: readonly Wall[] = ['L', 'R', 'B'], a: Area = this.floor, fr: HallFrame = this.fr): PropPlacement[] {
    const pieces = DEST_POSTERS_OF[this.anchor.family], out: PropPlacement[] = [];
    const def = PROP_DEFS.skyDPoster, y = DEST_POSTER_BASE_Y;
    for (let tries = 0; tries < n * 14 && out.length < n; tries++) {
      const w = walls[(out.length + tries) % walls.length], side = this.side(w, fr);
      const len = w === 'L' || w === 'R' ? fr.D : fr.W;
      if (len < def.w + 1.2) continue;
      const t = r3(Math.round(this.rng.range(0.6 + def.w / 2, len - 0.6 - def.w / 2) * 4) / 4);
      const [x, z] = w === 'L' || w === 'R' ? uvXZ(fr, w === 'L' ? 0 : fr.W, t) : uvXZ(fr, t, fr.D);
      if (out.some(p => Math.hypot(p.x - x, p.z - z) < 2.0)) continue;
      const p = this.mount(a, side, side === 'N' || side === 'S' ? x : z, 'skyDPoster', y, pieces[out.length % pieces.length]);
      if (p) out.push(p);
    }
    return out;
  }

  /** Props this dresser placed (layout order). */
  get count(): number { return this.layout.props.length - this.p0; }
  /** A seeded pick of a quarter turn (symmetric pieces). */
  anyYaw(): number { return this.rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]); }
}

/** The opposite frame wall. */
export const OPP_WALL: Readonly<Record<Wall, Wall>> = {L: 'R', R: 'L', B: 'F', F: 'B'};
export {OPP};
