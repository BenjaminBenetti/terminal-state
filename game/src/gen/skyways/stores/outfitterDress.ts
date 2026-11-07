// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-OUTFITTER): COULEE & CANOE OUTFITTERS — the layout-version-3 dresser
// of the Skyways outfitter (a double-height hall rising through the skyway storey, or a single-storey hall). Pure data (no three.js);
// on the anchor's own rng fork (destinations/index.ts). Placement through the anchor kit (destinations/skywaysShopsAKit.ts AnchorKit:
// door strips, walking lanes, overlap / connectivity checks); the back rooms through the shared placement primitive (gen/placeKit.ts).
//
// The store, front to back (u along the shop front, v deep):
//  - the CASH DESK beside the entry on a flank wall: a wall-backed back counter (the Mall's oak cash-wrap counter: openable drawers +
//    a cupboard; else an openable low cabinet), a 1.2 m staff aisle, then two counter modules (the till on the one nearest the door)
//    facing the floor; a first-aid wall kit on the staff side (its dressings: per-holder purpose 'first-aid-room'). A store without a
//    back room gets a staff stock corner on from it (lockers, shelving, a tall cabinet, cartons);
//  - the CAMPSITE centrepiece: the display tent pitched mid-floor, camp chairs round a lantern and a camp stove at its door;
//  - the CANOE hung overhead (two ceiling cables, a clear underside); the double-height hall hangs it higher and, where it fits, a
//    second one above it, crossing the void;
//  - the PACK WALL (pipe-and-plank shelving on the back wall, else a flank): THE REAL BACKPACK stands on the middle unit's top plank —
//    a genuine `backpack` gear find (items/gear.ts; layout pickup, turned into a grounded bag by gear/system.ts: open it, wear it, its
//    own 12 slots), ONE per store, seeded with the layout and never refilled. No decoration-only lookalike packs anywhere (user:
//    "camping store fake backpack unacceptable");
//  - the BOOT WALL (the Mall's ledge wall) with a try-on ottoman, the OUTERWEAR bays (clothing wall units, garment groups on their
//    rails), garment rails / round racks on the floor, a second display tent, tiered lantern tables, camp-kitchen plank shelving with
//    stoves and lanterns as stock, trail-food shelving and a drinks cooler, gondola aisles (stoves on their decks), a bike, posters;
//  - the BACK ROOMS (stock room / staff office, carve's): the station dresser's shelving / cartons / crates plus staff lockers and
//    openable cartons / a tote here; the office is relabelled the staff office.
// Loot: the store's purposes (stores/outfitter.ts) on every holder (counters, shelving, coolers, cabinets, lockers, cartons); no floor
// piles (the store areas are noFloorLoot). The decor stock (lanterns, stoves, garment groups) are separate loose props, never items.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, footprint, type PropKind, type PropPlacement} from '../../props';
import {stockVariant} from '../../purposeShapes';
import {OPENABLE_FRONT, WALL_MOUNT_Y, cellsOfBox, makePlaceCtx, mountProp, propBlocksDoorway, tryPlaceProp, wallRange, wallSpot, wallXZ, type PlaceCtx} from '../../placeKit';
import type {Area, PickupPlacement, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {normYaw, toWorld} from '../addonFrame';
import {AnchorKit, r3, snapEdge, type ShopsALane} from '../destinations/skywaysShopsAKit';
import {SHOPS_A_MODEL, bookTableTiers, canoeHangY} from '../destinations/kindsShopsA';
import {destHangCables} from '../destinations/skywaysDestModels';
import {GARMENT_RAIL_Y, MALL_SURFACES} from '../../mall/kinds';
import {GEAR_DIMS} from '../../../items/gear';

/** The real gear item the pack wall displays (items/gear.ts: its own bag container). */
export const OUTFITTER_PACK_ITEM = 'backpack';
/** Loot key of the first-aid wall kit at the cash desk (gen/purposes.ts: a first-aid room's dressings). */
export const OUTFITTER_FIRST_AID_PURPOSE = 'first-aid-room';
/** Label of a carved station-agent office inside the store. */
export const OUTFITTER_OFFICE_LABEL = 'Staff office';
/** Canoe hull underside (m above the floor): a single-storey hall / the double-height hall (the first, the second canoe above it). */
export const OUTFITTER_CANOE_UNDERSIDE = {hall: 3.6, tall: [4.4, 5.7]} as const;
/** Nothing standing under a hung canoe reaches within this of its hull (m). */
export const OUTFITTER_CANOE_CLEAR = 0.3;
/** Staff aisle behind the cash desk's counters (m, at least; the counters' back edge lands on a cell line). */
export const OUTFITTER_STAFF_AISLE = 0.95;
/** Kinds that read as storage here and are openable (world/openablesSpec.ts) — the store's own openables (tests). */
export const OUTFITTER_STORAGE_KINDS: readonly PropKind[] = ['mallCashwrapCounter', 'cabinetLow', 'cabinetTall', 'staffLockers', 'shopCooler', 'cardboardBoxFlaps',
  'storageTote', 'firstAidWallKit'];

/** QA / tests: what the outfitter dresser placed for one anchor. */
export interface OutfitterResult {
  anchor: string;
  format: SkywaysAnchor['format'];
  /** Indices into layout.props placed by this dresser (the sales floor and the back rooms). */
  props: number[];
  lanes: ShopsALane[];
  skipped: string[];
  /** The real backpack: its layout.pickups index and the prop it stands on (layout.props index) at `top` m above that prop's base. */
  backpack: {pickup: number; host: number; top: number; display: 'pack wall' | 'display table' | 'counter'} | null;
  /** The hung canoes: prop index and cable length up to the ceiling (m). */
  canoes: {prop: number; cable: number}[];
  /** The cash desk: the counter modules, the wall-backed back counter / cabinet, the till; the staff stock corner (no back room). */
  desk: {counters: number[]; back: number | null; register: number | null; firstAid: number | null; corner: number[]};
  /** Back rooms dressed (area ids), what was added there (prop indices) and a station wall shelf turned into the lockers (or null). */
  backRooms: {area: number; added: number[]; swapped: number | null}[];
}
const RESULTS = new WeakMap<StationLayout, OutfitterResult[]>();
/** QA / tests: the outfitter dressing of a layout (one entry per outfitter anchor; the generator ignores it). */
export function outfitterDressOf(layout: StationLayout): readonly OutfitterResult[] { return RESULTS.get(layout) ?? []; }

/** Dresses the outfitter anchor; returns the props placed. */
export function dressOutfitter(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  if (anchor.family !== 'outfitter' || !layout.areas[anchor.floor]) return 0;
  const kit = new AnchorKit(layout, rng, anchor);
  const res: OutfitterResult = {anchor: anchor.id, format: anchor.format, props: [], lanes: kit.lanes, skipped: kit.skipped, backpack: null, canoes: [],
    desk: {counters: [], back: null, register: null, firstAid: null, corner: []}, backRooms: []};
  const P = layout.props, idx = (p: PropPlacement | null | undefined): number | null => (p ? P.indexOf(p) : null);
  kit.reserveDoors();
  const backRooms = anchor.stock.map(id => layout.areas[id]).filter((a): a is Area => !!a && kit.storeys.has(a.level ?? 0));

  // --- the cash desk (first: by the entry, its staff aisle reserved), the campsite and the canoe(s), then the walking lanes ------
  const desk = cashDesk(kit, !backRooms.length);
  if (desk) {
    res.desk = {counters: desk.counters.map(p => P.indexOf(p)), back: idx(desk.back), register: idx(desk.register), firstAid: idx(desk.firstAid), corner: desk.corner.map(p => P.indexOf(p))};
  } else kit.skipped.push('cash desk');
  const camp = campsite(kit);
  hangCanoes(kit, camp, res);
  kit.reserveLanes();

  // --- the walls: the pack wall (the real backpack), the boot wall, outerwear, trail food / drinks, camp-kitchen shelving -----------
  let pack = packWall(kit);
  if (!pack) { kit.skipped.push('pack wall'); pack = packTable(kit); }
  if (!pack && desk?.counters.length) pack = packOnCounter(desk.counters[desk.counters.length - 1]);
  bootWall(kit);
  outerwear(kit);
  trailFood(kit);
  campKitchen(kit);
  kit.putNearWall('bicycle', ...kit.inside(kit.fr.D * 0.7), {tries: 60});

  // --- the floor: a second tent, lantern tables, garment rails, gondola aisles; posters ----------------------------------------
  floorFixtures(kit);
  kit.posters(3);

  // --- the back rooms -----------------------------------------------------------------------------------------------------------
  for (const a of backRooms) {
    const d = dressBackRoom(kit, a);
    res.backRooms.push({area: a.id, added: d.added.map(p => P.indexOf(p)), swapped: d.swapped ? P.indexOf(d.swapped) : null});
  }

  kit.lift();
  // the real backpack (absolute height: after the lift)
  if (pack) res.backpack = placePack(kit, pack);
  else kit.skipped.push('backpack (no display)');

  for (let i = kit.p0; i < P.length; i++) res.props.push(i);
  for (const c of res.canoes) {
    const p = P[c.prop], s = kit.st();
    c.cable = r3(Math.min(layout.areas[p.area].ceil, s.g.ceilAt(p.x, p.z)) - (p.y + canoeHangY()));
  }
  let list = RESULTS.get(layout);
  if (!list) RESULTS.set(layout, (list = []));
  list.push(res);
  return P.length - kit.p0;
}

// =================================================================================================================================
// Frame helpers

/** The flank walls (neither the front nor the back), the one nearer the entry first. */
function flankSides(kit: AnchorKit): Side[] {
  const fr = kit.fr, s0: Side = fr.front === 'N' || fr.front === 'S' ? 'W' : 'N', s1: Side = s0 === 'W' ? 'E' : 'S';
  // (u = 0 is the W wall for a N / S front, the N wall for a W / E front)
  return kit.uE <= fr.W / 2 ? [s0, s1] : [s1, s0];
}
/** World coordinate along a flank wall (x for a N / S wall, z for a W / E wall) of frame depth v. */
function flankT(kit: AnchorKit, v: number): number {
  const [x, z] = kit.uv(0, v);
  return kit.fr.front === 'N' || kit.fr.front === 'S' ? z : x;
}
/** The storey's sales pieces (no zones). */
const salesAreas = (kit: AnchorKit, level = kit.level): Area[] => kit.st(level).areas.filter(a => !kit.zones.includes(a));
/** The floor's longer axis in the frame. */
const longAxis = (kit: AnchorKit): 'u' | 'v' => (kit.fr.W >= kit.fr.D ? 'u' : 'v');

/** Reserves the free floor round a group (its bounding box + margin). */
function reserveAround(kit: AnchorKit, ps: PropPlacement[], level: number, margin: number): void {
  if (!ps.length) return;
  const x0 = Math.min(...ps.map(p => p.x - p.hx)) - margin, x1 = Math.max(...ps.map(p => p.x + p.hx)) + margin;
  const z0 = Math.min(...ps.map(p => p.z - p.hz)) - margin, z1 = Math.max(...ps.map(p => p.z + p.hz)) + margin;
  kit.keepBox(x0, z0, x1, z1, level);
}

/** Loose decor standing on a host's support at host-local (lx, lz), `y` m above its base; the support's loot surface gives up the span. */
function onSupport(kit: AnchorKit, host: PropPlacement, kind: PropKind, lx: number, lz: number, y: number, rot = host.rot): PropPlacement | null {
  const it = PROP_DEFS[kind];
  const p = kit.onTop(host, kind, r3(lx), r3(lz), y, rot);
  if (p) (host.cut ??= []).push({y, x0: r3(lx - it.w / 2 - 0.02), x1: r3(lx + it.w / 2 + 0.02)});
  return p;
}

// =================================================================================================================================
// The cash desk

interface Desk { counters: PropPlacement[]; back: PropPlacement | null; register: PropPlacement | null; firstAid: PropPlacement | null; corner: PropPlacement[] }

/**
 * Where a cash-desk bay may start: a wall `side` of a sales piece, the bay's near end `t0` (world m along the wall, on a cell line) and
 * the direction it runs (+-1 in t), best first: a flank wall within a few metres of the front, the front wall itself beside the entry
 * (the till by the door, the bay running away from the entry), then deeper flank spots.
 */
function deskBays(kit: AnchorKit): {side: Side; t0: number; dir: number; score: number}[] {
  const fr = kit.fr, out: {side: Side; t0: number; dir: number; score: number}[] = [];
  for (const side of flankSides(kit)) for (const v0 of [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.5, 5.5, 6.5]) {
    out.push({side, t0: Math.round(flankT(kit, v0) / CELL) * CELL, dir: Math.sign(flankT(kit, v0 + 1) - flankT(kit, v0)), score: v0 <= 3.5 ? v0 : v0 + 3});
  }
  // the front wall: t along it is x (a N / S front) or z (a W / E front) of frame u
  const tOfU = (u: number) => { const [x, z] = kit.uv(u, 0); return fr.front === 'N' || fr.front === 'S' ? x : z; };
  const du = Math.sign(tOfU(1) - tOfU(0));
  for (const s of [1, -1]) for (let k = 0; k < 6; k++) {
    const u = kit.uE + s * (kit.entry.half + 0.6 + k * CELL);
    if (u < 0.3 || u > fr.W - 0.3) continue;
    out.push({side: fr.front, t0: Math.round(tOfU(u) / CELL) * CELL, dir: s * du, score: 3.6 + k * 0.5});
  }
  return out.sort((p, q) => p.score - q.score);
}

/**
 * The cash desk by the entry (deskBays): the back counter / cabinet backed to the wall, the staff aisle, the counter run parallel to
 * the wall facing the floor (the till on the module nearest the door), the first-aid kit on the wall beyond the back counter and,
 * without a back room, the staff stock corner on along that wall. Falls back to a counter run beside the entry + a cabinet on a wall.
 */
function cashDesk(kit: AnchorKit, corner: boolean): Desk | null {
  const cD = PROP_DEFS.shopCounter.d, cW = PROP_DEFS.shopCounter.w, bays = deskBays(kit);
  for (const nm of [2, 1]) for (const backKind of ['mallCashwrapCounter', 'cabinetLow'] as PropKind[]) for (const {side, t0, dir} of bays) {
    const bD = PROP_DEFS[backKind].d, bW = PROP_DEFS[backKind].w;
    const back = Math.ceil((0.03 + bD + OUTFITTER_STAFF_AISLE) / CELL - 1e-6) * CELL; // the counters' back edge (from the wall line)
    const runLen = Math.max(bW, nm * cW + (nm - 1) * 0.01);
    for (const a of salesAreas(kit)) {
      const [lo, hi] = wallRange(a, side);
      if (Math.min(t0, t0 + dir * runLen) < lo + 0.05 || Math.max(t0, t0 + dir * runLen) > hi - 0.05) continue;
      const tB = t0 + dir * bW / 2;
      if (!kit.solidWall(a, side, tB, backKind)) continue;
      const got: PropPlacement[] = [];
      const hold = {bc: null as PropPlacement | null};
      const ok = kit.cluster(() => {
        const s = wallSpot(a, side, tB, backKind);
        hold.bc = kit.put(backKind, s.x, s.z, s.rot, {area: a, front: 0.6});
        if (!hold.bc) return false;
        for (let k = 0; k < nm; k++) {
          const [x, z] = wallXZ(a, side, t0 + dir * (cW / 2 + k * (cW + 0.01)), back + cD / 2 + 0.005);
          const p = kit.put('shopCounter', x, z, s.rot, {front: 1.0});
          if (!p) return false;
          got.push(p);
        }
        // the staff aisle between them (its whole cells: from the cell line past the back unit to the counters' back edge): free, reserved
        const [ax, az] = wallXZ(a, side, t0, Math.ceil((0.03 + bD) / CELL - 1e-6) * CELL), [bx, bz] = wallXZ(a, side, t0 + dir * runLen, back);
        const box = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)] as const;
        if (!kit.boxFree(box[0], box[1], box[2], box[3], kit.level, true)) return false;
        kit.keepBox(box[0], box[1], box[2], box[3]);
        return true;
      });
      if (!ok || !hold.bc) continue;
      const desk: Desk = {counters: got, back: hold.bc, register: till(kit, got[0]), firstAid: null, corner: []};
      // the first-aid kit on the staff side, just past the back counter (its dressings: a first-aid room's)
      const ctx = kit.st().ctx;
      for (const dt of [0.3, 0.55, 0.8, -0.3]) {
        const t = dt > 0 ? t0 + dir * (bW + dt) : t0 + dir * dt;
        const fa = mountProp(ctx, a, side, t, 'firstAidWallKit', 1.3, kit.st().base);
        if (fa) { fa.purpose = OUTFITTER_FIRST_AID_PURPOSE; desk.firstAid = fa; break; }
      }
      if (corner) desk.corner = staffCorner(kit, a, side, t0 + dir * (bW + 0.95), dir);
      return desk;
    }
  }
  // fallback: a counter run beside the entry facing it (its staff aisle behind) and an openable cabinet on the nearest wall
  const run = entryCounters(kit);
  if (!run.length) return null;
  const cab = kit.putNearWall('cabinetLow', run[0].x, run[0].z, {front: 0.6, tries: 60});
  const corner2 = corner ? [kit.putNearWall('staffLockers', run[0].x, run[0].z, {tries: 60}), kit.putNearWall('stockShelf', run[0].x, run[0].z, {front: 0.9, tries: 60})].filter((p): p is PropPlacement => !!p) : [];
  return {counters: run, back: cab, register: till(kit, run[0]), firstAid: null, corner: corner2};
}

