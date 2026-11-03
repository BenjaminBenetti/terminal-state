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
// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CITY; user: "It should have more buildings going back a
// little further, as you can easily tell the buildings end"). Pins:
//  4. DEPTH: the city reaches out into the mist (outer blocks, the outskirts belt: vista terminators, closure buildings, peaks) and
//     every roof stays inside the outdoor sky dome / far plane from anywhere on the plaza; the ground disc runs on past the last building;
//  5. NO VISIBLE END: from eye points all along the walk area's edges (and over the deck), every eye-level bearing ends on a building
//     (an independent ray cast, not the planner's own bookkeeping) — no street vista or collapsed lot sees through to the bare horizon;
//     the skyline is LAYERED (a share of the bearings shows a silhouette 150 m+ out above everything nearer, ~5 % before);
//  6. BUDGET: the plan's triangle count is its instances' model triangles, inside SURFACE_CITY.tris; the far skyline is instanced;
//  7. RESERVED lots (lane PLANT's vent towers / plant round the yard) are never built on, and the city stays whole round them.
// LL_SURFACE_OUT=/tmp/x.txt writes the numbers (vitest hides console output).
import {appendFileSync, existsSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {OFFICE_ASSETS} from '../src/assets/officeAssets';
import {COMPANY_ASSETS} from '../src/assets/companyAssets';
import {REACTOR_SURFACE_KIT} from '../src/assets/reactorSurfaceKit.generated';
import {SURFACE_KIT, resolveSurfaceKit, surfaceKitEntry, surfaceModelKeys, type SurfaceRole} from '../src/world/reactor/surfaceKit';
import {
  SURFACE_CITY, closureEyes, footprintCorners, footprintInRect, footprintInside, footprintsOverlap, planSurfaceCity, streetFadeAt, streetMaskAt,
  surfacePlaza, type CityFootprint, type CityPlacement, type SurfaceCityPlan,
} from '../src/world/reactor/surfacePlan';
import {surfaceEyeOpen, surfaceEyeOutside, surfaceSiteOf, type SurfaceSite} from '../src/world/reactor/surfaceSite';
import {SURFACE_SECTORS, SURFACE_SKY, buildSurfaceView, disposeSurfaceView, filmGeometry, onWalk, parapetGeometry, streetMaskRows} from '../src/world/reactor/surfaceCity';
import {SURFACE_RT} from '../src/world/reactor/surface';
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
      // the street mask: the ground shader's data rows (x the grid's fade toward the outskirts, as the shader) = the CPU mirror
      const rows = streetMaskRows(plan);
      let roads = 0, faded = 0;
      for (let k = 0; k < 900; k++) {
        // texel centres (the shader reads texel floor((x - x0) / cell))
        const ix = (k * 37) % rows.texels, iz = (k * 53) % rows.texels;
        const x = rows.x0 + (ix + 0.5) * rows.cell, z = rows.z0 + (iz + 0.5) * rows.cell;
        const inYard = x > plan.plaza.x0 && x < plan.plaza.x1 && z > plan.plaza.z0 && z < plan.plaza.z1;
        const gpu = inYard ? 0 : Math.max(rows.rows[ix], rows.rows[rows.texels + iz]) * streetFadeAt(plan, x, z);
        expect(gpu, `mask at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeCloseTo(streetMaskAt(plan, x, z), 9);
        if (gpu === 1) roads++;
        if (Math.max(rows.rows[ix], rows.rows[rows.texels + iz]) > 0 && Math.hypot(x - c.x, z - c.z) >= plan.streetsR) { expect(gpu).toBe(0); faded++; }
      }
      expect(roads).toBeGreaterThan(30);
      expect(faded).toBeGreaterThan(0); // (the street strips stop at the grid's circle: the outskirts are lots)
      // no building stands on a carriageway or a pavement (the blocks lie between the streets; the belt stays off them): its centre
      // and its corners (pulled a hair inside: a block's edge is a street's edge)
      for (const p of bld) {
        expect(streetMaskAt(plan, p.x, p.z), `${p.entry} on a street`).toBe(0);
        for (const [x, z] of footprintCorners({...p, hw: p.hw * 0.99, hd: p.hd * 0.99})) expect(streetMaskAt(plan, x, z), `${p.entry} corner on a street`).toBe(0);
      }
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

/** An eye-level ray from (ex, ez) along (dx, dz) into footprint p: the entry distance (null: a miss). Independent of the planner. */
function rayHit(p: CityFootprint, ex: number, ez: number, dx: number, dz: number): number | null {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), X = ex - p.x, Z = ez - p.z;
  // world -> the footprint's own frame (three.js rotation.y inverse)
  const o = [X * c - Z * s, X * s + Z * c], v = [dx * c - dz * s, dx * s + dz * c], h = [p.hw, p.hd];
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 2; k++) {
    if (Math.abs(v[k]) < 1e-12) { if (Math.abs(o[k]) > h[k]) return null; continue; }
    let a = (-h[k] - o[k]) / v[k], b = (h[k] - o[k]) / v[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t1 >= Math.max(t0, 0) && t0 > 0 ? t0 : null;
}

/** Eye points on the deck: along every walk-area edge (0.3 m in, <= 4 m apart) and a 10 m grid over the walk cells. */
function deckEyes(site: SurfaceSite): [number, number][] {
  const out = closureEyes(site, 4, 0.3);
  for (const w of site.walk) for (let x = w.x0 + 3; x < w.x1; x += 10) for (let z = w.z0 + 3; z < w.z1; z += 10) out.push([x, z]);
  return out.filter(([x, z]) => Math.hypot(x - site.hole.x, z - site.hole.z) > site.hole.keepR);
}

/**
 * From each eye, every 0.25 deg of bearing: does the eye-level ray end on a building (open: it runs on to the horizon), and the
 * distance of the FARTHEST silhouette it shows over everything nearer (the skyline's depth along that bearing).
 */
function horizonSurvey(plan: SurfaceCityPlan, site: SurfaceSite, eyes: readonly [number, number][]) {
  const bld = plan.placements.filter(p => p.kind === 'building'), eyeY = site.y + 1.6, N = 1440;
  let open = 0, total = 0, deep = 0;
  const worst: string[] = [];
  for (const [ex, ez] of eyes) {
    const near = bld.map(p => ({p, d: Math.hypot(p.x - ex, p.z - ez), r: Math.hypot(p.hw, p.hd), a: Math.atan2(p.z - ez, p.x - ex)}));
    for (let k = 0; k < N; k++) {
      const az = (k / N) * Math.PI * 2, dx = Math.cos(az), dz = Math.sin(az);
      const hits: {t: number; top: number}[] = [];
      for (const q of near) {
        // (bounding-circle pre-test on the bearing)
        const da = Math.abs(((az - q.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (q.d > q.r && da > Math.asin(Math.min(1, q.r / q.d)) + 1e-9) continue;
        const t = rayHit(q.p, ex, ez, dx, dz);
        if (t !== null) hits.push({t, top: q.p.y + q.p.h});
      }
      total++;
      if (!hits.length) { open++; if (worst.length < 6) worst.push(`(${ex.toFixed(1)}, ${ez.toFixed(1)}) bearing ${(az * 180 / Math.PI).toFixed(2)}`); continue; }
      hits.sort((a, b) => a.t - b.t);
      let maxE = -Infinity, far = 0;
      for (const h of hits) { const e = Math.atan2(h.top - eyeY, h.t); if (e > maxE + 0.0017) { maxE = e; far = h.t; } }
      if (far >= 150) deep++;
    }
  }
  return {open, total, deep: deep / total, worst};
}

describe('the city goes on into the mist (task reactor-surface-redesign-credits-20261103, lane CITY)', () => {
  it('deeper: outer blocks + the outskirts belt out to maxR, every roof inside the sky dome / far plane from the plaza, ground beyond', () => {
    // the outdoor sky dome's nearest facet (the builder's sphere) and the far plane
    const L0 = surfaceLayout(SURFACE_SEEDS[0]), s0 = surfaceSiteOf(L0)!;
    const v = buildSurfaceView(s0, planSurfaceCity(s0, 1, () => false, L0.reactor!.pit.bounds), () => undefined, null, 1);
    const pos = v.sky.geometry.getAttribute('position'), idx = v.sky.geometry.index!;
    let facet = Infinity;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      A.fromBufferAttribute(pos, idx.getX(i)); B.fromBufferAttribute(pos, idx.getX(i + 1)); Cc.fromBufferAttribute(pos, idx.getX(i + 2));
      nrm.subVectors(B, A).cross(Cc.clone().sub(A));
      if (nrm.lengthSq() < 1e-9) continue;
      facet = Math.min(facet, Math.abs(nrm.normalize().dot(A)));
    }
    disposeSurfaceView(v);
    expect(SURFACE_SKY.radius).toBeLessThan(SURFACE_RT.far);
    expect(SURFACE_CITY.viewR).toBeLessThan(facet);
    out(`sky dome r ${SURFACE_SKY.radius}: nearest facet ${facet.toFixed(1)} m, far plane ${SURFACE_RT.far}, city viewR ${SURFACE_CITY.viewR}`);
    for (const seed of SURFACE_SEEDS) {
      const L = surfaceLayout(seed), site = surfaceSiteOf(L)!;
      const plan = planSurfaceCity(site, L.seed >>> 0, inCatalogue, L.reactor!.pit.bounds), st = plan.stats;
      const bld = plan.placements.filter(p => p.kind === 'building');
      const far = bld.filter(p => p.ring >= SURFACE_CITY.outerRing), belt = bld.filter(p => p.belt);
      out(`seed ${seed}: extent ${st.maxDist} m, ${bld.length} buildings (${far.length} ring >= 3: outer ${st.outer}, vistas ${st.vistas}, peaks ${st.peaks}, closure ${st.fillers}), ${st.tris} triangles`);
      expect(st.maxDist).toBeGreaterThan(250);
      expect(st.maxDist).toBeLessThanOrEqual(SURFACE_CITY.maxR);
      expect(far.length).toBeGreaterThanOrEqual(20);
      expect(st.outer).toBeGreaterThanOrEqual(5);
      expect(st.vistas).toBeGreaterThanOrEqual(6); // the ring road's legs end on facades
      expect(st.peaks).toBeGreaterThanOrEqual(4);
      expect(belt.every(p => p.block === -1 && !!surfaceKitEntry(p.entry)?.skyline)).toBe(true);
      // the near rows never take the far skyline's entries; the outskirts never the near city's
      for (const p of bld) expect(!!surfaceKitEntry(p.entry)?.skyline, `${p.entry} ring ${p.ring}`).toBe(p.belt !== undefined || (p.block >= 0 && plan.blocks[p.block].ring >= SURFACE_CITY.outerRing));
      // grounded; the ground runs on past the last building
      for (const p of plan.placements) expect(p.y).toBe(site.y);
      expect(plan.groundR).toBeGreaterThan(st.maxDist + 20);
      // every roof corner inside the sky dome's nearest facet / the far plane from any plaza eye (the bounds' corners + the gate's pad)
      const b = site.bounds, E = SURFACE_CITY.eyePad, eyeY = site.y + 1.6;
      let worst = 0;
      for (const [ex, ez] of [[b.x0 - E, b.z0 - E], [b.x1 + E, b.z0 - E], [b.x0 - E, b.z1 + E], [b.x1 + E, b.z1 + E]]) {
        for (const p of plan.placements) for (const [x, z] of footprintCorners(p)) worst = Math.max(worst, Math.hypot(x - ex, z - ez, p.y + p.h - eyeY), Math.hypot(x - ex, z - ez, eyeY - p.y));
      }
      expect(worst).toBeLessThanOrEqual(SURFACE_CITY.viewR);
      expect(worst).toBeLessThan(facet);
      expect(worst).toBeLessThan(SURFACE_RT.far);
    }
  }, 300_000);

  it('no visible end: every eye-level bearing from the deck ends on a building; the skyline is layered (silhouettes 150 m+ out)', () => {
    for (const seed of SURFACE_SEEDS) {
      const L = surfaceLayout(seed), site = surfaceSiteOf(L)!;
      const plan = planSurfaceCity(site, L.seed >>> 0, inCatalogue, L.reactor!.pit.bounds);
      expect(plan.stats.open).toBe(0); // (the planner's own closure bookkeeping)
      const eyes = deckEyes(site);
      const s = horizonSurvey(plan, site, eyes);
      out(`seed ${seed}: ${eyes.length} deck eyes x 1440 bearings: open ${s.open} (${s.worst.join('; ')}), layered 150 m+ ${(s.deep * 100).toFixed(1)} %`);
      expect(eyes.length).toBeGreaterThan(80);
      expect(s.open, s.worst.join('; ')).toBe(0);
      expect(s.deep).toBeGreaterThan(0.15);
    }
  }, 300_000);

  it('the triangle budget: the plan counts its instances\' model triangles inside SURFACE_CITY.tris; the far skyline is instanced in sectors', async () => {
    const lib = await surfaceModels();
    for (const seed of SURFACE_SEEDS) {
      const L = surfaceLayout(seed), site = surfaceSiteOf(L)!;
      const plan = planSurfaceCity(site, L.seed >>> 0, inCatalogue, L.reactor!.pit.bounds);
      const sum = plan.placements.reduce((t, p) => t + (surfaceKitEntry(p.entry)?.tris ?? NaN), 0);
      expect(plan.stats.tris).toBe(sum);
      expect(plan.stats.tris).toBeLessThanOrEqual(SURFACE_CITY.tris.total);
      if (seed !== SURFACE_SEEDS[0]) continue;
      const v = buildSurfaceView(site, plan, k => lib[k], null, 7);
      try {
        // one InstancedMesh per entry part x sector: the near city's quadrants, the far skyline's octants
        for (const e of SURFACE_KIT) {
          const ms = v.instanced.filter(m => m.name.startsWith(`reactor-surface-${e.id}-`) && !m.name.endsWith('-stand'));
          const parts = new Set(ms.map(m => m.name.split('-').slice(-2, -1)[0])).size || 1;
          expect(ms.length, e.id).toBeLessThanOrEqual(parts * (e.skyline ? SURFACE_SECTORS.far : SURFACE_SECTORS.near));
          expect(ms.reduce((n, m) => n + m.count, 0), e.id).toBe((plan.stats.byEntry[e.id] ?? 0) * parts);
        }
        const city = v.instanced.reduce((t, m) => t + ((m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3) * m.count, 0);
        out(`seed ${seed}: view ${v.instanced.length} instanced meshes, ${city} city triangles (plan budget count ${plan.stats.tris}), ${v.tris} total`);
        expect(Math.abs(city - plan.stats.tris) / plan.stats.tris).toBeLessThan(0.08); // (the registries' counts vs the cooked GLBs)
      } finally {
        disposeSurfaceView(v);
      }
    }
  }, 300_000);

  it('reserved lots (the PLANT\'s, round the yard and out on the belt) are never built on; the city stays whole round them', () => {
    const L = surfaceLayout(SURFACE_SEEDS[0]), site = surfaceSiteOf(L)!, pit = L.reactor!.pit.bounds;
    const base = planSurfaceCity(site, L.seed >>> 0, inCatalogue, pit);
    const P = surfacePlaza(site, pit), c = base.centre;
    const first = base.placements.find(p => p.kind === 'building' && p.ring === 1)!, vista = base.placements.find(p => p.belt === 'vista')!;
    const reserved: CityFootprint[] = [
      // two vent-tower lots across the ring road (ring 1), an apron strip along one yard edge, a ring-1 building's own lot, a belt lot
      {x: P.x1 + SURFACE_CITY.road + 9, z: c.z, yaw: 0, hw: 8, hd: 8},
      {x: c.x, z: P.z0 - SURFACE_CITY.road - 9, yaw: 0.3, hw: 7, hd: 9},
      {x: (P.x0 + P.x1) / 2, z: P.z1 + 4, yaw: 0, hw: (P.x1 - P.x0) / 2, hd: 3.5},
      {x: first.x, z: first.z, yaw: first.yaw, hw: first.hw + 2, hd: first.hd + 2},
      {x: vista.x, z: vista.z, yaw: vista.yaw, hw: 12, hd: 12},
    ];
    const hit = (pl: SurfaceCityPlan) => pl.placements.filter(p => reserved.some(r => footprintsOverlap(p, r, 0.05)));
    expect(hit(base).length).toBeGreaterThan(0); // (the lots were in use before the reservation)
    const plan = planSurfaceCity(site, L.seed >>> 0, inCatalogue, pit, reserved);
    expect(JSON.stringify(planSurfaceCity(site, L.seed >>> 0, inCatalogue, pit, reserved))).toBe(JSON.stringify(plan));
    expect(hit(plan).map((p: CityPlacement) => `${p.entry} (${p.x}, ${p.z})`)).toEqual([]);
    for (let i = 0; i < plan.placements.length; i++) for (let j = i + 1; j < plan.placements.length; j++) expect(footprintsOverlap(plan.placements[i], plan.placements[j], 0.05)).toBe(false);
    for (const p of plan.placements) if (p.block >= 0) expect(footprintInside(p, plan.blocks[p.block].rect, 0.05)).toBe(true);
    const nb = plan.placements.filter(p => p.kind === 'building').length, n0 = base.placements.filter(p => p.kind === 'building').length;
    out(`reserved: ${reserved.length} lots; base hit ${hit(base).length}; buildings ${n0} -> ${nb}; open ${plan.stats.open}; rejects reserved ${Object.entries(plan.stats.rejects).filter(([k]) => k.startsWith('reserved')).map(([k, v]) => k + ' ' + v).join(', ')}`);
    expect(nb).toBeGreaterThan(n0 - 12);
    expect(plan.stats.open).toBe(0);
    expect(horizonSurvey(plan, site, deckEyes(site)).open).toBe(0);
  }, 300_000);
});

describe('the plaza parapet / the wet film against lane ENDING\'s walk cells', () => {
  it('the parapet stands only beyond the edges (never inside a walk rect, up to the parapet line); the film only on walk, outside keepR', () => {
    for (const seed of SURFACE_SEEDS) {
      const L = surfaceLayout(seed), site = surfaceSiteOf(L)!;
      const pg = parapetGeometry(site)!, fg = filmGeometry(site)!;
      const p = pg.getAttribute('position');
      let top = -Infinity;
      for (let i = 0; i < p.count; i += 3) {
        // every triangle's centroid off the walkable interior
        const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
        expect(onWalk(site, cx, cz), `parapet triangle at ${cx.toFixed(2)}, ${cz.toFixed(2)}`).toBe(false);
        top = Math.max(top, p.getY(i), p.getY(i + 1), p.getY(i + 2));
      }
      expect(top).toBeCloseTo(site.parapetY, 5);
      const f = fg.getAttribute('position');
      for (let i = 0; i < f.count; i += 3) {
        const cx = (f.getX(i) + f.getX(i + 1) + f.getX(i + 2)) / 3, cz = (f.getZ(i) + f.getZ(i + 1) + f.getZ(i + 2)) / 3;
        expect(site.walk.some(w => cx >= w.x0 && cx <= w.x1 && cz >= w.z0 && cz <= w.z1)).toBe(true);
        expect(Math.hypot(cx - site.hole.x, cz - site.hole.z)).toBeGreaterThan(site.hole.keepR);
        expect(site.shelters.some(s => cx > s.rect.x0 && cx < s.rect.x1 && cz > s.rect.z0 && cz < s.rect.z1)).toBe(false);
      }
      out(`seed ${seed}: parapet ${p.count / 3} triangles over ${site.edges.length} edges, film ${f.count / 6} cells`);
      pg.dispose(); fg.dispose();
    }
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
