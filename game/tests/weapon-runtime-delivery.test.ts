// Task studio-weapon-runtime-fix-20261110-022206-01 (user: "1337 on the train chest grants the new weapons, but they are TOTALLY
// INVISIBLE and item previews broken"): a new weapon's lazily loaded model reaches EVERY surface however the weapon arrives.
//  - the loader (world/weaponVarietyModels.ts): a surface's demand starts ONE fetch, callers share it, a model that arrives is announced,
//    a failed fetch is reported and retried while the weapon is wanted (a preload's failed find heals too);
//  - first realization never depends on what is loaded (the registry decides: no selection <-> loading loop);
//  - the REAL Lockbox gear drop through its real key path (LockboxSystem on a Game shell, fake DOM, the real keydown listener): the
//    view's own cells ask for the six new guns' models; the REAL held view (weapons/viewmodel.ts) shows the gun in hand when its model
//    arrives (once, never a stale / duplicate mesh), the REAL pickups (world/pickups.ts) trade their stand-in for the model in place
//    (same object, same stack / uid), the previews are rendered in one serialized queue that waits for a warm-up, and a failure is said.
// The model files are the REAL cooked GLBs (geometry, markers and parts as shipped; textures stripped: Node has no image decoder), parsed
// by three's GLTFLoader. Node only: the browser proof (real fetch, real renderer) is the QA harness of this task.
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {ITEMS, itemDef} from '../src/items/items';
import {WEAPONS} from '../src/weapons/weapons';
import {VARIETY_GUN_IDS, VARIETY_WEAPON_IDS} from '../src/weapons/varietyIds';
import {isLazyModelWeapon} from '../src/weapons/lazyWeaponModels';
import {WEAPON_VARIETY_MODELS} from '../src/assets/weaponVarietyModels.generated';
import {identityAvailable, weaponFindPlan} from '../src/items/weaponVariety';
import {
  WEAPON_VARIETY_MODEL_STATS, WEAPON_VARIETY_RETRY, ensureWeaponVarietyModels, onWeaponVarietyFailed, onWeaponVarietyReady,
  registerWeaponVarietyModel, requestWeaponVarietyModel, resetWeaponVarietyModels, residentWeaponVarietyIds, setWeaponVarietyLoader,
  weaponVarietyGltf, weaponVarietyModelState, weaponVarietyModelUrl, type WeaponVarietyFailure,
} from '../src/world/weaponVarietyModels';
import {WeaponVarietyDelivery, installWeaponVarietyDelivery} from '../src/world/weaponVarietyDelivery';
import {Viewmodel} from '../src/weapons/viewmodel';
import {PickupManager} from '../src/world/pickups';
import {itemIconHtml} from '../src/ui/itemIcons';
import {Input} from '../src/player/input';
import {LockboxSystem} from '../src/ui/lockboxView';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {starterInventory} from '../src/run/starter';
import {LEVELS} from '../src/levels/registry';
import type {Game} from '../src/game';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)
/** The canvas shim's factory (the Lockbox block swaps in a fake DOM: its canvases still come from here). */
const shimCanvas = ((globalThis as unknown as {document: {createElement(tag: string): unknown}}).document.createElement).bind(null, 'canvas');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../public');
const SRC = path.resolve(HERE, '../src');
const src = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

/** A shipped GLB parsed by three's GLTFLoader (textures stripped: Node has no image decoder). Cached per file. */
const glbCache = new Map<string, Promise<GLTF>>();
function loadGlb(rel: string): Promise<GLTF> {
  let p = glbCache.get(rel);
  if (!p) {
    p = (async () => {
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
      const doc = await io.read(path.join(PUBLIC, rel));
      for (const t of doc.getRoot().listTextures()) t.dispose();
      const bin = await io.writeBinary(doc);
      return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
    })();
    glbCache.set(rel, p);
  }
  return p;
}
const verts = (o: THREE.Object3D): number => { let n = 0; o.traverse(m => { const mesh = m as THREE.Mesh; if (mesh.isMesh) n += mesh.geometry.attributes.position.count; }); return n; };

