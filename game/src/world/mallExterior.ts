// Task mall-playtest-revision-20261031 (lane ARCH, U02: "Toxic gas just like the office building should be visible outside the mall
// through the atrium roof."). The Office's exterior atmosphere — world/exterior.ts: the infectious green murk, its EXT_U uniforms
// (haze = fog colour, zenith, weak sickly sun, skyline ghost, wind drift) — REUSED as the mall's exterior, seen only through the
// atrium glazing:
//  - the sky dome over the roof: the Office sky's own recipe (murk at / below the horizon, an overcast of slow billows above, faint
//    ghost of the ruined skyline panorama), brightened overhead (MALL_SKY_U.zenith: daylight diffusing through the gas) — the same
//    hue and uniforms, so exteriorFogTune recolours both levels;
//  - drifting GAS above / around the glass: a low layer lying on the roof deck round the vault, three sheets over the vault apex and a
//    curtain round the roof edge; world-space noise moving with the Office fog's wind (EXT_U.fogDrift), murk-coloured, translucent.
//    Render order: drawn after the opaque world (depth-tested: the roof deck, slabs, shop ceilings and walls hide it) and BEFORE the
//    glazing (renderOrder below every glass: the roof / clerestory / balustrade glass composites over it). Nothing of it lies inside
//    the building: the sheets are above the vault apex, the low layer outside the vault footprint and above the deck, the curtain
//    outside the roof's footprint — it reads ONLY through the glass, never as fog pasted inside shops.
// Strictly visual: no gas field, exposure, damage, cough or mask rule (world/gas/* is untouched; it is inert in the mall: no office
// windows, no roof storey).

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {Fn, atan, cameraPosition, clamp, dot, float, floor, fract, hash, length, max, mix, normalize, positionWorld, pow, select, smoothstep, texture, time, uniform, vec2, vec3} from 'three/tsl';
import {EXT_U, skylineFallbackTexture} from './exterior';
import {wmNoise} from './surfaceNodes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/** Mall exterior defaults: overhead / horizon gain of the murk (daylight through the gas), gas opacity, roof centre / reach. */
export const MALL_SKY = {zenith: 3.4, horizon: 1.7, gas: 0.5, curtain: 0.42} as const;

/** Mall exterior uniforms (QA tunable through mallSkyTune; the roof centre / reach set per build). */
export const MALL_SKY_U = {
  zenith: uniform(MALL_SKY.zenith),
  horizon: uniform(MALL_SKY.horizon),
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

/** The Office murk's colour along a view direction (exterior.ts fogColorAt: darker looking down, a weak glow toward the sun). */
const murkAt = (dir: AnyNode): AnyNode =>
  EXT_U.haze.mul(mix(0.82, 1.06, smoothstep(-0.25, 0.08, dir.y))).add(EXT_U.sun.mul(pow(max(dot(dir, EXT_U.sunDir), 0), 6).mul(0.8)));

/** Overhead gain of the murk (daylight diffusing through the gas): horizon -> zenith. */
const gainAt = (e: AnyNode): AnyNode => mix(MALL_SKY_U.horizon, MALL_SKY_U.zenith, smoothstep(0.0, 0.85, e));

let skyMat: MeshBasicNodeMaterial | null = null;
/**
 * The mall's sky dome (BackSide, unlit, never fogged, depth-write off, drawn first): the Office sky recipe (exterior.ts skyMaterial)
 * without its tower-interior fog part, with the overhead gain. Direction from the eye (the horizon stays at eye level).
 */
export function mallSkyMaterial(): MeshBasicNodeMaterial {
  if (skyMat) return skyMat;
  const m = new MeshBasicNodeMaterial({side: THREE.BackSide, fog: false, depthWrite: false});
  m.name = 'mall-sky';
  const sky = texture(skylineFallbackTexture());
  m.colorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
    const e = dir.y;
    const murk = murkAt(dir).toVar();
    const az = atan(dir.x, dir.z).div(Math.PI * 2).add(0.5);
    const billow = wmNoise((vec3 as AnyNode)(az.mul(14).add(time.mul(0.006)), e.mul(7), time.mul(0.01))) as AnyNode;
    const streak = float(hash(floor(az.mul(110)).add(floor(e.mul(40)).mul(31)))).mul(0.06).add(0.97);
    const over = mix(murk, EXT_U.zenith.mul(1.25), smoothstep(0.03, 0.75, e)).mul(billow.mul(0.22).add(0.89)).mul(streak);
    const up = mix(murk, over, smoothstep(0.0, 0.08, e));
    // the skyline panorama barely ghosts through the horizon murk (the Office's skyline band)
    const sk = EXT_U.skyline;
    const uu = az.mul(sk.x).add(sk.y);
    const m2 = fract(uu.mul(0.5)).mul(2);
    const u: AnyNode = select((m2 as AnyNode).lessThan(1), m2, float(2).sub(m2 as AnyNode));
    const v: AnyNode = e.sub(sk.z).div(sk.w.sub(sk.z));
    const pano = (sky as AnyNode).sample(vec2(u, clamp(v, 0.002, 0.998))).rgb;
    const ghost = murk.mul(dot(pano, vec3(0.2126, 0.7152, 0.0722)).mul(3.2).add(0.55));
    const band = smoothstep(-0.02, 0.06, v).mul(float(1).sub(smoothstep(0.55, 0.9, v))).mul(clamp(EXT_U.skyGain, 0, 1));
    return vec3(mix(up, ghost, band).mul(gainAt(e)));
  })();
  return (skyMat = m);
}

