// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-GARDEN): THE GLASSHOUSE GARDEN CO. — the garden store's layout-
// version-3 dresser (stores/garden.ts SkywaysStoreSpec.dress). A whole garden centre under the brick / timber glasshouse finish
// (user references 02 planter gallery, 06 skylight planter court): plants on tiered benches and in big planters, a potting / tool
// wall, seed racks, soil pallets, hanging baskets in the tall space, a cash desk with its openable back counter, a stocked potting
// shed. Frame (destinations/skywaysShopsAKit.ts AnchorKit): u along the storefront, v deep from it; the sales floor may be several
// pieces (round an inset back room) — the kit holds them all, never cuts one off, and routes the lanes to every door.
//
// Layout (front to back):
//  - the ENTRY: an open front band — a stack of shopping baskets by the door, seed-packet spinner racks flanking the way in, tall
//    planters / palms by the windows (the planter gallery), tiered flower stands;
//  - the CASH DESK at the front on the roomier side: two counter modules facing the shop (the till on the first), a staff aisle,
//    the Mall back counter (drawers + cupboard: openable) against the side wall behind them, the drinks cooler beside it;
//  - the POTTING / TOOL WALL on the other side wall: potting benches (two-door low cabinets: openable) with geranium pots on their
//    worktops and a tool pegboard above each, a rolling tool chest (drawers: openable), a step ladder, the wheelbarrow;
//  - the BACK WALL: pallets of bagged soil (storeGardenSoilPallet), supply shelving (stock shelves) and pipe-and-plank shelving;
//  - the BENCH FIELD between the walls: rows of slatted plant benches end to end with geranium pots on their tops, big planter
//    trees / palms along the walls and in the corners, small potted plants on the floor;
//  - the HANGING-BASKET ZONE: basket rails hung over the bench rows (storeGardenBasketRail; their baskets are geranium pots on the
//    hooks), several at staggered heights in the double-height glasshouse, one or two in a hall;
//  - the BACK ROOMS (every store has >= 1 at version 3; 0 handled): the stock room becomes the potting shed — its station shelving /
//    cartons / crates kept, plus a tool locker (tall two-door cabinet), a tool chest, a staff fridge, a potting bench, lockers, lidded
//    totes, taped cartons, a first-aid kit on the wall; the office gains a staff fridge, lockers and a first-aid kit. No back room: a
//    staff stock corner (shelving + a tall cabinet) by the cash desk.
//
// Loot (no new tables; every holder an EXISTING kind): the areas' purposes (stores/garden.ts) plus per-holder purposes (the ramen
// precedent: PropPlacement.purpose) — GARDEN_HOLDER_PURPOSE below. No floor piles (the store's areas are noFloorLoot).

