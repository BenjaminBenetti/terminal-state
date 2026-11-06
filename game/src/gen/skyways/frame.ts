// Task studio-skyways-level-20261106-054448-01 (primary): the seeded CITY FRAME of a Skyways level — which blocks hold buildings,
// their footprints, the streets between them, the bridge graph (a spanning tree + extra edges: branches and loops), the station
// building, the host of the ONE add-on and the add-on itself (equal weights: convention / prize car). Pure data, canvas cells (0.5 m).
//
// The frame is drawn from the level seed only (rng streams of their own): the carve (gen/skyways/carve.ts) never re-rolls it, a retry
// re-rolls only the free parameters (`salt`), and the add-on choice never depends on anything carved.
//
// Layout-variety pass (task studio-skyways-layout-variety-20261106-054448-01): the frame now varies the STRUCTURE, not only sizes —
//  - the FAMILY (shape stream): a compact block grid (2x2 / 3x2 / 2x3), a 3x3 cluster with 3-4 empty lots (L / T / S / U networks) or
//    a 4x2 chain with 2-3 empty lots (a linear spine with branches); rows / columns staggered, some buildings set back behind a plaza,
//    street widths from lanes to boulevards;
//  - the TOPOLOGY: a tree (branches and dead ends) or loops; per bridge a lateral preference (centred / toward either
//    end of the shared span) and an occasional WIDE gallery bridge;
//  - per building a floor-PLAN family (court / galleria / offset / cross: skywaysTypes SkywaysPlan) chosen to suit its bridges;
//  - vertical links: the station transit well's edge / position / lane make-up, 0-2 underground PEDWAYS (to the station row's
//    neighbours and under the street to the building north of the station);
//  - programmes: one FOOD COURT building (storey 1 or 2), an optional office suite;
//  - the add-on's attachment: its host is any LEAF-able building (removing it never splits the rest; it still gets exactly ONE
//    bridge), the convention's storey (the +15 hall or a double-height street-level ballroom: its own stream, never re-rolled by a
//    retry) and the approach (straight off the lobby or through a foyer). The prize car always stays on the skyway level (it drives
//    the bridges).

import {Rng, hashString} from '../../core/rng';
import {SKYWAYS_ADDONS, SKYWAYS_LANDMARK_FAMILIES, SKYWAYS_SHOP_FAMILIES, type SkywaysAddonId, type SkywaysBuildingRole, type SkywaysFamily, type SkywaysLandmarkFamily, type SkywaysPlan, type SkywaysShopFamily, type SkywaysTopology} from './skywaysTypes';

/** Storey height (m): storey k at y = STOREY * k (station 0, street level 5, skyway level 10). */
export const STOREY = 5.0;
export const BASES = [0, STOREY, 2 * STOREY] as const;
/** Clear heights (m above the storey floor). */
export const CLEAR = {
  platform: 4.4, concourse: 4.4, lobby: 4.3, skyway: 3.9, bridge: 3.5, shop: 3.3, back: 3.0, corridor: 3.0, door: 2.3, wide: 3.0,
  /** Atrium court: the street-level band rises to the glass roof (absolute: bases[2] + atriumRoof). */
  atriumRoof: 6.2,
} as const;
/** Generation canvas (cells) and the complex's NW corner on it. */
export const SKYWAYS_CANVAS = {w: 520, h: 460, levels: 3, org: 36} as const;
/** Cells kept around the carved extent by the crop. */
export const CROP_MARGIN = 3;
/** Estimated carved extent (W x H cells) a frame keeps under: room for the track extensions inside the 120k-cell budget. */
export const SKYWAYS_FRAME_CELLS = 108_000;

/** Lanes of a vertical run (stopped escalators / fixed stairs side by side, one pitch). */
export type RunLanes = readonly ('escalator' | 'stair')[];
/** The station transit well's lane make-ups (seeded). */
export const TRANSIT_LANE_SETS: readonly [RunLanes, number][] = [
  [['escalator', 'stair', 'escalator'], 0.45], [['escalator', 'escalator', 'stair'], 0.2], [['stair', 'escalator', 'escalator'], 0.15], [['stair', 'stair'], 0.2],
];

