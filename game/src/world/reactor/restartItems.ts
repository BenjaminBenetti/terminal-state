// Task reactor-build-20261101 (lane RESTART): world / held / icon models of THE RESTART's two parts (items/items.ts):
//  - reactor_key ("Startup key"): the shift supervisor's control-room key — brass key + red fob, lying flat;
//  - fuse_cartridge ("Fuse cartridge"): a heavy ceramic switchgear cartridge — white ceramic body, brass caps, length along X.
// MODELS: the lead's Meshy T2.5 kit GLBs (assets/reactorKit.generated.ts REACTOR_KIT.reactorKey / .fuseCartridge: real size, grounded,
// centred, front +Z — already in the item frame; Meshy maps kept). `preloadReactorItemModels()` fetches them once; Game.load awaits it
// before item templates / icons are built (world/pickups.ts itemTemplate), so the world, the hands, the icons and the switchgear's
// seated cartridges all show the same model. A missing / failed GLB falls back to the PROCEDURAL STAND-IN below (hand-dimensioned
// primitives in flat material colours, the same bounds — no drawn texture art). `registerReactorItemModels` swaps models directly
// (tests / a later re-delivery; call world/pickups.ts registerItemModels afterwards to drop cached templates).
// Frames follow world/pickups.ts: origin bottom-centre, front +Z, metres; bounds = ITEM_DIMS (tests). Geometry / materials are cached
// once (templates flag them `userData.shared`).

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {itemDims} from '../../items/items';
import {REACTOR_KIT} from '../../assets/reactorKit.generated';
import {assetUrl} from '../../assets/loader';

export const REACTOR_ITEM_IDS = ['reactor_key', 'fuse_cartridge'] as const;
export type ReactorItemId = (typeof REACTOR_ITEM_IDS)[number];
export const isReactorItem = (id: string): id is ReactorItemId => (REACTOR_ITEM_IDS as readonly string[]).includes(id);

/** The kit model of each part (REACTOR_KIT key / url / dims). */
export const REACTOR_ITEM_KIT = {reactor_key: REACTOR_KIT.reactorKey, fuse_cartridge: REACTOR_KIT.fuseCartridge} as const;

const delivered = new Map<ReactorItemId, Pick<GLTF, 'scene'>>();
let preload: Promise<void> | null = null;

/** Swap models in (keys: item ids or kit keys 'reactor-reactorKey' / 'reactor-fuseCartridge'; null = back to the stand-in). */
export function registerReactorItemModels(models: Partial<Record<string, Pick<GLTF, 'scene'> | null | undefined>>): void {
  for (const id of REACTOR_ITEM_IDS) {
    const k = id in models ? id : REACTOR_ITEM_KIT[id].key in models ? REACTOR_ITEM_KIT[id].key : null;
    if (k === null) continue;
    const g = models[k];
    if (g?.scene) delivered.set(id, g); else delivered.delete(id);
  }
}

/**
 * Fetch the two kit GLBs once (failures resolve quietly -> procedural stand-ins). Started by installReactorRestart (the download
 * overlaps the boot assets) and awaited by Game.load before the item templates / icons are made.
 */
export function preloadReactorItemModels(): Promise<void> {
  if (preload) return preload;
  if (typeof window === 'undefined') return (preload = Promise.resolve());
  const loader = new GLTFLoader();
  preload = Promise.all(REACTOR_ITEM_IDS.map(async id => {
    try {
      const gltf = await loader.loadAsync(assetUrl(REACTOR_ITEM_KIT[id].url));
      if (gltf?.scene && !delivered.has(id)) delivered.set(id, gltf);
    } catch (err) {
      console.warn(`reactor: ${REACTOR_ITEM_KIT[id].url} did not load — the procedural ${id} stand-in is used`, err);
    }
  })).then(() => undefined, () => undefined);
  return preload;
}

/** Model source line (QA / itemModelSources). */
export function reactorItemSource(id: string): string {
  return isReactorItem(id) && delivered.has(id) ? `meshy-t2.5 kit ${REACTOR_ITEM_KIT[id].url}` : 'procedural stand-in (world/reactor/restartItems.ts; kit model not loaded)';
}

// ---------------------------------------------------------------------------------------------
// Procedural stand-ins (load-failure fallback; same bounds as the kit models)

let matCache: Record<string, THREE.MeshStandardMaterial> = {};
let geoCache: Record<string, THREE.BufferGeometry> = {};
const mat = (key: string, p: THREE.MeshStandardMaterialParameters) => (matCache[key] ??= Object.assign(new THREE.MeshStandardMaterial(p), {name: `reactor-item-${key}`}));

