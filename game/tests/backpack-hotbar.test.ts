// Task office-overhaul-20261030 (lane INTERACT), user feedback #1: "Backpack should show on item bar at bottom of the game with
// label '6' … When the backpack is selected you should see it being held in front of you. Clicking should place it. When the
// backpack is on the ground an E double tap or long hold should pick it up without needing to hit the UI button. In your
// inventory screen it says 'Contents Hidden' on the backpack. That should not be shown."
// Node tests over the real gear system (gear/system.ts) on a generated station with a minimal Game shell, the REAL Viewmodel
// (weapons/viewmodel.ts: the held bag), the real HUD (ui/hud.ts: slot 6) on a tiny fake DOM, and ui/gearStyles.ts.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installGear, BAG_HOLD_S} from '../src/gear/system';
import {Inventory, type ItemStack, stacksIn} from '../src/items/inventory';
import {GEAR_SLOTS} from '../src/items/gear';
import {BASE_MODIFIERS} from '../src/player/modifiers';
import {WeaponController} from '../src/weapons/weapons';
import {Viewmodel} from '../src/weapons/viewmodel';
import {PickupManager} from '../src/world/pickups';
import {generateStation} from '../src/gen/station';
import {levelsOf} from '../src/gen/levels';
import {MemoryBagStore} from '../src/gear/bagStore';
import type {Game} from '../src/game';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';

(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const DT = 1 / 60;

function shell(seed = 4242) {
  const layout = generateStation(seed, {startWeapon: 'pistol'});
  const levels = levelsOf(layout);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
  camera.rotation.order = 'YXZ';
  const toasts: string[] = [];
  const ring: (number | null)[] = [];
  const sel: boolean[] = [];
  const sp = layout.playerSpawn;
  // the canvas shim only while the Viewmodel draws its muzzle-flash texture (its `document` has nothing but canvases; the bag view
  // must see no DOM at all, exactly as in tests/gear-system.test.ts)
  const unshim = installCanvasShim(false);
  const viewmodel = new Viewmodel({} as never, {water: new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.23, 0.07))});
  unshim();
  const g = {
    scene: new THREE.Scene(), modifierSources: [] as (() => object)[], frameHooks: [] as ((dt: number) => void)[],
    interactHandlers: [] as (() => boolean)[], hitListeners: [] as ((h: {amount: number}) => void)[],
    sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[], stateListeners: [] as ((s: string, p: string) => void)[],
    promptProviders: [] as (() => string | null)[], inputOwners: [] as (() => boolean)[],
    warmRegistry: {addPool: () => {}},
    invUI: {gear: null as unknown},
    input: {
      onLockChange: (_l: boolean) => {}, clears: 0, keys: new Set<string>(), pressed: new Set<string>(), mouse: [false, false, false], mousePressed: [false, false, false], wheel: 0, locked: true,
      hit(c: string) { return this.pressed.has(c); }, down(c: string) { return this.keys.has(c); }, unlock() {}, lock: () => Promise.resolve(true),
    },
    inv: new Inventory(), weapon: new WeaponController(), mods: {...BASE_MODIFIERS},
    player: {x: sp.x, y: 0, z: sp.z, yaw: sp.yaw, pitch: 0, climbing: false, grounded: true, alive: true, eye: 1.6},
    consumeView: {busy: false}, viewmodel,
    sfx: {equip() {}, denied() {}, pickup() {}, search() {}},
    hud: {toast: (t: string) => { toasts.push(t); }, setHoldRing: (p: number | null) => { ring.push(p); }, setBagSelected: (on: boolean) => { sel.push(on); }},
    flareHold: {active: false, cancel: () => false}, camera, levels, layout, pickups: new PickupManager({}), qa: true, state: 'playing',
    /** Game.syncHeld (game.ts): the readied bag is what the hands hold, else the selected quick slot. */
    syncHeld() {
      const st = g.inv.selectedStack();
      if (g.gearReadied()) { g.weapon.equip(null); viewmodel.setItem('backpack'); } else viewmodel.setItem(st?.itemId === 'water' ? 'water' : null);
    },
    gearReadied: () => false,
  };
  const game = g as unknown as Game;
  const sys = installGear(game);
  g.gearReadied = () => sys.readied;
  sys.setStore(new MemoryBagStore());
  const view = () => {
    camera.position.set(g.player.x, g.player.y + g.player.eye, g.player.z);
    camera.rotation.set(g.player.pitch, g.player.yaw, 0);
    camera.updateMatrixWorld(true);
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      view();
      for (const f of g.frameHooks) f(DT);
      g.input.pressed.clear();
      g.input.mousePressed.fill(false);
      g.input.wheel = 0;
    }
  };
  const press = (code: string) => { g.input.pressed.add(code); step(); };
  /** E as Game.update does it: a press runs the interact handlers in order (the first true wins) before the frame hooks. */
  const otherHandled: string[] = [];
  g.interactHandlers.push(() => { otherHandled.push('tower/elevator/door'); return false; });
  const pressE = () => {
    g.input.keys.add('KeyE');
    g.input.pressed.add('KeyE');
    const handled = g.interactHandlers.some(h => h());
    step();
    return handled;
  };
  const releaseE = () => { g.input.keys.delete('KeyE'); step(); };
  const lookAt = (t: THREE.Vector3) => {
    const eye = new THREE.Vector3(g.player.x, g.player.y + g.player.eye, g.player.z), d = t.clone().sub(eye);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    view();
  };
  for (const h of g.sectionHooks) h.build?.(layout);
  return {g, game, sys, layout, levels, toasts, ring, sel, viewmodel, step, press, pressE, releaseE, lookAt, view, otherHandled};
}
type Shell = ReturnType<typeof shell>;

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
  inv.set({bar: 'hotbar', index: 0}, inv.makeStack('water', 2));
  inv.select(0);
  const bag = inv.makeStack('backpack', 1);
  bag.bag![3] = inv.makeStack('bandage', 4);
  bag.bag![5] = inv.makeStack('ammo_pistol', 30);
  expect(inv.add(bag)).toBe(0);
  return bag;
}

