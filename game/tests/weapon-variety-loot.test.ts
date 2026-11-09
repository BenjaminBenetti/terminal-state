// Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): the twelve new weapons as ITEMS and as diversified WEAPON FINDS
// (items/weaponVarietyItems.ts, items/weaponVariety.ts, world/weaponVarietyModels.ts, game.ts buildSection's first spawn). HARD user
// constraints: the same weapon find rate, the same ammo supply, saves / recorded loot exact.
//  - census over real generated layouts of every level: the weapon find COUNT and the ammo units (boxes + loaded rounds) identical per
//    caliber, every non-weapon pickup identical (a paired box differs only by the rounds that moved into it), family shares near their
//    weights (written to /tmp/weapon-variety-loot/census.json);
//  - the loaded-round rules (never minted, never lost; the coach gun holds at most 2; a melee identity's rounds all go to its box);
//  - eligibility (a weapon without its def / delivered model, or that does not fit, stays the baseline find);
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
  BASELINE_GUNS, HOST_MAX_M, MELEE_SHARE, VARIETY_LENGTH_M, WEAPON_VARIETY_FAMILIES, identityAvailable, identityRows, pairedBox,
  plannedVarietyIds, varietyIdsIn, weaponFindPlan, type WeaponFindOptions,
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

/** Ammo units per ammo item: loose boxes + rounds loaded in guns. */
function ammoUnits(stacks: readonly {itemId: string; count: number; mag?: number}[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of stacks) {
    const d = ITEMS[s.itemId];
    if (d.kind === 'ammo') out[s.itemId] = (out[s.itemId] ?? 0) + s.count;
    else if (d.kind === 'weapon' && WEAPONS[s.itemId]?.caliber) { const a = ammoItemFor(WEAPONS[s.itemId].caliber!); out[a] = (out[a] ?? 0) + (s.mag ?? 0); }
  }
  return out;
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

describe('weapon variety: the realization rules (synthetic finds)', () => {
  it('the identity rows: the baseline is the most common in each family; melee <= 25 %; each family sums to 1', () => {
    expect(MELEE_SHARE).toBeLessThanOrEqual(0.25);
    for (const f of BASELINE_GUNS) {
      const g = WEAPON_VARIETY_FAMILIES[f];
      expect(Object.keys(g)[0]).toBe(f);
      for (const [id, w] of Object.entries(g)) if (id !== f) expect(g[f], id).toBeGreaterThan(w);
      for (const place of ['storage', 'mall-guns', 'locker-room', 'workshop']) for (const level of LEVEL_IDS) {
        const rows = identityRows(f, {level, place, host: false});
        expect(rows.reduce((s, [, w]) => s + w, 0)).toBeCloseTo(1, 9);
        expect(rows.filter(([id]) => VARIETY_MELEE_IDS.includes(id as never)).reduce((s, [, w]) => s + w, 0)).toBeCloseTo(MELEE_SHARE, 9);
        const top = Math.max(...rows.map(([, w]) => w));
        expect(rows[0][1]).toBe(top);
        for (const [id] of rows) expect(id === f || (isVarietyWeapon(id) && (VARIETY_WEAPONS[id].family === f || VARIETY_WEAPONS[id].family === 'knife')), id).toBe(true);
      }
    }
  });

  it('shares over 30 000 synthetic finds come within 2 points of the weights; pure + deterministic per origin', () => {
    const N = 10000;
    const spots: Spot[] = BASELINE_GUNS.flatMap(family => Array.from({length: N}, () => ({family})));
    const layout = synth(spots);
    const plan = weaponFindPlan(layout, 'subway', 'subway:main', ALL);
    expect(weaponFindPlan(layout, 'subway', 'subway:main', ALL)).toEqual(plan);
    for (const family of BASELINE_GUNS) {
      const fs = plan.finds.filter(f => f.family === family);
      expect(fs.length).toBe(N);
      const rows = identityRows(family, {level: 'subway', place: 'storage|storage', host: false});
      for (const [id, w] of rows) {
        const got = fs.filter(f => f.itemId === id).length / N;
        expect(Math.abs(got - w), `${family} -> ${id}: ${got.toFixed(3)} vs ${w.toFixed(3)}`).toBeLessThan(0.02);
      }
    }
    // another section / seed decides independently (a hash of the origin, not a stream)
    const other = weaponFindPlan(layout, 'subway', 'subway:other', ALL);
    const same = plan.finds.filter((f, i) => f.itemId === other.finds[i].itemId).length / plan.finds.length;
    expect(same).toBeLessThan(0.6);
  });

  it('loaded rounds are never minted or lost: min(original, capacity) loaded, the rest into the paired box; melee loads none; coach gun <= 2', () => {
    const layout = synth(BASELINE_GUNS.flatMap(family => Array.from({length: 1500}, () => ({family}))));
    const plan = weaponFindPlan(layout, 'subway', 'subway:main', ALL);
    const seen = new Set<string>();
    for (const f of plan.finds) {
      seen.add(f.itemId);
      const base = WEAPONS[f.family].magazine;
      expect(f.original).toBe(base);
      const w = WEAPONS[f.itemId];
      expect(f.mag).toBe(w.melee ? 0 : Math.min(base, w.magazine));
      expect(f.mag + f.boxAfter, f.itemId).toBe(f.original + f.boxBefore); // supply exact
      expect(f.boxBefore).toBe(WEAPON_FIND_AMMO[f.family][1]);
      if (f.itemId === 'coach_gun') expect(f.mag).toBeLessThanOrEqual(2);
      if (VARIETY_MELEE_IDS.includes(f.itemId as never)) expect(f.boxAfter).toBe(f.boxBefore + base);
      // the plan's changes are exactly the realized stacks
      const ch = plan.changes.get(f.index);
      if (f.itemId === f.family) expect(ch).toBeUndefined(); else expect(ch).toEqual({itemId: f.itemId, count: 1, mag: f.mag});
      const bc = plan.changes.get(f.box!);
      if (f.boxAfter === f.boxBefore) expect(bc).toBeUndefined(); else expect(bc).toEqual({itemId: WEAPON_FIND_AMMO[f.family][0], count: f.boxAfter});
    }
    for (const id of [...VARIETY_WEAPON_IDS, ...BASELINE_GUNS]) expect(seen.has(id), id).toBe(true);
  });

  it('eligibility: no def / model -> the baseline (no change at all); no paired box -> no melee / round-moving identity; a full box -> none either', () => {
    const spots: Spot[] = BASELINE_GUNS.flatMap(family => Array.from({length: 400}, () => ({family})));
    const none = weaponFindPlan(synth(spots), 'subway', 'subway:main', {available: () => false});
    expect(none.changes.size).toBe(0);
    expect(none.finds.every(f => f.itemId === f.family && f.mag === f.original)).toBe(true);
    // this build's own registry decides by default (def + delivered model)
    for (const id of VARIETY_WEAPON_IDS) expect(identityAvailable(id), id).toBe(!!WEAPONS[id] && !!WEAPON_VARIETY_MODELS[id]);
    const dflt = weaponFindPlan(synth(spots), 'subway', 'subway:main');
    for (const f of dflt.finds) if (f.itemId !== f.family) expect(identityAvailable(f.itemId)).toBe(true);
    // without a paired box
    const lone = weaponFindPlan(synth(spots.map(s => ({...s, boxGap: null}))), 'subway', 'subway:main', ALL);
    for (const f of lone.finds) {
      expect(f.box).toBeNull();
      expect(f.mag, f.itemId).toBe(f.original); // nothing can move: only identities that hold all the rounds
      expect(VARIETY_MELEE_IDS.includes(f.itemId as never)).toBe(false);
    }
    // a box that cannot take the rounds (stackMax): those identities stay the baseline
    const full = weaponFindPlan(synth(spots.map(s => ({...s, boxCount: ITEMS[WEAPON_FIND_AMMO[s.family][0]].stackMax}))), 'subway', 'subway:main', ALL);
    for (const f of full.finds) expect(f.boxAfter).toBe(f.boxBefore);
  });

  it('fit: a weapon longer than the baseline never lies into its paired box or past a display bench', () => {
    const spots: Spot[] = BASELINE_GUNS.flatMap(family => [0.25, 0.67, 1.0, 2.0].flatMap(boxGap => Array.from({length: 300}, () => ({family, boxGap}))));
    const layout = synth(spots);
    const plan = weaponFindPlan(layout, 'mall', 'mall:main', ALL);
    let longer = 0;
    for (const f of plan.finds) {
      const len = isVarietyWeapon(f.itemId) ? VARIETY_LENGTH_M[f.itemId] : WEAPONS[f.itemId].view.length;
      const gap = Math.abs(layout.pickups[f.box!].x - layout.pickups[f.index].x);
      if (len > WEAPONS[f.family].view.length) { longer++; expect(len / 2 + 0.08, `${f.itemId} at ${gap}`).toBeLessThanOrEqual(gap); }
    }
    expect(longer).toBeGreaterThan(0);
    const hosts = weaponFindPlan(synth(BASELINE_GUNS.flatMap(family => Array.from({length: 600}, () => ({family, yaw: 1.2, boxGap: 2})))), 'mall', 'mall:main', ALL);
    for (const f of hosts.finds) if (isVarietyWeapon(f.itemId)) expect(VARIETY_LENGTH_M[f.itemId] <= Math.max(HOST_MAX_M, WEAPONS[f.family].view.length), f.itemId).toBe(true);
    expect(hosts.finds.some(f => f.picked === 'track_shovel' && f.itemId === f.family)).toBe(true); // the 1.25 m shovel never lies on a bench
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
    const planAt = src.indexOf('const weaponFinds = plan.fromLayout.length ? weaponFindPlan(this.layout, key.level, mem.id).changes : null;');
    expect(planAt).toBeGreaterThan(0);
    expect(planAt).toBeLessThan(loopAt);
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
    expect(src).toContain('vm?.addModel?.(id, g)');
  });
});

// ---------------------------------------------------------------------------------------
describe('weapon variety: census over real generated layouts of every level', () => {
  it('weapon find count and ammo units identical per caliber; every other pickup identical; family shares near their weights', () => {
    const SEEDS: Record<LevelId, number[]> = {subway: [11, 222, 3333, 9120, 41, 77, 5, 61, 17, 29, 101, 202, 303, 404, 505, 606], office: [11, 222, 3333, 9120], mall: [5, 61, 11, 222, 3333, 9120, 41, 77, 3, 13, 17, 29, 47, 101, 202, 303, 404, 505, 606, 707, 808, 909, 1234, 4321], market: [7], bunker: [11, 222, 3333, 17, 5, 61, 41, 77, 101, 202, 303, 404], skyways: [3, 47, 11], reactor: [13, 29, 222]};
    const census: Record<string, unknown> = {};
    const shares: Record<string, Record<string, number>> = {pistol: {}, rifle: {}, shotgun: {}};
    const possible: Record<string, Record<string, number>> = {pistol: {}, rifle: {}, shotgun: {}};
    const opp: Record<string, number> = {pistol: 0, rifle: 0, shotgun: 0};
    let layouts = 0, totalFinds = 0;
    const issues: string[] = [];
    for (const level of LEVEL_IDS) {
      const sid = sectionId({level, section: 'main'});
      const row = {layouts: 0, finds: 0, before: {} as Record<string, number>, after: {} as Record<string, number>, ammoBefore: {} as Record<string, number>, ammoAfter: {} as Record<string, number>, movedRounds: 0, otherPickups: 0, defaultBuildChanges: 0};
      for (const start of ['pistol', 'rifle'] as const) for (const seed of start === 'pistol' ? SEEDS[level] : SEEDS[level].slice(0, 2)) {
        const layout = LEVELS[level].generate('main', {levelSeed: seed, startWeapon: start});
        layouts++; row.layouts++;
        const before = firstSpawn(layout, level, sid, {available: () => false});
        const after = firstSpawn(layout, level, sid, ALL);
        row.defaultBuildChanges += weaponFindPlan(layout, level, sid).changes.size;
        const plan = weaponFindPlan(layout, level, sid, ALL);
        const weapons = (xs: typeof before) => xs.filter(s => ITEMS[s.itemId].kind === 'weapon').length;
        if (weapons(before) !== weapons(after)) issues.push(`${level} ${seed}: weapon count ${weapons(before)} -> ${weapons(after)}`);
        const ab = ammoUnits(before), aa = ammoUnits(after);
        for (const k of new Set([...Object.keys(ab), ...Object.keys(aa)])) if ((ab[k] ?? 0) !== (aa[k] ?? 0)) issues.push(`${level} ${seed}: ${k} ${ab[k]} -> ${aa[k]}`);
        for (const [k, v] of Object.entries(ab)) row.ammoBefore[k] = (row.ammoBefore[k] ?? 0) + v;
        for (const [k, v] of Object.entries(aa)) row.ammoAfter[k] = (row.ammoAfter[k] ?? 0) + v;
        const boxes = new Set(plan.finds.map(f => f.box));
        before.forEach((b, i) => {
          const a = after[i];
          if (plan.finds.some(f => f.index === i)) return;
          if (boxes.has(i)) { if (a.itemId !== b.itemId || a.count < b.count) issues.push(`${level} ${seed}: box ${i} ${b.itemId}x${b.count} -> ${a.itemId}x${a.count}`); row.movedRounds += a.count - b.count; return; }
          row.otherPickups++;
          if (JSON.stringify(a) !== JSON.stringify(b)) issues.push(`${level} ${seed}: pickup ${i} changed`);
        });
        for (const f of plan.finds) {
          totalFinds++; row.finds++; opp[f.family]++;
          if (before[f.index].itemId !== f.family) issues.push(`${level} ${seed}: find ${f.index} was ${before[f.index].itemId}`);
          shares[f.family][f.itemId] = (shares[f.family][f.itemId] ?? 0) + 1;
          row.before[f.family] = (row.before[f.family] ?? 0) + 1;
          row.after[f.itemId] = (row.after[f.itemId] ?? 0) + 1;
          const area = layout.areas[layout.pickups[f.index].area];
          for (const [id, w] of identityRows(f.family, {level, place: `${area?.purpose ?? ''}|${area?.type ?? ''}`, host: layout.pickups[f.index].yaw !== undefined})) possible[f.family][id] = (possible[f.family][id] ?? 0) + w;
          if (pairedBox(layout.pickups, f.index) === null) issues.push(`${level} ${seed}: find ${f.index} has no paired box`);
        }
      }
      census[level] = row;
    }
    expect(issues).toEqual([]);
    // every level with weapon finds has them; the market has none (vendor stock only)
    for (const level of LEVEL_IDS) expect(((census[level] as {finds: number}).finds) > 0, level).toBe(level !== 'market');
    // family shares: baseline the most common; melee <= 25 % (+ sampling slack); each identity near its possible share
    const melee = (f: string) => Object.entries(shares[f]).filter(([id]) => VARIETY_MELEE_IDS.includes(id as never)).reduce((s, [, n]) => s + n, 0) / opp[f];
    const table: Record<string, unknown> = {};
    for (const f of BASELINE_GUNS) {
      const n = opp[f];
      expect(n, f).toBeGreaterThan(8);
      const fam = WEAPON_VARIETY_FAMILIES[f];
      const sampled = Object.fromEntries(Object.keys(fam).map(id => [id, +((shares[f][id] ?? 0) / n).toFixed(3)]));
      const poss = Object.fromEntries(Object.keys(fam).map(id => [id, +((possible[f][id] ?? 0) / n).toFixed(3)]));
      table[f] = {opportunities: n, possible: {...poss, melee: MELEE_SHARE}, sampled: {...sampled, melee: +melee(f).toFixed(3)}, melee: Object.fromEntries(VARIETY_MELEE_IDS.map(id => [id, shares[f][id] ?? 0]))};
      const tol = 2.6 * Math.sqrt(0.25 / n) + 0.02;
      for (const id of Object.keys(fam)) expect(Math.abs(sampled[id] - poss[id]), `${f} -> ${id} (${n} finds)`).toBeLessThan(tol + (id === f ? 0.08 : 0)); // (the baseline also takes every pick that did not fit)
      expect(melee(f), f).toBeLessThan(MELEE_SHARE + tol);
    }
    const pooled = (k: 'ammoBefore' | 'ammoAfter') => Object.values(census).reduce((s: Record<string, number>, r) => { for (const [a, v] of Object.entries((r as Record<string, Record<string, number>>)[k])) s[a] = (s[a] ?? 0) + v; return s; }, {} as Record<string, number>);
    census.all = {layouts, finds: totalFinds, ammoBefore: pooled('ammoBefore'), ammoAfter: pooled('ammoAfter'), families: table};
    expect(pooled('ammoAfter')).toEqual(pooled('ammoBefore'));
    expect(totalFinds).toBeGreaterThan(80);
    mkdirSync(OUT, {recursive: true});
    writeFileSync(`${OUT}/census.json`, JSON.stringify(census, null, 1));
  }, 300_000);
});
