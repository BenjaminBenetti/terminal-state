// Task studio-surface-run-field-followup-20261116-211729-01 (lane FOG): THE OUTER FOG IS VISIBLE GREEN VOLUMETRIC FOG MATCHING ITS HAZARD —
// the visibility test root CLAUDE.md requires for a new gas source ("Toxic gas is always VISIBLE green volumetric fog": one source of
// truth for what hurts and what shows; visible on both backends at normal quality; the in-engine fallback when the pass is off; a worn
// mask never hides it). On the synthetic district (tests/helpers/surfaceAirFixture.ts) given a v2 fog-pressure boundary, with the REAL
// gas system, the REAL Surface air runtime and a REAL VolumetricAtmosphere:
//  - the march's pressure uniforms are the boundary's (render/volumetric.ts fogDebug: plain uniforms), off without one;
//  - exposure c == surfaceOutdoorGasAt (the thicker air), exposure pressure == surfacePressureAt, and the march's near-term outdoor
//    density mirrored from ITS OWN column bytes + uniforms == surfaceOutdoorGasAt x fogThicken at every sampled point;
//  - the far term (beyond the march's reach) draws exactly the pressure's excess over the base air: 0 in clear, rising outward;
//  - the mask changes the damage only; the pass OFF: the scene fog at the eye thickens / greens by the pressure (and thins back);
//  - the surface program carries the pressure terms with no new uniform buffer or texture, WGSL and GLSL.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {compileQuad} from './helpers/fogCompile';
import {SA_AT, surfaceAirFixture, surfaceAirGame} from './helpers/surfaceAirFixture';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceBoundary} from '../src/gen/surface/surfaceTypes';
import {WorldMaterials} from '../src/world/materials';
import {ATMOSPHERE, ATMOSPHERE_QUALITY} from '../src/render/atmosphere';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {VF_DEPTH_MARK, VF_FOG_FAR, VF_FOG_MARK, VF_SURFACE_MARK, createFogUniforms, createMarchMaterial, outdoorMapTexture} from '../src/render/volumetricShaders';
import {GAS_FALLBACK} from '../src/world/gaslightRules';
import {SURFACE_AIR, SURFACE_GAS_LOOK, surfaceOutdoorGasAt, surfaceOutdoorMap, surfacePressureAt} from '../src/world/surface/airMask';
import {FOG_PRESSURE, fogPressureAt} from '../src/world/surface/fogPressure';
import {FOG_AIR, fogConcentration, fogPressureDps, fogThicken} from '../src/world/surface/fogAir';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

/** The fixture's street round a small clear rect; a short ramp so the 60 x 42 m fixture holds pressures past the cap. */
const BOUND: SurfaceBoundary = {clear: {x0: 20, z0: 16, x1: 40, z1: 28}, ramp: 8, edge: {x0: 0.5, z0: 0.5, x1: 59.5, z1: 41.5}};
const withBoundary = (): StationLayout => { const L = surfaceAirFixture(); (L.surface as {boundary?: SurfaceBoundary}).boundary = structuredClone(BOUND); return L; };
const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * CPU mirror of the surface variant's NEAR-term outdoor density at (x, y, z) from EXACTLY what the march reads: the column texture's
 * bytes, the regional rect / outdoor uniforms (depthDebug) and the fog-pressure uniforms (fogDebug) — render/volumetricShaders.ts fogAt:
 * c = c0 + (1 - c0) clamp(p) bank, thick = 1 + gain min(p, cap)^expo bank (p > 0), x the strata ramp x the column's outdoor weight.
 */
