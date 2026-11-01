// Iteration 13 (FOG): the user's four fog points as behaviour tests of the world medium (render/atmosphere.ts mediumAt, the
// CPU mirror of the TSL march) and of the VolumetricAtmosphere state that feeds it (render/volumetric.ts):
//  (a) persistence — the density at a world point is the same before and after the camera ran through areas and back
//      (history, culling, visited rooms play no part), same seed => same fog;
//  (b) slightly less fog with genuinely clear regions — per-seed area classes (clear / normal / dense), clear areas near
//      zero, dense areas / track beds thick, the station mean ~0.65-0.8 of the iteration-12 time average;
//  (c) visible slow motion — the density changes within seconds by TRANSLATION of world-anchored noise (no re-roll, no
//      fade), driven by the station fog clock (pause freezes it, a new station restarts it), never by the camera; the
//      station-wide amount stays steady (the iteration-12 cause of "the fog disappears");
//  (d) light — flashlight off => no beam term; flare out / removed => no red scatter light; occluded / far => none.
// Root cause of the disappearance: reference/tasks/fog-webgpu-20261028/lanes/fog.notes.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {generateStation, type StationLayout} from '../src/gen/station';
import {CELL, SOLID, VOID} from '../src/gen/grid';
import {stationLevels} from '../src/world/levelGeometry';
import {MAX_SLOTS, cellFloorFn} from '../src/world/lightField';
import {
  ATMOSPHERE, ATMOSPHERE_ITER12, areaClassOf, atmosphereFor, buildAirMap, buildDensityMap, buildNoiseVolume, fieldOffsets,
  flashlightRadiance, fogMotion, mediumAt, mediumStats, noiseScales, pointRadiance, sampleAirMap, sampleNoise4,
  type MediumMaps, type SpotInput, type V3,
} from '../src/render/atmosphere';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {btsAreaPresent, coreView} from '../src/gen/trackExt/index';
import {presentSeeds} from './helpers/btsArea';

const stations = new Map<number, StationLayout>();
const station = (seed: number) => { let s = stations.get(seed); if (!s) stations.set(seed, (s = generateStation(seed))); return s; };
const noise = buildNoiseVolume();
const mapsOf = (l: StationLayout, p = atmosphereFor(l)): MediumMaps => ({map: buildDensityMap(l, p), air: buildAirMap(l), noise, motion: fogMotion(l.seed, p)});

/** Open points 1.4 m above the local floor on every level (every `stride`-th cell). */
function walkingPoints(l: StationLayout, stride: number): {p: V3; slot: number; cell: number; track: boolean}[] {
  const out: {p: V3; slot: number; cell: number; track: boolean}[] = [];
  stationLevels(l).slice(0, 4).forEach((L, s) => {
    const g = L.grid, fl = cellFloorFn(g, l.trench.floorY);
    for (let i = 0; i < g.w * g.h; i += stride) {
      if (g.cells[i] === SOLID) continue;
      const cx = i % g.w, cy = (i - cx) / g.w;
      out.push({p: [(cx + 0.5) * CELL, fl(cx, cy) + 1.4, (cy + 0.5) * CELL], slot: s, cell: i, track: g.cells[i] === VOID});
    }
  });
  return out;
}

/** A minimal camera rig like game.ts (flashlight on the camera). */
function rig() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0b0c, 0.043);
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  const flashlight = new THREE.SpotLight(0xfff4e2, 34, 30, 0.58, 0.7, 1.2);
  flashlight.position.set(0.2, -0.15, 0.1);
  flashlight.target.position.set(0.04, -0.12, -6);
  camera.add(flashlight, flashlight.target);
  const muzzle = new THREE.PointLight(0xffb468, 0, 8, 2);
  scene.add(camera, muzzle);
  return {scene, camera, flashlight, muzzle};
}

/**
 * CPU-only atmosphere (renderer null: no GPU) for a station; `sync` drives every per-frame input exactly as a frame would
 * (camera, fog clock, smoke, lights), so any hidden dependence of the medium on the camera would show up here.
 */
function cpuAtmosphere(l: StationLayout) {
  const r = rig();
  const a = new VolumetricAtmosphere(null, {flashlight: r.flashlight, muzzle: r.muzzle}, 'high');
  a.setSize(1280, 720);
  a.setStation(l, null);
  return {a, ...r};
}

