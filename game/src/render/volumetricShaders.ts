// Iteration 13 (FOG): the volumetric atmosphere as TSL node graphs for three r186's WebGPURenderer (WGSL on the WebGPU
// backend, GLSL ES 3.0 on its WebGL2 fallback — one graph, both backends). Replaces the iteration-06..12 GLSL strings.
// render/volumetric.ts owns the passes; render/atmosphere.ts holds the CPU mirror of every formula.
//
//  march     (half / quarter res, MRT): per pixel, the visible surface from the scene pass depth (checkerboard of the
//            nearest / farthest full-res depth of its block), then a bounded, jittered, quadratically spaced march in FRONT
//            of it through the world-anchored medium (density map x height x moving patch / wisp noise + ground layer,
//            smoke puffs), single in-scattering from the flashlight cone (shadow-mapped), the baked fixture light field
//            (world/lightFieldNode.ts), the muzzle flash and the scatter lights (flares, occlusion-windowed); extinction of
//            dense patches and smoke. out0 = in-scatter rgb + view depth of the surface, out1.r = volumetric transmittance.
//  temporal  (same res, MRT): reprojects each pixel's surface into the previous frame, clamps the history to the current
//            3x3 neighbourhood and rejects it on depth mismatch (no ghosting, no lingering), blends.
//  composite (full res, the RenderPipeline output): depth-aware (bilateral) upsample, then scene x transmittance +
//            in-scatter in LINEAR HDR; the pipeline's output transform tone-maps (ACES, renderer exposure) + sRGB once.
//
// WGSL uniformity: textureSampleCompare (the flashlight shadow) needs uniform control flow, so the march loop has a
// compile-time trip count, no per-pixel break, and the shadow compare runs unconditionally at the top of each step; every
// other lookup is textureSampleLevel / textureLoad (fine in per-pixel branches).

import * as THREE from 'three';
import {NodeMaterial, type Node} from 'three/webgpu';
import * as TSL from 'three/tsl';
import {lfSlotAt, lightFieldSample} from '../world/lightFieldNode';
import {BILATERAL_K, DENSITY_MAP_RANGE} from './atmosphere';
import {SMOKE_LIMITS, VIS_WINDOWS} from './smoke';

/** Uniform array sizes (render/smoke.ts SMOKE_LIMITS). */
export const VF_LIMITS = {smoke: SMOKE_LIMITS.emitters, puffsPer: SMOKE_LIMITS.puffsPerEmitter, puffs: SMOKE_LIMITS.emitters * SMOKE_LIMITS.puffsPerEmitter, scatter: SMOKE_LIMITS.scatterLights, windows: VIS_WINDOWS} as const;

/** Names of the TSL variables that mark our programs (shader-error attribution in the generated GLSL / WGSL). */
export const VF_MARK = {march: 'vfMarchAcc', temporal: 'vfTemporalOut', composite: 'vfCompositeFog'} as const;

// three's per-kind TSL typings reject most mixed chains; the graphs are checked by compiling them for both backends in
// Node (tests/fog-tsl.test.ts) and in the browser.
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (x: unknown): N => x;
const {
  Fn, If, Loop, clamp, dot, exp, float, floor, getScreenPosition, getViewPosition, int, interleavedGradientNoise, ivec2, length,
  max, min, mix, outputStruct, pow, property, screenCoordinate, select, smoothstep, sqrt, texture, texture3D, textureSize,
  uniform, uniformArray, uv, vec2, vec3, vec4,
} = TSL as unknown as Record<string, N>;

const V2 = () => new THREE.Vector2(1, 1), V3 = () => new THREE.Vector3(), V4 = () => new THREE.Vector4(), M4 = () => new THREE.Matrix4();
const arr4 = (k: number) => Array.from({length: k}, V4);

