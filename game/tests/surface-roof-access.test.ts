// Task studio-surface-run-field-followup-20261116-211729-01 (lane INTERIOR): REAL ROOF ACCESS in the version-2 district (user: "Roof access
// must actually be reachable … Keep normal interior permanent kills, finite loot and door/window gas breaches"). On GEN's real districts
// (every host, several seeds; tests/helpers/surfaceDeepDistricts.ts):
//  - the record (SurfaceBuilding.roofAccess): the walkable roof inside the parapet, the stair bulkhead on it, its door on the bulkhead's
//    roof-side face, the roof's own areas on the roof level at the roof height; the parapet ring closed (no walking off the edge);
//  - REACHABLE: a foot flood from the portal reaches every roof area (street -> stairs -> bulkhead -> roof door -> roof);
//  - GAS (one source of truth): the roof is OUTDOOR air above its surface (surfaceOutdoorGasAt: what hurts and what the march draws), the
//    store under it and the bulkhead stay indoors; the roof door is a real door (planSurfaceDoors) whose breach gasses the bulkhead's
//    landing on the roof level, and the building's field never covers the open sky (the zone's closed cells on that level only);
//  - LOOK: the builder's roof floor ('surface-roof'), no ceiling over it, the bulkhead's walls clipped at its top, the roof cells' faces
//    against the parapet dropped, the view's parts (rim, cap, walls, door frame), no look clutter on a walkable roof.

import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {footFlood} from '../src/gen/surface/cityCheck';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceBuilding} from '../src/gen/surface/surfaceTypes';
import {SURFACE_AIR, surfaceOutdoorGasAt, surfaceOutdoorMap} from '../src/world/surface/airMask';
import {SurfaceGasField, surfaceGasZones} from '../src/world/surface/airField';
import {doorBreachId, facadeLine, planSurfaceDoors} from '../src/world/surface/airDoors';
import {GasField} from '../src/world/gas/field';
import {surfaceLookPlan} from '../src/world/surface/archPlan';
import {SurfaceArch} from '../src/world/surface/arch';
import {buildRoofAccess} from '../src/world/surface/roofAccessView';
import {LevelColumns, extractWallFaces, stationLevels} from '../src/world/levelGeometry';
import {WorldMaterials} from '../src/world/materials';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';
import {DEEP_HOSTS, areaCellsOf, deepCases, deepDistrict} from './helpers/surfaceDeepDistricts';

installCanvasShim(false);

