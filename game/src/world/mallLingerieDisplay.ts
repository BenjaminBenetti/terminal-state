// Task mall-lingerie-20261102 / store-polish-20261103 (lane STORE): renders the lingerie boutique's display stock from lane FIT's static meshes
// inside each design's outfit file (gen/mall/lingerieStore.ts LINGERIE_DISPLAY_SOURCE: the same prop-library key the store-local zombies
// wear). Called by world/officeProps.ts buildOfficeProp for one storey's placements of a kind; returns null while a file / node is missing
// (the procedural stand-in renders then).
//  - DRESSED MANNEQUINS (lingerieSet<Design> riders on `mannequinFemale`): the LingerieMannequin_<design>_top / _bottom nodes were fitted
//    offline to the female mannequin's own mesh in its LOCAL frame, so they draw under the mannequin prop's exact runtime transform:
//    the placement's x / z / yaw at the mannequin's base x FLIP (the office / mall GLBs face -Z) x officeProps' uniform fit k = min(def.w /
//    size.x, def.d / size.z) x the model's bounds centred in x / z with its lowest point on the floor (read from the loaded mannequin model;
//    its measured bounds are centred, so the fallback is the identity).
//  - HANGING STOCK (lingerieRackRow on a garment rail / clothing bay, lingerieRackRing on a round rack): LingerieHang_<design>_top / _bottom
//    items (lace garment + its hanger; origin = the hook's contact point on the rail, +Y up, front +Z; extras lingerieHang {widthM, dropM})
//    hung face-out along the rail line / round the ring, the designs / pieces / pattern from the rider's stock code (rackStock).
// Static, unskinned, one InstancedMesh per mesh primitive per storey and kind, named prop-<kind> (the damage / physics render index maps
// every instance to its rider, so the stock rides its host). Geometry / materials stay owned by the model library.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {GARMENT_RAIL_Y, LINGERIE_RACK, LINGERIE_SET_Y0} from '../gen/mall/kinds';
import {LINGERIE_DISPLAY_SOURCE, lingerieSetDesign, rackStock} from '../gen/mall/lingerieStore';

const UP = new THREE.Vector3(0, 1, 0);
type Lib = Readonly<Record<string, GLTF | undefined>>;

/** Is `kind` one of the store's display-stock kinds (dressed sets, hanging stock)? */
export const isLingerieStockKind = (kind: string): boolean => lingerieSetDesign(kind) !== undefined || kind === 'lingerieRackRow' || kind === 'lingerieRackRing';

/** The meshes under the named nodes of a file (world matrices relative to its scene), or null when a node is missing. */
function nodeMeshes(gltf: GLTF | undefined, names: readonly string[], all = true): {node: THREE.Object3D; meshes: THREE.Mesh[]}[] | null {
  if (!gltf) return null;
  gltf.scene.updateMatrixWorld(true);
  const out: {node: THREE.Object3D; meshes: THREE.Mesh[]}[] = [];
  for (const name of names) {
    const node = gltf.scene.getObjectByName(name);
    if (!node) { if (all) return null; continue; }
    const meshes: THREE.Mesh[] = [];
    node.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(m); });
    if (meshes.length) out.push({node, meshes});
  }
  return out.length ? out : null;
}