/** The loader under test: the real files, with a gate (hold / fail per id) and a call log. */
function gatedLoader() {
  const calls: string[] = [], holds = new Map<string, {release: () => void}>(), failing = new Map<string, number>();
  const loader = async (id: string, url: string): Promise<GLTF> => {
    calls.push(id);
    const left = failing.get(id) ?? 0;
    if (left > 0) { failing.set(id, left - 1); throw new Error(`simulated network failure for ${url}`); }
    if (holds.has(id)) await new Promise<void>(r => { holds.get(id)!.release = r; });
    return loadGlb(url);
  };
  return {
    loader, calls,
    /** The next fetch of `id` waits until release(id). */
    hold: (id: string) => { holds.set(id, {release: () => {}}); },
    release: (id: string) => { const h = holds.get(id); holds.delete(id); h?.release(); },
    /** The next `n` fetches of `id` fail. */
    fail: (id: string, n: number) => { failing.set(id, n); },
  };
}

let guns: {rifle: GLTF; shotgun: GLTF; pistol: GLTF};
const savedRetry = {delaysMs: [...WEAPON_VARIETY_RETRY.delaysMs], maxAuto: WEAPON_VARIETY_RETRY.maxAuto};
beforeAll(async () => {
  guns = {rifle: await loadGlb('assets/models/rifle-user.glb'), shotgun: await loadGlb('assets/models/shotgun-user.glb'), pistol: await loadGlb('assets/models/pistol.glb')};
  for (const id of VARIETY_WEAPON_IDS) await loadGlb(WEAPON_VARIETY_MODELS[id]!.url); // (parsed once up front: the tests time the logic, not the parse)
}, 120000);
beforeEach(() => { resetWeaponVarietyModels(); WEAPON_VARIETY_RETRY.delaysMs = [15, 15, 15]; WEAPON_VARIETY_RETRY.maxAuto = 10; });
const worlds: WeaponVarietyDelivery[] = [];
afterEach(() => {
  for (const d of worlds.splice(0)) d.dispose();
  setWeaponVarietyLoader(null); resetWeaponVarietyModels(); Object.assign(WEAPON_VARIETY_RETRY, {delaysMs: [...savedRetry.delaysMs], maxAuto: savedRetry.maxAuto});
});

