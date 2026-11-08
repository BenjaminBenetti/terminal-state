// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE SIX STALLS' TRADE RULES — what each stall deals in, the one price rule
// and every refusal, on top of the shared value model (market/trade/value.ts). Pure.
//
// PRICES (integer arithmetic on the value in cents): every stall SELLS at the value (TRADE_RATES.buyPct = 100 %, rounded UP to whole
// ties) and BUYS below it (rounded DOWN): its own line at themedPct, and — the general store and the scrapyard only — anything else
// ordinary at its broadPct. All buy-back shares are < 100 %, so for every item, condition and count the best sale anywhere is strictly
// below the cheapest purchase anywhere: there is no buy -> sell profit at the same or another stall / market, and splitting or merging
// stacks cannot create one (a sum of floors <= the floor of the sum < the ceiling of the sum <= a sum of ceilings).
// No trader-cash limit: a stall buys whatever it deals in, as often as the player sells.
//
// REFUSALS (a reason, nothing changes): a reactor restart part (kind 'part': the campaign needs it — never sellable anywhere); a
// backpack that still holds items (the trader buys the bag, not its contents: nothing inside is ever deleted, duplicated or priced
// twice); a themed stall asked to buy off its line (it names the general store / the scrapyard, which take anything ordinary); a sale
// worth less than a tie (it names the smallest count that is worth one).
import {ITEMS, type ItemDef} from '../../items/items';
import {econCat} from '../../items/lootTables';
import {FUEL} from '../../fuel/fuel';
import {MARKET_STALLS, type MarketStallId} from '../../gen/market/marketTypes';
import type {ItemStack} from '../../items/inventory';
import {CENTS, GAS_FILTER_ID, stackUnitCents} from './value';

export const TRADE_RATES = {
  /** Every stall sells at the full value (rounded up to whole ties). */
  buyPct: 100,
  /** What a stall pays for its own line (rounded down). */
  themedPct: 55,
} as const;

export interface StallTrade {
  id: MarketStallId;
  /** The fallback sign when the layout gives none. */
  label: string;
  /** What it buys and sells, for text ("guns and ammunition"). */
  line: string;
  /** Its own line (its stock is drawn from it; it buys it at themedPct). */
  deals(d: ItemDef): boolean;
  /** It also buys anything ordinary off its line at this share (general store / scrapyard); null = only its own line. */
  broadPct: number | null;
}

const isEcon = (d: ItemDef, ...cats: string[]) => cats.includes(econCat(d.id) ?? '');

export const STALL_TRADE: Readonly<Record<MarketStallId, StallTrade>> = {
  gun: {id: 'gun', label: 'Gunsmith', line: 'guns and ammunition', broadPct: null, deals: d => d.kind === 'weapon' || d.kind === 'ammo'},
  medical: {id: 'medical', label: 'Medic', line: 'medicine, dressings and splints', broadPct: null, deals: d => isEcon(d, 'med')},
  // the train-supply stall: fuel cans and rail supplies (road flares are railway fusees; D cells run signal lamps)
  fuel: {id: 'fuel', label: 'Fuel & train supply', line: 'fuel cans, flares and cells', broadPct: null, deals: d => d.id === FUEL.canItem || isEcon(d, 'flare', 'battery')},
  general: {id: 'general', label: 'General store', line: 'food, water, cells, flares and filters (and buys anything ordinary)', broadPct: 40,
    deals: d => isEcon(d, 'food', 'drink', 'battery', 'flare') || d.id === GAS_FILTER_ID},
  gear: {id: 'gear', label: 'Outfitter', line: 'worn gear, masks and packs', broadPct: null, deals: d => d.kind === 'gear'},
  scrap: {id: 'scrap', label: 'Scrapyard', line: 'salvage and crafting materials (and buys anything ordinary as junk)', broadPct: 35, deals: d => d.kind === 'material'},
};

export type TradeRefusalCode = 'unknown' | 'part' | 'bag-contents' | 'off-line' | 'too-little';
export interface TradeRefusal { ok: false; code: TradeRefusalCode; text: string }
export interface SellQuote { ok: true; price: number; pct: number; themed: boolean }

const refuse = (code: TradeRefusalCode, text: string): TradeRefusal => ({ok: false, code, text});
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The ties a stall charges for `count` of this stack (its condition included): the value, rounded UP. */
export function buyPrice(stack: Pick<ItemStack, 'itemId' | 'mag' | 'filter' | 'air' | 'armor'>, count: number): number {
  const n = Math.max(0, Math.floor(count));
  return Math.ceil((n * stackUnitCents(stack) * TRADE_RATES.buyPct) / (CENTS * 100));
}

/** The share (percent) a stall pays for an item, or null when it does not buy it (off its line, or untradeable). */
export function buyBackPct(stall: MarketStallId, itemId: string): number | null {
  const d = ITEMS[itemId], s = STALL_TRADE[stall];
  if (!d || d.kind === 'part' || !s) return null;
  return s.deals(d) ? TRADE_RATES.themedPct : s.broadPct;
}

/** Other stalls that would buy this item ("the general store or the scrapyard"), for a refusal line. */
function elsewhere(stall: MarketStallId, itemId: string, names?: Partial<Record<MarketStallId, string>>): string {
  const ids = MARKET_STALLS.filter(s => s !== stall && buyBackPct(s, itemId) !== null);
  const own = ids.filter(s => STALL_TRADE[s].deals(ITEMS[itemId])), rest = ids.filter(s => !own.includes(s));
  const name = (s: MarketStallId) => names?.[s] ?? `the ${lower(STALL_TRADE[s].label)}`;
  const list = [...own, ...rest].slice(0, 2).map(name);
  return list.length ? list.join(' or ') : 'nobody here';
}

/**
 * What a stall pays for `count` of this stack (ties, rounded DOWN), or why it will not buy it. `names`: the stalls' signs (the layout's), so
 * a refusal points at a stall the player can see.
 */
export function sellQuote(stall: MarketStallId, stack: Pick<ItemStack, 'itemId' | 'count' | 'mag' | 'filter' | 'air' | 'armor' | 'bag'>, count: number,
  names?: Partial<Record<MarketStallId, string>>): SellQuote | TradeRefusal {
  const d = ITEMS[stack.itemId];
  if (!d || !STALL_TRADE[stall]) return refuse('unknown', 'Nobody here knows what that is.');
  if (d.kind === 'part') return refuse('part', `Nobody here will take the ${lower(d.name)}: it is a reactor restart part, and the reactor needs it.`);
  if (stack.bag?.some(Boolean)) return refuse('bag-contents', `Empty the ${lower(d.short)} first — the trader buys the bag, not what is inside it (set it down with 6, open it and take its contents out).`);
  const pct = buyBackPct(stall, d.id);
  if (pct === null) return refuse('off-line', `This stall deals in ${STALL_TRADE[stall].line} — try ${elsewhere(stall, d.id, names)} for the ${lower(d.short)}.`);
  const n = Math.max(1, Math.min(stack.count, Math.floor(count)));
  const unit = stackUnitCents(stack);
  const price = Math.floor((n * unit * pct) / (CENTS * 100));
  if (price < 1) {
    const need = Math.ceil((CENTS * 100) / Math.max(1, unit * pct));
    return refuse('too-little', need <= d.stackMax ? `Too little to be worth a tie here — sell at least ${need} at once.` : 'Not worth a tie here.');
  }
  return {ok: true, price, pct, themed: pct === TRADE_RATES.themedPct};
}
