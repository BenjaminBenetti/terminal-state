// Task train-interaction-ux-20261112-063646 (lane DRAG; user: "ALL existing draggable items, including equipment and the fuel dolly,
// require HOLDING E to START dragging, with the existing crosshair hold-progress spinner. Quick normal interaction must not
// accidentally start dragging. Releasing E after the drag starts should not drop it; retain the usual stop action. Cancel an
// unfinished hold normally on target/range/input-owner changes. Reuse the common interaction/drag mechanism rather than add per-kind
// exceptions."): THE TRAIN EQUIPMENT's E (world/trainEquipment.ts over the shared gesture, core/holdGesture.ts) with the real Player
// body, for EVERY kind the registry holds at run time (craft/equipment.ts EQUIPMENT_KINDS — no kind is named here):
//  - a TAP of E — one frame or just under the hold time, on any part — never drags / carries; with no use registered nothing happens;
//  - HOLDING E for EQUIP_HOLD_S starts the drag (a 'dolly' kind) / the carry (a 'carry' kind) by the kind's `move` trait alone:
//    nothing before it, the "Grabbing… / Picking up…" line and the rising ring meanwhile, an input owner from the press; E released
//    afterwards keeps it; the next E lets go / puts down (the usual stop) and that key kept down starts nothing;
//  - a registered use is the TAP for any aimed part, on the release (its line + the hold hint); a false answer does nothing; a hold
//    never asks it;
//  - an unfinished hold is DROPPED (no drag, no tap) when the aim leaves the unit / moves to another unit / goes out of reach, the
//    keys are wiped, a menu opens, the player dies or climbs, another input owner takes over, the world goes, the train rides;
//  - the copy; one shared gesture in both systems (no second hold clock).
// The pure gesture: hold-gesture.test.ts. The fuel cart: drag-hold-fuel-cart.test.ts. R while dragging: equipment-flip.test.ts.
import {afterEach, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {DRAG_HOLD_S, HOLD_RING_DELAY_S} from '../src/core/holdGesture';
import {EQUIPMENT, EQUIPMENT_KINDS, type EquipmentJSON, type EquipmentKind} from '../src/craft/equipment';
import {EQUIP_HOLD_S, type EquipmentUse} from '../src/craft/equipmentApi';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {CART_TEXT} from '../src/world/fuelCarts';
import {CHEST_STORE_TEXT} from '../src/world/equipmentChestStore';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {EQUIP, EQUIPMENT_TEXT, type LiveUnit} from '../src/world/trainEquipment';
import {equipmentBox} from '../src/world/trainEquipmentModel';
import {DT, HOLD_E_S, flatRoom, frame, press, run, tapE, teardown} from './helpers/fuelCartsHost';
import {aboardRec, equipRoom, equipStation, holdE, loadAboard, lookAtUnit, stand, stationRec, type EquipTestHost} from './helpers/trainEquipmentHost';

installCanvasShim(false);

let subway: StationLayout | null = null;
const SUBWAY = () => (subway ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

const dollyKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].move === 'dolly');
const carryKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].move === 'carry');

const keyDown = (h: EquipTestHost) => { h.keys.held.add('KeyE'); h.keys.hits.add('KeyE'); frame(h); };
const keyUp = (h: EquipTestHost) => { h.keys.held.delete('KeyE'); frame(h); };

/** Turn the view onto a unit's front (its console face / its latches) — no frame. */
function lookFront(h: EquipTestHost, u: LiveUnit): void {
  const K = equipmentBox(u.def);
  lookAtUnit(h, u, K.body.x, K.face ? K.face.y0 + (K.face.y1 - K.face.y0) * 0.7 : K.body.y1 - 0.03, K.face ? K.body.z + K.body.hd : K.body.hd * 0.5);
}

