// Task studio-survivor-market-20261108-005807-01 (lane TRADE): ATOMIC TRADES — the carried inventory and the stall's stock move together
// in ONE step, or nothing changes at all.
// Task studio-market-rework-20261108-074144-01 (lane TRADE): the money is PHYSICAL now — Rail Ties stacks in the quick slots / pockets
// (items/railTies.ts), paid and received only through market/trade/payment.ts; there is no wallet balance.
//
// SELL (a carried stack — quick slots, pockets, grenade / melee slot, or worn gear — or `count` of it): quoted first (market/trade/stalls.ts:
// parts, Rail Ties themselves, a bag with contents and sales worth under a tie are refused; every stall buys everything else, at its own
// multiple); then the stall's shelf room is checked; then the exact steps run on Inventory.clone() (payment.ts simulate): the piece is
// taken out with Inventory.detach (a whole stack leaves as the SAME object: uid, magazine, filter, air, wear kept; a partial take is a new
// stack with a fresh uid from the run's counter, the rest stays), THEN the ties are received (the freed slot may take them). A detach the
// inventory refuses (a chest rig whose extra pockets hold items) or ties that do not fit refuse the sale with nothing changed. Only then
// does the real inventory do the same, and the piece joins the stock.
// BUY (`count` of a stock stack): the price (condition included) must be carried; the copy pays it (smallest ties stacks first) THEN takes
// the goods like a pickup (gear goes on if its slot is free; the slot the payment emptied may take them). No room = refused with nothing
// changed (not even the uid counter). Then the real inventory does the same: the goods (whole: the same object; partial: a fresh-uid piece,
// the rest stays on the stall) leave the stock, exactly the price leaves the pockets.
// CANCEL is simply not calling these: a quote never changes anything. Pure (no three.js / DOM).
import {ITEMS, itemDef} from '../../items/items';
import {ammoText} from '../../items/calibers';
import type {Inventory, ItemStack, SlotRef} from '../../items/inventory';
import type {MarketStallId} from '../../gen/market/marketTypes';
import {addToStock, stockHasRoom, type MarketStock} from './stock';
import {buyPrice, sellQuote} from './stalls';
import {tiesText} from './ties';
import {bagTies, carriedTies, payTies, receiveTies, simulate} from './payment';

export interface TradeCtx {
  inv: Inventory;
  stock: MarketStock;
  stall: MarketStallId;
  /** The stalls' signs (lines name a stall the player can see). */
  names?: Partial<Record<MarketStallId, string>>;
}

export type TradeFailCode = 'gone' | 'closed' | 'unknown' | 'part' | 'currency' | 'bag-contents' | 'too-little' | 'shelf-full' | 'held' | 'short' | 'no-room';
export interface TradeOk { ok: true; kind: 'sell' | 'buy'; itemId: string; count: number; price: number; uid: number; text: string }
export interface TradeFail { ok: false; code: TradeFailCode; text: string }
export type TradeResult = TradeOk | TradeFail;
export interface Quote { ok: true; count: number; price: number }

const fail = (code: TradeFailCode, text: string): TradeFail => ({ok: false, code, text});
/** "10 × 9mm rounds" / "the Rifle". */
export function amountText(itemId: string, n: number): string {
  const d = ITEMS[itemId];
  if (!d) return itemId;
  return ammoText(d.id, n) ?? (n > 1 ? `${n} × ${d.short}` : d.short);
}
const clampCount = (count: number | undefined, max: number) => Math.max(1, Math.min(max, Math.floor(count ?? max)));

/** The slots a trade may sell from (worn gear included). */
export const SELL_BARS: readonly SlotRef['bar'][] = ['hotbar', 'throw', 'melee', 'pack', 'gear'];

/** "You have 12 ties" + the ties waiting in a worn backpack, for a short-of-ties line. */
function haveText(inv: Inventory): string {
  const bag = bagTies(inv);
  return `you have ${tiesText(carriedTies(inv))}${bag ? ` (+${bag} in your backpack — take them out to spend them)` : ''}`;
}

/** What selling `count` of the stack in `ref` pays (nothing changes). */
export function quoteSell(ctx: TradeCtx, ref: SlotRef, count?: number): Quote | TradeFail {
  if (!SELL_BARS.includes(ref.bar)) return fail('gone', 'Nothing to sell there.');
  const st = ctx.inv.get(ref);
  if (!st) return fail('gone', 'Nothing to sell there.');
  const n = clampCount(count, st.count);
  const q = sellQuote(ctx.stall, st, n);
  if (!q.ok) return fail(q.code, q.text);
  return {ok: true, count: n, price: q.price};
}

