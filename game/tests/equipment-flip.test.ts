// Task train-interaction-ux-20261112-063646 (lane DRAG; user: "While dragging equipment, R flips its facing 180 degrees so it faces
// the player instead of away, allowing placement flush to walls. Keep the player facing unchanged; retain the placed orientation and
// normal collision, cargo and docking behavior."): R WHILE A DEVICE IS DRAGGED (world/trainEquipment.ts grab.flip) with the real
// Player body, for every 'dolly' kind the registry holds at run time (no kind is named):
//  - R turns the dragged device round: its front swings to FACE the player at the dolly's own turn rate (never a snap), the player's
//    place and view are untouched, the body stays at the hand point; R again turns it back; it follows the walk and the steering
//    turned round; R does nothing with no drag (not grabbed, a pending hold, a carried chest) and Game keeps R from reloading then;
//  - THE SAME BODY: dragged into a wall and along it, a turned device is where the unturned one is, frame for frame — only its facing
//    differs; set down, its back stands flush to the wall and its console face is usable from the room;
//  - a grab STARTS with the turn nearest to how the unit stands: from behind it is the dolly as ever (not turned), from its console
//    side it stays facing the player — it never swings round by itself;
//  - the placed orientation is KEPT: set down turned round beside a socket it plugs in as ever, rides as cargo, is recorded, restored
//    (a Retry) and reloaded (a save) with that facing — and nothing new is saved;
//  - the drawn pose on a stair (pure, world/fuelCartPhysics.ts cartRestPose `front`): held from its front a body is tilted toward the
//    handler there — the mirror of the handle's rule; free / flat poses are what they were.
import {afterEach, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {levelsOf} from '../src/gen/levels';
import {trainToWorld} from '../src/gen/playerTrain';
import {EQUIPMENT, EQUIPMENT_KINDS, trainEquipmentProblem, type EquipmentKind} from '../src/craft/equipment';
import {equipmentPlugs} from '../src/craft/trainFixtures';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {CART, cartRestPose, flightAt, wrapYaw, type CartBody} from '../src/world/fuelCartPhysics';
import {CART_LOOK} from '../src/world/fuelCartModel';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {EQUIP, EQUIPMENT_TEXT, type LiveUnit} from '../src/world/trainEquipment';
import {equipmentBox} from '../src/world/trainEquipmentModel';
import {DT, flatRoom, frame, press, run} from './helpers/fuelCartsHost';
import {aboardRec, equipRoom, equipStation, holdE, loadAboard, lookAtUnit, plugSpot, stand, stationRec, type EquipTestHost} from './helpers/trainEquipmentHost';

installCanvasShim(false);

let subway: StationLayout | null = null;
const SUBWAY = () => (subway ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

const HANDLE = CART_LOOK.handle;
const WALL = 0.5; // the flat room's inner wall face at x = 0.5
const dollyKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].move === 'dolly');
const carryKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].move === 'carry');
const LIGHT = [...dollyKinds].sort((a, b) => EQUIPMENT[a].kg - EQUIPMENT[b].kg)[0];

/** +1: the unit's front points straight at the player; -1: straight away. */
const facing = (h: EquipTestHost, u: LiveUnit): number => {
  const b = u.body, dx = h.player.x - b.x, dz = h.player.z - b.z;
  return (Math.sin(b.yaw) * dx + Math.cos(b.yaw) * dz) / Math.hypot(dx, dz);
};

/** Turn the view onto a unit's front (its console face / its latches) — no frame. */
function lookFront(h: EquipTestHost, u: LiveUnit): void {
  const K = equipmentBox(u.def);
  lookAtUnit(h, u, K.body.x, K.face ? K.face.y0 + (K.face.y1 - K.face.y0) * 0.7 : K.body.y1 - 0.03, K.face ? K.body.z + K.body.hd : K.body.hd * 0.5);
}

