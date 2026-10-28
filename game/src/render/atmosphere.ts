// Iteration 06 (Lane F): station atmosphere - tunables and the CPU mirror of the volumetric pass.
//
// The haze is a participating medium raymarched in front of the visible surface (render/volumetric.ts). Light reaches the
// camera by single in-scattering (Henyey-Greenstein dual-lobe phase function) from
//   (a) the flashlight spot cone - shadowed by the flashlight's shadow map, so the beam stops at walls, props and zombies;
//   (b) the baked fixture light field (world/lightField.ts, iteration 05) - lit fixtures get soft halos;
//   (c) the muzzle flash pulse;
//   (d) iteration 12: registered scatter lights (the thrown flare's red PointLight), occlusion-windowed (render/smoke.ts).
// The scene's FogExp2 (MOOD.fogDensity) stays the base extinction of the whole station.
//
// Iteration 12 (ATMOS) — "volumetric fog ... I just don't feel it. It should be dense in spots, in others sparser. It should
// flow and move slowly." What changed, honestly stated (no fluid simulation; a textured, advected density field):
//  - WORLD-SPACE PATCHES: sigma_s = density x area/storey multiplier (the per-level density map, unchanged as the base) x
//    height profile x PATCH(p) x DETAIL(p) + a GROUND layer. PATCH thresholds a low-frequency 3D gradient noise (one 48^3 RG8
//    tile = 1 / noiseScale = 16.7 m, lattice periods 2 + 4 => ~8 m blobs, histogram-equalised so `coverage` is the fraction of
//    space that is dense): clear pockets keep `clear` (12 %) of the base, dense patches ~2.4x, mean ~1. Coverage follows the
//    area multiplier (track beds / tunnels / service rooms more often dense, big halls more often clear). DETAIL is the
//    texture's second channel (periods 6 + 12 => 2.8 / 1.4 m wisps), +-45 %.
//  - GROUND FOG: an extra layer hugging the local floor (e-folding height 0.55 m, undulating +-50 % with the detail
//    channel), proportional to the area multiplier SQUARED: thick on track beds and in the lower service level, faint in
//    halls; it breaks up in the patch field's clear pockets too.
//  - FLOW: a per-storey drift map (buildFlowMap, RGBA8 like the density map: x / z drift up to 0.4 m/s, rise up to 0.15 m/s)
//    — the tunnel draft along the tracks (the station's draft direction is seeded), slower along platforms, the long axis
//    of every corridor / room, smoothed across area boundaries, plus gentle rising columns over working light fixtures (warm
//    spots). The patch field is advected by it with the standard two-phase flow-map scheme (two samples offset by
//    v * (phase - 0.5) * flowPeriod, phases half a period apart, triangle cross-fade), so local flow never shears the field
//    over time (each phase also jumps to a fresh noise offset at its own reset, so the field never loops), plus a slow rigid
//    station-wide drift (`wind`). Two texture samples per march step (each RG) instead of the previous two R samples: same
//    step counts.
//  - EXTINCTION: dense patches now also dim what is behind them (extra optical depth `patchExtinction` x the excess of
//    sigma over its unpatterned mean; clear pockets add none) and smoke has its own extinction — the march writes a
//    transmittance target (MRT) next to the in-scatter and the composite applies scene x T + in-scatter. The rest of the
//    view keeps the FogExp2 look, so geometry is never hidden wholesale.
// Every GLSL formula has a CPU mirror here (tests + CPU previews in tests/helpers/fogPreview.ts).

