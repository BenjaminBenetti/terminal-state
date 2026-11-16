// Task studio-rt-flashlight-compute-20261115-233136-01: the RT FLASHLIGHT's light rays — VPL_COUNT directions in the spot's cone, each
// carrying the SAME share of the beam's flux (render/rt/rtKernels.ts LIGHT casts them every frame).
//
// The equal-flux math is world/flashBounce.ts sampleCone's (three r186's cone profile: 1 inside cos(angle (1 - penumbra)), a smoothstep
// in the cosine down to cos(angle)), on a fixed stratified pattern of VPL_GRID x VPL_GRID cells: a cell of the unit square is mapped to
// the unit disc by Shirley & Chiu's concentric map (area-preserving), the disc radius^2 is the share of the flux nearer the axis than
// the ray and the disc angle its angle round the axis. Every ray thus stands for the profile-weighted solid angle OMEGA / VPL_COUNT,
// the rays are evenly spread over the beam's flux, and a wall entering the beam takes them a few at a time (1/1024 of the flux each).
// Fixed (no per-frame jitter): the bounce's shape is the same for the same aim.
// The square's x half (cells gx < VPL_GRID / 2) maps to the disc's left half: the gather's two strata (rtKernels.ts) are halves of
// the beam.

import {spotConeSolidAngle} from '../../world/flashBounce';
import {VPL_COUNT, VPL_GRID} from './rtKernels';

const coneCosines = (angle: number, penumbra: number): [number, number] => {
  const a = Math.min(Math.PI / 2, Math.max(0, angle)), p = Math.min(1, Math.max(0, penumbra));
  return [Math.cos(a), Math.cos(a * (1 - p))];
};

/** The cosine off the axis inside which `share` (0..1) of the beam's flux lies (flashBounce.ts sampleCone's cosAt). */
export function coneCosAt(share: number, angle: number, penumbra: number): number {
  const [c0, c1] = coneCosines(angle, penumbra);
  const core = 1 - c1, w = c1 - c0, total = core + w / 2;
  const f = Math.min(1, Math.max(0, share)) * total;
  if (f <= core || w < 1e-12) return 1 - f;
  const y = (f - core) / w;
  let lo = 0, hi = 1;
  for (let q = 0; q < 48; q++) { const t = (lo + hi) / 2; if (0.5 - t * t * t + 0.5 * t * t * t * t > y) lo = t; else hi = t; }
  return c0 + (lo + hi) / 2 * w;
}

/** Shirley & Chiu: the unit square's point (a, b) in [-1, 1]^2 -> (radius, angle) on the unit disc, area-preserving. */
function concentric(a: number, b: number): [number, number] {
  if (a === 0 && b === 0) return [0, 0];
  if (a * a > b * b) return [a, (Math.PI / 4) * (b / a)];
  return [b, Math.PI / 2 - (Math.PI / 4) * (a / b)];
}

export interface RtCone {
  /** vec4 per ray: the direction's part along the axis, along the light's first and second axes across the beam, 1. */
  dirs: Float32Array;
  /** One ray's profile-weighted solid angle (sr): OMEGA / VPL_COUNT. */
  weight: number;
  angle: number;
  penumbra: number;
}

/** The cone table for a spot of this angle / penumbra (VPL_COUNT x vec4, the LIGHT kernel's uniform array). */
export function makeRtCone(angle: number, penumbra: number): RtCone {
  const dirs = new Float32Array(VPL_COUNT * 4);
  for (let gy = 0; gy < VPL_GRID; gy++) {
    for (let gx = 0; gx < VPL_GRID; gx++) {
      const i = gy * VPL_GRID + gx;
      let [r, phi] = concentric((gx + 0.5) / VPL_GRID * 2 - 1, (gy + 0.5) / VPL_GRID * 2 - 1);
      if (r < 0) { r = -r; phi += Math.PI; }
      const c = Math.min(1, coneCosAt(r * r, angle, penumbra)), s = Math.sqrt(Math.max(0, 1 - c * c));
      dirs[i * 4] = c;
      dirs[i * 4 + 1] = s * Math.cos(phi);
      dirs[i * 4 + 2] = s * Math.sin(phi);
      dirs[i * 4 + 3] = 1;
    }
  }
  return {dirs, weight: spotConeSolidAngle(angle, penumbra) / VPL_COUNT, angle, penumbra};
}
