// Task reactor-expansion-20261101 (lane GASLIGHT): THE TOXIC-GAS VISIBILITY RULE (root CLAUDE.md "Toxic gas is always VISIBLE green
// volumetric fog") — one check per gas source that what HURTS is visibly GREEN and what is clean is not:
//  - the looks: every gas term is green and visibly dense at the damage threshold over its typical view path (the Reactor's depth
//    strata failed this before: 0.12 / m, a 0.04 linear glow under olive murk — the user's "the toxic gas is not visible!");
//  - hazard <-> render parity (ONE function): the Reactor strata + the open top's outdoor air (exposure depthGasAt vs the uniforms the
//    march reads), the Office roof's outdoor air (roofBlend x ROOF_OUTDOOR_C vs the regional term's outdoor ramp), Blightbelly puffs
//    (exposure vs the uploaded gas layer x the height profile); clearing thins the drawn strata exactly as the hazard drops;
//  - the mask never hides gas; the clean rim / station / ordinary fog are not green;
//  - the IN-ENGINE fallback when the volumetric pass is off (scene fog tinted, restored; no CSS overlay);
//  - the reactor variant (strata + outdoor + light shafts) compiles for WebGL2 + WebGPU; open scatter lights (vfOpen) for the core glow.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {CELL, FLOOR, Grid} from '../src/gen/grid';
import {GAS, gasProfile} from '../src/world/gas/field';
import {installGas, type GasHost} from '../src/world/gas/system';
import {roofAirOf, roofBlend} from '../src/world/roofAir';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {VF_DEPTH_MARK, VF_MARK, createFogUniforms, createMarchMaterial, type FogUniforms} from '../src/render/volumetricShaders';
import {REACTOR_AIR, REACTOR_GAS_LOOK, ReactorAir} from '../src/world/reactor/air';
import {emptyReactorState} from '../src/world/reactor/runState';
import {layoutRect} from '../src/world/reactor/generators';
import {REACTOR_FOG} from '../src/world/reactor/archInstall';
import {MOOD} from '../src/world/lights';
import {
  GAS_FALLBACK, PIT_SHAFTS, REACTOR_OUTDOOR, ROOF_GAS_LOOK, fallbackFog, gasGlow, gasOpacity, greenness, luminance, outdoorGasAt, pitShaftSpec, shaftAt,
  reactorOutdoorGas,
} from '../src/world/gaslightRules';
import {WIN} from '../src/world/reactor/restartWin';
import {skyClearAt} from '../src/world/reactor/startupPlan';
import {roofOpeningOf} from '../src/gen/reactor/roofOpening';
import {compileQuad} from './helpers/fogCompile';
import {fixtureInfo} from './reactor-air-fixture';

const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const hexRgb = (h: number): [number, number, number] => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

/** CPU evaluation of the regional (depth) term's CONCENTRATION from the uniforms the march reads (no mean-1 noise): strata + outdoor. */
function renderC(u: FogUniforms, x: number, y: number, z: number): {strata: number; outdoor: number} {
  const r = u.depthRect.value as THREE.Vector4, g = u.depthRange.value as THREE.Vector4, o = u.depthOut.value as THREE.Vector4;
  if (!(u.depthOn.value > 0.5) || x < r.x || x > r.z || z < r.y || z > r.w) return {strata: 0, outdoor: 0};
  // (lane FOG, task reactor-submit-roof-fog-20261102: the strata table is the march's TABLE_N x 1 float texture — read its texels)
  const tab = (u.depthTab as unknown as {value: THREE.DataTexture}).value.image.data as Float32Array, N = REACTOR_AIR.TABLE_N;
  const fu = Math.min(1, Math.max(0, (y - g.x) * g.z)) * (N - 1), fl = Math.min(Math.floor(fu), N - 2);
  const strata = y < g.y ? tab[fl] + (tab[fl + 1] - tab[fl]) * (fu - fl) : 0;
  return {strata, outdoor: o.z * sstep(o.x, o.y, y)};
}

const reactor = (() => { let L: StationLayout | null = null; return () => (L ??= LEVELS.reactor.generate('main', {levelSeed: 9100})); })();
const office = (() => { let L: StationLayout | null = null; return () => (L ??= generateOfficeLevel({levelSeed: 12345, startWeapon: 'pistol'} as never)); })();
const atmo = () => new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
const sync = (a: VolumetricAtmosphere, scene = new THREE.Scene()) => a.sync(scene, new THREE.PerspectiveCamera(), 1);