import {CELL, SOLID, VOID, type Grid} from '../gen/grid';
import type {LevelRole} from '../gen/levels';
import type {AreaKind, Archetype, RoomType, StationLayout} from '../gen/station';
import {cellFloorFn} from '../world/lightField';
import {stationLevels} from '../world/levelGeometry';

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
  /**
   * Drifting 3D noise: 1/m scale of one noise tile (iteration 12: the patch tile, 0.06 = 16.7 m), how patterned the medium is
   * (0 = uniform, 1 = full patches / wisps), and the rigid station-wide drift (m/s; its x follows the station's draft sign).
   */
  noiseScale: number;
  noiseAmount: number;
  wind: readonly [number, number, number];
  /** Iteration 12: vertical squash of the noise (> 1: patches flatter than wide, like layered haze). */
  noiseAnisotropy: number;
  /** Iteration 12: dense fraction at area multiplier 1, change per unit multiplier, and the patch edge softness (+-). */
  coverage: number;
  coverageSlope: number;
  coverageSoftness: number;
  /** Iteration 12: density kept in the clear pockets (fraction of the base). */
  clear: number;
  /** Iteration 12: wisp modulation (+- fraction) from the noise's detail channel. */
  detail: number;
  /** Iteration 12: ground layer — strength (x base density x area multiplier), e-folding height (m), height variation (+-). */
  ground: number;
  groundHeight: number;
  groundVariation: number;
  /** Iteration 12: seconds of one flow-map phase (two-phase advection). */
  flowPeriod: number;
  /** Iteration 12: extra extinction per unit excess sigma in dense patches; smoke extinction per unit smoke sigma. */
  patchExtinction: number;
  smokeExtinction: number;
  /** Iteration 12: gains on smoke in-scattering and on registered scatter lights (thrown flares). */
  smokeScatter: number;
  scatterLightScatter: number;
  /** Flashlight in-scatter fades in between these distances from the eye (no veil right at the lens). */
  nearFade: readonly [number, number];
  /** March length cap (m); the FogExp2 transmittance makes anything further negligible. */
  maxDistance: number;
  /** Output gain of the whole effect (1 = as tuned). */
  intensity: number;
  /** Density multiplier per area type / kind; `trackBed` = track-bed and tunnel cells. */
  areaDensity: Partial<Record<RoomType | AreaKind | 'trackBed' | 'default', number>>;
  /** Iteration 08: extra multiplier per level band (damp, dusty lower service level; airier upper deck). */
  levelDensity: Partial<Record<LevelRole, number>>;
  /** Surfaces also receive the flashlight shadow (consistent with the shadowed beam). */
  surfaceShadows: boolean;
}

/** Default (per-level) atmosphere: a dusty, patchy, slowly flowing haze (iteration 12). */
export const ATMOSPHERE: AtmosphereParams = {
  density: 0.03,
  heightFalloff: 0.32,
  refHeight: 1.6,
  anisotropy: 0.6,
  backAnisotropy: -0.3,
  backScatter: 0.3,
  // Iteration 06: tuned on CPU previews (qa-artifacts/iter06-fog). Iteration 12 (qa-artifacts/iter12-fog): denser, patchier
  // medium; fixtures scatter more so lit areas show the patches with the torch off; the beam's gain comes down (0.45 -> 0.32)
  // so a dense patch right in front of the lens does not veil the view.
  flashlightScatter: 0.32,
  fixtureScatter: 0.95,
  muzzleScatter: 0.6,
  noiseScale: 0.06,
  noiseAmount: 1,
  wind: [0.06, 0.012, 0.025],
  noiseAnisotropy: 1.7,
  coverage: 0.36,
  coverageSlope: 0.45,
  coverageSoftness: 0.12,
  clear: 0.12,
  detail: 0.45,
  ground: 1.3,
  groundHeight: 0.55,
  groundVariation: 0.5,
  flowPeriod: 14,
  patchExtinction: 1.5,
  smokeExtinction: 1,
  smokeScatter: 1,
  scatterLightScatter: 1,
  nearFade: [0.5, 3.2],
  maxDistance: 36,
  intensity: 1,
  // Iteration 12: wider spread between thick (track bed, tunnels, service / utility rooms) and airy (big halls).
  areaDensity: {
    default: 1, trackBed: 1.6, underpass: 1.45, platform: 1, passage: 1.1, 'service-corridor': 1.35, 'exit-stair': 0.95,
    concourse: 0.65, 'fare-hall': 0.7, 'food-court': 0.6, 'retail-arcade': 0.62, eatery: 0.7, shop: 0.72,
    washroom: 0.95, 'agent-office': 0.85, 'crew-room': 0.95, storage: 1.2, 'stock-room': 1.15, utility: 1.4,
    'supply-closet': 1.25, 'janitor-closet': 1.3, service: 1.25, room: 1, closet: 1.25, 'stair-core': 0.9,
  },
  levelDensity: {main: 1, upper: 0.85, lower: 1.3},
  surfaceShadows: true,
};

/** Per-level overrides (station archetype = "level" today; future levels add their own entries). */
export const ATMOSPHERE_BY_ARCHETYPE: Partial<Record<Archetype, Partial<AtmosphereParams>>> = {
  deep: {density: 0.034, coverage: 0.42},
  express: {density: 0.027},
};

