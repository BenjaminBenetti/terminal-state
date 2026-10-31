// Task mall-playtest-revision-20261031 (lane ARCH, U02: "Toxic gas just like the office building should be visible outside the mall
// through the atrium roof."). The Office's exterior atmosphere — world/exterior.ts: the infectious green murk, its EXT_U uniforms
// (haze = the Office's fog colour EXT_FOG.color, weak sickly sun, skyline ghost, wind drift EXT_U.fogDrift) and its fog density
// (EXT_FOG base / ground / height / range: exteriorFogOpacity) — REUSED as the mall's exterior, seen only through the atrium glazing:
//  - the sky over the roof: the Office's murk colour itself (hue ~93 deg, the same uniform), a little MORE saturated (MALL_SKY.sat) and
//    kept DARK overhead (MALL_SKY.zenith: no pale overcast washing out through the glass), slow billows with real contrast, a faint
//    sickly sun glow and the Office's ghost of the ruined skyline at the horizon;
//  - drifting GAS with depth: five sheets over the vault apex at different heights (parallax as the eye moves), a low layer lying on
//    the roof round the vault and a curtain beyond the roof edge — world noise moving with the Office fog's wind; lit rims a bright
//    sickly yellow-green, dense cores dark green (visible against the sky both ways); the curtain's opacity is the Office fog's own
//    opacity over its distance from the roof (exteriorFogOpacity). Render order: after the opaque world (depth-tested: the roof deck,
//    slabs, ceilings and walls hide it) and BEFORE every glass (renderOrder below the glass), never inside the building.
// Browser check at a8317a4 (primary): the old exterior read as a pale grey-white overcast (gain 3.4 on a grey zenith, gas tinted
// exactly like the sky = invisible, a milky glass film, the interior haze marched past the glass) — all four addressed (the glass
// film / depth: world/mallArch.ts roofGlass; the skylight tint: world/mallSkylight.ts SKY.tint).
// Strictly visual: no gas field, exposure, damage, cough or mask rule (world/gas/* is untouched; inert in the mall).

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {Fn, atan, cameraPosition, clamp, dot, float, floor, fract, hash, length, max, mix, normalize, positionWorld, pow, select, smoothstep, texture, time, uniform, vec2, vec3} from 'three/tsl';
import {EXT_FOG, EXT_U, exteriorFogOpacity, skylineFallbackTexture} from './exterior';
import {wmNoise} from './surfaceNodes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/**
 * Mall exterior defaults (gains multiply the Office murk colour EXT_FOG.color in linear light): horizon / zenith of the sky, the
 * saturation boost (1 = the Office colour as is), gas rims / cores, gas opacity. The curtain's opacity is derived per build from the
 * Office fog density (exteriorFogOpacity at the curtain's distance).
 */
export const MALL_SKY = {horizon: 1.15, zenith: 1.6, sat: 1.35, gasLit: 2.6, gasCore: 0.85, gas: 0.62, curtain: 0.7} as const;

/** Mall exterior uniforms (QA tunable through mallSkyTune; the roof centre / reach / curtain set per build). */
export const MALL_SKY_U = {
  zenith: uniform(MALL_SKY.zenith),
  horizon: uniform(MALL_SKY.horizon),
  sat: uniform(MALL_SKY.sat),
  gasLit: uniform(MALL_SKY.gasLit),
  gasCore: uniform(MALL_SKY.gasCore),
  gas: uniform(MALL_SKY.gas),
  curtain: uniform(MALL_SKY.curtain),
  /** Roof centre (x, z) and the gas sheets' fade-out radius (m). */
  centre: uniform(new THREE.Vector2(0, 0)),
  reach: uniform(60),
  /** Curtain base / height (absolute y, m). */
  curtainY: uniform(new THREE.Vector2(0, 30)),
};

/** Render orders: sky (opaque list, first), curtain / gas (transparent list, before every glass at 0). */
export const MALL_EXT_ORDER = {sky: -5, curtain: -4, gas: -3} as const;

/** The Office murk colour (EXT_U.haze), saturation-boosted around its luminance (the hue stays the Office's). */
export const hazeSat = (): AnyNode => {
  const h = EXT_U.haze as AnyNode;
  const l = dot(h, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l, l, l), h, MALL_SKY_U.sat);
};

/** Overhead gain of the murk: horizon -> zenith. */
const gainAt = (e: AnyNode): AnyNode => mix(MALL_SKY_U.horizon, MALL_SKY_U.zenith, smoothstep(0.0, 0.85, e));

