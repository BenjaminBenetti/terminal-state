// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's BLOCK PLANS — what stands on each of the 64 blocks,
// planned in cells before anything is carved (pure data; every draw from forks of the district seed).
//
//  - Special blocks: the PORTAL block (a core block on an avenue: a corner plaza = the military checkpoint compound, the host's portal —
//    the subway entrance headhouse / the host office tower / the host mall), the RAIL DEPOT block (a core-edge block: the train shed, an
//    approach yard and a loading yard, a rail spur entering from the cordon through the outer ring).
//  - Core destination BRIEFS (guaranteed: >= 2 small shopping centres, >= 3 offices, >= 8 stores of >= 6 distinct programmes, 0-2 civic)
//    spread over the core blocks, then every block is cut into ROWS (one through-row, two back-to-back rows, or two rows on a service
//    alley) and each row into PARCELS (brief items first, then fillers: closed shells, gangways, vacant lots, forecourts, pocket plazas).
//  - The outer ring is SPARSE: closed shells, ruins (collapsed / gutted), vacant lots, parking, parks, rubble fields — its streets stay.
//  - Heights: storey = floor-to-floor (shop ground floors 4.3-5.0 m, upper storeys 3.0-4.3 m); walkable floors (<= 3 layout levels).

import type {Rng} from '../../core/rng';
import type {Side} from '../stationTypes';
import type {SurfaceBuildingKind, SurfaceCondition} from './surfaceTypes';
import type {SurfaceHost} from './surfaceRun';
import type {SurfaceFacadeId} from './facades';
import {BLOCKS, CORE_FROM, CORE_TO, blockAt, crH, crW, type CR, type CityFrame, type FrameBlock} from './cityFrame';
import {programmeName} from './cityNames';

export type LotUse = 'plaza' | 'park' | 'parking' | 'yard' | 'loading' | 'vacant' | 'rubble' | 'compound' | 'forecourt' | 'gangway' | 'alley' | 'rail' | 'court';

export interface LotPlan {
  id: number;
  block: number;
  r: CR;
  use: LotUse;
  /** Ground height (m): 0 = at road grade (asphalt lots, alleys, yards), KERB = raised like the sidewalks. */
  grade: number;
  /** Sides of the lot that get a kerb cut (driveway) through the sidewalk to the carriageway. */
  driveways: Side[];
  /** A plaza / park laid out on the diagonal (LOOK: paving / paths / trees on the diagonal). */
  diagonal?: boolean;
  label: string;
}

export interface BuildingPlan {
  id: number;
  block: number;
  /** Footprint (cells): the outer wall ring included. */
  r: CR;
  kind: SurfaceBuildingKind;
  programme: string;
  name: string;
  /** Floor-to-floor heights of the drawn storeys (m). */
  storeys: number[];
  /** Walkable storeys (0 = a closed shell / ruin; <= SURFACE_LEVELS). */
  walk: number;
  parapet: number;
  facade: SurfaceFacadeId;
  condition: SurfaceCondition;
  destination: boolean;
  /** The main street side (shopfront / lobby). */
  frontage: Side;
  /** The host's own building (the portal), the checkpoint's command tent or the subway headhouse. */
  host?: SurfaceHost | 'tent' | 'headhouse';
}

/** Kerb / sidewalk height above the carriageway (m). */
export const KERB = 0.15;
/** Floor slab between storeys (m). */
export const SLAB = 0.35;
/** Walkable layout levels of a district (street + two upper storeys). */
export const SURFACE_LEVELS = 3;

export const STORE_PROGRAMMES = ['grocery', 'pharmacy', 'hardware', 'clothing', 'electronics', 'convenience', 'liquor', 'sporting-goods', 'bookstore', 'cafe', 'diner'] as const;
export const CENTRE_PROGRAMMES = ['strip-centre', 'arcade'] as const;
export const CIVIC_PROGRAMMES = ['police', 'fire-station', 'clinic'] as const;

/** Core guarantees (tests check them over many seeds). */
export const GUARANTEE = {depot: 1, centres: 2, offices: 3, stores: 8, storeKinds: 6} as const;

export interface Item {
  programme: string;
  kind: SurfaceBuildingKind;
  /** Frontage range along the row (cells) and least depth (cells). */
  w: readonly [number, number];
  d: number;
  corner: boolean;
}

const STORE_W: Record<string, readonly [number, number]> = {grocery: [34, 48], hardware: [28, 42], 'sporting-goods': [26, 38], clothing: [22, 34], electronics: [22, 32],
  pharmacy: [22, 32], convenience: [18, 26], liquor: [18, 26], bookstore: [20, 30], cafe: [18, 26], diner: [20, 30]};
export const storeItem = (p: string): Item => ({programme: p, kind: 'store', w: STORE_W[p] ?? [20, 30], d: 26, corner: p === 'diner' || p === 'convenience' || p === 'pharmacy'});
export const centreItem = (p: string): Item => ({programme: p, kind: 'centre', w: p === 'arcade' ? [58, 76] : [62, 84], d: 42, corner: false});
export const officeItem = (): Item => ({programme: 'office-block', kind: 'office', w: [36, 54], d: 32, corner: true});
export const civicItem = (p: string): Item => ({programme: p, kind: 'civic', w: p === 'police' ? [40, 54] : p === 'fire-station' ? [36, 48] : [32, 44], d: 32, corner: p === 'police'});

