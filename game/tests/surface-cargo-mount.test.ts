// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO; user: "Give the truck finite, usable storage compartments and
// secure physical attachment points for bulky salvage/upgrade cargo. Preserve each item's identity, contents, condition and pose, truck
// state and sole cargo ownership through transfer, travel, save and re-entry"): TRAIN UNITS SECURED TO THE TRUCK'S ATTACHMENT POINTS
// (world/trainEquipment.ts mode 'mount', world/surface/cargo.ts provider, a fake truck behind world/surface/cargoTypes.ts):
//  - [E] with a grabbed device / a carried chest near a FREE point it FITS secures it: no body in the world, exactly at the point's
//    pose, following the truck rigidly frame by frame; never plugged, never shoved by a bullet; [E] aimed at it takes it off (a device
//    grabbed on free floor, a chest straight into the hands);
//  - refused with the reason in the prompt (E then lets go / puts down as ever): the truck moving, every fitting point taken, too small;
//    no point in reach / only behind the player: nothing said, the usual line;
//  - the secured units are the SECTION's (lane 'surface.cargo'), never the train's or the station lane's: through re-entry and flush
//    the same uid, contents, display mode and pose — one unit, one place; a point gone at re-entry: the unit stands where it was
//    recorded (the station's from then on); no points yet at the build: the record waits and is secured once they come.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {EQUIPMENT_TEXT, EQUIP} from '../src/world/trainEquipment';
import {CARGO_TEXT} from '../src/world/surface/cargo';
import {SURFACE_CARGO_LANE, securedOf} from '../src/world/surface/cargoStore';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {equipmentBox} from '../src/world/trainEquipmentModel';
import {frame, press, run, tapE} from './helpers/fuelCartsHost';
import {holdE, lookAtUnit, stand, stationRec} from './helpers/trainEquipmentHost';
import {DISTRICT, STATION, cross, districtRoom, recordUids, type District} from './helpers/surfaceCargoHost';
import type {LiveUnit} from '../src/world/trainEquipment';

installCanvasShim(false);

const LABEL = CARGO_TEXT.label;

/** The district with a route radar (eq-1, handle toward the west) and a chest holding two stacks (eq-2). */
function world(more: ReturnType<typeof stationRec>[] = []): District & {radar: LiveUnit; chest: LiveUnit} {
  const w = districtRoom({here: [stationRec('radar', 1, 2.9, 0, 3.2, Math.PI / 2), stationRec('chest', 2, 1.6, 0, 1.4, 0), ...more]});
  const chest = w.eq.unit('eq-2')!;
  chest.slots![0] = w.h.inv.makeStack('scrap_metal', 3);
  chest.slots![5] = w.h.inv.makeStack('bandage', 2);
  chest.touchStore();
  return {...w, radar: w.eq.unit('eq-1')!, chest};
}

/** Grab the radar from behind its handle (E held). */
function grabRadar(w: ReturnType<typeof world>): void {
  const b = w.radar.body;
  stand(w.h, b.x - Math.sin(b.yaw) * 1.2, b.z - Math.cos(b.yaw) * 1.2, b.yaw + Math.PI, 0);
  frame(w.h);
  lookAtUnit(w.h, w.radar, 0, CART_LOOK.handle.y, CART_LOOK.handle.z);
  frame(w.h);
  holdE(w.h);
  expect(w.eq.grab?.unit).toBe(w.radar);
}

/** Pick the chest up (E held, looking at its lid from its front). */
function carryChest(w: ReturnType<typeof world>): void {
  const b = w.chest.body, K = equipmentBox(w.chest.def).body;
  stand(w.h, b.x + Math.sin(b.yaw) * 1.1, b.z + Math.cos(b.yaw) * 1.1, b.yaw, 0);
  frame(w.h);
  lookAtUnit(w.h, w.chest, 0, K.y1 - 0.05, 0);
  frame(w.h);
  holdE(w.h);
  expect(w.eq.held).toBe(w.chest);
}

