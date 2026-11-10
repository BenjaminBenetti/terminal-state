// Task studio-beta-train-all-cargo-20261107-184244-01 (user: "Let’s have all items on the train move with the train!" — the movable
// furniture / decor / containers too): world/trainPropCargo.ts on generated stations with the REAL built world (buildWorld, stand-in
// models), PhysicsSystem / DynamicItems, PropDamage, ContainerManager, PickupManager, PlayerTrainRuntime, TrainRide and Player (the item
// cargo installed beside it), in Game.buildSection's order:
//  - records: cargo v2 (props) / v1 (items only), the station lane, strict save validation (kinds, poses, riders, one prop one place);
//  - ownership: a loose prop inside the parked car is the train's, the platform's is the station's; a prop in the doorway refuses;
//  - a whole journey Subway -> Office with a suitcase / bin / camp lantern class mix (a spill holder: its lots spill where it was knocked
//    over and travel as item cargo): withdrawn from the source, riding copies on the car root moving with it + their ride collision,
//    hidden at the arriving build, loose at the exact train-local pose in the new parked car after the stop, same look, empty holder;
//  - unload / revisit / return: a prop pushed out is the destination's (`here`), a revisit appends it once; back at the source its
//    generated originals stay hidden (`gone`) and the carried ones appear once; every identity exactly once;
//  - Continue (the participant record), a refused / reset departure, a failed-back journey, the cross-level look (mall / Skyways kinds
//    in the Subway, a garment rail with its riders), the shared ride collision with the fuel carts, level resources kept for carried art.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../src/gen/props';
import {playerTrainPlacement, trainSpawnPose, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {RIDE_FRAME, carToWorld, fromStep, setRideCargoBoxes} from '../src/world/trainRideLocal';
import {PickupManager} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {CARGO_TEXT, TrainCargoSystem} from '../src/world/trainCargo';
import {PROP_CARGO_TEXT, TrainPropCargo, carriedModelKeys} from '../src/world/trainPropCargo';
import {CARGO, STATION_PROPS_LANE, cargoProblem, propsProblem, stationPropsProblem, type CargoPropJSON, type StationPropsJSON} from '../src/run/trainCargo';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {PhysicsSystem} from '../src/physics/world';
import {dynamicKind} from '../src/physics/dynamicItems';
import {PropDamage} from '../src/damage/propDamage';
import {buildWorld} from '../src/world/builder';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {lootProfile} from '../src/items/lootTables';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {sectionId, type SectionKey} from '../src/levels/types';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {p7ModelKeysFor} from '../src/gen/props07';
import {officeModelKeysFor} from '../src/gen/office/kinds';
import {LevelResources} from '../src/assets/levelResources';
import {checksumOf} from '../src/save/checksum';
import {validateSaveFile} from '../src/save/validate';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {standInModels} from './helpers/contactWalk';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {frame, run, stationHost} from './helpers/fuelCartsHost';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const SUB = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const OFF = (): StationLayout => LEVELS.office.generate('main', {levelSeed: 4242});
const KA: SectionKey = {level: 'subway', section: 'main', station: sid(1)};
const KB: SectionKey = {level: 'office', section: 'main', station: sid(2)};
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

/** The run's lane stores (RunState.laneStore / setLaneStore by section id) and the section being played. */
class FakeRun {
  entry: null = null;
  readonly lanes = new Map<string, Record<string, unknown>>();
  constructor(public current: SectionKey) {}
  laneStore<T = unknown>(lane: string, key: SectionKey = this.current): T | undefined { return this.lanes.get(sectionId(key))?.[lane] as T | undefined; }
  setLaneStore(lane: string, data: unknown, key: SectionKey = this.current): void {
    const id = sectionId(key), m = this.lanes.get(id) ?? {};
    if (data === undefined) delete m[lane]; else m[lane] = data;
    this.lanes.set(id, m);
  }
  station(key: SectionKey): StationPropsJSON { return (this.laneStore<StationPropsJSON>(STATION_PROPS_LANE, key)) ?? {v: 1, gone: [], here: []}; }
}

let mats: WorldMaterials | null = null;
interface World { L: StationLayout; key: SectionKey; group: THREE.Group; cm: ContainerManager; ph: PhysicsSystem; pd: PropDamage }

/** The real train runtime + ride (stationHost), the item cargo and the prop cargo, no world yet. */
function rig(first: StationLayout, key: SectionKey = KA) {
  const s = stationHost(first, {build: false});
  live.push(s.rt);
  const h = s.h as typeof s.h & Record<string, unknown> & {run: FakeRun; sectionLayoutHooks: ((l: StationLayout, k: SectionKey, r: unknown, p: 'prepare' | 'build') => void)[]};
  const inv = new Inventory(), pickups = new PickupManager({});
  h.scene.add(pickups.group);
  Object.assign(h, {inv, pickups, syncHeld: () => {}, sectionLayoutHooks: [], run: new FakeRun(key), containers: null, damage: {props: new PropDamage()}});
  const items = new TrainCargoSystem(h as never).install();
  const props = new TrainPropCargo(h as never).install();
  return {...s, h, inv, pickups, items, props, world: null as World | null};
}
type Rig = ReturnType<typeof rig>;

/** Game.prepareSection + buildSection in order: the layout hooks (prepare, build), the world, holders, physics, damage, the section hooks. */
function enter(c: Rig, L: StationLayout, key: SectionKey): World {
  const h = c.h;
  h.run.current = key;
  for (const f of h.sectionLayoutHooks) f(L, key, h.run, 'prepare');
  for (const f of h.sectionLayoutHooks) f(L, key, h.run, 'build');
  mats ??= new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const built = buildWorld(L, mats, standInModels(L));
  h.scene.add(built.group);
  const cm = new ContainerManager({}, mats, () => c.inv);
  cm.onEvent = e => {
    if (e.type !== 'spill') return;
    for (const sp of e.spilled ?? []) { const st = c.inv.makeStack(sp.lot.itemId, sp.lot.count); st.count = sp.lot.count; c.pickups.addAt(st, sp.matrix, {holder: e.container.serial, lot: sp.lot.id}); }
  };
  cm.build(L, {}, lootProfile(key.level));
  h.scene.add(cm.group);
  const levels = levelsOf(L);
  Object.assign(h, {containers: cm, layout: L, levels, propIndex: new PropIndex(levels, L.props), trainPlacement: playerTrainPlacement(L)});
  for (const s of h.sectionHooks) (s as {holders?(l: never): void}).holders?.(L as never);
  const ph = new PhysicsSystem(null);
  ph.build(L);
  const pd = new PropDamage();
  pd.build(L.props, [built.group, cm.group]);
  pd.hooks = {ownMeshes: p => cm.ownMeshes(p)};
  ph.holderBoxes = p => cm.physicsBoxes(p);
  ph.dynamicItems.detacher = pd;
  ph.dynamicItems.holderLoose = p => cm.goLoose(p);
  ph.dynamicItems.pickups = () => c.pickups.list;
  Object.assign(h, {physics: ph, damage: {props: pd}});
  for (const s of h.sectionHooks) s.build?.(L as never);
  if (!c.ride.riding && h.trainPlacement) { const pose = trainSpawnPose(L, h.trainPlacement); h.player.spawn(pose.x, pose.z, pose.yaw, pose.y); }
  c.world = {L, key, group: built.group, cm, ph, pd};
  return c.world;
}

/** Game.leaveSection: the section hooks' teardowns, then the world goes (bodies, damage parts, holders, pickups). */
function leave(c: Rig): void {
  const h = c.h, w = c.world!;
  for (const s of h.sectionHooks) s.teardown?.();
  h.scene.remove(w.group);
  w.pd.clear();
  w.ph.dynamicItems.clear();
  w.cm.clear();
  h.scene.remove(w.cm.group);
  c.pickups.clear();
  c.world = null;
}

const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1));
const UP = new THREE.Vector3(0, 1, 0);

