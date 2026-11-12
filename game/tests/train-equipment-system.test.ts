// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): the TRAIN EQUIPMENT as physical things (world/trainEquipment.ts) —
// movement, aim / E, plugs, bullets, lifts, crafting — with the REAL Player body, Levels, train runtime and ride (helpers/
// trainEquipmentHost.ts). Cargo / ownership: train-equipment-cargo.test.ts; persistence: train-equipment-save.test.ts; the carried
// chest: train-equipment-chest.test.ts.
//  - DOLLY PARITY: a device whose mass equals a fuel cart's behaves IDENTICALLY (the same controller, the same constants): grabbed and
//    steered, pushed, coasting to a stop — frame by frame; mass matters (the sentry is slower than the radar); a chest is shoved
//    slowly, stops at once and is never walked through; on a stair flight every kind lies on the steps and does not coast.
//  - GRAB: E on the frame grabs, E lets go, the player walking away / a hit / a menu let go, the drag slows the player and owns the
//    mouse; ONE thing grabbed at a time across fuel carts + equipment; units and fuel carts never overlap.
//  - AIM / E: 'module' (the console face) vs 'frame'; uses[kind] with / without `hold` (tap on the press / on the release, hold once),
//    a false answer grabs; the chest's tap / hold; the prompts.
//  - PLUGS: connect at rest by position (toast, cue, listener, lamp, cable), a free plug only, one unit per plug, unplug by a grab /
//    out of reach, a station unit never; plugged() / active().
//  - BULLETS stop on a unit and shove it by its mass; LIFTS carry units and see them in a doorway.
//  - CRAFT: the first free spot, a blocked spot skipped, refused while riding / without a train / at the limit; the unit empty,
//    unplugged, asleep; the uid counter only ever advances.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {trainToWorld, worldToTrain} from '../src/gen/playerTrain';
import {EQUIPMENT, EQUIPMENT_KINDS, EQUIPMENT_LIMITS, type EquipmentJSON} from '../src/craft/equipment';
import {EQUIP_HOLD_S, type EquipmentUnit} from '../src/craft/equipmentApi';
import {PLUG, craftSpots, equipmentPlugs} from '../src/craft/trainFixtures';
import {cartAboard} from '../src/fuel/trainPort';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {CART, bodyMass, bodyPushTop, cartMass, flightAt, type CartBody} from '../src/world/fuelCartPhysics';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {FUEL_CART} from '../src/world/fuelCarts';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {EQUIP, EQUIPMENT_TEXT} from '../src/world/trainEquipment';
import {equipmentBox, equipmentMaterials} from '../src/world/trainEquipmentModel';
import {combineModifiers} from '../src/player/modifiers';
import {DT, flatRoom, frame, lookAt, press, run} from './helpers/fuelCartsHost';
import {aboardRec, equipRoom, equipStation, holdE, loadAboard, lookAtUnit, plugSpot, putLocal, stand, stationRec, type EquipTestHost} from './helpers/trainEquipmentHost';

installCanvasShim(false);

const cache = new Map<string, StationLayout>();
const lay = (tag: string, make: () => StationLayout) => { let l = cache.get(tag); if (!l) cache.set(tag, (l = make())); return l; };
const SUBWAY = () => lay('subway', () => LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

function station(o: Parameters<typeof equipStation>[1] = {}) {
  const s = equipStation(SUBWAY(), o);
  live.push(s.rt);
  return s;
}

const HANDLE = {y: CART_LOOK.handle.y, z: CART_LOOK.handle.z};
const dollyKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].move === 'dolly');
const carryKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].move === 'carry');
const plugKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].plug);
/** The lightest and the heaviest dolly kind (whatever the table says). */
const byMass = [...dollyKinds].sort((a, b) => EQUIPMENT[a].kg - EQUIPMENT[b].kg);
const LIGHT = byMass[0], HEAVY = byMass[byMass.length - 1];

/** One body in the flat room at (3.5, 3) facing +Z: a fuel cart of `units`, or a device of `kind` (its mass optionally overridden). */
function cartWorld(units: number) {
  const s = equipRoom();
  s.carts.spawn({uid: 'c', units, x: 3.5, y: 0, z: 3, yaw: 0, level: 0});
  const ref = s.carts.bodies()[0];
  return {h: s.h, body: ref.body, wake: () => { ref.awake = true; }, grabbed: () => !!s.carts.grab};
}
function unitWorld(kind: (typeof EQUIPMENT_KINDS)[number], kg?: number) {
  const s = equipRoom(flatRoom(), null, {here: [stationRec(kind, 1, 3.5, 0, 3)]});
  const u = s.eq.unit('eq-1')!;
  if (kg !== undefined) u.body.kg = kg;
  return {h: s.h, eq: s.eq, carts: s.carts, u, body: u.body, wake: () => { u.awake = true; }, grabbed: () => !!s.eq.grab};
}

type Trace = number[][];
const snap = (h: EquipTestHost, b: CartBody): number[] => [b.x, b.z, b.yaw, b.vx, b.vz, h.player.x, h.player.z];

/** Grab the handle from behind, push it ahead, steer, pull it back, let go, let it coast. */
function grabScript(w: {h: EquipTestHost; body: CartBody; grabbed(): boolean}): Trace {
  const {h, body: b} = w, out: Trace = [];
  stand(h, 3.5, 1.8, Math.PI, 0);
  frame(h);
  lookAt(h, b.x + Math.sin(b.yaw) * HANDLE.z, b.y + HANDLE.y, b.z + Math.cos(b.yaw) * HANDLE.z);
  press(h, 'KeyE');
  expect(w.grabbed()).toBe(true);
  h.player.pitch = 0;
  const go = (key: string, seconds: number) => { h.keys.held.add(key); run(h, seconds, () => { out.push(snap(h, b)); return false; }); h.keys.held.clear(); };
  go('KeyW', 1.2);
  h.player.yaw += 0.9;
  go('KeyW', 0.8);
  go('KeyS', 0.8);
  press(h, 'KeyE');
  expect(w.grabbed()).toBe(false);
  run(h, 1.5, () => { out.push(snap(h, b)); return false; });
  return out;
}