/** A weak sickly sun glow through the murk (the Office's EXT_U.sun / sunDir). */
const sunGlow = (dir: AnyNode): AnyNode => EXT_U.sun.mul(pow(max(dot(dir, EXT_U.sunDir), 0), 6).mul(0.8));

let skyMat: MeshBasicNodeMaterial | null = null;
/**
 * The mall's sky dome (BackSide, unlit, never fogged, depth-write off, drawn first): the Office murk colour (saturated), dark
 * overhead, billows with contrast, the sun glow and the Office's skyline ghost band. Direction from the eye (the horizon stays at eye
 * level).
 */
export function mallSkyMaterial(): MeshBasicNodeMaterial {
  if (skyMat) return skyMat;
  const m = new MeshBasicNodeMaterial({side: THREE.BackSide, fog: false, depthWrite: false});
  m.name = 'mall-sky';
  const sky = texture(skylineFallbackTexture());
  m.colorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
    const e = dir.y;
    const base = hazeSat().toVar();
    const az = atan(dir.x, dir.z).div(Math.PI * 2).add(0.5);
    // slow billows (two octaves) and streaks: +-18 % structure in the murk overhead
    const billow = wmNoise((vec3 as AnyNode)(az.mul(14).add(time.mul(0.006)), e.mul(7), time.mul(0.01))) as AnyNode;
    const billow2 = wmNoise((vec3 as AnyNode)(az.mul(37).sub(time.mul(0.011)), e.mul(19), time.mul(0.017).add(4.1))) as AnyNode;
    const streak = float(hash(floor(az.mul(110)).add(floor(e.mul(40)).mul(31)))).mul(0.05).add(0.975);
    const over = base.mul(gainAt(e)).mul(billow.mul(0.26).add(billow2.mul(0.1)).add(0.82)).mul(streak);
    // below the horizon a little darker (looking down into the street murk), as the Office's fogColorAt
    const col = mix(base.mul(MALL_SKY_U.horizon).mul(0.82), over, smoothstep(-0.25, 0.06, e)).add(sunGlow(dir)).toVar();
    // the skyline panorama barely ghosts through the horizon murk (the Office's skyline band)
    const sk = EXT_U.skyline;
    const uu = az.mul(sk.x).add(sk.y);
    const m2 = fract(uu.mul(0.5)).mul(2);
    const u: AnyNode = select((m2 as AnyNode).lessThan(1), m2, float(2).sub(m2 as AnyNode));
    const v: AnyNode = e.sub(sk.z).div(sk.w.sub(sk.z));
    const pano = (sky as AnyNode).sample(vec2(u, clamp(v, 0.002, 0.998))).rgb;
    const ghost = base.mul(MALL_SKY_U.horizon).mul(dot(pano, vec3(0.2126, 0.7152, 0.0722)).mul(3.2).add(0.55));
    const band = smoothstep(-0.02, 0.06, v).mul(float(1).sub(smoothstep(0.55, 0.9, v))).mul(clamp(EXT_U.skyGain, 0, 1));
    return vec3(mix(col, ghost, band));
  })();
  return (skyMat = m);
}

/** Drifting murk density at a world point (0..1): two octaves of world noise moving with the Office fog's wind. */
const gasDensity = (p: AnyNode, scale: number): AnyNode => {
  const drift = time.mul(EXT_U.fogDrift);
  const q = (vec3 as AnyNode)(p.x.add(drift).div(scale), p.y.div(scale * 0.4), p.z.sub(drift.mul(0.55)).div(scale));
  const n1 = wmNoise(q) as AnyNode;
  const n2 = wmNoise(q.mul(2.37).add(vec3(5.1, 1.7, 3.3)).add((vec3 as AnyNode)(time.mul(0.021), 0, time.mul(-0.013)))) as AnyNode;
  return smoothstep(0.28, 0.8, n1.mul(0.64).add(n2.mul(0.36)));
};

/** Gas colour from its density: bright sickly rims (lit thin edges) and dark dense cores, both the Office hue. */
const gasColour = (dir: AnyNode, dens: AnyNode): AnyNode => {
  const rim = smoothstep(0.04, 0.4, dens).mul(float(1).sub(smoothstep(0.5, 0.95, dens)));
  const lit = hazeSat().mul(MALL_SKY_U.gasLit).add(EXT_U.sun.mul(0.5)), core = hazeSat().mul(MALL_SKY_U.gasCore);
  return mix(core, lit, clamp(rim.mul(0.85).add(float(1).sub(dens).mul(0.15)), 0, 1)).add(sunGlow(dir).mul(0.5));
};