/** The flat room, a unit of `kind` (eq-1) at a pose (default (3.5, 3) facing +Z). */
function world(kind: EquipmentKind, at: {x: number; z: number; yaw: number} = {x: 3.5, z: 3, yaw: 0}) {
  const s = equipRoom(flatRoom(), null, {here: [stationRec(kind, 1, at.x, 0, at.z, at.yaw)]});
  const {h, eq} = s, u = eq.unit('eq-1')!, b = u.body;
  /** `dist` behind its handle / in front of its front, looking at it. */
  const back = (dist = 1.2) => { stand(h, b.x - Math.sin(b.yaw) * dist, b.z - Math.cos(b.yaw) * dist, 0, 0); frame(h); lookAtUnit(h, u, 0, HANDLE.y, HANDLE.z); frame(h); };
  const front = (dist = 1.2) => { stand(h, b.x + Math.sin(b.yaw) * dist, b.z + Math.cos(b.yaw) * dist, 0, 0); frame(h); lookFront(h, u); frame(h); };
  /** The hand point the grabbed unit is held at. */
  const hand = () => ({x: h.player.x - Math.sin(h.player.yaw) * EQUIP.hold, z: h.player.z - Math.cos(h.player.yaw) * EQUIP.hold});
  const offHand = () => { const T = hand(); return Math.hypot(b.x - T.x, b.z - T.z); };
  return {...s, u, b, back, front, offHand};
}

describe('R while a device is dragged turns it round', () => {
  for (const kind of dollyKinds) {
    it(`${EQUIPMENT[kind].name}: its front swings to face the player at the dolly's turn rate; the player's place and view are untouched; R again turns it back; it follows the walk turned round`, () => {
      const w = world(kind), {h, eq, u, b} = w, P = h.player;
      w.back();
      holdE(h);
      expect([eq.grab?.unit === u, eq.grab?.flip, eq.dragging]).toEqual([true, false, true]);
      expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(`<b>[E]</b> Let go of ${u.def.the} · <b>[R]</b> Turn it around`);
      P.pitch = 0;
      run(h, 1.5);
      expect(facing(h, u)).toBeLessThan(-0.99999); // the dolly as ever: its front away from the player
      expect(w.offHand()).toBeLessThan(0.005);
      expect(u.poseSide).toBe(1);
      const view = [P.yaw, P.pitch], place = [P.x, P.z], yaw0 = b.yaw;
      // R: turned round — eased, never a snap
      press(h, 'KeyR');
      expect([eq.grab?.flip, eq.counts.flips]).toEqual([true, 1]);
      expect(eq.state().grab).toEqual({uid: 'eq-1', lag: 0, flip: true});
      let turned = Math.abs(wrapYaw(b.yaw - yaw0));
      expect(turned).toBeGreaterThan(0);
      expect(turned).toBeLessThanOrEqual(CART.grab.turnRate * DT + 1e-9);
      let steady = true, frames = 1;
      run(h, 1.5, () => {
        const t = Math.abs(wrapYaw(b.yaw - yaw0));
        if (t < turned - 1e-9 || t - turned > CART.grab.turnRate * DT + 1e-9) steady = false;
        if (t > turned + 1e-9) frames++;
        turned = t;
        return false;
      });
      expect(steady).toBe(true); // one way round, a step of the turn rate at most per frame
      expect(frames).toBeGreaterThanOrEqual(Math.floor(Math.PI / (CART.grab.turnRate * DT)));
      expect(facing(h, u)).toBeGreaterThan(0.99999); // its front faces the player
      expect(u.poseSide).toBe(-1); // (held from its front now: the drawn pose's side)
      // the player: not turned, not moved; the body: still at the hand point; an input owner as before
      expect([P.yaw, P.pitch]).toEqual(view);
      expect(Math.hypot(P.x - place[0], P.z - place[1])).toBeLessThan(1e-9);
      expect(w.offHand()).toBeLessThan(0.005);
      expect(h.inputOwners.some(f => f())).toBe(true);
      // walking and steering: it stays in front of the player, still turned round
      h.keys.held.add('KeyW');
      run(h, 0.8);
      P.yaw += 0.9;
      run(h, 0.6);
      h.keys.held.clear();
      run(h, 1.2);
      expect(eq.grab?.unit === u).toBe(true);
      expect(Math.hypot(P.x - place[0], P.z - place[1])).toBeGreaterThan(0.6);
      expect(w.offHand()).toBeLessThan(0.02);
      expect(facing(h, u)).toBeGreaterThan(0.9999);
      // R again: back to the handle's way
      press(h, 'KeyR');
      run(h, 1.5);
      expect([eq.grab?.flip, eq.counts.flips]).toEqual([false, 2]);
      expect(facing(h, u)).toBeLessThan(-0.99999);
      expect(u.poseSide).toBe(1);
      // let go: it keeps the way it stands; R is nothing's now
      press(h, 'KeyR');
      run(h, 1.5);
      press(h, 'KeyE');
      expect([eq.grab, eq.dragging]).toEqual([null, false]);
      const yaw = b.yaw;
      run(h, 1.5);
      press(h, 'KeyR');
      run(h, 0.5);
      expect(b.yaw).toBe(yaw);
      expect([eq.counts.flips, u.awake, u.poseSide]).toEqual([3, false, 0]);
      expect(facing(h, u)).toBeGreaterThan(0.99); // (set down turned round: it still faces where the player stood)
      // … and that is what the station's record of it says (a wrapped, recordable angle)
      const rec = eq.stationRecords()[0];
      expect(Math.abs(rec.yaw)).toBeLessThanOrEqual(Math.PI);
      expect(Math.cos(rec.yaw - yaw)).toBeGreaterThan(1 - 1e-7);
    });
  }

  it('R is the drag\'s only: with nothing dragged, during a pending hold and with a chest in the hands nothing turns; Game keeps R from reloading exactly while a device is dragged', () => {
    const w = world(LIGHT), {h, eq, b} = w;
    w.back();
    press(h, 'KeyR');
    expect([eq.counts.flips, eq.dragging, b.yaw]).toEqual([0, false, 0]);
    // a pending hold is not a drag yet
    h.keys.held.add('KeyE');
    h.keys.hits.add('KeyE');
    frame(h);
    press(h, 'KeyR');
    expect([eq.eHold.pending, eq.counts.flips, eq.dragging]).toEqual([true, 0, false]);
    run(h, 0.6);
    h.keys.held.clear();
    expect([eq.dragging, eq.grab?.flip]).toEqual([true, false]); // (the R before the drag started did not turn it)
    press(h, 'KeyE');
    expect(eq.dragging).toBe(false);
    // a carried chest is not turned (it is put down facing its carrier, as ever)
    const c = world(carryKinds[0]);
    c.front();
    holdE(c.h);
    expect([c.eq.held === c.u, c.eq.carrying, c.eq.dragging]).toEqual([true, true, false]);
    press(c.h, 'KeyR');
    expect([c.eq.counts.flips, c.eq.grab]).toEqual([0, null]);
    // Game.update: R reloads unless a chest is carried / a device is dragged / a body is carried / the car is driven
    const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/reload: inp\.hit\('KeyR'\)[^\n]*!this\.trainEquipment\?\.carrying && !this\.trainEquipment\?\.dragging && !this\.corpses\?\.carrying,/);
  });
});

