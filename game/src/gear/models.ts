// Iteration 16 (lane GEAR): world / icon models of the gear items. The lane-ASSETS Meshy T2.5 derivatives A1–A6
// (assets/officeAssets.ts: gear-armor-vest … gear-gloves) are used once delivered; until then (url null) or when a file
// fails, a small procedural stand-in of primitives is used (asset-method rule: simple shapes may be geometry).
//
// Frame of every template (same as world/pickups.ts item models): origin bottom-centre, front +Z, metres. The office
// derivatives face -Z, so they are turned half a turn. They keep their generated pose: the vest, rig and backpack stand
// upright (they are shaped 3D pieces — laid on their back they would be a 0.4 m hump), hat and boots stand, the gloves
// lie flat.
//
// preloadGearModels() is awaited before the icon renders (ui/itemIcons.ts), so the very first template (icons, pickups,
// grounded bags, warm-up prototypes) already uses the delivered model; templates are cached by world/pickups.ts.
//
// Task gasmask-breach-20261030 (mask lane): the GAS MASK item reuses the shipped zombie outfit model (assets/manifest.ts
// `outfit_gasmask` = assets/models/outfit-gasmask-t25.glb, part of the main asset load): its mesh `Outfit_gasmask__lastshift`
// (fitted to the lastshift body) is made STATIC (skin attributes dropped, bind pose baked), re-centred to the item frame (origin
// bottom-centre, +Z front — the outfit already faces +Z — metres) and kept at its real size (fitted only if grossly mis-scaled).
// Provenance, unchanged: the model was delivered by the authorized Meshy T2.5 replacement (garment:gasmask, review accepted in
// that migration's DELIVERED.json); its derivative record (assets/derivatives/outfit-gasmask.json) still says approved: false,
// gameReady: false and no licence clearance — delivery acceptance is not legal clearance. world/pickups.ts registerItemModels hands
// it over; without it (Node tests, a failed file) a procedural stand-in is used. Nothing new was generated.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {loadOfficeAsset, OFFICE_ASSETS, type OfficeAssetId} from '../assets/officeAssets';
import {GEAR_DIMS, GEAR_IDS} from '../items/gear';

/** Mask lane: the outfit mesh used as the gas-mask item (the lastshift fit: the default body's proportions). */
export const GAS_MASK_OUTFIT_MESH = 'Outfit_gasmask__lastshift';
let maskOutfit: GLTF | null = null;

/** Mask lane: the loaded zombie outfit GLTF (main assets `outfit_gasmask`) or null. Call before the mask's template is first built. */
export function registerGasMaskOutfit(gltf: GLTF | null | undefined): void {
  maskOutfit = gltf ?? null;
}

export const GEAR_ASSET: Readonly<Record<string, OfficeAssetId>> = {
  armor_vest: 'gear-armor-vest', chest_rig: 'gear-chest-rig', backpack: 'gear-backpack',
  helmet: 'gear-helmet', boots: 'gear-boots', gloves: 'gear-gloves',
};

const loaded = new Map<string, GLTF>();
let preload: Promise<void> | null = null;

/** Loads the delivered gear derivatives once (missing / failed ones keep the procedural model). Never rejects. */
export function preloadGearModels(): Promise<void> {
  preload ??= Promise.all(GEAR_IDS.map(async id => {
    const key = GEAR_ASSET[id];
    if (!key || !OFFICE_ASSETS[key]?.url) return;
    const g = await loadOfficeAsset(key);
    if (g) loaded.set(id, g);
  })).then(() => undefined, () => undefined);
  return preload;
}

/** Use an already-loaded model for a gear item (tests; a future tier's preload). Call before its template is first built. */
export function registerGearModel(itemId: string, gltf: GLTF | null): void {
  if (gltf) loaded.set(itemId, gltf); else loaded.delete(itemId);
}

