// Task studio-beta-skyways-vehicle-20261107-054512-01 (lane TRUNK): the Skyways prize car's trunk (world/skywaysCarTrunk.ts) on the car's
// Node host (tests/helpers/skywaysCarHost.ts: the REAL Player, the car installed like Game) with a REAL Inventory: [E] on the boot from
// behind opens it (never from the side / seated / far / through a wall; the doors rule everywhere else), one action per press; the
// view's slots ARE the trunk store; storeQuick / storeMove / storeWornBag keep uids, bags, mags, filters, air, finite counts (nothing
// duplicated or lost); the close rules; persistence through the car's record v2 (teardown -> rebuild, a v1 record -> empty once, uids
// reserved), and a save carrying a trunk validates and restores. The Lockbox's own tests stay as they were (the shared view / store).
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {CAR_RT, CAR_TEXT, type SkywaysCar} from '../src/world/skywaysCar';
import {CAR_SPEC, carToWorld} from '../src/world/skywaysCarSpec';
import {SKYWAYS_CAR_LANE, TRUNK_SLOTS, emptyTrunk, skywaysCarProblem, skywaysCarRecord, type SkywaysCarRecord} from '../src/world/skywaysCarStore';
import {TRUNK_RT, TRUNK_TEXT, TRUNK_VIEW, TrunkSystem, type TrunkHost} from '../src/world/skywaysCarTrunk';
import {Inventory, stacksIn, type SlotRef, type StoreSideRef} from '../src/items/inventory';
import {LOCKBOX_SLOTS, TrainLockbox} from '../src/run/trainLockbox';
import {LOCKBOX_VIEW} from '../src/ui/lockboxView';
import {SOLID} from '../src/gen/grid';
import {validateSaveFile, parseSaveText} from '../src/save/validate';
import {installRestore, prepareRestore, saveFileText} from '../src/save/serialize';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {hallLevels} from './helpers/skywaysCarWorld';
import {build, carHost, frame, lookAt, press, run, teardown, type CarTestHost} from './helpers/skywaysCarHost';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';

const S = CAR_SPEC;
const H = (i: number): SlotRef => ({bar: 'hotbar', index: i});
const P = (i: number): SlotRef => ({bar: 'pack', index: i});
const T = (i: number): StoreSideRef => ({bar: 'store', index: i});

type TrunkTestHost = CarTestHost & {inv: Inventory; hitListeners: ((hit: {amount: number}) => void)[]; qa: boolean};

/** The car's Node host + a real Inventory, the trunk installed after the car (like Game), then the build hooks (car, trunk). */
function trunkHost(o: Parameters<typeof carHost>[0] = {}) {
  const {h, car} = carHost({...o, build: false});
  const t = h as TrunkTestHost;
  t.inv = new Inventory();
  t.hitListeners = [];
  t.qa = true;
  const sys = new TrunkSystem(t as unknown as TrunkHost, car).install();
  if (o.build !== false) build(h);
  return {h: t, car, sys};
}

/** Stand `gap` m behind the tail (car-frame x = dx), look at a car-frame point (default: the middle of the boot deck). */
function behind(h: CarTestHost, car: SkywaysCar, o: {dx?: number; gap?: number; look?: {x: number; y: number; z: number}} = {}): void {
  const b = car.body!, p = carToWorld(b.x, b.z, b.yaw, o.dx ?? 0, S.length / 2 + (o.gap ?? 0.9));
  h.player.place(p.x, p.z, 0, b.y);
  frame(h, car);
  const at = o.look ?? {x: 0, y: 1.0, z: 2.0}, w = carToWorld(b.x, b.z, b.yaw, at.x, at.z);
  lookAt(h, w.x, b.y + at.y, w.z);
  frame(h, car);
}

