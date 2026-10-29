// CPU fog preview (Lane F, iteration 06; QA only, no WebGL). Takes Lane L's 2.5D station preview
// (lightPreview.ts: architecture + baked light field + flashlight, r5 mood) as the "canvas" image and
// runs the volumetric pass's CPU mirror on top of it per pixel: the same jittered quadratic march to
// the visible surface, density map + height + noise medium, dual-lobe HG flashlight in-scatter with
// occlusion (2.5D ray from the flashlight instead of the shadow map), fixture in-scatter from the
// baked field, FogExp2 transmittance and the scene-linear ACES composite. No props/zombies/textures:
// this previews where and how strongly the haze shows, not final shading.
// Iteration 12 (ATMOS): the iteration-12 medium (mediumAt: flow-advected patches, wisps, ground layer), the extinction of
// dense patches / smoke (transmittance composite), optional smoke puffs (render/smoke.ts) and one scatter light (a flare).
import {castRay, renderPreview, type PreviewCamera, type PreviewMood, type PreviewScene} from './lightPreview';
import {sampleField, type BakedField} from '../../src/world/lightField';
import {
  compositeLinear, distanceAttenuation, fixtureRadiance, flashlightRadiance, ign, integrateMedium, mediumAt, phase,
  type AirMap, type AtmosphereParams, type DensityMap, type FogMotion, type SpotInput, type V3,
} from '../../src/render/atmosphere';
import type {SmokeField} from '../../src/render/smoke';

export interface FogPreviewOptions {
  mood: PreviewMood & {exposure: number; flashlight: number; fogDensity: number};
  field: BakedField;
  params: AtmosphereParams;
  density: DensityMap;
  noise: Uint8Array;
  width: number;
  height: number;
  flashlight: boolean;
  fog: boolean;
  time: number;
  steps?: number;
  levels?: number[];
  /** Iteration 13: air map + the station's fog motion (null: no moving fields => the unpatterned medium). */
  air?: AirMap | null;
  motion?: FogMotion | null;
  /** Iteration 12: smoke puffs and a scatter light (flare): position, linear colour x intensity, distance, decay. */
  smoke?: SmokeField | null;
  scatterLight?: {pos: V3; color: V3; distance: number; decay: number} | null;
}

const lin = (h: number): V3 => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255].map(c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)) as V3;

