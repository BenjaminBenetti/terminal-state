// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): what the train equipment (world/trainEquipment.ts) gives the rest of
// the game besides its behaviour — with the real train runtime + ride + Player (helpers/trainEquipmentHost.ts):
//  - THE QA HOOKS (window.__LL: trainEquipmentQaApi): equipment() — a plain readout of every unit, the plugs, the grab / carry / hold;
//    equipmentCraft(kind) — a unit on the car floor or the refusal text; equipmentToPlug(uid, index) — a unit at rest beside a plug
//    (it plugs in on the next frames, with the ordinary note); every hook is safe without a system / a world / a train;
//  - THE WARM-UP POOL ('train-equipment'): a hidden prototype holding a view of EVERY kind of the registry and both lamp states, plus
//    the car's plug fixtures — every material a live unit, a cable or a lamp can show is in it (nothing compiles on first sight);
//    a cooked module model that arrives later upgrades the stand-ins in place and the prototype follows;
//  - THE WIRING in the shared files (read as source: the seams other lanes' merges must not drop): the install after the train and
//    its ride, the carried chest's three seams, the departure / ending-save / route-radius / uid seams, the lift's, the QA spread.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {TRAIN_MODULE_MEASURED} from '../src/assets/trainEquipment.generated';
import {EQUIPMENT, EQUIPMENT_KINDS, EQUIPMENT_LIMITS} from '../src/craft/equipment';
import {equipmentPlugs} from '../src/craft/trainFixtures';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {CART_LOOK} from '../src/world/fuelCartModel';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {EQUIP, EQUIPMENT_TEXT, trainEquipmentQaApi} from '../src/world/trainEquipment';
import {equipmentMaterials, equipmentModelKey} from '../src/world/trainEquipmentModel';
import {DT, run, teardown} from './helpers/fuelCartsHost';
import {aboardRec, equipStation, loadAboard, localOf} from './helpers/trainEquipmentHost';

installCanvasShim(false);

let layoutCache: StationLayout | null = null;
const SUBWAY = (): StationLayout => (layoutCache ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

function station() {
  const s = equipStation(SUBWAY());
  live.push(s.rt);
  return s;
}

const plugKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].plug);
const dollyKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].move === 'dolly');

/** Every material under some roots (hidden objects too). */
function materialsOf(roots: readonly THREE.Object3D[]): Set<THREE.Material> {
  const out = new Set<THREE.Material>();
  for (const r of roots) r.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) out.add(x);
  });
  return out;
}

