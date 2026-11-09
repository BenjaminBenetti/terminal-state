// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE SIX STALLS' TRADE RULES — what each stall deals in, the one price rule
// and every refusal, on top of the shared value model (market/trade/value.ts). Pure.
//
// Task studio-market-rework-20261108-074144-01 (lane TRADE): EVERY STALL BUYS EVERY ORDINARY ITEM. User: "its to clunky not being able to
// sell items to all vendors. Yes different vendors should give you different prices, so using the correct vendor is worth it, but you
// should be still able to sell to any of them, just at a lower multiple".
//
// PRICES (integer arithmetic on the value in cents): every stall SELLS at the value (TRADE_RATES.buyPct = 100 %, rounded UP to whole ties)
// and BUYS below it (rounded DOWN) at its MULTIPLE for that item (buyBackPct):
//              | its own line | anything else ordinary
//   gunsmith   |     55 %     |   25 %
//   medic      |     55 %     |   25 %
//   fuel       |     55 %     |   25 %
//   general    |     55 %     |   40 %   (the broad buyers: the general store and the scrapyard stay broad)
//   outfitter  |     55 %     |   25 %
//   scrapyard  |     55 %     |   35 %
//   bartender  |     55 %     |   25 %   (task studio-market-bar-20261108-225231-01, layout version 3's bar: beers and drinks)
// So the right stall pays more than twice what a wrong specialist does, and the general store / the scrapyard beat any wrong specialist.
// All multiples are < 100 %, so for every item, condition and count the best sale anywhere is strictly below the cheapest purchase
// anywhere: no buy -> sell profit at the same or another stall / market, and splitting or merging stacks cannot create one (a sum of
// floors <= the floor of the sum < the ceiling of the sum <= a sum of ceilings). No trader-cash limit; the stock is finite (stock.ts).
//
// REFUSALS (a reason, nothing changes): a reactor restart part (kind 'part': the campaign needs it — never sellable anywhere); Rail Ties
// themselves (kind 'currency': the money, not goods); a backpack that still holds items (the trader buys the bag, not its contents: nothing
// inside is ever deleted, duplicated or priced twice); a sale worth less than a tie (it names the smallest count that is worth one).
import {ITEMS, type ItemDef} from '../../items/items';
import {econCat} from '../../items/lootTables';
import {FUEL} from '../../fuel/fuel';
import {BAR_STALL, MARKET_STALLS, MARKET_STALLS_ALL, type MarketStallId} from '../../gen/market/marketTypes';
import {isBeer} from '../../items/beers';
import type {ItemStack} from '../../items/inventory';
import {CENTS, GAS_FILTER_ID, stackUnitCents} from './value';

export const TRADE_RATES = {
  /** Every stall sells at the full value (rounded up to whole ties). */
  buyPct: 100,
  /** What a stall pays for its own line (rounded down). */
  themedPct: 55,
  /** What a specialist stall pays for anything ordinary off its line (task studio-market-rework-20261108-074144-01). */
  offPct: 25,
} as const;

export interface StallTrade {
  id: MarketStallId;
  /** The fallback sign when the layout gives none. */
  label: string;
  /** What it deals in, for text ("guns and ammunition"). */
  line: string;
  /** Its own line (its stock is drawn from it; it buys it at themedPct). */
  deals(d: ItemDef): boolean;
  /** What it pays for anything ordinary OFF its line (percent of the value): the broad buyers more, the specialists TRADE_RATES.offPct. */
  broadPct: number;
}

const isEcon = (d: ItemDef, ...cats: string[]) => cats.includes(econCat(d.id) ?? '');

export const STALL_TRADE: Readonly<Record<MarketStallId, StallTrade>> = {
  gun: {id: 'gun', label: 'Gunsmith', line: 'guns and ammunition', broadPct: TRADE_RATES.offPct, deals: d => d.kind === 'weapon' || d.kind === 'ammo'},
  medical: {id: 'medical', label: 'Medic', line: 'medicine, dressings and splints', broadPct: TRADE_RATES.offPct, deals: d => isEcon(d, 'med')},
  // the train-supply stall: fuel cans and rail supplies (road flares are railway fusees; D cells run signal lamps)
  fuel: {id: 'fuel', label: 'Fuel & train supply', line: 'fuel cans, flares and cells', broadPct: TRADE_RATES.offPct, deals: d => d.id === FUEL.canItem || isEcon(d, 'flare', 'battery')},
  general: {id: 'general', label: 'General store', line: 'food, water, cells, flares and filters', broadPct: 40,
    deals: d => isEcon(d, 'food', 'drink', 'battery', 'flare') || d.id === GAS_FILTER_ID},
  gear: {id: 'gear', label: 'Outfitter', line: 'worn gear, masks and packs', broadPct: TRADE_RATES.offPct, deals: d => d.kind === 'gear'},
  scrap: {id: 'scrap', label: 'Scrapyard', line: 'salvage and crafting materials', broadPct: 35, deals: d => d.kind === 'material'},
  // task studio-market-bar-20261108-225231-01 (lane BAR): the upper-level bar's bartender (layout version 3) — the market's beers (items/beers.ts:
  // the bar's own stock) and ordinary drinks; anything else at the specialists' off-line multiple
  bar: {id: 'bar', label: 'Bartender', line: 'beers and drinks', broadPct: TRADE_RATES.offPct, deals: d => isBeer(d.id) || isEcon(d, 'drink')},
};

