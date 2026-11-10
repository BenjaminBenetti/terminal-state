// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane AO; user: "add AO"): screen-space AMBIENT OCCLUSION inside the
// atmosphere's RenderPipeline (render/volumetric.ts), as our own TSL — one graph, WGSL on the WebGPU backend and GLSL on its WebGL 2
// fallback. render/ambientOcclusionMath.ts holds the presets, the look and the CPU MIRROR of every formula below (same pixel picks,
// rounding, noise, weights); its header describes the algorithm (GTAO, Jimenez et al. 2016, as in three's GTAONode).
//
// Frame (AO on): after the scene pass, before the composite (AoPassNode, a TempNode run once per frame like the fog pass):
//   raw     (low res, RG16F target A): per AO pixel the view position / normal from the scene DEPTH alone, SLICES x STEPS x 2 depth
//           samples -> the visible fraction (ao) and 1 / view depth (g; 0 = sky);
//   blur x  (A -> B) and blur y (B -> A): 7 taps each, depth-plane aware;
//   apply   (in the fog composite, render/volumetricShaders.ts createCompositeNode): a depth-aware 2x2 upsample of A, then the SCENE
//           colour x mix(1, ao ^ power, strength x bright guard) BEFORE the fog (in-scatter is never darkened).
// No temporal accumulation: no history, no ghost trails, nothing to reset on camera cuts, sections or journeys.
//
// Why not three's GTAONode as is: it samples the depth with filtering samplers and textureGather; our scene depth is MULTISAMPLED on
// quality high, and only constructs the fog shaders already run on the players' WebGPU are used here — depth read with textureLoad
// (`.load(ivec2)`), getViewPosition, compile-time loop counts, plain uniform() nodes (NO uniformArray: the binding budget, see
// render/volumetricShaders.ts), If / select, no derivatives. The scene pass is untouched (no MRT, no normal attachment): its render
// context — and every warmed pipeline of the station — stays exactly as it is.
//
// One program set, gated by uniforms: the composite always holds the AO lookup behind `aoOn`; with AO off the pass draws nothing,
// its two targets shrink to 1 x 1 (the composite's binding stays valid) and no AO program is ever built. Turning AO on builds only
// this pass's three small programs (raw, blur x, blur y), during the loading screen's warm-up frames when AO is on at load.
// Failure isolation: a rejected AO program (WebGPU: the validation error scope around its first frames; WebGL 2: the shader-error
// hook, AO_MARK) turns AO off — console error once, debug().ao.failed says why — and never fails the fog or the frame.
//
// NaN SAFETY (lead browser finding, WebGL 2 on llvmpipe: one close-up view of a flat wall drew the WHOLE frame black with AO on, no
// error). Every stage is bounded and treats anything that is not a valid value as "no data", never as darkness:
//  - raw: every division / normalize has a floor, a horizon sample is used only when it is a finite cosine, and the pixel's output is
//    a finite ao in [0, 1] (else 1) with a finite g in (0, G_MAX) (else 0 = no surface);
//  - blur: a tap counts only with a valid (ao, g); no valid tap (or a centre without a surface) = open, 1;
//  - composite: a texel counts only with a valid (ao, g) — a never-written / cleared texel (0, 0), NaN or Inf is NOT "the nearest
//    depth" any more (the previous fallback took its ao = 0: x (1 - strength) on every pixel = a black frame); none valid = 1; the
//    factor is finally clamped to [1 - strength, 1] (strength itself <= 1) with a NaN guard, so the scene colour is never multiplied by
//    NaN or by less than (1 - strength).
// Validity tests are comparisons (x >= lo && x <= hi), which are false for NaN on IEEE hardware.

import * as THREE from 'three';
import {NodeMaterial, NodeUpdateType, QuadMesh, RenderTarget, RendererUtils, TempNode, type PassNode, type WebGPURenderer} from 'three/webgpu';
import * as TSL from 'three/tsl';
import {passTexture} from 'three/tsl';
import {
  AO_BLUR_TAPS, AO_BLUR_WEIGHTS, AO_EDGE_ON, AO_LOOK, AO_MIN_STEP_PX, AO_QUALITY, aoCost, aoSize, aoTexelValid, type AoLook, type AoPreset,
} from './ambientOcclusionMath';
import type {FogUniforms} from './volumetricShaders';