/** Every stack (bag contents included) in the inventory + the trunk: item totals and the sorted uid list. */
function census(inv: Inventory, store: TrainLockbox) {
  const all = [...inv.allStacks(true), ...store.slots.flatMap(stacksIn)];
  const counts: Record<string, number> = {};
  for (const s of all) counts[s.itemId] = (counts[s.itemId] ?? 0) + s.count;
  return {counts, uids: all.map(s => s.uid).sort((a, c) => a - c)};
}
const unique = (uids: number[]) => new Set(uids).size === uids.length;

/** A kit: a loaded pistol, a gas mask with a part-used filter, an airtank with some air, 9mm, water, a worn backpack with contents. */
function kit(inv: Inventory) {
  const pistol = inv.makeStack('pistol', 1, 7), mask = inv.makeStack('gas_mask', 1), tank = inv.makeStack('airtank_backpack', 1);
  mask.filter = 20.25;
  tank.air = 312.5;
  const ammo = inv.makeStack('ammo_9mm', 50), water = inv.makeStack('water', 3);
  const bag = inv.makeStack('backpack', 1);
  bag.bag![0] = inv.makeStack('bandage', 3);
  bag.bag![2] = inv.makeStack('ammo_9mm', 40);
  inv.set(H(0), pistol);
  inv.set(P(0), mask);
  inv.set(P(1), tank);
  inv.set(P(2), ammo);
  inv.set(P(3), water);
  expect(inv.wearBag(bag)).toBe(true);
  return {pistol, mask, tank, ammo, water, bag};
}

