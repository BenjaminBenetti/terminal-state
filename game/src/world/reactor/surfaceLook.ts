// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): THE OUTDOOR LOOK of the surface after the win — clear,
// habitable air in the rain ("the fog is now cleared! The surface is habitable again! (however ofc the city is still destroyed)").
// Code-driven materials only (no new texture): the Meshy models keep their own maps; the ground reuses the Reactor's Codex
// pit-concrete set; the WET look (darkened, glossy sky sheen, puddles, rain ripples, runoff on facades) is a dynamic rain effect
// (root CLAUDE.md: dynamic / procedural rain and wet effects are exempt).
//
// Lighting: never the station light field — unlit node materials with an overcast sky hemisphere, the blue beam's light round the
// aperture (beam uniform: its x / z, on) and a light, NON-TOXIC rain mist (neutral blue-grey, exp2 like three's FogExp2: ~20 % at
// 100 m) toward the outdoor sky's horizon. fog: false (the pit's olive FogExp2 never reaches the city). Plain uniforms only (module
// singletons SURF_U; QA-tunable through surfaceTune), never a uniformArray, no volumetric-march change.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {
  Fn, abs, cameraPosition, clamp, dot, exp, float, floor, fract, int, ivec2, length, max, mix, normalWorld, normalize,
  positionWorld, pow, smoothstep, texture, time, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {wmHash, wmNoise} from '../surfaceNodes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;
type V3 = readonly [number, number, number];

/** The outdoor look (linear colours; QA tunable). */
export const SURFACE_LOOK = {
  /** Overcast sky hemisphere on the models / ground (top, bottom). */
  sky: [0.2, 0.22, 0.255] as V3, ground: [0.05, 0.05, 0.055] as V3,
  /** The outdoor sky: horizon (also the mist colour) and zenith; cloud contrast. */
  horizon: [0.11, 0.125, 0.14] as V3, zenith: [0.045, 0.068, 0.105] as V3, clouds: 0.32,
  /** Rain mist density (exp2, 1/m): 1 - exp(-(d k)^2) = ~20 % at 100 m, ~45 % at 150 m. Light weather, never toxic, never green. */
  mist: 0.0047,
  /** Wetness: albedo darkening, sky sheen gain, puddle cover. */
  wetDark: 0.36, sheen: 0.55, puddles: 0.5,
  /** The blue beam's light on the city: gain, falloff radius (m). */
  beamGain: 0.9, beamR: 22,
} as const;

/** The beam's colour (startupSky.ts BEAM.colour). */
const BEAM_RGB: V3 = [0.32, 0.6, 1];

const c3 = (v: V3) => new THREE.Color(v[0], v[1], v[2]);

/** Module uniforms (the runtime writes wet / beam / beamTop per frame; one Reactor world at a time). */
export const SURF_U = {
  sky: uniform(c3(SURFACE_LOOK.sky)), ground: uniform(c3(SURFACE_LOOK.ground)),
  horizon: uniform(c3(SURFACE_LOOK.horizon)), zenith: uniform(c3(SURFACE_LOOK.zenith)), clouds: uniform(SURFACE_LOOK.clouds as number),
  mist: uniform(SURFACE_LOOK.mist as number),
  /** Wetness 0..1 (builds with the rain), the beam (x, z, on, unused) and the beam's top in the clouds (world). */
  wet: uniform(0), beam: uniform(new THREE.Vector4(0, 0, 0, 0)), beamTop: uniform(new THREE.Vector3(0, 200, 0)),
  /** The yard rect (x0, z0, x1, z1): the ground's street mask is 0 there. */
  yard: uniform(new THREE.Vector4(0, 0, 0, 0)),
  /** The street-mask rows: origin x / z, cell (m), texels per row. */
  maskXf: uniform(new THREE.Vector4(0, 0, 1, 1)),
  /** The outdoor sky's opacity (the clearing 0..1: over the pit's murk dome until clear). */
  skyOn: uniform(0),
};