/** The object matrix of a train-local pose (yaw about the car's up) in the parked car `p`. */
function carPose(p: TrainPlacement, lx: number, lz: number, yaw: number, ly = SPEC.floorY): THREE.Matrix4 {
  const w = trainToWorld(p, lx, ly, lz);
  return new THREE.Matrix4().compose(new THREE.Vector3(w.x, w.y, w.z), new THREE.Quaternion().setFromAxisAngle(UP, yaw + p.yaw), new THREE.Vector3(1, 1, 1));
}

/** The first generated movable prop of one of `kinds` (on the floor, nothing on it, drawn): its layout index. */
function pick(w: World, kinds: readonly string[], used: Set<PropPlacement> = new Set()): {p: PropPlacement; i: number} {
  for (const k of kinds) {
    for (let i = 0; i < w.L.props.length; i++) {
      const p = w.L.props[i];
      if (p.kind !== k || p.cargo || used.has(p) || p.h <= 0.02 || !w.ph.dynamicItems.isDynamicProp(p) || !w.pd.index.inst.get(p)?.length) continue;
      used.add(p);
      return {p, i};
    }
  }
  throw new Error(`no movable ${kinds.join('/')} in the layout`);
}

/** "Pushed into the car": the prop goes loose and comes to rest at a train-local pose (the state a shove leaves it in). */
function pushIn(c: Rig, w: World, t: {p: PropPlacement; i: number}, lx: number, lz: number, yaw: number): void {
  expect(w.ph.dynamicItems.adoptLoose(t.p, t.i, placeM(t.p), carPose(c.h.trainPlacement!, lx, lz, yaw))).toBe(true);
}

/**
 * Is the prop drawn: by its own detached meshes in the scene, or by its shared instance(s) at a real matrix (task cargo-overflow: a resting
 * carried prop is handed back to its instances — DynamicItems.handBack — holding no detach slot).
 */
function drawn(w: World, p: PropPlacement): boolean {
  if (w.pd.states.get(p)?.parts?.some(pt => !!pt.mesh.parent)) return true;
  const m = new THREE.Matrix4();
  return (w.pd.index.inst.get(p) ?? []).some(e => { e.mesh.getMatrixAt(e.index, m); return m.determinant() !== 0; });
}

/** Carried props loose in the world now (by identity). */
const carriedLoose = (w: World) => w.ph.dynamicItems.loose().filter(l => l.prop.cargo);
const looseOf = (w: World, p: PropPlacement) => w.ph.dynamicItems.loose().find(l => l.prop === p);

