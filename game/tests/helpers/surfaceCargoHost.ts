// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): Node hosts for the district cargo tests — the flat equipment room
// (helpers/trainEquipmentHost.ts equipRoom: the REAL TrainEquipmentSystem, fuel carts, Player, RunState, Inventory) with the district
// cargo (world/surface/cargo.ts SurfaceCargo) installed in Game's order (its section hook BEFORE the equipment's), a fake truck behind
// the truck seam (world/surface/cargoTypes.ts setTruckCargoSource) and section switches by hand: the station ('main') and its district
// ('surface') are both the flat room here — what matters is which section's lanes the systems read and write.
import type {SurfaceInfo, SurfaceRecoverable} from '../../src/gen/surface/surfaceTypes';
import type {SectionKey} from '../../src/levels/types';
import type {EquipmentJSON} from '../../src/craft/equipment';
import {SurfaceCargo} from '../../src/world/surface/cargo';
import {setTruckCargoSource, type TruckAttachPoint, type TruckCargoSource} from '../../src/world/surface/cargoTypes';
import {flatRoom, frame, teardown} from './fuelCartsHost';
import {equipRoom, stand, type EquipTestHost} from './trainEquipmentHost';

export const STATION: SectionKey = {level: 'subway', section: 'main'};
export const DISTRICT: SectionKey = {level: 'subway', section: 'surface'};

/** A district record with only what the cargo reads (the depot, the seed). */
export function fakeSurface(recoverables: SurfaceRecoverable[] = [], seed = 77): SurfaceInfo {
  return {seed, depot: {building: 0, recoverables}} as unknown as SurfaceInfo;
}

/** A truck with bed points at its pose (local offsets: x right, z forward = -Z of its frame). */
export class FakeTruck implements TruckCargoSource {
  readonly label = 'the truck';
  /** Parked across the room's east half, its forward +X: the bed points at x 3.9 (z 2.52 / 3.48) and x 5.0 (z 3.0), 0.9 m up. */
  x = 4.4; y = 0.9; z = 3.0; yaw = -Math.PI / 2;
  block: string | null = null;
  occupied = new Set<string>();
  /** Not placed yet (a build before the truck's pose is known): no points. */
  hidden = false;
  calls = 0;
  /** Point id -> local offset (x across, z along the truck's forward) + its space. */
  readonly local: {id: string; lx: number; lz: number; w: number; d: number; h: number}[] = [
    {id: 'bed-0', lx: -0.48, lz: -0.5, w: 0.9, d: 0.9, h: 1.4},
    {id: 'bed-1', lx: 0.48, lz: -0.5, w: 0.9, d: 0.9, h: 1.4},
    {id: 'bed-small', lx: 0, lz: 0.6, w: 0.5, d: 0.5, h: 0.6},
  ];

  truckAttachPoints(): readonly TruckAttachPoint[] {
    this.calls++;
    if (this.hidden) return [];
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // the truck's forward is (-sin yaw, -cos yaw); its right is (cos yaw, -sin yaw)
    return this.local.map(p => ({
      id: p.id, x: this.x + p.lx * c - p.lz * s, y: this.y, z: this.z - p.lx * s - p.lz * c, yaw: this.yaw, level: 0,
      size: {w: p.w, d: p.d, h: p.h}, occupied: this.occupied.has(p.id),
    }));
  }

  cargoBlock(): string | null { return this.block; }

  point(id: string): TruckAttachPoint { return this.truckAttachPoints().find(p => p.id === id)!; }
}

/**
 * The flat room as a Surface Run district: built first as the station (equipRoom's own build), the cargo installed (its hook moved in
 * front of the equipment's: Game order), the fake truck registered, then torn down and entered as the district — the cargo seeds the
 * depot (`recoverables`) into the lane the equipment's build reads. `here`: the district's equipment lane before the entry.
 */
export function districtRoom(o: {recoverables?: SurfaceRecoverable[]; here?: EquipmentJSON[]; truck?: boolean; seed?: number; cargo?: unknown} = {}) {
  const s = equipRoom(flatRoom());
  const {h, eq} = s;
  const cargo = new SurfaceCargo(h as never).install();
  // (in front of the equipment's hook — the last one equipRoom installed before ours)
  const hook = h.sectionHooks.pop()!;
  h.sectionHooks.splice(h.sectionHooks.length - 1, 0, hook);
  (h as unknown as {trainEquipment: unknown}).trainEquipment = eq;
  const truck = new FakeTruck();
  if (o.truck !== false) setTruckCargoSource(h, truck);
  const S = fakeSurface(o.recoverables ?? [], o.seed);
  stand(h, 1.5, 3.2, -Math.PI / 2, 0); // (west of the room, facing +X: toward the truck's bed)
  teardown(h);
  if (o.here) h.run.setLaneStore('train-equipment.here', {v: 1, here: o.here}, DISTRICT);
  // (task studio-surface-run-field-followup-20261116-211729-01, lane FIXES: the district's cargo record before the entry — a depot seeded
  // earlier, e.g. under the whole-collection rule)
  if (o.cargo !== undefined) h.run.setLaneStore('surface.cargo', o.cargo, DISTRICT);
  const w = {...s, cargo, truck, S, hook, enter: (key: SectionKey, surface: boolean) => enter(w.h, key, surface ? S : null, hook)};
  w.enter(DISTRICT, true);
  return w;
}
export type District = ReturnType<typeof districtRoom>;

/** Game.buildSection's hook pass for section `key` (the cargo's hook gets a layout with `surface` in a district, the rest none). */
export function enter(h: EquipTestHost, key: SectionKey, S: SurfaceInfo | null, cargoHook: {build?(l: never): void}): void {
  h.run.current = {...key};
  for (const x of h.sectionHooks) x.build?.((x === cargoHook ? {surface: S ?? undefined} : undefined) as never);
}

/** Leave the current section (every teardown hook) and enter `key`. */
export function cross(w: District, key: SectionKey, surface: boolean): void {
  teardown(w.h);
  w.enter(key, surface);
  frame(w.h);
}

/** Every uid of the run's records: the train's, every lane of both sections (a live world written first: TrainEquipmentSystem.flush). */
export function recordUids(w: District): string[] {
  w.eq.flush();
  const out: string[] = [];
  for (const r of w.h.playerTrain.equipment.records()) out.push(r.uid);
  for (const k of [STATION, DISTRICT]) {
    const lane = w.h.run.laneStore<{here: EquipmentJSON[]}>('train-equipment.here', k);
    for (const r of lane?.here ?? []) out.push(r.uid);
    const cargo = w.h.run.laneStore<{secured?: {unit: EquipmentJSON}[]}>('surface.cargo', k);
    for (const m of cargo?.secured ?? []) out.push(m.unit.uid);
  }
  return out.sort();
}
