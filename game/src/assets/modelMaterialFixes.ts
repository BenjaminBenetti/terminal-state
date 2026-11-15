// Task studio-pbr-material-pass-20261115-192427-01 (PBR material pass): material FACTOR corrections of loaded models whose generated
// maps contradict the object's plain, single substance. The cooked GLB, its maps and its provenance stay exactly as they are (a Meshy
// model keeps its own maps); only the material's factor, which multiplies a map, is set as the model is loaded — before anything
// draws it, like the glass tag (loader.ts tagModelGlass). Only for models that are ONE substance family throughout: a mixed model
// (metal hardware on a wooden body, a chrome base under a fabric seat ...) is never overwritten here; an unclear case is reported,
// not listed.

import type * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

export interface ModelMaterialFix {
  /** The metallic factor (multiplies the model's metalness map). */
  metalness: number;
  /** Why: the substance and what the map says instead. */
  why: string;
}

/** Model key (MODEL_FILES / the lazy catalogue) -> correction of every material of the model. */
export const MODEL_MATERIAL_FIXES: Readonly<Record<string, ModelMaterialFix>> = {
  item_ramen_chashu: {
    metalness: 0,
    why: 'chashu ramen in a white glazed bowl (food + ceramic): the source map paints bowl, broth and toppings ~0.9 metal at roughness ~0.1, '
      + 'a near-black mirror wherever no reflection probe is bound; the other ramen bowl, the bento and the bubble tea carry no metal map (factor 0)',
  },
};

/** Apply the model's correction (if any) to every material of `g`. Returns how many materials changed. */
export function applyModelMaterialFix(key: string, g: GLTF): number {
  const fix = MODEL_MATERIAL_FIXES[key];
  if (!fix) return 0;
  let n = 0;
  const seen = new Set<THREE.Material>();
  g.scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const s = m as THREE.MeshStandardMaterial;
      if (!s?.isMeshStandardMaterial || seen.has(s)) continue;
      seen.add(s);
      s.metalness = fix.metalness;
      n++;
    }
  });
  return n;
}