/** Walk into it from behind for two seconds, stop, let it coast. */
function pushScript(w: {h: EquipTestHost; body: CartBody}): Trace {
  const {h, body: b} = w, out: Trace = [];
  stand(h, 3.5, 1.5, Math.PI, 0);
  h.keys.held.add('KeyW');
  run(h, 2, () => { out.push(snap(h, b)); return false; });
  h.keys.held.clear();
  run(h, 2, () => { out.push(snap(h, b)); return false; });
  return out;
}

/** Shoved at 2 m/s along +x: where it comes to rest. */
function coastScript(w: {h: EquipTestHost; body: CartBody; wake(): void}): Trace {
  const {h, body: b} = w, out: Trace = [];
  stand(h, 1.5, 5.5, 0, 0);
  b.vx = 2;
  w.wake();
  run(h, 3, () => { out.push(snap(h, b)); return false; });
  return out;
}

function sameTrace(a: Trace, b: Trace): void {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) for (let k = 0; k < a[i].length; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]));
  expect(worst).toBeLessThan(1e-9);
}

describe('train equipment: a device moves and stops like the fuel dolly', () => {
  it('reads the fuel dolly\'s constants (never its own copies) and the dolly kinds stand on the dolly\'s footprint', () => {
    expect([EQUIP.grabReach, EQUIP.useReach, EQUIP.hold, EQUIP.farDist, EQUIP.speedMult, EQUIP.activeRange, EQUIP.bulletImpulse, EQUIP.bulletMaxDv])
      .toEqual([FUEL_CART.grabReach, FUEL_CART.drumReach, FUEL_CART.hold, FUEL_CART.farDist, FUEL_CART.speedMult, FUEL_CART.activeRange, FUEL_CART.bulletImpulse, FUEL_CART.bulletMaxDv]);
    expect(dollyKinds.length).toBeGreaterThan(0);
    expect(carryKinds.length).toBeGreaterThan(0);
    for (const k of dollyKinds) {
      expect(EQUIPMENT[k].radius).toBe(CART.radius);
      expect(EQUIPMENT[k].height).toBe(CART.height);
      // the module stands inside the footprint circle, on the nose plate
      const B = equipmentBox(EQUIPMENT[k]).body;
      expect(B.y0).toBe(CART_LOOK.plateTop);
      expect(Math.hypot(B.hw, Math.abs(B.z) + B.hd)).toBeLessThan(CART.radius + 0.12);
    }
  });

  for (const units of [0, 3, 8]) {
    it(`same mass as a fuel cart with ${units} units: grabbed + steered, pushed and coasting it is the same motion frame by frame`, () => {
      const kg = cartMass(units);
      const c = unitWorld(LIGHT, kg);
      expect(bodyMass(c.body)).toBeCloseTo(kg, 12);
      expect(bodyPushTop(c.body)).toBeCloseTo(bodyPushTop(cartWorld(units).body), 12);
      const g1 = grabScript(cartWorld(units)), g2 = grabScript(unitWorld(LIGHT, kg));
      sameTrace(g1, g2);
      // (it really moved: pushed ahead, turned, pulled back)
      expect(Math.max(...g1.map(s => s[1])) - 3).toBeGreaterThan(0.8);
      expect(Math.max(...g1.map(s => Math.abs(s[0] - 3.5)))).toBeGreaterThan(0.2);
      const p1 = pushScript(cartWorld(units)), p2 = pushScript(unitWorld(LIGHT, kg));
      sameTrace(p1, p2);
      expect(p1[p1.length - 1][1] - 3).toBeGreaterThan(0.5);
      const k1 = coastScript(cartWorld(units)), k2 = coastScript(unitWorld(LIGHT, kg));
      sameTrace(k1, k2);
      const dist = k1[k1.length - 1][0] - 3.5;
      expect(dist).toBeGreaterThan(1.5);
      expect(dist).toBeLessThan(1.8); // v² / (2 · CART.rollDecel) = 1.67 m
      expect(Math.hypot(k1[k1.length - 1][3], k1[k1.length - 1][4])).toBe(0);
    });
  }

  it('mass matters: the heaviest device is pushed slower, follows the hand later and takes a smaller shove than the lightest', () => {
    expect(EQUIPMENT[HEAVY].kg).toBeGreaterThan(EQUIPMENT[LIGHT].kg);
    const a = unitWorld(LIGHT), b = unitWorld(HEAVY);
    expect(bodyMass(a.body)).toBe(EQUIPMENT[LIGHT].kg);
    expect(bodyMass(b.body)).toBe(EQUIPMENT[HEAVY].kg);
    expect(bodyPushTop(b.body)).toBeLessThan(bodyPushTop(a.body));
    const pa = pushScript(a), pb = pushScript(b);
    expect(pb[80][1]).toBeLessThan(pa[80][1] - 0.1); // (after 1.3 s of walking into it: well short of the far wall)
    expect(pa[80][1]).toBeLessThan(5.9);
    const top = (t: Trace) => Math.max(...t.map(s => Math.hypot(s[3], s[4])));
    expect(top(pa)).toBeCloseTo(bodyPushTop(a.body), 2);
    expect(top(pb)).toBeCloseTo(bodyPushTop(b.body), 2);
    // grabbed: the grip's acceleration is capped by force / mass — the heavy one is behind after the first moments
    const ga = grabScript(unitWorld(LIGHT)), gb = grabScript(unitWorld(HEAVY));
    expect(gb[12][1]).toBeLessThan(ga[12][1] - 1e-4);
  });

  it('a chest on the floor is shoved slowly, stops at once and is never walked through', () => {
    for (const kind of carryKinds) {
      const {h, u, body: b} = unitWorld(kind);
      const def = EQUIPMENT[kind];
      expect(b.decel).toBe(EQUIP.slideDecel);
      stand(h, 3.5, 1.5, Math.PI, 0);
      h.keys.held.add('KeyW');
      let top = 0, gap = Infinity;
      run(h, 2.5, () => { top = Math.max(top, Math.hypot(b.vx, b.vz)); gap = Math.min(gap, Math.hypot(h.player.x - b.x, h.player.z - b.z)); return false; });
      expect(top).toBeGreaterThan(0.3);
      expect(top).toBeLessThanOrEqual(EQUIP.slideMax + 1e-9);
      expect(b.z - 3).toBeGreaterThan(0.4);
      expect(b.z - 3).toBeLessThan(EQUIP.slideMax * 2.5 + 1e-6);
      expect(gap).toBeGreaterThanOrEqual(h.player.radius + def.radius - 1e-6); // never inside it
      // far slower than a dolly of the same mass would be pushed
      expect(EQUIP.slideMax).toBeLessThan(bodyPushTop(b) / 2);
      h.keys.held.clear();
      h.player.vx = h.player.vz = 0; // (the player stops dead: nothing pushes it any more)
      const z0 = b.z;
      run(h, 0.15);
      expect(Math.hypot(b.vx, b.vz)).toBe(0);
      expect(b.z - z0).toBeLessThan(0.04);
      expect(u.awake).toBe(false);
      // thrown (a bullet's shove): it stops within centimetres, a dolly rolls on
      b.vx = 1.2; u.awake = true;
      const x0 = b.x;
      run(h, 1);
      expect(b.x - x0).toBeLessThan(0.12);
    }
  });

  it('on a stair flight every kind lies on the steps (the rest pose) and does not coast', () => {
    const L = SUBWAY();
    const f = L.traversal.stairs[0];
    const mid = {x: (f.top.x + f.bottom.x) / 2, y: (f.top.y + f.bottom.y) / 2, z: (f.top.z + f.bottom.z) / 2};
    const recs: EquipmentJSON[] = EQUIPMENT_KINDS.map((k, i) => stationRec(k, i + 1, mid.x, mid.y, mid.z, 0, 0));
    for (const rec of recs) {
      const {h, eq} = station({here: [rec]});
      const u = eq.unit(rec.uid)!;
      expect(flightAt(h.levels!, u.body.x, u.body.z, u.body.y)).not.toBeNull();
      expect(Math.abs(u.pose.pitch) + Math.abs(u.pose.roll)).toBeGreaterThan(0.2); // lying on the step edges
      expect(u.pose.dy).toBeGreaterThan(0.01);
      // (the player stays in the car, far away: an awake unit is stepped at any distance)
      expect(Math.hypot(h.player.x - mid.x, h.player.z - mid.z)).toBeGreaterThan(EQUIP.activeRange);
      const dir = new THREE.Vector3(f.bottom.x - f.top.x, 0, f.bottom.z - f.top.z).normalize();
      u.body.vx = dir.x * 1.4; u.body.vz = dir.z * 1.4; u.awake = true;
      const x0 = u.body.x, z0 = u.body.z;
      run(h, 1);
      expect(Math.hypot(u.body.x - x0, u.body.z - z0)).toBeLessThan(0.08);
      expect(u.awake).toBe(false);
    }
  });
});

