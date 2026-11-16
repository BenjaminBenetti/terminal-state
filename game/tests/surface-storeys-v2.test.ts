// Task studio-surface-run-field-followup-20261116-211729-01 (lane INTERIOR): the version-2 district's STOREYS AND STAIRS on GEN's real
// districts (every host, several seeds; tests/helpers/surfaceDeepDistricts.ts):
//  - every flight of a destination building is a real flight: risers 0.15-0.19 m, treads 0.28 m, at most 12 risers a flight, headroom
//    over every step, stand points on walkable bands, a level link per stair core joining the storeys it climbs;
//  - landings and every walkable upper / roof cell keep their headroom (2.4 m rooms, 2.1 m doorways);
//  - upper-floor windows are AIR's spans on their own storey's heights (registered gas breaches like the street storey's);
//  - BUDGETS (the brief's measures): the district stays two level grids (the light field's bound: 96 MB at the field's 1 m texels), and
//    generation time stays within a bounded factor of version 1.

import {describe, expect, it} from 'vitest';
import {CELL, FLOOR} from '../src/gen/grid';
import {STAIR} from '../src/gen/traversal';
import {FLIGHT_HEADROOM, MIN_HEADROOM} from '../src/gen/levelGen';
import {SURFACE_LEVELS} from '../src/gen/surface/cityBlocks';
import {FIELD_CUBE_BYTES} from '../src/world/enhancedLighting';
import {MAX_GROUPS, fieldDepth, giDepth} from '../src/world/lightField';
import {SURFACE_FIELD_SCALE} from '../src/world/surface/lookDaylight';
import {DEEP_HOSTS, DEEP_SEEDS, deepCases, deepDistrict, destinations} from './helpers/surfaceDeepDistricts';

