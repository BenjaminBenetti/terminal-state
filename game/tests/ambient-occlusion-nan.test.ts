// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane AO): the lead's browser finding — WebGL 2 (Firefox + llvmpipe), quality
// high, the real Subway seed 4242, the camera 1-2 m from a large flat wall (pose x 163.25, z 31.75, yaw 0, pitch -0.25): with AO on the
// WHOLE frame was black (no error, AO active); off = a normal picture. A black frame with every pixel dark means the composite's AO
// factor was NaN or at its floor on every pixel. In Node neither the CPU mirror nor the GENERATED GLSL (run here on the CPU) produces a
// NaN or a dark value on that wall (exact or 24-bit depth) — but the composite's old fallback turned any AO texel WITHOUT DATA into full
// occlusion: when the depth weights of all four texels failed it took the "nearest-depth" texel's ao even when that texel was a cleared /
// never-written (0, 0) one, or NaN: ao 0 -> x (1 - strength) = 0.2 on every pixel (black after ACES), NaN -> a NaN colour (black).
// Every stage is now NaN-safe and bounded (render/ambientOcclusion.ts header). This file pins it:
//  1. the CPU mirror on near walls (0.3-2 m, several pitches / yaws, a frame-filling wall with a sign box): every raw / blurred /
//     upsampled value and every applied factor is finite and bounded ([0, 1]; factor in [1 - strength, 1]);
//  2. garbage AO targets (never written (0, 0), NaN, Inf, negative, huge g): the blur, the upsample and the factor read OPEN (1);
//  3. the GENERATED GLSL itself, run on the CPU (tests/helpers/glslEval.ts + loop unrolling): the raw pass equals the mirror on near walls
//     (finite everywhere), and the composite's AO block on garbage AO texels returns exactly the AO-off colour, never NaN, never darker
//     than 1 - strength; the WGSL / GLSL carry the guards.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {RenderTarget} from 'three/webgpu';
import {texture} from 'three/tsl';
import {AO_G_MAX, createAoRawMaterial, createAoUniforms} from '../src/render/ambientOcclusion';
import {
  AO_LOOK, AO_QUALITY, aoBlur, aoBlurAt, aoFactor, aoRaw, aoRawAt, aoSize, aoTexelValid, aoUpsampleAt, type AoBuffer, type AoView, type V3,
} from '../src/render/ambientOcclusionMath';
import {createCompositeNode, createFogUniforms} from '../src/render/volumetricShaders';
import {compileOutputNode, compileQuad} from './helpers/fogCompile';
import {BUILTINS, mainBody, mat4, runFlow, type Env, type Val} from './helpers/glslEval';

// ---------------------------------------------------------------------------------------------
// Analytic near-wall views (as tests/ambient-occlusion-math.test.ts: view depth per full-res pixel; Infinity = nothing)

type Prim = {plane: V3; d: number} | {box: [V3, V3]};
function castView(w: number, h: number, fovY: number, eye: V3, pitch: number, yaw: number, prims: Prim[]): AoView {
  const tanY = Math.tan(fovY * Math.PI / 360), aspect = w / h, zb = new Float64Array(w * h);
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const vx = (2 * (x + 0.5) / w - 1) * tanY * aspect, vy = (1 - 2 * (y + 0.5) / h) * tanY;
    const ry = vy * cp + sp, rz = vy * sp - cp; // pitch about x of (vx, vy, -1)
    const d: V3 = [vx * cy + rz * sy, ry, -vx * sy + rz * cy];
    let best = Infinity;
    for (const p of prims) {
      if ('plane' in p) {
        const nd = p.plane[0] * d[0] + p.plane[1] * d[1] + p.plane[2] * d[2];
        if (Math.abs(nd) < 1e-12) continue;
        const t = -(p.plane[0] * eye[0] + p.plane[1] * eye[1] + p.plane[2] * eye[2] + p.d) / nd;
        if (t > 1e-6 && t < best) best = t;
      } else {
        let t0 = -Infinity, t1 = Infinity;
        for (let k = 0; k < 3; k++) { const lo = (p.box[0][k] - eye[k]) / d[k], hi = (p.box[1][k] - eye[k]) / d[k]; t0 = Math.max(t0, Math.min(lo, hi)); t1 = Math.min(t1, Math.max(lo, hi)); }
        if (t1 >= t0 && t0 > 1e-6 && t0 < best) best = t0;
      }
    }
    zb[y * w + x] = best;
  }
  return {w, h, tanY, aspect, z: (x, y) => zb[y * w + x]};
}

