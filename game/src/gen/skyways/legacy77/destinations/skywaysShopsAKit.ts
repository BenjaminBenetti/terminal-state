// FROZEN GAME77 GENERATOR (task studio-skyways-rework-20261107-054512-01): a verbatim snapshot of gen/skyways/destinations/skywaysShopsAKit.ts at main
// be3173d (GAME77), kept ONLY to regenerate Skyways stations a player entered before the rework (layout versions 1 and 2:
// gen/skyways/layoutVersion.ts) byte-identically, so their saved holders / pickups / kills keep matching. Never edit (except a
// shared runtime bug fix that leaves the layout fingerprints of tests/skyways-dest-layout-version.test.ts unchanged).
// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-A (B)): the ANCHOR DRESSING KIT of this lane's five shop families
// (books, outfitter, music, hobby, design: destinations/shopsA.ts). One AnchorKit per anchor (layout.skyways.anchors), on the anchor's
// own rng fork. Pure data (no three.js).
//
// Frame: like the add-on kit (gen/skyways/addonFrame.ts) every prop is placed in its storey's LOCAL height frame through the shared
// placement primitive (gen/placeKit.ts tryPlaceProp: area cells, door zones, keep strips, connectivity) and lifted onto the storey floor
// at the end (AnchorKit.lift). u runs along the shop front (from its x0 / z0 end), v is the depth from the front wall.
// An anchor's sales floor may be several areas on one storey (the pieces round a two-level shop's stair well: child areas of the
// floor), and a second storey (the two-level shop's other floor) — the kit holds one placement context per storey and checks that a
// floor prop never cuts a piece off from the entry / the stair (regionOk).
//
// Reserved floor (PlaceCtx.keep), before the furniture: the entry strip, 1.5 m in front of every door (staff doors, listening booths),
// a disc round each stair mouth, and the WALKING LANES from the entry to every door / zone / the stair mouth — routed over the floor
// left after the centrepieces (Dijkstra on cells with a full 3 x 3 clearance, a turn penalty: aisle-like L runs), then widened to
// SHOPS_A_LANE_HALF either side. Lanes are recorded (QA / tests).

import type {Rng} from '../../../../core/rng';
import {CELL, FLOOR, type Grid} from '../../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../../props';
import {WALL_ROT, backed, begin, commit, makePlaceCtx, markCell, rollback, tryPlaceProp, wallRange, wallSpot, wallXZ, type PlaceCtx, type PlaceOpts} from '../../../placeKit';
import type {Area, Door, Side, StationLayout} from '../../../stationTypes';
import type {SkywaysAnchor} from '../../skywaysTypes';
import {hallFrame, normYaw, segDist, toWorld, uvXZ, xzUV, type HallFrame} from '../addonFrame';
import {DEST_POSTERS_OF} from './art';
import {DEST_POSTER_BASE_Y} from '../../destinations/kindsLandmarks';

export const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** Half width of the reserved walking lanes (m): >= 1.2 m clear lanes. */
export const SHOPS_A_LANE_HALF = 0.7;
/** Clear floor kept in front of every door of the anchor (m) and round each stair mouth. */
export const SHOPS_A_DOOR_CLEAR = 1.5;
export const SHOPS_A_STAIR_CLEAR = 1.4;

export interface ShopsALane { level: number; to: 'door' | 'zone' | 'stair' | 'aisle'; pts: [number, number][]; half: number; narrow?: boolean }

interface Storey { level: number; ctx: PlaceCtx; g: Grid; areas: Area[]; ids: Set<number>; base: number; doors: Door[] }

const N_OF: Record<Side, [number, number]> = {N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0]};

/** Undo an open transaction back to a savepoint (its mask log length and the props count then). */
function undoTo(ctx: PlaceCtx, mark: number, props: number): void {
  const log = ctx.tx.log;
  if (log) { for (let k = log.length - 1; k >= mark; k--) { const [arr, i, v] = log[k]; arr[i] = v; } log.length = mark; }
  ctx.layout.props.length = props;
}
/** A centre coordinate moved so the footprint's low edge sits on a cell line (props packed side by side then share no cell). */
export const snapEdge = (c: number, half: number): number => r3(Math.round((c - half) / CELL) * CELL + half);