describe('skyways car trunk: opening it (the rear zone from behind) vs the doors', () => {
  it('behind the car, the crosshair on the boot: "Open the trunk" (the car\'s prompt, first) and [E] opens it — one action, the lid cue', () => {
    const {h, car, sys} = trunkHost();
    expect([sys.loaded, sys.store.size, TRUNK_SLOTS]).toEqual([true, 16, 16]);
    behind(h, car);
    expect(sys.standingBehind()).toBe(true);
    expect(car.prompt).toBe(TRUNK_TEXT.open);
    expect(h.promptProviders[0]()).toBe(TRUNK_TEXT.open);
    expect(sys.aimHit()!.t).toBeLessThanOrEqual(TRUNK_RT.reach);
    press(h, car, 'KeyE');
    expect([sys.isOpen, car.driving, car.counts.enters]).toEqual([true, false, 0]);
    expect(h.sfxCalls).toEqual(['door']); // the lid cue (the car door sound), no engine
    expect(h.inputOwners.some(f => f())).toBe(true); // the mouse is the view's
    frame(h, car);
    expect(car.prompt).toBeNull(); // no prompt over the open view
    expect(car.onInteract()).toBe(false); // nothing else happens on the car while it is open (E itself is the view's: below)
    expect(sys.isOpen).toBe(true);
    // the anchor follows the car body (the middle of the boot deck)
    const a = sys.anchor()!, w = carToWorld(car.body!.x, car.body!.z, car.body!.yaw, TRUNK_RT.anchor.x, TRUNK_RT.anchor.z);
    expect([a.x, a.y, a.z]).toEqual([w.x, car.body!.y + TRUNK_RT.anchor.y, w.z]);
  });

  it('unambiguous: the stand zone behind the car never meets a door\'s reach (sampled over the whole zone)', () => {
    const {h, car, sys} = trunkHost();
    const b = car.body!, doors = [S.exits.left, S.exits.right];
    let inZone = 0, nearest = Infinity;
    for (let lx = -2; lx <= 2; lx += 0.02) for (let lz = 1.5; lz <= S.length / 2 + TRUNK_RT.stand + 0.1; lz += 0.02) {
      const w = carToWorld(b.x, b.z, b.yaw, lx, lz);
      h.player.x = w.x; h.player.z = w.z; h.player.y = b.y;
      if (!sys.standingBehind()) continue;
      inZone++;
      nearest = Math.min(nearest, ...doors.map(d => Math.hypot(lx - d.x, lz - d.z)));
    }
    expect(inZone).toBeGreaterThan(1000);
    expect(nearest).toBeGreaterThan(CAR_RT.doorReach + 0.2);
  });

  it('works whatever the car\'s heading (the trunk zone is in the car frame: +Z, the tail)', () => {
    const {h, car, sys} = trunkHost({spawn: {yaw: 2.2}});
    behind(h, car, {dx: 0.4});
    expect(car.prompt).toBe(TRUNK_TEXT.open);
    behind(h, car, {dx: 0.4, gap: -S.length - 1.0}); // the same distance in front of the nose: nothing
    expect(sys.standingBehind()).toBe(false);
    expect(car.prompt).toBeNull();
  });

  it('not the trunk: aiming over the boot, too far behind, beside the car (the doors rule: get in), through a wall', () => {
    const {h, car, sys} = trunkHost();
    behind(h, car, {look: {x: 0, y: 1.3, z: 1.2}}); // over the boot at the rear window / roof
    expect([sys.standingBehind(), sys.aimHit(), car.prompt]).toEqual([true, null, null]);
    expect(car.onInteract()).toBe(false);
    behind(h, car, {gap: TRUNK_RT.stand + 0.3}); // too far back
    expect([sys.standingBehind(), car.prompt]).toEqual([false, null]);
    expect(car.onInteract()).toBe(false);
    // beside the car by the right door, the crosshair on the rear quarter (inside the rear zone): the doors rule — get in
    const b = car.body!, side = carToWorld(b.x, b.z, b.yaw, S.exits.right.x, 0.8), q = carToWorld(b.x, b.z, b.yaw, 0.95, 1.9);
    h.player.place(side.x, side.z, 0, b.y);
    frame(h, car);
    lookAt(h, q.x, b.y + 0.8, q.z);
    frame(h, car);
    expect(sys.aimHit()).not.toBeNull(); // the crosshair IS on the rear zone ...
    expect(sys.standingBehind()).toBe(false); // ... but the player stands beside the car
    expect(car.prompt).toBe(CAR_TEXT.getIn);
    press(h, car, 'KeyE');
    expect([car.driving, sys.isOpen]).toEqual([true, false]); // the doors still get you in
    // a wall between the player and the boot: nothing (and the same spot without the wall opens)
    const L = hallLevels(), g = L.grid(0);
    for (let cx = 24; cx < 36; cx++) g.cells[g.idx(cx, 36)] = SOLID; // z 18.0 .. 18.5, behind the tail (17.39)
    const walled = trunkHost({levels: L});
    behind(walled.h, walled.car, {gap: 1.5});
    expect(walled.sys.standingBehind()).toBe(true);
    expect([walled.sys.aimHit(), walled.car.prompt]).toEqual([null, null]);
    expect(walled.car.onInteract()).toBe(false);
    const open = trunkHost();
    behind(open.h, open.car, {gap: 1.5});
    expect(open.car.prompt).toBe(TRUNK_TEXT.open);
  });

  it('seated: E gets out (never the trunk); refused while another lane owns the hands, using an item, paused, climbing, dead', () => {
    const {h, car, sys} = trunkHost();
    behind(h, car);
    expect(car.prompt).toBe(TRUNK_TEXT.open);
    // in the driver seat (by the left door): the trunk is never offered; E gets out
    const b = car.body!, d = carToWorld(b.x, b.z, b.yaw, S.exits.left.x, S.exits.left.z), door = carToWorld(b.x, b.z, b.yaw, -S.width / 2 + 0.05, S.exits.left.z);
    h.player.place(d.x, d.z, 0, b.y);
    frame(h, car);
    lookAt(h, door.x, b.y + 0.9, door.z);
    frame(h, car);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(true);
    h.player.yaw = b.yaw + 2.5; // looking back over the boot from the seat
    frame(h, car);
    expect([sys.aimed(), sys.open(), car.prompt]).toEqual([false, false, CAR_TEXT.driving]);
    press(h, car, 'KeyE');
    expect([car.driving, sys.isOpen]).toEqual([false, false]);
    run(h, car, 0.2);
    // refusals
    behind(h, car);
    const busy = {on: true};
    h.inputOwners.push(() => busy.on);
    frame(h, car);
    expect([car.prompt, car.onInteract(), sys.isOpen]).toEqual([null, false, false]);
    busy.on = false;
    h.use = {itemId: 'bandage'};
    frame(h, car);
    expect([car.prompt, car.onInteract()]).toEqual([null, false]);
    h.use = null;
    h.state = 'paused';
    expect([car.onInteract(), sys.aimed(), sys.open()]).toEqual([false, false, false]);
    h.state = 'playing';
    Object.defineProperty(h.player, 'climbing', {get: () => true, configurable: true}); // (a getter on Player: on a ladder)
    expect(sys.aimed()).toBe(false);
    delete (h.player as {climbing?: boolean}).climbing;
    expect(h.player.climbing).toBe(false);
    h.player.alive = false;
    expect([sys.aimed(), sys.open()]).toEqual([false, false]);
    h.player.alive = true;
    frame(h, car);
    expect(car.prompt).toBe(TRUNK_TEXT.open);
  });
});