export function atmosphereFor(layout: Pick<StationLayout, 'archetype'> | null, base: AtmosphereParams = ATMOSPHERE): AtmosphereParams {
  const o = layout ? ATMOSPHERE_BY_ARCHETYPE[layout.archetype] : undefined;
  return {...base, ...o, areaDensity: {...base.areaDensity, ...o?.areaDensity}, levelDensity: {...base.levelDensity, ...o?.levelDensity}};
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
  /**
   * Iteration 12: per-channel scattering weight at p (default [sigma, sigma, sigma]): the haze plus tinted smoke. When given,
   * `sigma` is only the early-out test.
   */
  scatter?: (p: V3) => V3;
  /** Iteration 12: extra extinction coefficient (1/m) at p (dense-patch excess + smoke); default none. */
  extinction?: (p: V3) => number;
}

/**
 * Iteration 12: mirror of the march loop — sum T_fog(t) T_vol(t) scatter(p) L(p) w over samples in front of the surface only,
 * with T_vol the volumetric transmittance accumulated so far (dense patches, smoke); returns it at the surface as well.
 */
export function integrateMedium(m: MarchInput): {inscatter: V3; transmittance: number} {
  const dist = Math.min(m.sceneDist, m.maxDistance);
  const {t, w} = marchSamples(dist, m.steps, m.jitter);
  const acc: V3 = [0, 0, 0];
  let tv = 1;
  for (let i = 0; i < t.length; i++) {
    const p: V3 = [m.origin[0] + m.dir[0] * t[i], m.origin[1] + m.dir[1] * t[i], m.origin[2] + m.dir[2] * t[i]];
    const s = m.sigma(p);
    if (s <= 0) continue;
    const L = m.radiance(p, t[i]);
    const tr = m.fogDensity * t[i];
    const k = w[i] * Math.exp(-tr * tr) * tv;
    const sc = m.scatter ? m.scatter(p) : [s, s, s];
    acc[0] += L[0] * sc[0] * k; acc[1] += L[1] * sc[1] * k; acc[2] += L[2] * sc[2] * k;
    if (m.extinction) tv *= Math.exp(-m.extinction(p) * w[i]);
  }
  return {inscatter: acc, transmittance: tv};
}

