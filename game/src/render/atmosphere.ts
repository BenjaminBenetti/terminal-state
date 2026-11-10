// Station atmosphere: tunables, the per-station medium maps and the CPU mirror of the volumetric pass (render/volumetric.ts).
//
// The haze is a participating medium raymarched in front of the visible surface. Light reaches the camera by single
// in-scattering (Henyey-Greenstein dual-lobe phase function) from
//   (a) the flashlight spot cone - shadowed by the flashlight's shadow map, so the beam stops at walls, props and zombies;
//   (b) the baked fixture light field (world/lightField.ts) - lit fixtures light the haze around them, no light through
//       walls or slabs (the field is baked with line of sight, one band per storey);
//   (c) the muzzle flash pulse;
//   (d) registered scatter lights (the thrown flare's red PointLight), occlusion-windowed (render/smoke.ts), and smoke.
// The scene's FogExp2 (MOOD.fogDensity) stays the near-black distance falloff of every surface.
//
// Iteration 13 (FOG) — user: "the fog seems to disappear after I move into an area ... running back the fog seems to go
// away? it should not. Also I want slightly less fog. I want foggy areas, and non foggy areas. The fog does not appear to
// move it should. Lighting should light the fog." Root cause (reference/tasks/fog-webgpu-20261028/lanes/fog.notes): the
// iteration-12 two-phase flow-map cross-fade jumped to a fresh noise offset every 14 s, so patches were re-rolled instead of
// moved, and the station-wide amount swung 3x as the sampled slice of the noise tile moved. The medium is now:
//  - PERSISTENT: sigma(x, y, z, t) is a pure function of the world point, the station seed and the station's fog clock
//    (game time since the station started; pause freezes it). No history, no camera input, no resets, no offset jumps.
//  - MOVING: every noise field TRANSLATES with a constant world velocity (no shear, no re-roll): the air drifts at
//    `drift` m/s in a seeded direction, the track beds carry the tunnel draft along the tracks at `trackDrift` m/s (a
//    spatial blend between the two, fixed in time), and a faster wisp / warp field (`detailDrift`, rising slowly) bends
//    the patch field as it passes through it (domain warp: billowing / swirl). The field offsets are folded mod one tile
//    on the CPU in double precision and handed to the shader (no float32 drift after hours of play).
//  - AREAS: each area gets a seeded class (clear / normal / dense, by area type: halls and shops are often clear, service
//    rooms often dense; track beds always carry the draft fog, the lower level is damper). Clear areas keep a few % of the
//    base density with almost no dense patches; inside normal / dense areas dense patches alternate with clear pockets.
//  - STATIONARY: the patch noise has 4 + 8 lattice periods per 30 m tile and only translates horizontally, so the
//    station-wide amount stays steady (tests: < +-10 % over 5 min vs 3.5x before).
// Every TSL formula has a CPU mirror here (tests, CPU previews, __LL.fogSample).

import {CELL, SOLID, VOID, type Grid} from '../gen/grid';
import type {LevelRole} from '../gen/levels';
import type {AreaKind, Archetype, RoomType, StationLayout} from '../gen/station';
import {cellFloorFn} from '../world/lightField';
import {stationLevels} from '../world/levelGeometry';
import {MAX_SLOTS} from '../world/lightField';
import {RIDE_MASK_SKIN, inRideMask, type RideMaskState} from '../world/rideMask'; // task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL)
import {drainSync, type BuildSteps} from '../core/pacedBuild'; // task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD)
import {REACTOR_ATMOSPHERE, reactorRockRooms} from '../world/reactor/archHaze'; // task reactor-build-20261101 (lane ARCH); (+ rock rooms: task reactor-playtest-round2-20261102, lane GAS)

export type AtmosphereQuality = 'off' | 'low' | 'high';

export type AreaClass = 'clear' | 'normal' | 'dense';

export interface AtmosphereParams {
  /** Scattering coefficient sigma_s (1/m) at `refHeight` above the floor in an area with multiplier 1 (mean patch level). */
  density: number;
  /** Height falloff (1/m): density x exp(-k (h - refHeight)) with h above the LOCAL floor, clamped 0.25..2.5. */
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
  /** 1/m scale of one PATCH noise tile (1/30: a 30 m tile, lattice periods 4 + 8 => 3.5-7 m patches). */
  noiseScale: number;
  /** 1/m scale of one WISP / WARP noise tile (1/18). */
  detailScale: number;
  /** How patterned the medium is (0 = uniform per area, 1 = full patches / wisps). */
  noiseAmount: number;
  /** Vertical squash of the noise (> 1: patches flatter than wide, like layered haze). */
  noiseAnisotropy: number;
  /** Dense fraction at area multiplier 1, change per unit multiplier, patch edge softness (+-). */
  coverage: number;
  coverageSlope: number;
  coverageSoftness: number;
  /**
   * Patch level of the clear pockets (x base) in a normal area, rising to `pocketDense` in dense areas / track beds
   * (multiplier 1 -> 1.6: a foggy area never drains while its patches drift through), and of the dense patches.
   */
  clear: number;
  pocketDense: number;
  peak: number;
  /** Wisp modulation (+- fraction) from the wisp channel. */
  detail: number;
  /** Ground layer: strength (x base x area multiplier), e-folding height (m), height variation (+-). */
  ground: number;
  groundHeight: number;
  groundVariation: number;
  /** Domain-warp amplitude (m) of the patch field by the moving wisp / warp field (swirl / billowing). */
  warp: number;
  /** Air drift (m/s, seeded horizontal direction), tunnel draft along the tracks (m/s), wisp / warp field drift (m/s), rise (m/s). */
  drift: number;
  trackDrift: number;
  detailDrift: number;
  rise: number;
  /** Extra extinction per unit excess sigma in dense patches; smoke extinction per unit smoke sigma. */
  patchExtinction: number;
  smokeExtinction: number;
  /** Gains on smoke in-scattering and on registered scatter lights (thrown flares). */
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
  /** Extra multiplier per level band (damp, dusty lower service level; airier upper deck). */
  levelDensity: Partial<Record<LevelRole | 'roof', number>>;
  /** Iteration 13: multiplier of a clear / dense area (normal = 1). */
  classDensity: Record<AreaClass, number>;
  /** Iteration 13: chance of an area being clear / dense, per area group (seeded per station + area). */
  classOdds: Record<AreaGroup, {clear: number; dense: number}>;
  /** Surfaces also receive the flashlight shadow (consistent with the shadowed beam). */
  surfaceShadows: boolean;
  /**
   * Task reactor-playtest-round2-20261102 (lane GAS): the haze of a level's ROOMS CUT INTO THE ROCK (world/reactor/archHaze.ts
   * reactorRockRooms: the Reactor's side complexes + its pit side rooms): this multiplier and class group replace the area's type /
   * kind lookup. Only the Reactor sets it; absent = every area exactly as before.
   */
  rockRoom?: {density: number; group: AreaGroup};
  /**
   * Task reactor-surface-redesign-credits-20261103 (primary): the Reactor's OUTDOOR haze cap — the haze term fades out between these
   * absolute heights over its surface deck (gas / smoke / depth strata untouched), so no lit haze column rises into the open sky.
   * Only a Reactor layout with a surface exit sets it (atmosphereFor); absent = exactly as before.
   */
  skyCap?: {y0: number; y1: number};
}

