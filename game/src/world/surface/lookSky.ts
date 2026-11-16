// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): THE DISTRICT'S SKY AND OUTDOOR LOOK — the overcast, toxic-tinged
// sky dome, the scene fog the district runs under, and the OUTDOOR-LIT materials of everything with no light-field slot behind it:
// roof decks / copings / parapets (they stand on SOLID building columns), rooftop plant, and everything beyond the grid (the cordon's
// rubble berms, the collapsed blocks behind it, the far city).
//
//  - FOG: an ordinary FogExp2 (the scene's) — a neutral warm grey overcast haze, NEVER green (CLAUDE.md: ordinary non-hazard fog is
//    not green; the toxic gas is AIR's green volumetric term). ~50 % at 100 m, ~95 % at 200 m: the streets read deep, the far city is
//    a silhouette beyond the cordon, nothing pops at the culler / far plane (fogCullDistance). Its colour sits near the lit street's
//    radiance (a daylit haze, a little darker), so distance reads as haze, not as night.
//  - SKY: a dome following the eye (fog: false): the fog's colour at the horizon (distant geometry melts into it), a heavier ochre-grey
//    overcast deck above with slow cloud billows; the "toxic tinge" is a faint sickly yellow in the deck, not a green fog.
//  - OUTDOOR LIGHT: unlit node materials (MeshBasicNodeMaterial) — albedo x an overcast hemisphere matched to the district's baked
//    daylight (lookDaylight.ts DAYLIGHT: a field-lit surface shows albedo x E / pi, and an open roof sees E = 2 pi L, so the up-facing
//    term is ~2 L x the tint), scene fog on (one fog curve for all).
// Plain module uniforms only (LOOK_U; QA-tunable): never a uniformArray, no change to any shared program.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {Fn, abs, cameraPosition, float, max, mix, normalWorld, normalize, positionWorld, smoothstep, texture, time, uniform, uv, vec3, vec4} from 'three/tsl';
import {wmNoise} from '../surfaceNodes';
import {ownSurfaceResource} from './archMaterials';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;
type V3 = readonly [number, number, number];

/** The district's sky / fog / outdoor light (sRGB hex for fog; linear triples for the shader terms). */
export const LOOK_SKY = {
  /** Scene FogExp2 while a district is built: density (1/m) and colour (neutral warm grey; not green). */
  fogDensity: 0.0085, fogColor: 0x76726a,
  /** Camera far plane outdoors (m) and the sky dome radius (inside it). */
  far: 320, dome: 300,
  /** Overcast hemisphere of the outdoor-lit materials (linear): up-facing and down-facing light. */
  hemiTop: [1.15, 1.11, 0.97] as V3, hemiBottom: [0.28, 0.27, 0.24] as V3,
  /** Sky: zenith deck colour (linear), its sickly tint (multiplied into the billows), cloud contrast. */
  zenith: [0.15, 0.145, 0.12] as V3, sick: [1.08, 1.04, 0.82] as V3, clouds: 0.35,
} as const;

const c3 = (v: V3) => new THREE.Color(v[0], v[1], v[2]);
const fogLinear = () => new THREE.Color().setHex(LOOK_SKY.fogColor, THREE.SRGBColorSpace);

/** Module uniforms (one district at a time; QA tunes them through lookTune). */
export const LOOK_U = {
  hemiTop: uniform(c3(LOOK_SKY.hemiTop)), hemiBottom: uniform(c3(LOOK_SKY.hemiBottom)),
  horizon: uniform(fogLinear()), zenith: uniform(c3(LOOK_SKY.zenith)), sick: uniform(c3(LOOK_SKY.sick)), clouds: uniform(LOOK_SKY.clouds as number),
};

/** QA: tune the outdoor look (linear rgb triples / numbers); returns the current values. */
export function lookTune(o: Partial<Record<'hemiTop' | 'hemiBottom' | 'horizon' | 'zenith' | 'sick', [number, number, number]> & {clouds: number}> = {}): Record<string, unknown> {
  for (const k of ['hemiTop', 'hemiBottom', 'horizon', 'zenith', 'sick'] as const) { const v = o[k]; if (v && v.every(Number.isFinite)) (LOOK_U[k].value as THREE.Color).setRGB(v[0], v[1], v[2]); }
  if (typeof o.clouds === 'number' && Number.isFinite(o.clouds)) LOOK_U.clouds.value = Math.max(0, o.clouds);
  const out: Record<string, unknown> = {clouds: LOOK_U.clouds.value};
  for (const k of ['hemiTop', 'hemiBottom', 'horizon', 'zenith', 'sick'] as const) out[k] = (LOOK_U[k].value as THREE.Color).toArray();
  return out;
}

/** The horizon (= fog) colour tracks the scene fog the runtime sets. */
export function syncLookHorizon(fogColor: THREE.Color): void { (LOOK_U.horizon.value as THREE.Color).copy(fogColor); }

/** Overcast hemisphere light for world normal nn. */
const hemi = (nn: N): N => mix(LOOK_U.hemiBottom, LOOK_U.hemiTop, n(nn).y.mul(0.5).add(0.5));