/** The flat room, a unit of `kind` (eq-1) at (3.5, 3) facing +Z (+ any more station records). */
function world(kind: EquipmentKind, more: EquipmentJSON[] = []) {
  const s = equipRoom(flatRoom(), null, {here: [stationRec(kind, 1, 3.5, 0, 3), ...more]});
  const {h, eq} = s, u = eq.unit('eq-1')!, b = u.body, carry = u.def.move === 'carry';
  /** In front of its front, looking at it. */
  const front = () => { stand(h, b.x + Math.sin(b.yaw) * 1.2, b.z + Math.cos(b.yaw) * 1.2, 0, 0); frame(h); lookFront(h, u); frame(h); };
  /** Behind a hand truck's handle, looking at it. */
  const back = () => { stand(h, b.x - Math.sin(b.yaw) * 1.2, b.z - Math.cos(b.yaw) * 1.2, Math.PI, 0); frame(h); lookAtUnit(h, u, 0, CART_LOOK.handle.y, CART_LOOK.handle.z); frame(h); };
  /** In the hands now (dragged / carried). */
  const got = () => (carry ? eq.held === u : eq.grab?.unit === u);
  /** Nothing in the hands, the unit back on its spot. */
  const reset = () => {
    h.keys.held.clear();
    if (eq.grab || eq.held) press(h, 'KeyE');
    expect([eq.grab, eq.held]).toEqual([null, null]);
    b.x = 3.5; b.z = 3; b.yaw = 0; b.vx = b.vz = 0;
    frame(h);
  };
  return {...s, u, b, carry, front, back, got, reset, sides: carry ? [front] : [front, back]};
}

describe('train equipment: a drag / a carry starts with a HOLD of E, never a tap — every kind of the registry', () => {
  it('the registry has both ways of moving a unit, and nothing else', () => {
    expect(dollyKinds.length).toBeGreaterThan(0);
    expect(carryKinds.length).toBeGreaterThan(0);
    expect(dollyKinds.length + carryKinds.length).toBe(EQUIPMENT_KINDS.length);
  });

  for (const kind of EQUIPMENT_KINDS) {
    const def = EQUIPMENT[kind], carry = def.move === 'carry';
    it(`${def.name} ('${def.move}'): a tap never moves it (any part, any length under the hold time); holding E does; E released keeps it; the next E is the usual stop`, () => {
      const w = world(kind), {h, eq, u} = w;
      const line = carry ? EQUIPMENT_TEXT.carry(def.the) : EQUIPMENT_TEXT.drag(def.the, def.plug ? EQUIPMENT_TEXT.plugHint : '');
      expect(line.startsWith('<b>Hold [E]</b> ')).toBe(true);
      for (const side of w.sides) {
        side();
        expect(eq.aim?.unit).toBe(u);
        expect(eq.prompt).toBe(line);
        // taps: nothing at all (no use is registered in this world)
        const c0 = {...eq.counts};
        for (const seconds of [0, 0.05, 0.3, DRAG_HOLD_S - 3 * DT]) {
          h.rings.length = 0;
          if (seconds === 0) tapE(h); else holdE(h, seconds);
          expect([w.got(), eq.eHold.pending, u.mode], `tap ${seconds} s`).toEqual([false, false, 'world']);
          if (seconds < HOLD_RING_DELAY_S) expect(h.rings.every(v => v === null), `tap ${seconds} s`).toBe(true);
          expect(h.rings[h.rings.length - 1]).toBeNull();
        }
        expect(eq.counts).toMatchObject({grabs: c0.grabs, pickups: c0.pickups, holds: c0.holds, taps: c0.taps, letGo: c0.letGo, putDowns: c0.putDowns});
        expect(h.toasts).toEqual([]);
        expect(h.inputOwners.some(f => f())).toBe(false);
        frame(h);
        expect(eq.prompt).toBe(line);
        // the hold, frame by frame (1/64 s frames: the hold time is met exactly on frame 32)
        h.rings.length = 0;
        h.keys.held.add('KeyE');
        h.keys.hits.add('KeyE');
        for (let i = 1; i <= 31; i++) {
          frame(h, 1 / 64);
          expect([w.got(), eq.eHold.pending], `frame ${i}`).toEqual([false, true]);
        }
        expect(eq.holdProgress).toBeCloseTo(31 / 32, 9);
        expect(eq.prompt).toBe(carry ? EQUIPMENT_TEXT.holding(def.the) : EQUIPMENT_TEXT.grabbing(def.the));
        expect(h.inputOwners.some(f => f())).toBe(true);
        expect(eq.state().hold).toMatchObject({uid: 'eq-1', t: 0.4844});
        frame(h, 1 / 64);
        expect(w.got()).toBe(true);
        expect([eq.eHold.pending, eq.holdProgress, eq.state().hold]).toEqual([false, null, null]);
        expect(eq.counts.holds).toBe(c0.holds + 1);
        const shown = h.rings.filter((v): v is number => v !== null);
        expect(h.rings).toHaveLength(32);
        expect(shown).toHaveLength(25);
        expect(shown.every((v, i) => v >= HOLD_RING_DELAY_S / DRAG_HOLD_S && v < 1 && (i === 0 || v > shown[i - 1]))).toBe(true);
        expect(h.rings[31]).toBeNull();
        // E kept down, then released: it stays in the hands (releasing E is not the stop action)
        run(h, 0.4);
        h.keys.held.delete('KeyE');
        run(h, 0.4);
        expect(w.got()).toBe(true);
        expect(h.rings).toHaveLength(32);
        expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(carry ? EQUIPMENT_TEXT.putDown(def.the) : EQUIPMENT_TEXT.letGo(def.the));
        // the usual stop: E again — and that key, kept down, starts nothing new
        h.keys.held.add('KeyE');
        h.keys.hits.add('KeyE');
        frame(h);
        expect([w.got(), u.mode]).toEqual([false, 'world']);
        run(h, HOLD_E_S + 0.2);
        expect([w.got(), eq.eHold.pending]).toEqual([false, false]);
        keyUp(h);
        expect(eq.counts).toMatchObject(carry ? {pickups: c0.pickups + 1, putDowns: c0.putDowns + 1, grabs: 0} : {grabs: c0.grabs + 1, letGo: c0.letGo + 1, pickups: 0});
        w.reset();
      }
    });
  }

  it('a registered use is the TAP for any aimed part, on the release — its line + the hold hint; a false answer does nothing; a hold never asks it (every kind)', () => {
    for (const kind of EQUIPMENT_KINDS) {
      const w = world(kind), {h, eq} = w, hint = w.carry ? EQUIPMENT_TEXT.carryHint : EQUIPMENT_TEXT.dragHint;
      const calls: string[] = [];
      let answer = true;
      (eq.uses as Record<string, EquipmentUse>)[kind] = {prompt: x => `<b>[E]</b> Use ${x.uid}`, tap: x => { calls.push(x.uid); return answer; }};
      for (const side of w.sides) {
        calls.length = 0;
        answer = true;
        side();
        expect(eq.prompt, kind).toBe(`<b>[E]</b> Use eq-1${hint}`);
        keyDown(h);
        run(h, 0.2);
        expect(calls, kind).toEqual([]); // nothing on the press
        keyUp(h);
        expect(calls, kind).toEqual(['eq-1']);
        expect([eq.grab, eq.held], kind).toEqual([null, null]);
        answer = false;
        tapE(h);
        expect(calls, kind).toEqual(['eq-1', 'eq-1']);
        expect([eq.grab, eq.held, h.toasts], kind).toEqual([null, null, []]);
        holdE(h);
        expect(calls, kind).toHaveLength(2);
        expect(w.got(), kind).toBe(true);
        w.reset();
      }
    }
  });
});