describe('train equipment: grab, let go, one thing in the hands', () => {
  it('E on the frame grabs (slow walk, the mouse is the grab\'s), E lets go; walking away / a hit / a menu let go', () => {
    const {h, eq, u, body: b} = unitWorld(LIGHT);
    const the = EQUIPMENT[LIGHT].the;
    stand(h, 3.5, 1.8, Math.PI, 0);
    frame(h);
    lookAtUnit(h, u, 0, HANDLE.y, HANDLE.z);
    frame(h);
    expect(eq.aim).toMatchObject({unit: u, part: 'frame'});
    expect(eq.prompt).toBe(EQUIPMENT_TEXT.grab(the, EQUIPMENT[LIGHT].plug ? EQUIPMENT_TEXT.plugHint : ''));
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(eq.prompt);
    press(h, 'KeyE');
    expect(eq.grab?.unit).toBe(u);
    expect(h.inputOwners.some(f => f())).toBe(true);
    expect(combineModifiers(h.modifierSources as never).speedMult).toBeCloseTo(FUEL_CART.speedMult, 12);
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(EQUIPMENT_TEXT.letGo(the));
    press(h, 'KeyE');
    expect(eq.grab).toBeNull();
    expect(h.inputOwners.some(f => f())).toBe(false);
    expect(combineModifiers(h.modifierSources as never).speedMult).toBe(1);
    const grab = () => { stand(h, b.x, b.z - 1.2, Math.PI, 0); frame(h); lookAtUnit(h, u, 0, HANDLE.y, HANDLE.z); press(h, 'KeyE'); expect(eq.grab?.unit).toBe(u); };
    // the player gone too far: "stuck", with the note
    b.yaw = 0;
    grab();
    stand(h, b.x, b.z + FUEL_CART.farDist + 1, 0, 0);
    frame(h);
    expect(eq.grab).toBeNull();
    expect(h.toasts).toContain(EQUIPMENT_TEXT.stuck(the));
    // a hit
    run(h, 1.5);
    b.yaw = 0;
    grab();
    for (const f of h.hitListeners) f({} as never);
    expect(eq.grab).toBeNull();
    // a menu
    grab();
    h.state = 'paused';
    for (const f of h.stateListeners) f('paused' as never, 'playing' as never);
    expect(eq.grab).toBeNull();
    expect(eq.prompt).toBeNull();
    h.state = 'playing';
    // death
    grab();
    h.player.alive = false;
    frame(h);
    expect(eq.grab).toBeNull();
    expect(eq.counts.grabs).toBe(5);
    expect(eq.counts.letGo).toBe(5);
  });

  it('one thing grabbed at a time across fuel carts and equipment; units and fuel carts never overlap', () => {
    const s = equipRoom(flatRoom(), null, {here: [stationRec(LIGHT, 1, 3.5, 0, 3), stationRec(HEAVY, 2, 3.5, 0, 4.2)]});
    const {h, eq, carts} = s;
    carts.spawn({uid: 'c', units: 4, x: 5, y: 0, z: 3, yaw: 0, level: 0});
    const u = eq.unit('eq-1')!, v = eq.unit('eq-2')!, cb = carts.bodyOf('c')!;
    const never = () => { expect(!!eq.grab && !!carts.grab).toBe(false); };
    stand(h, 3.5, 1.8, Math.PI, 0);
    frame(h);
    lookAtUnit(h, u, 0, HANDLE.y, HANDLE.z);
    press(h, 'KeyE');
    expect(eq.grab?.unit).toBe(u);
    // E while a unit is grabbed is the unit's — even aiming at the fuel cart's handle: it lets go, the cart is not grabbed
    lookAt(h, cb.x, cb.y + HANDLE.y, cb.z + HANDLE.z);
    press(h, 'KeyE');
    expect(eq.grab).toBeNull();
    expect(carts.grab).toBeNull();
    never();
    // now the cart; E aimed at the unit lets go of the cart, the unit is not grabbed
    stand(h, 5, 1.8, Math.PI, 0);
    frame(h);
    lookAt(h, cb.x, cb.y + HANDLE.y, cb.z + HANDLE.z);
    press(h, 'KeyE');
    expect(carts.grab).not.toBeNull();
    lookAtUnit(h, u, 0, HANDLE.y, HANDLE.z);
    press(h, 'KeyE');
    expect(carts.grab).toBeNull();
    expect(eq.grab).toBeNull();
    never();
    // drag the unit into the other unit and into the cart: footprints stay apart (the other bodies are shoved)
    stand(h, 3.5, 1.8, Math.PI, 0);
    frame(h);
    lookAtUnit(h, u, 0, HANDLE.y, HANDLE.z);
    press(h, 'KeyE');
    expect(eq.grab?.unit).toBe(u);
    h.player.pitch = 0;
    h.keys.held.add('KeyW');
    let minUnits = Infinity, minCart = Infinity;
    const gaps = () => {
      never();
      minUnits = Math.min(minUnits, Math.hypot(u.body.x - v.body.x, u.body.z - v.body.z));
      minCart = Math.min(minCart, Math.hypot(u.body.x - cb.x, u.body.z - cb.z), Math.hypot(v.body.x - cb.x, v.body.z - cb.z));
      return false;
    };
    run(h, 1.5, gaps);
    h.player.yaw = -Math.PI / 2; // toward +x: the fuel cart
    run(h, 2.5, gaps);
    h.keys.held.clear();
    press(h, 'KeyE');
    run(h, 2, gaps);
    expect(v.body.z).toBeGreaterThan(4.25); // the second unit was shoved along
    expect(minUnits).toBeGreaterThan(2 * CART.radius - 0.02);
    expect(minCart).toBeGreaterThan(2 * CART.radius - 0.02);
    expect(Math.hypot(u.body.x - v.body.x, u.body.z - v.body.z)).toBeGreaterThanOrEqual(2 * CART.radius - 1e-6);
    expect(Math.hypot(u.body.x - cb.x, u.body.z - cb.z)).toBeGreaterThanOrEqual(2 * CART.radius - 1e-6);
    // the player never ends inside a unit
    for (const b of [u.body, v.body]) expect(Math.hypot(h.player.x - b.x, h.player.z - b.z)).toBeGreaterThanOrEqual(h.player.radius + CART.radius - 1e-6);
  });

  it('units at rest far from the player cost nothing: no controller step, no pose solve, no cable rewrite', () => {
    const {h, eq} = unitWorld(LIGHT);
    stand(h, 9.5, 5.5, 0, -1.15);
    run(h, 0.5);
    const c0 = {...eq.counts};
    run(h, 2);
    expect(eq.counts.steps).toBe(c0.steps);
    expect(eq.counts.poses).toBe(c0.poses);
    expect(eq.counts.cables).toBe(c0.cables);
  });
});

