// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE TRADE VIEW — a plain DOM panel over the game, in the Lockbox transfer
// view's style (ui/lockboxView.ts): the world is NOT paused. The stall's sign and your Rail Ties balance (with the track-tie glyph) on
// top; YOUR ITEMS on the left (melee / quick / grenade slots, pockets, worn gear) each tagged with what this stall pays for the whole
// stack (or "—" when it will not buy it); the STALL'S STOCK on the right tagged with its price. Click an item to select it, choose the
// quantity (−10 / −1 / +1 / +10 / All) and confirm Sell / Buy — or Cancel (nothing changes). The deal line says the exact price, or why
// not (a red refusal line: a part, a bag with contents, short of ties, no room …). The stock is shown only here: nothing on a counter is a
// pickup. Transactions go through the controller (market/trade/tradeSystem.ts -> transactions.ts).
//
// Task studio-market-rework-20261108-074144-01 (lane TRADE):
//  - the balance on top is the Rail Ties you CARRY (quick slots + pockets: the physical item, payment.ts), plus how many wait in a worn
//    backpack (not spendable until taken out);
//  - every stall buys everything ordinary now (stalls.ts multiples): each of your items shows what THIS stall pays, and the deal line names
//    a stall here that pays more ("PANTRY pays 4");
//  - CTRL+CLICK (user: "in the store menu, ctrl+click should sell or buy items in one click without needing to click the "sell" / "buy" UI
//    button."): Ctrl (or Cmd) + click on an item trades it at once with the SAME quantity / price semantics as Confirm — the quantity chosen
//    for it when it is the selected item, else its default (a sale: the whole stack; a buy: as many as you can pay for, at least one). Each
//    item's tooltip says exactly what a Ctrl+click does ("Ctrl+click: sell 3 × Water for 2 ties"). It fires on the button's press (one
//    transaction per click: the press is consumed, its click / context menu ignored — no world fire, no drag, nothing repeats), and the
//    ordinary pick -> quantity -> Confirm flow is unchanged.
import {itemIconHtml} from '../../ui/itemIcons';
import {hideTooltip, refreshTooltip, tipAttrs} from '../../ui/tooltip'; // task studio-market-rework-20261108-074144-01: the game's own tooltip (Alpha's ui/tooltip.ts)
import {itemTip} from '../../ui/itemTip';
import {ICONS} from '../../ui/icons';
import {ITEMS} from '../../items/items';
import {GEAR_SLOTS, GEAR_SLOT_NAMES} from '../../items/gear';
import {WEAPONS} from '../../weapons/weapons';
import {PACK_SIZE, type ItemStack, type SlotRef} from '../../items/inventory';
import {FUEL, tanksText} from '../../fuel/fuel';
import {RAIL_TIES, TIE_GLYPH, tiesHtml, tiesText} from './ties';
import {betterStall, buyPrice} from './stalls';
import {bagTies, carriedTies} from './payment';
import {trainCapacityUnits} from './stock';
import {conditionText} from './value';
import {amountText, checkSell, quoteBuy, quoteSell, type TradeCtx, type TradeResult} from './transactions';

export interface TradeViewHost {
  /** The open trade (null: closed — every action is refused). */
  ctx(): TradeCtx | null;
  /** The stall's sign (the title). */
  stallName(): string;
  sell(ref: SlotRef, count: number): TradeResult;
  buy(index: number, count: number): TradeResult;
  close(): void;
}

export type TradeSel = {side: 'sell'; ref: SlotRef} | {side: 'buy'; index: number};