/** One block of the frame. */
export interface FrameBuilding {
  id: string;
  /** Printed fictional name ("Calder Place"). */
  name: string;
  col: number;
  row: number;
  role: SkywaysBuildingRole;
  /** Footprint (canvas cells): the OUTER wall ring included. */
  x: number; y: number; w: number; h: number;
  /** Seeded interior choices. */
  atrium: boolean;
  /** Exterior shell height above the street (m). */
  height: number;
  /** Floor-plan family, its axis (galleria spine / the offset court's L-arm) and the offset court's corner (bit 0 east, bit 1 south). */
  plan: SkywaysPlan;
  axis: 'x' | 'z';
  corner: number;
  /** An office suite off a service corridor on this storey (0 = none). */
  offices: number;
}

/** A bridge edge of the frame (carved at the skyway level; lateral position chosen by the carve within `lateral`'s preference). */
export interface FrameBridge { id: string; a: string; b: string; axis: 'x' | 'z'; width: number; breached: boolean; lateral: 'centre' | 'low' | 'high' }

export interface SkywaysFrame {
  seed: number;
  family: SkywaysFamily;
  topology: SkywaysTopology;
  cols: number;
  rows: number;
  buildings: FrameBuilding[];
  bridges: FrameBridge[];
  /** The station building (its basement holds the station). */
  station: string;
  /** The add-on, its host building, its storey (the prize car: always 2) and its approach. */
  addon: SkywaysAddonId;
  addonHost: string;
  addonLevel: 1 | 2;
  addonApproach: 'direct' | 'foyer';
  /** The building whose skyway level holds the ramen restaurant (never the add-on host). */
  ramen: string;
  /** Station platform length (cells). */
  Lp: number;
  /** The station transit well: the hub edge it hugs, its position along it (0..1) and its lanes. */
  transitEdge: 'N' | 'S';
  transitAt: number;
  transitLanes: RunLanes;
  /** Underground pedway branches from the station concourse up into other buildings' lobbies (0-2). */
  lowerLinks: string[];
  /** The food court: its building and storey (null: none this time). */
  foodCourt: {building: string; level: 1 | 2} | null;
  /** (destinations pass) The seeded rotation of destination shop families and landmark families (the carve takes them in order). */
  shopFamilies: SkywaysShopFamily[];
  landmarkFamilies: SkywaysLandmarkFamily[];
}

/** The destination rotations of a level seed (their own stream: a retry or a revisit never re-rolls them). */
export function skywaysDestinationsOf(levelSeed: number): {shops: SkywaysShopFamily[]; landmarks: SkywaysLandmarkFamily[]} {
  const r = new Rng(hashString('skyways:destinations', levelSeed >>> 0));
  return {shops: r.shuffle(SKYWAYS_SHOP_FAMILIES.slice()), landmarks: r.shuffle(SKYWAYS_LANDMARK_FAMILIES.slice())};
}

/** Add-on of a level seed: equal weights (one dedicated stream: never moved by any other roll). */
export function skywaysAddonOf(levelSeed: number): SkywaysAddonId {
  return new Rng(hashString('skyways:addon', levelSeed >>> 0)).pick(SKYWAYS_ADDONS as SkywaysAddonId[]);
}

/** The add-on's storey: the prize car always drives the skyway level; the convention takes the +15 hall or a street-level ballroom
 *  (its own stream: a retry never moves it). */
export function skywaysAddonLevelOf(levelSeed: number, addon: SkywaysAddonId): 1 | 2 {
  if (addon === 'prize-car') return 2;
  return new Rng(hashString('skyways:addon-level', levelSeed >>> 0)).chance(0.4) ? 1 : 2;
}

