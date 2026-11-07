// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-DESIGN): the LARCH & LOOM HOME dresser (layout version >= 3) — a
// Scandinavian home-design showroom over the anchor's sales floor, its other storey (two-level) and its back rooms. Pure data.
//
// What a visitor finds (u along the shop front, v deep; the placement kit: destinations/skywaysShopsAKit.ts AnchorKit — the entry
// strip, door strips, stair-mouth discs and walking lanes reserved first, every piece through the shared placement primitive):
//  - the DESIGN DESK by the entry: the Mall's white cash-wrap back counter (M01: drawers + a cupboard door, openable) against a wall,
//    a staff aisle, and the service counter (one or two counter modules, a till on one) facing the floor;
//  - the TEXTILES front band: display tables (merchTable) of folded wool throws / towels (skyDsTextiles stacks on their tops);
//  - the KITCHEN display: a run of kitchenettes along a wall (base cupboards with hinged doors, worktop, sink, wall cupboard: openable),
//    an island table with stools (café chairs) and a stack of tea towels on it;
//  - ROOM VIGNETTES, each on its own rug (skyDsRug): the living room (sofa to the wall, an ottoman as the coffee table, two armchairs
//    across, the arc lamp, a side table, a plant), the dining set (the live-edge table, chairs round it, sometimes a dresser as the
//    sideboard), the bedroom (the showroom bed's head to the wall, a four-drawer bedside chest beside it — the other side a second
//    chest or a bedside table —, a lidded blanket chest at its foot);
//  - the LIGHTING gallery: a row of arc lamps backed to a wall on a rug, glass vitrines beside it, a table of desk lamps (its storage
//    rolls a lighting department's spare cells: per-holder purpose DESIGN_LIGHTING_PURPOSE);
//  - pale-timber bookcases (open shelves over two base drawers) and four-drawer dressers along the free walls, plants, the store's
//    Codex poster;
//  - the two-level shop's other storey (mezzanine / lower floor) is the BEDROOM + LIGHTING showroom (bedrooms, the lighting gallery, a
//    reading corner, bedding tables);
//  - the BACK ROOMS (anchor.stock; every v3 store has one): flat-pack cartons (the Mall's openable flap-top boxes), lidded storage
//    totes, staff lockers and a staff fridge added to the station dresser's stock shelving; with none, a staff stock corner by the desk.
// Every storage piece is an EXISTING openable kind (OPENABLE_AUDIT); the store's own kinds are the rugs and the folded textiles.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, type PropKind, type PropPlacement} from '../../props';
import {WALL_ROT, begin, commit, makePlaceCtx, rollback, tryPlaceProp, wallRange, wallSpot, wallXZ, type PlaceCtx} from '../../placeKit';
import type {Area, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {normYaw, toWorld} from '../addonFrame';
import {AnchorKit, r3, snapEdge, type ShopsALane} from '../destinations/skywaysShopsAKit';
import {DESIGN_RUG, DESIGN_RUGS, DESIGN_TEXTILES} from './kinds/design';

/** Loot key of the lighting gallery's storage (an existing purpose: the electronics store's spare cells / flares). */
export const DESIGN_LIGHTING_PURPOSE = 'mall-electronics';
/** Loot key of a staff stock corner on the sales floor (no back room): the home store's own back-of-house rows. */
export const DESIGN_STAFF_PURPOSE = 'mall-home-back';
/** Staff aisle behind the service counter (m, whole cells). */
export const DESIGN_DESK_AISLE = 1.0;

export type DesignSetKind = 'desk' | 'kitchen' | 'living' | 'dining' | 'bedroom' | 'lighting' | 'reading' | 'textiles' | 'staff';
export interface DesignSet { kind: DesignSetKind; level: number; props: PropPlacement[]; rug?: PropPlacement }
/** QA / tests: one anchor's dressing (the generator ignores it). */
export interface DesignResult {
  anchor: string;
  format: SkywaysAnchor['format'];
  level: number;
  other: number | null;
  /** Indices into layout.props of everything this dresser placed. */
  props: number[];
  lanes: ShopsALane[];
  skipped: string[];
  sets: DesignSet[];
  /** What was added to each back room (area id, type). */
  back: {area: number; type: string; props: PropPlacement[]}[];
  /** The wall shelving per storey (bookcases, dressers). */
  walls: {level: number; bookcases: PropPlacement[]; dressers: PropPlacement[]}[];
}
const RESULTS = new WeakMap<StationLayout, DesignResult[]>();
/** QA / tests: what the design dresser placed in a layout. */
export function skywaysDesignDressOf(layout: StationLayout): readonly DesignResult[] { return RESULTS.get(layout) ?? []; }

interface Ctx { kit: AnchorKit; res: DesignResult; rugs: {level: number; x0: number; z0: number; x1: number; z1: number}[]; rugN: number }

const quarterTurned = (rot: number) => Math.abs(Math.sin(rot)) > 0.7;
/**
 * Pitch (m) of units of width `w` packed side by side so they never share a placement cell (whole cells; the cell test lets a box reach
 * 4 cm into a free cell), and a run's start `t` (its first unit's centre along the wall) moved so that unit's low edge sits on a cell
 * line: the next unit then starts on a clean cell.
 */
export const designPitch = (w: number): number => r3(Math.max(w + 0.01, (Math.floor((w - 0.04) / CELL) + 1) * CELL));
const snapRun = (t: number, w: number): number => r3(Math.round((t - w / 2) / CELL) * CELL + w / 2);
/** World AABB [x0, z0, x1, z1] of a host-local rect (quarter-turn hosts). */
function localBox(host: {x: number; z: number; rot: number}, lx0: number, lz0: number, lx1: number, lz1: number): [number, number, number, number] {
  const a = toWorld(host, lx0, lz0), b = toWorld(host, lx1, lz1);
  return [r3(Math.min(a[0], b[0])), r3(Math.min(a[1], b[1])), r3(Math.max(a[0], b[0])), r3(Math.max(a[1], b[1]))];
}

/** Dresses the design store's anchor; returns the props placed. */
export function dressDesignStore(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  if (!layout.areas[anchor.floor]) return 0;
  const kit = new AnchorKit(layout, rng, anchor);
  const res: DesignResult = {anchor: anchor.id, format: anchor.format, level: kit.level, other: kit.other, props: [], lanes: kit.lanes, skipped: kit.skipped, sets: [], back: [], walls: []};
  const C: Ctx = {kit, res, rugs: [], rugN: rng.int(0, DESIGN_RUGS.length - 1)};
  kit.reserveDoors();
  const desk = designDesk(C);
  kit.reserveLanes();
  const L = kit.level, U = kit.other;
  // the entrance storey: the textiles band by the door, the kitchen, the living / dining (and in a hall: bedroom, lighting) vignettes
  textileTables(C, L, rng.int(2, 3), [2.4, Math.max(4.2, Math.min(6.5, kit.fr.D * 0.32))]);
  if (!kitchen(C, L)) kit.skipped.push('kitchen display');
  // (the wall-backed sets before the island ones: the lighting row needs ~4 m of free wall)
  const firsts: [string, (c: Ctx, l: number) => boolean][] = U === null
    ? [['living room', livingSet], ['bedroom', bedroomSet], ['lighting gallery', lighting], ['dining set', diningSet]]
    : [['living room', livingSet], ['dining set', diningSet]];
  for (const [what, f] of firsts) if (!f(C, L)) kit.skipped.push(`${what} on the sales floor`);
  moreSets(C, L, U === null ? [livingIsland, diningSet, bedroomSet, readingCorner] : [livingIsland, diningSet, livingSet, readingCorner], 3);
  wallFill(C, L);
  // (what floor is left in the middle: a table or two more of throws)
  textileTables(C, L, rng.int(1, 2), [3.0, kit.fr.D - 1.6], true);
  kit.posters(3);
  // the other storey of a two-level shop: the bedroom + lighting showroom (bedding tables, bedrooms, the lighting gallery, a nook)
  if (U !== null) {
    textileTables(C, U, rng.int(1, 2), [1.6, kit.fr.D - 1.6]);
    for (let i = 0, n = rng.int(2, 3); i < n; i++) if (!bedroomSet(C, U) && i === 0) kit.skipped.push('bedroom on the other storey');
    if (!lighting(C, U)) kit.skipped.push('lighting gallery (other storey)');
    // (a vignette the sales floor had no room for moves up / down)
    for (const [kind, f] of [['living', livingSet], ['dining', diningSet]] as const) if (!C.res.sets.some(s => s.kind === kind)) f(C, U);
    moreSets(C, U, [readingCorner, bedroomSet, livingIsland, livingSet], 3);
    wallFill(C, U);
    textileTables(C, U, rng.int(1, 2), [1.6, kit.fr.D - 1.6], true);
    kit.posters(2, U);
  }
  backOfHouse(C, desk);
  kit.lift();
  for (let i = kit.p0; i < layout.props.length; i++) res.props.push(i);
  let list = RESULTS.get(layout);
  if (!list) RESULTS.set(layout, (list = []));
  list.push(res);
  return layout.props.length - kit.p0;
}

// =================================================================================================================================
// The design desk

/**
 * The cash-wrap back counter against the wall nearest the entry, the service counter (two modules, else one) parallel in front of it
 * across a staff aisle (whole cells, open at an end), the till on the module nearest the door. Fallback: the cash-wrap alone.
 */
function designDesk(C: Ctx): PropPlacement | null {
  const {kit} = C, cw = PROP_DEFS.mallCashwrapCounter, sc = PROP_DEFS.shopCounter;
  const [ex, ez] = kit.inside(2.5);
  // depth (from the wall) the cash-wrap's cells reach, then the aisle (whole cells), then the counter
  const wrapCells = Math.ceil((0.03 + cw.d - 0.04) / CELL - 1e-6) * CELL;
  const lzCounter = r3(wrapCells + DESIGN_DESK_AISLE + 0.005 - (0.03 + cw.d / 2) + sc.d / 2);
  const spots = kit.wallSpots('mallCashwrapCounter', ex, ez, kit.level).filter((_, i) => i % 2 === 0);
  for (const sp of spots.slice(0, 50)) {
    if (Math.hypot(sp.x - ex, sp.z - ez) > 14) break;
    for (const n of [2, 1]) {
      const got: PropPlacement[] = [];
      // (the counters' low edge on a cell line: two modules pack without sharing a cell)
      const pitch = designPitch(sc.w), tt = snapRun(sp.t, n === 2 ? sc.w + pitch : sc.w);
      if (!kit.solidWall(sp.a, sp.side, tt, 'mallCashwrapCounter')) continue;
      const at = wallSpot(sp.a, sp.side, tt, 'mallCashwrapCounter');
      const ok = kit.cluster(() => {
        const w = kit.put('mallCashwrapCounter', at.x, at.z, at.rot, {area: sp.a});
        if (!w) return false;
        got.push(w);
        for (let k = 0; k < n; k++) {
          const lx = n === 1 ? 0 : (k - 0.5) * pitch;
          const [x, z] = toWorld(w, lx, lzCounter);
          const c = kit.put('shopCounter', x, z, w.rot, {front: 1.0});
          if (!c) return false;
          got.push(c);
        }
        // the staff aisle between the cash-wrap and the counters, open at (at least) one end
        const half = (n === 1 ? sc.w : sc.w + pitch) / 2, z0 =wrapCells - (0.03 + cw.d / 2) + 0.02, z1 = z0 + DESIGN_DESK_AISLE - 0.04;
        const mid = localBox(w, -half, z0, half, z1);
        if (!kit.boxFree(mid[0], mid[1], mid[2], mid[3], kit.level, true)) return false;
        const ends = [localBox(w, -half - 0.9, z0, -half, z1), localBox(w, half, z0, half + 0.9, z1)].filter(b => kit.boxFree(b[0], b[1], b[2], b[3], kit.level, true));
        if (!ends.length) return false;
        for (const b of [mid, ...ends]) kit.keepBox(b[0], b[1], b[2], b[3]);
        return true;
      });
      if (!ok) continue;
      // the till on the module nearest the entry
      const counters = got.slice(1).sort((p, q) => Math.hypot(p.x - ex, p.z - ez) - Math.hypot(q.x - ex, q.z - ez));
      const till = counters[0];
      if (kit.onTop(till, 'cashRegister', 0.25, -0.08, SHOP_COUNTER_TOP_Y)) (till.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: 0.25 - 0.26, x1: 0.25 + 0.26});
      C.res.sets.push({kind: 'desk', level: kit.level, props: got});
      return got[0];
    }
  }
  const w = kit.putNearWall('mallCashwrapCounter', ex, ez, {front: 1.0, tries: 80});
  if (w) { C.res.sets.push({kind: 'desk', level: kit.level, props: [w]}); kit.skipped.push('design desk: the cash-wrap without its service counter'); return w; }
  kit.skipped.push('design desk');
  return null;
}

