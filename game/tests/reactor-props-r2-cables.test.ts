// Task reactor-playtest-round2-20261102 (lane PROPS), user bullet 11: "cables that show path to generator (good idea btw) should be along
// the roof. Right now they clip awkwardly through the doorways and stuff". On REAL generated Reactor layouts (every side complex the
// bunker / mines / waste carvers generate): each generator cable runs from its panel along the CEILINGS (under the timber caps in the
// mines), crosses every wall over the door's lintel or through the wall beside its jamb (never through an opening), is connected end to
// end (panel -> entrance -> the zone's fans), clears every fixture / sign / duct / prop / cap, and is drawn on drop rods.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import type {ReactorComplexInfo} from '../src/gen/reactor/reactorTypes';
import {CEILING_CABLE, cableField, ceilingCableIssues, type CableComplex} from '../src/gen/reactor/complex/propsCable';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';

installCanvasShim(false);
const SEEDS = [9100, 218558, 637474, 1, 42, 777];
const cache = new Map<number, StationLayout>();
const level = (seed: number) => { let L = cache.get(seed); if (!L) { L = LEVELS.reactor.generate('main', {levelSeed: seed}); cache.set(seed, L); } return L; };
const complexOf = (L: StationLayout, c: ReactorComplexInfo): CableComplex => ({level: c.level, baseY: L.levels[c.level].baseY, frontArea: c.slot!.frontArea, areas: c.areas});
/** The index of the cable's exit point: the first point (after the panel) on the deck in front of the complex entrance. */
function exitIndex(L: StationLayout, c: ReactorComplexInfo): number {
  const g = L.reactor!.generators[c.generator], grid = L.levels[c.level].grid;
  return g.cable.findIndex((p, i) => { if (i === 0) return false; const [cx, cy] = grid.cellOf(p.x, p.z); return grid.area[grid.idx(cx, cy)] === c.slot!.frontArea; });
}

