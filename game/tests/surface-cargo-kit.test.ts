// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): THE PHYSICAL TRAIN ARMOUR KIT (craft/equipment.ts kind
// 'armor-kit', world/surface/cargoKit.ts) with the REAL train, ride and armour runtime (world/trainArmor.ts, Game.trainUpgrades):
//  - a kit wheeled into the parked car: a tap of [E] on it fits the armour THROUGH THE UPGRADES SEAM and uses the kit up — once, only
//    then; no material is taken (the kit is the materials); it is in no record afterwards;
//  - refusals keep the kit, with the reason: outside the car ("wheel it in"), the armour already fitted, no parked train / moving, an
//    install that says no (its lastRefusal);
//  - the kit is an ordinary dolly unit: dragged (a hold), saved as the train's while in the car, its own uid; the prop classification:
//    movable kinematic dolly body, not storage (no slots), no loose parts baked (the plates are its load, one model).
import {afterEach, describe, expect, it, vi} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {EQUIPMENT, trainEquipmentProblem} from '../src/craft/equipment';
import {ARMOR_TEXT, TrainArmorSystem} from '../src/world/trainArmor';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {EQUIPMENT_TEXT, type LiveUnit} from '../src/world/trainEquipment';
import {trainToWorld, worldToTrain} from '../src/gen/playerTrain';
import {KIT_LOOKS, equipmentBox, equipmentModelKey} from '../src/world/trainEquipmentModel';
import {SurfaceCargo, cargoModelKeys} from '../src/world/surface/cargo';
import {KIT_TEXT, kitUse} from '../src/world/surface/cargoKit';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {SCRAP_METAL} from '../src/items/craftMaterials';
import {run, tapE, teardown} from './helpers/fuelCartsHost';
import {aboardRec, buildWorld, equipStation, holdE, loadAboard, lookAtUnit, platformWorld, stand, stationRec, type EquipTestHost} from './helpers/trainEquipmentHost';

installCanvasShim(false);

