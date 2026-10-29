// Iteration 16 (lane TOWER) / task office-seamless (lane LIFT): the destroyed city seen from the office tower windows —
// SCENERY ONLY (never walkable; the windows are solid). Built ONCE for the continuous Office Space world in real world
// coordinates: from floor 8 the street really is ~31 m below (true height and parallax; no per-floor offsets). Layers:
//  - street level at groundY = layout.office.groundY (the lobby floor: the lobby is at street level): a ground
//    "city map" (ring road around the tower, cross streets, pavements, scorched lots) with the tower footprint cut out;
//  - near street props on the ring road / cross streets: wrecked cars (C1), buses (C5), rubble piles (C2) — lane ASSETS'
//    Meshy models via officeAssets when delivered, simple procedural stand-ins otherwise;
//  - mid ruined buildings on the city blocks: some Meshy ruined towers / mid-rises (C3 / C4, instanced), the rest
//    procedural box blocks with jagged broken tops, exposed slabs and collapsed rubble mounds (one instanced draw);
//  - a far skyline (ASSETS' T5 panorama, procedural fallback) and a dusk / overcast sky on a dome that follows the eye.
// Lighting: never the station light field — unlit node materials with a fake hemisphere + low sun, so it reads at dusk.
// Fog: OFF on the materials; their own fog instead = the station FogExp2 over the part of the view ray INSIDE the
// tower footprint (same density / colour as the interior: a far window across a dark floor is hazed like the floor)
// plus a light exterior haze beyond. Budget: instancing; Meshy instances are split per quadrant so frustum culling
// drops whole quadrants; ~2k-tri dome; procedural blocks are 12 tris each.

import * as THREE from 'three';
import {MeshBasicNodeMaterial, type Node} from 'three/webgpu';
import {
  Fn, abs, cameraPosition, clamp, dot, exp, float, floor, fract, hash, length, max, min, mix, normalWorld, normalize,
  positionView, positionWorld, pow, select, smoothstep, texture, uniform, uv, vec2, vec3, attribute, atan,
} from 'three/tsl';
import {mulberry32} from '../core/rng';
import {MOOD} from './lights';
import {canvasTexture} from './canvasTextures';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {Rect2} from './towerShared';
import {OFFICE_ASSETS} from '../assets/officeAssets';

type N = Node<'float'> & Node;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

// ---------------------------------------------------------------------------------------------
// Plan (pure, deterministic per section seed)

export type PropKind = 'car' | 'bus' | 'rubble';
export interface PropPlace { kind: PropKind; x: number; z: number; yaw: number; scale: number }
export type BuildingKind = 'tower' | 'midrise' | 'block' | 'collapsed';
export interface BuildingPlace { kind: BuildingKind; x: number; z: number; w: number; d: number; h: number; yaw: number; seed: number }
export interface StreetRect extends Rect2 { kind: 'road' | 'walk' | 'lot' }

export interface ExteriorPlan {
  groundY: number;
  /** Eye height above the street (m), for the skyline horizon dip. */
  eyeAbove: number;
  foot: Rect2;
  center: {x: number; z: number};
  /** Ground extent (half size, m) around the centre. */
  half: number;
  streets: StreetRect[];
  props: PropPlace[];
  buildings: BuildingPlace[];
  skyline: {wraps: number; offset: number; e0: number; e1: number};
}

export const EXTERIOR = {
  /** Ring road around the tower: pavement width, road width (m). */
  pavement: 5, road: 14,
  /** City blocks beyond the ring: block size, street width (m). */
  block: 46, street: 16,
  rings: 4,
  half: 380,
  /** Dome radius (inside the raised camera far plane). */
  dome: 460,
  far: 700,
  /** Meshy hero buildings / props placed at most (tris budget: C3/C4 20k, C1 8k, C5 10k, C2 6k). */
  maxTowers: 2, maxMidrise: 3, cars: 6, buses: 2, rubble: 5,
} as const;

/** Footprints (x, z, m) of the Meshy hero buildings (ASSETS' measured runtime dims; manifest sizes as fallback). */
const HERO_DIMS: Record<'tower' | 'midrise', [number, number]> = {
  tower: [OFFICE_ASSETS['ruined-tower'].dims?.[0] ?? 37, OFFICE_ASSETS['ruined-tower'].dims?.[2] ?? 45],
  midrise: [OFFICE_ASSETS['ruined-midrise'].dims?.[0] ?? 25, OFFICE_ASSETS['ruined-midrise'].dims?.[2] ?? 23],
};
/** Lot fit at scale >= 0.85 (either orientation). */
function heroFits(kind: 'tower' | 'midrise', w: number, d: number): boolean {
  const [dx, dz] = HERO_DIMS[kind], k = 0.85;
  return (dx * k <= w && dz * k <= d) || (dz * k <= w && dx * k <= d);
}
/** Hero scale + extra yaw so the model fits its lot (0.85 .. 1.12). */
export function heroFit(kind: 'tower' | 'midrise', b: {w: number; d: number; seed: number}): {scale: number; turn: number} {
  const [dx, dz] = HERO_DIMS[kind];
  const want = 0.92 + (b.seed % 1000) / 1000 * 0.2;
  const s0 = Math.min(b.w / dx, b.d / dz), s1 = Math.min(b.w / dz, b.d / dx);
  const turn = s1 > s0 ? Math.PI / 2 : 0;
  return {scale: Math.max(0.6, Math.min(want, Math.max(s0, s1))), turn};
}