function marchNear(atmo: VolumetricAtmosphere, x: number, y: number, z: number): number {
  const s = atmo.surfaceDebug(), d = atmo.depthDebug(), f = atmo.fogDebug();
  if (!s.compiled || !d.on || !d.outdoor || !s.texture) return 0;
  const [rx0, rz0, rx1, rz1] = d.rect;
  if (x < rx0 || x > rx1 || z < rz0 || z > rz1) return 0;
  const img = s.texture.image as {width: number; height: number; data: Uint8Array};
  const cx = Math.min(img.width - 1, Math.max(0, Math.floor(x / CELL))), cy = Math.min(img.height - 1, Math.max(0, Math.floor(z / CELL)));
  const top = img.data[cy * img.width + cx] * SURFACE_AIR.TOP_STEP;
  const o = d.outdoor, {c0, thick} = fogTerms(f, o.c, x, y, z);
  return c0 * thick * sstep(o.y0, o.y1, y) * sstep(top - SURFACE_AIR.EDGE, top, y);
}

/** The shader's fogAt from the uniforms (c is returned as c0 for the caller's product). */
function fogTerms(f: ReturnType<VolumetricAtmosphere['fogDebug']>, c0: number, x: number, y: number, z: number): {c0: number; thick: number; p: number} {
  const [x0, z0, x1, z1] = f.clear, [inv, gain, expo, cap] = f.p, [b0, b1] = f.bank;
  const p = Math.max(x0 - x, x - x1, z0 - z, z - z1, 0) * inv, bank = 1 - sstep(b0, b1, y);
  const c = c0 + (1 - c0) * Math.min(1, Math.max(0, p)) * bank;
  const thick = p > 0 ? 1 + gain * Math.pow(Math.max(Math.min(p, cap), 1e-6), expo) * bank : 1;
  return {c0: c, thick, p};
}

/** The FAR term's extinction at an open point (the excess over the base air: the scene fog stands for the base there). */
function marchFar(atmo: VolumetricAtmosphere, x: number, y: number, z: number): number {
  const d = atmo.depthDebug(), f = atmo.fogDebug(), o = d.outdoor!;
  if (!(f.p[0] > 0)) return 0;
  const {c0: c, thick} = fogTerms(f, o.c, x, y, z);
  return Math.max(c * thick - o.c, 0) * sstep(o.y0, o.y1, y) * o.vis * d.look.ext;
}

/** Points: street (clear and out in the ramp / beyond the cap), above the roofs, inside sealed columns, at several heights. */
const POINTS: [number, number][] = [[SA_AT.street.x, SA_AT.street.z], [21, 23], [19, 23], [16, 23], [12, 36], [28, 33], [28, 40], [45, 23], [50, 23], [56, 24],
  [3, 3], [4, 38], [SA_AT.b0.x, SA_AT.b0.z], [SA_AT.b1.x, SA_AT.b1.z], [SA_AT.b2.x, SA_AT.b2.z], [SA_AT.tent.x, SA_AT.tent.z]];
const HEIGHTS = [0.3, 1.6, 2.5, 5, 8.5, 20];

describe('surface fog parity: the pressure uniforms are the boundary', () => {
  it('a v2 boundary sets [clear], [1 / ramp, gain, expo, cap], [bank]; none (v1) = off, the outdoor term exactly as before', () => {
    const g = surfaceAirGame(withBoundary(), mats);
    const f = g.atmo.fogDebug();
    expect(f.clear).toEqual([BOUND.clear.x0, BOUND.clear.z0, BOUND.clear.x1, BOUND.clear.z1]);
    expect(f.p[0]).toBeCloseTo(1 / BOUND.ramp, 7);
    expect(f.p.slice(1)).toEqual([FOG_AIR.gain, FOG_AIR.expo, FOG_AIR.cap]);
    expect(f.bank).toEqual([FOG_AIR.bank.y0, FOG_AIR.bank.y1]);
    const v1 = surfaceAirGame(surfaceAirFixture(), mats);
    expect(v1.atmo.fogDebug().p[0]).toBe(0);
    expect(marchFar(v1.atmo, 3, 1.6, 3)).toBe(0);
    for (const [x, z] of POINTS) expect(marchNear(v1.atmo, x, 1.6, z)).toBeCloseTo(surfaceOutdoorGasAt(surfaceOutdoorMap(v1.h.layout), x, 1.6, z), 6);
    // a new world without a boundary resets it
    g.atmo.setStation(surfaceAirFixture(), null);
    expect(g.atmo.fogDebug().p[0]).toBe(0);
  });
});