/** Mirror of the march loop's in-scatter (iteration 06 signature): integrateMedium without extinction terms. */
export function integrateInscatter(m: MarchInput): V3 {
  return integrateMedium(m).inscatter;
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

/** Transmittance at or above which the composite treats the medium as clear (exact passthrough without in-scatter). */
export const CLEAR_T = 0.9995;

/**
 * Mirror of the composite: scene pixel (sRGB-encoded, as the canvas would show it) x volumetric transmittance + in-scatter,
 * in scene-linear space under three's ACES curve. Iteration 12: `transmittance` (dense patches / smoke between the eye and
 * the surface; 1 = the iteration-06 composite).
 */
export function compositePixel(scene: V3, fog: V3, exposure: number, transmittance = 1): V3 {
  const tv = Math.min(1, Math.max(0, transmittance));
  if (Math.max(fog[0], fog[1], fog[2]) <= 1e-6 && tv >= CLEAR_T) return scene;
  const lin: V3 = [srgbDecode(scene[0]), srgbDecode(scene[1]), srgbDecode(scene[2])];
  const hdr = acesInverse(lin, exposure);
  const out = acesForward([hdr[0] * tv + fog[0], hdr[1] * tv + fog[1], hdr[2] * tv + fog[2]], exposure);
  // Never darker than the (attenuated) scene pixel (the inverse clamps saturated highlights).
  return [Math.max(scene[0] * tv, srgbEncode(out[0])), Math.max(scene[1] * tv, srgbEncode(out[1])), Math.max(scene[2] * tv, srgbEncode(out[2]))];
}

// ---------------------------------------------------------------------------------------------
// Per-station density map (area multiplier + local floor height) and the shared noise volume

/** Density multiplier range encoded in the map's R channel (0..255 -> 0..MAP_RANGE). */
export const DENSITY_MAP_RANGE = 2.5;

/**
 * Per-station medium map, one layer per level slot (iteration 08; slot s = layout.levels[s]): RGBA8
 * per texel: R = density multiplier / DENSITY_MAP_RANGE, G = local floor, B = local ceiling (both
 * yMin + v * yRange), A = 255 where the level's band exists (values are dilated into closed cells so
 * filtering stays smooth; A is not). The march picks the slot whose band holds the sample point.
 */
export interface DensityMap {
  w: number; h: number;
  /** Level slots (layers of the map). */
  slots: number;
  /** RGBA8, layer-major: ((slot * h + y) * w + x) * 4. */
  data: Uint8Array;
  yMin: number; yRange: number;
  /** World size of one texel (m). */
  cell: number;
}

export function areaMultiplier(layout: StationLayout, i: number, p: Pick<AtmosphereParams, 'areaDensity'>, grid: Grid = layout.grid): number {
  const g = grid, ad = p.areaDensity;
  if (g.cells[i] === VOID) return ad.trackBed ?? ad.default ?? 1;
  const a = layout.areas[g.area[i]];
  if (!a) return ad.default ?? 1;
  return ad[a.type] ?? ad[a.kind] ?? ad.default ?? 1;
}

export function buildDensityMap(layout: StationLayout, p: Pick<AtmosphereParams, 'areaDensity'> & Partial<Pick<AtmosphereParams, 'levelDensity'>>): DensityMap {
  const levels = stationLevels(layout).slice(0, 4);
  const g0 = layout.grid, W = g0.w, H = g0.h, n = W * H, S = levels.length;
  const per = levels.map(L => {
    const g = L.grid;
    const floorOf = cellFloorFn(g, layout.trench.floorY);
    const lm = p.levelDensity?.[L.role] ?? 1;
    let mult = new Float32Array(n), floor = new Float32Array(n), ceil = new Float32Array(n);
    const open = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (g.cells[i] === SOLID) continue;
      open[i] = 1;
      const cx = i % W, cy = (i - cx) / W;
      floor[i] = floorOf(cx, cy);
      ceil[i] = g.hasCeil(i) && g.ceil[i] > floor[i] + 0.5 ? g.ceil[i] : floor[i] + 3;
      mult[i] = areaMultiplier(layout, i, p, g) * lm;
    }
    // Dilate open values into closed cells (no density dip / floor jump when filtering next to walls).
    let known = open.slice();
    for (let it = 0; it < 3; it++) {
      const nk = known.slice(), nm = mult.slice(), nf = floor.slice(), nc = ceil.slice();
      for (let i = 0; i < n; i++) {
        if (known[i]) continue;
        const cx = i % W;
        let s = 0, f = 0, c = 0, k = 0;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          if (j < 0 || j >= n || !known[j] || Math.abs((j % W) - cx) > 1) continue;
          s += mult[j]; f += floor[j]; c += ceil[j]; k++;
        }
        if (k) { nm[i] = s / k; nf[i] = f / k; nc[i] = c / k; nk[i] = 1; }
      }
      known = nk; mult = nm; floor = nf; ceil = nc;
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
    return {open, known, mult, floor, ceil, base: L.baseY};
  });
  let yMin = Infinity, yMax = -Infinity;
  for (const q of per) for (let i = 0; i < n; i++) if (q.open[i]) { yMin = Math.min(yMin, q.floor[i]); yMax = Math.max(yMax, q.ceil[i]); }
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 3; }
  const yRange = Math.max(0.01, yMax - yMin);
  const data = new Uint8Array(n * S * 4);
  const u8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  per.forEach((q, s) => {
    for (let i = 0; i < n; i++) {
      const o = (s * n + i) * 4;
      const m = q.known[i] ? q.mult[i] : (p.areaDensity.default ?? 1);
      data[o] = u8(m / DENSITY_MAP_RANGE);
      data[o + 1] = u8(((q.known[i] ? q.floor[i] : q.base) - yMin) / yRange);
      data[o + 2] = u8(((q.known[i] ? q.ceil[i] : q.base + 3) - yMin) / yRange);
      data[o + 3] = q.open[i] ? 255 : 0;
    }
  });
  return {w: W, h: H, slots: S, data, yMin, yRange, cell: CELL};
}

/**
 * Sample like the GPU (texel centres at cell centres, clamp to edge, per layer): [multiplier, floorY]
 * of the level slot whose band holds height y (slot 0 when y is omitted or nothing is present).
 */