/** A sale's inventory steps (the copy first, then the real one): take the goods out, THEN receive the ties. */
function sellSteps(inv: Inventory, ref: SlotRef, n: number, price: number): {ok: true; piece: ItemStack} | TradeFail {
  const piece = inv.detach(ref, n, {bag: true});
  if (!piece) return fail('held', inv.refusal?.text ?? 'You cannot let go of that right now.');
  if (receiveTies(inv, price) > 0) return fail('no-room', `No room for ${tiesText(price)} in your quick slots or pockets — make room first.`);
  return {ok: true, piece};
}

/** Whether the sale's inventory side would go through (proven on a copy; nothing changes). Null = it would. */
export function checkSell(ctx: TradeCtx, ref: SlotRef, count?: number): TradeFail | null {
  const q = quoteSell(ctx, ref, count);
  if (!q.ok) return q;
  const r = sellSteps(ctx.inv.clone(), ref, q.count, q.price);
  return r.ok ? null : r;
}

/** Sell `count` (default: all) of the stack in `ref` to the stall: all or nothing. */
export function sell(ctx: TradeCtx, ref: SlotRef, count?: number): TradeResult {
  const q = quoteSell(ctx, ref, count);
  if (!q.ok) return q;
  const {inv, stock} = ctx, list = stock.stalls[ctx.stall];
  const st = inv.get(ref)!;
  const probe: ItemStack = q.count >= st.count ? st : {...st, count: q.count};
  if (!stockHasRoom(list, probe)) return fail('shelf-full', 'The stall\'s shelves are full — it cannot take that just now.');
  const r = simulate(inv, x => sellSteps(x, ref, q.count, q.price));
  if (!r.ok) return r;
  addToStock(list, r.piece); // (room proven above: never false here)
  stock.version++;
  return {ok: true, kind: 'sell', itemId: r.piece.itemId, count: q.count, price: q.price, uid: r.piece.uid,
    text: `Sold ${amountText(r.piece.itemId, q.count)} for ${tiesText(q.price)}`};
}

/** The no-room line for a lot (the inventory's own refusal when it has a specific one: a second backpack …). */
const roomText = (inv: Inventory, itemId: string) => (inv.refusal?.text && inv.refusal.code !== 'no-room' ? inv.refusal.text
  : `No room for the ${itemDef(itemId).short.toLowerCase()} in your quick slots or pockets.`);

/**
 * A buy's inventory steps (the copy first, then the real one): pay `price` THEN take the goods. `trial`: the copy takes a copy of a whole
 * lot (the real run takes the stock's own object).
 */
function buySteps(inv: Inventory, st: ItemStack, n: number, price: number, trial: boolean): {ok: true; piece: ItemStack} | TradeFail {
  if (price > 0 && !payTies(inv, price)) return fail('short', `You need ${tiesText(price)} — ${haveText(inv)}.`);
  const whole = n >= st.count;
  const piece: ItemStack = whole ? (trial ? {...st} : st) : {...st, uid: inv.allocUid(), count: n};
  if (!whole) delete piece.bag;
  if (inv.add(piece) > 0) return fail('no-room', roomText(inv, st.itemId));
  return {ok: true, piece};
}

/** What buying `count` of stock stack `index` costs, whether you carry it and whether it fits after paying (nothing changes). */
export function quoteBuy(ctx: TradeCtx, index: number, count?: number): (Quote & {have: number; afford: boolean; room: boolean; roomText: string}) | TradeFail {
  const st = ctx.stock.stalls[ctx.stall][index];
  if (!st) return fail('gone', 'That is no longer on the stall.');
  const n = clampCount(count, st.count);
  const price = buyPrice(st, n), have = carriedTies(ctx.inv), afford = have >= price;
  const trial = buySteps(ctx.inv.clone(), st, n, afford ? price : 0, true);
  return {ok: true, count: n, price, have, afford, room: trial.ok, roomText: trial.ok ? '' : trial.text};
}

/** Buy `count` (default: all) of stock stack `index`: all or nothing. */
export function buy(ctx: TradeCtx, index: number, count?: number): TradeResult {
  const q = quoteBuy(ctx, index, count);
  if (!q.ok) return q;
  if (!q.afford) return fail('short', `You need ${tiesText(q.price)} — ${haveText(ctx.inv)}.`);
  if (!q.room) return fail('no-room', q.roomText);
  const {inv, stock} = ctx, list = stock.stalls[ctx.stall], st = list[index];
  const r = simulate(inv, (x, trial) => buySteps(x, st, q.count, q.price, trial));
  if (!r.ok) return r;
  if (r.piece === st) list.splice(index, 1);
  else st.count -= q.count;
  stock.version++;
  return {ok: true, kind: 'buy', itemId: r.piece.itemId, count: q.count, price: q.price, uid: r.piece.uid,
    text: `Bought ${amountText(r.piece.itemId, q.count)} for ${tiesText(q.price)}`};
}
