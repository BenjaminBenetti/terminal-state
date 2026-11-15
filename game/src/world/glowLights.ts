// Task studio-reactor-glowing-zombies-20261115-013245-01: the irradiated zombies' GREEN GLOW LIGHTS — real local light, not a billboard.
//
// User: "They must emit real local green light that contributes to the game's actual fog scattering." A small BOOT-TIME POOL of
// unshadowed point lights (GLOW_LIGHT.count = 4): each frame the pool follows the irradiated zombies nearest the eye (within
// GLOW_LIGHT.range, with hysteresis so two equally near zombies do not trade a light every frame), fading a light in over
// GLOW_LIGHT.fadeS when it takes a zombie and out when it lets one go (or the zombie dies: its glow strength falls to 0). A lit glow light
//  - lights the surfaces around the zombie (walls, floor, the zombie itself) through GlowLightNode, OCCLUDED like a flare's light: the
//    same per-light line-of-sight window the fog march uses (world/flareLight.ts flareVisibility), so it never shines through a wall or a
//    slab onto the next room / storey;
//  - is a volumetric SCATTER light of the atmosphere (render/volumetric.ts addScatterLight) in the march's RESERVED glow slots
//    (render/smoke.ts SMOKE_LIMITS.glowLights: never one of the flares' / fire's / Reactor core's slots), so the haze and smoke around it
//    glow green. It is a light IN the haze: it adds no fog and no green density (ordinary fog stays ordinary; gas stays the gas field).
// Cost: the lights are in every scene from boot at intensity 0 (the light set never changes: no recompile, the warm-up builds them);
// GlowLightNode evaluates a light's BRDF only where it is on AND within its cutoff distance (a uniform-colour gate + the cutoff), so an
// idle pool costs a branch per light per lit fragment. No shadow map. Never a perception light source (world/lightSources.ts): zombies are
// not lured by each other.

import * as THREE from 'three';
import type {NodeBuilder} from 'three/webgpu';
import {If, directPointLight, positionWorld, vec3} from 'three/tsl';
import {FlareLight, FlareLightNode, flareVisibility} from './flareLight';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;

export const GLOW_LIGHT = {
  /** Pool size: = render/smoke.ts SMOKE_LIMITS.glowLights (the fog's reserved slots; a test pins the two together). */
  count: 4,
  /** Lime green (uranium glass): clearly green, distinct from the Reactor core's mint (0x52ff5e) and the gas tint. */
  color: 0x8cff3c,
  /** Candela at full strength; cutoff (m) and decay of three's physical attenuation. */
  intensity: 7,
  distance: 9,
  decay: 2,
  /** Height of the light above the zombie's feet, x its body scale (about the chest). */
  lift: 1.15,
  /** Only zombies within this range (m) of the eye get a light. */
  range: 32,
  /** A zombie that HAS a light keeps it against a newcomer up to this much (m) nearer. */
  hysteresisM: 2,
  /** Fade in / out (s). */
  fadeS: 0.35,
} as const;

/** A glow light: a FlareLight (occlusion window) the atmosphere puts in its glow slots (userData.vfGlow). */
export class GlowLight extends FlareLight {
  readonly isGlowLight = true;
  constructor() {
    super(GLOW_LIGHT.color, 0, GLOW_LIGHT.distance, GLOW_LIGHT.decay);
    this.name = 'irradiated-glow';
    this.castShadow = false;
    this.userData.vfGlow = true; // (render/smoke.ts isGlowScatter: the march's reserved glow slots)
  }
}

export const isGlowLight = (l: unknown): l is GlowLight => !!(l as {isGlowLight?: boolean} | null)?.isGlowLight;

/**
 * FlareLightNode with the direct term GATED: evaluated only where the light is on and the fragment is inside its cutoff (three r186
 * AnalyticLightNode.setup without the shadow branch: a glow light never casts one). Same window lookup as a flare.
 */
export class GlowLightNode extends FlareLightNode {
  static get type(): string {
    return 'GlowLightNode';
  }

  setup(builder: NodeBuilder): undefined {
    const self = this as unknown as {colorNode: N; baseColorNode: N; cutoffDistanceNode: N; decayExponentNode: N; getLightVector(b: NodeBuilder): N};
    self.colorNode = self.baseColorNode || self.colorNode;
    const ctx = (builder as unknown as {context: {lightingModel?: {direct(d: unknown, b: NodeBuilder): void}; reflectedLight?: {directDiffuse: N; directSpecular: N}}}).context;
    const {lightingModel, reflectedLight} = ctx;
    if (!lightingModel || !reflectedLight) return undefined;
    const lightVector = n(self.getLightVector(builder)).toVar();
    const c = self.colorNode;
    const diffuse = n(vec3(0)).toVar(), specular = n(vec3(0)).toVar();
    If(n(c).r.add(n(c).g).add(n(c).b).greaterThan(0).and(lightVector.length().lessThan(self.cutoffDistanceNode)), () => {
      const d = directPointLight({color: c, lightVector, cutoffDistance: self.cutoffDistanceNode, decayExponent: self.decayExponentNode} as never) as unknown as {lightDirection: N; lightColor: N};
      const lightColor = n(d.lightColor).mul(flareVisibility(positionWorld, this.winNode as never, this.bandNode as never));
      lightingModel.direct({lightDirection: d.lightDirection, lightColor, lightNode: this, reflectedLight: {directDiffuse: diffuse, directSpecular: specular}}, builder);
    });
    reflectedLight.directDiffuse.addAssign(diffuse);
    reflectedLight.directSpecular.addAssign(specular);
    return undefined;
  }
}