describe('gaslight: every gas look is GREEN and visibly dense at the damage threshold', () => {
  it('breach / puff gas (the Office benchmark), the Reactor strata, the outdoor air: opacity + green glow over their view paths', () => {
    const c = GAS.THRESHOLD;
    // the breach term (Office window breach + Blightbelly puffs share it): a 4 m room
    const breach = {ext: GAS.EXT, emission: GAS.EMISSION, tint: GAS.TINT};
    expect(gasOpacity(breach, c, 4)).toBeGreaterThan(0.35);
    expect(greenness(breach.tint)).toBeGreaterThan(1.2);
    // the Reactor depth strata at the top of zone 1 (its thinnest gas) across 20 m of the pit (looking across / down into it)
    const depth = {ext: REACTOR_GAS_LOOK.ext, emission: REACTOR_GAS_LOOK.emission, tint: REACTOR_GAS_LOOK.tint};
    expect(gasOpacity(depth, 0.14, 20)).toBeGreaterThan(0.35);
    const sat = gasGlow(depth, 1, 1e3); // the unlit glow of thick strata (linear): clearly green, bright enough to read in the dark pit
    expect(greenness(sat)).toBeGreaterThan(1.6);
    expect(luminance(sat)).toBeGreaterThan(0.1);
    expect(luminance(gasGlow({...depth, emission: 0.08, tint: [0.5, 0.62, 0.22]}, 1, 1e3))).toBeLessThan(0.05); // (old)
    // the outdoor air: the Office roof deck across 25 m; above the Reactor's open top across 30 m
    expect(gasOpacity(ROOF_GAS_LOOK, GAS.ROOF_OUTDOOR_C, 25, ROOF_GAS_LOOK.vis)).toBeGreaterThan(0.25);
    expect(greenness(ROOF_GAS_LOOK.tint)).toBeGreaterThan(1.2);
    expect(gasOpacity(depth, REACTOR_OUTDOOR.c, 30, REACTOR_OUTDOOR.vis)).toBeGreaterThan(0.4);
  });

  it('ordinary (non-hazard) fog is not green: the Reactor scene fog is a neutral grey now, the indoor murk near-black', () => {
    expect(greenness(hexRgb(REACTOR_FOG.color))).toBeLessThan(1.08);
    expect(greenness(hexRgb(0x283020))).toBeGreaterThan(1.15); // (the old olive)
    expect(luminance(hexRgb(MOOD.fogColor))).toBeLessThan(0.01);
  });
});

