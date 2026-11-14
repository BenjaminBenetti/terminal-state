// Task studio-flamethrower-fire-20261114-031614-01 (lane ACID-VFX; user: "Upgrade Acid Scrapper's big green circle into an organic
// convincing corrosive pool: ... irregular edges, NOT a generic disk. VISUAL ONLY"): the OUTLINE of an acid pool's liquid — pure maths,
// no three.js, no state.
//
// The pool HURTS inside a circle (weapons/grenades.ts inPool over poolReach: unchanged, the one test for damage and for what melts).
// What is DRAWN is an irregular spill inside that circle: a radius factor per direction, poolEdge(shape, angle), seeded per pool —
// broad lobes that reach almost to the circle and a few narrower bays between them. The rule it keeps (POOL_EDGE): what looks like
// acid hurts and what hurts looks like acid, so the liquid's edge never leaves the circle and never recedes far from it —
//   POOL_EDGE.min <= poolEdge x (1 - POOL_EDGE.fringe)   and   poolEdge <= POOL_EDGE.max      for every seed and every angle
// (`fringe`: the film's shader frays the last few centimetres INSIDE the edge, weapons/acidPoolLook.ts). The film's mesh puts its rim
// vertices exactly on poolEdge (weapons/acidPoolVisual.ts) and its bubbles spawn inside it, so this one function is the outline of
// everything the pool shows; tests/acid-pool-visual.test.ts holds it to the band for many seeds.

import {mulberry32} from '../core/rng';

export const POOL_EDGE = {
  /** The band the visible outline keeps to, as a fraction of the radius that hurts (poolReach). */
  min: 0.86,
  max: 1,
  /** poolEdge's own range: the deepest bay and the furthest lobe. */
  lo: 0.885,
  hi: 0.995,
  /** The shader's frayed, soft rim reaches at most this far (x the edge) inside poolEdge. */
  fringe: 0.025,
  /** Spokes of the film's mesh (the outline is sampled at these angles: several per bay; a chord sags by 1 - cos(pi / segments) = 0.01 %). */
  segments: 192,
  /** Harmonics of the lobes (per turn), their falloff (amplitude ~ 1 / k^falloff). */
  harmonics: [3, 13] as const,
  falloff: 0.4,
  /** Bays / tongues: narrow features on top of the lobes — their count, half-width range (rad) and depth range (x the lobes' scale). */
  notches: 5,
  notchWidth: [0.1, 0.22] as const,
  notchDepth: [0.6, 1.2] as const,
  /** Lobes are broad, bays narrow: the normalised profile s -> 1 - (1 - s)^round. */
  round: 1.5,
} as const;

/** One pool's outline parameters (poolShape). */
export interface PoolShape {
  readonly seed: number;
  /** Per harmonic: amplitude, phase. */
  readonly waves: Float32Array;
  /** Per notch: centre angle, half-width, signed depth. */
  readonly notches: Float32Array;
  /** The raw profile's range over a turn (normalisation). */
  readonly lo: number;
  readonly span: number;
}

const TAU = Math.PI * 2;

function raw(s: {waves: Float32Array; notches: Float32Array}, a: number): number {
  let v = 0;
  const k0 = POOL_EDGE.harmonics[0];
  for (let i = 0; i < s.waves.length; i += 2) v += s.waves[i] * Math.sin((k0 + i / 2) * a + s.waves[i + 1]);
  for (let i = 0; i < s.notches.length; i += 3) {
    let d = (a - s.notches[i]) % TAU;
    if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
    d /= s.notches[i + 1];
    v += s.notches[i + 2] * Math.exp(-d * d);
  }
  return v;
}

/** The outline of pool `seed` (deterministic: the same seed is always the same spill). */
export function poolShape(seed: number): PoolShape {
  const r = mulberry32(seed >>> 0), E = POOL_EDGE;
  const [k0, k1] = E.harmonics;
  const waves = new Float32Array((k1 - k0 + 1) * 2);
  for (let k = k0; k <= k1; k++) {
    waves[(k - k0) * 2] = (0.35 + 0.65 * r()) / Math.pow(k, E.falloff);
    waves[(k - k0) * 2 + 1] = r() * TAU;
  }
  const notches = new Float32Array(E.notches * 3);
  for (let i = 0; i < E.notches; i++) {
    notches[i * 3] = r() * TAU;
    notches[i * 3 + 1] = E.notchWidth[0] + (E.notchWidth[1] - E.notchWidth[0]) * r();
    // (the last one is a tongue, the others bays)
    notches[i * 3 + 2] = (i === E.notches - 1 ? 0.6 : -1) * (E.notchDepth[0] + (E.notchDepth[1] - E.notchDepth[0]) * r());
  }
  let lo = Infinity, hi = -Infinity;
  const part = {waves, notches};
  for (let i = 0; i < 720; i++) { const v = raw(part, i / 720 * TAU); if (v < lo) lo = v; if (v > hi) hi = v; }
  return {seed: seed >>> 0, waves, notches, lo, span: Math.max(1e-6, hi - lo)};
}

/**
 * The liquid's edge in direction `angle` (rad, from +X toward +Z), as a fraction of the radius that hurts: always within
 * [POOL_EDGE.lo, POOL_EDGE.hi] (clamped), periodic, smooth.
 */
export function poolEdge(shape: PoolShape, angle: number): number {
  const E = POOL_EDGE;
  const s = Math.max(0, Math.min(1, (raw(shape, angle) - shape.lo) / shape.span));
  return E.lo + (E.hi - E.lo) * (1 - Math.pow(1 - s, E.round));
}

/** poolEdge at the mesh's spokes: `out[i]` for angle i / n of a turn (n = out.length). */
export function poolEdgeRing(shape: PoolShape, out: Float32Array): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] = poolEdge(shape, i / out.length * TAU);
  return out;
}

/**
 * The radius of the POLYLINE through a ring's spokes in direction `angle` — the drawn mesh's outline exactly (between two spokes it is
 * their chord, a hair inside the curve).
 */
export function ringRadius(ring: Float32Array, angle: number): number {
  const n = ring.length, step = TAU / n;
  let a = angle % TAU;
  if (a < 0) a += TAU;
  const i = Math.min(n - 1, Math.floor(a / step)), r0 = ring[i], r1 = ring[(i + 1) % n];
  const f = a - i * step;
  return r0 * r1 * Math.sin(step) / (r0 * Math.sin(f) + r1 * Math.sin(step - f));
}
