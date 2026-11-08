// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE TRADE CONTROLLER — installMarketTrade(game) is called ONCE from the
// Game constructor and only REGISTERS (inert on every level without `layout.market`):
//  - runParticipants: 'market.wallet' — task studio-market-rework-20261108-074144-01: no balance any more (Rail Ties are the physical item,
//    market/trade/payment.ts); it only carries an OLD save's balance over once (market/trade/wallet.ts LegacyWallet): settleWallet places
//    it as real ties at the next section build / frame (carried, then the train's Lockbox, then the parked car's floor) with a toast;
//  - sectionHooks.build: this station's stalls (layout.market, gen/market/marketTypes.ts) and stock — the remembered record from the
//    station's lane memory, else the stock seeded ONCE right now and written there (market/trade/stock.ts); the inventory's uid counter
//    is reserved above every stock uid. teardown closes the view and forgets the live stock (the memory already has it);
//  - frameHooks + promptProviders: standing at a stall's customer spot (`front`: within TRADE_RT.reach, its storey, facing the counter)
//    shows "[E] Trade — <stall sign> · N ties" (N = the ties you carry; nothing on the HUD);
//  - HOSTILITY (task studio-market-rework-20261108-074144-01; market/hostility.ts, Game.marketHostility — the combat lane's): a stall
//    trades only while canTrade(stall) !== false. Otherwise no prompt (E stays the world's: the counter's loot can be picked up), [E] /
//    openStall refuse, an open view closes at once (checked per frame) with a line saying why, and every transaction is refused;
//  - interactHandlers (E): opens the trade view (market/trade/tradeView.ts) for that stall and tells the trader (onTalk: the residents /
//    traders lane's optional hook);
//  - the view's keys (ui/lockboxView.ts lockboxKeyAction: E / 6 close; Tab / Esc / I close and go on; digits swallowed), the pointer
//    released without pausing, hitListeners (a hit closes it), stateListeners (any state but playing closes it), walking away / dying
//    closes it, inputOwners (the mouse belongs to the view while it is open).
// Every transaction (market/trade/transactions.ts) writes the station's stock record back in the same step.
import type {Inventory, ItemStack, SlotRef} from '../../items/inventory';
import type {SectionKey} from '../../levels/types';
import type {RunState} from '../../run/runState';
import type {RunParticipant} from '../../run/snapshot';
import {MARKET_STALLS, type MarketLayout, type MarketStall, type MarketStallId} from '../../gen/market/marketTypes';
import type {MarketHostilityApi} from '../hostility';
import type {CargoItemJSON} from '../../run/trainCargo';
import {trainSpawnLocal} from '../../gen/playerTrain';
import {PLAYER_TRAIN_SPEC} from '../../world/playerTrainSpec';
import {lockboxKeyAction} from '../../ui/lockboxView';
import {LegacyWallet} from './wallet';
import {carriedTies, migrateTies, type TiesPlaced} from './payment';
import {MARKET_STOCK_LANE, MarketStock} from './stock';
import {STALL_TRADE} from './stalls';
import {buy, sell, type TradeCtx, type TradeResult} from './transactions';
import {TradeView} from './tradeView';
import {tiesText} from './ties';

export const TRADE_RT = {
  /** Horizontal reach (m) from a stall's customer spot (`front`) for the [E] prompt. */
  reach: 1.6,
  /** Same storey: the feet within this height of the spot (m). */
  storey: 1.2,
  /** Largest angle (rad) between the view and the direction to the counter's centre. */
  look: 1.1,
  /** The open view closes beyond this distance (m) from the spot, or with the feet this far off its floor. */
  closeRange: 2.6,
  closeRise: 1.4,
} as const;

