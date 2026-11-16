// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK, follow-up 1; lead: "With CARGO for real: secure a real depot unit (CARGO
// seeds them from layout.surface.depot.recoverables) on one of your 6 bed points, drive, the unit follows rigidly; teardown/rebuild
// (re-entry) -> same point, same uid/contents; release it at the checkpoint"): THE REAL TRUCK CARRYING A REAL DEPOT UNIT on a generated
// district (helpers/surfaceTruckCargo.ts: the vehicle controller + the truck + the district cargo + the train equipment in Game's order;
// no fake truck) —
//  - the depot's recoverables are seeded once into the district at the first entry; the chest among them keeps its seeded salvage;
//  - the truck is driven (keys only) from the checkpoint to the depot's loading lot; the chest, carried out of the depot, is secured on a
//    rear bed point with [E] (the prompt names the truck); refused while the truck moves or the player sits in it;
//  - driven back to the checkpoint along real streets the chest is exactly at its point's pose EVERY frame (no physics, no lag, one view);
//  - to the station and back (teardown / rebuild): the truck where it was left, the chest on the same point, the same uid and contents —
//    one unit, one place, never re-seeded;
//  - [E] at it takes it off at the checkpoint (into the hands), put down on the compound: the district's again, contents intact.
// Test shortcut (said plainly): the walk between the depot's floor and the lot is a placement of the player (Player.place) with the chest
// in the hands; everything else is the systems' own frames.
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {EQUIPMENT_TEXT, type LiveUnit} from '../src/world/trainEquipment';
import {equipmentBox} from '../src/world/trainEquipmentModel';
import {CARGO_TEXT} from '../src/world/surface/cargo';
import {SURFACE_CARGO_LANE, securedOf} from '../src/world/surface/cargoStore';
import {STATION_EQUIPMENT_LANE, type EquipmentJSON} from '../src/craft/equipment';
import {carToWorld} from '../src/world/skywaysCarSpec';
import {TRUCK_SPEC} from '../src/world/surface/truckSpec';
import {TRUCK_CARGO_TEXT} from '../src/world/surface/truckVehicle';
import {frame, press, run} from './helpers/skywaysCarHost';
import {holdE, lookAtUnit, stand} from './helpers/trainEquipmentHost';
import {DISTRICT, STATION} from './helpers/surfaceCargoHost';
import {getInTruck} from './helpers/surfaceTruckHost';
import {district, driveRoute, loadingLot, planRoute} from './helpers/surfaceTruckDistrict';
import {enterDistrict, enterStation, leave, truckCargoWorld, type TruckCargoWorld} from './helpers/surfaceTruckCargo';

installCanvasShim(false);

const LABEL = CARGO_TEXT.label;
const stacksOf = (u: {slots?: EquipmentJSON['slots'] | LiveUnit['slots']}) => (u.slots ?? []).map(s => s && [s.uid, s.itemId, s.count]);
const prompt = (w: TruckCargoWorld) => w.h.promptProviders.map(f => f()).find(Boolean) ?? null;

/** Every record of the run naming each uid (the train's, both sections' equipment lanes and secured lists), the live world flushed first. */
function recordUids(w: TruckCargoWorld): string[] {
  w.eq.flush();
  const out: string[] = [];
  for (const r of w.h.playerTrain.equipment.records()) out.push(r.uid);
  for (const k of [STATION, DISTRICT]) {
    for (const r of w.h.run.laneStore<{here: EquipmentJSON[]}>(STATION_EQUIPMENT_LANE, k)?.here ?? []) out.push(r.uid);
    for (const m of securedOf(w.h.run.laneStore(SURFACE_CARGO_LANE, k))) out.push(m.unit.uid);
  }
  return out.sort();
}

/** The unit exactly at the truck's point `id` now (its body and its one view). */
function atPoint(w: TruckCargoWorld, u: LiveUnit, id: string): number {
  const p = w.car.truckAttachPoints().find(q => q.id === id)!;
  const g = u.view.group;
  return Math.max(Math.abs(u.body.x - p.x), Math.abs(u.body.y - p.y), Math.abs(u.body.z - p.z), Math.abs(u.body.yaw - p.yaw),
    Math.abs(g.position.x - p.x), Math.abs(g.position.y - p.y), Math.abs(g.position.z - p.z));
}

