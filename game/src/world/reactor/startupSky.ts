// Task reactor-playtest-round2-20261102 (lane STARTUP): THE ONLINE SKY — user: "when the reactor comes online the fog visible through
// the roof should clear, with a blue beam shooting up in to the sky, from the reactor, it should caste light and illuminate the area."
//
//  - the BLUE BEAM: ONE mesh (merged open cylinders: a hot core, a soft glow sheath, a collar where it leaves the vessel), additive and
//    emissive (no depth write, never an opaque plane), from the top of the CRDM housings on the vessel straight up through the single
//    roof opening (gen/reactor/roofOpening.ts: centred on the core) into the sky. Its head climbs from the vessel to the sky in
//    STARTUP.beamRiseS at ONLINE. Its own material + two plain uniforms (on / head) — nothing in the volumetric march (its 12-uniform-
//    buffer budget is untouched; docs/reactor.md "Fog visibility root cause");
//  - CAST LIGHT: BEAM_LIGHTS — two unshadowed PointLights created ONCE at boot (intensity-only, like world/reactor/coreLights.ts): one
//    mid-pit (also the volumetric march's scatter light, `userData.vfOpen`: it lights the haze round the beam on every tier), one under
//    the roof opening (the roof's underside, the curb, the rim gallery);
//  - THE SKY CLEARS: the outdoor toxic air over the roof (world/gaslightRules.ts reactorOutdoorGas through ReactorAir.setOutdoorClear —
//    the exposure and the march read the same object), the outside gas sheets / curtain over the pit (world/mallExterior.ts MALL_SKY_U
//    gas / curtain, restored on teardown) thin out, and a CLEARED SKY dome (deep blue-grey, the beam's glow at the zenith) fades in
//    over the toxic murk dome — over the opening only (the slab covers the rest).
// A pure function of the win clock (startupPlan.ts beamAt / skyClearAt); a rebuilt restarted world shows the end state at once.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {abs, attribute, cameraPosition, dot, float, max, mix, normalize, normalView, positionView, positionWorld, pow, sin, smoothstep, time, uniform, vec3} from 'three/tsl';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import {roofOpeningOf} from '../../gen/reactor/roofOpening';
import {MALL_EXT_ORDER} from '../mallExterior';
import {CORE_HERO} from './coreHero';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;

/** The beam (m) and its look (linear colours; QA tunable). */
export const BEAM = {
  /** Radii: hot core, glow sheath, the collar at the vessel (bottom -> top) and its height. */
  core: 0.42, glow: 1.5, collar: [2.6, 1.1] as readonly [number, number], collarH: 3.5,
  /** Top: this far above the roof line (inside the pit sky dome's 150 m and the Reactor's far plane). */
  aboveRoof: 120,
  /** Linear colour and the per-layer gains (core, sheath, collar). */
  colour: [0.32, 0.6, 1] as readonly [number, number, number],
  gains: [7, 1.3, 1.6] as readonly [number, number, number],
} as const;

/** The beam's cast light (created once at boot; intensity-only changes). */
export const BEAM_LIGHTS = {
  color: 0x6fa8ff,
  /** Mid-pit light (the volumetric scatter light) and the one under the roof opening: candela at full, cutoff m, decay. */
  mid: {candela: 520, distance: 40, decay: 1.25},
  roof: {candela: 360, distance: 30, decay: 1.25},
} as const;

/** The cleared sky over the opening (linear colours). */
export const CLEAR_SKY = {
  zenith: [0.02, 0.045, 0.085] as readonly [number, number, number],
  horizon: [0.05, 0.065, 0.08] as readonly [number, number, number],
  /** The beam's glow at the zenith (gain, tightness). */
  glow: 1.2, glowPow: 18,
  radius: 140,
} as const;

/** Where the beam starts: the top of the CRDM housings on the vessel (the core floor + CORE_HERO.crdmTop). */
export function beamBase(info: Pick<ReactorInfo, 'core' | 'coreFloor'>): {x: number; y: number; z: number} {
  const y0 = info.coreFloor?.y ?? info.core.y0;
  return {x: info.coreFloor?.x ?? info.core.x, y: y0 + CORE_HERO.crdmTop - 0.6, z: info.coreFloor?.z ?? info.core.z};
}

