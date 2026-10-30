// Iteration 16 (lane GEAR): the gear system end to end on a real generated station, with a minimal Game shell (no
// browser, no renderer): key 6 readies the worn backpack, a click sets it down on the floor, E on it opens the transfer
// session (world not paused), hits / distance / state changes close it, "Wear it" picks the same bag up; refusals on
// stairs and in the elevator cab; grounded bags persist through section teardown / build without dupes; a generated
// backpack find becomes a bag exactly once; warm-up prototypes; the modifier source.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installGear} from '../src/gear/system';
import {Inventory, type ItemStack, stacksIn} from '../src/items/inventory';
import {GEAR_IDS, GEAR_SLOTS} from '../src/items/gear';
import {BASE_MODIFIERS, combineModifiers} from '../src/player/modifiers';
import {WeaponController} from '../src/weapons/weapons';
import {PickupManager} from '../src/world/pickups';
import {generateStation} from '../src/gen/station';
import {levelsOf} from '../src/gen/levels';
import {FLOOR} from '../src/gen/grid';
import {MemoryBagStore} from '../src/gear/bagStore';
import {placeSectionGear} from '../src/gen/gearLoot';
import type {Game} from '../src/game';

type Shell = ReturnType<typeof shell>;

function shell(seed = 4242) {
  const layout = generateStation(seed, {startWeapon: 'pistol'});
  const levels = levelsOf(layout);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
  camera.rotation.order = 'YXZ';
  const toasts: string[] = [];
  const pools: Record<string, () => readonly THREE.Object3D[]> = {};
  const sp = layout.playerSpawn;
  const g = {
    scene: new THREE.Scene(), modifierSources: [] as (() => object)[], frameHooks: [] as ((dt: number) => void)[],
    interactHandlers: [] as (() => boolean)[], hitListeners: [] as ((h: {amount: number}) => void)[],
    sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[], stateListeners: [] as ((s: string, p: string) => void)[],
    promptProviders: [] as (() => string | null)[], inputOwners: [] as (() => boolean)[],
    warmRegistry: {addPool: (n: string, f: () => readonly THREE.Object3D[]) => { pools[n] = f; }},
    invUI: {gear: null as unknown},
    input: {
      onLockChange: (_l: boolean) => {}, clears: 0, pressed: new Set<string>(), mouse: [false, false, false], mousePressed: [false, false, false], wheel: 0, locked: true,
      hit(c: string) { return this.pressed.has(c); }, unlock() {}, lock: () => Promise.resolve(true),
    },
    inv: new Inventory(), weapon: new WeaponController(), mods: {...BASE_MODIFIERS},
    player: {x: sp.x, y: 0, z: sp.z, yaw: sp.yaw, pitch: 0, climbing: false, grounded: true, alive: true, eye: 1.6},
    consumeView: {busy: false}, viewmodel: {setItem: (_id: string | null) => {}},
    sfx: {equip() {}, denied() {}, pickup() {}, search() {}}, hud: {toast: (t: string) => { toasts.push(t); }},
    flareHold: {active: false, cancel: () => false}, syncHeld() {}, camera, levels, layout, pickups: new PickupManager({}), qa: true, state: 'playing',
  };
  const game = g as unknown as Game;
  const sys = installGear(game);
  sys.setStore(new MemoryBagStore());
  const view = () => {
    camera.position.set(g.player.x, g.player.y + g.player.eye, g.player.z);
    camera.rotation.set(g.player.pitch, g.player.yaw, 0);
    camera.updateMatrixWorld(true);
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      view();
      for (const f of g.frameHooks) f(1 / 60);
      g.input.pressed.clear();
      g.input.mousePressed.fill(false);
      g.input.wheel = 0;
    }
  };
  const press = (code: string) => { g.input.pressed.add(code); step(); };
  const click = () => { g.input.mouse[0] = true; g.input.mousePressed[0] = true; step(); g.input.mouse[0] = false; step(); };
  const lookAt = (t: THREE.Vector3) => {
    const eye = new THREE.Vector3(g.player.x, g.player.y + g.player.eye, g.player.z), d = t.clone().sub(eye);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    view();
  };
  return {g, game, sys, layout, levels, toasts, pools, step, press, click, lookAt, view};
}

/** Build the section like Game.buildSection: layout pickups spawned, then the lane build hooks. */
function build(s: Shell): void {
  s.g.pickups.clear();
  for (const p of s.layout.pickups) if (p.itemId === 'backpack') s.g.pickups.add(s.g.inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, 0.3);
  for (const h of s.g.sectionHooks) h.build?.(s.layout);
}
const teardown = (s: Shell) => { for (const h of s.g.sectionHooks) h.teardown?.(); };

