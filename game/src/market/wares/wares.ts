// Task studio-market-rework-20261108-074144-01 (lane WARES; user: "Shops should have actually items they sell on display! If the player
// picks those items up, the shop keeper will attack them, building on the hostility system. The player must see a "steal" tooltip in red
// when looking at the item so they know they will be stealing."): THE STALLS' OWNED WARES — every market stall shows its REAL, finite
// stock (market/trade/stock.ts MarketStock, game.trade.stock) as real world items on its display surfaces (market/wares/slots.ts),
// placed by the display plan (market/wares/plan.ts). installMarketWares(game) is called ONCE from the Game constructor, AFTER the trade
// (its section build reads the trade's stock), and only REGISTERS (inert where the layout has no market).
//
// A REPRESENTATION, NEVER A COPY: each displayed ware IS a stock stack — the very ItemStack object of the stall's list (uid, count,
// magazine, filter, air, wear) on an ordinary world pickup (world/pickups.ts PickupManager: the item's normal model; shot / knocked /
// woken by the shelf physics like any item, physics/dynamicItems.ts) tagged OWNED by its stall (Pickup.owner).
//  - BUILD (sectionHooks.build, every build: arrival, revisit, Retry, Load): the displays are rebuilt from the stock alone — every ware
//    back on its spot (a knocked one re-sits there). TEARDOWN removes them. Owned pickups are never station memory (run/worldMemory.ts
//    capturePickups), never train cargo (world/trainCargo.ts: knocked into the parked car they stay the stall's), never station fuel
//    (world/fuelStations.ts), never generated / salvage loot (the surfaces' holders carry the market's exact empty key; slots.ts
//    vendorDisplayHosts lists them for any loot system to leave alone).
//  - CHANGES (per frame, on the stock's `version`): a bought / stolen stack's ware goes (wherever it lies); a partly bought one shows the
//    rest (the same stack); a sold stack joins the display in a free gap (the others never move); nothing is ever restocked.
//  - MORE STOCK THAN SPACE: the plan shows the stacks in stock order that fit (at most WARES.maxPerStall per stall); the rest stays in the
//    stock, listed and bought in the trade view.
// OWNERSHIP AND THEFT:
//  - the plain [E] Take never targets an owned pickup (PickupManager.target skips them). This system aims at its wares itself: the
//    crosshair ray on a ware's own box (within WARES.reach, in sight) shows the in-game prompt "[E] Steal <item>" with Steal in RED, and
//    its look-at highlight (PickupManager.hover). Its prompt / E come FIRST (unshifted): looking straight at a ware is Steal; looking at
//    the trader / past the wares at the stall's customer spot is still the trade's "[E] Trade".
//  - (task studio-market-bar-20261108-225231-01, lane SHELVES; user: "Move owner wares to a shelf near them, not the counter immediately
//    in front (accidental theft when trying to talk).") the wares stand on the shelves NEAR the trader, never on the customer counter
//    (slots.ts stallSurfaces), and the trader's BODY and the COUNTER occlude the aim (occluder): a ware behind the trader / across the
//    counter is not aimed while the trader / counter is in front of it — the look is the trade's. Only a ware whose own box the crosshair
//    meets first, in reach and in sight, is a red Steal.
//  - [E] on an aimed ware = THEFT: as much of the stack as the inventory takes (simulated first on Inventory.clone(): a full inventory,
//    a taken back slot … refuse with nothing changed — no theft, no loss) leaves the stock through TradeSystem.takeStock (the whole stack
//    as the same object, or a fresh-uid part; the stock record is written at once) into the inventory, and the settlement is provoked:
//    game.marketHostility?.provoke({kind: 'theft', stall}) (market/hostility.ts; the robbed trader attacks: the combat lane's rule).
//  - An owned ware knocked off its spot is still owned (Steal, never Take) and goes back to its spot on the next build. Bought goods and
//    stolen goods are ordinary player items.
import * as THREE from 'three';
import {ITEM_DIMS, itemDef} from '../../items/items';
import {ammoText} from '../../items/calibers';
import {stackFromJSON, stackToJSON, type ItemStack} from '../../items/inventory';
import {MARKET_STALLS, type MarketLayout, type MarketStall, type MarketStallId} from '../../gen/market/marketTypes';
import type {PropPlacement} from '../../gen/props';
import type {Pickup} from '../../world/pickups';
import {localBounds} from '../../physics/dynamicItems';
import {rayAabb, rayCapsule} from '../../combat/hitscan';
import type {MarketHostilityApi} from '../hostility';
import type {AcquireSource} from '../beer/effectsApi'; // task studio-market-bar-20261108-225231-01 (lane BEER)
import type {MarketStock} from '../trade/stock';
import {WARES, counterBoxes, stallSurfaces} from './slots';
import {planStall, type WareDims, type WarePacker, type WarePlace} from './plan';