describe('the loader: demand, one shared fetch, announcements, retries', () => {
  it('without a browser (and no swapped-in loader) nothing is ever fetched: a request / a preload are no-ops', async () => {
    expect(requestWeaponVarietyModel('stub')).toBe('idle');
    expect(await ensureWeaponVarietyModels(['stub', 'hornet'])).toEqual([]);
    expect([weaponVarietyModelState('stub'), WEAPON_VARIETY_MODEL_STATS.fetched, WEAPON_VARIETY_MODEL_STATS.demanded]).toEqual(['idle', 0, 0]);
    expect(requestWeaponVarietyModel('rifle')).toBe('undelivered'); // a baseline gun is a boot model, never this loader's
  });

  it('a request starts ONE fetch; requests and a preload in flight share it; the arrival is announced once; then it is resident', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const ready: string[][] = [];
    const off = onWeaponVarietyReady(ids => ready.push([...ids]));
    L.hold('stub');
    expect(requestWeaponVarietyModel('stub')).toBe('loading');
    expect(requestWeaponVarietyModel('stub')).toBe('loading');
    const pre = ensureWeaponVarietyModels(['stub']); // (a section preload meanwhile: the same fetch)
    await flush();
    expect([L.calls, weaponVarietyModelState('stub'), ready]).toEqual([['stub'], 'loading', []]);
    L.release('stub');
    expect(await pre).toEqual([]); // not this caller's fetch: the demand's (it is announced through the listener, once)
    expect([ready, weaponVarietyModelState('stub'), residentWeaponVarietyIds(), requestWeaponVarietyModel('stub')]).toEqual([[['stub']], 'resident', ['stub'], 'resident']);
    expect(L.calls).toEqual(['stub']);
    expect(verts(weaponVarietyGltf('stub')!.scene)).toBeGreaterThan(15000); // the real cooked model
    expect(WEAPON_VARIETY_MODEL_STATS).toMatchObject({fetched: 1, failed: 0, demanded: 1});
    off();
  });

  it('a preload resolves with the ids IT fetched and announces them before it resolves', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const ready: string[] = [];
    const off = onWeaponVarietyReady(ids => ready.push(...ids));
    expect(await ensureWeaponVarietyModels(['thresher', 'crowbar', 'rifle', 'nope'])).toEqual(['crowbar', 'thresher']);
    expect(ready.sort()).toEqual(['crowbar', 'thresher']);
    expect(await ensureWeaponVarietyModels(['thresher'])).toEqual([]);
    off();
  });

  it('a failed fetch is reported and retried on its own while the weapon is wanted; the model then arrives through the same announcement', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const ready: string[] = [], failed: WeaponVarietyFailure[] = [];
    const offs = [onWeaponVarietyReady(ids => ready.push(...ids)), onWeaponVarietyFailed(f => failed.push(f))];
    L.fail('hornet', 2);
    expect(requestWeaponVarietyModel('hornet')).toBe('loading');
    await flush(8);
    expect(failed.map(f => [f.id, f.attempts, f.retryInMs !== null, /simulated network failure/.test(f.error), f.url])).toEqual([['hornet', 1, true, true, 'assets/models/weapon-hornet.glb']]);
    expect([weaponVarietyModelState('hornet'), requestWeaponVarietyModel('hornet')]).toEqual(['failed', 'failed']); // waiting out the backoff: no hammering
    expect(L.calls).toEqual(['hornet']);
    await sleep(120);
    expect([L.calls, failed.map(f => f.attempts), ready, weaponVarietyModelState('hornet')]).toEqual([['hornet', 'hornet', 'hornet'], [1, 2], ['hornet'], 'resident']);
    expect(WEAPON_VARIETY_MODEL_STATS).toMatchObject({fetched: 1, failed: 2, retries: 2});
    for (const o of offs) o();
  });

  it('a PRELOAD whose fetch failed keeps the weapon wanted: the realized find heals by itself', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const ready: string[] = [];
    const off = onWeaponVarietyReady(ids => ready.push(...ids));
    L.fail('coach_gun', 1);
    expect(await ensureWeaponVarietyModels(['coach_gun'])).toEqual([]); // the section goes on (the find is realized whatever the network did)
    expect(weaponVarietyModelState('coach_gun')).toBe('failed');
    await sleep(80);
    expect([ready, weaponVarietyModelState('coach_gun')]).toEqual([['coach_gun'], 'resident']);
    off();
  });

  it('automatic retries are bounded; a fresh request after the bound tries again', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    WEAPON_VARIETY_RETRY.maxAuto = 3;
    L.fail('machete', 99);
    requestWeaponVarietyModel('machete');
    await sleep(150);
    expect(L.calls.length).toBe(3); // 1 + 2 retries, then it rests
    L.fail('machete', 0);
    await sleep(30);
    expect(requestWeaponVarietyModel('machete')).toBe('loading');
    await sleep(40);
    expect([L.calls.length, weaponVarietyModelState('machete')]).toEqual([4, 'resident']);
  });
});

describe('first realization never depends on the loaded cache (no selection <-> loading loop)', () => {
  it('every new weapon is available from the generated registry alone; a station\'s find plan is the same with nothing / everything loaded', () => {
    expect(residentWeaponVarietyIds()).toEqual([]);
    for (const id of VARIETY_WEAPON_IDS) expect([id, identityAvailable(id), !!weaponVarietyModelUrl(id)]).toEqual([id, true, true]);
    const plans = (seed: number) => {
      const layout = LEVELS.subway.generate('main', {levelSeed: seed, startWeapon: 'pistol', gear: []});
      return JSON.stringify(weaponFindPlan(layout, 'subway', `st-00:main`).finds.map(f => [f.index, f.itemId, f.mag, f.boxAfter]));
    };
    const cold = [11, 16, 20].map(plans);
    expect(cold.join('|')).toMatch(/stub|overwatch|coach_gun|thresher|fire_axe|machete|sledgehammer|crowbar|slugger|track_shovel/); // new identities ARE planned cold
    for (const id of VARIETY_WEAPON_IDS) registerWeaponVarietyModel(id, {scene: new THREE.Group()});
    expect([11, 16, 20].map(plans)).toEqual(cold);
  });
});

