// Iteration 08 (Lane B): a small HAND-MADE three-level station for multi-level gameplay / render tests
// (independent of the generator). Plan (cells 0.5 m; world x = cell x * 0.5, z = cell y * 0.5):
//
//   z  2..10  platform A (main, floor 0)  ── U1 stairs up (x 8.5..20, z 2.5..4.5) to the deck
//                                          ── D2 stairs down (x 8..20, z 7..9) to the lower crossing
//   z 10..14  track bed (main, VOID floor -1.15)
//   z 14..22  platform B (main, floor 0)  ── U2 stairs up (x 8.5..20, z 14.5..16.5) to the deck
//                                          ── D1 stairs down (x 8..20, z 19..21) to the lower crossing
//   UPPER deck (level 1, floor 4.75, ceil 7.75): x 20..26, z 2..22 — a mezzanine / crossover over BOTH
//     platforms and the track bed (real X/Z overlap); main ceiling under it 4.4 (0.35 m slab), 8.5
//     elsewhere (the hall rises around it, so its edges are railed drops).
//   APERTURE (light well) in the deck over the track bed: x 22..24, z 11..13 (the bed's band rises
//     to 7.75 through it; railed all round).
//   LOWER crossing (level 2, floor -5, ceil -2.6): x 5..8, z 2..22 — under platform A, the track bed
//     and platform B (slab -2.6..-1.15 under the bed). Two dead-end alcoves off its west side: a
//     crouch-only duct (x 3..5, z 15..17, 1.45 m clear) and a low soffit bay (x 3..5, z 11..13, 1.9 m).
// The two U flights are open stairs inside the 8.5 m hall (Ramp.headroom large, capped by ceil = 8.5:
// the gameplay band rule of gen/levels.ts); D1 / D2 are open stairwells cut into the platforms.
// Loops: platform A -> U1 -> deck -> U2 -> platform B -> D1 -> lower crossing -> D2 -> platform A.
// Two loot holders stand in the same column on the main platform and on the deck (loot uniqueness).

import {CELL, FLOOR, Grid, SOLID, VOID, type Ramp} from '../../src/gen/grid';
import {Levels, type Level, type LevelLink, type RailRun} from '../../src/gen/levels';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../src/gen/props';
import {STAIR, layStairRun, type StairFlight} from '../../src/gen/traversal';
import type {Area, LightPlacement, PickupPlacement, StationLayout, Trench, ZombieSpawn} from '../../src/gen/station';

export const FIX = {
  W: 64, H: 48,
  upperY: 4.75, upperCeil: 7.75, mainCeil: 8.5, underDeckCeil: 4.4, lowerY: -5, lowerCeil: -2.6, bedY: -1.15,
  /** Deck cells (level 1). */
  deck: {x0: 40, x1: 51, y0: 4, y1: 43},
  /** Aperture cells in the deck (level 1 SOLID; the bed band rises through). */
  aperture: {x0: 44, x1: 47, y0: 22, y1: 25},
  /** Lower crossing cells (level 2). */
  lower: {x0: 10, x1: 15, y0: 4, y1: 43},
  /** Lower-level alcoves (cells): crouch-only duct (1.45 m clear) and a low soffit bay (1.9 m). */
  duct: {x0: 6, x1: 9, y0: 30, y1: 33, clear: 1.45},
  soffit: {x0: 6, x1: 9, y0: 22, y1: 25, clear: 1.9},
  platA: {x0: 4, x1: 59, y0: 4, y1: 19},
  bed: {x0: 4, x1: 59, y0: 20, y1: 27},
  platB: {x0: 4, x1: 59, y0: 28, y1: 43},
  /** Stair rects (cells): U = main <-> upper, D = main <-> lower. */
  U1: {x: 17, y: 5, w: 23, h: 4},
  U2: {x: 17, y: 29, w: 23, h: 4},
  D1: {x: 16, y: 38, w: 24, h: 4},
  D2: {x: 16, y: 14, w: 24, h: 4},
} as const;