describe('train equipment: aim parts and the E rules', () => {
  /** A device at (3.5, 3) facing +Z; the player in front of its console face or behind its handle. */
  function world(kind = LIGHT) {
    const w = unitWorld(kind);
    const front = () => { stand(w.h, 3.5, 4.35, 0, 0); frame(w.h); const B = equipmentBox(w.u.def); lookAtUnit(w.h, w.u, 0, (B.face!.y0 + B.face!.y1) / 2, B.body.z + B.body.hd); frame(w.h); };
    const back = () => { stand(w.h, 3.5, 1.8, Math.PI, 0); frame(w.h); lookAtUnit(w.h, w.u, 0, HANDLE.y, HANDLE.z); frame(w.h); };
    const reset = () => { if (w.eq.grab) press(w.h, 'KeyE'); w.body.x = 3.5; w.body.z = 3; w.body.yaw = 0; w.body.vx = w.body.vz = 0; };
    return {...w, front, back, reset};
  }

  it('from the front the console face is the module, from behind the handle is the frame; the rest of the module is the frame too', () => {
    const w = world();
    w.front();
    expect(w.eq.pickAim()).toMatchObject({unit: w.u, part: 'module'});
    w.back();
    expect(w.eq.pickAim()).toMatchObject({unit: w.u, part: 'frame'});
    // the module's top, above the face band, seen from the front: still the unit, but the frame (grab)
    stand(w.h, 3.5, 4.35, 0, 0);
    const B = equipmentBox(w.u.def);
    lookAtUnit(w.h, w.u, 0, B.body.y1 - 0.01, B.body.z + B.body.hd);
    if (B.body.y1 - 0.01 > B.face!.y1 + 0.03) expect(w.eq.pickAim()).toMatchObject({unit: w.u, part: 'frame'});
    // out of reach / looking away: nothing
    stand(w.h, 3.5, 5.9, 0, 0);
    lookAtUnit(w.h, w.u, 0, 0.5, B.body.z + B.body.hd);
    expect(w.eq.pickAim()).toBeNull();
    stand(w.h, 3.5, 4.35, Math.PI, 0);
    w.h.player.pitch = 0;
    frame(w.h);
    expect(w.eq.pickAim()).toBeNull();
    expect(w.eq.prompt).toBeNull();
  });

  it('no use registered: E on the module grabs; a use without hold fires tap on the press (false -> grab); its prompt wins on the module only', () => {
    const w = world();
    w.front();
    press(w.h, 'KeyE');
    expect(w.eq.grab?.unit).toBe(w.u);
    w.reset();
    const calls: string[] = [];
    let answer = true;
    w.eq.uses[w.u.kind] = {prompt: u => `<b>[E]</b> Use ${u.uid}`, tap: u => { calls.push(`tap:${u.uid}`); return answer; }};
    w.front();
    expect(w.eq.prompt).toBe('<b>[E]</b> Use eq-1');
    w.h.keys.held.add('KeyE'); // (held down: without `hold` the tap still fires on the press)
    press(w.h, 'KeyE');
    w.h.keys.held.clear();
    expect(calls).toEqual(['tap:eq-1']);
    expect(w.eq.grab).toBeNull();
    expect(w.eq.holdProgress).toBeNull();
    // the frame keeps its grab prompt and action
    w.back();
    expect(w.eq.prompt).toBe(EQUIPMENT_TEXT.grab(w.u.def.the, w.u.def.plug ? EQUIPMENT_TEXT.plugHint : ''));
    press(w.h, 'KeyE');
    expect(w.eq.grab?.unit).toBe(w.u);
    expect(calls).toEqual(['tap:eq-1']);
    w.reset();
    // a false answer: the default action
    answer = false;
    w.front();
    press(w.h, 'KeyE');
    expect(calls).toEqual(['tap:eq-1', 'tap:eq-1']);
    expect(w.eq.grab?.unit).toBe(w.u);
    w.reset();
    // a null prompt: the default text; a throwing use never breaks E
    w.eq.uses[w.u.kind] = {prompt: () => null, tap: () => { throw new Error('boom'); }};
    w.front();
    expect(w.eq.prompt).toBe(EQUIPMENT_TEXT.grab(w.u.def.the, w.u.def.plug ? EQUIPMENT_TEXT.plugHint : ''));
    press(w.h, 'KeyE');
    expect(w.eq.grab?.unit).toBe(w.u);
  });

  it('a use with hold: a tap acts on the release, holding EQUIP_HOLD_S calls hold once; a false answer grabs; leaving the aim cancels', () => {
    const w = world();
    const calls: string[] = [];
    const ans = {tap: true, hold: true};
    w.eq.uses[w.u.kind] = {prompt: () => null, tap: () => { calls.push('tap'); return ans.tap; }, hold: () => { calls.push('hold'); return ans.hold; }};
    // a tap: nothing on the press, tap on the release
    w.front();
    w.h.keys.held.add('KeyE');
    w.h.keys.hits.add('KeyE');
    frame(w.h);
    expect(calls).toEqual([]);
    expect(w.eq.holdProgress).toBeGreaterThan(0);
    expect(w.h.inputOwners.some(f => f())).toBe(true);
    run(w.h, 0.2);
    expect(calls).toEqual([]);
    w.h.keys.held.clear();
    frame(w.h);
    expect(calls).toEqual(['tap']);
    expect(w.eq.holdProgress).toBeNull();
    expect(w.eq.grab).toBeNull();
    // a hold: hold once, no tap; the ring ran and was cleared
    w.h.rings.length = 0;
    holdE(w.h, EQUIP_HOLD_S + 0.2);
    expect(calls).toEqual(['tap', 'hold']);
    expect(w.eq.grab).toBeNull();
    expect(w.h.rings.some(v => v !== null && v > 0.3)).toBe(true);
    expect(w.h.rings[w.h.rings.length - 1]).toBeNull();
    // false answers: the grab
    ans.tap = false;
    press(w.h, 'KeyE');
    expect(calls).toEqual(['tap', 'hold', 'tap']);
    expect(w.eq.grab?.unit).toBe(w.u);
    w.reset();
    ans.hold = false;
    w.front();
    holdE(w.h, EQUIP_HOLD_S + 0.1);
    expect(calls).toEqual(['tap', 'hold', 'tap', 'hold']);
    expect(w.eq.grab?.unit).toBe(w.u);
    w.reset();
    // the aim leaves during the hold: nothing happens
    w.front();
    w.h.keys.held.add('KeyE');
    w.h.keys.hits.add('KeyE');
    frame(w.h);
    w.h.player.yaw += 1.5;
    run(w.h, EQUIP_HOLD_S + 0.2);
    w.h.keys.held.clear();
    frame(w.h);
    expect(calls).toEqual(['tap', 'hold', 'tap', 'hold']);
    expect(w.eq.grab).toBeNull();
    expect(w.eq.holdProgress).toBeNull();
  });
});