describe('a turned device is the same body: collision, the wall, the grab', () => {
  it('dragged into a wall and along it, a turned device is where the unturned one is, frame for frame — only its facing differs; set down, its back is flush to the wall and its console is usable from the room', () => {
    type Out = ReturnType<typeof world> & {trace: number[][]; flushX: number};
    const script = (turn: boolean): Out => {
      // the unit 1.5 m from the -x wall, its front toward the wall; the player on the room side, behind its handle
      const w = world(LIGHT, {x: 2.0, z: 3, yaw: -Math.PI / 2}), {h, eq, u, b} = w, P = h.player, trace: number[][] = [];
      const snap = () => { trace.push([b.x, b.z, b.vx, b.vz, P.x, P.z]); return false; };
      w.back();
      holdE(h);
      expect([eq.grab?.unit === u, eq.grab?.flip]).toEqual([true, false]);
      P.pitch = 0;
      if (turn) press(h, 'KeyR'); else frame(h);
      snap();
      h.keys.held.add('KeyW');
      run(h, 2.5, snap); // into the wall
      const flushX = b.x, z0 = b.z;
      h.keys.held.clear();
      h.keys.held.add('KeyD');
      run(h, 0.8, snap); // along it (a side step: the hand point runs along the wall)
      h.keys.held.clear();
      run(h, 1.5, snap);
      expect(Math.abs(b.z - z0)).toBeGreaterThan(0.5);
      press(h, 'KeyE');
      snap();
      run(h, 1.5, snap);
      return {...w, trace, flushX};
    };
    const plain = script(false), turned = script(true);
    expect(turned.trace).toEqual(plain.trace); // the same collision, the same motion: the turn is the facing only
    for (const w of [plain, turned]) {
      const r = w.u.def.radius;
      expect(w.flushX).toBeGreaterThanOrEqual(WALL + r - 1e-6); // never into the wall
      expect(w.flushX).toBeLessThan(WALL + r + 0.03); // flush to it
      expect(w.b.x).toBeLessThan(WALL + r + 0.03);
      expect([w.eq.grab, w.u.awake]).toEqual([null, false]);
    }
    // the facing: the unturned one shows the room its handle; the turned one its console face
    expect(Math.sin(plain.b.yaw)).toBeLessThan(-0.9);
    expect(Math.sin(turned.b.yaw)).toBeGreaterThan(0.9);
    expect(facing(turned.h, turned.u)).toBeGreaterThan(0.99);
    expect(facing(plain.h, plain.u)).toBeLessThan(-0.99);
    // from the room: the turned device's console face is under the crosshair (its use, were one registered); the other one's is not
    turned.front(1.15);
    expect(turned.eq.aim?.unit === turned.u).toBe(true);
    if (equipmentBox(turned.u.def).face) expect(turned.eq.aim?.part).toBe('module');
    stand(plain.h, plain.b.x + 1.15, plain.b.z, 0, 0);
    frame(plain.h);
    lookAtUnit(plain.h, plain.u, 0, HANDLE.y, HANDLE.z);
    frame(plain.h);
    expect([plain.eq.aim?.unit === plain.u, plain.eq.aim?.part]).toEqual([true, 'frame']);
  });

  it('a grab starts with the turn nearest to how the unit stands: from behind the dolly as ever, from its console side it stays facing the player — it never swings round by itself', () => {
    // from behind: not turned, and it never turns at all (the old grab, bit for bit)
    const a = world(LIGHT);
    a.back();
    holdE(a.h);
    expect(a.eq.state().grab).toEqual({uid: 'eq-1', lag: 0, flip: false});
    let off = 0;
    run(a.h, 1, () => { off = Math.max(off, Math.abs(a.b.yaw)); return false; });
    expect(off).toBeLessThan(1e-12);
    // from its console side: turned from the start — it stays as it stands
    const f = world(LIGHT);
    f.front();
    holdE(f.h);
    expect(f.eq.state().grab).toEqual({uid: 'eq-1', lag: 0, flip: true});
    off = 0;
    run(f.h, 1, () => { off = Math.max(off, Math.abs(wrapYaw(f.b.yaw))); return false; });
    expect(off).toBeLessThan(1e-9);
    expect(facing(f.h, f.u)).toBeGreaterThan(0.99999);
    // set down and grabbed again from the same side: still no swing; R then turns it the handle's way
    press(f.h, 'KeyE');
    run(f.h, 1);
    f.front();
    holdE(f.h);
    expect(f.eq.grab?.flip).toBe(true);
    run(f.h, 0.5);
    expect(Math.abs(wrapYaw(f.b.yaw))).toBeLessThan(1e-9);
    press(f.h, 'KeyR');
    run(f.h, 1.5);
    expect(f.eq.grab?.flip).toBe(false);
    expect(facing(f.h, f.u)).toBeLessThan(-0.99999);
    // either side of a quarter turn: the nearer of the two
    for (const [yaw, flip] of [[1.2, false], [-1.2, false], [2.0, true], [-2.0, true]] as [number, boolean][]) {
      const w = world(LIGHT, {x: 3.5, z: 3, yaw});
      stand(w.h, 3.5, 1.8, Math.PI, 0); // (the direction away from this player is yaw 0)
      frame(w.h);
      lookAtUnit(w.h, w.u, 0, HANDLE.y, HANDLE.z);
      holdE(w.h);
      expect(w.eq.grab?.flip, `yaw ${yaw}`).toBe(flip);
      run(w.h, 1.5);
      const want = flip ? 1 : -1;
      expect(facing(w.h, w.u) * want, `yaw ${yaw}`).toBeGreaterThan(0.99999);
    }
  });
});