// =================================================================================================================================
// Rugs

/** Every cell under a box is floor of the storey's sales pieces (no stair / ramp / edge), and no other rug overlaps it. */
function rugFree(C: Ctx, level: number, x0: number, z0: number, x1: number, z1: number): boolean {
  const s = C.kit.st(level), g = s.g;
  if (C.rugs.some(r => r.level === level && r.x0 < x1 - 0.01 && r.x1 > x0 + 0.01 && r.z0 < z1 - 0.01 && r.z1 > z0 + 0.01)) return false;
  for (let cy = Math.floor((z0 + 0.01) / CELL); cy <= Math.floor((z1 - 0.01) / CELL); cy++) for (let cx = Math.floor((x0 + 0.01) / CELL); cx <= Math.floor((x1 - 0.01) / CELL); cx++) {
    if (!g.inBounds(cx, cy)) return false;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || !s.ids.has(g.area[i]) || s.ctx.edge[i] || C.kit.zones.some(z => z.id === g.area[i])) return false;
  }
  return true;
}

/**
 * A rug over the world box (x0, z0)-(x1, z1), shrunk side by side (5 cm steps) until every cell under it is open sales floor; null
 * when it would be smaller than `min` (m) either way. Flat, mounted (it never blocks a cell: the furniture stands on it).
 */
