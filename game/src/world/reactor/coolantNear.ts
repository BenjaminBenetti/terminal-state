// Task reactor-playtest-round2-20261102 (lane COOLANT): THE COOLANT'S NEAR LOD — user: "coolant should look more like gooop flowing
// through pipes! its a little flat right now. You can use the current look for far away rendering but switch to a high detail at close
// ish range."
//
// Why the coolant read flat (the FAR look, coreLiquids.ts, kept as is for distance): every pipe carries an open sleeve whose two thin
// slots glow one constant blue, with dashes scrolling along at 3.2 m/s. No depth (the slot is painted on the outside of the pipe), no
// volume, no thickness, the same brightness across the slot and nothing that moves at different speeds. The sight glasses are a flat
// fill.
//
// The NEAR layer (this file, code-driven dynamic content: no new texture / model):
//  - Glass inspection windows on the pipes, in the far slots' place but wider, with a dark steel bezel and ribs (static references the
//    flow moves past), full glass on the sight-glass sleeves and the spool windows.
//  - Behind the glass, the pipe interior is ray-cast per pixel (interior mapping: the view ray, bent by the glass, through the bore
//    cylinder). The goop's THICKNESS along that ray gives a depth tint (thin at the walls, deep and glowing through the middle) and an
//    emissive core glow. Its strands / clumps are 3D noise advected along the pipe with a LAMINAR profile (fast in the middle, slow at
//    the walls: the shear stretches them, which is what reads as viscous), a slower wet film streaks the glass, bubbles ride the flow
//    (along the top of horizontal runs, rising in risers), and while the valve fills the loop a meniscus surface rises in every pipe.
//  - Startup state (ReactorVisuals.setRestartState -> CoreVisuals): before the valve the layer does not exist (hidden, the far slots
//    show); the valve fills it (still goop, dim); the pump spools the flow up (the near clock advances only with the pump's flow
//    speed); paused play never ticks the clock. The coolant's blue PointLight (coreLights.ts) is untouched.
//
// LOD (smooth, no popping): a per-pixel dither cross-fade on the fragment's distance to the eye — near only inside `full`, far only
// beyond `full + band`, a screen-space interleaved-gradient dither between (each pixel draws exactly one of the two looks). The CPU
// activates a bounded set of near instances (point-to-segment distance, re-decided only when the eye moved > `move`): ON inside `on`,
// OFF beyond `off` (hysteresis). The fade's outer radius stays below every inactive piece's distance, so the far layer never fades
// where no near instance exists.
//
// Cost: two InstancedMeshes (pipe / sight-glass tubes, spool windows), ONE shared material, plain uniforms only (fade r0 / r1 and the
// near clock; no uniform array, no texture), MeshBasic (never a shadow caster). Draws: 0 away from the coolant (and before the valve),
// at most 2 near it. Per frame: one distance pass over ~100 pieces when the eye moved; instance writes only when the active set changes.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {Fn, If, abs, attribute, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract, hash, interleavedGradientNoise, length, max,
  min, mix, mod, mx_noise_float, normalize, positionWorld, pow, refract, screenCoordinate, select, sin, smoothstep, sqrt, step, uniform, uv,
  vec3, vec4} from 'three/tsl';
import {glowFog} from '../lights';
import {REACTOR_MODELS} from './archAssets';
import type {CoreHeroLayout} from './coreHero';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;

type P3 = {x: number; y: number; z: number};

/** Near-LOD tunables (m unless noted). */
export const COOLANT_NEAR = {
  /** Near look only inside `full`; the dither cross-fade runs from `full` to `full + band`; far only beyond. */
  full: 8, band: 4,
  /** A piece's instance turns ON inside `on`, OFF beyond `off` (hysteresis; `on` > full + band + move + guard). */
  on: 13.5, off: 16,
  /** Re-decide the active set only once the eye moved this far; the fade keeps `guard` inside every inactive piece. */
  move: 0.25, guard: 0.1,
  /** Instance capacity of the tube mesh (real layouts peak at ~40-45 active: reactor-x-coolant-near.test.ts). */
  tubeCap: 96,
  /** The goop's centreline speed as a share of the far dashes' speed (CORE_LOOK.flowSpeed: 3.2 m/s -> ~1.3 m/s). */
  speed: 0.4,
  /** The near clock wraps here (m): float32 keeps sub-mm steps; a wrap (one pattern jump) comes after ~14 h of pumping. */
  wrap: 65536,
  /** The pressure level over which the near zone grows out from the eye when the valve opens (no pop at the switch-on). */
  gate: 0.35,
} as const;

/** Window kinds: a pipe's side windows, a sight-glass sleeve (all glass), a spool's armoured window (flat quad). */
export const NEAR_KIND = {pipe: 0, glass: 1, window: 2} as const;

