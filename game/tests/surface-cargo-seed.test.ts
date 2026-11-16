// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): THE DEPOT RECOVERABLES — seeded ONCE into the district's
// equipment lane as real train units (world/surface/cargoSeed.ts, world/surface/cargo.ts):
//  - every recoverable becomes a station record of its kind (an upgrade id -> its kit kind) at its generated pose, with a FRESH run uid
//    from the train's one unit counter; unknown kinds are skipped; the lane's bound is kept;
//  - a chest's contents come from the loot-table foundation (DEPOT_CHEST = BASE_WORKSHOP_SALVAGE + TENANT_SUPPLY rows), finite, real
//    stacks with run item uids, deterministic per district seed; devices / kits are recovered empty;
//  - through the build order (the cargo's hook before the equipment's): the units stand in the district at once, and the seeded
//    marker is written in the same step — a revisit, a reload of the lanes, a district emptied by the player: never seeded again;
//  - the seeded units behave exactly like crafted ones (grabbed / carried, recorded as the station's).
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {EQUIPMENT, EQUIPMENT_KINDS, EQUIPMENT_LIMITS, STATION_EQUIPMENT_LANE, recoverableKind, stationEquipmentOf, stationEquipmentProblem, type StationEquipmentJSON} from '../src/craft/equipment';
import {Rng} from '../src/core/rng';
import {Inventory} from '../src/items/inventory';
import {BASE_WORKSHOP_SALVAGE, TENANT_SUPPLY} from '../src/items/lootTables';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {createRun} from '../src/run/runState';
import {SurfaceCargo} from '../src/world/surface/cargo';
import {DEPOT_CHEST, depotChestSlots, seedRecoverables} from '../src/world/surface/cargoSeed';
import {SURFACE_CARGO_LANE, surfaceCargoOf} from '../src/world/surface/cargoStore';
import type {SurfaceRecoverable} from '../src/gen/surface/surfaceTypes';
import {frame, run} from './helpers/fuelCartsHost';
import {holdE, lookAtUnit, stand} from './helpers/trainEquipmentHost';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {DISTRICT, STATION, cross, districtRoom, fakeSurface, recordUids} from './helpers/surfaceCargoHost';
import {LEVELS_STUB, SEEDS} from './helpers/saveFixture';

installCanvasShim(false);

const pose = (x: number, z: number, yaw = 0, level = 0, y = 0) => ({x, z, yaw, level, y});
const DEPOT: SurfaceRecoverable[] = [
  {kind: 'chest', pose: pose(2.5, 2, 0.4)},
  {kind: 'radar', pose: pose(4, 2, -1)},
  {kind: 'armor', pose: pose(4, 4.6, 1.2)},
  {kind: 'chest', pose: pose(2.5, 4.6, 3)},
  {kind: 'teleporter', pose: pose(6, 5)}, // (not a kind: skipped, nothing invented)
];
const TABLE = new Set([...BASE_WORKSHOP_SALVAGE, ...TENANT_SUPPLY.items].map(r => r[0]));

function deps(seed = 77) {
  const inv = new Inventory(), train = new PlayerTrainRecord();
  return {inv, train, d: {seed, nextUid: () => train.equipment.nextUid(), makeStack: (id: string, n: number) => inv.makeStack(id, n)}};
}