/** Area groups for the clear / dense draw. */
export type AreaGroup = 'hall' | 'room' | 'service' | 'corridor' | 'platform';

/**
 * Default atmosphere (iteration 13). Before -> after (documented in lanes/fog.notes):
 *  - density 0.030 -> 0.020 base (deep 0.034 -> 0.023, express 0.027 -> 0.019), ~40 % of halls / rooms are now CLEAR
 *    (x 0.05), ~20 % of rooms and half the service rooms DENSE (x 1.4), track beds x 1.5: the station-mean sigma at walking
 *    height drops to ~0.65-0.8 of the iteration-12 time average (measured per seed in tests/fog-medium.test.ts) and no
 *    longer swings with time; the clear areas hold almost none;
 *  - fixture / flashlight scatter up (0.95 -> 1.15, 0.32 -> 0.4) so the remaining haze reads as lit where the light is.
 */
export const ATMOSPHERE: AtmosphereParams = {
  density: 0.02,
  heightFalloff: 0.32,
  refHeight: 1.6,
  anisotropy: 0.6,
  backAnisotropy: -0.3,
  backScatter: 0.3,
  flashlightScatter: 0.4,
  fixtureScatter: 1.15,
  muzzleScatter: 0.6,
  noiseScale: 1 / 30,
  detailScale: 1 / 18,
  noiseAmount: 1,
  noiseAnisotropy: 1.7,
  coverage: 0.32,
  coverageSlope: 0.42,
  coverageSoftness: 0.1,
  clear: 0.2,
  pocketDense: 0.55,
  peak: 2.3,
  detail: 0.42,
  ground: 1.1,
  groundHeight: 0.55,
  groundVariation: 0.5,
  warp: 2.2,
  // Iteration 15 (user: "the fog is moving too much ... half the speed"): every fog motion rate halved ONCE here (the
  // only source: fogMotion -> field offsets / shader uniforms / smoke drift): air 0.38 -> 0.19 m/s, tunnel draft
  // 0.75 -> 0.375, wisp / warp billowing 0.6 -> 0.3, rise 0.08 -> 0.04. Amount, pattern, warp size and clock unchanged.
  drift: 0.19,
  trackDrift: 0.375,
  detailDrift: 0.3,
  rise: 0.04,
  patchExtinction: 1.5,
  smokeExtinction: 1,
  smokeScatter: 1,
  // Iteration 15: flares (the only scatter lights) are 6x brighter on surfaces (FLARE.light 7 -> 42 cd); their fog glow
  // goes up 2.4x (1 -> 0.4 per cd), a stronger red halo without washing the view red.
  scatterLightScatter: 0.4,
  nearFade: [0.5, 3.2],
  maxDistance: 36,
  intensity: 1,
  areaDensity: {
    default: 1, trackBed: 1.5, underpass: 1.45, platform: 1, passage: 1.1, 'service-corridor': 1.35, 'exit-stair': 0.95,
    concourse: 0.7, 'fare-hall': 0.75, 'food-court': 0.65, 'retail-arcade': 0.68, eatery: 0.75, shop: 0.78,
    washroom: 0.95, 'agent-office': 0.85, 'crew-room': 0.95, storage: 1.2, 'stock-room': 1.15, utility: 1.4,
    'supply-closet': 1.25, 'janitor-closet': 1.3, service: 1.25, room: 1, closet: 1.25, 'stair-core': 0.9,
    // Iteration 16 (WORLD-GEN): office tower — daylit floors read airier than the station's back-of-house.
    'office-lobby': 0.7, 'office-open': 0.8, 'office-corridor': 0.85, 'office-room': 0.9, 'office-elevator': 0.6, 'office-stair': 1.05,
  },
  // Task office-seamless-20261029: 'office' = the tower storeys above the lobby: indoor office air, a light haze (less than
  // the station's main level and the lobby deck).
  // Task office-overhaul-20261030 (lane ARCH): 'roof' = the open roof storey: the outdoor murk there is the scene fog (green on the
  // roof: world/officeAtmosphere.ts) and the exterior's own fog; the lit indoor haze stays light up there.
  levelDensity: {main: 1, upper: 0.85, lower: 1.25, office: 0.75, roof: 0.35},
  classDensity: {clear: 0.05, normal: 1, dense: 1.4},
  classOdds: {
    hall: {clear: 0.45, dense: 0.1},
    room: {clear: 0.4, dense: 0.25},
    service: {clear: 0, dense: 0.5},
    corridor: {clear: 0.3, dense: 0.15},
    platform: {clear: 0, dense: 0},
  },
  surfaceShadows: true,
};

