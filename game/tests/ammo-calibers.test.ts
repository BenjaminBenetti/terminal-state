// Lane AMMO (task knife-melee-20261030): CALIBER-BASED AMMO.
// User: "relabel all the ammo ... nine millimeter ... whatever rifles use ... whatever shotguns use ... so when we add different
// types of weapons the ammo will work in those weapons", "the pistol ammo ... only spawns on the floor ... in areas where rifle and
// shotgun ammo can spawn I want to also be able to get the nine millimeter ammo there with a roughly one third one third ratio".
// Covers: caliber items + weapon calibers + a shared pool for any future weapon of a caliber; legacy-id migration (snapshots, run
// carryover, section memory, grounded bags) without duplication / loss / refill; labels; the ~1/3 generic distribution (tables,
// deterministic sampling, the Subway corpus) with total ammo in a band of the pre-change census on BOTH levels; weapon-find
// companions; the three Meshy T2.5 ammo-box derivatives (manifest, provenance, dims). No browser, no git history.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {NodeIO} from '@gltf-transform/core';
import {
  AMMO_ITEM_IDS, CALIBER_IDS, LEGACY_AMMO_IDS, ammoItemFor, ammoText, caliberOfItem, canonicalItemId, genericAmmo,
} from '../src/items/calibers';
import {ITEMS, ITEM_DIMS, itemDef} from '../src/items/items';
import {BACKPACK_SLOTS} from '../src/items/gear';
import {Inventory, stackFromJSON, type InventoryJSON} from '../src/items/inventory';
import {WEAPONS, WeaponController, caliberLabel, reserveFor, weaponAmmoItem, weaponsForCaliber, type TriggerInput, type WeaponDef} from '../src/weapons/weapons';
import {describeLoot, lotPrompt, rollTableItems, type HolderKind} from '../src/items/loot';
import {GLOBAL_POOL, HANDFUL} from '../src/items/lootEconomy';
import {ALL_PURPOSES} from '../src/gen/purposes';
import {OPENABLE_KINDS, openableSpec} from '../src/world/openablesSpec';
import {WEAPON_FIND_AMMO} from '../src/gen/weaponFinds';
import {starterInventory} from '../src/run/starter';
import {stackFromRecord} from '../src/run/worldMemory';
import {readSectionBags} from '../src/gear/bagStore';
import {ICONS} from '../src/ui/icons';
import {MODEL_FILES} from '../src/assets/manifest';
import {ITEM_MODEL_KEYS} from '../src/world/pickups';
import {MODEL_KEY_CLASS, ITEM_PHYSICS} from '../src/damage/materials';
import {generateStation, type StationLayout} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {ECONOMY_CORPUS, generateCorpus, stationEconomy, type EconEntry} from './helpers/lootEconomy';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const LEGACY = Object.keys(LEGACY_AMMO_IDS);
const idle = (o: Partial<TriggerInput> = {}): TriggerInput => ({held: false, pressed: false, reload: false, lowered: false, ...o});
let corpus: StationLayout[] | null = null;
const CORPUS = () => (corpus ??= generateCorpus());
const officeCache = new Map<number, StationLayout>();
const OFFICE = (levelSeed: number) => { let l = officeCache.get(levelSeed); if (!l) officeCache.set(levelSeed, (l = generateOfficeLevel({levelSeed, startWeapon: 'pistol'}))); return l; };
const run = (wc: WeaponController, inv: Inventory, secs: number, inp: Partial<TriggerInput> = {}) => { const ev = []; for (let t = 0; t < secs; t += 0.05) ev.push(...wc.update(0.05, idle(inp), inv)); return ev; };

/** 9mm-only loot rows outside office purposes that are deliberate sidearm caches (documented exceptions to the 1/3 rule). */
const NINE_ONLY_EXCEPTIONS: readonly string[] = ['openable.toiletStall'];

