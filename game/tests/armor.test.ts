// Task studio-general-armor-20261107-231448-01 (user: "lets simplify clothing armor ... simply have clothing give you armor similar to what
// it does now, but not specific to any piece of the body"): ONE armour pool from the WORN gear (player/armor.ts) — pips of 2.5 %, shown in
// half pips rounded down, ten a row wrapping with a 25 % overlap; it cuts every hit by its share on any body part, it is the chance an
// injury the game would give an unarmoured player does not happen (one save roll), and a hit it mitigated wears ONE contributing item
// (the amount is the user's pending answer A: off until set). Wear lives on the item and survives every inventory / save route.
import fs from 'node:fs';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {mulberry32} from '../src/core/rng';
import {
  ARMOR, ARMOR_REDUCES_ENVIRONMENT, ARMOR_WEAR_PER_HIT, armorContributors, armorHit, armorPool, displayHalfPips, injurySaved, itemArmor,
  pipRows, pipsText, wearOne,
} from '../src/player/armor';
import {ARMOR_CAP} from '../src/player/modifiers';
import {incomingHit, type PlayerHit, type ResolvedHit} from '../src/player/hits';
import {InjurySystem, hitInjuryChance, installInjuries, type InjuryHost} from '../src/player/injuries';
import {GEAR_ITEMS, GEAR_SLOTS, gearSpec, gearStatText, type GearSlot} from '../src/items/gear';
import {Inventory, stackFromJSON, stackToJSON, type ItemStack} from '../src/items/inventory';
import {TrainLockbox} from '../src/run/trainLockbox';
import {stackFromRecord, stackRecord} from '../src/run/worldMemory';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {checksumOf} from '../src/save/checksum';
import {Harness, fixtureCampaign} from './helpers/saveFixture';
import {FakeEl, installFakeDom, type FakeDom} from './helpers/fakeDom';

const src = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const stack = (itemId: string, uid = 1, armor?: number): ItemStack => ({itemId, count: 1, uid, ...(armor === undefined ? {} : {armor})});
const worn = (o: Partial<Record<GearSlot, ItemStack>>) => o;
const kit = () => worn({helmet: stack('helmet', 1), chest: stack('armor_vest', 2), boots: stack('boots', 3), gloves: stack('gloves', 4)});
const hit = (o: Partial<PlayerHit> = {}): PlayerHit => ({amount: 20, source: 'zombie', location: 'torso', ...o});
/** Rolls from a list (then 0.999 = never). */
const seq = (...v: number[]) => () => (v.length ? v.shift()! : 0.999);

