// Task studio-reactor-glowing-zombies-20261115-013245-01: an irradiated zombie's GREEN, GLOWING SKIN — on the ordinary zombie models.
//
// User: "Reuse regular zombie models: their SKIN is green and visibly emissive, not just green clothing or a screen tint."
// Each ordinary body (ai/outfits.ts ZOMBIE_BODIES) is ONE skinned mesh with ONE base-colour atlas that also holds baked clothing,
// hair and gear, so the skin is found by a per-body DATA MASK in the body's own UV space (zombie-skin-mask.png: 2 x 2 tiles of
// 512², one RGB channel per body: ai/irradiatedSkinMask.ts; built from the shipped atlases by tools/asset-pipeline/zombie/build-skin-mask.mjs — processing,
// not authoring). Two node stages on the body mesh's own material only (garment meshes are untouched: clothing stays its colour):
//  - colour (order 250, before the wounds' 300 so a fresh wound still shows raw flesh): the masked texels pushed toward a sickly
//    green of their own luminance (shading and detail of the atlas kept);
//  - emissive (order 400, effects): + masked green emission x the zombie's glow strength (1 alive, fading to 0 after death:
//    world/irradiation.ts), brighter on the atlas' lighter texels, with a slow per-zombie pulse. The hit flash's
//    material.emissive is the stage's base, so a hit still flashes.
// The per-zombie values are per-object data (mesh.userData.irrSkin: tile offset, channel, tint, glow, phase), so every irradiated
// body shares ONE program per lighting variant; the material carries an own string tag (IRRADIATED_SKIN.prop) because three r186's
// program cache key ignores node slots' contents — without it an ordinary body's wound program could be shared by mistake.
// The mask is one small global texture, loaded behind the loading screen of a section that has irradiated zombies (preloadSkinMask);
// before it is loaded the stages read a 1 x 1 'no skin' placeholder (nothing turns green — never the clothes).

import * as THREE from 'three';
import type {Node, NodeMaterial} from 'three/webgpu';
import {dot, float, materialColor, materialEmissive, mix, sin, texture, time, uv, vec2, vec3, vec4, clamp, abs} from 'three/tsl';
import {addNodeHook} from '../render/nodeHooks';
import {memoNode, objectData, type TNode} from '../damage/tsl';
import {plainTexture, sampleAt} from '../render/textureFetch';
import {refreshTextureBindings} from '../render/bindingRefresh';
import {assetUrl} from '../assets/loader';
import {SKIN_MASK_URL, skinMaskSlot} from './irradiatedSkinMask';

export const IRRADIATED_SKIN = {
  /** Per-object data key (2 vec4: (u0, v0, channel, tint), (glow, phase, tile scale, 0)). */
  key: 'irrSkin',
  /** The material's own string property (program cache key) and its value. */
  prop: 'irradiatedSkin',
  tag: 'v1',
  /** Green of the skin's own luminance: rgb = clamp(lum x gain + lift); mixed in by mask x tint. */
  gain: [0.5, 1.55, 0.38] as const,
  lift: [0.012, 0.05, 0.01] as const,
  tint: 0.9,
  /** Emission (linear rgb x strength) at full glow; x (lightFloor + lum x lightGain) of the atlas texel. */
  emissive: [0.42, 1, 0.2] as const,
  strength: 1.6,
  lightFloor: 0.55,
  lightGain: 1.4,
  /** Pulse: emission x (1 - amount + amount x (0.5 + 0.5 sin(t x rate + phase))). */
  pulse: {amount: 0.22, rate: 1.9},
} as const;

const DATA_VEC4 = 2;

const placeholder = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

/** The shared mask texture node (the loaded mask once preloadSkinMask resolved; a 'no skin' placeholder before). */
export const SKIN_MASK = plainTexture(texture(placeholder));

let mask: THREE.Texture | null = null;
let pending: Promise<THREE.Texture | null> | null = null;

/** Bind a mask texture (tests / QA; null restores the placeholder). */
export function bindSkinMask(tex: THREE.Texture | null): void {
  const node = SKIN_MASK as unknown as {value: THREE.Texture}, next = tex ?? placeholder;
  if (node.value !== next) { node.value = next; refreshTextureBindings(); }
}

/** The mask texture once loaded (null before / on failure). */
export function skinMaskTexture(): THREE.Texture | null {
  return mask;
}

/** Load the mask once (a section preload when its layout has irradiated zombies). Never throws; null on failure (no green skin). */
export function preloadSkinMask(load: (url: string) => Promise<THREE.Texture> = url => new THREE.TextureLoader().loadAsync(url)): Promise<THREE.Texture | null> {
  pending ??= load(assetUrl(SKIN_MASK_URL)).then(t => {
    t.flipY = false; // (glTF UV convention: the body atlases' own)
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false; // (a lower mip would blend the neighbouring tiles = other bodies' masks)
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    mask = t;
    bindSkinMask(t);
    return t;
  }, err => {
    console.warn('irradiated skin: the skin mask failed to load (no green skin)', err);
    pending = null;
    return null;
  });
  return pending;
}

