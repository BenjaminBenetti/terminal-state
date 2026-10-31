// Task gasmask-breach-20261030 (mask lane): the gas mask (gear 'gas_mask', face slot) and filters ('gas_filter', a passive supply).
// Node tests over the REAL GasMaskSystem (gear/gasMask.ts) installed on a minimal Game shell (registries + the real Inventory /
// WeaponController), the real snapshot / run-participant code (run/snapshot.ts), section-memory records (run/worldMemory.ts),
// the level loot roll / placement (gen/maskLoot.ts through levels/gearAdapter.ts + registry.ts on generated levels), the HUD Q cell
// on the tiny fake DOM, and source checks of the Q binding in game.ts / gear/system.ts. (The first-person mask view that replaced
// the camera mask layer: tests/gas-mask-view.test.ts.)
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {GAS_MASK, installGasMask, type MaskHudView} from '../src/gear/gasMask';
import {FILTER_LIFE_S, GEAR_ITEMS, GEAR_SLOTS, gearStatText, isFilterMask} from '../src/items/gear';
import {ITEMS, itemDef, itemDims} from '../src/items/items';
import {Inventory, stackFromJSON, stackToJSON, type InventoryJSON, type ItemStack, type SlotRef} from '../src/items/inventory';
import {WeaponController, type WeaponEvent} from '../src/weapons/weapons';
import {resetParticipants, restoreCarry, restoreParticipants, takeSnapshot, type RunParticipant} from '../src/run/snapshot';
import {starterInventory} from '../src/run/starter';
import {stackFromRecord, stackRecord} from '../src/run/worldMemory';
import {GEAR_MIN_SPAWN_M, gearAreaWeight, rollLevelGear as rollGearOnly} from '../src/gen/gearLoot';
import {MASK_LOOT, isMaskLootItem, rollMaskLoot} from '../src/gen/maskLoot';
import {rollLevelGear as rollRunGear} from '../src/levels/gearAdapter';
import {LEVELS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import type {StationLayout} from '../src/gen/stationTypes';
import {GAME_KEYS} from '../src/player/input';
import {GAS_MASK_OUTFIT_MESH, gearItemModel, gearModelSource, registerGasMaskOutfit} from '../src/gear/models';
import {ICONS} from '../src/ui/icons';
import {ITEM_CLASS, ITEM_PHYSICS} from '../src/damage/materials';
import type {Game} from '../src/game';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';

installCanvasShim(false);

const DT = 1 / 60;
const MASK: SlotRef = {bar: 'gear', index: GEAR_SLOTS.indexOf('mask')};
const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const P = (index: number): SlotRef => ({bar: 'pack', index});
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** A Game shell with exactly what GasMaskSystem touches (the registries are the Game's own arrays in the real game). */
function shell() {
  const toasts: {text: string; warn: boolean}[] = [];
  const calls = {cancelUse: [] as string[], cancelFlare: 0, denied: 0, battery: 0, rustle: [] as boolean[], cancelReady: [] as boolean[], changed: 0};
  const pools: Record<string, () => readonly THREE.Object3D[]> = {};
  let view: MaskHudView | null = null;
  const gear = {
    readied: false, viewOpen: false, holdProgress: null as number | null,
    cancelReady(resync: boolean) { calls.cancelReady.push(resync); this.readied = false; },
  };
  const g = {
    scene: new THREE.Scene(), frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[],
    stateListeners: [] as ((s: string, prev: string) => void)[], inputOwners: [] as (() => boolean)[], runParticipants: [] as RunParticipant[],
    invUI: {gear: {dropBag: () => null as string | null, changed: () => { calls.changed++; }}},
    warmRegistry: {addPool: (n: string, f: () => readonly THREE.Object3D[]) => { pools[n] = f; }},
    inv: new Inventory(), weapon: new WeaponController(), gear, state: 'playing', player: {alive: true},
    hud: {toast: (text: string, warn = false) => { toasts.push({text, warn}); }, setMask: (v: MaskHudView | null) => { view = v; }},
    sfx: {denied() { calls.denied++; }, batteryInsert() { calls.battery++; }, maskRustle(on: boolean) { calls.rustle.push(on); }},
  };
  const sys = installGasMask(g as unknown as Game, {cancelUse: r => { calls.cancelUse.push(r); }, cancelFlareHold: () => { calls.cancelFlare++; }});
  /** `seconds` of frames (each frame runs every frame hook, as Game.update does while playing). */
  const step = (seconds = DT, dt = DT) => { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) for (const f of g.frameHooks) f(dt); };
  const setState = (s: string) => { const prev = g.state; g.state = s; for (const f of g.stateListeners) f(s, prev); };
  const mask = (filter?: number): ItemStack => { const st = g.inv.makeStack('gas_mask', 1); if (filter !== undefined) st.filter = filter; return st; };
  const giveMask = (filter?: number): ItemStack => { const st = mask(filter); expect(g.inv.add(st)).toBe(0); return st; };
  const giveFilters = (n: number) => { const st = g.inv.makeStack('gas_filter', n); st.count = n; expect(g.inv.add(st)).toBe(0); };
  const owns = () => g.inputOwners.some(f => f());
  /** Q fully through: the press, then the whole transition. */
  const toggle = () => { const r = sys.press(); step(0.7); return r; };
  return {g, sys, toasts, calls, pools, step, setState, mask, giveMask, giveFilters, owns, toggle, view: () => view};
}

/** Every item id with its total count, quick slots + pockets + gear + grenade slot + worn-bag contents (dupes / losses). */
const totals = (inv: Inventory) => {
  const out: Record<string, number> = {};
  for (const s of inv.allStacks(true)) out[s.itemId] = (out[s.itemId] ?? 0) + s.count;
  return out;
};

describe('items: the gas mask (gear, face slot) and the gas filter (passive supply)', () => {
  it('gas_mask is base-tier gear in the APPENDED mask slot (backpack keeps its index); gas_filter is a pocket-first supply, stack 6', () => {
    expect(GEAR_SLOTS.slice(0, 5)).toEqual(['helmet', 'chest', 'gloves', 'boots', 'backpack']);
    expect(GEAR_SLOTS.at(-1)).toBe('mask');
    expect(ITEMS.gas_mask).toBe(GEAR_ITEMS.gas_mask);
    expect(itemDef('gas_mask')).toMatchObject({kind: 'gear', stackMax: 1, icon: 'gasmask', gear: {slot: 'mask', tier: 1, filterLife: FILTER_LIFE_S}});
    expect(FILTER_LIFE_S).toBe(150);
    expect(GAS_MASK).toMatchObject({filterLifeS: 150, donS: 0.6, doffS: 0.45, lowFrac: 0.2, filterItem: 'gas_filter', lane: 'gas.mask'});
    expect(gearStatText(GEAR_ITEMS.gas_mask.gear!)).toMatch(/infectious gas.*filter/);
    expect(itemDef('gas_filter')).toMatchObject({kind: 'supply', stackMax: 6, icon: 'filter'});
    expect(isFilterMask('gas_mask')).toBe(true);
    expect(isFilterMask('helmet')).toBe(false);
    for (const id of ['gas_mask', 'gas_filter']) {
      expect(ICONS[itemDef(id).icon], id).toMatch(/^<svg/);
      expect(itemDims(id).h, id).toBeGreaterThan(0.05);
      expect(ITEM_CLASS[id], id).toBeDefined();
      expect(ITEM_PHYSICS[id], id).toBeDefined();
    }
    expect(ITEM_CLASS.gas_mask).toBe('rubber');
    // filters go to the pockets first (like ammo) and stack to 6
    const inv = new Inventory();
    const f = inv.makeStack('gas_filter', 9);
    expect(f.count).toBe(6);
    expect(inv.add(f)).toBe(0);
    expect(inv.pack[0]).toBe(f);
    expect(inv.hotbar.every(s => !s)).toBe(true);
    // a mask picked up with the face slot empty is worn (equipped) — the face state is the system's, not the inventory's
    const m = inv.makeStack('gas_mask', 1);
    expect(m.filter).toBeUndefined(); // a made stack carries no charge (no free filter anywhere)
    expect(inv.add(m)).toBe(0);
    expect(inv.get(MASK)).toBe(m);
    expect(inv.invariants()).toEqual([]);
  });

  it('the starter kit (NewGame) has no mask and no filters', () => {
    for (const w of ['pistol', 'rifle'] as const) {
      const inv = starterInventory(w);
      expect(inv.count('gas_filter')).toBe(0);
      expect(inv.allStacks(true).some(s => s.itemId === 'gas_mask' || s.itemId === 'gas_filter')).toBe(false);
    }
  });

  it('pickup / icon model: the procedural stand-in rests on the floor; the shipped outfit mesh is made static, grounded, centred, +Z front', () => {
    registerGasMaskOutfit(null);
    const stand = new THREE.Box3().setFromObject(gearItemModel('gas_mask'));
    expect(stand.min.y).toBeGreaterThanOrEqual(-0.005);
    expect(stand.max.y).toBeLessThan(0.3);
    expect(gearModelSource('gas_mask')).toMatch(/procedural/);
    // the outfit file's mesh: skinned (skin attributes), at head height, visor toward +Z
    const geo = new THREE.BoxGeometry(0.18, 0.18, 0.12).translate(0, 1.6, 0.07);
    const n = geo.attributes.position.count;
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
    const mat = new THREE.MeshStandardMaterial({name: 'Outfit_gasmaskMaterial'});
    const meshes = ['Outfit_gasmask__courier', GAS_MASK_OUTFIT_MESH].map(name => { const m = new THREE.Mesh(name === GAS_MASK_OUTFIT_MESH ? geo : new THREE.BoxGeometry(1, 1, 1), mat); m.name = name; return m; });
    const scene = new THREE.Group();
    scene.add(...meshes);
    registerGasMaskOutfit({scene} as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF);
    try {
      const t = gearItemModel('gas_mask');
      t.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(t);
      expect(box.min.y).toBeCloseTo(0, 5);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
      expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
      expect(box.max.y - box.min.y).toBeCloseTo(0.18, 4); // real size kept (the lastshift mesh, not the courier one)
      const out = t.children[0] as THREE.Mesh;
      expect((out as unknown as {isSkinnedMesh?: boolean}).isSkinnedMesh).toBeFalsy();
      expect(out.geometry.getAttribute('skinIndex')).toBeUndefined();
      expect(out.material).not.toBe(mat); // its own material copy (the wardrobe's stays untouched)
      // provenance stays as recorded: delivery review accepted (Meshy T2.5 migration), derivative record approved: false, no clearance
      expect(gearModelSource('gas_mask')).toMatch(/outfit-gasmask-t25\.glb.*review accepted.*approved: false, no licence clearance/);
    } finally {
      registerGasMaskOutfit(null);
    }
  });
});

describe('Q: on / off and arbitration (GasMaskSystem.press)', () => {
  it('no mask equipped: "No gas mask" + denied, nothing created or changed', () => {
    const s = shell();
    s.g.inv.set(H(0), s.g.inv.makeStack('pistol', 1, 15));
    const before = JSON.stringify(s.g.inv.toJSON());
    expect(s.sys.press()).toBe('no-mask');
    expect(s.toasts.at(-1)).toMatchObject({text: expect.stringMatching(/^No gas mask/), warn: true});
    expect(s.calls.denied).toBe(1);
    expect(JSON.stringify(s.g.inv.toJSON())).toBe(before);
    expect(s.calls.cancelUse).toEqual([]); // no side effects either
    expect(s.sys.state).toBe('off');
    // a mask in the POCKETS is not equipped: still refused
    s.g.inv.set(P(0), s.mask(60));
    expect(s.sys.press()).toBe('no-mask');
  });

  it('don 0.6 s -> on, doff 0.45 s -> off; Q mid-transition is ignored; unprotected while going on, at once when coming off', () => {
    const s = shell();
    s.giveMask(100);
    expect(s.sys.press()).toBe('donning');
    expect(s.calls.rustle).toEqual([true]);
    expect(s.owns()).toBe(true);
    s.step(0.3);
    expect(s.sys.press()).toBe('ignored');
    expect(s.sys.state).toBe('donning');
    expect(s.sys.protects()).toBe(false);
    expect(s.sys.cover).toBeGreaterThan(0.4);
    expect(s.sys.cover).toBeLessThan(0.6);
    s.step(0.25);
    expect(s.sys.state).toBe('donning');
    s.step(0.1);
    expect(s.sys.state).toBe('on');
    expect(s.sys.protects()).toBe(true);
    expect(s.owns()).toBe(false);
    expect(s.sys.press()).toBe('doffing');
    expect(s.sys.protects()).toBe(false); // doffing: unprotected at once
    expect(s.sys.press()).toBe('ignored');
    s.step(0.4);
    expect(s.sys.state).toBe('doffing');
    s.step(0.1);
    expect(s.sys.state).toBe('off');
    expect(s.calls.rustle).toEqual([true, false]);
  });

  it('cancels a timed use and a G flare hold; slings a readied backpack back on first; ignored in the bag view / an E hold / a knife swing / not playing / dead', () => {
    const s = shell();
    s.giveMask(100);
    s.g.gear.viewOpen = true;
    expect(s.sys.press()).toBe('ignored');
    s.g.gear.viewOpen = false;
    s.g.gear.holdProgress = 0.3;
    expect(s.sys.press()).toBe('ignored');
    s.g.gear.holdProgress = null;
    s.g.state = 'paused';
    expect(s.sys.press()).toBe('ignored');
    s.g.state = 'playing';
    s.g.player.alive = false;
    expect(s.sys.press()).toBe('ignored');
    s.g.player.alive = true;
    // a knife swing in progress (task knife-windup-20261030: a RELEASED swing is committed — Q waits for its recovery)
    const knife = s.g.inv.makeStack('knife', 1);
    s.g.inv.set(H(2), knife);
    s.g.weapon.equip(knife);
    for (let i = 0; i < 60 && s.g.weapon.phase === 'equipping'; i++) s.g.weapon.update(DT, {held: false, pressed: false, reload: false, lowered: false}, s.g.inv);
    s.g.weapon.update(DT, {held: true, pressed: true, reload: false, lowered: false}, s.g.inv);
    for (let i = 0; i < 30; i++) s.g.weapon.update(DT, {held: true, pressed: false, reload: false, lowered: false}, s.g.inv); // wound up
    expect(s.g.weapon.meleeStage).toBe('ready');
    s.g.weapon.update(DT, {held: false, pressed: false, reload: false, lowered: false}, s.g.inv); // release: the swing
    expect(s.g.weapon.meleeStage).toBe('swing');
    expect(s.g.weapon.swinging).toBe(true);
    expect(s.sys.press()).toBe('ignored');
    expect(s.calls.cancelUse).toEqual([]);
    s.g.weapon.cancelSwing();
    // the readied backpack goes back on (gear system's own path) and then the mask goes on
    s.g.gear.readied = true;
    expect(s.sys.press()).toBe('donning');
    expect(s.calls.cancelReady).toEqual([true]);
    expect(s.g.gear.readied).toBe(false);
    expect(s.calls.cancelUse).toEqual(['mask']);
    expect(s.calls.cancelFlare).toBe(1);
  });

  it('task knife-windup-20261030: Q while the knife is held WOUND UP (not released) puts the mask on and drops the windup — no swing on the later release', () => {
    const s = shell();
    s.giveMask(100);
    const knife = s.g.inv.makeStack('knife', 1);
    s.g.inv.set(H(2), knife);
    s.g.weapon.equip(knife);
    const evs: WeaponEvent[] = [];
    // as Game.update: a melee weapon is lowered while a lane owns the input (the mask transition is an input owner)
    const frame = (held: boolean, pressed = false) => { evs.push(...s.g.weapon.update(DT, {held, pressed, reload: false, lowered: s.owns()}, s.g.inv)); s.step(DT); };
    for (let i = 0; i < 60 && s.g.weapon.phase === 'equipping'; i++) frame(false);
    frame(true, true);
    for (let i = 0; i < 30; i++) frame(true);
    expect([s.g.weapon.meleeStage, s.g.weapon.winding]).toEqual(['ready', true]);
    expect(s.sys.press()).toBe('donning'); // not ignored: nothing is committed yet
    frame(true); // the same frame's weapon update sees the owner -> the windup is dropped
    expect(s.g.weapon.meleeStage).toBeNull();
    expect(s.g.weapon.winding).toBe(false);
    for (let i = 0; i < 50; i++) frame(true); // the button stays down through the whole transition (0.6 s) and after it
    expect(s.sys.state).toBe('on');
    frame(false); // the release: no swing, no contact
    for (let i = 0; i < 40; i++) frame(false);
    expect(evs.filter(e => e.type === 'swing' || e.type === 'contact')).toEqual([]);
    expect(evs.filter(e => e.type === 'windup')).toHaveLength(1); // only the original press wound up
    // a fresh press afterwards works normally
    frame(true, true);
    frame(false);
    for (let i = 0; i < 40; i++) frame(false);
    expect(evs.filter(e => e.type === 'swing')).toHaveLength(1);
    expect(evs.filter(e => e.type === 'contact')).toHaveLength(1);
  });

  it('never changes the selected slot / weapon / magazine; firing, ADS and click-use are blocked during the transition; a running reload continues', () => {
    const s = shell();
    s.giveMask(100);
    const pistol = s.g.inv.makeStack('pistol', 1, 7);
    s.g.inv.set(H(0), pistol);
    s.g.inv.add(s.g.inv.makeStack('ammo_9mm', 45));
    s.g.inv.select(0);
    const w = s.g.weapon;
    w.equip(pistol);
    // Game.update's gating (game.ts): laneOwns = inputOwners -> no trigger, no ADS, no click-use; reload is not gated by it
    const frame = (mouse: boolean, reload = false): WeaponEvent[] => {
      const laneOwns = s.owns();
      return w.update(DT, {held: mouse && !laneOwns, pressed: mouse && !laneOwns, reload, lowered: false}, s.g.inv);
    };
    for (let i = 0; i < 60 && w.phase === 'equipping'; i++) frame(false);
    frame(false, true); // R: a reload starts
    expect(w.reloading).toBe(true);
    expect(s.sys.press()).toBe('donning');
    const fired: WeaponEvent[] = [];
    for (let i = 0; i < 36; i++) { fired.push(...frame(true)); s.step(DT); } // trigger held through the donning
    expect(fired.filter(e => e.type === 'fire')).toEqual([]);
    expect(s.sys.state).toBe('on');
    for (let i = 0; i < 200 && w.reloading; i++) frame(false); // (still) reloading: it completes normally
    expect(w.reloading).toBe(false);
    expect(pistol.mag).toBe(15);
    expect(s.g.inv.selected).toBe(0);
    expect(w.stack).toBe(pistol);
    expect(frame(true).some(e => e.type === 'fire')).toBe(true); // on the face: firing works again
    expect(s.sys.press()).toBe('doffing');
    expect(frame(true).some(e => e.type === 'fire')).toBe(false);
    s.step(0.5);
    expect(s.g.inv.selected).toBe(0);
    expect(w.stack).toBe(pistol);
    // game.ts wires exactly that gating (fire / ADS / flare / click-use through laneOwns; H / inventory use through startUse)
    const game = src('../src/game.ts');
    expect(game).toMatch(/const laneOwns = this\.inputOwners\.some\(f => f\(\)\)/);
    expect(game).toMatch(/this\.aiming = [^\n]*!laneOwns/);
    expect(game).toMatch(/const flareOwns = this\.flareHold\.active \|\| this\.lmbLatch \|\| laneOwns/);
    expect(game).toMatch(/held: inp\.mouse\[0\] && !flareOwns, pressed: inp\.mousePressed\[0\] && !flareOwns/);
    expect(game).toMatch(/if \(this\.gasMask\.transitioning\) return;/);
  });

  it('Q is the gas mask in game.ts (last-item cycling and lastSlot removed); KeyQ is no gear "shoulder" key; Q stays a game key; controls say so', async () => {
    const game = src('../src/game.ts');
    expect(game).not.toMatch(/lastSlot/);
    expect(game).toMatch(/if \(inp\.hit\('KeyQ'\)\) this\.gasMask\.press\(\);/);
    expect(game).toMatch(/installGasMask\(this, \{cancelUse: reason => this\.cancelUse\(reason\), cancelFlareHold: \(\) => this\.cancelFlareHold\(\)\}\)/);
    // (task knife-windup-20261030: + 'Backquote', the melee slot ~ — still no KeyQ)
    expect(src('../src/gear/system.ts')).toMatch(/const KEYS_SHOULDER = \['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Backquote'\];/);
    expect(GAME_KEYS.has('KeyQ')).toBe(true);
    const {CONTROLS} = await import('../src/ui/hud');
    expect(CONTROLS.some(([a, k]) => a === 'Gas mask on/off' && k === 'Q')).toBe(true);
    expect(CONTROLS.some(([a]) => /last item/i.test(a))).toBe(false);
  });
});

describe('filter charge: drain, auto-fit, warnings, protection', () => {
  it('drains only while fully ON, by play dt; off / donning / paused / dead never drain', () => {
    const s = shell();
    const m = s.giveMask(100);
    s.step(5); // off
    expect(m.filter).toBe(100);
    s.sys.press();
    s.step(0.5); // donning (0.5 < 0.6 s)
    expect(m.filter).toBe(100);
    s.step(0.1 + 10, 0.05); // on for ~10 s
    expect(m.filter!).toBeGreaterThan(89.8);
    expect(m.filter!).toBeLessThan(90.1);
    const at = m.filter!;
    // the frame hooks only run while playing; even if they were called, a menu / death state never drains
    s.g.state = 'paused';
    s.step(5);
    s.g.state = 'playing';
    s.g.player.alive = false;
    s.step(5);
    s.g.player.alive = true;
    expect(m.filter).toBe(at);
    s.step(1, 0.05);
    expect(m.filter!).toBeCloseTo(at - 1, 6);
    s.sys.press(); // doffing / off: no drain
    s.step(3);
    expect(m.filter!).toBeCloseTo(at - 1, 6);
  });

  it('at 0 a spare is fitted from the pockets (batteryInsert + "Filter changed — N spare"); low and empty warnings; empty on the face = UNPROTECTED', () => {
    const s = shell();
    const m = s.giveMask(31); // 20.7 % — the low warning comes after one more second
    s.giveFilters(2);
    s.toggle();
    expect(s.sys.protects()).toBe(true);
    s.step(2, 0.05);
    expect(s.toasts.some(t => /filter low — \d+ % · 2 spare/.test(t.text) && t.warn)).toBe(true);
    s.step(29, 0.05); // runs out at ~31 s: one spare goes in
    expect(s.calls.battery).toBe(1);
    expect(s.g.inv.count('gas_filter')).toBe(1);
    expect(m.filter!).toBeGreaterThan(FILTER_LIFE_S - 2);
    expect(s.toasts.some(t => t.text === 'Filter changed — 1 spare')).toBe(true);
    expect(s.sys.protects()).toBe(true);
    // burn through the last two filters
    s.step(FILTER_LIFE_S * 2 + 1, 0.05);
    expect(s.calls.battery).toBe(2);
    expect(s.g.inv.count('gas_filter')).toBe(0);
    expect(m.filter).toBe(0);
    expect(s.sys.state).toBe('on');
    expect(s.sys.protects()).toBe(false); // on the face, no working filter: NOT protecting
    expect(s.sys.tone).toBe('empty');
    expect(s.toasts.filter(t => /^NO FILTER/.test(t.text))).toHaveLength(1); // warned once
    expect(s.view()).toMatchObject({state: 'on', protects: false, tone: 'empty'});
    // a filter picked up while it is on: fitted on the next frame
    s.giveFilters(1);
    s.step(DT);
    expect(m.filter).toBe(FILTER_LIFE_S);
    expect(s.sys.protects()).toBe(true);
  });

  it('a mask donned with an empty filter fits a spare when it is on; never from a worn backpack\'s contents', () => {
    const s = shell();
    const m = s.giveMask(0);
    const bag = s.g.inv.makeStack('backpack', 1);
    const inBag = s.g.inv.makeStack('gas_filter', 3);
    bag.bag![0] = inBag;
    expect(s.g.inv.wearBag(bag)).toBe(true);
    expect(s.sys.spares).toBe(0); // the worn bag's filters are out of reach
    s.toggle();
    expect(s.sys.state).toBe('on');
    expect(m.filter).toBe(0);
    expect(s.sys.protects()).toBe(false);
    expect(inBag.count).toBe(3);
    s.step(3);
    expect(inBag.count).toBe(3); // still never drawn
    expect(s.toasts.filter(t => /^NO FILTER/.test(t.text))).toHaveLength(1);
    // the grenade-slot / quick-slot / pocket inventory is what it draws from: a filter moved to the pockets is fitted
    s.g.inv.set(P(3), s.g.inv.makeStack('gas_filter', 1));
    s.step(DT);
    expect(m.filter).toBe(FILTER_LIFE_S);
    expect(s.g.inv.count('gas_filter')).toBe(0);
    expect(inBag.count).toBe(3);
  });
});

describe('the charge belongs to the mask: no refill, no duplicate', () => {
  it('unequip forces OFF; re-equip / swapping masks / drop + pick-up keep each mask\'s own charge; totals conserved', () => {
    const s = shell();
    const a = s.giveMask(80);
    const b = s.mask(120);
    s.g.inv.set(P(5), b);
    s.giveFilters(2);
    const before = totals(s.g.inv);
    s.toggle();
    s.step(10, 0.05);
    const aLeft = a.filter!;
    expect(aLeft).toBeCloseTo(70, 0);
    // take it off (inventory screen: Take off -> the gear hook) => off the face at once, charge kept
    expect(s.g.inv.takeOff('mask')).toBe('moved');
    s.g.invUI.gear.changed();
    expect(s.sys.state).toBe('off');
    expect(a.filter).toBe(aLeft);
    // re-equip: still off, same charge
    expect(s.g.inv.wearFrom(s.g.inv.find(a.uid)!)).toBe('moved');
    s.g.invUI.gear.changed();
    s.step(1);
    expect(s.sys.state).toBe('off');
    expect(a.filter).toBe(aLeft);
    // swap in the other mask while ON (drag onto the face slot) => off; each mask keeps its own charge
    s.toggle();
    expect(s.sys.state).toBe('on');
    const aOn = a.filter!;
    expect(s.g.inv.moveCount(s.g.inv.find(b.uid)!, MASK)).toBe('swapped');
    s.step(DT); // (the frame check catches it even without the inventory hook)
    expect(s.sys.state).toBe('off');
    expect(s.g.inv.get(MASK)).toBe(b);
    expect(b.filter).toBe(120);
    expect(a.filter!).toBeCloseTo(aOn, 6);
    // drop the worn mask and pick it up again: the same stack, the same charge, off
    s.toggle();
    const bOn = b.filter!;
    const dropped = s.g.inv.detach(MASK)!;
    expect(dropped).toBe(b);
    s.step(DT);
    expect(s.sys.state).toBe('off');
    expect(s.g.inv.add(dropped)).toBe(0);
    expect(s.g.inv.get(MASK)).toBe(b);
    expect(b.filter).toBe(bOn);
    s.step(1);
    expect(s.sys.state).toBe('off');
    expect(totals(s.g.inv)).toEqual(before);
    expect(s.g.inv.invariants()).toEqual([]);
  });

  it('StackJSON / snapshot / clone / section-memory records keep the charge exactly; older snapshots (no mask slot) still load', () => {
    const inv = new Inventory();
    const m = inv.makeStack('gas_mask', 1);
    m.filter = 73.25;
    inv.add(m);
    const spare = inv.makeStack('gas_mask', 1);
    spare.filter = 12.5;
    inv.set(P(0), spare);
    expect(stackToJSON(m)).toEqual({uid: m.uid, itemId: 'gas_mask', count: 1, filter: 73.25});
    expect(stackFromJSON(stackToJSON(m))).toEqual(m);
    const j = inv.toJSON();
    expect(j.gear.mask).toMatchObject({itemId: 'gas_mask', filter: 73.25});
    const c = inv.clone();
    expect(c.get(MASK)).toMatchObject({uid: m.uid, filter: 73.25});
    expect(c.get(MASK)).not.toBe(m);
    expect(c.get(P(0))).toMatchObject({uid: spare.uid, filter: 12.5});
    // a grounded / remembered pickup (run memory): stackRecord -> stackFromRecord (a fresh uid, the same charge)
    const back = stackFromRecord(inv, stackRecord(spare));
    expect(back.filter).toBe(12.5);
    expect(back.uid).not.toBe(spare.uid);
    // an iteration-16 / office-overhaul snapshot without the mask slot loads (the face slot empty)
    const old = JSON.parse(JSON.stringify(j)) as InventoryJSON;
    delete (old.gear as Record<string, unknown>).mask;
    const o = Inventory.fromJSON(old);
    expect(o.get(MASK)).toBeNull();
    expect(o.invariants()).toEqual([]);
    // invariants: a charge only on masks, within one filter
    const bad = new Inventory();
    const w = bad.makeStack('water', 1);
    w.filter = 5;
    bad.add(w);
    expect(bad.invariants().some(x => /non-mask water carries a filter/.test(x))).toBe(true);
  });

  it('Retry restores the level-entry snapshot (on flag + charge, no refill); NewGame resets; travel keeps; lifecycle cancels transitions to OFF', () => {
    const s = shell();
    const m = s.giveMask(90);
    s.giveFilters(1);
    s.toggle();
    expect(s.sys.state).toBe('on');
    const parts = s.g.runParticipants;
    expect(parts.map(p => p.id)).toEqual(['gas.mask']);
    const carry = () => ({inv: s.g.inv, player: {hp: 100, stamina: 100, damageTaken: 0}, survival: {hunger: 80, thirst: 80, time: 0}, battery: {charge: 1, on: true, died: false}, participants: parts, stats: {}});
    const at = m.filter!;
    const snap = takeSnapshot({level: 'office', section: 'main', arrival: {kind: 'start'}}, carry(), {});
    expect(snap.lanes['gas.mask']).toEqual({v: 1, on: true});
    // play on: drain, use the spare, take it off
    s.step(at + 5, 0.05);
    expect(s.g.inv.count('gas_filter')).toBe(0);
    s.toggle();
    expect(s.sys.state).toBe('off');
    // Retry level (Game.restoreCarryFrom order: inventory first, then participants)
    const inv = restoreCarry(snap, carry());
    s.g.inv.loadJSON(inv.toJSON());
    restoreParticipants(snap, parts);
    const m2 = s.g.inv.get(MASK)!;
    expect(m2.uid).toBe(m.uid);
    expect(m2.filter).toBe(at); // exactly the entry charge: no refill, no extra
    expect(s.g.inv.count('gas_filter')).toBe(1);
    expect(s.sys.state).toBe('on');
    expect(s.sys.protects()).toBe(true);
    // travel (section teardown + build) never touches the charge or the on flag
    for (const h of s.g.sectionHooks) h.teardown?.();
    for (const h of s.g.sectionHooks) h.build?.({});
    expect(s.sys.state).toBe('on');
    expect(m2.filter).toBe(at);
    // a transition is cancelled by lifecycle to OFF: donning -> off, doffing -> off
    s.sys.press();
    expect(s.sys.state).toBe('doffing');
    s.setState('paused');
    expect(s.sys.state).toBe('off');
    s.setState('playing');
    s.sys.press();
    expect(s.sys.state).toBe('donning');
    s.setState('dead');
    expect(s.sys.state).toBe('off');
    s.setState('playing');
    s.sys.press();
    for (const h of s.g.sectionHooks) h.teardown?.(); // travel / retry / new game start with a teardown
    expect(s.sys.state).toBe('off');
    // NewGame: participants reset (and the starter kit has no mask)
    s.toggle();
    expect(s.sys.state).toBe('on');
    s.g.inv.loadJSON(starterInventory('pistol').toJSON());
    resetParticipants(parts);
    expect(s.sys.state).toBe('off');
    expect(s.sys.qa()).toMatchObject({equipped: null, filterS: 0, spares: 0, protects: false});
    // a Retry snapshot taken with the mask OFF restores it off
    const off = takeSnapshot({level: 'subway', section: 'main', arrival: {kind: 'start'}}, carry(), {});
    expect(off.lanes['gas.mask']).toEqual({v: 1, on: false});
  });

  it('registers one frame hook, input owner, state listener, section hook, run participant and a hidden filter warm-up prototype', () => {
    const s = shell();
    expect(s.g.frameHooks).toHaveLength(1);
    expect(s.g.inputOwners).toHaveLength(1);
    expect(s.g.stateListeners).toHaveLength(1);
    expect(s.g.sectionHooks).toHaveLength(1);
    expect(s.g.runParticipants).toHaveLength(1);
    const protos = s.pools['gas-mask']();
    expect(protos).toHaveLength(1);
    expect(protos[0].position.y).toBeLessThan(-100);
    protos[0].traverse(o => { if ((o as THREE.Mesh).isMesh) expect(o.visible).toBe(false); });
    expect(s.pools['gas-mask']()).toBe(protos); // built once
  });
});

describe('loot: level-wide mask / filter rolls with their own rng (existing loot unchanged)', () => {
  const SEEDS = Array.from({length: 300}, (_, i) => (i * 2654435761) >>> 0);

  it('office 1-2 masks + 2-5 filters, subway 0-1 masks (~50 %) + 0-2 filters; found masks carry 35-75 % of a filter; deterministic', () => {
    const seen: Record<LevelId, {masks: Set<number>; filters: Set<number>; withMask: number}> = {
      office: {masks: new Set(), filters: new Set(), withMask: 0}, subway: {masks: new Set(), filters: new Set(), withMask: 0},
      mall: {masks: new Set(), filters: new Set(), withMask: 0}, // (task track3-eaton-centre-20261031: LevelId 'mall'; not rolled here)
    };
    for (const seed of SEEDS) for (const level of ['office', 'subway'] as const) {
      const r = rollMaskLoot(seed, level, ['main']).main;
      expect(rollMaskLoot(seed, level, ['main']).main).toEqual(r);
      const masks = r.filter(x => x.itemId === 'gas_mask'), filters = r.filter(x => x.itemId === 'gas_filter');
      expect(masks.length + filters.length).toBe(r.length);
      expect(r.slice(0, masks.length).every(x => x.itemId === 'gas_mask')).toBe(true); // masks first
      const spec = MASK_LOOT.levels[level];
      expect(masks.length).toBeGreaterThanOrEqual(spec.masks[0]);
      expect(masks.length).toBeLessThanOrEqual(spec.masks[1]);
      expect(filters.length).toBeGreaterThanOrEqual(spec.filters[0]);
      expect(filters.length).toBeLessThanOrEqual(spec.filters[1]);
      for (const mk of masks) {
        expect(mk.filter!).toBeGreaterThanOrEqual(0.35 * FILTER_LIFE_S - 0.05);
        expect(mk.filter!).toBeLessThanOrEqual(0.75 * FILTER_LIFE_S + 0.05);
      }
      for (const f of filters) expect(f.filter).toBeUndefined();
      seen[level].masks.add(masks.length);
      seen[level].filters.add(filters.length);
      if (masks.length) seen[level].withMask++;
    }
    expect([...seen.office.masks].sort()).toEqual([1, 2]);
    expect([...seen.office.filters].sort()).toEqual([2, 3, 4, 5]);
    expect([...seen.subway.masks].sort()).toEqual([0, 1]);
    expect([...seen.subway.filters].sort()).toEqual([0, 1, 2]);
    expect(seen.subway.withMask / SEEDS.length).toBeGreaterThan(0.4);
    expect(seen.subway.withMask / SEEDS.length).toBeLessThan(0.6);
    expect(MASK_LOOT.foundFilter).toEqual([0.35, 0.75]);
  });

  it('the run roll = lane GEAR\'s roll unchanged, then the mask loot appended', () => {
    for (const seed of SEEDS.slice(0, 80)) for (const level of ['office', 'subway'] as const) {
      const gear = rollGearOnly(seed, level, ['main']).main;
      const run = rollRunGear(seed, level, ['main']).main;
      expect(run.slice(0, gear.length)).toEqual(gear);
      expect(run.slice(gear.length)).toEqual(rollMaskLoot(seed, level, ['main']).main);
      expect(gear.some(g => isMaskLootItem(g.itemId))).toBe(false);
    }
  });

  /** Generated with the run roll vs. with lane GEAR's items only: the same layout, the mask loot appended at the end. */
  function check(level: LevelId, levelSeed: number): StationLayout {
    const gear = rollGearOnly(levelSeed, level, ['main']).main;
    const run = rollRunGear(levelSeed, level, ['main']).main;
    const base = LEVELS[level].generate('main', {levelSeed, startWeapon: 'pistol', gear});
    const full = LEVELS[level].generate('main', {levelSeed, startWeapon: 'pistol', gear: run});
    expect(full.pickups.slice(0, base.pickups.length)).toEqual(base.pickups); // every generated + gear pickup identical
    expect(full.zombies).toEqual(base.zombies);
    expect(full.props.length).toBe(base.props.length);
    const extra = full.pickups.slice(base.pickups.length);
    const want = run.slice(gear.length);
    expect(extra.map(p => p.itemId)).toEqual(want.map(w => w.itemId));
    expect(extra.map(p => p.filter)).toEqual(want.map(w => w.filter)); // a found mask's seeded charge rides its placement
    // gear placement rules: plausible back-of-house / office rooms, >= 6 m from the start (3D on the office), count 1
    const sp = (full.office?.start ?? full.playerSpawn) as {x: number; z: number; level?: number};
    const lv = sp.level ?? 0;
    const spY = full.office ? (full.levels[lv]?.grid ?? full.grid).floorAt(sp.x, sp.z) : 0;
    for (const p of extra) {
      expect(p.count).toBe(1);
      expect(gearAreaWeight(full.areas[p.area]), `${p.itemId} in ${full.areas[p.area]?.type}`).toBeGreaterThan(0);
      const d = full.office ? Math.hypot(p.x - sp.x, p.z - sp.z, p.y - spY) : Math.hypot(p.x - sp.x, p.z - sp.z);
      expect(d).toBeGreaterThanOrEqual(GEAR_MIN_SPAWN_M - 1e-6);
    }
    return full;
  }

  it('Office Space: generated pickups / gear / zombies unchanged; masks + filters placed after them, deterministic', () => {
    const a = check('office', 0x0ff1ce);
    expect(a.pickups.filter(p => p.itemId === 'gas_mask').length).toBeGreaterThanOrEqual(1);
    const again = LEVELS.office.generate('main', {levelSeed: 0x0ff1ce, startWeapon: 'pistol', gear: rollRunGear(0x0ff1ce, 'office', ['main']).main});
    expect(again.pickups).toEqual(a.pickups);
  });

  it('Subway: generated pickups / gear / zombies unchanged; its (rarer) mask loot appended', () => {
    // a seed whose roll has a mask (subway: 50 %)
    const seed = SEEDS.find(x => rollMaskLoot(x, 'subway', ['main']).main.some(m => m.itemId === 'gas_mask'))!;
    check('subway', seed);
    // without any roll (tests / tools) generation is exactly what it was: no mask loot appears by itself
    expect(LEVELS.subway.generate('main', {levelSeed: seed, startWeapon: 'pistol'}).pickups.some(p => isMaskLootItem(p.itemId))).toBe(false);
  });

  it('a found mask spawns with its placement\'s charge (game.ts buildSection)', () => {
    expect(src('../src/game.ts')).toMatch(/if \(p\.filter !== undefined\) st\.filter = p\.filter;/);
  });
});

describe('HUD Q cell (ui/hud.ts) on the fake DOM; the old camera mask layer is gone', () => {
  let dom: FakeDom;
  beforeAll(() => { dom = installFakeDom(); });
  afterAll(() => dom.uninstall());
  const state = {hp: 100, maxHp: 100, stamina: 100, weaponName: '', mag: null, reserve: 0, hint: '', prompt: '', remaining: 0, total: 0, area: '', spreadPx: 4, aiming: false, flashlight: false, use: null};

  it('the bar is [Q, 1..5, 6, G] (+ the melee slot ~ last): Q is a gear cell for the mask slot (drop target), vacant "no mask"; then icon, ON/OFF, filter bar, spares', async () => {
    const {Hud} = await import('../src/ui/hud');
    const hud = new Hud();
    const inv = new Inventory();
    hud.update(state, inv);
    const bar = dom.el('#hotbar');
    expect(bar.children.map(c => `${c.dataset.bar}:${c.dataset.index}`)).toEqual([`gear:${MASK.index}`, 'hotbar:0', 'hotbar:1', 'hotbar:2', 'hotbar:3', 'hotbar:4', `gear:${GEAR_SLOTS.indexOf('backpack')}`, 'throw:0', 'melee:0']); // task knife-windup-20261030: ~ is the last child
    const q = bar.children[0];
    expect(q.classList.contains('maskslot')).toBe(true);
    expect(q.classList.contains('vacant')).toBe(true);
    expect(q.innerHTML).toMatch(/<span class="key">Q<\/span>/);
    expect(q.innerHTML).toMatch(/no mask/);
    expect(bar.children[1].innerHTML).toMatch(/<span class="key">1<\/span>/); // quick slot 1 keeps key 1
    const m = inv.makeStack('gas_mask', 1);
    m.filter = 0.5 * FILTER_LIFE_S;
    inv.add(m);
    inv.add(inv.makeStack('gas_filter', 2));
    hud.update(state, inv);
    expect(q.classList.contains('vacant')).toBe(false);
    expect(q.innerHTML).toMatch(/>OFF</);
    expect(q.innerHTML).toMatch(/width:50%/);
    expect(q.innerHTML).toMatch(/<span class="count">\+2<\/span>/);
    hud.setMask({state: 'donning', cover: 0.5, protects: false, tone: 'ok'});
    hud.update(state, inv);
    expect(q.innerHTML).toMatch(/>ON…</);
    hud.setMask({state: 'on', cover: 1, protects: true, tone: 'ok'});
    hud.update(state, inv);
    expect(q.innerHTML).toMatch(/>ON</);
    expect(q.classList.contains('on')).toBe(true);
    m.filter = 0.1 * FILTER_LIFE_S;
    hud.update(state, inv);
    expect(q.classList.contains('low')).toBe(true);
    m.filter = 0;
    hud.update(state, inv);
    expect(q.classList.contains('empty')).toBe(true);
    expect(q.classList.contains('low')).toBe(false);
  });

  it('task gas-mask-roof-feedback-20261030 (item 4): no DOM camera layer any more — the cover / tone go to the first-person mask view', () => {
    const hudEl = dom.el('#hud');
    const s = shell();
    s.giveMask(0.15 * FILTER_LIFE_S);
    s.sys.press();
    s.step(0.3);
    expect(s.sys.qa().overlay).toBeGreaterThan(0.3); // the cover handed to the view (gear/maskView.ts; tests/gas-mask-view.test.ts)
    expect(s.sys.qa().overlay).toBeLessThan(0.7);
    s.step(0.4);
    expect(s.sys.qa().overlay).toBe(1);
    s.toggle();
    expect(s.sys.qa().overlay).toBe(0);
    expect(s.sys.maskView).toBeNull(); // a Node shell has no viewmodel: nothing attached, nothing drawn
    expect(hudEl.children.filter(c => c.id === 'mask-view')).toHaveLength(0);
  });

  it('inventory screen: the gear panel has a Face slot; filters cannot be used or equipped; a mask shows its fitted filter', async () => {
    const {InventoryUI} = await import('../src/ui/inventoryUI');
    const inv = new Inventory();
    const ui = new InventoryUI(() => inv, {use() {}, drop() {}, equip() {}, close() {}, changed() {}});
    inv.set(P(0), inv.makeStack('gas_filter', 3));
    const m = inv.makeStack('gas_mask', 1);
    m.filter = 0.42 * FILTER_LIFE_S;
    inv.set(P(1), m);
    ui.selected = P(0);
    ui.render();
    expect(dom.el('#btn-inv-use').disabled).toBe(true);
    expect(dom.el('#btn-inv-equip').disabled).toBe(true);
    expect(dom.el('#inv-detail .fx').textContent).toMatch(/fits one by itself/);
    ui.selected = P(1);
    ui.render();
    expect(dom.el('#btn-inv-equip').disabled).toBe(false);
    expect(dom.el('#inv-detail .fx').textContent).toMatch(/^Filter 42 % fitted · 3 spare/);
    expect(dom.el('#inv-pack').children[1].innerHTML).toMatch(/<span class="count">42%<\/span>/);
    expect(ui.dropAt(P(1), MASK)).toBe('moved'); // wear it into the Face slot
    const gearRow = dom.el('#inv-gear').children;
    expect(gearRow).toHaveLength(GEAR_SLOTS.length);
    expect(gearRow[MASK.index].innerHTML).toMatch(/Face/);
    expect(inv.get(MASK)).toBe(m);
    expect(ui.dropAt(P(0), MASK)).toBe('refused'); // a filter is no gear
  });
});