/** The cash register on a counter module (its top's span cut from the loot surface). */
function till(kit: AnchorKit, c: PropPlacement): PropPlacement | null {
  const reg = kit.onTop(c, 'cashRegister', 0.25, -0.08, SHOP_COUNTER_TOP_Y);
  if (reg) (c.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: 0.25 - 0.26, x1: 0.25 + 0.26});
  return reg;
}

/** No back room: the staff stock corner on along the desk's wall (lockers, shelving, a tall cabinet) and two cartons. */
function staffCorner(kit: AnchorKit, a: Area, side: Side, tStart: number, dir: number): PropPlacement[] {
  const out: PropPlacement[] = [];
  const [lo, hi] = wallRange(a, side);
  let t = tStart;
  for (const kind of ['staffLockers', 'stockShelf', 'cabinetTall', 'stockShelf'] as PropKind[]) {
    const w = PROP_DEFS[kind].w;
    for (let tries = 0; tries < 6; tries++) {
      const c = t + dir * w / 2;
      if (c - w / 2 < lo + 0.3 || c + w / 2 > hi - 0.3) break;
      const s = wallSpot(a, side, c, kind);
      const p = kit.solidWall(a, side, c, kind) ? kit.put(kind, s.x, s.z, s.rot, {area: a, front: kind === 'stockShelf' ? 0.9 : 0.6, variant: kind === 'stockShelf' ? stockVariant('cartons') : undefined}) : null;
      if (p) { out.push(p); t += dir * (w + 0.04); break; }
      t += dir * 0.5;
    }
  }
  const at = out[0] ?? null;
  if (at) for (let k = 0; k < 2; k++) { const p = kit.putNearWall('cardboardBoxFlaps', at.x, at.z, {tries: 40}); if (p) out.push(p); }
  return out;
}