/** 'office-gear-… (Meshy T2.5 derivative)' or 'procedural stand-in' (QA / item model report). */
export function gearModelSource(itemId: string): string {
  if (itemId === 'gas_mask' && maskOutfit) return `assets/models/outfit-gasmask-t25.glb ${GAS_MASK_OUTFIT_MESH} (shipped zombie outfit made static; Meshy T2.5 delivery review accepted; derivative record approved: false, no licence clearance)`;
  return loaded.has(itemId) ? `assets/officeAssets.ts ${GEAR_ASSET[itemId]} (Meshy T2.5 derivative)` : 'procedural gear stand-in (gear/models.ts)';
}

/** Icon camera for a gear item (ui/itemIcons.ts): upright pieces from the front three-quarter, the flat gloves from above. */
export function gearIconView(itemId: string): {az: number; el: number} {
  const D = Math.PI / 180;
  if (!loaded.has(itemId) && (itemId === 'armor_vest' || itemId === 'chest_rig')) return {az: 18 * D, el: 58 * D}; // flat stand-ins
  if (itemId === 'gloves') return {az: 24 * D, el: 52 * D};
  if (itemId === 'helmet') return {az: 32 * D, el: 26 * D};
  if (itemId === 'boots') return {az: 38 * D, el: 22 * D};
  return {az: 24 * D, el: 12 * D};
}

/** A fresh template object for a gear item (the caller caches / clones it). */
export function gearItemModel(itemId: string): THREE.Object3D {
  if (itemId === 'gas_mask' && maskOutfit) {
    try { return fitMaskOutfit(maskOutfit); } catch (err) { console.warn('gear model gas_mask: outfit mesh unusable, using the stand-in', err); }
  }
  const gltf = loaded.get(itemId);
  if (gltf) {
    try { return fitDerivative(gltf, itemId); } catch (err) { console.warn(`gear model ${itemId}: derivative unusable, using the stand-in`, err); }
  }
  return proceduralGear(itemId);
}

/**
 * Mask lane: the zombie outfit's gas mask as a static item. The skinned mesh's bind pose IS its rest pose in the outfit's model
 * space (head height, facing +Z), so its world matrix is baked into a geometry copy without the skin attributes; then it is
 * re-centred (bottom-centre origin) and only a grossly mis-scaled file is fitted to GEAR_DIMS.gas_mask.
 */
function fitMaskOutfit(gltf: GLTF): THREE.Object3D {
  gltf.scene.updateMatrixWorld(true);
  let src: THREE.Mesh | null = null;
  gltf.scene.traverse(o => { if (!src && (o as THREE.Mesh).isMesh && o.name === GAS_MASK_OUTFIT_MESH) src = o as THREE.Mesh; });
  const mesh = src as THREE.Mesh | null;
  if (!mesh) throw new Error(`${GAS_MASK_OUTFIT_MESH} not in the outfit file`);
  const geo = mesh.geometry.clone();
  for (const a of ['skinIndex', 'skinWeight']) if (geo.getAttribute(a)) geo.deleteAttribute(a);
  geo.applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  if (box.isEmpty()) throw new Error('empty mask mesh');
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const d = GEAR_DIMS.gas_mask, longest = Math.max(size.x, size.y, size.z), want = Math.max(d.w, d.d, d.h);
  const s = longest > 0 && (longest > want * 2 || longest < want / 2) ? want / longest : 1;
  geo.translate(-c.x, -box.min.y, -c.z);
  if (s !== 1) geo.scale(s, s, s);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const m0 = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const mat = m0.clone(); // its own copy: the wardrobe's outfit material stays untouched
  mat.name = 'gear-gas_mask';
  const out = new THREE.Mesh(geo, mat);
  out.name = 'gear-gas_mask';
  out.castShadow = false;
  out.receiveShadow = true;
  const root = new THREE.Group();
  root.add(out);
  return root;
}

function fitDerivative(gltf: GLTF, itemId: string): THREE.Object3D {
  const src = gltf.scene.clone(true);
  const turn = new THREE.Group();
  turn.add(src);
  turn.rotation.y = Math.PI; // derivative front -Z -> item front +Z
  const lay = new THREE.Group();
  lay.add(turn);
  const root = new THREE.Group();
  root.add(lay);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('empty model');
  const size = box.getSize(new THREE.Vector3());
  // the derivative is at real size; only a grossly mis-scaled file is fitted to the item's resting dims
  const d = GEAR_DIMS[itemId];
  const longest = Math.max(size.x, size.y, size.z), want = d ? Math.max(d.w, d.d, d.h) : longest;
  const s = longest > 0 && (longest > want * 2 || longest < want / 2) ? want / longest : 1;
  const c = box.getCenter(new THREE.Vector3());
  lay.scale.setScalar(s);
  lay.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
  return root;
}

