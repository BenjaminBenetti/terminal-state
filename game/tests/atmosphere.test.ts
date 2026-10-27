// Iteration 06 (Lane F): volumetric atmosphere + chained shader hooks.
// - render/shaderHooks.ts chains onBeforeCompile hooks (keeps earlier direct hooks, extends cache keys);
// - the volumetric GLSL is self-contained, ASCII, balanced, int/float-clean and every uniform is wired;
// - three still exposes what the pass relies on (XR-flagged targets render like the canvas, spot shadow
//   depth textures with hardware compare, shadow.matrix convention);
// - CPU mirrors: phase normalisation, depth-limited march (nothing behind the surface contributes),
//   shadow-map occlusion of the beam (and no acne on grazing floors with the chosen bias), bilateral
//   upsample never paints far fog over a near silhouette, composite is exact where there is no fog;
// - lifecycle: quality/resize/new station/dispose without leaks, shader-error fallback, no lights added.
// FOG_PREVIEW=1 additionally CPU-renders flashlight on/off views into qa-artifacts/iter06-fog/.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {generateStation, type StationLayout} from '../src/gen/station';
import {CELL, SOLID, VOID} from '../src/gen/grid';
import type {Fixture} from '../src/world/builder';
import {MOOD, StationLighting, glowFog} from '../src/world/lights';
import {cellFloorFn} from '../src/world/lightField';
import {worldMapped} from '../src/world/materials';
import {addShaderHook, cloneWithShaderHooks, hasShaderHook, removeShaderHook, shaderHookKeys} from '../src/render/shaderHooks';
import {
  ATMOSPHERE, ATMOSPHERE_QUALITY, DENSITY_MAP_RANGE, acesForward, acesInverse, atmosphereFor, bilateralUpsample, buildDensityMap,
  buildNoiseVolume, compositePixel, densityAt, distanceAttenuation, fixtureRadiance, flashlightRadiance, integrateInscatter, marchSamples,
  marchSize, phase, sampleDensityMap, shadowBiasFor, srgbDecode, srgbEncode, SHADOW_NEAR, SHADOW_NORMAL_BIAS, viewZFromDepth,
  type SpotInput, type V3,
} from '../src/render/atmosphere';
import {VolumetricAtmosphere, configureFlashlightShadow, fogOverrideFromUrl, markShadows} from '../src/render/volumetric';
import {VF_COMPOSITE, VF_MARCH, VF_MARK, VF_TEMPORAL, VF_VERTEX} from '../src/render/volumetricShaders';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(GAME, '..');
const T3 = (p: string) => fs.readFileSync(path.join(REPO, 'node_modules/three/src', p), 'utf8');
const shaderOf = (sh: string) => ({uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: sh} as unknown as THREE.WebGLProgramParametersWithUniforms);
const fixturesOf = (l: StationLayout): Fixture[] => l.lights.map((x, i) => ({x: x.x, y: x.y, z: x.z, broken: x.broken, flicker: x.flicker, warm: x.warm, dying: x.dying, power: x.power, area: x.area, phase: i * 1.7, level: x.broken ? 0 : 1}));
const stations = new Map<number, StationLayout>();
const station = (seed: number) => { let s = stations.get(seed); if (!s) stations.set(seed, (s = generateStation(seed))); return s; };

// ---------------------------------------------------------------------------------------------
describe('shader hook chaining (render/shaderHooks.ts)', () => {
  it('keeps an earlier direct hook, runs hooks in order and extends the cache key', () => {
    const m = new THREE.MeshStandardMaterial();
    m.onBeforeCompile = sh => { sh.fragmentShader += '\n//direct'; };
    m.customProgramCacheKey = () => 'world-mapped-v1';
    addShaderHook(m, 'wounds', sh => { sh.fragmentShader += '\n//wounds'; });
    addShaderHook(m, 'chips', sh => { sh.fragmentShader += '\n//chips'; });
    const sh = shaderOf('void main(){}');
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    expect(sh.fragmentShader.endsWith('//direct\n//wounds\n//chips')).toBe(true);
    expect(m.customProgramCacheKey()).toBe('world-mapped-v1|hooks:wounds,chips');
    expect(shaderHookKeys(m)).toEqual(['wounds', 'chips']);
    // Same key again replaces in place (no double patching).
    addShaderHook(m, 'wounds', s => { s.fragmentShader += '\n//wounds2'; });
    const sh2 = shaderOf('');
    m.onBeforeCompile(sh2, {} as THREE.WebGLRenderer);
    expect(sh2.fragmentShader).toBe('\n//direct\n//wounds2\n//chips');
    expect(removeShaderHook(m, 'chips')).toBe(true);
    expect(hasShaderHook(m, 'chips')).toBe(false);
    expect(m.customProgramCacheKey()).toBe('world-mapped-v1|hooks:wounds');
    expect(() => addShaderHook(m, 'a|b', () => {})).toThrow();
  });

  it('distinguishes materials whose direct hooks only differ in source (three default cache key)', () => {
    const a = new THREE.MeshLambertMaterial(), b = new THREE.MeshLambertMaterial(), c = new THREE.MeshLambertMaterial();
    a.onBeforeCompile = sh => { sh.fragmentShader += 'A'; };
    b.onBeforeCompile = sh => { sh.fragmentShader += 'B'; };
    const before = [a.customProgramCacheKey(), b.customProgramCacheKey()];
    expect(before[0]).not.toBe(before[1]);
    for (const m of [a, b, c]) addShaderHook(m, 'x', () => {});
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).toBe(`${before[0]}|hooks:x`);
    expect(c.customProgramCacheKey()).toBe('|hooks:x'); // no prior hook: key = hook set only
  });

  it('adopts a later direct overwrite as the new base without losing registered hooks', () => {
    const m = new THREE.MeshStandardMaterial();
    addShaderHook(m, 'one', sh => { sh.fragmentShader += '1'; });
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); sh.fragmentShader += 'D'; }; // a well-behaved manual chain
    addShaderHook(m, 'two', sh => { sh.fragmentShader += '2'; });
    const sh = shaderOf('');
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    // the manual chain (which already calls the old wrapper -> '1') runs first, then the registered hooks
    expect(sh.fragmentShader.startsWith('1D')).toBe(true);
    expect(sh.fragmentShader.endsWith('2')).toBe(true);
    expect(shaderHookKeys(m)).toEqual(['one', 'two']);
  });

  it('clones keep hooks (three copy() drops callbacks) and compose with world mapping + glow fog', () => {
    const m = worldMapped(new THREE.MeshStandardMaterial(), {span: [2, 3], grime: [0.3, 0.6], macro: 0.1});
    addShaderHook(m, 'chips', sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n// chips'); });
    const c = cloneWithShaderHooks(m);
    expect(c).not.toBe(m);
    expect(c.customProgramCacheKey()).toBe(m.customProgramCacheKey());
    expect(c.customProgramCacheKey()).toBe('world-mapped-v1|hooks:chips');
    for (const mat of [m, c]) {
      const sh = {uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader} as unknown as THREE.WebGLProgramParametersWithUniforms;
      mat.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
      expect(sh.fragmentShader).toContain('wmNoise'); // iteration-04 world mapping still applied
      expect(sh.fragmentShader).toContain('// chips');
      expect(sh.uniforms.uWmMap).toBeTruthy();
    }
    // Iteration-05 glow fog now goes through the helper too (idempotent per factor, key in the cache key).
    const tm = new THREE.MeshBasicMaterial();
    addShaderHook(tm, 'damage', () => {});
    glowFog(tm, MOOD.glowFog);
    glowFog(tm, MOOD.glowFog);
    expect(shaderHookKeys(tm)).toEqual(['damage', `glow-fog-${MOOD.glowFog}`]);
    const sh = shaderOf(THREE.ShaderLib.basic.fragmentShader);
    tm.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    expect(sh.fragmentShader).toContain(`vFogDepth * vFogDepth * ${(MOOD.glowFog ** 2).toFixed(4)}`);
  });
});