interface NodeLibraryLike { getLightNodeClass(light: unknown): unknown; addLight(node: unknown, light: unknown): void }

/** Register GlowLightNode for GlowLight in a WebGPURenderer's node library (idempotent; before the first compile). False without one. */
export function installGlowLightNode(renderer: {library?: unknown} | null | undefined): boolean {
  const lib = renderer?.library as NodeLibraryLike | undefined;
  if (!lib || typeof lib.addLight !== 'function' || typeof lib.getLightNodeClass !== 'function') return false;
  if (lib.getLightNodeClass(GlowLight) === GlowLightNode) return true;
  lib.addLight(GlowLightNode, GlowLight);
  return true;
}

/** What the pool follows: a glowing zombie (`key` = its identity), its light position, its glow strength 0..1. */
export interface GlowSource {
  readonly key: object;
  x: number;
  y: number;
  z: number;
  strength: number;
}

/** The atmosphere's scatter-light API (render/volumetric.ts). */
export interface GlowScatterHost {
  addScatterLight?(l: THREE.PointLight): unknown;
  removeScatterLight?(l: THREE.PointLight): unknown;
}

interface Slot {
  readonly light: GlowLight;
  owner: object | null;
  /** Fade 0..1 and the owner's last strength / position (kept while fading out after the owner is gone). */
  level: number;
  strength: number;
  scattered: boolean;
}

/** The pool (Game: one, in the scene from boot). */
export class GlowLightPool {
  readonly lights: readonly GlowLight[];
  smoke: GlowScatterHost | null = null;
  private readonly slots: Slot[];
  private readonly want = new Set<object>();
  private readonly order: {s: GlowSource; d: number}[] = [];

  constructor(parent: THREE.Object3D, count: number = GLOW_LIGHT.count) {
    this.slots = Array.from({length: count}, () => {
      const light = new GlowLight();
      parent.add(light);
      return {light, owner: null, level: 0, strength: 0, scattered: false};
    });
    this.lights = this.slots.map(s => s.light);
  }

  /** Lights currently on (intensity > 0). */
  get active(): number {
    return this.slots.reduce((k, s) => k + (s.light.intensity > 0 ? 1 : 0), 0);
  }

  /** Who owns slot `i` (tests / QA). */
  ownerOf(i: number): object | null {
    return this.slots[i]?.owner ?? null;
  }

  /** One frame: follow the `sources` nearest `eye` (active play time; `dt` 0 = re-place only). */
  frame(dt: number, sources: readonly GlowSource[], eye: {x: number; y: number; z: number}): void {
    const owned = new Map<object, Slot>();
    for (const s of this.slots) if (s.owner) owned.set(s.owner, s);
    const order = this.order;
    order.length = 0;
    for (const s of sources) {
      if (!(s.strength > 0)) continue;
      const d = Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z);
      if (d > GLOW_LIGHT.range) continue;
      order.push({s, d: d - (owned.has(s.key) ? GLOW_LIGHT.hysteresisM : 0)});
    }
    order.sort((a, b) => a.d - b.d);
    const want = this.want;
    want.clear();
    for (let k = 0; k < order.length && want.size < this.slots.length; k++) want.add(order[k].s.key);
    const byKey = new Map<object, GlowSource>();
    for (const {s} of order) byKey.set(s.key, s);
    // newcomers take free slots (a slot still fading out its old owner is not free yet)
    for (const key of want) {
      if (owned.has(key)) continue;
      const free = this.slots.find(s => !s.owner);
      if (!free) break;
      free.owner = key;
      free.level = 0;
      owned.set(key, free);
    }
    const step = dt > 0 ? dt / GLOW_LIGHT.fadeS : 0;
    for (const s of this.slots) {
      if (!s.owner) continue;
      const src = byKey.get(s.owner), keep = want.has(s.owner) && !!src;
      s.level = Math.max(0, Math.min(1, s.level + (keep ? step : -step)));
      if (src) { s.light.position.set(src.x, src.y, src.z); s.strength = src.strength; }
      if (!keep && s.level <= 0) { s.owner = null; s.strength = 0; }
      this.apply(s);
    }
  }

  private apply(s: Slot): void {
    const on = s.owner ? GLOW_LIGHT.intensity * s.level * Math.max(0, Math.min(1, s.strength)) : 0;
    s.light.intensity = on;
    if (on > 0 && !s.scattered && this.smoke?.addScatterLight) s.scattered = this.smoke.addScatterLight(s.light) !== false;
    else if (on <= 0 && s.scattered) { this.smoke?.removeScatterLight?.(s.light); s.scattered = false; s.light.clearWindow(); }
  }

  /** Every light dark and released (new station / Retry / leaving: nothing of a glow outlives its world). */
  clear(): void {
    for (const s of this.slots) { s.owner = null; s.level = 0; s.strength = 0; this.apply(s); s.light.clearWindow(); }
  }
}