export type TradeRefusalCode = 'unknown' | 'part' | 'currency' | 'bag-contents' | 'too-little';
export interface TradeRefusal { ok: false; code: TradeRefusalCode; text: string }
export interface SellQuote { ok: true; price: number; pct: number; themed: boolean }

const refuse = (code: TradeRefusalCode, text: string): TradeRefusal => ({ok: false, code, text});
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The ties a stall charges for `count` of this stack (its condition included): the value, rounded UP. */
export function buyPrice(stack: Pick<ItemStack, 'itemId' | 'mag' | 'filter' | 'air' | 'armor'>, count: number): number {
  const n = Math.max(0, Math.floor(count));
  return Math.ceil((n * stackUnitCents(stack) * TRADE_RATES.buyPct) / (CENTS * 100));
}

/** The share (percent) a stall pays for an item: its own line themedPct, anything else ordinary its broadPct; null = never (untradeable). */
export function buyBackPct(stall: MarketStallId, itemId: string): number | null {
  const d = ITEMS[itemId], s = STALL_TRADE[stall];
  if (!d || d.kind === 'part' || d.kind === 'currency' || !s) return null;
  return s.deals(d) ? TRADE_RATES.themedPct : s.broadPct;
}

/** The stall's sign (the layout's when given). */
const signOf = (s: MarketStallId, names?: Partial<Record<MarketStallId, string>>) => names?.[s] ?? `the ${lower(STALL_TRADE[s].label)}`;

/** What a stall pays for `count` of this stack (ties, rounded DOWN), or why it will not buy it. */
export function sellQuote(stall: MarketStallId, stack: Pick<ItemStack, 'itemId' | 'count' | 'mag' | 'filter' | 'air' | 'armor' | 'bag'>, count: number): SellQuote | TradeRefusal {
  const d = ITEMS[stack.itemId];
  if (!d || !STALL_TRADE[stall]) return refuse('unknown', 'Nobody here knows what that is.');
  if (d.kind === 'part') return refuse('part', `Nobody here will take the ${lower(d.name)}: it is a reactor restart part, and the reactor needs it.`);
  if (d.kind === 'currency') return refuse('currency', `${d.name} are the market's money — spend them on the stall's goods instead.`);
  if (stack.bag?.some(Boolean)) return refuse('bag-contents', `Empty the ${lower(d.short)} first — the trader buys the bag, not what is inside it (set it down with 6, open it and take its contents out).`);
  const pct = buyBackPct(stall, d.id)!;
  const n = Math.max(1, Math.min(stack.count, Math.floor(count)));
  const unit = stackUnitCents(stack);
  const price = Math.floor((n * unit * pct) / (CENTS * 100));
  if (price < 1) {
    const need = Math.ceil((CENTS * 100) / Math.max(1, unit * pct));
    return refuse('too-little', need <= d.stackMax ? `Too little to be worth a tie here — sell at least ${need} at once.` : 'Not worth a tie here.');
  }
  return {ok: true, price, pct, themed: pct === TRADE_RATES.themedPct};
}

/**
 * Another stall here that pays MORE for the same sale, and what it pays (null: this stall is already the best or as good) — the deal line
 * names it ("PANTRY pays 4"), so using the right stall is worth it and easy to see. (Task studio-market-bar-20261108-225231-01: the six,
 * plus the bar where the station has one — its sign among `names`, the station's stalls; a market without a bar never names it.)
 */
export function betterStall(stall: MarketStallId, stack: Pick<ItemStack, 'itemId' | 'count' | 'mag' | 'filter' | 'air' | 'armor' | 'bag'>, count: number,
  names?: Partial<Record<MarketStallId, string>>): {stall: MarketStallId; name: string; price: number} | null {
  const here = sellQuote(stall, stack, count);
  let best: {stall: MarketStallId; name: string; price: number} | null = null;
  for (const s of names ? MARKET_STALLS_ALL.filter(q => q !== BAR_STALL || names[q] !== undefined) : MARKET_STALLS) {
    if (s === stall) continue;
    const q = sellQuote(s, stack, count);
    if (q.ok && q.price > (here.ok ? here.price : 0) && (!best || q.price > best.price)) best = {stall: s, name: signOf(s, names), price: q.price};
  }
  return best;
}
