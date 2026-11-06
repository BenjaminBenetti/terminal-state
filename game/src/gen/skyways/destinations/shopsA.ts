// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-A (B)): the interiors of this lane's DESTINATION anchor shop families — each
// family's kit (kindsShopsA.ts) plus existing fixtures / holders, laid out over the anchor's floors / zones / back rooms
// (layout.skyways.anchors). Called by destinations/index.ts.
//
// Every anchor reads as its own place at a glance (the placement kit: destinations/skywaysShopsAKit.ts; u along the shop front, v deep):
//  - PAPER PRAIRIE BOOKS: oak bookcases lining every solid wall and double-sided bookcase islands in rows (aisles leading in from the
//    front), round three-tier feature tables near the front, loose book stacks on the measured shelves / tiers, a cash counter by the
//    entry with a café corner (cooler, snack rack), and the READING ROOM — the two-level shop's other storey (a hall: its far corner):
//    wingback armchairs round small tables, more bookcases, a sideboard with stacks;
//  - COULEE & CANOE OUTFITTERS: the dome tent pitched as the centre display with camp chairs and a lantern round its door (a campsite),
//    the red canoe HUNG overhead (ceiling cables, a clear underside >= 2.3 m), packs standing along a wall, gear shelving with lanterns,
//    tiered display tables of lanterns, clothing rails, camp-food shelving and a drinks cooler (holders), the counter;
//  - NORTHERN GROOVE RECORDS: rows of double-sided record-bin racks with dig crates of records at their ends, a guitar wall, the
//    STAGE CORNER (upright piano, amp stack, drum kit), the listening booths each with an armchair and a small table, a jukebox,
//    accessory shelving (holders), a crate of new arrivals on the counter, gig posters;
//  - GRAIN ELEVATOR MODELS: the model-railway diorama as the centrepiece with a clear viewing ring, the tin-toy robot greeting at the
//    entry, sideboard exhibits along the walls (the airship model / a cased model ship on top), shelving packed with boxed kits, a
//    capsule-toy row, parts shelving (holders), the counter;
//  - LARCH & LOOM HOME: ROOM SETS separated by walking lanes — a living set (sofa to the wall, egg chair, arc lamp, side table, plant),
//    a dining set (the live-edge table with chairs round it), a bedroom set (the showroom bed, a lamp, a sideboard dresser); the
//    two-level shop's other storey holds more sets; the counter.
// Loot: existing holders only, rolling the anchor's purpose (ANCHOR_FAMILIES[f].use on every floor area: newsstand / convenience / tech /
// florist) — counters (tills), coolers, snack racks, stock shelving, open shelving, sideboards (openable cabinetLow); the stock rooms keep
// the station dresser's back-of-house dressing. Ordinary small loot sits in / on them; the floor stays for key items.

import type {Rng} from '../../../core/rng';
import {CELL} from '../../grid';
import {PROP_DEFS, SHELF_TIER_Y, SHOP_COUNTER_TOP_Y, type PropKind, type PropPlacement} from '../../props';
import {stockVariant} from '../../purposeShapes';
import {propBlocksDoorway} from '../../placeKit';
import type {Area, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor, SkywaysShopFamily} from '../skywaysTypes';
import {normYaw, toWorld, yawToward} from '../addonFrame';
import {AnchorKit, r3, snapEdge, type ShopsALane} from './skywaysShopsAKit';
import {SHOPS_A_MODEL, bookTableTiers, bookcaseShelves, canoeHangY, destDims} from './kindsShopsA';
import {destHangCables} from './skywaysDestModels';

export const SHOPS_A_FAMILIES: readonly SkywaysShopFamily[] = ['books', 'outfitter', 'music', 'hobby', 'design'];

/** QA / tests: one anchor's dressing (indices into layout.props, the reserved lanes, what could not be placed). */
export interface ShopsAResult {
  anchor: string;
  family: SkywaysShopFamily;
  format: SkywaysAnchor['format'];
  props: number[];
  lanes: ShopsALane[];
  skipped: string[];
  /** The hung canoe (outfitter): its prop index and the cable length up to the ceiling (m). */
  canoe?: {prop: number; cable: number};
}
const RESULTS = new WeakMap<StationLayout, ShopsAResult[]>();
/** QA / tests: what dressShopsA placed in a layout, per anchor (the generator ignores it). */
export function skywaysShopsADressOf(layout: StationLayout): readonly ShopsAResult[] { return RESULTS.get(layout) ?? []; }

/** Canoe hull underside (m above the floor) in a double-height hall (lower when the ceiling is lower: hung just under it). */
export const CANOE_UNDERSIDE = 3.6;
/** Nothing standing under the hung canoe reaches within this of its hull (m). */
export const CANOE_CLEAR = 0.3;

/** Dresses one anchor of this lane's families; returns the props placed. */
export function dressShopsA(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  if (!SHOPS_A_FAMILIES.includes(anchor.family) || !layout.areas[anchor.floor]) return 0;
  const kit = new AnchorKit(layout, rng, anchor);
  const res: ShopsAResult = {anchor: anchor.id, family: anchor.family, format: anchor.format, props: [], lanes: kit.lanes, skipped: kit.skipped};
  kit.reserveDoors();
  ({books, outfitter, music, hobby, design} as Record<string, (k: AnchorKit, r: ShopsAResult) => void>)[anchor.family](kit, res);
  kit.lift();
  for (let i = kit.p0; i < layout.props.length; i++) res.props.push(i);
  if (res.canoe) {
    const c = layout.props[res.canoe.prop], s = kit.st();
    res.canoe.cable = r3(Math.min(layout.areas[c.area].ceil, s.g.ceilAt(c.x, c.z)) - (c.y + canoeHangY()));
  }
  let list = RESULTS.get(layout);
  if (!list) RESULTS.set(layout, (list = []));
  list.push(res);
  return layout.props.length - kit.p0;
}

// =================================================================================================================================
// Families

/**
 * Loose book stacks per bookshop (both storeys): a picked-over abandoned shop, and a bounded instance count (each stack is a ~3k-tri
 * model): spread over every bookcase (a few shelves each) and the feature tables' bottom tiers.
 */
export const BOOK_STACK_BUDGET = 120;

