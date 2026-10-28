// Iteration 12 (ATMOS): smoke + scatter-light API of the volumetric atmosphere (render/smoke.ts, render/volumetric.ts) — the
// light lane's thrown flare calls addSmokeEmitter({x, y, z, color, rate, radius, life}) -> handle (setPos / update / stop) and
// addScatterLight / removeScatterLight for its red PointLight. Lifecycle, caps, cleanup (stop, new station, dispose), puff
// motion (rises, drifts, pools under the ceiling, never through walls), occlusion windows, and the uniforms the march reads.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {generateStation, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {
  PUFF_DENSITY, SMOKE_LIMITS, ScatterLights, SmokeField, VIS_RES, computeVisWindow, gridLineOfSight, puffKernel, smokeTint, spawnInterval, windowStale,
} from '../src/render/smoke';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {VF_LIMITS, VF_MARCH} from '../src/render/volumetricShaders';

const run = (f: SmokeField, s: number, dt = 1 / 60) => { for (let t = 0; t < s; t += dt) f.step(dt); };
const stations = new Map<number, StationLayout>();
const station = (seed: number) => { let s = stations.get(seed); if (!s) stations.set(seed, (s = generateStation(seed))); return s; };
/** The flare's request (weapons/throwables.ts FLARE.smoke). */
const FLARE = {color: 0xc0261a, rate: 1, radius: 1.4, life: 7};

describe('smoke emitters: lifecycle and caps', () => {
  it('emits bounded puffs that rise, grow and thin; stop() fades the plume out and frees the slot', () => {
    const f = new SmokeField();
    const h = f.add({x: 0, y: 0.05, z: 0, ...FLARE});
    expect(h.alive && h.emitting).toBe(true);
    run(f, 0.1);
    expect(f.puffCount).toBe(1); // the first puff right away
    run(f, 20);
    const e = f.emitters[0];
    // rate 1/s x life 7 s would need 7; the cap stretches the interval so a plume never exceeds puffsPerEmitter
    expect(e.puffs.length).toBeLessThanOrEqual(SMOKE_LIMITS.puffsPerEmitter);
    expect(e.puffs.length).toBeGreaterThanOrEqual(5);
    expect(spawnInterval(10, 7)).toBeCloseTo(7 / SMOKE_LIMITS.puffsPerEmitter, 9);
    const young = e.puffs.at(-1)!, old = e.puffs[0];
    expect(old.y).toBeGreaterThan(young.y + 0.5); // rose
    expect(old.r).toBeGreaterThan(young.r * 2);   // grew
    expect(young.d).toBeLessThanOrEqual(PUFF_DENSITY * 1.0001);
    expect(old.d).toBeLessThan(e.puffs[e.puffs.length - 2].d + 1e-9); // thinner as it grows
    // stop: no new puffs; gone within the fade; handle inert, slot free
    h.stop(2);
    expect(h.emitting).toBe(false);
    expect(h.alive).toBe(true);
    const n0 = f.puffCount;
    run(f, 1);
    expect(f.puffCount).toBeLessThanOrEqual(n0);
    run(f, 1.2);
    expect(h.alive).toBe(false);
    expect(f.emitters.length).toBe(0);
    h.update({x: 5}); h.setPos(1, 2, 3); h.stop(); // inert, no throw
    expect(f.stats).toMatchObject({added: 1, stopped: 1, finished: 1});
  });

  it('at most SMOKE_LIMITS.emitters: a fifth evicts the oldest stopping one, else the oldest; clear() drops all', () => {
    const f = new SmokeField();
    const hs = [0, 1, 2, 3].map(i => f.add({x: i * 3, y: 0, z: 0}));
    run(f, 3);
    hs[1].stop(10);
    const fifth = f.add({x: 20, y: 0, z: 0});
    expect(f.emitters.length).toBe(SMOKE_LIMITS.emitters);
    expect(hs[1].alive).toBe(false); // the stopping one went first
    expect(hs[0].alive && fifth.alive).toBe(true);
    const sixth = f.add({x: 30, y: 0, z: 0});
    expect(hs[0].alive).toBe(false); // then the oldest
    expect(sixth.alive).toBe(true);
    expect(f.stats.evicted).toBe(2);
    run(f, 10);
    expect(f.puffCount).toBeLessThanOrEqual(SMOKE_LIMITS.emitters * SMOKE_LIMITS.puffsPerEmitter);
    f.clear();
    expect(f.emitters.length + f.puffCount).toBe(0);
    expect([fifth, sixth, ...hs].some(x => x.alive)).toBe(false);
  });

  it('update / setPos move the emitter (a flare in flight); puffs already out keep drifting where they are', () => {
    const f = new SmokeField();
    const h = f.add({x: 0, y: 1, z: 0, rate: 4, life: 3});
    run(f, 1);
    const first = f.emitters[0].puffs[0];
    const x0 = first.x;
    for (let i = 0; i < 60; i++) { h.update({x: i * 0.05, y: 1, z: 0}); f.step(1 / 60); }
    expect(f.emitters[0].x).toBeCloseTo(59 * 0.05, 6);
    expect(Math.abs(first.x - x0)).toBeLessThan(0.5);
    expect(f.emitters[0].puffs.at(-1)!.x).toBeGreaterThan(2);
    h.update({color: 0x00ff00, radius: 2, rate: 0.5, life: 4, density: 0.5});
    expect(f.emitters[0].tint[1]).toBe(1);
    expect(f.emitters[0].radius).toBe(2);
  });

  it('puffs pool under the local ceiling, stay above the floor, drift with the air and never cross walls', () => {
    const g = new Grid(20, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) g.set(x, y, x === 10 ? SOLID : FLOOR); // a wall at x 5.0-5.5 m
    const f = new SmokeField();
    f.env = {
      band: () => ({floor: 0, ceil: 2.6}),
      open: (x, _y, z) => { const [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] !== SOLID; },
      drift: () => [0.35, 0, 0], // toward the wall
    };
    f.add({x: 4.2, y: 0.05, z: 5, rate: 2, radius: 1.2, life: 9});
    let maxTop = 0, minY = Infinity, maxX = -Infinity;
    for (let t = 0; t < 25; t += 1 / 30) {
      f.step(1 / 30);
      for (const q of f.emitters[0].puffs) { maxTop = Math.max(maxTop, q.y + 0.45 * q.r); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); }
    }
    expect(maxTop).toBeLessThanOrEqual(2.6 - 0.08 + 1e-6);
    expect(minY).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(maxX).toBeLessThan(5.0); // the wall cell starts at x = 5.0
    expect(maxX).toBeGreaterThan(4.6); // but it did drift toward it
  });

  it('density kernel, tint and the CPU density mirror', () => {
    const q = {x: 0, y: 1, z: 0, r: 0.5, d: 2};
    expect(puffKernel([0, 1, 0], q)).toBe(2);
    expect(puffKernel([0.5, 1, 0], q)).toBe(0);
    expect(puffKernel([0.25, 1, 0], q)).toBeCloseTo(2 * 0.75 ** 2, 9);
    const red = smokeTint(0xc0261a);
    expect(red[0]).toBe(1);
    expect(red[1]).toBeLessThan(0.35);
    expect(Math.min(...red)).toBeGreaterThanOrEqual(0.25); // smoke scatters every wavelength a little
    expect(smokeTint(undefined).every(v => v > 0.9)).toBe(true); // default grey
    const f = new SmokeField();
    f.add({x: 0, y: 0, z: 0, ...FLARE});
    run(f, 4);
    const b = f.bound(f.emitters[0])!;
    const at = f.densityAt([b[0], b[1], b[2]]);
    expect(at.sigma).toBeGreaterThan(0);
    expect(at.tinted[0]).toBeCloseTo(at.sigma, 9);
    expect(at.tinted[1]).toBeLessThan(at.sigma * 0.4);
    expect(f.densityAt([b[0] + b[3] + 0.5, b[1], b[2]]).sigma).toBe(0); // nothing outside the bound
  });
});