/** Face a direction from the spawn where a bag fits (the platform is open floor). */
function faceOpenFloor(s: Shell): void {
  for (let k = 0; k < 16; k++) {
    s.g.player.yaw = (k / 16) * Math.PI * 2;
    s.g.player.pitch = -0.3;
    s.view();
    if (typeof s.sys.placeSpot() !== 'string') return;
  }
  throw new Error('no open floor around the spawn');
}

function wearLoadedBag(s: Shell): ItemStack {
  const inv = s.g.inv;
  inv.set({bar: 'hotbar', index: 0}, inv.makeStack('pistol', 1, 15));
  inv.add(inv.makeStack('ammo_9mm', 45));
  inv.add(inv.makeStack('bandage', 3));
  const bag = inv.makeStack('backpack', 1);
  expect(inv.add(bag)).toBe(0); // worn straight away
  return bag;
}

const total = (inv: Inventory, extra: ItemStack[] = []) => {
  const t: Record<string, number> = {};
  for (const x of [...inv.allStacks(true), ...extra.flatMap(e => stacksIn(e))]) t[x.itemId] = (t[x.itemId] ?? 0) + x.count;
  return t;
};

describe('gear system install', () => {
  it('registers exactly one of each hook and a warm-up pool of every gear model (hidden, out of the way)', () => {
    const s = shell();
    for (const k of ['modifierSources', 'frameHooks', 'interactHandlers', 'hitListeners', 'sectionHooks', 'stateListeners', 'promptProviders', 'inputOwners'] as const) expect(s.g[k]).toHaveLength(1);
    expect(s.g.invUI.gear).toBeTruthy();
    const protos = s.pools.gear();
    expect(protos).toHaveLength(GEAR_IDS.length);
    for (const p of protos) {
      expect(p.parent).toBe(s.sys.group);
      expect(p.position.y).toBe(-1000);
      p.traverse(o => { if ((o as THREE.Mesh).isMesh) expect(o.visible).toBe(false); });
    }
    expect(s.pools.gear()).toBe(protos); // built once
    expect(s.sys.group.parent).toBe(s.g.scene);
  });

  it('the modifier source reports the worn gear from base values only', () => {
    const s = shell();
    s.g.inv.add(s.g.inv.makeStack('boots', 1));
    s.g.inv.add(s.g.inv.makeStack('gloves', 1));
    for (let i = 0; i < 10; i++) {
      const m = combineModifiers(s.g.modifierSources as never);
      expect(m.speedMult).toBeCloseTo(1.05, 12);
      expect(m.spreadMult).toBeCloseTo(0.92, 12);
    }
    s.step();
    expect(s.g.weapon.handling).toBe(s.g.mods.handlingMult); // the frame hook hands handling to the reload timer
  });
});

