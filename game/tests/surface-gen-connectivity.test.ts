// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN district CONNECTIVITY — on foot (the game's multi-level
// nav flood from the portal: every core destination's doorway and street-storey rooms, the tent, the truck) and for the truck (a 1.4 m
// clearance disc over open, unblocked, near-flat street-level ground, pending props counted as obstacles: the depot yard and loading
// door, the perimeter roads and nearly every street; blocked spans stop it while their foot gaps stay walkable).
import {beforeAll, describe, expect, it} from 'vitest';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {generateSurfaceDistrict, setSurfaceGenDebug, surfaceGenDebug} from '../src/gen/surface/index';
import type {SurfaceHost} from '../src/gen/surface/surfaceRun';
import type {SRect} from '../src/gen/surface/surfaceTypes';
import {footFlood, vehicleFlood, vehicleReachesRect, type VehicleFlood} from '../src/gen/surface/cityCheck';

const CASES: [number, SurfaceHost][] = [[3, 'subway'], [8, 'office'], [13, 'mall'], [21, 'subway'], [34, 'office'], [55, 'mall']];

interface Run { seed: number; L: StationLayout; foot: Int32Array[]; veh: VehicleFlood }
const runs: Run[] = [];
beforeAll(() => {
  setSurfaceGenDebug(true);
  for (const [seed, host] of CASES) {
    const L = generateSurfaceDistrict(host, {levelSeed: seed});
    const s = L.surface!;
    const dbg = surfaceGenDebug(L)!;
    runs.push({seed, L, foot: footFlood(L, s.portal.pose.x, s.portal.pose.z, 0), veh: vehicleFlood(L, s.truck.x, s.truck.z, new Set(s.outdoorAreas), {radius: 1.4, extra: dbg.taken})});
  }
}, 600000);

