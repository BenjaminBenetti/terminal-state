// Task studio-baked-lighting-reflections-20261114-050258-01: which materials show the station's cached reflection probes
// (world/reflectionNode.ts) — the TAG a material may carry, as a leaf module (no TSL: the material factories import it).
//
// The tag is an OWN STRING PROPERTY of the material, on purpose. three r186 shares one compiled program between every material
// with the same cache key (RenderObject.getMaterialCacheKey), and that key leaves out `userData`, `name` and `opacity` and reduces
// every number to on / off. A choice made while a program is built must therefore only read what the key holds — or two materials
// that share a program would get whichever choice was built first. A string property is part of the key as its text: a tagged
// material never shares a program with an untagged one or one tagged otherwise.

import type * as THREE from 'three';

export type ReflectClass = 'none' | 'metal' | 'glass' | 'window' | 'gloss' | 'cab';

/** The property name (also what a clone must carry over: SurfaceNodeMaterial.copy does; a plain three clone does not). */
export const REFLECT_PROP = 'reflectProbes';

/**
 * Say how a material shows the probes: 'glass' (a see-through pane: always, by its Fresnel), 'window' (a glass pane set INSIDE
 * its wall's own cell, like the tower windows: glass that reads the field and the probes one cell out along its normal, where the
 * room is), 'metal' (by its metalness and roughness), 'gloss' (a glossy NON-metal — the glazed wall tile: only with the High
 * probes, by its Fresnel, fading out toward rough texels; task studio-graphics-gpu-materials-toggle-20261114-212239-01), 'cab' (the
 * see-through glass of a moving cab — the player train's windows and door leaves, the glass lift: the probes by its own Fresnel
 * only, never the live glass mirror nor the station glazing's pane boost; task train-glass-reflection-fix-20261115-213533) or
 * 'none' (never: the station's floor / ceiling / slab sets, whose packed maps are not metal). Tag a material before it is first
 * drawn. Returns the material.
 */
export function tagReflect<M extends THREE.Material>(m: M, cls: ReflectClass): M {
  (m as unknown as Record<string, unknown>)[REFLECT_PROP] = cls;
  return m;
}

/** A material's tag (undefined: untagged — world/reflectionNode.ts reflectClass decides from its kind). */
export function reflectTagOf(m: THREE.Material | null | undefined): ReflectClass | undefined {
  const v = (m as unknown as Record<string, unknown> | null | undefined)?.[REFLECT_PROP];
  return v === 'none' || v === 'metal' || v === 'glass' || v === 'window' || v === 'gloss' || v === 'cab' ? v : undefined;
}