const pose = (camera: THREE.PerspectiveCamera, x: number, y: number, z: number, yaw: number) => {
  camera.position.set(x, y, z);
  camera.rotation.set(0, yaw, 0);
  camera.updateMatrixWorld(true);
};

// ---------------------------------------------------------------------------------------------
describe('(a) persistence: world-anchored density, independent of where the camera has been', () => {
  it('same point + same fog time => same density, before and after running through areas and back', () => {
    for (const seed of [0x1a2b3c, 6]) {
      const l = station(seed);
      const {a, scene, camera} = cpuAtmosphere(l);
      const sp = l.playerSpawn;
      // frame 0 at game time 50 starts the station clock; the probe set spans the whole station on every level
      pose(camera, sp.x, 1.6, sp.z, sp.yaw);
      a.render(scene, camera, 50);
      const probes = walkingPoints(l, 97).map(q => q.p);
      const T = 12.5;
      const before = probes.map(p => a.fogSample(p[0], p[1], p[2], T).sigma);
      expect(before.some(v => v > 0.01)).toBe(true);
      // run 15 m out along the spawn yaw, turn around, run back, turn back — 0.25 s frames, every frame synced
      const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw);
      let t = 50;
      for (let k = 0; k <= 60; k++) { pose(camera, sp.x + fx * k * 0.25, 1.6, sp.z + fz * k * 0.25, sp.yaw); a.sync(scene, camera, (t += 0.25)); }
      for (let k = 0; k <= 8; k++) { pose(camera, sp.x + fx * 15, 1.6, sp.z + fz * 15, sp.yaw + Math.PI * k / 8); a.sync(scene, camera, (t += 0.25)); }
      for (let k = 60; k >= 0; k--) { pose(camera, sp.x + fx * k * 0.25, 1.6, sp.z + fz * k * 0.25, sp.yaw + Math.PI); a.sync(scene, camera, (t += 0.25)); }
      pose(camera, sp.x, 1.6, sp.z, sp.yaw);
      a.sync(scene, camera, (t += 0.25));
      const after = probes.map(p => a.fogSample(p[0], p[1], p[2], T).sigma);
      expect(after).toEqual(before);
      // ...and a fresh module for the same station (new session, same seed) agrees exactly
      const b = cpuAtmosphere(l).a;
      expect(probes.map(p => b.fogSample(p[0], p[1], p[2], T).sigma)).toEqual(before);
      // the uniforms that move the medium depend on the fog clock only, never on the camera
      const offs = () => [a.u.offAir.value.toArray(), a.u.offTrack.value.toArray(), a.u.offDet.value.toArray(), a.u.density.value];
      pose(camera, sp.x, 1.6, sp.z, sp.yaw); a.sync(scene, camera, 70);
      const o1 = offs();
      pose(camera, sp.x + 40, 1.6, sp.z - 3, sp.yaw + 2); a.sync(scene, camera, 70);
      expect(offs()).toEqual(o1);
      a.dispose(); b.dispose();
    }
  });

  it('no area is ever consumed: foggy areas stay foggy over 10 minutes of fog time (patches move through, never drain)', () => {
    // Track 2 GEN-2: the CORE station (gen/trackExt coreView; DESIGN §0: rules over the core, extensions reported separately). Its
    // live layout carries annexes now and is translated with them, so the world-anchored patches sample other noise there.
    const l = coreView(station(0x1a2b3c)), p = atmosphereFor(l), maps = mapsOf(l, p);
    const pts = walkingPoints(l, 3);
    const byArea = new Map<number, {p: V3; slot: number}[]>();
    for (const q of pts) {
      const g = stationLevels(l)[q.slot].grid;
      const ai = g.cells[q.cell] === VOID ? -1 : g.area[q.cell];
      if (!byArea.has(ai)) byArea.set(ai, []);
      byArea.get(ai)!.push({p: q.p, slot: q.slot});
    }
    const rows: string[] = [];
    let checked = 0;
    for (const [ai, v] of byArea) {
      if (v.length < 60) continue;
      const cls = ai < 0 ? 'track' : maps.map!.areas![ai].cls;
      const m = (t: number) => v.reduce((s, q) => s + mediumAt(q.p, maps, p, t, q.slot).sigma, 0) / v.length;
      const series = [0, 37, 90, 151, 240, 333, 420, 600].map(m);
      const avg = series.reduce((a, b) => a + b, 0) / series.length;
      const lo = Math.min(...series), hi = Math.max(...series);
      rows.push(`${cls} ${ai} (${v.length}): ${series.map(x => (x * 1000).toFixed(1)).join(' ')}`);
      if (cls === 'clear') { expect(hi, rows.at(-1)).toBeLessThan(0.002); continue; }
      // a foggy area's haze dips while a clear pocket drifts through but never drains: dense / track >= 45 % of its
      // average at every moment, normal areas >= 20 %
      expect(lo / avg, rows.at(-1)).toBeGreaterThan(cls === 'normal' ? 0.2 : 0.45);
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
  });
});