/** 1D block intervals outward from a centre block [-c, c]: ring k -> [start, end] on the positive side. */
function blockSpan(c: number, k: number): [number, number] {
  const s = c + EXTERIOR.pavement + EXTERIOR.road + (k - 1) * (EXTERIOR.block + EXTERIOR.street);
  return [s, s + EXTERIOR.block];
}

export function planExterior(o: {foot: Rect2; groundY: number; eyeAbove: number; seed: number}): ExteriorPlan {
  const rnd = mulberry32((o.seed ^ 0x7e57c17) >>> 0);
  const {foot} = o;
  const center = {x: (foot.x0 + foot.x1) / 2, z: (foot.z0 + foot.z1) / 2};
  const hx = (foot.x1 - foot.x0) / 2, hz = (foot.z1 - foot.z0) / 2;
  const streets: StreetRect[] = [];
  const P = EXTERIOR.pavement, R = EXTERIOR.road;
  // pavement + ring road (as rects in world space)
  const ring = (d0: number, d1: number, kind: StreetRect['kind']) => {
    streets.push({kind, x0: center.x - hx - d1, x1: center.x + hx + d1, z0: center.z - hz - d1, z1: center.z - hz - d0});
    streets.push({kind, x0: center.x - hx - d1, x1: center.x + hx + d1, z0: center.z + hz + d0, z1: center.z + hz + d1});
    streets.push({kind, x0: center.x - hx - d1, x1: center.x - hx - d0, z0: center.z - hz - d0, z1: center.z + hz + d0});
    streets.push({kind, x0: center.x + hx + d0, x1: center.x + hx + d1, z0: center.z - hz - d0, z1: center.z + hz + d0});
  };
  ring(0, P, 'walk');
  ring(P, P + R, 'road');
  const H = EXTERIOR.half;
  const strip = (axis: 'x' | 'z', a0: number, a1: number) => streets.push(axis === 'x'
    ? {kind: 'road', x0: Math.min(a0, a1), x1: Math.max(a0, a1), z0: center.z - H, z1: center.z + H}
    : {kind: 'road', x0: center.x - H, x1: center.x + H, z0: Math.min(a0, a1), z1: Math.max(a0, a1)});
  for (const sgn of [-1, 1]) {
    // the ring road's legs continue outward as streets (the blocks across from the tower face it over the ring road)
    strip('x', center.x + sgn * (hx + P), center.x + sgn * (hx + P + R));
    strip('z', center.z + sgn * (hz + P), center.z + sgn * (hz + P + R));
    // cross streets after every block ring
    for (let k = 1; k <= EXTERIOR.rings; k++) {
      const [, ex] = blockSpan(hx, k), [, ez] = blockSpan(hz, k);
      strip('x', center.x + sgn * ex, center.x + sgn * (ex + EXTERIOR.street));
      strip('z', center.z + sgn * ez, center.z + sgn * (ez + EXTERIOR.street));
    }
  }
  // --- buildings on the blocks ---
  const buildings: BuildingPlace[] = [];
  let towers = 0, mids = 0;
  const spanOf = (c: number, k: number, sgn: number): [number, number] => {
    if (k === 0) return [-c - P + 1, c + P - 1]; // the band of the tower block (blocks across the ring road from it)
    const [a, b] = blockSpan(c, k);
    return sgn > 0 ? [a, b] : [-b, -a];
  };
  for (let i = -EXTERIOR.rings; i <= EXTERIOR.rings; i++) {
    for (let j = -EXTERIOR.rings; j <= EXTERIOR.rings; j++) {
      if (i === 0 && j === 0) continue; // the tower's own block
      const [ax0, ax1] = spanOf(hx, Math.abs(i), Math.sign(i));
      const [az0, az1] = spanOf(hz, Math.abs(j), Math.sign(j));
      const ringK = Math.max(Math.abs(i), Math.abs(j));
      // 1-3 lots per block
      const lots = rnd() < 0.45 ? 1 : rnd() < 0.6 ? 2 : 3;
      for (let l = 0; l < lots; l++) {
        const along = lots === 1 ? [0, 1] : [l / lots, (l + 1) / lots];
        const splitX = rnd() < 0.5;
        const bx0 = splitX ? ax0 + (ax1 - ax0) * along[0] : ax0, bx1 = splitX ? ax0 + (ax1 - ax0) * along[1] : ax1;
        const bz0 = splitX ? az0 : az0 + (az1 - az0) * along[0], bz1 = splitX ? az1 : az0 + (az1 - az0) * along[1];
        const setback = 1.5 + rnd() * 3;
        const w = Math.max(8, bx1 - bx0 - setback * 2), d = Math.max(8, bz1 - bz0 - setback * 2);
        const x = center.x + (bx0 + bx1) / 2, z = center.z + (bz0 + bz1) / 2;
        const r = rnd();
        let kind: BuildingKind = r < 0.22 ? 'collapsed' : 'block';
        let h = ringK === 1 ? 12 + rnd() * 34 : ringK === 2 ? 16 + rnd() * 52 : 20 + rnd() * 70;
        // Meshy hero models on the inner rings (when delivered; the runtime falls back to blocks otherwise)
        // (only on lots their real footprint fits, ASSETS' measured dims; turned 90 deg when that fits better)
        if (kind === 'block' && ringK <= 2 && towers < EXTERIOR.maxTowers && r > 0.86 && heroFits('tower', w, d)) { kind = 'tower'; h = 60; towers++; }
        else if (kind === 'block' && ringK <= 2 && mids < EXTERIOR.maxMidrise && r > 0.62 && r <= 0.86 && heroFits('midrise', w, d)) { kind = 'midrise'; h = 30; mids++; }
        if (kind === 'collapsed') h = 3 + rnd() * 9;
        // facing 0 / 180 deg (+ a little jitter): the lot's w stays along x (a quarter turn would swap w / d into the streets)
        const yaw = (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.05;
        buildings.push({kind, x, z, w, d, h, yaw, seed: Math.floor(rnd() * 1e9)});
      }
    }
  }
  // --- street props on the ring road and the first cross streets ---
  const props: PropPlace[] = [];
  const clearOf = (x: number, z: number, r: number) => props.every(p => Math.hypot(p.x - x, p.z - z) > r + (p.kind === 'bus' ? 6 : 2.6));
  const onRing = (kind: PropKind, n: number, minR: number) => {
    for (let k = 0, tries = 0; k < n && tries < n * 30; tries++) {
      const side = Math.floor(rnd() * 4);
      const lane = P + R * (0.2 + rnd() * 0.6);
      const t = rnd() * 2 - 1;
      let x: number, z: number, yaw: number;
      if (side < 2) { x = center.x + t * (hx + P + R * 0.5); z = center.z + (side === 0 ? -1 : 1) * (hz + lane); yaw = Math.PI / 2 + (rnd() < 0.5 ? 0 : Math.PI); }
      else { z = center.z + t * (hz + P + R * 0.5); x = center.x + (side === 2 ? -1 : 1) * (hx + lane); yaw = rnd() < 0.5 ? 0 : Math.PI; }
      if (!clearOf(x, z, minR)) continue;
      // crashed: off-axis yaw, some up on the pavement
      yaw += (rnd() - 0.5) * (kind === 'car' ? 1.1 : 0.4);
      props.push({kind, x, z, yaw, scale: kind === 'rubble' ? 0.7 + rnd() * 0.8 : 0.95 + rnd() * 0.1});
      k++;
    }
  };
  onRing('bus', EXTERIOR.buses, 6);
  onRing('car', EXTERIOR.cars, 2.4);
  onRing('rubble', EXTERIOR.rubble, 2.5);
  // rubble mounds in front of collapsed buildings are part of the building layer (instanced mounds)
  const eyeAbove = Math.max(0, o.eyeAbove);
  return {
    groundY: o.groundY, eyeAbove, foot, center, half: H, streets, props, buildings,
    skyline: {wraps: 5, offset: rnd(), e0: -0.035 - Math.min(0.06, eyeAbove / 600), e1: 0.42},
  };
}

// ---------------------------------------------------------------------------------------------
// Shading (module singletons; per-section values are uniforms)

export const EXT_U: Record<'box' | 'fogDensity' | 'fogColor' | 'haze' | 'hazeDensity' | 'sunDir' | 'sun' | 'sky' | 'ground' | 'zenith' | 'groundY' | 'skyline' | 'skyGain', AnyNode> = {
  /** Tower footprint (x0, z0, x1, z1): the station fog applies inside it. */
  box: uniform(new THREE.Vector4(-1e5, -1e5, 1e5, 1e5)),
  fogDensity: uniform(MOOD.fogDensity),
  fogColor: uniform(new THREE.Color(MOOD.fogColor)),
  haze: uniform(new THREE.Color(0.115, 0.1, 0.092)),
  hazeDensity: uniform(0.0036),
  sunDir: uniform(new THREE.Vector3(-0.62, 0.16, -0.77).normalize()),
  sun: uniform(new THREE.Color(0.2, 0.115, 0.07)),
  sky: uniform(new THREE.Color(0.075, 0.08, 0.092)),
  ground: uniform(new THREE.Color(0.026, 0.024, 0.022)),
  zenith: uniform(new THREE.Color(0.022, 0.026, 0.034)),
  groundY: uniform(0),
  /** Skyline band: wraps, offset, e0, e1 (sin of elevation). */
  skyline: uniform(new THREE.Vector4(5, 0, -0.04, 0.42)),
  skyGain: uniform(0.62),
};

/** Fake outdoor light: hemisphere (sky / ground) + a weak low sun. */
const outdoorLight = (n: AnyNode): AnyNode => mix(EXT_U.ground, EXT_U.sky, n.y.mul(0.5).add(0.5)).add(EXT_U.sun.mul(max(dot(n, EXT_U.sunDir), 0)));

/**
 * Exterior fog: the station's FogExp2 over the ray's part inside the tower footprint (view depth x that fraction,
 * as three's FogExp2), then a light haze over the outdoor part (toward the sun a little warmer).
 */
export const exteriorFog = (col: AnyNode): AnyNode => {
  const C = cameraPosition, D = positionWorld.sub(C).toVar();
  const dx = select(abs(D.x).lessThan(1e-4), float(1e-4), D.x), dz = select(abs(D.z).lessThan(1e-4), float(1e-4), D.z);
  const tx = select(dx.greaterThan(0), EXT_U.box.z.sub(C.x), EXT_U.box.x.sub(C.x)).div(dx);
  const tz = select(dz.greaterThan(0), EXT_U.box.w.sub(C.z), EXT_U.box.y.sub(C.z)).div(dz);
  const tIn = clamp(min(min(tx, tz), 1), 0, 1).toVar();
  const depthIn = positionView.z.negate().mul(tIn);
  const fogF = float(1).sub(exp(EXT_U.fogDensity.mul(depthIn).pow(2).negate()));
  const dist = length(D);
  const dir = D.div(max(dist, 1e-3));
  const outside = dist.mul(float(1).sub(tIn));
  const hazeF = float(1).sub(exp(EXT_U.hazeDensity.mul(outside).negate()));
  const hazeCol = EXT_U.haze.add(EXT_U.sun.mul(pow(max(dot(dir, EXT_U.sunDir), 0), 6).mul(0.8)));
  return mix(mix(col, hazeCol, hazeF), EXT_U.fogColor, fogF);
};

const mats = new Map<string, MeshBasicNodeMaterial>();
function basic(key: string, color: AnyNode, side: THREE.Side = THREE.FrontSide): MeshBasicNodeMaterial {
  let m = mats.get(key);
  if (!m) {
    m = new MeshBasicNodeMaterial({side});
    m.name = `tower-ext-${key}`;
    m.fog = false;
    m.colorNode = color;
    mats.set(key, m);
  }
  return m;
}

/** Per-vertex-coloured stand-in props (procedural cars / buses / rubble), outdoor-lit. */
function propMaterial(): MeshBasicNodeMaterial {
  return basic('prop', Fn(() => {
    const albedo = attribute('color', 'vec3');
    return vec3(exteriorFog(albedo.mul(outdoorLight(normalWorld))));
  })());
}

const modelMats = new WeakMap<THREE.Texture | THREE.Color, MeshBasicNodeMaterial>();
/** A Meshy model's base colour (map or colour) with the outdoor light and fog. */
function modelMaterial(src: THREE.Material): MeshBasicNodeMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const key: THREE.Texture | THREE.Color = std.map ?? std.color ?? new THREE.Color(0x777777);
  let m = modelMats.get(key);
  if (!m) {
    const tint = std.color ?? new THREE.Color(std.map ? 0xffffff : 0x777777);
    const albedo: AnyNode = std.map ? (texture(std.map, uv()).rgb as AnyNode).mul(vec3(tint.r, tint.g, tint.b)) : vec3(tint.r, tint.g, tint.b);
    m = new MeshBasicNodeMaterial();
    m.name = `tower-ext-model`;
    m.fog = false;
    m.colorNode = Fn(() => vec3(exteriorFog(albedo.mul(outdoorLight(normalWorld)).mul(1.15))))();
    modelMats.set(key, m);
  }
  return m;
}

