// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-BOOKS): PAPER PRAIRIE BOOKS at layout version >= 3 — a real
// independent bookshop over the anchor's floors and back rooms (gen/skyways/stores/books.ts is its spec). Pure data (no three.js).
//
// The store (u along the shop front, v deep; placement through the anchor kit, destinations/skywaysShopsAKit.ts AnchorKit — door /
// stair clearances, walking lanes from the entry, no piece cut off, no box overlap):
//  - the CASH DESK by the entry: the Mall's cash-wrap back counter (M01, openable: five drawers + a cupboard) backed to a solid wall,
//    a one / two-module shop counter in front of it (customer side out, the till on the module nearest the door), a staff aisle
//    between them; else a counter run beside the entry with a dresser (M45, openable drawers) behind its staff aisle;
//  - FEATURE TABLES in the front band (the tiered oak tables: "NEW & NOTABLE", "PRAIRIE AUTHORS" signs standing on their tops);
//  - CATEGORY BAYS along the back / flank walls: oak bookcases backed to the wall between perpendicular back-to-back SPURS (U-shaped
//    browsing bays), a carved category sign on each bay's header (fiction, local history, maps & travel — its cases are the Mall's
//    openable bookcase with map drawers —, poetry, prairie authors);
//  - the STACKS: double-sided bookcase island runs in aisles from the front, an end-cap sign on each run's front end;
//  - the READING NOOK: two wingbacks facing each other over a side table on the Persian rug, the arc floor lamp behind them;
//  - two-level format, the other storey (mezzanine / lower floor; carpet): the CHILDREN'S CORNER (the play rug, bean bags, a teddy,
//    the children's dresser with picture books on top, its bay), the RARE BOOKS corner (glass display cabinets, the staff desk with its
//    chair) and more bays / runs / a second nook. The hall format fits a small children's corner and the rare-books cabinets downstairs;
//  - BACK ROOMS (the station dresser's shelving / cartons stay): book cartons (M47, openable flaps), a tall cabinet in the stock room,
//    a filing cabinet / low cabinet in the office; no back room (older carves): a staff stock corner behind the cash desk.
// Books are loose stock (rule 4): skyDBookStack props on the bookcases' measured shelves, the tables' tiers, the dresser / desk tops —
// never baked; the openable hosts' loot surfaces give up the spans they take (PropPlacement.cut).
//
// Loot (purposes / per-holder overrides; docs/skyways-stores/books.md): the sales floors are 'mall-books', the stock room
// 'mall-books-back', the office 'mall-management'; the children's dresser rolls 'mall-toys', the staff desk 'mall-management', the staff
// stock corner 'mall-books-back'. No floor piles (the store areas are noFloorLoot).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, footprint, type PropKind, type PropPlacement} from '../../props';
import {backed, makePlaceCtx, markCell, tryPlaceProp, wallRange, wallSpot, wallXZ, type PlaceCtx} from '../../placeKit';
import type {Area, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {normYaw, toWorld, yawToward} from '../addonFrame';
import {AnchorKit, r3, snapEdge, type ShopsALane} from '../destinations/skywaysShopsAKit';
import {bookTableTiers, bookcaseShelves, destDims} from '../destinations/kindsShopsA';
import {BOOKS_RUG, BOOKS_RUG_SIZE, BOOKS_SIGN, BOOKS_SIGN_BOARD} from './kinds/books';

/** Per-holder loot keys (gen/purposes.ts, existing purposes). */
export const BOOKS_HOLDER_PURPOSE = {childrens: 'mall-toys', staffDesk: 'mall-management', stockCorner: 'mall-books-back'} as const;
/** Loose book stacks per store (both storeys): a picked-over abandoned shop and a bounded instance count (a ~3k-tri model each). */
export const BOOKS_STACK_BUDGET = 130;
/** Bookcase tops a sign stands on (m above the host's base; the tiered table: its model top over the column lip). */
const SIGN_TOP: Partial<Record<PropKind, () => number>> = {
  skyDBookcase: () => destDims('skyDBookcase').h, bookstoreBookcase: () => PROP_DEFS.bookstoreBookcase.h, glassDisplayCabinet: () => PROP_DEFS.glassDisplayCabinet.h,
  skyDBookTable: () => destDims('skyDBookTable').h,
};
/** The Mall bookcase's open shelf decks (prop frame; gen/mall/kinds.ts MALL_SURFACES.bookstoreBookcase: x +-0.52, z +-0.18). */
const M09_SHELVES = [0.36, 0.85, 1.25, 1.63] as const;
const M09_SHELF = {x: 0.52, z: 0.18, clear: [0.46, 0.37, 0.35, 0.54]} as const;

/** The bays' categories in order (the entrance storey / the other storey). */
const FLOOR_CATS = [BOOKS_SIGN.fiction, BOOKS_SIGN.localHistory, BOOKS_SIGN.mapsTravel, BOOKS_SIGN.poetry, BOOKS_SIGN.prairieAuthors];
const UPPER_CATS = [BOOKS_SIGN.localHistory, BOOKS_SIGN.fiction, BOOKS_SIGN.poetry, BOOKS_SIGN.prairieAuthors, BOOKS_SIGN.mapsTravel];

export interface BooksBay { level: number; sign: number; cases: number[]; spurs: number[] }
/** QA / tests: one store's dressing (indices into layout.props). */
export interface BooksStoreResult {
  anchor: string;
  format: SkywaysAnchor['format'];
  props: number[];
  lanes: ShopsALane[];
  skipped: string[];
  cash: {counters: number[]; wrap: number | null; drawers: number | null; till: number | null; aisle: [number, number, number, number] | null};
  bays: BooksBay[];
  runs: number[][];
  signs: number[];
  nooks: {level: number; rug: number | null; chairs: number[]; lamp: number | null; table: number | null}[];
  kids: {level: number; rug: number | null; seats: number[]; dresser: number | null} | null;
  rare: {level: number; cabinets: number[]; desk: number | null} | null;
  back: {area: number; added: number[]}[];
  stockCorner: number[];
}
const RESULTS = new WeakMap<StationLayout, BooksStoreResult[]>();
/** QA / tests: what dressBooksStore placed in a layout (the generator ignores it). */
export function booksStoreDressOf(layout: StationLayout): readonly BooksStoreResult[] { return RESULTS.get(layout) ?? []; }

/** Dresses one Paper Prairie Books anchor; returns the props placed. */
export function dressBooksStore(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  if (anchor.family !== 'books' || !layout.areas[anchor.floor]) return 0;
  const n0 = layout.props.length;
  const kit = new AnchorKit(layout, rng, anchor);
  const res: BooksStoreResult = {anchor: anchor.id, format: anchor.format, props: [], lanes: kit.lanes, skipped: kit.skipped,
    cash: {counters: [], wrap: null, drawers: null, till: null, aisle: null}, bays: [], runs: [], signs: [], nooks: [], kids: null, rare: null, back: [], stockCorner: []};
  const d = new BooksDresser(kit, res);
  kit.reserveDoors();
  d.salesFloor();
  if (kit.other !== null) d.otherStorey(kit.other);
  d.stockBooks();
  kit.lift();
  const idx = (p: PropPlacement | null | undefined) => (p ? layout.props.indexOf(p) : -1);
  // back rooms (their own placement contexts: the station dresser's furniture stays) — placed in the absolute height frame
  const backs = anchor.stock.map(id => layout.areas[id]).filter(Boolean);
  for (const a of backs) res.back.push({area: a.id, added: backRoom(layout, rng.fork(`books-back-${a.id}`), a).map(idx)});
  if (!backs.length) res.stockCorner = d.stockCornerProps.map(idx);
  for (let i = n0; i < layout.props.length; i++) res.props.push(i);
  d.finish(idx);
  let list = RESULTS.get(layout);
  if (!list) RESULTS.set(layout, (list = []));
  list.push(res);
  return layout.props.length - n0;
}

// =================================================================================================================================

class BooksDresser {
  readonly rng: Rng;
  private readonly signs: PropPlacement[] = [];
  private readonly cases: PropPlacement[] = [];
  private readonly m09: PropPlacement[] = [];
  private readonly tables: PropPlacement[] = [];
  private readonly flatTops: {host: PropPlacement; top: number; n: number}[] = [];
  private readonly bays: {level: number; sign: number; cases: PropPlacement[]; spurs: PropPlacement[]}[] = [];
  private readonly runs: PropPlacement[][] = [];
  private readonly nooks: {level: number; rug: PropPlacement | null; chairs: PropPlacement[]; lamp: PropPlacement | null; table: PropPlacement | null}[] = [];
  private kids: {level: number; rug: PropPlacement | null; seats: PropPlacement[]; dresser: PropPlacement | null} | null = null;
  private rare: {level: number; cabinets: PropPlacement[]; desk: PropPlacement | null} | null = null;
  private cash: {counters: PropPlacement[]; wrap: PropPlacement | null; drawers: PropPlacement | null; till: PropPlacement | null; aisle: [number, number, number, number] | null} = {counters: [], wrap: null, drawers: null, till: null, aisle: null};
  readonly stockCornerProps: PropPlacement[] = [];

  constructor(readonly kit: AnchorKit, readonly res: BooksStoreResult) { this.rng = kit.rng; }

  finish(idx: (p: PropPlacement | null | undefined) => number): void {
    const R = this.res, nn = (p: PropPlacement | null) => (p ? idx(p) : null);
    R.cash = {counters: this.cash.counters.map(idx), wrap: nn(this.cash.wrap), drawers: nn(this.cash.drawers), till: nn(this.cash.till), aisle: this.cash.aisle};
    R.bays = this.bays.map(b => ({level: b.level, sign: b.sign, cases: b.cases.map(idx), spurs: b.spurs.map(idx)}));
    R.runs = this.runs.map(r => r.map(idx));
    R.signs = this.signs.map(idx);
    R.nooks = this.nooks.map(n => ({level: n.level, rug: nn(n.rug), chairs: n.chairs.map(idx), lamp: nn(n.lamp), table: nn(n.table)}));
    R.kids = this.kids && {level: this.kids.level, rug: nn(this.kids.rug), seats: this.kids.seats.map(idx), dresser: nn(this.kids.dresser)};
    R.rare = this.rare && {level: this.rare.level, cabinets: this.rare.cabinets.map(idx), desk: nn(this.rare.desk)};
  }

  // --- the entrance storey ----------------------------------------------------------------------------------------------------

  salesFloor(): void {
    const kit = this.kit, rng = this.rng, L = kit.level;
    this.cashDesk();
    // the reading nook in the far corner (both formats: the shop's armchair corner downstairs)
    this.readingNook(L, 'far');
    kit.reserveLanes();
    // the feature tables in the front band (a sign standing on each)
    const front = this.lattice(L, 'skyDBookTable', {round: true, ring: 0.8, pitch: [3.0, 2.8], v: [2.6, Math.min(kit.fr.D - 2.2, Math.max(3.4, kit.fr.D * 0.36))], max: rng.int(1, 2)});
    front.forEach((t, i) => this.tableSign(t, i === 0 ? BOOKS_SIGN.newNotable : BOOKS_SIGN.prairieAuthors));
    this.tables.push(...front);
    // the hall format: a small children's corner and the rare-books cabinets on this floor
    if (kit.other === null) { this.kidsCorner(L); this.rareBooks(L, false); }
    // the bays round the walls (back wall first), then the island stacks, then more tables where the floor is still open
    this.bayWalls(L, FLOOR_CATS);
    this.islandRuns(L, kit.other === null ? rng.int(5, 9) : rng.int(4, 8), [BOOKS_SIGN.fiction, BOOKS_SIGN.poetry, BOOKS_SIGN.localHistory, BOOKS_SIGN.fiction]);
    this.tables.push(...this.lattice(L, 'skyDBookTable', {round: true, ring: 0.8, pitch: [3.0, 3.0], max: rng.int(0, 2)}));
    this.plants(L);
    if (rng.chance(0.6)) this.stepLadder(L);
    kit.posters(rng.int(2, 3));
    if (!this.kit.an.stock.length) this.stockCorner();
  }

  /** The other storey of a two-level shop (mezzanine / lower floor): children's corner, rare books, bays, stacks, a second nook. */
  otherStorey(L: number): void {
    const kit = this.kit, rng = this.rng;
    this.kidsCorner(L);
    this.rareBooks(L, true);
    this.readingNook(L, 'any');
    this.bayWalls(L, UPPER_CATS);
    this.islandRuns(L, rng.int(3, 7), [BOOKS_SIGN.fiction, BOOKS_SIGN.localHistory, BOOKS_SIGN.poetry]);
    this.tables.push(...this.lattice(L, 'skyDBookTable', {level: L, round: true, ring: 0.8, pitch: [3.0, 3.0], max: rng.int(1, 2)}));
    this.plants(L);
    kit.posters(2, L);
  }

  // --- the cash desk ----------------------------------------------------------------------------------------------------------

  /**
   * The cash desk by the entry: the cash-wrap back counter (M01: drawers + a cupboard, wall-backed, its drawers to the room) on a solid
   * wall near the door, a staff aisle (>= 1.0 m: the drawers' travel) and the shop counter (one / two modules, customer side out) in
   * front of it, the till on the module nearest the entry. Else the counter run beside the entry (its staff aisle behind) with a
   * dresser (M45: four drawers) on the nearest wall behind it.
   */
  private cashDesk(): void {
    const kit = this.kit, wrap = PROP_DEFS.mallCashwrapCounter, ctr = PROP_DEFS.shopCounter, GAP = 0.03;
    // (distances from the wall face, cell-aligned like the areas: the wrap's face, the staff aisle's two free cell rows, the counter)
    const c0 = GAP + wrap.d / 2, a0 = Math.ceil((GAP + wrap.d - 0.04) / CELL) * CELL, a1 = a0 + 2 * CELL, cz = a1 + 0.012 + ctr.d / 2 - c0;
    const [ex, ez] = kit.inside(2.5);
    const spots = kit.wallSpots('mallCashwrapCounter', ex, ez, kit.level).filter((_, i) => i % 2 === 0).slice(0, 36);
    for (const sp of spots) {
      const [u, v] = kit.toUV(sp.x, sp.z);
      if (v > Math.max(6.5, kit.fr.D * 0.5)) continue;
      // (off the entry strip: the desk's near end clear of the entry's half width + 1 m round the entry axis)
      if (Math.abs(u - kit.uE) < kit.entry.half + 1.0 + Math.max(wrap.w, 2 * ctr.w) / 2 && v < 3.6) continue;
      for (const nm of [2, 1]) {
        const got: PropPlacement[] = [];
        const st: {box: [number, number, number, number] | null} = {box: null};
        const ok = kit.cluster(() => {
          const w = kit.put('mallCashwrapCounter', sp.x, sp.z, sp.rot, {area: sp.a});
          if (!w) return false;
          got.push(w);
          // the counter modules in front of it (same yaw: the counter's +Z is its customer side), centred on the wrap
          for (let k = 0; k < nm; k++) {
            const lx = nm === 1 ? 0 : (k - 0.5) * (ctr.w + 0.01);
            const [x, z] = toWorld(w, lx, cz);
            const c = kit.put('shopCounter', x, z, w.rot, {front: 1.0});
            if (!c) return false;
            got.push(c);
          }
          // the staff aisle between them (>= 1.2 m: the drawers' travel): free floor, reserved
          const half = Math.max(wrap.w, nm * ctr.w) / 2;
          const [ax, az] = toWorld(w, -half + 0.05, a0 - c0 + 0.02), [bx, bz] = toWorld(w, half - 0.05, a1 - c0 - 0.02);
          const box: [number, number, number, number] = [r3(Math.min(ax, bx)), r3(Math.min(az, bz)), r3(Math.max(ax, bx)), r3(Math.max(az, bz))];
          if (!kit.boxFree(box[0], box[1], box[2], box[3], kit.level, true)) return false;
          kit.keepBox(box[0], box[1], box[2], box[3]);
          st.box = box;
          return true;
        });
        if (!ok) continue;
        this.cash.wrap = got[0];
        this.cash.counters = got.slice(1);
        this.cash.aisle = st.box;
        this.till();
        return;
      }
    }
    // fallback: the counter run beside the entry (v2's search), a dresser behind its staff aisle
    const run = this.counterRun();
    if (!run.length) { kit.skipped.push('cash desk'); return; }
    this.cash.counters = run;
    this.till();
    const back = run[0];
    const p = kit.putNearWall('dresserDrawers', back.x, back.z, {front: 0.7, tries: 40});
    if (p) { this.cash.drawers = p; this.flatTops.push({host: p, top: PROP_DEFS.dresserDrawers.h, n: 1}); } else kit.skipped.push('cash desk drawers');
  }

  /** The till on the counter module nearest the entry (its top span cut from the counter's loot surface). */
  private till(): void {
    const kit = this.kit, cs = this.cash.counters;
    if (!cs.length) return;
    const near = cs.slice().sort((p, q) => Math.hypot(p.x - kit.entry.x, p.z - kit.entry.z) - Math.hypot(q.x - kit.entry.x, q.z - kit.entry.z))[0];
    const reg = kit.onTop(near, 'cashRegister', 0.25, -0.08, SHOP_COUNTER_TOP_Y);
    if (reg) { (near.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: 0.25 - 0.26, x1: 0.25 + 0.26}); this.cash.till = reg; }
  }

  /** v2's counter run beside the entry (shopsA counter's search, two modules else one), its staff aisle behind it reserved. */
  private counterRun(): PropPlacement[] {
    const kit = this.kit, fr = kit.fr, def = PROP_DEFS.shopCounter, eh = kit.entry.half, uE = kit.uE;
    for (const nm of [2, 1]) for (const s of this.rng.shuffle([1, -1])) for (const dv of [2.0, 2.5, 3.0, 3.5, 4.5]) for (const du of [eh + 1.2, eh + 1.7, eh + 2.4, eh + 3.2, eh + 4.2]) {
      const u = r3(Math.round((uE + s * (du + def.d / 2) + s * def.d / 2) / CELL) * CELL - s * def.d / 2);
      if (u - def.d / 2 - 1.0 < 0.2 || u + def.d / 2 + 1.0 > fr.W - 0.2) continue;
      const rot = s > 0 ? fr.minusU : fr.plusU, v0 = snapEdge(dv + def.w / 2, def.w / 2);
      const got: PropPlacement[] = [];
      const ok = kit.cluster(() => {
        for (let k = 0; k < nm; k++) {
          const [x, z] = kit.uv(u, v0 + k * (def.w + 0.01));
          const p = kit.put('shopCounter', x, z, rot, {front: 1.0});
          if (!p) return false;
          got.push(p);
        }
        const [ax, az] = kit.uv(u + s * (def.d / 2 + 0.02), v0 - def.w / 2), [bx, bz] = kit.uv(u + s * (def.d / 2 + 0.9), v0 + def.w * (nm - 0.5) + 0.01);
        const box = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)] as const;
        if (!kit.boxFree(box[0], box[1], box[2], box[3], kit.level, true)) return false;
        kit.keepBox(box[0], box[1], box[2], box[3]);
        this.cash.aisle = [r3(box[0]), r3(box[1]), r3(box[2]), r3(box[3])];
        return true;
      });
      if (ok) return got;
    }
    return [];
  }

  /** No back room (older carves): a staff stock corner — steel shelving and a tall cabinet on the wall nearest the cash desk. */
  private stockCorner(): void {
    const kit = this.kit, c = this.cash.wrap ?? this.cash.counters[0];
    const [x, z] = c ? [c.x, c.z] : kit.inside(3);
    for (const kind of ['cabinetTall', 'stockShelf', 'cardboardBoxFlaps'] as PropKind[]) {
      const p = kit.putNearWall(kind, x, z, {front: kind === 'cardboardBoxFlaps' ? 0 : 0.8, tries: 60});
      if (p) { p.purpose = BOOKS_HOLDER_PURPOSE.stockCorner; this.stockCornerProps.push(p); }
    }
    if (!this.stockCornerProps.length) kit.skipped.push('staff stock corner');
  }

  // --- bays ---------------------------------------------------------------------------------------------------------------------

  /** Bays along the storey's walls: the back wall first, then the flanks, then the front wall's solid stretches. */
  private bayWalls(L: number, cats: readonly number[]): void {
    const kit = this.kit, fr = kit.fr, st = kit.st(L);
    const flanks = (['N', 'S', 'E', 'W'] as Side[]).filter(s => s !== fr.front && s !== fr.back);
    let k = 0;
    const next = () => cats[k++ % cats.length];
    for (const side of [fr.back, ...this.rng.shuffle(flanks), fr.front]) {
      for (const a of st.areas.filter(q => !kit.zones.includes(q))) {
        for (const bay of this.bayWall(L, a, side, next, side === fr.front ? 2 : 6)) this.bays.push(bay);
      }
    }
    // a sign on each bay with two or more cases (its header: centred over the bay's wall cases)
    for (const b of this.bays.filter(q => q.level === L && !q.cases.some(c => this.signs.some(s => Math.hypot(s.x - c.x, s.z - c.z) < 1.2)))) {
      if (b.cases.length >= 2 || (b.cases.length === 1 && b.spurs.length)) this.bayHeader(b.cases, b.sign);
    }
  }

  /**
   * One wall's bays: groups of two wall cases (the oak bookcase; the Mall's openable bookcase with map drawers for MAPS & TRAVEL), each
   * group closed by a SPUR — two bookcases back to back, perpendicular to the wall, their fronts into the bays on either side.
   */
  private bayWall(L: number, a: Area, side: Side, next: () => number, maxBays: number): {level: number; sign: number; cases: PropPlacement[]; spurs: PropPlacement[]}[] {
    const kit = this.kit, out: {level: number; sign: number; cases: PropPlacement[]; spurs: PropPlacement[]}[] = [];
    const [lo, hi] = wallRange(a, side);
    const half = PROP_DEFS.skyDBookcase.d + 0.005; // the spur's half thickness (two cases back to back)
    let t = lo + 0.03, cat = next();
    while (t < hi - 1.2 && out.length < maxBays) {
      const kind: PropKind = cat === BOOKS_SIGN.mapsTravel && this.m09.length < 4 ? 'bookstoreBookcase' : 'skyDBookcase';
      const w = PROP_DEFS[kind].w, cases: PropPlacement[] = [];
      let tt = t;
      for (let k = 0; k < 2 && tt + w <= hi - 0.03; k++) {
        const c = tt + w / 2;
        if (!kit.solidWall(a, side, c, kind, L)) break;
        const sp = wallSpot(a, side, c, kind);
        const p = kit.put(kind, sp.x, sp.z, sp.rot, {level: L, area: a, front: kind === 'bookstoreBookcase' ? 1.0 : 0.9});
        if (!p) break;
        cases.push(p);
        tt += w + 0.012;
      }
      if (!cases.length) { t += CELL; continue; }
      for (const p of cases) (p.kind === 'bookstoreBookcase' ? this.m09 : this.cases).push(p);
      // the spur closing this bay: its seam on a cell line past the last case
      const T = Math.ceil((tt + half + 0.005) / CELL - 1e-6) * CELL;
      const spurs = T + half < hi - 0.4 ? this.spur(L, a, side, T) : [];
      this.cases.push(...spurs);
      out.push({level: L, sign: cat, cases, spurs});
      cat = next();
      t = spurs.length ? T + half + 0.012 : tt + CELL;
    }
    return out;
  }

  /** A spur: two oak bookcases back to back, perpendicular to the wall at along-wall coordinate T (their seam), from the wall out. */
  private spur(L: number, a: Area, side: Side, T: number): PropPlacement[] {
    const kit = this.kit, def = PROP_DEFS.skyDBookcase, got: PropPlacement[] = [];
    const along = side === 'N' || side === 'S';
    const ok = kit.cluster(() => {
      for (const s of [-1, 1]) {
        const [x, z] = wallXZ(a, side, T + s * (def.d / 2 + 0.005), 0.012 + def.w / 2);
        // its front faces along the wall, away from the seam (into the bay on its side)
        const rot = along ? (s > 0 ? Math.PI / 2 : -Math.PI / 2) : (s > 0 ? 0 : Math.PI);
        const p = kit.put('skyDBookcase', x, z, rot, {level: L, area: a});
        if (!p) return false;
        got.push(p);
      }
      return true;
    }, L);
    return ok ? got : [];
  }

  /** A category header over a group of wall cases (centred over them, at their front edge, on their tops). */
  private bayHeader(cases: PropPlacement[], sign: number): void {
    const c0 = cases[0], c1 = cases[Math.min(1, cases.length - 1)], def = PROP_DEFS[c0.kind];
    const top = SIGN_TOP[c0.kind]?.() ?? def.h;
    const [fx0, fz0] = toWorld(c0, 0, def.d / 2 - BOOKS_SIGN_BOARD.d / 2 - 0.01), [fx1, fz1] = toWorld(c1, 0, def.d / 2 - BOOKS_SIGN_BOARD.d / 2 - 0.01);
    this.sign((fx0 + fx1) / 2, (fz0 + fz1) / 2, c0.y + top, c0.rot, sign, c0, 1);
  }

  /** A sign placement (mounted: no floor cells, out of reach) at world (x, z), base height y (storey-local), facing `rot`. */
  private sign(x: number, z: number, y: number, rot: number, variant: number, near: PropPlacement, scale: number): PropPlacement {
    const {hx, hz} = footprint('skyBooksSign', rot);
    const p = this.kit.push({kind: 'skyBooksSign', x: r3(x), z: r3(z), y: r3(y), rot: r3(normYaw(rot)), area: near.area, hx: r3(hx * scale), hz: r3(hz * scale),
      h: r3(BOOKS_SIGN_BOARD.h * scale), blocksSight: false, variant, mounted: true}, near.level ?? 0);
    this.signs.push(p);
    return p;
  }

  /** A small sign standing on a tiered table's top (over its column), turned to the entry. */
  private tableSign(t: PropPlacement, variant: number): void {
    const kit = this.kit, top = SIGN_TOP.skyDBookTable!();
    const rot = yawToward(kit.entry.x - t.x, kit.entry.z - t.z);
    this.sign(t.x, t.z, t.y + top, rot, variant, t, 0.62);
  }

  // --- island stacks ------------------------------------------------------------------------------------------------------------

  /** Double-sided runs of oak bookcases in aisles from the front (shopsA fillRuns), an end-cap sign on each run's front end. */
  private islandRuns(L: number, max: number, cats: readonly number[]): void {
    const kit = this.kit, fr = kit.fr, def = PROP_DEFS.skyDBookcase;
    const orient: 'u' | 'v' = fr.W >= fr.D ? 'v' : 'u';
    const runs = this.fillRuns(L, 'skyDBookcase', {units: [2, 3], aisle: 1.3, max, orient});
    runs.forEach((run, i) => {
      this.cases.push(...run);
      this.runs.push(run);
      // the end-cap: the run's end nearest the entry storey's front (u-runs: the end nearer the entry axis), facing out of the run
      const pts = run.map(p => kit.toUV(p.x, p.z));
      const alongV = orient === 'v';
      const ends = alongV ? [Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[1]))] : [Math.min(...pts.map(q => q[0])), Math.max(...pts.map(q => q[0]))];
      const mid = alongV ? (Math.min(...pts.map(q => q[0])) + Math.max(...pts.map(q => q[0]))) / 2 : (Math.min(...pts.map(q => q[1])) + Math.max(...pts.map(q => q[1]))) / 2;
      const near = alongV ? 0 : (Math.abs(ends[0] - kit.uE) <= Math.abs(ends[1] - kit.uE) ? 0 : 1);
      const e = ends[near] + (near === 0 ? -1 : 1) * (def.w / 2 - BOOKS_SIGN_BOARD.d / 2 - 0.01);
      const [x, z] = alongV ? kit.uv(mid, e) : kit.uv(e, mid);
      const rot = alongV ? fr.toFront : near === 0 ? fr.minusU : fr.plusU;
      const host = run.slice().sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z))[0];
      this.sign(x, z, host.y + (SIGN_TOP.skyDBookcase!()), rot, cats[i % cats.length], host, 1);
    });
  }

  // --- reading nook / children's corner / rare books ----------------------------------------------------------------------------

  /**
   * The reading nook against a wall: two wingbacks facing each other across a side table on the reading rug, the arc floor lamp along
   * the wall behind them (its shade over one chair); else a free-standing nook (the table, two or three wingbacks round it) on the rug.
   */
  private readingNook(L: number, mode: 'far' | 'any'): boolean {
    const kit = this.kit, ch = PROP_DEFS.skyDWingbackChair, lamp = PROP_DEFS.skyDArcLamp, tb = PROP_DEFS.cafeBistroTable, R = BOOKS_RUG_SIZE;
    const [ox, oz] = L === kit.level ? kit.inside(1) : [kit.mouths.get(L)?.x ?? kit.entry.x, kit.mouths.get(L)?.z ?? kit.entry.z];
    const spots = kit.wallSpots('skyDArcLamp', ox, oz, L).filter((_, i) => i % 2 === 0);
    const order = mode === 'far' ? spots.reverse().slice(0, 40) : this.rng.shuffle(spots).slice(0, 40);
    for (const sp of order) {
      const got: PropPlacement[] = [], chairs: PropPlacement[] = [];
      const st: {table: PropPlacement | null; lamp: PropPlacement | null} = {table: null, lamp: null};
      // the rug's centre: off the wall by the lamp's depth + half the rug (from the lamp's centre line)
      const dz = lamp.d / 2 + 0.03 + R.d / 2;
      const ok = kit.cluster(() => {
        // the lamp along the wall behind the nook (its long arm parallel to the wall: the shade end either way)
        const lp = kit.put('skyDArcLamp', sp.x, sp.z, normYaw(sp.rot + (this.rng.chance(0.5) ? Math.PI : 0)), {level: L, area: sp.a});
        if (!lp) return false;
        got.push(lp);
        st.lamp = lp;
        // the nook's frame: the wall spot's (x along the wall, +z into the room)
        const frame = {x: sp.x, z: sp.z, rot: sp.rot};
        const [cx, cz] = toWorld(frame, 0, dz);
        const table = kit.putRound('cafeBistroTable', Math.round(cx / CELL) * CELL, Math.round(cz / CELL) * CELL, 0, {level: L});
        if (!table) return false;
        got.push(table);
        st.table = table;
        const th = Math.ceil((tb.w / 2 - 0.04) / CELL) * CELL;
        for (const s of [-1, 1]) {
          const [x, z] = toWorld({x: table.x, z: table.z, rot: sp.rot}, s * (th + ch.d / 2 + 0.03), 0);
          const p = kit.put('skyDWingbackChair', x, z, normYaw(sp.rot - s * Math.PI / 2), {level: L});
          if (p) { got.push(p); chairs.push(p); }
        }
        return chairs.length === 2;
      }, L);
      if (!ok || !st.table) continue;
      const rug = this.rug(st.table.x, st.table.z, sp.rot, BOOKS_RUG.reading, st.table);
      this.reserveAround(got, L, 0.6);
      this.nooks.push({level: L, rug, chairs, lamp: st.lamp, table: st.table});
      return true;
    }
    // free-standing: a table with wingbacks round it on the rug
    for (const [x0, z0] of this.spotsFrom(L, mode).slice(0, 60)) {
      const x = Math.round(x0 / CELL) * CELL, z = Math.round(z0 / CELL) * CELL, th = Math.ceil((tb.w / 2 - 0.04) / CELL) * CELL;
      const got: PropPlacement[] = [], chairs: PropPlacement[] = [];
      const st: {table: PropPlacement | null} = {table: null};
      const ok = kit.cluster(() => {
        const table = kit.putRound('cafeBistroTable', x, z, 0, {level: L});
        if (!table) return false;
        got.push(table);
        st.table = table;
        for (const [dx, dz] of this.rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][])) {
          const q = dx !== 0, hx = (q ? ch.d : ch.w) / 2, hz = (q ? ch.w : ch.d) / 2;
          const p = kit.put('skyDWingbackChair', x + dx * (th + hx + 0.02), z + dz * (th + hz + 0.02), yawToward(-dx, -dz), {level: L});
          if (p) { got.push(p); chairs.push(p); }
          if (chairs.length >= 3) break;
        }
        return chairs.length >= 2;
      }, L);
      if (!ok || !st.table) continue;
      // the rug's long side along the chairs' axis (x when they sit east / west of the table)
      const along = chairs.filter(c => Math.abs(c.z - z) < 0.1).length >= chairs.filter(c => Math.abs(c.x - x) < 0.1).length ? 0 : Math.PI / 2;
      const rug = this.rug(x, z, along, BOOKS_RUG.reading, st.table);
      this.reserveAround(got, L, 0.6);
      this.nooks.push({level: L, rug, chairs, lamp: null, table: st.table});
      return true;
    }
    kit.skipped.push(`reading nook (level ${L})`);
    return false;
  }

  /** A rug lying flat under a group (its long side along `rot`'s x axis): pushed without floor masks (walked over, nothing blocked). */
  private rug(x: number, z: number, rot: number, variant: number, near: PropPlacement): PropPlacement {
    const {hx, hz} = footprint('skyBooksRug', rot);
    return this.kit.push({kind: 'skyBooksRug', x: r3(x), z: r3(z), y: 0, rot: r3(normYaw(rot)), area: near.area, hx: r3(hx), hz: r3(hz), h: BOOKS_RUG_SIZE.h, blocksSight: false, variant}, near.level ?? 0);
  }

  /**
   * The children's corner against a wall: the children's dresser (M45, openable drawers; picture books on its top; the toy store's
   * loot), the play rug in front of it with two bean bags on it, a giant teddy beside, the CHILDREN'S BOOKS bay header on the nearest
   * bookcase / the dresser's own wall run of cases.
   */
  private kidsCorner(L: number): void {
    const kit = this.kit, dr = PROP_DEFS.dresserDrawers, bb = PROP_DEFS.beanBag, R = BOOKS_RUG_SIZE;
    const [ox, oz] = L === kit.level ? kit.inside(1) : [kit.mouths.get(L)?.x ?? kit.entry.x, kit.mouths.get(L)?.z ?? kit.entry.z];
    const spots = this.rng.shuffle(kit.wallSpots('dresserDrawers', ox, oz, L).filter((_, i) => i % 2 === 0)).slice(0, 40);
    for (const sp of spots) {
      const got: PropPlacement[] = [], seats: PropPlacement[] = [], cases: PropPlacement[] = [];
      const st: {dresser: PropPlacement | null} = {dresser: null};
      const ok = kit.cluster(() => {
        const dresser = kit.put('dresserDrawers', sp.x, sp.z, sp.rot, {level: L, area: sp.a, front: 0.6});
        if (!dresser) return false;
        got.push(dresser);
        st.dresser = dresser;
        // the rug's centre in front of the dresser (the drawers' strip kept), the bean bags on it side by side, facing the dresser
        const rz = dr.d / 2 + 0.65 + R.d / 2, rot = normYaw(dresser.rot + Math.PI), {hx, hz} = footprint('beanBag', rot);
        for (const s of this.rng.shuffle([-1, 1])) {
          const [x, z] = toWorld(dresser, s * (bb.w / 2 + 0.03), rz);
          const p = kit.put('beanBag', snapEdge(x, hx), snapEdge(z, hz), rot, {level: L});
          if (p) { got.push(p); seats.push(p); }
        }
        if (!seats.length) return false;
        // a bookcase either side of the dresser on the same wall (the bay)
        for (const s of [-1, 1]) {
          const c = (sp.side === 'N' || sp.side === 'S' ? dresser.x : dresser.z) + s * (dr.w / 2 + 0.03 + PROP_DEFS.skyDBookcase.w / 2);
          if (!kit.solidWall(sp.a, sp.side, c, 'skyDBookcase', L)) continue;
          const w = wallSpot(sp.a, sp.side, c, 'skyDBookcase');
          const p = kit.put('skyDBookcase', w.x, w.z, w.rot, {level: L, area: sp.a, front: 0.9});
          if (p) { got.push(p); cases.push(p); }
        }
        return true;
      }, L);
      if (!ok || !st.dresser) continue;
      const d = st.dresser;
      d.purpose = BOOKS_HOLDER_PURPOSE.childrens;
      this.flatTops.push({host: d, top: dr.h, n: 2});
      const [rx, rz] = toWorld(d, 0, dr.d / 2 + 0.65 + R.d / 2);
      const rug = this.rug(rx, rz, d.rot, BOOKS_RUG.children, d);
      this.cases.push(...cases);
      // the teddy beside the rug (now and then)
      if (this.rng.chance(0.65)) {
        for (const s of this.rng.shuffle([-1, 1])) {
          const [x, z] = toWorld(d, s * (R.w / 2 + PROP_DEFS.giantTeddy.w / 2 + 0.1), dr.d / 2 + 0.65 + R.d / 2);
          const p = kit.put('giantTeddy', x, z, normYaw(d.rot + Math.PI), {level: L});
          if (p) { got.push(p); seats.push(p); break; }
        }
      }
      // the header: over the bay's cases (else on the dresser's wall above it: on the case nearest)
      if (cases.length) this.bayHeader(cases.length === 2 ? [cases[0], cases[1]] : cases, BOOKS_SIGN.childrens);
      this.bays.push({level: L, sign: BOOKS_SIGN.childrens, cases, spurs: []});
      this.reserveAround(got, L, 0.5);
      this.kids = {level: L, rug, seats, dresser: d};
      return;
    }
    kit.skipped.push(`children's corner (level ${L})`);
  }

  /**
   * The rare-books corner: two / three glass display cabinets (M02, openable glass doors) along a solid wall, the RARE BOOKS header on
   * the middle one; upstairs also the staff desk (openable drawers; the Mall management office's desk loot) facing the room with its
   * chair, a stack or two of books on its top.
   */
  private rareBooks(L: number, desk: boolean): void {
    const kit = this.kit, gc = PROP_DEFS.glassDisplayCabinet;
    const [ox, oz] = L === kit.level ? (this.cash.wrap ? [this.cash.wrap.x, this.cash.wrap.z] : kit.inside(4)) : [kit.mouths.get(L)?.x ?? kit.entry.x, kit.mouths.get(L)?.z ?? kit.entry.z];
    const want = this.rng.int(2, 3);
    const spots = kit.wallSpots('glassDisplayCabinet', ox, oz, L).filter((_, i) => i % 2 === 0).slice(0, 50);
    for (const sp of (L === kit.level ? spots : this.rng.shuffle(spots))) {
      const got: PropPlacement[] = [];
      const ok = kit.cluster(() => {
        const t0 = sp.side === 'N' || sp.side === 'S' ? sp.x : sp.z;
        for (let k = 0; k < want; k++) {
          const t = t0 + (k - (want - 1) / 2) * (gc.w + 0.03);
          if (!kit.solidWall(sp.a, sp.side, t, 'glassDisplayCabinet', L)) return got.length >= 2;
          const w = wallSpot(sp.a, sp.side, t, 'glassDisplayCabinet');
          const p = kit.put('glassDisplayCabinet', w.x, w.z, w.rot, {level: L, area: sp.a, front: 0.8});
          if (!p) return got.length >= 2;
          got.push(p);
        }
        return true;
      }, L);
      if (!ok || got.length < 2) continue;
      const cabs = got.slice(), mid = cabs[Math.floor(cabs.length / 2)];
      const top = SIGN_TOP.glassDisplayCabinet!();
      const [fx, fz] = toWorld(mid, 0, gc.d / 2 - BOOKS_SIGN_BOARD.d / 2 - 0.01);
      this.sign(fx, fz, mid.y + top, mid.rot, BOOKS_SIGN.rareBooks, mid, 0.85);
      let dk: PropPlacement | null = null;
      if (desk) {
        // the staff desk out in front of the cabinets: its drawer (sitter) side toward them, the chair between (the sitter faces the
        // room, the cases at their back); the desk's far side to the room
        const dd = PROP_DEFS.desk, rot = normYaw(mid.rot + Math.PI), {hx, hz} = footprint('desk', rot);
        for (const off of [gc.d / 2 + 0.8 + 0.1 + PROP_DEFS.officeChair.d + 0.15 + dd.d / 2, gc.d / 2 + 2.4 + dd.d / 2]) {
          const [x, z] = toWorld(mid, this.rng.range(-0.3, 0.3), off);
          const g2: PropPlacement[] = [];
          const ok2 = kit.cluster(() => {
            const p = kit.put('desk', snapEdge(x, hx), snapEdge(z, hz), rot, {level: L});
            if (!p) return false;
            g2.push(p);
            const [cx, cz] = toWorld(p, 0, dd.d / 2 + 0.42);
            const c = kit.put('officeChair', cx, cz, mid.rot, {level: L});
            if (!c) return false;
            g2.push(c);
            return true;
          }, L);
          if (ok2) { dk = g2[0]; got.push(...g2); break; }
        }
        if (dk) { dk.purpose = BOOKS_HOLDER_PURPOSE.staffDesk; this.flatTops.push({host: dk, top: PROP_DEFS.desk.h, n: 1}); } else kit.skipped.push('rare-books staff desk');
      }
      this.reserveAround(got, L, 0.9);
      this.rare = {level: L, cabinets: cabs, desk: dk};
      return;
    }
    kit.skipped.push(`rare books (level ${L})`);
  }

  /** A potted tree / plants flanking the way in (the planter palette), a small plant by a bay. */
  private plants(L: number): void {
    const kit = this.kit, E = kit.entry, tx = -E.nz, tz = E.nx;
    if (L === kit.level) {
      // (outside the reserved entry strip: its edge E.half + 0.76 m off the entry axis)
      for (const s of this.rng.shuffle([-1, 1])) {
        let ok = false;
        for (const dv of [1.0, 1.6]) for (const lat of [E.half + 1.35, E.half + 1.85]) {
          if (!ok && kit.put('planterTree', E.x + E.nx * dv + tx * lat * s, E.z + E.nz * dv + tz * lat * s, 0, {level: L})) ok = true;
        }
      }
    } else {
      const m = kit.mouths.get(L);
      if (m) kit.putNearWall('pottedPlantSmall', m.x, m.z, {level: L, tries: 30});
    }
  }

  /** The step ladder standing at the end of a tall bay (staff reach the top shelves). */
  private stepLadder(L: number): void {
    const kit = this.kit;
    for (const b of this.rng.shuffle(this.bays.filter(q => q.level === L && q.cases.length))) {
      const c = b.cases[b.cases.length - 1];
      const [x, z] = toWorld(c, PROP_DEFS.skyDBookcase.w / 2 + 0.4, PROP_DEFS[c.kind].d / 2 + 0.55);
      if (kit.put('stepLadder', x, z, c.rot, {level: L})) return;
    }
  }

  // --- the loose stock ----------------------------------------------------------------------------------------------------------

  /** The book stacks: the tables' tiers, the flat tops (dresser / desk), the Mall bookcases' shelves, then the oak cases in turn. */
  stockBooks(): void {
    const kit = this.kit, rng = this.rng;
    let left = BOOKS_STACK_BUDGET;
    for (const t of this.tables) left -= this.stockTiers(t, [2, 3]);
    for (const f of this.flatTops) left -= this.stacksOnTop(f.host, f.top, f.n);
    for (const c of this.m09) left -= this.stockM09(c, rng.int(1, 2));
    const cases = rng.shuffle(this.cases.slice());
    const per = Math.max(1, Math.min(4, Math.floor(left / Math.max(1, cases.length))));
    for (const bc of cases) {
      if (left <= 0) break;
      left -= this.stockBookcase(bc, Math.min(left, rng.int(Math.max(1, per - 1), per + 1)));
    }
    if (left < 0) kit.skipped.push(`stacks over budget by ${-left}`);
  }

  /** `n` stacks on an oak bookcase's measured shelves (one per shelf, now and then two side by side), front-aligned. */
  private stockBookcase(bc: PropPlacement, n: number): number {
    const kit = this.kit, rng = this.rng, def = PROP_DEFS.skyDBookcase, sd = PROP_DEFS.skyDBookStack, shelves = bookcaseShelves();
    const inner = def.w / 2 - 0.08, lz = r3(def.d / 2 - 0.04 - sd.d / 2);
    if (lz - sd.d / 2 < -def.d / 2 + 0.02 || 2 * inner < sd.w) return 0;
    const ok = shelves.map((_, i) => i).filter(i => (shelves[i + 1] ?? def.h - 0.12) - shelves[i] >= sd.h + 0.03);
    let placed = 0;
    for (const i of rng.shuffle(ok)) {
      if (placed >= n) break;
      const two = placed + 1 < n && rng.chance(0.3) && 2 * sd.w + 0.04 <= 2 * inner;
      let x = -inner + rng.range(0, Math.max(0, 2 * inner - (two ? 2 * sd.w + 0.04 : sd.w)));
      for (let k = 0; k < (two ? 2 : 1); k++) {
        if (kit.onTop(bc, 'skyDBookStack', r3(x + sd.w / 2), lz, shelves[i])) placed++;
        x += sd.w + 0.04;
      }
    }
    return placed;
  }

  /** Stacks on the Mall bookcase's open shelves (its loot surface gives up their spans). */
  private stockM09(bc: PropPlacement, n: number): number {
    const kit = this.kit, sd = PROP_DEFS.skyDBookStack;
    let placed = 0;
    const shelves = this.rng.shuffle([0, 1, 2, 3].filter(i => M09_SHELF.clear[i] >= sd.h + 0.03));
    for (const i of shelves) {
      if (placed >= n) break;
      const x = r3(this.rng.range(-M09_SHELF.x + sd.w / 2 + 0.02, M09_SHELF.x - sd.w / 2 - 0.02));
      const lz = r3(M09_SHELF.z - sd.d / 2 - 0.01);
      if (!kit.onTop(bc, 'skyDBookStack', x, lz, M09_SHELVES[i])) continue;
      (bc.cut ??= []).push({y: M09_SHELVES[i], x0: r3(x - sd.w / 2 - 0.02), x1: r3(x + sd.w / 2 + 0.02)});
      placed++;
    }
    return placed;
  }

  /** A few stacks on a flat top (dresser / desk), the host's loot surface giving up their spans. */
  private stacksOnTop(host: PropPlacement, top: number, n: number): number {
    const def = PROP_DEFS[host.kind], sd = PROP_DEFS.skyDBookStack;
    if (sd.d > def.d - 0.06) return 0;
    let x = -def.w / 2 + 0.12 + this.rng.range(0, 0.2), placed = 0;
    for (let k = 0; k < n && x + sd.w <= def.w / 2 - 0.12; k++) {
      if (this.kit.onTop(host, 'skyDBookStack', r3(x + sd.w / 2), r3(-def.d / 2 + 0.04 + sd.d / 2), top)) placed++;
      (host.cut ??= []).push({y: top, x0: r3(x - 0.02), x1: r3(x + sd.w + 0.02)});
      x += sd.w + this.rng.range(0.15, 0.45);
    }
    return placed;
  }

  /** Stacks round a tiered table's tiers (radially, on each tier's visible ring; never inside the top tier's hollow column). */
  private stockTiers(t: PropPlacement, per: [number, number]): number {
    const it = PROP_DEFS.skyDBookStack, tiers = bookTableTiers(), col = tiers[tiers.length - 1].rIn;
    let placed = 0;
    tiers.forEach((tier, i) => {
      const above = tiers[i + 1];
      const under = above ? above.y - tier.y - 0.03 >= it.h : false;
      const rMin = (above ? (under ? col : tier.rIn) : tier.rIn) + 0.02;
      const hw = it.w / 2, hd = it.d / 2;
      const rc = Math.sqrt(Math.max(0, (tier.r - 0.03) ** 2 - hw * hw)) - hd;
      if (rc - hd < rMin) return;
      const step = 2 * Math.atan((hw + 0.03) / (rc - hd));
      const n = Math.min(Math.floor((2 * Math.PI) / step), this.rng.int(per[0], per[1]));
      const a0 = this.rng.range(0, 2 * Math.PI);
      for (let k = 0; k < n; k++) {
        const a = a0 + (k * 2 * Math.PI) / n;
        const p = this.kit.onTop(t, 'skyDBookStack', r3(Math.sin(a) * rc), r3(Math.cos(a) * rc), tier.y, normYaw(t.rot + a));
        if (p) { const c = Math.abs(Math.cos(t.rot + a)), s = Math.abs(Math.sin(t.rot + a)); p.hx = r3(c * hw + s * hd); p.hz = r3(s * hw + c * hd); placed++; }
      }
    });
    return placed;
  }

  // --- layout helpers (shopsA's, on this store's kit) ---------------------------------------------------------------------------

  /** Islands of `kind` on a lattice over the storey's floor (frame u / v), tried in a shuffled order. */
  private lattice(L: number, kind: PropKind, o: {level?: number; round?: boolean; ring?: number; pitch: [number, number]; u?: [number, number]; v?: [number, number]; max: number}): PropPlacement[] {
    const kit = this.kit, fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[] = [];
    if (o.max <= 0) return out;
    const level = o.level ?? L;
    const [u0, u1] = o.u ?? [1.2 + def.w / 2, fr.W - 1.2 - def.w / 2], [v0, v1] = o.v ?? [2.6 + def.d / 2, fr.D - 1.2 - def.d / 2];
    const spots: [number, number][] = [];
    const nu = Math.max(1, Math.floor((u1 - u0) / o.pitch[0]) + 1), nv = Math.max(1, Math.floor((v1 - v0) / o.pitch[1]) + 1);
    const su = u0 + ((u1 - u0) - (nu - 1) * o.pitch[0]) / 2, sv = v0 + ((v1 - v0) - (nv - 1) * o.pitch[1]) / 2;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) spots.push([su + i * o.pitch[0], sv + j * o.pitch[1]]);
    for (const [u, v] of this.rng.shuffle(spots)) {
      if (out.length >= o.max) break;
      const [x, z] = kit.uv(u, v);
      const sx = snapEdge(x, def.w / 2), sz = snapEdge(z, def.d / 2);
      const p = o.round ? kit.putRound(kind, sx, sz, fr.toFront, {level, ring: o.ring}) : kit.put(kind, sx, sz, fr.toFront, {level, ring: o.ring});
      if (p) out.push(p);
    }
    return out;
  }

  /** Double-sided island runs (shopsA fillRuns): two rows back to back on a cell line, `units` long, aisles `aisle` m wide. */
  private fillRuns(L: number, kind: PropKind, o: {units: [number, number]; aisle: number; max: number; orient: 'u' | 'v'}): PropPlacement[][] {
    const kit = this.kit, fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[][] = [];
    if (o.max <= 0) return out;
    const along = o.orient === 'u';
    const pitch = Math.max(def.w + 0.02, (Math.floor((def.w - 0.04) / CELL) + 1) * CELL);
    const us: number[] = [], vs: number[] = [];
    for (let u = CELL; u <= fr.W - CELL; u += CELL) us.push(u);
    for (let v = 2.5; v <= fr.D - CELL; v += CELL) vs.push(v);
    if (this.rng.chance(0.5)) us.reverse();
    vs.reverse();
    for (const v of vs) for (const u of us) {
      if (out.length >= o.max) return out;
      const n = this.rng.int(o.units[0], o.units[1]);
      const got: PropPlacement[] = [];
      const ok = kit.cluster(() => {
        for (let k = 0; k < n; k++) {
          const side: PropPlacement[] = [];
          for (const s of [-1, 1]) {
            const t = k * pitch + def.w / 2;
            const [pu, pv] = along ? [u + t, v + s * def.d / 2] : [u + s * def.d / 2, v + t];
            const rot = along ? (s < 0 ? fr.toFront : fr.toBack) : (s < 0 ? fr.minusU : fr.plusU);
            const [x, z] = kit.uv(pu, pv);
            const p = kit.put(kind, x, z, rot, {level: L, front: o.aisle});
            if (p) side.push(p);
          }
          got.push(...side);
          if (side.length < 2) return k > 0;
        }
        return true;
      }, L);
      if (ok) out.push(got);
    }
    return out;
  }

  /** Candidate centres over the storey (frame u / v), the far corner first or shuffled. */
  private spotsFrom(L: number, mode: 'far' | 'any'): [number, number][] {
    const kit = this.kit, fr = kit.fr, out: [number, number][] = [];
    for (let u = 2.0; u <= fr.W - 2.0; u += 1.0) for (let v = 2.6; v <= fr.D - 2.0; v += 1.0) out.push(kit.uv(u, v));
    const [ox, oz] = L === kit.level ? kit.inside(1) : [kit.mouths.get(L)?.x ?? kit.entry.x, kit.mouths.get(L)?.z ?? kit.entry.z];
    if (mode === 'far') return out.sort((p, q) => Math.hypot(q[0] - ox, q[1] - oz) - Math.hypot(p[0] - ox, p[1] - oz));
    return this.rng.shuffle(out);
  }

  /** Reserves the free floor round a group (its bounding box + margin). */
  private reserveAround(ps: PropPlacement[], L: number, margin: number): void {
    if (!ps.length) return;
    const x0 = Math.min(...ps.map(p => p.x - p.hx)) - margin, x1 = Math.max(...ps.map(p => p.x + p.hx)) + margin;
    const z0 = Math.min(...ps.map(p => p.z - p.hz)) - margin, z1 = Math.max(...ps.map(p => p.z + p.hz)) + margin;
    this.kit.keepBox(x0, z0, x1, z1, L);
  }
}

