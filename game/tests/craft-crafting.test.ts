// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE ATOMIC CRAFT (craft/crafting.ts) — the four material sources in
// their fixed order (carried, the worn backpack, the Lockbox, the chests aboard), the exact plan / debit / refund, and the transaction's
// refusals (missing materials, the equipment system refusing, the unexpected null) that leave every stack and count untouched. Pure:
// real Inventory / TrainLockbox objects and a fake equipment system (tests/helpers/craftBenchFakes.ts).
import {describe, expect, it} from 'vitest';
import {
  CRAFT_TEXT, applyCraft, carriedSource, countMaterials, craft, craftSources, missingText, planCraft, refundCraft, type CraftPlan,
  type MaterialSource,
} from '../src/craft/crafting';
import {EQUIPMENT, EQUIPMENT_KINDS} from '../src/craft/equipment';
import {RECIPES, RECIPE_MATERIALS, recipeFor, type Recipe} from '../src/craft/recipes';
import {BIO_MATER, ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {GEAR_SLOTS} from '../src/items/gear';
import {Inventory, type ItemStack} from '../src/items/inventory';
import {TrainLockbox} from '../src/run/trainLockbox';
import {fakeEquipment, fakeStore, worldSnapshot} from './helpers/craftBenchFakes';

const R = (kind: (typeof EQUIPMENT_KINDS)[number]): Recipe => recipeFor(kind)!;

/**
 * A stocked world: scrap 5 carried (3 in a pocket, 2 in a quick slot) + 5 in the Lockbox + 2 in chest eq-2 = 12; electrical 4 in the
 * worn backpack + 1 in the Lockbox + 6 in chest eq-10 = 11. Other things lie about that no craft may ever touch.
 */
function world() {
  const inv = new Inventory();
  const P = (index: number) => ({bar: 'pack' as const, index});
  const scrapPocket = inv.makeStack(SCRAP_METAL, 3), scrapQuick = inv.makeStack(SCRAP_METAL, 2);
  inv.set(P(4), scrapPocket);
  inv.set({bar: 'hotbar', index: 1}, scrapQuick);
  const pistol = inv.makeStack('pistol', 1), bandage = inv.makeStack('bandage', 2), bio = inv.makeStack(BIO_MATER, 3);
  inv.set({bar: 'hotbar', index: 0}, pistol);
  inv.set(P(0), bandage);
  inv.set(P(1), bio);
  const bag = inv.makeStack('backpack', 1);
  expect(inv.wearBag(bag)).toBe(true);
  const elecBag = inv.makeStack(ELECTRICAL_PARTS, 4), ammoBag = inv.makeStack('ammo_9mm', 12);
  bag.bag![2] = elecBag;
  bag.bag![0] = ammoBag;
  const box = new TrainLockbox();
  const scrapBox = inv.makeStack(SCRAP_METAL, 5), elecBox = inv.makeStack(ELECTRICAL_PARTS, 1), bioBox = inv.makeStack(BIO_MATER, 2);
  box.slots[3] = scrapBox;
  box.slots[7] = elecBox;
  box.slots[9] = bioBox;
  // (handed over in the "wrong" order on purpose: the sources sort the chests by unit number, eq-2 before eq-10)
  const c10 = fakeStore('eq-10'), c2 = fakeStore('eq-2');
  const elecChest = inv.makeStack(ELECTRICAL_PARTS, 6), scrapChest = inv.makeStack(SCRAP_METAL, 2);
  c10.slots[0] = elecChest;
  c2.slots[49] = scrapChest;
  const sources = () => craftSources({inv, lockbox: box, stores: [c10, c2]});
  const snap = () => worldSnapshot(inv, [box.slots, c2.slots, c10.slots]);
  const versions = () => ({inv: inv.version, box: box.version, c2: c2.touched, c10: c10.touched});
  return {inv, bag, box, c2, c10, sources, snap, versions,
    stacks: {scrapPocket, scrapQuick, pistol, bandage, bio, elecBag, ammoBag, scrapBox, elecBox, bioBox, elecChest, scrapChest}};
}

const total = (src: readonly MaterialSource[]) => {
  const c = countMaterials(src);
  return {scrap: c[SCRAP_METAL].total, elec: c[ELECTRICAL_PARTS].total};
};

describe('crafting: the four material sources, in their fixed order', () => {
  it('carried, the worn backpack, the Lockbox, then every chest aboard by unit number', () => {
    const w = world(), src = w.sources();
    expect(src.map(s => [s.kind, s.id])).toEqual([['carried', 'carried'], ['backpack', 'backpack'], ['lockbox', 'lockbox'], ['chest', 'chest:eq-2'], ['chest', 'chest:eq-10']]);
    const c = countMaterials(src);
    expect(Object.keys(c)).toEqual([...RECIPE_MATERIALS]);
    expect(c[SCRAP_METAL]).toMatchObject({total: 12, carried: 5, backpack: 0, lockbox: 5, chests: 2});
    expect(c[ELECTRICAL_PARTS]).toMatchObject({total: 11, carried: 0, backpack: 4, lockbox: 1, chests: 6});
    expect(c[SCRAP_METAL].sources).toEqual([
      {id: 'carried', kind: 'carried', n: 5}, {id: 'backpack', kind: 'backpack', n: 0}, {id: 'lockbox', kind: 'lockbox', n: 5},
      {id: 'chest:eq-2', kind: 'chest', n: 2}, {id: 'chest:eq-10', kind: 'chest', n: 0},
    ]);
    expect(c[ELECTRICAL_PARTS].sources.map(s => s.n)).toEqual([0, 4, 1, 0, 6]);
    // counting changes nothing
    const before = w.snap(), v = w.versions();
    countMaterials(w.sources());
    expect(w.snap()).toEqual(before);
    expect(w.versions()).toEqual(v);
  });

  it('no Lockbox / no chest / no backpack worn: those sources are absent or empty, never an error', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack(SCRAP_METAL, 4));
    const src = craftSources({inv});
    expect(src.map(s => s.id)).toEqual(['carried', 'backpack']);
    expect(countMaterials(src)[SCRAP_METAL]).toMatchObject({total: 4, carried: 4, backpack: 0, lockbox: 0, chests: 0});
    expect(src[1].take(SCRAP_METAL, 2, [])).toBe(0); // (no bag: nothing to draw)
    // a worn airtank is not a bag: no contents
    const tank = inv.makeStack('airtank_backpack', 1);
    inv.set({bar: 'gear', index: GEAR_SLOTS.indexOf('backpack')}, tank);
    expect(inv.worn('backpack')).toBe(tank);
    expect(inv.wornBag()).toBeNull();
    expect(countMaterials(craftSources({inv}))[SCRAP_METAL].backpack).toBe(0);
  });

  it('a backpack STORED in the Lockbox (or a chest) is out of reach: its contents are not counted or drawn (v1)', () => {
    const inv = new Inventory(), box = new TrainLockbox(), chest = fakeStore('eq-1');
    const stored = inv.makeStack('backpack', 1), stored2 = inv.makeStack('backpack', 1);
    stored.bag![0] = inv.makeStack(SCRAP_METAL, 9);
    stored2.bag![0] = inv.makeStack(SCRAP_METAL, 9);
    box.slots[0] = stored;
    chest.slots[0] = stored2;
    const src = craftSources({inv, lockbox: box, stores: [chest]});
    expect(countMaterials(src)[SCRAP_METAL].total).toBe(0);
    const plan = planCraft(R('chest'), src);
    expect(plan).toEqual({ok: false, missing: {[SCRAP_METAL]: 2}});
    expect(stored.bag![0]!.count).toBe(9);
  });
});

