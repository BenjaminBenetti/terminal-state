// Task studio-skyways-level-20261106-054448-01 (primary): the seeded CITY FRAME of a Skyways level — which blocks hold buildings,
// their footprints, the streets between them, the bridge graph (a spanning tree + extra edges: branches and loops), the station
// building, the host of the ONE add-on and the add-on itself (equal weights: convention / prize car). Pure data, canvas cells (0.5 m).
//
// The frame is drawn from the level seed only (rng streams of their own): the carve (gen/skyways/carve.ts) never re-rolls it, a retry
// re-rolls only the free parameters (`salt`), and the add-on choice never depends on anything carved.

import {Rng, hashString} from '../../core/rng';
import {SKYWAYS_ADDONS, type SkywaysAddonId, type SkywaysBuildingRole} from './skywaysTypes';

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
}

/** A bridge edge of the frame (carved at the skyway level; lateral position chosen by the carve). */
export interface FrameBridge { id: string; a: string; b: string; axis: 'x' | 'z'; width: number; breached: boolean }

export interface SkywaysFrame {
  seed: number;
  cols: number;
  rows: number;
  buildings: FrameBuilding[];
  bridges: FrameBridge[];
  /** The station building (its basement holds the station). */
  station: string;
  /** The add-on and its host building. */
  addon: SkywaysAddonId;
  addonHost: string;
  /** The building whose skyway level holds the ramen restaurant (never the add-on host). */
  ramen: string;
  /** Station platform length (cells). */
  Lp: number;
  /** A lower (underground) pedway branch from the station concourse up into a second building's lobby. */
  lowerLink: string | null;
}

/** Add-on of a level seed: equal weights (one dedicated stream: never moved by any other roll). */
export function skywaysAddonOf(levelSeed: number): SkywaysAddonId {
  return new Rng(hashString('skyways:addon', levelSeed >>> 0)).pick(SKYWAYS_ADDONS as SkywaysAddonId[]);
}

/** Dev / QA override of the add-on (tests; `?skywaysAddon=`); null = the seed's. */
let ADDON_OVERRIDE: SkywaysAddonId | null = null;
export function setSkywaysAddonOverride(a: SkywaysAddonId | null): void { ADDON_OVERRIDE = a; }

/** The generator's own seed (never the raw level seed: other systems hash that). */
export function skywaysSeed(levelSeed: number): number {
  return hashString('skyways:layout', levelSeed >>> 0);
}

/**
 * The city frame of a level seed. `salt` > 0 re-rolls the free parameters (sizes, offsets, bridge picks) for a retry; the shape
 * class (cols x rows), the add-on and its role assignment stay those of the seed.
 */
