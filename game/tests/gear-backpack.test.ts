// Iteration 16 (lane GEAR): the backpack — its contents are unreachable while worn (no Inventory / UI path), reachable
// only through an OPEN session on a GROUNDED bag; no dupes, no loss and no bag-in-bag across set down / open / move /
// wear / clone / toJSON / the per-section bag store.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {Inventory, type AnyRef, type ItemStack, type SlotRef, stackFromJSON, stackToJSON, stacksIn} from '../src/items/inventory';
import {BACKPACK_SLOTS, GEAR_SLOTS} from '../src/items/gear';
import {BagSession, type BagHost} from '../src/gear/bagSession';
import {MemoryBagStore, readSectionBags, type SectionBags} from '../src/gear/bagStore';
import {GroundBag, bagTarget, BAG_REACH} from '../src/world/groundBag';
import {Grid} from '../src/gen/grid';
import {mulberry32} from '../src/core/rng';

const P = (index: number): SlotRef => ({bar: 'pack', index});
const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const B = (index: number): AnyRef => ({bar: 'bag', index});
const BACK: SlotRef = {bar: 'gear', index: GEAR_SLOTS.indexOf('backpack')};

class Host implements BagHost {
  grounded = true;
  constructor(readonly stack: ItemStack) {}
}

/** Totals per item over the inventory (+ worn bag contents) and a grounded bag. */
function totals(inv: Inventory, extra: (ItemStack | null)[] = []): Record<string, number> {
  const t: Record<string, number> = {};
  for (const s of [...inv.allStacks(true), ...extra.flatMap(x => stacksIn(x))]) t[s.itemId] = (t[s.itemId] ?? 0) + s.count;
  return t;
}
function uidsUnique(inv: Inventory, extra: (ItemStack | null)[] = []): boolean {
  const all = [...inv.allStacks(true), ...extra.flatMap(x => stacksIn(x))].map(s => s.uid);
  return new Set(all).size === all.length;
}

function wornBagWithLoot() {
  const inv = new Inventory();
  inv.set(H(0), inv.makeStack('pistol', 1, 15));
  inv.add(inv.makeStack('ammo_9mm', 20));
  const bag = inv.makeStack('backpack', 1);
  expect(bag.bag!.length).toBe(BACKPACK_SLOTS);
  bag.bag![0] = inv.makeStack('ammo_9mm', 60);
  bag.bag![1] = inv.makeStack('medkit', 2);
  bag.bag![5] = inv.makeStack('rifle', 1, 30);
  inv.set(BACK, bag);
  return {inv, bag};
}

describe('worn backpack: contents out of reach', () => {
  it('no Inventory method reads or writes the worn bag contents', () => {
    const {inv, bag} = wornBagWithLoot();
    const snapshot = JSON.stringify(stackToJSON(bag));
    expect(inv.count('ammo_9mm')).toBe(20); // the 60 in the bag do not count (no reloading from the bag)
    expect(inv.count('medkit')).toBe(0);
    expect(inv.take('medkit', 1)).toBe(0);
    expect(inv.take('ammo_9mm', 100)).toBe(20);
    expect(inv.find(bag.bag![1]!.uid)).toBeNull();
    expect(inv.find(bag.bag![5]!.uid)).toBeNull();
    // the 'bag' bar is not an Inventory slot: every slot API refuses it
    const bagRef = {bar: 'bag', index: 1} as unknown as SlotRef;
    expect(inv.get(bagRef)).toBeNull();
    inv.set(P(1), inv.makeStack('water', 1));
    expect(inv.get(bagRef)).toBeNull(); // never aliases a pocket
    inv.set(bagRef, inv.makeStack('water', 1));
    expect(inv.refusal?.code).toBe('bad-ref');
    inv.set(P(1), null);
    expect(inv.moveCount(bagRef, P(0))).toBe('refused');
    expect(inv.moveCount(P(0), bagRef)).not.toBe('moved');
    expect(inv.detach(bagRef)).toBeNull();
    expect(inv.consumeAt(bagRef)).toBe(false);
    // the transfer APIs refuse the worn bag
    expect(inv.bagMove(bag, B(1), P(0))).toBe('refused');
    expect(inv.refusal?.code).toBe('worn-bag');
    expect(inv.bagQuick(bag, B(0))).toBe(0);
    expect(inv.refusal?.code).toBe('worn-bag');
    expect(inv.bagQuick(bag, H(0))).toBe(0);
    // add() fills pockets / quick slots, never the bag
    for (let i = 0; i < 30; i++) inv.add(inv.makeStack('bandage', 5));
    expect(JSON.stringify(stackToJSON(bag))).toBe(snapshot);
    expect(inv.invariants()).toEqual([]);
  });

  it('a session on a worn (or held) bag is refused: open + grounded is required', () => {
    const {inv, bag} = wornBagWithLoot();
    const s = new BagSession(() => inv, new Host(bag));
    expect(s.active).toBe(false); // it is part of the inventory
    expect(s.move(B(1), P(3))).toBe('refused');
    expect(s.quick(B(0))).toBe(0);
    expect(s.slots()).toEqual([]);
    expect(inv.worn('backpack')!.bag![1]!.count).toBe(2);
  });

  it('the UI and game code have no path into a bag: only gear/bagSession.ts calls bagMove / bagQuick', () => {
    const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
    const ui = src('ui/inventoryUI.ts'), game = src('game.ts');
    for (const text of [ui, game]) {
      expect(text).not.toMatch(/\.bag\b(?!s)/); // never touches stack.bag
      expect(text).not.toMatch(/bagMove|bagQuick|BagSession/);
    }
    expect(src('ui/bagView.ts')).not.toMatch(/bagMove|bagQuick|\.stack\.bag\b/); // the view only talks to its session
    expect(src('gear/system.ts')).not.toMatch(/bagMove|bagQuick/);
  });
});

