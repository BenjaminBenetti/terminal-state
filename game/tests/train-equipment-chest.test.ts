// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): THE CARRIED CHEST (world/trainEquipment.ts; a 'carry' kind in the
// hands) with the real train runtime + ride + Player (helpers/trainEquipmentHost.ts):
//  - [E] on it: only HOLDING [E] (EQUIP_HOLD_S) carries it (task train-interaction-ux-20261112: a carry starts with a hold, never a
//    tap); a tap is the kind's use when one is registered, else nothing; the prompt and the hold ring say which;
//  - in the hands: an input owner (`carrying`, the held item lowered over EQUIP.carry.holsterS, no item use — "Your hands are full",
//    a use in progress cancelled), the walk at EQUIP.carry.speedMult and a sprint no faster, the view in the carry frame under the
//    camera with no shadow, the lid shut; a hit or a menu never drops it;
//  - what refuses a pick-up: anything else in the hands (a grabbed dolly / fuel cart, a carried body, a readied flare, another input
//    owner…), a ladder; a 'dolly' kind is never carried;
//  - put down: on the first free spot in front (EQUIP.carry.putAt in order), its front toward the player; refused with the reason
//    when there is none ("No room to put it down here": a unit in the way, a wall), on a ladder, while the train moves; at the
//    train's driving console [E] is the console's;
//  - it is the TRAIN's while carried: recorded at the carrier's place in the car (clamped into the interior), at the car's spawn point
//    when the carrier stands outside; never in a station's list;
//  - a whole journey with the chest in the hands (departure, teardown, transit, the next build, arrival), then put down in the new car;
//  - death: it goes down at the carrier's feet, on this frame's hook or — a death decided after it — on the state change; riding it
//    stays in the hands (the train's record).
// No kind is named: the 'carry' and 'dolly' kinds come from the registry by their traits.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {trainSpawnLocal, trainToWorld} from '../src/gen/playerTrain';
import {EQUIPMENT, EQUIPMENT_KINDS, trainEquipmentProblem} from '../src/craft/equipment';
import {EQUIP_HOLD_S, type EquipmentUse} from '../src/craft/equipmentApi';
import {cartAboard} from '../src/fuel/trainPort';
import {combineModifiers} from '../src/player/modifiers';
import {SPRINT_SPEED, WALK_SPEED} from '../src/player/player';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {EQUIP, EQUIPMENT_TEXT, type LiveUnit, type TrainEquipmentSystem} from '../src/world/trainEquipment';
import {equipmentBox} from '../src/world/trainEquipmentModel';
import {DT, build, frame, press, run, teardown} from './helpers/fuelCartsHost';
import {
  aboardRec, equipStation, holdE, loadAboard, localOf, lookAtUnit, platformWorld, putLocal, stand, type EquipTestHost,
} from './helpers/trainEquipmentHost';

installCanvasShim(false);