describe('crafting: the plan — carried first, then the backpack, the Lockbox, the chests', () => {
  it('the sentry (8 scrap / 6 electrical) over the stocked world', () => {
    const w = world();
    const plan = planCraft(R('sentry'), w.sources());
    expect(plan).toEqual({ok: true, kind: 'sentry', takes: [
      {source: 'carried', kind: 'carried', material: SCRAP_METAL, n: 5},
      {source: 'lockbox', kind: 'lockbox', material: SCRAP_METAL, n: 3},
      {source: 'backpack', kind: 'backpack', material: ELECTRICAL_PARTS, n: 4},
      {source: 'lockbox', kind: 'lockbox', material: ELECTRICAL_PARTS, n: 1},
      {source: 'chest:eq-10', kind: 'chest', material: ELECTRICAL_PARTS, n: 1},
    ]});
  });

  it('a zero cost draws nothing; a shortfall names exactly how many more of each material', () => {
    const w = world();
    const chest = planCraft(R('chest'), w.sources()) as CraftPlan;
    expect(chest.takes).toEqual([{source: 'carried', kind: 'carried', material: SCRAP_METAL, n: 2}]); // (no electrical line at all)
    const inv = new Inventory();
    inv.add(inv.makeStack(SCRAP_METAL, 5));
    inv.add(inv.makeStack(ELECTRICAL_PARTS, 1));
    const src = craftSources({inv});
    expect(planCraft(R('sentry'), src)).toEqual({ok: false, missing: {[SCRAP_METAL]: 3, [ELECTRICAL_PARTS]: 5}});
    expect(planCraft(R('radar'), src)).toEqual({ok: false, missing: {[ELECTRICAL_PARTS]: 2}}); // (only what is short)
    expect(missingText({[SCRAP_METAL]: 3, [ELECTRICAL_PARTS]: 5})).toBe('Need 3 more Scrap metal and 5 more Electrical parts');
    expect(missingText({[ELECTRICAL_PARTS]: 2})).toBe('Need 2 more Electrical parts');
    expect(missingText({})).toBe('');
  });
});