function books(kit: AnchorKit): void {
  const rng = kit.rng;
  counter(kit, {snack: true, cooler: true});
  // a hall: the reading nook in its far corner (a two-level shop: the whole other storey is the reading room)
  if (kit.other === null) readingNook(kit, kit.level, 'far');
  kit.reserveLanes();
  // feature tables in the front band, bookcases lining every solid wall, double-sided bookcase runs filling the floor behind
  const tables = lattice(kit, 'skyDBookTable', {round: true, ring: 0.8, pitch: [3.0, 3.0], v: [2.6, Math.min(kit.fr.D - 2, Math.max(3.2, kit.fr.D * 0.42))], max: rng.int(3, 6)});
  if (tables.length < 3) tables.push(...lattice(kit, 'skyDBookTable', {round: true, ring: 0.8, pitch: [2.8, 2.8], max: 3 - tables.length}));
  const cases = kit.wallRun('skyDBookcase', {front: 0.9});
  cases.push(...fillRuns(kit, kit.level, 'skyDBookcase', {units: [2, 3], aisle: 1.3, max: 14, orient: longAxis(kit)}).flat());
  tables.push(...lattice(kit, 'skyDBookTable', {round: true, ring: 0.8, pitch: [3.0, 3.0], max: rng.int(1, 3)}));
  kit.posters(3);
  let side: PropPlacement | null = null;
  if (kit.other !== null) {
    // the READING ROOM upstairs / downstairs: nooks of wingbacks, bookcases round the walls and in runs, tables, a sideboard of stacks
    const L = kit.other;
    readingNook(kit, L, 'far');
    readingNook(kit, L, 'any');
    if (rng.chance(0.6)) readingNook(kit, L, 'any');
    side = kit.putNearWall('cabinetLow', kit.mouths.get(L)?.x ?? kit.entry.x, kit.mouths.get(L)?.z ?? kit.entry.z, {level: L, front: 0.7, tries: 80});
    cases.push(...kit.wallRun('skyDBookcase', {level: L, front: 0.9}));
    tables.push(...lattice(kit, 'skyDBookTable', {level: L, round: true, ring: 0.8, pitch: [3.0, 3.0], max: rng.int(2, 4)}));
    cases.push(...fillRuns(kit, L, 'skyDBookcase', {units: [2, 3], aisle: 1.4, max: rng.int(6, 10), orient: longAxis(kit)}).flat());
    kit.posters(2, L);
  }
  // the stacks: the tables' tiers first, a sideboard's top, then the bookcases in turn (a few shelves each) until the budget is spent
  let left = BOOK_STACK_BUDGET;
  for (const t of tables) left -= stockTiers(kit, t, 'skyDBookStack', [2, 4]);
  if (side) left -= stacksOnTop(kit, side, PROP_DEFS.cabinetLow.h, rng.int(1, 3));
  const per = Math.max(1, Math.min(4, Math.floor(left / Math.max(1, cases.length))));
  for (const bc of rng.shuffle(cases.slice())) {
    if (left <= 0) break;
    left -= stockBookcase(kit, bc, Math.min(left, rng.int(Math.max(1, per - 1), per + 1)));
  }
}

function outfitter(kit: AnchorKit, res: ShopsAResult): void {
  const rng = kit.rng, fr = kit.fr;
  counter(kit, {});
  const camp = campsite(kit);
  // the canoe overhead: over the campsite first, then over the main aisle in from the entry
  const spots: [number, number][] = [];
  if (camp) spots.push([camp.x, camp.z]);
  for (const v of [fr.D * 0.4, fr.D * 0.55, fr.D * 0.3, fr.D * 0.7]) for (const du of [0, -2, 2, -4, 4]) spots.push(kit.uv(kit.uE + du, v));
  const canoe = hangCanoe(kit, spots);
  if (canoe) res.canoe = {prop: kit.layout.props.indexOf(canoe), cable: 0};
  else kit.skipped.push('canoe');
  kit.reserveLanes();
  // round the campsite: lantern display tables and clothing rails; along the walls: camp food and drinks (the store's holders), a
  // pack wall, gear shelving with lanterns, a bike or two; then aisles of gear / food shelving filling the rest of the floor
  for (const t of lattice(kit, 'skyDBookTable', {round: true, ring: 0.8, pitch: [3.0, 3.0], max: rng.int(2, 3)})) stockTiers(kit, t, 'skyDLantern', [2, 4]);
  lattice(kit, 'clothingRack', {ring: 0.7, pitch: [2.6, 2.4], max: rng.int(2, 4)});
  let food = kit.wallRun('stockShelf', {sides: [fr.back], cluster: 4, gap: 0.6, max: 5, front: 0.9, variant: () => stockVariant('grocery')});
  if (food.length < 2) food = food.concat(kit.wallRun('stockShelf', {cluster: 3, gap: 0.6, max: 4 - food.length, front: 0.9, variant: () => stockVariant('grocery')}));
  const [cx, cz] = kit.inside(3);
  for (let i = 0, n = rng.int(1, 2); i < n; i++) kit.putNearWall('shopCooler', cx, cz);
  const packs = kit.wallRun('skyDBackpack', {cluster: rng.int(4, 6), gap: 0.9, max: rng.int(7, 12)});
  if (!packs.length) kit.skipped.push('pack wall');
  for (let i = 0, n = rng.int(1, 2); i < n; i++) kit.putNearWall('bicycle', ...kit.inside(kit.fr.D * 0.7), {tries: 60});
  for (const sh of kit.wallRun('shelf', {cluster: 3, gap: 0.6, max: rng.int(4, 8), front: 0.9})) shelfItems(kit, sh, 'skyDLantern', [1, 2], 2);
  fillRuns(kit, kit.level, 'stockShelf', {units: [2, 3], aisle: 1.3, max: rng.int(1, 3), orient: longAxis(kit), variant: () => stockVariant('grocery')});
  for (const run of fillRuns(kit, kit.level, 'shelf', {units: [2, 3], aisle: 1.3, max: rng.int(6, 10), orient: longAxis(kit)})) for (const sh of run) shelfItems(kit, sh, 'skyDLantern', [1], 1);
  lattice(kit, 'clothingRack', {ring: 0.7, pitch: [2.6, 2.4], max: rng.int(1, 3)});
  kit.posters(3);
}

function music(kit: AnchorKit): void {
  const rng = kit.rng;
  counter(kit, {crate: true});
  stageCorner(kit);
  kit.reserveLanes();
  const flanks = flankSides(kit).filter(s => !boothSide(kit, s));
  const want = rng.int(6, 10);
  const guitars = kit.wallRun('skyDGuitar', {sides: flanks.length ? flanks : undefined, cluster: 1, gap: 0.22, max: want});
  // (the flank taken by the counter / the stage: the guitar wall moves to the back or any other free wall)
  if (guitars.length < 4) guitars.push(...kit.wallRun('skyDGuitar', {sides: [kit.fr.back, ...flankSides(kit)], cluster: 1, gap: 0.22, max: want - guitars.length}));
  if (guitars.length < 4) kit.skipped.push(`guitar wall: ${guitars.length}`);
  kit.wallRun('stockShelf', {cluster: 2, gap: 0.6, max: rng.int(1, 2), front: 0.9, variant: () => stockVariant('devices')});
  const bz = kit.zones[0];
  const [jx, jz] = bz ? [(bz.x + bz.w / 2) * CELL, (bz.y + bz.h / 2) * CELL] : kit.inside(kit.fr.D * 0.6);
  kit.putNearWall('jukebox', jx, jz, {front: 0.9, tries: 80});
  for (const z of kit.zones) listeningBooth(kit, z.id);
  // the browsing floor: rows of double-sided bin racks (dig crates of records at their ends), a crate row along a free wall
  const runs = fillRuns(kit, kit.level, 'skyDRecordBins', {units: [2, 3], aisle: 1.2, max: rng.int(6, 12), orient: longAxis(kit) === 'u' ? 'v' : 'u'});
  for (const run of runs) digCrates(kit, run);
  if (!runs.length) kit.skipped.push('record bins');
  kit.wallRun('skyDRecordCrate', {cluster: rng.int(3, 5), gap: 1.2, max: rng.int(4, 8)});
  kit.posters(4);
}

