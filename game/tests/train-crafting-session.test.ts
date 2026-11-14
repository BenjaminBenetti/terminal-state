// Task studio-train-crafting-v1-20261111-225628-01 (lead): ONE SESSION through the whole train-crafting chain, every system real and
// installed in Game's order on generated stations — the train runtime and its ride, the Player and Inventory, the train record, the
// equipment system (world/trainEquipment.ts), the bench (world/craftBench.ts), the sentry (world/sentryTurret.ts) with a real zombie on
// the platform, the scanner (world/itemScanner.ts):
//   materials in the pockets and the Lockbox -> the four recipes at the bench (exact costs, nothing left, a fifth craft refused) ->
//   the three devices on the three plugs (the route radar's two stops, the sentry and the scanner active) -> real 5.56 rounds into the
//   sentry, its roof turret shoots the zombie (one round per shot, none made) -> the scanner's sweep (resources only since task
//   studio-scanner-console-refinements-20261114-031614-01: was red enemy, green item, gold
//   weapon) -> the record a save takes -> a journey to ANOTHER station with everything aboard -> the same units, plugs, rounds and
//   chest contents there, the turret up and shooting again, the scanner sweeping the new station -> a load of the earlier record puts
//   every unit, round and stack back.
// The lanes' own files test each system in depth (train-equipment-*, craft-*, sentry-*, scanner-*, route-radar); this file is the seam
// between them.
import * as THREE from 'three';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom} from './helpers/fakeDom';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {EQUIPMENT, equipmentRounds, trainEquipmentProblem, type EquipmentJSON, type TrainEquipmentJSON} from '../src/craft/equipment';
import {countMaterials} from '../src/craft/crafting';
import {RECIPES, RECIPE_MATERIALS} from '../src/craft/recipes';
import {SCANNER, SCAN_MODES, scanBlips} from '../src/craft/scanner';
import {SENTRY} from '../src/craft/sentry';
import {turretMount} from '../src/craft/trainFixtures';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import type {ScannerScope} from '../src/ui/scannerView';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {craftBenchQaApi, installCraftBench, type CraftBenchSystem} from '../src/world/craftBench';
import {ItemScannerSystem} from '../src/world/itemScanner';
import {SentryTurretSystem, type SentryEnemy} from '../src/world/sentryTurret';
import type {LiveUnit} from '../src/world/trainEquipment';
import {build, frame, press, run, teardown} from './helpers/fuelCartsHost';
import {loadZombieModels, placeZombie, syncBody} from './helpers/sentryFixture';
import {buildWorld, equipStation, platformWorld, type EquipTestHost} from './helpers/trainEquipmentHost';

// the train's view needs the canvas shim, the recipe list a (tiny, fake) DOM: one document that serves both
installCanvasShim(false);
const canvasDoc = (globalThis as unknown as {document: {createElement(tag: string): unknown}}).document;
const dom = installFakeDom();
const fakeCreate = dom.doc.createElement;
dom.doc.createElement = ((tag: string) => (tag === 'canvas' ? canvasDoc.createElement(tag) : fakeCreate(tag))) as typeof fakeCreate;
afterAll(() => dom.uninstall());
beforeAll(async () => { await loadZombieModels(); }, 120000);

const SUBWAY = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const OFFICE = (): StationLayout => LEVELS.office.generate('main', {levelSeed: 4242});

interface Hit { part: string; damage: number; weapon: string }
type Host = EquipTestHost & {
  qa: boolean; stats: {kills: number}; craftBench: CraftBenchSystem; use: unknown; currentTarget: unknown; zombies: SentryEnemy[];
  pickups: {list: {stack: {itemId: string}; x: number; z: number}[]};
};

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

