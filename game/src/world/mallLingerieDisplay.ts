// Task mall-lingerie-20261102 / store-polish-20261103 (lane STORE): renders the lingerie boutique's display stock from lane FIT's static meshes
// inside each design's outfit file (gen/mall/lingerieStore.ts LINGERIE_DISPLAY_SOURCE: the same prop-library key the store-local zombies
// wear). Called by world/officeProps.ts buildOfficeProp for one storey's placements of a kind; returns null while a file / node is missing
// (the procedural stand-in renders then).
//  - DRESSED MANNEQUINS (lingerieSet<Design> riders on `mannequinFemale`): the LingerieMannequin_<design>_top / _bottom nodes were fitted
//    offline to the female mannequin's own mesh in its LOCAL frame, so they draw under the mannequin prop's exact runtime transform:
//    the placement's x / z / yaw at the mannequin's base x FLIP (the office / mall GLBs face -Z) x officeProps' uniform fit k = min(def.w /
//    size.x, def.d / size.z) x the model's bounds centred in x / z with its lowest point on the floor (read from the loaded mannequin model;
//    its measured bounds are centred, so the fallback is the identity).
//  - HANGING STOCK (lingerieRackRow on a garment rail / clothing bay, lingerieRackRing on a round rack): LingerieHang_<design>_<item> items
//    (lace garment + its hanger; origin = the hook's contact point on the rail, +Y up, front +Z, hanger width along x) hooked SIDE-ON on
//    the rail line / round the ring (the hanger across the rail, as a hanger really hangs) at lane FIT's side-on pitch, the designs /
//    items / pattern from the rider's stock code (rackStock).
// Static, unskinned, one InstancedMesh per mesh primitive per storey and kind, named prop-<kind> (the damage / physics render index maps
// every instance to its rider, so the stock rides its host). Geometry / materials stay owned by the model library.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {LINGERIE_RACK, LINGERIE_SET_Y0} from '../gen/mall/kinds';
import {LINGERIE_DISPLAY_SOURCE, lingerieSetDesign, rackStock} from '../gen/mall/lingerieStore';

const UP = new THREE.Vector3(0, 1, 0);
/** Side-on pitch along a rail = lane FIT's spacingSideOnM x this (a shop rack with room to browse, not crammed). */
const PACK = 1.05;
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
  // hanging stock: every item of every design used must be in its file
  const items = new Map<string, {meshes: THREE.Mesh[]; pitch: number}[]>();
  for (const p of list) {
    const r = rackStock(p.variant);
    for (const d of [r.a, r.b]) {
      if (items.has(d)) continue;
      const defs = LINGERIE_DISPLAY_SOURCE.hangItems(d);
      if (!defs.length) return null;
      const got: {meshes: THREE.Mesh[]; pitch: number}[] = [];
      for (const def of defs) {
        const nodes = nodeMeshes(lib[LINGERIE_DISPLAY_SOURCE.modelKey(d)], [def.node]);
        if (!nodes) return null;
        got.push({meshes: nodes[0].meshes, pitch: Math.max(0.06, def.spacingSideOnM * PACK)});
      }
      items.set(d, got);
    }
  }
  const batches = new Map<THREE.Mesh, THREE.Matrix4[]>();
  const put = (base: THREE.Matrix4, it: {meshes: THREE.Mesh[]}, x: number, z: number, yaw: number) => {
    const at = new THREE.Matrix4().multiplyMatrices(base, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1)));
    for (const m of it.meshes) { let l = batches.get(m); if (!l) batches.set(m, (l = [])); l.push(new THREE.Matrix4().multiplyMatrices(at, m.matrixWorld)); }
  };
  for (const p of list) {
    const host = layout && p.host !== undefined ? layout.props[p.host] : undefined;
    const r = rackStock(p.variant);
    // the rail line: the rider box's top (= the host's rail height)
    const base = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + p.h, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
    // the sequence along the rail: design A's items then design B's, each design's items alternating (pattern 0) or in blocks (1)
    const pattern = r.seed % 2;
    const pick = (k: number, n: number) => {
      const its = items.get(k < n / 2 ? r.a : r.b)!, j = k < n / 2 ? k : k - Math.ceil(n / 2);
      return its[pattern === 0 ? j % its.length : Math.min(its.length - 1, Math.floor(j * its.length / Math.max(1, Math.ceil(n / 2))))];
    };
    if (kind === 'lingerieRackRow') {
      // hangers hooked side-on along the rail (hanger width across it, garments facing along it), packed, centred, a little seeded slack
      const half = ((host ? LINGERIE_RACK.row[host.kind as keyof typeof LINGERIE_RACK.row] : undefined) ?? 0.66) - 0.04 - (r.seed % 5) * 0.03;
      const avg = [...items.get(r.a)!, ...items.get(r.b)!].reduce((t, q) => t + q.pitch, 0) / (items.get(r.a)!.length + items.get(r.b)!.length);
      const n = Math.max(2, Math.floor((2 * half) / avg));
      const seq = Array.from({length: n}, (_, k) => pick(k, n));
      const used = seq.reduce((t, q) => t + q.pitch, 0);
      let x = -used / 2;
      for (const it of seq) { put(base, it, x + it.pitch / 2, 0, Math.PI / 2); x += it.pitch; }
    } else {
      const R = (host ? LINGERIE_RACK.ring[host.kind as keyof typeof LINGERIE_RACK.ring] : undefined) ?? 0.5;
      const avg = [...items.get(r.a)!, ...items.get(r.b)!].reduce((t, q) => t + q.pitch, 0) / (items.get(r.a)!.length + items.get(r.b)!.length);
      const n = Math.max(4, Math.min(32, Math.floor((2 * Math.PI * R) / (avg * 1.4))));
      const th0 = (r.seed % 12) * (Math.PI / 6);
      for (let k = 0; k < n; k++) {
        const th = th0 + (k / n) * Math.PI * 2;
        put(base, pick(k, n), R * Math.cos(th), R * Math.sin(th), -th); // hanger radial (hooked on the ring), garment tangential
      }
    }
  }
  emit(group, batches, kind, level);
  return list.length;
}