/** Every uniform of the three passes (values set per frame by VolumetricAtmosphere.sync; plain objects, no GPU). */
export function createFogUniforms() {
  return {
    // camera / frame
    fullSize: uniform(V2()), lowSize: uniform(V2()),
    projInv: uniform(M4()), camWorld: uniform(M4()), camPos: uniform(V3()),
    near: uniform(0.05), far: uniform(70), maxDist: uniform(36), frame: uniform(0), fogDensity: uniform(0), nearFade: uniform(V2()),
    // medium
    density: uniform(0), heightFalloff: uniform(0.32), refHeight: uniform(1.6), noiseAmount: uniform(1),
    scaleP: uniform(V3()), scaleD: uniform(V3()), offAir: uniform(V3()), offTrack: uniform(V3()), offDet: uniform(V3()),
    cover: uniform(V4()), peak: uniform(2.3), pocketDense: uniform(0.55), detail: uniform(0.4), ground: uniform(V3()), warp: uniform(2),
    ext: uniform(V3()), phase: uniform(V3()),
    mapXform: uniform(new THREE.Vector4(0, 0, 1, 1)), mapFloor: uniform(new THREE.Vector2(0, 1)), mapSlots: uniform(1),
    // flashlight
    flashPos: uniform(V3()), flashDir: uniform(new THREE.Vector3(0, 0, -1)), flashCone: uniform(new THREE.Vector2(1, 1)),
    flashColor: uniform(V3()), flashRange: uniform(new THREE.Vector2(30, 1.2)), shadowMatrix: uniform(M4()), shadowBias: uniform(0), shadowOn: uniform(0),
    // fixtures (light field), muzzle
    fieldGain: uniform(0),
    muzzlePos: uniform(V3()), muzzleColor: uniform(V3()), muzzleRange: uniform(new THREE.Vector2(8, 2)),
    // occlusion windows, scatter lights (flares), smoke
    win: uniformArray(arr4(VF_LIMITS.windows), 'vec4'), winY: uniformArray(arr4(VF_LIMITS.windows), 'vec4'),
    scatCount: uniform(0, 'int'), scatPos: uniformArray(arr4(VF_LIMITS.scatter), 'vec4'), scatCol: uniformArray(arr4(VF_LIMITS.scatter), 'vec4'),
    smokeCount: uniform(0, 'int'), smokeBound: uniformArray(arr4(VF_LIMITS.smoke), 'vec4'), smokeTint: uniformArray(arr4(VF_LIMITS.smoke), 'vec4'),
    puff: uniformArray(arr4(VF_LIMITS.puffs), 'vec4'), puffD: uniformArray(new Array<number>(VF_LIMITS.puffs).fill(0), 'float'),
    // temporal
    prevView: uniform(M4()), prevProj: uniform(M4()), historyValid: uniform(0), blend: uniform(0.85),
    // composite
    intensity: uniform(1),
  };
}
export type FogUniforms = ReturnType<typeof createFogUniforms>;

/** Data textures the march reads (render/volumetric.ts owns and binds them). */
export interface FogTextures {
  /** Full-res scene depth (the scene pass's DepthTexture). */
  depth: THREE.Texture;
  noise: THREE.Data3DTexture;
  density: THREE.DataArrayTexture;
  air: THREE.DataArrayTexture;
  vis: THREE.DataArrayTexture;
  /** The flashlight's shadow depth texture (compare sampler), or null: no shadow term compiled. */
  shadow: THREE.Texture | null;
}

// ---------------------------------------------------------------------------------------------
// Shared helpers (TSL mirrors of render/atmosphere.ts)

const PI4 = 4 * Math.PI;
/** Henyey-Greenstein. */
const hg = (c: N, g: N): N => float(1).sub(n(g).mul(g)).div(float(PI4).mul(pow(max(float(1).add(n(g).mul(g)).sub(n(g).mul(2).mul(c)), 1e-4), 1.5)));
/** Dual-lobe phase: forward lobe ph.x, backward lobe ph.y, backward weight ph.z. */
const phaseOf = (u: FogUniforms, c: N): N => mix(hg(c, n(u.phase).x), hg(c, n(u.phase).y), n(u.phase).z);
/** three's getDistanceAttenuation. */
const distAtt = (d: N, cutoff: N, decay: N): N => {
  const a = float(1).div(max(pow(max(d, 1e-4), decay), 0.01));
  const q = n(d).div(max(cutoff, 1e-4)).toVar();
  const q2 = q.mul(q);
  const w = clamp(float(1).sub(q2.mul(q2)), 0, 1);
  return select(n(cutoff).greaterThan(0), n(a).mul(w.mul(w)), a);
};