function layRug(C: Ctx, level: number, box: [number, number, number, number], min = 1.4): PropPlacement | null {
  let [x0, z0, x1, z1] = box.map(v => Math.round(v * 20) / 20);
  for (let it = 0; it < 80 && !rugFree(C, level, x0, z0, x1, z1); it++) {
    // shrink the side whose edge strip holds a bad cell (the first found, scanning the four edges)
    const strip = 0.06;
    if (!rugFree(C, level, x0, z0, x0 + strip, z1)) x0 += 0.05;
    else if (!rugFree(C, level, x1 - strip, z0, x1, z1)) x1 -= 0.05;
    else if (!rugFree(C, level, x0, z0, x1, z0 + strip)) z0 += 0.05;
    else if (!rugFree(C, level, x0, z1 - strip, x1, z1)) z1 -= 0.05;
    else { x0 += 0.05; x1 -= 0.05; z0 += 0.05; z1 -= 0.05; } // (an inner cell: shrink all round)
    if (x1 - x0 < min || z1 - z0 < min) return null;
  }
  if (x1 - x0 < min || z1 - z0 < min || !rugFree(C, level, x0, z0, x1, z1)) return null;
  const cx = r3((x0 + x1) / 2), cz = r3((z0 + z1) / 2), area = C.kit.areaAt(cx, cz, level);
  if (!area) return null;
  const p = C.kit.push({kind: 'skyDsRug', x: cx, z: cz, y: 0, rot: 0, area: area.id, hx: r3((x1 - x0) / 2), hz: r3((z1 - z0) / 2), h: DESIGN_RUG.h, blocksSight: false,
    variant: C.rugN++ % DESIGN_RUGS.length, mounted: true}, level);
  C.rugs.push({level, x0, z0, x1, z1});
  return p;
}

/** Reserves the free floor round a group (its bounding box + margin): the next group keeps a walking lane from it. */
function reserveAround(kit: AnchorKit, ps: PropPlacement[], level: number, margin: number): void {
  if (!ps.length) return;
  const x0 = Math.min(...ps.map(p => p.x - p.hx)) - margin, x1 = Math.max(...ps.map(p => p.x + p.hx)) + margin;
  const z0 = Math.min(...ps.map(p => p.z - p.hz)) - margin, z1 = Math.max(...ps.map(p => p.z + p.hz)) + margin;
  kit.keepBox(x0, z0, x1, z1, level);
}

/** A set placed (its rug laid, its floor reserved, recorded). */
function done(C: Ctx, kind: DesignSetKind, level: number, got: PropPlacement[], rugBox: [number, number, number, number] | null, margin = 0.6): void {
  const rug = rugBox ? layRug(C, level, rugBox) ?? undefined : undefined;
  reserveAround(C.kit, rug ? [...got, rug] : got, level, margin);
  C.res.sets.push({kind, level, props: got, ...(rug ? {rug} : {})});
}

// =================================================================================================================================
// Pieces

/** The storey's way in (the entry inside the door / the stair mouth). */
function wayIn(kit: AnchorKit, level: number): [number, number] {
  if (level === kit.level) return kit.inside(3);
  const m = kit.mouths.get(level);
  return m ? [m.x, m.z] : kit.inside(3);
}

/** A set's wall-backed anchor piece: the wall spots of the storey in a shuffled order (every 0.75 m). */
function wallAnchors(kit: AnchorKit, kind: PropKind, level: number, turn = 0, sides?: Side[]): {a: Area; side: Side; t: number; x: number; z: number; rot: number}[] {
  const [ox, oz] = wayIn(kit, level);
  return kit.rng.shuffle(kit.wallSpots(kind, ox, oz, level, sides, turn).filter((_, i) => i % 3 === 0)).slice(0, 50);
}

/** `kind` at the first of the host-local positions that places (rot absolute). */
function putFirst(kit: AnchorKit, kind: PropKind, host: {x: number; z: number; rot: number}, cands: [number, number][], rot: number, level: number, front?: number): PropPlacement | null {
  for (const [lx, lz] of cands) {
    const [x, z] = toWorld(host, lx, lz);
    const p = kit.put(kind, x, z, rot, {level, front});
    if (p) return p;
  }
  return null;
}

