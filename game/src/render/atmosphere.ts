// Iteration 06 (Lane F): station atmosphere - tunables and the CPU mirror of the volumetric pass.
//
// The haze is a thin participating medium: a scattering coefficient that varies with the local area
// (track bed / tunnels / service corridors thicker than halls), with height above the local floor and
// with slowly drifting 3D noise. Light reaches the camera by single in-scattering (Henyey-Greenstein
// dual-lobe phase function) from
//   (a) the flashlight spot cone - shadowed by the flashlight's shadow map, so the beam stops at
//       walls, props and zombies;
//   (b) the baked fixture light field (world/lightField.ts, iteration 05) - lit fixtures get soft halos;
//   (c) the muzzle flash pulse.
// Extinction of what lies behind the haze stays the scene's existing FogExp2 (MOOD.fogDensity), which
// also attenuates the in-scattered light, so with the flashlight off the r5 look is preserved apart
// from faint glows around working fixtures. The GPU pass lives in volumetric.ts / volumetricShaders.ts;
// every formula there has a mirror here (tests + CPU previews).

import {CELL, SOLID, VOID} from '../gen/grid';
import type {AreaKind, Archetype, RoomType, StationLayout} from '../gen/station';
import {cellFloorFn} from '../world/lightField';

export type AtmosphereQuality = 'off' | 'low' | 'high';

export interface AtmosphereParams {
  /** Scattering coefficient sigma_s (1/m) at `refHeight` above the floor in an area with multiplier 1. */
  density: number;
  /** Height falloff (1/m): density x exp(-k (h - refHeight)) with h above the LOCAL floor, clamped 0.2..3. */
  heightFalloff: number;
  refHeight: number;
  /** Henyey-Greenstein forward lobe g, backward lobe g, and the backward lobe's weight (0..1). */
  anisotropy: number;
  backAnisotropy: number;
  backScatter: number;
  /** Gains on each light's in-scattering (1 = physical for the given density). */
  flashlightScatter: number;
  fixtureScatter: number;
  muzzleScatter: number;
  /** Drifting 3D noise: 1/m scale of one noise tile, modulation amount (0 = uniform), wind (m/s). */
  noiseScale: number;
  noiseAmount: number;
  wind: readonly [number, number, number];
  /** Flashlight in-scatter fades in between these distances from the eye (no veil right at the lens). */
  nearFade: readonly [number, number];
  /** March length cap (m); the FogExp2 transmittance makes anything further negligible. */
  maxDistance: number;
  /** Output gain of the whole effect (1 = as tuned). */
  intensity: number;
  /** Density multiplier per area type / kind; `trackBed` = track-bed and tunnel cells. */
  areaDensity: Partial<Record<RoomType | AreaKind | 'trackBed' | 'default', number>>;
  /** Surfaces also receive the flashlight shadow (consistent with the shadowed beam). */
  surfaceShadows: boolean;
}

/** Default (per-level) atmosphere: a light, dusty haze. */
export const ATMOSPHERE: AtmosphereParams = {
  density: 0.02,
  heightFalloff: 0.32,
  refHeight: 1.6,
  anisotropy: 0.6,
  backAnisotropy: -0.3,
  backScatter: 0.3,
  // Tuned on CPU previews (qa-artifacts/iter06-fog): a soft lit haze in the beam, no veil over the view.
  flashlightScatter: 0.45,
  fixtureScatter: 0.5,
  muzzleScatter: 0.6,
  noiseScale: 0.08,
  noiseAmount: 0.85,
  wind: [0.11, 0.015, 0.06],
  nearFade: [0.5, 3.2],
  maxDistance: 36,
  intensity: 1,
  areaDensity: {
    default: 1, trackBed: 1.45, underpass: 1.3, platform: 1, passage: 1.05, 'service-corridor': 1.2, 'exit-stair': 1,
    concourse: 0.85, 'fare-hall': 0.85, 'food-court': 0.8, 'retail-arcade': 0.8, eatery: 0.75, shop: 0.75,
    washroom: 0.9, 'agent-office': 0.9, 'crew-room': 0.95, storage: 1.15, 'stock-room': 1.1, utility: 1.25,
    'supply-closet': 1.2, 'janitor-closet': 1.2, service: 1.15, room: 1, closet: 1.2,
  },
  surfaceShadows: true,
};