/** Every carried identity exactly once: the live world's carried props (station-owned or the train's), every station lane's `here`, the train's records. */
function census(c: Rig): string[] {
  const ids: string[] = [];
  const w = c.world;
  const p = c.props.parked();
  if (w) for (const l of carriedLoose(w)) if (!(p && c.props.ownsLoose(l, p))) ids.push(l.prop.cargo!);
  for (const [id, m] of c.h.run.lanes) {
    if (w && id === sectionId(w.key)) continue; // (the live station's lane is rewritten by its teardown / flush: its loose props count)
    ids.push(...((m[STATION_PROPS_LANE] as StationPropsJSON | undefined)?.here ?? []).map(r => r.id));
  }
  ids.push(...c.props.props().map(r => r.id));
  ids.sort();
  expect(new Set(ids).size, `duplicate carried prop in ${ids}`).toBe(ids.length);
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------------------

describe('train prop cargo: records and validation', () => {
  const rec = (id: string, extra: Partial<CargoPropJSON> = {}): CargoPropJSON => ({id, kind: 'foldingChair', variant: 1, w: 0.46, d: 0.5, h: 0.82, x: 1, y: SPEC.floorY, z: 0.2, q: [0, 0.38268, 0, 0.92388], ...extra});

  it('cargo v2 carries props (v1 still loads with none); props / station records are shape-checked', () => {
    expect(cargoProblem({v: 1, items: []})).toBeNull();
    expect(cargoProblem({v: 2, items: [], props: [rec('st-01:main#12')]})).toBeNull();
    expect(cargoProblem({v: 1, items: [], props: []})).toMatch(/unexpected train cargo field 'props'/);
    expect(cargoProblem({v: 3, items: []})).toMatch(/version/);
    const bad: [Partial<CargoPropJSON> & Record<string, unknown>, RegExp][] = [
      [{id: 'chair'}, /identity/], [{kind: '1x'}, /kind/], [{variant: -1}, /variant/], [{w: 0}, /size w/], [{h: 99}, /size h/], [{x: 1e3}, /x out of range/],
      [{q: [0, 0, 0, 2]}, /quaternion/], [{q: [0, 0, 0.5, 0.5]}, /unit quaternion/], [{level: 0}, /no storey/], [{hp: 2}, /integrity/], [{riders: []}, /riders/], [{extra: 1} as never, /unexpected/],
      [{riders: [{kind: 'garmentHangingGroup', variant: 0, w: 1, d: 0.3, h: 1, x: 0, y: 1, z: 0, q: [0, 0, 0, 1], bad: 1} as never]}, /rider field/],
    ];
    for (const [m, re] of bad) expect(propsProblem([rec('st-01:main#1', m)], {world: false, max: CARGO.maxProps}), JSON.stringify(m)).toMatch(re);
    expect(propsProblem([rec('st-01:main#1'), rec('st-01:main#1')], {world: false, max: 48})).toMatch(/twice/);
    expect(propsProblem([rec('st-01:main#1')], {world: true, max: 48})).toMatch(/storey/);
    expect(stationPropsProblem({v: 1, gone: [{i: 3, kind: 'bin'}], here: [rec('st-02:main#9', {level: 0, x: 120, z: -40})]})).toBeNull();
    expect(stationPropsProblem({v: 1, gone: [{i: 3, kind: 'bin'}, {i: 3, kind: 'bin'}], here: []})).toMatch(/twice/);
    expect(stationPropsProblem({v: 2, gone: [], here: []})).toMatch(/version/);
  });

  it('save validation: carried props of real kinds, one prop in one place (aboard OR in a station); the Retry snapshot is its own world', () => {
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    hs.run.current = {level: 'subway', section: 'main', station: sid(1)};
    hs.run.memory().visits = 1;
    hs.train.cargo.setProps([rec('st-01:main#12'), rec('st-00:main#4', {kind: 'garmentRail', riders: [{kind: 'garmentHangingGroup', variant: 2, w: 1.2, d: 0.4, h: 1.1, x: 0, y: 0.3, z: 0, q: [0, 0, 0, 1]}]})]);
    hs.run.setLaneStore(STATION_PROPS_LANE, {v: 1, gone: [{i: 12, kind: 'foldingChair'}], here: [rec('st-00:main#7', {kind: 'bin', level: 0, x: 30, z: 8})]}, {level: 'subway', section: 'main', station: sid(1)});
    hs.takeEntry(); // (the snapshot repeats the same identities: its own world)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const base = hs.file('arrival', 1) as any;
    const good = validateSaveFile(structuredClone(base));
    expect(good.ok, good.ok ? '' : (good as {error: string}).error).toBe(true);
    expect(base.run.participants['player-train'].cargo.v).toBe(2);
    const refuse = (mut: (f: typeof base) => void, re: RegExp) => {
      const f = structuredClone(base);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    const props = (f: typeof base) => f.run.participants['player-train'].cargo.props;
    const lane = (f: typeof base) => f.run.memories['st-01:main'].lanes[STATION_PROPS_LANE];
    refuse(f => { props(f)[0].kind = 'notAProp'; }, /not a known prop kind/);
    refuse(f => { props(f)[1].riders[0].kind = 'notAProp'; }, /not a known prop kind/);
    refuse(f => { lane(f).here[0].id = 'st-01:main#12'; }, /two places/); // lying in a station AND aboard
    refuse(f => { props(f)[0].q = [1, 1, 0, 0]; }, /quaternion/);
    refuse(f => { lane(f).gone[0].i = -1; }, /layout index/);
    // v1 cargo (items only): still valid
    const v1 = structuredClone(base);
    v1.run.participants['player-train'].cargo = {v: 1, items: []};
    v1.checksum = checksumOf(v1.run);
    expect(validateSaveFile(v1).ok).toBe(true);
    // a record without a live system keeps exactly what it was given; v1 loads no props
    const bare = new PlayerTrainRecord();
    bare.participant().load(structuredClone(base.run.participants['player-train']));
    expect((bare.participant().save() as {cargo: unknown}).cargo).toEqual(base.run.participants['player-train'].cargo);
    bare.participant().load({...structuredClone(base.run.participants['player-train']), cargo: {v: 1, items: []}});
    expect(bare.cargo.props()).toEqual([]);
  });
});

describe('train prop cargo: ownership, doorways, the ride collision', () => {
  it('a loose prop inside the parked car is the train\'s, one on the platform the station\'s; one in the doorway refuses the departure', () => {
    const c = rig(SUB()), w = enter(c, SUB(), KA), p = c.h.trainPlacement!, I = SPEC.interior;
    const a = pick(w, ['foldingChair', 'plasticStackChair', 'wetFloorSign', 'rollingSuitcase', 'babyStroller']);
    pushIn(c, w, a, (I.x0 + I.x1) / 2, 0.2, 0.4);
    expect(c.props.ownsLoose(looseOf(w, a.p)!)).toBe(true);
    expect(c.props.departBlock()).toBeNull(); // wholly inside: free to leave
    // the platform beside the car (outside the wall line): the station's
    const b = pick(w, ['foldingChair', 'plasticStackChair', 'wetFloorSign', 'rollingSuitcase', 'babyStroller', 'bicycle', 'stepLadder']);
    const out = trainToWorld(p, 0, SPEC.floorY, -(SPEC.width / 2 + 1.4));
    expect(w.ph.dynamicItems.adoptLoose(b.p, b.i, placeM(b.p), new THREE.Matrix4().makeTranslation(out.x, out.y, out.z))).toBe(true);
    expect(c.props.ownsLoose(looseOf(w, b.p)!)).toBe(false);
    expect(c.props.departBlock()).toBeNull();
    // the doorway: its centre just inside the wall line, its far side out on the platform
    const d = pick(w, ['handTruck', 'rollingSuitcase', 'babyStroller', 'foldingChair', 'plasticStackChair', 'wetFloorSign']);
    pushIn(c, w, d, (I.x0 + I.x1) / 2 + 1.5, -(I.halfWidth - 0.05), 0);
    expect(c.props.departBlock()).toBe(PROP_CARGO_TEXT.doorway);
  }, 120000);

  it('the ride\'s car-local collision model keeps every owner\'s riding boxes (fuel carts + props); none left: its own index again', () => {
    const c = rig(SUB());
    enter(c, SUB(), KA);
    const model = c.ride.model, own = model.props;
    const col = (x: number) => ({kind: 'column' as PropKind, x: x + RIDE_FRAME.ox, z: RIDE_FRAME.oz, y: -1, rot: 0, area: -1, hx: 0.3, hz: 0.3, h: 3, blocksSight: false, variant: 0, level: 0});
    setRideCargoBoxes(model, 'fuel-carts', [col(-3)]);
    setRideCargoBoxes(model, 'cargo-props', [col(2)]);
    const xs = () => model.props.props.filter(q => q.area === -1 && q.hx === 0.3).map(q => fromStep(q.x, q.z)[0]).sort();
    expect(xs()).toEqual([-3, 2]);
    setRideCargoBoxes(model, 'fuel-carts', null); // the carts' release never drops the props' boxes
    expect(xs()).toEqual([2]);
    setRideCargoBoxes(model, 'cargo-props', null);
    expect(model.props).toBe(own);
  }, 60000);
});

describe('train prop cargo: a whole journey, unload, revisit, return', () => {
  it('Subway -> Office: props ride the car (moving with it), arrive loose at their exact poses with their look; unloaded / revisited / returned once each', async () => {
    const A = SUB(), c = rig(A), {h, ride, rt, props} = c;
    let w = enter(c, A, KA);
    const I = SPEC.interior, used = new Set<PropPlacement>();
    // three classes: a spill holder (container), a p7 model kind, another family (the camp lantern's procedural accent / any other)
    const bin = pick(w, ['bin', 'wheelieBin'], used);
    const p7 = pick(w, ['rollingSuitcase', 'babyStroller', 'foldingChair', 'handTruck', 'plasticStackChair', 'wetFloorSign', 'pedestalFan', 'stepLadder'], used);
    const other = pick(w, [...new Set(A.props.map(q => q.kind))].filter(k => dynamicKind(k) && k !== bin.p.kind && k !== p7.p.kind), used);
    const lots0 = w.cm.holderFor(bin.p)!.state.lots.length;
    const h0 = new Map([bin, p7, other].map(t => [t.p, t.p.h] as const));
    const pk0 = c.pickups.list.length;
    pushIn(c, w, bin, I.x0 + 1.2, 0.35, 0.3);
    pushIn(c, w, p7, (I.x0 + I.x1) / 2, -0.3, -0.8);
    pushIn(c, w, other, I.x1 - 1.4, 0.25, Math.PI / 2 + 0.2);
    // the spill holder spilled its finite lots where it stood (pickups of the station), once; it travels open and empty
    expect(c.pickups.list.length).toBe(pk0 + lots0);
    expect(w.cm.holderFor(bin.p)!.state.lots).toEqual([]);
    const src = [bin, p7, other].map(t => ({kind: t.p.kind, variant: t.p.variant, id: `${sectionId(KA)}#${t.i}`, h0: h0.get(t.p)!,
      local: (() => { const l = looseOf(w, t.p)!; const v = new THREE.Vector3(), q = new THREE.Quaternion(); l.matrix.decompose(v, q, new THREE.Vector3()); return {l: worldToTrain(h.trainPlacement!, v.x, v.y, v.z), q: q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, -h.trainPlacement!.yaw))}; })()}));
    frame(h);
    expect(props.props().map(r => r.id).sort()).toEqual(src.map(s => s.id).sort());
    census(c);
    // depart: the doors close -> withdrawn from the station, riding copies on the car's view root
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    expect(props.riding.map(r => r.rec.id).sort()).toEqual(src.map(s => s.id).sort());
    for (const t of [bin, p7, other]) {
      expect(looseOf(w, t.p)).toBeUndefined(); // no body in the station
      expect(t.p.h).toBe(0); // no collision
      expect(t.p.cargoGone).toBe(true);
    }
    const view = rt.view!;
    for (const r of props.riding) {
      expect(r.obj?.parent).toBe(view.root);
      // its copy moves WITH the car: the copy's pivot in car frame is the record's train-local pose
      const e = r.obj!.children[0];
      e.updateWorldMatrix(true, true);
      expect(r.obj!.children.length).toBeGreaterThan(0);
      const at = carToWorld(ride.pose, r.rec.x, r.rec.y, r.rec.z, {x: 0, y: 0, z: 0});
      const box = new THREE.Box3().setFromObject(r.obj!);
      expect(box.distanceToPoint(new THREE.Vector3(at.x, at.y + 0.05, at.z))).toBeLessThan(0.75);
    }
    // the ride collision: their footprints in the car-local model
    expect(ride.model.props.props.filter(q => q.area === -1 && q.kind === 'column' && q.h > 1 && q.y === -1).length).toBeGreaterThanOrEqual(3);
    // the old world goes: its lane remembers the three generated props lost to the train
    leave(c);
    expect(c.h.run.station(KA).gone.map(g => g.i).sort((a, b) => a - b)).toEqual([bin.i, p7.i, other.i].sort((a, b) => a - b));
    expect(props.riding.length).toBe(3);
    const mid = props.props();
    expect(cargoProblem({v: 2, items: [], props: mid})).toBeNull();
    for (const s of src) {
      const r = mid.find(x => x.id === s.id)!;
      expect([r.kind, r.variant, r.h]).toEqual([s.kind, s.variant, +s.h0.toFixed(5)]);
      expect(Math.hypot(r.x - s.local.l.x, r.y - s.local.l.y, r.z - s.local.l.z)).toBeLessThan(1e-4);
    }
    run(h, 2);
    // the next station is built while riding: the train's props appended, hidden until the stop
    const B = OFF();
    w = enter(c, B, KB);
    expect(props.qa().appended.filter(a => a.owner === 'train').length).toBe(3);
    for (const a of B.props.filter(q => q.cargo && !q.cargo.includes('/'))) expect(looseOf(w, a)).toBeUndefined();
    expect(props.riding.every(r => !!r.obj)).toBe(true);
    let arr: {status: string} | null = null;
    void ride.arrive().then(r => { arr = r; });
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    expect(arr).toMatchObject({status: 'stopped'});
    run(h, 0.1);
    // stopped: loose in the NEW parked car at trainToWorld(new placement, local), the same look, the bin empty and loose
    const p2 = h.trainPlacement!;
    expect(props.riding).toEqual([]);
    expect(ride.model.props.props.some(q => q.area === -1 && q.y === -1 && q.kind === 'column' && q.h > 1 && q.hx < 0.02)).toBe(false);
    for (const s of src) {
      const prop = B.props.find(q => q.cargo === s.id)!;
      expect(prop, s.id).toBeTruthy();
      expect([prop.kind, prop.variant]).toEqual([s.kind, s.variant]);
      const l = looseOf(w, prop)!;
      expect(l, `${s.id} loose`).toBeTruthy();
      const v = new THREE.Vector3(), q = new THREE.Quaternion();
      l.matrix.decompose(v, q, new THREE.Vector3());
      const want = trainToWorld(p2, s.local.l.x, s.local.l.y, s.local.l.z);
      expect(v.distanceTo(new THREE.Vector3(want.x, want.y, want.z))).toBeLessThan(1e-3);
      expect(q.angleTo(s.local.q.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(UP, p2.yaw)))).toBeLessThan(1e-3);
      expect(props.ownsLoose(l)).toBe(true);
      expect(drawn(w, prop)).toBe(true); // drawn (its own meshes in the scene, or — resting — its shared instance again)
    }
    const binHere = B.props.find(q => q.cargo === src[0].id)!;
    expect(w.cm.holderFor(binHere)!.state.lots).toEqual([]); // no invented loot
    expect(w.cm.holderFor(binHere)!.open?.loose).toBe(true);
    census(c);
    // UNLOAD: push the suitcase-class prop out of the car onto the platform (the destination's from now on)
    const p7Here = B.props.find(q => q.cargo === src[1].id)!;
    const outW = trainToWorld(p2, 0, SPEC.floorY, -(SPEC.width / 2 + 1.5));
    const drawnAt = looseOf(w, p7Here)!.matrix.clone();
    expect(w.ph.dynamicItems.withdraw(p7Here)).toBeTruthy(); // (a shove's end state: the body re-made where it is drawn, then moved out)
    p7Here.h = w.ph.dynamicItems.restHeight(p7Here);
    expect(w.ph.dynamicItems.adoptLoose(p7Here, B.props.indexOf(p7Here), drawnAt, new THREE.Matrix4().makeTranslation(outW.x, outW.y, outW.z))).toBe(true);
    expect(props.ownsLoose(looseOf(w, p7Here)!)).toBe(false);
    expect(props.props().map(r => r.id).sort()).toEqual([src[0].id, src[2].id].sort());
    census(c);
    leave(c); // Retry / Load / leaving: the train's in the car -> pending; the platform's -> the Office's `here`
    expect(c.h.run.station(KB).here.map(r => r.id)).toEqual([src[1].id]);
    expect(c.h.run.station(KB).gone).toEqual([]); // (nothing generated in the Office was lost)
    expect(props.pending.map(r => r.id).sort()).toEqual([src[0].id, src[2].id].sort());
    census(c);
    // REVISIT the Office: the unloaded prop where it was left, the train's in the car — each once
    const B2 = OFF();
    w = enter(c, B2, KB);
    expect(B2.props.filter(q => q.cargo === src[1].id).length).toBe(1);
    const back = looseOf(w, B2.props.find(q => q.cargo === src[1].id)!)!;
    expect(new THREE.Vector3().setFromMatrixPosition(back.matrix).distanceTo(new THREE.Vector3(outW.x, outW.y, outW.z))).toBeLessThan(1e-3);
    expect(B2.props.filter(q => q.cargo === src[0].id || q.cargo === src[2].id).length).toBe(2);
    expect(props.pending).toEqual([]);
    census(c);
    leave(c);
    // RETURN to the Subway: its generated originals stay hidden (never respawned), the carried two lie in the car, the suitcase is not there
    const A2 = SUB();
    w = enter(c, A2, KA);
    for (const t of [bin, p7, other]) {
      const q = A2.props[t.i];
      expect(q.kind).toBe(t.p.kind);
      expect(q.cargoGone).toBe(true);
      expect(q.h).toBe(0);
      const e = w.pd.index.inst.get(q) ?? [];
      for (const en of e) { const m = new THREE.Matrix4(); en.mesh.getMatrixAt(en.index, m); expect(m.determinant()).toBe(0); } // drawn nowhere
    }
    expect(w.cm.holderFor(A2.props[bin.i])!.state.lots).toEqual([]); // the lost holder: no loot respawned in it
    expect(A2.props.filter(q => q.cargo).map(q => q.cargo).sort()).toEqual([src[0].id, src[2].id].sort());
    expect(census(c)).toEqual(src.map(s => s.id).sort());
  }, 240000);
});