describe('grounded bag: open session transfers', () => {
  const grounded = () => {
    const {inv, bag} = wornBagWithLoot();
    const taken = inv.takeOffBag()!;
    expect(taken).toBe(bag); // the same stack: identity + contents
    const host = new Host(taken);
    return {inv, bag: taken, host, s: new BagSession(() => inv, host)};
  };

  it('click-transfer both ways, merging; what does not fit stays in place', () => {
    const {inv, bag, s} = grounded();
    expect(s.active).toBe(true);
    const ammo = bag.bag![0]!;
    expect(s.quick(B(0))).toBe(60); // bag -> pockets (merges onto the 20)
    expect(inv.count('ammo_9mm')).toBe(80);
    expect(bag.bag![0]).toBeNull();
    expect(inv.allStacks().some(x => x === ammo) || inv.count('ammo_9mm') === 80).toBe(true);
    const med = bag.bag![1]!;
    expect(s.quick(B(1))).toBe(2);
    expect(inv.find(med.uid)).not.toBeNull(); // whole stack moved as the same object (uid kept)
    // pockets -> bag
    const ref = inv.find(med.uid)!;
    expect(s.quick(ref)).toBe(2);
    expect(bag.bag!.includes(med)).toBe(true);
    expect(inv.find(med.uid)).toBeNull();
    expect(inv.invariants()).toEqual([]);
  });

  it('drag moves / splits / swaps between pockets and the bag; refusals for bags and worn gear', () => {
    const {inv, bag, s} = grounded();
    inv.set(P(3), inv.makeStack('water', 4));
    expect(s.move(P(3), B(3), 2)).toBe('split');
    expect(bag.bag![3]!.count).toBe(2);
    expect(inv.get(P(3))!.count).toBe(2);
    expect(s.move(B(5), P(3))).toBe('swapped'); // rifle <-> water
    expect(inv.get(P(3))!.itemId).toBe('rifle');
    expect(bag.bag![5]!.itemId).toBe('water');
    expect(s.move(B(5), B(3))).toBe('merged'); // within the bag
    // no bag inside a bag (another backpack can never be in the pockets either)
    const other = inv.makeStack('backpack', 1);
    const foreign = new BagSession(() => inv, new Host(other));
    expect(foreign.move(B(0), B(1))).toBe('none');
    inv.add(inv.makeStack('helmet', 1)); // worn
    expect(s.quick({bar: 'gear', index: GEAR_SLOTS.indexOf('helmet')})).toBe(0);
    expect(s.refusal?.code).toBe('not-gear');
    expect(inv.invariants()).toEqual([]);
  });

  it('closing, walking away (grounded=false) or wearing ends every path in', () => {
    const {inv, bag, host, s} = grounded();
    s.close();
    expect(s.move(B(1), P(5))).toBe('refused');
    expect(s.quick(B(1))).toBe(0);
    const s2 = new BagSession(() => inv, host);
    host.grounded = false;
    expect(s2.move(B(1), P(5))).toBe('refused');
    host.grounded = true;
    const s3 = new BagSession(() => inv, host);
    expect(s3.wear()).toBe(true);
    expect(inv.worn('backpack')).toBe(bag);
    expect(s3.open).toBe(false);
    expect(s3.quick(B(1))).toBe(0);
    expect(bag.bag![1]!.count).toBe(2);
  });

  it('"Wear it" needs a free back slot (a found second bag can be emptied but not worn over yours)', () => {
    const {inv, bag, s} = grounded();
    const mine = inv.makeStack('backpack', 1);
    inv.set(BACK, mine);
    expect(s.wear()).toBe(false);
    expect(s.refusal?.code).toBe('slot-taken');
    expect(s.active).toBe(true); // still open: you can keep moving things
    expect(s.quick(B(1))).toBe(2);
    expect(inv.worn('backpack')).toBe(mine);
    expect(bag.bag!.filter(Boolean).length).toBe(2);
  });

  it('random transfer sequences conserve every item, keep uids unique and never nest bags (500 steps x 20 seeds)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = mulberry32(seed * 7919);
      const {inv, bag, s} = grounded();
      inv.add(inv.makeStack('bandage', 4));
      inv.add(inv.makeStack('chest_rig', 1));
      inv.set(P(13), inv.makeStack('cola', 5));
      const want = totals(inv, [bag]);
      const refs = (): AnyRef[] => [...inv.hotbar.map((_, i) => H(i)), ...inv.pack.map((_, i) => P(i)), ...bag.bag!.map((_, i) => B(i))];
      for (let step = 0; step < 500; step++) {
        const all = refs();
        const a = all[Math.floor(r() * all.length)], b = all[Math.floor(r() * all.length)];
        const roll = r();
        if (roll < 0.45) s.move(a, b);
        else if (roll < 0.6) s.move(a, b, 1 + Math.floor(r() * 3));
        else if (roll < 0.9) s.quick(a);
        else if (roll < 0.95) { const off = inv.takeOff('chest'); void off; } // may be refused (extra pockets)
        else inv.wearFrom(P(Math.floor(r() * inv.pack.length)));
        expect(totals(inv, [bag]), `seed ${seed} step ${step}`).toEqual(want);
        expect(uidsUnique(inv, [bag])).toBe(true);
        expect(bag.bag!.length).toBe(BACKPACK_SLOTS);
        for (const x of bag.bag!) if (x) { expect(x.itemId).not.toBe('backpack'); expect(x.bag).toBeUndefined(); }
        expect(inv.invariants()).toEqual([]);
      }
      // wear it, snapshot, restore: exactly the same contents and uids
      expect(s.wear()).toBe(true);
      const j = JSON.parse(JSON.stringify(inv.toJSON()));
      const back = Inventory.fromJSON(j);
      expect(totals(back)).toEqual(want);
      expect(back.worn('backpack')!.bag!.map(x => x?.uid ?? null)).toEqual(bag.bag!.map(x => x?.uid ?? null));
      expect(back.invariants()).toEqual([]);
      const c = inv.clone();
      expect(totals(c)).toEqual(want);
    }
  });
});