/** One near piece: the bore axis a -> b (flow direction), radius, metres along its run at `a`, brightness, noise seed. */
export interface NearPiece {
  kind: 0 | 1 | 2;
  a: P3;
  b: P3;
  /** Pipe radius (d / 2). */
  r: number;
  s0: number;
  k: number;
  seed: number;
  /** kind 2: the window quad (centre, X = width along the axis, Y = height, Z = outward normal), its half diagonal. */
  quad?: THREE.Matrix4;
  half?: number;
}

const FLOW_K = {feed: 0.6, hot: 0.9, cold: 1, cross: 1} as const;

/**
 * The near pieces of a hero layout (pure): every straight coolant piece the far sleeves follow, every sight-glass sleeve, every spool
 * window (its bore axis and run position recovered from the window matrix and the run's cut pieces: the flow runs on through it).
 */
export function coolantNearPieces(hero: CoreHeroLayout): NearPiece[] {
  const out: NearPiece[] = [];
  hero.flows.forEach((f, fi) => {
    const k = FLOW_K[f.kind] ?? 1;
    if (f.segs) {
      for (const q of f.segs) if (dist3(q.a, q.b) >= 0.05) out.push({kind: 0, a: q.a, b: q.b, r: f.d / 2, s0: q.s0, k, seed: fi});
      return;
    }
    let s = 0;
    for (let i = 0; i + 1 < f.pts.length; i++) {
      const a = f.pts[i], b = f.pts[i + 1], L = dist3(a, b);
      if (L < 0.05) continue;
      out.push({kind: 0, a, b, r: f.d / 2, s0: s, k, seed: fi});
      s += L;
    }
  });
  hero.glasses.forEach((g, gi) => out.push({kind: 1, a: g.a, b: g.b, r: g.d / 2, s0: 0, k: 1, seed: 64 + gi}));
  const SP = REACTOR_MODELS.sightGlassSpool.anchors as unknown as {axisY: number; od: number; len: number; window: readonly number[]; windowW: number; windowH: number};
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), C = new THREE.Vector3();
  (hero.windows ?? []).forEach((w, wi) => {
    w.m.extractBasis(X, Y, Z);
    C.setFromMatrixPosition(w.m);
    const sc = X.length() / SP.windowW, ax = X.clone().normalize(), yr = Y.clone().normalize(), zr = Z.clone().normalize();
    // the bore axis behind the window (model frame: the window sits at window - (0, axisY, 0) from the spool's axis)
    const M = C.clone().addScaledVector(yr, -(SP.window[1] - SP.axisY) * sc).addScaledVector(zr, -SP.window[2] * sc);
    const halfLen = (SP.len * sc) / 2;
    // the run it sits in: a straight piece on the same line ending about half a spool before M (the cut for the spool)
    let best: {d: number; s: number; dir: P3; r: number; k: number; seed: number} | null = null;
    hero.flows.forEach((f, fi) => {
      for (const q of f.segs ?? []) {
        const L = dist3(q.a, q.b);
        if (L < 0.05) continue;
        const u = {x: (q.b.x - q.a.x) / L, y: (q.b.y - q.a.y) / L, z: (q.b.z - q.a.z) / L};
        if (Math.abs(u.x * ax.x + u.y * ax.y + u.z * ax.z) < 0.995) continue;
        const rx = M.x - q.a.x, ry = M.y - q.a.y, rz = M.z - q.a.z, t = rx * u.x + ry * u.y + rz * u.z;
        const perp = Math.hypot(rx - u.x * t, ry - u.y * t, rz - u.z * t);
        if (perp > 0.05 || t < L - 0.05 || t > L + halfLen + 0.3) continue;
        const e = Math.abs(t - L - halfLen);
        if (!best || e < best.d) best = {d: e, s: q.s0 + t, dir: u, r: f.d / 2, k: FLOW_K[f.kind] ?? 1, seed: fi};
      }
    });
    const b = best as {d: number; s: number; dir: P3; r: number; k: number; seed: number} | null;
    const dir = b?.dir ?? {x: ax.x, y: ax.y, z: ax.z}, hl = (SP.windowW * sc) / 2;
    out.push({
      kind: 2, a: {x: M.x - dir.x * hl, y: M.y - dir.y * hl, z: M.z - dir.z * hl}, b: {x: M.x + dir.x * hl, y: M.y + dir.y * hl, z: M.z + dir.z * hl},
      r: b?.r ?? (SP.od * sc) / 2, s0: (b?.s ?? 0) - hl, k: b?.k ?? 1, seed: b?.seed ?? 96 + wi,
      quad: w.m.clone(), half: Math.hypot(SP.windowW * sc, SP.windowH * sc) / 2,
    });
  });
  return out;
}