/** Pick the chest up (E held, looking at its lid) from whichever side of it the player can stand on. */
function carryChest(w: TruckCargoWorld, chest: LiveUnit): void {
  const K = equipmentBox(chest.def).body;
  for (let k = 0; k < 4 && w.eq.held !== chest; k++) {
    const b = chest.body, a = b.yaw + (k * Math.PI) / 2;
    stand(w.h, b.x + Math.sin(a) * 1.1, b.z + Math.cos(a) * 1.1, a, b.y);
    frame(w.h, w.car);
    lookAtUnit(w.h, chest, 0, K.y1 - 0.05, 0);
    frame(w.h, w.car);
    holdE(w.h);
  }
  expect(w.eq.held, 'the chest is in the hands').toBe(chest);
}

/** Stand behind the parked truck (on its left half), facing it. */
function behindTruck(w: TruckCargoWorld): void {
  const b = w.car.body!, p = carToWorld(b.x, b.z, b.yaw, -0.5, TRUCK_SPEC.length / 2 + 0.6);
  stand(w.h, p.x, p.z, b.yaw);
  frame(w.h, w.car);
}

describe('the real truck carrying a real depot unit (district cargo, generated district)', () => {
  it('a depot chest secured on a bed point at the loading lot rides rigidly to the checkpoint, survives re-entry and is taken off there', () => {
    // (re-pin, follow-up lane FIXES: a new depot seeds one train upgrade, never a chest — a depot seeded under the whole-collection rule)
    const D = district(3, 'subway'), w = truckCargoWorld(D, {legacyDepot: true}), {h, eq, car} = w;
    // the depot's recoverables, seeded once into the district before this entry (fresh run uids; the chest with its salvage): none more
    expect(w.cargo.counts).toMatchObject({seeded: 0, seededUnits: 0});
    const seeded = eq.all().map(u => u.uid);
    expect(seeded.length).toBe(D.S.depot.recoverables.length);
    const chest = eq.all().map(u => eq.unit(u.uid)!).find(u => u.kind === 'chest')!;
    expect(chest, 'the depot has a chest').toBeTruthy();
    const uid = chest.uid, stacks = stacksOf(chest);
    expect(stacks.filter(Boolean).length, 'the chest holds the depot salvage').toBeGreaterThan(0);
    expect(car.vehicle).toBe('truck');
    expect(car.truckAttachPoints().length).toBe(6);

    // 1. from the checkpoint to the depot's loading lot (the keys only)
    getInTruck(h, car);
    const lot = loadingLot(D), b0 = car.body!;
    const out = driveRoute(h, car, planRoute(D, {x: b0.x, z: b0.z}, lot)!, lot, {speed: 6.5});
    expect([out.arrived, out.stuck], `to the lot: ${JSON.stringify(out)}`).toEqual([true, false]);
    // seated: nothing may be secured (the truck's own rule, the cargo's text)
    expect(car.cargoBlock()).toBe(TRUCK_CARGO_TEXT.seated);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    run(h, car, 0.3);

    // 2. the chest out of the depot, to the back of the truck; [E] secures it on a rear bed point
    carryChest(w, chest);
    behindTruck(w);
    expect(prompt(w)).toBe(EQUIPMENT_TEXT.secure(chest.def.the, LABEL));
    press(h, car, 'KeyE');
    expect([chest.mode, eq.held]).toEqual(['mount', null]);
    const point = chest.mount!;
    expect(point, 'a rear bed point (the nearer of the two in front of the player)').toBe('bed-rear-left');
    expect(h.toasts).toContain(EQUIPMENT_TEXT.secured(chest.def.name, LABEL));
    expect(atPoint(w, chest, point)).toBe(0);
    expect(eq.mountRecords().map(m => [m.point, m.unit.uid])).toEqual([[point, uid]]);
    expect(eq.aboard()).toEqual([]);
    expect(recordUids(w)).toEqual([...seeded].sort());

    // 3. back to the checkpoint along real streets: the chest at its point's pose every frame
    getInTruck(h, car);
    const cp = D.S.checkpoint.rect, b1 = car.body!;
    let frames = 0, worst = 0, turned = 0;
    const yaw0 = b1.yaw;
    const back = driveRoute(h, car, planRoute(D, {x: b1.x, z: b1.z}, cp)!, cp, {
      speed: 6.5, stuckS: 12,
      each: () => { frames++; worst = Math.max(worst, atPoint(w, chest, point)); turned = Math.max(turned, Math.abs(car.body!.yaw - yaw0)); },
    });
    expect([back.arrived, back.stuck], `back to the checkpoint: ${JSON.stringify(back)}`).toEqual([true, false]);
    expect(frames).toBeGreaterThan(600);
    expect(worst, 'the chest never leaves its point while the truck drives and turns').toBe(0);
    expect(turned).toBeGreaterThan(0.5);
    expect([chest.mode, chest.mount, chest.body.vx, chest.body.vz, chest.awake]).toEqual(['mount', point, 0, 0, false]);
    expect(eq.group.children.filter(c => c.name === `train-equipment:${uid}`).length).toBe(1);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    const parked = {x: car.body!.x, z: car.body!.z, yaw: car.body!.yaw};

    // 4. to the station and back (teardown / rebuild): the truck where it was left, the chest on the same point, same uid / contents
    leave(w);
    enterStation(w);
    frame(h, car);
    expect(car.body).toBeNull();
    expect(eq.all().map(u => u.uid)).toEqual([]);
    expect(recordUids(w)).toEqual([...seeded].sort());
    leave(w);
    enterDistrict(w);
    frame(h, car);
    expect(w.cargo.counts.seeded, 'never re-seeded').toBe(0);
    const B = car.body!;
    // (the record keeps 4 decimals; the heading is compared as an angle — the record may wrap it by a whole turn)
    const dYaw = Math.abs(Math.atan2(Math.sin(B.yaw - parked.yaw), Math.cos(B.yaw - parked.yaw)));
    expect(Math.max(Math.abs(B.x - parked.x), Math.abs(B.z - parked.z), dYaw)).toBeLessThan(1e-3);
    const c2 = eq.unit(uid)!;
    expect([c2.mode, c2.mount]).toEqual(['mount', point]);
    expect(atPoint(w, c2, point)).toBe(0);
    expect(stacksOf(c2)).toEqual(stacks);
    expect(eq.all().map(u => u.uid).sort()).toEqual([...seeded].sort());
    expect(recordUids(w)).toEqual([...seeded].sort());

    // 5. released at the checkpoint: [E] at it takes it off (into the hands); put down on the compound, the district's again
    behindTruck(w);
    lookAtUnit(h, c2, 0, 0.3, 0);
    frame(h, car);
    expect(eq.prompt).toBe(EQUIPMENT_TEXT.takeOff(c2.def.the, LABEL));
    press(h, car, 'KeyE');
    expect([c2.mode, eq.held]).toEqual(['held', c2]);
    expect(eq.mountRecords()).toEqual([]);
    // (away from the truck, its points behind the player: [E] puts it down)
    const away = carToWorld(B.x, B.z, B.yaw, -TRUCK_SPEC.width / 2 - 3, 0);
    stand(h, away.x, away.z, B.yaw + Math.PI / 2);
    frame(h, car);
    expect(prompt(w)).toBe(EQUIPMENT_TEXT.putDown(c2.def.the));
    press(h, car, 'KeyE');
    expect([c2.mode, eq.held]).toEqual(['world', null]);
    expect(c2.body.x > cp.x0 && c2.body.x < cp.x1 && c2.body.z > cp.z0 && c2.body.z < cp.z1, 'on the checkpoint compound').toBe(true);
    expect(recordUids(w)).toEqual([...seeded].sort());
    const here = h.run.laneStore<{here: EquipmentJSON[]}>(STATION_EQUIPMENT_LANE, DISTRICT)!.here.find(r => r.uid === uid)!;
    expect(stacksOf(here)).toEqual(stacks);
    expect(securedOf(h.run.laneStore(SURFACE_CARGO_LANE, DISTRICT))).toEqual([]);
  }, 240000);

  it('another district: the parked truck takes a depot chest at its checkpoint pose; refused (the reason in the prompt) while it rolls', () => {
    const D = district(8, 'office'), w = truckCargoWorld(D, {legacyDepot: true}), {eq, car} = w; // (re-pin, lane FIXES: as above)
    const chest = eq.all().map(u => eq.unit(u.uid)!).find(u => u.kind === 'chest')!;
    carryChest(w, chest);
    behindTruck(w);
    expect(prompt(w)).toBe(EQUIPMENT_TEXT.secure(chest.def.the, LABEL));
    // the truck rolling (its speed over the cargo's still limit): the truck's reason — the same words as the cargo's own rule
    car.body!.v = 1.5;
    expect(car.cargoBlock()).toBe(TRUCK_CARGO_TEXT.moving);
    expect(eq.mountChoice(chest)).toEqual({note: CARGO_TEXT.moving});
    expect(prompt(w)).toBe(`${EQUIPMENT_TEXT.putDown(chest.def.the)} · ${CARGO_TEXT.moving}`);
    car.body!.v = 0;
    expect(eq.mountChoice(chest)).toMatchObject({point: {id: 'bed-rear-left'}});
    expect(TRUCK_CARGO_TEXT).toEqual(expect.objectContaining({label: LABEL, moving: CARGO_TEXT.moving, seated: CARGO_TEXT.seated}));
  }, 120000);
});
