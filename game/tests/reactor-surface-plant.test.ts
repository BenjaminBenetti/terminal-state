// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane PLANT): THE SURFACE PLANT — user: "It should have more
// concrete structure around the hole to make it sorta seem purpose built. there should be a ventilation tower or two, visible, use the
// existing big fan assets to build this. The fans must spin." Pins, on REAL Reactor layouts with lane ENDING's surface contract:
//  1. THE PLAN (surfacePlantPlan.ts): 1..2 vent towers, deterministic per seed; every footprint (tower, plenum, duct, sleeper, compound
//     wall pier / buttress) OFF the walkable cells, off the stair head house, outside the aperture's keep-off radius (the opening stays
//     open); the towers never on the exit's side; grounded on the deck / city ground; each fan faces the plaza (axis horizontal) with
//     its housing clear of the duct run and under the stack's top; `reserved` covers every tower's whole footprint (plinth, the fan's
//     overhang, the platform, the duct run) and the city never builds / parks / heaps rubble on it; a buttressed compound wall;
//  2. THE BUILDER (surfacePlant.ts) with a fake fan GLB: one rotor instance per tower in ONE InstancedMesh, the housing's GLB parts
//     instanced once per part (the library's geometry, never disposed by the plant), a few merged meshes, no shadow casters; every
//     vertex off the walk area / outside keepR; the rotors rest until the surface shows ONLINE, spool up smoothly and spin about the
//     fan's own axis (the housing's +Z) inside its duct ring — the housings' matrices never change; dispose releases what it owns;
//  3. THE RUNTIME (surface.ts): the plant under the outdoor group (hidden in the pit), its fans turning outside after the win.
// LL_PLANT_OUT=/tmp/x.txt writes the numbers (vitest hides console output).
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {describe, expect, it} from 'vitest';
import {surfaceSiteOf, type SurfaceSite} from '../src/world/reactor/surfaceSite';
import {footprintCorners, footprintsOverlap, planSurfaceCity, type CityFootprint} from '../src/world/reactor/surfacePlan';
import {FAN_ANCHORS, SURFACE_PLANT, planSurfacePlant, plantLocal, type SurfacePlantPlan, type VentTowerPlan} from '../src/world/reactor/surfacePlantPlan';
import {PLANT_FAN_KEY, buildSurfacePlant} from '../src/world/reactor/surfacePlant';
import {REACTOR_MODELS} from '../src/world/reactor/archAssets';
import {ReactorSurface} from '../src/world/reactor/surface';
import {SURFACE_SEEDS, fakeSurfaceHost, inCatalogue, poseCamera, surfaceLayout} from './reactor-surface-fixture';

const OUT = process.env.LL_PLANT_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

const SEEDS = [...SURFACE_SEEDS, 1, 2, 3];

/** A footprint strictly overlapping a rect (by more than 1 mm). */
const onRect = (p: CityFootprint, r: {x0: number; z0: number; x1: number; z1: number}, pad = 0) =>
  footprintsOverlap(p, {x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, yaw: 0, hw: (r.x1 - r.x0) / 2 + pad, hd: (r.z1 - r.z0) / 2 + pad}, 0.001);
/** Every corner of `inner` inside the oriented rect `outer` (+ eps). */
const covers = (outer: CityFootprint, inner: CityFootprint, eps = 0.02) => footprintCorners(inner).every(([x, z]) => {
  const dx = x - outer.x, dz = z - outer.z, c = Math.cos(outer.yaw), s = Math.sin(outer.yaw);
  // world -> the outer's local (inverse of three's rotation.y)
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= outer.hw + eps && Math.abs(lz) <= outer.hd + eps;
});
/** A tower-local box (lx centre, half widths, lz0..lz1) as a world footprint. */
const towerRect = (t: VentTowerPlan, lx: number, hw: number, lz0: number, lz1: number): CityFootprint => {
  const [x, z] = plantLocal(t, lx, (lz0 + lz1) / 2);
  return {x, z, yaw: t.yaw, hw, hd: Math.abs(lz1 - lz0) / 2};
};