export function sampleDensityMap(m: DensityMap, x: number, z: number, y?: number): [number, number] {
  const u = x / m.cell - 0.5, v = z / m.cell - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const S = m.slots ?? 1;
  let best = Infinity, out: [number, number] | null = null, first: [number, number] = [0, 0];
  for (let s = 0; s < S; s++) {
    let r = 0, gch = 0, bch = 0, ach = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const xx = Math.min(m.w - 1, Math.max(0, iu + a)), yy = Math.min(m.h - 1, Math.max(0, iv + b));
      const wgt = (a ? fu : 1 - fu) * (b ? fv : 1 - fv);
      const o = ((s * m.h + yy) * m.w + xx) * 4;
      r += wgt * m.data[o]; gch += wgt * m.data[o + 1]; bch += wgt * m.data[o + 2]; ach += wgt * m.data[o + 3];
    }
    const res: [number, number] = [r / 255 * DENSITY_MAP_RANGE, m.yMin + gch / 255 * m.yRange];
    if (s === 0) first = res;
    if (y === undefined || ach < 127.5) continue;
    const ce = m.yMin + bch / 255 * m.yRange;
    const d = Math.max(res[1] - y, y - ce);
    if (d < best) { best = d; out = res; }
  }
  return out ?? first;
}

/** Iteration 12: the shared noise tile — 48^3 texels, two channels (RG8). */
export const NOISE_SIZE = 48;
export const NOISE_CHANNELS = 2;
/** Lattice periods per tile: R = patch field (~8 m / ~4 m features at the default 16.7 m tile), G = wisps (~2.8 / 1.4 m). */
export const NOISE_OCTAVES = {patch: [{p: 2, w: 0.62}, {p: 4, w: 0.38}], detail: [{p: 6, w: 0.6}, {p: 12, w: 0.4}]} as const;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Tileable 3D gradient (Perlin-style) noise, octaves of lattice period P per `size` texels, quintic fade. */
function gradientNoiseTile(size: number, octaves: readonly {p: number; w: number}[], rnd: () => number): Float32Array {
  const out = new Float32Array(size ** 3);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  for (const o of octaves) {
    const P = o.p, g = new Float32Array(P ** 3 * 3);
    for (let i = 0; i < P ** 3; i++) {
      // uniform direction on the sphere
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      g[i * 3] = Math.cos(a) * r; g[i * 3 + 1] = Math.sin(a) * r; g[i * 3 + 2] = z;
    }
    const k = P / size;
    for (let zz = 0; zz < size; zz++) for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
      const fx = xx * k, fy = yy * k, fz = zz * k;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const u = fade(tx), v = fade(ty), w = fade(tz);
      let acc = 0;
      for (let c = 0; c < 2; c++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const gi = ((((iz + c) % P) * P + ((iy + b) % P)) * P + ((ix + a) % P)) * 3;
        const d = g[gi] * (tx - a) + g[gi + 1] * (ty - b) + g[gi + 2] * (tz - c);
        acc += d * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w);
      }
      out[(zz * size + yy) * size + xx] += o.w * acc;
    }
  }
  return out;
}

/** Histogram equalisation to a uniform [0, 255] (ranks): thresholds on the channel are coverage fractions. */
function equalise(v: Float32Array): Uint8Array {
  const sorted = Float32Array.from(v).sort();
  const out = new Uint8Array(v.length), n = v.length;
  for (let i = 0; i < n; i++) {
    let lo = 0, hi = n - 1;
    const x = v[i];
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
    out[i] = Math.round(lo / (n - 1) * 255);
  }
  return out;
}

/**
 * Iteration 12: tileable 3D noise as interleaved RG8 (texel i: [2i] patch, [2i + 1] detail), both channels gradient-noise
 * octaves histogram-equalised to uniform. Deterministic.
 */
export function buildNoiseVolume(size = NOISE_SIZE, seed = 0x6c6c6e): Uint8Array {
  const rnd = mulberry32(seed);
  const r = equalise(gradientNoiseTile(size, NOISE_OCTAVES.patch, rnd));
  const g = equalise(gradientNoiseTile(size, NOISE_OCTAVES.detail, rnd));
  const out = new Uint8Array(size ** 3 * NOISE_CHANNELS);
  for (let i = 0; i < r.length; i++) { out[i * 2] = r[i]; out[i * 2 + 1] = g[i]; }
  return out;
}