// three's per-kind TSL typings reject most mixed chains (as in render/volumetricShaders.ts); the graphs are checked by compiling them
// for both backends in Node (tests/ambient-occlusion-tsl.test.ts).
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (x: unknown): N => x;
const {
  Fn, If, Loop, abs, acos, clamp, cos, cross, dot, exp, float, floor, getViewPosition, int, ivec2, length, max, min, pow,
  select, sin, smoothstep, sqrt, texture, textureSize, uniform, uv, vec2, vec3, vec4,
} = TSL as unknown as Record<string, N>;

/** Names of the TSL variables that mark the AO programs (shader-error attribution; the composite carries none of them). */
export const AO_MARK = {raw: 'vfAoRaw', blur: 'vfAoBlur'} as const;

/** `?ao=off|on` session override (QA), like `?fog=`: wins over the setting; null = none. */
export function aoOverrideFromUrl(search: string | undefined = (globalThis as {location?: Location}).location?.search): boolean | null {
  const v = search ? new URLSearchParams(search).get('ao') : null;
  return v === 'on' ? true : v === 'off' ? false : null;
}

/** The AO uniforms (plain uniform() nodes only: they share the stage's existing uniform buffer; set by AmbientOcclusionPass.sync). */
export function createAoUniforms() {
  // (named: the generated WGSL / GLSL reads aoOn / aoShape / ... — browser shader dumps and tests/ambient-occlusion-nan.test.ts)
  return {
    /** 1 = the composite applies the AO target (0: AO off / failed / not run: the lookup is skipped). */
    aoOn: uniform(0).setName('aoOn'),
    /** [world radius, screen clamp as a fraction of the height, thickness, camera projection[1][1]]. */
    aoShape: uniform(new THREE.Vector4(AO_LOOK.radius, AO_LOOK.maxRadiusFrac, AO_LOOK.thickness, 1)).setName('aoShape'),
    /** [distance fade start, end, blur depth sharpness, upsample depth sharpness]. */
    aoFilter: uniform(new THREE.Vector4(AO_LOOK.fade[0], AO_LOOK.fade[1], AO_LOOK.blurK, AO_LOOK.upsampleK)).setName('aoFilter'),
    /** [strength, power, bright guard start, end] (linear HDR luminance). */
    aoApply: uniform(new THREE.Vector4(AO_LOOK.strength, AO_LOOK.power, AO_LOOK.guard[0], AO_LOOK.guard[1])).setName('aoApply'),
    /** The AO targets' size in pixels. */
    aoSize: uniform(new THREE.Vector2(1, 1)).setName('aoSize'),
  };
}
export type AoUniforms = ReturnType<typeof createAoUniforms>;

/** textureSize as ivec2 on both backends (WGSL: vec2<u32> -> vec2<i32>; see render/volumetricShaders.ts texSize). */
const texSize = (t: N): N => ivec2(textureSize(t)).toVar();

const PI = Math.PI, HALF_PI = Math.PI / 2;
/** Largest 1 / view depth the AO targets hold (RG16F: finite up to 65504; the near plane 0.05 m gives 20). */
export const AO_G_MAX = 1e4;
/** x is a finite number within [lo, hi] (false for NaN / Inf: IEEE comparisons). */
const within = (x: N, lo: number, hi: number): N => n(x).greaterThanEqual(lo).and(n(x).lessThanEqual(hi));
/** A texel of an AO target holds data: ao in [0, 1] and a surface (0 < g <= AO_G_MAX). */
const validTexel = (s: N): N => within(n(s).r, 0, 1).and(n(s).g.greaterThan(0)).and(n(s).g.lessThanEqual(AO_G_MAX));

/**
 * The raw pass (mirror: ambientOcclusionMath.ts aoRawAt), rendered into the AO target: out = (ao, 1 / view depth, 0, 1); sky = (1, 0).
 * `depth` = the scene pass's depth texture (multisampled on quality high: read with textureLoad only).
 */