describe('train equipment: the plugs', () => {
  const lampOn = (eq: {fixtures: {lamps: THREE.Mesh[]}}, i: number) => eq.fixtures.lamps[i].material === equipmentMaterials().lampOn;

  it('a device at rest in the parked car within reach of a free plug connects: toast, cue, listener, lamp, cable; plugged() / active()', () => {
    const {h, eq, rt} = station();
    const kind = plugKinds[0], def = EQUIPMENT[kind];
    loadAboard(h, [aboardRec(kind, 1, -3, -0.5)]); // out of every plug's reach
    const events: [string, boolean][] = [];
    eq.plugListeners.push((u: EquipmentUnit, on: boolean) => { events.push([u.uid, on]); });
    run(h, 0.3);
    const u = eq.unit('eq-1')!;
    expect(u.plug).toBeNull();
    expect(eq.plugged(kind)).toBeNull();
    expect(eq.active(kind)).toBeNull();
    expect(eq.fixtures.group.parent).toBe(rt.view!.root); // the sockets hang in the car
    expect(eq.fixtures.lamps).toHaveLength(EQUIPMENT_LIMITS.plugs);
    expect(lampOn(eq, 0)).toBe(false);
    expect(eq.fixtures.cables[0].mesh.visible).toBe(false);
    const s = plugSpot(0);
    putLocal(h, u, s.x, s.z);
    h.toasts.length = 0; h.sfxCalls.length = 0;
    frame(h);
    expect(u.plug).toBe(0);
    expect(events).toEqual([['eq-1', true]]);
    expect(h.toasts).toEqual([EQUIPMENT_TEXT.pluggedIn(def.name)]);
    expect(h.sfxCalls).toContain('hose:true');
    expect(lampOn(eq, 0)).toBe(true);
    expect(eq.plugged(kind)).toBe(u);
    expect(eq.active(kind)).toBe(u);
    // the cable: a pooled tube from the device to the socket, in the car's frame, sagging but never under the floor
    const cable = eq.fixtures.cables[0];
    expect(cable.mesh.visible).toBe(true);
    expect(cable.mesh.parent).toBe(eq.fixtures.group);
    const geo = cable.geometry, updates = cable.updates;
    expect(cable.lowestY()).toBeGreaterThan(SPEC.floorY);
    expect(cable.lowestY()).toBeLessThan(SPEC.floorY + PLUG.socketY);
    run(h, 1);
    expect(cable.updates).toBe(updates); // at rest: never rewritten
    expect(cable.geometry).toBe(geo);
    expect(eq.prompt === null || typeof eq.prompt === 'string').toBe(true);
    expect(events).toHaveLength(1);
  });

  it('a free plug only, one unit per plug; a grab unplugs (the waiting device takes the plug); out of reach the cable pulls free', () => {
    const {h, eq} = station();
    const kindA = plugKinds[0], kindB = plugKinds[plugKinds.length - 1];
    const s = plugSpot(0);
    loadAboard(h, [aboardRec(kindA, 1, s.x, s.z), aboardRec(kindB, 2, s.x + 0.75, 0.6)]);
    const events: [string, boolean][] = [];
    eq.plugListeners.push((u: EquipmentUnit, on: boolean) => { events.push([u.uid, on]); });
    run(h, 0.3);
    const a = eq.unit('eq-1')!, b = eq.unit('eq-2')!;
    // both stand within reach of plug 0 and of no other: the nearer one has it
    const e0 = equipmentPlugs(SPEC)[0];
    const la = worldToTrain(h.trainPlacement!, a.body.x, a.body.y, a.body.z), lb = worldToTrain(h.trainPlacement!, b.body.x, b.body.y, b.body.z);
    expect(Math.hypot(lb.x - e0.x, lb.z - e0.z)).toBeLessThan(PLUG.reach);
    expect(Math.hypot(la.x - e0.x, la.z - e0.z)).toBeLessThan(Math.hypot(lb.x - e0.x, lb.z - e0.z));
    expect([a.plug, b.plug]).toEqual([0, null]);
    expect(h.toasts).toEqual([]); // (records finding their plugs again: silently)
    expect(events).toEqual([['eq-1', true]]);
    expect(eq.plugged(kindA)).toBe(a);
    // grab the plugged one: unplugged with a note; the waiting device connects to the freed plug
    const P = trainToWorld(h.trainPlacement!, s.x, SPEC.floorY, s.z - 1.25);
    a.body.yaw = Math.atan2(a.body.x - P.x, a.body.z - P.z);
    stand(h, P.x, P.z, 0, h.trainPlacement!.floorY);
    frame(h);
    lookAtUnit(h, a, 0, HANDLE.y, HANDLE.z);
    h.toasts.length = 0;
    press(h, 'KeyE');
    expect(eq.grab?.unit).toBe(a);
    expect(a.plug).toBeNull();
    expect(h.toasts[0]).toBe(EQUIPMENT_TEXT.unplugged(EQUIPMENT[kindA].name));
    frame(h);
    expect(b.plug).toBe(0);
    expect(h.toasts).toContain(EQUIPMENT_TEXT.pluggedIn(EQUIPMENT[kindB].name));
    expect(events).toEqual([['eq-1', true], ['eq-1', false], ['eq-2', true]]);
    expect(eq.plugged(kindB)).toBe(b);
    // let go beside the taken plug: it stays unplugged (never two on one plug)
    press(h, 'KeyE');
    run(h, 1.5);
    expect(a.plug).toBeNull();
    expect(b.plug).toBe(0);
    expect(new Set(eq.units().map(u => u.plug).filter(p => p !== null)).size).toBe(1);
    // a shove out of reach: the cable pulls free
    h.toasts.length = 0;
    const p = h.trainPlacement!;
    for (let i = 0; i < 40 && b.plug !== null; i++) {
      b.body.vx = p.front * 1.4; b.body.vz = 0; b.awake = true; // (along the car, away from the socket)
      run(h, 0.25);
    }
    expect(b.plug).toBeNull();
    expect(h.toasts).toContain(EQUIPMENT_TEXT.pulled(EQUIPMENT[kindB].name));
    // ... and the first device, still at rest beside the socket, takes the freed plug in its turn
    run(h, 0.2);
    expect(events.slice(-2)).toEqual([['eq-2', false], ['eq-1', true]]);
    expect([a.plug, b.plug]).toEqual([0, null]);
    expect(eq.plugged(kindA)).toBe(a);
    expect(eq.fixtures.cables[0].mesh.visible).toBe(true);
    expect(eq.counts.plugged).toBe(3);
    expect(eq.counts.unplugged).toBe(2);
  });

  it('a station unit is never plugged; a unit leaving the car loses its plug; every plug kind can use every plug', () => {
    const {h, eq} = station();
    const p = h.trainPlacement!;
    const plugs = equipmentPlugs(SPEC);
    expect(plugs).toHaveLength(EQUIPMENT_LIMITS.plugs);
    // one device of a plug kind per plug (cycling the kinds), all at rest in reach: each takes its own plug
    const recs = plugs.map((e, i) => { const s = plugSpot(e.index); return aboardRec(plugKinds[i % plugKinds.length], i + 1, s.x, s.z); });
    loadAboard(h, recs);
    run(h, 0.3);
    expect(eq.units().map(u => u.plug)).toEqual(plugs.map(e => e.index));
    for (const k of new Set(recs.map(r => r.kind))) {
      const first = eq.units().find(u => u.kind === k)!;
      expect(eq.plugged(k)).toBe(first); // the lowest plug's unit of that kind
      expect(eq.active(k)).toBe(first);
    }
    // carried out onto the platform (a test's hand): unplugged, the station's
    const u = eq.unit('eq-1')!;
    const out = trainToWorld(p, 0.182, SPEC.floorY, -2.8);
    u.body.x = out.x; u.body.z = out.z; u.body.y = h.levels!.floorAt(out.x, out.z, p.floorY + 0.3); u.awake = true;
    run(h, 0.3);
    expect(u.plug).toBeNull();
    expect(eq.all().find(r => r.uid === 'eq-1')!.owner).toBe('station');
    run(h, 1);
    expect(u.plug).toBeNull();
    // a carry kind never plugs, wherever it stands
    for (const k of carryKinds) expect(EQUIPMENT[k].plug).toBe(false);
  });
});

