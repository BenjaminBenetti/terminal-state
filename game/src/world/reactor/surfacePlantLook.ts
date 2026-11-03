// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane PLANT follow-up 2): the vent towers' NIGHT DRESSING —
// the primary's browser check: in the rainy dusk the towers read as dark masses, and the user asked for VISIBLE towers. Code-driven
// emissive markers only (dynamic light effects: no texture, no real THREE light, no shadow):
//  - towerConcreteMaterial: lane SURFACE's wet concrete (surfaceLook.ts surfaceWallMaterial, its own instance: the parapet keeps its
//    look) a touch lighter for the towers only, plus a warm sodium wash on the stack face round each fan (the work lights' spill) —
//    plain uniforms (no uniformArray: WebGPU's 12-buffer budget);
//  - plantLampMaterial: the lamp heads — unlit, the instance colour (red aviation obstruction / warm sodium) x a soft ~1 Hz pulse
//    (TSL `time`, a per-instance phase / depth: the towers blink out of phase; sodium steady) — nothing per frame on the CPU;
//  - plantGlowMaterial: soft additive camera-facing glow cards (lights.ts glowMaterial's construction: the card centre = the instance
//    translation, sized / pulled toward the eye per instance) that read through the rain at 40-80 m, the same pulse.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {
  cameraProjectionMatrix, cos, dot, exp, float, instancedBufferAttribute, length, max, min, modelViewMatrix, normalWorld, normalize,
  positionGeometry, positionLocal, positionWorld, pow, smoothstep, time, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {surfaceWallMaterial} from './surfaceLook';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;

/** The dressing's look (linear colours; HDR values go through the renderer's tone mapping). */
export const PLANT_LOOK = {
  /** The towers' concrete tone over lane SURFACE's wall finish, the sodium wash's peak (x SODIUM) round each fan. */
  towerTone: 1.3, wash: 0.5,
  /** Lamp head colours, glow card colours. */
  red: [2.6, 0.16, 0.07] as const, redGlow: [1.5, 0.09, 0.04] as const,
  sodium: [2.3, 1.2, 0.4] as const, sodiumGlow: [0.95, 0.5, 0.15] as const, halo: [0.5, 0.27, 0.08] as const,
  /** The obstruction lights' pulse: Hz, floor (fraction of full at the trough), sharpness. */
  blinkHz: 1, blinkFloor: 0.12, blinkPow: 4,
} as const;

/** Warm low-pressure sodium (the wash's hue). */
const SODIUM: readonly [number, number, number] = [1, 0.55, 0.2];

/** The soft pulse of a lamp: 1 - depth + depth x (floor + (1 - floor) x ((1 + cos 2 pi (f t + phase)) / 2)^pow). */
const pulse = (blink: N): N => {
  const b = n(blink);
  const wave = n(pow(n(cos(n(time).mul(PLANT_LOOK.blinkHz).add(b.x).mul(Math.PI * 2))).mul(0.5).add(0.5), PLANT_LOOK.blinkPow));
  return n(float(1).sub(b.y)).add(n(b.y).mul(n(wave).mul(1 - PLANT_LOOK.blinkFloor).add(PLANT_LOOK.blinkFloor)));
};

/** CPU mirror of the pulse (tests / QA): brightness 0..1 of a lamp with (phase, depth) at time t (s). */
export function plantPulseAt(t: number, phase: number, depth: number): number {
  const wave = ((1 + Math.cos((t * PLANT_LOOK.blinkHz + phase) * Math.PI * 2)) / 2) ** PLANT_LOOK.blinkPow;
  return 1 - depth + depth * (PLANT_LOOK.blinkFloor + (1 - PLANT_LOOK.blinkFloor) * wave);
}

/** A fan the wash lights: hub (world), its ring radius, its facing (the axis toward the plaza). */
export interface WashFan { x: number; y: number; z: number; r: number; nx: number; nz: number }

/**
 * The towers' concrete: lane SURFACE's wet wall finish (its own instance), x towerTone, + the sodium wash round up to two fans (two plain
 * uniform pairs; a missing fan is parked far below the world). Returns the material and its QA uniforms.
 */
export function towerConcreteMaterial(concrete: THREE.Texture | null, fans: readonly WashFan[]): {material: MeshBasicNodeMaterial; tone: {value: number}; wash: {value: number}} {
  const m = surfaceWallMaterial(concrete);
  m.name = 'reactor-surface-plant-towers';
  const base = n(m.colorNode);
  const tone = uniform(PLANT_LOOK.towerTone), gain = uniform(PLANT_LOOK.wash);
  let wash: N = n(vec3(0, 0, 0));
  for (let i = 0; i < 2; i++) {
    const f = fans[i];
    const hub = uniform(f ? new THREE.Vector4(f.x, f.y, f.z, f.r) : new THREE.Vector4(0, -1e4, 0, 1));
    const ax = uniform(f ? new THREE.Vector3(f.nx, 0, f.nz) : new THREE.Vector3(0, 0, 1));
    const d = n(length(n(positionWorld).sub(n(hub).xyz)));
    const w = n(float(1).sub(smoothstep(n(hub).w.mul(0.5), n(hub).w.mul(2.6), d))).mul(max(dot(normalWorld, ax), 0));
    wash = n(wash).add(n(vec3(SODIUM[0], SODIUM[1], SODIUM[2])).mul(w));
  }
  m.colorNode = vec4(n(base).rgb.mul(tone).add(n(wash).mul(gain)), 1);
  return {material: m, tone: tone as unknown as {value: number}, wash: gain as unknown as {value: number}};
}

/** The lamp heads: unlit, instance colour x the pulse (per instance: `blink` = (phase, depth, 0, 0)). */
export function plantLampMaterial(blink: THREE.InstancedBufferAttribute): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'reactor-surface-plant-lamps', fog: false});
  m.colorNode = n(vec3(1, 1, 1)).mul(pulse(instancedBufferAttribute(blink))); // x instance colour (NodeMaterial.setupDiffuseColor)
  return m;
}

/**
 * The glow cards: additive, camera-facing (the card centre = the instance translation; per instance `card` = (width, height, pull
 * toward the eye, 0), `blink` = (phase, depth, 0, 0)), a soft gaussian falloff, x instance colour x the pulse.
 */
export function plantGlowMaterial(card: THREE.InstancedBufferAttribute, blink: THREE.InstancedBufferAttribute): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'reactor-surface-plant-glows', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false});
  const k = n(instancedBufferAttribute(card));
  const centre = n(positionLocal).sub(positionGeometry);
  const c = n(n(modelViewMatrix).mul(vec4(centre, 1)).xyz);
  const pulled = n(c.sub(n(normalize(c)).mul(min(k.z, n(length(c)).mul(0.25))))).add(vec3(n(n(positionGeometry).xy).mul(vec2(k.x, k.y)), 0));
  m.vertexNode = n(cameraProjectionMatrix).mul(vec4(pulled, 1));
  const q = n(n(uv()).sub(0.5)).mul(2);
  const a = n(max(0, n(exp(n(dot(q, q)).mul(-3.2))).sub(0.04)));
  m.colorNode = vec4(n(vec3(1, 1, 1)).mul(a).mul(pulse(instancedBufferAttribute(blink))), 1); // x instance colour
  return m;
}