/** Folded textiles on a host's top at host-local (lx, lz); the host's loot surface gives up their span. */
function textilesOn(kit: AnchorKit, host: PropPlacement, top: number, lx: number, lz: number, variant: number): PropPlacement | null {
  const def = PROP_DEFS[host.kind], t = DESIGN_TEXTILES;
  if (Math.abs(lx) + t.w / 2 > def.w / 2 - 0.02 || Math.abs(lz) + t.d / 2 > def.d / 2 - 0.01) return null;
  const p = kit.onTop(host, 'skyDsTextiles', r3(lx), r3(lz), top);
  if (!p) return null;
  p.variant = variant;
  const cut = (host.cut ??= []);
  if (!cut.some(c => c.y === top && c.x0 <= lx - t.w / 2 && c.x1 >= lx + t.w / 2)) cut.push({y: top, x0: r3(lx - t.w / 2 - 0.02), x1: r3(lx + t.w / 2 + 0.02)});
  return p;
}
const throwVariant = (kit: AnchorKit) => kit.rng.pick(DESIGN_TEXTILES.throws);
const towelVariant = (kit: AnchorKit) => kit.rng.pick(DESIGN_TEXTILES.towels);

/** Islands of `kind` on a lattice over the storey's floor (frame u / v), tried in a shuffled order; rows stay aligned. */
function lattice(kit: AnchorKit, kind: PropKind, o: {level: number; ring?: number; pitch: [number, number]; v?: [number, number]; max: number; front?: number}): PropPlacement[] {
  const fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[] = [];
  if (o.max <= 0) return out;
  const [u0, u1] = [1.2 + def.w / 2, fr.W - 1.2 - def.w / 2], [v0, v1] = o.v ?? [2.6 + def.d / 2, fr.D - 1.2 - def.d / 2];
  const spots: [number, number][] = [];
  const nu = Math.max(1, Math.floor((u1 - u0) / o.pitch[0]) + 1), nv = Math.max(1, Math.floor((v1 - v0) / o.pitch[1]) + 1);
  const su = u0 + ((u1 - u0) - (nu - 1) * o.pitch[0]) / 2, sv = v0 + ((v1 - v0) - (nv - 1) * o.pitch[1]) / 2;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) spots.push([su + i * o.pitch[0], sv + j * o.pitch[1]]);
  for (const [u, v] of kit.rng.shuffle(spots)) {
    if (out.length >= o.max) break;
    const rot = fr.toFront;
    const [x, z] = kit.uv(u, v);
    const q = quarterTurned(rot), hx = (q ? def.d : def.w) / 2, hz = (q ? def.w : def.d) / 2;
    const p = kit.put(kind, snapEdge(x, hx), snapEdge(z, hz), rot, {level: o.level, ring: o.ring, front: o.front});
    if (p) out.push(p);
  }
  return out;
}

// --- the textiles band -------------------------------------------------------------------------------------------------------------

/** Display tables of folded throws (now and then towels): two or four stacks each, the middle of the top left for its stock. */
function textileTables(C: Ctx, level: number, n: number, v: [number, number], fill = false): void {
  const {kit} = C, mt = PROP_DEFS.merchTable;
  let tables = lattice(kit, 'merchTable', {level, ring: 0.9, pitch: [2.8, 2.6], v: [v[0] + mt.d / 2, Math.max(v[0] + mt.d / 2, v[1] - mt.d / 2)], max: n});
  if (!tables.length && !fill) tables = lattice(kit, 'merchTable', {level, ring: 0.9, pitch: [2.8, 2.6], max: n});
  tables.forEach((t, i) => {
    const towels = i === 1 && kit.rng.chance(0.6);
    const rows = kit.rng.chance(0.5) ? [-0.22, 0.22] : [0];
    for (const lx of [-0.5, 0.5]) for (const lz of rows) textilesOn(kit, t, mt.h, lx, lz, towels ? towelVariant(kit) : throwVariant(kit));
    C.res.sets.push({kind: 'textiles', level, props: [t]});
  });
  if (!tables.length && !fill) kit.skipped.push(`textile tables (level ${level})`);
}

// --- the kitchen display -----------------------------------------------------------------------------------------------------------

/** A run of kitchenettes along a wall (the back wall / a flank first), an island table with stools in front, tea towels on it. */
function kitchen(C: Ctx, level: number): boolean {
  const {kit} = C, k = PROP_DEFS.kitchenette, mt = PROP_DEFS.merchTable, ch = PROP_DEFS.cafeChair, fr = kit.fr;
  const flanks = (['N', 'S', 'E', 'W'] as Side[]).filter(s => s !== fr.front && s !== fr.back);
  const spots = [...wallAnchors(kit, 'kitchenette', level, 0, [fr.back]), ...wallAnchors(kit, 'kitchenette', level, 0, flanks)].slice(0, 60);
  const pitch = designPitch(k.w);
  for (const units of [kit.rng.int(2, 3), 2]) for (const sp of spots) {
    const got: PropPlacement[] = [];
    const t0 = snapRun(sp.t, k.w);
    const ok = kit.cluster(() => {
      for (let i = 0; i < units; i++) {
        const t = t0 + i * pitch;
        if (!kit.solidWall(sp.a, sp.side, t, 'kitchenette', level)) return false;
        const at = wallSpot(sp.a, sp.side, t, 'kitchenette');
        const p = kit.put('kitchenette', at.x, at.z, at.rot, {level, area: sp.a, front: 0.9});
        if (!p) return false;
        got.push(p);
      }
      // the island across the aisle (its back past the run's reserved front strip), stools on its far side facing it
      const first = got[0], last = got[got.length - 1], mid = {x: (first.x + last.x) / 2, z: (first.z + last.z) / 2, rot: first.rot};
      let island: PropPlacement | null = null;
      for (const depth of [2.0, 2.5]) {
        const lz = depth - (0.03 + k.d / 2) + mt.d / 2;
        island = putFirst(kit, 'merchTable', mid, [[0, lz]], mid.rot, level);
        if (island) break;
      }
      if (!island) return false;
      got.push(island);
      const stools = units >= 3 ? [-0.55, 0, 0.55] : [-0.45, 0.45];
      for (const sx of stools) {
        const p = putFirst(kit, 'cafeChair', island, [[sx, mt.d / 2 + 0.1 + ch.d / 2], [sx, mt.d / 2 + 0.3 + ch.d / 2]], normYaw(island.rot + Math.PI), level);
        if (p) got.push(p);
      }
      return true;
    }, level);
    if (!ok) continue;
    const island = got.find(p => p.kind === 'merchTable')!;
    textilesOn(kit, island, mt.h, 0.5, 0, towelVariant(kit));
    done(C, 'kitchen', level, got, null, 0.5);
    return true;
  }
  return false;
}

