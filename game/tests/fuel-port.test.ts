// Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the train's FUEL CAP (world/fuelPort.ts) on a minimal Game shell (the
// registries + the real Inventory / PlayerTrainRecord, a fake parked train runtime in the train-local frame), the HUD fuel readout (pure
// fuelReadout + ui/hud.ts setFuel on the tiny fake DOM), the fuel-can model (world/fuelCanModel.ts) and source checks of the game.ts
// wiring (one install line; the pour never goes through the consumable use).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {FUEL_PORT, FuelPortSystem, fuelNeckMouthLocal, fuelReadout, heldCanPose, installFuelPort, rayBoxT, tankCount, type FuelHudView} from '../src/world/fuelPort';
import {POUR_VIEW, pourPhaseAt} from '../src/world/fuelPourView';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import {WeaponController} from '../src/weapons/weapons';
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
    s.g.playerTrain.fuel.tank = FUEL.trainTankUnits; // (task studio-general-armor-20261107-231448-01: two tanks; task gameplay-feedback lane TRAVEL: four)
    s.step();
    expect(s.prompt()).toBe('Fuel cap · the tank is full (4 tanks)');
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)).toEqual({text: 'The tank is full — 4 tanks', warn: true});
    expect(s.sys.pour).toBeNull();
    expect(s.g.inv.count(FUEL.canItem)).toBe(2);
    expect(s.g.playerTrain.fuel.tank).toBe(16);
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
    s.g.playerTrain.fuel.tank = 15;
    s.standAtCap();
    s.step();
    s.press();
    s.step(0.5);
    s.g.playerTrain.fuel.tank = 16; // e.g. a cart's hose filled it (task gameplay-feedback lane TRAVEL: the train holds four tanks; was 7 -> 8 of two)
    s.step(FUEL_PORT.pourS);
    expect(s.g.playerTrain.fuel.tank).toBe(16);
    expect(s.g.inv.count(FUEL.canItem)).toBe(1);
    expect(s.toasts.at(-1)!.text).toBe('The tank is full — 4 tanks');
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