/** Put the worn bag down in front of the player (6, then click) and aim at it. */
function setDown(s: Shell) {
  faceOpenFloor(s);
  s.press('Digit6');
  s.g.input.mouse[0] = true;
  s.g.input.mousePressed[0] = true;
  s.step();
  s.g.input.mouse[0] = false;
  s.step();
  const b = s.sys.bags[0];
  s.lookAt(b.centre);
  s.step();
  expect(s.sys.target).toBe(b);
  return b;
}

const totals = (inv: Inventory, extra: ItemStack[] = []) => {
  const t: Record<string, number> = {};
  for (const x of [...inv.allStacks(true), ...extra.flatMap(e => stacksIn(e))]) t[x.itemId] = (t[x.itemId] ?? 0) + x.count;
  return t;
};

describe('6 = the backpack slot: held in front of you, click places it', () => {
  it('6 readies the worn bag: the viewmodel holds the backpack (on screen, in front, lower half); HUD slot 6 selected; 6 again slings it back', () => {
    const s = shell();
    const bag = wearLoadedBag(s);
    s.g.syncHeld();
    expect(s.viewmodel.heldItem).toBe('water');
    s.press('Digit6');
    expect(s.sys.readied).toBe(true);
    expect(s.g.inv.worn('backpack')).toBe(bag); // still worn until it is set down
    expect(s.viewmodel.heldItem).toBe('backpack');
    expect(s.viewmodel.hasItem('backpack')).toBe(true);
    expect(s.sel.at(-1)).toBe(true);
    expect(s.g.inputOwners[0]()).toBe(true); // mouse belongs to the bag: no shot
    // the held model: visible holder, every corner in front of the viewmodel camera, centre in the lower half, mostly on screen
    s.viewmodel.update(DT, {moving: 0, sprint: false, aiming: false, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0});
    for (let i = 0; i < 40; i++) s.viewmodel.update(DT, {moving: 0, sprint: false, aiming: false, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0});
    s.viewmodel.scene.updateMatrixWorld(true);
    const holder = s.viewmodel.scene.getObjectByName('held-backpack')!;
    expect(holder.visible).toBe(true);
    const box = new THREE.Box3().setFromObject(holder);
    const cam = s.viewmodel.camera;
    cam.aspect = 16 / 9; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    const c = box.getCenter(new THREE.Vector3()).project(cam);
    expect(c.z).toBeGreaterThan(-1);
    expect(c.z).toBeLessThan(1);
    expect(Math.abs(c.x)).toBeLessThan(0.6);
    expect(c.y).toBeLessThan(0);
    expect(c.y).toBeGreaterThan(-1.1);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(0.2); // the real bag model (stand-in until the Meshy file is loaded), not a speck
    s.press('Digit6');
    expect(s.sys.readied).toBe(false);
    s.g.syncHeld();
    expect(s.viewmodel.heldItem).toBe('water');
    expect(s.sel.at(-1)).toBe(false);
  });

  it('left click sets it down (the same bag, contents kept) and the placing click never fires; refused inside the cab', () => {
    const s = shell();
    const bag = wearLoadedBag(s);
    const want = totals(s.g.inv);
    faceOpenFloor(s);
    s.press('Digit6');
    s.g.input.mouse[0] = true;
    s.g.input.mousePressed[0] = true;
    s.step();
    expect(s.sys.bags.map(b => b.stack)).toEqual([bag]);
    expect(s.g.inv.worn('backpack')).toBeNull();
    expect(s.g.inputOwners[0]()).toBe(true); // still held down: never a shot
    s.g.input.mouse[0] = false;
    expect(s.g.inputOwners[0]()).toBe(false);
    expect(totals(s.g.inv, [bag])).toEqual(want);
    // refused in the elevator cab (existing rule)
    const s2 = shell();
    wearLoadedBag(s2);
    const p = s2.g.player;
    (s2.layout as unknown as {office: unknown}).office = {levelId: 0, elevator: {cab: {x0: p.x - 1.2, z0: p.z - 1, x1: p.x + 1.2, z1: p.z + 1}}};
    s2.press('Digit6');
    s2.g.input.mouse[0] = true; s2.g.input.mousePressed[0] = true;
    s2.step();
    expect(s2.sys.bags).toHaveLength(0);
    expect(s2.toasts.at(-1)).toMatch(/elevator/);
  });
});