/** The sky along view direction dir: the fog colour at the horizon, the overcast deck above, slow billows tinted sickly. */
const skyAt = (dir: N): N => {
  const e = n(dir).y, up = n(max(e, 0));
  const base = n(mix(LOOK_U.horizon, LOOK_U.zenith, smoothstep(0.02, 0.7, up)));
  const q = n(n(dir).xz.div(max(up, 0.08).add(0.12)));
  const drift = n(time).mul(0.003);
  const c1 = n(wmNoise(n(vec3(n(q.x).mul(1.1).add(drift), n(q.y).mul(1.1), n(time).mul(0.002)))));
  const c2 = n(wmNoise(n(vec3(n(q.x).mul(3.7), n(q.y).mul(3.7).sub(drift.mul(2)), 5.3))));
  const deck = n(c1).mul(0.65).add(n(c2).mul(0.35));
  const billow = n(float(1).add(n(deck).sub(0.5).mul(LOOK_U.clouds).mul(smoothstep(0.0, 0.35, up))));
  const tinted = n(mix(vec3(1, 1, 1), LOOK_U.sick, n(smoothstep(0.45, 0.8, deck)).mul(smoothstep(0.05, 0.4, up))));
  return n(base).mul(billow).mul(tinted);
};

const created = new Set<THREE.Material>();
/** Tracked (QA / tests) and handed to the district's owner (LevelResources 'surface': released when the run leaves the district). */
const track = <M extends THREE.Material>(m: M): M => { created.add(m); m.addEventListener('dispose', () => created.delete(m)); return ownSurfaceResource(m); };

/** The sky dome material (BackSide, fog off, depth write off: everything draws over it). */
export function lookSkyMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'surface-sky', side: THREE.BackSide, depthWrite: false, fog: false});
  const dir = n(normalize(n(positionWorld).sub(cameraPosition)));
  m.colorNode = vec4(skyAt(dir), 1);
  return track(m);
}

const flats = new Map<string, MeshBasicNodeMaterial>();
/** Flat outdoor-lit finishes: 'roof' (tar-and-gravel membrane grey), 'coping' (concrete caps / parapet backs / burnt decks), 'ground'. */
export function outdoorFlatMaterial(kind: 'roof' | 'coping' | 'ground' | 'steel'): MeshBasicNodeMaterial {
  let m = flats.get(kind);
  if (m) return m;
  const albedo = kind === 'roof' ? [0.2, 0.195, 0.185] : kind === 'coping' ? [0.36, 0.35, 0.33] : kind === 'ground' ? [0.17, 0.16, 0.145] : [0.12, 0.115, 0.11];
  m = new MeshBasicNodeMaterial({name: `surface-outdoor-${kind}`});
  m.colorNode = Fn(() => {
    const nn = n(normalWorld);
    // a little world-space variation (patches, soot) so large flat roofs are not a single tone
    const v = n(wmNoise(n(positionWorld).mul(0.35))).mul(0.25).add(0.88);
    return vec4(n(vec3(albedo[0], albedo[1], albedo[2])).mul(v).mul(hemi(nn)), 1);
  })();
  flats.set(kind, m);
  m.addEventListener('dispose', () => { if (flats.get(kind) === m) flats.delete(kind); });
  return track(m);
}

const models = new Map<string, MeshBasicNodeMaterial>();
/**
 * An outdoor model's material: its own (Meshy / Office) base colour map and tint under the overcast hemisphere, scene fog on.
 * One per source map (shared by every instance); the far city darkens a touch with distance (`far`).
 */
export function outdoorModelMaterial(src: THREE.Material, far = false): MeshBasicNodeMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const map = std.map ?? null;
  const key = `${far ? 'far' : 'near'}:${map ? map.uuid : (std.color ?? new THREE.Color(0x777777)).getHexString()}`;
  let m = models.get(key);
  if (m) return m;
  const tint = std.color ?? new THREE.Color(0xffffff);
  m = new MeshBasicNodeMaterial({name: far ? 'surface-far-model' : 'surface-outdoor-model'});
  m.colorNode = Fn(() => {
    const albedo = n(map ? n(texture(map, uv())).rgb.mul(vec3(tint.r, tint.g, tint.b)) : vec3(tint.r, tint.g, tint.b));
    const nn = n(normalWorld);
    // soot / rain streaks down vertical faces of the ruins (cheap, world space)
    const vert = n(float(1).sub(abs(n(nn).y)));
    const streak = n(smoothstep(0.55, 0.85, n(wmNoise(n(vec3(n(positionWorld).x.add(n(positionWorld).z).mul(1.7), n(positionWorld).y.mul(0.08), 2.1)))))).mul(vert).mul(0.3);
    const dim = far ? 0.85 : 1;
    return vec4(n(albedo).mul(float(dim).sub(streak)).mul(hemi(nn)), 1);
  })();
  models.set(key, m);
  m.addEventListener('dispose', () => { if (models.get(key) === m) models.delete(key); });
  return track(m);
}

/** Every material this module created and still holds (released with the district's level resources; tests: releaseLookMaterials). */
export const liveLookMaterials = (): number => created.size;

/** Dispose every cached outdoor / sky material (tests / QA; the next district rebuilds them). */
export function releaseLookMaterials(): number {
  const list = [...created];
  for (const m of list) m.dispose();
  flats.clear();
  models.clear();
  return list.length;
}