import type {Rng} from '../../../core/rng';
import {CELL} from '../../grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, footprint, type PropKind, type PropPlacement} from '../../props';
import {backed, boxClear, ceilOver, makePlaceCtx, mountProp, tryPlaceProp, wallRange, wallSpot, type PlaceCtx} from '../../placeKit';
import {stockVariant} from '../../purposeShapes';
import type {Area, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {segDist} from '../addonFrame';
import {AnchorKit, r3, snapEdge} from '../destinations/skywaysShopsAKit';
import {PLANT_BENCH_TOP} from '../destinations/kindsShopsB';
import {BASKET_RAIL, BASKET_RAIL_H, GARDEN_RAIL_CLEAR} from './kinds/garden';

/** Per-holder loot purposes (existing purposes only; the area purposes are stores/garden.ts GARDEN_PURPOSES). */
export const GARDEN_HOLDER_PURPOSE = {
  /** The pipe-and-plank shelving: outdoor-living / camping supplies (flares, cells, water, tinned food). */
  plankShelving: 'mall-outdoors',
  /** Staff fridges: food and drink (the tenant fridge rows). */
  fridge: 'mall-food-back',
  /** First-aid kits: dressings (and now and then a kit). */
  firstAid: 'mall-first-aid',
} as const;

/** Frame walls: L (u = 0), R (u = W), B (v = D), F (the storefront). */
type FWall = 'L' | 'R' | 'B' | 'F';

/** What one garden got (tests / QA; rewritten by every generation). */
export interface GardenResult {
  anchor: string;
  format: SkywaysAnchor['format'];
  props: PropPlacement[];
  skipped: string[];
  /** The cash desk's wall ('L' / 'R'; null: none placed) and its back counter. */
  cash: {wall: 'L' | 'R'; till: PropPlacement; back: PropPlacement} | null;
  rails: PropPlacement[];
  benches: PropPlacement[];
}
export const GARDEN_LAST = new Map<string, GardenResult>();

const SOIL_VARIANTS = 3;

/** Dresses one garden anchor; returns the props placed. */
export function dressGarden(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  if (!layout.areas[anchor.floor]) return 0;
  const kit = new AnchorKit(layout, rng, anchor);
  const res: GardenResult = {anchor: anchor.id, format: anchor.format, props: [], skipped: kit.skipped, cash: null, rails: [], benches: []};
  kit.reserveDoors();
  // --- the floor (local height frame; lifted at the end) ---
  res.cash = cashDesk(kit);
  kit.reserveLanes();
  entryBand(kit);
  const tools = toolWall(kit, res.cash?.wall === 'L' ? 'R' : 'L');
  backWall(kit);
  planters(kit);
  res.benches = benchField(kit);
  potBenches(kit, res.benches);
  floorExtras(kit);
  if (!anchor.stock.length) staffCorner(kit, res.cash);
  if (kit.posters(2).length < 1) kit.skipped.push('posters');
  kit.lift();
  // --- absolute heights from here: wall mounts, the hung rails and their baskets, the back rooms ---
  pegboards(kit, tools);
  if (res.cash) tillFirstAid(kit, res.cash);
  res.rails = basketRails(kit, res.benches);
  backRooms(kit);
  res.props = layout.props.slice(kit.p0);
  GARDEN_LAST.set(anchor.id, res);
  return layout.props.length - kit.p0;
}

// =================================================================================================================================
// Frame helpers

/** The area side behind a frame wall. */
function sideOf(kit: AnchorKit, w: FWall): Side {
  const fr = kit.fr, alongX = fr.front === 'N' || fr.front === 'S';
  return w === 'F' ? fr.front : w === 'B' ? fr.back : w === 'L' ? (alongX ? 'W' : 'N') : (alongX ? 'E' : 'S');
}
/** Yaw of a prop with its back to frame wall `w` (facing into the shop). */
function faceFrom(kit: AnchorKit, w: FWall): number {
  const fr = kit.fr;
  return w === 'F' ? fr.toBack : w === 'B' ? fr.toFront : w === 'L' ? fr.plusU : fr.minusU;
}
/** A seeded quarter turn (symmetric pieces). */
const anyYaw = (kit: AnchorKit): number => kit.rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
/** Frame (u, v) of a world point. */
const uvOf = (kit: AnchorKit, p: {x: number; z: number}): [number, number] => kit.toUV(p.x, p.z);
/** A frame point snapped so a footprint (`hu` x `hv` half extents along u / v) has its low edges on cell lines. */
function snapUV(kit: AnchorKit, u: number, v: number, kind: PropKind, rot: number): [number, number] {
  const [x, z] = kit.uv(u, v), {hx, hz} = footprint(kind, rot);
  return [snapEdge(x, hx), snapEdge(z, hz)];
}
/** Put a floor prop at frame (u, v) (snapped to cells). */
function putUV(kit: AnchorKit, kind: PropKind, u: number, v: number, rot: number, o: {front?: number; ring?: number; variant?: number} = {}): PropPlacement | null {
  const [x, z] = snapUV(kit, u, v, kind, rot);
  return kit.put(kind, x, z, rot, o);
}
/** Spots of a frame-wall stretch `t0..t1` (along the wall) that the wall spots of `kind` reach (solid wall behind), in order. */
function wallSpotsAlong(kit: AnchorKit, kind: PropKind, w: FWall, t0: number, t1: number): ReturnType<AnchorKit['wallSpots']> {
  const side = sideOf(kit, w), alongU = w === 'B' || w === 'F';
  const [cx, cz] = alongU ? kit.uv((t0 + t1) / 2, w === 'B' ? kit.fr.D : 0) : kit.uv(w === 'L' ? 0 : kit.fr.W, (t0 + t1) / 2);
  return kit.wallSpots(kind, cx, cz, kit.level, [side]).filter(sp => { const [u, v] = kit.toUV(sp.x, sp.z), t = alongU ? u : v; return t >= t0 - 1e-6 && t <= t1 + 1e-6; })
    .sort((p, q) => { const a = kit.toUV(p.x, p.z), b = kit.toUV(q.x, q.z); return alongU ? a[0] - b[0] : a[1] - b[1]; });
}
/** Up to `max` units of `kind` with their backs to frame wall `w` between t0 and t1 (along it), `gap` m apart. */
function wallLine(kit: AnchorKit, kind: PropKind, w: FWall, t0: number, t1: number, o: {max: number; gap?: number; front?: number; variant?: () => number; purpose?: string}): PropPlacement[] {
  const out: PropPlacement[] = [], alongU = w === 'B' || w === 'F', half = PROP_DEFS[kind].w / 2;
  let next = -Infinity;
  for (const sp of wallSpotsAlong(kit, kind, w, t0 + half, t1 - half)) {
    if (out.length >= o.max) break;
    const [u, v] = kit.toUV(sp.x, sp.z), t = alongU ? u : v;
    if (t < next) continue;
    const p = kit.put(kind, sp.x, sp.z, sp.rot, {area: sp.a, front: o.front, variant: o.variant?.()});
    if (!p) continue;
    if (o.purpose) p.purpose = o.purpose;
    out.push(p);
    next = t + 2 * half + (o.gap ?? 0.05);
  }
  return out;
}

// =================================================================================================================================
// The cash desk

/**
 * Two counter modules end to end along the side wall's depth, facing into the shop (a 0.9 m customer strip), a staff aisle behind
 * them (reserved, >= 1 m), the Mall back counter (drawers + cupboard) against the wall behind, the cash register on the module nearest
 * the front, the drinks cooler beside the back counter. The roomier side first, then the other; nearest the front first. Falls back
 * to one module.
 */
function cashDesk(kit: AnchorKit): GardenResult['cash'] {
  const fr = kit.fr, sc = PROP_DEFS.shopCounter, cw = PROP_DEFS.mallCashwrapCounter;
  const roomy: 'L' | 'R' = kit.uE >= fr.W / 2 ? 'L' : 'R';
  for (const n of [2, 1]) for (const wall of [roomy, roomy === 'L' ? 'R' : 'L'] as const) for (const v0 of [1.5, 2.0, 2.5, 3.0, 3.5, 4.5, 5.5]) {
    const run = n * sc.w;
    if (v0 + Math.max(run, cw.w) > fr.D - 1.2) continue;
    const s = wall === 'L' ? 1 : -1, uw = wall === 'L' ? 0 : fr.W, rot = faceFrom(kit, wall);
    // the counters' back face a cell-aligned staff aisle (>= 1 m) off the back counter's front
    const ub = Math.ceil((0.03 + cw.d + 1.0) / CELL - 1e-6) * CELL;
    if (ub + sc.d + 0.9 + 1.2 > fr.W / 2 + 2) continue;
    let till: PropPlacement | null = null, back: PropPlacement | null = null;
    const ok = kit.cluster(() => {
      const mods: PropPlacement[] = [];
      for (let k = 0; k < n; k++) {
        const [x, z] = kit.uv(uw + s * (ub + sc.d / 2), v0 + sc.w / 2 + k * (sc.w + 0.01));
        const p = kit.put('shopCounter', x, z, rot, {front: 0.9});
        if (!p) return false;
        mods.push(p);
      }
      const [bx, bz] = kit.uv(uw + s * (0.03 + cw.d / 2), v0 + run / 2);
      back = kit.put('mallCashwrapCounter', bx, bz, rot, {front: 0.7});
      if (!back) return false;
      // the staff aisle between them: free floor, reserved
      const a0 = Math.ceil((0.03 + cw.d - 0.04) / CELL - 1e-6) * CELL + 0.02; // (the first cell clear of the back counter's)
      const [ax, az] = kit.uv(uw + s * a0, v0), [cx2, cz2] = kit.uv(uw + s * (ub - 0.02), v0 + run);
      const bb = [Math.min(ax, cx2), Math.min(az, cz2), Math.max(ax, cx2), Math.max(az, cz2)] as const;
      if (!kit.boxFree(bb[0], bb[1], bb[2], bb[3], kit.level, true)) return false;
      kit.keepBox(bb[0], bb[1], bb[2], bb[3]);
      till = mods[0];
      return true;
    });
    if (!ok || !till || !back) continue;
    const t = till as PropPlacement;
    if (kit.onTop(t, 'cashRegister', 0.35, -0.08, SHOP_COUNTER_TOP_Y)) (t.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: 0.35 - 0.26, x1: 0.35 + 0.26});
    // the drinks cooler against the same wall, just past the desk (else anywhere on that wall)
    const [bu, bv] = uvOf(kit, back as PropPlacement);
    void bu;
    if (!wallLine(kit, 'shopCooler', wall, bv + cw.w / 2 + 0.1, Math.min(fr.D - 0.8, bv + cw.w / 2 + 2.5), {max: 1}).length
      && !wallLine(kit, 'shopCooler', wall, 0.8, fr.D - 0.8, {max: 1}).length) kit.skipped.push('drinks cooler');
    return {wall, till: t, back: back as PropPlacement};
  }
  kit.skipped.push('cash desk');
  return null;
}