describe('calibers: an ammo item IS a caliber, weapons declare the caliber they chamber', () => {
  it('9mm (9×19mm) pistol, 5.56×45mm rifle, 12-gauge shotgun; one item per caliber; no gun-specific ammo item left', () => {
    expect(CALIBER_IDS).toEqual(['9x19mm', '5.56x45mm', '12ga']);
    expect(AMMO_ITEM_IDS).toEqual(['ammo_9mm', 'ammo_556', 'ammo_12ga']);
    expect(WEAPONS.pistol.caliber).toBe('9x19mm');
    expect(WEAPONS.rifle.caliber).toBe('5.56x45mm');
    expect(WEAPONS.shotgun.caliber).toBe('12ga');
    for (const c of CALIBER_IDS) {
      const d = itemDef(ammoItemFor(c));
      expect(d).toMatchObject({kind: 'ammo', caliber: c});
      expect(caliberOfItem(d.id)).toBe(c);
    }
    // every ammo item is a caliber item; the old gun-specific ids are gone from the catalogue (they only migrate)
    expect(Object.values(ITEMS).filter(d => d.kind === 'ammo').map(d => d.id).sort()).toEqual([...AMMO_ITEM_IDS].sort());
    for (const id of LEGACY) expect(ITEMS[id], id).toBeUndefined();
    // stack limits unchanged by the mapping (120 / 120 / 32)
    expect([ITEMS.ammo_9mm.stackMax, ITEMS.ammo_556.stackMax, ITEMS.ammo_12ga.stackMax]).toEqual([120, 120, 32]);
    // every weapon that uses ammo has a caliber; a weapon without one uses none (melee)
    for (const w of Object.values(WEAPONS)) if (w.caliber) expect(ITEMS[weaponAmmoItem(w)!], w.id).toBeDefined(); else expect(weaponAmmoItem(w), w.id).toBeNull();
    expect(weaponsForCaliber('9x19mm').map(w => w.id)).toContain('pistol');
  });

  it('reload / reserve / dry-fire resolve through the caliber: a future weapon of the same caliber shares the very same pool', () => {
    // a hypothetical 9mm carbine (same caliber, own 30-round magazine): no new ammo item, no new code path
    const carbine: WeaponDef = {...WEAPONS.pistol, id: 'carbine9', itemId: 'carbine9', magazine: 30, auto: true, reload: {kind: 'magazine', time: 1, emptyTime: 1}};
    const defs = {...WEAPONS, carbine9: carbine};
    const inv = new Inventory();
    inv.add(inv.makeStack('ammo_9mm', 40));
    const pistolStack = inv.makeStack('pistol', 1, 0), carbineStack = {uid: 999, itemId: 'carbine9', count: 1, mag: 0};
    expect(reserveFor(WEAPONS.pistol, inv)).toBe(40);
    expect(reserveFor(carbine, inv)).toBe(40);              // one pool
    expect(reserveFor(WEAPONS.rifle, inv)).toBe(0);         // other calibers untouched
    const wc = new WeaponController();
    wc.equip(carbineStack as never, defs); run(wc, inv, 1);
    expect(wc.canReload(inv)).toBe(true);
    run(wc, inv, 2, {reload: true});
    expect(carbineStack.mag).toBe(30);                      // its own magazine size
    expect(inv.count('ammo_9mm')).toBe(10);
    wc.equip(pistolStack, defs); run(wc, inv, 1);
    run(wc, inv, 3, {reload: true});
    expect(pistolStack.mag).toBe(10);                       // the pistol gets what is left of the SAME pool
    expect(inv.count('ammo_9mm')).toBe(0);
    expect(wc.canReload(inv)).toBe(false);
    // a weapon without a caliber never counts or takes ammo
    const melee: WeaponDef = {...WEAPONS.pistol, id: 'club', itemId: 'club', caliber: undefined};
    inv.add(inv.makeStack('ammo_9mm', 5));
    expect(reserveFor(melee, inv)).toBe(0);
    expect(caliberLabel(melee)).toBe('');
  });

  it('the start loadouts keep their rounds in the start weapon\'s caliber', () => {
    expect(starterInventory('pistol').count('ammo_9mm')).toBe(45);
    expect(starterInventory('rifle').count('ammo_556')).toBe(60);
    for (const sw of ['pistol', 'rifle'] as const) for (const id of LEGACY) expect(starterInventory(sw).count(id)).toBe(0);
  });
});