const dist3 = (a: P3, b: P3) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** The eye's distance to the nearest point any fragment of the piece's near geometry can have (a lower bound: triangle inequality). */
export function nearPieceDistance(p: NearPiece, e: P3): number {
  if (p.kind === 2 && p.quad) {
    const el = p.quad.elements;
    return Math.hypot(e.x - el[12], e.y - el[13], e.z - el[14]) - (p.half ?? 0) - 0.02;
  }
  const abx = p.b.x - p.a.x, aby = p.b.y - p.a.y, abz = p.b.z - p.a.z, apx = e.x - p.a.x, apy = e.y - p.a.y, apz = e.z - p.a.z;
  const L2 = abx * abx + aby * aby + abz * abz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / L2)) : 0;
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t) - (p.r + 0.06);
}

/**
 * The CPU half of the LOD (pure numbers, Node-testable): which pieces have a near instance, and the fade's outer radius `r1` (0: no
 * near layer). Hysteresis ON < `on`, OFF > `off`; re-decided only when the eye moved > `move`; per-mesh caps (the tube mesh's
 * `tubeCap`, the window mesh's own size) keep the nearest; `r1` never reaches an inactive piece.
 */
export class CoolantNearLod {
  readonly active: Uint8Array;
  readonly dist: Float32Array;
  /** The fade's outer radius (m) for the active set; 0 when nothing is near. */
  r1 = 0;
  /** Active instances per mesh: [tubes, windows]. */
  readonly count: [number, number] = [0, 0];
  readonly caps: [number, number];
  readonly counts = {decided: 0, skipped: 0, changes: 0, capped: 0};
  private ex = NaN;
  private ey = NaN;
  private ez = NaN;
  private readonly sphere: {x: number; y: number; z: number; r: number};
  private readonly order: number[] = [];

  constructor(readonly pieces: readonly NearPiece[], tubeCap: number = COOLANT_NEAR.tubeCap, readonly cfg: {readonly [K in keyof typeof COOLANT_NEAR]: number} = COOLANT_NEAR) {
    this.active = new Uint8Array(pieces.length);
    this.dist = new Float32Array(pieces.length).fill(Infinity);
    this.caps = [tubeCap, pieces.filter(p => p.kind === 2).length];
    // a bounding sphere of every piece (the whole set out of reach: one distance, no loop)
    const box = new THREE.Box3();
    for (const p of pieces) { box.expandByPoint(new THREE.Vector3(p.a.x, p.a.y, p.a.z)); box.expandByPoint(new THREE.Vector3(p.b.x, p.b.y, p.b.z)); }
    const s = box.isEmpty() ? new THREE.Sphere() : box.getBoundingSphere(new THREE.Sphere());
    this.sphere = {x: s.center.x, y: s.center.y, z: s.center.z, r: s.radius + 1};
  }

  /** Mesh of a piece: 0 tubes (pipe windows / sight glasses), 1 the spool windows. */
  static mesh(p: NearPiece): 0 | 1 { return p.kind === 2 ? 1 : 0; }

  /** Re-decides for the eye; true when the active set changed. Skipped (false) while the eye moved less than `move`. */
  decide(e: P3, force = false): boolean {
    const c = this.cfg;
    if (!force && Math.hypot(e.x - this.ex, e.y - this.ey, e.z - this.ez) < c.move) { this.counts.skipped++; return false; }
    this.ex = e.x; this.ey = e.y; this.ez = e.z;
    this.counts.decided++;
    const S = this.sphere, out = Math.hypot(e.x - S.x, e.y - S.y, e.z - S.z) - S.r > c.off;
    let changed = false;
    const cnt: [number, number] = [0, 0];
    for (let i = 0; i < this.pieces.length; i++) {
      const d = out ? Infinity : nearPieceDistance(this.pieces[i], e);
      this.dist[i] = d;
      const was = this.active[i] === 1, want = was ? d < c.off : d < c.on;
      if (want !== was) { this.active[i] = want ? 1 : 0; changed = true; }
      if (want) cnt[CoolantNearLod.mesh(this.pieces[i])]++;
    }
    for (const m of [0, 1] as const) {
      if (cnt[m] <= this.caps[m]) continue;
      // over the cap (never on the real layouts): keep the nearest
      this.order.length = 0;
      for (let i = 0; i < this.pieces.length; i++) if (this.active[i] && CoolantNearLod.mesh(this.pieces[i]) === m) this.order.push(i);
      this.order.sort((a, b) => this.dist[a] - this.dist[b]);
      for (let k = this.caps[m]; k < this.order.length; k++) this.active[this.order[k]] = 0;
      cnt[m] = this.caps[m];
      this.counts.capped++;
      changed = true;
    }
    let minOff = Infinity;
    for (let i = 0; i < this.pieces.length; i++) if (!this.active[i] && this.dist[i] < minOff) minOff = this.dist[i];
    this.count[0] = cnt[0]; this.count[1] = cnt[1];
    this.r1 = cnt[0] + cnt[1] > 0 ? Math.max(0, Math.min(c.full + c.band, minOff - c.move - c.guard)) : 0;
    if (changed) this.counts.changes++;
    return changed;
  }

