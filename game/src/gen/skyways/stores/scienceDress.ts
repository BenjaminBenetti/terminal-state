// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-SCIENCE): BIG SKY WONDERS — the Skyways science / discovery store's
// version-3 dresser (stores/science.ts SkywaysStoreSpec.dress). Formats: double height (7.5 m clear, ~60 %) or a plain hall (3.9-4.3 m).
//
// One believable store, front to back (u along the storefront, v the depth from it; the frame spans the WHOLE footprint, so the sales
// floor's pieces round an inset stock room — carve.ts, layout version 3 — are one floor to the dresser):
//  - the ENTRY SPINE straight in to the CENTREPIECE: the fibreglass rocket on its pad under the hanging SOLAR SYSTEM (the destinations'
//    planet mobile, hung half as large again in the double-height void, smaller in a hall: the placement's h records the scale; a second
//    one turned a quarter in a wide double-height store) with the big floor globes beside it;
//  - TELESCOPES on tripods at the storefront windows either side of the entry, aimed out through the glass (the wooden refractor + the
//    Office reflector);
//  - the CASH DESK on the roomier side near the front: a shop counter (till, register) and the Mall glass counter (gadgets / torch cells)
//    facing the floor, the staff aisle behind them and the Mall cash-wrap BACK COUNTER (5 drawers + a cupboard: openable) on the wall;
//  - the TECH WALL beyond it: device shelving (torch cells / batteries: the Mall electronics rows);
//  - the KIT WALL on the other side: open shelving whose tiers carry boxed kits, microscopes and chemistry glassware as separate loose
//    stock (rule 4), the tin robot kit beside it, the CHEMISTRY / CRYSTAL / ROBOT kit posters above it;
//  - the STAR-MAP WALL at the back: the framed Codex star-chart mural (high and large in the double height), the two glass SPECIMEN
//    CABINETS (Mall display cabinets: hinged glass doors, openable) under / beside it;
//  - the HANDS-ON DEMO BENCH: the Office lab bench (15 drawers, openable) as an island, microscope / flasks / racks on its worktop, the
//    periodic-table chart on the nearest wall; display tables of kits and glassware, a satellite model;
//  - BACK ROOMS (every v3 store has one): the station dresser's shelving / cartons / crates stay; this adds openable stock — cardboard
//    cartons, storage totes, staff lockers (a filing cabinet in an office). No back room (older carves): a staff stock corner behind
//    the cash desk instead.
//
// Every floor prop goes through the shared placement primitive (destinations/skywaysShopsBKit.ts ShopsBDresser: area cells, door zones,
// keep strips, connectivity); the walking lanes (entry spine, routes to every staff door, the staff aisle) are reserved first. Loot
// (docs/skyways-stores/science.md): the areas' purposes (stores/science.ts) + per-holder overrides for the tech holders; the openable
// containers roll their own tables. No floor piles (v3 noFloorLoot).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, SHELF_TIER_Y, SHOP_COUNTER_TOP_Y, footprint, type PropKind, type PropPlacement} from '../../props';
import {WALL_ROT, backed, boxClear, cellsOfBox, ceilOver, doorSide, propBlocksDoorway} from '../../placeKit';
import {stockVariant} from '../../purposeShapes';
import type {Area, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {doorPoint, hallFrame, uvXZ, xzUV, type HallFrame} from '../addonFrame';
import {HUNG_CLEAR, PLANET_MOBILE_HANG} from '../destinations/kindsShopsB';
import {ShopsBDresser, type Wall} from '../destinations/skywaysShopsBKit';
import {SCI_POSTER_VARIANTS} from './kinds/science';

/** Per-holder loot override of the tech holders (the till's glass counter, the device shelving): the Mall electronics store's rows. */
export const SCIENCE_TECH_PURPOSE = 'mall-electronics';
/** The destinations' poster art piece of this family (art.ts DEST_POSTER_PIECES 'science': "The Northern Sky" star chart). */
const SCIENCE_DEST_POSTER = 7;
/** Hung solar system: target underside (m above the floor) in the double height / in a hall (>= HUNG_CLEAR), the scale caps. */
export const SCIENCE_MOBILE = {underDouble: 3.3, underHall: 2.35, maxScale: 1.6, minScale: 0.55} as const;
/** The star-map mural's scale and its bottom edge (m above the floor) in the double height / in a hall. */
export const SCIENCE_MURAL = {double: {s: 1.5, y: 2.3}, hall: {s: 1.0, y: 0.85}} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const snap = (v: number) => Math.round(v * 2) / 2;
const upCell = (t: number) => Math.ceil(t / CELL - 1e-6) * CELL;

/** What one anchor got (tests / QA): every prop by role, the pieces that found no room. */
export interface ScienceResult {
  family: 'science';
  format: string;
  props: PropPlacement[];
  till: PropPlacement[]; register: PropPlacement | null; cashwrap: PropPlacement | null;
  tech: PropPlacement[]; kits: PropPlacement[]; kitStock: PropPlacement[]; robot: PropPlacement | null;
  specimen: PropPlacement[]; starMap: PropPlacement | null;
  demo: PropPlacement | null; demoStock: PropPlacement[]; chart: PropPlacement | null; tables: PropPlacement[]; tableStock: PropPlacement[];
  rocket: PropPlacement | null; mobiles: PropPlacement[]; globes: PropPlacement[]; telescopes: PropPlacement[]; satellite: PropPlacement | null;
  posters: PropPlacement[]; back: PropPlacement[]; stockCorner: PropPlacement[];
  /** The reserved routes (frame cells -> world points) from the entry to each staff door. */
  routes: {x: number; z: number}[][];
  skipped: string[];
}
/** The results (tests / QA) per generated layout and anchor: scienceResultOf(layout, anchor). Bounded (the newest few dozen). */
export const SCIENCE_LAST = new Map<string, ScienceResult>();
const resultKey = (layout: Pick<StationLayout, 'seed' | 'attempt'>, anchor: Pick<SkywaysAnchor, 'id'>) => `${layout.seed}:${layout.attempt ?? 0}:${anchor.id}`;
/** What the dresser did for one anchor of one generated layout (undefined: not generated in this process / evicted). */
export const scienceResultOf = (layout: Pick<StationLayout, 'seed' | 'attempt'>, anchor: Pick<SkywaysAnchor, 'id'>): ScienceResult | undefined => SCIENCE_LAST.get(resultKey(layout, anchor));

/** Distance (m) from a wall to the back face of a counter run with `backD`-deep units against that wall (a >= 0.95 m staff aisle). */
const counterBack = (backD: number): number => Math.ceil((0.03 + backD + 0.95) / CELL - 1e-6) * CELL;
const REGISTER_X = r3(PROP_DEFS.shopCounter.w / 2 - PROP_DEFS.cashRegister.w / 2 - 0.12);
const other = (w: 'L' | 'R'): 'L' | 'R' => (w === 'L' ? 'R' : 'L');

/** Dresses one Big Sky Wonders anchor; returns the props placed. */
export function dressScienceStore(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  const s = new Sci(layout, rng, anchor);
  s.dress();
  SCIENCE_LAST.delete(resultKey(layout, anchor));
  SCIENCE_LAST.set(resultKey(layout, anchor), s.res);
  while (SCIENCE_LAST.size > 64) SCIENCE_LAST.delete(SCIENCE_LAST.keys().next().value!);
  return s.d.count;
}

class Sci {
  readonly d: ShopsBDresser;
  readonly fr: HallFrame;
  readonly pieces: Area[];
  readonly ids: ReadonlySet<number>;
  readonly NW: number;
  readonly ND: number;
  readonly entryU: number;
  readonly entryHalf: number;
  readonly double: boolean;
  /** Staff doors from the floor (any piece) into the back rooms: the frame point just inside each. */
  readonly doors: {u: number; v: number; to: number; piece: Area}[];
  readonly res: ScienceResult;

  constructor(readonly layout: StationLayout, readonly rng: Rng, readonly anchor: SkywaysAnchor) {
    const d = (this.d = new ShopsBDresser(layout, rng, anchor));
    const floor = layout.areas[anchor.floor];
    this.pieces = [floor, ...layout.areas.filter(a => a.parent === floor.id && a.type === 'shop' && !anchor.zones.includes(a.id))];
    this.ids = new Set(this.pieces.map(a => a.id));
    // the frame over the whole footprint (the pieces' bounding box, in cells)
    const x0 = Math.min(...this.pieces.map(a => a.x)), y0 = Math.min(...this.pieces.map(a => a.y));
    const x1 = Math.max(...this.pieces.map(a => a.x + a.w)), y1 = Math.max(...this.pieces.map(a => a.y + a.h));
    this.fr = hallFrame({...floor, x: x0, y: y0, w: x1 - x0, h: y1 - y0}, anchor.front);
    this.NW = Math.round(this.fr.W / CELL);
    this.ND = Math.round(this.fr.D / CELL);
    this.double = anchor.format === 'double-height' || d.clear > 6;
    // the storefront entry in this frame
    const sf = layout.storefronts[anchor.storefront];
    const alongX = anchor.front === 'N' || anchor.front === 'S';
    const mid = ((alongX ? sf.ox : sf.oy) + (sf.entry[0] + sf.entry[1]) / 2) * CELL;
    this.entryU = r3(alongX ? mid - this.fr.x0 : mid - this.fr.z0);
    this.entryHalf = r3((sf.entry[1] - sf.entry[0]) * CELL / 2);
    this.doors = [];
    for (const dr of layout.doors) {
      if (dr.shopfront) continue;
      const pa = this.ids.has(dr.a), pb = this.ids.has(dr.b);
      if (pa === pb) continue;
      const piece = layout.areas[pa ? dr.a : dr.b], p = doorPoint(dr, piece);
      const [u, v] = xzUV(this.fr, p.x + p.nx * 0.75, p.z + p.nz * 0.75);
      this.doors.push({u: r3(u), v: r3(v), to: pa ? dr.b : dr.a, piece});
    }
    this.res = {family: 'science', format: anchor.format, props: d.placed, till: [], register: null, cashwrap: null, tech: [], kits: [], kitStock: [], robot: null,
      specimen: [], starMap: null, demo: null, demoStock: [], chart: null, tables: [], tableStock: [], rocket: null, mobiles: [], globes: [], telescopes: [],
      satellite: null, posters: [], back: [], stockCorner: [], routes: [], skipped: d.skipped};
  }

  get W() { return this.fr.W; }
  get D() { return this.fr.D; }
  get g() { return this.d.g; }

  // --- frame cells / walls ------------------------------------------------------------------------
  /** Grid index of frame cell (iu, iv) (any integer: beyond the box too), or -1 off the grid. */
  idx(iu: number, iv: number): number {
    const [x, z] = uvXZ(this.fr, (iu + 0.5) * CELL, (iv + 0.5) * CELL);
    const [cx, cy] = this.g.cellOf(x, z);
    return this.g.inBounds(cx, cy) ? this.g.idx(cx, cy) : -1;
  }
  isStore(i: number): boolean { return i >= 0 && this.g.cells[i] === FLOOR && this.ids.has(this.g.area[i]) && this.g.rampIdx[i] < 0; }
  pieceAt(u: number, v: number): Area | null {
    const i = this.idx(Math.floor(u / CELL), Math.floor(v / CELL));
    return this.isStore(i) ? this.layout.areas[this.g.area[i]] : null;
  }
  /** Frame cell (iu, iv) `k` cells in from frame wall `w` at along-cell `c`. */
  private wallCell(w: 'L' | 'R' | 'B', c: number, k: number): number {
    return w === 'B' ? this.idx(c, this.ND - 1 - k) : w === 'L' ? this.idx(k, c) : this.idx(this.NW - 1 - k, c);
  }
  /**
   * Depth (m from the frame edge) of the wall face of frame wall `w` over the along span [t0, t1] (m): the first store floor cell in from
   * the edge (past an inset back room), backed by a solid wall cell (no doorway / open floor behind it), the same depth all along; else null.
   */
  wallFace(w: 'L' | 'R' | 'B', t0: number, t1: number): number | null {
    const n = w === 'B' ? this.NW : this.ND, deep = w === 'B' ? this.ND : this.NW;
    const c0 = Math.floor(t0 / CELL + 1e-6), c1 = Math.ceil(t1 / CELL - 1e-6) - 1;
    if (c0 < 0 || c1 >= n || c1 < c0) return null;
    let k0 = -1;
    for (let c = c0; c <= c1; c++) {
      let k = 0;
      while (k < deep && !this.isStore(this.wallCell(w, c, k))) k++;
      if (k >= deep) return null;
      const b = this.wallCell(w, c, k - 1);
      if (b >= 0 && this.g.cells[b] === FLOOR) return null;
      if (k0 < 0) k0 = k; else if (k !== k0) return null;
    }
    return k0 * CELL;
  }
  /** Frame (u, v) of a point `t` along frame wall `w`, `off` m in from the frame edge. */
  wallUV(w: 'L' | 'R' | 'B', t: number, off: number): [number, number] {
    return w === 'L' ? [off, t] : w === 'R' ? [this.W - off, t] : [t, this.D - off];
  }
  /** World x / z of a frame point. */
  xz(u: number, v: number): [number, number] { return uvXZ(this.fr, u, v); }
  /** The world coordinate ALONG frame wall w of frame point (u, v) (placeKit's `t`). */
  along(w: 'L' | 'R' | 'B', u: number, v: number): number {
    const [x, z] = this.xz(u, v), s = this.d.side(w, this.fr);
    return s === 'N' || s === 'S' ? x : z;
  }

  // --- placement ------------------------------------------------------------------------------------
  /** A floor prop at frame (u, v) in the piece under its centre (the shared primitive), with an optional per-holder loot purpose. */
  put(kind: PropKind, u: number, v: number, yaw: number, o: {front?: number; ring?: number; variant?: number; purpose?: string} = {}): PropPlacement | null {
    const a = this.pieceAt(u, v);
    if (!a) return null;
    const [x, z] = this.xz(u, v);
    const {purpose, ...opts} = o;
    const p = this.d.putXZ(kind, x, z, yaw, {...opts, area: a});
    if (p && purpose) p.purpose = purpose;
    return p;
  }
  /** A unit with its back to frame wall `w`, centred `t` m along it (a flat solid wall over its width; tall units never over glazing). */
  wallUnit(w: 'L' | 'R' | 'B', kind: PropKind, t: number, o: {front?: number; variant?: number; purpose?: string} = {}): PropPlacement | null {
    const def = PROP_DEFS[kind], face = this.wallFace(w, t - def.w / 2, t + def.w / 2);
    if (face === null) return null;
    const [u, v] = this.wallUV(w, t, face + 0.03 + def.d / 2);
    if (def.h > 1.2) {
      const a = this.pieceAt(u, v), at = this.along(w, u, v);
      if (!a || this.d.glazedSpan(a, this.d.side(w, this.fr), at - def.w / 2, at + def.w / 2)) return null;
    }
    return this.put(kind, u, v, this.d.faceFrom(w, this.fr), o);
  }
  /** Units along frame wall `w` from `from` to `to` (m), `gap` apart, up to `max`; a blocked spot is skipped a cell at a time. */
  wallRun(w: 'L' | 'R' | 'B', kind: PropKind, from: number, to: number, o: {gap?: number; max?: number; front?: number; variant?: () => number; purpose?: string} = {}): PropPlacement[] {
    const def = PROP_DEFS[kind], out: PropPlacement[] = [], gap = o.gap ?? 0.05, max = o.max ?? 99;
    let t = upCell(Math.max(0, from));
    while (t + def.w <= to + 1e-6 && out.length < max) {
      const p = this.wallUnit(w, kind, t + def.w / 2, {front: o.front, variant: o.variant?.(), purpose: o.purpose});
      if (p) { out.push(p); t += def.w + gap; } else t += CELL;
    }
    return out;
  }
  /** Islands of `kind` at seeded spots of a frame region (nearest a target first when given), each with a walkway ring. */
  islands(kind: PropKind, n: number, r: {u0: number; u1: number; v0: number; v1: number}, o: {ring?: number; yaw?: () => number; apart?: number; near?: [number, number]; purpose?: string} = {}): PropPlacement[] {
    const out: PropPlacement[] = [];
    if (n <= 0 || r.u1 < r.u0 || r.v1 < r.v0) return out;
    let spots: [number, number][] = [];
    for (let u = snap(r.u0); u <= r.u1 + 1e-6; u += 0.5) for (let v = snap(r.v0); v <= r.v1 + 1e-6; v += 0.5) spots.push([u, v]);
    spots = this.rng.shuffle(spots);
    if (o.near) { const [nu, nv] = o.near; spots.sort((a, b) => Math.hypot(a[0] - nu, a[1] - nv) - Math.hypot(b[0] - nu, b[1] - nv)); }
    const apart = o.apart ?? 2.2;
    for (const [u, v] of spots) {
      if (out.length >= n) break;
      const [x, z] = this.xz(u, v);
      if (out.some(p => Math.hypot(p.x - x, p.z - z) < apart)) continue;
      const p = this.put(kind, u, v, o.yaw?.() ?? this.d.anyYaw(), {ring: o.ring ?? 0.8, purpose: o.purpose});
      if (p) out.push(p);
    }
    return out;
  }
  /**
   * A flat wall-art panel (`kind`, drawn `s` times its size) on frame wall `w` centred `t` m along it, its bottom `y` m above the floor:
   * a solid wall behind its whole span at that height, no glazing, no doorway, clear of every prop box, under the ceiling. Low panels
   * (y < 2 m) reserve their floor cells (nothing stands in front of them against the wall).
   */
  mountArt(w: 'L' | 'R' | 'B', kind: PropKind, t: number, y: number, s = 1, variant = 0): PropPlacement | null {
    const def = PROP_DEFS[kind], W = def.w * s, H = def.h * s;
    const face = this.wallFace(w, t - W / 2, t + W / 2);
    if (face === null) return null;
    const [u, v] = this.wallUV(w, t, face + 0.03 + def.d / 2), a = this.pieceAt(u, v);
    if (!a) return null;
    const side = this.d.side(w, this.fr), at = this.along(w, u, v), base = this.d.base, ctx = this.d.ctx, g = this.g;
    if (this.d.glazedSpan(a, side, at - W / 2 - 0.1, at + W / 2 + 0.1)) return null;
    if (!backed(ctx, a, side, at - W / 2, at + W / 2, base + y)) return null;
    const rot = WALL_ROT[side], fp = footprint(kind, rot), hx = side === 'N' || side === 'S' ? W / 2 : fp.hx, hz = side === 'N' || side === 'S' ? fp.hz : W / 2;
    const [x, z] = this.xz(u, v);
    const [c0, c1, c2, c3] = cellsOfBox(x, z, hx, hz);
    for (let cy = c1; cy <= c3; cy++) for (let cx = c0; cx <= c2; cx++) {
      if (!g.inBounds(cx, cy)) return null;
      const i = g.idx(cx, cy);
      if (g.cells[i] !== FLOOR || !this.ids.has(g.area[i]) || ctx.doorCell[i] || ctx.edge[i]) return null;
    }
    if (ceilOver(ctx, x, z, hx, hz) - base < y + H + 0.05) return null;
    if (!boxClear(ctx, x - hx, x + hx, base + y, base + y + H, z - hz, z + hz)) return null;
    if (propBlocksDoorway(this.layout, x, z, hx, hz, base + y, H)) return null;
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r3(base + y), rot: r3(rot), area: a.id, hx: r3(hx), hz: r3(hz), h: r3(H), blocksSight: false, variant, mounted: true,
      ...(this.d.level ? {level: this.d.level} : {})};
    if (y < 2) for (let cy = c1; cy <= c3; cy++) for (let cx = c0; cx <= c2; cx++) this.d.keepCell(cx, cy);
    this.layout.props.push(p);
    this.d.placed.push(p);
    return p;
  }
  /** A ceiling-hung piece drawn `s` times its size (rot a quarter turn or none): hook 2 cm under the ceiling, underside >= HUNG_CLEAR. */
  hang(kind: PropKind, x: number, z: number, hangY: number, s: number, rot: number): PropPlacement | null {
    const g = this.g, def = PROP_DEFS[kind], fp = footprint(kind, rot), hx = fp.hx * s, hz = fp.hz * s, h = def.h * s, hy = hangY * s;
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy) || !this.isStore(g.idx(cx, cy))) return null;
    for (const [px, pz] of [[x - hx, z - hz], [x + hx, z - hz], [x - hx, z + hz], [x + hx, z + hz]]) {
      const [qx, qy] = g.cellOf(px, pz);
      if (!g.inBounds(qx, qy) || !this.isStore(g.idx(qx, qy))) return null;
    }
    const a = this.layout.areas[g.area[g.idx(cx, cy)]];
    const ceil = Math.min(ceilOver(this.d.ctx, x, z, hx, hz), a.ceil), y = r3(ceil - 0.02 - hy), f = this.d.floorAt(x, z);
    if (!Number.isFinite(y) || y - f < HUNG_CLEAR || y + h > ceil + 1e-6) return null;
    // (the hook and its cable clear of the ceiling light fixtures)
    for (const l of this.layout.lights) if ((l.level ?? 0) === this.d.level && Math.hypot(l.x - x, l.z - z) < 0.75) return null;
    if (!this.d.boxFree(x, z, hx, hz, y, y + h)) return null;
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y, rot: r3(rot), area: a.id, hx: r3(hx), hz: r3(hz), h: r3(h), blocksSight: false, variant: 0, mounted: true,
      ...(this.d.level ? {level: this.d.level} : {})};
    this.layout.props.push(p);
    this.d.placed.push(p);
    return p;
  }
  /** Reserve a walking corridor (half width `half`) along a frame segment. */
  keep(u0: number, v0: number, u1: number, v1: number, half: number): void { this.d.keepUV(u0, v0, u1, v1, half, this.fr); }

  /**
   * The shortest walkable route (turns cost extra: aisle-like L runs) over the store's free floor from frame point a to b, as world
   * points of its straight legs; null when none.
   */
  route(a: [number, number], b: [number, number]): {x: number; z: number}[] | null {
    const NW = this.NW, ND = this.ND, N = NW * ND;
    const cellOk = (iu: number, iv: number) => iu >= 0 && iv >= 0 && iu < NW && iv < ND && (() => { const i = this.idx(iu, iv); return this.isStore(i) && !this.g.blocked[i]; })();
    const ok = new Uint8Array(N);
    for (let iv = 0; iv < ND; iv++) for (let iu = 0; iu < NW; iu++) ok[iv * NW + iu] = cellOk(iu, iv) ? 1 : 0;
    const s = Math.min(NW - 1, Math.max(0, Math.floor(a[0] / CELL))) + Math.min(ND - 1, Math.max(0, Math.floor(a[1] / CELL))) * NW;
    const t = Math.min(NW - 1, Math.max(0, Math.floor(b[0] / CELL))) + Math.min(ND - 1, Math.max(0, Math.floor(b[1] / CELL))) * NW;
    if (!ok[s] || !ok[t]) return null;
    const DU = [1, -1, 0, 0], DV = [0, 0, 1, -1], TURN = 3;
    const dist = new Int32Array(N * 4).fill(1 << 30), prev = new Int32Array(N * 4).fill(-1);
    const buckets: number[][] = [];
    for (let k = 0; k < 4; k++) { dist[s * 4 + k] = 0; (buckets[0] ??= []).push(s * 4 + k); }
    let best = -1;
    for (let c = 0; c < buckets.length && best < 0; c++) {
      const q = buckets[c];
      if (!q) continue;
      for (let qi = 0; qi < q.length; qi++) {
        const st = q[qi];
        if (dist[st] !== c) continue;
        const cell = st >> 2, dir = st & 3;
        if (cell === t) { best = st; break; }
        const iu = cell % NW, iv = (cell - iu) / NW;
        for (let k = 0; k < 4; k++) {
          const nu = iu + DU[k], nv = iv + DV[k];
          if (nu < 0 || nv < 0 || nu >= NW || nv >= ND || !ok[nv * NW + nu]) continue;
          const ns = (nv * NW + nu) * 4 + k, nc = c + 1 + (k === dir ? 0 : TURN);
          if (nc < dist[ns]) { dist[ns] = nc; prev[ns] = st; (buckets[nc] ??= []).push(ns); }
        }
      }
    }
    if (best < 0) return null;
    const cells: number[] = [];
    for (let st = best; st >= 0; st = prev[st]) cells.push(st >> 2);
    cells.reverse();
    // the legs' corner points (frame cell centres) -> world
    const pts: {x: number; z: number}[] = [];
    const at = (c: number) => { const iu = c % NW, iv = (c - iu) / NW; const [x, z] = this.xz((iu + 0.5) * CELL, (iv + 0.5) * CELL); return {x: r3(x), z: r3(z)}; };
    for (let i = 0; i < cells.length; i++) {
      if (i === 0 || i === cells.length - 1) { pts.push(at(cells[i])); continue; }
      const d0 = cells[i] - cells[i - 1], d1 = cells[i + 1] - cells[i];
      if (d0 !== d1) pts.push(at(cells[i]));
    }
    return pts;
  }

  // --- the store ------------------------------------------------------------------------------------
  dress(): void {
    const d = this.d, D = this.D;
    const cs = this.cashSide(), os = other(cs);
    // 1. the entry spine to the centrepiece, the rocket under the hung solar system, the globes beside it
    const vS = Math.max(2.4, Math.min(D * 0.45, D - 3.6));
    this.keep(this.entryU, 0, this.entryU, Math.min(3, vS), Math.max(0.75, Math.min(1.1, this.entryHalf)));
    this.keep(this.entryU, 0, this.entryU, vS, 0.75);
    this.centrepiece(vS);
    // 2. the routes from the entry to every staff door (around the centrepiece), reserved before the furniture
    for (const dr of this.doors) {
      const r = this.route([this.entryU, 0.25], [dr.u, dr.v]);
      if (!r) { d.skipped.push(`route to door ${dr.to}`); continue; }
      for (let i = 1; i < r.length; i++) d.keepSegment(r[i - 1].x, r[i - 1].z, r[i].x, r[i].z, 0.75);
      this.res.routes.push(r);
    }
    // 3. the cash desk (+ the tech wall beyond it), 4. the star-map / specimen wall, 5. the kit wall
    const tillEnd = this.cashDesk(cs);
    this.starWall();
    this.kitWall(os);
    this.techWall(cs, tillEnd);
    // 6. telescopes at the windows, 7. the demo bench, 8. display tables and models
    this.telescopes();
    this.demoBench(os);
    this.tables();
    // 9. posters, 10. back rooms (or the staff stock corner)
    this.posters(cs, os);
    if (this.anchor.stock.length) for (const id of this.anchor.stock) this.backRoom(id);
    else this.stockCorner(cs, tillEnd);
  }

  /** The side wall with more floor beside the entry (the cash desk goes there). */
  cashSide(): 'L' | 'R' { return this.entryU >= this.W / 2 ? 'L' : 'R'; }

  centrepiece(vS: number): void {
    const d = this.d, {W, D} = this, res = this.res;
    const reg = {u0: 2.0, u1: W - 2.0, v0: Math.min(3.0, D - 2.5), v1: D - 2.0};
    res.rocket = this.islands('skyDRocketModel', 1, reg, {ring: 1.0, yaw: () => this.fr.toFront, near: [this.entryU, Math.min(D - 2.4, vS + 1.6)]})[0] ?? null;
    if (!res.rocket) d.skipped.push('rocket');
    // the hung solar system over it (scaled to the room: large in the double height)
    const [rx, rz] = res.rocket ? [res.rocket.x, res.rocket.z] : this.xz(W / 2, D / 2);
    const clear = d.clear, under = this.double ? SCIENCE_MOBILE.underDouble : SCIENCE_MOBILE.underHall;
    const sc = Math.max(SCIENCE_MOBILE.minScale, Math.min(SCIENCE_MOBILE.maxScale, (clear - 0.02 - Math.max(HUNG_CLEAR, under)) / PLANET_MOBILE_HANG()));
    const hangAround = (cx: number, cz: number, s: number, rot: number, avoid: PropPlacement[] = [], far = 0): PropPlacement | null => {
      const cands: [number, number][] = [];
      for (let a = -4; a <= 4; a += 0.5) for (let b = -4; b <= 4; b += 0.5) cands.push([cx + a, cz + b]);
      cands.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cz) - Math.hypot(q[0] - cx, q[1] - cz));
      for (const [x, z] of cands) {
        if (avoid.some(m => Math.hypot(m.x - x, m.z - z) < far)) continue;
        for (let k = s; k >= Math.max(SCIENCE_MOBILE.minScale, s - 0.3) - 1e-6; k -= 0.1) { const p = this.hang('skyDPlanetMobile', x, z, PLANET_MOBILE_HANG(), r3(k), rot); if (p) return p; }
      }
      return null;
    };
    const m1 = hangAround(rx, rz, sc, 0);
    if (m1) res.mobiles.push(m1); else d.skipped.push(`solar system (clear ${clear.toFixed(2)} m)`);
    // a wide double-height store: a second solar system, a quarter turn, over the other half of the floor
    if (m1 && this.double && W >= 16) {
      const [u1] = xzUV(this.fr, m1.x, m1.z), u2 = u1 < W / 2 ? Math.min(W - 3, u1 + 6) : Math.max(3, u1 - 6);
      const [x2, z2] = this.xz(u2, Math.min(D - 3, D * 0.6));
      const m2 = hangAround(x2, z2, 1.0, Math.PI / 2, [m1], 4.5);
      if (m2) res.mobiles.push(m2);
    }
    // the big floor globes either side of the rocket
    if (res.rocket) {
      const [ru, rv] = xzUV(this.fr, res.rocket.x, res.rocket.z);
      for (const du of [-2.0, 2.0]) {
        const g = this.islands('skyDGiantGlobe', 1, {u0: ru + du - 1, u1: ru + du + 1, v0: rv - 1, v1: rv + 1}, {ring: 0.45, near: [ru + du, rv], yaw: () => this.fr.toFront});
        res.globes.push(...g);
      }
    }
    if (!res.globes.length) res.globes.push(...this.islands('skyDGiantGlobe', 1, {u0: 1.5, u1: W - 1.5, v0: 2.0, v1: D - 1.5}, {ring: 0.45}));
    if (!res.globes.length) d.skipped.push('globes');
  }

  /** The cash desk: [shop counter (till), glass counter] facing the floor, the cash-wrap back counter on the wall behind. Returns its far end (v). */
  cashDesk(cs: 'L' | 'R'): number {
    const d = this.d, res = this.res, D = this.D;
    const mods: PropKind[] = ['shopCounter', 'glassCounter'];
    const backD = PROP_DEFS.mallCashwrapCounter.d, ub = counterBack(backD);
    const runW = mods.reduce((s, k) => s + PROP_DEFS[k].w, 0);
    for (const side of [cs, other(cs)]) for (const t0 of [1.5, 2.0, 2.5, 3.5, 4.5, 5.5]) {
      if (t0 + runW > D - 1.0) continue;
      const face = this.wallFace(side, t0, t0 + runW);
      if (face === null) continue;
      const got: PropPlacement[] = [];
      let cw: PropPlacement | null = null;
      const ok = d.tx(() => {
        let t = t0;
        for (const k of mods) {
          const def = PROP_DEFS[k], off = face + ub + def.d / 2;
          const [u, v] = this.wallUV(side, t + def.w / 2, off);
          const p = this.put(k, u, v, d.faceFrom(side, this.fr), {front: 0.9, ...(k === 'glassCounter' ? {purpose: SCIENCE_TECH_PURPOSE} : {})});
          if (!p) return false;
          got.push(p);
          t += def.w;
        }
        cw = this.wallUnit(side, 'mallCashwrapCounter', t0 + runW / 2, {front: 0.6});
        if (!cw) return false;
        // the staff aisle between them and both its ends stay clear
        const au = face + 0.03 + backD + (ub - 0.03 - backD) / 2;
        const [a0u, a0v] = this.wallUV(side, Math.max(0.6, t0 - 0.8), au), [a1u, a1v] = this.wallUV(side, Math.min(D - 0.6, t0 + runW + 0.8), au);
        this.keep(a0u, a0v, a1u, a1v, 0.4);
        return true;
      });
      if (!ok) continue;
      res.till.push(...got);
      res.cashwrap = cw;
      const till = got.find(p => p.kind === 'shopCounter');
      if (till) res.register = d.onTop(till, 'cashRegister', REGISTER_X, 0, SHOP_COUNTER_TOP_Y);
      return t0 + runW;
    }
    d.skipped.push('cash desk');
    return 1.5;
  }

  /** The tech wall: device shelving (torch cells, batteries) beyond the cash desk on its wall. */
  techWall(cs: 'L' | 'R', tillEnd: number): void {
    const res = this.res;
    res.tech.push(...this.wallRun(cs, 'stockShelf', tillEnd + 1.0, this.D - 0.7, {max: this.rng.int(2, 3), gap: 0.05, front: 0.9, variant: () => stockVariant('devices'), purpose: SCIENCE_TECH_PURPOSE}));
    if (res.tech.length < 2) res.tech.push(...this.wallRun('B', 'stockShelf', 0.8, this.W - 0.8, {max: 2 - res.tech.length, front: 0.9, variant: () => stockVariant('devices'), purpose: SCIENCE_TECH_PURPOSE}));
    if (!res.tech.length) this.d.skipped.push('tech wall');
  }

  /** The kit wall: open shelving with boxed kits / microscopes / chemistry glassware on its tiers, the tin robot kit beside it. */
  kitWall(os: 'L' | 'R'): void {
    const res = this.res, d = this.d, D = this.D;
    const shelves = this.wallRun(os, 'shelf', 1.6, D - 0.7, {max: this.rng.int(4, 6), gap: 0.04, front: 0.9});
    if (shelves.length < 3) shelves.push(...this.wallRun('B', 'shelf', 0.8, this.W - 0.8, {max: 3 - shelves.length, gap: 0.04, front: 0.9}));
    if (!shelves.length) d.skipped.push('kit shelves');
    res.kits.push(...shelves);
    const stock: PropKind[] = ['skyDModelKits', 'skyDModelKits', 'labMicroscope', 'labBottleRack', 'labTubeRack', 'labFlaskLarge'];
    for (const sh of shelves) for (const tier of [0, 1, 2]) this.shelfTier(sh, tier, this.rng.pick(stock));
    // the robot kit: the metre-tall tin robot by the shelving's front end
    const first = shelves[0];
    if (first) {
      const [fu, fv] = xzUV(this.fr, first.x, first.z);
      res.robot = this.islands('skyDToyRobot', 1, {u0: fu - 2.2, u1: fu + 2.2, v0: Math.max(1.2, fv - 2.0), v1: fv + 1.0}, {ring: 0.4, near: [fu + (os === 'L' ? 1.6 : -1.6), fv - 1.2], yaw: () => this.fr.toFront})[0] ?? null;
    }
  }
  /** Loose stock on one shelf tier (on-host: it rests within the static unit; the tier's loot surface skips its span). */
  shelfTier(sh: PropPlacement, tier: number, kind: PropKind): void {
    const def = PROP_DEFS.shelf, it = PROP_DEFS[kind], y = SHELF_TIER_Y[tier], clear = (SHELF_TIER_Y[tier + 1] ?? def.h) - y - 0.03;
    if (it.h > clear || it.d > def.d - 0.04) return;
    const n = Math.min(kind === 'skyDModelKits' ? 2 : 1, Math.floor((def.w - 0.12) / (it.w + 0.08)));
    for (let k = 0; k < n; k++) {
      const lx = r3(n === 1 ? this.rng.range(-0.3, 0.3) : (k === 0 ? -1 : 1) * (it.w / 2 + 0.06));
      const p = this.d.onTop(sh, kind, lx, r3(-def.d / 2 + 0.02 + it.d / 2), y);
      if (p) this.res.kitStock.push(p);
    }
  }

  /** The star-map wall (back wall): the framed star-chart mural, the two glass specimen cabinets under / beside it. */
  starWall(): void {
    const res = this.res, d = this.d, W = this.W;
    const m = this.double ? SCIENCE_MURAL.double : SCIENCE_MURAL.hall;
    const cab = PROP_DEFS.glassDisplayCabinet;
    const offs = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3, 4, -4];
    const tryWall = (w: 'L' | 'R' | 'B', len: number, centre: number): boolean => {
      for (const s of [m.s, 1.25, 1.0]) {
        if (s > m.s) continue;
        for (const off of offs) {
          const t = centre + off;
          const p = this.mountArt(w, 'skySciStarMap', t, m.y, s);
          if (!p) continue;
          res.starMap = p;
          // the specimen cabinets: beneath a high mural, side by side; beside a low one, flanking it
          const mw = PROP_DEFS.skySciStarMap.w * s;
          const at = m.y >= 2 ? [t - cab.w / 2 - 0.15, t + cab.w / 2 + 0.15] : [t - mw / 2 - 0.2 - cab.w / 2, t + mw / 2 + 0.2 + cab.w / 2];
          for (const ct of at) if (ct - cab.w / 2 > 0.3 && ct + cab.w / 2 < len - 0.3) { const c = this.wallUnit(w, 'glassDisplayCabinet', ct, {front: 0.7}); if (c) res.specimen.push(c); }
          return true;
        }
      }
      return false;
    };
    if (!tryWall('B', W, W / 2) && !tryWall(this.cashSide() === 'L' ? 'R' : 'L', this.D, this.D * 0.6)) d.skipped.push('star-map wall');
    // a specimen cabinet still missing: anywhere along the back wall
    if (res.specimen.length < 2) res.specimen.push(...this.wallRun('B', 'glassDisplayCabinet', 0.6, W - 0.6, {max: 2 - res.specimen.length, gap: 0.2, front: 0.7}));
    if (!res.specimen.length) d.skipped.push('specimen cabinets');
  }

  /** Telescopes on tripods at the storefront windows either side of the entry, aimed out through the glass. */
  telescopes(): void {
    const res = this.res, W = this.W;
    const kinds: PropKind[] = ['skyDTelescope', 'telescope', 'skyDTelescope'];
    for (const off of [1.4, 2.8, 4.2]) for (const s of this.rng.shuffle([-1, 1])) {
      if (res.telescopes.length >= 3) break;
      const kind = kinds[res.telescopes.length];
      // (the wooden refractor's objective is its -X: a quarter turn past facing the front aims it out; the reflector's tube end is its front)
      const yaw = kind === 'skyDTelescope' ? this.fr.toFront + Math.PI / 2 : this.fr.toFront;
      const fp = footprint(kind, yaw), [fx, fz] = [fp.hx, fp.hz];
      const half = this.fr.front === 'N' || this.fr.front === 'S' ? fz : fx;
      const u = snap(this.entryU + s * (this.entryHalf + off)), v = snap(1.0 + half + 0.25);
      if (u < 1.0 || u > W - 1.0) continue;
      const p = this.put(kind, u, v, yaw, {ring: 0.3});
      if (p) res.telescopes.push(p);
    }
    if (!res.telescopes.length) res.telescopes.push(...this.islands('skyDTelescope', 1, {u0: 1.0, u1: W - 1.0, v0: 1.8, v1: 3.5}, {ring: 0.3, yaw: () => this.fr.toFront + Math.PI / 2}));
    if (!res.telescopes.length) this.d.skipped.push('telescopes');
  }

  /** The hands-on demo bench: the Office lab bench island (15 drawers), glassware / microscope on its worktop, the periodic chart nearby. */
  demoBench(os: 'L' | 'R'): void {
    const res = this.res, d = this.d, {W, D} = this;
    const nu = os === 'L' ? W * 0.3 : W * 0.7, nv = D * 0.62;
    const reg = {u0: 2.6, u1: W - 2.6, v0: 2.6, v1: D - 1.8};
    for (const yaw of [this.fr.toFront, this.fr.plusU]) {
      res.demo = this.islands('labBench', 1, reg, {ring: 0.9, yaw: () => yaw, near: [nu, nv]})[0] ?? null;
      if (res.demo) break;
    }
    if (!res.demo) { d.skipped.push('demo bench'); return; }
    const top = PROP_DEFS.labBench.h;
    const decor = this.rng.shuffle(['labMicroscope', 'labFlaskLarge', 'labTubeRack', 'labBottleRack', 'labFlask', 'labBottle'] as PropKind[]).slice(0, this.rng.int(4, 5));
    decor.forEach((k, i) => { const p = d.onTop(res.demo!, k, r3((i - (decor.length - 1) / 2) * 0.55), r3(this.rng.range(-0.12, 0.12)), top, res.demo!.rot); if (p) res.demoStock.push(p); });
    // the periodic chart on the wall nearest the bench
    const [bu, bv] = xzUV(this.fr, res.demo.x, res.demo.z);
    const cands: ['L' | 'R' | 'B', number, number][] = [['L', bv, bu], ['R', bv, W - bu], ['B', bu, D - bv]];
    cands.sort((a, b) => a[2] - b[2]);
    for (const [w, t] of cands) {
      for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
        if ((res.chart = this.mountArt(w, 'skySciChart', t + off, 1.3))) break;
      }
      if (res.chart) break;
    }
    if (!res.chart) d.skipped.push('periodic chart');
  }

  /** Display tables of kits and glassware, a satellite model on the floor. */
  tables(): void {
    const res = this.res, d = this.d, {W, D} = this;
    const n = Math.max(1, Math.min(3, Math.floor(W * D / 70)));
    res.tables.push(...this.islands('merchTable', n, {u0: 2.0, u1: W - 2.0, v0: 2.6, v1: D - 1.8}, {ring: 0.8, apart: 2.4, yaw: () => this.rng.pick([this.fr.toFront, this.fr.plusU])}));
    if (!res.tables.length) d.skipped.push('display tables');
    const top = PROP_DEFS.merchTable.h, tw = PROP_DEFS.merchTable.w;
    for (const t of res.tables) {
      const kits = this.rng.shuffle(['skyDModelKits', 'labMicroscope', 'labFlaskLarge', 'labTubeRack', 'labBottleRack'] as PropKind[]).slice(0, this.rng.int(2, 3));
      kits.forEach((k, i) => { const p = d.onTop(t, k, r3((i - (kits.length - 1) / 2) * (tw / 3.2)), 0, top); if (p) res.tableStock.push(p); });
    }
    res.satellite = this.islands('satelliteModel', this.rng.chance(0.75) ? 1 : 0, {u0: 2.0, u1: W - 2.0, v0: 2.6, v1: D - 1.8}, {ring: 0.6, yaw: () => this.fr.toFront})[0] ?? null;
  }

  /** The kit posters above the kit shelving, the destinations' star-chart poster on a free wall. */
  posters(cs: 'L' | 'R', os: 'L' | 'R'): void {
    const res = this.res, D = this.D;
    // above the kit shelving (clear of its 1.85 m top), in turn: chemistry set, crystals, robot
    const y = 2.05;
    let v = 0;
    const shelves = res.kits.filter(p => xzUV(this.fr, p.x, p.z)[0] < 1.5 || xzUV(this.fr, p.x, p.z)[0] > this.W - 1.5);
    const along = shelves.map(p => xzUV(this.fr, p.x, p.z)[1]).sort((a, b) => a - b);
    const ts = along.length ? along : [D * 0.35, D * 0.55, D * 0.75];
    for (const t of ts) {
      if (v >= SCI_POSTER_VARIANTS.length) break;
      if (res.posters.some(p => Math.abs(xzUV(this.fr, p.x, p.z)[1] - t) < 0.9)) continue;
      const p = this.mountArt(os, 'skySciPoster', t, y, 1, v) ?? this.mountArt(os, 'skySciPoster', t, 1.25, 1, v);
      if (p) { res.posters.push(p); v++; }
    }
    // the star-chart poster by the cash desk's wall (or anywhere)
    for (const w of [cs, 'B', os] as const) {
      const len = w === 'B' ? this.W : D;
      let done = false;
      for (let t = 1.0; t <= len - 1.0 && !done; t += 0.75) { const p = this.mountArt(w, 'skyDPoster', t, 1.25, 1, SCIENCE_DEST_POSTER); if (p) { res.posters.push(p); done = true; } }
      if (done) break;
    }
    if (!res.posters.length) this.d.skipped.push('posters');
  }

  /** A back room: openable stock added to the station's back-of-house dressing (cartons, totes, lockers / a filing cabinet). */
  backRoom(id: number): void {
    const room = this.layout.areas[id], d = this.d;
    if (!room) return;
    const door = this.layout.doors.find(q => (q.a === id && this.ids.has(q.b)) || (q.b === id && this.ids.has(q.a)));
    const fr = hallFrame(room, door ? doorSide(door, room) : this.anchor.front);
    const walls: Wall[] = ['B', 'L', 'R'];
    const out = this.res.back;
    const run = (kind: PropKind, n: number, o: {gap?: number} = {}) => {
      let got = 0;
      for (const w of this.rng.shuffle(walls.slice())) {
        if (got >= n) break;
        const len = w === 'B' ? fr.W : fr.D;
        const ps = d.wallRow(w, kind, 0.4, len - 0.4, {area: room, fr, max: n - got, gap: o.gap ?? 0.1});
        out.push(...ps);
        got += ps.length;
      }
      return got;
    };
    if (room.type === 'stock-room') {
      if (!run('staffLockers', 1)) d.skipped.push(`back room ${id}: lockers`);
      if (!run('cardboardBoxFlaps', this.rng.int(2, 4), {gap: 0.08})) d.skipped.push(`back room ${id}: cartons`);
      run('storageTote', this.rng.int(1, 2), {gap: 0.08});
    } else {
      if (!this.layout.props.some(p => p.area === id && (p.kind === 'filingCabinet' || p.kind === 'officeFiling'))) run('filingCabinet', 1);
      run('cardboardBoxFlaps', this.rng.int(1, 2), {gap: 0.08});
      run('storageTote', 1);
    }
  }

  /** No back room: a staff stock corner behind the cash desk (shelving, a two-door cabinet, cartons, lockers). */
  stockCorner(cs: 'L' | 'R', tillEnd: number): void {
    const out = this.res.stockCorner, D = this.D;
    out.push(...this.wallRun(cs, 'stockShelf', tillEnd + 0.9, D - 0.5, {max: 2, front: 0.9, variant: () => stockVariant('cartons')}));
    out.push(...this.wallRun(cs, 'cabinetTall', tillEnd + 0.9, D - 0.5, {max: 1}));
    out.push(...this.wallRun(cs, 'staffLockers', tillEnd + 0.9, D - 0.5, {max: 1}));
    out.push(...this.wallRun(cs, 'cardboardBoxFlaps', tillEnd + 0.9, D - 0.5, {max: 2, gap: 0.08}));
    if (!out.length) this.d.skipped.push('stock corner');
  }
}
