// Task studio-surface-run-field-followup-20261116-211729-01 (lane FIXES): A NEWLY SEEDED DEPOT GETS ONE TRAIN UPGRADE (world/surface/
// cargoSeed.ts depotPick / seedDepot, world/surface/cargo.ts SurfaceCargo.seed, world/surface/cargoStore.ts version 2 `depot`). User: "A
// newly seeded depot gets exactly ONE randomly selected existing recoverable train upgrade, not the whole collection. Seed once, allocate
// exactly the actual unit, preserve physical UID/cargo/normal once-only train installation with no second material charge. Never delete
// existing saved kits or reroll/refill an already-seeded depot." / "Keep already-seeded legacy depot contents."
//  - exactly one unit, of a train-upgrade kind (radar / sentry / scanner / armour kit — never the storage chest), at its generated pose;
//    deterministic per district seed, varied over seeds (all four kinds appear); the train's counter + exactly 1; the marker in the same
//    step (version 2, the index seeded); seeding again / an emptied lane: nothing more; the layout's list stays as generated;
//  - a LEGACY depot (seeded before this rule: five units, a version-1 marker) is never touched: through the build, a crossing, save and
//    Continue its five units stay exactly; nothing seeded, the counter not advanced;
//  - the seeded kit is an ordinary unit: fitted once through the upgrades seam, no material taken, used up (no second install);
//  - the planning map counts what the depot holds (the one upgrade; a legacy depot its whole set).
import {afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {EQUIPMENT, STATION_EQUIPMENT_LANE, recoverableKind, stationEquipmentOf, stationEquipmentProblem, type EquipmentJSON, type StationEquipmentJSON} from '../src/craft/equipment';
import {Inventory} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {createRun} from '../src/run/runState';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceInfo, SurfaceRecoverable} from '../src/gen/surface/surfaceTypes';
import {DEPOT_RECOVERABLES} from '../src/gen/surface/rooms/depot';
import {generateSurfaceDistrict} from '../src/gen/surface/index';
import {SurfaceCargo} from '../src/world/surface/cargo';
import {depotPick, depotRecoverables, isTrainUpgrade, seedDepot, seedRecoverables} from '../src/world/surface/cargoSeed';
import {SURFACE_CARGO_LANE, surfaceCargoOf, surfaceCargoProblem, surfaceCargoRecord} from '../src/world/surface/cargoStore';
import {cargoReports} from '../src/world/surface/mapSources';
import {buildPlanningMap} from '../src/world/surface/mapModel';
import {exploreGridFor} from '../src/world/surface/mapExplore';
import {TrainArmorSystem} from '../src/world/trainArmor';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {KIT_TEXT} from '../src/world/surface/cargoKit';
import {EQUIPMENT_TEXT, type LiveUnit} from '../src/world/trainEquipment';
import {trainToWorld, worldToTrain} from '../src/gen/playerTrain';
import {SCRAP_METAL} from '../src/items/craftMaterials';
import {restoreRun, saveFileText} from '../src/save/serialize';
import {parseSaveText} from '../src/save/validate';
import type {SectionKey} from '../src/levels/types';
import {run, tapE, teardown} from './helpers/fuelCartsHost';
import {aboardRec, buildWorld, equipStation, loadAboard, lookAtUnit, stand, type EquipTestHost} from './helpers/trainEquipmentHost';
import {DISTRICT, STATION, cross, districtRoom, fakeSurface, recordUids} from './helpers/surfaceCargoHost';
import {Harness, LEVELS_STUB, SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';

installCanvasShim(false);

const UPGRADES = ['radar', 'sentry', 'scanner', 'armor-kit'];
const pose = (x: number, z: number, yaw = 0) => ({x, z, yaw, level: 0, y: 0});
/** The depot planner's five, in its order (gen/surface/rooms/depot.ts DEPOT_RECOVERABLES), each at its own spot. */
const DEPOT: SurfaceRecoverable[] = DEPOT_RECOVERABLES.map((kind, i) => ({kind, pose: pose(1.6 + i * 0.9, 2 + (i % 2) * 2.4, i * 0.3)}));

function deps(seed: number) {
  const inv = new Inventory(), train = new PlayerTrainRecord();
  return {inv, train, d: {seed, nextUid: () => train.equipment.nextUid(), makeStack: (id: string, n: number) => inv.makeStack(id, n)}};
}

/** The harness run as the cargo sees it in section `k` (its lane reads / writes go to that section's memory). */
const inSection = (hs: Harness, k: SectionKey) => ({
  current: k,
  laneStore: (lane: string, key?: SectionKey) => hs.run.laneStore(lane, key ?? k),
  setLaneStore: (lane: string, data: unknown, key?: SectionKey) => hs.run.setLaneStore(lane, data, key ?? k),
});

/** The first district seed (from `from`) whose depot pick is `kind`. */
function seedFor(kind: string, from = 1): number {
  for (let s = from; s < from + 2000; s++) { const i = depotPick(DEPOT, s); if (i >= 0 && recoverableKind(DEPOT[i].kind) === kind) return s; }
  throw new Error(`no seed picks ${kind}`);
}

describe('a newly seeded depot: ONE train upgrade (pure)', () => {
  it('upgrades by trait: the devices that plug into the train and the upgrade kit; the storage chest is storage', () => {
    expect(DEPOT_RECOVERABLES.filter(isTrainUpgrade)).toEqual(['radar', 'sentry', 'scanner', 'armor']);
    expect(isTrainUpgrade('chest')).toBe(false);
    expect(isTrainUpgrade('teleporter')).toBe(false);
    expect(depotPick([{kind: 'chest', pose: pose(1, 1)}], 5)).toBe(-1);
  });

  it('exactly one unit of an upgrade kind at its generated pose, one uid (the counter + 1); the same seed the same unit', () => {
    for (const seed of [1, 2, 3, 77, 4242, 123456789]) {
      const {d, train} = deps(seed);
      train.equipment.seq = 11; // (the run made units before: never an id reused)
      const out = seedDepot(DEPOT, d, 48);
      expect(out.units.length, `seed ${seed}`).toBe(1);
      const u = out.units[0], i = out.depot[0];
      expect(out.depot).toEqual([i]);
      expect(UPGRADES).toContain(u.kind);
      expect(recoverableKind(DEPOT[i].kind)).toBe(u.kind);
      expect([u.uid, train.equipment.seq]).toEqual(['eq-12', 12]);
      expect([u.x, u.y, u.z, u.yaw, u.level]).toEqual([DEPOT[i].pose.x, 0, DEPOT[i].pose.z, DEPOT[i].pose.yaw, 0]);
      expect((u.slots ?? []).every(st => st === null)).toBe(true); // (recovered empty: a sentry's feed holds no rounds)
      expect(stationEquipmentProblem({v: 1, here: out.units})).toBeNull();
      // deterministic: Retry / reload / a revisit pick the same
      const again = seedDepot(DEPOT, deps(seed).d, 48);
      expect([again.units[0].kind, again.depot]).toEqual([u.kind, out.depot]);
    }
    // no room in the lane: nothing taken, no uid spent
    const {d, train} = deps(9);
    expect(seedDepot(DEPOT, d, 0)).toEqual({units: [], depot: []});
    expect(train.equipment.seq).toBe(0);
    // no upgrade among them: none, no uid spent
    expect(seedDepot([{kind: 'chest', pose: pose(1, 1)}], d, 48)).toEqual({units: [], depot: []});
    expect(train.equipment.seq).toBe(0);
  });

  it('varied over district seeds: all four upgrades appear, about evenly; never the chest', () => {
    const n = new Map<string, number>();
    for (let s = 1; s <= 400; s++) {
      const i = depotPick(DEPOT, s);
      const k = recoverableKind(DEPOT[i].kind)!;
      n.set(k, (n.get(k) ?? 0) + 1);
    }
    expect([...n.keys()].sort()).toEqual([...UPGRADES].sort());
    for (const k of UPGRADES) expect(n.get(k)!, k).toBeGreaterThan(60);
  });

  it('on generated districts: the depot list stays as generated (all five); the pick is one of its upgrades at its pose', () => {
    for (const [host, seed] of [['subway', 3], ['office', 5], ['mall', 8]] as const) {
      const L = generateSurfaceDistrict(host, {levelSeed: seed}), S = L.surface!;
      const list = S.depot.recoverables;
      expect(list.map(r => r.kind).sort(), `${host} ${seed}`).toEqual([...DEPOT_RECOVERABLES].sort());
      const before = JSON.stringify(list);
      const {d, train} = deps(S.seed);
      const out = seedDepot(list, d, 48);
      expect(out.units.length).toBe(1);
      expect(UPGRADES).toContain(out.units[0].kind);
      expect([out.units[0].x, out.units[0].z]).toEqual([Math.round(list[out.depot[0]].pose.x * 1e4) / 1e4, Math.round(list[out.depot[0]].pose.z * 1e4) / 1e4]);
      expect(train.equipment.seq).toBe(1);
      expect(JSON.stringify(list)).toBe(before);
      expect(JSON.stringify(generateSurfaceDistrict(host, {levelSeed: seed}).surface!.depot.recoverables)).toBe(before);
    }
  }, 120_000);
});

describe('SurfaceCargo.seed: once, one unit, the marker; a seeded depot is never touched', () => {
  it('a new depot: one unit in the lane, the counter + 1, a version-2 marker naming it; again / emptied: nothing more', () => {
    const r = createRun({seeds: SEEDS, start: {level: 'subway', section: 'main'}, levels: LEVELS_STUB, campaign: null});
    r.current = {...DISTRICT};
    const {inv, train} = deps(77);
    train.equipment.seq = 30;
    const c = new SurfaceCargo({sectionHooks: [], run: r, inv, playerTrain: train, hud: {toast: () => {}}});
    expect(c.seed(fakeSurface(DEPOT, 77))).toBe(1);
    const lane = r.laneStore<StationEquipmentJSON>(STATION_EQUIPMENT_LANE)!;
    expect(lane.here.map(u => u.uid)).toEqual(['eq-31']);
    expect(UPGRADES).toContain(lane.here[0].kind);
    expect(train.equipment.seq).toBe(31);
    const rec = r.laneStore(SURFACE_CARGO_LANE);
    expect(rec).toEqual({v: 2, seeded: 1, depot: [depotPick(DEPOT, 77)]});
    expect(surfaceCargoProblem(rec)).toBeNull();
    expect(c.counts).toMatchObject({seeded: 1, seededUnits: 1});
    // never twice, never refilled (the player took it away)
    expect(c.seed(fakeSurface(DEPOT, 77))).toBe(0);
    r.setLaneStore(STATION_EQUIPMENT_LANE, undefined);
    expect(c.seed(fakeSurface(DEPOT, 77))).toBe(0);
    expect(r.laneStore(STATION_EQUIPMENT_LANE)).toBeUndefined();
    expect(train.equipment.seq).toBe(31);
    // the station's own section: another memory, untouched
    expect(r.laneStore(STATION_EQUIPMENT_LANE, STATION)).toBeUndefined();
  });

  it('through the build order: the one unit stands in the district from the first build; crossings never add or reroll', () => {
    const seed = seedFor('sentry');
    const w = districtRoom({recoverables: DEPOT, seed});
    const {eq, h} = w;
    expect(eq.all().map(u => [u.uid, u.kind, u.mode, u.owner])).toEqual([['eq-1', 'sentry', 'world', 'station']]);
    const i = depotPick(DEPOT, seed), u = eq.unit('eq-1')!;
    expect([u.body.x, u.body.z, u.body.yaw]).toEqual([DEPOT[i].pose.x, DEPOT[i].pose.z, DEPOT[i].pose.yaw]);
    expect(w.cargo.counts).toMatchObject({seeded: 1, seededUnits: 1});
    for (let k = 0; k < 2; k++) { cross(w, STATION, false); cross(w, DISTRICT, true); }
    expect(eq.all().map(x => x.uid)).toEqual(['eq-1']);
    expect([w.cargo.counts.seeded, h.playerTrain.equipment.seq]).toEqual([1, 1]);
    expect(recordUids(w)).toEqual(['eq-1']);
    // the secured / flushed record keeps naming what was seeded
    eq.flush();
    expect(surfaceCargoOf(h.run.laneStore(SURFACE_CARGO_LANE, DISTRICT))).toMatchObject({v: 2, seeded: 1, depot: [i]});
  });

  it('a LEGACY depot (five units, a version-1 marker): through the build and crossings, exactly its five; nothing seeded', () => {
    const legacy = seedRecoverables(DEPOT, deps(77).d, 48);
    expect(legacy.map(u => u.kind)).toEqual(['radar', 'sentry', 'scanner', 'chest', 'armor-kit']);
    const before = JSON.parse(JSON.stringify(legacy)) as EquipmentJSON[];
    const w = districtRoom({recoverables: DEPOT, seed: 77, here: legacy, cargo: {v: 1, seeded: 1}});
    const {eq, h} = w;
    expect(eq.all().map(u => u.uid)).toEqual(['eq-1', 'eq-2', 'eq-3', 'eq-4', 'eq-5']);
    expect(w.cargo.counts).toMatchObject({seeded: 0, seededUnits: 0});
    const chest = eq.unit('eq-4')!.slots!.map(s => s && [s.uid, s.itemId, s.count]);
    cross(w, STATION, false);
    cross(w, DISTRICT, true);
    eq.flush();
    const lane = stationEquipmentOf(h.run.laneStore(STATION_EQUIPMENT_LANE, DISTRICT));
    // every unit (uid, kind, contents: the chest's salvage) exactly, each where it was left
    expect(lane.map(u => [u.uid, u.kind, JSON.stringify(u.slots ?? null)])).toEqual(before.map(u => [u.uid, u.kind, JSON.stringify(u.slots ?? null)]));
    lane.forEach((u, k) => { expect(u.x).toBeCloseTo(before[k].x, 3); expect(u.z).toBeCloseTo(before[k].z, 3); expect(u.yaw).toBeCloseTo(before[k].yaw, 3); });
    expect(eq.unit('eq-4')!.slots!.map(s => s && [s.uid, s.itemId, s.count])).toEqual(chest);
    expect(h.run.laneStore(SURFACE_CARGO_LANE, DISTRICT)).toEqual({v: 1, seeded: 1}); // (still the legacy marker: never rewritten as one-unit)
    expect(w.cargo.counts.seeded).toBe(0);
  });

  it('a LEGACY depot through save -> Continue: the five units and the v1 marker exactly; the build after Continue seeds nothing', () => {
    const D: SectionKey = {level: 'subway', section: 'surface', station: sid(1)};
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1), sid(2)]}));
    hs.run.current = {level: 'subway', section: 'main', station: sid(1)};
    hs.run.memory().visits = 1;
    hs.run.memory(D).visits = 1;
    const legacy = seedRecoverables(DEPOT, {seed: 77, nextUid: () => hs.train.equipment.nextUid(), makeStack: (id, n) => hs.inv.makeStack(id, n)}, 48);
    hs.run.setLaneStore(STATION_EQUIPMENT_LANE, {v: 1, here: legacy}, D);
    hs.run.setLaneStore(SURFACE_CARGO_LANE, {v: 1, seeded: 1}, D);
    expect(hs.train.equipment.seq).toBe(5);
    hs.takeEntry();
    const parsed = parseSaveText(saveFileText(hs.file('manual', 1)));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    const b = new Harness(null);
    const r = restoreRun(parsed.value.run, b.target()); // Continue
    expect(r.failed).toEqual([]);
    const lane = () => JSON.parse(JSON.stringify(b.run.laneStore(STATION_EQUIPMENT_LANE, D))) as StationEquipmentJSON;
    expect(lane().here).toEqual(JSON.parse(JSON.stringify(legacy)));
    expect(b.run.laneStore(SURFACE_CARGO_LANE, D)).toEqual({v: 1, seeded: 1});
    expect(b.train.equipment.seq).toBe(5);
    // the district built again after Continue: the cargo's first-build seeding reads the marker — nothing
    const c = new SurfaceCargo({sectionHooks: [], run: inSection(b, D), inv: b.inv, playerTrain: b.train, hud: {toast: () => {}}});
    expect(c.seed(fakeSurface(DEPOT, 77))).toBe(0);
    expect(lane().here).toEqual(JSON.parse(JSON.stringify(legacy)));
    expect(b.train.equipment.seq).toBe(5);
    // a NEW-rule depot record round-trips the same way (version 2 with its index)
    const D2: SectionKey = {level: 'subway', section: 'surface', station: sid(2)};
    b.run.memory(D2).visits = 1;
    const c2 = new SurfaceCargo({sectionHooks: [], run: inSection(b, D2), inv: b.inv, playerTrain: b.train, hud: {toast: () => {}}});
    expect(c2.seed(fakeSurface(DEPOT, 91))).toBe(1);
    const p2 = parseSaveText(saveFileText(b.file('manual', 1)));
    expect(p2.ok, p2.ok ? '' : p2.error).toBe(true);
    if (!p2.ok) return;
    const b2 = new Harness(null);
    expect(restoreRun(p2.value.run, b2.target()).failed).toEqual([]);
    expect(b2.run.laneStore(SURFACE_CARGO_LANE, D2)).toEqual({v: 2, seeded: 1, depot: [depotPick(DEPOT, 91)]});
    expect(b2.train.equipment.seq).toBe(6);
  });

  it('the record (version 2): accepted with its list; refused malformed; a version-1 record keeps no list', () => {
    expect(surfaceCargoRecord(true, [], [2])).toEqual({v: 2, seeded: 1, depot: [2]});
    expect(surfaceCargoRecord(true, [], [])).toEqual({v: 2, seeded: 1, depot: []});
    expect(surfaceCargoRecord(true, [])).toEqual({v: 1, seeded: 1});
    expect(surfaceCargoRecord(false, [], [1])).toBeUndefined();
    expect(surfaceCargoProblem({v: 2, seeded: 1, depot: [0]})).toBeNull();
    expect(surfaceCargoProblem({v: 2, seeded: 1, depot: []})).toBeNull();
    expect(surfaceCargoProblem({v: 2, seeded: 1})).toMatch(/version 2/);
    expect(surfaceCargoProblem({v: 2, depot: [1]})).toMatch(/version 2/);
    expect(surfaceCargoProblem({v: 1, seeded: 1, depot: [1]})).toMatch(/version 1/);
    expect(surfaceCargoProblem({v: 2, seeded: 1, depot: [1, 1]})).toMatch(/distinct/);
    expect(surfaceCargoProblem({v: 2, seeded: 1, depot: [-1]})).toMatch(/0\.\.63/);
    expect(surfaceCargoProblem({v: 2, seeded: 1, depot: [1.5]})).toMatch(/integer/);
    expect(surfaceCargoProblem({v: 2, seeded: 1, depot: Array.from({length: 17}, (_, i) => i)})).toMatch(/at most/);
    expect(surfaceCargoProblem({v: 3, seeded: 1})).toMatch(/version/);
    expect(surfaceCargoOf({v: 2, seeded: 1, depot: [3]})).toEqual({v: 2, seeded: 1, depot: [3]});
    expect(surfaceCargoOf({v: 1, seeded: 1})).toEqual({v: 1, seeded: 1});
  });
});

