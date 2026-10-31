// Task mall-playtest-revision-20261031 (lane FIX, U08): every architectural floor / wall / ceiling material of a built world
// requests 16x anisotropy on its surface maps (render/anisotropy.ts), whatever created it.
//
// "Architectural" = the materials the 30-year decay hook ages (world/decay.ts applyDecay: station walls / floors / ceilings,
// storefront-unit finishes, office surfaces, mall surfaces) — by that module's own definition walls, floors and ceilings only
// (props, trim, signs, track, shelf stock never age). The loaded / canvas sources already ask at creation (assets/loader.ts,
// officeAssets.ts, world/materials.ts, decay.ts, wallDetailAtlas.ts); this pass catches maps assigned later (office canvas
// stand-ins re-valued per build, shop-finish copies) before the level's first frame / warm-up, so nothing is re-uploaded in play.
// Thin-trim clones (materials.ts thinTrim, 1x) are never decayed and are not touched.

import * as THREE from 'three';
import {requestMaterialAnisotropy, type SurfaceRole} from '../render/anisotropy';
import {DECAY_PROFILES, type DecayProfile} from './decay';

const WALL_KEYS = ['tileLower', 'tileUpper', 'tileBase', 'tileShop', 'paint', 'tunnel', 'platformFace'] as const;
const FLOOR_KEYS = ['terrazzo', 'concrete', 'platformSlab', 'safetyEdge', 'quarryTile', 'ballast'] as const;
const CEIL_KEYS = ['ceiling', 'ceilingService'] as const;
const PROFILE_ROLE = new Map<DecayProfile, SurfaceRole>([
  ...WALL_KEYS.map(k => [DECAY_PROFILES[k], 'wall'] as const),
  ...FLOOR_KEYS.map(k => [DECAY_PROFILES[k], 'floor'] as const),
  ...CEIL_KEYS.map(k => [DECAY_PROFILES[k], 'ceiling'] as const),
]);

const isKind = (v: unknown): v is 'wall' | 'floor' | 'ceiling' => v === 'wall' || v === 'floor' || v === 'ceiling';

/** Surface role of a decayed (architectural) material, or null for a material the decay hook never touched. */
export function architectureRole(m: THREE.Material): SurfaceRole | null {
  const u = m.userData ?? {};
  if (!u.decay) return null;
  if (isKind(u.officeArch)) return u.officeArch;
  if (isKind(u.mallSurface)) return u.mallSurface;
  return PROFILE_ROLE.get(u.decay as DecayProfile) ?? 'architecture';
}

/** Requests 16x on every surface map of every decayed material under `root`. Returns the counts (QA / tests). */
export function requestArchitectureAnisotropy(root: THREE.Object3D): {materials: number; textures: number} {
  const mats = new Set<THREE.Material>(), texs = new Set<THREE.Texture>();
  root.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (mats.has(mat)) continue;
      const role = architectureRole(mat);
      if (!role) continue;
      mats.add(mat);
      for (const t of requestMaterialAnisotropy(mat, role)) texs.add(t);
    }
  });
  return {materials: mats.size, textures: texs.size};
}