/** Iteration-12 defaults that matter for the before / after comparison (tests, notes). */
export const ATMOSPHERE_ITER12 = {density: 0.03, fixtureScatter: 0.95, flashlightScatter: 0.32} as const;

/** Per-level overrides (station archetype = "level" today; future levels add their own entries). */
export const ATMOSPHERE_BY_ARCHETYPE: Partial<Record<Archetype, Partial<AtmosphereParams>>> = {
  deep: {density: 0.023, coverage: 0.36},
  express: {density: 0.019},
};

/** The Reactor's outdoor haze cap over its surface deck (m above the deck): full haze below `from`, none above `to`. */
export const REACTOR_SKY_CAP = {from: 2.5, to: 5.5} as const;

export function atmosphereFor(layout: (Pick<StationLayout, 'archetype'> & {reactor?: unknown}) | null, base: AtmosphereParams = ATMOSPHERE): AtmosphereParams {
  const o = layout ? ATMOSPHERE_BY_ARCHETYPE[layout.archetype] : undefined;
  const r = layout?.reactor ? REACTOR_ATMOSPHERE : undefined; // task reactor-build-20261101 (lane ARCH): the Reactor's deep industrial haze
  // (task reactor-surface-redesign-credits-20261103: over the Reactor's surface deck, a few metres of mist and then open air)
  const deck = (layout?.reactor as {surface?: {y?: unknown}} | undefined)?.surface?.y;
  const cap = typeof deck === 'number' && Number.isFinite(deck) ? {skyCap: {y0: deck + REACTOR_SKY_CAP.from, y1: deck + REACTOR_SKY_CAP.to}} : undefined;
  return {
    ...base, ...o, ...r, ...cap,
    areaDensity: {...base.areaDensity, ...o?.areaDensity, ...r?.areaDensity}, levelDensity: {...base.levelDensity, ...o?.levelDensity, ...r?.levelDensity},
    classDensity: {...base.classDensity, ...o?.classDensity, ...r?.classDensity}, classOdds: {...base.classOdds, ...o?.classOdds, ...r?.classOdds},
  };
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
  /** MSAA samples of the scene pass. */
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
// Math mirrors (identical formulas to volumetricNodes.ts)

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

/** three's perspectiveDepthToViewZ (depth in [0, 1]), as a positive distance in front of the camera. */
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
  /** Per-channel scattering weight at p (default [sigma, sigma, sigma]): the haze plus tinted smoke. */
  scatter?: (p: V3) => V3;
  /** Extra extinction coefficient (1/m) at p (dense-patch excess + smoke); default none. */
  extinction?: (p: V3) => number;
}

/**
 * Mirror of the march loop — sum T_fog(t) T_vol(t) scatter(p) L(p) w over samples in front of the surface only, with T_vol the
 * volumetric transmittance accumulated so far (dense patches, smoke); returns it at the surface as well.
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

/** Mirror of the march loop's in-scatter (no extinction terms). */
export function integrateInscatter(m: MarchInput): V3 {
  return integrateMedium(m).inscatter;
}

