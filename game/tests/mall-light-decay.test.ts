// Task mall-round3-20261031 (lane LIGHT, R7): "the main walking area of the mall ... is really well lit ... lets cut lighting in this
// area by 50% i.e. 50% of the lights above this area specifically should be burned out or flickering / off color."
// gen/mall/lightDecay.ts re-assigns the state of the public walkway fixtures (retail-floor walkways + the level-0 Fountain court):
//  - about half dark (burned out / sputtering), some flickering (existing circuits 0 / 1), some off-colour (tinted, lower output);
//  - spatially mixed (gap rule) and playable (escalator / stair mouths, elevator landings, the start stay lit); deterministic;
//  - every other fixture of the mall untouched; the baked light field over the walkways carries ~half the fixture light;
//  - tubes / downlight lenses / glow cards show the state (world/builder.ts layoutFixture -> world/lights.ts), Subway / Office
//    fixture objects unchanged.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {generateMallLevel, MALL_GEN_STATS} from '../src/gen/mall/index';
import {OFF_COLOURS, WALKWAY_LIGHTS, isWalkwayArea, walkwayLightCounts, walkwayLightIndices, walkwayLightState} from '../src/gen/mall/lightDecay';
import {CELL, FLOOR, Grid} from '../src/gen/grid';
import {SPAWN_LIT_RADIUS, type LightPlacement, type StationLayout} from '../src/gen/stationTypes';
import {bakeLightField, sampleField, type BakedField} from '../src/world/lightField';
import {stationLevels} from '../src/world/levelGeometry';
import {StationLighting} from '../src/world/lights';
import {layoutFixture} from '../src/world/builder';

const gen = (seed: number, variant: 'terrace-cross' | 'tee-junction', walkwayDecay = true) =>
  generateMallLevel({levelSeed: seed, startWeapon: 'rifle'}, {variant, walkwayDecay});
