// Task reactor-submit-roof-fog-20261102 (lane FOG): "the fog is still not visible! I think for some reason volumetric fog is not working on
// this level" (WebGPU, quality high). ROOT CAUSE: the binding budget. Every TSL uniformArray is its own uniform buffer and WebGPU's default
// device limit (three's WebGPURenderer requests no higher one) is 12 uniform buffers per shader stage. The base march fragment declares
// exactly 12; the Reactor's depth-gas variant (and, since the outdoor roof air, the Office's) added the strata table as one more array:
// 13 > 12, so the WebGPU pipeline layout was rejected, the pass flagged itself failed and the level rendered straight to the canvas (no
// volumetric fog at all: the user's perf overlay shows 4 / 5 render passes, the direct path's count; the fog pipeline draws 6 / 7). A
// WebGL2 driver with more than 12 fragment uniform blocks (the lead's llvmpipe spot check) ran it, which hid the bug.
//  1. binding budget: every march variant (base / depth x shadow x low / high steps) + temporal + composite stays inside WebGPU's default
//     per-stage limits AND the GLSL ES 3.0 minimums, on both backends; the depth variant adds NO uniform buffer (fails before the fix: 13);
//  2. visible from OUTSIDE the volume: from the clean rim (no exposure at the eye) the march's view rays down into the pit integrate the
//     strata the exposure reads (same table, bit for bit, from the texture the march loads) into a green glow; clearing thins it as the
//     hazard drops; horizontal rays at the rim stay clean;
//  3. level change == boot: travelling into the Reactor (from the Subway / Office) leaves the same compiled term, gate and table as a
//     boot straight into it, and every table change marks the texture for upload.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {RenderTarget} from 'three/webgpu';
import {texture} from 'three/tsl';
import {appendFileSync, writeFileSync} from 'node:fs';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {ATMOSPHERE_QUALITY, integrateMedium, type V3} from '../src/render/atmosphere';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {VF_DEPTH_MARK, createCompositeNode, createFogUniforms, createMarchMaterial, createTemporalMaterial} from '../src/render/volumetricShaders';
import {REACTOR_AIR, REACTOR_GAS_LOOK, ReactorAir} from '../src/world/reactor/air';
import {emptyReactorState} from '../src/world/reactor/runState';
import {layoutRect} from '../src/world/reactor/generators';
import {REACTOR_FOG} from '../src/world/reactor/archInstall';
import {greenness, luminance} from '../src/world/gaslightRules';
import {compileOutputNode, compileQuad} from './helpers/fogCompile';

/** FOG_LIMITS_LOG=/tmp/x.txt: per-variant binding counts and per-ray numbers (vitest swallows console output). */
const LOG = process.env.FOG_LIMITS_LOG;
const log = (s: string) => { if (LOG) appendFileSync(LOG, `${s}\n`); };
if (LOG) writeFileSync(LOG, '');

/** WebGPU's DEFAULT per-stage limits (what a device gets when nothing higher is requested: three requests nothing). */
const WEBGPU_DEFAULT = {uniformBuffers: 12, sampledTextures: 16, samplers: 16} as const;
/** GLSL ES 3.0 minimums (MAX_FRAGMENT_UNIFORM_BLOCKS, MAX_TEXTURE_IMAGE_UNITS) — e.g. ANGLE on D3D11 exposes exactly 12 blocks. */
const GLES3_MIN = {uniformBlocks: 12, textureUnits: 16} as const;

