// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): Node hosts for the train equipment tests (no browser / renderer) —
// the fuel cart hosts (helpers/fuelCartsHost.ts: a generated station with the REAL PlayerTrainRuntime + TrainRide + Player + the fuel
// carts, installed in Game's order; the flat room) plus what the equipment needs of Game: a real RunState (the station lane), a real
// Inventory (the uid counter), the input (E held / released), the hold ring, and the system itself installed AFTER the train and the
// ride (Game's order).
import * as THREE from 'three';
import type {StationLayout} from '../../src/gen/stationTypes';
import type {Levels} from '../../src/gen/levels';
import {trainToWorld, worldToTrain, type TrainPlacement} from '../../src/gen/playerTrain';
import {Inventory} from '../../src/items/inventory';
import {createRun, type RunState} from '../../src/run/runState';
import type {PlayerTrainRecord} from '../../src/run/playerTrain';
import {EQUIPMENT, STATION_EQUIPMENT_LANE, freshEquipment, type EquipmentJSON, type EquipmentKind} from '../../src/craft/equipment';
import {equipmentPlugs} from '../../src/craft/trainFixtures';
import {PLAYER_TRAIN_SPEC as SPEC} from '../../src/world/playerTrainSpec';
import type {FuelCarts} from '../../src/world/fuelCarts';
import type {PlayerTrainRuntime} from '../../src/world/playerTrain';
import type {TrainRide} from '../../src/world/trainRide';
import {TrainEquipmentSystem, type LiveUnit, type TrainEquipmentDeps, type TrainEquipmentHost} from '../../src/world/trainEquipment';
import {Keys, build, flatRoom, holdE as holdKeyE, roomHost, stationHost, type CartTestHost} from './fuelCartsHost';
import {LEVELS_STUB, SEEDS} from './saveFixture';

export type EquipTestHost = CartTestHost & {
  run: RunState; inv: Inventory; input: Keys; fuelCarts: FuelCarts; trainEquipment: TrainEquipmentSystem;
  rings: (number | null)[]; cancels: string[]; layout?: StationLayout | null;
  trainRuntime: PlayerTrainRuntime | null; trainRide: TrainRide | null;
  hud: {toast(t: string, warn?: boolean): void; setHoldRing(v: number | null): void};
};

export interface EquipOptions {
  build?: boolean; record?: PlayerTrainRecord; run?: RunState; inv?: Inventory; deps?: TrainEquipmentDeps;
  /** The station's lane before the first build (the units left lying there). */
  here?: EquipmentJSON[];
}

function dress(h: CartTestHost, carts: FuelCarts, o: EquipOptions): {h: EquipTestHost; eq: TrainEquipmentSystem} {
  const e = h as unknown as EquipTestHost;
  if (o.record) (e as unknown as {playerTrain: PlayerTrainRecord}).playerTrain = o.record;
  e.run = o.run ?? createRun({seeds: SEEDS, start: {level: 'subway', section: 'main'}, levels: LEVELS_STUB, campaign: null});
  e.inv = o.inv ?? new Inventory();
  if (o.here) e.run.setLaneStore(STATION_EQUIPMENT_LANE, {v: 1, here: o.here});
  e.input = e.keys;
  e.fuelCarts = carts;
  e.rings = [];
  e.cancels = [];
  e.hud.setHoldRing = (v: number | null) => { e.rings.push(v); };
  const sfx = e.sfx as Record<string, unknown>;
  sfx.pickup = () => { e.sfxCalls.push('pickup'); };
  sfx.impact = (_x: number, _y: number, _z: number, s: string) => { e.sfxCalls.push(`impact:${s}`); };
  sfx.bodyFall = () => { e.sfxCalls.push('thud'); };
  const eq = new TrainEquipmentSystem(e as unknown as TrainEquipmentHost, {cancelUse: r => { e.cancels.push(r); }, ...o.deps}).install();
  e.trainEquipment = eq;
  return {h: e, eq};
}

/** A generated station with the real train + ride + fuel carts and the equipment system (Game's install order). */
export function equipStation(L: StationLayout, o: EquipOptions = {}) {
  const s = stationHost(L, {build: false});
  const {h, eq} = dress(s.h, s.carts, o);
  if (o.build !== false) buildWorld(h, L);
  return {h, eq, carts: s.carts, rt: s.rt, ride: s.ride};
}

/** The flat room (no train runtime; `placement`: a fake parked car over the floor) with the fuel carts and the equipment system. */
export function equipRoom(levels: Levels = flatRoom(), placement: TrainPlacement | null = null, o: EquipOptions = {}) {
  const s = roomHost(levels, placement);
  const {h, eq} = dress(s.h, s.carts, o);
  // (roomHost already ran the fuel carts' build hook: run the equipment's own)
  h.sectionHooks[h.sectionHooks.length - 1].build?.(undefined as never);
  return {h, eq, carts: s.carts};
}

/** Game.buildSection's tail (helpers/fuelCartsHost.ts build): the level fields, every section hook, the player at the train spawn. */
export const buildWorld = build;

