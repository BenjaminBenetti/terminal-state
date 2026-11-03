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
import {FAN_ANCHORS, SURFACE_COLLAR, SURFACE_PLANT, planSurfacePlant, plantLocal, type SurfacePlantPlan, type VentTowerPlan} from '../src/world/reactor/surfacePlantPlan';
import {PLANT_FAN_KEY, buildSurfacePlant, filmGapGeometry} from '../src/world/reactor/surfacePlant';
import {filmGeometry} from '../src/world/reactor/surfaceCity';
import {RING_VIEW} from '../src/world/reactor/endingViews';
import {REACTOR_MODELS} from '../src/world/reactor/archAssets';
import {ReactorSurface} from '../src/world/reactor/surface';
import {SURFACE_SEEDS, fakeSurfaceHost, inCatalogue, poseCamera, surfaceLayout} from './reactor-surface-fixture';
import {loadStripped} from './helpers/openablesFixture';
import {PLANT_LOOK, plantPulseAt} from '../src/world/reactor/surfacePlantLook';
import {GLSLNodeBuilder, WGSLNodeBuilder, type WebGPURenderer} from 'three/webgpu';
import {rendererFor} from './helpers/fogCompile';
import {setAttributeInstancing} from '../src/render/instancing';

// (the reactor-surface-rain test's shader census: uniform buffers / textures per stage of a compiled node material)
const ubos = (src: string, backend: 'glsl' | 'wgsl') => backend === 'wgsl' ? (src.match(/var<uniform>/g) ?? []).length : (src.match(/^(layout\(\s*std140\s*\)\s*)?uniform\s+\w+\s*\{/gm) ?? []).length;
const texs = (src: string, backend: 'glsl' | 'wgsl') => backend === 'wgsl' ? (src.match(/^@binding\(.*\) var \w+ : texture_/gm) ?? []).length : (src.match(/^uniform\s+(highp\s+|mediump\s+|lowp\s+)?\w*sampler\w*\s+\w+;/gm) ?? []).length;
function compileMesh(mesh: THREE.Mesh, backend: 'glsl' | 'wgsl'): {vertex: string; fragment: string} {
  const r = rendererFor(backend) as WebGPURenderer;
  const caps = (r.backend as unknown as {capabilities?: {getUniformBufferLimit(): number; llStub?: boolean}}).capabilities;
  if (caps && !caps.llStub) { const f = caps.getUniformBufferLimit.bind(caps); caps.getUniformBufferLimit = () => { try { return f(); } catch { return 65536; } }; caps.llStub = true; }
  const B = (backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder) as unknown as new (o: THREE.Object3D, r: WebGPURenderer) => {scene: THREE.Scene; camera: THREE.Camera; build(): void; vertexShader?: string; fragmentShader?: string};
  const scene = new THREE.Scene(), parent = mesh.parent;
  scene.add(mesh);
  const b = new B(mesh, r);
  const camera = new THREE.PerspectiveCamera();
  b.scene = scene;
  b.camera = camera;
  const lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene, c: THREE.Camera): {setLights(l: THREE.Light[]): void}}}).lighting.getNode(scene, camera);
  lightsNode.setLights([]);
  (b as unknown as {lightsNode: unknown}).lightsNode = lightsNode;
  b.build();
  scene.remove(mesh);
  if (parent) parent.add(mesh);
  return {vertex: b.vertexShader ?? '', fragment: b.fragmentShader ?? ''};
}

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
      // the first view outside: from the exit, every tower's fan stands clear of the beam's column (>= 10 degrees off the aperture)
      const ex = surfaceLayout(sd).reactor!.surface!.exit;
      for (const t of plan.towers) {
        const bh = Math.atan2(h.z - ex.z, h.x - ex.x), bt = Math.atan2(t.z - ex.z, t.x - ex.x);
        const d = Math.abs(((bt - bh + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
        out(`  tower ${t.id}: ${d.toFixed(1)} deg off the beam from the exit`);
        expect(d, `${sd} tower ${t.id} behind the beam from the exit`).toBeGreaterThan(10);
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
      for (const p of piers) expect(p.y1).toBeGreaterThan(site.parapetY + 0.3);
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
    expect(v.stats.draws).toBeLessThanOrEqual(11); // (5 for the towers / wall + 3 for the flat collar: concrete, hatching, film gap + 3 for the night dressing: tower concrete, lamp heads, glow cards)
    out(`builder: ${v.stats.draws} draws, ${v.stats.tris} triangles (fake housing), ${plan.parts.length} parts; collar ${JSON.stringify(v.stats.collar)}`);
    v.root.traverse(o => { if ((o as THREE.Mesh).isMesh) { expect((o as THREE.Mesh).castShadow, o.name).toBe(false); expect((o as THREE.Mesh).receiveShadow).toBe(false); } });
    // every merged vertex outside keepR; off the walkable cells unless it is a FLAT overlay (the collar layer: at most maxUp over the
    // deck — the raised structures' footprints are pinned off the walk by the plan test); grounded (nothing far below the deck)
    const h = site.hole;
    let minY = Infinity;
    for (const m of v.meshes.filter(m => !(m as THREE.InstancedMesh).isInstancedMesh)) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        minY = Math.min(minY, y);
        if (y > site.y + SURFACE_COLLAR.maxUp + 1e-6) expect(site.walk.some(w => x > w.x0 + 0.002 && x < w.x1 - 0.002 && z > w.z0 + 0.002 && z < w.z1 - 0.002), `${m.name} raised vertex ${x},${y},${z} on the walk`).toBe(false);
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

  it('the real fan GLB (the cooked Meshy housing): its back flange on the stack face, centred on the hub, the rotor inside its ring', async () => {
    const {site, plan} = planOf(SURFACE_SEEDS[3]);
    const gltf = await loadStripped(REACTOR_MODELS.fanHousing.url);
    const v = buildSurfacePlant(site, plan, k => (k === PLANT_FAN_KEY ? gltf : undefined), {concrete: null, steel: null, grating: null});
    try {
      expect(v.housings.length).toBeGreaterThanOrEqual(1);
      out(`real housing: ${v.housings.length} part(s), ${v.stats.draws} draws, ${v.stats.tris} triangles for ${plan.towers.length} towers`);
      plan.towers.forEach((t, i) => {
        // the placed housing's bounds in the tower's frame (origin = the stack's centre at the deck, +Z = toward the plaza)
        const inv = new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw), new THREE.Vector3(1, 1, 1)).invert();
        const b = new THREE.Box3(), m = new THREE.Matrix4(), q = new THREE.Vector3();
        for (const im of v.housings) {
          im.getMatrixAt(i, m);
          const pos = im.geometry.getAttribute('position');
          for (let k = 0; k < pos.count; k++) b.expandByPoint(q.fromBufferAttribute(pos, k).applyMatrix4(m).applyMatrix4(inv));
        }
        const s = t.fanScale, hub = t.fan.hubY - t.y;
        out(`tower ${t.id}: housing x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)} y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)} z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)} (stack face z ${t.hd}, hub y ${hub.toFixed(2)})`);
        expect(Math.abs(b.min.z - t.hd)).toBeLessThan(0.05 * s); // the back flange on the face
        expect(Math.abs((b.min.x + b.max.x) / 2)).toBeLessThan(0.05 * s);
        expect(Math.abs((b.min.y + b.max.y) / 2 - hub)).toBeLessThan(0.05 * s);
        expect(b.max.x - b.min.x).toBeLessThan(2 * t.hw - 0.8); // on the face between the corner pilasters
        expect(b.max.z).toBeLessThan(t.hd + t.reach); // over the duct run, never past the parapet
        expect(b.min.y).toBeGreaterThan(SURFACE_PLANT.duct.bottom + SURFACE_PLANT.duct.h + 0.4);
        // the rotor: centred on the hub just inside the ring's mouth, radius < the ring radius
        const r = new THREE.Matrix4(); v.rotors!.getMatrixAt(i, r);
        const c = new THREE.Vector3().setFromMatrixPosition(r).applyMatrix4(inv);
        expect(c.y).toBeCloseTo(hub, 4);
        expect(c.z).toBeGreaterThan(b.min.z);
        expect(c.z).toBeLessThan(b.max.z);
      });
    } finally {
      v.dispose();
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

describe('the flat engineered collar round the aperture (no collision: a flat overlay on the deck)', () => {
  /** Every vertex of a mesh (world: the plant's meshes have identity transforms). */
  const verts = (m: THREE.Mesh) => { const p = m.geometry.getAttribute('position'), out: THREE.Vector3[] = []; for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i)); return out; };
  /** The axis-aligned rects of a cell-quad film geometry (6 vertices per cell). */
  const rects = (g: THREE.BufferGeometry | null) => {
    const out: {x0: number; z0: number; x1: number; z1: number}[] = [];
    if (!g) return out;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i += 6) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 6; k++) { x0 = Math.min(x0, p.getX(i + k)); x1 = Math.max(x1, p.getX(i + k)); z0 = Math.min(z0, p.getZ(i + k)); z1 = Math.max(z1, p.getZ(i + k)); }
      out.push({x0, z0, x1, z1});
    }
    return out;
  };

  it('flat (<= 2 cm over the deck), on the walk / the ring footprint, outside the opening, faces up; deterministic, 16..24 segments', () => {
    for (const sd of SEEDS) {
      const {site, plan, pit, seed} = planOf(sd);
      const c = plan.collar, h = site.hole;
      expect(JSON.stringify(planSurfacePlant(site, seed, pit).collar)).toBe(JSON.stringify(c));
      expect(c.segments).toBeGreaterThanOrEqual(16);
      expect(c.segments).toBeLessThanOrEqual(24);
      expect(c.x).toBe(h.x);
      expect(c.z).toBe(h.z);
      expect(c.kerb[0]).toBeGreaterThanOrEqual(h.ringR1); // outward from the railing ring's apron
      expect(c.drain[1] - h.ringR1).toBeGreaterThan(3.5);
      expect(c.drain[1] - h.ringR1).toBeLessThan(5);
      const v = buildSurfacePlant(site, plan, () => undefined, {concrete: null, steel: null, grating: null});
      try {
        const col = v.collar.concrete!, hat = v.collar.hatch!, fg = v.collar.film!;
        expect(col && hat && fg).toBeTruthy();
        const inWalk = (x: number, z: number) => site.walk.some(w => x >= w.x0 - 1e-3 && x <= w.x1 + 1e-3 && z >= w.z0 - 1e-3 && z <= w.z1 + 1e-3);
        const onRing = (x: number, z: number) => { const r = Math.hypot(x - h.x, z - h.z); return r >= h.ringR0 - 1e-3 && r <= h.ringR1 + 1e-3; };
        for (const m of [col, hat, fg]) {
          for (const p of verts(m)) {
            expect(p.y, `${m.name} raised`).toBeLessThanOrEqual(site.y + SURFACE_COLLAR.maxUp + 1e-6);
            expect(p.y).toBeGreaterThan(site.y);
            expect(Math.hypot(p.x - h.x, p.z - h.z), `${m.name} inside the opening`).toBeGreaterThanOrEqual(h.r);
            expect(inWalk(p.x, p.z) || onRing(p.x, p.z), `${m.name} vertex ${p.x},${p.z} off the walk / ring`).toBe(true);
          }
          // every triangle faces up (seen from above; no back faces culled away)
          const ps = verts(m);
          for (let i = 0; i < ps.length; i += 3) expect(new THREE.Vector3().subVectors(ps[i + 1], ps[i]).cross(new THREE.Vector3().subVectors(ps[i + 2], ps[i])).y, m.name).toBeGreaterThan(0);
        }
        // the collar's concrete: only the annulus kerb .. ring B, never past the drainage channel
        for (const p of verts(col)) { const r = Math.hypot(p.x - h.x, p.z - h.z); expect(r).toBeGreaterThanOrEqual(c.kerb[0] - 1e-3); expect(r).toBeLessThanOrEqual(c.rings[1][1] + 1e-3); }
        // the steel / grille batches near the aperture (anchor plates, bolt heads, the channel) are flat too
        for (const m of v.meshes.filter(q => /plant-(steel|grille)$/.test(q.name))) for (const p of verts(m)) {
          if (Math.hypot(p.x - h.x, p.z - h.z) < c.drain[1] + 0.2) expect(p.y, m.name).toBeLessThanOrEqual(site.y + SURFACE_COLLAR.maxUp + 1e-6);
        }
        // depth: the collar layer between the deck (no offset) and the film (lane SURFACE's -2): the film still draws over it
        const film = (fg.material as THREE.Material);
        for (const m of [col, hat]) {
          const mt = m.material as THREE.Material;
          expect(mt.polygonOffset).toBe(true);
          expect(mt.polygonOffsetFactor).toBeLessThan(0);
          expect(mt.polygonOffsetFactor).toBeGreaterThan(film.polygonOffsetFactor);
        }
        expect(fg.renderOrder).toBe(1);
        expect(film.transparent && !film.depthWrite).toBe(true);
        // the segments: precast pieces with joints (the concrete is not one solid disc: points on a joint line are bare)
        const ra = (c.rings[0][0] + c.rings[0][1]) / 2, jointA = c.phase; // a radial joint of ring A
        const tri = verts(col);
        const covered = (x: number, z: number) => { for (let i = 0; i < tri.length; i += 3) { const [a, b, q] = [tri[i], tri[i + 1], tri[i + 2]]; const d = (b.x - a.x) * (q.z - a.z) - (q.x - a.x) * (b.z - a.z); const u = ((b.x - x) * (q.z - z) - (q.x - x) * (b.z - z)) / d, w = ((q.x - x) * (a.z - z) - (a.x - x) * (q.z - z)) / d; if (u >= 0 && w >= 0 && u + w <= 1) return true; } return false; };
        expect(covered(h.x + Math.cos(jointA) * ra, h.z + Math.sin(jointA) * ra)).toBe(false);
        expect(covered(h.x + Math.cos(jointA + Math.PI / c.segments) * ra, h.z + Math.sin(jointA + Math.PI / c.segments) * ra)).toBe(true);
        out(`seed ${sd} collar: ${c.segments} segments, radii ${c.kerb[0]}..${c.drain[1]}; ${JSON.stringify(v.stats.collar)}; ${RING_VIEW.posts} anchor plates`);
      } finally {
        v.dispose();
      }
    }
  }, 300_000);

  it('lane SURFACE\'s wet film + the collar\'s film gap cover the collar\'s walk exactly once (no dry seam, no double darkening)', () => {
    for (const sd of SEEDS.slice(0, 4)) {
      const {site, plan} = planOf(sd);
      const h = site.hole, reach = plan.collar.drain[1] + 0.6;
      const film = rects(filmGeometry(site)), gap = rects(filmGapGeometry(site, reach));
      expect(gap.length).toBeGreaterThan(0);
      const inR = (r: {x0: number; z0: number; x1: number; z1: number}, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
      let samples = 0;
      for (let x = h.x - reach; x <= h.x + reach; x += 0.237) for (let z = h.z - reach; z <= h.z + reach; z += 0.229) {
        const r = Math.hypot(x - h.x, z - h.z);
        if (r < h.ringR1 || r > plan.collar.drain[1] + 0.3) continue; // the collar (the apron hides the film inside r1)
        if (!site.walk.some(w => inR(w, x, z))) continue;
        if (site.shelters.some(s => inR(s.rect, x, z))) continue;
        const n = film.filter(q => inR(q, x, z)).length + gap.filter(q => inR(q, x, z)).length;
        expect(n, `seed ${sd} at ${x.toFixed(2)},${z.toFixed(2)} (r ${r.toFixed(2)})`).toBe(1);
        samples++;
      }
      expect(samples).toBeGreaterThan(1000);
      // the gap film lies at the film's own height, never over the opening
      for (const q of gap) expect(Math.hypot(Math.max(h.x - q.x1, 0, q.x0 - h.x), Math.max(h.z - q.z1, 0, q.z0 - h.z))).toBeGreaterThanOrEqual(h.keepR - 1e-6);
    }
  });
});

describe('the towers\' night dressing (red obstruction lights, sodium work lights, glows): visible in the rainy dusk', () => {
  it('4 red obstruction lights on each stack\'s cap corners, 3 sodium work lights at the fan, a halo behind each rotor; towers blink out of phase', () => {
    for (const sd of SEEDS) {
      const {site, plan} = planOf(sd);
      const v = buildSurfacePlant(site, plan, () => undefined, {concrete: null, steel: null, grating: null});
      try {
        const D = v.dressing, n = plan.towers.length;
        expect(D.lamps.length).toBe(7 * n);
        expect(D.cards.length).toBe(8 * n);
        expect(D.heads!.count).toBe(D.lamps.length);
        expect(D.glows!.count).toBe(D.cards.length);
        expect(D.towers).toBeTruthy();
        expect(D.tune!.tone.value).toBe(PLANT_LOOK.towerTone);
        expect(PLANT_LOOK.towerTone).toBeGreaterThan(1); // the towers a touch lighter than the parapet's finish
        for (const t of plan.towers) {
          const inv = new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw), new THREE.Vector3(1, 1, 1)).invert();
          const local = (p: {x: number; y: number; z: number}) => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(inv);
          const red = D.lamps.filter(l => l.tower === t.id && l.kind === 'obstruction'), work = D.lamps.filter(l => l.tower === t.id && l.kind === 'work');
          expect(red.length).toBe(4);
          expect(work.length).toBe(3);
          // red: over the cap (above the stack's top, inside the cap's corners), red, pulsing in the tower's own phase
          const corners = new Set<string>();
          for (const l of red) {
            const q = local(l);
            expect(q.y).toBeGreaterThan(t.h + 0.5);
            expect(q.y).toBeLessThan(t.h + 1.5);
            expect(Math.abs(q.x)).toBeLessThan(t.hw - 0.55 + 0.45);
            expect(Math.abs(q.z)).toBeLessThan(t.hd - 0.55 + 0.45);
            expect(Math.abs(q.x)).toBeGreaterThan(t.hw - 0.55); // outside the cowl
            corners.add(`${Math.sign(q.x)},${Math.sign(q.z)}`);
            expect(l.color[0]).toBeGreaterThan(5 * l.color[1]);
            expect(l.blink).toEqual([t.blink, 1]);
          }
          expect(corners.size).toBe(4);
          // sodium: at the fan (the platform's front corners, over the housing), warm, steady
          const s = t.fanScale, hub = t.fan.hubY - t.y;
          for (const l of work) {
            const q = local(l);
            expect(Math.abs(q.x)).toBeLessThan(FAN_ANCHORS.plateW * s / 2 + 0.6);
            expect(q.y).toBeGreaterThan(hub - FAN_ANCHORS.ringY * s - 0.5);
            expect(q.y).toBeLessThan(hub + (FAN_ANCHORS.plateH - FAN_ANCHORS.ringY) * s + 1.2);
            expect(q.z).toBeGreaterThan(t.hd);
            expect(q.z).toBeLessThan(t.hd + FAN_ANCHORS.depth * s + 1);
            expect(l.color[0]).toBeGreaterThan(l.color[1]);
            expect(l.color[1]).toBeGreaterThan(l.color[2]);
            expect(l.blink[1]).toBe(0);
          }
          // the halo behind the rotor: centred on the hub, between the face and the blades, never pulled toward the eye
          const halo = D.cards.filter(c => c.tower === t.id && c.kind === 'halo');
          expect(halo.length).toBe(1);
          const hq = local(halo[0]);
          expect(hq.y).toBeCloseTo(hub, 4);
          expect(hq.z).toBeGreaterThan(t.hd);
          expect(hq.z).toBeLessThan(t.hd + FAN_ANCHORS.bladeZ * s - FAN_ANCHORS.back * s);
          expect(halo[0].pull).toBe(0);
        }
        // out of phase: the towers' pulses differ by a good part of a cycle; at tower 0's peak tower 1 is dim
        if (n === 2) {
          const [a, b] = plan.towers, d = Math.abs(a.blink - b.blink), cyc = Math.min(d, 1 - d);
          expect(cyc).toBeGreaterThan(0.3);
          const tPeak = (1 - a.blink) % 1;
          expect(plantPulseAt(tPeak, a.blink, 1)).toBeCloseTo(1, 5);
          expect(plantPulseAt(tPeak, b.blink, 1)).toBeLessThan(0.5);
        }
        // the heads / cards where the lists say (instance matrices), the cards translation-only (camera-facing in the shader)
        const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        D.lamps.forEach((l, i) => { D.heads!.getMatrixAt(i, m); m.decompose(p, q, sc); expect(p.distanceTo(new THREE.Vector3(l.x, l.y, l.z))).toBeLessThan(1e-4); expect(sc.x).toBeCloseTo(l.size[0], 4); });
        D.cards.forEach((c, i) => { D.glows!.getMatrixAt(i, m); m.decompose(p, q, sc); expect(p.distanceTo(new THREE.Vector3(c.x, c.y, c.z))).toBeLessThan(1e-4); expect(sc.x).toBeCloseTo(1, 6); expect(Math.abs(q.w)).toBeCloseTo(1, 6); });
        const gm = D.glows!.material as THREE.Material;
        expect(gm.transparent && !gm.depthWrite && gm.blending === THREE.AdditiveBlending).toBe(true);
        expect(D.glows!.renderOrder).toBeGreaterThan(1); // after the wet film
        // nothing per frame: spinning the fans never touches the lamps / cards
        const hv = D.heads!.instanceMatrix.version, gv = D.glows!.instanceMatrix.version;
        for (let f = 0; f < 30; f++) v.tick(1 / 60, true, 1);
        expect(D.heads!.instanceMatrix.version).toBe(hv);
        expect(D.glows!.instanceMatrix.version).toBe(gv);
        out(`seed ${sd} dressing: ${D.lamps.length} lamps, ${D.cards.length} cards, blink ${plan.towers.map(t => t.blink).join(' / ')}; ${v.stats.draws} draws`);
      } finally {
        v.dispose();
      }
    }
  });

  it('the dressing\'s materials compile on both backends within WebGPU\'s 12 uniform buffers per stage', () => {
    const {site, plan} = planOf(SURFACE_SEEDS[0]);
    const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    t.needsUpdate = true;
    const v = buildSurfacePlant(site, plan, () => undefined, {concrete: t, steel: t, grating: t});
    try {
      const D = v.dressing;
      const meshes: [string, THREE.Mesh][] = [['towers', new THREE.Mesh(D.towers!.geometry, D.towers!.material)], ['lamps', D.heads!], ['glows', D.glows!]];
      for (const backend of ['glsl', 'wgsl'] as const) for (const attr of [true, false]) {
        setAttributeInstancing(attr);
        try {
          for (const [name, mesh] of meshes) {
            const c = compileMesh(mesh, backend);
            expect(c.fragment.length, name).toBeGreaterThan(200);
            for (const [stage, src] of [['vertex', c.vertex], ['fragment', c.fragment]] as const) {
              out(`${name} ${backend} attr=${attr} ${stage}: uniform buffers ${ubos(src, backend)}, textures ${texs(src, backend)}`);
              expect(ubos(src, backend), `${name} ${backend} ${stage}`).toBeLessThanOrEqual(12);
              expect(texs(src, backend), `${name} ${backend} ${stage}`).toBeLessThanOrEqual(2);
            }
          }
        } finally {
          setAttributeInstancing(false);
        }
      }
    } finally {
      v.dispose();
    }
  }, 300_000);
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