interface Bindings { uniformBuffers: number; textures: number; samplers: number }
function wgslBindings(src: string): Bindings {
  return {
    uniformBuffers: (src.match(/var<uniform>/g) ?? []).length,
    textures: (src.match(/^@binding\(.*\) var \w+ : texture_/gm) ?? []).length,
    samplers: (src.match(/^@binding\(.*\) var \w+ : sampler(_comparison)?;/gm) ?? []).length,
  };
}
function glslBindings(src: string): Bindings {
  const textures = (src.match(/^uniform\s+(highp\s+|mediump\s+|lowp\s+)?\w*sampler\w*\s+\w+;/gm) ?? []).length;
  return {uniformBuffers: (src.match(/^(layout\(\s*std140\s*\)\s*)?uniform\s+\w+\s*\{/gm) ?? []).length, textures, samplers: textures};
}
const bindings = (src: string, backend: 'glsl' | 'wgsl') => (backend === 'wgsl' ? wgslBindings(src) : glslBindings(src));

const textures = (shadow: boolean) => {
  const sh = new THREE.DepthTexture(8, 8);
  sh.compareFunction = THREE.LessEqualCompare;
  const arr = (c: number) => new THREE.DataArrayTexture(new Uint8Array(4 * c), 1, 1, 4);
  const gas = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 3), 4, 4, 3);
  gas.format = THREE.RedFormat;
  return {depth: new THREE.DepthTexture(8, 8), noise: new THREE.Data3DTexture(new Uint8Array(64), 2, 2, 4), density: arr(4), air: arr(1), vis: arr(1), shadow: shadow ? sh : null, gas};
};

