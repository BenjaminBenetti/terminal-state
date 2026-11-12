// Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): the twelve new weapons as ITEMS and as diversified WEAPON FINDS
// (items/weaponVarietyItems.ts, items/weaponVariety.ts, world/weaponVarietyModels.ts, game.ts buildSection's first spawn).
// Task studio-weapon-poses-slot-hierarchy-20261110-064835-01 (USER's new design, superseding the 40 / ~42 / 18 split and the "same rounds
// per caliber" rule for new rolls): a WEAPON slot is 50 % gun (9 equal) / 50 % melee (7 equal, the knife included), a gun store's find is
// a GUN slot (9 equal), and the paired ammo MATCHES the selected gun at the same normalized budget (one standard bundle per find).
//  - census over real generated layouts of every level: the weapon find COUNT identical, every other pickup identical, every find's
//    normalized ammo budget 1.0 before and after (raw rounds per caliber recorded), gun-store finds never melee, every leaf reachable
//    (written to /tmp/weapon-variety-loot/census.json);
//  - the ammo rule (own caliber, magazine cap, the coach gun <= 2, a melee result's box keeps the whole source bundle);
//  - eligibility and fit (the delivered catalogue; a display host's length; a long floor find laid across its box — never a fallback);
//  - persistence through run/worldMemory (an old record keeps its items, a revisit is identical, a new area is diversified);
//  - the common paths accept the twelve (inventory / melee slot, save validation incl. Lockbox / cargo / memory, uid cloning, trade
//    value) and vendor stock keeps its baseline weapon rows.
// The variety WeaponDefs are lanes GUNS / MELEE's: until they are merged the two def modules are mocked as {...stand-ins, ...real}
// (tests/helpers/weaponVarietyStandins.ts) — the real defs always win, and every rule here reads capacities through WEAPONS.
import {describe, expect, it, vi} from 'vitest';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';

vi.mock('../src/weapons/varietyGuns', async importOriginal => {
  const real = await importOriginal<typeof import('../src/weapons/varietyGuns')>();
  const {gunStandins} = await import('./helpers/weaponVarietyStandins');
  return {...real, VARIETY_GUN_DEFS: {...gunStandins(), ...real.VARIETY_GUN_DEFS}};
});
vi.mock('../src/weapons/varietyMelee', async importOriginal => {
  const real = await importOriginal<typeof import('../src/weapons/varietyMelee')>();
  const {meleeStandins} = await import('./helpers/weaponVarietyStandins');
  return {...real, VARIETY_MELEE_DEFS: {...meleeStandins(), ...real.VARIETY_MELEE_DEFS}};
});

import {ITEMS, itemDef} from '../src/items/items';
import {ICONS} from '../src/ui/icons';
import {WEAPONS} from '../src/weapons/weapons';
import {VARIETY_GUN_IDS, VARIETY_MELEE_IDS, VARIETY_WEAPONS, VARIETY_WEAPON_IDS, isVarietyWeapon} from '../src/weapons/varietyIds';
import {VARIETY_WEAPON_ITEMS} from '../src/items/weaponVarietyItems';
import {WEAPON_VARIETY_MODELS} from '../src/assets/weaponVarietyModels.generated';
import {
  BASELINE_GUNS, BOX_CLEAR_M, GUN_CATEGORIES, GUN_LEAVES, HOST_MAX_M, MELEE_LEAVES, WEAPON_SLOT_SPLIT, caliberBundle, familyBundle, gunAmmo,
  identityAvailable, isGunStoreArea, pairedBox, plannedVarietyIds, slotKindOf, slotRows, varietyIdsIn, weaponFindPlan, weaponLength,
  type BaselineGun, type WeaponFindOptions,
} from '../src/items/weaponVariety';
import {WEAPON_FIND_AMMO} from '../src/gen/weaponFinds';
import {ammoItemFor} from '../src/items/calibers';
import {pantryPickupItem} from '../src/items/pantryVariety';
import {Inventory, MELEE_REF, isMeleeItem} from '../src/items/inventory';
import {LEVEL_IDS, LEVELS} from '../src/levels/registry';
import {sectionId, type LevelId} from '../src/levels/types';
import type {PickupPlacement, StationLayout} from '../src/gen/stationTypes';
import {pickupPlan} from '../src/run/memory';
import {capturePickups, restorePickup, stackRecord} from '../src/run/worldMemory';
import {PickupManager} from '../src/world/pickups';
import {WEAPON_VARIETY_WARM_GROUP, registerWeaponVarietyModel, weaponVarietyGltf, weaponVarietyWarmRoots} from '../src/world/weaponVarietyModels';
import {Harness} from './helpers/saveFixture';
import {saveFileText, restoreRun} from '../src/save/serialize';
import {parseSaveText} from '../src/save/validate';
import {baseCents, isTradeable, stackCents} from '../src/market/trade/value';
import {stallDraws} from '../src/market/trade/stock';
import {Rng} from '../src/core/rng';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const OUT = '/tmp/weapon-variety-loot';
/** Every identity this build could realize once the defs and models are all in (the merged build). */
const ALL: WeaponFindOptions = {available: id => !!WEAPONS[id] && !!ITEMS[id]};

/** The stacks a FIRST spawn makes from a layout, exactly as game.ts buildSection does (plan changes, else the food-variety item / count). */
function firstSpawn(layout: StationLayout, level: string, section: string, o: WeaponFindOptions = ALL) {
  const changes = weaponFindPlan(layout, level, section, o).changes;
  return layout.pickups.map((p, i) => {
    const wf = changes.get(i);
    const itemId = wf ? wf.itemId : pantryPickupItem(layout, i, level);
    const def = itemDef(itemId);
    const mag = def.kind === 'weapon' ? (wf ? wf.mag ?? WEAPONS[itemId].magazine : WEAPONS[def.weaponId!].magazine) : undefined;
    return {itemId, count: Math.min(wf ? wf.count : p.count, def.stackMax), mag, reward: p.reward};
  });
}


