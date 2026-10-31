// Task track3-eaton-centre-20261031 (lane HORDE): a fully SYNTHETIC ring "mall" for the roaming-horde tests (independent of the
// mall generator, which lane GEN builds in parallel). Same conventions as tests/helpers/towerFixture.ts: every storey grid has the
// main grid's size / origin, all y absolute, each stair run carved identically into BOTH grids it joins with ONE shared ramps array.
//
//   storeys   0 = the "pit" floor (plaza under the void; ceiling 4 m except over the void, which is open to the top), 1..N-1 rings
//             at y = 5 L (clear 4 m; 1 m slabs). A ring = the OUTER rect minus the VOID rect (SOLID on the ring grids, while the
//             storey-0 band rises through it: sight across / down the void works). Default (compact): outer cells x 4..83, y 8..35
//             (40 x 14 m) round a void x 24..63, y 16..27 (20 x 6 m): 4 m long galleries, 10 m end courts. `wide`: outer x 4..203,
//             y 14..81 (100 x 34 m) round a void x 30..177, y 26..69 (74 x 22 m): 6 m galleries, 13 m courts, 28 m across the void.
//             Void edges on the rings are derived railings (drops > RAIL_DROP; no explicit rail list).
//   south     the wall row under the outer rect; a 4-cell doorway onto the storey's stair landing (storey L: west landing for even
//             L, east for odd L), then a SCISSOR STAIR (as the tower fixture): lane A (3 rows, rises west -> east) for even L, a
//             divider row, lane B (3 rows, rises east -> west) for odd L; runs of 18 cells (9 m) between the landings.
// Patrol graph (MallPatrolNode): gallery nodes round the void (~10 m apart, 'gallery' edges in a loop), a stair node in front of
// each storey's doorway (joined to its two gallery neighbours) and 'stair' edges S_L <-> S_(L+1) over the real runs.

import {CELL, FLOOR, Grid, rampHeight, type Ramp} from '../../src/gen/grid';
import type {Level, LevelLink, LevelRole} from '../../src/gen/levels';
import type {Area, StationLayout, Trench} from '../../src/gen/station';
import type {MallPatrolNode} from '../../src/gen/mall/mallTypes';

interface Dims { W: number; H: number; outer: {x0: number; x1: number; y0: number; y1: number}; void: {x0: number; x1: number; y0: number; y1: number}; stairX: number }
const COMPACT: Dims = {W: 100, H: 48, outer: {x0: 4, x1: 83, y0: 8, y1: 35}, void: {x0: 24, x1: 63, y0: 16, y1: 27}, stairX: 18};
const WIDE: Dims = {W: 212, H: 96, outer: {x0: 4, x1: 203, y0: 14, y1: 81}, void: {x0: 30, x1: 177, y0: 26, y1: 69}, stairX: 40};

export const RING = {storeyH: 5, clear: 4, laneRows: 3, runCells: 18, landingCells: 4} as const;

export const ringY = (L: number): number => L * RING.storeyH;

export interface RingMallFixture {
  layout: StationLayout;
  levels: Level[];
  links: LevelLink[];
  patrol: MallPatrolNode[];
  /** Gallery node ids per storey (loop order) and each storey's stair node id. */
  gallery: number[][];
  stairNode: number[];
  storeys: number;
  dims: Dims;
}

const w = (c: number) => (c + 0.5) * CELL;
type Via = MallPatrolNode['edges'][number]['via'];