/** The delivery over the REAL held view and pickups, with a recording host. */
function world() {
  const viewmodel = new Viewmodel(guns, {});
  const pickups = new PickupManager(guns as unknown as Record<string, GLTF>);
  const log = {sync: 0, said: [] as [string, boolean][], icons: [] as string[][], reskinned: [] as number[]};
  let gate: Promise<void> | null = null, openGate: (() => void) | null = null;
  pickups.onReskin = p => log.reskinned.push(p.id);
  const delivery = installWeaponVarietyDelivery({
    viewmodel: () => viewmodel, pickups: () => pickups, syncHeld: () => { log.sync++; },
    refreshIcons: async ids => { await sleep(2); log.icons.push([...ids]); },
    rendererFree: () => gate,
    say: (text, bad) => log.said.push([text, bad]), itemName: id => itemDef(id).short,
  });
  delivery.attach();
  worlds.push(delivery);
  return {viewmodel, pickups, delivery, log,
    /** A warm-up owns the renderer until the returned function is called. */
    warmup: () => { gate = new Promise<void>(r => { openGate = () => { gate = null; r(); }; }); return () => openGate?.(); }};
}
/** The holders under the held view's pivot that are VISIBLE (the gun actually shown). */
const shown = (vm: Viewmodel): number => vm.warmRoots().filter(o => o.type === 'Group' && o.visible && o.parent && o !== vm.warmRoots()[0]).length;