describe('fog binding budget: every pass fits WebGPU\'s default per-stage limits and the GLSL ES 3.0 minimums', () => {
  it('the march, every variant (base / Reactor + Office-roof depth term x shadow x low / high steps), both stages, both backends', () => {
    for (const backend of ['wgsl', 'glsl'] as const) {
      for (const shadow of [false, true]) for (const steps of [ATMOSPHERE_QUALITY.low.steps, ATMOSPHERE_QUALITY.high.steps]) {
        const per: Record<string, Bindings> = {};
        for (const depth of [false, true]) {
          const c = compileQuad(createMarchMaterial(createFogUniforms(), textures(shadow), {steps, depth}), backend);
          if (depth) expect(c.fragment).toContain(VF_DEPTH_MARK);
          const f = bindings(c.fragment, backend), v = bindings(c.vertex, backend);
          const tag = `${backend} ${depth ? 'depth' : 'base'} shadow=${shadow} steps=${steps}`;
          log(`${tag}: fragment ${JSON.stringify(f)} vertex ${JSON.stringify(v)}`);
          for (const [stage, b] of [['fragment', f], ['vertex', v]] as const) {
            expect(b.uniformBuffers, `${tag} ${stage} uniform buffers`).toBeLessThanOrEqual(backend === 'wgsl' ? WEBGPU_DEFAULT.uniformBuffers : GLES3_MIN.uniformBlocks);
            expect(b.textures, `${tag} ${stage} sampled textures`).toBeLessThanOrEqual(backend === 'wgsl' ? WEBGPU_DEFAULT.sampledTextures : GLES3_MIN.textureUnits);
            expect(b.samplers, `${tag} ${stage} samplers`).toBeLessThanOrEqual(WEBGPU_DEFAULT.samplers);
          }
          per[depth ? 'depth' : 'base'] = f;
        }
        // the depth term costs one sampled texture (the strata table), never a uniform buffer
        expect(per.depth.uniformBuffers, `${backend}: the depth variant adds no uniform buffer`).toBe(per.base.uniformBuffers);
        expect(per.depth.textures).toBe(per.base.textures + 1);
      }
    }
  });

  it('temporal + composite', () => {
    const u = createFogUniforms();
    const rt = new RenderTarget(4, 4, {count: 2, type: THREE.HalfFloatType});
    const scene = new RenderTarget(8, 8, {type: THREE.HalfFloatType});
    scene.depthTexture = new THREE.DepthTexture(8, 8);
    for (const backend of ['wgsl', 'glsl'] as const) {
      const t = compileQuad(createTemporalMaterial(u, rt.textures[0], rt.textures[1], texture(new THREE.Texture()), texture(new THREE.Texture())), backend);
      const c = compileOutputNode(createCompositeNode(u, texture(scene.texture), texture(scene.depthTexture), texture(rt.textures[0]), texture(rt.textures[1])), backend);
      for (const src of [t.fragment, t.vertex, c.fragment, c.vertex]) {
        const b = bindings(src, backend);
        expect(b.uniformBuffers).toBeLessThanOrEqual(12);
        expect(b.textures).toBeLessThanOrEqual(16);
      }
    }
  });

  it('the strata table is a TABLE_N x 1 float texture loaded texel by texel (exact values, no filtering)', () => {
    const u = createFogUniforms();
    const t = (u.depthTab as unknown as {value: THREE.DataTexture}).value;
    expect(t.isDataTexture).toBe(true);
    expect([t.image.width, t.image.height]).toEqual([REACTOR_AIR.TABLE_N, 1]);
    expect(t.type).toBe(THREE.FloatType);
    expect(t.format).toBe(THREE.RedFormat);
    expect(t.image.data).toBeInstanceOf(Float32Array);
    expect([t.minFilter, t.magFilter, t.generateMipmaps]).toEqual([THREE.NearestFilter, THREE.NearestFilter, false]);
    // WGSL: the march's only plain 2D float texture, read by exactly two textureLoad calls (never sampled / filtered)
    const w = compileQuad(createMarchMaterial(u, textures(true), {steps: 24, depth: true}), 'wgsl').fragment;
    const names = [...w.matchAll(/var (\w+) : texture_2d<f32>;/g)].map(m => m[1]);
    expect(names.length).toBe(1);
    expect(w.split(`textureLoad( ${names[0]},`).length - 1).toBe(2);
    expect(w).not.toMatch(new RegExp(`textureSample\\w*\\( ${names[0]},`));
    // GLSL: one more sampler2D than the base program and two more texelFetch calls (the scene depth is the other sampler2D)
    const g = (depth: boolean) => compileQuad(createMarchMaterial(createFogUniforms(), textures(true), {steps: 24, depth}), 'glsl').fragment;
    const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
    expect(count(g(true), /^uniform\s+(highp\s+)?sampler2D\s/gm)).toBe(count(g(false), /^uniform\s+(highp\s+)?sampler2D\s/gm) + 1);
    expect(count(g(true), /texelFetch\(/g)).toBe(count(g(false), /texelFetch\(/g) + 2);
  });
});

// ---------------------------------------------------------------------------------------------
// Visible from outside the volume (hazard <-> visual parity along view rays from the clean rim)

const reactor = (() => { let L: StationLayout | null = null; return () => (L ??= LEVELS.reactor.generate('main', {levelSeed: 9100})); })();
const office = (() => { let L: StationLayout | null = null; return () => (L ??= generateOfficeLevel({levelSeed: 12345, startWeapon: 'pistol'} as never)); })();
const atmo = () => new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
const sync = (a: VolumetricAtmosphere) => a.sync(new THREE.Scene(), new THREE.PerspectiveCamera(), 1);

/**
 * CPU mirror of the march's regional term concentration from exactly what the march reads: the gate / rect / range / outdoor uniforms and
 * the TABLE TEXTURE's texels. (The outdoor air above the roof line is drawn at its visual scale `vis`; every ray below stays below it.)
 */
function drawnC(a: VolumetricAtmosphere, x: number, y: number, z: number): number {
  const u = a.u, r = u.depthRect.value as THREE.Vector4, g = u.depthRange.value as THREE.Vector4, o = u.depthOut.value as THREE.Vector4;
  if (!(u.depthOn.value > 0.5) || x < r.x || x > r.z || z < r.y || z > r.w) return 0;
  const tab = a.depthTable, N = REACTOR_AIR.TABLE_N;
  const fu = Math.min(1, Math.max(0, (y - g.x) * g.z)) * (N - 1), fl = Math.min(Math.floor(fu), N - 2);
  const strata = y < g.y ? tab[fl] + (tab[fl + 1] - tab[fl]) * (fu - fl) : 0;
  const s = Math.min(1, Math.max(0, (y - o.x) / (o.y - o.x)));
  return strata + o.z * s * s * (3 - 2 * s) * o.w;
}

/**
 * The march (render/atmosphere.ts integrateMedium: the shader's jittered quadratic sampling at the HIGH step count, the FogExp2 term,
 * the reactor's march cap) along one view ray, the regional term only with its mean-1 noise at the mean: the gas's own glow (tint x
 * emission) and transmittance. `c` = what is integrated (drawn or hazard).
 */
function viewRay(a: VolumetricAtmosphere, eye: V3, dir: V3, sceneDist: number, c: (p: V3) => number) {
  const L = REACTOR_GAS_LOOK, ext = (p: V3) => c(p) * L.ext;
  const r = integrateMedium({
    origin: eye, dir, sceneDist, steps: ATMOSPHERE_QUALITY.high.steps, jitter: 0.5, maxDistance: Math.min(a.params.maxDistance, REACTOR_FOG.far),
    fogDensity: REACTOR_FOG.density, sigma: ext, radiance: () => [1, 1, 1], scatter: p => { const s = ext(p) * L.emission; return [L.tint[0] * s, L.tint[1] * s, L.tint[2] * s]; },
    extinction: ext,
  });
  return {glow: r.inscatter, trans: r.transmittance};
}

describe('the depth gas is visible from OUTSIDE it: view rays from the clean rim down into the pit (the Reactor, real layout)', () => {
  const setup = () => {
    const L = reactor(), info = L.reactor!;
    const st = emptyReactorState(info.generators.length, info.zones.length);
    const air = new ReactorAir(info, layoutRect(L), st);
    const a = atmo();
    a.setStation(L, null);
    a.setDepthGas(air.renderTable());
    sync(a);
    const b = info.pit.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    // an eye at the rim railing (standing on the gallery just outside the pit mouth, eye height 1.6 m)
    const eye: V3 = [b.x0 - 0.4, info.pit.rimY + 1.6, cz];
    return {L, info, st, air, a, b, cx, cz, eye};
  };
  /** Rays from the eye toward points on the core floor (pitch from steep to oblique) with their distance to the floor. */
  const rays = (s: ReturnType<typeof setup>) => {
    const out: {dir: V3; dist: number; tag: string}[] = [];
    const {b, info, eye} = s;
    for (const fx of [0.1, 0.3, 0.5, 0.8]) for (const fz of [0.3, 0.5, 0.7]) {
      const tx = b.x0 + (b.x1 - b.x0) * fx, tz = b.z0 + (b.z1 - b.z0) * fz, ty = info.pit.floorY;
      const d: V3 = [tx - eye[0], ty - eye[1], tz - eye[2]], len = Math.hypot(d[0], d[1], d[2]);
      out.push({dir: [d[0] / len, d[1] / len, d[2] / len], dist: len, tag: `floor ${fx},${fz} pitch ${(Math.asin(-d[1] / len) * 180 / Math.PI).toFixed(0)}°`});
    }
    return out;
  };

  it('the rim is clean (no exposure at the eye) yet every view ray into the pit glows green and is partly opaque — drawn == hazard', () => {
    const s = setup(), {a, air, eye} = s;
    expect(air.depthGasAt(eye[0], eye[1], eye[2])).toBe(0);
    expect(drawnC(a, eye[0], eye[1], eye[2])).toBe(0);
    for (const r of rays(s)) {
      const drawn = viewRay(a, eye, r.dir, r.dist, p => drawnC(a, p[0], p[1], p[2]));
      const hazard = viewRay(a, eye, r.dir, r.dist, p => air.depthGasAt(p[0], p[1], p[2]));
      log(`${r.tag}: dist ${r.dist.toFixed(1)} glow ${drawn.glow.map(v => v.toFixed(4))} lum ${luminance(drawn.glow).toFixed(4)} trans ${drawn.trans.toFixed(3)} hazard trans ${hazard.trans.toFixed(3)}`);
      // what is drawn along the ray IS the hazard along it (one table: the texture's texels are the exposure's floats)
      expect(drawn.trans, r.tag).toBeCloseTo(hazard.trans, 6);
      for (let k = 0; k < 3; k++) expect(drawn.glow[k], r.tag).toBeCloseTo(hazard.glow[k], 6);
      // ... and it reads: a clearly green glow, visibly thickening the view (not a faint tint; measured ~0.17 luminance, T ~0.04-0.12)
      expect(luminance(drawn.glow), r.tag).toBeGreaterThan(0.08);
      expect(greenness(drawn.glow), r.tag).toBeGreaterThan(1.6);
      expect(drawn.trans, r.tag).toBeLessThan(0.4);
    }
  });

  it('the march reaches the hazard: the straight-down view from the rim marches to the core floor (no distance cap before the lower tiers)', () => {
    const s = setup(), {a, info, eye} = s;
    const depth = eye[1] - info.pit.floorY;
    expect(Math.min(a.params.maxDistance, REACTOR_FOG.far)).toBeGreaterThan(depth);
    // and the high-quality sampling sees most of the hazard's optical depth (24 jittered quadratic steps vs a fine reference)
    const dir: V3 = [0.25, -1, 0], l = Math.hypot(...dir), d: V3 = [dir[0] / l, dir[1] / l, dir[2] / l], dist = depth / -d[1];
    let fine = 0;
    for (let t = 0; t < dist; t += 0.02) fine += s.air.depthGasAt(eye[0] + d[0] * t + 0.5, eye[1] + d[1] * t, eye[2] + d[2] * t) * REACTOR_GAS_LOOK.ext * 0.02;
    const marched = -Math.log(viewRay(a, [eye[0] + 0.5, eye[1], eye[2]], d, dist, p => drawnC(a, p[0], p[1], p[2])).trans);
    log(`straight-ish down: optical depth fine ${fine.toFixed(3)} marched ${marched.toFixed(3)}`);
    expect(marched / fine).toBeGreaterThan(0.7);
    expect(marched / fine).toBeLessThan(1.3);
  });

  it('horizontal views at the rim stay clean; clearing thins the drawn view exactly as the hazard drops', () => {
    const s = setup(), {a, air, eye, st, info} = s;
    for (const yaw of [0, 0.4, -0.4]) {
      const dir: V3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const v = viewRay(a, eye, dir, 40, p => drawnC(a, p[0], p[1], p[2]));
      expect(v.trans).toBe(1);
      expect(luminance(v.glow)).toBe(0);
    }
    const ray = rays(s)[5];
    const before = viewRay(a, eye, ray.dir, ray.dist, p => drawnC(a, p[0], p[1], p[2]));
    // the top zone's generator runs to completion: that zone's band of the view clears, the deeper strata stay
    const z0 = air.zones[0];
    st.generators[z0.gen] = {started: true, startedAt: 0};
    air.update(1e4);
    a.setDepthGas(air.renderTable());
    sync(a);
    const mid = viewRay(a, eye, ray.dir, ray.dist, p => drawnC(a, p[0], p[1], p[2]));
    const hz = viewRay(a, eye, ray.dir, ray.dist, p => air.depthGasAt(p[0], p[1], p[2]));
    expect(mid.trans).toBeCloseTo(hz.trans, 6);
    expect(mid.trans).toBeGreaterThan(before.trans);
    expect(luminance(mid.glow)).toBeGreaterThan(0.01); // the deeper zones still read
    // the pit clears (the restart win): the view down is clean (the outdoor air lies above the roof line, not on this ray)
    air.clearAll(1, 1e4);
    air.update(1e4 + 2);
    a.setDepthGas(air.renderTable());
    sync(a);
    const clear = viewRay(a, eye, ray.dir, ray.dist, p => drawnC(a, p[0], p[1], p[2]));
    expect(clear.trans).toBeGreaterThan(0.999);
    expect(Math.max(...a.depthTable)).toBe(0);
    void info;
  });
});

describe('a rejected fog program falls back deterministically', () => {
  /** A recording stand-in for WebGPURenderer with a WebGPU-like device (what runFog touches; no GPU). */
  const fakeRenderer = (events: string[], err: string | null) => {
    const r = {
      toneMapping: 0, toneMappingExposure: 1, outputColorSpace: '', autoClear: true,
      backend: {device: {pushErrorScope: () => { events.push('push'); }, popErrorScope: () => { events.push('pop'); return Promise.resolve(err ? {message: err} : null); }}},
      getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, getRenderObjectFunction: () => null, getPixelRatio: () => 1,
      getMRT: () => null, getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 1, getScissorTest: () => false,
      setRenderTarget() {}, setRenderObjectFunction() {}, setPixelRatio() {}, setMRT() {}, setClearColor() {}, setScissorTest() {},
      render: (o: {material: {name: string}}) => { events.push(`draw ${o.material.name}`); },
    };
    return r as unknown as Parameters<VolumetricAtmosphere['runFog']>[0];
  };
  it('the frame that (re)builds the march is inside the WebGPU error scope: a rejected pipeline layout flags the pass failed (direct path next frame)', async () => {
    const a = atmo();
    a.setStation({...generateStation(5), reactor: reactor().reactor} as StationLayout, null);
    const p = a as unknown as {marchRT: unknown; scenePass: unknown; errorChecks: number; history: unknown};
    p.marchRT = {textures: [new THREE.Texture(), new THREE.Texture()]};
    p.scenePass = {getTexture: () => new THREE.DepthTexture(8, 8)};
    p.history = null;
    p.errorChecks = 0; // the previous program's watch is over (as on any level change after the first frames)
    const events: string[] = [];
    a.runFog(fakeRenderer(events, 'The number of uniform buffers (13) in the Fragment stage exceeds the maximum per-stage limit (12).'));
    // the build frame: scope opened before the march draw, closed after it
    expect(events).toEqual(['push', 'draw volumetric-march', 'pop']);
    await Promise.resolve(); await Promise.resolve();
    expect(a.failed).toMatch(/rejected by WebGPU: The number of uniform buffers \(13\)/);
    expect(a.active).toBe(false); // -> VolumetricAtmosphere.render draws the station directly (with the in-engine gas fallback)
  });
});

describe('level change == boot: travelling into the Reactor keys the same term, gate and table as booting into it', () => {
  const state = (a: VolumetricAtmosphere) => {
    const d = a.depthDebug();
    return {compiled: d.compiled, on: d.on, range: d.range, rect: d.rect, table: Array.from(a.depthTable), out: (a.u.depthOut.value as THREE.Vector4).toArray(), depthOn: a.u.depthOn.value};
  };
  it('Subway -> Reactor, Office -> Reactor, Reactor -> Subway -> Reactor: identical to a boot; each table change marks the texture for upload', () => {
    const L = reactor(), info = L.reactor!;
    const air = () => new ReactorAir(info, layoutRect(L), emptyReactorState(info.generators.length, info.zones.length));
    // the game's order (game.ts buildSection): setStation, then the section hooks (world/reactor/generators.ts build -> setDepthGas)
    const enter = (a: VolumetricAtmosphere, layout: StationLayout, ra: ReactorAir | null) => {
      a.setStation(layout, null);
      if (ra) a.setDepthGas(ra.renderTable());
      sync(a);
    };
    const boot = atmo();
    enter(boot, L, air());
    const want = state(boot);
    expect(want).toMatchObject({compiled: true, on: true, depthOn: 1});
    expect(Math.max(...want.table)).toBeGreaterThan(0.5);
    for (const path of [[generateStation(20261101)], [office()], [L, generateStation(7)]] as StationLayout[][]) {
      const a = atmo();
      for (const prev of path) {
        // leaving the previous section first tears its runtime down (generators.ts clear -> setDepthGas(null) when it was the Reactor)
        enter(a, prev, prev === L ? air() : null);
        if (prev === L) a.setDepthGas(null);
      }
      const v0 = a.depthTableTex.version;
      enter(a, L, air());
      expect(state(a), path.map(p => p.name).join(' -> ')).toEqual(want);
      expect(a.depthTableTex.version).toBeGreaterThan(v0); // the new table is uploaded with the next frame
    }
  });
});