describe('train prop cargo: the Office\'s furniture rides to the Subway', () => {
  it('an office chair-class prop and the office\'s archive boxes (a spill holder) ride Office -> Subway and arrive loose, drawn, empty', async () => {
    const B = OFF(), c = rig(B, KB), {h, ride, props} = c;
    let w = enter(c, B, KB);
    const I = SPEC.interior, used = new Set<PropPlacement>();
    const chair = pick(w, ['officeChair', 'executiveChair', 'loungeArmchair', 'beanBag', 'giantTeddy', 'pottedPlantSmall', 'ottoman'], used);
    const box = pick(w, ['archiveBoxes', 'storageTote', 'cardboardBoxFlaps', 'bin', 'wheelieBin'], used);
    pushIn(c, w, chair, I.x0 + 1.5, 0.2, 2.4);
    pushIn(c, w, box, I.x1 - 1.6, -0.3, 0.1);
    expect(w.cm.holderFor(box.p)!.state.lots).toEqual([]); // spilled where it stood
    const ids = [chair, box].map(t => `${sectionId(KB)}#${t.i}`).sort();
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(props.riding.map(r => r.rec.id).sort()).toEqual(ids);
    expect(props.riding.every(r => (r.obj?.children.length ?? 0) > 0)).toBe(true);
    leave(c);
    expect(c.h.run.station(KB).gone.map(g => g.i).sort((a, b) => a - b)).toEqual([chair.i, box.i].sort((a, b) => a - b));
    const A = SUB();
    w = enter(c, A, KA);
    void ride.arrive();
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    run(h, 0.1);
    for (const [t, id] of [[chair, `${sectionId(KB)}#${chair.i}`], [box, `${sectionId(KB)}#${box.i}`]] as const) {
      const q = A.props.find(x => x.cargo === id)!;
      expect([q.kind, q.variant]).toEqual([t.p.kind, t.p.variant]);
      expect(looseOf(w, q), `${q.kind} loose in the Subway's car`).toBeTruthy();
      expect(props.ownsLoose(looseOf(w, q)!)).toBe(true);
      expect(drawn(w, q)).toBe(true);
    }
    const holder = w.cm.holderFor(A.props.find(x => x.cargo === `${sectionId(KB)}#${box.i}`)!)!;
    expect(holder.state.lots).toEqual([]);
    expect(census(c)).toEqual(ids);
  }, 180000);
});

