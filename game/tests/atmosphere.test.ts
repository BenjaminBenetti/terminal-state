// Volumetric atmosphere (iteration 06 Lane F, iteration 12 ATMOS, iteration 13 FOG).
// The iteration-06 GLSL shader-hook chaining tests (render/shaderHooks.ts) are retired with that module: node materials
// compose through render/nodeHooks.ts (covered in surface-nodes / lighting-node / damage tests).
// Iteration 13 (FOG): the passes are TSL node graphs on WebGPURenderer (render/volumetricShaders.ts). The GLSL-string lint
// tests are replaced by: compiling every graph with three r186's real node builders for BOTH backends (GLSL ES 3.0 for the
// WebGL2 fallback, WGSL for WebGPU) in Node, structural checks of the generated code (bounded loop, one shadow compare in
// uniform control flow, no implicit-derivative lookups), the three r186 behaviour the pipeline relies on, the CPU mirrors
// (phase, attenuation, depth-limited march, shadow lookup, bilateral upsample, linear composite) and the module lifecycle
// with a fake renderer. The user-facing fog behaviour (persistence, clear / dense areas, motion, lights on / off) is in
// tests/fog-medium.test.ts.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {texture} from 'three/tsl';
import {RenderTarget} from 'three/webgpu';
import {generateStation, type StationLayout} from '../src/gen/station';
import {MOOD} from '../src/world/lights';
import {
  ATMOSPHERE, ATMOSPHERE_QUALITY, bilateralUpsample, compositeLinear, distanceAttenuation, fixtureRadiance, flashlightRadiance,
  integrateInscatter, marchSamples, marchSize, phase, shadowBiasFor, SHADOW_NEAR, SHADOW_NORMAL_BIAS, viewZFromDepth, type SpotInput, type V3,
} from '../src/render/atmosphere';
import {VolumetricAtmosphere, configureFlashlightShadow, fogOverrideFromUrl, markShadows} from '../src/render/volumetric';
import {VF_LIMITS, VF_MARK, createCompositeNode, createFogUniforms, createMarchMaterial, createTemporalMaterial} from '../src/render/volumetricShaders';
import {compileOutputNode, compileQuad} from './helpers/fogCompile';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(GAME, '..');
const T3 = (p: string) => fs.readFileSync(path.join(REPO, 'node_modules/three/src', p), 'utf8');
const stations = new Map<number, StationLayout>();
const station = (seed: number) => { let s = stations.get(seed); if (!s) stations.set(seed, (s = generateStation(seed))); return s; };