function hobby(kit: AnchorKit): void {
  const rng = kit.rng;
  counter(kit, {});
  robotAtEntry(kit);
  diorama(kit);
  kit.reserveLanes();
  // sideboard exhibits: the airship model / a cased model ship on top (sealed exhibits; the sideboards are openable holders)
  const boards = kit.wallRun('cabinetLow', {cluster: 2, gap: 1.2, max: rng.int(3, 5), front: 0.7});
  boards.forEach((b, i) => exhibitOn(kit, b, i % 2 === 0 ? 'skyDAirshipModel' : 'shipModel') || exhibitOn(kit, b, 'skyDAirshipModel'));
  kit.wallRun('capsuleToyMachine', {cluster: 3, gap: 0.6, max: rng.int(2, 4), front: 0.9});
  kit.wallRun('stockShelf', {cluster: 1, max: 1, front: 0.9, variant: () => stockVariant('parts')});
  // kit shelving: every free wall, then double-sided gondola runs between the diorama's ring and the walls
  for (const sh of kit.wallRun('shelf', {cluster: 4, gap: 0.5, max: 16, front: 0.9})) shelfItems(kit, sh, 'skyDModelKits', [0, 1, 2], 2);
  lattice(kit, 'architectModel', {ring: 0.8, pitch: [3.4, 3.0], max: rng.int(1, 2)});
  if (rng.chance(0.5)) lattice(kit, 'giantTeddy', {ring: 0.6, pitch: [3.0, 3.0], max: 1});
  for (const run of fillRuns(kit, kit.level, 'shelf', {units: [2, 3], aisle: 1.3, max: rng.int(5, 9), orient: longAxis(kit)})) for (const sh of run) shelfItems(kit, sh, 'skyDModelKits', [0, 1, 2], 2);
  kit.posters(3);
}

function design(kit: AnchorKit): void {
  const rng = kit.rng;
  counter(kit, {});
  kit.reserveLanes();
  // room sets until the floor is full (each kind at least once first), then a few plants between them
  const roomSets = (level: number, first: ((k: AnchorKit, l: number) => boolean)[]): number => {
    let n = 0, miss = 0;
    const order = [...first, ...rng.shuffle([livingSet, diningSet, bedroomSet, livingSet, bedroomSet, diningSet, livingSet, readingCorner, readingCorner])];
    for (const f of order) {
      if (miss >= 4 || n >= 9) break;
      if (f(kit, level)) { n++; miss = 0; } else miss++;
    }
    lattice(kit, 'planterTree', {level, ring: 0.6, pitch: [3.0, 3.0], max: rng.int(1, 3)});
    return n;
  };
  const n = roomSets(kit.level, [livingSet, diningSet, bedroomSet]);
  if (n < 3) kit.skipped.push(`design: ${n} room sets on the sales floor`);
  for (const k of ['skyDSofa', 'skyDDiningTable', 'skyDShowroomBed'] as PropKind[]) if (!kit.placed.some(p => p.kind === k)) kit.skipped.push(`design: no ${k} set`);
  if (kit.other !== null) {
    roomSets(kit.other, rng.shuffle([livingSet, bedroomSet, diningSet]));
    kit.posters(2, kit.other);
  }
  kit.posters(3);
}

// =================================================================================================================================
// Shared pieces

/** The flank walls (neither the front nor the back). */
function flankSides(kit: AnchorKit): Side[] {
  return (['N', 'S', 'E', 'W'] as Side[]).filter(s => s !== kit.fr.front && s !== kit.fr.back);
}
/** The music store's listening booths open off this flank of the floor. */
function boothSide(kit: AnchorKit, side: Side): boolean {
  const f = kit.layout.areas[kit.an.floor];
  return kit.zones.some(z => side === 'W' ? z.x + z.w <= f.x : side === 'E' ? z.x >= f.x + f.w : side === 'N' ? z.y + z.h <= f.y : z.y >= f.y + f.h);
}

/**
 * The cash counter by the entry: two counter modules end to end beside the entry aisle, their customer side toward it, a staff
 * aisle behind (reserved); the till on the module nearest the door; optionally an impulse snack rack at its end, a drinks cooler on
 * the nearest wall, a crate of records on the counter.
 */