let facadeTex: THREE.Texture | null = null;
/** 4 x 4 bays x floors of a ruined concrete facade (window holes, some boarded, burnt), tiled in world metres. */
function facadeTexture(): THREE.Texture {
  return (facadeTex ??= canvasTexture(256, 256, 51611, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#6d6862'; ctx.fillRect(0, 0, w, h);
    const bw = w / 4, bh = h / 4;
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
      const x = bx * bw, y = by * bh;
      // panel tone
      const t = 92 + Math.floor(rnd() * 30);
      ctx.fillStyle = `rgb(${t}, ${t - 4}, ${t - 9})`; ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      // window hole
      const r = rnd();
      ctx.fillStyle = r < 0.12 ? '#5a4a36' : r < 0.2 ? '#2a2420' : '#0c0d0e';
      ctx.fillRect(x + bw * 0.14, y + bh * 0.24, bw * 0.72, bh * 0.56);
      if (r > 0.94) { ctx.fillStyle = 'rgba(255, 140, 60, 0.45)'; ctx.fillRect(x + bw * 0.2, y + bh * 0.5, bw * 0.6, bh * 0.28); }
      // soot above the hole
      const g = ctx.createLinearGradient(0, y + bh * 0.24, 0, y - bh * 0.3);
      g.addColorStop(0, `rgba(10, 9, 8, ${0.25 + rnd() * 0.5})`); g.addColorStop(1, 'rgba(10, 9, 8, 0)');
      ctx.fillStyle = g; ctx.fillRect(x + bw * 0.1, y - bh * 0.3, bw * 0.8, bh * 0.55);
    }
  }));
}