/** Per-level overrides (station archetype = "level" today; future levels add their own entries). */
export const ATMOSPHERE_BY_ARCHETYPE: Partial<Record<Archetype, Partial<AtmosphereParams>>> = {
  deep: {density: 0.024},
  express: {density: 0.019},
};

export function atmosphereFor(layout: Pick<StationLayout, 'archetype'> | null, base: AtmosphereParams = ATMOSPHERE): AtmosphereParams {
  const o = layout ? ATMOSPHERE_BY_ARCHETYPE[layout.archetype] : undefined;
  return {...base, ...o, areaDensity: {...base.areaDensity, ...o?.areaDensity}};
}

export interface QualityPreset {
  /** March resolution as a fraction of the drawing buffer, capped at `maxPixels`. */
  scale: number;
  maxPixels: number;
  /** Raymarch steps per pixel (quadratically spaced, jittered). */
  steps: number;
  /** Flashlight spot shadow map size. */
  shadowMapSize: number;
  /** Reprojected temporal accumulation of the jittered march. */
  temporal: boolean;
  /** MSAA samples of the scene render target (the canvas uses 4x). */
  msaa: number;
}

export const ATMOSPHERE_QUALITY: Record<Exclude<AtmosphereQuality, 'off'>, QualityPreset> = {
  high: {scale: 0.5, maxPixels: 960 * 540, steps: 24, shadowMapSize: 1024, temporal: true, msaa: 4},
  low: {scale: 0.25, maxPixels: 480 * 270, steps: 14, shadowMapSize: 512, temporal: true, msaa: 0},
};

/** Low-res march size for a drawing buffer (scale, then pixel cap). */
export function marchSize(w: number, h: number, q: QualityPreset): [number, number] {
  let lw = Math.max(1, Math.round(w * q.scale)), lh = Math.max(1, Math.round(h * q.scale));
  if (lw * lh > q.maxPixels) {
    const k = Math.sqrt(q.maxPixels / (lw * lh));
    lw = Math.max(1, Math.floor(lw * k)); lh = Math.max(1, Math.floor(lh * k));
  }
  return [lw, lh];
}

/**
 * Spot shadow depth bias (in [0,1] depth units) for a spot of half-angle `angle` (rad) and map size:
 * covers the depth spread of one texel on a floor/wall grazed from ~1 m away (constant with distance
 * for a perspective map), x2 margin. The light sits next to the eye, so the resulting peter-panning is
 * hidden behind the caster itself.
 */
export function shadowBiasFor(mapSize: number, angle: number, near = SHADOW_NEAR): number {
  const texel = (2 * angle) / mapSize;
  return -2 * near * texel / 1.0;
}
export const SHADOW_NEAR = 0.2;
export const SHADOW_NORMAL_BIAS = 0.02;

// ---------------------------------------------------------------------------------------------
// Math mirrors (identical formulas to volumetricShaders.ts)

export type V3 = [number, number, number];

export function hg(c: number, g: number): number {
  const g2 = g * g;
  return (1 - g2) / (4 * Math.PI * Math.pow(Math.max(1 + g2 - 2 * g * c, 1e-4), 1.5));
}

/** Dual-lobe HG phase (1/sr). c = cos(angle between light propagation and the direction to the eye). */
export function phase(c: number, p: Pick<AtmosphereParams, 'anisotropy' | 'backAnisotropy' | 'backScatter'>): number {
  return hg(c, p.anisotropy) * (1 - p.backScatter) + hg(c, p.backAnisotropy) * p.backScatter;
}