export function skywaysFrame(levelSeed: number, salt = 0): SkywaysFrame {
  const seed = skywaysSeed(levelSeed);
  const shape = new Rng(hashString('skyways:shape', seed));
  const rng = new Rng(salt ? hashString(`skyways:frame:${salt}`, seed) : hashString('skyways:frame', seed));
  const [cols, rows] = shape.weighted<[number, number]>([[[3, 2], 0.5], [[2, 2], 0.2], [[2, 3], 0.3]]);
  const addon = ADDON_OVERRIDE ?? skywaysAddonOf(levelSeed);
  // Column widths / row depths (cells) and street widths between them.
  const colW = Array.from({length: cols}, () => rng.int(64, 86));
  const rowD = Array.from({length: rows}, () => rng.int(58, 76));
  const streetX = Array.from({length: cols - 1}, () => rng.int(30, 38));
  const streetZ = Array.from({length: rows - 1}, () => rng.int(30, 38));
  const O = SKYWAYS_CANVAS.org;
  // The station building: a block of the bottom row (its basement + the station block extend under the street to the west / east).
  // Its block is a large one (the lobby holds the escalator well up from the pedway concourse AND the public run up to the skyways).
  const stationCol = rng.int(0, cols - 1), stationRow = rows - 1;
  colW[stationCol] = Math.max(colW[stationCol], rng.int(80, 88));
  rowD[stationRow] = Math.max(rowD[stationRow], rng.int(72, 78));
  // The add-on host: a corner block other than the station's (a localized branch: it gets exactly ONE bridge), also a large block
  const corners = [[0, 0], [cols - 1, 0], [0, rows - 1], [cols - 1, rows - 1]].filter(([c, r]) => !(c === stationCol && r === stationRow));
  const [hostCol, hostRow] = rng.pick(corners);
  colW[hostCol] = Math.max(colW[hostCol], rng.int(80, 88));
  rowD[hostRow] = Math.max(rowD[hostRow], rng.int(72, 78));
  // One empty block (a gutted lot: scenery only) on larger frames, never the station block.
  const blocks: {col: number; row: number}[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) blocks.push({col: c, row: r});
  let empty: {col: number; row: number} | null = null;
  if (cols * rows >= 6 && rng.chance(0.45)) {
    const cand = blocks.filter(b => !(b.col === stationCol && b.row === stationRow) && !(b.col === hostCol && b.row === hostRow) && !isCut({col: b.col, row: b.row}, blocks.filter(q => !(q.col === hostCol && q.row === hostRow)), stationCol, stationRow, cols, rows));
    if (cand.length) empty = rng.pick(cand);
  }
  const buildings: FrameBuilding[] = [];
  let x0 = O;
  const colX: number[] = [];
  for (let c = 0; c < cols; c++) { colX.push(x0); x0 += colW[c] + (c < cols - 1 ? streetX[c] : 0); }
  let z0 = O;
  const rowZ: number[] = [];
  for (let r = 0; r < rows; r++) { rowZ.push(z0); z0 += rowD[r] + (r < rows - 1 ? streetZ[r] : 0); }
  for (const b of blocks) {
    if (empty && b.col === empty.col && b.row === empty.row) continue;
    // each footprint is its block minus a seeded setback on each side (streets of varying width; never closer than the min street);
    // the station building fills its block
    const st = (b.col === stationCol && b.row === stationRow) || (b.col === hostCol && b.row === hostRow);
    const sx0 = st ? 0 : rng.int(0, 4), sx1 = st ? 0 : rng.int(0, 4), sz0 = st ? 0 : rng.int(0, 4), sz1 = st ? 0 : rng.int(0, 4);
    const w = colW[b.col] - sx0 - sx1, h = rowD[b.row] - sz0 - sz1;
    const id = `B${buildings.length}`;
    buildings.push({id, name: '', col: b.col, row: b.row, role: 'tower', x: colX[b.col] + sx0, y: rowZ[b.row] + sz0, w, h, atrium: false, height: rng.range(28, 90)});
  }
  // printed names: a seeded draw from the pool (the shape stream: a retry keeps every name)
  const names = shape.shuffle(B_NAMES.slice());
  buildings.forEach((q, i) => { q.name = names[i % names.length]; });
  const byCell = (c: number, r: number) => buildings.find(q => q.col === c && q.row === r);
  const station = byCell(stationCol, stationRow)!;
  station.role = 'station';
  // Bridge graph: grid neighbours (orthogonal, both present), a random spanning tree + extra edges (loops), never all of them.
  const edges: {a: FrameBuilding; b: FrameBuilding; axis: 'x' | 'z'}[] = [];
  for (const q of buildings) {
    const e = byCell(q.col + 1, q.row), s = byCell(q.col, q.row + 1);
    if (e) edges.push({a: q, b: e, axis: 'x'});
    if (s) edges.push({a: q, b: s, axis: 'z'});
  }
  const host = byCell(hostCol, hostRow)!;
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
  const extra = Math.min(spare.length, buildings.length >= 5 ? rng.int(1, 2) : rng.int(0, 1));
  for (const i of rng.shuffle(spare).slice(0, extra)) chosen.add(i);
  const bridgeEdges = [...chosen].sort((p, q) => p - q).map(i => edges[i]);
  const degree = new Map<string, number>();
  for (const e of bridgeEdges) for (const id of [e.a.id, e.b.id]) degree.set(id, (degree.get(id) ?? 0) + 1);
  void degree;
  host.role = addon === 'convention' ? 'hotel' : 'hub';
  // Atriums: the add-on host for the prize car (its display atrium), plus one or two other hubs.
  const others = rng.shuffle(buildings.filter(q => q.id !== host.id && q.id !== station.id));
  const nHub = Math.min(others.length, rng.int(1, 2));
  for (let i = 0; i < nHub; i++) { others[i].role = 'hub'; others[i].atrium = true; }
  if (addon === 'prize-car') host.atrium = false; // the car's display hall replaces the atrium (it needs its floor)
  // The ramen restaurant: a non-host building (never the add-on's)
  const ramenPool = buildings.filter(q => q.id !== host.id);
  const ramen = rng.pick(ramenPool).id;
  // Bridges: width (cells) — at least 5.5 m wherever the prize car may drive (every bridge: the car roams the skyway level)
  const bridges: FrameBridge[] = bridgeEdges.map((e, i) => ({id: `K${i}`, a: e.a.id, b: e.b.id, axis: e.axis, width: rng.int(11, 13), breached: false}));
  // Pre-breached routes: about a third of the bridges (at least one when there are three or more), never every route clean.
  const nBreach = bridges.length >= 3 ? Math.max(1, Math.round(bridges.length * rng.range(0.25, 0.4))) : bridges.length ? (rng.chance(0.5) ? 1 : 0) : 0;
  for (const b of rng.shuffle(bridges.slice()).slice(0, nBreach)) b.breached = true;
  // A lower pedway link: the station concourse runs under the street into the next building of the bottom row (its own stair up).
  const lowerCand = [byCell(stationCol - 1, stationRow), byCell(stationCol + 1, stationRow)].filter((q): q is FrameBuilding => !!q && q.id !== host.id);
  const lowerLink = lowerCand.length && rng.chance(0.6) ? rng.pick(lowerCand).id : null;
  return {seed, cols, rows, buildings, bridges, station: station.id, addon, addonHost: host.id, ramen, Lp: rng.int(124, 150), lowerLink};
}

const B_NAMES = ['Calder Place', 'Mercer Tower', 'Larch Court', 'Prairie Centre', 'Tamarack Square', 'Kestrel House', 'Juniper Plaza', 'Wexford Tower',
  'Coulee Centre', 'Bowline Place', 'Aspen Court', 'Harbin Tower', 'Ridgeline Plaza', 'Chinook Centre', 'Foothill Place', 'Silverwood Tower'];

/** Whether removing block `b` disconnects the remaining blocks (4-neighbour grid). */
function isCut(b: {col: number; row: number}, blocks: readonly {col: number; row: number}[], _sc: number, _sr: number, cols: number, rows: number): boolean {
  const rest = blocks.filter(q => !(q.col === b.col && q.row === b.row));
  const key = (c: number, r: number) => c * 31 + r;
  const have = new Set(rest.map(q => key(q.col, q.row)));
  const seen = new Set<number>([key(rest[0].col, rest[0].row)]);
  const q = [rest[0]];
  for (let i = 0; i < q.length; i++) {
    const {col, row} = q[i];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc, r = row + dr, k = key(c, r);
      if (c < 0 || r < 0 || c >= cols || r >= rows || !have.has(k) || seen.has(k)) continue;
      seen.add(k); q.push({col: c, row: r});
    }
  }
  return seen.size !== rest.length;
}