describe('train equipment: an unfinished hold is dropped', () => {
  for (const kind of [dollyKinds[0], carryKinds[0]]) {
    it(`${EQUIPMENT[kind].name}: no drag / carry, no tap, the ring cleared, E still down does nothing — on the aim / range / input / state changes; another part and an owner already active do not drop it`, () => {
      const other = dollyKinds[dollyKinds.length - 1];
      const w = world(kind, [stationRec(other, 2, 4.55, 0, 3)]), {h, eq, u} = w, u2 = eq.unit('eq-2')!;
      let taps = 0;
      (eq.uses as Record<string, EquipmentUse>)[kind] = {prompt: () => null, tap: () => { taps++; return true; }};
      let owner = false;
      h.inputOwners.push(() => owner);
      const climb = (on: boolean) => {
        if (on) Object.defineProperty(h.player, 'climbing', {value: true, configurable: true});
        else delete (h.player as unknown as {climbing?: boolean}).climbing;
      };
      const setState = (s: string) => { const prev = h.state; (h as {state: string}).state = s; for (const f of h.stateListeners) (f as (a: string, p: string) => void)(s, prev as string); };
      const drops: [string, () => void, (() => void)?][] = [
        ['the aim leaves the unit', () => { h.player.yaw += 1.5; }],
        ['the aim moves to another unit', () => { lookFront(h, u2); expect(eq.pickAim()?.unit).toBe(u2); }],
        ['out of reach (the same aim, from too far)', () => { stand(h, w.b.x, w.b.z + 1.2 + EQUIP.useReach, 0, 0); lookFront(h, u); expect(eq.pickAim()).toBeNull(); }],
        ['the keys are wiped', () => { h.keys.clears++; }],
        ['a menu', () => setState('paused'), () => setState('playing')],
        ['death', () => { h.player.alive = false; }, () => { h.player.alive = true; }],
        ['a ladder', () => climb(true), () => climb(false)],
        ['another input owner becomes active', () => { owner = true; }, () => { owner = false; }],
      ];
      for (const [what, drop, undo] of drops) {
        w.reset();
        u2.body.x = 4.55; u2.body.z = 3; u2.body.yaw = 0; u2.body.vx = u2.body.vz = 0;
        w.front();
        h.rings.length = 0;
        const c0 = {...eq.counts};
        keyDown(h);
        run(h, 0.25);
        expect(eq.eHold.pending, what).toBe(true);
        expect(h.rings.some(v => v !== null), what).toBe(true);
        drop();
        frame(h);
        expect([eq.eHold.pending, w.got(), eq.holdProgress], what).toEqual([false, false, null]);
        expect(h.rings[h.rings.length - 1], what).toBeNull();
        run(h, HOLD_E_S); // E still down: nothing starts by itself
        expect([eq.eHold.pending, w.got()], what).toEqual([false, false]);
        keyUp(h); // … and the late release is no tap
        undo?.();
        expect(eq.counts, what).toMatchObject({grabs: c0.grabs, pickups: c0.pickups, holds: c0.holds, taps: c0.taps});
        expect([taps, h.toasts], what).toEqual([0, []]);
      }
      // what does NOT drop it: an owner that was already active at the press of a hand truck's E (a chest needs free hands: refused)
      w.reset();
      w.front();
      owner = true;
      holdE(h);
      if (w.carry) expect([w.got(), h.toasts]).toEqual([false, [EQUIPMENT_TEXT.handsFull]]);
      else expect(w.got()).toBe(true);
      owner = false;
      h.toasts.length = 0;
      // … nor the crosshair sliding onto another PART of the same unit (the console face -> the module's top, above the face band)
      if (!w.carry) {
        w.reset();
        w.front();
        const B = equipmentBox(u.def), part0 = eq.aim?.part;
        keyDown(h);
        run(h, 0.2);
        lookAtUnit(h, u, 0, B.body.y1 - 0.01, B.body.z + B.body.hd);
        expect(eq.pickAim()?.unit).toBe(u);
        if (B.face && B.body.y1 - 0.01 > B.face.y1 + 0.03) expect([part0, eq.pickAim()?.part]).toEqual(['module', 'frame']);
        run(h, HOLD_E_S);
        expect(w.got()).toBe(true);
        keyUp(h);
      }
      expect(taps).toBe(0);
      // the world goes while E is held: dropped with it
      w.reset();
      w.front();
      keyDown(h);
      run(h, 0.2);
      expect(eq.eHold.pending).toBe(true);
      teardown(h);
      expect([eq.eHold.pending, w.got()]).toEqual([false, false]);
      expect(h.rings[h.rings.length - 1]).toBeNull();
    });
  }

  it('the train pulling out drops it: the unit rides as cargo, never in the hands', async () => {
    const s = equipStation(SUBWAY());
    live.push(s.rt);
    const {h, eq, ride} = s;
    loadAboard(h, [aboardRec(dollyKinds[0], 1, -2.2, 0.3, Math.PI / 2), aboardRec(carryKinds[0], 2, -4.4, 0.2, Math.PI / 2)]);
    run(h, 0.3);
    for (const uid of ['eq-1', 'eq-2']) {
      const u = eq.unit(uid)!, b = u.body;
      stand(h, b.x + Math.sin(b.yaw) * 1.2, b.z + Math.cos(b.yaw) * 1.2, 0, b.y);
      frame(h);
      lookFront(h, u);
      keyDown(h);
      run(h, 0.2);
      expect(eq.eHold.target?.unit, uid).toBe(u);
      void ride.depart();
      frame(h);
      frame(h);
      expect(ride.riding, uid).toBe(true);
      expect([eq.eHold.pending, eq.grab, eq.held], uid).toEqual([false, null, null]);
      expect(eq.units().map(x => x.mode), uid).toEqual(['cargo', 'cargo']);
      run(h, HOLD_E_S);
      expect([eq.eHold.pending, eq.grab, eq.held], uid).toEqual([false, null, null]);
      keyUp(h);
      ride.reset();
      await Promise.resolve();
      run(h, 0.3);
      expect(eq.units().map(x => x.mode), uid).toEqual(['world', 'world']);
    }
  });
});