describe('surface fog parity: what hurts is what shows (one field)', () => {
  it('exposure c == surfaceOutdoorGasAt, pressure == surfacePressureAt, the march near term == surfaceOutdoorGasAt x fogThicken, everywhere', () => {
    const L = withBoundary(), g = surfaceAirGame(L, mats), m = surfaceOutdoorMap(L)!;
    expect(m.boundary).toEqual(BOUND);
    let outside = 0, high = 0;
    for (const [x, z] of POINTS) {
      for (const y of HEIGHTS) {
        const want = surfaceOutdoorGasAt(m, x, y, z) * fogThicken(fogPressureAt(BOUND, x, z), y);
        expect(marchNear(g.atmo, x, y, z), `march at ${x},${y},${z}`).toBeCloseTo(want, 5);
      }
      const e = g.eyeAt(x, z);
      // (the outdoor part: B1's pre-broken pane fills its room with the breach field — the eye there breathes that, the larger)
      expect(e.outdoor, `exposure at ${x},${z}`).toBeCloseTo(surfaceOutdoorGasAt(m, x, 1.6, z), 9);
      expect(e.c).toBeGreaterThanOrEqual(e.outdoor - 1e-12);
      expect(e.pressure).toBeCloseTo(surfacePressureAt(m, x, 1.6, z), 9);
      const p = fogPressureAt(BOUND, x, z);
      if (p > 0 && surfacePressureAt(m, x, 1.6, z) > 0) {
        outside++;
        // the thicker air hurts AND shows thicker: both rise with the same field
        expect(e.outdoor).toBeCloseTo(fogConcentration(SURFACE_AIR.C, p, 1.6), 9);
        expect(marchNear(g.atmo, x, 1.6, z)).toBeGreaterThan(SURFACE_AIR.C);
        if (p > FOG_PRESSURE.foot) { high++; expect(e.pressureDps).toBeCloseTo(fogPressureDps(p), 9); }
      }
    }
    expect(outside).toBeGreaterThanOrEqual(8);
    expect(high).toBeGreaterThanOrEqual(6);
    // sealed columns: no gas, no pressure, nothing drawn (the boundary never leaks into a building)
    for (const at of [SA_AT.b0, SA_AT.b1]) {
      expect(g.eyeAt(at.x, at.z).pressure).toBe(0);
      expect(marchNear(g.atmo, at.x, 1.6, at.z)).toBe(0);
    }
  });

  it('the fog thickens monotonically outward along a street ray, drawn and breathed alike; inside clear it is the base look exactly', () => {
    const L = withBoundary(), g = surfaceAirGame(L, mats), m = surfaceOutdoorMap(L)!;
    let prevC = 0, prevD = 0;
    for (let x = 39; x >= 1; x -= 0.5) {
      const z = 24, d = marchNear(g.atmo, x, 1.6, z), c = surfaceOutdoorGasAt(m, x, 1.6, z);
      if (x >= BOUND.clear.x0) { expect(d).toBeCloseTo(SURFACE_AIR.C, 6); expect(marchFar(g.atmo, x, 1.6, z)).toBe(0); }
      expect(c).toBeGreaterThanOrEqual(prevC - 1e-12);
      expect(d).toBeGreaterThanOrEqual(prevD - 1e-6);
      prevC = c; prevD = d;
    }
    expect(prevD / SURFACE_AIR.C).toBeGreaterThan(1 + FOG_AIR.gain); // past pressure 1 the look is many times the base
  });

  it('the far term (past the march\'s reach, to the visible surface): exactly the excess over the base air, 0 in clear, rising outward', () => {
    const L = withBoundary(), g = surfaceAirGame(L, mats);
    const d = g.atmo.depthDebug();
    expect(d.look.ext).toBe(SURFACE_GAS_LOOK.ext);
    expect(VF_FOG_FAR.maxDist).toBeGreaterThan(ATMOSPHERE.maxDistance * 10); // (the march ends at its maxDistance; the far term goes on)
    let prev = 0;
    for (let x = 30; x >= 1; x -= 1) {
      const s = marchFar(g.atmo, x, 1.6, 24), near = marchNear(g.atmo, x, 1.6, 24);
      // the near term's extinction minus the base air's = the far term (the base beyond the march is the scene fog)
      expect(s).toBeCloseTo(Math.max(0, near - SURFACE_AIR.C) * SURFACE_GAS_LOOK.vis * SURFACE_GAS_LOOK.ext, 6);
      if (x >= BOUND.clear.x0) expect(s).toBe(0);
      else if (fogPressureAt(BOUND, x, 24) <= FOG_AIR.cap) expect(s).toBeGreaterThan(prev);
      else expect(s).toBeGreaterThanOrEqual(prev); // (past the cap: the thickest it gets, held)
      prev = s;
    }
    // high above the street the bank is gone: nothing extra up there (never a green sky dome)
    expect(marchFar(g.atmo, 3, FOG_AIR.bank.y1 + 5, 24)).toBe(0);
  });

  it('a worn mask: dps changes (the pressure part stays), nothing drawn or breathed changes', () => {
    const L = withBoundary(), g = surfaceAirGame(L, mats);
    for (const [x, z] of [[16, 23], [12, 36], [50, 23]] as const) {
      const bare = {...g.eyeAt(x, z)}, fogK = g.air.fog.k, mo = marchNear(g.atmo, x, 1.6, z), far = marchFar(g.atmo, x, 1.6, z);
      g.sys.protection = () => true;
      const masked = g.eyeAt(x, z);
      expect(masked.c).toBe(bare.c);
      expect(masked.pressure).toBe(bare.pressure);
      expect(masked.dps).toBeCloseTo(bare.pressureDps ?? 0, 9);
      expect(g.air.fog.k).toBe(fogK);
      expect(marchNear(g.atmo, x, 1.6, z)).toBe(mo);
      expect(marchFar(g.atmo, x, 1.6, z)).toBe(far);
      g.sys.protection = () => false;
    }
  });
});