describe('skyways car trunk: the view is the Lockbox view over the trunk store; transfers are the store moves', () => {
  it('the view\'s slots ARE the trunk store (only while open); its look: "Trunk", 16 slots, 8 columns; the Lockbox\'s look unchanged', () => {
    const {h, car, sys} = trunkHost();
    expect(sys.view.opts).toBe(TRUNK_VIEW);
    expect(TRUNK_VIEW).toMatchObject({name: 'Trunk', the: 'the trunk', slots: 16, columns: 8});
    expect(LOCKBOX_VIEW).toMatchObject({id: 'lockboxview', name: 'Lockbox', the: 'the Lockbox', slots: LOCKBOX_SLOTS, columns: 10, heading: 'Train storage · travels with you'});
    h.inv.set(P(0), h.inv.makeStack('water', 2));
    expect(sys.view.quick(P(0))).toBe(0); // closed: refused, nothing moves
    expect([sys.view.note, sys.view.noteBad, sys.store.used]).toEqual(['Open the trunk (E) to reach into it.', true, 0]);
    behind(h, car);
    press(h, car, 'KeyE');
    const slots = (sys.view as unknown as {host: {slots(): unknown}}).host.slots();
    expect(slots).toBe(sys.store.slots);
    expect(sys.view.quick(P(0))).toBe(2);
    expect([sys.view.note, sys.store.summary()]).toEqual(['2 × Water → Trunk', ['0:waterx2']]);
  });

  it('click / drag / stow move the SAME stacks (uids, mag, filter, air, a backpack whole with its contents); finite; nothing lost or doubled', () => {
    const {h, car, sys} = trunkHost();
    const inv = h.inv, k = kit(inv), box = sys.store;
    behind(h, car);
    press(h, car, 'KeyE');
    const before = census(inv, box);
    expect(unique(before.uids)).toBe(true);
    // the worn backpack, whole
    expect(sys.view.stow()).toBe(true);
    expect([box.slots[0], box.slots[0]!.bag![0]!.count, box.slots[0]!.bag![2]!.count, inv.worn('backpack')]).toEqual([k.bag, 3, 40, null]);
    expect(sys.view.note).toBe('Backpack stowed in the trunk (its contents stay inside)');
    // a gun keeps its magazine, a mask its filter, a tank its air (the same objects)
    expect(sys.view.quick(H(0))).toBe(1);
    expect(sys.view.quick(P(0))).toBe(1);
    expect(sys.view.quick(P(1))).toBe(1);
    expect(box.slots.slice(1, 4)).toEqual([k.pistol, k.mask, k.tank]);
    expect([k.pistol.mag, k.mask.filter, k.tank.air]).toEqual([7, 20.25, 312.5]);
    // 9mm merges up to the stack size: 80 already in the trunk + the 50 -> 120 there, the remaining 10 in a slot of their own (the same stack)
    box.slots[10] = inv.makeStack('ammo_9mm', 80);
    const extra = census(inv, box);
    expect(sys.view.quick(P(2))).toBe(50);
    expect([box.slots[10]!.count, box.slots[4], k.ammo.count]).toEqual([120, k.ammo, 10]);
    // drag within the trunk, Shift-drag split out to a pocket (a new uid for the piece), merge back
    expect(sys.view.move(T(4), T(15))).toBe('moved');
    expect(sys.view.move(T(15), P(5), 4)).toBe('split');
    const piece = inv.get(P(5))!;
    expect([piece.count, k.ammo.count, piece.uid !== k.ammo.uid]).toEqual([4, 6, true]);
    expect(sys.view.move(P(5), T(15))).toBe('merged');
    expect([k.ammo.count, inv.get(P(5))]).toEqual([10, null]);
    // a backpack leaves the trunk only onto your back (a pocket refuses: the text names the trunk), click wears it again
    expect(sys.view.move(T(0), P(6))).toBe('refused');
    expect(sys.view.note).toBe('A backpack does not go in your pockets — click it in the trunk to wear it (your back slot must be free).');
    expect(sys.view.quick(T(0))).toBe(1);
    expect([inv.worn('backpack'), box.slots[0]]).toEqual([k.bag, null]);
    expect(sys.view.note).toBe('Wearing the backpack (its contents came with it)');
    // the pistol back out: the same stack, the magazine kept
    expect(sys.view.quick(T(1))).toBe(1);
    expect([inv.find(k.pistol.uid) !== null, k.pistol.mag]).toEqual([true, 7]);
    const after = census(inv, box);
    expect(after.counts).toEqual(extra.counts); // finite: every count conserved through every move
    expect(after.uids).toEqual(extra.uids); // the split piece merged away again: the same uids, each once
    expect(unique(after.uids)).toBe(true);
    expect([inv.invariants(), box.invariants()]).toEqual([[], []]);
  });

  it('a full trunk refuses with nothing changed (the refusal names the trunk)', () => {
    const {h, car, sys} = trunkHost();
    for (let i = 0; i < TRUNK_SLOTS; i++) sys.store.slots[i] = h.inv.makeStack('battery', 4);
    h.inv.set(P(0), h.inv.makeStack('water', 1));
    behind(h, car);
    press(h, car, 'KeyE');
    const before = JSON.stringify({inv: h.inv.toJSON(), box: sys.store.toJSON()});
    expect(sys.view.quick(P(0))).toBe(0);
    expect([sys.view.note, sys.view.noteBad]).toEqual(['The trunk is full.', true]);
    expect(JSON.stringify({inv: h.inv.toJSON(), box: sys.store.toJSON()})).toBe(before);
    expect(sys.store.free).toBe(0);
  });
});