// ---------------------------------------------------------------------------------------------
// March

export interface MarchOptions {
  steps: number;
}

/**
 * The march material (two outputs). Rebuilt when the step count or the shadow texture changes (quality change, the
 * flashlight's shadow map appearing).
 */
export function createMarchMaterial(u: FogUniforms, tex: FogTextures, o: MarchOptions): NodeMaterial {
  const STEPS = Math.max(1, Math.round(o.steps));
  const depthT = texture(tex.depth);
  const noiseT = texture3D(tex.noise);
  const densT = texture(tex.density);
  const airT = texture(tex.air);
  const visT = texture(tex.vis);
  const shadowT = tex.shadow ? texture(tex.shadow) : null;
  const out0 = property('vec4'), out1 = property('vec4');

  // occlusion window w (render/smoke.ts): 2D line of sight on the source's storey grid, faded above / below its band
  const windowAt = (p: N, w: N): N => {
    const wn = n(u.win).element(w).toVar();
    const wy = n(u.winY).element(w);
    const wuv = n(p).xz.sub(wn.xy).mul(wn.z).toVar();
    const inside = wuv.x.greaterThanEqual(0).and(wuv.y.greaterThanEqual(0)).and(wuv.x.lessThanEqual(1)).and(wuv.y.lessThanEqual(1));
    const band = smoothstep(n(wy).x.sub(0.35), n(wy).x.add(0.05), n(p).y).mul(float(1).sub(smoothstep(n(wy).y.sub(0.05), n(wy).y.add(0.35), n(p).y)));
    const v = n(visT.sample(clamp(wuv, 0, 1)).depth(int(max(wn.w, 0))).level(0)).r;
    return select(wn.w.lessThan(0), float(1), select(inside, n(v).mul(band), float(0)));
  };

  const march = Fn(() => {
    const uvN = n(uv());
    const lowTexel = floor(uvN.mul(u.lowSize)).toVar();
    // depth of this low-res pixel: checkerboard of the nearest / farthest of its full-res block corners
    const ratio = n(u.fullSize).div(u.lowSize);
    const fmax = n(u.fullSize).sub(1);
    const b0 = clamp(floor(lowTexel.mul(ratio)), vec2(0, 0), fmax).toVar();
    const b1 = clamp(floor(lowTexel.add(1).mul(ratio)).sub(1), b0, fmax).toVar();
    const d00 = n(depthT.load(ivec2(int(b0.x), int(b0.y)))).r;
    const d10 = n(depthT.load(ivec2(int(b1.x), int(b0.y)))).r;
    const d01 = n(depthT.load(ivec2(int(b0.x), int(b1.y)))).r;
    const d11 = n(depthT.load(ivec2(int(b1.x), int(b1.y)))).r;
    const dmin = min(min(d00, d10), min(d01, d11)), dmax = max(max(d00, d10), max(d01, d11));
    const checker = lowTexel.x.add(lowTexel.y).mod(2);
    const depth = n(select(checker.lessThan(0.5), dmin, dmax)).toVar();
    const uvC = lowTexel.add(0.5).div(u.lowSize);
    const viewPos = n(getViewPosition(uvC, depth, u.projInv)).toVar();
    const viewDepth = n(viewPos.z).negate().toVar();
    const world = n(u.camWorld).mul(vec4(viewPos, 1)).xyz;
    const toS = world.sub(u.camPos).toVar();
    const sceneDist = length(toS).toVar();
    const dir = toS.div(max(sceneDist, 1e-4)).toVar();
    const dist = min(sceneDist, u.maxDist).toVar();
    const jit = n(interleavedGradientNoise(n(screenCoordinate).xy.add(n(u.frame).mod(64).mul(5.588238)))).toVar();
    const acc = n(vec3(0, 0, 0)).toVar(VF_MARK.march);
    const tv = n(float(1)).toVar('vfTrans');
    const flashOn = n(u.flashColor).x.add(n(u.flashColor).y).add(n(u.flashColor).z).greaterThan(0);
    const muzzleOn = n(u.muzzleColor).x.add(n(u.muzzleColor).y).add(n(u.muzzleColor).z).greaterThan(0);
    const sc = {p: n(u.scaleP), d: n(u.scaleD)};

    Loop(STEPS, ({i}: {i: N}) => {
      const uu = float(i).add(jit).div(STEPS).toVar();
      const t = n(dist).mul(uu).mul(uu).toVar();
      const w = n(dist).mul(uu).mul(2 / STEPS).toVar();
      const p = n(u.camPos).add(n(dir).mul(t)).toVar();
      // flashlight shadow FIRST, unconditionally (uniform control flow for textureSampleCompare)
      let shadow: N = float(1);
      if (shadowT) {
        const s4 = n(u.shadowMatrix).mul(vec4(p, 1)).toVar();
        const sw = max(s4.w, 1e-5);
        const c = s4.xyz.div(sw).toVar();
        const suv = vec2(c.x, c.y.oneMinus());
        // assigned to a var at the top of the step: a sample inside select()'s branch would be non-uniform control flow
        const cmp = n(shadowT.sample(clamp(suv, 0, 1)).compare(c.z.add(u.shadowBias))).r.toVar('vfShadowCmp');
        const inFr = s4.w.greaterThan(1e-5).and(c.x.greaterThanEqual(0)).and(c.x.lessThanEqual(1)).and(c.y.greaterThanEqual(0)).and(c.y.lessThanEqual(1)).and(c.z.greaterThanEqual(0)).and(c.z.lessThanEqual(1));
        shadow = n(select(inFr.and(n(u.shadowOn).greaterThan(0.5)), cmp, float(1))).toVar();
      }
      // --- the medium (render/atmosphere.ts mediumAt) ---
      const slot = n(lfSlotAt(p)).toVar();
      const layer = int(min(slot, n(u.mapSlots).sub(1)));
      const muv = n(p).xz.sub(n(u.mapXform).xy).mul(n(u.mapXform).zw).toVar();
      const m = n(densT.sample(muv).depth(layer).level(0)).toVar();
      const mult = m.r.mul(DENSITY_MAP_RANGE).toVar();
      const h = n(p).y.sub(n(u.mapFloor).x.add(m.g.mul(n(u.mapFloor).y))).toVar();
      const hf = clamp(exp(n(u.heightFalloff).negate().mul(h.sub(u.refHeight))), 0.25, 2.5);
      const base0 = n(u.density).mul(mult).toVar();
      const D = n(noiseT.sample(n(p).mul(sc.d).add(u.offDet)).level(0)).toVar();
      const wk = n(u.warp).mul(u.noiseAmount).mul(2);
      const wp = n(p).add(vec3(D.b.sub(0.5).mul(wk), D.r.sub(0.5).mul(wk).mul(0.3), D.a.sub(0.5).mul(wk))).toVar();
      const nAir = n(noiseT.sample(wp.mul(sc.p).add(u.offAir)).level(0)).r;
      const wt = n(airT.sample(muv).depth(layer).level(0)).r.toVar();
      const nPatch = n(nAir).toVar();
      If(wt.greaterThan(0.002), () => {
        const nTrk = n(noiseT.sample(wp.mul(sc.p).add(u.offTrack)).level(0)).r;
        nPatch.assign(mix(nPatch, nTrk, wt));
      });
      const cv = n(u.cover);
      const cover = clamp(cv.x.add(cv.y.mul(mult.sub(1))), 0.03, 0.7).toVar();
      const dense = smoothstep(float(1).sub(cover).sub(cv.z), float(1).sub(cover).add(cv.z), nPatch).toVar();
      const amt = n(u.noiseAmount);
      const pocket = n(cv.w).add(n(u.pocketDense).sub(cv.w).mul(smoothstep(1, 1.6, mult))).toVar();
      const patchF = float(1).add(amt.mul(pocket.add(n(u.peak).sub(pocket).mul(dense)).sub(1)));
      const detailF = float(1).add(amt.mul(u.detail).mul(D.g.sub(0.5)).mul(2));
      const gr = n(u.ground);
      const gh = gr.y.mul(float(1).add(gr.z.mul(D.g.sub(0.5)).mul(2)));
      const groundT = gr.x.mul(mult).mul(exp(max(h, 0).negate().div(max(gh, 0.05)))).mul(float(1).add(amt.mul(dense.mul(1.2).sub(0.7))));
      const sigma = base0.mul(n(hf).mul(patchF).mul(detailF).add(groundT)).toVar();
      const excess = max(sigma.sub(base0.mul(hf)), 0).toVar();
      // --- smoke puffs (tinted scattering, own extinction), gated by their emitter's occlusion window ---
      const smokeTint = n(vec3(0, 0, 0)).toVar();
      const smokeSig = n(float(0)).toVar();
      Loop({start: 0, end: VF_LIMITS.smoke, type: 'int', condition: '<', name: 'k'}, ({k}: {k: N}) => {
        If(k.lessThan(u.smokeCount), () => {
          // the ray interval of the emitter's bounding sphere: puffs are only evaluated inside it
          const sb = n(u.smokeBound).element(k).toVar();
          const oc = n(u.camPos).sub(sb.xyz).toVar();
          const bq = dot(oc, dir).toVar();
          const disc = bq.mul(bq).sub(dot(oc, oc).sub(sb.w.mul(sb.w))).toVar();
          const sq = sqrt(max(disc, 0));
          If(disc.greaterThan(0).and(t.greaterThanEqual(n(bq).negate().sub(sq))).and(t.lessThanEqual(n(bq).negate().add(sq))), () => {
            const st = n(u.smokeTint).element(k).toVar();
            const np = int(st.w);
            const s = n(float(0)).toVar();
            Loop({start: 0, end: VF_LIMITS.puffsPer, type: 'int', condition: '<', name: 'j'}, ({j}: {j: N}) => {
              If(j.lessThan(np), () => {
                const pi = k.mul(VF_LIMITS.puffsPer).add(j).toVar();
                const pf = n(u.puff).element(pi).toVar();
                const dv = n(p).sub(pf.xyz);
                const q = dot(dv, dv).div(max(pf.w.mul(pf.w), 1e-6)).toVar();
                If(q.lessThan(1), () => {
                  const fq = float(1).sub(q);
                  s.addAssign(n(n(u.puffD).element(pi)).mul(fq).mul(fq));
                });
              });
            });
            If(s.greaterThan(0), () => {
              const sk = s.mul(windowAt(p, k.add(VF_LIMITS.scatter))).mul(float(0.45).add(D.g.mul(1.1))).toVar();
              smokeTint.addAssign(st.xyz.mul(sk));
              smokeSig.addAssign(sk);
            });
          });
        });
      });
      // --- in-scattering ---
      If(sigma.add(smokeSig).greaterThan(0), () => {
        const L = n(vec3(0, 0, 0)).toVar();
        If(flashOn, () => {
          const lv = n(p).sub(u.flashPos).toVar();
          const ld = max(length(lv), 1e-4).toVar();
          const l = lv.div(ld).toVar();
          const spot = smoothstep(n(u.flashCone).x, n(u.flashCone).y, dot(l, u.flashDir)).toVar();
          const nf = smoothstep(n(u.nearFade).x, n(u.nearFade).y, t);
          L.addAssign(n(u.flashColor).mul(spot.mul(nf).mul(distAtt(ld, n(u.flashRange).x, n(u.flashRange).y)).mul(shadow).mul(phaseOf(u, dot(l, n(dir).negate())))));
        });
        If(n(u.fieldGain).greaterThan(0), () => {
          const f = lightFieldSample(p, {slot});
          L.addAssign(n(u.fieldGain).mul(n(f.amb).mul(1 / Math.PI).add(n(f.dirColor).mul(phaseOf(u, dot(f.dir, dir))))));
        });
        If(muzzleOn, () => {
          const mv = n(p).sub(u.muzzlePos).toVar();
          const md = max(length(mv), 1e-4).toVar();
          L.addAssign(n(u.muzzleColor).mul(distAtt(max(md, 0.5), n(u.muzzleRange).x, n(u.muzzleRange).y).mul(phaseOf(u, dot(mv.div(md), n(dir).negate())))));
        });
        // scatter lights (thrown flares), occlusion-windowed, no closer than 0.3 m (no singular glow)
        Loop({start: 0, end: VF_LIMITS.scatter, type: 'int', condition: '<', name: 'k'}, ({k}: {k: N}) => {
          If(k.lessThan(u.scatCount), () => {
            const sp = n(u.scatPos).element(k).toVar();
            const scc = n(u.scatCol).element(k).toVar();
            const sv = n(p).sub(sp.xyz).toVar();
            const sd = max(length(sv), 1e-4).toVar();
            If(sp.w.lessThanEqual(0).or(sd.lessThanEqual(sp.w)), () => {
              const vis = windowAt(p, k);
              L.addAssign(scc.xyz.mul(distAtt(max(sd, 0.3), sp.w, scc.w).mul(phaseOf(u, dot(sv.div(sd), n(dir).negate()))).mul(vis)));
            });
          });
        });
        const tr = n(u.fogDensity).mul(t);
        const scat = vec3(sigma, sigma, sigma).add(smokeTint.mul(n(u.ext).z));
        acc.addAssign(L.mul(scat).mul(w.mul(exp(tr.mul(tr).negate())).mul(tv)));
        tv.mulAssign(exp(excess.mul(n(u.ext).x).add(smokeSig.mul(n(u.ext).y)).mul(w).negate()));
      });
    });
    out0.assign(vec4(acc, viewDepth));
    out1.assign(vec4(tv, 0, 0, 1));
    return vec4(0, 0, 0, 0);
  });

  const mat = new NodeMaterial();
  mat.name = 'volumetric-march';
  mat.colorNode = march();
  mat.outputNode = outputStruct(out0, out1);
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.blending = THREE.NoBlending;
  return mat;
}