/** A first-aid kit on the wall beside the back counter (dressings: GARDEN_HOLDER_PURPOSE.firstAid). */
function tillFirstAid(kit: AnchorKit, cash: NonNullable<GardenResult['cash']>): void {
  const [, bv] = uvOf(kit, cash.back), half = PROP_DEFS.mallCashwrapCounter.w / 2;
  for (const dv of [half + 0.35, -half - 0.35, half + 0.9, -half - 0.9]) {
    const p = mountAt(kit, 'firstAidWallKit', cash.wall, bv + dv, 1.3);
    if (p) { p.purpose = GARDEN_HOLDER_PURPOSE.firstAid; return; }
  }
  kit.skipped.push('till first-aid kit');
}

// =================================================================================================================================
// Entry band, tool wall, back wall, planters, the bench field

/** Shopping baskets by the door, seed-packet spinner racks flanking the way in, tiered flower stands either side further in. */
function entryBand(kit: AnchorKit): void {
  const fr = kit.fr, uE = kit.uE, eh = kit.entry.half, rng = kit.rng;
  const sides = rng.shuffle([-1, 1]);
  let baskets = false;
  for (const s of sides) for (const du of [eh + 0.8, eh + 1.3, eh + 1.9]) {
    if (baskets) break;
    if (putUV(kit, 'basketStack', uE + s * du, 0.9, fr.toBack)) baskets = true;
  }
  // seed racks: two or three, a little in from the windows either side of the entry lane (each with a ring to browse round it)
  let racks = 0;
  const want = rng.int(2, 3);
  for (const dv of [2.2, 3.0, 3.8]) for (const s of sides) for (const du of [eh + 1.1, eh + 1.8, eh + 2.6]) {
    if (racks >= want) break;
    const u = uE + s * du;
    if (u < 1.0 || u > fr.W - 1.0) continue;
    if (putUV(kit, 'spinnerRack', u, dv, s > 0 ? fr.minusU : fr.plusU, {ring: 0.4})) racks++;
  }
  if (!racks) kit.skipped.push('seed racks');
  // tiered flower stands: facing the entry lane a little deeper in
  let stands = 0;
  for (const s of sides) for (const dv of [4.2, 5.0, 3.6]) for (const du of [eh + 1.6, eh + 2.4]) {
    if (stands >= 2) break;
    const u = uE + s * du;
    if (putUV(kit, 'flowerStand', u, dv, s > 0 ? fr.minusU : fr.plusU, {ring: 0.3})) { stands++; break; }
  }
  if (!stands) kit.skipped.push('flower stands');
}