// ---------------------------------------------------------------------------------------
describe('weapon variety: the twelve ItemDefs', () => {
  it('every variety weapon is an ordinary weapon item: its own id / weaponId / icon, one per slot, a name in the house style, a description', () => {
    expect(Object.keys(VARIETY_WEAPON_ITEMS).sort()).toEqual([...VARIETY_WEAPON_IDS].sort());
    for (const id of VARIETY_WEAPON_IDS) {
      const d = ITEMS[id];
      expect(d, id).toBe(VARIETY_WEAPON_ITEMS[id]);
      expect(d).toMatchObject({id, kind: 'weapon', stackMax: 1, weaponId: id, icon: id});
      expect(d.name, id).toMatch(new RegExp(`^${VARIETY_WEAPONS[id].name} — "[^"]+"$`));
      expect(d.short.length, id).toBeGreaterThan(2);
      expect(d.description.length, id).toBeGreaterThan(60);
      // no new mechanic is promised: no attachments, crafting, prying or digging (user HARD constraint)
      expect(d.description, id).not.toMatch(/attach|craft|\bpr(y|ies|ying)\b|\bdig/i);
      expect(ICONS[d.icon], id).toMatch(/^<svg viewBox="0 0 64 32"/);
    }
  });
  it('the old items keep their catalogue order (the twelve are appended last)', () => {
    const keys = Object.keys(ITEMS);
    expect(keys.slice(-VARIETY_WEAPON_IDS.length)).toEqual([...VARIETY_WEAPON_IDS]);
  });
  it('guns name their caliber family; melee weapons say they need no ammo', () => {
    for (const id of VARIETY_GUN_IDS) expect(ITEMS[id].description, id).toMatch(/9mm|5\.56|12-gauge/);
    for (const id of VARIETY_MELEE_IDS) expect(ITEMS[id].description, id).toMatch(/no ammo/i);
  });
});

// ---------------------------------------------------------------------------------------
describe('weapon variety: the common item paths accept the twelve (no second kind whitelist)', () => {
  it('inventory: a gun loads its own magazine; melee weapons go in the melee slot, guns are refused there; Equip / double-click move them', () => {
    for (const id of VARIETY_WEAPON_IDS) {
      const inv = new Inventory();
      const st = inv.makeStack(id, 1);
      expect(st.mag, id).toBe(WEAPONS[id].magazine);
      expect(isMeleeItem(id), id).toBe(VARIETY_MELEE_IDS.includes(id as never));
      expect(inv.add(st), id).toBe(0);
      if (isMeleeItem(id)) {
        expect(inv.melee?.uid, `${id}: a picked-up melee weapon fills the empty melee slot`).toBe(st.uid);
        // Equip / double-click / Ctrl-click on another melee weapon in the pockets swaps it into the melee slot
        const knife = inv.makeStack('knife', 1);
        inv.set({bar: 'pack', index: 0}, knife);
        expect(inv.equipMeleeFrom({bar: 'pack', index: 0}), id).toBe('swapped');
        expect(inv.melee?.uid).toBe(knife.uid);
        expect(inv.get({bar: 'pack', index: 0})?.uid).toBe(st.uid);
      } else {
        expect(inv.find(st.uid)?.bar, id).toBe('hotbar');
        expect(inv.equipMeleeFrom(inv.find(st.uid)!), id).toBe('refused');
        expect(inv.refusal?.text).toMatch(/Only melee weapons go in the melee slot/);
        inv.set(MELEE_REF, null);
        inv.set(MELEE_REF, st);
        expect(inv.melee, id).toBeNull(); // a raw write of a gun into the melee slot is refused too
      }
      expect(inv.invariants(), id).toEqual([]);
      // uid cloning (Retry snapshot / save) keeps uid, mag and the counter
      const c = inv.clone();
      expect(c.find(st.uid), id).not.toBeNull();
      expect(JSON.stringify(c.toJSON())).toBe(JSON.stringify(inv.toJSON()));
      expect(c.invariants()).toEqual([]);
    }
  });

  it('save / load: carried, in a bag, in the Lockbox, in train cargo and in a remembered pickup — validated, restored exactly', () => {
    const h = new Harness();
    const inv = h.inv;
    const uids: Record<string, number> = {};
    VARIETY_WEAPON_IDS.forEach((id, i) => {
      const st = inv.makeStack(id, 1);
      if (WEAPONS[id].magazine > 1) st.mag = WEAPONS[id].magazine - 1; // a part-used magazine is condition, kept exactly
      uids[id] = st.uid;
      if (i < 4) expect(inv.add(st)).toBe(0);
      else if (i < 8) h.train.lockbox.slots[i] = st;
      else if (i < 10) h.train.cargo.setRecords([...h.train.cargo.records(), {kind: 'item', stack: JSON.parse(JSON.stringify(st)), x: 0.5 * i - 4, y: 0.4, z: 0.2, q: [0, 0, 0, 1]}]);
      else {
        const mem = h.run.memory(h.run.current);
        mem.pickups = [...(mem.pickups ?? []), {stack: stackRecord(st), pose: {p: [i, 0.1, 2], q: [0, 0, 0, 1]}, anchor: [i, 0.1, 2], layoutIndex: i}];
      }
    });
    const bag = inv.makeStack('backpack', 1);
    bag.bag![0] = inv.makeStack('machete', 1);
    bag.bag![1] = inv.makeStack('coach_gun', 1);
    h.train.lockbox.slots[39] = bag;
    expect(inv.invariants()).toEqual([]);
    const text = saveFileText(h.file());
    const parsed = parseSaveText(text);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    const back = new Harness();
    const r = restoreRun(parsed.value.run, back.target());
    expect(r.failed).toEqual([]);
    const everything = JSON.stringify([back.inv.toJSON(), back.train.lockbox.toJSON(), back.train.cargo.toJSON(), back.run.exportMemories()]);
    for (const id of VARIETY_WEAPON_IDS) expect(everything.includes(`"itemId":"${id}"`), id).toBe(true);
    expect(varietyIdsIn(JSON.parse(everything)).size).toBe(VARIETY_WEAPON_IDS.length);
    // exact stacks: the same uids / mags as saved
    const before = JSON.stringify([h.inv.toJSON(), h.train.lockbox.toJSON(), h.train.cargo.toJSON()]);
    expect(JSON.stringify([back.inv.toJSON(), back.train.lockbox.toJSON(), back.train.cargo.toJSON()])).toBe(before);
  });

  it('trade: each has a positive trade value from the existing value model (empty magazine + loaded rounds on top); vendor stock never seeds one', () => {
    for (const id of VARIETY_WEAPON_IDS) {
      expect(isTradeable(id), id).toBe(true);
      const empty = baseCents(id);
      expect(empty, id).toBeGreaterThan(0);
      const st = new Inventory().makeStack(id, 1);
      expect(stackCents(st), id).toBeGreaterThanOrEqual(empty);
    }
    // the gunsmith keeps its baseline rows (the lead's loot decision: vendor / market stock unchanged)
    const seen = new Set<string>();
    for (let s = 1; s <= 400; s++) for (const d of stallDraws('gun', new Rng(s * 7919))) if (ITEMS[d.itemId].kind === 'weapon') seen.add(d.itemId);
    expect([...seen].filter(isVarietyWeapon)).toEqual([]);
    expect([...seen].sort()).toEqual(['knife', 'pistol', 'rifle', 'shotgun']);
  });
});