export interface BlockPlans {
  portal: number;
  /** The plaza corner of the portal block. */
  plazaCorner: 'NW' | 'NE' | 'SW' | 'SE';
  plaza: CR;
  depot: number;
  /** The depot spur's outward direction, the track's across-axis centre (cells), the corridor half width (cells), the blocks it crosses. */
  spur: {dir: Side; v: number; half: number; blocks: number[]};
  lots: LotPlan[];
  buildings: BuildingPlan[];
  /** Brief items that found no room (the repair pass in index.ts converts closed shells for them). */
  unplaced: Item[];
}

const weighted = <T>(rng: Rng, items: readonly (readonly [T, number])[]): T => rng.weighted(items);
const r1 = (rng: Rng, a: number, b: number) => Math.round(rng.range(a, b) * 10) / 10;

/**
 * Programme -> heights / facade / walkable storeys. Drawn storeys 1-6 (the Office host's own tower is the one taller building), upper
 * storeys 3.5-4.0 m floor to floor, shop / centre ground floors 4.3-5.0 m, other ground floors 3.6-4.6 m.
 */
export function buildingShape(rng: Rng, kind: SurfaceBuildingKind, programme: string, outer: boolean): {storeys: number[]; walk: number; parapet: number; facade: SurfaceFacadeId} {
  const ups = (n: number, a: number, b: number) => Array.from({length: n}, () => r1(rng, a, b));
  switch (kind) {
    case 'store': {
      if (programme === 'shop-shell') {
        const n = rng.int(1, 3);
        return {storeys: [r1(rng, 4.3, 4.8), ...ups(n - 1, 3.5, 3.8)], walk: 0, parapet: r1(rng, 0.6, 1.0), facade: rng.pick(['brick-retail', 'stucco'] as const)};
      }
      const n = programme === 'grocery' ? weighted(rng, [[1, 0.6], [2, 0.4]] as const) : weighted(rng, [[1, 0.3], [2, 0.42], [3, 0.28]] as const);
      const walk = n >= 2 && rng.chance(0.28) ? 2 : 1;
      return {storeys: [r1(rng, 4.3, 4.9), ...ups(n - 1, 3.5, 3.8)], walk, parapet: r1(rng, 0.6, 1.1), facade: rng.pick(['brick-retail', 'brick-retail', 'stucco'] as const)};
    }
    case 'centre': {
      const n = rng.chance(0.6) ? 2 : 1;
      return {storeys: [5.0, ...ups(n - 1, 3.8, 4.0)], walk: n, parapet: r1(rng, 0.9, 1.4), facade: programme === 'arcade' ? rng.pick(['precast-centre', 'stucco'] as const) : 'precast-centre'};
    }
    case 'office': {
      if (programme === 'office-shell') {
        const n = rng.int(outer ? 3 : 4, 6);
        return {storeys: [4.5, ...ups(n - 1, 3.6, 3.9)], walk: 0, parapet: r1(rng, 0.8, 1.4), facade: rng.pick(['concrete-office', 'glass-office'] as const)};
      }
      const n = weighted(rng, [[3, 0.25], [4, 0.3], [5, 0.25], [6, 0.2]] as const);
      return {storeys: [4.6, ...ups(n - 1, 3.7, 3.9)], walk: Math.min(SURFACE_LEVELS, n), parapet: r1(rng, 0.8, 1.4), facade: rng.pick(['concrete-office', 'glass-office'] as const)};
    }
    case 'depot':
      // the shed floor (a tall ground storey: the interior planner may open the shed to the roof) and the office / stores storey above
      return {storeys: [5.0, r1(rng, 3.8, 4.0)], walk: 2, parapet: 0.6, facade: 'industrial-shed'};
    case 'civic': {
      const n = rng.chance(0.55) ? 2 : 3;
      return {storeys: [4.6, ...ups(n - 1, 3.8, 4.0)], walk: Math.min(2, n), parapet: r1(rng, 1.0, 1.6), facade: 'civic-stone'};
    }
    case 'industrial':
      return {storeys: rng.chance(0.5) ? [r1(rng, 4.6, 5.0)] : [r1(rng, 4.4, 4.8), r1(rng, 3.8, 4.0)], walk: 0, parapet: 0.5, facade: 'industrial-shed'};
    case 'parking':
      return {storeys: ups(rng.int(3, 5), 3.5, 3.6), walk: 0, parapet: 1.1, facade: 'industrial-shed'};
    default: {
      const n = outer ? rng.int(2, 5) : rng.int(3, 6);
      return {storeys: [r1(rng, 3.6, 4.0), ...ups(n - 1, 3.5, 3.7)], walk: 0, parapet: r1(rng, 0.6, 1.0), facade: rng.pick(['brick-residential', 'brick-residential', 'stucco', 'brick-retail'] as const)};
    }
  }
}

type Filler = {kind: SurfaceBuildingKind | 'vacant' | 'parking-lot' | 'gangway' | 'plaza'; programme: string};