/**
 * The potting / tool wall on frame wall `w`: potting benches (cabinetLow: two doors, openable) with gaps between them, a rolling
 * tool chest, a step ladder; geranium pots on the benches' worktops (the pegboards above are mounted after the lift).
 */
function toolWall(kit: AnchorKit, w: 'L' | 'R'): PropPlacement[] {
  const fr = kit.fr, rng = kit.rng;
  const benches = wallLine(kit, 'cabinetLow', w, 1.4, fr.D - 1.0, {max: rng.int(2, 3), gap: 0.25, front: 0.7});
  if (!benches.length) kit.skipped.push('potting benches');
  const top = PROP_DEFS.cabinetLow.h, pot = PROP_DEFS.skyDGeraniumPot;
  for (const b of benches) {
    for (const lx of rng.shuffle([-0.62, -0.2, 0.25, 0.66]).slice(0, rng.int(2, 3))) {
      if (kit.onTop(b, 'skyDGeraniumPot', lx, 0.12, top, anyYaw(kit))) (b.cut ??= []).push({y: top, x0: r3(lx - pot.w / 2 - 0.02), x1: r3(lx + pot.w / 2 + 0.02)});
    }
  }
  const last = benches.length ? uvOf(kit, benches[benches.length - 1])[1] + PROP_DEFS.cabinetLow.w / 2 + 0.2 : 1.4;
  if (!wallLine(kit, 'rollingToolChest', w, last, fr.D - 0.8, {max: 1}).length && !wallLine(kit, 'rollingToolChest', w, 1.0, fr.D - 0.8, {max: 1}).length) kit.skipped.push('tool chest');
  wallLine(kit, 'stepLadder', w, last, fr.D - 0.8, {max: 1});
  return benches;
}

