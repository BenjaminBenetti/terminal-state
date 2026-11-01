// The aimed-target highlight shared by the loot holders / openables (world/containers.ts setHighlight: drawers, doors, lids, crates)
// and, task train-shell-followup-20261101-221246 (lane TRAIN), the player train's aimed door pair (world/playerTrain.ts). One style:
// the aimed meshes swap their material for a cached clone of it (cloneSurfaceMaterial: node hooks kept) whose emissive pulses warm.

import * as THREE from 'three';
import {cloneSurfaceMaterial} from './materials';

/** The highlight glow of every highlight clone at game time `time` (s). */
export function highlightPulse(mats: Iterable<THREE.MeshStandardMaterial>, time: number): void {
  const k = 0.06 + 0.035 * Math.sin(time * 6);
  for (const m of mats) m.emissive.setRGB(k, k * 0.85, k * 0.5);
}

/** The highlight clone of `base` from `cache` (made once per base); null for a material that never highlights (non-standard / glass). */
export function highlightMaterial(cache: Map<THREE.Material, THREE.MeshStandardMaterial>, base: THREE.Material): THREE.MeshStandardMaterial | null {
  if (!(base as THREE.MeshStandardMaterial).isMeshStandardMaterial || base.transparent) return null;
  let hi = cache.get(base);
  if (!hi) { hi = cloneSurfaceMaterial(base as THREE.MeshStandardMaterial); cache.set(base, hi); }
  return hi;
}