describe('complex generator cables along the ceiling (bullet 11)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: every complex cable hangs under the ceilings, crosses walls only over lintels / beside jambs, connected end to end`, () => {
      const L = level(seed), R = L.reactor!;
      expect(R.complexes!.length).toBeGreaterThan(0);
      for (const c of R.complexes!) {
        const g = R.generators[c.generator], cc = complexOf(L, c), grid = L.levels[c.level].grid, base = cc.baseY, tag = `seed ${seed} ${c.id}`;
        const F = cableField(L, cc);
        if (typeof F === 'string') throw new Error(`${tag}: ${F}`);
        // connected: the panel, a riser, the route to the entrance's deck side, then the pit walls to every fan of the zone
        expect(g.cable[0], tag).toEqual(g.panel);
        const k = exitIndex(L, c);
        expect(k, `${tag}: the cable leaves through the entrance`).toBeGreaterThan(2);
        const E = F.entrance, ex = g.cable[k], [ecx, ecy] = grid.cellOf(ex.x, ex.z);
        expect(ecx >= E.x - CEILING_CABLE.besideReach - 1 && ecx < E.x + E.w + CEILING_CABLE.besideReach + 1 && ecy >= E.y - CEILING_CABLE.besideReach - 1 && ecy < E.y + E.h + CEILING_CABLE.besideReach + 1, `${tag}: exit at the entrance`).toBe(true);
        for (const fid of R.zones[c.zone].fans) {
          const f = R.fans[fid];
          expect(g.cable.slice(k).some(p => Math.abs(p.x - f.x) < 1e-3 && Math.abs(p.y - f.y) < 1e-3 && Math.abs(p.z - f.z) < 1e-3), `${tag} fan ${fid}`).toBe(true);
        }
        for (let i = 0; i + 1 < g.cable.length; i++) expect(Math.hypot(g.cable[i + 1].x - g.cable[i].x, g.cable[i + 1].y - g.cable[i].y, g.cable[i + 1].z - g.cable[i].z), `${tag}: point ${i} repeated`).toBeGreaterThan(1e-3);
        // no door opening, headroom over the 1.9 m body, under every ceiling, clear of every fixture / sign / duct / prop / timber cap
        expect(ceilingCableIssues(L, cc, g, k), tag).toEqual([]);
        // tray runs: vertical, or level along x / z (no diagonal across a room); walls crossed only at doorways
        let level0 = 0, near = 0;
        for (let i = 1; i < k; i++) {
          const a = g.cable[i], b = g.cable[i + 1], dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), dz = Math.abs(b.z - a.z);
          const vertical = dx < 1e-3 && dz < 1e-3, levelRun = dy < 1e-3 && (dx < 1e-3 || dz < 1e-3);
          expect(vertical || levelRun || i === 1, `${tag}: segment ${i} skew`).toBe(true);
          if (!levelRun || i === 1) continue;
          const L2 = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(L2 / 0.25)), samples: number[] = [];
          for (let t = 0; t <= n; t++) {
            const x = a.x + (b.x - a.x) * t / n, z = a.z + (b.z - a.z) * t / n, [cx, cy] = grid.cellOf(x, z), j = grid.idx(cx, cy);
            const room = grid.cells[j] === FLOOR && (F.ids.has(grid.area[j]) || grid.area[j] === F.front) && !F.doors.some(d => cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h);
            if (!room) {
              // a wall / door cell: only at a doorway of the complex (over its lintel or within reach of its jamb)
              const R2 = CEILING_CABLE.besideReach;
              expect(F.doors.some(d => cx >= d.x - R2 && cx < d.x + d.w + R2 && cy >= d.y - R2 && cy < d.y + d.h + R2), `${tag}: segment ${i} through a wall away from any door`).toBe(true);
              continue;
            }
            samples.push(j);
            expect(a.y, `${tag}: segment ${i} over the ceiling`).toBeLessThan(grid.ceil[j]);
            expect(a.y, `${tag}: segment ${i} under the headroom`).toBeGreaterThanOrEqual(base + CEILING_CABLE.minY - 1e-3);
          }
          // "along the roof": a straight tray hangs within 0.55 m of the lowest roof along it — the room's ceiling, or the timber cap /
          // fixture / duct it passes under
          if (!samples.length) continue;
          const roof = Math.min(...samples.map(j => F.lowBy[j] >= 0 ? Math.min(grid.ceil[j], F.obst[F.lowBy[j]].y0) : grid.ceil[j]));
          level0 += samples.length;
          if (a.y >= roof - 0.55) near += samples.length;
        }
        expect(level0, tag).toBeGreaterThan(10);
        expect(near / level0, `${tag}: share of the tray along the roof`).toBeGreaterThanOrEqual(0.95);
        // hung on drop rods to the ceiling / the cap above it
        expect(g.cableHangers?.length ?? 0, tag).toBeGreaterThan(5);
        for (const h of g.cableHangers!) { expect(h.y1).toBeGreaterThan(h.y0); expect(h.y1 - h.y0).toBeLessThan(CEILING_CABLE.hangerMax); }
      }
    }, 120_000);
  }

  it('the world draws the trays, wires and drop rods (tagged gen-cable, inside the kit plan the paths audit checks)', () => {
    const L = level(9100), mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const w = buildWorld(L, mats, {}), plan = w.reactorArch!.plan!;
    const rods = [...plan.parts.values()].filter(p => p.geo === 'cyl' && p.mat === 'steel').flatMap(p => p.list.filter(i => i.tag === 'gen-cable'));
    const hangers = L.reactor!.generators.reduce((n, g) => n + (g.cableHangers?.length ?? 0), 0);
    expect(hangers).toBeGreaterThan(20);
    expect(rods.length).toBe(hangers);
    // each rod stands where its record says (centre between y0 and y1)
    const recs = L.reactor!.generators.flatMap(g => g.cableHangers ?? []), p = new THREE.Vector3();
    for (const r of rods) {
      p.setFromMatrixPosition(r.m);
      expect(recs.some(h => Math.abs(h.x - p.x) < 1e-3 && Math.abs(h.z - p.z) < 1e-3 && Math.abs((h.y0 + h.y1) / 2 - p.y) < 1e-3)).toBe(true);
    }
    expect(plan.stats.cables).toBeGreaterThan(30);
  }, 180_000);
});