// Task studio-beta-fuel-feedback-20261106-064128-01 (lane POUR): the VISIBLE pour (world/fuelPourView.ts) — the user: "See an animation
// of the can being poured into train".
describe('fuel cap: the visible pour', () => {
  const MOUTH = fuelNeckMouthLocal();
  const SKIN_Z = -PLAYER_TRAIN_SPEC.width / 2;
  const PLATE_Z = SKIN_Z + FUEL_PORT.part.plateInset - FUEL_PORT.part.plateD;
  const POUR_AT = POUR_VIEW.liftS + POUR_VIEW.tiltS + 0.25; // well inside the pour phase
  const mouthV = new THREE.Vector3(MOUTH.x, MOUTH.y, MOUTH.z);

  /** A viewmodel stand-in (hasItem / addHeldItem / setItem / heldItem / camera) whose shown item follows the selection (Game.syncHeld). */
  const withViewmodel = (s: ReturnType<typeof shell>) => {
    const items = new Map<string, THREE.Object3D>();
    const setCalls: (string | null)[] = [];
    const vm = {
      camera: new THREE.PerspectiveCamera(FUEL_PORT.viewmodelFov, 16 / 9, 0.01, 20), heldItem: null as string | null,
      hasItem: (id: string) => items.has(id), addHeldItem: (id: string, obj: THREE.Object3D) => { items.set(id, obj); },
      setItem(id: string | null) { if (vm.heldItem === id) return; setCalls.push(id); vm.heldItem = id && items.has(id) ? id : null; }, // (as Viewmodel.setItem: a no-op for the same item)
    };
    (s.g as unknown as {viewmodel: unknown}).viewmodel = vm;
    s.g.syncHeld = () => { s.calls.sync++; const st = s.g.inv.meleeSelected ? null : s.g.inv.selectedStack(); vm.setItem(st?.itemId === FUEL.canItem ? st.itemId : null); };
    for (const h of s.g.sectionHooks) h.build?.({});
    return {vm, items, setCalls};
  };
  const view = (s: ReturnType<typeof shell>) => s.sys.qa().view;
  /** The can's 8 bounds corners in the train-local frame right now. */
  const corners = (s: ReturnType<typeof shell>) => {
    const v = s.sys.pourView!, b = v.bounds, out: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) out.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyQuaternion(v.can.quaternion).add(v.can.position));
    return out;
  };

  it('phases: lift -> tilt -> pour -> settle inside FUEL_PORT.pourS (2.4 s, close to the 2.58 s pour sound)', () => {
    expect(FUEL_PORT.pourS).toBe(2.4);
    expect(POUR_VIEW.liftS + POUR_VIEW.tiltS + POUR_VIEW.settleS).toBeLessThan(FUEL_PORT.pourS - 0.8); // the pour phase itself lasts >= 0.8 s
    const at = (t: number) => pourPhaseAt(t, FUEL_PORT.pourS).phase;
    expect([0, 0.3, 0.6, 0.9, 1.9, 2.0, 2.39].map(at)).toEqual(['lift', 'lift', 'tilt', 'pour', 'pour', 'settle', 'settle']);
  });

  it('E with the cans in the pockets: hidden before; lifted, tipped over the uncapped neck pouring, back; one can used only at the end', () => {
    const s = shell();
    s.give(2, 'pack', 3);
    s.standAtCap();
    s.step();
    expect(view(s)?.visible ?? false).toBe(false);
    expect(s.press()).toBe(true);
    expect(view(s)).toMatchObject({active: true, visible: true, phase: 'lift', stream: false});
    expect(s.sys.uncapped).toBe(false);
    s.step(0.4);
    expect(view(s)).toMatchObject({phase: 'lift', visible: true, stream: false});
    expect(s.sys.uncapped).toBe(true); // the screw cap comes off as the can arrives
    s.step(POUR_AT - 0.4);
    const v = s.sys.pourView!;
    expect(view(s)).toMatchObject({phase: 'pour', visible: true, stream: true});
    // tipped past its side (its top below horizontal), the spout down over the neck, a few cm above / out of its mouth
    expect(v.canUp().y).toBeLessThan(-0.2);
    expect(v.dir.y).toBeLessThan(-0.6); // the spout's own axis points down at the neck below it
    const tip = v.spoutTip();
    expect(tip.distanceTo(mouthV)).toBeLessThan(0.09);
    expect(tip.y).toBeGreaterThan(MOUTH.y + FUEL_PORT.part.neckR);
    // the stream runs from the spout tip into the neck (its end inside the neck tube)
    const st = v.streamEnds()!;
    expect(st.from.distanceTo(tip)).toBeLessThan(0.03);
    expect(st.to.z).toBeGreaterThan(MOUTH.z);
    expect(st.to.z).toBeLessThan(MOUTH.z + FUEL_PORT.part.neckLen);
    expect(Math.hypot(st.to.x - MOUTH.x, st.to.y - MOUTH.y)).toBeLessThan(FUEL_PORT.part.neckR);
    expect(v.drops.some(d => d.visible)).toBe(true);
    // nothing used yet
    expect([s.g.playerTrain.fuel.tank, s.g.inv.count(FUEL.canItem)]).toEqual([0, 2]);
    s.step(FUEL_PORT.pourS - POUR_AT - 0.15);
    expect(view(s)).toMatchObject({phase: 'settle', visible: true, stream: false});
    expect([s.g.playerTrain.fuel.tank, s.g.inv.count(FUEL.canItem)]).toEqual([0, 2]);
    s.step(0.2);
    expect(s.sys.pour).toBeNull();
    expect(view(s)).toMatchObject({active: false, visible: false, stream: false, phase: null});
    expect(v.drops.every(d => !d.visible)).toBe(true);
    expect(s.sys.uncapped).toBe(false);
    expect([s.g.playerTrain.fuel.tank, s.g.inv.count(FUEL.canItem)]).toEqual([1, 1]);
  });

  it('a held can + left click: the held view hides while the world can pours (no duplicate) and comes back; the selection never changes', () => {
    const s = shell();
    const {vm, setCalls} = withViewmodel(s);
    s.give(2, 'hotbar', 1);
    s.g.inv.select(1);
    s.g.syncHeld();
    expect(vm.heldItem).toBe(FUEL.canItem);
    const held = s.sys.heldObj!;
    expect(held.visible).toBe(true);
    s.standAtCap();
    s.step();
    expect(s.g.pointerHandlers.some(h => h())).toBe(true);
    expect(held.visible).toBe(false);
    expect(s.sys.qa().heldHidden).toBe(true);
    // the world can starts where the held one is drawn: the viewmodel pose re-projected (same screen spot) in front of the eye
    const v = s.sys.pourView!, cam = s.g.camera;
    const centre = new THREE.Vector3(0, v.centerY, 0).applyQuaternion(v.can.quaternion).add(v.can.position); // train-local = world here
    const ndcWorld = centre.clone().project(cam);
    const vmCam = vm.camera, H = FUEL_PORT.held.hip;
    vmCam.updateMatrixWorld(true);
    const ndcHeld = new THREE.Vector3(...H).project(vmCam);
    expect(Math.abs(ndcWorld.x - ndcHeld.x)).toBeLessThan(0.02);
    expect(Math.abs(ndcWorld.y - ndcHeld.y)).toBeLessThan(0.02);
    s.step(POUR_AT);
    expect(held.visible).toBe(false);
    expect(s.g.inv.selected).toBe(1);
    expect(vm.heldItem).toBe(FUEL.canItem); // the selection / held item are untouched (only our object inside it is hidden)
    setCalls.length = 0;
    s.step(FUEL_PORT.pourS);
    expect([s.g.playerTrain.fuel.tank, s.g.inv.count(FUEL.canItem), s.g.inv.selected]).toEqual([1, 1, 1]);
    expect(held.visible).toBe(true);
    expect(setCalls).toEqual([null, FUEL.canItem]); // the next can rises into the hand (the equip raise), still the same slot
    // the last can: the hand's stack empties at completion -> empty hands, the same slot stays selected (no switch)
    expect(s.g.pointerHandlers.some(h => h())).toBe(true);
    s.step(FUEL_PORT.pourS + 0.1);
    expect([s.g.playerTrain.fuel.tank, s.g.inv.count(FUEL.canItem), s.g.inv.selected, vm.heldItem]).toEqual([2, 0, 1, null]);
    expect(held.visible).toBe(true);
    expect(view(s)?.visible).toBe(false);
  });

  it('every cancel removes the can + stream at once, puts the cap back and restores the held view: nothing used, selection unchanged', () => {
    const cases: [string, (s: ReturnType<typeof shell>) => void][] = [
      ['hit', s => { for (const f of s.g.hitListeners) f({amount: 12}); }],
      ['sprint', s => { s.g.player.sprinting = true; }],
      ['away', s => { s.standAtCap(2.4); }],
      ['away', s => { const c = s.g.camera.position; s.lookAt(c.x + 5, c.y, c.z); }],
      ['menu', s => { s.setState('paused'); }],
      ['menu', s => { s.setState('dead'); }],
      ['menu', s => { s.g.input.clears++; }],
      ['riding', s => { s.g.trainRide.riding = true; }],
      ['busy', s => { s.g.player.alive = false; }],
      ['teardown', s => { for (const h of s.g.sectionHooks) h.teardown?.(); }],
    ];
    for (const [why, act] of cases) {
      for (const phaseAt of [0.3, POUR_AT]) { // during the lift and while the stream runs
        const s = shell();
        withViewmodel(s);
        s.give(2, 'hotbar', 2);
        s.g.inv.select(2);
        s.g.syncHeld();
        s.standAtCap();
        s.step();
        expect(s.g.pointerHandlers.some(h => h()), why).toBe(true);
        s.step(phaseAt);
        expect(view(s)?.visible, why).toBe(true);
        expect(s.sys.qa().heldHidden, why).toBe(true);
        act(s);
        s.step(FUEL_PORT.awayGraceS + 0.1);
        const tag = `${why} @${phaseAt}`;
        expect(s.sys.pour, tag).toBeNull();
        expect(s.sys.lastCancel, tag).toBe(why);
        expect(view(s), tag).toMatchObject({active: false, visible: false, stream: false});
        expect(s.sys.pourView!.drops.every(d => !d.visible), tag).toBe(true);
        expect(s.sys.uncapped, tag).toBe(false);
        expect(s.sys.heldObj!.visible, tag).toBe(true);
        expect([s.g.playerTrain.fuel.tank, s.g.inv.count(FUEL.canItem), s.g.inv.selected], tag).toEqual([0, 2, 2]);
      }
    }
  });

  it('refused presses (full tank, no can, moving) show no pour at all; a can dropped mid-pour gets no fuel', () => {
    const s = shell();
    withViewmodel(s);
    s.give(1, 'hotbar', 0);
    s.g.inv.select(0);
    s.g.syncHeld();
    s.standAtCap();
    s.g.playerTrain.fuel.tank = FUEL.trainTankUnits;
    s.step();
    expect(s.press()).toBe(true);
    expect(s.g.pointerHandlers.some(h => h())).toBe(true);
    expect([view(s)?.visible ?? false, s.sys.qa().heldHidden, s.sys.uncapped]).toEqual([false, false, false]);
    s.g.playerTrain.fuel.tank = 0;
    s.g.trainRide.riding = true;
    s.press();
    expect([view(s)?.visible ?? false, s.sys.qa().heldHidden]).toEqual([false, false]);
    s.g.trainRide.riding = false;
    // the can leaves the inventory mid-pour (dropped / moved): the visual runs to its end, then nothing is poured
    expect(s.press()).toBe(true);
    s.step(POUR_AT);
    expect(s.g.inv.take(FUEL.canItem, 1)).toBe(1);
    s.g.syncHeld();
    s.step(FUEL_PORT.pourS);
    expect(s.sys.pour).toBeNull();
    expect(s.g.playerTrain.fuel.tank).toBe(0);
    expect(s.toasts.at(-1)!.text).toBe('No fuel can');
    expect([view(s)?.visible, s.sys.uncapped, s.sys.heldObj!.visible]).toEqual([false, false, true]);
    // no can at all: refused, nothing shown
    s.press();
    expect(view(s)?.visible).toBe(false);
    expect(s.toasts.at(-1)!.text).toBe('No fuel can');
  });

  it('the posed can never enters the car (skin / housing plate) and its spout ends at the neck — the current can AND the smaller medpack-size can', () => {
    const sizes: (null | {w: number; h: number; d: number})[] = [null, {w: 0.205, h: 0.3, d: 0.105}];
    for (const size of sizes) {
      if (size) {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(size.w, size.h, size.d).translate(0, size.h / 2, 0), new THREE.MeshStandardMaterial()));
        registerFuelCanModel({scene});
      } else registerFuelCanModel(null);
      registerItemModels({});
      try {
        for (const back of [0.45, 0.8, 1.3]) {
          const s = shell();
          s.give(1);
          s.standAtCap(back);
          s.step();
          expect(s.press()).toBe(true);
          const v = s.sys.pourView!, dims = size ?? itemDims(FUEL.canItem), b = v.bounds.getSize(new THREE.Vector3());
          [dims.w, dims.h, dims.d].forEach((d, k) => expect([b.x, b.y, b.z][k]).toBeCloseTo(d, 3)); // sizes come from the model (0.2015 m: no 3-digit rounding pin)
          const tag = `${size ? 'small' : 'current'} can, ${back} m out`;
          let maxZ = -Infinity, pourMaxZ = -Infinity, tipGap = Infinity, frames = 0;
          while (s.sys.pour) {
            for (const c of corners(s)) maxZ = Math.max(maxZ, c.z);
            if (v.phase === 'pour') {
              const tip = v.spoutTip(), zone = POUR_VIEW.spoutZone * Math.max(b.x, b.y, b.z);
              for (const c of corners(s)) if (c.distanceTo(tip) > zone) pourMaxZ = Math.max(pourMaxZ, c.z);
              tipGap = Math.min(tipGap, tip.distanceTo(mouthV));
            }
            s.step();
            frames++;
          }
          expect(frames, tag).toBeGreaterThan(130);
          expect(maxZ, tag).toBeLessThan(SKIN_Z); // the whole box, every frame: outside the car's skin
          expect(pourMaxZ, tag).toBeLessThan(PLATE_Z); // pouring: all but the spout's corner clear of the housing plate too
          expect(tipGap, tag).toBeLessThan(0.1); // the spout a few cm from the neck's mouth (the visible stream between them)
          expect(s.g.playerTrain.fuel.tank, tag).toBe(1);
        }
      } finally {
        registerFuelCanModel(null);
        registerItemModels({});
      }
    }
  });

  it('rendering hygiene: built once into the cap (warm pool), shared materials, no shadows / raycasts, the car level; reused across pours', () => {
    const s = shell();
    s.give(2);
    s.standAtCap();
    s.step();
    const roots = s.pools['fuel-port']();
    const v = s.sys.pourView!;
    expect(roots).toContain(s.sys.cap);
    let inCap = false;
    v.root.traverseAncestors(a => { if (a === s.sys.cap) inCap = true; });
    expect(inCap).toBe(true);
    expect(v.root.visible).toBe(false);
    const meshes: THREE.Mesh[] = [];
    v.root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const canMeshes: THREE.Mesh[] = [];
    v.can.traverse(o => { if ((o as THREE.Mesh).isMesh) canMeshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(canMeshes.length + 1 + POUR_VIEW.stream.drops); // the can's own meshes + the stream + its drops, nothing else
    const fx = [v.stream, ...v.drops];
    expect(new Set(fx.map(m => m.material)).size).toBe(1); // one shared stream material
    const fxMat = v.stream.material as THREE.MeshStandardMaterial;
    expect([fxMat.transparent, fxMat.side, fxMat.depthWrite]).toEqual([true, THREE.FrontSide, false]); // single-pass translucent
    expect(new Set(fx.map(m => m.geometry)).size).toBe(2); // one cylinder, one sphere
    // the can shares the item template's materials (no per-pour clone)
    const tmpl: THREE.Material[] = [];
    itemTemplate(FUEL.canItem).traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) tmpl.push(m.material as THREE.Material); });
    v.can.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) expect(tmpl).toContain(m.material); });
    const ray = new THREE.Raycaster(new THREE.Vector3(CAP.x, CAP.y, CAP.z - 1), new THREE.Vector3(0, 0, 1));
    for (const m of meshes) {
      expect(m.castShadow).toBe(false);
      expect(m.userData.level).toBe(0);
      const hits: THREE.Intersection[] = [];
      m.raycast(ray, hits);
      expect(hits).toEqual([]);
    }
    // two pours: the same objects, nothing added
    const before = s.sys.cap.children.length;
    for (let i = 0; i < 2; i++) { s.press(); s.step(FUEL_PORT.pourS + 0.05); }
    expect(s.g.playerTrain.fuel.tank).toBe(2);
    expect(s.sys.pourView).toBe(v);
    expect(s.sys.cap.children.length).toBe(before);
    expect(v.stream.material).toBe(fxMat);
  });

  it('the held can pose scales with the can: the same share of a 0.47 m and a 0.30 m can shows above the screen edge', () => {
    const shown = (h: number) => {
      const p = heldCanPose(h), half = Math.tan(THREE.MathUtils.degToRad(FUEL_PORT.viewmodelFov) / 2) * -p.hip[2];
      return (p.hip[1] + h / 2 + half) / h; // the part of the can above the viewmodel frustum's lower edge at its depth
    };
    expect(shown(0.3)).toBeCloseTo(shown(0.47), 6);
    expect(shown(0.3)).toBeGreaterThan(0.3);
    expect(shown(0.3)).toBeLessThan(0.6);
    expect(FUEL_PORT.held).toEqual(heldCanPose(itemDims(FUEL.canItem).h));
    heldCanPose(0.47).hip.forEach((x, i) => expect(Math.abs(x - [0.24, -0.43, -0.72][i])).toBeLessThan(0.03)); // ~ the pose first tuned for the 0.47 m can
  });

  it('the left button during / after a pour (Game.update order, pinned below): never fires a gun, never changes the choice', () => {
    // Game.update, in order: E, then the pointer handlers (a taken press is consumed and LATCHED until released), the latch release,
    // the lane input owners, the weapon (held / pressed only when neither owns the button), later the frame hooks (the pour's clock).
    const game = src('../src/game.ts');
    const at = (re: RegExp) => { const m = re.exec(game); expect(m, String(re)).not.toBeNull(); return m!.index; };
    const iPtr = at(/if \(inp\.mousePressed\[0\] && this\.pointerHandlers\.some\(h => h\(\)\)\) \{ inp\.mousePressed\[0\] = false; this\.lmbLatch = true; \}/);
    const iOwners = at(/const laneOwns = this\.inputOwners\.some\(f => f\(\)\);/);
    const iRelease = at(/if \(this\.lmbLatch && !inp\.mouse\[0\]\) this\.lmbLatch = false;/);
    const iOwns = at(/const flareOwns = this\.flareHold\.active \|\| this\.lmbLatch \|\| laneOwns;/);
    const iWeapon = at(/this\.weapon\.update\(dt, \{held: inp\.mouse\[0\] && !flareOwns && !rideHolster, pressed: inp\.mousePressed\[0\] && !flareOwns && !rideHolster/);
    const iHooks = at(/for \(const fn of this\.frameHooks\)/);
    expect(iPtr < iOwners && iOwners < iRelease && iRelease < iOwns && iOwns < iWeapon && iWeapon < iHooks).toBe(true);
    /** That order on the shell, with a real rifle controller; returns the shots fired. */
    const rig = (setup: (s: ReturnType<typeof shell>) => void) => {
      const s = shell();
      const weapon = new WeaponController();
      s.g.syncHeld = () => { s.calls.sync++; const st = s.g.inv.meleeSelected ? null : s.g.inv.selectedStack(); weapon.equip(st?.itemId === 'rifle' ? st : null); };
      setup(s);
      s.g.syncHeld();
      s.standAtCap();
      s.step();
      const inp = {mouse: false, pressed: false};
      let latch = false, shots = 0;
      const frame = () => {
        if (inp.pressed && s.g.pointerHandlers.some(h => h())) { inp.pressed = false; latch = true; }
        const laneOwns = s.g.inputOwners.some(f => f());
        if (latch && !inp.mouse) latch = false;
        const owns = latch || laneOwns;
        shots += weapon.update(DT, {held: inp.mouse && !owns, pressed: inp.pressed && !owns, reload: false, lowered: false}, s.g.inv).filter(e => e.type === 'fire').length;
        for (const f of s.g.frameHooks) f(DT);
        inp.pressed = false;
      };
      const run = (sec: number) => { for (let i = 0; i < Math.round(sec / DT); i++) frame(); };
      return {s, inp, run, shots: () => shots, weapon};
    };
    const rifleAnd = (cans: number, where: 'pack' | 'hotbar', select: number) => (s: ReturnType<typeof shell>) => {
      s.g.inv.set({bar: 'hotbar', index: 0}, s.g.inv.makeStack('rifle', 1));
      s.give(cans, where, where === 'hotbar' ? 1 : 0);
      s.g.inv.select(select);
    };
    // 1) E with the (automatic) rifle in the hand; the button pressed mid-pour and held past the end: taken by the pour, never fires
    const a = rig(rifleAnd(2, 'pack', 0));
    a.run(1); // the rifle is equipped (idle) by now
    expect(a.s.press()).toBe(true);
    a.run(0.5);
    a.inp.mouse = true; a.inp.pressed = true;
    a.run(FUEL_PORT.pourS);
    expect(a.s.g.playerTrain.fuel.tank).toBe(1);
    a.run(0.5);
    expect(a.shots()).toBe(0);
    a.inp.mouse = false; a.run(DT); a.inp.mouse = true; a.inp.pressed = true; a.run(0.05); // released + pressed again: the gun works
    expect(a.shots()).toBeGreaterThan(0);
    // 2) a held can + left click, the hand's last can: the stack empties at completion with the button still down -> empty hands,
    //    no shot, the same (now empty) slot stays selected — never a switch to the rifle
    const b = rig(rifleAnd(1, 'hotbar', 1));
    b.inp.mouse = true; b.inp.pressed = true;
    b.run(FUEL_PORT.pourS + 1);
    expect([b.s.g.playerTrain.fuel.tank, b.s.g.inv.count(FUEL.canItem), b.s.g.inv.selected, b.weapon.stack, b.shots()]).toEqual([1, 0, 1, null, 0]);
    // 3) a cancel (a hit) with the button held from a mid-pour press: still latched, no shot until released
    const c = rig(rifleAnd(2, 'pack', 0));
    c.run(1);
    c.s.press();
    c.run(0.4);
    c.inp.mouse = true; c.inp.pressed = true;
    c.run(0.3);
    for (const f of c.s.g.hitListeners) f({amount: 10});
    c.run(1);
    expect([c.s.sys.lastCancel, c.s.g.inv.count(FUEL.canItem), c.shots()]).toEqual(['hit', 2, 0]);
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
    for (const h of s.g.sectionHooks) h.teardown?.(); // the tunnel gap (no frame hooks run): the readout stays while riding
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
    // a parked teardown (travel / Retry) hides it
    s.g.player.z = -2.3;
    s.step();
    expect(s.hud()).not.toBeNull();
    for (const h of s.g.sectionHooks) h.teardown?.();
    expect(s.hud()).toBeNull();
  });

  describe('ui/hud.ts setFuel on the fake DOM', () => {
    let dom: FakeDom;
    beforeAll(() => { dom = installFakeDom(); });
    afterAll(() => dom.uninstall());
    it('a row at the top of the light panel: sixteen pips (four tanks of four), the text, amber when low; DOM written only on change', async () => {
      const {Hud} = await import('../src/ui/hud');
      const hud = new Hud();
      const panel = dom.el('#light-panel');
      hud.setFuel({pips: 3, tank: 3, text: 'Fuel ¾ tank · aboard +2 tanks (chest 1, carts 1)', low: false});
      const row = panel.children[0];
      expect(row.id).toBe('fuel-tag');
      expect(row.classList.contains('none')).toBe(false);
      expect(row.classList.contains('low')).toBe(false);
      expect((row.innerHTML.match(/<i class="on">/g) ?? []).length).toBe(3);
      // (task studio-general-armor-20261107-231448-01: two tanks; task gameplay-feedback-20261111 lane TRAVEL: four): 16 quarter pips, each
      // further tank's group set off by a gap
      expect((row.innerHTML.match(/<i class="(?:on)?(?: gap)?">/g) ?? []).length).toBe(16);
      expect((row.innerHTML.match(/<i class=" gap">/g) ?? []).length).toBe(3);
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
    expect(d).toMatchObject({w: 0.2015, d: 0.105, h: 0.30}); // task fuel-feedback: the med-kit sized can (assets/models/train-fuel-can.glb bounds)
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