describe('train equipment: bullets and lifts', () => {
  it('a shot stops on a unit (a metal impact) and shoves it by its mass; a miss passes', () => {
    const impacts: string[] = [];
    const dvs: Record<string, number> = {};
    for (const kind of EQUIPMENT_KINDS) {
      const {h, eq, u, body: b} = unitWorld(kind);
      (h as unknown as {fx: unknown}).fx = {impact: (_p: THREE.Vector3, _n: THREE.Vector3, s: string) => { impacts.push(s); }};
      stand(h, 1.2, 5.5, 0, 0);
      const B = equipmentBox(u.def).body;
      const y = b.y + (B.y0 + B.y1) / 2, dir = new THREE.Vector3(1, 0, 0);
      // a ray along +x through the body, reaching the far wall at t = 9: stopped on the unit
      const from = new THREE.Vector3(1.5, y, 3 + B.z), wall = from.clone().addScaledVector(dir, 9);
      expect(eq.bulletHit({t: 9}, wall, dir, 20)).toBe(true);
      expect(b.vx).toBeCloseTo(Math.min(FUEL_CART.bulletMaxDv, (20 * FUEL_CART.bulletImpulse) / EQUIPMENT[kind].kg), 9);
      expect(b.vz).toBe(0);
      expect(u.awake).toBe(true);
      dvs[kind] = b.vx;
      // a ray that ends before it / passes beside it / over it: not this system's
      expect(eq.bulletHit({t: 1}, from.clone().addScaledVector(dir, 1), dir, 20)).toBe(false);
      expect(eq.bulletHit({t: 9}, new THREE.Vector3(10.5, y, 5), dir, 20)).toBe(false);
      expect(eq.bulletHit({t: 9}, new THREE.Vector3(10.5, b.y + 2.2, 3), dir, 20)).toBe(false);
      expect(eq.counts.bullets).toBe(1);
      expect(h.sfxCalls).toContain('impact:metal');
      run(h, 3);
      expect(b.x).toBeGreaterThan(3.5);
    }
    expect(impacts).toHaveLength(EQUIPMENT_KINDS.length);
    expect(impacts.every(s => s === 'metal')).toBe(true);
    expect(dvs[HEAVY]).toBeLessThan(dvs[LIGHT]);
  });

  it('a lift carries the units standing in it (height + storey) and sees a unit in its doorway by its own radius', () => {
    const s = equipRoom(flatRoom(), null, {here: EQUIPMENT_KINDS.map((k, i) => stationRec(k, i + 1, 2 + i * 1.1, 0, 3))});
    const {eq} = s;
    const inside = (x: number) => x < 3.5;
    const n = eq.carry((x, _y, _z) => inside(x), 0.75, 2);
    const ins = eq.units().filter(u => inside(u.body.x));
    expect(n).toBe(ins.length);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(EQUIPMENT_KINDS.length);
    for (const u of eq.units()) {
      expect(u.body.y).toBe(inside(u.body.x) ? 0.75 : 0);
      expect(u.body.level).toBe(inside(u.body.x) ? 2 : 0);
    }
    const seen: number[] = [];
    expect(eq.anyAt((_x, _y, _z, r) => { seen.push(r); return false; })).toBe(false);
    expect(seen.sort()).toEqual(eq.units().map(u => u.def.radius).sort());
    expect(eq.anyAt((x, y) => y === 0.75 && x < 2.5)).toBe(true);
  });
});

