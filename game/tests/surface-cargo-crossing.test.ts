// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): A TRAIN UNIT CARRIED ACROSS THE STATION <-> DISTRICT CROSSING
// (world/surface/crossing.ts participant 'cargo' -> world/trainEquipment.ts crossRefuse / crossDepart / crossArrive / crossAbort), in
// Game.crossSurface's order (lane ACCESS): refuse? -> depart (the old world intact) -> teardown -> build -> arrive (the player at the
// arrival pose) — or abort after a failure:
//  - depart takes the GRABBED device out of the old section (its lane rewritten without it, no copy left); until it arrives it is the
//    train's record (a save in between keeps it exactly once); arrive puts it on free floor in front of the arrival pose, grabbed again,
//    and the new section's lane lists it at once — the same uid, the same stacks, both ways;
//  - abort puts it back EXACTLY where it stood (the old world still live: grabbed again) or into the old section's lane;
//  - refuse explains a full destination; a chest in the hands simply stays in them (the train's throughout);
//  - a transit nobody arrived by the first played frame is put down in front of the player (never left in limbo).
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {EQUIPMENT_LIMITS, STATION_EQUIPMENT_LANE, stationEquipmentOf, trainEquipmentProblem} from '../src/craft/equipment';
import {EQUIPMENT_TEXT, type LiveUnit} from '../src/world/trainEquipment';
import {setSurfaceWayAimed, surfaceCrossers, surfaceWayAimed} from '../src/world/surface/crossing';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {equipmentBox} from '../src/world/trainEquipmentModel';
import {frame, run, tapE, teardown} from './helpers/fuelCartsHost';
import {holdE, lookAtUnit, stand, stationRec} from './helpers/trainEquipmentHost';
import {DISTRICT, STATION, districtRoom, recordUids, type District} from './helpers/surfaceCargoHost';

installCanvasShim(false);

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** The district with a loaded sentry (eq-1, handle toward the west) and a chest (eq-2). */
function world() {
  const w = districtRoom({here: [stationRec('sentry', 1, 2.9, 0, 3.2, Math.PI / 2), stationRec('chest', 2, 1.6, 0, 1.4, 0)]});
  const s = w.eq.unit('eq-1')!;
  s.slots![0] = w.h.inv.makeStack('ammo_556', 30);
  s.slots![2] = w.h.inv.makeStack('ammo_556', 7);
  s.touchStore();
  const crosser = surfaceCrossers(w.h).find(c => c.name === 'cargo')!;
  return {...w, crosser, sentry: s};
}

function grab(w: District, u: LiveUnit): void {
  const b = u.body;
  stand(w.h, b.x - Math.sin(b.yaw) * 1.2, b.z - Math.cos(b.yaw) * 1.2, b.yaw + Math.PI, 0);
  frame(w.h);
  lookAtUnit(w.h, u, 0, CART_LOOK.handle.y, CART_LOOK.handle.z);
  frame(w.h);
  holdE(w.h);
  expect(w.eq.grab?.unit).toBe(u);
  run(w.h, 0.2);
}

const stacks = (u: LiveUnit | {slots?: unknown[] | null}) => ((u.slots ?? []) as ({uid: number; itemId: string; count: number} | null)[]).map(s => s && [s.uid, s.itemId, s.count]);
const laneUids = (w: District, key = DISTRICT) => stationEquipmentOf(w.h.run.laneStore(STATION_EQUIPMENT_LANE, key)).map(r => r.uid);

