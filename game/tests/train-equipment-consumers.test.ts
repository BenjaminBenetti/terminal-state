// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): the REAL train equipment system (world/trainEquipment.ts) together
// with its REAL consumers, installed in Game's order on a generated station with the real train runtime, ride, Player, Inventory and
// train record — no fake of the equipment system anywhere here:
//  - the crafting BENCH (world/craftBench.ts + craft/crafting.ts): [E] at the bench, the recipe list, a craft = a real unit on the car
//    floor with the materials debited exactly from the sources in their order (carried, the Lockbox, a chest standing in the car);
//    a refused craft (materials missing, the car full, the train riding) leaves every stack, unit and counter untouched; craftBlock is
//    a pure question; the bench's hands-free rule sees a grabbed dolly and a carried chest;
//  - the CHEST's store view (world/equipmentChestStore.ts): a TAP of [E] opens it over the unit's live slots (the lid up, the store's
//    own cue — the equipment system makes no sound), HOLDING [E] carries the chest and never asks the use; the open view closes when
//    the chest is shoved, becomes cargo, or is replaced by a Retry;
//  - the SENTRY's feed (world/equipmentChestStore.ts over the unit's four slots; world/sentryTurret.ts): [E] opens its own small store
//    view; real rounds go in and come out by the inventory's own moves, conserved; nothing but its rounds goes in; an older save's
//    round count is real stacks from the first frame; active('sentry') only while plugged into the parked car;
//  - the item SCANNER's console (world/itemScanner.ts): its tap falls through to the grab while it is not plugged in, opens the scope
//    while it is; unplugging closes the scope through the plug listener;
//  - the route radar's reveal radius (routeRadius) follows the real plug.
import {afterAll, afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom} from './helpers/fakeDom';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {trainToWorld, worldToTrain} from '../src/gen/playerTrain';
import {EQUIPMENT, EQUIPMENT_LIMITS, SENTRY_FEED_SLOTS, equipmentRounds, type EquipmentJSON} from '../src/craft/equipment';
import {EQUIP_HOLD_S} from '../src/craft/equipmentApi';
import {countMaterials, craft} from '../src/craft/crafting';
import {RECIPES, RECIPE_MATERIALS} from '../src/craft/recipes';
import {PLUG, craftSpots, equipmentPlugs} from '../src/craft/trainFixtures';
import {cartAboard} from '../src/fuel/trainPort';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {itemDef} from '../src/items/items';
import type {ScannerScope} from '../src/ui/scannerView';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {chipperFootprint, chipperPlacement} from '../src/world/chipperPlace';
import {BENCH_TEXT, craftBenchQaApi, craftedHint, installCraftBench, type CraftBenchSystem} from '../src/world/craftBench';
import {CHEST_STORE_TEXT, STORE_TEXT} from '../src/world/equipmentChestStore';
import {ItemScannerSystem, SCANNER_TEXT} from '../src/world/itemScanner';
import {SENTRY_TEXT, SentryTurretSystem} from '../src/world/sentryTurret';
import {EQUIPMENT_TEXT, feedRule, type LiveUnit} from '../src/world/trainEquipment';
import {equipmentBox} from '../src/world/trainEquipmentModel';
import {frame, press, run, teardown} from './helpers/fuelCartsHost';
import {
  aboardRec, buildWorld, equipStation, holdE, loadAboard, lookAtUnit, plugSpot, putLocal, stand, type EquipOptions, type EquipTestHost,
} from './helpers/trainEquipmentHost';

// the train's view needs the canvas shim, the recipe list and the store view a (tiny, fake) DOM: one document that serves both
installCanvasShim(false);
const canvasDoc = (globalThis as unknown as {document: {createElement(tag: string): unknown}}).document;
const dom = installFakeDom();
const fakeCreate = dom.doc.createElement;
dom.doc.createElement = ((tag: string) => (tag === 'canvas' ? canvasDoc.createElement(tag) : fakeCreate(tag))) as typeof fakeCreate;
afterAll(() => dom.uninstall());

let layoutCache: StationLayout | null = null;
const SUBWAY = (): StationLayout => (layoutCache ??= LEVELS.subway.generate('main', {levelSeed: 4242}));

type Host = EquipTestHost & {qa: boolean; stats: {kills: number}; craftBench: CraftBenchSystem; use: unknown; currentTarget: unknown};
const worlds: {h: Host; reset(): void}[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) { w.reset(); if (w.h.trainRuntime?.train) teardown(w.h); }
});

class FakeScope {
  opened = 0; closed = 0; draws = 0;
  open(): void { this.opened++; }
  close(): void { this.closed++; }
  draw(): void { this.draws++; }
}

/** A generated station with the real train, ride, equipment system, bench (+ chest store), sentry and scanner — Game's install order. */
function world(o: EquipOptions = {}) {
  const L = SUBWAY();
  const s = equipStation(L, {...o, build: false});
  const h = s.h as Host;
  // what the views need of Game's input (the pointer lock): never exercised here
  Object.assign(h.keys, {locked: true, onLockChange: (_locked: boolean) => {}, lock: () => Promise.resolve(true), unlock: () => {}});
  Object.assign(h, {qa: false, stats: {kills: 0}, use: null, currentTarget: null});
  const sfx = h.sfx as Record<string, unknown>;
  sfx.voice = () => ({});
  sfx.play = (_v: unknown, cue: string) => { h.sfxCalls.push(`cue:${cue}`); return true; };
  sfx.shellIn = () => { h.sfxCalls.push('shellIn'); };
  const bench = installCraftBench(h as never);
  h.craftBench = bench;
  const sentry = new SentryTurretSystem(h as never, {rand: () => 0.5}).install();
  const scope = new FakeScope();
  const scanner = new ItemScannerSystem(h as never, {scope: scope as unknown as ScannerScope}).install();
  buildWorld(h, L);
  worlds.push({h, reset: () => { s.ride.reset(); }});
  return {...s, h, bench, store: bench.chestStore!, sentry, scanner, scope};
}