// ---------------------------------------------------------------------------------------------
describe('volumetric GLSL (static checks; no GL in node)', () => {
  const programs = () => {
    const a = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()});
    return [{name: 'march', mat: a.march, src: VF_MARCH}, {name: 'temporal', mat: a.temporal, src: VF_TEMPORAL}, {name: 'composite', mat: a.composite, src: VF_COMPOSITE}];
  };
  const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '');

  it('is self-contained, ASCII, balanced and marked', () => {
    for (const {name, src} of [...programs(), {name: 'vertex', src: VF_VERTEX}]) {
      expect(/[^\x00-\x7F]/.test(src), `${name}: ASCII-only GLSL`).toBe(false);
      expect(src, name).toContain(VF_MARK);
      expect(src, name).not.toContain('#include');
      const s = strip(src);
      const count = (re: RegExp) => (s.match(re) ?? []).length;
      expect(count(/\{/g), `${name} braces`).toBe(count(/\}/g));
      expect(count(/\(/g), `${name} parens`).toBe(count(/\)/g));
      // never redeclare names three's ShaderMaterial prefix already provides
      for (const taken of ['cameraPosition', 'viewMatrix', 'sRGBTransferOETF', 'sRGBTransferEOTF', 'LinearTransferOETF', 'saturate(', 'toneMappingExposure', 'linearToOutputTexel']) {
        expect(new RegExp(`\\b(uniform|vec[234]|float|mat[34])\\s+${taken.replace('(', '\\(')}`).test(s), `${name} redeclares ${taken}`).toBe(false);
      }
    }
  });

  it('every declared uniform is supplied by its material and vice versa', () => {
    for (const {name, mat, src} of programs()) {
      const declared = [...strip(src).matchAll(/^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)\s*;/gm)].map(m => m[1]).sort();
      expect(declared, name).toEqual(Object.keys(mat.uniforms).sort());
      expect(mat.vertexShader).toBe(VF_VERTEX);
      expect(mat.depthTest && mat.depthWrite, name).toBe(false);
      expect(mat.toneMapped, name).toBe(false);
    }
  });

  it('has no implicit int -> float mixing (GLSL ES 3.00 has no implicit conversions)', () => {
    // Heuristic lint: integer literals may only appear in int contexts (loops, ivec, texelFetch,
    // textureSize, bit ops, defines) - every float literal is written with a decimal point.
    const intContext = /\b(int|ivec[234]|texelFetch|textureSize)\b|^\s*#(define|ifndef|endif|if)\b|&\s*1|\b[ij]\s*(<=?|\+\+|=)|lo\.[xy]|uFullSize \) - 1|uLowSize \) - 1|\) - 1,/;
    for (const {name, src} of [...programs(), {name: 'vertex', src: VF_VERTEX}]) {
      const lines = strip(src).split('\n');
      lines.forEach((line, i) => {
        const ints = [...line.matchAll(/(?<![\w.])(?<!e[-+])\d+(?![\w.])/g)];
        if (!ints.length) return;
        expect(intContext.test(line), `${name}:${i + 1} integer literal outside an int context: ${line.trim()}`).toBe(true);
      });
    }
  });

  it('marches only in front of the surface and composites before the overlay (pass structure)', () => {
    expect(VF_MARCH).toContain('float dist = min( sceneDist, uMaxDist );');
    expect(VF_MARCH).toContain('float t = dist * u * u;');
    expect(VF_MARCH).toContain('vfShadow( p )');
    expect(VF_MARCH).toContain('textureLod( tShadow, vec3( c.xy, c.z + uShadowBias ), 0.0 )');
    // No implicit-derivative lookups in loops/branches (HLSL via ANGLE rejects or force-unrolls them).
    for (const src of [VF_MARCH, VF_TEMPORAL, VF_COMPOSITE]) expect(src).not.toMatch(/\btexture\s*\(/);
    expect(VF_MARCH).toContain('#define VF_STEPS 24');
    expect(VF_MARCH).toMatch(/for \( int i = 0; i < VF_STEPS; i \+\+ \)/);
    expect(VF_COMPOSITE).toContain('gl_FragColor = vec4( sc.rgb, 1.0 );'); // exact passthrough where no fog
    const game = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    const render = game.slice(game.indexOf('  render(): void {'), game.indexOf('  render(): void {') + 700);
    const iA = render.indexOf('this.atmosphere.render('), iD = render.indexOf('this.renderer.clearDepth()'), iV = render.indexOf('this.renderer.render(this.viewmodel.scene');
    expect(iA).toBeGreaterThan(0);
    expect(iA).toBeLessThan(iD);
    expect(iD).toBeLessThan(iV);
  });
});