/** A fake fan-housing GLB: the cooked model's bounds (2.6 x 2.5124 x 1.357, grounded, centred), one textured part. */
function fakeFan(): {gltf: GLTF; geometry: THREE.BufferGeometry} {
  const geometry = new THREE.BoxGeometry(FAN_ANCHORS.plateW, FAN_ANCHORS.plateH, FAN_ANCHORS.depth).translate(0, FAN_ANCHORS.plateH / 2, 0);
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: 0x777777})));
  return {gltf: {scene} as unknown as GLTF, geometry};
}
const tex = () => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); t.needsUpdate = true; return t; };

function planOf(seed: number): {site: SurfaceSite; plan: SurfacePlantPlan; pit: {x0: number; z0: number; x1: number; z1: number}; seed: number} {
  const L = surfaceLayout(seed), site = surfaceSiteOf(L)!;
  return {site, plan: planSurfacePlant(site, L.seed >>> 0, L.reactor!.pit.bounds), pit: L.reactor!.pit.bounds, seed: L.seed >>> 0};
}

describe('the surface plant plan on real Reactor layouts', () => {
  it('1..2 towers, deterministic; every footprint off the walk / head house / keep-off radius; grounded; fans face the plaza', () => {
    const sigs = new Set<string>();
    for (const sd of SEEDS) {
      const {site, plan, pit, seed} = planOf(sd);
      expect(site.contract).toBe(true);
      expect(JSON.stringify(planSurfacePlant(site, seed, pit))).toBe(JSON.stringify(plan)); // same seed, same plan
      sigs.add(JSON.stringify(plan.towers.map(t => [t.x, t.z, t.h])));
      out(`seed ${sd}: ${plan.towers.length} towers ${plan.towers.map(t => `[side ${t.side.nx},${t.side.nz} @ ${t.x},${t.z} ${2 * t.hw}x${2 * t.hd}x${t.h} m, fan r ${t.fan.radius} hub +${(t.fan.hubY - t.y).toFixed(2)} ${t.rev} rev/s]`).join(' ')}; ${plan.stats.piers} piers; tried ${plan.stats.tried} ${JSON.stringify(plan.stats.why)}`);
      expect(plan.towers.length).toBeGreaterThanOrEqual(1);
      expect(plan.towers.length).toBeLessThanOrEqual(2);
      const h = site.hole, sh = site.shelters[0]?.rect;
      const all: [string, CityFootprint][] = [...plan.towers.map(t => [`tower ${t.id}`, t.footprint] as [string, CityFootprint]), ...plan.parts.map(p => [`${p.kind} ${p.x},${p.z}`, p] as [string, CityFootprint])];
      for (const [name, p] of all) {
        for (const w of site.walk) expect(onRect(p, w), `${sd} ${name} on a walk cell rect ${JSON.stringify(w)}`).toBe(false);
        for (const q of site.shelters) expect(onRect(p, q.rect, 0.5), `${sd} ${name} on the head house`).toBe(false);
        for (const [x, z] of footprintCorners(p)) expect(Math.hypot(x - h.x, z - h.z), `${sd} ${name} inside keepR`).toBeGreaterThan(h.keepR + 1);
      }
      // the opening stays open: nothing of the plant inside the aperture's ring (its centre column clear for the beam)
      for (const p of plan.parts) expect(Math.hypot(p.x - h.x, p.z - h.z)).toBeGreaterThan(site.hole.ringR1 + 1);
      for (const t of plan.towers) {
        // grounded on the deck / city ground; a believable stack (taller than wide), the fan's housing between the duct run and the top
        expect(t.y).toBe(site.y);
        expect(t.h, 'a stack: over twice as tall as wide').toBeGreaterThan(2 * (2 * t.hw));
        expect(t.fan.axis).toBe('side');
        expect(t.fan.radius).toBeGreaterThanOrEqual(SURFACE_PLANT.fanR[0]);
        expect(t.fan.radius).toBeLessThanOrEqual(SURFACE_PLANT.fanR[1]);
        expect(t.fanScale).toBeCloseTo(t.fan.radius / (REACTOR_MODELS.fanHousing.anchors!.ringR as number), 2); // archKit planFan's fit
        const s = t.fanScale, hub = t.fan.hubY - t.y;
        expect(hub - FAN_ANCHORS.ringY * s, 'housing clears the duct').toBeGreaterThan(SURFACE_PLANT.duct.bottom + SURFACE_PLANT.duct.h + 0.5);
        expect(hub + (FAN_ANCHORS.plateH - FAN_ANCHORS.ringY) * s, 'housing under the top').toBeLessThan(t.h - 3);
        expect(FAN_ANCHORS.plateW * s / 2, 'housing plate on the stack face').toBeLessThan(t.hw - 0.4);
        // the fan faces the plaza: its facing (local +Z) is the side's inward normal and points at the aperture's side of the yard
        expect(Math.sin(t.yaw)).toBeCloseTo(-t.side.nx, 6);
        expect(Math.cos(t.yaw)).toBeCloseTo(-t.side.nz, 6);
        expect((h.x - t.x) * Math.sin(t.yaw) + (h.z - t.z) * Math.cos(t.yaw)).toBeGreaterThan(20);
        // never on the exit's side (the head house's): it stands on the opposite or a lateral side
        if (sh) {
          // the exit's side: the plaza side the head house sticks out of (furthest outward of the walk bounds)
          const B = site.bounds, scx = (sh.x0 + sh.x1) / 2, scz = (sh.z0 + sh.z1) / 2;
          const sides = [[-1, 0, B.x0 - scx], [1, 0, scx - B.x1], [0, -1, B.z0 - scz], [0, 1, scz - B.z1]] as const;
          const ex = sides.reduce((a, q) => (q[2] > a[2] ? q : a));
          expect(t.side.nx === ex[0] && t.side.nz === ex[1], `${sd} tower ${t.id} on the exit side`).toBe(false);
        }
        // off the aperture's axis (the beam never stands in front of it from across the yard)
        expect(Math.abs(t.side.nx === 0 ? t.x - h.x : t.z - h.z)).toBeGreaterThan(3.5);
        // reserved covers the whole tower: plinth, stack, the fan housing's overhang, the platform, its duct run to the parapet
        const res = plan.reserved;
        expect(res.some(r => covers(r, t.footprint))).toBe(true);
        const fanFront = t.hd + FAN_ANCHORS.depth * s + 0.7;
        for (const [name, r] of [
          ['plinth', towerRect(t, 0, t.plinth.hw, -t.plinth.hd, t.plinth.hd)],
          ['housing + platform', towerRect(t, 0, FAN_ANCHORS.plateW * s / 2 + 0.5, t.hd, fanFront)],
          ['cap', towerRect(t, 0, t.hw + 0.5, -t.hd - 0.5, t.hd + 0.5)],
        ] as const) expect(res.some(q => covers(q, r)), `${sd} tower ${t.id} ${name} reserved`).toBe(true);
        for (const p of plan.parts.filter(q => q.tower === t.id)) expect(res.some(q => covers(q, p)), `${sd} ${p.kind} reserved`).toBe(true);
        // the duct run reaches the parapet's outer face: the plenum stands against an edge of this side
        const pl = plan.parts.find(q => q.tower === t.id && q.kind === 'plenum')!;
        const [fx, fz] = plantLocal(pl, 0, pl.hd);
        expect(site.edges.some(e => e.nx === t.side.nx && e.nz === t.side.nz && Math.abs((e.nx ? fx - e.x0 : fz - e.z0) * (e.nx || e.nz) - SURFACE_PLANT.parapetT) < 0.05)).toBe(true);
      }
      if (plan.towers.length === 2) {
        const [a, b] = plan.towers;
        expect(footprintsOverlap(a.footprint, b.footprint)).toBe(false);
        expect(a.side.nx === b.side.nx && a.side.nz === b.side.nz).toBe(false);
      }
      // parts grounded (bases under the ground disc, a sane height); the duct rests on its sleepers
      for (const p of plan.parts) {
        if (p.kind === 'duct') {
          const sl = plan.parts.filter(q => q.kind === 'sleeper' && q.tower === p.tower);
          expect(sl.length).toBeGreaterThanOrEqual(1);
          for (const q of sl) { expect(q.y1).toBeCloseTo(p.y0, 3); expect(covers({...p, hw: p.hw + 0.3}, q)).toBe(true); }
          continue;
        }
        expect(p.y0).toBeLessThanOrEqual(site.y - 0.03);
        expect(p.y0).toBeGreaterThan(site.y - 0.5);
        expect(p.y1).toBeGreaterThan(p.y0 + 0.3);
      }
      // the compound wall: buttressed piers along the yard's edges, rising over the parapet
      const piers = plan.parts.filter(p => p.kind === 'pier');
      expect(piers.length).toBe(plan.stats.piers);
      expect(piers.length).toBeGreaterThanOrEqual(20);
      expect(plan.parts.filter(p => p.kind === 'buttress').length).toBe(piers.length);
      for (const p of piers) expect(p.y1).toBeGreaterThan(site.parapetY + 0.5);
      // the city honours the reserved lots: no building, wreck or rubble heap on them
      const city = planSurfaceCity(site, seed, inCatalogue, pit, plan.reserved);
      for (const q of city.placements) for (const r of plan.reserved) expect(footprintsOverlap(q, r), `${sd} city ${q.entry} on a plant lot`).toBe(false);
    }
    expect(sigs.size).toBeGreaterThan(1); // different seeds, different plants
  }, 300_000);

  it('two towers on every sample layout (the yard always has room on the far / lateral sides)', () => {
    for (const sd of SEEDS) expect(planOf(sd).plan.towers.length, `seed ${sd}`).toBe(2);
  }, 300_000);
});