/**
 * Texture size as a SIGNED ivec2 var. three r186 types textureSize() as uvec2, but GLSL ES 3.0's textureSize returns ivec2
 * and three emits it without a cast, so arithmetic on the raw node (`size - 1`, clamp against ivec2 texel coordinates)
 * produced `ivec2 - uvec2` = a WebGL2 compile error ("no operation for highp ivec2 and const uvec2"; the fallback fog
 * never ran). The explicit conversion is ivec2(ivec2) in GLSL and vec2<i32>(vec2<u32>) in WGSL.
 */
const texSize = (t: N): N => ivec2(textureSize(t)).toVar();

// ---------------------------------------------------------------------------------------------
// Temporal accumulation

/** Temporal material: `cur0/cur1` = the march targets' textures, `hist0/hist1` = texture nodes swapped per frame (ping-pong). */
export function createTemporalMaterial(u: FogUniforms, cur0: THREE.Texture, cur1: THREE.Texture, hist0: N, hist1: N): NodeMaterial {
  const c0 = texture(cur0), c1 = texture(cur1);
  const o0 = property('vec4'), o1 = property('vec4');
  const temporal = Fn(() => {
    const uvN = n(uv());
    const size = n(texSize(c0));
    const px = ivec2(floor(uvN.mul(vec2(size)))).toVar();
    const hi = n(size).sub(1);
    const cur = n(c0.load(px)).toVar();
    const curT = n(c1.load(px)).r.toVar();
    const mn = n(cur.rgb).toVar(), mx = n(cur.rgb).toVar();
    const mnT = n(curT).toVar(), mxT = n(curT).toVar();
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (!i && !j) continue;
      const q = clamp(px.add(ivec2(i, j)), ivec2(0, 0), hi);
      const c = n(c0.load(q)).rgb;
      const ct = n(c1.load(q)).r;
      mn.assign(min(mn, c)); mx.assign(max(mx, c));
      mnT.assign(min(mnT, ct)); mxT.assign(max(mxT, ct));
    }
    const outc = n(cur.rgb).toVar(VF_MARK.temporal), outT = n(curT).toVar();
    If(n(u.historyValid).greaterThan(0.5), () => {
      const uvC = vec2(px).add(0.5).div(vec2(size));
      const ray = n(getViewPosition(uvC, float(0.5), u.projInv)).toVar();
      const vpos = ray.mul(n(cur.a).div(max(ray.z.negate(), 1e-4)));
      const wpos = n(u.camWorld).mul(vec4(vpos, 1)).toVar();
      const pv = n(u.prevView).mul(wpos).toVar();
      const puv = n(getScreenPosition(pv.xyz, u.prevProj)).toVar();
      const pdepth = pv.z.negate();
      If(pdepth.greaterThan(1e-4).and(puv.x.greaterThanEqual(0)).and(puv.x.lessThanEqual(1)).and(puv.y.greaterThanEqual(0)).and(puv.y.lessThanEqual(1)), () => {
        const hs = n(n(hist0).sample(puv).level(0)).toVar();
        const hT = n(n(hist1).sample(puv).level(0)).r;
        const rel = n(hs.a).sub(pdepth).abs().div(max(pdepth, 0.1));
        const k = n(u.blend).mul(float(1).sub(smoothstep(0.04, 0.12, rel))).toVar();
        outc.assign(mix(cur.rgb, clamp(hs.rgb, mn, mx), k));
        outT.assign(mix(curT, clamp(hT, mnT, mxT), k));
      });
    });
    o0.assign(vec4(outc, cur.a));
    o1.assign(vec4(outT, 0, 0, 1));
    return vec4(0, 0, 0, 0);
  });
  const mat = new NodeMaterial();
  mat.name = 'volumetric-temporal';
  mat.colorNode = temporal();
  mat.outputNode = outputStruct(o0, o1);
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.blending = THREE.NoBlending;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Composite (RenderPipeline output, linear HDR; the pipeline tone-maps after it)

