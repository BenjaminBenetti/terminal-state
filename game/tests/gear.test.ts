// Iteration 16 (lane GEAR): base-tier gear stats (exact, from base values, never stacking), armor through the hit
// pipeline, gear-slot validation, the chest rig's dynamic pockets (refused removal, no loss), and inventory snapshots.
import {describe, expect, it} from 'vitest';
import {Inventory, PACK_SIZE, type SlotRef} from '../src/items/inventory';
import {GEAR_ITEMS, GEAR_SLOTS, gearModifiersFor, gearStatText} from '../src/items/gear';
import {ITEMS, itemDims} from '../src/items/items';
import {BASE_MODIFIERS, combineModifiers} from '../src/player/modifiers';
import {armorFor} from '../src/player/hits';
import {ICONS} from '../src/ui/icons';
import * as THREE from 'three';
import {gearItemModel, gearModelSource, registerGearModel} from '../src/gear/models';

const G = (slot: (typeof GEAR_SLOTS)[number]): SlotRef => ({bar: 'gear', index: GEAR_SLOTS.indexOf(slot)});
const P = (index: number): SlotRef => ({bar: 'pack', index});
const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const mods = (inv: Inventory) => combineModifiers([() => gearModifiersFor(inv.gear)]);

describe('base-tier gear items', () => {
  it('six base-tier items, merged into ITEMS / ITEM_DIMS / ICONS, one per slot type (two chest options)', () => {
    expect(Object.keys(GEAR_ITEMS).sort()).toEqual(['armor_vest', 'backpack', 'boots', 'chest_rig', 'gloves', 'helmet']);
    for (const [id, def] of Object.entries(GEAR_ITEMS)) {
      expect(ITEMS[id]).toBe(def);
      expect(def.kind).toBe('gear');
      expect(def.stackMax).toBe(1);
      expect(def.gear!.tier).toBe(1);
      expect(ICONS[def.icon]).toMatch(/^<svg/);
      expect(itemDims(id).h).toBeGreaterThan(0.03);
      expect(gearStatText(def.gear!).length).toBeGreaterThan(4);
    }
    expect(GEAR_ITEMS.armor_vest.gear!.slot).toBe('chest');
    expect(GEAR_ITEMS.chest_rig.gear!.slot).toBe('chest');
  });

  it('exact stats from base values: vest 0.20 torso, hat 0.25 head, rig +4 pockets, boots x1.05, gloves x0.92 / x0.92', () => {
    const inv = new Inventory();
    expect(mods(inv)).toEqual({...BASE_MODIFIERS});
    for (const id of ['armor_vest', 'helmet', 'boots', 'gloves']) expect(inv.add(inv.makeStack(id, 1))).toBe(0);
    let m = mods(inv);
    expect(m.armorTorso).toBeCloseTo(0.2, 12);
    expect(m.armorHead).toBeCloseTo(0.25, 12);
    expect(m.speedMult).toBeCloseTo(1.05, 12);
    expect(m.spreadMult).toBeCloseTo(0.92, 12);
    expect(m.handlingMult).toBeCloseTo(0.92, 12);
    expect(m.extraPockets).toBe(0);
    // the rig instead of the vest: pockets, no torso armor
    const vest = inv.worn('chest')!;
    expect(inv.takeOff('chest')).toBe('moved');
    expect(inv.find(vest.uid)?.bar).toBe('pack');
    const rig = inv.makeStack('chest_rig', 1);
    expect(inv.add(rig)).toBe(0);
    m = mods(inv);
    expect(m.armorTorso).toBe(0);
    expect(m.extraPockets).toBe(4);
    expect(inv.pack.length).toBe(PACK_SIZE + 4);
  });

  it('never stacks: re-evaluating every frame, wearing a second copy, unequip / swap / re-equip give the same numbers', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('boots', 1));
    const once = mods(inv);
    for (let i = 0; i < 50; i++) expect(mods(inv)).toEqual(once); // per-frame recompute from base values
    const spare = inv.makeStack('boots', 1);
    expect(inv.add(spare)).toBe(0); // slot taken: the spare goes to the pockets, it does not add speed
    expect(inv.find(spare.uid)?.bar).toBe('pack');
    expect(mods(inv).speedMult).toBeCloseTo(1.05, 12);
    // swap worn <-> spare (drag the spare onto the boots slot)
    expect(inv.moveCount(inv.find(spare.uid)!, G('boots'))).toBe('swapped');
    expect(mods(inv).speedMult).toBeCloseTo(1.05, 12);
    expect(inv.takeOff('boots')).toBe('moved');
    expect(mods(inv)).toEqual({...BASE_MODIFIERS});
    expect(inv.wearFrom(inv.find(spare.uid)!)).toBe('moved');
    expect(mods(inv).speedMult).toBeCloseTo(1.05, 12);
    expect(inv.invariants()).toEqual([]);
  });

  it('an item in the wrong slot never counts (defensive: modifiers read the slot type)', () => {
    expect(gearModifiersFor({chest: {itemId: 'helmet'}, helmet: {itemId: 'armor_vest'}})).toMatchObject({armorHead: 0, armorTorso: 0});
  });
});