export class AnchorKit {
  readonly fr: HallFrame;
  readonly storeys = new Map<number, Storey>();
  /** The entrance storey and (two-level) the other one. */
  readonly level: number;
  readonly other: number | null;
  /** The storefront entry: centre of the entry span on the front wall line, its inward normal, half width (m). */
  readonly entry: {x: number; z: number; nx: number; nz: number; half: number};
  /** Stair mouths per storey (two-level: the internal stair's stand points). */
  readonly mouths = new Map<number, {x: number; z: number}>();
  readonly zones: Area[];
  readonly p0: number;
  readonly placed: PropPlacement[] = [];
  readonly lanes: ShopsALane[] = [];
  readonly skipped: string[] = [];

  constructor(readonly layout: StationLayout, readonly rng: Rng, readonly an: SkywaysAnchor) {
    const A = layout.areas;
    this.level = an.level;
    this.zones = an.zones.map(id => A[id]).filter(Boolean);
    const zoneIds = new Set(an.zones);
    const floor = A[an.floor];
    const sales = [floor, ...A.filter(a => a.parent === an.floor && a.type === 'shop' && !zoneIds.has(a.id))];
    const upper = an.upper !== undefined ? A[an.upper] : undefined;
    const ups = upper ? [upper, ...A.filter(a => a.parent === upper.id && a.type === 'shop')] : [];
    this.other = upper ? (upper.level ?? 0) : null;
    const all = [...sales, ...this.zones, ...ups];
    const win = {x0: Math.min(...all.map(a => a.x)) - 4, y0: Math.min(...all.map(a => a.y)) - 4, x1: Math.max(...all.map(a => a.x + a.w)) + 4, y1: Math.max(...all.map(a => a.y + a.h)) + 4};
    const mk = (level: number, areas: Area[]): Storey => {
      const ctx = makePlaceCtx(layout, rng, level, win), ids = new Set(areas.map(a => a.id));
      return {level, ctx, g: ctx.g, areas, ids, base: areas[0].floorY ?? layout.levels[level]?.baseY ?? 0,
        doors: layout.doors.filter(d => (ids.has(d.a) || ids.has(d.b)) && !d.shopfront)};
    };
    this.storeys.set(this.level, mk(this.level, [...sales, ...this.zones]));
    if (upper && this.other !== null) this.storeys.set(this.other, mk(this.other, ups));
    // frame: the bounding box of the entrance storey's sales pieces
    const bx0 = Math.min(...sales.map(a => a.x)), by0 = Math.min(...sales.map(a => a.y));
    const bx1 = Math.max(...sales.map(a => a.x + a.w)), by1 = Math.max(...sales.map(a => a.y + a.h));
    this.fr = hallFrame({...floor, x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0}, an.front);
    // entry: the storefront's open span
    const sf = layout.storefronts[an.storefront];
    const along = sf.oh === 1;
    const e0 = sf.entry[0], e1 = sf.entry[1];
    const t = ((along ? sf.ox : sf.oy) + (e0 + e1) / 2) * CELL;
    const n = N_OF[an.front];
    this.entry = {x: along ? t : (sf.ox + 0.5) * CELL, z: along ? (sf.oy + 0.5) * CELL : t, nx: n[0], nz: n[1], half: (e1 - e0) * CELL / 2};
    // stair mouths (the internal stair's stand points inside the anchor's rect)
    const r = an.rect, inside = (p: {x: number; z: number}) => p.x > r.x0 - 1 && p.x < r.x1 + 1 && p.z > r.z0 - 1 && p.z < r.z1 + 1;
    if (this.other !== null) {
      const link = layout.levelLinks.find(k => k.kind === 'stairs' && inside(k.bottom) && inside(k.top));
      if (link) { this.mouths.set(link.lower, {x: link.bottom.x, z: link.bottom.z}); this.mouths.set(link.upper, {x: link.top.x, z: link.top.z}); }
    }
    this.p0 = layout.props.length;
  }

  st(level = this.level): Storey { return this.storeys.get(level)!; }
  /** The kit's area at world (x, z) on a storey (a sales piece / zone of this anchor), or null. */
  areaAt(x: number, z: number, level = this.level): Area | null {
    const s = this.st(level), [cx, cy] = s.g.cellOf(x, z);
    if (!s.g.inBounds(cx, cy)) return null;
    const id = s.g.area[s.g.idx(cx, cy)];
    return s.ids.has(id) ? this.layout.areas[id] : null;
  }
  /** Entry point `d` m inside the shop (on the entry's axis). */
  inside(d: number): [number, number] { return [this.entry.x + this.entry.nx * d, this.entry.z + this.entry.nz * d]; }