describe('deployable backpack: 6, click, E', () => {
  it('6 readies the worn bag (mouse owned, gun down), click sets it down in front; contents stay with the same bag', () => {
    const s = shell();
    build(s);
    const bag = wearLoadedBag(s);
    faceOpenFloor(s);
    s.press('Digit6');
    expect(s.sys.readied).toBe(true);
    expect(s.g.inputOwners[0]()).toBe(true);
    expect(s.g.promptProviders[0]()).toMatch(/Set the backpack down/);
    expect(s.g.inv.worn('backpack')).toBe(bag); // still on the back until it is actually set down
    s.g.input.mouse[0] = true;
    s.g.input.mousePressed[0] = true;
    s.step();
    expect(s.sys.readied).toBe(false);
    expect(s.sys.bags).toHaveLength(1);
    expect(s.sys.bags[0].stack).toBe(bag);
    expect(s.g.inv.worn('backpack')).toBeNull();
    expect(s.g.inputOwners[0]()).toBe(true); // the placing click never bleeds into the gun while held
    s.g.input.mouse[0] = false;
    expect(s.g.inputOwners[0]()).toBe(false);
    const b = s.sys.bags[0];
    expect(Math.hypot(b.pose.x - s.g.player.x, b.pose.z - s.g.player.z)).toBeLessThan(0.8);
    expect(Math.abs(b.pose.y - s.levels.stepAt(b.pose.x, b.pose.z, 0.05))).toBeLessThan(0.02);
    expect(b.obj.parent).toBe(s.sys.group);
  });

  it('6 again / 1-5 / input clears sling it back on; no backpack = a clear refusal', () => {
    const s = shell();
    build(s);
    s.press('Digit6');
    expect(s.sys.readied).toBe(false);
    expect(s.toasts.at(-1)).toMatch(/No backpack/);
    wearLoadedBag(s);
    s.press('Digit6');
    expect(s.sys.readied).toBe(true);
    s.press('Digit6');
    expect(s.sys.readied).toBe(false);
    s.press('Digit6');
    s.press('Digit2');
    expect(s.sys.readied).toBe(false);
    s.press('Digit6');
    s.g.input.clears++; // a menu opened (setState clears the input)
    s.step();
    expect(s.sys.readied).toBe(false);
    expect(s.g.inv.worn('backpack')).not.toBeNull();
  });

  it('E on the aimed bag opens the session; transfers move items both ways; a hit closes it', () => {
    const s = shell();
    build(s);
    const bag = wearLoadedBag(s);
    const want = total(s.g.inv);
    faceOpenFloor(s);
    s.press('Digit6');
    s.click();
    s.lookAt(s.sys.bags[0].centre);
    s.step();
    expect(s.sys.target).toBe(s.sys.bags[0]);
    // Task office-overhaul-20261030 (INTERACT, #1): "E open bag · hold E wear"; the press only starts the tap / hold — the view
    // opens on the RELEASE (this shell's input has no held keys, so E reads released on the next frame)
    expect(s.g.promptProviders[0]()).toMatch(/\[E\]<\/b> Open backpack · <b>hold \[E\]<\/b> wear · empty/);
    expect(s.g.interactHandlers[0]()).toBe(true);
    expect(s.sys.viewOpen).toBe(false);
    s.step();
    expect(s.sys.viewOpen).toBe(true);
    expect(s.g.state).toBe('playing'); // NOT paused
    expect(s.g.inputOwners[0]()).toBe(true);
    const v = s.sys.bagView;
    const ammo = s.g.inv.find(s.g.inv.allStacks().find(x => x.itemId === 'ammo_9mm')!.uid)!;
    expect(v.quick(ammo)).toBe(45);
    expect(s.g.inv.count('ammo_9mm')).toBe(0);
    expect(bag.bag!.filter(Boolean)).toHaveLength(1);
    expect(v.move({bar: 'bag', index: 0}, {bar: 'pack', index: 5}, 15)).toBe('split');
    expect(s.g.inv.count('ammo_9mm')).toBe(15);
    expect(total(s.g.inv, [bag])).toEqual(want);
    s.g.hitListeners[0]({amount: 8});
    expect(s.sys.viewOpen).toBe(false);
    expect(v.quick({bar: 'bag', index: 0})).toBe(0); // closed: no path in
    expect(s.toasts.at(-1)).toMatch(/Hit!/);
  });

  it('walking away (> 2.5 m) or leaving play closes it; "Wear it" picks up the very same bag with its contents', () => {
    const s = shell();
    build(s);
    const bag = wearLoadedBag(s);
    faceOpenFloor(s);
    s.press('Digit6');
    s.click();
    const b = s.sys.bags[0];
    expect(s.sys.open(b)).toBe(true);
    s.sys.bagView.quick(s.g.inv.find(s.g.inv.allStacks().find(x => x.itemId === 'bandage')!.uid)!);
    const p = s.g.player;
    const [x0, z0] = [p.x, p.z];
    p.x = b.pose.x + 2.7;
    p.z = b.pose.z;
    s.step();
    expect(s.sys.viewOpen).toBe(false);
    p.x = x0; p.z = z0;
    expect(s.sys.open(b)).toBe(true);
    for (const f of s.g.stateListeners) f('paused', 'playing');
    expect(s.sys.viewOpen).toBe(false);
    expect(s.sys.open(b)).toBe(true);
    expect(s.sys.wear()).toBe(true);
    expect(s.g.inv.worn('backpack')).toBe(bag);
    expect(bag.bag!.filter(Boolean).map(x => x!.itemId)).toEqual(['bandage']);
    expect(s.sys.bags).toHaveLength(0);
    expect(b.obj.parent).toBeNull();
    expect(s.sys.viewOpen).toBe(false);
    expect(s.g.inv.invariants()).toEqual([]);
  });

  it('"Wear it" is refused while another backpack is worn (the found bag can still be emptied)', () => {
    const s = shell();
    build(s);
    wearLoadedBag(s);
    faceOpenFloor(s);
    s.press('Digit6');
    s.click();
    const b = s.sys.bags[0];
    s.g.inv.set({bar: 'gear', index: GEAR_SLOTS.indexOf('backpack')}, s.g.inv.makeStack('backpack', 1));
    s.sys.open(b);
    expect(s.sys.wear()).toBe(false);
    expect(s.sys.viewOpen).toBe(true);
    expect(s.sys.bags).toHaveLength(1);
  });
});