  /** Forget the eye (the next decide runs). */
  reset(): void { this.ex = this.ey = this.ez = NaN; }
}

// ---------------------------------------------------------------------------------------------
// TSL: the fade shared by the near and far materials

/** The fade radii (plain uniforms: shared by the far sleeves / glasses and the near material). */
export interface NearFade { r0: {value: number}; r1: {value: number} }
export const createNearFade = (): NearFade => ({r0: uniform(0), r1: uniform(0)}) as unknown as NearFade;

/** The near weight at distance d (the CPU mirror of the shader's `nearWeight`: tests, QA). A pixel with dither value t draws the near
 *  look when t < w, the far look otherwise. */
export function nearWeightAt(d: number, r0: number, r1: number): number {
  const w = Math.max(0, Math.min(1, (r1 - d) / Math.max(r1 - r0, 0.001)));
  return w * w * (3 - 2 * w);
}

/** Near weight of this fragment: 1 inside r0, 0 beyond r1 (smooth between); 0 everywhere when r1 = 0. */
function nearWeight(f: NearFade): N {
  const d = length(n(positionWorld).sub(cameraPosition));
  const w = clamp(n(f.r1).sub(d).div(max(n(f.r1).sub(f.r0), 0.001)), 0, 1);
  return n(w).mul(w).mul(n(float(3)).sub(n(w).mul(2)));
}
/** The per-pixel dither threshold (static screen-space interleaved gradient noise in [0, 1)). */
const dither = (): N => interleavedGradientNoise(n(screenCoordinate).xy);
/** 1 where the FAR look draws this pixel (exactly the complement of the near layer's pixels). */
export function farKeep(f: NearFade): N { return step(nearWeight(f), dither()); }

// ---------------------------------------------------------------------------------------------
// The near material

/** Linear colours: deep / bright goop, the hot core, the wet film, bubble rims, the dark bore wall, the bezel, the glass sheen. */
const C3 = (r: number, g: number, b: number): N => vec3(r, g, b);
const LOOK = {deep: [0.005, 0.03, 0.16], bright: [0.12, 0.5, 1.45], core: [0.4, 0.95, 1.9], film: [0.35, 0.8, 1.5], bubble: [0.6, 1.0, 1.6],
  wall: [0.006, 0.01, 0.016], bezel: [0.03, 0.033, 0.037], sheen: [0.045, 0.06, 0.075]} as const;

/**
 * The near coolant material (one, shared by both near meshes). Per-instance attributes: aAx (bore axis origin xyz, bore radius),
 * aDir (unit flow direction, metres along the run at the origin), aLook (kind, brightness, seed, length), aFill (the bore's y range:
 * the fill level rises through it). Uniforms: the core's flowGlow / fill (CoreUniforms), the fade, the near clock.
 */