describe('train prop cargo: saves, refused and failed-back departures', () => {
  it('Continue: the participant\'s props load into the next parked car exactly once (idempotent); New Game clears them', () => {
    const c = rig(SUB());
    let w = enter(c, SUB(), KA);
    const I = SPEC.interior;
    const a = pick(w, ['rollingSuitcase', 'foldingChair', 'babyStroller', 'plasticStackChair', 'wetFloorSign']);
    pushIn(c, w, a, I.x0 + 2, 0.1, 1.0);
    const rec = c.h.playerTrain.participant().save() as {cargo: {v: 2; props: CargoPropJSON[]}};
    expect(rec.cargo.v).toBe(2);
    expect(rec.cargo.props.map(r => r.id)).toEqual([`${sectionId(KA)}#${a.i}`]);
    leave(c);
    // a fresh game: Continue loads the record, then builds the station
    const d = rig(SUB());
    d.h.playerTrain.participant().load(structuredClone(rec));
    d.h.playerTrain.participant().load(structuredClone(rec)); // (twice: still once)
    expect(d.props.pending.length).toBe(1);
    w = enter(d, SUB(), KB);
    expect(w.L.props.filter(q => q.cargo === rec.cargo.props[0].id).length).toBe(1);
    expect(looseOf(w, w.L.props.find(q => q.cargo)!)).toBeTruthy();
    expect((d.h.playerTrain.participant().save() as {cargo: {props: CargoPropJSON[]}}).cargo.props.map(r => r.id)).toEqual([rec.cargo.props[0].id]);
    d.h.playerTrain.participant().reset(); // New Game
    expect(d.props.props()).toEqual([]);
  }, 120000);

  it('a departure reset while the doors close: the same props are back where they lay (shown again, loose), nothing duplicated', async () => {
    const c = rig(SUB()), {h, ride, props} = c;
    const w = enter(c, SUB(), KA);
    const I = SPEC.interior;
    const a = pick(w, ['rollingSuitcase', 'foldingChair', 'babyStroller', 'plasticStackChair', 'wetFloorSign']);
    pushIn(c, w, a, I.x0 + 2.5, -0.2, 0.6);
    const before = looseOf(w, a.p)!.matrix.clone();
    void ride.depart();
    frame(h);
    expect(props.riding.length).toBe(1);
    expect(looseOf(w, a.p)).toBeUndefined();
    ride.reset();
    await Promise.resolve();
    run(h, 0.1);
    expect(props.riding).toEqual([]);
    const l = looseOf(w, a.p)!;
    expect(l).toBeTruthy();
    const d = new THREE.Vector3().setFromMatrixPosition(l.matrix).distanceTo(new THREE.Vector3().setFromMatrixPosition(before));
    expect(d).toBeLessThan(1e-3);
    expect(drawn(w, a.p)).toBe(true);
    expect(w.L.props.filter(q => q.cargo).length).toBe(0); // (no copy appended: the original itself)
    expect(props.props().map(r => r.id)).toEqual([`${sectionId(KA)}#${a.i}`]);
    leave(c); // the teardown: in the parked car -> the train's (pending), the station lost it
    expect(c.h.run.station(KA).gone.map(g => g.i)).toEqual([a.i]);
    expect(props.pending.length).toBe(1);
  }, 120000);

  it('a journey that fails back to its station: rebuilt while riding, the props arrive in the same station\'s car once, the originals hidden', async () => {
    const c = rig(SUB()), {h, ride} = c;
    let w = enter(c, SUB(), KA);
    const I = SPEC.interior;
    const a = pick(w, ['rollingSuitcase', 'foldingChair', 'babyStroller', 'plasticStackChair', 'wetFloorSign']);
    pushIn(c, w, a, I.x0 + 1.8, 0.3, 0);
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    leave(c);
    ride.transitFailed('test: the destination cannot be prepared');
    const A2 = SUB();
    w = enter(c, A2, KA); // (the journey brings the train back)
    expect(A2.props[a.i].cargoGone).toBe(true);
    void ride.arrive();
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    run(h, 0.1);
    const copies = A2.props.filter(q => q.cargo === `${sectionId(KA)}#${a.i}`);
    expect(copies.length).toBe(1);
    expect(looseOf(w, copies[0])).toBeTruthy();
    expect(A2.props[a.i].h).toBe(0);
    expect(census(c)).toEqual([`${sectionId(KA)}#${a.i}`]);
  }, 180000);
});