/** Procedural ruined blocks: world-mapped facade (u along the face, v by storey), roofs, per-building tone. */
function blockMaterial(): MeshBasicNodeMaterial {
  return basic('block', Fn(() => {
    const n = normalWorld;
    const tangent = normalize(vec2(n.z.negate(), n.x).add(vec2(1e-4, 0)));
    const u = positionWorld.x.mul(tangent.x).add(positionWorld.z.mul(tangent.y)).div(3.2);
    const v = positionWorld.y.sub(EXT_U.groundY).div(3.4);
    const fac = texture(facadeTexture(), vec2(u, v).div(4)).rgb;
    const cell = floor(positionWorld.xz.div(41));
    const tone = float(hash(cell.x.mul(97).add(cell.y.mul(13)))).mul(0.45).add(0.65);
    const roof = vec3(0.16, 0.15, 0.14).mul(tone);
    const up = smoothstep(0.55, 0.8, n.y);
    // burnt upper floors: darker toward the top of tall blocks, a little warm grime low down
    const soot = smoothstep(18, 70, positionWorld.y.sub(EXT_U.groundY)).mul(0.35);
    const albedo = mix(fac.mul(tone).mul(float(1).sub(soot)), roof, up);
    return vec3(exteriorFog(albedo.mul(outdoorLight(n)).mul(1.1)));
  })());
}

let groundTexCache: {key: string; tex: THREE.Texture} | null = null;
let detailTex: THREE.Texture | null = null;
function groundDetail(): THREE.Texture {
  return (detailTex ??= canvasTexture(256, 256, 40411, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const g = 90 + Math.floor(rnd() * 90); ctx.fillStyle = `rgba(${g}, ${g}, ${g}, 0.5)`; ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3); }
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.6)'; ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) { ctx.beginPath(); let x = rnd() * w, y = rnd() * h; ctx.moveTo(x, y); for (let s = 0; s < 8; s++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; ctx.lineTo(x, y); } ctx.stroke(); }
  }));
}

