// Task mall-playtest-revision-20261031 (lane FIX, U08): ANISOTROPIC anti-aliasing of procedural line patterns (the mall's TSL
// floors / walls / ceilings, world/mallSurfaces.ts — lane ARCH's graphs; only their anti-aliasing weights use these helpers).
//
// "Floor texture looks muddy at a short distance" — the mall's finishes are procedural (no texture to give 16x sampler anisotropy).
// They faded every joint / grout / divider / seam by ONE isotropic footprint px = max(fwidth(x), fwidth(z)): at a grazing view the
// along-view footprint (~d^2 / (eye height * focal px)) is large, so even lines RUNNING ALONG the view — still crisp to 20+ m — were
// faded out with the cross-view ones by ~5 m (eye 1.62 m, vFOV 75 deg, 1080 px: tile grout half gone at ~4.5 m, gone at ~5.5 m).
// The procedural equivalent of anisotropic filtering: a family of lines of constant x is filtered by the footprint ALONG x only
// (fwidth(x) = the pixel parallelogram's exact extent on x), and filtered by COVERAGE (a box filter: a sub-pixel line keeps its
// average ink as a fainter line, the way a mipmapped texture would) instead of being switched off; once the footprint reaches the
// line period the value settles to the pattern's average density (no moire). Sub-centimetre 2D features (terrazzo chips, flecks,
// pegboard holes) keep the conservative isotropic fade: a single procedural sample cannot average random cells along the view
// without sparkle. Uniform-control-flow rule: callers take every fwidth BEFORE their If chains and pass the footprints in.

import {clamp, float, fract, max, min, mix, smoothstep} from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;
type Num = number | AnyNode;

/**
 * Box-filtered periodic line: coverage (0..1) of a line of half-width `w` (m; ink centre 0.8 w with a soft 0.6..1.0 w edge — the
 * old joint() profile) at distance `e` (m, >= 0) from the nearest line centre, for a pixel footprint `F` (m, along the line's
 * normal) and line period `S` (m). Fades to the average density 1.6 w / S as F approaches the period.
 */
export function lineAA(e: AnyNode, w: Num, F: AnyNode, S: Num): AnyNode {
  const wc = float(w).mul(0.8);
  const fe = max(F, float(w).mul(0.4));
  const half = fe.mul(0.5);
  const cov = max(min(e.add(half), wc).sub(max(e.sub(half), wc.mul(-1))), 0).div(fe);
  const avg = clamp(float(w).mul(1.6).div(S), 0, 1);
  return mix(cov, avg, smoothstep(float(S).mul(0.35), float(S).mul(0.7), F));
}

/**
 * Grid joints (two line families on the axes of `q`, a grid coordinate in CELLS of size `size` m): each family filtered by its own
 * axis footprint `F` (vec2, m) — the anisotropic replacement of joint(edgeDist(q, size), w).mul(fine / mid).
 */
export function gridAA(q: AnyNode, size: AnyNode, w: Num, F: AnyNode): AnyNode {
  const fx = fract(q.x), fy = fract(q.y);
  const ex = min(fx, fx.oneMinus()).mul(size.x), ey = min(fy, fy.oneMinus()).mul(size.y);
  return max(lineAA(ex, w, F.x, size.x), lineAA(ey, w, F.y, size.y));
}

/** A 1D feature's contrast gate on ITS axis footprint (the old isotropic `mid` / `fine` on one axis): 1 - smoothstep(a, b, F). */
export const axisGate = (F: AnyNode, a: number, b: number): AnyNode => float(1).sub(smoothstep(a, b, F));

// ---------------------------------------------------------------------------------------------------------------------------
// CPU mirrors (tests / measurements)

const sstep = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** CPU mirror of lineAA. */
export function lineAACpu(e: number, w: number, F: number, S: number): number {
  const wc = 0.8 * w, fe = Math.max(F, 0.4 * w), h = fe / 2;
  const cov = Math.max(0, Math.min(e + h, wc) - Math.max(e - h, -wc)) / fe;
  const avg = Math.min(1, Math.max(0, (1.6 * w) / S));
  const k = sstep(0.35 * S, 0.7 * S, F);
  return cov + (avg - cov) * k;
}

/** CPU mirror of the OLD isotropic weight: joint(e, w) * (1 - smoothstep(a, b, px)). */
export function oldJointCpu(e: number, w: number, px: number, a: number, b: number): number {
  return (1 - sstep(0.6 * w, w, e)) * (1 - sstep(a, b, px));
}

/**
 * Footprints (m / px) of a floor point at horizontal distance `d` for an eye `h` m high, vertical FOV `fovDeg`, `heightPx` pixels:
 * along the view (radial) and across it (tangential) — what fwidth reports on the axis parallel / perpendicular to the view.
 */
export function floorFootprint(d: number, h = 1.62, fovDeg = 75, heightPx = 1080): {along: number; across: number} {
  const f = heightPx / 2 / Math.tan((fovDeg / 2) * Math.PI / 180);
  return {along: (d * d + h * h) / (h * f), across: Math.hypot(d, h) / f};
}