/** Game's install order: the train, the ride, the fuel carts (the helper), then the equipment and the three systems that read it. */
function world() {
  const A = SUBWAY();
  const s = equipStation(A, {build: false});
  const h = s.h as Host;
  const hits: Hit[] = [];
  Object.assign(h.keys, {locked: true, onLockChange: (_locked: boolean) => {}, lock: () => Promise.resolve(true), unlock: () => {}});
  Object.assign(h, {
    qa: false, stats: {kills: 0}, use: null, currentTarget: null, pickups: {list: []},
    // the damage system's seam (wounds / blood): what the turret's rounds hit is recorded; the damage itself is the brain's own
    damage: {
      beginShot: () => {},
      hitZombie: (_z: unknown, _point: THREE.Vector3, _dir: THREE.Vector3, part: string, shot: {damage: number; weapon: string}) => { hits.push({part, damage: shot.damage, weapon: shot.weapon}); },
      structuralClassAt: () => 'concrete',
    },
    fx: {impact: () => {}, muzzleFlash: () => {}, tracer: () => {}},
    physics: {propsChanged: () => {}, ragdoll: (target: SentryEnemy) => { target.ragdolled = true; return true; }},
  });
  // the sound: the helper's recording cues plus silent ones for the bench's clank, the turret's shots and the zombie's voices
  const cues = h.sfx as Record<string, unknown>;
  cues.voice = () => ({});
  for (const name of ['play', 'pickup', 'shellIn', 'npcShot', 'impact', 'groan', 'zombieHurt', 'zombieDeath', 'bodyFall']) cues[name] = () => true;
  const bench = installCraftBench(h as never, {pickupTarget: () => h.currentTarget});
  h.craftBench = bench;
  const sentry = new SentryTurretSystem(h as never, {model: () => null, rand: () => 0.5}).install();
  const scope = new FakeScope();
  const scanner = new ItemScannerSystem(h as never, {scope: scope as unknown as ScannerScope}).install();
  buildWorld(h, A);
  worlds.push({h, reset: () => { s.ride.reset(); }});
  return {...s, h, A, bench, sentry, scanner, hits};
}

/** A real zombie standing on the platform at train-local (lx, lz) of the parked car. */
function zombieAt(h: Host, lx: number, lz: number): SentryEnemy {
  const w = platformWorld(h, lx, lz);
  const z = placeZombie(w) as unknown as SentryEnemy;
  h.zombies.push(z);
  syncBody(z);
  return z;
}

/** The train's record as a save takes it (JSON text and back: nothing live in it). */
const saved = (h: Host): TrainEquipmentJSON => JSON.parse(JSON.stringify(h.playerTrain.equipment.toJSON())) as TrainEquipmentJSON;
const byKind = (recs: readonly EquipmentJSON[]) => Object.fromEntries(recs.map(r => [r.kind, r])) as Record<string, EquipmentJSON>;

