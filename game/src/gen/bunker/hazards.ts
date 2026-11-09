// Task studio-bunker-level-20261109-072224-01: THE BUNKER's local HAZARDS — gas leaks, damp sections, aged / broken-down wings. Pure data.
//
// GAS: 3-6 local leaks (layout.bunker.gasZones: a seed set of cells on one storey's grid + a strength 0..1 of the gas field's cap),
// seeded per programme: the isolation ward (storey 3, MEDIUM), the damaged maintenance section (storey 4, STRONG: a dead-end plant
// room off a corridor), a habitation corridor (storey 2, WEAK: a ruptured line along its ceiling), then a seeded subset of the
// cooling plant (storey 5, weak / medium), the decontamination room (storey 1, weak), a services workshop (storey 3, weak). The runtime
// (world/gas/system.ts zone sources) seeds them into the ONE gas field — the visible green volumetric fog, the exposure DPS, mask /
// filter protection and the HUD all read that field. A strong leak is never in a corridor, a hall, a plant room with a generator, the
// core hall or a stairwell, and its room is a dead end (one doorway): the clean routes to every generator and the core never cross it.
// DAMP: the water-damaged maintenance storey's pump hall, water treatment and generator #3's plant room (+ the storey's aged rooms):
// its level role 'lower' (world/decay.ts: more leaks, seepage, neglect) and the Strainer's habitat (the 'damp' spawn context).
// AGED: one collapsed / aged wing of the habitation storey (the rooms farthest from the main stair), the damaged section of the
// maintenance storey round the strong leak: dark / flickering, fallen ceiling panels (gen/bunker/dress.ts), more neglect.

import type {Rng} from '../../core/rng';
import {FLOOR} from '../grid';
import type {StationLayout} from '../stationTypes';
import type {BunkerGasZone} from './bunkerTypes';
import type {BunkerCarve, StoreyCarve} from './carve';
import type {ObjectiveRec} from './dress';

/** Strength bands (fraction of the gas field's cap; the exposure's damage threshold is 0.12). */
export const GAS_STRENGTH = {weak: [0.26, 0.34] as const, medium: [0.5, 0.62] as const, strong: [0.86, 0.95] as const};
/** A zone at or above this strength is STRONG (routes to the objectives never cross it). */
export const GAS_STRONG = 0.8;

export interface BunkerHazards {
  gasZones: BunkerGasZone[];
  damp: number[];
  aged: Set<number>;
}

/** Doorways of area `id` (door count). */
const doorsOf = (layout: StationLayout, id: number) => layout.doors.filter(d => d.a === id || d.b === id);

/** A compact seed block of `n x n` cells of area `id` on storey `lv` (the room's cell farthest from its doors). */
function seedCells(layout: StationLayout, lv: number, id: number, n: number): number[] {
  const a = layout.areas[id], g = layout.levels[lv].grid;
  const ds = doorsOf(layout, id).map(d => [d.x + d.w / 2, d.y + d.h / 2]);
  let best: [number, number] | null = null, bd = -1;
  for (let y = a.y + 1; y + n <= a.y + a.h - 1; y++) for (let x = a.x + 1; x + n <= a.x + a.w - 1; x++) {
    let ok = true;
    for (let yy = y; yy < y + n && ok; yy++) for (let xx = x; xx < x + n; xx++) { const i = g.idx(xx, yy); if (g.cells[i] !== FLOOR || g.area[i] !== id) { ok = false; break; } }
    if (!ok) continue;
    const d = Math.min(...ds.map(([dx, dy]) => Math.hypot(dx - x - n / 2, dy - y - n / 2)), 1e9);
    if (d > bd) { bd = d; best = [x, y]; }
  }
  if (!best) return [];
  const out: number[] = [];
  for (let yy = best[1]; yy < best[1] + n; yy++) for (let xx = best[0]; xx < best[0] + n; xx++) out.push(g.idx(xx, yy));
  return out;
}

/** A line of seed cells along the middle of a corridor (a ruptured ceiling line). */
function corridorSeed(layout: StationLayout, lv: number, id: number, rng: Rng): number[] {
  const a = layout.areas[id], g = layout.levels[lv].grid, horiz = a.w >= a.h, len = horiz ? a.w : a.h;
  if (len < 10) return [];
  const t0 = rng.int(2, len - 8), out: number[] = [];
  for (let t = t0; t < t0 + 5; t++) {
    const x = horiz ? a.x + t : a.x + Math.floor(a.w / 2), y = horiz ? a.y + Math.floor(a.h / 2) : a.y + t;
    const i = g.idx(x, y);
    if (g.cells[i] === FLOOR && g.area[i] === id) out.push(i);
  }
  return out;
}

const pick = (rng: Rng, [lo, hi]: readonly [number, number]) => Math.round(rng.range(lo, hi) * 100) / 100;