describe('the Lockbox 1337 gear drop through its real key path', () => {
  const g = globalThis as unknown as {window?: unknown; document?: unknown};
  const saved = {window: g.window, document: g.document};
  const listeners: {type: string; fn: (e: unknown) => void; capture: boolean}[] = [];
  let dom: FakeDom;
  beforeAll(() => {
    dom = installFakeDom();
    const make = dom.doc.createElement.bind(dom.doc);
    (dom.doc as unknown as {createElement(t: string): unknown}).createElement = (t: string) => (t === 'canvas' ? shimCanvas() : make(t)); // (the held view's flash texture)
    g.window = {addEventListener: (type: string, fn: (e: unknown) => void, o?: boolean | {capture?: boolean}) => { listeners.push({type, fn, capture: typeof o === 'boolean' ? o : !!o?.capture}); },
      removeEventListener() {}, innerWidth: 1280, innerHeight: 720};
  });
  afterAll(() => { dom.uninstall(); g.window = saved.window; g.document = saved.document; });
  const key = (code: string) => {
    let stopped = false;
    const e = {code, key: code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: {tagName: 'BODY'}, preventDefault() {}, stopPropagation: () => { stopped = true; }};
    for (const l of listeners.filter(x => x.type === 'keydown' && x.capture)) l.fn(e);
    if (!stopped) for (const l of listeners.filter(x => x.type === 'keydown' && !x.capture)) l.fn(e);
  };

  function lockbox(w: ReturnType<typeof world>) {
    listeners.length = 0;
    const input = new Input({addEventListener() {}} as unknown as HTMLCanvasElement, true);
    input.active = true;
    const train = {onLockboxInteract: null as null | (() => void), at: {x: 0, y: 0.55, z: 0}, lockboxAimed: true, setLockboxOpen() {}, lockboxWorld() { return this.at; }};
    const shell = {
      inv: starterInventory('pistol'), playerTrain: new PlayerTrainRecord(), trainRuntime: train, player: {x: 0.6, y: 0, z: -0.7, alive: true}, state: 'playing', qa: true, input,
      hud: {toast() {}}, sfx: {pickup() {}, denied() {}}, gear: {session: null as unknown, cancelReady() {}, showResume() {}},
      frameHooks: [] as ((dt: number) => void)[], hitListeners: [] as unknown[], stateListeners: [] as unknown[],
      sectionHooks: [] as unknown[], inputOwners: [] as (() => boolean)[],
      syncHeld: () => { const st = shell.inv.selectedStack(); w.viewmodel.setItem(st ? st.itemId : null); },
    };
    const sys = new LockboxSystem(shell as unknown as Game).install();
    return {sys, shell, train, box: shell.playerTrain.lockbox};
  }

  it('the grant puts the six new guns in the Lockbox, and the view showing them asks for exactly their models — which then reach the held view and the previews', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    const {sys, box, train, shell} = lockbox(w);
    train.onLockboxInteract!();
    expect(sys.isOpen).toBe(true);
    expect(L.calls).toEqual([]); // nothing asked for before the weapons exist anywhere
    for (const c of '1337') key(`Digit${c}`);
    expect(sys.lastGrant?.ok).toBe(true);
    const got = box.slots.filter(Boolean).map(s => s!.itemId);
    for (const id of VARIETY_GUN_IDS) expect(got, id).toContain(id);
    // the view rendered the new stacks: each cell's preview asked for its model (ui/itemIcons.ts itemIconHtml) — the new guns, nothing else
    // (task studio-flamethrower-fire-20261114-031614-01: the grant is every gun item — whichever of them has a lazily delivered model,
    // the variety guns and the Flamethrower when it is granted: weapons/lazyWeaponModels.ts)
    const lazyGuns = [...new Set(got.filter(isLazyModelWeapon))].sort();
    expect([...L.calls].sort()).toEqual(lazyGuns);
    expect(VARIETY_GUN_IDS.map(id => w.viewmodel.hasItem(id))).toEqual(VARIETY_GUN_IDS.map(() => false)); // (still on their way)
    await sleep(60);
    await w.delivery.settled();
    for (const id of VARIETY_GUN_IDS) expect([id, weaponVarietyModelState(id), w.viewmodel.hasItem(id)]).toEqual([id, 'resident', true]);
    expect(w.log.icons.flat().sort()).toEqual(lazyGuns); // every preview rendered (each id once)
    expect(new Set(w.log.icons.flat()).size).toBe(w.log.icons.flat().length);
    expect(w.log.said).toEqual([]);
    // take the Hornet out with the view's own quick move, close, select it: it is IN HAND
    const i = box.slots.findIndex(s => s?.itemId === 'hornet'), uid = box.slots[i]!.uid;
    expect(sys.view.quick({bar: 'store', index: i})).toBeGreaterThan(0);
    const slot = shell.inv.hotbar.findIndex(s => s?.itemId === 'hornet');
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(shell.inv.hotbar[slot]!.uid).toBe(uid); // the very stack (uid ownership exact)
    shell.inv.select(slot);
    shell.syncHeld();
    expect([w.viewmodel.heldItem, shown(w.viewmodel)]).toEqual(['hornet', 1]);
  });

  it('the old behaviour, pinned as the bug: before the fix nothing asked for a granted gun\'s model — now holding it BEFORE its file arrived shows it the moment it does', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    for (const id of VARIETY_GUN_IDS) L.hold(id);
    const {sys, box, shell, train} = lockbox(w);
    train.onLockboxInteract!();
    for (const c of '1337') key(`Digit${c}`);
    const i = box.slots.findIndex(s => s?.itemId === 'thresher');
    sys.view.quick({bar: 'store', index: i});
    const slot = shell.inv.hotbar.findIndex(s => s?.itemId === 'thresher');
    shell.inv.select(slot);
    shell.syncHeld();
    expect([w.viewmodel.heldItem, w.viewmodel.wantedItem, shown(w.viewmodel), weaponVarietyModelState('thresher')]).toEqual([null, 'thresher', 0, 'loading']); // in flight: nothing to show yet
    L.release('thresher');
    await sleep(40);
    expect([w.viewmodel.heldItem, shown(w.viewmodel)]).toEqual(['thresher', 1]); // no reselect, no station change
    expect(w.log.sync).toBeGreaterThan(0);
    for (const id of VARIETY_GUN_IDS) L.release(id);
    await sleep(40);
    await w.delivery.settled();
  });
});

