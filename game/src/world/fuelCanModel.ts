// Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the FUEL CAN's world / held / icon model.
//
// MODEL: the delivered runtime GLB assets/models/train-fuel-can.glb (task studio-train-fuel-can-asset-20261106-030724-01: a Meshy T2.5
// image-to-3D derivative of a Codex concept; Meshy's own PBR maps kept, re-encoded, the back label un-mirrored by a deterministic texel
// mirror; provenance assets/derivatives/train-fuel-can.json).
// It is already in the item frame — real size 0.2015 x 0.30 x 0.105 m (= items.ts ITEM_DIMS.fuel_can: a ~5 l can, med-kit sized, user
// feedback task fuel-feedback; FUEL readable on both broad sides), origin bottom-centre, +Y up, front +Z, identity transforms, one
// material — so it is used as delivered (a clone shares its geometry / materials / maps).
// preloadFuelCanModel() fetches it once (installFuelPort starts it so the download overlaps the boot assets; Game.load awaits it before
// the item templates / icons are built, like the medical / reactor item models), so pickups, holder lots, icons, the held can and the
// warm-up prototype all show the same model.
//
// FALLBACK (Node tests / a failed load only): a plain box of the item's size with a handle bar — clearly NOT finished art, labelled as
// a fallback in its name and model source. registerFuelCanModel() swaps the model directly (tests / a later re-delivery; call
// world/pickups.ts registerItemModels afterwards to drop cached templates).

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from '../assets/loader';
import {itemDims} from '../items/items';

/** The delivered runtime model (referenced here so the release packager ships it). */
export const FUEL_CAN_MODEL_URL = 'assets/models/train-fuel-can.glb';

let delivered: Pick<GLTF, 'scene'> | null = null;
let preload: Promise<void> | null = null;

/** Fetch the GLB once (no browser / a failure resolves quietly -> the fallback box). */
export function preloadFuelCanModel(): Promise<void> {
  if (preload) return preload;
  if (typeof window === 'undefined') return (preload = Promise.resolve());
  preload = new GLTFLoader().loadAsync(assetUrl(FUEL_CAN_MODEL_URL)).then(gltf => {
    if (gltf?.scene && !delivered) delivered = gltf;
  }, err => { console.warn(`fuel can: ${FUEL_CAN_MODEL_URL} did not load — the fallback box is used`, err); });
  return preload;
}

/** Swap the model in (null = back to the fallback). Tests / a re-delivery. */
export function registerFuelCanModel(gltf: Pick<GLTF, 'scene'> | null): void {
  delivered = gltf;
}

/** Where the fuel can's model comes from (QA / pickups itemModelSources). */
export function fuelCanModelSource(): string {
  return delivered ? `meshy-t2.5 ${FUEL_CAN_MODEL_URL}` : 'FALLBACK box (world/fuelCanModel.ts; the fuel-can model did not load — not finished art)';
}

let fallbackParts: {geo: THREE.BufferGeometry; handle: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial} | null = null;

/** The load-failure fallback: a plain box of ITEM_DIMS.fuel_can with a handle bar on top (flat colour, no texture). */
function fallbackModel(): THREE.Group {
  const D = itemDims('fuel_can');
  fallbackParts ??= {
    geo: new THREE.BoxGeometry(D.w, D.h * 0.88, D.d).translate(0, D.h * 0.44, 0),
    handle: new THREE.BoxGeometry(D.w * 0.55, D.h * 0.12, 0.022).translate(0, D.h * 0.94, 0), // a carry fin on the body's top
    mat: new THREE.MeshStandardMaterial({name: 'fuel-can-fallback', color: 0x7a2a1e, roughness: 0.6, metalness: 0.3}),
  };
  const g = new THREE.Group();
  g.name = 'fuel-can-fallback';
  g.add(new THREE.Mesh(fallbackParts.geo, fallbackParts.mat), new THREE.Mesh(fallbackParts.handle, fallbackParts.mat));
  g.userData.fallback = true;
  return g;
}

/** A NEW group for the fuel can: the delivered GLB (cloned: shared geometry / materials / maps) when loaded, else the fallback box. */
export function fuelCanModel(): THREE.Group {
  if (!delivered) return fallbackModel();
  const g = new THREE.Group();
  g.name = 'fuel-can';
  g.add(delivered.scene.clone(true));
  return g;
}