export function createAoRawMaterial(fu: FogUniforms, au: AoUniforms, depth: THREE.Texture, q: AoPreset): NodeMaterial {
  const S = Math.max(1, Math.round(q.slices)), J = Math.max(1, Math.round(q.steps));
  const depthT = texture(depth);
  const raw = Fn(() => {
    const fsize = n(texSize(depthT));
    const fs = vec2(fsize).toVar();
    const fmax = n(fs).sub(1).toVar();
    const ixy = floor(n(uv()).mul(au.aoSize)).toVar();
    const ix = n(ixy).x, iy = n(ixy).y;
    // the full-res pixel: a quarter in from a corner of its block, the corner alternating over every 2 x 2 AO pixels (aoPixel)
    const jx = select(n(ix).add(iy).mod(2).greaterThan(0.5), float(0.75), float(0.25));
    const jy = select(n(iy).mod(2).greaterThan(0.5), float(0.75), float(0.25));
    const c = clamp(floor(vec2(n(ix).add(jx), n(iy).add(jy)).mul(fs).div(au.aoSize)), vec2(0, 0), fmax).toVar();
    const uvOf = (p: N): N => n(p).add(0.5).div(fs);
    const inside = (p: N): N => n(p).x.greaterThanEqual(0).and(n(p).y.greaterThanEqual(0)).and(n(p).x.lessThanEqual(n(fmax).x)).and(n(p).y.lessThanEqual(n(fmax).y));
    const loadDepth = (p: N): N => n(depthT.load(ivec2(clamp(p, vec2(0, 0), fmax)))).r;
    const out = n(vec4(1, 0, 0, 1)).toVar(AO_MARK.raw);
    const d = n(loadDepth(c)).toVar();
    If(d.lessThan(1), () => {
      const P = n(getViewPosition(uvOf(c), d, fu.projInv)).toVar();
      const z = n(P).z.negate().toVar();
      const g = float(1).div(max(z, 1e-6)).toVar();
      const aoV = n(float(1)).toVar();
      If(z.lessThan(n(au.aoFilter).y), () => {
        const V = n(P).negate().div(max(length(P), 1e-6)).toVar();
        // the normal from neighbouring depths (aoNormal): per axis the neighbour whose 1 / z is closer to the pixel's, never the sky
        // while the other side is a surface, never outside the buffer
        const side = (dx: number, dy: number) => {
          const qp = n(c).add(vec2(dx, dy)).toVar();
          const qd = n(loadDepth(qp)).toVar();
          const Q = n(getViewPosition(uvOf(qp), qd, fu.projInv)).toVar();
          return {Q, ok: n(inside(qp)).and(qd.lessThan(1)), g: float(1).div(max(n(Q).z.negate(), 1e-6))};
        };
        const axisD = (m: ReturnType<typeof side>, p: ReturnType<typeof side>): N => {
          const minus = n(m.ok).and(n(p.ok).not().or(abs(n(m.g).sub(g)).lessThan(abs(n(p.g).sub(g)))));
          return select(n(minus).or(p.ok), select(minus, n(P).sub(m.Q), n(p.Q).sub(P)), vec3(0, 0, 0));
        };
        const cr = cross(axisD(side(-1, 0), side(1, 0)), axisD(side(0, -1), side(0, 1))).toVar();
        const cl = length(cr);
        const N0 = n(select(cl.greaterThan(1e-24), n(cr).div(max(cl, 1e-24)), V)).toVar();
        const Nn = n(select(dot(N0, V).lessThan(0), n(N0).negate(), N0)).toVar();
        const proj = n(fs).y.mul(0.5).mul(n(au.aoShape).w).toVar(); // full-res pixels per metre at view depth 1
        const R = max(min(n(au.aoShape).x, n(au.aoShape).y.mul(n(fs).y).mul(z).div(max(proj, 1e-6))), 1e-4).toVar();
        // slices evenly spaced AROUND THE VIEW VECTOR: e1 / e2 span the plane perpendicular to V
        const e0 = vec3(float(1).sub(n(V).x.mul(n(V).x)), n(V).y.mul(n(V).x).negate(), n(V).z.mul(n(V).x).negate()).toVar();
        const e1 = n(e0).div(max(length(e0), 1e-6)).toVar();
        const e2 = cross(V, e1).toVar();
        // the 4 x 4 pattern (aoNoise)
        const mx = n(ix).mod(4);
        const dirN = n(ix).add(iy).mod(4).mul(4).add(mx).div(16).toVar();
        const stepN = n(iy).add(n(mx).mul(3)).mod(4).add(0.5).div(4).toVar();
        const thick = n(au.aoShape).z;
        const vis = n(float(0)).toVar(), open = n(float(0)).toVar();
        Loop(S, ({i}: {i: N}) => {
          const psi = float(i).add(dirN).mul(PI / S).toVar();
          const T = n(e1).mul(cos(psi)).add(n(e2).mul(sin(psi))).toVar();
          const axis = cross(T, V).toVar();
          const wl = sqrt(max(float(1).sub(n(axis).z.mul(n(axis).z)), 1e-6)).toVar();
          const dirPx = vec2(n(axis).y.negate(), n(axis).x.negate()).div(wl).toVar(); // the slice's line on screen (+y down)
          const rPx = min(n(R).mul(proj).div(max(z, 1e-4)).mul(wl).div(max(n(V).z, 1e-4)), n(fs).y).toVar();
          const na = dot(Nn, axis);
          const pn = n(Nn).sub(n(axis).mul(na)).toVar();
          const pnLen = length(pn).toVar();
          const cosN = clamp(dot(pn, V).div(max(pnLen, 1e-5)), 0, 1).toVar();
          const nAng = n(select(dot(T, pn).greaterThanEqual(0), float(1), float(-1))).mul(acos(cosN)).toVar();
          const sinN = sin(nAng).toVar();
          // samples placed in the slice by their height over the tangent plane and their distance along it (see the mirror)
          const L = n(T).mul(cosN).sub(n(V).mul(sinN)).toVar();
          const B = cross(Nn, L).toVar();
          const kb = dot(pn, B).div(max(pnLen, 1e-5)).toVar();
          const sure = smoothstep(AO_EDGE_ON[0], AO_EDGE_ON[1], n(pnLen).mul(pnLen)).toVar();
          const hc = [n(sinN).negate().toVar(), n(sinN).toVar()];
          Loop({start: 0, end: J, type: 'int', name: 'j', condition: '<'}, ({j}: {j: N}) => {
            const t = float(j).add(stepN).div(J);
            const sPx = max(n(t).mul(t).mul(rPx), AO_MIN_STEP_PX);
            const o = floor(n(dirPx).mul(sPx).add(0.5)).toVar();
            for (let sd = 0; sd < 2; sd++) {
              const qp = sd ? n(c).sub(o).toVar() : n(c).add(o).toVar();
              const qd = n(loadDepth(qp)).toVar();
              const Sp = n(getViewPosition(uvOf(qp), qd, fu.projInv));
              const d0 = n(Sp).sub(P).toVar();
              const fr = min(length(d0).div(R), 1);
              const w = float(1).sub(n(fr).mul(fr)).mul(float(1).sub(smoothstep(n(thick).mul(0.5), thick, n(d0).z))).mul(sure);
              const up = dot(d0, Nn).div(max(pnLen, 1e-3)).toVar();
              const along = length(vec2(dot(d0, L), dot(d0, B).sub(n(up).mul(kb)))).toVar();
              const low = sd ? n(sinN) : n(sinN).negate();
              const h = n(low).add(n(low).mul(along).add(n(cosN).mul(up)).div(max(length(vec2(along, up)), 1e-6)).sub(low).mul(w));
              // off screen / sky: unknown, never an occluder; a horizon that is not a finite cosine (NaN guard) is ignored too
              const ok = n(inside(qp)).and(qd.lessThan(1)).and(within(h, -1.001, 1.001));
              hc[sd].assign(select(ok, max(hc[sd], h), hc[sd]));
            }
          });
          const h0 = n(nAng).add(clamp(acos(clamp(hc[1], -1, 1)).negate().sub(nAng), -HALF_PI, HALF_PI)).toVar();
          const h1 = n(nAng).add(clamp(acos(clamp(hc[0], -1, 1)).sub(nAng), -HALF_PI, HALF_PI)).toVar();
          vis.addAssign(n(pnLen).mul(n(cosN).mul(2).add(n(h0).add(h1).mul(2).mul(sinN)).sub(cos(n(h0).mul(2).sub(nAng))).sub(cos(n(h1).mul(2).sub(nAng)))).div(4));
          open.addAssign(n(pnLen).mul(n(cosN).add(n(nAng).mul(sinN))));
        });
        const visF = clamp(n(vis).div(max(open, 1e-4)), 0, 1);
        const fade = float(1).sub(smoothstep(n(au.aoFilter).x, n(au.aoFilter).y, z));
        aoV.assign(float(1).add(n(visF).sub(1).mul(fade)));
      });
      // NaN guard: a finite ao in [0, 1] (else open) and a finite g (else no surface)
      out.assign(vec4(select(within(aoV, 0, 1), aoV, float(1)), select(n(g).greaterThan(0).and(n(g).lessThanEqual(AO_G_MAX)), g, float(0)), 0, 1));
    });
    return out;
  });
  const mat = new NodeMaterial();
  mat.name = 'ambient-occlusion-raw';
  mat.fragmentNode = raw();
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.blending = THREE.NoBlending;
  return mat;
}