const FLOOR: Prim = {plane: [0, 1, 0], d: 0};
const wallAt = (dist: number): Prim => ({plane: [0, 0, 1], d: dist}); // z = -dist, facing the eye at the origin
/** Pose B's look: a frame-filling wall, a sign box on it near the top, the floor edge at the bottom. */
const poseB = (dist: number): Prim[] => [FLOOR, wallAt(dist), {box: [[-0.9, 2.1, -dist - 0.001], [0.9, 2.5, -dist + 0.06]]}];

describe('the CPU mirror stays finite and bounded on near walls', () => {
  const W = 480, H = 270;
  for (const dist of [0.3, 0.5, 1, 1.5, 2]) for (const [pitch, yaw] of [[-0.25, 0], [0, 0.6], [-0.6, -0.4]]) {
    it(`wall ${dist} m, pitch ${pitch}, yaw ${yaw} (and a sign box), both presets`, () => {
      const v = castView(W, H, 75, [0, 1.62, 0], pitch, yaw, poseB(dist));
      for (const q of [AO_QUALITY.high, AO_QUALITY.low]) {
        const raw = aoRaw(v, q), b = aoBlur(raw);
        for (let i = 0; i < raw.w * raw.h; i++) {
          expect(Number.isFinite(raw.ao[i]) && raw.ao[i] >= 0 && raw.ao[i] <= 1, `raw ${i}`).toBe(true);
          expect(Number.isFinite(raw.g[i]) && raw.g[i] >= 0 && raw.g[i] <= AO_G_MAX).toBe(true);
          expect(Number.isFinite(b.ao[i]) && b.ao[i] >= 0 && b.ao[i] <= 1, `blurred ${i}`).toBe(true);
        }
        let mean = 0, n = 0;
        for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
          const z = v.z(x, y), f = aoFactor(aoUpsampleAt(b, W, H, x, y, z), 0.1, AO_LOOK, true, !Number.isFinite(z));
          expect(f >= 1 - AO_LOOK.strength && f <= 1, `factor at ${x},${y}`).toBe(true);
          mean += f; n++;
        }
        // a flat wall is open: the frame as a whole is barely darkened (contact shading at the sign and the floor edge only)
        expect(mean / n, 'mean factor').toBeGreaterThan(0.97);
      }
    });
  }
});