/** The red of the Steal prompt. */
export const STEAL_RED = '#ff4b3e';

export const WARES_TEXT = {
  /** The in-game interaction prompt on an aimed ware (HUD markup). */
  steal: (label: string) => `<b>[E]</b> <span class="steal" style="color:${STEAL_RED};font-weight:700">Steal</span> ${label}`,
  stolen: (label: string) => `Stolen: ${label}`,
  noRoom: 'No room in inventory — drop something (Tab)',
} as const;

/** What the wares need from Game (structural: Node tests drive it with the trade test host, a real PickupManager / Inventory). */
export interface WaresHost {
  trade: {stock: MarketStock | null; readonly isOpen: boolean; takeStock(stall: MarketStallId, uid: number, count?: number): ItemStack | null} | null;
  pickups: {list: Pickup[]; addAt(stack: ItemStack, m: THREE.Matrix4): Pickup; remove(p: Pickup): void; meshFor(itemId: string): THREE.Object3D; hover?: Pickup | null};
  inv: {add(s: ItemStack): number; clone(): {add(s: ItemStack): number; refusal?: {text: string} | null}};
  camera: THREE.Camera;
  player: {alive: boolean};
  state: string;
  levels?: {count: number; lineOfSight(a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}, o?: {slack?: number}): boolean} | null;
  layout?: {grid?: {lineOfSight(ax: number, az: number, bx: number, bz: number): boolean}} | null;
  hud: {toast(text: string, warn?: boolean): void};
  sfx?: unknown;
  /** The combat lane's settlement hostility (absent: no one reacts yet; the theft itself still happens). */
  marketHostility?: MarketHostilityApi | null;
  /** (task studio-market-bar-20261108-225231-01) The live traders (their bodies occlude the Steal aim). Absent: each stall's trader post. */
  marketPeople?: {traderAt(stall: MarketStallId): {x: number; y: number; z: number} | null} | null;
  trainRide?: {riding: boolean} | null;
  gear?: {session?: unknown; readied?: boolean} | null;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  interactHandlers: (() => boolean)[];
  promptProviders?: (() => string | null)[];
  syncHeld?(): void;
  /** Task studio-market-bar-20261108-225231-01 (lane BEER): the Pilsner's one acquisition hook (Game.beerEffects; absent: nothing). */
  beerEffects?: {acquired?(source: AcquireSource, taken: ItemStack): void} | null;
}

/** One displayed ware: the stall's stock stack on its pickup, where the plan put it, its model's local box. */
export interface Ware {
  stall: MarketStallId;
  uid: number;
  pickup: Pickup;
  place: WarePlace;
  box: THREE.Box3;
}

type WaresLayout = {market?: MarketLayout; props: readonly PropPlacement[]};

const M = new THREE.Matrix4(), LIE = new THREE.Matrix4(), INV = new THREE.Matrix4(), SEAT = new THREE.Box3();
const EYE = new THREE.Vector3(), DIR = new THREE.Vector3(), LO = new THREE.Vector3(), LD = new THREE.Vector3(), HIT = new THREE.Vector3();

/** "Rifle — …", "30 9mm rounds", "2 × Bandage" (the plain Take prompt's wording, game.ts updateHud). */
export function wareLabel(st: {itemId: string; count: number}, n = st.count): string {
  const d = itemDef(st.itemId);
  return d.kind === 'weapon' ? d.name : ammoText(d.id, n) ?? `${n > 1 ? n + ' × ' : ''}${d.name}`;
}