const n = (x: unknown): TNode => x;

interface SkinShared { slot: TNode; glow: TNode; phase: TNode; tint: TNode; m: TNode; lum: TNode }
let shared: SkinShared | null = null;

function skinNodes(): SkinShared {
  if (shared) return shared;
  const D = objectData(IRRADIATED_SKIN.key, DATA_VEC4);
  const a = D.element(0), b = D.element(1);
  const at = vec2(n(a).x, n(a).y).add(n(uv()).mul(n(b).z));
  const texel = n(sampleAt(SKIN_MASK, at));
  const pick = clamp(float(1).sub(abs(vec4(0, 1, 2, 3).sub(n(a).z))), 0, 1);
  const m = n(dot(texel, pick)).toVar();
  const lum = n(dot(n(materialColor).rgb, vec3(0.299, 0.587, 0.114))).toVar();
  shared = {slot: a, glow: n(b).x, phase: n(b).y, tint: n(a).w, m, lum};
  return shared;
}

/** Colour stage: masked skin toward the green of its own luminance. */
export function irradiatedColorNode(prev: Node | null): Node {
  return memoNode(prev, 'irr-skin-color', () => {
    const S = skinNodes(), K = IRRADIATED_SKIN;
    const base = n(vec4(n(prev ?? materialColor))).toVar();
    const lum = n(dot(base.rgb, vec3(0.299, 0.587, 0.114)));
    const green = clamp(lum.mul(vec3(...K.gain)).add(vec3(...K.lift)), 0, 1);
    return vec4(mix(base.rgb, green, S.m.mul(S.tint)), base.a) as unknown as Node;
  });
}

/** Emissive stage: + masked green emission x glow x pulse (base: the material's emissive = the hit flash). */
export function irradiatedEmissiveNode(prev: Node | null): Node {
  return memoNode(prev, 'irr-skin-emissive', () => {
    const S = skinNodes(), K = IRRADIATED_SKIN;
    const pulse = float(1 - K.pulse.amount).add(float(K.pulse.amount).mul(n(sin(n(time).mul(K.pulse.rate).add(S.phase))).mul(0.5).add(0.5)));
    const light = float(K.lightFloor).add(S.lum.mul(K.lightGain));
    const e = vec3(...K.emissive).mul(K.strength).mul(S.m).mul(S.glow).mul(pulse).mul(light);
    return n(vec3(n(prev ?? materialEmissive))).add(e) as unknown as Node;
  });
}

/** An actor as the skin needs it (ai/zombieActor.ts ZombieActor after Game.spawnEnemy's damage.installZombie). */
export interface SkinActor {
  readonly root: THREE.Object3D;
  readonly look: {readonly body: string} | null;
  readonly meshes?: readonly THREE.Object3D[];
}

const bodyMeshOf = (a: SkinActor): THREE.Mesh | null => {
  let found: THREE.Mesh | null = null;
  a.root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!found && m.isMesh && (m.userData.slot === 'body' || /ZombieBody/i.test(m.name))) found = m;
  });
  return found;
};

const DATA = new WeakMap<object, Float32Array>();

/**
 * Give an actor the irradiated skin (body mesh material only): the two stages + the tag + its per-object data. `phase` = the pulse
 * phase (radians; per zombie). Returns the per-object data (its glow at [4]) or null when the actor has no body node material or its
 * body has no mask slot (the legacy single template: no green skin, the light / dose still apply). Idempotent.
 */
export function installIrradiatedSkin(actor: SkinActor, phase: number): Float32Array | null {
  const had = DATA.get(actor);
  if (had) return had;
  const slot = actor.look ? skinMaskSlot(actor.look.body) : null;
  const mesh = bodyMeshOf(actor);
  const mat = mesh ? (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as unknown as NodeMaterial & Record<string, unknown> : null;
  if (!slot || !mesh || !mat || mat.isNodeMaterial !== true) return null;
  mat[IRRADIATED_SKIN.prop] = IRRADIATED_SKIN.tag;
  addNodeHook(mat, {key: 'irradiated-skin.color', stage: 'color', order: 250, fn: prev => irradiatedColorNode(prev)});
  addNodeHook(mat, {key: 'irradiated-skin.emissive', stage: 'emissive', order: 400, fn: prev => irradiatedEmissiveNode(prev)});
  const data = new Float32Array(DATA_VEC4 * 4);
  data.set([slot.u0, slot.v0, slot.channel, IRRADIATED_SKIN.tint, 1, phase, slot.scale, 0]);
  mesh.userData[IRRADIATED_SKIN.key] = data;
  DATA.set(actor, data);
  return data;
}

/** The skin data of an actor (undefined: not an irradiated skin). */
export function irradiatedSkinOf(actor: object): Float32Array | undefined {
  return DATA.get(actor);
}

/** Set an actor's glow strength 0..1 (its skin's emission; the tint stays). */
export function setSkinGlow(actor: object, strength: number): void {
  const d = DATA.get(actor);
  if (d) d[4] = Math.max(0, Math.min(1, strength));
}