/** Dev / QA override of the add-on (tests; `?skywaysAddon=`); null = the seed's. */
let ADDON_OVERRIDE: SkywaysAddonId | null = null;
export function setSkywaysAddonOverride(a: SkywaysAddonId | null): void { ADDON_OVERRIDE = a; }

/** The generator's own seed (never the raw level seed: other systems hash that). */
export function skywaysSeed(levelSeed: number): number {
  return hashString('skyways:layout', levelSeed >>> 0);
}

/** Frame families: block grid (cols x rows), empty lots, block sizes (cells). */
const FAMILIES: Record<SkywaysFamily, {cols: number; rows: number; lots: [number, number]; colW: [number, number]; rowD: [number, number]; weight: number}> = {
  'block-2x2': {cols: 2, rows: 2, lots: [0, 0], colW: [70, 90], rowD: [60, 76], weight: 0.1},
  'block-3x2': {cols: 3, rows: 2, lots: [0, 1], colW: [62, 84], rowD: [58, 76], weight: 0.24},
  'block-2x3': {cols: 2, rows: 3, lots: [0, 1], colW: [70, 90], rowD: [54, 68], weight: 0.14},
  'cluster-3x3': {cols: 3, rows: 3, lots: [3, 4], colW: [62, 80], rowD: [54, 68], weight: 0.32},
  'chain-4x2': {cols: 4, rows: 2, lots: [2, 3], colW: [58, 72], rowD: [58, 74], weight: 0.2},
};

/**
 * The city frame of a level seed. `salt` > 0 re-rolls the free parameters (sizes, lots, offsets, bridge picks, plans) for a retry;
 * the family, the add-on and its storey stay those of the seed.
 */