const CASES = [[11, 'terrace-cross'], [12, 'tee-junction']] as const;
const after = new Map<number, StationLayout>(), before = new Map<number, StationLayout>();
const A = (k: number) => { let l = after.get(k); if (!l) after.set(k, (l = gen(CASES[k][0], CASES[k][1]))); return l; };
const B = (k: number) => { let l = before.get(k); if (!l) before.set(k, (l = gen(CASES[k][0], CASES[k][1], false))); return l; };
const lvOf = (L: StationLayout, l: LightPlacement) => l.level ?? L.areas[l.area]?.level ?? 0;
const dark = (l: LightPlacement) => l.broken || l.dying;
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('mall walkway light decay (R7)', () => {
  it('about half the walkway fixtures are dark, some flicker, some are off-colour (deterministic; the rest of the mall untouched)', () => {
    for (let k = 0; k < CASES.length; k++) {
      const L = A(k), P = B(k), tag = CASES[k].join(' ');
      const c = walkwayLightCounts(L), c0 = walkwayLightCounts(P);
      expect(c.fixtures, tag).toBeGreaterThan(100);
      expect(c0.fixtures, tag).toBe(c.fixtures);
      // before: a fully lit mall (applyLighting 'lit': < 15 % dark); after: ~half dark, the rest mixed
      expect((c0.dead + c0.sputter) / c0.fixtures, tag).toBeLessThan(0.15);
      expect((c.dead + c.sputter) / c.fixtures, tag).toBeGreaterThan(0.45);
      expect((c.dead + c.sputter) / c.fixtures, tag).toBeLessThan(0.55);
      expect(c.sputter, tag).toBeGreaterThan(0);
      expect(c.flicker / c.fixtures, tag).toBeGreaterThan(0.1);
      expect(c.offColour / c.fixtures, tag).toBeGreaterThan(0.1);
      expect(c.normal / c.fixtures, tag).toBeGreaterThan(0.1);
      // states are well formed
      for (const i of walkwayLightIndices(L)) {
        const l = L.lights[i], s = walkwayLightState(l);
        if (s === 'sputter') { expect(l.flicker).toBe(true); expect(l.power).toBe(WALKWAY_LIGHTS.sputterPower); }
        if (s === 'off-colour') {
          expect(OFF_COLOURS).toContain(l.tint);
          expect(l.power).toBeGreaterThanOrEqual(WALKWAY_LIGHTS.offPower[0]);
          expect(l.power).toBeLessThanOrEqual(WALKWAY_LIGHTS.offPower[1]);
        }
        if (s !== 'off-colour') expect(l.tint, tag).toBeUndefined();
      }
      // only walkway fixtures change (platforms, runs, recesses, shops, stock rooms, service, virtual daylight: identical records)
      expect(L.lights.length).toBe(P.lights.length);
      const walk = new Set(walkwayLightIndices(L));
      for (let i = 0; i < L.lights.length; i++) {
        if (walk.has(i)) { expect(isWalkwayArea(L.areas[L.lights[i].area])).toBe(true); continue; }
        expect(L.lights[i], `${tag} light ${i}`).toEqual(P.lights[i]);
      }
      // every other record of the level is the same (own RNG fork: no other draw moved)
      for (const key of ['areas', 'props', 'pickups', 'zombies', 'signs'] as const) expect(L[key], `${tag} ${key}`).toEqual(P[key]);
    }
    // deterministic per seed; the generator's report matches the layout
    expect(gen(CASES[0][0], CASES[0][1]).lights).toEqual(A(0).lights);
    const rep = MALL_GEN_STATS.walkwayLights!;
    expect(rep).toMatchObject({...walkwayLightCounts(A(0)), shortfall: 0});
    expect(rep.anchors).toBeGreaterThan(8);
  });

  it('spatially mixed and playable: a lit fixture near every walkway fixture; mouths, landings and the start stay lit', () => {
    for (let k = 0; k < CASES.length; k++) {
      const L = A(k), tag = CASES[k].join(' ');
      const W = walkwayLightIndices(L).map(i => L.lights[i]);
      // gap rule: every dark walkway fixture has a lit walkway fixture within gapM on its storey, in line of sight
      for (const l of W.filter(dark)) {
        const g = L.levels[lvOf(L, l)].grid;
        const ok = W.some(o => !dark(o) && lvOf(L, o) === lvOf(L, l) && Math.hypot(o.x - l.x, o.z - l.z) <= WALKWAY_LIGHTS.gapM
          && g.raycast(l.x, l.z, o.x - l.x, o.z - l.z, Math.hypot(o.x - l.x, o.z - l.z), true) >= Math.hypot(o.x - l.x, o.z - l.z) - 1e-4);
        expect(ok, `${tag} dark fixture at ${l.x},${l.z} L${lvOf(L, l)} has a lit neighbour`).toBe(true);
      }
      // the walkway fixture nearest each escalator / stair mouth and elevator landing burns steadily
      let anchored = 0;
      for (const v of L.mall!.verticals) {
        if (v.kind === 'service-stair') continue;
        const pts = v.kind === 'elevator' ? Array.from({length: v.upper - v.lower + 1}, (_, q) => ({lv: v.lower + q, x: v.foot.x, z: v.foot.z}))
          : [{lv: v.lower, x: v.foot.x, z: v.foot.z}, {lv: v.upper, x: v.head.x, z: v.head.z}];
        for (const p of pts) {
          let best: LightPlacement | null = null, bd = WALKWAY_LIGHTS.anchorM;
          for (const l of W) { const d = Math.hypot(l.x - p.x, l.z - p.z); if (lvOf(L, l) === p.lv && d < bd) { bd = d; best = l; } }
          if (!best) continue;
          anchored++;
          expect(dark(best) || best.flicker, `${tag} ${v.kind} mouth L${p.lv} ${p.x},${p.z}`).toBe(false);
        }
      }
      expect(anchored, tag).toBeGreaterThan(8);
      // the start: Fountain court fixtures around the spawn stay steady (applyLighting's readable start)
      const sp = L.playerSpawn;
      for (const l of W) if (lvOf(L, l) === 0 && Math.hypot(l.x - sp.x, l.z - sp.z) < SPAWN_LIT_RADIUS) expect(dark(l) || l.flicker).toBe(false);
      // mixed across the storeys: every retail floor loses lights and keeps lights
      for (const lv of [1, 2, 3]) {
        const own = W.filter(l => lvOf(L, l) === lv);
        const d = own.filter(dark).length / own.length;
        expect(d, `${tag} L${lv}`).toBeGreaterThan(0.3);
        expect(d, `${tag} L${lv}`).toBeLessThan(0.7);
      }
    }
  });

  it('the baked light field over the walkways carries about half the fixture light; dead fixtures add nothing', () => {
    const L = A(0), P = B(0);
    const bake = (q: StationLayout): BakedField => bakeLightField({grid: q.grid, lights: q.lights, trenchFloorY: q.trench.floorY, levels: stationLevels(q)});
    const fa = bake(L), fb = bake(P);
    // circuits at full and at their time averages (flicker 0 / 1 ~0.86, dying ~0.05: groupLevel over a long run)
    const mean = (f: BakedField, levels: number[]) => {
      let s = 0, n = 0;
      for (const lev of L.levels) {
        const g = lev.grid;
        for (let i = 0; i < g.cells.length; i++) {
          if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || !isWalkwayArea(L.areas[g.area[i]]) || i % 2) continue;
          const cx = i % g.w, cy = (i - cx) / g.w, x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
          const q = sampleField(f, x, g.floorOf(i) + 0.1, z, levels, [0, 1, 0]);
          s += lum(q.amb) + lum(q.dirColor) * Math.max(0, q.dir[1]); n++;
        }
      }
      return s / n;
    };
    const full = mean(fa, [1, 1, 1]) / mean(fb, [1, 1, 1]), avg = mean(fa, [0.863, 0.863, 0.053]) / mean(fb, [0.863, 0.863, 0.053]);
    expect(full).toBeGreaterThan(0.42);
    expect(full).toBeLessThan(0.62);
    expect(avg).toBeGreaterThan(0.4);
    expect(avg).toBeLessThan(0.58);
    // the bake skips every burned-out fixture; the flickering / sputtering ones ride their circuits
    const c = walkwayLightCounts(L), c0 = walkwayLightCounts(P);
    expect(fb.stats.working - fa.stats.working).toBe(c.dead - c0.dead);
    for (const i of walkwayLightIndices(L)) {
      const s = walkwayLightState(L.lights[i]);
      if (s === 'flicker') expect([0, 1]).toContain(fa.groups[i]);
      else expect(fa.groups[i]).toBe(s === 'sputter' ? 2 : -1);
    }
  });
});