export class MarketWares {
  /** Displayed wares by uid. */
  readonly wares = new Map<number, Ware>();
  /** The ware under the crosshair (prompt / E), or null. */
  aimed: Ware | null = null;
  /** QA / tests. */
  readonly counts = {builds: 0, spawned: 0, removed: 0, syncs: 0, thefts: 0, refused: 0};
  lastTheft: {stall: MarketStallId; uid: number; itemId: string; count: number} | null = null;
  private readonly packers = new Map<MarketStallId, WarePacker>();
  private readonly dims = new Map<string, WareDims>();
  private readonly boxes = new Map<string, THREE.Box3>();
  private stock: MarketStock | null = null;
  private layout: WaresLayout | null = null;
  private seen = -1;
  /** (task studio-market-bar-20261108-225231-01) The built stalls and their counters' solid boxes: the Steal aim's occluders. */
  private stalls: MarketStall[] = [];
  private counters: {min: {x: number; y: number; z: number}; max: {x: number; y: number; z: number}}[] = [];
  /** QA / tests: what blocked the last aim at a ware ('trader' | 'counter' | ''). */
  lastBlock: '' | 'trader' | 'counter' = '';

  constructor(readonly host: WaresHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: (layout: never) => this.build(layout as WaresLayout | null), teardown: () => this.teardown()});
    h.frameHooks.push(() => this.frame());
    // FIRST (unshift): aimed straight at a ware, Steal wins over the stall's Trade prompt / E at its customer spot
    h.interactHandlers.unshift(() => this.interact());
    h.promptProviders?.unshift(() => this.prompt());
    return this;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  /** A station was built (after the trade loaded / seeded its stock): every stall's displays from its stock. */
  build(layout: WaresLayout | null): void {
    this.teardown();
    const m = layout?.market, stock = this.host.trade?.stock ?? null;
    if (!layout || !m || !Array.isArray(m.stalls)) return;
    this.layout = layout; // (kept even without stock yet: a stock that appears later is displayed by the next frame)
    this.stalls = m.stalls.filter(s => (MARKET_STALLS as readonly string[]).includes(s.id));
    this.counters = this.stalls.flatMap(s => counterBoxes(layout, s));
    if (!stock) return;
    this.stock = stock;
    for (const stall of m.stalls) {
      if (!(MARKET_STALLS as readonly string[]).includes(stall.id)) continue;
      const list = stock.stalls[stall.id] ?? [];
      const pk = planStall(list, stallSurfaces(layout, stall), id => this.dimsOf(id));
      this.packers.set(stall.id, pk);
      for (const st of list) { const pl = pk.placed.get(st.uid); if (pl) this.spawn(stall.id, st, pl); }
    }
    this.seen = stock.version;
    this.counts.builds++;
  }

  /** Leaving the station: the wares go with it (the stock record already holds every change). */
  teardown(): void {
    for (const w of this.wares.values()) this.host.pickups.remove(w.pickup);
    this.counts.removed += this.wares.size;
    this.wares.clear();
    this.packers.clear();
    this.aimed = null;
    this.setHover(null);
    this.stock = null;
    this.layout = null;
    this.seen = -1;
    this.stalls = [];
    this.counters = [];
  }

  /**
   * The size of an item as displayed: its drawn model's own bounds (the item template / a gun lying on its side: world/pickups.ts
   * meshFor), so the plan never overlaps two models; how it may lie down: the registry's shape (a gun never: it already lies).
   */
  dimsOf(itemId: string): WareDims {
    let d = this.dims.get(itemId);
    if (d) return d;
    const s = this.boxOf(itemId).getSize(new THREE.Vector3());
    const reg = ITEM_DIMS[itemId];
    d = {w: s.x, d: s.z, h: s.y, shape: reg && itemDef(itemId).kind !== 'weapon' ? reg.shape : 'flat'};
    this.dims.set(itemId, d);
    return d;
  }

  /** The item model's box in its own frame (cached per item: the shared template / gun model). */
  private boxOf(itemId: string): THREE.Box3 {
    let b = this.boxes.get(itemId);
    if (!b) { b = localBounds(this.host.pickups.meshFor(itemId)); this.boxes.set(itemId, b); }
    return b;
  }

  /**
   * A ware's pickup at its planned spot: the stall's own stack (same object), tagged owned. Its pose: the plan's yaw, then the lie-down
   * turn (items/lootLayout.ts orientations: a cylinder on its side about z, a box on its back about x); then seated by the model's own
   * turned box — its bottom ON the surface, its footprint centred on the planned spot (never floating, never sunk).
   */
  private spawn(stall: MarketStallId, st: ItemStack, pl: WarePlace): Ware {
    M.makeRotationY(pl.yaw);
    if (pl.orient === 'side') M.multiply(LIE.makeRotationZ(Math.PI / 2));
    else if (pl.orient === 'back') M.multiply(LIE.makeRotationX(-Math.PI / 2));
    const b = SEAT.copy(this.boxOf(st.itemId)).applyMatrix4(M);
    M.premultiply(LIE.makeTranslation(pl.x - (b.min.x + b.max.x) / 2, pl.y - b.min.y, pl.z - (b.min.z + b.max.z) / 2));
    const p = this.host.pickups.addAt(st, M);
    p.owner = stall;
    const w: Ware = {stall, uid: st.uid, pickup: p, place: pl, box: this.boxOf(st.itemId)};
    this.wares.set(st.uid, w);
    this.counts.spawned++;
    return w;
  }

  /** A ware leaves the display (bought / stolen / gone): its pickup goes wherever it lies, its spot frees. */
  private drop(w: Ware): void {
    this.host.pickups.remove(w.pickup);
    this.packers.get(w.stall)?.release(w.uid);
    this.wares.delete(w.uid);
    if (this.aimed === w) { this.aimed = null; this.setHover(null); }
    this.counts.removed++;
  }

  /** The displays follow the stock: gone stacks leave, new ones join a free gap (the rest stay where they are). */
  sync(): void {
    const stock = this.stock;
    if (!stock) return;
    const live = new Set(this.host.pickups.list);
    for (const [stall, pk] of this.packers) {
      const list = stock.stalls[stall] ?? [];
      const byUid = new Map(list.map(s => [s.uid, s] as const));
      for (const w of [...this.wares.values()]) {
        if (w.stall !== stall) continue;
        const st = byUid.get(w.uid);
        if (!st || !live.has(w.pickup)) { this.drop(w); continue; } // (bought / stolen; a pickup someone else removed re-sits below)
        if (w.pickup.stack !== st) w.pickup.stack = st; // (one uid is one stock stack: the display shows the stock's own object)
      }
      for (const st of list) {
        if (this.wares.has(st.uid)) continue;
        const pl = pk.place(st.uid, this.dimsOf(st.itemId));
        if (pl) this.spawn(stall, st, pl);
      }
    }
    this.seen = stock.version;
    this.counts.syncs++;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Per frame: follow the stock, aim

  frame(): void {
    const h = this.host, stock = h.trade?.stock ?? null;
    if (stock !== this.stock) { // (the trade's stock went or was replaced without a build of ours: follow it)
      const layout = this.layout;
      if (stock && layout) this.build(layout);
      else if (this.wares.size || this.packers.size) { this.teardown(); this.layout = layout; }
    }
    if (!this.stock) return;
    if (this.stock.version !== this.seen) this.sync();
    this.aim();
  }

  /** The ware the crosshair ray hits first (its own box, within reach, in sight); null when nothing / not playing. */
  aim(): Ware | null {
    const h = this.host;
    this.aimed = null;
    // (nothing while a bag view is open or a backpack is readied in the hands: E / the prompt are the gear's then)
    if (!this.wares.size || h.state !== 'playing' || !h.player.alive || h.trainRide?.riding || h.trade?.isOpen || h.gear?.session || h.gear?.readied) { this.setHover(null); return null; }
    h.camera.getWorldPosition(EYE);
    h.camera.getWorldDirection(DIR);
    let best: Ware | null = null, bt: number = WARES.reach;
    const far = (WARES.reach + 1) ** 2;
    for (const w of this.wares.values()) {
      const o = w.pickup.obj;
      if (o.position.distanceToSquared(EYE) > far) continue;
      o.updateMatrixWorld();
      INV.copy(o.matrixWorld).invert();
      LO.copy(EYE).applyMatrix4(INV);
      LD.copy(DIR).transformDirection(INV);
      const b = w.box, pad = WARES.pad;
      const r = rayAabb(LO, LD, {x: b.min.x - pad, y: b.min.y - pad, z: b.min.z - pad}, {x: b.max.x + pad, y: b.max.y + pad, z: b.max.z + pad});
      if (r && r.t < bt) { bt = r.t; best = w; }
    }
    this.lastBlock = '';
    if (best) {
      // (task studio-market-bar-20261108-225231-01) a trader's body or a counter in front of the ware takes the look: Trade, never Steal
      const block = this.occluder(EYE, DIR, bt);
      if (block) { this.lastBlock = block; best = null; }
    }
    if (best) {
      HIT.copy(DIR).multiplyScalar(bt).add(EYE);
      const lv = h.levels, g = h.layout?.grid;
      const seen = lv && lv.count > 1 ? lv.lineOfSight(EYE, HIT, {slack: 0.15}) : g ? g.lineOfSight(EYE.x, EYE.z, HIT.x, HIT.z) : true;
      if (!seen) best = null;
    }
    this.aimed = best;
    this.setHover(best?.pickup ?? null);
    return best;
  }

  /** A stall's trader as it stands now (the live people when installed: null once it is gone; else its post). */
  traderAt(s: MarketStall): {x: number; y: number; z: number} | null {
    const mp = this.host.marketPeople;
    return mp ? mp.traderAt(s.id) : s.trader ?? null;
  }

  /**
   * What the ray o + d t hits before `tMax` of the stalls' traders (an upright WARES.traderR / traderH capsule on the feet) and counters
   * (their solid boxes): 'trader' / 'counter', or null. The INTERACTION PRIORITY: looking at the trader (or across the counter at what
   * lies behind it) is the trade's — the [E] Trade at the customer spot; only a ware whose own box the crosshair meets FIRST is a Steal.
   */
  occluder(o: THREE.Vector3, d: THREE.Vector3, tMax: number): 'trader' | 'counter' | null {
    const R = WARES.traderR, Hh = WARES.traderH;
    let t = tMax, what: 'trader' | 'counter' | null = null;
    for (const s of this.stalls) {
      const p = this.traderAt(s);
      if (!p) continue;
      if (Math.hypot(p.x - o.x, p.z - o.z) > tMax + R + 0.1) continue;
      const tt = rayCapsule(o, d, {x: p.x, y: p.y + R, z: p.z}, {x: p.x, y: p.y + Hh - R, z: p.z}, R);
      if (tt < t) { t = tt; what = 'trader'; }
    }
    for (const b of this.counters) {
      const r = rayAabb(o, d, b.min, b.max);
      if (r && r.t < t) { t = r.t; what = 'counter'; }
    }
    return what;
  }

  private setHover(p: Pickup | null): void {
    const pm = this.host.pickups;
    if ('hover' in pm || p) pm.hover = p;
  }

  prompt(): string | null {
    const w = this.aimed;
    return w && this.wares.has(w.uid) ? WARES_TEXT.steal(wareLabel(w.pickup.stack)) : null;
  }

  /** [E]: steal the aimed ware (true = handled: a refusal too). */
  interact(): boolean {
    const w = this.aimed;
    if (!w || !this.wares.has(w.uid) || this.host.state !== 'playing' || !this.host.player.alive || this.host.trade?.isOpen) return false;
    return this.steal(w);
  }

  /**
   * THEFT of a displayed ware: as much of its stack as the inventory takes (simulated first: a refusal changes nothing) leaves the stall's
   * stock (TradeSystem.takeStock: recorded at once) into the inventory, and the settlement is provoked. Returns true (handled) unless the
   * ware is not this system's.
   */
  steal(w: Ware): boolean {
    const h = this.host, trade = h.trade, sfx = h.sfx as {pickup?(): void; denied?(): void} | null | undefined;
    if (!this.wares.has(w.uid)) return false;
    const st = trade?.stock?.stalls[w.stall]?.find(s => s.uid === w.uid);
    if (!trade || !st) { this.sync(); return true; } // (stale: the display catches up; nothing is taken)
    // how much of it fits: the same add on a copy of the inventory (uid counter included) — the real one is untouched on a refusal
    const sim = h.inv.clone(), probe = stackFromJSON(stackToJSON(st))!;
    const fits = Math.min(st.count, st.count - sim.add(probe));
    if (fits <= 0) {
      h.hud.toast(sim.refusal?.text || WARES_TEXT.noRoom, true);
      sfx?.denied?.();
      this.counts.refused++;
      return true;
    }
    const piece = trade.takeStock(w.stall, w.uid, fits);
    if (!piece) { this.sync(); return true; }
    const left = h.inv.add(piece);
    const got = piece.count - left;
    const taken = {...piece, count: got}; // (lane BEER: exactly what went in, before anything below touches the piece)
    if (left > 0) {
      // (never expected: the copy took it all. The rest is the player's now — it lies where the ware lay, an ordinary item: no loss, no copy)
      piece.count = left;
      h.pickups.addAt(piece, M.copy(w.pickup.obj.matrixWorld));
    }
    this.counts.thefts++;
    this.lastTheft = {stall: w.stall, uid: piece.uid, itemId: piece.itemId, count: got};
    this.sync(); // (a whole stack's ware goes now; a part leaves the rest on display, the same stack)
    try { h.marketHostility?.provoke({kind: 'theft', stall: w.stall}); } catch (err) { console.warn('market wares: provoke failed', err); }
    sfx?.pickup?.();
    h.syncHeld?.();
    h.hud.toast(WARES_TEXT.stolen(wareLabel({itemId: piece.itemId, count: got})), true);
    h.beerEffects?.acquired?.({kind: 'ware', stall: w.stall, uid: w.uid}, taken); // (lane BEER) a stolen ware: the Pilsner may double it (rolled once per ware)
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // QA

  /** Per stall the displayed wares (uid, item, count, where), the aimed one, counts. */
  qa() {
    const stalls: Partial<Record<MarketStallId, {uid: number; item: string; count: number; x: number; y: number; z: number; home: boolean}[]>> = {};
    for (const w of this.wares.values()) {
      const o = w.pickup.obj.position;
      (stalls[w.stall] ??= []).push({uid: w.uid, item: w.pickup.stack.itemId, count: w.pickup.stack.count, x: +o.x.toFixed(3), y: +o.y.toFixed(3), z: +o.z.toFixed(3),
        home: Math.hypot(w.place.x - w.pickup.x, w.place.z - w.pickup.z) < 0.25});
    }
    return {stalls, aimed: this.aimed ? {stall: this.aimed.stall, uid: this.aimed.uid, item: this.aimed.pickup.stack.itemId} : null,
      shown: this.wares.size, counts: {...this.counts}, lastTheft: this.lastTheft};
  }
}

/** Installs the stalls' owned wares into a Game (one call in the Game constructor, AFTER installMarketTrade). */
export function installMarketWares(game: unknown): MarketWares {
  return new MarketWares(game as WaresHost).install();
}

/** QA hooks (spread into window.__LL by qa.ts) for SHORT serial browser spot checks. `sys`: the installed wares. */
export function marketWaresQaApi(sys: () => MarketWares | null | undefined) {
  return {
    /** The displayed wares per stall, the aimed ware, counts, the last theft. */
    wares: () => sys()?.qa() ?? null,
    /** Steal a displayed ware by uid as [E] on it would (false: no such ware here). */
    waresSteal: (uid: number) => { const s = sys(), w = s?.wares.get(uid); return s && w ? s.steal(w) : false; },
  };
}