describe('the armour pool: what counts, its units and the display', () => {
  it('vest 4 pips (10 %), hard hat 1 pip (2.5 %): ~ the old expected protection (torso 50 % x 20 % + head 10 % x 25 % = 12.5 %), not the sum of old maxima', () => {
    expect([ARMOR.pip, ARMOR.halfPip, ARMOR.pipsPerRow, ARMOR.rowOverlap]).toEqual([0.025, 0.0125, 10, 0.25]);
    expect(gearSpec('armor_vest')!.armor).toBe(0.1);
    expect(gearSpec('helmet')!.armor).toBe(0.025);
    expect(armorPool(kit())).toBeCloseTo(0.125, 12);
    expect(pipsText(armorPool(kit()))).toBe('5');
    expect(armorPool({})).toBe(0);
  });

  it('only WORN gear in its own slot counts; boots / gloves / bags / the mask add nothing; the cap is the existing 0.8', () => {
    const c = armorContributors(kit());
    expect(c.map(x => [x.slot, x.armor])).toEqual([['helmet', 0.025], ['chest', 0.1]]);
    expect(armorPool({chest: stack('helmet'), helmet: stack('armor_vest')})).toBe(0); // wrong slots
    const inv = new Inventory();
    expect(inv.add(inv.makeStack('armor_vest', 1))).toBe(0); // worn at once (an empty chest slot)
    const spare = inv.makeStack('armor_vest', 1);
    expect(inv.add(spare)).toBe(0);
    expect(inv.find(spare.uid)?.bar).toBe('pack'); // a second vest in the pockets adds nothing
    expect(armorPool(inv.gear)).toBeCloseTo(0.1, 12);
    expect(ARMOR.cap).toBe(ARMOR_CAP);
    expect(ARMOR_CAP).toBe(0.8);
    expect(injurySaved(5, 0.85)).toBe(false); // even a (hypothetical) huge pool saves at most 80 %
  });

  it('registry-driven: EVERY gear definition with armour > 0 joins the pool when worn (present and future kinds; no id list)', () => {
    const armoured = Object.values(GEAR_ITEMS).filter(d => (d.gear!.armor ?? 0) > 0);
    expect(armoured.length).toBeGreaterThan(0);
    for (const d of armoured) {
      expect(armorPool({[d.gear!.slot]: stack(d.id)})).toBeCloseTo(Math.min(ARMOR.cap, d.gear!.armor!), 12);
      expect(gearStatText(d.gear!)).toMatch(/^armor \d+½? pips? \([\d.]+ %\)/);
    }
    expect(src('player/armor.ts')).not.toMatch(/'armor_vest'|'helmet'/);
  });

  it('half-pip display, rounded DOWN; the stored value keeps its fraction', () => {
    expect([0, 0.0124, 0.0125, 0.025, 0.1, 0.11875, 0.125, 0.25].map(displayHalfPips)).toEqual([0, 0, 1, 2, 8, 9, 10, 20]);
    expect([0, 0.0125, 0.025, 0.11875, 0.125].map(pipsText)).toEqual(['0', '½', '1', '4½', '5']);
    expect(itemArmor(stack('armor_vest', 1, 0.09375))).toBe(0.09375); // never quantized
    expect(itemArmor(stack('armor_vest', 1, 0.5))).toBe(0.1); // clamped to its own full armour
    expect(itemArmor(stack('boots', 1, 0.1))).toBe(0); // no armour on a non-armour item
  });

  it('ten pips a row; more rows stack on the first; the last half pip is a half', () => {
    expect(pipRows(0)).toEqual([]);
    expect(pipRows(0.0125)).toEqual([['half']]);
    expect(pipRows(0.125)).toEqual([Array(5).fill('full')]);
    expect(pipRows(0.25)).toEqual([Array(10).fill('full')]);
    expect(pipRows(0.2625)).toEqual([Array(10).fill('full'), ['half']]);
    expect(pipRows(0.5).map(r => r.length)).toEqual([10, 10]);
    expect(pipRows(0.8).map(r => r.length)).toEqual([10, 10, 10, 2]); // the cap: 32 pips
  });
});

describe('damage: one share off every hit, any body part, after the enemy x2', () => {
  it('a 12.5 % pool takes 12.5 % off a head, torso, arm or leg hit; the enemy x2 comes first', () => {
    for (const location of ['head', 'torso', 'arm', 'leg'] as const) {
      const {resolved} = armorHit(incomingHit(hit({amount: 10, location, enemy: true})), kit(), seq(), null);
      expect(resolved.amount).toBe(20);
      expect(resolved.applied).toBeCloseTo(17.5, 9);
      expect(resolved.absorbed).toBeCloseTo(2.5, 9);
      expect(resolved.armor).toBeCloseTo(0.125, 12);
    }
    const bare = armorHit(hit(), {}, seq(), 0.0125);
    expect([bare.resolved.applied, bare.resolved.absorbed, bare.resolved.armor, bare.wore]).toEqual([20, 0, 0, null]);
  });

  it('scope B is pending: until answered the gas field and the empty-vitals drain keep their existing (unarmoured) rules', () => {
    expect([null, true, false]).toContain(ARMOR_REDUCES_ENVIRONMENT);
    if (ARMOR_REDUCES_ENVIRONMENT !== true) {
      expect(src('world/gas/system.ts')).toMatch(/pl\.takeDamage\(dps \* dt\)/);
      expect(src('game.ts')).toMatch(/if \(surv\.hpLoss > 0\) p\.takeDamage\(surv\.hpLoss\);/);
    }
  });
});

