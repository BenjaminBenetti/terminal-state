import {describe, expect, it} from 'vitest';
import {Inventory, type ItemStack, type SlotRef} from '../src/items/inventory';
import {ITEMS} from '../src/items/items';
import {WeaponController} from '../src/weapons/weapons';

const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const P = (index: number): SlotRef => ({bar: 'pack', index});

function totals(inv: Inventory): Record<string, number> {
  const t: Record<string, number> = {};
  for (const s of [...inv.hotbar, ...inv.pack]) if (s) t[s.itemId] = (t[s.itemId] ?? 0) + s.count;
  return t;
}

describe('inventory drag and drop (iteration 04)', () => {
  it('moves a whole stack as the same object (uid + loaded magazine kept); selection is a slot index', () => {
    const inv = new Inventory();
    const rifle = inv.makeStack('rifle', 1, 17);
    inv.set(H(0), rifle);
    inv.select(0);
    expect(inv.moveCount(H(0), P(5))).toBe('moved');
    expect(inv.pack[5]).toBe(rifle);
    expect(inv.pack[5]!.mag).toBe(17);
    expect(inv.hotbar[0]).toBeNull();
    expect(inv.selected).toBe(0);
    expect(inv.selectedStack()).toBeNull(); // the held item follows the selected slot (game re-syncs)
    expect(inv.moveCount(P(5), P(5))).toBe('none');
    expect(inv.invariants()).toEqual([]);
  });

  it('swaps different items whole and the selected slot then holds the swapped-in weapon', () => {
    const inv = new Inventory();
    const rifle = inv.makeStack('rifle', 1, 12), shotgun = inv.makeStack('shotgun', 1, 4);
    inv.set(H(0), rifle);
    inv.set(P(2), shotgun);
    inv.select(0);
    const wc = new WeaponController();
    wc.equip(inv.selectedStack());
    expect(inv.moveCount(P(2), H(0))).toBe('swapped');
    expect(inv.hotbar[0]).toBe(shotgun);
    expect(inv.pack[2]).toBe(rifle);
    expect([shotgun.mag, rifle.mag]).toEqual([4, 12]);
    wc.equip(inv.selectedStack()); // what Game.syncHeld does after changed()
    expect(wc.def?.id).toBe('shotgun');
    expect(wc.stack).toBe(shotgun);
    expect(inv.invariants()).toEqual([]);
  });

  it('merges the same item up to stackMax and leaves the remainder in the source (uids kept)', () => {
    const inv = new Inventory();
    const a = inv.makeStack('bandage', 2), b = inv.makeStack('bandage', 4); // stackMax 5
    inv.set(P(0), a);
    inv.set(H(4), b);
    expect(inv.moveCount(P(0), H(4))).toBe('merged');
    expect(inv.hotbar[4]).toBe(b);
    expect(b.count).toBe(5);
    expect(inv.pack[0]).toBe(a);
    expect(a.count).toBe(1);
    // full target: plain swap of the two whole stacks
    expect(inv.moveCount(P(0), H(4))).toBe('swapped');
    expect(inv.hotbar[4]).toBe(a);
    expect(inv.invariants()).toEqual([]);
  });

  it('splits onto an empty slot with a fresh uid, merges a split onto the same item, refuses a split onto a different item', () => {
    const inv = new Inventory();
    const w = inv.makeStack('water', 4);
    inv.set(P(1), w);
    expect(inv.moveCount(P(1), P(2), 2)).toBe('split');
    expect(inv.pack[1]).toBe(w);
    expect(w.count).toBe(2);
    expect(inv.pack[2]!.count).toBe(2);
    expect(inv.pack[2]!.uid).not.toBe(w.uid);
    const cola5 = inv.makeStack('cola', 5), cola3 = inv.makeStack('cola', 3); // stackMax 6
    inv.set(H(1), cola5);
    inv.set(H(2), cola3);
    expect(inv.moveCount(H(2), H(1), 2)).toBe('merged'); // only 1 fits
    expect([cola5.count, cola3.count]).toEqual([6, 2]);
    const before = JSON.stringify([inv.hotbar, inv.pack]);
    expect(inv.moveCount(P(1), H(2), 1)).toBe('refused');
    expect(JSON.stringify([inv.hotbar, inv.pack])).toBe(before);
    expect(inv.invariants()).toEqual([]);
  });

  it('detach (drop out of the inventory) keeps the uid for a whole stack and splits otherwise', () => {
    const inv = new Inventory();
    const ammo = inv.makeStack('ammo_556', 60);
    inv.set(P(0), ammo);
    const part = inv.detach(P(0), 25)!;
    expect(part.count).toBe(25);
    expect(part.uid).not.toBe(ammo.uid);
    expect(ammo.count).toBe(35);
    expect(inv.detach(P(0))).toBe(ammo);
    expect(inv.pack[0]).toBeNull();
    expect(inv.detach(P(0))).toBeNull();
    const rifle = inv.makeStack('rifle', 1, 9);
    inv.set(H(0), rifle);
    expect(inv.detach(H(0), 5)).toBe(rifle); // counts clamp to the stack
    expect(rifle.mag).toBe(9);
  });

  it('random drag/drop/split sequences conserve counts, keep uids unique and never break invariants', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ids = Object.keys(ITEMS);
    for (let run = 0; run < 20; run++) {
      const inv = new Inventory();
      for (let i = 0; i < 12; i++) inv.add(inv.makeStack(ids[Math.floor(rnd() * ids.length)], 1 + Math.floor(rnd() * 40)));
      const expected = totals(inv);
      const dropped: ItemStack[] = [];
      const ref = (): SlotRef => (rnd() < 0.35 ? H(Math.floor(rnd() * 5)) : P(Math.floor(rnd() * 12)));
      for (let op = 0; op < 150; op++) {
        const from = ref();
        const st = inv.get(from);
        const count = st && rnd() < 0.4 ? Math.max(1, Math.floor(st.count / 2)) : undefined;
        if (rnd() < 0.08) { const d = inv.detach(from, count); if (d) dropped.push(d); }
        else inv.moveCount(from, ref(), count);
        expect(inv.invariants()).toEqual([]);
      }
      const now = totals(inv);
      for (const d of dropped) now[d.itemId] = (now[d.itemId] ?? 0) + d.count;
      expect(now).toEqual(expected);
      const uids = [...inv.hotbar, ...inv.pack, ...dropped].filter(Boolean).map(s => s!.uid);
      expect(new Set(uids).size).toBe(uids.length);
    }
  });
});
