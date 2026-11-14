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
// Until a model is DELIVERED (a row in the generated registry) the weapon cannot be realized as a find (items/weaponVariety.ts
// identityAvailable reads the registry, never this cache: what a first spawn realizes never depends on what happens to be loaded).
//
// Task studio-weapon-runtime-fix-20261110-022206-01 (user: "1337 on the train chest grants the new weapons, but they are TOTALLY
// INVISIBLE and item previews broken"): the section preload above was the ONLY loader, so a weapon that arrived any other way — the
// Lockbox gear drop, a trade, a restored save, anything mid-play — had no model until the next station. Loading is now DEMAND-DRIVEN as
// well: every surface that shows an item asks for its model when it is not resident (requestWeaponVarietyModel: the held view's setItem,
// a world pickup's mesh, an item icon) and ONE delivery (world/weaponVarietyDelivery.ts, subscribed with onWeaponVarietyReady) hands a
// model that arrived — by any path — to the held view, the pickups showing a stand-in and the icons. A failed fetch is reported
// (onWeaponVarietyFailed: the game says so) and retried with a backoff while the weapon is still wanted: never silently absent for good.
//
// Task studio-flamethrower-fire-20261114-031614-01 (lane ASSET): the same loader serves every LAZILY DELIVERED weapon model
// (weapons/lazyWeaponModels.ts: the variety identities + the Flamethrower, which is crafted / bought and never a find). Nothing else
// changed: the names here keep "weapon variety", the set of ids they answer for is lazyWeaponModelUrl's.
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from '../assets/loader';
import {isLazyModelWeapon, lazyWeaponModelUrl} from '../weapons/lazyWeaponModels';

type Model = Pick<GLTF, 'scene'>;
const loaded = new Map<string, Model>();
const pending = new Map<string, Promise<boolean>>();
/** The warm prototypes (below) are rebuilt on their next request after the resident set changed. */
let warmDirty = true;
/** Fetch counts (QA / tests): files fetched, failures, fetches started after a level was built, fetches started by a surface's demand, retries. */
export const WEAPON_VARIETY_MODEL_STATS = {fetched: 0, failed: 0, late: 0, demanded: 0, retries: 0};

/**
 * Retry rule of a failed fetch: the delay before attempt n + 1 (the last value repeats), and how many attempts in a row are made on
 * their own while the weapon is still wanted (a later request starts again).
 */
export const WEAPON_VARIETY_RETRY = {delaysMs: [1500, 4000, 10000, 30000] as number[], maxAuto: 10};

/** How a model file is fetched and decoded: the browser's GLTFLoader over the page's base URL (assets/loader.ts assetUrl). */
type ModelLoader = (id: string, url: string) => Promise<Model>;
const browserLoader: ModelLoader = (_id, url) => new GLTFLoader().loadAsync(assetUrl(url));
/** A real page (a base URL to resolve the relative asset path against)? Node — also with a test's stub window / document — has none. */
const inBrowser = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI.length > 0;
let customLoader: ModelLoader | null = null;
/** The loader in force: a swapped-in one, else the browser's; null without a browser (nothing is ever fetched then). */
const activeLoader = (): ModelLoader | null => customLoader ?? (inBrowser() ? browserLoader : null);
/** Swap the loader (tests / a QA harness; null = back to the default). Returns the previous swapped-in one. */
export function setWeaponVarietyLoader(fn: ModelLoader | null): ModelLoader | null {
  const prev = customLoader;
  customLoader = fn;
  return prev;
}