export interface SpotInput {
  pos: V3;
  dir: V3;
  coneCos: number;
  penumbraCos: number;
  /** Linear colour x intensity x flashlightScatter (0 when the torch is off / the battery cut it). */
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

/** Mirror of a scatter light (flare) term: colour x three's distance attenuation (>= 0.3 m) x phase x occlusion window. */
export function pointRadiance(p: V3, viewDir: V3, light: {pos: V3; color: V3; distance: number; decay: number}, params: AtmosphereParams, vis = 1): V3 {
  const v: V3 = [p[0] - light.pos[0], p[1] - light.pos[1], p[2] - light.pos[2]];
  const d = Math.max(Math.hypot(v[0], v[1], v[2]), 1e-4);
  if (light.distance > 0 && d > light.distance) return [0, 0, 0];
  const k = distanceAttenuation(Math.max(d, 0.3), light.distance, light.decay) * phase(-(v[0] * viewDir[0] + v[1] * viewDir[1] + v[2] * viewDir[2]) / d, params) * vis;
  return [light.color[0] * k, light.color[1] * k, light.color[2] * k];
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

/**
 * Iteration 13: mirror of the composite. The scene pass is LINEAR HDR (WebGPURenderer renders into its own target without
 * tone mapping); the fog is applied there — scene x volumetric transmittance + in-scatter x intensity — and the render
 * pipeline's output transform then applies ACES (renderer exposure) + sRGB once, exactly like the station without fog.
 * intensity 0 => the scene unchanged.
 */
export function compositeLinear(scene: V3, fog: V3, transmittance = 1, intensity = 1): V3 {
  const k = Math.min(1, Math.max(0, intensity));
  const tv = 1 + (Math.min(1, Math.max(0, transmittance)) - 1) * k;
  return [scene[0] * tv + fog[0] * intensity, scene[1] * tv + fog[1] * intensity, scene[2] * tv + fog[2] * intensity];
}

// ---------------------------------------------------------------------------------------------
// Per-station density map (area multiplier incl. its clear / dense class + local floor and ceiling)

/** Density multiplier range encoded in the map's R channel (0..255 -> 0..MAP_RANGE). */
export const DENSITY_MAP_RANGE = 3;
/** Height range (m) above which the density map encodes each layer's heights over its own range (see DensityMap.layerY). */
export const DENSITY_LAYER_RANGE = 16;

/** [y0, yRange] of density-map layer s (G / B height = y0 + byte / 255 * yRange). */
export function densityLayerRange(m: Pick<DensityMap, 'yMin' | 'yRange' | 'layerY'>, s: number): [number, number] {
  const r = m.layerY;
  return r && r.length >= 2 * (s + 1) ? [r[2 * s], r[2 * s + 1]] : [m.yMin, m.yRange];
}

/**
 * Per-station medium map, one layer per level slot (slot s = layout.levels[s]): RGBA8 per texel: R = density multiplier /
 * DENSITY_MAP_RANGE (area type x level band x the area's clear / dense class), G = local floor, B = local ceiling (both
 * yMin + v * yRange), A = 255 where the level's band exists (values are dilated into closed cells so filtering stays smooth;
 * A is not). The march picks the layer of the level slot holding the sample point (light-field band pick).
 */
export interface DensityMap {
  w: number; h: number;
  /** Level slots (layers of the map). */
  slots: number;
  /** RGBA8, layer-major: ((slot * h + y) * w + x) * 4. */
  data: Uint8Array;
  yMin: number; yRange: number;
  /**
   * Task office-seamless-20261029: per layer [y0, yRange] of its G / B heights (absent = [yMin, yRange] on every layer). A
   * stack taller than DENSITY_LAYER_RANGE (the 9-storey tower: ~42 m, 0.16 m steps over one range) encodes each layer over
   * its own band range instead; a Subway station (< 16 m) keeps the single range and its bytes.
   */
  layerY?: Float64Array;
  /** World size of one texel (m). */
  cell: number;
  /** Iteration 13: the class each area drew (index = area id) and its final multiplier (before the level factor). */
  areas?: {cls: AreaClass; mult: number; group: AreaGroup | 'track'}[];
}

const HALLS = new Set(['concourse', 'fare-hall', 'food-court', 'retail-arcade']);
const CORRIDORS = new Set(['passage', 'underpass', 'exit-stair', 'stair-core']);
const SERVICE = new Set(['service-corridor', 'storage', 'stock-room', 'utility', 'supply-closet', 'janitor-closet', 'service', 'closet']);

/** Group of an area for the clear / dense draw. */
export function areaGroup(a: {kind: AreaKind; type: RoomType}): AreaGroup {
  if (a.kind === 'platform' || a.type === 'platform') return 'platform';
  if (SERVICE.has(a.type) || SERVICE.has(a.kind)) return 'service';
  if (HALLS.has(a.type) || a.kind === 'concourse') return 'hall';
  if (CORRIDORS.has(a.type) || a.kind === 'passage') return 'corridor';
  return 'room';
}

function hash32(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Task reactor-playtest-round2-20261102 (lane GAS): the params' rock-room haze for area `index`, or null (not one / not set). */
function rockRoomOf(layout: Pick<StationLayout, 'areas'>, index: number, p: Partial<Pick<AtmosphereParams, 'rockRoom'>>): AtmosphereParams['rockRoom'] | null {
  return p.rockRoom && reactorRockRooms(layout).has(index) ? p.rockRoom : null;
}

/** Seeded class of area `index` (deterministic per station seed + area; never depends on time or the camera). */
export function areaClassOf(layout: Pick<StationLayout, 'seed' | 'areas'>, index: number, p: Pick<AtmosphereParams, 'classOdds'> & Partial<Pick<AtmosphereParams, 'rockRoom'>>): AreaClass {
  const a = layout.areas[index];
  if (!a) return 'normal';
  const odds = p.classOdds[rockRoomOf(layout, index, p)?.group ?? areaGroup(a)]; // (lane GAS: + the rock rooms' group)
  const u = hash32((layout.seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b1) ^ 0x5f0c1a7d) / 4294967296;
  return u < odds.clear ? 'clear' : u < odds.clear + odds.dense ? 'dense' : 'normal';
}

export function areaMultiplier(layout: StationLayout, i: number, p: Pick<AtmosphereParams, 'areaDensity'> & Partial<Pick<AtmosphereParams, 'classDensity' | 'classOdds' | 'rockRoom'>>, grid: Grid = layout.grid): number {
  const g = grid, ad = p.areaDensity;
  if (g.cells[i] === VOID) return ad.trackBed ?? ad.default ?? 1;
  const ai = g.area[i];
  const a = layout.areas[ai];
  if (!a) return ad.default ?? 1;
  // Track 2 (lane GEN): a track tunnel continues the bed (its group: the track bed); annex rooms / corridors go by their type
  if (a.ext === 'tunnel') return ad.trackBed ?? ad.default ?? 1;
  const base = rockRoomOf(layout, ai, p)?.density ?? ad[a.type] ?? ad[a.kind] ?? ad.default ?? 1; // (lane GAS: + the rock rooms)
  if (!p.classDensity || !p.classOdds) return base;
  return base * p.classDensity[areaClassOf(layout, ai, p as Pick<AtmosphereParams, 'classOdds'>)];
}

export function buildDensityMap(layout: StationLayout, p: Pick<AtmosphereParams, 'areaDensity'> & Partial<Pick<AtmosphereParams, 'levelDensity' | 'classDensity' | 'classOdds' | 'rockRoom'>>): DensityMap {
  return drainSync(buildDensityMapSteps(layout, p));
}

/**
 * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): buildDensityMap as steps (core/pacedBuild.ts): the same code,
 * one level per step, where the journey's paced build may let a frame be drawn (nothing reads the map before it returns).
 */
export function* buildDensityMapSteps(layout: StationLayout, p: Pick<AtmosphereParams, 'areaDensity'> & Partial<Pick<AtmosphereParams, 'levelDensity' | 'classDensity' | 'classOdds' | 'rockRoom'>>): BuildSteps<DensityMap> {
  // Task office-seamless-20261029: every level (the light field's slots; was capped at 4).
  const levels = stationLevels(layout).slice(0, MAX_SLOTS);
  const g0 = layout.grid, W = g0.w, H = g0.h, n = W * H, S = levels.length;
  const perLevel = (L: (typeof levels)[number]) => {
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
    // Soften area boundaries (two 3x3 box passes on the multiplier: ~1 m transitions through doorways).
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
  };
  const per: ReturnType<typeof perLevel>[] = [];
  for (const L of levels) { per.push(perLevel(L)); yield; } // (lane BUILD: one level per step)
  let yMin = Infinity, yMax = -Infinity;
  for (const q of per) for (let i = 0; i < n; i++) if (q.open[i]) { yMin = Math.min(yMin, q.floor[i]); yMax = Math.max(yMax, q.ceil[i]); }
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 3; }
  const yRange = Math.max(0.01, yMax - yMin);
  // Per-layer height ranges for a tall stack (every value a layer writes: its known floors / ceilings and the default band).
  let layerY: Float64Array | undefined;
  if (yRange > DENSITY_LAYER_RANGE) {
    layerY = new Float64Array(2 * S);
    per.forEach((q, s) => {
      let lo = q.base, hi = q.base + 3;
      for (let i = 0; i < n; i++) if (q.known[i]) { lo = Math.min(lo, q.floor[i]); hi = Math.max(hi, q.ceil[i]); }
      layerY![2 * s] = lo - 0.25; layerY![2 * s + 1] = Math.max(0.01, hi - lo + 0.5);
    });
  }
  const data = new Uint8Array(n * S * 4);
  const u8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  per.forEach((q, s) => {
    const y0 = layerY ? layerY[2 * s] : yMin, yr = layerY ? layerY[2 * s + 1] : yRange;
    for (let i = 0; i < n; i++) {
      const o = (s * n + i) * 4;
      const m = q.known[i] ? q.mult[i] : (p.areaDensity.default ?? 1);
      data[o] = u8(m / DENSITY_MAP_RANGE);
      data[o + 1] = u8(((q.known[i] ? q.floor[i] : q.base) - y0) / yr);
      data[o + 2] = u8(((q.known[i] ? q.ceil[i] : q.base + 3) - y0) / yr);
      data[o + 3] = q.open[i] ? 255 : 0;
    }
  });
  const areas = p.classDensity && p.classOdds ? layout.areas.map((a, i) => {
    const cls = areaClassOf(layout, i, p as Pick<AtmosphereParams, 'classOdds'>);
    const ad = p.areaDensity, rr = rockRoomOf(layout, i, p); // (lane GAS: + the rock rooms)
    return {cls, group: rr?.group ?? areaGroup(a), mult: (rr?.density ?? ad[a.type] ?? ad[a.kind] ?? ad.default ?? 1) * p.classDensity![cls]};
  }) : undefined;
  return {w: W, h: H, slots: S, data, yMin, yRange, cell: CELL, areas, ...(layerY ? {layerY} : {})};
}

/**
 * Sample like the GPU (texel centres at cell centres, clamp to edge, per layer): [multiplier, floorY]
 * of the level slot whose band holds height y (slot 0 when y is omitted or nothing is present).
 */
export function sampleDensityMap(m: DensityMap, x: number, z: number, y?: number): [number, number] {
  if (y === undefined) return sampleDensityLayer(m, x, z, 0);
  return sampleDensityLayer(m, x, z, densitySlot(m, x, z, y));
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
    const [y0, yr] = densityLayerRange(m, s);
    const fl = y0 + gch / 255 * yr, ce = y0 + bch / 255 * yr;
    const d = Math.max(fl - y, y - ce);
    if (d < best) { best = d; slot = s; }
  }
  return slot;
}

/** Bilinear [multiplier, floorY] of one density layer. */
export function sampleDensityLayer(m: DensityMap, x: number, z: number, s: number): [number, number] {
  const u = x / m.cell - 0.5, v = z / m.cell - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const L = Math.min(Math.max(0, s), m.slots - 1);
  let r = 0, gch = 0;
  for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const xx = Math.min(m.w - 1, Math.max(0, iu + a)), yy = Math.min(m.h - 1, Math.max(0, iv + b));
    const wgt = (a ? fu : 1 - fu) * (b ? fv : 1 - fv);
    const o = ((L * m.h + yy) * m.w + xx) * 4;
    r += wgt * m.data[o]; gch += wgt * m.data[o + 1];
  }
  const [y0, yr] = densityLayerRange(m, L);
  return [r / 255 * DENSITY_MAP_RANGE, y0 + gch / 255 * yr];
}

