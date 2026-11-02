// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): THE RUINED CITY round the surface — user: "The player will see
// a city up there, with all the destroyed buildings". Pins:
//  1. the kit registry resolves: every entry's model is in the lazy catalogue / on disk, its dims match the source registry AND the
//     cooked GLB's measured bounds, every role has a delivered model, the lead's new kit + the approved Office kit are both used;
//  2. the plan on REAL Reactor layouts (with lane ENDING's surface contract): deterministic per seed, different across seeds; bounded
//     (every footprint within SURFACE_CITY.maxR of the aperture, counts within each entry's cap); nothing on the walkable plaza, inside
//     the aperture's keep-off radius or in the yard; buildings inside their blocks; no two footprints overlap; a skyline (high-rises
//     behind the near rows, >= 50 m) and variety; the street mask's CPU mirror = the ground's data rows;
//  3. the site adapter: ENDING's contract read as is; the provisional pit-roof site without it; the eye gate (outside on / over the
//     plaza and the top of the stair, never in the pit).
// LL_SURFACE_OUT=/tmp/x.txt writes the numbers (vitest hides console output).
import {appendFileSync, existsSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {OFFICE_ASSETS} from '../src/assets/officeAssets';
import {COMPANY_ASSETS} from '../src/assets/companyAssets';
import {REACTOR_SURFACE_KIT} from '../src/assets/reactorSurfaceKit.generated';
import {SURFACE_KIT, resolveSurfaceKit, surfaceModelKeys, type SurfaceRole} from '../src/world/reactor/surfaceKit';
import {SURFACE_CITY, footprintCorners, footprintInRect, footprintInside, footprintsOverlap, planSurfaceCity, streetMaskAt, surfacePlaza} from '../src/world/reactor/surfacePlan';
import {surfaceEyeOpen, surfaceEyeOutside, surfaceSiteOf} from '../src/world/reactor/surfaceSite';
import {streetMaskRows} from '../src/world/reactor/surfaceCity';
import {SURFACE_CATALOGUE, SURFACE_SEEDS, inCatalogue, surfaceLayout, surfaceModels} from './reactor-surface-fixture';
import {LEVELS} from '../src/levels/registry';

const OUT = process.env.LL_SURFACE_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

describe('the surface kit registry', () => {
  it('every entry resolves to a catalogued, shipped model with its source dims; every role is delivered', () => {
    for (const e of SURFACE_KIT) {
      expect(inCatalogue(e.key), e.id).toBe(true);
      expect(SURFACE_CATALOGUE[e.key].url, e.id).toBe(e.url);
      expect(existsSync(fileURLToPath(new URL('../public/' + e.url, import.meta.url))), e.url).toBe(true);
      expect(e.scale[0]).toBeLessThanOrEqual(e.scale[1]);
      expect(e.rings[0]).toBeLessThanOrEqual(e.rings[1]);
      expect(e.max).toBeGreaterThan(0);
    }
    // dims come from the source registries (no second copy to drift)
    for (const [id, m] of Object.entries(REACTOR_SURFACE_KIT)) expect(SURFACE_KIT.find(e => e.id === id)?.dims).toEqual(m.dims);
    expect(SURFACE_KIT.find(e => e.id === 'ruinedTower')?.dims).toEqual(OFFICE_ASSETS['ruined-tower'].dims);
    expect(SURFACE_KIT.find(e => e.id === 'waterTower')?.dims).toEqual(COMPANY_ASSETS['water-tower'].dims);
    const roles = resolveSurfaceKit(inCatalogue);
    for (const r of ['highrise', 'midrise', 'lowrise', 'rubble', 'car', 'bus', 'tank'] as SurfaceRole[]) expect(roles[r].length, r).toBeGreaterThan(0);
    expect(Object.values(resolveSurfaceKit(() => false)).every(l => l.length === 0)).toBe(true);
    // the lazy keys Game.sectionModelKeys asks on a Reactor layout: the new kit's 4 and the reused approved exterior models
    const keys = surfaceModelKeys();
    for (const m of Object.values(REACTOR_SURFACE_KIT)) expect(keys).toContain(m.key);
    for (const k of ['office-ruined-tower', 'office-ruined-midrise', 'office-water-tower', 'office-car-wreck', 'office-bus-wreck', 'office-rubble-pile']) expect(keys).toContain(k);
  });

  it('the registry dims are the cooked GLBs\' measured bounds (grounded, centred)', async () => {
    const lib = await surfaceModels();
    for (const e of SURFACE_KIT) {
      const g = lib[e.key];
      expect(g, e.key).toBeTruthy();
      const b = new THREE.Box3().setFromObject(g.scene), s = b.getSize(new THREE.Vector3());
      out(`kit ${e.id}: measured ${s.toArray().map(v => v.toFixed(2)).join(' x ')} (dims ${e.dims.join(' x ')}), min y ${b.min.y.toFixed(3)}`);
      for (let k = 0; k < 3; k++) expect(Math.abs(s.getComponent(k) - e.dims[k]) / e.dims[k], `${e.id} axis ${k}`).toBeLessThan(0.03);
      expect(Math.abs(b.min.y), `${e.id} grounded`).toBeLessThan(0.05);
      expect(Math.abs((b.min.x + b.max.x) / 2), `${e.id} centred x`).toBeLessThan(0.05 * e.dims[0]);
      expect(Math.abs((b.min.z + b.max.z) / 2), `${e.id} centred z`).toBeLessThan(0.05 * e.dims[2]);
    }
  }, 120_000);
});

describe('the city plan on real Reactor layouts (lane ENDING\'s surface contract)', () => {
  it('deterministic, bounded, off the plaza / aperture / yard, inside its blocks, no overlaps, a skyline', () => {
    const sigs = new Set<string>();
    for (const seed of SURFACE_SEEDS) {
      const L = surfaceLayout(seed), site = surfaceSiteOf(L)!, info = L.reactor!;
      expect(site.contract).toBe(true);
      const plan = planSurfaceCity(site, L.seed >>> 0, inCatalogue, info.pit.bounds);
      const again = planSurfaceCity(site, L.seed >>> 0, inCatalogue, info.pit.bounds);
      expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
      sigs.add(JSON.stringify(plan.placements.map(p => [p.entry, p.x, p.z])));
      const P = surfacePlaza(site, info.pit.bounds), c = plan.centre;
      expect(plan.stats.maxDist).toBeLessThanOrEqual(SURFACE_CITY.maxR);
      // caps
      for (const e of SURFACE_KIT) expect(plan.stats.byEntry[e.id] ?? 0, e.id).toBeLessThanOrEqual(e.max);
      let bad = 0;
      for (const p of plan.placements) {
        // never on a walkable cell, never inside the aperture's keep-off radius (+ its own extent)
        for (const w of site.walk) if (footprintInRect(p, w, 0.05)) { bad++; out(`seed ${seed}: ${p.entry} on the walk area at ${p.x}, ${p.z}`); }
        for (const [x, z] of footprintCorners(p)) expect(Math.hypot(x - site.hole.x, z - site.hole.z), `${p.entry} near the opening`).toBeGreaterThan(site.hole.keepR);
        expect(Math.hypot(p.x - site.hole.x, p.z - site.hole.z)).toBeGreaterThan(site.hole.keepR + Math.min(p.hw, p.hd));
        if (!p.edge) expect(footprintInRect(p, P, 0), `${p.entry} in the yard`).toBe(false);
        if (p.block >= 0) expect(footprintInside(p, plan.blocks[p.block].rect, 0.05), `${p.entry} outside its block`).toBe(true);
        expect(p.y).toBe(site.y);
      }
      expect(bad).toBe(0);
      // no two footprints overlap
      for (let i = 0; i < plan.placements.length; i++) for (let j = i + 1; j < plan.placements.length; j++) {
        const a = plan.placements[i], b = plan.placements[j];
        if (footprintsOverlap(a, b, 0.05)) throw new Error(`seed ${seed}: ${a.entry} (${a.x}, ${a.z}) overlaps ${b.entry} (${b.x}, ${b.z})`);
      }
      // a city: buildings all round, a skyline of high-rises behind the near rows, variety
      const bld = plan.placements.filter(p => p.kind === 'building');
      const quads = new Set(bld.map(p => Math.floor(((Math.atan2(p.z - c.z, p.x - c.x) + Math.PI) / (Math.PI * 2)) * 4) % 4));
      const tall = bld.filter(p => p.h >= 50), near = bld.filter(p => p.ring === 1);
      const entries = new Set(plan.placements.map(p => p.entry));
      out(`seed ${seed}: ${plan.placements.length} placements (${JSON.stringify(plan.stats)}), blocks ${plan.blocks.length}, quadrants ${quads.size}, tall ${tall.length}, ring-1 ${near.length}, entries ${[...entries].join(' ')}`);
      expect(quads.size).toBe(4);
      expect(bld.length).toBeGreaterThanOrEqual(30);
      expect(tall.length).toBeGreaterThanOrEqual(4);
      expect(Math.min(...tall.map(p => p.ring))).toBeGreaterThanOrEqual(2);
      expect(near.length).toBeGreaterThanOrEqual(6);
      expect(Math.max(...near.map(p => p.h))).toBeLessThan(40); // the inner ring is low: the skyline climbs away from the yard
      expect(entries.size).toBeGreaterThanOrEqual(8);
      for (const id of Object.keys(REACTOR_SURFACE_KIT)) expect(entries.has(id), id).toBe(true);
      expect(plan.stats.vehicles).toBeGreaterThanOrEqual(6);
      expect(plan.placements.filter(p => p.edge).length).toBeGreaterThan(0);
      // the street mask: the ground shader's data rows = the CPU mirror
      const rows = streetMaskRows(plan);
      let roads = 0;
      for (let k = 0; k < 600; k++) {
        // texel centres (the shader reads texel floor((x - x0) / cell))
        const ix = (k * 37) % rows.texels, iz = (k * 53) % rows.texels;
        const x = rows.x0 + (ix + 0.5) * rows.cell, z = rows.z0 + (iz + 0.5) * rows.cell;
        const inYard = x > plan.plaza.x0 && x < plan.plaza.x1 && z > plan.plaza.z0 && z < plan.plaza.z1;
        const gpu = inYard ? 0 : Math.max(rows.rows[ix], rows.rows[rows.texels + iz]);
        expect(gpu, `mask at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(streetMaskAt(plan, x, z));
        if (gpu === 1) roads++;
      }
      expect(roads).toBeGreaterThan(30);
      // no building stands on a carriageway (the blocks lie between the streets)
      for (const p of bld) expect(streetMaskAt(plan, p.x, p.z), `${p.entry} on a street`).toBe(0);
    }
    expect(sigs.size).toBe(SURFACE_SEEDS.length);
  }, 300_000);

  it('a missing model drops out (its lots stay rubble / other kinds); nothing delivered = no buildings, still valid', () => {
    const L = surfaceLayout(SURFACE_SEEDS[0]), site = surfaceSiteOf(L)!;
    const noNew = planSurfaceCity(site, 1, k => inCatalogue(k) && !k.startsWith('reactor-city'), L.reactor!.pit.bounds);
    expect(noNew.placements.some(p => p.entry.startsWith('city'))).toBe(false);
    expect(noNew.stats.buildings).toBeGreaterThan(10); // the Office kit carries the city alone
    const none = planSurfaceCity(site, 1, () => false, L.reactor!.pit.bounds);
    expect(none.placements.length).toBe(0);
    expect(none.blocks.length).toBeGreaterThan(10);
  });
});

describe('the site adapter and the eye gate', () => {
  it('reads ENDING\'s contract; falls back to the pit roof without it; outside only on / over the plaza or the top of the stair', () => {
    const L = surfaceLayout(SURFACE_SEEDS[1]), s = L.reactor!.surface!, site = surfaceSiteOf(L)!;
    expect(site).toMatchObject({level: s.level, y: s.y, parapetY: s.parapetY, bounds: s.bounds, contract: true});
    expect(site.hole).toEqual({x: s.hole.x, z: s.hole.z, r: s.hole.r, ringR0: s.hole.parapet.r0, ringR1: s.hole.parapet.r1, keepR: s.hole.keepR});
    expect(site.shelters).toEqual([{rect: s.head.rect, roofY: s.head.top}]);
    // provisional (no contract): the roof slab over the pit
    const bare = LEVELS.reactor.generate('main', {levelSeed: 77});
    delete (bare.reactor as {surface?: unknown}).surface;
    const p = surfaceSiteOf(bare)!;
    expect(p.contract).toBe(false);
    expect(p.y).toBe(bare.reactor!.pit.roofY);
    expect(p.walk).toEqual([bare.reactor!.pit.bounds]);
    // the gate
    const w = s.walk[0], mid = {x: (w.x0 + w.x1) / 2, z: (w.z0 + w.z1) / 2};
    expect(surfaceEyeOutside(site, {x: mid.x, y: s.y + 1.6, z: mid.z})).toBe(true);
    expect(surfaceEyeOpen(site, {x: mid.x, y: s.y + 1.6, z: mid.z})).toBe(true);
    const hd = s.head.rect, hc = {x: (hd.x0 + hd.x1) / 2, z: (hd.z0 + hd.z1) / 2};
    expect(surfaceEyeOutside(site, {x: hc.x, y: s.y + 1.6, z: hc.z})).toBe(true); // the head house sees out through the exit
    expect(surfaceEyeOpen(site, {x: hc.x, y: s.y + 1.6, z: hc.z})).toBe(false); // ... under its roof
    for (const t of L.reactor!.tiers) {
      for (const d of L.reactor!.decks.filter(q => q.level === t.level)) {
        const e = {x: (d.rect.x0 + d.rect.x1) / 2, y: d.y + 1.62, z: (d.rect.z0 + d.rect.z1) / 2};
        expect(surfaceEyeOutside(site, e), `deck ${d.kind} L${d.level}`).toBe(false);
      }
    }
    expect(surfaceEyeOutside(site, {x: s.hole.x, y: L.reactor!.pit.roofY - 3, z: s.hole.z})).toBe(false); // under the opening, in the pit
  });
});