describe('skyways car trunk: closing', () => {
  const opened = (o: Parameters<typeof carHost>[0] = {}) => {
    const r = trunkHost(o);
    behind(r.h, r.car);
    press(r.h, r.car, 'KeyE');
    expect(r.sys.isOpen).toBe(true);
    r.h.sfxCalls.length = 0;
    return r;
  };
  const key = (sys: TrunkSystem, code: string) => {
    let prevented = false, stopped = false;
    sys.onKeyCapture({code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: {tagName: 'BODY'} as never,
      preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; }});
    return {prevented, stopped};
  };

  it('keys: E / 6 close (consumed: no [E] interact leaks), digits consumed, Esc / Tab close and go on, WASD passes', () => {
    const {h, car, sys} = opened();
    expect(key(sys, 'Digit2')).toEqual({prevented: true, stopped: true}); // never the quick slots; no developer code here
    expect([sys.isOpen, sys.store.used]).toEqual([true, 0]);
    expect(key(sys, 'KeyW')).toEqual({prevented: false, stopped: false});
    expect(key(sys, 'KeyE')).toEqual({prevented: true, stopped: true});
    expect([sys.isOpen, sys.lastClose, h.sfxCalls]).toEqual([false, 'user', ['door']]); // the lid cue on closing
    expect(key(sys, 'KeyE')).toEqual({prevented: false, stopped: false}); // closed: E is the game's again
    frame(h, car);
    expect(car.prompt).toBe(TRUNK_TEXT.open);
    for (const c of ['Escape', 'Tab', 'Digit6']) {
      press(h, car, 'KeyE');
      expect(sys.isOpen).toBe(true);
      expect(key(sys, c).stopped).toBe(c === 'Digit6');
      expect([sys.isOpen, sys.lastClose]).toEqual([false, c === 'Digit6' ? 'user' : 'state']);
    }
  });

  it('walking out of reach, a hit, pause / menu / the inventory, death, the car moving or taken, teardown', () => {
    const {h, car, sys} = opened();
    h.hitListeners[0]({amount: 0}); // a zero-damage graze keeps it open
    expect(sys.isOpen).toBe(true);
    h.hitListeners[0]({amount: 7});
    expect([sys.isOpen, sys.lastClose, h.toasts.at(-1)]).toEqual([false, 'hit', TRUNK_TEXT.hit]);
    const reopen = () => { behind(h, car); press(h, car, 'KeyE'); expect(sys.isOpen).toBe(true); };
    reopen();
    // walk straight back: still open within closeRange of the anchor, closed beyond it
    h.keys.held.add('KeyS'); // (facing the car: S walks away from it)
    let farthest = 0;
    run(h, car, 3, () => { const a = sys.anchor()!; farthest = Math.hypot(h.player.x - a.x, h.player.z - a.z); return !sys.isOpen; });
    h.keys.held.clear();
    expect([sys.isOpen, sys.lastClose, h.toasts.at(-1)]).toEqual([false, 'distance', TRUNK_TEXT.far]);
    expect(farthest).toBeGreaterThan(TRUNK_RT.closeRange);
    expect(farthest).toBeLessThan(TRUNK_RT.closeRange + 0.2);
    for (const s of ['paused', 'inventory', 'title']) {
      reopen();
      for (const f of h.stateListeners) (f as (s: string, p: string) => void)(s, 'playing');
      expect([sys.isOpen, sys.lastClose]).toEqual([false, 'state']);
    }
    reopen();
    h.player.alive = false;
    frame(h, car);
    expect([sys.isOpen, sys.lastClose]).toEqual([false, 'state']);
    h.player.alive = true;
    reopen();
    car.body!.x += 0.3; // (the parked car never moves on its own; if it ever does, the view closes)
    frame(h, car);
    expect([sys.isOpen, sys.lastClose]).toEqual([false, 'moved']);
    car.body!.x -= 0.3;
    reopen();
    car.driving = true; // someone in the seat
    sys.update();
    expect([sys.isOpen, sys.lastClose]).toEqual([false, 'driving']);
    car.driving = false;
    reopen();
    teardown(h);
    expect([sys.isOpen, sys.lastClose, sys.loaded, sys.store.used]).toEqual([false, 'travel', false, 0]);
    expect(sys.open()).toBe(false); // between worlds
  });
});

