// Task player-train-shell-20261101-202805 (lane PLACE): the ONE persistent identity of the player's home train across a run.
//
// The train is the player's future moving base; today it is a level-one car parked at each level's start platform
// (gen/playerTrain.ts playerTrainPlacement), built by lane TRAIN. Whatever level the player is in, it is the SAME train: one record
// per Game, registered as the RunParticipant 'player-train' (Game.wireRunLanes) so NewGame gives a fresh level-one train, Retry
// restores the record as it was at level entry and Travel carries it unchanged (only `at`, where it is parked, follows the level).
// It owns no player inventory, health, survival, injuries or ammo: spawning in the train refills nothing. Later movement / upgrades extend
// this record. Pure (no three.js / DOM).
//
// Task train-lockbox-windows-20261101-232156 (lane BOX): the record also holds the train's LOCKBOX (run/trainLockbox.ts, 40 slots): saved
// with the record (`lockbox` in the participant data; an old save without it loads an empty box), emptied by NewGame, kept by Travel.
// `state` stays the train identity only.

import type {RunParticipant} from './snapshot';
import type {SectionKey} from '../levels/types';
import {TrainLockbox} from './trainLockbox';

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
  /** Lane BOX: the train's 40-slot Lockbox (the same object for the whole session; load / reset write it in place). */
  readonly lockbox = new TrainLockbox();

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
      save: () => ({...this.state, lockbox: this.lockbox.toJSON()}),
      load: d => {
        this.s = valid(d) ? {id: d.id, tier: d.tier, at: d.at ? {level: d.at.level, section: d.at.section} : null} : fresh();
        this.lockbox.load(d && typeof d === 'object' ? (d as {lockbox?: unknown}).lockbox : undefined);
      },
      reset: () => { this.s = fresh(); this.lockbox.clear(); },
    };
  }
}
