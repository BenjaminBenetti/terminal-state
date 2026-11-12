// Task train-interaction-ux-20261112-063646 (lane DRAG; user: "ALL existing draggable items, including equipment and the fuel dolly,
// require HOLDING E to START dragging, with the existing crosshair hold-progress spinner. Quick normal interaction must not
// accidentally start dragging. Releasing E after the drag starts should not drop it; retain the usual stop action. Cancel an
// unfinished hold normally on target/range/input-owner changes."): THE FUEL CART's E (world/fuelCarts.ts over the shared gesture,
// core/holdGesture.ts) with the real Player body in the flat room, and its hose on a generated station with the real parked train:
//  - a TAP of E — one frame or just under the hold time, on the handle or the drum — never drags, and a short one never flashes the ring;
//  - HOLDING E for DRAG_HOLD_S starts the drag: nothing before it, "Grabbing…" and the rising ring meanwhile, an input owner from the
//    press; E released afterwards keeps the drag; the next E lets go (the usual stop) and that key kept down starts nothing;
//  - an unfinished hold is DROPPED (no drag, no tap) when the aim leaves the cart / moves to another cart / goes out of reach, the keys
//    are wiped, a menu opens, the player dies or climbs, another input owner takes over, the world goes; another PART of the same cart
//    and an owner already active at the press do not drop it;
//  - the hose is the TAP: connect / disconnect on the release (their lines carry the hold hint), never a drag; a hold on the drum drags
//    and never connects; the part aimed at the PRESS decides the tap;
//  - the ring is only ever written by a pending gesture, and Game installs the gear system (which writes the ring every frame) first.
// The pure gesture: hold-gesture.test.ts. The equipment: drag-hold-equipment.test.ts.
import {afterEach, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {trainToWorld} from '../src/gen/playerTrain';
import {DRAG_HOLD_S, HOLD_RING_DELAY_S} from '../src/core/holdGesture';
import {FUEL} from '../src/fuel/fuel';
import {fuelPortLocal} from '../src/fuel/trainPort';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {CART_LOOK as K} from '../src/world/fuelCartModel';
import {CART_TEXT} from '../src/world/fuelCarts';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {DT, HOLD_E_S, frame, holdE, lookAt, press, roomHost, run, stationHost, tapE, teardown, type CartTestHost} from './helpers/fuelCartsHost';

installCanvasShim(false);

let subway: StationLayout | null = null;
const SUBWAY = () => (subway ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

type Part = 'handle' | 'drum';
/** E goes down (the press) / comes up again. */
const keyDown = (h: CartTestHost) => { h.keys.held.add('KeyE'); h.keys.hits.add('KeyE'); frame(h); };
const keyUp = (h: CartTestHost) => { h.keys.held.delete('KeyE'); frame(h); };

/** The flat room, a full cart 'c' at (3.5, 3) facing +Z, the player 1.2 m behind its handle. */
function room() {
  const {h, carts} = roomHost();
  carts.spawn({uid: 'c', units: FUEL.cartUnits, x: 3.5, y: 0, z: 3, yaw: 0, level: 0});
  const b = carts.bodyOf('c')!;
  /** Turn the view onto a part of a cart (no frame). */
  const look = (part: Part, of = b) => {
    const z = part === 'handle' ? K.handle.z : K.drumZ, y = part === 'handle' ? K.handle.y : K.drumTop - 0.1;
    lookAt(h, of.x + Math.sin(of.yaw) * z, of.y + y, of.z + Math.cos(of.yaw) * z);
  };
  const aim = (part: Part) => { look(part); frame(h); };
  const behind = () => { h.player.place(b.x - Math.sin(b.yaw) * 1.2, b.z - Math.cos(b.yaw) * 1.2, Math.PI, 0); h.player.vx = h.player.vz = 0; frame(h); };
  /** Everything back where it started: nothing in the hands, the cart on its spot, the player behind it looking at the handle. */
  const reset = () => {
    if (carts.grab) press(h, 'KeyE');
    h.keys.held.clear();
    b.x = 3.5; b.z = 3; b.yaw = 0; b.vx = b.vz = 0;
    behind();
    aim('handle');
  };
  return {h, carts, b, look, aim, behind, reset};
}

describe('fuel cart: a drag starts with a HOLD of E, never a tap', () => {
  it('a tap never drags — on the handle or the drum, one frame or just under the hold time; nothing else happens, and a short tap never flashes the ring', () => {
    const w = room(), {h, carts, b} = w;
    for (const part of ['handle', 'drum'] as const) {
      w.behind();
      w.aim(part);
      expect(carts.aim?.part).toBe(part === 'handle' ? 'frame' : 'drum');
      expect(carts.prompt).toBe('<b>Hold [E]</b> Drag the fuel cart · 2 tanks');
      for (const seconds of [0, 0.05, 0.3, DRAG_HOLD_S - 3 * DT]) {
        h.rings.length = 0;
        if (seconds === 0) tapE(h); else holdE(h, seconds);
        expect([carts.grab, carts.hoseOn, carts.eHold.pending], `${part}, ${seconds} s`).toEqual([null, null, false]);
        if (seconds < HOLD_RING_DELAY_S) expect(h.rings.every(v => v === null), `${part}, ${seconds} s`).toBe(true);
        expect(h.rings[h.rings.length - 1]).toBeNull();
      }
      frame(h);
      expect(carts.prompt).toBe('<b>Hold [E]</b> Drag the fuel cart · 2 tanks'); // (the look-at line is back)
    }
    expect(carts.counts).toMatchObject({grabs: 0, letGo: 0, connects: 0, disconnects: 0, taps: 8});
    expect(h.toasts).toEqual([]);
    expect([b.x, b.z, b.yaw, b.vx, b.vz]).toEqual([3.5, 3, 0, 0, 0]); // it never moved
    expect(h.inputOwners.some(f => f())).toBe(false);
  });

  it('holding E for DRAG_HOLD_S starts the drag: nothing before it, "Grabbing…" + the ring meanwhile, an input owner from the press; E released afterwards keeps it; the next E lets go', () => {
    const w = room(), {h, carts} = w, dt = 1 / 64; // (1/64 s frames: the hold time is met exactly on frame 32)
    w.behind();
    w.aim('handle');
    h.rings.length = 0;
    h.keys.held.add('KeyE');
    h.keys.hits.add('KeyE');
    for (let i = 1; i <= 31; i++) {
      frame(h, dt);
      expect([carts.grab, carts.eHold.pending], `frame ${i}`).toEqual([null, true]);
    }
    expect(carts.holdProgress).toBeCloseTo(31 / 32, 9);
    expect(carts.prompt).toBe('<b>Hold [E]</b> Grabbing the fuel cart…');
    expect(carts.aim).toBeNull();
    expect(h.inputOwners.some(f => f())).toBe(true); // (no shot / ADS / item use from the press on)
    expect(carts.state().hold).toEqual({uid: 'c', part: 'frame', t: 0.4844});
    expect(carts.counts.grabs).toBe(0);
    frame(h, dt);
    expect(carts.grab?.cart.uid).toBe('c');
    expect([carts.eHold.pending, carts.holdProgress, carts.state().hold]).toEqual([false, null, null]);
    // the ring: hidden for the first HOLD_RING_DELAY_S, then rising to just under full, cleared when the drag starts
    expect(h.rings).toHaveLength(32);
    expect(h.rings.slice(0, 6)).toEqual(new Array(6).fill(null));
    const shown = h.rings.filter((v): v is number => v !== null);
    expect(shown).toHaveLength(25);
    expect(shown[0]).toBeCloseTo(7 / 32, 9);
    expect(shown.every((v, i) => v < 1 && (i === 0 || v > shown[i - 1]))).toBe(true);
    expect(h.rings[31]).toBeNull();
    // E still down, then released: the drag stays (releasing E is not the stop action) — and writes no ring
    run(h, 0.4);
    expect(carts.grab?.cart.uid).toBe('c');
    h.keys.held.delete('KeyE');
    run(h, 0.4);
    expect(carts.grab?.cart.uid).toBe('c');
    expect(carts.prompt).toBe('<b>[E]</b> Let go · 2 tanks');
    expect(carts.counts).toMatchObject({grabs: 1, letGo: 0, taps: 0});
    expect(h.rings).toHaveLength(32);
    // the usual stop: E pressed again lets go — and that key, kept down, starts nothing new
    h.keys.held.add('KeyE');
    h.keys.hits.add('KeyE');
    frame(h);
    expect(carts.grab).toBeNull();
    run(h, HOLD_E_S + 0.2);
    expect([carts.grab, carts.eHold.pending]).toEqual([null, false]);
    keyUp(h);
    expect(carts.counts).toMatchObject({grabs: 1, letGo: 1, taps: 0});
    expect(h.inputOwners.some(f => f())).toBe(false);
  });

  it('an unfinished hold is dropped — no drag, no tap, the ring cleared, E still down does nothing — on the aim / range / input / state changes; another part of the cart and an owner already active do not drop it', () => {
    const w = room(), {h, carts, b} = w;
    carts.spawn({uid: 'c2', units: 4, x: 4.6, y: 0, z: 3, yaw: 0, level: 0});
    const b2 = carts.bodyOf('c2')!;
    let owner = false;
    h.inputOwners.push(() => owner);
    const climb = (on: boolean) => {
      if (on) Object.defineProperty(h.player, 'climbing', {value: true, configurable: true});
      else delete (h.player as unknown as {climbing?: boolean}).climbing;
    };
    const setState = (s: string) => { const prev = h.state; (h as {state: string}).state = s; for (const f of h.stateListeners) (f as (a: string, p: string) => void)(s, prev as string); };
    const drops: [string, () => void, (() => void)?][] = [
      ['the aim leaves the cart', () => { h.player.yaw += 1.5; }],
      ['the aim moves to another cart', () => { w.look('handle', b2); expect(carts.pickAim()?.cart.uid).toBe('c2'); }],
      ['out of reach (the same aim, from too far)', () => { h.player.place(b.x, b.z - 2.3, Math.PI, 0); w.look('handle'); expect(carts.pickAim()).toBeNull(); }],
      ['the keys are wiped', () => { h.keys.clears++; }],
      ['a menu', () => setState('paused'), () => setState('playing')],
      ['death', () => { h.player.alive = false; }, () => { h.player.alive = true; }],
      ['a ladder', () => climb(true), () => climb(false)],
      ['another input owner becomes active', () => { owner = true; }, () => { owner = false; }],
    ];
    for (const [what, drop, undo] of drops) {
      w.reset();
      h.rings.length = 0;
      keyDown(h);
      run(h, 0.25);
      expect(carts.eHold.pending, what).toBe(true);
      expect(h.rings.some(v => v !== null), what).toBe(true);
      drop();
      frame(h);
      expect([carts.eHold.pending, carts.grab, carts.holdProgress], what).toEqual([false, null, null]);
      expect(h.rings[h.rings.length - 1], what).toBeNull();
      run(h, HOLD_E_S); // E still down: nothing starts by itself
      expect([carts.eHold.pending, carts.grab], what).toEqual([false, null]);
      keyUp(h); // … and the late release is no tap
      undo?.();
      expect(carts.counts, what).toMatchObject({grabs: 0, letGo: 0, taps: 0, connects: 0});
      expect(h.toasts, what).toEqual([]);
    }
    // what does NOT drop it: the crosshair sliding onto another PART of the same cart; an owner that was already active at the press
    w.reset();
    owner = true;
    keyDown(h);
    run(h, 0.2);
    w.look('drum');
    expect(carts.pickAim()).toMatchObject({part: 'drum'});
    run(h, HOLD_E_S);
    expect(carts.grab?.cart.uid).toBe('c');
    keyUp(h);
    owner = false;
    // the world goes while E is held: dropped with it
    w.reset();
    keyDown(h);
    run(h, 0.2);
    expect(carts.eHold.pending).toBe(true);
    teardown(h);
    expect([carts.eHold.pending, carts.grab]).toEqual([false, null]);
    expect(h.rings[h.rings.length - 1]).toBeNull();
  });

  it('the ring is only ever a pending gesture\'s: carts at rest, aimed at, write none; Game installs the gear system (it writes the ring every frame) before the carts and the equipment', () => {
    const w = room(), {h} = w;
    w.behind();
    w.aim('handle');
    h.rings.length = 0;
    run(h, 1);
    expect(h.rings).toEqual([]);
    // (gear/system.ts sets the ring every frame — null when no bag is held on; a system whose frame hook runs AFTER it has the last
    // word of the frame. The hooks run in install order.)
    const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    const at = (re: RegExp) => { const i = src.search(re); expect(i, String(re)).toBeGreaterThan(0); return i; };
    const gear = at(/this\.gear = installGear\(this\)/);
    expect(at(/this\.fuelCarts = installFuelCarts\(this\)/)).toBeGreaterThan(gear);
    expect(at(/this\.trainEquipment = installTrainEquipment\(this/)).toBeGreaterThan(gear);
  });
});

describe('fuel cart: the hose is the tap, the drag is the hold', () => {
  /** The station, a cart on the platform beside the fuel cap (drum toward the car), the player behind it. */
  function setup() {
    const s = stationHost(SUBWAY());
    live.push(s.rt);
    const {h, carts} = s;
    const p = h.trainPlacement!, cap = fuelPortLocal(SPEC);
    const at = trainToWorld(p, cap.x, SPEC.floorY, -2.5);
    const floor = h.levels!.floorAt(at.x, at.z, p.floorY + 0.3);
    carts.spawn({uid: 'c', units: FUEL.cartUnits, x: at.x, y: floor, z: at.z, yaw: Math.atan2(0, -p.platformSide), level: p.level});
    h.playerTrain.fuel.tank = 0;
    const pw = trainToWorld(p, cap.x, SPEC.floorY, -2.5 - 1.05);
    h.player.place(pw.x, pw.z, 0, floor);
    frame(h);
    const look = (part: Part) => {
      const b = carts.bodyOf('c')!, z = part === 'handle' ? K.handle.z : K.drumZ, y = part === 'handle' ? K.handle.y : K.drumTop - 0.1;
      lookAt(h, b.x + Math.sin(b.yaw) * z, b.y + y, b.z + Math.cos(b.yaw) * z);
    };
    return {...s, look};
  }

  it('E tapped on the drum connects / disconnects on the release (the lines carry the hold hint) and never drags; E held on the drum drags and never connects; the part at the press decides', () => {
    const {h, carts, look} = setup();
    h.toasts.length = 0;
    look('drum');
    frame(h);
    expect(carts.prompt).toMatch(/^<b>\[E\]<\/b> Connect the hose · cart 2 tanks · train tank [^·]+ · hold <b>\[E\]<\/b> to drag it$/);
    // a tap of 0.3 s: nothing on the press, connected on the release, no drag
    keyDown(h);
    run(h, 0.3);
    expect([carts.hoseOn, carts.grab]).toEqual([null, null]);
    expect(carts.prompt).toBe(CART_TEXT.grabbing);
    keyUp(h);
    expect(carts.hoseOn?.cart.uid).toBe('c');
    expect(carts.grab).toBeNull();
    expect(h.toasts).toEqual([CART_TEXT.connected]);
    frame(h);
    expect(carts.prompt).toMatch(/^<b>\[E\]<\/b> Disconnect the hose · fuelling · train tank [^·]+ · hold <b>\[E\]<\/b> to drag it$/);
    // a tap on the connected cart takes the hose off (any part of it) — never a drag
    look('handle');
    tapE(h);
    expect([carts.hoseOn, carts.grab]).toEqual([null, null]);
    expect(h.toasts).toEqual([CART_TEXT.connected, CART_TEXT.disconnected]);
    // a tap on the handle with no hose on: nothing (the hose is the drum's tap)
    tapE(h);
    expect([carts.hoseOn, carts.grab]).toEqual([null, null]);
    expect(h.toasts).toHaveLength(2);
    // the part aimed at the PRESS decides the tap: pressed on the drum, released with the crosshair slid onto the handle -> connected
    look('drum');
    keyDown(h);
    look('handle');
    run(h, 0.1);
    expect(carts.eHold.pending).toBe(true);
    keyUp(h);
    expect(carts.hoseOn?.cart.uid).toBe('c');
    tapE(h);
    expect(carts.hoseOn).toBeNull();
    // E HELD on the drum: the drag — the hose is never connected
    look('drum');
    const connects = carts.counts.connects;
    holdE(h);
    expect(carts.grab?.cart.uid).toBe('c');
    expect([carts.hoseOn, carts.counts.connects]).toEqual([null, connects]);
    press(h, 'KeyE');
    expect(carts.grab).toBeNull();
    // E HELD on a connected cart: the grab takes the hose off (as a grab always did), once
    run(h, 0.5);
    look('drum');
    tapE(h);
    expect(carts.hoseOn?.cart.uid).toBe('c');
    h.toasts.length = 0;
    holdE(h);
    expect([carts.hoseOn, carts.grab?.cart.uid]).toEqual([null, 'c']);
    expect(h.toasts).toEqual([CART_TEXT.disconnected]);
    expect(h.playerTrain.fuel.tank).toBe(0); // (nothing flowed in these short connections)
  });
});