describe('armor through the hit pipeline (player/hits.ts armorFor)', () => {
  it('vest takes 20 % off torso hits, hard hat 25 % off head hits, limbs are not armored', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('armor_vest', 1));
    inv.add(inv.makeStack('helmet', 1));
    const m = mods(inv);
    const hit = (location: 'head' | 'torso' | 'arm' | 'leg') => armorFor({amount: 10, source: 'zombie', location}, m.armorHead, m.armorTorso);
    expect(hit('torso').applied).toBeCloseTo(8, 10);
    expect(hit('torso').absorbed).toBeCloseTo(2, 10);
    expect(hit('head').applied).toBeCloseTo(7.5, 10);
    expect(hit('arm').applied).toBe(10);
    expect(hit('leg').applied).toBe(10);
    inv.takeOff('chest');
    const bare = mods(inv);
    expect(armorFor({amount: 10, source: 'zombie', location: 'torso'}, bare.armorHead, bare.armorTorso).applied).toBe(10);
  });
});

describe('gear slots: validation and refusals', () => {
  it('a gear slot takes only its own gear; a backpack never goes into the quick slots / pockets', () => {
    const inv = new Inventory();
    const hat = inv.makeStack('helmet', 1), med = inv.makeStack('medkit', 1), bag = inv.makeStack('backpack', 1);
    inv.set(P(0), hat);
    inv.set(P(1), med);
    expect(inv.moveCount(P(0), G('chest'))).toBe('refused');
    expect(inv.refusal?.code).toBe('wrong-slot');
    expect(inv.refusal?.text).toMatch(/head slot/);
    expect(inv.moveCount(P(1), G('helmet'))).toBe('refused');
    expect(inv.refusal?.code).toBe('not-gear');
    inv.set(P(2), bag);
    expect(inv.get(P(2))).toBeNull(); // raw write refused
    expect(inv.refusal?.code).toBe('bag-not-pocketable');
    inv.set(G('backpack'), bag);
    expect(inv.worn('backpack')).toBe(bag);
    expect(inv.moveCount(G('backpack'), P(3))).toBe('refused');
    expect(inv.moveCount(G('backpack'), H(2))).toBe('refused');
    expect(inv.takeOff('backpack')).toBe('refused');
    expect(inv.detach(G('backpack'))).toBeNull(); // only the gear system sets it down (opts.bag)
    expect(inv.worn('backpack')).toBe(bag);
    const second = inv.makeStack('backpack', 1);
    expect(inv.add(second)).toBe(1); // a second bag is refused, never pocketed
    expect(inv.find(second.uid)).toBeNull();
    expect(inv.hasRoomFor('backpack')).toBe(false);
    // a helmet dragged onto the worn hat slot from the pockets swaps; a medkit onto it is refused (the hat stays)
    expect(inv.moveCount(P(0), G('helmet'))).toBe('moved');
    expect(inv.moveCount(P(1), G('helmet'))).toBe('refused');
    expect(inv.worn('helmet')).toBe(hat);
    expect(inv.invariants()).toEqual([]);
  });

  it('picked-up gear is worn when its slot is empty (else pocketed); wear:false never wears', () => {
    const inv = new Inventory();
    const g1 = inv.makeStack('gloves', 1), g2 = inv.makeStack('gloves', 1);
    expect(inv.add(g1)).toBe(0);
    expect(inv.worn('gloves')).toBe(g1);
    expect(inv.add(g2)).toBe(0);
    expect(inv.find(g2.uid)?.bar).toBe('pack'); // gear goes to the pockets first
    const hat = inv.makeStack('helmet', 1);
    expect(inv.add(hat, {wear: false})).toBe(0);
    expect(inv.worn('helmet')).toBeNull();
    expect(inv.invariants()).toEqual([]);
  });
});