describe('the planning map counts what the depot holds', () => {
  it('before seeding: the one upgrade it will get; seeded by this rule: one unit; a legacy depot: its whole set', () => {
    const S = LEVELS.subway.generate('surface', {levelSeed: 7}).surface as SurfaceInfo;
    const i = depotPick(S.depot.recoverables, S.seed), name = EQUIPMENT[recoverableKind(S.depot.recoverables[i].kind)!].name.toLowerCase();
    expect(depotRecoverables(S, false)).toEqual([S.depot.recoverables[i]]);
    expect(depotRecoverables(S, true, [i])).toEqual([S.depot.recoverables[i]]);
    expect(depotRecoverables(S, true, null).length).toBe(S.depot.recoverables.length);
    expect(cargoReports(S, {seeded: false, units: null, secured: [], truck: null}).map(r => r.text)).toEqual([`Train units reported: ${name}`]);
    const depot = S.buildings.find(b => b.id === S.depot.building)!;
    const at = {x: (depot.footprint.x0 + depot.footprint.x1) / 2, z: (depot.footprint.z0 + depot.footprint.z1) / 2};
    const kind = recoverableKind(S.depot.recoverables[i].kind)!;
    expect(cargoReports(S, {seeded: true, depot: [i], units: [{kind, mode: 'world', owner: 'station', ...at}], secured: [], truck: null}).map(r => r.text))
      .toEqual([`Depot: 1 of 1 train unit here (${name})`]);
    expect(cargoReports(S, {seeded: true, depot: [i], units: [], secured: [], truck: null}).map(r => r.text)).toEqual(['Depot: none of the 1 train unit left · 1 gone from the district']);
    // a legacy depot: the whole set as before
    expect(cargoReports(S, {seeded: true, units: [], secured: [], truck: null})[0].text).toBe(`Depot: none of the ${S.depot.recoverables.length} train units left · ${S.depot.recoverables.length} gone from the district`);
    // the layout default (no live source): the one upgrade
    const m = buildPlanningMap(S, {explore: exploreGridFor(S.extent), entered: new Set()});
    expect(m.markers.filter(k => k.kind === 'report').map(k => k.label)).toContain(`Train units reported: ${name}`);
  }, 60_000);
});