// ---------------------------------------------------------------------------------------
// Synthetic layouts: rules
type Spot = {family: string; boxGap?: number | null; boxCount?: number; yaw?: number; area?: string};
function synth(spots: readonly Spot[], seed = 4242): StationLayout {
  const pickups: PickupPlacement[] = [];
  spots.forEach((s, k) => {
    const x = (k % 100) * 6, z = Math.floor(k / 100) * 6;
    pickups.push({itemId: s.family, count: 1, x, y: 0, z, area: 0, ...(s.yaw !== undefined ? {yaw: s.yaw} : {})});
    if (s.boxGap !== null) {
      const [ammo, cnt] = WEAPON_FIND_AMMO[s.family];
      pickups.push({itemId: ammo, count: s.boxCount ?? cnt, x: x + (s.boxGap ?? 1.5), y: 0, z, area: 0});
    }
  });
  return {seed, pickups, areas: [{id: 0, type: 'storage', purpose: spots[0]?.area ?? 'storage'}]} as unknown as StationLayout;
}

describe('weapon variety: the user\'s slot hierarchy and the matching ammo (synthetic finds)', () => {
  const sum = (rows: [string, number][]) => rows.reduce((t, [, w]) => t + w, 0);
  it('the slot rows: Weapon = 50 % gun (each of 10 guns 1/20) + 50 % melee (each of 7 melee weapons 1/14, the knife included); Gun = 10 x 1/10; categories uniform (pistol / rifle 1/3, shotgun 1/4); Melee 7 x 1/7', () => {
    expect(WEAPON_SLOT_SPLIT).toEqual({gun: 0.5, melee: 0.5});
    expect([...GUN_LEAVES]).toEqual(['pistol', 'hornet', 'longslide', 'rifle', 'stub', 'overwatch', 'shotgun', 'coach_gun', 'thresher', 'turnstile']);
    expect([...MELEE_LEAVES]).toEqual(['knife', 'fire_axe', 'machete', 'sledgehammer', 'crowbar', 'slugger', 'track_shovel']);
    const weapon = slotRows('weapon');
    expect(weapon.length).toBe(17);
    for (const [id, w] of weapon) expect(w, id).toBeCloseTo(GUN_LEAVES.includes(id) ? 1 / 20 : 1 / 14, 12);
    expect(sum(weapon)).toBeCloseTo(1, 12);
    expect(slotRows('gun')).toEqual(GUN_LEAVES.map(id => [id, 1 / 10]));
    expect(slotRows('melee')).toEqual(MELEE_LEAVES.map(id => [id, 1 / 7]));
    expect(BASELINE_GUNS.map(c => GUN_CATEGORIES[c].length)).toEqual([3, 3, 4]);
    for (const c of BASELINE_GUNS) {
      expect(slotRows(c)).toEqual(GUN_CATEGORIES[c].map(id => [id, 1 / GUN_CATEGORIES[c].length]));
      for (const id of GUN_CATEGORIES[c]) { // a category = one caliber family (the categories are data, not a second item / render whitelist)
        expect(WEAPONS[id].caliber, id).toBe(WEAPONS[c].caliber);
        if (isVarietyWeapon(id)) expect(VARIETY_WEAPONS[id].family).toBe(c);
      }
    }
    for (const id of [...GUN_LEAVES, ...MELEE_LEAVES]) expect([id, !!WEAPONS[id], !!ITEMS[id], !!WEAPONS[id].melee]).toEqual([id, true, true, MELEE_LEAVES.includes(id)]);
  });

  it('a GUN STORE is the semantic `guns` purpose / type tag (any level), every other ordinary find a Weapon slot', () => {
    expect(['mall-guns', 'mall-guns-back', 'guns'].map(t => isGunStoreArea({purpose: t, type: 'shop'}))).toEqual([true, true, true]);
    expect(['storage', 'office-armory', 'security-office', 'gunsmithy', 'mall-outdoors', 'locker-room'].map(t => isGunStoreArea({purpose: t, type: 'storage'}))).toEqual([false, false, false, false, false, false]);
    expect([slotKindOf({purpose: 'mall-guns', type: 'shop'}), slotKindOf({purpose: 'workshop', type: 'storage'}), slotKindOf(undefined)]).toEqual(['gun', 'weapon', 'weapon']);
  });

  it('shares over 36 000 synthetic finds: Weapon slots ~50 / 50, every leaf near 1/20 or 1/14 whatever the source family; Gun slots 1/10 each and never melee; pure + deterministic per origin', () => {
    const N = 6000;
    const tol = (p: number, n: number) => 3.5 * Math.sqrt(p * (1 - p) / n) + 0.003;
    for (const area of ['storage', 'mall-guns']) {
      const layout = synth(BASELINE_GUNS.flatMap(family => Array.from({length: N}, () => ({family, area}))));
      const plan = weaponFindPlan(layout, 'subway', 'subway:main', ALL);
      expect(weaponFindPlan(layout, 'subway', 'subway:main', ALL)).toEqual(plan);
      const kind = area === 'mall-guns' ? 'gun' : 'weapon';
      for (const family of BASELINE_GUNS) {
        const fs = plan.finds.filter(f => f.family === family);
        expect(fs.length).toBe(N);
        for (const f of fs) expect([f.slot, f.picked]).toEqual([kind, f.itemId]); // no fallback: the realized item IS the pick
        for (const [id, p] of slotRows(kind)) {
          const got = fs.filter(f => f.itemId === id).length / N;
          expect(Math.abs(got - p), `${area} ${family} -> ${id}: ${got.toFixed(4)} vs ${p.toFixed(4)}`).toBeLessThan(tol(p, N));
        }
        if (kind === 'gun') expect(fs.some(f => MELEE_LEAVES.includes(f.itemId))).toBe(false);
        else {
          const gunShare = fs.filter(f => GUN_LEAVES.includes(f.itemId)).length / N;
          expect(Math.abs(gunShare - 0.5)).toBeLessThan(tol(0.5, N));
        }
      }
    }
    // another section decides independently (a hash of the origin, not a stream)
    const layout = synth(BASELINE_GUNS.flatMap(family => Array.from({length: 2000}, () => ({family}))));
    const a = weaponFindPlan(layout, 'subway', 'subway:main', ALL), b = weaponFindPlan(layout, 'subway', 'subway:other', ALL);
    expect(a.finds.filter((f, i) => f.itemId === b.finds[i].itemId).length / a.finds.length).toBeLessThan(0.15);
  });

  it('the standard bundles and the per-gun ammo of one bundle: own caliber, within the magazine (coach gun 2), the rest boxed, the budget kept', () => {
    expect(BASELINE_GUNS.map(f => familyBundle(f))).toEqual([
      {caliber: '9x19mm', loaded: 15, box: 15, total: 30}, {caliber: '5.56x45mm', loaded: 30, box: 20, total: 50}, {caliber: '12ga', loaded: 6, box: 6, total: 12}]);
    const table = Object.fromEntries(GUN_LEAVES.map(id => [id, gunAmmo(WEAPONS[id].caliber!, WEAPONS[id].magazine, 1)]));
    expect(table).toEqual({
      pistol: {loaded: 15, box: 15}, hornet: {loaded: 15, box: 15}, longslide: {loaded: 10, box: 20},
      rifle: {loaded: 30, box: 20}, stub: {loaded: 30, box: 20}, overwatch: {loaded: 12, box: 38},
      shotgun: {loaded: 6, box: 6}, coach_gun: {loaded: 2, box: 10}, thresher: {loaded: 6, box: 6}, turnstile: {loaded: 6, box: 6},
    });
    for (const id of GUN_LEAVES) {
      const w = WEAPONS[id], t = table[id], std = caliberBundle(w.caliber!);
      expect((t.loaded + t.box) / std.total, id).toBe(1); // exactly one standard bundle of its own caliber
      expect(t.loaded, id).toBeLessThanOrEqual(w.magazine);
      expect(t.box, id).toBeGreaterThanOrEqual(1);
      expect(t.box, id).toBeLessThanOrEqual(ITEMS[ammoItemFor(w.caliber!)].stackMax);
    }
    // a different budget scales with half-up rounding (never minted beyond round(u x standard))
    expect(gunAmmo('12ga', 2, 1.5)).toEqual({loaded: 2, box: 16});
    expect(gunAmmo('9x19mm', 30, 0.5)).toEqual({loaded: 8, box: 7});
  });

  it('every realized find carries exactly one standard bundle in its OWN caliber; a melee result boxes the whole source bundle in the source caliber; baseline-same picks change nothing', () => {
    const layout = synth(BASELINE_GUNS.flatMap(family => Array.from({length: 1500}, () => ({family}))));
    const plan = weaponFindPlan(layout, 'subway', 'subway:main', ALL);
    const seen = new Set<string>();
    for (const f of plan.finds) {
      seen.add(f.itemId);
      const w = WEAPONS[f.itemId], src = familyBundle(f.family as BaselineGun);
      expect([f.original, f.boxBefore, f.budget, f.boxItemBefore]).toEqual([src.loaded, src.box, 1, ammoItemFor(src.caliber)]);
      if (w.melee) {
        expect([f.mag, f.boxItemAfter, f.boxAfter]).toEqual([0, ammoItemFor(src.caliber), src.total]);
      } else {
        const own = gunAmmo(w.caliber!, w.magazine, 1);
        expect([f.mag, f.boxAfter, f.boxItemAfter]).toEqual([own.loaded, own.box, ammoItemFor(w.caliber!)]);
        expect((f.mag + f.boxAfter) / caliberBundle(w.caliber!).total).toBe(1);
      }
      if (f.itemId === 'coach_gun') expect(f.mag).toBeLessThanOrEqual(2);
      // the plan's changes are exactly the realized stacks; a pick equal to the source with its standard bundle changes nothing
      const ch = plan.changes.get(f.index), bc = plan.changes.get(f.box!);
      if (f.itemId === f.family && f.yaw === undefined) expect([ch, bc]).toEqual([undefined, undefined]);
      else expect(ch).toEqual({itemId: f.itemId, count: 1, mag: f.mag, ...(f.yaw !== undefined ? {yaw: f.yaw} : {})});
      if (f.boxItemAfter !== f.boxItemBefore || f.boxAfter !== f.boxBefore) expect(bc).toEqual({itemId: f.boxItemAfter, count: f.boxAfter});
    }
    for (const id of [...GUN_LEAVES, ...MELEE_LEAVES]) expect(seen.has(id), id).toBe(true);
  });

  it('eligibility: the delivered catalogue decides (never the loaded cache); without a paired box only a source-caliber gun that loads every round (no melee, nothing lost)', () => {
    for (const id of VARIETY_WEAPON_IDS) expect(identityAvailable(id), id).toBe(!!WEAPONS[id] && !!WEAPON_VARIETY_MODELS[id]);
    const spots: Spot[] = BASELINE_GUNS.flatMap(family => Array.from({length: 600}, () => ({family})));
    // a build that could realize none of the new weapons: the slot offers only what it can realize (the baseline guns + the knife)
    const none = weaponFindPlan(synth(spots), 'subway', 'subway:main', {available: id => !isVarietyWeapon(id)});
    expect(new Set(none.finds.map(f => f.itemId))).toEqual(new Set(['pistol', 'rifle', 'shotgun', 'knife']));
    const lone = weaponFindPlan(synth(spots.map(s => ({...s, boxGap: null}))), 'subway', 'subway:main', ALL);
    for (const f of lone.finds) {
      expect(f.box).toBeNull();
      const w = WEAPONS[f.itemId];
      expect([!!w.melee, w.caliber, f.mag], f.itemId).toEqual([false, WEAPONS[f.family].caliber, f.original]);
    }
    expect(new Set(lone.finds.map(f => f.itemId))).toEqual(new Set(['pistol', 'hornet', 'rifle', 'stub', 'shotgun', 'thresher', 'turnstile']));
  });

  it('fit: a long floor find is laid ACROSS its box direction (same spot), never swapped back; a display host only offers what fits its top', () => {
    const spots: Spot[] = BASELINE_GUNS.flatMap(family => [0.25, 0.6, 1.0, 2.0].flatMap(boxGap => Array.from({length: 300}, () => ({family, boxGap}))));
    const layout = synth(spots);
    const plan = weaponFindPlan(layout, 'subway', 'subway:main', ALL);
    let across = 0;
    for (const f of plan.finds) {
      const p = layout.pickups[f.index], bp = layout.pickups[f.box!];
      const dx = bp.x - p.x, dz = bp.z - p.z, gap = Math.hypot(dx, dz);
      const needs = weaponLength(f.itemId) / 2 + BOX_CLEAR_M > gap;
      expect(f.yaw !== undefined, `${f.itemId} at ${gap}`).toBe(needs);
      if (f.yaw !== undefined) {
        across++;
        // the lying weapon's long axis (its local X turned by yaw: (cos, -sin)) is perpendicular to the box direction
        expect(Math.abs(Math.cos(f.yaw) * dx - Math.sin(f.yaw) * dz) / gap).toBeLessThan(1e-9);
      }
    }
    expect(across).toBeGreaterThan(0);
    expect(plan.finds.filter(f => f.itemId === 'track_shovel').length).toBeGreaterThan(0); // the longest one is realized on the floor too
    // hosted (a gun-shop bench / rack, own yaw): Gun slots offer all ten guns (each fits); a Weapon slot on a host would only lose the shovel
    const shop = weaponFindPlan(synth(BASELINE_GUNS.flatMap(family => Array.from({length: 900}, () => ({family, yaw: 1.2, boxGap: 2, area: 'mall-guns'})))), 'mall', 'mall:main', ALL);
    expect(new Set(shop.finds.map(f => f.itemId))).toEqual(new Set(GUN_LEAVES));
    for (const f of shop.finds) expect([f.slot, f.yaw]).toEqual(['gun', undefined]);
    const hostedWeapon = weaponFindPlan(synth(BASELINE_GUNS.flatMap(family => Array.from({length: 900}, () => ({family, yaw: 1.2, boxGap: 2})))), 'mall', 'mall:main', ALL);
    for (const f of hostedWeapon.finds) expect(weaponLength(f.itemId), f.itemId).toBeLessThanOrEqual(HOST_MAX_M);
    expect(new Set(hostedWeapon.finds.map(f => f.itemId)).size).toBe(16);
  });

  it('a curated reward (the Office roof find) and non-weapon pickups are never opportunities', () => {
    const layout = synth([{family: 'rifle'}, {family: 'shotgun'}]);
    layout.pickups.forEach(p => { p.reward = 'roof-find'; });
    expect(weaponFindPlan(layout, 'office', 'office:main', ALL).finds).toEqual([]);
    expect(pairedBox([{itemId: 'water', count: 1, x: 0, y: 0, z: 0, area: 0}, {itemId: 'ammo_9mm', count: 15, x: 1, y: 0, z: 0, area: 0}], 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
describe('weapon variety: persistence through run/worldMemory (first realization only)', () => {
  const level: LevelId = 'bunker';
  const layout = LEVELS[level].generate('main', {levelSeed: 3333, startWeapon: 'pistol'});
  const sid = sectionId({level, section: 'main'});
  /** A first spawn into a PickupManager exactly as game.ts does (plan changes, else the plain stack), then its memory records. */
  const spawn = (opts: WeaponFindOptions) => {
    const inv = new Inventory(), pm = new PickupManager({});
    const changes = weaponFindPlan(layout, level, sid, opts).changes, index = new Map<unknown, number>();
    for (const i of pickupPlan(layout.pickups.length, {pickups: null} as never).fromLayout) {
      const p = layout.pickups[i], wf = changes.get(i);
      const st = wf ? inv.makeStack(wf.itemId, wf.count, wf.mag) : inv.makeStack(pantryPickupItem(layout, i, level), p.count);
      index.set(pm.add(st, p.x, p.y, p.z, p.yaw ?? 0), i);
    }
    return {pm, inv, recs: capturePickups(pm.list, p => index.get(p))};
  };
  const view = (recs: ReturnType<typeof capturePickups>) => recs.map(r => `${r.layoutIndex}:${r.stack.itemId}x${r.stack.count}:${r.stack.mag ?? '-'}`);

  it('fixture: the bunker layout has weapon finds (each with its paired box)', () => {
    const plan = weaponFindPlan(layout, level, sid, ALL);
    expect(plan.finds.length).toBeGreaterThan(0);
    for (const f of plan.finds) expect(f.box, `find ${f.index}`).toBe(f.index + 1);
  });

  it('a revisit restores exactly the recorded stacks (no second realization); an OLD record (pre-variety) keeps its baseline finds', () => {
    const fresh = spawn(ALL);
    // revisit: memory pickups exist -> nothing comes from the layout, the records come back as they were
    const plan = pickupPlan(layout.pickups.length, {pickups: fresh.recs} as never);
    expect(plan.fromLayout).toEqual([]);
    const inv = new Inventory(), pm = new PickupManager({});
    const again = plan.restored.map(r => restorePickup(pm, inv, r));
    expect(view(capturePickups(again, p => plan.restored[again.indexOf(p)].layoutIndex))).toEqual(view(fresh.recs));
    // an OLD save: realized before this change (no identity can be realized) -> exactly the baseline guns, full mags, plain boxes
    const old = spawn({available: () => false});
    const oldPlan = pickupPlan(layout.pickups.length, {pickups: old.recs} as never);
    const pm2 = new PickupManager({}), restored = oldPlan.restored.map(r => restorePickup(pm2, new Inventory(), r));
    const v = view(capturePickups(restored, p => oldPlan.restored[restored.indexOf(p)].layoutIndex));
    expect(v).toEqual(view(old.recs));
    for (const f of weaponFindPlan(layout, level, sid, ALL).finds) expect(v.find(s => s.startsWith(`${f.index}:`)), 'old record keeps the baseline').toBe(`${f.index}:${f.family}x1:${f.original}`);
  });

  it('a NEW area of an old campaign (never realized: memory pickups null) is diversified at its first spawn', () => {
    let diversified = 0;
    for (const seed of [11, 222, 3333, 9120, 41, 77]) for (const lv of ['subway', 'bunker', 'reactor'] as const) {
      const l = LEVELS[lv].generate('main', {levelSeed: seed, startWeapon: 'pistol'});
      const changes = weaponFindPlan(l, lv, sectionId({level: lv, section: 'main', station: `st-${seed % 40}`}), ALL).changes;
      diversified += [...changes.values()].filter(c => ITEMS[c.itemId].kind === 'weapon').length;
    }
    expect(diversified).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------
describe('weapon variety: lazy models (Node: registration path)', () => {
  it('pickups / icons / warm prototypes use a resident model; its meshes are shared (a removed pickup never disposes them)', () => {
    const g = new THREE.BoxGeometry(0.05, 0.12, 0.9);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
    expect(weaponVarietyGltf('stub')).toBeUndefined();
    registerWeaponVarietyModel('stub', {scene});
    try {
      const pm = new PickupManager({});
      const st = new Inventory().makeStack('stub', 1);
      const p = pm.add(st, 0, 0, 0);
      let geo: THREE.BufferGeometry | null = null;
      p.obj.traverse(o => { if ((o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry; });
      expect(geo).toBe(g); // the model's own geometry (a lying clone), not a stand-in box
      let disposed = false;
      g.addEventListener('dispose', () => { disposed = true; });
      pm.remove(p);
      expect(disposed).toBe(false);
      const roots = weaponVarietyWarmRoots();
      expect(roots.length).toBe(1);
      expect(roots[0].parent).toBe(WEAPON_VARIETY_WARM_GROUP);
      let hidden = 0;
      roots[0].traverse(o => { if ((o as THREE.Mesh).isMesh) { expect(o.visible).toBe(false); hidden++; } });
      expect(hidden).toBe(1);
    } finally {
      registerWeaponVarietyModel('stub', null);
    }
    expect(weaponVarietyWarmRoots()).toEqual([]);
  });

  it('a section needs: its first spawn identities + every itemId of its memory / the carried stores (bounded scan); never all twelve', () => {
    expect([...varietyIdsIn([{pack: [{itemId: 'hornet'}, null]}, {lanes: {bags: [{stack: {bag: [{itemId: 'crowbar'}]}}]}}, {itemId: 'pistol'}])].sort()).toEqual(['crowbar', 'hornet']);
    let deep: unknown = {itemId: 'machete'};
    for (let i = 0; i < 20; i++) deep = {x: deep};
    expect(varietyIdsIn(deep).size).toBe(0); // bounded depth
    const l = LEVELS.subway.generate('main', {levelSeed: 222, startWeapon: 'pistol'});
    const ids = plannedVarietyIds(l, 'subway', 'subway:main', ALL);
    const plan = weaponFindPlan(l, 'subway', 'subway:main', ALL);
    expect(ids).toEqual([...new Set(plan.finds.map(f => f.itemId).filter(isVarietyWeapon))].sort());
    expect(ids.length).toBeLessThan(VARIETY_WEAPON_IDS.length);
  });
});

// ---------------------------------------------------------------------------------------
describe('weapon variety: game.ts wiring (source order)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
  it('first spawns only: the plan is made from the pickup plan\'s layout list; the yaw and the food gate come first; same makeStack count', () => {
    const loopAt = src.indexOf('for (const i of plan.fromLayout) {');
    const planAt = src.indexOf('const findPlan = plan.fromLayout.length ? weaponFindPlan(this.layout, key.level, mem.id, {pool}) : null;');
    expect(planAt).toBeGreaterThan(0);
    expect(planAt).toBeLessThan(loopAt);
    // (task studio-turnstile-user-model-20261112-004550-01) the section's pool: after this entry is counted, recorded with the finds
    const poolAt = src.indexOf('const pool = sectionWeaponPool(mem.lanes, mem.visits - 1);');
    expect(poolAt).toBeGreaterThan(src.indexOf('mem.visits++;'));
    expect(poolAt).toBeLessThan(planAt);
    expect(src.indexOf('if (findPlan?.finds.length) mem.lanes[WEAPON_POOL_LANE] = pool;')).toBeGreaterThan(planAt);
    expect(src).toContain('{pool: sectionWeaponPool(mem?.lanes, mem?.visits ?? 0)}'); // the preload: the same pool, before the entry
    const loop = src.slice(loopAt, src.indexOf('for (const rec of plan.restored) {'));
    const yaw = loop.indexOf('const yaw = this.rand() * Math.PI * 2;'), skip = loop.indexOf('if (!keepLayoutPickup(this.layout.seed, mem.id, i, p)) continue;');
    const make = loop.indexOf('const st = wf ? this.inv.makeStack(wf.itemId, wf.count, wf.mag) : this.inv.makeStack(pantryPickupItem(this.layout, i, key.level), p.count);');
    expect(yaw).toBeGreaterThan(0);
    expect(skip).toBeGreaterThan(yaw);
    expect(make).toBeGreaterThan(skip);
  });
  it('the models are prepared behind the loading screen (prepareSection) and carried ones again after a build; the warm pool is registered', () => {
    expect(src).toContain('await this.prepareWeaponVariety(layout, key, run);');
    expect(src).toContain('void this.prepareWeaponVariety(null, key, this.run, true);');
    expect(src).toContain("this.warmRegistry.addPool('weapon-variety', () => weaponVarietyWarmRoots());");
    // (task studio-weapon-runtime-fix-20261110-022206-01: re-pinned — the hand-over to the held view / pickups / icons is no longer done inside
    // the preload only (a weapon that arrived mid-play never got its model); it is the one delivery's, for a model that arrives by any path)
    expect(src).toContain('this.weaponVariety = installWeaponVarietyDelivery({');
    expect(readFileSync(fileURLToPath(new URL('../src/world/weaponVarietyDelivery.ts', import.meta.url)), 'utf8')).toContain('if (vm?.addModel(id, g)) held++;');
  });
});

// ---------------------------------------------------------------------------------------
describe('weapon variety: census over real generated layouts of every level (the user\'s slot hierarchy + matching ammo)', () => {
  it('the weapon find count and every other pickup identical; one standard ammo bundle per find before and after; gun stores never melee; every leaf reachable', () => {
    const SEEDS: Record<LevelId, number[]> = {subway: [11, 222, 3333, 9120, 41, 77, 5, 61, 17, 29, 101, 202, 303, 404, 505, 606], office: [11, 222, 3333, 9120], mall: [5, 61, 11, 222, 3333, 9120, 41, 77, 3, 13, 17, 29, 47, 101, 202, 303, 404, 505, 606, 707, 808, 909, 1234, 4321], market: [7], bunker: [11, 222, 3333, 17, 5, 61, 41, 77, 101, 202, 303, 404], skyways: [3, 47, 11], reactor: [13, 29, 222]};
    const census: Record<string, unknown> = {};
    /** The stacks of a first spawn WITHOUT any plan (the generator's own baseline finds). */
    const plain = (layout: StationLayout, level: string) => layout.pickups.map((p, i) => ({itemId: pantryPickupItem(layout, i, level), count: p.count, mag: ITEMS[p.itemId]?.kind === 'weapon' ? WEAPONS[p.itemId].magazine : undefined, reward: p.reward}));
    /** Normalized ammo budget of a bundle: rounds / the standard bundle of their caliber. */
    const norm = (ammoId: string, rounds: number) => { const c = Object.values(WEAPONS).find(w => w.caliber && ammoItemFor(w.caliber) === ammoId)!.caliber!; return rounds / caliberBundle(c).total; };
    const leaves: Record<string, Record<string, number>> = {weapon: {}, gun: {}};
    let layouts = 0, totalFinds = 0, budgetBefore = 0, budgetAfter = 0, across = 0;
    const issues: string[] = [];
    for (const level of LEVEL_IDS) {
      const sid = sectionId({level, section: 'main'});
      const row = {layouts: 0, finds: 0, slots: {} as Record<string, number>, after: {} as Record<string, number>, roundsBefore: {} as Record<string, number>, roundsAfter: {} as Record<string, number>, otherPickups: 0};
      for (const start of ['pistol', 'rifle'] as const) for (const seed of start === 'pistol' ? SEEDS[level] : SEEDS[level].slice(0, 2)) {
        const layout = LEVELS[level].generate('main', {levelSeed: seed, startWeapon: start});
        layouts++; row.layouts++;
        const before = plain(layout, level);
        const after = firstSpawn(layout, level, sid, ALL);
        const plan = weaponFindPlan(layout, level, sid, ALL);
        expect(weaponFindPlan(layout, level, sid)).toEqual(plan); // this build's own catalogue = every identity (all twelve delivered)
        const weapons = (xs: typeof before) => xs.filter(x => ITEMS[x.itemId].kind === 'weapon').length;
        if (weapons(before) !== weapons(after)) issues.push(`${level} ${seed}: weapon count ${weapons(before)} -> ${weapons(after)}`);
        const bundled = new Set(plan.finds.flatMap(f => [f.index, f.box]));
        before.forEach((b, i) => {
          if (bundled.has(i)) return;
          row.otherPickups++;
          if (JSON.stringify(after[i]) !== JSON.stringify(b)) issues.push(`${level} ${seed}: pickup ${i} changed`);
        });
        for (const f of plan.finds) {
          totalFinds++; row.finds++;
          if (before[f.index].itemId !== f.family) issues.push(`${level} ${seed}: find ${f.index} was ${before[f.index].itemId}`);
          if (f.box === null) { issues.push(`${level} ${seed}: find ${f.index} has no paired box`); continue; }
          const area = layout.areas[layout.pickups[f.index].area];
          if (f.slot !== (isGunStoreArea(area) ? 'gun' : 'weapon')) issues.push(`${level} ${seed}: find ${f.index} slot ${f.slot}`);
          if (f.slot === 'gun' && MELEE_LEAVES.includes(f.itemId)) issues.push(`${level} ${seed}: a gun store realized ${f.itemId}`);
          if (f.yaw !== undefined) across++;
          row.slots[f.slot] = (row.slots[f.slot] ?? 0) + 1;
          leaves[f.slot === 'gun' ? 'gun' : 'weapon'][f.itemId] = (leaves[f.slot === 'gun' ? 'gun' : 'weapon'][f.itemId] ?? 0) + 1;
          row.after[f.itemId] = (row.after[f.itemId] ?? 0) + 1;
          // the bundle (loaded + box) before / after, raw per ammo item and normalized
          const srcAmmo = before[f.box].itemId;
          const bBefore = norm(srcAmmo, (before[f.index].mag ?? 0) + before[f.box].count);
          const w = WEAPONS[f.itemId];
          const aAmmo = after[f.box].itemId, aRounds = (w.melee ? 0 : after[f.index].mag ?? 0) + after[f.box].count;
          if (!w.melee && aAmmo !== ammoItemFor(w.caliber!)) issues.push(`${level} ${seed}: ${f.itemId} paired with ${aAmmo}`);
          if (w.melee && aAmmo !== srcAmmo) issues.push(`${level} ${seed}: melee ${f.itemId} box ${aAmmo} (source ${srcAmmo})`);
          const bAfter = norm(aAmmo, aRounds);
          if (Math.abs(bBefore - 1) > 1e-9 || Math.abs(bAfter - 1) > 1e-9) issues.push(`${level} ${seed}: find ${f.index} budget ${bBefore} -> ${bAfter}`);
          budgetBefore += bBefore; budgetAfter += bAfter;
          row.roundsBefore[srcAmmo] = (row.roundsBefore[srcAmmo] ?? 0) + (before[f.index].mag ?? 0) + before[f.box].count;
          row.roundsAfter[aAmmo] = (row.roundsAfter[aAmmo] ?? 0) + aRounds;
          if (!w.melee && (after[f.index].mag ?? 0) > w.magazine) issues.push(`${level} ${seed}: ${f.itemId} loads ${after[f.index].mag}`);
        }
      }
      census[level] = row;
    }
    expect(issues).toEqual([]);
    // every level with weapon finds has them; the market has none (vendor stock only)
    for (const level of LEVEL_IDS) expect(((census[level] as {finds: number}).finds) > 0, level).toBe(level !== 'market');
    // gun stores (the Mall's gun shops) are Gun slots; the rest Weapon slots
    expect(((census.mall as {slots: Record<string, number>}).slots.gun ?? 0)).toBeGreaterThan(10);
    // declared eligibility over these layouts: every Weapon-slot leaf and every gun-store gun appears (not a promise for every seed)
    for (const id of [...GUN_LEAVES, ...MELEE_LEAVES]) expect(leaves.weapon[id] ?? 0, `weapon slot ${id}`).toBeGreaterThan(0);
    // gun stores (a few dozen finds here): all three categories appear and no leaf strays from 1/10 (the per-leaf uniformity itself is the
    // synthetic test's 36 000 finds); the counts go to the census
    const gunN = Object.values(leaves.gun).reduce((t, n) => t + n, 0);
    for (const c of BASELINE_GUNS) expect(GUN_CATEGORIES[c].reduce((t, id) => t + (leaves.gun[id] ?? 0), 0), `gun store ${c}`).toBeGreaterThan(0);
    for (const id of GUN_LEAVES) expect(Math.abs((leaves.gun[id] ?? 0) - gunN / 10), `gun store ${id}`).toBeLessThan(3.5 * Math.sqrt(gunN * (1 / 10) * (9 / 10)) + 1);
    const weaponN = Object.values(leaves.weapon).reduce((t, n) => t + n, 0);
    const meleeN = MELEE_LEAVES.reduce((t, id) => t + (leaves.weapon[id] ?? 0), 0);
    expect(Math.abs(meleeN / weaponN - 0.5), `melee ${meleeN} of ${weaponN}`).toBeLessThan(3.5 * Math.sqrt(0.25 / weaponN));
    // the normalized ammo budget: exactly one standard bundle per find, before and after
    expect(budgetAfter).toBeCloseTo(budgetBefore, 9);
    expect(budgetBefore).toBeCloseTo(totalFinds, 9);
    const pooled = (k: 'roundsBefore' | 'roundsAfter') => Object.values(census).reduce((t: Record<string, number>, r) => { for (const [a, v] of Object.entries((r as Record<string, Record<string, number>>)[k])) t[a] = (t[a] ?? 0) + v; return t; }, {});
    census.all = {layouts, finds: totalFinds, budgetBefore, budgetAfter, laidAcross: across, roundsBefore: pooled('roundsBefore'), roundsAfter: pooled('roundsAfter'),
      weaponSlot: {finds: weaponN, melee: meleeN, leaves: leaves.weapon}, gunStore: leaves.gun};
    expect(totalFinds).toBeGreaterThan(80);
    mkdirSync(OUT, {recursive: true});
    writeFileSync(`${OUT}/census.json`, JSON.stringify(census, null, 1));
  }, 300_000);
});