// --- room vignettes ------------------------------------------------------------------------------------------------------------------

/** The arc lamp's yaw beside a wall-backed piece of yaw `rot` (destinations/shopsA.ts: base by the wall, the arm out over the floor). */
const lampYaw = (rot: number): number => normYaw(rot + Math.PI / 2);
/** The showroom bed's model runs along X with its headboard at -X (destinations/shopsA.ts BED_TURN): head to the wall. */
const BED_TURN = -Math.PI / 2;

/** The living room: sofa to the wall, an ottoman as the coffee table, two armchairs across it, the arc lamp, a side table, a plant. */
function livingSet(C: Ctx, level: number): boolean {
  return living(C, level, false);
}
/** The living room as a free-standing ISLAND on the open floor (the sofa's back to an aisle): fills a showroom's middle. */
function livingIsland(C: Ctx, level: number): boolean {
  return living(C, level, true);
}
function living(C: Ctx, level: number, island: boolean): boolean {
  const {kit} = C, sofa = PROP_DEFS.skyDSofa, ot = PROP_DEFS.ottoman, lamp = PROP_DEFS.skyDArcLamp, tb = PROP_DEFS.cafeBistroTable, fr = kit.fr;
  const anchors: {a?: Area; x: number; z: number; rot: number}[] = island ? [] : wallAnchors(kit, 'skyDSofa', level);
  if (island) {
    const [ox, oz] = wayIn(kit, level);
    const spots: [number, number][] = [];
    for (let u = 3.0; u <= fr.W - 3.0; u += 1.0) for (let v = 3.5; v <= fr.D - 3.0; v += 1.0) spots.push(kit.uv(u, v));
    for (const [x, z] of kit.rng.shuffle(spots).slice(0, 60)) {
      if (Math.hypot(x - ox, z - oz) < 3) continue;
      const rot = kit.rng.pick([fr.toFront, fr.toBack, fr.plusU, fr.minusU]), q = quarterTurned(rot);
      anchors.push({x: snapEdge(x, (q ? sofa.d : sofa.w) / 2), z: snapEdge(z, (q ? sofa.w : sofa.d) / 2), rot});
    }
  }
  for (const sp of anchors) {
    const got: PropPlacement[] = [];
    let far = 0;
    const ok = kit.cluster(() => {
      const s = kit.put('skyDSofa', sp.x, sp.z, sp.rot, {level, ...(sp.a ? {area: sp.a} : {})});
      if (!s) return false;
      got.push(s);
      const zo = sofa.d / 2 + 0.45 + ot.d / 2;
      const o = putFirst(kit, 'ottoman', s, [[0, zo], [0, zo + 0.15]], s.rot, level);
      if (!o) return false;
      got.push(o);
      const chair: PropKind = kit.rng.chance(0.5) ? 'loungeArmchair' : 'skyDEggChair', cd = PROP_DEFS[chair].d;
      const zc = zo + ot.d / 2 + 0.55 + cd / 2;
      let chairs = 0;
      for (const sx of [-0.6, 0.6]) {
        const c = putFirst(kit, chair, s, [[sx, zc], [sx, zc + 0.25], [sx * 1.25, zc]], normYaw(s.rot + Math.PI), level);
        if (c) { got.push(c); chairs++; far = Math.max(far, zc + cd / 2); }
      }
      if (!chairs || (island && chairs < 2)) return false;
      const side = kit.rng.chance(0.5) ? 1 : -1;
      const pl = putFirst(kit, 'skyDArcLamp', s, [[side * (sofa.w / 2 + 0.06 + lamp.d / 2), -sofa.d / 2 + lamp.w / 2], [side * (sofa.w / 2 + 0.3 + lamp.d / 2), -sofa.d / 2 + lamp.w / 2]], lampYaw(s.rot), level);
      if (pl) got.push(pl);
      const [tx, tz] = toWorld(s, -side * (sofa.w / 2 + 0.12 + tb.w / 2), 0);
      const pt = kit.putRound('cafeBistroTable', tx, tz, 0, {level});
      if (pt) got.push(pt);
      const pp = putFirst(kit, 'pottedPlantSmall', s, [[-side * (sofa.w / 2 + 0.2 + tb.w + 0.3), -sofa.d / 2 + 0.3], [side * (sofa.w / 2 + 0.3), zc]], 0, level);
      if (pp) got.push(pp);
      return true;
    }, level);
    if (!ok) continue;
    const s = got[0];
    done(C, 'living', level, got, localBox(s, -(sofa.w / 2 + 0.3), island ? -sofa.d / 2 + 0.1 : sofa.d / 2 - 0.3, sofa.w / 2 + 0.3, far - 0.25), island ? 0.8 : 0.6);
    return true;
  }
  return false;
}

