// Task studio-market-rework-20261108-074144-01 (lane TRADE): THE OLD BALANCE -> PHYSICAL RAIL TIES, ONCE (market/trade/wallet.ts LegacyWallet +
// tradeSystem.ts settleWallet + payment.ts migrateTies). An old save's 'market.wallet' {v: 1, ties: N} owes N ties: nothing is placed during
// the load (the player train's participant — its Lockbox / cargo — may load after the wallet), they are placed at the next section build /
// playing frame: carried first (merged, pockets first), then the train's Lockbox, then ties pickups lying in the parked car (train cargo),
// with a toast; what finds no room anywhere stays owed (saved as {v: 1, ties: rest}, retried when room appears); once settled the
// participant saves {v: 2, migrated: true} and never mints again. Old saves, export text, Retry snapshots taken before / after the settle,
// a pending journey (frames before any build): never lost, never doubled; every save after it validates (one item, one uid).
import {describe, expect, it} from 'vitest';
import {RAIL_TIES_ID} from '../src/items/railTies';
import type {SlotRef} from '../src/items/inventory';
import {CARGO, type CargoItemJSON} from '../src/run/trainCargo';
import {restoreCarry, restoreParticipants} from '../src/run/snapshot';
import {installRestore, makeSaveFile, prepareRestore, saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {WALLET_PARTICIPANT} from '../src/market/trade/wallet';
import {migrateTies} from '../src/market/trade/payment';
import {MARKET_STATION, carriedTies, tradeHost} from './helpers/marketTradeFixture';

const P = (i: number): SlotRef => ({bar: 'pack', index: i});
const H = (i: number): SlotRef => ({bar: 'hotbar', index: i});
const KEY = {level: 'subway' as const, section: 'main', station: MARKET_STATION};
type Host = ReturnType<typeof tradeHost>;

/** A save of `t` as an OLD build would have written it: the wallet {v: 1, ties} (and in its Retry snapshot too, when it has one). */
function oldSave(t: Host, ties: number): SaveFileV1Like {
  const file = t.h.file('arrival');
  const run = structuredClone(file.run) as unknown as {participants: Record<string, unknown>; entry: {lanes: Record<string, unknown>} | null};
  run.participants[WALLET_PARTICIPANT] = {v: 1, ties};
  if (run.entry) run.entry.lanes[WALLET_PARTICIPANT] = {v: 1, ties};
  return makeSaveFile(run as never, file.meta);
}

/** Validate + install a save into a fresh host (nothing built yet). */
function load(file: SaveFileV1Like): Host {
  const v = validateSaveFile(file);
  expect(v.ok, v.ok ? '' : v.error).toBe(true);
  if (!v.ok) throw new Error(v.error);
  const u = tradeHost();
  u.teardown();
  installRestore(prepareRestore(v.value.run, u.h.makeRun), u.h.target());
  return u;
}

/** All the ties the run holds: carried, the worn bag, the Lockbox, the train cargo. */
function allTies(t: Host): number {
  const inv = t.h.inv, box = t.h.train.lockbox.slots, cargo = t.h.train.cargo.records();
  const n = (s: {itemId: string; count: number} | null | undefined) => (s && s.itemId === RAIL_TIES_ID ? s.count : 0);
  return inv.allStacks(true).reduce((a, s) => a + n(s), 0) + box.reduce((a, s) => a + n(s), 0) + cargo.reduce((a, r) => a + n(r.stack), 0);
}

/** Game.retryLevel on the harness: teardown, this station's memories, the carry state, the participants, rebuild. */
function retry(t: Host): void {
  const snap = t.h.run.entry!;
  t.teardown();
  t.h.run.restoreScopeMemories(KEY, snap.memories);
  t.h.inv.loadJSON(restoreCarry(snap, {player: t.h.player, survival: t.h.survival, battery: t.h.battery, stats: t.h.stats}).toJSON());
  restoreParticipants(snap, t.h.participants);
  t.build();
}

/** A market host with a small kit (pockets 0-1). */
function kit(): Host {
  const t = tradeHost();
  t.h.inv.set(P(0), t.h.inv.makeStack('water', 2));
  t.h.inv.set(P(1), t.h.inv.makeStack('pistol', 1, 15));
  t.build();
  return t;
}

describe('old balance -> physical ties: once', () => {
  it('nothing during the load; the next build places them (pockets first), toasts, and the participant then saves {v: 2, migrated: true}', () => {
    const u = load(oldSave(kit(), 250));
    expect([u.sys.legacy.owed, carriedTies(u.h.inv)]).toEqual([250, 0]);
    expect(u.h.file('arrival').run.participants[WALLET_PARTICIPANT]).toEqual({v: 1, ties: 250}); // an autosave before the settle loses nothing
    u.build();
    expect([u.sys.legacy.owed, carriedTies(u.h.inv), u.h.inv.get(P(2))?.itemId, u.sys.counts.settled]).toEqual([0, 250, RAIL_TIES_ID, 1]);
    expect(u.toasts.at(-1)).toBe('Your market balance is now real Rail Ties: 250 carried');
    const file = u.h.file('arrival');
    expect(file.run.participants[WALLET_PARTICIPANT]).toEqual({v: 2, migrated: true});
    expect(validateSaveFile(file).ok).toBe(true);
    // idempotent: more frames / builds / a reload of the settled save mint nothing
    for (let i = 0; i < 3; i++) { u.frame(); u.teardown(); u.build(); }
    expect([allTies(u), u.sys.counts.settled, u.toasts.length]).toEqual([250, 1, 1]);
    const w = load(file);
    w.build();
    expect([allTies(w), w.sys.legacy.owed, w.sys.counts.settled]).toEqual([250, 0, 0]);
  });

  it('absent or 0: nothing is placed and nothing is said', () => {
    for (const ties of [0, null]) {
      const t = kit(), file = ties === null ? t.h.file('arrival') : oldSave(t, ties);
      if (ties === null) {
        const run = structuredClone(file.run) as unknown as {participants: Record<string, unknown>};
        delete run.participants[WALLET_PARTICIPANT];
        const u = load(makeSaveFile(run as never, file.meta));
        u.build();
        expect([allTies(u), u.toasts.length, u.sys.legacy.owed]).toEqual([0, 0, 0]);
        continue;
      }
      const u = load(file);
      u.build();
      expect([allTies(u), u.toasts.length]).toEqual([0, 0]);
      expect(u.h.file('arrival').run.participants[WALLET_PARTICIPANT]).toEqual({v: 2, migrated: true});
    }
  });

  it('a pending journey (frames before any build): the first PLAYING frame settles it; not while paused / dead', () => {
    const u = load(oldSave(kit(), 40));
    u.host.state = 'paused';
    u.frame();
    u.host.state = 'playing';
    u.host.player.alive = false;
    u.frame();
    expect(u.sys.legacy.owed).toBe(40);
    u.host.player.alive = true;
    u.frame();
    expect([u.sys.legacy.owed, carriedTies(u.h.inv)]).toEqual([0, 40]);
  });

  it('an export text from before the rework (with its Retry snapshot) parses, validates, installs and settles', () => {
    const t = kit();
    t.h.takeEntry();
    const text = saveFileText(oldSave(t, 75));
    const v = parseSaveText(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect((v.value.run.entry as unknown as {lanes: Record<string, unknown>}).lanes[WALLET_PARTICIPANT]).toEqual({v: 1, ties: 75});
    const u = load(v.value as unknown as SaveFileV1Like);
    u.build();
    expect(allTies(u)).toBe(75);
  });
});

describe('old balance -> physical ties: overflow (never discarded)', () => {
  it('carried first (merged onto a ties stack, then free slots), then the train\'s Lockbox, then ties pickups lying in the parked car', () => {
    const t = kit();
    for (let i = 2; i < t.h.inv.pack.length; i++) t.h.inv.set(P(i), t.h.inv.makeStack('rifle', 1));
    for (let i = 0; i < 4; i++) t.h.inv.set(H(i), t.h.inv.makeStack('shotgun', 1));
    t.h.inv.set(P(5), t.h.inv.makeStack(RAIL_TIES_ID, 900)); // room for 100 on it; one free quick slot (5) for 1000
    for (let i = 0; i < t.h.train.lockbox.slots.length - 2; i++) t.h.train.lockbox.slots[i] = t.h.inv.makeStack('bandage', 1); // two free Lockbox slots
    const u = load(oldSave(t, 5700)); // 1100 carried + 2000 Lockbox + 2600 cargo
    u.build();
    expect(u.h.inv.get(P(5))!.count).toBe(1000);
    expect(u.h.inv.get(H(4))).toMatchObject({itemId: RAIL_TIES_ID, count: 1000});
    expect(u.h.train.lockbox.slots.slice(-2).map(s => s?.count)).toEqual([1000, 1000]);
    const cargo = u.h.train.cargo.records();
    expect(cargo.map(r => [r.kind, r.stack.itemId, r.stack.count])).toEqual([['item', RAIL_TIES_ID, 1000], ['item', RAIL_TIES_ID, 1000], ['item', RAIL_TIES_ID, 600]]);
    expect([u.sys.legacy.owed, allTies(u)]).toEqual([0, 900 + 5700]);
    expect(u.toasts.at(-1)).toBe('Your market balance is now real Rail Ties: 1100 carried · 2000 in the train\'s Lockbox · 2600 on the train\'s floor');
    const file = u.h.file('arrival');
    expect(validateSaveFile(file).ok).toBe(true); // every new stack has its own run-wide uid
    expect(file.run.participants[WALLET_PARTICIPANT]).toEqual({v: 2, migrated: true});
    // the save carries them exactly: reload -> the same ties, nothing minted
    const w = load(file);
    w.build();
    expect([allTies(w), w.sys.counts.settled]).toEqual([allTies(u), 0]);
  });

  it('no room anywhere: the rest stays OWED (saved as {v: 1, ties: rest}, a warning toast) and is placed once room appears', () => {
    const t = kit();
    for (let i = 0; i < t.h.inv.pack.length; i++) t.h.inv.set(P(i), t.h.inv.makeStack('rifle', 1));
    for (let i = 0; i < 5; i++) t.h.inv.set(H(i), t.h.inv.makeStack('shotgun', 1));
    for (let i = 0; i < t.h.train.lockbox.slots.length; i++) t.h.train.lockbox.slots[i] = t.h.inv.makeStack('bandage', 1);
    const filler: CargoItemJSON[] = Array.from({length: CARGO.maxItems}, () => ({kind: 'item', stack: {uid: t.h.inv.allocUid(), itemId: 'water', count: 1}, x: 1, y: 0.2, z: 0, q: [0, 0, 0, 1]}));
    t.h.train.cargo.setRecords(filler);
    const u = load(oldSave(t, 1234));
    u.build();
    expect([u.sys.legacy.owed, allTies(u)]).toEqual([1234, 0]);
    expect(u.toasts.at(-1)).toMatch(/1234 Rail Ties from your old market balance are waiting/);
    expect(u.h.file('arrival').run.participants[WALLET_PARTICIPANT]).toEqual({v: 1, ties: 1234});
    const toasts = u.toasts.length;
    u.frame();
    u.frame();
    expect(u.toasts.length).toBe(toasts); // (retried only when something changed: no toast spam)
    u.h.inv.set(P(3), null); // room for 1000
    u.frame();
    expect([u.sys.legacy.owed, carriedTies(u.h.inv)]).toEqual([234, 1000]);
    expect(u.h.file('arrival').run.participants[WALLET_PARTICIPANT]).toEqual({v: 1, ties: 234});
    u.h.train.lockbox.slots[7] = null;
    u.h.train.lockbox.version++;
    u.frame();
    expect([u.sys.legacy.owed, allTies(u)]).toEqual([0, 1234]);
    expect(validateSaveFile(u.h.file('arrival')).ok).toBe(true);
  });

  it('migrateTies alone: exact amounts, uids from the run counter, at most CARGO.maxItems loose items aboard', () => {
    const t = kit();
    for (let i = 0; i < t.h.inv.pack.length; i++) t.h.inv.set(P(i), t.h.inv.makeStack('rifle', 1));
    for (let i = 0; i < 5; i++) t.h.inv.set(H(i), t.h.inv.makeStack('shotgun', 1));
    t.h.train.cargo.setRecords(Array.from({length: CARGO.maxItems - 2}, () => ({kind: 'item', stack: {uid: t.h.inv.allocUid(), itemId: 'water', count: 1}, x: 1, y: 0.2, z: 0, q: [0, 0, 0, 1]})));
    const placed = migrateTies(2500, {inv: t.h.inv, cargo: t.h.train.cargo, pose: k => ({x: k, y: 0.3, z: 0})});
    expect(placed).toEqual({carried: 0, lockbox: 0, cargo: 2000, left: 500});
    expect(t.h.train.cargo.records().length).toBe(CARGO.maxItems);
  });
});

describe('old balance -> physical ties: Retry snapshots', () => {
  it('a snapshot taken BEFORE the settle owes the ties to the entry state: each Retry places them again exactly once (never doubled)', () => {
    const u = load(oldSave(kit(), 300));
    u.h.takeEntry(); // (entered before the settle: the wallet owes 300, the inventory has none)
    u.build();
    expect(allTies(u)).toBe(300);
    u.standAt('general');
    expect(u.press()).toBe(true);
    const lot = u.sys.stock!.stalls.general.findIndex(s => s.count >= 1);
    expect(u.sys.buy(lot, 1).ok).toBe(true);
    expect(allTies(u)).toBeLessThan(300);
    retry(u);
    expect([allTies(u), u.sys.legacy.owed]).toEqual([300, 0]);
    retry(u);
    expect(allTies(u)).toBe(300);
    // that run saves and validates: the entry snapshot still owes (consistent with its own inventory), the run does not
    const file = u.h.file('arrival');
    expect(validateSaveFile(file).ok).toBe(true);
    expect([file.run.participants[WALLET_PARTICIPANT], (file.run.entry as unknown as {lanes: Record<string, unknown>}).lanes[WALLET_PARTICIPANT]]).toEqual([{v: 2, migrated: true}, {v: 1, ties: 300}]);
  });

  it('a Lockbox overflow goes back with the Lockbox on Retry and is placed again into exactly that Lockbox', () => {
    const t = kit();
    for (let i = 0; i < t.h.inv.pack.length; i++) t.h.inv.set(P(i), t.h.inv.makeStack('rifle', 1));
    for (let i = 0; i < 5; i++) t.h.inv.set(H(i), t.h.inv.makeStack('shotgun', 1));
    const u = load(oldSave(t, 1500));
    u.h.takeEntry();
    u.build();
    expect(u.h.train.lockbox.slots.filter(s => s?.itemId === RAIL_TIES_ID).map(s => s!.count)).toEqual([1000, 500]);
    retry(u);
    expect(u.h.train.lockbox.slots.filter(s => s?.itemId === RAIL_TIES_ID).map(s => s!.count)).toEqual([1000, 500]);
    expect(allTies(u)).toBe(1500);
  });

  it('a snapshot taken AFTER the settle owes nothing: Retry restores the entry inventory with its ties, nothing is minted', () => {
    const u = load(oldSave(kit(), 120));
    u.build();
    u.h.takeEntry();
    u.h.inv.set(P(2), null); // (spent / dropped after the entry)
    retry(u);
    expect([allTies(u), u.sys.legacy.owed, u.sys.counts.settled]).toEqual([120, 0, 1]);
  });
});
