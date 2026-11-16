// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE, follow-up 1): THE PLANNING MAP's LIVE REPORT SOURCES
// (world/surface/mapSources.ts) — lane CARGO's train units and lane AIR's openings, read through their public state:
//  - the report rules on a REAL generated district: the depot's units here / secured on the truck / gone from the district, the truck's
//    secured units, the openings of KNOWN buildings only, the tent flap; every report on a real place; a live source's key replaces the
//    map's layout default even when it reports nothing;
//  - AIR against the REAL gas system + air runtime (AIR's own fixture, tests/helpers/surfaceAirFixture.ts): GEN's pre-breached pane, the
//    smashed doorway, a pane broken in play and a door opened in play are what the source counts; no district world -> inactive;
//  - CARGO against the REAL train equipment system (CARGO's district room, tests/helpers/surfaceCargoHost.ts): a unit secured to the truck
//    moves from the depot line to the truck line; without the live equipment world the district record is read;
//  - installSurfaceLife's registration: the runtime collects the sources (inactive ones keep the defaults).
import {beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {surfaceAirFixture, surfaceAirGame} from './helpers/surfaceAirFixture';
import {frame, press, run} from './helpers/fuelCartsHost';
import {holdE, lookAtUnit, stand, stationRec} from './helpers/trainEquipmentHost';
import {districtRoom} from './helpers/surfaceCargoHost';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceBuilding, SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {surfaceKeyOf} from '../src/gen/surface/surfaceRun';
import {createRun} from '../src/run/runState';
import {WorldMaterials} from '../src/world/materials';
import {paneId} from '../src/world/officeWindows';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {buildPlanningMap, placeAt, recoverableName, refHolds} from '../src/world/surface/mapModel';
import {exploreGridFor, markDisc} from '../src/world/surface/mapExplore';
import {SurfaceMapRuntime, surfaceMapSources} from '../src/world/surface/mapRuntime';
import {airMapSource, airReports, airViewOf, cargoMapSource, cargoReports, cargoViewOf, installSurfaceMapSources, type MapSourceHost} from '../src/world/surface/mapSources';
import {depotRecoverables} from '../src/world/surface/cargoSeed';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

const centre = (b: SurfaceBuilding) => ({x: (b.footprint.x0 + b.footprint.x1) / 2, z: (b.footprint.z0 + b.footprint.z1) / 2});
const real = (host: 'subway' | 'office' | 'mall' = 'subway', seed = 7) => {
  const layout = LEVELS[host].generate('surface', {levelSeed: seed}) as StationLayout;
  return {layout, s: layout.surface as SurfaceInfo};
};

describe('Surface Run planning map sources: the report rules on a real district', () => {
  it('cargo: the depot line (reported / here / gone), the truck line; every report on a real place; the live key replaces the default', () => {
    const {s} = real();
    const reported = s.depot.recoverables.map(r => r.kind);
    expect(reported.length).toBeGreaterThanOrEqual(3);
    const N = reported.length, depot = s.buildings.find(b => b.id === s.depot.building)!, dc = centre(depot);
    const names = (k: string[]) => [...new Set(k.map(recoverableName))].join(', ');
    // before the first seeding (or with no live equipment world): the layout's report, as the default says it (re-pin, follow-up lane
    // FIXES: the ONE train upgrade a first entry seeds; the seeded views below carry no `depot` list: a depot seeded before that rule)
    expect(cargoReports(s, {seeded: false, units: null, secured: [], truck: null}).map(r => r.text)).toEqual([`Train units reported: ${names(depotRecoverables(s, false).map(r => r.kind))}`]);
    // seeded: two still at the depot, one on the truck, the rest gone from the district
    const units = [
      {kind: 'radar', mode: 'world', owner: 'station', ...dc},
      {kind: 'chest', mode: 'world', owner: 'station', x: dc.x + 1, z: dc.z},
      {kind: 'sentry', mode: 'mount', owner: 'mount', x: s.truck.x, z: s.truck.z},
    ];
    const truck = {x: s.truck.x, z: s.truck.z};
    const got = cargoReports(s, {seeded: true, units, secured: ['sentry'], truck});
    const gone = N - 3;
    expect(got.map(r => r.text)).toEqual([
      `Depot: 2 of ${N} train units here (${names(['radar', 'chest'])})${gone > 0 ? ` · ${gone} gone from the district` : ''}`,
      `Truck: 1 unit secured (${recoverableName('sentry')})`,
    ]);
    expect(got.map(r => r.key)).toEqual(['recoverables', 'truck-cargo']);
    for (const r of got) expect(placeAt(s, r.x, r.z), r.text).not.toBeNull();
    // a unit carried out into the street is neither here nor gone; none left at the depot
    const out = cargoReports(s, {seeded: true, units: [{kind: 'radar', mode: 'held', owner: 'station', x: s.portal.pose.x, z: s.portal.pose.z}], secured: [], truck});
    expect(out.map(r => r.text)).toEqual([`Depot: none of the ${N} train units left · ${N - 1} gone from the district`]);
    // on the map: the live key replaces the layout default; every marker still on a real place
    const m = buildPlanningMap(s, {explore: exploreGridFor(s.extent), entered: new Set(), reports: got, replace: ['recoverables']});
    const labels = m.markers.filter(k => k.kind === 'report').map(k => k.label);
    expect(labels).toEqual(expect.arrayContaining(got.map(r => r.text)));
    expect(labels.some(l => /Train units reported/.test(l))).toBe(false);
    for (const k of m.markers) expect(refHolds(s, k.ref, k.x, k.z)).toBe(true);
  });

  it('air: openings of KNOWN buildings only (panes, doorways), the tent flap; the live key covers the generated default', () => {
    const {s} = real('office', 9);
    const [a, b] = s.buildings.filter(q => q.enterable);
    const view = {broken: new Map([[a.id, 2]]), doors: new Map([[a.id, 1], [b.id, 2]]), tentOpen: true};
    const onlyA = airReports(s, view, {known: id => id === a.id});
    expect(onlyA.map(r => r.text)).toEqual(['Broken windows (2) · a doorway open — gas gets in', 'Tent flap open — gas gets in']);
    expect(onlyA[0]).toMatchObject({...centre(a), kind: 'hazard', key: 'windows', source: 'air'});
    const all = airReports(s, {...view, tentOpen: false}, {known: () => true});
    expect(all.map(r => r.text)).toEqual(['Broken windows (2) · a doorway open — gas gets in', '2 doorways open — gas gets in']);
    for (const r of [...onlyA, ...all]) expect(placeAt(s, r.x, r.z), r.text).not.toBeNull();
    expect(airReports(s, {broken: new Map(), doors: new Map(), tentOpen: false}, {known: () => true})).toEqual([]);
    // a live AIR with no opening anywhere: GEN's generated broken panes are NOT reported as live state
    const seen = exploreGridFor(s.extent);
    for (const q of s.buildings) markDisc(seen, centre(q).x, centre(q).z, 4);
    const live = buildPlanningMap(s, {explore: seen, entered: new Set(), reports: [], replace: ['windows']});
    expect(live.markers.some(k => /Broken windows/.test(k.label))).toBe(false);
  });
});

describe('Surface Run planning map sources: the live lanes', () => {
  it("AIR's real runtime: GEN's pre-breached pane, the smashed doorway, a pane broken and a door opened in play; inactive without a world", () => {
    const L = surfaceAirFixture();
    const g = surfaceAirGame(L, mats, {at: {x: 41, z: 23}});
    const host = {layout: g.h.layout, run: g.h.run, gas: g.sys} as unknown as MapSourceHost;
    const air = () => g.air;
    const s = L.surface!;
    const doorOpen = (b: number) => g.air.air!.doors.filter(d => !d.plan.tent && d.plan.building === b && (d.plan.leaves.length === 0 || d.t > 0.02)).length;
    const tentOpen = () => g.air.air!.doors.some(d => d.plan.tent && (d.plan.leaves.length === 0 || d.t > 0.02));
    let v = airViewOf(host, air)!;
    expect(v).not.toBeNull();
    expect(g.air.air!.prebreached.length).toBe(1);
    expect(v.broken.get(1)).toBe(1); // B1: GEN's 'broken' column, pre-breached at the first build
    expect(v.broken.get(0)).toBeUndefined();
    expect(v.doors.get(2)).toBe(1); // B2: the smashed doorway (a permanent opening)
    expect(v.doors.get(0) ?? 0).toBe(doorOpen(0)); // B0: its closed door
    expect(doorOpen(0)).toBe(0);
    expect(v.tentOpen).toBe(tentOpen());
    // a B0 pane broken in play (the gas system's own breach rule) and B0's door opened
    const plan = g.air.air!.plans.find(p => p.index === 0)!;
    const id = paneId(plan, plan.panes.find(q => q.col === 0)!);
    expect(g.sys.windows!.breakNow(id, g.h.clock)).toBe(true);
    const door = g.air.air!.doors.find(d => d.plan.building === 0 && d.plan.leaves.length > 0)!;
    expect(g.air.open(door, 'qa')).toBe(true);
    g.step(0.5);
    expect(door.t).toBeGreaterThan(0.02);
    v = airViewOf(host, air)!;
    expect(v.broken.get(0)).toBe(1);
    expect(v.doors.get(0)).toBe(1);
    // the source's reports: known buildings only; every one on a real place of the district
    const src = airMapSource(host, air);
    expect(src.keys).toEqual(['windows']);
    const reps = src.reports(s, {known: () => true, entered: new Set()})!;
    expect(reps.map(r => r.text)).toEqual(expect.arrayContaining(['Broken windows (1) · a doorway open — gas gets in', 'Broken windows (1) — gas gets in', 'a doorway open — gas gets in']));
    for (const r of reps) expect(placeAt(s, r.x, r.z), r.text).not.toBeNull();
    expect(src.reports(s, {known: b => b === 1, entered: new Set()})!.filter(r => !/Tent/.test(r.text)).map(r => r.text)).toEqual(['Broken windows (1) — gas gets in']);
    // another layout / no district world: inactive (the map keeps its defaults)
    expect(airViewOf({...host, layout: {...L}} as MapSourceHost, air)).toBeNull();
    g.teardown();
    expect(airViewOf(host, air)).toBeNull();
    expect(src.reports(s, {known: () => true, entered: new Set()})).toBeNull();
  });

  it("CARGO's real equipment system: a unit secured to the truck moves from the depot line to the truck line; offline the record is read", () => {
    // (re-pin, follow-up lane FIXES: a depot seeded under the whole-collection rule before it — the version-1 marker)
    const w = districtRoom({here: [stationRec('radar', 1, 2.9, 0, 3.2, Math.PI / 2), stationRec('chest', 2, 1.6, 0, 1.4, 0)], cargo: {v: 1, seeded: 1}});
    const {h, eq} = w;
    // the room as a district: the depot shed round both units, the layout reporting three (a scanner never recovered: gone)
    const S = {...w.S, buildings: [{id: 0, footprint: {x0: 1, z0: 0.8, x1: 3.4, z1: 3.8}}],
      depot: {building: 0, recoverables: (['radar', 'chest', 'scanner'] as const).map(kind => ({kind, pose: {x: 2, z: 2, yaw: 0, level: 0, y: 0}}))},
      truck: {x: 4.4, z: 3, yaw: -Math.PI / 2, level: 0, y: 0}} as unknown as SurfaceInfo;
    const host = {layout: {surface: S}, run: h.run, trainEquipment: eq, skywaysCar: null} as unknown as MapSourceHost;
    const v0 = cargoViewOf(host)!;
    expect(v0.seeded).toBe(true); // (the district's first build wrote the marker)
    expect(v0.units!.map(u => u.kind)).toEqual(['radar', 'chest']);
    expect(cargoReports(S, v0).map(r => r.text)).toEqual(['Depot: 2 of 3 train units here (route radar, storage chest) · 1 gone from the district']);
    // grab the radar from behind its handle and secure it to the truck ([E] near a free point it fits)
    const radar = eq.unit('eq-1')!, b = radar.body;
    stand(h, b.x - Math.sin(b.yaw) * 1.2, b.z - Math.cos(b.yaw) * 1.2, b.yaw + Math.PI, 0);
    frame(h);
    lookAtUnit(h, radar, 0, CART_LOOK.handle.y, CART_LOOK.handle.z);
    frame(h);
    holdE(h);
    expect(eq.grab?.unit).toBe(radar);
    run(h, 0.3);
    frame(h);
    press(h, 'KeyE');
    expect(radar.mode).toBe('mount');
    const v1 = cargoViewOf(host)!;
    expect(v1.secured).toEqual(['radar']);
    const src = cargoMapSource(host);
    expect(src.keys).toEqual(['recoverables']);
    expect(src.reports(S, {known: () => true, entered: new Set()})!.map(r => r.text)).toEqual([
      'Depot: 1 of 3 train units here (storage chest) · 1 gone from the district', 'Truck: 1 unit secured (route radar)']);
    // without the live equipment world: the layout's report, the truck's units from the district record (written by the flush)
    eq.flush();
    const off = {...host, trainEquipment: null} as unknown as MapSourceHost;
    expect(cargoViewOf(off)).toMatchObject({seeded: true, units: null, secured: ['radar']});
    expect(cargoReports(S, cargoViewOf(off)!).map(r => r.text)).toEqual(['Train units reported: route radar, storage chest, item scanner', 'Truck: 1 unit secured (route radar)']);
    // outside a district: no state
    expect(cargoViewOf({...host, layout: {}} as unknown as MapSourceHost)).toBeNull();
  });

  it('the runtime collects the registered sources: an inactive one keeps the defaults, a live one replaces its key even when silent', () => {
    // a real district and a building with broken generated panes (the map's default window report once it is known). The current
    // generator emits no window spans at all: then ONE span is added to an enterable destination — a stand-in for GEN's spans, only so
    // this test can see the default report and its replacement (the mechanism under test, not GEN's data)
    const {layout, s} = real();
    let shop = s.buildings.find(q => s.windows.some(w => w.building === q.id && w.panes.includes('broken')));
    if (!shop) {
      shop = s.buildings.find(q => q.destination && q.enterable && q.areas.length)!;
      const f = shop.footprint;
      s.windows.push({id: `test-w${shop.id}`, building: shop.id, level: 0, x0: f.x0, z0: f.z1 - 0.5, x1: f.x1, z1: f.z1, side: 'S', sill: 0.4, head: 2.6, panes: ['intact', 'broken'], room: shop.areas[0], shop: true});
    }
    const key = surfaceKeyOf({level: s.host, section: 'main', station: 'st-1'});
    const runState = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 5, skyways: 6, reactor: 7}, start: key, levels: LEVELS});
    runState.current = key;
    const player = {...centre(shop), y: 0, eye: 1.6, yaw: 0, pitch: 0, alive: true}; // (standing at it: its footprint explored at the build)
    const game = {
      run: runState, layout, player, state: 'playing', zombies: [], containers: null, skywaysCar: null,
      levels: {areaAt: () => -1}, scene: {add() {}},
      sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[], interactHandlers: [] as (() => boolean)[],
      promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: string) => void)[],
      layoutIndexOf: () => undefined, input: {down: () => false, suppressUntilRelease() {}}, setState() {}, enterPlay: () => Promise.resolve(),
    };
    const rt = new SurfaceMapRuntime(game as never).install();
    installSurfaceMapSources(game);
    expect(surfaceMapSources(game).map(q => q.name)).toEqual(['cargo', 'air']);
    for (const hk of game.sectionHooks) hk.build?.(layout);
    // no AIR world for this layout (inactive): the generated window default stays; CARGO offline: the layout's depot report (its key)
    let labels = rt.model()!.markers.filter(k => k.kind === 'report').map(k => k.label);
    expect(labels.some(l => /^Broken windows/.test(l))).toBe(true);
    expect(labels.filter(l => /Train units reported/.test(l)).length).toBe(1);
    // a live source covering 'windows' with nothing to say: the default goes
    surfaceMapSources(game).push({name: 'live-air', keys: ['windows'], reports: () => []});
    labels = rt.model()!.markers.filter(k => k.kind === 'report').map(k => k.label);
    expect(labels.some(l => /^Broken windows/.test(l))).toBe(false);
    // a throwing source never breaks the map
    surfaceMapSources(game).push({name: 'broken', reports: () => { throw new Error('boom'); }});
    expect(rt.model()).not.toBeNull();
  });
});