describe('crafting: the debit is exact', () => {
  it('stacks are reduced or removed; every other stack, uid, slot and count is untouched; the touched sources redraw', () => {
    const w = world(), S = w.stacks, src = w.sources();
    const uids = Object.fromEntries(Object.entries(S).map(([k, s]) => [k, s.uid]));
    const v0 = w.versions();
    const plan = planCraft(R('sentry'), src) as CraftPlan;
    const receipt = applyCraft(plan, src)!;
    expect(receipt).not.toBeNull();
    // carried: both scrap stacks used up -> their slots are empty
    expect(w.inv.pack[4]).toBeNull();
    expect(w.inv.hotbar[1]).toBeNull();
    expect(w.inv.count(SCRAP_METAL)).toBe(0);
    // the Lockbox's scrap stack is REDUCED in place (same object, same uid, same slot); its electrical stack is used up
    expect(w.box.slots[3]).toBe(S.scrapBox);
    expect(S.scrapBox.count).toBe(2);
    expect(w.box.slots[7]).toBeNull();
    // the backpack's electrical stack is used up; chest eq-10's is reduced in place; chest eq-2 is not touched at all
    expect(w.bag.bag![2]).toBeNull();
    expect(w.c10.slots[0]).toBe(S.elecChest);
    expect(S.elecChest.count).toBe(5);
    expect(w.c2.slots[49]).toBe(S.scrapChest);
    expect(S.scrapChest.count).toBe(2);
    // nothing else moved or changed
    expect(w.inv.hotbar[0]).toBe(S.pistol);
    expect(w.inv.pack[0]).toBe(S.bandage);
    expect(S.bandage.count).toBe(2);
    expect(w.inv.pack[1]).toBe(S.bio);
    expect(S.bio.count).toBe(3);
    expect(w.bag.bag![0]).toBe(S.ammoBag);
    expect(S.ammoBag.count).toBe(12);
    expect(w.box.slots[9]).toBe(S.bioBox);
    expect(S.bioBox.count).toBe(2);
    for (const [k, s] of Object.entries(S)) expect(s.uid, k).toBe(uids[k]);
    expect(w.inv.invariants()).toEqual([]);
    expect(total(w.sources())).toEqual({scrap: 12 - 8, elec: 11 - 6});
    // versions: the inventory (carried + backpack), the Lockbox and chest eq-10 redraw; chest eq-2 does not
    const v1 = w.versions();
    expect(v1.inv).toBeGreaterThan(v0.inv);
    expect(v1.box).toBeGreaterThan(v0.box);
    expect(v1.c10).toBe(v0.c10 + 1);
    expect(v1.c2).toBe(v0.c2);
    expect(receipt.touched.map(s => s.id)).toEqual(['carried', 'lockbox', 'backpack', 'chest:eq-10']);
  });

  it('partial stacks: a draw smaller than a stack leaves the rest in place; several stacks drain from the last slot first', () => {
    const inv = new Inventory();
    const a = inv.makeStack(SCRAP_METAL, 20), b = inv.makeStack(SCRAP_METAL, 20), c = inv.makeStack(SCRAP_METAL, 3);
    inv.set({bar: 'pack', index: 2}, a);
    inv.set({bar: 'pack', index: 5}, b);
    inv.set({bar: 'pack', index: 9}, c);
    const src = craftSources({inv});
    expect(applyCraft(planCraft(R('chest'), src) as CraftPlan, src)).not.toBeNull(); // 2: from the last stack
    expect([a.count, b.count, c.count]).toEqual([20, 20, 1]);
    expect(planCraft(R('scanner'), craftSources({inv}))).toEqual({ok: false, missing: {[ELECTRICAL_PARTS]: 5}}); // (no electrical: no plan)
    expect([a.count, b.count, c.count]).toEqual([20, 20, 1]);
    inv.add(inv.makeStack(ELECTRICAL_PARTS, 20));
    const src2 = craftSources({inv});
    expect(applyCraft(planCraft(R('sentry'), src2) as CraftPlan, src2)).not.toBeNull(); // 8: the last stack's 1, then 7 of the next
    expect(inv.pack[9]).toBeNull();
    expect([a.count, b.count]).toEqual([20, 13]);
    expect(inv.pack[5]).toBe(b);
    expect(inv.pack[2]).toBe(a);
    expect(inv.count(ELECTRICAL_PARTS)).toBe(14);
    // the same order in a plain slot list (a chest): the last matching slot first
    const chest = fakeStore('eq-1');
    const x = inv.makeStack(SCRAP_METAL, 4), y = inv.makeStack(SCRAP_METAL, 1);
    chest.slots[1] = x;
    chest.slots[30] = y;
    const src3 = craftSources({inv: new Inventory(), stores: [chest]});
    expect(applyCraft(planCraft(R('chest'), src3) as CraftPlan, src3)).not.toBeNull();
    expect(chest.slots[30]).toBeNull();
    expect(chest.slots[1]).toBe(x);
    expect(x.count).toBe(3);
    expect(chest.touched).toBe(1);
  });

  it('refundCraft puts every unit back into the same stack objects at the same slots; a stale plan changes nothing', () => {
    const w = world(), before = w.snap();
    const src = w.sources();
    const plan = planCraft(R('sentry'), src) as CraftPlan;
    const receipt = applyCraft(plan, src)!;
    expect(w.snap().json).not.toBe(before.json);
    refundCraft(receipt);
    const after = w.snap();
    expect(after.json).toBe(before.json);
    expect(after.refs.length).toBe(before.refs.length);
    after.refs.forEach((s, i) => expect(s, `slot ${i}`).toBe(before.refs[i]));
    expect(w.inv.invariants()).toEqual([]);
    // a plan made before the world changed: the second half cannot be drawn -> everything already drawn is put back
    w.box.slots[7] = null; // (the Lockbox's electrical part is gone)
    w.c10.slots[0] = null; // (and the chest's)
    const stale = w.snap();
    expect(applyCraft(plan, w.sources())).toBeNull();
    const still = w.snap();
    expect(still.json).toBe(stale.json);
    still.refs.forEach((s, i) => expect(s, `slot ${i}`).toBe(stale.refs[i]));
  });

  it('the carried source reports exactly the stacks Inventory.take changed', () => {
    const inv = new Inventory();
    const a = inv.makeStack(SCRAP_METAL, 6), b = inv.makeStack(SCRAP_METAL, 2), q = inv.makeStack(SCRAP_METAL, 5);
    inv.set({bar: 'pack', index: 0}, a);
    inv.set({bar: 'pack', index: 3}, b);
    inv.set({bar: 'hotbar', index: 2}, q);
    const undo: {list: (ItemStack | null)[]; index: number; stack: ItemStack; count: number}[] = [];
    expect(carriedSource(inv).take(SCRAP_METAL, 5, undo)).toBe(5); // pockets first (last slot first): b's 2, then 3 of a
    expect(undo.map(u => [u.stack, u.index, u.count])).toEqual([[a, 0, 6], [b, 3, 2]]);
    expect([a.count, q.count, inv.pack[3]]).toEqual([3, 5, null]);
    expect(carriedSource(inv).take(SCRAP_METAL, 0, undo)).toBe(0);
    expect(undo.length).toBe(2);
  });
});