describe('train prop cargo: the look across levels, riders, containers, resources', () => {
  it('mall / Skyways kinds and a garment rail with its riders arrive in the SUBWAY\'s car drawn, loose, the rail\'s garments riding it', () => {
    const c = rig(SUB());
    const rider = {kind: 'garmentHangingGroup', variant: 1, w: 1.0, d: 0.45, h: 1.0, x: 0, y: 0.35, z: 0, q: [0, 0, 0, 1] as [number, number, number, number]};
    const R = (id: string, kind: string, x: number, extra: Partial<CargoPropJSON> = {}): CargoPropJSON => {
      const def = (PROP_DEFS as unknown as Record<string, {w: number; d: number; h: number}>)[kind];
      return {id, kind, variant: 0, w: def.w, d: def.d, h: def.h, x, y: SPEC.floorY, z: 0, q: [0, 0, 0, 1], ...extra};
    };
    c.props.restoreProps([R('st-05:main#30', 'cafeChair', -3), R('st-05:main#31', 'garmentRail', 0, {riders: [rider]}), R('st-07:main#12', 'skyMuBinRecords', 3)]);
    const L = SUB(), w = enter(c, L, KA);
    const app = L.props.filter(q => q.cargo);
    expect(app.map(q => q.kind).sort()).toEqual(['cafeChair', 'garmentHangingGroup', 'garmentRail', 'skyMuBinRecords']);
    const rail = app.find(q => q.kind === 'garmentRail')!, garments = app.find(q => q.kind === 'garmentHangingGroup')!;
    expect(garments.host).toBe(L.props.indexOf(rail)); // the rider hangs on its rail
    for (const q of app.filter(x => x.kind !== 'garmentHangingGroup')) {
      expect(w.pd.index.inst.get(q)?.length ?? 0, `${q.kind} drawn`).toBeGreaterThan(0);
      expect(looseOf(w, q), `${q.kind} loose`).toBeTruthy();
    }
    // the rail went loose WITH its garments (one entity): their collider gone, the record keeps them as riders
    expect(looseOf(w, rail)!.riders.map(r => r.prop)).toEqual([garments]);
    expect(garments.h).toBe(0);
    const recs = c.props.props();
    expect(recs.find(r => r.id === 'st-05:main#31')!.riders?.map(r => r.kind)).toEqual(['garmentHangingGroup']);
    expect(recs.length).toBe(3);
    // their models are let through the level rule for this layout (the Subway): the mall chair's key, which the Subway alone refuses
    const keysOf = (l: StationLayout) => [...p7ModelKeysFor(l), ...officeModelKeysFor(l)];
    const carried = carriedModelKeys(keysOf, L, app);
    const cat = Object.fromEntries(carried.map(k => [k, {url: `assets/models/${k.startsWith('office-') ? 'mall-cafe-chair' : k}.glb`, bytes: 1}]));
    expect(carried.length).toBeGreaterThan(0);
    expect(selectLevelKeys('subway', carried, cat).foreign.length).toBeGreaterThan(0); // (refused by the level rule alone)
  }, 120000);

  it('carried holder copies are empty (no invented loot), the fuel slots never see them; level resources keep what the section asked for', async () => {
    const c = rig(SUB());
    c.props.restoreProps([{id: 'st-03:main#40', kind: 'wheelieBin', variant: 0, w: PROP_DEFS.wheelieBin.w, d: PROP_DEFS.wheelieBin.d, h: PROP_DEFS.wheelieBin.h, x: -1, y: SPEC.floorY, z: 0, q: [0, 0, 0, 1]}]);
    const L = SUB(), w = enter(c, L, KA);
    const bin = L.props.find(q => q.cargo)!;
    const holder = w.cm.holderFor(bin)!;
    expect(holder.state.lots).toEqual([]);
    expect(holder.open?.loose).toBe(true);
    expect(w.cm.all.some(hh => hh !== holder && hh.state.lots.length > 0)).toBe(true); // (generated holders keep their loot)
    // level resources: a section's own requests survive the level change (a Skyways poster in the Subway's train); others are released
    const lr = new LevelResources(async () => new THREE.Texture());
    const kept = 'assets/textures/skyways/con-posters.png', other = 'assets/textures/skyways/other.png';
    await lr.load('skyways', kept, {srgb: true, repeat: false});
    await lr.load('skyways', other, {srgb: true, repeat: false});
    lr.beginSection(); // the Subway prepares: it asks for the poster only
    await lr.load('skyways', kept, {srgb: true, repeat: false});
    lr.retainOnly('subway');
    expect(lr.get('skyways', kept)).toBeTruthy();
    expect(lr.get('skyways', other)).toBeUndefined();
    lr.beginSection(); // the next section asks for nothing of it: released
    lr.retainOnly('subway');
    expect(lr.get('skyways', kept)).toBeUndefined();
  }, 120000);
});