describe('grounded bag: tap E opens, hold E picks it up and wears it', () => {
  it('the prompt says it; a tap opens the view on the RELEASE (never picks up) and the press is consumed by the bag', () => {
    const s = shell();
    const bag = wearLoadedBag(s);
    setDown(s);
    expect(s.g.promptProviders[0]()).toMatch(/\[E\]<\/b> Open backpack · <b>hold \[E\]<\/b> wear · 2 items inside/);
    expect(s.pressE()).toBe(true);
    expect(s.otherHandled).toEqual([]); // no door / elevator / container also gets this E
    expect(s.sys.viewOpen).toBe(false); // the first press alone does nothing yet
    expect(s.g.inputOwners[0]()).toBe(true); // held E: the mouse belongs to the bag
    s.step(5);
    s.releaseE();
    expect(s.sys.viewOpen).toBe(true);
    expect(s.sys.bags[0].stack).toBe(bag); // still on the ground
    expect(s.g.inv.worn('backpack')).toBeNull();
    expect(s.ring.filter(r => r !== null && r >= 1)).toHaveLength(0);
  });

  it('holding E for BAG_HOLD_S picks it up and wears it — same stack (uid, contents), nothing duplicated; ring shown, then hidden', () => {
    const s = shell();
    const bag = wearLoadedBag(s);
    const want = totals(s.g.inv);
    setDown(s);
    s.pressE();
    const frames = Math.ceil(BAG_HOLD_S / DT) + 2;
    for (let i = 0; i < frames && s.sys.bags.length; i++) s.step();
    expect(s.sys.bags).toHaveLength(0);
    expect(s.g.inv.worn('backpack')).toBe(bag);
    expect(bag.bag!.filter(Boolean).map(x => `${x!.itemId}x${x!.count}`)).toEqual(['bandagex4', 'ammo_pistolx30']);
    expect(totals(s.g.inv)).toEqual(want);
    expect(s.g.inv.invariants()).toEqual([]);
    expect(s.sys.viewOpen).toBe(false);
    expect(s.ring.some(r => r !== null && r > 0.5)).toBe(true);
    expect(s.ring.at(-1)).toBeNull();
    s.releaseE(); // letting go afterwards opens nothing
    expect(s.sys.viewOpen).toBe(false);
    expect(s.toasts.at(-1)).toMatch(/Picked up the backpack/);
  });

  it('a hold is cancelled cleanly (nothing happens) by looking away, a slot key, 6, or the input being cleared', () => {
    for (const how of ['look', 'Digit2', 'Digit6', 'clear'] as const) {
      const s = shell();
      const bag = wearLoadedBag(s);
      const b = setDown(s);
      s.pressE();
      s.step(3);
      if (how === 'look') { s.g.player.yaw += Math.PI; s.view(); s.step(); }
      else if (how === 'clear') { s.g.input.clears++; s.step(); }
      else s.press(how);
      expect(s.sys.holdProgress, how).toBeNull();
      for (let i = 0; i < 40; i++) s.step();
      s.releaseE();
      expect(s.sys.viewOpen, how).toBe(false);
      expect(s.sys.bags.map(x => x.stack), how).toEqual([bag]);
      expect(b.grounded, how).toBe(true);
      expect(s.g.inv.worn('backpack'), how).toBeNull();
      expect(s.ring.at(-1), how).toBeNull();
    }
  });

  it('holding E while already wearing another backpack is refused with a reason (the grounded one stays, no dupes)', () => {
    const s = shell();
    wearLoadedBag(s);
    const b = setDown(s);
    const other = s.g.inv.makeStack('backpack', 1);
    s.g.inv.set({bar: 'gear', index: GEAR_SLOTS.indexOf('backpack')}, other);
    expect(s.g.promptProviders[0]()).toMatch(/already wear one/);
    s.pressE();
    for (let i = 0; i < Math.ceil(BAG_HOLD_S / DT) + 2; i++) s.step();
    expect(s.sys.bags).toEqual([b]);
    expect(s.g.inv.worn('backpack')).toBe(other);
    expect(s.toasts.at(-1)).toMatch(/already wearing a backpack/);
  });
});

