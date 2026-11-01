// Task reactor-build-20261101 (lane RESTART): world / held / icon models of THE RESTART's two parts (items/items.ts):
//  - reactor_key ("Startup key"): the shift supervisor's control-room key — a brass key on a steel split ring with a red plastic fob;
//  - fuse_cartridge ("Fuse cartridge"): a heavy ceramic HRC switchgear cartridge — cream ceramic body, tinned end caps, blade contacts.
// PROCEDURAL STAND-INS for now (hand-dimensioned primitives, flat material colours — no drawn texture art; not generated): the lead
// delivers Meshy GLBs 'reactor-key' / 'fuse-cartridge' later. Swap hook: `registerReactorItemModels({'reactor-key': gltf, …})` BEFORE
// item templates / icons are built (world/pickups.ts registerItemModels clears its template cache: call it after a late swap); the
// GLB is fitted uniformly to ITEM_DIMS (origin bottom-centre, front +Z) like the food / ammo models.
// Frames follow world/pickups.ts: origin bottom-centre, front +Z, metres, lying as the item rests (the key flat, the cartridge along X);
// the bounds equal ITEM_DIMS (tests). Geometry / materials are cached once (templates flag them `userData.shared`).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {itemDims} from '../../items/items';

export const REACTOR_ITEM_IDS = ['reactor_key', 'fuse_cartridge'] as const;
export type ReactorItemId = (typeof REACTOR_ITEM_IDS)[number];
export const isReactorItem = (id: string): id is ReactorItemId => (REACTOR_ITEM_IDS as readonly string[]).includes(id);

/** The lead's Meshy asset ids per item (assets delivered later; the hook below takes them). */
export const REACTOR_ITEM_ASSET: Readonly<Record<ReactorItemId, string>> = {reactor_key: 'reactor-key', fuse_cartridge: 'fuse-cartridge'};

const delivered = new Map<ReactorItemId, Pick<GLTF, 'scene'>>();

/** Swap in delivered models (keys: 'reactor-key' / 'fuse-cartridge'; a missing / null entry keeps the procedural stand-in). */
export function registerReactorItemModels(models: Partial<Record<string, Pick<GLTF, 'scene'> | null | undefined>>): void {
  for (const id of REACTOR_ITEM_IDS) {
    const g = models[REACTOR_ITEM_ASSET[id]];
    if (g?.scene) delivered.set(id, g); else if (REACTOR_ITEM_ASSET[id] in models) delivered.delete(id);
  }
}

/** Model source line (QA / itemModelSources). */
export function reactorItemSource(id: string): string {
  return isReactorItem(id) && delivered.has(id) ? `delivered model '${REACTOR_ITEM_ASSET[id]}' (fitted to ITEM_DIMS)` : 'procedural stand-in (world/reactor/restartItems.ts)';
}

// ---------------------------------------------------------------------------------------------

let matCache: Record<string, THREE.MeshStandardMaterial> = {};
let geoCache: Record<string, THREE.BufferGeometry> = {};
const mat = (key: string, p: THREE.MeshStandardMaterialParameters) => (matCache[key] ??= Object.assign(new THREE.MeshStandardMaterial(p), {name: `reactor-item-${key}`}));

const box = (w: number, h: number, d: number, x: number, y0: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y0 + h / 2, z);
/** A cylinder lying along X (axis), centred at (x, yc, z). */
const cylX = (r: number, len: number, x: number, yc: number, z: number, seg = 16) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, yc, z);
/** An upright cylinder (flat disc when short), bottom at y0. */
const cylY = (r: number, h: number, x: number, y0: number, z: number, seg = 16) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y0 + h / 2, z);

function merged(key: string, parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const hit = geoCache[key];
  if (hit) { for (const p of parts) p.dispose(); return hit; }
  const list = parts.map(p => (p.index ? p.toNonIndexed() : p));
  for (const p of list) for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') p.deleteAttribute(name);
  const g = mergeGeometries(list, false);
  for (const p of parts) p.dispose();
  for (const p of list) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return (geoCache[key] = g);
}