/** Uniform tuning (QA `__LL.reactorSurface({tune})`): colours as linear rgb triples, numbers as given. */
export function surfaceTune(o: Partial<Record<'sky' | 'ground' | 'horizon' | 'zenith', [number, number, number]> & Record<'clouds' | 'mist', number>> = {}): Record<string, unknown> {
  for (const k of ['sky', 'ground', 'horizon', 'zenith'] as const) { const v = o[k]; if (v && v.every(Number.isFinite)) (SURF_U[k].value as THREE.Color).setRGB(v[0], v[1], v[2]); }
  for (const k of ['clouds', 'mist'] as const) { const v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) (SURF_U[k] as {value: number}).value = Math.max(0, v); }
  return {sky: (SURF_U.sky.value as THREE.Color).toArray(), ground: (SURF_U.ground.value as THREE.Color).toArray(), horizon: (SURF_U.horizon.value as THREE.Color).toArray(),
    zenith: (SURF_U.zenith.value as THREE.Color).toArray(), clouds: SURF_U.clouds.value, mist: SURF_U.mist.value, mist100: mistOpacity(100, SURF_U.mist.value as number)};
}

/** CPU mirror of the mist: opacity over d metres (exp2). */
export const mistOpacity = (d: number, k: number = SURFACE_LOOK.mist): number => 1 - Math.exp(-((d * k) ** 2));

// ---------------------------------------------------------------------------------------------------------------------------
// Shared terms

/** The sky colour along view direction `dir` (the outdoor dome; also what the mist fades into): overcast, a cloud deck, the beam. */
const skyAt = (dir: N, clouds: boolean): N => {
  const e = n(dir).y;
  const up = n(max(e, 0));
  const base = n(mix(SURF_U.horizon, SURF_U.zenith, smoothstep(0.02, 0.62, up)));
  let col = n(mix(n(SURF_U.horizon).mul(0.78), base, smoothstep(-0.12, 0.01, e)));
  if (clouds) {
    // a slow overcast deck (projected onto a plane overhead), darker billows; rain columns toward the horizon
    const q = n(n(dir).xz.div(max(up, 0.06).add(0.1)));
    const drift = n(time).mul(0.004);
    const c1 = n(wmNoise(n(vec3(n(q.x).mul(1.3).add(drift), n(q.y).mul(1.3), n(time).mul(0.003)))));
    const c2 = n(wmNoise(n(vec3(n(q.x).mul(4.1), n(q.y).mul(4.1).sub(drift.mul(2)), 3.7))));
    const deck = n(c1).mul(0.7).add(n(c2).mul(0.3));
    col = n(col).mul(float(1).add(n(deck).sub(0.5).mul(SURF_U.clouds).mul(smoothstep(0.0, 0.3, up))));
  }
  // the beam where it meets the clouds: a tight core glow and a wide wash lighting the deck from below
  const bd = n(normalize(n(SURF_U.beamTop).sub(cameraPosition)));
  const k = n(max(dot(dir, bd), 0));
  const glow = n(pow(k, 220).mul(2.4).add(pow(k, 18).mul(0.5)).add(pow(k, 4).mul(0.08))).mul(n(SURF_U.beam).z);
  return n(col).add(n(vec3(BEAM_RGB[0], BEAM_RGB[1], BEAM_RGB[2])).mul(glow));
};

/** The light rain mist over the view ray to the shaded point (exp2 over the distance, toward the sky's horizon colour). */
const mist = (col: N): N => {
  const D = n(positionWorld).sub(cameraPosition);
  const d = n(length(D));
  const f = n(float(1).sub(exp(n(d).mul(SURF_U.mist).mul(n(d).mul(SURF_U.mist)).negate())));
  return mix(col, skyAt(n(D).div(max(d, 1e-3)), false), f);
};

