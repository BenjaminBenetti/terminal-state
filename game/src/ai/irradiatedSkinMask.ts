// Task studio-reactor-glowing-zombies-20261115-013245-01 (lane MASK): per-body lookup into the irradiated zombies' packed SKIN MASK
// (assets/zombieSkinMask.generated.ts, built by tools/asset-pipeline/zombie/build-skin-mask.mjs; provenance
// assets/derivatives/zombie-skin-mask.json). Pure data / logic (no three.js), so the shader setup and the tests share it.
//
// The mask is a 1024² RGB PNG of 2 x 2 tiles (512² each); a body's mask is ONE channel of ONE tile, addressed in the body mesh's own
// TEXCOORD_0 (the same UVs as its base-colour map):
//   maskUv = vec2(u0, v0) + uv * scale;   skin = dot(texture(mask, maskUv), select)   (select = skinMaskChannelSelect(channel))
// Load it like a glTF data texture: flipY = false (THREE.TextureLoader defaults to true), colorSpace = NoColorSpace, linear filter and
// NO mipmaps (lower mip levels would blend neighbouring tiles, i.e. other bodies). Every body's UVs lie inside [0, 1] with a ~1.5 texel
// margin at 512, so bilinear sampling never leaves the body's tile.

import {ZOMBIE_SKIN_MASK} from '../assets/zombieSkinMask.generated';

/** RGB channel index of a body's mask (alpha is never used). */
export type SkinMaskChannel = 0 | 1 | 2;

export interface SkinMaskSlot {
  /** UV offset of the body's tile in the packed mask (top-left corner, glTF / flipY = false convention). */
  readonly u0: number;
  readonly v0: number;
  /** Tile size in UV units of the packed mask (tile / size = 0.5): maskUv = (u0, v0) + uv * scale. */
  readonly scale: number;
  /** Channel of that tile holding the body's mask (0 = R, 1 = G, 2 = B). */
  readonly channel: SkinMaskChannel;
}

/** Runtime path of the packed mask (relative, as in the asset manifests). */
export const SKIN_MASK_URL: string = ZOMBIE_SKIN_MASK.url;

type SlotRow = {readonly tile: readonly [number, number]; readonly channel: number};
const SLOTS: Readonly<Record<string, SlotRow>> = ZOMBIE_SKIN_MASK.slots;
const COVERAGE: Readonly<Record<string, number>> = ZOMBIE_SKIN_MASK.coverage;
const SCALE = ZOMBIE_SKIN_MASK.tile / ZOMBIE_SKIN_MASK.size;

/** The packed-mask slot of an ordinary zombie body (ai/outfits.ts ZOMBIE_BODIES id), or null for a body without a mask. */
export function skinMaskSlot(bodyId: string): SkinMaskSlot | null {
  if (!Object.hasOwn(SLOTS, bodyId)) return null;
  const s = SLOTS[bodyId];
  return {u0: s.tile[0] * SCALE, v0: s.tile[1] * SCALE, scale: SCALE, channel: s.channel as SkinMaskChannel};
}

/** One-hot RGBA selector for a channel: the shader's skin value = dot(maskTexel, select). */
export function skinMaskChannelSelect(channel: SkinMaskChannel): [number, number, number, number] {
  const v: [number, number, number, number] = [0, 0, 0, 0];
  v[channel] = 1;
  return v;
}

/** Skin share of a body's surface area as the shader samples the mask (0..1), or null for a body without a mask. */
export function skinMaskCoverage(bodyId: string): number | null {
  return Object.hasOwn(COVERAGE, bodyId) ? COVERAGE[bodyId] : null;
}
