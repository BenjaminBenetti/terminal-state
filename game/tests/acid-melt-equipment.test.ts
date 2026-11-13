// Task studio-refinement-batch-20261113-035659-01 (lane MELT; user: "Melt world props including containers/portable devices ...
// Containers physically spill real contents, conserving UIDs/rounds ... Portable cargo/containers/devices NOT protected merely by being
// aboard"): the crafted train equipment (TrainEquipmentSystem LiveUnits: chest / sentry / radar ...) and the fuel carts under acid
// (world/acidMelt.ts), over the real station build with the real train, ride, carts and equipment (helpers/acidMeltHost.ts):
//  - candidates wherever they stand — on the platform and aboard the parked car;
//  - a chest's stacks spill as the SAME objects (uid / mag / count), a sentry's feed stacks too and its legacy rounds as real stacks of
//    its feed item (every round conserved); salvage by trait (a plug-in device: electrical parts; the chest: scrap metal);
//  - the unit leaves its system at once (never grabbed / plugged / recorded again): the station lane and the train's record drop it;
//  - a fuel cart's units become fuel cans (FUEL.canUnits each, stacks of FUEL.canStackMax: every unit conserved), scrap salvage, the
//    cart out of the carts and their records.
import {afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {EQUIPMENT, STATION_EQUIPMENT_LANE, type EquipmentJSON} from '../src/craft/equipment';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {FUEL} from '../src/fuel/fuel';
import type {ItemStack, StackJSON} from '../src/items/inventory';
import {MELT} from '../src/world/acidMelt';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {aboardRec, loadAboard, stationRec} from './helpers/trainEquipmentHost';
import {enterStation, leaveStation, meltStation, pickupsOf, step, type MeltRig} from './helpers/acidMeltHost';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const SUB = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

const SALVAGE = new Set<string>([ELECTRICAL_PARTS, SCRAP_METAL]);
const salvageOf = (c: MeltRig) => pickupsOf(c).filter(p => SALVAGE.has(p.itemId));

/**
 * The station: on the platform a storage chest (a pistol with 3 rounds in its magazine, two medkits), a sentry with two feed stacks and
 * a sentry from a record older than its feed slots (25 rounds aside); aboard the parked car a route radar; on the platform a fuel cart of
 * 5 units.
 */
function world() {
  const L0 = SUB(), p = playerTrainPlacement(L0)!;
  const at = (lx: number) => trainToWorld(p, lx, SPEC.floorY, -3);
  const feed = new Array<StackJSON | null>(EQUIPMENT.sentry.slots).fill(null);
  feed[0] = {uid: 9101, itemId: 'ammo_556', count: 120};
  feed[EQUIPMENT.sentry.slots - 1] = {uid: 9102, itemId: 'ammo_556', count: 17};
  const chestSlots = new Array<StackJSON | null>(EQUIPMENT.chest.slots).fill(null);
  chestSlots[0] = {uid: 9001, itemId: 'pistol', count: 1, mag: 3};
  chestSlots[7] = {uid: 9002, itemId: 'medkit', count: 2};
  const legacy: EquipmentJSON = {...stationRec('sentry', 3, at(5.6).x, p.floorY, at(5.6).z, 0, p.level), ammo: 25};
  delete legacy.slots;
  const here = [
    stationRec('chest', 1, at(1.5).x, p.floorY, at(1.5).z, 0, p.level, {slots: chestSlots}),
    stationRec('sentry', 2, at(3.6).x, p.floorY, at(3.6).z, 0, p.level, {slots: feed}),
    legacy,
  ];
  const c = meltStation(L0, {here});
  live.push(c.rt);
  loadAboard(c.h, [aboardRec('radar', 4, -2.2, 0.3)]);
  const w = enterStation(c, SUB());
  const cw = trainToWorld(p, -3.5, SPEC.floorY, -2.8);
  c.carts.spawn({uid: 'cart:A', units: 5, x: cw.x, y: c.h.levels!.floorAt(cw.x, cw.z, p.floorY + 0.3), z: cw.z, yaw: Math.atan2(0, -p.platformSide), level: p.level});
  return {c, w, p};
}

const unit = (c: MeltRig, uid: string) => c.eq.units().find(u => u.uid === uid) ?? null;
/** The unit's ref through the seam (a disc over its base). */
function unitRef(c: MeltRig, uid: string) {
  const u = unit(c, uid)!;
  const r = c.melt.inDisc(u.body.x, u.body.y, u.body.z, 0.1).find(x => x.key === `eq:${uid}`);
  if (!r) throw new Error(`no ref for ${uid}`);
  return r;
}

describe('acid melt: crafted equipment and fuel carts', () => {
  it('units and carts are candidates wherever they stand: on the platform and aboard the parked car (portable devices)', () => {
    const {c, p} = world();
    for (const uid of ['eq-1', 'eq-2', 'eq-3', 'eq-4']) expect(unit(c, uid)?.mode, uid).toBe('world');
    const mid = trainToWorld(p, 0, SPEC.floorY, 0);
    const aboard = c.melt.inDisc(mid.x, p.floorY, mid.z, SPEC.length / 2).map(r => r.key);
    expect(aboard).toContain('eq:eq-4');
    expect(unitRef(c, 'eq-1').label).toBe(EQUIPMENT.chest.name);
    const cart = c.carts.bodies().find(x => x.uid === 'cart:A')!;
    const cr = c.melt.inDisc(cart.body.x, cart.body.y, cart.body.z, 0.2).find(r => r.key === 'cart:cart:A');
    expect(cr?.label).toBe('fuel cart');
    // the canister touching a unit's side sticks to it
    const u = unit(c, 'eq-2')!;
    expect(c.melt.atPoint(u.body.x + u.def.radius, u.body.y + 0.4, u.body.z, 0.1)?.key).toBe('eq:eq-2');
  }, 60000);

  it('a chest\'s stacks spill as the SAME objects (uid / mag / count); scrap salvage; the unit leaves its system and the station lane', () => {
    const {c, w} = world();
    const u = unit(c, 'eq-1')!;
    const held = u.store!.slots.filter((s): s is ItemStack => !!s);
    expect(held.map(s => [s.uid, s.itemId, s.count, s.mag])).toEqual([[9001, 'pistol', 1, 3], [9002, 'medkit', 2, undefined]]);
    const r = unitRef(c, 'eq-1');
    expect(c.melt.start(r)).toBe(true);
    expect(unit(c, 'eq-1')).toBeNull(); // (out of its system from the start: never grabbed / opened / recorded while it dissolves)
    expect(c.melt.alive(r)).toBe(true);
    step(c, MELT.seconds + 0.1);
    expect(c.melt.alive(r)).toBe(false);
    const got = pickupsOf(c).filter(p => !SALVAGE.has(p.itemId));
    expect(got.map(p => p.stack)).toEqual(expect.arrayContaining(held));
    for (const s of held) expect(got.find(p => p.stack === s), `uid ${s.uid}`).toBeTruthy();
    expect(got.find(p => p.uid === 9001)?.mag).toBe(3);
    expect(salvageOf(c).map(s => s.itemId)).toEqual([SCRAP_METAL]);
    leaveStation(c);
    const lane = c.h.run.laneStore<{here: EquipmentJSON[]}>(STATION_EQUIPMENT_LANE, w.key);
    expect(lane?.here.map(x => x.uid).sort()).toEqual(['eq-2', 'eq-3']);
  }, 60000);

  it('sentries: feed stacks reused, legacy rounds become real stacks of the feed item — every round conserved; electrical salvage', () => {
    const {c} = world();
    const fed = unit(c, 'eq-2')!.store!.slots.filter((s): s is ItemStack => !!s);
    const legacy = unit(c, 'eq-3')!;
    expect(legacy.legacyAmmo).toBe(25);
    expect(c.melt.start(unitRef(c, 'eq-2'))).toBe(true);
    expect(c.melt.start(unitRef(c, 'eq-3'))).toBe(true);
    step(c, MELT.seconds + 0.1);
    const ammo = pickupsOf(c).filter(p => p.itemId === EQUIPMENT.sentry.slotItem);
    expect(ammo.reduce((n, p) => n + p.count, 0)).toBe(120 + 17 + 25);
    for (const s of fed) expect(ammo.find(p => p.stack === s), `uid ${s.uid}`).toBeTruthy();
    expect(new Set(ammo.map(p => p.uid)).size).toBe(ammo.length);
    expect(salvageOf(c).map(s => s.itemId)).toEqual([ELECTRICAL_PARTS, ELECTRICAL_PARTS]);
  }, 60000);

  it('a radar aboard melts too (not protected by being aboard): electrical salvage; the train\'s equipment record drops it', () => {
    const {c} = world();
    expect(c.h.playerTrain.equipment.records().map(r => r.uid)).toEqual(['eq-4']);
    expect(c.melt.start(unitRef(c, 'eq-4'))).toBe(true);
    step(c, MELT.seconds + 0.1);
    expect(salvageOf(c).map(s => s.itemId)).toEqual([ELECTRICAL_PARTS]);
    expect(c.h.playerTrain.equipment.records()).toEqual([]);
    leaveStation(c);
    expect(c.h.playerTrain.equipment.records()).toEqual([]);
  }, 60000);

  it('a fuel cart: its units become fuel cans (every unit conserved, stacks of at most FUEL.canStackMax); scrap salvage; out of the carts and their records', () => {
    const {c} = world();
    const cart = c.carts.bodies().find(x => x.uid === 'cart:A')!;
    const r = c.melt.inDisc(cart.body.x, cart.body.y, cart.body.z, 0.2).find(x => x.key === 'cart:cart:A')!;
    expect(c.melt.start(r)).toBe(true);
    expect(c.carts.bodies().some(x => x.uid === 'cart:A')).toBe(false);
    step(c, MELT.seconds + 0.1);
    const cans = pickupsOf(c).filter(p => p.itemId === FUEL.canItem);
    expect(cans.reduce((n, p) => n + p.count * FUEL.canUnits, 0)).toBe(5);
    for (const p of cans) expect(p.count).toBeLessThanOrEqual(FUEL.canStackMax);
    expect(salvageOf(c).map(s => s.itemId)).toEqual([SCRAP_METAL]);
    expect(c.carts.stationRecords().some(x => x.uid === 'cart:A')).toBe(false);
    expect(c.carts.all().some(x => x.uid === 'cart:A')).toBe(false);
    // cleared later / torn down: nothing twice
    c.melt.clear();
    leaveStation(c);
    expect(pickupsOf(c)).toHaveLength(0);
    expect(c.melt.counts.salvage).toBe(1);
    expect(c.carts.stationRecords().some(x => x.uid === 'cart:A')).toBe(false);
  }, 60000);
});
