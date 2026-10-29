// Iteration 16 (WORLD-GEN): the OFFICE TOWER FRAME — what every section of one Office Space level shares (pure data).
//
// Derived from the LEVEL seed only, so each section (the street station + lobby, floors 2..8) is generated on its own and
// still agrees with the others: the footprint, the central core (elevator shaft, stairwell vestibule, restrooms, closets),
// the corridor rings and the storey height. Every section's grid puts the tower interior's NW corner at cell (MARGIN, MARGIN),
// so the elevator / stairwell / windows have IDENTICAL world X/Z on every floor and in the lobby.
//
// Tower-local cells (x east, y south), interior [0, TW) x [0, TD); the perimeter wall ring is x = -1 / TW, y = -1 / TD:
//
//   y 0 ┌──────────────────────── N band (rooms / open plan, nB rows) ───────────────────────┐ windows
//       ├──────────────────────── N corridor (K rows, full width: elevator lobby) ─────────────┤
//       │ W end zone │ W corr │ CORE: units side by side (stair · elevator · WCs · closets) │ E corr │ E end zone │
//       ├──────────────────────── S corridor (K rows, full width) ─────────────────────────────┤
//  y TD └──────────────────────── S band (rooms / open plan, sB rows) ───────────────────────┘
//
// One-cell walls everywhere between those strips (rooms get doors / wide openings onto the corridors). The elevator cab sits at
// the north end of its core unit (door through the core's north wall onto the N corridor = the elevator lobby); the stairwell
// vestibule likewise (its stair door is on its back wall). Canonical orientation on every floor: the elevator door faces north.

import {Rng, hashString} from '../../core/rng';
import {CELL} from '../grid';

export const OFFICE_TOP_FLOOR = 8;
export const OFFICE_FLOORS: readonly number[] = Array.from({length: OFFICE_TOP_FLOOR}, (_, i) => i + 1);
/** Office section names: 'street' (floor 1 = its upper storey, the lobby), 'floor-2' … 'floor-8'. */
export const OFFICE_SECTIONS: readonly string[] = ['street', ...OFFICE_FLOORS.slice(1).map(f => `floor-${f}`)];
/** Grid cells between the section grid's edge and the tower interior (the wall ring is cell MARGIN - 1). */
export const MARGIN = 2;
/** Storey height (m): exterior ground = storey floor - FLOOR_HEIGHT * (floor - 1). */
export const FLOOR_HEIGHT = 4.4;
/** Clear heights (m): lobby, office rooms / open plan, corridors, core rooms, elevator cab, door openings. */
export const CEIL = {lobby: 4.0, office: 2.9, corridor: 2.75, core: 2.6, cab: 2.6, stair: 2.8, door: 2.2, wide: 2.45};
/** Window sill / head above the storey floor (m): office floors, lobby; entrance doors. */
export const WINDOW = {sill: 0.85, head: 2.55, lobbySill: 0.45, lobbyHead: 3.45, entranceHead: 2.6};

export type CoreUnitKind = 'stair' | 'elevator' | 'wc-m' | 'wc-w' | 'closet';
export interface CoreUnit { kind: CoreUnitKind; x0: number; x1: number }

export interface TowerFrame {
  levelSeed: number;
  name: string;
  /** Interior size (cells). */
  TW: number; TD: number;
  /** Corridor width (cells). */
  K: number;
  /** N / S band depths (rows), end-zone widths (cols). */
  nB: number; sB: number; eW: number; eE: number;
  /** Core box (tower-local cells, exclusive ends). */
  cx0: number; cx1: number; cy0: number; cy1: number;
  units: CoreUnit[];
  /** Elevator cab (tower-local cells), door cells (3 wide) in row cy0 - 1. */
  cab: {x: number; y: number; w: number; h: number};
  /** Stairwell vestibule (tower-local cells); its stair door is on the back wall (row vest.y + vest.h). */
  vest: {x: number; y: number; w: number; h: number};
  floorHeight: number;
}

const TOWER_NAMES = ['Harlan Mutual Tower', 'Calder Trust Building', 'Meridian Plaza', 'Ostend Life Tower', 'Kessler & Pruitt Building',
  'Northgate Commerce Centre', 'Bramley House', 'Union Assurance Tower', 'Halsey Financial Centre', 'Garnet One'];

/** The tower frame of a level seed (identical for every section). */
export function towerFrame(levelSeed: number): TowerFrame {
  const rng = new Rng(hashString('office-tower-frame', levelSeed >>> 0));
  const name = rng.pick(TOWER_NAMES);
  const K = 4;
  const nB = rng.int(14, 18), sB = rng.int(14, 18);
  const eW = rng.int(13, 18), eE = rng.int(13, 18);
  // Core units west to east: the stair vestibule and the elevator always side by side, restrooms and closets around them.
  const W = {stair: 7, elevator: 5, 'wc-m': 8, 'wc-w': 8, closet: 5} as const;
  const orders: CoreUnitKind[][] = [
    ['wc-m', 'wc-w', 'elevator', 'stair', 'closet'],
    ['closet', 'stair', 'elevator', 'wc-m', 'wc-w'],
    ['wc-m', 'stair', 'elevator', 'wc-w', 'closet'],
    ['closet', 'wc-m', 'elevator', 'stair', 'wc-w'],
  ];
  const order = rng.pick(orders);
  const CH = 12;
  const cy0 = nB + 2 + K, cy1 = cy0 + CH;
  const TD = cy1 + 2 + K + sB;
  const cx0 = eW + 2 + K;
  const units: CoreUnit[] = [];
  let x = cx0;
  for (const kind of order) { units.push({kind, x0: x, x1: x + W[kind]}); x += W[kind] + 1; }
  const cx1 = x - 1;
  const TW = cx1 + 2 + K + eE;
  const el = units.find(u => u.kind === 'elevator')!, st = units.find(u => u.kind === 'stair')!;
  return {
    levelSeed: levelSeed >>> 0, name, TW, TD, K, nB, sB, eW, eE, cx0, cx1, cy0, cy1, units,
    cab: {x: el.x0, y: cy0, w: 5, h: 4},
    vest: {x: st.x0, y: cy0, w: 7, h: 7},
    floorHeight: FLOOR_HEIGHT,
  };
}

/** Section seed (the layout seed) of an office section. */
export function sectionSeed(levelSeed: number, section: string): number {
  return hashString(`office:${section}`, levelSeed >>> 0) >>> 0;
}

/** Floor number of an office section name (street = 1). */
export function floorOf(section: string): number {
  if (section === 'street') return 1;
  const m = /^floor-(\d+)$/.exec(section);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(n) || n < 2 || n > OFFICE_TOP_FLOOR) throw new Error(`unknown office section '${section}'`);
  return n;
}

/** World metres of a tower-local cell edge (the section grid puts the interior at cell MARGIN). */
export const wx = (tx: number): number => (tx + MARGIN) * CELL;
export const wz = (ty: number): number => (ty + MARGIN) * CELL;