describe('fixture state on the tubes / downlight lenses / glow (world/builder.ts layoutFixture -> world/lights.ts)', () => {
  it('dead = dark lens and no glow; off-colour = tinted lens and glow; normal = near-white; untinted / virtual fixtures unchanged', () => {
    const g = new Grid(40, 16);
    for (let y = 1; y < 15; y++) for (let x = 1; x < 39; x++) { g.set(x, y, FLOOR); g.ceil[y * 40 + x] = 4.4; g.area[y * 40 + x] = 0; }
    const base = {y: 4.35, z: 4, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false};
    const lights: LightPlacement[] = [
      {...base, x: 3},
      {...base, x: 7, broken: true},
      {...base, x: 11, tint: OFF_COLOURS[0], power: 0.65},
      {...base, x: 15, dying: true, flicker: true, power: 0.5},
      {...base, x: 18, tint: [0.8, 0.9, 1.2], virtual: true},
    ];
    const layout = {grid: g, lights, trench: {floorY: -1.15}, areas: [{lighting: 'lit'}], platform: 0} as unknown as StationLayout;
    const fixtures = lights.map(layoutFixture);
    expect('tint' in fixtures[0]).toBe(false);
    expect('tint' in fixtures[4]).toBe(false); // virtual daylight (Office / mall exits): no tube tint, no output
    expect(fixtures[4].power).toBe(0);
    expect(fixtures[2].tint).toEqual(OFF_COLOURS[0]);
    const tubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 0.05), new MeshBasicNodeMaterial(), lights.length);
    const scene = new THREE.Scene();
    const sl = new StationLighting(scene, layout, fixtures, tubes);
    const col = (i: number) => { const c = new THREE.Color(); tubes.getColorAt(i, c); return c; };
    const normal = col(0), dead = col(1), off = col(2);
    expect(dead.r + dead.g + dead.b).toBeLessThan(0.15);
    expect(Math.min(normal.r, normal.g, normal.b) / Math.max(normal.r, normal.g, normal.b)).toBeGreaterThan(0.85);
    // sickly green shows on the lens: green clearly over red and blue
    expect(off.g).toBeGreaterThan(off.r * 1.15);
    expect(off.g).toBeGreaterThan(off.b * 1.3);
    // glow cards for the working fixtures only (normal, off-colour, sputtering)
    expect(sl.glow?.count).toBe(3);
    sl.dispose(scene);
  });
});
