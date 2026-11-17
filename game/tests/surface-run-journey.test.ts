// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): the SURFACE RUN crossing end to end on the REAL Game in Node
// (src/game.ts: every lane, the asset boot, the campaign lifecycle, the warm-up) over three r186's WebGPURenderer on the validating no-op
// device (helpers/headlessGame.ts, helpers/validatingWebgpu.ts), on the REAL generated district (lanes GEN / ROOMS / KIT / CARGO / LIFE /
// AIR / TRUCK / LOOK — nothing injected).
//  1. A new campaign at a Subway station whose Surface Run roll is present: the player starts in the parked train, the station records
//     version 1 and has its stairwell (the hall's grille block hidden, the street door drawn).
//  2. [E] at the stairwell's door -> the loading screen -> the district (layout.surface): no train, the train record still parked at the
//     station, the station's resources released, the player at the portal. Lane CARGO seeds the depot's recoverables into the district at
//     this first build with run uids from the train's equipment counter: its `seq` advances by exactly the units seeded (CARGO's own
//     count), everything else of the train is exact.
//  3. In the district: seated in the REAL truck the crossing is refused, out of it again; a REAL district item taken; a REAL interior
//     zombie (a layout spawn of a building interior) killed; a depot unit that moves on a dolly grabbed and carried to the portal.
//  4. [E] at the portal with the dolly -> back in the station with it (CARGO's crossing participant): the station's world exact (layout,
//     loose items, kills), the train exact but for that `seq`, the inventory = before + what was taken, nothing of the district left
//     (objects, resources, frame hooks, the outdoor replenisher's actors and keepers). The grabbed dolly rolls along on the station floor;
//     then (put on the platform outside an open car door, a QA setup) it is wheeled in through the door: the train's (aboard).
//  5. Save in the train -> Main menu -> Continue (the run decoded from storage) -> up again: the district as it was left (the item taken,
//     the zombie dead, the unit not there), the train's counter NOT advanced again (nothing re-seeded). Dying there -> Retry: back in the
//     train at the station, the station's access kept, the train / district as they were when the station was entered.
//  6. A station entered BEFORE the feature (its memory has visits but no 'surface.run' record: the stored save edited that way) decodes
//     and generates at version 0: no access, the plain generated world.
// A capture taken in the district saves the station's own section with a 'start' arrival and validates.
// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): the journey runs TWICE — in a VERSION-1 world (a station first
// built now records version 1: the legacy crossing behind the loading screen, its stairwell and street door) and in a VERSION-2 world
// (the cargo lift at a closed street exit, the lift in the command tent: the RIDE is the crossing both ways — no loading state, no
// hidden-canvas warm-up; the dolly rides along). tests/surface-lift-ride.test.ts checks the ride's own rules (doors shut until the
// destination compiled, frames drawn meanwhile, pause, the tent's doorway, recovery).
import {afterAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installHeadless} from './helpers/headlessGame';
import {generateNetwork} from '../src/campaign/network';
import {SURFACE_LANE, SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SectionKey} from '../src/levels/types';
import {checksumOf} from '../src/save/checksum';
import {validateSaveFile} from '../src/save/validate';
import {STATION_EQUIPMENT_LANE, equipmentSeqOf, stationEquipmentOf} from '../src/craft/equipment';
import {carToWorld} from '../src/world/skywaysCarSpec';
import {trainToWorld} from '../src/gen/playerTrain';
import type {Grid} from '../src/gen/grid';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The version-1 world case: an unvisited station records version 1 (Game.sectionGenInputs reads surfaceVersionFor). */
const FORCE = vi.hoisted(() => ({v1: false}));
vi.mock('../src/gen/surface/surfaceRun', async importOriginal => {
  const m = await importOriginal<typeof import('../src/gen/surface/surfaceRun')>();
  return {...m, surfaceVersionFor: (mem: Parameters<typeof m.surfaceVersionFor>[0]) => {
    const v = m.surfaceVersionFor(mem);
    return FORCE.v1 && v === m.SURFACE_VERSION && !mem?.lanes[m.SURFACE_LANE] ? 1 : v;
  }};
});

/** The first network seed whose first Subway node rolls a Surface Run (a dev start at 'subway' picks that node). */
function pickNetwork(): {seed: number; station: string; levelSeed: number} {
  for (let seed = 1; seed < 500; seed++) {
    const n = generateNetwork(seed).nodes.find(x => x.archetype === 'subway');
    if (n && surfacePresent('subway', n.levelSeed, SURFACE_VERSION)) return {seed, station: n.id, levelSeed: n.levelSeed};
  }
  throw new Error('no network with a Surface Run subway station');
}