describe('scatter lights + occlusion windows', () => {
  it('registry: at most SMOKE_LIMITS.scatterLights, idempotent add, remove, clear', () => {
    const s = new ScatterLights();
    const ls = Array.from({length: 6}, () => new THREE.PointLight(0xff2a12, 7, 10, 2));
    expect(ls.map(l => s.add(l))).toEqual([true, true, true, true, false, false]);
    expect(s.add(ls[0])).toBe(true);
    expect(s.list.length).toBe(SMOKE_LIMITS.scatterLights);
    expect(s.remove(ls[1])).toBe(true);
    expect(s.remove(ls[1])).toBe(false);
    expect(s.add(ls[4])).toBe(true);
    s.clear();
    expect(s.list.length).toBe(0);
  });

  it('a window sees its own room and is dark behind walls; recomputed only when the source moved', () => {
    const g = new Grid(60, 60);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) g.set(x, y, x === 30 && (y < 25 || y > 27) ? SOLID : FLOOR); // wall at x 15 m with a 1.5 m doorway
    expect(gridLineOfSight(g, 10, 5, 20, 5)).toBe(false);
    expect(gridLineOfSight(g, 10, 13, 20, 13)).toBe(true); // through the doorway (z 12.5-14)
    const out = new Uint8Array(VIS_RES * VIS_RES);
    const w = computeVisWindow({x: 12, y: 0.3, z: 5}, {grid: () => ({grid: g, floor: 0, ceil: 3})}, out)!;
    const at = (x: number, z: number) => out[Math.floor((z - w.z0) / CELL) * VIS_RES + Math.floor((x - w.x0) / CELL)];
    expect(at(12, 5)).toBe(255);
    expect(at(14, 9)).toBe(255);   // same room
    expect(at(17, 5)).toBe(0);     // behind the wall
    expect(w).toMatchObject({floor: 0, ceil: 3});
    expect(VIS_RES * CELL).toBeGreaterThanOrEqual(20); // covers the flare light's 10 m reach either side
    const st = {winX: NaN, winY: NaN, winZ: NaN, winT: -Infinity};
    expect(windowStale(st, 0, 0, 0, 0)).toBe(true);
    Object.assign(st, {winX: 0, winY: 0, winZ: 0, winT: 0});
    expect(windowStale(st, 1, 0, 0, 0.1)).toBe(false); // throttled
    expect(windowStale(st, 0.1, 0, 0, 1)).toBe(false); // barely moved
    expect(windowStale(st, 1, 0, 0, 1)).toBe(true);
  });
});