/** Startup key (lying flat, long axis X): red fob at -X, split ring, brass bow + blade with cut teeth toward +X. Bounds = ITEM_DIMS. */
function keyModel(): THREE.Group {
  const g = new THREE.Group();
  const fob = merged('key-fob', [box(0.058, 0.009, 0.034, -0.047, 0, 0), cylY(0.017, 0.009, -0.076 + 0.017, 0, 0, 18)]);
  const ring = merged('key-ring', [new THREE.TorusGeometry(0.012, 0.0016, 6, 20).rotateX(Math.PI / 2).translate(-0.006, 0.0016, 0)]);
  const brass = merged('key-brass', [
    cylY(0.012, 0.003, 0.018, 0, 0, 18),                       // bow
    box(0.014, 0.004, 0.012, 0.034, 0, 0),                     // shoulder
    box(0.042, 0.0026, 0.0075, 0.061, 0, 0.0005),              // blade
    box(0.006, 0.0026, 0.004, 0.049, 0, -0.005), box(0.005, 0.0026, 0.003, 0.058, 0, -0.0048), box(0.006, 0.0026, 0.004, 0.068, 0, -0.005), // teeth
  ]);
  const inner = new THREE.Group();
  inner.position.x = -0.003; // the parts span x -0.076 .. 0.082: centred on the origin
  inner.add(new THREE.Mesh(fob, mat('fob', {color: 0xa3261f, roughness: 0.55, metalness: 0.02})));
  inner.add(new THREE.Mesh(ring, mat('ring', {color: 0xb8bcbf, roughness: 0.35, metalness: 0.9})));
  inner.add(new THREE.Mesh(brass, mat('brass', {color: 0xc9a14a, roughness: 0.32, metalness: 0.92})));
  g.add(inner);
  return g;
}

/** Fuse cartridge (lying along X): ceramic body, tinned end caps, flat blade contacts out of both ends. Bounds = ITEM_DIMS. */
function fuseModel(): THREE.Group {
  const g = new THREE.Group();
  const R = 0.028, yc = R;
  const body = merged('fuse-body', [cylX(0.026, 0.122, 0, yc, 0, 20)]);
  const caps = merged('fuse-caps', [
    cylX(R, 0.017, -0.0695, yc, 0, 20), cylX(R, 0.017, 0.0695, yc, 0, 20),
    box(0.03, 0.004, 0.02, -0.093, yc - 0.002, 0), box(0.03, 0.004, 0.02, 0.093, yc - 0.002, 0), // blade contacts (out to ±0.108)
  ]);
  g.add(new THREE.Mesh(body, mat('ceramic', {color: 0xe6dfcc, roughness: 0.6, metalness: 0})));
  g.add(new THREE.Mesh(caps, mat('tin', {color: 0xb9b49f, roughness: 0.38, metalness: 0.85})));
  return g;
}

/** A delivered GLB fitted uniformly to ITEM_DIMS: bottom-centre origin (as world/pickups.ts fitItemModel). */
function fitDelivered(gltf: Pick<GLTF, 'scene'>, id: ReactorItemId): THREE.Group {
  const dims = itemDims(id);
  const src = gltf.scene.clone(true);
  src.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(src);
  const size = b.getSize(new THREE.Vector3());
  const s = Math.min(dims.h / (size.y || 1), dims.w / (size.x || 1), dims.d / (size.z || 1)) * 1.0;
  const c = b.getCenter(new THREE.Vector3());
  src.scale.setScalar(s);
  src.position.set(-c.x * s, -b.min.y * s, -c.z * s);
  const g = new THREE.Group();
  g.add(src);
  return g;
}

/** A NEW group for a restart part: the delivered model when registered, else the procedural stand-in. */
export function reactorItemModel(id: string): THREE.Group {
  if (!isReactorItem(id)) throw new Error(`not a reactor item: ${id}`);
  const d = delivered.get(id);
  if (d) return fitDelivered(d, id);
  return id === 'reactor_key' ? keyModel() : fuseModel();
}

/** Test hook: forget cached geometry / materials and delivered models. */
export function resetReactorItemCache(): void {
  matCache = {};
  geoCache = {};
  delivered.clear();
}
