// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-ARCADE): the STARFALL ARCADE's layout-version-3 dresser — one whole,
// believable arcade over the anchor's sales floor (every floor piece: an inset stock room leaves an L-shaped hall) and its back rooms.
// Pure data (no three.js). Called by stores/arcade.ts (SkywaysStoreSpec.dress) on the anchor's own rng fork.
//
// The arcade (frame of destinations/skywaysShopsBKit.ts: u along the storefront, v depth into the store; the other floor pieces are
// addressed in the same frame, so u < 0 / u > W / v > D lie in them):
//  - CIRCULATION first: the storefront entry straight in, and a clear lane from that spine to every back-room door and into every other
//    floor piece (reserved floor: nothing placed later stands in them);
//  - the PRIZE COUNTER near the front on the roomier side: glass prize cases either side of the till (register on it), the staff aisle
//    behind, and against the wall the OPENABLE back counter (5 drawers + a cupboard) and the glass prize cabinet (2 glass doors); the
//    giant teddy prize beside it; capsule-toy machines and a gumball machine along the wall beyond;
//  - the TOKEN CHANGER (the Subway coin / card machine form) beside the entry, a second one at the counter when there is wall for it;
//  - CLAW CRANES near the entry on the other side, a KIDDIE RIDE or two in the front window zone;
//  - ARCADE CABINETS: banks of upright cabinets on every far wall, back-to-back cabinet ROWS across the middle (the play strips are the
//    aisles), AIR-HOCKEY tables and PINBALL rows in the remaining bands, pinball banks along long side walls of the deeper pieces;
//  - the PARTY ZONE (party tables with their stools, a drinks cooler, the jukebox) in the other floor piece or a deep back corner;
//  - a drinks vending machine, the arcade's posters;
//  - BACK ROOMS: the stock room becomes the technician's workshop — the electronics repair bench, a rolling tool chest (drawers) with a
//    toolbox on it, staff lockers, a TV test cart, a tool pegboard / parts bins on the walls — beside its stock shelving and cartons
//    (the station dresser's stock-room dressing; an empty room gets shelving, a carton stack, a crate, a tote and boxes here); the
//    office (when carved) gains lockers / a filing cabinet where they fit. No back room at all (older carves): a staff stock corner
//    (lockers, tool chest, shelving) along the wall beyond the counter's back units.
//
// Loot (root CLAUDE.md rule 1; docs/loot-tables.md): EXISTING holder kinds and EXISTING purposes only (no new tables): the areas roll the
// store's purposes (stores/arcade.ts); a few holders carry a per-holder `purpose` override (the gen/skyways/ramen.ts precedent):
// ARCADE_HOLDER_PURPOSE. No floor piles (the store areas are noFloorLoot at version 3).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, type PropKind, type PropPlacement} from '../../props';
import {begin, commit, doorSide as doorSideOf, makePlaceCtx, mountProp, rollback, tryPlaceProp, wallSpot, WALL_MOUNT_Y, type PlaceCtx} from '../../placeKit';
import {stockVariant} from '../../purposeShapes';
import type {Area, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {doorPoint, hallFrame, toWorld, uvXZ, xzUV, type HallFrame} from '../addonFrame';
import {ShopsBDresser, quarterYaw, type Wall} from '../destinations/skywaysShopsBKit';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const upCell = (t: number) => Math.ceil(t / CELL - 1e-6) * CELL;
const snapCell = (t: number) => Math.round(t / CELL) * CELL;

/**
 * Per-holder loot keys (existing purposes, gen/purposes.ts) where the holder's role is not the area's:
 *  - the prize cases / prize cabinet hold what a toy shop stocks (sweets, juice, batteries: 'mall-toys');
 *  - the party zone's tables hold kiosk snacks and drinks ('mall-kiosk');
 *  - the technician's tool chests / repair-area storage hold electronics spares ('mall-electronics-back': cells, a flare, water);
 *  - staff lockers anywhere roll the back room's staff rows ('mall-arcade-back': personal rows).
 */
export const ARCADE_HOLDER_PURPOSE = {prize: 'mall-toys', party: 'mall-kiosk', tech: 'mall-electronics-back', staff: 'mall-arcade-back'} as const;

/** Model-only machines / fixtures of the arcade floor (existing kinds; tests and the report read this). */
export const ARCADE_FLOOR_KINDS = {
  cabinet: 'arcadeCabinet', claw: 'skyDClawCrane', airHockey: 'skyDAirHockey', pinball: 'skyDPinball', token: 'ticketMachine', capsule: 'capsuleToyMachine',
  gumball: 'gumballMachine', kiddie: 'kiddieRide', teddy: 'giantTeddy', jukebox: 'jukebox', partyTable: 'foodCourtTableSet',
} as const satisfies Record<string, PropKind>;

/** What one arcade got (tests / QA), by role; the pieces that found no room. Per generated layout (one arcade per layout). */
export interface ArcadeResult {
  props: PropPlacement[];
  skipped: string[];
  roles: Record<string, PropPlacement[]>;
  /** The reserved lanes (frame polylines) and their targets (door / floor-piece ids). */
  lanes: {to: string; pts: [number, number][]}[];
}
export const ARCADE_LAST = new WeakMap<StationLayout, ArcadeResult>();

/** A REAL wall segment of a floor piece (solid wall cells behind it over [t0, t1]), in the main frame. */
interface Seg {
  /** Which way the units face: L = wall at low u (face +u), R = high u (face -u), B = high v (face the front), F = low v (face the back). */
  w: Wall;
  /** The wall line (u for L / R, v for B / F) and the span along it (v for L / R, u for B / F). */
  line: number; t0: number; t1: number;
  area: Area;
}

/** Dresses one Starfall Arcade (version >= 3); returns the props placed (floor, pieces and back rooms). */
export function dressArcadeStore(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  const d = new ShopsBDresser(layout, rng, anchor);
  const a = new ArcadePlan(d);
  a.run();
  ARCADE_LAST.set(layout, {props: d.placed, skipped: d.skipped, roles: a.roles, lanes: a.lanes});
  return d.count;
}

class ArcadePlan {
  readonly roles: Record<string, PropPlacement[]> = {};
  readonly lanes: {to: string; pts: [number, number][]}[] = [];
  readonly fr: HallFrame;
  readonly W: number;
  readonly D: number;
  /** The sales floor pieces (main first). */
  readonly pieces: Area[];
  readonly ids: ReadonlySet<number>;
  readonly segs: Seg[];
  /** The roomier side of the entry (the counter's), the other (the claws'). */
  readonly ps: 'L' | 'R';
  readonly cl: 'L' | 'R';
  /** The counter run once placed: its wall segment and along-wall span. */
  private wrap: {seg: Seg; t0: number; t1: number; back1: number} | null = null;

  constructor(readonly d: ShopsBDresser) {
    this.fr = d.fr; this.W = d.W; this.D = d.D;
    const L = d.layout, an = d.anchor;
    const zones = new Set(an.zones);
    this.pieces = [d.floor, ...L.areas.filter(q => q.parent === an.floor && q.type === 'shop' && !zones.has(q.id))];
    this.ids = new Set(this.pieces.map(q => q.id));
    this.ps = d.entryU >= this.W / 2 ? 'L' : 'R';
    this.cl = this.ps === 'L' ? 'R' : 'L';
    this.segs = this.pieces.flatMap(p => this.wallSegs(p));
  }

  private add(role: string, ...ps: (PropPlacement | null | undefined)[]): PropPlacement[] {
    const got = ps.filter((p): p is PropPlacement => !!p);
    (this.roles[role] ??= []).push(...got);
    return got;
  }
  private skip(what: string): void { this.d.skipped.push(what); }

  // --- geometry ---------------------------------------------------------------------------------------------------------------------
  /** Grid index under a frame point (-1 outside). */
  private cell(u: number, v: number): number {
    const [x, z] = uvXZ(this.fr, u, v), g = this.d.g, [cx, cy] = g.cellOf(x, z);
    return g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
  }
  /** The store floor piece under a frame point (null: wall / another room). */
  areaAt(u: number, v: number): Area | null {
    const i = this.cell(u, v), g = this.d.g;
    if (i < 0 || g.cells[i] !== FLOOR || !this.ids.has(g.area[i])) return null;
    return this.d.layout.areas[g.area[i]];
  }
  /** A real wall (solid cell) under a frame point. */
  private solid(u: number, v: number): boolean { const i = this.cell(u, v); return i < 0 || this.d.g.cells[i] !== FLOOR; }
  /** A floor piece's rect in the main frame. */
  rectOf(p: Area): {u0: number; u1: number; v0: number; v1: number} {
    const [ua, va] = xzUV(this.fr, p.x * CELL, p.y * CELL), [ub, vb] = xzUV(this.fr, (p.x + p.w) * CELL, (p.y + p.h) * CELL);
    return {u0: Math.min(ua, ub), u1: Math.max(ua, ub), v0: Math.min(va, vb), v1: Math.max(va, vb)};
  }
  /** The real-wall segments round a floor piece (solid cells just outside each side; doors / openings / open edges break them). */
  private wallSegs(p: Area): Seg[] {
    const r = this.rectOf(p), out: Seg[] = [];
    const sides: [Wall, number, number, number, (t: number) => [number, number]][] = [
      ['L', r.u0, r.v0, r.v1, t => [r.u0 - CELL / 2, t]], ['R', r.u1, r.v0, r.v1, t => [r.u1 + CELL / 2, t]],
      ['F', r.v0, r.u0, r.u1, t => [t, r.v0 - CELL / 2]], ['B', r.v1, r.u0, r.u1, t => [t, r.v1 + CELL / 2]],
    ];
    for (const [w, line, a0, a1, out1] of sides) {
      let s0: number | null = null;
      for (let t = a0 + CELL / 2; t < a1 + 1e-6; t += CELL) {
        const solid = this.solid(...out1(t));
        if (solid && s0 === null) s0 = t - CELL / 2;
        if ((!solid || t + CELL > a1 + 1e-6) && s0 !== null) {
          const t1 = solid ? t + CELL / 2 : t - CELL / 2;
          if (t1 - s0 >= 0.9) out.push({w, line, t0: r3(s0), t1: r3(t1), area: p});
          s0 = null;
        }
      }
    }
    return out;
  }
  /** Frame (u, v) and yaw of a unit with its back to a segment's wall, centred `t` along it, `off` m proud of the wall. */
  private onWall(s: Seg, t: number, kind: PropKind, off = 0.03): [number, number, number] {
    const hd = PROP_DEFS[kind].d / 2 + off, fr = this.fr;
    return s.w === 'L' ? [s.line + hd, t, fr.plusU] : s.w === 'R' ? [s.line - hd, t, fr.minusU] : s.w === 'B' ? [t, s.line - hd, fr.toFront] : [t, s.line + hd, fr.toBack];
  }
  /** A point `depth` m off a segment's wall, `t` along it. */
  private offWall(s: Seg, t: number, depth: number): [number, number] {
    return s.w === 'L' ? [s.line + depth, t] : s.w === 'R' ? [s.line - depth, t] : s.w === 'B' ? [t, s.line - depth] : [t, s.line + depth];
  }
  private faceOf(s: Seg): number { return this.onWall(s, s.t0, 'shelf')[2]; }

  /**
   * A contiguous run of units against a segment from `t` (all or nothing: every footprint free, the play / access strip `front` in front
   * walkable and reserved, the floor piece still connected).
   */
  private runAt(s: Seg, t: number, items: readonly [PropKind, number][], front: number, gap = 0.03): PropPlacement[] {
    let at = t;
    const list: {kind: PropKind; x: number; z: number; rot: number; variant: number}[] = [];
    for (const [k, variant] of items) {
      const w = PROP_DEFS[k].w;
      if (at < s.t0 - 1e-6 || at + w > s.t1 + 1e-6) return [];
      const [u, v, yaw] = this.onWall(s, at + w / 2, k), [x, z] = this.d.xz(u, v);
      list.push({kind: k, x, z, rot: yaw, variant});
      at += w + gap;
    }
    if (list.length === 1 && !front) { const it = list[0]; const p = this.d.putXZ(it.kind, it.x, it.z, it.rot, {area: s.area, variant: it.variant}); return p ? [p] : []; }
    return this.d.putRow(list, s.area, front);
  }
  /** Runs of up to `run` units of `kind` along [from, to] of a segment (cell-aligned starts, shrinking runs, `gapRuns` m between runs). */
  private fillSeg(s: Seg, kind: PropKind, from: number, to: number, o: {run?: number; max?: number; front?: number; gap?: number; gapRuns?: number; variant?: number} = {}): PropPlacement[] {
    const w = PROP_DEFS[kind].w, gap = o.gap ?? 0.03, out: PropPlacement[] = [], max = o.max ?? 99;
    const lo = Math.max(from, s.t0), hi = Math.min(to, s.t1);
    for (let t = upCell(lo); t + w <= hi + 1e-6 && out.length < max;) {
      let got: PropPlacement[] = [];
      for (let n = Math.min(o.run ?? 1, max - out.length, Math.floor((hi - t + gap) / (w + gap))); n >= 1 && !got.length; n--) {
        got = this.runAt(s, t, Array.from({length: n}, () => [kind, o.variant ?? 0] as [PropKind, number]), o.front ?? 0, gap);
      }
      if (got.length) { out.push(...got); t = upCell(t + got.length * (w + gap) + (o.gapRuns ?? 0.45)); } else t += CELL;
    }
    return out;
  }

  // --- the arcade -------------------------------------------------------------------------------------------------------------------
  run(): void {
    this.reserveLanes();
    this.prizeCounter();
    this.tokenChangers();
    // (the back rooms before the rest of the floor: a lined stock room's lockers stand by its staff door on the floor)
    this.backRooms();
    this.teddy();
    if (!this.d.anchor.stock.length) this.staffCorner();
    this.capsules();
    this.claws();
    this.kiddieRides();
    this.party();
    this.cabinetBanks();
    this.sidePinball();
    this.middle();
    this.vending();
    this.posters();
  }

  /**
   * The clear circulation, reserved before anything stands: the storefront entry straight in (as deep as the floor runs at the entry,
   * wide over its first 3 m), a 1 m band along every seam between two floor pieces (the L of an inset stock room: the pieces always
   * meet over open floor), and an apron in front of every back-room door (2.5 m in, 1.5 m wide) — a side-wall door of the main floor
   * also straight across to the spine. Every placement keeps its floor piece connected and every door reached (placeKit), so with the
   * seams open the whole store stays one walkable floor.
   */
  private reserveLanes(): void {
    const d = this.d, eu = d.entryU, g = d.g;
    let deep = 0.5;
    while (deep + 0.5 < 30 && this.areaAt(eu, deep + 0.5) && this.areaAt(eu - 0.6, deep + 0.5) && this.areaAt(eu + 0.6, deep + 0.5)) deep += 0.5;
    const spine = Math.max(1.5, deep - 1.8);
    d.keepUV(eu, 0, eu, Math.min(3, spine), Math.max(0.75, Math.min(1.1, d.entryHalf)));
    d.keepUV(eu, 0, eu, spine, 0.75);
    this.lanes.push({to: 'spine', pts: [[eu, 0], [eu, r3(spine)]]});
    // the seams between floor pieces (both sides' edge cells)
    if (this.pieces.length > 1) {
      const seam: [number, number][] = [];
      for (const q of this.pieces) for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) {
        if (!g.inBounds(x, y) || g.area[g.idx(x, y)] !== q.id) continue;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (!g.inBounds(nx, ny)) continue;
          const o = g.area[g.idx(nx, ny)];
          if (o !== q.id && this.ids.has(o) && g.cells[g.idx(nx, ny)] === FLOOR) { d.keepCell(x, y); seam.push(this.uvOf({x: (x + 0.5) * CELL, z: (y + 0.5) * CELL})); break; }
        }
      }
      this.lanes.push({to: 'seams', pts: seam});
    }
    // the back-room doors: an apron in; a main-floor side-wall door also straight across to the spine
    const doors = d.layout.doors.filter(q => !q.shopfront && this.ids.has(q.a) !== this.ids.has(q.b) && (this.ids.has(q.a) || this.ids.has(q.b)));
    for (const door of doors) {
      const fa = d.layout.areas[this.ids.has(door.a) ? door.a : door.b];
      const p = doorPoint(door, fa), [du, dv] = xzUV(this.fr, p.x, p.z), [iu, iv] = xzUV(this.fr, p.x + p.nx * 2.5, p.z + p.nz * 2.5);
      d.keepUV(du, dv, iu, iv, 0.75);
      const pts: [number, number][] = [[r3(du), r3(dv)], [r3(iu), r3(iv)]];
      if (fa === d.floor && Math.abs(iv - dv) < 1e-6 && this.clearLine(iu, iv, eu, iv)) { d.keepUV(iu, iv, eu, iv, 0.75); pts.push([r3(eu), r3(iv)]); }
      this.lanes.push({to: `door ${door.id}`, pts});
    }
  }
  /** A straight 1.5 m lane between two frame points runs on store floor all along. */
  private clearLine(au: number, av: number, bu: number, bv: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(bu - au, bv - av) / 0.25)), nu = bv - av, nv = -(bu - au), nl = Math.hypot(nu, nv) || 1;
    for (let i = 0; i <= n; i++) {
      const u = au + (bu - au) * i / n, v = av + (bv - av) * i / n;
      for (const s of [-0.5, 0, 0.5]) if (!this.areaAt(u + nu / nl * s, v + nv / nl * s)) return false;
    }
    return true;
  }

  /** Segments of a side ('L' / 'R') wall type, the main piece's first, then by depth (nearest the storefront first). */
  private sideSegs(side: 'L' | 'R' | null, minLen = 0): Seg[] {
    return this.segs.filter(s => (side ? s.w === side : s.w === 'L' || s.w === 'R') && s.t1 - s.t0 >= minLen)
      .sort((p, q) => Number(q.area === this.d.floor) - Number(p.area === this.d.floor) || p.t0 - q.t0);
  }

  /**
   * The prize counter: modules end to end facing into the store (a 0.9 m customer strip), a staff aisle behind them and the back units
   * against the wall; the register on the till. Longest run first; the counter side first, then any side wall, then a far wall.
   */
  private prizeCounter(): void {
    const d = this.d;
    const runs: PropKind[][] = [['glassCounter', 'shopCounter', 'glassCounter'], ['shopCounter', 'glassCounter'], ['shopCounter']];
    const backs: [PropKind, number][][] = [[['mallCashwrapCounter', 0], ['glassDisplayCabinet', 0]], [['glassDisplayCabinet', 0], ['stockShelf', stockVariant('cartons')]], [['stockShelf', stockVariant('cartons')]]];
    // (the main floor's side walls from the storefront first — the counter's side, then the other —, its far wall, then the other
    // pieces' walls; on each wall the longest run that fits)
    const main = (q: Seg) => q.area === d.floor, side = (q: Seg) => q.w === 'L' || q.w === 'R';
    const rank = (q: Seg) => (main(q) ? 0 : 6) + (side(q) ? (q.t0 < 0.6 ? 0 : 2) + (q.w === this.ps ? 0 : 1) : 4);
    const segs = this.segs.filter(q => q.w !== 'F' && q.t1 - q.t0 >= 3.0).sort((p, q) => rank(p) - rank(q) || (q.t1 - q.t0) - (p.t1 - p.t0));
    for (const s of segs) for (let k = 0; k < runs.length; k++) {
      const kinds = runs[k], back = backs[k], runW = kinds.reduce((a, q) => a + PROP_DEFS[q].w, 0);
      const backW = back.reduce((a, [q]) => a + PROP_DEFS[q].w + 0.25, -0.25);
      const backD = Math.max(...back.map(([q]) => PROP_DEFS[q].d)), ub = Math.ceil((0.03 + backD + 0.95) / CELL - 1e-6) * CELL;
      {
        const front = s.w !== 'B' && s.t0 < 0.6;
        const starts = front ? [1.5, 2.5, 4.0, 5.5, 7.0] : [s.t0 + 0.5, s.t0 + 1.5, snapCell((s.t0 + s.t1 - runW) / 2)];
        for (const t0 of starts) {
          if (t0 + Math.max(runW, backW) > s.t1 - 0.4 || t0 < s.t0) continue;
          const mods: PropPlacement[] = [], units: PropPlacement[] = [];
          const ok = d.tx(() => {
            let t = t0;
            for (const q of kinds) {
              const def = PROP_DEFS[q], [u, v] = this.offWall(s, t + def.w / 2, ub + def.d / 2);
              const area = this.areaAt(u, v);
              const p = area ? d.put(q, u, v, this.faceOf(s), {front: 0.9, area}) : null;
              if (!p) return false;
              mods.push(p);
              t += def.w;
            }
            let b = t0 + Math.max(0, (runW - backW) / 2);
            for (const [q, variant] of back) {
              const got = this.runAt(s, snapCell(b), [[q, variant]], 0.6);
              if (!got.length) return false;
              units.push(...got);
              b = snapCell(b) + PROP_DEFS[q].w + 0.25;
            }
            const till = mods.find(p => p.kind === 'shopCounter');
            if (till) this.add('register', d.onTop(till, 'cashRegister', r3(PROP_DEFS.shopCounter.w / 2 - PROP_DEFS.cashRegister.w / 2 - 0.12), 0, SHOP_COUNTER_TOP_Y));
            return true;
          });
          if (!ok) continue;
          for (const p of [...mods, ...units]) if (p.kind === 'glassCounter' || p.kind === 'glassDisplayCabinet') p.purpose = ARCADE_HOLDER_PURPOSE.prize;
          this.add('counter', ...mods);
          this.add('counterBack', ...units);
          this.wrap = {seg: s, t0, t1: t0 + runW, back1: t0 + Math.max(runW, backW)};
          return;
        }
      }
    }
    this.skip('prize counter');
  }

  /** The token changer(s): beside the entry on a solid stretch of the front wall, else at the counter's end / by the entry. */
  private tokenChangers(): void {
    const d = this.d, k = ARCADE_FLOOR_KINDS.token, w = PROP_DEFS[k].w, eu = d.entryU, half = d.entryHalf;
    const got: PropPlacement[] = [];
    // the front wall's solid stretches nearest the entry (the counter's side first)
    const fronts = this.segs.filter(s => s.w === 'F' && s.area === d.floor);
    const tries: [Seg, number][] = [];
    for (const s of fronts) for (let t = s.t0 + w / 2 + 0.05; t <= s.t1 - w / 2 - 0.05; t += CELL) tries.push([s, t]);
    const pref = (t: number) => Math.abs(t - eu) + ((t < eu) === (this.ps === 'L') ? 0 : 1.5);
    tries.sort((p, q) => pref(p[1]) - pref(q[1]));
    for (const [s, t] of tries) {
      if (got.length >= 2 || Math.abs(t - eu) < half + 0.9) continue;
      if (got.some(p => Math.hypot(...this.uvOf(p).map((c, i) => c - [t, 0][i]) as [number, number]) < 1.2 && Math.abs(this.uvOf(p)[0] - t) < 1.2)) continue;
      const [u, v, yaw] = this.onWall(s, t, k);
      const p = d.put(k, u, v, yaw, {front: 0.8, area: s.area});
      if (p) got.push(p);
    }
    // at the counter's end (facing its customers)
    if (got.length < 2 && this.wrap) {
      const s = this.wrap.seg;
      for (const t of [this.wrap.back1 + 0.6, this.wrap.t0 - 0.6 - w]) {
        if (got.length >= 2) break;
        const p = this.runAt(s, snapCell(t), [[k, 0]], 0.8)[0];
        if (p) got.push(p);
      }
    }
    if (!got.length) {
      for (const [u, v] of [[eu - half - 1.2, 1.6], [eu + half + 1.2, 1.6], [eu - half - 1.2, 2.4], [eu + half + 1.2, 2.4]] as [number, number][]) {
        const area = this.areaAt(u, v), p = area ? d.put(k, u, v, u < eu ? this.fr.plusU : this.fr.minusU, {front: 0.8, area}) : null;
        if (p) { got.push(p); break; }
      }
    }
    if (!got.length) this.skip('token changer');
    this.add('token', ...got);
  }
  private uvOf(p: {x: number; z: number}): [number, number] { return xzUV(this.fr, p.x, p.z); }

  /** The giant teddy prize on the floor beside the counter's customer side. */
  private teddy(): void {
    const d = this.d, k = ARCADE_FLOOR_KINDS.teddy, mods = this.roles.counter ?? [];
    const ref = mods[mods.length - 1] ?? mods[0];
    const spots: [number, number][] = [];
    if (ref && this.wrap) {
      // beside either end of the counter, from the wall out past its customer strip (nearest the counter first)
      const s = this.wrap.seg, near: [number, number, number][] = [];
      for (const dt of [0.9, 1.4, 1.9, 2.4, 2.9]) for (const depth of [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]) {
        near.push([...this.offWall(s, this.wrap.t1 + dt, depth), dt + Math.abs(depth - 2.4) * 0.5] as [number, number, number]);
        near.push([...this.offWall(s, this.wrap.t0 - dt, depth), dt + Math.abs(depth - 2.4) * 0.5 + 0.3] as [number, number, number]);
      }
      spots.push(...near.sort((p, q) => p[2] - q[2]).map(([u, v]) => [u, v] as [number, number]));
    }
    for (let v = 1.5; v <= Math.min(this.D - 1.5, 4.0); v += 0.5) for (const du of [3, 4, 5, 6]) spots.push([this.d.entryU + (this.ps === 'L' ? -du : du), v]);
    for (const [u, v] of spots) {
      const area = this.areaAt(u, v), p = area ? d.put(k, snapCell(u), snapCell(v), this.fr.toFront, {ring: 0.4, area}) : null;
      if (p) { this.add('teddy', p); return; }
    }
    this.skip('giant teddy');
  }

  /** No back room (older carves): the staff stock corner along the counter's wall beyond its back units. */
  private staffCorner(): void {
    const s = this.wrap?.seg ?? this.sideSegs(this.ps, 3)[0];
    if (!s) { this.skip('staff corner'); return; }
    const from = this.wrap ? this.wrap.back1 + 0.3 : s.t0 + 0.5;
    const sets: [PropKind, number][][] = [[['staffLockers', 0], ['rollingToolChest', 0], ['stockShelf', stockVariant('cartons')]], [['staffLockers', 0], ['rollingToolChest', 0]], [['staffLockers', 0]]];
    for (const set of sets) for (let t = upCell(from); t < s.t1 - 1; t += CELL) {
      const got = this.runAt(s, t, set, 0.6, 0.1);
      if (!got.length) continue;
      for (const p of got) p.purpose = p.kind === 'rollingToolChest' ? ARCADE_HOLDER_PURPOSE.tech : ARCADE_HOLDER_PURPOSE.staff;
      this.add('staff', ...got);
      return;
    }
    this.skip('staff corner');
  }

  /** Capsule-toy machines and the gumball machine along the counter's wall beyond it (else any side wall). */
  private capsules(): void {
    const segs = this.wrap ? [this.wrap.seg, ...this.sideSegs(this.ps, 2), ...this.sideSegs(null, 2)] : this.sideSegs(null, 2);
    const set: [PropKind, number][] = [[ARCADE_FLOOR_KINDS.gumball, 0], ...Array.from({length: this.d.rng.int(2, 4)}, () => [ARCADE_FLOOR_KINDS.capsule, 0] as [PropKind, number])];
    for (const s of [...new Set(segs)]) {
      // (beyond the counter's back units on its own wall — a staff corner there is skipped over: runs never overlap)
      const from = s === this.wrap?.seg ? this.wrap.back1 + 0.8 : s.t0 + (s.t0 < 0.6 ? 2.0 : 0.4);
      for (let n = set.length; n >= 2; n--) for (let t = upCell(from); t + 0.95 < s.t1; t += CELL) {
        const got = this.runAt(s, t, set.slice(0, n), 0.8, 0.05);
        if (got.length) { this.add('capsule', ...got); return; }
      }
    }
    this.skip('capsule machines');
  }

  /** Claw cranes near the entry on the other side (else any side wall): a bank of 2-4. */
  private claws(): void {
    const k = ARCADE_FLOOR_KINDS.claw;
    const n = this.d.rng.int(2, 4);
    for (const s of [...this.sideSegs(this.cl, 2), ...this.sideSegs(this.ps, 2).filter(q => q !== this.wrap?.seg)]) {
      const got = this.fillSeg(s, k, s.t0 < 0.6 ? 1.0 : s.t0 + 0.3, s.t1 - 0.3, {run: n, max: n, front: 1.0, gap: 0.05});
      if (got.length) { this.add('claw', ...got); return; }
    }
    this.skip('claw cranes');
  }

  /** A kiddie ride or two in the front window zone, on the claws' side of the entry. */
  private kiddieRides(): void {
    const d = this.d, k = ARCADE_FLOOR_KINDS.kiddie, eu = d.entryU, half = d.entryHalf;
    const n = d.rng.int(1, 2), yaw = () => d.rng.pick([this.fr.plusU, this.fr.minusU]);
    const [u0, u1] = this.cl === 'L' ? [3.0, eu - half - 0.9] : [eu + half + 0.9, this.W - 3.0];
    const got = this.islands(k, n, {u0, u1, v0: 1.0, v1: 3.4}, yaw, 0.6, 2.2);
    if (!got.length) got.push(...this.islands(k, 1, {u0: 2.6, u1: this.W - 2.6, v0: 1.0, v1: Math.min(this.D - 1.5, 4.5)}, yaw, 0.6, 2.2));
    if (!got.length) this.skip('kiddie ride');
    this.add('kiddie', ...got);
  }

  /** Up to `n` islands at seeded half-metre spots of a frame region (any floor piece), each with a walkway ring. */
  private islands(kind: PropKind, n: number, r: {u0: number; u1: number; v0: number; v1: number}, yaw: () => number, ring: number, apart: number, purpose?: string): PropPlacement[] {
    const out: PropPlacement[] = [];
    if (n <= 0 || r.u1 < r.u0 || r.v1 < r.v0) return out;
    const spots: [number, number][] = [];
    for (let u = Math.round(r.u0 * 2) / 2; u <= r.u1 + 1e-6; u += 0.5) for (let v = Math.round(r.v0 * 2) / 2; v <= r.v1 + 1e-6; v += 0.5) spots.push([u, v]);
    for (const [u, v] of this.d.rng.shuffle(spots)) {
      if (out.length >= n) break;
      const [x, z] = this.d.xz(u, v);
      if (out.some(p => Math.hypot(p.x - x, p.z - z) < apart)) continue;
      const area = this.areaAt(u, v);
      const p = area ? this.d.put(kind, u, v, yaw(), {ring, area}) : null;
      if (p) { if (purpose) p.purpose = purpose; out.push(p); }
    }
    return out;
  }

  /**
   * The party zone: party tables with their stools (islands), a drinks cooler and the jukebox against its walls — in the other floor
   * piece (the inset stock room's L) when it has the room, else in a deep main floor's back corner on the counter's side.
   */
  private party(): void {
    const d = this.d;
    const zone = (r: {u0: number; u1: number; v0: number; v1: number}, area: Area | null): boolean => {
      const tables = this.islands(ARCADE_FLOOR_KINDS.partyTable, (r.u1 - r.u0) * (r.v1 - r.v0) >= 14 ? 2 : 1, r, () => this.fr.toFront, 0.5, 2.2, ARCADE_HOLDER_PURPOSE.party);
      if (!tables.length) return false;
      this.add('party', ...tables);
      const segs = this.segs.filter(s => (!area || s.area === area) && this.segNear(s, r, 1.2));
      for (const [k, front] of [['shopCooler', 0.8], [ARCADE_FLOOR_KINDS.jukebox, 0.8]] as [PropKind, number][]) {
        let p: PropPlacement | null = null;
        for (const s of segs) {
          const [a0, a1] = s.w === 'L' || s.w === 'R' ? [r.v0, r.v1] : [r.u0, r.u1];
          p = this.fillSeg(s, k, Math.max(s.t0, a0 - 1), Math.min(s.t1, a1 + 1), {max: 1, front})[0] ?? null;
          if (p) break;
        }
        if (p) this.add('party', p); else this.skip(`party ${k}`);
      }
      return true;
    };
    for (const q of this.pieces.slice(1)) {
      const r = this.rectOf(q);
      if (r.u1 - r.u0 < 3.5 || r.v1 - r.v0 < 3.5) continue;
      if (zone({u0: r.u0 + 1.4, u1: r.u1 - 1.4, v0: r.v0 + 1.4, v1: r.v1 - 1.4}, q)) return;
    }
    if (this.D >= 11 && this.W >= 17) {
      const [u0, u1] = this.ps === 'L' ? [1.6, 5.0] : [this.W - 5.0, this.W - 1.6];
      if (zone({u0, u1, v0: this.D - 3.6, v1: this.D - 1.6}, d.floor)) return;
    }
    this.skip('party zone');
  }
  /** A segment runs along the edge of (or within `m` m of) a frame region. */
  private segNear(s: Seg, r: {u0: number; u1: number; v0: number; v1: number}, m: number): boolean {
    if (s.w === 'L' || s.w === 'R') return s.line >= r.u0 - 1.5 - m && s.line <= r.u1 + 1.5 + m && s.t1 > r.v0 && s.t0 < r.v1;
    return s.line >= r.v0 - 1.5 - m && s.line <= r.v1 + 1.5 + m && s.t1 > r.u0 && s.t0 < r.u1;
  }

  /** Banks of upright arcade cabinets on every far wall (runs of up to 6, a play strip in front). */
  private cabinetBanks(): void {
    const k = ARCADE_FLOOR_KINDS.cabinet;
    let n = 0;
    for (const s of this.segs.filter(q => q.w === 'B')) n += this.add('cabinet', ...this.fillSeg(s, k, s.t0 + 0.3, s.t1 - 0.3, {run: 6, front: 1.0, gap: 0.03})).length;
    if (!n) this.skip('cabinet banks');
  }

  /** Pinball banks along the long side walls deeper in the store (the walls the counter / claws / capsules left free). */
  private sidePinball(): void {
    const k = ARCADE_FLOOR_KINDS.pinball;
    for (const s of this.sideSegs(null, 3)) {
      const from = s.area === this.d.floor && s.t0 < 0.6 ? 4.5 : s.t0 + 0.4;
      this.add('pinball', ...this.fillSeg(s, k, from, s.t1 - 1.2, {run: 4, max: 4, front: 0.9, gap: 0.03}));
    }
  }

  /**
   * The middle of each floor piece in bands across it: back-to-back cabinet ROWS (both play strips are aisles), air-hockey tables, a
   * pinball row — as many as its depth takes, nearest the storefront first; the reserved lanes cut them into runs.
   */
  private middle(): void {
    const cd = PROP_DEFS[ARCADE_FLOOR_KINDS.cabinet].d, ad = PROP_DEFS[ARCADE_FLOOR_KINDS.airHockey].d, pd = PROP_DEFS[ARCADE_FLOOR_KINDS.pinball].d;
    const BAND = {CAB2: 1.0 + 2 * cd + 1.0, AH: 0.6 + ad + 0.6, PB1: 0.9 + pd + 0.3, CAB1: 1.0 + cd + 0.5} as const;
    for (const q of this.pieces) {
      const r = this.rectOf(q), main = q === this.d.floor;
      const wallB = this.segs.some(s => s.area === q && s.w === 'B' && s.t1 - s.t0 > 2);
      const v0 = main ? 2.6 : r.v0 + (this.segs.some(s => s.area === q && s.w === 'F') ? 1.6 : 0.9);
      const v1 = r.v1 - (wallB ? cd + 1.0 + 0.2 : 1.0);
      const u0 = r.u0 + (this.segs.some(s => s.area === q && s.w === 'L') ? 2.4 : 1.0), u1 = r.u1 - (this.segs.some(s => s.area === q && s.w === 'R') ? 2.4 : 1.0);
      if (u1 - u0 < 2.2) continue;
      const plan: (keyof typeof BAND)[] = [];
      let R = v1 - v0;
      for (const b of ['CAB2', 'AH', 'CAB2', 'PB1', 'AH', 'CAB1'] as const) if (R >= BAND[b]) { plan.push(b); R -= BAND[b]; }
      if (!plan.length && R >= BAND.CAB1) plan.push('CAB1');
      let v = v0 + Math.max(0, R / 2);
      for (const b of plan) {
        if (b === 'CAB2') this.cabRows(q, u0, u1, v, cd, true);
        else if (b === 'CAB1') this.cabRows(q, u0, u1, v, cd, false);
        else if (b === 'AH') {
          const cv = snapCell(v + BAND.AH / 2);
          this.add('airHockey', ...this.islands(ARCADE_FLOOR_KINDS.airHockey, this.d.rng.int(1, 3), {u0: u0 + 1.0, u1: u1 - 1.0, v0: cv - 0.5, v1: cv + 0.5}, () => this.fr.toFront, 0.9, 3.4));
        } else this.add('pinball', ...this.bandRow(q, ARCADE_FLOOR_KINDS.pinball, u0, u1, v + 0.9 + pd / 2, this.d.rng.int(3, 5), this.fr.toFront, 0.9));
        v += BAND[b];
      }
    }
    // an air-hockey table or two wherever the floor still has the room (the front plaza, a deep piece)
    const extra = this.roles.airHockey?.length ? this.d.rng.int(0, 1) : this.d.rng.int(1, 2);
    for (const q of this.pieces) {
      if (this.roles.airHockey && this.roles.airHockey.length >= 3) break;
      const r = this.rectOf(q), got = this.islands(ARCADE_FLOOR_KINDS.airHockey, extra, {u0: r.u0 + 1.6, u1: r.u1 - 1.6, v0: Math.max(r.v0 + 1.4, q === this.d.floor ? 1.8 : 0), v1: r.v1 - 1.6}, () => this.fr.toFront, 0.9, 3.4);
      this.add('airHockey', ...got);
    }
    if (!this.roles.airHockey?.length) this.skip('air hockey');
  }
  /**
   * A cabinet row from band start `v` facing the storefront (its play strip in front); `twin`: back to back with a second row facing the
   * back (backs touching on a cell seam, so the two rows never share a cell), each twin all or nothing with its own play strip.
   */
  private cabRows(q: Area, u0: number, u1: number, v: number, cd: number, twin: boolean): void {
    const k = ARCADE_FLOOR_KINDS.cabinet;
    const seam = upCell(v + 1.0 + cd);
    const fronts = this.bandRow(q, k, u0, u1, seam - cd / 2, this.d.rng.int(4, 7), this.fr.toFront, 1.0);
    this.add('cabinetRow', ...fronts);
    if (!twin) return;
    // the twins run by run (a run's units share cell columns: placed together), shrinking from the run's far end when blocked
    const runs: PropPlacement[][] = [];
    for (const p of fronts) {
      const last = runs[runs.length - 1], prev = last?.[last.length - 1];
      if (prev && Math.abs(this.uvOf(p)[0] - this.uvOf(prev)[0]) < PROP_DEFS[k].w + 0.1) last.push(p); else runs.push([p]);
    }
    for (const run of runs) for (let n = run.length; n >= 1; n--) {
      const got = this.d.putRow(run.slice(0, n).map(p => { const [x, z] = this.d.xz(this.uvOf(p)[0], seam + cd / 2); return {kind: k, x, z, rot: this.fr.toBack}; }), q, 1.0);
      if (got.length) { this.add('cabinetRow', ...got); break; }
    }
  }
  /** Runs of up to `per` contiguous units along u at depth v of floor piece `q` (blocked / reserved floor skipped), 1.4 m between runs. */
  private bandRow(q: Area, kind: PropKind, u0: number, u1: number, v: number, per: number, yaw: number, front: number): PropPlacement[] {
    const w = PROP_DEFS[kind].w + 0.03, out: PropPlacement[] = [];
    for (let u = snapCell(u0); u + w <= u1 + 1e-6;) {
      let got: PropPlacement[] = [];
      for (let n = Math.min(per, Math.floor((u1 - u) / w)); n >= 2 && !got.length; n--) {
        const items = Array.from({length: n}, (_, i) => { const [x, z] = this.d.xz(u + PROP_DEFS[kind].w / 2 + i * w, v); return {kind, x, z, rot: yaw}; });
        got = this.d.putRow(items, q, front);
      }
      if (got.length) { out.push(...got); u = snapCell(u + got.length * w + 1.4 + 0.25); } else u += CELL;
    }
    return out;
  }

  /** One drinks vending machine against a free wall (the party zone's piece / the counter's side first). */
  private vending(): void {
    const segs = [...this.segs].sort((p, q) => Number(q.area !== this.d.floor) - Number(p.area !== this.d.floor) || (q.t1 - q.t0) - (p.t1 - p.t0));
    for (const s of segs) {
      const p = this.fillSeg(s, 'vending', s.t0 + (s.w === 'F' ? 0.4 : 1.0), s.t1 - 0.4, {max: 1, front: 1.0})[0];
      if (p) { this.add('vending', p); return; }
    }
    this.skip('vending');
  }

  /** The arcade's posters on the main floor's walls and on the other pieces' (solid wall only, never glazing / doors). */
  private posters(): void {
    const d = this.d;
    this.add('poster', ...d.posters(d.rng.int(2, 3)));
    for (const q of this.pieces.slice(1)) this.add('poster', ...d.posters(1, ['L', 'R', 'B'], q, hallFrame(q, d.anchor.front)));
    if (!this.roles.poster?.length) this.skip('posters');
  }

  // --- back rooms -------------------------------------------------------------------------------------------------------------------
  /**
   * The technician's workshop in the stock room (beside the stock the station dresser shelved there; an empty room is shelved here
   * first) and the office's extra staff storage. Each piece where it fits (its own placement context: walls, door zones, access strips).
   */
  private backRooms(): void {
    const d = this.d;
    for (const id of d.anchor.stock) {
      const room = d.layout.areas[id];
      if (!room) continue;
      const ctx = makePlaceCtx(d.layout, d.rng, d.level, {x0: room.x - 3, y0: room.y - 3, x1: room.x + room.w + 3, y1: room.y + room.h + 3});
      const base = room.floorY ?? d.layout.levels[d.level]?.baseY ?? d.base;
      // the station dresser's pieces already in the room keep their access strips (0.7 m in front of each floor prop)
      for (const p of d.layout.props) {
        if (p.area !== id || p.mounted || p.host !== undefined) continue;
        const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot)), hd = PROP_DEFS[p.kind].d / 2, hw = PROP_DEFS[p.kind].w / 2;
        const sx = p.x + fx * (hd + 0.35), sz = p.z + fz * (hd + 0.35), ex = fx ? 0.35 : hw, ez = fz ? 0.35 : hw;
        for (let cy = Math.floor((sz - ez + 0.04) / CELL); cy <= Math.floor((sz + ez - 0.04) / CELL); cy++) for (let cx = Math.floor((sx - ex + 0.04) / CELL); cx <= Math.floor((sx + ex - 0.04) / CELL); cx++) {
          if (ctx.g.inBounds(cx, cy) && ctx.g.area[ctx.g.idx(cx, cy)] === id && !ctx.g.blocked[ctx.g.idx(cx, cy)]) ctx.keep[ctx.g.idx(cx, cy)] = 1;
        }
      }
      // (every wall spot in turn, quarter-metre steps, the sides in a seeded order: a lined stock room still finds its free stretches)
      const sides = d.rng.shuffle(['N', 'E', 'S', 'W'] as Side[]);
      const put = (role: string, kind: PropKind, o: {front?: number; variant?: number; purpose?: string} = {}) => {
        let p: PropPlacement | null = null;
        for (const side of sides) {
          const alongX = side === 'N' || side === 'S', lo = (alongX ? room.x : room.y) * CELL, hi = (alongX ? room.x + room.w : room.y + room.h) * CELL, hw = PROP_DEFS[kind].w / 2;
          for (let t = lo + hw + 0.05; t <= hi - hw - 0.05 + 1e-6 && !p; t += 0.25) {
            const s = wallSpot(room, side, r3(t), kind);
            p = tryPlaceProp(ctx, room, kind, r3(s.x), r3(s.z), s.rot, {front: o.front, variant: o.variant});
          }
          if (p) break;
        }
        if (!p) return null;
        p.y = r3(p.y + base);
        if (o.purpose) p.purpose = o.purpose;
        d.placed.push(p);
        this.add(role, p);
        return p;
      };
      // an island on the room's open floor (a walkway ring kept), the spots nearest its middle first, facing its door
      const door = d.layout.doors.find(q => q.a === id || q.b === id);
      const faceDoor = door ? ({N: Math.PI, S: 0, W: -Math.PI / 2, E: Math.PI / 2} as const)[doorSideOf(door, room)] : 0;
      const island = (role: string, kind: PropKind, ring: number, purpose?: string): PropPlacement | null => {
        const cx = (room.x + room.w / 2) * CELL, cz = (room.y + room.h / 2) * CELL, spots: [number, number][] = [];
        for (let x = room.x * CELL + 0.5; x <= (room.x + room.w) * CELL - 0.5; x += 0.25) for (let z = room.y * CELL + 0.5; z <= (room.y + room.h) * CELL - 0.5; z += 0.25) spots.push([x, z]);
        spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
        for (const [x, z] of spots) {
          const p = tryPlaceProp(ctx, room, kind, r3(x), r3(z), faceDoor, {ring});
          if (!p) continue;
          p.y = r3(p.y + base);
          if (purpose) p.purpose = purpose;
          d.placed.push(p);
          this.add(role, p);
          return p;
        }
        return null;
      };
      if (room.type === 'stock-room') {
        const empty = d.layout.props.filter(p => p.area === id).length < 3;
        if (empty) {
          for (let k = 0; k < 3; k++) put('stock', 'stockShelf', {front: 0.8, variant: stockVariant(k ? 'devices' : 'cartons')});
          put('stock', 'cartonStack');
          put('stock', 'crate');
        }
        // the repair bench against a wall; a lined room: the technician's workbench (a desk with drawers: the soldering station and a
        // test monitor on its top) out on the room's open floor instead
        const bench = put('workshop', 'repairBench', {front: 0.9, variant: 1});
        let chest = put('workshop', 'rollingToolChest', {purpose: ARCADE_HOLDER_PURPOSE.tech});
        if (!bench) {
          // the workbench cluster on the open floor: the desk with the tool chest at its end (all or nothing; the desk alone when the
          // chest already stands at a wall)
          const cx = (room.x + room.w / 2) * CELL, cz = (room.y + room.h / 2) * CELL, spots: [number, number][] = [];
          for (let x = room.x * CELL + 0.5; x <= (room.x + room.w) * CELL - 0.5; x += 0.25) for (let z = room.y * CELL + 0.5; z <= (room.y + room.h) * CELL - 0.5; z += 0.25) spots.push([x, z]);
          spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
          let desk: PropPlacement | null = null;
          for (const [x, z] of spots) {
            for (const rot of [faceDoor, faceDoor + Math.PI]) {
              begin(ctx);
              const dk = tryPlaceProp(ctx, room, 'desk', r3(x), r3(z), quarterYaw(rot), {front: 0.7});
              let ch: PropPlacement | null = null;
              if (dk && !chest) for (const sx of [1, -1]) {
                const [wx, wz] = toWorld(dk, sx * (PROP_DEFS.desk.w / 2 + PROP_DEFS.rollingToolChest.w / 2 + 0.05), (PROP_DEFS.rollingToolChest.d - PROP_DEFS.desk.d) / 2);
                ch = tryPlaceProp(ctx, room, 'rollingToolChest', r3(wx), r3(wz), dk.rot, {});
                if (ch) break;
              }
              if (dk && (chest || ch)) {
                commit(ctx);
                desk = dk;
                for (const p of [dk, ...(ch ? [ch] : [])]) { p.y = r3(p.y + base); p.purpose = ARCADE_HOLDER_PURPOSE.tech; d.placed.push(p); this.add('workshop', p); }
                if (ch) chest = ch;
                break;
              }
              rollback(ctx);
            }
            if (desk) break;
          }
          desk ??= island('workshop', 'desk', 0.5, ARCADE_HOLDER_PURPOSE.tech);
          if (desk) {
            this.add('workshop', d.onTop(desk, 'solderingStation', -0.38, 0, PROP_DEFS.desk.h), d.onTop(desk, 'crtTerminal', 0.45, -0.05, PROP_DEFS.desk.h));
          } else this.skip('repair bench');
        }
        chest ??= island('workshop', 'rollingToolChest', 0.5, ARCADE_HOLDER_PURPOSE.tech);
        if (chest) this.add('workshop', this.onTopOf(chest, 'handToolbox', PROP_DEFS.rollingToolChest.h));
        else this.skip('tool chest');
        if (!put('workshop', 'staffLockers', {purpose: ARCADE_HOLDER_PURPOSE.staff}) && !this.lockersByDoor(id)) this.skip('staff lockers');
        put('workshop', 'crtTvCart', {front: 0.6}) ?? island('workshop', 'crtTvCart', 0.5);
        put('workshop', 'storageTote');
        put('workshop', 'cardboardBoxFlaps');
        for (const [k, y] of [['toolPegboard', 1.0], ['partsBinRack', 0.95]] as [PropKind, number][]) this.mountIn(ctx, room, k, y, base, 'workshop');
      } else {
        if (!put('office', 'staffLockers', {purpose: ARCADE_HOLDER_PURPOSE.staff})) put('office', 'filingCabinet');
      }
    }
  }
  /**
   * A lined stock room: the staff lockers on the sales floor near its staff door instead (the free wall spot nearest the door within
   * 6 m, outside the door's clear zone), their doors to the floor.
   */
  private lockersByDoor(room: number): PropPlacement | null {
    const door = this.d.layout.doors.find(q => (q.a === room && this.ids.has(q.b)) || (q.b === room && this.ids.has(q.a)));
    if (!door) return null;
    const fa = this.d.layout.areas[this.ids.has(door.a) ? door.a : door.b], [du, dv] = this.uvOf(doorPoint(door, fa)), w = PROP_DEFS.staffLockers.w;
    const spots: [Seg, number, number][] = [];
    for (const s of this.segs) for (let t = upCell(s.t0); t + w <= s.t1 + 1e-6; t += CELL) {
      const [u, v] = this.offWall(s, t + w / 2, 0.3), dist = Math.hypot(u - du, v - dv);
      if (dist <= 6) spots.push([s, t, dist]);
    }
    for (const [s, t] of spots.sort((a, b) => a[2] - b[2])) {
      const got = this.runAt(s, t, [['staffLockers', 0]], 0.6)[0];
      if (got) { got.purpose = ARCADE_HOLDER_PURPOSE.staff; this.add('staff', got); return got; }
    }
    return null;
  }
  /** On-top decor on a static floor host (its top `top` m above the host's base), centred. */
  private onTopOf(host: PropPlacement, kind: PropKind, top: number): PropPlacement | null {
    return this.d.onTop(host, kind, 0, 0, top);
  }
  /** A wall mount in a back room at `y` m (a backed solid wall clear of props and doorways). */
  private mountIn(ctx: PlaceCtx, room: Area, kind: PropKind, y: number, base: number, role: string): void {
    const sides: Side[] = this.d.rng.shuffle(['N', 'S', 'E', 'W'] as Side[]);
    for (const side of sides) {
      const alongX = side === 'N' || side === 'S', [lo, hi] = alongX ? [room.x * CELL, (room.x + room.w) * CELL] : [room.y * CELL, (room.y + room.h) * CELL];
      for (let t = lo + PROP_DEFS[kind].w / 2 + 0.3; t <= hi - PROP_DEFS[kind].w / 2 - 0.3; t += 0.5) {
        const p = mountProp(ctx, room, side, t, kind, r3(base + Math.max(y, WALL_MOUNT_Y)), 0);
        if (p) { this.d.placed.push(p); this.add(role, p); return; }
      }
    }
  }
}

/** The store's sales-floor frame (tests / QA). */
export function arcadeFrame(layout: StationLayout, anchor: SkywaysAnchor): HallFrame { return hallFrame(layout.areas[anchor.floor], anchor.front); }