describe('HUD slot 6 and the inventory label (ui/hud.ts, ui/gearStyles.ts)', () => {
  let dom: FakeDom;
  beforeAll(() => { dom = installFakeDom(); });
  afterAll(() => dom.uninstall());

  it('slot 6 holds the worn backpack (dim "no bag" without one) and is the selected slot while the bag is in the hands', async () => {
    const {Hud} = await import('../src/ui/hud');
    const hud = new Hud();
    const inv = new Inventory();
    inv.set({bar: 'hotbar', index: 0}, inv.makeStack('pistol', 1, 15));
    inv.select(0);
    const state = {hp: 100, maxHp: 100, stamina: 100, weaponName: '', mag: null, reserve: 0, hint: '', prompt: '', remaining: 0, total: 0, area: '', spreadPx: 4, aiming: false, flashlight: false, use: null};
    hud.update(state, inv);
    const bar = dom.el('#hotbar');
    expect(bar.children).toHaveLength(7);
    const six = bar.children[5];
    expect(six.dataset).toMatchObject({bar: 'gear', index: String(GEAR_SLOTS.indexOf('backpack'))});
    expect(six.innerHTML).toMatch(/<span class="key">6<\/span>/);
    expect(six.innerHTML).toMatch(/no bag/);
    expect(six.classList.contains('vacant')).toBe(true);
    inv.add(inv.makeStack('backpack', 1));
    hud.update(state, inv);
    expect(six.classList.contains('vacant')).toBe(false);
    expect(six.innerHTML).toMatch(/Backpack/);
    expect(bar.children[0].classList.contains('selected')).toBe(true);
    hud.setBagSelected(true);
    hud.update(state, inv);
    expect(six.classList.contains('selected')).toBe(true);
    expect(bar.children[0].classList.contains('selected')).toBe(false);
    hud.setBagSelected(false);
    hud.update(state, inv);
    expect(six.classList.contains('selected')).toBe(false);
    expect(bar.children[0].classList.contains('selected')).toBe(true);
    // the hold ring
    hud.setHoldRing(0.4);
    expect(hud.holdRing).toBe(40);
    hud.setHoldRing(null);
    expect(hud.holdRing).toBe(-1);
  });

  it('the "contents hidden" label is gone; the worn bag\'s contents are still out of reach (only on the ground)', async () => {
    const {ensureGearStyles} = await import('../src/ui/gearStyles');
    ensureGearStyles();
    const css = dom.doc.head.children.map(c => c.textContent).join('\n');
    expect(css).toMatch(/#inv-gear/);
    expect(css.toLowerCase()).not.toContain('contents hidden');
    const inv = new Inventory();
    const bag = inv.makeStack('backpack', 1);
    inv.add(bag);
    inv.set({bar: 'pack', index: 0}, inv.makeStack('water', 1));
    expect(inv.bagQuick(bag, {bar: 'pack', index: 0})).toBe(0);
    expect(inv.refusal?.code).toBe('worn-bag');
  });
});
