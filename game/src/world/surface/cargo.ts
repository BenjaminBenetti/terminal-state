// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): BULKY CARGO IN A SURFACE RUN DISTRICT — the train units (chests,
// devices, upgrade kits) the player finds, secures to the truck and carries across the station <-> district crossing. User: "Give the
// truck finite, usable storage compartments and secure physical attachment points for bulky salvage/upgrade cargo. Preserve each item's
// identity, contents, condition and pose, truck state and sole cargo ownership through transfer, travel, save and re-entry."
//
// Everything physical is the train equipment's own mechanism (world/trainEquipment.ts: one unit = one LiveUnit, one record, one place);
// this file only wires the district to it, through the Game's registries (inert outside a Surface Run layout):
//  - DEPOT RECOVERABLES (world/surface/cargoSeed.ts): at the district's FIRST build, before the equipment's build reads the lane, the
//    depot's recoverables become ordinary records in the district's 'train-equipment.here' lane (fresh run uids, a chest's contents from
//    the loot-table foundation) and lane 'surface.cargo' gets `seeded: 1` IN THE SAME STEP: never refilled, never seeded twice (save,
//    reload, Retry, re-entry all read the marker). [Follow-up lane FIXES: a depot seeded from now on gets ONE train upgrade of them
//    (cargoSeed.ts seedDepot); one seeded before keeps all it got.]
//  - THE TRUCK'S ATTACHMENT POINTS (world/surface/cargoTypes.ts — lane TRUCK's truckAttachPoints()): TrainEquipmentSystem.mounts, a
//    provider that offers the points only while a district world is built, refuses while the truck moves / the player sits in it, and
//    keeps the secured units in lane 'surface.cargo' (`secured`) of the district section: the units go with the truck's memory.
//  - THE UPGRADE KIT (world/surface/cargoKit.ts): the [E] use of every upgrade-kit kind — fitted through Game.trainUpgrades once it
//    stands in the parked car; used up only on a successful install.
//  - THE CROSSING (world/surface/crossing.ts participant 'cargo'): refuse / depart / arrive / abort delegate to the equipment system.
//  - MODELS: a district has no train placement, so the units' models (Lockbox, modules, the kit's plate) and the hand truck are fetched
//    for `layout.surface` here (Game.sectionModelKeys / sectionPreloads).

import type {Game} from '../../game';
import type {StationLayout} from '../../gen/stationTypes';
import type {SurfaceInfo} from '../../gen/surface/surfaceTypes';
import {EQUIPMENT, EQUIPMENT_KINDS, EQUIPMENT_LIMITS, STATION_EQUIPMENT_LANE, equipmentSeqOf, stationEquipmentOf, type StationEquipmentJSON} from '../../craft/equipment';
import type {ItemStack} from '../../items/inventory';
import type {SectionKey} from '../../levels/types';
import type {TrainUpgradesApi} from '../../run/trainUpgrades';
import {loadCartModels} from '../fuelCartModel';
import type {EquipmentMountPoint, EquipmentMounts, MountedJSON, TrainEquipmentSystem} from '../trainEquipment';
import {equipmentModelKey} from '../trainEquipmentModel';
import {surfaceCrossers, type SurfaceCrosser} from './crossing';
import {kitUse} from './cargoKit';
import {seedDepot} from './cargoSeed';
import {SURFACE_CARGO_LANE, SURFACE_CARGO_LIMITS, surfaceCargoOf, surfaceCargoRecord} from './cargoStore';
import {truckCargoSource, type TruckAttachPoint} from './cargoTypes';

/** Tuning. */
export const CARGO = {
  /** Above this truck speed (m/s) nothing is secured / taken off. */
  still: 0.3,
  /** The hand truck's model is waited for this long behind the loading screen (ms). */
  modelWaitMs: 8000,
} as const;

export const CARGO_TEXT = {
  label: 'the truck',
  moving: 'not while the truck is moving',
  seated: 'not from the truck seat',
} as const;

const POINT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