/**
 * One blur pass along `axis` (0 = x, 1 = y; mirror: aoBlurAt): `src` = the AO target read texel by texel; out = (blurred ao, g, 0, 1).
 */
export function createAoBlurMaterial(au: AoUniforms, src: THREE.Texture, axis: 0 | 1): NodeMaterial {
  const srcT = texture(src);
  const blur = Fn(() => {
    const size = n(texSize(srcT));
    const hi = n(size).sub(1).toVar();
    const p = ivec2(floor(n(uv()).mul(vec2(size)))).toVar();
    const cur = n(srcT.load(p)).toVar();
    const gc = n(cur).g.toVar();
    // no surface (sky, a never-written texel) or no valid g: open, no surface
    const out = n(vec4(1, 0, 0, 1)).toVar(AO_MARK.blur);
    If(gc.greaterThan(0).and(gc.lessThanEqual(AO_G_MAX)), () => {
      const c = axis ? n(p).y : n(p).x, lim = axis ? n(hi).y : n(hi).x;
      const at = (k: N): N => n(srcT.load(axis ? ivec2(n(p).x, k) : ivec2(k, n(p).y)));
      const a = n(gc).sub(n(at(clamp(n(c).sub(int(1)), int(0), lim))).g);
      const b = n(n(at(clamp(n(c).add(int(1)), int(0), lim))).g).sub(gc);
      const grad = n(select(n(c).greaterThanEqual(lim).or(n(c).greaterThan(0).and(abs(a).lessThan(abs(b)))), a, b)).toVar();
      const sum = n(float(0)).toVar(), ws = n(float(0)).toVar();
      AO_BLUR_TAPS.forEach((tap, k) => {
        const qc = clamp(n(c).add(int(tap)), int(0), lim).toVar();
        const s = n(at(qc)).toVar();
        const plane = n(gc).add(n(grad).mul(float(n(qc).sub(c))));
        const wt = n(select(validTexel(s), n(float(AO_BLUR_WEIGHTS[k])).mul(exp(abs(n(s).g.sub(plane)).div(gc).mul(n(au.aoFilter).z).negate())), float(0))).toVar();
        sum.addAssign(n(select(validTexel(s), n(s).r, float(0))).mul(wt));
        ws.addAssign(wt);
      });
      const avg = n(sum).div(max(ws, 1e-6)).toVar();
      out.assign(vec4(select(n(ws).greaterThan(1e-6).and(within(avg, 0, 1)), avg, float(1)), gc, 0, 1));
    });
    return out;
  });
  const mat = new NodeMaterial();
  mat.name = `ambient-occlusion-blur-${axis ? 'y' : 'x'}`;
  mat.fragmentNode = blur();
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.blending = THREE.NoBlending;
  return mat;
}