/** The dining set: the live-edge table as an island with chairs round it; now and then a dresser as the sideboard on a nearby wall. */
function diningSet(C: Ctx, level: number): boolean {
  const {kit} = C, tb = PROP_DEFS.skyDDiningTable, ch = PROP_DEFS.cafeChair, fr = kit.fr, [ox, oz] = wayIn(kit, level);
  const spots: [number, number][] = [];
  for (let u = 2.4; u <= fr.W - 2.4; u += 1.0) for (let v = 3.0; v <= fr.D - 2.4; v += 1.0) spots.push(kit.uv(u, v));
  for (const [x0, z0] of kit.rng.shuffle(spots).slice(0, 90)) {
    if (Math.hypot(x0 - ox, z0 - oz) < 2.5) continue;
    const rot = kit.rng.chance(0.5) ? fr.toFront : fr.plusU;
    const q = quarterTurned(rot), hx = (q ? tb.d : tb.w) / 2, hz = (q ? tb.w : tb.d) / 2;
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const t = kit.put('skyDDiningTable', snapEdge(x0, hx), snapEdge(z0, hz), rot, {level});
      if (!t) return false;
      got.push(t);
      const halfD = Math.ceil((tb.d / 2 - 0.04) / CELL) * CELL, halfW = Math.ceil((tb.w / 2 - 0.04) / CELL) * CELL;
      const n = Math.max(2, Math.min(4, Math.floor((tb.w - 0.2) / 0.62)));
      for (const s of [-1, 1]) for (let k = 0; k < n; k++) {
        const p = putFirst(kit, 'cafeChair', t, [[(k - (n - 1) / 2) * 0.66, s * (halfD + ch.d / 2 + 0.02)]], s < 0 ? t.rot : normYaw(t.rot + Math.PI), level);
        if (p) got.push(p);
      }
      for (const s of [-1, 1]) {
        if (!kit.rng.chance(0.5)) continue;
        const p = putFirst(kit, 'cafeChair', t, [[s * (halfW + ch.d / 2 + 0.02), 0]], normYaw(t.rot - s * Math.PI / 2), level);
        if (p) got.push(p);
      }
      return got.length >= 5;
    }, level);
    if (!ok) continue;
    const xs = got.map(p => [p.x - p.hx, p.x + p.hx]).flat(), zs = got.map(p => [p.z - p.hz, p.z + p.hz]).flat();
    const rugBox: [number, number, number, number] = [Math.min(...xs) - 0.25, Math.min(...zs) - 0.25, Math.max(...xs) + 0.25, Math.max(...zs) + 0.25];
    done(C, 'dining', level, got, rugBox);
    // the sideboard (a dresser with a throw on it) on the nearest free wall, when one is close
    if (kit.rng.chance(0.6)) {
      const t = got[0], sb = kit.putNearWall('dresserDrawers', t.x, t.z, {level, front: 0.8, tries: 24});
      if (sb && Math.hypot(sb.x - t.x, sb.z - t.z) < 5.5) { textilesOn(kit, sb, PROP_DEFS.dresserDrawers.h, 0.38, 0, throwVariant(kit)); C.res.sets[C.res.sets.length - 1].props.push(sb); }
      else if (sb) C.res.sets.push({kind: 'dining', level, props: [sb]});
    }
    return true;
  }
  return false;
}

/**
 * The bedroom: the showroom bed's head to a wall, a four-drawer bedside chest beside it (the other side a second chest or a bedside
 * table), a lidded blanket chest at its foot, a plant; on a rug under the bed's foot end.
 */
function bedroomSet(C: Ctx, level: number): boolean {
  const {kit} = C, bed = PROP_DEFS.skyDShowroomBed, dd = PROP_DEFS.dresserDrawers, fl = PROP_DEFS.footlocker, tb = PROP_DEFS.cafeBistroTable;
  for (const sp of wallAnchors(kit, 'skyDShowroomBed', level, BED_TURN)) {
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const b = kit.put('skyDShowroomBed', sp.x, sp.z, sp.rot, {level, area: sp.a});
      if (!b) return false;
      got.push(b);
      // in the bed's own frame the wall is at -X (its headboard), its long sides face +/-Z, its foot is +X
      const wallRot = normYaw(b.rot - BED_TURN), lxWall = -bed.w / 2 + dd.d / 2;
      const side = kit.rng.chance(0.5) ? 1 : -1;
      const gaps = [0.1, 0.22, 0.35, 0.5];
      const chest = putFirst(kit, 'dresserDrawers', b, gaps.map(g => [lxWall, side * (bed.d / 2 + g + dd.w / 2)] as [number, number]), wallRot, level, 0.6);
      if (!chest) return false;
      got.push(chest);
      textilesOn(kit, chest, dd.h, kit.rng.chance(0.5) ? 0.38 : -0.38, 0, throwVariant(kit));
      const other = kit.rng.chance(0.4)
        ? putFirst(kit, 'dresserDrawers', b, gaps.map(g => [lxWall, -side * (bed.d / 2 + g + dd.w / 2)] as [number, number]), wallRot, level, 0.6)
        : null;
      if (other) got.push(other);
      else {
        for (const g of gaps) {
          const [x, z] = toWorld(b, -bed.w / 2 + tb.d / 2 + 0.05, -side * (bed.d / 2 + g + tb.w / 2));
          const p = kit.putRound('cafeBistroTable', x, z, 0, {level});
          if (p) { got.push(p); break; }
        }
      }
      // the blanket chest across the foot of the bed (its lid lifts: no front strip)
      const foot = putFirst(kit, 'footlocker', b, [0.12, 0.25, 0.4].map(g => [bed.w / 2 + g + fl.d / 2, 0] as [number, number]), normYaw(b.rot + Math.PI / 2), level);
      if (foot) got.push(foot);
      const pp = putFirst(kit, 'pottedPlantSmall', b, [[-bed.w / 2 + 0.3, side * (bed.d / 2 + 0.3 + dd.w + 0.35)], [-bed.w / 2 + 0.3, -side * (bed.d / 2 + 1.2)]], 0, level);
      if (pp) got.push(pp);
      return true;
    }, level);
    if (!ok) continue;
    const b = got[0];
    done(C, 'bedroom', level, got, localBox(b, -bed.w / 2 + 0.55, -(bed.d / 2 + 0.6), bed.w / 2 + 0.85, bed.d / 2 + 0.6));
    return true;
  }
  return false;
}

