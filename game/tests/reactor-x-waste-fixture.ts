// Task reactor-expansion-20261101 (lane WASTE): a FIXTURE host for the waste repository carver (until lane HOST's real slot lands):
// a 6-storey Kit, a walkway deck on tier 4, the pit-wall entrance span and a free rock region beside it (any inward side), the carver
// called on the shared Kit before the crop, then the crop, ONE station dresser pass (deck + generator cells held like the real host) and
// the complex's own dress hook. Not a test file (no `.test.`).

import {Rng} from '../src/core/rng';
import {Kit} from '../src/gen/stationKit';
import {cropKit, dummyTrench} from '../src/gen/office/common';
import {registerApertures} from '../src/gen/levelGen';
import {applyLighting, dress} from '../src/gen/stationDress';
import {holdCells} from '../src/gen/office/transit';
import {FLOOR} from '../src/gen/grid';
import type {Level} from '../src/gen/levels';
import type {Rect, StationLayout} from '../src/gen/stationTypes';
import type {ComplexCarve, ComplexSlot} from '../src/gen/reactor/complex/types';
import {carveWaste} from '../src/gen/reactor/complex/waste';

export const FIX_LEVEL = 4;
export const FIX_BASES = [0, -6.1, -12.0, -18.2, -24.3, -30.4];
const W = 200, H = 200;

export interface WasteFixture {
  k: Kit;
  slot: ComplexSlot;
  carve: ComplexCarve | null;
  layout: StationLayout | null;
  carveMs: number;
  /** The deck cell just in front of the entrance (grid = canvas: the fixture crops at the origin). */
  deckCell: [number, number];
  /** layout.props index of the first prop the complex's dress hook added (the station dresser's come before it). */
  firstProp?: number;
}

/** One fixture: `inward` side, region U (along the pit wall) x V (inward) cells, entrance offset along the wall (cells from centre). */
export function wasteFixture(seed: number, inward: 'N' | 'S' | 'E' | 'W', o: {U?: number; V?: number; off?: number; ew?: number; dressIt?: boolean; hook?: boolean} = {}): WasteFixture {
  const U = o.U ?? 80, V = o.V ?? 64, ew = o.ew ?? 6, off = o.off ?? 0;
  const rng = new Rng(seed);
  const k = new Kit(rng, {levels: 6, w: W, h: H});
  const base = FIX_BASES[FIX_LEVEL];
  let deck: Rect, region: Rect, entrance: Rect, deckCell: [number, number];
  const e0 = Math.floor(U / 2) - Math.floor(ew / 2) + off;
  // (lane HOST's convention: the region's pit-side row IS the pit wall; the entrance span lies in it, in front of the deck)
  switch (inward) {
    case 'S': deck = {x: 30, y: 10, w: 130, h: 10}; region = {x: 40, y: 20, w: U, h: V}; entrance = {x: 40 + e0, y: 20, w: ew, h: 1}; deckCell = [40 + e0 + 1, 19]; break;
    case 'N': region = {x: 40, y: 10, w: U, h: V}; entrance = {x: 40 + e0, y: 9 + V, w: ew, h: 1}; deck = {x: 30, y: 10 + V, w: 130, h: 10}; deckCell = [40 + e0 + 1, 10 + V]; break;
    case 'E': deck = {x: 10, y: 30, w: 10, h: 130}; region = {x: 20, y: 40, w: V, h: U}; entrance = {x: 20, y: 40 + e0, w: 1, h: ew}; deckCell = [19, 40 + e0 + 1]; break;
    default: region = {x: 10, y: 40, w: V, h: U}; entrance = {x: 9 + V, y: 40 + e0, w: 1, h: ew}; deck = {x: 10 + V, y: 30, w: 10, h: 130}; deckCell = [10 + V, 40 + e0 + 1]; break;
  }
  const front = k.addArea(deck, 'concourse', 'concourse', base + 20, -1, {level: FIX_LEVEL, floorY: base, role: 'reactor-landing', label: 'Generator landing · Tier 4'});
  const slot: ComplexSlot = {id: 'waste', zone: 2, level: FIX_LEVEL, baseY: base, region, entrance, frontArea: front.id, inward, ceilMax: base + 5.6};
  const t0 = performance.now();
  const carve = carveWaste({k, rng: rng.fork('complex-waste'), slot, levelOpt: {level: FIX_LEVEL, floorY: base}});
  const carveMs = performance.now() - t0;
  if (!carve || o.dressIt === false) return {k, slot, carve, layout: null, carveMs, deckCell};
  const c = cropKit(k, [0, 1, 2, 3, 4, 5], 0, 0, W, H);
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: FIX_BASES[id]}));
  const [px, pz] = levels[FIX_LEVEL].grid.center(...deckCell);
  const layout: StationLayout = {
    seed, attempt: 0, name: 'Waste fixture', archetype: 'side-mezzanine', towards: ['A', 'B'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [], playerSpawn: {x: px, z: pz, yaw: 0}, trench: dummyTrench(), trenches: [],
    platform: front.id, platforms: [front.id], traversal: {stairs: [], ladders: [], underpasses: []}, levels, levelLinks: [], rails: [],
  };
  registerApertures(layout.levels);
  // the host's holds through the station dresser: the deck, the generator skid and its use point
  const g = levels[FIX_LEVEL].grid, deckCells: number[] = [], genCells: number[] = [];
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && g.area[i] === front.id) deckCells.push(i);
  const gf = carve.generator.foot, gu = carve.generator.use;
  for (let y = gf.y; y < gf.y + gf.h; y++) for (let x = gf.x; x < gf.x + gf.w; x++) genCells.push(g.idx(x, y));
  const useCells: number[] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) useCells.push(g.idx(gu.x + dx, gu.y + dy));
  // (like the host, task studio-reactor-playtest-round2-20261102: + the carve's reserved set-piece spans, through this pass only)
  const reserved: number[] = [];
  for (const r of carve.reserve ?? []) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (g.cells[g.idx(x, y)] === FLOOR) reserved.push(g.idx(x, y));
  const release = holdCells(layout, [{level: FIX_LEVEL, cells: deckCells}, {level: FIX_LEVEL, cells: useCells}, {level: FIX_LEVEL, cells: reserved}]);
  // the skid stays blocked (the host's collision machine)
  for (const i of genCells) g.blocked[i] = 1;
  dress(layout, rng.fork('dress'));
  release();
  const firstProp = layout.props.length;
  // like the host (complex/host.ts dressComplexes): the deck, the use point and the entrance apron (3 cells both sides) held clear
  const apron: number[] = [];
  {
    const E = entrance, dir = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]}[inward], along = E.w > 1 ? [1, 0] : [0, 1], n = Math.max(E.w, E.h);
    for (let t = -1; t <= n; t++) for (let d = -3; d <= 3; d++) { const x = E.x + along[0] * t + dir[0] * d, y = E.y + along[1] * t + dir[1] * d; if (g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR) apron.push(g.idx(x, y)); }
  }
  const release2 = holdCells(layout, [{level: FIX_LEVEL, cells: deckCells}, {level: FIX_LEVEL, cells: useCells}, {level: FIX_LEVEL, cells: apron}]);
  if (o.hook !== false) carve.dress?.(layout, rng.fork('complex-waste-dress'), {ox: c.ox, oy: c.oy});
  release2();
  applyLighting(layout, rng.fork('lighting'));
  return {k, slot, carve, layout, carveMs, deckCell, firstProp};
}
