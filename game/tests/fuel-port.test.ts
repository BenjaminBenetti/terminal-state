// Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the train's FUEL CAP (world/fuelPort.ts) on a minimal Game shell (the
// registries + the real Inventory / PlayerTrainRecord, a fake parked train runtime in the train-local frame), the HUD fuel readout (pure
// fuelReadout + ui/hud.ts setFuel on the tiny fake DOM), the fuel-can model (world/fuelCanModel.ts) and source checks of the game.ts
// wiring (one install line; the pour never goes through the consumable use).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {FUEL_PORT, FuelPortSystem, fuelReadout, installFuelPort, rayBoxT, tankCount, type FuelHudView} from '../src/world/fuelPort';
import {FUEL, type CartFuel} from '../src/fuel/fuel';
import {PORT, fuelPortLocal} from '../src/fuel/trainPort';
import {trainToWorld, worldToTrain} from '../src/gen/playerTrain';
import {Inventory, type ItemStack} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {FUEL_CAN_MODEL_URL, fuelCanModel, fuelCanModelSource, registerFuelCanModel} from '../src/world/fuelCanModel';
import {itemTemplate, registerItemModels} from '../src/world/pickups';
import {itemDims} from '../src/items/items';
import type {Game} from '../src/game';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';

installCanvasShim(false);

const DT = 1 / 60;
const CAP = fuelPortLocal();
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** A parked car at the world origin (front +X: train-local = world) — the PlayerTrainRuntime surface fuelPort uses. */
function fakeTrain(front: 1 | -1 = 1) {
  const placement = {x: 0, z: 0, railTopY: 0, front, level: 0};
  return {
    view: {root: new THREE.Group()} as {root: THREE.Group} | null,
    train: {placement},
    carLocal: (x: number, y: number, z: number) => worldToTrain(placement, x, y, z),
    carDir: (x: number, y: number, z: number) => ({x: x * front, y, z: z * front}),
    carPoint: (x: number, y: number, z: number) => trainToWorld(placement, x, y, z),
  };
}

/** A Game shell with exactly what FuelPortSystem touches. */
function shell(front: 1 | -1 = 1) {
  const toasts: {text: string; warn: boolean}[] = [];
  const calls = {denied: 0, pour: 0, stopPour: 0, sync: 0};
  const pools: Record<string, () => readonly THREE.Object3D[]> = {};
  let hudView: FuelHudView | null | undefined;
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
  const g = {
    scene: new THREE.Scene(), camera, state: 'playing',
    frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[],
    interactHandlers: [] as (() => boolean)[], pointerHandlers: [] as (() => boolean)[], promptProviders: [] as (() => string | null)[],
    inputOwners: [] as (() => boolean)[], hitListeners: [] as ((h: {amount: number}) => void)[], stateListeners: [] as ((s: string, prev: string) => void)[],
    warmRegistry: {addPool: (n: string, f: () => readonly THREE.Object3D[]) => { pools[n] = f; }},
    player: {x: 0, y: 0.98, z: 0, alive: true, climbing: false, sprinting: false},
    input: {clears: 0},
    inv: new Inventory(), playerTrain: new PlayerTrainRecord(),
    trainRuntime: fakeTrain(front), trainRide: {riding: false},
    levels: {raycast: () => ({kind: 'none', t: Infinity})},
    consumeView: {busy: false}, gasMask: {transitioning: false}, gear: {readied: false},
    hud: {toast: (text: string, warn = false) => { toasts.push({text, warn}); }, setFuel: (v: FuelHudView | null) => { hudView = v; }},
    sfx: {denied() { calls.denied++; }, fuelPour() { calls.pour++; return 2.58; }, stopFuelPour() { calls.stopPour++; }},
    syncHeld() { calls.sync++; },
  };
  const sys = installFuelPort(g as unknown as Game);
  const step = (seconds = DT) => { const n = Math.round(seconds / DT); for (let i = 0; i < n; i++) for (const f of g.frameHooks) f(DT); };
  /** Stand on the platform side in front of the cap (local z < -width/2), eye 1.62 m up, looking at the cap. */
  const standAtCap = (back = 0.8, look: {x: number; y: number; z: number} = CAP) => {
    const feet = trainToWorld(g.trainRuntime.train.placement, CAP.x, 0.98, CAP.z - back);
    g.player.x = feet.x; g.player.y = feet.y; g.player.z = feet.z;
    camera.position.set(feet.x, feet.y + 1.62, feet.z);
    const w = trainToWorld(g.trainRuntime.train.placement, look.x, look.y, look.z);
    camera.lookAt(w.x, w.y, w.z);
    camera.updateMatrixWorld(true);
  };
  const lookAt = (x: number, y: number, z: number) => { camera.lookAt(x, y, z); camera.updateMatrixWorld(true); };
  const press = () => { for (const h of g.interactHandlers) if (h()) return true; return false; };
  const prompt = () => { for (const f of g.promptProviders) { const p = f(); if (p) return p; } return null; };
  const give = (n: number, where: 'pack' | 'hotbar' = 'pack', index = 0): ItemStack => {
    const st = g.inv.makeStack(FUEL.canItem, n);
    st.count = n;
    g.inv.set({bar: where, index}, st);
    return st;
  };
  const setState = (s: string) => { const prev = g.state; g.state = s; for (const f of g.stateListeners) f(s, prev); };
  return {g, sys, toasts, calls, pools, step, standAtCap, lookAt, press, prompt, give, setState, hud: () => hudView};
}