/** What the fog composite needs for the AO lookup (render/volumetricShaders.ts createCompositeNode). */
export interface AoComposite { u: AoUniforms; tex: N }

/**
 * The composite's AO block (mirror: aoUpsampleAt + aoFactor): the scene colour `rgb` (linear HDR) x mix(1, ao ^ power, strength x
 * bright guard), the AO target upsampled depth-aware at the full-res pixel `uvN` of device depth `d` / view depth `z`. Behind the
 * `aoOn` gate (off: one uniform branch); the sky (d >= 1) keeps its colour.
 */
export function applyAmbientOcclusion(ao: AoComposite, rgb: N, d: N, z: N, uvN: N): N {
  const au = ao.u, aoT = ao.tex;
  const f = n(float(1)).toVar();
  If(n(au.aoOn).greaterThan(0.5).and(n(d).lessThan(1)), () => {
    const bsize = n(texSize(aoT));
    const bhi = n(bsize).sub(1);
    const g = float(1).div(max(z, 1e-6)).toVar();
    const lp = n(uvN).mul(vec2(bsize)).sub(0.5).toVar();
    const lb = floor(lp).toVar();
    const fr = n(lp).sub(lb).toVar();
    const acc = n(float(0)).toVar(), ws = n(float(0)).toVar(), best = n(float(1)).toVar(), bestD = n(float(1e9)).toVar();
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const q = clamp(ivec2(int(n(lb).x).add(i), int(n(lb).y).add(j)), ivec2(0, 0), bhi);
      const s = n(n(aoT).load(q)).toVar();
      const wb = n(i ? n(fr).x : float(1).sub(n(fr).x)).mul(j ? n(fr).y : float(1).sub(n(fr).y));
      // a texel without data (never written / cleared: (0, 0); no surface; NaN / Inf) never counts — neither in the weights nor as
      // the "nearest depth" fallback (that fallback took a cleared texel's ao = 0 before: the whole frame at 1 - strength)
      const ok = validTexel(s).toVar();
      const dz = abs(n(s).g.sub(g)).div(g).toVar();
      const wt = n(select(ok, max(wb, 1e-3).mul(exp(n(dz).mul(n(au.aoFilter).w).negate())), float(0))).toVar();
      acc.addAssign(n(select(ok, n(s).r, float(0))).mul(wt));
      ws.addAssign(wt);
      If(n(ok).and(dz.lessThan(bestD)), () => { bestD.assign(dz); best.assign(n(s).r); });
    }
    const a0 = n(select(n(ws).greaterThan(1e-4), n(acc).div(max(ws, 1e-4)), best)).toVar();
    const aoV = clamp(select(within(a0, 0, 1), a0, float(1)), 1e-4, 1);
    const lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    const k = n(au.aoApply).x.mul(float(1).sub(smoothstep(n(au.aoApply).z, n(au.aoApply).w, lum)));
    const f0 = float(1).add(pow(aoV, n(au.aoApply).y).sub(1).mul(k)).toVar();
    // bounded and NaN-proof: never below 1 - strength, never above 1, never NaN
    const floorF = float(1).sub(n(au.aoApply).x);
    f.assign(select(within(f0, 0, 1), max(f0, floorF), float(1)));
  });
  return n(rgb).mul(f);
}