describe('the held view: shown on arrival, never stale or doubled', () => {
  it('asks for a missing weapon model (onMissing), shows it on arrival only when it is still the item in hand; a re-delivery replaces the copy', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    L.hold('stub');
    w.viewmodel.setItem('stub');
    expect([L.calls, w.viewmodel.heldItem, w.viewmodel.wantedItem]).toEqual([['stub'], null, 'stub']);
    w.viewmodel.setItem('pistol'); // switched away before it arrived
    expect(w.viewmodel.heldItem).toBe('pistol');
    L.release('stub');
    await sleep(40);
    expect([w.viewmodel.hasItem('stub'), w.viewmodel.heldItem, shown(w.viewmodel)]).toEqual([true, 'pistol', 1]); // registered, NOT forced into the hand
    w.viewmodel.setItem('stub');
    expect([w.viewmodel.heldItem, shown(w.viewmodel)]).toEqual(['stub', 1]);
    const roots = w.viewmodel.warmRoots().length;
    registerWeaponVarietyModel('stub', weaponVarietyGltf('stub')!); // a re-delivery (a re-cook, a retry racing a preload)
    expect([w.viewmodel.warmRoots().length, w.viewmodel.heldItem, shown(w.viewmodel)]).toEqual([roots, 'stub', 1]); // replaced, not added
    w.viewmodel.setItem(null);
    expect([w.viewmodel.heldItem, shown(w.viewmodel)]).toEqual([null, 0]);
    expect(L.calls).toEqual(['stub']);
    // an item that simply has no held model (gear, empty hands) asks for nothing
    w.viewmodel.setItem('armor_vest');
    w.viewmodel.setItem(null);
    expect(L.calls).toEqual(['stub']);
  });

  it('a held view built AFTER models were loaded gets them all (attach)', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    await ensureWeaponVarietyModels(['slugger', 'overwatch']);
    const w = world();
    expect([w.viewmodel.hasItem('slugger'), w.viewmodel.hasItem('overwatch'), w.viewmodel.hasItem('stub')]).toEqual([true, true, false]);
    await w.delivery.settled();
    w.delivery.attach(); // idempotent
    expect(w.delivery.counts.held).toBe(2);
  });

  it('all twelve real models register a held copy with its Grip pivot and movable parts', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    await ensureWeaponVarietyModels(VARIETY_WEAPON_IDS);
    for (const id of VARIETY_WEAPON_IDS) {
      expect([id, w.viewmodel.hasItem(id), !!WEAPONS[id], !!ITEMS[id]]).toEqual([id, true, true, true]);
      w.viewmodel.setItem(id);
      expect([id, w.viewmodel.heldItem, shown(w.viewmodel)]).toEqual([id, id, 1]);
    }
    await w.delivery.settled();
  });
});