// ---------------------------------------------------------------------------------------------
// Air map: where the tunnel draft (track beds) carries the haze instead of the slow air drift

/**
 * Per level slot (same texel grid as the density map), R8: weight 0..1 of the TRACK draft field at the texel (1 over the
 * track beds / tunnels, 0 in rooms and halls; platforms ~0.35 so the draft spills over the platform edge), smoothed with
 * four 3x3 passes. Fixed in time: the two moving fields are blended in SPACE, so nothing shears or re-rolls.
 */
export interface AirMap {
  w: number; h: number; slots: number;
  /** R8, layer-major like DensityMap: ((slot * h + y) * w + x). */
  data: Uint8Array;
  /** Station draft direction along the tracks (+1 = toward +x), seeded. */
  draft: 1 | -1;
}

export function stationDraft(seed: number): 1 | -1 {
  return ((seed >>> 0) * 2654435761 >>> 0) % 2 === 0 ? 1 : -1;
}

export function buildAirMap(layout: StationLayout): AirMap {
  return drainSync(buildAirMapSteps(layout));
}

/** Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): buildAirMap as steps (one level per step), like buildDensityMapSteps. */
export function* buildAirMapSteps(layout: StationLayout): BuildSteps<AirMap> {
  const levels = stationLevels(layout).slice(0, MAX_SLOTS);
  const g0 = layout.grid, W = g0.w, H = g0.h, n = W * H, S = levels.length;
  const data = new Uint8Array(n * S);
  const fillLevel = (L: (typeof levels)[number], s: number) => {
    const g = L.grid;
    let wt = new Float32Array(n);
    const open = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (g.cells[i] === SOLID) continue;
      open[i] = 1;
      if (g.cells[i] === VOID) { wt[i] = 1; continue; }
      const a = layout.areas[g.area[i]];
      if (a && a.kind === 'platform') wt[i] = 0.35;
    }
    for (let it = 0; it < 4; it++) {
      const nw = wt.slice();
      for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
        const i = cy * W + cx;
        if (!open[i]) continue;
        let sw = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const j = y * W + x;
          if (!open[j]) continue;
          sw += wt[j]; c++;
        }
        nw[i] = sw / c;
      }
      wt = nw;
    }
    for (let i = 0; i < n; i++) data[s * n + i] = Math.round(Math.min(1, Math.max(0, wt[i])) * 255);
  };
  for (let s = 0; s < levels.length; s++) { fillLevel(levels[s], s); yield; } // (lane BUILD: one level per step)
  return {w: W, h: H, slots: S, data, draft: stationDraft(layout.seed)};
}