let gasMat: MeshBasicNodeMaterial | null = null;
/** Gas sheets / the low roof layer: translucent murk with lit rims and dark cores, fading out toward MALL_SKY_U.reach. */
export function mallGasMaterial(): MeshBasicNodeMaterial {
  if (gasMat) return gasMat;
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false});
  m.name = 'mall-exterior-gas';
  const dir = normalize(positionWorld.sub(cameraPosition) as AnyNode) as AnyNode;
  const dens = gasDensity(positionWorld, 13);
  const r = length(positionWorld.xz.sub(MALL_SKY_U.centre) as AnyNode) as AnyNode;
  const edge = float(1).sub(smoothstep(MALL_SKY_U.reach.mul(0.6), MALL_SKY_U.reach, r));
  m.colorNode = gasColour(dir, dens);
  m.opacityNode = clamp(dens.mul(edge).mul(MALL_SKY_U.gas), 0, 0.9);
  return (gasMat = m);
}

let curtainMat: MeshBasicNodeMaterial | null = null;
/** Gas curtain round the roof edge (seen from inside, BackSide): the Office fog's opacity at its distance, thinning upward. */
export function mallGasCurtainMaterial(): MeshBasicNodeMaterial {
  if (curtainMat) return curtainMat;
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.BackSide, fog: false});
  m.name = 'mall-exterior-gas-curtain';
  const dir = normalize(positionWorld.sub(cameraPosition) as AnyNode) as AnyNode;
  const dens = gasDensity(positionWorld, 10);
  const h = positionWorld.y.sub(MALL_SKY_U.curtainY.x).div(max(MALL_SKY_U.curtainY.y, 1));
  const fall = float(1).sub(smoothstep(0.2, 1, h as AnyNode));
  m.colorNode = gasColour(dir, dens.mul(0.7).add(0.15));
  // the Office patch variation (EXT_FOG.noise) around its opacity at this distance
  m.opacityNode = clamp(MALL_SKY_U.curtain.mul(float(1).add(dens.sub(0.5).mul(2 * EXT_FOG.noise))).mul(fall), 0, 0.9);
  return (curtainMat = m);
}

/** Where the exterior gas goes (world metres): the roof's glazed footprint and its vault, the deck level, the vault apex. */
export interface MallExteriorSpec {
  /** Bounds of the glazed roof (the top atrium opening). */
  roof: {x0: number; z0: number; x1: number; z1: number};
  /** Footprint of the vault (the glass rising above the springing line), or null (no vault: flat glazing only). */
  vault: {x0: number; z0: number; x1: number; z1: number} | null;
  /** Roof deck y (the building's top), springing line y, vault apex y. */
  deckY: number; springY: number; apexY: number;
}

export interface MallExteriorStats { layers: number; triangles: number; minY: number; curtainOpacity: number }

/** Gas sheet heights above the vault apex (m): five layers for parallax, the nearest first in this list. */
export const GAS_SHEETS = [1.6, 4.2, 7.5, 12, 19] as const;

/**
 * The exterior gas meshes (+ fills MALL_SKY_U.centre / reach / curtainY / curtain): one merged 'mall-exterior-gas' mesh (the sheets
 * top-down, then the low layer round the vault: back-to-front for an eye below) and one 'mall-exterior-gas-curtain'. Never below
 * the deck, never inside the vault footprint below its apex.
 */