describe('the injury save: one roll against the pool on the UNARMOURED candidate', () => {
  const r = (o: Partial<ResolvedHit>): ResolvedHit => ({amount: 15, applied: 15, absorbed: 0, source: 'zombie', location: 'arm', ...o});

  it('the candidate is the raw hit (armour does not lower it), then the save: roll < pool cancels it', () => {
    expect(hitInjuryChance(r({applied: 11.25, absorbed: 3.75, armor: 0.25}))).toBeCloseTo(hitInjuryChance(r({})), 12);
    expect([injurySaved(0.25, 0.2), injurySaved(0.25, 0.25), injurySaved(0, 0)]).toEqual([true, false, false]);
    // candidate roll 0 (injures), save roll 0.2 < 0.25: saved
    let s = new InjurySystem(seq(0, 0.2));
    expect(s.onHit(r({armor: 0.25}))).toBeNull();
    expect([s.saves, s.lastSave]).toEqual([1, 'arm']);
    // candidate roll 0, save roll 0.3: injured (then the side roll)
    s = new InjurySystem(seq(0, 0.3, 0));
    expect(s.onHit(r({armor: 0.25}))).toBe('arm');
    expect(s.saves).toBe(0);
    // no candidate (roll 0.9 >= 0.33): no save roll is drawn at all
    let draws = 0;
    s = new InjurySystem(() => { draws++; return 0.9; });
    expect(s.onHit(r({armor: 0.25}))).toBeNull();
    expect(draws).toBe(1);
    // unarmoured: no save roll
    draws = 0;
    s = new InjurySystem(() => { draws++; return draws === 1 ? 0 : 0.5; });
    expect(s.onHit(r({}))).toBe('arm');
    expect(draws).toBe(2); // candidate + side
  });

  it('seeded: a 25 % pool leaves ~75 % of the unarmoured injury rate (hits and hard landings)', () => {
    const rng = mulberry32(2026);
    const n = 8000;
    let bare = 0, armoured = 0, landBare = 0, landArmoured = 0;
    for (let i = 0; i < n; i++) {
      if (new InjurySystem(rng).onHit(r({}))) bare++;
      if (new InjurySystem(rng).onHit(r({applied: 11.25, absorbed: 3.75, armor: 0.25}))) armoured++;
      if (new InjurySystem(rng).onLanding(12)) landBare++;
      if (new InjurySystem(rng).onLanding(12, 0.25)) landArmoured++;
    }
    expect(bare / n).toBeGreaterThan(0.33 - 0.02); expect(bare / n).toBeLessThan(0.33 + 0.02);
    expect(armoured / n).toBeGreaterThan(0.33 * 0.75 - 0.02); expect(armoured / n).toBeLessThan(0.33 * 0.75 + 0.02);
    expect(landArmoured / landBare).toBeGreaterThan(0.75 - 0.05); expect(landArmoured / landBare).toBeLessThan(0.75 + 0.05);
  });

  it('the game wires it: the landing save reads the worn pool; a hit carries its own snapshot', () => {
    expect(src('game.ts')).toMatch(/installInjuries\(this, \{aiming: \(\) => this\.aiming, armor: \(\) => armorPool\(this\.inv\.gear\)\}\)/);
    const host = {modifierSources: [], hitListeners: [], frameHooks: [] as ((dt: number) => void)[], aimOffset: {yaw: 0, pitch: 0}, mods: {swayAmp: 0, swayHz: 0},
      player: {alive: true, justLanded: true, landSpeed: 12, sprinting: false, crouched: false, stamina: 100}, hud: {toast() {}}, sfx: {hurt() {}}} as unknown as InjuryHost;
    const sys = new InjurySystem(seq(0, 0.1));
    installInjuries(host, {aiming: () => false, armor: () => 0.125}, sys);
    for (const f of host.frameHooks) f(0.016);
    expect(sys.saves).toBe(1);
    expect(sys.limbs.leg).toBeFalsy();
  });
});