describe('placement refusals', () => {
  it('refused on stairs and inside the elevator cab (layout.office), with a clear message; the bag stays worn', () => {
    const s = shell();
    build(s);
    const bag = wearLoadedBag(s);
    // a stair tread of the station
    const g0 = s.levels.grid(0);
    let ramp = -1;
    for (let i = 0; i < g0.cells.length && ramp < 0; i++) if (g0.rampIdx[i] >= 0 && g0.cells[i] === FLOOR && g0.walkable(i % g0.w, (i / g0.w) | 0)) ramp = i;
    expect(ramp).toBeGreaterThanOrEqual(0);
    const [rx, rz] = g0.center(ramp % g0.w, (ramp / g0.w) | 0);
    const p = s.g.player;
    const spawn = {x: p.x, y: p.y, z: p.z};
    p.x = rx; p.z = rz; p.y = g0.floorAt(rx, rz);
    s.view();
    expect(s.sys.placeSpot()).toMatch(/stairs/);
    s.press('Digit6');
    s.click();
    expect(s.sys.bags).toHaveLength(0);
    expect(s.g.inv.worn('backpack')).toBe(bag);
    expect(s.toasts.at(-1)).toMatch(/stairs/);
    // an elevator cab around the spawn
    Object.assign(p, spawn);
    (s.layout as unknown as {office: unknown}).office = {levelId: 0, elevator: {cab: {x0: p.x - 1.2, z0: p.z - 1, x1: p.x + 1.2, z1: p.z + 1}}};
    s.view();
    expect(s.sys.placeSpot()).toMatch(/elevator/);
    expect(s.sys.placeFromInventory()).toMatch(/elevator/); // the Tab drag-out path follows the same rules
    expect(s.g.inv.worn('backpack')).toBe(bag);
    // another lane's rule (e.g. TOWER) is honoured
    delete (s.layout as unknown as {office?: unknown}).office;
    s.sys.placeRules.push(() => 'Not on the cab threshold.');
    let msg: string | object = '';
    for (let k = 0; k < 16; k++) { p.yaw = (k / 16) * Math.PI * 2; s.view(); msg = s.sys.placeSpot(); if (msg === 'Not on the cab threshold.') break; }
    expect(msg).toBe('Not on the cab threshold.');
  });
});

describe('persistence and found bags', () => {
  it('section teardown saves the bags; build restores the same bag (contents, uids) once; no dupes with a worn copy', () => {
    const s = shell();
    build(s);
    const bag = wearLoadedBag(s);
    faceOpenFloor(s);
    s.press('Digit6');
    s.click();
    s.sys.open(s.sys.bags[0]);
    s.sys.bagView.quick(s.g.inv.find(s.g.inv.allStacks().find(x => x.itemId === 'bandage')!.uid)!);
    const before = JSON.stringify(s.sys.record().bags);
    teardown(s);
    expect(s.sys.viewOpen).toBe(false);
    expect(s.sys.bags).toHaveLength(0);
    build(s);
    expect(s.sys.bags).toHaveLength(1);
    expect(JSON.stringify(s.sys.record().bags)).toBe(before);
    const restored = s.sys.bags[0].stack;
    expect(restored).not.toBe(bag); // a fresh object from the store …
    expect(restored.uid).toBe(bag.uid); // … of the same bag
    expect(restored.bag![0]!.itemId).toBe('bandage');
    // a fresh stack never reuses a restored uid
    expect(s.g.inv.makeStack('water', 1).uid).toBeGreaterThan(Math.max(...stacksIn(restored).map(x => x.uid)));
    s.sys.open(s.sys.bags[0]);
    expect(s.sys.wear()).toBe(true);
    teardown(s);
    build(s);
    expect(s.sys.bags).toHaveLength(0); // worn now: not on the ground any more
  });

  it('a generated backpack find lies there as an (empty) bag, converted exactly once; reset() forgets everything', () => {
    const s = shell(90210);
    const placed = placeSectionGear(s.layout, [{itemId: 'backpack'}]);
    expect(placed).toHaveLength(1);
    build(s);
    expect(s.g.pickups.list.filter(p => p.stack.itemId === 'backpack')).toHaveLength(0);
    expect(s.sys.bags).toHaveLength(1);
    const found = s.sys.bags[0];
    expect(found.id).toBe(`found:${s.layout.pickups.length - 1}`);
    expect(found.stack.bag!.every(x => x === null)).toBe(true);
    expect(Math.hypot(found.pose.x - placed[0].x, found.pose.z - placed[0].z)).toBeLessThan(1e-6);
    // take the found bag (wear it), leave, come back: the layout pickup re-spawns (no RUN memory here) but is never converted again
    s.g.player.x = found.pose.x + 0.8; s.g.player.z = found.pose.z; s.g.player.y = found.pose.y;
    s.sys.open(found);
    expect(s.sys.wear()).toBe(true);
    teardown(s);
    build(s);
    expect(s.sys.bags).toHaveLength(0);
    expect(s.g.pickups.list.filter(p => p.stack.itemId === 'backpack')).toHaveLength(0);
    // NewGame
    s.sys.reset();
    expect(s.sys.bags).toHaveLength(0);
  });
});