/** The back wall: pallets of bagged soil, supply shelving, pipe-and-plank shelving (outdoor supplies). */
function backWall(kit: AnchorKit): void {
  const fr = kit.fr, rng = kit.rng;
  const pallets = wallLine(kit, 'storeGardenSoilPallet', 'B', 0.6, fr.W - 0.6, {max: rng.int(2, 3), gap: 0.15, front: 0.9, variant: () => rng.int(0, SOIL_VARIANTS - 1)});
  if (!pallets.length) kit.skipped.push('soil pallets');
  const sv = () => stockVariant(rng.pick(['cleaning', 'parts', 'cartons'] as const));
  const shelves = wallLine(kit, 'stockShelf', 'B', 0.6, fr.W - 0.6, {max: rng.int(2, 3), gap: 0.1, front: 0.9, variant: sv});
  const planks = wallLine(kit, 'outdoorsPlankShelving', 'B', 0.6, fr.W - 0.6, {max: rng.int(1, 2), gap: 0.1, front: 0.9, purpose: GARDEN_HOLDER_PURPOSE.plankShelving});
  if (!shelves.length && !planks.length) {
    // (a back wall full of doors / glazing: the supply shelving goes on the side walls' far ends)
    for (const w of ['L', 'R'] as const) shelves.push(...wallLine(kit, 'stockShelf', w, fr.D * 0.55, fr.D - 0.6, {max: 1, front: 0.9, variant: sv}));
    if (!shelves.length) kit.skipped.push('supply shelving');
  }
}

/** Big planters: planter trees / palms by the front windows (the planter gallery), in the back corners and along the side walls. */
function planters(kit: AnchorKit): void {
  const fr = kit.fr, rng = kit.rng;
  const tall = (): PropKind => (rng.chance(0.5) ? 'planterTree' : 'skyDPottedPalm');
  let n = 0;
  // the windows either side of the entry (the front corners first)
  for (const s of [-1, 1]) for (const du of [0.9, 2.2, 3.6]) {
    const u = s < 0 ? du : fr.W - du;
    if (Math.abs(u - kit.uE) < kit.entry.half + 1.4) continue;
    const k = tall();
    if (putUV(kit, k, u, 1.0, anyYaw(kit), {ring: 0.3})) { n++; break; }
  }
  // the back corners and along the side walls (wherever a wall stretch is still free)
  for (const [w, t] of [['L', fr.D - 1.0], ['R', fr.D - 1.0], ['L', fr.D * 0.6], ['R', fr.D * 0.6], ['L', fr.D * 0.4], ['R', fr.D * 0.4]] as const) {
    const k = tall(), [x, z] = kit.uv(w === 'L' ? 0.9 : fr.W - 0.9, t);
    if (kit.putNearWall(k, x, z, {sides: [sideOf(kit, w)], tries: 10})) n++;
  }
  if (!n) kit.skipped.push('planters');
}

/**
 * The bench field: rows of slatted plant benches parallel to the storefront (pairs end to end, 1.5 m aisles between runs and rows)
 * between the walls' fixtures, from the front band to the back wall's aisle. Every bench on cell lines.
 */
function benchField(kit: AnchorKit): PropPlacement[] {
  const fr = kit.fr, b = PROP_DEFS.skyDPlantBench, out: PropPlacement[] = [];
  const pitch = Math.ceil((b.d + 1.5) / CELL - 1e-6) * CELL;
  const L = Math.ceil(b.w / CELL - 1e-6) * CELL;
  for (let v = 3.4; v + b.d <= fr.D - 2.1 + 1e-6; v += pitch) {
    let u = 2.0; // (cell lines: the frame origin is one, so every bench's cells are its own)
    while (u + L <= fr.W - 1.8 + 1e-6) {
      let got = 0;
      for (const n of [2, 1]) {
        if (u + n * L > fr.W - 1.8 + 1e-6) continue;
        const run: PropPlacement[] = [];
        if (kit.cluster(() => {
          for (let k = 0; k < n; k++) {
            const [x, z] = kit.uv(u + k * L + L / 2, v + b.d / 2);
            const p = kit.put('skyDPlantBench', x, z, fr.toFront);
            if (!p) return false;
            run.push(p);
          }
          return true;
        })) { got = n; out.push(...run); break; }
      }
      u += got ? got * L + 1.5 : CELL;
    }
  }
  if (!out.length) kit.skipped.push('plant benches');
  return out;
}