describe('wear: ONE worn contributing item per mitigating hit (amount = pending answer A)', () => {
  it('the amount is the user\'s pending answer — a quarter pip or a half pip — never guessed: null = off', () => {
    expect([null, ARMOR.pip / 4, ARMOR.halfPip]).toContain(ARMOR_WEAR_PER_HIT);
    const w = kit();
    expect(armorHit(hit(), w, seq(0), null).wore).toBeNull();
    expect(wearOne(w, 0, null)).toBeNull();
    expect(armorPool(w)).toBeCloseTo(0.125, 12);
  });

  for (const amount of [ARMOR.pip / 4, ARMOR.halfPip]) {
    it(`with ${amount * 100} % per hit: the pool snapshot is taken before the wear; one item, picked uniformly among contributors; clamped at 0`, () => {
      const w = kit();
      const {resolved, wore} = armorHit(hit(), w, seq(0), amount);
      expect(resolved.armor).toBeCloseTo(0.125, 12); // this hit was cut by the full pool
      expect(resolved.applied).toBeCloseTo(17.5, 9);
      expect(wore).toEqual({slot: 'helmet', before: 0.025, after: +(0.025 - amount).toFixed(6)});
      expect(armorPool(w)).toBeCloseTo(0.125 - amount, 9); // the NEXT hit sees less
      expect(w.boots!.armor).toBeUndefined(); // non-contributors never wear
      // uniform: rolls across [0, 1) split between the two contributors
      const count: Record<string, number> = {};
      for (let i = 0; i < 100; i++) { const x = kit(); const s = wearOne(x, (i + 0.5) / 100, amount)!.slot; count[s] = (count[s] ?? 0) + 1; }
      expect(count).toEqual({helmet: 50, chest: 50});
      // a worn-out item stops contributing and is never picked again; armour never goes negative
      const h = kit();
      for (let i = 0; i < 8 && h.helmet!.armor !== 0; i++) wearOne(h, 0, amount);
      expect(h.helmet!.armor).toBe(0);
      expect(wearOne({helmet: h.helmet!}, 0, amount)).toBeNull(); // nothing left to wear
      expect(armorContributors(h).map(c => c.slot)).toEqual(['chest']);
      expect(wearOne(h, 0, amount)!.slot).toBe('chest');
      // an unmitigated hit (no pool) wears nothing and draws no roll
      let draws = 0;
      expect(armorHit(hit(), {}, () => { draws++; return 0; }, amount).wore).toBeNull();
      expect(draws).toBe(0);
    });
  }

  it('per hit, never per frame: only Game.applyPlayerHit wears armour (no frame hook / dt)', () => {
    const users: string[] = [];
    const walk = (d: URL) => {
      for (const f of fs.readdirSync(d, {withFileTypes: true})) {
        const u = new URL(f.name + (f.isDirectory() ? '/' : ''), d);
        if (f.isDirectory()) walk(u);
        else if (f.name.endsWith('.ts') && /\b(armorHit|wearOne)\(/.test(fs.readFileSync(u, 'utf8'))) users.push(u.pathname.split('/src/')[1]);
      }
    };
    walk(new URL('../src/', import.meta.url));
    expect(users.sort()).toEqual(['game.ts', 'player/armor.ts']);
    expect(src('game.ts').match(/armorHit\(/g)).toHaveLength(1);
  });
});

describe('wear persists on the item: every inventory / storage / save route, no repair-on-equip', () => {
  const wornVest = (inv: Inventory) => { const v = inv.makeStack('armor_vest', 1); v.armor = 0.0875; return v; };

  it('take off / wear / swap keep the item\'s own armour; a fresh vest is full', () => {
    const inv = new Inventory();
    const v = wornVest(inv);
    expect(inv.add(v)).toBe(0);
    expect(armorPool(inv.gear)).toBeCloseTo(0.0875, 12);
    expect(inv.takeOff('chest')).toBe('moved');
    expect(inv.wearFrom(inv.find(v.uid)!)).toBe('moved');
    expect(armorPool(inv.gear)).toBeCloseTo(0.0875, 12);
    expect(inv.makeStack('armor_vest', 1).armor).toBeUndefined(); // new = undamaged
    expect(inv.invariants()).toEqual([]);
  });

  it('the common serializer and the save file: round trip (carry + Lockbox), old saves (no field) load undamaged, bad values refused', () => {
    expect(stackFromJSON(stackToJSON(stack('armor_vest', 7, 0.05)))!.armor).toBe(0.05);
    expect('armor' in stackToJSON(stack('armor_vest', 7))!).toBe(false); // undamaged writes nothing (old saves look the same)
    const h = new Harness(fixtureCampaign());
    h.inv.add(wornVest(h.inv));
    h.inv.add(h.inv.makeStack('helmet', 1));
    const boxed = h.inv.makeStack('armor_vest', 1);
    boxed.armor = 0.025;
    h.train.lockbox.slots[2] = boxed;
    const file = h.file('arrival', 1);
    const p = parseSaveText(saveFileText(file));
    expect(p.ok, p.ok ? '' : p.error).toBe(true);
    const v = (p as {value: SaveFileV1Like}).value;
    expect(v.run.carry.inventory.gear.chest).toMatchObject({itemId: 'armor_vest', armor: 0.0875});
    expect(v.run.carry.inventory.gear.helmet).not.toHaveProperty('armor');
    const back = new Inventory();
    back.loadJSON(structuredClone(v.run.carry.inventory));
    expect(armorPool(back.gear)).toBeCloseTo(0.1125, 12);
    expect(back.invariants()).toEqual([]);
    expect(JSON.stringify(v.run)).toContain('"armor":0.025'); // the Lockbox vest too
    // refused: armour on a non-armour item, out of range, not a number
    type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const rejects = (mut: (f: Any) => void, re: RegExp) => {
      const f = structuredClone(file) as Any;
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    rejects(f => { f.run.carry.inventory.gear.chest.armor = 0.2; }, /out of range/);
    rejects(f => { f.run.carry.inventory.gear.chest.armor = -0.01; }, /out of range/);
    rejects(f => { f.run.carry.inventory.gear.chest.armor = 'x'; }, /finite number/);
    rejects(f => { f.run.carry.inventory.hotbar[0] = {uid: 99999, itemId: 'water', count: 1, armor: 0.01}; }, /has no armour/);
  });

  it('the Lockbox, world memory (dropped / remembered) and the train cargo keep it', () => {
    const box = new TrainLockbox();
    box.slots[0] = stack('armor_vest', 5, 0.0625);
    const loaded = new TrainLockbox();
    loaded.load(structuredClone(box.toJSON()));
    expect(loaded.slots[0]!.armor).toBe(0.0625);
    loaded.load({v: 1, slots: [stack('armor_vest', 5, 3)]});
    expect(loaded.slots[0]!.armor).toBe(0.1); // clamped, never above its own full armour
    loaded.load({v: 1, slots: [stack('armor_vest', 5)]});
    expect(loaded.slots[0]!.armor).toBeUndefined(); // an old Lockbox: undamaged
    const inv = new Inventory();
    expect(stackFromRecord(inv, stackRecord(stack('armor_vest', 9, 0.075))).armor).toBe(0.075);
    expect(src('world/trainCargo.ts')).toMatch(/stack: stackToJSON\(r\.stack\)!/); // cargo uses the common serializer
    expect(src('gear/system.ts')).toMatch(/stack: stackToJSON\(b\.stack\)!/); // so do grounded bags
  });
});

describe('ui: blue pips above the health bar; the inventory names the pool', () => {
  let dom: FakeDom;
  beforeAll(() => { dom = installFakeDom(); });
  afterAll(() => dom.uninstall());

  it('pips in rows of ten, each further row 4.5 px up (6 px pips, 25 % overlap); written only on a visible change; hidden at 0', async () => {
    const {Hud} = await import('../src/ui/hud');
    const hud = new Hud();
    const bar = dom.el('#vitals .bar.health');
    const row = new FakeEl('div');
    bar.parent = row;
    const el = dom.el('#armor-pips');
    hud.setArmor(0.125);
    expect((el.innerHTML.match(/<i><\/i>/g) ?? []).length).toBe(5);
    expect(el.classList.contains('none')).toBe(false);
    expect(el.title).toMatch(/Armor 5 pips \(12\.5 %\)/);
    hud.setArmor(0.2625);
    expect(el.innerHTML.match(/class="arow" style="bottom:(\d+(?:\.\d+)?)px"/g)).toEqual(['class="arow" style="bottom:0px"', 'class="arow" style="bottom:4.5px"']);
    expect((el.innerHTML.match(/<i class="half"><\/i>/g) ?? []).length).toBe(1);
    expect(row.style.marginTop).toBe(`${6 + 3 + 6 + 4.5}px`);
    const html = el.innerHTML;
    el.innerHTML = 'sentinel';
    hud.setArmor(0.2625 + 0.005); // same half-pip count: no write
    expect(el.innerHTML).toBe('sentinel');
    el.innerHTML = html;
    hud.setArmor(0);
    expect(el.classList.contains('none')).toBe(true);
    expect(row.style.marginTop).toBe('');
    expect(src('ui/hud.ts')).toMatch(/#armor-pips i \{ height: [^;]+; box-sizing: border-box; background: #3d8fe0;/); // blue
    expect(src('game.ts')).toMatch(/armor: armorPool\(this\.inv\.gear\), \/\/ /);
  });

  it('item text: full and worn values in pips (half-pip steps) with the exact percent', () => {
    expect(gearStatText(gearSpec('armor_vest')!)).toBe('armor 4 pips (10 %)');
    expect(gearStatText(gearSpec('helmet')!)).toBe('armor 1 pip (2.5 %)');
    expect(gearStatText(gearSpec('armor_vest')!, {armor: 0.09375})).toBe('armor 3½ / 4 pips (9.38 %, worn)');
    expect(src('ui/inventoryUI.ts')).toMatch(/armorPool\(inv\.gear\)/);
    expect(GEAR_SLOTS).toContain('chest');
  });
});
