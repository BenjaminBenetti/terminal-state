// Task studio-refinement-batch-20261113-035659-01 (lane MELT): the Node host for the acid melt tests (world/acidMelt.ts) — no browser /
// renderer. A generated station with the REAL built world (buildWorld, stand-in models for EVERY model kind — not only the movable ones:
// the melt hides furniture / containers / machines too), PhysicsSystem / DynamicItems, PropDamage, ContainerManager (the game's spill
// rule), PickupManager, the player train runtime + ride, the fuel carts, the train equipment (helpers/trainEquipmentHost.ts: a real
// RunState + Inventory), the item + prop cargo and the melt itself, installed and built in Game's order (installs: carts, train, ride,
// equipment, cargo, prop cargo, melt; buildSection: the layout hooks, the world, holders, physics, damage, the section hooks).
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {StationLayout} from '../../src/gen/stationTypes';
import type {PropPlacement} from '../../src/gen/props';
import {isP7Kind, p7ModelKey} from '../../src/gen/props07';
import {isOfficeKind, officeKindAsset, officeModelKey} from '../../src/gen/office/kinds';
import {levelsOf} from '../../src/gen/levels';
import {PropIndex} from '../../src/core/physics';
import {playerTrainPlacement, trainSpawnPose} from '../../src/gen/playerTrain';
import {PickupManager} from '../../src/world/pickups';
import {TrainCargoSystem} from '../../src/world/trainCargo';
import {TrainPropCargo} from '../../src/world/trainPropCargo';
import {PhysicsSystem} from '../../src/physics/world';
import {PropDamage} from '../../src/damage/propDamage';
import {buildWorld} from '../../src/world/builder';
import {WorldMaterials} from '../../src/world/materials';
import {ContainerManager} from '../../src/world/containers';
import {lootProfile} from '../../src/items/lootTables';
import type {SectionKey} from '../../src/levels/types';
import {AcidMelt, type AcidMeltHost} from '../../src/world/acidMelt';
import {fakeEnvTextures} from './openablesFixture';
import {equipStation, type EquipOptions, type EquipTestHost} from './trainEquipmentHost';

/** world/builder.ts MODEL_FOR (module-private): the base station kinds drawn from the core model library (+ the turnstile for gates). */
const BASE_MODELS: Record<string, string> = {bench: 'bench', cabinetTall: 'cabinetTall', cabinetLow: 'cabinetLow', stall: 'stall', vending: 'vending', shelf: 'shelf', bin: 'trashCan', fareGate: 'turnstile'};

/** A two-box stand-in model for every model kind of the layout (a body and a back panel: what the shared prop render instances). */
export function allStandIns(layout: {props: readonly PropPlacement[]}): Record<string, GLTF> {
  const lib: Record<string, GLTF> = {};
  const tex = new THREE.Texture();
  for (const k of new Set(layout.props.map(p => p.kind))) {
    const key = BASE_MODELS[k] ?? (isP7Kind(k) ? p7ModelKey(k) : isOfficeKind(k) && officeKindAsset(k) ? officeModelKey(officeKindAsset(k)!) : null);
    if (!key || lib[key]) continue;
    const scene = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshStandardMaterial({name: `${k}-body`, map: tex}));
    a.position.y = 0.25;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), new THREE.MeshStandardMaterial({name: `${k}-back`, color: 0x223344}));
    b.position.set(0, 0.75, -0.25);
    scene.add(a, b);
    scene.updateMatrixWorld(true);
    lib[key] = {scene} as unknown as GLTF;
  }
  return lib;
}

let mats: WorldMaterials | null = null;
export interface MeltWorld { L: StationLayout; key: SectionKey; group: THREE.Group; cm: ContainerManager; ph: PhysicsSystem; pd: PropDamage }
export type MeltHost = EquipTestHost & {
  pickups: PickupManager; acidMelt: AcidMelt | null; physics: PhysicsSystem; damage: {props: PropDamage}; containers: ContainerManager | null;
  sectionLayoutHooks: ((l: StationLayout, k: SectionKey, r: unknown, p: 'prepare' | 'build') => void)[];
};

/** Everything installed (Game's order), no world yet. */
export function meltStation(first: StationLayout, o: EquipOptions = {}) {
  const s = equipStation(first, {...o, build: false});
  const h = s.h as unknown as MeltHost;
  const pickups = new PickupManager({});
  h.scene.add(pickups.group);
  Object.assign(h, {pickups, syncHeld: () => {}, sectionLayoutHooks: [], containers: null, damage: {props: new PropDamage()}, acidMelt: null});
  const items = new TrainCargoSystem(h as never).install();
  const props = new TrainPropCargo(h as never).install();
  const melt = new AcidMelt(h as unknown as AcidMeltHost).install();
  return {...s, h, pickups, items, props, melt, world: null as MeltWorld | null};
}
export type MeltRig = ReturnType<typeof meltStation>;

/** Game.prepareSection + buildSection (train-all-cargo.test.ts's order); the player at the train spawn. */
export function enterStation(c: MeltRig, L: StationLayout, key: SectionKey = c.h.run.current): MeltWorld {
  const h = c.h;
  for (const f of h.sectionLayoutHooks) f(L, key, h.run, 'prepare');
  for (const f of h.sectionLayoutHooks) f(L, key, h.run, 'build');
  mats ??= new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const built = buildWorld(L, mats, allStandIns(L));
  h.scene.add(built.group);
  const cm = new ContainerManager({}, mats, () => h.inv);
  cm.onEvent = e => {
    if (e.type !== 'spill') return;
    for (const sp of e.spilled ?? []) { const st = h.inv.makeStack(sp.lot.itemId, sp.lot.count); st.count = sp.lot.count; c.pickups.addAt(st, sp.matrix, {holder: e.container.serial, lot: sp.lot.id}); }
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

/** Game.leaveSection: the section hooks' teardowns (the melt's first), then the world goes. */
export function leaveStation(c: MeltRig): void {
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

/** Frames of the melt + physics + pickups (dt each). */
export function step(c: MeltRig, seconds: number, dt = 1 / 30): void {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    c.world?.ph.update(dt);
    c.melt.tick(dt);
  }
}

/** The pickups now, as {id, itemId, count, uid, x, y, z, fromLot}. */
export const pickupsOf = (c: MeltRig) => c.pickups.list.map(p => ({id: p.id, itemId: p.stack.itemId, count: p.stack.count, uid: p.stack.uid, mag: p.stack.mag,
  x: p.obj.position.x, y: p.obj.position.y, z: p.obj.position.z, fromLot: p.fromLot, stack: p.stack}));