// ---------------------------------------------------------------------------------------------
describe('(b) slightly less fog, with genuinely clear and dense areas', () => {
  // Iteration-12 station mean sigma (1/m) at walking height, time average over 0..300 s, measured on c061b81 with the same
  // sample set (every 7th open cell, 1.4 m above the local floor, all levels) — the "before" (lanes/fog.notes).
  const ITER12_MEAN: Record<number, number> = {0x1a2b3c: 0.0329, 6: 0.0398, 42: 0.0341, 7: 0.0355, 1234: 0.0313};

  it('area classes are seeded per station + area, by type; clear areas hold almost none, dense areas / track beds plenty', () => {
    for (const seed of Object.keys(ITER12_MEAN).map(Number)) {
      // Track 2 GEN-2: the CORE station's volume fractions (DESIGN §0: the service annexes — corridors / plant rooms, never clear —
      // are extension volume, reported separately, not part of the iteration-12 station's clear / dense split)
      const l = coreView(station(seed)), p = atmosphereFor(l), maps = mapsOf(l, p);
      const areas = maps.map!.areas!;
      const n = {clear: 0, normal: 0, dense: 0};
      for (const a of areas) n[a.cls]++;
      expect(n.clear, `seed ${seed}`).toBeGreaterThan(5);
      expect(n.dense, `seed ${seed}`).toBeGreaterThan(5);
      // deterministic per seed, independent of call order
      expect(areas.map((_, i) => areaClassOf(l, i, p))).toEqual(areas.map(a => a.cls));
      // platforms never clear (the train side stays foggy); service rooms never clear
      for (const [i, a] of l.areas.entries()) {
        if (a.kind === 'platform') expect(areas[i].cls).toBe('normal');
        if (a.type === 'service-corridor' || a.type === 'utility') expect(areas[i].cls).not.toBe('clear');
      }
      const s = mediumStats(l, maps, p, 0, 7);
      expect(s.byClass.clear, `seed ${seed}`).toBeLessThan(s.byClass.normal * 0.05);
      expect(s.byClass.dense).toBeGreaterThan(s.byClass.normal * 2);
      expect(s.byClass.track).toBeGreaterThan(s.byClass.normal * 1.8);
      // genuinely clear volume and genuinely dense volume both exist
      expect(s.clearFrac).toBeGreaterThan(0.35);
      expect(s.denseFrac).toBeGreaterThan(0.12);
    }
  });

  it('station mean is ~0.6-0.85 of the iteration-12 time average (moderately less); base 0.030 -> 0.020', () => {
    expect(ATMOSPHERE.density).toBeLessThan(ATMOSPHERE_ITER12.density * 0.8);
    const rows: string[] = [];
    for (const [seedS, old] of Object.entries(ITER12_MEAN)) {
      // Track 2 (lane GEN): the CORE station's mean (gen/trackExt coreView: track tunnels / annexes are not the iteration-12 station)
      const seed = Number(seedS), l = coreView(station(seed)), p = atmosphereFor(l), maps = mapsOf(l, p);
      const ms = [0, 60, 120, 180, 240, 300].map(t => mediumStats(l, maps, p, t, 7).mean);
      const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
      rows.push(`seed ${seed} (${l.archetype}): iteration 12 ${(old * 1000).toFixed(1)} -> now ${(avg * 1000).toFixed(1)} (x${(avg / old).toFixed(2)}) e-3 /m`);
      expect(avg / old, `seed ${seed}`).toBeGreaterThan(0.55);
      expect(avg / old, `seed ${seed}`).toBeLessThan(0.86);
    }
    console.log(`station-mean sigma at walking height:\n  ${rows.join('\n  ')}`);
  });
});