describe('a turned device keeps the way it was set down', () => {
  it('beside a socket it plugs in as ever, rides as cargo, is recorded, restored (a Retry) and reloaded (a save) with that facing — and nothing new is saved', async () => {
    const s = equipStation(SUBWAY());
    live.push(s.rt);
    const {h, eq, ride} = s, p = h.trainPlacement!;
    const kind = dollyKinds.find(k => EQUIPMENT[k].plug)!;
    const e0 = equipmentPlugs(SPEC)[0], spot = plugSpot(0);
    loadAboard(h, [aboardRec(kind, 1, spot.x, spot.z)]);
    run(h, 0.3);
    const u = eq.unit('eq-1')!, b = u.body;
    expect(u.plug).toBe(0);
    const keys = Object.keys(eq.aboard()[0]).sort();
    // the player on the aisle side at the grab's own distance, the unit between them and the wall socket, its front to the wall
    const at = trainToWorld(p, spot.x, SPEC.floorY, spot.z - e0.side * EQUIP.hold);
    b.yaw = Math.atan2(b.x - at.x, b.z - at.z);
    stand(h, at.x, at.z, 0, p.floorY);
    frame(h);
    lookAtUnit(h, u, 0, HANDLE.y, HANDLE.z);
    holdE(h);
    expect([eq.grab?.unit === u, eq.grab?.flip, u.plug]).toEqual([true, false, null]); // (a grab unplugs, as ever)
    press(h, 'KeyR');
    run(h, 1.5);
    expect(facing(h, u)).toBeGreaterThan(0.99999); // its console to the car, its back to the wall
    h.toasts.length = 0;
    press(h, 'KeyE');
    expect(eq.grab).toBeNull();
    const yaw = b.yaw, same = (a: number) => Math.cos(a - yaw);
    run(h, 1.5);
    expect(b.yaw).toBe(yaw);
    // docking: at rest in reach of the free socket it plugs in, turned round or not
    expect(u.plug).toBe(0);
    expect(h.toasts).toContain(EQUIPMENT_TEXT.pluggedIn(u.def.name));
    expect(eq.active(kind) === u).toBe(true);
    // the record: the same fields as before, the turned yaw (train-local, wrapped), valid
    const rec = eq.aboard()[0];
    expect(Object.keys(rec).sort()).toEqual(keys);
    expect(rec).toMatchObject({uid: 'eq-1', kind, plug: 0});
    expect(Math.abs(rec.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(same(rec.yaw + p.yaw)).toBeGreaterThan(1 - 1e-7);
    expect(trainEquipmentProblem(h.playerTrain.equipment.toJSON())).toBeNull();
    // cargo: it rides with that facing and comes back with it, still plugged
    void ride.depart();
    frame(h);
    frame(h);
    expect([ride.riding, u.mode, u.plug]).toEqual([true, 'cargo', 0]);
    expect(same(u.local.yaw + p.yaw)).toBeGreaterThan(1 - 1e-12);
    expect(eq.aboard()[0]).toMatchObject({uid: 'eq-1', plug: 0});
    expect(Math.cos(eq.aboard()[0].yaw - rec.yaw)).toBeGreaterThan(1 - 1e-7);
    ride.reset();
    await Promise.resolve();
    run(h, 0.3);
    expect([u.mode, u.plug]).toEqual(['world', 0]);
    expect(same(b.yaw)).toBeGreaterThan(1 - 1e-12);
    // a Retry: the records win — another unit object, the same facing, plugged again
    eq.restore(eq.aboard());
    run(h, 0.3);
    const v = eq.unit('eq-1')!;
    expect(v === u).toBe(false);
    expect(same(v.body.yaw)).toBeGreaterThan(1 - 1e-7);
    expect(v.plug).toBe(0);
    // a save and its load: the text round trip
    const saved = JSON.parse(JSON.stringify(h.playerTrain.equipment.toJSON())) as ReturnType<typeof h.playerTrain.equipment.toJSON>;
    expect(trainEquipmentProblem(saved)).toBeNull();
    expect(saved.aboard[0]).toMatchObject({uid: 'eq-1', kind, plug: 0});
    expect(Object.keys(saved.aboard[0]).sort()).toEqual(keys);
    expect(Math.cos(saved.aboard[0].yaw - rec.yaw)).toBeGreaterThan(1 - 1e-7);
    h.playerTrain.equipment.load(saved);
    run(h, 0.3);
    const x = eq.unit('eq-1')!;
    expect(same(x.body.yaw)).toBeGreaterThan(1 - 1e-7);
    expect(x.plug).toBe(0);
    expect(eq.units()).toHaveLength(1);
  });
});

describe('the drawn pose of a held body on a stair (pure)', () => {
  it('held from its FRONT a body is tilted toward the handler there — the mirror of the handle\'s rule; free and flat poses are what they were', () => {
    const L = SUBWAY(), levels = levelsOf(L), f = L.traversal.stairs[0];
    const slope = Math.atan(f.riser / f.tread), x = (f.s0 + f.s1) / 2, z = (f.a0 + f.a1) / 2, dirX = Math.sign(f.s1 - f.s0) * Math.sign(f.h1 - f.h0);
    const y = levels.supportIn(x, z, (f.h0 + f.h1) / 2, 0.5)!.floor;
    expect(flightAt(levels, x, z, y)).not.toBeNull();
    const body = (yaw: number): CartBody => ({x, y, z, yaw, vx: 0, vz: 0, level: 0, units: 0});
    const up = dirX > 0 ? Math.PI / 2 : -Math.PI / 2, down = -up, d = CART.radius * CART.rim;
    const pose = (yaw: number, held = false, front = false) => ({...cartRestPose(levels, body(yaw), undefined, held, front)});
    const lying = f.riser / 2, carried = f.riser / 2 + 2 * d * Math.tan(slope);
    // free: lying on the steps with the slope, whichever flag is passed
    expect(pose(up).pitch).toBeCloseTo(slope, 6);
    expect(pose(down).pitch).toBeCloseTo(-slope, 6);
    expect(pose(up, false, true)).toEqual(pose(up));
    expect(pose(down, false, true)).toEqual(pose(down));
    // held by the handle (from behind): never nose-down — the rule as it always was
    expect(pose(up, true)).toEqual(pose(up));
    expect(pose(down, true).pitch).toBeCloseTo(slope, 6);
    expect(pose(down, true).dy).toBeCloseTo(carried, 6);
    // held from its front (turned round): never tail-down — the mirror
    expect(pose(down, true, true)).toEqual(pose(down));
    expect(pose(up, true, true).pitch).toBeCloseTo(-slope, 6);
    expect(pose(up, true, true).dy).toBeCloseTo(carried, 6);
    expect(pose(up, true, true).dy).toBeCloseTo(pose(down, true).dy, 9);
    expect(pose(up, true, true).pitch).toBeCloseTo(-pose(down, true).pitch, 9);
    expect(pose(up).dy).toBeCloseTo(lying, 6);
    // a held body never leans away from the hands, at any heading; the roll and the tilt limit are untouched
    for (let yaw = -3; yaw <= 3; yaw += 0.25) {
      const free = pose(yaw), behind = pose(yaw, true), ahead = pose(yaw, true, true);
      expect(behind.pitch).toBeGreaterThanOrEqual(0);
      expect(ahead.pitch).toBeLessThanOrEqual(0);
      expect(Math.abs(behind.pitch)).toBeCloseTo(Math.abs(free.pitch), 12);
      expect(Math.abs(ahead.pitch)).toBeCloseTo(Math.abs(free.pitch), 12);
      expect([behind.roll, ahead.roll]).toEqual([free.roll, free.roll]);
      expect(Math.min(behind.dy, ahead.dy)).toBeGreaterThanOrEqual(free.dy - 1e-12); // (carried clear: never lower than lying)
    }
    // flat floor: exactly upright, held or not, from either end
    const room = flatRoom(), flat: CartBody = {x: 3, y: 0, z: 3, yaw: 0.7, vx: 0, vz: 0, level: 0, units: 0};
    for (const [held, front] of [[false, false], [true, false], [true, true]]) expect(cartRestPose(room, flat, undefined, held, front)).toEqual({dy: 0, pitch: 0, roll: 0});
  });
});