describe('fuel cap: aim, prompt and the E press', () => {
  it('the cap is a child of the train view at fuelPortLocal(); attached lazily (the train builds after this system)', () => {
    const s = shell();
    expect(s.sys.cap.parent).toBeNull();
    s.step();
    expect(s.sys.cap.parent).toBe(s.g.trainRuntime.view!.root);
    expect(s.sys.cap.position.toArray()).toEqual([CAP.x, CAP.y, CAP.z]);
    // fixture bounds: on the platform-side skin, under the window above it (y0 1.96), out to the cap
    const b = new THREE.Box3().setFromObject(s.g.trainRuntime.view!.root);
    expect(b.max.z).toBeLessThan(-1.46);
    expect(b.min.z).toBeGreaterThan(CAP.z - FUEL_PORT.aim.out);
    expect(b.max.y).toBeLessThan(1.96);
    // every mesh is plain-coloured (no texture maps)
    s.sys.cap.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) expect((m.material as THREE.MeshStandardMaterial).map).toBeNull(); });
    // no car: detached; a new car: re-parented
    s.g.trainRuntime.view = null;
    s.step();
    expect(s.sys.cap.parent).toBeNull();
    s.g.trainRuntime.view = {root: new THREE.Group()};
    expect(s.pools['fuel-port']().includes(s.sys.cap)).toBe(true);
    expect(s.sys.cap.parent).toBe(s.g.trainRuntime.view.root);
  });

  it('prompt only while aimed; E consumed only while the cap is the aim target; never through the skin from inside', () => {
    for (const front of [1, -1] as const) {
      const s = shell(front);
      s.give(2);
      s.standAtCap();
      s.step();
      expect(s.sys.aimed).toBe(true);
      expect(s.prompt()).toBe('<b>[E]</b> Pour a fuel can · tank empty · 2 cans');
      // look along the car: not aimed — no prompt, E not consumed
      const c = s.g.camera.position;
      s.lookAt(c.x + 5 * front, c.y, c.z);
      s.step();
      expect(s.sys.aimed).toBe(false);
      expect(s.prompt()).toBeNull();
      expect(s.press()).toBe(false);
      expect(s.sys.pour).toBeNull();
      // inside the car looking out at the cap's spot: the ray meets the aim box but the eye is inside the outline
      const inside = trainToWorld(s.g.trainRuntime.train.placement, CAP.x, 2.6, -1.0);
      s.g.player.x = inside.x; s.g.player.z = inside.z;
      s.g.camera.position.set(inside.x, inside.y, inside.z);
      const capW = trainToWorld(s.g.trainRuntime.train.placement, CAP.x, CAP.y, CAP.z);
      s.lookAt(capW.x, capW.y, capW.z);
      s.step();
      expect(s.sys.aimed).toBe(false);
      expect(s.press()).toBe(false);
      // out of reach (2.2 m back)
      s.standAtCap(2.2);
      s.step();
      expect(s.sys.aimed).toBe(false);
      // the station's geometry in between blocks it
      s.standAtCap();
      s.g.levels.raycast = () => ({kind: 'wall', t: 0.3});
      s.step();
      expect(s.sys.aimed).toBe(false);
      s.g.levels.raycast = () => ({kind: 'none', t: Infinity});
      s.step();
      expect(s.sys.aimed).toBe(true);
    }
  });

  it('rayBoxT: entry distance, misses, beyond maxT', () => {
    const box = {min: {x: -1, y: -1, z: -1}, max: {x: 1, y: 1, z: 1}};
    expect(rayBoxT({x: -5, y: 0, z: 0}, {x: 1, y: 0, z: 0}, box.min, box.max, 10)).toBeCloseTo(4);
    expect(rayBoxT({x: -5, y: 2, z: 0}, {x: 1, y: 0, z: 0}, box.min, box.max, 10)).toBeNull();
    expect(rayBoxT({x: -5, y: 0, z: 0}, {x: 1, y: 0, z: 0}, box.min, box.max, 3)).toBeNull();
    expect(rayBoxT({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 1}, box.min, box.max, 3)).toBe(0);
  });
});