/** The per-frame AO pass inside the RenderPipeline: runs after the scene pass (it forces that order), once per frame. */
export class AoPassNode extends TempNode {
  static get type(): string { return 'AoPassNode'; }
  readonly tex: ReturnType<typeof passTexture>;
  constructor(private readonly run: (renderer: WebGPURenderer) => void, private readonly scenePass: PassNode, t: THREE.Texture) {
    super('vec4');
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.tex = passTexture(this as never, t);
  }
  updateBefore(frame: unknown): boolean | undefined {
    const f = frame as {renderer: WebGPURenderer; updateBeforeNode(n: unknown): void};
    f.updateBeforeNode(this.scenePass); // the scene depth of THIS frame first; no-op when already done
    this.run(f.renderer);
    return undefined;
  }
  setup(): never {
    return this.tex as never;
  }
}

interface WebGPUDeviceLike { pushErrorScope(f: string): void; popErrorScope(): Promise<{message: string} | null> }

let aoRendererState: unknown;

/** debug().ao of the atmosphere (QA readout: what the player's setting asked for, what runs, why not). */
export interface AoDebug {
  /** The setting (Settings -> Ambient occlusion) and the ?ao= override (null = none). */
  setting: boolean;
  override: boolean | null;
  /** The pass runs this frame (the atmosphere pipeline is active, AO wanted, not failed). */
  active: boolean;
  /** Why AO is not running (null while it runs). */
  reason: string | null;
  failed: string | null;
  /** AO target size (1 x 1 while off) and the preset used. */
  size: [number, number];
  preset: AoPreset | null;
  /** Pass runs (frames) and AO program builds. */
  passes: {ao: number; builds: number};
  look: AoLook;
  /** Texture loads per frame at the current size (docs/ambient-occlusion.md: arithmetic, not a GPU time). */
  loads: number;
}

/**
 * The AO pass's state, targets and programs (owned by VolumetricAtmosphere: render/volumetric.ts creates the pass node with its
 * pipeline, sizes the targets with its drawing buffer, runs it from the node and syncs the uniforms each frame).
 */
export class AmbientOcclusionPass {
  readonly u: AoUniforms = createAoUniforms();
  /** The look (uniform values; QA may edit it live). */
  readonly look: AoLook = {...AO_LOOK, fade: [...AO_LOOK.fade] as [number, number], guard: [...AO_LOOK.guard] as [number, number]};
  /** The player's setting (ui/settingsStore.ts ambientOcclusion; default on). */
  enabled = true;
  /** `?ao=on|off` (QA): wins over the setting. */
  override: boolean | null = aoOverrideFromUrl();
  /** Why the AO programs were rejected (AO stays off; the fog and the frame continue). */
  failed: string | null = null;
  private rtA: RenderTarget | null = null;
  private rtB: RenderTarget | null = null;
  private rawMat: NodeMaterial | null = null;
  private rawKey = '';
  private blurX: NodeMaterial | null = null;
  private blurY: NodeMaterial | null = null;
  private readonly quad = new QuadMesh(new NodeMaterial());
  private size: [number, number] = [1, 1];
  private full: [number, number] = [1, 1];
  private quality: 'low' | 'high' | null = null;
  private errorChecks = 0;
  private runs = 0;
  private builds = 0;
  /** True while the last frame applied AO (sync). */
  private on = false;