export const TRADE_TEXT = {
  hit: 'Hit! You stepped back from the stall',
  far: 'Too far from the stall — trade closed',
  // task studio-market-rework-20261108-074144-01 (lane TRADE): hostility (market/hostility.ts) and the old balance's migration
  hostile: 'The market has turned on you — nobody will trade with you now',
  unmanned: 'Nobody is minding this stall any more — trade closed',
  refused: 'This stall will not trade with you.',
  migrated: (p: TiesPlaced) => `Your market balance is now real Rail Ties: ${[p.carried ? `${p.carried} carried` : '', p.lockbox ? `${p.lockbox} in the train's Lockbox` : '',
    p.cargo ? `${p.cargo} on the train's floor` : ''].filter(Boolean).join(' · ')}${p.left ? ` · ${p.left} more once you make room` : ''}`,
  owed: (n: number) => `${n} Rail Ties from your old market balance are waiting — free a quick slot, pocket or Lockbox slot to take them`,
} as const;

export type TradeCloseReason = 'user' | 'hit' | 'distance' | 'state' | 'travel' | 'gone' | 'hostile';

/** What the trade needs from Game (structural: tests drive it with a plain host + a real Inventory / RunState). */
export interface TradeHost {
  /** Read on every use (Game replaces the inventory's contents on Retry / Load; the run on New Game / Load). */
  inv: Inventory;
  run: RunState;
  player: {x: number; y: number; z: number; yaw: number; alive: boolean};
  state: string;
  qa?: boolean;
  hud: {toast(text: string, warn?: boolean): void};
  sfx?: unknown;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  interactHandlers: (() => boolean)[];
  promptProviders?: (() => string | null)[];
  runParticipants?: RunParticipant[];
  stateListeners?: ((state: never, prev: never) => void)[];
  inputOwners?: (() => boolean)[];
  hitListeners?: ((hit: {amount: number}) => void)[];
  input?: {onLockChange: (locked: boolean) => void; lock(): Promise<boolean>; unlock(): void; readonly locked: boolean} | null;
  gear?: {session?: unknown; cancelReady?(resync: boolean): void; showResume?(): void} | null;
  syncHeld?(): void;
  /** Task studio-market-rework-20261108-074144-01: the settlement's hostility (market/hostility.ts; the combat lane sets it). Read live. */
  marketHostility?: MarketHostilityApi | null;
  /** The run's player train (run/playerTrain.ts): its Lockbox and loose cargo take an old balance's overflow. Read live. */
  playerTrain?: {lockbox: {readonly slots: (ItemStack | null)[]; version: number}; cargo: {records(): CargoItemJSON[]; add(item: CargoItemJSON): void}} | null;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const centre = (s: MarketStall) => ({x: (s.counter.x0 + s.counter.x1) / 2, z: (s.counter.z0 + s.counter.z1) / 2});

export class TradeSystem {
  /** The 'market.wallet' participant: an old save's balance still owed as physical ties (wallet.ts; settleWallet places it). */
  readonly legacy = new LegacyWallet();
  readonly view: TradeView;
  /** This station's stalls (empty: no market here). */
  stalls: MarketStall[] = [];
  /** The live stock of this station (null: no market built). */
  stock: MarketStock | null = null;
  /** The stall in reach (null: none). */
  target: MarketStall | null = null;
  /** The stall whose view is open (null: closed). */
  open: MarketStall | null = null;
  /** The residents / traders lane's hook: a stall's view opened (its trader may greet / turn). */
  onTalk: ((stall: MarketStallId) => void) | null = null;
  /** QA / tests. */
  readonly counts = {seeded: 0, loaded: 0, opens: 0, closes: 0, refused: 0, trades: 0, writes: 0, settled: 0};
  lastClose: TradeCloseReason | null = null;
  /** The section the live stock belongs to (its memory gets every write). */
  private key: SectionKey | null = null;
  private ownsPointer = false;
  private lockGraceUntil = 0;
  private seen = '';
  /** The state settleWallet last tried in (it retries an unplaced remainder only when the inventory / Lockbox changed). */
  private settleSeen = '';
  /** The owed amount the "waiting" warning last named (said once per amount, not on every retry). */
  private owedSaid = -1;

  constructor(readonly host: TradeHost) {
    this.view = new TradeView({
      ctx: () => this.ctx(),
      stallName: () => this.open?.name ?? '',
      sell: (ref, n) => this.sell(ref, n),
      buy: (i, n) => this.buy(i, n),
      close: () => this.close('user'),
    });
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  install(): this {
    const h = this.host;
    h.runParticipants?.push(this.legacy.participant());
    h.sectionHooks.push({build: (layout: never) => this.build(layout as {market?: MarketLayout} | null), teardown: () => this.teardown()});
    h.frameHooks.push(() => this.frame());
    h.interactHandlers.push(() => this.interact());
    h.promptProviders?.push(() => this.prompt());
    h.hitListeners?.push(hit => { if (this.open && hit.amount > 0) this.close('hit'); });
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.close('state'); }) as (s: never, p: never) => void);
    h.inputOwners?.push(() => this.open !== null);
    const inp = h.input;
    if (inp) { // the view releases pointer lock WITHOUT pausing (like the Lockbox)
      const prev = inp.onLockChange;
      inp.onLockChange = locked => {
        if (!locked && (this.ownsPointer || now() < this.lockGraceUntil) && h.state === 'playing') return;
        prev(locked);
      };
    }
    if (typeof window !== 'undefined') window.addEventListener('keydown', e => this.onKeyCapture(e), {capture: true});
    return this;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  /** A station was built: its stalls, and its stock (remembered, else seeded once now and remembered). */
  build(layout: {market?: MarketLayout} | null): void {
    this.teardown();
    this.settleWallet(); // (any station: an old balance becomes real ties wherever the loaded run goes on)
    const m = layout?.market;
    if (!m || !Array.isArray(m.stalls)) return;
    this.stalls = m.stalls.filter(s => (MARKET_STALLS as readonly string[]).includes(s.id));
    if (!this.stalls.length) return;
    const run = this.host.run, key: SectionKey = {...run.current};
    this.key = key;
    const rec = run.laneStore<unknown>(MARKET_STOCK_LANE, key);
    if (rec !== undefined) {
      this.stock = MarketStock.fromJSON(rec);
      this.counts.loaded++;
    } else {
      const inv = this.host.inv;
      this.stock = MarketStock.seed(run.scopeOf(key), run.seedFor(key), (id, n) => inv.makeStack(id, n));
      this.counts.seeded++;
      this.write();
    }
    this.host.inv.reserveUids(this.stock.maxUid());
  }

  /** Leaving the station: close; forget the live stock (its memory holds every change already). */
  teardown(): void {
    this.close('travel');
    this.stalls = [];
    this.stock = null;
    this.target = null;
    this.key = null;
  }

  /**
   * Task studio-market-rework-20261108-074144-01: the ONE path besides a trade that takes a stack out of a stall's stock — the owned
   * displayed wares (market/wares) when the player steals one: removes `count` (default all) of stock stack `uid` and records the stock at
   * once. The whole stack leaves as the same object (uid / state kept); a partial take is a fresh-uid piece (the run's counter). Null: not
   * in stock (nothing changes).
   */
  takeStock(stall: MarketStallId, uid: number, count?: number): ItemStack | null {
    const list = this.stock?.stalls[stall];
    const i = list ? list.findIndex(st => st.uid === uid) : -1;
    if (!list || i < 0) return null;
    const st = list[i], n = Math.max(1, Math.min(st.count, Math.floor(count ?? st.count)));
    let piece: ItemStack;
    if (n >= st.count) { piece = st; list.splice(i, 1); } else { piece = {...st, uid: this.host.inv.allocUid(), count: n}; delete piece.bag; st.count -= n; }
    this.stock!.version++;
    this.write();
    return piece;
  }

  /**
   * Task studio-market-rework-20261108-074144-01 (lane TRADE): THE ONE-TIME MIGRATION of an old save's balance (wallet.ts) — the owed ties
   * are placed physically (payment.ts migrateTies: carried first, then the train's Lockbox, then ties pickups lying in the parked car via
   * the train cargo's pending path) and `owed` drops by exactly what was placed, in the same step (a save before or after is coherent; the
   * participant then saves {v: 2, migrated: true}). Called at every section build and per frame while playing (after a Load / Retry the
   * Lockbox and cargo are restored by then). What finds no room stays owed (never discarded) and is retried when the inventory or the
   * Lockbox changes. Returns where they went (null: nothing owed / nothing new to try).
   */
  settleWallet(): TiesPlaced | null {
    const owed = this.legacy.owed, h = this.host;
    if (!owed) return null;
    const train = h.playerTrain ?? null, key = `${h.inv.version}:${train?.lockbox.version ?? -1}:${owed}`;
    if (key === this.settleSeen) return null;
    const spawn = trainSpawnLocal(), step = 0.42;
    const placed = migrateTies(owed, {inv: h.inv, lockbox: train?.lockbox, cargo: train?.cargo,
      pose: k => ({x: spawn.x + (k % 4) * step, y: PLAYER_TRAIN_SPEC.floorY, z: -0.2 + Math.floor(k / 4) * 0.3})});
    const n = placed.carried + placed.lockbox + placed.cargo;
    this.legacy.settle(n);
    this.settleSeen = `${h.inv.version}:${train?.lockbox.version ?? -1}:${this.legacy.owed}`;
    if (n) { this.counts.settled++; h.syncHeld?.(); h.hud.toast(TRADE_TEXT.migrated(placed), placed.left > 0); }
    else if (placed.left !== this.owedSaid) h.hud.toast(TRADE_TEXT.owed(placed.left), true);
    this.owedSaid = placed.left;
    return placed;
  }

  /** Task studio-market-rework-20261108-074144-01: whether that stall's trader trades with the player now (market/hostility.ts). */
  canTrade(id: MarketStallId): boolean {
    return this.host.marketHostility?.canTrade(id) !== false;
  }

  /** The station's stock record -> its lane memory (after seeding and after every trade). */
  private write(): void {
    if (!this.stock || !this.key) return;
    this.host.run.setLaneStore(MARKET_STOCK_LANE, this.stock.toJSON(), this.key);
    this.counts.writes++;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Aim / prompt / open / close

  /** The stall whose customer spot the player stands at (reach, its storey, facing its counter), or null. */
  aimed(): MarketStall | null {
    const p = this.host.player;
    let best: MarketStall | null = null, bd = Infinity;
    for (const s of this.stalls) {
      const f = s.front, d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d > TRADE_RT.reach || Math.abs(p.y - f.y) > TRADE_RT.storey) continue;
      const c = centre(s), dx = c.x - p.x, dz = c.z - p.z, dc = Math.hypot(dx, dz);
      if (dc > 1e-3) {
        const cos = (-Math.sin(p.yaw) * dx + -Math.cos(p.yaw) * dz) / dc; // the view (forward = (-sin yaw, -cos yaw)) toward the counter
        if (Math.acos(Math.max(-1, Math.min(1, cos))) > TRADE_RT.look) continue;
      }
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  frame(): void {
    const h = this.host;
    if (this.legacy.owed && h.state === 'playing' && h.player.alive) this.settleWallet();
    if (!this.stalls.length) return;
    const t = h.state === 'playing' && h.player.alive && !this.open ? this.aimed() : null;
    this.target = t && this.canTrade(t.id) ? t : null; // (a hostile / unmanned stall: no prompt, E stays the world's)
    if (this.open) this.update();
  }

  prompt(): string | null {
    if (this.open || !this.target) return null;
    const sign = this.target.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); // (the HUD prompt is markup)
    return `<b>[E]</b> Trade — ${sign} · ${tiesText(carriedTies(this.host.inv))}`;
  }

  /** [E]: open the stall in reach. */
  interact(): boolean {
    if (this.open) { this.close('user'); return true; }
    if (!this.target || !this.canTrade(this.target.id)) return false;
    return this.openStall(this.target.id);
  }

  /** Open a stall's view ([E]; QA). Refused outside play, when dead, while a bag view is open, or without this station's stock. */
  openStall(id: MarketStallId): boolean {
    const h = this.host, s = this.stalls.find(x => x.id === id);
    if (this.open) return this.open.id === id;
    if (!s || !this.stock || h.state !== 'playing' || !h.player.alive || h.gear?.session || !this.canTrade(id)) { this.counts.refused++; return false; }
    h.gear?.cancelReady?.(true);
    this.open = s;
    this.target = null;
    this.seen = this.key2();
    this.ownsPointer = true;
    this.lockGraceUntil = now() + 500;
    if (!h.qa) h.input?.unlock();
    this.view.show();
    this.counts.opens++;
    try { this.onTalk?.(s.id); } catch (err) { console.warn('market trade: onTalk failed', err); }
    return true;
  }

  /** Close the view. A player close re-takes the mouse (or shows "click to aim"). */
  close(reason: TradeCloseReason): void {
    if (!this.open) return;
    this.open = null;
    this.view.hide();
    this.ownsPointer = false;
    this.lockGraceUntil = now() + 300;
    this.counts.closes++;
    this.lastClose = reason;
    const h = this.host;
    if (reason === 'state' || reason === 'travel' || reason === 'gone') return;
    if (reason === 'hit') h.hud.toast(TRADE_TEXT.hit, true);
    if (reason === 'distance') h.hud.toast(TRADE_TEXT.far, true);
    if (reason === 'hostile') h.hud.toast(h.marketHostility?.hostile ? TRADE_TEXT.hostile : TRADE_TEXT.unmanned, true);
    const inp = h.input;
    if (h.state !== 'playing' || h.qa || !inp || inp.locked) return;
    void inp.lock().then(ok => { if (!ok && h.state === 'playing' && !inp.locked) h.gear?.showResume?.(); });
  }

  /** Per frame while open: death / no stock -> close; the trader hostile / dead / fled -> close; out of reach -> close; redraw on changes. */
  private update(): void {
    const s = this.open!, p = this.host.player;
    if (!this.stock) { this.close('gone'); return; }
    if (!p.alive) { this.close('state'); return; }
    if (!this.canTrade(s.id)) { this.close('hostile'); return; }
    if (Math.hypot(p.x - s.front.x, p.z - s.front.z) > TRADE_RT.closeRange || Math.abs(p.y - s.front.y) > TRADE_RT.closeRise) { this.close('distance'); return; }
    const k = this.key2();
    if (k !== this.seen) { this.seen = k; this.view.render(); }
  }

  private key2(): string {
    return `${this.host.inv.version}:${this.stock?.version ?? -1}`;
  }

  /** The keydown capture listener while open: E / 6 close, Tab / Esc / I close and go on, digits consumed (never the quick slots). */
  onKeyCapture(e: Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target' | 'preventDefault' | 'stopPropagation'>): void {
    const a = lockboxKeyAction(e, this.open !== null);
    if (a.kind === 'pass' || a.kind === 'reset') return;
    if (a.kind === 'close-pass') { this.close('state'); return; }
    e.preventDefault();
    e.stopPropagation(); // never reaches player/input.ts ([E] interact, quick slots 1-5, 6)
    if (a.kind === 'close') this.close('user');
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Trades (the open view's Confirm)

  /** The open trade's context (null: closed). */
  ctx(): TradeCtx | null {
    if (!this.open || !this.stock) return null;
    const names: Partial<Record<MarketStallId, string>> = {};
    for (const s of this.stalls) names[s.id] = s.name;
    return {inv: this.host.inv, stock: this.stock, stall: this.open.id, names};
  }

  private done(r: TradeResult): TradeResult {
    const sfx = this.host.sfx as {pickup?(): void; denied?(): void} | null | undefined;
    if (r.ok) {
      this.write();
      this.counts.trades++;
      this.host.syncHeld?.();
      sfx?.pickup?.();
    } else sfx?.denied?.();
    return r;
  }

  /** Sell `count` of the stack in `ref` to the open stall (all or nothing). */
  sell(ref: SlotRef, count?: number): TradeResult {
    const c = this.ctx();
    if (!c) return {ok: false, code: 'gone', text: 'Walk up to a stall and press E to trade.'};
    if (!this.canTrade(c.stall)) return this.done({ok: false, code: 'closed', text: TRADE_TEXT.refused});
    return this.done(sell(c, ref, count));
  }

  /** Buy `count` of the open stall's stock stack `index` (all or nothing). */
  buy(index: number, count?: number): TradeResult {
    const c = this.ctx();
    if (!c) return {ok: false, code: 'gone', text: 'Walk up to a stall and press E to trade.'};
    if (!this.canTrade(c.stall)) return this.done({ok: false, code: 'closed', text: TRADE_TEXT.refused});
    return this.done(buy(c, index, count));
  }

  /** QA: a compact state report. */
  qa() {
    return {open: this.open?.id ?? null, target: this.target?.id ?? null, ties: carriedTies(this.host.inv), owed: this.legacy.owed, stalls: this.stalls.map(s => s.id),
      stock: this.stock ? Object.fromEntries(MARKET_STALLS.map(s => [s, this.stock!.summary(s)])) : null,
      note: this.view.note, noteBad: this.view.noteBad, deal: this.view.deal, lastClose: this.lastClose, counts: {...this.counts},
      lines: Object.fromEntries(MARKET_STALLS.map(s => [s, STALL_TRADE[s].line]))};
  }
}

/** Installs the market trade into a Game (one call in the Game constructor, after the Lockbox). */
export function installMarketTrade(game: unknown): TradeSystem {
  return new TradeSystem(game as TradeHost).install();
}

const qaRef = (spec: string): SlotRef => {
  const [bar, n] = spec.split(':');
  return {bar: bar as SlotRef['bar'], index: Number(n)};
};

/** QA hooks (spread into window.__LL by qa.ts) for SHORT serial browser spot checks. `sys`: the installed controller. */
export function marketTradeQaApi(sys: () => TradeSystem | null | undefined) {
  return {
    /** Open stall, target, the ties carried (and an old balance still owed), stock per stall, the note / deal line, counts. */
    trade: () => sys()?.qa() ?? null,
    /** Open a stall's view as [E] at its counter would (false: not playing / no such stall here). */
    tradeOpen: (stall: MarketStallId) => sys()?.openStall(stall) ?? false,
    tradeClose: () => sys()?.close('user'),
    /** Sell from a slot ('pack:0', 'hotbar:2', 'gear:1'), `count` of it (default all). */
    tradeSell: (spec: string, count?: number) => sys()?.sell(qaRef(spec), count) ?? null,
    /** Buy `count` (default all) of the open stall's stock lot `index`. */
    tradeBuy: (index: number, count?: number) => sys()?.buy(index, count) ?? null,
    /** Task studio-market-rework-20261108-074144-01: a Ctrl+click on a carried slot ('pack:0') / a stock lot (its index), as the view does it. */
    tradeQuickSell: (spec: string) => sys()?.view.quick({side: 'sell', ref: qaRef(spec)}) ?? null,
    tradeQuickBuy: (index: number) => sys()?.view.quick({side: 'buy', index}) ?? null,
  };
}