export function buildMallExteriorGas(spec: MallExteriorSpec): {meshes: THREE.Mesh[]; stats: MallExteriorStats} {
  const {roof, vault} = spec;
  const cx = (roof.x0 + roof.x1) / 2, cz = (roof.z0 + roof.z1) / 2;
  const half = Math.hypot(roof.x1 - roof.x0, roof.z1 - roof.z0) / 2;
  const margin = Math.max(24, half);
  const reach = half + margin;
  MALL_SKY_U.centre.value.set(cx, cz);
  MALL_SKY_U.reach.value = reach;
  const pos: number[] = [], idx: number[] = [];
  const quad = (x0: number, z0: number, x1: number, z1: number, y: number) => {
    if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3) return;
    const b = pos.length / 3;
    pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  };
  const X0 = cx - reach, X1 = cx + reach, Z0 = cz - reach, Z1 = cz + reach;
  const top = Math.max(spec.apexY, spec.springY);
  let layers = 0;
  for (const dy of [...GAS_SHEETS].reverse()) { quad(X0, Z0, X1, Z1, top + dy); layers++; }
  // the low layer lying on the roof (above the deck / the flat glazing), round the vault's footprint
  const low = Math.max(spec.springY, spec.deckY) + 0.7;
  if (vault && low < top - 0.05) {
    const v = {x0: vault.x0 - 0.4, z0: vault.z0 - 0.4, x1: vault.x1 + 0.4, z1: vault.z1 + 0.4};
    quad(X0, Z0, X1, v.z0, low);
    quad(X0, v.z1, X1, Z1, low);
    quad(X0, v.z0, v.x0, v.z1, low);
    quad(v.x1, v.z0, X1, v.z1, low);
    layers++;
  } else if (!vault) { quad(X0, Z0, X1, Z1, low); layers++; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const sheets = new THREE.Mesh(g, mallGasMaterial());
  sheets.name = 'mall-exterior-gas';
  sheets.renderOrder = MALL_EXT_ORDER.gas;
  // the curtain: an open cylinder round the roof (outside its footprint), from the deck up past the sheets; its opacity = the Office
  // fog's opacity over its distance from the roof centre at roof height (world/exterior.ts exteriorFogOpacity, EXT_FOG density)
  const rC = half + 6, yC0 = spec.deckY, hC = top + 14 - yC0;
  MALL_SKY_U.curtainY.value.set(yC0, hC);
  const curtainOpacity = Math.min(0.9, exteriorFogOpacity(rC, 12, 12));
  MALL_SKY_U.curtain.value = curtainOpacity;
  const cg = new THREE.CylinderGeometry(rC, rC, hC, 32, 1, true);
  cg.translate(cx, yC0 + hC / 2, cz);
  cg.computeBoundingSphere();
  const curtain = new THREE.Mesh(cg, mallGasCurtainMaterial());
  curtain.name = 'mall-exterior-gas-curtain';
  curtain.renderOrder = MALL_EXT_ORDER.curtain;
  for (const m of [sheets, curtain]) { m.matrixAutoUpdate = false; m.updateMatrix(); }
  const tris = idx.length / 3 + (cg.index ? cg.index.count / 3 : 0);
  return {meshes: [sheets, curtain], stats: {layers, triangles: tris, minY: Math.min(low, yC0), curtainOpacity}};
}

// ---------------------------------------------------------------------------------------------------------------------------
// CPU mirror of the palette (tests / QA): linear RGB of the sky at the horizon / zenith and the gas rims / cores, from the Office's
// EXT_FOG.color and the MALL_SKY gains (the shaders read the same values through EXT_U.haze / MALL_SKY_U).

type RGB = [number, number, number];
const lumOf = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** The Office murk colour saturation-boosted (CPU mirror of hazeSat). */
export function hazeSatCpu(haze: RGB = [...EXT_FOG.color] as RGB, sat: number = MALL_SKY.sat): RGB {
  const l = lumOf(haze);
  return haze.map(v => l + (v - l) * sat) as RGB;
}
/** Linear RGB palette of the mall exterior (defaults). */
export function mallSkyPalette(p: {horizon?: number; zenith?: number; sat?: number; gasLit?: number; gasCore?: number} = {}): {horizon: RGB; zenith: RGB; gasLit: RGB; gasCore: RGB} {
  const b = hazeSatCpu([...EXT_FOG.color] as RGB, p.sat ?? MALL_SKY.sat);
  const k = (g: number): RGB => b.map(v => v * g) as RGB;
  return {horizon: k(p.horizon ?? MALL_SKY.horizon), zenith: k(p.zenith ?? MALL_SKY.zenith), gasLit: k(p.gasLit ?? MALL_SKY.gasLit), gasCore: k(p.gasCore ?? MALL_SKY.gasCore)};
}

export interface MallSkyTune { zenith?: number; horizon?: number; sat?: number; gasLit?: number; gasCore?: number; gas?: number; curtain?: number }
/** QA: tune the mall exterior (uniform values only); returns the current values. */
export function mallSkyTune(o: MallSkyTune = {}): Required<MallSkyTune> {
  for (const k of ['zenith', 'horizon', 'sat', 'gasLit', 'gasCore', 'gas', 'curtain'] as const) if (typeof o[k] === 'number') MALL_SKY_U[k].value = o[k]!;
  return {zenith: MALL_SKY_U.zenith.value, horizon: MALL_SKY_U.horizon.value, sat: MALL_SKY_U.sat.value, gasLit: MALL_SKY_U.gasLit.value,
    gasCore: MALL_SKY_U.gasCore.value, gas: MALL_SKY_U.gas.value, curtain: MALL_SKY_U.curtain.value};
}