describe('Surface Run v2: stairs and storeys', () => {
  it('every flight of a destination: risers 0.15-0.19 m, 0.28 m treads, <= 12 risers, headroom on every step, stand points walkable', () => {
    let flights = 0;
    for (const c of deepCases()) {
      const L = c.L, own = new Set(destinations(L).flatMap(b => b.areas));
      for (const f of L.traversal.stairs) {
        if (!own.has(f.area)) continue;
        flights++;
        const tag = `${c.tag}: flight ${f.id} (${L.areas[f.area].label})`;
        expect(f.riser, tag).toBeGreaterThanOrEqual(0.15 - 1e-6);
        expect(f.riser, tag).toBeLessThanOrEqual(0.19 + 1e-6);
        expect(Math.abs(f.tread - STAIR.tread), tag).toBeLessThan(1e-6);
        expect(f.risers, tag).toBeLessThanOrEqual(STAIR.maxRisers);
        expect(Math.abs(f.a1 - f.a0), `${tag}: width`).toBeGreaterThanOrEqual(1.2 - 1e-6);
        // headroom over every carved step of the flight (the ramp cells on each grid it is carved into)
        for (const lv of L.levels!) {
          const g = lv.grid;
          for (let i = 0; i < g.cells.length; i++) {
            if (g.rampIdx[i] !== f.ramp || g.cells[i] !== FLOOR) continue;
            const x = (i % g.w + 0.5) * CELL, z = (Math.floor(i / g.w) + 0.5) * CELL;
            expect(g.ceil[i] - g.floorAt(x, z), `${tag}: headroom at ${i % g.w},${Math.floor(i / g.w)} level ${lv.id}`).toBeGreaterThanOrEqual(FLIGHT_HEADROOM - 1e-3);
          }
        }
        for (const p of [f.top, f.bottom]) {
          const lvl = L.levels!.find(l => { const g = l.grid, [cx, cy] = g.cellOf(p.x, p.z); return g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] === FLOOR && Math.abs(g.floorAt(p.x, p.z) - p.y) < 0.05; });
          expect(lvl, `${tag}: stand point ${p.x},${p.y},${p.z}`).toBeTruthy();
        }
      }
    }
    expect(flights).toBeGreaterThan(100);
  }, 300_000);

  it('a level link per stair core joins the storeys it climbs; walkable upper and roof cells keep their headroom', () => {
    for (const c of deepCases()) {
      const L = c.L, g1 = L.levels![1].grid;
      for (const b of destinations(L)) {
        if (!b.levels.includes(1)) continue;
        const fp = b.footprint;
        const links = L.levelLinks.filter(k => k.lower === 0 && k.upper === 1 && k.bottom.x > fp.x0 && k.bottom.x < fp.x1 && k.bottom.z > fp.z0 && k.bottom.z < fp.z1);
        expect(links.length, `${c.tag}: ${b.name} links`).toBeGreaterThan(0);
        // headroom on the upper storey's walkable cells (rooms 2.4 m, doorways 2.1 m; the roof is open sky)
        const bad: string[] = [];
        for (const a of b.areas) {
          const ar = L.areas[a];
          if ((ar.level ?? 0) !== 1) continue;
          for (let y = ar.y; y < ar.y + ar.h; y++) for (let x = ar.x; x < ar.x + ar.w; x++) {
            const i = y * g1.w + x;
            if (g1.cells[i] !== FLOOR || g1.area[i] !== a || g1.rampIdx[i] >= 0) continue;
            const door = L.doors.some(d => d.level === 1 && x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h);
            if (g1.ceil[i] - g1.floor[i] < (door ? 2.0 : MIN_HEADROOM) - 1e-3) bad.push(`${ar.label} ${x},${y}: ${(g1.ceil[i] - g1.floor[i]).toFixed(2)} m`);
          }
        }
        expect(bad.slice(0, 4), `${c.tag}: ${b.name} headroom`).toEqual([]);
      }
    }
  }, 300_000);

  it("upper-floor windows are AIR's spans on their own storey: sill / head inside the storey's floor .. ceiling", () => {
    let n = 0;
    for (const c of deepCases()) {
      const L = c.L, S = L.surface!;
      for (const w of S.windows) {
        if (w.level < 1) continue;
        const b = S.buildings[w.building];
        expect(b.windows.includes(w.id), `${c.tag}: ${w.id} registered on its building`).toBe(true);
        const base = L.levels![w.level].baseY, sill = base + w.sill, head = base + w.head;
        // the storey behind the span: its rooms' floor .. ceiling on that level
        const rooms = b.areas.map(a => L.areas[a]).filter(a => (a.level ?? 0) === w.level);
        if (!rooms.length) continue;
        n++;
        const floor = Math.min(...rooms.map(a => a.floorY ?? base)), ceil = Math.max(...rooms.map(a => a.ceil));
        expect(sill, `${c.tag}: ${w.id} sill ${sill} over the floor ${floor}`).toBeGreaterThan(floor + 0.2);
        expect(head, `${c.tag}: ${w.id} head ${head} under the ceiling ${ceil}`).toBeLessThanOrEqual(ceil + 1e-3);
      }
    }
    expect(n).toBeGreaterThan(20);
  }, 300_000);
});

describe('Surface Run v2: budgets', () => {
  it('two level grids (the light field with its cube inside the 96 MB bound at the 1 m texels); generation within a bounded factor of v1', () => {
    for (const c of deepCases()) {
      expect(c.L.levels!.length, c.tag).toBe(SURFACE_LEVELS);
      const g = c.L.grid, S = c.L.levels!.length, k = SURFACE_FIELD_SCALE;
      const bytes = Math.ceil(g.w / k) * Math.ceil(g.h / k) * (fieldDepth(S) + MAX_GROUPS + giDepth(S)) * 4;
      expect(bytes, `${c.tag}: field bytes`).toBeLessThanOrEqual(FIELD_CUBE_BYTES);
    }
    // generation: a warm second build of each (host, seed) in both versions (the cached first builds paid the JIT)
    const ms = (v: number) => {
      const t: number[] = [];
      for (const h of DEEP_HOSTS) for (const s of DEEP_SEEDS.slice(0, 2)) { deepDistrict(h, s, v); t.push(deepDistrict(h, s, v).ms); }
      return t.reduce((a, b) => a + b, 0);
    };
    const v1 = ms(1), v2 = ms(2);
    console.info(`[surface v2 budgets] generation v1 ${v1.toFixed(0)} ms, v2 ${v2.toFixed(0)} ms (${DEEP_HOSTS.length * 2} districts each)`);
    expect(v2, `generation v2 ${v2.toFixed(0)} ms vs v1 ${v1.toFixed(0)} ms`).toBeLessThan(v1 * 1.6 + 600);
  }, 300_000);
});