/** The beam's span (absolute y) and its two light points. */
export function beamSpan(info: Pick<ReactorInfo, 'core' | 'coreFloor' | 'pit'>): {x: number; z: number; y0: number; y1: number; mid: {x: number; y: number; z: number}; roof: {x: number; y: number; z: number}} {
  const b = beamBase(info), y1 = info.pit.roofY + BEAM.aboveRoof;
  return {x: b.x, z: b.z, y0: b.y, y1, mid: {x: b.x, y: (b.y + info.pit.rimY) / 2, z: b.z}, roof: {x: b.x, y: info.pit.roofY - 3, z: b.z}};
}

/** The beam's uniforms (the runtime writes them: on = brightness 0..1, head = the climbing front's absolute y). */
export interface BeamUniforms { on: {value: number}; head: {value: number} }

function beamGeometry(y0: number, y1: number): THREE.BufferGeometry {
  const H = y1 - y0;
  const layer = (g: THREE.BufferGeometry, k: number) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.setAttribute('beamLayer', new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count).fill(k), 1));
    ng.deleteAttribute('uv');
    return ng;
  };
  const parts = [
    layer(new THREE.CylinderGeometry(BEAM.core, BEAM.core, H, 20, 1, true).translate(0, y0 + H / 2, 0), 0),
    layer(new THREE.CylinderGeometry(BEAM.glow, BEAM.glow, H, 28, 1, true).translate(0, y0 + H / 2, 0), 1),
    layer(new THREE.CylinderGeometry(BEAM.collar[1], BEAM.collar[0], BEAM.collarH, 28, 1, true).translate(0, y0 + BEAM.collarH / 2, 0), 2),
  ];
  const g = mergeGeometries(parts, false)!;
  for (const q of parts) q.dispose();
  g.computeBoundingSphere();
  return g;
}

function beamMaterial(u: BeamUniforms, y0: number, roofY: number, y1: number): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'reactor-beam', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false});
  const layer = n(attribute('beamLayer', 'float'));
  const y = n(positionWorld.y);
  const facing = n(abs(dot(normalView, normalize(n(positionView).negate()))));
  // per layer: the hot core stays bright to its edge (a tight line), the sheath / collar fall off toward their silhouettes
  const edge = n(mix(pow(facing, 1.2), pow(facing, 2.4), n(layer).min(1)));
  const gain = n(mix(mix(float(BEAM.gains[0]), float(BEAM.gains[1]), n(layer).min(1)), float(BEAM.gains[2]), n(layer).sub(1).max(0)));
  const head = n(float(1).sub(smoothstep(n(u.head).sub(4), n(u.head), y)));
  const foot = n(smoothstep(y0, y0 + 1.2, y));
  const far = n(float(1).sub(smoothstep(roofY + 30, y1, y)).mul(0.85).add(0.15));
  const collar = n(float(1).sub(n(smoothstep(y0 + 0.5, y0 + BEAM.collarH, y)).mul(n(layer).sub(1).max(0))));
  const pulse = n(sin(n(y).mul(0.32).sub(n(time).mul(7)))).mul(0.12).add(0.9);
  const k = n(edge).mul(gain).mul(head).mul(foot).mul(far).mul(collar).mul(pulse).mul(u.on);
  m.colorNode = n(vec3(BEAM.colour[0], BEAM.colour[1], BEAM.colour[2])).mul(k);
  return m;
}

/** The cleared sky dome over the opening: transparent over the murk dome, opacity = the clearing, strongest overhead. */
function clearSkyMaterial(clear: {value: number}, on: {value: number}): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'reactor-clear-sky', side: THREE.BackSide, transparent: true, depthWrite: false, fog: false});
  const dir = n(normalize(n(positionWorld).sub(cameraPosition)));
  const e = n(max(n(dir).y, 0));
  const Z = CLEAR_SKY.zenith, Hz = CLEAR_SKY.horizon, c = BEAM.colour;
  const base = n(mix(vec3(Hz[0], Hz[1], Hz[2]), vec3(Z[0], Z[1], Z[2]), smoothstep(0.05, 0.7, e)));
  const glow = n(pow(e, CLEAR_SKY.glowPow)).mul(CLEAR_SKY.glow).mul(on);
  m.colorNode = n(base).add(n(vec3(c[0], c[1], c[2])).mul(glow));
  m.opacityNode = n(clear).mul(smoothstep(0.08, 0.45, e));
  return m;
}