/** Bilinear track weight of one air-map layer, like the GPU. */
export function sampleAirMap(f: AirMap, x: number, z: number, slot: number): number {
  const u = x / CELL - 0.5, v = z / CELL - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const s = Math.min(Math.max(0, slot), f.slots - 1);
  let r = 0;
  for (let bb = 0; bb < 2; bb++) for (let a = 0; a < 2; a++) {
    const xx = Math.min(f.w - 1, Math.max(0, iu + a)), yy = Math.min(f.h - 1, Math.max(0, iv + bb));
    r += (a ? fu : 1 - fu) * (bb ? fv : 1 - fv) * f.data[(s * f.h + yy) * f.w + xx];
  }
  return r / 255;
}

// ---------------------------------------------------------------------------------------------
// Noise volume (shared, built once per session) and the station's motion

/** 64^3 RGBA8 tileable noise: R = patches (periods 4 + 8 per tile), G = wisps (8 + 16), B / A = warp x / z (5 + 10). */
export const NOISE_SIZE = 64;
export const NOISE_CHANNELS = 4;
export const NOISE_OCTAVES: readonly (readonly {p: number; w: number}[])[] = [
  [{p: 4, w: 0.68}, {p: 8, w: 0.32}],
  [{p: 8, w: 0.6}, {p: 16, w: 0.4}],
  [{p: 5, w: 0.7}, {p: 10, w: 0.3}],
  [{p: 5, w: 0.7}, {p: 10, w: 0.3}],
];

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
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      g[i * 3] = Math.cos(a) * r; g[i * 3 + 1] = Math.sin(a) * r; g[i * 3 + 2] = z;
    }
    const k = P / size;
    // per-axis lattice cell + fade weights (separable precompute)
    const ix = new Int32Array(size), tx = new Float32Array(size), fx = new Float32Array(size);
    for (let i = 0; i < size; i++) { const f = i * k; ix[i] = Math.floor(f); tx[i] = f - ix[i]; fx[i] = fade(tx[i]); }
    for (let zz = 0; zz < size; zz++) for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
      const x0 = ix[xx], y0 = ix[yy], z0 = ix[zz], dx = tx[xx], dy = tx[yy], dz = tx[zz], u = fx[xx], v = fx[yy], w = fx[zz];
      let acc = 0;
      for (let c = 0; c < 2; c++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const gi = ((((z0 + c) % P) * P + ((y0 + b) % P)) * P + ((x0 + a) % P)) * 3;
        const d = g[gi] * (dx - a) + g[gi + 1] * (dy - b) + g[gi + 2] * (dz - c);
        acc += d * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w);
      }
      out[(zz * size + yy) * size + xx] += o.w * acc;
    }
  }
  return out;
}

/** Histogram equalisation to a uniform [0, 255] (ranks): thresholds on the channel are coverage fractions. */
function equalise(v: Float32Array): Uint8Array {
  const n = v.length;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => v[a] - v[b]);
  const out = new Uint8Array(n);
  for (let r = 0; r < n; r++) out[idx[r]] = Math.round(r / (n - 1) * 255);
  return out;
}

let sharedNoise: {size: number; seed: number; data: Uint8Array} | null = null;

/** Tileable 3D noise, interleaved RGBA8 (texel i: [4i] patch, [4i+1] wisp, [4i+2] / [4i+3] warp x / z), equalised. Cached. */
export function buildNoiseVolume(size = NOISE_SIZE, seed = 0x6c6c6e): Uint8Array {
  if (sharedNoise && sharedNoise.size === size && sharedNoise.seed === seed) return sharedNoise.data;
  const rnd = mulberry32(seed);
  const ch = NOISE_OCTAVES.map(o => equalise(gradientNoiseTile(size, o, rnd)));
  const out = new Uint8Array(size ** 3 * NOISE_CHANNELS);
  for (let i = 0; i < size ** 3; i++) for (let c = 0; c < NOISE_CHANNELS; c++) out[i * NOISE_CHANNELS + c] = ch[c][i];
  sharedNoise = {size, seed, data: out};
  return out;
}

/** Trilinear, repeat-wrapped sample of all channels (texture coords: 1 = one tile), like the GPU. */
export function sampleNoise4(vol: Uint8Array, q: V3, size = NOISE_SIZE): [number, number, number, number] {
  const ch = Math.round(vol.length / size ** 3);
  const u = q[0] * size - 0.5, v = q[1] * size - 0.5, w = q[2] * size - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), iw = Math.floor(w), fu = u - iu, fv = v - iv, fw = w - iw;
  const wrap = (i: number) => ((i % size) + size) % size;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 2; c++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const wt = (a ? fu : 1 - fu) * (b ? fv : 1 - fv) * (c ? fw : 1 - fw);
    const o = ((wrap(iw + c) * size + wrap(iv + b)) * size + wrap(iu + a)) * ch;
    for (let k = 0; k < Math.min(4, ch); k++) out[k] += wt * vol[o + k];
  }
  return [out[0] / 255, out[1] / 255, out[2] / 255, out[3] / 255];
}