export function renderFogPreview(sc: PreviewScene, cam: PreviewCamera, o: FogPreviewOptions): Buffer {
  const W = o.width, H = o.height;
  const base = renderPreview(sc, cam, {mode: 'after', mood: o.mood, field: o.field, width: W, height: H, flashlight: o.flashlight, levels: o.levels});
  if (!o.fog) return base;
  const out = Buffer.from(base);
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const fwd: V3 = [-sy * cp, sp, -cy * cp], right: V3 = [cy, 0, -sy], up: V3 = [sy * sp, cp, cy * sp];
  const tanF = Math.tan(cam.fov * Math.PI / 360);
  const eye: V3 = [cam.x, cam.y, cam.z];
  const at = (x: number, y: number, z: number): V3 => [eye[0] + right[0] * x + up[0] * y - fwd[0] * z, eye[1] + right[1] * x + up[1] * y - fwd[1] * z, eye[2] + right[2] * x + up[2] * y - fwd[2] * z];
  // game.ts flashlight: camera-local position (0.2, -0.15, 0.1), target (0.04, -0.12, -6).
  const fpos = at(0.2, -0.15, 0.1), ftgt = at(0.04, -0.12, -6);
  const fd: V3 = [ftgt[0] - fpos[0], ftgt[1] - fpos[1], ftgt[2] - fpos[2]];
  const fl = Math.hypot(...fd);
  const fc = lin(0xfff4e2), k = o.flashlight ? o.mood.flashlight * o.params.flashlightScatter : 0;
  const spot: SpotInput = {pos: fpos, dir: [fd[0] / fl, fd[1] / fl, fd[2] / fl], coneCos: Math.cos(0.58), penumbraCos: Math.cos(0.58 * 0.3), color: [fc[0] * k, fc[1] * k, fc[2] * k], distance: 30, decay: 1.2};
  const levels = o.levels ?? [1, 1, 1];
  const occluded = (from: V3, p: V3): boolean => {
    const v: V3 = [p[0] - from[0], p[1] - from[1], p[2] - from[2]];
    const d = Math.hypot(...v);
    const h = castRay(sc, from, [v[0] / d, v[1] / d, v[2] / d], d);
    return !!h && h.t < d - 0.05;
  };
  const shadow = (p: V3): number => (occluded(fpos, p) ? 0 : 1);
  const sl = o.scatterLight ?? null;
  const steps = o.steps ?? 24;
  const P = o.params;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const u = ((px + 0.5) / W * 2 - 1) * tanF * W / H, v = (1 - (py + 0.5) / H * 2) * tanF;
    const d: V3 = [fwd[0] + right[0] * u + up[0] * v, fwd[1] + right[1] * u + up[1] * v, fwd[2] + right[2] * u + up[2] * v];
    const dl = Math.hypot(...d); d[0] /= dl; d[1] /= dl; d[2] /= dl;
    const hit = castRay(sc, eye, d, 72);
    // one medium evaluation per sample point (the march calls sigma, scatter and extinction at the same p)
    let lastP: V3 | null = null, lastM = {sigma: 0, excess: 0, detail: 0.5, smoke: 0, tint: [0, 0, 0] as V3};
    const med = (p: V3) => {
      if (lastP && lastP[0] === p[0] && lastP[1] === p[1] && lastP[2] === p[2]) return lastM;
      const m = mediumAt(p, {map: o.density, air: o.air ?? null, noise: o.noise, motion: o.motion ?? null}, P, o.time);
      let smoke = 0, tint: V3 = [0, 0, 0];
      if (o.smoke?.emitters.length) {
        const s = o.smoke.densityAt(p);
        // occlusion window stand-in: smoke only where its emitter can see it; wisps from the detail channel
        const em = o.smoke.emitters.find((_, i) => s.byEmitter[i] > 0);
        const vis = em && !occluded([em.x, em.y + 0.25, em.z], p) ? 1 : 0;
        const wisp = 0.45 + 1.1 * m.detail;
        smoke = s.sigma * vis * wisp;
        tint = [s.tinted[0] * vis * wisp, s.tinted[1] * vis * wisp, s.tinted[2] * vis * wisp];
      }
      lastP = p; lastM = {sigma: m.sigma, excess: m.excess, detail: m.detail, smoke, tint};
      return lastM;
    };
    const r = integrateMedium({
      origin: eye, dir: d, sceneDist: hit ? hit.t : Infinity, steps, jitter: ign(px, py), maxDistance: P.maxDistance, fogDensity: o.mood.fogDensity,
      sigma: p => { const m = med(p); return m.sigma + m.smoke; },
      scatter: p => { const m = med(p); return [m.sigma + m.tint[0] * P.smokeScatter, m.sigma + m.tint[1] * P.smokeScatter, m.sigma + m.tint[2] * P.smokeScatter]; },
      extinction: p => { const m = med(p); return m.excess * P.patchExtinction + m.smoke * P.smokeExtinction; },
      radiance: (p, t) => {
        const L: V3 = k > 0 ? flashlightRadiance(p, t, d, spot, P, shadow) : [0, 0, 0];
        const s = sampleField(o.field, p[0], p[1], p[2], levels);
        const f = fixtureRadiance(s.amb, s.dirColor, s.dir, d, P);
        const out: V3 = [L[0] + f[0], L[1] + f[1], L[2] + f[2]];
        if (sl) {
          const lv: V3 = [p[0] - sl.pos[0], p[1] - sl.pos[1], p[2] - sl.pos[2]];
          const ld = Math.hypot(...lv);
          if ((sl.distance <= 0 || ld <= sl.distance) && !occluded(sl.pos, p)) {
            const a = distanceAttenuation(Math.max(ld, 0.3), sl.distance, sl.decay) * phase(-(lv[0] * d[0] + lv[1] * d[1] + lv[2] * d[2]) / Math.max(ld, 1e-4), P) * P.scatterLightScatter;
            out[0] += sl.color[0] * a; out[1] += sl.color[1] * a; out[2] += sl.color[2] * a;
          }
        }
        return out;
      },
    });
    const i = (py * W + px) * 3;
    const fog: V3 = [r.inscatter[0] * P.intensity, r.inscatter[1] * P.intensity, r.inscatter[2] * P.intensity];
    const c = compositeSrgb([base[i] / 255, base[i + 1] / 255, base[i + 2] / 255], fog, o.mood.exposure, r.transmittance);
    out[i] = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
    out[i + 1] = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
    out[i + 2] = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
  }
  return out;
}

// --- preview-only composite: the preview image is already tone-mapped sRGB, so invert three's ACES (at the exposure), apply
// the linear composite (render/atmosphere.ts compositeLinear, what the GPU does before its output transform), re-apply ACES.
const ACES_IN = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777];
const ACES_OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
const mul3 = (m: readonly number[], v: readonly number[]): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
function inv3(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const ACES_IN_INV = inv3(ACES_IN), ACES_OUT_INV = inv3(ACES_OUT);
const rrt = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
const rrtInv = (y: number) => { const yy = Math.min(0.99, Math.max(0, y)); const A = yy * 0.983729 - 1, B = yy * 0.4329510 - 0.0245786, C = yy * 0.238081 + 0.000090537; return (-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A); };
const dec = (c: number) => c <= 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
const enc = (c: number) => c <= 0.0031308 ? c * 12.92 : Math.pow(c, 0.41666) * 1.055 - 0.055;
function compositeSrgb(scene: V3, fog: V3, exposure: number, transmittance: number): V3 {
  const lin3: V3 = [dec(scene[0]), dec(scene[1]), dec(scene[2])];
  const u = mul3(ACES_OUT_INV, lin3);
  const v = mul3(ACES_IN_INV, [rrtInv(u[0]), rrtInv(u[1]), rrtInv(u[2])]);
  const hdr: V3 = [Math.max(0, v[0] * 0.6 / exposure), Math.max(0, v[1] * 0.6 / exposure), Math.max(0, v[2] * 0.6 / exposure)];
  const c = compositeLinear(hdr, fog, transmittance);
  const k = exposure / 0.6, w = mul3(ACES_IN, [c[0] * k, c[1] * k, c[2] * k]);
  const o = mul3(ACES_OUT, [rrt(w[0]), rrt(w[1]), rrt(w[2])]);
  return [enc(Math.min(1, Math.max(0, o[0]))), enc(Math.min(1, Math.max(0, o[1]))), enc(Math.min(1, Math.max(0, o[2])))];
}