/** Stand `dist` in front of a unit's front (its console face / latches) and look at a point of that face. */
function faceOf(h: Host, u: LiveUnit, dist = 1.2): void {
  const b = u.body;
  stand(h, b.x + Math.sin(b.yaw) * dist, b.z + Math.cos(b.yaw) * dist, 0, b.y);
  frame(h);
  const K = equipmentBox(u.def);
  const y = K.face ? K.face.y0 + (K.face.y1 - K.face.y0) * 0.7 : K.body.y1 - 0.03;
  lookAtUnit(h, u, K.body.x, y, K.face ? K.body.z + K.body.hd : K.body.hd * 0.5);
  frame(h);
}

/** Stand behind a dolly's handle and look at it. */
function handleOf(h: Host, u: LiveUnit, dist = 1.2): void {
  const b = u.body;
  stand(h, b.x - Math.sin(b.yaw) * dist, b.z - Math.cos(b.yaw) * dist, 0, b.y);
  frame(h);
  lookAtUnit(h, u, 0, CART_LOOK.handle.y, CART_LOOK.handle.z);
  frame(h);
}

/** E pressed and released again before the hold time (a tap). */
function tapE(h: Host, held = 0.12): void {
  h.keys.held.add('KeyE');
  h.keys.hits.add('KeyE');
  frame(h);
  run(h, held);
  h.keys.held.delete('KeyE');
  frame(h);
}

/** What the crosshair is on, as plain data (a live unit is never deep-compared: its object graph reaches the whole world). */
const aimOf = (eq: {aim: {unit: LiveUnit; part: string} | null}): [string, string] | null => (eq.aim ? [eq.aim.unit.uid, eq.aim.part] : null);
const uidOf = (u: {uid: string} | null | undefined): string | null => u?.uid ?? null;

const key = (code: string) => ({code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: {tagName: 'BODY'} as never, preventDefault() {}, stopPropagation() {}});

/** Everything a craft may touch, as plain data: the carried inventory, the Lockbox, the train's units (their stacks), the counter. */
function ledger(h: Host): string {
  return JSON.stringify({inv: h.inv.toJSON(), box: h.playerTrain.lockbox.toJSON(), eq: h.playerTrain.equipment.toJSON(), here: h.trainEquipment.stationRecords()});
}