/** Trilinear, repeat-wrapped sample of one channel (texture coords: 1 = one tile), like the GPU. */
export function sampleNoise(vol: Uint8Array, q: V3, size = NOISE_SIZE, channel = 0): number {
  const ch = vol.length >= size ** 3 * NOISE_CHANNELS ? NOISE_CHANNELS : 1;
  const u = q[0] * size - 0.5, v = q[1] * size - 0.5, w = q[2] * size - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), iw = Math.floor(w), fu = u - iu, fv = v - iv, fw = w - iw;
  const wrap = (i: number) => ((i % size) + size) % size;
  let acc = 0;
  for (let c = 0; c < 2; c++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    acc += (a ? fu : 1 - fu) * (b ? fv : 1 - fv) * (c ? fw : 1 - fw) * vol[((wrap(iw + c) * size + wrap(iv + b)) * size + wrap(iu + a)) * ch + Math.min(channel, ch - 1)];
  }
  return acc / 255;
}

// ---------------------------------------------------------------------------------------------
// Iteration 12: per-storey drift map (the "flow" of the haze)

/** Drift encoding range: x / z drift +-FLOW_MAX m/s (R, G at 0.5 = still), rise 0..RISE_MAX m/s (B). */
export const FLOW_MAX = 0.4;
export const RISE_MAX = 0.15;
/** Noise offset (tile units) a flow phase jumps by at each of its resets (invisible: its weight is 0 there). */
export const FLOW_CYCLE: V3 = [0.37, 0.21, 0.53];
/** Drift speeds (m/s): along the track bed / tunnels (the draft), along platforms, corridors, rooms, big halls. */
export const FLOW_SPEED = {track: 0.26, platform: 0.13, corridor: 0.11, room: 0.06, hall: 0.045, rise: 0.07} as const;

export interface FlowMap {
  w: number; h: number; slots: number;
  /** RGBA8, layer-major like DensityMap: R / G = x / z drift, B = rise, A = 255 where the storey is open. */
  data: Uint8Array;
  /** Station draft direction along the tracks (+1 = toward +x), seeded. */
  draft: 1 | -1;
}

const HALLS = new Set(['concourse', 'fare-hall', 'food-court', 'retail-arcade']);
const CORRIDORS = new Set(['passage', 'service-corridor', 'underpass', 'exit-stair']);

/**
 * Builds the drift map per level slot (same texel grid as the density map): the tunnel draft runs along the tracks (x; the
 * direction is seeded per station), platforms carry it more slowly, every other area drifts along its long axis (toward +x
 * with the draft, or away from the track bed along z: the tunnels push air out to the exits), slower in rooms and big halls;
 * four 3 x 3 smoothing passes blend area boundaries; working fixtures add a gentle rising column (warm spots).
 */
export function buildFlowMap(layout: StationLayout): FlowMap {
  const levels = stationLevels(layout).slice(0, 4);
  const g0 = layout.grid, W = g0.w, H = g0.h, n = W * H, S = levels.length;
  const draft: 1 | -1 = ((layout.seed >>> 0) * 2654435761 >>> 0) % 2 === 0 ? 1 : -1;
  const trenchZ = layout.trenches?.length ? layout.trenches.reduce((a, t) => a + (t.z0 + t.z1) / 2, 0) / layout.trenches.length : (layout.trench ? (layout.trench.z0 + layout.trench.z1) / 2 : H * CELL / 2);
  const data = new Uint8Array(n * S * 4);
  const u8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  levels.forEach((L, s) => {
    const g = L.grid;
    let vx = new Float32Array(n), vz = new Float32Array(n);
    const open = new Uint8Array(n), rise = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (g.cells[i] === SOLID) continue;
      open[i] = 1;
      if (g.cells[i] === VOID) { vx[i] = draft * FLOW_SPEED.track; continue; }
      const a = layout.areas[g.area[i]];
      if (!a) continue;
      if (a.kind === 'platform') { vx[i] = draft * FLOW_SPEED.platform; continue; }
      const speed = CORRIDORS.has(a.type) || CORRIDORS.has(a.kind) ? FLOW_SPEED.corridor : HALLS.has(a.type) ? FLOW_SPEED.hall : FLOW_SPEED.room;
      if (a.w >= a.h) vx[i] = draft * speed;
      else vz[i] = ((a.y + a.h / 2) * CELL >= trenchZ ? 1 : -1) * speed;
    }
    for (let it = 0; it < 4; it++) {
      const nx = vx.slice(), nz = vz.slice();
      for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
        const i = cy * W + cx;
        if (!open[i]) continue;
        let sx = 0, sz = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const j = y * W + x;
          if (!open[j]) continue;
          sx += vx[j]; sz += vz[j]; c++;
        }
        nx[i] = sx / c; nz[i] = sz / c;
      }
      vx = nx; vz = nz;
    }
    // warm spots: working fixtures of this storey heat a column of air (Gaussian, ~1.2 m radius)
    for (const l of layout.lights) {
      if (l.broken) continue;
      const slot = Math.max(0, levels.findIndex(q => q.id === (l.level ?? 0)));
      if (slot !== s) continue;
      const cx0 = Math.floor(l.x / CELL), cy0 = Math.floor(l.z / CELL);
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx0 + dx, y = cy0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (!open[j]) continue;
        rise[j] = Math.min(RISE_MAX, rise[j] + FLOW_SPEED.rise * (0.4 + 0.6 * (l.power ?? 1)) * Math.exp(-(dx * dx + dy * dy) * CELL * CELL / (2 * 0.6 * 0.6)));
      }
    }
    for (let i = 0; i < n; i++) {
      const o = (s * n + i) * 4;
      data[o] = u8(0.5 + vx[i] / (2 * FLOW_MAX));
      data[o + 1] = u8(0.5 + vz[i] / (2 * FLOW_MAX));
      data[o + 2] = u8(rise[i] / RISE_MAX);
      data[o + 3] = open[i] ? 255 : 0;
    }
  });
  return {w: W, h: H, slots: S, data, draft};
}