describe('a grabbed device crosses with the player', () => {
  it('depart -> teardown -> build -> arrive, both ways: out of the old section, in front of the arrival pose, grabbed; one unit, one place', () => {
    const w = world(), {eq, h, crosser, sentry} = w;
    const load = stacks(sentry);
    grab(w, sentry);
    expect(crosser.refuse!(DISTRICT, STATION)).toBeNull();
    crosser.depart(DISTRICT, STATION);
    expect([eq.unit('eq-1'), eq.grab, eq.inTransit?.uid]).toEqual([null, null, 'eq-1']);
    expect(laneUids(w)).toEqual(['eq-2']); // (no copy left behind)
    expect(eq.aboard().map(r => r.uid)).toEqual(['eq-1']); // (the train's meanwhile)
    teardown(h);
    // between the two worlds: exactly once, as the train's — a save here is valid and keeps it
    const train = h.playerTrain.equipment.records();
    expect(train.map(r => r.uid)).toEqual(['eq-1']);
    expect(trainEquipmentProblem({v: 1, seq: h.playerTrain.equipment.seq, aboard: train})).toBeNull();
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
    w.enter(STATION, false);
    stand(h, 2, 4.5, Math.PI, 0); // (the arrival pose: facing +Z)
    crosser.arrive(STATION);
    const u = eq.unit('eq-1')!;
    expect([u.mode, eq.grab?.unit === u, eq.inTransit]).toEqual(['world', true, null]);
    expect(Math.hypot(u.body.x - 2, u.body.z - 4.5)).toBeLessThan(1.3);
    expect(u.body.z).toBeGreaterThan(4.5); // (in front of the arrival pose)
    expect(stacks(u)).toEqual(load);
    expect(laneUids(w, STATION)).toEqual(['eq-1']); // (listed at once: an entry snapshot after the arrival has it)
    expect(eq.aboard()).toEqual([]);
    run(h, 0.3);
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
    // and back up with it
    crosser.depart(STATION, DISTRICT);
    expect(laneUids(w, STATION)).toEqual([]);
    teardown(h);
    w.enter(DISTRICT, true);
    stand(h, 2, 2, 0, 0);
    crosser.arrive(DISTRICT);
    expect(eq.all().map(x => [x.uid, x.mode])).toEqual([['eq-1', 'world'], ['eq-2', 'world']]);
    expect(eq.grab?.unit.uid).toBe('eq-1');
    expect(stacks(eq.unit('eq-1')!)).toEqual(load);
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
    expect(eq.counts).toMatchObject({departed: 2, arrived: 2, aborted: 0});
  });

  it('abort with the old world still live: back exactly where it stood, grabbed again the same way round', () => {
    const w = world(), {eq, h, crosser, sentry} = w;
    grab(w, sentry);
    const b = sentry.body, at = [r4(b.x), r4(b.y), r4(b.z)], flip = eq.grab!.flip;
    crosser.depart(DISTRICT, STATION);
    crosser.abort!(DISTRICT);
    const u = eq.unit('eq-1')!;
    expect([u.body.x, u.body.y, u.body.z]).toEqual(at);
    expect([eq.grab?.unit === u, eq.grab?.flip, eq.inTransit]).toEqual([true, flip, null]);
    expect(laneUids(w)).toEqual(['eq-1', 'eq-2']);
    frame(h);
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
  });

  it('abort after the old world went: into the old section\'s lane exactly; it stands there at the next entry', () => {
    const w = world(), {eq, h, crosser, sentry} = w;
    const load = stacks(sentry);
    grab(w, sentry);
    crosser.depart(DISTRICT, STATION);
    const rec = eq.inTransit!;
    teardown(h);
    crosser.abort!(DISTRICT);
    expect(eq.inTransit).toBeNull();
    const lane = stationEquipmentOf(h.run.laneStore(STATION_EQUIPMENT_LANE, DISTRICT));
    expect(lane.find(r => r.uid === 'eq-1')).toEqual(rec);
    expect(h.playerTrain.equipment.records()).toEqual([]);
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
    w.enter(DISTRICT, true);
    frame(h);
    const u = eq.unit('eq-1')!;
    expect([u.mode, u.body.x, u.body.z, stacks(u)]).toEqual(['world', rec.x, rec.z, load]);
  });

  it('refuse: a full destination says why; a chest in the hands crosses in the hands (the train\'s throughout)', () => {
    const w = world(), {eq, h, crosser, sentry, cargo} = w;
    grab(w, sentry);
    const full = Array.from({length: EQUIPMENT_LIMITS.station}, (_, i) => stationRec('radar', 100 + i, 2, 0, 2));
    h.run.setLaneStore(STATION_EQUIPMENT_LANE, {v: 1, here: full}, STATION);
    expect(crosser.refuse!(DISTRICT, STATION)).toBe(EQUIPMENT_TEXT.crossFull(sentry.def.the, EQUIPMENT_LIMITS.station, EQUIPMENT_LIMITS.station));
    h.run.setLaneStore(STATION_EQUIPMENT_LANE, undefined, STATION);
    expect(crosser.refuse!(DISTRICT, STATION)).toBeNull();
    eq.letGo('test');
    // the chest: picked up, carried across (depart / arrive do nothing for it)
    const chest = eq.unit('eq-2')!, K = equipmentBox(chest.def).body;
    stand(h, chest.body.x, chest.body.z + 1.1, 0, 0);
    frame(h);
    lookAtUnit(h, chest, 0, K.y1 - 0.05, 0);
    frame(h);
    holdE(h);
    expect(eq.held).toBe(chest);
    expect(crosser.refuse!(DISTRICT, STATION)).toBeNull();
    crosser.depart(DISTRICT, STATION);
    expect(eq.inTransit).toBeNull();
    teardown(h);
    expect(h.playerTrain.equipment.records().map(r => r.uid)).toEqual(['eq-2']);
    w.enter(STATION, false);
    crosser.arrive(STATION);
    frame(h);
    expect(eq.held?.uid).toBe('eq-2');
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
    expect(cargo.counts.builds).toBe(1); // (one district build: the entry)
  });

  it('(lane ACCESS) at an aimed way [E] yields: neither the grabbed device nor the carried chest is let go / put down there', () => {
    const w = world(), {eq, h, sentry} = w;
    let aimed = true, crossed = 0;
    setSurfaceWayAimed(h, () => aimed);
    // the access runtime's [E] stands in as a handler right after the busy one (in Game it comes before the aimed unit's own [E]): it
    // takes every [E] that reaches it, so the unit surviving an aimed [E] and going at an un-aimed one proves the busy [E] runs first
    const way = () => (crossed++, true);
    const atWay = (on: boolean) => { const i = h.interactHandlers.indexOf(way); if (i >= 0) h.interactHandlers.splice(i, 1); if (on) h.interactHandlers.splice(1, 0, way); };
    h.promptProviders.push(() => (surfaceWayAimed(h) ? 'way' : null));
    grab(w, sentry);
    atWay(true);
    tapE(h);
    expect([eq.grab?.unit.uid, crossed]).toEqual(['eq-1', 1]);
    expect(h.promptProviders.map(f => f()).find(p => p), 'the way\'s prompt, not "let go"').toBe('way');
    aimed = false;
    tapE(h);
    expect([eq.grab, crossed]).toEqual([null, 1]); // (away from the way: [E] lets go as always)
    atWay(false);
    const chest = eq.unit('eq-2')!, K = equipmentBox(chest.def).body;
    stand(h, chest.body.x, chest.body.z + 1.1, 0, 0);
    frame(h);
    lookAtUnit(h, chest, 0, K.y1 - 0.05, 0);
    frame(h);
    holdE(h);
    expect(eq.held).toBe(chest);
    atWay(true);
    aimed = true;
    tapE(h);
    expect([eq.held?.uid, crossed]).toEqual(['eq-2', 2]);
    aimed = false;
    tapE(h);
    expect([eq.held, crossed]).toEqual([null, 2]);
  });

  it('a transit nobody arrived by the first played frame: put down in front of the player, grabbed', () => {
    const w = world(), {eq, h, crosser, sentry} = w;
    grab(w, sentry);
    crosser.depart(DISTRICT, STATION);
    teardown(h);
    w.enter(STATION, false);
    stand(h, 2, 4.5, Math.PI, 0);
    expect(eq.unit('eq-1')).toBeNull();
    frame(h);
    expect([eq.unit('eq-1')?.mode, eq.grab?.unit.uid, eq.inTransit]).toEqual(['world', 'eq-1', null]);
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
  });

  it('a load between the two worlds (the train record restored): the device is the train\'s waiting record, never also in transit', () => {
    const w = world(), {eq, h, crosser, sentry} = w;
    grab(w, sentry);
    crosser.depart(DISTRICT, STATION);
    teardown(h);
    const saved = h.playerTrain.equipment.toJSON();
    h.playerTrain.equipment.load(saved);
    expect(eq.inTransit).toBeNull();
    expect(eq.all().map(x => [x.uid, x.mode])).toEqual([['eq-1', 'pending']]);
    w.enter(STATION, false);
    crosser.arrive(STATION); // (nothing in transit any more: no second copy)
    frame(h);
    expect(eq.all().filter(x => x.uid === 'eq-1').length).toBe(1);
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
  });
});