describe('train prop cargo: the REAL Game methods on a minimal shell', () => {
  it('prepareSection runs the layout hooks before the model keys: a carried mall chair\'s model is fetched for the Subway (the level rule alone refuses it)', async () => {
    const {Game} = await import('../src/game');
    const L = SUB(), fetched: string[][] = [], begun: number[] = [];
    const chair: PropPlacement = {kind: 'cafeChair', x: 1, z: 1, y: 0, rot: 0, area: 0, hx: 0.25, hz: 0.25, h: 0.85, blocksSight: false, variant: 0, cargo: 'st-05:main#30'};
    const catalogue = {'office-cafe-chair': {url: 'assets/models/mall-cafe-chair.glb', bytes: 1}};
    const shell = {
      lifecycleCounts: {prepare: 0}, propModels: {sealed: true, catalogue, ensure: async (k: string[]) => { fetched.push(k); }, get: () => undefined},
      levelResources: {sealed: true, beginSection: () => { begun.push(1); }}, generateSection: () => L,
      sectionLayoutHooks: [(l: StationLayout, _k: SectionKey, _r: unknown, phase: string) => { expect(phase).toBe('prepare'); l.props.push(chair); }],
      sectionModelKeys: [officeModelKeysFor], sectionPreloads: [],
    };
    Object.setPrototypeOf(shell, Game.prototype);
    const out = await (shell as unknown as {prepareSection(k: SectionKey, r: unknown): Promise<StationLayout>}).prepareSection(KA, {});
    expect(out).toBe(L);
    expect(begun).toEqual([1]);
    expect(fetched[0]).toContain('office-cafe-chair');
    expect(selectLevelKeys('subway', ['office-cafe-chair'], catalogue).foreign).toEqual(['office-cafe-chair']);
    // the same key asked for by a GENERATED placement stays refused (another level's art is never fetched for its own sake)
    const gen = {...chair, cargo: undefined};
    L.props.splice(L.props.indexOf(chair), 1, gen);
    expect((shell as unknown as {modelKeysFor(l: StationLayout, lv: string): string[]}).modelKeysFor(L, 'subway')).not.toContain('office-cafe-chair');
  });

  it('commitEndingSave flushes the station\'s carried / lost props with its memory, before the commit; fuelCheck refuses a prop in a doorway', async () => {
    const {Game} = await import('../src/game');
    const order: string[] = [];
    const shell = {
      run: {campaign: {cheat: false}}, world: {}, saveSectionMemory: () => order.push('memory'), gear: {flush: () => order.push('bags')}, fuelStations: {flush: () => order.push('fuel')},
      trainPropCargo: {flush: () => order.push('props'), departBlock: () => PROP_CARGO_TEXT.doorway}, commitSave: (r: string) => { order.push(`commit:${r}`); return {ok: true}; },
      hud: {toast: (t: string) => order.push(`toast:${t}`)}, sfx: {denied: () => order.push('denied')},
    };
    Object.setPrototypeOf(shell, Game.prototype);
    const g = shell as unknown as {commitEndingSave(): unknown; fuelCheck(h: number): {ok: boolean; error?: string}};
    expect(g.commitEndingSave()).toEqual({ok: true});
    expect(order).toEqual(['memory', 'bags', 'fuel', 'props', 'commit:ending']);
    order.length = 0;
    expect(g.fuelCheck(1)).toEqual({ok: false, error: PROP_CARGO_TEXT.doorway});
    expect(order).toEqual([`toast:${PROP_CARGO_TEXT.doorway}`, 'denied']);
  });

  it('decodeSave hands the save\'s train props to the prop cargo before anything is installed (their models are prepared with the station)', async () => {
    const {Game} = await import('../src/game');
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    hs.run.current = {level: 'subway', section: 'main', station: sid(1)};
    hs.run.memory().visits = 1;
    const rec: CargoPropJSON = {id: 'st-00:main#9', kind: 'skyMuBinRecords', variant: 0, w: 0.6, d: 0.4, h: 0.5, x: 0, y: SPEC.floorY, z: 0, q: [0, 0, 0, 1]};
    hs.train.cargo.setProps([rec]);
    const noted: {run: object; props: CargoPropJSON[]}[] = [];
    const props = new TrainPropCargo({} as never);
    const shell = {
      saveValidate: {}, trainPropCargo: {notePrepared: (run: object, parts: Record<string, unknown>) => { props.notePrepared(run, parts); noted.push({run, props: ((parts['player-train'] as {cargo: {props: CargoPropJSON[]}}).cargo.props)}); }},
    };
    Object.setPrototypeOf(shell, Game.prototype);
    const d = (shell as unknown as {decodeSave(f: unknown): {ok: boolean; restore?: {run: object}; error?: string}}).decodeSave(hs.file('arrival', 1));
    expect(d.ok, d.error).toBe(true);
    expect(noted.length).toBe(1);
    expect(noted[0].run).toBe(d.restore!.run);
    expect(noted[0].props).toEqual([rec]);
  });

  it('buildSection runs the build-phase layout hooks before it reads the layout (model keys, the p7 drop, the world)', async () => {
    const {Game} = await import('../src/game');
    const body = (Game.prototype as unknown as {buildSectionSteps: () => void}).buildSectionSteps.toString(); // (lane BUILD: buildSection drains these steps)
    const hook = body.search(/sectionLayoutHooks[\s\S]{0,160}['"]build['"]/), keys = body.indexOf('modelKeysFor'), drop = body.indexOf('dropUnloadedP7'), world = body.indexOf('buildWorld');
    expect(hook).toBeGreaterThan(0);
    expect(hook).toBeLessThan(Math.min(keys, drop, world));
  });
});

describe('train prop cargo: generic for every movable kind (present and future), no cargo whitelist', () => {
  // the movable kinds come from the game's own registry + movable trait at run time: a kind added later is in this list automatically
  const MOVABLE = (Object.keys(PROP_DEFS) as PropKind[]).filter(k => dynamicKind(k)).sort();

  it('the cargo modules name no prop kind (one generic path keyed on the movable trait; nothing per kind)', async () => {
    const fs = await import('node:fs');
    const kinds = new Set(Object.keys(PROP_DEFS));
    for (const f of ['src/world/trainPropCargo.ts', 'src/run/trainCargo.ts']) {
      const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const named = [...src.matchAll(/['"`]([A-Za-z][A-Za-z0-9]*)['"`]/g)].map(m => m[1]).filter(s => kinds.has(s));
      expect(named.filter(k => k !== 'column'), f).toEqual([]); // (the ride collision's own footprint boxes are 'column' boxes, like the fuel carts')
    }
    expect(MOVABLE.length).toBeGreaterThanOrEqual(118);
  });

  it('EVERY movable kind (each family) arrives in the Subway\'s car from a record: drawn, loose, recorded back exactly', () => {
    const fails: string[] = [];
    const rec = (k: PropKind, i: number, n: number): CargoPropJSON => {
      const d = PROP_DEFS[k], I = SPEC.interior, lx = I.x0 + 0.6 + ((I.x1 - I.x0 - 1.2) * i) / Math.max(1, n - 1);
      // (a kind taller than the car's interior can only have been pushed in lying on its side: tipped over along the car's length)
      const tall = d.h > SPEC.ceilingY - SPEC.floorY - 0.2, q = tall ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2) : new THREE.Quaternion();
      return {id: `st-09:main#${1000 + MOVABLE.indexOf(k)}`, kind: k, variant: 0, w: Math.min(d.w, CARGO.size), d: Math.min(d.d, CARGO.size), h: Math.min(Math.max(d.h, 0.05), CARGO.size),
        x: lx, y: SPEC.floorY + (tall ? d.w / 2 : 0), z: tall ? 0 : (i % 3 - 1) * 0.5, q: [+q.x.toFixed(5), +q.y.toFixed(5), +q.z.toFixed(5), +q.w.toFixed(5)]};
    };
    // (two arrivals: at most CARGO.maxProps aboard at once)
    for (const batch of [MOVABLE.filter((_, i) => i % 2 === 0), MOVABLE.filter((_, i) => i % 2 === 1)]) {
      const c = rig(SUB());
      const recs = batch.map((k, i) => rec(k, i, batch.length));
      expect(propsProblem(recs, {world: false, max: CARGO.maxProps})).toBeNull();
      c.props.restoreProps(recs);
      const L = SUB(), w = enter(c, L, KA);
      for (const r of recs) {
        const q = L.props.find(x => x.cargo === r.id);
        if (!q) { fails.push(`${r.kind}: not appended`); continue; }
        if (!(w.pd.index.inst.get(q)?.length || w.pd.states.get(q)?.parts?.length)) fails.push(`${r.kind}: not drawn`);
        const l = looseOf(w, q);
        if (!l) { fails.push(`${r.kind}: not loose`); continue; }
        const back = c.props.recordOf(l, r.id, c.h.trainPlacement!);
        if (back.kind !== r.kind || Math.abs(back.x - r.x) > 1e-3 || Math.abs(back.z - r.z) > 1e-3) fails.push(`${r.kind}: record changed`);
      }
      const all = c.props.props();
      expect(new Set(all.map(r => r.id)).size).toBe(recs.length);
    }
    expect(fails).toEqual([]);
  }, 240000);
});

// Task studio-beta-train-cargo-overflow-20261107-210410-01: everything aboard travels exactly once, or the departure is refused BEFORE
// anything moves (Game.fuelCheck: before the fuel draw, the carts' capture, the doors and any capture). Beyond the damage system's
// detach cap (96) too: a withdrawn prop holds no render slot.
describe('train cargo overflow: all aboard travels, or the train does not leave', () => {
  /** n records of one small kind on a 3-D grid inside the car (train-local). */
  function grid(kind: PropKind, n: number, tag: number): CargoPropJSON[] {
    const I = SPEC.interior, d = PROP_DEFS[kind], out: CargoPropJSON[] = [];
    const step = 0.3, xs: number[] = [], zs: number[] = [];
    for (let x = I.x0 + 0.25; x < I.x1 - 0.25; x += step) xs.push(+x.toFixed(4));
    for (let z = -I.halfWidth + 0.25; z < I.halfWidth - 0.25; z += step) zs.push(+z.toFixed(4));
    for (let i = 0; out.length < n; i++) {
      const layer = Math.floor(i / (xs.length * zs.length)), k = i % (xs.length * zs.length);
      out.push({id: `st-${tag}:main#${i}`, kind, variant: i % 3, w: d.w, d: d.d, h: d.h, x: xs[k % xs.length], y: SPEC.floorY + layer * 0.5, z: zs[Math.floor(k / xs.length)], q: [0, 0, 0, 1]});
    }
    return out;
  }

  /** The REAL Game.fuelCheck on a shell with these cargo systems (the fuel tank as the witness that nothing was drawn). */
  async function fuelCheck(c: Rig) {
    const {Game} = await import('../src/game');
    const toasts: string[] = [];
    const shell = {run: {campaign: {cheat: false}}, trainPropCargo: c.props, trainCargo: c.items, hud: {toast: (t: string) => toasts.push(t)}, sfx: {denied: () => toasts.push('denied')},
      playerTrain: c.h.playerTrain};
    Object.setPrototypeOf(shell, Game.prototype);
    return {r: (shell as unknown as {fuelCheck(h: number): {ok: boolean; error?: string}}).fuelCheck(1), toasts};
  }

  it('257 props aboard (beyond the 96-slot detach cap): refused before anything moves; one pushed out -> all 256 ride and all 256 arrive', async () => {
    const c = rig(SUB()), {h, ride, props} = c;
    const recs = grid('campLantern', CARGO.maxProps + 1, 77);
    props.restoreProps(recs);
    let w = enter(c, SUB(), KA);
    const inCar = w.L.props.filter(q => q.cargo);
    expect(inCar.length).toBe(257);
    expect(inCar.filter(q => looseOf(w, q) && props.ownsLoose(looseOf(w, q)!)).length).toBe(257); // all loose, all the train's
    h.playerTrain.fuel.tank = 4; // (a full tank: one hop's fuel — the refusal below is the cargo's, not the fuel's)
    const tank0 = h.playerTrain.fuel.tank;
    // the refusal: through the real Game.fuelCheck, BEFORE the draw / the carts / the doors — nothing touched
    const {r, toasts} = await fuelCheck(c);
    expect(r).toEqual({ok: false, error: PROP_CARGO_TEXT.overloaded(257)});
    expect(toasts).toEqual([PROP_CARGO_TEXT.overloaded(257), 'denied']);
    expect(h.playerTrain.fuel.tank).toEqual(tank0);
    expect(props.riding).toEqual([]);
    expect(inCar.every(q => !!looseOf(w, q))).toBe(true);
    // one pushed out onto the platform: 256 = the bound -> free to leave
    const out = inCar[0], at = looseOf(w, out)!.matrix.clone(), p0 = h.trainPlacement!;
    const ow = trainToWorld(p0, 0, SPEC.floorY, -(SPEC.width / 2 + 1.5));
    expect(w.ph.dynamicItems.withdraw(out)).toBeTruthy();
    out.h = w.ph.dynamicItems.restHeight(out);
    expect(w.ph.dynamicItems.adoptLoose(out, w.L.props.indexOf(out), at, new THREE.Matrix4().makeTranslation(ow.x, ow.y, ow.z))).toBe(true);
    expect(props.departBlock()).toBeNull();
    expect((await fuelCheck(c)).r.ok).toBe(true);
    expect(h.playerTrain.fuel.tank).toBe(tank0); // (fuelCheck plans the draw; travelToStation applies it after the check)
    // the ride: EVERY one of the 256 is captured (each withdrawal hands its render slot back: no 96 limit), none left in the station's car spot
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(props.riding.length).toBe(256);
    expect(props.riding.every(x => (x.obj?.children.length ?? 0) > 0)).toBe(true);
    expect(inCar.slice(1).every(q => !looseOf(w, q))).toBe(true);
    expect(looseOf(w, out)).toBeTruthy(); // the platform's stays the station's
    expect(w.pd.detachedCount).toBeLessThan(96);
    leave(c);
    expect(cargoProblem({v: 2, items: [], props: props.props()})).toBeNull();
    expect(props.props().length).toBe(256);
    // they all arrive: appended hidden while riding, loose in the new car after the stop
    const B = OFF();
    w = enter(c, B, KB);
    void ride.arrive();
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    run(h, 0.1);
    const arrived = B.props.filter(q => q.cargo);
    expect(arrived.length).toBe(256);
    expect(arrived.filter(q => looseOf(w, q) && props.ownsLoose(looseOf(w, q)!)).length).toBe(256);
    expect(props.riding).toEqual([]);
  }, 300000);

  it('a prop carrying more riders than a record holds refuses the departure (never cut to fit)', () => {
    const c = rig(SUB());
    const d = PROP_DEFS.garmentRail;
    const riders = Array.from({length: CARGO.maxRiders + 1}, (_, k) => ({kind: 'garmentHangingGroup', variant: k % 3, w: 0.3, d: 0.3, h: 1, x: -0.6 + k * 0.035, y: 0.4, z: 0, q: [0, 0, 0, 1] as [number, number, number, number]}));
    c.props.restoreProps([{id: 'st-41:main#3', kind: 'garmentRail', variant: 0, w: d.w, d: d.d, h: d.h, x: 0, y: SPEC.floorY, z: 0, q: [0, 0, 0, 1], riders}]);
    const w = enter(c, SUB(), KA);
    const rail = w.L.props.find(q => q.kind === 'garmentRail' && q.cargo)!;
    expect(looseOf(w, rail)!.riders.length).toBe(CARGO.maxRiders + 1);
    expect(c.props.departBlock()).toBe(PROP_CARGO_TEXT.overhung);
    expect(c.props.props()[0].riders!.length).toBe(CARGO.maxRiders + 1); // (the record is never cut: such a save is refused as invalid)
  }, 120000);

  it('257 loose items aboard: refused before anything moves; at 256 all ride, and a riding drop onto the full floor stays in the inventory', async () => {
    const c = rig(SUB()), {h, ride, items, pickups, inv} = c;
    enter(c, SUB(), KA);
    const p = h.trainPlacement!, I = SPEC.interior;
    const put = (i: number) => {
      const st = inv.makeStack('water', 1);
      const lx = I.x0 + 0.3 + (i % 48) * 0.3, lz = -I.halfWidth + 0.3 + Math.floor(i / 48) * 0.3;
      const wpos = trainToWorld(p, lx, SPEC.floorY, lz);
      return pickups.add(st, wpos.x, wpos.y, wpos.z, p.yaw);
    };
    const all = Array.from({length: CARGO.maxItems + 1}, (_, i) => put(i));
    expect(items.aboardCount()).toBe(257);
    const {r} = await fuelCheck(c);
    expect(r).toEqual({ok: false, error: CARGO_TEXT.overloaded(257)});
    expect(items.riding).toEqual([]);
    expect(pickups.list.length).toBe(257);
    pickups.remove(all[0]); // (picked up)
    expect(items.departBlock()).toBeNull();
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(items.riding.length).toBe(256);
    // the floor is full: a riding drop is refused (the REAL Game.dropRef puts it back), nothing lost, its own message
    const {Game} = await import('../src/game');
    const st = inv.makeStack('medkit', 2);
    st.count = 2;
    inv.add(st);
    const toasts: string[] = [];
    const shell = {inv, use: null, hud: {toast: (t: string) => { toasts.push(t); }}, sfx: {denied: () => toasts.push('denied')}, syncHeld: () => {}, cancelUse: () => {},
      trainRide: {riding: true, refuseDrop: () => { toasts.push('ride-refused'); return true; }}, trainCargo: items};
    Object.setPrototypeOf(shell, Game.prototype);
    (shell as unknown as {dropRef(ref: unknown): void}).dropRef(inv.find(st.uid)!);
    expect(inv.count('medkit')).toBe(2);
    expect(items.riding.length).toBe(256);
    expect(toasts).toEqual(['denied']); // (not the ride's "use the Lockbox" note: the cargo said why, on the game's HUD)
    expect(h.toasts.at(-1)).toBe(CARGO_TEXT.floorFull);
  }, 180000);
});