/** The v2-style counter run beside the entry (fallback): perpendicular to the front, its customer side toward the entry aisle. */
function entryCounters(kit: AnchorKit): PropPlacement[] {
  const fr = kit.fr, def = PROP_DEFS.shopCounter, eh = kit.entry.half, uE = kit.uE;
  for (const nm of [2, 1]) for (const s of kit.rng.shuffle([1, -1])) for (const dv of [2.0, 2.5, 3.0, 3.5, 4.5, 5.5]) for (const du of [eh + 1.2, eh + 1.7, eh + 2.4, eh + 3.2, eh + 4.2]) {
    const u = r3(Math.round((uE + s * (du + def.d) ) / CELL) * CELL - s * def.d / 2);
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
      return true;
    });
    if (ok) return got;
  }
  return [];
}

// =================================================================================================================================
// The campsite and the canoes

/** The campsite: the display tent mid-floor (door to the entry), camp chairs round a lantern and a camp stove at its door. */
function campsite(kit: AnchorKit): {x: number; z: number} | null {
  const fr = kit.fr, tent = PROP_DEFS.skyDTent, chair = PROP_DEFS.skyDCampChair;
  const cands: [number, number][] = [];
  for (const dv of [0, 0.8, -0.8, 1.6, -1.6, 2.4]) for (const du of [0, 1.5, -1.5, 3, -3, 4.5, -4.5]) cands.push([fr.W / 2 + du, fr.D * 0.5 + dv]);
  for (const [u0, v0] of cands) {
    const [x, z] = kit.uv(u0, v0);
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const t = kit.put('skyDTent', snapEdge(x, tent.w / 2), snapEdge(z, tent.d / 2), fr.toFront);
      if (!t) return false;
      got.push(t);
      const [u, v] = kit.toUV(t.x, t.z);
      const vd = v - tent.d / 2 - 1.15; // the "fire" spot in front of the door
      for (const s of kit.rng.shuffle([-1, 1])) {
        const [cx, cz] = kit.uv(u + s * 0.95, vd);
        const p = kit.put('skyDCampChair', cx, cz, s < 0 ? fr.plusU : fr.minusU);
        if (p) got.push(p);
      }
      if (got.length < 2) return false;
      if (kit.rng.chance(0.6)) { const [cx, cz] = kit.uv(u + kit.rng.pick([-1, 1]) * 0.6, vd - 0.95 - chair.d / 2); const p = kit.put('skyDCampChair', cx, cz, fr.toBack); if (p) got.push(p); }
      { const [lx, lz] = kit.uv(u - 0.2, vd); const p = kit.put('skyDLantern', lx, lz, 0); if (p) got.push(p); }
      { const [sx, sz] = kit.uv(u + 0.22, vd + 0.05); const p = kit.put('campStove', sx, sz, fr.toFront); if (p) got.push(p); }
      return true;
    });
    if (ok) { reserveAround(kit, got, kit.level, 0.7); return {x: got[0].x, z: got[0].z}; }
  }
  kit.skipped.push('campsite (tent)');
  return null;
}