// ---------------------------------------------------------------------------------------------
describe('three r186 protocol the pass relies on', () => {
  it('XR-flagged render targets tone-map and encode like the canvas; internalFormat is honoured', () => {
    const progs = T3('renderers/webgl/WebGLPrograms.js');
    expect(progs).toContain('if ( currentRenderTarget === null || currentRenderTarget.isXRRenderTarget === true )');
    expect(progs).toContain('outputColorSpace: ( currentRenderTarget === null ) ? renderer.outputColorSpace : ( currentRenderTarget.isXRRenderTarget === true ? currentRenderTarget.texture.colorSpace : ColorManagement.workingColorSpace )');
    const r = T3('renderers/WebGLRenderer.js');
    expect(r).toContain('if ( _currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true )');
    expect(T3('renderers/webxr/WebXRManager.js')).toContain('newRenderTarget.isXRRenderTarget = true;');
    expect(T3('renderers/shaders/UniformsUtils.js')).toContain('if ( currentRenderTarget.isXRRenderTarget === true )');
    const tex = T3('renderers/webgl/WebGLTextures.js');
    expect(tex).toContain("if ( _gl[ internalFormatName ] !== undefined ) return _gl[ internalFormatName ];");
    expect(tex).toContain('if ( renderTarget.resolveDepthBuffer )'); // MSAA depth resolved into the depth texture
  });

  it('spot shadows: depth texture with hardware compare, [0,1] shadow matrix, light hash recompiles', () => {
    const sm = T3('renderers/webgl/WebGLShadowMap.js');
    expect(sm).toContain('shadow.map.depthTexture.compareFunction = reversedDepthBuffer ? GreaterEqualCompare : LessEqualCompare;');
    expect(sm).toContain('if ( shadow.autoUpdate === false && shadow.needsUpdate === false ) continue;');
    expect(T3('lights/LightShadow.js')).toMatch(/0\.0, 0\.0, 0\.5, 0\.5,/); // xy -> [0,1] uv, z -> [0,1] window depth
    expect(T3('renderers/webgl/WebGLUniforms.js')).toContain('emptyShadowTexture');
    expect(T3('renderers/webgl/WebGLProgram.js')).toContain('renderer.debug.onShaderError( gl, program, glVertexShader, glFragmentShader );');
  });
});

// ---------------------------------------------------------------------------------------------
describe('in-scattering math (CPU mirror of the march)', () => {
  const P = ATMOSPHERE;
  it('phase functions are normalised; forward lobe dominates, backward lobe keeps the beam visible from the lamp', () => {
    const integ = (f: (c: number) => number) => { let s = 0; const n = 20000; for (let i = 0; i < n; i++) { const c = -1 + (i + 0.5) / n * 2; s += f(c); } return s * 2 / n * 2 * Math.PI; };
    expect(integ(c => phase(c, P))).toBeCloseTo(1, 3);
    expect(integ(c => phase(c, {anisotropy: 0, backAnisotropy: 0, backScatter: 0}))).toBeCloseTo(1, 3);
    expect(phase(1, P)).toBeGreaterThan(phase(-1, P) * 3);
    // From behind the flashlight we look at backscatter (cos = -1): not crushed below ~half isotropic.
    expect(phase(-1, P)).toBeGreaterThan(0.5 / (4 * Math.PI));
  });

  it('matches three distance attenuation and samples the whole segment in front of the surface', () => {
    expect(distanceAttenuation(2, 30, 1.2)).toBeCloseTo(1 / Math.pow(2, 1.2) * (1 - (2 / 30) ** 4) ** 2, 9);
    expect(distanceAttenuation(30, 30, 1.2)).toBe(0);
    expect(distanceAttenuation(0, 0, 2)).toBe(100);
    for (const steps of [14, 24]) {
      let sum = 0;
      for (let j = 0; j < 64; j++) {
        const s = marchSamples(10, steps, (j + 0.5) / 64);
        expect(Math.max(...s.t)).toBeLessThan(10);
        sum += s.w.reduce((a, b) => a + b, 0);
      }
      expect(sum / 64).toBeCloseTo(10, 6); // unbiased: weights integrate the full [0, dist]
    }
    expect(viewZFromDepth(0, 0.05, 70)).toBeCloseTo(0.05, 9);
    expect(viewZFromDepth(1, 0.05, 70)).toBeCloseTo(70, 6);
  });

  it('a light or medium behind the visible surface contributes nothing', () => {
    const seen: number[] = [];
    const behind = integrateInscatter({
      origin: [0, 1.6, 0], dir: [0, 0, -1], sceneDist: 5, steps: 24, jitter: 0.73, maxDistance: 36, fogDensity: 0.043,
      sigma: p => { seen.push(-p[2]); return 0.02; },
      radiance: (_p, t) => (t > 5 ? [50, 50, 50] : [0, 0, 0]), // a lamp on the far side of the wall
    });
    expect(behind).toEqual([0, 0, 0]);
    expect(Math.max(...seen)).toBeLessThan(5);
    // Same lamp in front of the wall is seen.
    const front = integrateInscatter({
      origin: [0, 1.6, 0], dir: [0, 0, -1], sceneDist: 5, steps: 24, jitter: 0.73, maxDistance: 36, fogDensity: 0.043,
      sigma: () => 0.02, radiance: (_p, t) => (t > 2 && t < 4 ? [50, 50, 50] : [0, 0, 0]),
    });
    expect(front[0]).toBeGreaterThan(0.5);
  });

  it('fixture halos: forward scattering toward the lamp, isotropic share elsewhere', () => {
    const toward = fixtureRadiance([0.2, 0.2, 0.2], [1, 1, 1], [0, 0, -1], [0, 0, -1], P);
    const away = fixtureRadiance([0.2, 0.2, 0.2], [1, 1, 1], [0, 0, -1], [0, 0, 1], P);
    expect(toward[0]).toBeGreaterThan(away[0] * 2);
    expect(fixtureRadiance([0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, -1], P)).toEqual([0, 0, 0]);
  });

  it('composite: exact where there is no fog, adds light monotonically, ACES inverse round-trips', () => {
    for (const v of [0, 0.02, 0.1, 0.4, 0.8, 1]) expect(compositePixel([v, v * 0.9, v * 0.8], [0, 0, 0], MOOD.exposure)).toEqual([v, v * 0.9, v * 0.8]);
    for (const x of [0.01, 0.05, 0.2, 0.7, 1.5, 3]) {
      const d = acesForward([x, x * 0.8, x * 0.6], MOOD.exposure);
      const back = acesInverse(d, MOOD.exposure);
      expect(back[0]).toBeCloseTo(x, 3);
      expect(back[2]).toBeCloseTo(x * 0.6, 3);
    }
    for (let i = 0; i <= 20; i++) {
      const v = i / 20;
      const a = compositePixel([v, v, v], [0.01, 0.01, 0.01], MOOD.exposure), b = compositePixel([v, v, v], [0.05, 0.05, 0.05], MOOD.exposure);
      expect(a[1]).toBeGreaterThanOrEqual(v - 1e-6);
      expect(b[1]).toBeGreaterThanOrEqual(a[1] - 1e-6);
    }
    // Haze reads on black, barely changes a bright wall (no global wash-out).
    const dark = compositePixel([0.02, 0.02, 0.02], [0.03, 0.03, 0.03], MOOD.exposure)[1] - 0.02;
    const bright = compositePixel([0.85, 0.85, 0.85], [0.03, 0.03, 0.03], MOOD.exposure)[1] - 0.85;
    expect(dark).toBeGreaterThan(bright * 2);
    expect(srgbEncode(srgbDecode(0.5))).toBeCloseTo(0.5, 4);
  });

  it('depth-aware upsample never paints far beam haze over a near silhouette', () => {
    const near = {fog: [0.001, 0.001, 0.001] as V3, z: 1.2}, far = {fog: [0.3, 0.3, 0.3] as V3, z: 18};
    // near pixel (zombie edge) with 3 of 4 low-res neighbours on the far wall, bilinear weight mostly far
    const atNear = bilateralUpsample([{...far, wb: 0.4}, {...far, wb: 0.3}, {...far, wb: 0.2}, {...near, wb: 0.1}], 1.2);
    expect(atNear[0]).toBeLessThan(0.0011);
    const atFar = bilateralUpsample([{...far, wb: 0.1}, {...near, wb: 0.4}, {...near, wb: 0.3}, {...near, wb: 0.2}], 18);
    expect(atFar[0]).toBeGreaterThan(0.29);
    // smooth interior: plain bilinear
    const flat = bilateralUpsample([{fog: [1, 1, 1], z: 10, wb: 0.25}, {fog: [3, 3, 3], z: 10, wb: 0.75}], 10);
    expect(flat[0]).toBeCloseTo(2.5, 6);
  });
});