describe('crafting: the atomic transaction', () => {
  it('missing materials: refused with the list, nothing changes, the equipment system is never asked to build', () => {
    const w = world(), eq = fakeEquipment();
    // drain the electrical parts so the sentry is 6 short... leave exactly 2
    w.bag.bag![2] = null;
    w.box.slots[7] = null;
    w.stacks.elecChest.count = 2;
    const before = w.snap(), v = w.versions();
    const r = craft(R('sentry'), {sources: w.sources(), equipment: eq});
    expect(r).toEqual({ok: false, reason: 'missing', text: 'Need 4 more Electrical parts', missing: {[ELECTRICAL_PARTS]: 4}});
    const after = w.snap();
    expect(after.json).toBe(before.json);
    after.refs.forEach((s, i) => expect(s, `slot ${i}`).toBe(before.refs[i]));
    expect(w.versions()).toEqual(v);
    expect(eq.calls.craft).toEqual([]);
    expect(eq.made).toEqual([]);
  });

  it('the equipment system refusing (no room / the train moving): refused with ITS text, nothing changes', () => {
    for (const text of ['No room on the car floor — move something first', 'Not while the train is moving']) {
      const w = world(), eq = fakeEquipment();
      eq.block = text;
      const before = w.snap(), v = w.versions();
      const r = craft(R('radar'), {sources: w.sources(), equipment: eq});
      expect(r).toEqual({ok: false, reason: 'blocked', text});
      const after = w.snap();
      expect(after.json).toBe(before.json);
      after.refs.forEach((s, i) => expect(s, `slot ${i}`).toBe(before.refs[i]));
      expect(w.versions()).toEqual(v);
      expect(eq.calls).toEqual({block: ['radar'], craft: []}); // (the block is checked BEFORE any debit; craft() is never reached)
    }
  });

  it('craft() unexpectedly returning null: the exact materials are put back (same stacks, slots, counts) and the craft is refused', () => {
    const w = world(), eq = fakeEquipment();
    eq.failCraft = true;
    const before = w.snap();
    const r = craft(R('sentry'), {sources: w.sources(), equipment: eq});
    expect(r).toEqual({ok: false, reason: 'failed', text: CRAFT_TEXT.failed});
    const after = w.snap();
    expect(after.json).toBe(before.json);
    after.refs.forEach((s, i) => expect(s, `slot ${i}`).toBe(before.refs[i]));
    expect(total(w.sources())).toEqual({scrap: 12, elec: 11});
    expect(w.inv.invariants()).toEqual([]);
    expect(eq.calls.craft).toEqual(['sentry']);
    expect(eq.made).toEqual([]);
    // ... and a throwing craft() likewise (the error is handed back, never swallowed silently)
    eq.failCraft = false;
    eq.throwCraft = true;
    const r2 = craft(R('scanner'), {sources: w.sources(), equipment: eq});
    expect(r2.ok).toBe(false);
    expect(r2).toMatchObject({reason: 'failed', text: CRAFT_TEXT.failed});
    expect((r2 as {error?: Error}).error?.message).toBe('fake craft failure');
    const again = w.snap();
    expect(again.json).toBe(before.json);
    again.refs.forEach((s, i) => expect(s, `slot ${i}`).toBe(before.refs[i]));
  });

  it('the four recipes at the approved costs make exactly one unit each; the materials go down by exactly the cost', () => {
    // exactly the sum of the four costs (19 scrap / 14 electrical), spread over all four sources
    expect(RECIPES.reduce((n, r) => n + r.cost[SCRAP_METAL], 0)).toBe(19);
    expect(RECIPES.reduce((n, r) => n + r.cost[ELECTRICAL_PARTS], 0)).toBe(14);
    const inv = new Inventory(), box = new TrainLockbox(), chest = fakeStore('eq-900'), eq = fakeEquipment();
    inv.add(inv.makeStack(SCRAP_METAL, 6));
    inv.add(inv.makeStack(ELECTRICAL_PARTS, 2));
    const bag = inv.makeStack('backpack', 1);
    inv.wearBag(bag);
    bag.bag![0] = inv.makeStack(SCRAP_METAL, 4);
    bag.bag![1] = inv.makeStack(ELECTRICAL_PARTS, 5);
    box.slots[0] = inv.makeStack(SCRAP_METAL, 7);
    box.slots[1] = inv.makeStack(ELECTRICAL_PARTS, 3);
    chest.slots[0] = inv.makeStack(SCRAP_METAL, 2);
    chest.slots[1] = inv.makeStack(ELECTRICAL_PARTS, 4);
    const sources = () => craftSources({inv, lockbox: box, stores: [chest]});
    let have = total(sources());
    expect(have).toEqual({scrap: 19, elec: 14});
    for (const r of RECIPES) {
      const res = craft(r, {sources: sources(), equipment: eq});
      expect(res.ok, r.kind).toBe(true);
      if (!res.ok) continue;
      expect(res.unit.kind).toBe(r.kind);
      expect(res.unit.def).toBe(EQUIPMENT[r.kind]);
      expect(res.plan.takes.filter(t => t.material === SCRAP_METAL).reduce((n, t) => n + t.n, 0)).toBe(r.cost[SCRAP_METAL]);
      expect(res.plan.takes.filter(t => t.material === ELECTRICAL_PARTS).reduce((n, t) => n + t.n, 0)).toBe(r.cost[ELECTRICAL_PARTS]);
      const now = total(sources());
      expect(now).toEqual({scrap: have.scrap - r.cost[SCRAP_METAL], elec: have.elec - r.cost[ELECTRICAL_PARTS]});
      have = now;
      expect(inv.invariants()).toEqual([]);
    }
    expect(have).toEqual({scrap: 0, elec: 0});
    expect(eq.made.map(u => u.kind)).toEqual(['chest', 'radar', 'sentry', 'scanner']);
    expect(new Set(eq.made.map(u => u.uid)).size).toBe(4);
    expect(eq.calls.craft).toEqual(['chest', 'radar', 'sentry', 'scanner']); // one call per craft, never a second
    // every stack is gone, nothing is left behind as an empty stack
    expect([...inv.pack, ...inv.hotbar, ...bag.bag!, ...box.slots, ...chest.slots].filter(Boolean)).toEqual([]);
    // ... and now every recipe is refused for materials, with nothing made
    for (const r of RECIPES) expect(craft(r, {sources: sources(), equipment: eq})).toMatchObject({ok: false, reason: 'missing'});
    expect(eq.made.length).toBe(4);
  });

  it('materials are never created: over a long mixed run of crafts and refusals, what is left + what was spent = what there was', () => {
    const w = world(), eq = fakeEquipment();
    // top the stocked world up so several crafts fit
    w.box.slots[20] = w.inv.makeStack(SCRAP_METAL, 20);
    w.box.slots[21] = w.inv.makeStack(ELECTRICAL_PARTS, 20);
    const start = total(w.sources()), spent = {scrap: 0, elec: 0};
    const others = () => JSON.stringify([w.stacks.pistol, w.stacks.bandage, w.stacks.bio, w.stacks.ammoBag, w.stacks.bioBox]);
    const untouched = others();
    let ok = 0, refused = 0;
    for (let i = 0; i < 40; i++) {
      const r = RECIPES[(i * 7 + 3) % RECIPES.length];
      eq.block = i % 5 === 4 ? 'No room on the car floor — move something first' : null;
      eq.failCraft = i % 9 === 8;
      const res = craft(r, {sources: w.sources(), equipment: eq});
      if (res.ok) { ok++; spent.scrap += r.cost[SCRAP_METAL]; spent.elec += r.cost[ELECTRICAL_PARTS]; } else refused++;
      const now = total(w.sources());
      expect(now.scrap + spent.scrap, `step ${i}`).toBe(start.scrap);
      expect(now.elec + spent.elec, `step ${i}`).toBe(start.elec);
      expect(now.scrap).toBeGreaterThanOrEqual(0);
      expect(now.elec).toBeGreaterThanOrEqual(0);
    }
    expect(ok).toBeGreaterThan(3);
    expect(refused).toBeGreaterThan(10);
    expect(eq.made.length).toBe(ok); // exactly one unit per successful craft
    expect(others()).toBe(untouched); // weapons, medicine, ammo and Bio mater are never drawn
    expect(w.inv.invariants()).toEqual([]);
  });
});