let layoutCache: StationLayout | null = null;
const SUBWAY = (): StationLayout => (layoutCache ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: {rt: PlayerTrainRuntime; armor: TrainArmorSystem; h: EquipTestHost}[] = [];
afterEach(() => {
  for (const w of live.splice(0)) {
    w.armor.dispose();
    if (w.rt.train) { w.rt.ride = null; teardown(w.h); }
  }
});

const KIT = 'armor-kit' as const;

/** A generated station with the train, the ride, the equipment, the armour (Game.trainUpgrades) and the district cargo's kit use. */
function world(o: {aboard?: ReturnType<typeof aboardRec>[]; platform?: [number, number][]} = {}) {
  const s = equipStation(SUBWAY(), {build: false});
  const {h, eq, rt} = s;
  Object.assign(h, {blastKill: () => {}, fx: {impact: () => {}}});
  const armor = new TrainArmorSystem(h as never, {model: () => null, refreshIcons: () => {}, rendererReady: () => true}).install();
  Object.assign(h, {trainUpgrades: armor});
  const cargo = new SurfaceCargo(h as never).install();
  live.push({rt, armor, h});
  if (o.aboard) loadAboard(h, o.aboard);
  // (units left on the platform: the station's lane before the build — the placement is known before it)
  const here = (o.platform ?? []).map(([lx, lz], i) => { const p = platformWorld(h, lx, lz); return stationRec(KIT, 20 + i, p.x, p.y, p.z, 0, h.trainPlacement!.level); });
  if (here.length) h.run.setLaneStore('train-equipment.here', {v: 1, here});
  buildWorld(h, SUBWAY());
  run(h, 0.3);
  return {...s, armor, cargo};
}

/** Stand in the car's aisle 1.3 m along the car from a unit and look at its middle. */
function besideInCar(h: EquipTestHost, u: LiveUnit): void {
  const p = h.trainPlacement!, q = worldToTrain(p, u.body.x, u.body.y, u.body.z), at = trainToWorld(p, q.x + 1.3, p.floorY, q.z);
  stand(h, at.x, at.z, 0);
  run(h, 0.05);
  lookAtUnit(h, u, 0, 0.55, 0);
  run(h, 0.05);
}

describe('the train armour kit', () => {
  it('a kind of its own: a dolly unit carrying its upgrade, no slots, no plug, its plate model; registered with the district models', () => {
    const def = EQUIPMENT[KIT];
    expect([def.move, def.plug, def.slots, def.upgrade?.id]).toEqual(['dolly', false, 0, 'armor']);
    expect(equipmentModelKey(def)).toBe(KIT_LOOKS.armor.key);
    expect(cargoModelKeys()).toContain(KIT_LOOKS.armor.key);
    // its load: two by two plates of 0.54 x 0.42 m on the nose plate, inside the hand truck's footprint
    const K = KIT_LOOKS.armor, box = equipmentBox(def).body;
    expect([K.rows, K.layers]).toEqual([2, 2]);
    expect(K.size.w).toBeLessThanOrEqual(2 * def.radius + 1e-6);
    expect(box.y1).toBeLessThanOrEqual(def.height + 1e-6);
    expect(K.back).toBeGreaterThan(CART_LOOK.drumZ - CART_LOOK.drumR);
  });

  it('wheeled into the parked car, a tap of [E] fits the armour through the seam and uses the kit up — once', () => {
    const w = world({aboard: [aboardRec(KIT, 1, 1, 0.2)]});
    const {h, eq, armor, rt} = w;
    const u = eq.unit('eq-1')!;
    expect(eq.inParkedCar('eq-1')).toBe(true);
    const scrap = h.inv.count(SCRAP_METAL);
    // look at it from the aisle beside it, inside the car
    besideInCar(h, u);
    expect(eq.aim?.unit).toBe(u);
    expect(eq.prompt).toBe(KIT_TEXT.fit('the train armour') + EQUIPMENT_TEXT.dragHint);
    tapE(h);
    expect([armor.installed('armor'), rt.armorFitted(), eq.unit('eq-1'), eq.counts.consumed]).toEqual([true, true, null, 1]);
    expect(h.toasts).toContain(KIT_TEXT.fitted('the train armour'));
    expect(h.inv.count(SCRAP_METAL)).toBe(scrap); // (the kit is the materials: no second charge)
    // in no record any more: never back from a save
    expect(eq.aboard()).toEqual([]);
    expect(h.playerTrain.equipment.records()).toEqual([]);
    run(h, 0.2);
    expect(eq.counts.consumed).toBe(1);
  });

  it('already fitted: the next kit is refused with the reason and KEPT; outside the car: "wheel it in", kept', () => {
    const w = world({aboard: [aboardRec(KIT, 1, 1, 0.2), aboardRec(KIT, 2, 3.4, 0.2)], platform: [[1, -3]]});
    const {h, eq, armor} = w;
    const use = eq.uses[KIT]!;
    expect(use.tap(eq.unit('eq-1')!)).toBe(true);
    expect(armor.installed('armor')).toBe(true);
    h.toasts.length = 0;
    const second = eq.unit('eq-2')!;
    expect(use.prompt(second)).toBe(KIT_TEXT.refused(second.def.the, ARMOR_TEXT.fitted));
    expect(use.tap(second)).toBe(true);
    expect(h.toasts).toEqual([ARMOR_TEXT.fitted]);
    expect([eq.unit('eq-2'), eq.counts.consumed]).toEqual([second, 1]);
    expect(eq.aboard().map(r => r.uid)).toEqual(['eq-2']);
    expect(trainEquipmentProblem({v: 1, seq: h.playerTrain.equipment.seq, aboard: eq.aboard()})).toBeNull();
    // the one on the platform
    const out = eq.unit('eq-20')!;
    expect([out.mode, eq.inParkedCar('eq-20')]).toEqual(['world', false]);
    h.toasts.length = 0;
    expect(use.prompt(out)).toBe(KIT_TEXT.outside(out.def.the));
    expect(use.tap(out)).toBe(true);
    expect(h.toasts).toEqual([KIT_TEXT.wheelIn(out.def.the, 'the train armour')]);
    expect(eq.unit('eq-20')).toBe(out);
  });

  it('no parked train / an install that says no: the reason, the kit kept, nothing consumed (the seam alone decides)', () => {
    const consume = vi.fn(() => true), toasts: string[] = [];
    const unit = {uid: 'eq-9', def: EQUIPMENT[KIT]} as never;
    const eqFake = {inParkedCar: () => true, consume};
    let api: {installed(): boolean; block(): string | null; install(): boolean; lastRefusal?: string | null} | null = null;
    const use = kitUse({equipment: () => eqFake, upgrades: () => api as never, toast: t => { toasts.push(t); }});
    expect(use.tap(unit)).toBe(true);
    expect(toasts).toEqual([KIT_TEXT.noTrain]);
    api = {installed: () => false, block: () => ARMOR_TEXT.moving, install: () => true};
    expect(use.tap(unit)).toBe(true);
    api = {installed: () => false, block: () => null, install: () => false, lastRefusal: 'Not now'};
    expect(use.tap(unit)).toBe(true);
    expect(toasts).toEqual([KIT_TEXT.noTrain, ARMOR_TEXT.moving, 'Not now']);
    expect(consume).not.toHaveBeenCalled();
    // a kind without an upgrade is not the kit's business
    expect(use.tap({uid: 'eq-3', def: EQUIPMENT.radar} as never)).toBe(false);
  });

  it('an ordinary dolly unit: held [E] drags it out of the car and back; the train\'s in the car, the station\'s outside', () => {
    const w = world({aboard: [aboardRec(KIT, 1, 1, 0.2)]});
    const {h, eq, armor} = w;
    const u = eq.unit('eq-1')!;
    besideInCar(h, u);
    holdE(h);
    expect(eq.grab?.unit).toBe(u);
    expect(armor.installed('armor')).toBe(false); // (a hold never fits it)
    expect(eq.all()[0]).toMatchObject({uid: 'eq-1', kind: KIT, owner: 'train'});
  });
});
