// Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): the twelve new weapons' runtime MODELS, fetched LAZILY per section
// (modelled on world/pantryModels.ts): never in the boot preload, never all twelve at once. The cook lane's Meshy T2.5 derivatives
// (assets/weaponVarietyModels.generated.ts WEAPON_VARIETY_MODELS: metres, +Y up, forward -Z, Grip / Muzzle / Sight / Tip markers, Meshy's own
// PBR maps kept) at game/public/assets/models/weapon-<id>.glb.
//  - WHAT: exactly the models a section can show — the variety weapons its first spawn realizes (items/weaponVariety.ts plannedVarietyIds),
//    the ones in its memory (remembered pickups, a grounded bag, the car trunk: every `itemId` of the section record) and what the player
//    carries or stores (inventory incl. bags, Lockbox, train cargo).
//  - WHEN: Game.prepareSection, behind the loading screen, before the build and its render warm-up; a carried weapon restored after the
//    prepare (a loaded save) is fetched `late`.
//  - WHERE: held (the viewmodel's lazily added model: Viewmodel.addModel, lane GUNS), world pickups / trader wares / riding cargo
//    (world/pickups.ts PickupManager.meshFor falls back to weaponVarietyGltf), the 3D inventory icons (ui/itemIcons.ts refreshItemIcons) and
//    hidden warm prototypes in pickup form (weaponVarietyWarmRoots: a WarmupRegistry pool), so the first drop / equip compiles nothing.
// A loaded model stays resident (a small, bounded set: at most the twelve files) because the weapons TRAVEL: a carried gun's held copy,
// icon and dropped pickup share its geometry / materials, which are flagged userData.shared so a removed pickup never disposes them.
// Until a model is delivered / loaded the weapon cannot be realized as a find (items/weaponVariety.ts identityAvailable) — no primitive
// stand-in is ever made here.
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from '../assets/loader';
import {WEAPON_VARIETY_MODELS} from '../assets/weaponVarietyModels.generated';
import {isVarietyWeapon} from '../weapons/varietyIds';

const loaded = new Map<string, Pick<GLTF, 'scene'>>();
const pending = new Map<string, Promise<boolean>>();
/** The warm prototypes (below) are rebuilt on their next request after the resident set changed. */
let warmDirty = true;
/** Fetch counts (QA / tests): files fetched, failures, fetches started after a level was built. */
export const WEAPON_VARIETY_MODEL_STATS = {fetched: 0, failed: 0, late: 0};

/** The delivered model file of a variety weapon (null: not delivered / not a variety weapon). */
export function weaponVarietyModelUrl(id: string): string | null {
  const m = isVarietyWeapon(id) ? WEAPON_VARIETY_MODELS[id] : undefined;
  return m && typeof m.url === 'string' && m.url.length ? m.url : null;
}

/** The loaded model of a variety weapon (undefined: not delivered / not fetched yet / failed). */
export function weaponVarietyGltf(id: string): Pick<GLTF, 'scene'> | undefined {
  return loaded.get(id);
}

/** The resident variety weapon ids (sorted). */
export function residentWeaponVarietyIds(): string[] {
  return [...loaded.keys()].sort();
}

/** Every mesh of a resident model is SHARED (clones copy userData): a removed pickup / riding copy never disposes its geometry. */
function markShared(g: Pick<GLTF, 'scene'>): void {
  g.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.userData.shared = true; });
}

/** Swap a model in (tests / a re-delivery; null = unload). */
export function registerWeaponVarietyModel(id: string, gltf: Pick<GLTF, 'scene'> | null): void {
  if (gltf) { markShared(gltf); loaded.set(id, gltf); } else loaded.delete(id);
  warmDirty = true;
}

/** Where a variety weapon's model comes from (QA). */
export function weaponVarietyModelSource(id: string): string {
  const url = weaponVarietyModelUrl(id);
  if (loaded.has(id)) return `meshy-t2.5 ${url ?? '(registered)'}`;
  return url ? `not loaded yet (${url})` : 'not delivered (no model: the weapon is never realized as a find)';
}

/**
 * Fetch the delivered models of `ids` that are not resident yet (unknown / undelivered ids are skipped; no browser: nothing). Resolves
 * with the ids that became resident in THIS call (the caller hands them to the viewmodel and the icons). Never rejects.
 */
export async function ensureWeaponVarietyModels(ids: Iterable<string>, o: {late?: boolean} = {}): Promise<string[]> {
  if (typeof window === 'undefined') return [];
  const want = [...new Set(ids)].filter(id => isVarietyWeapon(id) && !loaded.has(id) && weaponVarietyModelUrl(id));
  if (!want.length) return [];
  const fresh: string[] = [];
  await Promise.all(want.map(async id => {
    let p = pending.get(id);
    if (!p) {
      if (o.late) WEAPON_VARIETY_MODEL_STATS.late++;
      const url = weaponVarietyModelUrl(id)!;
      p = new GLTFLoader().loadAsync(assetUrl(url)).then(g => {
        if (!g?.scene) return false;
        registerWeaponVarietyModel(id, g);
        WEAPON_VARIETY_MODEL_STATS.fetched++;
        return true;
      }, err => { WEAPON_VARIETY_MODEL_STATS.failed++; console.warn(`weapon variety: ${url} did not load — ${id} is not shown`, err); return false; })
        .finally(() => pending.delete(id));
      pending.set(id, p);
      if (await p) fresh.push(id);
      return;
    }
    await p; // another caller's fetch: that caller hands it on
  }));
  return fresh.sort();
}

// ---------------------------------------------------------------------------------------
// Pickup form + warm prototypes

/** A gun / melee weapon lying on its side (world/pickups.ts PickupManager.meshFor's transform: muzzle / tip along -X, detail up, base on y 0). */
export function lyingWeapon(g: Pick<GLTF, 'scene'>): THREE.Group {
  const wrap = new THREE.Group();
  const gun = g.scene.clone(true);
  gun.rotation.set(0, Math.PI / 2, Math.PI / 2);
  wrap.add(gun);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gun);
  gun.position.y -= box.min.y;
  gun.position.x -= (box.min.x + box.max.x) / 2;
  gun.position.z -= (box.min.z + box.max.z) / 2;
  return wrap;
}

/** The hidden warm prototypes' parent (the game adds it to its scene once). */
export const WEAPON_VARIETY_WARM_GROUP = new THREE.Group();
WEAPON_VARIETY_WARM_GROUP.name = 'weapon-variety-warm';
const protos = new Map<string, THREE.Object3D>();

/**
 * The warm-up pool roots (render/warmup.ts WarmupRegistry.addPool): one hidden prototype per RESIDENT model in pickup form, with its own
 * material copies like a pickup (PickupManager.add clones them), far below the world, never hit by a ray. Built on demand.
 */
export function weaponVarietyWarmRoots(): THREE.Object3D[] {
  if (warmDirty) {
    for (const [id, p] of protos) if (!loaded.has(id)) { WEAPON_VARIETY_WARM_GROUP.remove(p); protos.delete(id); }
    for (const [id, g] of loaded) {
      if (protos.has(id)) continue;
      const root = lyingWeapon(g);
      root.name = `weapon-variety-warm-prototype-${id}`;
      root.position.set(0, -1000, 0);
      root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone();
        m.visible = false;
        m.raycast = () => {};
      });
      WEAPON_VARIETY_WARM_GROUP.add(root);
      protos.set(id, root);
    }
    warmDirty = false;
  }
  return [...protos.values()];
}