describe('depot recoverables -> train unit records (pure)', () => {
  it('every known recoverable is a station record of its kind at its pose, with a fresh run uid; an upgrade id is its kit kind', () => {
    expect(recoverableKind('armor')).toBe('armor-kit');
    expect(recoverableKind('radar')).toBe('radar');
    expect(recoverableKind('nope')).toBeNull();
    const {d, train} = deps();
    train.equipment.seq = 11; // (the run already made units: the depot's never reuse an id)
    const recs = seedRecoverables(DEPOT, d, 48);
    expect(recs.map(r => [r.uid, r.kind])).toEqual([['eq-12', 'chest'], ['eq-13', 'radar'], ['eq-14', 'armor-kit'], ['eq-15', 'chest']]);
    expect(recs.map(r => [r.x, r.y, r.z, r.yaw, r.level])).toEqual([[2.5, 0, 2, 0.4, 0], [4, 0, 2, -1, 0], [4, 0, 4.6, 1.2, 0], [2.5, 0, 4.6, 3, 0]]);
    expect(train.equipment.seq).toBe(15);
    expect(stationEquipmentProblem({v: 1, here: recs})).toBeNull();
    // devices / kits are recovered empty (a kit has no slots; a radar none)
    expect(recs.filter(r => !EQUIPMENT[r.kind].slots).every(r => r.slots === undefined)).toBe(true);
    // the bound: never more than the lane's room
    expect(seedRecoverables(DEPOT, deps().d, 2).length).toBe(2);
  });

  it("a recovered chest holds the depot table's items only, as real stacks with run item uids, deterministic per district seed", () => {
    const a = deps(), b = deps();
    const ra = seedRecoverables(DEPOT, a.d, 48), rb = seedRecoverables(DEPOT, b.d, 48);
    const chests = ra.filter(r => r.kind === 'chest');
    expect(chests.length).toBe(2);
    for (const c of chests) {
      expect(c.slots!.length).toBe(EQUIPMENT.chest.slots);
      const st = c.slots!.filter(Boolean);
      const lo = DEPOT_CHEST.lots![0];
      expect(st.length).toBeGreaterThan(0);
      expect(st.reduce((n, s) => n + s!.count, 0)).toBeGreaterThanOrEqual(lo);
      for (const s of st) expect(TABLE.has(s!.itemId)).toBe(true);
    }
    // the same district seed: the same contents (uids are the run's own counter)
    const strip = (r: typeof ra) => r.map(x => (x.slots ?? []).map(s => s && [s.itemId, s.count]));
    expect(strip(ra)).toEqual(strip(rb));
    expect(strip(seedRecoverables(DEPOT, deps(78).d, 48))).not.toEqual(strip(ra));
    // every stack its own item uid
    const ids = ra.flatMap(r => (r.slots ?? []).filter(Boolean).map(s => s!.uid));
    expect(new Set(ids).size).toBe(ids.length);
    // the table itself: the named foundation rows, exact, never empty
    expect([DEPOT_CHEST.exact, DEPOT_CHEST.empty]).toEqual([true, 0]);
    const slots = depotChestSlots(new Rng(5), 8, (id, n) => a.inv.makeStack(id, n));
    expect(slots.filter(Boolean).length).toBeGreaterThan(0);
  });

  it('SurfaceCargo.seed: once per district — the units and the marker in one step; a second call / an emptied lane: nothing more', () => {
    const r = createRun({seeds: SEEDS, start: {level: 'subway', section: 'main'}, levels: LEVELS_STUB, campaign: null});
    r.current = {...DISTRICT};
    const {inv, train} = deps();
    const c = new SurfaceCargo({sectionHooks: [], run: r, inv, playerTrain: train, hud: {toast: () => {}}});
    expect(c.seed(fakeSurface(DEPOT))).toBe(4);
    const lane = r.laneStore<StationEquipmentJSON>(STATION_EQUIPMENT_LANE)!;
    expect(lane.here.map(u => u.uid)).toEqual(['eq-1', 'eq-2', 'eq-3', 'eq-4']);
    expect(surfaceCargoOf(r.laneStore(SURFACE_CARGO_LANE)).seeded).toBe(1);
    expect(c.seed(fakeSurface(DEPOT))).toBe(0);
    expect(r.laneStore<StationEquipmentJSON>(STATION_EQUIPMENT_LANE)!.here.length).toBe(4);
    // the player took everything away: still never refilled
    r.setLaneStore(STATION_EQUIPMENT_LANE, undefined);
    expect(c.seed(fakeSurface(DEPOT))).toBe(0);
    expect(r.laneStore(STATION_EQUIPMENT_LANE)).toBeUndefined();
    expect(train.equipment.seq).toBe(4);
    // (the station's own section is a different memory: untouched)
    expect(r.laneStore(STATION_EQUIPMENT_LANE, STATION)).toBeUndefined();
    // a full lane keeps its bound (the rest stay unrecovered)
    const r2 = createRun({seeds: SEEDS, start: {level: 'subway', section: 'main'}, levels: LEVELS_STUB, campaign: null});
    const full = Array.from({length: EQUIPMENT_LIMITS.station - 1}, (_, i) => ({uid: `eq-${100 + i}`, kind: 'radar' as const, x: 1, y: 0, z: 1, yaw: 0, level: 0}));
    r2.setLaneStore(STATION_EQUIPMENT_LANE, {v: 1, here: full});
    const c2 = new SurfaceCargo({sectionHooks: [], run: r2, inv, playerTrain: train, hud: {toast: () => {}}});
    expect(c2.seed(fakeSurface(DEPOT))).toBe(1);
    expect(stationEquipmentOf(r2.laneStore(STATION_EQUIPMENT_LANE)).length).toBe(EQUIPMENT_LIMITS.station);
  });
});