/** The hazards of a carved, objective-placed layout (before the dresser: the aged rooms are lit / decorated by later passes). */
export function planHazards(layout: StationLayout, bc: BunkerCarve, obj: ObjectiveRec, rng: Rng, dist: Int32Array[]): BunkerHazards {
  const zones: BunkerGasZone[] = [];
  const aged = new Set<number>();
  const st = (lv: number) => bc.storeys.find(s => s.level === lv)!;
  const genAreas = new Set(obj.generators.map(gr => gr.area));
  const add = (id: string, lv: number, cells: number[], strength: number) => { if (cells.length) zones.push({id, level: lv, cells, strength}); };
  const isRoom = (s: StoreyCarve, key: string) => !['muster', 'lobbyB', 'spine'].includes(key) && layout.areas[s.area[key]]?.kind === 'room';
  // 1. the isolation ward (storey 3): medium
  { const s = st(3), id = s.area.isolation; if (id !== undefined) add('isolation-ward', 3, seedCells(layout, 3, id, 3), pick(rng, GAS_STRENGTH.medium)); }
  // 2. the damaged maintenance section (storey 4): STRONG, in a dead-end plant room (the boiler room preferred), its neighbours aged
  {
    const s = st(4);
    const cands = Object.entries(s.area).filter(([k, id]) => isRoom(s, k) && !genAreas.has(id) && k !== 'hall' && doorsOf(layout, id).length === 1)
      .sort((p, q) => +(q[0] === 'boiler') - +(p[0] === 'boiler') || (dist[4][centreCell(layout, 4, q[1])] ?? 0) - (dist[4][centreCell(layout, 4, p[1])] ?? 0));
    const c = cands[0];
    if (c) {
      add('maintenance-collapse', 4, seedCells(layout, 4, c[1], 4), pick(rng, GAS_STRENGTH.strong));
      aged.add(c[1]);
      // the corridor it opens onto and one more dead-end room beside it read as the same damaged section
      const d = doorsOf(layout, c[1])[0];
      const other = d ? (d.a === c[1] ? d.b : d.a) : -1;
      if (other >= 0 && layout.areas[other]?.kind !== 'room') aged.add(other);
    }
  }
  // 3. a habitation corridor (storey 2): weak
  {
    const s = st(2);
    const corr = Object.entries(s.area).filter(([k, id]) => k.startsWith('corr') && layout.areas[id].kind === 'service');
    const c = corr.length ? rng.pick(corr) : (['spine', s.area.spine] as [string, number]);
    add('habitation-line', 2, corridorSeed(layout, 2, c[1], rng), pick(rng, GAS_STRENGTH.weak));
  }
  // 4-6: a seeded subset (never a generator room / the core hall)
  { const s = st(5), id = s.area.cooling; if (id !== undefined && rng.chance(0.7)) add('coolant-leak', 5, seedCells(layout, 5, id, 3), pick(rng, rng.chance(0.5) ? GAS_STRENGTH.weak : GAS_STRENGTH.medium)); }
  { const s = st(1), id = s.area.decon; if (id !== undefined && rng.chance(0.45)) add('decon-residue', 1, seedCells(layout, 1, id, 2), pick(rng, GAS_STRENGTH.weak)); }
  { const s = st(3), id = s.area.workshop; if (id !== undefined && zones.length < 6 && rng.chance(0.4)) add('workshop-cylinder', 3, seedCells(layout, 3, id, 2), pick(rng, GAS_STRENGTH.weak)); }
  // DAMP: the maintenance storey's wet plant
  const damp: number[] = [];
  {
    const s = st(4);
    for (const [k, id] of Object.entries(s.area)) {
      const p = layout.areas[id].purpose;
      if (k === 'hall' || p === 'pump-room' || genAreas.has(id) || (aged.has(id) && layout.areas[id].kind === 'room')) damp.push(id);
    }
  }
  // AGED: the habitation storey's far wing (the 3 rooms farthest from the main stair, never the plant room / mess / kitchen)
  {
    const s = st(2), skip = new Set(['genroom', 'mess', 'kitchen', 'rations']);
    const rooms = Object.entries(s.area).filter(([k]) => isRoom(s, k) && !skip.has(k)).map(([, id]) => ({id, d: dist[2][centreCell(layout, 2, id)] ?? -1})).filter(r => r.d >= 0);
    rooms.sort((p, q) => q.d - p.d || p.id - q.id);
    for (const r of rooms.slice(0, 3)) aged.add(r.id);
  }
  return {gasZones: zones, damp: damp.sort((a, b) => a - b), aged};
}

/** A walkable cell near the area's centre (its distance-field sample). */
export function centreCell(layout: StationLayout, lv: number, id: number): number {
  const a = layout.areas[id], g = layout.levels[lv].grid;
  const cx = a.x + Math.floor(a.w / 2), cy = a.y + Math.floor(a.h / 2);
  for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!g.inBounds(x, y)) continue;
    const i = g.idx(x, y);
    if (g.cells[i] === FLOOR && g.area[i] === id && !g.blocked[i]) return i;
  }
  return g.idx(cx, cy);
}