// =================================================================================================================================
// Back rooms

/** The back-room additions per room type: the stock room's book cartons + a tall cabinet, the office's filing / low cabinets. */
const BACK_ADD: Readonly<Record<string, readonly [PropKind, number, number][]>> = {
  // [kind, count, front strip (m)]
  'stock-room': [['cabinetTall', 1, 0.7], ['cardboardBoxFlaps', 3, 0], ['filingCabinet', 1, 0.75]],
  'agent-office': [['filingCabinet', 1, 0.75], ['cabinetLow', 1, 0.7], ['bookstoreBookcase', 1, 0.8]],
};

/**
 * A back room's additions against its walls (its own placement context at its storey: the station dresser's shelving / cartons /
 * desk stay where they are, their fronts and the door zone kept clear). Returns the props added (absolute heights).
 */
function backRoom(layout: StationLayout, rng: Rng, a: Area): PropPlacement[] {
  const level = a.level ?? 0;
  const ctx = makePlaceCtx(layout, rng, level, {x0: a.x - 3, y0: a.y - 3, x1: a.x + a.w + 3, y1: a.y + a.h + 3});
  const g = ctx.g;
  // the existing furniture's fronts: kept (its doors / drawers / shelves stay reachable)
  for (const p of layout.props) {
    if (p.area !== a.id || p.mounted || p.host !== undefined) continue;
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot)), d = PROP_DEFS[p.kind]?.d ?? 0.5, w = PROP_DEFS[p.kind]?.w ?? 0.5;
    const sx = p.x + fx * (d / 2 + 0.4), sz = p.z + fz * (d / 2 + 0.4), hx = fx ? 0.4 : w / 2, hz = fz ? 0.4 : w / 2;
    for (let cy = Math.floor((sz - hz + 0.04) / CELL); cy <= Math.floor((sz + hz - 0.04) / CELL); cy++) for (let cx = Math.floor((sx - hx + 0.04) / CELL); cx <= Math.floor((sx + hx - 0.04) / CELL); cx++) {
      if (g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] === FLOOR && g.area[g.idx(cx, cy)] === a.id) markCell(ctx, ctx.keep, g.idx(cx, cy));
    }
  }
  const added: PropPlacement[] = [];
  for (const [kind, n, front] of BACK_ADD[a.type] ?? []) {
    for (let k = 0; k < n; k++) {
      const p = againstWall(ctx, a, kind, front, rng);
      if (!p) break;
      added.push(p);
    }
  }
  // absolute floor height (the anchor kit lifts its own; these are placed straight in the storey's frame)
  for (const p of added) {
    const [cx, cy] = g.cellOf(p.x, p.z);
    p.y = r3(p.y + (g.inBounds(cx, cy) ? g.floorOf(g.idx(cx, cy)) : (a.floorY ?? 0)));
  }
  return added;
}

/** One `kind` backed to a solid wall of the room (sides shuffled, a 0.25 m scan), or null. */
function againstWall(ctx: PlaceCtx, a: Area, kind: PropKind, front: number, rng: Rng): PropPlacement | null {
  const def = PROP_DEFS[kind], base = a.floorY ?? 0;
  for (const side of rng.shuffle(['N', 'S', 'E', 'W'] as Side[])) {
    const [lo, hi] = wallRange(a, side);
    const ts: number[] = [];
    for (let t = lo + 0.1 + def.w / 2; t <= hi - 0.1 - def.w / 2; t += 0.25) ts.push(t);
    for (const t of rng.shuffle(ts)) {
      if (!backed(ctx, a, side, t - def.w / 2, t + def.w / 2, base + 0.05) || !backed(ctx, a, side, t - def.w / 2, t + def.w / 2, base + Math.min(def.h, 2.2) - 0.05)) continue;
      const sp = wallSpot(a, side, t, kind);
      const p = tryPlaceProp(ctx, a, kind, r3(sp.x), r3(sp.z), sp.rot, front ? {front} : {});
      if (p) return p;
    }
  }
  return null;
}
