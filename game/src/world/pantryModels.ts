// Task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): the pantry foods' / drinks' runtime MODELS (items/pantryFood.ts) —
// the cook lane's Meshy derivatives (assets/foodShelfModels.generated.ts FOOD_ITEM_MODELS: real size, origin bottom-centre, +Y up, front
// +Z; Meshy's own PBR maps kept), fetched LAZILY: not in the boot preload (assets/manifest.ts MODEL_FILES). Game.prepareSection asks for
// the section's needs behind its loading screen — the logical level's palette (items/pantryVariety.ts levelPantryIds), the pantry items in
// the section's memory and what the player carries (inventory, Lockbox, train cargo) — so a level loads only the variants it can show.
// A loaded model stays resident (a small, bounded set: at most the 24 files) because the items TRAVEL: a carried tin's held model, icon
// and dropped pickup must never point at a released file (world/pickups.ts templates, the viewmodel and the icon renders share it).
//
// Until a model is loaded (Node tests, the empty cook stub, a failed fetch) an item shows its FALLBACK: a plain primitive of its ITEM_DIMS
// size in two flat colours (items/pantryFood.ts PANTRY_FALLBACK) — clearly not finished art (named `pantry-fallback-<id>`,
// userData.fallback, its model source says FALLBACK). No label, picture or texture is drawn here.
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {assetUrl} from '../assets/loader';
import {itemDims} from '../items/items';
import {PANTRY_FALLBACK, isPantryItem, pantryModelUrl, type PantryId} from '../items/pantryFood';

const loaded = new Map<string, Pick<GLTF, 'scene'>>();
const pending = new Map<string, Promise<boolean>>();
/** Fetch counts (QA / tests): files fetched, failures (the item keeps its fallback), fetches started after a level was built. */
export const PANTRY_MODEL_STATS = {fetched: 0, failed: 0, late: 0};

/** The loaded model of a pantry item (undefined: not delivered / not fetched yet / failed). */
export function pantryGltf(id: string): Pick<GLTF, 'scene'> | undefined {
  return loaded.get(id);
}

/** Swap a model in (tests / a re-delivery; null = back to the fallback). Call world/pickups.ts refreshItemTemplates afterwards. */
export function registerPantryModel(id: string, gltf: Pick<GLTF, 'scene'> | null): void {
  if (gltf) loaded.set(id, gltf); else loaded.delete(id);
}

/** Where a pantry item's model comes from (QA / pickups itemModelSources). */
export function pantryModelSource(id: string): string {
  const url = pantryModelUrl(id);
  if (loaded.has(id)) return `meshy-t2.5 ${url ?? '(registered)'}`;
  return url ? `FALLBACK primitive (world/pantryModels.ts; ${url} not loaded yet — not finished art)` : 'FALLBACK primitive (world/pantryModels.ts; no cooked model delivered — not finished art)';
}

/**
 * Fetch the delivered models of `ids` that are not resident yet (unknown / undelivered ids are skipped; no browser: nothing). Resolves
 * with the ids that became resident in THIS call (the caller refreshes their templates / held models / icons). Never rejects.
 * `late`: the call happens after the level was built (counted; a carried item restored from a save).
 */
export async function ensurePantryModels(ids: Iterable<string>, o: {late?: boolean} = {}): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  const want = [...new Set(ids)].filter(id => isPantryItem(id) && !loaded.has(id) && pantryModelUrl(id));
  if (!want.length) return [];
  const fresh: string[] = [];
  await Promise.all(want.map(async id => {
    let p = pending.get(id);
    if (!p) {
      if (o.late) PANTRY_MODEL_STATS.late++;
      const url = pantryModelUrl(id)!;
      p = new GLTFLoader().loadAsync(assetUrl(url)).then(g => {
        if (!g?.scene) return false;
        loaded.set(id, g);
        PANTRY_MODEL_STATS.fetched++;
        return true;
      }, err => { PANTRY_MODEL_STATS.failed++; console.warn(`pantry food: ${url} did not load — ${id} keeps its fallback`, err); return false; })
        .finally(() => pending.delete(id));
      pending.set(id, p);
      if (await p) fresh.push(id);
      return;
    }
    await p; // another caller's fetch: that caller refreshes
  }));
  return fresh.sort();
}

// ---------------------------------------------------------------------------------------
// Fallback primitives