describe('skyways car trunk: persistence (the car\'s record v2, this station)', () => {
  it('teardown -> the record\'s trunk -> rebuild: the same stacks and uids; taken out -> gone from the record; never doubled', () => {
    const {h, car, sys} = trunkHost();
    const k = kit(h.inv);
    behind(h, car);
    press(h, car, 'KeyE');
    sys.view.stow();
    sys.view.quick(H(0));
    sys.view.quick(P(0));
    sys.view.quick(P(1));
    const live = sys.store.toJSON().slots, summary = sys.store.summary(), total = census(h.inv, sys.store);
    // a pause stores the car (a save may follow): the live trunk is in the record already
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('paused', 'playing');
    expect((h.store.get(SKYWAYS_CAR_LANE) as SkywaysCarRecord).trunk).toEqual(live);
    h.state = 'playing';
    teardown(h);
    const rec = h.store.get(SKYWAYS_CAR_LANE) as SkywaysCarRecord;
    expect([rec.v, skywaysCarProblem(rec), rec.trunk.length]).toEqual([2, null, TRUNK_SLOTS]);
    expect(rec.trunk).toEqual(live);
    expect(rec.trunk[0]!.bag!.filter(Boolean).map(s => s!.uid)).toEqual([k.bag.bag![0]!.uid, k.bag.bag![2]!.uid]);
    build(h);
    expect([sys.loaded, sys.store.summary()]).toEqual([true, summary]);
    expect(sys.store.toJSON().slots).toEqual(live); // uids, mag, filter, air, contents
    expect(census(h.inv, sys.store)).toEqual(total); // nothing duplicated by the round trip
    build(h); // a rebuild without a teardown: the live trunk is stored first (not lost, not doubled)
    expect(sys.store.toJSON().slots).toEqual(live);
    // take the pistol back out: gone from the record after the next teardown
    behind(h, car);
    press(h, car, 'KeyE');
    expect(sys.view.quick(T(1))).toBe(1);
    expect(h.inv.find(k.pistol.uid)).not.toBeNull();
    teardown(h);
    teardown(h); // idempotent
    const rec2 = h.store.get(SKYWAYS_CAR_LANE) as SkywaysCarRecord;
    expect(rec2.trunk[1]).toBeNull();
    expect(rec2.trunk.flatMap(s => (s ? [s.uid] : []))).not.toContain(k.pistol.uid);
    build(h);
    expect(census(h.inv, sys.store)).toEqual(total);
  });

  it('a v1 record (an older save): an EMPTY trunk once, written back as v2; the pose fallback keeps the trunk; no car -> nothing', () => {
    const {h, car, sys} = trunkHost({build: false});
    h.store.set(SKYWAYS_CAR_LANE, {v: 1, x: 15, y: 0, z: 14, yaw: 0, level: 0});
    build(h);
    expect([car.source, sys.loaded, sys.store.used]).toEqual(['record', true, 0]);
    teardown(h);
    expect(h.store.get(SKYWAYS_CAR_LANE)).toEqual(skywaysCarRecord(15, 0, 14, 0, 0));
    build(h);
    expect(sys.store.used).toBe(0); // never invented items
    // a record whose pose no longer fits (over the drop) falls back to the spawn: its trunk still comes back
    teardown(h);
    h.store.set(SKYWAYS_CAR_LANE, skywaysCarRecord(33, 0, 15, 0, 0, {trunk: [{uid: 41, itemId: 'water', count: 2}]}));
    build(h);
    expect([car.source, sys.store.summary()]).toEqual(['spawn', ['0:waterx2']]);
    // a layout without the car: no trunk at all
    teardown(h);
    (h as {layout: unknown}).layout = {props: []};
    build(h);
    expect([car.body, sys.loaded, sys.store.used, sys.aimed(), sys.open()]).toEqual([null, false, 0, false, false]);
  });

  it('the inventory\'s uid counter stays above the trunk\'s uids after a build', () => {
    const {h, sys} = trunkHost({build: false});
    const trunk = emptyTrunk();
    trunk[3] = {uid: 900001, itemId: 'backpack', count: 1, bag: [{uid: 900005, itemId: 'water', count: 1}, ...new Array(11).fill(null)]};
    trunk[7] = {uid: 900002, itemId: 'pistol', count: 1, mag: 3};
    h.store.set(SKYWAYS_CAR_LANE, skywaysCarRecord(15, 0, 15, 0, 0, {trunk}));
    build(h);
    expect([sys.store.maxUid(), sys.store.summary()]).toEqual([900005, ['3:backpackx1[1]', '7:pistolx1@3']]);
    expect(h.inv.makeStack('water', 1).uid).toBeGreaterThan(900005);
  });

  it('a save carrying a trunk validates, restores (the same stacks + uids) and reserves the uids', () => {
    // a live trunk -> the car's record -> a save file
    const src = trunkHost();
    const k = kit(src.h.inv);
    behind(src.h, src.car);
    press(src.h, src.car, 'KeyE');
    src.sys.view.stow();
    src.sys.view.quick(H(0));
    src.sys.view.quick(P(0));
    teardown(src.h);
    const rec = src.h.store.get(SKYWAYS_CAR_LANE) as SkywaysCarRecord;
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
    hs.run.current = {level: 'subway', section: 'main', station: sid(1)};
    hs.run.memory().visits = 1;
    hs.inv = src.h.inv; // (the carried rest of the kit)
    hs.run.setLaneStore(SKYWAYS_CAR_LANE, rec);
    const file = hs.file('arrival', 1);
    const v = validateSaveFile(structuredClone(file));
    expect(v.ok, v.ok ? '' : (v as {error: string}).error).toBe(true);
    const parsed = parseSaveText(saveFileText(file));
    if (!parsed.ok) throw new Error(parsed.error);
    const b = new Harness(null);
    installRestore(prepareRestore(parsed.value.run, b.makeRun), b.target());
    const back = b.run.laneStore(SKYWAYS_CAR_LANE) as SkywaysCarRecord;
    expect(back).toEqual(rec);
    // the restored record -> a fresh car world with the restored inventory
    const dst = trunkHost({build: false});
    dst.h.inv = b.inv;
    dst.h.store.set(SKYWAYS_CAR_LANE, back);
    build(dst.h);
    expect(dst.sys.store.toJSON().slots).toEqual(rec.trunk);
    expect(dst.sys.store.slots[0]!.uid).toBe(k.bag.uid);
    expect(dst.sys.store.slots[1]).toMatchObject({uid: k.pistol.uid, mag: 7});
    expect(dst.sys.store.slots[2]).toMatchObject({uid: k.mask.uid, filter: 20.25});
    const all = census(dst.h.inv, dst.sys.store);
    expect(unique(all.uids)).toBe(true);
    expect(dst.h.inv.makeStack('water', 1).uid).toBeGreaterThan(Math.max(...all.uids));
  });
});

