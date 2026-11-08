// Task studio-survivor-market-20261108-005807-01 (lane TRADE): PERSISTENCE of the Rail Ties wallet and the stalls' stock — the wallet is a
// run participant (New Game 0, an old save without it 0, Save / Continue / export round trip exact, Retry = the entry snapshot's balance);
// the stock is seeded ONCE per market station into its lane memory and remembered (leave / return / save / load / Retry never re-seed or
// refill); every stock stack joins the run's one-item-one-uid set in save/validate.ts (and the Retry snapshot's own set); malformed stock
// and wallets are refused; the uid counter is reserved above every stock uid on load.
import {describe, expect, it} from 'vitest';
import type {SlotRef} from '../src/items/inventory';
import {MARKET_STALLS} from '../src/gen/market/marketTypes';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {installRestore, makeSaveFile, maxUidOfRun, prepareRestore, saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {restoreCarry, restoreParticipants} from '../src/run/snapshot';
import {WALLET_MAX, WALLET_PARTICIPANT} from '../src/market/trade/wallet';
import {MARKET_STOCK_LANE, STOCK_MAX, type MarketStockJSON} from '../src/market/trade/stock';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {MARKET_STATION, census, tradeHost, uniqueUids} from './helpers/marketTradeFixture';

const P = (i: number): SlotRef => ({bar: 'pack', index: i});
const KEY = {level: 'subway' as const, section: 'main', station: MARKET_STATION};
const memId = `${MARKET_STATION}:main`;

/** A market host built at its station, with a few things to sell and `ties` earned. */
function market(ties = 0) {
  const t = tradeHost();
  t.h.inv.set(P(0), t.h.inv.makeStack('water', 3));
  t.h.inv.set(P(1), t.h.inv.makeStack('ammo_9mm', 40));
  t.h.inv.set(P(2), t.h.inv.makeStack('pistol', 1, 11));
  t.h.inv.set(P(3), t.h.inv.makeStack('scrap_metal', 12));
  t.build();
  if (ties) t.sys.wallet.receive(ties);
  return t;
}

/** Re-envelope a mutated run (fresh checksum) and validate it. */
function revalidate(file: SaveFileV1Like, mutate: (run: Record<string, unknown>) => void) {
  const run = structuredClone(file.run) as unknown as Record<string, unknown>;
  mutate(run);
  return validateSaveFile(makeSaveFile(run as never, file.meta));
}
const stockOf = (run: Record<string, unknown>, id = memId) => ((run.memories as Record<string, {lanes: Record<string, unknown>}>)[id].lanes[MARKET_STOCK_LANE]) as MarketStockJSON;

describe('market wallet: a run participant', () => {
  it('registers itself; New Game is 0 (no windfall); a save carries {v: 1, ties}', () => {
    const t = market();
    expect(t.h.participants.filter(p => p.id === WALLET_PARTICIPANT).length).toBe(1);
    expect(t.sys.wallet.ties).toBe(0);
    t.sys.wallet.receive(37);
    for (const p of t.h.participants) p.reset(); // NewGame (resetParticipants)
    expect(t.sys.wallet.ties).toBe(0);
    t.sys.wallet.receive(12);
    const file = t.h.file('arrival');
    expect(file.run.participants[WALLET_PARTICIPANT]).toEqual({v: 1, ties: 12});
    expect(validateSaveFile(file).ok).toBe(true);
  });

  it('an old save without a wallet (and without stock) loads 0 ties and seeds the market fresh on its first build', () => {
    const old = new Harness(fixtureCampaign({current: MARKET_STATION, known: [sid(0), MARKET_STATION], visited: [sid(0), MARKET_STATION]}));
    const file = old.file('arrival');
    expect(file.run.participants[WALLET_PARTICIPANT]).toBeUndefined();
    const v = validateSaveFile(file);
    expect(v.ok).toBe(true);
    const t = market(55);
    t.teardown();
    if (!v.ok) return;
    installRestore(prepareRestore(v.value.run, t.h.makeRun), t.h.target());
    expect(t.sys.wallet.ties).toBe(0);
    t.build();
    expect(t.sys.counts.seeded).toBe(2); // (the first market() build + this station's first build in the loaded run)
  });

  it('save -> export text -> import -> install: the balance, the stock (same uids, same condition) and the inventory exactly; no re-seed', () => {
    const t = market(20);
    t.standAt('gun');
    expect(t.press()).toBe(true);
    expect(t.sys.sell(P(2)).ok).toBe(true); // the pistol (11 rounds loaded) joins the gun stall
    expect(t.sys.sell(P(1), 25).ok).toBe(true);
    const lot = t.sys.stock!.stalls.gun.findIndex(s => s.itemId === 'ammo_12ga');
    if (lot >= 0) expect(t.sys.buy(lot, 2).ok).toBe(true);
    const ties = t.sys.wallet.ties, stock = JSON.stringify(t.sys.stock!.toJSON()), carry = JSON.stringify(t.h.inv.toJSON());
    const text = saveFileText(t.h.file('arrival'));
    const v = parseSaveText(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(maxUidOfRun(v.value.run)).toBeGreaterThanOrEqual(t.sys.stock!.maxUid());
    const u = market();
    u.teardown();
    const p = prepareRestore(v.value.run, u.h.makeRun);
    installRestore(p, u.h.target());
    expect(u.sys.wallet.ties).toBe(ties);
    expect(JSON.stringify(u.h.inv.toJSON())).toBe(carry);
    const seeded = u.sys.counts.seeded;
    u.build();
    expect([u.sys.counts.seeded, u.sys.counts.loaded]).toEqual([seeded, 1]);
    expect(JSON.stringify(u.sys.stock!.toJSON())).toBe(stock);
    const pistol = u.sys.stock!.stalls.gun.find(s => s.itemId === 'pistol' && s.mag === 11);
    expect(pistol).toBeDefined();
    expect(u.h.inv.toJSON().nextUid).toBeGreaterThan(u.sys.stock!.maxUid()); // the counter is reserved above every stock uid
    expect(uniqueUids(census(u.h.inv, u.sys.stock!).uids)).toBe(true);
  });
});

describe('market stock: seeded once, remembered, never refilled', () => {
  it('first build seeds and writes the lane memory at once; leave / return loads it (no re-seed); opening / closing the view changes nothing', () => {
    const t = market();
    expect([t.sys.counts.seeded, t.sys.counts.loaded, t.sys.counts.writes]).toEqual([1, 0, 1]);
    const rec = JSON.stringify(t.h.run.laneStore(MARKET_STOCK_LANE, KEY));
    expect(rec).toBe(JSON.stringify(t.sys.stock!.toJSON()));
    t.standAt('general');
    t.press();
    expect(t.sys.isOpen).toBe(true);
    t.sys.close('user');
    t.teardown();
    t.build();
    expect([t.sys.counts.seeded, t.sys.counts.loaded]).toEqual([1, 1]);
    expect(JSON.stringify(t.sys.stock!.toJSON())).toBe(rec);
  });

  it('a sale stays sold and a purchase stays gone across leave / return; nothing comes back', () => {
    const t = market(500);
    t.standAt('general');
    t.press();
    const water = t.h.inv.get(P(0))!;
    expect(t.sys.sell(P(0)).ok).toBe(true);
    const first = t.sys.stock!.stalls.general[0];
    const firstUid = first.uid, firstCount = first.count;
    expect(t.sys.buy(0).ok).toBe(true);
    t.teardown();
    t.build();
    const g = t.sys.stock!.stalls.general;
    expect(g.some(s => s.uid === water.uid || (s.itemId === 'water' && s.count >= 3))).toBe(true);
    expect(g.some(s => s.uid === firstUid && s.count === firstCount)).toBe(false);
    // every lot counted once: the stock + the inventory still hold exactly what they held after the trades
    expect(uniqueUids(census(t.h.inv, t.sys.stock!).uids)).toBe(true);
  });

  it('Retry: the stock, the balance and the inventory go back to the level-entry snapshot together; the station is not re-seeded', () => {
    const t = market(30);
    t.h.takeEntry();
    const snap = t.h.run.entry!;
    const at = {stock: JSON.stringify(t.sys.stock!.toJSON()), inv: JSON.stringify(t.h.inv.toJSON()), ties: t.sys.wallet.ties};
    t.standAt('gun');
    t.press();
    expect(t.sys.sell(P(2)).ok).toBe(true);
    const cheap = t.sys.stock!.stalls.gun.findIndex(s => s.itemId.startsWith('ammo_'));
    expect(t.sys.buy(cheap, 1).ok).toBe(true);
    expect(t.sys.wallet.ties).not.toBe(at.ties);
    // Game.retryLevel: teardown, this station's memories from the snapshot, the carry state, the participants, rebuild
    t.teardown();
    t.h.run.restoreScopeMemories(KEY, snap.memories);
    const inv = restoreCarry(snap, {player: t.h.player, survival: t.h.survival, battery: t.h.battery, stats: t.h.stats});
    t.h.inv.loadJSON(inv.toJSON());
    restoreParticipants(snap, t.h.participants);
    t.build();
    expect(t.sys.counts.seeded).toBe(1);
    expect(JSON.stringify(t.sys.stock!.toJSON())).toBe(at.stock);
    expect(JSON.stringify(t.h.inv.toJSON())).toBe(at.inv);
    expect(t.sys.wallet.ties).toBe(at.ties);
    // retry twice: same again (the snapshot is never consumed)
    t.teardown();
    t.h.run.restoreScopeMemories(KEY, snap.memories);
    restoreParticipants(snap, t.h.participants);
    t.build();
    expect([JSON.stringify(t.sys.stock!.toJSON()), t.sys.wallet.ties]).toEqual([at.stock, at.ties]);
  });

  it('a trade made after the level entry saves and validates: the entry snapshot and the run are separate uid scopes', () => {
    const t = market(200);
    t.h.takeEntry();
    t.standAt('medical');
    t.press();
    const bought = t.sys.buy(0);
    expect(bought.ok).toBe(true);
    const file = t.h.file('arrival');
    // the entry snapshot's memory still lists the lot the carried inventory now holds (same uid): legal across scopes
    const entryStock = (file.run.entry!.memories[memId].lanes[MARKET_STOCK_LANE] as MarketStockJSON).stalls.medical;
    if (bought.ok) expect([entryStock.some(s => s.uid === bought.uid), t.h.inv.find(bought.uid) !== null]).toEqual([true, true]);
    expect(validateSaveFile(file).ok).toBe(true);
  });
});

describe('market save validation: one item, one uid; strict records', () => {
  const base = () => { const t = market(10); return {t, file: t.h.file('arrival')}; };

  it('a stock uid duplicating a carried / Lockbox stack, another stall\'s or another station\'s stock is refused', () => {
    const {t, file} = base();
    const carried = t.h.inv.get(P(0))!.uid;
    const dupCarry = revalidate(file, run => { stockOf(run).stalls.general[0].uid = carried; });
    expect(dupCarry.ok).toBe(false);
    if (!dupCarry.ok) expect(dupCarry.error).toMatch(/duplicate item uid/);
    const dupStall = revalidate(file, run => { const s = stockOf(run).stalls; s.gear[0].uid = s.gun[0].uid; });
    expect(!dupStall.ok && dupStall.error).toMatch(/duplicate item uid/);
    t.h.train.lockbox.slots[0] = t.h.inv.makeStack('bandage', 1);
    const f2 = t.h.file('arrival');
    const dupBox = revalidate(f2, run => { stockOf(run).stalls.scrap[0].uid = t.h.train.lockbox.slots[0]!.uid; });
    expect(!dupBox.ok && dupBox.error).toMatch(/duplicate item uid/);
    const dupStation = revalidate(file, run => {
      const mems = run.memories as Record<string, {lanes: Record<string, unknown>}>;
      mems[`${sid(4)}:main`] = structuredClone(mems[memId]);
    });
    expect(!dupStation.ok && dupStation.error).toMatch(/duplicate item uid/);
    expect(revalidate(file, () => {}).ok).toBe(true);
  });

  it('inside the Retry snapshot: its stock may not duplicate its own inventory', () => {
    const t = market(10);
    t.h.takeEntry();
    const file = t.h.file('arrival');
    expect(validateSaveFile(file).ok).toBe(true);
    const r = revalidate(file, run => {
      const e = run.entry as {inventory: {pack: ({uid: number} | null)[]}; memories: Record<string, {lanes: Record<string, unknown>}>};
      (e.memories[memId].lanes[MARKET_STOCK_LANE] as MarketStockJSON).stalls.general[0].uid = e.inventory.pack[0]!.uid;
    });
    expect(!r.ok && r.error).toMatch(/entry.*duplicate item uid/);
  });

  it('malformed stock is refused (shape, items, counts, parts, bags with contents, size, version)', () => {
    const {file} = base();
    const cases: [string, (s: MarketStockJSON & Record<string, unknown>) => void, RegExp][] = [
      ['version', s => { (s as {v: number}).v = 2; }, /unsupported market stock version/],
      ['extra field', s => { s.extra = 1; }, /unexpected field 'extra'/],
      ['missing stall', s => { delete (s.stalls as Partial<typeof s.stalls>).fuel; }, /missing field 'fuel'/],
      ['unknown stall', s => { (s.stalls as Record<string, unknown>).bakery = []; }, /unexpected field 'bakery'/],
      ['unknown item', s => { s.stalls.general[0].itemId = 'gold_bar'; }, /unknown item 'gold_bar'/],
      ['zero count', s => { s.stalls.general[0].count = 0; }, /out of range/],
      ['over stack', s => { s.stalls.general[0].count = 999; }, /out of range/],
      ['no uid', s => { delete (s.stalls.general[0] as {uid?: number}).uid; }, /missing field 'uid'/],
      ['null lot', s => { (s.stalls.general as unknown[])[0] = null; }, /expected an object/],
      ['a part', s => { s.stalls.scrap.push({uid: 99999, itemId: 'reactor_key', count: 1}); }, /restart part is not trade stock/],
      ['bag contents', s => { s.stalls.gear.push({uid: 99998, itemId: 'backpack', count: 1, bag: [{uid: 99997, itemId: 'water', count: 1}, ...new Array(11).fill(null)]}); }, /backpack in stock must be empty/],
      ['too many', s => { for (let i = 0; i <= STOCK_MAX; i++) s.stalls.scrap.push({uid: 50000 + i, itemId: 'scrap_metal', count: 1}); }, /too many entries/],
      ['bad mag', s => { s.stalls.gun.push({uid: 99996, itemId: 'rifle', count: 1, mag: 31}); }, /out of range/],
    ];
    for (const [name, mut, re] of cases) {
      const r = revalidate(file, run => mut(stockOf(run) as never));
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.error, name).toMatch(re);
    }
  });

  it('a malformed wallet is refused; an absent one is fine', () => {
    const {file} = base();
    const bad: unknown[] = [{v: 1, ties: -1}, {v: 1, ties: 1.5}, {v: 1, ties: '5'}, {v: 2, ties: 5}, {v: 1, ties: 5, bonus: 1}, {v: 1, ties: WALLET_MAX + 1}, [], 7];
    for (const w of bad) {
      const r = revalidate(file, run => { (run.participants as Record<string, unknown>)[WALLET_PARTICIPANT] = w; });
      expect(r.ok, JSON.stringify(w)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/wallet/);
    }
    expect(revalidate(file, run => { delete (run.participants as Record<string, unknown>)[WALLET_PARTICIPANT]; }).ok).toBe(true);
    expect(revalidate(file, run => { (run.participants as Record<string, unknown>)[WALLET_PARTICIPANT] = {v: 1, ties: WALLET_MAX}; }).ok).toBe(true);
  });

  it('the uid counter on load is reserved above a stock uid that is higher than everything carried', () => {
    const {file} = base();
    const v = revalidate(file, run => { stockOf(run).stalls.fuel[0].uid = 1_234_567; });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const p = prepareRestore(v.value.run, new Harness().makeRun);
    expect(p.maxUid).toBe(1_234_567);
    expect(p.inventory.toJSON().nextUid).toBeGreaterThan(1_234_567);
    expect(p.run.entry).toBeNull();
    for (const s of MARKET_STALLS) expect(Array.isArray(stockOf(v.value.run as never).stalls[s])).toBe(true);
  });
});