describe('the surface plant builder', () => {
  it('one rotor InstancedMesh, instanced housings, few merged meshes; nothing walkable; spins the blades about the fan axis only', () => {
    const {site, plan} = planOf(SURFACE_SEEDS[0]);
    const fan = fakeFan();
    const v = buildSurfacePlant(site, plan, k => (k === PLANT_FAN_KEY ? fan.gltf : undefined), {concrete: tex(), steel: tex(), grating: tex()});
    const n = plan.towers.length;
    expect(PLANT_FAN_KEY).toBe('reactor-fanHousing');
    expect(v.rotors!.count).toBe(n);
    expect(v.rotors!.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage);
    expect(v.housings.length).toBe(1);
    expect(v.housings[0].count).toBe(n);
    expect(v.housings[0].geometry).toBe(fan.geometry); // the library's geometry, shared
    expect(v.stats.model).toBe(true);
    expect(v.stats.draws).toBeLessThanOrEqual(6);
    out(`builder: ${v.stats.draws} draws, ${v.stats.tris} triangles (fake housing), ${plan.parts.length} parts`);
    v.root.traverse(o => { if ((o as THREE.Mesh).isMesh) { expect((o as THREE.Mesh).castShadow, o.name).toBe(false); expect((o as THREE.Mesh).receiveShadow).toBe(false); } });
    // every merged vertex off the walkable cells and outside keepR; grounded (nothing far below the deck)
    const h = site.hole;
    let minY = Infinity;
    for (const m of v.meshes.filter(m => !(m as THREE.InstancedMesh).isInstancedMesh)) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        minY = Math.min(minY, y);
        expect(site.walk.some(w => x > w.x0 + 0.002 && x < w.x1 - 0.002 && z > w.z0 + 0.002 && z < w.z1 - 0.002), `${m.name} vertex ${x},${z} on the walk`).toBe(false);
        expect(Math.hypot(x - h.x, z - h.z)).toBeGreaterThan(h.keepR);
      }
    }
    expect(minY).toBeGreaterThan(site.y - 0.2);
    expect(minY).toBeLessThan(site.y - 0.03); // bases sunk under the ground disc (no gap)
    // the rotors: in the housing's duct ring, about its +Z axis
    const housing0 = Array.from({length: n}, (_, i) => { const m = new THREE.Matrix4(); v.housings[0].getMatrixAt(i, m); return m.clone(); });
    const rotorAt = (i: number) => { const m = new THREE.Matrix4(); v.rotors!.getMatrixAt(i, m); return m; };
    const axis = (m: THREE.Matrix4, k: 0 | 1 | 2) => new THREE.Vector3().setFromMatrixColumn(m, k).normalize();
    const before = Array.from({length: n}, (_, i) => rotorAt(i).clone());
    for (let i = 0; i < n; i++) {
      const t = plan.towers[i], r = rotorAt(i), hm = housing0[i];
      const local = new THREE.Vector3().setFromMatrixPosition(r).applyMatrix4(hm.clone().invert());
      expect(local.x).toBeCloseTo(0, 3);
      expect(local.y).toBeCloseTo(FAN_ANCHORS.ringY, 3);
      expect(local.z).toBeCloseTo(FAN_ANCHORS.bladeZ, 3);
      expect(axis(r, 2).dot(axis(hm, 2))).toBeCloseTo(1, 5); // the rotor's axis = the housing's +Z
      expect(axis(r, 2).x).toBeCloseTo(Math.sin(t.yaw), 5);
      expect(axis(r, 2).z).toBeCloseTo(Math.cos(t.yaw), 5);
      expect(new THREE.Vector3().setFromMatrixColumn(r, 0).length()).toBeCloseTo(t.bladeR, 4); // radius = the ring's blade radius
      expect(t.bladeR).toBeLessThan(FAN_ANCHORS.ringR * t.fanScale); // inside the duct ring
    }
    // resting until the surface shows ONLINE
    expect(v.tick(1 / 60, false, 1)).toBe(0);
    expect(v.tick(1 / 60, true, 0)).toBe(0);
    expect(v.started).toBe(false);
    for (let i = 0; i < n; i++) expect(rotorAt(i).equals(before[i])).toBe(true);
    // shown + online: spools up smoothly (no jump to full speed), then steady
    const speeds: number[] = [];
    let writes = 0;
    for (let f = 0; f < 60; f++) { writes += v.tick(1 / 60, true, 1); speeds.push(v.fans[0].speed); }
    expect(v.started).toBe(true);
    expect(writes).toBe(60 * n);
    expect(speeds[0]).toBeLessThan(0.02);
    expect(speeds[59]).toBeGreaterThan(0.2);
    expect(speeds[59]).toBeLessThan(0.5);
    for (let f = 1; f < 60; f++) expect(speeds[f]).toBeGreaterThan(speeds[f - 1]);
    for (let f = 0; f < 60 * 20; f++) v.tick(1 / 60, true, 1);
    expect(v.fans[0].speed).toBe(1);
    for (let i = 0; i < n; i++) {
      const r = rotorAt(i), b = before[i];
      expect(r.equals(b)).toBe(false);
      // same centre, same axis; the blades turned about it (the in-plane X axis rotated about Z)
      expect(new THREE.Vector3().setFromMatrixPosition(r).distanceTo(new THREE.Vector3().setFromMatrixPosition(b))).toBeLessThan(1e-6);
      expect(axis(r, 2).dot(axis(b, 2))).toBeCloseTo(1, 6);
      expect(Math.abs(axis(r, 0).dot(axis(b, 2)))).toBeLessThan(1e-6);
      const ang = Math.atan2(axis(r, 0).dot(axis(b, 1)), axis(r, 0).dot(axis(b, 0)));
      const want = ((v.fans[i].angle - plan.towers[i].phase) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      expect(Math.abs(ang - want)).toBeLessThan(1e-4);
      // the housings never move
      const hm = new THREE.Matrix4(); v.housings[0].getMatrixAt(i, hm);
      expect(hm.equals(housing0[i])).toBe(true);
    }
    // a steady rate (rev / s from the plan): one second advances 2 pi rev
    const a0 = v.fans[0].angle;
    for (let f = 0; f < 30; f++) v.tick(1 / 60, true, 1);
    const da = (v.fans[0].angle - a0 + 4 * Math.PI) % (2 * Math.PI);
    expect(da).toBeCloseTo((plan.towers[0].rev * Math.PI) % (2 * Math.PI), 3);
    // out of view: they keep turning (no upload), and resume writing when seen again
    const a1 = v.fans[0].angle;
    expect(v.tick(1 / 60, false, 1)).toBe(0);
    expect(v.fans[0].angle).not.toBe(a1);
    expect(v.tick(1 / 60, true, 1)).toBe(n);
    // dispose: what the plant owns is released, the library's GLB geometry is not
    const disposed = new Set<string>();
    for (const m of v.meshes) m.geometry.addEventListener('dispose', () => disposed.add(m.name));
    const parent = new THREE.Group();
    parent.add(v.root);
    v.dispose();
    expect(v.root.parent).toBeNull();
    for (const m of v.meshes) {
      if (m.geometry === fan.geometry) expect(disposed.has(m.name), m.name).toBe(false);
      else expect(disposed.has(m.name), m.name).toBe(true);
    }
  });

  it('without the fan GLB a procedural steel housing stands in and the rotors still spin', () => {
    const {site, plan} = planOf(SURFACE_SEEDS[1]);
    const v = buildSurfacePlant(site, plan, () => undefined, {concrete: null, steel: null, grating: null});
    expect(v.housings.length).toBe(0);
    expect(v.stats.model).toBe(false);
    expect(v.rotors!.count).toBe(plan.towers.length);
    for (let f = 0; f < 120; f++) v.tick(1 / 60, true, 1);
    expect(v.fans[0].speed).toBeGreaterThan(0.3);
    v.dispose();
  });
});