const atPoint = (u: LiveUnit, p: {x: number; y: number; z: number; yaw: number}) => {
  expect([u.body.x, u.body.y, u.body.z, u.body.yaw]).toEqual([p.x, p.y, p.z, p.yaw]);
  const g = u.view.group;
  expect([g.position.x, g.position.y, g.position.z]).toEqual([p.x, p.y, p.z]);
  expect(g.rotation.y).toBeCloseTo(p.yaw, 9);
};

describe('securing train units to the truck', () => {
  it('a grabbed device near a free point it fits: [E] secures it there; it follows the truck rigidly; [E] at it takes it off, grabbed', () => {
    const w = world(), {eq, h, truck, radar} = w;
    grabRadar(w);
    run(h, 0.3);
    // the prompt says what [E] does now: the nearest free point it fits, to the spot ahead (bed-1 is nearer than bed-0)
    frame(h);
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(EQUIPMENT_TEXT.secure(radar.def.the, LABEL));
    press(h, 'KeyE');
    expect([radar.mode, radar.mount, eq.grab]).toEqual(['mount', 'bed-1', null]);
    expect(h.toasts).toContain(EQUIPMENT_TEXT.secured(radar.def.name, LABEL));
    atPoint(radar, truck.point('bed-1'));
    expect(eq.all().find(u => u.uid === 'eq-1')).toMatchObject({mode: 'mount', owner: 'mount'});
    expect(eq.aboard()).toEqual([]); // (the chest lies in the district, the radar is secured: neither is the train's)
    expect(eq.stationRecords().map(r => r.uid)).toEqual(['eq-2']);
    expect(eq.mountRecords().map(m => [m.point, m.unit.uid])).toEqual([['bed-1', 'eq-1']]);
    // the truck drives off and turns: the unit is where its point is, every frame (no physics, no lag, the one view)
    for (let i = 0; i < 30; i++) {
      truck.x += 0.05; truck.yaw += 0.01;
      frame(h);
      atPoint(radar, truck.point('bed-1'));
    }
    expect([radar.body.vx, radar.body.vz, radar.awake, radar.plug]).toEqual([0, 0, false, null]);
    expect(eq.group.children.filter(c => c.name === 'train-equipment:eq-1').length).toBe(1);
    // take it off: stand beside it, look at it — the prompt — [E]: on free floor near the player, grabbed
    const p = truck.point('bed-1');
    stand(h, p.x - 1.3, p.z, -Math.PI / 2, 0);
    frame(h);
    lookAtUnit(h, radar, 0, 0.8, 0);
    frame(h);
    expect(eq.prompt).toBe(EQUIPMENT_TEXT.takeOff(radar.def.the, LABEL));
    tapE(h);
    expect([radar.mode, radar.mount, eq.grab?.unit === radar, eq.counts.unmounted]).toEqual(['world', null, true, 1]);
    expect(radar.body.y).toBe(0);
    expect(Math.hypot(radar.body.x - h.player.x, radar.body.z - h.player.z)).toBeLessThan(1.3);
    expect(eq.mountRecords()).toEqual([]);
  });

  it('a carried chest: [E] secures it with its contents; [E] at it puts it straight back into the hands', () => {
    const w = world(), {eq, h, truck, chest} = w;
    const stacks = chest.slots!.map(s => s && [s.uid, s.itemId, s.count]);
    carryChest(w);
    stand(h, 2.4, 2.6, -Math.PI / 2, 0); // (facing +X: bed-0 is the nearer to the spot ahead)
    frame(h);
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(EQUIPMENT_TEXT.secure(chest.def.the, LABEL));
    press(h, 'KeyE');
    expect([chest.mode, chest.mount, eq.held]).toEqual(['mount', 'bed-0', null]);
    atPoint(chest, truck.point('bed-0'));
    expect(chest.view.group.parent).toBe(eq.group);
    expect(eq.aboard()).toEqual([]); // (in the hands it was the train's; secured it is the district's)
    expect(eq.mountRecords()[0].unit.slots!.map(s => s && [s.uid, s.itemId, s.count])).toEqual(stacks);
    lookAtUnit(h, chest, 0, 0.3, 0);
    frame(h);
    tapE(h);
    expect([chest.mode, eq.held]).toEqual(['held', chest]);
    expect(chest.slots!.map(s => s && [s.uid, s.itemId, s.count])).toEqual(stacks);
  });

  it('refusals: moving (the reason in the prompt; [E] lets go as ever), every fitting point taken, too small; nothing behind the player', () => {
    const w = world(), {eq, h, truck, radar} = w;
    grabRadar(w);
    run(h, 0.3);
    truck.block = CARGO_TEXT.moving;
    frame(h);
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(`${EQUIPMENT_TEXT.letGo(radar.def.the)} · ${CARGO_TEXT.moving}`);
    press(h, 'KeyE');
    expect([radar.mode, eq.grab]).toEqual(['world', null]);
    // (the truck's own rule gives way to CARGO's: the seat / the body's speed)
    truck.block = null;
    // both bed points taken by the truck's own things: the small one does not fit a hand truck
    truck.occupied.add('bed-0').add('bed-1');
    grabRadar(w);
    run(h, 0.3);
    frame(h);
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(`${EQUIPMENT_TEXT.letGo(radar.def.the)} · ${EQUIPMENT_TEXT.mountFull(LABEL)}`);
    const beds = truck.local.splice(0, 2); // (only the small one left — the truck a little nearer: it is in reach)
    truck.x = 3.0;
    frame(h);
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(`${EQUIPMENT_TEXT.letGo(radar.def.the)} · ${EQUIPMENT_TEXT.mountNoFit(radar.def.the, LABEL)}`);
    press(h, 'KeyE');
    expect(radar.mode).toBe('world');
    // with the back to the truck: the plain line, [E] lets go
    truck.local.unshift(...beds);
    truck.x = 4.4;
    truck.occupied.clear();
    grabRadar(w);
    h.player.yaw = Math.PI / 2; // (facing -X: the truck behind)
    frame(h);
    expect(eq.mountChoice(radar)).toBeNull();
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe(EQUIPMENT_TEXT.letGo(radar.def.the));
    // a point that is not in this world (no truck source): nothing
    w.cargo.live = false;
    expect(eq.mountChoice(radar)).toBeNull();
    expect(EQUIP.mount.reach).toBeGreaterThan(2);
  });

  it('re-entry and flush: the secured units come back on their points — same uid, contents, display, pose; one unit, one place', () => {
    const w = world([stationRec('scanner', 3, 1.6, 0, 5, 0, 0, {display: 'medical'})]), {eq, h, truck} = w;
    expect(eq.unit('eq-3')!.display).toBe('medical');
    grabRadar(w);
    run(h, 0.3);
    frame(h);
    press(h, 'KeyE');
    const radarU = eq.unit('eq-1')!, chestU = eq.unit('eq-2')!;
    carryChest(w);
    stand(h, 2.4, 2.6, -Math.PI / 2, 0);
    frame(h);
    press(h, 'KeyE');
    expect([radarU.mount, chestU.mount]).toEqual(['bed-1', 'bed-0']);
    const stacks = chestU.slots!.map(s => s && [s.uid, s.itemId, s.count]);
    // one unit, one place, now
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(securedOf(h.run.laneStore(SURFACE_CARGO_LANE, DISTRICT)).map(m => [m.point, m.unit.uid])).toEqual([['bed-1', 'eq-1'], ['bed-0', 'eq-2']]);
    expect(h.run.laneStore<{here: {uid: string}[]}>('train-equipment.here', DISTRICT)!.here.map(r => r.uid)).toEqual(['eq-3']);
    // the truck moved off to another spot before the player left; to the station and back, twice
    truck.x = 3.6; truck.z = 4.2; truck.yaw = 0.4;
    frame(h);
    for (let i = 0; i < 2; i++) {
      cross(w, STATION, false);
      expect(eq.all()).toEqual([]);
      expect(recordUids(w)).toEqual(['eq-1', 'eq-2', 'eq-3']);
      cross(w, DISTRICT, true);
    }
    const r2 = eq.unit('eq-1')!, c2 = eq.unit('eq-2')!;
    expect([r2.mode, r2.mount, c2.mode, c2.mount]).toEqual(['mount', 'bed-1', 'mount', 'bed-0']);
    atPoint(r2, truck.point('bed-1'));
    atPoint(c2, truck.point('bed-0'));
    expect(c2.slots!.map(s => s && [s.uid, s.itemId, s.count])).toEqual(stacks);
    expect(eq.unit('eq-3')!.display).toBe('medical');
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2', 'eq-3']);
    // a restore of the TRAIN's record (Load / Retry) never touches the district's secured units
    eq.restore([]);
    expect([eq.unit('eq-1')?.mode, eq.unit('eq-2')?.mode]).toEqual(['mount', 'mount']);
  });

  it('a point gone at re-entry: the unit stands where it was recorded (the station lane from then on); no points yet: it waits', () => {
    const w = world(), {eq, h, truck} = w;
    grabRadar(w);
    run(h, 0.3);
    frame(h);
    press(h, 'KeyE');
    const at = truck.point('bed-1');
    // bed-1 is no more: secured to the other free bed point it fits (still the truck's)
    cross(w, STATION, false);
    const beds = truck.local.splice(0, 2);
    truck.local.unshift(beds[0]);
    cross(w, DISTRICT, true);
    expect([eq.unit('eq-1')!.mode, eq.unit('eq-1')!.mount]).toEqual(['mount', 'bed-0']);
    expect(securedOf(h.run.laneStore(SURFACE_CARGO_LANE, DISTRICT)).map(m => m.point)).toEqual(['bed-0']);
    // no bed point it fits at all: it stands on the floor under where it was (the district lane's from now on)
    cross(w, STATION, false);
    truck.local.shift();
    cross(w, DISTRICT, true);
    const r = eq.unit('eq-1')!;
    expect([r.mode, r.mount, r.body.y]).toEqual(['world', null, 0]);
    expect(r.body.x).toBeCloseTo(truck.point('bed-small').x - 1.1, 3); // (bed-0's x: 0.6 m behind the truck's centre, the small point 0.6 ahead)
    expect(Math.abs(r.body.z - at.z)).toBeLessThan(1);
    expect(securedOf(h.run.laneStore(SURFACE_CARGO_LANE, DISTRICT))).toEqual([]);
    expect(h.run.laneStore<{here: {uid: string}[]}>('train-equipment.here', DISTRICT)!.here.map(x => x.uid)).toEqual(['eq-1', 'eq-2']);
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
    // secured again; then a build before the truck is placed: the record waits (still the district's), then it is secured
    truck.local.unshift(...beds);
    w.radar = r;
    grabRadar(w);
    run(h, 0.2);
    frame(h);
    press(h, 'KeyE');
    expect(r.mode).toBe('mount');
    const point = r.mount!;
    cross(w, STATION, false);
    truck.hidden = true;
    cross(w, DISTRICT, true);
    expect(eq.unit('eq-1')).toBeNull();
    expect(eq.mountRecords().map(m => [m.point, m.unit.uid])).toEqual([[point, 'eq-1']]); // (waiting: still recorded)
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2']);
    truck.hidden = false;
    frame(h);
    const r3 = eq.unit('eq-1')!;
    expect([r3.mode, r3.mount]).toEqual(['mount', point]);
    atPoint(r3, truck.point(point));
  });

  it('a bullet stops at a secured unit (a metal impact) and never shoves it off its point', () => {
    const w = world(), {eq, h, truck, radar} = w;
    grabRadar(w);
    run(h, 0.3);
    frame(h);
    press(h, 'KeyE');
    const p = truck.point('bed-1');
    const o = new THREE.Vector3(p.x - 3, p.y + 0.8, p.z), dir = new THREE.Vector3(1, 0, 0), t = 6;
    const hit = eq.bulletHit({t}, o.clone().addScaledVector(dir, t), dir, 40);
    expect(hit).toBe(true);
    expect(h.sfxCalls).toContain('impact:metal');
    frame(h);
    expect([radar.mode, radar.body.vx, radar.body.vz]).toEqual(['mount', 0, 0]);
    atPoint(radar, truck.point('bed-1'));
  });
});