  /** AO is asked for (the override, else the setting) and has not failed. */
  get wanted(): boolean {
    return (this.override ?? this.enabled) && !this.failed;
  }

  /** The preset of a quality ('off' / null: none). */
  presetFor(q: string | null): AoPreset | null {
    return q === 'low' || q === 'high' ? AO_QUALITY[q] : null;
  }

  /** Size the targets for a drawing buffer + quality; 1 x 1 while AO is off (the composite's binding stays valid, ~no memory). */
  resize(full: readonly [number, number], quality: string | null, on: boolean): void {
    const p = this.presetFor(quality);
    this.quality = p ? quality as 'low' | 'high' : null;
    this.full = [full[0], full[1]];
    this.size = on && p ? aoSize(full[0], full[1], p) : [1, 1];
    this.u.aoSize.value.set(this.size[0], this.size[1]);
    this.rtA?.setSize(this.size[0], this.size[1]);
    this.rtB?.setSize(this.size[0], this.size[1]);
  }

  /** The two RG16F ping-pong targets (raw -> A, blur x A -> B, blur y B -> A: the composite reads A). */
  ensureTargets(): void {
    const make = (name: string) => {
      const rt = new RenderTarget(this.size[0], this.size[1], {
        type: THREE.HalfFloatType, format: THREE.RGFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, stencilBuffer: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
      });
      rt.texture.name = name;
      return rt;
    };
    this.rtA ??= make('ambient-occlusion-a');
    this.rtB ??= make('ambient-occlusion-b');
  }

  /** The pipeline's AO pass node (its texture node is the composite's AO input: target A). */
  passNode(scenePass: PassNode, run: (renderer: WebGPURenderer) => void): AoPassNode {
    this.ensureTargets();
    return new AoPassNode(run, scenePass, this.rtA!.texture);
  }