describe('train equipment: the QA hooks (window.__LL)', () => {
  it('equipment() is a plain readout; equipmentCraft(kind) makes a unit or says why not; equipmentToPlug(uid, i) plugs a device in', async () => {
    const {h, eq, ride} = station();
    const api = trainEquipmentQaApi(h);
    expect(Object.keys(api).sort()).toEqual(['equipment', 'equipmentCraft', 'equipmentToPlug']);
    // nothing yet
    const s0 = api.equipment() as ReturnType<typeof eq.state>;
    expect(s0).toMatchObject({worldLive: true, units: [], plugs: equipmentPlugs(SPEC).map(() => null), grab: null, held: null, hold: null, fixtures: true});
    expect(JSON.parse(JSON.stringify(s0))).toEqual(s0); // plain data (a browser check reads it through page.evaluate)
    // one of every kind in the registry
    const made = EQUIPMENT_KINDS.map(k => api.equipmentCraft(k) as string);
    expect(made).toEqual(EQUIPMENT_KINDS.map((_, i) => `eq-${i + 1}`));
    expect(api.equipmentCraft('no-such-kind')).toBe('unknown kind');
    expect(api.equipmentCraft('toString')).toBe('unknown kind');
    run(h, 0.3);
    const s1 = api.equipment() as ReturnType<typeof eq.state>;
    expect(s1.units.map(u => [u.uid, u.kind, u.mode, u.owner, u.plug, u.ammo, u.stacks])).toEqual(EQUIPMENT_KINDS.map((k, i) => [`eq-${i + 1}`, k, 'world', 'train', null, 0, 0]));
    expect(s1.counts.crafted).toBe(EQUIPMENT_KINDS.length);
    // to a plug: at rest beside it, facing the aisle; plugged in on the next frames with the ordinary note and cue
    const dev = eq.units().filter(u => u.def.plug);
    h.toasts.length = 0; h.sfxCalls.length = 0;
    expect(api.equipmentToPlug(dev[0].uid, 1)).toBe(true);
    const e1 = equipmentPlugs(SPEC)[1], q = localOf(h, dev[0]);
    expect(Math.hypot(q.x - e1.x, q.z - e1.z)).toBeCloseTo(dev[0].def.radius + 0.3, 6);
    expect(dev[0].plug).toBeNull();
    run(h, 0.1);
    expect(dev[0].plug).toBe(1);
    expect(h.toasts).toEqual([EQUIPMENT_TEXT.pluggedIn(dev[0].def.name)]);
    expect(h.sfxCalls).toContain('hose:true');
    expect((api.equipment() as ReturnType<typeof eq.state>).plugs).toEqual([null, dev[0].uid, null]);
    // a taken plug: the unit is put there but stays unplugged; every plug index of the car works; a bad index / uid does not
    expect(api.equipmentToPlug(dev[1].uid, 0)).toBe(true);
    run(h, 0.1);
    expect(dev[1].plug).toBe(0);
    for (const bad of [-1, EQUIPMENT_LIMITS.plugs, 99]) expect(api.equipmentToPlug(dev[1].uid, bad)).toBe(false);
    expect(api.equipmentToPlug('eq-999', 0)).toBe(false);
    // a 'carry' kind can be put there too (it never plugs in)
    const box = eq.units().find(u => !u.def.plug)!;
    expect(api.equipmentToPlug(box.uid, 2)).toBe(true);
    run(h, 0.2);
    expect(box.plug).toBeNull();
    // a grabbed unit is let go first; a carried one is refused
    eq.grab = {unit: dev[0], lag: 0};
    expect(api.equipmentToPlug(dev[0].uid, 1)).toBe(true);
    expect(eq.grab).toBeNull();
    expect(eq.pickUp(box)).toBe(true);
    expect(api.equipmentToPlug(box.uid, 2)).toBe(false);
    expect((api.equipment() as ReturnType<typeof eq.state>).held).toBe(box.uid);
    expect(eq.putDown() || eq.held !== null).toBe(true);
    // the train moving: craft says so; nothing is put anywhere
    void ride.depart();
    run(h, 0.2);
    expect(api.equipmentCraft(EQUIPMENT_KINDS[0])).toBe(EQUIPMENT_TEXT.moving);
    expect(api.equipmentToPlug(dev[1].uid, 0)).toBe(false);
    ride.reset();
    await Promise.resolve();
    // no world: the readout still answers
    teardown(h);
    expect(api.equipment()).toMatchObject({worldLive: false});
    expect(api.equipmentCraft(EQUIPMENT_KINDS[0])).toBe(EQUIPMENT_TEXT.noTrain);
    expect(api.equipmentToPlug(dev[1].uid, 0)).toBe(false);
  });

  it('every hook is safe on a game without the system', () => {
    const api = trainEquipmentQaApi({});
    expect(api.equipment()).toBeNull();
    expect(api.equipmentCraft(EQUIPMENT_KINDS[0])).toBe('unknown kind');
    expect(api.equipmentToPlug('eq-1', 0)).toBe(false);
  });
});

