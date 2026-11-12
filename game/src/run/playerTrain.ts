// Task player-train-shell-20261101-202805 (lane PLACE): the ONE persistent identity of the player's home train across a run.
//
// The train is the player's future moving base; today it is a level-one car parked at each level's start platform
// (gen/playerTrain.ts playerTrainPlacement), built by lane TRAIN. Whatever level the player is in, it is the SAME train: one record
// per Game, registered as the RunParticipant 'player-train' (Game.wireRunLanes) so NewGame gives a fresh level-one train, Retry
// restores the record as it was at level entry and Travel carries it unchanged (only `at`, where it is parked, follows the level).
// It owns no player inventory, health, survival, injuries or ammo: spawning in the train refills nothing. Later movement / upgrades extend
// this record. Pure (no three.js / DOM).
//
// Task train-lockbox-windows-20261101-232156 (lane BOX): the record also holds the train's LOCKBOX (run/trainLockbox.ts, LOCKBOX_SLOTS): saved
// with the record (`lockbox` in the participant data; an old save without it loads an empty box), emptied by NewGame, kept by Travel.
// `state` stays the train identity only.
//
// Task studio-beta-train-fuel-system-20261106-024923-01: the record also holds the train's FUEL (TrainFuel: the tank in quarter units and
// the fuel CARTS aboard — physical cargo, train-local poses; fuel/fuel.ts). Saved with the record (`fuel`); NewGame: an EMPTY tank, no
// cargo; Travel keeps it; Retry restores the entry state. An old save without `fuel` loads an empty tank and no cargo (no free fuel: its
// stations get their fuel the first time they are built — Game.realizeStationFuel).
//
// Task studio-beta-train-loose-cargo-20261107-060450-01: the record also holds the train's LOOSE CARGO (run/trainCargo.ts TrainCargo:
// every loose item / grounded bag lying in the car, exact stacks + train-local poses). Saved with the record (`cargo`); NewGame: none;
// Travel keeps it; Retry restores the entry state. An old save without `cargo` loads none (its fuel carts / Lockbox untouched).
//
// Task studio-corpse-chipper-fuel-20261110-235304-01: the record also holds the train's CHIPPER (fuel/chipperFuel.ts: the credit waiting in
// the machine in fifth-quarter ticks, its processing uid counter and the body being ground). Saved with the record (`chipper`); NewGame:
// idle and empty; Travel keeps it; Retry restores the entry state. An old save without `chipper` loads an idle, empty machine.
//
// Task studio-train-crafting-v1-20261111-225628-01: the record also holds the train's crafted EQUIPMENT (craft/equipment.ts
// TrainEquipment: the additional chests with their contents and the devices — radar, sentry with its loaded rounds, scanner — aboard,
// their train-local poses and plugs, and the run's unit counter). Saved with the record (`equipment`); NewGame: none; Travel keeps it;
// Retry restores the entry state. An old save without `equipment` loads none.

import type {RunParticipant} from './snapshot';
import type {SectionKey} from '../levels/types';
import {TrainLockbox} from './trainLockbox';
import {FUEL, trainFuelProblem, type CargoCartJSON, type TrainFuelJSON} from '../fuel/fuel';
import {TrainCargo} from './trainCargo';
import {chipperProblem, copyChipper, freshChipper, type ChipperJSON} from '../fuel/chipperFuel';
import {corpseFeedable} from '../ai/corpseTrait';
import {TrainEquipment} from '../craft/equipment';

/**
 * The train's fuel: the tank (quarter units, 0..FUEL.trainTankUnits) and the carts aboard. With a live cart system attached (`live`, the
 * world's FuelCarts) the cargo's truth is the live carts (their poses / units at save time); without one (Node, between worlds) the
 * stored records are kept exactly.
 */
export class TrainFuel {
  tank = 0;
  private cargo: CargoCartJSON[] = [];
  live: {cargo(): CargoCartJSON[]; restore(c: CargoCartJSON[]): void} | null = null;

  /** The carts aboard (live when attached, else the stored records). */
  cargoRecords(): CargoCartJSON[] {
    return (this.live ? this.live.cargo() : this.cargo).map(c => ({...c}));
  }

  /** Store cargo records (the live system hands them back when its world goes; a load without a live system). */
  setCargo(c: readonly CargoCartJSON[]): void {
    this.cargo = c.map(x => ({...x}));
  }

  toJSON(): TrainFuelJSON {
    return {v: 1, tank: this.tank, cargo: this.cargoRecords()};
  }

  /** Exact load (a malformed record loads EMPTY: no tank, no cargo — never invented fuel). */
  load(d: unknown): void {
    const ok = d !== undefined && trainFuelProblem(d) === null;
    const j = ok ? d as TrainFuelJSON : {v: 1 as const, tank: 0, cargo: []};
    this.tank = Math.max(0, Math.min(FUEL.trainTankUnits, j.tank));
    this.cargo = j.cargo.map(c => ({...c}));
    this.live?.restore(this.cargo.map(c => ({...c})));
  }

