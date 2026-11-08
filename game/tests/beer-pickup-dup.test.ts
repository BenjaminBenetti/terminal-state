// Task studio-market-bar-20261108-225231-01 (lane BEER): LUCKY SWITCH PILSNER — "Pickup beer 10% duplicate chance 10 min". The ONE shared
// acquisition hook (market/beer/beerEffects.ts acquired): eligible sources (a holder's lot, a world pickup that was never the player's, a
// stolen ware, an untouched generated backpack) roll ONCE per source, durably and deterministically per run; never trades, Rail Ties,
// reactor parts, the bonus itself or the player's own dropped / moved items. A success clones exactly what was taken with FRESH uids (bag
// contents too) through the normal inventory add; what does not fit lies at the player's feet. The real Game.interact / takeFromHolder
// and MarketWares.steal paths call it.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {Inventory, stacksIn, type ItemStack} from '../src/items/inventory';
import {Survival} from '../src/player/survival';
import {BEER_TUNING} from '../src/items/beers';
import {BeerEffects, cloneFresh, dupEligibleItem, dupRoll, sourceHash, sourceKey, type BeerHost} from '../src/market/beer/beerEffects';
import {BEER_ROLLED_MAX} from '../src/market/beer/beerSave';
import type {AcquireSource} from '../src/market/beer/effectsApi';
import {MarketWares} from '../src/market/wares/wares';
import {MARKET_STALLS} from '../src/gen/market/marketTypes';
import {holderKey} from '../src/run/memory';

const {Game} = await import('../src/game');

const SEED = 11, SCOPE = 'st-07:main', HOLDER = holderKey('shelf', 0, 1.5, -2.25);

type Host = BeerHost & {toasts: string[]; floor: {stack: ItemStack; x: number; y: number; z: number}[]; bags: {id: string; stack: ItemStack}[]};
function host(inv = new Inventory()): Host {
  const toasts: string[] = [], floor: Host['floor'] = [], bags: Host['bags'] = [];
  return {
    survival: new Survival(), inv, player: {x: 3, y: 0.2, z: -4, yaw: 0.3}, state: 'playing', hud: {toast: t => { toasts.push(t); }},
    run: {current: {level: 'market', section: 'main', station: 'st-07'}, seeds: {subway: SEED}}, frameHooks: [], runParticipants: [], modifierSources: [],
    pickups: {add: (stack, x, y, z) => { floor.push({stack, x, y, z}); }}, layout: {grid: {stepAt: () => 0.2}},
    gear: {adoptBag: (id, stack) => { bags.push({id, stack}); }}, toasts, floor, bags,
  };
}
const pilsner = (h: Host) => { const b = new BeerEffects(h).install(); b.drink('beer_pilsner'); return b; };
/** The first lot id >= from whose roll in this run is (not) a success. */
function lotWhere(lucky: boolean, from = 0): number {
  for (let id = from; id < 10000; id++) if ((dupRoll(SEED, sourceKey(SCOPE, {kind: 'lot', holder: HOLDER, lot: id})!) < BEER_TUNING.pickupDupChance) === lucky) return id;
  throw new Error('no lot');
}
const lot = (id: number): AcquireSource => ({kind: 'lot', holder: HOLDER, lot: id});
const count = (inv: Inventory, id: string) => inv.count(id);