/** The city map: roads, pavements, lots, scorch marks (one texture over the whole ground, per section plan). */
function groundTexture(plan: ExteriorPlan): THREE.Texture {
  const key = `${plan.center.x.toFixed(1)}|${plan.center.z.toFixed(1)}|${plan.foot.x1 - plan.foot.x0}|${plan.foot.z1 - plan.foot.z0}|${plan.half}`;
  if (groundTexCache?.key === key) return groundTexCache.tex;
  const S = 1024, H = plan.half;
  const tex = canvasTexture(S, S, 77017, (ctx, w, h, rnd) => {
    const px = (x: number) => ((x - (plan.center.x - H)) / (2 * H)) * w;
    const pz = (z: number) => ((z - (plan.center.z - H)) / (2 * H)) * h;
    ctx.fillStyle = '#3d3a35'; ctx.fillRect(0, 0, w, h); // lots: dirt / debris
    for (const s of plan.streets) {
      ctx.fillStyle = s.kind === 'road' ? '#2b2b2c' : s.kind === 'walk' ? '#5f5c57' : '#3d3a35';
      ctx.fillRect(px(s.x0), pz(s.z0), Math.max(1, px(s.x1) - px(s.x0)), Math.max(1, pz(s.z1) - pz(s.z0)));
    }
    // faded lane markings on the roads (dashes along the long axis)
    ctx.fillStyle = 'rgba(190, 170, 110, 0.35)';
    for (const s of plan.streets) {
      if (s.kind !== 'road') continue;
      const wide = s.x1 - s.x0 > s.z1 - s.z0;
      const len = wide ? s.x1 - s.x0 : s.z1 - s.z0;
      for (let t = 0; t < len; t += 9) {
        if (rnd() < 0.35) continue;
        if (wide) ctx.fillRect(px(s.x0 + t), pz((s.z0 + s.z1) / 2) - 0.5, (3 / (2 * H)) * w, 1);
        else ctx.fillRect(px((s.x0 + s.x1) / 2) - 0.5, pz(s.z0 + t), 1, (3 / (2 * H)) * h);
      }
    }
    // scorch / ash / debris blotches
    for (let i = 0; i < 160; i++) {
      const x = rnd() * w, y = rnd() * h, r = 3 + rnd() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.6;
      g.addColorStop(0, dark ? 'rgba(12, 11, 10, 0.55)' : 'rgba(120, 112, 100, 0.35)'); g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  groundTexCache?.tex.dispose();
  groundTexCache = {key, tex};
  return tex;
}

// texture nodes are created with a real texture of the same kind (canvas, sRGB, mipmapped) and only have their value
// swapped later (per-section city map, late T5 panorama): a binding change, never a rebuild
let groundMapNode: AnyNode = null;
const groundXform = uniform(new THREE.Vector4(0, 0, 1 / 760, 1 / 760));
function groundMaterial(first: THREE.Texture): MeshBasicNodeMaterial {
  groundMapNode ??= texture(first);
  return basic('ground', Fn(() => {
    const muv = positionWorld.xz.sub(vec2(groundXform.x, groundXform.y)).mul(vec2(groundXform.z, groundXform.w));
    // canvas row 0 = the north edge (min z); texture v = 0 is the image bottom (flipY)
    const base = groundMapNode.sample(vec2(muv.x, float(1).sub(muv.y))).rgb;
    const det = texture(groundDetail(), positionWorld.xz.div(6)).r.mul(0.7).add(0.65);
    return vec3(exteriorFog(base.mul(det).mul(outdoorLight(vec3(0, 1, 0)))));
  })());
}

/** Skyline + sky: panorama band (wrapped, mirrored every other wrap) over a dusk gradient with a low sun glow. */
let skylineNode: AnyNode = null;
let skylineWanted: THREE.Texture | null = null;
function skyMaterial(): MeshBasicNodeMaterial {
  skylineNode ??= texture(skylineWanted ?? skylineFallbackTexture());
  return basic('sky', Fn(() => {
    const D = positionWorld.sub(cameraPosition);
    const dir = normalize(D).toVar();
    const e = dir.y;
    const sunG = pow(max(dot(dir, EXT_U.sunDir), 0), 5);
    const horizon = EXT_U.haze.mul(1.25).add(EXT_U.sun.mul(sunG.mul(1.4)));
    const sky = mix(horizon, EXT_U.zenith, smoothstep(0.0, 0.55, e)).toVar();
    const below = mix(horizon, EXT_U.ground.add(EXT_U.haze.mul(0.6)), smoothstep(0.0, -0.25, e));
    // overcast streaks (cheap)
    const cl = float(hash(floor(atan(dir.x, dir.z).mul(18)).add(floor(e.mul(40)).mul(31)))).mul(0.18).add(0.91);
    const up = mix(below, sky.mul(cl), smoothstep(-0.01, 0.01, e));
    const sk = EXT_U.skyline;
    const az = atan(dir.x, dir.z).div(Math.PI * 2).add(0.5);
    const uu = az.mul(sk.x).add(sk.y);
    const m2 = fract(uu.mul(0.5)).mul(2);
    const u: AnyNode = select((m2 as AnyNode).lessThan(1), m2, float(2).sub(m2 as AnyNode));
    const v: AnyNode = e.sub(sk.z).div(sk.w.sub(sk.z));
    const pano = skylineNode.sample(vec2(u, clamp(v, 0.002, 0.998))).rgb.mul(EXT_U.skyGain);
    const band = smoothstep(-0.02, 0.04, v).mul(float(1).sub(smoothstep(0.78, 1.0, v)));
    const col = mix(up, pano, band);
    return vec3(exteriorFog(col));
  })(), THREE.BackSide);
}

let skylineFallback: THREE.Texture | null = null;
/** Procedural skyline panorama (2048 x 512): ruined silhouettes, smoke columns, a few fires, dusk haze. */
export function skylineFallbackTexture(): THREE.Texture {
  return (skylineFallback ??= (() => {
    const t = canvasTexture(1024, 256, 90731, (ctx, w, h, rnd) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2a2c31'); g.addColorStop(0.55, '#57493f'); g.addColorStop(1, '#3b332d');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // smoke columns behind the buildings
      for (let i = 0; i < 7; i++) {
        let x = rnd() * w; const base = h * (0.62 + rnd() * 0.1);
        for (let y = base; y > h * 0.02; y -= 6) {
          x += (rnd() - 0.35) * 3;
          const r = 6 + (base - y) * 0.16;
          ctx.fillStyle = `rgba(22, 20, 19, ${0.08 + rnd() * 0.06})`;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
      }
      // two silhouette layers (far lighter, near darker), jagged ruined tops
      for (const [shade, minH, maxH] of [[64, 0.12, 0.38], [34, 0.08, 0.3]] as const) {
        let x = 0;
        while (x < w) {
          const bw = 8 + rnd() * 34, top = h * (0.92 - (minH + rnd() * (maxH - minH)));
          ctx.fillStyle = `rgb(${shade}, ${shade - 3}, ${shade - 6})`;
          ctx.beginPath(); ctx.moveTo(x, h);
          ctx.lineTo(x, top);
          const steps = 2 + Math.floor(rnd() * 4);
          for (let s = 1; s <= steps; s++) ctx.lineTo(x + bw * s / steps, top + (rnd() - 0.3) * h * 0.06 * (rnd() < 0.4 ? 3 : 1));
          ctx.lineTo(x + bw, h); ctx.closePath(); ctx.fill();
          if (rnd() < 0.12) { ctx.fillStyle = 'rgba(255, 120, 40, 0.5)'; ctx.fillRect(x + bw * 0.3, h * 0.86, bw * 0.3, 3); }
          x += bw * (0.8 + rnd() * 0.5);
        }
      }
      ctx.fillStyle = '#211e1b'; ctx.fillRect(0, h * 0.92, w, h * 0.08);
    });
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  })());
}

/** Use ASSETS' T5 panorama (also when it arrives late): a texture node value change, no rebuild. */
export function setSkylineTexture(t: THREE.Texture | null): void {
  skylineWanted = t;
  if (skylineNode) skylineNode.value = t ?? skylineFallbackTexture();
}

// ---------------------------------------------------------------------------------------------
// Geometry

function colored(g: THREE.BufferGeometry, rgb: [number, number, number], jitter: number, seed: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  const n = ng.attributes.position.count, c = new Float32Array(n * 3), r = mulberry32(seed);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (r() - 0.5) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) { c[(i + j) * 3] = rgb[0] * k; c[(i + j) * 3 + 1] = rgb[1] * k; c[(i + j) * 3 + 2] = rgb[2] * k; }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
  ng.deleteAttribute('uv');
  return ng;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g;
}

/** Procedural stand-ins (used when ASSETS' C1 / C5 / C2 models are not delivered). Grounded, front -Z. */
export function fallbackPropGeometry(kind: PropKind): THREE.BufferGeometry {
  const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
    const all = parts.map(p => (p.index ? p.toNonIndexed() : p));
    const pos: number[] = [], nor: number[] = [], col: number[] = [];
    for (const p of all) { pos.push(...(p.attributes.position.array as Float32Array)); nor.push(...(p.attributes.normal.array as Float32Array)); col.push(...(p.attributes.color.array as Float32Array)); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    for (const p of all) p.dispose();
    return g;
  };
  if (kind === 'car') {
    return merge([
      colored(box(1.76, 0.62, 4.3, 0, 0.47, 0), [0.2, 0.13, 0.09], 0.5, 11),
      colored(box(1.56, 0.5, 2.1, 0, 1.03, 0.25), [0.13, 0.1, 0.08], 0.4, 12),
      colored(box(1.8, 0.16, 4.36, 0, 0.12, 0), [0.05, 0.045, 0.04], 0.2, 13),
    ]);
  }
  if (kind === 'bus') {
    return merge([
      colored(box(2.5, 2.3, 11.8, 0, 1.45, 0), [0.22, 0.16, 0.1], 0.45, 21),
      colored(box(2.54, 0.75, 10.9, 0, 2.05, 0.2), [0.03, 0.03, 0.032], 0.2, 22),
      colored(box(2.52, 0.3, 11.84, 0, 0.15, 0), [0.05, 0.045, 0.04], 0.2, 23),
    ]);
  }
  // rubble: a flattened, displaced icosahedron mound (~4.5 m across)
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const p = ico.attributes.position, rnd = mulberry32(31);
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let s = seen.get(k);
    if (s === undefined) seen.set(k, (s = 0.7 + rnd() * 0.6));
    p.setXYZ(i, p.getX(i) * 2.3 * s, Math.max(0, p.getY(i) * s) * 1.25, p.getZ(i) * 2.3 * s);
  }
  ico.computeVertexNormals();
  return merge([colored(ico, [0.22, 0.2, 0.18], 0.6, 32)]);
}

/** Model parts of a GLTF (geometry + material + transform relative to the gltf scene), for instancing. */
export function modelParts(gltf: GLTF): {geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4}[] {
  const out: {geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4}[] = [];
  gltf.scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(gltf.scene.matrixWorld).invert();
  gltf.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes.position) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    out.push({geometry: m.geometry, material: mat, matrix: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)});
  });
  return out;
}