/** Bilinear sample of one flow layer like the GPU: [vx, vz, rise] in m/s. */
export function sampleFlowMap(f: FlowMap, x: number, z: number, slot: number): V3 {
  const u = x / CELL - 0.5, v = z / CELL - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const s = Math.min(Math.max(0, slot), f.slots - 1);
  let r = 0, gch = 0, b = 0;
  for (let bb = 0; bb < 2; bb++) for (let a = 0; a < 2; a++) {
    const xx = Math.min(f.w - 1, Math.max(0, iu + a)), yy = Math.min(f.h - 1, Math.max(0, iv + bb));
    const wgt = (a ? fu : 1 - fu) * (bb ? fv : 1 - fv);
    const o = ((s * f.h + yy) * f.w + xx) * 4;
    r += wgt * f.data[o]; gch += wgt * f.data[o + 1]; b += wgt * f.data[o + 2];
  }
  return [(r / 255 * 2 - 1) * FLOW_MAX, (gch / 255 * 2 - 1) * FLOW_MAX, b / 255 * RISE_MAX];
}

/** Level slot whose band holds height y at (x, z) — the CPU stand-in for the march's light-field band pick. */
export function densitySlot(m: DensityMap, x: number, z: number, y: number): number {
  const u = x / m.cell - 0.5, v = z / m.cell - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  let best = Infinity, slot = 0;
  for (let s = 0; s < (m.slots ?? 1); s++) {
    let gch = 0, bch = 0, ach = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const xx = Math.min(m.w - 1, Math.max(0, iu + a)), yy = Math.min(m.h - 1, Math.max(0, iv + b));
      const wgt = (a ? fu : 1 - fu) * (b ? fv : 1 - fv);
      const o = ((s * m.h + yy) * m.w + xx) * 4;
      gch += wgt * m.data[o + 1]; bch += wgt * m.data[o + 2]; ach += wgt * m.data[o + 3];
    }
    if (ach < 127.5) continue;
    const fl = m.yMin + gch / 255 * m.yRange, ce = m.yMin + bch / 255 * m.yRange;
    const d = Math.max(fl - y, y - ce);
    if (d < best) { best = d; slot = s; }
  }
  return slot;
}

/** Bilinear [multiplier, floorY] of one density layer. */
function sampleDensityLayer(m: DensityMap, x: number, z: number, s: number): [number, number] {
  const u = x / m.cell - 0.5, v = z / m.cell - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  let r = 0, gch = 0;
  for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const xx = Math.min(m.w - 1, Math.max(0, iu + a)), yy = Math.min(m.h - 1, Math.max(0, iv + b));
    const wgt = (a ? fu : 1 - fu) * (b ? fv : 1 - fv);
    const o = ((s * m.h + yy) * m.w + xx) * 4;
    r += wgt * m.data[o]; gch += wgt * m.data[o + 1];
  }
  return [r / 255 * DENSITY_MAP_RANGE, m.yMin + gch / 255 * m.yRange];
}

const smooth01 = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export interface MediumSample {
  /** Haze scattering coefficient sigma_s (1/m). */
  sigma: number;
  /** Its excess over the unpatterned mean (dense patches; drives the extra extinction). */
  excess: number;
  /** Detail channel (0..1) at p (smoke wisps). */
  detail: number;
  /** Patch field 0 (clear pocket) .. 1 (dense patch). */
  dense: number;
}