/** Overcast hemisphere + the beam's blue light round the aperture's axis (n = world normal). */
const outdoorLight = (nn: N): N => {
  const hemi = n(mix(SURF_U.ground, SURF_U.sky, n(nn).y.mul(0.5).add(0.5)));
  const to = n(vec2(n(SURF_U.beam).x, n(SURF_U.beam).y).sub(n(positionWorld).xz));
  const dx = n(length(to));
  const toAxis = n(vec3(n(to).x, 0, n(to).y).div(max(dx, 1e-3)));
  const fall = n(float(1).div(float(1).add(dx.div(SURFACE_LOOK.beamR).mul(dx.div(SURFACE_LOOK.beamR)))));
  const facing = n(max(dot(nn, toAxis), 0).mul(0.65).add(0.35));
  const beam = n(vec3(BEAM_RGB[0], BEAM_RGB[1], BEAM_RGB[2])).mul(fall.mul(facing).mul(n(SURF_U.beam).z).mul(SURFACE_LOOK.beamGain));
  return n(hemi).add(beam);
};

/** Fresnel-weighted sky reflection (the wet sheen) for normal nn. */
const sheen = (nn: N, gain: N): N => {
  const V = n(normalize(n(cameraPosition).sub(positionWorld)));
  const ndv = n(max(dot(nn, V), 0));
  const fr = n(pow(float(1).sub(ndv), 4).mul(0.85).add(0.05));
  // the reflected ray's sky (no clouds: cheap), toward the horizon on wet ground
  const R = n(normalize(n(V).negate().add(n(nn).mul(ndv.mul(2)))));
  return n(skyAt(R, false)).mul(fr).mul(gain).mul(SURF_U.wet);
};

// ---------------------------------------------------------------------------------------------------------------------------
// Materials

const modelMats = new Map<string, MeshBasicNodeMaterial>();

/**
 * A city model's material: its own Meshy / Office base colour map, the overcast + beam light, wet (darker, runoff streaks down the
 * facades, a glossy sheen on up-facing ledges and roofs), the rain mist. One per source map (shared by every instance of a model).
 */
export function surfaceModelMaterial(src: THREE.Material): MeshBasicNodeMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const map = std.map ?? null;
  const key = map ? `map:${map.uuid}` : `col:${(std.color ?? new THREE.Color(0x777777)).getHexString()}`;
  let m = modelMats.get(key);
  if (m) return m;
  const tint = std.color ?? new THREE.Color(0xffffff);
  m = new MeshBasicNodeMaterial({name: 'reactor-surface-model', fog: false});
  m.colorNode = Fn(() => {
    const albedo = n(map ? n(texture(map, uv())).rgb.mul(vec3(tint.r, tint.g, tint.b)) : vec3(tint.r, tint.g, tint.b)).toVar('sfA');
    const nn = n(normalWorld).toVar('sfN');
    const vert = n(float(1).sub(abs(nn.y)));
    // rain runoff: vertical drip lines down the facades (slow, darker bands), only on vertical faces
    const along = n(dot(n(positionWorld).xz, n(vec2(n(nn).z.negate(), n(nn).x))));
    const drip = n(wmNoise(n(vec3(n(along).mul(2.3), n(positionWorld).y.mul(0.09).add(n(time).mul(0.35)), 1.7))));
    const streak = n(smoothstep(0.52, 0.82, drip)).mul(vert).mul(0.32);
    const wet = n(float(1).sub(n(SURF_U.wet).mul(float(SURFACE_LOOK.wetDark).add(streak))));
    const ledge = n(smoothstep(0.55, 0.9, nn.y));
    const col = n(albedo).mul(wet).mul(outdoorLight(nn)).add(sheen(nn, n(ledge).mul(0.8).add(0.25).mul(SURFACE_LOOK.sheen)));
    return vec4(mist(col), 1);
  })();
  modelMats.set(key, m);
  return m;
}

/** Dispose the cached model materials (teardown: the next Reactor world rebuilds them against its own maps). */
export function releaseSurfaceMaterials(): void {
  for (const m of modelMats.values()) m.dispose();
  modelMats.clear();
}

/** A plain steel material for the water-tank stands (outdoor-lit, wet, misted; no texture). */
export function surfaceSteelMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'reactor-surface-steel', fog: false});
  m.colorNode = Fn(() => {
    const nn = n(normalWorld);
    const col = n(vec3(0.16, 0.14, 0.12)).mul(float(1).sub(n(SURF_U.wet).mul(0.3))).mul(outdoorLight(nn)).add(sheen(nn, float(0.4)));
    return vec4(mist(col), 1);
  })();
  return m;
}