/** three's getDistanceAttenuation. */
export function distanceAttenuation(d: number, cutoff: number, decay: number): number {
  let a = 1 / Math.max(Math.pow(Math.max(d, 1e-4), decay), 0.01);
  if (cutoff > 0) { const q = (d / cutoff) ** 2; a *= Math.min(1, Math.max(0, 1 - q * q)) ** 2; }
  return a;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** three's perspectiveDepthToViewZ, as a positive distance in front of the camera. */
export function viewZFromDepth(depth: number, near: number, far: number): number {
  return -(near * far) / ((far - near) * depth - far);
}

/** Interleaved gradient noise (Jimenez 2014), per pixel + frame offset. */
export function ign(x: number, y: number): number {
  const f = (v: number) => v - Math.floor(v);
  return f(52.9829189 * f(x * 0.06711056 + y * 0.00583715));
}

/**
 * Jittered, quadratically spaced march samples over [0, dist]: t = dist u^2 with u = (i + j) / N,
 * weight = dt/du / N (unbiased stratified estimate of the integral; denser near the eye, where the
 * flashlight's energy is).
 */
export function marchSamples(dist: number, steps: number, jitter: number): {t: number[]; w: number[]} {
  const t: number[] = [], w: number[] = [];
  for (let i = 0; i < steps; i++) {
    const u = (i + jitter) / steps;
    t.push(dist * u * u);
    w.push(2 * dist * u / steps);
  }
  return {t, w};
}

export interface MarchInput {
  origin: V3;
  dir: V3;
  /** Distance to the visible surface along the ray (Infinity for nothing): the march stops there. */
  sceneDist: number;
  steps: number;
  jitter: number;
  maxDistance: number;
  fogDensity: number;
  /** sigma_s at p (1/m). */
  sigma: (p: V3) => number;
  /** In-scattered radiance per unit sigma at p toward the eye (rgb), t = distance from the eye. */
  radiance: (p: V3, t: number) => V3;
}

/** Mirror of the march loop: sum T(t) sigma(p) L(p) w over samples in front of the surface only. */
export function integrateInscatter(m: MarchInput): V3 {
  const dist = Math.min(m.sceneDist, m.maxDistance);
  const {t, w} = marchSamples(dist, m.steps, m.jitter);
  const acc: V3 = [0, 0, 0];
  for (let i = 0; i < t.length; i++) {
    const p: V3 = [m.origin[0] + m.dir[0] * t[i], m.origin[1] + m.dir[1] * t[i], m.origin[2] + m.dir[2] * t[i]];
    const s = m.sigma(p);
    if (s <= 0) continue;
    const L = m.radiance(p, t[i]);
    const tr = m.fogDensity * t[i];
    const k = s * w[i] * Math.exp(-tr * tr);
    acc[0] += L[0] * k; acc[1] += L[1] * k; acc[2] += L[2] * k;
  }
  return acc;
}

export interface SpotInput {
  pos: V3;
  dir: V3;
  coneCos: number;
  penumbraCos: number;
  /** Linear colour x intensity x flashlightScatter. */
  color: V3;
  distance: number;
  decay: number;
}

/** Mirror of the flashlight term (per unit sigma): colour x spot x attenuation x shadow x phase x near fade. */
export function flashlightRadiance(p: V3, t: number, viewDir: V3, s: SpotInput, params: AtmosphereParams, shadow: (p: V3) => number): V3 {
  const lv: V3 = [p[0] - s.pos[0], p[1] - s.pos[1], p[2] - s.pos[2]];
  const ld = Math.max(Math.hypot(lv[0], lv[1], lv[2]), 1e-4);
  const l: V3 = [lv[0] / ld, lv[1] / ld, lv[2] / ld];
  const spot = smoothstep(s.coneCos, s.penumbraCos, l[0] * s.dir[0] + l[1] * s.dir[1] + l[2] * s.dir[2]);
  if (spot <= 0) return [0, 0, 0];
  const nf = smoothstep(params.nearFade[0], params.nearFade[1], t);
  const k = spot * nf * distanceAttenuation(ld, s.distance, s.decay) * shadow(p) * phase(-(l[0] * viewDir[0] + l[1] * viewDir[1] + l[2] * viewDir[2]), params);
  return [s.color[0] * k, s.color[1] * k, s.color[2] * k];
}

/** Mirror of the fixture term: gain x (amb / pi + dirColour x phase(dir to light . view dir)). */
export function fixtureRadiance(amb: V3, dirColor: V3, dirToLight: V3, viewDir: V3, params: AtmosphereParams): V3 {
  const ph = phase(dirToLight[0] * viewDir[0] + dirToLight[1] * viewDir[1] + dirToLight[2] * viewDir[2], params);
  const g = params.fixtureScatter;
  return [g * (amb[0] / Math.PI + dirColor[0] * ph), g * (amb[1] / Math.PI + dirColor[1] * ph), g * (amb[2] / Math.PI + dirColor[2] * ph)];
}

// --- Composite: in-scatter is added in scene-linear space "before" three's ACES tone mapping ---------

/** three's ACES matrices (row-major here). */
export const ACES_IN: readonly number[] = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777];
export const ACES_OUT: readonly number[] = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];