describe('garbage AO targets read open (never "nearest depth" darkness, never NaN)', () => {
  const buf = (w: number, h: number, ao: number, g: number): AoBuffer => ({w, h, ao: new Float32Array(w * h).fill(ao), g: new Float32Array(w * h).fill(g)});
  it('a never-written / cleared target (0, 0), NaN, Inf, negative or huge values: upsample = 1, blur = 1, factor = 1', () => {
    for (const [ao, g] of [[0, 0], [NaN, 0.5], [0.5, NaN], [NaN, NaN], [0, Infinity], [-3, 0.6], [7, 0.6], [0.3, 1e9], [0.3, -2]]) {
      const b = buf(8, 6, ao, g);
      expect(aoTexelValid(ao, g), `${ao}, ${g}`).toBe(false);
      for (const z of [0.4, 1.5, 10]) expect(aoUpsampleAt(b, 16, 12, 5, 5, z), `upsample ${ao}, ${g}`).toBe(1);
      expect(aoBlurAt(b, 3, 3, 0)).toBe(1);
      expect(aoBlurAt(b, 3, 3, 1)).toBe(1);
    }
    expect(aoFactor(NaN, 0.1)).toBe(1);
    expect(aoFactor(-1, 0.1)).toBe(1);
    expect(aoFactor(0, 0.1)).toBeCloseTo(1 - AO_LOOK.strength, 3); // full occlusion: the floor, never below
    expect(aoFactor(0, 0.1, {...AO_LOOK, strength: 3})).toBeCloseTo(0, 6); // a QA strength past 1 is clamped to 1 (never past black)
    // one valid texel among garbage: only it counts
    const b = buf(2, 2, 0, 0);
    b.ao[3] = 0.4; b.g[3] = 1 / 1.5;
    expect(aoUpsampleAt(b, 4, 4, 2, 2, 1.5)).toBeCloseTo(0.4, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// The GENERATED GLSL on the CPU (exact arithmetic): loops unrolled, texelFetch / textureSize from JS buffers

/** Unroll every `for ( int i = 0; i < N; i ++ ) { ... }` (innermost first): the body repeated with `i = k;` before each copy. */
function unroll(src: string): string {
  for (;;) {
    const re = /for \( int (\w+) = 0; \1 < (\d+); \1 \+\+ \) \{/g;
    let m: RegExpExecArray | null, changed = false;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length - 1;
      let d = 0, k = open;
      for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) break; }
      const body = src.slice(open + 1, k);
      if (/for \(/.test(body)) continue;
      let out = '';
      for (let i = 0; i < Number(m[2]); i++) out += `\n${m[1]} = ${i};\n${body}\n`;
      src = src.slice(0, m.index) + out + src.slice(k + 1);
      changed = true;
      break;
    }
    if (!changed) return src;
  }
}

type Tex = {w: number; h: number; at(x: number, y: number): number[]};
const map1 = (f: (x: number) => number) => (a: Val[]): Val => (Array.isArray(a[0]) ? (a[0] as number[]).map(f) : f(a[0] as number));
/** glslEval's builtins + what the AO / composite code adds; samplers are env numbers (index into `tex`). Flip flags / uv matrices: identity. */
function emuFns(tex: Tex[]): Record<string, (a: Val[]) => Val> {
  return {
    ...BUILTINS, acos: map1(Math.acos), cos: map1(Math.cos), sin: map1(Math.sin), uint: a => Math.trunc(a[0] as number),
    ivec2: a => { const f = (a as unknown[]).flatMap(v => (Array.isArray(v) ? v : [v])) as number[]; return (f.length === 1 ? [f[0], f[0]] : f.slice(0, 2)).map(Math.trunc); },
    textureSize: a => { const t = tex[a[0] as number]; return [t.w, t.h]; },
    texelFetch: a => { const t = tex[a[0] as number], c = a[1] as number[]; return c[0] < 0 || c[1] < 0 || c[0] >= t.w || c[1] >= t.h ? [0, 0, 0, 0] : t.at(c[0], c[1]); },
  };
}
/** Uniform defaults of a generated program: every mat3 (uv transforms) identity, every scalar flag (flipY) 0; samplers by first use. */
function baseEnv(glsl: string, body: string): {env: Env; samplers: string[]} {
  const env: Env = new Map();
  for (const m of glsl.matchAll(/^\t(\w+) (\w+);$/gm)) {
    if (m[1] === 'mat3') env.set(m[2], {mat: [1, 0, 0, 0, 1, 0, 0, 0, 1], n: 3});
    else if (/^(uint|int|bool|float)$/.test(m[1])) env.set(m[2], 0);
  }
  const samplers: string[] = [];
  for (const m of body.matchAll(/texelFetch\( (\w+),/g)) if (!samplers.includes(m[1])) samplers.push(m[1]);
  samplers.forEach((s, i) => env.set(s, i));
  return {env, samplers};
}

describe('the generated GLSL (run on the CPU) is the mirror on near walls and NaN-safe in the composite', () => {
  const W = 960, H = 540, cam = new THREE.PerspectiveCamera(75, W / H, 0.05, 70);
  cam.updateProjectionMatrix();
  const P = cam.projectionMatrix.elements;
  const devDepth = (z: number) => (Number.isFinite(z) ? ((P[10] * -z + P[14]) / z + 1) / 2 : 1); // WebGL NDC z -> [0, 1]

  it('raw pass: pose-B-like near walls (1, 1.5 m; pitch -0.25) — finite, equal to the mirror', () => {
    const q = AO_QUALITY.high, [aw, ah] = aoSize(W, H, q);
    const fu = createFogUniforms(), au = createAoUniforms();
    (fu.projInv as unknown as {setName(n: string): void}).setName('projInv');
    const rt = new RenderTarget(W, H, {samples: 4, type: THREE.HalfFloatType});
    rt.depthTexture = new THREE.DepthTexture(W, H);
    const glsl = compileQuad(createAoRawMaterial(fu, au, rt.depthTexture, q), 'glsl').fragment;
    const body = unroll(mainBody(glsl));
    for (const dist of [1, 1.5]) {
      const v = castView(W, H, 75, [0, 1.62, 0], -0.25, 0, poseB(dist));
      const fns = emuFns([{w: W, h: H, at: (x, y) => { const d = devDepth(v.z(x, y)); return [d, d, d, 1]; }}]);
      let n = 0;
      for (let iy = 5; iy < ah; iy += 23) for (let ix = 3; ix < aw; ix += 29) {
        const {env} = baseEnv(glsl, body);
        env.set('projInv', mat4(cam.projectionMatrixInverse.elements));
        env.set('aoSize', [aw, ah]);
        env.set('aoShape', [AO_LOOK.radius, AO_LOOK.maxRadiusFrac, AO_LOOK.thickness, P[5]]);
        env.set('aoFilter', [AO_LOOK.fade[0], AO_LOOK.fade[1], AO_LOOK.blurK, AO_LOOK.upsampleK]);
        env.set('nodeVarying4', [(ix + 0.5) / aw, (iy + 0.5) / ah]);
        runFlow(body, env, fns);
        const out = env.get('vfAoRaw') as number[], m = aoRawAt(v, ix, iy, aw, ah, q);
        expect(out.every(Number.isFinite), `${ix},${iy}`).toBe(true);
        expect(out[0], `ao ${ix},${iy}`).toBeCloseTo(m.ao, 4);
        expect(out[1], `g ${ix},${iy}`).toBeCloseTo(m.g, 4);
        n++;
      }
      expect(n).toBeGreaterThan(150);
    }
  });

  it('composite AO block: garbage AO texels give exactly the AO-off colour; valid ones the mirror\'s factor; never NaN, never below 1 - strength', () => {
    const fu = createFogUniforms(), au = createAoUniforms();
    (fu.projInv as unknown as {setName(n: string): void}).setName('projInv');
    (fu.intensity as unknown as {setName(n: string): void}).setName('fogIntensity');
    const scene = new RenderTarget(16, 9, {type: THREE.HalfFloatType});
    scene.depthTexture = new THREE.DepthTexture(16, 9);
    const fog = new RenderTarget(8, 5, {count: 2, type: THREE.HalfFloatType});
    const aoRt = new RenderTarget(8, 5, {type: THREE.HalfFloatType, format: THREE.RGFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter});
    const glsl = compileOutputNode(createCompositeNode(fu, texture(scene.texture), texture(scene.depthTexture!), texture(fog.textures[0]), texture(fog.textures[1]),
      {u: au, tex: texture(aoRt.texture)}), 'glsl').fragment;
    const body = mainBody(glsl);
    const {samplers} = baseEnv(glsl, body);
    expect(samplers, 'depth, colour, fog in-scatter, fog transmittance, AO').toHaveLength(5);
    expect(body.indexOf(`texelFetch( ${samplers[4]},`)).toBeGreaterThan(body.indexOf('aoOn > 0.5'));
    const z = 1.5, colour = [0.3, 0.2, 0.1, 1];
    const run = (ao: number, g: number) => {
      const {env} = baseEnv(glsl, body);
      env.set('projInv', mat4(cam.projectionMatrixInverse.elements));
      env.set('fogIntensity', 1);
      env.set('aoOn', 1);
      env.set('aoFilter', [AO_LOOK.fade[0], AO_LOOK.fade[1], AO_LOOK.blurK, AO_LOOK.upsampleK]);
      env.set('aoApply', [AO_LOOK.strength, AO_LOOK.power, AO_LOOK.guard[0], AO_LOOK.guard[1]]);
      env.set('nodeVarying4', [0.53, 0.47]);
      const fns = emuFns([
        {w: 16, h: 9, at: () => { const d = devDepth(z); return [d, d, d, 1]; }}, // scene depth: a surface at 1.5 m
        {w: 16, h: 9, at: () => colour}, // scene colour (linear HDR)
        {w: 8, h: 5, at: () => [0, 0, 0, z]}, // fog in-scatter 0, its view depth
        {w: 8, h: 5, at: () => [1, 0, 0, 1]}, // transmittance 1
        {w: 8, h: 5, at: () => [ao, g, 0, 1]}, // the AO target
      ]);
      runFlow(body, env, fns);
      return env.get('fragColor') as number[];
    };
    for (const [ao, g] of [[0, 0], [NaN, 1 / z], [0.4, NaN], [NaN, NaN], [0.4, Infinity], [-2, 1 / z], [5, 1 / z], [0.4, 1e9], [0.4, -1]]) {
      const out = run(ao, g);
      expect(out.slice(0, 3), `AO texel (${ao}, ${g}): exactly the AO-off colour`).toEqual(colour.slice(0, 3));
    }
    for (const ao of [0, 0.25, 0.6, 1]) {
      const out = run(ao, 1 / z), f = aoFactor(ao, 0.2126 * 0.3 + 0.7152 * 0.2 + 0.0722 * 0.1);
      for (let k = 0; k < 3; k++) {
        expect(Number.isFinite(out[k])).toBe(true);
        expect(out[k], `ao ${ao}`).toBeCloseTo(colour[k] * f, 6);
        expect(out[k]).toBeGreaterThanOrEqual(colour[k] * (1 - AO_LOOK.strength) - 1e-9);
      }
    }
  });

  it('the guards are in the generated code of both backends (validity comparisons, the factor floor)', () => {
    const fu = createFogUniforms(), au = createAoUniforms();
    const scene = new RenderTarget(16, 9, {type: THREE.HalfFloatType});
    scene.depthTexture = new THREE.DepthTexture(16, 9);
    const fog = new RenderTarget(8, 5, {count: 2, type: THREE.HalfFloatType});
    const aoRt = new RenderTarget(8, 5, {type: THREE.HalfFloatType, format: THREE.RGFormat});
    for (const backend of ['glsl', 'wgsl'] as const) {
      const c = compileOutputNode(createCompositeNode(fu, texture(scene.texture), texture(scene.depthTexture!), texture(fog.textures[0]), texture(fog.textures[1]),
        {u: au, tex: texture(aoRt.texture)}), backend).fragment;
      expect(c, `${backend}: the texel validity (g <= AO_G_MAX)`).toMatch(/<= 10000\.0/);
      expect(c, `${backend}: the factor floor 1 - strength`).toMatch(/1\.0 - (object\.)?aoApply\.x/);
      const r = compileQuad(createAoRawMaterial(fu, au, scene.depthTexture!, AO_QUALITY.high), backend).fragment;
      expect(r, `${backend}: the raw output's g guard`).toMatch(/<= 10000\.0/);
      expect(r, `${backend}: the horizon sample's finite-cosine guard`).toMatch(/>= -1\.001/);
    }
  });
});