/**
 * Wet cast concrete (the plaza parapet): the Reactor's Codex pit-concrete colour map world-mapped (vertical faces: along the face x
 * height; tops: x / z; 2.4 m tiles; a flat tone when absent), darkened by the rain, runoff streaks, the sky sheen on its top.
 */
export function surfaceWallMaterial(concrete: THREE.Texture | null): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'reactor-surface-wall', fog: false});
  m.colorNode = Fn(() => {
    const nn = n(normalWorld).toVar('swN'), p = n(positionWorld);
    const top = n(abs(nn.y).greaterThan(0.5));
    const along = n(dot(n(p).xz, n(vec2(n(nn).z.negate(), n(nn).x))));
    const st = n(top.select(n(p).xz, n(vec2(along, n(p).y)))).div(2.4);
    const base = n(concrete ? n(texture(concrete, st)).rgb.mul(0.9) : vec3(0.4, 0.39, 0.37));
    const drip = n(wmNoise(n(vec3(n(along).mul(3.1), n(p).y.mul(0.5).add(n(time).mul(0.3)), 0.7))));
    const streak = n(smoothstep(0.55, 0.85, drip)).mul(float(1).sub(abs(nn.y))).mul(0.3);
    const col = n(base).mul(float(1).sub(n(SURF_U.wet).mul(float(SURFACE_LOOK.wetDark).add(streak)))).mul(outdoorLight(nn)).add(sheen(nn, n(top.select(float(0.9), float(0.3))).mul(SURFACE_LOOK.sheen)));
    return vec4(mist(col), 1);
  })();
  return m;
}

/**
 * Rain ripples on a flat wet surface at world xz: expanding rings in a jittered 0.55 m grid (each cell its own phase), 0..1.
 */
const ripples = (xz: N): N => {
  const g = n(xz).div(0.55);
  const cell = n(floor(g));
  const h = n(wmHash(n(vec3(n(cell).x, n(cell).y, 5.1))));
  const h2 = n(wmHash(n(vec3(n(cell).y, n(cell).x, 9.3))));
  const ph = n(fract(n(time).mul(0.9).add(h)));
  const c = n(cell).add(vec2(n(h2).mul(0.6).add(0.2), n(h).mul(0.6).add(0.2)));
  const r = n(length(g.sub(c)));
  const ring = n(float(1).sub(smoothstep(0, 0.06, abs(r.sub(ph.mul(0.45)))))).mul(float(1).sub(ph)).mul(ph.lessThan(0.97).select(float(1), float(0)));
  return ring;
};

/**
 * THE CITY GROUND: the Reactor's Codex pit-concrete colour map (world-mapped, 3 m tiles; a flat tone when absent) — carriageway darker
 * and smoother, pavements lighter, lots dusty — wet, with puddles (mirror-ish sky, rain ripples) gathering on the carriageways. The
 * street mask is a 1-D data texture of two rows (across x / across z: 1 road, 0.5 pavement, 0 lot), CPU mirror surfacePlan.ts
 * streetMaskAt; the yard (SURF_U.yard) is 0.
 */