describe('surface fog parity: the in-engine fallback (the volumetric pass off)', () => {
  it('pass OFF: the scene fog at the eye thickens and greens with the pressure there, and thins back; pass ON: the march draws it, the scene fog stays the base murk', () => {
    const off = surfaceAirGame(withBoundary(), mats, {active: false}), on = surfaceAirGame(withBoundary(), mats, {active: true});
    const fogOf = (g: ReturnType<typeof surfaceAirGame>) => { const f = g.h.scene.fog as THREE.FogExp2; return {d: f.density, r: f.color.r, g: f.color.g, b: f.color.b}; };
    const read = (g: ReturnType<typeof surfaceAirGame>, x: number, z: number) => { g.eyeAt(x, z); return {...fogOf(g), p: g.air.fog.p}; };
    const m = surfaceOutdoorMap(off.h.layout)!;
    const a = read(off, 28, 23), b = read(off, 16, 23), c = read(off, 12, 36), d = read(off, 3, 3);
    expect(a.p).toBe(0);
    expect(b.p).toBeCloseTo(surfacePressureAt(m, 16, 1.6, 23), 9);
    expect(b.p).toBeGreaterThan(0);
    expect(b.d).toBeGreaterThan(a.d);
    expect(c.d).toBeGreaterThan(b.d);
    expect(d.d).toBeGreaterThan(c.d);
    // greener: toward the gas fallback's green (green the strongest channel), more so deeper
    const greenK = (f: {r: number; g: number; b: number}) => f.g / Math.max(1e-6, f.r + f.b);
    expect(GAS_FALLBACK.color[1]).toBeGreaterThan(GAS_FALLBACK.color[0]);
    expect(d.g).toBeGreaterThan(d.r);
    expect(d.g).toBeGreaterThan(d.b);
    expect(greenK(d)).toBeGreaterThan(greenK(a));
    // clearing (walking back in): it thins visibly with the pressure, back to the base murk inside clear
    const back = read(off, 16, 23);
    expect(back.d).toBeCloseTo(b.d, 9);
    expect(read(off, 28, 23).d).toBeCloseTo(a.d, 9);
    // the pass on: the scene fog is the base murk everywhere (the march draws the pressure fog where it is)
    const ref = read(on, 28, 23);
    for (const [x, z] of [[16, 23], [12, 36], [3, 3]] as const) {
      const f = read(on, x, z);
      expect(f.p).toBe(0);
      expect(f.d).toBeCloseTo(ref.d, 9);
    }
    // the mask never hides it (pass off)
    off.sys.protection = () => true;
    expect(read(off, 3, 3).d).toBeCloseTo(d.d, 9);
  });
});