// ---------------------------------------------------------------------------------------------------------------------
// Procedural stand-ins: one merged vertex-coloured mesh per item, one shared material.

let standinMat: THREE.MeshStandardMaterial | null = null;
function gearMat(): THREE.MeshStandardMaterial {
  standinMat ??= new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.88, metalness: 0.02});
  standinMat.name = 'gear-standin';
  return standinMat;
}

function tinted(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  const n = geo.attributes.position.count, c = new THREE.Color(color), arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}
const box = (w: number, h: number, d: number, x: number, y0: number, z: number, color: number, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y0 + h / 2, z);
  return tinted(g, color);
};

function proceduralGear(itemId: string): THREE.Object3D {
  const P: THREE.BufferGeometry[] = [];
  switch (itemId) {
    case 'armor_vest': { // lying on its back, collar toward -Z
      const navy = 0x2b3346, dark = 0x1d222e, tan = 0x8d826a;
      P.push(box(0.46, 0.06, 0.5, 0, 0, 0.04, navy));
      P.push(box(0.13, 0.045, 0.14, -0.15, 0.005, -0.27, navy), box(0.13, 0.045, 0.14, 0.15, 0.005, -0.27, navy)); // shoulders
      P.push(box(0.16, 0.012, 0.08, 0, 0.055, -0.19, dark)); // neck scoop shadow
      P.push(box(0.32, 0.03, 0.3, 0, 0.055, 0.05, 0x343d52)); // front plate pocket
      P.push(box(0.26, 0.008, 0.05, 0, 0.083, -0.07, tan)); // velcro name strip
      P.push(box(0.48, 0.02, 0.07, 0, 0.03, 0.25, dark)); // waist band
      break;
    }
    case 'chest_rig': { // flat panel with four pouches, straps toward -Z
      const olive = 0x4a5131, dark = 0x353a24, buckle = 0x222222;
      P.push(box(0.4, 0.03, 0.26, 0, 0, 0.1, olive));
      for (let i = 0; i < 4; i++) P.push(box(0.085, 0.07, 0.13, -0.135 + i * 0.09, 0.03, 0.09, i % 2 ? olive : 0x525a37), box(0.085, 0.012, 0.05, -0.135 + i * 0.09, 0.1, 0.04, dark));
      P.push(box(0.06, 0.02, 0.28, -0.12, 0, -0.16, dark), box(0.06, 0.02, 0.28, 0.12, 0, -0.16, dark)); // shoulder straps
      P.push(box(0.05, 0.03, 0.03, -0.12, 0.01, -0.02, buckle), box(0.05, 0.03, 0.03, 0.12, 0.01, -0.02, buckle));
      break;
    }
    case 'backpack': { // standing, front pocket +Z, straps on the back (-Z)
      const red = 0x8e2f2a, deep = 0x6e2420, grey = 0x3a3c3e, strap = 0x262626;
      P.push(box(0.3, 0.4, 0.19, 0, 0, 0, red));
      const top = new THREE.CylinderGeometry(0.095, 0.095, 0.3, 14, 1, false, 0, Math.PI);
      top.rotateZ(Math.PI / 2); top.rotateX(Math.PI / 2); top.translate(0, 0.4, 0);
      P.push(tinted(top, red));
      P.push(box(0.23, 0.17, 0.05, 0, 0.05, 0.115, deep)); // front pocket
      P.push(box(0.2, 0.012, 0.012, 0, 0.215, 0.14, grey)); // zip
      P.push(box(0.04, 0.2, 0.15, -0.165, 0.03, 0, grey), box(0.04, 0.2, 0.15, 0.165, 0.03, 0, grey)); // side mesh pockets
      P.push(box(0.05, 0.36, 0.025, -0.08, 0.05, -0.105, strap), box(0.05, 0.36, 0.025, 0.08, 0.05, -0.105, strap)); // shoulder straps
      P.push(box(0.09, 0.02, 0.025, 0, 0.485, -0.02, strap)); // top handle
      break;
    }
    case 'helmet': { // hard hat
      const yellow = 0xb8922a, dirt = 0x8a6d22;
      const dome = new THREE.SphereGeometry(0.125, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.scale(1, 1.05, 1.15); dome.translate(0, 0.022, 0);
      P.push(tinted(dome, yellow));
      const brim = new THREE.CylinderGeometry(0.142, 0.148, 0.018, 20);
      brim.scale(1, 1, 1.14); brim.translate(0.0, 0.015, 0.012);
      P.push(tinted(brim, dirt));
      P.push(box(0.03, 0.02, 0.27, 0, 0.13, 0, yellow, 0, 0, 0)); // ridge
      P.push(box(0.012, 0.01, 0.22, -0.11, 0.0, 0.0, 0x2a2a2a), box(0.012, 0.01, 0.22, 0.11, 0.0, 0.0, 0x2a2a2a)); // chin strap ends
      break;
    }
    case 'boots': {
      const leather = 0x5a3b24, sole = 0x1e1b18, lace = 0x8c7b5c;
      for (const sx of [-0.068, 0.068]) {
        P.push(box(0.105, 0.03, 0.3, sx, 0, 0.0, sole));
        P.push(box(0.095, 0.075, 0.25, sx, 0.03, 0.02, leather));
        P.push(box(0.092, 0.13, 0.12, sx, 0.09, -0.07, leather));
        P.push(box(0.03, 0.006, 0.12, sx, 0.106, 0.04, lace));
      }
      break;
    }
    case 'gloves': {
      const palm = 0x9c7a50, back = 0x6b6a5a;
      for (const [sx, yaw] of [[-0.055, 0.25], [0.06, -0.2]] as const) {
        const parts: THREE.BufferGeometry[] = [box(0.085, 0.022, 0.1, 0, 0, 0, back), box(0.09, 0.03, 0.06, 0, 0, -0.075, palm)];
        for (let f = 0; f < 4; f++) parts.push(box(0.017, 0.018, 0.07, -0.03 + f * 0.02, 0.002, 0.08, back));
        parts.push(box(0.018, 0.018, 0.055, 0.055, 0.002, 0.01, palm, 0, -0.6, 0));
        const g = mergeGeometries(parts, false);
        for (const p of parts) p.dispose();
        g.rotateY(yaw); g.translate(sx, 0, 0);
        P.push(g);
      }
      break;
    }
    case 'gas_mask': { // mask lane stand-in: rubber face piece standing on its chin, wide visor and chin filter facing +Z
      const rubber = 0x1f2221, rim = 0x111312, glass = 0x6b7a70, olive = 0x4b5133, strap = 0x2a2c2a;
      const face = new THREE.SphereGeometry(0.088, 18, 12);
      face.scale(1, 1.03, 0.7); face.translate(0, 0.092, 0);
      P.push(tinted(face, rubber));
      P.push(box(0.142, 0.068, 0.02, 0, 0.085, 0.045, rim)); // visor frame
      P.push(box(0.124, 0.052, 0.012, 0, 0.093, 0.056, glass)); // visor glass
      P.push(box(0.022, 0.016, 0.014, 0, 0.083, 0.059, rim)); // nose-bridge dip
      const can = new THREE.CylinderGeometry(0.03, 0.03, 0.032, 16);
      can.rotateX(Math.PI / 2); can.translate(0, 0.036, 0.07);
      P.push(tinted(can, olive));
      P.push(box(0.015, 0.012, 0.11, -0.078, 0.085, -0.03, strap), box(0.015, 0.012, 0.11, 0.078, 0.085, -0.03, strap)); // head straps
      break;
    }
    default:
      P.push(box(0.2, 0.2, 0.2, 0, 0, 0, 0x777777));
  }
  const merged = mergeGeometries(P, false);
  for (const g of P) g.dispose();
  merged.computeBoundingSphere();
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(merged, gearMat());
  mesh.name = `gear-${itemId}`;
  root.add(mesh);
  return root;
}