interface Inst { mesh: THREE.InstancedMesh; index: number }
interface Body { x: number; y: number; z: number; yaw: number; vx: number; vz: number; level: number }
interface Unit { uid: string; mode: string; def: {move: string; radius: number}; body: Body; awake: boolean }
interface Equip {
  units(): readonly Unit[]; unit(uid: string): Unit | null; grab: {unit: Unit} | null; inParkedCar(uid: string): boolean;
  startGrab(u: Unit, flip?: boolean): void; letGo(why: string): void;
}
interface Priv {
  interact(): void;
  saveSectionMemory(): void;
  currentTarget: unknown;
  layoutPickup: Map<unknown, number>;
  enemyIndex: Map<unknown, number>;
  damage: {props: {index: {inst: Map<unknown, Inst[]>}}};
  trainRuntime: {train: {view: {root: THREE.Object3D}; layoutBoxes: unknown[]; placement: Parameters<typeof trainToWorld>[0]; doors: {col: {door: {x: number; side: number}}}[]} | null; spec: {floorY: number; interior: {halfWidth: number}}; playerInside(): boolean};
  trainEquipment: Equip;
  sectionGenInputs(key: SectionKey, run: unknown): {ctx: Record<string, unknown>};
}
interface Truck { vehicle: string; worldLive: boolean; driving: boolean; body: Body | null; spec: {exits: {left: {x: number; z: number}}; height: number} }

/**
 * A memory compared as poses: numbers to 1e-6 (the save's own quantisation; -0 = 0), a rotation quaternion `q` and its negation are the
 * same rotation (a rebuilt item's captured pose may come back as either). Ids, kinds, counts and every string stay exact.
 */
function canon(v: unknown, key = ''): unknown {
  if (typeof v === 'number') { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; }
  if (Array.isArray(v)) {
    let a = v;
    if (key === 'q' && a.length === 4 && a.every(x => typeof x === 'number')) {
      const lead = (a as number[]).find(x => Math.abs(x) > 1e-9) ?? 0;
      const w = Math.abs(a[3] as number) > 1e-9 ? a[3] as number : lead;
      if (w < 0) a = (a as number[]).map(x => -x);
    }
    return a.map(x => canon(x));
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x, k)]));
  return v;
}

type Slots = ({itemId: string; count: number} | null)[];
/** Every stack the player holds (quick slots, pockets, worn gear, the grenade / melee slots), by item. */
const countsOf = (inv: {hotbar: Slots; pack: Slots; gearSlots: Slots; throwSlot: Slots; meleeSlot: Slots}) => {
  const m: Record<string, number> = {};
  for (const s of [...inv.hotbar, ...inv.pack, ...inv.gearSlots, ...inv.throwSlot, ...inv.meleeSlot]) if (s) m[s.itemId] = (m[s.itemId] ?? 0) + s.count;
  return m;
};

/** A clear standing point on `g` 0.8-1.4 m from (x, z) (nearest first), else null. */
function standNear(g: Grid, x: number, z: number, r = 0.4): {x: number; z: number} | null {
  for (let d = 0.8; d <= 1.4; d += 0.2) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const [cx, cy] = g.cellOf(px, pz);
    if (g.inBounds(cx, cy) && g.walkable(cx, cy) && g.circleClear(px, pz, r)) return {x: px, z: pz};
  }
  return null;
}