function counter(kit: AnchorKit, o: {snack?: boolean; cooler?: boolean; crate?: boolean}): PropPlacement[] {
  const fr = kit.fr, def = PROP_DEFS.shopCounter, eh = kit.entry.half, uE = kit.uE;
  let run: PropPlacement[] = [];
  for (const nm of [2, 1]) {
  if (run.length) break;
  search: for (const s of kit.rng.shuffle([1, -1])) for (const dv of [2.0, 2.5, 3.0, 3.5, 4.5, 5.5]) for (const du of [eh + 1.2, eh + 1.7, eh + 2.4, eh + 3.2, eh + 4.2, eh + 5.5]) {
    // (the BACK edge on a cell line: the staff aisle behind starts on a clean cell)
    const u = r3(Math.round((uE + s * (du + def.d / 2) + s * def.d / 2) / CELL) * CELL - s * def.d / 2);
    if (u - def.d / 2 - 1.0 < 0.2 || u + def.d / 2 + 1.0 > fr.W - 0.2) continue;
    const rot = s > 0 ? fr.minusU : fr.plusU;
    const v0 = snapEdge(dv + def.w / 2, def.w / 2);
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      for (let k = 0; k < nm; k++) {
        const [x, z] = kit.uv(u, v0 + k * (def.w + 0.01));
        const p = kit.put('shopCounter', x, z, rot, {front: 1.0});
        if (!p) return false;
        got.push(p);
      }
      // the staff aisle behind the run: free floor, reserved
      const [ax, az] = kit.uv(u + s * (def.d / 2 + 0.02), v0 - def.w / 2), [bx, bz] = kit.uv(u + s * (def.d / 2 + 0.9), v0 + def.w * (nm - 0.5) + 0.01);
      const box = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)] as const;
      if (!kit.boxFree(box[0], box[1], box[2], box[3], kit.level, true)) return false;
      kit.keepBox(box[0], box[1], box[2], box[3]);
      return true;
    });
    if (ok) { run = got; break search; }
  }
  // else the run parallel to the front, beside the entry, facing it (the staff aisle behind it, deeper in)
  if (!run.length) search2: for (const s of kit.rng.shuffle([1, -1])) for (const dv of [2.4, 3.0, 3.8, 4.8]) for (const du of [eh + 0.9, eh + 1.6, eh + 2.6, eh + 3.8, eh + 5.2]) {
    const v = r3(Math.round((dv + def.d) / CELL) * CELL - def.d / 2); // (its back edge on a cell line)
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      for (let k = 0; k < nm; k++) {
        const u = snapEdge(uE + s * (du + def.w / 2 + k * (def.w + 0.01)), def.w / 2);
        const [x, z] = kit.uv(u, v);
        const p = kit.put('shopCounter', x, z, fr.toFront, {front: 1.0});
        if (!p) return false;
        got.push(p);
      }
      const us = got.map(p => kit.toUV(p.x, p.z)[0]);
      const [ax, az] = kit.uv(Math.min(...us) - def.w / 2, v + def.d / 2 + 0.02), [bx, bz] = kit.uv(Math.max(...us) + def.w / 2, v + def.d / 2 + 0.9);
      const box = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)] as const;
      if (!kit.boxFree(box[0], box[1], box[2], box[3], kit.level, true)) return false;
      kit.keepBox(box[0], box[1], box[2], box[3]);
      return true;
    });
    if (ok) { run = got; break search2; }
  }
  } // (two modules, else a single one)
  if (!run.length) { kit.skipped.push('counter'); return run; }
  const last = run[run.length - 1];
  const till = run[0];
  const reg = kit.onTop(till, 'cashRegister', 0.25, -0.08, SHOP_COUNTER_TOP_Y);
  if (reg) (till.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: 0.25 - 0.26, x1: 0.25 + 0.26});
  if (o.crate) {
    const c = PROP_DEFS.skyDRecordCrate;
    if (c.d <= def.d - 0.06 && c.w <= 0.7) {
      const p = kit.onTop(last, 'skyDRecordCrate', -0.3, 0, SHOP_COUNTER_TOP_Y);
      if (p) (last.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: r3(-0.3 - c.w / 2 - 0.02), x1: r3(-0.3 + c.w / 2 + 0.02)});
    }
  }
  if (o.snack) {
    // the impulse rack at the run's door end, facing the aisle
    // (beside the till along the counter's length; the side the second module stands on simply does not fit)
    const sr = PROP_DEFS.snackRack;
    snack: for (const off of [def.w / 2 + 0.05 + sr.w / 2, def.w / 2 + 0.3 + sr.w / 2]) for (const sx of [-1, 1]) {
      const [x, z] = toWorld(till, sx * off, 0);
      if (kit.put('snackRack', x, z, till.rot, {front: 0.8})) break snack;
    }
  }
  if (o.cooler) kit.putNearWall('shopCooler', last.x, last.z, {tries: 40});
  return run;
}

/** Islands of `kind` on a lattice over the storey's floor (frame u / v), tried in a shuffled order; rows stay aligned. */
function lattice(kit: AnchorKit, kind: PropKind, o: {level?: number; round?: boolean; ring?: number; pitch: [number, number]; u?: [number, number]; v?: [number, number]; max: number; rot?: () => number; front?: number}): PropPlacement[] {
  const fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[] = [];
  if (o.max <= 0) return out;
  const level = o.level ?? kit.level;
  const [u0, u1] = o.u ?? [1.2 + def.w / 2, fr.W - 1.2 - def.w / 2], [v0, v1] = o.v ?? [2.6 + def.d / 2, fr.D - 1.2 - def.d / 2];
  const spots: [number, number][] = [];
  const nu = Math.max(1, Math.floor((u1 - u0) / o.pitch[0]) + 1), nv = Math.max(1, Math.floor((v1 - v0) / o.pitch[1]) + 1);
  const su = u0 + ((u1 - u0) - (nu - 1) * o.pitch[0]) / 2, sv = v0 + ((v1 - v0) - (nv - 1) * o.pitch[1]) / 2;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) spots.push([su + i * o.pitch[0], sv + j * o.pitch[1]]);
  for (const [u, v] of kit.rng.shuffle(spots)) {
    if (out.length >= o.max) break;
    const rot = o.rot?.() ?? fr.toFront;
    const [x, z] = kit.uv(u, v);
    const q = Math.abs(Math.sin(rot)) > 0.7;
    const hx = (q ? def.d : def.w) / 2, hz = (q ? def.w : def.d) / 2;
    const sx = snapEdge(x, hx), sz = snapEdge(z, hz);
    const p = o.round ? kit.putRound(kind, sx, sz, rot, {level, ring: o.ring}) : kit.put(kind, sx, sz, rot, {level, ring: o.ring, front: o.front});
    if (p) out.push(p);
  }
  return out;
}

/** The floor's longer axis in the frame ('u' along the front, 'v' in depth): runs laid along it read as aisles. */
function longAxis(kit: AnchorKit): 'u' | 'v' {
  return kit.fr.W >= kit.fr.D ? 'u' : 'v';
}

/**
 * Double-sided island RUNS of `kind` (two rows back to back on a cell line, `units` long), scanned greedily over the storey's floor
 * (0.5 m grid, the deep floor first) so they pack into aisles `aisle` m wide (each unit's front strip, reserved); a run along u
 * (`orient` 'u') faces +/-v, along v faces +/-u. A run needs its first back-to-back pair; it stops where the next unit does not fit.
 * Lanes / door strips / centrepiece rings already reserved stay clear. Returns the runs.
 */
function fillRuns(kit: AnchorKit, level: number, kind: PropKind, o: {units: [number, number]; aisle: number; max: number; orient: 'u' | 'v'; variant?: () => number}): PropPlacement[][] {
  const fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[][] = [];
  if (o.max <= 0) return out;
  const along = o.orient === 'u';
  // unit pitch along the run: whole cells (packed units never share a cell), never closer than 2 cm
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
          const p = kit.put(kind, x, z, rot, {level, front: o.aisle, variant: o.variant?.()});
          if (p) side.push(p);
        }
        got.push(...side);
        if (side.length < 2) return k > 0; // the first pair makes the island; a later unit that does not fit ends the run
      }
      return true;
    }, level);
    if (ok) out.push(got);
  }
  return out;
}

/**
 * `n` loose book stacks on a bookcase's measured shelves: random shelves that clear a stack, one per shelf (now and then two side by
 * side), front-aligned in the bay. Returns the stacks placed.
 */