/**
 * Mirror of vfMedium (iteration 12): the haze at p and game time `time`. `flow` null = no local drift (rigid `wind` only);
 * `draft` = the station draft sign applied to wind.x.
 */
export function mediumAt(p: V3, map: DensityMap | null, flow: FlowMap | null, noise: Uint8Array | null, params: AtmosphereParams, time: number): MediumSample {
  const slot = map ? densitySlot(map, p[0], p[2], p[1]) : 0;
  const [mult, floorY] = map ? sampleDensityLayer(map, p[0], p[2], slot) : [1, 0];
  const h = p[1] - floorY;
  const hf = Math.min(3, Math.max(0.2, Math.exp(-params.heightFalloff * (h - params.refHeight))));
  const base0 = params.density * mult;
  const groundRef = params.ground * mult * Math.exp(-Math.max(h, 0) / Math.max(params.groundHeight, 0.05));
  if (!noise || params.noiseAmount <= 0) {
    const sigma = base0 * (hf + groundRef);
    return {sigma, excess: 0, detail: 0.5, dense: 0.5};
  }
  const S = params.noiseScale, A = params.noiseAnisotropy, sv: V3 = [S, S * A, S];
  const draft = flow?.draft ?? 1;
  const wind: V3 = [params.wind[0] * draft * sv[0], params.wind[1] * sv[1], params.wind[2] * sv[2]];
  const v = flow ? sampleFlowMap(flow, p[0], p[2], slot) : [0, 0, 0] as V3;
  const vel: V3 = [v[0], v[2], v[1]]; // (x drift, rise, z drift)
  const P = Math.max(1, params.flowPeriod);
  const ph = ((time / P) % 1 + 1) % 1, ph2 = (ph + 0.5) % 1, wa = 1 - Math.abs(2 * ph - 1);
  // each phase jumps to a fresh noise offset at its own reset (where its weight is 0): the field never loops
  const ca = Math.floor(time / P), cb = Math.floor(time / P + 0.5);
  const base: V3 = [p[0] * sv[0] - wind[0] * time, p[1] * sv[1] - wind[1] * time, p[2] * sv[2] - wind[2] * time];
  const at = (k: number, c: number): V3 => [base[0] - vel[0] * sv[0] * k + c * FLOW_CYCLE[0], base[1] - vel[1] * sv[1] * k + c * FLOW_CYCLE[1], base[2] - vel[2] * sv[2] * k + c * FLOW_CYCLE[2]];
  const qa = at((ph - 0.5) * P, ca), qb = at((ph2 - 0.5) * P, cb);
  const nr = sampleNoise(noise, qb, NOISE_SIZE, 0) * (1 - wa) + sampleNoise(noise, qa, NOISE_SIZE, 0) * wa;
  const ng = sampleNoise(noise, qb, NOISE_SIZE, 1) * (1 - wa) + sampleNoise(noise, qa, NOISE_SIZE, 1) * wa;
  const cover = Math.min(0.65, Math.max(0.12, params.coverage + params.coverageSlope * (mult - 1)));
  const dense = smooth01(1 - cover - params.coverageSoftness, 1 - cover + params.coverageSoftness, nr);
  const peak = (1 - params.clear * (1 - cover)) / cover;
  const amt = params.noiseAmount;
  const patchF = 1 + amt * (params.clear + (peak - params.clear) * dense - 1);
  const detailF = 1 + amt * params.detail * (ng - 0.5) * 2;
  const gh = params.groundHeight * (1 + params.groundVariation * (ng - 0.5) * 2);
  const groundT = params.ground * mult * Math.exp(-Math.max(h, 0) / Math.max(gh, 0.05)) * (1 + amt * (0.35 + 1.05 * dense - 1));
  const sigma = base0 * (hf * patchF * detailF + groundT);
  return {sigma, excess: Math.max(0, sigma - base0 * (hf + groundRef)), detail: ng, dense};
}

/** Mirror of the haze's sigma_s at p (iteration-06 signature; iteration 12: mediumAt without local flow). */
export function densityAt(p: V3, map: DensityMap | null, noise: Uint8Array | null, params: AtmosphereParams, time: number, flow: FlowMap | null = null): number {
  return mediumAt(p, map, flow, noise, params, time).sigma;
}