export function coolantNearMaterial(u: {flowGlow: {value: number}; fill: {value: number}}, fade: NearFade, clock: {value: number}): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'reactor-coolant-near';
  const aAx = n(attribute('aAx', 'vec4')), aDir = n(attribute('aDir', 'vec4')), aLook = n(attribute('aLook', 'vec4')), aFill = n(attribute('aFill', 'vec2'));
  const sh = n(clock);
  const L = (k: keyof typeof LOOK) => C3(...(LOOK[k] as unknown as [number, number, number]));
  m.colorNode = Fn(() => {
    const out = n(vec4(0, 0, 0, 0)).toVar();
    If(n(dither()).lessThan(nearWeight(fade)), () => {
      const P = n(positionWorld).toVar();
      const V0 = normalize(P.sub(cameraPosition)).toVar();
      const Ri = n(aAx.w).toVar(), A = n(normalize(aDir.xyz)).toVar();
      const q = n(P.sub(aAx.xyz)).toVar();
      const along = n(dot(q, A)).toVar();
      const qp = n(q.sub(A.mul(along))).toVar();
      const Nn = n(normalize(qp)).toVar();
      const s = n(aDir.w.add(along)).toVar();
      const kind = n(aLook.x), seed = n(aLook.z);
      const t = n(uv());
      // ---- the windows: side windows on a pipe (the far slots' place, wider), all glass on a sight-glass sleeve / spool window ----
      const a0 = fract(t.x.mul(2).add(0.075));
      const tubeBez = max(max(step(a0, 0.022), step(0.278, a0)), step(fract(s.div(1.2)), 0.035));
      const lenY = n(t.y).mul(aLook.w);
      const glassBez = max(step(fract(n(t.x).mul(3).add(0.02)), 0.045), max(step(lenY, 0.05), step(n(aLook.w).sub(0.05), lenY)));
      const winBez = max(max(step(t.x, 0.03), step(0.97, t.x)), max(step(t.y, 0.1), step(0.9, t.y)));
      const isPipe = n(kind).lessThan(0.5);
      const inWin = select(isPipe, step(a0, 0.3), float(1));
      const bez = select(isPipe, tubeBez, select(n(kind).lessThan(1.5), glassBez, winBez));
      If(n(inWin).greaterThan(0.5), () => {
        out.assign(vec4(L('bezel'), 1));
        If(n(bez).lessThan(0.5), () => {
          const col = n(L('wall')).toVar();
          // emission: dim and still once pressurised, ~2.5x with the pump (a soft curve: deep saturated blue, never pastel)
          const em = n(float(0.1)).add(n(max(n(u.flowGlow), n(u.fill).mul(0.22))).mul(0.35)).mul(aLook.y).toVar();
          // ---- the view ray bent by the glass, through the bore cylinder (perpendicular parts: |qp + t Vp| = Ri) ----
          const V = n(refract(V0, Nn, 1 / 1.38)).toVar();
          const VA = n(dot(V, A)).toVar();
          const Vp = n(V.sub(A.mul(VA))).toVar();
          const a2 = n(max(dot(Vp, Vp), 1e-5)).toVar();
          const b2 = n(dot(qp, Vp)).toVar();
          const disc = n(b2.mul(b2).sub(a2.mul(dot(qp, qp).sub(Ri.mul(Ri))))).toVar();
          If(disc.greaterThan(0), () => {
            const sq = sqrt(disc);
            const tIn = n(max(b2.negate().sub(sq).div(a2), 0)).toVar();
            const tOut = n(b2.negate().add(sq).div(a2)).toVar();
            // the fill: goop below a horizontal surface rising through the bore's y range (full once pressurised)
            const hW = mix(n(aFill.x).sub(0.01), n(aFill.y).add(0.05), n(u.fill));
            const vy = n(V.y);
            const svy = select(abs(vy).lessThan(1e-4), float(1e-4), vy);
            const tS = n(n(hW).sub(P.y).div(svy)).toVar();
            const down = n(svy).lessThan(0);
            const g0 = n(select(down, max(tIn, tS), tIn)).toVar();
            const g1 = n(select(down, tOut, min(tOut, tS))).toVar();
            const cg = n(max(g1.sub(g0), 0)).toVar();
            If(cg.greaterThan(1e-4), () => {
              // the deepest point of the goop on the ray (its closest approach to the axis): radius, run position
              const tc = clamp(b2.negate().div(a2), g0, g1);
              const Mp = n(qp.add(Vp.mul(tc))).toVar();
              const rho = n(clamp(length(Mp).div(Ri), 0, 1)).toVar();
              const sM = n(s.add(VA.mul(tc))).toVar();
              // laminar flow: a fast core band and a slow wall band (each advected whole, so the blobs keep their size forever: no
              // unbounded shear), blended by the radius the ray reaches; elongated along the pipe (strands); a finer octave between
              const pB = n(Mp.mul(n(float(2)).div(Ri))).add(seed.mul(13.7)).toVar();
              const nC = mx_noise_float(n(pB).add(A.mul(sM.sub(sh).mul(0.7))));
              const nW = mx_noise_float(n(pB).add(A.mul(sM.sub(sh.mul(0.3)).mul(0.7))).add(vec3(31.4, 17.2, 9.1)));
              const n2 = n(mx_noise_float(n(pB).mul(2.7).add(A.mul(sM.sub(sh.mul(0.65)).mul(2.4))).add(vec3(5.2, 1.3, 7.7)))).toVar();
              const clump = n(smoothstep(-0.1, 0.35, n(mix(nC, nW, smoothstep(0.3, 0.85, rho))).add(n2.mul(0.3)))).toVar();
              // thickness -> depth tint (Beer-Lambert-like): thin at the walls, deep through the middle; clumps are denser
              const sig = n(float(3.2)).div(Ri).mul(n(float(0.45)).add(clump.mul(1.1)));
              const Eg = n(n(float(1)).sub(exp(n(sig).mul(cg).negate()))).toVar();
              const core = exp(rho.mul(rho).mul(-3));
              const goop = n(mix(L('deep'), L('bright'), Eg)).mul(n(float(0.22)).add(clump.mul(1.05)))
                .add(n(L('core')).mul(n(core).mul(Eg).mul(n(float(0.35)).add(clump.mul(0.65)))));
              col.assign(mix(col, n(goop).mul(em), Eg));
              // the wet film on the glass: slow streaks (the wall barely moves)
              const wet = step(g0, tIn.add(0.002));
              const pE = qp.add(Vp.mul(tIn));
              const sE = s.add(VA.mul(tIn));
              const pF = n(n(pE).mul(n(float(5)).div(Ri))).add(A.mul(n(sE).sub(sh.mul(0.15)).mul(0.45))).add(seed.mul(7.1).add(3));
              const film = n(smoothstep(0.05, 0.6, mx_noise_float(pF))).mul(wet).toVar();
              col.assign(col.mul(n(float(1)).sub(n(float(1)).sub(film).mul(wet).mul(0.18))).add(n(L('film')).mul(film.mul(em).mul(0.5))));
              // bubbles carried by the flow (riding the top of a horizontal run, rising faster up a riser): two cells along the axis
              const ref = select(abs(A.y).greaterThan(0.9), vec3(1, 0, 0), vec3(0, 1, 0));
              const e1 = n(normalize(cross(A, ref))).toVar(), e2 = n(cross(A, e1)).toVar();
              const hz = clamp(n(float(1)).sub(abs(A.y)).mul(4), 0, 1);
              const upP = n(vec3(0, 1, 0)).sub(A.mul(A.y));
              const upN = n(upP).div(max(length(upP), 1e-3)).toVar();
              const LB = 0.3;
              const shB = n(sh.mul(n(float(0.8)).add(A.y.mul(0.25)))).toVar();
              const ub = n(sM.sub(shB).div(LB)).toVar();
              const j0 = n(floor(ub)).toVar();
              const ring = n(float(0)).toVar(), inside = n(float(0)).toVar();
              for (const j of [j0, j0.add(select(fract(ub).lessThan(0.5), float(-1), float(1)))]) {
                const key = n(mod(j, 8192)).add(seed.mul(8192)).mul(3);
                const h1 = n(hash(key)), h2 = n(hash(n(key).add(1))), h3 = n(hash(n(key).add(2)));
                const sc = n(j).add(n(float(0.2)).add(h2.mul(0.6))).mul(LB).add(shB);
                const ang = h3.mul(6.2832);
                const dirB = normalize(n(mix)(n(e1).mul(cos(ang)).add(n(e2).mul(sin(ang))), upN, n(hz).mul(0.65)));
                const rr = n(float(0.25)).add(fract(h2.mul(7.31)).mul(0.5)).add(sin(sh.mul(3).add(h1.mul(40))).mul(0.05));
                const rel = n(A.mul(n(sc).sub(aDir.w)).add(n(dirB).mul(n(rr).mul(Ri)))).sub(q).toVar();
                const tB = n(dot(rel, V)).toVar();
                const x = n(length(rel.sub(V.mul(tB)))).div(Ri.mul(n(float(0.06)).add(fract(h3.mul(13.7)).mul(0.07))));
                const on = n(step(h1, 0.42)).mul(step(g0, tB)).mul(step(tB, g1));
                ring.assign(max(ring, n(smoothstep(0.55, 0.9, x)).mul(n(float(1)).sub(smoothstep(0.9, 1.0, x))).mul(on)));
                inside.assign(max(inside, n(n(float(1)).sub(smoothstep(0.85, 1.0, x))).mul(on)));
              }
              col.assign(mix(col, col.mul(0.4), inside.mul(0.7)).add(n(L('bubble')).mul(ring.mul(em).mul(1.6))));
            });
            // the meniscus while the loop fills: a bright ring where the rising surface meets the glass, a sheen on the surface
            const crosses = n(step(tIn, tS)).mul(step(tS, tOut)).mul(step(n(u.fill), 0.995)).mul(step(0.001, n(u.fill)));
            const rX = length(qp.add(Vp.mul(tS))).div(Ri);
            col.addAssign(n(L('bright')).mul(n(smoothstep(0.72, 1.0, rX)).mul(0.9).add(0.25).mul(crosses).mul(em).mul(1.6)));
          });
          // the glass: a grazing sheen
          col.addAssign(n(L('sheen')).mul(pow(n(float(1)).sub(abs(dot(V0, Nn))), 4)));
          out.assign(vec4(col, 1));
        });
      });
    });
    return out;
  })();
  m.alphaTest = 0.5;
  glowFog(m, 0.5);
  return m;
}