function stockBookcase(kit: AnchorKit, bc: PropPlacement, n: number): number {
  const rng = kit.rng, def = PROP_DEFS.skyDBookcase, sd = PROP_DEFS.skyDBookStack, shelves = bookcaseShelves();
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

/** A few loose stacks on a host's flat top (a sideboard), left to right, the host's loot surface giving up their span; returns them. */
function stacksOnTop(kit: AnchorKit, host: PropPlacement, top: number, n: number): number {
  const def = PROP_DEFS[host.kind], sd = PROP_DEFS.skyDBookStack;
  let x = -def.w / 2 + 0.12, placed = 0;
  for (let k = 0; k < n && x + sd.w <= def.w / 2 - 0.12; k++) {
    if (sd.d > def.d - 0.06) break;
    if (kit.onTop(host, 'skyDBookStack', r3(x + sd.w / 2), r3(-def.d / 2 + 0.03 + sd.d / 2), top)) placed++;
    (host.cut ??= []).push({y: top, x0: r3(x - 0.02), x1: r3(x + sd.w + 0.02)});
    x += sd.w + kit.rng.range(0.1, 0.4);
  }
  return placed;
}

/**
 * Loose items round the tiers of a three-tier table: radially aligned on each tier's visible ring (never inside the top tier's hollow
 * centre; under a tier's overhang only when the item clears the tier above), evenly spaced, a random count per tier.
 */
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
    const room = Math.floor((2 * Math.PI) / step);
    const n = Math.min(room, kit.rng.int(per[0], per[1]));
    const a0 = kit.rng.range(0, 2 * Math.PI);
    for (let k = 0; k < n; k++) {
      const a = a0 + (k * 2 * Math.PI) / n;
      const p = kit.onTop(t, kind, r3(Math.sin(a) * rc), r3(Math.cos(a) * rc), tier.y, normYaw(t.rot + a));
      if (p) { const c = Math.abs(Math.cos(t.rot + a)), s = Math.abs(Math.sin(t.rot + a)); p.hx = r3(c * hw + s * hd); p.hz = r3(s * hw + c * hd); placed++; }
    }
  });
  return placed;
}

/** Loose items on the tiers of an open steel shelving unit (two per tier, its loot surface giving up their spans). */
function shelfItems(kit: AnchorKit, sh: PropPlacement, kind: PropKind, tiers: number[], max: number): void {
  const def = PROP_DEFS.shelf, it = PROP_DEFS[kind];
  if (it.d > def.d - 0.04) return;
  for (const i of tiers) {
    const y = SHELF_TIER_Y[i], clear = (SHELF_TIER_Y[i + 1] ?? def.h) - y - 0.03;
    if (it.h > clear) continue;
    const n = Math.min(max, kit.rng.int(1, 2), Math.floor((def.w - 0.12) / (it.w + 0.08)));
    for (let k = 0; k < n; k++) {
      const lx = r3(n === 1 ? kit.rng.range(-0.25, 0.25) : (k === 0 ? -1 : 1) * (it.w / 2 + 0.06));
      kit.onTop(sh, kind, lx, r3(-def.d / 2 + 0.02 + it.d / 2), y);
      (sh.cut ??= []).push({y, x0: r3(lx - it.w / 2 - 0.02), x1: r3(lx + it.w / 2 + 0.02)});
    }
  }
}

/** The far corner of a storey (from its way in), or anywhere: reading-nook / set centre candidates, best first. */
function spotsFrom(kit: AnchorKit, level: number, mode: 'far' | 'any'): [number, number][] {
  const fr = kit.fr, out: [number, number][] = [];
  for (let u = 2.0; u <= fr.W - 2.0; u += 1.0) for (let v = 2.6; v <= fr.D - 2.0; v += 1.0) out.push(kit.uv(u, v));
  const [ox, oz] = level === kit.level ? kit.inside(1) : [kit.mouths.get(level)?.x ?? kit.entry.x, kit.mouths.get(level)?.z ?? kit.entry.z];
  if (mode === 'far') return out.sort((p, q) => Math.hypot(q[0] - ox, q[1] - oz) - Math.hypot(p[0] - ox, p[1] - oz));
  return kit.rng.shuffle(out);
}

/** A reading nook: a small table with 2-4 wingback armchairs round it (facing it) and a plant; reserved round as one group. */
function readingNook(kit: AnchorKit, level: number, mode: 'far' | 'any'): boolean {
  const tb = PROP_DEFS.cafeBistroTable, ch = PROP_DEFS.skyDWingbackChair;
  for (const [x0, z0] of spotsFrom(kit, level, mode).slice(0, 80)) {
    const x = Math.round(x0 / CELL) * CELL, z = Math.round(z0 / CELL) * CELL;
    const th = Math.ceil((tb.w / 2 - 0.04) / CELL) * CELL;
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const t = kit.putRound('cafeBistroTable', x, z, 0, {level});
      if (!t) return false;
      got.push(t);
      for (const [dx, dz] of kit.rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][])) {
        const q = dx !== 0, hx = (q ? ch.d : ch.w) / 2, hz = (q ? ch.w : ch.d) / 2;
        const cx = x + dx * (th + hx + 0.02), cz = z + dz * (th + hz + 0.02);
        const p = kit.put('skyDWingbackChair', cx, cz, yawToward(-dx, -dz), {level});
        if (p) got.push(p);
      }
      if (got.length < 3) return false;
      kit.put('pottedPlantSmall', x + (kit.rng.chance(0.5) ? 1 : -1) * 1.25, z + (kit.rng.chance(0.5) ? 1 : -1) * 1.25, 0, {level});
      return true;
    }, level);
    if (ok) { reserveAround(kit, got, level, 0.6); return true; }
  }
  kit.skipped.push(`reading nook (level ${level})`);
  return false;
}

/** Reserves the free floor round a group (its bounding box + margin): the next group keeps a walking lane from it. */
function reserveAround(kit: AnchorKit, ps: PropPlacement[], level: number, margin: number): void {
  if (!ps.length) return;
  const x0 = Math.min(...ps.map(p => p.x - p.hx)) - margin, x1 = Math.max(...ps.map(p => p.x + p.hx)) + margin;
  const z0 = Math.min(...ps.map(p => p.z - p.hz)) - margin, z1 = Math.max(...ps.map(p => p.z + p.hz)) + margin;
  kit.keepBox(x0, z0, x1, z1, level);
}

// --- outfitter ---------------------------------------------------------------------------------------------------------------------