  /** Per-frame uniforms: the gate, the camera's projection (FOV / ADS / aspect need nothing else), the look. */
  sync(camera: THREE.PerspectiveCamera, on: boolean): void {
    this.on = on && !this.failed;
    const u = this.u, l = this.look;
    u.aoOn.value = this.on ? 1 : 0;
    // (bounded: a QA edit of the look can never make a shader divide by zero, pow a negative or darken past black)
    const fin = (v: number, d: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const p11 = camera.projectionMatrix.elements[5];
    u.aoShape.value.set(fin(l.radius, AO_LOOK.radius, 1e-3, 10), fin(l.maxRadiusFrac, AO_LOOK.maxRadiusFrac, 1e-3, 1), fin(l.thickness, AO_LOOK.thickness, 1e-3, 10),
      Number.isFinite(p11) && p11 > 0 ? p11 : 1);
    const f0 = fin(l.fade[0], AO_LOOK.fade[0], 0, 1e4);
    u.aoFilter.value.set(f0, Math.max(fin(l.fade[1], AO_LOOK.fade[1], 0, 1e4), f0 + 1e-3), fin(l.blurK, AO_LOOK.blurK, 0, 1e3), fin(l.upsampleK, AO_LOOK.upsampleK, 0, 1e3));
    const g0 = fin(l.guard[0], AO_LOOK.guard[0], 0, 1e4);
    u.aoApply.value.set(fin(l.strength, AO_LOOK.strength, 0, 1), fin(l.power, AO_LOOK.power, 0.1, 8), g0, Math.max(fin(l.guard[1], AO_LOOK.guard[1], 0, 1e4), g0 + 1e-3));
  }

  /**
   * The pass body (AoPassNode.updateBefore, after this frame's scene pass): raw -> A, blur x -> B, blur y -> A. Nothing while AO is
   * off. The first frames after a program (re)build run inside a WebGPU validation error scope: a rejection turns AO off; so does
   * anything thrown while building or drawing them (caught here: the composite still draws this frame, without AO).
   */
  run(renderer: WebGPURenderer, fu: FogUniforms, depth: THREE.Texture | null): void {
    if (!this.on || this.failed || !this.rtA || !this.rtB || !depth || !this.quality) return;
    const device = (renderer.backend as unknown as {device?: WebGPUDeviceLike}).device;
    let scoped = false, saved = false;
    try {
      const q = AO_QUALITY[this.quality];
      const key = `${depth.id}|${q.slices}x${q.steps}`;
      if (!this.rawMat || this.rawKey !== key) {
        this.rawMat?.dispose();
        this.rawMat = null;
        this.rawMat = createAoRawMaterial(fu, this.u, depth, q);
        this.rawKey = key;
        this.builds++;
        this.errorChecks = 3;
      }
      if (!this.blurX || !this.blurY) {
        this.blurX = createAoBlurMaterial(this.u, this.rtA.texture, 0);
        this.blurY = createAoBlurMaterial(this.u, this.rtB.texture, 1);
        this.builds += 2;
        this.errorChecks = 3;
      }
      aoRendererState = RendererUtils.resetRendererState(renderer, aoRendererState as never);
      saved = true;
      scoped = !!device && this.errorChecks > 0;
      if (scoped) device!.pushErrorScope('validation');
      for (const [mat, dst] of [[this.rawMat, this.rtA], [this.blurX, this.rtB], [this.blurY, this.rtA]] as const) {
        renderer.setRenderTarget(dst);
        this.quad.material = mat;
        this.quad.render(renderer);
      }
      this.runs++;
    } catch (err) {
      this.fail(`ambient occlusion pass failed: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
    } finally {
      if (saved) RendererUtils.restoreRendererState(renderer, aoRendererState as never);
      if (scoped) {
        this.errorChecks--;
        device!.popErrorScope().then(err => { if (err) this.fail(`ambient occlusion pass rejected by WebGPU: ${err.message.slice(0, 300)}`); }).catch(() => {});
      }
    }
  }

  /** AO off for good (this session): the composite's gate closes at once; the fog and the frame are untouched. */
  fail(reason: string): void {
    if (this.failed) return;
    this.failed = reason;
    this.on = false;
    this.u.aoOn.value = 0;
    console.error(reason);
  }

  /**
   * QA (browser checks of a suspicious view): read the two AO targets back and summarise them — texels, NaN, texels without data
   * (aoTexelValid false), open sky / no-surface texels, and the valid ao's min / mean. A = what the composite reads (raw, then blur y),
   * B = blur x. Null while AO is off or not yet run. Not used by the game.
   */
  async probe(renderer: WebGPURenderer): Promise<Record<'A' | 'B', {size: [number, number]; texels: number; nan: number; invalid: number; noSurface: number; min: number; mean: number}> | null> {
    if (!this.on || !this.rtA || !this.rtB) return null;
    const one = async (rt: RenderTarget) => {
      const [w, h] = [rt.width, rt.height];
      const raw = await (renderer as unknown as {readRenderTargetPixelsAsync(t: RenderTarget, x: number, y: number, w: number, h: number): Promise<ArrayLike<number>>})
        .readRenderTargetPixelsAsync(rt, 0, 0, w, h);
      const half = raw instanceof Uint16Array, stride = Math.max(1, Math.round(raw.length / (w * h)));
      const val = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(raw[i]) : raw[i]);
      let nan = 0, invalid = 0, noSurface = 0, min = 1, sum = 0, n = 0;
      for (let t = 0; t < w * h; t++) {
        const ao = val(t * stride), g = val(t * stride + 1);
        if (Number.isNaN(ao) || Number.isNaN(g)) nan++;
        if (g === 0 && ao === 1) noSurface++;
        else if (!aoTexelValid(ao, g)) invalid++;
        else { min = Math.min(min, ao); sum += ao; n++; }
      }
      return {size: [w, h] as [number, number], texels: w * h, nan, invalid, noSurface, min: Math.round(min * 1e4) / 1e4, mean: n ? Math.round(sum / n * 1e4) / 1e4 : 1};
    };
    return {A: await one(this.rtA), B: await one(this.rtB)};
  }

  /** Release the targets and programs (recreated on demand). */
  drop(): void {
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.rtA = this.rtB = null;
    this.rawMat?.dispose();
    this.blurX?.dispose();
    this.blurY?.dispose();
    this.rawMat = this.blurX = this.blurY = null;
    this.rawKey = '';
  }

  debug(pipelineActive: boolean, why: string | null): AoDebug {
    const p = this.presetFor(this.quality);
    const reason = this.failed ? 'failed' : !(this.override ?? this.enabled) ? (this.override === false ? 'off (?ao=off)' : 'off in the settings')
      : !pipelineActive ? (why ?? 'the atmosphere pass is not active') : null;
    const loads = this.on && pipelineActive && p ? aoCost(this.full[0], this.full[1], p).total : 0;
    return {
      setting: this.enabled, override: this.override, active: this.on && pipelineActive, reason, failed: this.failed,
      size: [this.size[0], this.size[1]], preset: p, passes: {ao: this.runs, builds: this.builds},
      look: {...this.look, fade: [...this.look.fade] as [number, number], guard: [...this.look.guard] as [number, number]}, loads,
    };
  }
}