describe('the bench and the equipment system: a craft is a real unit on the car floor', () => {
  it('every consumer hangs on the one stable `uses` record and the plug listeners', () => {
    const {h, eq, store, bench} = world();
    const uses = eq.uses;
    expect(uses.chest).toBe(store.use);
    expect(Object.keys(uses).sort()).toEqual(['chest', 'scanner', 'sentry']);
    expect(uses.sentry).toBe(store.use); // every kind with slots opens through the one store controller
    expect(eq.promptNotes).toHaveLength(1); // (the sentry's "not plugged in" / "no headroom")
    expect(uses.scanner!.hold).toBeUndefined(); // its tap acts on the press
    expect(uses.chest!.hold).toBeUndefined(); // holding E on a chest is the system's own (carry)
    expect(eq.plugListeners).toHaveLength(2); // the sentry's and the scanner's
    expect(h.trainEquipment).toBe(eq);
    // a world going and coming, a Retry: the same record, the same entries
    teardown(h);
    buildWorld(h, SUBWAY());
    eq.restore([]);
    run(h, 0.2);
    expect(eq.uses).toBe(uses);
    expect(uses.chest).toBe(store.use);
    expect(eq.plugListeners).toHaveLength(2);
    expect(bench.chestStore).toBe(store);
  });

  it('[E] at the bench opens the list; each recipe crafts a real, empty, unplugged unit on a free spot; the materials are debited exactly', () => {
    const {h, eq, bench} = world();
    const inv = h.inv, box = h.playerTrain.lockbox, p = h.trainPlacement!;
    // carried: 5 scrap + 2 electrical; the Lockbox: 20 + 20
    inv.add(inv.makeStack(SCRAP_METAL, 5));
    inv.add(inv.makeStack(ELECTRICAL_PARTS, 2));
    const boxScrap = (box.slots[3] = inv.makeStack(SCRAP_METAL, 20)), boxElec = (box.slots[7] = inv.makeStack(ELECTRICAL_PARTS, 20));
    box.version++;
    expect(craftBenchQaApi(h).benchGo()).toBe(true);
    frame(h); frame(h);
    expect(bench.prompt()).toBe(BENCH_TEXT.open);
    expect(eq.prompt).toBeNull(); // (no unit under the crosshair: the bench's own prompt)
    press(h, 'KeyE');
    expect(bench.isOpen).toBe(true);
    expect([uidOf(eq.grab?.unit), uidOf(eq.held)]).toEqual([null, null]);
    const counts = () => countMaterials(bench.sources());
    const where = (m: (typeof RECIPE_MATERIALS)[number]) => { const c = counts()[m]; return [c.carried, c.lockbox, c.chests]; };
    expect([where(SCRAP_METAL), where(ELECTRICAL_PARTS)]).toEqual([[5, 20, 0], [2, 20, 0]]);
    expect(bench.qa().rows!.map(r => r.can)).toEqual(RECIPES.map(() => true));

    const made: LiveUnit[] = [];
    const craftRow = (kind: string) => {
      const r = RECIPES.find(x => x.kind === kind)!;
      const before = counts(), seq = h.playerTrain.equipment.seq, n = eq.units().length;
      h.toasts.length = 0; h.sfxCalls.length = 0;
      const res = bench.craftKind(r.kind)!; // (the row's Craft button: there is no by-number shortcut any more)
      expect(res.ok, res.ok ? '' : res.text).toBe(true);
      if (!res.ok) throw new Error(res.text);
      // the result IS the live unit (identity), the run's next number
      const u = eq.unit(res.unit.uid)!;
      expect(res.unit === u).toBe(true);
      expect(eq.units()).toHaveLength(n + 1);
      expect(eq.units().includes(u)).toBe(true);
      expect(u.uid).toBe(`eq-${seq + 1}`);
      expect(h.playerTrain.equipment.seq).toBe(seq + 1);
      expect([u.kind, u.mode, u.plug, u.ammo, u.awake]).toEqual([r.kind, 'world', null, 0, false]);
      expect(u.slots === null).toBe(EQUIPMENT[r.kind].slots === 0);
      if (u.slots) { expect(u.slots).toHaveLength(EQUIPMENT[r.kind].slots); expect(u.slots.every(x => x === null)).toBe(true); }
      // standing wholly in the car on one of the kind's craft spots
      const q = worldToTrain(p, u.body.x, u.body.y, u.body.z);
      expect(cartAboard(q.x, q.z, u.def.radius, SPEC)).toBe(true);
      expect(craftSpots(u.def.radius, SPEC).some(s => Math.hypot(s.x - q.x, s.z - q.z) < 1e-6)).toBe(true);
      expect(u.body.y).toBeCloseTo(p.floorY, 6);
      expect(eq.aboard().map(x => x.uid)).toContain(u.uid);
      // exactly the recipe's cost left the sources
      const after = counts();
      for (const m of RECIPE_MATERIALS) expect(after[m].total).toBe(before[m].total - r.cost[m]);
      expect(h.toasts).toEqual([BENCH_TEXT.crafted(u.def.name, craftedHint(u.def))]);
      expect(h.sfxCalls).toContain('pickup');
      expect(h.sfxCalls).toContain('cue:clank');
      made.push(u);
      return u;
    };

    // a chest: 2 scrap, from the pockets first
    const chest = craftRow('chest');
    expect([where(SCRAP_METAL), where(ELECTRICAL_PARTS)]).toEqual([[3, 20, 0], [2, 20, 0]]);
    // a radar: 4 scrap (3 carried + 1 from the Lockbox), 3 electrical (2 carried + 1 from the Lockbox)
    craftRow('radar');
    expect([where(SCRAP_METAL), where(ELECTRICAL_PARTS)]).toEqual([[0, 19, 0], [0, 19, 0]]);
    expect([boxScrap.count, boxElec.count, box.slots[3], box.slots[7]]).toEqual([19, 19, boxScrap, boxElec]); // the same stacks, lowered
    // the chest standing in the car is a source: its LIVE slots (what the store view moves stacks into)
    const stores = eq.storesAboard();
    expect(stores.map(s => s.uid)).toEqual([chest.uid]);
    expect(stores[0].slots).toBe(chest.slots);
    const inChest = (chest.slots![5] = inv.makeStack(SCRAP_METAL, 10));
    const v0 = chest.storeVersion;
    stores[0].touch();
    expect(chest.storeVersion).toBe(v0 + 1);
    expect(where(SCRAP_METAL)).toEqual([0, 19, 10]);
    // the Lockbox's scrap gone: a scanner (5 scrap, 5 electrical) is paid from the chest and the Lockbox
    box.slots[3] = null; box.version++;
    const v1 = chest.storeVersion;
    craftRow('scanner');
    expect([where(SCRAP_METAL), where(ELECTRICAL_PARTS)]).toEqual([[0, 0, 5], [0, 14, 0]]);
    expect([chest.slots![5], inChest.count]).toEqual([inChest, 5]); // the same stack object in the same slot
    expect(chest.storeVersion).toBeGreaterThan(v1); // (the debit touched the store: an open view redraws)
    expect(eq.aboard().find(r => r.uid === chest.uid)!.slots![5]).toMatchObject({uid: inChest.uid, itemId: SCRAP_METAL, count: 5});

    // every unit stands apart from every other, none on a plug, all the train's
    for (let i = 0; i < made.length; i++) for (let j = i + 1; j < made.length; j++) {
      expect(Math.hypot(made[i].body.x - made[j].body.x, made[i].body.z - made[j].body.z)).toBeGreaterThanOrEqual(made[i].def.radius + made[j].def.radius - 0.005);
    }
    run(h, 0.5);
    expect(made.map(u => u.plug)).toEqual(made.map(() => null));
    expect(eq.all().every(x => x.owner === 'train')).toBe(true);

    // NOT ENOUGH for the sentry (8 scrap, 6 electrical): refused, nothing changed anywhere
    const L0 = ledger(h), units0 = eq.units().map(u => u.uid), st0 = JSON.stringify(eq.state().counts);
    const res = bench.craftKind('sentry')!;
    expect(res).toMatchObject({ok: false, reason: 'missing'});
    expect(ledger(h)).toBe(L0);
    expect(eq.units().map(u => u.uid)).toEqual(units0);
    expect(JSON.stringify(eq.state().counts)).toBe(st0);
    expect(bench.qa().rows!.find(r => r.kind === 'sentry')).toMatchObject({can: false});
    expect(bench.isOpen).toBe(true);
  });

  it('a blocked craft changes nothing: the car full, the train riding; craftBlock itself is a pure question', async () => {
    const {h, eq, bench, ride} = world();
    const inv = h.inv, N = EQUIPMENT_LIMITS.aboard;
    for (let i = 0; i < 3; i++) { inv.add(inv.makeStack(SCRAP_METAL, 20)); inv.add(inv.makeStack(ELECTRICAL_PARTS, 20)); }
    // one below the limit: the list offers everything, and asking does nothing (asked per row at every redraw)
    const recs: EquipmentJSON[] = [];
    const chip = chipperFootprint(chipperPlacement(SPEC)!), R = EQUIPMENT.radar.radius;
    for (let x = 4.6; recs.length < N - 1; x -= 0.74) for (const z of [-0.9, 0, 0.9]) {
      if (recs.length >= N - 1) break;
      if (x + R > chip.x0 && x - R < chip.x1 && z + R > chip.z0 && z - R < chip.z1) continue; // (the chipper stands there)
      recs.push(aboardRec('radar', recs.length + 1, x, z));
    }
    expect(Math.min(...recs.map(r => r.x))).toBeGreaterThan(-2); // (the craft spots by the bench stay free)
    loadAboard(h, recs);
    run(h, 0.3);
    expect(craftBenchQaApi(h).benchGo()).toBe(true);
    frame(h); frame(h);
    press(h, 'KeyE');
    expect(bench.isOpen).toBe(true);
    const L0 = ledger(h), c0 = JSON.stringify(eq.state());
    for (let i = 0; i < 200; i++) for (const r of RECIPES) expect(eq.craftBlock(r.kind)).toBeNull();
    run(h, 1); // (the open list asks again every BENCH_RT.refreshS)
    expect(ledger(h)).toBe(L0);
    expect(JSON.stringify(eq.state())).toBe(c0);
    // the last free place
    const res = bench.craftKind('chest')!;
    expect(res.ok).toBe(true);
    expect(eq.aboard()).toHaveLength(N);
    // FULL: every row refused with the equipment system's own text; a craft changes nothing
    const full = EQUIPMENT_TEXT.tooMany(N, N);
    for (const r of RECIPES) expect(bench.block(r.kind)).toBe(full);
    const L1 = ledger(h), units1 = eq.units().map(u => u.uid);
    h.sfxCalls.length = 0;
    for (const r of RECIPES) {
      const out = bench.craftKind(r.kind)!;
      expect(out).toMatchObject({ok: false, reason: 'blocked', text: full});
      expect(eq.craft(r.kind)).toBeNull();
    }
    expect(ledger(h)).toBe(L1);
    expect(eq.units().map(u => u.uid)).toEqual(units1);
    expect(h.sfxCalls.filter(c => c === 'denied')).toHaveLength(RECIPES.length);
    expect(bench.qa().rows!.map(r => [r.can, r.reason])).toEqual(RECIPES.map(() => [false, full]));
    // one unit rolled out of the car: room again (the list notices by itself)
    const out = eq.units()[0], w = trainToWorld(h.trainPlacement!, 2, SPEC.floorY, -3);
    out.body.x = w.x; out.body.z = w.z; out.body.y = h.levels!.floorAt(w.x, w.z, h.trainPlacement!.floorY + 0.3); out.plugCheck = true;
    run(h, 0.4);
    expect(bench.qa().rows!.map(r => r.can)).toEqual(RECIPES.map(() => true));
    // THE TRAIN RIDES: the bench closes; the atomic craft over the real system is refused before anything is drawn
    void ride.depart();
    run(h, 0.2);
    expect(ride.riding).toBe(true);
    expect(bench.isOpen).toBe(false);
    expect(bench.craftKind('chest')).toBeNull();
    const L2 = ledger(h), units2 = eq.units().map(u => u.uid);
    for (const r of RECIPES) {
      expect(craft(r, {sources: bench.sources(), equipment: eq})).toMatchObject({ok: false, reason: 'blocked', text: EQUIPMENT_TEXT.moving});
      expect(bench.block(r.kind)).toBe(BENCH_TEXT.unavailable);
    }
    expect(ledger(h)).toBe(L2);
    expect(eq.units().map(u => u.uid)).toEqual(units2);
    ride.reset();
    await Promise.resolve();
  });

  it('the bench\'s hands-free rule sees a grabbed dolly, a held [E] and a carried chest (they are input owners)', () => {
    const {h, eq, bench} = world();
    loadAboard(h, [aboardRec('radar', 1, -2.2, 0.3, Math.PI / 2), aboardRec('chest', 2, -4.4, 0.2, Math.PI / 2)]);
    run(h, 0.3);
    const radar = eq.unit('eq-1')!, chest = eq.unit('eq-2')!;
    expect(bench.handsFree()).toBe(true);
    // no use registered for the radar: [E] on its console face grabs it
    faceOf(h, radar);
    expect(aimOf(eq)).toEqual([radar.uid, 'module']);
    press(h, 'KeyE');
    expect(uidOf(eq.grab?.unit)).toBe(radar.uid);
    expect(bench.handsFree()).toBe(false);
    expect(bench.usable()).toBe(false);
    press(h, 'KeyE');
    expect(uidOf(eq.grab?.unit)).toBeNull();
    expect(bench.handsFree()).toBe(true);
    // [E] held on the chest: the hands are taken from the first frame of the press, then they carry it
    run(h, 1);
    faceOf(h, chest);
    h.keys.held.add('KeyE');
    h.keys.hits.add('KeyE');
    frame(h);
    expect(eq.holdProgress).toBeGreaterThan(0);
    expect(bench.handsFree()).toBe(false);
    run(h, EQUIP_HOLD_S + 0.1);
    h.keys.held.clear();
    frame(h);
    expect(uidOf(eq.held)).toBe(chest.uid);
    expect(bench.handsFree()).toBe(false);
    expect(eq.craftBlock('radar')).toBeNull(); // (the equipment system itself has room: the bench's rule is the bench's)
    // put down again (the place it left is free): hands free
    press(h, 'KeyE');
    expect(uidOf(eq.held)).toBeNull();
    expect(chest.mode).toBe('world');
    expect(bench.handsFree()).toBe(true);
  });
});

