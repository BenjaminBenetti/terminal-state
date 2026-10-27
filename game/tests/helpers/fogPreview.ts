// CPU fog preview (Lane F, iteration 06; QA only, no WebGL). Takes Lane L's 2.5D station preview
// (lightPreview.ts: architecture + baked light field + flashlight, r5 mood) as the "canvas" image and
// runs the volumetric pass's CPU mirror on top of it per pixel: the same jittered quadratic march to
// the visible surface, density map + height + noise medium, dual-lobe HG flashlight in-scatter with
// occlusion (2.5D ray from the flashlight instead of the shadow map), fixture in-scatter from the
// baked field, FogExp2 transmittance and the scene-linear ACES composite. No props/zombies/textures:
// this previews where and how strongly the haze shows, not final shading.
import {castRay, renderPreview, type PreviewCamera, type PreviewMood, type PreviewScene} from './lightPreview';
import {sampleField, type BakedField} from '../../src/world/lightField';
import {
  compositePixel, densityAt, fixtureRadiance, flashlightRadiance, ign, integrateInscatter,
  type AtmosphereParams, type DensityMap, type SpotInput, type V3,
} from '../../src/render/atmosphere';

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
  const shadow = (p: V3): number => {
    const v: V3 = [p[0] - fpos[0], p[1] - fpos[1], p[2] - fpos[2]];
    const d = Math.hypot(...v);
    const h = castRay(sc, fpos, [v[0] / d, v[1] / d, v[2] / d], d);
    return !h || h.t >= d - 0.05 ? 1 : 0;
  };
  const steps = o.steps ?? 24;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const u = ((px + 0.5) / W * 2 - 1) * tanF * W / H, v = (1 - (py + 0.5) / H * 2) * tanF;
    const d: V3 = [fwd[0] + right[0] * u + up[0] * v, fwd[1] + right[1] * u + up[1] * v, fwd[2] + right[2] * u + up[2] * v];
    const dl = Math.hypot(...d); d[0] /= dl; d[1] /= dl; d[2] /= dl;
    const hit = castRay(sc, eye, d, 72);
    const fog = integrateInscatter({
      origin: eye, dir: d, sceneDist: hit ? hit.t : Infinity, steps, jitter: ign(px, py), maxDistance: o.params.maxDistance, fogDensity: o.mood.fogDensity,
      sigma: p => densityAt(p, o.density, o.noise, o.params, o.time),
      radiance: (p, t) => {
        const L: V3 = k > 0 ? flashlightRadiance(p, t, d, spot, o.params, shadow) : [0, 0, 0];
        const s = sampleField(o.field, p[0], p[1], p[2], levels);
        const f = fixtureRadiance(s.amb, s.dirColor, s.dir, d, o.params);
        return [L[0] + f[0], L[1] + f[1], L[2] + f[2]];
      },
    });
    const i = (py * W + px) * 3;
    const c = compositePixel([base[i] / 255, base[i + 1] / 255, base[i + 2] / 255], [fog[0] * o.params.intensity, fog[1] * o.params.intensity, fog[2] * o.params.intensity], o.mood.exposure);
    out[i] = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
    out[i + 1] = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
    out[i + 2] = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
  }
  return out;
}