describe('atmosphere API (game.atmosphere, no GL)', () => {
  function rig() {
    const flashlight = new THREE.SpotLight(0xfff4e2, 34, 30, 0.58, 0.7, 1.2);
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
    camera.add(flashlight, flashlight.target);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x090b0a, 0.043);
    scene.add(camera);
    const a = new VolumetricAtmosphere(null, {flashlight}, 'high');
    return {a, scene, camera};
  }

  it('flare usage: emitter + scatter light packed into the march uniforms, windowed on the station grid; cleared by a new station', () => {
    const {a, scene, camera} = rig();
    const l = station(1);
    a.setStation(l, null);
    const sp = l.playerSpawn;
    camera.position.set(sp.x, 1.6, sp.z);
    const light = new THREE.PointLight(0xff2a12, 7, 10, 2);
    light.position.set(sp.x + 1, 0.15, sp.z);
    scene.add(light);
    expect(a.addScatterLight(light)).toBe(true);
    const h = a.addSmokeEmitter({x: sp.x + 1, y: 0.05, z: sp.z, ...FLARE});
    for (let i = 0; i < 180; i++) { h.update({x: sp.x + 1, y: 0.05, z: sp.z}); a.sync(scene, camera, i / 60); }
    const u = a.march.uniforms;
    expect(u.uScatCount.value).toBe(1);
    expect(u.uSmokeCount.value).toBe(1);
    const tint = (u.uSmokeTint.value as THREE.Vector4[])[0];
    expect(tint.x).toBe(1);
    expect(tint.w).toBeGreaterThanOrEqual(2); // puffs in this emitter
    const col = (u.uScatCol.value as THREE.Vector4[])[0];
    expect(col.x).toBeGreaterThan(col.y * 10); // red
    const win = u.uWin.value as THREE.Vector4[];
    expect(win[0].w).toBeGreaterThanOrEqual(0);                  // light window bound
    expect(win[VF_LIMITS.scatter].w).toBeGreaterThanOrEqual(SMOKE_LIMITS.scatterLights); // smoke window layer 4..7
    const d = a.debug();
    expect(d.smoke).toMatchObject({emitters: 1, limits: SMOKE_LIMITS});
    expect(d.scatter).toMatchObject({lights: 1, active: 1});
    expect(d.scatter.windows).toBeGreaterThanOrEqual(2);
    // a light that is off is not packed
    light.intensity = 0;
    a.sync(scene, camera, 4);
    expect(u.uScatCount.value).toBe(0);
    light.intensity = 7;
    // the flare burns out: the light lane removes its light and stops the smoke
    expect(a.removeScatterLight(light)).toBe(true);
    h.stop(1);
    for (let i = 0; i < 90; i++) a.sync(scene, camera, 4 + i / 60);
    expect(u.uScatCount.value).toBe(0);
    expect(u.uSmokeCount.value).toBe(0);
    expect(h.alive).toBe(false);
    // new station / retry drops anything left over
    a.addScatterLight(light);
    const h2 = a.addSmokeEmitter({x: sp.x, y: 0, z: sp.z});
    a.setStation(station(3), null);
    expect(h2.alive).toBe(false);
    expect(a.scatter.list.length).toBe(0);
    a.sync(scene, camera, 0);
    expect(u.uSmokeCount.value + u.uScatCount.value).toBe(0);
    a.clearSmoke();
    a.dispose();
    expect(a.smoke.emitters.length).toBe(0);
  });

  it('the march declares exactly the bounded arrays it is fed (no unbounded loops)', () => {
    expect(VF_MARCH).toContain(`#define VF_MAX_SMOKE ${SMOKE_LIMITS.emitters}`);
    expect(VF_MARCH).toContain(`#define VF_PUFFS_PER ${SMOKE_LIMITS.puffsPerEmitter}`);
    expect(VF_MARCH).toContain(`#define VF_MAX_SCAT ${SMOKE_LIMITS.scatterLights}`);
    expect(VF_MARCH).toMatch(/for \( int k = 0; k < VF_MAX_SMOKE; k \+\+ \)/);
    expect(VF_MARCH).toMatch(/for \( int j = 0; j < VF_PUFFS_PER; j \+\+ \)/);
    expect(VF_MARCH).toMatch(/for \( int k = 0; k < VF_MAX_SCAT; k \+\+ \)/);
    const {a} = rig();
    expect((a.march.uniforms.uPuff.value as unknown[]).length).toBe(SMOKE_LIMITS.emitters * SMOKE_LIMITS.puffsPerEmitter);
    expect((a.march.uniforms.uPuffD.value as unknown[]).length).toBe(SMOKE_LIMITS.emitters * SMOKE_LIMITS.puffsPerEmitter / 4);
    a.dispose();
  });
});