export function skywaysFrame(levelSeed: number, salt = 0, opts: {legacy?: boolean} = {}): SkywaysFrame {
  const seed = skywaysSeed(levelSeed);
  const shape = new Rng(hashString('skyways:shape', seed));
  const rng = new Rng(salt ? hashString(`skyways:frame:${salt}`, seed) : hashString('skyways:frame', seed));
  const family = shape.weighted(Object.entries(FAMILIES).map(([k, v]) => [k as SkywaysFamily, v.weight] as const));
  const F = FAMILIES[family], {cols, rows} = F;
  const addon = ADDON_OVERRIDE ?? skywaysAddonOf(levelSeed);
  const addonLevel = skywaysAddonLevelOf(levelSeed, addon);
  const key = (c: number, r: number) => c * 31 + r;
  // --- Blocks: the station (bottom row), the empty lots, the add-on host ---------------------------------------------------------
  const stationCol = rng.int(0, cols - 1), stationRow = rows - 1;
  const blocks: {col: number; row: number}[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) blocks.push({col: c, row: r});
  const nLots = cols * rows >= 6 && F.lots[1] === 1 ? (rng.chance(0.4) ? 1 : 0) : rng.int(F.lots[0], F.lots[1]);
  let present = blocks;
  // half the time the lots leave a 2x2 core of blocks (a loop becomes possible), else any connected shape (L / T / S / U ...)
  const wantCore = nLots >= 2 && rng.chance(0.5);
  const hasCore = (keep: readonly Cell[]) => keep.some(b => [[1, 0], [0, 1], [1, 1]].every(([dc, dr]) => keep.some(q => q.col === b.col + dc && q.row === b.row + dr)));
  for (let t = 0; t < 80 && nLots; t++) {
    const lots = new Set(rng.shuffle(blocks.filter(b => !(b.col === stationCol && b.row === stationRow))).slice(0, nLots).map(b => key(b.col, b.row)));
    const keep = blocks.filter(b => !lots.has(key(b.col, b.row)));
    if (keep.length < 4 || !connected(keep)) continue;
    if (wantCore && t < 60 && !hasCore(keep)) continue;
    if (!keep.some(b => !(b.col === stationCol && b.row === stationRow) && !isCut(b, keep))) continue;
    present = keep;
    break;
  }
  // the add-on host: a building whose removal leaves the rest connected (a localized branch: exactly ONE bridge), arm ends preferred
  const nb = (b: {col: number; row: number}) => present.filter(q => Math.abs(q.col - b.col) + Math.abs(q.row - b.row) === 1).length;
  const hostCand = present.filter(b => !(b.col === stationCol && b.row === stationRow) && !isCut(b, present));
  const hostBlock = rng.weighted(hostCand.map(b => [b, nb(b) <= 1 ? 3 : nb(b) === 2 ? 2 : 1] as const));
  // --- Sizes: columns / rows (cells), streets between them, stagger ---------------------------------------------------------------
  const colW = Array.from({length: cols}, () => rng.int(F.colW[0], F.colW[1]));
  const rowD = Array.from({length: rows}, () => rng.int(F.rowD[0], F.rowD[1]));
  // the station's and the host's blocks are large ones (the station lobby holds both wells + a walkway; the host holds its hall)
  for (const [c, r] of [[stationCol, stationRow], [hostBlock.col, hostBlock.row]]) { colW[c] = Math.max(colW[c], rng.int(80, 88)); rowD[r] = Math.max(rowD[r], rng.int(72, 78)); }
  const streetW = () => rng.weighted([[rng.int(28, 32), 0.35], [rng.int(32, 38), 0.45], [rng.int(40, 46), 0.2]] as const);
  const streetX = Array.from({length: cols - 1}, streetW), streetZ = Array.from({length: rows - 1}, streetW);
  // fit the canvas width (the station block's platforms and the crop margins need room either side): narrower streets first,
  // then the ordinary columns
  const budget = SKYWAYS_CANVAS.w - 2 * SKYWAYS_CANVAS.org - 40;
  const total = () => colW.reduce((p, q) => p + q, 0) + streetX.reduce((p, q) => p + q, 0);
  for (let i = 0; total() > budget && i < 200; i++) {
    const s = streetX.indexOf(Math.max(...streetX));
    if (streetX.length && streetX[s] > 28) { streetX[s]--; continue; }
    let c = -1;
    for (let j = 0; j < cols; j++) if (j !== stationCol && j !== hostBlock.col && (c < 0 || colW[j] > colW[c])) c = j;
    if (c < 0 || colW[c] <= 56) break;
    colW[c]--;
  }
  // fit the cell budget (the per-storey arrays and the Beyond-the-Station track extensions, gen/skyways/index.ts SKYWAYS_EXT_MAX_CELLS):
  // the carved extent is about the blocks + streets, the station block's platforms beyond them and the crop margins — narrower
  // streets first, then the ordinary rows / columns, until it leaves the extensions their room
  const extent = () => (colW.reduce((p, q) => p + q, 0) + streetX.reduce((p, q) => p + q, 0) + 40) * (rowD.reduce((p, q) => p + q, 0) + streetZ.reduce((p, q) => p + q, 0) + 70);
  for (let i = 0; extent() > SKYWAYS_FRAME_CELLS && i < 400; i++) {
    const sts = [...streetX.map((v, j) => ['x', j, v] as const), ...streetZ.map((v, j) => ['z', j, v] as const)].filter(q => q[2] > 28).sort((p, q) => q[2] - p[2]);
    if (sts.length) { const [ax, j] = sts[0]; if (ax === 'x') streetX[j]--; else streetZ[j]--; continue; }
    const big = [...colW.map((v, j) => ['c', j, v] as const).filter(q => q[1] !== stationCol && q[1] !== hostBlock.col),
      ...rowD.map((v, j) => ['r', j, v] as const).filter(q => q[1] !== stationRow && q[1] !== hostBlock.row)].filter(q => q[2] > 54).sort((p, q) => q[2] - p[2]);
    if (!big.length) break;
    const [ax, j] = big[0];
    if (ax === 'c') colW[j]--; else rowD[j]--;
  }
  // stagger: whole rows shift along x and whole columns along z (a downtown grid that is not ruled), bounded by the narrowest street
  const minStreet = Math.min(...streetX, ...streetZ, 40);
  const sh = Math.max(0, Math.floor((minStreet - 24) / 2));
  const rowShift = Array.from({length: rows}, () => (sh && rng.chance(0.6) ? rng.int(-sh, sh) : 0));
  const colShift = Array.from({length: cols}, () => (sh && rng.chance(0.6) ? rng.int(-sh, sh) : 0));
  const O = SKYWAYS_CANVAS.org + Math.max(0, ...rowShift.map(v => -v), ...colShift.map(v => -v));
  const colX: number[] = [], rowZ: number[] = [];
  for (let c = 0, x0 = O; c < cols; c++) { colX.push(x0); x0 += colW[c] + (c < cols - 1 ? streetX[c] : 0); }
  for (let r = 0, z0 = O; r < rows; r++) { rowZ.push(z0); z0 += rowD[r] + (r < rows - 1 ? streetZ[r] : 0); }
  const buildings: FrameBuilding[] = [];
  const isStation = (b: {col: number; row: number}) => b.col === stationCol && b.row === stationRow;
  const isHost = (b: {col: number; row: number}) => b.col === hostBlock.col && b.row === hostBlock.row;
  for (const b of present) {
    // each footprint is its block minus a seeded setback on each side; now and then one side steps back behind a PLAZA (a longer
    // bridge / a wider street there); the station's and the host's blocks are filled
    const big = isStation(b) || isHost(b);
    const set = [0, 1, 2, 3].map(() => (big ? 0 : rng.int(0, 4)));
    if (!big && rng.chance(0.3)) set[rng.int(0, 3)] = rng.int(8, 14);
    const w = colW[b.col] - set[0] - set[1], h = rowD[b.row] - set[2] - set[3];
    const id = `B${buildings.length}`;
    buildings.push({id, name: '', col: b.col, row: b.row, role: 'tower', x: colX[b.col] + rowShift[b.row] + set[0], y: rowZ[b.row] + colShift[b.col] + set[2], w, h,
      atrium: false, height: rng.range(28, 90), plan: 'court', axis: 'x', corner: 0, offices: 0});
  }
  // printed names: a seeded draw from the pool (the shape stream: a retry keeps every name)
  const names = shape.shuffle(B_NAMES.slice());
  buildings.forEach((q, i) => { q.name = names[i % names.length]; });
  const byCell = (c: number, r: number) => buildings.find(q => q.col === c && q.row === r);
  const station = byCell(stationCol, stationRow)!;
  station.role = 'station';
  const host = byCell(hostBlock.col, hostBlock.row)!;
  // --- Bridge graph: grid neighbours, a random spanning tree over the non-host buildings + the topology's extra edges + ONE host edge
  const edges: {a: FrameBuilding; b: FrameBuilding; axis: 'x' | 'z'}[] = [];
  for (const q of buildings) {
    const e = byCell(q.col + 1, q.row), s = byCell(q.col, q.row + 1);
    if (e) edges.push({a: q, b: e, axis: 'x'});
    if (s) edges.push({a: q, b: s, axis: 'z'});
  }
  const parent = new Map(buildings.map(q => [q.id, q.id]));
  const find = (id: string): string => { let r = id; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const chosen = new Set<number>();
  const touchesHost = (i: number) => edges[i].a.id === host.id || edges[i].b.id === host.id;
  for (const i of rng.shuffle(edges.map((_, i) => i).filter(i => !touchesHost(i)))) {
    const ra = find(edges[i].a.id), rb = find(edges[i].b.id);
    if (ra !== rb) { parent.set(ra, rb); chosen.add(i); }
  }
  chosen.add(rng.pick(edges.map((_, i) => i).filter(touchesHost)));
  const spare = edges.map((_, i) => i).filter(i => !chosen.has(i) && !touchesHost(i));
  // a tree (branches, dead ends) or loops (every spare edge, up to two: the frames' grids have few once the host's are excluded)
  const extra = rng.chance(0.7) ? Math.min(spare.length, 2) : 0;
  const topology: SkywaysTopology = extra ? 'looped' : 'tree';
  for (const i of rng.shuffle(spare).slice(0, extra)) chosen.add(i);
  const bridgeEdges = [...chosen].sort((p, q) => p - q).map(i => edges[i]);
  host.role = addon === 'convention' ? 'hotel' : 'hub';
  // Atriums: one or two other hubs (court plan); the prize-car host's display hall needs its floor (no atrium there).
  const others = rng.shuffle(buildings.filter(q => q.id !== host.id && q.id !== station.id));
  // (destinations pass: one to three atrium courts — the landmark courts under the glass)
  // (legacy = layout version 1: GAME76's one or two)
  const nHub = Math.min(others.length, rng.int(1, opts.legacy ? 2 : 3));
  for (let i = 0; i < nHub; i++) { others[i].role = 'hub'; others[i].atrium = true; }
  // Bridges: width (cells) — at least 5.5 m wherever the prize car may drive (every bridge: the car roams the skyway level); now and
  // then a WIDE gallery bridge (7.5-9 m); a lateral preference along the two buildings' shared span
  const bridges: FrameBridge[] = bridgeEdges.map((e, i) => ({id: `K${i}`, a: e.a.id, b: e.b.id, axis: e.axis, width: rng.chance(0.18) ? rng.int(15, 18) : rng.int(11, 13), breached: false,
    lateral: rng.weighted([['centre', 0.5], ['low', 0.25], ['high', 0.25]] as const)}));
  // Pre-breached routes: about a third of the bridges (at least one when there are three or more), never every route clean.
  const nBreach = bridges.length >= 3 ? Math.max(1, Math.round(bridges.length * rng.range(0.25, 0.4))) : bridges.length ? (rng.chance(0.5) ? 1 : 0) : 0;
  for (const b of rng.shuffle(bridges.slice()).slice(0, nBreach)) b.breached = true;
  // --- Floor plans (per building, to suit its bridges) --------------------------------------------------------------------------
  const sidesOf = (q: FrameBuilding) => bridges.filter(e => e.a === q.id || e.b === q.id).map(e => {
    const o = buildings.find(p => p.id === (e.a === q.id ? e.b : e.a))!;
    return e.axis === 'x' ? (o.col > q.col ? 'E' : 'W') : (o.row > q.row ? 'S' : 'N');
  });
  for (const q of buildings) {
    const sides = sidesOf(q);
    const ew = sides.filter(s => s === 'E' || s === 'W').length, ns = sides.length - ew;
    const longX = q.w >= q.h;
    if (q.id === station.id) q.plan = rng.weighted([['court', 0.6], ['galleria', 0.4]] as const), q.axis = 'x';
    else if (q.id === host.id) {
      q.plan = rng.weighted([['court', 0.55], ['galleria', 0.45]] as const);
      q.axis = sides[0] === 'E' || sides[0] === 'W' ? 'x' : 'z'; // the spine runs in from the host's one bridge
    } else if (q.atrium) q.plan = 'court';
    else q.plan = rng.weighted([['galleria', 0.35], ['offset', 0.25], ['cross', 0.25], ['court', 0.15]] as const);
    if (q.plan === 'galleria' && q.id !== station.id && q.id !== host.id) q.axis = ew > ns ? 'x' : ns > ew ? 'z' : rng.chance(0.75) ? (longX ? 'x' : 'z') : (longX ? 'z' : 'x');
    if (q.plan === 'offset') {
      // the court sits in the corner toward its bridges (short corridors there); its L-arm runs out to the far facades
      const score = (c: number) => sides.filter(s => s === ((c & 1) ? 'E' : 'W') || s === ((c & 2) ? 'S' : 'N')).length + rng.range(0, 0.5);
      q.corner = [0, 1, 2, 3].sort((p, r) => score(r) - score(p))[0];
      q.axis = rng.chance(0.5) ? 'x' : 'z';
    }
  }
  // --- Programmes, links, the add-on's approach -----------------------------------------------------------------------------------
  // The ramen restaurant: a non-host building (never the add-on's)
  const ramen = rng.pick(buildings.filter(q => q.id !== host.id)).id;
  // The food court: a non-host building's skyway or street level (the station lobby too), most levels — a court plan by preference
  // (an atrium building's: the street-level court under the glass); a cross plan's arms leave its lobby few walls
  const fcPool = buildings.filter(q => q.id !== host.id && q.id !== ramen);
  const fcB = rng.chance(0.85) && fcPool.length ? rng.weighted(fcPool.map(q => [q, q.plan === 'court' ? 3 : q.plan === 'cross' ? 0.5 : 2] as const)) : null;
  const foodCourt = fcB ? {building: fcB.id, level: (fcB.atrium ? 1 : rng.chance(0.6) ? 2 : 1) as 1 | 2} : null;
  // An office suite: one ordinary building's skyway or street level, about half the time
  const offPool = buildings.filter(q => q.id !== host.id && q.id !== station.id && q.id !== fcB?.id);
  const offB = offPool.length && rng.chance(0.5) ? rng.pick(offPool) : undefined;
  if (offB) offB.offices = rng.chance(0.6) ? 2 : 1;
  // Underground pedways: the concourse runs under the street to the station row's neighbours and / or north to the building behind
  // the station (each with its own open stair up into that lobby): none, one or two
  const lowerCand = [byCell(stationCol - 1, stationRow), byCell(stationCol + 1, stationRow), byCell(stationCol, stationRow - 1)].filter((q): q is FrameBuilding => !!q && q.id !== host.id);
  const nLower = Math.min(lowerCand.length, rng.weighted([[0, 0.25], [1, 0.5], [2, 0.25]] as const));
  const lowerLinks = rng.shuffle(lowerCand).slice(0, nLower).map(q => q.id);
  const transitLanes = rng.weighted(TRANSIT_LANE_SETS);
  return {
    seed, family, topology, cols, rows, buildings, bridges, station: station.id, addon, addonHost: host.id, addonLevel,
    addonApproach: rng.chance(0.5) ? 'foyer' : 'direct', ramen, Lp: rng.int(124, 150),
    transitEdge: rng.chance(0.5) ? 'N' : 'S', transitAt: rng.range(0.15, 0.85), transitLanes, lowerLinks, foodCourt,
    shopFamilies: skywaysDestinationsOf(levelSeed).shops, landmarkFamilies: skywaysDestinationsOf(levelSeed).landmarks,
  };
}

const B_NAMES = ['Calder Place', 'Mercer Tower', 'Larch Court', 'Prairie Centre', 'Tamarack Square', 'Kestrel House', 'Juniper Plaza', 'Wexford Tower',
  'Coulee Centre', 'Bowline Place', 'Aspen Court', 'Harbin Tower', 'Ridgeline Plaza', 'Chinook Centre', 'Foothill Place', 'Silverwood Tower'];

type Cell = {col: number; row: number};
/** Whether the blocks form one 4-neighbour connected set. */
function connected(blocks: readonly Cell[]): boolean {
  if (!blocks.length) return true;
  const key = (c: number, r: number) => c * 31 + r;
  const have = new Set(blocks.map(q => key(q.col, q.row)));
  const seen = new Set<number>([key(blocks[0].col, blocks[0].row)]);
  const q = [blocks[0]];
  for (let i = 0; i < q.length; i++) {
    const {col, row} = q[i];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc, r = row + dr, k = key(c, r);
      if (!have.has(k) || seen.has(k)) continue;
      seen.add(k); q.push({col: c, row: r});
    }
  }
  return seen.size === blocks.length;
}
/** Whether removing block `b` disconnects the remaining blocks (4-neighbour grid). */
function isCut(b: Cell, blocks: readonly Cell[]): boolean {
  return !connected(blocks.filter(q => !(q.col === b.col && q.row === b.row)));
}