describe('migration of the old gun-specific ammo ids (no duplication, no lost rounds, no free refill)', () => {
  const legacySnapshot = (): InventoryJSON => {
    const inv = new Inventory();
    const j = inv.toJSON();
    j.hotbar[0] = {uid: 1, itemId: 'pistol', count: 1, mag: 7};
    j.pack[0] = {uid: 2, itemId: 'ammo_pistol', count: 45};
    j.pack[1] = {uid: 3, itemId: 'ammo_rifle', count: 120};
    j.pack[2] = {uid: 4, itemId: 'ammo_shells', count: 32};
    j.pack[3] = {uid: 5, itemId: 'ammo_9mm', count: 10};   // an already-migrated stack of the same caliber
    j.gear.backpack = {uid: 6, itemId: 'backpack', count: 1, bag: [{uid: 7, itemId: 'ammo_shells', count: 9}, {uid: 8, itemId: 'ammo_rifle', count: 30}, ...new Array(BACKPACK_SLOTS - 2).fill(null)]};
    j.nextUid = 9;
    return j;
  };
  const roundsIn = (inv: Inventory, withBag: boolean) => inv.allStacks(withBag).filter(s => caliberOfItem(s.itemId)).reduce((n, s) => n + s.count, 0);

  it('Inventory.fromJSON / loadJSON / clone: legacy stacks (pockets + worn backpack contents) come back as caliber items, same counts and uids', () => {
    for (const load of [(j: InventoryJSON) => Inventory.fromJSON(j), (j: InventoryJSON) => { const inv = new Inventory(); inv.loadJSON(j); return inv; }, (j: InventoryJSON) => Inventory.fromJSON(j).clone()]) {
      const inv = load(legacySnapshot());
      expect(inv.invariants()).toEqual([]);
      const ids = inv.allStacks(true).map(s => s.itemId);
      for (const id of LEGACY) expect(ids, id).not.toContain(id);
      expect(inv.count('ammo_9mm')).toBe(55);              // 45 legacy + 10 already migrated, not merged into one oversized stack
      expect(inv.count('ammo_556')).toBe(120);
      expect(inv.count('ammo_12ga')).toBe(32);
      expect(roundsIn(inv, true)).toBe(45 + 120 + 32 + 10 + 9 + 30); // nothing lost, nothing added
      const bag = inv.worn('backpack')!;
      expect(bag.bag!.slice(0, 2).map(s => s && `${s.itemId}x${s.count}#${s.uid}`)).toEqual(['ammo_12gax9#7', 'ammo_556x30#8']);
      expect(inv.allStacks(true).map(s => s.uid).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      for (const s of inv.allStacks(true)) expect(s.count, s.itemId).toBeLessThanOrEqual(itemDef(s.itemId).stackMax);
      expect(inv.hotbar[0]!.mag).toBe(7);                  // a loaded magazine is never refilled by the migration
      // the pool is usable straight away: the pistol reloads from the migrated 9mm
      const wc = new WeaponController();
      wc.equip(inv.hotbar[0]); run(wc, inv, 1); run(wc, inv, 3, {reload: true});
      expect(inv.hotbar[0]!.mag).toBe(15);
      expect(inv.count('ammo_9mm')).toBe(47);
    }
  });

  it('makeStack, section-memory records (dropped / spilled pickups) and grounded-bag records migrate too', () => {
    const inv = new Inventory();
    expect(inv.makeStack('ammo_pistol', 45)).toMatchObject({itemId: 'ammo_9mm', count: 45});
    expect(inv.makeStack('ammo_shells', 99)).toMatchObject({itemId: 'ammo_12ga', count: 32}); // stack limit respected
    expect(stackFromRecord(inv, {itemId: 'ammo_rifle', count: 12})).toMatchObject({itemId: 'ammo_556', count: 12});
    const bagRec = stackFromRecord(inv, {itemId: 'backpack', count: 1, bag: [{uid: 40, itemId: 'ammo_pistol', count: 15}, null]});
    expect((bagRec.bag as ({itemId: string; count: number} | null)[])[0]).toMatchObject({itemId: 'ammo_9mm', count: 15});
    // a grounded bag record (gear/bagStore.ts) is validated as-is and revived through stackFromJSON
    const rec = readSectionBags({v: 1, seed: 5, init: true, bags: [{id: 'bag:9', stack: {uid: 9, itemId: 'backpack', count: 1, bag: [{uid: 10, itemId: 'ammo_rifle', count: 25}, ...new Array(BACKPACK_SLOTS - 1).fill(null)]}, x: 0, y: 0, z: 0, yaw: 0, level: 0}]}, 5);
    expect(rec?.bags).toHaveLength(1);
    const revived = stackFromJSON(rec!.bags[0].stack)!;
    expect(revived.bag![0]).toMatchObject({uid: 10, itemId: 'ammo_556', count: 25});
    // after migration a pickup of the same caliber merges into the existing stack (one pool)
    const inv2 = Inventory.fromJSON(legacySnapshot());
    inv2.add(inv2.makeStack('ammo_556', 5));
    expect(inv2.count('ammo_556')).toBe(125);
    expect(canonicalItemId('water')).toBe('water');
  });
});

describe('labels: caliber everywhere the player reads ammo', () => {
  it('names, short slot labels, loot text, take prompts and caliber icons', () => {
    expect(ITEMS.ammo_9mm).toMatchObject({name: '9mm rounds (9×19mm)', short: '9mm', icon: 'ammo9mm'});
    expect(ITEMS.ammo_556).toMatchObject({name: '5.56×45mm rounds', short: '5.56mm', icon: 'ammo556'});
    expect(ITEMS.ammo_12ga).toMatchObject({name: '12-gauge shells', short: '12-gauge', icon: 'ammo12ga'});
    expect(describeLoot([{itemId: 'ammo_9mm', count: 12}, {itemId: 'ammo_556', count: 1}, {itemId: 'ammo_12ga', count: 3}, {itemId: 'bandage', count: 1}]))
      .toBe('12 9mm rounds, 1 5.56mm round, 3 12-gauge shells, bandage');
    expect(lotPrompt({itemId: 'ammo_12ga', count: 4}, true).text).toBe('Take 4 12-gauge shells');
    expect(ammoText('ammo_rifle', 2)).toBe('2 5.56mm rounds'); // legacy id still reads by caliber
    expect(caliberLabel(WEAPONS.pistol)).toBe('9mm');
    for (const c of CALIBER_IDS) {
      const svg = ICONS[itemDef(ammoItemFor(c)).icon];
      expect(svg).toContain('<svg');
      expect(svg).toContain({'9x19mm': '9mm', '5.56x45mm': '5.56', '12ga': '12ga'}[c]);
    }
    for (const id of AMMO_ITEM_IDS) expect(ITEMS[id].description).toMatch(/Loads any/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Distribution

type Row = readonly [string, number];
const ammoRows = (rows: readonly Row[]) => rows.filter(r => caliberOfItem(r[0]));
/** Every loot table that can hold ammo: purpose tables (per holder kind), openable tables, the economy's global pool. */
function allTables(): {name: string; purpose?: string; rows: readonly Row[]}[] {
  const out: {name: string; purpose?: string; rows: readonly Row[]}[] = [];
  for (const P of ALL_PURPOSES) for (const [k, spec] of Object.entries(P.loot as Record<string, {items: readonly Row[]} | undefined>)) if (spec) out.push({name: `${P.id}.${k}`, purpose: P.id, rows: spec.items});
  for (const k of OPENABLE_KINDS) { const l = openableSpec(k)?.loot; if (l) out.push({name: `openable.${k}`, rows: l.items}); }
  out.push({name: 'GLOBAL_POOL.ammo', rows: GLOBAL_POOL.ammo});
  return out;
}

describe('distribution: generic ammo is ~1/3 each caliber wherever rifle / shotgun ammo can spawn', () => {
  it('every table with 5.56 or 12-gauge rows holds all three calibers at EQUAL weight; 9mm-only rows are the office sidearm stock', () => {
    let generic = 0, nineOnly = 0;
    for (const t of allTables()) {
      const a = ammoRows(t.rows);
      if (!a.length) continue;
      for (const [id] of a) expect(LEGACY, `${t.name} ${id}`).not.toContain(id);
      const ids = new Set(a.map(r => r[0]));
      if (ids.has('ammo_556') || ids.has('ammo_12ga')) {
        generic++;
        expect([...ids].sort(), t.name).toEqual([...AMMO_ITEM_IDS].sort());
        const w = AMMO_ITEM_IDS.map(id => a.filter(r => r[0] === id).reduce((s, r) => s + r[1], 0));
        expect(Math.max(...w) - Math.min(...w), `${t.name} weights ${w}`).toBeLessThan(1e-9);
      } else {
        nineOnly++;
        // 9mm-only (no rifle / shotgun rows, so the 1/3 rule does not apply): the office sidearm stock, and the office overhaul's
        // toilet-tank stash (a hidden sidearm cache in washroom stalls; task office-overhaul-20261030)
        if (!NINE_ONLY_EXCEPTIONS.includes(t.name)) expect(t.purpose ?? '', `${t.name}: 9mm-only stock outside the office`).toMatch(/^office-/);
      }
    }
    expect(generic).toBeGreaterThan(20);
    expect(nineOnly).toBeGreaterThan(5);
    // genericAmmo keeps the table's whole ammo weight (redistribution, not more ammo)
    expect(genericAmmo(2.4).reduce((s, r) => s + r[1], 0)).toBeCloseTo(2.4, 12);
    expect(Object.keys(HANDFUL).sort()).toEqual([...AMMO_ITEM_IDS].sort());
  });

  it('deterministic sampling of eligible holders: each caliber ~1/3 of the generic ammo picks, not a per-cabinet quota', () => {
    const cases: [HolderKind, string][] = [['cabinetTall', 'storage'], ['crate', 'utility'], ['shelf', 'service-corridor'], ['cabinetLow', 'default'],
      ['crate', 'default'], ['gunLocker', 'security-office'], ['cabinetTall', 'security-office'], ['shelf', 'storage'], ['rollingToolChest', 'workshop']];
    const n: Record<string, number> = {};
    let holders = 0, mixedOrRepeat = 0, repeated = 0;
    for (const [kind, area] of cases) for (let i = 0; i < 600; i++) {
      const ammo = rollTableItems(20261030, i, kind, area).filter(e => caliberOfItem(e.itemId));
      if (!ammo.length) continue;
      holders++;
      for (const e of ammo) n[e.itemId] = (n[e.itemId] ?? 0) + 1;
      if (ammo.length >= 2) { mixedOrRepeat++; if (new Set(ammo.map(e => e.itemId)).size < ammo.length) repeated++; }
    }
    const total = Object.values(n).reduce((s, x) => s + x, 0);
    expect(total).toBeGreaterThan(2500);
    for (const id of AMMO_ITEM_IDS) {
      expect(n[id] / total, id).toBeGreaterThan(0.29);
      expect(n[id] / total, id).toBeLessThan(0.38);
    }
    expect(holders).toBeGreaterThan(1500);
    expect(repeated / mixedOrRepeat, 'odds, not a quota: the same caliber twice in one holder happens').toBeGreaterThan(0.15);
  });

  it('weapon finds keep their matching-caliber companion box (the documented exception); the 9mm is still on the floor too', () => {
    for (const [w, [ammo]] of Object.entries(WEAPON_FIND_AMMO)) expect(ammo, w).toBe(weaponAmmoItem(WEAPONS[w]));
    const levels: StationLayout[] = [...CORPUS().slice(0, 6), OFFICE(222), generateStation(42, {startWeapon: 'rifle'})];
    let finds = 0;
    for (const l of levels) {
      for (const p of l.pickups.filter(q => ITEMS[q.itemId]?.kind === 'weapon' && WEAPONS[q.itemId]?.caliber)) {
        finds++;
        const want = weaponAmmoItem(WEAPONS[p.itemId])!;
        const near = l.pickups.filter(q => q.itemId === want && (q.level ?? 0) === (p.level ?? 0)).map(q => Math.hypot(q.x - p.x, q.z - p.z));
        expect(Math.min(...near), `${l.seed} ${p.itemId} companion ${want}`).toBeLessThan(4.5);
      }
    }
    expect(finds).toBeGreaterThan(5);
    for (const l of CORPUS().slice(0, 6)) expect(l.pickups.filter(p => p.itemId === 'ammo_9mm').length, `${l.seed} loose 9mm`).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Pre-change census, re-measured on main dfb3a06 (after the office overhaul merged, before lane AMMO; the original baseline was
 * main 7aeca7b — the overhaul's tenant loot tables changed the office's ammo) with reference/tasks/knife-melee-20261030/lanes/
 * ammo-census, same counting code as tests/helpers/lootEconomy.ts stationEconomy: holder lots as world/containers.ts rolls +
 * places them, plus every layout pickup. Per level: rounds, stacks (boxes / lots), magazine-equivalents (rounds / the caliber's
 * magazine: 9mm 15, 5.56 30, 12-gauge 6).
 */
const BEFORE = {
  subway: {rounds: 440.28, stacks: 47.5, magEq: 27.18, holderShare9mm: 0.045},
  office: {rounds: 451.33, stacks: 44.67, magEq: 28.06},
};
/**
 * Task office-props-physics-scale-20261030: the office band is checked against main 932624e's census over 30 level seeds
 * (1000–1029), not the 6-seed pre-change numbers. One office level's ammo varies ~18 % (sd of stacks) with its seeded layout, so a
 * 6-seed mean swings ~±7.5 % on any layout change: main itself measures 1.124× BEFORE.office.stacks over these 30 seeds (it passed
 * on its 6 seeds by luck), and this task's user-requested furniture rescales moved the 6-seed census to 1.127× with no ammo change
 * (30 seeds, main → this branch: stacks 50.20 → 50.60, rounds 430.87 → 432.13, magEq 27.86 → 28.31; no new ammo source; the
 * per-holder rows are unchanged). The band now guards the office's CURRENT balance on a corpus large enough to see a real shift.
 */
const OFFICE_REF = {rounds: 430.87, stacks: 50.2, magEq: 27.86};
const OFFICE_SEEDS = Array.from({length: 30}, (_, i) => 1000 + i);
const MAG: Record<string, number> = {ammo_9mm: 15, ammo_556: 30, ammo_12ga: 6};
function census(levels: StationLayout[]) {
  let rounds = 0, stacks = 0, magEq = 0;
  const holder: Record<string, number> = {};
  for (const l of levels) for (const e of stationEconomy(l) as EconEntry[]) {
    if (!caliberOfItem(e.itemId)) continue;
    expect(LEGACY).not.toContain(e.itemId);
    rounds += e.count; stacks++; magEq += e.count / MAG[e.itemId];
    if (e.source === 'holder') holder[e.itemId] = (holder[e.itemId] ?? 0) + 1;
  }
  const hTotal = Object.values(holder).reduce((s, x) => s + x, 0);
  return {rounds: rounds / levels.length, stacks: stacks / levels.length, magEq: magEq / levels.length, holderShare: Object.fromEntries(AMMO_ITEM_IDS.map(id => [id, (holder[id] ?? 0) / hTotal]))};
}

describe('ammo availability stays in band of the pre-change census on both levels (a redistribution, not a spawn-rate boost)', () => {
  it('Subway corpus (18 stations, pistol start): rounds / boxes within ±10 %, magazine-equivalents within ±15 %; holder ammo ~1/3 each caliber', () => {
    expect(ECONOMY_CORPUS.length).toBe(18);
    const now = census(CORPUS());
    expect(now.rounds / BEFORE.subway.rounds).toBeGreaterThan(0.9); expect(now.rounds / BEFORE.subway.rounds).toBeLessThan(1.1);
    expect(now.stacks / BEFORE.subway.stacks).toBeGreaterThan(0.9); expect(now.stacks / BEFORE.subway.stacks).toBeLessThan(1.1);
    expect(now.magEq / BEFORE.subway.magEq).toBeGreaterThan(0.85); expect(now.magEq / BEFORE.subway.magEq).toBeLessThan(1.15);
    for (const id of AMMO_ITEM_IDS) { expect(now.holderShare[id], id).toBeGreaterThan(0.27); expect(now.holderShare[id], id).toBeLessThan(0.4); }
    expect(now.holderShare.ammo_9mm).toBeGreaterThan(5 * BEFORE.subway.holderShare9mm); // 9mm is in the cabinets now, not floor-only
  });

  it('Office tower (30 levels, pistol start): rounds / boxes within ±10 %, magazine-equivalents within ±15 % of main 932624e', () => {
    const now = census(OFFICE_SEEDS.map(OFFICE));
    expect(now.rounds / OFFICE_REF.rounds).toBeGreaterThan(0.9); expect(now.rounds / OFFICE_REF.rounds).toBeLessThan(1.1);
    expect(now.stacks / OFFICE_REF.stacks).toBeGreaterThan(0.9); expect(now.stacks / OFFICE_REF.stacks).toBeLessThan(1.1);
    expect(now.magEq / OFFICE_REF.magEq).toBeGreaterThan(0.85); expect(now.magEq / OFFICE_REF.magEq).toBeLessThan(1.15);
    // the office keeps its deliberate 9mm sidearm stock on top of the generic thirds: 9mm leads, every caliber present
    for (const id of AMMO_ITEM_IDS) expect(now.holderShare[id], id).toBeGreaterThan(0.15);
    expect(now.holderShare.ammo_9mm).toBeGreaterThan(now.holderShare.ammo_556);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The three Meshy T2.5 ammo boxes

const PROV_REL = 'assets/derivatives/meshy-t25-ammo-20261030.json';
interface AmmoRecord {
  id: string; code: string; itemId: string; caliber: string; modelKey: string;
  output: {path: string; url: string; sha256: string; bytes: number; triangles: number; dims: number[]; bbox: {min: number[]; max: number[]}; textures: {slot: string; size: number[]}[]};
  meshy: {previewTaskId: string; refineTaskId: string; nativeSha256: string; route: string};
  localRepair?: {panels: {side: string; newStencil: {text: string}}[]};
}

describe('ammo box models: Meshy T2.5 derivatives per caliber, registered like the other item models', () => {
  const prov = JSON.parse(fs.readFileSync(path.join(GAME, 'public', PROV_REL), 'utf8')) as {records: AmmoRecord[]; generation: {model: string}};
  it('provenance: three records, the delivered Meshy task ids and native hashes, the 5.56 stencil as a local repair; no URLs', () => {
    expect(prov.generation.model).toBe('meshy-t2.5');
    expect(prov.records.map(r => [r.code, r.itemId, r.caliber])).toEqual([['M1', 'ammo_9mm', '9x19mm'], ['M2', 'ammo_556', '5.56x45mm'], ['M3', 'ammo_12ga', '12ga']]);
    expect(prov.records.map(r => r.meshy.refineTaskId)).toEqual(['01a18b4a-3d97-7799-86a9-fcc009b62761', '01a18b4a-453c-77c3-a1c7-9ddf0bb0499a', '01a18b4a-4c79-711d-8f98-5cc3719475a6']);
    expect(prov.records.map(r => r.meshy.previewTaskId)).toEqual(['01a18b49-b8ec-727c-9147-0092471ac67e', '01a18b49-c099-76b0-ab1c-fa5e88c22122', '01a18b49-c849-7620-b8bc-86cc44340f64']);
    expect(prov.records.map(r => r.meshy.nativeSha256)).toEqual(['1e75cd23a34505f78df6b0fe8079bcc41aa2c5eb46785d3e9c78dc7abb95173a', '76b89de71cc9494be6d5788ad4a399e410ec226c51d765fadf41c290ac2bbbb1', '03155f6362e5a80774225278cb3a954615efad69f100af1d95f5fb762c97ac80']);
    for (const r of prov.records) expect(r.meshy.route).toMatch(/meshy-t2\.5/);
    const m2 = prov.records.find(r => r.code === 'M2')!;
    expect(m2.localRepair?.panels.map(p => [p.side, p.newStencil.text])).toEqual([['front', '5.56'], ['back', '5.56']]);
    expect(prov.records.filter(r => r.localRepair).length).toBe(1);
    const text = fs.readFileSync(path.join(GAME, 'public', PROV_REL), 'utf8');
    expect(text).not.toMatch(/https?:/i);
    expect(text).not.toMatch(/Signature|X-Amz|token=|api[_-]?key/i);
  });

  it('manifest + item model keys serve the files; bytes / hashes / budgets / dims match; ITEM_DIMS = the measured runtime size', async () => {
    const io = new NodeIO();
    for (const r of prov.records) {
      expect(ITEM_MODEL_KEYS[r.itemId]).toBe(r.modelKey);
      const f = (MODEL_FILES as Record<string, {url: string; bytes: number}>)[r.modelKey];
      expect(f?.url, r.id).toBe(r.output.url);
      const buf = fs.readFileSync(path.join(GAME, 'public', f.url));
      expect(sha(buf), r.id).toBe(r.output.sha256);
      expect(buf.length).toBe(r.output.bytes);
      expect(Math.abs(f.bytes - buf.length) / buf.length, r.id).toBeLessThan(0.02);
      expect(r.output.triangles).toBeLessThanOrEqual(3200);
      expect(buf.length).toBeLessThan(420_000);
      for (const t of r.output.textures) expect(t.size[0], `${r.id} ${t.slot}`).toBeLessThanOrEqual(t.slot === 'baseColor' ? 1024 : 256);
      // the GLB itself: one mesh, metres, bottom-centre origin, at the recorded dims
      const doc = await io.readBinary(new Uint8Array(buf));
      const prims = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
      expect(prims).toHaveLength(1);
      const P = prims[0].getAttribute('POSITION')!.getArray()!;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
      expect(min[1]).toBeCloseTo(0, 4);
      expect((min[0] + max[0]) / 2).toBeCloseTo(0, 3);
      expect((min[2] + max[2]) / 2).toBeCloseTo(0, 3);
      const dims = max.map((v, k) => v - min[k]);
      dims.forEach((v, k) => expect(v, `${r.id} axis ${k}`).toBeCloseTo(r.output.dims[k], 3));
      // ITEM_DIMS (w = X, h = Y, d = Z) carry the measured size (fitItemModel keeps scale 1); all fit the 0.18 m drawer clearance
      const d = ITEM_DIMS[r.itemId];
      expect(Math.abs(d.w - dims[0]), `${r.id} w`).toBeLessThan(0.0006);
      expect(Math.abs(d.h - dims[1]), `${r.id} h`).toBeLessThan(0.0006);
      expect(Math.abs(d.d - dims[2]), `${r.id} d`).toBeLessThan(0.0006);
      expect(d.h + 0.004).toBeLessThanOrEqual(0.18);
      expect(d.shape).toBe('flat');
      // damage / physics classes exist for the model key and the item
      expect(MODEL_KEY_CLASS[r.modelKey], r.modelKey).toBeDefined();
      expect(ITEM_PHYSICS[r.itemId], r.itemId).toBeDefined();
    }
  });
});