describe('world pickups: a stand-in becomes the real model in place', () => {
  it('a weapon dropped before its model arrived: same object, same stack and uid, real meshes with their own material copies, the physics told', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    L.hold('thresher');
    const inv = starterInventory('pistol');
    const stack = inv.makeStack('thresher', 1, 5);
    const p = w.pickups.add(stack, 3, 0, 4, 0.7);
    const obj = p.obj, before = verts(obj);
    expect([L.calls, w.pickups.awaitingModels(), obj.userData.awaitingModel]).toEqual([['thresher'], {thresher: 1}, 'thresher']);
    const other = w.pickups.add(inv.makeStack('thresher', 1), 5, 0, 4); // a second one, taken before the model arrives
    w.pickups.remove(other);
    L.release('thresher');
    await sleep(40);
    const real = verts(weaponVarietyGltf('thresher')!.scene);
    expect([p.obj === obj, verts(obj), real > before, w.pickups.awaitingModels(), obj.userData.awaitingModel]).toEqual([true, real, true, {}, undefined]);
    expect([obj.position.toArray(), +obj.rotation.y.toFixed(3), obj.parent === w.pickups.group]).toEqual([[3, 0, 4], 0.7, true]);
    expect([p.stack === stack, p.stack.uid, p.stack.mag, p.stack.itemId]).toEqual([true, stack.uid, 5, 'thresher']);
    const shared = new Set<THREE.Material>();
    weaponVarietyGltf('thresher')!.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) for (const x of [m.material].flat()) shared.add(x); });
    expect(p.mats.length).toBeGreaterThan(0);
    for (const m of p.mats) expect(shared.has(m)).toBe(false); // its own copies (the look-at highlight tints them)
    let onObj = 0;
    obj.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) for (const x of [m.material].flat()) { expect(p.mats).toContain(x); onObj++; } });
    expect(onObj).toBe(p.mats.length);
    expect([w.log.reskinned, w.pickups.reskinCounts.pickups, verts(other.obj) < real]).toEqual([[p.id], 1, true]); // the removed one was left alone
    // the bottom of the real model lies on the floor like any found gun (PickupManager.meshFor's transform)
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    expect(Math.abs(box.min.y)).toBeLessThan(0.01);
    expect(box.max.x - box.min.x > 0.5 || box.max.z - box.min.z > 0.5).toBe(true);
    // from now on a new pickup of it is the real model at once
    const again = w.pickups.add(inv.makeStack('thresher', 1), 7, 0, 4);
    expect([verts(again.obj), again.obj.userData.awaitingModel, w.pickups.awaitingModels()]).toEqual([real, undefined, {}]);
  });

  it('a stand-in that is not a pickup (train cargo\'s riding copy) is re-skinned in place too and keeps its owner\'s storey tag', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    L.hold('overwatch');
    const riding = w.pickups.meshFor('overwatch');
    riding.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = 1; });
    riding.position.set(2, 1, 3);
    L.release('overwatch');
    await sleep(40);
    let meshes = 0;
    riding.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes++; expect(o.userData.level).toBe(1); } });
    expect([meshes > 0, verts(riding) > 10000, riding.position.toArray(), riding.userData.awaitingModel, w.pickups.reskinCounts.objects, w.pickups.reskinCounts.pickups]).toEqual([true, true, [2, 1, 3], undefined, 1, 0]);
  });

  it('a baseline gun and a non-weapon never wait for anything', () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    const inv = starterInventory('pistol');
    w.pickups.add(inv.makeStack('shotgun', 1), 0, 0, 0);
    w.pickups.add(inv.makeStack('water', 2), 1, 0, 0);
    expect([L.calls, w.pickups.awaitingModels()]).toEqual([[], {}]);
  });
});

describe('previews: one serialized queue that never renders under a warm-up', () => {
  it('icons wait for the warm-up, then one batch holds everything that arrived meanwhile; settled() resolves after them', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    const done = w.warmup();
    await ensureWeaponVarietyModels(['stub']);
    await ensureWeaponVarietyModels(['crowbar', 'machete']);
    await sleep(15);
    expect([w.log.icons, w.viewmodel.hasItem('stub'), w.viewmodel.hasItem('machete')]).toEqual([[], true, true]); // held copies at once; no icon render yet
    let settled = false;
    const s = w.delivery.settled().then(() => { settled = true; });
    await sleep(15);
    expect(settled).toBe(false);
    done();
    await s;
    expect([settled, w.log.icons.map(b => [...b].sort())]).toEqual([true, [['crowbar', 'machete', 'stub']]]);
    await ensureWeaponVarietyModels(['slugger']);
    await w.delivery.settled();
    expect(w.log.icons.length).toBe(2);
    expect(w.log.icons[1]).toEqual(['slugger']);
  });

  it('a surface that draws a preview asks for the model; the glyph stands in until the render exists', () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    L.hold('longslide');
    const html = itemIconHtml('longslide');
    expect(html.startsWith('<svg')).toBe(true); // the truthful fallback (ui/weaponVarietyIcons.ts) — and the request is out
    expect(L.calls).toEqual(['longslide']);
    itemIconHtml('longslide'); itemIconHtml('rifle'); itemIconHtml('water');
    expect(L.calls).toEqual(['longslide']);
    L.release('longslide');
  });
});