  // --- placement ---------------------------------------------------------------------------------------------------------------

  /** A floor prop through the shared primitive (local height frame) on its storey; never cuts the storey's pieces apart. */
  put(kind: PropKind, x: number, z: number, rot: number, o: PlaceOpts & {area?: Area; level?: number} = {}): PropPlacement | null {
    const level = o.level ?? this.level, s = this.st(level);
    const area = o.area ?? this.areaAt(x, z, level);
    if (!area || !s.ids.has(area.id)) return null;
    const multi = s.areas.filter(a => !this.zones.includes(a)).length > 1;
    const own = s.ctx.tx.depth === 0;
    if (own) begin(s.ctx);
    const mark = s.ctx.tx.log!.length, n0 = this.layout.props.length;
    let p = tryPlaceProp(s.ctx, area, kind, r3(x), r3(z), r3(normYaw(rot)), o);
    // (a piece cut off from the entry / the stair, or a box overlapping a neighbour's by more than 1 cm — the cell test lets a box reach
    // 4 cm into a free cell: undone back to the savepoint, the open cluster kept)
    if (p && (this.overlaps(p, level) || (multi && !this.regionOk(level)))) { undoTo(s.ctx, mark, n0); p = null; }
    if (own) commit(s.ctx);
    if (p) this.placed.push(p);
    return p;
  }
  /** All-or-nothing: `fn` places a group on one storey; false rolls back everything it placed / reserved there. */
  cluster(fn: () => boolean, level = this.level): boolean {
    const s = this.st(level), n = this.placed.length;
    if (s.ctx.tx.depth > 0) return fn(); // (already inside a cluster: the outer one decides)
    begin(s.ctx);
    const ok = fn();
    if (ok) commit(s.ctx);
    else { rollback(s.ctx); this.placed.length = n; }
    return ok;
  }
  /** Every cell of a world box is free floor (walkable, not reserved) of the storey's pieces. */
  boxFree(x0: number, z0: number, x1: number, z1: number, level = this.level, keepOk = false): boolean {
    const s = this.st(level), g = s.g;
    for (let cy = Math.floor((z0 + 0.02) / CELL); cy <= Math.floor((z1 - 0.02) / CELL); cy++) for (let cx = Math.floor((x0 + 0.02) / CELL); cx <= Math.floor((x1 - 0.02) / CELL); cx++) {
      if (!g.inBounds(cx, cy)) return false;
      const i = g.idx(cx, cy);
      if (g.cells[i] !== FLOOR || g.blocked[i] || !s.ids.has(g.area[i]) || (!keepOk && s.ctx.keep[i]) || s.ctx.edge[i]) return false;
    }
    return true;
  }
  /** Wall spots (solid wall behind a `kind`) of the storey's pieces, nearest (x, z) first. */
  wallSpots(kind: PropKind, x: number, z: number, level = this.level, sides?: Side[], turn = 0): {a: Area; side: Side; t: number; x: number; z: number; rot: number}[] {
    const s = this.st(level), def = PROP_DEFS[kind], out: {a: Area; side: Side; t: number; x: number; z: number; rot: number}[] = [];
    // (turn +-PI/2: a piece whose long X side runs from the wall into the room — the bed's headboard end to the wall)
    const span = turn ? def.d : def.w, depth = turn ? def.w : def.d;
    for (const a of s.areas.filter(q => !this.zones.includes(q))) for (const side of sides ?? (['N', 'S', 'E', 'W'] as Side[])) {
      const [lo, hi] = wallRange(a, side);
      for (let t = lo + 0.3 + span / 2; t <= hi - 0.3 - span / 2; t += 0.25) {
        if (!this.solidWall(a, side, t, kind, level, span)) continue;
        const [wx, wz] = wallXZ(a, side, t, depth / 2 + 0.03);
        const sp = turn ? {x: wx, z: wz, rot: normYaw(WALL_ROT[side] + turn)} : wallSpot(a, side, t, kind);
        out.push({a, side, t, ...sp});
      }
    }
    return out.sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z));
  }
  /** Tries `kind` against the walls nearest (x, z) (at most `tries` spots); the placement or null. */
  putNearWall(kind: PropKind, x: number, z: number, o: {level?: number; front?: number; variant?: number; tries?: number; sides?: Side[]} = {}): PropPlacement | null {
    const level = o.level ?? this.level;
    let n = 0;
    for (const sp of this.wallSpots(kind, x, z, level, o.sides)) {
      if (n++ >= (o.tries ?? 60)) break;
      const p = this.put(kind, sp.x, sp.z, sp.rot, {level, area: sp.a, front: o.front, variant: o.variant});
      if (p) return p;
    }
    return null;
  }
  /** A round prop at any yaw (placed square, then turned; its collider is the upright cylinder). */
  putRound(kind: PropKind, x: number, z: number, yaw: number, o: PlaceOpts & {area?: Area; level?: number} = {}): PropPlacement | null {
    const p = this.put(kind, x, z, 0, o);
    if (!p) return null;
    p.rot = r3(normYaw(yaw));
    p.round = true;
    const {hx} = footprint(kind, 0);
    p.hx = p.hz = r3(hx);
    return p;
  }
  /** Loose decor standing on `host` at host-local (lx, lz), `top` m above the host's base; the caller checks fit / overlap. */
  onTop(host: PropPlacement, kind: PropKind, lx: number, lz: number, top: number, rot = host.rot): PropPlacement | null {
    const hi = this.layout.props.indexOf(host);
    if (hi < 0) return null;
    const [x, z] = toWorld(host, lx, lz);
    const {hx, hz} = footprint(kind, rot);
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r3(host.y + top), rot: r3(normYaw(rot)), area: host.area, hx: r3(hx), hz: r3(hz), h: PROP_DEFS[kind].h,
      blocksSight: false, variant: 0, host: hi, ...(host.level ? {level: host.level} : {})};
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }
  /** A prop pushed without grid masks (mounted / hung pieces the caller checked). */
  push(p: PropPlacement, level = this.level): PropPlacement {
    if (level) p.level = level;
    this.layout.props.push(p);
    this.placed.push(p);
    return p;
  }

  /** A standing prop's box overlaps another standing prop's box of the storey (by more than 1 cm). */
  overlaps(p: PropPlacement, level: number): boolean {
    for (const q of this.layout.props) {
      if (q === p || q.mounted || q.host !== undefined || (q.level ?? 0) !== level) continue;
      if (Math.abs(q.x - p.x) < q.hx + p.hx - 0.01 && Math.abs(q.z - p.z) < q.hz + p.hz - 0.01) return true;
    }
    return false;
  }
  /** Every free cell of the storey's sales pieces is reachable from its way in (the entry / the stair mouth), every door touched. */
  regionOk(level: number): boolean {
    const s = this.st(level), g = s.g;
    const ok = (i: number) => g.cells[i] === FLOOR && !g.blocked[i] && s.ids.has(g.area[i]);
    const start = this.startCell(level);
    if (start < 0) return true;
    const seen = new Uint8Array(g.w * g.h), stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      for (const n of [c - 1, c + 1, c - g.w, c + g.w]) if (!seen[n] && ok(n)) { seen[n] = 1; stack.push(n); }
    }
    for (const a of s.areas) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = g.idx(x, y);
      if (ok(i) && !seen[i]) return false;
    }
    return true;
  }
  /** The free cell of the storey's pieces nearest its way in (-1: none). */
  startCell(level: number): number {
    const s = this.st(level), g = s.g;
    const [px, pz] = level === this.level ? this.inside(1.25) : [this.mouths.get(level)?.x ?? NaN, this.mouths.get(level)?.z ?? NaN];
    if (!Number.isFinite(px)) return -1;
    const [cx, cy] = g.cellOf(px, pz);
    for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !g.inBounds(cx + dx, cy + dy)) continue;
      const i = g.idx(cx + dx, cy + dy);
      if (g.cells[i] === FLOOR && !g.blocked[i] && s.ids.has(g.area[i])) return i;
    }
    return -1;
  }

  // --- reserved floor ----------------------------------------------------------------------------------------------------------

  keepCell(cx: number, cy: number, level = this.level): void {
    const s = this.st(level), g = s.g;
    if (!g.inBounds(cx, cy)) return;
    const i = g.idx(cx, cy);
    if (g.cells[i] === FLOOR && s.ids.has(g.area[i])) markCell(s.ctx, s.ctx.keep, i);
  }
  keepSegment(ax: number, az: number, bx: number, bz: number, half: number, level = this.level): void {
    const x0 = Math.min(ax, bx) - half, x1 = Math.max(ax, bx) + half, z0 = Math.min(az, bz) - half, z1 = Math.max(az, bz) + half;
    for (let cy = Math.floor(z0 / CELL); cy <= Math.floor(z1 / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      if (segDist((cx + 0.5) * CELL, (cy + 0.5) * CELL, ax, az, bx, bz) <= half) this.keepCell(cx, cy, level);
    }
  }
  keepDisc(x: number, z: number, r: number, level = this.level): void { this.keepSegment(x, z, x, z, r, level); }
  /** Free cells of a world box (a room set's footprint + its margin) reserved. */
  keepBox(x0: number, z0: number, x1: number, z1: number, level = this.level): void {
    const s = this.st(level);
    for (let cy = Math.floor(z0 / CELL); cy <= Math.floor((z1 - 1e-6) / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor((x1 - 1e-6) / CELL); cx++) {
      if (s.g.inBounds(cx, cy) && !s.g.blocked[s.g.idx(cx, cy)]) this.keepCell(cx, cy, level);
    }
  }
  /** The door's inside point `d` m into the kit's area it opens onto (and that area). */
  doorIn(door: Door, level: number, d: number, areaId?: number): {x: number; z: number; area: Area} | null {
    const s = this.st(level);
    const mine = areaId !== undefined ? (s.ids.has(areaId) ? areaId : -1) : s.ids.has(door.a) ? door.a : s.ids.has(door.b) ? door.b : -1;
    if (mine < 0) return null;
    const area = this.layout.areas[mine];
    const cx = (door.x + door.w / 2) * CELL, cz = (door.y + door.h / 2) * CELL;
    const side: Side = door.h === 1 && door.w > 1 ? (door.y < area.y ? 'N' : 'S') : door.w === 1 && door.h > 1 ? (door.x < area.x ? 'W' : 'E') : door.y < area.y ? 'N' : door.y >= area.y + area.h ? 'S' : door.x < area.x ? 'W' : 'E';
    const n = N_OF[side];
    return {x: cx + n[0] * d, z: cz + n[1] * d, area};
  }
  /** Reserves the entry strip, every door's strip and the stair mouths (call first). */
  reserveDoors(): void {
    const E = this.entry, tx = -E.nz, tz = E.nx;
    for (let d = 0.25; d <= 2.6; d += 0.25) this.keepSegment(E.x + E.nx * d - tx * (E.half + 0.5), E.z + E.nz * d - tz * (E.half + 0.5), E.x + E.nx * d + tx * (E.half + 0.5), E.z + E.nz * d + tz * (E.half + 0.5), 0.26);
    for (const [level, s] of this.storeys) {
      for (const door of s.doors) {
        // the strip in front of the door, on each of the kit's areas it opens onto
        for (const side of [door.a, door.b]) {
          if (!s.ids.has(side)) continue;
          const a = this.doorIn(door, level, 0, side)!, b = this.doorIn(door, level, SHOPS_A_DOOR_CLEAR, side)!;
          const half = Math.max(door.w, door.h) * CELL / 2 + 0.25;
          const alongX = door.h === 1 && door.w > 1;
          for (const off of [-half, 0, half]) this.keepSegment(a.x + (alongX ? off : 0), a.z + (alongX ? 0 : off), b.x + (alongX ? off : 0), b.z + (alongX ? 0 : off), 0.3, level);
        }
      }
      const m = this.mouths.get(level);
      if (m) this.keepDisc(m.x, m.z, SHOPS_A_STAIR_CLEAR, level);
    }
  }

  // --- lanes ---------------------------------------------------------------------------------------------------------------------

  /** Lanes from the way in to every door / zone / the stair mouth of each storey (after the centrepieces, before the rest). */
  reserveLanes(): void {
    for (const [level, s] of this.storeys) {
      const from = level === this.level ? this.inside(1.25) : this.mouths.has(level) ? [this.mouths.get(level)!.x, this.mouths.get(level)!.z] as [number, number] : null;
      if (!from) continue;
      const targets: {x: number; z: number; to: ShopsALane['to']}[] = [];
      for (const door of s.doors) {
        const zone = this.zones.some(z => z.id === door.a || z.id === door.b);
        const fromSide = [door.a, door.b].find(id => s.ids.has(id) && !this.zones.some(z => z.id === id));
        const p = fromSide !== undefined ? this.doorIn(door, level, 1.0, fromSide) : null;
        if (p) targets.push({x: p.x, z: p.z, to: zone ? 'zone' : 'door'});
      }
      const m = this.mouths.get(level);
      if (m && level === this.level) targets.push({x: m.x, z: m.z, to: 'stair'});
      // the main aisle: in from the entry to the back of the floor (the shop's spine; dense fixtures fill round it)
      if (level === this.level) { const [x, z] = this.uv(this.uE, this.fr.D - 1.6); targets.push({x, z, to: 'aisle'}); }
      for (const t of targets) {
        let path = this.route(level, from, [t.x, t.z], true), narrow = false;
        if (!path) { path = this.route(level, from, [t.x, t.z], false); narrow = true; }
        if (!path) { if (t.to !== 'aisle') this.skipped.push(`lane to ${t.to} at ${t.x.toFixed(1)},${t.z.toFixed(1)}`); continue; }
        // (reserved a little wider than the recorded half width: the cells diagonal to the path's corners / ends — 0.71 m — are kept too)
        for (let k = 1; k < path.length; k++) this.keepSegment(path[k - 1][0], path[k - 1][1], path[k][0], path[k][1], SHOPS_A_LANE_HALF + 0.06, level);
        this.lanes.push({level, to: t.to, pts: path.map(([x, z]) => [r3(x), r3(z)] as [number, number]), half: SHOPS_A_LANE_HALF, ...(narrow ? {narrow} : {})});
      }
    }
  }

  /**
   * A lane path (world points: start, the turns, the end) from `a` to `b` over the storey's pieces: Dijkstra on cells (4-neighbour,
   * +4 per turn), every cell of it with its 3 x 3 neighbourhood walkable (`wide`) — a 1.5 m clear band — else any walkable cell.
   */
  route(level: number, a: [number, number], b: [number, number], wide: boolean): [number, number][] | null {
    const s = this.st(level), g = s.g, W = g.w;
    const free = (i: number) => g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0;
    const node = (i: number) => {
      if (!free(i) || !s.ids.has(g.area[i])) return false;
      if (!wide) return true;
      for (const o of [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]) if (g.cells[i + o] !== FLOOR || g.blocked[i + o]) return false;
      return true;
    };
    const near = (p: [number, number]): number => {
      const [cx, cy] = g.cellOf(p[0], p[1]);
      for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !g.inBounds(cx + dx, cy + dy)) continue;
        if (node(g.idx(cx + dx, cy + dy))) return g.idx(cx + dx, cy + dy);
      }
      return -1;
    };
    const si = near(a), ti = near(b);
    if (si < 0 || ti < 0) return null;
    const DIRS = [1, -1, W, -W], TURN = 4;
    const dist = new Map<number, number>(), prev = new Map<number, number>();
    const heap: [number, number][] = [];
    const push = (st: number, d: number) => { heap.push([d, st]); let k = heap.length - 1; while (k > 0) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; } };
    const pop = (): [number, number] => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; }
      }
      return top;
    };
    for (let d = 0; d < 4; d++) { dist.set(si * 4 + d, 0); push(si * 4 + d, 0); }
    let end = -1, steps = 0;
    while (heap.length && steps++ < 200000) {
      const [d0, st] = pop();
      if (d0 > (dist.get(st) ?? Infinity)) continue;
      const c = st >> 2, dir = st & 3;
      if (c === ti) { end = st; break; }
      for (let nd = 0; nd < 4; nd++) {
        const n = c + DIRS[nd];
        if (!node(n)) continue;
        const nst = n * 4 + nd, cost = d0 + 1 + (nd === dir ? 0 : TURN);
        if (cost < (dist.get(nst) ?? Infinity)) { dist.set(nst, cost); prev.set(nst, st); push(nst, cost); }
      }
    }
    if (end < 0) return null;
    const cells: number[] = [];
    for (let st: number | undefined = end; st !== undefined; st = prev.get(st)) cells.push(st >> 2);
    cells.reverse();
    // the turns
    const pts: [number, number][] = [];
    const ctr = (i: number): [number, number] => [((i % W) + 0.5) * CELL, (Math.floor(i / W) + 0.5) * CELL];
    for (let k = 0; k < cells.length; k++) {
      if (k === 0 || k === cells.length - 1 || cells[k] - cells[k - 1] !== cells[k + 1] - cells[k]) pts.push(ctr(cells[k]));
    }
    return pts;
  }
  /** Is (x, z) on a recorded lane of the storey (within its half width + pad)? */
  onLane(x: number, z: number, level = this.level, pad = 0): boolean {
    return this.lanes.some(l => l.level === level && l.pts.some((p, k) => k > 0 && segDist(x, z, l.pts[k - 1][0], l.pts[k - 1][1], p[0], p[1]) <= l.half + pad));
  }

  // --- walls ---------------------------------------------------------------------------------------------------------------------

  /** An exterior window of the storey behind the wall span [t0, t1] of `a`'s `side` below height `y1` (m above the floor). */
  windowAt(a: Area, side: Side, t0: number, t1: number, y1: number, level = this.level): boolean {
    const wins = (this.layout.skyways?.windows ?? []).filter(w => w.level === level);
    if (!wins.length) return false;
    const [wx, wz] = wallXZ(a, side, (t0 + t1) / 2, -CELL / 2);
    const along = side === 'N' || side === 'S';
    const sx0 = along ? t0 : wx - CELL / 2, sx1 = along ? t1 : wx + CELL / 2, sz0 = along ? wz - CELL / 2 : t0, sz1 = along ? wz + CELL / 2 : t1;
    return wins.some(w => w.x0 < sx1 + 0.05 && w.x1 > sx0 - 0.05 && w.z0 < sz1 + 0.05 && w.z1 > sz0 - 0.05 && w.sill < y1);
  }
  /** Solid wall (no opening / glazing / aperture / window) behind a prop of `kind` centred at `t` on `a`'s `side`. */
  solidWall(a: Area, side: Side, t: number, kind: PropKind, level = this.level, span = PROP_DEFS[kind].w): boolean {
    const s = this.st(level), def = PROP_DEFS[kind];
    const t0 = t - span / 2, t1 = t + span / 2;
    if (!backed(s.ctx, a, side, t0, t1, s.base + 0.05) || !backed(s.ctx, a, side, t0, t1, s.base + Math.min(def.h, 2.2) - 0.05)) return false;
    return !this.windowAt(a, side, t0, t1, Math.min(def.h, 2.4), level);
  }
  /**
   * A run of `kind` with its back to the walls of the storey's pieces (every side, or `sides`), clusters of `cluster` separated by
   * `gap` m; only spots with a solid wall behind. Returns the placements.
   */
  wallRun(kind: PropKind, o: {level?: number; sides?: Side[]; areas?: Area[]; front?: number; cluster?: number; gap?: number; max?: number; variant?: () => number; skip?: (x: number, z: number) => boolean} = {}): PropPlacement[] {
    const level = o.level ?? this.level, s = this.st(level), def = PROP_DEFS[kind], out: PropPlacement[] = [];
    for (const a of o.areas ?? s.areas.filter(q => !this.zones.includes(q))) {
      for (const side of o.sides ?? (['N', 'S', 'E', 'W'] as Side[])) {
        const [lo, hi] = wallRange(a, side);
        let t = lo + 0.35 + def.w / 2, inCluster = 0;
        while (t + def.w / 2 <= hi - 0.35 && out.length < (o.max ?? 999)) {
          const sp = wallSpot(a, side, t, kind);
          const ok = this.solidWall(a, side, t, kind, level) && !(o.skip?.(sp.x, sp.z) ?? false);
          const p = ok ? this.put(kind, sp.x, sp.z, sp.rot, {level, area: a, front: o.front, variant: o.variant?.()}) : null;
          if (p) {
            out.push(p);
            t += def.w + 0.02;
            if (o.cluster && ++inCluster >= o.cluster) { t += o.gap ?? 0.8; inCluster = 0; }
          } else { t += 0.25; inCluster = 0; }
        }
      }
    }
    return out;
  }

  /** Family posters on solid walls (never over glazing / windows / a door, nothing standing in front), spread out; returns them. */
  posters(max: number, level = this.level): PropPlacement[] {
    const s = this.st(level), def = PROP_DEFS.skyDPoster, y0 = DEST_POSTER_BASE_Y, y1 = y0 + def.h, out: PropPlacement[] = [];
    const vars = DEST_POSTERS_OF[this.an.family];
    const props = this.layout.props.filter(p => (p.level ?? 0) === level);
    const cands: {a: Area; side: Side; t: number}[] = [];
    for (const a of s.areas) for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
      const [lo, hi] = wallRange(a, side);
      for (let t = lo + 0.75; t <= hi - 0.75; t += 0.5) {
        if (!backed(s.ctx, a, side, t - def.w / 2, t + def.w / 2, s.base + y0 + 0.05) || !backed(s.ctx, a, side, t - def.w / 2, t + def.w / 2, s.base + y1 - 0.05)) continue;
        if (this.windowAt(a, side, t - def.w / 2, t + def.w / 2, y1 + 0.1, level)) continue;
        const along = side === 'N' || side === 'S';
        const [fx, fz] = wallXZ(a, side, t, 0.45);
        const fhx = along ? def.w / 2 + 0.3 : 0.45, fhz = along ? 0.45 : def.w / 2 + 0.3;
        if (props.some(p => Math.abs(p.x - fx) < p.hx + fhx && Math.abs(p.z - fz) < p.hz + fhz)) continue;
        // the wall cell behind must be the kit's own room wall (not a door cell of another room)
        const [cx, cy] = s.g.cellOf(...wallXZ(a, side, t, 0.25));
        if (!s.g.inBounds(cx, cy) || s.ctx.doorCell[s.g.idx(cx, cy)]) continue;
        cands.push({a, side, t});
      }
    }
    for (const c of this.rng.shuffle(cands)) {
      if (out.length >= max) break;
      if (out.some(o => Math.hypot(o.x - wallXZ(c.a, c.side, c.t, 0)[0], o.z - wallXZ(c.a, c.side, c.t, 0)[1]) < 2.4)) continue;
      const [x, z] = wallXZ(c.a, c.side, c.t, def.d / 2 + 0.004);
      const {hx, hz} = footprint('skyDPoster', WALL_ROT[c.side]);
      out.push(this.push({kind: 'skyDPoster', x: r3(x), z: r3(z), y: r3(y0), rot: WALL_ROT[c.side], area: c.a.id, hx: r3(hx), hz: r3(hz), h: def.h, blocksSight: false,
        variant: vars[out.length % vars.length], mounted: true}, level));
    }
    return out;
  }

  // --- frame helpers -------------------------------------------------------------------------------------------------------------

  uv(u: number, v: number): [number, number] { return uvXZ(this.fr, u, v); }
  toUV(x: number, z: number): [number, number] { return xzUV(this.fr, x, z); }
  /** The entry's u in the frame. */
  get uE(): number { return this.toUV(this.entry.x, this.entry.z)[0]; }

  /** Lifts every prop placed here onto its storey floor (hosted decor follows its host's floor). */
  lift(): void {
    const props = this.layout.props;
    const floorUnder = (p: PropPlacement): number => {
      const s = this.storeys.get(p.level ?? 0);
      const g = s?.g;
      if (!g || !s) return 0;
      const [cx, cy] = g.cellOf(p.x, p.z);
      const i = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
      return i >= 0 && g.cells[i] === FLOOR && g.rampIdx[i] < 0 ? g.floorOf(i) : s.base;
    };
    const fl = new Map<PropPlacement, number>();
    for (let k = this.p0; k < props.length; k++) { const p = props[k]; if (p.host === undefined || p.host < this.p0) fl.set(p, floorUnder(p)); }
    for (let k = this.p0; k < props.length; k++) {
      const p = props[k];
      const f = fl.get(p) ?? fl.get(props[p.host!]) ?? this.st(p.level ?? this.level)?.base ?? 0;
      p.y = r3(p.y + f);
    }
  }
}