/**
 * scene x transmittance + in-scatter x intensity, with the depth-aware upsample of the low-res fog. `sceneColor` /
 * `sceneDepth`: the scene pass texture nodes (loaded FIRST so the scene pass is ordered before the fog pass);
 * `fog0` / `fog1`: the fog pass's texture nodes (in-scatter + view depth, transmittance).
 */
export function createCompositeNode(u: FogUniforms, sceneColor: N, sceneDepth: N, fog0: N, fog1: N): Node {
  return Fn(() => {
    const uvN = n(uv());
    const fsize = n(texSize(sceneDepth));
    const px = ivec2(floor(uvN.mul(vec2(fsize)))).toVar();
    const d = n(n(sceneDepth).load(px)).r.toVar();
    const sc = n(n(sceneColor).load(px)).toVar();
    // view depth of this full-res pixel (positive)
    const vp = n(getViewPosition(uvN, d, u.projInv));
    const z = n(vp.z).negate().toVar();
    const lsize = n(texSize(fog0));
    const lp = uvN.mul(vec2(lsize)).sub(0.5).toVar();
    const lb = floor(lp).toVar();
    const fr = lp.sub(lb).toVar();
    const lhi = n(lsize).sub(1);
    const acc = n(vec3(0, 0, 0)).toVar(VF_MARK.composite), accT = n(float(0)).toVar(), wsum = n(float(0)).toVar();
    const best = n(vec3(0, 0, 0)).toVar(), bestT = n(float(1)).toVar(), bestDz = n(float(1e9)).toVar();
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const q = clamp(ivec2(int(lb.x).add(i), int(lb.y).add(j)), ivec2(0, 0), lhi);
      const s = n(n(fog0).load(q)).toVar();
      const st = n(n(fog1).load(q)).r.toVar();
      const wb = n(i ? fr.x : float(1).sub(fr.x)).mul(j ? fr.y : float(1).sub(fr.y));
      const dz = n(s.a).sub(z).abs().div(max(z, 0.05)).toVar();
      const wgt = max(wb, 1e-3).mul(exp(dz.mul(-BILATERAL_K))).toVar();
      acc.addAssign(s.rgb.mul(wgt));
      accT.addAssign(st.mul(wgt));
      wsum.addAssign(wgt);
      If(dz.lessThan(bestDz), () => { bestDz.assign(dz); best.assign(s.rgb); bestT.assign(st); });
    }
    const ok = wsum.greaterThan(1e-4);
    const fog = n(select(ok, acc.div(max(wsum, 1e-4)), best)).mul(u.intensity);
    const tv = mix(float(1), clamp(select(ok, accT.div(max(wsum, 1e-4)), bestT), 0, 1), clamp(u.intensity, 0, 1));
    return vec4(n(sc.rgb).mul(tv).add(fog), 1);
  })() as unknown as Node;
}