describe('gaslight: hazard <-> render parity (one function per source)', () => {
  it('the Reactor (real layout): strata + the open top\'s outdoor air drawn exactly where / as strong as they hurt; the rim is clean', () => {
    const L = reactor(), info = L.reactor!;
    const air = new ReactorAir(info, layoutRect(L), emptyReactorState(info.generators.length, info.zones.length));
    const a = atmo();
    a.setStation(L, null);
    a.setDepthGas(air.renderTable());
    sync(a);
    const b = info.pit.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    let checked = 0;
    for (let y = info.pit.floorY + 0.5; y < info.pit.roofY + 12; y += 0.37) {
      for (const [x, z] of [[cx, cz], [b.x0 + 1, b.z0 + 2], [b.x1 - 3, cz]] as const) {
        const hz = air.depthGasAt(x, y, z), rc = renderC(a.u, x, y, z);
        expect(Math.max(rc.strata, rc.outdoor), `y ${y.toFixed(2)}`).toBeCloseTo(hz, 6);
        expect(Math.min(rc.strata, rc.outdoor)).toBeLessThan(1e-9); // never overlapping
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    // the clean rim (eye height on the rim, the station) and the whole pit air between the strata top and the roof line: nothing drawn
    for (let y = 0; y < info.pit.roofY + REACTOR_OUTDOOR.rampLo; y += 0.5) {
      expect(air.depthGasAt(cx, y, cz)).toBe(0);
      expect(renderC(a.u, cx, y, cz)).toEqual({strata: 0, outdoor: 0});
    }
    // the toxic sky is out of reach — task studio-reactor-surface-ending-20261102 (lane ENDING, user: "This door should lead up a set of
    // stairs, towards a surface area … The surface is habitable again!"): supersedes "nothing walkable at or above the roof line". The
    // only walkable cells up there are the surface exit's (the plaza on the roof, its upper passage, the stair's top flights), sealed
    // behind the exterior door until the core air has cleared after ONLINE; by then the outdoor air over them is gone (nothing drawn,
    // nothing breathed: the same function)
    const S = info.surface!, exit = new Set([S.areas.plaza, S.areas.upper, S.areas.stair]);
    const opened = reactorOutdoorGas(info.pit.roofY, layoutRect(L), skyClearAt(WIN.airAtS + REACTOR_AIR.CLEAR_ALL_S));
    let up = 0;
    for (const lv of L.levels) for (let i = 0; i < lv.grid.cells.length; i++) {
      if (lv.grid.cells[i] !== FLOOR || lv.grid.floor[i] < info.pit.roofY - 5) continue;
      expect(exit.has(lv.grid.area[i]), `walkable at ${lv.grid.floor[i]} on level ${lv.id}`).toBe(true);
      const x = ((i % lv.grid.w) + 0.5) * CELL, z = (Math.floor(i / lv.grid.w) + 0.5) * CELL;
      if (up++ % 7 === 0) expect(outdoorGasAt(opened, x, lv.grid.floor[i] + 1.6, z)).toBe(0);
    }
    expect(up).toBeGreaterThan(1000);
    // the deadly core floor draws dense green strata; the outdoor air above the top is the surface atmosphere
    expect(renderC(a.u, cx, info.pit.floorY + 1.6, cz).strata).toBeGreaterThan(0.7);
    // balance: the uncleared column is substantial green murk from the rim, yet the core still reads through it (its glow / CORE's lights)
    let od = 0;
    for (let y = 0; y > info.pit.floorY + 1; y -= 0.05) od += air.tableAt(y) * REACTOR_GAS_LOOK.ext * 0.05;
    expect(Math.exp(-od)).toBeGreaterThan(0.08);
    expect(Math.exp(-od)).toBeLessThan(0.4);
    expect(renderC(a.u, cx, info.pit.roofY + 10, cz).outdoor).toBeCloseTo(REACTOR_OUTDOOR.c, 6);
  });

  it('the Reactor: clearing thins the DRAWN strata exactly as the hazard drops (zone by zone), the outdoor air stays', () => {
    const info = fixtureInfo(), st = emptyReactorState(3, 3);
    const air = new ReactorAir(info, {x0: 0, z0: 0, x1: 80, z1: 80}, st);
    const a = atmo();
    a.setStation({...generateStation(5), reactor: info} as StationLayout, null);
    const zoneMid = (k: number) => (info.zones[k].yTop + info.zones[k].yBottom) / 2;
    a.setDepthGas(air.renderTable());
    sync(a);
    const before = [0, 1, 2].map(k => renderC(a.u, 40, zoneMid(k), 40).strata);
    expect(before.every(v => v > GAS.THRESHOLD)).toBe(true);
    st.generators[0] = {started: true, startedAt: 0};
    air.update(1e4);
    a.setDepthGas(air.renderTable());
    sync(a);
    const after = [0, 1, 2].map(k => renderC(a.u, 40, zoneMid(k), 40).strata);
    expect(after[0]).toBeLessThan(0.01); // zone 1 cleared: drawn clear
    expect(after[1]).toBeCloseTo(before[1], 6); // the others untouched
    expect(after[2]).toBeCloseTo(before[2], 6);
    for (const k of [0, 1, 2]) expect(after[k]).toBeCloseTo(air.depthGasAt(40, zoneMid(k), 40), 6);
    expect(renderC(a.u, 40, info.pit.roofY + 8, 40).outdoor).toBeGreaterThan(0.5);
  });

  it('the Office roof: the regional term draws roofBlend x ROOF_OUTDOOR_C (the exposure) over the deck, nothing indoors; the Subway compiles none', () => {
    const L = office(), roof = roofAirOf(L)!;
    const a = atmo();
    a.setStation(L, null);
    sync(a);
    expect(a.depthDebug()).toMatchObject({compiled: true, on: true});
    expect(a.depthDebug().look.ext).toBe(ROOF_GAS_LOOK.ext);
    const f = roof.foot;
    for (const [x, z] of [[(f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2], [f.x0 + 0.5, f.z1 - 0.7], [f.x1 + 1.2, f.z0 - 1.2], [f.x1 + 3, f.z0]] as const) {
      for (let y = roof.baseY - 4; y < roof.baseY + 8; y += 0.21) {
        const hz = GAS.ROOF_OUTDOOR_C * roofBlend(x, y, z, roof), rc = renderC(a.u, x, y, z);
        expect(rc.outdoor, `${x},${y.toFixed(2)},${z}`).toBeCloseTo(hz, 6);
        expect(rc.strata).toBe(0);
      }
    }
    expect(renderC(a.u, (f.x0 + f.x1) / 2, roof.baseY - 3, (f.z0 + f.z1) / 2).outdoor).toBe(0); // the top floor below the deck: clean
    const sub = atmo();
    sub.setStation(generateStation(20261101), null);
    expect(sub.depthDebug()).toMatchObject({compiled: false, on: false});
  });

  it('Blightbelly puffs (any level): what the exposure samples at the eye IS the uploaded gas layer x the shared height profile', () => {
    const g = new Grid(60, 40);
    for (let y = 2; y < 38; y++) for (let x = 2; x < 58; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.area[i] = 0; g.floor[i] = 0; g.ceil[i] = 3.2; }
    const L = {...generateStation(1), grid: g, levels: [{id: 0, role: 'main', grid: g, baseY: 0}]} as unknown as StationLayout;
    const layer = new Float32Array(g.w * g.h);
    const h = {
      player: {x: 15, z: 10, y: 0, eye: 1.6, alive: true, takeDamage() {}}, layout: L, tower: {office: null},
      atmosphere: {active: true, setGasLayer: (_s: number, f: ArrayLike<number>, r: {x0: number; y0: number; w: number; h: number}) => {
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) layer[(r.y0 + y) * g.w + r.x0 + x] = Math.round(Math.min(1, Math.max(0, f[y * r.w + x])) * 255) / 255;
      }},
      run: {laneStore: () => undefined, setLaneStore() {}}, clock: 0, state: 'playing',
      frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    };
    const sys = installGas(h as unknown as GasHost);
    for (const s of h.sectionHooks) s.build?.(L);
    expect(sys.addPuff({id: 'b', level: 0, x: 15.2, y: 0, z: 10.1, radius: 1.5, peak: 0.6, durationS: 30})).toBe(true);
    for (let k = 0; k < 30; k++) for (const f of h.frameHooks) f(0.1);
    let n = 0;
    for (const [x, z] of [[15.2, 10.1], [16, 10.4], [14.1, 9.6], [17.4, 11.2]] as const) {
      h.player.x = x; h.player.z = z;
      for (const f of h.frameHooks) f(1 / 60);
      // the march samples the R8 layer bilinearly (texel centres = cell centres), exactly as the puff's own sample
      const u = x / CELL - 0.5, v = z / CELL - 0.5, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
      const at = (a: number, b: number) => layer[b * g.w + a];
      const bil = (at(iu, iv) * (1 - fu) + at(iu + 1, iv) * fu) * (1 - fv) + (at(iu, iv + 1) * (1 - fu) + at(iu + 1, iv + 1) * fu) * fv;
      const drawn = bil * gasProfile(1.6, 0, 3.2);
      expect(sys.exposure.puff!).toBeGreaterThan(0.05);
      expect(Math.abs(sys.exposure.puff! - drawn)).toBeLessThan(1.5 / 255); // (R8 quantisation)
      n++;
    }
    expect(n).toBe(4);
  });
});

describe('gaslight: the mask never hides gas; the in-engine fallback', () => {
  it('protection (mask on + filter) changes only the damage: the uploads, the exposure c and the fallback stay', () => {
    const info = fixtureInfo();
    const L = {...generateStation(3), reactor: info} as StationLayout;
    const fallbacks: number[] = [];
    const h = {
      player: {x: 40, z: 40, y: -30, eye: -28.4, alive: true, takeDamage() {}}, layout: L, tower: {office: null},
      atmosphere: {active: false, setGasLayer() {}, setGasFallback: (c: number) => { fallbacks.push(c); }},
      run: {laneStore: () => undefined, setLaneStore() {}}, clock: 0, state: 'playing',
      frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    };
    const sys = installGas(h as unknown as GasHost);
    for (const s of h.sectionHooks) s.build?.(L);
    sys.depth = new ReactorAir(info, {x0: 0, z0: 0, x1: 80, z1: 80}, emptyReactorState(3, 3));
    for (const f of h.frameHooks) f(0.1);
    const bare = {c: sys.exposure.c, fb: fallbacks.at(-1)!};
    sys.protection = () => true;
    for (const f of h.frameHooks) f(0.1);
    expect(sys.exposure.protected).toBe(true);
    expect(sys.exposure.dps).toBe(0);
    expect(sys.exposure.c).toBeCloseTo(bare.c, 9);
    expect(fallbacks.at(-1)).toBeCloseTo(bare.fb, 9);
    expect(bare.fb).toBeGreaterThan(0.5);
    expect(sys.hud.shown.haze).toBe(0); // no CSS screen haze any more
  });

  it('withGasFog: the scene FogExp2 is tinted green + thickened for the draw, then restored exactly; no gas: untouched', () => {
    const a = atmo(), scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(REACTOR_FOG.color, REACTOR_FOG.density);
    const fog = scene.fog as THREE.FogExp2, c0 = fog.color.clone(), d0 = fog.density;
    let seen: {color: THREE.Color; density: number} | null = null;
    a.setGasFallback(0.6);
    a.withGasFog(scene, () => { seen = {color: fog.color.clone(), density: fog.density}; });
    expect(seen!.density).toBeGreaterThan(d0 + 0.05);
    expect(greenness([seen!.color.r, seen!.color.g, seen!.color.b])).toBeGreaterThan(1.4);
    expect(fog.color.equals(c0)).toBe(true);
    expect(fog.density).toBe(d0);
    const want = fallbackFog(0.6, {color: [c0.r, c0.g, c0.b], density: d0});
    expect(seen!.color.g).toBeCloseTo(want.color[1], 6);
    expect(greenness(GAS_FALLBACK.color)).toBeGreaterThan(1.5);
    a.setGasFallback(0);
    a.withGasFog(scene, () => { seen = {color: fog.color.clone(), density: fog.density}; });
    expect(seen!.color.equals(c0)).toBe(true);
    expect(a.gasFallbackFrames).toBe(1);
    // a throwing draw still restores the fog
    a.setGasFallback(1);
    expect(() => a.withGasFog(scene, () => { throw new Error('x'); })).toThrow();
    expect(fog.density).toBe(d0);
  });
});

describe('gaslight: the reactor march variant, the shafts, the open scatter lights', () => {
  const textures = (shadow: boolean) => {
    const sh = new THREE.DepthTexture(8, 8);
    sh.compareFunction = THREE.LessEqualCompare;
    const arr = (c: number) => new THREE.DataArrayTexture(new Uint8Array(4 * c), 1, 1, 4);
    return {depth: new THREE.DepthTexture(8, 8), noise: new THREE.Data3DTexture(new Uint8Array(64), 2, 2, 4), density: arr(4), air: arr(1), vis: arr(1), shadow: shadow ? sh : null};
  };
  it('compiles for GLSL ES 3.0 + WGSL with the outdoor part and the light shafts (explicit-LOD lookups, one shadow compare)', () => {
    for (const backend of ['glsl', 'wgsl'] as const) {
      const f = compileQuad(createMarchMaterial(createFogUniforms(), textures(true), {steps: 14, depth: true}), backend).fragment;
      expect(f).toContain(VF_MARK.march);
      expect(f).toContain(VF_DEPTH_MARK);
      if (backend === 'wgsl') {
        expect(f.split('\n').filter(l => l.includes('textureSampleCompare(')).length).toBe(1);
        expect(f.split('\n').filter(l => /textureSample\(/.test(l))).toEqual([]);
      }
    }
  });

  // task reactor-submit-roof-fog-20261102 (lane ROOF): the shafts come through the roof's single opening over the core only (was: the
  // whole open top, striped by the open beam grid)
  it('shafts: only through the roof OPENING (soft rim, none under the solid roof), fading with depth; the uniforms follow the opening', () => {
    const info = fixtureInfo(), s = pitShaftSpec(info)!, o = roofOpeningOf(info)!;
    expect(s.hole).toEqual({x: o.x, z: o.z, r: o.r});
    const d = PIT_SHAFTS.dir, Y = info.pit.roofY;
    /** The shaft at height y on the ray whose roof-plane crossing is (hole centre + (dx, dz)). */
    const at = (y: number, dx: number, dz: number) => { const t = Y - y; return shaftAt(s, o.x + dx + (d[0] / -d[1]) * t, y, o.z + dz + (d[2] / -d[1]) * t); };
    expect(shaftAt(s, o.x, Y + 1, o.z)).toBe(0); // above the roof
    expect(shaftAt(s, 10, -5, 10)).toBe(0); // outside the pit
    expect(shaftAt(s, info.pit.bounds.x0 + 2, Y - 2, info.pit.bounds.z0 + 2)).toBe(0); // under the solid roof
    const top = at(Y - 2, 0, 0);
    expect(top).toBeGreaterThan(0.8);
    expect(at(Y - 2, o.r - PIT_SHAFTS.rimSoft - 0.05, 0)).toBeCloseTo(top, 6); // full inside the rim
    expect(at(Y - 2, o.r - 0.6, 0)).toBeLessThan(top); // the soft rim
    expect(at(Y - 2, o.r + 0.01, 0)).toBe(0); // the curb's edge: nothing past it
    expect(at(Y - 2, 0, -(o.r + 0.5))).toBe(0);
    // a sweep across the pit just under the roof: lit exactly over the opening's chord
    let lit = 0, outside = 0;
    for (let x = info.pit.bounds.x0; x < info.pit.bounds.x1; x += 0.1) {
      const t = 2, qx = x - (d[0] / -d[1]) * t, v = shaftAt(s, x, Y - t, o.z + (d[2] / -d[1]) * t);
      if (v > 0) { lit++; if (Math.abs(qx - o.x) >= o.r) outside++; }
    }
    expect(lit * 0.1).toBeGreaterThan(2 * o.r - 0.3);
    expect(lit * 0.1).toBeLessThan(2 * o.r + 0.2);
    expect(outside).toBe(0);
    expect(at(info.pit.floorY + 2, 0, 0)).toBeLessThan(top); // fades with depth
    const a = atmo();
    a.setStation({...generateStation(5), reactor: info} as StationLayout, null);
    a.setDepthGas(new ReactorAir(info, {x0: 0, z0: 0, x1: 80, z1: 80}, emptyReactorState(3, 3)).renderTable());
    sync(a);
    const dir = a.u.shaftDir.value as THREE.Vector4, A = a.u.shaftA.value as THREE.Vector4, H = a.u.shaftHole.value as THREE.Vector4;
    expect(dir.w).toBe(1);
    expect(dir.y).toBeLessThan(-0.9);
    expect(A.x).toBe(info.pit.roofY);
    expect([H.x, H.y, H.z, H.w]).toEqual([o.x, o.z, o.r, Math.min(PIT_SHAFTS.rimSoft, o.r)]);
    expect((a.u.shaftCol.value as THREE.Vector3).y).toBeCloseTo(PIT_SHAFTS.colour[1] * PIT_SHAFTS.gain, 6);
    expect(outdoorGasAt(a.depthDebug().outdoor, 40, info.pit.roofY + 9, 40)).toBeCloseTo(REACTOR_OUTDOOR.c, 6);
  });

  it('a scatter light flagged userData.vfOpen (the core / coolant glow in the open pit) lights the medium with no occlusion window', () => {
    const a = atmo();
    a.setStation(generateStation(5), null);
    const open = new THREE.PointLight(0x40ff80, 3, 40, 2), boxed = new THREE.PointLight(0xff3010, 3, 10, 2);
    open.userData.vfOpen = true;
    open.position.set(20, -20, 20); boxed.position.set(12, 1, 6);
    a.addScatterLight(open); a.addScatterLight(boxed);
    sync(a);
    const win = a.u.win.array as THREE.Vector4[], winY = a.u.winY.array as THREE.Vector4[];
    expect(a.u.scatCount.value).toBe(2);
    expect(win[0].w).toBe(-1);
    expect(winY[0].x).toBe(-1e3);
  });
});