export function surfaceGroundMaterial(mask: THREE.DataTexture, concrete: THREE.Texture | null): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'reactor-surface-ground', fog: false});
  m.colorNode = Fn(() => {
    const p = n(positionWorld).toVar('sgP');
    const xf = n(SURF_U.maskXf);
    const tx = n(clamp(floor(n(p.x).sub(xf.x).div(xf.z)), 0, n(xf.w).sub(1))), tz = n(clamp(floor(n(p.z).sub(xf.y).div(xf.z)), 0, n(xf.w).sub(1)));
    const mx = n(texture(mask).load(ivec2(int(tx), int(0)))).r, mz = n(texture(mask).load(ivec2(int(tz), int(1)))).r;
    const Y = n(SURF_U.yard);
    const inYard = n(p.x).greaterThan(Y.x).and(n(p.x).lessThan(Y.z)).and(n(p.z).greaterThan(Y.y)).and(n(p.z).lessThan(Y.w));
    const st = n(inYard.select(float(0), max(mx, mz))).toVar('sgSt');
    const road = n(smoothstep(0.75, 0.95, st)), walk = n(smoothstep(0.3, 0.5, st)).mul(float(1).sub(road));
    const base = n(concrete ? n(texture(concrete, n(p).xz.div(3))).rgb : vec3(0.42, 0.4, 0.37)).toVar('sgBase');
    const lot = n(base).mul(vec3(0.78, 0.74, 0.68));
    const albedo = n(mix(mix(lot, n(base).mul(0.95), walk), n(base).mul(vec3(0.36, 0.37, 0.4)), road)).toVar('sgAl');
    // puddles: low-frequency patches, mostly on the carriageway; rain ripples inside them
    const pn = n(wmNoise(n(vec3(n(p.x).mul(0.09), 2.3, n(p.z).mul(0.09)))).mul(0.65).add(n(wmNoise(n(vec3(n(p.x).mul(0.31), 7.1, n(p.z).mul(0.31))))).mul(0.35)));
    const cover = n(mix(float(0.34), float(SURFACE_LOOK.puddles), road));
    const puddle = n(smoothstep(float(1).sub(cover), float(1).sub(cover).add(0.07), pn)).mul(SURF_U.wet).toVar('sgPud');
    const rip = n(ripples(n(p).xz)).mul(SURF_U.wet);
    const up = n(vec3(0, 1, 0));
    const lit = n(albedo).mul(float(1).sub(n(SURF_U.wet).mul(SURFACE_LOOK.wetDark)).sub(puddle.mul(0.25))).mul(outdoorLight(up));
    const gloss = n(float(0.35).add(road.mul(0.25)).add(puddle.mul(1.6)).add(rip.mul(0.9)));
    return vec4(mist(n(lit).add(sheen(up, gloss.mul(SURFACE_LOOK.sheen)))), 1);
  })();
  return m;
}

/**
 * THE WET FILM over the walkable surface (lane ENDING's floor, whose material is not this lane's): a transparent premultiplied
 * overlay a hair above it — darkens the floor (alpha) and adds the wet sky sheen, puddles and rain ripples (rgb). Nothing under a
 * shelter or over the aperture (the geometry skips those cells).
 */
export function surfaceFilmMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'reactor-surface-film', fog: false, transparent: true, depthWrite: false, premultipliedAlpha: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  const p = n(positionWorld);
  const pn = n(wmNoise(n(vec3(n(p.x).mul(0.12), 4.4, n(p.z).mul(0.12)))));
  const puddle = n(smoothstep(0.62, 0.7, pn));
  const rip = n(ripples(n(p).xz));
  const up = n(vec3(0, 1, 0));
  const gl = n(sheen(up, n(float(0.45).add(puddle.mul(1.4)).add(rip.mul(0.9))).mul(SURFACE_LOOK.sheen)));
  m.colorNode = vec4(gl, 1);
  m.opacityNode = n(SURF_U.wet).mul(n(float(0.3).add(puddle.mul(0.2))));
  return m;
}

/**
 * THE OUTDOOR SKY (follows the eye while outside): the cleared overcast — STARTUP's cleared-sky palette brightened for daylight rain
 * (startupSky.ts CLEAR_SKY: blue-grey horizon to a deeper zenith) — a slow cloud deck and the beam's glow where it meets the clouds.
 * Transparent over the pit's murk dome, opacity = the clearing (SURF_U.skyOn).
 */
export function surfaceSkyMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'reactor-surface-sky', side: THREE.BackSide, transparent: true, depthWrite: false, fog: false});
  const dir = n(normalize(n(positionWorld).sub(cameraPosition)));
  m.colorNode = vec4(skyAt(dir, true), 1);
  m.opacityNode = n(SURF_U.skyOn);
  return m;
}

/** The ground's street mask rows (R32F, width = texels, height 2: row 0 across x, row 1 across z). textureLoad only. */
export function streetMaskTexture(rows: Float32Array, texels: number): THREE.DataTexture {
  const t = new THREE.DataTexture(rows, texels, 2, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  t.name = 'reactor-surface-street-mask';
  return t;
}