// ---------------------------------------------------------------------------------------------
// The near layer: meshes + LOD runtime

/** Unit open tube (x = cos, y = sin, z 0..1; uv.x round, uv.y along): the far sleeves' parametrisation, finer. */
function unitTube(seg = 32): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let j = 0; j <= seg; j++) {
    const th = (j / seg) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    for (const z of [0, 1]) { pos.push(c, s, z); nor.push(c, s, 0); uvs.push(j / seg, z); }
  }
  for (let j = 0; j < seg; j++) { const p = j * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

interface NearMesh {
  mesh: THREE.InstancedMesh;
  ax: THREE.InstancedBufferAttribute;
  dir: THREE.InstancedBufferAttribute;
  look: THREE.InstancedBufferAttribute;
  fill: THREE.InstancedBufferAttribute;
}

function nearMesh(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string): NearMesh {
  const inst = (k: number) => new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * k), k).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
  const r = {ax: inst(4), dir: inst(4), look: inst(4), fill: inst(2)};
  geo.setAttribute('aAx', r.ax);
  geo.setAttribute('aDir', r.dir);
  geo.setAttribute('aLook', r.look);
  geo.setAttribute('aFill', r.fill);
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
  mesh.name = name;
  mesh.count = 0;
  mesh.visible = false; // until the eye is near (and the loop pressurised); the warm-up pool compiles it hidden
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.matrixAutoUpdate = false;
  mesh.userData.coolantNear = true;
  return {mesh, ...r};
}