describe('chest rig: dynamic pockets, refused removal, nothing lost', () => {
  const setup = () => {
    const inv = new Inventory();
    const rig = inv.makeStack('chest_rig', 1);
    expect(inv.add(rig)).toBe(0);
    for (let i = 0; i < PACK_SIZE; i++) inv.set(P(i), inv.makeStack('bandage', 1));
    const extra = inv.makeStack('ammo_9mm', 30);
    inv.set(P(13), extra);
    return {inv, rig, extra};
  };

  it('wearing it grows the pockets to 16 in place; extra pockets hold items', () => {
    const {inv, extra} = setup();
    expect(inv.capacity).toBe(16);
    expect(inv.pack.length).toBe(16);
    expect(inv.get(P(13))).toBe(extra);
    expect(inv.invariants()).toEqual([]);
  });

  it('take off / drag out / drop / swap for a vest are REFUSED while an extra pocket holds something', () => {
    const {inv, rig, extra} = setup();
    const before = JSON.stringify(inv.toJSON());
    expect(inv.takeOff('chest')).toBe('refused');
    expect(inv.refusal?.code).toBe('pockets-occupied'); // the extra pocket is the reason, even with the base pockets full
    inv.set(P(0), null); // free a base pocket
    expect(inv.takeOff('chest')).toBe('refused');
    expect(inv.refusal?.code).toBe('pockets-occupied');
    expect(inv.refusal?.text).toMatch(/13–16/);
    expect(inv.moveCount(G('chest'), P(0))).toBe('refused');
    expect(inv.moveCount(G('chest'), P(14))).toBe('refused'); // into its own vanishing pocket
    expect(inv.detach(G('chest'))).toBeNull();
    expect(inv.remove(G('chest'))).toBeNull();
    inv.set(G('chest'), null);
    expect(inv.worn('chest')).toBe(rig);
    const vest = inv.makeStack('armor_vest', 1);
    inv.set(P(0), vest);
    expect(inv.moveCount(P(0), G('chest'))).toBe('refused'); // the vest would shrink the pockets over the 9 mm
    expect(inv.worn('chest')).toBe(rig);
    expect(inv.get(P(13))).toBe(extra);
    expect(inv.pack.length).toBe(16);
    expect(JSON.stringify(inv.toJSON())).not.toBe(before);
    expect(inv.invariants()).toEqual([]);
  });

  it('once the extra pockets are empty the rig comes off and the pockets shrink back to 12 (nothing dropped)', () => {
    const {inv, rig, extra} = setup();
    inv.set(P(0), null);
    expect(inv.moveCount(P(13), P(0))).toBe('moved');
    expect(inv.get(P(0))).toBe(extra);
    expect(inv.moveCount(G('chest'), P(15))).toBe('refused'); // still not into an extra pocket
    // swap with a vest from a base pocket: allowed now
    inv.set(P(5), null);
    const vest = inv.makeStack('armor_vest', 1);
    inv.set(P(5), vest);
    expect(inv.moveCount(P(5), G('chest'))).toBe('swapped');
    expect(inv.worn('chest')).toBe(vest);
    expect(inv.get(P(5))).toBe(rig);
    expect(inv.pack.length).toBe(PACK_SIZE);
    expect(inv.count('ammo_9mm')).toBe(30);
    expect(inv.count('bandage')).toBe(PACK_SIZE - 2);
    expect(inv.invariants()).toEqual([]);
  });

  it('a vest from an EXTRA pocket cannot replace the rig (the rig would land in a vanishing pocket)', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('chest_rig', 1));
    const vest = inv.makeStack('armor_vest', 1);
    inv.set(P(14), vest);
    expect(inv.moveCount(P(14), G('chest'))).toBe('refused');
    expect(inv.refusal?.code).toBe('pockets-occupied');
    expect(inv.get(P(14))).toBe(vest);
    expect(inv.invariants()).toEqual([]);
  });
});