describe('train equipment: the copy and the one mechanism', () => {
  it('the lines: "Hold [E]" to drag / carry, the hint after a use\'s tap line, "Grabbing… / Picking up…" while held, [R] on the let-go line', () => {
    expect(EQUIP_HOLD_S).toBe(DRAG_HOLD_S);
    expect(EQUIPMENT_TEXT.drag('the radar', EQUIPMENT_TEXT.plugHint)).toBe('<b>Hold [E]</b> Drag the radar · roll it to a free plug');
    expect(EQUIPMENT_TEXT.drag('the radar', EQUIPMENT_TEXT.pluggedNote)).toBe('<b>Hold [E]</b> Drag the radar · plugged in');
    expect(EQUIPMENT_TEXT.carry('the chest')).toBe('<b>Hold [E]</b> Carry the chest');
    expect(EQUIPMENT_TEXT.grabbing('the radar')).toBe('<b>Hold [E]</b> Grabbing the radar…');
    expect(EQUIPMENT_TEXT.holding('the chest')).toBe('<b>Hold [E]</b> Picking up the chest…');
    expect(EQUIPMENT_TEXT.letGo('the radar')).toBe('<b>[E]</b> Let go of the radar · <b>[R]</b> Turn it around');
    expect(EQUIPMENT_TEXT.putDown('the chest')).toBe('<b>[E]</b> Put down the chest');
    expect(EQUIPMENT_TEXT.dragHint).toBe(' · hold <b>[E]</b> to drag it');
    expect(EQUIPMENT_TEXT.carryHint).toBe(' · hold <b>[E]</b> to carry it');
    // the storage chest's whole line is what it was: its store's tap line + the system's hint
    expect(CHEST_STORE_TEXT.prompt(3, 50) + EQUIPMENT_TEXT.carryHint).toBe('<b>[E]</b> Open the storage chest (3/50) · hold <b>[E]</b> to carry it');
    // the fuel cart speaks the same way
    expect(CART_TEXT.drag('2 tanks', '')).toBe('<b>Hold [E]</b> Drag the fuel cart · 2 tanks');
    expect(CART_TEXT.grabbing).toBe('<b>Hold [E]</b> Grabbing the fuel cart…');
    expect(CART_TEXT.dragHint).toBe(EQUIPMENT_TEXT.dragHint);
  });

  it('one gesture for every draggable: both systems own a HoldGesture and no hold clock of their own; a use has no hold', () => {
    const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    const code = (f: string) => read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\/\/.*$/, '')).join('\n');
    for (const f of ['world/fuelCarts.ts', 'world/trainEquipment.ts']) {
      const src = code(f);
      expect(src, f).toMatch(/import \{HoldGesture, foreignOwners\} from '\.\.\/core\/holdGesture'/);
      expect(src.match(/new HoldGesture</g), f).toHaveLength(1);
      expect(src, f).not.toMatch(/EQUIP_HOLD_S|DRAG_HOLD_S|BAG_HOLD_S/); // (the time lives in the gesture)
      expect(src, f).not.toMatch(/eHold\.t\s*[-+]?=[^=]/); // the gesture's clock is the gesture's alone
    }
    // the gesture itself knows no kind and no system
    const gesture = code('core/holdGesture.ts');
    expect(gesture).not.toMatch(/^import /m);
    for (const k of EQUIPMENT_KINDS) expect(gesture, k).not.toMatch(new RegExp(`['"\`]${k}['"\`]`));
    // the consumers' contract: a prompt line and a tap — the hold is the system's own
    const api = code('craft/equipmentApi.ts');
    const use = api.slice(api.indexOf('export interface EquipmentUse'));
    expect(use.slice(0, use.indexOf('\n}'))).not.toMatch(/\bhold\b/);
  });
});