export function ringMallFixture(opts: {storeys?: number; wide?: boolean; extraEdges?: [number, number, Via][]} = {}): RingMallFixture {
  const D = opts.wide ? WIDE : COMPACT;
  const {W, H} = D;
  const N = opts.storeys ?? 3;
  const top = ringY(N - 1) + RING.clear + 6;
  const grids = Array.from({length: N}, () => new Grid(W, H));
  const ramps: Ramp[] = [];
  for (const g of grids) g.ramps = ramps;
  const areas: Area[] = [];
  const area = (r: {x: number; y: number; w: number; h: number}, L: number, kind: Area['kind'], type: Area['type'], label: string): Area => {
    const a = {...r, id: areas.length, kind, type, label, ceil: ringY(L) + RING.clear, parent: -1, depth: 0, publicSpace: true, lighting: 'lit', level: L} as Area;
    if (L !== 0) a.floorY = ringY(L);
    areas.push(a);
    return a;
  };
  const O = D.outer, V = D.void;
  const wallRow = O.y1 + 1, laneA = wallRow + 1, laneB = laneA + RING.laneRows + 1, stairEnd = laneB + RING.laneRows;
  const west = {x0: D.stairX, x1: D.stairX + RING.landingCells};
  const lane = {x0: west.x1, x1: west.x1 + RING.runCells};
  const east = {x0: lane.x1, x1: lane.x1 + RING.landingCells};
  const landingOf = (L: number) => (L % 2 === 0 ? west : east);
  const inVoid = (x: number, y: number) => x >= V.x0 && x <= V.x1 && y >= V.y0 && y <= V.y1;
  const stairArea: number[] = [];
  for (let L = 0; L < N; L++) {
    const g = grids[L], y0 = ringY(L), c0 = y0 + RING.clear;
    const ring = area({x: O.x0, y: O.y0, w: O.x1 - O.x0 + 1, h: O.y1 - O.y0 + 1}, L, L === 0 ? 'concourse' : 'passage', 'concourse', L === 0 ? 'pit plaza' : `ring ${L} gallery`);
    for (let y = O.y0; y <= O.y1; y++) for (let x = O.x0; x <= O.x1; x++) {
      if (L > 0 && inVoid(x, y)) continue; // the void: SOLID on the ring grids
      const i = y * W + x;
      g.cells[i] = FLOOR; g.floor[i] = y0; g.area[i] = ring.id;
      g.ceil[i] = L === 0 && inVoid(x, y) ? top : c0; // the pit's band rises through the void to the top
    }
    const S = area({x: west.x0, y: wallRow, w: east.x1 - west.x0, h: stairEnd - wallRow}, L, 'passage', 'office-stair', `stair ${L}`);
    stairArea.push(S.id);
    const end = landingOf(L);
    for (let y = wallRow; y < stairEnd; y++) for (let x = end.x0; x < end.x1; x++) {
      const i = y * W + x;
      g.cells[i] = FLOOR; g.floor[i] = y0; g.ceil[i] = y0 + 3; g.area[i] = S.id;
    }
  }
  const links: LevelLink[] = [];
  const zMid = (row: number) => (row + RING.laneRows / 2) * CELL;
  for (let L = 0; L + 1 < N; L++) {
    const isA = L % 2 === 0, row = isA ? laneA : laneB;
    const xs = lane.x0 * CELL, xe = lane.x1 * CELL;
    const [s0, s1] = isA ? [xs, xe] : [xe, xs];
    const r: Ramp = {x: lane.x0, y: row, w: lane.x1 - lane.x0, h: RING.laneRows, axis: 'x', s0, s1, h0: ringY(L), h1: ringY(L + 1), risers: 28, headroom: 2.5};
    const id = ramps.length;
    ramps.push(r);
    for (const g of [grids[L], grids[L + 1]]) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x;
      g.cells[i] = FLOOR; g.area[i] = stairArea[L]; g.rampIdx[i] = id;
      g.floor[i] = rampHeight(r, (x + 0.5) * CELL);
      g.ceil[i] = Math.max(rampHeight(r, x * CELL), rampHeight(r, (x + 1) * CELL)) + r.headroom;
    }
    links.push({id, kind: 'stairs', lower: L, upper: L + 1, ramp: id,
      bottom: {x: isA ? xs - 0.6 : xe + 0.6, y: ringY(L), z: zMid(row)}, top: {x: isA ? xe + 0.6 : xs - 0.6, y: ringY(L + 1), z: zMid(row)}});
  }
  // patrol graph: a loop of gallery nodes (~10 m apart) round the void, a stair node per storey
  const xW = w((O.x0 + V.x0 - 1) / 2), xE = w((V.x1 + 1 + O.x1) / 2), zN = w((O.y0 + V.y0 - 1) / 2), zS = w((V.y1 + 1 + O.y1) / 2), zM = w((V.y0 + V.y1) / 2);
  const span = (a: number, b: number) => { const n = Math.max(2, Math.round(Math.abs(b - a) / 10)); return Array.from({length: n + 1}, (_, i) => a + (b - a) * i / n); };
  const loop: [number, number][] = [
    ...span(xW, xE).map(x => [x, zN] as [number, number]),
    ...span(zN, zS).slice(1).map(z => [xE, z] as [number, number]),
    ...span(xE, xW).slice(1).map(x => [x, zS] as [number, number]),
    ...span(zS, zN).slice(1, -1).map(z => [xW, z] as [number, number]),
  ];
  void zM;
  type Mut = {id: number; level: number; x: number; z: number; edges: {to: number; via?: Via}[]};
  const nodes: Mut[] = [];
  const edge = (a: number, b: number, via: Via) => { nodes[a].edges.push({to: b, via}); nodes[b].edges.push({to: a, via}); };
  const gallery: number[][] = [], stairNode: number[] = [];
  for (let L = 0; L < N; L++) {
    const ids = loop.map(([x, z]) => { const id = nodes.length; nodes.push({id, level: L, x, z, edges: []}); return id; });
    gallery.push(ids);
    for (let k = 0; k < ids.length; k++) edge(ids[k], ids[(k + 1) % ids.length], 'gallery');
    const end = landingOf(L), sx = (end.x0 + end.x1) / 2 * CELL, sz = w(O.y1 - 1);
    const sid = nodes.length;
    nodes.push({id: sid, level: L, x: sx, z: sz, edges: []});
    stairNode.push(sid);
    // join the stair node to the two nearest south-gallery nodes
    const south = ids.filter(id => Math.abs(nodes[id].z - zS) < 1e-6).sort((a, b) => Math.abs(nodes[a].x - sx) - Math.abs(nodes[b].x - sx)).slice(0, 2);
    for (const id of south) edge(sid, id, 'gallery');
  }
  for (let L = 0; L + 1 < N; L++) edge(stairNode[L], stairNode[L + 1], 'stair');
  for (const [a, b, via] of opts.extraEdges ?? []) edge(a, b, via);
  const levels: Level[] = grids.map((grid, L) => ({id: L, role: (L === 0 ? 'main' : 'upper') as LevelRole, grid, baseY: ringY(L)}));
  const trench: Trench = {x0: 0, x1: 0, z0: 0, z1: 0, floorY: -1.15, platformX0: 0, platformX1: 0, tracks: [], third: [], columns: false, ceil: 0};
  const layout = {
    seed: 4242, attempt: 0, name: 'Ring mall fixture', archetype: 'side-mezzanine', towards: ['North', 'South'],
    grid: grids[0], areas, doors: [], props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: w(O.x0 + 4), z: w((V.y0 + V.y1) / 2), yaw: 0}, trench, trenches: [], platform: 0, platforms: [],
    traversal: {stairs: [], ladders: [], underpasses: []},
    levels, levelLinks: links,
  } as unknown as StationLayout;
  return {layout, levels, links, patrol: nodes, gallery, stairNode, storeys: N, dims: D};
}