const roofs = (L: StationLayout): SurfaceBuilding[] => L.surface!.buildings.filter(b => b.roofAccess);
const cellsIn = (L: StationLayout, r: {x0: number; z0: number; x1: number; z1: number}): number[] => {
  const out: number[] = [], W = L.grid.w;
  for (let cy = Math.round(r.z0 / CELL); cy < Math.round(r.z1 / CELL); cy++) for (let cx = Math.round(r.x0 / CELL); cx < Math.round(r.x1 / CELL); cx++) out.push(cy * W + cx);
  return out;
};
const inRect = (r: {x0: number; z0: number; x1: number; z1: number}, i: number, W: number) => {
  const x = (i % W + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL;
  return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
};

describe('Surface Run v2: roof access records', () => {
  it('walk inside the parapet, the bulkhead on it, the door on its face, the roof areas on the roof level at the roof height', () => {
    let n = 0;
    const perHost = new Map<string, number>();
    for (const c of deepCases()) {
      const L = c.L, W = L.grid.w;
      for (const b of roofs(L)) {
        n++;
        perHost.set(c.host, (perHost.get(c.host) ?? 0) + 1);
        const ra = b.roofAccess!, fp = b.footprint, g = L.levels![ra.level].grid, tag = `${c.tag}: ${b.name}`;
        expect(b.enterable && b.destination && b.condition === 'intact', tag).toBe(true);
        expect([ra.walk.x0 - fp.x0, ra.walk.z0 - fp.z0, fp.x1 - ra.walk.x1, fp.z1 - ra.walk.z1].map(v => Math.round(v * 100) / 100), tag).toEqual([CELL, CELL, CELL, CELL]);
        const B = ra.bulkhead;
        expect(B.x0 >= fp.x0 - 1e-6 && B.x1 <= fp.x1 + 1e-6 && B.z0 >= fp.z0 - 1e-6 && B.z1 <= fp.z1 + 1e-6, `${tag}: bulkhead in the footprint`).toBe(true);
        expect(B.h, tag).toBeGreaterThanOrEqual(2.4);
        // the door: on the bulkhead's face on its side, a doorway of the roof level, under the bulkhead's top
        const e = ra.door!;
        expect(e.level, tag).toBe(ra.level);
        expect(e.side, tag).toBe(B.side);
        expect(Math.abs((e.side === 'N' || e.side === 'S' ? e.z : e.x) - facadeLine(B, e.side)), `${tag}: door line`).toBeLessThan(1e-3);
        expect(e.height, tag).toBeGreaterThanOrEqual(2.0);
        expect(e.height, tag).toBeLessThan(B.h);
        for (const i of e.cells) expect(g.cells[i], `${tag}: door cell`).toBe(FLOOR);
        // the roof's areas: on its level at its height, every cell walkable; exactly the walk minus the bulkhead
        const roofCells = new Set<number>();
        for (const a of ra.areas!) {
          expect(L.areas[a].level, tag).toBe(ra.level);
          for (const i of areaCellsOf(L, a)) { roofCells.add(i); expect(Math.abs(g.floor[i] - ra.y), `${tag}: roof floor`).toBeLessThan(1e-3); expect(g.walkable(i % W, Math.floor(i / W)), tag).toBe(true); }
          expect(b.areas.includes(a), `${tag}: roof area is not an interior room`).toBe(false);
        }
        const open = cellsIn(L, ra.walk).filter(i => !inRect(B, i, W));
        expect(open.filter(i => !roofCells.has(i)).length, `${tag}: walk cells off the roof areas`).toBeLessThanOrEqual(Math.ceil(open.length * 0.02));
        for (const i of roofCells) expect(inRect(ra.walk, i, W) && !inRect(B, i, W), `${tag}: roof cell outside the walk`).toBe(true);
        // the parapet ring stays closed on the roof level
        for (const i of cellsIn(L, fp)) if (!inRect(ra.walk, i, W) && !inRect(B, i, W)) expect(g.cells[i], `${tag}: parapet ring`).toBe(SOLID);
        // the look plan's deck is the roof surface
        const bl = surfaceLookPlan(L)!.buildings[b.id];
        expect(Math.abs(bl.deck - ra.y), `${tag}: deck ${bl.deck} vs roof ${ra.y}`).toBeLessThan(0.02);
        expect(bl.top - ra.y, `${tag}: parapet height`).toBeGreaterThan(0.6);
      }
    }
    expect(n).toBeGreaterThan(6);
    for (const h of DEEP_HOSTS) expect(perHost.get(h) ?? 0, h).toBeGreaterThan(0);
  }, 300_000);

  it('every roof is reachable on foot from the portal: street -> stairs -> bulkhead -> roof door -> roof', () => {
    for (const c of deepCases()) {
      const L = c.L, p = L.surface!.portal.pose, d = footFlood(L, p.x, p.z, 0);
      for (const b of roofs(L)) {
        const ra = b.roofAccess!;
        for (const a of ra.areas!) expect(areaCellsOf(L, a).some(i => d[ra.level][i] >= 0), `${c.tag}: ${b.name} roof area ${a}`).toBe(true);
        expect(ra.door!.cells.some(i => d[ra.level][i] >= 0), `${c.tag}: ${b.name} roof door`).toBe(true);
      }
    }
  }, 300_000);
});

describe('Surface Run v2: the roof is outdoor gas; the roof door is a breach door', () => {
  it('outdoor air above the roof surface (the term exposure and the march read); the store below and the bulkhead stay indoors', () => {
    let checked = 0;
    for (const c of deepCases()) {
      const L = c.L, map = surfaceOutdoorMap(L)!, W = L.grid.w;
      for (const b of roofs(L)) {
        const ra = b.roofAccess!, B = ra.bulkhead;
        const roofCell = areaCellsOf(L, ra.areas![0])[0], x = (roofCell % W + 0.5) * CELL, z = (Math.floor(roofCell / W) + 0.5) * CELL;
        expect(surfaceOutdoorGasAt(map, x, ra.y + 1.6, z), `${c.tag}: on the roof`).toBeCloseTo(SURFACE_AIR.C, 6);
        expect(surfaceOutdoorGasAt(map, x, ra.y - 1.0, z), `${c.tag}: in the store under it`).toBe(0);
        const bx = (B.x0 + B.x1) / 2, bz = (B.z0 + B.z1) / 2;
        expect(surfaceOutdoorGasAt(map, bx, ra.y + 1.6, bz), `${c.tag}: in the bulkhead`).toBe(0);
        expect(surfaceOutdoorGasAt(map, bx, ra.y + B.h + 0.5, bz), `${c.tag}: over the bulkhead`).toBeCloseTo(SURFACE_AIR.C, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(6);
  }, 300_000);

  it('the roof door is planned like a street door; its breach gasses the bulkhead landing; the field never covers the open sky', () => {
    const {L} = deepDistrict('subway', 3), S = L.surface!, W = L.grid.w;
    const b = roofs(L)[0], ra = b.roofAccess!, B = ra.bulkhead;
    const doors = planSurfaceDoors(S, L.levels![0].grid, L.levels);
    const d = doors.find(q => q.id === ra.door!.id)!;
    expect(d, 'roof door planned').toBeTruthy();
    expect([d.level, d.floor, d.gen, d.cells], 'roof door plan').toEqual([ra.level, ra.y, ra.door!.door, ra.door!.cells]);
    expect(d.leaves.length).toBeGreaterThan(0);
    // the zone: the building's footprint, the roof's open sky closed on the roof's level only
    const specs = surfaceGasZones(S), spec = specs.find(z => z.id === `b${b.id}`)!;
    expect(spec.sky?.level).toBe(ra.level);
    const map = surfaceOutdoorMap(L)!, levels = L.levels!.map(l => ({id: l.id, grid: l.grid}));
    const f = new SurfaceGasField(levels, specs, map, () => null);
    const zk = f.zoneAtCell(d.cells[0] % W, Math.floor(d.cells[0] / W));
    expect(zk, 'the door is in the building zone').toBe(specs.indexOf(spec));
    const zn = f.zones[zk];
    const sky = areaCellsOf(L, ra.areas![0])[0], scx = sky % W, scy = Math.floor(sky / W);
    expect(zn.closed(scx, scy, ra.level), 'open sky closed on the roof level').toBe(true);
    expect(zn.closed(scx, scy, 0), 'the store below stays the zone').toBe(false);
    const landing = ra.door!.inner, lc = areaCellsOf(L, landing)[0];
    expect(zn.closed(lc % W, Math.floor(lc / W), ra.level), 'the landing is the zone').toBe(false);
    // the breach (an open roof door): the landing fills, the sky cells never hold field gas, nothing on the street storey
    const gf = new GasField(zn.levels, {domain: zn.spec.cells, closed: zn.closed});
    expect(gf.addBreach({id: doorBreachId(d.id), level: d.level, cells: d.cells, strength: SURFACE_AIR.C})).toBe(true);
    gf.advance(40);
    const lx = (lc % W + 0.5) * CELL, lz = (Math.floor(lc / W) + 0.5) * CELL;
    expect(gf.concentrationAt(lx, ra.y + 1.2, lz), 'landing gassed').toBeGreaterThan(0.05);
    expect(gf.concentrationAt((scx + 0.5) * CELL, ra.y + 1.2, (scy + 0.5) * CELL), 'no field gas on the open roof').toBe(0);
    expect(gf.storey(0), 'the street storey untouched').toBeNull();
    expect(inRect(B, lc, W)).toBe(true);
  }, 120_000);
});

describe('Surface Run v2: the roof look', () => {
  it('roof floor, no ceiling, bulkhead walls clipped at its top, parapet faces dropped; the view draws rim, cap, walls and the door frame', () => {
    const {L} = deepDistrict('subway', 3), S = L.surface!, W = L.grid.w;
    const m = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const levels = stationLevels(L), cols = new LevelColumns(levels);
    const arch = SurfaceArch.for(L, m, levels)!;
    const faces = arch.remapFaces(extractWallFaces(L, levels, cols, {tileLowerHeight: m.tileLowerHeight}));
    const plan = surfaceLookPlan(L)!;
    for (const b of roofs(L)) {
      const ra = b.roofAccess!, B = ra.bulkhead, lvIdx = levels.findIndex(l => l.id === ra.level);
      const cell = areaCellsOf(L, ra.areas![0])[0];
      expect(arch.floorKey(lvIdx, cell), b.name).toBe('surface-roof');
      expect(arch.ceilKey(lvIdx, ra.areas![0], cell), b.name).toBe(false);
      const mine = faces.filter(f => ra.areas!.includes(f.area));
      expect(mine.length, `${b.name}: bulkhead faces`).toBeGreaterThan(0);
      for (const f of mine) {
        expect(f.y1, `${b.name}: face top`).toBeLessThanOrEqual(ra.y + B.h + 1e-6);
        expect(f.finish, b.name).toBe(plan.buildings[b.id].key);
        // the face's back cell is the bulkhead (never the parapet ring: its inner face is LOOK's)
        const alongX = Math.abs(f.z0 - f.z1) < 1e-9, plane = alongX ? f.z0 : f.x0, sign = Math.sign(alongX ? f.nz : f.nx), mid = alongX ? (f.x0 + f.x1) / 2 : (f.z0 + f.z1) / 2;
        const bx = alongX ? mid : plane - sign * CELL / 2, bz = alongX ? plane - sign * CELL / 2 : mid;
        expect(bx > B.x0 && bx < B.x1 && bz > B.z0 && bz < B.z1, `${b.name}: face backed by the bulkhead`).toBe(true);
      }
      // the view's parts for this roof
      const keys = new Set<string>();
      const sink = {quad() {}, quadFacing() {}};
      const st = buildRoofAccess(plan.buildings[b.id], ra, plan.buildings[b.id].decks[0], k => { keys.add(k); return sink; });
      expect(st.rim, b.name).toBe(4);
      expect(st.cap, b.name).toBe(1);
      expect(st.walls, b.name).toBeGreaterThanOrEqual(2);
      expect(st.frame, b.name).toBe(ra.door!.door === 'boarded' ? 0 : 3);
      expect([...keys].sort(), b.name).toEqual([...new Set(['surface-roof', 'surface-coping', plan.buildings[b.id].key, plan.buildings[b.id].trimKey])].sort());
      // no look clutter (non-colliding hvac / vents / tanks) on a walkable roof
      const fp = b.footprint;
      expect(plan.placements.filter(p => p.x > fp.x0 && p.x < fp.x1 && p.z > fp.z0 && p.z < fp.z1 && p.y > ra.y - 0.6), b.name).toEqual([]);
    }
    expect(S.buildings.some(b => b.roofAccess)).toBe(true);
    void W;
  }, 300_000);
});