/** The campsite display: the tent pitched mid-floor (door to the entry), camp chairs and a lantern at its door, a pack beside it. */
function campsite(kit: AnchorKit): {x: number; z: number} | null {
  const fr = kit.fr, tent = PROP_DEFS.skyDTent, chair = PROP_DEFS.skyDCampChair;
  const cands: [number, number][] = [];
  for (const dv of [0, 0.8, -0.8, 1.6, -1.6, 2.4]) for (const du of [0, 1.5, -1.5, 3, -3, 4.5, -4.5]) cands.push([fr.W / 2 + du, fr.D * 0.55 + dv]);
  for (const [u0, v0] of cands) {
    const [x, z] = kit.uv(u0, v0);
    const sx = snapEdge(x, tent.w / 2), sz = snapEdge(z, tent.d / 2);
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const t = kit.put('skyDTent', sx, sz, fr.toFront);
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
      { const [lx, lz] = kit.uv(u, vd); const p = kit.put('skyDLantern', lx, lz, 0); if (p) got.push(p); }
      for (const s of kit.rng.shuffle([-1, 1])) {
        const [bx, bz] = kit.uv(u + s * (tent.w / 2 + 0.45), v + 0.2);
        const p = kit.put('skyDBackpack', bx, bz, fr.toFront);
        if (p) { got.push(p); break; }
      }
      return true;
    });
    if (ok) { reserveAround(kit, got, kit.level, 0.7); return {x: got[0].x, z: got[0].z}; }
  }
  kit.skipped.push('campsite (tent)');
  return null;
}

/**
 * The canoe hung overhead on two ceiling cables: its long axis along the front; the hull's underside CANOE_UNDERSIDE above the
 * floor (lower under a lower ceiling, never under 2.3 m); nothing standing below reaches within CANOE_CLEAR of the hull, no light
 * fixture in its footprint (the cables), clear of doorways.
 */
function hangCanoe(kit: AnchorKit, spots: [number, number][]): PropPlacement | null {
  const def = PROP_DEFS.skyDCanoe, s = kit.st(), g = s.g, base = s.base, layout = kit.layout;
  for (const [x0, z0] of spots) for (const rot of [kit.fr.toFront, kit.fr.plusU]) {
    const q = Math.abs(Math.sin(rot)) > 0.7, hx = (q ? def.d : def.w) / 2, hz = (q ? def.w : def.d) / 2;
    const x = r3(x0), z = r3(z0);
    const area = kit.areaAt(x, z);
    if (!area) continue;
    let ceil = area.ceil, inside = true;
    for (const [px, pz] of [[x - hx, z - hz], [x + hx, z - hz], [x - hx, z + hz], [x + hx, z + hz], [x, z]]) {
      const a = kit.areaAt(px, pz);
      const [cx, cy] = g.cellOf(px, pz);
      if (a !== area || g.rampIdx[g.idx(cx, cy)] >= 0) { inside = false; break; }
      ceil = Math.min(ceil, g.ceilAt(px, pz));
    }
    if (!inside) continue;
    const y = r3(Math.min(CANOE_UNDERSIDE, ceil - base - canoeHangY() - 0.03));
    if (y < 2.3) continue;
    const below = layout.props.some((p, i) => (p.level ?? 0) === kit.level && !p.mounted && Math.abs(p.x - x) < p.hx + hx + 0.1 && Math.abs(p.z - z) < p.hz + hz + 0.1
      && (i >= kit.p0 ? p.y + p.h : p.y + p.h - base) > y - CANOE_CLEAR);
    if (below) continue;
    // light fixtures: hung right under the ceiling the hull would meet them (none over the footprint); hung lower, only its two
    // cable anchors (a third of its length out from the middle) keep clear of a fixture
    const top = y + canoeHangY(), low = ceil - base - top > 0.3;
    // (the renderer's suspension points: gen/skyways/destinations/skywaysDestModels.ts destHangCables, along the model's X)
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

// --- music -------------------------------------------------------------------------------------------------------------------------

/** The stage corner: the upright piano and the amp stack backed to the far wall in a back corner, the drum kit before them. */
function stageCorner(kit: AnchorKit): void {
  const fr = kit.fr, piano = PROP_DEFS.skyDPiano, amp = PROP_DEFS.skyDAmpStack, drums = PROP_DEFS.skyDDrumKit;
  const back = fr.back;
  // the back corner away from the counter (and from the booth flank when it fits)
  const counterU = kit.placed.find(p => p.kind === 'shopCounter');
  const cu = counterU ? kit.toUV(counterU.x, counterU.z)[0] : kit.uE;
  const ends = cu < fr.W / 2 ? [1, 0] : [0, 1];
  for (const end of ends) for (const inset of [0.6, 1.2, 2.0, 3.0, 4.2]) {
    const uP = end ? fr.W - inset - piano.w / 2 : inset + piano.w / 2;
    const dir = end ? -1 : 1; // toward the middle along the back wall
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const [px, pz] = kit.uv(uP, fr.D - 0.03 - piano.d / 2);
      const a = kit.areaAt(px, pz);
      if (!a || !kit.solidWall(a, back, back === 'N' || back === 'S' ? px : pz, 'skyDPiano')) return false;
      const p = kit.put('skyDPiano', px, pz, fr.toFront, {area: a, front: 0.6});
      if (!p) return false;
      got.push(p);
      // the amp stack beside the piano (toward the middle, else the other side), the drum kit out in front of the amp
      let uA = NaN;
      for (const [s, gap] of [[dir, 0.35], [dir, 0.7], [-dir, 0.35], [-dir, 0.7]] as [number, number][]) {
        const u = uP + s * (piano.w / 2 + gap + amp.w / 2), [ax, az] = kit.uv(u, fr.D - 0.03 - amp.d / 2);
        const pa = kit.put('skyDAmpStack', ax, az, fr.toFront, {front: 0.5});
        if (pa) { got.push(pa); uA = u; break; }
      }
      if (!Number.isFinite(uA)) return false;
      const sA = Math.sign(uA - uP);
      drum: for (const dv of [0.9, 1.3, 1.8, 2.4]) for (const du of [sA * (drums.w / 2 - 0.3), sA * 0.3, 0, sA * (drums.w / 2 + 0.3), -sA * 0.6]) {
        const [dx, dz] = kit.uv(uA + du, fr.D - 0.03 - Math.max(amp.d, piano.d) - dv - drums.d / 2);
        const pd = kit.put('skyDDrumKit', dx, dz, fr.toFront);
        if (pd) { got.push(pd); break drum; }
      }
      return got.length === 3;
    });
    if (ok) { reserveAround(kit, got, kit.level, 0.6); return; }
  }
  kit.skipped.push('stage corner');
}

/**
 * Dig crates of records on the floor at a bin run's two ends (the measured bin racks slope from a 0.51 m front lip to a 0.99 m back
 * rim: no flat top to stand a crate on, so the crates stand at the run ends like a record shop's overflow).
 */
