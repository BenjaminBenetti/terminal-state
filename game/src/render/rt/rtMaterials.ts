// Task rt-flashlight-compute-20261115-233136 (lane BVH): the colour the traced flashlight bounce gives a surface — one linear diffuse
// albedo per material (the GPU material table: [r, g, b, flags u32], render/rt/rtScene.ts), and the one of a character's capsule.
//
// A material's albedo: its own linear `userData.lightAlbedo` ([r, g, b]) when it knows better; else the office / Skyways surface paint
// (`ofA`, as world/surfaceAlbedo.ts finishAlbedo reads it); else colour x the mean of its map (damage/sample.ts textureMean: the bullet-
// chip colour path; null in Node or before the image is decoded -> the plain colour). Capped at RT_ALBEDO_MAX (fresh white paint is
// about 0.8), then times the diffuse share of a metal: (1 - metalness) + metalness x roughness (Standard family; 1 otherwise) — a
// polished metal sends the beam on as a reflection, not back as a diffuse bounce.
// Cached per material (WeakMap); a value made while the map's image could not be read yet in a browser is not kept (asked again).
// Reading a decoded image's mean the first time draws it into a small canvas (ms in a browser): `deferTexture` returns the plain
// colour instead (not kept, `resolved.deferred`) so a per-frame caller can read it later within its budget.

import * as THREE from 'three';
import {textureMean} from '../../damage/sample';
import {DAMAGE_MATERIALS} from '../../damage/materials';
import {RT_MAT_VERTEX_COLOR} from './rtFormat';

export {RT_MAT_VERTEX_COLOR};

/** No material bounces more than this (linear, per channel; before the diffuse share). */
export const RT_ALBEDO_MAX = 0.8;

/** [r, g, b, flags] of a material (flags as a plain number; rtScene writes it as u32 bits). */
export type RtMaterialRecord = readonly [number, number, number, number];

const cache = new WeakMap<THREE.Material, RtMaterialRecord>();
const MEAN = new THREE.Color();
/** Images whose mean has been read (damage/sample.ts keeps the thumbnail: reading again is cheap). */
const read = new WeakSet<object>();

/** The diffuse share of a material: (1 - metalness) + metalness x roughness for the Standard family, 1 otherwise. */
export function rtDiffuseShare(m: THREE.Material): number {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return 1;
  const metal = Math.min(1, Math.max(0, s.metalness ?? 0)), rough = Math.min(1, Math.max(0, s.roughness ?? 1));
  return (1 - metal) + metal * rough;
}

/**
 * The record of `m`: linear diffuse albedo (see the file comment) and flags (RT_MAT_VERTEX_COLOR when the material multiplies by
 * vertex colours). `resolved` (out): ok false when the value is provisional (a map that a browser has not decoded yet, or a read
 * deferred: `deferred`). `opts.deferTexture`: do not read a decoded image not read before (the plain colour, deferred).
 */
export function rtMaterialRecord(m: THREE.Material, resolved?: {ok: boolean; deferred?: boolean}, opts?: {deferTexture?: boolean}): RtMaterialRecord {
  if (resolved) resolved.deferred = false;
  const hit = cache.get(m);
  if (hit) { if (resolved) resolved.ok = true; return hit; }
  const s = m as THREE.MeshStandardMaterial & {ofA?: unknown};
  let r = 1, g = 1, b = 1, ok = true, deferred = false;
  const own = s.userData?.lightAlbedo as readonly number[] | undefined;
  if (own && own.length >= 3 && own.every(v => Number.isFinite(v))) {
    r = own[0]; g = own[1]; b = own[2];
  } else if (s.ofA instanceof THREE.Color) {
    r = s.ofA.r * 0.9; g = s.ofA.g * 0.9; b = s.ofA.b * 0.9;
  } else {
    if (s.color instanceof THREE.Color) { r = s.color.r; g = s.color.g; b = s.color.b; }
    if (s.map) {
      const img = s.map.image as {width?: number} | null | undefined;
      if (opts?.deferTexture && img && img.width && typeof document !== 'undefined' && !read.has(img)) { ok = false; deferred = true; }
      else {
        const mean = textureMean(s.map, MEAN);
        if (img && img.width) read.add(img);
        if (mean) { r *= mean.r; g *= mean.g; b *= mean.b; }
        else if (typeof document !== 'undefined') ok = false; // (a browser that has not decoded the image yet: ask again later)
      }
    }
  }
  const share = rtDiffuseShare(m);
  const cap = (v: number): number => Math.min(RT_ALBEDO_MAX, Math.max(0, v)) * share;
  const rec: RtMaterialRecord = [cap(r), cap(g), cap(b), (m as THREE.MeshStandardMaterial).vertexColors ? RT_MAT_VERTEX_COLOR : 0];
  if (ok) cache.set(m, rec);
  if (resolved) { resolved.ok = ok; resolved.deferred = deferred; }
  return rec;
}

/** No character sends back more than this (world/flashOccluders.ts uses the same). */
const BODY_ALBEDO_MAX = 0.6;
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
let body: Float32Array | null = null;

/**
 * The linear albedo of a character's capsule: the worn-clothing damage class, exactly as world/flashOccluders.ts makes its
 * `bodyAlbedo` (the palette's mean drawn half way to its own grey, capped) — the flashlight bounce's FB path uses the same colour.
 */
export function rtBodyAlbedo(): Float32Array {
  if (body) return body;
  const palette = DAMAGE_MATERIALS.cloth.palette;
  if (!palette.length) return (body = new Float32Array([0.25, 0.25, 0.25])); // (flashOccluders' FLASH_PROP_GREY)
  let r = 0, g = 0, b = 0;
  for (const hex of palette) { r += linear((hex >> 16 & 255) / 255); g += linear((hex >> 8 & 255) / 255); b += linear((hex & 255) / 255); }
  const n = palette.length;
  r /= n; g /= n; b /= n;
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  body = new Float32Array([r, g, b].map(v => Math.min(BODY_ALBEDO_MAX, (v + grey) / 2)));
  return body;
}