  reset(): void {
    this.tank = 0;
    this.cargo = [];
    this.live?.restore([]);
  }
}

/**
 * Task corpse-chipper: the train's chipper (fuel/chipperFuel.ts). `state` is THE record the machine's runtime mutates in place (startJob /
 * grind / transferToTank); load / reset replace it (a runtime re-reads `state` after either).
 */
export class TrainChipper {
  state: ChipperJSON = freshChipper();

  toJSON(): ChipperJSON {
    return copyChipper(this.state);
  }

  /** Exact load (absent / malformed: an idle, empty machine — never invented credit or bodies). */
  load(d: unknown): void {
    this.state = d !== undefined && chipperProblem(d, corpseFeedable) === null ? copyChipper(d as ChipperJSON) : freshChipper();
  }

  reset(): void {
    this.state = freshChipper();
  }
}

/** The level-one train every run starts with. */
export const PLAYER_TRAIN_L1 = Object.freeze({id: 'player-train-l1', tier: 1});
/** RunParticipant id of the record. */
export const PLAYER_TRAIN_PARTICIPANT = 'player-train';

export interface PlayerTrainState {
  /** Stable identity of the run's train (the same in every level of the run). */
  id: string;
  /** Upgrade tier (1 = the bare level-one car). */
  tier: number;
  /** The level / section it is parked in now (where the last level build placed it); null before the first build of a run. */
  at: SectionKey | null;
}

const fresh = (): PlayerTrainState => ({id: PLAYER_TRAIN_L1.id, tier: PLAYER_TRAIN_L1.tier, at: null});

function valid(d: unknown): d is PlayerTrainState {
  if (!d || typeof d !== 'object') return false;
  const s = d as Partial<PlayerTrainState>;
  const atOk = s.at === null || (!!s.at && typeof s.at === 'object' && typeof s.at.level === 'string' && typeof s.at.section === 'string');
  return typeof s.id === 'string' && s.id.length > 0 && Number.isInteger(s.tier) && (s.tier as number) >= 1 && atOk;
}

export class PlayerTrainRecord {
  private s: PlayerTrainState = fresh();
  /** Lane BOX: the train's LOCKBOX_SLOTS-slot Lockbox (the same object for the whole session; load / reset write it in place). */
  readonly lockbox = new TrainLockbox();
  /** Task train-fuel-system: the tank + the carts aboard (the same object for the whole session). */
  readonly fuel = new TrainFuel();
  /** Task train-loose-cargo: the loose items / bags aboard (the same object for the whole session). */
  readonly cargo = new TrainCargo();
  /** Task corpse-chipper: the woodchipper fixed in the car (the same object for the whole session). */
  readonly chipper = new TrainChipper();
  /** Task train-crafting: the crafted chests / devices aboard (the same object for the whole session). */
  readonly equipment = new TrainEquipment();

  /** A copy of the current record. */
  get state(): PlayerTrainState {
    return {id: this.s.id, tier: this.s.tier, at: this.s.at ? {...this.s.at} : null};
  }

  get id(): string {
    return this.s.id;
  }

  /** The train now stands in `key` (Game.buildSection, every level build: New game, Travel, Retry). Identity and tier never change here. */
  parkAt(key: SectionKey): void {
    this.s.at = {level: key.level, section: key.section};
  }

  /**
   * The run participant: JSON-safe save / exact load (anything malformed loads as a fresh level-one train) / NewGame reset.
   * Lane BOX: + the Lockbox contents (`lockbox`; missing / malformed slots load empty).
   */
  participant(): RunParticipant {
    return {
      id: PLAYER_TRAIN_PARTICIPANT,
      save: () => ({...this.state, lockbox: this.lockbox.toJSON(), fuel: this.fuel.toJSON(), cargo: this.cargo.toJSON(), chipper: this.chipper.toJSON(), equipment: this.equipment.toJSON()}),
      load: d => {
        this.s = valid(d) ? {id: d.id, tier: d.tier, at: d.at ? {level: d.at.level, section: d.at.section} : null} : fresh();
        this.lockbox.load(d && typeof d === 'object' ? (d as {lockbox?: unknown}).lockbox : undefined);
        this.fuel.load(d && typeof d === 'object' ? (d as {fuel?: unknown}).fuel : undefined);
        this.cargo.load(d && typeof d === 'object' ? (d as {cargo?: unknown}).cargo : undefined);
        this.chipper.load(d && typeof d === 'object' ? (d as {chipper?: unknown}).chipper : undefined);
        this.equipment.load(d && typeof d === 'object' ? (d as {equipment?: unknown}).equipment : undefined);
      },
      reset: () => { this.s = fresh(); this.lockbox.clear(); this.fuel.reset(); this.cargo.reset(); this.chipper.reset(); this.equipment.reset(); },
    };
  }
}