/** The canoe(s) overhead: over the campsite first, then over the main aisle; the double-height hall hangs a second one higher. */
function hangCanoes(kit: AnchorKit, camp: {x: number; z: number} | null, res: OutfitterResult): void {
  const fr = kit.fr, spots: [number, number][] = [];
  if (camp) spots.push([camp.x, camp.z]);
  for (const v of [fr.D * 0.45, fr.D * 0.6, fr.D * 0.35, fr.D * 0.7]) for (const du of [0, -2, 2, -4, 4]) spots.push(kit.uv(kit.uE + du, v));
  const tall = kit.an.format === 'double-height';
  const heights: readonly number[] = tall ? OUTFITTER_CANOE_UNDERSIDE.tall : [OUTFITTER_CANOE_UNDERSIDE.hall];
  heights.forEach((under, i) => {
    const prev = res.canoes.map(c => kit.layout.props[c.prop]);
    const c = hangCanoe(kit, i === 0 ? spots : spots.slice().reverse(), under, i === 0 ? [fr.toFront, fr.plusU] : [fr.plusU, fr.toFront], prev);
    if (c) res.canoes.push({prop: kit.layout.props.indexOf(c), cable: 0});
    else if (i === 0) kit.skipped.push('canoe');
  });
}

/**
 * One canoe on two ceiling cables, its hull underside `under` above the floor (lower under a lower ceiling, never under 2.3 m);
 * nothing standing below reaches within OUTFITTER_CANOE_CLEAR of the hull, no light fixture where its cables meet the ceiling (or in
 * its footprint when it hangs right under the ceiling), clear of doorways and of the canoes already hung (plan view).
 */
function hangCanoe(kit: AnchorKit, spots: [number, number][], under: number, rots: number[], others: PropPlacement[]): PropPlacement | null {
  const def = PROP_DEFS.skyDCanoe, s = kit.st(), g = s.g, base = s.base, layout = kit.layout;
  for (const [x0, z0] of spots) for (const rot of rots) {
    const q = Math.abs(Math.sin(rot)) > 0.7, hx = (q ? def.d : def.w) / 2, hz = (q ? def.w : def.d) / 2;
    const x = r3(x0), z = r3(z0);
    const area = kit.areaAt(x, z);
    if (!area) continue;
    let ceil = area.ceil, inside = true;
    for (const [px, pz] of [[x - hx, z - hz], [x + hx, z - hz], [x - hx, z + hz], [x + hx, z + hz], [x, z]]) {
      const a = kit.areaAt(px, pz);
      const [cx, cy] = g.cellOf(px, pz);
      if (!a || a.ceil !== area.ceil || g.rampIdx[g.idx(cx, cy)] >= 0) { inside = false; break; }
      ceil = Math.min(ceil, g.ceilAt(px, pz));
    }
    if (!inside) continue;
    const y = r3(Math.min(under, ceil - base - canoeHangY() - 0.03));
    if (y < 2.3) continue;
    if (others.some(o => Math.abs(o.x - x) < o.hx + hx + 0.3 && Math.abs(o.z - z) < o.hz + hz + 0.3)) continue;
    const below = layout.props.some((p, i) => (p.level ?? 0) === kit.level && !p.mounted && Math.abs(p.x - x) < p.hx + hx + 0.1 && Math.abs(p.z - z) < p.hz + hz + 0.1
      && (i >= kit.p0 ? p.y + p.h : p.y + p.h - base) > y - OUTFITTER_CANOE_CLEAR);
    if (below) continue;
    const top = y + canoeHangY(), low = ceil - base - top > 0.3;
    const xs = destHangCables(SHOPS_A_MODEL.skyDCanoe).xs;
    const lit = (l: {x: number; z: number; level?: number}) => (l.level ?? 0) === kit.level && (low
      ? xs.some(c => Math.hypot(l.x - (x + (q ? 0 : c)), l.z - (z + (q ? -c : 0))) < 0.45)
      : Math.abs(l.x - x) < hx + 0.4 && Math.abs(l.z - z) < hz + 0.4);
    if (layout.lights.some(lit)) continue;
    if (propBlocksDoorway(layout, x, z, hx, hz, base + y, def.h)) continue;
    return kit.push({kind: 'skyDCanoe', x, z, y, rot: r3(normYaw(rot)), area: area.id, hx: r3(hx), hz: r3(hz), h: def.h, blocksSight: false, variant: 0, mounted: true});
  }
  return null;
}