// ---------------------------------------------------------------------------------------------
describe('(c) visible slow motion in world space, on the fog clock', () => {
  it('iteration 15: every fog motion rate is exactly HALF of iteration 13 (user: "half the speed"), halved once', () => {
    const ITER13 = {drift: 0.38, trackDrift: 0.75, detailDrift: 0.6, rise: 0.08};
    for (const k of Object.keys(ITER13) as (keyof typeof ITER13)[]) expect(ATMOSPHERE[k], k).toBeCloseTo(ITER13[k] / 2, 10);
    const l = station(0x1a2b3c), p = atmosphereFor(l), mo = fogMotion(l.seed, p), old = fogMotion(l.seed, {...p, ...ITER13});
    const speed = (v: V3) => Math.hypot(v[0], v[1], v[2]);
    for (const f of ['air', 'track', 'detail'] as const) expect(speed(mo[f]) / speed(old[f]), f).toBeCloseTo(0.5, 10);
    // the field offsets (what the shader receives) advance at half the iteration-13 rate: same offset at twice the time
    for (const t of [3, 17, 120]) expect(fieldOffsets(mo, p, 2 * t)).toEqual(fieldOffsets(old, p, t));
    // unchanged: pattern scales / warp size (only rates moved; the amount is checked by (a) / (b) above)
    expect([p.warp, p.noiseScale, p.detailScale]).toEqual([2.2, 1 / 30, 1 / 18]);
  });

  it('moves at the seeded drift speeds (0.15-0.4 m/s) and the patch field TRANSLATES (no re-roll, no fade)', () => {
    const l = station(0x1a2b3c), p = atmosphereFor(l), mo = fogMotion(l.seed, p);
    const speed = (v: V3) => Math.hypot(v[0], v[1], v[2]);
    expect(speed(mo.air)).toBeGreaterThanOrEqual(0.15);
    expect(speed(mo.air)).toBeLessThanOrEqual(0.4);
    expect(speed(mo.track)).toBeGreaterThanOrEqual(0.15);
    expect(speed(mo.track)).toBeLessThanOrEqual(0.4);
    expect(speed(mo.detail)).toBeGreaterThan(speed(mo.air)); // wisps / warp outrun the patches: billowing
    // with the warp off, the patch value at p + v dt, t + dt equals the value at p, t exactly (pure translation)
    const pw = {...p, warp: 0};
    const sc = noiseScales(pw);
    const patchAt = (q: V3, t: number) => { const o = fieldOffsets(mo, pw, t); return sampleNoise4(noise, [q[0] * sc.patch[0] + o.air[0], q[1] * sc.patch[1] + o.air[1], q[2] * sc.patch[2] + o.air[2]])[0]; };
    for (const dt of [2, 3, 4, 30]) {
      for (let k = 0; k < 40; k++) {
        const q: V3 = [10 + k * 1.7, 1.2 + (k % 5) * 0.3, 5 + (k * 7) % 23];
        const moved: V3 = [q[0] + mo.air[0] * dt, q[1] + mo.air[1] * dt, q[2] + mo.air[2] * dt];
        expect(patchAt(moved, 40 + dt)).toBeCloseTo(patchAt(q, 40), 4);
      }
    }
  });

  it('changes visibly within 4-8 s at a fixed point (half the iteration-13 pace, still not a crawl), from time only', () => {
    const l = station(0x1a2b3c), p = atmosphereFor(l), maps = mapsOf(l, p);
    const pts = walkingPoints(l, 11).filter(q => !q.track);
    for (const dt of [4, 6, 8]) {
      let changed = 0, foggy = 0;
      for (const q of pts) {
        const a = mediumAt(q.p, maps, p, 100, q.slot).sigma, b = mediumAt(q.p, maps, p, 100 + dt, q.slot).sigma;
        if (Math.max(a, b) < 0.01) continue;
        foggy++;
        if (Math.abs(a - b) / Math.max(a, b) > 0.2) changed++;
      }
      // a fifth or more of the foggy points change by > 20 % within 4 s, more by 8 s (iteration 13: 2 / 4 s)
      expect(changed / foggy, `dt ${dt}`).toBeGreaterThan(dt === 4 ? 0.2 : 0.3);
    }
  });

  it('the station-wide amount stays steady (the iteration-12 swing was 17 -> 59 e-3 /m within minutes)', () => {
    for (const seed of [0x1a2b3c, 6, 42]) {
      // (2026-11-01, lane AREA) the CORE station, as the area-consumption test above since GEN-2 (DESIGN §0: rules over the core,
      // extensions reported separately): seed 42 no longer carries its service annex (its level rolls the Beyond the Station area
      // absent), so its live grid / crop translation changed and the world-anchored patches sample other noise there (live swing
      // 1.131 / 0.915 — a layout effect, not the fog clock; the core views read 1.053 / 1.053 / 1.068 max over the mean)
      const l = coreView(station(seed)), p = atmosphereFor(l), maps = mapsOf(l, p);
      const ms: number[] = [];
      for (let t = 0; t <= 300; t += 20) ms.push(mediumStats(l, maps, p, t, 9).mean);
      const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
      expect(Math.max(...ms) / avg, `seed ${seed}`).toBeLessThan(1.1);
      expect(Math.min(...ms) / avg, `seed ${seed}`).toBeGreaterThan(0.9);
    }
  });

  it('...and over the FULL LIVE level (station + track beds + tunnels + service annexes), area absent and present, same band', () => {
    // (2026-11-01, round-4 follow-up lane ENV) The same property, the same 1.1 / 0.9 band and the same fog-time series as the core
    // check above, over the LIVE layout: the three seeds above (each rolls the Beyond the Station area ABSENT: its live level is the
    // core plus its track tunnels, 3 / 2 / 2) and, for each, the first seed at or after it whose level rolls the area PRESENT (the
    // real roll, tests/helpers/btsArea.ts: 1715005 split with a tunnel + an annex, 8 island-ends with two hatch annexes, 43 express
    // with one), so both physical mixes are covered.
    // MEASUREMENT: the COMPLETE walking-height sample (mediumStats stride 1: every open cell of every level slot; 9x the samples of
    // stride 9), because "the station-wide amount" is the mean over the whole level and any fixed stride over the row-major cell
    // index is a lattice whose shape depends on the grid width: seed 42's live grid is 576 = 64 x 9 cells wide, so `i += 9` lands on
    // the SAME 64 columns in every row — a comb of lines 4.5 m apart across the drift axis (the air drift is within 35 deg of x, the
    // track draft along x; the patch noise has 7.5 m / 3.75 m lattice periods), which aliases the translating patches into a swing
    // of the comb's mean: stride 9 reads 1.131 / 0.915 there, the complete sample of the same domain 1.050 / 0.963 (strides 7 / 10
    // / 11: 1.055 / 1.048 / 1.047). The same comb explains every other outlier checked: 0x1a2b3c live (531 = 59 x 9) 1.095 vs
    // complete 1.040; the CORE views of seed 3 (369 = 41 x 9) 1.119 vs 1.040 and seed 13 (405 = 45 x 9) min 0.876 vs 0.966. Complete
    // sample, max / min over the mean: absent 1.040 / 0.956, 1.046 / 0.962, 1.050 / 0.963; present 1.026 / 0.975, 1.027 / 0.966,
    // 1.044 / 0.972 (per class, the narrow tunnel strips alone swing up to 1.18 / 0.85: fewer patches across them; the level-wide
    // amount, the property, stays steady).
    const absent = [0x1a2b3c, 6, 42], present = absent.map(s0 => presentSeeds(1, i => s0 + i)[0]);
    const openCells = (l: StationLayout, count: (g: StationLayout['grid'], i: number) => void) => {
      for (const L of stationLevels(l).slice(0, MAX_SLOTS)) for (let i = 0; i < L.grid.w * L.grid.h; i++) if (L.grid.cells[i] !== SOLID) count(L.grid, i);
    };
    for (const seed of [...absent, ...present]) {
      const l = station(seed), p = atmosphereFor(l), maps = mapsOf(l, p);
      const on = btsAreaPresent(seed);
      expect(on, `seed ${seed}`).toBe(present.includes(seed));
      // THE DOMAIN, partitioned: every open cell of the live level is a station cell, a track-bed cell (VOID), a tunnel cell or an
      // annex cell; station + bed = exactly the core view's open cells (the live domain is the core plus every extension cell)
      const n = {station: 0, bed: 0, tunnel: 0, annex: 0};
      openCells(l, (g, i) => { const ext = l.areas[g.area[i]]?.ext; n[g.cells[i] === VOID ? 'bed' : ext ?? 'station']++; });
      let core = 0;
      openCells(coreView(l), () => core++);
      expect(n.station + n.bed, `seed ${seed}`).toBe(core);
      if (on) expect(n.annex, `seed ${seed}: the PRESENT mix samples annex cells`).toBeGreaterThan(0);
      else { expect(n.annex, `seed ${seed}`).toBe(0); expect(n.tunnel, `seed ${seed}: the ABSENT mix samples its tunnels`).toBeGreaterThan(0); }
      const ms: number[] = [];
      for (let t = 0; t <= 300; t += 20) {
        const s = mediumStats(l, maps, p, t, 1);
        expect(s.samples, `seed ${seed}`).toBe(n.station + n.bed + n.tunnel + n.annex);
        ms.push(s.mean);
      }
      const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
      expect(Math.max(...ms) / avg, `seed ${seed} (live, ${on ? 'present' : 'absent'})`).toBeLessThan(1.1);
      expect(Math.min(...ms) / avg, `seed ${seed} (live, ${on ? 'present' : 'absent'})`).toBeGreaterThan(0.9);
    }
  });

  it('runs on the station fog clock: pause freezes it, a new station restarts it, the camera never advances it', () => {
    const l = station(6);
    const {a, scene, camera} = cpuAtmosphere(l);
    const sp = l.playerSpawn;
    pose(camera, sp.x, 1.6, sp.z, sp.yaw);
    a.render(scene, camera, 200); // first frame of the station at game time 200
    expect(a.fogTime(200)).toBe(0);
    a.sync(scene, camera, 205);
    expect(a.fogTime()).toBeCloseTo(5, 9);
    const off5 = a.u.offAir.value.toArray();
    // pause: the game clock does not advance; frames keep rendering with the same time => identical medium
    for (let k = 0; k < 10; k++) { pose(camera, sp.x + k, 1.6, sp.z, sp.yaw + k); a.sync(scene, camera, 205); }
    expect(a.u.offAir.value.toArray()).toEqual(off5);
    expect(a.fogTime()).toBeCloseTo(5, 9);
    // the medium moved between 0 and 5 s
    a.sync(scene, camera, 200);
    expect(a.u.offAir.value.toArray()).not.toEqual(off5);
    // new station (or retry): the clock restarts at its first frame, smoke is cleared
    a.addSmokeEmitter({x: sp.x, y: 0.5, z: sp.z});
    a.setStation(station(0x1a2b3c), null);
    expect(a.smoke.emitters.length).toBe(0);
    a.render(scene, camera, 900);
    expect(a.fogTime(900)).toBe(0);
    expect(a.fogTime(903)).toBeCloseTo(3, 9);
    a.dispose();
  });

  it('smoke puffs ride the same air: the drift the medium moves with (draft over the track beds)', () => {
    const l = station(0x1a2b3c);
    const {a} = cpuAtmosphere(l);
    const air = buildAirMap(l), mo = fogMotion(l.seed, atmosphereFor(l));
    const g = l.grid;
    const vi = g.cells.findIndex((c, i) => c === VOID && g.cells[i + 3] === VOID && g.cells[i - 3] === VOID && g.cells[i + 3 * g.w] === VOID && g.cells[i - 3 * g.w] === VOID);
    const vx = (vi % g.w + 0.5) * CELL, vz = (Math.floor(vi / g.w) + 0.5) * CELL;
    expect(sampleAirMap(air, vx, vz, 0)).toBeGreaterThan(0.9);
    const d = a.driftAt(vx, l.trench.floorY + 1, vz);
    expect(d[0]).toBeCloseTo(mo.track[0], 1);
    a.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
describe('(d) light lights the fog — and stops when the light does', () => {
  it('flashlight: beam term follows intensity (battery flicker) and is zero when off', () => {
    const l = station(0x1a2b3c);
    const {a, scene, camera, flashlight} = cpuAtmosphere(l);
    pose(camera, l.playerSpawn.x, 1.6, l.playerSpawn.z, 0);
    flashlight.intensity = 34;
    a.sync(scene, camera, 1);
    const on = (a.u.flashColor.value as THREE.Vector3).clone();
    expect(on.length()).toBeGreaterThan(5);
    flashlight.intensity = 17; // a battery dip
    a.sync(scene, camera, 1.1);
    expect((a.u.flashColor.value as THREE.Vector3).length()).toBeCloseTo(on.length() / 2, 6);
    flashlight.intensity = 0; // off / flat battery
    a.sync(scene, camera, 1.2);
    expect((a.u.flashColor.value as THREE.Vector3).length()).toBe(0);
    expect(a.u.shadowOn.value).toBe(0);
    // CPU mirror: zero colour => no in-scatter anywhere in the cone
    const s: SpotInput = {pos: [0, 1.45, 0], dir: [0, 0, -1], coneCos: Math.cos(0.58), penumbraCos: Math.cos(0.58 * 0.3), color: [0, 0, 0], distance: 30, decay: 1.2};
    expect(flashlightRadiance([0, 1.45, -5], 5, [0, 0, -1], s, ATMOSPHERE, () => 1)).toEqual([0, 0, 0]);
    expect(flashlightRadiance([0, 1.45, -5], 5, [0, 0, -1], {...s, color: [34, 34, 34]}, ATMOSPHERE, () => 1)[0]).toBeGreaterThan(0);
    expect(flashlightRadiance([0, 1.45, -5], 5, [0, 0, -1], {...s, color: [34, 34, 34]}, ATMOSPHERE, () => 0)).toEqual([0, 0, 0]); // shadowed
    a.dispose();
  });

  it('flare: red scatter light while burning, gone when burnt out or removed; occluded => nothing; body glow never registered', () => {
    const l = station(0x1a2b3c);
    const {a, scene, camera} = cpuAtmosphere(l);
    const sp = l.playerSpawn;
    pose(camera, sp.x, 1.6, sp.z, sp.yaw);
    const flare = new THREE.PointLight(0xff2a14, 7, 10, 2);
    flare.position.set(sp.x, 0.2, sp.z);
    scene.add(flare);
    expect(a.addScatterLight(flare)).toBe(true);
    a.sync(scene, camera, 1);
    expect(a.u.scatCount.value).toBe(1);
    const c = (a.u.scatCol.array as THREE.Vector4[])[0];
    expect(c.x).toBeGreaterThan(c.y * 10); // red
    expect(a.debug().scatter.windows).toBeGreaterThan(0); // its line-of-sight window on its storey
    flare.intensity = 0; // burnt out (the light lane pools flare lights at intensity 0)
    a.sync(scene, camera, 2);
    expect(a.u.scatCount.value).toBe(0);
    flare.intensity = 7;
    a.removeScatterLight(flare);
    a.sync(scene, camera, 3);
    expect(a.u.scatCount.value).toBe(0);
    // CPU mirror: beyond the cutoff or behind a wall (window 0) the flare adds nothing
    const L = {pos: [0, 0.2, 0] as V3, color: [7, 0.16, 0.04] as V3, distance: 10, decay: 2};
    expect(pointRadiance([0, 1, -3], [0, 0, -1], L, ATMOSPHERE)[0]).toBeGreaterThan(0);
    expect(pointRadiance([0, 1, -12], [0, 0, -1], L, ATMOSPHERE)).toEqual([0, 0, 0]);
    expect(pointRadiance([0, 1, -3], [0, 0, -1], L, ATMOSPHERE, 0)).toEqual([0, 0, 0]);
    // only registered scatter lights scatter: the module holds no other light reference (body glow stays a surface light)
    expect(a.scatter.list.length).toBe(0);
    a.dispose();
  });

  it('muzzle flash scatters only while it fires; the fixture field term follows the station field', () => {
    const l = station(0x1a2b3c);
    const {a, scene, camera, muzzle} = cpuAtmosphere(l);
    pose(camera, l.playerSpawn.x, 1.6, l.playerSpawn.z, 0);
    a.sync(scene, camera, 1);
    expect((a.u.muzzleColor.value as THREE.Vector3).length()).toBe(0);
    muzzle.intensity = 18;
    a.sync(scene, camera, 1.05);
    expect((a.u.muzzleColor.value as THREE.Vector3).length()).toBeGreaterThan(1);
    expect(a.u.fieldGain.value).toBe(0); // no field bound (CPU test): no fixture term
    a.setStation(l, {} as never);
    a.sync(scene, camera, 1.1);
    expect(a.u.fieldGain.value).toBe(atmosphereFor(l).fixtureScatter);
    a.dispose();
  });
});