export interface ExteriorModels {
  car?: GLTF | null; bus?: GLTF | null; rubble?: GLTF | null; tower?: GLTF | null; midrise?: GLTF | null;
}

export interface ExteriorView {
  root: THREE.Group;
  /** The sky dome (follows the eye). */
  dome: THREE.Mesh;
  /** Per-section geometries (shared GLB geometries are NOT listed). */
  geometries: THREE.BufferGeometry[];
  instanced: THREE.InstancedMesh[];
  /** Which hero layers used Meshy models (else procedural fallbacks). */
  used: {props: boolean; heroes: boolean};
  tris: number;
}

const QUADS = 4;
const quadOf = (plan: ExteriorPlan, x: number, z: number): number => {
  const a = Math.atan2(z - plan.center.z, x - plan.center.x);
  return ((Math.floor(((a + Math.PI) / (Math.PI * 2)) * QUADS) % QUADS) + QUADS) % QUADS;
};

const triCount = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Builds the exterior for a plan. `models`: delivered Meshy GLTFs (null / missing -> procedural). */
export function buildExterior(plan: ExteriorPlan, models: ExteriorModels = {}): ExteriorView {
  const root = new THREE.Group(); root.name = 'tower-exterior';
  const geometries: THREE.BufferGeometry[] = [], instanced: THREE.InstancedMesh[] = [];
  let tris = 0;
  const gy = plan.groundY;
  EXT_U.groundY.value = gy;
  // --- ground (footprint cut out: the lobby floor is at street level) ---
  const H = plan.half, c = plan.center, f = plan.foot;
  const quads: [number, number, number, number][] = [
    [c.x - H, c.z - H, c.x + H, f.z0], [c.x - H, f.z1, c.x + H, c.z + H], [c.x - H, f.z0, f.x0, f.z1], [f.x1, f.z0, c.x + H, f.z1],
  ];
  const pos: number[] = [];
  for (const [x0, z0, x1, z1] of quads) {
    if (x1 <= x0 || z1 <= z0) continue;
    pos.push(x0, gy, z0, x0, gy, z1, x1, gy, z1, x0, gy, z0, x1, gy, z1, x1, gy, z0);
  }
  const ground = new THREE.BufferGeometry();
  ground.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ground.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometries.push(ground);
  const gtex = groundTexture(plan);
  const gmat = groundMaterial(gtex);
  groundMapNode.value = gtex;
  groundXform.value.set(c.x - H, c.z - H, 1 / (2 * H), 1 / (2 * H));
  const gm = new THREE.Mesh(ground, gmat); gm.name = 'tower-ext-ground'; root.add(gm);
  tris += triCount(ground);
  // --- instancing helper (per quadrant) ---
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const placeMatrix = (x: number, y: number, z: number, yaw: number, s: [number, number, number]) => m4.compose(tv.set(x, y, z), q.setFromAxisAngle(up, yaw), sv.set(...s));
  const addInstanced = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, mats: THREE.Matrix4[], own: boolean): void => {
    if (!mats.length) return;
    const im = new THREE.InstancedMesh(geometry, material, mats.length);
    im.name = name;
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = im.receiveShadow = false;
    if (own) geometries.push(geometry);
    instanced.push(im);
    root.add(im);
    tris += triCount(geometry) * mats.length;
  };
  const byQuad = <T extends {x: number; z: number}>(list: T[]): T[][] => {
    const out: T[][] = Array.from({length: QUADS}, () => []);
    for (const it of list) out[quadOf(plan, it.x, it.z)].push(it);
    return out;
  };
  // --- street props ---
  const usedProps = !!(models.car || models.bus || models.rubble);
  for (const kind of ['car', 'bus', 'rubble'] as const) {
    const list = plan.props.filter(p => p.kind === kind);
    if (!list.length) continue;
    const gltf = models[kind];
    const quadsList = byQuad(list);
    if (gltf) {
      for (const part of modelParts(gltf)) {
        const mat = modelMaterial(part.material);
        // ASSETS' vehicles are long along X (nose +X); the plan's yaw is for a Z-long body like the stand-ins
        const turn = kind === 'rubble' ? 0 : -Math.PI / 2;
        quadsList.forEach((ql, qi) => addInstanced(`tower-ext-${kind}-${qi}`, part.geometry, mat,
          ql.map(p => placeMatrix(p.x, gy, p.z, p.yaw + turn, [p.scale, p.scale, p.scale]).clone().multiply(part.matrix)), false));
      }
    } else {
      const g = fallbackPropGeometry(kind);
      // one geometry shared by the quadrant meshes (disposed once)
      geometries.push(g);
      quadsList.forEach((ql, qi) => addInstanced(`tower-ext-${kind}-${qi}`, g, propMaterial(),
        ql.map(p => placeMatrix(p.x, gy, p.z, p.yaw, [p.scale, p.scale * (kind === 'rubble' ? 0.8 : 1), p.scale]).clone()), false));
    }
  }
  // --- buildings ---
  const heroesAvail = {tower: models.tower ?? null, midrise: models.midrise ?? null};
  const usedHeroes = !!(heroesAvail.tower || heroesAvail.midrise);
  const blockMats: THREE.Matrix4[] = [];
  const mounds: THREE.Matrix4[] = [];
  const rr = mulberry32((plan.buildings.length * 977 + Math.floor(plan.center.x * 13)) >>> 0);
  const heroLists: Record<'tower' | 'midrise', BuildingPlace[]> = {tower: [], midrise: []};
  for (const b of plan.buildings) {
    if ((b.kind === 'tower' || b.kind === 'midrise') && heroesAvail[b.kind]) { heroLists[b.kind].push(b); continue; }
    const r = mulberry32(b.seed);
    if (b.kind === 'collapsed') {
      // stump + rubble mound + a fallen slab
      blockMats.push(placeMatrix(b.x, gy, b.z, b.yaw, [b.w * 0.7, b.h, b.d * 0.6]).clone());
      mounds.push(placeMatrix(b.x + (r() - 0.5) * b.w * 0.4, gy, b.z + (r() - 0.5) * b.d * 0.4, r() * 6.28, [b.w * 0.24, 1.6 + r() * 1.8, b.d * 0.24]).clone());
      const slab = new THREE.Matrix4().compose(tv.set(b.x + (r() - 0.5) * b.w * 0.5, gy + b.h * 0.6, b.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 + r() * 0.5, b.yaw, 0.2 * (r() - 0.5))), sv.set(b.w * 0.8, 0.35, b.d * 0.5));
      blockMats.push(slab.clone());
      continue;
    }
    const h = b.kind === 'tower' ? 34 + r() * 30 : b.kind === 'midrise' ? 18 + r() * 14 : b.h;
    // main mass up to the broken line, then 2-4 jagged remnants on top (stepped, ruined silhouette)
    const broken = h * (0.72 + r() * 0.2);
    blockMats.push(placeMatrix(b.x, gy, b.z, b.yaw, [b.w, broken, b.d]).clone());
    const rem = 2 + Math.floor(r() * 3);
    const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
    for (let k = 0; k < rem; k++) {
      const lx = (r() - 0.5) * b.w * 0.6, lz = (r() - 0.5) * b.d * 0.6;
      const w = b.w * (0.2 + r() * 0.35), d = b.d * (0.2 + r() * 0.35), hh = (h - broken) * (0.4 + r() * 1.0);
      blockMats.push(placeMatrix(b.x + lx * cy + lz * sy, gy + broken, b.z - lx * sy + lz * cy, b.yaw, [w, hh, d]).clone());
    }
    // an exposed floor slab sticking out on some
    if (r() < 0.35) blockMats.push(placeMatrix(b.x, gy + broken - 3.4 * (1 + Math.floor(r() * 3)), b.z, b.yaw + (r() < 0.5 ? 0 : Math.PI / 2), [b.w * 1.12, 0.32, b.d * 0.9]).clone());
    if (rr() < 0.2) mounds.push(placeMatrix(b.x + b.w * 0.6, gy, b.z + (rr() - 0.5) * b.d, rr() * 6.28, [2 + rr() * 2, 0.8 + rr(), 2 + rr() * 2]).clone());
  }
  // hero Meshy buildings (instanced per quadrant)
  for (const kind of ['tower', 'midrise'] as const) {
    const gltf = heroesAvail[kind];
    if (!gltf || !heroLists[kind].length) continue;
    const ql = byQuad(heroLists[kind]);
    for (const part of modelParts(gltf)) {
      const mat = modelMaterial(part.material);
      ql.forEach((list, qi) => addInstanced(`tower-ext-${kind}-${qi}`, part.geometry, mat,
        list.map(b => { const f = heroFit(kind, b); return placeMatrix(b.x, gy, b.z, b.yaw + f.turn, [f.scale, f.scale, f.scale]).clone().multiply(part.matrix); }), false));
    }
  }
  const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0); unit.deleteAttribute('uv');
  geometries.push(unit);
  const blocksByQuad = byQuad(blockMats.map(m => ({m, x: m.elements[12], z: m.elements[14]})));
  blocksByQuad.forEach((list, qi) => addInstanced(`tower-ext-blocks-${qi}`, unit, blockMaterial(), list.map(e => e.m), false));
  if (mounds.length) {
    const mg = fallbackPropGeometry('rubble');
    geometries.push(mg);
    // mound scale: the stand-in is ~4.6 m across, 1.25 m high -> normalise
    addInstanced('tower-ext-mounds', mg, propMaterial(), mounds.map(m => m.clone().multiply(new THREE.Matrix4().makeScale(1 / 2.3, 1 / 1.25, 1 / 2.3))), false);
  }
  // --- sky dome + skyline (follows the eye; drawn behind everything) ---
  const domeGeo = new THREE.SphereGeometry(EXTERIOR.dome, 48, 24);
  domeGeo.deleteAttribute('uv');
  geometries.push(domeGeo);
  EXT_U.skyline.value.set(plan.skyline.wraps, plan.skyline.offset, plan.skyline.e0, plan.skyline.e1);
  const dome = new THREE.Mesh(domeGeo, skyMaterial());
  dome.name = 'tower-ext-sky';
  dome.frustumCulled = false;
  // drawn after every other opaque (the interior is 0, the city 5): early-z rejects the dome / city behind walls
  dome.renderOrder = 10;
  dome.position.set(c.x, gy, c.z);
  root.add(dome);
  tris += triCount(domeGeo);
  root.traverse(o => { o.castShadow = false; o.receiveShadow = false; if (o !== dome) o.renderOrder = 5; });
  return {root, dome, geometries, instanced, used: {props: usedProps, heroes: usedHeroes}, tris};
}

/** The skyline band's horizon dip follows the eye's height above the street (uniform only; per frame while riding). */
export function setExteriorEye(eyeAbove: number): void {
  EXT_U.skyline.value.z = -0.035 - Math.min(0.06, Math.max(0, eyeAbove) / 600);
}

/** Footprint uniform (the station fog applies inside it). */
export function setExteriorFootprint(r: Rect2 | null): void {
  if (r) EXT_U.box.value.set(r.x0, r.z0, r.x1, r.z1);
  else EXT_U.box.value.set(-1e5, -1e5, 1e5, 1e5);
}

export type {N as ExteriorFloatNode};