describe('the roll: once per eligible source, durable, deterministic, 10 %', () => {
  it('nothing rolls without the Pilsner (or with another beer); with it a lucky source doubles exactly what was taken', () => {
    const h = host(), beer = new BeerEffects(h).install();
    const L = lotWhere(true);
    beer.acquired(lot(L), h.inv.makeStack('bandage', 2));
    beer.drink('beer_lager');
    beer.acquired(lot(L), h.inv.makeStack('bandage', 2));
    expect([beer.counts.rolls, beer.hasRolled(lot(L)), count(h.inv, 'bandage')]).toEqual([0, false, 0]);
    beer.drink('beer_pilsner'); // (replaces the Lager)
    const taken = h.inv.makeStack('bandage', 2);
    h.inv.add(taken);
    beer.acquired(lot(L), {...taken});
    expect([beer.counts.rolls, beer.counts.dups, count(h.inv, 'bandage')]).toEqual([1, 1, 4]);
    expect(h.toasts.at(-1)).toBe('Lucky Switch: a second 2 × Bandage roll!');
  });

  it('an unlucky source is remembered too; re-grabbing ANY rolled source never rolls again (the lucky one never pays twice)', () => {
    const h = host(), beer = pilsner(h);
    const lucky = lotWhere(true), unlucky = lotWhere(false);
    beer.acquired(lot(unlucky), h.inv.makeStack('chips', 1));
    expect([beer.counts.rolls, beer.counts.dups, beer.hasRolled(lot(unlucky))]).toEqual([1, 0, true]);
    beer.acquired(lot(lucky), h.inv.makeStack('chips', 1));
    for (let i = 0; i < 5; i++) { beer.acquired(lot(lucky), h.inv.makeStack('chips', 1)); beer.acquired(lot(unlucky), h.inv.makeStack('chips', 1)); }
    expect([beer.counts.rolls, beer.counts.dups, count(h.inv, 'chips')]).toEqual([2, 1, 1]);
    // the same lot shot off its holder and taken from the floor keys like the lot itself: one roll for both
    beer.acquired({kind: 'pickup', lot: {holder: HOLDER, lot: lucky}}, h.inv.makeStack('chips', 1));
    expect(beer.counts.rolls).toBe(2);
  });

  it('the roll is a pure function of the run seed and the source (a reload cannot re-roll it); about 10 % of sources win', () => {
    const k = sourceKey(SCOPE, lot(42))!;
    expect(dupRoll(SEED, k)).toBe(dupRoll(SEED, k));
    let wins = 0;
    for (let i = 0; i < 20000; i++) if (dupRoll(SEED, sourceKey(SCOPE, {kind: 'pickup', layoutIndex: i})!) < 0.1) wins++;
    expect(wins / 20000).toBeGreaterThan(0.09);
    expect(wins / 20000).toBeLessThan(0.11);
  });

  it('the rolled sources save / load with the run (the record), oldest dropping out past the cap', () => {
    const h = host(), beer = pilsner(h);
    const L = lotWhere(true);
    beer.acquired(lot(L), h.inv.makeStack('water', 1));
    const rec = beer.save();
    expect(rec.rolled).toEqual([sourceHash(sourceKey(SCOPE, lot(L))!)]);
    const h2 = host(), b2 = new BeerEffects(h2).install();
    b2.load(structuredClone(rec));
    expect(b2.active!.itemId).toBe('beer_pilsner');
    b2.acquired(lot(L), h2.inv.makeStack('water', 1));
    expect([b2.counts.rolls, count(h2.inv, 'water')]).toEqual([0, 0]);
    for (let i = 0; i < BEER_ROLLED_MAX + 10; i++) b2.acquired({kind: 'pickup', layoutIndex: 100000 + i}, h2.inv.makeStack('water', 1));
    expect(b2.save().rolled.length).toBe(BEER_ROLLED_MAX);
    expect(b2.hasRolled(lot(L))).toBe(false); // the oldest went first
  });
});

