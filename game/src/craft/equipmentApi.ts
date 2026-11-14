// Task studio-train-crafting-v1-20261111-225628-01: what the OTHER crafting systems see of the live train equipment (world/
// trainEquipment.ts implements EquipmentSystemLike; Game.trainEquipment). Types only — the bench (world/craftBench.ts), the sentry's roof
// turret (world/sentryTurret.ts), the item scanner (world/itemScanner.ts) and the route radar's map reveal (Game.openTravelMap) are
// written against these, and their Node tests drive them with small fakes.

import {DRAG_HOLD_S} from '../core/holdGesture';
import type {ItemStack} from '../items/inventory';
import type {EquipmentDef, EquipmentKind} from './equipment';

/**
 * E held this long on a unit starts dragging / carrying it; a shorter press is a TAP (its use). The one shared hold-to-drag time
 * (core/holdGesture.ts DRAG_HOLD_S: the fuel dolly's too).
 */
export const EQUIP_HOLD_S = DRAG_HOLD_S;

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
  /**
   * The rounds it holds (kinds with def.slotItem: that item counted over its slots; else 0). They are ordinary stacks the player puts
   * in and takes out through the store view; the only other way one leaves is takeAmmo.
   */
  readonly ammo: number;
  /**
   * Its consumer takes up to `n` (default 1) rounds out of its slots — the sentry's turret, one per shot, BEFORE the shot. The last
   * stack empties first; an emptied slot is free again. Returns how many rounds really left (0: none there). Never creates a round.
   */
  takeAmmo(n?: number): number;
  /** Its storage slots (kinds with def.slots; else null): the live array the store view and transfers use. */
  readonly slots: (ItemStack | null)[] | null;
  /** Bumped whenever the slots changed outside the inventory's own transfers (a load, takeAmmo, touchStore): an open view's redraw key. */
  readonly storeVersion: number;
  /** The slots changed (a debit by the bench): bump storeVersion. */
  touchStore(): void;
  /** Show its lid open / closed (kinds with a lid: the chest; else a no-op). Visual only. */
  setOpen(open: boolean): void;
  /**
   * Task studio-scanner-console-refinements-20261114-031614-01: its DISPLAY MODE — one of def.displayModes (the item scanner's resource
   * filter; the first by default and for every record written without one), '' for a kind without modes. Saved with the unit
   * (craft/equipment.ts EquipmentJSON.display); its kind's own system reads and sets it.
   */
  readonly display: string;
  /** Select one of def.displayModes (false: not one of them, or already selected — nothing changed). */
  setDisplay(mode: string): boolean;
  /**
   * Its footprint centre on the floor and yaw in the WORLD now (a parked / riding car's unit through the car's pose); null while there
   * is no world to stand in (between two stations) or it is carried.
   */
  worldPose(): {x: number; y: number; z: number; yaw: number; level: number} | null;
}

/**
 * What a TAP of E on a unit does (a kind's own system registers one: EquipmentSystemLike.uses). Task train-interaction-ux-20261112
 * (lane DRAG): the tap counts ANYWHERE on the unit — a device's console face, its hand truck's frame or handle, the chest's body.
 * HOLDING E (EQUIP_HOLD_S) always drags the hand truck / carries the chest: that is the equipment system's own rule (the shared
 * core/holdGesture.ts) and is never asked here. A tap never moves the unit.
 */
export interface EquipmentUse {
  /**
   * The TAP's look-at line ('<b>[E]</b> …', or a plain status line); null: none. The equipment system appends the hold hint itself
   * (' · hold [E] to drag it' / '… to carry it') and shows its own 'Hold [E] Drag / Carry …' line when there is none.
   */
  prompt(u: EquipmentUnit): string | null;
  /** E tapped (pressed and released before EQUIP_HOLD_S). True: handled. False: nothing happens. */
  tap(u: EquipmentUnit): boolean;
}

/** A chest standing in the parked car, as a store of materials the bench may draw from (general storage only: never a feed's slots). */
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
  /** What a TAP of E on a unit of a kind does (set by that kind's system; absent: a tap does nothing — holding E still moves it). */
  readonly uses: Partial<Record<EquipmentKind, EquipmentUse>>;
  /** Called when a unit connects to / leaves a plug (after the state changed). */
  readonly plugListeners: ((u: EquipmentUnit, plugged: boolean) => void)[];
  /**
   * A kind's own system adds a short status to the look-at line of its units ('not plugged in', 'no headroom …'; null: nothing to
   * say) — read by whoever writes that line (the store view's prompt for a unit with slots).
   */
  readonly promptNotes: ((u: EquipmentUnit) => string | null)[];
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
  /** The general-storage units (chests) standing wholly inside the parked car (uid order): the bench counts and takes materials from them. */
  storesAboard(): EquipmentStore[];
}