/** A closed filler for a parcel (core: mostly standing shells; outer ring: sparse). */
function fillerKind(rng: Rng, outer: boolean): Filler {
  const t = outer
    ? weighted(rng, [['residential', 0.3], ['shop-shell', 0.12], ['office-shell', 0.08], ['industrial', 0.12], ['parking', 0.04], ['vacant', 0.2], ['parking-lot', 0.1], ['gangway', 0.04]] as const)
    : weighted(rng, [['residential', 0.34], ['shop-shell', 0.26], ['office-shell', 0.18], ['parking', 0.04], ['vacant', 0.05], ['gangway', 0.13]] as const);
  if (t === 'vacant' || t === 'parking-lot' || t === 'gangway') return {kind: t, programme: t};
  if (t === 'shop-shell' || t === 'office-shell') return {kind: t === 'office-shell' ? 'office' : 'store', programme: t};
  return {kind: t, programme: t === 'residential' ? 'apartments' : t === 'industrial' ? 'warehouse' : 'parking-garage'};
}

function conditionOf(rng: Rng, dest: boolean, outer: boolean): SurfaceCondition {
  if (dest) return rng.chance(0.7) ? 'intact' : 'damaged';
  return outer
    ? weighted(rng, [['intact', 0.34], ['damaged', 0.3], ['gutted', 0.16], ['collapsed', 0.2]] as const)
    : weighted(rng, [['intact', 0.55], ['damaged', 0.25], ['gutted', 0.1], ['collapsed', 0.1]] as const);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Rows and parcels

/** A row of parcels along an axis: `r` its rect, `front` the street side it faces, `back` what is behind it. */
interface Row { r: CR; front: Side; back: 'street' | 'alley' | 'party' }

interface Ctx {
  rng: Rng;
  f: CityFrame;
  lots: LotPlan[];
  buildings: BuildingPlan[];
  names: Set<string>;
  districtRoot: string;
}

const lenAlong = (r: CR, axis: 'x' | 'z') => (axis === 'x' ? crW(r) : crH(r));

function addLot(c: Ctx, block: number, r: CR, use: LotUse, grade: number, label: string, driveways: Side[] = [], diagonal = false): LotPlan {
  const l: LotPlan = {id: c.lots.length, block, r, use, grade, driveways, label, ...(diagonal ? {diagonal} : {})};
  c.lots.push(l);
  return l;
}

/** Adds a building; `over` fixes fields (the host's buildings, collapsed ruins). */
export function addBuildingPlan(c: {rng: Rng; buildings: BuildingPlan[]; names: Set<string>; districtRoot: string}, b: FrameBlock, r: CR, kind: SurfaceBuildingKind, programme: string,
  dest: boolean, frontage: Side, over: Partial<BuildingPlan> = {}): BuildingPlan {
  const rng = c.rng.fork(`bplan-${c.buildings.length}`);
  const s = buildingShape(rng, kind, programme, !b.core);
  const condition = over.condition ?? conditionOf(rng, dest, !b.core);
  const name = dest ? programmeName(rng, programme, b.lines[frontage].name, c.districtRoot, c.names) : '';
  const p: BuildingPlan = {
    id: c.buildings.length, block: b.id, r, kind, programme, name, storeys: s.storeys, walk: dest ? s.walk : 0, parapet: s.parapet, facade: s.facade,
    condition, destination: dest, frontage, ...over,
  };
  if (p.condition === 'collapsed') { p.kind = 'ruin'; p.walk = 0; p.destination = false; }
  c.buildings.push(p);
  return p;
}

/** Splits a lot into rows (alley / back-to-back / through). `deep`: one row must be at least this deep (a centre's brief). */
function rowsOf(rng: Rng, b: FrameBlock, lot: CR, axis: 'x' | 'z', opts: {alley: number; minRow: number; deep: number}): {rows: Row[]; alley: CR | null} {
  const D = axis === 'x' ? crH(lot) : crW(lot);
  const [sLo, sHi]: [Side, Side] = axis === 'x' ? ['N', 'S'] : ['W', 'E'];
  const cut = (d0: number, d1: number): CR => (axis === 'x' ? {x0: lot.x0, x1: lot.x1, y0: lot.y0 + d0, y1: lot.y0 + d1} : {x0: lot.x0 + d0, x1: lot.x0 + d1, y0: lot.y0, y1: lot.y1});
  const minRow = opts.minRow, deep = Math.max(minRow, opts.deep);
  if (D >= minRow + deep + 10 && opts.alley > 0 && rng.chance(opts.alley)) {
    const wa = rng.int(10, 14);
    let d0 = Math.floor((D - wa) / 2) + rng.int(-4, 4);
    if (deep > minRow) d0 = Math.max(minRow, Math.min(d0, D - wa - deep));
    return {rows: [{r: cut(0, d0), front: sLo, back: 'alley'}, {r: cut(d0 + wa, D), front: sHi, back: 'alley'}], alley: cut(d0, d0 + wa)};
  }
  if (D >= minRow + deep) {
    let d0 = Math.round(D * rng.range(0.42, 0.58));
    if (deep > minRow) d0 = D - deep >= deep && rng.chance(0.5) ? deep : Math.max(minRow, Math.min(d0, D - deep));
    return {rows: [{r: cut(0, d0), front: sLo, back: 'party'}, {r: cut(d0, D), front: sHi, back: 'party'}], alley: null};
  }
  // one through-row: faces the better street (an avenue, else the low side)
  const front = b.lines[sHi].rank === 'avenue' && b.lines[sLo].rank !== 'avenue' ? sHi : sLo;
  return {rows: [{r: cut(0, D), front, back: 'street'}], alley: null};
}

/** The row's sub-rect for [s0, s1) along `axis` (the full row depth). */
const slice = (r: CR, axis: 'x' | 'z', s0: number, s1: number): CR => (axis === 'x' ? {x0: r.x0 + s0, x1: r.x0 + s1, y0: r.y0, y1: r.y1} : {x0: r.x0, x1: r.x1, y0: r.y0 + s0, y1: r.y0 + s1});

type Slot = {item: Item | null; w: number; filler?: Filler};

/** Fills one row with the given items (an item that does not fit goes back to `rest`) and fillers. */
function fillRow(c: Ctx, b: FrameBlock, row: Row, axis: 'x' | 'z', items: Item[], rest: Item[]): void {
  const rng = c.rng.fork(`row-${b.id}-${row.front}-${row.r.x0}-${row.r.y0}`);
  const L = lenAlong(row.r, axis), D = axis === 'x' ? crH(row.r) : crW(row.r);
  const fit = items.filter(it => it.d <= D);
  for (const it of items) if (it.d > D) rest.push(it);
  const corners = fit.filter(it => it.corner), mids = fit.filter(it => !it.corner);
  const seq: Item[] = [];
  if (corners.length) seq.push(corners.shift()!);
  seq.push(...mids, ...corners);
  let slots: Slot[] = seq.map(it => ({item: it, w: rng.int(it.w[0], it.w[1])}));
  let used = slots.reduce((s, x) => s + x.w, 0);
  while (used > L && slots.length) {
    const k = slots.length - 1;
    rest.push(slots[k].item!);
    used -= slots[k].w;
    slots = slots.slice(0, k);
  }
  let remaining = L - used;
  const outer = !b.core;
  const fill: Slot[] = [];
  while (remaining >= 14) {
    // filler parcels 13-23 m in the core (2-6 buildings a block), 11-24 m outside
    let w = Math.min(remaining, rng.int(outer ? 22 : 26, outer ? 48 : 46));
    if (remaining - w < 16) w = remaining;
    const fk = fillerKind(rng, outer);
    fill.push({item: null, w, filler: w < 14 && fk.kind !== 'gangway' ? {kind: 'gangway', programme: 'gangway'} : fk});
    remaining -= w;
  }
  if (remaining > 0) {
    if (slots.length) slots[slots.length - 1].w += remaining;
    else if (fill.length) fill[fill.length - 1].w += remaining;
    else fill.push({item: null, w: remaining, filler: {kind: 'gangway', programme: 'gangway'}});
  }
  const out: Slot[] = [...slots];
  for (const s of fill) {
    const lo = out.length && out[0].item?.corner ? 1 : 0;
    const hi = out.length > 1 && out[out.length - 1].item?.corner ? out.length - 1 : out.length;
    out.splice(rng.int(lo, Math.max(lo, hi)), 0, s);
  }
  // a core row now and then opens a corner POCKET PLAZA (diagonal paving) in place of a corner filler
  if (!outer && out.length > 1 && rng.chance(0.2)) {
    const k = rng.chance(0.5) ? 0 : out.length - 1;
    if (!out[k].item && out[k].w >= 18) out[k].filler = {kind: 'plaza', programme: 'plaza'};
  }
  let s0 = 0;
  for (const sl of out) {
    const r = slice(row.r, axis, s0, s0 + sl.w);
    s0 += sl.w;
    if (sl.item) { emitBuilding(c, b, row, axis, r, sl.item.kind, sl.item.programme, true, rng); continue; }
    const fk = sl.filler!;
    if (fk.kind === 'gangway') addLot(c, b.id, r, 'gangway', KERB, 'Passage');
    else if (fk.kind === 'plaza') addLot(c, b.id, r, 'plaza', KERB, 'Pocket plaza', [], true);
    else if (fk.kind === 'vacant') addLot(c, b.id, r, outer && rng.chance(0.35) ? 'rubble' : 'vacant', KERB, outer ? 'Vacant lot' : 'Empty lot');
    else if (fk.kind === 'parking-lot') addLot(c, b.id, r, 'parking', 0, 'Parking lot', [row.front]);
    else emitBuilding(c, b, row, axis, r, fk.kind, fk.programme, false, rng);
  }
}

/** A parcel's building, with a front forecourt / rear service yard where its programme has one. */
function emitBuilding(c: Ctx, b: FrameBlock, row: Row, axis: 'x' | 'z', r: CR, kind: SurfaceBuildingKind, programme: string, dest: boolean, rng: Rng): void {
  const D = axis === 'x' ? crH(r) : crW(r);
  let front = 0, frontUse: LotUse = 'forecourt', frontGrade = KERB;
  if (programme === 'strip-centre' && D >= 42 + 22) { front = Math.min(D - 42, rng.int(22, 30)); frontUse = 'parking'; frontGrade = 0; }
  else if ((kind === 'office' || kind === 'civic') && dest && D >= 40 && rng.chance(kind === 'civic' ? 0.6 : 0.3)) front = rng.int(4, Math.min(10, D - 32));
  let back = 0;
  if (row.back === 'alley' && D - front >= 34 && rng.chance(0.3)) back = rng.int(6, Math.min(12, D - front - 28));
  // depth measured from the row's FRONT side
  const cutD = (d0: number, d1: number): CR => {
    if (axis === 'x') return row.front === 'N' ? {x0: r.x0, x1: r.x1, y0: r.y0 + d0, y1: r.y0 + d1} : {x0: r.x0, x1: r.x1, y0: r.y1 - d1, y1: r.y1 - d0};
    return row.front === 'W' ? {x0: r.x0 + d0, x1: r.x0 + d1, y0: r.y0, y1: r.y1} : {x0: r.x1 - d1, x1: r.x1 - d0, y0: r.y0, y1: r.y1};
  };
  if (front > 0) addLot(c, b.id, cutD(0, front), frontUse, frontGrade, frontUse === 'parking' ? 'Customer parking' : 'Forecourt', frontUse === 'parking' ? [row.front] : []);
  if (back > 0) addLot(c, b.id, cutD(D - back, D), 'court', 0, 'Service yard');
  addBuildingPlan(c, b, cutD(front, D - back), kind, programme, dest, row.front);
}

/** Plans one ordinary block (core with its brief, or a sparse outer block). */
function planOrdinary(c: Ctx, b: FrameBlock, brief: Item[], rest: Item[]): void {
  const rng = c.rng.fork(`block-${b.id}`);
  const lot = b.lot;
  const axis: 'x' | 'z' = crW(lot) >= crH(lot) ? 'x' : 'z';
  if (!b.core && !brief.length) {
    const u = weighted(rng, [['rows', 0.72], ['parking', 0.1], ['park', 0.08], ['rubble', 0.1]] as const);
    if (u === 'parking') { addLot(c, b.id, lot, 'parking', 0, 'Parking lot', [rng.pick(['N', 'S', 'E', 'W'] as const)]); return; }
    if (u === 'park') { addLot(c, b.id, lot, 'park', KERB, 'Park', [], rng.chance(0.5)); return; }
    if (u === 'rubble') { rubbleField(c, b, lot, rng); return; }
  }
  const deep = Math.max(0, ...brief.map(it => it.d));
  const {rows, alley} = rowsOf(rng, b, lot, axis, {alley: b.core ? 0.42 : 0.28, minRow: 26, deep});
  if (alley) addLot(c, b.id, alley, 'alley', 0, 'Service lane', axis === 'x' ? ['W', 'E'] : ['N', 'S']);
  const D = (r: Row) => (axis === 'x' ? crH(r.r) : crW(r.r));
  const byRow: Item[][] = rows.map(() => []);
  // big items first, each to the deepest row that takes it (an avenue row preferred for offices / centres)
  const order = [...brief].sort((p, q) => q.d * 100 + q.w[0] - (p.d * 100 + p.w[0]));
  for (const it of order) {
    const room = (k: number) => lenAlong(rows[k].r, axis) - byRow[k].reduce((s, x) => s + x.w[0], 0) - it.w[0];
    let best = -1, score = -Infinity;
    rows.forEach((row, k) => {
      if (D(row) < it.d) return;
      const sc = room(k) + (b.lines[row.front].rank === 'avenue' && (it.kind === 'office' || it.kind === 'centre') ? 40 : 0) + rng.next() * 6;
      if (room(k) >= 0 && sc > score) { score = sc; best = k; }
    });
    if (best < 0) best = rows.reduce((m, row, k) => (D(row) >= it.d && (m < 0 || room(k) > room(m)) ? k : m), -1);
    if (best < 0) { rest.push(it); continue; }
    byRow[best].push(it);
  }
  rows.forEach((row, k) => fillRow(c, b, row, axis, byRow[k], rest));
}

/** An outer-ring block of collapsed ruins over a debris field. */
function rubbleField(c: Ctx, b: FrameBlock, lot: CR, rng: Rng): void {
  addLot(c, b.id, lot, 'rubble', KERB, 'Collapsed block');
  const n = rng.int(2, 4);
  const taken: CR[] = [];
  for (let k = 0; k < n * 6 && taken.length < n; k++) {
    const w = rng.int(18, 34), h = rng.int(18, 34);
    if (w + 10 > crW(lot) || h + 10 > crH(lot)) continue;
    const x0 = rng.int(lot.x0 + 5, lot.x1 - 5 - w), y0 = rng.int(lot.y0 + 5, lot.y1 - 5 - h);
    const r: CR = {x0, y0, x1: x0 + w, y1: y0 + h};
    if (taken.some(t => r.x0 < t.x1 + 6 && t.x0 < r.x1 + 6 && r.y0 < t.y1 + 6 && t.y0 < r.y1 + 6)) continue;
    taken.push(r);
    addBuildingPlan(c, b, r, 'residential', 'apartments', false, 'N', {condition: 'collapsed'});
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The portal block (plaza / compound + the host's portal) and the depot block

function cornerRect(lot: CR, corner: 'NW' | 'NE' | 'SW' | 'SE', w: number, h: number): CR {
  const x0 = corner.endsWith('W') ? lot.x0 : lot.x1 - w, y0 = corner.startsWith('N') ? lot.y0 : lot.y1 - h;
  return {x0, y0, x1: x0 + w, y1: y0 + h};
}

function planPortal(c: Ctx, b: FrameBlock, host: SurfaceHost, corner: 'NW' | 'NE' | 'SW' | 'SE', brief: Item[], rest: Item[]): CR {
  const rng = c.rng.fork(`portal-${b.id}`);
  const lot = b.lot;
  const pw = Math.min(crW(lot) - 30, rng.int(54, 64)), pd = Math.min(crH(lot) - 30, rng.int(46, 56));
  const plaza = cornerRect(lot, corner, pw, pd);
  const north = corner.startsWith('N'), west = corner.endsWith('W');
  addLot(c, b.id, plaza, 'compound', KERB, 'Military checkpoint');
  // rem1: beside the plaza (its z-range); rem2: the rest of the lot (full width), whose plaza-side edge faces the plaza
  const rem1: CR = west ? {x0: plaza.x1, x1: lot.x1, y0: plaza.y0, y1: plaza.y1} : {x0: lot.x0, x1: plaza.x0, y0: plaza.y0, y1: plaza.y1};
  const rem2: CR = north ? {x0: lot.x0, x1: lot.x1, y0: plaza.y1, y1: lot.y1} : {x0: lot.x0, x1: lot.x1, y0: lot.y0, y1: plaza.y0};
  const facePlaza: Side = north ? 'N' : 'S';
  const away: Side = north ? 'S' : 'N';
  const rowA: Row = {r: rem1, front: facePlaza, back: 'party'};
  if (host === 'mall') {
    addBuildingPlan(c, b, rem2, 'centre', 'host-mall', false, facePlaza, {host: 'mall', condition: 'damaged', storeys: [5.0, 5.0, 5.0], walk: 0, parapet: 1.6, facade: 'precast-centre'});
    fillRow(c, b, rowA, 'x', brief, rest);
    return plaza;
  }
  if (host === 'office') {
    const tw = Math.min(crW(rem2) - 24, Math.max(pw, rng.int(56, 66))), td = Math.min(crH(rem2), rng.int(50, 60));
    const tx0 = west ? lot.x0 : lot.x1 - tw;
    const ty0 = north ? rem2.y0 : rem2.y1 - td;
    const tower: CR = {x0: tx0, x1: tx0 + tw, y0: ty0, y1: ty0 + td};
    addBuildingPlan(c, b, tower, 'office', 'host-tower', false, facePlaza, {host: 'office', condition: 'damaged', storeys: [5.0, ...Array.from({length: 11}, () => 3.8)], walk: 0,
      parapet: 1.4, facade: 'glass-office'});
    if (td < crH(rem2)) {
      addLot(c, b.id, north ? {x0: tower.x0, x1: tower.x1, y0: tower.y1, y1: rem2.y1} : {x0: tower.x0, x1: tower.x1, y0: rem2.y0, y1: tower.y0}, 'court', 0, 'Loading yard', [away]);
    }
    const side: CR = west ? {x0: tower.x1, x1: rem2.x1, y0: rem2.y0, y1: rem2.y1} : {x0: rem2.x0, x1: tower.x0, y0: rem2.y0, y1: rem2.y1};
    fillRow(c, b, {r: side, front: away, back: 'party'}, 'x', [], rest);
    fillRow(c, b, rowA, 'x', brief, rest);
    return plaza;
  }
  // subway: the headhouse stands in the plaza (gen/surface/checkpoint.ts); rem1 and rem2 are ordinary rows
  fillRow(c, b, rowA, 'x', brief.slice(0, 1), rest);
  fillRow(c, b, {r: rem2, front: away, back: 'street'}, 'x', brief.slice(1), rest);
  return plaza;
}

function planDepot(c: Ctx, b: FrameBlock, dir: Side): number {
  const rng = c.rng.fork(`depot-${b.id}`);
  const lot = b.lot;
  // u = into the block from the spur side; v = across
  const uAxis: 'x' | 'z' = dir === 'W' || dir === 'E' ? 'x' : 'z';
  const Lu = uAxis === 'x' ? crW(lot) : crH(lot), Lv = uAxis === 'x' ? crH(lot) : crW(lot);
  const Ls = Math.min(Lu - 30, rng.int(58, 72)), Ws = Math.min(Lv - 26, rng.int(44, 54));
  const shedLow = rng.chance(0.5);
  const fromSpur = dir === 'W' || dir === 'N';
  const toRect = (u0: number, u1: number, v0: number, v1: number): CR => {
    const a0 = fromSpur ? u0 : Lu - u1, a1 = fromSpur ? u1 : Lu - u0;
    return uAxis === 'x' ? {x0: lot.x0 + a0, x1: lot.x0 + a1, y0: lot.y0 + v0, y1: lot.y0 + v1} : {x0: lot.x0 + v0, x1: lot.x0 + v1, y0: lot.y0 + a0, y1: lot.y0 + a1};
  };
  const sv0 = shedLow ? 0 : Lv - Ws, sv1 = sv0 + Ws;
  const shed = toRect(Lu - Ls, Lu, sv0, sv1);
  const yard = toRect(0, Lu - Ls, 0, Lv);
  const load = shedLow ? toRect(Lu - Ls, Lu, sv1, Lv) : toRect(Lu - Ls, Lu, 0, sv0);
  const vSide: Side = uAxis === 'x' ? (shedLow ? 'S' : 'N') : (shedLow ? 'E' : 'W');
  const far: Side = dir === 'W' ? 'E' : dir === 'E' ? 'W' : dir === 'N' ? 'S' : 'N';
  addLot(c, b.id, yard, 'yard', 0, 'Rail yard', [vSide]);
  addLot(c, b.id, load, 'loading', 0, 'Loading yard', [vSide, far]);
  addBuildingPlan(c, b, shed, 'depot', 'rail-depot', true, dir, {condition: rng.chance(0.75) ? 'intact' : 'damaged'});
  return (uAxis === 'x' ? lot.y0 : lot.x0) + Math.round((sv0 + sv1) / 2);
}

/** An outer block the rail spur crosses: the corridor (at grade, fenced) across it, sparse lots either side. */
function planSpurBlock(c: Ctx, b: FrameBlock, dir: Side, v: number, half: number): void {
  const uAxis: 'x' | 'z' = dir === 'W' || dir === 'E' ? 'x' : 'z';
  const lot = b.lot;
  const corridor: CR = uAxis === 'x' ? {x0: lot.x0, x1: lot.x1, y0: v - half, y1: v + half} : {x0: v - half, x1: v + half, y0: lot.y0, y1: lot.y1};
  addLot(c, b.id, corridor, 'rail', 0, 'Rail spur', uAxis === 'x' ? ['W', 'E'] : ['N', 'S']);
  const parts: CR[] = uAxis === 'x'
    ? [{x0: lot.x0, x1: lot.x1, y0: lot.y0, y1: corridor.y0}, {x0: lot.x0, x1: lot.x1, y0: corridor.y1, y1: lot.y1}]
    : [{x0: lot.x0, x1: corridor.x0, y0: lot.y0, y1: lot.y1}, {x0: corridor.x1, x1: lot.x1, y0: lot.y0, y1: lot.y1}];
  parts.forEach((p, k) => {
    const D = uAxis === 'x' ? crH(p) : crW(p);
    if (D <= 0) return;
    if (D < 22) { addLot(c, b.id, p, 'vacant', KERB, 'Rail verge'); return; }
    const front: Side = uAxis === 'x' ? (k === 0 ? 'N' : 'S') : (k === 0 ? 'W' : 'E');
    fillRow(c, b, {r: p, front, back: 'street'}, uAxis, [], []);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Briefs and the plan

function storeSequence(rng: Rng, n: number): string[] {
  const all = rng.shuffle([...STORE_PROGRAMMES]);
  const out = all.slice(0, Math.min(n, all.length));
  const count = new Map<string, number>(out.map(p => [p, 1]));
  for (let guard = 0; out.length < n && guard < 200; guard++) {
    const p = rng.pick(STORE_PROGRAMMES);
    if ((count.get(p) ?? 0) >= 2) continue;
    count.set(p, (count.get(p) ?? 0) + 1);
    out.push(p);
  }
  return out;
}

export function planBlocks(rng: Rng, f: CityFrame, host: SurfaceHost, districtRoot: string): BlockPlans {
  const c: Ctx = {rng, f, lots: [], buildings: [], names: new Set(), districtRoot};
  const core = f.blocks.filter(b => b.core);
  // --- the portal block: a core block on an avenue; its plaza corner at the avenue (the avenues' crossing when it has both) -----
  const onAv = (b: FrameBlock) => (['N', 'S', 'W', 'E'] as const).filter(s => b.lines[s].rank === 'avenue');
  const P = rng.fork('portal-pick').pick(core.filter(b => onAv(b).length > 0));
  const av = onAv(P), prng = rng.fork('portal-corner');
  const ns = av.includes('N') ? 'N' : av.includes('S') ? 'S' : prng.pick(['N', 'S'] as const);
  const we = av.includes('W') ? 'W' : av.includes('E') ? 'E' : prng.pick(['W', 'E'] as const);
  const corner = `${ns}${we}` as 'NW' | 'NE' | 'SW' | 'SE';
  // --- the depot block: on the core edge, >= 2 blocks from the portal; the spur leaves outward --------------------------------
  const drng = rng.fork('depot-pick');
  const edge = core.filter(b => (b.col === CORE_FROM || b.col === CORE_TO || b.row === CORE_FROM || b.row === CORE_TO) && Math.max(Math.abs(b.col - P.col), Math.abs(b.row - P.row)) >= 2);
  const D = drng.pick(edge.length ? edge : core.filter(b => b !== P));
  const dirs: Side[] = [];
  if (D.col === CORE_FROM) dirs.push('W');
  if (D.col === CORE_TO) dirs.push('E');
  if (D.row === CORE_FROM) dirs.push('N');
  if (D.row === CORE_TO) dirs.push('S');
  const dir: Side = dirs.length ? drng.pick(dirs) : 'W';

  // --- destination briefs over the core blocks --------------------------------------------------------------------------------
  const brng = rng.fork('briefs');
  const briefs = new Map<number, Item[]>(core.map(b => [b.id, []]));
  const open = core.filter(b => b !== P && b !== D);
  const pickBlocks = (n: number, pool: FrameBlock[], prefer: (b: FrameBlock) => number): FrameBlock[] =>
    brng.shuffle([...pool]).map(b => ({b, s: prefer(b)})).sort((p, q) => q.s - p.s).slice(0, n).map(x => x.b);
  const centres = pickBlocks(2, open, () => brng.next());
  centres.forEach((b, k) => briefs.get(b.id)!.push(centreItem(k === 0 ? 'strip-centre' : brng.pick(CENTRE_PROGRAMMES))));
  const officeBlocks = pickBlocks(3, open.filter(b => !centres.includes(b)), b => (onAv(b).length ? 1 : 0) + brng.next() * 0.5);
  for (const b of officeBlocks) briefs.get(b.id)!.push(officeItem());
  const civicN = brng.weighted([[0, 0.2], [1, 0.5], [2, 0.3]] as const);
  const civicProgs = brng.shuffle([...CIVIC_PROGRAMMES]).slice(0, civicN);
  const civicBlocks = pickBlocks(civicN, open.filter(b => !centres.includes(b) && !officeBlocks.includes(b)), () => brng.next());
  civicBlocks.forEach((b, k) => briefs.get(b.id)!.push(civicItem(civicProgs[k])));
  const stores = storeSequence(brng, brng.int(10, 14));
  let si = 0;
  for (let round = 0; si < stores.length && round < 6; round++) {
    for (const b of brng.shuffle([P, ...open])) {
      if (si >= stores.length) break;
      const list = briefs.get(b.id)!;
      const cap = list.some(x => x.kind === 'centre') ? 2 : b === P ? 2 : 4;
      if (list.length < cap) list.push(storeItem(stores[si++]));
    }
  }

  // --- the rail spur's corridor: from the depot outward to the cordon ---------------------------------------------------------
  const spurBlocks: number[] = [];
  for (let k = 1; ; k++) {
    const col = D.col + (dir === 'W' ? -k : dir === 'E' ? k : 0), row = D.row + (dir === 'N' ? -k : dir === 'S' ? k : 0);
    if (col < 0 || row < 0 || col >= BLOCKS || row >= BLOCKS) break;
    spurBlocks.push(blockAt(f, col, row).id);
  }

  // --- the district PARK: one outer block (inner ring, beside the core) laid out on the diagonal ----------------------------------
  const ring = f.blocks.filter(b => !b.core && !spurBlocks.includes(b.id) && b.col >= CORE_FROM - 1 && b.col <= CORE_TO + 1 && b.row >= CORE_FROM - 1 && b.row <= CORE_TO + 1);
  const park = rng.fork('park-pick').pick(ring.length ? ring : f.blocks.filter(b => !b.core && !spurBlocks.includes(b.id)));

  // --- every block (the depot first: it fixes the track's line) ----------------------------------------------------------------
  const rest: Item[] = [];
  const half = 8;
  const track = planDepot(c, D, dir);
  const plaza = planPortal(c, P, host, corner, briefs.get(P.id)!, rest);
  for (const b of f.blocks) {
    if (b === D || b === P) continue;
    if (spurBlocks.includes(b.id)) planSpurBlock(c, b, dir, track, half);
    else if (b === park) addLot(c, b.id, b.lot, 'park', KERB, 'Park', [], true);
    else planOrdinary(c, b, briefs.get(b.id) ?? [], rest);
  }
  return {portal: P.id, plazaCorner: corner, plaza, depot: D.id, spur: {dir, v: track, half, blocks: spurBlocks}, lots: c.lots, buildings: c.buildings, unplaced: rest};
}

/** The core guarantee counts of a plan (QA / the repair pass). */
export function guaranteeCounts(bs: readonly {destination: boolean; kind: SurfaceBuildingKind; programme: string}[]) {
  const d = bs.filter(b => b.destination);
  const stores = d.filter(b => b.kind === 'store');
  return {depot: d.filter(b => b.kind === 'depot').length, centres: d.filter(b => b.kind === 'centre').length, offices: d.filter(b => b.kind === 'office').length,
    stores: stores.length, storeKinds: new Set(stores.map(b => b.programme)).size, civic: d.filter(b => b.kind === 'civic').length};
}

/**
 * Repair pass: a brief item that found no room becomes a closed core shell of a fitting size (largest first). Pure re-labelling of
 * an existing footprint (no geometry moves); its name / shape are drawn on the shell's own fork.
 */
export function repairGuarantees(rng: Rng, f: CityFrame, plans: BlockPlans, districtRoot: string): void {
  const names = new Set(plans.buildings.filter(b => b.name).map(b => b.name));
  const need: Item[] = [...plans.unplaced];
  const cnt = guaranteeCounts(plans.buildings);
  for (let k = cnt.centres; k < GUARANTEE.centres; k++) if (!need.some(it => it.kind === 'centre')) need.push(centreItem('strip-centre'));
  for (let k = cnt.offices; k < GUARANTEE.offices; k++) need.push(officeItem());
  const have = new Set(plans.buildings.filter(b => b.destination && b.kind === 'store').map(b => b.programme));
  for (const p of STORE_PROGRAMMES) if (have.size + need.filter(it => it.kind === 'store').length < GUARANTEE.storeKinds && !have.has(p) && !need.some(it => it.programme === p)) need.push(storeItem(p));
  while (cnt.stores + need.filter(it => it.kind === 'store').length < GUARANTEE.stores) need.push(storeItem(rng.pick(STORE_PROGRAMMES)));
  need.sort((p, q) => q.w[0] * q.d - p.w[0] * p.d);
  for (const it of need) {
    const fits = plans.buildings.filter(b => !b.destination && !b.host && b.walk === 0 && b.condition !== 'collapsed' && f.blocks[b.block].core && b.block !== plans.portal
      && Math.min(crW(b.r), crH(b.r)) >= Math.min(it.d, 26) && Math.max(crW(b.r), crH(b.r)) >= it.w[0] * 0.85);
    if (!fits.length) continue;
    const b = fits.sort((p, q) => crW(q.r) * crH(q.r) - crW(p.r) * crH(p.r))[0];
    const r = rng.fork(`repair-${b.id}`);
    const s = buildingShape(r, it.kind, it.programme, false);
    Object.assign(b, {kind: it.kind, programme: it.programme, destination: true, walk: s.walk, storeys: s.storeys, facade: s.facade, parapet: s.parapet,
      condition: r.chance(0.7) ? 'intact' : 'damaged', name: programmeName(r, it.programme, f.blocks[b.block].lines[b.frontage].name, districtRoot, names)});
  }
  plans.unplaced = [];
}