describe('fuel cap: the pour', () => {
  it('one can -> tank +1 exactly, after the timed pour (nothing before it ends); the held can is used first', () => {
    const s = shell();
    const pocket = s.give(2, 'pack', 0);
    const hand = s.give(1, 'hotbar', 0);
    s.g.inv.select(0);
    s.standAtCap();
    s.step();
    expect(s.press()).toBe(true);
    expect(s.sys.pour).not.toBeNull();
    expect(s.calls.pour).toBe(1);
    expect(s.g.inputOwners.some(f => f())).toBe(true); // no fire / ADS / use while pouring
    s.step(FUEL_PORT.pourS * 0.5);
    expect(s.prompt()).toMatch(/^<b>Pouring fuel…<\/b> (49|50) %$/);
    expect(s.g.playerTrain.fuel.tank).toBe(0);
    expect(s.g.inv.count(FUEL.canItem)).toBe(3);
    s.step(FUEL_PORT.pourS * 0.5 + 0.05);
    expect(s.sys.pour).toBeNull();
    expect(s.g.playerTrain.fuel.tank).toBe(1);
    expect(s.g.inv.count(FUEL.canItem)).toBe(2);
    expect(s.g.inv.hotbar[0]).toBeNull(); // the hand's can went in
    expect(pocket.count).toBe(2);
    expect(hand.count).toBe(0);
    expect(s.calls.sync).toBe(1);
    expect(s.toasts.at(-1)!.text).toBe('Fuel in — tank ¼ tank · 2 cans left');
    expect(s.g.inputOwners.some(f => f())).toBe(false);
    // the next pour takes from the pockets (no can in the hand now)
    s.press();
    s.step(FUEL_PORT.pourS + 0.05);
    expect(s.g.playerTrain.fuel.tank).toBe(2);
    expect(pocket.count).toBe(1);
    expect(s.sys.counts.pours).toBe(2);
    expect(s.g.inv.invariants()).toEqual([]);
  });

  it('refusals: tank full / no can / moving — short toasts, nothing used', () => {
    const s = shell();
    s.give(2);
    s.standAtCap();
    s.g.playerTrain.fuel.tank = FUEL.tankUnits;
    s.step();
    expect(s.prompt()).toBe('Fuel cap · the tank is full (1 tank)');
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)).toEqual({text: 'The tank is full — 1 tank', warn: true});
    expect(s.sys.pour).toBeNull();
    expect(s.g.inv.count(FUEL.canItem)).toBe(2);
    expect(s.g.playerTrain.fuel.tank).toBe(4);
    s.g.playerTrain.fuel.tank = 3;
    s.g.trainRide.riding = true;
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)).toEqual({text: 'Not while moving', warn: true});
    s.g.trainRide.riding = false;
    s.g.inv.take(FUEL.canItem, 2);
    s.step();
    expect(s.prompt()).toBe('<b>[E]</b> Fuel cap · tank ¾ tank · no fuel can');
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)).toEqual({text: 'No fuel can', warn: true});
    expect(s.calls.denied).toBe(3);
    expect(s.calls.pour).toBe(0);
    expect(s.g.playerTrain.fuel.tank).toBe(3);
  });

  it('a full tank by the end of the pour (filled meanwhile) refuses at completion: nothing used', () => {
    const s = shell();
    s.give(1);
    s.g.playerTrain.fuel.tank = 3;
    s.standAtCap();
    s.step();
    s.press();
    s.step(0.5);
    s.g.playerTrain.fuel.tank = 4; // e.g. a cart's hose filled it
    s.step(FUEL_PORT.pourS);
    expect(s.g.playerTrain.fuel.tank).toBe(4);
    expect(s.g.inv.count(FUEL.canItem)).toBe(1);
    expect(s.toasts.at(-1)!.text).toBe('The tank is full — 1 tank');
  });

  it('cancel mid-pour (hit, sprint, walking away, looking away, a menu, input cleared, riding, teardown): nothing used', () => {
    const cases: [string, (s: ReturnType<typeof shell>) => void][] = [
      ['hit', s => { for (const f of s.g.hitListeners) f({amount: 12}); }],
      ['sprint', s => { s.g.player.sprinting = true; }],
      ['away', s => { s.standAtCap(2.4); }],
      ['away', s => { const c = s.g.camera.position; s.lookAt(c.x + 5, c.y, c.z); }],
      ['menu', s => { s.setState('paused'); }],
      ['menu', s => { s.g.input.clears++; }],
      ['riding', s => { s.g.trainRide.riding = true; }],
      ['teardown', s => { for (const h of s.g.sectionHooks) h.teardown?.(); }],
    ];
    for (const [why, act] of cases) {
      const s = shell();
      s.give(2);
      s.standAtCap();
      s.step();
      expect(s.press(), why).toBe(true);
      s.step(0.8);
      act(s);
      s.step(FUEL_PORT.awayGraceS + 0.1);
      s.step(FUEL_PORT.pourS); // well past the pour's end
      expect(s.sys.pour, why).toBeNull();
      expect(s.sys.lastCancel, why).toBe(why);
      expect(s.g.playerTrain.fuel.tank, why).toBe(0);
      expect(s.g.inv.count(FUEL.canItem), why).toBe(2);
      expect(s.calls.stopPour, why).toBe(1);
    }
    // a glance off the cap shorter than the grace does not cancel
    const s = shell();
    s.give(1);
    s.standAtCap();
    s.step();
    s.press();
    s.step(0.4);
    const c = s.g.camera.position;
    s.lookAt(c.x + 5, c.y, c.z);
    s.step(FUEL_PORT.awayGraceS - 0.1);
    s.standAtCap();
    s.step(FUEL_PORT.pourS);
    expect(s.g.playerTrain.fuel.tank).toBe(1);
    expect(s.g.inv.count(FUEL.canItem)).toBe(0);
  });

  it('never draws from a worn backpack\'s contents', () => {
    const s = shell();
    const bag = s.g.inv.makeStack('backpack', 1);
    expect(s.g.inv.add(bag)).toBe(0);
    expect(s.g.inv.wornBag()).toBe(bag);
    const inBag = s.g.inv.makeStack(FUEL.canItem, 2);
    inBag.count = 2;
    bag.bag![0] = inBag;
    s.standAtCap();
    s.step();
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)!.text).toBe('No fuel can at hand — the ones in your backpack need it set down');
    expect(s.sys.pour).toBeNull();
    // with a can in the pockets too: the pocket can is poured, the bag's stay
    s.give(1);
    s.press();
    s.step(FUEL_PORT.pourS + 0.05);
    expect(s.g.playerTrain.fuel.tank).toBe(1);
    expect(inBag.count).toBe(2);
    expect(bag.bag![0]).toBe(inBag);
    expect(s.g.inv.count(FUEL.canItem)).toBe(0);
  });

  it('a fuel can in the hand + left click at the aimed cap pours like E; otherwise the click is not taken', () => {
    const s = shell();
    s.give(1, 'hotbar', 2);
    s.standAtCap();
    s.step();
    const click = () => s.g.pointerHandlers.some(h => h());
    s.g.inv.select(0); // empty hand
    expect(click()).toBe(false);
    s.g.inv.select(2);
    const c = s.g.camera.position;
    s.lookAt(c.x + 5, c.y, c.z);
    s.step();
    expect(click()).toBe(false); // not aimed
    s.standAtCap();
    s.step();
    expect(click()).toBe(true);
    expect(s.sys.pour).not.toBeNull();
    s.step(FUEL_PORT.pourS + 0.05);
    expect(s.g.playerTrain.fuel.tank).toBe(1);
    expect(s.g.inv.count(FUEL.canItem)).toBe(0);
  });

  it('the held fuel can joins the viewmodel once (section build), centred on its holder', () => {
    const s = shell();
    const items = new Map<string, {obj: THREE.Object3D; pose: unknown}>();
    (s.g as unknown as {viewmodel: unknown}).viewmodel = {hasItem: (id: string) => items.has(id), addHeldItem: (id: string, obj: THREE.Object3D, pose: unknown) => { items.set(id, {obj, pose}); }};
    for (const h of s.g.sectionHooks) h.build?.({});
    for (const h of s.g.sectionHooks) h.build?.({});
    expect([...items.keys()]).toEqual([FUEL.canItem]);
    const it0 = items.get(FUEL.canItem)!;
    expect(it0.pose).toBe(FUEL_PORT.held);
    const b = new THREE.Box3().setFromObject(it0.obj);
    expect(Math.abs(b.min.y + b.max.y)).toBeLessThan(1e-6);
    expect(s.calls.sync).toBe(1);
  });
});