describe('train equipment: crafting puts a real unit on the car floor', () => {
  it('the first physically free craft spot; a blocked spot is skipped; the unit is empty, unplugged, asleep, facing the aisle', () => {
    const {h, eq, carts} = station();
    const p = h.trainPlacement!;
    for (const kind of EQUIPMENT_KINDS) expect(eq.craftBlock(kind)).toBeNull();
    const kind = dollyKinds[0], def = EQUIPMENT[kind];
    const spots = craftSpots(def.radius, SPEC);
    const seq0 = h.playerTrain.equipment.seq;
    const u = eq.craft(kind)!;
    expect(u.uid).toBe(`eq-${seq0 + 1}`);
    expect(h.playerTrain.equipment.seq).toBe(seq0 + 1);
    const q = worldToTrain(p, u.body.x, u.body.y, u.body.z);
    expect([q.x, q.z]).toEqual([expect.closeTo(spots[0].x, 9), expect.closeTo(spots[0].z, 9)]);
    expect(u.body.y).toBeCloseTo(p.floorY, 6);
    expect(u.mode).toBe('world');
    expect(u.awake).toBe(false);
    expect([u.plug, u.ammo, u.slots]).toEqual([null, 0, null]);
    expect(cartAboard(q.x, q.z, def.radius, SPEC)).toBe(true);
    expect(eq.all().find(r => r.uid === u.uid)!.owner).toBe('train');
    // its front toward the car's centre line
    const front = {x: Math.sin(u.body.yaw), z: Math.cos(u.body.yaw)}, toAisle = trainToWorld(p, q.x, SPEC.floorY, 0);
    expect(front.x * (toAisle.x - u.body.x) + front.z * (toAisle.z - u.body.z)).toBeGreaterThan(0.5);
    run(h, 0.5);
    expect(u.plug).toBeNull(); // (a crafted device never plugs itself in: its spot is out of every plug's reach)
    expect(h.toasts).toEqual([]);
    // the next one skips the taken spot; a fuel cart on the following spot and the player on the one after are skipped too
    const free = spots.filter(s => Math.hypot(s.x - q.x, s.z - q.z) >= 2 * def.radius - 0.005);
    const cw = trainToWorld(p, free[0].x, SPEC.floorY, free[0].z);
    carts.spawn({uid: 'c', units: 2, x: cw.x, y: p.floorY, z: cw.z, yaw: 0, level: p.level});
    const free2 = free.filter(s => Math.hypot(s.x - free[0].x, s.z - free[0].z) >= 2 * def.radius - 0.005);
    const pw = trainToWorld(p, free2[0].x, SPEC.floorY, free2[0].z);
    stand(h, pw.x, pw.z, 0, p.floorY);
    const free3 = free2.filter(s => Math.hypot(s.x - free2[0].x, s.z - free2[0].z) >= def.radius + h.player.radius);
    const v = eq.craft(kind)!;
    const qv = worldToTrain(p, v.body.x, v.body.y, v.body.z);
    expect([qv.x, qv.z]).toEqual([expect.closeTo(free3[0].x, 9), expect.closeTo(free3[0].z, 9)]);
    expect(v.uid).toBe(`eq-${seq0 + 2}`);
    // a chest: crafted EMPTY with its own live slots
    for (const ck of carryKinds) {
      const c = eq.craft(ck)!;
      expect(c.slots).toHaveLength(EQUIPMENT[ck].slots);
      expect(c.slots!.every(x => x === null)).toBe(true);
      expect(eq.storesAboard().map(x => x.uid)).toContain(c.uid);
      expect(eq.storesAboard().find(x => x.uid === c.uid)!.slots).toBe(c.slots);
    }
    // every unit crafted is wholly aboard, apart from every other body, and the record validates
    const us = eq.units();
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      expect(Math.hypot(us[i].body.x - us[j].body.x, us[i].body.z - us[j].body.z)).toBeGreaterThanOrEqual(us[i].def.radius + us[j].def.radius - 0.005);
    }
    expect(eq.aboard().map(r => r.uid)).toEqual(us.map(x => x.uid));
    expect(eq.stationRecords()).toEqual([]);
  });

  it('refused while the train rides, without a train, with no free spot and at the limit — nothing changes; the uid counter only advances', () => {
    // without a train
    const room = equipRoom();
    for (const kind of EQUIPMENT_KINDS) {
      expect(room.eq.craftBlock(kind)).toBe(EQUIPMENT_TEXT.noTrain);
      expect(room.eq.craft(kind)).toBeNull();
    }
    expect(room.h.playerTrain.equipment.seq).toBe(0);
    // at the limit: EQUIPMENT_LIMITS.aboard units in the car
    const {h, eq, ride} = station();
    const kind = dollyKinds[0];
    const recs: EquipmentJSON[] = [];
    for (let i = 0; i < EQUIPMENT_LIMITS.aboard; i++) recs.push(aboardRec(kind, i + 1, -4.4 + Math.floor(i / 2) * 0.78, i % 2 ? 0.62 : -0.62));
    loadAboard(h, recs);
    run(h, 0.3);
    expect(eq.units()).toHaveLength(EQUIPMENT_LIMITS.aboard);
    expect(eq.aboard()).toHaveLength(EQUIPMENT_LIMITS.aboard);
    expect(eq.craftBlock(kind)).toBe(EQUIPMENT_TEXT.tooMany(EQUIPMENT_LIMITS.aboard, EQUIPMENT_LIMITS.aboard));
    expect(eq.craft(kind)).toBeNull();
    expect(h.playerTrain.equipment.seq).toBe(EQUIPMENT_LIMITS.aboard);
    expect(eq.departBlock()).toBeNull(); // (exactly the limit may ride)
    // an older state restored (two units): the counter stays where the run's record put it — a new unit never takes an old number
    h.playerTrain.equipment.seq = 40;
    eq.restore([recs[1], recs[4]]);
    expect(eq.units().map(u => u.uid)).toEqual(['eq-2', 'eq-5']);
    expect(eq.craftBlock(kind)).toBeNull();
    expect(eq.craft(kind)!.uid).toBe('eq-41');
    expect(eq.craft(carryKinds[0])!.uid).toBe('eq-42');
    expect(h.playerTrain.equipment.seq).toBe(42);
    // while the train rides
    void ride.depart();
    frame(h);
    expect(ride.riding).toBe(true);
    expect(eq.craftBlock(kind)).toBe(EQUIPMENT_TEXT.moving);
    expect(eq.craft(kind)).toBeNull();
    expect(h.playerTrain.equipment.seq).toBe(42);
    ride.reset();
  });
});

void DT;