describe('a failed load is said, not hidden', () => {
  it('one line per weapon when its model fails, one when it then loads; the stand-in on the floor and the hand both recover', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    L.fail('coach_gun', 2);
    const inv = starterInventory('pistol');
    const p = w.pickups.add(inv.makeStack('coach_gun', 1, 2), 0, 0, 0);
    w.viewmodel.setItem('coach_gun');
    await flush(8);
    expect(w.log.said).toEqual([['Coach gun: its model did not load — trying again', true]]);
    expect([w.viewmodel.heldItem, p.obj.userData.awaitingModel]).toEqual([null, 'coach_gun']);
    await sleep(120);
    expect(w.log.said).toEqual([['Coach gun: its model did not load — trying again', true], ['Coach gun: its model has loaded', false]]); // said once each (2 failures)
    expect([w.viewmodel.heldItem, p.obj.userData.awaitingModel, verts(p.obj) > 10000, p.stack.mag]).toEqual(['coach_gun', undefined, true, 2]);
    await w.delivery.settled();
    expect(w.delivery.qa().saidFailed).toEqual([]);
  });
});

describe('the game is wired to the one delivery', () => {
  const game = src('game.ts');
  it('installs it once, attaches it when the boot built the held view and the pickups, and the section preload only preloads', () => {
    expect(game).toContain('this.weaponVariety = installWeaponVarietyDelivery({');
    expect(game).toContain('this.weaponVariety.attach();');
    expect(game).toContain('this.pickups.onReskin = p => this.physics?.dynamicItems.pickupReskinned(p);');
    expect(game).toContain('rendererFree: () => this.warmRun,');
    expect(game).toMatch(/await ensureWeaponVarietyModels\(ids, \{late\}\);\s+if \(!late\) await this\.weaponVariety\.settled\(\);/);
    expect(game).not.toMatch(/vm\?\.addModel\?\.\(/); // the old hand-over that only ran inside the preload is gone
    expect(game).toContain('await this.prepareWeaponVariety(layout, key, run);');
    expect(game).toContain('void this.prepareWeaponVariety(null, key, this.run, true);');
  });

  it('every item view redraws when a preview arrives; the HUD keys its slots on the icon cache', () => {
    for (const f of ['ui/lockboxView.ts', 'ui/bagView.ts', 'market/trade/tradeView.ts']) expect(src(f), f).toMatch(/onItemIconsChanged\(\(\) => \{ if \(this\.visible/);
    expect(game).toMatch(/onItemIconsChanged\(\(\) => \{ if \(this\.state === 'inventory' && !this\.invUI\.dragging\) this\.invUI\.render\(\); \}\);/);
    expect(src('ui/hud.ts')).toContain('itemIconsVersion()');
    expect(src('ui/itemIcons.ts')).toContain('if (isLazyModelWeapon(itemId) && !weaponVarietyGltf(itemId)) requestWeaponVarietyModel(itemId);');
  });

  it('an icon render hands the renderer back before it awaits its readback (frames are drawn between two icons)', () => {
    const s = src('ui/itemIcons.ts');
    const body = s.slice(s.indexOf('async function renderShots'), s.indexOf('/**\n * Renders every catalogue item once'));
    const render = body.indexOf('renderer.render(scene, cam);'), restore = body.indexOf('renderer.setRenderTarget(prevTarget);'), read = body.indexOf('await renderer.readRenderTargetPixelsAsync');
    expect(render).toBeGreaterThan(0);
    expect(restore).toBeGreaterThan(render);
    expect(read).toBeGreaterThan(restore);
    expect(body.match(/renderer\.setRenderTarget\(prevTarget\)/g)).toHaveLength(1);
  });
});

describe('the delivery itself', () => {
  it('dispose() unhooks it (nothing is delivered afterwards)', async () => {
    const L = gatedLoader();
    setWeaponVarietyLoader(L.loader);
    const w = world();
    w.delivery.dispose();
    await ensureWeaponVarietyModels(['crowbar']);
    expect([w.viewmodel.hasItem('crowbar'), w.viewmodel.onMissing]).toEqual([false, null]);
    expect(new WeaponVarietyDelivery({viewmodel: () => null, pickups: () => null, syncHeld() {}, refreshIcons: async () => {}, say() {}, itemName: id => id}).install().qa().attached).toBe(false);
  });
});