function digCrates(kit: AnchorKit, run: PropPlacement[]): void {
  const crate = PROP_DEFS.skyDRecordCrate;
  const x0 = Math.min(...run.map(p => p.x - p.hx)), x1 = Math.max(...run.map(p => p.x + p.hx));
  const z0 = Math.min(...run.map(p => p.z - p.hz)), z1 = Math.max(...run.map(p => p.z + p.hz));
  const alongX = x1 - x0 >= z1 - z0, mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
  for (const end of kit.rng.shuffle([-1, 1])) {
    const e = alongX ? (end < 0 ? x0 : x1) : (end < 0 ? z0 : z1);
    const c = end < 0 ? Math.floor((e - 0.04) / CELL) * CELL - crate.w / 2 - 0.02 : Math.ceil((e + 0.04) / CELL) * CELL + crate.w / 2 + 0.02;
    const rot = alongX ? (end < 0 ? -Math.PI / 2 : Math.PI / 2) : (end < 0 ? Math.PI : 0);
    for (const off of kit.rng.shuffle([-0.25, 0.25]).slice(0, kit.rng.int(1, 2))) {
      const [x, z] = alongX ? [c, mid + off] : [mid + off, c];
      kit.put('skyDRecordCrate', x, z, rot);
    }
  }
}

/** A listening booth: an armchair facing into the booth from its back wall (or a bean bag) and a small table beside it. */
function listeningBooth(kit: AnchorKit, zoneId: number): void {
  const z = kit.layout.areas[zoneId];
  const door = kit.st().doors.find(d => d.a === zoneId || d.b === zoneId);
  if (!z || !door) return;
  const p = kit.doorIn(door, kit.level, 0, zoneId);
  if (!p) return;
  // the wall opposite the door
  const cx = (z.x + z.w / 2) * CELL, cz = (z.y + z.h / 2) * CELL;
  const back: Side = Math.abs(p.x - cx) > Math.abs(p.z - cz) ? (p.x < cx ? 'E' : 'W') : (p.z < cz ? 'S' : 'N');
  const t = back === 'N' || back === 'S' ? cx : cz;
  let chair: PropPlacement | null = null;
  for (const kind of ['loungeArmchair', 'beanBag'] as PropKind[]) {
    for (const dt of [0, -0.5, 0.5]) {
      const d = PROP_DEFS[kind];
      const off = d.d / 2 + 0.05;
      const [x, zz] = back === 'N' ? [t + dt, z.y * CELL + off] : back === 'S' ? [t + dt, (z.y + z.h) * CELL - off] : back === 'W' ? [z.x * CELL + off, t + dt] : [(z.x + z.w) * CELL - off, t + dt];
      chair = kit.put(kind, x, zz, ({N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2} as const)[back], {area: z});
      if (chair) break;
    }
    if (chair) break;
  }
  if (!chair) { kit.skipped.push(`booth ${zoneId} seat`); return; }
  for (const s of kit.rng.shuffle([-1, 1])) {
    const [x, zz] = toWorld(chair, s * (PROP_DEFS[chair.kind].w / 2 + 0.45), 0);
    if (kit.putRound('cafeBistroTable', Math.round(x / CELL) * CELL, Math.round(zz / CELL) * CELL, 0, {area: z})) break;
  }
}

// --- hobby -------------------------------------------------------------------------------------------------------------------------

/** The tin-toy robot just inside the entry, beside the entry strip, greeting the door. */
function robotAtEntry(kit: AnchorKit): void {
  const E = kit.entry, tx = -E.nz, tz = E.nx;
  for (const s of kit.rng.shuffle([-1, 1])) for (const dv of [1.6, 2.2, 3.0, 3.8]) for (const lat of [E.half + 0.9, E.half + 1.4, E.half + 2.0]) {
    const x = E.x + E.nx * dv + tx * lat * s, z = E.z + E.nz * dv + tz * lat * s;
    if (kit.put('skyDToyRobot', x, z, kit.fr.toFront)) return;
  }
  kit.skipped.push('robot at the entry');
}

/** The model-railway diorama mid-floor (its front to the entry), a 1.2 m viewing ring all round it. */
function diorama(kit: AnchorKit): void {
  const fr = kit.fr, def = PROP_DEFS.skyDDiorama;
  for (const dv of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, 3.0]) for (const du of [0, 1, -1, 2, -2, 3, -3, 4.5, -4.5, 6, -6]) {
    const [x, z] = kit.uv(fr.W / 2 + du, Math.max(2.6 + 1.2 + def.d / 2, fr.D * 0.5) + dv);
    if (kit.put('skyDDiorama', snapEdge(x, def.w / 2), snapEdge(z, def.d / 2), fr.toFront, {ring: 1.2})) return;
    if (kit.put('skyDDiorama', snapEdge(x, def.d / 2), snapEdge(z, def.w / 2), fr.plusU, {ring: 1.2})) return;
  }
  kit.skipped.push('diorama');
}

/** An exhibit standing on a sideboard's top, flush with its back (the sideboard's loot surface gives up the span). */
function exhibitOn(kit: AnchorKit, host: PropPlacement, kind: PropKind): boolean {
  const cab = PROP_DEFS[host.kind], def = PROP_DEFS[kind];
  if (def.w > cab.w - 0.04 || def.d > cab.d - 0.02 || destPlanned(kind)) return false;
  const p = kit.onTop(host, kind, 0, r3(-(cab.d - def.d) / 2 + 0.01), cab.h);
  if (!p) return false;
  (host.cut ??= []).push({y: cab.h, x0: r3(-def.w / 2 - 0.02), x1: r3(def.w / 2 + 0.02)});
  return true;
}
/** The airship model's kit row is still the lead's placeholder (no measured model): not shown yet. */
const destPlanned = (kind: PropKind): boolean => kind === 'skyDAirshipModel' && !!destDims('skyDAirshipModel').planned;

// --- design ------------------------------------------------------------------------------------------------------------------------

/** A room set's wall-backed anchor piece: the wall spots of the storey in a shuffled order. */
function wallAnchors(kit: AnchorKit, kind: PropKind, level: number, turn = 0): {a: Area; side: Side; x: number; z: number; rot: number}[] {
  const [ox, oz] = spotsFrom(kit, level, 'any')[0] ?? kit.inside(3);
  return kit.rng.shuffle(kit.wallSpots(kind, ox, oz, level, undefined, turn).filter((_, i) => i % 3 === 0)).slice(0, 50);
}
/**
 * The arc lamp's yaw beside a wall-backed piece of yaw `rot`: the model's long axis is X with its marble base at the +X end and the
 * shade hanging at -X (measured on the kit model), so the base stands by the wall and the arm reaches out over the floor.
 */
const lampYaw = (rot: number): number => normYaw(rot + Math.PI / 2);
/** The showroom bed's model runs along X with its headboard at the -X end (measured): this turn puts the head to the wall. */
export const BED_TURN = -Math.PI / 2;

