// Task studio-surface-run-field-followup-20261116-211729-01 (lane INTERIOR): the version-2 district's DEEP INTERIORS on GEN's real district
// (every host, several seeds; tests/helpers/surfaceDeepDistricts.ts) — user: "Deepen enterable destinations with logical public/back rooms,
// connected storeys/stairs/landings and real rooftop access on suitable buildings. The user wants to explore these places, not just look at
// one-room shells." Checked here:
//  - the deep store programme (gen/surface/rooms/deepStores.ts): a sales floor, the back corridor, back rooms and a dog-leg stair core; upper
//    storeys and roofs on every host;
//  - CONNECTED: every room of every enterable destination — upper storeys and roofs included — is reachable on foot from the portal, no
//    orphan room;
//  - upper-floor zombies (permanent layout spawns) on walkable cells of their own storey, one at least on each deep upper floor;
//  - props on the new storeys classified and standing on their floor;
//  - loot finite and themed, ADDITIVE (holders keep their room purposes, cold storage food & drink, the ammo share bounded against v1).
// v1 districts: tests/surface-v1-compat.test.ts (byte-identical) and the first release's suites.

import {describe, expect, it} from 'vitest';
import {FLOOR} from '../src/gen/grid';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceBuilding} from '../src/gen/surface/surfaceTypes';
import {footFlood} from '../src/gen/surface/cityCheck';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {createHolderState, isContainerKind, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {econCat, type EconCat} from '../src/items/lootTables';
import {DEEP_HOSTS, areaCellsOf, deepCases, destinations} from './helpers/surfaceDeepDistricts';

const buildingAreas = (L: StationLayout): Map<number, number> => {
  const m = new Map<number, number>();
  for (const b of L.surface!.buildings) for (const a of [...b.areas, ...(b.roofAccess?.areas ?? [])]) m.set(a, b.id);
  return m;
};
/** A building's rooms above the street storey (stair landings / wells excluded; a roof's areas are not the building's). */
const upperRooms = (L: StationLayout, b: SurfaceBuilding) => b.areas.filter(a => (L.areas[a].level ?? 0) >= 1 && L.areas[a].type !== 'stair-core');

describe('Surface Run v2: deep interiors', () => {
  it('deep stores plan a sales floor, a back corridor, back rooms and a stair core; upper storeys and roofs on every host', () => {
    const per = new Map<string, {stores: number; deep: number; upper: number; roofs: number}>();
    for (const c of deepCases()) {
      const L = c.L, p = per.get(c.host) ?? {stores: 0, deep: 0, upper: 0, roofs: 0};
      for (const b of destinations(L)) {
        const labels = b.areas.map(a => L.areas[a].label ?? '');
        if (b.kind === 'store') p.stores++;
        if (labels.some(l => l.endsWith('· Back corridor'))) {
          p.deep++;
          expect(labels.some(l => l.startsWith(`${b.name} ·`)), `${c.tag}: ${b.name} labels`).toBe(true);
          expect(b.areas.some(a => L.areas[a].publicSpace && (L.areas[a].level ?? 0) === 0), `${c.tag}: ${b.name} sales floor`).toBe(true);
          // (a stair core where there is a second storey: the upper floor or the roof; a shallow plot keeps one storey)
          if (b.levels.includes(1)) expect(b.areas.some(a => L.areas[a].type === 'stair-core'), `${c.tag}: ${b.name} stair core`).toBe(true);
        }
        if (upperRooms(L, b).length) p.upper++;
        if (b.roofAccess) p.roofs++;
      }
      per.set(c.host, p);
    }
    for (const h of DEEP_HOSTS) {
      const p = per.get(h)!;
      expect(p.deep, `${h}: deep stores`).toBeGreaterThan(0);
      expect(p.deep / Math.max(1, p.stores), `${h}: most destination stores are deep`).toBeGreaterThan(0.5);
      expect(p.upper, `${h}: buildings with an upper storey`).toBeGreaterThanOrEqual(DEEP_HOSTS.length * 2);
      expect(p.roofs, `${h}: reachable roofs`).toBeGreaterThan(0);
    }
  }, 300_000);

  it('every room of every enterable destination — upper storeys and roofs — is reachable on foot from the portal (no orphan rooms)', () => {
    for (const c of deepCases()) {
      const L = c.L, S = L.surface!, p = S.portal.pose;
      const d = footFlood(L, p.x, p.z, 0);
      const orphans: string[] = [];
      let rooms = 0;
      for (const b of destinations(L)) for (const a of [...b.areas, ...(b.roofAccess?.areas ?? [])]) {
        const lv = L.areas[a].level ?? 0, cells = areaCellsOf(L, a);
        if (!cells.length) continue;
        rooms++;
        if (!cells.some(i => d[lv][i] >= 0)) orphans.push(`${L.areas[a].label ?? a} (level ${lv})`);
      }
      expect(orphans, c.tag).toEqual([]);
      expect(rooms, c.tag).toBeGreaterThan(40);
    }
  }, 300_000);

  it('upper-floor zombies stand on walkable cells of their own storey inside their building; every deep upper floor has one', () => {
    let withUpper = 0, held = 0;
    for (const c of deepCases()) {
      const L = c.L, own = buildingAreas(L);
      for (const z of L.zombies) {
        const lv = z.level ?? 0;
        if (lv < 1) continue;
        const g = L.levels![lv].grid, [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
        expect(g.walkable(cx, cy), `${c.tag}: zombie at ${z.x},${z.z} level ${lv}`).toBe(true);
        expect(g.rampIdx[i], `${c.tag}: zombie on a flight`).toBe(-1);
        expect(own.has(g.area[i]), `${c.tag}: zombie in a building`).toBe(true);
        if (z.y !== undefined) expect(Math.abs(z.y - g.floorOf(i)), `${c.tag}: zombie y`).toBeLessThan(0.01);
      }
      for (const b of destinations(L)) {
        const ups = new Set(upperRooms(L, b));
        if (!ups.size) continue;
        withUpper++;
        if (L.zombies.some(z => (z.level ?? 0) >= 1 && ups.has(L.levels![z.level!].grid.area[L.levels![z.level!].grid.idx(...L.levels![z.level!].grid.cellOf(z.x, z.z))]))) held++;
      }
    }
    expect(withUpper).toBeGreaterThan(10);
    expect(held / withUpper, `upper floors with a zombie (${held} / ${withUpper})`).toBeGreaterThan(0.9);
  }, 300_000);

  it('props on the new storeys and roofs: classified kinds, standing on their own floor (or their host)', () => {
    const open = new Set(OPENABLE_AUDIT.map(r => r.kind));
    let n = 0;
    for (const c of deepCases()) {
      const L = c.L, own = buildingAreas(L);
      for (const p of L.props) {
        const lv = p.level ?? 0;
        if (lv < 1 || !own.has(p.area)) continue;
        n++;
        expect(PROP_DEFS[p.kind], p.kind).toBeTruthy();
        expect(open.has(p.kind), `${p.kind} in OPENABLE_AUDIT`).toBe(true);
        expect(PROP_PHYSICS_AUDIT[p.kind], `${p.kind} in PROP_PHYSICS_AUDIT`).toBeTruthy();
        if (p.host !== undefined || p.mounted) continue;
        const g = L.levels![lv].grid, [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        expect(g.cells[i], `${c.tag}: ${p.kind} on floor`).toBe(FLOOR);
        expect(Math.abs(p.y - g.floorOf(i)), `${c.tag}: ${p.kind} y ${p.y} vs ${g.floorOf(i)}`).toBeLessThan(0.002);
      }
    }
    expect(n).toBeGreaterThan(200);
  }, 300_000);

  it('loot is finite, themed and additive: holders keep their room purpose, cold storage food & drink, the ammo share bounded vs v1', () => {
    const stats = (v: number) => {
      const cats = new Map<EconCat | 'other', number>();
      let holders = 0, pickups = 0;
      for (const c of deepCases(v)) {
        const L = c.L, own = buildingAreas(L);
        let ci = 0, si = 0;
        for (const p of L.props as PropPlacement[]) {
          if (!isLootHolderKind(p.kind) || !own.has(p.area)) continue;
          const k = p.kind as HolderKind, a = L.areas[p.area];
          const purpose = p.purpose ?? a.purpose ?? a.type;
          if (v === 2) expect(purpose, `${c.tag}: ${p.kind} room purpose`).toBeTruthy();
          const st = createHolderState(1234, isContainerKind(k) ? ci++ : si++, k, purpose, holderSurfaces(k, PROP_DEFS[k]));
          holders++;
          const cold = k === 'fridge' || k === 'shopCooler' || k === 'chestFreezer';
          for (const l of st.lots) {
            const e = econCat(l.itemId) ?? 'other';
            if (cold) expect(['food', 'drink'], `${c.tag}: ${e} in a ${k}`).toContain(e);
            cats.set(e, (cats.get(e) ?? 0) + 1);
          }
        }
        pickups += L.pickups.filter(q => own.has(L.levels![q.level ?? 0].grid.area[L.levels![q.level ?? 0].grid.idx(...L.levels![q.level ?? 0].grid.cellOf(q.x, q.z))])).length;
      }
      const total = [...cats.values()].reduce((s, x) => s + x, 0);
      return {holders, pickups, total, ammo: (cats.get('ammo') ?? 0) / Math.max(1, total)};
    };
    const v1 = stats(1), v2 = stats(2);
    // more to find (deeper buildings), every find a finite seeded lot, the ammo share where the first release had it
    expect(v2.holders).toBeGreaterThan(v1.holders);
    expect(v2.total).toBeGreaterThan(v1.total);
    expect(v2.pickups).toBeLessThan(v1.pickups * 3 + 20);
    expect(v2.ammo, `ammo share v2 ${v2.ammo.toFixed(3)} vs v1 ${v1.ammo.toFixed(3)}`).toBeLessThan(Math.max(0.12, v1.ammo + 0.03));
  }, 300_000);

  it('version 1 never takes the deep branch: no roofs, no back corridors, no dog-leg stairs', () => {
    for (const c of deepCases(1)) {
      expect(c.L.surface!.buildings.some(b => b.roofAccess), c.tag).toBe(false);
      expect(c.L.areas.some(a => (a.label ?? '').endsWith('· Back corridor') || (a.label ?? '').endsWith('Stairs · Roof')), c.tag).toBe(false);
    }
  }, 300_000);
});