export interface OnlineSkyStats { beam: boolean; clearDome: boolean; y0: number; y1: number; triangles: number }

/** The ONLINE sky of one Reactor world (built once per world; hidden until ONLINE). */
export class OnlineSky {
  readonly group = new THREE.Group();
  readonly beam: THREE.Mesh;
  readonly dome: THREE.Mesh | null;
  readonly u: BeamUniforms = {on: uniform(0), head: uniform(-1e4)} as unknown as BeamUniforms;
  readonly clearU = uniform(0) as unknown as {value: number};
  readonly span: ReturnType<typeof beamSpan>;

  constructor(readonly info: ReactorInfo, levels: readonly number[]) {
    this.group.name = 'reactor-online-sky';
    const s = this.span = beamSpan(info);
    const g = beamGeometry(s.y0, s.y1);
    this.beam = new THREE.Mesh(g, beamMaterial(this.u, s.y0, info.pit.roofY, s.y1));
    this.beam.name = 'reactor-beam';
    this.beam.position.set(s.x, 0, s.z);
    this.beam.renderOrder = 2;
    const o = roofOpeningOf(info);
    if (o) {
      const dg = new THREE.SphereGeometry(CLEAR_SKY.radius, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      this.dome = new THREE.Mesh(dg, clearSkyMaterial(this.clearU, this.u.on));
      this.dome.name = 'reactor-clear-sky';
      this.dome.position.set(o.x, info.pit.roofY, o.z);
      this.dome.renderOrder = MALL_EXT_ORDER.sky + 0.5; // over the murk dome, under the outside gas sheets / curtain
      this.dome.frustumCulled = false;
    } else this.dome = null;
    for (const m of [this.beam, this.dome]) {
      if (!m) continue;
      m.userData.levels = [...levels];
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.visible = false;
      this.group.add(m);
    }
  }

  /** Show the state: beam 0..1 (head fraction, brightness) and the sky clearing 0..1. */
  apply(beam: {head: number; on: number}, clear: number): void {
    const s = this.span;
    this.u.on.value = beam.on;
    this.u.head.value = beam.head >= 1 ? s.y1 + 10 : s.y0 + (s.y1 - s.y0) * beam.head;
    this.beam.visible = beam.on > 0;
    this.clearU.value = clear;
    if (this.dome) this.dome.visible = clear > 0.001;
  }

  stats(): OnlineSkyStats {
    const tri = (m: THREE.Mesh | null) => (m ? (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3 : 0);
    return {beam: this.beam.visible, clearDome: !!this.dome?.visible, y0: this.span.y0, y1: this.span.y1, triangles: tri(this.beam) + tri(this.dome)};
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of [this.beam, this.dome]) {
      if (!m) continue;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/** The beam's two cast lights (created once at boot, added to the scene; intensity-only changes). */
export class BeamLights {
  readonly mid: THREE.PointLight;
  readonly roof: THREE.PointLight;
  constructor() {
    const L = BEAM_LIGHTS;
    this.mid = new THREE.PointLight(L.color, 0, L.mid.distance, L.mid.decay);
    this.roof = new THREE.PointLight(L.color, 0, L.roof.distance, L.roof.decay);
    this.mid.name = 'reactor-beam-light-mid';
    this.roof.name = 'reactor-beam-light-roof';
    for (const l of [this.mid, this.roof]) { l.castShadow = false; l.position.set(0, -1000, 0); }
    this.mid.userData.vfOpen = true; // (lane GASLIGHT contract) lights the whole pit's haze round the beam, no occlusion window
  }
  get all(): THREE.PointLight[] { return [this.mid, this.roof]; }
  addTo(scene: THREE.Object3D): void { for (const l of this.all) scene.add(l); }
  place(span: ReturnType<typeof beamSpan>): void {
    this.mid.position.set(span.mid.x, span.mid.y, span.mid.z);
    this.roof.position.set(span.roof.x, span.roof.y, span.roof.z);
    for (const l of this.all) l.updateMatrixWorld();
  }
  /** Brightness 0..1 (the beam's `on`); `gain` = QA. */
  set(k: number, gain = 1): void {
    this.mid.intensity = BEAM_LIGHTS.mid.candela * k * gain;
    this.roof.intensity = BEAM_LIGHTS.roof.candela * k * gain;
  }
}