describe('the chest\'s store view and the equipment system: tap opens, hold carries', () => {
  function chestWorld() {
    const w = world();
    loadAboard(w.h, [aboardRec('chest', 1, -2.2, 0.2, Math.PI / 2), aboardRec('chest', 2, -4.4, -0.3, Math.PI / 2)]);
    run(w.h, 0.3);
    return {...w, chest: w.eq.unit('eq-1')!, other: w.eq.unit('eq-2')!};
  }

  it('a tap opens the view over the unit\'s live slots (lid up, the store\'s cue only); transfers land in the unit\'s record; E closes', () => {
    const {h, eq, store, chest} = chestWorld();
    const inv = h.inv;
    const beans = inv.makeStack('beans', 3);
    inv.set({bar: 'pack', index: 2}, beans);
    faceOf(h, chest);
    expect(aimOf(eq)).toEqual([chest.uid, 'body']);
    expect(eq.prompt).toBe(CHEST_STORE_TEXT.prompt(0, EQUIPMENT.chest.slots));
    // the press alone does nothing yet (a chest's tap acts on the release)
    h.keys.held.add('KeyE'); h.keys.hits.add('KeyE');
    frame(h);
    expect([store.isOpen, uidOf(eq.held), chest.mode]).toEqual([false, null, 'world']);
    expect(eq.prompt).toBe(EQUIPMENT_TEXT.holding(chest.def.the));
    run(h, 0.1);
    h.sfxCalls.length = 0;
    h.keys.held.clear();
    frame(h);
    expect(store.isOpen).toBe(true);
    expect(store.unit === chest).toBe(true);
    expect([uidOf(eq.held), chest.mode, eq.counts.pickups]).toEqual([null, 'world', 0]);
    expect(chest.lidTarget).toBe(1);
    expect(h.sfxCalls).toEqual(['cue:cabinetOpen']); // the store's lid cue; nothing from the equipment system
    run(h, 1);
    expect(chest.lidT).toBe(1);
    expect(store.isOpen).toBe(true); // (the same unit object every frame, at rest: the view stays)
    expect(eq.units()).toBe(eq.units()); // (no list built per frame)
    // setOpen is the look only: no sound, no state besides the lid
    h.sfxCalls.length = 0;
    chest.setOpen(false); chest.setOpen(true);
    run(h, 0.5);
    expect(h.sfxCalls).toEqual([]);
    expect(chest.lidT).toBe(1);
    // a transfer in the view: the stack (same uid) is in the unit's slots — and in the train's record
    expect(inv.pack[2]).toBe(beans);
    expect(store.view.quick({bar: 'pack', index: 2})).toBe(3);
    expect(inv.pack[2]).toBeNull();
    expect(chest.slots!.filter(Boolean)).toEqual([beans]);
    expect(eq.storesAboard().find(s => s.uid === chest.uid)!.slots).toBe(chest.slots);
    const rec = eq.aboard().find(r => r.uid === chest.uid)!;
    expect(rec.slots!.filter(Boolean)).toEqual([{uid: beans.uid, itemId: 'beans', count: 3}]);
    expect(eq.maxUid()).toBe(beans.uid);
    expect(store.prompt(chest)).toBe(CHEST_STORE_TEXT.close);
    // E (the view's own captured key) closes it: the lid comes down
    h.sfxCalls.length = 0;
    store.onKeyCapture(key('KeyE'));
    expect(store.isOpen).toBe(false);
    expect(chest.lidTarget).toBe(0);
    expect(h.sfxCalls).toEqual(['cue:cabinetClose']);
    run(h, 1);
    expect(chest.lidT).toBe(0);
    expect(eq.prompt).toBe(CHEST_STORE_TEXT.prompt(1, EQUIPMENT.chest.slots));
  });

  it('holding [E] carries the chest and never asks the use; the contents travel in the same slots', () => {
    const {h, eq, store, chest} = chestWorld();
    const stack = (chest.slots![4] = h.inv.makeStack('ammo_9mm', 60));
    chest.touchStore();
    const slots = chest.slots, c0 = {...store.counts};
    faceOf(h, chest);
    holdE(h, EQUIP_HOLD_S + 0.1);
    expect(uidOf(eq.held)).toBe(chest.uid);
    expect([chest.mode, chest.worldPose()]).toEqual(['held', null]);
    expect(store.counts).toEqual(c0); // tap never called: not opened, not refused
    expect(store.isOpen).toBe(false);
    expect(store.prompt(chest)).toBeNull(); // (carried: the equipment system's own prompt)
    expect(eq.units().includes(chest)).toBe(true); // the same unit object
    expect(chest.slots).toBe(slots);
    expect(slots![4]).toBe(stack);
    expect(eq.aboard().find(r => r.uid === chest.uid)!.slots![4]).toEqual({uid: stack.uid, itemId: 'ammo_9mm', count: 60});
    expect(eq.storesAboard().map(s => s.uid)).toEqual(['eq-2']); // (in the hands: not a store standing in the car)
    expect(h.inputOwners.some(f => f())).toBe(true);
  });

  it('the open view closes when the chest is shoved, when a ride takes it as cargo, and when a Retry replaces the unit', async () => {
    const {h, eq, store, chest, ride} = chestWorld();
    const open = () => { faceOf(h, chest); tapE(h); expect(store.isOpen).toBe(true); expect(store.unit === chest).toBe(true); };
    // shoved (a bullet's push): it moved
    open();
    for (let i = 0; i < 12; i++) { chest.body.vx = 0.5; chest.body.vz = 0; chest.awake = true; frame(h); }
    run(h, 0.3);
    expect([store.isOpen, store.lastClose]).toEqual([false, 'moved']);
    expect(chest.lidTarget).toBe(0);
    run(h, 1);
    // the ride starts: the chest is cargo at once, the view goes
    open();
    void ride.depart();
    frame(h); frame(h);
    expect(chest.mode).toBe('cargo');
    expect(store.isOpen).toBe(false);
    expect(['travel', 'moved']).toContain(store.lastClose);
    expect([chest.lidTarget, chest.lidT]).toEqual([0, 0]);
    expect(store.prompt(chest)).toBeNull();
    expect(store.tap(chest)).toBe(true); // "Not while the train is moving": handled, nothing opens
    expect(store.isOpen).toBe(false);
    ride.reset();
    await Promise.resolve();
    run(h, 0.3);
    expect(chest.mode).toBe('world');
    // a Retry: the records win, the unit object is another one — the view on the old one closes
    run(h, 1);
    open();
    eq.restore(eq.aboard());
    frame(h);
    expect(eq.units().includes(chest)).toBe(false);
    expect(eq.unit(chest.uid) !== null).toBe(true);
    expect([store.isOpen, store.lastClose]).toEqual([false, 'gone']);
  });
});