// =================================================================================================================================
// Walls

/**
 * `n` units of `kind` side by side with their backs to one wall (`sides`, every sales piece), the group centred as near `near` as the
 * wall allows (a solid wall behind each); all or nothing. Each unit's low edge lies on a cell line, the units a whole number of cells
 * apart (packed units never share a grid cell). Returns the units (or []).
 */
function wallGroup(kit: AnchorKit, kind: PropKind, sides: readonly Side[], n: number, near: [number, number], o: {front?: number; variant?: () => number} = {}): PropPlacement[] {
  const def = PROP_DEFS[kind], pitch = Math.max(def.w, (Math.floor((def.w - 0.08) / CELL) + 1) * CELL), span = (n - 1) * pitch + def.w;
  const cands: {a: Area; side: Side; t: number; d: number}[] = [];
  for (const a of salesAreas(kit)) for (const side of sides) {
    const [lo, hi] = wallRange(a, side);
    // (t = the group's low edge, on a cell line)
    for (let t = Math.ceil((lo + 0.3) / CELL) * CELL; t + span <= hi - 0.3; t += CELL) {
      const [x, z] = wallXZ(a, side, t + span / 2, def.d / 2);
      cands.push({a, side, t, d: Math.hypot(x - near[0], z - near[1])});
    }
  }
  cands.sort((p, q) => p.d - q.d);
  for (const c of cands.slice(0, 80)) {
    const ts = Array.from({length: n}, (_, k) => c.t + def.w / 2 + k * pitch);
    if (!ts.every(t => kit.solidWall(c.a, c.side, t, kind))) continue;
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      for (const t of ts) {
        const s = wallSpot(c.a, c.side, t, kind);
        const p = kit.put(kind, s.x, s.z, s.rot, {area: c.a, front: o.front, variant: o.variant?.()});
        if (!p) return false;
        got.push(p);
      }
      return true;
    });
    if (ok) return got;
  }
  return [];
}

/** The display spot the real backpack takes on its host: host-local (lx, lz) on a support `top` m above the host's base. */
interface PackSpot { host: PropPlacement; top: number; lx: number; lz: number; display: 'pack wall' | 'display table' | 'counter' }

/**
 * The PACK WALL: three (else two / one) pipe-and-plank shelving units on the back wall (else a flank), centred on the main aisle's
 * end; the middle unit's top plank holds the real backpack (front-aligned, its span cut from the plank's loot surface), the others
 * lanterns / stoves as stock. Returns the backpack's spot (null: no pack wall fits).
 */
function packWall(kit: AnchorKit): PackSpot | null {
  const fr = kit.fr, near = kit.uv(kit.uE, fr.D);
  let units: PropPlacement[] = [];
  for (const sides of [[fr.back], flankSides(kit)] as Side[][]) for (const n of [3, 2, 1]) {
    if (units.length) break;
    units = wallGroup(kit, 'outdoorsPlankShelving', sides, n, sides.length === 1 ? near : kit.uv(fr.W / 2, fr.D * 0.6), {front: 0.9});
  }
  if (!units.length) return null;
  const mid = units[Math.floor(units.length / 2)];
  const top = MALL_SURFACES.outdoorsPlankShelving[2], bag = GEAR_DIMS[OUTFITTER_PACK_ITEM];
  const lx = r3(kit.rng.range(-0.15, 0.15)), lz = r3(top.z1 - bag.d / 2 - 0.02);
  (mid.cut ??= []).push({y: top.y, x0: r3(lx - bag.w / 2 - 0.04), x1: r3(lx + bag.w / 2 + 0.04)});
  for (const u of units) plankStock(kit, u, u === mid);
  return {host: mid, top: top.y, lx, lz, display: 'pack wall'};
}

/** Fallback display: a merchandising table near the front with the real backpack standing on it. */
function packTable(kit: AnchorKit): PackSpot | null {
  const t = lattice(kit, 'merchTable', {ring: 0.8, pitch: [2.4, 2.0], v: [2.6, Math.max(3.2, kit.fr.D * 0.45)], max: 1})[0] ?? lattice(kit, 'merchTable', {ring: 0.6, pitch: [2.0, 2.0], max: 1})[0];
  if (!t) return null;
  const s = MALL_SURFACES.merchTable[0], bag = GEAR_DIMS[OUTFITTER_PACK_ITEM];
  (t.cut ??= []).push({y: s.y, x0: r3(-bag.w / 2 - 0.04), x1: r3(bag.w / 2 + 0.04)});
  return {host: t, top: s.y, lx: 0, lz: 0, display: 'display table'};
}
/** Last resort: the real backpack standing on the cash counter's far module (its span cut from the counter's loot surface). */
function packOnCounter(c: PropPlacement): PackSpot {
  const bag = GEAR_DIMS[OUTFITTER_PACK_ITEM], lx = -0.4;
  (c.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: r3(lx - bag.w / 2 - 0.04), x1: r3(lx + bag.w / 2 + 0.04)});
  return {host: c, top: SHOP_COUNTER_TOP_Y, lx, lz: 0, display: 'counter'};
}

/** Puts the real backpack on its display spot (absolute height: call after the lift). One per store, a layout pickup. */
function placePack(kit: AnchorKit, s: PackSpot): OutfitterResult['backpack'] {
  const [x, z] = toWorld(s.host, s.lx, s.lz);
  const level = s.host.level ?? 0;
  const pk: PickupPlacement = {itemId: OUTFITTER_PACK_ITEM, count: 1, x: r3(x), y: r3(s.host.y + s.top), z: r3(z), area: s.host.area, yaw: r3(normYaw(s.host.rot)), ...(level ? {level} : {})};
  kit.layout.pickups.push(pk);
  return {pickup: kit.layout.pickups.length - 1, host: kit.layout.props.indexOf(s.host), top: s.top, display: s.display};
}