/** Geranium pots on the benches' measured tops: a grid of slots over each top, about 60 % filled, at least two per bench. */
function potBenches(kit: AnchorKit, benches: readonly PropPlacement[]): void {
  const bw = PROP_DEFS.skyDPlantBench.w, bd = PROP_DEFS.skyDPlantBench.d, top = PLANT_BENCH_TOP(), pot = PROP_DEFS.skyDGeraniumPot;
  const cols = Math.max(1, Math.floor((bw - 0.1) / (pot.w + 0.08))), rows = bd - 0.08 >= 2 * pot.d + 0.06 ? 2 : 1;
  const slots: [number, number][] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) slots.push([r3(-bw / 2 + (bw / cols) * (i + 0.5)), rows === 1 ? 0 : r3((j ? 1 : -1) * bd / 4)]);
  for (const b of benches) {
    const take = kit.rng.shuffle(slots.slice()).slice(0, Math.max(2, Math.round(slots.length * kit.rng.range(0.45, 0.75))));
    for (const [lx, lz] of take) kit.onTop(b, 'skyDGeraniumPot', lx, lz, top, anyYaw(kit));
  }
}

/** The wheelbarrow and small potted plants on the floor (loose, movable). */
function floorExtras(kit: AnchorKit): void {
  const fr = kit.fr, rng = kit.rng;
  const spots: [number, number][] = [];
  for (let u = 1.5; u <= fr.W - 1.5; u += 0.5) for (let v = 1.6; v <= fr.D - 1.6; v += 0.5) spots.push([u, v]);
  let barrow = false;
  for (const [u, v] of rng.shuffle(spots.slice())) {
    if (putUV(kit, 'skyDWheelbarrow', u, v, rng.pick([fr.plusU, fr.minusU]), {ring: 0.5})) { barrow = true; break; }
  }
  if (!barrow) kit.skipped.push('wheelbarrow');
  let plants = 0;
  const want = rng.int(3, 6);
  for (const [u, v] of rng.shuffle(spots.slice())) {
    if (plants >= want) break;
    if (putUV(kit, 'pottedPlantSmall', u, v, anyYaw(kit), {ring: 0.4})) plants++;
  }
}

/** No back room: a staff stock corner by the cash desk (supply shelving and a tall two-door cabinet). */
function staffCorner(kit: AnchorKit, cash: GardenResult['cash']): void {
  const fr = kit.fr, w = cash?.wall ?? 'L';
  const [, bv] = cash ? uvOf(kit, cash.back) : [0, 2];
  const got = [...wallLine(kit, 'cabinetTall', w, bv + 1.2, fr.D - 0.6, {max: 1}), ...wallLine(kit, 'stockShelf', w, bv + 1.2, fr.D - 0.6, {max: 2, front: 0.9, variant: () => stockVariant('cartons')})];
  if (!got.some(p => p.kind === 'cabinetTall') && !wallLine(kit, 'cabinetTall', 'B', 0.6, fr.W - 0.6, {max: 1}).length) kit.skipped.push('staff corner');
}

// =================================================================================================================================
// Absolute-height pieces (after the lift): wall mounts, the hanging-basket rails, the back rooms

/** A wall mount on frame wall `w` at `t` along it, `y` m above the floor (solid wall, no glazing / window, clear of props). */
function mountAt(kit: AnchorKit, kind: PropKind, w: FWall, t: number, y: number): PropPlacement | null {
  const fr = kit.fr, s = kit.st(), side = sideOf(kit, w), def = PROP_DEFS[kind];
  const [x, z] = w === 'L' ? kit.uv(0.3, t) : w === 'R' ? kit.uv(fr.W - 0.3, t) : w === 'B' ? kit.uv(t, fr.D - 0.3) : kit.uv(t, 0.3);
  const a = kit.areaAt(x, z);
  if (!a) return null;
  const along = side === 'N' || side === 'S' ? x : z;
  if (kit.windowAt(a, side, along - def.w / 2, along + def.w / 2, y + def.h + 0.1)) return null;
  const p = mountProp(s.ctx, a, side, r3(along), kind, r3(s.base + y), 0);
  if (!p) return null;
  kit.placed.push(p);
  return p;
}