describe('the sentry\'s feed and the equipment system: [E] opens its four slots, real rounds go in and come out', () => {
  it('[E] on the console opens the feed view over the unit\'s live slots; rounds move by the inventory\'s own rules and are conserved; the record keeps the stacks', () => {
    const {h, eq, sentry, store} = world();
    const inv = h.inv, def = EQUIPMENT.sentry, item = def.slotItem!, short = itemDef(item).short, max = itemDef(item).stackMax;
    loadAboard(h, [aboardRec('sentry', 1, -2.2, 0.3, Math.PI / 2)]);
    run(h, 0.3);
    const u = eq.unit('eq-1')!;
    expect(u.plug).toBeNull(); // (out of every plug's reach: its slots do not need a plug)
    expect(u.slots).toHaveLength(SENTRY_FEED_SLOTS);
    const a = inv.makeStack(item, max), b = inv.makeStack(item, 80), nine = inv.makeStack('ammo_9mm', 30);
    for (const st of [a, b, nine]) expect(inv.add(st)).toBe(0);
    const total = () => inv.count(item) + u.ammo;
    expect(total()).toBe(max + 80);
    faceOf(h, u);
    expect(aimOf(eq)).toEqual([u.uid, 'module']);
    expect(eq.prompt).toBe(store.prompt(u));
    expect(eq.prompt).toContain(`${STORE_TEXT.openFeed(def.the, 0, short)} · ${SENTRY_TEXT.unplugged}`);
    // a tap opens the sentry's own view over ITS slots (never the chest's view, never a grab, nothing loaded by itself)
    tapE(h);
    expect([store.isOpen, store.unit === u, store.qa().view]).toEqual([true, true, 'sentryview']);
    expect(store.view.opts).toMatchObject({slots: SENTRY_FEED_SLOTS, stow: false, the: def.the});
    expect([u.ammo, inv.count(item), uidOf(eq.grab?.unit)]).toEqual([0, max + 80, null]);
    expect(eq.storesAboard().map(x => x.uid)).toEqual([]); // (a feed is not a store the bench crafts from)
    // a click moves a carried stack across; a drag puts one into a chosen slot; the same stacks (uids), no round made or lost
    const at = (st: {uid: number}) => inv.find(st.uid)!;
    expect(store.view.quick(at(a))).toBe(max);
    expect(u.slots![0]).toBe(a);
    expect(store.view.move(at(b), {bar: 'store', index: 2})).toBe('moved');
    expect(u.slots![2]).toBe(b);
    expect([u.ammo, inv.count(item), total()]).toEqual([max + 80, 0, max + 80]);
    expect(eq.aboard()[0].slots).toEqual([{uid: a.uid, itemId: item, count: max}, null, {uid: b.uid, itemId: item, count: 80}, null]);
    expect(eq.aboard()[0].ammo).toBeUndefined();
    expect(eq.maxUid()).toBe(Math.max(a.uid, b.uid));
    // anything else is refused where it is, with the reason — by the click, by the drag, and as a swap onto a full slot
    const where = at(nine);
    expect(store.view.quick(where)).toBe(0);
    expect(inv.refusal).toEqual({code: 'wrong-slot', text: feedRule(def).accepts('ammo_9mm')});
    expect(store.view.move(where, {bar: 'store', index: 1})).toBe('refused');
    expect(store.view.move(where, {bar: 'store', index: 0})).toBe('refused');
    expect(inv.get(where)).toBe(nine);
    expect(u.slots!.map(st => st?.uid ?? null)).toEqual([a.uid, null, b.uid, null]);
    // half a stack back out (a split: the new stack has its own uid), then the rest by a click
    const free = inv.pack.findIndex(st => st === null);
    expect(store.view.move({bar: 'store', index: 0}, {bar: 'pack', index: free}, 50)).toBe('split');
    expect([u.slots![0]!.count, inv.pack[free]!.count, inv.pack[free]!.uid === a.uid]).toEqual([max - 50, 50, false]);
    expect(total()).toBe(max + 80);
    expect(store.view.quick({bar: 'store', index: 2})).toBe(80);
    expect([u.ammo, inv.count(item), total()]).toEqual([max - 50, 130, max + 80]);
    expect(inv.invariants()).toEqual([]);
    // the turret's own draw is the unit's takeAmmo: whole rounds out of the slots, an emptied slot free again, never below nothing
    expect(u.takeAmmo(1)).toBe(1);
    expect(u.takeAmmo(1e9)).toBe(max - 51);
    expect([u.ammo, u.takeAmmo(1), u.slots!.every(st => st === null)]).toEqual([0, 0, true]);
    expect(inv.count(item)).toBe(130); // (carried rounds are never the turret's)
    // [E] (the view's own captured key) closes it
    store.onKeyCapture(key('KeyE'));
    expect(store.isOpen).toBe(false);
    frame(h);
    expect(eq.prompt).toContain(STORE_TEXT.openFeed(def.the, 0, short));
    expect(sentry.qa()).toMatchObject({unit: null, plugged: false});
  });

  it('active(\'sentry\') is the unit plugged into the PARKED car: the turret system reads it; riding it is none (the rounds stay)', async () => {
    const {h, eq, sentry, ride} = world();
    const s0 = plugSpot(0);
    // (an older save's record: a count of rounds — real stacks in its slots from the first frame)
    loadAboard(h, [aboardRec('sentry', 1, -2.2, 0.3, Math.PI / 2, {ammo: 40})]);
    run(h, 0.3);
    const u = eq.unit('eq-1')!;
    expect(u.slots!.map(st => st && [st.itemId, st.count])).toEqual([[EQUIPMENT.sentry.slotItem, 40], null, null, null]);
    expect([uidOf(eq.active('sentry')), sentry.qa().unit, sentry.qa().plugged]).toEqual([null, null, false]);
    putLocal(h, u, s0.x, s0.z, Math.PI / 2);
    h.toasts.length = 0;
    run(h, 0.2);
    expect(u.plug).toBe(0);
    expect(h.toasts).toContain(EQUIPMENT_TEXT.pluggedIn(u.def.name));
    expect(eq.active('sentry') === u).toBe(true);
    expect(sentry.qa()).toMatchObject({unit: 'eq-1', plugged: true, ammo: 40});
    // on the console: the prompt no longer says "not plugged in"
    faceOf(h, u);
    expect(eq.prompt).toContain(STORE_TEXT.openFeed(u.def.the, 40, itemDef(EQUIPMENT.sentry.slotItem!).short));
    expect(eq.prompt).not.toMatch(/not plugged in/);
    // riding: plugged, not active; the console cannot be used; the rounds ride along
    void ride.depart();
    run(h, 0.2);
    expect(ride.riding).toBe(true);
    expect([u.mode, u.plug, eq.plugged('sentry') === u, uidOf(eq.active('sentry'))]).toEqual(['cargo', 0, true, null]);
    expect(sentry.qa()).toMatchObject({unit: null, plugged: false});
    expect(eq.prompt).toBeNull();
    expect(eq.onInteract()).toBe(false);
    expect(u.ammo).toBe(40);
    expect(eq.aboard()[0]).toMatchObject({uid: 'eq-1', plug: 0});
    expect([eq.aboard()[0].ammo, equipmentRounds(eq.aboard()[0])]).toEqual([undefined, 40]);
    ride.reset();
    await Promise.resolve();
    run(h, 0.3);
    expect([u.mode, u.plug, eq.active('sentry') === u]).toEqual(['world', 0, true]);
    expect(sentry.qa()).toMatchObject({unit: 'eq-1', plugged: true, ammo: 40});
  });
});