/**
 * Lanterns / stoves as stock on a plank unit (M16 planks 0.41 / 0.87 and the top 1.14; front-aligned, spans cut): a lantern on the
 * bottom plank, a camp stove on the middle one, a lantern on the top (not on the backpack's unit's top).
 */
function plankStock(kit: AnchorKit, u: PropPlacement, hasPack: boolean): void {
  const S = MALL_SURFACES.outdoorsPlankShelving, rng = kit.rng;
  const at = (s: (typeof S)[number], kind: PropKind) => {
    const it = PROP_DEFS[kind];
    if (it.h > s.clear + (s === S[2] ? 1 : 0) || it.d > s.z1 - s.z0) return;
    const lx = rng.pick([-0.42, 0.42]) + rng.range(-0.08, 0.08);
    onSupport(kit, u, kind, lx, s.z1 - it.d / 2 - 0.02, s.y);
  };
  if (rng.chance(0.75)) at(S[0], rng.pick(['skyDLantern', 'campLantern'] as PropKind[]));
  if (rng.chance(0.7)) at(S[1], 'campStove');
  if (!hasPack && rng.chance(0.6)) at(S[2], rng.pick(['skyDLantern', 'campStove'] as PropKind[]));
}

/** The BOOT WALL: two (else one) ledge walls on a flank (else any wall) with a try-on ottoman in front. */
function bootWall(kit: AnchorKit): void {
  const fr = kit.fr;
  let wall: PropPlacement[] = [];
  for (const sides of [flankSides(kit), [fr.back]] as Side[][]) for (const n of [2, 1]) if (!wall.length) wall = wallGroup(kit, 'shoeWallDisplay', sides, n, kit.uv(fr.W / 2, fr.D * 0.55), {front: 0.6});
  if (!wall.length) { kit.skipped.push('boot wall'); return; }
  // (the try-on ottoman centred on the wall, just beyond its access strip, its long side along it)
  const mid = {x: wall.reduce((s, p) => s + p.x, 0) / wall.length, z: wall.reduce((s, p) => s + p.z, 0) / wall.length, rot: wall[0].rot};
  const dW = PROP_DEFS.shoeWallDisplay.d, o = PROP_DEFS.ottoman;
  for (const gap of [0.1, 0.35, 0.6]) for (const dl of [0, 0.5, -0.5, 1.0, -1.0]) {
    const [x, z] = toWorld(mid, dl, dW / 2 + 0.6 + gap + o.d / 2);
    if (kit.put('ottoman', x, z, mid.rot)) return;
  }
  kit.skipped.push('boot wall ottoman');
}

/** OUTERWEAR: clothing wall units (garment groups on their rails, two each) on any free wall. */
function outerwear(kit: AnchorKit): void {
  const fr = kit.fr;
  let bays: PropPlacement[] = [];
  for (const n of [2, 1]) if (!bays.length) bays = wallGroup(kit, 'clothingWallUnit', (['N', 'S', 'E', 'W'] as Side[]).filter(s => s !== fr.front), n, kit.uv(fr.W * 0.3, fr.D * 0.5), {front: 1.0});
  for (const b of bays) for (const du of [-0.55, 0.55]) if (kit.rng.chance(0.8)) hang(kit, b, 'garmentHangingGroup', du);
}

/** Trail food (stock shelving, the grocery stock) on a wall and a drinks cooler beside it. */
function trailFood(kit: AnchorKit): void {
  const fr = kit.fr, rng = kit.rng, sides = (['N', 'S', 'E', 'W'] as Side[]).filter(s => s !== fr.front);
  let food: PropPlacement[] = [];
  for (let n = rng.int(2, 3); n >= 1 && !food.length; n--) food = wallGroup(kit, 'stockShelf', sides, n, kit.uv(fr.W * 0.7, fr.D * 0.7), {front: 0.9, variant: () => stockVariant('grocery')});
  // the drinks cooler(s) beside the food, else anywhere along the walls
  const at = food[food.length - 1] ?? null;
  const near: [number, number][] = [...(at ? [[at.x, at.z] as [number, number]] : []), kit.inside(3), kit.uv(fr.W / 2, fr.D)];
  let want = rng.int(1, 2);
  for (const [cx, cz] of near) while (want > 0 && kit.putNearWall('shopCooler', cx, cz, {tries: 80})) want--;
}

/** The CAMP KITCHEN: more plank shelving along the free walls, stoves and lanterns as stock. */
function campKitchen(kit: AnchorKit): void {
  for (const u of kit.wallRun('outdoorsPlankShelving', {cluster: 3, gap: 0.8, max: kit.rng.int(3, 6), front: 0.9})) plankStock(kit, u, false);
}

/** Hangs a garment group from a rail host at its rail height, `du` along it (host decor: it rides the rail). */
function hang(kit: AnchorKit, host: PropPlacement, kind: PropKind, du = 0): PropPlacement | null {
  const hi = kit.layout.props.indexOf(host);
  if (hi < 0) return null;
  const def = PROP_DEFS[kind], hd = PROP_DEFS[host.kind];
  const rail = GARMENT_RAIL_Y[host.kind as keyof typeof GARMENT_RAIL_Y] ?? hd.h - 0.02;
  if (def.h >= rail || Math.abs(du) + def.w / 2 > hd.w / 2 + 1e-6) return null;
  const [x, z] = toWorld(host, du, 0);
  const rot = host.rot, q = Math.abs(Math.sin(rot)) > 0.7;
  const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r3(host.y + rail - def.h), rot, area: host.area, hx: r3((q ? def.d : def.w) / 2), hz: r3((q ? def.w : def.d) / 2), h: def.h,
    blocksSight: false, variant: 0, host: hi, ...(host.level ? {level: host.level} : {})};
  return kit.push(p, host.level ?? 0);
}

// =================================================================================================================================
// The floor