/** One channel of sampleNoise4 (iteration-12 signature). */
export function sampleNoise(vol: Uint8Array, q: V3, size = NOISE_SIZE, channel = 0): number {
  return sampleNoise4(vol, q, size)[Math.min(3, channel)];
}

/** The station's fog motion (seeded): velocities (m/s) and per-field tile offsets at fog time 0. */
export interface FogMotion {
  draft: 1 | -1;
  /** Air drift, tunnel draft along the tracks, wisp / warp field (x, y, z m/s). */
  air: V3;
  track: V3;
  detail: V3;
  /** Field offsets (tile units) at fog time 0: patch (air), patch (track), wisps / warp. */
  offAir: V3;
  offTrack: V3;
  offDetail: V3;
}

export function fogMotion(seed: number, p: Pick<AtmosphereParams, 'drift' | 'trackDrift' | 'detailDrift' | 'rise'>): FogMotion {
  const rnd = mulberry32(hash32((seed >>> 0) ^ 0x2f6b1d93));
  const draft = stationDraft(seed);
  // air: within +-35 deg of the draft direction (the station's long axis); wisps: 50-90 deg off it, either side
  const a = (rnd() * 2 - 1) * 0.61;
  const b = a + (rnd() < 0.5 ? -1 : 1) * (0.87 + rnd() * 0.7);
  const off = (): V3 => [rnd(), rnd(), rnd()];
  return {
    draft,
    air: [draft * Math.cos(a) * p.drift, 0, Math.sin(a) * p.drift],
    track: [draft * p.trackDrift, 0, 0],
    detail: [draft * Math.cos(b) * p.detailDrift, p.rise, Math.sin(b) * p.detailDrift],
    offAir: off(), offTrack: off(), offDetail: off(),
  };
}

/** Per-axis noise scale (1/m) of the patch / wisp fields (vertical squash applied). */
export function noiseScales(p: Pick<AtmosphereParams, 'noiseScale' | 'detailScale' | 'noiseAnisotropy'>): {patch: V3; detail: V3} {
  const A = p.noiseAnisotropy;
  return {patch: [p.noiseScale, p.noiseScale * A, p.noiseScale], detail: [p.detailScale, p.detailScale * A * 0.8, p.detailScale]};
}

const frac = (v: number) => v - Math.floor(v);

/**
 * Field offsets at fog time t (tile units, folded into [0, 1) in double precision): offset - velocity x scale x t. The
 * shader receives exactly these (uniforms), so a sample is q = p x scale + offset.
 */
export function fieldOffsets(m: FogMotion, p: Pick<AtmosphereParams, 'noiseScale' | 'detailScale' | 'noiseAnisotropy'>, t: number): {air: V3; track: V3; detail: V3} {
  const s = noiseScales(p);
  const at = (o: V3, v: V3, k: V3): V3 => [frac(o[0] - v[0] * k[0] * t), frac(o[1] - v[1] * k[1] * t), frac(o[2] - v[2] * k[2] * t)];
  return {air: at(m.offAir, m.air, s.patch), track: at(m.offTrack, m.track, s.patch), detail: at(m.offDetail, m.detail, s.detail)};
}

export interface MediumSample {
  /** Haze scattering coefficient sigma_s (1/m). */
  sigma: number;
  /** Its excess over the unpatterned level (dense patches; drives the extra extinction). */
  excess: number;
  /** Wisp channel (0..1) at p (smoke wisps). */
  detail: number;
  /** Patch field 0 (clear pocket) .. 1 (dense patch). */
  dense: number;
  /** Area multiplier (density map) and level slot used. */
  mult: number;
  slot: number;
}

export interface MediumMaps {
  map: DensityMap | null;
  air: AirMap | null;
  noise: Uint8Array | null;
  motion: FogMotion | null;
}

/**
 * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): the plain TRACK-BED density multiplier of a level (role) as
 * the density map stores it (8 bits of DENSITY_MAP_RANGE) — the haze inside a ride tunnel's box (world/rideMask.ts bedMult), so the
 * medium at a portal plane is the bed's on both sides of it.
 */
export function rideBedMultiplier(p: Pick<AtmosphereParams, 'areaDensity'> & Partial<Pick<AtmosphereParams, 'levelDensity'>>, role: LevelRole | 'roof' = 'main'): number {
  const m = (p.areaDensity.trackBed ?? p.areaDensity.default ?? 1) * (p.levelDensity?.[role] ?? 1);
  return Math.round(Math.min(1, Math.max(0, m / DENSITY_MAP_RANGE)) * 255) / 255 * DENSITY_MAP_RANGE;
}

/**
 * Iteration 13: the haze at world point p and fog time t (mirror of the TSL medium in volumetricNodes.ts). Pure: no camera,
 * no history, no visibility input. `slot` overrides the level-slot pick (the GPU uses the light field's band pick).
 * Lane PORTAL (task studio-perf-ao-train-continuity-20261110-022206-01): `ride` = the ride mask (world/rideMask.ts RIDE_MASK) the GPU
 * has: inside its box the plain track-bed medium (its bedMult, the box's bed as the floor, the full track draft); null / off: as before.
 */