/** A reading corner: the egg chair backed to a wall, the arc lamp reaching over it, a side table, on a small rug. */
function readingCorner(C: Ctx, level: number): boolean {
  const {kit} = C, egg = PROP_DEFS.skyDEggChair, lamp = PROP_DEFS.skyDArcLamp, tb = PROP_DEFS.cafeBistroTable;
  for (const sp of wallAnchors(kit, 'skyDEggChair', level).slice(0, 30)) {
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const e = kit.put('skyDEggChair', sp.x, sp.z, sp.rot, {level, area: sp.a, front: 0.8});
      if (!e) return false;
      got.push(e);
      const side = kit.rng.chance(0.5) ? 1 : -1;
      const pl = putFirst(kit, 'skyDArcLamp', e, [[side * (egg.w / 2 + 0.06 + lamp.d / 2), -egg.d / 2 + lamp.w / 2]], lampYaw(e.rot), level);
      if (pl) got.push(pl);
      const [tx, tz] = toWorld(e, -side * (egg.w / 2 + 0.12 + tb.w / 2), 0);
      const pt = kit.putRound('cafeBistroTable', tx, tz, 0, {level});
      if (pt) got.push(pt);
      return got.length >= 2;
    }, level);
    if (!ok) continue;
    const e = got[0];
    done(C, 'reading', level, got, localBox(e, -(egg.w / 2 + 0.5), -egg.d / 2 + 0.25, egg.w / 2 + 0.5, egg.d / 2 + 0.9));
    return true;
  }
  return false;
}

/** More vignettes until the floor is full (a few misses in a row, or `max` more). */
function moreSets(C: Ctx, level: number, order: ((c: Ctx, l: number) => boolean)[], max: number): void {
  let n = 0, miss = 0;
  for (const f of C.kit.rng.shuffle(order.slice())) {
    if (n >= max || miss >= 2) break;
    if (f(C, level)) { n++; miss = 0; } else miss++;
  }
}

// --- the lighting gallery ------------------------------------------------------------------------------------------------------------

/**
 * A row of arc lamps (three or four; two where the walls are short) backed to a wall (bases at the wall, shades out over the floor) on a rug, a glass vitrine at an end
 * of the row, a table of desk lamps in front. The vitrine and the table hold a lighting department's spare cells (per-holder purpose).
 */
function lighting(C: Ctx, level: number): boolean {
  const {kit} = C, lamp = PROP_DEFS.skyDArcLamp, gdc = PROP_DEFS.glassDisplayCabinet, mt = PROP_DEFS.merchTable, dl = PROP_DEFS.draftingLamp;
  const pitch = designPitch(lamp.d), turn = Math.PI / 2;
  for (const n of [kit.rng.int(3, 4), 3, 2]) for (const sp of wallAnchors(kit, 'skyDArcLamp', level, turn).slice(0, 40)) {
    const got: PropPlacement[] = [];
    const t0 = snapRun(sp.t, lamp.d), lo0 = t0 - lamp.d / 2;
    const ok = kit.cluster(() => {
      for (let i = 0; i < n; i++) {
        const t = t0 + i * pitch;
        if (!kit.solidWall(sp.a, sp.side, t, 'skyDArcLamp', level, lamp.d)) return false;
        const [x, z] = wallXZ(sp.a, sp.side, t, lamp.w / 2 + 0.03);
        const p = kit.put('skyDArcLamp', x, z, sp.rot, {level, area: sp.a});
        if (!p) return false;
        got.push(p);
      }
      // a vitrine at one end of the row (its glass doors open forward: a front strip)
      const [lo, hi] = wallRange(sp.a, sp.side);
      // (beside the row's end cells: the low end just under the first lamp's cell line, the high end past the last lamp's cells)
      for (const t of [lo0 - 0.05 - gdc.w / 2, lo0 + n * pitch + 0.02 + gdc.w / 2]) {
        if (t - gdc.w / 2 < lo + 0.2 || t + gdc.w / 2 > hi - 0.2 || !kit.solidWall(sp.a, sp.side, t, 'glassDisplayCabinet', level)) continue;
        const at = wallSpot(sp.a, sp.side, t, 'glassDisplayCabinet');
        const v = kit.put('glassDisplayCabinet', at.x, at.z, at.rot, {level, area: sp.a, front: 0.8});
        if (v) { v.purpose = DESIGN_LIGHTING_PURPOSE; got.push(v); break; }
      }
      return true;
    }, level);
    if (!ok) continue;
    // the desk-lamp table in front of the row (past the lamps' reach), its long side along the wall
    const first = got[0], last = got[n - 1], wallRot = WALL_ROT[sp.side];
    const mid = {x: (first.x + last.x) / 2, z: (first.z + last.z) / 2, rot: wallRot};
    const back = lamp.w / 2; // (mid sits lamp.w / 2 + 0.03 off the wall)
    const table = putFirst(kit, 'merchTable', mid, [2.9, 3.4, 3.9].map(d => [0, d - back + mt.d / 2] as [number, number]), wallRot, level);
    if (table) {
      table.purpose = DESIGN_LIGHTING_PURPOSE;
      got.push(table);
      const lx = kit.rng.chance(0.5) ? -0.4 : 0.4;
      if (dl.d <= mt.d - 0.04) {
        const p = kit.onTop(table, 'draftingLamp', lx, 0, mt.h);
        if (p) (table.cut ??= []).push({y: mt.h, x0: r3(lx - dl.w / 2 - 0.02), x1: r3(lx + dl.w / 2 + 0.02)});
      }
    }
    const lamps = got.filter(p => p.kind === 'skyDArcLamp');
    const xs = lamps.flatMap(p => [p.x - p.hx, p.x + p.hx]), zs = lamps.flatMap(p => [p.z - p.hz, p.z + p.hz]);
    done(C, 'lighting', level, got, [Math.min(...xs) - 0.3, Math.min(...zs) - 0.3, Math.max(...xs) + 0.3, Math.max(...zs) + 0.3]);
    return true;
  }
  return false;
}

// --- walls -----------------------------------------------------------------------------------------------------------------------------

/** Pale-timber bookcases (two by two) and a dresser or two along the free walls, plants in the gaps, a planter tree or two. */
function wallFill(C: Ctx, level: number): void {
  const {kit} = C, rng = kit.rng;
  const sides = rng.shuffle(['N', 'S', 'E', 'W'] as Side[]);
  const cases = kit.wallRun('bookstoreBookcase', {level, sides, cluster: 2, gap: 1.6, max: rng.int(2, 4), front: 0.9});
  const dressers = kit.wallRun('dresserDrawers', {level, sides: rng.shuffle(sides.slice()), cluster: 1, gap: 2.5, max: rng.int(1, 2), front: 0.8});
  for (const d of dressers) textilesOn(kit, d, PROP_DEFS.dresserDrawers.h, rng.chance(0.5) ? 0.38 : -0.38, 0, throwVariant(kit));
  kit.wallRun('pottedPlantSmall', {level, sides: rng.shuffle(sides.slice()), cluster: 1, gap: 3.5, max: rng.int(2, 3)});
  lattice(kit, 'planterTree', {level, ring: 0.6, pitch: [3.0, 3.0], max: rng.int(1, 2)});
  C.res.walls.push({level, bookcases: cases, dressers});
}

