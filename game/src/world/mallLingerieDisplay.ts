// Task mall-lingerie-20261102 (lane STORE): renders the lingerie boutique's display sets from lane FIT's static display meshes — the
// unskinned `LingerieDisplay_<design>_top` / `_bottom` nodes inside the design's outfit file (gen/mall/lingerieStore.ts
// LINGERIE_DISPLAY_SOURCE: the same prop-library key the store-local zombies wear). Called by world/officeProps.ts buildOfficeProp for the
// set kinds; returns null while the file is not loaded (or has no display nodes) — the procedural stand-in renders then.
//
// Frame (lane FIT c1a3816, measured on the files): each display node is an unskinned mesh at REAL worn size (the set as fitted on a pale
// body), front +Z; its vertices are in body space and its translation centres the set's bounds in x / z with the lowest point at y 0;
// extras `lingerieDisplay.toBodySpace` is the OFFSET back to body space (translation + toBodySpace = 0). Drawn on the display form's
// origin (its base: the set placement's y - LINGERIE_SET_Y0) at its worn HEIGHT (translation y + toBodySpace y) and CENTRED in x / z (the
// node's own centring translation: the form is centred under the set), unscaled. Without the extras: the nodes' union bounds stand on the
// set placement's base, centred. Geometry / materials stay owned by the model library.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {PropKind, PropPlacement} from '../gen/props';
import {LINGERIE_SET_Y0} from '../gen/mall/kinds';
import {LINGERIE_DISPLAY_SOURCE, lingerieSetDesign} from '../gen/mall/lingerieStore';

const UP = new THREE.Vector3(0, 1, 0);

/** Is `kind` one of the lingerie display sets? */
export const isLingerieSetKind = (kind: string): boolean => lingerieSetDesign(kind) !== undefined;

/** Instances the display meshes of `kind`'s design on every placement of `list` (one storey). Null when unavailable (stand-in). */
export function buildLingerieDisplay(group: THREE.Group, kind: PropKind, list: readonly PropPlacement[], lib: Readonly<Record<string, GLTF | undefined>>, level: number): number | null {
  const design = lingerieSetDesign(kind);
  const gltf = design ? lib[LINGERIE_DISPLAY_SOURCE.modelKey(design)] : undefined;
  if (!design || !gltf || !list.length) return null;
  const names = new Set<string>(LINGERIE_DISPLAY_SOURCE.nodes(design));
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse(o => {
    if (!names.has(o.name)) return;
    o.traverse(m => { const mesh = m as THREE.Mesh; if (mesh.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !meshes.includes(mesh)) meshes.push(mesh); });
  });
  if (!meshes.length) return null;
  // body-space matrix of each mesh: its display node moved to toBodySpace (fallback: the union bounds' bottom on the set's base)
  const box = new THREE.Box3();
  for (const m of meshes) box.expandByObject(m);
  const c = box.getCenter(new THREE.Vector3());
  const fallback = new THREE.Matrix4().makeTranslation(-c.x, LINGERIE_SET_Y0 - box.min.y, -c.z);
  const bodyOf = (mesh: THREE.Mesh): THREE.Matrix4 => {
    let node: THREE.Object3D | null = mesh;
    while (node && !names.has(node.name)) node = node.parent;
    const t = (node?.userData as {lingerieDisplay?: {toBodySpace?: readonly number[]}} | undefined)?.lingerieDisplay?.toBodySpace;
    if (!node || !t || t.length < 3) return new THREE.Matrix4().multiplyMatrices(fallback, mesh.matrixWorld);
    // the node at its worn height (+ toBodySpace y), still centred in x / z (under its parent), then the mesh below the node
    const nodeLocal = new THREE.Matrix4().compose(new THREE.Vector3(node.position.x, node.position.y + t[1], node.position.z), node.quaternion, node.scale);
    const nodeBody = node.parent ? new THREE.Matrix4().multiplyMatrices(node.parent.matrixWorld, nodeLocal) : nodeLocal;
    const below = new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(mesh.matrixWorld);
    return nodeBody.multiply(below);
  };
  const turn = LINGERIE_DISPLAY_SOURCE.turn ? new THREE.Matrix4().makeRotationY(Math.PI) : new THREE.Matrix4();
  // the display form's origin (its base) under each set placement
  const placements = list.map(p => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - LINGERIE_SET_Y0, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1)));
  const m = new THREE.Matrix4();
  for (const mesh of meshes) {
    const local = new THREE.Matrix4().multiplyMatrices(turn, bodyOf(mesh));
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length);
    placements.forEach((p, i) => im.setMatrixAt(i, m.multiplyMatrices(p, local)));
    im.name = `prop-${kind}`;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
  return list.length;
}
