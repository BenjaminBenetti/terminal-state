// Iteration 16 (lane RUN): the run's CARRY state (what travels with the player between sections and levels) and the
// "Retry level" snapshot taken when a logical level is entered.
//
// Travel never touches any of this: the live Inventory / Survival / flashlight battery / player vitals / lane systems
// simply persist. NewGame resets them (fresh starter loadout, run/starter.ts). Retry level restores the snapshot taken at
// level entry — the inventory (gear, backpack contents, loaded magazines), hp / stamina, hunger / thirst, battery, lane
// state (limb injuries …), run stats and that level's section memories — so there is no free heal or refill and the
// world is consistent with the restored inventory (no duplicated or lost items).
//
// Lanes with run-scoped state register a RunParticipant on Game.runParticipants (see lanes/run.notes).

import {Inventory} from '../items/inventory';
import type {Arrival, LevelId} from '../levels/types';
import type {SectionMemory} from './memory';

/** Run-scoped lane state (lane INJURY: limb injuries; lane GEAR: anything not stored in the Inventory). */
export interface RunParticipant {
  id: string;
  /** JSON-safe deep copy of the current state (taken at level entry for Retry level). */
  save(): unknown;
  /** Restore exactly a saved state (Retry level). */
  load(data: unknown): void;
  /** NewGame: fresh state. */
  reset(): void;
}

export interface VitalsSnapshot { hp: number; stamina: number; damageTaken: number }
export interface SurvivalSnapshot { hunger: number; thirst: number; time: number }
export interface BatterySnapshot { charge: number; on: boolean; died: boolean }

export interface RunSnapshot {
  /** Where the level was entered (Retry level rebuilds this section and places the player by this arrival). */
  level: LevelId;
  section: string;
  /** (campaign) the network station entered (absent: a legacy archetype run). */
  station?: string;
  arrival: Arrival;
  vitals: VitalsSnapshot;
  survival: SurvivalSnapshot;
  battery: BatterySnapshot;
  /** Deep copy, never handed out (restoring clones it again, so a level can be retried any number of times). */
  inventory: Inventory;
  /** RunParticipant.save() per participant id. */
  lanes: Record<string, unknown>;
  /** Deep copies of this level's section memories at entry. */
  memories: Record<string, SectionMemory>;
  stats: Record<string, number>;
}

/** The live carry objects (Game fields) a snapshot reads / writes. */
export interface CarryState {
  inv: Inventory;
  player: {hp: number; stamina: number; damageTaken: number};
  survival: {hunger: number; thirst: number; time: number};
  battery: {charge: number; on: boolean; died: boolean};
  participants: readonly RunParticipant[];
  stats: Record<string, number>;
}

/**
 * Deep copy of an Inventory. Uses `inv.clone()` once lane GEAR adds it (gear slots, backpack contents); until then a
 * structuredClone of the inventory's own data fields (hotbar, pack, selection, uid counter, any plain lane fields) onto
 * a new Inventory. Functions and non-cloneable fields are skipped (they are re-created by the constructor).
 */
export function cloneInventory(inv: Inventory): Inventory {
  const own = (inv as unknown as {clone?: () => Inventory}).clone;
  if (typeof own === 'function') return own.call(inv);
  const out = new Inventory();
  for (const [k, v] of Object.entries(inv)) {
    if (typeof v === 'function') continue;
    try { (out as unknown as Record<string, unknown>)[k] = structuredClone(v); } catch { /* not cloneable: keep the fresh constructor value */ }
  }
  return out;
}

function safeSave(p: RunParticipant): unknown {
  try { return structuredClone(p.save()); } catch (err) { console.warn(`Iteration 16 (RUN): run participant '${p.id}' save failed`, err); return undefined; }
}

export function takeSnapshot(at: {level: LevelId; section: string; station?: string; arrival: Arrival}, src: CarryState, memories: Record<string, SectionMemory>): RunSnapshot {
  const lanes: Record<string, unknown> = {};
  for (const p of src.participants) lanes[p.id] = safeSave(p);
  return {
    level: at.level, section: at.section, ...(at.station ? {station: at.station} : {}), arrival: {...at.arrival},
    vitals: {hp: src.player.hp, stamina: src.player.stamina, damageTaken: src.player.damageTaken},
    survival: {hunger: src.survival.hunger, thirst: src.survival.thirst, time: src.survival.time},
    battery: {charge: src.battery.charge, on: src.battery.on, died: src.battery.died},
    inventory: cloneInventory(src.inv),
    lanes,
    memories: structuredClone(memories),
    stats: {...src.stats},
  };
}

/** Restore a participant from a snapshot (missing data => reset). */
export function restoreParticipants(snap: RunSnapshot, participants: readonly RunParticipant[]): void {
  for (const p of participants) {
    try {
      if (snap.lanes[p.id] !== undefined) p.load(structuredClone(snap.lanes[p.id]));
      else p.reset();
    } catch (err) { console.warn(`Iteration 16 (RUN): run participant '${p.id}' restore failed`, err); }
  }
}

/** NewGame for every participant. */
export function resetParticipants(participants: readonly RunParticipant[]): void {
  for (const p of participants) {
    try { p.reset(); } catch (err) { console.warn(`Iteration 16 (RUN): run participant '${p.id}' reset failed`, err); }
  }
}

/**
 * Restore the plain carry values of a snapshot onto live objects (player vitals, survival, battery flags, stats) and
 * return a fresh deep copy of its inventory for the caller to install. The caller handles anything with side effects
 * (the flashlight's light registration: Game calls PlayerLight.reset(charge) first, then this overwrites the flags).
 */
export function restoreCarry(snap: RunSnapshot, dst: Omit<CarryState, 'inv' | 'participants'>): Inventory {
  dst.player.hp = snap.vitals.hp;
  dst.player.stamina = snap.vitals.stamina;
  dst.player.damageTaken = snap.vitals.damageTaken;
  dst.survival.hunger = snap.survival.hunger;
  dst.survival.thirst = snap.survival.thirst;
  dst.survival.time = snap.survival.time;
  dst.battery.charge = snap.battery.charge;
  dst.battery.on = snap.battery.on && snap.battery.charge > 0;
  dst.battery.died = snap.battery.died;
  for (const k of Object.keys(dst.stats)) delete dst.stats[k];
  Object.assign(dst.stats, snap.stats);
  return cloneInventory(snap.inventory);
}