describe('inventory snapshots (lane RUN: carryover / Retry level)', () => {
  const sample = () => {
    const inv = new Inventory();
    inv.set(H(0), inv.makeStack('pistol', 1, 7));
    inv.add(inv.makeStack('ammo_9mm', 45));
    inv.add(inv.makeStack('chest_rig', 1));
    inv.add(inv.makeStack('helmet', 1));
    inv.set(P(14), inv.makeStack('bandage', 3));
    const bag = inv.makeStack('backpack', 1);
    bag.bag![2] = inv.makeStack('medkit', 2);
    bag.bag![7] = inv.makeStack('shotgun', 1, 3);
    inv.set(G('backpack'), bag);
    inv.select(0);
    return inv;
  };

  it('toJSON / fromJSON / clone are deep, keep uids, mags, gear, pockets and bag contents; nextUid stays above every uid', () => {
    const inv = sample();
    const j = inv.toJSON();
    expect(j.v).toBe(2); // task office-overhaul-20261030 (INTERACT): v2 adds the grenade slot (v1 still loads: throwable-slot.test.ts)
    expect(j.throw).toEqual([null]);
    expect(j.pack.length).toBe(16);
    expect(j.gear.backpack?.bag?.[7]?.mag).toBe(3);
    const c = inv.clone(), f = Inventory.fromJSON(JSON.parse(JSON.stringify(j)));
    for (const x of [c, f]) {
      expect(x.toJSON()).toEqual(j);
      expect(x.invariants()).toEqual([]);
      expect(x.worn('backpack')).not.toBe(inv.worn('backpack')); // deep
      expect(x.worn('backpack')!.bag).not.toBe(inv.worn('backpack')!.bag);
      expect(x.version).not.toBe(inv.version); // a swapped-in inventory always redraws
      const fresh = x.makeStack('water', 1);
      const all = x.allStacks(true).map(s => s.uid);
      expect(all).not.toContain(fresh.uid);
      expect(fresh.uid).toBeGreaterThan(Math.max(...all));
    }
    // mutating the copy never touches the original
    c.worn('backpack')!.bag![2]!.count = 1;
    c.take('ammo_9mm', 10);
    expect(inv.worn('backpack')!.bag![2]!.count).toBe(2);
    expect(inv.count('ammo_9mm')).toBe(45);
  });

  it('loadJSON restores in place (same object, same arrays) and resizes the pockets to the snapshot gear', () => {
    const inv = sample();
    const j = inv.toJSON();
    const live = new Inventory();
    const pack = live.pack, hot = live.hotbar;
    live.loadJSON(j);
    expect(live.pack).toBe(pack);
    expect(live.hotbar).toBe(hot);
    expect(live.toJSON()).toEqual(j);
    const bare = new Inventory().toJSON();
    live.loadJSON(bare);
    expect(live.pack.length).toBe(PACK_SIZE);
    expect(live.worn('chest')).toBeNull();
    expect(live.invariants()).toEqual([]);
  });

  it('a malformed snapshot never loses items silently (strays go back in through add)', () => {
    const inv = sample();
    const j = inv.toJSON();
    j.gear.chest = null; // pockets 13-16 now beyond capacity: the bandage there must survive
    const r = Inventory.fromJSON(j);
    expect(r.count('bandage')).toBe(3);
    expect(r.invariants()).toEqual([]);
  });
});

describe('gear world models (gear/models.ts)', () => {
  const fakeGltf = (w: number, h: number, d: number, y0 = 0) => {
    const scene = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
    m.position.set(0.1, y0 + h / 2, -0.05);
    // a marker on the derivative's FRONT (-Z) to check the half turn to the item frame's +Z
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshStandardMaterial());
    front.name = 'front';
    front.position.set(0.1, y0 + h / 2, -0.05 - d / 2 - 0.01);
    scene.add(m, front);
    return {scene} as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF;
  };

  it('a delivered derivative is grounded, centred, turned front +Z and kept at real size', () => {
    registerGearModel('boots', fakeGltf(0.3, 0.19, 0.32, 0.4));
    try {
      const t = gearItemModel('boots');
      t.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(t);
      expect(box.min.y).toBeCloseTo(0, 5);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
      expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
      expect(box.max.y - box.min.y).toBeCloseTo(0.19, 5);
      const f = new THREE.Vector3();
      t.getObjectByName('front')!.getWorldPosition(f);
      expect(f.z).toBeGreaterThan(0.1);
      expect(gearModelSource('boots')).toMatch(/Meshy T2.5/);
      // a grossly mis-scaled file (10x) is fitted to the item's resting size
      registerGearModel('boots', fakeGltf(3, 1.9, 3.2));
      const big = new THREE.Box3().setFromObject(gearItemModel('boots'));
      expect(big.max.x - big.min.x).toBeLessThan(0.4);
    } finally {
      registerGearModel('boots', null);
    }
    expect(gearModelSource('boots')).toMatch(/procedural/);
  });

  it('every gear item has a procedural stand-in (missing / failed derivative) resting on the floor', () => {
    for (const id of Object.keys(GEAR_ITEMS)) {
      const t = gearItemModel(id);
      const box = new THREE.Box3().setFromObject(t);
      expect(box.isEmpty()).toBe(false);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.005);
      expect(box.max.y).toBeLessThan(0.7);
    }
  });
});