/** A second display tent, tiered lantern tables, garment rails and round racks, then double-sided gondola aisles (stoves on decks). */
function floorFixtures(kit: AnchorKit): void {
  const rng = kit.rng;
  if (kit.fr.W * kit.fr.D >= 120) lattice(kit, 'tentDisplay', {ring: 1.0, pitch: [3.4, 3.4], v: [kit.fr.D * 0.4, kit.fr.D - 2.0], max: 1});
  // the gondola aisles pack the open floor first (deep floor first; along the long axis, else across it), the islands fill round them
  const want = rng.int(3, 6);
  let runs = fillRuns(kit, kit.level, 'retailGondola', {units: [2, 3], aisle: 1.3, max: want, orient: longAxis(kit)});
  if (runs.length < 2) runs = runs.concat(fillRuns(kit, kit.level, 'retailGondola', {units: [2, 3], aisle: 1.3, max: want - runs.length, orient: longAxis(kit) === 'u' ? 'v' : 'u'}));
  for (const run of runs) for (const g of run) gondolaStock(kit, g);
  for (const t of lattice(kit, 'skyDBookTable', {round: true, ring: 0.8, pitch: [3.0, 3.0], v: [2.6, Math.max(3.2, kit.fr.D * 0.5)], max: rng.int(1, 2)})) stockTiers(kit, t, 'skyDLantern', [2, 4]);
  for (const r of lattice(kit, 'garmentRail', {ring: 0.7, pitch: [2.6, 2.4], max: rng.int(2, 3)})) if (rng.chance(0.8)) hang(kit, r, 'garmentHangingGroup');
  for (const r of lattice(kit, 'garmentRailRound', {ring: 0.7, pitch: [2.6, 2.6], max: rng.int(1, 2)})) if (rng.chance(0.8)) hang(kit, r, 'garmentHangingGroup');
}

/** Camp stoves as stock on a gondola's decks (front-aligned, spans cut), on about half the units. */
function gondolaStock(kit: AnchorKit, g: PropPlacement): void {
  if (!kit.rng.chance(0.5)) return;
  const decks = MALL_SURFACES.retailGondola, it = PROP_DEFS.campStove;
  for (const s of kit.rng.shuffle(decks.filter(d => d.clear >= it.h + 0.02 && d.z1 - d.z0 >= it.d)).slice(0, kit.rng.int(1, 2))) {
    onSupport(kit, g, 'campStove', kit.rng.pick([-0.55, 0, 0.55]), s.z1 - it.d / 2 - 0.02, s.y);
  }
}

/** Islands of `kind` on a lattice over the storey's floor (frame u / v), tried in a shuffled order. */
function lattice(kit: AnchorKit, kind: PropKind, o: {round?: boolean; ring?: number; pitch: [number, number]; u?: [number, number]; v?: [number, number]; max: number}): PropPlacement[] {
  const fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[] = [];
  if (o.max <= 0) return out;
  const [u0, u1] = o.u ?? [1.2 + def.w / 2, fr.W - 1.2 - def.w / 2], [v0, v1] = o.v ?? [2.6 + def.d / 2, fr.D - 1.2 - def.d / 2];
  const spots: [number, number][] = [];
  const nu = Math.max(1, Math.floor((u1 - u0) / o.pitch[0]) + 1), nv = Math.max(1, Math.floor((v1 - v0) / o.pitch[1]) + 1);
  const su = u0 + ((u1 - u0) - (nu - 1) * o.pitch[0]) / 2, sv = v0 + ((v1 - v0) - (nv - 1) * o.pitch[1]) / 2;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) spots.push([su + i * o.pitch[0], sv + j * o.pitch[1]]);
  for (const [u, v] of kit.rng.shuffle(spots)) {
    if (out.length >= o.max) break;
    const rot = fr.toFront, [x, z] = kit.uv(u, v);
    const sx = snapEdge(x, def.w / 2), sz = snapEdge(z, def.d / 2);
    const p = o.round ? kit.putRound(kind, sx, sz, rot, {ring: o.ring}) : kit.put(kind, (Math.abs(Math.sin(rot)) > 0.7 ? snapEdge(x, def.d / 2) : sx), (Math.abs(Math.sin(rot)) > 0.7 ? snapEdge(z, def.w / 2) : sz), rot, {ring: o.ring});
    if (p) out.push(p);
  }
  return out;
}

/** Double-sided island runs of `kind` (back to back, `units` long) packed into `aisle`-wide aisles over the storey's floor. */
function fillRuns(kit: AnchorKit, level: number, kind: PropKind, o: {units: [number, number]; aisle: number; max: number; orient: 'u' | 'v'}): PropPlacement[][] {
  const fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[][] = [];
  if (o.max <= 0) return out;
  const along = o.orient === 'u';
  const pitch = Math.max(def.w + 0.02, (Math.floor((def.w - 0.04) / CELL) + 1) * CELL);
  const us: number[] = [], vs: number[] = [];
  for (let u = CELL; u <= fr.W - CELL; u += CELL) us.push(u);
  for (let v = 2.5; v <= fr.D - CELL; v += CELL) vs.push(v);
  if (kit.rng.chance(0.5)) us.reverse();
  vs.reverse();
  for (const v of vs) for (const u of us) {
    if (out.length >= o.max) return out;
    const n = kit.rng.int(o.units[0], o.units[1]);
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      for (let k = 0; k < n; k++) {
        const side: PropPlacement[] = [];
        for (const s of [-1, 1]) {
          const t = k * pitch + def.w / 2;
          const [pu, pv] = along ? [u + t, v + s * def.d / 2] : [u + s * def.d / 2, v + t];
          const rot = along ? (s < 0 ? fr.toFront : fr.toBack) : (s < 0 ? fr.minusU : fr.plusU);
          const [x, z] = kit.uv(pu, pv);
          const p = kit.put(kind, x, z, rot, {level, front: o.aisle});
          if (p) side.push(p);
        }
        got.push(...side);
        if (side.length < 2) return k > 0;
      }
      return true;
    }, level);
    if (ok) out.push(got);
  }
  return out;
}

/** Loose items round the tiers of a tiered display table (radially on each tier's visible ring). */
function stockTiers(kit: AnchorKit, t: PropPlacement, kind: PropKind, per: [number, number]): number {
  const it = PROP_DEFS[kind], tiers = bookTableTiers(), col = tiers[tiers.length - 1].rIn;
  let placed = 0;
  tiers.forEach((tier, i) => {
    const above = tiers[i + 1];
    const under = above ? above.y - tier.y - 0.03 >= it.h : false;
    const rMin = (above ? (under ? col : tier.rIn) : tier.rIn) + 0.02;
    const hw = it.w / 2, hd = it.d / 2;
    const rc = Math.sqrt(Math.max(0, (tier.r - 0.03) ** 2 - hw * hw)) - hd;
    if (rc - hd < rMin) return;
    const step = 2 * Math.atan((hw + 0.03) / (rc - hd));
    const n = Math.min(Math.floor((2 * Math.PI) / step), kit.rng.int(per[0], per[1]));
    const a0 = kit.rng.range(0, 2 * Math.PI);
    for (let k = 0; k < n; k++) {
      const a = a0 + (k * 2 * Math.PI) / n;
      const p = kit.onTop(t, kind, r3(Math.sin(a) * rc), r3(Math.cos(a) * rc), tier.y, normYaw(t.rot + a));
      if (p) { const c = Math.abs(Math.cos(t.rot + a)), s = Math.abs(Math.sin(t.rot + a)); p.hx = r3(c * hw + s * hd); p.hz = r3(s * hw + c * hd); placed++; }
    }
  });
  return placed;
}