const cache = new Map<string, StationLayout>();
const lay = (tag: string, make: () => StationLayout) => { let l = cache.get(tag); if (!l) cache.set(tag, (l = make())); return l; };
const SUBWAY = () => lay('subway', () => LEVELS.subway.generate('main', {levelSeed: 4242}));
const OFFICE = () => lay('office', () => LEVELS.office.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

const CARRY = EQUIPMENT_KINDS.find(k => EQUIPMENT[k].move === 'carry')!;
const DOLLY = EQUIPMENT_KINDS.find(k => EQUIPMENT[k].move === 'dolly')!;
const R = EQUIPMENT[CARRY].radius, THE = EQUIPMENT[CARRY].the;

/** A parked car with chests standing in it: eq-1 by the middle doors (the one carried), eq-2 further down the car; a dolly kind eq-3. */
function station(L = SUBWAY()) {
  const s = equipStation(L);
  live.push(s.rt);
  loadAboard(s.h, [aboardRec(CARRY, 1, -2.2, 0.2, Math.PI / 2), aboardRec(CARRY, 2, 3.4, -0.3, Math.PI / 2), aboardRec(DOLLY, 3, -4.2, 0.4, Math.PI / 2)]);
  run(s.h, 0.3);
  return {...s, chest: s.eq.unit('eq-1')!, other: s.eq.unit('eq-2')!, dolly: s.eq.unit('eq-3')!};
}

const uidOf = (u: {uid: string} | null | undefined): string | null => u?.uid ?? null;
const aimOf = (eq: TrainEquipmentSystem): [string, string] | null => (eq.aim ? [eq.aim.unit.uid, eq.aim.part] : null);
const ownerOf = (eq: TrainEquipmentSystem, uid: string) => eq.all().find(x => x.uid === uid)!.owner;

/** Stand `dist` in front of a unit's front and look at it. */
function faceOf(h: EquipTestHost, u: LiveUnit, dist = 1.2): void {
  const b = u.body, K = equipmentBox(u.def);
  stand(h, b.x + Math.sin(b.yaw) * dist, b.z + Math.cos(b.yaw) * dist, 0, b.y);
  frame(h);
  lookAtUnit(h, u, K.body.x, K.face ? K.face.y0 + (K.face.y1 - K.face.y0) * 0.7 : K.body.y1 - 0.03, K.face ? K.body.z + K.body.hd : K.body.hd * 0.5);
  frame(h);
}

/** Stand at a train-local spot of the car floor facing a train-local direction, level view. */
function standLocal(h: EquipTestHost, lx: number, lz: number, dx: number, dz: number): void {
  const p = h.trainPlacement!, w = trainToWorld(p, lx, SPEC.floorY, lz);
  stand(h, w.x, w.z, Math.atan2(-p.front * dx, -p.front * dz), p.floorY);
  h.player.pitch = 0;
  frame(h);
}

/** On a ladder (the Player's `climbing` is derived: shadowed on the instance for the test) / off it again. */
function onLadder(h: EquipTestHost, on: boolean): void {
  if (on) Object.defineProperty(h.player, 'climbing', {value: true, configurable: true});
  else delete (h.player as unknown as {climbing?: boolean}).climbing;
}

/** The player's position in the car's frame. */
function playerLocal(h: EquipTestHost): {x: number; z: number} {
  const p = h.trainPlacement!;
  return {x: (h.player.x - p.x) * p.front, z: (h.player.z - p.z) * p.front};
}

describe('the carried chest: [E] picks it up', () => {
  it('no use registered: a tap does nothing, holding [E] picks it up; the prompt, the cue, the use in progress cancelled; [E] again puts it down', () => {
    const {h, eq, chest} = station();
    faceOf(h, chest);
    expect(aimOf(eq)).toEqual(['eq-1', 'body']);
    expect(eq.prompt).toBe(EQUIPMENT_TEXT.carry(THE));
    // the press alone: pending (a chest's [E] is decided on the release / at the hold time)
    h.keys.held.add('KeyE'); h.keys.hits.add('KeyE');
    frame(h);
    expect([uidOf(eq.held), chest.mode]).toEqual([null, 'world']);
    expect(eq.holdProgress).toBeGreaterThan(0);
    expect(eq.prompt).toBe(EQUIPMENT_TEXT.holding(THE));
    expect(h.inputOwners.some(f => f())).toBe(true); // (the hands are spoken for from the press)
    run(h, 0.1);
    // released early = a tap: with no use nothing happens (never a pick-up)
    h.keys.held.clear();
    h.sfxCalls.length = 0;
    frame(h);
    expect([uidOf(eq.held), chest.mode, eq.counts.pickups]).toEqual([null, 'world', 0]);
    expect([h.sfxCalls, h.cancels, h.toasts]).toEqual([[], [], []]);
    expect(eq.holdProgress).toBeNull();
    expect(h.inputOwners.some(f => f())).toBe(false);
    expect(eq.prompt).toBe(EQUIPMENT_TEXT.carry(THE));
    // held EQUIP_HOLD_S: picked up
    holdE(h);
    expect([uidOf(eq.held), chest.mode, eq.counts.pickups]).toEqual(['eq-1', 'held', 1]);
    expect(h.sfxCalls).toEqual(['pickup']);
    expect(h.cancels).toEqual(['carry']);
    expect(eq.holdProgress).toBeNull();
    expect(h.rings[h.rings.length - 1]).toBeNull();
    // carried: no aim, no unit prompt; the first prompt in line is the put-down
    run(h, 0.2);
    expect([aimOf(eq), eq.prompt]).toEqual([null, null]);
    expect(h.promptProviders[0]()).toBe(EQUIPMENT_TEXT.putDown(THE));
    expect(chest.worldPose()).toBeNull();
    // [E]: down in front of the carrier, its front toward them
    h.sfxCalls.length = 0;
    press(h, 'KeyE');
    expect([uidOf(eq.held), chest.mode, eq.counts.putDowns]).toEqual([null, 'world', 1]);
    expect(h.sfxCalls).toContain('thud');
    const P = h.player, b = chest.body;
    expect(Math.hypot(b.x - P.x, b.z - P.z)).toBeCloseTo(EQUIP.carry.putAt[0], 6);
    expect(Math.cos(b.yaw - Math.atan2(P.x - b.x, P.z - b.z))).toBeCloseTo(1, 9);
    expect(Math.hypot(b.x - (P.x - Math.sin(P.yaw) * EQUIP.carry.putAt[0]), b.z - (P.z - Math.cos(P.yaw) * EQUIP.carry.putAt[0]))).toBeLessThan(1e-9);
    expect([b.y, b.level, chest.awake]).toEqual([h.trainPlacement!.floorY, h.trainPlacement!.level, false]);
    expect(chest.worldPose()).toMatchObject({x: b.x, y: b.y, z: b.z});
    expect(ownerOf(eq, 'eq-1')).toBe('train');
    run(h, 0.3);
    expect(h.promptProviders[0]()).toBeNull();
    expect(h.inputOwners.some(f => f())).toBe(false);
  });

  it('a use registered for the kind: the tap is the use\'s (true = handled), only holding [E] carries — the ring fills, the use is not asked', () => {
    const {h, eq, chest} = station();
    const calls: string[] = [];
    let answer = true;
    const use: EquipmentUse = {prompt: u => `use ${u.uid}`, tap: u => { calls.push(`tap ${u.uid}`); return answer; }};
    (eq.uses as Record<string, EquipmentUse>)[CARRY] = use;
    faceOf(h, chest);
    expect(eq.prompt).toBe('use eq-1' + EQUIPMENT_TEXT.carryHint);
    // tap, handled by the use: nothing is picked up
    h.keys.held.add('KeyE'); h.keys.hits.add('KeyE');
    frame(h);
    expect(calls).toEqual([]);
    run(h, 0.1);
    h.keys.held.clear();
    frame(h);
    expect(calls).toEqual(['tap eq-1']);
    expect([uidOf(eq.held), chest.mode]).toEqual([null, 'world']);
    // hold: carried at EQUIP_HOLD_S, the ring shown from 0.1 s, the use never asked
    h.rings.length = 0;
    h.keys.held.add('KeyE'); h.keys.hits.add('KeyE');
    frame(h);
    run(h, EQUIP_HOLD_S - 2 * DT - 1e-6);
    expect(uidOf(eq.held)).toBeNull();
    const shown = h.rings.filter((v): v is number => v !== null);
    expect(shown.length).toBeGreaterThan(10);
    expect(shown.every((v, i) => v > 0.19 && v < 1 && (i === 0 || v > shown[i - 1]))).toBe(true);
    run(h, 3 * DT);
    expect(uidOf(eq.held)).toBe('eq-1');
    expect(calls).toEqual(['tap eq-1']);
    expect(h.rings[h.rings.length - 1]).toBeNull();
    // E still down afterwards does nothing more (no put-down on the same press)
    run(h, 0.5);
    expect(uidOf(eq.held)).toBe('eq-1');
    h.keys.held.clear();
    frame(h);
    expect(uidOf(eq.held)).toBe('eq-1');
    press(h, 'KeyE');
    expect(uidOf(eq.held)).toBeNull();
    // a use that does not handle the tap (false): nothing happens — never a pick-up
    answer = false;
    run(h, 0.3);
    faceOf(h, chest);
    press(h, 'KeyE');
    frame(h);
    expect(calls).toEqual(['tap eq-1', 'tap eq-1']);
    expect(uidOf(eq.held)).toBeNull();
    // the aim leaving during the hold cancels it (neither the use nor a pick-up)
    run(h, 0.3);
    faceOf(h, chest);
    h.keys.held.add('KeyE'); h.keys.hits.add('KeyE');
    frame(h);
    run(h, 0.2);
    h.player.yaw += 2;
    run(h, 1);
    h.keys.held.clear();
    frame(h);
    expect(calls).toEqual(['tap eq-1', 'tap eq-1']);
    expect(uidOf(eq.held)).toBeNull();
    delete (eq.uses as Record<string, EquipmentUse>)[CARRY];
  });
});

describe('the carried chest: in the hands', () => {
  it('an input owner: the held item lowers, no item use, the walk is slower and a sprint no faster; a hit or a menu never drops it', () => {
    const {h, eq, chest} = station();
    // the walking speed along the aisle, hands free
    const walk = () => {
      standLocal(h, -1.2, -0.75, -1, 0); // (a lane clear of every unit and fixture)
      h.keys.held.add('KeyW');
      run(h, 0.9);
      const v = Math.hypot(h.player.vx, h.player.vz);
      h.keys.held.clear();
      run(h, 0.5);
      return v;
    };
    const free = walk();
    expect(free).toBeCloseTo(WALK_SPEED, 2);
    expect([eq.carrying, eq.holster, eq.refuseUse()]).toEqual([false, 0, false]);
    expect(combineModifiers(h.modifierSources as never).speedMult).toBe(1);
    expect(eq.pickUp(chest)).toBe(true);
    expect(eq.carrying).toBe(true);
    expect(h.inputOwners.some(f => f())).toBe(true);
    // the held item goes down over the holster time
    frame(h);
    expect(eq.holster).toBeGreaterThan(0);
    expect(eq.holster).toBeLessThan(1);
    run(h, EQUIP.carry.holsterS + 0.05);
    expect(eq.holster).toBe(1);
    // an item use is refused with the note
    h.toasts.length = 0; h.sfxCalls.length = 0;
    expect(eq.refuseUse()).toBe(true);
    expect(h.toasts).toEqual([EQUIPMENT_TEXT.handsFull]);
    expect(h.sfxCalls).toEqual(['denied']);
    // slower on foot; sprinting gives the same speed (the modifier cancels the sprint's gain)
    const mods = combineModifiers(h.modifierSources as never);
    expect(mods.speedMult).toBeCloseTo(EQUIP.carry.speedMult, 12);
    const carrying = walk();
    expect(carrying / free).toBeCloseTo(EQUIP.carry.speedMult, 3);
    h.player.sprinting = true;
    expect(combineModifiers(h.modifierSources as never).speedMult * SPRINT_SPEED).toBeCloseTo(EQUIP.carry.speedMult * WALK_SPEED, 9);
    h.player.sprinting = false;
    // a hit, a menu and back: still in the hands
    for (const f of h.hitListeners) f({damage: 20} as never);
    h.state = 'paused';
    for (const f of h.stateListeners) f('paused' as never, 'playing' as never);
    expect(h.promptProviders[0]()).toBeNull();
    expect(h.interactHandlers[0]()).toBe(true); // (E in a menu is not a put-down — and nothing else's either)
    h.state = 'playing';
    for (const f of h.stateListeners) f('playing' as never, 'paused' as never);
    run(h, 0.2);
    expect([uidOf(eq.held), chest.mode]).toEqual(['eq-1', 'held']);
    // nothing else can be taken meanwhile
    const {other, dolly} = {other: eq.unit('eq-2')!, dolly: eq.unit('eq-3')!};
    h.toasts.length = 0;
    expect(eq.pickUp(other)).toBe(false);
    expect(h.toasts).toEqual([EQUIPMENT_TEXT.handsFull]);
    expect(eq.onInteract()).toBe(false); // (no aim while carrying: E on a unit is never reached)
    expect([uidOf(eq.grab?.unit), dolly.mode, other.mode]).toEqual([null, 'world', 'world']);
    // down again: the hands free, the item comes back up
    standLocal(h, 0.2, -0.75, 1, 0);
    press(h, 'KeyE');
    expect(uidOf(eq.held)).toBeNull();
    run(h, EQUIP.carry.holsterS + 0.05);
    expect([eq.carrying, eq.holster, eq.refuseUse()]).toEqual([false, 0, false]);
    expect(combineModifiers(h.modifierSources as never).speedMult).toBe(1);
  });

  it('the view rides the carry frame under the camera, without a shadow, the lid shut; standing again it is drawn where it stands', () => {
    const {h, eq, chest} = station();
    const g = chest.view.group;
    const meshes: THREE.Mesh[] = [];
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThan(0);
    const shadows = meshes.map(m => m.castShadow);
    expect(g.parent).toBe(eq.group);
    expect(eq.hands.parent).toBe(h.camera);
    // the lid up (the store view's doing), then picked up: shut at once
    chest.setOpen(true);
    run(h, 1);
    expect([chest.lidT, chest.lidTarget]).toEqual([1, 1]);
    expect(eq.pickUp(chest)).toBe(true);
    expect([chest.lidT, chest.lidTarget]).toEqual([0, 0]);
    chest.setOpen(true); // (not while it is carried)
    run(h, 0.5);
    expect([chest.lidT, chest.lidTarget]).toEqual([0, 0]);
    expect(g.parent).toBe(eq.hands);
    const A = EQUIP.carry.anchor;
    expect([g.position.x, g.position.y, g.position.z]).toEqual([A.x, A.y, A.z]);
    expect(meshes.every(m => !m.castShadow)).toBe(true);
    // low in view: its top below the eye line, in front of the camera — and it follows half of the view's pitch
    h.player.pitch = 0;
    run(h, 0.1);
    const top = new THREE.Vector3(0, chest.def.height, 0);
    g.updateWorldMatrix(true, false);
    const inCam = g.localToWorld(top.clone()).applyMatrix4(h.camera.matrixWorldInverse);
    expect(inCam.z).toBeLessThan(-0.2);
    expect(inCam.y).toBeLessThan(-0.2);
    h.player.pitch = -0.8;
    run(h, 0.1);
    expect(eq.hands.rotation.x).toBeCloseTo(0.8 * (1 - EQUIP.carry.pitchFollow), 6);
    h.player.pitch = 0;
    // riding cargo and bullets never see it
    expect(eq.bulletHit({t: 30}, new THREE.Vector3(h.player.x, h.player.eye, h.player.z - 30), new THREE.Vector3(0, 0, -1), 10)).toBe(false);
    // down: back under the world group at its body, the shadows as before
    standLocal(h, 0.2, -0.75, 1, 0);
    press(h, 'KeyE');
    expect(uidOf(eq.held)).toBeNull();
    expect(g.parent).toBe(eq.group);
    expect(g.position.distanceTo(new THREE.Vector3(chest.body.x, chest.body.y, chest.body.z))).toBeLessThan(1e-9);
    expect(meshes.map(m => m.castShadow)).toEqual(shadows);
    chest.setOpen(true);
    run(h, 1);
    expect(chest.lidT).toBe(1);
  });

  it('a pick-up needs the hands free: anything else in them, a ladder, a menu refuse it; a dolly kind is never carried', () => {
    const {h, eq, chest, dolly} = station();
    const X = h as unknown as Record<string, unknown>;
    const refused = (text: string, what: string) => {
      h.toasts.length = 0; h.sfxCalls.length = 0;
      expect(eq.pickUp(chest), what).toBe(false);
      expect(h.toasts, what).toEqual([text]);
      expect(h.sfxCalls, what).toEqual(['denied']);
      expect([chest.mode, uidOf(eq.held)], what).toEqual(['world', null]);
    };
    const busy: [string, () => void, () => void][] = [
      ['a carried body', () => { X.corpses = {carrying: true}; }, () => { X.corpses = null; }],
      ['a grabbed fuel cart', () => { (h.fuelCarts as unknown as {grab: unknown}).grab = {}; }, () => { (h.fuelCarts as unknown as {grab: unknown}).grab = null; }],
      ['a readied flare', () => { X.flareHold = {active: true}; }, () => { X.flareHold = null; }],
      ['driving', () => { X.skywaysCar = {driving: true}; }, () => { X.skywaysCar = null; }],
      ['being sick', () => { X.vomit = {active: true}; }, () => { X.vomit = null; }],
      ['another input owner', () => { h.inputOwners.push(() => true); }, () => { h.inputOwners.pop(); }],
      ['a menu', () => { h.state = 'paused'; }, () => { h.state = 'playing'; }],
    ];
    for (const [what, set, unset] of busy) { set(); refused(EQUIPMENT_TEXT.handsFull, what); unset(); }
    // a grabbed dolly
    eq.grab = {unit: dolly, lag: 0, flip: false};
    refused(EQUIPMENT_TEXT.handsFull, 'a grabbed dolly');
    eq.letGo('test');
    // on a ladder: its own reason
    onLadder(h, true);
    refused(EQUIPMENT_TEXT.ladder, 'a ladder');
    onLadder(h, false);
    expect(h.player.climbing).toBe(false);
    // a dolly kind is rolled, never carried (no note: holding [E] on it drags)
    h.toasts.length = 0;
    expect(eq.pickUp(dolly)).toBe(false);
    expect([h.toasts, dolly.mode]).toEqual([[], 'world']);
    // free again: it works, once
    expect(eq.pickUp(chest)).toBe(true);
    expect(eq.pickUp(chest)).toBe(false);
    expect(eq.counts.pickups).toBe(1);
  });
});

describe('the carried chest: put down', () => {
  it('the first free spot in front, in EQUIP.carry.putAt order; a unit in the way moves it nearer, then refuses: "No room to put it down here"', () => {
    const {h, eq, chest, other} = station();
    const at = (d: number) => { const l = playerLocal(h); putLocal(h, other, l.x + d, l.z, 0); frame(h); };
    const put = () => { h.toasts.length = 0; h.sfxCalls.length = 0; press(h, 'KeyE'); return uidOf(eq.held) === null; };
    const dist = () => Math.hypot(chest.body.x - h.player.x, chest.body.z - h.player.z);
    const min = R + other.def.radius;
    expect(eq.pickUp(chest)).toBe(true);
    standLocal(h, -1.5, -0.6, 1, 0);
    const [d0, d1, d2, d3] = EQUIP.carry.putAt;
    // room at the first distance
    at(d0 + min + 0.05);
    expect(put()).toBe(true);
    expect(dist()).toBeCloseTo(d0, 6);
    // the first taken: the next one out (never nearer first)… here the blocker is beyond: the farther ones are blocked too -> the near one
    expect(eq.pickUp(chest)).toBe(true);
    at(d3 + min + 0.05);
    expect(d3 + min + 0.05 - d0).toBeLessThan(min - 0.01); // (the three front spots overlap the blocker)
    expect(put()).toBe(true);
    expect(dist()).toBeCloseTo(d3, 6);
    expect(dist()).toBeGreaterThanOrEqual(R + h.player.radius); // (never on the carrier's own feet)
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    // a blocker right in front: no spot — refused with the reason, still carried
    expect(eq.pickUp(chest)).toBe(true);
    at(d3 + min - 0.05);
    const refusedBefore = eq.counts.refused;
    expect(put()).toBe(false);
    expect(h.toasts).toEqual([EQUIPMENT_TEXT.noPutDown]);
    expect(h.sfxCalls).toEqual(['denied']);
    expect([chest.mode, eq.counts.refused]).toEqual(['held', refusedBefore + 1]);
    // turned away from it: down
    standLocal(h, -1.5, -0.6, -1, 0);
    expect(put()).toBe(true);
    expect(dist()).toBeCloseTo(d0, 6);
    // units never overlap afterwards
    for (const a of eq.units()) for (const b of eq.units()) {
      if (a.seq < b.seq) expect(Math.hypot(a.body.x - b.body.x, a.body.z - b.body.z)).toBeGreaterThanOrEqual(a.def.radius + b.def.radius - 0.006);
    }
  });

  it('never through the car\'s wall, never on a ladder, never while the train moves; at the driving console [E] is the console\'s', async () => {
    const {h, eq, chest, rt, ride} = station();
    const put = () => { h.toasts.length = 0; h.sfxCalls.length = 0; press(h, 'KeyE'); return uidOf(eq.held) === null; };
    expect(eq.pickUp(chest)).toBe(true);
    // facing the side wall from close (both sides; no door there)
    for (const side of [-1, 1]) {
      standLocal(h, -2.2, side * 0.6, 0, side);
      expect(put(), `side ${side}`).toBe(false);
      expect(h.toasts).toEqual([EQUIPMENT_TEXT.noPutDown]);
    }
    // facing the end partition from close
    standLocal(h, SPEC.interior.x1 - 0.5, 0.9, 1, 0);
    expect(put()).toBe(false);
    // on a ladder
    standLocal(h, 0.2, -0.6, 1, 0);
    onLadder(h, true);
    expect(put()).toBe(false);
    expect(h.toasts).toEqual([EQUIPMENT_TEXT.ladder]);
    onLadder(h, false);
    // at the driving console: the put-down steps aside (E opens the map with the chest in the hands), no put-down prompt
    rt.consoleAimed = true;
    expect(h.interactHandlers[0]()).toBe(false);
    expect(h.promptProviders[0]()).toBeNull();
    expect(uidOf(eq.held)).toBe('eq-1');
    rt.consoleAimed = false;
    expect(h.promptProviders[0]()).toBe(EQUIPMENT_TEXT.putDown(THE));
    // (refinement batch) at the Save terminal likewise: its [E] saves with the chest in the hands (a held unit saves as the train's)
    rt.saveAimed = true;
    expect(h.interactHandlers[0]()).toBe(false);
    expect(h.promptProviders[0]()).toBeNull();
    expect(uidOf(eq.held)).toBe('eq-1');
    rt.saveAimed = false;
    expect(h.promptProviders[0]()).toBe(EQUIPMENT_TEXT.putDown(THE));
    // the train moves: refused with the reason; no put-down prompt
    void ride.depart();
    run(h, 0.3);
    expect(ride.riding).toBe(true);
    expect(put()).toBe(false);
    expect(h.toasts).toEqual([EQUIPMENT_TEXT.moving]);
    expect(h.promptProviders[0]()).toBeNull();
    expect(chest.mode).toBe('held');
    ride.reset();
    await Promise.resolve();
    run(h, 0.3);
    // parked again: down on the aisle
    standLocal(h, 0.2, -0.6, 1, 0);
    expect(put()).toBe(true);
    const q = localOf(h, chest);
    expect(cartAboard(q.x, q.z, R, SPEC)).toBe(true);
  });

  it('through an open doorway onto the platform: the station\'s then; back in the car: the train\'s', () => {
    const {h, eq, chest} = station();
    expect(eq.pickUp(chest)).toBe(true);
    // on the platform, facing away from the car
    const pw = platformWorld(h, -0.5, -3.2), p = h.trainPlacement!;
    stand(h, pw.x, pw.z, Math.atan2(0, p.front), pw.y);
    h.player.pitch = 0;
    frame(h);
    press(h, 'KeyE');
    expect(uidOf(eq.held)).toBeNull();
    expect(ownerOf(eq, 'eq-1')).toBe('station');
    expect(chest.body.y).toBeCloseTo(pw.y, 6);
    expect(eq.stationRecords().map(r => r.uid)).toEqual(['eq-1']);
    expect(eq.aboard().map(r => r.uid)).toEqual(['eq-2', 'eq-3']);
    expect(eq.departBlock()).toBeNull();
    // picked up there and brought back
    expect(eq.pickUp(chest)).toBe(true);
    expect(eq.stationRecords()).toEqual([]); // (in the hands it is the train's, wherever the carrier stands)
    standLocal(h, 0.2, -0.6, 1, 0);
    press(h, 'KeyE');
    expect(ownerOf(eq, 'eq-1')).toBe('train');
    expect(eq.aboard().map(r => r.uid)).toEqual(['eq-1', 'eq-2', 'eq-3']);
  });
});

describe('the carried chest: whose it is, and a journey with it in the hands', () => {
  it('in the hands it is the train\'s: recorded at the carrier\'s place in the car (clamped), at the spawn point from outside; contents kept', () => {
    const {h, eq, chest} = station();
    const I = SPEC.interior;
    const stack = (chest.slots![9] = h.inv.makeStack('ammo_9mm', 33));
    chest.touchStore();
    expect(eq.pickUp(chest)).toBe(true);
    const rec = () => eq.aboard().find(r => r.uid === 'eq-1')!;
    // in the middle of the car: the carrier's own spot
    standLocal(h, 1.1, 0.3, 1, 0);
    expect(rec()).toMatchObject({kind: CARRY, x: expect.closeTo(1.1, 3), y: SPEC.floorY, z: expect.closeTo(0.3, 3), yaw: 0});
    expect(rec().slots![9]).toEqual({uid: stack.uid, itemId: 'ammo_9mm', count: 33});
    expect(rec().plug).toBeUndefined();
    // against the lining: clamped so the footprint is wholly inside
    standLocal(h, 1.1, I.halfWidth - 0.32, 1, 0);
    expect(Math.abs(rec().z)).toBeLessThanOrEqual(I.halfWidth - R);
    expect(cartAboard(rec().x, rec().z, R - 0.011, SPEC)).toBe(true);
    // outside the car (the platform): the car's spawn point
    const pw = platformWorld(h, 2, -3.4);
    stand(h, pw.x, pw.z, 0, pw.y);
    frame(h);
    const s = trainSpawnLocal(SPEC);
    expect(rec()).toMatchObject({x: expect.closeTo(s.x, 3), z: expect.closeTo(s.z, 3), y: SPEC.floorY});
    expect(eq.stationRecords()).toEqual([]);
    expect(ownerOf(eq, 'eq-1')).toBe('train');
    expect(trainEquipmentProblem(h.playerTrain.equipment.toJSON())).toBeNull();
    expect(eq.storesAboard().map(x => x.uid)).toEqual(['eq-2']); // (not a store standing in the car)
    expect(eq.departBlock()).toBeNull();
    // the world goes while it is carried (a Retry / the menu): it stays in the hands and in the record
    teardown(h);
    expect([uidOf(eq.held), chest.mode, eq.units().length]).toEqual(['eq-1', 'held', 1]);
    expect(h.playerTrain.equipment.records().map(r => r.uid)).toEqual(['eq-1', 'eq-2', 'eq-3']);
    h.toasts.length = 0;
    expect(eq.putDown()).toBe(false); // (no world to stand in)
    expect(h.toasts).toEqual([EQUIPMENT_TEXT.noPutDown]);
    build(h, SUBWAY());
    run(h, 0.3);
    expect([uidOf(eq.held), chest.mode]).toEqual(['eq-1', 'held']);
    expect(eq.units().map(u => u.uid)).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(eq.units()[0] === chest).toBe(true); // the same unit, the same stack object
    expect(chest.slots![9] === stack).toBe(true);
  });

  it('a whole journey with the chest in the hands: departure, teardown, transit, the next station\'s build, arrival — then down in the new car', async () => {
    const A = SUBWAY(), B = OFFICE();
    const {h, eq, chest, ride} = station(A);
    const stack = (chest.slots![0] = h.inv.makeStack('beans', 2));
    chest.touchStore();
    standLocal(h, 0.2, -0.2, 1, 0);
    expect(eq.pickUp(chest)).toBe(true);
    run(h, 0.3);
    void ride.depart();
    frame(h);
    expect(eq.units().map(u => [u.uid, u.mode])).toEqual([['eq-1', 'held'], ['eq-2', 'cargo'], ['eq-3', 'cargo']]);
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    // riding: recorded at the rider's place in the car; E does not put it down
    const r1 = eq.aboard().find(r => r.uid === 'eq-1')!;
    expect(Math.hypot(r1.x - ride.local.x, r1.z - ride.local.z)).toBeLessThan(0.2);
    h.toasts.length = 0;
    press(h, 'KeyE');
    expect(h.toasts).toEqual([EQUIPMENT_TEXT.moving]);
    expect(uidOf(eq.held)).toBe('eq-1');
    // the old world goes
    teardown(h);
    expect(eq.units().map(u => [u.uid, u.mode])).toEqual([['eq-1', 'held'], ['eq-2', 'cargo'], ['eq-3', 'cargo']]);
    expect(chest.view.group.parent).toBe(eq.hands);
    const saved = h.playerTrain.equipment.toJSON();
    expect(trainEquipmentProblem(saved)).toBeNull();
    expect(saved.aboard.map(r => r.uid)).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(saved.aboard[0].slots![0]).toMatchObject({itemId: 'beans', count: 2});
    expect(h.run.laneStore('train-equipment')).toBeUndefined();
    run(h, 1);
    // the next station
    h.run.current = {level: 'office', section: 'main'};
    build(h, B, false);
    expect(uidOf(eq.held)).toBe('eq-1');
    void ride.arrive();
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    run(h, 0.3);
    expect(eq.units().map(u => [u.uid, u.mode])).toEqual([['eq-1', 'held'], ['eq-2', 'world'], ['eq-3', 'world']]);
    // down in the new car
    const l = playerLocal(h);
    standLocal(h, l.x, l.z, -1, 0);
    press(h, 'KeyE');
    expect([uidOf(eq.held), chest.mode]).toEqual([null, 'world']);
    const q = localOf(h, chest), p2 = h.trainPlacement!;
    expect(cartAboard(q.x, q.z, R, SPEC)).toBe(true);
    expect([chest.body.y, chest.body.level]).toEqual([p2.floorY, p2.level]);
    expect(eq.all().every(x => x.owner === 'train')).toBe(true);
    expect(eq.stationRecords()).toEqual([]);
    expect(chest.slots![0] === stack).toBe(true);
    expect(eq.storesAboard().map(x => x.uid)).toEqual(['eq-1', 'eq-2']);
  });
});

describe('the carried chest: death', () => {
  it('the carrier dies: the chest goes down at their feet on that frame — never lost, never kept; on the platform it is the station\'s', () => {
    const {h, eq, chest} = station();
    expect(eq.pickUp(chest)).toBe(true);
    standLocal(h, 0.2, -0.6, 1, 0);
    h.player.alive = false;
    h.sfxCalls.length = 0;
    for (const f of h.frameHooks) f(DT); // (Game.update's hooks of the frame the player died in)
    expect([uidOf(eq.held), chest.mode]).toEqual([null, 'world']);
    expect(h.sfxCalls).toContain('thud');
    const d = Math.hypot(chest.body.x - h.player.x, chest.body.z - h.player.z);
    expect(d).toBeLessThanOrEqual(Math.max(...EQUIP.carry.putAt) + 1e-6);
    expect(ownerOf(eq, 'eq-1')).toBe('train');
    expect(eq.spotFree(chest.body.x, chest.body.y, chest.body.z, chest.def, chest, false)).toBe(true);
    expect(h.inputOwners.some(f => f())).toBe(false);
    expect(h.promptProviders[0]()).toBeNull();
    // a dead player picks nothing up
    h.toasts.length = 0;
    expect(eq.pickUp(chest)).toBe(false);
    h.player.alive = true;
  });

  it('a death decided after the frame\'s hook (the state change): down as well; boxed in, it still goes down — on the carrier\'s own spot', () => {
    const {h, eq, chest, other, dolly} = station();
    expect(eq.pickUp(chest)).toBe(true);
    const pw = platformWorld(h, -0.5, -3.2);
    stand(h, pw.x, pw.z, 0, pw.y);
    frame(h);
    h.player.alive = false;
    h.state = 'dead';
    for (const f of h.stateListeners) f('dead' as never, 'playing' as never);
    expect([uidOf(eq.held), chest.mode]).toEqual([null, 'world']);
    expect(ownerOf(eq, 'eq-1')).toBe('station');
    expect(Math.hypot(chest.body.x - pw.x, chest.body.z - pw.z)).toBeLessThanOrEqual(Math.max(...EQUIP.carry.putAt) + 1e-6);
    // boxed in at the car's end: a unit on either side, the partition behind, walls left and right
    h.player.alive = true;
    h.state = 'playing';
    for (const f of h.stateListeners) f('playing' as never, 'dead' as never);
    expect(eq.pickUp(chest)).toBe(true);
    const I = SPEC.interior, x = I.x1 - 0.42;
    standLocal(h, x, 0.85, -1, 0);
    const l = playerLocal(h);
    putLocal(h, other, l.x - 0.75, l.z, 0);
    putLocal(h, dolly, l.x - 0.3, l.z - 0.8, 0);
    h.player.alive = false;
    for (const f of h.frameHooks) f(DT);
    expect([uidOf(eq.held), chest.mode]).toEqual([null, 'world']);
    const d = Math.hypot(chest.body.x - h.player.x, chest.body.z - h.player.z);
    expect(d).toBeLessThanOrEqual(Math.max(...EQUIP.carry.putAt) + 1e-6);
    expect(eq.aboard().map(r => r.uid)).toContain('eq-1'); // still the train's, still one of it
    expect(new Set(eq.units().map(u => u.uid)).size).toBe(3);
    h.player.alive = true;
  });

  it('dying as the train pulls out calls the ride off (the ride\'s rule): the chest goes down in the parked car; between two worlds it stays in the hands', async () => {
    const {h, eq, chest, ride} = station();
    standLocal(h, 0.2, -0.2, 1, 0);
    expect(eq.pickUp(chest)).toBe(true);
    void ride.depart();
    run(h, 0.3);
    expect(ride.riding).toBe(true);
    h.player.alive = false;
    for (const f of h.frameHooks) f(DT);
    expect([uidOf(eq.held), chest.mode]).toEqual(['eq-1', 'held']); // (never dropped into a moving car)
    h.state = 'dead';
    for (const f of h.stateListeners) f('dead' as never, 'playing' as never); // Game.die: the ride resets on the death screen
    expect(ride.riding).toBe(false);
    expect([uidOf(eq.held), chest.mode]).toEqual([null, 'world']);
    for (const f of h.frameHooks) f(DT);
    expect(eq.units().map(u => u.mode)).toEqual(['world', 'world', 'world']);
    expect(eq.all().every(x => x.owner === 'train')).toBe(true);
    await Promise.resolve();
    // between two worlds (the old station gone, the next not built): nowhere to stand — it stays in the hands, the train's record
    h.player.alive = true;
    h.state = 'playing';
    for (const f of h.stateListeners) f('playing' as never, 'dead' as never);
    run(h, 0.5);
    expect(eq.pickUp(chest)).toBe(true);
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    teardown(h);
    run(h, 0.5);
    h.player.alive = false;
    h.state = 'dead';
    for (const f of h.frameHooks) f(DT);
    for (const f of h.stateListeners) f('dead' as never, 'playing' as never);
    expect([uidOf(eq.held), chest.mode]).toEqual(['eq-1', 'held']);
    expect(h.playerTrain.equipment.toJSON().aboard.map(r => r.uid)).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(trainEquipmentProblem(h.playerTrain.equipment.toJSON())).toBeNull();
    h.player.alive = true;
    h.state = 'playing';
    await Promise.resolve();
  });
});