describe('the scanner\'s console, the radar and the equipment system', () => {
  it('unplugged, the scanner\'s tap falls through to the grab; plugged in, it opens the scope; unplugging closes it through the listener', () => {
    const {h, eq, scanner, scope} = world();
    const s1 = plugSpot(1), e1 = equipmentPlugs(SPEC)[1];
    loadAboard(h, [aboardRec('scanner', 1, -3.9, 0.3, -Math.PI / 2)]);
    run(h, 0.3);
    const u = eq.unit('eq-1')!;
    expect(u.plug).toBeNull();
    // unplugged: the console says so, and [E] on it grabs the hand truck (the scanner's tap answered false)
    faceOf(h, u);
    expect(aimOf(eq)).toEqual([u.uid, 'module']);
    expect(eq.prompt).toBe(SCANNER_TEXT.unplugged);
    press(h, 'KeyE');
    expect(uidOf(eq.grab?.unit)).toBe(u.uid);
    expect([uidOf(scanner.openUnit), scope.opened, eq.counts.taps]).toEqual([null, 0, 1]);
    press(h, 'KeyE');
    expect(uidOf(eq.grab?.unit)).toBeNull();
    // rolled to plug 1: plugged in
    putLocal(h, u, s1.x, s1.z, -Math.PI / 2);
    run(h, 0.2);
    expect(u.plug).toBe(1);
    expect(eq.active('scanner') === u).toBe(true);
    expect(scanner.unitActive(u)).toBe(true);
    // [E] on the console opens the scope — no grab, still plugged
    faceOf(h, u);
    expect(eq.prompt).toBe(SCANNER_TEXT.open(scanner.clock.seconds));
    press(h, 'KeyE');
    expect(scanner.openUnit === u).toBe(true);
    expect([uidOf(eq.grab?.unit), u.plug, scope.opened]).toEqual([null, 1, 1]);
    // [E] again closes it (the scanner's own handler, first in line): the equipment system is not asked
    const taps = eq.counts.taps;
    press(h, 'KeyE');
    expect([uidOf(scanner.openUnit), scanner.lastClose, uidOf(eq.grab?.unit), u.plug, eq.counts.taps]).toEqual([null, 'key', null, 1, taps]);
    // open again, then the handle is grabbed: [E] first closes the scope, the next [E] grabs — unplugged with the note
    press(h, 'KeyE');
    expect(scanner.openUnit === u).toBe(true);
    handleOf(h, u);
    press(h, 'KeyE');
    expect([uidOf(scanner.openUnit), uidOf(eq.grab?.unit)]).toEqual([null, null]);
    press(h, 'KeyE');
    expect(uidOf(eq.grab?.unit)).toBe(u.uid);
    expect(u.plug).toBeNull();
    expect(h.toasts).toContain(EQUIPMENT_TEXT.unplugged(u.def.name));
    expect(uidOf(eq.active('scanner'))).toBeNull();
    press(h, 'KeyE');
    // back on the plug with the scope open: shoved out of reach, the cable pulls free and the scope closes (the plug listener)
    putLocal(h, u, s1.x, s1.z, -Math.PI / 2);
    run(h, 0.2);
    expect(u.plug).toBe(1);
    faceOf(h, u);
    press(h, 'KeyE');
    expect(scanner.openUnit === u).toBe(true);
    const p = h.trainPlacement!;
    for (let i = 0; i < 40 && u.plug !== null; i++) { u.body.vx = -p.front * 1.4; u.body.vz = 0; u.awake = true; run(h, 0.25); }
    expect(u.plug).toBeNull();
    const q = worldToTrain(p, u.body.x, u.body.y, u.body.z);
    expect(Math.hypot(q.x - e1.x, q.z - e1.z)).toBeGreaterThan(PLUG.reach);
    expect([uidOf(scanner.openUnit), scanner.lastClose]).toEqual([null, 'inactive']);
    expect(h.toasts).toContain(EQUIPMENT_TEXT.pulled(u.def.name));
  });

  it('the route radar: the map reveals two stops out exactly while a radar is plugged in (parked or riding)', async () => {
    const {h, eq, ride} = world();
    const s2 = plugSpot(2);
    loadAboard(h, [aboardRec('radar', 1, -3.9, 0.3), aboardRec('scanner', 2, -2.2, 0.3)]);
    run(h, 0.3);
    const radar = eq.unit('eq-1')!, other = eq.unit('eq-2')!;
    expect([radar.plug, other.plug, eq.routeRadius()]).toEqual([null, null, 1]);
    // another kind on a plug does not count
    putLocal(h, other, s2.x, s2.z);
    run(h, 0.2);
    expect([other.plug, eq.routeRadius()]).toEqual([2, 1]);
    const s0 = plugSpot(0);
    putLocal(h, radar, s0.x, s0.z);
    run(h, 0.2);
    expect([radar.plug, eq.routeRadius()]).toEqual([0, 2]);
    // riding: still plugged (the console's map at the next stop reads it)
    void ride.depart();
    run(h, 0.2);
    expect([radar.mode, eq.routeRadius()]).toEqual(['cargo', 2]);
    ride.reset();
    await Promise.resolve();
    run(h, 0.3);
    // grabbed: unplugged, one stop again
    handleOf(h, radar);
    press(h, 'KeyE');
    expect(uidOf(eq.grab?.unit)).toBe(radar.uid);
    expect([radar.plug, eq.routeRadius()]).toEqual([null, 1]);
    press(h, 'KeyE');
  });
});