// =================================================================================================================================
// Back of house

/** `kind` against a wall of a back room (first free spot over the shuffled sides, every 0.25 m), no box overlapping another prop. */
function backPut(layout: StationLayout, ctx: PlaceCtx, a: Area, kind: PropKind, front?: number): PropPlacement | null {
  const def = PROP_DEFS[kind];
  for (const side of ctx.rng.shuffle(['N', 'S', 'E', 'W'] as Side[])) {
    const [lo, hi] = wallRange(a, side);
    const ts: number[] = [];
    for (let t = lo + 0.3 + def.w / 2; t <= hi - 0.3 - def.w / 2; t += 0.25) ts.push(t);
    for (const t of ctx.rng.shuffle(ts)) {
      const sp = wallSpot(a, side, t, kind);
      begin(ctx);
      const p = tryPlaceProp(ctx, a, kind, r3(sp.x), r3(sp.z), sp.rot, {front});
      const lv = p?.level ?? 0;
      if (p && layout.props.some(q => q !== p && !q.mounted && q.host === undefined && (q.level ?? 0) === lv && Math.abs(q.x - p.x) < q.hx + p.hx - 0.01 && Math.abs(q.z - p.z) < q.hz + p.hz - 0.01)) { rollback(ctx); continue; }
      if (!p) { rollback(ctx); continue; }
      commit(ctx);
      return p;
    }
  }
  return null;
}

/** A small `kind` on the open floor of a back room within two cells of a wall (cell-aligned; the room stays connected). */
function backFloorPut(layout: StationLayout, ctx: PlaceCtx, a: Area, kind: PropKind): PropPlacement | null {
  const def = PROP_DEFS[kind], cands: [number, number, number][] = [];
  for (const rot of [0, Math.PI / 2]) {
    const q = rot !== 0, hx = (q ? def.d : def.w) / 2, hz = (q ? def.w : def.d) / 2;
    for (let cy = a.y; cy < a.y + a.h; cy++) for (let cx = a.x; cx < a.x + a.w; cx++) {
      const x = r3(cx * CELL + hx + 0.02), z = r3(cy * CELL + hz + 0.02);
      const nearWall = Math.min(cx - a.x, a.x + a.w - 1 - cx, cy - a.y, a.y + a.h - 1 - cy) <= 2;
      if (nearWall && x + hx < (a.x + a.w) * CELL - 0.02 && z + hz < (a.y + a.h) * CELL - 0.02) cands.push([x, z, rot]);
    }
  }
  for (const [x, z, rot] of ctx.rng.shuffle(cands).slice(0, 80)) {
    begin(ctx);
    const p = tryPlaceProp(ctx, a, kind, x, z, rot);
    const lv = p?.level ?? 0;
    if (!p || layout.props.some(q => q !== p && !q.mounted && q.host === undefined && (q.level ?? 0) === lv && Math.abs(q.x - p.x) < q.hx + p.hx - 0.01 && Math.abs(q.z - p.z) < q.hz + p.hz - 0.01)) { rollback(ctx); continue; }
    commit(ctx);
    return p;
  }
  return null;
}

/**
 * The back rooms: flat-pack cartons (openable flap-top boxes), lidded totes, staff lockers and a staff fridge in the stock room; a
 * carton or two and lockers in the office. With no back room: a staff stock corner (tall cupboard, shelving, cartons) by the desk.
 */
function backOfHouse(C: Ctx, desk: PropPlacement | null): void {
  const {kit} = C, layout = kit.layout, rng = kit.rng;
  for (const id of kit.an.stock) {
    const a = layout.areas[id];
    if (!a) continue;
    const level = a.level ?? 0;
    const ctx = makePlaceCtx(layout, rng, level, {x0: a.x - 3, y0: a.y - 3, x1: a.x + a.w + 3, y1: a.y + a.h + 3});
    const got: PropPlacement[] = [];
    // (cartons and totes: against a wall, else on the open floor near one — the station dresser's shelving often lines every wall)
    const add = (kind: PropKind, n: number, front?: number, floor = false) => {
      for (let i = 0; i < n; i++) { const p = backPut(layout, ctx, a, kind, front) ?? (floor ? backFloorPut(layout, ctx, a, kind) : null); if (!p) break; got.push(p); }
    };
    const has = (kind: PropKind) => layout.props.some(p => p.area === a.id && p.kind === kind);
    if (a.type === 'stock-room') {
      if (!has('staffLockers')) add('staffLockers', 1);
      if (!has('fridge') && rng.chance(0.7)) add('fridge', 1);
      if (!has('stockShelf') && !has('shelf')) add('stockShelf', 2, 0.9);
      add('cardboardBoxFlaps', rng.int(3, 5), undefined, true);
      add('storageTote', rng.int(1, 2), undefined, true);
    } else {
      if (!has('staffLockers')) add('staffLockers', 1);
      add('cardboardBoxFlaps', rng.int(1, 2), undefined, true);
    }
    C.res.back.push({area: a.id, type: a.type, props: got});
  }
  if (kit.an.stock.length) return;
  // no back room: the staff stock corner by the desk (the home store's back-of-house rows)
  const [x, z] = desk ? [desk.x, desk.z] : kit.inside(4);
  const got: PropPlacement[] = [];
  for (const [kind, front] of [['cabinetTall', 0.6], ['stockShelf', 0.9], ['cardboardBoxFlaps', undefined], ['cardboardBoxFlaps', undefined]] as [PropKind, number | undefined][]) {
    const p = kit.putNearWall(kind, x, z, {front, tries: 40});
    if (p) { p.purpose = DESIGN_STAFF_PURPOSE; got.push(p); }
  }
  if (got.length) C.res.sets.push({kind: 'staff', level: kit.level, props: got});
  else kit.skipped.push('staff stock corner');
}