describe('the runtime: the plant under the outdoor view, the fans turning after the win', () => {
  it('built with the surface, hidden in the pit, spinning outside, released on teardown', () => {
    const fan = fakeFan();
    const L = surfaceLayout(SURFACE_SEEDS[2]), s = L.reactor!.surface!;
    const host = fakeSurfaceHost({[PLANT_FAN_KEY]: fan.gltf});
    const rt = new ReactorSurface(host).install();
    rt.findSky = () => ({clear: 1, beam: 1});
    for (const h of host.sectionHooks) h.build?.(L);
    const pv = rt.plantView!;
    expect(pv).toBeTruthy();
    expect(pv.root.parent).toBe(rt.view!.outdoor);
    expect(rt.plant!.towers.length).toBe(pv.fans.length);
    const step = (x: number, y: number, z: number) => { poseCamera(host.camera, x, y, z, 0, 0); for (const f of host.frameHooks) f(1 / 60); };
    // in the pit (under the deck, over the core): the outdoor group is hidden, the fans rest
    const o = s.hole;
    for (let i = 0; i < 30; i++) step(o.x, s.y - 12, o.z);
    expect(rt.view!.outdoor.visible).toBe(false);
    expect(pv.started).toBe(false);
    // on the plaza: shown, spinning up
    const w = s.walk[0];
    for (let i = 0; i < 120; i++) step((w.x0 + w.x1) / 2, s.y + 1.62, (w.z0 + w.z1) / 2);
    expect(rt.view!.outdoor.visible).toBe(true);
    expect(pv.started).toBe(true);
    expect(pv.fans.every(f => f.speed > 0.3)).toBe(true);
    for (const h of host.sectionHooks) h.teardown?.();
    expect(rt.plantView).toBeNull();
    expect(pv.root.parent).toBeNull();
  });
});