describe('train equipment: the warm-up pool', () => {
  it('a hidden prototype of EVERY kind + both lamp states + the car\'s plug fixtures: every material a unit, cable or lamp shows is in it', () => {
    const {h, eq} = station();
    const pool = h.pools['train-equipment'];
    expect(typeof pool).toBe('function');
    const roots = pool();
    const proto = roots[0];
    expect(proto.name).toBe('train-equipment-warm-prototype');
    expect(proto.visible).toBe(false); // never drawn in play
    expect(proto.position.y).toBeLessThan(-500);
    expect(proto.parent).toBe(eq.group);
    expect(roots).toContain(eq.fixtures.group); // (the sockets are part of the parked car's view)
    expect(pool()[0]).toBe(proto); // built once
    // one view per kind of the registry (run time: a kind added later is warmed without a change here)
    const views = proto.children.filter(c => !c.name.startsWith('train-equipment-warm:'));
    expect(views).toHaveLength(EQUIPMENT_KINDS.length);
    const warm = materialsOf(roots);
    const S = equipmentMaterials();
    for (const m of [S.standIn, S.standInFace, S.plugSteel, S.plugSocket, S.lampFree, S.lampOn]) expect(warm.has(m), m.name).toBe(true);
    expect(S.lampFree.emissiveIntensity).toBeGreaterThan(0); // (the lamps glow: emissive materials, never lights)
    expect(S.lampOn.emissiveIntensity).toBeGreaterThan(S.lampFree.emissiveIntensity);
    let lights = 0;
    eq.group.traverse(o => { if ((o as THREE.Light).isLight) lights++; });
    eq.fixtures.group.traverse(o => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
    // live units of every kind, in every state that changes what is drawn: plugged (lamp on, cable drawn), a lid open, one carried
    const recs = EQUIPMENT_KINDS.map((k, i) => aboardRec(k, i + 1, -4.2 + i * 1.3, i % 2 ? 0.3 : -0.3, Math.PI / 2));
    loadAboard(h, recs);
    run(h, 0.3);
    const api = trainEquipmentQaApi(h);
    eq.units().filter(u => u.def.plug).slice(0, EQUIPMENT_LIMITS.plugs).forEach((u, i) => { expect(api.equipmentToPlug(u.uid, i)).toBe(true); });
    for (const u of eq.units()) if (u.slots) u.setOpen(true);
    run(h, 1);
    expect(eq.units().filter(u => u.plug !== null).length).toBe(Math.min(plugKinds.length, EQUIPMENT_LIMITS.plugs));
    const shown = materialsOf([eq.group, eq.fixtures.group, eq.hands]);
    expect(shown.size).toBeGreaterThan(3);
    const cold = [...shown].filter(m => !warm.has(m)).map(m => m.name || m.type);
    expect(cold).toEqual([]);
    const carried = eq.units().find(u => u.def.move === 'carry');
    if (carried) {
      expect(eq.pickUp(carried)).toBe(true);
      run(h, 0.2);
      expect([...materialsOf([eq.hands])].filter(m => !warm.has(m))).toEqual([]);
    }
    // the same after the world was rebuilt (the prototype is the system's, the fixtures follow the new view)
    teardown(h);
    expect(pool()[0]).toBe(proto);
  });

  it('a cooked module model that arrives later upgrades the stand-ins in place (same units, same poses) and the prototype follows', () => {
    const {h, eq} = station();
    loadAboard(h, EQUIPMENT_KINDS.map((k, i) => aboardRec(k, i + 1, -4.2 + i * 1.3, i % 2 ? 0.3 : -0.3, Math.PI / 2)));
    run(h, 0.3);
    const before = eq.units().map(u => ({u, group: u.view.group, x: u.body.x, z: u.body.z}));
    const S = equipmentMaterials();
    for (const u of eq.units()) if (u.def.move === 'dolly') expect(u.view.standIn, u.kind).toBe(true);
    expect(materialsOf([eq.group]).has(S.standIn)).toBe(true);
    const proto0 = h.pools['train-equipment']()[0];
    // the prop library now has every module (the Lockbox's own model is the train's and is not faked here)
    const lib = new Map<string, {scene: THREE.Object3D}>(), cooked = new Map<string, THREE.Material>();
    for (const k of dollyKinds) {
      const key = equipmentModelKey(EQUIPMENT[k]);
      expect(key, k).toBeTruthy();
      const mat = new THREE.MeshStandardMaterial({color: 0x335544});
      mat.name = `cooked:${key}`;
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.3), mat));
      lib.set(key!, {scene});
      cooked.set(k, mat);
    }
    (h as unknown as {propModels: unknown}).propModels = lib;
    run(h, (EQUIP.pollEvery + 2) * DT); // (the sources are looked at again every EQUIP.pollEvery frames)
    for (const b of before) {
      const u = b.u;
      expect(eq.unit(u.uid) === u).toBe(true);
      expect(u.view.group === b.group).toBe(true); // the unit's own frame stays: only its body is rebuilt
      expect([u.body.x, u.body.z]).toEqual([b.x, b.z]);
      if (u.def.move !== 'dolly') continue;
      expect(u.view.standIn, u.kind).toBe(false);
      const mod = u.view.group.getObjectByName(`train-equipment-module:${u.kind}`)!;
      expect(mod, u.kind).toBeTruthy();
      // on the hand truck's nose plate at the cooked mount offset (read from the generated constants)
      const M = (TRAIN_MODULE_MEASURED as Readonly<Record<string, {mountZ: number} | undefined>>)[u.kind]!;
      expect([mod.position.x, mod.position.y, mod.position.z]).toEqual([0, CART_LOOK.plateTop, M.mountZ]);
      expect(materialsOf([u.view.group]).has(cooked.get(u.kind)!)).toBe(true);
      expect(materialsOf([u.view.group]).has(S.standIn)).toBe(false);
    }
    // the prototype was rebuilt with the new looks: nothing a unit shows is cold
    const roots = h.pools['train-equipment']();
    expect(roots[0]).not.toBe(proto0);
    expect(proto0.parent).toBeNull();
    const warm = materialsOf(roots);
    for (const m of cooked.values()) expect(warm.has(m), m.name).toBe(true);
    expect([...materialsOf([eq.group, eq.fixtures.group])].filter(m => !warm.has(m)).map(m => m.name)).toEqual([]);
    // a unit made afterwards has the model from the start
    const u = eq.craft(dollyKinds[0])!;
    expect(u.view.standIn).toBe(false);
  });
});

