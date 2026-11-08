// Task studio-survivor-market-20261108-005807-01 (lane TRADE): ATOMIC TRADES — the wallet, the carried inventory and the stall's stock
// move together in ONE step, or nothing changes at all.
//
// SELL (a carried stack — quick slots, pockets, grenade / melee slot, or worn gear — or `count` of it): quoted first (market/trade/stalls.ts:
// parts, a bag with contents, off-line items and sales worth under a tie are refused); then the stall's shelf room and the wallet's
// ceiling are checked; only then is the piece taken out with Inventory.detach (a whole stack leaves as the SAME object: uid, magazine,
// filter, air and any other item state kept; a partial take is a new stack with a fresh uid from the run's counter, the rest stays). A
// detach the inventory refuses (a chest rig whose extra pockets hold items) changes nothing. The piece joins the stock, the ties are paid.
// BUY (`count` of a stock stack): the price (condition included) must be affordable; the inventory's ROOM is proven first on a deep copy
// (Inventory.clone: the same slots and uid counter, so the real add places exactly the same way) — no room = refused with nothing
// changed (not even the uid counter). Then the stack (whole: the same object; partial: a fresh-uid piece, the rest stays on the stall) is
// added like a pickup (gear goes on if its slot is free), it leaves the stock and the ties are paid.
// CANCEL is simply not calling these: a quote never changes anything. Pure (no three.js / DOM).
import {ITEMS, itemDef} from '../../items/items';
import {ammoText} from '../../items/calibers';
import type {Inventory, ItemStack, SlotRef} from '../../items/inventory';
import type {MarketStallId} from '../../gen/market/marketTypes';
import {WALLET_MAX, type MarketWallet} from './wallet';
import {addToStock, stockHasRoom, type MarketStock} from './stock';
import {buyPrice, sellQuote} from './stalls';
import {tiesText} from './ties';

export interface TradeCtx {
  inv: Inventory;
  wallet: MarketWallet;
  stock: MarketStock;
  stall: MarketStallId;
  /** The stalls' signs (refusals name a stall the player can see). */
  names?: Partial<Record<MarketStallId, string>>;
}

export type TradeFailCode = 'gone' | 'unknown' | 'part' | 'bag-contents' | 'off-line' | 'too-little' | 'shelf-full' | 'wallet-full' | 'held' | 'short' | 'no-room';
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

/** What selling `count` of the stack in `ref` pays (nothing changes). */
export function quoteSell(ctx: TradeCtx, ref: SlotRef, count?: number): Quote | TradeFail {
  if (!SELL_BARS.includes(ref.bar)) return fail('gone', 'Nothing to sell there.');
  const st = ctx.inv.get(ref);
  if (!st) return fail('gone', 'Nothing to sell there.');
  const n = clampCount(count, st.count);
  const q = sellQuote(ctx.stall, st, n, ctx.names);
  if (!q.ok) return fail(q.code, q.text);
  return {ok: true, count: n, price: q.price};
}

/** Sell `count` (default: all) of the stack in `ref` to the stall: all or nothing. */
export function sell(ctx: TradeCtx, ref: SlotRef, count?: number): TradeResult {
  const q = quoteSell(ctx, ref, count);
  if (!q.ok) return q;
  const {inv, wallet, stock} = ctx, list = stock.stalls[ctx.stall];
  const st = inv.get(ref)!;
  const probe: ItemStack = q.count >= st.count ? st : {...st, count: q.count};
  if (!stockHasRoom(list, probe)) return fail('shelf-full', 'The stall\'s shelves are full — it cannot take that just now.');
  if (wallet.ties + q.price > WALLET_MAX) return fail('wallet-full', 'You could not carry that many ties.');
  const piece = inv.detach(ref, q.count, {bag: true});
  if (!piece) return fail('held', inv.refusal?.text ?? 'You cannot let go of that right now.');
  addToStock(list, piece); // (room proven above: never false here)
  wallet.receive(q.price);
  stock.version++;
  return {ok: true, kind: 'sell', itemId: piece.itemId, count: q.count, price: q.price, uid: piece.uid,
    text: `Sold ${amountText(piece.itemId, q.count)} for ${tiesText(q.price)}`};
}

/** What buying `count` of stock stack `index` costs, and whether it fits (nothing changes). */
export function quoteBuy(ctx: TradeCtx, index: number, count?: number): (Quote & {afford: boolean; room: boolean; roomText: string}) | TradeFail {
  const st = ctx.stock.stalls[ctx.stall][index];
  if (!st) return fail('gone', 'That is no longer on the stall.');
  const n = clampCount(count, st.count);
  const price = buyPrice(st, n);
  const probe = ctx.inv.clone();
  const piece: ItemStack = n >= st.count ? {...st} : {...st, uid: probe.allocUid(), count: n};
  if (n < st.count) delete piece.bag;
  const left = probe.add(piece);
  return {ok: true, count: n, price, afford: ctx.wallet.canPay(price), room: left === 0,
    roomText: left === 0 ? '' : probe.refusal?.text && probe.refusal.code !== 'no-room' ? probe.refusal.text : `No room for the ${itemDef(st.itemId).short.toLowerCase()} in your quick slots or pockets.`};
}

/** Buy `count` (default: all) of stock stack `index`: all or nothing. */
export function buy(ctx: TradeCtx, index: number, count?: number): TradeResult {
  const q = quoteBuy(ctx, index, count);
  if (!q.ok) return q;
  if (!q.afford) return fail('short', `You need ${tiesText(q.price)} — you have ${tiesText(ctx.wallet.ties)}.`);
  if (!q.room) return fail('no-room', q.roomText);
  const {inv, wallet, stock} = ctx, list = stock.stalls[ctx.stall], st = list[index];
  const whole = q.count >= st.count;
  const before = inv.toJSON();
  const piece: ItemStack = whole ? st : {...st, uid: inv.allocUid(), count: q.count};
  if (!whole) delete piece.bag;
  if (inv.add(piece) > 0) { inv.loadJSON(before); return fail('no-room', q.roomText || 'No room in your quick slots or pockets.'); } // (the proof above makes this unreachable)
  if (whole) list.splice(index, 1);
  else st.count -= q.count;
  wallet.pay(q.price);
  stock.version++;
  return {ok: true, kind: 'buy', itemId: piece.itemId, count: q.count, price: q.price, uid: piece.uid,
    text: `Bought ${amountText(piece.itemId, q.count)} for ${tiesText(q.price)}`};
}