const box = (w: number, h: number, d: number, x: number, y0: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y0 + h / 2, z);
/** A cylinder lying along X (axis), centred at (x, yc, z). */
const cylX = (r: number, len: number, x: number, yc: number, z: number, seg = 16) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, yc, z);
/** An upright cylinder (flat disc when short), bottom at y0. */
const cylY = (r: number, h: number, x: number, y0: number, z: number, seg = 16) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y0 + h / 2, z);

function merged(key: string, make: () => THREE.BufferGeometry[]): THREE.BufferGeometry {
  const hit = geoCache[key];
  if (hit) return hit;
  const parts = make();
  const list = parts.map(p => (p.index ? p.toNonIndexed() : p));
  for (const p of list) for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') p.deleteAttribute(name);
  const g = mergeGeometries(list, false);
  for (const p of new Set([...parts, ...list])) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return (geoCache[key] = g);
}

/** Startup key (flat, long axis X): red fob at -X, split ring, brass bow + blade with cut teeth toward +X. 0.13 x 0.0073 x 0.057 m. */
function keyStandIn(): THREE.Group {
  const g = new THREE.Group();
  const fob = merged('key-fob', () => [box(0.042, 0.0073, 0.057, -0.044, 0, 0)]);
  const ring = merged('key-ring', () => [new THREE.TorusGeometry(0.009, 0.0014, 6, 20).rotateX(Math.PI / 2).translate(-0.0145, 0.0014, 0)]);
  const brass = merged('key-brass', () => [
    cylY(0.011, 0.003, 0.006, 0, 0, 18),                       // bow
    box(0.01, 0.0035, 0.011, 0.021, 0, 0),                     // shoulder
    box(0.039, 0.0025, 0.0075, 0.0455, 0, 0.0005),             // blade
    box(0.005, 0.0025, 0.004, 0.036, 0, -0.005), box(0.004, 0.0025, 0.003, 0.046, 0, -0.0048), box(0.005, 0.0025, 0.004, 0.056, 0, -0.005), // teeth
  ]);
  g.add(new THREE.Mesh(fob, mat('fob', {color: 0xa3261f, roughness: 0.55, metalness: 0.02})));
  g.add(new THREE.Mesh(ring, mat('ring', {color: 0xb8bcbf, roughness: 0.35, metalness: 0.9})));
  g.add(new THREE.Mesh(brass, mat('brass', {color: 0xc9a14a, roughness: 0.32, metalness: 0.92})));
  return g;
}

/** Fuse cartridge (along X): ceramic body, brass end caps, flat blade contacts out of both ends. 0.30 x 0.062 x 0.062 m. */
function fuseStandIn(): THREE.Group {
  const g = new THREE.Group();
  const R = 0.031, yc = R;
  const body = merged('fuse-body', () => [cylX(0.029, 0.17, 0, yc, 0, 20)]);
  const caps = merged('fuse-caps', () => [
    cylX(R, 0.025, -0.0975, yc, 0, 20), cylX(R, 0.025, 0.0975, yc, 0, 20),
    box(0.04, 0.005, 0.022, -0.13, yc - 0.0025, 0), box(0.04, 0.005, 0.022, 0.13, yc - 0.0025, 0), // blade contacts (out to ±0.15)
  ]);
  g.add(new THREE.Mesh(body, mat('ceramic', {color: 0xe9e4d6, roughness: 0.6, metalness: 0})));
  g.add(new THREE.Mesh(caps, mat('caps', {color: 0xbf9b52, roughness: 0.38, metalness: 0.85})));
  return g;
}

/** A kit GLB fitted uniformly to ITEM_DIMS (it is already real size: scale ~1), bottom-centre origin (as pickups.ts fitItemModel). */
function fitDelivered(gltf: Pick<GLTF, 'scene'>, id: ReactorItemId): THREE.Group {
  const dims = itemDims(id);
  const src = gltf.scene.clone(true);
  src.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(src);
  const size = b.getSize(new THREE.Vector3());
  const s = Math.min(dims.h / (size.y || 1), dims.w / (size.x || 1), dims.d / (size.z || 1));
  const c = b.getCenter(new THREE.Vector3());
  src.scale.multiplyScalar(s);
  src.position.set(-c.x * s, -b.min.y * s, -c.z * s);
  const g = new THREE.Group();
  g.add(src);
  return g;
}

/** A NEW group for a restart part: the kit model when loaded / registered, else the procedural stand-in. */
export function reactorItemModel(id: string): THREE.Group {
  if (!isReactorItem(id)) throw new Error(`not a reactor item: ${id}`);
  const d = delivered.get(id);
  if (d) return fitDelivered(d, id);
  return id === 'reactor_key' ? keyStandIn() : fuseStandIn();
}

/** Test hook: forget cached geometry / materials and delivered models. */
export function resetReactorItemCache(): void {
  matCache = {};
  geoCache = {};
  delivered.clear();
  preload = null;
}