export function mul3(m: readonly number[], v: readonly number[]): V3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

export function inv3(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
export const ACES_IN_INV = inv3(ACES_IN);
export const ACES_OUT_INV = inv3(ACES_OUT);

const rrt = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
/** Inverse of RRTAndODTFit on [0, 0.99] (positive root of the quadratic). */
export function rrtInv(y: number): number {
  const yy = Math.min(0.99, Math.max(0, y));
  const A = yy * 0.983729 - 1, B = yy * 0.4329510 - 0.0245786, C = yy * 0.238081 + 0.000090537;
  return (-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
}

/** three's ACESFilmicToneMapping (scene-linear rgb -> display-linear, clamped). */
export function acesForward(c: V3, exposure: number): V3 {
  const k = exposure / 0.6;
  const v = mul3(ACES_IN, [c[0] * k, c[1] * k, c[2] * k]);
  const o = mul3(ACES_OUT, [rrt(v[0]), rrt(v[1]), rrt(v[2])]);
  return [Math.min(1, Math.max(0, o[0])), Math.min(1, Math.max(0, o[1])), Math.min(1, Math.max(0, o[2]))];
}

/** Approximate inverse of acesForward (exact for unclamped values). */
export function acesInverse(d: V3, exposure: number): V3 {
  const u = mul3(ACES_OUT_INV, d);
  const v = mul3(ACES_IN_INV, [rrtInv(u[0]), rrtInv(u[1]), rrtInv(u[2])]);
  const k = 0.6 / exposure;
  return [Math.max(0, v[0] * k), Math.max(0, v[1] * k), Math.max(0, v[2] * k)];
}

/** Depth similarity sharpness of the composite's bilateral upsample (exp(-k * relative depth gap)). */
export const BILATERAL_K = 25;

/**
 * Mirror of the composite's depth-aware upsample: the 2x2 low-res neighbours (in-scatter, their view
 * depth, bilinear weight) for a full-res pixel at view depth z. Fog marched for a far surface does not
 * bleed over a near silhouette (and vice versa); nearest-depth fallback when nothing matches.
 */
export function bilateralUpsample(samples: readonly {fog: V3; z: number; wb: number}[], z: number): V3 {
  const acc: V3 = [0, 0, 0];
  let wsum = 0, best: V3 = [0, 0, 0], bestDz = Infinity;
  for (const s of samples) {
    const dz = Math.abs(s.z - z) / Math.max(z, 0.05);
    const w = Math.max(s.wb, 1e-3) * Math.exp(-dz * BILATERAL_K);
    acc[0] += s.fog[0] * w; acc[1] += s.fog[1] * w; acc[2] += s.fog[2] * w;
    wsum += w;
    if (dz < bestDz) { bestDz = dz; best = s.fog; }
  }
  return wsum > 1e-4 ? [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum] : best;
}

export const srgbDecode = (c: number) => c <= 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
export const srgbEncode = (c: number) => c <= 0.0031308 ? c * 12.92 : Math.pow(c, 0.41666) * 1.055 - 0.055;

/** Mirror of the composite: scene pixel (sRGB-encoded, as the canvas would show it) + in-scatter. */
export function compositePixel(scene: V3, fog: V3, exposure: number): V3 {
  if (Math.max(fog[0], fog[1], fog[2]) <= 1e-6) return scene;
  const lin: V3 = [srgbDecode(scene[0]), srgbDecode(scene[1]), srgbDecode(scene[2])];
  const hdr = acesInverse(lin, exposure);
  const out = acesForward([hdr[0] + fog[0], hdr[1] + fog[1], hdr[2] + fog[2]], exposure);
  // Never darker than the scene pixel (the inverse clamps saturated highlights).
  return [Math.max(scene[0], srgbEncode(out[0])), Math.max(scene[1], srgbEncode(out[1])), Math.max(scene[2], srgbEncode(out[2]))];
}

// ---------------------------------------------------------------------------------------------
// Per-station density map (area multiplier + local floor height) and the shared noise volume

/** Density multiplier range encoded in the map's R channel (0..255 -> 0..MAP_RANGE). */
export const DENSITY_MAP_RANGE = 2.5;

export interface DensityMap {
  w: number; h: number;
  /** RG8: R = area density multiplier / DENSITY_MAP_RANGE, G = local floor height (yMin + G * yRange). */
  data: Uint8Array;
  yMin: number; yRange: number;
  /** World size of one texel (m). */
  cell: number;
}

export function areaMultiplier(layout: StationLayout, i: number, p: Pick<AtmosphereParams, 'areaDensity'>): number {
  const g = layout.grid, ad = p.areaDensity;
  if (g.cells[i] === VOID) return ad.trackBed ?? ad.default ?? 1;
  const a = layout.areas[g.area[i]];
  if (!a) return ad.default ?? 1;
  return ad[a.type] ?? ad[a.kind] ?? ad.default ?? 1;
}

export function buildDensityMap(layout: StationLayout, p: Pick<AtmosphereParams, 'areaDensity'>): DensityMap {
  const g = layout.grid, W = g.w, H = g.h, n = W * H;
  const floorOf = cellFloorFn(g, layout.trench.floorY);
  let mult = new Float32Array(n), floor = new Float32Array(n);
  const open = new Uint8Array(n);
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (g.cells[i] === SOLID) continue;
    open[i] = 1;
    const cx = i % W, cy = (i - cx) / W;
    floor[i] = floorOf(cx, cy);
    mult[i] = areaMultiplier(layout, i, p);
    yMin = Math.min(yMin, floor[i]); yMax = Math.max(yMax, floor[i]);
  }
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 0; }
  // Dilate open values into solid cells (no density dip / floor jump when filtering next to walls).
  let known = open.slice();
  for (let it = 0; it < 3; it++) {
    const nk = known.slice(), nm = mult.slice(), nf = floor.slice();
    for (let i = 0; i < n; i++) {
      if (known[i]) continue;
      const cx = i % W;
      let s = 0, f = 0, c = 0;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j < 0 || j >= n || !known[j] || Math.abs((j % W) - cx) > 1) continue;
        s += mult[j]; f += floor[j]; c++;
      }
      if (c) { nm[i] = s / c; nf[i] = f / c; nk[i] = 1; }
    }
    known = nk; mult = nm; floor = nf;
  }
  // Soften area boundaries (two 3x3 box passes on the multiplier).
  for (let it = 0; it < 2; it++) {
    const nm = mult.slice();
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      if (!known[i]) continue;
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (!known[j]) continue;
        s += mult[j]; c++;
      }
      nm[i] = s / c;
    }
    mult = nm;
  }
  const yRange = Math.max(0.01, yMax - yMin);
  const data = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    const m = known[i] ? mult[i] : (p.areaDensity.default ?? 1);
    data[i * 2] = Math.round(Math.min(1, Math.max(0, m / DENSITY_MAP_RANGE)) * 255);
    data[i * 2 + 1] = Math.round(Math.min(1, Math.max(0, ((known[i] ? floor[i] : 0) - yMin) / yRange)) * 255);
  }
  return {w: W, h: H, data, yMin, yRange, cell: CELL};
}