/** A fake parked car over the flat room (its floor = the room floor), front +1 (yaw 0) or -1 (yaw PI). */
export function fakePlacement(front: 1 | -1 = 1, x = 5.25, z = 3.5): TrainPlacement {
  return {
    level: 0, x, z, yaw: front > 0 ? 0 : Math.PI, front, railTopY: -SPEC.floorY, floorY: 0, trackZ: z, trenchIndex: 0, trackIndex: 0,
    platformArea: 0, platformEdgeZ: z - 2 * front, platformSide: (-front) as 1 | -1, x0: x - SPEC.length / 2, x1: x + SPEC.length / 2, length: SPEC.length, width: SPEC.width,
  };
}

/** An aboard record of `kind` at a train-local pose (fresh: empty, no rounds). */
export function aboardRec(kind: EquipmentKind, n: number, x: number, z: number, yaw = 0, extra: Partial<EquipmentJSON> = {}): EquipmentJSON {
  return {...freshEquipment(kind, `eq-${n}`, {x, y: SPEC.floorY, z, yaw}), ...extra};
}

/** A station record of `kind` at a world pose. */
export function stationRec(kind: EquipmentKind, n: number, x: number, y: number, z: number, yaw = 0, level = 0, extra: Partial<EquipmentJSON> = {}): EquipmentJSON {
  return {...freshEquipment(kind, `eq-${n}`, {x, y, z, yaw}), level, ...extra};
}

/** Put the train's units into the system exactly as a load does (TrainEquipment.load: validated, the counter above every unit). */
export function loadAboard(h: EquipTestHost, recs: EquipmentJSON[]): void {
  const seq = Math.max(h.playerTrain.equipment.seq, ...recs.map(r => Number(r.uid.slice(3))));
  h.playerTrain.equipment.load({v: 1, seq, aboard: recs});
}

/** A station unit on the platform at train-local (lx, lz) (the station's lane first, then a rebuild-free spawn through the lane). */
export function platformWorld(h: EquipTestHost, lx: number, lz: number): {x: number; y: number; z: number} {
  const p = h.trainPlacement!, w = trainToWorld(p, lx, SPEC.floorY, lz);
  return {x: w.x, y: h.levels!.floorAt(w.x, w.z, p.floorY + 0.3), z: w.z};
}

/** A train-local spot at rest in reach of plug `index` (out from its wall, toward the aisle). */
export function plugSpot(index: number, out = 0.75): {x: number; z: number} {
  const e = equipmentPlugs(SPEC)[index];
  return {x: e.x, z: e.z - e.side * out};
}

/** Put a live world unit at rest at a train-local spot of the parked car's floor (a test's hand: its plug state is looked at again). */
export function putLocal(h: EquipTestHost, u: LiveUnit, lx: number, lz: number, localYaw = 0): void {
  const p = h.trainPlacement!, w = trainToWorld(p, lx, SPEC.floorY, lz), b = u.body;
  b.x = w.x; b.y = p.floorY; b.z = w.z; b.level = p.level; b.vx = b.vz = 0; b.yaw = localYaw + p.yaw;
  u.awake = false;
  u.plugCheck = true;
}

/** A unit's train-local footprint centre now. */
export function localOf(h: EquipTestHost, u: LiveUnit): {x: number; y: number; z: number} {
  return u.mode === 'cargo' ? {...u.local} : worldToTrain(h.trainPlacement!, u.body.x, u.body.y, u.body.z);
}

/** Look at a point of a unit given in its own frame (x right, y up, z front). */
export function lookAtUnit(h: EquipTestHost, u: LiveUnit, lx: number, ly: number, lz: number): void {
  const b = u.body, s = Math.sin(b.yaw), c = Math.cos(b.yaw);
  const x = b.x + lx * c + lz * s, y = b.y + ly, z = b.z - lx * s + lz * c;
  const P = h.player, dx = x - P.x, dy = y - P.eye, dz = z - P.z;
  P.yaw = Math.atan2(-dx, -dz);
  P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  h.camera.position.set(P.x, P.eye, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  h.camera.updateMatrixWorld(true);
}

/** Stand the player at a world point facing a yaw (on the floor there). */
export function stand(h: EquipTestHost, x: number, z: number, yaw = 0, y?: number): void {
  h.player.place(x, z, yaw, y ?? h.levels!.floorAt(x, z, (h.trainPlacement?.floorY ?? 0) + 0.3));
  h.player.vx = h.player.vz = 0;
}

/**
 * E pressed and HELD for `seconds` (then released): helpers/fuelCartsHost.ts holdE — the default surely starts the drag / the carry of
 * the unit under the crosshair; a short time is a tap that acts on the release.
 */
export const holdE: (h: EquipTestHost, seconds?: number, dt?: number) => void = holdKeyE;

export const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const kinds = (): EquipmentKind[] => Object.keys(EQUIPMENT) as EquipmentKind[];