/** The living set: the sofa backed to a wall, the egg chair across from one end, the arc lamp and a side table at its ends, a plant. */
function livingSet(kit: AnchorKit, level: number): boolean {
  const sofa = PROP_DEFS.skyDSofa, egg = PROP_DEFS.skyDEggChair, lamp = PROP_DEFS.skyDArcLamp, tb = PROP_DEFS.cafeBistroTable;
  for (const sp of wallAnchors(kit, 'skyDSofa', level)) {
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const s = kit.put('skyDSofa', sp.x, sp.z, sp.rot, {level, area: sp.a, front: 0.9});
      if (!s) return false;
      got.push(s);
      const side = kit.rng.chance(0.5) ? 1 : -1;
      // the lamp at one end, its arm reaching out from the wall over the seat's end
      const [lx, lz] = toWorld(s, side * (sofa.w / 2 + 0.06 + lamp.d / 2), -sofa.d / 2 + lamp.w / 2);
      const pl = kit.put('skyDArcLamp', lx, lz, lampYaw(s.rot), {level});
      if (pl) got.push(pl);
      const [tx, tz] = toWorld(s, -side * (sofa.w / 2 + 0.08 + tb.w / 2), 0);
      const pt = kit.putRound('cafeBistroTable', tx, tz, 0, {level});
      if (pt) got.push(pt);
      for (const dl of [sofa.w / 2 - 0.4, 0, -(sofa.w / 2 - 0.4)]) {
        const [ex, ez] = toWorld(s, -side * dl, sofa.d / 2 + 1.25 + egg.d / 2);
        const pe = kit.put('skyDEggChair', ex, ez, s.rot + Math.PI, {level});
        if (pe) { got.push(pe); break; }
      }
      const [px, pz] = toWorld(s, -side * (sofa.w / 2 + 0.1 + tb.w + 0.3), -sofa.d / 2 + 0.3);
      const pp = kit.put('pottedPlantSmall', px, pz, 0, {level});
      if (pp) got.push(pp);
      return got.length >= 3;
    }, level);
    if (ok) { reserveAround(kit, got, level, 0.6); return true; }
  }
  return false;
}

/** The dining set: the live-edge table as an island with chairs pulled up round it (both long sides, now and then the ends). */
function diningSet(kit: AnchorKit, level: number): boolean {
  const tb = PROP_DEFS.skyDDiningTable, ch = PROP_DEFS.cafeChair, fr = kit.fr;
  for (const [x0, z0] of spotsFrom(kit, level, 'any').slice(0, 90)) {
    const rot = kit.rng.chance(0.5) ? fr.toFront : fr.plusU;
    const q = Math.abs(Math.sin(rot)) > 0.7, hx = (q ? tb.d : tb.w) / 2, hz = (q ? tb.w : tb.d) / 2;
    const x = snapEdge(x0, hx), z = snapEdge(z0, hz);
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const t = kit.put('skyDDiningTable', x, z, rot, {level});
      if (!t) return false;
      got.push(t);
      // the chairs just beyond the table's cells
      const halfD = Math.ceil((tb.d / 2 - 0.04) / CELL) * CELL, halfW = Math.ceil((tb.w / 2 - 0.04) / CELL) * CELL;
      const n = Math.max(2, Math.min(4, Math.floor((tb.w - 0.2) / 0.62)));
      for (const s of [-1, 1]) for (let k = 0; k < n; k++) {
        const lx = (k - (n - 1) / 2) * 0.66;
        const [cx, cz] = toWorld(t, lx, s * (halfD + ch.d / 2 + 0.02));
        const p = kit.put('cafeChair', cx, cz, s < 0 ? t.rot : t.rot + Math.PI, {level});
        if (p) got.push(p);
      }
      for (const s of [-1, 1]) {
        if (!kit.rng.chance(0.5)) continue;
        const [cx, cz] = toWorld(t, s * (halfW + ch.d / 2 + 0.02), 0);
        const p = kit.put('cafeChair', cx, cz, t.rot - s * Math.PI / 2, {level});
        if (p) got.push(p);
      }
      return got.length >= 5;
    }, level);
    if (ok) { reserveAround(kit, got, level, 0.6); return true; }
  }
  return false;
}

/** The bedroom set: the showroom bed's head to a wall, an arc lamp beside it, a sideboard dresser on the other side, a plant. */
function bedroomSet(kit: AnchorKit, level: number): boolean {
  const bed = PROP_DEFS.skyDShowroomBed, lamp = PROP_DEFS.skyDArcLamp, cab = PROP_DEFS.cabinetLow;
  for (const sp of wallAnchors(kit, 'skyDShowroomBed', level, BED_TURN)) {
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const b = kit.put('skyDShowroomBed', sp.x, sp.z, sp.rot, {level, area: sp.a});
      if (!b) return false;
      got.push(b);
      // in the bed's own frame the wall is at -X (its headboard) and its long sides face +/-Z
      const wallRot = normYaw(b.rot - BED_TURN); // the yaw of a piece backed to the same wall
      const side = kit.rng.chance(0.5) ? 1 : -1;
      const [lx, lz] = toWorld(b, -bed.w / 2 + lamp.w / 2, side * (bed.d / 2 + 0.08 + lamp.d / 2));
      const pl = kit.put('skyDArcLamp', lx, lz, lampYaw(wallRot), {level});
      if (pl) got.push(pl);
      const [cx, cz] = toWorld(b, -bed.w / 2 + cab.d / 2, -side * (bed.d / 2 + 0.25 + cab.w / 2));
      const pc = kit.put('cabinetLow', cx, cz, wallRot, {level, front: 0.7});
      if (pc) got.push(pc);
      if (!pc) {
        const [px, pz] = toWorld(b, -bed.w / 2 + 0.3, -side * (bed.d / 2 + 0.4));
        const pp = kit.put('pottedPlantSmall', px, pz, 0, {level});
        if (pp) got.push(pp);
      }
      return got.length >= 2;
    }, level);
    if (ok) { reserveAround(kit, got, level, 0.6); return true; }
  }
  return false;
}

/** A reading corner vignette: the egg chair backed to a wall, the arc lamp beside it reaching over it, a side table on its other side. */
function readingCorner(kit: AnchorKit, level: number): boolean {
  const egg = PROP_DEFS.skyDEggChair, lamp = PROP_DEFS.skyDArcLamp, tb = PROP_DEFS.cafeBistroTable;
  for (const sp of wallAnchors(kit, 'skyDEggChair', level).slice(0, 30)) {
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const e = kit.put('skyDEggChair', sp.x, sp.z, sp.rot, {level, area: sp.a, front: 0.8});
      if (!e) return false;
      got.push(e);
      const side = kit.rng.chance(0.5) ? 1 : -1;
      const [lx, lz] = toWorld(e, side * (egg.w / 2 + 0.06 + lamp.d / 2), -egg.d / 2 + lamp.w / 2);
      const pl = kit.put('skyDArcLamp', lx, lz, lampYaw(e.rot), {level});
      if (pl) got.push(pl);
      const [tx, tz] = toWorld(e, -side * (egg.w / 2 + 0.1 + tb.w / 2), 0);
      const pt = kit.putRound('cafeBistroTable', tx, tz, 0, {level});
      if (pt) got.push(pt);
      return got.length >= 2;
    }, level);
    if (ok) { reserveAround(kit, got, level, 0.6); return true; }
  }
  return false;
}