describe('depot recoverables through the build order (the flat room as the district)', () => {
  it('they stand in the district at their poses from the first build, as station units; a revisit never adds any', () => {
    const w = districtRoom({recoverables: DEPOT});
    const {eq, h} = w;
    expect(eq.all().map(u => [u.uid, u.kind, u.mode, u.owner])).toEqual([
      ['eq-1', 'chest', 'world', 'station'], ['eq-2', 'radar', 'world', 'station'], ['eq-3', 'armor-kit', 'world', 'station'], ['eq-4', 'chest', 'world', 'station']]);
    const kit = eq.unit('eq-3')!;
    expect([kit.body.x, kit.body.z, kit.body.yaw]).toEqual([4, 4.6, 1.2]);
    const before = eq.unit('eq-1')!.slots!.map(s => s && [s.uid, s.itemId, s.count]);
    expect(w.cargo.counts).toMatchObject({seeded: 1, seededUnits: 4});
    // go to the station and come back twice: the same four units, the same contents, never a second seeding
    for (let i = 0; i < 2; i++) {
      cross(w, STATION, false);
      expect(eq.all()).toEqual([]);
      cross(w, DISTRICT, true);
    }
    expect(eq.all().map(u => u.uid)).toEqual(['eq-1', 'eq-2', 'eq-3', 'eq-4']);
    expect(eq.unit('eq-1')!.slots!.map(s => s && [s.uid, s.itemId, s.count])).toEqual(before);
    expect(w.cargo.counts.seeded).toBe(1);
    expect(h.playerTrain.equipment.seq).toBe(4);
    expect(recordUids(w)).toEqual(['eq-1', 'eq-2', 'eq-3', 'eq-4']);
  });

  it('a seeded unit is an ordinary unit: dragged off and left elsewhere, it stays where it was left; a taken one is never replaced', () => {
    const w = districtRoom({recoverables: DEPOT});
    const {eq, h} = w;
    const radar = eq.unit('eq-2')!, b = radar.body;
    // behind its handle, E HELD (the hold gesture, as for a crafted unit): grabbed; walked back, let go
    stand(h, b.x - Math.sin(b.yaw) * 1.2, b.z - Math.cos(b.yaw) * 1.2, b.yaw + Math.PI, 0);
    frame(h);
    lookAtUnit(h, radar, 0, CART_LOOK.handle.y, CART_LOOK.handle.z);
    frame(h);
    holdE(h);
    expect(eq.grab?.unit).toBe(radar);
    h.keys.held.add('KeyS');
    run(h, 0.6);
    h.keys.held.delete('KeyS');
    eq.letGo('test');
    run(h, 1);
    const left = {x: radar.body.x, z: radar.body.z};
    expect(Math.hypot(left.x - 4, left.z - 2)).toBeGreaterThan(0.2);
    // a chest destroyed (acid): gone for good — never refilled by a revisit
    eq.destroy('eq-4');
    cross(w, STATION, false);
    cross(w, DISTRICT, true);
    expect(eq.all().map(u => u.uid)).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(eq.unit('eq-2')!.body.x).toBeCloseTo(left.x, 3);
    expect(eq.unit('eq-2')!.body.z).toBeCloseTo(left.z, 3);
    expect(EQUIPMENT_KINDS).toContain('armor-kit');
  });

  it('no district (a station build): nothing seeded, no marker', () => {
    const w = districtRoom({recoverables: DEPOT});
    expect(w.h.run.laneStore(SURFACE_CARGO_LANE, STATION)).toBeUndefined();
    expect(w.h.run.laneStore(STATION_EQUIPMENT_LANE, STATION)).toBeUndefined();
  });
});