describe('HUD fuel readout', () => {
  const chestWith = (...counts: number[]) => {
    const inv = new Inventory();
    const slots: (ItemStack | null)[] = new Array(40).fill(null);
    counts.forEach((n, i) => { const st = inv.makeStack(FUEL.canItem, n); st.count = n; slots[i * 3] = st; });
    slots[1] = inv.makeStack('water', 1);
    return slots;
  };
  it('fuelReadout: the tank as quarter pips + reserves aboard from fuel/fuel.ts reservesOf (chest = the Lockbox, carts aboard)', () => {
    const carts: CartFuel[] = [{uid: 'c1', units: 4}];
    const r = fuelReadout(3, carts, chestWith(2, 2));
    expect(r).toMatchObject({pips: 3, tank: 3, low: false, text: 'Fuel ¾ tank · aboard +2 tanks (chest 1, carts 1)'});
    expect(r.reserves).toEqual({tank: 3, carts: 4, chest: 4, total: 11});
    expect(fuelReadout(0, [], chestWith())).toMatchObject({pips: 0, text: 'Fuel empty', low: true});
    expect(fuelReadout(4, [], chestWith())).toMatchObject({pips: 4, text: 'Fuel 1 tank', low: false});
    expect(fuelReadout(1, [], chestWith(2, 1))).toMatchObject({text: 'Fuel ¼ tank · aboard +¾ tank (chest ¾)', low: false});
    expect(fuelReadout(0, [{uid: 'a', units: 8}, {uid: 'b', units: 2}], chestWith())).toMatchObject({text: 'Fuel empty · aboard +2½ tanks (carts 2½)', low: false});
    expect(fuelReadout(2, [], chestWith(1))).toMatchObject({low: true});
    expect(['0', '¼', '½', '¾', '1', '1¼', '2'].map((t, i) => [t, tankCount([0, 1, 2, 3, 4, 5, 8][i])])).toEqual(['0', '¼', '½', '¾', '1', '1¼', '2'].map(t => [t, t]));
  });

  it('shown near / inside the parked car and while riding, hidden far away; tank, chest and carts read live', () => {
    const s = shell();
    s.standAtCap();
    s.g.playerTrain.fuel.tank = 2;
    const st = s.g.inv.makeStack(FUEL.canItem, 2);
    st.count = 2;
    s.g.playerTrain.lockbox.slots[5] = st;
    s.step();
    expect(s.hud()).toEqual({pips: 2, tank: 2, text: 'Fuel ½ tank · aboard +½ tank (chest ½)', low: false});
    // the carts aboard (world/fuelCarts.ts, optional): read through game.fuelCarts.aboard()
    (s.g as unknown as {fuelCarts: unknown}).fuelCarts = {aboard: () => [{uid: 'k', units: 8}]};
    s.step();
    expect(s.hud()!.text).toBe('Fuel ½ tank · aboard +2½ tanks (chest ½, carts 2)');
    // a non-cart value there (Game's own private fuelCarts() method before the cart system exists) counts as no carts
    (s.g as unknown as {fuelCarts: unknown}).fuelCarts = function fuelCarts() { return null; };
    s.step();
    expect(s.hud()!.text).toBe('Fuel ½ tank · aboard +½ tank (chest ½)');
    // far from the car: hidden; riding: shown
    s.g.player.x = 40; s.g.player.z = -20;
    s.step();
    expect(s.hud()).toBeNull();
    s.g.trainRide.riding = true;
    s.step();
    expect(s.hud()).not.toBeNull();
    s.g.trainRide.riding = false;
    // inside the car
    s.g.player.x = -3; s.g.player.z = 0.4;
    s.step();
    expect(s.hud()!.pips).toBe(2);
    // ~6 m from the outline: shown; 7 m: hidden
    s.g.player.x = CAP.x; s.g.player.z = -(1.4933 + 5.9);
    s.step();
    expect(s.hud()).not.toBeNull();
    s.g.player.z = -(1.4933 + 7);
    s.step();
    expect(s.hud()).toBeNull();
  });

  describe('ui/hud.ts setFuel on the fake DOM', () => {
    let dom: FakeDom;
    beforeAll(() => { dom = installFakeDom(); });
    afterAll(() => dom.uninstall());
    it('a row at the top of the light panel: four pips, the text, amber when low; DOM written only on change', async () => {
      const {Hud} = await import('../src/ui/hud');
      const hud = new Hud();
      const panel = dom.el('#light-panel');
      hud.setFuel({pips: 3, tank: 3, text: 'Fuel ¾ tank · aboard +2 tanks (chest 1, carts 1)', low: false});
      const row = panel.children[0];
      expect(row.id).toBe('fuel-tag');
      expect(row.classList.contains('none')).toBe(false);
      expect(row.classList.contains('low')).toBe(false);
      expect((row.innerHTML.match(/<i class="on">/g) ?? []).length).toBe(3);
      expect((row.innerHTML.match(/<i class="">/g) ?? []).length).toBe(1);
      expect(row.innerHTML).toContain('<span class="txt">Fuel ¾ tank · aboard +2 tanks (chest 1, carts 1)</span>');
      const html = row.innerHTML;
      row.innerHTML = 'sentinel';
      hud.setFuel({pips: 3, tank: 3, text: 'Fuel ¾ tank · aboard +2 tanks (chest 1, carts 1)', low: false});
      expect(row.innerHTML).toBe('sentinel'); // unchanged -> no write
      row.innerHTML = html;
      hud.setFuel({pips: 0, tank: 0, text: 'Fuel empty', low: true});
      expect(row.classList.contains('low')).toBe(true);
      hud.setFuel(null);
      expect(row.classList.contains('none')).toBe(true);
      expect(panel.children.filter(c => c.id === 'fuel-tag')).toHaveLength(1);
    });
  });
});