// =================================================================================================================================
// Back rooms

/**
 * A back room (the carve's stock room / staff office, already dressed by the station dresser with shelving, cartons, crates or the
 * office furniture): + staff lockers, + openable cartons and a lidded tote (stock room); the office is relabelled the staff office.
 * Placed through the shared primitive on the room's own context (its walls / door zones), in the storey's local frame (the kit's lift
 * raises them with the sales floor). Returns what was added.
 */
function dressBackRoom(kit: AnchorKit, a: Area): {added: PropPlacement[]; swapped: PropPlacement | null} {
  const layout = kit.layout, level = a.level ?? 0, out: PropPlacement[] = [];
  const ctx: PlaceCtx = makePlaceCtx(layout, kit.rng, level, {x0: a.x - 3, y0: a.y - 3, x1: a.x + a.w + 3, y1: a.y + a.h + 3});
  // the room's wall-hung pieces (the station dresser's notice board / key cabinet / data cabinet ...: hung at y >= WALL_MOUNT_Y, they
  // block no cell; their reservation lived on the station dresser's own context) keep their cells here too: nothing stands under them
  const floor = a.floorY ?? layout.levels[level]?.baseY ?? 0;
  for (const p of layout.props) {
    if ((p.level ?? 0) !== level || p.area !== a.id || p.host !== undefined || !(p.mounted || p.y - floor >= WALL_MOUNT_Y - 0.01)) continue;
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (ctx.g.inBounds(cx, cy)) ctx.keep[ctx.g.idx(cx, cy)] = 1;
  }
  const sides = kit.rng.shuffle(['N', 'S', 'E', 'W'] as Side[]);
  // `n` of the first kind that fits, backs to a wall (every wall, 0.25 m steps), each with its access strip
  const along = (kinds: readonly PropKind[], n: number, front?: number): number => {
    for (const kind of kinds) {
      const w = PROP_DEFS[kind].w;
      let got = 0;
      for (const side of sides) {
        const [lo, hi] = wallRange(a, side);
        for (let t = lo + 0.1 + w / 2; t <= hi - 0.1 - w / 2 && got < n; t += 0.25) {
          const s = wallSpot(a, side, t, kind);
          const p = tryPlaceProp(ctx, a, kind, s.x, s.z, s.rot, {front});
          if (p) { out.push(p); got++; t += w; }
        }
      }
      if (got) return got;
    }
    return 0;
  };
  if (a.type === 'agent-office') a.label = OUTFITTER_OFFICE_LABEL;
  // staff lockers (else a tall cabinet / a filing cabinet: openable storage either way); a stock room the station dresser already
  // lined with shelving trades one wall shelf for the lockers in place (same width, its back to the same wall)
  let swapped: PropPlacement | null = null;
  if (!along(['staffLockers', 'cabinetTall', 'filingCabinet'], 1, 0.6) && a.type === 'stock-room') swapped = shelfToLockers(kit, ctx, a);
  if (a.type === 'stock-room') {
    along(['cardboardBoxFlaps'], kit.rng.int(2, 3), 0.5);
    along(['storageTote'], 1, 0.5);
  }
  if (!out.length && !swapped) kit.skipped.push(`back room ${a.id}: nothing added`);
  return {added: out, swapped};
}

/**
 * A stock room with no free wall for lockers: one of the station dresser's wall shelves (a station prop of this room, nothing standing
 * on it) becomes the staff lockers in place — the same 1.2 m width, its back kept to the same wall (the 5 cm deeper body steps out),
 * its door strip open floor, no other prop under its new box. Returns the converted prop (its layout index unchanged) or null.
 */
function shelfToLockers(kit: AnchorKit, ctx: PlaceCtx, a: Area): PropPlacement | null {
  const L = kit.layout, g = ctx.g, sd = PROP_DEFS.stockShelf, lk = PROP_DEFS.staffLockers;
  if (Math.abs(lk.w - sd.w) > 0.01) return null;
  const hosted = new Set(L.props.map(p => p.host).filter((h): h is number => h !== undefined));
  for (let i = 0; i < kit.p0; i++) {
    const p = L.props[i];
    if (p.area !== a.id || p.kind !== 'stockShelf' || hosted.has(i) || p.mounted) continue;
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
    // backed to the room's wall: the cell just behind it is no floor of this room
    const [bcx, bcy] = g.cellOf(p.x - fx * (sd.d / 2 + 0.1), p.z - fz * (sd.d / 2 + 0.1));
    if (g.inBounds(bcx, bcy) && g.cells[g.idx(bcx, bcy)] === FLOOR && g.area[g.idx(bcx, bcy)] === a.id) continue;
    const shift = (lk.d - sd.d) / 2, x = r3(p.x + fx * shift), z = r3(p.z + fz * shift);
    const f = OPENABLE_FRONT.staffLockers ?? 0.6, hw = lk.w / 2 - 0.02;
    const [c0, c1, c2, c3] = cellsOfBox(x + fx * (lk.d / 2 + f / 2), z + fz * (lk.d / 2 + f / 2), fx ? f / 2 : hw, fz ? f / 2 : hw);
    let open = true;
    for (let cy = c1; cy <= c3 && open; cy++) for (let cx = c0; cx <= c2; cx++) if (!g.walkable(cx, cy)) { open = false; break; }
    if (!open) continue;
    const {hx, hz} = footprint('staffLockers', p.rot);
    // (no other prop under its new box — wall-hung ones included while they hang lower than the lockers' top)
    if (L.props.some((q, j) => j !== i && (q.level ?? 0) === (p.level ?? 0) && q.host === undefined && q.y < p.y + lk.h - 0.01
      && Math.abs(q.x - x) < q.hx + hx - 0.01 && Math.abs(q.z - z) < q.hz + hz - 0.01)) continue;
    Object.assign(p, {kind: 'staffLockers', x, z, hx: r3(hx), hz: r3(hz), h: lk.h, blocksSight: lk.blocksSight, variant: 0});
    delete p.cut;
    const [b0, b1, b2, b3] = cellsOfBox(x, z, hx, hz);
    for (let cy = b1; cy <= b3; cy++) for (let cx = b0; cx <= b2; cx++) if (g.inBounds(cx, cy)) { g.blocked[g.idx(cx, cy)] = 1; if (lk.blocksSight) g.sightBlocked[g.idx(cx, cy)] = 1; }
    return p;
  }
  return null;
}