/** Bilinear sample like the GPU (texel centres at cell centres, clamp to edge): [multiplier, floorY]. */
export function sampleDensityMap(m: DensityMap, x: number, z: number): [number, number] {
  const u = x / m.cell - 0.5, v = z / m.cell - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  let r = 0, gch = 0;
  for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const xx = Math.min(m.w - 1, Math.max(0, iu + a)), yy = Math.min(m.h - 1, Math.max(0, iv + b));
    const wgt = (a ? fu : 1 - fu) * (b ? fv : 1 - fv);
    const o = (yy * m.w + xx) * 2;
    r += wgt * m.data[o]; gch += wgt * m.data[o + 1];
  }
  return [r / 255 * DENSITY_MAP_RANGE, m.yMin + gch / 255 * m.yRange];
}

export const NOISE_SIZE = 32;

/** Tileable 3D value noise (3 octaves, lattice periods 4/8/16 per tile) as R8, deterministic. */
export function buildNoiseVolume(size = NOISE_SIZE, seed = 0x6c6c6e): Uint8Array {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const octaves = [{p: 4, w: 0.5}, {p: 8, w: 0.3}, {p: 16, w: 0.2}].map(o => ({...o, lat: Float32Array.from({length: o.p ** 3}, rnd)}));
  const out = new Uint8Array(size ** 3);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (const o of octaves) {
      const P = o.p, k = P / size;
      const fx = x * k, fy = y * k, fz = z * k;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz);
      const L = (a: number, b: number, c: number) => o.lat[((c % P) * P + (b % P)) * P + (a % P)];
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const c00 = lerp(L(ix, iy, iz), L(ix + 1, iy, iz), tx), c10 = lerp(L(ix, iy + 1, iz), L(ix + 1, iy + 1, iz), tx);
      const c01 = lerp(L(ix, iy, iz + 1), L(ix + 1, iy, iz + 1), tx), c11 = lerp(L(ix, iy + 1, iz + 1), L(ix + 1, iy + 1, iz + 1), tx);
      v += o.w * lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
    }
    out[(z * size + y) * size + x] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return out;
}