export function mediumAt(p: V3, maps: MediumMaps, params: AtmosphereParams, t: number, slotOverride?: number, ride: Pick<RideMaskState, 'on' | 'box' | 'bedMult'> | null = null): MediumSample {
  const {map, air, noise, motion} = maps;
  const slot = slotOverride ?? (map ? densitySlot(map, p[0], p[2], p[1]) : 0);
  const inRide = !!ride && inRideMask(ride, p[0], p[1], p[2]);
  const [mult0, floor0] = map ? sampleDensityLayer(map, p[0], p[2], slot) : [1, 0];
  const mult = inRide ? ride!.bedMult : mult0, floorY = inRide ? ride!.box.y0 + RIDE_MASK_SKIN : floor0;
  const h = p[1] - floorY;
  const hf = Math.min(2.5, Math.max(0.25, Math.exp(-params.heightFalloff * (h - params.refHeight))));
  const cap = params.skyCap, capF = cap ? 1 - smoothstep(cap.y0, cap.y1, p[1]) : 1; // (the Reactor's outdoor haze cap: the march mirror)
  const base0 = params.density * mult * capF;
  const amt = params.noiseAmount;
  if (!noise || !motion || amt <= 0) {
    const g0 = params.ground * mult * Math.exp(-Math.max(h, 0) / Math.max(params.groundHeight, 0.05));
    return {sigma: base0 * (hf + g0), excess: 0, detail: 0.5, dense: 0.5, mult, slot};
  }
  const sc = noiseScales(params), off = fieldOffsets(motion, params, t);
  // wisps + warp: one fetch of the fast field
  const D = sampleNoise4(noise, [p[0] * sc.detail[0] + off.detail[0], p[1] * sc.detail[1] + off.detail[1], p[2] * sc.detail[2] + off.detail[2]]);
  const wk = params.warp * amt * 2;
  const wp: V3 = [p[0] + (D[2] - 0.5) * wk, p[1] + (D[0] - 0.5) * wk * 0.3, p[2] + (D[3] - 0.5) * wk];
  const q = (o: V3): V3 => [wp[0] * sc.patch[0] + o[0], wp[1] * sc.patch[1] + o[1], wp[2] * sc.patch[2] + o[2]];
  const wt = inRide ? 1 : air ? sampleAirMap(air, p[0], p[2], slot) : 0;
  let n = sampleNoise4(noise, q(off.air))[0];
  if (wt > 0.002) n += (sampleNoise4(noise, q(off.track))[0] - n) * wt;
  const cover = Math.min(0.7, Math.max(0.03, params.coverage + params.coverageSlope * (mult - 1)));
  const dense = smoothstep(1 - cover - params.coverageSoftness, 1 - cover + params.coverageSoftness, n);
  const pocket = params.clear + (params.pocketDense - params.clear) * smoothstep(1, 1.6, mult);
  const patchF = 1 + amt * (pocket + (params.peak - pocket) * dense - 1);
  const detailF = 1 + amt * params.detail * (D[1] - 0.5) * 2;
  const gh = params.groundHeight * (1 + params.groundVariation * (D[1] - 0.5) * 2);
  const groundT = params.ground * mult * Math.exp(-Math.max(h, 0) / Math.max(gh, 0.05)) * (1 + amt * (0.3 + 1.2 * dense - 1));
  const sigma = base0 * (hf * patchF * detailF + groundT);
  return {sigma, excess: Math.max(0, sigma - base0 * hf), detail: D[1], dense, mult, slot};
}

/** Haze sigma_s at p (iteration-06 signature, kept for callers / tests): mediumAt without the moving fields when noise is null. */
export function densityAt(p: V3, map: DensityMap | null, noise: Uint8Array | null, params: AtmosphereParams, time: number, air: AirMap | null = null, motion: FogMotion | null = null): number {
  return mediumAt(p, {map, air, noise, motion: noise ? motion ?? fogMotion(0, params) : null}, params, time).sigma;
}

/**
 * Station statistics of the medium at walking height (QA / notes / tests): mean sigma over open cells 1.4 m above the local
 * floor of every level, the fraction of that volume that is clear (sigma < 20 % of the iteration-12 base) / dense
 * (sigma > 2x the base), and the per-class means. Deterministic sample set (every `stride`-th open cell).
 */
export function mediumStats(layout: StationLayout, maps: MediumMaps, params: AtmosphereParams, t: number, stride = 7): {
  mean: number; clearFrac: number; denseFrac: number; samples: number; byClass: Record<AreaClass | 'track', number>;
} {
  const levels = stationLevels(layout).slice(0, MAX_SLOTS);
  let sum = 0, nClear = 0, nDense = 0, count = 0;
  const cls: Record<AreaClass | 'track', [number, number]> = {clear: [0, 0], normal: [0, 0], dense: [0, 0], track: [0, 0]};
  const lo = 0.2 * ATMOSPHERE_ITER12.density, hi = 2 * params.density;
  levels.forEach((L, s) => {
    const g = L.grid, floorOf = cellFloorFn(g, layout.trench.floorY);
    for (let i = 0; i < g.w * g.h; i += stride) {
      if (g.cells[i] === SOLID) continue;
      const cx = i % g.w, cy = (i - cx) / g.w;
      const pt: V3 = [(cx + 0.5) * CELL, floorOf(cx, cy) + 1.4, (cy + 0.5) * CELL];
      const m = mediumAt(pt, maps, params, t, s);
      sum += m.sigma; count++;
      if (m.sigma < lo) nClear++;
      if (m.sigma > hi) nDense++;
      const k: AreaClass | 'track' = g.cells[i] === VOID ? 'track' : (maps.map?.areas?.[g.area[i]]?.cls ?? 'normal');
      cls[k][0] += m.sigma; cls[k][1]++;
    }
  });
  const byClass = Object.fromEntries(Object.entries(cls).map(([k, [a, b]]) => [k, b ? a / b : 0])) as Record<AreaClass | 'track', number>;
  return {mean: count ? sum / count : 0, clearFrac: count ? nClear / count : 0, denseFrac: count ? nDense / count : 0, samples: count, byClass};
}