// ---------------------------------------------------------------------------------------------
describe('iteration 13: the TSL passes compile for both WebGPURenderer backends (no GPU)', () => {
  const textures = (shadow: boolean) => {
    const sh = new THREE.DepthTexture(8, 8);
    sh.compareFunction = THREE.LessEqualCompare;
    const arr = (c: number) => new THREE.DataArrayTexture(new Uint8Array(4 * c), 1, 1, 4);
    return {depth: new THREE.DepthTexture(8, 8), noise: new THREE.Data3DTexture(new Uint8Array(64), 2, 2, 4), density: arr(4), air: arr(1), vis: arr(1), shadow: shadow ? sh : null};
  };
  const lines = (src: string) => src.split('\n');
  const indent = (l: string) => (l.match(/^\t*/)?.[0].length ?? 0);

  it('march: GLSL ES 3.0 + WGSL, bounded loop, marked, both MRT outputs, with and without the flashlight shadow', () => {
    const u = createFogUniforms();
    for (const backend of ['glsl', 'wgsl'] as const) for (const shadow of [false, true]) for (const steps of [14, 24]) {
      const c = compileQuad(createMarchMaterial(u, textures(shadow), {steps}), backend);
      const f = c.fragment;
      expect(f, `${backend} ${steps}`).toContain(VF_MARK.march);
      expect(f).toMatch(backend === 'glsl' ? new RegExp(`for \\( int i = 0; i < ${steps}; i \\+\\+ \\)`) : new RegExp(`for \\( var i : i32 = 0; i < ${steps}; i \\+\\+ \\)`));
      // two colour outputs (in-scatter + depth, transmittance)
      expect(backend === 'glsl' ? /layout\( location = 1 \) out/.test(f) || /out highp vec4 m1|m1 =/.test(f) : /@location\( 1 \)/.test(f), `${backend} MRT`).toBe(true);
      if (backend === 'wgsl') {
        const cmp = lines(f).filter(l => l.includes('textureSampleCompare('));
        expect(cmp.length, 'one shadow compare per step').toBe(shadow ? 1 : 0);
        if (shadow) {
          // uniform control flow: directly in the step loop's body (one level below the loop), never inside an `if`
          const loop = lines(f).find(l => /for \( var i : i32/.test(l))!;
          expect(indent(cmp[0])).toBe(indent(loop) + 1);
        }
        // every other lookup is textureSampleLevel / textureLoad (no implicit derivatives in per-pixel branches)
        expect(lines(f).filter(l => /textureSample\(/.test(l))).toEqual([]);
      } else {
        expect(/uniform sampler2DShadow/.test(f)).toBe(shadow);
      }
    }
  });

  it('temporal + composite compile for both backends; the composite loads the scene pass before the fog', () => {
    const u = createFogUniforms();
    const rt = new RenderTarget(4, 4, {count: 2, type: THREE.HalfFloatType});
    const scene = new RenderTarget(8, 8, {type: THREE.HalfFloatType});
    scene.depthTexture = new THREE.DepthTexture(8, 8);
    for (const backend of ['glsl', 'wgsl'] as const) {
      const t = compileQuad(createTemporalMaterial(u, rt.textures[0], rt.textures[1], texture(new THREE.Texture()), texture(new THREE.Texture())), backend);
      expect(t.fragment).toContain(VF_MARK.temporal);
      const comp = compileOutputNode(createCompositeNode(u, texture(scene.texture), texture(scene.depthTexture), texture(rt.textures[0]), texture(rt.textures[1])), backend);
      expect(comp.fragment).toContain(VF_MARK.composite);
      if (backend === 'glsl') for (const f of [t.fragment, comp.fragment]) {
        // GLSL textureSize() is ivec2 (three r186 types the node uvec2 and emits it uncast): no unsigned vector maths, or
        // WebGL2 rejects the program ("no operation for highp ivec2 and const uvec2", the resume-time fallback bug)
        expect(f).not.toMatch(/\buvec[234]\b/);
        expect(f).toMatch(/ivec2\( textureSize\(/);
      }
    }
  });

  it('uniform arrays match the smoke / scatter limits', () => {
    const u = createFogUniforms();
    expect(u.puff.array.length).toBe(VF_LIMITS.puffs);
    expect(u.puffD.array.length).toBe(VF_LIMITS.puffs);
    expect(u.scatPos.array.length).toBe(VF_LIMITS.scatter);
    expect(u.smokeBound.array.length).toBe(VF_LIMITS.smoke);
    expect(u.win.array.length).toBe(VF_LIMITS.windows);
  });
});

// ---------------------------------------------------------------------------------------------
describe('three r186 behaviour the fog pipeline relies on', () => {
  it('RenderPipeline tone-maps once in its output node (linear scene pass, NoToneMapping while the quad draws)', () => {
    const rp = T3('renderers/common/RenderPipeline.js');
    expect(rp).toContain('outputNode = renderOutput( outputNode, toneMapping, outputColorSpace );');
    expect(rp).toContain('renderer.toneMapping = NoToneMapping;');
    const pn = T3('nodes/display/PassNode.js');
    expect(pn).toContain('this.updateBeforeType = NodeUpdateType.FRAME;');
    expect(pn).toMatch(/getTexture\( name \)/);
  });

  it('FRAME updates run once per frame id (FogPassNode can force the scene pass first without a second render)', () => {
    const nf = T3('nodes/core/NodeFrame.js');
    expect(nf).toContain('if ( nodeUpdateBeforeMap.frameId !== this.frameId ) {');
    expect(T3('nodes/core/NodeBuilder.js')).toContain('This function should be called after \'setup()\' in the \'build()\' process to ensure that the child nodes are processed first.');
  });

  it('spot shadows: compare depth texture, y-flipped [0,1] coords, coordinate-system aware shadow.matrix, castShadow in the light hash', () => {
    const sn = T3('nodes/lighting/ShadowNode.js');
    expect(sn).toContain('shadowCoord.y.oneMinus(), // follow webgpu standards');
    expect(sn).toContain("depthTexture.compareFunction = builder.renderer.reversedDepthBuffer ? GreaterEqualCompare : LessEqualCompare;");
    expect(sn).toContain('this.shadow.map = shadowMap;');
    expect(T3('lights/LightShadow.js')).toContain('if ( shadowCamera.coordinateSystem === WebGPUCoordinateSystem || shadowCamera.reversedDepth ) {');
    expect(T3('nodes/lighting/LightsNode.js')).toContain('_hashData.push( light.castShadow ? 1 : 0 );');
    // WGSL compares only in the fragment stage, with implicit derivatives (=> uniform control flow in our loop)
    expect(T3('renderers/webgpu/nodes/WGSLNodeBuilder.js')).toContain('return `textureSampleCompare( ${ textureProperty }, ${ textureProperty }_sampler, ${ uvSnippet }, ${ compareSnippet } )`;');
  });

  it('getViewPosition / getScreenPosition handle both clip conventions; WebGL2 backend reports shader errors through debug.onShaderError', () => {
    const pp = T3('nodes/utils/PostProcessingUtils.js');
    expect(pp).toContain('if ( builder.renderer.coordinateSystem === WebGPUCoordinateSystem ) {');
    expect(pp).toContain('return vec2( sampleUv.x, sampleUv.y.oneMinus() );');
    expect(T3('renderers/webgl-fallback/WebGLBackend.js')).toContain('this.renderer.debug.onShaderError( gl, programGPU, glVertexShader, glFragmentShader );');
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

  it('composite (iteration 13): linear HDR scene x transmittance + in-scatter, exact without fog, tone-mapped once after', () => {
    for (const v of [0, 0.02, 0.1, 0.4, 0.8, 3]) expect(compositeLinear([v, v * 0.9, v * 0.8], [0, 0, 0])).toEqual([v, v * 0.9, v * 0.8]);
    expect(compositeLinear([1, 1, 1], [0.2, 0.1, 0.05], 0.5)).toEqual([0.7, 0.6, 0.55]);
    // intensity 0 = the effect off (scene unchanged even through a dense patch)
    expect(compositeLinear([0.4, 0.4, 0.4], [0.3, 0.3, 0.3], 0.2, 0)).toEqual([0.4, 0.4, 0.4]);
    // monotonic in the in-scatter; never brighter than scene + fog
    let prev = -1;
    for (let i = 0; i <= 20; i++) { const o = compositeLinear([0.3, 0.3, 0.3], [i / 40, i / 40, i / 40], 0.9)[0]; expect(o).toBeGreaterThan(prev); prev = o; }
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
describe('flashlight shadow map: occluded beam, bias without acne (CPU mirror of the march\'s shadow lookup)', () => {
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
describe('VolumetricAtmosphere lifecycle (fake renderer, no GPU)', () => {
  interface Call { op: string; target?: string; what?: string }
  function fakeRenderer(opts: {webgl?: boolean; floatRT?: boolean} = {}) {
    const calls: Call[] = [];
    let target: {texture?: THREE.Texture} | null = null;
    const r = {
      calls, initialized: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, toneMappingExposure: MOOD.exposure,
      xr: {enabled: false}, debug: {onShaderError: null as null | ((...a: unknown[]) => void)},
      shadowMap: {enabled: true, type: THREE.PCFShadowMap},
      backend: opts.webgl === false ? {isWebGPUBackend: true} : {isWebGLBackend: true, extensions: {has: (n: string) => opts.floatRT !== false && n === 'EXT_color_buffer_float'}},
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(1280, 720),
      setRenderTarget: (t: {texture?: THREE.Texture} | null) => { target = t; calls.push({op: 'target', target: t?.texture?.name ?? 'canvas'}); },
      render: (scene: THREE.Object3D) => calls.push({op: 'render', target: target?.texture?.name ?? 'canvas', what: scene.name || scene.type}),
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
  type Fake = ReturnType<typeof fakeRenderer>;
  const make = (r: Fake | null, lights: {flashlight: THREE.SpotLight; muzzle?: THREE.PointLight}, q: 'off' | 'low' | 'high' = 'high') => new VolumetricAtmosphere(r as never, lights, q);

  it('quality presets drive march size, steps, MSAA and the flashlight shadow; ?fog= overrides; backend reported', () => {
    const {flashlight} = rig();
    const r = fakeRenderer();
    const a = make(r, {flashlight});
    a.setSize(1920, 1080);
    let d = a.debug();
    expect(d).toMatchObject({backend: 'webgl2-fallback', quality: 'high', steps: 24, msaa: 4});
    expect(d.resolution.march).toEqual([960, 540]);
    expect(d.shadow).toMatchObject({enabled: true, mapSize: 1024, near: SHADOW_NEAR, normalBias: SHADOW_NORMAL_BIAS});
    a.setSize(2880, 1620);
    expect(a.debug().resolution.march[0] * a.debug().resolution.march[1]).toBeLessThanOrEqual(ATMOSPHERE_QUALITY.high.maxPixels);
    a.setQuality('low');
    expect(a.debug()).toMatchObject({quality: 'low', steps: 14, msaa: 0});
    expect(flashlight.shadow.mapSize.x).toBe(512);
    expect(flashlight.shadow.bias).toBeCloseTo(shadowBiasFor(512, 0.58), 9);
    a.setQuality('off');
    expect(a.debug()).toMatchObject({quality: 'off', active: false, steps: 0});
    expect(flashlight.castShadow).toBe(false);
    expect(r.shadowMap.enabled).toBe(true); // iteration 13: only castShadow follows the quality (light hash => rebuild)
    a.override = 'high';
    a.setQuality('low');
    expect(a.quality).toBe('high');
    expect(fogOverrideFromUrl('?qa=1&fog=off')).toBe('off');
    expect(fogOverrideFromUrl('?fog=ultra')).toBe(null);
    expect(marchSize(1280, 720, ATMOSPHERE_QUALITY.low)).toEqual([320, 180]);
    expect(make(fakeRenderer({webgl: false}), {flashlight: new THREE.SpotLight()}).debug().backend).toBe('webgpu');
    // WebGL2 backend without float colour targets: direct rendering, reported
    const u = make(fakeRenderer({floatRT: false}), {flashlight: new THREE.SpotLight()});
    expect(u.debug()).toMatchObject({supported: false, quality: 'off', active: false});
    expect(u.reason).toContain('float');
    expect(make(null, {flashlight: new THREE.SpotLight()}).debug().backend).toBe('none');
  });

  it('frame: the RenderPipeline draws to the canvas when active; direct scene render when disabled / off / failed; no lights added', () => {
    const {scene, camera, flashlight, muzzle} = rig();
    const r = fakeRenderer();
    const a = make(r, {flashlight, muzzle});
    a.setSize(1280, 720);
    // before a station: not active -> direct
    a.render(scene, camera, 0);
    expect(r.calls.filter(c => c.op === 'render').map(c => c.what)).toEqual(['station']);
    a.setStation(station(1), null);
    const lights0 = lightsIn(scene), children0 = scene.children.length;
    for (let f = 0; f < 30; f++) {
      flashlight.intensity = f % 10 < 5 ? MOOD.flashlight : 0;
      r.calls.length = 0;
      a.render(scene, camera, f / 60);
      const renders = r.calls.filter(c => c.op === 'render');
      // the pipeline's quad renders to the canvas (its scene / fog passes run as node updates on a real renderer)
      expect(renders.length).toBe(1);
      expect(renders[0].target).toBe('canvas');
      expect(renders[0].what).not.toBe('station');
    }
    expect(lightsIn(scene)).toBe(lights0);
    expect(scene.children.length).toBe(children0);
    a.enabled = false;
    r.calls.length = 0;
    a.render(scene, camera, 1);
    expect(r.calls.filter(c => c.op === 'render').map(c => c.what)).toEqual(['station']);
    a.enabled = true;
    a.failed = 'test';
    r.calls.length = 0;
    a.render(scene, camera, 1.1);
    expect(r.calls.filter(c => c.op === 'render').map(c => c.what)).toEqual(['station']);
    a.dispose();
  });

  it('a WebGL2 shader error in a fog program flags the module (direct path next frame) and chains the previous handler', () => {
    const {scene, camera, flashlight} = rig();
    const r = fakeRenderer();
    const seen: unknown[] = [];
    const a = make(r, {flashlight});
    r.debug.onShaderError = (...x: unknown[]) => seen.push(x); // CORE installs its handler during renderer init (after our ctor)
    a.render(scene, camera, 0); // first frame after init: the fog module chains in front of it
    const gl = {getShaderSource: (s: string) => s, getShaderInfoLog: () => ''};
    r.debug.onShaderError!(gl, {}, 'void main(){}', 'other program');
    expect(a.failed).toBe(null);
    r.debug.onShaderError!(gl, {}, 'void main(){}', `vec3 ${VF_MARK.march} = vec3(0.0);`);
    expect(a.failed).toContain('fog');
    expect(seen.length).toBe(2);
    a.dispose();
    expect(seen.length).toBe(2);
    expect(r.debug.onShaderError).not.toBe(null); // restored to the previous (CORE) handler
  });

  it('the flashlight shadow map is requested even while the light is dark; no per-frame shadow pass while dark', () => {
    const {scene, camera, flashlight} = rig();
    flashlight.intensity = 0;
    const a = make(fakeRenderer(), {flashlight});
    a.setSize(640, 360);
    a.setStation(station(1), null);
    a.render(scene, camera, 0);
    expect(flashlight.shadow.autoUpdate).toBe(false);
    expect(flashlight.shadow.needsUpdate).toBe(true);
    a.dispose();
  });

  it('resize / new station / quality change / dispose release the GPU objects', () => {
    const {scene, camera, flashlight} = rig();
    const a = make(fakeRenderer(), {flashlight});
    a.setSize(1280, 720);
    a.setStation(station(1), null);
    a.render(scene, camera, 0);
    const internals = a as unknown as {marchRT: THREE.EventDispatcher<{dispose: object}> | null; history: THREE.EventDispatcher<{dispose: object}>[] | null};
    expect(internals.marchRT).not.toBe(null);
    expect(internals.history?.length).toBe(2);
    let n = 0;
    for (const t of [internals.marchRT!, ...internals.history!]) t.addEventListener('dispose', () => n++);
    a.setQuality('low');
    expect(n).toBe(3);
    expect(internals.marchRT).toBe(null);
    a.render(scene, camera, 0.1);
    expect(internals.marchRT).not.toBe(null);
    const dens = a.densityMap;
    a.setStation(station(2), null);
    expect(a.densityMap).not.toBe(dens);
    a.dispose();
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
    const l = new THREE.SpotLight();
    configureFlashlightShadow(l, 'high', null);
    expect(l.castShadow).toBe(true);
    expect(l.shadow.bias).toBeLessThan(0);
  });
});
