// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane AO; user: "add AO"): the ambient occlusion programs
// (render/ambientOcclusion.ts) compiled by three r186's REAL node builders in Node (tests/helpers/fogCompile.ts: WGSL for the WebGPU
// backend, GLSL ES 3.0 for its WebGL 2 fallback), no GPU:
//  1. raw (both presets, scene depth single-sampled and MULTISAMPLED as on quality high), blur x / y and the composite with the AO
//     lookup compile on both backends without a three warning / error, and carry their shader-error marks (the composite none of AO's);
//  2. safe texture access only (what the fog shaders already run on the players' WebGPU): the scene depth is read by textureLoad alone
//     (no textureSample / textureGather on it, no filtering sampler bound for it), no derivatives, every loop has a literal bound;
//  3. the binding budget: every stage of every variant stays within WebGPU's DEFAULT per-stage limits (12 uniform buffers, 16 sampled
//     textures, 16 samplers) and the GLSL ES 3.0 minimums; the composite gains exactly one sampled texture and NO uniform buffer.
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {RenderTarget} from 'three/webgpu';
import {texture} from 'three/tsl';
import {appendFileSync, writeFileSync} from 'node:fs';
import {AO_MARK, createAoBlurMaterial, createAoRawMaterial, createAoUniforms} from '../src/render/ambientOcclusion';
import {AO_BLUR_TAPS, AO_QUALITY} from '../src/render/ambientOcclusionMath';
import {VF_MARK, createCompositeNode, createFogUniforms} from '../src/render/volumetricShaders';
import {compileOutputNode, compileQuad, type Compiled} from './helpers/fogCompile';

/** AO_TSL_LOG=/tmp/x.txt: per-variant binding counts (+ AO_TSL_DUMP=1: the generated sources); vitest swallows console output. */
const LOG = process.env.AO_TSL_LOG;
const log = (s: string) => { if (LOG) appendFileSync(LOG, `${s}\n`); };
if (LOG) writeFileSync(LOG, '');

/** WebGPU's DEFAULT per-stage limits (three requests no higher ones) and the GLSL ES 3.0 minimums (as tests/reactor-x-fog-webgpu-limits). */
const WEBGPU_DEFAULT = {uniformBuffers: 12, sampledTextures: 16, samplers: 16} as const;
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

function withinLimits(c: Compiled, backend: 'glsl' | 'wgsl', tag: string): Bindings {
  const f = bindings(c.fragment, backend), v = bindings(c.vertex, backend);
  log(`${tag}: fragment ${JSON.stringify(f)} vertex ${JSON.stringify(v)}`);
  for (const [stage, b] of [['fragment', f], ['vertex', v]] as const) {
    expect(b.uniformBuffers, `${tag} ${stage} uniform buffers`).toBeLessThanOrEqual(backend === 'wgsl' ? WEBGPU_DEFAULT.uniformBuffers : GLES3_MIN.uniformBlocks);
    expect(b.textures, `${tag} ${stage} sampled textures`).toBeLessThanOrEqual(backend === 'wgsl' ? WEBGPU_DEFAULT.sampledTextures : GLES3_MIN.textureUnits);
    expect(b.samplers, `${tag} ${stage} samplers`).toBeLessThanOrEqual(WEBGPU_DEFAULT.samplers);
  }
  return f;
}

/** The scene pass's depth texture as three makes it: on a render target, multisampled when the pass is (quality high: 4). */
function sceneDepth(msaa: number) {
  const rt = new RenderTarget(16, 9, {type: THREE.HalfFloatType, samples: msaa});
  rt.depthTexture = new THREE.DepthTexture(16, 9);
  return rt;
}
/** An AO target (RG16F, nearest, like AmbientOcclusionPass.ensureTargets). */
const aoTarget = () => new RenderTarget(8, 5, {type: THREE.HalfFloatType, format: THREE.RGFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false});

/** Every three warn() / error() during a compile fails the test (both route to the console). */
function quiet<T>(fn: () => T): T {
  const w = vi.spyOn(console, 'warn'), e = vi.spyOn(console, 'error');
  try {
    const r = fn();
    expect(w, 'three warnings').not.toHaveBeenCalled();
    expect(e, 'three errors').not.toHaveBeenCalled();
    return r;
  } finally { w.mockRestore(); e.mockRestore(); }
}
afterEach(() => vi.restoreAllMocks());

const dump = (tag: string, c: Compiled) => { if (LOG && process.env.AO_TSL_DUMP) log(`----- ${tag} fragment\n${c.fragment}`); };