describe('train equipment: the wiring in the shared files (source)', () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

  it('game.ts: installed once after the train and its ride with the use canceller; the carried chest\'s seams; the departure / save / radar / uid seams', () => {
    const game = src('game.ts');
    const at = (re: RegExp) => { const m = re.exec(game); expect(m, String(re)).not.toBeNull(); return m!.index; };
    const install = at(/this\.trainEquipment = installTrainEquipment\(this, \{cancelUse: /);
    expect(game.match(/installTrainEquipment\(/g)).toHaveLength(1);
    // (the car and the ride exist before it; the fuel carts — same controller, kept apart — too; the consumers come after it)
    for (const before of [/this\.fuelCarts = installFuelCarts\(/, /this\.trainRuntime = installPlayerTrain\(/, /this\.trainRide = installTrainRide\(/]) expect(at(before), String(before)).toBeLessThan(install);
    for (const after of [/installCraftBench\(this\)/, /installSentryTurret\(this\)/, /installItemScanner\(this\)/]) expect(at(after), String(after)).toBeGreaterThan(install);
    // the carried chest: no item use, no reload, the held item lowered
    at(/if \(this\.trainEquipment\?\.refuseUse\(\)\) return;/);
    at(/reload: [^\n]*!this\.trainEquipment\?\.carrying/);
    at(/this\.trainEquipment\?\.holster \?\? 0/);
    // a departure asks it; the ending save writes the station's units; the console map reads the radar; uids stay reserved
    at(/this\.trainEquipment\?\.departBlock\(\)/);
    at(/commitEndingSave\(\)[\s\S]{0,600}this\.trainEquipment\?\.flush\(\)/);
    at(/this\.trainEquipment\?\.routeRadius\(\) \?\? 1/);
    expect(game.match(/reserveUids\(this\.playerTrain\.equipment\?\.maxUid\(\) \?\? 0\)/g)!.length).toBeGreaterThanOrEqual(2); // Retry and a load
  });

  it('qa.ts spreads the hooks; the lift carries the units standing in its cab and waits for one in its doorway', () => {
    expect(src('qa.ts')).toMatch(/\.\.\.trainEquipmentQaApi\(game\)/);
    const tower = src('world/towerRuntime.ts');
    expect(tower.match(/h\.trainEquipment\?\.carry\?\.\(/g)!.length).toBeGreaterThanOrEqual(2); // a travelling cab, a parked one
    expect(tower).toMatch(/h\.trainEquipment\?\.anyAt\?\.\(e\.cartInDoor\)/);
  });
});