describe('Surface Run: station -> district -> station -> save -> Continue -> district (real Game, validating device)', () => {
  const journey = async (v1: boolean): Promise<void> => {
    const T0 = performance.now(), marks: string[] = [];
    const mark = (s: string) => marks.push(`${s} ${((performance.now() - T0) / 1000).toFixed(1)} s`);
    const quiet = () => {};
    for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(quiet);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });

    const pick = pickNetwork();
    const hostKey: SectionKey = {level: 'subway', section: 'main', station: pick.station};
    const surfKey: SectionKey = {level: 'subway', section: 'surface', station: pick.station};
    const h = installHeadless();
    // (CI runtime) on the validating device each flashlight-shadow variant is an off-screen draw of ~20 ms, so at the default quality one
    // ride's complete compile is ~6000 Node frames (~6 min: tests/surface-lift-ride.test.ts passed so in 544 s on 2026-11-17). The atmosphere OFF (a real
    // setting: no scene-pass target, so no shadow / two-pass lanes; the scene lane in full) keeps the ride's compile to its scene items.
    // SURFACE_LIFT_FULL=1 runs the default quality.
    // (version 2 only: version 1's crossing warms up behind its loading screen at the default quality)
    if (!v1 && !process.env.SURFACE_LIFT_FULL) (globalThis as unknown as {location: {search: string}}).location.search = '?fog=off';
    try {
      const {Game} = await import('../src/game');
      const {installQaHooks} = await import('../src/qa');
      const {surfaceAccessOf} = await import('../src/world/surface/accessRuntime');
      const {surfaceReplenishOf} = await import('../src/world/surface/replenishRuntime');
      // lane CARGO's own counts (the instance the Game installs)
      const {SurfaceCargo} = await import('../src/world/surface/cargo');
      let cargo: InstanceType<typeof SurfaceCargo> | null = null;
      const install = SurfaceCargo.prototype.install;
      vi.spyOn(SurfaceCargo.prototype, 'install').mockImplementation(function (this: InstanceType<typeof SurfaceCargo>) { cargo = this; return install.call(this); });
      const game = new Game(h.canvas, false);
      const G = game as unknown as Priv;
      expect(cargo, 'lane CARGO installed').not.toBeNull();
      const C = cargo! as InstanceType<typeof SurfaceCargo>;
      installQaHooks(game);
      const qa = (globalThis as unknown as {__LL: {
        surface: {go(): boolean; access(): {prompt: string | null}; state(): {scene: {district: number; accessDoorMeshes: number}; resources: Record<string, {textures: number; owned: number}>; frameHooks: number}};
        teleport(x: number, z: number, yaw?: number, level?: number): boolean; lookAt(x: number, y: number, z: number): void; trainGo(w: string): boolean;
        trainDoor(i: number, open?: boolean): string | null;
      }}).__LL;
      const frameErrors: string[] = [];
      const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
      const states: string[] = [];
      game.stateListeners.push(s => { states.push(s); });
      game.applySettings();
      game.setState('title');
      requestAnimationFrame(loop);
      await game.initRenderer();
      await game.load(() => {});
      const until = async (f: () => boolean, max = 8000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
      const press = async () => { G.interact(); await h.waitFrames(1); };
      // (in the district the outdoor population hunts the player while the test stands about: its damage is counted, not applied —
      // Player.takeDamage is the one place hp drops; restored before the deliberate death below)
      let hits = 0;
      const guard = () => vi.spyOn(game.player, 'takeDamage').mockImplementation(() => { hits++; });
      const gridOf = (level: number): Grid => (level > 0 ? game.levels.grid(level) : game.layout.grid);
      const trainSave = () => JSON.parse(JSON.stringify(game.playerTrain.participant().save())) as {equipment: {seq: number; aboard: {uid: string}[]}};
      const laneUids = (key: SectionKey) => stationEquipmentOf(game.run.laneStore(STATION_EQUIPMENT_LANE, key)).map(r => r.uid);
      mark('boot');

      // ---- 1. new campaign at the Surface Run station: in the train, version 1, the stairwell --------------------------------------
      expect(await game.newCampaign(1, {overwrite: true, networkSeed: pick.seed, dev: {level: 'subway'}})).toMatchObject({ok: true, saved: true});
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('new game');
      expect(game.run.current).toEqual(hostKey);
      expect(G.trainRuntime.playerInside(), 'a new game starts in the parked train').toBe(true);
      expect(game.run.laneStore(SURFACE_LANE, hostKey)).toEqual({v: v1 ? 1 : SURFACE_VERSION});
      const acc = game.layout.surfaceAccess!;
      expect(acc.kind).toBe(v1 ? 'subway-stair' : 'lift');
      const grille = game.layout.props.find(p => p.kind === 'exitStair' && p.area === acc.hall)!;
      expect(grille).toMatchObject({cargoGone: true, h: 0, blocksSight: false});
      const inst = G.damage.props.index.inst.get(grille) ?? [];
      expect(inst.length, 'the hall\'s grille block is drawn by shared instances').toBeGreaterThan(0);
      const m = new THREE.Matrix4();
      for (const e of inst) { e.mesh.getMatrixAt(e.index, m); expect([m.elements[0], m.elements[5], m.elements[10]], 'its instances are hidden').toEqual([0, 0, 0]); }
      if (v1) expect(qa.surface.state().scene.accessDoorMeshes, 'the street door is drawn').toBeGreaterThan(0);
      // refused from a menu (the [E] itself needs the door: below)
      game.setState('paused');
      expect(await game.crossSurface()).toMatchObject({ok: false, reason: 'not-playing'});
      await game.enterPlay(); // (Resume: the pointer captured again)
      expect(await until(() => game.state === 'playing', 300)).toBe(true);
      await h.waitFrames(60); // (loose items settle)

      // the station's state, the train, the inventory, the hooks, before the [E] crossing
      const ownProps = (L: StationLayout) => { const boxes = new Set<unknown>(G.trainRuntime.train?.layoutBoxes ?? []); return L.props.filter(p => !boxes.has(p) && !p.cargo); };
      const snapHost = () => {
        G.saveSectionMemory();
        const mem = canon(game.run.peekMemory(hostKey)!) as {pickups: unknown; holders: unknown; killed: unknown; cleared: unknown};
        const L = game.layout;
        return {
          mem: {pickups: mem.pickups, holders: mem.holders, killed: mem.killed, cleared: mem.cleared},
          areas: L.areas.map(a => `${a.id}:${a.type}:${a.label}:${a.x},${a.y},${a.w},${a.h}`),
          props: ownProps(L).map(p => `${p.kind}@${p.x.toFixed(3)},${p.z.toFixed(3)},${p.y.toFixed(3)}:${p.h.toFixed(3)}:${!!p.cargoGone}`),
          signs: L.signs.map(s => s.text), cells: Array.from(L.grid.cells).join(''), access: structuredClone(L.surfaceAccess),
          alive: game.zombies.filter(z => z.brain.alive).length,
        };
      };
      const host0 = snapHost();
      const train0 = trainSave(), seq0 = train0.equipment.seq;
      const inv0 = countsOf(game.inv);
      const hooks0 = game.frameHooks.length;
      const res0 = qa.surface.state().resources;
      const trainRoot = G.trainRuntime.train!.view.root;
      expect(trainRoot.parent).not.toBeNull();
      expect(C.counts.seeded, 'nothing seeded before the district is built').toBe(0);

      // ---- 2. [E] at the stairwell's door -> the district ------------------------------------------------------------------------
      const c0 = {...game.lifecycleCounts}, s0 = states.length, done0 = game.surfaceCrossCounts.done;
      let guarded = guard();
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      expect(surfaceAccessOf(game)!.aimed).toBe(true);
      expect(qa.surface.access().prompt).toBe(v1 ? '<b>[E]</b> Go up to the street' : '<b>[E]</b> Ride up to the street');
      await press();
      expect(await until(() => game.surfaceCrossCounts.done === done0 + 1 && game.state === 'playing')).toBe(true);
      mark('[E] up');
      expect(states.slice(s0), v1 ? 'the loading screen, then play' : 'the ride: play throughout').toEqual(v1 ? ['loading', 'playing'] : []);
      expect(game.lifecycleCounts.loading - c0.loading).toBe(v1 ? 1 : 0);
      expect(game.lifecycleCounts.leave - c0.leave).toBe(1);
      expect(game.lifecycleCounts.build - c0.build).toBe(1);
      if (v1) expect(game.lifecycleCounts.warmup - c0.warmup).toBeGreaterThanOrEqual(1);
      else expect(game.lifecycleCounts.warmup - c0.warmup, 'the ride compiles in drawn frames: no hidden-canvas warm-up').toBe(0);
      expect(game.run.current).toEqual(surfKey);
      const S = game.layout.surface!;
      expect(S).toBeTruthy();
      expect(game.trainPlacement, 'no train in the district').toBeNull();
      expect(G.trainRuntime.train).toBeNull();
      expect(trainRoot.parent, 'the car is not in the district\'s scene').toBeNull();
      expect(game.playerTrain.state.at, 'the train stays parked at the station (its record: level + section)').toEqual({level: 'subway', section: 'main'});
      const res1 = qa.surface.state().resources;
      marks.push(`resources: station ${JSON.stringify(res0)} district ${JSON.stringify(res1)}`);
      expect(res1.subway?.owned ?? 0, `the station's own resources released: ${JSON.stringify(res1)}`).toBe(0);
      expect(res1.subway?.textures ?? 0).toBe(0);
      const pose = S.portal.pose;
      expect(Math.hypot(game.player.x - pose.x, game.player.z - pose.z), 'at the portal').toBeLessThan(0.75);
      expect(game.openTravelMap('travel'), 'no travel map from the district').toBe(false);
      expect(await game.travelToStation(game.run.campaign!.current)).toMatchObject({ok: false});
      // the depot seeded ONCE, with run uids from the train's counter: seq advanced by exactly CARGO's count
      expect(C.counts.seeded).toBe(1);
      const seeded = C.counts.seededUnits;
      expect(seeded, 'the depot has recoverables').toBeGreaterThan(0);
      const seededUids = Array.from({length: seeded}, (_, k) => `eq-${seq0 + 1 + k}`);
      expect(trainSave().equipment.seq).toBe(seq0 + seeded);
      expect(G.trainEquipment.units().filter(u => equipmentSeqOf(u.uid) > seq0).map(u => u.uid).sort(), 'the seeded units stand in the district').toEqual([...seededUids].sort());
      // a capture here resumes in the train at the station (and validates)
      const cap = game.captureSave('manual', {slot: 1});
      expect(cap.run.section).toBe('main');
      expect(cap.run.arrival).toBe('start');
      expect(Object.keys(cap.run.memories)).toContain(`${pick.station}:surface`);
      expect(validateSaveFile(cap).ok, 'a save captured in the district validates').toBe(true);
      // the outdoor replenisher: its keepers and its actors (runtime spawns: no layout index, never counted)
      const rep = surfaceReplenishOf(game)!;
      expect(rep.rep, 'the replenisher runs in the district').not.toBeNull();
      const keepers = rep.keepers!;
      expect(keepers.parent, 'its keeper actors are in the scene (hidden)').toBe(game.scene);
      const outdoorActors = game.zombies.filter(z => game.uncountedEnemies.has(z));
      for (const z of outdoorActors) expect(G.enemyIndex.has(z), 'a replenished actor has no layout index').toBe(false);
      marks.push(`outdoor actors ${outdoorActors.length}, keepers ${rep.qa().keepers}, depot units ${seeded}`);

      // ---- 3. the district: the truck seat, a real item, a real interior zombie, a depot unit on its dolly ----------------------
      // seated in the truck (the [E] on the vehicle from its left door) the crossing is refused; [E] again gets out
      const car = game.skywaysCar as unknown as Truck;
      expect(car.vehicle).toBe('truck');
      expect(car.worldLive).toBe(true);
      const tb = car.body!, door = carToWorld(tb.x, tb.z, tb.yaw, car.spec.exits.left.x, car.spec.exits.left.z);
      expect(qa.teleport(door.x, door.z, undefined, tb.level)).toBe(true);
      qa.lookAt(tb.x, tb.y + car.spec.height * 0.5, tb.z);
      await h.waitFrames(2);
      await press();
      expect(car.driving, 'in the truck seat').toBe(true);
      expect(await game.crossSurface()).toMatchObject({ok: false, reason: 'seated'});
      await press();
      expect(await until(() => !car.driving, 60), 'out of the truck').toBe(true);
      await h.waitFrames(5);
      // a real district item (generated loot lying in the district; the nearest one that comes under the crosshair)
      const items = game.pickups.list.filter(p => G.layoutPickup.has(p))
        .map(p => ({p: p as unknown as {x: number; y: number; z: number; stack: {itemId: string; count: number}}, i: G.layoutPickup.get(p)!}))
        .sort((a, b) => Math.hypot(a.p.x - pose.x, a.p.z - pose.z) - Math.hypot(b.p.x - pose.x, b.p.z - pose.z));
      expect(items.length, 'the district has generated loot').toBeGreaterThan(0);
      let taken: {i: number; itemId: string; count: number} | null = null;
      for (const {p, i} of items.slice(0, 12)) {
        const lv = game.layout.pickups[i].level ?? 0, st = standNear(gridOf(lv), p.x, p.z);
        if (!st || !qa.teleport(st.x, st.z, undefined, lv)) continue;
        qa.lookAt(p.x, p.y + 0.03, p.z);
        if (!(await until(() => G.currentTarget === p, 20))) continue;
        const {itemId, count} = p.stack, n0 = countsOf(game.inv)[itemId] ?? 0;
        await press();
        if (game.pickups.list.includes(p as never)) continue;
        expect(countsOf(game.inv)[itemId] ?? 0, `${itemId} x${count} taken into the inventory`).toBe(n0 + count);
        taken = {i, itemId, count};
        marks.push(`took ${itemId} x${count} (pickup ${i})`);
        break;
      }
      expect(taken, 'a real district item was taken').not.toBeNull();
      // a real interior zombie (a generated spawn inside a building: not an outdoor area, a layout index)
      const outdoor = new Set([...S.outdoor.areas, ...S.outdoorAreas]);
      const zb = game.zombies.find(z => z.brain.alive && G.enemyIndex.has(z) && !game.uncountedEnemies.has(z) && !outdoor.has(game.layout.zombies[G.enemyIndex.get(z)!]?.area ?? -1));
      expect(zb, 'the district has an interior zombie up').toBeTruthy();
      const killed = G.enemyIndex.get(zb)!;
      zb!.brain.damage(zb!.brain.hp + 1, game.player.x, game.player.z);
      await h.waitFrames(10);
      expect(zb!.brain.alive).toBe(false);
      mark('district action');
      // a depot unit that moves on its dolly: grabbed in the portal's [E] box, the dolly in front of the player
      const E = G.trainEquipment;
      /** Stand a live unit at a world point (QA setup, as TrainEquipmentSystem.qaToPlug does: its drawn pose re-solved). */
      const placeUnit = (u: Unit, x: number, z: number, y: number, level: number) => {
        Object.assign(u.body, {x, z, y, level, vx: 0, vz: 0});
        const sys = E as unknown as {solvePose(u: Unit, dt: number, snap: boolean): void; draw(u: Unit, now: boolean): void};
        sys.solvePose(u, 0, true);
        sys.draw(u, true);
      };
      const dolly = E.units().find(u => seededUids.includes(u.uid) && u.mode === 'world' && u.def.move === 'dolly');
      expect(dolly, 'the depot has a dolly unit').toBeTruthy();
      const way = surfaceAccessOf(game)!.way!, tr = way.trigger, g0 = gridOf(pose.level ?? 0);
      // (standing within ACCESS_AIM.near of the box's focus aims at the way whatever the facing: the dolly goes where there is room)
      let at: {x: number; z: number; ux: number; uz: number; yaw: number} | null = null;
      find: for (const r of [0, 0.3, 0.6]) for (let a = 0; a < 8; a++) for (let k = 0; k < 16; k++) {
        const x = way.focus.x + Math.cos(a * Math.PI / 4) * r, z = way.focus.z + Math.sin(a * Math.PI / 4) * r, yaw = pose.yaw + (k * Math.PI) / 8;
        const ux = x - Math.sin(yaw), uz = z - Math.cos(yaw);
        if (x < tr.x0 || x > tr.x1 || z < tr.z0 || z > tr.z1 || !g0.circleClear(x, z, 0.4) || !g0.circleClear(ux, uz, dolly!.def.radius + 0.1)) continue;
        if (Math.abs(g0.floorAt(ux, uz) - g0.floorAt(x, z)) > 0.05) continue;
        at = {x, z, ux, uz, yaw};
        break find;
      }
      expect(at, 'room in the portal box for the player and the dolly').not.toBeNull();
      expect(qa.teleport(at!.x, at!.z, at!.yaw, pose.level ?? 0)).toBe(true);
      placeUnit(dolly!, at!.ux, at!.uz, game.player.y, pose.level ?? 0);
      E.startGrab(dolly!);
      await h.waitFrames(3);
      expect(E.grab?.unit.uid, 'the dolly grabbed').toBe(dolly!.uid);

      // ---- 4. [E] at the portal (with the dolly) -> back in the station, exact ----------------------------------------------------
      const done1 = game.surfaceCrossCounts.done;
      const preGrab = {grab: E.grab?.unit.uid ?? null, way: surfaceAccessOf(game)!.aimed, refusal: game.surfaceCrossRefusal()?.text ?? null, counts: JSON.stringify((E as unknown as {counts: unknown}).counts)};
      expect(surfaceAccessOf(game)!.aimed).toBe(true);
      expect(qa.surface.access().prompt).toBe(`<b>[E]</b> ${v1 ? 'Back down' : 'Ride down'} to ${game.run.node(pick.station)!.name}`);
      await press();
      const downOk = await until(() => game.surfaceCrossCounts.done === done1 + 1 && game.state === 'playing', 3000);
      expect(downOk, JSON.stringify({counts: game.surfaceCrossCounts, state: game.state, at: game.run.current, transit: (E as unknown as {inTransit: unknown}).inTransit, grab: E.grab?.unit.uid ?? null, errors: errors.slice(0, 3), frameErrors: frameErrors.slice(0, 2)})).toBe(true);
      mark('[E] down');
      guarded.mockRestore();
      // the dolly came down with the player: in front of the arrival pose, grabbed again (CARGO's crossArrive)
      const du = E.unit(dolly!.uid);
      const arrival = {grab: E.grab?.unit.uid ?? null, mode: du?.mode ?? null, d: du ? +Math.hypot(du.body.x - game.player.x, du.body.z - game.player.z).toFixed(2) : null, transit: (E as unknown as {inTransit: unknown}).inTransit,
        station: laneUids(hostKey), district: laneUids(surfKey), aboard: trainSave().equipment.aboard.map(r => r.uid), counts: (E as unknown as {counts: unknown}).counts, preGrab};
      expect(arrival.mode, `the dolly crossed down into the station world: ${JSON.stringify(arrival)}`).toBe('world');
      expect(arrival.grab, `grabbed again on arrival: ${JSON.stringify(arrival)}`).toBe(dolly!.uid);
      expect(game.run.current).toEqual(hostKey);
      const back = game.layout.surfaceAccess!.returnPose;
      if (v1) expect(Math.hypot(game.player.x - back.x, game.player.z - back.z), 'at the stairwell door').toBeLessThan(0.75);
      else { const c = game.layout.surfaceAccess!.lift!.cab; expect(game.player.x > c.x0 && game.player.x < c.x1 && game.player.z > c.z0 && game.player.z < c.z1, 'in the station\'s lift car (where the player stood in the tent\'s)').toBe(true); }
      await h.waitFrames(20);
      expect(snapHost(), 'the station exactly as it was left').toEqual(host0);
      const train1 = trainSave();
      expect({...train1, equipment: {...train1.equipment, seq: seq0}}, 'the train, its Lockbox, fuel and equipment exact (but the uid counter)').toEqual(train0);
      expect(train1.equipment.seq, 'the counter: + the depot units seeded, nothing else').toBe(seq0 + seeded);
      expect(G.trainRuntime.train, 'the car is back').not.toBeNull();
      expect({...countsOf(game.inv), [taken!.itemId]: inv0[taken!.itemId] ?? 0}).toEqual({...inv0, [taken!.itemId]: inv0[taken!.itemId] ?? 0});
      expect(countsOf(game.inv)[taken!.itemId]).toBe((inv0[taken!.itemId] ?? 0) + taken!.count);
      // (crossArrive spawned the unit anew in the station: the live unit is re-read by uid)
      const dl = E.unit(dolly!.uid)!;
      expect(E.grab?.unit, 'still grabbed after 20 frames').toBe(dl);
      { // it rolls on its dolly in the station: the player walks on along the arrival facing, the dolly comes along in front
        // (version 2: the arrival is in the lift car, the facing the one the player rode with: turned toward the car's gate first)
        if (!v1) { const l = game.layout.surfaceAccess!.lift!, o = l.doorSide === 'N' ? [0, -1] : l.doorSide === 'S' ? [0, 1] : l.doorSide === 'W' ? [-1, 0] : [1, 0]; game.player.yaw = Math.atan2(-o[0], -o[1]); await h.waitFrames(20); }
        const P = game.player, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), b0 = {x: dl.body.x, z: dl.body.z}, p0 = {x: P.x, z: P.z};
        for (let i = 0; i < 50; i++) { if (game.levels.main.circleClear(P.x + fx * 0.6, P.z + fz * 0.6, 0.3)) { P.x += fx * 0.02; P.z += fz * 0.02; } await h.waitFrames(1); }
        await h.waitFrames(20);
        const walked = Math.hypot(P.x - p0.x, P.z - p0.z), rolled = Math.hypot(dl.body.x - b0.x, dl.body.z - b0.z);
        marks.push(`station: walked ${walked.toFixed(2)} m, the dolly rolled ${rolled.toFixed(2)} m`);
        expect(walked, 'room to walk on from the stairwell door').toBeGreaterThan(0.5);
        expect(rolled, 'the grabbed dolly follows on the station floor').toBeGreaterThan(walked * 0.6);
        expect(E.grab?.unit).toBe(dl);
      }
      // the dolly listed by the station (written at the arrival), gone from the district's lane
      expect(laneUids(hostKey)).toContain(dolly!.uid);
      expect(laneUids(surfKey)).not.toContain(dolly!.uid);
      // nothing of the district left: objects, resources, hooks, the replenisher's actors and keepers
      const st4 = qa.surface.state();
      expect(st4.scene.district, 'nothing of the district in the scene').toBe(0);
      marks.push(`resources back: ${JSON.stringify(st4.resources)}`);
      expect(st4.resources.surface?.owned ?? 0, `no district resources: ${JSON.stringify(st4.resources)}`).toBe(0);
      expect(st4.resources.surface?.textures ?? 0).toBe(0);
      expect(st4.resources, 'the station\'s resources are back as they were').toEqual(res0);
      expect(st4.frameHooks, 'no frame hook left over').toBe(hooks0);
      expect(rep.rep, 'the replenisher stopped').toBeNull();
      expect(rep.keepers).toBeNull();
      expect(keepers.parent, 'its keepers out of the scene').toBeNull();
      for (const z of outdoorActors) {
        expect(game.zombies.includes(z), 'no outdoor actor underground').toBe(false);
        expect(z.root.parent).toBeNull();
      }
      expect(rep.qa().district).toBe(false);
      const dmem = structuredClone(game.run.peekMemory(surfKey)!);
      expect(dmem.killed).toContain(killed);
      expect((dmem.pickups ?? []).some(r => r.layoutIndex === taken!.i), 'the taken item is not in the district memory').toBe(false);
      // the dolly wheeled into the car through the middle platform-side door (QA setup: the player and the grabbed dolly are put on the
      // platform 2.4 m outside the open door; then the player's position steps in, and the dolly — on its grab spring and the cart
      // physics — rolls in ahead of it through the doorway)
      const T = G.trainRuntime.train!, spec = G.trainRuntime.spec;
      let k = -1;
      T.doors.forEach((d, j) => { if (d.col.door.side < 0 && (k < 0 || Math.abs(d.col.door.x) < Math.abs(T.doors[k].col.door.x))) k = j; });
      expect(k).toBeGreaterThanOrEqual(0);
      expect(['opening', 'unchanged']).toContain(qa.trainDoor(k, true));
      await h.waitFrames(90);
      const dd = T.doors[k].col.door, hw = spec.interior.halfWidth;
      const outP = trainToWorld(T.placement, dd.x, spec.floorY, dd.side * (hw + 2.4)), inP = trainToWorld(T.placement, dd.x, spec.floorY, dd.side * (hw - 0.4));
      const dirX = (inP.x - outP.x) / Math.hypot(inP.x - outP.x, inP.z - outP.z), dirZ = (inP.z - outP.z) / Math.hypot(inP.x - outP.x, inP.z - outP.z);
      E.letGo('qa');
      expect(qa.teleport(outP.x, outP.z, Math.atan2(-dirX, -dirZ), (T.placement as {level?: number}).level ?? 0)).toBe(true);
      placeUnit(dl, outP.x + dirX * 1.0, outP.z + dirZ * 1.0, game.player.y, (T.placement as {level?: number}).level ?? 0);
      E.startGrab(dl);
      await h.waitFrames(2);
      for (let i = 0; i < 240 && !E.inParkedCar(dolly!.uid); i++) {
        const P = game.player;
        if (Math.hypot(P.x - inP.x, P.z - inP.z) > 0.15) { P.x += dirX * 0.02; P.z += dirZ * 0.02; }
        await h.waitFrames(1);
      }
      const r2 = (v: number) => +v.toFixed(2), tq = (qa as unknown as {train(): {doors: unknown[]}}).train();
      const wheel = {door: tq.doors[k], out: [r2(outP.x), r2(outP.z)], in: [r2(inP.x), r2(inP.z)], player: [r2(game.player.x), r2(game.player.y), r2(game.player.z)],
        unit: [r2(dl.body.x), r2(dl.body.y), r2(dl.body.z), dl.body.level], floorY: spec.floorY, hw, grab: E.grab?.unit.uid ?? null};
      expect(E.grab?.unit.uid, 'still on its dolly').toBe(dolly!.uid);
      expect(E.inParkedCar(dolly!.uid), `wheeled into the car: ${JSON.stringify(wheel)}`).toBe(true);
      E.letGo('qa');
      await h.waitFrames(5);
      expect(trainSave().equipment.aboard.map(r => r.uid), 'the train\'s now (aboard)').toContain(dolly!.uid);
      mark('wheeled aboard');

      // ---- 5. save in the train -> Main menu -> Continue -> up again: the district as it was left ---------------------------------
      expect(qa.trainGo('spawn')).toBe(true);
      await h.waitFrames(3);
      expect(game.saveNow()).toMatchObject({ok: true});
      expect(laneUids(hostKey), 'saved: the station\'s lane no longer lists the wheeled unit (the train\'s now)').not.toContain(dolly!.uid);
      expect(trainSave().equipment.aboard.map(r => r.uid)).toContain(dolly!.uid);
      const dmemSaved = canon(structuredClone(game.run.peekMemory(surfKey)!));
      const trainSaved = trainSave();
      game.setState('paused');
      game.returnToMenu();
      await h.waitFrames(5);
      expect(await game.continueCampaign(1)).toEqual({ok: true});
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('continue');
      expect(game.run.current).toEqual(hostKey);
      expect(G.trainRuntime.playerInside(), 'Continue resumes in the train').toBe(true);
      // (poses through the save's own 6-dp quantisation; identity, contents and condition exact)
      expect(canon(game.run.peekMemory(surfKey)), 'the district memory came back from the save').toEqual(dmemSaved);
      expect(canon(trainSave()), 'the train came back from the save (the dolly unit aboard)').toEqual(canon(trainSaved));
      expect(game.layout.surfaceAccess).toEqual(host0.access);
      const done2 = game.surfaceCrossCounts.done;
      guarded = guard();
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      await press();
      expect(await until(() => game.surfaceCrossCounts.done === done2 + 1 && game.state === 'playing')).toBe(true);
      mark('[E] up after Continue');
      expect(game.run.current).toEqual(surfKey);
      expect(game.pickups.list.some(p => G.layoutPickup.get(p) === taken!.i), 'the taken item stays taken').toBe(false);
      expect(game.zombies.some(z => G.enemyIndex.get(z) === killed && z.brain.alive), 'the killed zombie stays dead').toBe(false);
      expect(C.counts.seeded, 'the depot is never seeded twice').toBe(1);
      expect(C.counts.seededUnits).toBe(seeded);
      expect(trainSave().equipment.seq, 'the counter does not advance on re-entry').toBe(seq0 + seeded);
      expect(E.units().filter(u => u.mode === 'world').map(u => u.uid).sort(), 'the depot as left: the wheeled unit is not there').toEqual(seededUids.filter(u => u !== dolly!.uid).sort());

      // ---- Retry after dying in the district: back in the train at the station, both worlds as the station was entered ----------
      guarded.mockRestore();
      marks.push(`district hits absorbed: ${hits}`);
      game.player.takeDamage(1e6);
      expect(await until(() => game.state === 'dead', 300)).toBe(true);
      await h.waitFrames(10);
      await game.retryLevel();
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('retry');
      expect(game.run.current).toEqual(hostKey);
      expect(G.trainRuntime.playerInside(), 'Retry resumes in the train').toBe(true);
      expect(game.layout.surfaceAccess, 'the station keeps its access').toEqual(host0.access);
      expect(game.run.laneStore(SURFACE_LANE, hostKey)).toEqual({v: v1 ? 1 : SURFACE_VERSION});
      expect(game.run.peekMemory(surfKey), 'the district as it was when the station was entered (never visited)').toBeUndefined();
      expect(trainSave(), 'the train as it was when the station was entered').toEqual(train0);

      // ---- 6. a station entered before the feature: version 0, no access ---------------------------------------------------------
      const raw = game.saves.read(1);
      expect(raw.ok).toBe(true);
      const file = structuredClone((raw as {file: {run: {memories: Record<string, {visits: number; lanes: Record<string, unknown>}>; entry?: {memories: Record<string, {lanes: Record<string, unknown>}>} | null}; checksum: string}}).file);
      const hostId = `${pick.station}:main`;
      expect(file.run.memories[hostId].visits).toBeGreaterThan(0);
      for (const ms of [file.run.memories, file.run.entry?.memories ?? {}]) {
        if (ms[hostId]) delete ms[hostId].lanes[SURFACE_LANE];
        delete ms[`${pick.station}:surface`];
      }
      file.checksum = checksumOf(file.run);
      const dec = game.decodeSave(file);
      expect(dec.ok, 'the edited save decodes').toBe(true);
      const run = (dec as {restore: {run: typeof game.run}}).restore.run;
      const legacy = game.generateSection(hostKey, run);
      expect(legacy.surfaceAccess, 'a station entered before the feature has no access').toBeUndefined();
      expect(run.laneStore(SURFACE_LANE, hostKey), 'and keeps version 0').toEqual({v: 0});
      const {ctx} = G.sectionGenInputs(hostKey, run);
      expect(ctx.surfaceVersion).toBe(0);
      const plainL = LEVELS.subway.generate('main', {...ctx, surfaceVersion: undefined} as never);
      expect(legacy.areas.length).toBe(plainL.areas.length);
      expect(legacy.props.length).toBe(plainL.props.length);
      expect(legacy.props.some(p => p.kind === 'exitStair' && p.cargoGone)).toBe(false);
      expect(Array.from(legacy.grid.cells).join('')).toBe(Array.from(plainL.grid.cells).join(''));

      expect(frameErrors).toEqual([]);
      expect(errors).toEqual([]);
      expect(h.log.dropped, 'no dropped submit').toBe(0);
    } finally {
      h.stop();
      process.stdout.write(`surface-run-journey: ${marks.join(' | ')}\n`);
    }
  };
  it('version 1: crosses both ways behind the loading screen; both worlds and the train exact; the district persists through a save', async () => {
    FORCE.v1 = true;
    try { await journey(true); } finally { FORCE.v1 = false; vi.restoreAllMocks(); } // (the run's spies: the next run spies afresh)
  }, 900_000); // (about 5 min on one local worker: headroom for a slower CI shard)
  it('version 2: crosses both ways by the cargo lift ride; both worlds and the train exact; the district persists through a save', async () => {
    try { await journey(false); } finally { vi.restoreAllMocks(); }
  }, 900_000);
});