describe('the AO programs compile on both backends with safe texture access only', () => {
  for (const backend of ['wgsl', 'glsl'] as const) for (const qn of ['high', 'low'] as const) for (const msaa of [0, 4]) {
    it(`raw: ${backend}, preset ${qn}, scene depth msaa ${msaa}`, () => {
      const q = AO_QUALITY[qn], rt = sceneDepth(msaa);
      const c = quiet(() => compileQuad(createAoRawMaterial(createFogUniforms(), createAoUniforms(), rt.depthTexture!, q), backend));
      dump(`raw ${backend} ${qn} msaa ${msaa}`, c);
      expect(c.fragment).toContain(AO_MARK.raw);
      const f = withinLimits(c, backend, `raw ${backend} ${qn} msaa ${msaa}`);
      expect(f.textures, 'one sampled texture: the scene depth').toBe(1);
      expect(f.uniformBuffers, 'plain uniforms only: one uniform buffer').toBeLessThanOrEqual(1);
      if (backend === 'wgsl') {
        const m = c.fragment.match(/var (\w+) : (texture_depth(?:_multisampled)?_2d);/);
        expect(m, 'the depth binding').not.toBe(null);
        expect(m![2]).toBe(msaa ? 'texture_depth_multisampled_2d' : 'texture_depth_2d');
        const name = m![1];
        // the pixel, the normal's four neighbours, and one load per side in the (not unrolled) step loop
        expect(c.fragment.split(`textureLoad( ${name},`).length - 1).toBe(1 + 4 + 2);
        expect(c.fragment).not.toMatch(new RegExp(`textureSample\\w*\\( ${name}\\b`));
        expect(c.fragment).not.toMatch(/textureGather|dpdx|dpdy|fwidth/);
        expect(f.samplers, 'no sampler at all (the depth is never filtered)').toBe(0);
        // compile-time trip counts: the slice loop and the step loop, literal bounds
        const loops = [...c.fragment.matchAll(/for \( (.*?) \)/g)].map(x => x[1]);
        expect(loops.length).toBe(2);
        expect(loops.some(l => new RegExp(`< ${q.slices}\\b`).test(l))).toBe(true);
        expect(loops.some(l => new RegExp(`< ${q.steps}\\b`).test(l))).toBe(true);
      } else {
        expect(c.fragment).not.toMatch(/textureGather|dFdx|dFdy|fwidth|\btexture\(/);
        expect(c.fragment).toMatch(/texelFetch\(/);
        const loops = [...c.fragment.matchAll(/for \( (.*?) \)/g)].map(x => x[1]);
        expect(loops.length).toBe(2);
        for (const l of loops) expect(l).toMatch(/< \d+;/);
      }
    });
  }

  for (const backend of ['wgsl', 'glsl'] as const) {
    it(`blur x / y: ${backend}`, () => {
      for (const axis of [0, 1] as const) {
        const c = quiet(() => compileQuad(createAoBlurMaterial(createAoUniforms(), aoTarget().texture, axis), backend));
        dump(`blur ${axis} ${backend}`, c);
        expect(c.fragment).toContain(AO_MARK.blur);
        const f = withinLimits(c, backend, `blur ${axis ? 'y' : 'x'} ${backend}`);
        expect(f.textures).toBe(1);
        if (backend === 'wgsl') {
          const name = c.fragment.match(/var (\w+) : texture_2d<f32>;/)![1];
          // the pixel, its two neighbours (the depth-plane gradient), the 7 taps — every one a textureLoad, nothing sampled / filtered
          expect(c.fragment.split(`textureLoad( ${name},`).length - 1).toBe(1 + 2 + AO_BLUR_TAPS.length);
          expect(c.fragment).not.toMatch(/textureSample|textureGather|dpdx|dpdy|fwidth|for \(/);
          expect(f.samplers).toBe(0);
        } else expect(c.fragment).not.toMatch(/textureGather|dFdx|dFdy|fwidth|\btexture\(/);
      }
    });
  }
});

describe('the fog composite with the AO lookup', () => {
  for (const backend of ['wgsl', 'glsl'] as const) {
    it(`${backend}: compiles for msaa 0 / 4; +1 sampled texture, +0 uniform buffers over the composite without AO; marks`, () => {
      for (const msaa of [0, 4]) {
        const u = createFogUniforms(), scene = sceneDepth(msaa);
        const fog = new RenderTarget(4, 4, {count: 2, type: THREE.HalfFloatType});
        const base = quiet(() => compileOutputNode(createCompositeNode(u, texture(scene.texture), texture(scene.depthTexture!), texture(fog.textures[0]), texture(fog.textures[1])), backend));
        const withAo = quiet(() => compileOutputNode(createCompositeNode(u, texture(scene.texture), texture(scene.depthTexture!), texture(fog.textures[0]), texture(fog.textures[1]),
          {u: createAoUniforms(), tex: texture(aoTarget().texture)}), backend));
        dump(`composite ${backend} msaa ${msaa}`, withAo);
        const b0 = withinLimits(base, backend, `composite (no AO) ${backend} msaa ${msaa}`);
        const b1 = withinLimits(withAo, backend, `composite + AO ${backend} msaa ${msaa}`);
        expect(b1.uniformBuffers, 'the AO uniforms join the existing uniform buffer').toBe(b0.uniformBuffers);
        expect(b1.textures, 'the AO target').toBe(b0.textures + 1);
        expect(withAo.fragment).toContain(VF_MARK.composite);
        for (const m of Object.values(AO_MARK)) expect(withAo.fragment, 'an AO failure must never be read as a fog failure').not.toContain(m);
        if (backend === 'wgsl') {
          expect(withAo.fragment).not.toMatch(/textureGather|dpdx|dpdy|fwidth/);
          const names = [...withAo.fragment.matchAll(/var (\w+) : texture_2d<f32>;/g)].map(x => x[1]);
          // every 2D float texture of the composite (scene colour, fog in-scatter / transmittance, AO) is loaded, never sampled
          for (const nme of names) expect(withAo.fragment).not.toMatch(new RegExp(`textureSample\\w*\\( ${nme}\\b`));
          expect(b1.samplers).toBe(b0.samplers);
        }
      }
    });
  }
});