describe('fuel can model + wiring', () => {
  it('the delivered GLB path is referenced in game code (the packager ships it); a failed / absent load uses the labelled fallback box', () => {
    const prov = JSON.parse(readFileSync(fileURLToPath(new URL('../public/assets/derivatives/train-fuel-can.json', import.meta.url)), 'utf8'));
    expect(FUEL_CAN_MODEL_URL).toBe(prov.output.url);
    expect(src('../src/world/fuelCanModel.ts')).toContain(`'${FUEL_CAN_MODEL_URL}'`);
    registerFuelCanModel(null);
    registerItemModels({});
    const fb = itemTemplate(FUEL.canItem);
    expect(fuelCanModelSource()).toMatch(/^FALLBACK box .*not finished art/);
    expect(fb.getObjectByName('fuel-can-fallback')).toBeTruthy();
    const d = itemDims(FUEL.canItem), b = new THREE.Box3().setFromObject(fb), size = b.getSize(new THREE.Vector3());
    expect(d).toMatchObject({w: 0.32, d: 0.165, h: 0.47});
    expect(size.x).toBeCloseTo(d.w, 3); expect(size.y).toBeCloseTo(d.h, 3); expect(size.z).toBeCloseTo(d.d, 3);
    expect(b.min.y).toBeCloseTo(0, 6);
  });

  it('with the GLB loaded: pickups / icons / held view use it as delivered (a clone sharing its geometry and Meshy maps)', () => {
    const map = new THREE.Texture();
    const mat = new THREE.MeshStandardMaterial({name: 'train-fuel-can', map});
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.47, 0.165).translate(0, 0.235, 0), mat);
    const scene = new THREE.Group();
    scene.add(mesh);
    registerFuelCanModel({scene});
    registerItemModels({});
    try {
      expect(fuelCanModelSource()).toBe(`meshy-t2.5 ${FUEL_CAN_MODEL_URL}`);
      const t = itemTemplate(FUEL.canItem);
      const meshes: THREE.Mesh[] = [];
      t.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      expect(meshes).toHaveLength(1);
      expect(meshes[0].geometry).toBe(mesh.geometry);
      expect(meshes[0].material).toBe(mat);
      expect((meshes[0].material as THREE.MeshStandardMaterial).map).toBe(map); // Meshy maps kept as they are
      expect(fuelCanModel().children[0]).not.toBe(scene);
    } finally {
      registerFuelCanModel(null);
      registerItemModels({});
    }
  });

  it('game.ts: one install line after the gas mask; the GLB awaited before item templates; supplies with a held model show in the hand', () => {
    const game = src('../src/game.ts');
    const i = game.indexOf('this.gasMask = installGasMask('), j = game.indexOf('this.fuelPort = installFuelPort(this); hookName(\'fuelPort\'); // task train-fuel-system (lane PORT)');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(game.indexOf('await preloadFuelCanModel()')).toBeLessThan(game.indexOf('registerItemModels(m as unknown'));
    expect(game).toMatch(/def\?\.kind === 'supply' && this\.viewmodel\.hasItem\(st!\.itemId\)/);
    // the pour never routes through the consumable use / its return / the LMB latch
    const port = src('../src/world/fuelPort.ts').replace(/\/\/.*$/gm, '');
    for (const word of ['startUse', 'consumeReturn', 'lmbLatch', 'completeUse']) expect(port, word).not.toContain(word);
    expect(port).not.toMatch(/bag\b.*take|\.bag!?\s*\[/); // no worn-bag draws (the bag is only read for the refusal text)
  });

  it('the cap aim box sits inside PORT.reach of a player standing on the platform', () => {
    const s = shell();
    s.standAtCap(0.6);
    const capW = s.sys.capWorld()!;
    expect(s.g.camera.position.distanceTo(new THREE.Vector3(capW.x, capW.y, capW.z))).toBeLessThan(PORT.reach);
    expect(s.sys).toBeInstanceOf(FuelPortSystem);
  });
});