describe('surface fog parity: the surface program carries the pressure terms within WebGPU\'s limits, both backends', () => {
  const wgsl = (src: string) => ({uniformBuffers: (src.match(/var<uniform>/g) ?? []).length, textures: (src.match(/^@binding\(.*\) var \w+ : texture_/gm) ?? []).length});
  const glsl = (src: string) => ({uniformBuffers: (src.match(/^(layout\(\s*std140\s*\)\s*)?uniform\s+\w+\s*\{/gm) ?? []).length,
    textures: (src.match(/^uniform\s+(highp\s+|mediump\s+|lowp\s+)?\w*sampler\w*\s+\w+;/gm) ?? []).length});
  const textures = (outdoor: boolean) => {
    const arr = (c: number) => new THREE.DataArrayTexture(new Uint8Array(4 * c), 1, 1, 4);
    const gas = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 3), 4, 4, 3);
    gas.format = THREE.RedFormat;
    return {depth: new THREE.DepthTexture(8, 8), noise: new THREE.Data3DTexture(new Uint8Array(64), 2, 2, 4), density: arr(4), air: arr(1), vis: arr(1), shadow: null, gas,
      ...(outdoor ? {outdoor: outdoorMapTexture(new Uint8Array(16), 4, 4)} : {})};
  };
  it('the pressure variable and the far term in the surface variant only; no new uniform buffer / texture (<= 12 / 16)', () => {
    for (const backend of ['wgsl', 'glsl'] as const) {
      const count = backend === 'wgsl' ? wgsl : glsl;
      for (const steps of [ATMOSPHERE_QUALITY.low.steps, ATMOSPHERE_QUALITY.high.steps]) {
        const depth = compileQuad(createMarchMaterial(createFogUniforms(), textures(false), {steps, depth: true}), backend);
        const surf = compileQuad(createMarchMaterial(createFogUniforms(), textures(true), {steps, depth: true, surface: true}), backend);
        const tag = `${backend} steps=${steps}`;
        expect(surf.fragment, tag).toContain(VF_FOG_MARK);
        expect(surf.fragment, tag).toContain('vfFogLight');
        expect(surf.fragment).toContain(VF_SURFACE_MARK);
        expect(depth.fragment).toContain(VF_DEPTH_MARK);
        expect(depth.fragment).not.toContain(VF_FOG_MARK);
        const a = count(depth.fragment), b = count(surf.fragment);
        expect(b.uniformBuffers, `${tag}: no new uniform buffer`).toBe(a.uniformBuffers);
        expect(b.textures, `${tag}: only the column map`).toBe(a.textures + 1);
        expect(b.uniformBuffers).toBeLessThanOrEqual(12);
        expect(b.textures).toBeLessThanOrEqual(16);
      }
    }
  });
});