interface Failure { attempts: number; nextAt: number; error: string }
const failures = new Map<string, Failure>();
/** Ids a surface asked for (or a preload realized) that are not resident yet: a failed fetch of one of these is retried. */
const wanted = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface WeaponVarietyFailure { id: string; url: string; attempts: number; error: string; /** ms until the next attempt on its own (null: none scheduled). */ retryInMs: number | null }
const readyListeners = new Set<(ids: readonly string[]) => void>();
const failedListeners = new Set<(f: WeaponVarietyFailure) => void>();
/** Called (synchronously) whenever models became resident — by the section preload, a demand, a retry or registerWeaponVarietyModel. */
export function onWeaponVarietyReady(fn: (ids: readonly string[]) => void): () => void {
  readyListeners.add(fn);
  return () => { readyListeners.delete(fn); };
}
/** Called for every failed fetch attempt (the game reports it; the fetch is retried while the weapon is wanted). */
export function onWeaponVarietyFailed(fn: (f: WeaponVarietyFailure) => void): () => void {
  failedListeners.add(fn);
  return () => { failedListeners.delete(fn); };
}

/** The delivered model file of a lazily delivered weapon (null: not delivered / not one of them: weapons/lazyWeaponModels.ts). */
export function weaponVarietyModelUrl(id: string): string | null {
  return lazyWeaponModelUrl(id);
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

/** Swap a model in (the loader's result, tests, a re-delivery; null = unload). A model swapped in is announced (onWeaponVarietyReady). */
export function registerWeaponVarietyModel(id: string, gltf: Pick<GLTF, 'scene'> | null): void {
  if (gltf) { markShared(gltf); loaded.set(id, gltf); failures.delete(id); wanted.delete(id); } else loaded.delete(id);
  warmDirty = true;
  if (gltf) for (const fn of [...readyListeners]) { try { fn([id]); } catch (err) { console.warn('weapon variety: a ready listener failed', err); } }
}

/** Where a variety weapon's model stands (QA / the game's census). */
export type WeaponVarietyModelState = 'resident' | 'loading' | 'failed' | 'idle' | 'undelivered';
export function weaponVarietyModelState(id: string): WeaponVarietyModelState {
  if (loaded.has(id)) return 'resident';
  if (!weaponVarietyModelUrl(id)) return 'undelivered';
  return pending.has(id) ? 'loading' : failures.has(id) ? 'failed' : 'idle';
}
/** The last failure of each id that is still not resident (QA). */
export function weaponVarietyFailures(): Record<string, {attempts: number; error: string}> {
  return Object.fromEntries([...failures].map(([id, f]) => [id, {attempts: f.attempts, error: f.error}]));
}

/** Where a variety weapon's model comes from (QA). */
export function weaponVarietyModelSource(id: string): string {
  const url = weaponVarietyModelUrl(id);
  if (loaded.has(id)) return `meshy-t2.5 ${url ?? '(registered)'}`;
  return url ? `not loaded yet (${url})` : 'not delivered (no model: the weapon is never realized as a find)';
}

/** One fetch of `id` (shared by every caller while it is in flight). Resolves true when the model is resident. Never rejects. */
function fetchOne(id: string, late: boolean): Promise<boolean> {
  let p = pending.get(id);
  if (p) return p;
  const url = weaponVarietyModelUrl(id), load = activeLoader();
  if (!url || !load) return Promise.resolve(false);
  if (late) WEAPON_VARIETY_MODEL_STATS.late++;
  let attempt: Promise<Model>;
  try { attempt = load(id, url); } catch (err) { attempt = Promise.reject(err); }
  p = attempt.then(g => {
    if (!g?.scene) throw new Error('the file holds no scene');
    WEAPON_VARIETY_MODEL_STATS.fetched++;
    pending.delete(id); // (before the announcement: a listener sees the model resident, nothing in flight)
    registerWeaponVarietyModel(id, g);
    return true;
  }).catch(err => {
    pending.delete(id);
    WEAPON_VARIETY_MODEL_STATS.failed++;
    const attempts = (failures.get(id)?.attempts ?? 0) + 1, d = WEAPON_VARIETY_RETRY.delaysMs;
    const delay = d[Math.min(attempts - 1, d.length - 1)] ?? 30000;
    const error = String((err as Error)?.message ?? err).slice(0, 200);
    failures.set(id, {attempts, nextAt: now() + delay, error});
    const auto = wanted.has(id) && attempts < WEAPON_VARIETY_RETRY.maxAuto;
    console.warn(`weapon variety: ${url} did not load (attempt ${attempts}) — ${id} shows no model yet${auto ? `; retrying in ${Math.round(delay / 100) / 10} s` : ''}`, err);
    for (const fn of [...failedListeners]) { try { fn({id, url, attempts, error, retryInMs: auto ? delay : null}); } catch (e) { console.warn('weapon variety: a failure listener failed', e); } }
    if (auto) scheduleRetry();
    return false;
  });
  pending.set(id, p);
  return p;
}

/** One timer for the earliest due retry of a wanted, failed id. */
function scheduleRetry(): void {
  if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
  let due = Infinity;
  for (const id of wanted) { const f = failures.get(id); if (f && !pending.has(id) && !loaded.has(id) && f.attempts < WEAPON_VARIETY_RETRY.maxAuto) due = Math.min(due, f.nextAt); }
  if (due === Infinity) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    const t = now();
    for (const id of [...wanted]) {
      const f = failures.get(id);
      if (!f || pending.has(id) || loaded.has(id) || f.attempts >= WEAPON_VARIETY_RETRY.maxAuto || f.nextAt > t + 1) continue;
      WEAPON_VARIETY_MODEL_STATS.retries++;
      void fetchOne(id, true);
    }
    scheduleRetry();
  }, Math.max(0, due - now()));
}