/** What this needs from Game (structural: tests drive it with a small host). */
export interface SurfaceCargoHost {
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  sectionModelKeys?: ((layout: never) => readonly string[])[];
  sectionPreloads?: ((layout: never) => Promise<void>)[];
  trainEquipment?: TrainEquipmentSystem | null;
  trainUpgrades?: (TrainUpgradesApi & {lastRefusal?: string | null}) | null;
  run?: {current: SectionKey; laneStore(lane: string, key?: SectionKey): unknown; setLaneStore(lane: string, data: unknown, key?: SectionKey): void} | null;
  inv?: {makeStack?(itemId: string, count: number): ItemStack} | null;
  playerTrain: {equipment: {nextUid(): string}};
  hud: {toast(text: string, warn?: boolean): void};
  sfx?: unknown;
  skywaysCar?: {driving?: boolean; worldLive?: boolean; body?: {v: number} | null} | null;
}

const bySeq = (a: {uid: string}, b: {uid: string}) => equipmentSeqOf(a.uid) - equipmentSeqOf(b.uid);

/** A truck attachment point as an equipment mount point (null: an id the cargo record cannot name). */
export function mountPointOf(p: TruckAttachPoint): EquipmentMountPoint | null {
  if (typeof p.id !== 'string' || p.id.length > SURFACE_CARGO_LIMITS.pointChars || !POINT_ID.test(p.id)) return null;
  const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {id: p.id, x: n(p.x), y: n(p.y), z: n(p.z), yaw: n(p.yaw), level: Math.max(0, Math.floor(n(p.level))), pitch: n(p.pitch), roll: n(p.roll),
    w: Math.max(0, n(p.size?.w)), d: Math.max(0, n(p.size?.d)), h: Math.max(0, n(p.size?.h)), blocked: !!p.occupied};
}

export class SurfaceCargo {
  /** A district world is built (between this lane's build and teardown hooks). */
  live = false;
  /** QA / tests. */
  readonly counts = {seeded: 0, seededUnits: 0, builds: 0};
  private attached: TrainEquipmentSystem | null = null;

  /** The crossing participant (world/surface/crossing.ts). */
  readonly crosser: SurfaceCrosser = {
    name: 'cargo',
    refuse: (_from, to) => this.eq()?.crossRefuse(to) ?? null,
    depart: (from, to) => this.eq()?.crossDepart(from, to),
    arrive: to => this.eq()?.crossArrive(to),
    abort: from => this.eq()?.crossAbort(from),
  };

  /** The truck's attachment points as an equipment mount provider (TrainEquipmentSystem.mounts). */
  readonly mounts: EquipmentMounts = {
    label: CARGO_TEXT.label,
    points: () => this.points(),
    block: () => this.block(),
    load: key => surfaceCargoOf(this.host.run?.laneStore(SURFACE_CARGO_LANE, key as SectionKey)).secured ?? [],
    store: (key, list) => this.storeSecured(key as SectionKey, list),
  };