// ---------------------------------------------------------------------------------------------
describe('flashlight shadow map: occluded beam, bias without acne', () => {
  /** Spot like game.ts's flashlight, at `pos`, aimed at `target`, with the pass's shadow config. */
  function spot(pos: V3, target: V3, mapSize: number) {
    const l = new THREE.SpotLight(0xfff4e2, 34, 30, 0.58, 0.7, 1.2);
    l.position.set(...pos);
    l.target.position.set(...target);
    l.updateMatrixWorld(); l.target.updateMatrixWorld();
    l.shadow.mapSize.set(mapSize, mapSize);
    l.shadow.camera.near = SHADOW_NEAR;
    l.shadow.bias = shadowBiasFor(mapSize, l.angle);
    l.shadow.updateMatrices(l);
    l.shadow.camera.updateMatrixWorld();
    return l;
  }
  type Hitter = (o: THREE.Vector3, d: THREE.Vector3) => number; // ray distance or Infinity
  /** CPU depth map like three's shadow pass: window depth [0,1] of the first hit per texel centre. */
  function shadowMap(l: THREE.SpotLight, hit: Hitter): Float32Array {
    const S = l.shadow.mapSize.x, cam = l.shadow.camera, map = new Float32Array(S * S).fill(1);
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const o = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const p = new THREE.Vector3((i + 0.5) / S * 2 - 1, (j + 0.5) / S * 2 - 1, 0.5).unproject(cam);
      const d = p.sub(o).normalize();
      const t = hit(o, d);
      if (!Number.isFinite(t)) continue;
      const q = o.clone().addScaledVector(d, t).applyMatrix4(vp);
      map[j * S + i] = Math.min(1, q.z * 0.5 + 0.5);
    }
    return map;
  }
  /** Mirror of vfShadow / three's hardware PCF tap: bilinear blend of 4 depth compares. */
  function lookup(l: THREE.SpotLight, map: Float32Array, p: THREE.Vector3, bias = l.shadow.bias): number {
    const S = l.shadow.mapSize.x;
    const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(l.shadow.matrix);
    if (v.w <= 1e-5) return 1;
    const c = [v.x / v.w, v.y / v.w, v.z / v.w];
    if (c[0] < 0 || c[0] > 1 || c[1] < 0 || c[1] > 1 || c[2] < 0 || c[2] > 1) return 1;
    const u = c[0] * S - 0.5, w = c[1] * S - 0.5, i0 = Math.floor(u), j0 = Math.floor(w), fu = u - i0, fw = w - j0;
    let r = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const ii = Math.min(S - 1, Math.max(0, i0 + a)), jj = Math.min(S - 1, Math.max(0, j0 + b));
      r += (a ? fu : 1 - fu) * (b ? fw : 1 - fw) * (c[2] + bias <= map[jj * S + ii] ? 1 : 0);
    }
    return r;
  }
  const plane = (y: number): Hitter => (o, d) => (d.y < -1e-6 ? (y - o.y) / d.y : Infinity);
  const box = (min: V3, max: V3): Hitter => (o, d) => {
    let t0 = 0, t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      const oo = o.getComponent(k), dd = d.getComponent(k);
      if (Math.abs(dd) < 1e-9) { if (oo < min[k] || oo > max[k]) return Infinity; continue; }
      let a = (min[k] - oo) / dd, b = (max[k] - oo) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return Infinity;
    }
    return t0;
  };
  const both = (...hs: Hitter[]): Hitter => (o, d) => Math.min(...hs.map(h => h(o, d)));

  it('the beam stops behind a wall/zombie-sized occluder (volume samples shadowed, in front lit)', () => {
    const l = spot([0, 1.45, 0], [0, 1.45, -6], 256);
    const occ = box([-0.3, 0, -3.25], [0.3, 1.8, -2.95]); // zombie-sized box 3 m ahead
    const map = shadowMap(l, both(occ, plane(0)));
    expect(lookup(l, map, new THREE.Vector3(0, 1.45, -6))).toBe(0);     // behind it
    expect(lookup(l, map, new THREE.Vector3(0, 1.45, -2.5))).toBe(1);   // in front of it
    expect(lookup(l, map, new THREE.Vector3(2, 1.45, -6))).toBe(1);     // beside its shadow, inside the cone
    expect(lookup(l, map, new THREE.Vector3(0, 1.45, 3))).toBe(1);      // behind the lamp: outside the map
    // Integrated along a camera ray that passes through the shadow volume: less in-scatter.
    const s: SpotInput = {pos: [0, 1.45, 0], dir: [0, 0, -1], coneCos: Math.cos(0.58), penumbraCos: Math.cos(0.58 * 0.3), color: [34, 34, 34], distance: 30, decay: 1.2};
    const ray = {origin: [0.25, 1.6, 0] as V3, dir: [0, 0, -1] as V3};
    const run = (shadow: (p: V3) => number) => integrateInscatter({
      ...ray, sceneDist: 12, steps: 64, jitter: 0.5, maxDistance: 36, fogDensity: MOOD.fogDensity, sigma: () => 0.02,
      radiance: (p, t) => flashlightRadiance(p, t, ray.dir, s, ATMOSPHERE, shadow),
    })[0];
    const open = run(() => 1);
    const shadowed = run(p => lookup(l, map, new THREE.Vector3(...p)));
    console.log(`beam in-scatter along a ray past a zombie-sized occluder: ${shadowed.toFixed(4)} shadow-mapped vs ${open.toFixed(4)} unoccluded`);
    expect(shadowed).toBeLessThan(open * 0.75);
    expect(shadowed).toBeGreaterThan(0); // the lit stretch in front of the occluder still glows
  });

  it('no shadow acne on grazing floors at the pass bias; bias 0 would be covered in it', () => {
    for (const [size, eye] of [[1024, 1.45], [512, 1.45], [1024, 0.85], [512, 0.85]] as const) {
      const l = spot([0, eye, 0], [0.03, eye + 0.03, -6], size);
      const map = shadowMap(l, plane(0));
      let n = 0, acne = 0, acne0 = 0;
      for (let d = 1.5; d <= 25; d += 0.37) for (let x = -0.6 * d; x <= 0.6 * d; x += 0.23 * d) {
        const p = new THREE.Vector3(x, SHADOW_NORMAL_BIAS, -d); // three offsets the receiver along its normal
        const lv = p.clone().sub(l.position).normalize();
        if (lv.dot(new THREE.Vector3(0.03, 0.03, -6).normalize()) < Math.cos(0.58)) continue; // inside the cone only
        n++;
        if (lookup(l, map, p) < 0.999) acne++;
        if (lookup(l, map, new THREE.Vector3(x, 0, -d), 0) < 0.999) acne0++;
      }
      console.log(`shadow map ${size}, lamp ${eye} m above the floor: ${n} floor points in the cone, acne ${(acne / n * 100).toFixed(2)}% at bias ${l.shadow.bias.toExponential(2)} (${(acne0 / n * 100).toFixed(1)}% without bias)`);
      expect(n, `${size}/${eye}`).toBeGreaterThan(100);
      expect(acne / n, `map ${size}, eye ${eye}: acne at the pass bias`).toBeLessThan(0.005);
      expect(acne0 / n, `map ${size}, eye ${eye}: acne without bias`).toBeGreaterThan(0.2);
    }
  });

  it('bias does not detach contact shadows visibly (zombie on the floor still shadows the floor behind it)', () => {
    const l = spot([0, 1.45, 0], [0, 1.2, -6], 1024);
    const map = shadowMap(l, both(box([-0.3, 0, -6.3], [0.3, 1.8, -5.7]), plane(0)));
    expect(lookup(l, map, new THREE.Vector3(0, SHADOW_NORMAL_BIAS, -6.6))).toBeLessThan(0.5); // just behind the feet
    expect(lookup(l, map, new THREE.Vector3(0, SHADOW_NORMAL_BIAS, -5))).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('station medium (density map, height, noise)', () => {
  it('per-area density, local floors (track bed / underpass), no dips at walls; deterministic', () => {
    const l = station(2), g = l.grid;
    const m = buildDensityMap(l, ATMOSPHERE);
    expect(m.w).toBe(g.w);
    expect(m.data.length).toBe(g.w * g.h * 2);
    expect(Buffer.from(buildDensityMap(l, ATMOSPHERE).data).equals(Buffer.from(m.data))).toBe(true);
    const fl = cellFloorFn(g, l.trench.floorY);
    let bed = 0, bedN = 0, plat = 0, platN = 0, floorErr = 0, wallMin = Infinity;
    const P = l.areas[l.platform];
    for (let cy = 0; cy < g.h; cy++) for (let cx = 0; cx < g.w; cx++) {
      const i = cy * g.w + cx;
      const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      const [mult, floorY] = sampleDensityMap(m, x, z);
      if (g.cells[i] === SOLID) {
        // solid cells next to open ones carry the neighbour's value (filtering near walls stays smooth)
        if ([i - 1, i + 1, i - g.w, i + g.w].some(j => j >= 0 && j < g.cells.length && g.cells[j] !== SOLID)) wallMin = Math.min(wallMin, m.data[i * 2] / 255 * DENSITY_MAP_RANGE);
        continue;
      }
      floorErr = Math.max(floorErr, Math.abs(floorY - fl(cx, cy)) > 0.6 ? 0 : Math.abs(floorY - fl(cx, cy)));
      if (g.cells[i] === VOID) { bed += mult; bedN++; }
      else if (g.area[i] === P.id && cx > P.x + 2 && cx < P.x + P.w - 3 && cy > P.y + 2 && cy < P.y + P.h - 3) { plat += mult; platN++; }
    }
    expect(bedN).toBeGreaterThan(100);
    expect(bed / bedN).toBeGreaterThan(plat / platN * 1.2);
    expect(wallMin).toBeGreaterThan(0.5);
    expect(floorErr).toBeLessThan(0.12);
    // Track bed floor decodes near the trench floor.
    const vi = g.cells.findIndex((c, i) => c === VOID && g.cells[i - 1] === VOID && g.cells[i + 1] === VOID && g.cells[i - g.w] === VOID && g.cells[i + g.w] === VOID);
    const vx = vi % g.w, vy = (vi - vx) / g.w;
    expect(sampleDensityMap(m, (vx + 0.5) * CELL, (vy + 0.5) * CELL)[1]).toBeCloseTo(fl(vx, vy), 1);
  });

  it('denser near the floor, thinner under the ceiling; noise drifts but keeps the mean', () => {
    const l = station(2), m = buildDensityMap(l, ATMOSPHERE), noise = buildNoiseVolume();
    const sp = l.playerSpawn;
    const low = densityAt([sp.x, 0.2, sp.z], m, null, ATMOSPHERE, 0), mid = densityAt([sp.x, 1.6, sp.z], m, null, ATMOSPHERE, 0), high = densityAt([sp.x, 3.6, sp.z], m, null, ATMOSPHERE, 0);
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
    let s = 0, n = 0, changed = 0;
    for (let i = 0; i < 400; i++) {
      const p: V3 = [sp.x + (i % 20) * 0.7, 1.6, sp.z + Math.floor(i / 20) * 0.7];
      const a = densityAt(p, m, noise, ATMOSPHERE, 0), b = densityAt(p, m, noise, ATMOSPHERE, 20);
      s += a / densityAt(p, m, null, ATMOSPHERE, 0); n++;
      if (Math.abs(a - b) > 1e-4) changed++;
    }
    expect(s / n).toBeGreaterThan(0.8);
    expect(s / n).toBeLessThan(1.2);
    expect(changed).toBeGreaterThan(300);
    expect(atmosphereFor({archetype: 'deep'}).density).toBeGreaterThan(ATMOSPHERE.density);
    expect(atmosphereFor({archetype: 'deep'}).areaDensity.trackBed).toBe(ATMOSPHERE.areaDensity.trackBed);
  });
});

// ---------------------------------------------------------------------------------------------
describe('VolumetricAtmosphere lifecycle (no GL: fake renderer)', () => {
  interface Call { op: string; target?: string; what?: string }
  function fakeRenderer(opts: {floatRT?: boolean; failOn?: string} = {}) {
    const calls: Call[] = [];
    let target: THREE.WebGLRenderTarget | null = null;
    const gl = {getExtension: () => null, getShaderSource: () => `${VF_MARK}`, getProgramInfoLog: () => '', getShaderInfoLog: () => ''} as unknown as WebGL2RenderingContext;
    const r = {
      calls, toneMappingExposure: MOOD.exposure,
      extensions: {has: (n: string) => opts.floatRT !== false && n === 'EXT_color_buffer_float'},
      getContext: () => gl,
      debug: {checkShaderErrors: true, onShaderError: null as null | ((...a: unknown[]) => void)},
      shadowMap: {enabled: false, type: THREE.PCFShadowMap},
      setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t; calls.push({op: 'target', target: t?.texture.name ?? 'canvas'}); },
      clear: () => calls.push({op: 'clear', target: target?.texture.name ?? 'canvas'}),
      render: (scene: THREE.Scene) => {
        const what = scene.name || (scene.children[0] as THREE.Mesh | undefined)?.material && ((scene.children[0] as THREE.Mesh).material as THREE.Material).name || 'scene';
        calls.push({op: 'render', target: target?.texture.name ?? 'canvas', what});
        if (opts.failOn && what === opts.failOn) r.debug.onShaderError?.(gl, {}, {}, {});
      },
    };
    return r;
  }
  function rig() {
    const scene = new THREE.Scene();
    scene.name = 'station';
    scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
    const flashlight = new THREE.SpotLight(0xfff4e2, MOOD.flashlight, 30, 0.58, 0.7, 1.2);
    flashlight.position.set(0.2, -0.15, 0.1);
    flashlight.target.position.set(0.04, -0.12, -6);
    camera.add(flashlight, flashlight.target);
    const muzzle = new THREE.PointLight(0xffb468, 0, 8, 2);
    scene.add(camera, muzzle, new THREE.HemisphereLight());
    return {scene, camera, flashlight, muzzle};
  }
  const lightsIn = (o: THREE.Object3D) => { let n = 0; o.traverse(x => { if ((x as THREE.Light).isLight) n++; }); return n; };
  const disposed = (o: {addEventListener: (t: 'dispose', f: () => void) => void}) => { const s = {n: 0}; o.addEventListener('dispose', () => s.n++); return s; };

  it('quality presets drive march size, steps, MSAA and the flashlight shadow map; ?fog= overrides', () => {
    const {flashlight} = rig();
    const r = fakeRenderer();
    const a = new VolumetricAtmosphere(r as unknown as THREE.WebGLRenderer, {flashlight}, 'high');
    a.setSize(1920, 1080);
    let d = a.debug();
    expect(d.quality).toBe('high');
    expect(d.resolution.march).toEqual([960, 540]);
    expect(d.steps).toBe(24);
    expect(d.shadow).toMatchObject({enabled: true, mapSize: 1024, near: SHADOW_NEAR, normalBias: SHADOW_NORMAL_BIAS});
    expect(r.shadowMap.enabled).toBe(true);
    a.setSize(2880, 1620); // DPR 1.5 at 1080p: capped pixel budget
    expect(a.debug().resolution.march[0] * a.debug().resolution.march[1]).toBeLessThanOrEqual(ATMOSPHERE_QUALITY.high.maxPixels);
    a.setQuality('low');
    d = a.debug();
    expect(d).toMatchObject({quality: 'low', steps: 14, msaa: 0});
    expect(flashlight.shadow.mapSize.x).toBe(512);
    expect(a.march.defines.VF_STEPS).toBe(14);
    expect(flashlight.shadow.bias).toBeCloseTo(shadowBiasFor(512, 0.58), 9);
    a.setQuality('off');
    expect(a.debug()).toMatchObject({quality: 'off', active: false, steps: 0});
    expect(flashlight.castShadow).toBe(false);
    expect(r.shadowMap.enabled).toBe(false);
    a.override = 'high';
    a.setQuality('low');
    expect(a.quality).toBe('high');
    expect(fogOverrideFromUrl('?qa=1&fog=off')).toBe('off');
    expect(fogOverrideFromUrl('?fog=ultra')).toBe(null);
    expect(marchSize(1280, 720, ATMOSPHERE_QUALITY.low)).toEqual([320, 180]);
    // Unsupported float targets: stays on the r5 path (no shadow map either).
    const u = new VolumetricAtmosphere(fakeRenderer({floatRT: false}) as unknown as THREE.WebGLRenderer, {flashlight: new THREE.SpotLight()}, 'high');
    expect(u.debug()).toMatchObject({supported: false, quality: 'off', active: false});
    expect(u.reason).toContain('float');
  });

  it('frame: scene -> target, march, temporal, composite to canvas; direct path when disabled; no lights added', () => {
    const {scene, camera, flashlight, muzzle} = rig();
    const r = fakeRenderer();
    const a = new VolumetricAtmosphere(r as unknown as THREE.WebGLRenderer, {flashlight, muzzle}, 'high');
    a.setSize(1280, 720);
    const l = station(1);
    const sl = new StationLighting(scene, l, fixturesOf(l), null, {hemi: new THREE.HemisphereLight()});
    a.setStation(l, sl.volume);
    const lights0 = lightsIn(scene), children0 = scene.children.length;
    for (let f = 0; f < 120; f++) {
      flashlight.intensity = f % 40 < 20 ? MOOD.flashlight : 0;
      muzzle.intensity = f % 7 === 0 ? 18 : 0;
      r.calls.length = 0;
      a.render(scene, camera, f / 60);
      const renders = r.calls.filter(c => c.op === 'render');
      expect(renders.map(c => `${c.what}@${c.target}`)).toEqual([
        'station@volumetric-scene', 'volumetric-march@volumetric-march',
        `volumetric-temporal@volumetric-history-${f % 2 ? 'b' : 'a'}`, 'volumetric-composite@canvas',
      ]);
      expect(flashlight.shadow.autoUpdate).toBe(flashlight.intensity > 0);
      const u = a.march.uniforms;
      expect((u.uFlashColor.value as THREE.Vector3).length() > 0).toBe(flashlight.intensity > 0);
      expect((u.uMuzzleColor.value as THREE.Vector3).length() > 0).toBe(muzzle.intensity > 0);
      for (const [k, v] of Object.entries(u)) if (typeof v.value === 'number') expect(Number.isFinite(v.value), k).toBe(true);
    }
    expect(lightsIn(scene)).toBe(lights0);           // no light added per frame
    expect(scene.children.length).toBe(children0);   // nothing added to the station scene
    expect(lightsIn((a as unknown as {quadScene: THREE.Scene}).quadScene)).toBe(0);
    expect(a.march.uniforms.tField.value).toBe(sl.volume.texture);
    expect(a.march.uniforms.uFieldGain.value).toBe(ATMOSPHERE.fixtureScatter);
    expect((a.march.uniforms.uFieldLevels.value as THREE.Vector3).toArray()).toEqual(sl.volume.resolution.toArray());
    expect(a.composite.uniforms.uExposure.value).toBe(MOOD.exposure);
    // Before/after toggle: direct path, exactly the r5 calls.
    a.enabled = false;
    r.calls.length = 0;
    a.render(scene, camera, 3);
    expect(r.calls).toEqual([{op: 'target', target: 'canvas'}, {op: 'clear', target: 'canvas'}, {op: 'render', target: 'canvas', what: 'station'}]);
    sl.dispose(scene);
  });

  it('shader error in a volumetric program falls back to the direct path in the same frame', () => {
    const {scene, camera, flashlight} = rig();
    const r = fakeRenderer({failOn: 'volumetric-march'});
    const prevHandler = () => {};
    r.debug.onShaderError = null;
    const a = new VolumetricAtmosphere(r as unknown as THREE.WebGLRenderer, {flashlight}, 'high');
    a.setSize(640, 360);
    a.setStation(station(1), null);
    a.render(scene, camera, 0);
    expect(a.failed).toBeTruthy();
    expect(a.active).toBe(false);
    const last = r.calls.filter(c => c.op === 'render').at(-1);
    expect(last).toEqual({op: 'render', target: 'canvas', what: 'station'});
    expect(r.calls.some(c => c.what === 'volumetric-composite')).toBe(false);
    a.dispose();
    expect(r.debug.onShaderError).toBe(null); // handler restored
    void prevHandler;
  });

  it('resize / new station / quality change / dispose release everything (no leaks)', () => {
    const {scene, camera, flashlight} = rig();
    const r = fakeRenderer();
    const a = new VolumetricAtmosphere(r as unknown as THREE.WebGLRenderer, {flashlight}, 'high');
    a.setSize(1280, 720);
    const l1 = station(1), l2 = station(3);
    a.setStation(l1, null);
    a.render(scene, camera, 0);
    const tex1 = a.march.uniforms.tDensityMap.value as THREE.Texture;
    expect(tex1).toBeInstanceOf(THREE.DataTexture);
    const d1 = disposed(tex1);
    a.setStation(l2, null); // New Station
    expect(d1.n).toBe(1);
    a.render(scene, camera, 0);
    const rt = (a as unknown as {sceneRT: THREE.WebGLRenderTarget}).sceneRT;
    const march = (a as unknown as {marchRT: THREE.WebGLRenderTarget}).marchRT;
    const hist = (a as unknown as {history: THREE.WebGLRenderTarget[]}).history;
    expect((rt as unknown as {isXRRenderTarget: boolean}).isXRRenderTarget).toBe(true);
    expect(rt.texture.internalFormat).toBe('RGBA8');
    expect(rt.samples).toBe(4);
    expect(rt.depthTexture).toBeInstanceOf(THREE.DepthTexture);
    expect(march.texture.type).toBe(THREE.HalfFloatType);
    a.setSize(1600, 900);
    expect([rt.width, rt.height]).toEqual([1600, 900]);
    expect([march.width, march.height]).toEqual([800, 450]);
    const seen = [rt, rt.depthTexture!, march, ...hist].map(disposed);
    a.setQuality('low'); // targets rebuilt lazily for the new MSAA / size
    expect(seen.every(s => s.n >= 1)).toBe(true);
    a.render(scene, camera, 0);
    const rt2 = (a as unknown as {sceneRT: THREE.WebGLRenderTarget}).sceneRT;
    expect(rt2).not.toBe(rt);
    expect(rt2.samples).toBe(0);
    const all = [rt2, rt2.depthTexture!, (a as unknown as {marchRT: THREE.WebGLRenderTarget}).marchRT, ...(a as unknown as {history: THREE.WebGLRenderTarget[]}).history,
      a.march, a.temporal, a.composite, a.noise, a.march.uniforms.tDensityMap.value as THREE.Texture,
      ((a as unknown as {quad: THREE.Mesh}).quad.geometry)].map(disposed);
    a.dispose();
    expect(all.map(s => s.n >= 1)).toEqual(all.map(() => true));
    expect(a.active).toBe(false);
    a.dispose(); // idempotent
  });

  it('shadow casters: opaque lit meshes cast (structure double-sided), glow/tubes/decals do not', () => {
    const root = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial();
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(), wallMat);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshLambertMaterial({transparent: true}));
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial(), 4);
    root.add(wall, tube, decal, inst);
    const r = markShadows(root, true, true);
    expect(r).toEqual({casters: 2, receivers: 2});
    expect([wall.castShadow, tube.castShadow, decal.castShadow, inst.castShadow]).toEqual([true, false, false, true]);
    expect(wallMat.shadowSide).toBe(THREE.DoubleSide);
    const actor = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    markShadows(actor, false, false);
    expect([actor.castShadow, actor.receiveShadow, (actor.material as THREE.Material).shadowSide]).toEqual([true, false, null]);
    // configureFlashlightShadow without a renderer (tests) still sets the light up.
    const l = new THREE.SpotLight();
    configureFlashlightShadow(l, 'high', null);
    expect(l.castShadow).toBe(true);
    expect(l.shadow.bias).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe.runIf(!!process.env.FOG_PREVIEW)('CPU fog previews (FOG_PREVIEW=1)', () => {
  it('renders flashlight on/off with and without haze', async () => {
    const sharp = (await import('sharp')).default;
    const {renderFogPreview} = await import('./helpers/fogPreview');
    const {previewScene} = await import('./helpers/lightPreview');
    const {bakeLightField} = await import('../src/world/lightField');
    const out = path.join(REPO, 'qa-artifacts', 'iter06-fog');
    fs.mkdirSync(out, {recursive: true});
    const W = Number(process.env.FOG_PREVIEW_W ?? 360), H = Math.round(W * 9 / 16);
    const noise = buildNoiseVolume();
    for (const seed of (process.env.FOG_PREVIEW_SEEDS ?? '1,6').split(',').map(Number)) {
      const l = station(seed), field = bakeLightField({grid: l.grid, lights: l.lights, trenchFloorY: l.trench.floorY});
      const sc = previewScene(l), params = {...atmosphereFor(l), ...JSON.parse(process.env.FOG_PREVIEW_PARAMS ?? '{}')}, dmap = buildDensityMap(l, params);
      const P = l.areas[l.platform], sp = l.playerSpawn;
      const pz = (P.y + P.h / 2) * CELL;
      const views = [
        {label: 'spawn', cam: {x: sp.x, y: 1.6, z: sp.z, yaw: sp.yaw, pitch: 0.0, fov: 75}},
        {label: 'platform length', cam: {x: (P.x + 3) * CELL, y: 1.6, z: pz, yaw: -Math.PI / 2, pitch: 0.02, fov: 75}},
      ];
      const dark = l.areas.find(a => a.lighting === 'dark' && a.w * a.h > 40);
      if (dark) views.push({label: `dark ${dark.type}`, cam: {x: (dark.x + 1.2) * CELL, y: 1.6, z: (dark.y + dark.h / 2) * CELL, yaw: -Math.PI / 2, pitch: -0.05, fov: 75}});
      const cols = [
        {t: 'flashlight ON, no haze (r5)', fog: false, flash: true}, {t: 'flashlight ON + haze', fog: true, flash: true},
        {t: 'flashlight OFF, no haze (r5)', fog: false, flash: false}, {t: 'flashlight OFF + haze', fog: true, flash: false},
      ];
      const LH = 18, TW = W * cols.length, TH = views.length * (H + LH) + LH;
      const big = Buffer.alloc(TW * TH * 3, 16);
      const labels: string[] = [];
      views.forEach((v, row) => {
        cols.forEach((c, col) => {
          const img = renderFogPreview(sc, v.cam, {mood: MOOD, field, params, density: dmap, noise, width: W, height: H, flashlight: c.flash, fog: c.fog, time: 0});
          for (let y = 0; y < H; y++) img.copy(big, ((LH + row * (H + LH) + LH + y) * TW + col * W) * 3 - LH * TW * 3, y * W * 3, (y + 1) * W * 3);
        });
        labels.push(`<text x="6" y="${LH + row * (H + LH) + 13}" font-family="DejaVu Sans" font-size="12" fill="#ddd">seed ${seed} - ${v.label}</text>`);
      });
      const head = cols.map((c, i) => `<text x="${i * W + 6}" y="13" font-family="DejaVu Sans" font-size="12" fill="#ddd">${c.t}</text>`).join('');
      const svg = `<svg width="${TW}" height="${TH}">${head}${labels.join('')}</svg>`;
      await sharp(big, {raw: {width: TW, height: TH, channels: 3}}).composite([{input: Buffer.from(svg)}]).png().toFile(path.join(out, `fog-preview-seed${seed}${process.env.FOG_PREVIEW_TAG ?? ''}.png`));
    }
  }, 900000);
});