/** A tool pegboard above each potting bench (1.15 m: clear of the worktop's pots). */
function pegboards(kit: AnchorKit, benches: readonly PropPlacement[]): void {
  const fr = kit.fr;
  let n = 0;
  for (const b of benches) {
    const [u, v] = uvOf(kit, b), w: FWall = u < fr.W / 2 ? 'L' : 'R';
    if (mountAt(kit, 'toolPegboard', w, v, 1.15)) n++;
  }
  if (benches.length && !n) kit.skipped.push('pegboards');
}

/**
 * Hanging-basket rails over the bench rows: each centred over a bench run (or along its row), turned along it, its baskets' bottoms
 * >= GARDEN_RAIL_CLEAR (staggered higher in the double-height glasshouse), its rods clear of the ceiling lights and under this room's
 * ceiling, nothing else in its box. Its five baskets: geranium pots in the hooks' rings (on-host decor of the rail; a few hooks empty).
 */
function basketRails(kit: AnchorKit, benches: readonly PropPlacement[]): PropPlacement[] {
  const fr = kit.fr, s = kit.st(), rng = kit.rng, L = kit.layout, out: PropPlacement[] = [];
  const clear = (L.areas[kit.an.floor].ceil ?? s.base + 4) - s.base;
  const tall = clear > 5;
  const max = tall ? rng.int(3, 5) : clear >= GARDEN_RAIL_CLEAR + BASKET_RAIL_H + 0.4 ? rng.int(1, 2) : 0;
  if (!max) return out;
  const heights = tall ? [2.6, 3.0, 3.4, 2.8, 3.2] : [GARDEN_RAIL_CLEAR];
  const cands: [number, number][] = [];
  for (const b of benches) cands.push([b.x, b.z]);
  for (let v = 3.0; v <= fr.D - 2.0; v += 1.5) for (let u = 2.6; u <= fr.W - 2.6; u += 1.5) cands.push(kit.uv(u, v));
  const lights = L.lights.filter(l => (l.level ?? 0) === kit.level);
  for (const [cx, cz] of cands) {
    if (out.length >= max) break;
    const y = r3(s.base + heights[out.length % heights.length]), rot = fr.toFront;
    const c = Math.cos(rot), sn = Math.sin(rot), hw = BASKET_RAIL.w / 2;
    // the rods' points (and the rail's ends) over this store's floor, under its ceiling, clear of light fixtures
    const pts = BASKET_RAIL.rods.map(ox => [cx + ox * c, cz - ox * sn] as const);
    if (!pts.every(([px, pz]) => kit.areaAt(px, pz) !== null)) continue;
    if (pts.some(([px, pz]) => ceilOver(s.ctx, px, pz, 0.05, 0.05) - (y + BASKET_RAIL_H) < 0.3)) continue;
    if (lights.some(l => pts.some(([px, pz]) => Math.hypot(l.x - px, l.z - pz) < 0.55) || segDist(l.x, l.z, pts[0][0], pts[0][1], pts[1][0], pts[1][1]) < 0.35)) continue;
    const hx = Math.abs(c) > 0.5 ? hw : BASKET_RAIL.d / 2, hz = Math.abs(c) > 0.5 ? BASKET_RAIL.d / 2 : hw;
    if (!boxClear(s.ctx, cx - hx - 0.05, cx + hx + 0.05, y - 0.05, y + BASKET_RAIL_H + 0.05, cz - hz - 0.05, cz + hz + 0.05)) continue;
    if (out.some(p => Math.hypot(p.x - cx, p.z - cz) < 2.2)) continue;
    const a = kit.areaAt(cx, cz)!;
    const rail = kit.push({kind: 'storeGardenBasketRail', x: r3(cx), z: r3(cz), y, rot: r3(rot), area: a.id, hx: r3(hx), hz: r3(hz), h: BASKET_RAIL_H, blocksSight: false, variant: 0, mounted: true});
    out.push(rail);
    for (const lx of BASKET_RAIL.slots) if (rng.chance(0.85)) kit.onTop(rail, 'skyDGeraniumPot', lx, 0, 0, rail.rot);
  }
  if (!out.length) kit.skipped.push('basket rails');
  return out;
}

// --- back rooms --------------------------------------------------------------------------------------------------------------