export interface FixtureLayout extends StationLayout {
  levels: Level[];
  levelLinks: LevelLink[];
  rails: RailRun[];
}

type R = {x: number; y: number; w: number; h: number};
const cellsOf = (r: {x0: number; x1: number; y0: number; y1: number}, f: (x: number, y: number) => void) => {
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) f(x, y);
};

function area(id: number, a: Partial<Area> & {x: number; y: number; w: number; h: number}): Area {
  return {id, kind: 'platform', type: 'platform', label: `Area ${id}`, ceil: FIX.mainCeil, parent: -1, depth: 0, publicSpace: true, lighting: 'lit', ...a} as Area;
}

function prop(kind: PropKind, x: number, y: number, z: number, areaId: number, level: number, rot = 0): PropPlacement {
  const def = PROP_DEFS[kind];
  const {hx, hz} = footprint(kind, rot);
  return Object.assign({kind, x, y, z, rot, area: areaId, hx, hz, h: def.h, blocksSight: def.blocksSight, variant: 0} as PropPlacement, level ? {level} : {});
}

/**
 * Build the fixture. `rails`: 'derived' (layout.rails = the Levels RAIL_DROP rule, the default),
 * 'none' (an empty generator list: every edge is an open drop).
 */
export function levelFixture(o: {rails?: 'derived' | 'none'} = {}): FixtureLayout {
  const {W, H} = FIX;
  const g0 = new Grid(W, H), g1 = new Grid(W, H), g2 = new Grid(W, H);
  // --- main level -------------------------------------------------------------------------
  const setMain = (x: number, y: number, v: number, floor: number, ceil: number, a: number) => {
    const i = g0.idx(x, y);
    g0.cells[i] = v; g0.floor[i] = floor; g0.ceil[i] = ceil; g0.area[i] = a;
  };
  const underDeck = (x: number, y: number) => x >= FIX.deck.x0 && x <= FIX.deck.x1 && y >= FIX.deck.y0 && y <= FIX.deck.y1;
  const inAperture = (x: number, y: number) => x >= FIX.aperture.x0 && x <= FIX.aperture.x1 && y >= FIX.aperture.y0 && y <= FIX.aperture.y1;
  const mainCeil = (x: number, y: number) => (inAperture(x, y) ? FIX.upperCeil : underDeck(x, y) ? FIX.underDeckCeil : FIX.mainCeil);
  cellsOf(FIX.platA, (x, y) => setMain(x, y, FLOOR, 0, mainCeil(x, y), 0));
  cellsOf(FIX.bed, (x, y) => setMain(x, y, VOID, FIX.bedY, mainCeil(x, y), -1));
  cellsOf(FIX.platB, (x, y) => setMain(x, y, FLOOR, 0, mainCeil(x, y), 1));
  // --- upper deck ---------------------------------------------------------------------------
  cellsOf(FIX.deck, (x, y) => {
    const i = g1.idx(x, y);
    if (inAperture(x, y)) return;
    g1.cells[i] = FLOOR; g1.floor[i] = FIX.upperY; g1.ceil[i] = FIX.upperCeil; g1.area[i] = 2;
  });
  // --- lower crossing ----------------------------------------------------------------------
  cellsOf(FIX.lower, (x, y) => {
    const i = g2.idx(x, y);
    g2.cells[i] = FLOOR; g2.floor[i] = FIX.lowerY; g2.ceil[i] = FIX.lowerCeil; g2.area[i] = 3;
  });
  for (const bay of [FIX.duct, FIX.soffit]) cellsOf(bay, (x, y) => {
    const i = g2.idx(x, y);
    g2.cells[i] = FLOOR; g2.floor[i] = FIX.lowerY; g2.ceil[i] = FIX.lowerY + bay.clear; g2.area[i] = 3;
  });

  // --- stairs: carved identically into both connected grids (same ramp indices everywhere) ---
  const grids = [g0, g1, g2];
  const stairs: StairFlight[] = [];
  const links: LevelLink[] = [];
  const open = {...STAIR, headroom: FIX.mainCeil + 1}; // open stairs: the band is capped by the hall ceiling
  const run = (rect: R, areaId: number, lower: number, upper: number, from: 'lo' | 'hi', h0: number, h1: number, cap: number) => {
    let flights: StairFlight[] = [];
    for (const k of [lower, upper]) {
      const g = grids[k];
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.area[i] = areaId; }
      const f = layStairRun(g, rect, areaId, 'x', from, h0, h1, open);
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) g.ceil[g.idx(x, y)] = cap;
      if (k === lower) flights = f;
    }
    // keep ramp indices aligned in the third grid (zero-size placeholders: no cells)
    const third = grids.find((_, k) => k !== lower && k !== upper)!;
    for (const f of flights) { const r = grids[lower].ramps[f.ramp]; third.ramps.push({...r, w: 0, h: 0} as Ramp); }
    const first = stairs.length;
    for (const f of flights) { f.id = stairs.length; stairs.push(f); }
    const tops = flights.map(f => f.top).sort((a, b) => b.y - a.y), bots = flights.map(f => f.bottom).sort((a, b) => a.y - b.y);
    links.push({id: links.length, kind: 'stairs', lower, upper, ramp: flights[0].ramp, bottom: {...bots[0]}, top: {...tops[0]}, traversalId: first});
  };
  // U1 / U2: from platform level 0 (lo end, x 8.5) up to the deck (hi end lands at x 20 = deck edge)
  run(FIX.U1, 4, 0, 1, 'hi', FIX.upperY, 0, FIX.mainCeil);
  run(FIX.U2, 5, 0, 1, 'hi', FIX.upperY, 0, FIX.mainCeil);
  // D1 / D2: from the platform (hi end, x 20) down to the lower crossing (lo end meets x 8 = crossing edge)
  run(FIX.D1, 6, 2, 0, 'hi', 0, FIX.lowerY, FIX.mainCeil);
  run(FIX.D2, 7, 2, 0, 'hi', 0, FIX.lowerY, FIX.mainCeil);

  const levels: Level[] = [
    {id: 0, role: 'main', grid: g0, baseY: 0},
    {id: 1, role: 'upper', grid: g1, baseY: FIX.upperY},
    {id: 2, role: 'lower', grid: g2, baseY: FIX.lowerY},
  ];

  // --- props, holders, pickups, spawns, lights (absolute y; level where not 0) ----------------
  const props: PropPlacement[] = [
    prop('bench', 22.0, 0, 3.4, 0, 0),
    prop('crate', 22.0, FIX.upperY, 3.4, 2, 1),
    prop('cabinetTall', 24.5, 0, 2.35, 0, 0),
    prop('cabinetTall', 24.5, FIX.upperY, 2.35, 2, 1),
    prop('crate', 6.5, FIX.lowerY, 4.0, 3, 2),
  ];
  for (const p of props) {
    const g = grids[(p as {level?: number}).level ?? 0];
    const x0 = Math.floor((p.x - p.hx) / CELL), x1 = Math.floor((p.x + p.hx - 1e-6) / CELL), y0 = Math.floor((p.z - p.hz) / CELL), y1 = Math.floor((p.z + p.hz - 1e-6) / CELL);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { g.blocked[g.idx(x, y)] = 1; if (p.blocksSight) g.sightBlocked[g.idx(x, y)] = 1; }
  }
  const pickups: PickupPlacement[] = [
    {itemId: 'ammo_556', count: 12, x: 23.0, y: FIX.upperY, z: 8.0, area: 2, level: 1},
    {itemId: 'bandage', count: 1, x: 6.5, y: FIX.lowerY, z: 9.0, area: 3, level: 2},
    {itemId: 'ammo_556', count: 8, x: 23.0, y: 0, z: 8.0, area: 0},
  ];
  const zombies: ZombieSpawn[] = [
    {x: 24.0, z: 18.0, yaw: 0, type: 'shambler', area: 2, level: 1, y: FIX.upperY},
    {x: 6.5, z: 16.0, yaw: 0, type: 'shambler', area: 3, level: 2, y: FIX.lowerY},
    {x: 26.0, z: 18.0, yaw: 0, type: 'shambler', area: 1},
  ];
  const light = (x: number, y: number, z: number, a: number, level?: number): LightPlacement => Object.assign({x, y, z, rot: 0, area: a, broken: false, flicker: false, warm: false, power: 1, dying: false}, level ? {level} : {});
  const lights: LightPlacement[] = [
    light(6, FIX.mainCeil - 0.1, 6, 0), light(28, FIX.mainCeil - 0.1, 18, 1), light(23, FIX.underDeckCeil - 0.05, 6, 0),
    light(23, FIX.upperCeil - 0.05, 16, 2, 1), light(6.5, FIX.lowerCeil - 0.05, 12, 3, 2),
  ];

  const areas: Area[] = [
    area(0, {x: FIX.platA.x0, y: FIX.platA.y0, w: 56, h: 16, label: 'Platform 1', platformNo: 1, edge: 'S'}),
    area(1, {x: FIX.platB.x0, y: FIX.platB.y0, w: 56, h: 16, label: 'Platform 2', platformNo: 2, edge: 'N'}),
    area(2, {x: FIX.deck.x0, y: FIX.deck.y0, w: 12, h: 40, kind: 'concourse', type: 'concourse', label: 'Upper concourse', ceil: FIX.upperCeil, floorY: FIX.upperY, level: 1, role: 'upper-concourse' as Area['role']}),
    area(3, {x: FIX.lower.x0, y: FIX.lower.y0, w: 6, h: 40, kind: 'service', type: 'service-corridor', label: 'Service crossing', ceil: FIX.lowerCeil, floorY: FIX.lowerY, level: 2, publicSpace: false, lighting: 'dim', role: 'service-crossing' as Area['role']}),
    area(4, {...FIX.U1, kind: 'passage', type: 'passage', label: 'Stairs up 1', role: 'stair'}),
    area(5, {...FIX.U2, kind: 'passage', type: 'passage', label: 'Stairs up 2', role: 'stair'}),
    area(6, {...FIX.D1, kind: 'passage', type: 'passage', label: 'Stairs down 1', role: 'stair'}),
    area(7, {...FIX.D2, kind: 'passage', type: 'passage', label: 'Stairs down 2', role: 'stair'}),
  ];
  const trench: Trench = {x0: FIX.bed.x0 * CELL, x1: (FIX.bed.x1 + 1) * CELL, z0: FIX.bed.y0 * CELL, z1: (FIX.bed.y1 + 1) * CELL, floorY: FIX.bedY,
    platformX0: FIX.bed.x0 * CELL, platformX1: (FIX.bed.x1 + 1) * CELL, tracks: [11, 13], third: [1, -1], columns: false, ceil: FIX.mainCeil};
  const rails = o.rails === 'none' ? [] : [...new Levels(levels, links).rails] as RailRun[];
  const layout = {
    seed: 80801, attempt: 0, name: 'Fixture Junction', archetype: 'side-mezzanine', towards: ['North', 'South'],
    grid: g0, areas, doors: [], props, lights, signs: [], pickups, zombies, storefronts: [], decor: [],
    playerSpawn: {x: 4, z: 6, yaw: -Math.PI / 2}, trench, trenches: [trench], platform: 0, platforms: [0, 1],
    traversal: {stairs, ladders: [], underpasses: []},
    levels, levelLinks: links, rails, spawnEnd: 'W',
  } as unknown as FixtureLayout;
  void SOLID;
  return layout;
}

/** Fixture stair run endpoints (world): bottom / top stand points of link i (0 U1, 1 U2, 2 D1, 3 D2). */
export function stairEnds(l: FixtureLayout, i: number): {bottom: {x: number; y: number; z: number}; top: {x: number; y: number; z: number}} {
  const k = l.levelLinks[i];
  return {bottom: k.bottom, top: k.top};
}