/** The near coolant layer of one Reactor build (coreLiquids.ts builds it; CoreVisuals drives it). */
export class CoolantNear {
  readonly group = new THREE.Group();
  readonly tubes: NearMesh;
  readonly windows: NearMesh | null;
  readonly material: MeshBasicNodeMaterial;
  readonly lod: CoolantNearLod;
  /** The near clock (m the goop's centreline has travelled; advances only with the pump's flow). */
  readonly clock = uniform(0) as unknown as {value: number};
  /** Pressure level last applied (0: valve shut -> no near layer). */
  pressure = 0;
  readonly stats: {pieces: number; tubes: number; windows: number; tubeCap: number; triangles: number};
  /** Per-piece instance data (matrix 16, aAx 4, aDir 4, aLook 4, aFill 2). */
  private readonly data: Float32Array;
  private readonly m = new THREE.Matrix4();

  constructor(readonly pieces: readonly NearPiece[], u: {flowGlow: {value: number}; fill: {value: number}}, readonly fade: NearFade, levels: readonly number[], tubeCap: number = COOLANT_NEAR.tubeCap) {
    this.group.name = 'core-coolant-near';
    this.material = coolantNearMaterial(u, fade, this.clock);
    const nWin = pieces.filter(p => p.kind === 2).length;
    this.tubes = nearMesh(unitTube(), this.material, tubeCap, 'core-coolant-near-tubes');
    this.windows = nWin ? nearMesh(new THREE.PlaneGeometry(1, 1), this.material, nWin, 'core-coolant-near-windows') : null;
    for (const nm of [this.tubes, this.windows]) if (nm) { nm.mesh.userData.levels = [...levels]; nm.mesh.updateMatrix(); this.group.add(nm.mesh); }
    this.lod = new CoolantNearLod(pieces, tubeCap);
    this.data = new Float32Array(pieces.length * 30);
    pieces.forEach((p, i) => this.prepare(p, i));
    const tri = (nm: NearMesh | null) => (nm ? ((nm.mesh.geometry.index?.count ?? 0) / 3) * nm.mesh.instanceMatrix.count : 0);
    this.stats = {pieces: pieces.length, tubes: pieces.length - nWin, windows: nWin, tubeCap, triangles: tri(this.tubes) + tri(this.windows)};
  }