  constructor(readonly host: SurfaceCargoHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: ((layout: StationLayout) => this.onBuild(layout)) as (layout: never) => void, teardown: () => this.onTeardown()});
    // a district has no train placement: the units' models and the hand truck are fetched for it here
    h.sectionModelKeys?.push(((layout: StationLayout) => (layout.surface ? cargoModelKeys() : [])) as (layout: never) => readonly string[]);
    h.sectionPreloads?.push(((layout: StationLayout) => (layout.surface
      ? Promise.race([loadCartModels().then(() => undefined), new Promise<void>(r => setTimeout(r, CARGO.modelWaitMs))])
      : Promise.resolve())) as (layout: never) => Promise<void>);
    surfaceCrossers(h).push(this.crosser);
    return this;
  }

  private eq(): TrainEquipmentSystem | null { return this.host.trainEquipment ?? null; }

  /** The equipment system exists after this lane's install (Game order): the provider and the kit's use are attached on first sight. */
  private attach(): TrainEquipmentSystem | null {
    const eq = this.eq();
    if (!eq || this.attached === eq) return eq;
    this.attached = eq;
    if (!eq.mounts) eq.mounts = this.mounts;
    const use = kitUse({
      equipment: () => this.eq(),
      upgrades: () => this.host.trainUpgrades ?? null,
      toast: (t, w) => this.host.hud.toast(t, w),
      denied: () => (this.host.sfx as {denied?(): void} | null)?.denied?.(),
    });
    for (const k of EQUIPMENT_KINDS) if (EQUIPMENT[k].upgrade && !eq.uses[k]) eq.uses[k] = use;
    return eq;
  }

  /** Runs BEFORE the equipment's build (install order): the depot is seeded into the lane that build reads. */
  private onBuild(layout: StationLayout): void {
    this.attach();
    this.live = !!layout.surface;
    if (!layout.surface) return;
    this.counts.builds++;
    this.seed(layout.surface);
  }

  private onTeardown(): void {
    // (the equipment's own teardown — after this one — stores the secured units through the provider: it needs no live points)
    this.live = false;
  }

  /**
   * The depot into the district's equipment lane, once (the marker in the same step). Task studio-surface-run-field-followup-20261116-
   * 211729-01 (lane FIXES): a depot seeded NOW (marker absent, any district version) gets exactly ONE of its recoverables — the train
   * upgrade cargoSeed.ts depotPick chooses on the district seed — with exactly one uid from the train's counter, and the record lists it
   * (version 2 `depot`); a depot already seeded (the marker: under either rule) is never touched — its saved units stay as they are.
   */
  seed(S: SurfaceInfo): number {
    const run = this.host.run, inv = this.host.inv;
    if (!run || !inv?.makeStack) return 0;
    const rec = surfaceCargoOf(run.laneStore(SURFACE_CARGO_LANE));
    if (rec.seeded) return 0;
    const here = stationEquipmentOf(run.laneStore(STATION_EQUIPMENT_LANE));
    const E = this.host.playerTrain.equipment;
    const {units: add, depot} = seedDepot(S.depot?.recoverables ?? [], {seed: S.seed, nextUid: () => E.nextUid(), makeStack: (id, n) => inv.makeStack!(id, n)},
      Math.max(0, EQUIPMENT_LIMITS.station - here.length));
    if (add.length) run.setLaneStore(STATION_EQUIPMENT_LANE, {v: 1, here: [...here, ...add].sort(bySeq)} satisfies StationEquipmentJSON);
    run.setLaneStore(SURFACE_CARGO_LANE, surfaceCargoRecord(true, rec.secured ?? [], depot));
    this.counts.seeded++;
    this.counts.seededUnits += add.length;
    return add.length;
  }

  /** The truck's points now (only while a district world is built; at most the record's bound). */
  points(): EquipmentMountPoint[] {
    if (!this.live) return [];
    const src = truckCargoSource(this.host);
    if (!src) return [];
    const out: EquipmentMountPoint[] = [];
    for (const p of src.truckAttachPoints() ?? []) {
      if (out.length >= SURFACE_CARGO_LIMITS.secured) break;
      const m = mountPointOf(p);
      if (m && !out.some(o => o.id === m.id)) out.push(m);
    }
    return out;
  }

  /** Why nothing may be secured / taken off now (the truck's own rule when it gives one; else moving / the seat). */
  block(): string | null {
    const src = truckCargoSource(this.host);
    if (src?.cargoBlock) return src.cargoBlock();
    const car = this.host.skywaysCar;
    if (car?.driving) return CARGO_TEXT.seated;
    if (car?.body && Math.abs(car.body.v) > CARGO.still) return CARGO_TEXT.moving;
    return null;
  }

  /** The secured units of section `key` (the equipment's teardown / flush): the seeded marker is kept as it was. */
  private storeSecured(key: SectionKey, list: readonly MountedJSON[]): void {
    const run = this.host.run;
    if (!run) return;
    const rec = surfaceCargoOf(run.laneStore(SURFACE_CARGO_LANE, key));
    run.setLaneStore(SURFACE_CARGO_LANE, surfaceCargoRecord(rec.seeded === 1, list, rec.depot), key); // (lane FIXES: + the seeded depot list)
  }
}

/** Every equipment kind's model key (the Lockbox, the modules, the kits' plate), once each. */
export function cargoModelKeys(): string[] {
  const out = new Set<string>();
  for (const k of EQUIPMENT_KINDS) { const key = equipmentModelKey(EQUIPMENT[k]); if (key) out.add(key); }
  return [...out];
}

/** Installs the district cargo (world/surface/install.ts; registries only, inert outside a Surface Run layout). */
export function installSurfaceCargo(game: Game): SurfaceCargo {
  return new SurfaceCargo(game as unknown as SurfaceCargoHost).install();
}