describe('never eligible: currency, restart parts, the player\'s own items, a backpack someone filled', () => {
  it('Rail Ties and the reactor parts never roll; a pickup with no generated origin (a drop, a bonus, cargo) never rolls', () => {
    expect([dupEligibleItem('rail_ties'), dupEligibleItem('reactor_key'), dupEligibleItem('fuse_cartridge'), dupEligibleItem('no_such_item')]).toEqual([false, false, false, false]);
    expect([dupEligibleItem('bandage'), dupEligibleItem('pistol'), dupEligibleItem('ammo_9mm'), dupEligibleItem('fuel_can'), dupEligibleItem('armor_vest')]).toEqual([true, true, true, true, true]);
    const h = host(), beer = pilsner(h);
    const L = lotWhere(true);
    beer.acquired(lot(L), {uid: 900, itemId: 'rail_ties', count: 50});
    beer.acquired(lot(L), {uid: 901, itemId: 'reactor_key', count: 1});
    beer.acquired({kind: 'pickup'}, h.inv.makeStack('bandage', 1)); // the player's own drop: no layout index, no lot
    expect([beer.counts.rolls, beer.hasRolled(lot(L))]).toEqual([0, false]);
    expect(sourceKey(SCOPE, {kind: 'pickup'})).toBeNull();
  });

  it('a grounded backpack counts only as an untouched generated find (found:<i>, nothing put in it); a bag the player set down never', () => {
    expect(sourceKey(SCOPE, {kind: 'bag', id: 'found:3', empty: true})).toBe(`${SCOPE}|bag:found:3`);
    expect(sourceKey(SCOPE, {kind: 'bag', id: 'found:3', empty: false})).toBeNull();
    expect(sourceKey(SCOPE, {kind: 'bag', id: 'bag:812', empty: true})).toBeNull();
  });

  it('only the hook\'s call sites feed it: world pickups / holder lots (Game), stolen wares, found bags — never the trade, Lockbox or cargo', async () => {
    const {readFileSync} = await import('node:fs');
    const {join} = await import('node:path');
    const root = join(__dirname, '../src');
    const read = (f: string) => readFileSync(join(root, f), 'utf8');
    expect((read('game.ts').match(/beerEffects\?\.acquired\?\.\(/g) ?? []).length).toBe(2); // interact (pickups) + takeFromHolder (lots)
    expect(read('market/wares/wares.ts')).toMatch(/h\.beerEffects\?\.acquired\?\.\(\{kind: 'ware', stall: w\.stall, uid: w\.uid\}, taken\)/);
    expect(read('gear/system.ts')).toMatch(/g\.beerEffects\?\.acquired\?\.\(\{kind: 'bag', id: b\.id, empty: !\(b\.stack\.bag \?\? \[\]\)\.some\(Boolean\)\}, b\.stack\)/);
    for (const f of ['market/trade/tradeSystem.ts', 'market/trade/transactions.ts', 'market/trade/wallet.ts', 'ui/lockboxView.ts', 'world/trainCargo.ts', 'items/devGrant.ts'])
      expect(read(f), f).not.toMatch(/acquired/);
  });
});

describe('the bonus: fresh uids (bag contents too), the exact state, never aliasing; at the player\'s feet when it does not fit', () => {
  it('cloneFresh: a deep copy with new uids everywhere (nested bag contents), the same count / mag / armour / filter', () => {
    const inv = new Inventory();
    const bag = inv.makeStack('backpack', 1);
    bag.bag![0] = inv.makeStack('bandage', 3);
    bag.bag![4] = inv.makeStack('pistol', 1, 7);
    const c = cloneFresh(bag, () => inv.allocUid());
    const before = new Set(stacksIn(bag).map(s => s.uid)), after = stacksIn(c).map(s => s.uid);
    expect(after.some(u => before.has(u))).toBe(false);
    expect(new Set(after).size).toBe(after.length);
    expect([c.bag![0]!.count, c.bag![4]!.mag, c.bag![0] === bag.bag![0], c.bag === bag.bag]).toEqual([3, 7, false, false]);
    c.bag![0]!.count = 1;
    expect(bag.bag![0]!.count).toBe(3);
    const vest = {uid: inv.allocUid(), itemId: 'armor_vest', count: 1, armor: 0.0875};
    expect(cloneFresh(vest, () => inv.allocUid()).armor).toBe(0.0875);
    expect(inv.invariants()).toEqual([]);
  });

  it('a full inventory: the bonus lies at the player\'s feet as an ordinary (unowned) item, count kept, with a toast — never lost', () => {
    const h = host(), beer = pilsner(h);
    for (let i = 0; i < 5; i++) h.inv.set({bar: 'hotbar', index: i}, h.inv.makeStack('water', 99));
    for (let i = 0; i < h.inv.pack.length; i++) h.inv.set({bar: 'pack', index: i}, h.inv.makeStack('flare', 10));
    const L = lotWhere(true);
    beer.acquired(lot(L), {uid: 5000, itemId: 'beans', count: 3});
    expect(h.floor.length).toBe(1);
    const f = h.floor[0];
    expect([f.stack.itemId, f.stack.count, f.x, f.y, f.z, (f.stack as {owner?: unknown}).owner]).toEqual(['beans', 3, 3, 0.2, -4, undefined]);
    expect(f.stack.uid).not.toBe(5000);
    expect(h.toasts.at(-1)).toBe('Lucky Switch: a second 3 × Canned beans! No room — it is at your feet');
    expect(beer.lastDup!.atFeet).toBe(3);
  });

  it('a found backpack worn: the bonus bag cannot be worn too, so it is set down as an ordinary grounded bag (bag:<uid>)', () => {
    const h = host(), beer = pilsner(h);
    const found = h.inv.makeStack('backpack', 1);
    expect(h.inv.add(found)).toBe(0); // worn
    let id = 0;
    while (dupRoll(SEED, sourceKey(SCOPE, {kind: 'bag', id: `found:${id}`, empty: true})!) >= 0.1) id++;
    beer.acquired({kind: 'bag', id: `found:${id}`, empty: true}, found);
    expect(h.bags.length).toBe(1);
    expect(h.bags[0].id).toBe(`bag:${h.bags[0].stack.uid}`);
    expect(h.bags[0].stack.uid).not.toBe(found.uid);
    expect(h.floor.length).toBe(0);
  });
});

describe('the real call sites', () => {
  type IShell = {interact(): void; inv: Inventory; toasts: string[]; beerEffects: BeerEffects; currentTarget: unknown; containerTarget: unknown};
  function gameShell(o: Record<string, unknown>): IShell {
    const toasts: string[] = [];
    const inv = (o.inv as Inventory) ?? new Inventory();
    const s = {interactHandlers: [], containerTarget: null, currentTarget: null, inv, toasts, hud: {toast: (t: string) => { toasts.push(t); }}, sfx: {pickup() {}, denied() {}},
      pickups: {remove() {}}, layoutPickup: new Map(), containers: null, syncHeld() {}, selectSlot() {}, selectMelee() {}, ladderAim: null, player: {climbing: false}, ...o};
    Object.setPrototypeOf(s, Game.prototype);
    const bh = host(inv);
    bh.hud = s.hud;
    const beer = pilsner(bh);
    (s as unknown as {beerEffects: BeerEffects}).beerEffects = beer;
    return s as unknown as IShell;
  }

  it('Game.interact: a generated pickup (its layout index) may double; the player\'s own drop never rolls', () => {
    let idx = 0;
    while (dupRoll(SEED, sourceKey(SCOPE, {kind: 'pickup', layoutIndex: idx})!) >= 0.1) idx++;
    const p = {stack: {uid: 7001, itemId: 'water', count: 1}, x: 0, y: 0, z: 0};
    const g = gameShell({currentTarget: p, layoutPickup: new Map([[p, idx]])});
    g.interact();
    expect([g.inv.count('water'), g.beerEffects.counts.rolls, g.beerEffects.counts.dups]).toEqual([2, 1, 1]);
    const drop = {stack: {uid: 7002, itemId: 'water', count: 1}, x: 0, y: 0, z: 0};
    const g2 = gameShell({currentTarget: drop});
    g2.interact();
    expect([g2.inv.count('water'), g2.beerEffects.counts.rolls]).toEqual([1, 0]);
  });

  it('Game.takeFromHolder: each lot taken (whole or in part) rolls as the stack it became (a gun lot keeps its full magazine)', () => {
    const L = lotWhere(true);
    const holder = {kind: 'shelf', prop: {level: 0, x: 1.5, z: -2.25}, state: {lots: [{id: L, itemId: 'pistol', count: 1}, {id: lotWhere(false), itemId: 'chips', count: 2}]}};
    const inv = new Inventory();
    const containers = {interact: () => { for (const l of holder.state.lots) inv.add(inv.makeStack(l.itemId, l.count)); holder.state.lots = []; }, all: [holder]};
    const g = gameShell({inv, containers, containerTarget: {container: holder}});
    g.interact();
    expect([inv.count('pistol'), inv.count('chips'), g.beerEffects.counts.rolls, g.beerEffects.counts.dups]).toEqual([2, 2, 2, 1]);
    const guns = inv.allStacks().filter(s => s.itemId === 'pistol');
    expect(guns.map(s => s.mag)).toEqual([15, 15]);
    expect(new Set(inv.allStacks(true).map(s => s.uid)).size).toBe(inv.allStacks(true).length);
  });

  it('MarketWares.steal: a stolen ware rolls once (by its stock uid) after the theft provoked; the bonus never comes from the stock', () => {
    const inv = new Inventory();
    const stall = MARKET_STALLS[0];
    const stock = {stalls: {[stall]: [] as ItemStack[]}} as never as {stalls: Record<string, ItemStack[]>};
    const provoked: unknown[] = [];
    const bh = host(inv), beer = pilsner(bh);
    let uid = 600;
    while (dupRoll(SEED, sourceKey(SCOPE, {kind: 'ware', stall, uid})!) >= 0.1) uid++;
    const st: ItemStack = {uid, itemId: 'bandage', count: 4};
    stock.stalls[stall].push(st);
    const trade = {stock, isOpen: false, takeStock: (_s: string, u: number, n?: number) => {
      const list = stock.stalls[stall], i = list.findIndex(x => x.uid === u);
      if (i < 0) return null;
      const s = list[i];
      if (n === undefined || n >= s.count) { list.splice(i, 1); return s; }
      s.count -= n;
      return {...s, uid: 9999, count: n};
    }};
    const whost = {trade, pickups: {list: [], addAt() { throw new Error('no leftover expected'); }, remove() {}, meshFor: () => new THREE.Group()}, inv, camera: new THREE.PerspectiveCamera(),
      player: {alive: true}, state: 'playing', hud: bh.hud, marketHostility: {hostile: false, provoke: (c: unknown) => provoked.push(c), canTrade: () => true},
      frameHooks: [], sectionHooks: [], interactHandlers: [], beerEffects: beer};
    const wares = new MarketWares(whost as never);
    const w = {stall, uid, pickup: {stack: st, obj: new THREE.Object3D()}, place: {x: 0, y: 0, z: 0, yaw: 0}, box: new THREE.Box3()};
    wares.wares.set(uid, w as never);
    expect(wares.steal(w as never)).toBe(true);
    expect([provoked.length, inv.count('bandage'), beer.counts.rolls, beer.counts.dups, stock.stalls[stall].length]).toEqual([1, 8, 1, 1, 0]);
    expect(inv.allStacks().filter(s => s.itemId === 'bandage').every(s => s.uid !== 9999)).toBe(true);
  });
});
