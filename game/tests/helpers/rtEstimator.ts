// Task studio-rt-flashlight-compute-20261115-233136-01: the CPU mirror of the RT FLASHLIGHT's estimator (render/rt/rtKernels.ts), for
// tests: the same light rays (render/rt/rtCone.ts), the same VPL record, the same area-regularized kernel and range window, the same
// stratified reservoir picks (PCG hash) and the same visibility ratio. The trace is the caller's (render/rt/rtTrace.ts over the
// packed scene, or anything else): `closest` / `any` as the WGSL's traceClosest / traceAny.
import * as THREE from 'three';
import {FB} from '../../src/world/flashBounce';
import {makeRtCone, type RtCone} from '../../src/render/rt/rtCone';
import {STRATA, VPL_COUNT, VPL_GRID, VPL_LIFT} from '../../src/render/rt/rtKernels';

export type V3 = [number, number, number];
export interface TraceHit { t: number; n: V3; albedo: V3; proxy?: boolean }
export interface Tracer {
  closest(o: V3, d: V3, tmin: number, tmax: number): TraceHit | null;
  any(o: V3, d: V3, tmin: number, tmax: number): boolean;
}

/** One VPL: lifted point, r0^2, normal, radiant intensity / pi per channel (the kernel's `lf`). */
export interface Vpl { p: V3; r02: number; n: V3; f: V3 }

export interface LightIn {
  pos: V3; axis: V3; u: V3; v: V3;
  /** colour x intensity (linear). */
  rgb: V3;
  decay: number; cutoff: number; angle: number; penumbra: number; near: number;
}