/** Drifting murk density at a world point (0..1): two octaves of world noise moving with the Office fog's wind. */
const gasDensity = (p: AnyNode, scale: number): AnyNode => {
  const drift = time.mul(EXT_U.fogDrift);
  const q = (vec3 as AnyNode)(p.x.add(drift).div(scale), p.y.div(scale * 0.4), p.z.sub(drift.mul(0.55)).div(scale));
  const n1 = wmNoise(q) as AnyNode;
  const n2 = wmNoise(q.mul(2.37).add(vec3(5.1, 1.7, 3.3)).add((vec3 as AnyNode)(time.mul(0.021), 0, time.mul(-0.013)))) as AnyNode;
  return smoothstep(0.3, 0.78, n1.mul(0.64).add(n2.mul(0.36)));
};

let gasMat: MeshBasicNodeMaterial | null = null;
/** Gas sheets / the low roof layer: translucent murk, fading out toward MALL_SKY_U.reach from the roof centre. */
export function mallGasMaterial(): MeshBasicNodeMaterial {
  if (gasMat) return gasMat;
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false});
  m.name = 'mall-exterior-gas';
  const dir = normalize(positionWorld.sub(cameraPosition) as AnyNode) as AnyNode;
  const dens = gasDensity(positionWorld, 15);
  const r = length(positionWorld.xz.sub(MALL_SKY_U.centre) as AnyNode) as AnyNode;
  const edge = float(1).sub(smoothstep(MALL_SKY_U.reach.mul(0.6), MALL_SKY_U.reach, r));
  m.colorNode = murkAt(dir).mul(gainAt(dir.y)).mul(dens.mul(0.25).add(0.9));
  m.opacityNode = clamp(dens.mul(edge).mul(MALL_SKY_U.gas), 0, 0.85);
  return (gasMat = m);
}

let curtainMat: MeshBasicNodeMaterial | null = null;
/** Gas curtain round the roof edge (seen from inside, BackSide): denser low down, thinning upward. */
export function mallGasCurtainMaterial(): MeshBasicNodeMaterial {
  if (curtainMat) return curtainMat;
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.BackSide, fog: false});
  m.name = 'mall-exterior-gas-curtain';
  const dir = normalize(positionWorld.sub(cameraPosition) as AnyNode) as AnyNode;
  const dens = gasDensity(positionWorld, 11);
  const h = positionWorld.y.sub(MALL_SKY_U.curtainY.x).div(max(MALL_SKY_U.curtainY.y, 1));
  const fall = float(1).sub(smoothstep(0.15, 1, h as AnyNode));
  m.colorNode = murkAt(dir).mul(gainAt(dir.y)).mul(dens.mul(0.2).add(0.92));
  m.opacityNode = clamp(dens.mul(0.6).add(0.25).mul(fall).mul(MALL_SKY_U.curtain), 0, 0.8);
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

export interface MallExteriorStats { layers: number; triangles: number; minY: number }

/**
 * The exterior gas meshes (+ fills MALL_SKY_U.centre / reach / curtainY): one merged 'mall-exterior-gas' mesh (the sheets top-down,
 * then the low layer round the vault: back-to-front for an eye below) and one 'mall-exterior-gas-curtain'. Never below the deck,
 * never inside the vault footprint below its apex.
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
  for (const dy of [11, 6, 2.2]) { quad(X0, Z0, X1, Z1, top + dy); layers++; }
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
  // the curtain: an open cylinder round the roof (outside its footprint), from the deck up past the sheets
  const rC = half + 6, yC0 = spec.deckY, hC = top + 14 - yC0;
  MALL_SKY_U.curtainY.value.set(yC0, hC);
  const cg = new THREE.CylinderGeometry(rC, rC, hC, 32, 1, true);
  cg.translate(cx, yC0 + hC / 2, cz);
  cg.computeBoundingSphere();
  const curtain = new THREE.Mesh(cg, mallGasCurtainMaterial());
  curtain.name = 'mall-exterior-gas-curtain';
  curtain.renderOrder = MALL_EXT_ORDER.curtain;
  for (const m of [sheets, curtain]) { m.matrixAutoUpdate = false; m.updateMatrix(); }
  const tris = idx.length / 3 + (cg.index ? cg.index.count / 3 : 0);
  return {meshes: [sheets, curtain], stats: {layers, triangles: tris, minY: Math.min(low, yC0)}};
}

export interface MallSkyTune { zenith?: number; horizon?: number; gas?: number; curtain?: number }
/** QA: tune the mall exterior (uniform values only); returns the current values. */
export function mallSkyTune(o: MallSkyTune = {}): Required<MallSkyTune> {
  if (typeof o.zenith === 'number') MALL_SKY_U.zenith.value = o.zenith;
  if (typeof o.horizon === 'number') MALL_SKY_U.horizon.value = o.horizon;
  if (typeof o.gas === 'number') MALL_SKY_U.gas.value = o.gas;
  if (typeof o.curtain === 'number') MALL_SKY_U.curtain.value = o.curtain;
  return {zenith: MALL_SKY_U.zenith.value, horizon: MALL_SKY_U.horizon.value, gas: MALL_SKY_U.gas.value, curtain: MALL_SKY_U.curtain.value};
}