const VIEW_ID = 'tradeview';
/** " (+12 in your backpack — take them out to spend them)" when a worn backpack holds ties. */
const bagNote = (c: TradeCtx) => { const n = bagTies(c.inv); return n ? ` (+${n} in your backpack — take them out to spend them)` : ''; };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
#tradeview { position: fixed; inset: 0; z-index: 45; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 92px; pointer-events: auto; cursor: default; }
#tradeview.hidden { display: none; }
#tradeview .tr-panel { width: min(1240px, calc(100vw - 24px)); max-height: calc(100vh - 104px); overflow-y: auto; box-sizing: border-box; background: rgba(16, 18, 20, 0.92); border: 1px solid #3a3f44; border-top: 3px solid var(--mustard); padding: 10px 14px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6); color: var(--cream); font-size: 13px; }
#tradeview .tr-head { display: flex; align-items: baseline; gap: 16px; margin-bottom: 6px; }
#tradeview .tr-head .tr-title { font-size: 15px; letter-spacing: 0.04em; flex: 1; }
#tradeview .tr-wallet { font-size: 14px; color: var(--mustard); }
#tradeview .tr-wallet .tr-bagties { margin-left: 8px; font-size: 11.5px; color: var(--cream-dim); }
#tradeview .ties { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
#tradeview .tie-glyph { vertical-align: middle; }
#tradeview .tr-live { color: var(--red); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
#tradeview .tr-cols { display: grid; grid-template-columns: 7fr 26px 8fr; gap: 8px; align-items: start; }
#tradeview .tr-arrow { align-self: center; text-align: center; color: var(--cream-dim); font-size: 18px; }
#tradeview h4 { margin: 4px 0; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cream-dim); font-weight: 600; }
#tradeview .slots { display: grid; gap: 6px; }
#tradeview .tr-g6 { grid-template-columns: repeat(6, 1fr); }
#tradeview .tr-g7 { grid-template-columns: repeat(7, 1fr); }
#tradeview .tr-g8 { grid-template-columns: repeat(8, 1fr); max-height: 252px; overflow-y: auto; }
#tradeview .slot { height: 58px; font-size: 11px; padding-bottom: 12px; }
#tradeview .slot img.ico3d { height: 28px; }
#tradeview .slot svg { width: 38px; height: 20px; }
#tradeview .slot .nm { font-size: 10px; }
#tradeview .slot .count { top: 3px; bottom: auto; font-size: 11px; }
#tradeview .slot .tr-price { position: absolute; left: 0; right: 0; bottom: 2px; text-align: center; font-size: 10.5px; font-weight: 700; color: var(--mustard); }
#tradeview .slot.tr-no .tr-price { color: #5a6066; font-weight: 400; }
#tradeview .slot.tr-sel { border-color: var(--mustard); box-shadow: inset 0 0 0 2px var(--mustard); }
#tradeview .slot[data-bar="melee"] { order: -1; border-style: dashed; }
#tradeview .slot[data-bar="melee"].filled { border-style: solid; }
#tradeview .slot .key { color: var(--teal); }
#tradeview .slot .ghost { color: #4a5157; display: flex; }
#tradeview .tr-deal { display: flex; align-items: center; gap: 10px; margin-top: 8px; padding: 6px 8px; background: #15171a; border-left: 3px solid var(--mustard); min-height: 30px; }
#tradeview .tr-deal-text { flex: 1; }
#tradeview .tr-deal-text.refused { color: var(--red); font-weight: 700; }
#tradeview .tr-qtys { display: inline-flex; align-items: center; gap: 4px; }
#tradeview .tr-qtys button { padding: 3px 7px; }
#tradeview .tr-qty { min-width: 32px; text-align: center; font-variant-numeric: tabular-nums; }
#tradeview .tr-note { min-height: 1.2em; margin-top: 6px; color: var(--mustard); }
#tradeview .tr-note.refused { color: var(--red); font-weight: 700; }
#tradeview .tr-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
#tradeview .tr-actions button, #tradeview .tr-deal > button { padding: 6px 12px; }
#tradeview .tr-help { margin-top: 4px; font-size: 11.5px; color: var(--cream-dim); }
`;
let styled = false;

export class TradeView {
  private root: HTMLElement | null = null;
  /** The selected item (null: none). */
  selection: TradeSel | null = null;
  /** The quantity of the selected stack. */
  qty = 1;
  /** The message under the panel (refusals in red). */
  note = '';
  noteBad = false;
  /** The deal line (QA / tests). */
  deal = '';
  dealBad = false;
  /** Last action (QA / tests). */
  last: {kind: string; result: string} | null = null;

  constructor(private readonly host: TradeViewHost) {}

  get visible(): boolean {
    return !!this.root && !this.root.classList.contains('hidden');
  }

  show(): void {
    this.mount();
    this.selection = null;
    this.qty = 1;
    this.note = '';
    this.noteBad = false;
    this.render();
    this.root?.classList.remove('hidden');
  }

  hide(): void {
    this.selection = null;
    this.root?.classList.add('hidden');
    hideTooltip(); // the tooltip goes with the panel
  }

  private mount(): void {
    if (this.root || typeof document === 'undefined') return;
    if (!styled) {
      styled = true;
      const st = document.createElement('style');
      st.id = `${VIEW_ID}-styles`;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('section');
    el.id = VIEW_ID;
    el.className = 'hidden';
    el.setAttribute('aria-label', 'Trade');
    el.innerHTML = `<div class="tr-panel">
      <div class="tr-head"><b class="tr-title"></b><span class="tr-wallet"></span><span class="tr-live">● Not paused — keep an eye out</span></div>
      <div class="tr-cols">
        <div class="tr-side"><h4>Your items · sell</h4><div class="slots tr-g7" data-side="carry"></div><h4 class="tr-pockets">Pockets</h4><div class="slots tr-g6" data-side="pack"></div><h4>Worn</h4><div class="slots tr-g6" data-side="worn"></div></div>
        <div class="tr-arrow">⇄</div>
        <div class="tr-side"><h4 class="tr-stock-h">Stall stock · buy</h4><div class="slots tr-g8" data-side="stock"></div></div>
      </div>
      <div class="tr-deal"><span class="tr-deal-text"></span><span class="tr-qtys"><button type="button" data-d="-10">−10</button><button type="button" data-d="-1">−1</button><b class="tr-qty">1</b><button type="button" data-d="1">+1</button><button type="button" data-d="10">+10</button><button type="button" class="tr-all">All</button></span><button type="button" class="tr-confirm primary">Confirm</button><button type="button" class="tr-cancel">Cancel</button></div>
      <div class="tr-note"></div>
      <div class="tr-actions"><button class="tr-close primary" type="button">Close (E)</button></div>
      <div class="tr-help">Click an item to pick it · choose how many · Confirm to trade (Cancel changes nothing) · <b>Ctrl+click</b> trades in one click (the chosen quantity, else the whole stack / as many as you can pay for) · prices in ${RAIL_TIES.name} ${TIE_GLYPH}, paid from your quick slots and pockets — every stall sells at full value and buys anything back for less, its own line for the most · walking away or getting hit closes the stall</div>
    </div>`;
    (document.querySelector('#app') ?? document.body).appendChild(el);
    this.root = el;
    el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    // Ctrl / Cmd + press on an item: the one-click trade (the press is consumed; its click below is ignored)
    el.addEventListener('mousedown', e => {
      const me = e as MouseEvent;
      if (me.button !== 0 || !(me.ctrlKey || me.metaKey)) return;
      const sel = this.cellSel(me.target);
      if (!sel) return;
      me.preventDefault();
      me.stopPropagation();
      this.quick(sel);
    });
    el.addEventListener('click', e => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest) return;
      if ((e.ctrlKey || e.metaKey) && this.cellSel(t)) { e.preventDefault(); e.stopPropagation(); return; } // (traded on the press)
      if (t.closest('.tr-close')) { this.host.close(); return; }
      if (t.closest('.tr-cancel')) { this.cancel(); return; }
      if (t.closest('.tr-confirm')) { this.confirm(); return; }
      if (t.closest('.tr-all')) { this.all(); return; }
      const step = t.closest('[data-d]') as HTMLElement | null;
      if (step) { this.step(Number(step.dataset.d)); return; }
      const sel = this.cellSel(t);
      if (sel) this.select(sel);
    });
  }

  /** The item cell an event hit, as a selection (null: not an item cell). */
  cellSel(target: EventTarget | null): TradeSel | null {
    const t = target as HTMLElement | null;
    const cell = t?.closest?.(`#${VIEW_ID} .slot`) as HTMLElement | null;
    if (!cell?.dataset.side) return null;
    if (cell.dataset.side === 'stock') return {side: 'buy', index: Number(cell.dataset.index)};
    return cell.dataset.bar ? {side: 'sell', ref: {bar: cell.dataset.bar as SlotRef['bar'], index: Number(cell.dataset.index)}} : null;
  }

  /** Whether `sel` is the selected item. */
  private isSelected(sel: TradeSel): boolean {
    const s = this.selection;
    if (!s || s.side !== sel.side) return false;
    if (s.side === 'buy') return sel.side === 'buy' && s.index === sel.index;
    return sel.side === 'sell' && s.ref.bar === sel.ref.bar && s.ref.index === sel.ref.index;
  }

  /** The stack a selection points at (null: none / gone). */
  private stackAt(c: TradeCtx, sel: TradeSel): ItemStack | null {
    return sel.side === 'sell' ? c.inv.get(sel.ref) : c.stock.stalls[c.stall][sel.index] ?? null;
  }

  /** An item's default quantity: a sale the whole stack; a buy as many as the ties you carry pay for (at least one). */
  private defaultQty(c: TradeCtx, sel: TradeSel, st: ItemStack): number {
    if (sel.side === 'sell') return st.count;
    const have = carriedTies(c.inv);
    let n = st.count;
    while (n > 1 && buyPrice(st, n) > have) n--;
    return n;
  }

  /** The quantity a Ctrl+click on `sel` trades: the chosen one when it is the selected item, else its default. */
  quickQty(sel: TradeSel): number {
    const c = this.host.ctx(), st = c ? this.stackAt(c, sel) : null;
    if (!c || !st) return 1;
    return this.isSelected(sel) ? Math.max(1, Math.min(st.count, this.qty)) : this.defaultQty(c, sel, st);
  }

  /**
   * Ctrl+click: trade `sel` at once with Confirm's semantics (quickQty) — ONE transaction. The selection follows its own stack (render).
   * Null when the stall is closed or the cell is empty.
   */
  quick(sel: TradeSel): TradeResult | null {
    const c = this.host.ctx(), st = c ? this.stackAt(c, sel) : null;
    if (!c || !st) return null;
    const n = this.quickQty(sel);
    const r = sel.side === 'sell' ? this.host.sell(sel.ref, n) : this.host.buy(sel.index, n);
    this.last = {kind: `quick-${sel.side}`, result: r.ok ? 'ok' : r.code};
    this.say(r.text, !r.ok);
    this.render();
    return r;
  }

  /** The stack the selection points at (null: none / gone). */
  selected(): ItemStack | null {
    const c = this.host.ctx(), s = this.selection;
    if (!c || !s) return null;
    return s.side === 'sell' ? c.inv.get(s.ref) : c.stock.stalls[c.stall][s.index] ?? null;
  }

  /** Pick an item (a cell click; QA / tests). The quantity starts at its default (the whole stack; a buy: as many as you can pay for). */
  select(sel: TradeSel | null): void {
    this.selection = sel;
    const st = this.selected(), c = this.host.ctx();
    if (!st || !c || !sel) { this.selection = null; this.selStack = null; this.render(); return; }
    this.selStack = st;
    this.qty = this.defaultQty(c, sel, st);
    this.render();
  }
  /** The selected stack itself (a selection follows it: a stall lot that moved up its list is re-found, a stack that left clears it). */
  private selStack: ItemStack | null = null;

  setQty(n: number): void {
    const st = this.selected();
    this.qty = st ? Math.max(1, Math.min(st.count, Math.floor(n))) : 1;
    this.render();
  }

  step(d: number): void {
    this.setQty(this.qty + (Number.isFinite(d) ? d : 0));
  }

  all(): void {
    this.setQty(this.selected()?.count ?? 1);
  }

  /** Cancel the pending deal: nothing changes. */
  cancel(): void {
    const had = !!this.selection;
    this.selection = null;
    this.selStack = null;
    this.qty = 1;
    this.last = {kind: 'cancel', result: 'none'};
    this.say(had ? 'Cancelled — nothing changed.' : '', false);
    this.render();
  }

  /** Confirm the pending deal (the Confirm button; QA / tests). Null when nothing is selected or the stall is closed. */
  confirm(): TradeResult | null {
    const c = this.host.ctx(), s = this.selection, st = this.selected();
    if (!c || !s || !st) { this.say(c ? 'Pick an item first.' : 'Walk up to a stall and press E to trade.', true); this.render(); return null; }
    const r = s.side === 'sell' ? this.host.sell(s.ref, this.qty) : this.host.buy(s.index, this.qty);
    this.last = {kind: s.side, result: r.ok ? 'ok' : r.code};
    this.say(r.text, !r.ok);
    if (r.ok) {
      // keep the selection only on the very same stack that is still there (a partial deal), with the quantity clamped
      const now = this.selected();
      if (now !== st) { this.selection = null; this.selStack = null; }
      else this.qty = Math.max(1, Math.min(now.count, this.qty));
    }
    this.render();
    return r;
  }

  say(text: string, bad: boolean): void {
    this.note = text;
    this.noteBad = bad;
    const n = this.root?.querySelector('.tr-note');
    if (n) { n.textContent = text; n.classList.toggle('refused', bad); }
  }

  /** The deal line for the selection (price or the refusal), and whether Confirm may go ahead. */
  private dealLine(c: TradeCtx): {text: string; bad: boolean; ok: boolean} {
    const s = this.selection, st = this.selected();
    if (!s || !st) return {text: 'Pick one of your items to sell, or something on the stall to buy.', bad: false, ok: false};
    // fuel in the common units: a can is FUEL.canUnits quarter-tank units (tanksText: "¼ tank", "½ tank" …)
    const cond = st.itemId === FUEL.canItem ? `${tanksText(this.qty * FUEL.canUnits)} of fuel` : conditionText(st);
    const what = `${amountText(st.itemId, this.qty)}${cond ? ` (${cond})` : ''}`;
    if (s.side === 'sell') {
      const q = quoteSell(c, s.ref, this.qty);
      if (!q.ok) return {text: q.text, bad: true, ok: false};
      const no = checkSell(c, s.ref, this.qty);
      if (no) return {text: no.text, bad: true, ok: false};
      const best = betterStall(c.stall, st, this.qty, c.names);
      return {text: `Sell ${what} for ${tiesText(q.price)}${best ? ` · ${best.name} pays ${best.price}` : ''}`, bad: false, ok: true};
    }
    const q = quoteBuy(c, s.index, this.qty);
    if (!q.ok) return {text: q.text, bad: true, ok: false};
    if (!q.afford) return {text: `Buy ${what} for ${tiesText(q.price)} — you have only ${tiesText(q.have)}${bagNote(c)}`, bad: true, ok: false};
    if (!q.room) return {text: q.roomText, bad: true, ok: false};
    return {text: `Buy ${what} for ${tiesText(q.price)}`, bad: false, ok: true};
  }

  render(): void {
    const c = this.host.ctx();
    if (c && this.selection) { // the selection follows its stack: a stall lot that moved up the list is re-found; a stack that left clears it
      const sel = this.selection, list = c.stock.stalls[c.stall];
      if (sel.side === 'buy' && this.selStack && list[sel.index] !== this.selStack) {
        const i = list.indexOf(this.selStack);
        this.selection = i >= 0 ? {side: 'buy', index: i} : null;
      } else if (sel.side === 'sell' && this.selStack && c.inv.get(sel.ref) !== this.selStack) this.selection = null;
      if (!this.selection || !this.selected()) { this.selection = null; this.selStack = null; } // the selected stack is gone (used, merged, sold)
    }
    if (c && this.selection) { const st = this.selected()!; this.qty = Math.max(1, Math.min(st.count, this.qty)); }
    const d = c ? this.dealLine(c) : {text: '', bad: false, ok: false};
    this.deal = d.text;
    this.dealBad = d.bad;
    const root = this.root;
    if (!root || !c) return;
    const inv = c.inv, sel = this.selection;
    const isSel = (side: string, bar: string, i: number) => !!sel && (sel.side === 'buy' ? side === 'stock' && sel.index === i : side === 'sell' && sel.ref.bar === bar && sel.ref.index === i);
    const cell = (side: 'sell' | 'stock', bar: string, i: number, st: ItemStack | null, key: string) => {
      const def = st ? ITEMS[st.itemId] : null;
      const w = def?.kind === 'weapon' ? WEAPONS[def.weaponId!] : null;
      const count = def ? (w ? (w.melee ? '' : `<span class="count">${st!.mag ?? 0} of ${w.magazine}</span>`) : st!.count > 1 ? `<span class="count">×${st!.count}</span>` : '') : '';
      let price = '', no = false, why = '', quick = '', worth = '';
      const ref: SlotRef = {bar: bar as SlotRef['bar'], index: i};
      if (st && side === 'sell') {
        const q = quoteSell(c, ref);
        if (q.ok) { price = `sell ${q.price}`; worth = `This stall pays ${tiesText(q.price)}${st.count > 1 ? ' for the lot' : ''}`; } else { price = '—'; no = true; why = q.text; }
      } else if (st) { const n = buyPrice(st, st.count); price = `${n}`; worth = `Costs ${tiesText(n)}${st.count > 1 ? ' for the lot' : ''}`; }
      if (st && !no) { // exactly what a Ctrl+click does (the quantity / price Confirm would use)
        const sel: TradeSel = side === 'sell' ? {side: 'sell', ref} : {side: 'buy', index: i};
        const n = this.quickQty(sel), qb = sel.side === 'buy' ? quoteBuy(c, i, n) : null, q = qb ?? quoteSell(c, ref, n);
        const short = qb?.ok && !qb.afford ? ` (you have ${tiesText(qb.have)})` : '';
        if (q.ok) quick = `Ctrl+click: ${sel.side} ${amountText(st.itemId, q.count)} for ${tiesText(q.price)}${short}`;
      }
      // the game's tooltip (ui/tooltip.ts; never a native title, which outlives the panel): this stack's own lines (rounds, filter, air,
      // armour left, a bag's contents), what the stall pays / charges or why it refuses (amber), and what a Ctrl+click does
      const title = st && def ? tipAttrs(itemTip(st, quick || (no ? undefined : 'Click to pick it, then Confirm'), {inv, lines: [why || worth], tone: no ? 'warn' : undefined})) : '';
      const cls = `slot tr-cell${def ? ' filled' : ''}${no ? ' tr-no' : ''}${isSel(side, bar, i) ? ' tr-sel' : ''}${bar === 'pack' && i >= PACK_SIZE ? ' gear-extra' : ''}`;
      return `<div class="${cls}" data-side="${side}" data-bar="${bar}" data-index="${i}"${title}>${key}${def ? itemIconHtml(def.id) : ''}<span class="nm">${def ? esc(def.short) : ''}</span>${count}<span class="tr-price">${price}</span></div>`;
    };
    const box = (name: string, html: string) => { const b = root.querySelector(`[data-side="${name}"]`); if (b) b.innerHTML = html; };
    box('carry', [
      ...inv.hotbar.map((st, i) => cell('sell', 'hotbar', i, st, `<span class="key">${i + 1}</span>`)),
      ...inv.throwSlot.map((st, i) => cell('sell', 'throw', i, st, '<span class="key">G</span>')),
      ...inv.meleeSlot.map((st, i) => cell('sell', 'melee', i, st, `<span class="key">~</span>${st ? '' : `<span class="ghost">${ICONS.knife}</span>`}`)),
    ].join(''));
    box('pack', inv.pack.map((st, i) => cell('sell', 'pack', i, st, '')).join(''));
    box('worn', inv.gearSlots.map((st, i) => cell('sell', 'gear', i, st, `<span class="key">${GEAR_SLOT_NAMES[GEAR_SLOTS[i]]}</span>`)).join(''));
    const stock = c.stock.stalls[c.stall];
    box('stock', stock.map((st, i) => cell('stock', 'stock', i, st, '')).join(''));
    const set = (sel: string, text: string) => { const e = root.querySelector(sel); if (e) e.textContent = text; };
    set('.tr-title', this.host.stallName());
    const wal = root.querySelector('.tr-wallet');
    if (wal) { const bag = bagTies(inv); wal.innerHTML = `${tiesHtml(carriedTies(inv))}${bag ? `<span class="tr-bagties">+ ${tiesText(bag)} in your backpack</span>` : ''}`; }
    const fuel = c.stall === 'fuel' ? ` · one can = ${tanksText(FUEL.canUnits)} · your train holds ${tanksText(trainCapacityUnits())}` : '';
    set('.tr-stock-h', `Stall stock · buy · ${stock.length} ${stock.length === 1 ? 'lot' : 'lots'}${fuel}`);
    const ex = inv.extraPockets;
    set('.tr-pockets', `Pockets · ${inv.pack.length}${ex ? ` (${PACK_SIZE} + ${ex} chest rig)` : ''}`);
    const dl = root.querySelector('.tr-deal-text');
    if (dl) { dl.textContent = d.text; dl.classList.toggle('refused', d.bad); }
    set('.tr-qty', String(this.selection ? this.qty : 0));
    const st = this.selected();
    const conf = root.querySelector('.tr-confirm') as HTMLButtonElement | null;
    if (conf) { conf.disabled = !d.ok; conf.textContent = !sel ? 'Confirm' : sel.side === 'sell' ? 'Sell' : 'Buy'; }
    const cancel = root.querySelector('.tr-cancel') as HTMLButtonElement | null;
    if (cancel) cancel.disabled = !sel;
    for (const b of root.querySelectorAll?.('.tr-qtys button') ?? []) (b as HTMLButtonElement).disabled = !st || st.count <= 1;
    const n = root.querySelector('.tr-note');
    if (n) { n.textContent = this.note; n.classList.toggle('refused', this.noteBad); }
    refreshTooltip(); // the slots were rewritten: the tooltip re-binds to the one under the pointer (its new text) or hides
  }
}
