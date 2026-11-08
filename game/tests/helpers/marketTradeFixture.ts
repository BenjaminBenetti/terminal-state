// Task studio-survivor-market-20261108-005807-01 (lane TRADE): fixtures of the market trade tests — a fake `layout.market` (the six stalls in
// a row, each counter 2 m wide with its customer spot in front), a Node host for the trade controller on the save fixture's Game-like
// Harness (real RunState / Inventory / participants), and census helpers (every stack + uid across the inventory and every stall).
import type {MarketLayout, MarketStall, MarketStallId} from '../../src/gen/market/marketTypes';
import {MARKET_STALLS} from '../../src/gen/market/marketTypes';
import {stacksIn, type Inventory, type ItemStack} from '../../src/items/inventory';
import type {MarketStock} from '../../src/market/trade/stock';
import {TradeSystem, type TradeHost} from '../../src/market/trade/tradeSystem';
import {Harness, fixtureCampaign, sid} from './saveFixture';

/** Stall `i` stands at x = 6 i: its counter spans z -3 .. -2, the trader behind it, the customer spot at z -0.8 (facing -z: yaw 0). */
export function fakeStall(id: MarketStallId, i: number, y = 0, level = 0): MarketStall {
  const x = i * 6;
  return {
    id, name: `${id.toUpperCase()} STALL`, area: i,
    counter: {x0: x - 1, x1: x + 1, z0: -3, z1: -2, x, z: -2.5, y, level},
    trader: {x, z: -3.5, y, level, yaw: 0},
    front: {x, z: -0.8, y, level},
  };
}

export function fakeMarket(): MarketLayout {
  return {v: 1, stalls: MARKET_STALLS.map((s, i) => fakeStall(s, i)), spots: [], residents: 0};
}

export const MARKET_STATION = sid(3);

/** A trade test host: the save Harness (campaign at st-03), a player, the hooks Game offers, toasts / sfx counters. */
export function tradeHost(o: {station?: string} = {}) {
  const station = o.station ?? MARKET_STATION;
  const h = new Harness(fixtureCampaign({current: station, known: [sid(0), station], visited: [sid(0), station]}));
  const toasts: string[] = [], sfx = {ok: 0, denied: 0};
  const host = {
    get inv() { return h.inv; },
    get run() { return h.run; },
    player: {x: 0, y: 0, z: -0.8, yaw: 0, alive: true},
    state: 'playing', qa: true,
    hud: {toast: (t: string) => { toasts.push(t); }},
    sfx: {pickup: () => { sfx.ok++; }, denied: () => { sfx.denied++; }},
    frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[],
    interactHandlers: [] as (() => boolean)[], promptProviders: [] as (() => string | null)[], runParticipants: h.participants,
    stateListeners: [] as ((s: string, p: string) => void)[], inputOwners: [] as (() => boolean)[], hitListeners: [] as ((hit: {amount: number}) => void)[],
    gear: {session: null as unknown, cancelReady() {}, showResume() {}}, syncs: 0, syncHeld() { this.syncs++; },
  };
  const sys = new TradeSystem(host as unknown as TradeHost).install();
  const layout = {market: fakeMarket()};
  const build = () => { for (const s of host.sectionHooks) s.build?.(layout); };
  const teardown = () => { for (const s of host.sectionHooks) s.teardown?.(); };
  const frame = () => { for (const f of host.frameHooks) f(0.016); };
  const press = () => { for (const f of host.interactHandlers) if (f()) return true; return false; };
  const prompt = () => { for (const f of host.promptProviders) { const p = f(); if (p) return p; } return null; };
  /** Stand at stall `id`'s customer spot facing its counter (+ an offset). */
  const standAt = (id: MarketStallId, dx = 0, dz = 0, yaw = 0) => {
    const s = layout.market.stalls.find(x => x.id === id)!;
    Object.assign(host.player, {x: s.front.x + dx, z: s.front.z + dz, y: s.front.y, yaw});
    frame();
  };
  return {h, host, sys, layout, build, teardown, frame, press, prompt, standAt, toasts, sfx};
}

/** Every stack (bag contents included) in the inventory + the stock: item totals and the sorted uid list. */
export function census(inv: Inventory, stock: MarketStock) {
  const all: ItemStack[] = [...inv.allStacks(true), ...stock.all().flatMap(stacksIn)];
  const counts: Record<string, number> = {};
  for (const s of all) counts[s.itemId] = (counts[s.itemId] ?? 0) + s.count;
  return {counts, uids: all.map(s => s.uid).sort((a, b) => a - b)};
}

export const uniqueUids = (uids: number[]): boolean => new Set(uids).size === uids.length;

/** Byte-exact state of a trade (inventory snapshot incl. its uid counter, the stock record, the balance). */
export function tradeState(inv: Inventory, stock: MarketStock, ties: number): string {
  return JSON.stringify({inv: inv.toJSON(), stock: stock.toJSON(), ties});
}