const fallbackGeo = new Map<string, THREE.BufferGeometry>();
let fallbackMat: THREE.MeshStandardMaterial | null = null;

function tint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  ng.deleteAttribute('uv');
  const c = new THREE.Color(color), n = ng.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return ng;
}
const boxAt = (w: number, h: number, d: number, x: number, y0: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y0 + h / 2, z);
const cylAt = (r: number, h: number, y0: number, seg = 16) => new THREE.CylinderGeometry(r, r, h, seg).translate(0, y0 + h / 2, 0);

/** The merged two-colour primitive of an item at its ITEM_DIMS size (origin bottom-centre, front +Z). */
function fallbackGeometry(id: PantryId): THREE.BufferGeometry {
  const D = itemDims(id), F = PANTRY_FALLBACK[id];
  const r = Math.min(D.w, D.d) / 2;
  const P: THREE.BufferGeometry[] = [];
  const body = (g: THREE.BufferGeometry) => P.push(tint(g, F.body));
  const accent = (g: THREE.BufferGeometry) => P.push(tint(g, F.accent));
  switch (F.form) {
    case 'can': body(cylAt(r, D.h * 0.92, 0)); accent(cylAt(r * 0.98, D.h * 0.08, D.h * 0.92)); break;
    case 'jar': body(cylAt(r, D.h * 0.82, 0)); accent(cylAt(r * 0.92, D.h * 0.18, D.h * 0.82)); break;
    case 'bottle': body(cylAt(r, D.h * 0.68, 0)); body(new THREE.CylinderGeometry(r * 0.38, r, D.h * 0.22, 14).translate(0, D.h * 0.79, 0)); accent(cylAt(r * 0.4, D.h * 0.1, D.h * 0.9, 12)); break;
    case 'box': body(boxAt(D.w, D.h * 0.9, D.d, 0, 0, 0)); accent(boxAt(D.w * 0.96, D.h * 0.1, D.d * 0.96, 0, D.h * 0.9, 0)); break;
    case 'pouch': body(boxAt(D.w, D.h * 0.86, D.d, 0, 0, 0)); accent(boxAt(D.w, D.h * 0.14, D.d * 0.4, 0, D.h * 0.86, 0)); break;
    case 'tin': body(boxAt(D.w, D.h * 0.8, D.d, 0, 0, 0)); accent(boxAt(D.w * 0.94, D.h * 0.2, D.d * 0.94, 0, D.h * 0.8, 0)); break;
    case 'round': {
      const sx = D.w / (2 * r), sz = D.d / (2 * r);
      body(cylAt(r, D.h * 0.8, 0, 20).scale(sx, 1, sz)); accent(cylAt(r * 0.98, D.h * 0.2, D.h * 0.8, 20).scale(sx, 1, sz));
      break;
    }
    case 'chub': { // a cylinder along X, elliptical to the item's height / depth
      const along = (r: number, len: number, x: number, seg: number) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).scale(1, D.h, D.d).translate(x, D.h / 2, 0);
      body(along(0.5, D.w * 0.88, 0, 14));
      accent(along(0.2, D.w * 0.06, -D.w * 0.47, 8));
      accent(along(0.2, D.w * 0.06, D.w * 0.47, 8));
      break;
    }
    case 'multi': {
      const n = id === 'pudding_cups' ? 4 : 3, cw = D.w / n;
      for (let k = 0; k < n; k++) body(boxAt(cw * 0.94, D.h * 0.88, D.d, -D.w / 2 + cw * (k + 0.5), 0, 0));
      accent(boxAt(D.w, D.h * 0.12, D.d * 1.02, 0, D.h * 0.88, 0));
      break;
    }
  }
  const merged = mergeGeometries(P, false);
  for (const g of P) g.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** A NEW group showing the FALLBACK primitive of a pantry item (shared geometry / material). */
export function pantryFallbackModel(id: PantryId): THREE.Group {
  let geo = fallbackGeo.get(id);
  if (!geo) { geo = fallbackGeometry(id); fallbackGeo.set(id, geo); }
  fallbackMat ??= new THREE.MeshStandardMaterial({name: 'pantry-fallback', vertexColors: true, roughness: 0.7, metalness: 0.05});
  const g = new THREE.Group();
  g.name = `pantry-fallback-${id}`;
  g.add(new THREE.Mesh(geo, fallbackMat));
  g.userData.fallback = true;
  return g;
}