  /** Instance data of piece i (once, at build). */
  private prepare(p: NearPiece, i: number): void {
    const o = i * 30, D = this.data;
    const L = dist3(p.a, p.b) || 1;
    const ax = new THREE.Vector3((p.b.x - p.a.x) / L, (p.b.y - p.a.y) / L, (p.b.z - p.a.z) / L);
    const m = new THREE.Matrix4();
    if (p.kind === 2 && p.quad) {
      const nrm = new THREE.Vector3().setFromMatrixColumn(p.quad, 2).normalize();
      m.copy(p.quad);
      m.elements[12] += nrm.x * 0.007; m.elements[13] += nrm.y * 0.007; m.elements[14] += nrm.z * 0.007; // the far quad is 6 mm proud
    } else {
      // the far sleeves' frame (coreLiquids.ts SleeveBuilder): e1 = axis x ref, e2 = axis x e1 — the windows sit where the slots do
      const ref = Math.abs(ax.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const e1 = new THREE.Vector3().crossVectors(ax, ref).normalize(), e2 = new THREE.Vector3().crossVectors(ax, e1).normalize();
      const rs = p.r + (p.kind === 1 ? 0.037 : 0.016); // just outside the far sleeve (+0.014) / glass (+0.035)
      m.makeBasis(e1.multiplyScalar(rs), e2.multiplyScalar(rs), ax.clone().multiplyScalar(L)).setPosition(p.a.x, p.a.y, p.a.z);
    }
    m.toArray(D, o);
    // the bore: a pipe's interior inside its wall, the sight glass's full width, the spool's bore behind its window
    const ri = p.kind === 0 ? p.r * 0.9 : p.kind === 1 ? p.r + 0.015 : p.r * 0.88;
    const cy = ri * Math.sqrt(Math.max(0, 1 - ax.y * ax.y));
    D.set([p.a.x, p.a.y, p.a.z, ri, ax.x, ax.y, ax.z, p.s0, p.kind, p.k, p.seed, L, Math.min(p.a.y, p.b.y) - cy, Math.max(p.a.y, p.b.y) + cy], o + 16);
  }

  /** Per frame (play): the eye's LOD decision; instance writes only when the active set changed. */
  update(eye: P3): void {
    if (this.lod.decide(eye)) this.rewrite();
    this.applyFade();
  }

  /** The stage clock + gate (CoreVisuals.apply): `metres` the centreline travelled this tick, the pressure level now. */
  tick(metres: number, pressure: number): void {
    if (metres > 0) this.clock.value = (this.clock.value + metres) % COOLANT_NEAR.wrap;
    this.pressure = pressure;
    this.applyFade();
  }

  /** Fade radii + visibility from the LOD and the pressure gate (the near zone grows out from the eye as the valve opens). */
  private applyFade(): void {
    const g = this.pressure <= 0 ? 0 : this.pressure >= COOLANT_NEAR.gate ? 1 : smooth(this.pressure / COOLANT_NEAR.gate);
    const r1 = this.lod.r1 * g;
    this.fade.r1.value = r1;
    this.fade.r0.value = Math.max(0, r1 - COOLANT_NEAR.band);
    const on = r1 > 0;
    this.tubes.mesh.visible = on && this.lod.count[0] > 0;
    if (this.windows) this.windows.mesh.visible = on && this.lod.count[1] > 0;
  }

  /** Compact the active pieces into their meshes' instance slots. */
  private rewrite(): void {
    const slot = [0, 0], D = this.data;
    for (let i = 0; i < this.pieces.length; i++) {
      if (!this.lod.active[i]) continue;
      const mi = CoolantNearLod.mesh(this.pieces[i]), nm = mi === 0 ? this.tubes : this.windows;
      if (!nm) continue;
      const k = slot[mi]++, o = i * 30;
      nm.mesh.setMatrixAt(k, this.m.fromArray(D, o));
      nm.ax.setXYZW(k, D[o + 16], D[o + 17], D[o + 18], D[o + 19]);
      nm.dir.setXYZW(k, D[o + 20], D[o + 21], D[o + 22], D[o + 23]);
      nm.look.setXYZW(k, D[o + 24], D[o + 25], D[o + 26], D[o + 27]);
      nm.fill.setXY(k, D[o + 28], D[o + 29]);
    }
    for (const [mi, nm] of [[0, this.tubes], [1, this.windows]] as const) {
      if (!nm) continue;
      nm.mesh.count = slot[mi];
      nm.mesh.instanceMatrix.needsUpdate = true;
      nm.ax.needsUpdate = nm.dir.needsUpdate = nm.look.needsUpdate = nm.fill.needsUpdate = true;
      nm.mesh.computeBoundingSphere();
    }
  }

  /** Draws this layer adds now (0 / 1 / 2). */
  draws(): number { return (this.tubes.mesh.visible && this.tubes.mesh.count ? 1 : 0) + (this.windows?.mesh.visible && this.windows.mesh.count ? 1 : 0); }

  /** QA / tests. */
  state(): {r0: number; r1: number; tubes: number; windows: number; draws: number; clock: number; pressure: number; counts: CoolantNearLod['counts']} {
    return {r0: this.fade.r0.value, r1: this.fade.r1.value, tubes: this.tubes.mesh.count, windows: this.windows?.mesh.count ?? 0, draws: this.draws(),
      clock: this.clock.value, pressure: this.pressure, counts: {...this.lod.counts}};
  }

  dispose(): void { this.material.dispose(); }
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** The near layer for a hero layout (null without coolant pieces). `u`: the core's uniforms; `fade`: shared with the far materials. */
export function buildCoolantNear(hero: CoreHeroLayout, u: {flowGlow: {value: number}; fill: {value: number}}, fade: NearFade, levels: readonly number[]): CoolantNear | null {
  const pieces = coolantNearPieces(hero);
  return pieces.length ? new CoolantNear(pieces, u, fade, levels) : null;
}