// --- the seeded kit: fitted once through the seam, no material taken ----------------------------------------------------------------

let layoutCache: StationLayout | null = null;
const SUBWAY = (): StationLayout => (layoutCache ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: {rt: PlayerTrainRuntime; armor: TrainArmorSystem; h: EquipTestHost}[] = [];
afterEach(() => {
  for (const x of live.splice(0)) {
    x.armor.dispose();
    if (x.rt.train) { x.rt.ride = null; teardown(x.h); }
  }
});

describe('the seeded armour kit', () => {
  it('the depot\'s one kit, wheeled into the parked car (its own uid): [E] fits the armour once, no material taken, the kit used up', () => {
    const seed = seedFor('armor-kit');
    const {d, train} = deps(seed);
    const {units: [rec]} = seedDepot(DEPOT, d, 48);
    expect([rec.kind, rec.uid, train.equipment.seq]).toEqual(['armor-kit', 'eq-1', 1]);
    // the same unit (kind + uid) as it stands in the car after the crossing: the train's record of it
    const s = equipStation(SUBWAY(), {build: false});
    const {h, rt, eq} = s;
    Object.assign(h, {blastKill: () => {}, fx: {impact: () => {}}});
    const armor = new TrainArmorSystem(h as never, {model: () => null, refreshIcons: () => {}, rendererReady: () => true}).install();
    Object.assign(h, {trainUpgrades: armor});
    new SurfaceCargo(h as never).install();
    live.push({rt, armor, h});
    loadAboard(h, [aboardRec(rec.kind, 1, 1, 0.2)]);
    buildWorld(h, SUBWAY());
    run(h, 0.3);
    const u = eq.unit(rec.uid)! as LiveUnit;
    expect(eq.inParkedCar(rec.uid)).toBe(true);
    const scrap = h.inv.count(SCRAP_METAL), seq = h.playerTrain.equipment.seq;
    const p = h.trainPlacement!, q = worldToTrain(p, u.body.x, u.body.y, u.body.z), at = trainToWorld(p, q.x + 1.3, p.floorY, q.z);
    stand(h, at.x, at.z, 0);
    run(h, 0.05);
    lookAtUnit(h, u, 0, 0.55, 0);
    run(h, 0.05);
    expect(eq.prompt).toBe(KIT_TEXT.fit('the train armour') + EQUIPMENT_TEXT.dragHint);
    tapE(h);
    expect([armor.installed('armor'), rt.armorFitted(), eq.unit(rec.uid), eq.counts.consumed]).toEqual([true, true, null, 1]);
    expect(h.inv.count(SCRAP_METAL)).toBe(scrap); // (the kit is the materials: no second charge)
    expect(h.playerTrain.equipment.seq).toBe(seq); // (no uid spent)
    expect(eq.aboard()).toEqual([]);
    run(h, 0.3);
    expect([eq.counts.consumed, armor.installed('armor')]).toEqual([1, true]);
  }, 120_000);
});