/** The light frame the runtime builds from a three SpotLight (rtFlashlightRuntime.ts): axis toward the target, u from its world x. */
export function lightOf(spot: THREE.SpotLight): LightIn {
  spot.updateWorldMatrix(true, false);
  spot.target.updateWorldMatrix(true, false);
  const m = spot.matrixWorld.elements, tm = spot.target.matrixWorld.elements;
  const pos: V3 = [m[12], m[13], m[14]];
  const a = new THREE.Vector3(tm[12] - pos[0], tm[13] - pos[1], tm[14] - pos[2]).normalize();
  let u = new THREE.Vector3(m[0], m[1], m[2]);
  u.addScaledVector(a, -u.dot(a));
  if (u.length() < 1e-4) { u = new THREE.Vector3(m[4], m[5], m[6]); u.addScaledVector(a, -u.dot(a)); }
  u.normalize();
  const v = new THREE.Vector3().crossVectors(a, u);
  const c = spot.color;
  return {pos, axis: [a.x, a.y, a.z], u: [u.x, u.y, u.z], v: [v.x, v.y, v.z], rgb: [c.r * spot.intensity, c.g * spot.intensity, c.b * spot.intensity],
    decay: spot.decay, cutoff: spot.distance > 0 ? spot.distance : 0, angle: spot.angle, penumbra: spot.penumbra, near: spot.shadow?.camera?.near ?? 0.2};
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** LIGHT: the VPLs of this light (null where a ray lands nowhere). `cone` defaults to the light's own table. */
export function lightVpls(tr: Tracer, L: LightIn, cone: RtCone = makeRtCone(L.angle, L.penumbra), count = VPL_COUNT): (Vpl | null)[] {
  const out: (Vpl | null)[] = [];
  const share = cone.weight / Math.PI, reach = L.cutoff > 0 ? L.cutoff : 60;
  const fb = FB.params.value, soft = 1 / Math.PI, r0min2 = fb.y * fb.y;
  for (let i = 0; i < count; i++) {
    const c = cone.dirs.subarray(i * 4, i * 4 + 4);
    const d = norm([L.axis[0] * c[0] + L.u[0] * c[1] + L.v[0] * c[2], L.axis[1] * c[0] + L.u[1] * c[1] + L.v[1] * c[2], L.axis[2] * c[0] + L.u[2] * c[1] + L.v[2] * c[2]]);
    const h = tr.closest(L.pos, d, L.near, reach);
    if (!h) { out.push(null); continue; }
    let n = norm(h.n);
    if (dot(n, d) > 0) n = [-n[0], -n[1], -n[2]];
    const p: V3 = [L.pos[0] + d[0] * h.t, L.pos[1] + d[1] * h.t, L.pos[2] + d[2] * h.t];
    const d2 = h.t * h.t;
    let g = d2 / Math.max(Math.pow(h.t, L.decay), 0.01);
    if (L.cutoff > 0) { const q = h.t / L.cutoff, w = Math.min(1, Math.max(0, 1 - q ** 4)); g *= w * w; }
    g *= share;
    const tilt = Math.max(-dot(d, n), 0);
    const area = d2 * share * Math.PI / Math.max(tilt, 0.25);
    out.push({p: [p[0] + n[0] * VPL_LIFT, p[1] + n[1] * VPL_LIFT, p[2] + n[2] * VPL_LIFT], r02: Math.max(soft * area, r0min2), n,
      f: [h.albedo[0] * g * L.rgb[0], h.albedo[1] * g * L.rgb[1], h.albedo[2] * g * L.rgb[2]]});
  }
  return out;
}

/** One VPL's contribution to receiver (p, n) before the gain (the kernel's `f`); zero outside its range window / hemispheres. */
export function vplTerm(v: Vpl, p: V3, n: V3, range = FB.params.value.z): V3 {
  const dv: V3 = [v.p[0] - p[0], v.p[1] - p[1], v.p[2] - p[2]];
  const r2 = Math.max(dot(dv, dv), 1e-6);
  const cr = Math.max(dot(n, dv), 0), ce = Math.max(-dot(v.n, dv), 0);
  if (cr * ce <= 0) return [0, 0, 0];
  const q = r2 / Math.max(range * range, 1e-6), win = Math.min(1, Math.max(0, 1 - q * q));
  if (win <= 0) return [0, 0, 0];
  const k = cr * ce * win * win / (r2 * (r2 + v.r02));
  return [v.f[0] * k, v.f[1] * k, v.f[2] * k];
}

const lum = (c: V3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The receiver's shadow-ray origin offset (rtKernels.ts GATHER eps). */
export const rayEps = (p: V3, eye: V3, base = 0.02): number => base * (1 + Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) * 0.05);

function seen(tr: Tracer, v: Vpl, p: V3, n: V3, eps: number): boolean {
  const o: V3 = [p[0] + n[0] * eps, p[1] + n[1] * eps, p[2] + n[2] * eps];
  const to: V3 = [v.p[0] - o[0], v.p[1] - o[1], v.p[2] - o[2]];
  const dist = Math.hypot(to[0], to[1], to[2]);
  return dist <= 2 * eps || !tr.any(o, [to[0] / dist, to[1] / dist, to[2] / dist], 1e-3, dist - eps);
}

/** The exact answers at a receiver: U (unshadowed) and E (every VPL shadow-tested), both x the gain. */
export function gatherExact(tr: Tracer | null, vpls: readonly (Vpl | null)[], p: V3, n: V3, eye: V3): {U: V3; E: V3; v: number} {
  const U: V3 = [0, 0, 0], E: V3 = [0, 0, 0], gain = FB.params.value.x, eps = rayEps(p, eye);
  let su = 0, se = 0;
  for (const v of vpls) {
    if (!v) continue;
    const f = vplTerm(v, p, n);
    if (f[0] + f[1] + f[2] <= 0) continue;
    U[0] += f[0]; U[1] += f[1]; U[2] += f[2];
    su += lum(f);
    if (!tr || seen(tr, v, p, n, eps)) { E[0] += f[0]; E[1] += f[1]; E[2] += f[2]; se += lum(f); }
  }
  return {U: [U[0] * gain, U[1] * gain, U[2] * gain], E: [E[0] * gain, E[1] * gain, E[2] * gain], v: su > 0 ? se / su : 1};
}

/** The WGSL's pcg hash (u32). */
export function pcg(s: number): number {
  const st = (Math.imul(s >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((st >>> (((st >>> 28) + 4) >>> 0)) ^ st) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** The kernel's one-frame visibility ratio v at a receiver of grid cell (gx, gy) in frame `frame` (STRATA reservoir picks). */
export function gatherStochastic(tr: Tracer, vpls: readonly (Vpl | null)[], p: V3, n: V3, eye: V3, gx: number, gy: number, frame: number): {U: V3; v: number} {
  const U: V3 = [0, 0, 0], wsum = new Array<number>(STRATA).fill(0), pick = new Array<number>(STRATA).fill(0);
  let seed = pcg((Math.imul(gx, 1973) + Math.imul(gy, 9277) + Math.imul(frame >>> 0, 26699)) >>> 0);
  const odd = ((frame + 1) & 1) !== 0; // (the runtime writes misc.y = (frame index + 1) & 1)
  for (let k = 0; k < vpls.length; k++) {
    const v = vpls[k];
    if (!v || v.f[0] + v.f[1] + v.f[2] <= 0) continue;
    const f = vplTerm(v, p, n);
    if (f[0] + f[1] + f[2] <= 0) continue;
    U[0] += f[0]; U[1] += f[1]; U[2] += f[2];
    const l = lum(f), gxk = k % VPL_GRID, gyk = Math.floor(k / VPL_GRID);
    const s = odd ? (gyk >= VPL_GRID / 2 ? 1 : 0) : (gxk >= VPL_GRID / 2 ? 1 : 0);
    wsum[s] += l;
    seed = pcg(seed);
    if ((seed >>> 8) * (1 / 16777216) * wsum[s] < l) pick[s] = k;
  }
  let vis = 1, sn = 0, tot = 0;
  const eps = rayEps(p, eye);
  for (let s = 0; s < STRATA; s++) {
    if (wsum[s] <= 0) continue;
    tot += wsum[s];
    if (seen(tr, vpls[pick[s]]!, p, n, eps)) sn += wsum[s];
  }
  if (tot > 0) vis = sn / tot;
  const gain = FB.params.value.x;
  return {U: [U[0] * gain, U[1] * gain, U[2] * gain], v: vis};
}