/**
 * A SURFACE shows `id` (the held view, a world pickup, an item icon) and its model is not resident: start fetching it (idempotent and
 * cheap: nothing when it is resident / in flight / undelivered / waiting out a failed attempt's backoff). The model arrives through
 * onWeaponVarietyReady; a failure is reported and retried while the weapon stays wanted.
 */
export function requestWeaponVarietyModel(id: string): WeaponVarietyModelState {
  const st = weaponVarietyModelState(id);
  if (st === 'resident' || st === 'undelivered' || !activeLoader()) return st;
  wanted.add(id);
  if (st === 'loading') return st;
  const f = failures.get(id);
  if (f) {
    if (f.attempts >= WEAPON_VARIETY_RETRY.maxAuto) f.attempts = WEAPON_VARIETY_RETRY.maxAuto - 1; // a fresh request: one more attempt once the wait is over
    if (f.nextAt > now()) { scheduleRetry(); return 'failed'; }
  }
  WEAPON_VARIETY_MODEL_STATS.demanded++;
  void fetchOne(id, true);
  return 'loading';
}

/**
 * Fetch the delivered models of `ids` that are not resident yet (unknown / undelivered ids are skipped; no loader — no browser —:
 * nothing). Resolves with the ids that became resident in THIS call. Never rejects. An id whose fetch failed stays WANTED: it is
 * retried on its own (the section realized the weapon whatever the network did) and arrives through onWeaponVarietyReady.
 */
export async function ensureWeaponVarietyModels(ids: Iterable<string>, o: {late?: boolean} = {}): Promise<string[]> {
  if (!activeLoader()) return [];
  const want = [...new Set(ids)].filter(id => isLazyModelWeapon(id) && !loaded.has(id) && weaponVarietyModelUrl(id));
  if (!want.length) return [];
  const fresh: string[] = [];
  await Promise.all(want.map(async id => {
    const mine = !pending.has(id);
    wanted.add(id);
    const f = failures.get(id);
    if (f && mine) f.nextAt = 0; // a preload never waits out a backoff: it tries now
    if (await fetchOne(id, !!o.late) && mine) fresh.push(id); // (another caller's fetch: that caller reports it)
  }));
  return fresh.sort();
}

/** Tests: forget every model, failure, wish and timer (the listeners stay). */
export function resetWeaponVarietyModels(): void {
  loaded.clear(); pending.clear(); failures.clear(); wanted.clear();
  if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
  warmDirty = true;
  Object.assign(WEAPON_VARIETY_MODEL_STATS, {fetched: 0, failed: 0, late: 0, demanded: 0, retries: 0});
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
