// Task reactor-expansion-20261101 (lane MINES): an isolated FIXTURE for the mines complex (until lane HOST's slot lands): a 3-storey
// Kit, a pit-side deck on storey 2 (tier 2), a free rock region behind the pit wall and the entrance span between them — in any of the
// four inward directions — then the crop / station dresser / mines dress / lighting pipeline of gen/reactor/index.ts in miniature.
import {Rng} from '../src/core/rng';
import {Kit} from '../src/gen/stationKit';
import {cropKit, dummyTrench} from '../src/gen/office/common';
import {applyLighting, dress} from '../src/gen/stationDress';
import type {Level} from '../src/gen/levels';
import type {Area, Rect, StationLayout} from '../src/gen/stationTypes';
import type {ComplexSlot} from '../src/gen/reactor/complex/types';
import {carveMines, type MinesCarve} from '../src/gen/reactor/complex/mines';
import type {MinePlan} from '../src/gen/reactor/complex/minesPlan';

export const FIX = {W: 230, H: 220, level: 2, baseY: -12, ceilMax: -6.3, deckDepth: 8} as const;

export interface MinesFixture { k: Kit; slot: ComplexSlot; deck: Area; carve: MinesCarve | null }

/**
 * A fixture slot: region `lat` x `depth` cells (lateral x depth, the entrance row = the region's pit-side edge row unless `gap`), the
 * entrance `ew` cells wide at lateral offset `eo` (fraction 0..1 of the free span), a deck `deckDepth` deep in front of it.
 */
export function minesFixture(seed: number, o: {inward?: ComplexSlot['inward']; lat?: number; depth?: number; ew?: number; eo?: number; gap?: boolean; ceilMax?: number} = {}): MinesFixture {
  const inward = o.inward ?? 'S', lat = o.lat ?? 80, depth = o.depth ?? 64, ew = o.ew ?? 6, eo = o.eo ?? 0.5;
  const k = new Kit(new Rng(seed), {levels: 3, w: FIX.W, h: FIX.H});
  const lv = {level: FIX.level, floorY: FIX.baseY};
  const x0 = 40, y0 = 40, D = FIX.deckDepth;
  const eu = Math.round(1 + (lat - ew - 2) * eo);
  let region: Rect, deckR: Rect, entrance: Rect;
  // the region's first row is the pit wall (entrance row) unless `gap` (then the region starts right behind the wall)
  const g = o.gap ? 1 : 0;
  switch (inward) {
    case 'S': deckR = {x: x0 - 6, y: y0, w: lat + 12, h: D}; entrance = {x: x0 + eu, y: y0 + D, w: ew, h: 1}; region = {x: x0, y: y0 + D + g, w: lat, h: depth}; break;
    case 'N': region = {x: x0, y: y0, w: lat, h: depth}; entrance = {x: x0 + eu, y: y0 + depth - 1 + g, w: ew, h: 1}; deckR = {x: x0 - 6, y: y0 + depth + g, w: lat + 12, h: D}; break;
    case 'E': deckR = {x: x0, y: y0 - 6, w: D, h: lat + 12}; entrance = {x: x0 + D, y: y0 + eu, w: 1, h: ew}; region = {x: x0 + D + g, y: y0, w: depth, h: lat}; break;
    default: region = {x: x0, y: y0, w: depth, h: lat}; entrance = {x: x0 + depth - 1 + g, y: y0 + eu, w: 1, h: ew}; deckR = {x: x0 + depth + g, y: y0 - 6, w: D, h: lat + 12}; break;
  }
  const deck = k.addArea(deckR, 'concourse', 'concourse', 15, -1, {...lv, label: 'Generator landing · Tier 2', publicSpace: false, role: 'reactor-landing'});
  const slot: ComplexSlot = {id: 'mines', zone: 1, level: FIX.level, baseY: FIX.baseY, region, entrance, frontArea: deck.id, inward, ceilMax: o.ceilMax ?? FIX.ceilMax};
  const carve = carveMines({k, rng: new Rng(seed ^ 0x5eed), slot, levelOpt: {level: FIX.level}});
  return {k, slot, deck, carve};
}

/** The fixture through crop (origin 0, 0) + ONE station dresser pass + the mines dress hook + applyLighting (index.ts order). */
export function minesLayout(fx: MinesFixture, seed: number): StationLayout {
  const {k} = fx;
  const c = cropKit(k, [0, 1, 2], 0, 0, FIX.W, FIX.H);
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: [0, -6, FIX.baseY][id]}));
  const layout: StationLayout = {
    seed, attempt: 0, name: 'Mines fixture', archetype: 'side-mezzanine', towards: ['A', 'B'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [], playerSpawn: {x: 0, z: 0, yaw: 0},
    trench: dummyTrench(), trenches: [], platform: -1, platforms: [], traversal: {stairs: [], ladders: [], underpasses: []}, levels, levelLinks: [], rails: [],
  };
  const rng = new Rng(seed);
  dress(layout, rng.fork('dress'));
  fx.carve?.dress?.(layout, rng.fork('mines-dress'), {ox: 0, oy: 0});
  applyLighting(layout, rng.fork('lighting'));
  return layout;
}

/**
 * Task reactor-playtest-round2-20261102 (lane MINES): a plan's TOPOLOGY signature — the adit, the haulage course, where the cavern sits
 * and the multiset of openings by part pair (sizes / positions ignored): two plans with the same signature are the same mine graph.
 */
export function mineSignature(plan: MinePlan): string {
  const part = new Map(plan.rooms.map(r => [r.key, r.part]));
  const edges = plan.doors.filter(d => d.a).map(d => [part.get(d.a!)!, part.get(d.b)!].sort().join('-')).sort();
  return [plan.shape.adit, plan.shape.course, plan.shape.cavern, edges.join(',')].join('|');
}

/** The plan's space graph: node keys, internal openings (a, b), adjacency. */
export function mineGraph(plan: MinePlan): {nodes: string[]; edges: [string, string][]; adj: Map<string, string[]>} {
  const nodes = plan.rooms.map(r => r.key), edges = plan.doors.filter(d => d.a).map(d => [d.a!, d.b] as [string, string]);
  const adj = new Map(nodes.map(k => [k, [] as string[]]));
  for (const [a, b] of edges) { adj.get(a)!.push(b); adj.get(b)!.push(a); }
  return {nodes, edges, adj};
}

/** Graph distance (openings) from `from` to every space. */
export function mineHops(plan: MinePlan, from: string): Map<string, number> {
  const {adj} = mineGraph(plan), dist = new Map([[from, 0]]), q = [from];
  for (let h = 0; h < q.length; h++) for (const n of adj.get(q[h]) ?? []) if (!dist.has(n)) { dist.set(n, dist.get(q[h])! + 1); q.push(n); }
  return dist;
}