/** Trilinear, repeat-wrapped sample (texture coords: 1 = one tile), like the GPU. */
export function sampleNoise(vol: Uint8Array, q: V3, size = NOISE_SIZE): number {
  const u = q[0] * size - 0.5, v = q[1] * size - 0.5, w = q[2] * size - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), iw = Math.floor(w), fu = u - iu, fv = v - iv, fw = w - iw;
  const wrap = (i: number) => ((i % size) + size) % size;
  let acc = 0;
  for (let c = 0; c < 2; c++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    acc += (a ? fu : 1 - fu) * (b ? fv : 1 - fv) * (c ? fw : 1 - fw) * vol[(wrap(iw + c) * size + wrap(iv + b)) * size + wrap(iu + a)];
  }
  return acc / 255;
}

/** Second noise octave offset (shader constant). */
export const NOISE_OCTAVE2: {scale: number; offset: V3} = {scale: 2.71, offset: [0.37, 0.11, 0.73]};

/** Mirror of vfDensity: sigma_s at p. */
export function densityAt(p: V3, map: DensityMap | null, noise: Uint8Array | null, params: AtmosphereParams, time: number): number {
  const [mult, floorY] = map ? sampleDensityMap(map, p[0], p[2]) : [1, 0];
  const hf = Math.min(3, Math.max(0.2, Math.exp(-params.heightFalloff * (p[1] - floorY - params.refHeight))));
  let nf = 1;
  if (noise && params.noiseAmount > 0) {
    const s = params.noiseScale, wv = params.wind;
    const q: V3 = [p[0] * s + wv[0] * s * time, p[1] * s + wv[1] * s * time, p[2] * s + wv[2] * s * time];
    const o = NOISE_OCTAVE2;
    const n = sampleNoise(noise, q) * 0.65 + sampleNoise(noise, [q[0] * o.scale + o.offset[0], q[1] * o.scale + o.offset[1], q[2] * o.scale + o.offset[2]]) * 0.35;
    nf = Math.max(0, 1 + params.noiseAmount * (n * 2 - 1) * 1.6);
  }
  return params.density * mult * hf * nf;
}