const cellsOf = (L: StationLayout, r: SRect): number[] => {
  const g = L.grid, out: number[] = [];
  for (let y = Math.floor(r.z0 / CELL); y < Math.ceil(r.z1 / CELL); y++) for (let x = Math.floor(r.x0 / CELL); x < Math.ceil(r.x1 / CELL); x++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
  return out;
};

describe('Surface district on foot', () => {
  it('every core destination (doorway and street-storey rooms), the tent, the map reader and the truck are reachable from the portal', () => {
    for (const {seed, L, foot} of runs) {
      const s = L.surface!, g = L.grid;
      const at = (x: number, z: number, lv = 0) => foot[lv][g.idx(Math.floor(x / CELL), Math.floor(z / CELL))] >= 0;
      for (const b of s.buildings.filter(q => q.destination)) {
        const door = b.entrances.filter(e => e.door !== 'boarded').some(e => e.cells.some(c => foot[0][c] >= 0));
        expect(door, `seed ${seed}: ${b.name} doorway`).toBe(true);
        for (const id of b.areas) {
          const a = L.areas[id];
          if ((a.level ?? 0) !== 0) continue;
          let any = false;
          for (let y = a.y; y < a.y + a.h && !any; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.area[g.idx(x, y)] === id && foot[0][g.idx(x, y)] >= 0) { any = true; break; }
          expect(any, `seed ${seed}: ${b.name} room ${a.label}`).toBe(true);
        }
      }
      expect(at(s.checkpoint.mapTable.read.x, s.checkpoint.mapTable.read.z)).toBe(true);
      expect(at(s.truck.x + 3, s.truck.z) || at(s.truck.x - 3, s.truck.z) || at(s.truck.x, s.truck.z + 3) || at(s.truck.x, s.truck.z - 3)).toBe(true);
      for (const id of s.buildings.find(b => b.host === 'tent')!.areas) {
        const a = L.areas[id];
        expect(at((a.x + a.w / 2) * CELL, (a.y + a.h / 2) * CELL)).toBe(true);
      }
      // the subway headhouse's grille (the way back down) is reachable at the foot of its stair
      if (s.host === 'subway') {
        const t = s.portal.trigger;
        expect(cellsOf(L, t).some(c => foot[0][c] >= 0), `seed ${seed}: grille`).toBe(true);
      }
    }
  });

  it('a blocked span keeps a walkable foot gap: both ends of every pile-up are reachable on foot', () => {
    for (const {seed, L, foot} of runs) {
      const s = L.surface!;
      for (const r of s.rubble!.filter(q => q.kind === 'pile-up')) {
        const st = s.streets[r.street!];
        const nsRun = st.ax === st.bx;
        const before: SRect = nsRun ? {...r, z0: r.z0 - 2, z1: r.z0 - 0.5} : {...r, x0: r.x0 - 2, x1: r.x0 - 0.5};
        const after: SRect = nsRun ? {...r, z0: r.z1 + 0.5, z1: r.z1 + 2} : {...r, x0: r.x1 + 0.5, x1: r.x1 + 2};
        expect(cellsOf(L, before).some(c => foot[0][c] >= 0), `seed ${seed} ${st.name}`).toBe(true);
        expect(cellsOf(L, after).some(c => foot[0][c] >= 0), `seed ${seed} ${st.name}`).toBe(true);
      }
    }
  });
});

describe('Surface district by truck', () => {
  it('leaves the compound and reaches the depot yard, its loading door and the outer ring', () => {
    for (const {seed, L, veh} of runs) {
      const s = L.surface!, W = L.grid.w;
      const lots = s.lots!;
      const dep = s.buildings[s.depot.building];
      const depotLots = lots.filter(l => l.block === dep.block && (l.use === 'loading' || l.use === 'yard'));
      expect(depotLots.length).toBe(2);
      for (const l of depotLots) expect(vehicleReachesRect(veh, W, l.rect), `seed ${seed}: ${l.label}`).toBe(true);
      // close to every depot doorway (the track door / the loading door)
      for (const e of dep.entrances.filter(q => q.width >= 4.5)) expect(vehicleReachesRect(veh, W, {x0: e.x - 5, z0: e.z - 5, x1: e.x + 5, z1: e.z + 5}), `seed ${seed} depot door`).toBe(true);
      const outside = cellsOf(L, s.checkpoint.rect);
      const inCompound = new Set(outside);
      let escaped = false;
      for (let i = 0; i < veh.reach.length && !escaped; i++) if (veh.reach[i] && !inCompound.has(i)) escaped = true;
      expect(escaped).toBe(true);
      // the perimeter roads (outermost street centre lines) and >= 90 % of all street segments
      const xs = s.streets.filter(q => q.rank !== 'lane' && q.ax === q.bx).map(q => q.ax), zs = s.streets.filter(q => q.rank !== 'lane' && q.az === q.bz).map(q => q.az);
      const perim = s.streets.filter(q => q.rank !== 'lane' && ((q.ax === q.bx && (q.ax === Math.min(...xs) || q.ax === Math.max(...xs))) || (q.az === q.bz && (q.az === Math.min(...zs) || q.az === Math.max(...zs)))));
      expect(perim.length).toBeGreaterThanOrEqual(16);
      const seg = (q: typeof s.streets[number]): SRect => (q.ax === q.bx
        ? {x0: q.ax - q.width / 2, x1: q.ax + q.width / 2, z0: q.az, z1: q.bz} : {x0: q.ax, x1: q.bx, z0: q.az - q.width / 2, z1: q.az + q.width / 2});
      for (const q of perim) expect(vehicleReachesRect(veh, W, seg(q)), `seed ${seed}: perimeter ${q.name}`).toBe(true);
      const roads = s.streets.filter(q => q.rank !== 'lane');
      const hit = roads.filter(q => vehicleReachesRect(veh, W, seg(q))).length;
      expect(hit / roads.length, `seed ${seed}`).toBeGreaterThan(0.9);
    }
  });

  it('cannot cross a blocked span (the mound and its foot gaps are narrower than the truck)', () => {
    for (const {seed, L, veh} of runs) {
      const s = L.surface!, W = L.grid.w;
      const spans = s.rubble!.filter(q => q.kind === 'pile-up');
      expect(spans.length).toBeGreaterThanOrEqual(3);
      for (const r of spans) {
        const st = s.streets[r.street!];
        const band: SRect = st.ax === st.bx ? {...r, x0: r.x0 - 1.0, x1: r.x1 + 1.0} : {...r, z0: r.z0 - 1.0, z1: r.z1 + 1.0};
        expect(vehicleReachesRect(veh, W, band), `seed ${seed}: ${st.name}`).toBe(false);
        expect(st.blocked?.length).toBeGreaterThan(0);
      }
    }
  });
});
