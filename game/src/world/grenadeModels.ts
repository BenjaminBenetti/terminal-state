// Task studio-refinement-batch-20261113-035659-01: the crafted throwables' world / held / icon / thrown model (items/grenades.ts).
//
// MODELS: the delivered runtime GLBs assets/models/item-acid-grenade.glb and item-lure-grenade.glb (Meshy T2.5 image-to-3D derivatives
// of one Codex design image each, Meshy's own PBR maps kept and re-encoded: provenance assets/derivatives/refinement-batch-20261113.json;
// tools/asset-pipeline/props/build-refinement-batch.mjs). They are already in the item frame (assets/grenades.generated.ts dims =
// items.ts ITEM_DIMS: upright canisters ~0.07 x 0.15 m, origin bottom-centre, +Y up, front +Z), so a clone is used as delivered
// (shared geometry / materials / maps), like the fuel can (world/fuelCanModel.ts).
// preloadGrenadeModels() fetches both once; Game.load awaits it before the item templates / icons / held models are built, so
// pickups, the Lockbox, icons, the hand and the thrown canister (weapons/grenades.ts) all show the same model.
//
// FALLBACK (Node tests / a failed load only): a plain cylinder of the item's size with a cap — clearly NOT finished art, labelled as
// a fallback in its name and model source.

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from '../assets/loader';
import {itemDims} from '../items/items';
import {ACID_GRENADE, GRENADE_IDS, type GrenadeId} from '../items/grenades';

/** The delivered runtime models (referenced here so the release packager ships them). */
export const GRENADE_MODEL_URLS: Record<GrenadeId, string> = {
  acid_grenade: 'assets/models/item-acid-grenade.glb',
  lure_grenade: 'assets/models/item-lure-grenade.glb',
}; // (= assets/grenades.generated.ts GRENADE_MODELS urls: tests/refinement-grenades.test.ts)

const delivered = new Map<GrenadeId, Pick<GLTF, 'scene'>>();
let preload: Promise<void> | null = null;

/** Fetch both GLBs once (no browser / a failure resolves quietly -> the fallback cylinder for that one). */
export function preloadGrenadeModels(): Promise<void> {
  if (preload) return preload;
  if (typeof window === 'undefined') return (preload = Promise.resolve());
  const loader = new GLTFLoader();
  preload = Promise.all(GRENADE_IDS.map(id => loader.loadAsync(assetUrl(GRENADE_MODEL_URLS[id])).then(gltf => {
    if (gltf?.scene && !delivered.has(id)) delivered.set(id, gltf);
  }, err => { console.warn(`grenades: ${GRENADE_MODEL_URLS[id]} did not load — the fallback cylinder is used`, err); }))).then(() => {});
  return preload;
}

/** Swap a model in (null = back to the fallback). Tests / a re-delivery (call world/pickups.ts registerItemModels afterwards). */
export function registerGrenadeModel(id: GrenadeId, gltf: Pick<GLTF, 'scene'> | null): void {
  if (gltf) delivered.set(id, gltf); else delivered.delete(id);
}

/** Where a grenade's model comes from (QA / pickups itemModelSources). */
export function grenadeModelSource(id: GrenadeId): string {
  return delivered.has(id) ? `meshy-t2.5 ${GRENADE_MODEL_URLS[id]}` : `FALLBACK cylinder (world/grenadeModels.ts; the ${id} model did not load — not finished art)`;
}

const fallbackMats = new Map<GrenadeId, THREE.MeshStandardMaterial>();
let fallbackGeo: Map<GrenadeId, {body: THREE.BufferGeometry; cap: THREE.BufferGeometry}> | null = null;

/** The load-failure fallback: a plain cylinder of ITEM_DIMS[id] with a darker cap (flat colour, no texture). */
function fallbackModel(id: GrenadeId): THREE.Group {
  fallbackGeo ??= new Map();
  let g = fallbackGeo.get(id);
  if (!g) {
    const D = itemDims(id), r = Math.min(D.w, D.d) / 2;
    g = {body: new THREE.CylinderGeometry(r, r, D.h * 0.82, 16).translate(0, D.h * 0.41, 0), cap: new THREE.CylinderGeometry(r * 0.6, r * 0.7, D.h * 0.18, 12).translate(0, D.h * 0.91, 0)};
    fallbackGeo.set(id, g);
  }
  let mat = fallbackMats.get(id);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({name: `${id}-fallback`, color: id === ACID_GRENADE ? 0x8fa23a : 0x6b4a2e, roughness: 0.55, metalness: 0.4});
    fallbackMats.set(id, mat);
  }
  const root = new THREE.Group();
  root.name = `${id}-fallback`;
  root.add(new THREE.Mesh(g.body, mat), new THREE.Mesh(g.cap, mat));
  root.userData.fallback = true;
  return root;
}

/** A NEW group for a grenade: the delivered GLB (cloned: shared geometry / materials / maps) when loaded, else the fallback. */
export function grenadeModel(id: GrenadeId): THREE.Group {
  const d = delivered.get(id);
  if (!d) return fallbackModel(id);
  const g = new THREE.Group();
  g.name = id;
  g.add(d.scene.clone(true));
  return g;
}
