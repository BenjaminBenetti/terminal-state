// Task studio-train-crafting-v1-20261111-225628-01: what the OTHER crafting systems see of the live train equipment (world/
// trainEquipment.ts implements EquipmentSystemLike; Game.trainEquipment). Types only — the bench (world/craftBench.ts), the sentry's roof
// turret (world/sentryTurret.ts), the item scanner (world/itemScanner.ts) and the route radar's map reveal (Game.openTravelMap) are
// written against these, and their Node tests drive them with small fakes.

import type {ItemStack} from '../items/inventory';
import type {EquipmentDef, EquipmentKind} from './equipment';

/** E held this long on a unit is a HOLD (the grounded backpack's rule: gear BAG_HOLD_S); a shorter press is a TAP. */
export const EQUIP_HOLD_S = 0.5;

/** One live unit. The object is stable for the unit's life in a world (compare by `uid` across worlds). */
export interface EquipmentUnit {
  readonly uid: string;
  readonly kind: EquipmentKind;
  readonly def: EquipmentDef;
  /**
   * 'world': standing in the level or in the parked car; 'cargo': riding the moving car; 'held': carried in the player's hands.
   */
  readonly mode: 'world' | 'cargo' | 'held';
  /** The train plug it is connected to right now (craft/trainFixtures.ts equipmentPlugs index), or null. */
  readonly plug: number | null;
  /** Rounds in its hopper (kinds with def.ammoCap; else 0). Integers; changed only through setAmmo. */
  readonly ammo: number;
  /** Set the hopper's rounds (clamped to 0..def.ammoCap, floored). Returns the value now held. */
  setAmmo(n: number): number;
  /** Its storage slots (kinds with def.slots; else null): the live array the store view and transfers use. */
  readonly slots: (ItemStack | null)[] | null;
  /** Bumped whenever the slots changed outside the inventory's own transfers (a load, touchStore): an open view's redraw key. */
  readonly storeVersion: number;
  /** The slots changed (a debit by the bench): bump storeVersion. */
  touchStore(): void;
  /** Show its lid open / closed (kinds with a lid: the chest; else a no-op). Visual only. */
  setOpen(open: boolean): void;
  /**
   * Its footprint centre on the floor and yaw in the WORLD now (a parked / riding car's unit through the car's pose); null while there
   * is no world to stand in (between two stations) or it is carried.
   */
  worldPose(): {x: number; y: number; z: number; yaw: number; level: number} | null;
}

/**
 * What E on a unit does besides moving it (a kind's own system registers one: EquipmentSystemLike.uses). A 'dolly' kind: E on its
 * CONSOLE FACE (E on the hand truck's frame / handle always grabs it). A 'carry' kind (the chest): E anywhere on it — and HOLDING E
 * always picks it up (the system's own rule: `hold` is not asked).
 */
export interface EquipmentUse {
  /** The look-at prompt ('<b>[E]</b> …'); null: the unit's default prompt (grab / carry / plug hint). */
  prompt(u: EquipmentUnit): string | null;
  /** E tapped. True: handled. False: the default action (grab the hand truck / pick the chest up). */
  tap(u: EquipmentUnit): boolean;
  /** E held EQUIP_HOLD_S (optional, 'dolly' kinds; with it a tap acts on the key's release). True: handled. */
  hold?(u: EquipmentUnit): boolean;
}

/** A chest standing in the parked car, as a store of materials the bench may draw from. */
export interface EquipmentStore {
  readonly uid: string;
  readonly slots: (ItemStack | null)[];
  /** The slots changed (the open view redraws). */
  touch(): void;
}

export interface EquipmentSystemLike {
  /** Every live unit (world + cargo + held), in uid order. */
  units(): readonly EquipmentUnit[];
  /** The unit of `kind` connected to a train plug (parked OR riding), the lowest plug first; null: none. */
  plugged(kind: EquipmentKind): EquipmentUnit | null;
  /** The unit of `kind` whose benefit works NOW: connected to a plug of the PARKED train in a live world; null: none. */
  active(kind: EquipmentKind): EquipmentUnit | null;
  /** What E on a kind's console face does (set by that kind's system; absent: grab only). */
  readonly uses: Partial<Record<EquipmentKind, EquipmentUse>>;
  /** Called when a unit connects to / leaves a plug (after the state changed). */
  readonly plugListeners: ((u: EquipmentUnit, plugged: boolean) => void)[];
  /**
   * Why a freshly crafted `kind` cannot be put on the car's floor now (the train moving / not built, no free spot, too many units
   * aboard): the refusal text; null: it can.
   */
  craftBlock(kind: EquipmentKind): string | null;
  /**
   * Put a new, EMPTY unit of `kind` on the first free spot of the parked car's floor (craft/trainFixtures.ts craftSpots). Returns the
   * unit, or null exactly when craftBlock(kind) is not null (nothing changed).
   */
  craft(kind: EquipmentKind): EquipmentUnit | null;
  /** The chests standing wholly inside the parked car (uid order): the bench counts and takes materials from them. */
  storesAboard(): EquipmentStore[];
}