/** Instances `per mesh` matrices: one InstancedMesh per mesh primitive. */
function emit(group: THREE.Group, batches: Map<THREE.Mesh, THREE.Matrix4[]>, kind: PropKind, level: number): void {
  for (const [mesh, mats] of batches) {
    if (!mats.length) continue;
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.name = `prop-${kind}`;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
}

/** The mannequin model's runtime fit (officeProps buildOfficeProp + builder addInstancedModel): FLIP x scale k x centring. */
function mannequinFit(lib: Lib): THREE.Matrix4 {
  const flip = new THREE.Matrix4().makeRotationY(Math.PI);
  const g = lib[LINGERIE_DISPLAY_SOURCE.mannequinModelKey];
  if (!g) return flip;
  g.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const def = PROP_DEFS.mannequinFemale;
  const k = Math.min(def.w / size.x, def.d / size.z);
  if (!(k > 0) || !Number.isFinite(k)) return flip;
  return flip.multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
}

/** Instances the store stock of `kind` on every placement of `list` (one storey). Null when unavailable (stand-in). */
export function buildLingerieDisplay(group: THREE.Group, kind: PropKind, list: readonly PropPlacement[], lib: Lib, level: number, layout?: StationLayout): number | null {
  if (!list.length) return null;
  const design = lingerieSetDesign(kind);
  if (design) {
    const nodes = nodeMeshes(lib[LINGERIE_DISPLAY_SOURCE.modelKey(design)], LINGERIE_DISPLAY_SOURCE.mannequinNodes(design), false);
    if (!nodes) return null;
    const fit = mannequinFit(lib), batches = new Map<THREE.Mesh, THREE.Matrix4[]>();
    for (const p of list) {
      const base = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - LINGERIE_SET_Y0, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1)).multiply(fit);
      for (const {meshes} of nodes) for (const m of meshes) { let l = batches.get(m); if (!l) batches.set(m, (l = [])); l.push(new THREE.Matrix4().multiplyMatrices(base, m.matrixWorld)); }
    }
    emit(group, batches, kind, level);
    return list.length;
  }
  if (kind !== 'lingerieRackRow' && kind !== 'lingerieRackRing') return null;
  // hanging stock: every design used must have both items
  const items = new Map<string, {meshes: THREE.Mesh[]; width: number}>();
  for (const p of list) {
    const r = rackStock(p.variant);
    for (const d of [r.a, r.b]) for (const piece of ['top', 'bottom'] as const) {
      const key = `${d}:${piece}`;
      if (items.has(key)) continue;
      const nodes = nodeMeshes(lib[LINGERIE_DISPLAY_SOURCE.modelKey(d)], [LINGERIE_DISPLAY_SOURCE.hangNodes(d)[piece === 'top' ? 0 : 1]]);
      if (!nodes) return null;
      const ex = (nodes[0].node.userData as {lingerieHang?: {widthM?: number}}).lingerieHang;
      const box = new THREE.Box3();
      for (const m of nodes[0].meshes) box.expandByObject(m);
      items.set(key, {meshes: nodes[0].meshes, width: ex?.widthM ?? box.getSize(new THREE.Vector3()).x});
    }
  }
  const batches = new Map<THREE.Mesh, THREE.Matrix4[]>();
  const put = (base: THREE.Matrix4, key: string, x: number, z: number, yaw: number) => {
    const it = items.get(key)!;
    const at = new THREE.Matrix4().multiplyMatrices(base, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1)));
    for (const m of it.meshes) { let l = batches.get(m); if (!l) batches.set(m, (l = [])); l.push(new THREE.Matrix4().multiplyMatrices(at, m.matrixWorld)); }
  };
  for (const p of list) {
    const host = layout && p.host !== undefined ? layout.props[p.host] : undefined;
    const r = rackStock(p.variant);
    // the rail line: the rider box's top (rail height above the host base)
    const rail = host ? (GARMENT_RAIL_Y[host.kind as keyof typeof GARMENT_RAIL_Y] ?? LINGERIE_RACK.drop) - (p.y - host.y) : LINGERIE_RACK.drop;
    const base = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + rail, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
    const pattern = r.seed % 3;
    const keyOf = (i: number, n: number) => {
      const d = i < n / 2 ? r.a : r.b;
      const piece = pattern === 0 ? (i % 2 ? 'bottom' : 'top') : pattern === 1 ? (i % Math.max(1, Math.ceil(n / 2)) < Math.ceil(n / 4) ? 'top' : 'bottom') : (i < n / 2 ? 'top' : 'bottom');
      return `${d}:${piece}`;
    };
    const gap = 0.04;
    if (kind === 'lingerieRackRow') {
      const half = (host ? LINGERIE_RACK.row[host.kind as keyof typeof LINGERIE_RACK.row] : undefined) ?? 0.66;
      // face-out along the rail: as many as fit, centred
      const seq: string[] = [];
      let used = 0;
      for (let i = 0; i < 24; i++) {
        const k = keyOf(i, 8), w = items.get(k)!.width + gap;
        if (used + w > 2 * half) break;
        seq.push(k); used += w;
      }
      let x = -used / 2;
      for (const k of seq) { const w = items.get(k)!.width + gap; put(base, k, x + w / 2, 0, 0); x += w; }
    } else {
      const R = (host ? LINGERIE_RACK.ring[host.kind as keyof typeof LINGERIE_RACK.ring] : undefined) ?? 0.5;
      const wMax = Math.max(...[...items.values()].map(v => v.width)) + gap;
      const n = Math.max(3, Math.min(12, Math.floor((2 * Math.PI * R) / wMax)));
      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2 + (r.seed % 7) * 0.1;
        put(base, keyOf(i, n), R * Math.cos(th), R * Math.sin(th), Math.PI / 2 - th);
      }
    }
  }
  emit(group, batches, kind, level);
  return list.length;
}