describe('skyways car trunk: the view in a (fake) DOM', () => {
  let dom: FakeDom;
  beforeAll(() => { installCanvasShim(false); dom = installFakeDom(); });
  afterAll(() => dom.uninstall());

  it('mounts its own element and CSS scope: "Trunk · n/16 slots used", 8 columns, the trunk\'s heading and help text', () => {
    const {h, car, sys} = trunkHost();
    behind(h, car);
    press(h, car, 'KeyE');
    expect(sys.view.visible).toBe(true);
    expect(dom.el('.lb-title').textContent).toBe('Trunk · 0/16 slots used');
    h.inv.set(P(0), h.inv.makeStack('water', 2));
    sys.view.quick(P(0));
    expect(dom.el('.lb-title').textContent).toBe('Trunk · 1/16 slots used');
    expect(dom.el('[data-side="store"]').children).toHaveLength(TRUNK_SLOTS);
    const root = dom.el('#app').children.find(c => c.id === 'trunkview')!;
    expect(root.attrs.get('aria-label')).toBe('Trunk');
    expect(root.innerHTML).toContain('<div class="slots lb-g8" data-side="store">');
    expect(root.innerHTML).toContain('Car trunk · stays with the car');
    expect(root.innerHTML).toContain('closes the trunk</div>');
    const style = dom.doc.head.children.find(c => c.id === 'trunkview-styles')!;
    expect(style.textContent).toContain('#trunkview .lb-g8 { grid-template-columns: repeat(8, 1fr); }');
    expect(style.textContent).toContain('#trunkview .lb-cols { display: grid; grid-template-columns: 7fr 26px 8fr;');
    expect(style.textContent).not.toContain('#lockboxview');
    expect(TRUNK_RT.reach).toBe(CAR_RT.enterReach);
  });
});