describe('per-section bag store', () => {
  const rec = (seed: number, bag: ItemStack): SectionBags => ({v: 1, seed, init: true, bags: [{id: `bag:${bag.uid}`, stack: stackToJSON(bag)!, x: 3, y: 0, z: 4, yaw: 1, level: 0}]});

  it('records round-trip exactly; stale seeds and malformed bags are ignored; stores deep-copy', () => {
    const {bag} = wornBagWithLoot();
    const store = new MemoryBagStore();
    store.save('subway:main', rec(42, bag));
    const r = readSectionBags(store.load('subway:main'), 42)!;
    expect(r.bags).toHaveLength(1);
    const back = stackFromJSON(r.bags[0].stack)!;
    expect(stackToJSON(back)).toEqual(stackToJSON(bag));
    expect(readSectionBags(store.load('subway:main'), 43)).toBeNull(); // another run's / seed's record
    expect(readSectionBags(store.load('office:floor-3'), 42)).toBeNull();
    // the loaded copy is independent of the stored one
    (store.load('subway:main') as SectionBags).bags.length = 0;
    expect(readSectionBags(store.load('subway:main'), 42)!.bags).toHaveLength(1);
    // a bag inside the bag is refused on load (never trusted blindly)
    const evil = rec(42, bag);
    evil.bags[0].stack.bag![3] = stackToJSON(bag);
    expect(readSectionBags(evil, 42)!.bags).toHaveLength(0);
    // toJSON / loadJSON (Retry snapshots without RUN's store)
    const j = store.toJSON();
    const s2 = new MemoryBagStore();
    s2.loadJSON(j);
    expect(s2.toJSON()).toEqual(j);
    store.clear();
    expect(store.load('subway:main')).toBeUndefined();
  });
});

describe('ground bag object and targeting', () => {
  it('uses the shared backpack template, stands on its pose, is targeted within reach and in sight only', () => {
    const inv = new Inventory();
    const st = inv.makeStack('backpack', 1);
    const b = new GroundBag('bag:1', st, {x: 5, y: 0, z: 5, yaw: 0.5, level: 0});
    expect(b.obj.position.toArray()).toEqual([5, 0, 5]);
    expect(b.mats.length).toBeGreaterThan(0);
    const box = new THREE.Box3().setFromObject(b.obj);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(box.max.y).toBeGreaterThan(0.3); // standing up
    const g = new Grid(40, 40);
    for (let y = 1; y < 39; y++) for (let x = 1; x < 39; x++) g.set(x, y, 1);
    const eye = new THREE.Vector3(5, 1.6, 6.4);
    const toward = (to: THREE.Vector3) => to.clone().sub(eye).normalize();
    expect(bagTarget([b], eye, toward(b.centre), g)).toBe(b);
    expect(bagTarget([b], eye, new THREE.Vector3(0, 0, 1), g)).toBeNull(); // looking away
    const far = new THREE.Vector3(5, 1.6, 5 + BAG_REACH + 0.6);
    expect(bagTarget([b], far, b.centre.clone().sub(far).normalize(), g)).toBeNull();
    // a wall between (grid row z = 5.75 m)
    for (let x = 0; x < 40; x++) g.set(x, 11, 0);
    expect(bagTarget([b], eye, toward(b.centre), g)).toBeNull();
    b.dispose();
    expect(b.grounded).toBe(false);
  });
});
