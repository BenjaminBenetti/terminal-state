// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): small FAKES of the live train equipment (craft/equipmentApi.ts
// EquipmentSystemLike / EquipmentUnit / EquipmentStore) for the bench's Node tests — the bench, the atomic craft and the chest's store
// view are written against the interface only (the real system is lane EQUIP's world/trainEquipment.ts).
import {EQUIPMENT, equipmentSeqOf, type EquipmentKind} from '../../src/craft/equipment';
import type {EquipmentStore, EquipmentSystemLike, EquipmentUnit, EquipmentUse} from '../../src/craft/equipmentApi';
import {setStoreRule, stackToJSON, type Inventory, type ItemStack} from '../../src/items/inventory';
import {feedRule} from '../../src/world/trainEquipment';

export interface FakeUnit extends EquipmentUnit {
  mode: 'world' | 'cargo' | 'held';
  plug: number | null;
  storeVersion: number;
  /** The pose worldPose() returns (null: no world / carried). */
  pose: {x: number; y: number; z: number; yaw: number; level: number} | null;
  /** The lid's state and every setOpen call (tests). */
  open: boolean;
  lidCalls: boolean[];
}

/**
 * One fake unit (a kind with def.slots gets them, empty; a feed kind's take only its item, by the real rule, and its `ammo` /
 * takeAmmo read and use up those stacks exactly as world/trainEquipment.ts LiveUnit does).
 */
export function fakeUnit(kind: EquipmentKind, uid: string, pose: FakeUnit['pose'] = {x: 0, y: 0, z: 0, yaw: 0, level: 0}): FakeUnit {
  const def = EQUIPMENT[kind];
  const u: FakeUnit = {
    uid, kind, def, mode: 'world', plug: null,
    get ammo(): number {
      let n = 0;
      if (def.slotItem) for (const st of u.slots ?? []) if (st?.itemId === def.slotItem) n += st.count;
      return n;
    },
    takeAmmo(n = 1) {
      let took = 0;
      const slots = u.slots;
      if (!def.slotItem || !slots) return 0;
      for (let i = slots.length - 1; i >= 0 && took < n; i--) {
        const st = slots[i];
        if (!st || st.itemId !== def.slotItem) continue;
        const k = Math.min(n - took, st.count);
        st.count -= k;
        took += k;
        if (st.count <= 0) slots[i] = null;
      }
      if (took) u.storeVersion++;
      return took;
    },
    slots: def.slots ? new Array<ItemStack | null>(def.slots).fill(null) : null,
    storeVersion: 0,
    touchStore() { u.storeVersion++; },
    open: false, lidCalls: [],
    setOpen(open: boolean) { u.open = open; u.lidCalls.push(open); },
    pose,
    worldPose() { return u.mode === 'held' ? null : u.pose; },
  };
  if (u.slots && def.slotItem) setStoreRule(u.slots, feedRule(def));
  return u;
}

export interface FakeEquipment extends EquipmentSystemLike {
  /** craftBlock's answer (null: a craft is allowed). */
  block: string | null;
  /** craft() returns null although craftBlock() allowed it (the unexpected failure). */
  failCraft: boolean;
  /** craft() throws. */
  throwCraft: boolean;
  /** Every unit (tests push / remove). */
  list: FakeUnit[];
  /** The units craft() made, in order. */
  made: FakeUnit[];
  calls: {block: EquipmentKind[]; craft: EquipmentKind[]};
  /** Where craft() puts a new unit (world). */
  spot: {x: number; y: number; z: number; yaw: number; level: number};
  /** Which chests count as standing in the parked car (default: every chest in mode 'world'; never a feed's slots). */
  aboard: (u: FakeUnit) => boolean;
  seq: number;
}

/** A fake equipment system: units in uid order, craft() puts a fresh EMPTY unit into the list. */
export function fakeEquipment(): FakeEquipment {
  const sys: FakeEquipment = {
    block: null, failCraft: false, throwCraft: false, list: [], made: [], calls: {block: [], craft: []}, seq: 0,
    spot: {x: 0, y: 0, z: 0, yaw: 0, level: 0},
    aboard: u => u.mode === 'world',
    uses: {} as Partial<Record<EquipmentKind, EquipmentUse>>,
    plugListeners: [],
    promptNotes: [],
    units: () => [...sys.list].sort((a, b) => equipmentSeqOf(a.uid) - equipmentSeqOf(b.uid)),
    plugged: kind => sys.units().filter(u => u.kind === kind && u.plug !== null).sort((a, b) => a.plug! - b.plug!)[0] ?? null,
    active: kind => sys.plugged(kind),
    craftBlock: kind => { sys.calls.block.push(kind); return sys.block; },
    craft: kind => {
      sys.calls.craft.push(kind);
      if (sys.throwCraft) throw new Error('fake craft failure');
      if (sys.block || sys.failCraft) return null;
      const u = fakeUnit(kind, `eq-${++sys.seq}`, {...sys.spot});
      sys.list.push(u);
      sys.made.push(u);
      return u;
    },
    storesAboard: (): EquipmentStore[] => (sys.units() as FakeUnit[]).filter(u => u.slots && !u.def.slotItem && sys.aboard(u)).map(u => ({uid: u.uid, slots: u.slots!, touch: () => u.touchStore()})),
  };
  return sys;
}

/** A plain chest store (no unit behind it). */
export function fakeStore(uid: string, size = EQUIPMENT.chest.slots): EquipmentStore & {touched: number} {
  const st = {uid, slots: new Array<ItemStack | null>(size).fill(null), touched: 0, touch() { st.touched++; }};
  return st;
}

/** Every place a stack can be for the bench, as plain JSON (deep: counts, uids, mags, bag contents) + the stack OBJECT in each slot. */
export function worldSnapshot(inv: Inventory, lists: readonly (readonly (ItemStack | null)[])[]): {json: string; refs: (ItemStack | null)[]} {
  const bag = inv.wornBag()?.bag ?? [];
  const all = [inv.hotbar, inv.pack, inv.gearSlots, inv.throwSlot, inv.meleeSlot, bag, ...lists];
  return {json: JSON.stringify([inv.toJSON(), ...lists.map(l => l.map(stackToJSON))]), refs: all.flatMap(l => [...l])};
}