describe('train crafting: one session, every system real', () => {
  it('materials -> the four crafted units -> plugged devices at work -> a journey -> the same equipment at work in the next station -> a load', async () => {
    const {h, eq, ride, bench, sentry, scanner, hits} = world();
    const inv = h.inv, box = h.playerTrain.lockbox;
    const need = (m: (typeof RECIPE_MATERIALS)[number]) => RECIPES.reduce((n, r) => n + r.cost[m], 0);
    // the approved costs, as the recipe table has them (Scrap Metal / Electrical Parts)
    expect(RECIPES.map(r => [r.kind, r.cost[SCRAP_METAL], r.cost[ELECTRICAL_PARTS]])).toEqual([['chest', 2, 0], ['radar', 4, 3], ['sentry', 8, 6], ['scanner', 5, 5]]);
    expect([need(SCRAP_METAL), need(ELECTRICAL_PARTS)]).toEqual([19, 14]);

    // --- exactly the materials for one of each: some carried, the rest in the Lockbox
    inv.add(inv.makeStack(SCRAP_METAL, 7));
    inv.add(inv.makeStack(ELECTRICAL_PARTS, 4));
    box.slots[0] = inv.makeStack(SCRAP_METAL, 12);
    box.slots[1] = inv.makeStack(ELECTRICAL_PARTS, 10);
    box.version++;
    expect(craftBenchQaApi(h).benchGo()).toBe(true);
    frame(h); frame(h);
    press(h, 'KeyE');
    expect(bench.isOpen).toBe(true);
    const made: Record<string, LiveUnit> = {};
    for (const r of RECIPES) {
      const res = bench.craftKind(r.kind)!;
      expect(res.ok, res.ok ? '' : res.text).toBe(true);
      if (res.ok) made[r.kind] = eq.unit(res.unit.uid)!;
    }
    const left = countMaterials(bench.sources());
    expect([left[SCRAP_METAL].total, left[ELECTRICAL_PARTS].total]).toEqual([0, 0]);
    expect(bench.craftKind('chest')).toMatchObject({ok: false, reason: 'missing'});
    expect(eq.units().map(u => [u.kind, u.mode, u.plug, u.ammo])).toEqual(RECIPES.map(r => [r.kind, 'world', null, 0]));
    expect(made.chest.slots!.every(s => s === null)).toBe(true); // crafted empty
    bench.close('user');
    // nothing works before it is plugged in
    run(h, 0.3);
    expect([eq.routeRadius(), eq.active('sentry'), eq.active('scanner'), sentry.qa().deployed, scanner.snap]).toEqual([1, null, null, false, null]);

    // --- the three devices to the three plugs
    for (const [i, k] of (['radar', 'sentry', 'scanner'] as const).entries()) expect(eq.qaToPlug(made[k].uid, i)).toBe(true);
    run(h, 0.3);
    expect([made.radar.plug, made.sentry.plug, made.scanner.plug, made.chest.plug]).toEqual([0, 1, 2, null]);
    expect(eq.routeRadius()).toBe(2);
    expect([eq.active('sentry') === made.sentry, eq.active('scanner') === made.scanner]).toEqual([true, true]);

    // --- the sentry: crafted empty, so no turret and no shot with a zombie in plain view; then real rounds from the pockets, the
    // turret rises and shoots it dead — one round per shot, none made
    const item = EQUIPMENT.sentry.slotItem!;
    const m = turretMount(SPEC);
    const z1 = zombieAt(h, m.x, -(SPEC.width / 2 + 6)); // on the platform, well past the strip under the eaves
    run(h, 2.5);
    expect([sentry.qa().deployed, sentry.counts.shots, hits.length, z1.brain.alive]).toEqual([false, 0, 0, true]);
    const rounds = inv.makeStack(item, 40);
    inv.add(rounds);
    // (what a click in the sentry's own store view does: the real stack out of the pockets into its first slot)
    expect(inv.storeQuick(made.sentry.slots!, inv.find(rounds.uid)!)).toBe(40);
    made.sentry.touchStore();
    expect([made.sentry.ammo, inv.count(item), made.sentry.slots![0] === rounds]).toEqual([40, 0, true]);
    run(h, 20, () => !z1.brain.alive);
    const shotsA = sentry.counts.shots;
    expect([z1.brain.alive, z1.ragdolled, h.stats.kills, sentry.counts.kills]).toEqual([false, true, 1, 1]);
    expect(shotsA).toBeGreaterThanOrEqual(1);
    expect(made.sentry.ammo).toBe(40 - shotsA); // one real round per shot, none made
    expect([rounds.count, made.sentry.slots![0] === rounds, inv.count(item)]).toEqual([40 - shotsA, true, 0]); // out of that very stack
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(x => x.weapon === SENTRY.weapon && x.damage > 0)).toBe(true);
    expect(sentry.counts.hits).toBe(hits.length);
    // nothing left to shoot: no more rounds spent
    const kept = made.sentry.ammo;
    run(h, 2);
    expect([made.sentry.ammo, sentry.counts.shots]).toEqual([kept, shotsA]);

    // --- the scanner: it swept once after its warm-up; what appears afterwards is on the scope only after the NEXT sweep (a
    // snapshot every SCANNER.period active seconds, nothing live) — a dressing (Medical since task studio-scanner-medical-20261114-054010-01;
    // ALL only before), a weapon; the enemy is not a resource
    const sweep1 = scanner.snap;
    expect(sweep1).not.toBeNull();
    const far = platformWorld(h, m.x + 9, -(SPEC.width / 2 + 4)), far2 = platformWorld(h, m.x - 7, -(SPEC.width / 2 + 5));
    h.pickups.list.push({stack: {itemId: 'bandage'}, x: far.x, z: far.z}, {stack: {itemId: 'pistol'}, x: far2.x, z: far2.z});
    const z2 = zombieAt(h, m.x + 4, -(SPEC.width / 2 + 30)); // out of the sentry's range (28 m), well inside the scanner's (100 m)
    run(h, 1);
    expect(scanner.snap).toBe(sweep1); // (no live tracking between sweeps)
    run(h, SCANNER.period + 1, () => scanner.snap !== sweep1);
    expect(scanner.snap).not.toBe(sweep1);
    expect(scanner.snap!.seen).toEqual({all: 2, food: 0, ammo: 0, fuel: 0, weapon: 1, equipment: 0, material: 0, medical: 1});
    expect(SCAN_MODES.map(k => scanBlips(scanner.snap!, k).blips.length)).toEqual([2, 0, 0, 0, 1, 0, 0, 1]);
    expect([made.sentry.ammo, z2.brain.alive]).toEqual([kept, true]); // (the far zombie is the scanner's business only)
    h.zombies.length = 0;
    h.pickups.list.length = 0;

    // --- something into the chest, then the record a save takes
    made.chest.slots![4] = inv.makeStack('bandage', 3);
    made.chest.touchStore();
    const rec = saved(h);
    expect(trainEquipmentProblem(rec)).toBeNull();
    const R = byKind(rec.aboard);
    expect([R.radar.plug, R.sentry.plug, R.scanner.plug, R.chest.plug]).toEqual([0, 1, 2, undefined]);
    expect([R.sentry.ammo, equipmentRounds(R.sentry)]).toEqual([undefined, kept]); // (the rounds are the stack in its slot)
    expect(R.chest.slots![4]).toMatchObject({itemId: 'bandage', count: 3});
    expect(rec.aboard).toHaveLength(4);

    // --- the journey: everything aboard rides to ANOTHER station
    expect(eq.departBlock()).toBeNull();
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    expect(eq.units().map(u => u.mode)).toEqual(['cargo', 'cargo', 'cargo', 'cargo']);
    // riding: the radar still reveals two stops (the map is used from the moving car too); the sentry and the scanner rest
    expect([eq.routeRadius(), eq.active('sentry'), eq.active('scanner')]).toEqual([2, null, null]);
    teardown(h);
    run(h, 1);
    expect(sentry.qa().deployed).toBe(false);
    expect(saved(h).aboard).toEqual(rec.aboard); // the departure save: the same record
    const B = OFFICE();
    h.run.current = {level: 'office', section: 'main'};
    build(h, B, false);
    let arrived: {status: string} | null = null;
    void ride.arrive().then(r => { arrived = r; });
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    expect(arrived).toMatchObject({status: 'stopped'});
    run(h, 0.5);

    // --- the next station: the same four units, plugs, rounds, contents; the benefits are on again without a hand
    expect(eq.units().map(u => [u.uid, u.kind, u.mode])).toEqual(RECIPES.map((r, i) => [`eq-${i + 1}`, r.kind, 'world']));
    expect(saved(h).aboard).toEqual(rec.aboard);
    expect([eq.routeRadius(), eq.active('sentry')?.uid, eq.active('scanner')?.uid]).toEqual([2, made.sentry.uid, made.scanner.uid]);
    const sentryB = eq.unit(made.sentry.uid)!, chestB = eq.unit(made.chest.uid)!;
    expect(sentryB.ammo).toBe(kept);
    expect(chestB.slots![4]).toMatchObject({itemId: 'bandage', count: 3});
    expect(scanner.snap).toBeNull(); // a new station: nothing swept yet
    const p2 = h.trainPlacement!;
    expect(p2).not.toBeNull();
    const hits0 = hits.length;
    h.zombies.length = 0;
    const z3 = zombieAt(h, m.x, -(SPEC.width / 2 + 6));
    run(h, 20, () => !z3.brain.alive);
    expect([z3.brain.alive, h.stats.kills]).toEqual([false, 2]);
    expect(sentry.counts.shots).toBeGreaterThan(shotsA);
    expect(sentryB.ammo).toBe(kept - (sentry.counts.shots - shotsA));
    expect(hits.length).toBeGreaterThan(hits0);
    const z4 = zombieAt(h, m.x - 3, -(SPEC.width / 2 + 40)); // (beyond the sentry's range again)
    const sweepB = scanner.snap;
    run(h, SCANNER.period + SCANNER.warmup + 1, () => scanner.snap !== sweepB);
    expect(scanner.snap).not.toBe(sweepB);
    expect(Object.keys(scanner.snap!.seen)).toEqual([...SCAN_MODES]); // (resources only: the live far zombie is no dot)
    expect(z4.brain.alive).toBe(true);

    // --- a load of the record taken before the journey: every unit, round and stack as recorded (the rounds shot since are back —
    // the save's state, not a refill: the game's own Retry / Load rule)
    h.zombies.length = 0;
    h.playerTrain.equipment.load(rec);
    run(h, 0.5);
    expect(saved(h).aboard).toEqual(rec.aboard);
    expect([eq.unit(made.sentry.uid)!.ammo, eq.unit(made.sentry.uid)!.plug, eq.routeRadius()]).toEqual([kept, 1, 2]);
    expect(eq.units()).toHaveLength(4);
  }, 180000);
});
