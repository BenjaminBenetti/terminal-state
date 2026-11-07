// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-HOCKEY): BLUE LINE SPORTS — the Skyways hockey store's version-3
// dresser (stores/hockey.ts). A real hockey pro shop, not filler rows (user: "hockey = convenience groceries" rejected):
//
//  - the CASH DESK by the entry: a till counter with its register and a glass display counter, behind them (a staff aisle) the openable
//    cashwrap back counter (drawers + cupboard) and the drinks cooler;
//  - the SKATE-SHARPENING service counter: a service counter, behind it the sharpener (bench grinder stand), the openable rolling tool
//    chest (tool drawers), a tool pegboard and a first-aid kit on the wall;
//  - the SHOOTING LANE in a back corner: dasher boards with their glass along its open side, the goal at its end (the shooter's mouth
//    kept clear);
//  - the TEAM LOCKERS (openable staff lockers) on the back wall with the locker-room bench in front, the JERSEY WALL (clothing bays with
//    team jerseys hung face-out on their rails);
//  - the BOOT WALL (slatwall bays with skates on their shelves) and the GEAR WALL (helmets / gloves / shin guards on slatwall bays), a
//    try-on ottoman by the skates;
//  - the floor: STICK RACKS (sticks standing in them), display tables of gloves / helmets / shin guards, the goalie mannequin facing the
//    entry, the store's posters;
//  - the BACK ROOM(S): the station's back-of-house dressing (shelving, cartons, crates) plus openable carton boxes / totes and a staff
//    locker; with no stock room, a staff stock corner (shelving + openable storage) by the cash desk.
//
// The frame is the store's whole footprint (the union of its floor pieces: a store whose stock room is inset in a corner has an L-shaped
// floor of two pieces), u along the storefront, v the depth from it. Walls are found, not assumed: every wall-backed run of cells along
// a piece's side (no door, no glazing, no open floor of the next piece behind it) is a WallSpan, and wall fixtures go only on those. Every
// prop goes through the shared placement primitive (ShopsBDresser.put / putRow: area cells, door zones, keep strips, connectivity), the
// lanes (storefront entry to every door and floor piece) reserved first. O(props): a few fixed tries per fixture, no window searches.
//
// Loot (no new tables): the sales floor rolls 'mall-sports' (water / dressings / energy bars / juice; the till what people leave
// behind; the cooler drinks), the back rooms 'mall-sports-back'; per-holder overrides: the sharpening bench's tool chest rolls
// 'mall-hardware' (cells / flares), the fallback staff corner 'mall-sports-back'. The team lockers keep the floor purpose: their own
// personal table narrowed to the store's stock (water / energy bar / dressings / juice: no ammo). No floor piles (noFloorLoot).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, SOLID} from '../../grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, type PropKind, type PropPlacement} from '../../props';
import {begin, commit, makePlaceCtx, placeAgainstWall, rollback, type PlaceCtx} from '../../placeKit';
import {stockVariant} from '../../purposeShapes';
import {MALL_SURFACES} from '../../mall/kinds';
import type {Area, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {doorPoint, hallFrame, uvXZ, xzUV, type HallFrame} from '../addonFrame';
import {ShopsBDresser, type Wall} from '../destinations/skywaysShopsBKit';
import {HK_STICK_RACK, HK_VARIANTS} from './hockeyParts';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** The store's loot purposes (gen/purposes.ts ids; existing Mall tables only). */
export const HOCKEY_PURPOSE = {floor: 'mall-sports', back: 'mall-sports-back', tools: 'mall-hardware'} as const;

/** Host-local x of a till's cash register (towards the counter's +x end; as the destinations' counters). */
const REGISTER_X = r3(PROP_DEFS.shopCounter.w / 2 - PROP_DEFS.cashRegister.w / 2 - 0.12);
/** Wall -> the back face of a counter run with `backD`-deep units against the wall: a >= 0.95 m staff aisle, on a cell boundary. */
const counterBack = (backD: number): number => Math.ceil((0.03 + backD + 0.95) / CELL - 1e-6) * CELL;

/** A wall-backed run of a floor piece's side, in the store frame: `line` = the wall face (u for L / R walls, v for B / F), [s0, s1] along it. */
export interface WallSpan { a: Area; side: Side; w: Wall; line: number; s0: number; s1: number }

/** What one store got (tests / QA): its placed props by role and the pieces that found no room. */
export interface HockeyResult {
  props: PropPlacement[];
  skipped: string[];
  roles: Record<string, PropPlacement[]>;
  /** The wall-backed spans found (frame wall, line, along range; QA). */
  spans: {w: Wall; line: number; s0: number; s1: number; area: number}[];
  /** Store frame size (m), the dresser's own time (ms). */
  W: number; D: number; ms: number;
}
/** The latest result per anchor id (tests / QA; rewritten by every generation). */
export const HOCKEY_LAST = new Map<string, HockeyResult>();

/** Dresses Blue Line Sports (the version-3 hockey store); returns the props placed. */
export function dressHockeyStore(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  const t0 = performance.now();
  const d = new ShopsBDresser(layout, rng, anchor);
  const s = new HockeyStore(d);
  s.dress();
  HOCKEY_LAST.set(anchor.id, {props: d.placed, skipped: d.skipped, roles: s.roles, W: s.W, D: s.D, ms: performance.now() - t0,
    spans: s.spans.map(sp => ({w: sp.w, line: sp.line, s0: sp.s0, s1: sp.s1, area: sp.a.id}))});
  return d.count;
}

class HockeyStore {
  readonly U: HallFrame;
  readonly pieces: Area[];
  readonly pieceIds: Set<number>;
  readonly roles: Record<string, PropPlacement[]> = {};
  /** The storefront entry in the store frame (centre u, half width). */
  readonly eu: number;
  spans: WallSpan[] = [];

  constructor(readonly d: ShopsBDresser) {
    const {layout, anchor} = d;
    this.pieces = [d.floor, ...layout.areas.filter(a => a.parent === anchor.floor && a.type === 'shop' && !anchor.zones.includes(a.id))];
    this.pieceIds = new Set(this.pieces.map(a => a.id));
    const x0 = Math.min(...this.pieces.map(a => a.x)), y0 = Math.min(...this.pieces.map(a => a.y));
    const x1 = Math.max(...this.pieces.map(a => a.x + a.w)), y1 = Math.max(...this.pieces.map(a => a.y + a.h));
    this.U = hallFrame({...d.floor, x: x0, y: y0, w: x1 - x0, h: y1 - y0}, anchor.front);
    const [ex, ez] = d.xz(d.entryU, 0);
    this.eu = r3(xzUV(this.U, ex, ez)[0]);
  }

  get W() { return this.U.W; }
  get D() { return this.U.D; }
  get rng() { return this.d.rng; }
  private add(role: string, ...ps: (PropPlacement | null | undefined)[]): PropPlacement[] {
    const got = ps.filter((p): p is PropPlacement => !!p);
    (this.roles[role] ??= []).push(...got);
    return got;
  }
  private skip(what: string): void { this.d.skipped.push(what); }

  // --- frame helpers ----------------------------------------------------------------------------
  /** The floor piece under a frame point (null: not this store's floor). */
  areaAt(u: number, v: number): Area | null {
    const [x, z] = uvXZ(this.U, u, v), g = this.d.g, [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy)) return null;
    const id = g.area[g.idx(cx, cy)];
    return this.pieceIds.has(id) && g.cells[g.idx(cx, cy)] === FLOOR ? this.d.layout.areas[id] : null;
  }
  /** A floor prop at frame (u, v) on whichever piece it stands on. */
  put(kind: PropKind, u: number, v: number, yaw: number, o: {front?: number; ring?: number; variant?: number} = {}): PropPlacement | null {
    const a = this.areaAt(u, v);
    return a ? this.d.put(kind, u, v, yaw, {...o, fr: this.U, area: a}) : null;
  }
  /** Frame point `off` m in front of a span's wall at `s` along it. */
  at(sp: WallSpan, s: number, off: number): [number, number] {
    return sp.w === 'L' ? [sp.line + off, s] : sp.w === 'R' ? [sp.line - off, s] : sp.w === 'B' ? [s, sp.line - off] : [s, sp.line + off];
  }
  /** World coordinate along the span's side at `s` (mountProp's `t`). */
  worldT(sp: WallSpan, s: number): number {
    const [u, v] = this.at(sp, s, 0), [x, z] = uvXZ(this.U, u, v);
    return sp.side === 'N' || sp.side === 'S' ? x : z;
  }
  /** Depth of a frame point from the storefront (v) along a span (the span's own s for L / R, its line for B). */
  depthOf(sp: WallSpan, s: number): number { return sp.w === 'L' || sp.w === 'R' ? s : sp.line; }

  // --- wall spans ---------------------------------------------------------------------------------
  /** Every wall-backed run of cells along each piece's sides (solid rock / wall behind, no door, no glazing), in the store frame. */
  findSpans(): WallSpan[] {
    const d = this.d, g = d.g, out: WallSpan[] = [];
    for (const a of this.pieces) {
      for (const side of ['N', 'S', 'W', 'E'] as Side[]) {
        const alongX = side === 'N' || side === 'S';
        const n = alongX ? a.w : a.h;
        const cell = (k: number): [number, number] => alongX ? [a.x + k, side === 'N' ? a.y : a.y + a.h - 1] : [side === 'W' ? a.x : a.x + a.w - 1, a.y + k];
        const beyond = (k: number): [number, number] => { const [cx, cy] = cell(k); return side === 'N' ? [cx, cy - 1] : side === 'S' ? [cx, cy + 1] : side === 'W' ? [cx - 1, cy] : [cx + 1, cy]; };
        const ok = (k: number): boolean => {
          const [cx, cy] = cell(k), [bx, by] = beyond(k);
          if (!g.inBounds(cx, cy) || !g.inBounds(bx, by)) return false;
          const i = g.idx(cx, cy), j = g.idx(bx, by);
          if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.cells[j] !== SOLID || d.ctx.aperture[j]) return false;
          const t0 = (alongX ? cx : cy) * CELL;
          return !d.glazedSpan(a, side, t0, t0 + CELL);
        };
        for (let k = 0; k < n;) {
          if (!ok(k)) { k++; continue; }
          let e = k;
          while (e + 1 < n && ok(e + 1)) e++;
          // the run's two ends on the wall face, in the frame
          const face = (t: number): [number, number] => {
            const x = alongX ? t : side === 'W' ? a.x * CELL : (a.x + a.w) * CELL, z = alongX ? (side === 'N' ? a.y * CELL : (a.y + a.h) * CELL) : t;
            return xzUV(this.U, x, z);
          };
          const t0 = ((alongX ? a.x : a.y) + k) * CELL, t1 = ((alongX ? a.x : a.y) + e + 1) * CELL;
          const [u0, v0] = face(t0), [u1, v1] = face(t1), w = d.wallOf(side, this.U);
          const lr = w === 'L' || w === 'R';
          out.push({a, side, w, line: r3(lr ? u0 : v0), s0: r3(Math.min(lr ? v0 : u0, lr ? v1 : u1)), s1: r3(Math.max(lr ? v0 : u0, lr ? v1 : u1))});
          k = e + 1;
        }
      }
    }
    return out.filter(sp => sp.w !== 'F' && sp.s1 - sp.s0 >= 1.0);
  }

  /**
   * `n` (down to `min`) units of `kind` side by side with their backs to a span, from `from` toward `to` along it (either order: the
   * search runs from `from`), `gap` apart; the first start that takes a run wins. `front`: the reserved walkable strip in front (m).
   */
  runOn(sp: WallSpan, kind: PropKind, n: number, o: {min?: number; from?: number; to?: number; gap?: number; front?: number; variant?: () => number; exact?: boolean} = {}): PropPlacement[] {
    const def = PROP_DEFS[kind], gap = o.gap ?? 0.04, min = Math.max(1, o.min ?? 1);
    const from = o.from ?? sp.s0, to = o.to ?? (from - sp.s0 <= sp.s1 - from ? sp.s1 : sp.s0), dir = to >= from ? 1 : -1;
    const lo = Math.max(sp.s0, Math.min(from, to)), hi = Math.min(sp.s1, Math.max(from, to));
    const yaw = this.d.faceFrom(sp.w, this.U), off = def.d / 2 + 0.03;
    for (let k = n; k >= min; k--) {
      const len = k * def.w + (k - 1) * gap;
      if (len > hi - lo + 1e-6) continue;
      // starts on cell boundaries, walking from `from`
      // (`exact`: a single unit packed right at `from` — a counter run's back units — then on cell boundaries)
      const first = o.exact && dir > 0 ? lo : dir > 0 ? Math.ceil(lo / CELL - 1e-6) * CELL : Math.floor((hi - len) / CELL + 1e-6) * CELL;
      for (let st = first; dir > 0 ? st + len <= hi + 1e-6 : st >= lo - 1e-6; st = o.exact && dir > 0 && st === lo ? Math.floor(lo / CELL + 1e-6) * CELL + CELL : st + dir * CELL) {
        const items = Array.from({length: k}, (_, i) => {
          const [u, v] = this.at(sp, st + def.w / 2 + i * (def.w + gap), off), [x, z] = this.d.xz(u, v, this.U);
          return {kind, x, z, rot: yaw, variant: o.variant?.() ?? 0};
        });
        const got = k > 1 || o.front ? this.d.putRow(items, sp.a, o.front ?? 0)
          : (() => { const p = this.d.putXZ(kind, items[0].x, items[0].z, yaw, {area: sp.a, variant: items[0].variant}); return p ? [p] : []; })();
        if (got.length) return got;
      }
    }
    return [];
  }

  /** Spans of the listed frame walls, longest first (ties: seeded order). */
  spansOf(walls: readonly Wall[]): WallSpan[] {
    return this.rng.shuffle(this.spans.filter(sp => walls.includes(sp.w))).sort((p, q) => (q.s1 - q.s0) - (p.s1 - p.s0));
  }

  // --- the store ------------------------------------------------------------------------------------
  dress(): void {
    this.spans = this.findSpans();
    this.reserveLanes();
    const cashSide = this.eu >= this.W / 2 ? 'L' : 'R';
    this.cashDesk(cashSide);
    // no stock room (older carves; the version-3 carve insets one): the staff stock corner goes in beside the cash desk first
    if (!this.d.anchor.stock.some(id => this.d.layout.areas[id]?.type === 'stock-room')) this.staffCorner();
    this.sharpening(cashSide === 'L' ? 'R' : 'L');
    // (the lane takes a back corner first — corners suit little else; a lane straight out from a wall only once the wall runs are in)
    this.shootingLane('corner');
    this.gearWall('bootWall', 3, 2);
    this.lockers();
    this.jerseyWall();
    if (!this.roles.lane?.length) this.shootingLane('wall');
    this.gearWall('gearWall', 3, 1);
    this.ottoman();
    this.floorPieces();
    this.posters();
    this.dressStock();
    for (const id of this.d.anchor.stock) { const a = this.d.layout.areas[id]; if (a?.type === 'stock-room') this.backRoom(a); }
  }

  /** Clear lanes: the entry straight in, from the entry to every door of every piece, into every other floor piece. */
  reserveLanes(): void {
    const d = this.d, U = this.U, eu = this.eu, half = 0.75, D = this.D;
    const spine = Math.max(2.5, Math.min(D - 2.4, D * 0.7));
    d.keepUV(eu, 0, eu, Math.min(3, spine), Math.max(half, Math.min(1.1, d.entryHalf)), U);
    d.keepUV(eu, 0, eu, spine, half, U);
    for (const a of this.pieces) {
      for (const door of d.layout.doors) {
        if (door.shopfront || (door.a !== a.id && door.b !== a.id)) continue;
        const other = door.a === a.id ? door.b : door.a;
        if (this.pieceIds.has(other)) continue;
        const pt = doorPoint(door, a), [du, dv] = xzUV(U, pt.x, pt.z), w = d.wallOf(pt.side, U);
        if (w === 'B') { const vc = Math.max(1.5, dv - 3.0); d.keepUV(eu, 0, eu, vc, half, U); d.keepUV(eu, vc, du, vc, half, U); d.keepUV(du, vc, du, dv, half, U); }
        else if (w === 'L' || w === 'R') { const vc = Math.max(1.2, Math.min(dv, D - 1.0)); d.keepUV(eu, 0, eu, vc, half, U); d.keepUV(eu, vc, du, vc, half, U); d.keepUV(du, vc, du, dv, half, U); }
        else { d.keepUV(eu, 0.8, du, 0.8, half, U); d.keepUV(du, 0, du, 1.6, half, U); }
      }
    }
    // the other floor pieces (round an inset stock room): across the front band, then into the piece's middle
    for (const a of this.pieces.slice(1)) {
      const [pu, pv] = xzUV(U, (a.x + a.w / 2) * CELL, (a.y + a.h / 2) * CELL), vc = 1.5;
      d.keepUV(eu, 0, eu, vc, half, U); d.keepUV(eu, vc, pu, vc, half, U); d.keepUV(pu, vc, pu, pv, half, U);
    }
  }

  /**
   * A counter run parallel to a span's wall: `kinds` modules end to end facing the floor (a 0.9 m customer strip kept in front), a staff
   * aisle behind, the `back` units against the wall; all or nothing. Tried at a few starts along the span from `from`.
   */
  counterRun(sp: WallSpan, starts: readonly number[], kinds: readonly PropKind[], back: readonly PropKind[]): {mods: PropPlacement[]; backs: PropPlacement[]; s0: number; s1: number} | null {
    const d = this.d, yaw = d.faceFrom(sp.w, this.U);
    const backD = Math.max(0.45, ...back.map(k => PROP_DEFS[k].d)), ub = counterBack(backD);
    const runW = kinds.reduce((s, k) => s + PROP_DEFS[k].w, 0);
    for (const s0 of starts) {
      if (s0 < sp.s0 + 0.3 || s0 + runW > sp.s1 - 0.3) continue;
      const mods: PropPlacement[] = [], backs: PropPlacement[] = [];
      const ok = d.tx(() => {
        let t = s0;
        for (const k of kinds) {
          const def = PROP_DEFS[k], [u, v] = this.at(sp, t + def.w / 2, ub + def.d / 2);
          const p = this.put(k, u, v, yaw, {front: 0.9});
          if (!p || p.area !== sp.a.id) return false;
          mods.push(p);
          t += def.w;
        }
        let b = s0;
        for (const k of back) {
          const got = this.runOn(sp, k, 1, {from: b, to: Math.min(s0 + runW + 0.6, sp.s1), exact: true});
          if (!got.length) return false;
          backs.push(got[0]);
          const [gu, gv] = xzUV(this.U, got[0].x, got[0].z);
          b = r3((sp.w === 'L' || sp.w === 'R' ? gv : gu) + PROP_DEFS[k].w / 2 + 0.06);
        }
        return true;
      });
      if (ok) return {mods, backs, s0, s1: s0 + runW};
    }
    return null;
  }

  /** The cash desk: till counter (register) + glass display counter; the openable cashwrap back counter and the drinks cooler behind. */
  cashDesk(side: 'L' | 'R'): void {
    const other: 'L' | 'R' = side === 'L' ? 'R' : 'L';
    // by the entry: a side wall's front-most run (two modules, else the till alone), the back wall only when no side wall takes it
    const two: [PropKind[], PropKind[]] = [['shopCounter', 'glassCounter'], ['mallCashwrapCounter', 'shopCooler']], one: [PropKind[], PropKind[]] = [['shopCounter'], ['mallCashwrapCounter']];
    // (a short front span: the till with a tall storage cupboard behind it)
    const short: [PropKind[], PropKind[]] = [['shopCounter'], ['cabinetTall']];
    // (front spans of both side walls first — the till alone when only it fits there — then the rest of the side walls, then the back)
    const sides = [...this.spansOf([side]), ...this.spansOf([other])].sort((p, q) => Number(p.s0 > 1) - Number(q.s0 > 1));
    const tries: [WallSpan, [PropKind[], PropKind[]]][] = [...sides.flatMap(sp => (sp.s0 <= 1 ? [[sp, two], [sp, one], [sp, short]] : [[sp, two], [sp, one]]) as [WallSpan, typeof two][]),
      ...this.spansOf(['B']).flatMap(sp => [[sp, two], [sp, one]] as [WallSpan, typeof two][])];
    for (const [sp, [mods, back]] of tries) {
      const st = sp.w === 'B' ? [sp.s0 + 0.5, sp.s1 - 3.5, sp.s0 + 2.0, sp.s1 - 5.0].map(v => Math.round(v / CELL) * CELL) : [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0].map(v => sp.s0 + v);
      const run = this.counterRun(sp, st, mods, back);
      if (!run) continue;
      const till = run.mods.find(p => p.kind === 'shopCounter');
      if (till) this.add('register', this.d.onTop(till, 'cashRegister', REGISTER_X, 0, SHOP_COUNTER_TOP_Y));
      this.add('cash', ...run.mods, ...run.backs);
      this.cashSpan = sp; this.cashRange = [run.s0, run.s1];
      return;
    }
    this.skip('cash desk');
  }
  cashSpan: WallSpan | null = null;
  cashRange: [number, number] = [0, 0];

  /** The skate-sharpening service counter: the counter, the sharpener and the openable tool chest behind it, pegboard + first-aid kit above. */
  sharpening(side: 'L' | 'R'): void {
    const other: 'L' | 'R' = side === 'L' ? 'R' : 'L';
    const cands = [...[...this.spansOf([side]), ...this.spansOf([other])].sort((p, q) => Number(p.s0 > 1) - Number(q.s0 > 1)), ...this.spansOf(['B'])];
    for (const sp of cands) {
      const starts: number[] = [];
      for (let s = Math.ceil((sp.s0 + 0.5) / CELL) * CELL; s <= sp.s1 - 2.0 && starts.length < 6; s += 1.0) {
        // (not over the cash desk's run on the same wall)
        if (sp === this.cashSpan && s < this.cashRange[1] + 0.8 && s + 1.5 > this.cashRange[0] - 0.8) continue;
        starts.push(s);
      }
      if (sp.w !== 'B') starts.sort((p, q) => Math.abs(p - 2.0) - Math.abs(q - 2.0));
      const run = this.counterRun(sp, starts, ['shopCounter'], ['benchGrinderStand', 'rollingToolChest']);
      if (!run) continue;
      const chest = run.backs.find(p => p.kind === 'rollingToolChest');
      if (chest) chest.purpose = HOCKEY_PURPOSE.tools;
      this.add('sharpening', ...run.mods, ...run.backs);
      // the tool pegboard over the chest / sharpener, the first-aid kit beside the run (wall mounts: backed wall, clear of the units)
      const [cu, cv] = chest ? xzUV(this.U, chest.x, chest.z) : [0, 0];
      const cs = sp.w === 'L' || sp.w === 'R' ? cv : cu;
      if (chest) this.add('pegboard', this.d.mount(sp.a, sp.side, this.worldT(sp, cs), 'toolPegboard', 1.35));
      const kit = [run.s1 + 0.5, run.s0 - 0.5, run.s1 + 1.0, run.s0 - 1.0, run.s1 + 1.5, run.s0 - 1.5, run.s1 + 2.0].map(s => (s > sp.s0 + 0.3 && s < sp.s1 - 0.3 ? this.d.mount(sp.a, sp.side, this.worldT(sp, s), 'firstAidWallKit', 1.3) : null)).find(Boolean);
      if (kit) this.add('firstAid', kit); else this.skip('first-aid kit');
      return;
    }
    this.skip('sharpening counter');
  }

  /**
   * The shooting lane in a back corner (side wall + back wall meet, both solid): dasher boards with their glass along its open side, the
   * goal at its closed end facing the shooter, the lane's floor and its mouth kept clear. Along the side wall first, else along the back.
   */
  shootingLane(phase: 'corner' | 'wall'): void {
    const IW = 2.5, LL = 4.0, bd = PROP_DEFS.hkRinkBoard.d, bw = PROP_DEFS.hkRinkBoard.w, net = PROP_DEFS.skyDHockeyNet;
    const backs = this.spansOf(['B']), sides = this.spansOf(['L', 'R']);
    const corners: {b: WallSpan; s: WallSpan}[] = [];
    for (const b of backs) for (const s of sides) {
      if (s.a !== b.a || !near(s.s1, b.line)) continue;
      if (s.w === 'L' ? !near(b.s0, s.line) : !near(b.s1, s.line)) continue;
      corners.push({b, s});
    }
    for (const {b, s} of phase === 'corner' ? this.rng.shuffle(corners) : []) {
      const sg = s.w === 'L' ? 1 : -1; // +u into the room from a left wall
      for (const along of ['side', 'back'] as const) {
        const ok = this.d.tx(() => {
          let boards: PropPlacement[];
          let netP: PropPlacement | null;
          if (along === 'side') {
            if (s.s1 - s.s0 < LL + 1.0 || b.s1 - b.s0 < IW + bd + 0.6) return false;
            const bu = s.line + sg * (IW + bd / 2), items = [0, 1].map(k => { const [x, z] = this.d.xz(bu, b.line - bw / 2 - k * bw, this.U); return {kind: 'hkRinkBoard' as PropKind, x, z, rot: this.U.plusU}; });
            boards = this.d.putRow(items, b.a, 0);
            if (boards.length !== 2) return false;
            netP = this.put('skyDHockeyNet', s.line + sg * IW / 2, b.line - 0.1 - net.d / 2, this.U.toFront);
            if (!netP) return false;
            this.d.keepUV(s.line + sg * IW / 2, b.line - LL - 1.4, s.line + sg * IW / 2, b.line - net.d - 0.2, IW / 2 - 0.25, this.U);
          } else {
            if (b.s1 - b.s0 < LL + 1.0 || s.s1 - s.s0 < IW + bd + 0.6) return false;
            const bv = b.line - IW - bd / 2, u0 = s.line + sg * bw / 2;
            const items = [0, 1].map(k => { const [x, z] = this.d.xz(u0 + sg * k * bw, bv, this.U); return {kind: 'hkRinkBoard' as PropKind, x, z, rot: this.U.toFront}; });
            boards = this.d.putRow(items, b.a, 0);
            if (boards.length !== 2) return false;
            netP = this.put('skyDHockeyNet', s.line + sg * (0.1 + net.d / 2), b.line - IW / 2, sg > 0 ? this.U.plusU : this.U.minusU);
            if (!netP) return false;
            const m0 = s.line + sg * (net.d + 0.2), m1 = s.line + sg * (LL + 1.4);
            this.d.keepUV(m0, b.line - IW / 2, m1, b.line - IW / 2, IW / 2 - 0.25, this.U);
          }
          this.add('lane', ...boards); this.add('laneNet', netP);
          return true;
        });
        if (ok) return;
      }
    }
    if (phase === 'corner') return;
    // else a lane straight out from one wall: the goal against it, two boards a side (its inner faces on cell boundaries); in a shallow
    // store one board a side (a 2 m mini lane)
    for (const per of [2, 1]) for (const sp of [...this.spansOf(['B']), ...this.spansOf(['L', 'R'])]) {
      const need = IW + 2 * bd + 0.4;
      if (sp.s1 - sp.s0 < need) continue;
      const yaw = this.d.faceFrom(sp.w, this.U), across = yaw + Math.PI / 2, cs: number[] = [];
      for (let c = sp.s0 + need / 2; c <= sp.s1 - need / 2 + 1e-6 && cs.length < 8; c += 1.0) cs.push(Math.round((c - IW / 2) / CELL) * CELL + IW / 2);
      for (const c of this.rng.shuffle(cs)) {
        if (c - IW / 2 - bd < sp.s0 - 1e-6 || c + IW / 2 + bd > sp.s1 + 1e-6) continue;
        const ok = this.d.tx(() => {
          const items: {kind: PropKind; x: number; z: number; rot: number}[] = [];
          for (const k of [-1, 1]) for (let j = 0; j < per; j++) {
            const [u, v] = this.at(sp, c + k * (IW / 2 + bd / 2), bw / 2 + j * bw), [x, z] = this.d.xz(u, v, this.U);
            items.push({kind: 'hkRinkBoard', x, z, rot: across});
          }
          const boards = this.d.putRow(items, sp.a, 0);
          if (boards.length !== 2 * per) return false;
          const [nu, nv] = this.at(sp, c, 0.1 + net.d / 2), netP = this.put('skyDHockeyNet', nu, nv, yaw);
          if (!netP) return false;
          const [au, av] = this.at(sp, c, net.d + 0.2), [bu, bv] = this.at(sp, c, per * bw + 1.4);
          this.d.keepUV(au, av, bu, bv, IW / 2 - 0.25, this.U);
          this.add('lane', ...boards); this.add('laneNet', netP);
          return true;
        });
        if (ok) return;
      }
    }
    this.skip(corners.length ? 'shooting lane' : 'shooting lane (no solid back corner)');
  }

  /** The team lockers on the back wall (openable staff lockers), the locker-room bench in front of them. */
  lockers(): void {
    for (const sp of [...this.spansOf(['B']), ...this.spansOf(['L', 'R'])]) {
      const got = this.runOn(sp, 'staffLockers', 3, {min: 2, front: 0.7, gap: 0.02, from: sp.w === 'B' ? (this.rng.chance(0.5) ? sp.s0 : sp.s1) : sp.s1});
      if (!got.length) continue;
      this.add('lockers', ...got);
      // the bench: centred on the lockers, its back toward them (players sit facing the room), past the doors' swing strip
      const ss = got.map(p => { const [u, v] = xzUV(this.U, p.x, p.z); return sp.w === 'L' || sp.w === 'R' ? v : u; });
      // (past the doors' swing strip, whose reserved cells run to the next cell boundary)
      const mid = (Math.min(...ss) + Math.max(...ss)) / 2, off = Math.ceil((PROP_DEFS.staffLockers.d + 0.03 + 0.7) / CELL - 1e-6) * CELL + PROP_DEFS.mallBench.d / 2 + 0.02;
      let bench: PropPlacement | null = null;
      for (const [ds, dv] of [[0, 0], [0.5, 0], [-0.5, 0], [1.0, 0], [-1.0, 0], [1.5, 0], [-1.5, 0], [0, 0.5], [2.0, 0], [-2.0, 0]]) {
        if ((bench = this.put('mallBench', ...this.at(sp, mid + ds, off + dv), this.d.faceFrom(sp.w, this.U)))) break;
      }
      if (!bench) {
        const [cu, cv] = this.at(sp, mid, 2.0);
        bench = this.islands('mallBench', 1, {u0: cu - 2.5, u1: cu + 2.5, v0: cv - 2.5, v1: cv + 2.5}, 0.3, () => this.d.faceFrom(sp.w, this.U))[0] ?? null;
      }
      if (bench) this.add('lockerBench', bench); else this.skip('locker bench');
      return;
    }
    this.skip('team lockers');
  }

  /** The jersey wall: one or two clothing bays on a wall (the back first), team jerseys on their rails (dressStock). */
  jerseyWall(): void {
    for (const sp of [...this.spansOf(['B']), ...this.spansOf(['L', 'R'])]) {
      const got = this.runOn(sp, 'clothingWallUnit', 2, {min: 1, front: 0.9, gap: 0.05, from: this.rng.chance(0.5) ? sp.s0 : sp.s1});
      if (got.length) { this.add('jerseyWall', ...got); return; }
    }
    this.skip('jersey wall');
  }

  /** The boot wall (skates) / the gear wall (helmets / gloves / shin guards): a slatwall bay run on a free wall span (side walls first). */
  gearWall(role: 'bootWall' | 'gearWall', n: number, min: number): void {
    const order = [...this.spansOf(['L', 'R']), ...this.spansOf(['B'])];
    for (const sp of [...order.filter(q => !this.used.has(q)), ...order.filter(q => this.used.has(q))]) {
      const got = this.runOn(sp, 'wallBay', n, {min, front: 1.0, gap: 0.03, from: sp.w === 'B' ? sp.s0 : sp.s1, to: sp.w === 'B' ? sp.s1 : sp.s0});
      if (got.length) { this.used.add(sp); this.add(role, ...got); return; }
    }
    this.skip(role);
  }
  /** Spans a wall run already took (the next runs try the others first). */
  readonly used = new Set<WallSpan>();

  /** A try-on ottoman in front of the boot wall. */
  ottoman(): void {
    const boots = this.roles.bootWall ?? [];
    if (boots.length) {
      let ot: PropPlacement | null = null;
      for (const bay of boots) for (const off of [1.95, 2.45]) {
        if (ot) break;
        const [ou, ov] = xzUV(this.U, bay.x + Math.sin(bay.rot) * off, bay.z + Math.cos(bay.rot) * off);
        ot = this.put('ottoman', ou, ov, bay.rot + Math.PI, {ring: 0.3});
      }
      if (!this.add('ottoman', ot).length) this.skip('ottoman');
    }
  }


  /** No stock room: a staff stock corner — shelving + openable storage — on a wall near the cash desk (back-of-house purpose). */
  staffCorner(): void {
    const sps = this.cashSpan ? [this.cashSpan, ...this.spansOf(['B', 'L', 'R']).filter(q => q !== this.cashSpan)] : this.spansOf(['B', 'L', 'R']);
    let n = 0;
    for (const [kind, variant] of [['stockShelf', stockVariant('cartons')], ['cabinetTall', 0], ['stockShelf', stockVariant('cartons')]] as [PropKind, number][]) {
      for (const sp of sps) {
        const got = this.runOn(sp, kind, 1, {front: 0.6, variant: () => variant, from: sp.s1, to: sp.s0});
        if (got.length) { got[0].purpose = HOCKEY_PURPOSE.back; this.add('staffCorner', got[0]); n++; break; }
      }
    }
    const box = this.islands('cardboardBoxFlaps', 1, {u0: 1.0, u1: this.W - 1.0, v0: this.D - 2.0, v1: this.D - 0.6}, 0.3);
    for (const p of box) p.purpose = HOCKEY_PURPOSE.back;
    this.add('staffCorner', ...box);
    if (!n) this.skip('staff stock corner');
  }

  /** Up to `n` of `kind` at seeded half-metre spots of a frame region, a walkway ring each, >= `apart` m apart. */
  islands(kind: PropKind, n: number, r: {u0: number; u1: number; v0: number; v1: number}, ring: number, yaw?: () => number, apart = 2.2): PropPlacement[] {
    const out: PropPlacement[] = [];
    if (n <= 0 || r.u1 < r.u0 || r.v1 < r.v0) return out;
    const spots: [number, number][] = [];
    for (let u = Math.round(r.u0 * 2) / 2; u <= r.u1 + 1e-6; u += 0.5) for (let v = Math.round(r.v0 * 2) / 2; v <= r.v1 + 1e-6; v += 0.5) spots.push([u, v]);
    let tries = 0;
    for (const [u, v] of this.rng.shuffle(spots)) {
      if (out.length >= n || ++tries > 160) break;
      const [x, z] = this.d.xz(u, v, this.U);
      if (out.some(p => Math.hypot(p.x - x, p.z - z) < apart)) continue;
      const p = this.put(kind, u, v, yaw?.() ?? this.d.anyYaw(), {ring});
      if (p) out.push(p);
    }
    return out;
  }

  /** The floor: the goalie by the entry, stick racks, gear tables, a goal on display when the lane found no corner. */
  floorPieces(): void {
    const {W, D, U, d} = this;
    // the goalie display mannequin beside the entry, facing it
    const gu = this.eu + (this.eu < W / 2 ? 1 : -1) * (d.entryHalf + 1.4);
    const goalie = this.put('skyDGoalieMannequin', gu, 2.0, U.toFront, {ring: 0.4}) ?? this.islands('skyDGoalieMannequin', 1, {u0: 1.0, u1: W - 1.0, v0: 1.4, v1: Math.min(D - 2, 3.5)}, 0.4, () => U.toFront)[0];
    if (goalie) this.add('goalie', goalie); else this.skip('goalie');
    const mid = {u0: 2.0, u1: W - 2.0, v0: 2.4, v1: D - 2.0};
    const racks = this.islands('hkStickRack', Math.max(2, Math.min(4, Math.floor(W * D / 40))), mid, 0.7, () => this.rng.pick([U.toFront, U.toBack, U.plusU, U.minusU]), 2.4);
    // (a small store: a one-cell walkway ring anywhere on the floor)
    if (racks.length < 2) racks.push(...this.islands('hkStickRack', 2 - racks.length, {u0: 1.0, u1: W - 1.0, v0: 1.4, v1: D - 1.0}, 0.4, () => this.rng.pick([U.toFront, U.toBack, U.plusU, U.minusU]), 1.8));
    if (racks.length) this.add('stickRacks', ...racks); else this.skip('stick racks');
    const tables = this.islands('merchTable', Math.max(1, Math.min(3, Math.floor(W * D / 60))), mid, 0.8, () => this.rng.pick([U.toFront, U.plusU]), 2.4);
    if (!tables.length) tables.push(...this.islands('merchTable', 1, {u0: 1.2, u1: W - 1.2, v0: 1.4, v1: D - 1.0}, 0.4, () => this.rng.pick([U.toFront, U.plusU]), 2.0));
    if (tables.length) this.add('gearTables', ...tables); else this.skip('gear tables');
    if (!this.roles.laneNet?.length || W * D >= 140) {
      const net = this.islands('skyDHockeyNet', 1, {u0: 2.5, u1: W - 2.5, v0: 3.0, v1: D - 2.4}, 0.8, () => U.toFront);
      if (net.length) this.add('displayNet', ...net);
    }
  }

  /** The store's posters (the destinations' hockey art) on each piece's walls. */
  posters(): void {
    let n = 0;
    for (const [i, a] of this.pieces.entries()) n += this.d.posters(i === 0 ? 2 : 1, ['L', 'R', 'B'], a, hallFrame(a, this.d.anchor.front)).length;
    if (!n) this.skip('posters');
  }

  // --- stock on the fixtures (separate props: rule 4) ------------------------------------------------
  dressStock(): void {
    const d = this.d, R = this.rng;
    // sticks standing in every rack
    for (const rack of this.roles.stickRacks ?? []) this.add('sticks', d.onTop(rack, 'hkSticks', 0, 0, HK_STICK_RACK.trayY, rack.rot));
    // team jerseys face-out on the jersey wall's rails (two per bay, hook top = the rail), a colourway each
    const rail = 1.915, jerseys = R.shuffle(Array.from({length: HK_VARIANTS.hkJersey}, (_, i) => i));
    let j = 0;
    for (const bay of this.roles.jerseyWall ?? []) for (const du of [-0.55, 0.55]) {
      const p = d.onTop(bay, 'hkJersey', du, 0.02, r3(rail - PROP_DEFS.hkJersey.h), bay.rot);
      if (p) { p.variant = jerseys[j++ % jerseys.length]; this.add('jerseys', p); }
    }
    // the boot wall: skates on the bays' shelves (1-2 pairs a deck, some decks left for the loot)
    const decks = MALL_SURFACES.wallBay;
    for (const bay of this.roles.bootWall ?? []) {
      for (const s of decks) {
        if (s.clear < PROP_DEFS.hkSkates.h + 0.01 || s.z1 - s.z0 < PROP_DEFS.hkSkates.d || R.chance(0.2)) continue;
        const slots = R.chance(0.5) ? [-0.28, 0.27] : [R.pick([-0.28, 0, 0.27])];
        for (const lx of slots) {
          const p = d.onTop(bay, 'hkSkates', lx, r3(s.z0 + PROP_DEFS.hkSkates.d / 2 + 0.01), s.y, bay.rot);
          if (p) { p.variant = R.int(0, HK_VARIANTS.hkSkates - 1); this.add('skates', p); }
        }
      }
    }
    // the gear wall: helmets on the decks deep / tall enough for them, gloves or shin guards on the base deck
    for (const bay of this.roles.gearWall ?? []) {
      for (const s of decks) {
        const deep = s.z1 - s.z0;
        if (s.clear >= PROP_DEFS.hkHelmet.h + 0.01 && deep >= PROP_DEFS.hkHelmet.d && s.y > 1) {
          for (const lx of [-0.36, 0, 0.36]) {
            if (R.chance(0.25)) continue;
            const p = d.onTop(bay, 'hkHelmet', lx, r3(s.z0 + PROP_DEFS.hkHelmet.d / 2 + 0.01), s.y, bay.rot);
            if (p) { p.variant = R.int(0, HK_VARIANTS.hkHelmet - 1); this.add('helmets', p); }
          }
        } else if (s.clear >= PROP_DEFS.hkShinPads.h + 0.01 && deep >= PROP_DEFS.hkShinPads.d && s.y < 0.5) {
          const kind: PropKind = R.chance(0.5) ? 'hkShinPads' : 'hkGloves';
          for (const lx of [-0.27, 0.27]) {
            const p = d.onTop(bay, kind, lx, r3(s.z0 + PROP_DEFS[kind].d / 2 + 0.01), s.y, bay.rot);
            if (p) { p.variant = R.int(0, HK_VARIANTS[kind as 'hkGloves' | 'hkShinPads'] - 1); this.add(kind === 'hkGloves' ? 'gloves' : 'shinPads', p); }
          }
        }
      }
    }
    // the gear tables: helmets / gloves / shin guards along their tops
    const top = MALL_SURFACES.merchTable[0];
    for (const t of this.roles.gearTables ?? []) {
      for (const lx of [-0.48, 0, 0.48]) {
        if (R.chance(0.2)) continue;
        const kind = R.pick(['hkHelmet', 'hkGloves', 'hkShinPads', 'hkGloves'] as const);
        if (lx !== 0 && kind === 'hkShinPads' && Math.abs(lx) + PROP_DEFS.hkShinPads.w / 2 > top.x1) continue;
        const p = d.onTop(t, kind, lx, 0, top.y, t.rot);
        if (p) { p.variant = R.int(0, HK_VARIANTS[kind] - 1); this.add(kind === 'hkHelmet' ? 'helmets' : kind === 'hkGloves' ? 'gloves' : 'shinPads', p); }
      }
    }
  }

  // --- the back room --------------------------------------------------------------------------------
  /** A stock room: openable carton boxes, a storage tote and a staff locker beside the station's shelving / cartons / crates. */
  backRoom(room: Area): void {
    const d = this.d, layout = d.layout, lv = room.level ?? 0;
    const ctx: PlaceCtx = makePlaceCtx(layout, d.rng.fork(`hockey-back-${room.id}`), lv, {x0: room.x - 2, y0: room.y - 2, x1: room.x + room.w + 1, y1: room.y + room.h + 1});
    const base = room.floorY ?? layout.levels[lv]?.baseY ?? 0;
    const lift = (p: PropPlacement | null): PropPlacement | null => { if (p) { p.y = r3(p.y + base); d.placed.push(p); } return p; };
    let n = 0;
    for (const [kind, front] of [['staffLockers', 0.7], ['cardboardBoxFlaps', 0.4], ['cardboardBoxFlaps', 0.4], ['storageTote', 0.4]] as [PropKind, number][]) {
      begin(ctx);
      const p = placeAgainstWall(ctx, room, kind, {front, tries: 24});
      if (p && !layout.props.slice(0, -1).some(q => (q.level ?? 0) === lv && q !== p && !q.mounted && q.host === undefined && overlap3(q, {...p, y: p.y + base}))) { commit(ctx); this.add('backRoom', lift(p)); n++; }
      else { rollback(ctx); }
    }
    if (!n) this.skip(`back room ${room.id} additions`);
  }
}

/** Two placements' boxes intersect (absolute heights). */
function overlap3(a: PropPlacement, b: PropPlacement): boolean {
  return Math.min(a.x + a.hx, b.x + b.hx) - Math.max(a.x - a.hx, b.x - b.hx) > 0.01 && Math.min(a.z + a.hz, b.z + b.hz) - Math.max(a.z - a.hz, b.z - b.hz) > 0.01
    && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;
}