/** A back-room piece against a wall of `a` (every side, seeded order of spots); its floor added (absolute). */
function backWallPut(layout: StationLayout, ctx: PlaceCtx, a: Area, kind: PropKind, base: number, o: {front?: number; purpose?: string} = {}): PropPlacement | null {
  const def = PROP_DEFS[kind], spots: {side: Side; t: number}[] = [];
  for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + 0.1 + def.w / 2; t <= hi - 0.1 - def.w / 2 + 1e-6; t += 0.25) spots.push({side, t});
  }
  for (const {side, t} of ctx.rng.shuffle(spots)) {
    if (!backed(ctx, a, side, t - def.w / 2, t + def.w / 2, base + 0.1) || !backed(ctx, a, side, t - def.w / 2, t + def.w / 2, base + Math.min(def.h, 2) - 0.1)) continue;
    const sp = wallSpot(a, side, t, kind), {hx, hz} = footprint(kind, sp.rot);
    if (!boxClear(ctx, sp.x - hx, sp.x + hx, base, base + def.h, sp.z - hz, sp.z + hz)) continue;
    const p = tryPlaceProp(ctx, a, kind, r3(sp.x), r3(sp.z), sp.rot, {front: o.front});
    if (!p) continue;
    p.y = r3(p.y + base);
    if (o.purpose) p.purpose = o.purpose;
    void layout;
    return p;
  }
  return null;
}
/** A wall-mounted piece in a back room (`y` m above its floor): a solid wall, nothing in its box. */
function backMount(ctx: PlaceCtx, a: Area, kind: PropKind, base: number, y: number): PropPlacement | null {
  const def = PROP_DEFS[kind], spots: {side: Side; t: number}[] = [];
  for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + 0.3 + def.w / 2; t <= hi - 0.3 - def.w / 2 + 1e-6; t += 0.25) spots.push({side, t});
  }
  for (const {side, t} of ctx.rng.shuffle(spots)) {
    const p = mountProp(ctx, a, side, r3(t), kind, r3(base + y), 0);
    if (p) return p;
  }
  return null;
}

/**
 * The back rooms. The STOCK ROOM becomes the potting shed (its station shelving / cartons / crates kept): a tool locker (tall two-door
 * cabinet), a staff fridge, a first-aid kit on the wall, a rolling tool chest, a potting bench (low two-door cabinet with pots on its
 * worktop), staff lockers, lidded totes and a taped carton — as many as fit, in that order. The OFFICE: a staff fridge, a first-aid
 * kit, lockers, a tote.
 */
function backRooms(kit: AnchorKit): void {
  const L = kit.layout;
  for (const id of kit.an.stock) {
    const a = L.areas[id];
    if (!a) continue;
    const level = a.level ?? kit.level;
    const ctx = makePlaceCtx(L, kit.rng, level, {x0: a.x - 3, y0: a.y - 3, x1: a.x + a.w + 3, y1: a.y + a.h + 3});
    const base = a.floorY ?? L.levels[level]?.baseY ?? kit.st().base;
    const put = (kind: PropKind, o: {front?: number; purpose?: string} = {}) => { const p = backWallPut(L, ctx, a, kind, base, o); if (p) kit.placed.push(p); return p; };
    const shed = a.type === 'stock-room';
    let open = 0;
    if (shed) {
      if (put('cabinetTall')) open++;
      if (put('fridge', {purpose: GARDEN_HOLDER_PURPOSE.fridge})) open++;
    } else if (put('fridge', {purpose: GARDEN_HOLDER_PURPOSE.fridge})) open++;
    const aid = backMount(ctx, a, 'firstAidWallKit', base, 1.3);
    if (aid) { aid.purpose = GARDEN_HOLDER_PURPOSE.firstAid; kit.placed.push(aid); open++; }
    if (shed) {
      if (put('rollingToolChest')) open++;
      const pb = put('cabinetLow');
      if (pb) {
        open++;
        const pot = PROP_DEFS.skyDGeraniumPot, top = PROP_DEFS.cabinetLow.h;
        for (const lx of [-0.55, 0.5]) if (kit.onTop(pb, 'skyDGeraniumPot', lx, 0.1, top, anyYaw(kit))) (pb.cut ??= []).push({y: top, x0: r3(lx - pot.w / 2 - 0.02), x1: r3(lx + pot.w / 2 + 0.02)});
      }
    }
    if (put('staffLockers')) open++;
    for (let k = 0; k < (shed ? 2 : 1); k++) if (put('storageTote')) open++;
    if (shed && put('cardboardBoxFlaps')) open++;
    if (!open) kit.skipped.push(`back room ${id}: no openable storage fitted`);
  }
}
